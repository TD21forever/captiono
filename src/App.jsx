import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import packageMetadata from "../package.json";
import {
  IconBookmark,
  IconCheck,
  IconChevronUp,
  IconClipboard,
  IconCopy,
  IconCornerDownRight,
  IconCurrentLocation,
  IconDeviceDesktop,
  IconDotsVertical,
  IconEdit,
  IconJson,
  IconMarkdown,
  IconMessageCircle,
  IconMessageCircleQuestion,
  IconNotes,
  IconPencil,
  IconPlayerPlayFilled,
  IconRefresh,
  IconSearch,
  IconSun,
  IconSparkles,
  IconTrash,
  IconMoon,
  IconX,
} from "@tabler/icons-react";
import {
  createAnnotationThread,
  deleteAnnotationThread,
  editAnnotationThread,
  SAMPLE_TITLE,
  SAMPLE_TRANSCRIPT,
  detectPhrases,
  exportStudyJson,
  exportStudyMarkdown,
  formatTranscriptForClipboard,
  listCaptionDocuments,
  loadAnnotationThreads,
  loadPhraseAnalysisCache,
  loadPhraseFeedback,
  loadSavedPhrases,
  loadSettings,
  mergeCuesIntoSentences,
  parseTranscriptDocument,
  PHRASE_ANALYZER_VERSION,
  recordPhraseFeedback,
  reopenAnnotationThread,
  replyToAnnotationThread,
  resolveAnnotationThread,
  saveAnnotationThreads,
  saveCaptionDocument,
  savePhraseAnalysisCache,
  saveSavedPhrases,
  saveSettings,
  threadToAnnotation,
} from "./lib/index.js";
import {
  CAPTION_FOLLOW_EVENT,
  CAPTION_FOLLOW_IDLE_MS,
  CAPTION_FOLLOW_MODE,
  shouldResumeCaptionFollowAfterIdle,
  transitionCaptionFollowMode,
} from "./lib/captionFollow.js";
import {
  BILIBILI_PAGE_SUBTITLE_SOURCE,
  CAPTION_STATUS,
  PAGE_TEXT_TRACK_SOURCE,
  YOUTUBE_PAGE_MANIFEST_SOURCE,
  YOUTUBE_PLAYER_CAPTION_SOURCE,
} from "./lib/captionSources.js";
import { useCaptionBridge } from "./hooks/useCaptionBridge.js";
import { useMediaBridge } from "./hooks/useMediaBridge.js";
import {
  rangeTextLengthIgnoringUi,
  rectRelativeTo,
} from "./lib/floatingGeometry.js";

const KIND_META = {
  question: {
    label: "待解问题",
    actionLabel: "提问",
    description: "记录还没弄懂、准备继续追问的内容",
    icon: IconMessageCircleQuestion,
    prompt: "你想弄懂什么？",
    color: "amber",
  },
  expression: {
    label: "收藏表达",
    actionLabel: "记表达",
    description: "收藏系统未标出、但你认为值得学习的表达",
    icon: IconSparkles,
    prompt: "为什么想记住这个表达？",
    color: "blue",
  },
  note: {
    label: "学习笔记",
    actionLabel: "写笔记",
    description: "写下自己的理解、总结或联想",
    icon: IconNotes,
    prompt: "记下你的理解",
    color: "violet",
  },
};
const EMPTY_LIST = Object.freeze([]);
const CAPTION_FOLLOW_SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

const THEME_OPTIONS = Object.freeze([
  { value: "system", label: "系统", icon: IconDeviceDesktop },
  { value: "light", label: "浅色", icon: IconSun },
  { value: "dark", label: "深色", icon: IconMoon },
]);

function normalizeThemeMode(value) {
  return ["system", "light", "dark"].includes(value) ? value : "system";
}

const PAGE_CAPTION_PROVIDERS = new Set([
  PAGE_TEXT_TRACK_SOURCE,
  YOUTUBE_PAGE_MANIFEST_SOURCE,
  YOUTUBE_PLAYER_CAPTION_SOURCE,
  BILIBILI_PAGE_SUBTITLE_SOURCE,
]);
const BUILD_VERSION = packageMetadata.version;

function runtimeBuildMeta() {
  const runtime = globalThis.chrome?.runtime;
  const isExtension = Boolean(runtime?.id);
  let runtimeVersion = "";

  if (isExtension) {
    try {
      runtimeVersion = runtime.getManifest?.().version ?? "";
    } catch {
      // A web preview or an extension update in progress may not expose it.
    }
  }

  return {
    isExtension,
    runtimeVersion: runtimeVersion || BUILD_VERSION,
  };
}

const RUNTIME_BUILD = runtimeBuildMeta();

function formatTime(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(
    seconds % 60,
  ).padStart(2, "0")}`;
}

function findActiveSentence(sentences, currentMs) {
  let low = 0;
  let high = sentences.length - 1;
  let candidateIndex = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (sentences[middle].startMs <= currentMs) {
      candidateIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (candidateIndex < 0) return null;
  const sentence = sentences[candidateIndex];
  const endMs =
    sentence.endMs ??
    sentence.startMs + Math.max(sentence.text.length * 70, 2000);
  return currentMs < endMs ? sentence : null;
}

function fingerprintTranscript(title, segments) {
  const input = `${title}\n${segments
    .map((segment) => `${segment.startMs}:${segment.endMs}:${segment.text}`)
    .join("\n")}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createDocument(
  title,
  transcript,
  source = "demo",
  metadata = {},
) {
  const segments = transcript?.segments ?? transcript?.cues ?? [];
  const sentences = transcript?.sentences ?? [];
  return {
    id:
      metadata.id ??
      `caption-review:${source}:${fingerprintTranscript(title, segments)}`,
    title,
    language: metadata.language ?? "en",
    sourceUrl: metadata.sourceUrl ?? "",
    segments,
    cues: segments,
    source: {
      provider: source,
      canonicalUrl: metadata.sourceUrl ?? "",
      mediaId: metadata.mediaId ?? source,
    },
    sentences,
    ...(metadata.caption ? { caption: metadata.caption } : {}),
  };
}

function createPageCaptionDocument(captionDocument) {
  const cues = captionDocument?.cues ?? [];
  const provider = PAGE_CAPTION_PROVIDERS.has(captionDocument?.source)
    ? captionDocument.source
    : PAGE_TEXT_TRACK_SOURCE;
  return createDocument(
    captionDocument?.title || "当前视频字幕",
    {
      cues,
      segments: cues,
      sentences: mergeCuesIntoSentences(cues),
    },
    provider,
    {
      id: captionDocument?.id,
      language: captionDocument?.language?.code || "en",
      sourceUrl: captionDocument?.url || "",
      mediaId:
        captionDocument?.mediaBinding?.mediaId ||
        captionDocument?.selectedTrackId ||
        "page-caption",
      caption: {
        selectedTrackId: captionDocument?.selectedTrackId || "",
        tracks: captionDocument?.tracks ?? [],
        capturedAt: captionDocument?.capturedAt ?? "",
        mediaBinding: captionDocument?.mediaBinding ?? null,
      },
    },
  );
}

function sourceLabel(document) {
  const url = String(document?.sourceUrl ?? "");
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "YT";
  if (url.includes("bilibili.com")) return "BILI";
  if (document?.source?.provider === "demo") return "DEMO";
  return "VIDEO";
}

function phraseKey(phrase) {
  return `${phrase?.sentenceId ?? ""}:${phrase?.start ?? ""}:${phrase?.end ?? ""}:${phrase?.exact ?? ""}`;
}

function selectionContextWithin(container) {
  if (!container) return null;
  const root = container.getRootNode?.();
  const documentSelection = globalThis.getSelection?.() ?? null;
  const rootSelection =
    typeof root?.getSelection === "function" ? root.getSelection() : null;

  for (const selection of [rootSelection, documentSelection]) {
    if (!selection?.rangeCount) continue;
    const range = selection.getRangeAt(0);
    if (
      !range.collapsed &&
      container.contains(range.startContainer) &&
      container.contains(range.endContainer)
    ) {
      return { range, selection };
    }
  }

  const staticRange = documentSelection?.getComposedRanges?.({
    shadowRoots: root?.host ? [root] : [],
  })?.[0];
  if (!staticRange) return null;
  const range = globalThis.document.createRange();
  range.setStart(staticRange.startContainer, staticRange.startOffset);
  range.setEnd(staticRange.endContainer, staticRange.endOffset);
  if (
    range.collapsed ||
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  ) {
    return null;
  }
  return { range, selection: documentSelection };
}

function clearTextSelection(container) {
  const root = container?.getRootNode?.();
  if (typeof root?.getSelection === "function") {
    root.getSelection()?.removeAllRanges();
  }
  globalThis.getSelection?.()?.removeAllRanges();
}

function useStableEvent(handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  return useCallback((...args) => handlerRef.current(...args), []);
}

function listenForShadowAwarePointerDown(element, listener, capture = false) {
  const eventRoot = element?.getRootNode?.();
  const ownerDocument = element?.ownerDocument ?? globalThis.document;
  if (!eventRoot?.addEventListener || !ownerDocument?.addEventListener) {
    return () => {};
  }

  eventRoot.addEventListener("pointerdown", listener, capture);
  if (eventRoot === ownerDocument || !eventRoot.host) {
    return () => eventRoot.removeEventListener("pointerdown", listener, capture);
  }

  // Events originating in a closed shadow tree are retargeted to its host for
  // document listeners. Let the ShadowRoot listener classify those clicks;
  // the document listener exists only for genuine host-page clicks, which do
  // not enter the ShadowRoot event path at all.
  const listenOnHostPage = (event) => {
    if (event.composedPath?.().includes(eventRoot.host)) return;
    listener(event);
  };
  ownerDocument.addEventListener("pointerdown", listenOnHostPage, capture);
  return () => {
    eventRoot.removeEventListener("pointerdown", listener, capture);
    ownerDocument.removeEventListener(
      "pointerdown",
      listenOnHostPage,
      capture,
    );
  };
}

function getPhraseRange(phrase, sentence) {
  const exact = phrase.exact ?? phrase.text ?? "";
  const start =
    phrase.start ??
    phrase.startOffset ??
    phrase.range?.start ??
    sentence.text.indexOf(exact);
  const end =
    phrase.end ??
    phrase.endOffset ??
    phrase.range?.end ??
    start + exact.length;
  return { start, end };
}

async function writeClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = globalThis.document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  globalThis.document.body.appendChild(textarea);
  textarea.select();
  globalThis.document.execCommand("copy");
  textarea.remove();
}

