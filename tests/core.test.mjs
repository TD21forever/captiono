import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPTION_FOLLOW_EVENT,
  CAPTION_FOLLOW_MODE,
  LOCAL_PHRASE_ANALYZER,
  PHRASE_ANALYZER_VERSION,
  PHRASE_RULES,
  PRODUCT_STATE_SCHEMA_VERSION,
  SAMPLE_TITLE,
  SAMPLE_TRANSCRIPT,
  analyzePhrases,
  clearAnnotations,
  clearProductState,
  createAnnotationThread,
  createLocalPhraseAnalyzer,
  createTextAnchor,
  deleteCaptionDocument,
  detectPhrases,
  editAnnotationComment,
  editAnnotationThread,
  exportStudyJson,
  exportStudyMarkdown,
  formatTranscriptForClipboard,
  listCaptionDocuments,
  loadAnnotationThreads,
  loadAnnotations,
  loadCaptionDocument,
  loadPhraseAnalysisCache,
  loadSavedPhrases,
  loadSettings,
  mergeCuesIntoSentences,
  migrateProductState,
  normalizeTextAnchor,
  parseTranscript,
  parseTranscriptDocument,
  reopenAnnotationThread,
  replyToAnnotationThread,
  resolveAnnotationThread,
  saveAnnotationThreads,
  saveAnnotations,
  saveCaptionDocument,
  savePhraseAnalysisCache,
  saveSavedPhrases,
  saveSettings,
  transitionCaptionFollowMode,
  validateStructuredPhraseCandidates,
} from "../src/lib/index.js";
import {
  CAPTION_FOLLOW_IDLE_MS,
  shouldResumeCaptionFollowAfterIdle,
} from "../src/lib/captionFollow.js";

test("parses SRT into normalized millisecond cues", () => {
  const cues = parseTranscript(SAMPLE_TRANSCRIPT);

  assert.equal(cues.length, 15);
  assert.equal(cues[0].startMs, 178_000);
  assert.equal(cues[0].endMs, 182_000);
  assert.match(cues[0].text, /over-the-top/);
  assert.equal(cues[0].format, "srt");
});

test("parses WebVTT identifiers, markup, and cue settings", () => {
  const cues = parseTranscript(`WEBVTT

NOTE generated caption

speaker-1
00:00:01.200 --> 00:00:03.400 align:start
<v Jane>Hello &amp; welcome.</v>
`);

  assert.deepEqual(
    cues.map(({ sourceId, startMs, endMs, text, format }) => ({
      sourceId,
      startMs,
      endMs,
      text,
      format,
    })),
    [
      {
        sourceId: "speaker-1",
        startMs: 1200,
        endMs: 3400,
        text: "Hello & welcome.",
        format: "vtt",
      },
    ],
  );
});

test("parses timestamped TXT and infers end times", () => {
  const cues = parseTranscript(`[02:58] First fragment,
[03:02] second fragment.
[03:05 --> 03:08] A ranged line.`);

  assert.equal(cues.length, 3);
  assert.deepEqual(
    cues.map(({ startMs, endMs }) => [startMs, endMs]),
    [
      [178_000, 182_000],
      [182_000, 185_000],
      [185_000, 188_000],
    ],
  );
});

test("merges cue fragments into semantic sentences with reversible part mappings", () => {
  const { cues, sentences } = parseTranscriptDocument(`1
00:00:00,000 --> 00:00:02,000
Earlier this year, I felt really burnt out,

2
00:00:02,000 --> 00:00:06,000
from sitting at my computer all day long. I needed a break.
`);

  assert.equal(sentences.length, 2);
  assert.equal(
    sentences[0].text,
    "Earlier this year, I felt really burnt out, from sitting at my computer all day long.",
  );
  assert.deepEqual(sentences[0].cueIds, ["segment-001", "segment-002"]);
  assert.equal(sentences[0].startMs, 0);
  assert.ok(sentences[0].endMs > 2000);
  assert.equal(sentences[1].text, "I needed a break.");
  assert.ok(sentences[1].startMs >= 2000);

  const cuesById = new Map(cues.map((cue) => [cue.id, cue]));
  for (const sentence of sentences) {
    for (const part of sentence.parts) {
      const cue = cuesById.get(part.cueId);
      assert.equal(
        sentence.text.slice(part.sentenceStart, part.sentenceEnd),
        cue.text.slice(part.sourceStart, part.sourceEnd),
      );
      assert.equal(part.cueSourceIndex, cue.sourceIndex);
      assert.ok(part.endMs >= part.startMs);
    }
    assert.equal(
      sentence.parts
        .map(
          (part) =>
            `${part.joinerBefore}${cuesById
              .get(part.cueId)
              .text.slice(part.sourceStart, part.sourceEnd)}`,
        )
        .join(""),
      sentence.text,
    );
  }
});

