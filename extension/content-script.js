(() => {
  if (globalThis.__captionReviewMediaBridgeInstalled) return;
  globalThis.__captionReviewMediaBridgeInstalled = true;

  const PUBLISH_INTERVAL_MS = 500;
  const TRACK_WAIT_TIMEOUT_MS = 1800;
  const TRACK_RETRY_INTERVAL_MS = 2500;
  const CAPTION_KINDS = new Set(["captions", "subtitles"]);
  const READY_STATE_NAMES = ["none", "loading", "loaded", "error"];
  const PAGE_TEXT_TRACK_SOURCE = "page-text-track";
  const YOUTUBE_PAGE_MANIFEST_SOURCE = "youtube-page-manifest";
  const YOUTUBE_PLAYER_CAPTION_SOURCE = "youtube-player-caption";
  const BILIBILI_PAGE_SUBTITLE_SOURCE = "bilibili-page-subtitle";
  const CAPTURE_YOUTUBE_PLAYER_CAPTION_URL =
    "CAPTURE_YOUTUBE_PLAYER_CAPTION_URL";
  const LOAD_BILIBILI_CAPTIONS = "LOAD_BILIBILI_CAPTIONS";
  const trackIds = new WeakMap();
  const observedTrackLists = new WeakSet();
  const observedTracks = new WeakSet();
  const manifestCueCache = new Map();
  const manifestCueRequests = new Map();
  const manifestRequestControllers = new Set();
  const pageBridgeListeners = new Set();

  let nextTrackId = 1;
  let selectedTrackId = "";
  let refreshVersion = 0;
  let refreshTimerId = null;
  let automaticRefreshPromise = null;
  let pendingAutomaticRefresh = false;
  let pendingRefreshDelayMs = 120;
  let intervalId = null;
  let retryIntervalId = null;
  let mutationObserver = null;
  let bridgeStopped = false;
  let userCaptionRequestCount = 0;
  let previousMediaKey = "";
  let captionState = unavailableCaptionState(
    "not-requested",
    "尚未读取当前页面的字幕轨。",
  );

  const PLATFORM_PROVIDERS = [
    {
      id: "youtube",
      matches: () => Boolean(youtubeVideoId()),
      ownsTrack: (trackId) =>
        normalizeSpace(trackId).startsWith("page-manifest-youtube-"),
      refresh: refreshManifestCaptions,
    },
    {
      id: "bilibili",
      matches: () => Boolean(bilibiliMediaId()),
      ownsTrack: (trackId) =>
        normalizeSpace(trackId).startsWith("bilibili-"),
      refresh: refreshBilibiliCaptions,
    },
  ];

  function finiteNumber(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
  }

  function normalizeSpace(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function normalizeUrl(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw, location.href);
      url.hash = "";
      return url.href;
    } catch {
      return raw.split("#", 1)[0];
    }
  }

  function cleanCueText(value) {
    return String(value ?? "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  async function sendRuntimeMessage(message) {
    if (bridgeStopped) return null;
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      stopBridge();
      return null;
    }
  }

  function pageUrl() {
    try {
      return new URL(location.href);
    } catch {
      return null;
    }
  }

  function youtubeVideoId(url = pageUrl()) {
    if (!url) return "";
    const hostname = url.hostname.toLowerCase();
    if (hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? "";
    }
    if (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) {
      return "";
    }
    if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) {
      return url.pathname.split("/").filter(Boolean)[1] ?? "";
    }
    return url.searchParams.get("v") ?? "";
  }

  function bilibiliMediaId(url = pageUrl()) {
    if (!url || !url.hostname.toLowerCase().endsWith("bilibili.com")) {
      return "";
    }
    return (
      url.pathname.match(/\/video\/((?:BV)[a-zA-Z0-9]+)/i)?.[1] ||
      url.pathname.match(/\/bangumi\/play\/((?:ep|ss)\d+)/i)?.[1] ||
      ""
    );
  }

  function bilibiliMediaBindingId(url = pageUrl()) {
    const mediaId = bilibiliMediaId(url);
    if (!mediaId) return "";
    const page = Math.max(
      1,
      Math.round(Number(url?.searchParams.get("p"))) || 1,
    );
    return `${mediaId}:p${page}`;
  }

  function extractAssignedJson(source, variableName) {
    let searchIndex = 0;
    while (searchIndex < source.length) {
      const markerIndex = source.indexOf(variableName, searchIndex);
      if (markerIndex < 0) return null;
      let startIndex = markerIndex + variableName.length;
      while (/\s/.test(source[startIndex] ?? "")) startIndex += 1;
      if (source[startIndex] !== "=") {
        searchIndex = startIndex + 1;
        continue;
      }
      startIndex += 1;
      while (/\s/.test(source[startIndex] ?? "")) startIndex += 1;
      if (source[startIndex] !== "{") {
        searchIndex = startIndex + 1;
        continue;
      }

      let depth = 0;
      let escaped = false;
      let inString = false;
      for (let index = startIndex; index < source.length; index += 1) {
        const character = source[index];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (character === "\\") {
            escaped = true;
          } else if (character === '"') {
            inString = false;
          }
          continue;
        }

        if (character === '"') {
          inString = true;
        } else if (character === "{") {
          depth += 1;
        } else if (character === "}") {
          depth -= 1;
          if (depth === 0) {
            try {
              return JSON.parse(source.slice(startIndex, index + 1));
            } catch {
              break;
            }
          }
        }
      }
      searchIndex = startIndex + 1;
    }

    return null;
  }

  function bilibiliPageIdentity() {
    const mediaId = bilibiliMediaId();
    const page = Math.max(
      1,
      Math.round(Number(pageUrl()?.searchParams.get("p"))) || 1,
    );
    let aid = null;
    let cid = null;

    const scripts = Array.from(document.scripts ?? []);
    for (let index = scripts.length - 1; index >= 0; index -= 1) {
      const source = String(scripts[index]?.text ?? "");
      if (!source.includes("__INITIAL_STATE__")) continue;
      const state = extractAssignedJson(source, "__INITIAL_STATE__");
      if (!state) continue;
      const videoData = state.videoData ?? state.epInfo ?? {};
      aid = Number(videoData.aid ?? state.aid) || null;
      cid = Number(videoData.cid ?? state.cid) || null;
      if (aid && cid) break;
    }

    return {
      aid,
      cid,
      mediaId,
      bindingMediaId: `${mediaId}:p${page}`,
      page,
    };
  }

  function currentPlatformProvider() {
    return PLATFORM_PROVIDERS.find((provider) => provider.matches()) ?? null;
  }

  function youtubeCaptionUrl(value) {
    try {
      const url = new URL(value, location.href);
      const currentUrl = pageUrl();
      const currentVideoId = youtubeVideoId(currentUrl);
      const hostname = url.hostname.toLowerCase();
      if (
        !currentUrl ||
        !currentVideoId ||
        url.protocol !== "https:" ||
        (hostname !== "youtube.com" && !hostname.endsWith(".youtube.com")) ||
        url.origin !== currentUrl.origin ||
        url.pathname !== "/api/timedtext" ||
        url.searchParams.get("v") !== currentVideoId
      ) {
        return null;
      }
      url.hash = "";
      url.searchParams.set("fmt", "json3");
      return url.href;
    } catch {
      return null;
    }
  }

  function captionTrackName(track) {
    return normalizeSpace(
      track?.name?.simpleText ||
        track?.name?.runs?.map((run) => run?.text ?? "").join(""),
    );
  }

  function manifestTrackId(track, index) {
    const language = normalizeSpace(track?.languageCode || "und")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-");
    const kind = normalizeSpace(track?.kind || "manual")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-");
    const authoredId = normalizeSpace(track?.vssId)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `page-manifest-youtube-${
      authoredId || `${language}-${kind}-${index + 1}`
    }`;
  }

  function youtubeManifestTracks() {
    const currentVideoId = youtubeVideoId();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(currentVideoId)) return [];

    const scripts = Array.from(document.scripts ?? []);
    for (let index = scripts.length - 1; index >= 0; index -= 1) {
      const source = String(scripts[index]?.text ?? "");
      if (
        !source.includes("ytInitialPlayerResponse") ||
        !source.includes("captionTracks")
      ) {
        continue;
      }

      const response = extractAssignedJson(source, "ytInitialPlayerResponse");
      const responseVideoId = normalizeSpace(response?.videoDetails?.videoId);
      if (responseVideoId !== currentVideoId) continue;
      if (response?.videoDetails?.isLiveContent) return [];

      const tracks =
        response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!Array.isArray(tracks) || tracks.length === 0) continue;

      const candidates = tracks
        .map((track, trackIndex) => {
          const baseUrl = youtubeCaptionUrl(track?.baseUrl);
          if (!baseUrl) return null;
          return {
            id: manifestTrackId(track, trackIndex),
            label: captionTrackName(track),
            language: normalizeSpace(track?.languageCode),
            kind: "subtitles",
            mode: "disabled",
            readyState: "loaded",
            cueCount: null,
            provider: "youtube",
            manifestKind: normalizeSpace(track?.kind || "manual"),
            vssId: normalizeSpace(track?.vssId),
            baseUrl,
          };
        })
        .filter(Boolean);
      if (candidates.length > 0) return candidates;
    }

    return [];
  }

  function describeManifestTrack(candidate, isSelected = false, cueCount = null) {
    return {
      id: candidate.id,
      label: candidate.label,
      language: candidate.language,
      kind: candidate.kind,
      mode: isSelected ? "hidden" : candidate.mode,
      readyState: candidate.readyState,
      cueCount,
      isSelected,
    };
  }

  function manifestLanguageMatches(candidate, requestedLanguage) {
    const available = normalizeSpace(candidate.language).toLowerCase();
    const requested = normalizeSpace(requestedLanguage).toLowerCase();
    if (!available || !requested) return false;
    return (
      available === requested ||
      available.split("-", 1)[0] === requested.split("-", 1)[0]
    );
  }

  function chooseManifestTrack(candidates, request = {}) {
    const requestedId = normalizeSpace(request.trackId);
    if (requestedId) {
      return candidates.find((candidate) => candidate.id === requestedId) ?? null;
    }

    const requestedLanguage = normalizeSpace(request.language);
    if (requestedLanguage) {
      return (
        candidates.find((candidate) =>
          manifestLanguageMatches(candidate, requestedLanguage),
        ) ?? null
      );
    }

    return (
      candidates.find((candidate) => candidate.id === selectedTrackId) ??
      candidates.find(
        (candidate) =>
          manifestLanguageMatches(candidate, "en") &&
          candidate.manifestKind !== "asr",
      ) ??
      candidates.find((candidate) =>
        manifestLanguageMatches(candidate, "en"),
      ) ??
      navigator.languages
        ?.map((language) =>
          candidates.find((candidate) =>
            manifestLanguageMatches(candidate, language),
          ),
        )
        .find(Boolean) ??
      candidates[0] ??
      null
    );
  }

  function playerCaptionUrl(value, candidate, videoId = youtubeVideoId()) {
    try {
      const url = new URL(value, location.href);
      const currentUrl = pageUrl();
      if (
        !currentUrl ||
        !/^[a-zA-Z0-9_-]{11}$/.test(videoId) ||
        youtubeVideoId(currentUrl) !== videoId ||
        url.protocol !== "https:" ||
        url.origin !== currentUrl.origin ||
        url.pathname !== "/api/timedtext" ||
        url.searchParams.get("v") !== videoId ||
        url.searchParams.get("fmt") !== "json3" ||
        url.searchParams.get("exp") === "xpe" ||
        url.href.length > 16_000
      ) {
        return "";
      }
      const expiresAt = Number(url.searchParams.get("expire"));
      if (
        Number.isFinite(expiresAt) &&
        expiresAt > 0 &&
        expiresAt < Date.now() / 1000 + 15
      ) {
        return "";
      }
      const expectedLanguage = normalizeSpace(candidate.language).toLowerCase();
      if (
        expectedLanguage &&
        url.searchParams.get("lang")?.toLowerCase() !== expectedLanguage
      ) {
        return "";
      }
      const expectedKind =
        normalizeSpace(candidate.manifestKind).toLowerCase() === "asr"
          ? "asr"
          : "manual";
      const responseKind =
        url.searchParams.get("kind") === "asr" ? "asr" : "manual";
      if (expectedKind !== responseKind) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function normalizePlayerCaptionResult(result, candidate, videoId) {
    if (
      result?.source !== YOUTUBE_PLAYER_CAPTION_SOURCE ||
      result?.videoId !== videoId
    ) {
      throw new Error("YouTube 播放器返回了无效的字幕请求。");
    }
    const responseLanguage = normalizeSpace(result?.track?.language);
    if (
      responseLanguage &&
      !manifestLanguageMatches(candidate, responseLanguage)
    ) {
      throw new Error("YouTube 播放器返回了其他语言的字幕。");
    }
    const url = playerCaptionUrl(result.captionUrl, candidate, videoId);
    if (!url) {
      throw new Error("YouTube 播放器返回了无效或过期的字幕地址。");
    }
    return {
      url,
      captureMode: normalizeSpace(result.captureMode),
      stateRestored: result.stateRestored !== false,
    };
  }

  async function requestYouTubePlayerCaptionUrl(
    candidate,
    forceFresh = false,
  ) {
    const videoId = youtubeVideoId();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      throw new Error("当前页面不是可读取的 YouTube 视频。");
    }

    const result = await sendRuntimeMessage({
      type: CAPTURE_YOUTUBE_PLAYER_CAPTION_URL,
      videoId,
      language: candidate.language,
      label: candidate.label,
      kind: candidate.manifestKind,
      vssId: candidate.vssId,
      forceFresh,
    });
    if (!result?.ok) {
      const error = new Error(
        normalizeSpace(result?.message) || "YouTube 播放器字幕读取失败。",
      );
      error.reason = normalizeSpace(result?.reason);
      throw error;
    }
    if (youtubeVideoId() !== videoId) {
      throw new Error("YouTube 页面已切换到其他视频。");
    }
    return normalizePlayerCaptionResult(result, candidate, videoId);
  }

  async function youtubePlayerManifestTracks() {
    const videoId = youtubeVideoId();
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return [];
    const result = await sendRuntimeMessage({
      type: CAPTURE_YOUTUBE_PLAYER_CAPTION_URL,
      videoId,
      discoverOnly: true,
    });
    if (
      !result?.ok ||
      result.source !== YOUTUBE_PLAYER_CAPTION_SOURCE ||
      result.videoId !== videoId ||
      youtubeVideoId() !== videoId
    ) {
      return [];
    }

    const tracks = Array.isArray(result.tracks) ? result.tracks : [];
    return tracks
      .slice(0, 120)
      .map((track, index) => {
        const language = normalizeSpace(track?.language).toLowerCase();
        const manifestKind =
          normalizeSpace(track?.kind).toLowerCase() === "asr"
            ? "asr"
            : "manual";
        const vssId = normalizeSpace(track?.vssId);
        if (
          !/^[a-z0-9-]{2,24}$/i.test(language) ||
          !/^[a-z0-9._-]{1,80}$/i.test(vssId)
        ) {
          return null;
        }
        return {
          id: manifestTrackId(
            {
              languageCode: language,
              kind: manifestKind === "asr" ? "asr" : "",
              vssId,
            },
            index,
          ),
          label: normalizeSpace(track?.label || language),
          language,
          kind: "subtitles",
          mode: result.selectedTrackId === track.id ? "hidden" : "disabled",
          readyState: "loaded",
          cueCount: null,
          provider: "youtube",
          manifestKind,
          vssId,
          baseUrl: "",
        };
      })
      .filter(Boolean);
  }

  async function fetchCaptionJson3(
    url,
    {
      idPrefix = "page-manifest-cue",
      format = "youtube-json3",
      validateFinalUrl = null,
    } = {},
  ) {
    const controller = new AbortController();
    manifestRequestControllers.add(controller);
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        credentials: "omit",
        method: "GET",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`字幕请求失败（HTTP ${response.status}）`);
      }
      if (
        response.url &&
        validateFinalUrl &&
        !validateFinalUrl(response.url)
      ) {
        throw new Error("字幕请求被重定向到无效地址。");
      }
      const declaredLength = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > 5_000_000) {
        throw new Error("字幕响应过大，已停止读取。");
      }
      const body = await response.text();
      if (body.length > 5_000_000) {
        throw new Error("字幕响应过大，已停止读取。");
      }
      if (!body.trim()) {
        throw new Error("YouTube 未返回字幕内容。");
      }
      const payload = JSON.parse(body);
      if (Array.isArray(payload?.events) && payload.events.length > 50_000) {
        throw new Error("字幕事件过多，已停止读取。");
      }
      const cues = json3Cues(payload, { idPrefix, format });
      if (cues.length === 0) {
        throw new Error("YouTube 播放器返回了空字幕。");
      }
      return cues;
    } finally {
      clearTimeout(timeoutId);
      manifestRequestControllers.delete(controller);
    }
  }

  async function fetchYouTubePlayerCues(candidate) {
    let firstError = null;
    for (const forceFresh of [false, true]) {
      try {
        const result = await requestYouTubePlayerCaptionUrl(
          candidate,
          forceFresh,
        );
        const videoId = youtubeVideoId();
        const cues = await fetchCaptionJson3(result.url, {
          idPrefix: "youtube-player-cue",
          format: "youtube-player-json3",
          validateFinalUrl: (value) =>
            Boolean(playerCaptionUrl(value, candidate, videoId)),
        });
        return {
          cues,
          source: YOUTUBE_PLAYER_CAPTION_SOURCE,
          stateRestored: result.stateRestored,
        };
      } catch (error) {
        firstError ??= error;
      }
    }
    throw firstError ?? new Error("YouTube 播放器字幕读取失败。");
  }

  function json3Cues(
    payload,
    {
      idPrefix = "page-manifest-cue",
      format = "youtube-json3",
    } = {},
  ) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const pending = events
      .map((event, sourceIndex) => {
        const startMs = Math.round(Number(event?.tStartMs));
        const durationMs = Math.round(Number(event?.dDurationMs));
        const text = cleanCueText(
          Array.isArray(event?.segs)
            ? event.segs.map((segment) => segment?.utf8 ?? "").join("")
            : "",
        );
        if (!Number.isFinite(startMs) || startMs < 0 || !text) return null;
        return {
          id: `${idPrefix}-${sourceIndex + 1}`,
          sourceIndex,
          startMs,
          durationMs:
            Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
          text,
          format,
        };
      })
      .filter(Boolean)
      .sort(
        (left, right) =>
          left.startMs - right.startMs || left.sourceIndex - right.sourceIndex,
      );

    return pending
      .map((cue, index) => {
        const nextStartMs = pending[index + 1]?.startMs;
        const inferredEndMs =
          Number.isFinite(nextStartMs) && nextStartMs > cue.startMs
            ? nextStartMs
            : cue.startMs + 2000;
        const endMs = cue.durationMs
          ? cue.startMs + cue.durationMs
          : inferredEndMs;
        if (endMs <= cue.startMs) return null;
        const { durationMs: _durationMs, ...normalized } = cue;
        return { ...normalized, endMs };
      })
      .filter(Boolean);
  }

  function pageManifestRequiresPlayerSignature(candidate) {
    try {
      return new URL(candidate.baseUrl).searchParams.get("exp") === "xpe";
    } catch {
      return false;
    }
  }

  function cacheManifestResult(cacheKey, result) {
    manifestCueCache.set(cacheKey, result);
    while (manifestCueCache.size > 12) {
      manifestCueCache.delete(manifestCueCache.keys().next().value);
    }
    return result;
  }

  async function fetchManifestCues(
    candidate,
    { allowPlayerInteraction = false } = {},
  ) {
    const cacheKey = `${youtubeVideoId()}\n${candidate.id}\n${candidate.baseUrl}`;
    if (manifestCueCache.has(cacheKey)) {
      return manifestCueCache.get(cacheKey);
    }
    const requestKey = `${cacheKey}\n${
      allowPlayerInteraction ? "interactive" : "passive"
    }`;
    if (manifestCueRequests.has(requestKey)) {
      return manifestCueRequests.get(requestKey);
    }

    const request = (async () => {
      let playerError = null;
      if (allowPlayerInteraction) {
        try {
          const result = await fetchYouTubePlayerCues(candidate);
          return cacheManifestResult(cacheKey, result);
        } catch (error) {
          playerError = error;
        }
      }

      if (pageManifestRequiresPlayerSignature(candidate)) {
        if (playerError) throw playerError;
        const error = new Error(
          "打开 Captiono 后，才能请当前播放器准备这条字幕。",
        );
        error.reason = "youtube-player-caption-user-action-required";
        throw error;
      }

      if (!candidate.baseUrl) {
        if (playerError) throw playerError;
        const error = new Error("YouTube 播放器没有返回可读取的字幕地址。");
        error.reason = "youtube-player-caption-url-unavailable";
        throw error;
      }

      const cues = await fetchCaptionJson3(candidate.baseUrl);
      return cacheManifestResult(cacheKey, {
        cues,
        source: YOUTUBE_PAGE_MANIFEST_SOURCE,
        stateRestored: true,
      });
    })();

    manifestCueRequests.set(requestKey, request);
    try {
      return await request;
    } finally {
      manifestCueRequests.delete(requestKey);
    }
  }

  function videoScore(video) {
    const rect = video.getBoundingClientRect();
    const visibleArea =
      Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) *
      Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));

    return (video.paused ? 0 : 1_000_000_000) + visibleArea + video.readyState;
  }

  function primaryVideo() {
    return Array.from(document.querySelectorAll("video")).sort(
      (left, right) => videoScore(right) - videoScore(left),
    )[0] ?? null;
  }

  function mediaBinding(video) {
    const currentUrl = pageUrl();
    const youtubeId = youtubeVideoId(currentUrl);
    const bilibiliId = bilibiliMediaId(currentUrl);
    const bilibiliBindingId = bilibiliMediaBindingId(currentUrl);
    return {
      pageUrl: normalizeUrl(location.href),
      title: normalizeSpace(document.title),
      mediaSrc: normalizeUrl(video?.currentSrc || video?.src || ""),
      provider: youtubeId
        ? "youtube"
        : bilibiliId
          ? "bilibili"
          : "web",
      mediaId: youtubeId || bilibiliBindingId || bilibiliId,
    };
  }

  function mediaState() {
    const video = primaryVideo();
    const binding = mediaBinding(video);

    return {
      connected: Boolean(video),
      currentTime: video ? finiteNumber(video.currentTime) : 0,
      duration: video ? finiteNumber(video.duration) : 0,
      paused: video ? video.paused : true,
      seeking: video ? video.seeking : false,
      title: binding.title,
      url: binding.pageUrl,
      mediaSrc: binding.mediaSrc,
      provider: binding.provider,
      mediaId: binding.mediaId,
      mediaBinding: binding,
    };
  }

  function unavailableCaptionState(reason, message, video = primaryVideo()) {
    return {
      protocolVersion: 1,
      status: "unavailable",
      reason,
      message,
      document: null,
      tracks: [],
      mediaBinding: mediaBinding(video),
    };
  }

  function setCaptionState(nextState, publish = true) {
    captionState = nextState;
    if (!publish) return;

    publishToPageBridge({ type: "CAPTION_STATE", state: captionState });
    void sendRuntimeMessage({ type: "CAPTION_STATE", state: captionState });
  }

  async function seekTo(message) {
    const video = primaryVideo();
    const requestedTime = Number(message?.time ?? message?.seconds);

    if (!video || !Number.isFinite(requestedTime)) return mediaState();

    const upperBound = Number.isFinite(video.duration)
      ? video.duration
      : Number.POSITIVE_INFINITY;
    try {
      video.currentTime = Math.min(Math.max(requestedTime, 0), upperBound);
    } catch {
      // The host player may not be seekable until its metadata is loaded.
    }

    if (message?.play === true && video.paused) {
      try {
        await video.play();
      } catch {
        // Playback can still be rejected by the host player. Return its real
        // state so the panel never pretends that playback started.
      }
    }
    return mediaState();
  }

  async function togglePlay() {
    const video = primaryVideo();
    if (!video) return mediaState();

    if (video.paused) {
      try {
        await video.play();
      } catch {
        // Autoplay policy or the host player may reject playback. The state
        // response remains authoritative for this tab's page panel.
      }
    } else {
      video.pause();
    }

    return mediaState();
  }

  function browserTrackList(video) {
    if (!video) return [];
    try {
      const propertyName = ["text", "Tracks"].join("");
      const list = Reflect.get(video, propertyName);
      return list ? Array.from(list) : [];
    } catch {
      return [];
    }
  }

  function trackElements(video) {
    if (!video?.querySelectorAll) return [];
    return Array.from(video.querySelectorAll("track"));
  }

  function stableTrackId(track, element, index) {
    if (trackIds.has(track)) return trackIds.get(track);

    const authoredId = normalizeSpace(element?.id || track?.id);
    const language = normalizeSpace(
      track?.language || element?.srclang || "und",
    ).toLowerCase();
    const kind = normalizeSpace(
      track?.kind || element?.kind || "subtitles",
    ).toLowerCase();
    const suffix = authoredId || `${language}-${kind}-${index + 1}`;
    const id = `page-track-${suffix}-${nextTrackId}`;
    nextTrackId += 1;
    trackIds.set(track, id);
    return id;
  }

  function discoverTracks(video) {
    const elements = trackElements(video);
    const elementByTrack = new Map();
    for (const element of elements) {
      if (element.track) elementByTrack.set(element.track, element);
    }

    const ordered = [];
    const seen = new Set();
    for (const track of [
      ...elements.map((element) => element.track),
      ...browserTrackList(video),
    ]) {
      if (!track || seen.has(track)) continue;
      seen.add(track);
      const kind = normalizeSpace(track.kind || "subtitles").toLowerCase();
      if (!CAPTION_KINDS.has(kind)) continue;

      const element = elementByTrack.get(track) ?? null;
      ordered.push({
        track,
        element,
        id: stableTrackId(track, element, ordered.length),
      });
    }
    return ordered;
  }

  function readCueCount(track) {
    try {
      return track.cues ? track.cues.length : null;
    } catch {
      return null;
    }
  }

  function describeTrack(candidate, isSelected = false) {
    const { track, element, id } = candidate;
    const readyState = element
      ? READY_STATE_NAMES[element.readyState] ?? "unknown"
      : readCueCount(track) === null
        ? "unknown"
        : "loaded";

    return {
      id,
      label: normalizeSpace(track.label || element?.label),
      language: normalizeSpace(track.language || element?.srclang),
      kind: normalizeSpace(track.kind || element?.kind || "subtitles"),
      mode: normalizeSpace(track.mode || "disabled"),
      readyState,
      cueCount: readCueCount(track),
      isSelected,
    };
  }

  function languageMatches(candidate, requestedLanguage) {
    const available = normalizeSpace(
      candidate.track.language || candidate.element?.srclang,
    ).toLowerCase();
    const requested = normalizeSpace(requestedLanguage).toLowerCase();
    if (!available || !requested) return false;
    return (
      available === requested ||
      available.split("-", 1)[0] === requested.split("-", 1)[0]
    );
  }

  function chooseTrack(candidates, request = {}) {
    const requestedId = normalizeSpace(request.trackId);
    if (requestedId) {
      return candidates.find((candidate) => candidate.id === requestedId) ?? null;
    }

    const requestedLanguage = normalizeSpace(request.language);
    if (requestedLanguage) {
      return (
        candidates.find((candidate) =>
          languageMatches(candidate, requestedLanguage),
        ) ?? null
      );
    }

    return (
      candidates.find((candidate) => candidate.id === selectedTrackId) ??
      candidates.find((candidate) => candidate.track.mode === "showing") ??
      candidates.find((candidate) => languageMatches(candidate, "en")) ??
      navigator.languages
        ?.map((language) =>
          candidates.find((candidate) =>
            languageMatches(candidate, language),
          ),
        )
        .find(Boolean) ??
      candidates[0] ??
      null
    );
  }

  function trackDocument(video, candidates, selected, cues = []) {
    const binding = mediaBinding(video);
    const language = normalizeSpace(
      selected.track.language || selected.element?.srclang,
    );
    const label = normalizeSpace(
      selected.track.label || selected.element?.label,
    );

    return {
      id: binding.mediaId
        ? `${binding.provider}:${binding.mediaId}:${selected.id}`
        : `${binding.pageUrl}#${selected.id}`,
      source: PAGE_TEXT_TRACK_SOURCE,
      title: binding.title,
      url: binding.pageUrl,
      mediaSrc: binding.mediaSrc,
      mediaBinding: binding,
      language: { code: language, label },
      selectedTrackId: selected.id,
      tracks: candidates.map((candidate) =>
        describeTrack(candidate, candidate.id === selected.id),
      ),
      cues,
      capturedAt: new Date().toISOString(),
    };
  }

  function manifestTrackDocument(
    video,
    candidates,
    selected,
    cues = [],
    source = YOUTUBE_PAGE_MANIFEST_SOURCE,
  ) {
    const binding = mediaBinding(video);

    return {
      id: binding.mediaId
        ? `${binding.provider}:${binding.mediaId}:${selected.id}`
        : `${binding.pageUrl}#${selected.id}`,
      source,
      title: binding.title,
      url: binding.pageUrl,
      mediaSrc: binding.mediaSrc,
      mediaBinding: binding,
      language: {
        code: selected.language,
        label: selected.label,
      },
      selectedTrackId: selected.id,
      tracks: candidates.map((candidate) =>
        describeManifestTrack(
          candidate,
          candidate.id === selected.id,
          candidate.id === selected.id ? cues.length : null,
        ),
      ),
      cues,
      capturedAt: new Date().toISOString(),
    };
  }

  function captionStateFor({
    status,
    reason,
    message = "",
    video,
    candidates,
    selected,
    cues = [],
  }) {
    const binding = mediaBinding(video);
    return {
      protocolVersion: 1,
      status,
      reason,
      message,
      document: selected
        ? trackDocument(video, candidates, selected, cues)
        : null,
      tracks: candidates.map((candidate) =>
        describeTrack(candidate, candidate.id === selected?.id),
      ),
      mediaBinding: binding,
    };
  }

  function manifestCaptionStateFor({
    status,
    reason,
    message = "",
    video,
    candidates,
    selected,
    cues = [],
    source = YOUTUBE_PAGE_MANIFEST_SOURCE,
  }) {
    return {
      protocolVersion: 1,
      status,
      reason,
      message,
      document: selected
        ? manifestTrackDocument(video, candidates, selected, cues, source)
        : null,
      tracks: candidates.map((candidate) =>
        describeManifestTrack(
          candidate,
          candidate.id === selected?.id,
          candidate.id === selected?.id && cues.length > 0 ? cues.length : null,
        ),
      ),
      mediaBinding: mediaBinding(video),
    };
  }

  function readCues(track) {
    let cueList;
    try {
      cueList = track.cues;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        cues: [],
      };
    }

    if (!cueList) {
      return { error: null, cues: [] };
    }

    const cues = Array.from(cueList)
      .map((cue, index) => {
        const startMs = Math.round(finiteNumber(cue.startTime, -1) * 1000);
        const endMs = Math.round(finiteNumber(cue.endTime, -1) * 1000);
        const text = cleanCueText(cue.text);
        if (startMs < 0 || endMs <= startMs || !text) return null;
        return {
          id: normalizeSpace(cue.id) || `page-cue-${index + 1}`,
          sourceIndex: index,
          startMs,
          endMs,
          text,
          format: "text-track",
        };
      })
      .filter(Boolean)
      .sort(
        (left, right) =>
          left.startMs - right.startMs ||
          left.endMs - right.endMs ||
          left.sourceIndex - right.sourceIndex,
      );

    return { error: null, cues };
  }

  function delay(milliseconds) {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }

  async function waitForTrack(
    candidate,
    { allowActivation = false } = {},
  ) {
    const preloaded = readCues(candidate.track);
    if (preloaded.error) {
      return {
        status: "error",
        reason: "cue-access-failed",
        message: preloaded.error,
        cues: [],
      };
    }
    if (preloaded.cues.length > 0) {
      return {
        status: "ready",
        reason: null,
        message: "",
        cues: preloaded.cues,
      };
    }
    if (candidate.track.mode === "disabled" && !allowActivation) {
      return {
        status: "unavailable",
        reason: "caption-user-action-required",
        message: "打开 Captiono 后即可读取当前页面字幕。",
        cues: [],
      };
    }

    try {
      if (candidate.track.mode === "disabled") {
        candidate.track.mode = "hidden";
      }
    } catch (error) {
      return {
        status: "error",
        reason: "track-activation-failed",
        message: error instanceof Error ? error.message : String(error),
        cues: [],
      };
    }

    const deadline = Date.now() + TRACK_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (candidate.element?.readyState === 3) {
        return {
          status: "error",
          reason: "track-load-error",
          message: "页面声明了字幕轨，但浏览器无法加载它。",
          cues: [],
        };
      }

      const snapshot = readCues(candidate.track);
      if (snapshot.error) {
        return {
          status: "error",
          reason: "cue-access-failed",
          message: snapshot.error,
          cues: [],
        };
      }
      if (
        snapshot.cues.length > 0 ||
        candidate.element?.readyState === 2 ||
        (!candidate.element && candidate.track.mode !== "disabled")
      ) {
        return {
          status: snapshot.cues.length > 0 ? "ready" : "empty",
          reason:
            snapshot.cues.length > 0 ? null : "selected-track-empty",
          message: "",
          cues: snapshot.cues,
        };
      }

      await delay(100);
    }

    return {
      status: "loading",
      reason: "track-still-loading",
      message: "字幕轨仍在由当前页面加载，可稍后刷新。",
      cues: [],
    };
  }

  async function refreshManifestCaptions(video, request, version) {
    let candidates = youtubeManifestTracks();
    if (candidates.length === 0) {
      candidates = await youtubePlayerManifestTracks();
      if (version !== refreshVersion) return captionState;
    }
    if (candidates.length === 0) return null;

    const selected = chooseManifestTrack(candidates, request);
    if (!selected) {
      const state = manifestCaptionStateFor({
        status: "error",
        reason: request.trackId ? "unknown-track" : "unknown-language",
        message: "当前视频没有对应的字幕语言或轨道。",
        video,
        candidates,
        selected: null,
      });
      setCaptionState(state);
      return state;
    }

    selectedTrackId = selected.id;
    const allowPlayerInteraction = request.allowPlayerInteraction !== false;
    setCaptionState(
      manifestCaptionStateFor({
        status: "loading",
        reason: "youtube-player-caption-loading",
        message: allowPlayerInteraction
          ? "正在自动读取 YouTube 字幕…"
          : "已发现 YouTube 字幕轨。",
        video,
        candidates,
        selected,
      }),
    );

    let captionResult;
    try {
      captionResult = await fetchManifestCues(selected, {
        allowPlayerInteraction,
      });
    } catch (error) {
      if (version !== refreshVersion) return captionState;
      const state = manifestCaptionStateFor({
        status: "error",
        reason:
          normalizeSpace(error?.reason) ||
          "youtube-player-caption-fetch-failed",
        message:
          error instanceof Error
            ? error.message
            : "当前 YouTube 播放器字幕读取失败。",
        video,
        candidates,
        selected,
      });
      setCaptionState(state);
      return state;
    }

    if (version !== refreshVersion) return captionState;
    const cues = captionResult.cues;

    const currentVideo = primaryVideo();
    const currentBinding = mediaBinding(currentVideo);
    const originalBinding = mediaBinding(video);
    if (
      currentVideo !== video ||
      currentBinding.pageUrl !== originalBinding.pageUrl ||
      currentBinding.title !== originalBinding.title
    ) {
      const state = manifestCaptionStateFor({
        status: "stale",
        reason: "media-binding-changed",
        message: "视频页面在读取字幕时发生了变化，请刷新字幕。",
        video: currentVideo,
        candidates: [],
        selected: null,
      });
      setCaptionState(state);
      return state;
    }

    const state = manifestCaptionStateFor({
      status: cues.length > 0 ? "ready" : "empty",
      reason: cues.length > 0 ? null : "selected-track-empty",
      message:
        captionResult.stateRestored === false
          ? "字幕已读取；检测到你同时操作了播放器，因此没有覆盖你的新字幕设置。"
          : "",
      video,
      candidates,
      selected,
      cues,
      source: captionResult.source,
    });
    setCaptionState(state);
    return state;
  }

  async function refreshBilibiliCaptions(video, request, version) {
    const identity = bilibiliPageIdentity();
    setCaptionState({
      protocolVersion: 1,
      status: "loading",
      reason: "bilibili-caption-loading",
      message: "正在自动读取 Bilibili 字幕…",
      document: null,
      tracks: captionState.mediaBinding?.provider === "bilibili"
        ? captionState.tracks
        : [],
      mediaBinding: mediaBinding(video),
    });

    const result = await sendRuntimeMessage({
      type: LOAD_BILIBILI_CAPTIONS,
      ...identity,
      trackId: request.trackId,
      language: request.language,
    });
    if (version !== refreshVersion) return captionState;

    const currentVideo = primaryVideo();
    const currentBinding = mediaBinding(currentVideo);
    if (
      currentVideo !== video ||
      currentBinding.provider !== "bilibili" ||
      currentBinding.mediaId !== identity.bindingMediaId ||
      (result?.mediaId && result.mediaId !== identity.mediaId)
    ) {
      const state = unavailableCaptionState(
        "media-binding-changed",
        "Bilibili 页面已经切换到其他视频，正在重新读取字幕。",
        currentVideo,
      );
      setCaptionState(state);
      scheduleCaptionRefresh(100);
      return state;
    }

    const tracks = Array.isArray(result?.tracks) ? result.tracks : [];
    if (!result?.ok) {
      const state = {
        protocolVersion: 1,
        status:
          result?.reason === "bilibili-no-caption-tracks"
            ? "unavailable"
            : "error",
        reason: normalizeSpace(result?.reason) || "bilibili-caption-fetch-failed",
        message:
          normalizeSpace(result?.message) || "当前 Bilibili 字幕读取失败。",
        document: null,
        tracks,
        mediaBinding: currentBinding,
      };
      setCaptionState(state);
      return state;
    }

    const selected =
      tracks.find((track) => track.id === result.selectedTrackId) ?? null;
    if (!selected) {
      const state = {
        protocolVersion: 1,
        status: "error",
        reason: "bilibili-caption-track-not-found",
        message: "Bilibili 返回了无效的字幕轨。",
        document: null,
        tracks,
        mediaBinding: currentBinding,
      };
      setCaptionState(state);
      return state;
    }

    selectedTrackId = selected.id;
    const state = manifestCaptionStateFor({
      status: result.cues?.length ? "ready" : "empty",
      reason: result.cues?.length ? null : "selected-track-empty",
      video,
      candidates: tracks,
      selected,
      cues: Array.isArray(result.cues) ? result.cues : [],
      source: BILIBILI_PAGE_SUBTITLE_SOURCE,
    });
    setCaptionState(state);
    return state;
  }

  async function refreshCaptions(request = {}) {
    const version = ++refreshVersion;
    const video = primaryVideo();
    if (!video) {
      const state = unavailableCaptionState(
        "no-video",
        "当前页面没有可连接的视频。",
        null,
      );
      setCaptionState(state);
      return state;
    }

    observeTracks(video);
    const candidates = discoverTracks(video);
    const platformProvider = currentPlatformProvider();
    const requestedPlatformTrack = platformProvider?.ownsTrack(request.trackId);
    if (candidates.length === 0 || requestedPlatformTrack) {
      const manifestState = await platformProvider?.refresh(video, request, version);
      if (manifestState) return manifestState;

      if (requestedPlatformTrack) {
        const state = captionStateFor({
          status: "error",
          reason: "unknown-track",
          message: "当前页面已不再提供所选字幕轨道，请刷新后重试。",
          video,
          candidates,
          selected: null,
        });
        setCaptionState(state);
        return state;
      }

      const state = unavailableCaptionState(
        "no-page-caption-track",
        "当前视频没有提供可读取的字幕。",
        video,
      );
      setCaptionState(state);
      return state;
    }

    const selected = chooseTrack(candidates, request);
    if (!selected) {
      const state = captionStateFor({
        status: "error",
        reason: request.trackId ? "unknown-track" : "unknown-language",
        message: "当前视频没有对应的字幕语言或轨道。",
        video,
        candidates,
        selected: null,
      });
      setCaptionState(state);
      return state;
    }

    selectedTrackId = selected.id;
    setCaptionState(
      captionStateFor({
        status: "loading",
        reason: "track-loading",
        message: "",
        video,
        candidates,
        selected,
      }),
    );

    const result = await waitForTrack(selected, {
      allowActivation: request.allowPlayerInteraction !== false,
    });
    if (version !== refreshVersion) return captionState;

    if (result.status !== "ready") {
      const manifestState = await platformProvider?.refresh(
        video,
        request.trackId
          ? {
              language: normalizeSpace(
                selected.track.language || selected.element?.srclang,
              ),
              allowPlayerInteraction:
                request.allowPlayerInteraction !== false,
            }
          : request,
        version,
      );
      if (manifestState) return manifestState;
    }

    const currentVideo = primaryVideo();
    const currentBinding = mediaBinding(currentVideo);
    const originalBinding = mediaBinding(video);
    if (
      currentVideo !== video ||
      currentBinding.pageUrl !== originalBinding.pageUrl ||
      currentBinding.title !== originalBinding.title
    ) {
      const state = captionStateFor({
        status: "stale",
        reason: "media-binding-changed",
        message: "视频页面在读取字幕时发生了变化，请刷新字幕。",
        video: currentVideo,
        candidates: [],
        selected: null,
      });
      setCaptionState(state);
      return state;
    }

    const state = captionStateFor({
      ...result,
      video,
      candidates: discoverTracks(video),
      selected,
    });
    setCaptionState(state);
    return state;
  }

  async function refreshCaptionsForUser(request = {}) {
    userCaptionRequestCount += 1;
    try {
      return await refreshCaptions({
        ...request,
        allowPlayerInteraction: true,
      });
    } finally {
      userCaptionRequestCount = Math.max(0, userCaptionRequestCount - 1);
      if (userCaptionRequestCount === 0 && pendingAutomaticRefresh) {
        pendingAutomaticRefresh = false;
        scheduleCaptionRefresh(pendingRefreshDelayMs);
      }
    }
  }

  function refreshCaptionsAutomatically() {
    if (automaticRefreshPromise) return automaticRefreshPromise;
    automaticRefreshPromise = refreshCaptions({
      allowPlayerInteraction: true,
    }).finally(() => {
      automaticRefreshPromise = null;
      if (pendingAutomaticRefresh && !bridgeStopped) {
        const delayMs = pendingRefreshDelayMs;
        pendingAutomaticRefresh = false;
        pendingRefreshDelayMs = 120;
        scheduleCaptionRefresh(delayMs);
      }
    });
    return automaticRefreshPromise;
  }

  function scheduleCaptionRefresh(delayMs = 120) {
    if (
      automaticRefreshPromise ||
      userCaptionRequestCount > 0
    ) {
      pendingAutomaticRefresh = true;
      pendingRefreshDelayMs = Math.min(pendingRefreshDelayMs, delayMs);
      return;
    }
    if (refreshTimerId !== null) {
      return;
    }
    refreshTimerId = setTimeout(() => {
      refreshTimerId = null;
      if (userCaptionRequestCount > 0) return;
      void refreshCaptionsAutomatically();
    }, delayMs);
  }

  function observeTracks(video) {
    const list = (() => {
      try {
        const propertyName = ["text", "Tracks"].join("");
        return Reflect.get(video, propertyName);
      } catch {
        return null;
      }
    })();

    if (
      list?.addEventListener &&
      !observedTrackLists.has(list)
    ) {
      observedTrackLists.add(list);
      list.addEventListener("addtrack", () => scheduleCaptionRefresh());
      list.addEventListener("removetrack", () => scheduleCaptionRefresh());
      list.addEventListener("change", () => scheduleCaptionRefresh());
    }

    for (const candidate of discoverTracks(video)) {
      if (
        candidate.track?.addEventListener &&
        !observedTracks.has(candidate.track)
      ) {
        observedTracks.add(candidate.track);
        candidate.track.addEventListener("cuechange", () => {
          const currentCueCount =
            captionState.document?.selectedTrackId === candidate.id
              ? captionState.document.cues.length
              : null;
          if (readCueCount(candidate.track) !== currentCueCount) {
            scheduleCaptionRefresh(250);
          }
        });
      }
    }
  }

  function publishToPageBridge(message) {
    for (const listener of pageBridgeListeners) {
      try {
        listener(message);
      } catch {
        // One UI subscriber must not interrupt caption acquisition.
      }
    }
  }

  function handlePageBridgeMessage(message) {
    switch (message?.type) {
      case "GET_MEDIA_STATE":
        return mediaState();
      case "SEEK_TO":
        return seekTo(message);
      case "TOGGLE_PLAY":
        return togglePlay();
      case "GET_CAPTION_STATE":
        return automaticRefreshPromise ?? captionState;
      case "REFRESH_CAPTIONS":
        return refreshCaptionsForUser();
      case "SELECT_CAPTION_TRACK":
        return refreshCaptionsForUser({
          trackId: message.trackId,
          language: message.language,
        });
      default:
        return undefined;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const response = handlePageBridgeMessage(message);
    if (response === undefined) return undefined;
    if (response && typeof response.then === "function") {
      void response.then(sendResponse);
      return true;
    }
    sendResponse(response);
    return undefined;
  });

  const pageBridge = {
    request(message) {
      return Promise.resolve(handlePageBridgeMessage(message));
    },
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      pageBridgeListeners.add(listener);
      return () => pageBridgeListeners.delete(listener);
    },
  };
  globalThis.__captionReviewPageBridge = pageBridge;

  function publishState() {
    const state = mediaState();
    publishToPageBridge({ type: "MEDIA_STATE", state });
    void sendRuntimeMessage({ type: "MEDIA_STATE", state });

    const nextMediaKey =
      state.provider && state.mediaId
        ? `${state.provider}\n${state.mediaId}`
        : `${state.url}\n${state.title}\n${state.mediaSrc}`;
    if (nextMediaKey !== previousMediaKey) {
      previousMediaKey = nextMediaKey;
      selectedTrackId = "";
      refreshVersion += 1;
      for (const controller of manifestRequestControllers) controller.abort();
      manifestRequestControllers.clear();
      setCaptionState({
        protocolVersion: 1,
        status: "loading",
        reason: "media-binding-changed",
        message: "",
        document: null,
        tracks: [],
        mediaBinding: state.mediaBinding,
      });
      scheduleCaptionRefresh();
    }
  }

  function containsCaptionNode(nodes) {
    return Array.from(nodes ?? []).some((node) => {
      const tagName = String(node?.tagName ?? "").toLowerCase();
      if (["script", "track", "video"].includes(tagName)) return true;
      return Boolean(node?.querySelector?.("script, track, video"));
    });
  }

  mutationObserver = new MutationObserver((mutations) => {
    const shouldRefresh = Array.from(mutations ?? []).some((mutation) => {
      if (mutation.type === "attributes") return true;
      return (
        containsCaptionNode(mutation.addedNodes) ||
        containsCaptionNode(mutation.removedNodes)
      );
    });
    if (shouldRefresh) scheduleCaptionRefresh(250);
  });
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["kind", "label", "src", "srclang"],
    childList: true,
    subtree: true,
  });

  intervalId = setInterval(publishState, PUBLISH_INTERVAL_MS);
  retryIntervalId = setInterval(() => {
    if (document.hidden) return;
    if (
      captionState.status === "loading" ||
      captionState.status === "empty" ||
      captionState.status === "unavailable"
    ) {
      scheduleCaptionRefresh();
    }
  }, TRACK_RETRY_INTERVAL_MS);

  const handleVisibilityChange = () => {
    if (!document.hidden) scheduleCaptionRefresh(40);
  };
  document.addEventListener?.("visibilitychange", handleVisibilityChange);

  function stopBridge() {
    if (bridgeStopped) return;
    bridgeStopped = true;
    if (intervalId !== null) clearInterval(intervalId);
    if (retryIntervalId !== null) clearInterval(retryIntervalId);
    if (refreshTimerId !== null) clearTimeout(refreshTimerId);
    for (const controller of manifestRequestControllers) controller.abort();
    manifestRequestControllers.clear();
    pageBridgeListeners.clear();
    mutationObserver?.disconnect();
    document.removeEventListener?.("visibilitychange", handleVisibilityChange);
    // Allow a freshly loaded extension build to install a new receiver in an
    // already-open video tab after the old extension context is invalidated.
    try {
      delete globalThis.__captionReviewMediaBridgeInstalled;
    } catch {
      globalThis.__captionReviewMediaBridgeInstalled = false;
    }
    if (globalThis.__captionReviewPageBridge === pageBridge) {
      try {
        delete globalThis.__captionReviewPageBridge;
      } catch {
        globalThis.__captionReviewPageBridge = null;
      }
    }
  }

  addEventListener("pagehide", stopBridge, { once: true });

  publishState();
  void refreshCaptionsAutomatically();
})();
