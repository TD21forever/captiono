import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { IconChevronDown, IconSubtitles } from "@tabler/icons-react";
import { App } from "./App.jsx";
import styles from "./styles.css?inline";

const HOST_ID = "caption-review-extension-host";
const PANEL_COMMAND = "TOGGLE_CAPTION_REVIEW_PANEL";
const PANEL_OPEN_COMMAND = "OPEN_CAPTION_REVIEW_PANEL";

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
const BILIBILI_RIGHT_NAV_SELECTORS = [
  ".bili-header .right-entry",
  ".bili-header__bar .right-entry",
  "#internationalHeader .nav-user-center",
  ".international-header .nav-user-center",
  ".mini-header .nav-user-center",
];
const BILIBILI_HEADER_SELECTORS = [
  ".bili-header__bar",
  ".bili-header",
  "#internationalHeader",
  ".international-header",
  ".mini-header",
];
const BILIBILI_SEARCH_SELECTORS = [
  ".bili-header #nav-searchform",
  ".bili-header__bar #nav-searchform",
  ".bili-header .center-search-container",
  ".bili-header__bar .center-search-container",
  ".bili-header .nav-search-input",
  ".bili-header__bar .nav-search-input",
  ".bili-header .nav-search-btn",
  ".bili-header__bar .nav-search-btn",
  "#internationalHeader .nav-search-box",
  ".international-header .nav-search-box",
  ".mini-header .nav-search-box",
];
const BILIBILI_PLAYER_SELECTOR =
  "#bilibili-player, .bpx-player-container, video";
const BILIBILI_MOUNT_STABILITY_MS = 8000;
const BILIBILI_MOUNT_STRUCTURE_QUIET_MS = 2400;
const BILIBILI_MOUNT_RETRY_MS = 500;
const BILIBILI_SUPPORTING_NAV_CATEGORIES = new Set([
  "message",
  "dynamic",
  "favorite",
  "history",
  "creator",
]);
const MOUNT_PLACEMENTS = new WeakMap();

function createPanelCommandChannel() {
  let listener = null;
  let pending = [];
  return {
    publish(command) {
      if (listener) listener(command);
      else pending.push(command);
    },
    subscribe(nextListener) {
      listener = nextListener;
      const queued = pending;
      pending = [];
      for (const command of queued) nextListener(command);
      return () => {
        if (listener === nextListener) listener = null;
      };
    },
  };
}

function EmbeddedCaptionReview({
  commandChannel,
  host,
  initialOpen = true,
  shadowRoot,
}) {
  const [open, setOpen] = useState(initialOpen);
  const launcherRef = useRef(null);
  const previousFocusRef = useRef(null);
  const openStateMountedRef = useRef(false);

  const setPanelOpen = useCallback((nextOpen) => {
    if (!nextOpen) {
      previousFocusRef.current = shadowRoot.activeElement ?? null;
    }
    host.dataset.open = nextOpen ? "true" : "false";
    setOpen(nextOpen);
  }, [host, shadowRoot]);

  const togglePanel = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      if (!next) {
        previousFocusRef.current = shadowRoot.activeElement ?? null;
      }
      host.dataset.open = next ? "true" : "false";
      return next;
    });
  }, [host, shadowRoot]);

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
        : shadowRoot.querySelector(
            '[aria-label="收起 Captiono 面板"]',
          );
      restoreTarget?.focus({ preventScroll: true });
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [open, shadowRoot]);

  useEffect(() => {
    return commandChannel.subscribe((command) => {
      if (command === PANEL_OPEN_COMMAND) setPanelOpen(true);
      else togglePanel();
    });
  }, [commandChannel, setPanelOpen, togglePanel]);

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

function rectanglesOverlap(left, right) {
  if (!left || !right) return false;
  const overlapWidth =
    Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const overlapHeight =
    Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return overlapWidth > 1 && overlapHeight > 1;
}

function bilibiliPlacementIsSafe({ container, layout, player } = {}) {
  if (
    !container?.isConnected ||
    !layout?.isConnected ||
    !player?.isConnected
  ) {
    return false;
  }
  const containerRect = container.getBoundingClientRect();
  const playerRect = player.getBoundingClientRect();
  return Boolean(
    containerRect.width >= 320 &&
      containerRect.width <= 480 &&
      playerRect.width >= 320 &&
      playerRect.height >= 180 &&
      !rectanglesOverlap(containerRect, playerRect),
  );
}

