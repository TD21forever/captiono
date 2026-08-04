import { normalizeTextAnchor } from "./annotations.js";
import { detectPhrases } from "./phrases.js";
import { formatTimestamp, mergeCuesIntoSentences } from "./transcript.js";

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeSentences(document) {
  if (Array.isArray(document?.sentences)) return cloneJson(document.sentences);
  const segments = document?.segments || document?.cues;
  return Array.isArray(segments) ? mergeCuesIntoSentences(segments) : [];
}

function normalizeComments(annotation, index) {
  if (Array.isArray(annotation?.comments)) return cloneJson(annotation.comments);
  const body = annotation?.comment ?? annotation?.note ?? annotation?.body ?? "";
  if (!body && annotation?.kind === "phrase") return [];
  const stamp = annotation?.createdAt ?? null;
  return [
    {
      id: annotation?.commentId || `comment-${String(index + 1).padStart(3, "0")}`,
      parentId: null,
      body,
      author: annotation?.author || "me",
      createdAt: stamp,
      updatedAt: annotation?.updatedAt || stamp,
    },
  ];
}

function normalizeAnnotation(annotation, sentenceMap, index) {
  const sentenceId =
    annotation?.anchor?.sentenceId ||
    annotation?.target?.sentenceId ||
    annotation?.sentenceId ||
    null;
  const sentence = sentenceMap.get(sentenceId);
  const anchor = normalizeTextAnchor(annotation, sentence);
  const comments = normalizeComments(annotation, index);
  const rootComment =
    comments.find((comment) => comment.parentId == null) || comments[0];
  const target = {
    sentenceId: anchor.sentenceId,
    timeMs: anchor.time
      ? [anchor.time.startMs, anchor.time.endMs]
      : null,
    position: [anchor.start, anchor.end],
    quote: {
      exact: anchor.exact,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
    },
  };

  return {
    id: annotation?.id || `annotation-${String(index + 1).padStart(3, "0")}`,
    kind: annotation?.kind || annotation?.type || "note",
    status: annotation?.status || "open",
    anchor,
    target,
    comments,
    comment: rootComment?.body ?? "",
    ...(annotation?.tags ? { tags: cloneJson(annotation.tags) } : {}),
    ...(annotation?.createdAt ? { createdAt: annotation.createdAt } : {}),
    ...(annotation?.updatedAt ? { updatedAt: annotation.updatedAt } : {}),
    ...(annotation?.resolvedAt ? { resolvedAt: annotation.resolvedAt } : {}),
  };
}

function phraseFromSavedItem(item) {
  if (item?.kind === "phrase" && item.learning) {
    return {
      ...cloneJson(item.learning),
      id: item.phraseId || item.learning.id,
      savedAt: item.createdAt || item.learning.savedAt || null,
    };
  }
  if (item?.kind === "phrase") {
    return {
      id: item.phraseId || item.id,
      sentenceId: item.sentenceId ?? null,
      exact: item.exact ?? item.selectedText ?? "",
      phrase: item.phrase ?? item.exact ?? "",
      glossZh: item.body ?? item.comment ?? "",
      translationZh: item.body ?? item.comment ?? "",
      start: item.start ?? item.position?.start ?? 0,
      end:
        item.end ??
        item.position?.end ??
        (item.start ?? 0) + String(item.exact ?? "").length,
      startMs: item.startMs ?? null,
      endMs: item.endMs ?? null,
      savedAt: item.createdAt ?? null,
    };
  }
  return cloneJson(item);
}

