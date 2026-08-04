#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionSourceDir = path.join(root, "extension");
const extensionUiFile = path.join(
  root,
  "dist",
  "extension-ui",
  "caption-review-ui.js",
);
const extensionDistDir = path.join(root, "dist", "extension");
const extensionFiles = [
  "manifest.json",
  "background.js",
  "bilibili-provider.js",
  "content-script.js",
  "youtube-player-bridge.js",
  "icons/icon16.png",
  "icons/icon32.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

for (const file of [
  extensionUiFile,
  ...extensionFiles.map((name) => path.join(extensionSourceDir, name)),
]) {
  if (!existsSync(file)) {
    throw new Error(`Missing extension build input: ${file}`);
  }
}

const expectedDistParent = path.join(root, "dist");
if (path.dirname(extensionDistDir) !== expectedDistParent) {
  throw new Error(`Refusing to replace unexpected directory: ${extensionDistDir}`);
}

rmSync(extensionDistDir, { force: true, recursive: true });
mkdirSync(extensionDistDir, { recursive: true });

for (const name of extensionFiles) {
  mkdirSync(path.dirname(path.join(extensionDistDir, name)), { recursive: true });
  copyFileSync(
    path.join(extensionSourceDir, name),
    path.join(extensionDistDir, name),
  );
}
copyFileSync(
  extensionUiFile,
  path.join(extensionDistDir, "caption-review-ui.js"),
);

const manifest = JSON.parse(
  readFileSync(path.join(extensionDistDir, "manifest.json"), "utf8"),
);
const contentScriptFiles = manifest.content_scripts?.flatMap(
  (entry) => entry.js ?? [],
) ?? [];
if (
  manifest.manifest_version !== 3 ||
  manifest.side_panel ||
  manifest.permissions?.includes("sidePanel") ||
  !contentScriptFiles.includes("caption-review-ui.js")
) {
  throw new Error("Generated extension is not configured for the page panel");
}

for (const file of [...extensionFiles, "caption-review-ui.js"]) {
  if (!existsSync(path.join(extensionDistDir, file))) {
    throw new Error(`Generated extension is missing: ${file}`);
  }
}

console.log(`Prepared Chrome extension: ${extensionDistDir}`);