test("does not merge distant incomplete cues into one sentence", () => {
  const sentences = mergeCuesIntoSentences([
    { id: "a", text: "One unfinished thought", startMs: 0, endMs: 1000 },
    { id: "b", text: "A separate idea", startMs: 6000, endMs: 7000 },
  ]);

  assert.deepEqual(sentences.map((sentence) => sentence.text), [
    "One unfinished thought",
    "A separate idea",
  ]);
  assert.equal(sentences[0].isComplete, false);
});

test("splits oversized CJK cues into readable timed rows", () => {
  const text = "知道为什么丢球吗你看这一带就是初级水平大家很容易丢球你要保持一个节奏不要着急等球快掉的时候再救一下然后马上拍回来".repeat(3);
  const sentences = mergeCuesIntoSentences([
    { id: "long-cjk", text, startMs: 3000, endMs: 15000 },
  ]);

  assert.ok(sentences.length >= 3);
  assert.equal(sentences.map((sentence) => sentence.text).join(""), text);
  assert.ok(sentences.every((sentence) => sentence.text.length <= 42));
  assert.equal(sentences[0].startMs, 3000);
  assert.equal(sentences.at(-1).endMs, 15000);
  assert.ok(
    sentences.every(
      (sentence, index) =>
        index === 0 || sentence.startMs >= sentences[index - 1].endMs,
    ),
  );
});

test("caption follow state respects manual browsing and settled seeking", () => {
  assert.equal(
    transitionCaptionFollowMode(CAPTION_FOLLOW_MODE.FOLLOWING, {
      type: CAPTION_FOLLOW_EVENT.USER_SCROLL,
    }),
    CAPTION_FOLLOW_MODE.MANUAL,
  );
  assert.equal(
    transitionCaptionFollowMode(CAPTION_FOLLOW_MODE.MANUAL, {
      type: CAPTION_FOLLOW_EVENT.SEEK_START,
    }),
    CAPTION_FOLLOW_MODE.SEEKING,
  );
  assert.equal(
    transitionCaptionFollowMode(CAPTION_FOLLOW_MODE.SEEKING, {
      type: CAPTION_FOLLOW_EVENT.SEEK_SETTLED,
      userScrolled: false,
    }),
    CAPTION_FOLLOW_MODE.FOLLOWING,
  );
  assert.equal(
    transitionCaptionFollowMode(CAPTION_FOLLOW_MODE.SEEKING, {
      type: CAPTION_FOLLOW_EVENT.SEEK_SETTLED,
      userScrolled: true,
    }),
    CAPTION_FOLLOW_MODE.MANUAL,
  );
});

test("caption follow only resumes after a fully idle manual pause", () => {
  assert.equal(CAPTION_FOLLOW_IDLE_MS, 8_000);
  assert.equal(
    shouldResumeCaptionFollowAfterIdle({
      mode: CAPTION_FOLLOW_MODE.MANUAL,
    }),
    true,
  );
  for (const blocked of [
    { pointerInside: true },
    { focusBlocked: true },
    { interactionBlocked: true },
  ]) {
    assert.equal(
      shouldResumeCaptionFollowAfterIdle({
        mode: CAPTION_FOLLOW_MODE.MANUAL,
        ...blocked,
      }),
      false,
    );
  }
  assert.equal(
    shouldResumeCaptionFollowAfterIdle({
      mode: CAPTION_FOLLOW_MODE.SEEKING,
    }),
    false,
  );
  assert.equal(
    shouldResumeCaptionFollowAfterIdle({
      mode: CAPTION_FOLLOW_MODE.FOLLOWING,
    }),
    false,
  );
});

