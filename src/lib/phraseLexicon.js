export const PHRASE_LEXICON_VERSION = "2026.08.1";

const DEFAULT_ENTRY = Object.freeze({
  category: "常用语块",
  difficulty: "B1",
  confidence: 0.96,
  priority: "medium",
  priorityScore: 68,
  reusability: 0.8,
  source: "seed-curation",
});

/**
 * First-party seed lexicon. The record shape is also the normalized target of
 * the Kaikki/Wiktionary + Open English WordNet import pipeline, so the matcher
 * does not care whether an entry came from the seed or a future data build.
 *
 * Aliases are deliberately explicit. This keeps matching deterministic and
 * makes inflection normalization inspectable (for example stood out -> stand
 * out) instead of hiding it in a fuzzy model.
 */
export const CORE_PHRASE_LEXICON = Object.freeze([
  {
    id: "figure-out",
    canonical: "figure out",
    aliases: ["figure out", "figures out", "figured out", "figuring out"],
    glossZh: "弄清楚；想明白",
    category: "短语动词",
    difficulty: "B1",
    priorityScore: 88,
  },
  {
    id: "point-out",
    canonical: "point out",
    aliases: ["point out", "points out", "pointed out", "pointing out"],
    glossZh: "指出；提醒注意",
    category: "短语动词",
    priorityScore: 84,
  },
  {
    id: "end-up",
    canonical: "end up",
    aliases: ["end up", "ends up", "ended up", "ending up"],
    glossZh: "最终处于；到头来",
    category: "短语动词",
    difficulty: "B2",
    priorityScore: 90,
  },
  {
    id: "go-through",
    canonical: "go through",
    aliases: ["go through", "goes through", "went through", "gone through", "going through"],
    glossZh: "经历；仔细检查",
    category: "短语动词",
    difficulty: "B2",
    priorityScore: 86,
  },
  {
    id: "deal-with",
    canonical: "deal with",
    aliases: ["deal with", "deals with", "dealt with", "dealing with"],
    glossZh: "处理；应对；涉及",
    category: "短语动词",
    difficulty: "B1",
    priorityScore: 82,
  },
  {
    id: "turn-out",
    canonical: "turn out",
    aliases: ["turn out", "turns out", "turned out", "turning out"],
    glossZh: "结果是；原来是",
    category: "短语动词",
    difficulty: "B1",
    priorityScore: 87,
  },
  {
    id: "take-off",
    canonical: "take off",
    aliases: ["take off", "takes off", "took off", "taken off", "taking off"],
    glossZh: "起飞；迅速流行；脱下",
    category: "短语动词",
    difficulty: "B1",
    priorityScore: 82,
  },
  {
    id: "come-across",
    canonical: "come across",
    aliases: ["come across", "comes across", "came across", "coming across"],
    glossZh: "偶然遇到；给人以……印象",
    category: "短语动词",
    difficulty: "B2",
    priorityScore: 88,
  },
  {
    id: "get-rid-of",
    canonical: "get rid of",
    aliases: ["get rid of", "gets rid of", "got rid of", "getting rid of"],
    glossZh: "摆脱；去除",
    category: "固定搭配",
    priorityScore: 87,
  },
  {
    id: "pay-attention-to",
    canonical: "pay attention to",
    aliases: ["pay attention to", "pays attention to", "paid attention to", "paying attention to"],
    glossZh: "注意；留意",
    category: "固定搭配",
    priorityScore: 79,
  },
  {
    id: "take-into-account",
    canonical: "take into account",
    aliases: ["take into account", "takes into account", "took into account", "taken into account", "taking into account"],
    glossZh: "把……考虑在内",
    category: "固定搭配",
    difficulty: "B2",
    priorityScore: 91,
  },
  {
    id: "make-sense",
    canonical: "make sense",
    aliases: ["make sense", "makes sense", "made sense", "making sense"],
    glossZh: "讲得通；有意义",
    category: "固定搭配",
    priorityScore: 84,
  },
  {
    id: "focus-on",
    canonical: "focus on",
    aliases: ["focus on", "focuses on", "focused on", "focussed on", "focusing on", "focussing on"],
    glossZh: "专注于；重点讨论",
    category: "动词搭配",
    priorityScore: 74,
  },
  {
    id: "rely-on",
    canonical: "rely on",
    aliases: ["rely on", "relies on", "relied on", "relying on"],
    glossZh: "依赖；信赖",
    category: "动词搭配",
    priorityScore: 78,
  },
  {
    id: "lead-to",
    canonical: "lead to",
    aliases: ["lead to", "leads to", "led to", "leading to"],
    glossZh: "导致；通向",
    category: "因果表达",
    priorityScore: 76,
  },
  {
    id: "result-in",
    canonical: "result in",
    aliases: ["result in", "results in", "resulted in", "resulting in"],
    glossZh: "导致；造成",
    category: "因果表达",
    difficulty: "B2",
    priorityScore: 79,
  },
  {
    id: "contribute-to",
    canonical: "contribute to",
    aliases: ["contribute to", "contributes to", "contributed to", "contributing to"],
    glossZh: "促成；有助于；导致",
    category: "因果表达",
    difficulty: "B2",
    priorityScore: 83,
  },
  {
    id: "be-based-on",
    canonical: "be based on",
    aliases: ["am based on", "is based on", "are based on", "was based on", "were based on", "be based on", "been based on", "being based on"],
    glossZh: "以……为基础；基于",
    category: "学术搭配",
    priorityScore: 77,
  },
  {
    id: "be-aware-of",
    canonical: "be aware of",
    aliases: ["am aware of", "is aware of", "are aware of", "was aware of", "were aware of", "be aware of", "been aware of"],
    glossZh: "意识到；知道",
    category: "固定搭配",
    difficulty: "B2",
    priorityScore: 80,
  },
  {
    id: "when-it-comes-to",
    canonical: "when it comes to",
    aliases: ["when it comes to", "when it came to"],
    glossZh: "说到；谈及",
    category: "话语标记",
    difficulty: "B2",
    priority: "high",
    priorityScore: 92,
  },
  {
    id: "that-being-said",
    canonical: "that being said",
    aliases: ["that being said", "that said", "having said that"],
    glossZh: "话虽如此；不过",
    category: "话语标记",
    difficulty: "B2",
    priority: "high",
    priorityScore: 91,
  },
  {
    id: "on-the-other-hand",
    canonical: "on the other hand",
    aliases: ["on the other hand"],
    glossZh: "另一方面；相对而言",
    category: "话语标记",
    difficulty: "B1",
    priorityScore: 78,
  },
  {
    id: "for-instance",
    canonical: "for instance",
    aliases: ["for instance"],
    glossZh: "例如",
    category: "话语标记",
    priorityScore: 66,
  },
  {
    id: "in-fact",
    canonical: "in fact",
    aliases: ["in fact", "as a matter of fact"],
    glossZh: "事实上；其实",
    category: "话语标记",
    priorityScore: 67,
  },
  {
    id: "as-long-as",
    canonical: "as long as",
    aliases: ["as long as", "so long as"],
    glossZh: "只要；在……期间",
    category: "条件结构",
    difficulty: "B1",
    priorityScore: 76,
  },
  {
    id: "no-matter",
    canonical: "no matter",
    aliases: ["no matter how", "no matter what", "no matter where", "no matter when", "no matter who", "no matter which"],
    glossZh: "无论……；不管……",
    category: "让步结构",
    difficulty: "B1",
    priorityScore: 79,
  },
  {
    id: "even-though",
    canonical: "even though",
    aliases: ["even though"],
    glossZh: "尽管；即使",
    category: "让步结构",
    priorityScore: 65,
  },
  {
    id: "so-far",
    canonical: "so far",
    aliases: ["so far", "thus far"],
    glossZh: "到目前为止；迄今",
    category: "时间表达",
    priorityScore: 72,
  },
  {
    id: "all-of-a-sudden",
    canonical: "all of a sudden",
    aliases: ["all of a sudden"],
    glossZh: "突然；冷不防",
    category: "习语",
    difficulty: "B1",
    priorityScore: 82,
  },
  {
    id: "kind-of",
    canonical: "kind of",
    aliases: ["kind of", "sort of"],
    glossZh: "有点；某种程度上",
    category: "口语缓和表达",
    priorityScore: 69,
  },
  {
    id: "be-about-to",
    canonical: "be about to",
    aliases: ["am about to", "is about to", "are about to", "was about to", "were about to", "be about to"],
    glossZh: "正要；即将",
    category: "语法语块",
    priorityScore: 75,
  },
  {
    id: "be-able-to",
    canonical: "be able to",
    aliases: ["am able to", "is able to", "are able to", "was able to", "were able to", "be able to", "been able to"],
    glossZh: "能够；有能力",
    category: "语法语块",
    priorityScore: 63,
  },
  {
    id: "in-front-of",
    canonical: "in front of",
    aliases: ["in front of"],
    glossZh: "在……前面；当着……的面",
    category: "介词短语",
    priorityScore: 62,
  },
  {
    id: "according-to",
    canonical: "according to",
    aliases: ["according to"],
    glossZh: "根据；按照",
    category: "信息来源表达",
    priorityScore: 70,
  },
].map((entry) => Object.freeze({ ...DEFAULT_ENTRY, ...entry })));

