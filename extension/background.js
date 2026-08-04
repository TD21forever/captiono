import {
  isBilibiliPage,
  LOAD_BILIBILI_CAPTIONS,
  loadBilibiliCaptions,
} from "./bilibili-provider.js";
import { captureYouTubeCaptionUrl } from "./youtube-player-bridge.js";

const CAPTURE_YOUTUBE_PLAYER_CAPTION_URL =
  "CAPTURE_YOUTUBE_PLAYER_CAPTION_URL";
const TOGGLE_CAPTION_REVIEW_PANEL = "TOGGLE_CAPTION_REVIEW_PANEL";
const OPEN_CAPTION_REVIEW_PANEL = "OPEN_CAPTION_REVIEW_PANEL";
const playerCaptionRequests = new Map();
const bilibiliCaptionRequests = new Map();

function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? "";
    }
    if (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) {
      return "";
    }
    if (
      url.pathname.startsWith("/shorts/") ||
      url.pathname.startsWith("/embed/")
    ) {
      return url.pathname.split("/").filter(Boolean)[1] ?? "";
    }
    return url.searchParams.get("v") ?? "";
  } catch {
    return "";
  }
}

function normalizePlayerRequest(message) {
  const videoId = String(message?.videoId ?? "").trim();
  const discoverOnly = message?.discoverOnly === true;
  const language = String(message?.language ?? "").trim().toLowerCase();
  const label = String(message?.label ?? "").trim().slice(0, 160);
  const kind =
    String(message?.kind ?? "").trim().toLowerCase() === "asr"
      ? "asr"
      : "manual";
  const vssId = String(message?.vssId ?? "").trim();
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;
  if (discoverOnly) {
    return {
      videoId,
      discoverOnly: true,
      forceFresh: false,
      language: "",
      label: "",
      kind: "manual",
      vssId: "",
    };
  }
  if (
    !/^[a-z0-9-]{2,24}$/i.test(language) ||
    !/^[a-z0-9._-]{1,80}$/i.test(vssId)
  ) {
    return null;
  }
  return {
    videoId,
    language,
    label,
    kind,
    vssId,
    discoverOnly: false,
    forceFresh: message?.forceFresh === true,
  };
}

async function captureFromYouTubePlayer(message, sender) {
  const request = normalizePlayerRequest(message);
  const tabId = sender.tab?.id;
  const senderVideoId = youtubeVideoId(sender.url || sender.tab?.url);
  if (
    !request ||
    !Number.isInteger(tabId) ||
    sender.frameId !== 0 ||
    senderVideoId !== request.videoId
  ) {
    return {
      ok: false,
      reason: "youtube-player-request-rejected",
      message: "当前字幕请求与活动的 YouTube 视频不匹配。",
    };
  }

  const cacheKey = [
    tabId,
    request.videoId,
    request.vssId,
    request.forceFresh ? "fresh" : "available",
  ].join("\n");
  if (playerCaptionRequests.has(cacheKey)) {
    return playerCaptionRequests.get(cacheKey);
  }

  const capture = (async () => {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: "MAIN",
        func: captureYouTubeCaptionUrl,
        args: [request],
      });
      return (
        results.find((entry) => entry.frameId === 0)?.result ?? {
          ok: false,
          reason: "youtube-player-empty-result",
          message: "YouTube 播放器没有返回字幕请求。",
        }
      );
    } catch {
      return {
        ok: false,
        reason: "youtube-player-injection-failed",
        message: "无法连接当前 YouTube 播放器，请刷新视频页后重试。",
      };
    }
  })();

  playerCaptionRequests.set(cacheKey, capture);
  try {
    return await capture;
  } finally {
    playerCaptionRequests.delete(cacheKey);
  }
}

async function captureFromBilibili(message, sender) {
  const tabId = sender.tab?.id;
  if (
    !Number.isInteger(tabId) ||
    sender.frameId !== 0 ||
    !isBilibiliPage(sender.url || sender.tab?.url)
  ) {
    return {
      ok: false,
      reason: "bilibili-caption-request-rejected",
      message: "当前字幕请求与活动的 Bilibili 视频不匹配。",
    };
  }

  const cacheKey = [
    tabId,
    String(message.mediaId ?? ""),
    String(message.aid ?? ""),
    String(message.cid ?? ""),
    String(message.trackId ?? ""),
    String(message.language ?? ""),
  ].join("\n");
  if (bilibiliCaptionRequests.has(cacheKey)) {
    return bilibiliCaptionRequests.get(cacheKey);
  }

  const capture = loadBilibiliCaptions(message).catch((error) => ({
    ok: false,
    reason: "bilibili-caption-fetch-failed",
    message:
      error instanceof Error
        ? error.message
        : "当前 Bilibili 字幕读取失败。",
    tracks: [],
  }));
  bilibiliCaptionRequests.set(cacheKey, capture);
  try {
    return await capture;
  } finally {
    bilibiliCaptionRequests.delete(cacheKey);
  }
}

async function togglePagePanel(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: TOGGLE_CAPTION_REVIEW_PANEL,
    });
    if (response?.handled) return;
  } catch {
    // An already-open tab may predate this extension build.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["content-script.js", "caption-review-ui.js"],
    });
    await chrome.tabs.sendMessage(tabId, {
      type: OPEN_CAPTION_REVIEW_PANEL,
    });
  } catch {
    // Host permissions intentionally prevent injection on unsupported pages.
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (Number.isInteger(tab.id)) void togglePagePanel(tab.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return undefined;

  if (
    sender.tab &&
    message?.type === CAPTURE_YOUTUBE_PLAYER_CAPTION_URL
  ) {
    void captureFromYouTubePlayer(message, sender).then(sendResponse);
    return true;
  }

  if (sender.tab && message?.type === LOAD_BILIBILI_CAPTIONS) {
    void captureFromBilibili(message, sender).then(sendResponse);
    return true;
  }

  return undefined;
});