test("local phrase analyzer is expanded, deterministic, and candid about not being AI", () => {
  const sentences = mergeCuesIntoSentences(parseTranscript(SAMPLE_TRANSCRIPT));
  const phrases = detectPhrases(sentences);
  const exacts = phrases.map((phrase) => phrase.exact);

  for (const expected of [
    "over-the-top",
    "stood out to me",
    "rooted in reality",
    "a funny twist",
    "burnt out",
    "all day long",
    "inspired by",
    "alternative ending",
  ]) {
    assert.ok(exacts.includes(expected), `missing phrase: ${expected}`);
  }

  assert.equal(LOCAL_PHRASE_ANALYZER.isAi, false);
  assert.ok(PHRASE_RULES.length >= 20);
  for (const phrase of phrases) {
    const sentence = sentences.find((candidate) => candidate.id === phrase.sentenceId);
    assert.equal(sentence.text.slice(phrase.start, phrase.end), phrase.exact);
    assert.equal(phrase.range.start, phrase.start);
    assert.equal(phrase.analyzerType, "local");
    assert.equal(phrase.isAi, false);
    assert.ok(phrase.confidence >= 0 && phrase.confidence <= 1);
    assert.ok(phrase.reason.length > 0);
    assert.ok(["high", "medium", "low"].includes(phrase.priority));
    assert.ok(Number.isFinite(phrase.priorityScore));
    assert.ok(phrase.endMs >= phrase.startMs);
  }
});

test("local rules are extensible and async providers use the same boundary", async () => {
  const sentences = [
    {
      id: "sentence-custom",
      text: "Once you understand it, this is a piece of cake.",
      startMs: 0,
      endMs: 3000,
    },
  ];
  const local = createLocalPhraseAnalyzer({
    rules: [
      {
        id: "piece-of-cake",
        pattern: /piece of cake/i,
        phrase: "a piece of cake",
        glossZh: "小菜一碟",
        category: "idiom",
        difficulty: "B1",
        confidence: 0.97,
        reason: "固定习语",
        priority: "high",
        priorityScore: 90,
      },
    ],
  });
  assert.equal(local.analyze(sentences)[0].exact, "piece of cake");

  const report = await analyzePhrases(sentences, {
    provider: {
      id: "test-provider",
      type: "remote",
      label: "Test provider",
      isAi: true,
      requiresNetwork: true,
      async analyze() {
        return [{ id: "remote-result", exact: "understand it" }];
      },
    },
  });
  assert.equal(report.provider.id, "test-provider");
  assert.equal(report.provider.isAi, true);
  assert.deepEqual(report.candidates, [
    { id: "remote-result", exact: "understand it" },
  ]);
});

test("local lexicon normalizes inflected aliases to reusable canonical phrases", () => {
  const sentences = [{
    id: "sentence-variants",
    text: "We went through the evidence and finally figured out what led to the change.",
    startMs: 0,
    endMs: 5000,
  }];
  const phrases = detectPhrases(sentences);
  const byExact = new Map(phrases.map((phrase) => [phrase.exact, phrase]));

  assert.equal(byExact.get("went through")?.canonical, "go through");
  assert.equal(byExact.get("figured out")?.canonical, "figure out");
  assert.equal(byExact.get("led to")?.canonical, "lead to");
  for (const phrase of phrases) {
    assert.equal(
      sentences[0].text.slice(phrase.start, phrase.end),
      phrase.exact,
    );
  }
});

test("phrase analysis cache is scoped by transcript and analyzer version", async () => {
  const document = {
    id: "cache-document",
    sentences: [{ id: "cache-sentence", text: "We figured out the answer." }],
  };
  const candidates = detectPhrases(document.sentences);
  await savePhraseAnalysisCache(document, PHRASE_ANALYZER_VERSION, candidates);

  const cached = await loadPhraseAnalysisCache(document, PHRASE_ANALYZER_VERSION);
  assert.deepEqual(cached.candidates, candidates);
  assert.equal(
    await loadPhraseAnalysisCache(
      { ...document, sentences: [{ ...document.sentences[0], text: "Changed." }] },
      PHRASE_ANALYZER_VERSION,
    ),
    null,
  );
  assert.equal(await loadPhraseAnalysisCache(document, "different-version"), null);
});

