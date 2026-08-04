function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isoNow(value) {
  if (typeof value === "function") return value();
  return value || new Date().toISOString();
}

function createId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function timeAtOffset(sentence, offset) {
  const parts = Array.isArray(sentence?.parts) ? sentence.parts : [];
  for (const part of parts) {
    const partStart = part.sentenceStart ?? part.start ?? 0;
    const partEnd = part.sentenceEnd ?? part.end ?? partStart;
    if (offset >= partStart && offset <= partEnd) {
      const progress =
        (offset - partStart) / Math.max(1, partEnd - partStart);
      return Math.round(
        part.startMs + (part.endMs - part.startMs) * Math.max(0, Math.min(1, progress)),
      );
    }
  }

  const startMs = numberOrNull(sentence?.startMs) ?? 0;
  const endMs = numberOrNull(sentence?.endMs) ?? startMs;
  const progress = offset / Math.max(1, String(sentence?.text ?? "").length);
  return Math.round(startMs + (endMs - startMs) * Math.max(0, Math.min(1, progress)));
}

function findBestQuote(text, exact, prefix, suffix) {
  if (!exact) return null;
  const candidates = [];
  let cursor = 0;
  while (cursor <= text.length) {
    const start = text.indexOf(exact, cursor);
    if (start === -1) break;
    const actualPrefix = text.slice(Math.max(0, start - prefix.length), start);
    const end = start + exact.length;
    const actualSuffix = text.slice(end, end + suffix.length);
    const score =
      (prefix && actualPrefix === prefix ? 2 : 0) +
      (suffix && actualSuffix === suffix ? 2 : 0) +
      (prefix && actualPrefix.endsWith(prefix.slice(-12)) ? 1 : 0) +
      (suffix && actualSuffix.startsWith(suffix.slice(0, 12)) ? 1 : 0);
    candidates.push({ start, end, score });
    cursor = start + Math.max(1, exact.length);
  }
  return candidates.sort((a, b) => b.score - a.score || a.start - b.start)[0] || null;
}

/**
 * Build a durable quote anchor. `exact/start/end` are UTF-16 offsets, matching
 * DOM Range and String#slice. Prefix/suffix make repeated quotes re-anchorable.
 */
export function createTextAnchor(
  {
    sentence,
    sentenceId,
    exact,
    start,
    end,
    prefix,
    suffix,
    time,
    startMs,
    endMs,
    contextLength = 32,
  } = {},
) {
  const text = String(sentence?.text ?? "");
  const hasSentenceText = sentence && typeof sentence.text === "string";
  const safeStart = Math.max(
    0,
    hasSentenceText
      ? Math.min(text.length, numberOrNull(start) ?? 0)
      : numberOrNull(start) ?? 0,
  );
  const inferredEnd = numberOrNull(end) ?? safeStart + String(exact ?? "").length;
  const safeEnd = Math.max(
    safeStart,
    hasSentenceText ? Math.min(text.length, inferredEnd) : inferredEnd,
  );
  const safeExact = String(exact ?? text.slice(safeStart, safeEnd));
  const timeStart =
    numberOrNull(time?.startMs) ??
    (Array.isArray(time) ? numberOrNull(time[0]) : null) ??
    numberOrNull(startMs) ??
    (sentence ? timeAtOffset(sentence, safeStart) : null);
  const timeEnd =
    numberOrNull(time?.endMs) ??
    (Array.isArray(time) ? numberOrNull(time[1]) : null) ??
    numberOrNull(endMs) ??
    (sentence ? timeAtOffset(sentence, safeEnd) : null);

  return {
    sentenceId: sentenceId ?? sentence?.id ?? null,
    exact: safeExact,
    start: safeStart,
    end: safeEnd,
    prefix:
      prefix ?? text.slice(Math.max(0, safeStart - contextLength), safeStart),
    suffix: suffix ?? text.slice(safeEnd, safeEnd + contextLength),
    time:
      timeStart === null && timeEnd === null
        ? null
        : {
            startMs: timeStart ?? timeEnd,
            endMs: timeEnd ?? timeStart,
          },
  };
}

/**
 * Accept canonical anchors, W3C-style selectors, and legacy flat annotations.
 */