function PhraseText({
  sentence,
  phrases,
  annotations = [],
  showPhrases,
  savedPhraseIds,
  onAnnotationActivate,
  onPhraseEnter,
  onPhraseLeave,
  onPhraseFocus,
  onPhraseActivate,
}) {
  const visiblePhrases = (showPhrases ? phrases : [])
    .map((phrase) => ({ ...phrase, ...getPhraseRange(phrase, sentence) }))
    .filter(
      (phrase) =>
        phrase.start >= 0 &&
        phrase.end > phrase.start &&
        phrase.end <= sentence.text.length,
    )
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((phrase, index, list) => {
      if (index === 0) return true;
      return phrase.start >= list[index - 1].end;
    });

  const visibleAnnotations = annotations
    .map((annotation, index) => ({
      ...annotation,
      annotationNumber: index + 1,
      start: annotation.start ?? annotation.position?.start ?? 0,
      end:
        annotation.end ??
        annotation.position?.end ??
        (annotation.start ?? 0) + String(annotation.exact ?? "").length,
    }))
    .filter(
      (annotation) =>
        annotation.start >= 0 &&
        annotation.end > annotation.start &&
        annotation.end <= sentence.text.length,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (!visiblePhrases.length && !visibleAnnotations.length) return sentence.text;

  const boundaries = new Set([0, sentence.text.length]);
  for (const range of [...visiblePhrases, ...visibleAnnotations]) {
    boundaries.add(range.start);
    boundaries.add(range.end);
  }
  const orderedBoundaries = [...boundaries].sort((a, b) => a - b);
  const parts = [];
  for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
    const start = orderedBoundaries[index];
    const end = orderedBoundaries[index + 1];
    if (end <= start) continue;
    const phrase = visiblePhrases.find(
      (candidate) => candidate.start < end && candidate.end > start,
    );
    const segmentAnnotations = visibleAnnotations.filter(
      (annotation) => annotation.start < end && annotation.end > start,
    );
    const text = sentence.text.slice(start, end);
    if (!phrase && !segmentAnnotations.length) {
      parts.push(text);
    } else {
    const saved =
        phrase &&
        (savedPhraseIds.has(phrase.id) || savedPhraseIds.has(phraseKey(phrase)));
      const primaryAnnotation = segmentAnnotations[0];
    parts.push(
      <span
          className={`${phrase ? "phrase-token" : ""}${
            saved ? " is-saved" : ""
          }${segmentAnnotations.length ? " annotation-token" : ""}`}
          data-annotation-ids={segmentAnnotations
            .map((annotation) => annotation.id)
            .join(" ")}
          data-phrase-id={phrase?.id}
          key={`text-${start}-${end}`}
          onBlur={phrase ? onPhraseLeave : undefined}
          onClick={
            primaryAnnotation
              ? (event) => onAnnotationActivate?.(event, primaryAnnotation)
              : undefined
          }
          onFocus={
            phrase ? (event) => onPhraseFocus(event, phrase) : undefined
          }
        onKeyDown={(event) => {
            if (event.key === "Escape" && phrase) onPhraseLeave();
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
              if (primaryAnnotation) {
                onAnnotationActivate?.(event, primaryAnnotation);
              } else if (phrase) {
                onPhraseActivate?.(phrase);
              }
          }
        }}
          onMouseEnter={
            phrase ? (event) => onPhraseEnter(event, phrase) : undefined
          }
          onMouseLeave={phrase ? onPhraseLeave : undefined}
        role="button"
        tabIndex={0}
      >
          {text}
      </span>,
    );
    }

    for (const annotation of visibleAnnotations.filter(
      (candidate) => candidate.end === end,
    )) {
      parts.push(
        <button
          aria-label={`查看批注 ${annotation.annotationNumber}`}
          className="annotation-inline-marker"
          data-selection-ignore=""
          key={`annotation-${annotation.id}`}
          onClick={(event) => onAnnotationActivate?.(event, annotation)}
          title={`批注 ${annotation.annotationNumber}`}
          type="button"
        >
          {annotation.annotationNumber}
        </button>,
      );
    }
  }
  return parts;
}

const TranscriptRow = memo(function TranscriptRow({
  annotations,
  copied,
  isActive,
  onCopy,
  onOpenAnnotations,
  onPhraseActivate,
  onPhraseEnter,
  onPhraseFocus,
  onPhraseLeave,
  onPlay,
  onStartNote,
  phrases,
  savedPhraseIds,
  sentence,
  showPhrases,
}) {
  return (
    <article
      className={`transcript-row${isActive ? " is-active" : ""}`}
      data-sentence-id={sentence.id}
    >
      <button
        aria-label={`从 ${formatTime(sentence.startMs)} 开始播放`}
        className="transcript-row__time"
        onClick={() => onPlay(sentence)}
        title="从这里播放"
        type="button"
      >
        <IconPlayerPlayFilled aria-hidden="true" size={11} />
        {formatTime(sentence.startMs)}
      </button>
      <p className="transcript-row__text" data-sentence-text="">
        <PhraseText
          annotations={annotations}
          onAnnotationActivate={(event, annotation) =>
            onOpenAnnotations(
              event.currentTarget,
              sentence.id,
              annotation.id,
            )
          }
          onPhraseActivate={onPhraseActivate}
          onPhraseEnter={onPhraseEnter}
          onPhraseFocus={onPhraseFocus}
          onPhraseLeave={onPhraseLeave}
          phrases={phrases}
          savedPhraseIds={savedPhraseIds}
          sentence={sentence}
          showPhrases={showPhrases}
        />
      </p>
      <div className="transcript-row__actions">
        <button
          aria-label={`${formatTime(sentence.startMs)} 复制整句`}
          className={`transcript-row__copy${copied ? " is-copied" : ""}`}
          onClick={() => onCopy(sentence)}
          title="复制整句"
          type="button"
        >
          {copied ? (
            <IconCheck aria-hidden="true" size={15} />
          ) : (
            <IconCopy aria-hidden="true" size={15} />
          )}
          <span className="transcript-row__action-label">
            {copied ? "已复制" : "复制"}
          </span>
        </button>
        <button
          aria-label={
            annotations.length
              ? `${annotations.length} 条批注`
              : "添加整句批注"
          }
          className={annotations.length ? "has-count" : ""}
          onClick={(event) => {
            if (annotations.length) {
              onOpenAnnotations(event.currentTarget, sentence.id);
            } else {
              onStartNote(sentence, event.currentTarget);
            }
          }}
          title={annotations.length ? "查看批注" : "添加整句批注"}
          type="button"
        >
          <IconMessageCircle aria-hidden="true" size={15} />
          {annotations.length > 0 && (
            <span className="transcript-row__count">{annotations.length}</span>
          )}
        </button>
      </div>
    </article>
  );
});

const TranscriptStream = memo(function TranscriptStream({
  activeSentenceId,
  annotationsBySentence,
  copiedSentenceId,
  onCopy,
  onOpenAnnotations,
  onPhraseActivate,
  onPhraseEnter,
  onPhraseFocus,
  onPhraseLeave,
  onPlay,
  onStartNote,
  phrasesBySentence,
  savedPhraseIds,
  sentences,
  showPhrases,
}) {
  return (
    <section className="transcript-stream">
      {sentences.map((sentence) => (
        <TranscriptRow
          annotations={
            annotationsBySentence.get(sentence.id) ?? EMPTY_LIST
          }
          copied={copiedSentenceId === sentence.id}
          isActive={sentence.id === activeSentenceId}
          key={sentence.id}
          onCopy={onCopy}
          onOpenAnnotations={onOpenAnnotations}
          onPhraseActivate={onPhraseActivate}
          onPhraseEnter={onPhraseEnter}
          onPhraseFocus={onPhraseFocus}
          onPhraseLeave={onPhraseLeave}
          onPlay={onPlay}
          onStartNote={onStartNote}
          phrases={phrasesBySentence.get(sentence.id) ?? EMPTY_LIST}
          savedPhraseIds={savedPhraseIds}
          sentence={sentence}
          showPhrases={showPhrases}
        />
      ))}
    </section>
  );
});

function AnnotationCard({ annotation, onDelete }) {
  const meta = KIND_META[annotation.kind] ?? KIND_META.note;
  const Icon = meta.icon;

  return (
    <article className={`annotation-card tone-${meta.color}`}>
      <div className="annotation-card__meta">
        <span className="annotation-kind">
          <Icon aria-hidden="true" size={14} stroke={1.9} />
          {meta.label}
        </span>
        <button
          aria-label="删除批注"
          className="annotation-delete"
          onClick={() => onDelete(annotation.id)}
          type="button"
        >
          <IconX aria-hidden="true" size={14} />
        </button>
      </div>
      <blockquote>{annotation.exact}</blockquote>
      <p>{annotation.body || "已保存这个片段"}</p>
    </article>
  );
}

function ThreadCard({
  compact = false,
  onDelete,
  onEdit,
  onReply,
  onReopen,
  onResolve,
  thread,
}) {
  const [replyBody, setReplyBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(
    thread.comments?.find((comment) => comment.parentId == null)?.body ?? "",
  );
  const annotation = threadToAnnotation(thread);
  const meta = KIND_META[annotation.kind] ?? KIND_META.note;
  const Icon = meta.icon;
  const rootComment =
    thread.comments?.find((comment) => comment.parentId == null) ??
    thread.comments?.[0];
  const replies = (thread.comments ?? []).filter(
    (comment) => comment.id !== rootComment?.id,
  );
  const resolved = thread.status === "resolved";

  useEffect(() => {
    setEditBody(rootComment?.body ?? "");
  }, [rootComment?.body]);

  const commitEdit = () => {
    const nextBody = editBody.trim();
    if (!nextBody) return;
    onEdit(thread.id, nextBody);
    setEditing(false);
  };

  const commitReply = () => {
    const nextBody = replyBody.trim();
    if (!nextBody) return;
    onReply(thread.id, nextBody);
    setReplyBody("");
  };

  return (
    <article
      className={`thread-card tone-${meta.color}${
        resolved ? " is-resolved" : ""
      }${compact ? " is-compact" : ""}`}
    >
      <div className="thread-card__meta">
        <span className="annotation-kind">
          <Icon aria-hidden="true" size={14} stroke={1.9} />
          {meta.label}
        </span>
        <span className="thread-card__status">
          {resolved ? "已解决" : `${thread.comments?.length ?? 0} 条讨论`}
        </span>
      </div>

      <blockquote>{thread.anchor?.exact || annotation.exact}</blockquote>

      {editing ? (
        <div className="thread-card__edit">
          <textarea
            aria-label="编辑批注"
            autoFocus
            onChange={(event) => setEditBody(event.target.value)}
            rows={3}
            value={editBody}
          />
          <div>
            <button onClick={() => setEditing(false)} type="button">
              取消
            </button>
            <button onClick={commitEdit} type="button">
              保存
            </button>
          </div>
        </div>
      ) : (
        <p className="thread-card__root">
          {rootComment?.body || "已保存这个片段"}
        </p>
      )}

      {!compact && replies.length > 0 && (
        <div className="thread-card__replies">
          {replies.map((comment) => (
            <div key={comment.id}>
              <IconCornerDownRight aria-hidden="true" size={15} stroke={1.7} />
              <p>{comment.body}</p>
            </div>
          ))}
        </div>
      )}

      {!compact && !resolved && (
        <div className="thread-card__reply">
          <textarea
            aria-label="回复批注"
            onChange={(event) => setReplyBody(event.target.value)}
            placeholder="回复或继续追问…"
            rows={2}
            value={replyBody}
          />
          <button
            disabled={!replyBody.trim()}
            onClick={commitReply}
            type="button"
          >
            回复
          </button>
        </div>
      )}

      <div className="thread-card__actions">
        {!compact && !resolved && (
          <button onClick={() => setEditing(true)} type="button">
            <IconEdit aria-hidden="true" size={15} />
            编辑
          </button>
        )}
        {resolved ? (
          <button onClick={() => onReopen(thread.id)} type="button">
            <IconRefresh aria-hidden="true" size={15} />
            重新打开
          </button>
        ) : (
          <button onClick={() => onResolve(thread.id)} type="button">
            <IconCheck aria-hidden="true" size={15} />
            解决
          </button>
        )}
        <button
          aria-label="删除批注线程"
          className="is-danger"
          onClick={() => onDelete(thread.id)}
          type="button"
        >
          <IconTrash aria-hidden="true" size={15} />
          删除
        </button>
      </div>
    </article>
  );
}

function PhraseTooltip({ active, onEnter, onLeave, onSave, saved }) {
  if (!active) return null;
  const { phrase, left, top, width } = active;
  const canonical = phrase.canonical ?? phrase.phrase ?? phrase.exact;
  const showSurface =
    canonical &&
    phrase.exact &&
    canonical.toLocaleLowerCase("en") !== phrase.exact.toLocaleLowerCase("en");

  return (
    <aside
      aria-live="polite"
      className="phrase-tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ left, top, width }}
    >
      <div className="phrase-tooltip__eyebrow">
        <span>{phrase.category ?? "重点表达"}</span>
        <span>{phrase.difficulty ?? "B2"}</span>
      </div>
      <strong>{canonical}</strong>
      {showSurface ? (
        <span className="phrase-tooltip__surface">原文：{phrase.exact}</span>
      ) : null}
      <p>{phrase.glossZh ?? phrase.zh ?? "结合语境理解这个表达"}</p>
      <button onClick={() => onSave(phrase)} type="button">
        {saved ? (
          <>
            <IconCheck aria-hidden="true" size={15} />
            已加入学习单
          </>
        ) : (
          <>
            <IconBookmark aria-hidden="true" size={15} />
            加入学习单
          </>
        )}
      </button>
    </aside>
  );
}

function SelectionToolbar({ selection, onAddComment, onCopySelection }) {
  if (!selection) return null;
  return (
    <div
      aria-label="选中文本操作"
      className="selection-toolbar"
      role="group"
      style={{
        left: selection.left,
        maxWidth: selection.toolbarMaxWidth,
        top: selection.top,
      }}
    >
      <button
        className="selection-toolbar__copy"
        onClick={onCopySelection}
        title="复制当前选中的内容"
        type="button"
      >
        <IconCopy aria-hidden="true" size={15} stroke={1.9} />
        复制选中
      </button>
      <button onClick={onAddComment} title="为选中内容添加批注" type="button">
        <IconMessageCircle aria-hidden="true" size={15} stroke={1.9} />
        添加批注
      </button>
    </div>
  );
}

function CommentPopover({ draft, onCancel, onChange, onSave }) {
  if (!draft?.floating) return null;
  const canSave = Boolean(draft.body.trim());
  return (
    <section
      aria-label="添加批注"
      className="comment-popover"
      role="dialog"
      style={{
        left: draft.editorLeft,
        top: draft.editorTop,
        width: draft.editorWidth,
      }}
    >
      <textarea
        aria-label="批注内容"
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          const composing =
            event.isComposing ||
            event.nativeEvent?.isComposing ||
            event.keyCode === 229;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
            return;
          }
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !composing
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (canSave) onSave();
          }
        }}
        placeholder="添加批注…"
        rows={3}
        value={draft.body}
      />
      <footer>
        <button aria-label="放弃批注" onClick={onCancel} type="button">
          <IconTrash aria-hidden="true" size={18} stroke={1.8} />
        </button>
        <div>
          <button
            className="comment-popover__cancel"
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="comment-popover__save"
            disabled={!canSave}
            onClick={onSave}
            type="button"
          >
            保存
          </button>
        </div>
      </footer>
    </section>
  );
}

