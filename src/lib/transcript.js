const TIMESTAMP_TOKEN = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?`;
const TIMELINE_RE = new RegExp(
  String.raw`^\s*(${TIMESTAMP_TOKEN})\s*-->\s*(${TIMESTAMP_TOKEN})(?:\s+.*)?$`,
);
const TXT_TIMELINE_RE = new RegExp(
  String.raw`^\s*\[?(${TIMESTAMP_TOKEN})\]?\s*(?:-->\s*\[?(${TIMESTAMP_TOKEN})\]?)?\s*(.*)$`,
);

function decodeCaptionEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function cleanCaptionText(value) {
  return decodeCaptionEntities(String(value ?? ""))
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\\an\d+\}/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTimestamp(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) return null;

  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if (
    !Number.isFinite(seconds) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(hours) ||
    seconds < 0 ||
    minutes < 0 ||
    hours < 0
  ) {
    return null;
  }

  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

function makeSegment({ id, sourceId, sourceIndex, startMs, endMs, text, format }) {
  return {
    id: id || `segment-${String(sourceIndex + 1).padStart(3, "0")}`,
    sourceId: sourceId || null,
    sourceIndex,
    startMs,
    endMs: Math.max(endMs, startMs + 1),
    text: cleanCaptionText(text),
    format,
  };
}

function parseTimedCaption(text, format) {
  const normalized = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const segments = [];

  for (const rawBlock of blocks) {
    const lines = rawBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    const heading = lines[0].toUpperCase();
    if (
      heading === "WEBVTT" ||
      heading.startsWith("WEBVTT ") ||
      heading === "STYLE" ||
      heading === "REGION" ||
      heading === "NOTE" ||
      heading.startsWith("NOTE ")
    ) {
      continue;
    }

    const timelineIndex = lines.findIndex((line) => TIMELINE_RE.test(line));
    if (timelineIndex === -1) continue;

    const match = lines[timelineIndex].match(TIMELINE_RE);
    const startMs = parseTimestamp(match?.[1]);
    const endMs = parseTimestamp(match?.[2]);
    const captionText = cleanCaptionText(lines.slice(timelineIndex + 1).join(" "));
    if (startMs === null || endMs === null || !captionText) continue;

    const sourceId =
      timelineIndex > 0 && !/^\d+$/.test(lines[timelineIndex - 1])
        ? lines[timelineIndex - 1]
        : null;
    segments.push(
      makeSegment({
        sourceId,
        sourceIndex: segments.length,
        startMs,
        endMs,
        text: captionText,
        format,
      }),
    );
  }

  return segments;
}

function parsePlainText(text) {
  const lines = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const drafts = [];
  let hasTimestamps = false;

  for (const line of lines) {
    const match = line.match(TXT_TIMELINE_RE);
    const startMs = match ? parseTimestamp(match[1]) : null;
    const captionText = cleanCaptionText(match?.[3] || line);

    if (match && startMs !== null && captionText) {
      hasTimestamps = true;
      drafts.push({
        startMs,
        explicitEndMs: match[2] ? parseTimestamp(match[2]) : null,
        text: captionText,
      });
    } else if (hasTimestamps && drafts.length > 0) {
      drafts.at(-1).text = cleanCaptionText(`${drafts.at(-1).text} ${line}`);
    } else if (captionText) {
      drafts.push({ startMs: null, explicitEndMs: null, text: captionText });
    }
  }

  if (!hasTimestamps) {
    return drafts.map((draft, index) =>
      makeSegment({
        sourceIndex: index,
        startMs: index * 4000,
        endMs: (index + 1) * 4000,
        text: draft.text,
        format: "txt",
      }),
    );
  }

  const timedDrafts = drafts.filter((draft) => draft.startMs !== null);
  return timedDrafts.map((draft, index) => {
    const nextStartMs = timedDrafts[index + 1]?.startMs;
    const inferredEndMs =
      nextStartMs !== undefined
        ? Math.max(draft.startMs + 500, nextStartMs)
        : draft.startMs + 4000;
    return makeSegment({
      sourceIndex: index,
      startMs: draft.startMs,
      endMs: draft.explicitEndMs ?? inferredEndMs,
      text: draft.text,
      format: "txt",
    });
  });
}

/**
 * Parse SRT, WebVTT, or timestamped/plain text into normalized segments.
 *
 * Each segment has: id, startMs, endMs, text, sourceId, sourceIndex, format.
 */
export function parseTranscript(text) {
  const value = String(text ?? "");
  if (!value.trim()) return [];

  if (/^\s*\uFEFF?WEBVTT\b/i.test(value)) {
    return parseTimedCaption(value, "vtt");
  }
  if (TIMELINE_RE.test(value.split(/\r?\n/).find((line) => line.includes("-->")) || "")) {
    return parseTimedCaption(value, "srt");
  }
  return parsePlainText(value);
}

const CJK_TEXT_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

function chunkCharacterLimit(text, latinLimit) {
  return CJK_TEXT_RE.test(text) ? Math.min(42, latinLimit) : latinLimit;
}

function splitLongChunk(chunk, latinLimit) {
  const limit = chunkCharacterLimit(chunk.text, latinLimit);
  if (chunk.text.length <= limit) return [chunk];

  const chunks = [];
  let cursor = 0;
  while (cursor < chunk.text.length) {
    let end = Math.min(chunk.text.length, cursor + limit);
    if (end < chunk.text.length) {
      const window = chunk.text.slice(cursor, end + 1);
      const minimumBreak = Math.floor(limit * 0.58);
      let preferredBreak = -1;
      for (const match of window.matchAll(/[\s,，、:：]/g)) {
        if (match.index >= minimumBreak) preferredBreak = match.index + 1;
      }
      if (preferredBreak > 0) end = cursor + preferredBreak;
    }

    const raw = chunk.text.slice(cursor, end);
    const leadingSpace = raw.length - raw.trimStart().length;
    const trailingSpace = raw.length - raw.trimEnd().length;
    const start = chunk.start + cursor + leadingSpace;
    const absoluteEnd = chunk.start + end - trailingSpace;
    if (absoluteEnd > start) {
      chunks.push({
        ...chunk,
        text: chunk.text.slice(cursor + leadingSpace, end - trailingSpace),
        start,
        end: absoluteEnd,
        complete: chunk.complete && end >= chunk.text.length,
      });
    }
    cursor = end;
  }
  return chunks;
}

function splitIntoSentenceChunks(segment, { maxChunkChars = 140 } = {}) {
  const text = segment.text;
  const chunks = [];
  const boundaryRe = /[.!?。！？；;]+(?:["'’”）)\]]+)?(?=\s+|$|[\u3400-\u9fff])/g;
  let cursor = 0;
  let match;

  while ((match = boundaryRe.exec(text))) {
    const rawEnd = match.index + match[0].length;
    const raw = text.slice(cursor, rawEnd);
    const leadingSpace = raw.length - raw.trimStart().length;
    const trailingSpace = raw.length - raw.trimEnd().length;
    const start = cursor + leadingSpace;
    const end = rawEnd - trailingSpace;
    if (end > start) chunks.push({ text: text.slice(start, end), start, end, complete: true });
    cursor = rawEnd;
  }

  const tail = text.slice(cursor);
  const tailStart = cursor + (tail.length - tail.trimStart().length);
  const tailEnd = text.length - (tail.length - tail.trimEnd().length);
  if (tailEnd > tailStart) {
    chunks.push({
      text: text.slice(tailStart, tailEnd),
      start: tailStart,
      end: tailEnd,
      complete: false,
    });
  }

  if (chunks.length === 0 && text) {
    chunks.push({ text, start: 0, end: text.length, complete: false });
  }

  const boundedChunks = chunks.flatMap((chunk) =>
    splitLongChunk(chunk, maxChunkChars),
  );
  const duration = Math.max(1, segment.endMs - segment.startMs);
  return boundedChunks.map((chunk) => ({
    ...chunk,
    cueId: segment.id,
    cueSourceIndex: segment.sourceIndex,
    sourceText: segment.text,
    sourceStart: chunk.start,
    sourceEnd: chunk.end,
    startMs: Math.round(segment.startMs + duration * (chunk.start / Math.max(1, text.length))),
    endMs: Math.round(segment.startMs + duration * (chunk.end / Math.max(1, text.length))),
  }));
}

/**
 * Merge time-based cue fragments into grammatical sentences.
 * Sentence `parts` retain a reversible mapping to the original cue ranges/times.
 */
export function mergeCuesIntoSentences(
  cues,
  { maxGapMs = 2500, maxSentenceChars = 140 } = {},
) {
  if (!Array.isArray(cues) || cues.length === 0) return [];

  const sorted = [...cues]
    .filter((cue) => cue && cleanCaptionText(cue.text))
    .map((cue, index) => ({
      ...cue,
      id: cue.id || `segment-${String(index + 1).padStart(3, "0")}`,
      sourceIndex: Number.isFinite(cue.sourceIndex) ? cue.sourceIndex : index,
      startMs: Number.isFinite(cue.startMs) ? cue.startMs : index * 4000,
      endMs: Number.isFinite(cue.endMs) ? cue.endMs : (index + 1) * 4000,
      text: cleanCaptionText(cue.text),
    }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const sentences = [];
  let current = null;

  function append(chunk) {
    if (!current) {
      current = {
        text: "",
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        cueIds: [],
        parts: [],
      };
    }

    const joiner = current.text ? " " : "";
    const start = current.text.length + joiner.length;
    current.text += `${joiner}${chunk.text}`;
    current.endMs = Math.max(current.endMs, chunk.endMs);
    if (!current.cueIds.includes(chunk.cueId)) current.cueIds.push(chunk.cueId);
    current.parts.push({
      cueId: chunk.cueId,
      cueSourceIndex: chunk.cueSourceIndex,
      sourceText: chunk.sourceText,
      sourceStart: chunk.sourceStart,
      sourceEnd: chunk.sourceEnd,
      joinerBefore: joiner,
      start,
      end: start + chunk.text.length,
      sentenceStart: start,
      sentenceEnd: start + chunk.text.length,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
    });
  }

  function flush(isComplete) {
    if (!current?.text) return;
    const index = sentences.length;
    sentences.push({
      id: `sentence-${String(index + 1).padStart(3, "0")}`,
      sourceIndex: index,
      startMs: current.startMs,
      endMs: Math.max(current.endMs, current.startMs + 1),
      text: current.text,
      cueIds: current.cueIds,
      segmentIds: current.cueIds,
      parts: current.parts,
      isComplete,
    });
    current = null;
  }

  for (const cue of sorted) {
    if (current && cue.startMs - current.endMs > maxGapMs) {
      flush(false);
    }

    for (const chunk of splitIntoSentenceChunks(cue, {
      maxChunkChars: maxSentenceChars,
    })) {
      const effectiveLimit = chunkCharacterLimit(
        `${current?.text ?? ""}${chunk.text}`,
        maxSentenceChars,
      );
      if (
        current &&
        current.text.length + 1 + chunk.text.length > effectiveLimit
      ) {
        flush(false);
      }
      append(chunk);
      if (chunk.complete) flush(true);
    }
  }
  flush(false);

  return sentences;
}

/**
 * Convenience pipeline for callers that need semantic sentences rather than
 * raw subtitle cues. Both representations are returned so a UI can seek with
 * sentence timing while still tracing every character back to its source cue.
 */
export function parseTranscriptDocument(text, options) {
  const cues = parseTranscript(text);
  return {
    cues,
    segments: cues,
    sentences: mergeCuesIntoSentences(cues, options),
  };
}

export function formatTimestamp(ms, { includeHours = false } = {}) {
  const safeMs = Math.max(0, Number(ms) || 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (includeHours || hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