export function normalizeTextAnchor(input = {}, sentence) {
  const source = input.anchor || input;
  const target = input.target || source.target || {};
  const quote = target.quote || source.quote || {};
  const position = target.position || source.position;
  const exact =
    source.exact ??
    quote.exact ??
    input.exact ??
    input.selectedText ??
    (typeof input.quote === "string" ? input.quote : "");
  const prefix = source.prefix ?? quote.prefix ?? input.prefix ?? "";
  const suffix = source.suffix ?? quote.suffix ?? input.suffix ?? "";
  const explicitStart =
    source.start ??
    (Array.isArray(position) ? position[0] : position?.start) ??
    input.start ??
    input.selectionStart ??
    input.charStart;
  const explicitEnd =
    source.end ??
    (Array.isArray(position) ? position[1] : position?.end) ??
    input.end ??
    input.selectionEnd;
  const matched =
    explicitStart === undefined && sentence
      ? findBestQuote(String(sentence.text ?? ""), String(exact ?? ""), prefix, suffix)
      : null;
  const start = numberOrNull(explicitStart) ?? matched?.start ?? 0;
  const end = numberOrNull(explicitEnd) ?? matched?.end ?? start + String(exact ?? "").length;
  const rawTime =
    source.time ??
    target.time ??
    target.timeMs ??
    input.time ??
    input.timeMs ??
    null;

  return createTextAnchor({
    sentence,
    sentenceId:
      source.sentenceId ?? target.sentenceId ?? input.sentenceId ?? sentence?.id,
    exact,
    start,
    end,
    prefix: prefix || undefined,
    suffix: suffix || undefined,
    time: rawTime,
    startMs: input.startMs,
    endMs: input.endMs,
  });
}

export function reanchorTextAnchor(anchor, sentence) {
  const normalized = normalizeTextAnchor(anchor);
  const match = findBestQuote(
    String(sentence?.text ?? ""),
    normalized.exact,
    normalized.prefix,
    normalized.suffix,
  );
  if (!match) {
    return {
      ...normalized,
      sentenceId: sentence?.id ?? normalized.sentenceId,
      orphaned: true,
    };
  }
  return {
    ...createTextAnchor({
      sentence,
      exact: normalized.exact,
      start: match.start,
      end: match.end,
    }),
    orphaned: false,
  };
}

function normalizeComment(comment, index, stamp) {
  return {
    id: comment?.id || `comment-${String(index + 1).padStart(3, "0")}`,
    parentId: comment?.parentId ?? null,
    body: String(comment?.body ?? comment?.comment ?? comment?.text ?? ""),
    author: comment?.author ?? "me",
    createdAt: comment?.createdAt || stamp,
    updatedAt: comment?.updatedAt || comment?.createdAt || stamp,
  };
}

export function annotationToThread(annotation = {}, { documentId, sentence, now } = {}) {
  const stamp = isoNow(annotation.createdAt || now);
  const providedComments = Array.isArray(annotation.comments)
    ? annotation.comments
    : [];
  const body = annotation.body ?? annotation.comment ?? annotation.note ?? "";
  const comments =
    providedComments.length > 0
      ? providedComments.map((comment, index) => normalizeComment(comment, index, stamp))
      : body || annotation.kind !== "phrase"
        ? [
            normalizeComment(
              {
                id: annotation.commentId,
                body,
                createdAt: annotation.createdAt,
                updatedAt: annotation.updatedAt,
              },
              0,
              stamp,
            ),
          ]
        : [];

  return {
    id: annotation.id || createId("thread"),
    documentId: annotation.documentId ?? documentId ?? null,
    kind: annotation.kind || annotation.type || "note",
    status: annotation.status === "resolved" ? "resolved" : "open",
    anchor: normalizeTextAnchor(annotation, sentence),
    comments,
    ...(annotation.phraseId ? { phraseId: annotation.phraseId } : {}),
    ...(annotation.learning ? { learning: cloneJson(annotation.learning) } : {}),
    ...(annotation.tags ? { tags: cloneJson(annotation.tags) } : {}),
    createdAt: annotation.createdAt || stamp,
    updatedAt: annotation.updatedAt || stamp,
    ...(annotation.resolvedAt ? { resolvedAt: annotation.resolvedAt } : {}),
  };
}

export function createAnnotationThread(input = {}, options = {}) {
  const stamp = isoNow(options.now);
  return annotationToThread(
    {
      ...input,
      id: input.id || options.id || createId("thread"),
      commentId: input.commentId || options.commentId || createId("comment"),
      createdAt: input.createdAt || stamp,
      updatedAt: input.updatedAt || stamp,
    },
    { documentId: options.documentId, sentence: options.sentence, now: stamp },
  );
}