function ThreadEditorPopover({
  editor,
  onCancel,
  onChange,
  onDelete,
  onSave,
  onSelectThread,
}) {
  if (!editor) return null;
  const canSave = Boolean(editor.body.trim());
  return (
    <section
      aria-label="编辑批注"
      className="comment-popover thread-editor-popover"
      role="dialog"
      style={{ left: editor.left, top: editor.top, width: editor.width }}
    >
      {editor.threads.length > 1 && (
        <nav aria-label="选择批注" className="thread-editor-popover__tabs">
          {editor.threads.map((thread, index) => (
            <button
              aria-label={`编辑批注 ${index + 1}`}
              aria-pressed={index === editor.activeIndex}
              key={thread.id}
              onClick={() => onSelectThread(index)}
              type="button"
            >
              {index + 1}
            </button>
          ))}
        </nav>
      )}
      <textarea
        aria-label="编辑批注内容"
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          const composing =
            event.isComposing ||
            event.nativeEvent?.isComposing ||
            event.keyCode === 229;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
            return;
          }
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !composing
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (canSave) onSave();
          }
        }}
        placeholder="添加可选评论…"
        rows={3}
        value={editor.body}
      />
      <footer>
        <button aria-label="删除批注" onClick={onDelete} type="button">
          <IconTrash aria-hidden="true" size={18} stroke={1.8} />
        </button>
        <div>
          <button
            className="comment-popover__cancel"
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="comment-popover__save"
            disabled={!canSave}
            onClick={onSave}
            type="button"
          >
            保存
          </button>
        </div>
      </footer>
    </section>
  );
}

function Composer({ draft, onCancel, onChange, onSave }) {
  if (!draft) return null;
  const meta = KIND_META[draft.kind] ?? KIND_META.note;
  const Icon = meta.icon;

  return (
    <section className={`comment-composer tone-${meta.color}`}>
      <div className="comment-composer__heading">
        <span>
          <Icon aria-hidden="true" size={16} />
          {meta.label}
        </span>
        <button aria-label="关闭编辑" onClick={onCancel} type="button">
          <IconX aria-hidden="true" size={16} />
        </button>
      </div>
      <blockquote>{draft.exact}</blockquote>
      <textarea
        aria-label={`${meta.label}内容`}
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        placeholder={`${meta.prompt}…`}
        rows={4}
        value={draft.body}
      />
      <div className="comment-composer__actions">
        <button className="button-quiet" onClick={onCancel} type="button">
          取消
        </button>
        <button className="button-primary" onClick={onSave} type="button">
          保存批注
        </button>
      </div>
    </section>
  );
}

function AnnotationDrawer({
  draft,
  onAdd,
  onCancelDraft,
  onChangeDraft,
  onClose,
  onDelete,
  onEdit,
  onReply,
  onReopen,
  onResolve,
  onSaveDraft,
  sentence,
  threads,
}) {
  if (!sentence) return null;

  return (
    <aside
      aria-label={`${formatTime(sentence.startMs)} 的批注`}
      className="annotation-drawer"
    >
      <header className="annotation-drawer__header">
        <div>
          <span className="eyebrow">与 {formatTime(sentence.startMs)} 处句子关联</span>
          <h2>批注 {threads.length || ""}</h2>
        </div>
        <button aria-label="关闭批注" onClick={onClose} type="button">
          <IconX aria-hidden="true" size={20} />
        </button>
      </header>

      <blockquote className="annotation-drawer__quote">
        <IconMessageCircle aria-hidden="true" size={18} stroke={1.6} />
        <span>{sentence.text}</span>
      </blockquote>

      <div className="annotation-drawer__content">
        {threads.map((thread) => (
          <ThreadCard
            key={thread.id}
            onDelete={onDelete}
            onEdit={onEdit}
            onReply={onReply}
            onReopen={onReopen}
            onResolve={onResolve}
            thread={thread}
          />
        ))}
        {!threads.length && !draft && (
          <div className="drawer-empty">
            <IconPencil aria-hidden="true" size={22} stroke={1.5} />
            <strong>把你的思考留在这句话旁边</strong>
            <span>也可以先选择句中的一小段，再添加问题或笔记。</span>
          </div>
        )}
        {draft && (
          <Composer
            draft={draft}
            onCancel={onCancelDraft}
            onChange={onChangeDraft}
            onSave={onSaveDraft}
          />
        )}
      </div>

      {!draft && (
        <button className="drawer-add-button" onClick={onAdd} type="button">
          <IconPencil aria-hidden="true" size={17} stroke={1.8} />
          添加整句批注
        </button>
      )}
    </aside>
  );
}

