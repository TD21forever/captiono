#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
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

const archiveFiles = [...extensionFiles, "caption-review-ui.js"].sort();
for (const file of archiveFiles) {
  if (!existsSync(path.join(extensionDistDir, file))) {
    throw new Error(`Generated extension is missing: ${file}`);
  }
}

const archivePath = path.join(
  expectedDistParent,
  `captiono-${manifest.version}.zip`,
);
const temporaryArchivePath = path.join(
  expectedDistParent,
  `.captiono-${manifest.version}-${process.pid}.zip`,
);
rmSync(temporaryArchivePath, { force: true });

try {
  execFileSync(
    "zip",
    ["-q", "-X", temporaryArchivePath, ...archiveFiles],
    { cwd: extensionDistDir },
  );

  const archivedFiles = execFileSync(
    "unzip",
    ["-Z1", temporaryArchivePath],
    { encoding: "utf8" },
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  if (JSON.stringify(archivedFiles) !== JSON.stringify(archiveFiles)) {
    throw new Error(
      `Release archive file list mismatch: ${archivedFiles.join(", ")}`,
    );
  }

  for (const file of archiveFiles) {
    const archived = execFileSync("unzip", ["-p", temporaryArchivePath, file]);
    const unpacked = readFileSync(path.join(extensionDistDir, file));
    if (!archived.equals(unpacked)) {
      throw new Error(`Release archive differs from unpacked build: ${file}`);
    }
  }

  rmSync(archivePath, { force: true });
  renameSync(temporaryArchivePath, archivePath);
} finally {
  rmSync(temporaryArchivePath, { force: true });
}

console.log(`Prepared Chrome extension: ${extensionDistDir}`);
console.log(`Prepared verified release archive: ${archivePath}`);
