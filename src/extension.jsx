import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { IconChevronDown, IconSubtitles } from "@tabler/icons-react";
import { App } from "./App.jsx";
import styles from "./styles.css?inline";

const HOST_ID = "caption-review-extension-host";
const PANEL_COMMAND = "TOGGLE_CAPTION_REVIEW_PANEL";
const PANEL_OPEN_COMMAND = "OPEN_CAPTION_REVIEW_PANEL";
const PANEL_OPEN_KEY = "caption-review:panel-open:v2";

const YOUTUBE_EMBED_SELECTOR = "ytd-watch-flexy #secondary";
const BILIBILI_LAYOUT_SELECTORS = [
  ".video-page-v1 .video-container-v1",
  ".video-container-v1",
  ".video-page-v1 .video-container",
];
const BILIBILI_DANMAKU_SELECTORS = [
  ".danmaku-box",
  "#danmukuBox",
];
const BILIBILI_PLAYER_SELECTOR =
  "#bilibili-player, .bpx-player-container, video";
const MOUNT_ANCHORS = new WeakMap();

function initialOpenState() {
  try {
    return sessionStorage.getItem(PANEL_OPEN_KEY) !== "closed";
  } catch {
    return true;
  }
}

function persistOpenState(open) {
  try {
    sessionStorage.setItem(PANEL_OPEN_KEY, open ? "open" : "closed");
  } catch {
    // Session state is only a convenience; the module still works without it.
  }
}

