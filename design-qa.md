# Captiono v1 design QA

Date: 2026-07-30

## Source of truth and test state

- Selected ImageGen direction:
  `design/editorial-study-notebook.png` (“Editorial Study Notebook”).
- Responsive interaction reference:
  `design/review-canvas.png` (annotation drawer behavior only).
- Primary comparison viewport: 480 × 900 CSS px.
- Narrow verification viewport: 360 × 800 CSS px.
- Reference normalization: `qa/v2/reference-480x900.png`.
- Final implementation capture:
  `qa/v2/editorial-main-final-480x900.png`.
- Same-input comparison: `qa/v2/comparison-final.png`
  (reference on the left, implementation on the right).

## Comparison history

1. `qa/v2/comparison-round-1.png`: first integrated product state. The
   editorial hierarchy already matched, but the currently focused sentence did
   not expose existing comments.
2. Added a compact, clickable comment count to the focus header, while keeping
   the full thread inside the responsive drawer.
3. `qa/v2/comparison-final.png`: final state after the comment affordance,
   real source status, persistence fixes, and interaction verification.

## Fidelity review

1. **Geometry — pass.** The implementation preserves the narrow notebook
   composition, 18px outer radius, spacious focus block, contextual sentence
   rhythm, and fixed learning dock. No document-level horizontal overflow was
   observed at 480px or 360px.
2. **Typography — pass.** Serif English learning text, compact sans-serif
   controls, and tabular timestamps reproduce the source hierarchy without
   clipping. Chinese explanations remain secondary but readable.
3. **Color and surface — pass.** Warm paper, charcoal ink, indigo actions,
   terracotta phrase emphasis, restrained borders, and low-contrast utility
   text track the generated direction.
4. **Controls and detail — pass.** Tabler icons, full-sentence copy,
   phrase-save cards, source status, visible comment count, and the fixed AI
   export action all use one consistent visual language.
5. **Responsive behavior — pass.** At 360px the focus actions remain reachable,
   the dock stays visible, text wraps naturally, and the annotation UI becomes
   an overlay drawer. At 820px and above the same drawer becomes a side column.
6. **Product-truth deviations — accepted.** The implementation adds a compact
   subtitle-source bar and local-AI control that are absent from the visual
   concept because the complete product must explain whether content came from
   a page track, a local import, or the demo. The focused block intentionally
   shows one semantic sentence rather than concatenating two sentences.

## Interaction verification

- Full-sentence copy changes the control to “已复制” and shows the timestamped
  success status; `⌘/Ctrl + Shift + C` uses the same path.
- Saving “rooted in reality” increments the learning-sheet count and renders
  the phrase with its Chinese explanation and CEFR level.
- Whole-sentence annotation creates a thread. Root comment editing, reply,
  resolve, reopen, and delete controls are present and the reply/resolve flows
  were exercised.
- The focused-sentence comment count opens the correct annotation drawer.
- Partial-span annotations use DOM Range offsets scoped to
  `[data-sentence-text]`; cross-sentence selections are rejected. The
  whole-sentence button remains the accessible fallback.
- The learning sheet renders saved phrases separately from comment threads.
- WebVTT paste import produced two semantic sentences. After the StrictMode-safe
  restoration fix, a reload restored the imported title, both sentences, and
  its document-scoped empty learning sheet.
- Switching back to the built-in demo restored the demo’s separate saved phrase
  and thread count, confirming that transcript records do not bleed together.
- The overflow menu exposes page-caption refresh, available track selection,
  import, built-in demo, local AI, phrase density, automatic reuse, saved-only
  versus all-candidate export, Markdown, and JSON.
- The in-app browser correctly reported built-in AI as unavailable and retained
  the deterministic offline rules. Chrome verification is performed separately
  against the installed extension.
- `npm test`: 32/32 passed.
- `npm run build:extension`: passed and emitted the historical self-contained
  Manifest V3 extension build. The current 1.3.0 product uses a page panel.

## Severity review

- P0: none.
- P1: recent document restoration was cancelled by React StrictMode — fixed by
  making the mount effect repeat-safe instead of suppressing its second run.
- P1: stale annotations could be saved under a newly selected document — fixed
  with a hydrated-document ID gate.
- P1: AI/local phrase IDs could create duplicate saved items — fixed with a
  semantic phrase key and local-ID inheritance.
- P2: focused comments were invisible until the drawer opened — fixed with the
  clickable comment count.
- P2: imported content could be shown before durable storage completed — fixed
  by awaiting the document save before reporting import success.

final result: passed
