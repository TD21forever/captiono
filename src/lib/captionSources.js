export const CAPTION_PROTOCOL_VERSION = 1;
export const PAGE_TEXT_TRACK_SOURCE = "page-text-track";
export const YOUTUBE_PAGE_MANIFEST_SOURCE = "youtube-page-manifest";
export const YOUTUBE_PLAYER_CAPTION_SOURCE = "youtube-player-caption";
export const BILIBILI_PAGE_SUBTITLE_SOURCE = "bilibili-page-subtitle";

export const CAPTION_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  READY: "ready",
  EMPTY: "empty",
  UNAVAILABLE: "unavailable",
  ERROR: "error",
  STALE: "stale",
});

export const CAPTION_COMMAND = Object.freeze({
  GET: "GET_CAPTION_STATE",
  REFRESH: "REFRESH_CAPTIONS",
  SELECT_TRACK: "SELECT_CAPTION_TRACK",
});

const VALID_STATUSES = new Set(Object.values(CAPTION_STATUS));

function cleanText(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePageUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  try {
    const url = new URL(raw);
    url.hash = "";
    return url.href;
  } catch {
    return raw.split("#", 1)[0];
  }
}

export function normalizeMediaBinding(value = {}) {
  return {
    pageUrl: normalizePageUrl(value.pageUrl ?? value.url),
    title: String(value.title ?? "").replace(/\s+/g, " ").trim(),
    mediaSrc: normalizePageUrl(value.mediaSrc ?? value.currentSrc),
    provider: String(value.provider ?? "").trim(),
    mediaId: String(value.mediaId ?? "").trim(),
  };
}

export function mediaBindingKey(value) {
  const binding = normalizeMediaBinding(value);
  if (binding.provider && binding.mediaId) {
    return `${binding.provider}\n${binding.mediaId}`;
  }
  if (!binding.pageUrl || !binding.title) return "";
  return `${binding.pageUrl}\n${binding.title}`;
}

export function captionDocumentMatchesMedia(document, media) {
  const documentBinding = normalizeMediaBinding(
    document?.mediaBinding ?? document,
  );
  const mediaBinding = normalizeMediaBinding(media);
  if (
    documentBinding.provider &&
    documentBinding.mediaId &&
    mediaBinding.provider &&
    mediaBinding.mediaId
  ) {
    return (
      documentBinding.provider === mediaBinding.provider &&
      documentBinding.mediaId === mediaBinding.mediaId
    );
  }

  return Boolean(
    documentBinding.pageUrl &&
      documentBinding.title &&
      documentBinding.pageUrl === mediaBinding.pageUrl &&
      documentBinding.title === mediaBinding.title &&
      (!documentBinding.mediaSrc ||
        !mediaBinding.mediaSrc ||
        documentBinding.mediaSrc === mediaBinding.mediaSrc),
  );
}

export function normalizeCaptionCue(cue, index = 0) {
  const startMs = Number(cue?.startMs);
  const endMs = Number(cue?.endMs);
  const text = cleanText(cue?.text);

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    !text
  ) {
    return null;
  }

  return {
    id: String(cue?.id || `page-cue-${String(index + 1).padStart(4, "0")}`),
    sourceIndex: Number.isInteger(cue?.sourceIndex)
      ? cue.sourceIndex
      : index,
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    text,
    format: String(cue?.format || "text-track"),
  };
}

function normalizeTrack(track, index) {
  const language = String(track?.language ?? "").trim();
  return {
    id: String(track?.id || `page-track-${index + 1}`),
    label: String(track?.label ?? "").trim(),
    language,
    kind: String(track?.kind ?? "subtitles").trim(),
    mode: String(track?.mode ?? "disabled").trim(),
    readyState: String(track?.readyState ?? "unknown").trim(),
    cueCount: Number.isInteger(track?.cueCount) ? track.cueCount : null,
    isSelected: Boolean(track?.isSelected),
  };
}

export function normalizeCaptionDocument(document) {
  if (!document || typeof document !== "object") return null;

  const mediaBinding = normalizeMediaBinding(
    document.mediaBinding ?? document,
  );
  if (!mediaBinding.pageUrl || !mediaBinding.title) return null;

  const tracks = Array.isArray(document.tracks)
    ? document.tracks.map(normalizeTrack)
    : [];
  const cues = Array.isArray(document.cues)
    ? document.cues
        .map(normalizeCaptionCue)
        .filter(Boolean)
        .sort(
          (left, right) =>
            left.startMs - right.startMs ||
            left.endMs - right.endMs ||
            left.sourceIndex - right.sourceIndex,
        )
    : [];

  const selectedTrackId = String(document.selectedTrackId ?? "");
  const selectedTrack =
    tracks.find((track) => track.id === selectedTrackId) ?? null;

  return {
    id: String(
      document.id ||
        `${mediaBinding.pageUrl}#${selectedTrackId || "page-captions"}`,
    ),
    source:
      document.source === YOUTUBE_PAGE_MANIFEST_SOURCE ||
      document.source === "page-caption-manifest"
        ? YOUTUBE_PAGE_MANIFEST_SOURCE
        : document.source === YOUTUBE_PLAYER_CAPTION_SOURCE
          ? YOUTUBE_PLAYER_CAPTION_SOURCE
          : document.source === BILIBILI_PAGE_SUBTITLE_SOURCE
            ? BILIBILI_PAGE_SUBTITLE_SOURCE
        : PAGE_TEXT_TRACK_SOURCE,
    title: mediaBinding.title,
    url: mediaBinding.pageUrl,
    mediaSrc: mediaBinding.mediaSrc,
    mediaBinding,
    language: {
      code: String(
        document.language?.code ?? selectedTrack?.language ?? "",
      ).trim(),
      label: String(
        document.language?.label ?? selectedTrack?.label ?? "",
      ).trim(),
    },
    selectedTrackId,
    tracks,
    cues,
    capturedAt: String(document.capturedAt ?? ""),
  };
}

export function createCaptionState({
  status = CAPTION_STATUS.IDLE,
  reason = null,
  message = "",
  document = null,
  tracks = [],
  mediaBinding = {},
} = {}) {
  return {
    protocolVersion: CAPTION_PROTOCOL_VERSION,
    status: VALID_STATUSES.has(status) ? status : CAPTION_STATUS.ERROR,
    reason: reason ? String(reason) : null,
    message: String(message ?? ""),
    document: normalizeCaptionDocument(document),
    tracks: Array.isArray(tracks) ? tracks.map(normalizeTrack) : [],
    mediaBinding: normalizeMediaBinding(mediaBinding),
  };
}

export function normalizeCaptionState(payload, expectedMedia = null) {
  const state = createCaptionState(payload);

  if (
    state.status === CAPTION_STATUS.READY &&
    (!state.document || state.document.cues.length === 0)
  ) {
    return {
      ...state,
      status: CAPTION_STATUS.EMPTY,
      reason: "selected-track-empty",
    };
  }

  if (
    state.document &&
    expectedMedia &&
    !captionDocumentMatchesMedia(state.document, expectedMedia)
  ) {
    return {
      ...state,
      status: CAPTION_STATUS.STALE,
      reason: "media-binding-mismatch",
      message: "字幕属于另一个页面或视频，请刷新字幕。",
      document: null,
    };
  }

  return state;
}