test("structured phrase candidates must map back to exact subtitle characters", () => {
  const sentences = [{
    id: "strict-sentence",
    text: "When it comes to memory, context makes a difference.",
    startMs: 1000,
    endMs: 5000,
  }];
  const valid = validateStructuredPhraseCandidates(sentences, [{
    sentenceId: "strict-sentence",
    exact: "makes a difference",
    start: 0,
    end: 1,
    canonical: "make a difference",
    glossZh: "产生影响",
    difficulty: "B1",
    reusability: 0.9,
    worthLearning: true,
  }]);
  assert.equal(valid.length, 1);
  assert.equal(
    sentences[0].text.slice(valid[0].start, valid[0].end),
    "makes a difference",
  );
  assert.deepEqual(
    validateStructuredPhraseCandidates(sentences, [{
      sentenceId: "strict-sentence",
      exact: "hallucinated phrase",
      start: 0,
      end: 19,
      worthLearning: true,
    }]),
    [],
  );
});

test("quote anchors disambiguate repeated text and retain text/time selectors", () => {
  const sentence = {
    id: "sentence-repeat",
    text: "We learn what matters, then learn what matters deeply.",
    startMs: 10_000,
    endMs: 15_000,
  };
  const secondStart = sentence.text.lastIndexOf("learn what matters");
  const anchor = createTextAnchor({
    sentence,
    exact: "learn what matters",
    start: secondStart,
    end: secondStart + "learn what matters".length,
  });

  assert.equal(anchor.exact, "learn what matters");
  assert.equal(anchor.start, secondStart);
  assert.equal(anchor.prefix.endsWith(", then "), true);
  assert.equal(anchor.suffix, " deeply.");
  assert.ok(anchor.time.startMs > sentence.startMs);

  const restored = normalizeTextAnchor(
    {
      exact: anchor.exact,
      prefix: ", then ",
      suffix: " deeply.",
      sentenceId: sentence.id,
    },
    sentence,
  );
  assert.equal(restored.start, secondStart);
});

test("annotation threads support edit, reply, resolve, and reopen immutably", () => {
  const stamp1 = "2026-07-30T00:00:00.000Z";
  const thread = createAnnotationThread(
    {
      id: "thread-1",
      kind: "question",
      sentenceId: "sentence-1",
      exact: "rooted in reality",
      start: 5,
      end: 22,
      body: "What nuance does this have?",
    },
    { commentId: "comment-1", now: stamp1 },
  );
  assert.equal(thread.anchor.exact, "rooted in reality");
  assert.equal(thread.comments[0].body, "What nuance does this have?");

  const edited = editAnnotationComment(
    [thread],
    "thread-1",
    "comment-1",
    "How is this different from grounded?",
    { now: "2026-07-30T00:01:00.000Z" },
  );
  assert.equal(thread.comments[0].body, "What nuance does this have?");
  assert.equal(edited[0].comments[0].body, "How is this different from grounded?");

  const editedThread = editAnnotationThread(
    edited,
    "thread-1",
    { kind: "note", tags: ["comparison"], body: "Keep both examples." },
    { now: "2026-07-30T00:01:30.000Z" },
  );
  assert.equal(editedThread[0].kind, "note");
  assert.deepEqual(editedThread[0].tags, ["comparison"]);
  assert.equal(editedThread[0].comments[0].body, "Keep both examples.");

  const replied = replyToAnnotationThread(
    editedThread,
    "thread-1",
    "Grounded sounds slightly more direct.",
    {
      id: "comment-2",
      parentId: "comment-1",
      now: "2026-07-30T00:02:00.000Z",
    },
  );
  assert.equal(replied[0].comments.length, 2);
  assert.equal(replied[0].comments[1].parentId, "comment-1");

  const resolved = resolveAnnotationThread(replied, "thread-1", {
    now: "2026-07-30T00:03:00.000Z",
  });
  assert.equal(resolved[0].status, "resolved");
  assert.ok(resolved[0].resolvedAt);

  const reopened = reopenAnnotationThread(resolved, "thread-1", {
    now: "2026-07-30T00:04:00.000Z",
  });
  assert.equal(reopened[0].status, "open");
  assert.equal("resolvedAt" in reopened[0], false);
});