function EmbeddedCaptionReview({ host }) {
  const [open, setOpen] = useState(initialOpenState);
  const launcherRef = useRef(null);
  const previousFocusRef = useRef(null);
  const openStateMountedRef = useRef(false);

  const setPanelOpen = useCallback((nextOpen) => {
    if (!nextOpen) {
      previousFocusRef.current = host.shadowRoot?.activeElement ?? null;
    }
    setOpen(nextOpen);
    persistOpenState(nextOpen);
  }, [host]);

  const togglePanel = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      if (!next) {
        previousFocusRef.current = host.shadowRoot?.activeElement ?? null;
      }
      persistOpenState(next);
      return next;
    });
  }, [host]);

  useEffect(() => {
    host.dataset.open = open ? "true" : "false";
  }, [host, open]);

  useEffect(() => {
    if (!openStateMountedRef.current) {
      openStateMountedRef.current = true;
      return undefined;
    }
    const timer = globalThis.setTimeout(() => {
      if (!open) {
        launcherRef.current?.focus({ preventScroll: true });
        return;
      }
      const restoreTarget = previousFocusRef.current?.isConnected
        ? previousFocusRef.current
        : host.shadowRoot?.querySelector(
            '[aria-label="收起 Captiono 面板"]',
          );
      restoreTarget?.focus({ preventScroll: true });
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [host, open]);

  useEffect(() => {
    const handleMessage = (message, _sender, sendResponse) => {
      if (
        message?.type !== PANEL_COMMAND &&
        message?.type !== PANEL_OPEN_COMMAND
      ) {
        return undefined;
      }
      if (message.type === PANEL_OPEN_COMMAND) setPanelOpen(true);
      else togglePanel();
      sendResponse?.({ handled: true });
      return undefined;
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [setPanelOpen, togglePanel]);

  return (
    <div className="caption-review-embedded-shell">
      <div
        aria-hidden={!open}
        className={`caption-review-panel-surface${open ? "" : " is-hidden"}`}
        inert={!open}
      >
        <App embedded onCollapse={() => setPanelOpen(false)} />
      </div>
      {!open && (
        <button
          aria-label="展开 Captiono 面板"
          className="caption-review-launcher"
          onClick={() => setPanelOpen(true)}
          ref={launcherRef}
          type="button"
        >
          <span aria-hidden="true" className="caption-review-launcher__mark">
            <IconSubtitles size={20} stroke={1.8} />
          </span>
          <span className="caption-review-launcher__copy">
            <strong>Captiono</strong>
            <small>从视频字幕里标记表达与笔记</small>
          </span>
          <span className="caption-review-launcher__action">
            展开
            <IconChevronDown aria-hidden="true" size={17} stroke={1.8} />
          </span>
        </button>
      )}
    </div>
  );
}

function platformName() {
  const hostname = location.hostname.toLowerCase();
  if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
    return "youtube";
  }
  if (hostname === "bilibili.com" || hostname.endsWith(".bilibili.com")) {
    return "bilibili";
  }
  return "";
}

function bilibiliMountPoint() {
  const visited = new Set();
  for (const selector of BILIBILI_LAYOUT_SELECTORS) {
    for (const layout of document.querySelectorAll(selector)) {
      if (visited.has(layout)) continue;
      visited.add(layout);

      const left = layout.querySelector(":scope > .left-container");
      const container = layout.querySelector(":scope > .right-container");
      if (!left?.querySelector(BILIBILI_PLAYER_SELECTOR) || !container) {
        continue;
      }

      const rect = container.getBoundingClientRect();
      if (rect.width < 260 || rect.width > 520) continue;

      const danmaku = container.querySelector(
        BILIBILI_DANMAKU_SELECTORS.join(", "),
      );
      if (!danmaku) continue;

      // Never inject into Bilibili's own danmaku component. Its renderer
      // assumes control of its direct children and can remove or cover nearby
      // native controls when an unknown child is added. Mount beside the
      // component as a direct child of the right column instead.
      let anchor = danmaku;
      while (anchor.parentElement && anchor.parentElement !== container) {
        anchor = anchor.parentElement;
      }
      if (anchor.parentElement === container) {
        return { before: anchor, container };
      }
    }
  }
  return null;
}

function findMountPoint() {
  const platform = platformName();
  if (platform === "youtube") {
    const container = document.querySelector(YOUTUBE_EMBED_SELECTOR);
    if (!container) return null;
    return {
      before: container.querySelector(":scope > #secondary-inner"),
      container,
      platform,
    };
  }
  if (platform === "bilibili") {
    const mountPoint = bilibiliMountPoint();
    return mountPoint ? { ...mountPoint, platform } : null;
  }
  return null;
}

function isNodeBefore(node, reference) {
  return Boolean(
    node.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function placePanel(host) {
  const mountPoint = findMountPoint();
  if (!mountPoint) return false;

  if (host.dataset.platform !== mountPoint.platform) {
    host.dataset.platform = mountPoint.platform;
  }
  if (host.dataset.placement !== "in-page-module") {
    host.dataset.placement = "in-page-module";
  }
  if (
    host.parentElement !== mountPoint.container ||
    (mountPoint.before && !isNodeBefore(host, mountPoint.before))
  ) {
    mountPoint.container.insertBefore(host, mountPoint.before);
  }
  MOUNT_ANCHORS.set(host, mountPoint.before ?? null);
  return true;
}

function panelNeedsPlacement(host) {
  if (!host?.isConnected) return true;
  const anchor = MOUNT_ANCHORS.get(host);
  if (!anchor) return false;
  return (
    !anchor.isConnected ||
    host.parentElement !== anchor.parentElement ||
    !isNodeBefore(host, anchor)
  );
}

function installPanel() {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-caption-review", "in-page-module");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.addEventListener("keydown", (event) => event.stopPropagation());
  shadow.addEventListener("keyup", (event) => event.stopPropagation());
  const stopPageEvent = (event) => event.stopPropagation();
  for (const eventName of [
    "click",
    "mousedown",
    "mouseover",
    "mouseout",
    "mouseup",
    "pointerdown",
    "pointerover",
    "pointerout",
    "pointerup",
  ]) {
    shadow.addEventListener(eventName, stopPageEvent);
  }
  const style = document.createElement("style");
  style.textContent = styles;
  const rootElement = document.createElement("div");
  rootElement.id = "caption-review-root";
  shadow.append(style, rootElement);

  const root = createRoot(rootElement);
  root.render(<EmbeddedCaptionReview host={host} />);
  placePanel(host);
  return { host, root };
}

function isSupportedVideoPage() {
  const hostname = location.hostname.toLowerCase();
  if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
    return location.pathname === "/watch";
  }
  if (hostname === "bilibili.com" || hostname.endsWith(".bilibili.com")) {
    return (
      location.pathname.startsWith("/video/") ||
      location.pathname.startsWith("/bangumi/play/")
    );
  }
  return false;
}

if (!globalThis.__captionReviewPanelRuntimeInstalled) {
  globalThis.__captionReviewPanelRuntimeInstalled = true;
  let mountedPanel = null;

  const syncPanel = () => {
    if (isSupportedVideoPage()) {
      if (!mountedPanel) mountedPanel = installPanel();
      placePanel(mountedPanel.host);
      return;
    }
    if (mountedPanel) {
      mountedPanel.root.unmount();
      mountedPanel.host.remove();
      mountedPanel = null;
    }
  };

  let syncTimer = 0;
  const scheduleSync = () => {
    if (syncTimer) return;
    syncTimer = globalThis.setTimeout(() => {
      syncTimer = 0;
      syncPanel();
    }, 120);
  };
  let observedUrl = location.href;
  const layoutObserver = new MutationObserver(() => {
    const nextUrl = location.href;
    const urlChanged = nextUrl !== observedUrl;
    if (urlChanged) observedUrl = nextUrl;
    if (
      urlChanged ||
      (isSupportedVideoPage() &&
        (!mountedPanel || panelNeedsPlacement(mountedPanel.host)))
    ) {
      scheduleSync();
    }
  });
  layoutObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  globalThis.addEventListener("popstate", scheduleSync);
  globalThis.addEventListener("yt-navigate-finish", scheduleSync);
  globalThis.addEventListener(
    "pagehide",
    () => {
      globalThis.clearTimeout(syncTimer);
      layoutObserver.disconnect();
      globalThis.removeEventListener("popstate", scheduleSync);
      globalThis.removeEventListener("yt-navigate-finish", scheduleSync);
      mountedPanel?.root.unmount();
      mountedPanel?.host.remove();
      globalThis.__captionReviewPanelRuntimeInstalled = false;
    },
    { once: true },
  );
  syncPanel();
}
