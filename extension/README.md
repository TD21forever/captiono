# Captiono Chrome 扩展

Manifest V3 page-panel extension for automatically studying captions on
YouTube and Bilibili. Every supported video tab receives its own right-anchored
Shadow DOM panel; Chrome Side Panel is not used.

Build the unpacked extension with `npm run build:extension`, then load
`dist/extension` in Chrome.

## Automatic caption acquisition

The bridge and UI content scripts are declared for YouTube and Bilibili site
origins, then mount the product only on supported video routes. This allows
YouTube/Bilibili SPA navigation to enter or leave a video page without requiring
a document reload. Caption discovery starts on page load, caption-track changes,
and media-ID changes.

- YouTube Provider reads the current page caption manifest. When a signed
  player resource is required, the service worker runs the tightly scoped
  `youtube-player-bridge.js` function in the page MAIN world and immediately
  normalizes the returned JSON3 cues.
- Bilibili Provider asks the service worker to load `/x/player/wbi/v2`, selects
  an available track, fetches its `subtitle_url`, and normalizes `body` entries
  into millisecond cues.
- Standard `TextTrack` cues exposed by either supported player are accepted
  before the platform-specific path.

The UI subscribes to the bridge in the same tab and never queries a global
active tab. Clicking the extension action toggles the clicked tab only; if an
old tab has no receiver, the service worker reinjects the bridge and UI and
opens the panel. `REFRESH_CAPTIONS` remains an explicit recovery action.

Panel open state, scroll, search, and drafts are tab-local. Durable data uses
`chrome.storage.local` with separate settings and per-document caption,
annotation, and phrase records.

The extension does not capture audio, transcribe speech, import subtitle files,
or call a dedicated subtitle backend.