function nativeElementIsVisible(element, minWidth = 18, minHeight = 18) {
  if (
    !element?.isConnected ||
    element.closest?.('[hidden], [aria-hidden="true"], [inert]')
  ) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  const style = globalThis.getComputedStyle?.(element);
  return Boolean(
    rect.width >= minWidth &&
      rect.height >= minHeight &&
      style?.display !== "none" &&
      style?.visibility !== "hidden" &&
      Number.parseFloat(style?.opacity ?? "1") > 0.05 &&
      style?.pointerEvents !== "none",
  );
}

function topLevelNativeNavItems(candidate) {
  if (!candidate?.children) return [];
  let items = Array.from(candidate.children);
  if (
    items.length === 1 &&
    items[0].matches?.("ul, ol") &&
    items[0].children.length > 0
  ) {
    items = Array.from(items[0].children);
  }
  return items.filter((item) => nativeElementIsVisible(item, 8, 18));
}

function shallowNativeNavSignal(item) {
  const signal = [];
  let level = [item];
  for (let depth = 0; depth <= 2 && level.length > 0; depth += 1) {
    const nextLevel = [];
    for (const element of level) {
      for (const name of [
        "class",
        "id",
        "href",
        "aria-label",
        "title",
        "data-title",
      ]) {
        const value = element.getAttribute?.(name);
        if (value) signal.push(value);
      }
      for (const child of element.childNodes ?? []) {
        if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          signal.push(child.textContent.trim());
        }
      }
      nextLevel.push(...(element.children ?? []));
    }
    level = nextLevel;
  }
  return signal.join(" ").toLowerCase();
}