test("migrates v1 flat product data into schema-versioned threads and phrases", () => {
  const migrated = migrateProductState({
    schemaVersion: 1,
    documents: [{ id: "doc-old", title: "Old transcript" }],
    annotationsByDocument: {
      "doc-old": [
        {
          id: "ann-old",
          kind: "note",
          sentenceId: "sentence-1",
          exact: "hello",
          body: "remember this",
        },
        {
          id: "phrase-old",
          kind: "phrase",
          phraseId: "candidate-1",
          sentenceId: "sentence-1",
          exact: "stand out",
          body: "脱颖而出",
        },
      ],
    },
    settings: { density: "compact" },
  });

  assert.equal(migrated.schemaVersion, PRODUCT_STATE_SCHEMA_VERSION);
  assert.equal(migrated.documents["doc-old"].title, "Old transcript");
  assert.equal(migrated.documents["doc-old"].schemaVersion, 1);
  assert.equal(migrated.annotationThreadsByDocument["doc-old"].length, 1);
  assert.equal(
    migrated.annotationThreadsByDocument["doc-old"][0].comments[0].body,
    "remember this",
  );
  assert.equal(migrated.savedPhrasesByDocument["doc-old"][0].id, "candidate-1");
  assert.equal(migrated.settings.density, "compact");
  assert.equal(migrated.settings.autoAnalyzePhrases, true);
});

test("persists documents, threads, settings, and saved phrases with compatibility facades", async () => {
  await clearProductState();
  const documentId = "doc-storage";
  const document = await saveCaptionDocument(
    {
      id: documentId,
      title: "A persisted talk",
      language: "en",
      sentences: [{ id: "s1", text: "It turns out well.", startMs: 0, endMs: 1000 }],
    },
    { now: "2026-07-30T01:00:00.000Z" },
  );
  assert.equal(document.schemaVersion, 1);
  assert.equal((await loadCaptionDocument(documentId)).title, "A persisted talk");
  assert.deepEqual(
    (await listCaptionDocuments()).map((item) => item.id),
    [documentId],
  );

  const thread = createAnnotationThread(
    {
      id: "thread-storage",
      sentenceId: "s1",
      exact: "turns out",
      start: 3,
      end: 12,
      body: "Useful transition",
    },
    { documentId, commentId: "comment-storage", now: "2026-07-30T01:01:00.000Z" },
  );
  await saveAnnotationThreads([thread], documentId);
  await saveSavedPhrases(
    [
      {
        id: "candidate-storage",
        sentenceId: "s1",
        exact: "turns out",
        glossZh: "结果发现",
      },
    ],
    documentId,
  );
  await saveSettings({
    density: "compact",
    includeAllCandidatesOnExport: true,
    showPhrases: false,
    theme: "dark",
  });

  assert.equal((await loadAnnotationThreads(documentId))[0].comments.length, 1);
  assert.equal((await loadSavedPhrases(documentId))[0].exact, "turns out");
  assert.equal((await loadSettings()).density, "compact");
  assert.equal((await loadSettings()).theme, "dark");
  assert.equal((await loadSettings()).showPhrases, false);

  const compatible = await loadAnnotations(documentId);
  assert.ok(compatible.some((item) => item.kind === "note"));
  assert.ok(compatible.some((item) => item.kind === "phrase"));
  await saveAnnotations(compatible, documentId);
  assert.equal((await loadAnnotationThreads(documentId))[0].anchor.exact, "turns out");

  await clearAnnotations(documentId);
  assert.deepEqual(await loadAnnotations(documentId), []);
  await deleteCaptionDocument(documentId);
  assert.equal(await loadCaptionDocument(documentId), null);
});

