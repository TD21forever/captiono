import {
  CORE_PHRASE_INDEX,
  CORE_PHRASE_LEXICON,
  matchPhraseLexicon,
  PHRASE_LEXICON_VERSION,
} from "./phraseLexicon.js";

export const PHRASE_ANALYZER_VERSION = `local-lexicon-${PHRASE_LEXICON_VERSION}`;

const BASE_RULE_FIELDS = {
  confidence: 0.9,
  priority: "medium",
  priorityScore: 60,
};

/**
 * Curated, locally executed rules. This is deliberately labelled as a rule
 * engine rather than AI: it is deterministic, offline, inspectable, and safe
 * to extend without credentials.
 */
const PHRASE_RULES = [
  {
    id: "over-the-top",
    pattern: /\bover[-‑–— ]the[-‑–— ]top\b/gi,
    phrase: "over-the-top",
    glossZh: "夸张的；过火的",
    category: "idiomatic adjective",
    difficulty: "B2",
    reason: "常见的口语化复合形容词，不能只按单词逐个直译。",
    priority: "high",
    priorityScore: 90,
    confidence: 0.99,
  },
  {
    id: "stand-out",
    pattern: /\b(?:stand|stands|standing|stood) out(?: to (?:me|you|us|them|him|her))?\b/gi,
    phrase: "stand out (to someone)",
    glossZh: "脱颖而出；格外引人注意",
    category: "phrasal verb",
    difficulty: "B2",
    reason: "高频短语动词，含义不是 stand 与 out 的简单相加。",
    priority: "high",
    priorityScore: 92,
    confidence: 0.98,
  },
  {
    id: "rooted-in-reality",
    pattern: /\brooted in reality\b/gi,
    phrase: "be rooted in reality",
    glossZh: "植根于现实；以现实为基础",
    category: "collocation",
    difficulty: "B2",
    reason: "rooted in 是演讲与议论文中常见的抽象搭配。",
    priority: "high",
    priorityScore: 88,
    confidence: 0.97,
  },
  {
    id: "a-funny-twist",
    pattern: /\ba (?:funny|surprising|unexpected|clever) twist\b/gi,
    phrase: "a surprising twist",
    glossZh: "一个出人意料的转折",
    category: "collocation",
    difficulty: "B1",
    reason: "适合复述故事结构的名词搭配。",
    confidence: 0.94,
    priorityScore: 66,
  },
  {
    id: "burnt-out",
    pattern: /\bburn(?:t|ed) out\b/gi,
    phrase: "be burnt out",
    glossZh: "精疲力竭；倦怠",
    category: "idiomatic adjective",
    difficulty: "B2",
    reason: "描述长期压力导致的身心倦怠，语义强于 tired。",
    priority: "high",
    priorityScore: 94,
    confidence: 0.99,
  },
  {
    id: "all-day-long",
    pattern: /\ball (?:day|night|week|year) long\b/gi,
    phrase: "all day long",
    glossZh: "整整一天；从早到晚",
    category: "time expression",
    difficulty: "A2",
    reason: "自然的持续时间表达，适合整体记忆。",
    confidence: 0.99,
    priority: "low",
    priorityScore: 42,
  },
  {
    id: "inspired-by",
    pattern: /\b(?:be |am |is |are |was |were |being |been )?inspired by\b/gi,
    phrase: "be inspired by",
    glossZh: "受到……启发",
    category: "collocation",
    difficulty: "B1",
    reason: "介绍灵感来源时的高频被动搭配。",
    confidence: 0.98,
    priorityScore: 65,
  },
  {
    id: "alternative-ending",
    pattern: /\balternative (?:ending|approach|explanation|solution)\b/gi,
    phrase: "an alternative …",
    glossZh: "另一种结局、方法、解释或方案",
    category: "collocation",
    difficulty: "B1",
    reason: "alternative 与抽象名词构成高复用表达。",
    confidence: 0.96,
    priorityScore: 58,
  },
  {
    id: "it-turns-out",
    pattern: /\bit (?:turns|turned) out(?: that)?\b/gi,
    phrase: "it turns out (that)",
    glossZh: "结果发现；原来",
    category: "discourse marker",
    difficulty: "B1",
    reason: "演讲中用于引出反转或新发现的高频话语标记。",
    priority: "high",
    priorityScore: 94,
    confidence: 0.99,
  },
  {
    id: "the-point-is",
    pattern: /\bthe point is(?: that)?\b/gi,
    phrase: "the point is (that)",
    glossZh: "关键在于；重点是",
    category: "discourse marker",
    difficulty: "B1",
    reason: "用于聚焦核心论点的演讲组织表达。",
    priority: "high",
    priorityScore: 91,
    confidence: 0.99,
  },
  {
    id: "in-other-words",
    pattern: /\bin other words\b/gi,
    phrase: "in other words",
    glossZh: "换句话说",
    category: "discourse marker",
    difficulty: "B1",
    reason: "用于重述和澄清复杂观点。",
    priority: "high",
    priorityScore: 84,
    confidence: 0.99,
  },
  {
    id: "as-a-result",
    pattern: /\bas a result(?: of)?\b/gi,
    phrase: "as a result (of)",
    glossZh: "因此；由于……的结果",
    category: "discourse marker",
    difficulty: "B1",
    reason: "明确表达因果关系的连接语。",
    confidence: 0.99,
    priorityScore: 64,
  },
  {
    id: "come-up-with",
    pattern: /\b(?:come|comes|coming|came) up with\b/gi,
    phrase: "come up with",
    glossZh: "想出；提出",
    category: "phrasal verb",
    difficulty: "B1",
    reason: "描述提出想法或方案的高频短语动词。",
    priority: "high",
    priorityScore: 87,
    confidence: 0.98,
  },
  {
    id: "make-a-difference",
    pattern: /\b(?:make|makes|making|made) a (?:real |big )?difference\b/gi,
    phrase: "make a difference",
    glossZh: "产生影响；带来改变",
    category: "collocation",
    difficulty: "B1",
    reason: "TED 演讲中常见的影响力表达。",
    priority: "high",
    priorityScore: 86,
    confidence: 0.97,
  },
  {
    id: "take-for-granted",
    pattern: /\b(?:take|takes|taken|taking|took) .{0,32}? for granted\b/gi,
    phrase: "take … for granted",
    glossZh: "把……视为理所当然",
    category: "idiom",
    difficulty: "B2",
    reason: "固定结构，中间宾语会变化，值得整块掌握。",
    priority: "high",
    priorityScore: 96,
    confidence: 0.93,
  },
  {
    id: "in-terms-of",
    pattern: /\bin terms of\b/gi,
    phrase: "in terms of",
    glossZh: "就……而言；从……方面看",
    category: "prepositional phrase",
    difficulty: "B2",
    reason: "用于限定讨论维度的学术与演讲表达。",
    confidence: 0.99,
    priorityScore: 69,
  },
  {
    id: "rather-than",
    pattern: /\brather than\b/gi,
    phrase: "rather than",
    glossZh: "而不是；与其……不如……",
    category: "contrast structure",
    difficulty: "B1",
    reason: "表达选择和对比的高复用结构。",
    confidence: 0.99,
    priorityScore: 61,
  },
  {
    id: "be-likely-to",
    pattern: /\b(?:am|is|are|was|were|be|been) (?:more |less |very )?likely to\b/gi,
    phrase: "be likely to",
    glossZh: "很可能……",
    category: "grammar chunk",
    difficulty: "B1",
    reason: "表达概率判断的常用语块。",
    confidence: 0.98,
    priorityScore: 62,
  },
  {
    id: "used-to",
    pattern: /\bused to (?:be|have|think|believe|feel|do|go|live|work|say|see|know|make)\b/gi,
    phrase: "used to do",
    glossZh: "过去常常；曾经",
    category: "grammar chunk",
    difficulty: "B1",
    reason: "描述过去状态或习惯的固定结构。",
    confidence: 0.96,
    priorityScore: 55,
  },
  {
    id: "supposed-to",
    pattern: /\b(?:am|is|are|was|were|be) supposed to\b/gi,
    phrase: "be supposed to",
    glossZh: "应该；按理说；被要求",
    category: "grammar chunk",
    difficulty: "B1",
    reason: "根据语境可表达预期、义务或安排。",
    confidence: 0.98,
    priorityScore: 68,
  },
  {
    id: "from-scratch",
    pattern: /\bfrom scratch\b/gi,
    phrase: "from scratch",
    glossZh: "从零开始",
    category: "idiom",
    difficulty: "B1",
    reason: "描述不依赖现成基础、从头创建。",
    confidence: 0.99,
    priority: "high",
    priorityScore: 82,
  },
  {
    id: "at-the-end-of-the-day",
    pattern: /\bat the end of the day\b/gi,
    phrase: "at the end of the day",
    glossZh: "归根结底；最终",
    category: "discourse marker",
    difficulty: "B2",
    reason: "口语中用于总结最终判断，不一定指一天结束。",
    priority: "high",
    priorityScore: 88,
    confidence: 0.98,
  },
  {
    id: "for-the-first-time",
    pattern: /\bfor the first time\b/gi,
    phrase: "for the first time",
    glossZh: "第一次",
    category: "time expression",
    difficulty: "A2",
    reason: "叙事中常用于标记新的体验或转折。",
    confidence: 0.99,
    priority: "low",
    priorityScore: 38,
  },
  {
    id: "what-if",
    pattern: /\bwhat if\b/gi,
    phrase: "what if …?",
    glossZh: "如果……会怎样；要是……怎么办",
    category: "hypothetical frame",
    difficulty: "B1",
    reason: "用于提出假设、风险或想象空间。",
    confidence: 0.99,
    priorityScore: 70,
  },
  {
    id: "not-only-but-also",
    pattern: /\bnot only\b.{0,80}?\bbut also\b/gi,
    phrase: "not only … but also …",
    glossZh: "不仅……而且……",
    category: "parallel structure",
    difficulty: "B2",
    reason: "强调递进关系的平行结构。",
    confidence: 0.94,
    priorityScore: 71,
  },
  {
    id: "one-of-the-most",
    pattern: /\bone of the most\b/gi,
    phrase: "one of the most …",
    glossZh: "最……的……之一",
    category: "grammar chunk",
    difficulty: "B1",
    reason: "高频最高级结构，注意后接复数名词。",
    confidence: 0.99,
    priority: "low",
    priorityScore: 45,
  },
].map((rule) => ({ ...BASE_RULE_FIELDS, ...rule }));

