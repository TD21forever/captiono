import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionSource = path.join(root, "extension");
const extensionDist = path.join(root, "dist", "extension");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

test("declares a scoped MV3 in-page extension for automatic captions", async () => {
  const manifest = await readJson(path.join(extensionSource, "manifest.json"));
  const packageMetadata = await readJson(path.join(root, "package.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageMetadata.version);
  assert.equal(manifest.name, "Captiono");
  assert.equal(manifest.minimum_chrome_version, "139");
  assert.equal(manifest.incognito, "not_allowed");
  assert.deepEqual(manifest.permissions, ["scripting", "storage"]);
  assert.equal(manifest.side_panel, undefined);
  assert.deepEqual(manifest.background, {
    service_worker: "background.js",
    type: "module",
  });
  assert.equal(manifest.action.default_title, "显示或隐藏 Captiono");
  assert.deepEqual(manifest.host_permissions, [
    "https://*.youtube.com/*",
    "https://www.bilibili.com/*",
    "https://api.bilibili.com/*",
    "https://*.hdslb.com/*",
  ]);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.deepEqual(manifest.content_security_policy, {
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src https://*.bilibili.com https://*.hdslb.com",
  });

  const matches = manifest.content_scripts.flatMap((entry) => entry.matches);
  assert.ok(!matches.some((match) => match.includes("ted.com")));
  assert.ok(matches.includes("https://*.youtube.com/*"));
  assert.ok(matches.includes("https://www.bilibili.com/*"));
  assert.ok(!matches.includes("<all_urls>"));
  assert.deepEqual(manifest.content_scripts[0].js, [
    "content-script.js",
    "caption-review-ui.js",
  ]);
  assert.ok(
    manifest.content_scripts.every(
      (entry) => !entry.js?.includes("youtube-player-bridge.js"),
    ),
  );
});

test("keeps media commands inside each tab and provider requests tightly scoped", async () => {
  const [
    background,
    contentScript,
    playerBridge,
    panelSource,
    panelStyles,
    appSource,
    storageSource,
    mediaBridgeSource,
  ] =
    await Promise.all([
      readFile(path.join(extensionSource, "background.js"), "utf8"),
      readFile(path.join(extensionSource, "content-script.js"), "utf8"),
      readFile(path.join(extensionSource, "youtube-player-bridge.js"), "utf8"),
      readFile(path.join(root, "src/extension.jsx"), "utf8"),
      readFile(path.join(root, "src/styles.css"), "utf8"),
      readFile(path.join(root, "src/App.jsx"), "utf8"),
      readFile(path.join(root, "src/lib/storage.js"), "utf8"),
      readFile(path.join(root, "src/hooks/useMediaBridge.js"), "utf8"),
    ]);

  for (const command of ["GET_MEDIA_STATE", "SEEK_TO", "TOGGLE_PLAY"]) {
    assert.match(contentScript, new RegExp(`"${command}"`));
    assert.doesNotMatch(background, new RegExp(`"${command}"`));
  }

  assert.match(contentScript, /__captionReviewPageBridge/);
  assert.match(contentScript, /pageBridgeListeners/);
  assert.match(contentScript, /pendingAutomaticRefresh/);
  assert.match(contentScript, /function handleRuntimeMessage\(/);
  assert.match(
    contentScript,
    /onMessage\.removeListener\?\.\(handleRuntimeMessage\)/,
  );
  assert.match(contentScript, /bindingMediaId:\s*`\$\{mediaId\}:p\$\{page\}`/);
  assert.match(contentScript, /type:\s*"MEDIA_STATE"/);
  assert.doesNotMatch(
    contentScript,
    /sendRuntimeMessage\(\{\s*type:\s*"(?:MEDIA_STATE|CAPTION_STATE)"/,
  );
  assert.match(contentScript, /message\?\.play === true/);
  assert.match(contentScript, /await video\.play\(\)/);
  assert.match(contentScript, /PUBLISH_INTERVAL_MS\s*=\s*500/);
  assert.doesNotMatch(contentScript, /TRACK_RETRY_INTERVAL_MS/);
  assert.doesNotMatch(contentScript, /retryIntervalId/);
  for (const stateKey of [
    "connected",
    "currentTime",
    "duration",
    "paused",
    "title",
    "url",
  ]) {
    assert.match(contentScript, new RegExp(`\\b${stateKey}:`));
  }

  for (const forbidden of [
    "textTracks",
    "innerText",
    "textContent",
    "XMLHttpRequest",
    "transcript",
  ]) {
    assert.ok(
      !contentScript.includes(forbidden),
      `content script must not contain ${forbidden}`,
    );
  }

  assert.match(contentScript, /ytInitialPlayerResponse/);
  assert.match(contentScript, /url\.origin !== currentUrl\.origin/);
  assert.match(contentScript, /url\.pathname !== "\/api\/timedtext"/);
  assert.match(contentScript, /fetchCaptionJson3\(candidate\.baseUrl\)/);
  assert.match(contentScript, /CAPTURE_YOUTUBE_PLAYER_CAPTION_URL/);
  assert.match(contentScript, /YOUTUBE_PLAYER_CAPTION_SOURCE/);
  assert.match(contentScript, /youtubePlayerManifestTracks/);
  assert.match(contentScript, /discoverOnly:\s*true/);
  assert.match(contentScript, /allowPlayerInteraction/);
  assert.doesNotMatch(contentScript, /["'`]https:\/\/[^"'`]*timedtext/);
  assert.doesNotMatch(contentScript, /\beval\s*\(/);
  assert.doesNotMatch(contentScript, /\bFunction\s*\(/);

  assert.match(playerBridge, /getOption\("captions", "tracklist"\)/);
  assert.match(playerBridge, /loadModule\?\.\("captions"\)/);
  assert.match(playerBridge, /request\?\.discoverOnly/);
  assert.match(playerBridge, /setOption\("captions", "track", track\)/);
  assert.match(playerBridge, /new PerformanceObserver/);
  assert.match(playerBridge, /url\.origin !== location\.origin/);
  assert.match(playerBridge, /url\.pathname !== "\/api\/timedtext"/);
  assert.doesNotMatch(playerBridge, /\bfetch\s*\(/);
  assert.doesNotMatch(playerBridge, /\bpostMessage\s*\(/);
  assert.doesNotMatch(playerBridge, /\bchrome\./);
  assert.doesNotMatch(playerBridge, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(playerBridge, /\beval\s*\(/);
  assert.doesNotMatch(playerBridge, /\bFunction\s*\(/);

  assert.match(
    background,
    /import \{ captureYouTubeCaptionUrl \} from "\.\/youtube-player-bridge\.js"/,
  );
  assert.match(background, /chrome\.action\.onClicked\.addListener\(\(tab\)/);
  assert.match(background, /target:\s*\{ tabId, frameIds:\s*\[0\] \}/);
  assert.match(
    background,
    /files:\s*\["content-script\.js", "caption-review-ui\.js"\]/,
  );
  assert.doesNotMatch(background, /chrome\.tabs\.query/);
  assert.doesNotMatch(background, /chrome\.sidePanel/);
  assert.match(background, /world:\s*"MAIN"/);
  assert.match(background, /message\?\.discoverOnly === true/);
  assert.match(background, /sender\.frameId !== 0/);
  assert.match(background, /loadBilibiliCaptions/);
  assert.match(background, /function normalizeBilibiliRequest\(message, sender\)/);
  assert.match(background, /url\.pathname\.match\(\/\\\/video\\\//);
  assert.match(background, /Resolve the current URL identity again/);
  assert.doesNotMatch(background, /loadBilibiliCaptions\(message\)/);
  assert.doesNotMatch(background, /chrome\.tabCapture/);
  assert.doesNotMatch(background, /chrome\.offscreen/);

  assert.match(panelSource, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.match(panelSource, /styles from "\.\/styles\.css\?inline"/);
  assert.match(panelSource, /__captionReviewPanelRuntimeInstalled/);
  assert.match(panelSource, /inert=\{!open\}/);
  assert.doesNotMatch(panelSource, /sessionStorage|localStorage/);
  assert.match(panelSource, /function createPanelCommandChannel\(\)/);
  assert.match(
    panelSource,
    /commandChannel\.publish\(mountedPanel \? message\.type : PANEL_OPEN_COMMAND\)/,
  );
  assert.match(
    panelSource,
    /if \(!isSupportedVideoPage\(\)\) \{[\s\S]*?handled: false/,
  );
  assert.match(panelSource, /event\.stopPropagation\(\)/);
  assert.match(panelSource, /YOUTUBE_EMBED_SELECTOR\s*=\s*"ytd-watch-flexy #secondary"/);
  assert.match(panelSource, /querySelector\(":scope > #secondary-inner"\)/);
  assert.match(panelSource, /BILIBILI_LAYOUT_SELECTORS/);
  assert.match(panelSource, /BILIBILI_DANMAKU_SELECTORS/);
  assert.match(panelSource, /"\.danmaku-box"/);
  assert.match(panelSource, /"#danmukuBox"/);
  assert.match(panelSource, /:scope > \.left-container/);
  assert.match(panelSource, /:scope > \.right-container/);
  assert.match(panelSource, /const container = danmaku\.parentElement/);
  assert.match(
    panelSource,
    /return \{[\s\S]*before: danmaku,[\s\S]*container,[\s\S]*player,[\s\S]*rightColumn,[\s\S]*\};/,
  );
  assert.doesNotMatch(panelSource, /while \(anchor\.parentElement/);
  assert.match(panelSource, /data-caption-review", "in-page-module"/);
  assert.match(
    panelSource,
    /insertHost\(mountPoint\.container, host, mountPoint\.before\)/,
  );
  assert.match(panelSource, /isNodeBefore\(host, mountPoint\.before\)/);
  assert.match(panelSource, /function panelNeedsPlacement\(host\)/);
  assert.match(panelSource, /let observedUrl = location\.href/);
  assert.match(panelSource, /event\.persisted/);
  assert.match(panelSource, /"currententrychange"/);
  assert.match(panelSource, /panelNeedsPlacement\(mountedPanel\.host\)/);
  assert.doesNotMatch(panelSource, /new MutationObserver\(scheduleSync\)/);
  assert.doesNotMatch(panelSource, /setInterval\(syncPanel,\s*600\)/);
  for (const eventName of [
    "click",
    "contextmenu",
    "dblclick",
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
  ]) {
    assert.match(panelSource, new RegExp(`"${eventName}"`));
  }
  for (const eventName of [
    "mouseover",
    "mouseout",
    "pointerover",
    "pointerout",
  ]) {
    assert.doesNotMatch(panelSource, new RegExp(`"${eventName}"`));
  }
  assert.match(panelSource, /shadow\.addEventListener\(eventName, stopPageEvent\)/);
  assert.doesNotMatch(panelSource, /document\.documentElement\.append\(host\)/);
  assert.doesNotMatch(panelSource, /PANEL_WIDTH_KEY|caption-review-resize-handle/);
  assert.match(panelStyles, /:host\s*\{[^}]*position:\s*relative\s*!important/s);
  assert.match(
    panelStyles,
    /:host\s*\{[^}]*background:\s*transparent\s*!important/s,
  );
  assert.match(
    panelStyles,
    /:host\s*\{[^}]*pointer-events:\s*none\s*!important/s,
  );
  assert.match(
    panelStyles,
    /\.caption-review-panel-surface\s*\{[^}]*pointer-events:\s*auto/s,
  );
  assert.doesNotMatch(
    panelStyles,
    /:host\s*\{[^}]*position:\s*fixed\s*!important/s,
  );
  assert.match(panelStyles, /caption-review-launcher__copy/);
  assert.match(panelSource, /<strong>Captiono<\/strong>/);
  assert.match(panelSource, /从视频字幕里标记表达与笔记/);
  assert.doesNotMatch(panelSource, />字幕研读</);
  const launcherHoverRule =
    panelStyles.match(/\.caption-review-launcher:hover\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.doesNotMatch(launcherHoverRule, /transform:/);
  assert.match(
    panelStyles,
    /\.prototype-stage\.is-embedded \.caption-panel\s*\{[^}]*transition:\s*none/s,
  );
  assert.match(panelStyles, /:host\s*\{[^}]*transition:\s*none\s*!important/s);
  assert.match(
    panelStyles,
    /:host\s*\{[^}]*contain:\s*layout inline-size style\s*!important/s,
  );
  assert.match(panelStyles, /scrollbar-gutter:\s*stable/);
  assert.match(
    panelStyles,
    /\.prototype-stage\.is-embedded \.transcript-row,[\s\S]*transition:\s*none/,
  );
  const timeIconRule =
    panelStyles.match(/\.transcript-row__time svg\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.doesNotMatch(timeIconRule, /transform:/);
  assert.match(panelStyles, /container-type:\s*inline-size/);
  assert.match(panelStyles, /@container \(max-width: 460px\)/);
  assert.match(
    panelStyles,
    /\.caption-panel\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
  );
  assert.match(
    panelStyles,
    /\.prototype-stage\.is-embedded\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%/s,
  );
  assert.match(
    panelStyles,
    /\.prototype-stage\.is-embedded \.caption-panel\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%/s,
  );
  assert.doesNotMatch(
    panelStyles,
    /\.prototype-stage\.is-extension\.is-embedded/,
  );
  assert.match(
    panelStyles,
    /\.source-header,[\s\S]*\.transcript-row\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%/s,
  );
  assert.match(
    panelStyles,
    /:host\(\[data-platform="bilibili"\]\[data-open="true"\]\)\s*\{[^}]*height:\s*clamp\(360px, 56vh, 560px\)/s,
  );
  assert.match(appSource, /function selectionContextWithin\(container\)/);
  assert.match(appSource, /getComposedRanges/);
  assert.match(appSource, /className="comment-popover"/);
  assert.match(appSource, />\s*添加批注\s*</);
  assert.match(appSource, />\s*复制全部字幕\s*</);
  assert.match(appSource, /formatTranscriptForClipboard\(document\)/);
  assert.match(appSource, /onClick=\{\(\) => onPlay\(sentence\)\}/);
  assert.match(appSource, /playFromSentence\(sentence\.startMs\)/);
  assert.match(appSource, /title="从这里播放"/);
  assert.match(appSource, /aria-label="定位当前播放字幕"/);
  assert.match(appSource, /CAPTION_FOLLOW_MODE\.MANUAL/);
  assert.match(appSource, /回到当前 \{formatTime\(activeSentence\.startMs\)\}/);
  assert.match(appSource, /addEventListener\("wheel", markManual/);
  assert.match(appSource, /CAPTION_FOLLOW_EVENT\.SEEK_SETTLED/);
  assert.match(appSource, /value: "system", label: "系统"/);
  assert.match(appSource, /value: "light", label: "浅色"/);
  assert.match(appSource, /value: "dark", label: "深色"/);
  assert.match(appSource, /prefers-color-scheme: dark/);
  assert.match(appSource, /target\.dataset\.theme = resolvedTheme/);
  assert.match(appSource, /startTransition\(\(\) =>/);
  assert.match(appSource, /target\.dataset\.themeChanging = "true"/);
  assert.match(appSource, /role="switch"/);
  assert.match(appSource, />\s*显示重点短语\s*</);
  assert.match(appSource, /density: "standard"/);
  assert.doesNotMatch(appSource, /短语密度：/);
  assert.match(panelStyles, /:host\(\[data-theme="dark"\]\)/);
  assert.match(panelStyles, /data-theme-changing="true"/);
  assert.match(panelStyles, /--paper:\s*#191a17/);
  assert.match(appSource, /scrollSentenceToFollowPosition/);
  assert.match(appSource, /const TranscriptRow = memo\(function TranscriptRow/);
  assert.match(appSource, /function findActiveSentence\(sentences, currentMs\)/);
  assert.match(appSource, /function useStableEvent\(handler\)/);
  assert.match(appSource, /container\.clientHeight \/ 3/);
  assert.match(appSource, /container\.scrollTo\(\{/);
  assert.match(appSource, /className="comment-popover thread-editor-popover"/);
  assert.match(appSource, /className="annotation-inline-marker"/);
  assert.match(appSource, /data-selection-ignore=""/);
  assert.match(appSource, /rangeTextLengthIgnoringUi/);
  assert.match(
    appSource,
    /annotations=\{\s*annotationsBySentence\.get\(sentence\.id\) \?\? EMPTY_LIST\s*\}/,
  );
  assert.match(appSource, /preferredThreadId/);
  assert.match(appSource, /thread-editor-popover__tabs/);
  assert.match(appSource, /closeOnOutsidePointer/);
  assert.match(
    appSource,
    /listenForShadowAwarePointerDown\(\s*transcriptRef\.current,\s*closeOnOutsidePointer,\s*true/s,
  );
  assert.match(appSource, /ownerDocument\.addEventListener\("pointerdown"/);
  assert.match(appSource, /node\.closest\?\.\("\.comment-popover"\)/);
  assert.doesNotMatch(appSource, /setExpandedSentenceId\(sentence\.id\)/);
  assert.doesNotMatch(appSource, /打开内置演示|openDemoDocument/);
  assert.doesNotMatch(
    appSource,
    /Object\.entries\(KIND_META\)\.map\(\(\[kind, meta\]\)/,
  );
  assert.match(panelStyles, /\.comment-popover\s*\{/);
  assert.match(
    panelStyles,
    /\.selection-toolbar button\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s,
  );
  assert.match(appSource, /toolbarMaxWidth/);
  assert.match(appSource, /editorWidth/);
  assert.match(
    appSource,
    /import \{[\s\S]*?rectRelativeTo,[\s\S]*?\} from "\.\/lib\/floatingGeometry\.js"/,
  );
  for (const selector of [
    "phrase-tooltip",
    "selection-toolbar",
    "comment-popover",
  ]) {
    assert.match(
      panelStyles,
      new RegExp(`\\.${selector}\\s*\\{[^}]*position:\\s*absolute`, "s"),
    );
  }
  assert.match(mediaBridgeSource, /function mergeMediaState\(current, next\)/);
  assert.match(mediaBridgeSource, /return changed \? \{ \.\.\.current, \.\.\.next \} : current/);
  assert.match(storageSource, /EXTENSION_RECORD_PREFIX/);
  assert.match(storageSource, /chrome\?\.storage\?\.local/);
  assert.match(storageSource, /extensionRecordKey\("threads", documentId\)/);
  assert.match(storageSource, /let extensionMutationQueue = Promise\.resolve\(\)/);
  assert.match(storageSource, /extensionMutationQueue = operation\.catch/);
  assert.doesNotMatch(
    storageSource,
    /catch\s*\{\s*return \{ available: true, value: null \};\s*\}/,
  );
  assert.match(storageSource, /let settingsWriteQueue = Promise\.resolve\(\)/);
  assert.match(storageSource, /settingsWriteQueue = operation\.catch/);
  assert.match(appSource, /RUNTIME_BUILD\.isExtension/);
  assert.match(appSource, /暂停写入以保护现有数据/);
  assert.match(panelStyles, /content-visibility:\s*auto/);
  assert.doesNotMatch(
    appSource,
    /已读取 \$\{nextDocument\.sentences\.length\} 句/,
  );
  assert.match(appSource, /aria-label="搜索字幕或短语"/);
  assert.match(appSource, /autoComplete="off"/);
  assert.match(appSource, /name="caption-search"/);
  assert.match(appSource, /aria-label=\{`\$\{meta\.label\}内容`\}/);
});

test("limits automatic caption collection to supported video pages and meaningful track changes", async () => {
  const contentScript = await readFile(
    path.join(extensionSource, "content-script.js"),
    "utf8",
  );

  const publishState = sourceSection(
    contentScript,
    "function publishState()",
    "function containsCaptionNode(",
  );
  assert.ok(
    publishState.indexOf("if (!isSupportedVideoPage())") <
      publishState.indexOf("const state = mediaState(video)"),
    "the periodic publisher must reject non-video pages before scanning media geometry",
  );
  assert.match(
    contentScript,
    /if \(isSupportedVideoPage\(\)\) void refreshCaptionsAutomatically\(\)/,
  );

  const mutationFilter = sourceSection(
    contentScript,
    "function isCaptionAttributeMutation(",
    "mutationObserver = new MutationObserver",
  );
  assert.match(
    mutationFilter,
    /tagName === "track"[\s\S]*\["kind", "label", "src", "srclang"\]/,
  );
  assert.match(
    mutationFilter,
    /mutation\.attributeName === "src"[\s\S]*tagName === "video" \|\| tagName === "source"/,
  );
  const mutationObserver = sourceSection(
    contentScript,
    "mutationObserver = new MutationObserver",
    "intervalId = setInterval",
  );
  assert.match(
    mutationObserver,
    /if \(!youtubeVideoId\(\) \|\| !isSupportedVideoPage\(\)\) return/,
    "Bilibili captions come from the provider API and must not observe host-page DOM churn",
  );
  assert.doesNotMatch(
    mutationObserver,
    /observe\(document\.documentElement/,
    "caption discovery must never scan the entire Bilibili or YouTube document",
  );
  assert.doesNotMatch(
    mutationObserver,
    /attributes: true|attributeFilter/,
    "the document-wide observer must not react to image/picture source churn",
  );
  assert.doesNotMatch(
    mutationFilter,
    /mutation\.attributeName === "src"\s*\)\s*return true/,
  );
  const primaryMediaFilter = sourceSection(
    contentScript,
    "function trackOrSourceBelongsToPrimaryVideo(",
    "function containsCaptionNode(",
  );
  assert.match(primaryMediaFilter, /node\?\.closest\?\.\("video"\)/);
  assert.match(primaryMediaFilter, /isPotentialPrimaryVideo\(ownerVideo\)/);
  assert.match(
    mutationFilter,
    /\(tagName === "video" \|\| tagName === "source"\)[\s\S]*!trackOrSourceBelongsToPrimaryVideo\(mutation\.target\)[\s\S]*return false/,
    "a <picture><source> or preview source must not schedule a caption refresh",
  );
  const scopedAttributeObserver = sourceSection(
    contentScript,
    "function observePrimaryVideoCaptionAttributes(",
    "mutationObserver = new MutationObserver",
  );
  assert.match(scopedAttributeObserver, /captionAttributeObserver\.observe\(video/);
  assert.match(scopedAttributeObserver, /attributes: true/);
  assert.match(scopedAttributeObserver, /attributeFilter: \["kind", "label", "src", "srclang"\]/);
  const scopedStructureObserver = sourceSection(
    contentScript,
    "function youtubeCaptionMutationTarget(video)",
    "function isCaptionAttributeMutation(",
  );
  assert.match(
    scopedStructureObserver,
    /function youtubeCaptionMutationTarget\(video\)/,
  );
  assert.match(
    scopedStructureObserver,
    /video\?\.closest\?\.\("#movie_player"\)/,
  );
  assert.match(
    scopedStructureObserver,
    /mutationObserver\?\.observe\(target, \{[\s\S]*childList: true,[\s\S]*subtree: true/,
    "YouTube structure observation must stay scoped to the native player",
  );

  const trackObserver = sourceSection(
    contentScript,
    "function observeTracks(",
    "function publishToPageBridge(",
  );
  assert.match(trackObserver, /if \(internalTrackEventsAreSuppressed\(\)\) return/);
  assert.match(
    trackObserver,
    /const currentSelectedTrackId =[\s\S]*captionState\.document\?\.selectedTrackId \|\| selectedTrackId/,
  );
  assert.match(
    trackObserver,
    /if \(candidate\.id !== currentSelectedTrackId\) return/,
  );

  const waitForTrack = sourceSection(
    contentScript,
    "async function waitForTrack(",
    "async function refreshManifestCaptions(",
  );
  assert.match(
    waitForTrack,
    /suppressInternalTrackEvents\(\);\s*candidate\.track\.mode = "hidden"/,
  );
  assert.match(
    waitForTrack,
    /suppressInternalTrackEvents\(\);\s*candidate\.track\.mode = originalMode/,
  );
});

test("keeps the last successful transcript only for the same active media", async () => {
  const [appSource, contentScript] = await Promise.all([
    readFile(path.join(root, "src/App.jsx"), "utf8"),
    readFile(path.join(extensionSource, "content-script.js"), "utf8"),
  ]);

  const readyDocumentEffect = sourceSection(
    appSource,
    "useEffect(() => {\n    if (\n      captionBridge.status !== CAPTION_STATUS.READY",
    "useEffect(() => {\n    if (!toast)",
  );
  assert.match(readyDocumentEffect, /!captionBridge\.document/);
  assert.match(readyDocumentEffect, /setDocument\(nextDocument\)/);
  assert.doesNotMatch(
    readyDocumentEffect,
    /CAPTION_STATUS\.(?:ERROR|EMPTY)/,
    "transient empty/error bridge states must not replace the last ready document",
  );

  const activeMediaGate = sourceSection(
    appSource,
    "const documentMediaId =",
    "const waitingForCurrentCaption =",
  );
  assert.match(
    activeMediaGate,
    /const bindingMatchesDocument = \(mediaId, provider\) =>[\s\S]*!mediaId \|\|[\s\S]*documentMediaId === mediaId/,
    "an empty transient binding should not hide the same-media transcript",
  );
  assert.match(
    activeMediaGate,
    /bindingMatchesDocument\(liveMediaId, liveProvider\)[\s\S]*bindingMatchesDocument\(bridgeMediaId, bridgeProvider\)/,
    "both known media identities must agree with the rendered document",
  );
  assert.match(
    activeMediaGate,
    /const currentCaptionReady =[\s\S]*activeMediaMatchesDocument/,
  );
  assert.match(
    activeMediaGate,
    /const renderedSentences = currentCaptionReady \? visibleSentences : \[\]/,
    "a media switch must hide the previous video's transcript immediately",
  );
  assert.doesNotMatch(
    activeMediaGate,
    /captionBridge\.status/,
    "same-media error/empty states must not blank an otherwise matching document",
  );

  const mediaChange = sourceSection(
    contentScript,
    "const mediaKeyChanged = nextMediaKey !== previousMediaKey",
    "function scriptMayContainCaptionData(",
  );
  assert.match(
    mediaChange,
    /if \(mediaKeyChanged \|\| primaryVideoChanged\)/,
    "a late or replaced primary video must refresh even when the logical media key stays stable",
  );
  assert.match(mediaChange, /status: "loading"/);
  assert.match(
    mediaChange,
    /reason: mediaKeyChanged[\s\S]*\? "media-binding-changed"[\s\S]*: "primary-video-changed"/,
  );
  assert.match(mediaChange, /document: null/);
  assert.match(mediaChange, /mediaBinding: state\.mediaBinding/);

  const bindingGuards = sourceSection(
    contentScript,
    "function mediaBindingsMatch(",
    "function mediaState(video = primaryVideo())",
  );
  assert.match(bindingGuards, /left\.provider === right\.provider/);
  assert.match(bindingGuards, /left\.mediaId === right\.mediaId/);
  assert.match(bindingGuards, /function refreshMediaIsCurrent\(video, startBinding\)/);

  for (const [startMarker, endMarker] of [
    [
      "async function refreshManifestCaptions(video, request, version)",
      "async function refreshBilibiliCaptions(video, request, version)",
    ],
    [
      "async function refreshCaptions(request = {})",
      "async function refreshCaptionsForUser(request = {})",
    ],
  ]) {
    const refreshFlow = sourceSection(contentScript, startMarker, endMarker);
    assert.ok(
      refreshFlow.indexOf("const startBinding = mediaBinding(video)") <
        refreshFlow.indexOf("await "),
      "each async refresh must freeze its media identity before the first await",
    );
    assert.match(
      refreshFlow,
      /if \(!refreshMediaIsCurrent\(video, startBinding\)\)/,
      "old cues must be rejected when a SPA navigation reuses the video element",
    );
  }
});

test("gates stale-caption controls and locates rows without a full transcript scan", async () => {
  const appSource = await readFile(path.join(root, "src/App.jsx"), "utf8");

  assert.match(
    appSource,
    /selection=\{currentCaptionReady \? selection : null\}/,
    "a stale media transition must not leave the selection toolbar visible",
  );
  assert.match(
    appSource,
    /draft=\{currentCaptionReady \? draft : null\}/,
    "a stale media transition must not leave a detached comment editor visible",
  );
  assert.match(
    appSource,
    /editor=\{currentCaptionReady \? threadEditor : null\}/,
    "a stale media transition must not leave a detached thread editor visible",
  );
  assert.match(appSource, /const restorePopoverFocus = \(surface\) =>/);
  assert.match(appSource, /onCancel=\{cancelDraft\}/);
  assert.match(appSource, /onCancel=\{cancelThreadEditor\}/);

  const focusedSentence = sourceSection(
    appSource,
    "const focusedSentence = useMemo",
    "const floatingDraft",
  );
  assert.match(focusedSentence, /if \(!currentCaptionReady\) return null/);

  const shortcuts = sourceSection(
    appSource,
    "const handleShortcut = (event) =>",
    "eventRoot.addEventListener(\"keydown\", handleShortcut)",
  );
  assert.match(
    shortcuts,
    /currentCaptionReady &&[\s\S]*event\.key\.toLowerCase\(\) === "c"/,
  );

  const resumeControl = sourceSection(
    appSource,
    '<div className={`workbench${drawerOpen ? " has-drawer" : ""}`}>',
    '<section\n              aria-label="英文字幕"',
  );
  assert.match(
    resumeControl,
    /activeTab === "transcript" &&\s*currentCaptionReady &&\s*captionFollowMode === CAPTION_FOLLOW_MODE\.MANUAL/,
  );

  const scrollToSentence = sourceSection(
    appSource,
    "const scrollSentenceToFollowPosition = useCallback",
    "useEffect(() => {\n    if (\n      !activeSentenceId",
  );
  assert.match(scrollToSentence, /globalThis\.CSS\?\.escape/);
  assert.match(scrollToSentence, /container\.querySelector\(/);
  assert.doesNotMatch(scrollToSentence, /querySelectorAll|Array\.from/);
});

test("revalidates the bounded Bilibili mount and detaches from unsafe layouts", async () => {
  const panelSource = await readFile(
    path.join(root, "src/extension.jsx"),
    "utf8",
  );

  const bilibiliMount = sourceSection(
    panelSource,
    "function rectanglesOverlap(",
    "function findMountPoint()",
  );
  assert.match(bilibiliMount, /function bilibiliPlacementIsSafe\(/);
  assert.match(
    bilibiliMount,
    /const containerRect = container\.getBoundingClientRect\(\)/,
  );
  assert.match(
    bilibiliMount,
    /containerRect\.width >= 320[\s\S]*containerRect\.width <= 480/,
  );
  assert.match(
    bilibiliMount,
    /playerRect\.width >= 320[\s\S]*playerRect\.height >= 180/,
  );
  assert.match(
    bilibiliMount,
    /!rectanglesOverlap\(containerRect, playerRect\)/,
    "the native player and Captiono mount column must not overlap",
  );
  assert.match(
    bilibiliMount,
    /return \{[\s\S]*before: danmaku,[\s\S]*container,[\s\S]*player,[\s\S]*rightColumn,[\s\S]*\};/,
    "Captiono must stay after Bilibili's profile card and directly before the danmaku module",
  );

  const mountObserver = sourceSection(
    panelSource,
    "const observeMountContainer = (host) =>",
    "const handlePanelMessage",
  );
  assert.match(mountObserver, /new ResizeObserver\(\(\) =>/);
  assert.match(mountObserver, /placementDirty = true;\s*scheduleSync\(\)/);
  assert.match(mountObserver, /mountResizeObserver\.observe\(container\)/);
  assert.match(
    mountObserver,
    /mountResizeObserver\.observe\(placement\.nativeRightNav\)/,
  );
  assert.match(
    mountObserver,
    /mountResizeObserver\.observe\(placement\.nativeSearch\)/,
  );
  assert.match(mountObserver, /mountResizeObserver\.observe\(placement\.player\)/);
  assert.doesNotMatch(
    panelSource,
    /mountAttributeObserver|attributeFilter: \["class", "style"\]/,
    "Bilibili hover and responsive class changes must not trigger placement passes",
  );
  assert.match(
    mountObserver,
    /rejectedMountPlacement\.url === location\.href[\s\S]*rejectedMountPlacement\.container === placement\.container[\s\S]*rejectedMountPlacement\.before === placement\.before/,
    "a host-page removal must reject the exact URL, container, and anchor tuple",
  );
  assert.match(
    panelSource,
    /const rememberOwnedHostMutation = \(kind, host, parent\) =>[\s\S]*const consumeOwnedHostMutation = \(kind, host, parent\) =>/,
    "Captiono-owned insert/remove records must be distinguishable from host-page moves",
  );
  assert.match(
    mountObserver,
    /for \(const node of mutation\.removedNodes\)[\s\S]*for \(const node of mutation\.addedNodes\)[\s\S]*return moved/,
    "a remove/reorder must trip the circuit even if Bilibili reconnects the host in the same mutation batch",
  );

  const syncPanel = sourceSection(
    panelSource,
    "const syncPanel = () =>",
    "const resetForUrlChange = () =>",
  );
  assert.match(
    syncPanel,
    /placementDirty \|\| panelNeedsPlacement\(mountedPanel\.host\)/,
  );
  assert.match(
    syncPanel,
    /if \(!mountedPanel\.host\.isConnected\)[\s\S]*rejectMountedBilibiliPlacement\(\)/,
  );
  assert.match(
    syncPanel,
    /const mountPoint = resolveBilibiliMountPoint\(\{ force: forceMount \}\);[\s\S]*if \(!mountPoint\) return;[\s\S]*installPanel\(commandChannel, mountPoint/,
    "React and its host must not be created until a safe mount point passes the gate",
  );
  assert.doesNotMatch(
    syncPanel,
    /installPanel\(commandChannel\)(?!,)/,
    "the Bilibili path must never create a detached host while waiting",
  );

  const documentLayoutObserver = sourceSection(
    panelSource,
    "const layoutObserver = new MutationObserver",
    "globalThis.addEventListener(\"popstate\"",
  );
  assert.match(documentLayoutObserver, /panelNeedsStructuralPlacement/);
  assert.match(documentLayoutObserver, /hostWasExternallyMoved/);
  assert.match(documentLayoutObserver, /mutationMayReplacePlacement/);
  assert.doesNotMatch(
    documentLayoutObserver,
    /panelNeedsPlacement|getBoundingClientRect/,
    "document-wide DOM churn must not run Bilibili geometry checks",
  );
  assert.match(panelSource, /globalThis\.addEventListener\("resize", handleViewportResize/);
  assert.match(panelSource, /globalThis\.removeEventListener\("resize", handleViewportResize\)/);
  assert.match(
    panelSource,
    /document\.readyState !== "complete"[\s\S]*return null/,
    "neither automatic nor explicit mounting may interrupt Bilibili hydration",
  );
  assert.match(
    panelSource,
    /BILIBILI_MOUNT_STABILITY_MS = 8000/,
    "Bilibili must remain ready for at least eight seconds before first insertion",
  );
  assert.match(
    panelSource,
    /sameGeneration[\s\S]*stableSince: now[\s\S]*structureQuietSince: now[\s\S]*Math\.max\([\s\S]*BILIBILI_MOUNT_STABILITY_MS,[\s\S]*BILIBILI_MOUNT_STRUCTURE_QUIET_MS/,
    "each URL/native-anchor generation must remain stable before automatic mounting",
  );
  assert.match(
    panelSource,
    /BILIBILI_SEARCH_SELECTORS[\s\S]*#nav-searchform[\s\S]*\.center-search-container/,
    "a visible native search control must exist before Captiono mounts",
  );
  assert.match(
    panelSource,
    /function bilibiliNativeSearch\(\)[\s\S]*candidate\.querySelector\([\s\S]*input, button,[\s\S]*nativeElementIsVisible\(control, 24, 20\)/,
    "an empty search shell must not count as the hydrated native search control",
  );
  assert.match(
    panelSource,
    /function nativeElementIsVisible\([\s\S]*getComputedStyle[\s\S]*pointerEvents !== "none"/,
    "hidden or non-interactive header placeholders must not satisfy the hydration gate",
  );
  assert.match(
    panelSource,
    /function topLevelNativeNavItems\([\s\S]*Array\.from\(candidate\.children\)[\s\S]*function shallowNativeNavSignal/,
    "popover descendants must not be counted as separate hydrated account actions",
  );
  assert.match(
    panelSource,
    /function nativeNavCategory\([\s\S]*return "profile"[\s\S]*return "login"[\s\S]*return "message"[\s\S]*return "dynamic"[\s\S]*return "favorite"[\s\S]*return "history"[\s\S]*return "creator"/,
    "the gate must recognize semantic top-level account navigation rather than a raw action count",
  );
  assert.match(
    panelSource,
    /if \(!categories\.has\("profile"\) && !categories\.has\("login"\)\) return false;[\s\S]*supportingCount >= 3/,
    "both signed-in and signed-out headers need an account entry plus several native navigation categories",
  );
  assert.doesNotMatch(
    panelSource,
    /visibleNativeActionCount|BILIBILI_MIN_VISIBLE_NAV_ACTIONS/,
    "an upload button and nested popover buttons must never satisfy the gate by count alone",
  );
  assert.match(
    panelSource,
    /nativeSearch === mountPoint\.nativeSearch[\s\S]*signature === signature/,
    "search hydration and semantic personal navigation must remain stable for the full mount gate",
  );
  assert.match(
    panelSource,
    /function bilibiliNativeHeader\(nativeSearch, nativeRightNav\)[\s\S]*candidate\.contains\(nativeSearch\)[\s\S]*candidate\.contains\(nativeRightNav\)/,
    "the readiness generation must be rooted in the native header containing search and account navigation",
  );
  assert.match(
    panelSource,
    /nativeHeader === mountPoint\.nativeHeader/,
    "replacing the hydrated native header must start a new eight-second generation",
  );
  assert.match(
    panelSource,
    /const observeBilibiliHydrationSubtree[\s\S]*new MutationObserver\([\s\S]*stableSince = Date\.now\(\)[\s\S]*armBilibiliMountGate\(BILIBILI_MOUNT_STABILITY_MS\)/,
    "native header mutations must restart the full readiness window",
  );
  assert.match(
    panelSource,
    /bilibiliHydrationObserver\.observe\(nativeHeader,[\s\S]*attributeFilter:[\s\S]*"aria-hidden"[\s\S]*"class"[\s\S]*"hidden"[\s\S]*"style"[\s\S]*childList: true,[\s\S]*subtree: true/,
    "child-list and visibility-affecting attribute hydration in the native header must be observed",
  );
  assert.match(
    panelSource,
    /BILIBILI_MOUNT_STRUCTURE_QUIET_MS = 2400/,
  );
  assert.match(
    panelSource,
    /const mutationTouchesBilibiliMountStructure[\s\S]*mutation\.target === anchorParent[\s\S]*mutation\.target === rightColumn/,
    "direct child-list changes around the anchor or right column restart the quiet period",
  );
  assert.match(
    panelSource,
    /const resetBilibiliStructureQuietPeriod[\s\S]*structureQuietSince = Date\.now\(\)[\s\S]*armBilibiliMountGate\(BILIBILI_MOUNT_STRUCTURE_QUIET_MS\)/,
    "Captiono must wait after the last relevant native layout mutation before inserting",
  );
  assert.match(
    panelSource,
    /structurallyQuietFor < BILIBILI_MOUNT_STRUCTURE_QUIET_MS[\s\S]*BILIBILI_MOUNT_STRUCTURE_QUIET_MS - structurallyQuietFor/,
    "the mount resolver enforces the full structural quiet window",
  );
  assert.doesNotMatch(
    panelSource,
    /if \(force\) return mountPoint/,
    "an explicit extension click must not bypass Bilibili's hydration stability gate",
  );
  assert.match(
    panelSource,
    /if \(!mountPoint\)[\s\S]*armBilibiliMountGate\(force \? 120 : BILIBILI_MOUNT_RETRY_MS\)/,
    "a visibility-only search/nav transition must be retried even without a child-list mutation",
  );
  assert.match(
    panelSource,
    /const resetForUrlChange = \(\) =>[\s\S]*destroyMountedPanel\(\);[\s\S]*resetBilibiliMountGate\(nextUrl\)/,
    "SPA URL changes must start a fresh Bilibili stability generation",
  );
  assert.match(
    syncPanel,
    /if \(platform === "bilibili"\)[\s\S]*installPanel\(commandChannel, mountPoint, \{[\s\S]*initialOpen: false/,
    "automatic Bilibili insertion must start as the bounded 64px collapsed launcher",
  );
  assert.match(
    panelSource,
    /function EmbeddedCaptionReview\(\{[\s\S]*initialOpen = true[\s\S]*useState\(initialOpen\)/,
    "YouTube keeps the existing open default while Bilibili may opt into a collapsed first mount",
  );
  assert.match(
    panelSource,
    /commandChannel\.publish\(mountedPanel \? message\.type : PANEL_OPEN_COMMAND\)/,
    "an explicit toolbar command queued during the gate must expand the collapsed panel after mounting",
  );
});

test("keeps media commands bound to the platform player instead of hover previews", async () => {
  const contentScript = await readFile(
    path.join(root, "extension/content-script.js"),
    "utf8",
  );
  const videoSelection = sourceSection(
    contentScript,
    "function videoScore(video)",
    "function mediaBinding(video)",
  );
  assert.match(videoSelection, /function platformVideoSelector\(\)/);
  assert.match(videoSelection, /#movie_player video\.html5-main-video/);
  assert.match(videoSelection, /#bilibili-player video/);
  assert.match(videoSelection, /visibleArea \* 1_000/);
  assert.doesNotMatch(videoSelection, /1_000_000_000/);
  assert.match(
    videoSelection,
    /boundPrimaryVideo[\s\S]*candidates\.includes\(boundPrimaryVideo\)/,
  );

  const captionMutationFilter = sourceSection(
    contentScript,
    "function scriptMayContainCaptionData(",
    "mutationObserver = new MutationObserver",
  );
  assert.match(captionMutationFilter, /script\?\.text/);
  assert.match(captionMutationFilter, /isPotentialPrimaryVideo/);
  assert.match(captionMutationFilter, /trackOrSourceBelongsToPrimaryVideo/);
});

test("emits a self-contained unpacked in-page extension", async () => {
  const expectedFiles = [
    "manifest.json",
    "background.js",
    "bilibili-provider.js",
    "content-script.js",
    "youtube-player-bridge.js",
    "caption-review-ui.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
  ].sort();
  for (const file of expectedFiles) {
    await access(path.join(extensionDist, file));
  }

  const manifest = await readJson(path.join(extensionDist, "manifest.json"));
  assert.equal(manifest.side_panel, undefined);
  assert.ok(!manifest.permissions.includes("sidePanel"));
  assert.deepEqual(manifest.content_scripts[0].js, [
    "content-script.js",
    "caption-review-ui.js",
  ]);

  const panelBundle = await readFile(
    path.join(extensionDist, "caption-review-ui.js"),
    "utf8",
  );
  assert.match(panelBundle, /caption-review-extension-host/);
  assert.match(panelBundle, /TOGGLE_CAPTION_REVIEW_PANEL/);
  assert.doesNotMatch(panelBundle, /\bprocess\.env\.NODE_ENV\b/);
  assert.doesNotMatch(panelBundle, /sidepanel\.html/);

  const packageMetadata = await readJson(path.join(root, "package.json"));
  const archivePath = path.join(
    root,
    "dist",
    `captiono-${packageMetadata.version}.zip`,
  );
  await access(archivePath);
  const archiveFiles = execFileSync("unzip", ["-Z1", archivePath], {
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  assert.deepEqual(archiveFiles, expectedFiles);
  for (const file of expectedFiles) {
    const archived = execFileSync("unzip", ["-p", archivePath, file]);
    const unpacked = await readFile(path.join(extensionDist, file));
    assert.deepEqual(archived, unpacked, `${file} must match the release ZIP`);
  }
});
