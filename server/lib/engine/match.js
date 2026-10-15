// IRUSHY local engine - topic, term, FAQ and lexicon matching.
//
// All phrase lists are compiled once per knowledge version. Scores are plain
// sums so the "why" is easy to read in the debug field:
//   keyword phrase      1 + 0.5 per extra word
//   named term          1.5 + 0.5 per extra word (only the best term counts)
//   FAQ: keywords + 2 x (share of the question's content words that match)

import { compilePhrase, findPhrase, tokenize, contentTokens, overlapScore, normalize, hasTamil } from '../lang.js';
import { TOPIC_ORDER } from '../data.js';

const cache = new WeakMap();

function compileList(list) {
  return (Array.isArray(list) ? list : []).filter((s) => typeof s === 'string' && s.trim()).map(compilePhrase);
}

function compileKnowledge(knowledge) {
  const concepts = knowledge.concepts.map((c) => ({
    concept: c,
    phrases: compileList([...(c.keywords.en || []), ...(c.keywords.ta || [])]),
    excludes: compileList(c.excludePhrases || []),
    terms: (c.terms || []).map((t) => ({
      term: t,
      // A term's Tamil rendering is a match phrase only if it really is Tamil
      // script ("WHERE" or "RAM (Random Access Memory)" would match far too much).
      phrases: compileList([t.term, ...(t.aliases || []), ...(t.ta && hasTamil(t.ta) ? [t.ta] : [])])
    }))
  }));
  const faqs = knowledge.faq.map((f) => ({ faq: f, phrases: compileList(f.keywords) }));
  const lex = knowledge.lexicon || {};
  const lexicon = {};
  for (const [name, value] of Object.entries(lex)) {
    if (name.startsWith('_')) continue;
    if (Array.isArray(value)) lexicon[name] = compileList(value);
    else if (value && typeof value === 'object') {
      lexicon[name] = compileList(Object.values(value).flat());
    }
  }
  const glossary = knowledge.glossary.map((g) => ({ entry: g, en: compilePhrase(g.en), ta: compilePhrase(g.ta) }));
  return { concepts, faqs, lexicon, glossary };
}

export function compiled(knowledge) {
  let c = cache.get(knowledge);
  if (!c) {
    c = compileKnowledge(knowledge);
    cache.set(knowledge, c);
  }
  return c;
}

const rank = (topic) => {
  const i = TOPIC_ORDER.indexOf(topic);
  return i === -1 ? 999 : i;
};

// Gate names are only trusted in capitals (AND / OR / NOT are ordinary
// English words in lower case), and not when the whole message is shouted.
function gateNames(raw) {
  const letters = raw.replace(/[^A-Za-z]/g, '');
  if (letters.length > 6 && letters === letters.toUpperCase()) return [];
  return [...new Set((raw.match(/\b(?:AND|OR|NOT|NAND|NOR|XOR|XNOR)\b/g) || []))];
}

export function matchTopic(knowledge, message) {
  const tokens = tokenize(message);
  const raw = String(message || '');
  const results = [];
  for (const c of compiled(knowledge).concepts) {
    // An exclude phrase ("binary search") removes the concept entirely.
    if (c.excludes.some((p) => findPhrase(p, tokens) >= 0)) continue;
    let score = 0;
    const hits = [];
    for (const p of c.phrases) {
      if (findPhrase(p, tokens) >= 0) {
        score += 1 + 0.5 * (p.units.length - 1);
        hits.push(p.phrase);
      }
    }
    let best = null;
    for (const t of c.terms) {
      for (const p of t.phrases) {
        if (findPhrase(p, tokens) < 0) continue;
        const w = 1.5 + 0.5 * (p.units.length - 1);
        if (!best || w > best.weight) best = { term: t.term, weight: w, phrase: p.phrase };
      }
    }
    if (best) {
      score += best.weight;
      hits.push(best.phrase);
    }
    if (c.concept.id === 'concept.boolean-algebra') {
      const gates = gateNames(raw);
      if (gates.length) {
        score += 1;
        hits.push(gates.join('/'));
        if (!best) {
          const gateTerm = c.terms.find((t) => normalize(t.term.term) === `${gates[0].toLowerCase()} gate`);
          if (gateTerm) best = { term: gateTerm.term, weight: 1.5, phrase: gates[0] };
        }
      }
    }
    if (score > 0) results.push({ concept: c.concept, term: best ? best.term : null, score, hits });
  }
  results.sort((a, b) => b.score - a.score || rank(a.concept.topic) - rank(b.concept.topic));
  return { best: results[0] || null, all: results };
}

export function matchFaq(knowledge, message, mode) {
  const tokens = tokenize(message);
  const ctoks = contentTokens(message);
  const out = [];
  for (const f of compiled(knowledge).faqs) {
    let kw = 0;
    const hits = [];
    for (const p of f.phrases) {
      if (findPhrase(p, tokens) >= 0) {
        kw += 1 + 0.5 * (p.units.length - 1);
        hits.push(p.phrase);
      }
    }
    const qText = `${f.faq.question.en} ${f.faq.question.ta} ${f.faq.keywords.join(' ')}`;
    const ov = overlapScore(ctoks, qText);
    let score = kw + 2 * ov;
    if (mode && !f.faq.modes.includes(mode)) score *= 0.9;
    if (score > 0) out.push({ faq: f.faq, score: Math.round(score * 1000) / 1000, hits, overlap: Math.round(ov * 1000) / 1000 });
  }
  out.sort((a, b) => b.score - a.score || (a.faq.id < b.faq.id ? -1 : 1));
  return { best: out[0] || null, all: out };
}

export function lexiconHit(knowledge, name, message) {
  const list = compiled(knowledge).lexicon[name];
  if (!list || !list.length) return null;
  const tokens = tokenize(message);
  for (const p of list) if (findPhrase(p, tokens) >= 0) return p.phrase;
  return null;
}

// Glossary lookup: English term (or Tamil term) named in the message.
export function matchGlossary(knowledge, message) {
  const tokens = tokenize(message);
  let best = null;
  for (const g of compiled(knowledge).glossary) {
    for (const [side, p] of [['en', g.en], ['ta', g.ta]]) {
      if (findPhrase(p, tokens) < 0) continue;
      const len = p.units.length;
      if (!best || len > best.len) best = { entry: g.entry, side, len };
    }
  }
  return best;
}