function timeAtOffset(sentence, offset, preferEnd = false) {
  const parts = Array.isArray(sentence.parts) ? sentence.parts : [];
  for (const part of parts) {
    const partStart = part.sentenceStart ?? part.start;
    const partEnd = part.sentenceEnd ?? part.end;
    if (offset >= partStart && offset <= partEnd) {
      const width = Math.max(1, partEnd - partStart);
      const progress = Math.max(0, Math.min(1, (offset - partStart) / width));
      return Math.round(part.startMs + (part.endMs - part.startMs) * progress);
    }
  }

  if (parts.length > 0) {
    const firstStart = parts[0].sentenceStart ?? parts[0].start;
    if (offset < firstStart) return parts[0].startMs;
    return parts.at(-1).endMs;
  }

  const duration = Math.max(1, sentence.endMs - sentence.startMs);
  const progress = Math.max(0, Math.min(1, offset / Math.max(1, sentence.text.length)));
  const value = sentence.startMs + duration * progress;
  return preferEnd ? Math.ceil(value) : Math.floor(value);
}

function normalizeSentences(input) {
  const source = Array.isArray(input) ? input : input?.sentences;
  return Array.isArray(source) ? source : [];
}

function feedbackScoreFor(entry, feedback) {
  if (!feedback || typeof feedback !== "object") return 0;
  const value = feedback[entry.id] ?? feedback[entry.canonical] ?? null;
  if (Number.isFinite(value)) return value;
  return Number.isFinite(value?.score) ? value.score : 0;
}

