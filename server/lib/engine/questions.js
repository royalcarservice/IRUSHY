// IRUSHY local engine - practice questions.
//
// Order of preference for a practice question on a topic:
//   1. approved bank questions a teacher has marked practice: true
//   2. labelled sample bank questions (when sample content is on)
//   3. questions GENERATED from the topic's concept note: the common mistake
//      as true/false, the worked example, and the note's named terms. These
//      are always labelled "generated practice question - not from the
//      question bank, not an exam question".
// Approved questions without practice: true are reserved for papers and are
// never shown or answered in chat.
//
// Questions already shown in the recent conversation are skipped. The choice
// among the rest is seeded, so it is deterministic.

import { slugify, tokenize, normalize, pick } from '../lang.js';
import { seededIndex } from './seed.js';

export const PRACTICE_REF_RE = /(?:Practice ref|பயிற்சிக் குறியீடு)\s*:\s*((?:qb|gen)\.[A-Za-z0-9._-]+)/;

export function parsePracticeRef(text) {
  const m = String(text || '').match(PRACTICE_REF_RE);
  return m ? m[1].replace(/[.]+$/, '') : null;
}

const conceptSlug = (concept) => concept.id.replace(/^concept\./, '');

export function generatedFor(concept) {
  const slug = conceptSlug(concept);
  const items = [];
  items.push({
    id: `gen.${slug}.mistake`,
    kind: 'true_false',
    concept,
    prompt: concept.mistake.claim,
    answer: { en: 'False', ta: 'தவறு' },
    answerValue: false,
    explanation: concept.mistake.correction
  });
  items.push({
    id: `gen.${slug}.example`,
    kind: 'worked',
    concept,
    prompt: concept.example.prompt,
    answer: concept.example.answer,
    explanation: { en: concept.example.steps.en.join(' '), ta: concept.example.steps.ta.join(' ') }
  });
  for (const t of concept.terms || []) {
    items.push({
      id: `gen.${slug}.term.${slugify(t.term)}`,
      kind: 'short',
      concept,
      term: t.term,
      answer: t.definition,
      explanation: null
    });
  }
  return items;
}

export function isPracticeEligible(q) {
  return !!q && (q.sample === true || q.practice === true);
}

