import { mkdir, writeFile } from "node:fs/promises";

const cdpHttp = process.env.CAPTION_REVIEW_CDP_HTTP ?? "http://127.0.0.1:9333";
const outputDirectory =
  process.env.CAPTION_REVIEW_E2E_OUTPUT ?? "/private/tmp/caption-review-e2e-results";
const primaryVideoUrl =
  process.env.CAPTION_REVIEW_PRIMARY_URL ??
  "https://www.youtube.com/watch?v=x6TsR3y5Qfg";
const secondaryVideoUrl =
  process.env.CAPTION_REVIEW_SECONDARY_URL ??
  "https://www.youtube.com/watch?v=UF8uR6Z6KLc";
const requireCaptions = process.env.CAPTION_REVIEW_REQUIRE_CAPTIONS === "true";

class CdpSession {
  constructor(webSocketDebuggerUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(webSocketDebuggerUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener(
        "error",
        () => reject(new Error(`Unable to connect to ${webSocketDebuggerUrl}`)),
        { once: true },
      );
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  close() {
    this.socket.close();
  }
}

async function targets() {
  const response = await fetch(`${cdpHttp}/json/list`);
  if (!response.ok) throw new Error(`Unable to list CDP targets: ${response.status}`);
  return response.json();
}

async function newTarget(url) {
  const response = await fetch(`${cdpHttp}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!response.ok) throw new Error(`Unable to create CDP target: ${response.status}`);
  return response.json();
}

async function evaluate(session, expression) {
  const response = await session.send("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "Runtime evaluation failed",
    );
  }
  return response.result?.value;
}

const panelShadowBackendNodeIds = new WeakMap();

function nodeAttribute(node, name) {
  const attributes = node?.attributes ?? [];
  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === name) return attributes[index + 1] ?? "";
  }
  return null;
}

function findNode(root, predicate) {
  const pending = [root];
  const visited = new Set();
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    const identity = node.backendNodeId ?? node.nodeId;
    if (identity && visited.has(identity)) continue;
    if (identity) visited.add(identity);
    if (predicate(node)) return node;

    pending.push(
      ...(node.children ?? []),
      ...(node.shadowRoots ?? []),
      ...(node.pseudoElements ?? []),
      ...(node.distributedNodes ?? []),
    );
    if (node.contentDocument) pending.push(node.contentDocument);
    if (node.templateContent) pending.push(node.templateContent);
  }
  return null;
}

async function findPanelShadowBackendNodeId(session) {
  const { root } = await session.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  const host = findNode(
    root,
    (node) => nodeAttribute(node, "id") === "caption-review-extension-host",
  );
  const shadow = host?.shadowRoots?.[0];
  return shadow?.backendNodeId ?? null;
}

async function resolvePanelShadow(session) {
  let backendNodeId = panelShadowBackendNodeIds.get(session);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!backendNodeId) {
      backendNodeId = await findPanelShadowBackendNodeId(session);
      if (!backendNodeId) return null;
      panelShadowBackendNodeIds.set(session, backendNodeId);
    }

    try {
      const { object } = await session.send("DOM.resolveNode", {
        backendNodeId,
      });
      if (!object?.objectId) {
        throw new Error("CDP did not return an object for Captiono ShadowRoot");
      }
      return object;
    } catch (error) {
      panelShadowBackendNodeIds.delete(session);
      backendNodeId = null;
      if (attempt === 1) throw error;
    }
  }
  return null;
}

async function callOnPanelShadow(
  session,
  functionDeclaration,
  argumentValues = [],
) {
  const shadow = await resolvePanelShadow(session);
  if (!shadow) return undefined;

  try {
    const response = await session.send("Runtime.callFunctionOn", {
      arguments: argumentValues.map((value) => ({ value })),
      awaitPromise: true,
      functionDeclaration,
      objectId: shadow.objectId,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          "Shadow DOM runtime evaluation failed",
      );
    }
    return response.result?.value;
  } finally {
    await session.send("Runtime.releaseObject", {
      objectId: shadow.objectId,
    });
  }
}

async function waitFor(session, expression, options = {}) {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 250;
  const startedAt = Date.now();
  let lastValue;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await evaluate(session, expression);
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `${options.label ?? "condition"} did not become ready in ${timeoutMs}ms; last value: ${JSON.stringify(lastValue)}`,
  );
}

async function waitForPanel(session, functionDeclaration, options = {}) {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 250;
  const startedAt = Date.now();
  let lastValue;
  while (Date.now() - startedAt < timeoutMs) {
    lastValue = await callOnPanelShadow(session, functionDeclaration);
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `${options.label ?? "panel condition"} did not become ready in ${timeoutMs}ms; last value: ${JSON.stringify(lastValue)}`,
  );
}

async function inspectPanel(session) {
  const inspection = await callOnPanelShadow(
    session,
    `function() {
      const root = this;
      const hosts = [...document.querySelectorAll("#caption-review-extension-host")];
      const host = root.host;
      const panel = root?.querySelector(".caption-review-panel-surface");
      const transcript = root?.querySelector(".transcript-view");
      const firstRow = root?.querySelector(".transcript-row");
      const hostRect = host?.getBoundingClientRect();
      const player = document.querySelector("#movie_player, #player ytd-player, ytd-player");
      const playerRect = player?.getBoundingClientRect();
      const overlapWidth = hostRect && playerRect
        ? Math.max(0, Math.min(hostRect.right, playerRect.right) - Math.max(hostRect.left, playerRect.left))
        : 0;
      const overlapHeight = hostRect && playerRect
        ? Math.max(0, Math.min(hostRect.bottom, playerRect.bottom) - Math.max(hostRect.top, playerRect.top))
        : 0;
      return {
        hostCount: hosts.length,
        hasShadowRoot: true,
        open: host?.dataset.open ?? null,
        complementaryCount: root?.querySelectorAll('aside[aria-label="Captiono"]').length ?? 0,
        sourceTitle: root?.querySelector(".source-title")?.textContent?.trim() ?? "",
        sentenceCount: root?.querySelectorAll(".transcript-row").length ?? 0,
        firstSentence: firstRow?.querySelector("[data-sentence-text]")?.textContent?.trim() ?? "",
        scrollTop: transcript?.scrollTop ?? null,
        surfaceHidden: panel?.classList.contains("is-hidden") ?? null,
        surfaceInert: panel?.inert ?? null,
        placement: host?.dataset.placement ?? null,
        platform: host?.dataset.platform ?? null,
        hostPosition: host ? getComputedStyle(host).position : null,
        hostParentId: host?.parentElement?.id ?? null,
        hostWidth: hostRect ? Math.round(hostRect.width) : null,
        hostHeight: hostRect ? Math.round(hostRect.height) : null,
        panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : null,
        playerOverlapArea: Math.round(overlapWidth * overlapHeight),
        pageHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        href: location.href,
      };
    }`,
  );
  if (!inspection) {
    throw new Error("Captiono closed ShadowRoot is no longer available");
  }
  return inspection;
}

async function capture(session, fileName) {
  const response = await session.send("Page.captureScreenshot", {
    captureBeyondViewport: false,
    format: "png",
    fromSurface: true,
  });
  const path = `${outputDirectory}/${fileName}`;
  await writeFile(path, Buffer.from(response.data, "base64"));
  return path;
}

async function clickByLabel(session, label) {
  return callOnPanelShadow(
    session,
    `function(label) {
      const root = this;
      const button = [...(root?.querySelectorAll("button") ?? [])]
        .find((candidate) => candidate.getAttribute("aria-label") === label);
      button?.click();
      return Boolean(button);
    }`,
    [label],
  );
}

async function preparePage(target) {
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("DOM.enable");
  await waitForPanel(
    session,
    `function() { return Boolean(this.querySelector(".caption-panel")); }`,
    {
      label: "automatically injected Captiono Shadow DOM panel",
      timeoutMs: 12_000,
    },
  );
  return session;
}

await mkdir(outputDirectory, { recursive: true });

const existingTargets = await targets();
const primaryTarget = existingTargets.find(
  (target) => target.type === "page" && target.url.startsWith(primaryVideoUrl),
);
if (!primaryTarget) throw new Error(`Primary video target not found: ${primaryVideoUrl}`);

const primary = await preparePage(primaryTarget);
const report = {
  generatedAt: new Date().toISOString(),
  primary: {},
  secondary: {},
};

report.primary.initial = await inspectPanel(primary);
if (report.primary.initial.hostCount !== 1) {
  throw new Error(`Expected one primary host, got ${report.primary.initial.hostCount}`);
}
if (!report.primary.initial.hasShadowRoot || report.primary.initial.complementaryCount !== 1) {
  throw new Error("Primary panel is not mounted as one named complementary region");
}
if (
  report.primary.initial.placement !== "in-page-module" ||
  report.primary.initial.hostPosition === "fixed" ||
  report.primary.initial.hostParentId !== "secondary" ||
  report.primary.initial.playerOverlapArea !== 0
) {
  throw new Error(
    `Primary module is not safely embedded in the YouTube sidebar: ${JSON.stringify(report.primary.initial)}`,
  );
}
report.primary.openScreenshot = await capture(primary, "youtube-open.png");

await callOnPanelShadow(
  primary,
  `function() {
    const root = this;
    const transcript = root?.querySelector(".transcript-view");
    if (transcript) transcript.scrollTop = 420;
    return transcript?.scrollTop ?? null;
  }`,
);
report.primary.scrollBeforeCollapse = (await inspectPanel(primary)).scrollTop;
if (!(await clickByLabel(primary, "收起 Captiono 面板"))) {
  throw new Error("Collapse button was not found");
}
await waitFor(primary, `document.querySelector("#caption-review-extension-host")?.dataset.open === "false"`, {
  label: "collapsed panel",
});
report.primary.collapsed = await inspectPanel(primary);
if (!report.primary.collapsed.surfaceHidden || !report.primary.collapsed.surfaceInert) {
  throw new Error("Collapsed panel must be hidden and inert");
}
if (report.primary.collapsed.hostHeight > 74) {
  throw new Error(`Collapsed module is too tall: ${report.primary.collapsed.hostHeight}px`);
}
report.primary.collapsedScreenshot = await capture(primary, "youtube-collapsed.png");

const secondaryTarget = await newTarget(secondaryVideoUrl);
const secondary = await preparePage(secondaryTarget);
report.secondary.initial = await inspectPanel(secondary);
if (report.secondary.initial.hostCount !== 1 || report.secondary.initial.open !== "true") {
  throw new Error("Secondary tab did not receive its own open panel");
}
if (report.secondary.initial.scrollTop !== 0) {
  throw new Error(`Secondary tab inherited scroll position ${report.secondary.initial.scrollTop}`);
}
if (
  report.secondary.initial.hostParentId !== "secondary" ||
  report.secondary.initial.hostPosition === "fixed" ||
  report.secondary.initial.playerOverlapArea !== 0
) {
  throw new Error("Secondary tab module is not embedded without overlap");
}
report.secondary.openScreenshot = await capture(secondary, "youtube-secondary-open.png");

if (!(await clickByLabel(primary, "展开 Captiono 面板"))) {
  throw new Error("Launcher was not found after collapse");
}
await waitFor(primary, `document.querySelector("#caption-review-extension-host")?.dataset.open === "true"`, {
  label: "reopened panel",
});
report.primary.reopened = await inspectPanel(primary);
if (report.primary.reopened.scrollTop !== report.primary.scrollBeforeCollapse) {
  throw new Error(
    `Primary scroll changed after collapse: ${report.primary.scrollBeforeCollapse} -> ${report.primary.reopened.scrollTop}`,
  );
}

if (Math.abs(report.primary.reopened.hostWidth - report.primary.reopened.panelWidth) > 2) {
  throw new Error(
    `Embedded panel does not follow its page column width: ${report.primary.reopened.hostWidth} vs ${report.primary.reopened.panelWidth}`,
  );
}

const firstCopyLabel = await callOnPanelShadow(
  primary,
  `function() {
    return this.querySelector(".transcript-row__copy")?.getAttribute("aria-label") ?? "";
  }`,
);
if (firstCopyLabel) {
  await clickByLabel(primary, firstCopyLabel);
  await waitForPanel(
    primary,
    `function() {
      return this.querySelector(".toast")?.textContent?.includes("已复制整句") ?? false;
    }`,
    { label: "copy confirmation", timeoutMs: 5_000 },
  );
  report.primary.copySentence = true;
} else {
  report.primary.copySentence = "skipped-no-caption-row";
}

report.primary.final = await inspectPanel(primary);
report.secondary.final = await inspectPanel(secondary);
report.uiIsolationPassed = true;
report.captionRowsObserved =
  report.primary.final.sentenceCount + report.secondary.final.sentenceCount;
report.captionAcquisition = report.captionRowsObserved
  ? "ready"
  : "not-observed-in-headless-browser";
if (requireCaptions && !report.captionRowsObserved) {
  throw new Error("Caption rows were required but neither video produced cues");
}
report.passed = report.uiIsolationPassed && (!requireCaptions || report.captionRowsObserved > 0);

await writeFile(
  `${outputDirectory}/report.json`,
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

primary.close();
secondary.close();
console.log(JSON.stringify(report, null, 2));