function scorePriority(baseScore, feedbackScore = 0) {
  return Math.max(0, Math.min(100, Math.round(baseScore + feedbackScore)));
}

function priorityFromScore(score, fallback = "medium") {
  if (score >= 80) return "high";
  if (score < 50) return "low";
  return fallback === "high" || fallback === "low" ? fallback : "medium";
}

function detectWithLexicon(
  sentences,
  index,
  { minConfidence = 0, priorities, feedback } = {},
) {
  const source = normalizeSentences(sentences);
  const allowedPriorities =
    Array.isArray(priorities) && priorities.length > 0 ? new Set(priorities) : null;
  const results = [];

  source.forEach((sentence, sentenceIndex) => {
    const text = String(sentence?.text ?? "");
    const sentenceId =
      sentence.id || `sentence-${String(sentenceIndex + 1).padStart(3, "0")}`;
    for (const match of matchPhraseLexicon(text, index)) {
      const entry = match.entry;
      if ((entry.confidence ?? 0) < minConfidence) continue;
      const priorityScore = scorePriority(
        entry.priorityScore ?? 60,
        feedbackScoreFor(entry, feedback),
      );
      const priority = priorityFromScore(priorityScore, entry.priority);
      if (allowedPriorities && !allowedPriorities.has(priority)) continue;
      results.push({
        id: `phrase-${sentenceId}-lexicon-${entry.id}-${match.start}`,
        ruleId: entry.id,
        lexiconId: entry.id,
        canonical: entry.canonical,
        matchedAlias: match.alias,
        analyzerId: PHRASE_ANALYZER_VERSION,
        analyzerVersion: PHRASE_ANALYZER_VERSION,
        analyzerType: "local",
        isAi: false,
        sentenceId,
        sentenceIndex,
        phrase: entry.canonical,
        exact: match.exact,
        start: match.start,
        end: match.end,
        range: { start: match.start, end: match.end },
        glossZh: entry.glossZh,
        translationZh: entry.glossZh,
        category: entry.category,
        type: entry.category,
        difficulty: entry.difficulty,
        confidence: entry.confidence,
        reason: `本地词库命中 ${entry.canonical} 的可检查变体。`,
        priority,
        priorityScore,
        reusability: entry.reusability,
        source: entry.source,
        lexiconVersion: PHRASE_LEXICON_VERSION,
        startMs: timeAtOffset(sentence, match.start),
        endMs: timeAtOffset(sentence, match.end, true),
      });
    }
  });
  return results;
}

