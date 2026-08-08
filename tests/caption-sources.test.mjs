import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  BILIBILI_PAGE_SUBTITLE_SOURCE,
  CAPTION_STATUS,
  YOUTUBE_PAGE_MANIFEST_SOURCE,
  YOUTUBE_PLAYER_CAPTION_SOURCE,
  captionDocumentMatchesMedia,
  createCaptionState,
  normalizeCaptionCue,
  normalizeCaptionDocument,
  normalizeCaptionState,
} from "../src/lib/captionSources.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readyDocument(overrides = {}) {
  return {
    id: "talk#en",
    title: "How ideas spread",
    url: "https://www.ted.com/talks/example#player",
    mediaSrc: "https://media.example/talk.m3u8",
    selectedTrackId: "en",
    language: { code: "en", label: "English" },
    tracks: [
      {
        id: "en",
        label: "English",
        language: "en",
        kind: "subtitles",
        mode: "hidden",
        readyState: "loaded",
        cueCount: 1,
        isSelected: true,
      },
    ],
    cues: [
      {
        id: "cue-1",
        startMs: 1200,
        endMs: 3400,
        text: "Ideas <i>spread</i> through stories.",
      },
    ],
    ...overrides,
  };
}

test("normalizes page cues without inventing invalid timing or text", () => {
  assert.deepEqual(
    normalizeCaptionCue(
      {
        startMs: 1200.4,
        endMs: 3400.6,
        text: "  Ideas <i>spread</i>\nthrough stories. ",
      },
      2,
    ),
    {
      id: "page-cue-0003",
      sourceIndex: 2,
      startMs: 1200,
      endMs: 3401,
      text: "Ideas spread through stories.",
      format: "text-track",
    },
  );

  assert.equal(
    normalizeCaptionCue({ startMs: 1000, endMs: 900, text: "bad" }),
    null,
  );
  assert.equal(
    normalizeCaptionCue({ startMs: 1000, endMs: 2000, text: " " }),
    null,
  );
});

test("normalizes a page-provided caption document with source metadata", () => {
  const document = normalizeCaptionDocument(readyDocument());

  assert.equal(document.source, "page-text-track");
  assert.equal(document.url, "https://www.ted.com/talks/example");
  assert.equal(document.title, "How ideas spread");
  assert.equal(document.language.code, "en");
  assert.equal(document.selectedTrackId, "en");
  assert.equal(document.cues.length, 1);
  assert.equal(document.cues[0].format, "text-track");
  assert.equal(document.cues[0].text, "Ideas spread through stories.");
});

test("preserves page-manifest source and cue format", () => {
  const document = normalizeCaptionDocument(
    readyDocument({
      source: YOUTUBE_PAGE_MANIFEST_SOURCE,
      cues: [
        {
          id: "manifest-1",
          startMs: 1000,
          endMs: 2400,
          text: "A page-provided caption.",
          format: "youtube-json3",
        },
      ],
    }),
  );

  assert.equal(document.source, YOUTUBE_PAGE_MANIFEST_SOURCE);
  assert.equal(document.cues[0].format, "youtube-json3");
});

test("preserves YouTube player caption provenance", () => {
  const document = normalizeCaptionDocument(
    readyDocument({
      source: YOUTUBE_PLAYER_CAPTION_SOURCE,
      cues: [
        {
          id: "player-1",
          startMs: 1000,
          endMs: 2400,
          text: "A player-generated caption request.",
          format: "youtube-player-json3",
        },
      ],
    }),
  );

  assert.equal(document.source, YOUTUBE_PLAYER_CAPTION_SOURCE);
  assert.equal(document.cues[0].format, "youtube-player-json3");
});

test("preserves Bilibili page subtitle provenance", () => {
  const document = normalizeCaptionDocument(
    readyDocument({ source: BILIBILI_PAGE_SUBTITLE_SOURCE }),
  );
  assert.equal(document.source, BILIBILI_PAGE_SUBTITLE_SOURCE);
});

