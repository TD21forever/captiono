export async function captureYouTubeCaptionUrl(request) {
  const CAPTURE_TIMEOUT_MS = 3200;
  const RELOAD_TIMEOUT_MS = 700;
  const MAX_DISCOVERED_TRACKS = 120;
  const MAX_TRACK_LABEL_LENGTH = 160;
  const MAX_TRACK_LANGUAGE_LENGTH = 24;
  const MAX_TRACK_VSS_ID_LENGTH = 80;

  function normalizeSpace(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function currentVideoId() {
    try {
      const url = new URL(location.href);
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

  function playerElement(videoId) {
    const player = document.getElementById("movie_player");
    if (
      !player ||
      typeof player.getOption !== "function" ||
      typeof player.setOption !== "function"
    ) {
      return null;
    }
    try {
      const playerVideoId = normalizeSpace(player.getVideoData?.()?.video_id);
      if (playerVideoId && playerVideoId !== videoId) return null;
    } catch {
      return null;
    }
    return player;
  }

  function trackKind(track) {
    return normalizeSpace(track?.kind).toLowerCase() === "asr"
      ? "asr"
      : "manual";
  }

  function trackVssId(track) {
    return normalizeSpace(track?.vss_id ?? track?.vssId).slice(
      0,
      MAX_TRACK_VSS_ID_LENGTH,
    );
  }

  function trackLanguage(track) {
    return normalizeSpace(track?.languageCode)
      .toLowerCase()
      .slice(0, MAX_TRACK_LANGUAGE_LENGTH);
  }

  function trackLabel(track) {
    return normalizeSpace(
      track?.displayName ||
        track?.languageName ||
        track?.name?.simpleText ||
        track?.name?.runs?.map((run) => run?.text ?? "").join("") ||
        trackLanguage(track) ||
        "Subtitles",
    ).slice(0, MAX_TRACK_LABEL_LENGTH);
  }

  function sameTrack(left, right) {
    const leftVssId = trackVssId(left);
    const rightVssId = trackVssId(right);
    if (leftVssId && rightVssId) return leftVssId === rightVssId;
    return (
      trackLanguage(left) === trackLanguage(right) &&
      trackKind(left) === trackKind(right)
    );
  }

  function publicTrack(track, index = 0) {
    const language = trackLanguage(track);
    const kind = trackKind(track);
    const vssId = trackVssId(track);
    return {
      id: vssId || `youtube-player-${language || "und"}-${kind}-${index + 1}`,
      label: trackLabel(track),
      language,
      kind,
      vssId,
    };
  }

  function requestedTrackDescriptor(value) {
    const language = normalizeSpace(value?.language).toLowerCase();
    const kind =
      normalizeSpace(value?.kind).toLowerCase() === "asr" ? "asr" : "";
    const vssId = normalizeSpace(value?.vssId);
    if (
      !/^[a-z0-9-]{2,24}$/i.test(language) ||
      !/^[a-z0-9._-]{1,80}$/i.test(vssId)
    ) {
      return null;
    }
    const label = normalizeSpace(value?.label || language);
    return {
      languageCode: language,
      languageName: label,
      displayName: label,
      kind,
      name: "",
      id: null,
      is_servable: false,
      is_default: false,
      is_translateable: true,
      vss_id: vssId,
    };
  }

  function playerResponseTracks(player) {
    try {
      const response = player.getPlayerResponse?.();
      const responseVideoId = normalizeSpace(response?.videoDetails?.videoId);
      if (responseVideoId && responseVideoId !== currentVideoId()) return [];
      const tracks =
        response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      return Array.isArray(tracks) ? tracks : [];
    } catch {
      return [];
    }
  }

  function playerTracks(player) {
    // The current player response is the authoritative source after YouTube
    // SPA navigation. `captions.tracklist` can contain matching descriptors
    // that are marked non-servable and omit the signed baseUrl entirely.
    // Keep response tracks first so de-duplication preserves the usable URL.
    let tracks = [...playerResponseTracks(player)];
    let optionTracks = [];
    let current = null;
    try {
      const trackList = player.getOption("captions", "tracklist");
      if (Array.isArray(trackList)) optionTracks = trackList;
    } catch {
      optionTracks = [];
    }
    for (const track of optionTracks) {
      if (!tracks.some((candidate) => sameTrack(candidate, track))) {
        tracks.push(track);
      }
    }
    try {
      current = player.getOption("captions", "track");
    } catch {
      current = null;
    }
    if (current && !tracks.some((track) => sameTrack(track, current))) {
      tracks = [...tracks, current];
    }
    return { current, tracks };
  }

  async function discoverPlayerTracks(player) {
    let snapshot = playerTracks(player);
    if (snapshot.tracks.length > 0) return snapshot;
    try {
      player.loadModule?.("captions");
      await new Promise((resolve) => setTimeout(resolve, 120));
      snapshot = playerTracks(player);
    } catch {
      // Some player builds expose the track list without loadModule.
    }
    return snapshot;
  }

  function chooseTrack(player, value) {
    const { current, tracks } = playerTracks(player);
    const requestedVssId = normalizeSpace(value?.vssId);
    const requestedLanguage = normalizeSpace(value?.language).toLowerCase();
    const requestedKind =
      normalizeSpace(value?.kind).toLowerCase() === "asr"
        ? "asr"
        : "manual";
    const selected =
      tracks.find(
        (track) => requestedVssId && trackVssId(track) === requestedVssId,
      ) ??
      tracks.find(
        (track) =>
          trackLanguage(track) === requestedLanguage &&
          trackKind(track) === requestedKind,
      ) ??
      tracks.find((track) => trackLanguage(track) === requestedLanguage) ??
      (current && trackLanguage(current) === requestedLanguage
        ? current
        : null) ??
      requestedTrackDescriptor(value);

    return {
      current,
      selected,
      tracks: tracks.map(publicTrack),
    };
  }

  function validCaptionUrl(value, videoId, track) {
    try {
      const url = new URL(value, location.href);
      if (
        url.protocol !== "https:" ||
        url.origin !== location.origin ||
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
      const expectedLanguage = trackLanguage(track);
      if (
        expectedLanguage &&
        url.searchParams.get("lang")?.toLowerCase() !== expectedLanguage
      ) {
        return "";
      }
      const expectedKind = trackKind(track);
      const actualKind =
        url.searchParams.get("kind") === "asr" ? "asr" : "manual";
      if (expectedKind !== actualKind) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function recentCaptionUrl(videoId, track, startedAt = 0) {
    let entries = [];
    try {
      entries = performance.getEntriesByType("resource");
    } catch {
      return "";
    }
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (Number(entry?.startTime) + 5 < startedAt) continue;
      const url = validCaptionUrl(entry?.name, videoId, track);
      if (url) return url;
    }
    return "";
  }

  function playerResponseCaptionUrl(videoId, track) {
    try {
      const url = new URL(track?.baseUrl, location.href);
      url.searchParams.set("fmt", "json3");
      return validCaptionUrl(url.href, videoId, track);
    } catch {
      return "";
    }
  }

  function observeCaptionRequest(videoId, track, trigger, timeoutMs) {
    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let observer = null;
      let settled = false;
      let timeoutId = null;

      const finish = (value, error = null) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        observer?.disconnect();
        if (error) reject(error);
        else resolve(value);
      };
      const inspect = (entries) => {
        for (const entry of entries) {
          if (Number(entry?.startTime) + 5 < startedAt) continue;
          const url = validCaptionUrl(entry?.name, videoId, track);
          if (url) {
            finish(url);
            return;
          }
        }
      };

      try {
        observer = new PerformanceObserver((list) => {
          inspect(list.getEntries());
        });
        observer.observe({ type: "resource", buffered: false });
      } catch {
        observer = null;
      }

      timeoutId = setTimeout(() => {
        finish(recentCaptionUrl(videoId, track, startedAt));
      }, timeoutMs);

      Promise.resolve()
        .then(trigger)
        .then(() => {
          const immediate = recentCaptionUrl(videoId, track, startedAt);
          if (immediate) finish(immediate);
        })
        .catch((error) => finish("", error));
    });
  }

  function subtitlesOn(player) {
    try {
      return Boolean(player.isSubtitlesOn?.());
    } catch {
      return false;
    }
  }

  function toggleSubtitles(player) {
    if (typeof player.toggleSubtitles !== "function") {
      throw new Error("player-caption-toggle-unavailable");
    }
    player.toggleSubtitles();
  }

  function currentPlayerTrack(player) {
    try {
      return player.getOption("captions", "track");
    } catch {
      return null;
    }
  }

  function restorePlayerState({
    player,
    videoId,
    originalTrack,
    targetTrack,
    wasOn,
  }) {
    if (
      currentVideoId() !== videoId ||
      document.getElementById("movie_player") !== player
    ) {
      return false;
    }

    const isOn = subtitlesOn(player);
    const current = currentPlayerTrack(player);
    if (!wasOn && !isOn) return true;
    if (!isOn || !sameTrack(current, targetTrack)) {
      return false;
    }

    if (!wasOn) {
      toggleSubtitles(player);
      return !subtitlesOn(player);
    }
    if (originalTrack && !sameTrack(originalTrack, targetTrack)) {
      player.setOption("captions", "track", originalTrack);
      return (
        subtitlesOn(player) &&
        sameTrack(currentPlayerTrack(player), originalTrack)
      );
    }
    return true;
  }

  async function captureByReload(player, videoId, track) {
    try {
      return await observeCaptionRequest(
        videoId,
        track,
        () => player.setOption("captions", "reload", true),
        RELOAD_TIMEOUT_MS,
      );
    } catch {
      return "";
    }
  }

  async function captureBySelectingTrack(player, videoId, track) {
    const wasOn = subtitlesOn(player);
    const originalTrack = currentPlayerTrack(player);
    let stateRestored = true;
    let url = "";
    try {
      url = await observeCaptionRequest(
        videoId,
        track,
        async () => {
          if (wasOn && sameTrack(originalTrack, track)) {
            toggleSubtitles(player);
            await new Promise((resolve) => setTimeout(resolve, 40));
            // Re-enable the learner's current captions immediately. The
            // resource observer can continue waiting without leaving the
            // native subtitle UI hidden for the full capture timeout.
            toggleSubtitles(player);
            player.setOption("captions", "track", track);
            return;
          }
          player.setOption("captions", "track", track);
        },
        CAPTURE_TIMEOUT_MS,
      );
    } finally {
      try {
        stateRestored = restorePlayerState({
          player,
          videoId,
          originalTrack,
          targetTrack: track,
          wasOn,
        });
      } catch {
        stateRestored = false;
      }
    }
    return { url, stateRestored };
  }

  function failure(error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason.includes("media-mismatch")) {
      return {
        ok: false,
        reason: "youtube-player-media-mismatch",
        message: "YouTube 页面已经切换到其他视频，请刷新字幕。",
      };
    }
    if (reason.includes("track-unavailable")) {
      return {
        ok: false,
        reason: "youtube-player-track-unavailable",
        message: "YouTube 播放器没有对应的字幕轨。",
      };
    }
    if (reason.includes("request-timeout")) {
      return {
        ok: false,
        reason: "youtube-player-caption-timeout",
        message: "YouTube 播放器没有及时生成字幕请求，请确认视频有字幕。",
      };
    }
    return {
      ok: false,
      reason: "youtube-player-caption-failed",
      message: "无法读取 YouTube 播放器生成的字幕，请稍后重新读取。",
    };
  }

  try {
    const videoId = normalizeSpace(request?.videoId);
    if (
      !/^[a-zA-Z0-9_-]{11}$/.test(videoId) ||
      currentVideoId() !== videoId
    ) {
      throw new Error("player-caption-media-mismatch");
    }

    const player = playerElement(videoId);
    if (!player) {
      return {
        ok: false,
        reason: "youtube-player-unavailable",
        message: "当前页面的 YouTube 播放器尚未就绪。",
      };
    }

    if (request?.discoverOnly) {
      const discovery = await discoverPlayerTracks(player);
      const tracks = discovery.tracks
        .slice(0, MAX_DISCOVERED_TRACKS)
        .map(publicTrack);
      return {
        ok: tracks.length > 0,
        source: "youtube-player-caption",
        videoId,
        tracks,
        selectedTrackId: discovery.current
          ? publicTrack(discovery.current).id
          : "",
        reason: tracks.length > 0
          ? null
          : "youtube-player-no-caption-tracks",
        message: tracks.length > 0
          ? ""
          : "当前 YouTube 播放器没有返回字幕轨。",
      };
    }

    const selection = chooseTrack(player, request);
    if (!selection.selected) {
      throw new Error("player-caption-track-unavailable");
    }
    const selected = publicTrack(selection.selected);

    const responseUrl = playerResponseCaptionUrl(
      videoId,
      selection.selected,
    );
    if (responseUrl) {
      return {
        ok: true,
        source: "youtube-player-caption",
        videoId,
        track: selected,
        tracks: selection.tracks,
        captionUrl: responseUrl,
        captureMode: "player-response",
        stateRestored: true,
      };
    }

    if (!request?.forceFresh) {
      const existing = recentCaptionUrl(videoId, selection.selected);
      if (existing) {
        return {
          ok: true,
          source: "youtube-player-caption",
          videoId,
          track: selected,
          tracks: selection.tracks,
          captionUrl: existing,
          captureMode: "existing",
          stateRestored: true,
        };
      }
    }

    const reloaded = await captureByReload(
      player,
      videoId,
      selection.selected,
    );
    if (reloaded) {
      return {
        ok: true,
        source: "youtube-player-caption",
        videoId,
        track: selected,
        tracks: selection.tracks,
        captionUrl: reloaded,
        captureMode: "reload",
        stateRestored: true,
      };
    }

    const selectedResult = await captureBySelectingTrack(
      player,
      videoId,
      selection.selected,
    );
    if (!selectedResult?.url) {
      throw new Error("player-caption-request-timeout");
    }
    if (currentVideoId() !== videoId) {
      throw new Error("player-caption-media-mismatch");
    }
    return {
      ok: true,
      source: "youtube-player-caption",
      videoId,
      track: selected,
      tracks: selection.tracks,
      captionUrl: selectedResult.url,
      captureMode: "player-selection",
      stateRestored: selectedResult.stateRestored,
    };
  } catch (error) {
    return failure(error);
  }
}