export function threadToAnnotation(thread = {}) {
  const anchor = normalizeTextAnchor(thread.anchor || thread);
  const rootComment =
    thread.comments?.find((comment) => comment.parentId == null) || thread.comments?.[0];
  return {
    id: thread.id,
    kind: thread.kind || "note",
    status: thread.status || "open",
    sentenceId: anchor.sentenceId,
    exact: anchor.exact,
    body: rootComment?.body ?? "",
    comment: rootComment?.body ?? "",
    startMs: anchor.time?.startMs ?? null,
    endMs: anchor.time?.endMs ?? null,
    position: { start: anchor.start, end: anchor.end },
    start: anchor.start,
    end: anchor.end,
    selectedText: anchor.exact,
    anchor,
    comments: cloneJson(thread.comments || []),
    ...(thread.documentId ? { documentId: thread.documentId } : {}),
    ...(thread.phraseId ? { phraseId: thread.phraseId } : {}),
    ...(thread.learning ? { learning: cloneJson(thread.learning) } : {}),
    ...(thread.tags ? { tags: cloneJson(thread.tags) } : {}),
    ...(thread.createdAt ? { createdAt: thread.createdAt } : {}),
    ...(thread.updatedAt ? { updatedAt: thread.updatedAt } : {}),
    ...(thread.resolvedAt ? { resolvedAt: thread.resolvedAt } : {}),
  };
}

function updateThread(threads, threadId, updater) {
  return (Array.isArray(threads) ? threads : []).map((thread) =>
    thread.id === threadId ? updater(cloneJson(thread)) : cloneJson(thread),
  );
}

export function editAnnotationComment(
  threads,
  threadId,
  commentId,
  body,
  { now } = {},
) {
  const stamp = isoNow(now);
  return updateThread(threads, threadId, (thread) => ({
    ...thread,
    comments: (thread.comments || []).map((comment) =>
      comment.id === commentId
        ? { ...comment, body: String(body ?? ""), updatedAt: stamp }
        : comment,
    ),
    updatedAt: stamp,
  }));
}

export function editAnnotationThread(
  threads,
  threadId,
  changes = {},
  { sentence, now } = {},
) {
  const stamp = isoNow(now);
  return updateThread(threads, threadId, (thread) => {
    const rootIndex = (thread.comments || []).findIndex(
      (comment) => comment.parentId == null,
    );
    const comments = cloneJson(thread.comments || []);
    if (changes.body !== undefined || changes.comment !== undefined) {
      const body = String(changes.body ?? changes.comment ?? "");
      if (rootIndex >= 0) {
        comments[rootIndex] = {
          ...comments[rootIndex],
          body,
          updatedAt: stamp,
        };
      } else {
        comments.unshift({
          id: createId("comment"),
          parentId: null,
          body,
          author: changes.author || "me",
          createdAt: stamp,
          updatedAt: stamp,
        });
      }
    }

    const hasAnchorChanges =
      changes.anchor ||
      changes.exact !== undefined ||
      changes.start !== undefined ||
      changes.end !== undefined ||
      changes.prefix !== undefined ||
      changes.suffix !== undefined ||
      changes.time !== undefined;
    const anchor = hasAnchorChanges
      ? normalizeTextAnchor(
          {
            ...thread.anchor,
            ...(changes.anchor || {}),
            ...(changes.exact !== undefined ? { exact: changes.exact } : {}),
            ...(changes.start !== undefined ? { start: changes.start } : {}),
            ...(changes.end !== undefined ? { end: changes.end } : {}),
            ...(changes.prefix !== undefined ? { prefix: changes.prefix } : {}),
            ...(changes.suffix !== undefined ? { suffix: changes.suffix } : {}),
            ...(changes.time !== undefined ? { time: changes.time } : {}),
          },
          sentence,
        )
      : thread.anchor;

    return {
      ...thread,
      ...(changes.kind ? { kind: changes.kind } : {}),
      ...(changes.tags !== undefined ? { tags: cloneJson(changes.tags) } : {}),
      anchor,
      comments,
      updatedAt: stamp,
    };
  });
}

export function replyToAnnotationThread(
  threads,
  threadId,
  body,
  { id, parentId, author = "me", now } = {},
) {
  const stamp = isoNow(now);
  return updateThread(threads, threadId, (thread) => ({
    ...thread,
    comments: [
      ...(thread.comments || []),
      {
        id: id || createId("comment"),
        parentId: parentId ?? thread.comments?.[0]?.id ?? null,
        body: String(body ?? ""),
        author,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ],
    updatedAt: stamp,
  }));
}

export function resolveAnnotationThread(threads, threadId, { now } = {}) {
  const stamp = isoNow(now);
  return updateThread(threads, threadId, (thread) => ({
    ...thread,
    status: "resolved",
    resolvedAt: stamp,
    updatedAt: stamp,
  }));
}

export function reopenAnnotationThread(threads, threadId, { now } = {}) {
  const stamp = isoNow(now);
  return updateThread(threads, threadId, (thread) => {
    const { resolvedAt: _resolvedAt, ...rest } = thread;
    return { ...rest, status: "open", updatedAt: stamp };
  });
}

export function deleteAnnotationThread(threads, threadId) {
  return (Array.isArray(threads) ? threads : [])
    .filter((thread) => thread.id !== threadId)
    .map(cloneJson);
}