test("requires caption and media bindings to share URL, title, and media source", () => {
  const document = normalizeCaptionDocument(readyDocument());

  assert.equal(
    captionDocumentMatchesMedia(document, {
      url: "https://www.ted.com/talks/example#chapter-2",
      title: "How ideas spread",
      mediaSrc: "https://media.example/talk.m3u8",
    }),
    true,
  );
  assert.equal(
    captionDocumentMatchesMedia(document, {
      url: "https://www.ted.com/talks/another",
      title: "How ideas spread",
      mediaSrc: "https://media.example/talk.m3u8",
    }),
    false,
  );
  assert.equal(
    captionDocumentMatchesMedia(document, {
      url: "https://www.ted.com/talks/example",
      title: "A different talk",
      mediaSrc: "https://media.example/talk.m3u8",
    }),
    false,
  );
  assert.equal(
    captionDocumentMatchesMedia(document, {
      url: "https://www.ted.com/talks/example",
      title: "How ideas spread",
      mediaSrc: "https://media.example/another.m3u8",
    }),
    false,
  );
});

test("uses stable provider and media id across YouTube SPA query changes", () => {
  const document = normalizeCaptionDocument(
    readyDocument({
      mediaBinding: {
        pageUrl: "https://www.youtube.com/watch?v=abcdefghijk&t=20",
        title: "A title before navigation settles",
        mediaSrc: "blob:https://www.youtube.com/old",
        provider: "youtube",
        mediaId: "abcdefghijk",
      },
      title: "A title before navigation settles",
      url: "https://www.youtube.com/watch?v=abcdefghijk&t=20",
      mediaSrc: "blob:https://www.youtube.com/old",
    }),
  );

  assert.equal(
    captionDocumentMatchesMedia(document, {
      url: "https://www.youtube.com/watch?v=abcdefghijk&list=TED",
      title: "The final title",
      mediaSrc: "blob:https://www.youtube.com/new",
      provider: "youtube",
      mediaId: "abcdefghijk",
    }),
    true,
  );
  assert.equal(
    captionDocumentMatchesMedia(document, {
      url: "https://www.youtube.com/watch?v=lmnopqrstuv",
      title: "Another video",
      provider: "youtube",
      mediaId: "lmnopqrstuv",
    }),
    false,
  );
});

test("rejects stale documents and never reports an empty document as ready", () => {
  const ready = createCaptionState({
    status: CAPTION_STATUS.READY,
    document: readyDocument(),
  });
  assert.equal(ready.status, CAPTION_STATUS.READY);

  const stale = normalizeCaptionState(ready, {
    url: "https://www.ted.com/talks/another",
    title: "Another talk",
  });
  assert.equal(stale.status, CAPTION_STATUS.STALE);
  assert.equal(stale.reason, "media-binding-mismatch");
  assert.equal(stale.document, null);

  const empty = normalizeCaptionState({
    status: CAPTION_STATUS.READY,
    document: readyDocument({ cues: [] }),
  });
  assert.equal(empty.status, CAPTION_STATUS.EMPTY);
  assert.equal(empty.reason, "selected-track-empty");
});

