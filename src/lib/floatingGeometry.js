export function rectRelativeTo(rect, containerRect = null) {
  if (!rect) return null;
  const originLeft = containerRect?.left ?? 0;
  const originTop = containerRect?.top ?? 0;
  return {
    bottom: rect.bottom - originTop,
    height: rect.height,
    left: rect.left - originLeft,
    right: rect.right - originLeft,
    top: rect.top - originTop,
    width: rect.width,
  };
}

export function rangeTextLengthIgnoringUi(range) {
  if (!range?.cloneContents) return 0;
  const fragment = range.cloneContents();
  fragment
    .querySelectorAll?.("[data-selection-ignore]")
    .forEach((node) => node.remove());
  return String(fragment.textContent ?? "").length;
}