function nativeNavCategory(item) {
  const signal = shallowNativeNavSignal(item);
  if (
    /space\.bilibili\.com\/\d+|header-avatar|mini-avatar|user-avatar|个人中心|我的主页/.test(
      signal,
    )
  ) {
    return "profile";
  }
  if (/header-login|login-entry|(?:^|\s)登录(?:\s|$)/.test(signal)) {
    return "login";
  }
  if (/message\.bilibili\.com|(?:^|[\s/_-])message(?:[\s/_-]|$)|消息/.test(signal)) {
    return "message";
  }
  if (/t\.bilibili\.com|(?:^|[\s/_-])dynamic(?:[\s/_-]|$)|动态/.test(signal)) {
    return "dynamic";
  }
  if (/\/(?:favlist|medialist)(?:[/?#]|$)|favorite|收藏/.test(signal)) {
    return "favorite";
  }
  if (/\/history(?:[/?#]|$)|(?:^|[\s/_-])history(?:[\s/_-]|$)|历史/.test(signal)) {
    return "history";
  }
  if (/member\.bilibili\.com|creator|创作中心/.test(signal)) {
    return "creator";
  }
  return "";
}

function visibleNativeNavCategories(candidate) {
  return new Set(
    topLevelNativeNavItems(candidate)
      .map(nativeNavCategory)
      .filter(Boolean),
  );
}

function bilibiliNativeNavIsHydrated(candidate) {
  if (!nativeElementIsVisible(candidate, 80, 20)) return false;
  const categories = visibleNativeNavCategories(candidate);
  if (!categories.has("profile") && !categories.has("login")) return false;
  const supportingCount = Array.from(BILIBILI_SUPPORTING_NAV_CATEGORIES).filter(
    (category) => categories.has(category),
  ).length;
  return supportingCount >= 3;
}

function bilibiliNativeSearch() {
  for (const selector of BILIBILI_SEARCH_SELECTORS) {
    const candidate = document.querySelector(selector);
    if (!candidate?.isConnected) continue;
    const control = candidate.matches(
      'input, button, [role="search"], [role="searchbox"]',
    )
      ? candidate
      : candidate.querySelector(
          'input, button, [role="search"], [role="searchbox"]',
        );
    if (!control) continue;
    if (nativeElementIsVisible(control, 24, 20)) return candidate;
  }
  return null;
}

function bilibiliNativeRightNav() {
  for (const selector of BILIBILI_RIGHT_NAV_SELECTORS) {
    const candidate = document.querySelector(selector);
    if (!candidate?.isConnected) continue;
    if (bilibiliNativeNavIsHydrated(candidate)) return candidate;
  }
  return null;
}

function bilibiliNativeHeader(nativeSearch, nativeRightNav) {
  for (const selector of BILIBILI_HEADER_SELECTORS) {
    const candidate = document.querySelector(selector);
    if (
      candidate?.isConnected &&
      candidate.contains(nativeSearch) &&
      candidate.contains(nativeRightNav)
    ) {
      return candidate;
    }
  }
  return null;
}

function bilibiliMountPoint() {
  const nativeSearch = bilibiliNativeSearch();
  if (!nativeSearch) return null;
  const nativeRightNav = bilibiliNativeRightNav();
  if (!nativeRightNav) return null;
  const nativeHeader = bilibiliNativeHeader(nativeSearch, nativeRightNav);
  if (!nativeHeader) return null;
  const visited = new Set();
  for (const selector of BILIBILI_LAYOUT_SELECTORS) {
    for (const layout of document.querySelectorAll(selector)) {
      if (visited.has(layout)) continue;
      visited.add(layout);

      const left = layout.querySelector(":scope > .left-container");
      const rightColumn = layout.querySelector(":scope > .right-container");
      const player = left?.querySelector(BILIBILI_PLAYER_SELECTOR);
      if (!player || !rightColumn) {
        continue;
      }

      if (
        !bilibiliPlacementIsSafe({
          container: rightColumn,
          layout,
          player,
        })
      ) {
        continue;
      }

      const danmaku = rightColumn.querySelector(
        BILIBILI_DANMAKU_SELECTORS.join(", "),
      );
      if (!danmaku) continue;
      const container = danmaku.parentElement;
      if (!container || !rightColumn.contains(container)) continue;
      if (
        !bilibiliPlacementIsSafe({ container, layout, player })
      ) {
        continue;
      }

      // The uploader/profile card is normally a sibling immediately before
      // the danmaku module. Hoisting the anchor to rightColumn placed Captiono
      // before that card and pushed it below a 360–560px panel, which looked
      // as if Bilibili's personal status bar had disappeared. Insert directly
      // before the native danmaku module so all preceding native modules keep
      // their original order and event ownership.
      return {
        before: danmaku,
        container,
        layout,
        left,
        nativeHeader,
        nativeRightNav,
        nativeSearch,
        player,
        rightColumn,
      };
    }
  }
  return null;
}

function findMountPoint() {
  const platform = platformName();
  if (platform === "youtube") {
    const container = document.querySelector(YOUTUBE_EMBED_SELECTOR);
    if (!container) return null;
    const before = container.querySelector(":scope > #secondary-inner");
    if (!before) return null;
    return {
      before,
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

function placePanel(
  host,
  mountPoint = findMountPoint(),
  insertHost = (container, node, before) => container.insertBefore(node, before),
) {
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
    insertHost(mountPoint.container, host, mountPoint.before);
  }
  MOUNT_PLACEMENTS.set(host, mountPoint);
  return true;
}

function panelNeedsPlacement(host) {
  if (panelNeedsStructuralPlacement(host)) return true;
  const placement = MOUNT_PLACEMENTS.get(host);
  if (
    placement?.platform === "bilibili" &&
    !bilibiliPlacementIsSafe(placement)
  ) {
    return true;
  }
  return false;
}

function panelNeedsStructuralPlacement(host) {
  if (!host?.isConnected) return true;
  const anchor = MOUNT_PLACEMENTS.get(host)?.before;
  if (!anchor) return false;
  return (
    !anchor.isConnected ||
    host.parentElement !== anchor.parentElement ||
    !isNodeBefore(host, anchor)
  );
}

function installPanel(
  commandChannel,
  mountPoint,
  { initialOpen = true, insertHost, removeHost },
) {
  if (!mountPoint) return null;
  const existingHost = document.getElementById(HOST_ID);
  if (existingHost) {
    if (existingHost.getAttribute("data-caption-review") !== "in-page-module") {
      return null;
    }
    removeHost(existingHost);
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-caption-review", "in-page-module");
  host.dataset.open = initialOpen ? "true" : "false";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.addEventListener("keydown", (event) => event.stopPropagation());
  shadow.addEventListener("keyup", (event) => event.stopPropagation());
  const stopPageEvent = (event) => event.stopPropagation();
  for (const eventName of [
    "click",
    "contextmenu",
    "dblclick",
    "mousedown",
    "mouseup",
    "pointerdown",
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
  root.render(
    <EmbeddedCaptionReview
      commandChannel={commandChannel}
      host={host}
      initialOpen={initialOpen}
      shadowRoot={shadow}
    />,
  );
  if (!placePanel(host, mountPoint, insertHost)) {
    root.unmount();
    return null;
  }
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
  const commandChannel = createPanelCommandChannel();
  let mountedPanel = null;
  let observedMountPlacement = null;
  let observedMountSize = "";
  let placementDirty = false;
  let mountResizeObserver = null;
  let bilibiliHydrationObserver = null;
  let observedBilibiliHeader = null;
  let rejectedMountPlacement = null;
  let explicitMountAttempt = false;
  let syncTimer = 0;
  let bilibiliMountGateTimer = 0;
  let observedUrl = location.href;
  let bilibiliMountGate = {
    before: null,
    container: null,
    nativeHeader: null,
    nativeRightNav: null,
    nativeSearch: null,
    signature: "",
    stableSince: 0,
    structureQuietSince: 0,
    url: observedUrl,
  };
  const ownedHostMutations = [];

  const scheduleSync = (delay = 120) => {
    if (syncTimer) return;
    syncTimer = globalThis.setTimeout(() => {
      syncTimer = 0;
      syncPanel();
    }, delay);
  };

  const rememberOwnedHostMutation = (kind, host, parent) => {
    if (!host || !parent) return;
    const entry = { host, kind, parent };
    ownedHostMutations.push(entry);
    globalThis.setTimeout(() => {
      const index = ownedHostMutations.indexOf(entry);
      if (index >= 0) ownedHostMutations.splice(index, 1);
    }, 0);
  };

  const consumeOwnedHostMutation = (kind, host, parent) => {
    const index = ownedHostMutations.findIndex(
      (entry) =>
        entry.kind === kind && entry.host === host && entry.parent === parent,
    );
    if (index < 0) return false;
    ownedHostMutations.splice(index, 1);
    return true;
  };

  const insertHostByCaptiono = (container, host, before) => {
    const previousParent = host.parentNode;
    if (previousParent) {
      rememberOwnedHostMutation("remove", host, previousParent);
    }
    rememberOwnedHostMutation("add", host, container);
    container.insertBefore(host, before);
  };

  const removeHostByCaptiono = (host) => {
    const parent = host?.parentNode;
    if (!parent) return;
    rememberOwnedHostMutation("remove", host, parent);
    host.remove();
  };

  const disconnectMountSizeObserver = () => {
    mountResizeObserver?.disconnect();
    mountResizeObserver = null;
    observedMountSize = "";
  };

  const disconnectMountObserver = () => {
    disconnectMountSizeObserver();
    observedMountPlacement = null;
  };

  const disconnectBilibiliHydrationObserver = () => {
    bilibiliHydrationObserver?.disconnect();
    bilibiliHydrationObserver = null;
    observedBilibiliHeader = null;
  };

  const mountSizeSignature = (placement) => {
    const containerRect = placement?.container?.getBoundingClientRect?.();
    const navRect = placement?.nativeRightNav?.getBoundingClientRect?.();
    const playerRect = placement?.player?.getBoundingClientRect?.();
    const searchRect = placement?.nativeSearch?.getBoundingClientRect?.();
    const navCategories = Array.from(
      visibleNativeNavCategories(placement?.nativeRightNav),
    )
      .sort()
      .join(",");
    return [
      Math.round(containerRect?.width ?? 0),
      navCategories,
      Math.round(navRect?.width ?? 0),
      Math.round(navRect?.height ?? 0),
      Math.round(playerRect?.width ?? 0),
      Math.round(playerRect?.height ?? 0),
      Math.round(searchRect?.width ?? 0),
      Math.round(searchRect?.height ?? 0),
    ].join(":");
  };

  const observeMountContainer = (host) => {
    const placement = MOUNT_PLACEMENTS.get(host);
    const container = placement?.container ?? null;
    if (!container) return;
    if (
      observedMountPlacement?.container === container &&
      observedMountPlacement?.layout === placement.layout &&
      observedMountPlacement?.nativeRightNav === placement.nativeRightNav &&
      observedMountPlacement?.nativeSearch === placement.nativeSearch &&
      observedMountPlacement?.player === placement.player &&
      (mountResizeObserver || !globalThis.ResizeObserver)
    ) {
      return;
    }
    disconnectMountObserver();
    observedMountPlacement = placement;
    observedMountSize = mountSizeSignature(placement);
    if (globalThis.ResizeObserver) {
      mountResizeObserver = new ResizeObserver(() => {
        const nextSize = mountSizeSignature(observedMountPlacement);
        if (nextSize === observedMountSize) return;
        observedMountSize = nextSize;
        placementDirty = true;
        scheduleSync();
      });
      mountResizeObserver.observe(container);
      if (placement.nativeRightNav) {
        mountResizeObserver.observe(placement.nativeRightNav);
      }
      if (placement.nativeSearch) {
        mountResizeObserver.observe(placement.nativeSearch);
      }
      if (placement.player) {
        mountResizeObserver.observe(placement.player);
      }
    }
  };

  const rejectedPlacementMatches = (placement) =>
    Boolean(
      rejectedMountPlacement &&
        placement?.platform === "bilibili" &&
        rejectedMountPlacement.url === location.href &&
        rejectedMountPlacement.container === placement.container &&
        rejectedMountPlacement.before === placement.before,
    );

  const rememberRejectedPlacement = (placement) => {
    if (placement?.platform !== "bilibili") return;
    rejectedMountPlacement = {
      before: placement.before,
      container: placement.container,
      nativeHeader: placement.nativeHeader,
      nativeRightNav: placement.nativeRightNav,
      nativeSearch: placement.nativeSearch,
      rightColumn: placement.rightColumn,
      url: location.href,
    };
  };

  const allowMountRetry = () => {
    rejectedMountPlacement = null;
  };

  const resetBilibiliMountGate = (url = location.href) => {
    globalThis.clearTimeout(bilibiliMountGateTimer);
    bilibiliMountGateTimer = 0;
    disconnectBilibiliHydrationObserver();
    bilibiliMountGate = {
      before: null,
      container: null,
      nativeHeader: null,
      nativeRightNav: null,
      nativeSearch: null,
      signature: "",
      stableSince: 0,
      structureQuietSince: 0,
      url,
    };
  };

  const armBilibiliMountGate = (remaining) => {
    if (bilibiliMountGateTimer) return;
    bilibiliMountGateTimer = globalThis.setTimeout(() => {
      bilibiliMountGateTimer = 0;
      scheduleSync(0);
    }, Math.max(0, remaining));
  };

  const observeBilibiliHydrationSubtree = (placement) => {
    const nativeHeader = placement?.nativeHeader;
    if (!nativeHeader?.isConnected || !globalThis.MutationObserver) return;
    if (
      observedBilibiliHeader === nativeHeader &&
      bilibiliHydrationObserver
    ) {
      return;
    }
    disconnectBilibiliHydrationObserver();
    observedBilibiliHeader = nativeHeader;
    bilibiliHydrationObserver = new MutationObserver((mutations) => {
      if (
        bilibiliMountGate.url !== location.href ||
        bilibiliMountGate.nativeHeader !== nativeHeader ||
        !mutations.some(
          (mutation) =>
            mutation.type === "childList" || mutation.type === "attributes",
        )
      ) {
        return;
      }
      bilibiliMountGate.stableSince = Date.now();
      armBilibiliMountGate(BILIBILI_MOUNT_STABILITY_MS);
    });
    bilibiliHydrationObserver.observe(nativeHeader, {
      attributeFilter: [
        "aria-expanded",
        "aria-hidden",
        "class",
        "hidden",
        "href",
        "style",
      ],
      attributes: true,
      childList: true,
      subtree: true,
    });
  };

  const resolveBilibiliMountPoint = ({ force = false } = {}) => {
    if (document.readyState !== "complete") return null;
    const mountPoint = findMountPoint();
    if (!mountPoint) {
      resetBilibiliMountGate(location.href);
      armBilibiliMountGate(force ? 120 : BILIBILI_MOUNT_RETRY_MS);
      return null;
    }
    if (rejectedPlacementMatches(mountPoint)) return null;
    if (rejectedMountPlacement) {
      // A new native anchor generation is a genuinely new mount opportunity.
      rejectedMountPlacement = null;
      resetBilibiliMountGate(location.href);
    }
    const signature = mountSizeSignature(mountPoint);
    const sameGeneration =
      bilibiliMountGate.url === location.href &&
      bilibiliMountGate.before === mountPoint.before &&
      bilibiliMountGate.container === mountPoint.container &&
      bilibiliMountGate.nativeHeader === mountPoint.nativeHeader &&
      bilibiliMountGate.nativeRightNav === mountPoint.nativeRightNav &&
      bilibiliMountGate.nativeSearch === mountPoint.nativeSearch &&
      bilibiliMountGate.signature === signature;
    const now = Date.now();
    if (!sameGeneration) {
      resetBilibiliMountGate(location.href);
      bilibiliMountGate = {
        before: mountPoint.before,
        container: mountPoint.container,
        nativeHeader: mountPoint.nativeHeader,
        nativeRightNav: mountPoint.nativeRightNav,
        nativeSearch: mountPoint.nativeSearch,
        signature,
        stableSince: now,
        structureQuietSince: now,
        url: location.href,
      };
      observeBilibiliHydrationSubtree(mountPoint);
      armBilibiliMountGate(
        Math.max(
          BILIBILI_MOUNT_STABILITY_MS,
          BILIBILI_MOUNT_STRUCTURE_QUIET_MS,
        ),
      );
      return null;
    }

    observeBilibiliHydrationSubtree(mountPoint);

    const stableFor = now - bilibiliMountGate.stableSince;
    const structurallyQuietFor =
      now - bilibiliMountGate.structureQuietSince;
    if (
      stableFor < BILIBILI_MOUNT_STABILITY_MS ||
      structurallyQuietFor < BILIBILI_MOUNT_STRUCTURE_QUIET_MS
    ) {
      armBilibiliMountGate(
        Math.max(
          BILIBILI_MOUNT_STABILITY_MS - stableFor,
          BILIBILI_MOUNT_STRUCTURE_QUIET_MS - structurallyQuietFor,
        ),
      );
      return null;
    }
    disconnectBilibiliHydrationObserver();
    return mountPoint;
  };

  const mutationTouchesBilibiliMountStructure = (mutations, placement) => {
    const anchorParent = placement?.before?.parentElement;
    const rightColumn = placement?.rightColumn;
    if (!anchorParent?.isConnected || !rightColumn?.isConnected) return true;
    return mutations.some((mutation) => {
      if (mutation.type !== "childList") return false;
      if (
        mutation.target === anchorParent ||
        mutation.target === rightColumn
      ) {
        return true;
      }
      return [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) =>
          node === anchorParent ||
          node === rightColumn ||
          (node?.nodeType === Node.ELEMENT_NODE &&
            (node.contains?.(anchorParent) || node.contains?.(rightColumn))),
      );
    });
  };

  const resetBilibiliStructureQuietPeriod = (mutations) => {
    if (!bilibiliMountGate.before || bilibiliMountGate.url !== location.href) {
      return;
    }
    const placement = findMountPoint();
    if (
      !placement ||
      placement.before !== bilibiliMountGate.before ||
      placement.container !== bilibiliMountGate.container ||
      placement.nativeHeader !== bilibiliMountGate.nativeHeader ||
      placement.nativeRightNav !== bilibiliMountGate.nativeRightNav ||
      placement.nativeSearch !== bilibiliMountGate.nativeSearch ||
      !mutationTouchesBilibiliMountStructure(mutations, placement)
    ) {
      return;
    }
    bilibiliMountGate.structureQuietSince = Date.now();
    armBilibiliMountGate(BILIBILI_MOUNT_STRUCTURE_QUIET_MS);
  };

  const nodeIncludesHost = (node, host) =>
    node === host ||
    (node?.nodeType === Node.ELEMENT_NODE && node.contains?.(host));

  const hostWasExternallyMoved = (mutations, host) => {
    let moved = false;
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      for (const node of mutation.removedNodes) {
        if (!nodeIncludesHost(node, host)) continue;
        if (node === host && consumeOwnedHostMutation("remove", host, mutation.target)) {
          continue;
        }
        moved = true;
      }
      for (const node of mutation.addedNodes) {
        if (!nodeIncludesHost(node, host)) continue;
        if (node === host && consumeOwnedHostMutation("add", host, mutation.target)) {
          continue;
        }
        moved = true;
      }
    }
    return moved;
  };

  const mutationMayReplacePlacement = (mutations, placement) => {
    const scope = placement?.rightColumn;
    if (!scope?.isConnected) return true;
    const anchorSelector = BILIBILI_DANMAKU_SELECTORS.join(", ");
    const nodeContainsAnchor = (node) =>
      node?.nodeType === Node.ELEMENT_NODE &&
      (node.matches?.(anchorSelector) || node.querySelector?.(anchorSelector));
    const nodeContainsNativeMountPart = (node) => {
      const parts = [
        placement.before,
        placement.container,
        placement.nativeHeader,
        placement.nativeRightNav,
        placement.nativeSearch,
      ].filter(Boolean);
      return parts.some(
        (part) =>
          node === part ||
          (node?.nodeType === Node.ELEMENT_NODE && node.contains?.(part)),
      );
    };
    return mutations.some((mutation) => {
      if (mutation.type !== "childList") return false;
      return [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) =>
          nodeContainsNativeMountPart(node) ||
          ((mutation.target === scope || scope.contains(mutation.target)) &&
            nodeContainsAnchor(node)),
      );
    });
  };

  const destroyMountedPanel = () => {
    if (!mountedPanel) return;
    const { host, root } = mountedPanel;
    mountedPanel = null;
    disconnectMountObserver();
    root.unmount();
    removeHostByCaptiono(host);
    MOUNT_PLACEMENTS.delete(host);
  };

  const rejectMountedBilibiliPlacement = () => {
    const placement = MOUNT_PLACEMENTS.get(mountedPanel?.host);
    rememberRejectedPlacement(placement);
    destroyMountedPanel();
    resetBilibiliMountGate(location.href);
  };

  const handlePanelMessage = (message, _sender, sendResponse) => {
    if (
      message?.type !== PANEL_COMMAND &&
      message?.type !== PANEL_OPEN_COMMAND
    ) {
      return undefined;
    }
    if (!isSupportedVideoPage()) {
      sendResponse?.({ handled: false });
      return undefined;
    }
    allowMountRetry();
    explicitMountAttempt = true;
    placementDirty = true;
    scheduleSync();
    commandChannel.publish(mountedPanel ? message.type : PANEL_OPEN_COMMAND);
    sendResponse?.({ handled: true });
    return undefined;
  };
  chrome.runtime.onMessage.addListener(handlePanelMessage);

  const syncPanel = () => {
    if (!isSupportedVideoPage()) {
      destroyMountedPanel();
      rejectedMountPlacement = null;
      resetBilibiliMountGate(location.href);
      explicitMountAttempt = false;
      return;
    }

    const platform = platformName();
    const forceMount = explicitMountAttempt;
    explicitMountAttempt = false;

    if (platform === "bilibili") {
      if (mountedPanel) {
        const placement = MOUNT_PLACEMENTS.get(mountedPanel.host);
        if (!mountedPanel.host.isConnected) {
          rejectMountedBilibiliPlacement();
          return;
        }
        if (placementDirty || panelNeedsPlacement(mountedPanel.host)) {
          placementDirty = false;
          const nextMountPoint = findMountPoint();
          const samePlacement =
            nextMountPoint &&
            placement?.container === nextMountPoint.container &&
            placement?.before === nextMountPoint.before &&
            placement?.nativeHeader === nextMountPoint.nativeHeader &&
            placement?.nativeRightNav === nextMountPoint.nativeRightNav &&
            placement?.nativeSearch === nextMountPoint.nativeSearch;
          if (!samePlacement) {
            destroyMountedPanel();
            resetBilibiliMountGate(location.href);
          } else {
            observeMountContainer(mountedPanel.host);
            return;
          }
        } else {
          observeMountContainer(mountedPanel.host);
          return;
        }
      }

      const mountPoint = resolveBilibiliMountPoint({ force: forceMount });
      if (!mountPoint) return;
      mountedPanel = installPanel(commandChannel, mountPoint, {
        initialOpen: false,
        insertHost: insertHostByCaptiono,
        removeHost: removeHostByCaptiono,
      });
      if (mountedPanel) observeMountContainer(mountedPanel.host);
      return;
    }

    const mountPoint = findMountPoint();
    if (!mountedPanel) {
      if (!mountPoint) return;
      mountedPanel = installPanel(commandChannel, mountPoint, {
        insertHost: insertHostByCaptiono,
        removeHost: removeHostByCaptiono,
      });
    } else if (placementDirty || panelNeedsPlacement(mountedPanel.host)) {
      placementDirty = false;
      if (!mountPoint) {
        destroyMountedPanel();
        return;
      }
      placePanel(mountedPanel.host, mountPoint, insertHostByCaptiono);
    }
    if (mountedPanel) observeMountContainer(mountedPanel.host);
  };

  const resetForUrlChange = () => {
    const nextUrl = location.href;
    if (nextUrl === observedUrl) return false;
    observedUrl = nextUrl;
    allowMountRetry();
    explicitMountAttempt = false;
    destroyMountedPanel();
    resetBilibiliMountGate(nextUrl);
    return true;
  };

  const handleNavigationChange = () => {
    resetForUrlChange();
    scheduleSync();
  };

  const layoutObserver = new MutationObserver((mutations) => {
    const urlChanged = resetForUrlChange();

    if (platformName() === "bilibili" && mountedPanel) {
      const placement = MOUNT_PLACEMENTS.get(mountedPanel.host);
      if (hostWasExternallyMoved(mutations, mountedPanel.host)) {
        rejectMountedBilibiliPlacement();
        return;
      }
      if (mutationMayReplacePlacement(mutations, placement)) {
        placementDirty = true;
      }
    }

    if (urlChanged) {
      scheduleSync();
      return;
    }
    if (!isSupportedVideoPage()) return;
    if (platformName() === "bilibili" && !mountedPanel) {
      resetBilibiliStructureQuietPeriod(mutations);
    }
    if (!mountedPanel) {
      if (platformName() !== "bilibili") {
        scheduleSync();
        return;
      }
      if (document.readyState !== "complete") return;
      if (
        rejectedMountPlacement?.url === location.href &&
        rejectedMountPlacement.container?.isConnected &&
        rejectedMountPlacement.before?.isConnected &&
        !mutationMayReplacePlacement(mutations, rejectedMountPlacement)
      ) {
        return;
      }
      scheduleSync();
      return;
    }
    if (placementDirty || panelNeedsStructuralPlacement(mountedPanel.host)) {
      scheduleSync();
    }
  });
  layoutObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  globalThis.addEventListener("popstate", handleNavigationChange);
  globalThis.addEventListener("yt-navigate-finish", handleNavigationChange);
  globalThis.navigation?.addEventListener?.(
    "currententrychange",
    handleNavigationChange,
  );
  const handleViewportResize = () => {
    placementDirty = true;
    scheduleSync();
  };
  globalThis.addEventListener("resize", handleViewportResize, {
    passive: true,
  });

  const handlePageShow = (event) => {
    if (event.persisted) scheduleSync();
  };
  const handleReadyStateChange = () => {
    if (document.readyState === "complete") scheduleSync();
  };
  const handlePageHide = (event) => {
    if (event.persisted) return;
    globalThis.clearTimeout(syncTimer);
    globalThis.clearTimeout(bilibiliMountGateTimer);
    layoutObserver.disconnect();
    disconnectMountObserver();
    disconnectBilibiliHydrationObserver();
    globalThis.removeEventListener("popstate", handleNavigationChange);
    globalThis.removeEventListener(
      "yt-navigate-finish",
      handleNavigationChange,
    );
    globalThis.removeEventListener("resize", handleViewportResize);
    globalThis.removeEventListener("pageshow", handlePageShow);
    globalThis.removeEventListener("pagehide", handlePageHide);
    document.removeEventListener("readystatechange", handleReadyStateChange);
    globalThis.navigation?.removeEventListener?.(
      "currententrychange",
      handleNavigationChange,
    );
    chrome.runtime.onMessage.removeListener(handlePanelMessage);
    destroyMountedPanel();
    globalThis.__captionReviewPanelRuntimeInstalled = false;
  };
  globalThis.addEventListener("pageshow", handlePageShow);
  globalThis.addEventListener("pagehide", handlePageHide);
  document.addEventListener("readystatechange", handleReadyStateChange);
  syncPanel();
}