test("exports only saved learning content by default and can include every candidate", () => {
  const segments = parseTranscript(SAMPLE_TRANSCRIPT);
  const sentences = mergeCuesIntoSentences(segments);
  const phrases = detectPhrases(sentences);
  const targetSentence = sentences.find((sentence) =>
    sentence.text.includes("rooted in reality"),
  );
  const savedPhrase = phrases.find((phrase) => phrase.exact === "rooted in reality");
  const start = targetSentence.text.indexOf("rooted in reality");
  const annotations = [
    {
      id: "saved-phrase",
      kind: "phrase",
      phraseId: savedPhrase.id,
      sentenceId: targetSentence.id,
      exact: savedPhrase.exact,
      body: savedPhrase.glossZh,
      learning: savedPhrase,
      createdAt: "2026-07-30T02:00:00.000Z",
    },
    {
      id: "ann-1",
      kind: "question",
      sentenceId: targetSentence.id,
      start,
      end: start + "rooted in reality".length,
      selectedText: "rooted in reality",
      prefix: targetSentence.text.slice(Math.max(0, start - 12), start),
      suffix: targetSentence.text.slice(start + 17, start + 29),
      comment: "可以和 grounded in reality 对比吗？",
      comments: [
        {
          id: "comment-1",
          parentId: null,
          body: "可以和 grounded in reality 对比吗？",
        },
        {
          id: "comment-2",
          parentId: "comment-1",
          body: "请给两个例句。",
        },
      ],
    },
  ];
  const document = {
    title: SAMPLE_TITLE,
    sourceUrl: "https://example.test/talk",
    language: "en",
    source: {
      provider: "youtube-page-manifest",
      canonicalUrl: "https://example.test/talk",
      mediaId: "abcdefghijk",
    },
    caption: {
      selectedTrackId: "page-manifest-youtube-en",
      capturedAt: "2026-07-30T02:00:00.000Z",
      tracks: [
        {
          id: "page-manifest-youtube-en",
          baseUrl: "https://www.youtube.com/api/timedtext?secret=never-export",
        },
      ],
    },
    segments,
    sentences,
    phrases,
  };

  const json = JSON.parse(exportStudyJson(document, annotations));
  assert.equal(json.schemaVersion, "2.0");
  assert.equal(json.document.title, SAMPLE_TITLE);
  assert.equal(json.document.source.provider, "youtube-page-manifest");
  assert.equal(json.document.source.mediaId, "abcdefghijk");
  assert.equal(
    json.document.caption.selectedTrackId,
    "page-manifest-youtube-en",
  );
  assert.doesNotMatch(JSON.stringify(json), /never-export|baseUrl/);
  assert.match(json.document.transcriptHash, /^fnv1a:/);
  assert.equal(json.phrases.length, 1);
  assert.equal(json.phrases[0].exact, "rooted in reality");
  assert.equal(json.annotations.length, 1);
  assert.equal(json.annotations[0].anchor.exact, "rooted in reality");
  assert.equal(json.annotations[0].comments.length, 2);
  assert.deepEqual(
    json.document.sentences.map((sentence) => sentence.id),
    [targetSentence.id],
  );

  const markdown = exportStudyMarkdown(document, annotations);
  assert.match(markdown, new RegExp(`# ${SAMPLE_TITLE}`));
  assert.match(markdown, /### 03:07/);
  assert.match(markdown, /\*\*rooted in reality\*\* — 植根于现实/);
  assert.match(markdown, /grounded in reality 对比吗/);
  assert.match(markdown, /回复：请给两个例句/);
  assert.match(markdown, /字幕来源：YouTube 页面字幕清单/);
  assert.doesNotMatch(markdown, /\*\*over-the-top\*\*/);

  const allCandidates = JSON.parse(
    exportStudyJson(document, annotations, { includeAllCandidates: true }),
  );
  assert.ok(allCandidates.phrases.length > json.phrases.length);
  assert.ok(
    allCandidates.phrases.some((phrase) => phrase.exact === "over-the-top"),
  );
});

test("formats the complete timestamped transcript for clipboard copy", () => {
  const text = formatTranscriptForClipboard({
    title: "A useful talk",
    sentences: [
      { id: "one", startMs: 0, text: "First sentence." },
      { id: "two", startMs: 65_000, text: "Second sentence." },
      { id: "empty", startMs: 70_000, text: "  " },
    ],
  });

  assert.equal(
    text,
    "A useful talk\n\n00:00 First sentence.\n01:05 Second sentence.",
  );
  assert.equal(formatTranscriptForClipboard({ title: "Empty" }), "");
});

test("stores annotations independently for each transcript", async () => {
  await clearAnnotations("doc-a");
  await clearAnnotations("doc-b");
  await saveAnnotations([{ id: "a", exact: "alpha", body: "A" }], "doc-a");
  await saveAnnotations([{ id: "b", exact: "beta", body: "B" }], "doc-b");

  assert.equal((await loadAnnotations("doc-a"))[0].exact, "alpha");
  assert.equal((await loadAnnotations("doc-b"))[0].exact, "beta");
});