test("extension exposes automatic YouTube and Bilibili caption bridges", async () => {
  const [contentScript, playerBridge, background, manifestText] =
    await Promise.all([
    readFile(path.join(root, "extension/content-script.js"), "utf8"),
    readFile(path.join(root, "extension/youtube-player-bridge.js"), "utf8"),
    readFile(path.join(root, "extension/background.js"), "utf8"),
    readFile(path.join(root, "extension/manifest.json"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  for (const command of [
    "GET_CAPTION_STATE",
    "REFRESH_CAPTIONS",
    "SELECT_CAPTION_TRACK",
  ]) {
    assert.match(contentScript, new RegExp(`"${command}"`));
    assert.doesNotMatch(background, new RegExp(`"${command}"`));
  }

  assert.match(contentScript, /type:\s*"CAPTION_STATE"/);
  assert.match(contentScript, /Reflect\.get\(video,\s*propertyName\)/);
  assert.match(contentScript, /track\.cues/);
  assert.match(contentScript, /ytInitialPlayerResponse/);
  assert.match(contentScript, /url\.origin !== currentUrl\.origin/);
  assert.match(contentScript, /url\.pathname !== "\/api\/timedtext"/);
  assert.match(contentScript, /fetchCaptionJson3\(candidate\.baseUrl\)/);
  assert.match(contentScript, /YOUTUBE_PLAYER_CAPTION_SOURCE/);
  assert.match(contentScript, /CAPTURE_YOUTUBE_PLAYER_CAPTION_URL/);
  assert.match(contentScript, /LOAD_BILIBILI_CAPTIONS/);
  assert.match(contentScript, /PLATFORM_PROVIDERS/);
  assert.match(contentScript, /allowPlayerInteraction/);
  assert.doesNotMatch(contentScript, /\bpostMessage\s*\(/);
  assert.doesNotMatch(contentScript, /["'`]https:\/\/[^"'`]*timedtext/);
  assert.doesNotMatch(contentScript, /\beval\s*\(/);
  assert.doesNotMatch(contentScript, /\bFunction\s*\(/);
  assert.doesNotMatch(contentScript, /\bXMLHttpRequest\b/);
  assert.match(playerBridge, /player\.getOption\("captions", "track"\)/);
  assert.match(playerBridge, /player\.toggleSubtitles\(\)/);
  assert.match(playerBridge, /new PerformanceObserver/);
  assert.match(playerBridge, /const MAX_DISCOVERED_TRACKS = 120/);
  assert.match(playerBridge, /\.slice\(0, MAX_DISCOVERED_TRACKS\)/);
  assert.match(playerBridge, /\.slice\(0, MAX_TRACK_LABEL_LENGTH\)/);
  assert.doesNotMatch(playerBridge, /\bfetch\s*\(/);
  assert.doesNotMatch(playerBridge, /\bpostMessage\s*\(/);
  assert.doesNotMatch(playerBridge, /\bchrome\./);
  assert.doesNotMatch(playerBridge, /\bXMLHttpRequest\b/);

  assert.deepEqual(manifest.permissions, [
    "scripting",
    "storage",
  ]);
  assert.ok(manifest.host_permissions.includes("https://api.bilibili.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.hdslb.com/*"));
  const matches = manifest.content_scripts.flatMap((entry) => entry.matches);
  assert.ok(!matches.some((match) => match.includes("ted.com")));
  assert.ok(matches.includes("https://*.youtube.com/*"));
  assert.ok(matches.includes("https://www.bilibili.com/*"));
  assert.ok(!matches.includes("<all_urls>"));
  assert.ok(
    manifest.content_scripts.every(
      (entry) => !entry.js?.includes("youtube-player-bridge.js"),
    ),
  );
  assert.deepEqual(manifest.content_scripts[0].js, [
    "content-script.js",
    "caption-review-ui.js",
  ]);
});

test("main-world bridge captures the signed request minted by the YouTube player", async () => {
  const source = await readFile(
    path.join(root, "extension/youtube-player-bridge.js"),
    "utf8",
  );
  const videoId = "abcdefghijk";
  const signedUrl =
    `https://www.youtube.com/api/timedtext?v=${videoId}` +
    "&lang=en&kind=asr&fmt=json3&signature=page-generated";
  const currentTrack = {
    languageCode: "en",
    languageName: "English (auto-generated)",
    displayName: "English (auto-generated)",
    kind: "asr",
    vss_id: "a.en",
  };
  const entries = [];
  const setCalls = [];
  const subtitleTransitions = [];
  let observerCallback = null;
  let subtitlesEnabled = true;
  let toggleCount = 0;
  const player = {
    getVideoData() {
      return { video_id: videoId };
    },
    getOption(namespace, option) {
      assert.equal(namespace, "captions");
      if (option === "tracklist") return [];
      if (option === "track") return currentTrack;
      return null;
    },
    setOption(namespace, option, track) {
      setCalls.push({ namespace, option, track });
      if (option === "reload") return;
      assert.equal(
        subtitlesEnabled,
        true,
        "the learner's current captions must be re-enabled before selection capture continues",
      );
      subtitlesEnabled = true;
      const entry = { name: signedUrl, startTime: 120 };
      entries.push(entry);
      setTimeout(() => {
        observerCallback?.({ getEntries: () => [entry] });
      }, 0);
    },
    isSubtitlesOn() {
      return subtitlesEnabled;
    },
    toggleSubtitles() {
      toggleCount += 1;
      subtitlesEnabled = !subtitlesEnabled;
      subtitleTransitions.push(subtitlesEnabled);
    },
  };
  const sandbox = {
    AbortController,
    URL,
    clearTimeout,
    document: {
      getElementById(id) {
        return id === "movie_player" ? player : null;
      },
    },
    location: {
      href: `https://www.youtube.com/watch?v=${videoId}`,
      origin: "https://www.youtube.com",
    },
    performance: {
      getEntriesByType(type) {
        return type === "resource" ? entries : [];
      },
      now() {
        return 100;
      },
    },
    PerformanceObserver: class {
      constructor(callback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    },
    setTimeout(callback, delay) {
      return setTimeout(callback, delay <= 100 ? 1 : 20);
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source.replace(/^export\s+/, ""), context, {
    filename: "extension/youtube-player-bridge.js",
  });
  const capture = vm.runInContext("captureYouTubeCaptionUrl", context);
  const discovery = await capture({ videoId, discoverOnly: true });
  assert.equal(discovery.ok, true);
  assert.equal(discovery.source, YOUTUBE_PLAYER_CAPTION_SOURCE);
  assert.equal(discovery.videoId, videoId);
  assert.equal(discovery.tracks.length, 1);
  assert.equal(discovery.tracks[0].language, "en");
  assert.equal(discovery.tracks[0].vssId, "a.en");

  const result = await capture({
    videoId,
    language: "en",
    label: "English (auto-generated)",
    kind: "asr",
    vssId: "a.en",
    forceFresh: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, YOUTUBE_PLAYER_CAPTION_SOURCE);
  assert.equal(result.videoId, videoId);
  assert.equal(result.track.language, "en");
  assert.equal(result.track.kind, "asr");
  assert.equal(result.captionUrl, signedUrl);
  assert.equal(result.captureMode, "player-selection");
  assert.equal(result.stateRestored, true);
  assert.equal("cues" in result, false);
  assert.equal(setCalls.length, 2);
  assert.equal(setCalls[0].option, "reload");
  assert.equal(setCalls[1].option, "track");
  assert.equal(toggleCount, 2);
  assert.deepEqual(subtitleTransitions, [false, true]);
  assert.equal(subtitlesEnabled, true);
});

test("main-world bridge reads current player response tracks after YouTube SPA navigation", async () => {
  const source = await readFile(
    path.join(root, "extension/youtube-player-bridge.js"),
    "utf8",
  );
  const videoId = "abcdefghijk";
  const baseUrl =
    `https://www.youtube.com/api/timedtext?v=${videoId}` +
    "&lang=en&expire=9999999999&signature=current-player-response";
  const responseTrack = {
    baseUrl,
    languageCode: "en",
    name: { simpleText: "English" },
    vssId: ".en",
  };
  const nonServableOptionTrack = {
    languageCode: "en",
    languageName: "English",
    displayName: "English",
    is_servable: false,
    vss_id: ".en",
  };
  const setCalls = [];
  const player = {
    getVideoData() {
      return { video_id: videoId };
    },
    getPlayerResponse() {
      return {
        videoDetails: { videoId },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [responseTrack],
          },
        },
      };
    },
    getOption(namespace, option) {
      assert.equal(namespace, "captions");
      if (option === "tracklist") return [nonServableOptionTrack];
      if (option === "track") return null;
      return null;
    },
    setOption(...args) {
      setCalls.push(args);
    },
    isSubtitlesOn() {
      return false;
    },
    toggleSubtitles() {},
  };
  const sandbox = {
    URL,
    clearTimeout,
    document: {
      getElementById(id) {
        return id === "movie_player" ? player : null;
      },
    },
    location: {
      href: `https://www.youtube.com/watch?v=${videoId}`,
      origin: "https://www.youtube.com",
    },
    performance: {
      getEntriesByType() {
        return [];
      },
      now() {
        return 100;
      },
    },
    setTimeout,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source.replace(/^export\s+/, ""), context, {
    filename: "extension/youtube-player-bridge.js",
  });
  const capture = vm.runInContext("captureYouTubeCaptionUrl", context);

  const discovery = await capture({ videoId, discoverOnly: true });
  assert.equal(discovery.ok, true);
  assert.equal(discovery.tracks.length, 1);
  assert.equal(discovery.tracks[0].language, "en");
  assert.equal(discovery.tracks[0].label, "English");
  assert.equal(discovery.tracks[0].vssId, ".en");

  const result = await capture({
    videoId,
    language: "en",
    label: "English",
    kind: "manual",
    vssId: ".en",
    forceFresh: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.captureMode, "player-response");
  const capturedUrl = new URL(result.captionUrl);
  assert.equal(capturedUrl.searchParams.get("v"), videoId);
  assert.equal(capturedUrl.searchParams.get("lang"), "en");
  assert.equal(capturedUrl.searchParams.get("fmt"), "json3");
  assert.equal(setCalls.length, 0, "direct response tracks must not mutate the player");
});

test("page bridge returns real TextTrack cues bound to the current video", async () => {
  const source = await readFile(
    path.join(root, "extension/content-script.js"),
    "utf8",
  );
  const cue = {
    id: "intro",
    startTime: 1.25,
    endTime: 3.75,
    text: "A <i>real</i> page cue.",
  };
  const track = {
    id: "english",
    kind: "subtitles",
    label: "English",
    language: "en",
    mode: "disabled",
    cues: [cue],
    addEventListener() {},
  };
  const trackElement = {
    id: "english",
    kind: "subtitles",
    label: "English",
    srclang: "en",
    readyState: 2,
    track,
  };
  const video = {
    currentSrc: "https://media.example/talk.mp4",
    currentTime: 2,
    duration: 600,
    paused: true,
    readyState: 4,
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 1280, bottom: 720 };
    },
    querySelectorAll(selector) {
      return selector === "track" ? [trackElement] : [];
    },
    play: async () => {},
    pause() {},
  };
  video[["text", "Tracks"].join("")] = [track];

  let messageListener = null;
  const published = [];
  const sandbox = {
    URL,
    clearInterval() {},
    clearTimeout,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        sendMessage(message) {
          published.push(message);
          return Promise.resolve();
        },
      },
    },
    document: {
      documentElement: {},
      title: "How ideas spread",
      querySelectorAll(selector) {
        return selector === "video" ? [video] : [];
      },
    },
    fetch() {
      throw new Error("standard TextTrack must not use the manifest fallback");
    },
    innerHeight: 720,
    innerWidth: 1280,
    location: { href: "https://www.youtube.com/watch?v=text-track-test#player" },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    navigator: { languages: ["zh-CN", "en-US"] },
    setInterval() {
      return 1;
    },
    setTimeout,
    addEventListener() {},
  };

  vm.runInNewContext(source, sandbox, {
    filename: "extension/content-script.js",
  });
  assert.equal(typeof messageListener, "function");

  const response = await new Promise((resolve) => {
    const keepChannelOpen = messageListener(
      { type: "GET_CAPTION_STATE" },
      {},
      resolve,
    );
    assert.equal(keepChannelOpen, true);
  });

  assert.equal(response.status, "ready");
  assert.equal(
    response.document.url,
    "https://www.youtube.com/watch?v=text-track-test",
  );
  assert.equal(response.document.title, "How ideas spread");
  assert.equal(
    response.document.mediaSrc,
    "https://media.example/talk.mp4",
  );
  assert.equal(response.document.language.code, "en");
  assert.deepEqual(
    JSON.parse(JSON.stringify(response.document.cues)),
    [
      {
        id: "intro",
        sourceIndex: 0,
        startMs: 1250,
        endMs: 3750,
        text: "A real page cue.",
        format: "text-track",
      },
    ],
  );
  assert.equal(
    track.mode,
    "disabled",
    "preloaded cues should be read without mutating the page track",
  );
  assert.ok(
    !published.some((message) => message.type === "CAPTION_STATE"),
    "high-frequency caption state must stay on the in-page bridge",
  );
});

test("refreshes once when a supported page receives or replaces its primary video", async () => {
  const source = await readFile(
    path.join(root, "extension/content-script.js"),
    "utf8",
  );

  async function runScenario({ href, platform }) {
    let intervalCallback = null;
    let nextTimerId = 1;
    const timers = new Map();
    const observedTargets = [];
    const videos = [];
    let youtubePlayer = null;

    const settle = async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    };
    const drainTimers = async () => {
      while (timers.size > 0) {
        const callbacks = Array.from(timers.values());
        timers.clear();
        callbacks.forEach((callback) => callback());
        await settle();
      }
    };

    function createVideo(label, player = null) {
      const cue = {
        id: `cue-${label}`,
        startTime: 1,
        endTime: 3,
        text: `Caption ${label}`,
      };
      let mode = "disabled";
      const track = {
        id: `track-${label}`,
        kind: "subtitles",
        label: "English",
        language: "en",
        cues: [cue],
        addEventListener() {},
      };
      Object.defineProperty(track, "mode", {
        get() {
          return mode;
        },
        set(value) {
          mode = value;
        },
      });
      const trackElement = {
        id: `track-${label}`,
        kind: "subtitles",
        label: "English",
        srclang: "en",
        readyState: 2,
        track,
      };
      const video = {
        tagName: "VIDEO",
        currentSrc: `https://media.example/${label}.mp4`,
        currentTime: 1.5,
        duration: 60,
        paused: true,
        readyState: 4,
        closest(selector) {
          if (selector === "video") return video;
          if (selector === "#movie_player") return player;
          return null;
        },
        getBoundingClientRect() {
          return { left: 0, top: 0, right: 1280, bottom: 720 };
        },
        matches(selector) {
          return selector.includes("video");
        },
        querySelectorAll(selector) {
          return selector === "track" ? [trackElement] : [];
        },
        play: async () => {},
        pause() {},
      };
      video[["text", "Tracks"].join("")] = [track];
      return { video };
    }

    const sandbox = {
      URL,
      clearInterval() {},
      clearTimeout(timerId) {
        timers.delete(timerId);
      },
      chrome: {
        runtime: {
          onMessage: {
            addListener() {},
            removeListener() {},
          },
          sendMessage() {
            throw new Error("a preloaded TextTrack must not call the worker");
          },
        },
      },
      document: {
        documentElement: {},
        hidden: false,
        title: "Late player",
        addEventListener() {},
        removeEventListener() {},
        querySelector(selector) {
          return selector.includes("movie_player") ? youtubePlayer : null;
        },
        querySelectorAll(selector) {
          return selector.includes("video") ? videos : [];
        },
      },
      fetch() {
        throw new Error("a preloaded TextTrack must not use a manifest");
      },
      innerHeight: 720,
      innerWidth: 1280,
      location: { href },
      MutationObserver: class {
        disconnect() {}
        observe(target, options) {
          observedTargets.push({ options, target });
        }
      },
      navigator: { languages: ["en-US"] },
      setInterval(callback) {
        intervalCallback = callback;
        return 1;
      },
      setTimeout(callback) {
        const timerId = nextTimerId;
        nextTimerId += 1;
        timers.set(timerId, callback);
        return timerId;
      },
      addEventListener() {},
      removeEventListener() {},
    };

    vm.runInNewContext(source, sandbox, {
      filename: "extension/content-script.js",
    });
    assert.equal(typeof intervalCallback, "function");

    // Exhaust the one initial media-key refresh while the platform player is
    // still absent. No retry loop should remain after this point.
    await settle();
    await drainTimers();
    assert.equal(timers.size, 0);
    const readyStates = [];
    sandbox.__captionReviewPageBridge.subscribe((message) => {
      if (message?.type === "CAPTION_STATE" && message.state?.status === "ready") {
        readyStates.push(message.state);
      }
    });

    const firstPlayer = platform === "youtube" ? { id: "player-one" } : null;
    const first = createVideo(`${platform}-one`, firstPlayer);
    youtubePlayer = firstPlayer;
    videos.splice(0, videos.length, first.video);
    intervalCallback();
    assert.equal(
      timers.size,
      1,
      `${platform} must schedule one refresh when its video appears`,
    );
    await drainTimers();
    const firstState = await sandbox.__captionReviewPageBridge.request({
      type: "GET_CAPTION_STATE",
    });
    assert.equal(firstState.status, "ready");
    assert.equal(firstState.document.cues[0].text, `Caption ${platform}-one`);
    assert.equal(readyStates.length, 1);

    intervalCallback();
    assert.equal(
      timers.size,
      0,
      `${platform} must not poll captions again for the same video instance`,
    );

    const secondPlayer = platform === "youtube" ? { id: "player-two" } : null;
    const second = createVideo(`${platform}-two`, secondPlayer);
    youtubePlayer = secondPlayer;
    videos.splice(0, videos.length, second.video);
    intervalCallback();
    assert.equal(
      timers.size,
      1,
      `${platform} must schedule one refresh when the player element is replaced`,
    );
    await drainTimers();
    const secondState = await sandbox.__captionReviewPageBridge.request({
      type: "GET_CAPTION_STATE",
    });
    assert.equal(secondState.status, "ready");
    assert.equal(secondState.document.cues[0].text, `Caption ${platform}-two`);
    assert.equal(readyStates.length, 2);

    if (platform === "youtube") {
      assert.ok(
        observedTargets.some(
          ({ options, target }) => target === firstPlayer && options.childList,
        ),
        "the first YouTube player must receive the scoped structure observer",
      );
      assert.ok(
        observedTargets.some(
          ({ options, target }) => target === secondPlayer && options.childList,
        ),
        "a replacement YouTube player must receive the scoped structure observer",
      );
      assert.ok(
        observedTargets.some(
          ({ options, target }) => target === second.video && options.attributes,
        ),
        "the replacement YouTube video must receive the attribute observer",
      );
    }
  }

  await runScenario({
    href: "https://www.youtube.com/watch?v=abcdefghijk",
    platform: "youtube",
  });
  await runScenario({
    href: "https://www.bilibili.com/video/BV1xx411c7mD",
    platform: "bilibili",
  });
});

test("isolated bridge discovers player captions when the inline manifest is missing", async () => {
  const source = await readFile(
    path.join(root, "extension/content-script.js"),
    "utf8",
  );
  const videoId = "abcdefghijk";
  const signedUrl =
    `https://www.youtube.com/api/timedtext?v=${videoId}` +
    "&lang=en&kind=asr&fmt=json3&signature=page-generated";
  const video = {
    currentSrc: `blob:https://www.youtube.com/${videoId}`,
    currentTime: 8,
    duration: 911,
    paused: true,
    readyState: 4,
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 1280, bottom: 720 };
    },
    querySelectorAll() {
      return [];
    },
    play: async () => {},
    pause() {},
  };
  video[["text", "Tracks"].join("")] = [];

  let runtimeMessageListener = null;
  const discoveryRequests = [];
  const captureRequests = [];
  const fetchCalls = [];
  const published = [];
  const sandbox = {
    AbortController,
    URL,
    clearInterval() {},
    clearTimeout,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeMessageListener = listener;
          },
        },
        sendMessage(message) {
          if (message.type === "CAPTURE_YOUTUBE_PLAYER_CAPTION_URL") {
            if (message.discoverOnly) {
              discoveryRequests.push(message);
              return Promise.resolve({
                ok: true,
                source: YOUTUBE_PLAYER_CAPTION_SOURCE,
                videoId,
                selectedTrackId: "",
                tracks: [
                  {
                    id: "a.en",
                    language: "en",
                    label: "English (auto-generated)",
                    kind: "asr",
                    vssId: "a.en",
                  },
                ],
              });
            }
            captureRequests.push(message);
            return Promise.resolve({
              ok: true,
              source: YOUTUBE_PLAYER_CAPTION_SOURCE,
              videoId,
              track: {
                language: "en",
                label: "English (auto-generated)",
                kind: "asr",
                vssId: "a.en",
              },
              captionUrl: signedUrl,
              captureMode: "player-selection",
              stateRestored: true,
            });
          }
          published.push(message);
          return Promise.resolve();
        },
      },
    },
    document: {
      documentElement: {},
      scripts: [],
      title: "A generic YouTube video",
      querySelectorAll(selector) {
        return selector === "video" ? [video] : [];
      },
    },
    async fetch(url, init) {
      fetchCalls.push({ url, init });
      assert.equal(url, signedUrl);
      return {
        headers: { get: () => null },
        ok: true,
        status: 200,
        url: signedUrl,
        async text() {
          return JSON.stringify({
            events: [
              {
                tStartMs: 4000,
                dDurationMs: 2200,
                segs: [{ utf8: "A player-minted caption." }],
              },
            ],
          });
        },
      };
    },
    innerHeight: 720,
    innerWidth: 1280,
    location: {
      href: `https://www.youtube.com/watch?v=${videoId}`,
      origin: "https://www.youtube.com",
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    navigator: { languages: ["zh-CN", "en-US"] },
    setInterval() {
      return 1;
    },
    setTimeout,
    addEventListener() {},
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, {
    filename: "extension/content-script.js",
  });

  const response = await new Promise((resolve) => {
    const keepChannelOpen = runtimeMessageListener(
      { type: "GET_CAPTION_STATE" },
      {},
      resolve,
    );
    assert.equal(keepChannelOpen, true);
  });

  assert.equal(response.status, "ready");
  assert.equal(response.document.source, YOUTUBE_PLAYER_CAPTION_SOURCE);
  assert.equal(response.document.language.code, "en");
  assert.equal(response.document.cues.length, 1);
  assert.equal(response.document.cues[0].text, "A player-minted caption.");
  assert.ok(
    captureRequests.length > 0,
    "page load should automatically trigger the player bridge",
  );
  assert.ok(discoveryRequests.length >= 1);
  assert.ok(
    discoveryRequests.every(
      (message) =>
        message.type === "CAPTURE_YOUTUBE_PLAYER_CAPTION_URL" &&
        message.videoId === videoId &&
        message.discoverOnly === true,
    ),
  );
  assert.ok(captureRequests.length >= 1);
  assert.ok(
    captureRequests.every(
      (message) =>
        message.type === "CAPTURE_YOUTUBE_PLAYER_CAPTION_URL" &&
        message.videoId === videoId &&
        message.vssId === "a.en",
    ),
  );
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].init.credentials, "omit");
  assert.equal(fetchCalls[0].init.redirect, "error");
  assert.ok(
    !published.some((message) => message.type === "CAPTION_STATE"),
    "automatic refresh must not wake the service worker with UI state",
  );
});

test("falls back from an empty TextTrack to a same-origin YouTube page manifest", async () => {
  const source = await readFile(
    path.join(root, "extension/content-script.js"),
    "utf8",
  );
  const videoId = "abcdefghijk";
  const captionUrl =
    `https://www.youtube.com/api/timedtext?v=${videoId}` +
    "&lang=en&expire=9999999999";
  const playerResponse = {
    videoDetails: { videoId },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: captionUrl,
            kind: "asr",
            languageCode: "en",
            name: { simpleText: "English (auto-generated)" },
            vssId: ".en",
          },
        ],
      },
    },
  };
  const emptyTrack = {
    id: "empty-english",
    kind: "subtitles",
    label: "English",
    language: "en",
    mode: "disabled",
    cues: [],
    addEventListener() {},
  };
  const emptyTrackElement = {
    id: "empty-english",
    kind: "subtitles",
    label: "English",
    srclang: "en",
    readyState: 2,
    track: emptyTrack,
  };
  const video = {
    currentSrc: `blob:https://www.youtube.com/${videoId}`,
    currentTime: 8,
    duration: 911,
    paused: true,
    readyState: 4,
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 1280, bottom: 720 };
    },
    querySelectorAll(selector) {
      return selector === "track" ? [emptyTrackElement] : [];
    },
    play: async () => {},
    pause() {},
  };
  video[["text", "Tracks"].join("")] = [emptyTrack];

  let messageListener = null;
  const fetchCalls = [];
  const published = [];
  const sandbox = {
    AbortController,
    URL,
    clearInterval() {},
    clearTimeout() {},
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        sendMessage(message) {
          published.push(message);
          return Promise.resolve();
        },
      },
    },
    document: {
      documentElement: {},
      scripts: [
        { text: "var unrelated = {};" },
        {
          text: `var ytInitialPlayerResponse = ${JSON.stringify(
            playerResponse,
          )};`,
        },
      ],
      title: "A real YouTube TED talk",
      querySelectorAll(selector) {
        return selector === "video" ? [video] : [];
      },
    },
    async fetch(url, init) {
      fetchCalls.push({ init, url });
      return {
        headers: { get: () => null },
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            events: [
              {
                tStartMs: 4000,
                dDurationMs: 2200,
                segs: [{ utf8: "I'm " }, { utf8: "going to start." }],
              },
              {
                tStartMs: 6200,
                segs: [{ utf8: "With a story." }],
              },
            ],
          });
        },
      };
    },
    innerHeight: 720,
    innerWidth: 1280,
    location: {
      href: `https://www.youtube.com/watch?v=${videoId}`,
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    navigator: { languages: ["zh-CN", "en-US"] },
    setInterval() {
      return 1;
    },
    setTimeout() {
      return 1;
    },
    addEventListener() {},
  };

  vm.runInNewContext(source, sandbox, {
    filename: "extension/content-script.js",
  });

  const response = await new Promise((resolve) => {
    const keepChannelOpen = messageListener(
      { type: "GET_CAPTION_STATE" },
      {},
      resolve,
    );
    assert.equal(keepChannelOpen, true);
  });

  assert.equal(response.status, "ready");
  assert.equal(response.document.source, "youtube-page-manifest");
  assert.equal(response.document.language.code, "en");
  assert.equal(response.document.cues.length, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(response.document.cues)),
    [
      {
        id: "page-manifest-cue-1",
        sourceIndex: 0,
        startMs: 4000,
        text: "I'm going to start.",
        format: "youtube-json3",
        endMs: 6200,
      },
      {
        id: "page-manifest-cue-2",
        sourceIndex: 1,
        startMs: 6200,
        text: "With a story.",
        format: "youtube-json3",
        endMs: 8200,
      },
    ],
  );
  assert.equal(fetchCalls.length, 1);
  const fetchedUrl = new URL(fetchCalls[0].url);
  assert.equal(fetchedUrl.origin, "https://www.youtube.com");
  assert.equal(fetchedUrl.pathname, "/api/timedtext");
  assert.equal(fetchedUrl.searchParams.get("v"), videoId);
  assert.equal(fetchedUrl.searchParams.get("fmt"), "json3");
  assert.equal(fetchCalls[0].init.credentials, "omit");
  assert.equal(fetchCalls[0].init.redirect, "error");
  assert.equal(
    emptyTrack.mode,
    "disabled",
    "Captiono must restore a host TextTrack after probing it",
  );
  assert.ok(
    !published.some((message) => message.type === "CAPTION_STATE"),
    "loading transitions must stay on the in-page bridge",
  );
});