function mergePhraseCandidates(candidates) {
  const bySentence = new Map();
  for (const candidate of candidates) {
    const bucket = bySentence.get(candidate.sentenceId) ?? [];
    bucket.push(candidate);
    bySentence.set(candidate.sentenceId, bucket);
  }

  const accepted = [];
  for (const bucket of bySentence.values()) {
    const chosen = [];
    for (const candidate of bucket.sort(
      (left, right) =>
        (right.priorityScore ?? 0) - (left.priorityScore ?? 0) ||
        right.end - right.start - (left.end - left.start) ||
        left.start - right.start,
    )) {
      if (
        chosen.some(
          (item) => candidate.start < item.end && candidate.end > item.start,
        )
      ) {
        continue;
      }
      chosen.push(candidate);
    }
    accepted.push(...chosen);
  }
  return accepted.sort(
    (left, right) =>
      (left.sentenceIndex ?? 0) - (right.sentenceIndex ?? 0) ||
      left.start - right.start,
  );
}

function detectWithRules(sentences, rules, { minConfidence = 0, priorities } = {}) {
  const source = normalizeSentences(sentences);
  const allowedPriorities =
    Array.isArray(priorities) && priorities.length > 0 ? new Set(priorities) : null;
  const results = [];

  source.forEach((sentence, sentenceIndex) => {
    const text = String(sentence?.text ?? "");
    const matches = [];

    for (const rule of rules) {
      if ((rule.confidence ?? 0) < minConfidence) continue;
      if (allowedPriorities && !allowedPriorities.has(rule.priority)) continue;
      const regexp = new RegExp(
        rule.pattern.source,
        rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`,
      );
      let match;
      while ((match = regexp.exec(text))) {
        const start = match.index;
        const end = start + match[0].length;
        matches.push({ rule, start, end, exact: text.slice(start, end) });
        if (match[0].length === 0) regexp.lastIndex += 1;
      }
    }

    const accepted = [];
    for (const candidate of matches.sort(
      (a, b) =>
        a.start - b.start ||
        b.rule.priorityScore - a.rule.priorityScore ||
        b.end - b.start - (a.end - a.start),
    )) {
      if (
        accepted.some(
          (item) => candidate.start < item.end && candidate.end > item.start,
        )
      ) {
        continue;
      }
      accepted.push(candidate);
    }

    accepted
      .sort((a, b) => a.start - b.start)
      .forEach(({ rule, start, end, exact }) => {
        const sentenceId =
          sentence.id || `sentence-${String(sentenceIndex + 1).padStart(3, "0")}`;
        results.push({
          id: `phrase-${sentenceId}-${rule.id}-${start}`,
          ruleId: rule.id,
          analyzerId: "local-rules-v2",
          analyzerType: "local",
          isAi: false,
          sentenceId,
          sentenceIndex,
          phrase: rule.phrase,
          exact,
          start,
          end,
          range: { start, end },
          glossZh: rule.glossZh,
          translationZh: rule.glossZh,
          category: rule.category,
          type: rule.category,
          difficulty: rule.difficulty,
          confidence: rule.confidence,
          reason: rule.reason,
          priority: rule.priority,
          priorityScore: rule.priorityScore,
          startMs: timeAtOffset(sentence, start),
          endMs: timeAtOffset(sentence, end, true),
        });
      });
  });

  return results;
}

export { PHRASE_RULES };

export function createLocalPhraseAnalyzer({
  rules = PHRASE_RULES,
  lexiconIndex = CORE_PHRASE_INDEX,
} = {}) {
  const normalizedRules = rules
    .filter((rule) => rule?.id && rule.pattern instanceof RegExp)
    .map((rule) => ({
      ...BASE_RULE_FIELDS,
      reason: "命中可检查的本地短语规则。",
      ...rule,
    }));
  return Object.freeze({
    id: PHRASE_ANALYZER_VERSION,
    version: PHRASE_ANALYZER_VERSION,
    type: "local",
    label: "本地词库分析",
    isAi: false,
    requiresNetwork: false,
    analyze(sentences, options = {}) {
      const ruleCandidates = detectWithRules(sentences, normalizedRules, options).map(
        (candidate) => ({
          ...candidate,
          analyzerId: PHRASE_ANALYZER_VERSION,
          analyzerVersion: PHRASE_ANALYZER_VERSION,
          source: "seed-curation",
          lexiconVersion: PHRASE_LEXICON_VERSION,
        }),
      );
      const lexiconCandidates = lexiconIndex
        ? detectWithLexicon(sentences, lexiconIndex, options)
        : [];
      return mergePhraseCandidates([...ruleCandidates, ...lexiconCandidates]);
    },
  });
}

export const LOCAL_PHRASE_ANALYZER = createLocalPhraseAnalyzer();

/**
 * Backward-compatible synchronous detector used by the current UI.
 */
export function detectPhrases(sentences, options) {
  return LOCAL_PHRASE_ANALYZER.analyze(sentences, options);
}

/**
 * Provider-ready async entrypoint. A future cloud provider only needs public
 * metadata plus `analyze(sentences, options)`; credentials stay outside this
 * module and are never embedded in the extension bundle by this interface.
 */
export async function analyzePhrases(
  sentences,
  { provider = LOCAL_PHRASE_ANALYZER, ...options } = {},
) {
  if (!provider || typeof provider.analyze !== "function") {
    throw new TypeError("Phrase analysis provider must implement analyze(sentences, options)");
  }
  const candidates = await provider.analyze(normalizeSentences(sentences), options);
  if (!Array.isArray(candidates)) {
    throw new TypeError("Phrase analysis provider must return an array");
  }
  return {
    provider: {
      id: provider.id || "custom-provider",
      type: provider.type || "external",
      label: provider.label || provider.id || "Custom provider",
      isAi: provider.isAi === true,
      requiresNetwork: provider.requiresNetwork === true,
    },
    candidates,
  };
}

export const STRUCTURED_PHRASE_RESULT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "sentenceId",
          "exact",
          "start",
          "end",
          "canonical",
          "glossZh",
          "difficulty",
          "reusability",
          "worthLearning",
        ],
        properties: {
          sentenceId: { type: "string" },
          exact: { type: "string" },
          start: { type: "integer", minimum: 0 },
          end: { type: "integer", minimum: 1 },
          canonical: { type: "string" },
          glossZh: { type: "string" },
          difficulty: { enum: ["A1", "A2", "B1", "B2", "C1", "C2"] },
          reusability: { type: "number", minimum: 0, maximum: 1 },
          worthLearning: { type: "boolean" },
        },
      },
    },
  },
});

export function validateStructuredPhraseCandidates(sentences, candidates) {
  const source = normalizeSentences(sentences);
  const byId = new Map(source.map((sentence) => [sentence.id, sentence]));
  return (Array.isArray(candidates) ? candidates : []).flatMap((candidate, index) => {
    const sentence = byId.get(candidate?.sentenceId);
    const exact = String(candidate?.exact ?? "");
    let start = Number(candidate?.start);
    let end = Number(candidate?.end);
    if (!sentence || !exact || candidate?.worthLearning === false) return [];

    const text = String(sentence.text ?? "");
    if (!Number.isInteger(start) || !Number.isInteger(end) || text.slice(start, end) !== exact) {
      const first = text.indexOf(exact);
      if (first < 0 || first !== text.lastIndexOf(exact)) return [];
      start = first;
      end = first + exact.length;
    }
    if (start < 0 || end <= start || text.slice(start, end) !== exact) return [];

    const priorityScore = scorePriority(
      54 + Number(candidate.reusability ?? 0.5) * 30 +
        (["B2", "C1"].includes(candidate.difficulty) ? 8 : 0),
    );
    return [{
      ...candidate,
      id: candidate.id || `phrase-${sentence.id}-structured-${start}-${index}`,
      analyzerType: "structured-provider",
      isAi: true,
      sentenceIndex: source.indexOf(sentence),
      start,
      end,
      range: { start, end },
      exact,
      phrase: candidate.canonical || exact,
      translationZh: candidate.glossZh,
      priorityScore,
      priority: priorityFromScore(priorityScore),
      confidence: Number(candidate.confidence ?? 0.85),
      reason: candidate.reason || "结构化模型结合字幕上下文补充的学习表达。",
      startMs: timeAtOffset(sentence, start),
      endMs: timeAtOffset(sentence, end, true),
    }];
  });
}

/**
 * Creates a provider for a product-owned backend endpoint. API credentials stay
 * on that backend; the browser extension only sends subtitle text and receives
 * schema-constrained candidates which are validated again locally.
 */
export function createStructuredPhraseProvider({ endpoint, fetchImpl = fetch } = {}) {
  if (!endpoint) throw new TypeError("Structured phrase provider requires an endpoint");
  return Object.freeze({
    id: "structured-context-v1",
    type: "remote",
    label: "上下文短语补充",
    isAi: true,
    requiresNetwork: true,
    async analyze(sentences, options = {}) {
      const source = normalizeSentences(sentences);
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          analyzerVersion: PHRASE_ANALYZER_VERSION,
          schema: STRUCTURED_PHRASE_RESULT_SCHEMA,
          sentences: source.map(({ id, text }) => ({ id, text })),
          language: options.language || "en",
        }),
      });
      if (!response.ok) throw new Error(`Phrase provider failed: ${response.status}`);
      const payload = await response.json();
      return validateStructuredPhraseCandidates(source, payload?.candidates);
    },
  });
}

export { CORE_PHRASE_LEXICON, PHRASE_LEXICON_VERSION };