export function practicePool(knowledge, concept, { medium = null, lang = 'en' } = {}) {
  const all = [...knowledge.bank.approved.filter(isPracticeEligible), ...knowledge.bank.sample];
  const hasLang = (q) => (lang === 'ta' ? q.questionHasTa : true);
  return all
    .filter((q) => q.topic === concept.topic)
    .sort((a, b) => {
      if (a.sample !== b.sample) return a.sample ? 1 : -1; // approved first
      if (hasLang(a) !== hasLang(b)) return hasLang(a) ? -1 : 1; // question text in the visitor's language first
      if (medium) {
        const am = a.medium === medium ? 0 : 1;
        const bm = b.medium === medium ? 0 : 1;
        if (am !== bm) return am - bm;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

// Returns { source: 'bank', question } | { source: 'generated', item } | null
export function pickPractice(knowledge, concept, { exclude = [], seed = '', medium = null, lang = 'en' } = {}) {
  const ex = new Set(exclude);
  const bank = practicePool(knowledge, concept, { medium, lang }).filter((q) => !ex.has(q.id));
  if (bank.length) {
    // Choose within the best available tier: approved before sample, and
    // (for Tamil) questions that have Tamil text before English-only ones.
    const tierKey = (q) => `${q.sample}|${lang === 'ta' ? q.questionHasTa : true}`;
    const tier = bank.filter((q) => tierKey(q) === tierKey(bank[0]));
    return { source: 'bank', question: tier[seededIndex(seed, `practice:${concept.id}`, tier.length)] };
  }
  const gen = generatedFor(concept).filter((g) => !ex.has(g.id));
  if (gen.length) return { source: 'generated', item: gen[seededIndex(seed, `generated:${concept.id}`, gen.length)] };
  return null;
}

export function resolvePracticeRef(knowledge, ref) {
  if (!ref) return null;
  if (ref.startsWith('qb.')) {
    const rec = knowledge.idIndex.get(ref);
    if (!rec || rec.kind !== 'question') return null;
    if (!isPracticeEligible(rec.entry)) return { source: 'reserved', question: rec.entry };
    return { source: 'bank', question: rec.entry };
  }
  if (ref.startsWith('gen.')) {
    const m = ref.match(/^gen\.([a-z0-9-]+)\./);
    if (!m) return null;
    const concept = knowledge.conceptById.get(`concept.${m[1]}`);
    if (!concept) return null;
    const item = generatedFor(concept).find((g) => g.id === ref);
    return item ? { source: 'generated', item } : null;
  }
  return null;
}

export function conceptForPractice(knowledge, resolved) {
  if (!resolved) return null;
  if (resolved.source === 'generated') return resolved.item.concept;
  const topic = resolved.question.topic;
  return knowledge.concepts.find((c) => c.topic === topic) || null;
}

// ---------------------------------------------------------------------------
// Checking an attempt. Returns 'correct' | 'incorrect' | 'self-check'.
// ---------------------------------------------------------------------------
const TRUE_WORDS = new Set(['true', 'yes', 'correct', 'right', 't', 'சரி', 'ஆம்', 'உண்மை']);
const FALSE_WORDS = new Set(['false', 'no', 'wrong', 'incorrect', 'f', 'தவறு', 'இல்லை', 'பொய்']);
const NOISE = new Set(['the', 'a', 'an', 'is', 'it', 'answer', 'my', 'i', 'think', 'gate', 'number', 'விடை', 'என்', 'நினைக்கிறேன்']);

function keyTokens(text) {
  return tokenize(text).filter((t) => !NOISE.has(t));
}

export function checkAttempt(resolved, attempt) {
  const raw = String(attempt || '').trim();
  const norm = normalize(raw).replace(/[.!?]+$/, '');
  if (resolved.source === 'generated') {
    const item = resolved.item;
    if (item.kind === 'true_false') {
      const first = norm.split(/[\s,]+/)[0];
      if (TRUE_WORDS.has(first)) return item.answerValue === true ? 'correct' : 'incorrect';
      if (FALSE_WORDS.has(first)) return item.answerValue === false ? 'correct' : 'incorrect';
      return 'self-check';
    }
    return 'self-check';
  }
  const q = resolved.question;
  if (q.type === 'mcq') {
    const letter = norm.match(/^(?:option\s*)?\(?([a-d])\)?(?:[\s.)]|$)/i);
    if (letter) return letter[1].toUpperCase() === q.answer.toUpperCase() ? 'correct' : 'incorrect';
    const correct = (q.options || []).find((o) => o.key.toUpperCase() === q.answer.toUpperCase());
    if (correct) {
      const ok = [correct.text.en, correct.text.ta].some((t) => normalize(t) === norm);
      if (ok) return 'correct';
      const other = (q.options || []).some((o) => o !== correct && [o.text.en, o.text.ta].some((t) => normalize(t) === norm));
      if (other) return 'incorrect';
    }
    return 'self-check';
  }
  // One-word answers, and longer types whose model answer is itself short
  // (e.g. "101101"), can be marked; real prose answers are self-checked.
  if (q.type === 'one_word' || keyTokens(q.answer).length <= 2) {
    const expected = keyTokens(q.answer);
    const got = keyTokens(raw);
    if (!expected.length || !got.length) return 'self-check';
    const allPresent = expected.every((e) => got.includes(e));
    if (allPresent && got.length <= expected.length + 3) return 'correct';
    return 'incorrect';
  }
  return 'self-check'; // longer answers: show the model answer to compare
}

export function answerText(resolved, lang) {
  if (resolved.source === 'generated') return pick(resolved.item.answer, lang);
  const q = resolved.question;
  if (q.type === 'mcq') {
    const o = (q.options || []).find((x) => x.key.toUpperCase() === q.answer.toUpperCase());
    return o ? `${o.key}) ${pick(o.text, lang)}` : q.answer;
  }
  return q.answer;
}

export function explanationText(resolved, lang) {
  if (resolved.source === 'generated') return resolved.item.explanation ? pick(resolved.item.explanation, lang) : '';
  return resolved.question.explanation ? pick(resolved.question.explanation, lang) : '';
}
