// IRUSHY - retrieval (BM25 over the loaded knowledge, Tamil + English).
//
// English words are lightly stemmed. Tamil words are indexed by their
// prefixes (4+ code units) and queried by their stem, so inflected forms
// such as தேர்வு / தேர்வை / தேர்வில் meet in the index. Ordering is fully
// deterministic: score, then id.

import { tokenize, contentTokens, isTamilToken, stemTamil, pick } from './lang.js';

const K1 = 1.2;
const B = 0.75;

function docTerms(tokens) {
  const terms = [];
  for (const t of tokens) {
    if (isTamilToken(t)) {
      for (let n = 4; n <= t.length; n += 1) terms.push('ta:' + t.slice(0, n));
      if (t.length < 4) terms.push('ta:' + t);
    } else {
      terms.push(t);
    }
  }
  return terms;
}

function queryTerms(tokens) {
  const out = new Set();
  for (const t of tokens) {
    if (isTamilToken(t)) {
      const s = stemTamil(t);
      out.add('ta:' + (s.length >= 4 ? s : t));
    } else if (t.length > 1 || /\d/.test(t)) {
      out.add(t);
    }
  }
  return [...out];
}

function both(v) {
  return v ? `${pick(v, 'en')} ${pick(v, 'ta')}` : '';
}

// Text used to index each kind of entry.
function docText(kind, e) {
  switch (kind) {
    case 'faq':
      return [both(e.question), both(e.question), e.keywords.join(' '), e.keywords.join(' '), both(e.answer)].join(' ');
    case 'material':
      return [both(e.title), e.topic || '', e.subject || '', e.class ? `${e.class}th class ${e.class}` : '', e.medium || ''].join(' ');
    case 'concept':
      return [
        both(e.title),
        both(e.title),
        e.topic,
        (e.keywords.en || []).join(' '),
        (e.keywords.ta || []).join(' '),
        both(e.definition),
        ...(e.terms || []).map((t) => `${t.term} ${(t.aliases || []).join(' ')} ${t.ta || ''}`)
      ].join(' ');
    case 'question':
      return [both(e.question), e.keywords.join(' '), e.topic || ''].join(' ');
    case 'glossary':
      return `${e.en} ${e.ta}`;
    case 'video':
    case 'diagram':
      return [both(e.title), e.keywords.join(' '), e.topic || ''].join(' ');
    case 'site-page':
      return [both(e.title), e.path].join(' ');
    default:
      return '';
  }
}

export function buildIndex(knowledge) {
  const docs = [];
  const add = (kind, entry) => {
    const tokens = tokenize(docText(kind, entry));
    const terms = docTerms(tokens);
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    docs.push({ id: entry.id, kind, entry, tf, len: Math.max(1, tokens.length) });
  };
  knowledge.faq.forEach((e) => add('faq', e));
  knowledge.resources.forEach((e) => add('material', e));
  knowledge.concepts.forEach((e) => add('concept', e));
  [...knowledge.bank.approved, ...knowledge.bank.sample].forEach((e) => add('question', e));
  knowledge.glossary.forEach((e) => add('glossary', e));
  [...knowledge.videos.approved, ...knowledge.videos.sample].forEach((e) => add('video', e));
  [...knowledge.diagrams.approved, ...knowledge.diagrams.sample].forEach((e) => add('diagram', e));
  knowledge.sitePages.forEach((e) => add('site-page', e));

  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  const N = docs.length;

  function search(query, { kinds = null, limit = 6, minScore = 0.5 } = {}) {
    // Content words only: "what is" / "என்றால் என்ன" must not decide the ranking.
    const q = queryTerms(contentTokens(query));
    if (!q.length) return [];
    const out = [];
    for (const d of docs) {
      if (kinds && !kinds.includes(d.kind)) continue;
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (!f) continue;
        const n = df.get(t) || 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += (idf * (f * (K1 + 1))) / (f + K1 * (1 - B + (B * d.len) / avgLen));
      }
      if (score >= minScore) out.push({ id: d.id, kind: d.kind, score: Math.round(score * 1000) / 1000, entry: d.entry });
    }
    out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out.slice(0, limit);
  }

  return { search, size: docs.length };
}
