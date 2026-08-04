export const CAPTION_FOLLOW_MODE = Object.freeze({
  FOLLOWING: "following",
  MANUAL: "manual",
  SEEKING: "seeking",
});

export const CAPTION_FOLLOW_EVENT = Object.freeze({
  USER_SCROLL: "user-scroll",
  SEEK_START: "seek-start",
  SEEK_SETTLED: "seek-settled",
  RESUME: "resume",
  DOCUMENT_CHANGED: "document-changed",
});

export function transitionCaptionFollowMode(
  current = CAPTION_FOLLOW_MODE.FOLLOWING,
  event,
) {
  switch (event?.type) {
    case CAPTION_FOLLOW_EVENT.USER_SCROLL:
      return CAPTION_FOLLOW_MODE.MANUAL;
    case CAPTION_FOLLOW_EVENT.SEEK_START:
      return CAPTION_FOLLOW_MODE.SEEKING;
    case CAPTION_FOLLOW_EVENT.SEEK_SETTLED:
      return event.userScrolled
        ? CAPTION_FOLLOW_MODE.MANUAL
        : CAPTION_FOLLOW_MODE.FOLLOWING;
    case CAPTION_FOLLOW_EVENT.RESUME:
    case CAPTION_FOLLOW_EVENT.DOCUMENT_CHANGED:
      return CAPTION_FOLLOW_MODE.FOLLOWING;
    default:
      return current;
  }
}
