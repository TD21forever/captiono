import assert from "node:assert/strict";
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

test("declares a scoped MV3 in-page extension for automatic captions", async () => {
  const manifest = await readJson(path.join(extensionSource, "manifest.json"));
  const packageMetadata = await readJson(path.join(root, "package.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageMetadata.version);
  assert.equal(manifest.name, "Captiono");
  assert.equal(manifest.minimum_chrome_version, "139");
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
  ] =
    await Promise.all([
      readFile(path.join(extensionSource, "background.js"), "utf8"),
      readFile(path.join(extensionSource, "content-script.js"), "utf8"),
      readFile(path.join(extensionSource, "youtube-player-bridge.js"), "utf8"),
      readFile(path.join(root, "src/extension.jsx"), "utf8"),
      readFile(path.join(root, "src/styles.css"), "utf8"),
      readFile(path.join(root, "src/App.jsx"), "utf8"),
      readFile(path.join(root, "src/lib/storage.js"), "utf8"),
    ]);

  for (const command of ["GET_MEDIA_STATE", "SEEK_TO", "TOGGLE_PLAY"]) {
    assert.match(contentScript, new RegExp(`"${command}"`));
    assert.doesNotMatch(background, new RegExp(`"${command}"`));
  }

  assert.match(contentScript, /__captionReviewPageBridge/);
  assert.match(contentScript, /pageBridgeListeners/);
  assert.match(contentScript, /pendingAutomaticRefresh/);
  assert.match(contentScript, /bindingMediaId:\s*`\$\{mediaId\}:p\$\{page\}`/);
  assert.match(contentScript, /type:\s*"MEDIA_STATE"/);
  assert.match(contentScript, /message\?\.play === true/);
  assert.match(contentScript, /await video\.play\(\)/);
  assert.match(contentScript, /PUBLISH_INTERVAL_MS\s*=\s*500/);
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
  assert.doesNotMatch(background, /chrome\.tabCapture/);
  assert.doesNotMatch(background, /chrome\.offscreen/);

  assert.match(panelSource, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(panelSource, /styles from "\.\/styles\.css\?inline"/);
  assert.match(panelSource, /__captionReviewPanelRuntimeInstalled/);
  assert.match(panelSource, /inert=\{!open\}/);
  assert.match(panelSource, /sessionStorage/);
  assert.match(panelSource, /event\.stopPropagation\(\)/);
  assert.match(panelSource, /YOUTUBE_EMBED_SELECTOR\s*=\s*"ytd-watch-flexy #secondary"/);
  assert.match(panelSource, /BILIBILI_LAYOUT_SELECTORS/);
  assert.match(panelSource, /BILIBILI_DANMAKU_SELECTORS/);
  assert.match(panelSource, /"\.danmaku-box"/);
  assert.match(panelSource, /"#danmukuBox"/);
  assert.match(panelSource, /:scope > \.left-container/);
  assert.match(panelSource, /:scope > \.right-container/);
  assert.match(
    panelSource,
    /return \{ before: anchor, container \}/,
  );
  assert.match(
    panelSource,
    /while \(anchor\.parentElement && anchor\.parentElement !== container\)/,
  );
  assert.doesNotMatch(panelSource, /"\.right-container"/);
  assert.match(panelSource, /data-caption-review", "in-page-module"/);
  assert.match(panelSource, /container\.insertBefore\(host, mountPoint\.before\)/);
  assert.match(panelSource, /isNodeBefore\(host, mountPoint\.before\)/);
  assert.match(panelSource, /function panelNeedsPlacement\(host\)/);
  assert.match(panelSource, /let observedUrl = location\.href/);
  assert.match(panelSource, /panelNeedsPlacement\(mountedPanel\.host\)/);
  assert.doesNotMatch(panelSource, /new MutationObserver\(scheduleSync\)/);
  assert.doesNotMatch(panelSource, /setInterval\(syncPanel,\s*600\)/);
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
    assert.match(panelSource, new RegExp(`"${eventName}"`));
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
    /:host\(\[data-platform="bilibili"\]\[data-open="true"\]\)\s*\{[^}]*height:\s*clamp\(510px, 69vh, 750px\)/s,
  );
  assert.match(appSource, /function selectionContextWithin\(container\)/);
  assert.match(appSource, /getComposedRanges/);
  assert.match(appSource, /className="comment-popover"/);
  assert.match(appSource, />\s*添加批注\s*</);
  assert.match(appSource, />\s*复制全部字幕\s*</);
  assert.match(appSource, /formatTranscriptForClipboard\(document\)/);
  assert.match(appSource, /onClick=\{\(\) => playFromSentence\(sentence\.startMs\)\}/);
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
  assert.match(appSource, /host\.dataset\.theme = resolvedTheme/);
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
  assert.match(appSource, /container\.clientHeight \/ 3/);
  assert.match(appSource, /container\.scrollTo\(\{/);
  assert.match(appSource, /className="comment-popover thread-editor-popover"/);
  assert.match(appSource, /className="annotation-inline-marker"/);
  assert.match(appSource, /annotations=\{rowAnnotations\}/);
  assert.match(appSource, /preferredThreadId/);
  assert.match(appSource, /thread-editor-popover__tabs/);
  assert.match(appSource, /closeOnOutsidePointer/);
  assert.match(
    appSource,
    /addEventListener\("pointerdown", closeOnOutsidePointer, true\)/,
  );
  assert.match(appSource, /node\.closest\?\.\("\.comment-popover"\)/);
  assert.doesNotMatch(appSource, /setExpandedSentenceId\(sentence\.id\)/);
  assert.doesNotMatch(appSource, /打开内置演示|openDemoDocument/);
  assert.doesNotMatch(
    appSource,
    /Object\.entries\(KIND_META\)\.map\(\(\[kind, meta\]\)/,
  );
  assert.match(panelStyles, /\.comment-popover\s*\{/);
  assert.match(storageSource, /EXTENSION_RECORD_PREFIX/);
  assert.match(storageSource, /chrome\?\.storage\?\.local/);
  assert.match(storageSource, /extensionRecordKey\("threads", documentId\)/);
  assert.doesNotMatch(
    appSource,
    /已读取 \$\{nextDocument\.sentences\.length\} 句/,
  );
  assert.match(appSource, /aria-label="搜索字幕或短语"/);
  assert.match(appSource, /autoComplete="off"/);
  assert.match(appSource, /name="caption-search"/);
  assert.match(appSource, /aria-label=\{`\$\{meta\.label\}内容`\}/);
});

test("emits a self-contained unpacked in-page extension", async () => {
  for (const file of [
    "manifest.json",
    "background.js",
    "bilibili-provider.js",
    "content-script.js",
    "youtube-player-bridge.js",
    "caption-review-ui.js",
  ]) {
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
});