export function App({ embedded = false, onCollapse = null }) {
  const initialTranscript = useMemo(
    () => parseTranscriptDocument(SAMPLE_TRANSCRIPT),
    [],
  );
  const [document, setDocument] = useState(() =>
    createDocument(SAMPLE_TITLE, initialTranscript, "demo"),
  );
  const [phrases, setPhrases] = useState(() =>
    detectPhrases(initialTranscript.sentences),
  );
  const [annotationThreads, setAnnotationThreads] = useState([]);
  const [savedPhrases, setSavedPhrases] = useState([]);
  const [storageReady, setStorageReady] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [activeTab, setActiveTab] = useState("transcript");
  const [showPhrases, setShowPhrases] = useState(true);
  const [includeAllCandidates, setIncludeAllCandidates] = useState(false);
  const [themeMode, setThemeMode] = useState("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    Boolean(globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches),
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePhrase, setActivePhrase] = useState(null);
  const [selection, setSelection] = useState(null);
  const [draft, setDraft] = useState(null);
  const [threadEditor, setThreadEditor] = useState(null);
  const [expandedSentenceId, setExpandedSentenceId] = useState(null);
  const [copiedSentenceId, setCopiedSentenceId] = useState(null);
  const [toast, setToast] = useState("");
  const [captionFollowMode, setCaptionFollowMode] = useState(
    CAPTION_FOLLOW_MODE.FOLLOWING,
  );
  const transcriptRef = useRef(null);
  const stageRef = useRef(null);
  const themeFrameRef = useRef(null);
  const phraseCloseTimerRef = useRef(null);
  const copyResetTimerRef = useRef(null);
  const menuRef = useRef(null);
  const hydratedDocumentIdRef = useRef(null);
  const renderedDocumentIdRef = useRef(null);
  const panelHoveredRef = useRef(false);
  const captionFollowModeRef = useRef(CAPTION_FOLLOW_MODE.FOLLOWING);
  const captionFollowInteractionBlockedRef = useRef(false);
  const captionFollowIdleTimerRef = useRef(null);
  const captionFollowFocusTimerRef = useRef(null);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef(null);
  const pointerScrollingRef = useRef(false);
  const manualScrollDuringSeekRef = useRef(false);
  const seekSettleTimerRef = useRef(null);
  const previousMediaSampleRef = useRef(null);
  const { media, playFrom, seek } = useMediaBridge();
  const captionBridge = useCaptionBridge(media);
  const resolvedTheme =
    themeMode === "system"
      ? systemPrefersDark
        ? "dark"
        : "light"
      : themeMode;
  const captionFollowInteractionBlocked = Boolean(
    activeTab !== "transcript" ||
      selection ||
      draft ||
      threadEditor ||
      menuOpen ||
      searchOpen ||
      searchTerm ||
      activePhrase ||
      expandedSentenceId
  );
  captionFollowModeRef.current = captionFollowMode;
  captionFollowInteractionBlockedRef.current =
    captionFollowInteractionBlocked;

  const applyThemeMode = useCallback((nextMode) => {
    const normalizedMode = normalizeThemeMode(nextMode);
    startTransition(() => {
      setThemeMode(normalizedMode);
    });
  }, []);

  const transitionCaptionFollow = useCallback((event) => {
    setCaptionFollowMode((current) =>
      transitionCaptionFollowMode(current, event),
    );
  }, []);

  const clearCaptionFollowIdleTimer = useCallback(() => {
    window.clearTimeout(captionFollowIdleTimerRef.current);
    captionFollowIdleTimerRef.current = null;
  }, []);

  const captionFollowFocusIsBlocked = useCallback(() => {
    const stage = stageRef.current;
    const root = stage?.getRootNode?.();
    const activeElement =
      root?.activeElement ?? stage?.ownerDocument?.activeElement ?? null;
    if (!stage || !activeElement || !stage.contains(activeElement)) {
      return false;
    }
    return Boolean(
      activeElement.closest?.(
        "input, textarea, select, [contenteditable='true'], .overflow-menu, .search-field, .comment-popover",
      ),
    );
  }, []);

  const scheduleCaptionFollowIdleResume = useCallback(() => {
    clearCaptionFollowIdleTimer();
    if (
      !shouldResumeCaptionFollowAfterIdle({
        mode: captionFollowModeRef.current,
        pointerInside: panelHoveredRef.current,
        focusBlocked: captionFollowFocusIsBlocked(),
        interactionBlocked: captionFollowInteractionBlockedRef.current,
      })
    ) {
      return;
    }
    captionFollowIdleTimerRef.current = window.setTimeout(() => {
      captionFollowIdleTimerRef.current = null;
      if (
        !shouldResumeCaptionFollowAfterIdle({
          mode: captionFollowModeRef.current,
          pointerInside: panelHoveredRef.current,
          focusBlocked: captionFollowFocusIsBlocked(),
          interactionBlocked: captionFollowInteractionBlockedRef.current,
        })
      ) {
        return;
      }
      setCaptionFollowMode((current) => {
        if (
          !shouldResumeCaptionFollowAfterIdle({
            mode: current,
            pointerInside: panelHoveredRef.current,
            focusBlocked: captionFollowFocusIsBlocked(),
            interactionBlocked: captionFollowInteractionBlockedRef.current,
          })
        ) {
          return current;
        }
        return transitionCaptionFollowMode(current, {
          type: CAPTION_FOLLOW_EVENT.RESUME,
        });
      });
    }, CAPTION_FOLLOW_IDLE_MS);
  }, [captionFollowFocusIsBlocked, clearCaptionFollowIdleTimer]);

  const restartCaptionFollowIdleWindow = useCallback(() => {
    clearCaptionFollowIdleTimer();
    scheduleCaptionFollowIdleResume();
  }, [clearCaptionFollowIdleTimer, scheduleCaptionFollowIdleResume]);

  useEffect(() => {
    if (
      captionFollowMode === CAPTION_FOLLOW_MODE.MANUAL &&
      !captionFollowInteractionBlocked
    ) {
      scheduleCaptionFollowIdleResume();
    } else {
      clearCaptionFollowIdleTimer();
    }
  }, [
    captionFollowInteractionBlocked,
    captionFollowMode,
    clearCaptionFollowIdleTimer,
    scheduleCaptionFollowIdleResume,
  ]);

  const pauseCaptionFollowForUser = useCallback(() => {
    programmaticScrollRef.current = false;
    window.clearTimeout(programmaticScrollTimerRef.current);
    setCaptionFollowMode((current) => {
      if (current === CAPTION_FOLLOW_MODE.SEEKING) {
        manualScrollDuringSeekRef.current = true;
      }
      return transitionCaptionFollowMode(current, {
        type: CAPTION_FOLLOW_EVENT.USER_SCROLL,
      });
    });
    const container = transcriptRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollTop, behavior: "auto" });
    }
  }, []);

  const annotations = useMemo(
    () => annotationThreads.map((thread) => threadToAnnotation(thread)),
    [annotationThreads],
  );

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(loadSettings())
      .then((settings) => {
        if (cancelled) return;
        setShowPhrases(settings.showPhrases !== false);
        setIncludeAllCandidates(
          settings.includeAllCandidatesOnExport === true ||
            settings.includeAllCandidates === true,
        );
        setThemeMode(normalizeThemeMode(settings.theme));
        setSettingsReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSettingsReady(false);
        setToast("设置读取失败，已暂停写入以保护现有数据");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    Promise.resolve(
      saveSettings({
        density: "standard",
        language: "en",
        showPhrases,
        theme: themeMode,
        includeAllCandidatesOnExport: includeAllCandidates,
      }),
    ).catch(() => setToast("设置保存失败，请重试"));
  }, [
    includeAllCandidates,
    settingsReady,
    showPhrases,
    themeMode,
  ]);

  useEffect(() => {
    const mediaQuery = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mediaQuery) return undefined;
    const syncSystemTheme = (event) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", syncSystemTheme);
    return () => mediaQuery.removeEventListener("change", syncSystemTheme);
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const host = stage?.getRootNode?.()?.host;
    const targets = [stage, host].filter(Boolean);
    if (!targets.length) return undefined;

    window.cancelAnimationFrame(themeFrameRef.current);
    targets.forEach((target) => {
      target.dataset.themeChanging = "true";
      target.dataset.theme = resolvedTheme;
      target.dataset.themeMode = themeMode;
    });
    themeFrameRef.current = window.requestAnimationFrame(() => {
      themeFrameRef.current = window.requestAnimationFrame(() => {
        targets.forEach((target) => {
          delete target.dataset.themeChanging;
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(themeFrameRef.current);
      targets.forEach((target) => {
        delete target.dataset.themeChanging;
      });
    };
  }, [resolvedTheme, themeMode]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      RUNTIME_BUILD.isExtension
        ? Promise.resolve(null)
        : loadPhraseAnalysisCache(document, PHRASE_ANALYZER_VERSION),
      loadPhraseFeedback(),
    ])
      .then(([cached, feedback]) => {
        if (cancelled) return;
        if (cached?.candidates) {
          setPhrases(cached.candidates);
          return;
        }
        const candidates = detectPhrases(document.sentences, { feedback });
        setPhrases(candidates);
        if (!RUNTIME_BUILD.isExtension) {
          Promise.resolve(
            savePhraseAnalysisCache(
              document,
              PHRASE_ANALYZER_VERSION,
              candidates,
            ),
          ).catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setPhrases(detectPhrases(document.sentences));
      });
    return () => {
      cancelled = true;
    };
  }, [document.id, document.sentences]);

  useEffect(() => {
    if (embedded || RUNTIME_BUILD.isExtension) return undefined;
    let cancelled = false;
    Promise.resolve(listCaptionDocuments())
      .then((documents) => {
        if (cancelled || !documents.length) return;
        const recent = documents.find((candidate) =>
          PAGE_CAPTION_PROVIDERS.has(candidate?.source?.provider),
        );
        if (!recent?.sentences?.length) return;
        setDocument(recent);
        setPhrases(detectPhrases(recent.sentences));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [embedded]);

  useEffect(() => {
    hydratedDocumentIdRef.current = null;
    setStorageReady(false);
    setAnnotationThreads([]);
    setSavedPhrases([]);
    setSelection(null);
    setDraft(null);
    setThreadEditor(null);
    setActivePhrase(null);
    clearTextSelection(transcriptRef.current);
    let cancelled = false;
    Promise.all([
      loadAnnotationThreads(document.id),
      loadSavedPhrases(document.id),
    ])
      .then(([threads, phrasesForDocument]) => {
        if (cancelled) return;
        setAnnotationThreads(Array.isArray(threads) ? threads : []);
        setSavedPhrases(
          Array.isArray(phrasesForDocument) ? phrasesForDocument : [],
        );
        hydratedDocumentIdRef.current = document.id;
        setStorageReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setAnnotationThreads([]);
        setSavedPhrases([]);
        hydratedDocumentIdRef.current = null;
        setStorageReady(false);
        setToast("学习记录读取失败，已暂停写入以保护现有数据");
      });
    return () => {
      cancelled = true;
    };
  }, [document.id]);

  useEffect(() => {
    if (
      !storageReady ||
      hydratedDocumentIdRef.current !== document.id
    ) {
      return;
    }
    Promise.resolve(
      saveAnnotationThreads(annotationThreads, document.id),
    ).catch(() => setToast("批注保存失败，请检查扩展存储空间"));
  }, [annotationThreads, document.id, storageReady]);

  useEffect(() => {
    if (
      !storageReady ||
      hydratedDocumentIdRef.current !== document.id
    ) {
      return;
    }
    Promise.resolve(saveSavedPhrases(savedPhrases, document.id)).catch(() => {
      setToast("学习单保存失败，请检查扩展存储空间");
    });
  }, [document.id, savedPhrases, storageReady]);

  useEffect(() => {
    if (
      RUNTIME_BUILD.isExtension ||
      document.source?.provider === "demo"
    ) {
      return;
    }
    Promise.resolve(saveCaptionDocument(document)).catch(() => {});
  }, [document]);

  useEffect(() => {
    if (
      captionBridge.status !== CAPTION_STATUS.READY ||
      !captionBridge.document ||
      captionBridge.document.id === document.id
    ) {
      return;
    }

    const nextDocument = createPageCaptionDocument(captionBridge.document);
    hydratedDocumentIdRef.current = null;
    setStorageReady(false);
    setAnnotationThreads([]);
    setSavedPhrases([]);
    setDocument(nextDocument);
    setPhrases(detectPhrases(nextDocument.sentences));
    setActiveTab("transcript");
    setExpandedSentenceId(null);
    setDraft(null);
    setThreadEditor(null);
    setActivePhrase(null);
    setSelection(null);
    setMenuOpen(false);
    setSearchTerm("");
  }, [
    captionBridge.document,
    captionBridge.status,
    document.id,
  ]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenu = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    return listenForShadowAwarePointerDown(menuRef.current, closeMenu);
  }, [menuOpen]);

  const hasFloatingDraft = Boolean(draft?.floating);
  const hasActivePhrase = Boolean(activePhrase);
  const hasThreadEditor = Boolean(threadEditor);
  const hasTextSelection = Boolean(selection);

  useEffect(() => {
    if (!hasFloatingDraft && !hasThreadEditor && !hasTextSelection) {
      return undefined;
    }
    const closeOnOutsidePointer = (event) => {
      const path = event.composedPath?.() ?? [event.target];
      const insideEditor = path.some(
        (node) =>
          node instanceof Element &&
          (node.matches?.(".comment-popover") ||
            node.closest?.(".comment-popover") ||
            node.matches?.(".selection-toolbar") ||
            node.closest?.(".selection-toolbar")),
      );
      if (insideEditor) return;
      setDraft(null);
      setThreadEditor(null);
      setSelection(null);
      clearTextSelection(transcriptRef.current);
    };
    return listenForShadowAwarePointerDown(
      transcriptRef.current,
      closeOnOutsidePointer,
      true,
    );
  }, [hasFloatingDraft, hasTextSelection, hasThreadEditor]);

  useEffect(() => {
    if (
      !hasActivePhrase &&
      !hasFloatingDraft &&
      !hasThreadEditor &&
      !hasTextSelection
    ) {
      return undefined;
    }
    const stage = stageRef.current;
    const ResizeObserverApi = globalThis.ResizeObserver;
    if (!stage || !ResizeObserverApi) return undefined;

    let frame = 0;
    let lastWidth = stage.clientWidth;
    let lastHeight = stage.clientHeight;
    const clampValue = (value, minimum, maximum) =>
      Math.max(minimum, Math.min(Number(value) || minimum, maximum));
    const clampFloaters = () => {
      frame = 0;
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      const stageResized = width !== lastWidth || height !== lastHeight;
      lastWidth = width;
      lastHeight = height;
      if (stageResized) {
        // Selection and phrase anchors are DOM ranges. Once text reflows their
        // cached rectangles are invalid; closing these transient surfaces is
        // safer than leaving controls detached from the selected text.
        setActivePhrase(null);
        setSelection(null);
        clearTextSelection(transcriptRef.current);
      }
      const clampPosition = (
        current,
        itemWidth,
        itemHeight,
        {
          leftKey = "left",
          topKey = "top",
          widthKey = "width",
        } = {},
      ) => {
        if (!current) return current;
        const resolvedWidth = Math.min(
          itemWidth,
          Math.max(0, width - 16),
        );
        const left = clampValue(
          current[leftKey],
          8,
          Math.max(8, width - resolvedWidth - 8),
        );
        const top = clampValue(
          current[topKey],
          8,
          Math.max(8, height - itemHeight - 8),
        );
        if (
          current[leftKey] === left &&
          current[topKey] === top &&
          current[widthKey] === resolvedWidth
        ) {
          return current;
        }
        return {
          ...current,
          [leftKey]: left,
          [topKey]: top,
          [widthKey]: resolvedWidth,
        };
      };
      setActivePhrase((current) =>
        clampPosition(current, current?.width ?? 274, 240),
      );
      setSelection((current) => {
        const toolbar = clampPosition(
          current,
          current?.toolbarMaxWidth ?? 230,
          42,
          { widthKey: "toolbarMaxWidth" },
        );
        return clampPosition(
          toolbar,
          toolbar?.editorWidth ?? 340,
          164,
          {
            leftKey: "editorLeft",
            topKey: "editorTop",
            widthKey: "editorWidth",
          },
        );
      });
      setDraft((current) =>
        current?.floating
          ? clampPosition(current, current.editorWidth ?? 340, 164, {
              leftKey: "editorLeft",
              topKey: "editorTop",
              widthKey: "editorWidth",
            })
          : current,
      );
      setThreadEditor((current) =>
        clampPosition(current, current?.width ?? 316, 190),
      );
    };
    const scheduleClamp = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(clampFloaters);
    };
    const observer = new ResizeObserverApi(scheduleClamp);
    observer.observe(stage);
    window.addEventListener("resize", scheduleClamp, { passive: true });
    scheduleClamp();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleClamp);
      window.cancelAnimationFrame(frame);
    };
  }, [
    hasActivePhrase,
    hasFloatingDraft,
    hasTextSelection,
    hasThreadEditor,
  ]);

  const savedPhraseIds = useMemo(
    () =>
      new Set(
        savedPhrases.flatMap((phrase) => [
          phrase.id,
          phraseKey(phrase),
        ]),
      ),
    [savedPhrases],
  );

  const annotationsBySentence = useMemo(() => {
    const map = new Map();
    annotations.forEach((annotation) => {
      const list = map.get(annotation.sentenceId) ?? [];
      list.push(annotation);
      map.set(annotation.sentenceId, list);
    });
    return map;
  }, [annotations]);

  const threadsBySentence = useMemo(() => {
    const map = new Map();
    annotationThreads.forEach((thread) => {
      const sentenceId = thread.anchor?.sentenceId;
      const list = map.get(sentenceId) ?? [];
      list.push(thread);
      map.set(sentenceId, list);
    });
    return map;
  }, [annotationThreads]);

  const phrasesBySentence = useMemo(() => {
    const map = new Map();
    phrases.forEach((phrase) => {
      const list = map.get(phrase.sentenceId) ?? [];
      list.push(phrase);
      map.set(phrase.sentenceId, list);
    });
    return map;
  }, [phrases]);

  const visibleSentences = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return document.sentences;
    return document.sentences.filter((sentence) =>
      sentence.text.toLowerCase().includes(normalized),
    );
  }, [document.sentences, searchTerm]);

  const documentMediaId =
    document.caption?.mediaBinding?.mediaId || document.source?.mediaId || "";
  const documentProvider =
    document.caption?.mediaBinding?.provider || "";
  const liveMediaId = media.mediaId || "";
  const liveProvider = media.provider || "";
  const bridgeMediaId = captionBridge.state?.mediaBinding?.mediaId || "";
  const bridgeProvider = captionBridge.state?.mediaBinding?.provider || "";
  const bindingMatchesDocument = (mediaId, provider) =>
    !mediaId ||
    (documentMediaId === mediaId &&
      (!documentProvider || !provider || documentProvider === provider));
  // Keep the last successful document during a same-media refresh failure,
  // but hide it as soon as either bridge reports a different active video.
  const activeMediaMatchesDocument = Boolean(
    documentMediaId &&
      (liveMediaId || bridgeMediaId) &&
      bindingMatchesDocument(liveMediaId, liveProvider) &&
      bindingMatchesDocument(bridgeMediaId, bridgeProvider),
  );
  const currentCaptionReady =
    !RUNTIME_BUILD.isExtension ||
    activeMediaMatchesDocument;
  const renderedSentences = currentCaptionReady ? visibleSentences : [];
  const waitingForCurrentCaption =
    RUNTIME_BUILD.isExtension &&
    !currentCaptionReady &&
    [CAPTION_STATUS.IDLE, CAPTION_STATUS.LOADING].includes(
      captionBridge.status,
    );

  useEffect(() => {
    if (currentCaptionReady) return;
    setActiveTab("transcript");
    setSelection(null);
    setDraft(null);
    setThreadEditor(null);
    setActivePhrase(null);
    clearTextSelection(transcriptRef.current);
  }, [currentCaptionReady]);

  const learningRecordsReady = Boolean(
    currentCaptionReady &&
      storageReady &&
      hydratedDocumentIdRef.current === document.id,
  );

  const requireLearningRecords = () => {
    if (learningRecordsReady) return true;
    setToast("学习记录尚未加载完成，请稍后再试");
    return false;
  };

  useEffect(() => {
    if (!currentCaptionReady || !document.id) return;
    if (
      renderedDocumentIdRef.current &&
      renderedDocumentIdRef.current !== document.id &&
      transcriptRef.current
    ) {
      transcriptRef.current.scrollTop = 0;
    }
    renderedDocumentIdRef.current = document.id;
  }, [currentCaptionReady, document.id]);

  useEffect(() => {
    manualScrollDuringSeekRef.current = false;
    previousMediaSampleRef.current = null;
    transitionCaptionFollow({ type: CAPTION_FOLLOW_EVENT.DOCUMENT_CHANGED });
  }, [document.id, transitionCaptionFollow]);

  const activeSentence = useMemo(() => {
    if (!currentCaptionReady) return null;
    const currentMs = media.currentTime * 1000;
    return findActiveSentence(document.sentences, currentMs);
  }, [currentCaptionReady, document.sentences, media.currentTime]);
  const activeSentenceId = activeSentence?.id ?? null;

  useEffect(() => {
    const now = performance.now();
    const previous = previousMediaSampleRef.current;
    previousMediaSampleRef.current = {
      currentTime: media.currentTime,
      sampledAt: now,
    };
    if (!previous) return undefined;

    const elapsedSeconds = Math.max(0, (now - previous.sampledAt) / 1000);
    const timeDelta = Math.abs(media.currentTime - previous.currentTime);
    const normalAdvance = media.paused ? 0.75 : elapsedSeconds + 1.5;
    const seeking = media.seeking === true || timeDelta > Math.max(3, normalAdvance * 2.5);
    if (!seeking) return undefined;

    setCaptionFollowMode((current) => {
      if (current !== CAPTION_FOLLOW_MODE.SEEKING) {
        manualScrollDuringSeekRef.current = false;
      }
      return transitionCaptionFollowMode(current, {
        type: CAPTION_FOLLOW_EVENT.SEEK_START,
      });
    });
    window.clearTimeout(seekSettleTimerRef.current);
    seekSettleTimerRef.current = window.setTimeout(() => {
      setCaptionFollowMode((current) =>
        transitionCaptionFollowMode(current, {
          type: CAPTION_FOLLOW_EVENT.SEEK_SETTLED,
          userScrolled: manualScrollDuringSeekRef.current,
        }),
      );
      manualScrollDuringSeekRef.current = false;
    }, 450);
    return undefined;
  }, [media.currentTime, media.paused, media.seeking]);

  useEffect(
    () => () => {
      window.clearTimeout(captionFollowIdleTimerRef.current);
      window.clearTimeout(captionFollowFocusTimerRef.current);
      window.clearTimeout(seekSettleTimerRef.current);
      window.clearTimeout(programmaticScrollTimerRef.current);
      window.clearTimeout(phraseCloseTimerRef.current);
      window.clearTimeout(copyResetTimerRef.current);
      window.cancelAnimationFrame(themeFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    if (activeTab !== "transcript") return undefined;
    const container = transcriptRef.current;
    if (!container) return undefined;
    const markManual = () => {
      pauseCaptionFollowForUser();
      restartCaptionFollowIdleWindow();
    };
    const handlePointerDown = (event) => {
      pointerScrollingRef.current = true;
      if (event.target === container) {
        programmaticScrollRef.current = false;
      }
    };
    const handlePointerUp = () => {
      pointerScrollingRef.current = false;
    };
    const handleScroll = () => {
      if (programmaticScrollRef.current) {
        setActivePhrase(null);
        return;
      }
      setActivePhrase(null);
      setSelection(null);
      clearTextSelection(container);
      if (pointerScrollingRef.current) markManual();
    };
    const handleScrollEnd = () => {
      programmaticScrollRef.current = false;
      window.clearTimeout(programmaticScrollTimerRef.current);
    };
    const handleKeyDown = (event) => {
      if (event.target.closest?.("button, input, textarea, select, [contenteditable]")) {
        return;
      }
      if (CAPTION_FOLLOW_SCROLL_KEYS.has(event.key)) markManual();
    };
    const eventRoot = container.getRootNode?.() ?? globalThis.document;

    container.addEventListener("wheel", markManual, { passive: true });
    container.addEventListener("touchstart", markManual, { passive: true });
    container.addEventListener("touchmove", markManual, { passive: true });
    container.addEventListener("pointerdown", handlePointerDown, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });
    container.addEventListener("scrollend", handleScrollEnd, { passive: true });
    container.addEventListener("keydown", handleKeyDown);
    eventRoot.addEventListener("pointerup", handlePointerUp, { passive: true });
    eventRoot.addEventListener("pointercancel", handlePointerUp, { passive: true });

    return () => {
      container.removeEventListener("wheel", markManual);
      container.removeEventListener("touchstart", markManual);
      container.removeEventListener("touchmove", markManual);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("scrollend", handleScrollEnd);
      container.removeEventListener("keydown", handleKeyDown);
      eventRoot.removeEventListener("pointerup", handlePointerUp);
      eventRoot.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [
    activeTab,
    pauseCaptionFollowForUser,
    restartCaptionFollowIdleWindow,
  ]);

  const scrollSentenceToFollowPosition = useCallback(
    (sentenceId, behavior = "smooth") => {
      const container = transcriptRef.current;
      if (!container || !sentenceId) return false;
      const escapedSentenceId = globalThis.CSS?.escape
        ? globalThis.CSS.escape(String(sentenceId))
        : String(sentenceId).replace(/["\\]/g, "\\$&");
      const row = container.querySelector(
        `[data-sentence-id="${escapedSentenceId}"]`,
      );
      if (!row) return false;
      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const resolvedBehavior = globalThis.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      )?.matches
        ? "auto"
        : behavior;
      const targetTop =
        container.scrollTop +
        (rowRect.top - containerRect.top) -
        container.clientHeight / 3;
      programmaticScrollRef.current = true;
      window.clearTimeout(programmaticScrollTimerRef.current);
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: resolvedBehavior,
      });
      programmaticScrollTimerRef.current = window.setTimeout(() => {
        programmaticScrollRef.current = false;
      }, resolvedBehavior === "smooth" ? 900 : 120);
      return true;
    },
    [],
  );

  useEffect(() => {
    if (
      !activeSentenceId ||
      captionFollowMode !== CAPTION_FOLLOW_MODE.FOLLOWING ||
      activeTab !== "transcript" ||
      !currentCaptionReady ||
      searchTerm
    ) {
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollSentenceToFollowPosition(activeSentenceId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeSentenceId,
    activeTab,
    captionFollowMode,
    currentCaptionReady,
    scrollSentenceToFollowPosition,
    searchTerm,
  ]);

  const playFromSentence = useCallback(
    (startMs) => {
      transitionCaptionFollow({ type: CAPTION_FOLLOW_EVENT.RESUME });
      playFrom(startMs / 1000);
    },
    [playFrom, transitionCaptionFollow],
  );

  const locateCurrentCaption = useCallback(() => {
    if (!currentCaptionReady || !document.sentences.length) return;
    transitionCaptionFollow({ type: CAPTION_FOLLOW_EVENT.RESUME });
    const currentMs = media.currentTime * 1000;
    const exact = document.sentences.find(
      (sentence) =>
        currentMs >= sentence.startMs &&
        currentMs <
          (sentence.endMs ??
            sentence.startMs + Math.max(sentence.text.length * 70, 2000)),
    );
    let target = exact ?? document.sentences[0];
    if (!exact) {
      for (const sentence of document.sentences) {
        if (sentence.startMs > currentMs) break;
        target = sentence;
      }
    }

    setActiveTab("transcript");
    setSearchTerm("");
    setSearchOpen(false);
    setDraft(null);
    setExpandedSentenceId(null);

    // Search/filter state is applied on the next render. Wait for that render
    // before resolving the row so locating also works while a search is active.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollSentenceToFollowPosition(target.id);
      });
    });
  }, [
    currentCaptionReady,
    document.sentences,
    media.currentTime,
    scrollSentenceToFollowPosition,
    transitionCaptionFollow,
  ]);

  const focusedSentence = useMemo(
    () => {
      if (!currentCaptionReady) return null;
      return (
        visibleSentences.find((sentence) => sentence.id === activeSentenceId) ??
        visibleSentences[0] ??
        document.sentences[0] ??
        null
      );
    },
    [activeSentenceId, currentCaptionReady, document.sentences, visibleSentences],
  );

  const floatingDraft = Boolean(draft?.floating);
  const drawerSentenceId = floatingDraft
    ? expandedSentenceId
    : draft?.sentenceId ?? expandedSentenceId;
  const drawerSentence =
    document.sentences.find((sentence) => sentence.id === drawerSentenceId) ??
    null;
  const drawerThreads = drawerSentence
    ? threadsBySentence.get(drawerSentence.id) ?? []
    : [];
  const drawerOpen = false;
  const handlePhraseEnter = (event, phrase) => {
    window.clearTimeout(phraseCloseTimerRef.current);
    const stageRect = stageRef.current?.getBoundingClientRect();
    const rect = rectRelativeTo(
      event.currentTarget.getBoundingClientRect(),
      stageRect,
    );
    const panelRect = rectRelativeTo(
      transcriptRef.current
        ?.closest(".caption-panel")
        ?.getBoundingClientRect(),
      stageRect,
    );
    const leftBoundary = panelRect?.left ?? 0;
    const rightBoundary = panelRect?.right ?? window.innerWidth;
    const topBoundary = panelRect?.top ?? 0;
    const bottomBoundary = panelRect?.bottom ?? window.innerHeight;
    const tooltipWidth = Math.min(
      274,
      Math.max(180, rightBoundary - leftBoundary - 24),
    );
    const tooltipHeight = 240;
    setActivePhrase({
      phrase,
      width: tooltipWidth,
      left: Math.max(
        leftBoundary + 12,
        Math.min(rect.left, rightBoundary - tooltipWidth - 12),
      ),
      top:
        rect.top - topBoundary > tooltipHeight + 16
          ? Math.max(topBoundary + 12, rect.top - tooltipHeight)
          : Math.min(rect.bottom + 8, bottomBoundary - tooltipHeight - 12),
    });
  };

  const handlePhraseFocus = (event, phrase) =>
    handlePhraseEnter(event, phrase);

  const schedulePhraseClose = () => {
    window.clearTimeout(phraseCloseTimerRef.current);
    phraseCloseTimerRef.current = window.setTimeout(
      () => setActivePhrase(null),
      140,
    );
  };

  const handleTranscriptMouseUp = (event) => {
    if (
      event.target.closest(
        "button, textarea, input, .annotation-card, .comment-composer",
      )
    ) {
      return;
    }

    const selectionContext = selectionContextWithin(transcriptRef.current);
    if (!selectionContext?.range.toString().trim()) {
      setSelection(null);
      return;
    }

    const { range } = selectionContext;
    const startElement =
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer;
    const endElement =
      range.endContainer.nodeType === Node.TEXT_NODE
        ? range.endContainer.parentElement
        : range.endContainer;
    const sentenceElement = startElement?.closest?.("[data-sentence-id]");
    const endSentenceElement = endElement?.closest?.("[data-sentence-id]");
    if (
      !sentenceElement ||
      sentenceElement !== endSentenceElement ||
      startElement?.closest?.("[data-selection-ignore]") ||
      endElement?.closest?.("[data-selection-ignore]") ||
      !transcriptRef.current?.contains(sentenceElement)
    ) {
      setSelection(null);
      setToast("请在同一句字幕内选择内容");
      return;
    }

    const sentence = document.sentences.find(
      (item) => item.id === sentenceElement.dataset.sentenceId,
    );
    if (!sentence) return;

    const textRoot = sentenceElement.querySelector("[data-sentence-text]");
    if (
      !textRoot ||
      !textRoot.contains(range.startContainer) ||
      !textRoot.contains(range.endContainer)
    ) {
      setSelection(null);
      return;
    }

    const startRange = globalThis.document.createRange();
    startRange.selectNodeContents(textRoot);
    startRange.setEnd(range.startContainer, range.startOffset);
    const endRange = globalThis.document.createRange();
    endRange.selectNodeContents(textRoot);
    endRange.setEnd(range.endContainer, range.endOffset);
    let charStart = rangeTextLengthIgnoringUi(startRange);
    let charEnd = rangeTextLengthIgnoringUi(endRange);
    let exact = sentence.text.slice(charStart, charEnd);
    const leading = exact.length - exact.trimStart().length;
    const trailing = exact.length - exact.trimEnd().length;
    charStart += leading;
    charEnd -= trailing;
    exact = sentence.text.slice(charStart, charEnd);
    if (!exact) {
      setSelection(null);
      return;
    }

    const stageRect = stageRef.current?.getBoundingClientRect();
    const rect = rectRelativeTo(range.getBoundingClientRect(), stageRect);
    const panelRect = rectRelativeTo(
      transcriptRef.current
        ?.closest(".caption-panel")
        ?.getBoundingClientRect(),
      stageRect,
    );
    const leftBoundary = panelRect?.left ?? 0;
    const rightBoundary = panelRect?.right ?? window.innerWidth;
    const topBoundary = panelRect?.top ?? 0;
    const bottomBoundary = panelRect?.bottom ?? window.innerHeight;
    const availableWidth = Math.max(0, rightBoundary - leftBoundary - 16);
    const toolbarWidth = Math.min(230, availableWidth);
    const editorWidth = Math.min(340, availableWidth);
    const editorTop =
      bottomBoundary - rect.bottom >= 188
        ? rect.bottom + 8
        : rect.top - 180;
    setSelection({
      exact,
      sentenceId: sentence.id,
      startMs: sentence.startMs,
      endMs: sentence.endMs,
      charStart,
      charEnd,
      left: Math.max(
        leftBoundary + 8,
        Math.min(rect.left, rightBoundary - toolbarWidth - 8),
      ),
      top: Math.max(topBoundary + 58, rect.top - 46),
      toolbarMaxWidth: toolbarWidth,
      editorLeft: Math.max(
        leftBoundary + 8,
        Math.min(rect.left, rightBoundary - editorWidth - 8),
      ),
      editorTop: Math.max(
        topBoundary + 8,
        Math.min(editorTop, bottomBoundary - 180),
      ),
      editorWidth,
    });
    pauseCaptionFollowForUser();
  };

  const startComment = (event) => {
    if (!selection || !requireLearningRecords()) return;
    const returnFocusElement =
      event?.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : null;
    pauseCaptionFollowForUser();
    setThreadEditor(null);
    setDraft({
      ...selection,
      kind: "note",
      body: "",
      floating: true,
      returnFocusElement,
    });
    setExpandedSentenceId(null);
    setSelection(null);
  };

  const startSentenceNote = (sentence, anchorElement = null) => {
    if (!sentence || !requireLearningRecords()) return;
    pauseCaptionFollowForUser();
    setThreadEditor(null);
    const stageRect = stageRef.current?.getBoundingClientRect();
    const panelRect = rectRelativeTo(
      transcriptRef.current
        ?.closest(".caption-panel")
        ?.getBoundingClientRect(),
      stageRect,
    );
    const anchorRect = rectRelativeTo(
      anchorElement?.getBoundingClientRect(),
      stageRect,
    );
    const floating = Boolean(panelRect && anchorRect);
    const editorWidth = floating
      ? Math.min(340, Math.max(0, panelRect.width - 16))
      : 340;
    setExpandedSentenceId(floating ? null : sentence.id);
    setDraft({
      exact: sentence.text,
      sentenceId: sentence.id,
      startMs: sentence.startMs,
      endMs: sentence.endMs,
      charStart: 0,
      charEnd: sentence.text.length,
      kind: "note",
      body: "",
      floating,
      returnFocusElement: anchorElement,
      ...(floating
        ? {
            editorLeft: Math.max(
              panelRect.left + 8,
              Math.min(
                anchorRect.right - editorWidth,
                panelRect.right - editorWidth - 8,
              ),
            ),
            editorTop: Math.max(
              panelRect.top + 8,
              Math.min(anchorRect.bottom + 8, panelRect.bottom - 180),
            ),
            editorWidth,
          }
        : {}),
    });
  };

  const restorePopoverFocus = (surface) => {
    if (!surface) return;
    const directTarget = surface.returnFocusElement;
    const sentenceId = surface.sentenceId;
    window.requestAnimationFrame(() => {
      if (directTarget?.isConnected) {
        directTarget.focus({ preventScroll: true });
        return;
      }
      if (!sentenceId) return;
      const escapedId = globalThis.CSS?.escape
        ? globalThis.CSS.escape(sentenceId)
        : String(sentenceId).replace(/["\\]/g, "\\$&");
      const row = transcriptRef.current?.querySelector(
        `[data-sentence-id="${escapedId}"]`,
      );
      row
        ?.querySelector(".transcript-row__actions button:last-child")
        ?.focus({ preventScroll: true });
    });
  };

  const cancelDraft = () => {
    const closingDraft = draft;
    setDraft(null);
    clearTextSelection(transcriptRef.current);
    restorePopoverFocus(closingDraft);
  };

  const cancelThreadEditor = () => {
    const closingEditor = threadEditor;
    setThreadEditor(null);
    restorePopoverFocus(closingEditor);
  };

  const commitComment = () => {
    if (!draft || !requireLearningRecords()) return;
    const sentence = document.sentences.find(
      (item) => item.id === draft.sentenceId,
    );
    const body = draft.body.trim();
    const thread = createAnnotationThread(
      {
        kind: draft.kind,
        body,
        exact: draft.exact,
        start: draft.charStart,
        end: draft.charEnd ?? draft.charStart + draft.exact.length,
      },
      {
        documentId: document.id,
        sentence,
      },
    );
    setAnnotationThreads((items) => [...items, thread]);
    setExpandedSentenceId(draft.floating ? null : draft.sentenceId);
    setDraft(null);
    clearTextSelection(transcriptRef.current);
    restorePopoverFocus(draft);
    setToast("批注已保存");
  };

  const deleteAnnotation = (id) => {
    if (!requireLearningRecords()) return;
    setAnnotationThreads((items) => deleteAnnotationThread(items, id));
    setToast("批注线程已删除");
  };

  const savePhrase = (phrase) => {
    if (!requireLearningRecords()) return;
    const key = phraseKey(phrase);
    if (savedPhraseIds.has(phrase.id) || savedPhraseIds.has(key)) {
      Promise.resolve(recordPhraseFeedback(phrase, "unsaved")).catch(() => {});
      setSavedPhrases((items) =>
        items.filter(
          (item) =>
            item.id !== phrase.id && phraseKey(item) !== key,
        ),
      );
      setToast("已移出学习单");
    } else {
      Promise.resolve(recordPhraseFeedback(phrase, "saved")).catch(() => {});
      setSavedPhrases((items) => [
        ...items,
        {
          ...phrase,
          documentId: document.id,
          savedAt: new Date().toISOString(),
        },
      ]);
      setToast("已加入学习单");
    }
  };

  const editThread = (threadId, body) => {
    if (!requireLearningRecords()) return;
    setAnnotationThreads((items) =>
      editAnnotationThread(items, threadId, { body }),
    );
    setToast("批注已更新");
  };

  const openThreadEditor = (
    anchorElement,
    sentenceThreads,
    preferredThreadId = null,
  ) => {
    if (!requireLearningRecords()) return;
    const preferredIndex = sentenceThreads.findIndex(
      (item) => item.id === preferredThreadId,
    );
    const fallbackIndex = sentenceThreads.findIndex(
      (item) => item.status !== "resolved",
    );
    const activeIndex =
      preferredIndex >= 0 ? preferredIndex : Math.max(0, fallbackIndex);
    const thread = sentenceThreads[activeIndex] ?? sentenceThreads[0];
    if (!thread || !anchorElement) return;
    pauseCaptionFollowForUser();
    const rootComment =
      thread.comments?.find((comment) => comment.parentId == null) ??
      thread.comments?.[0];
    const stageRect = stageRef.current?.getBoundingClientRect();
    const panelRect = rectRelativeTo(
      transcriptRef.current
        ?.closest(".caption-panel")
        ?.getBoundingClientRect(),
      stageRect,
    );
    const anchorRect = rectRelativeTo(
      anchorElement.getBoundingClientRect(),
      stageRect,
    );
    if (!panelRect) return;
    const width = Math.min(316, Math.max(0, panelRect.width - 16));
    const height = 154;
    const belowTop = anchorRect.bottom + 8;
    const top =
      panelRect.bottom - belowTop >= height
        ? belowTop
        : Math.max(panelRect.top + 8, anchorRect.top - height - 8);
    setDraft(null);
    setSelection(null);
    const editorThreads = sentenceThreads.map((item) => {
      const comment =
        item.comments?.find((candidate) => candidate.parentId == null) ??
        item.comments?.[0];
      return { id: item.id, body: comment?.body ?? "" };
    });
    setThreadEditor({
      threadId: thread.id,
      sentenceId: thread.anchor?.sentenceId,
      body: rootComment?.body ?? "",
      threads: editorThreads,
      activeIndex,
      returnFocusElement: anchorElement,
      width,
      left: Math.max(
        panelRect.left + 8,
        Math.min(anchorRect.right - width, panelRect.right - width - 8),
      ),
      top,
    });
  };

  const commitThreadEditor = () => {
    if (!threadEditor?.body.trim() || !requireLearningRecords()) return;
    const closingEditor = threadEditor;
    editThread(threadEditor.threadId, threadEditor.body.trim());
    setThreadEditor(null);
    restorePopoverFocus(closingEditor);
  };

  const replyToThread = (threadId, body) => {
    if (!requireLearningRecords()) return;
    setAnnotationThreads((items) =>
      replyToAnnotationThread(items, threadId, body),
    );
    setToast("回复已保存");
  };

  const resolveThread = (threadId) => {
    if (!requireLearningRecords()) return;
    setAnnotationThreads((items) =>
      resolveAnnotationThread(items, threadId),
    );
    setToast("批注已解决");
  };

  const reopenThread = (threadId) => {
    if (!requireLearningRecords()) return;
    setAnnotationThreads((items) =>
      reopenAnnotationThread(items, threadId),
    );
    setToast("批注已重新打开");
  };

  const copySentence = useCallback(async (sentence) => {
    if (!sentence) return;
    try {
      await writeClipboard(sentence.text);
      setCopiedSentenceId(sentence.id);
      setToast(`已复制整句 · ${formatTime(sentence.startMs)}`);
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(
        () => setCopiedSentenceId(null),
        1800,
      );
    } catch {
      setToast("复制失败，请重试");
    }
  }, []);

  const copySelectedText = useCallback(async () => {
    if (!selection) return;
    try {
      await writeClipboard(selection.exact);
      setToast("已复制选中内容");
      setSelection(null);
      clearTextSelection(transcriptRef.current);
    } catch {
      setToast("复制失败，请重试");
    }
  }, [selection]);

  const copyAllCaptions = async () => {
    const transcript = formatTranscriptForClipboard(document);
    if (!transcript) {
      setToast("当前没有可复制的字幕");
      return;
    }

    try {
      await writeClipboard(transcript);
      setToast(`已复制全部字幕 · ${document.sentences.length} 句`);
      setMenuOpen(false);
    } catch {
      setToast("复制失败，请重试");
    }
  };

  useEffect(() => {
    const eventRoot = embedded
      ? transcriptRef.current?.getRootNode?.()
      : window;
    if (!eventRoot) return undefined;

    const handleShortcut = (event) => {
      const panelRoot = transcriptRef.current?.getRootNode?.();
      const focusInsidePanel = Boolean(
        panelRoot?.activeElement &&
        panelRoot.activeElement !== globalThis.document?.body,
      );
      if (embedded && !panelHoveredRef.current && !focusInsidePanel) return;

      if (event.key === "Escape") {
        if (activePhrase) {
          setActivePhrase(null);
        } else if (selection) {
          setSelection(null);
          clearTextSelection(transcriptRef.current);
        } else if (menuOpen) {
          setMenuOpen(false);
        } else if (draft) {
          cancelDraft();
        } else if (threadEditor) {
          cancelThreadEditor();
        } else if (expandedSentenceId) {
          setExpandedSentenceId(null);
        } else if (searchOpen) {
          setSearchOpen(false);
          setSearchTerm("");
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, [contenteditable='true']")
      ) {
        return;
      }
      if (
        currentCaptionReady &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        copySentence(focusedSentence);
      }
    };
    eventRoot.addEventListener("keydown", handleShortcut);
    return () => eventRoot.removeEventListener("keydown", handleShortcut);
  }, [
    activePhrase,
    copySentence,
    currentCaptionReady,
    draft,
    embedded,
    expandedSentenceId,
    focusedSentence,
    menuOpen,
    searchOpen,
    selection,
    threadEditor,
  ]);

  const exportDocument = useMemo(
    () => ({
      ...document,
      phrases,
      savedPhrases,
    }),
    [document, phrases, savedPhrases],
  );

  const copyStudyNotes = async () => {
    if (!requireLearningRecords()) return;
    try {
      await writeClipboard(
        exportStudyMarkdown(exportDocument, annotationThreads, {
          savedPhrases,
          includeAllCandidates,
        }),
      );
      setToast("研读笔记已复制");
    } catch {
      setToast("复制失败，请重试");
    }
  };

  const downloadExport = (format) => {
    if (!requireLearningRecords()) return;
    const isJson = format === "json";
    const content = isJson
      ? exportStudyJson(exportDocument, annotationThreads, {
          savedPhrases,
          includeAllCandidates,
        })
      : exportStudyMarkdown(exportDocument, annotationThreads, {
          savedPhrases,
          includeAllCandidates,
        });
    const blob = new Blob([content], {
      type: isJson ? "application/json" : "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const anchor = globalThis.document.createElement("a");
    anchor.href = url;
    anchor.download = `captiono.${isJson ? "json" : "md"}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast(`${isJson ? "JSON" : "Markdown"} 已导出`);
  };

  const showTranscript = () => {
    setActiveTab("transcript");
  };

  const showStudySheet = () => {
    if (!requireLearningRecords()) return;
    setActiveTab("study");
    setDraft(null);
    setExpandedSentenceId(null);
  };

  const playTranscriptRow = useStableEvent((sentence) =>
    playFromSentence(sentence.startMs),
  );
  const copyTranscriptRow = useStableEvent((sentence) =>
    copySentence(sentence),
  );
  const openTranscriptRowAnnotations = useStableEvent(
    (anchorElement, sentenceId, preferredThreadId = null) =>
      openThreadEditor(
        anchorElement,
        threadsBySentence.get(sentenceId) ?? EMPTY_LIST,
        preferredThreadId,
      ),
  );
  const startTranscriptRowNote = useStableEvent((sentence, anchorElement) =>
    startSentenceNote(sentence, anchorElement),
  );
  const enterTranscriptPhrase = useStableEvent(handlePhraseEnter);
  const focusTranscriptPhrase = useStableEvent(handlePhraseFocus);
  const leaveTranscriptPhrase = useStableEvent(schedulePhraseClose);
  const activateTranscriptPhrase = useStableEvent(savePhrase);

  const StageElement = embedded ? "aside" : "main";

  return (
    <StageElement
      aria-label={embedded ? "Captiono" : undefined}
      className={`prototype-stage${
        RUNTIME_BUILD.isExtension ? " is-extension" : ""
      }${embedded ? " is-embedded" : ""}`}
      data-theme={resolvedTheme}
      data-theme-mode={themeMode}
      ref={stageRef}
      onPointerEnter={() => {
        panelHoveredRef.current = true;
        clearCaptionFollowIdleTimer();
      }}
      onPointerLeave={() => {
        panelHoveredRef.current = false;
        scheduleCaptionFollowIdleResume();
      }}
      onPointerDownCapture={() => {
        panelHoveredRef.current = true;
        clearCaptionFollowIdleTimer();
      }}
      onTouchStartCapture={() => {
        panelHoveredRef.current = true;
        clearCaptionFollowIdleTimer();
      }}
      onWheelCapture={() => {
        panelHoveredRef.current = true;
        clearCaptionFollowIdleTimer();
      }}
      onKeyDownCapture={(event) => {
        if (
          event.target.closest?.(
            "input, textarea, select, [contenteditable='true']",
          )
        ) {
          return;
        }
        if (CAPTION_FOLLOW_SCROLL_KEYS.has(event.key)) {
          restartCaptionFollowIdleWindow();
        }
      }}
      onFocusCapture={() => {
        window.clearTimeout(captionFollowFocusTimerRef.current);
        clearCaptionFollowIdleTimer();
      }}
      onBlurCapture={() => {
        window.clearTimeout(captionFollowFocusTimerRef.current);
        captionFollowFocusTimerRef.current = window.setTimeout(
          scheduleCaptionFollowIdleResume,
          0,
        );
      }}
    >
      <section
        className={`caption-panel${drawerOpen ? " has-annotation-drawer" : ""}`}
      >
        <header className="source-header">
          <div className="source-identity">
            <strong className="source-brand">
              {currentCaptionReady ? sourceLabel(document) : "CC"}
            </strong>
            <span aria-hidden="true" className="source-separator">·</span>
            <span className="source-title">
              {currentCaptionReady
                ? document.title
                : waitingForCurrentCaption
                  ? "正在读取当前视频字幕…"
                  : "当前页面没有可用字幕"}
            </span>
          </div>

          <div className="source-actions">
            <button
              aria-label="定位当前播放字幕"
              aria-pressed={captionFollowMode === CAPTION_FOLLOW_MODE.MANUAL}
              className={
                captionFollowMode === CAPTION_FOLLOW_MODE.MANUAL
                  ? "is-follow-paused"
                  : ""
              }
              disabled={!currentCaptionReady || !document.sentences.length}
              onClick={locateCurrentCaption}
              title={
                captionFollowMode === CAPTION_FOLLOW_MODE.MANUAL
                  ? "恢复字幕跟随"
                  : "定位当前字幕"
              }
              type="button"
            >
              <IconCurrentLocation aria-hidden="true" size={21} stroke={1.75} />
            </button>
            <button
              aria-expanded={searchOpen}
              aria-label="搜索字幕"
              className={searchOpen ? "is-active" : ""}
              onClick={() => setSearchOpen((value) => !value)}
              type="button"
            >
              <IconSearch aria-hidden="true" size={22} stroke={1.7} />
            </button>
            <div className="overflow-control" ref={menuRef}>
              <button
                aria-expanded={menuOpen}
                aria-label="更多操作"
                onClick={() => setMenuOpen((value) => !value)}
                type="button"
              >
                <IconDotsVertical aria-hidden="true" size={22} stroke={1.8} />
              </button>
              {menuOpen && (
                <div className="overflow-menu">
                  <span className="overflow-menu__label">字幕来源</span>
                  <button
                    onClick={() => {
                      void captionBridge.refresh();
                      setMenuOpen(false);
                    }}
                    type="button"
                  >
                    <IconRefresh aria-hidden="true" size={17} />
                    重新读取当前字幕
                  </button>
                  <button
                    disabled={!currentCaptionReady}
                    onClick={() => void copyAllCaptions()}
                    type="button"
                  >
                    <IconClipboard aria-hidden="true" size={17} />
                    复制全部字幕
                  </button>
                  {captionBridge.tracks.length > 0 && (
                    <div className="track-picker">
                      {captionBridge.tracks.map((track) => (
                        <button
                          className={
                            track.id === captionBridge.selectedTrackId
                              ? "is-selected"
                              : ""
                          }
                          key={track.id}
                          onClick={() => {
                            void captionBridge.selectTrack(track.id);
                            setMenuOpen(false);
                          }}
                          type="button"
                        >
                          <span>
                            {track.label || track.language || "字幕轨道"}
                          </span>
                          {track.id === captionBridge.selectedTrackId && (
                            <IconCheck aria-hidden="true" size={15} />
                          )}
                        </button>
                      ))}
                    </div>
                      )}
                      <span className="overflow-menu__rule" />
                      <span className="overflow-menu__label">外观</span>
                      <div
                        aria-label="主题模式"
                        className="theme-picker"
                        role="group"
                      >
                        {THEME_OPTIONS.map((option) => {
                          const ThemeIcon = option.icon;
                          return (
                            <button
                              aria-pressed={themeMode === option.value}
                              className={
                                themeMode === option.value ? "is-selected" : ""
                              }
                              key={option.value}
                              disabled={!settingsReady}
                              onClick={() => applyThemeMode(option.value)}
                              type="button"
                            >
                              <ThemeIcon aria-hidden="true" size={15} stroke={1.8} />
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      <span className="overflow-menu__rule" />
                      <span className="overflow-menu__label">重点短语</span>
                      <button
                        aria-checked={showPhrases}
                        className="menu-toggle"
                        disabled={!settingsReady}
                        onClick={() => setShowPhrases((value) => !value)}
                        role="switch"
                        type="button"
                      >
                        <IconSparkles aria-hidden="true" size={17} />
                        <span>显示重点短语</span>
                        <span
                          aria-hidden="true"
                          className={`menu-switch${showPhrases ? " is-on" : ""}`}
                        >
                          <span />
                        </span>
                      </button>
                  <span className="overflow-menu__rule" />
                  <span className="overflow-menu__label">带走学习记录</span>
                  <button
                    disabled={!learningRecordsReady || !settingsReady}
                    onClick={() =>
                      setIncludeAllCandidates((value) => !value)
                    }
                    type="button"
                  >
                    {includeAllCandidates ? (
                      <IconCheck aria-hidden="true" size={17} />
                    ) : (
                      <span aria-hidden="true" className="menu-checkbox" />
                    )}
                    {includeAllCandidates
                      ? "导出全部候选短语"
                      : "只导出已收藏短语"}
                  </button>
                  <button
                    disabled={!learningRecordsReady}
                    onClick={() => {
                      downloadExport("markdown");
                      setMenuOpen(false);
                    }}
                    type="button"
                  >
                    <IconMarkdown aria-hidden="true" size={18} />
                    导出 Markdown
                  </button>
                  <button
                    disabled={!learningRecordsReady}
                    onClick={() => {
                      downloadExport("json");
                      setMenuOpen(false);
                    }}
                    type="button"
                  >
                    <IconJson aria-hidden="true" size={18} />
                    导出 JSON
                  </button>
                  <span className="overflow-menu__rule" />
                  <div className="overflow-menu__build" role="status">
                    <strong>{RUNTIME_BUILD.runtimeVersion}</strong>
                  </div>
                </div>
              )}
            </div>
            {embedded && onCollapse && (
              <button
                aria-label="收起 Captiono 面板"
                onClick={onCollapse}
                title="收起字幕面板"
                type="button"
              >
                <IconChevronUp
                  aria-hidden="true"
                  size={21}
                  stroke={1.75}
                />
              </button>
            )}
          </div>
        </header>

        {searchOpen && (
          <div className="search-field">
            <IconSearch aria-hidden="true" size={17} />
            <input
              aria-label="搜索字幕或短语"
              autoFocus
              autoComplete="off"
              name="caption-search"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="搜索字幕或短语…"
              type="search"
              value={searchTerm}
            />
            {searchTerm && (
              <button
                aria-label="清空搜索"
                onClick={() => setSearchTerm("")}
                type="button"
              >
                <IconX aria-hidden="true" size={15} />
              </button>
            )}
          </div>
        )}

        <div className={`workbench${drawerOpen ? " has-drawer" : ""}`}>
          {activeTab === "transcript" &&
          currentCaptionReady &&
          captionFollowMode === CAPTION_FOLLOW_MODE.MANUAL &&
          activeSentence ? (
            <button
              className="caption-follow-resume"
              onClick={locateCurrentCaption}
              type="button"
            >
              <IconCurrentLocation aria-hidden="true" size={15} stroke={1.9} />
              回到当前 {formatTime(activeSentence.startMs)}
            </button>
          ) : null}
          {activeTab === "transcript" ? (
            <section
              aria-label="英文字幕"
              className="transcript-view"
              onMouseUp={handleTranscriptMouseUp}
              ref={transcriptRef}
            >
              {renderedSentences.length ? (
                <TranscriptStream
                  activeSentenceId={activeSentenceId}
                  annotationsBySentence={annotationsBySentence}
                  copiedSentenceId={copiedSentenceId}
                  onCopy={copyTranscriptRow}
                  onOpenAnnotations={openTranscriptRowAnnotations}
                  onPhraseActivate={activateTranscriptPhrase}
                  onPhraseEnter={enterTranscriptPhrase}
                  onPhraseFocus={focusTranscriptPhrase}
                  onPhraseLeave={leaveTranscriptPhrase}
                  onPlay={playTranscriptRow}
                  onStartNote={startTranscriptRowNote}
                  phrasesBySentence={phrasesBySentence}
                  savedPhraseIds={savedPhraseIds}
                  sentences={renderedSentences}
                  showPhrases={showPhrases}
                />
              ) : (
                <div className="empty-state">
                  {waitingForCurrentCaption ? (
                    <IconRefresh
                      aria-hidden="true"
                      className="is-spinning"
                      size={26}
                      stroke={1.5}
                    />
                  ) : (
                    <IconSearch aria-hidden="true" size={26} stroke={1.5} />
                  )}
                  <strong>
                    {waitingForCurrentCaption
                      ? "正在读取当前视频字幕"
                      : currentCaptionReady
                        ? "没有匹配的字幕"
                        : "当前视频没有可用字幕"}
                  </strong>
                  <span>
                    {waitingForCurrentCaption
                      ? "打开或切换视频后会自动更新"
                      : currentCaptionReady
                        ? "换一个关键词试试"
                        : captionBridge.state?.message ||
                          "请确认当前视频提供 YouTube 或 Bilibili 字幕"}
                  </span>
                </div>
              )}
            </section>
          ) : (
            <section className="study-sheet">
              <div className="study-sheet__intro">
                <span className="eyebrow">本次学习单</span>
                <h2>把真正想学的内容带走</h2>
                <p>
                  {savedPhrases.length} 个重点表达 · {annotationThreads.length}{" "}
                  条批注线程
                </p>
              </div>

              <div className="study-section">
                <h3>重点表达</h3>
                {savedPhrases.length ? (
                  savedPhrases.map((item) => (
                      <article className="saved-phrase" key={item.id}>
                        <button
                          aria-label={`${formatTime(item.startMs)} 跳转`}
                          onClick={() => {
                            seek(item.startMs / 1000);
                            showTranscript();
                          }}
                          type="button"
                        >
                          {formatTime(item.startMs)}
                        </button>
                        <div>
                          <strong>{item.exact}</strong>
                          <span>
                            {item.glossZh ||
                              item.translationZh ||
                              item.definitionEn ||
                              "结合语境理解这个表达"}
                          </span>
                        </div>
                        <span>{item.difficulty ?? "B2"}</span>
                      </article>
                    ))
                ) : (
                  <p className="study-empty">
                    悬浮字幕中的重点表达，可将它收进学习单。
                  </p>
                )}
              </div>

              <div className="study-section">
                <h3>我的批注</h3>
                {annotationThreads.length ? (
                  annotationThreads.map((thread) => (
                      <ThreadCard
                        compact
                        key={thread.id}
                        onDelete={deleteAnnotation}
                        onEdit={editThread}
                        onReopen={reopenThread}
                        onReply={replyToThread}
                        onResolve={resolveThread}
                        thread={thread}
                      />
                    ))
                ) : (
                  <p className="study-empty">
                    选择字幕中的词、短语或整句，即可添加评论。
                  </p>
                )}
              </div>
            </section>
          )}

        </div>

        <footer className="study-dock">
          <button
            aria-current={activeTab === "study" ? "page" : undefined}
            className={`study-dock__sheet${
              activeTab === "study" ? " is-active" : ""
            }`}
            disabled={!learningRecordsReady && activeTab !== "study"}
            onClick={activeTab === "study" ? showTranscript : showStudySheet}
            type="button"
          >
            <IconBookmark aria-hidden="true" size={22} stroke={1.8} />
            <span>{activeTab === "study" ? "返回研读" : "学习单"}</span>
            <strong>
              {learningRecordsReady
                ? savedPhrases.length + annotationThreads.length
                : 0}
            </strong>
          </button>
          <button
            className="study-dock__copy"
            disabled={!learningRecordsReady}
            onClick={copyStudyNotes}
            type="button"
          >
            <IconClipboard aria-hidden="true" size={19} />
            复制研读笔记
          </button>
        </footer>
      </section>

      <PhraseTooltip
        active={activePhrase}
        onEnter={() => window.clearTimeout(phraseCloseTimerRef.current)}
        onLeave={schedulePhraseClose}
        onSave={savePhrase}
        saved={
          activePhrase
            ? savedPhraseIds.has(activePhrase.phrase.id) ||
              savedPhraseIds.has(phraseKey(activePhrase.phrase))
            : false
        }
      />
      <SelectionToolbar
        onAddComment={startComment}
        onCopySelection={copySelectedText}
        selection={currentCaptionReady ? selection : null}
      />
      <CommentPopover
        draft={currentCaptionReady ? draft : null}
        onCancel={cancelDraft}
        onChange={(body) => setDraft((value) => ({ ...value, body }))}
        onSave={commitComment}
      />
      <ThreadEditorPopover
        editor={currentCaptionReady ? threadEditor : null}
        onCancel={cancelThreadEditor}
        onChange={(body) =>
          setThreadEditor((value) => ({ ...value, body }))
        }
        onDelete={() => {
          if (!threadEditor) return;
          const closingEditor = threadEditor;
          deleteAnnotation(threadEditor.threadId);
          setThreadEditor(null);
          restorePopoverFocus(closingEditor);
        }}
        onSave={commitThreadEditor}
        onSelectThread={(index) => {
          setThreadEditor((value) => {
            const thread = value?.threads[index];
            if (!value || !thread) return value;
            return {
              ...value,
              activeIndex: index,
              threadId: thread.id,
              body: thread.body,
            };
          });
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <IconCheck aria-hidden="true" size={16} />
          {toast}
        </div>
      )}
    </StageElement>
  );
}