function normalizeToken(value) {
  return String(value ?? "")
    .toLocaleLowerCase("en")
    .replaceAll("’", "'");
}

export function tokenizePhraseText(text) {
  const tokens = [];
  const regexp = /[A-Za-z]+(?:['’][A-Za-z]+)?|[\p{L}\p{N}]+/gu;
  let match;
  while ((match = regexp.exec(String(text ?? "")))) {
    tokens.push({
      value: match[0],
      normalized: normalizeToken(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

export function createPhraseLexiconIndex(entries = CORE_PHRASE_LEXICON) {
  const byFirstToken = new Map();
  for (const entry of entries) {
    for (const alias of entry.aliases ?? []) {
      const aliasTokens = tokenizePhraseText(alias).map((token) => token.normalized);
      if (aliasTokens.length < 2) continue;
      const candidate = { entry, alias, tokens: aliasTokens };
      const bucket = byFirstToken.get(aliasTokens[0]) ?? [];
      bucket.push(candidate);
      byFirstToken.set(aliasTokens[0], bucket);
    }
  }
  for (const bucket of byFirstToken.values()) {
    bucket.sort(
      (left, right) =>
        right.tokens.length - left.tokens.length ||
        (right.entry.priorityScore ?? 0) - (left.entry.priorityScore ?? 0),
    );
  }
  return Object.freeze({ version: PHRASE_LEXICON_VERSION, byFirstToken });
}

export const CORE_PHRASE_INDEX = createPhraseLexiconIndex();

export function matchPhraseLexicon(text, index = CORE_PHRASE_INDEX) {
  const tokens = tokenizePhraseText(text);
  const matches = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const candidates = index.byFirstToken.get(tokens[tokenIndex].normalized) ?? [];
    for (const candidate of candidates) {
      if (tokenIndex + candidate.tokens.length > tokens.length) continue;
      const matched = candidate.tokens.every(
        (token, offset) => tokens[tokenIndex + offset].normalized === token,
      );
      if (!matched) continue;
      const start = tokens[tokenIndex].start;
      const end = tokens[tokenIndex + candidate.tokens.length - 1].end;
      matches.push({
        entry: candidate.entry,
        alias: candidate.alias,
        exact: String(text).slice(start, end),
        start,
        end,
      });
    }
  }
  return matches;
}