function dedupePhrases(phrases) {
  const seen = new Set();
  return phrases.filter((phrase) => {
    if (!phrase) return false;
    const key =
      phrase.id ||
      `${phrase.sentenceId || ""}:${phrase.start ?? ""}:${phrase.end ?? ""}:${phrase.exact || phrase.phrase || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectPhrases(document, annotations, sentences, options) {
  const candidates = Array.isArray(document?.phrases)
    ? cloneJson(document.phrases)
    : detectPhrases(sentences);
  if (options.includeAllCandidates) return dedupePhrases(candidates);

  const explicit = Array.isArray(options.savedPhrases)
    ? options.savedPhrases
    : Array.isArray(document?.savedPhrases)
      ? document.savedPhrases
      : [];
  const savedCandidates = candidates.filter(
    (phrase) => phrase.saved === true || phrase.isSaved === true,
  );
  const phraseAnnotations = annotations
    .filter((annotation) => annotation?.kind === "phrase")
    .map(phraseFromSavedItem);
  return dedupePhrases([
    ...explicit.map(phraseFromSavedItem),
    ...savedCandidates,
    ...phraseAnnotations,
  ]);
}

function relevantSegments(segments, sentences) {
  const cueIds = new Set(
    sentences.flatMap(
      (sentence) => sentence.cueIds || sentence.segmentIds || [sentence.id],
    ),
  );
  if (cueIds.size === 0) return [];
  return segments.filter((segment) => cueIds.has(segment.id));
}

function portableSource(document) {
  const source = document?.source;
  if (!source || typeof source !== "object") return null;
  const provider = String(source.provider ?? "").trim();
  const canonicalUrl = String(
    source.canonicalUrl ?? document?.sourceUrl ?? "",
  ).trim();
  const mediaId = String(source.mediaId ?? "").trim();
  if (!provider && !canonicalUrl && !mediaId) return null;
  return { provider, canonicalUrl, mediaId };
}

function portableCaption(document) {
  const caption = document?.caption;
  if (!caption || typeof caption !== "object") return null;
  const selectedTrackId = String(caption.selectedTrackId ?? "").trim();
  const capturedAt = String(caption.capturedAt ?? "").trim();
  if (!selectedTrackId && !capturedAt) return null;
  return { selectedTrackId, capturedAt };
}

function portableTranscription(document) {
  const transcription = document?.transcription;
  if (!transcription || typeof transcription !== "object") return null;
  return {
    provider: String(transcription.provider ?? "").trim(),
    privacy: String(transcription.privacy ?? "").trim(),
    timelineAccuracy: String(
      transcription.timelineAccuracy ?? "",
    ).trim(),
    audioPersisted: transcription.audioPersisted === true,
    startedAt: String(transcription.startedAt ?? "").trim(),
    stoppedAt: String(transcription.stoppedAt ?? "").trim(),
  };
}

function captionSourceLabel(provider) {
  return (
    {
      "page-text-track": "浏览器标准 TextTrack",
      "youtube-page-manifest": "YouTube 页面字幕清单",
      "youtube-player-caption": "YouTube 播放器字幕",
      "bilibili-page-subtitle": "Bilibili 页面字幕",
      "tab-audio-transcription": "Chrome 本机标签页音频转写",
      import: "本地导入",
    }[provider] ?? provider
  );
}

/**
 * Build a portable study package.
 *
 * By default this exports only user-saved phrases, annotations, and the
 * sentences/cues needed to understand them. Pass `{ includeAllCandidates:
 * true }` to include every local/provider phrase candidate, or
 * `{ includeTranscript: true }` for the complete transcript.
 */
export function buildCanonicalStudyExport(
  document = {},
  annotations = [],
  options = {},
) {
  const allSentences = normalizeSentences(document);
  const allSegments = Array.isArray(document?.segments)
    ? cloneJson(document.segments)
    : Array.isArray(document?.cues)
      ? cloneJson(document.cues)
      : [];
  const annotationItems = Array.isArray(annotations) ? annotations : [];
  const phraseSource = selectPhrases(document, annotationItems, allSentences, options);
  const transcriptHash =
    document?.transcriptHash ||
    fnv1a(allSentences.map((sentence) => `${sentence.startMs}|${sentence.text}`).join("\n"));
  const sentenceMap = new Map(allSentences.map((sentence) => [sentence.id, sentence]));
  const normalizedAnnotations = annotationItems
    .filter((annotation) => annotation?.kind !== "phrase")
    .map((annotation, index) => normalizeAnnotation(annotation, sentenceMap, index));
  const relevantSentenceIds = new Set([
    ...phraseSource.map((phrase) => phrase.sentenceId).filter(Boolean),
    ...normalizedAnnotations
      .map((annotation) => annotation.anchor?.sentenceId)
      .filter(Boolean),
  ]);
  const sentences = options.includeTranscript
    ? allSentences
    : allSentences.filter((sentence) => relevantSentenceIds.has(sentence.id));
  const segments = options.includeTranscript
    ? allSegments
    : relevantSegments(allSegments, sentences);
  const source = portableSource(document);
  const caption = portableCaption(document);
  const transcription = portableTranscription(document);

  return {
    schemaVersion: "2.0",
    exportOptions: {
      includeAllCandidates: options.includeAllCandidates === true,
      includeTranscript: options.includeTranscript === true,
    },
    document: {
      id: document?.id || transcriptHash,
      title: document?.title || "Untitled transcript",
      sourceUrl: document?.sourceUrl || "",
      language: document?.language || "en",
      transcriptHash,
      segments,
      sentences,
      ...(source ? { source } : {}),
      ...(caption ? { caption } : {}),
      ...(transcription ? { transcription } : {}),
    },
    phrases: phraseSource,
    annotations: normalizedAnnotations,
  };
}

export function exportStudyJson(document, annotations = [], options = {}) {
  return JSON.stringify(
    buildCanonicalStudyExport(document, annotations, options),
    null,
    2,
  );
}

export function formatTranscriptForClipboard(document = {}) {
  const body = normalizeSentences(document)
    .map((sentence) => {
      const text = String(sentence?.text ?? "").trim();
      if (!text) return "";
      return `${formatTimestamp(sentence.startMs)} ${text}`;
    })
    .filter(Boolean)
    .join("\n");
  if (!body) return "";

  const title = String(document?.title ?? "").trim();
  return title ? `${title}\n\n${body}` : body;
}

function escapeMarkdown(value) {
  return String(value ?? "").replace(/\|/g, "\\|").trim();
}

function annotationLabel(kind) {
  return (
    {
      question: "问题",
      phrase: "好表达",
      highlight: "高亮",
      note: "笔记",
    }[kind] || kind
  );
}

export function exportStudyMarkdown(document, annotations = [], options = {}) {
  const study = buildCanonicalStudyExport(document, annotations, options);
  const lines = [`# ${escapeMarkdown(study.document.title)}`, ""];

  if (study.document.sourceUrl) lines.push(`- 来源：${study.document.sourceUrl}`);
  if (study.document.source?.provider) {
    lines.push(
      `- 字幕来源：${captionSourceLabel(study.document.source.provider)}`,
    );
  }
  if (study.document.transcription) {
    lines.push(
      `- 转写隐私：本机处理，录音${
        study.document.transcription.audioPersisted ? "已保存" : "未保存"
      }`,
    );
    if (study.document.transcription.timelineAccuracy === "approximate") {
      lines.push("- 时间轴：近似值");
    }
  }
  lines.push(`- 语言：${study.document.language}`);
  lines.push(`- Transcript hash：\`${study.document.transcriptHash}\``, "", "## 学习记录", "");

  if (study.phrases.length === 0 && study.annotations.length === 0) {
    lines.push("_还没有保存重点表达或批注。_", "");
  }

  const phrasesBySentence = new Map();
  for (const phrase of study.phrases) {
    const list = phrasesBySentence.get(phrase.sentenceId) || [];
    list.push(phrase);
    phrasesBySentence.set(phrase.sentenceId, list);
  }

  const annotationsBySentence = new Map();
  for (const annotation of study.annotations) {
    const sentenceId = annotation.anchor?.sentenceId;
    const list = annotationsBySentence.get(sentenceId) || [];
    list.push(annotation);
    annotationsBySentence.set(sentenceId, list);
  }

  for (const sentence of study.document.sentences) {
    const phrases = phrasesBySentence.get(sentence.id) || [];
    const notes = annotationsBySentence.get(sentence.id) || [];
    if (phrases.length === 0 && notes.length === 0) continue;

    lines.push(`### ${formatTimestamp(sentence.startMs)}`, "", `> ${sentence.text}`, "");
    for (const phrase of phrases) {
      const meta = [phrase.category, phrase.difficulty].filter(Boolean).join(" · ");
      lines.push(
        `- **${phrase.exact || phrase.phrase}** — ${phrase.glossZh || phrase.translationZh || ""}${meta ? `（${meta}）` : ""}`,
      );
    }
    for (const note of notes) {
      const quote = note.anchor?.exact;
      const quotePart = quote ? `「${quote}」：` : "";
      const resolved = note.status === "resolved" ? "（已解决）" : "";
      const root =
        note.comments.find((comment) => comment.parentId == null) ||
        note.comments[0];
      lines.push(
        `- **${annotationLabel(note.kind)}${resolved}** ${quotePart}${escapeMarkdown(root?.body || "")}`,
      );
      for (const reply of note.comments.filter((comment) => comment.id !== root?.id)) {
        lines.push(`  - 回复：${escapeMarkdown(reply.body)}`);
      }
    }
    lines.push("");
  }

  const renderedSentenceIds = new Set(
    study.document.sentences.map((sentence) => sentence.id),
  );
  const unattached = study.annotations.filter(
    (annotation) => !renderedSentenceIds.has(annotation.anchor?.sentenceId),
  );
  if (unattached.length > 0) {
    lines.push("## 未定位的批注", "");
    for (const note of unattached) {
      const root =
        note.comments.find((comment) => comment.parentId == null) ||
        note.comments[0];
      lines.push(`- **${annotationLabel(note.kind)}** ${escapeMarkdown(root?.body || "")}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}
