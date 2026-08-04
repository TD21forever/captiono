import {
  startTransition,
  useCallback,
  useEffect,
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
  CAPTION_FOLLOW_EVENT,
  CAPTION_FOLLOW_MODE,
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
  transitionCaptionFollowMode,
} from "./lib/index.js";
import {
  BILIBILI_PAGE_SUBTITLE_SOURCE,
  CAPTION_STATUS,
  PAGE_TEXT_TRACK_SOURCE,
  YOUTUBE_PAGE_MANIFEST_SOURCE,
  YOUTUBE_PLAYER_CAPTION_SOURCE,
} from "./lib/captionSources.js";
import { useCaptionBridge } from "./hooks/useCaptionBridge.js";
import { useMediaBridge } from "./hooks/useMediaBridge.js";

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
  const { phrase, left, top } = active;
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
      style={{ left, top }}
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
      role="toolbar"
      style={{ left: selection.left, top: selection.top }}
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
      style={{ left: draft.editorLeft, top: draft.editorTop }}
    >
      <textarea
        aria-label="批注内容"
        autoFocus
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === "Enter" &&
            canSave
          ) {
            event.preventDefault();
            onSave();
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
      style={{ left: editor.left, top: editor.top }}
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
          if (event.key === "Escape") onCancel();
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === "Enter" &&
            canSave
          ) {
            event.preventDefault();
            onSave();
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

  const applyThemeMode = useCallback(
    (nextMode) => {
      const normalizedMode = normalizeThemeMode(nextMode);
      const nextTheme =
        normalizedMode === "system"
          ? systemPrefersDark
            ? "dark"
            : "light"
          : normalizedMode;
      const stage = stageRef.current;
      const host = stage?.getRootNode?.()?.host;
      const targets = [stage, host].filter(Boolean);

      window.cancelAnimationFrame(themeFrameRef.current);
      targets.forEach((target) => {
        target.dataset.themeChanging = "true";
        target.dataset.theme = nextTheme;
        target.dataset.themeMode = normalizedMode;
      });
      themeFrameRef.current = window.requestAnimationFrame(() => {
        themeFrameRef.current = window.requestAnimationFrame(() => {
          targets.forEach((target) => {
            delete target.dataset.themeChanging;
          });
        });
      });

      startTransition(() => {
        setThemeMode(normalizedMode);
      });
    },
    [systemPrefersDark],
  );

  const transitionCaptionFollow = useCallback((event) => {
    setCaptionFollowMode((current) =>
      transitionCaptionFollowMode(current, event),
    );
  }, []);

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
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSettingsReady(true);
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
    ).catch(() => {});
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

  useEffect(() => {
    const host = transcriptRef.current?.getRootNode?.()?.host;
    if (!host) return;
    host.dataset.theme = resolvedTheme;
    host.dataset.themeMode = themeMode;
  }, [resolvedTheme, themeMode]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadPhraseAnalysisCache(document, PHRASE_ANALYZER_VERSION),
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
        Promise.resolve(
          savePhraseAnalysisCache(
            document,
            PHRASE_ANALYZER_VERSION,
            candidates,
          ),
        ).catch(() => {});
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
      })
      .catch(() => {
        if (cancelled) return;
        setAnnotationThreads([]);
        setSavedPhrases([]);
        hydratedDocumentIdRef.current = document.id;
      })
      .finally(() => {
        if (!cancelled) setStorageReady(true);
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
    ).catch(() => {});
  }, [annotationThreads, document.id, storageReady]);

  useEffect(() => {
    if (
      !storageReady ||
      hydratedDocumentIdRef.current !== document.id
    ) {
      return;
    }
    Promise.resolve(saveSavedPhrases(savedPhrases, document.id)).catch(() => {});
  }, [document.id, savedPhrases, storageReady]);

  useEffect(() => {
    if (document.source?.provider === "demo") return;
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
    const eventRoot = menuRef.current?.getRootNode?.() ?? globalThis.document;
    const closeMenu = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    eventRoot.addEventListener("pointerdown", closeMenu);
    return () => eventRoot.removeEventListener("pointerdown", closeMenu);
  }, [menuOpen]);

  useEffect(() => {
    if (!draft?.floating && !threadEditor) return undefined;
    const eventRoot = transcriptRef.current?.getRootNode?.() ??
      globalThis.document;
    const closeOnOutsidePointer = (event) => {
      const path = event.composedPath?.() ?? [event.target];
      const insideEditor = path.some(
        (node) =>
          node instanceof Element &&
          (node.matches?.(".comment-popover") ||
            node.closest?.(".comment-popover")),
      );
      if (insideEditor) return;
      setDraft(null);
      setThreadEditor(null);
      setSelection(null);
      clearTextSelection(transcriptRef.current);
    };
    eventRoot.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () =>
      eventRoot.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [draft?.floating, threadEditor]);

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
  const bridgeMediaId = captionBridge.state?.mediaBinding?.mediaId || "";
  const bridgeStillMatchesDocument = Boolean(
    documentMediaId && bridgeMediaId && documentMediaId === bridgeMediaId,
  );
  const currentCaptionReady =
    !RUNTIME_BUILD.isExtension ||
    (captionBridge.status === CAPTION_STATUS.READY &&
      captionBridge.document?.id === document.id) ||
    (captionBridge.status === CAPTION_STATUS.LOADING &&
      bridgeStillMatchesDocument);
  const renderedSentences = currentCaptionReady ? visibleSentences : [];
  const waitingForCurrentCaption =
    RUNTIME_BUILD.isExtension &&
    [CAPTION_STATUS.IDLE, CAPTION_STATUS.LOADING].includes(
      captionBridge.status,
    );

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
    const currentMs = media.currentTime * 1000;
    return document.sentences.find(
      (sentence) =>
        currentMs >= sentence.startMs &&
        currentMs <
          (sentence.endMs ??
            sentence.startMs + Math.max(sentence.text.length * 70, 2000)),
    );
  }, [document.sentences, media.currentTime]);
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
      window.clearTimeout(seekSettleTimerRef.current);
      window.clearTimeout(programmaticScrollTimerRef.current);
      window.cancelAnimationFrame(themeFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    if (activeTab !== "transcript") return undefined;
    const container = transcriptRef.current;
    if (!container) return undefined;
    const scrollKeys = new Set([
      "ArrowUp",
      "ArrowDown",
      "PageUp",
      "PageDown",
      "Home",
      "End",
      " ",
    ]);
    const markManual = () => pauseCaptionFollowForUser();
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
      if (programmaticScrollRef.current) return;
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
      if (scrollKeys.has(event.key)) markManual();
    };
    const eventRoot = container.getRootNode?.() ?? globalThis.document;

    container.addEventListener("wheel", markManual, { passive: true });
    container.addEventListener("touchmove", markManual, { passive: true });
    container.addEventListener("pointerdown", handlePointerDown, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });
    container.addEventListener("scrollend", handleScrollEnd, { passive: true });
    container.addEventListener("keydown", handleKeyDown);
    eventRoot.addEventListener("pointerup", handlePointerUp, { passive: true });
    eventRoot.addEventListener("pointercancel", handlePointerUp, { passive: true });

    return () => {
      container.removeEventListener("wheel", markManual);
      container.removeEventListener("touchmove", markManual);
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("scrollend", handleScrollEnd);
      container.removeEventListener("keydown", handleKeyDown);
      eventRoot.removeEventListener("pointerup", handlePointerUp);
      eventRoot.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [activeTab, pauseCaptionFollowForUser]);

  const scrollSentenceToFollowPosition = useCallback(
    (sentenceId, behavior = "smooth") => {
      const container = transcriptRef.current;
      if (!container || !sentenceId) return false;
      const row = Array.from(
        container.querySelectorAll("[data-sentence-id]"),
      ).find((element) => element.dataset.sentenceId === sentenceId);
      if (!row) return false;
      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const targetTop =
        container.scrollTop +
        (rowRect.top - containerRect.top) -
        container.clientHeight / 3;
      programmaticScrollRef.current = true;
      window.clearTimeout(programmaticScrollTimerRef.current);
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior,
      });
      programmaticScrollTimerRef.current = window.setTimeout(() => {
        programmaticScrollRef.current = false;
      }, behavior === "smooth" ? 900 : 120);
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
    if (!document.sentences.length) return;
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
    document.sentences,
    media.currentTime,
    scrollSentenceToFollowPosition,
    transitionCaptionFollow,
  ]);

  const focusedSentence = useMemo(
    () =>
      visibleSentences.find((sentence) => sentence.id === activeSentenceId) ??
      visibleSentences[0] ??
      document.sentences[0] ??
      null,
    [activeSentenceId, document.sentences, visibleSentences],
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
    const rect = event.currentTarget.getBoundingClientRect();
    const panelRect = transcriptRef.current
      ?.closest(".caption-panel")
      ?.getBoundingClientRect();
    const leftBoundary = panelRect?.left ?? 0;
    const rightBoundary = panelRect?.right ?? window.innerWidth;
    const topBoundary = panelRect?.top ?? 0;
    const bottomBoundary = panelRect?.bottom ?? window.innerHeight;
    const tooltipWidth = 274;
    const tooltipHeight = 158;
    setActivePhrase({
      phrase,
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
    let charStart = startRange.toString().length;
    let charEnd = endRange.toString().length;
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

    const rect = range.getBoundingClientRect();
    const panelRect = transcriptRef.current
      ?.closest(".caption-panel")
      ?.getBoundingClientRect();
    const leftBoundary = panelRect?.left ?? 0;
    const rightBoundary = panelRect?.right ?? window.innerWidth;
    const topBoundary = panelRect?.top ?? 0;
    const bottomBoundary = panelRect?.bottom ?? window.innerHeight;
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
        Math.min(rect.left, rightBoundary - 220),
      ),
      top: Math.max(topBoundary + 58, rect.top - 46),
      editorLeft: Math.max(
        leftBoundary + 8,
        Math.min(rect.left, rightBoundary - 348),
      ),
      editorTop: Math.max(
        topBoundary + 8,
        Math.min(editorTop, bottomBoundary - 180),
      ),
    });
  };

  const startComment = () => {
    if (!selection) return;
    setThreadEditor(null);
    setDraft({ ...selection, kind: "note", body: "", floating: true });
    setExpandedSentenceId(null);
    setSelection(null);
  };

  const startSentenceNote = (sentence, anchorElement = null) => {
    if (!sentence) return;
    setThreadEditor(null);
    const panelRect = transcriptRef.current
      ?.closest(".caption-panel")
      ?.getBoundingClientRect();
    const anchorRect = anchorElement?.getBoundingClientRect();
    const floating = Boolean(panelRect && anchorRect);
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
      ...(floating
        ? {
            editorLeft: Math.max(
              panelRect.left + 8,
              Math.min(anchorRect.left - 300, panelRect.right - 348),
            ),
            editorTop: Math.max(
              panelRect.top + 8,
              Math.min(anchorRect.bottom + 8, panelRect.bottom - 180),
            ),
          }
        : {}),
    });
  };

  const commitComment = () => {
    if (!draft) return;
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
    setToast("批注已保存");
  };

  const deleteAnnotation = (id) => {
    setAnnotationThreads((items) => deleteAnnotationThread(items, id));
    setToast("批注线程已删除");
  };

  const savePhrase = (phrase) => {
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
    const rootComment =
      thread.comments?.find((comment) => comment.parentId == null) ??
      thread.comments?.[0];
    const panelRect = transcriptRef.current
      ?.closest(".caption-panel")
      ?.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();
    if (!panelRect) return;
    const width = 316;
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
      body: rootComment?.body ?? "",
      threads: editorThreads,
      activeIndex,
      left: Math.max(
        panelRect.left + 8,
        Math.min(anchorRect.right - width, panelRect.right - width - 8),
      ),
      top,
    });
  };

  const commitThreadEditor = () => {
    if (!threadEditor?.body.trim()) return;
    editThread(threadEditor.threadId, threadEditor.body.trim());
    setThreadEditor(null);
  };

  const replyToThread = (threadId, body) => {
    setAnnotationThreads((items) =>
      replyToAnnotationThread(items, threadId, body),
    );
    setToast("回复已保存");
  };

  const resolveThread = (threadId) => {
    setAnnotationThreads((items) =>
      resolveAnnotationThread(items, threadId),
    );
    setToast("批注已解决");
  };

  const reopenThread = (threadId) => {
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
          setDraft(null);
        } else if (threadEditor) {
          setThreadEditor(null);
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
    setActiveTab("study");
    setDraft(null);
    setExpandedSentenceId(null);
  };

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
      }}
      onPointerLeave={() => {
        panelHoveredRef.current = false;
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
                <section className="transcript-stream">
                  {renderedSentences.map((sentence) => {
                    const rowAnnotations =
                      annotationsBySentence.get(sentence.id) ?? [];
                    const isActive = sentence.id === activeSentenceId;
                    return (
                      <article
                        className={`transcript-row${
                          isActive ? " is-active" : ""
                        }`}
                        data-sentence-id={sentence.id}
                        key={sentence.id}
                      >
                        <button
                          aria-label={`从 ${formatTime(sentence.startMs)} 开始播放`}
                          className="transcript-row__time"
                          onClick={() => playFromSentence(sentence.startMs)}
                          title="从这里播放"
                          type="button"
                        >
                          <IconPlayerPlayFilled aria-hidden="true" size={11} />
                          {formatTime(sentence.startMs)}
                        </button>
                        <p className="transcript-row__text" data-sentence-text="">
                          <PhraseText
                            annotations={rowAnnotations}
                            onAnnotationActivate={(event, annotation) =>
                              openThreadEditor(
                                event.currentTarget,
                                threadsBySentence.get(sentence.id) ?? [],
                                annotation.id,
                              )
                            }
                            onPhraseEnter={handlePhraseEnter}
                            onPhraseFocus={handlePhraseFocus}
                            onPhraseLeave={schedulePhraseClose}
                            onPhraseActivate={savePhrase}
                            phrases={phrasesBySentence.get(sentence.id) ?? []}
                            savedPhraseIds={savedPhraseIds}
                            sentence={sentence}
                            showPhrases={showPhrases}
                          />
                        </p>
                        <div className="transcript-row__actions">
                          <button
                            aria-label={`${formatTime(sentence.startMs)} 复制整句`}
                            className={`transcript-row__copy${
                              copiedSentenceId === sentence.id
                                ? " is-copied"
                                : ""
                            }`}
                            onClick={() => copySentence(sentence)}
                            title="复制整句"
                            type="button"
                          >
                            {copiedSentenceId === sentence.id ? (
                              <IconCheck aria-hidden="true" size={15} />
                            ) : (
                              <IconCopy aria-hidden="true" size={15} />
                            )}
                            <span className="transcript-row__action-label">
                              {copiedSentenceId === sentence.id ? "已复制" : "复制"}
                            </span>
                          </button>
                          <button
                            aria-label={
                              rowAnnotations.length
                                ? `${rowAnnotations.length} 条批注`
                                : "添加整句批注"
                            }
                            className={
                              rowAnnotations.length ? "has-count" : ""
                            }
                            onClick={(event) => {
                              if (rowAnnotations.length) {
                                openThreadEditor(
                                  event.currentTarget,
                                  threadsBySentence.get(sentence.id) ?? [],
                                );
                              } else {
                                startSentenceNote(sentence, event.currentTarget);
                              }
                            }}
                            title={
                              rowAnnotations.length ? "查看批注" : "添加整句批注"
                            }
                            type="button"
                          >
                            <IconMessageCircle aria-hidden="true" size={15} />
                            {rowAnnotations.length > 0 && (
                              <span className="transcript-row__count">
                                {rowAnnotations.length}
                              </span>
                            )}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </section>
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
            onClick={activeTab === "study" ? showTranscript : showStudySheet}
            type="button"
          >
            <IconBookmark aria-hidden="true" size={22} stroke={1.8} />
            <span>{activeTab === "study" ? "返回研读" : "学习单"}</span>
            <strong>{savedPhrases.length + annotationThreads.length}</strong>
          </button>
          <button
            className="study-dock__copy"
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
        selection={selection}
      />
      <CommentPopover
        draft={draft}
        onCancel={() => {
          setDraft(null);
          clearTextSelection(transcriptRef.current);
        }}
        onChange={(body) => setDraft((value) => ({ ...value, body }))}
        onSave={commitComment}
      />
      <ThreadEditorPopover
        editor={threadEditor}
        onCancel={() => setThreadEditor(null)}
        onChange={(body) =>
          setThreadEditor((value) => ({ ...value, body }))
        }
        onDelete={() => {
          if (!threadEditor) return;
          deleteAnnotation(threadEditor.threadId);
          setThreadEditor(null);
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
