# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Selected Product Direction

- The user-facing product name is `Captiono`, with the launcher line `从视频字幕里标记表达与笔记`. Keep existing `caption-review` DOM hooks, build artifacts, and storage keys for backward compatibility so upgrades preserve existing learner data.
- Use `design/editorial-study-notebook.png` as the visual source of truth.
- The product should feel like a warm editorial learning notebook, not a clone of vCaptions' dark transcript list.
- Present timestamps and full captions as one compact, continuous list so learners retain global context and can jump quickly; indicate the current sentence with a quiet active state instead of a large focus card.
- Keep whole-sentence copy and sentence annotations as lightweight row actions. Highlight rule-matched phrases inline and show the Chinese gloss on hover/focus.
- Use a responsive anchored annotation drawer inspired by `design/review-canvas.png`: side-by-side in the standalone preview and an overlay/sheet inside the injected page panel.
- Keep complete timestamped transcript copy, JSON/Markdown downloads, and settings in the overflow menu. `复制全部字幕` includes the video title followed by every `MM:SS sentence` line. The persistent footer contains the study sheet and the named `复制研读笔记` action.
- Do not expose the built-in sample transcript as an extension menu action. It exists only as standalone preview data; the installed product menu must stay focused on the current video's real captions.

## Transcript interaction decisions

- Do not render persistent caption/source status in either the transcript or top header. Surface source state only when actionable through a toast or recovery controls in the overflow menu.
- Do not expose the experimental built-in/local AI model in the primary product flow. Phrase highlighting uses deterministic local rules and dictionaries until a separately designed analysis service is introduced.
- Avoid duplicating the active sentence in a large hero/header module; every sentence keeps the same list anatomy and density.
- Keep whole-sentence copy persistently discoverable on every caption row. In the text-selection toolbar, copy only the exact selected text and label the action `复制选中`.
- Treat every row timestamp as a direct-play control: clicking it seeks to the sentence start and starts playback without toggling an already-playing video into pause. Keep transcript text free for selection and annotation.
- Annotation categories must be action-oriented and semantically distinct: `待解问题` is for later questions, `收藏表达` captures user-selected language that automatic phrase rules missed, and `学习笔记` stores the learner's own understanding or summary.

## Caption source scope

- The first product release supports YouTube and Bilibili video pages only.
- Caption acquisition starts automatically on page load and SPA video changes; opening the page panel must reveal the current result rather than trigger the first fetch.
- Do not ship TED-specific transcript logic, subtitle-file import, or tab-audio transcription in this release.
- On YouTube, first use caption tracks embedded in the page manifest. If a video exposes tracks only through the live `movie_player`, discover its caption track list there and let the player mint the signed `api/timedtext` URL; do not add publisher-specific fallbacks or a private subtitle library.
- Manual refresh is a recovery action. It is not the normal acquisition flow.
- If an already-open supported tab has no content-script receiver, the extension action must recover by reinjecting the page bridge and page panel automatically; never ask the learner to refresh as the normal fix.
- While a newly active video is loading or unavailable, never display a stored transcript from a different video as if it belonged to the current page.
- The installed product is one Shadow DOM in-page module per supported video tab. Mount it into YouTube's native `#secondary` column or Bilibili's video-page right column so it participates in the host layout and never covers the player or page controls. If no stable mount point exists, wait for one instead of falling back to a viewport overlay.
- On Bilibili, place Captiono immediately before the native `.danmaku-box` / `#danmukuBox` node in that node's own parent, matching the page's subtitle-tool location above the danmaku list. Do not promote the anchor to a shared right-column wrapper, which can incorrectly place Captiono above UP information. Never prepend it to a generic `.right-container`; only mount when a verified video layout, player, paired right column, and danmaku anchor are present.
- Page modules must not be repositioned on a polling interval. Observe SPA layout changes and move the host only when it is disconnected or no longer precedes its stable anchor; other extensions may insert siblings between Captiono and that anchor without triggering a reorder loop.
- The collapsed launcher must not translate on hover, because moving its hit target can create pointer-boundary oscillation. Stop bubbled pointer and click events at the Shadow Root so Bilibili's delegated page handlers cannot consume panel controls.
- Hovering any embedded control must not schedule a placement pass or animate the host's geometry. The layout observer only reacts to URL changes, a disconnected host, or a missing/moved stored anchor; embedded host and panel width/height transitions stay disabled, and hover feedback is limited to color, border, shadow, or opacity.
- Automatic caption acquisition is silent. Do not show a success toast when the page bridge refreshes captions; reserve toast feedback for explicit learner actions and recoverable errors.
- Embedded density responds to the module's own sidebar width through container queries. Bilibili uses a taller 510–750px expanded module (roughly 1.5x the earlier panel) and a 64px launcher so more transcript context remains visible without clipping row actions or footer controls.
- Text selection inside the injected Shadow DOM must prefer `ShadowRoot.getSelection()` and composed ranges before deciding that a selection crosses sentences. New annotations use one compact Codex-like editor beside the selected text; reserve the full drawer for reviewing and managing existing threads.
- Embedded geometry is keyed to the explicit `is-embedded` UI state, never runtime extension detection. Every embedded wrapper and panel must use `width: 100%`, `max-width: 100%`, and `min-width: 0`; viewport widths are reserved for the standalone or full-page extension preview.
- The extension action toggles only the tab supplied by `chrome.action.onClicked`; it must never re-query a global active tab.
- Collapsing keeps the React product mounted and makes the hidden surface inert, so scroll position, search, and draft annotations survive. A compact horizontal preview card stays in the same page slot and restores the module and keyboard focus.
- Each tab owns its transient UI state. Durable settings use `chrome.storage.local`, while captions, phrases, and annotations are split into per-document records to avoid different videos overwriting one another.
- The centered rounded-card stage is only for the standalone web preview.
- Caption refreshes for the same `mediaId` must keep the current transcript visible; clear the list only when the active video's identity changes, so automatic recovery never creates a full-panel flash.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
