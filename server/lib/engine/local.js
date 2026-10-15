// IRUSHY local engine - the default backend.
//
// No key, no account, no network. Given the same request and the same
// knowledge files it always returns the same answer:
//   classify (intent.js) -> pick a composer (composers.js) -> phrase it with
//   the seeded phrasebook voice (voice.js) -> trim to the intent's length
//   target -> add the sample label when sample content was used.
//
// Interface shared with the optional APInex backend:
//   answer({ mode, lang, message, history, hits, destinations, context,
//            notices }) -> { text, citations, usedIds, provenance,
//                            source: 'local', debug? , ...extras }

import { classify } from './intent.js';
import { COMPOSERS, Draft } from './composers.js';
import { Voice } from './voice.js';
import { makeSeed } from './seed.js';
import { matchTopic } from './match.js';
import { refusalAnswer } from './refusals.js';
import { normalize } from '../lang.js';
import { extractCitationIds, truncateAtSentence } from '../sanitize.js';

export const LOCAL_ENGINE_VERSION = '1.0.0';

// Target length per intent in characters (English). Tamil script needs
// roughly 1.6x the code points for the same content.
export const LENGTH_TARGETS = Object.freeze({
  greeting: 340,
  thanks: 220,
  farewell: 200,
  identity: 700,
  website_help: 800,
  materials: 1050,
  topic_explanation: 1350,
  definition: 750,
  procedure: 1350,
  explain_simpler: 750,
  show_example: 1150,
  practice_question: 900,
  practice_answer: 950,
  mistake_explanation: 1250,
  assessment_request: 650,
  teacher_paper: 1250,
  coverage: 1150,
  results_privacy: 950,
  term_help: 600,
  not_published: 600,
  off_topic: 700,
  abuse: 500,
  unknown: 750
});
export const TAMIL_FACTOR = 1.6;

export function lengthTarget(intent, lang) {
  const base = LENGTH_TARGETS[intent] || 900;
  return Math.round(lang === 'ta' ? base * TAMIL_FACTOR : base);
}

export function createLocalEngine({ knowledge, config }) {
  return {
    name: 'local',
    version: LOCAL_ENGINE_VERSION,
    requiresKey: false,
    usesNetwork: false,
    connected: () => true,
    describe: () => ({ engine: 'local', engine_version: LOCAL_ENGINE_VERSION, requires_key: false, uses_network: false }),
    async answer(input) {
      return answerLocal(knowledge, config, input);
    },
    // Self-test for /api/health?deep=1: answers a fixed question twice and
    // checks the two answers are identical. No network involved.
    async probe() {
      const req = { mode: 'home', lang: 'en', message: 'Where are the materials?', history: [], context: {} };
      const a = answerLocal(knowledge, config, req);
      const b = answerLocal(knowledge, config, req);
      return { ok: a.text === b.text && a.text.length > 0, deterministic: a.text === b.text, intent: a.intent };
    }
  };
}

export function answerLocal(knowledge, config, input) {
  const mode = input.mode || 'home';
  const lang = input.lang === 'ta' ? 'ta' : 'en';
  const message = String(input.message || '');
  const history = Array.isArray(input.history) ? input.history : [];
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const hits = Array.isArray(input.hits) ? input.hits : [];
  const cls = input.classification || classify({ message, mode, history, context, knowledge });

  const st = cls.signals.state;
  const topicId = (cls.signals.topic && cls.signals.topic.concept.id) || st.conceptId || '';
  const anchor = `${st.practiceRef || ''}|${st.shownPractice.join(',')}|${st.cited.join(',')}`;
  const seed = makeSeed([LOCAL_ENGINE_VERSION, knowledge.version, lang, mode, cls.intent, normalize(message), topicId, anchor]);
  const voice = new Voice(knowledge, lang, seed);
  const ctx = {
    knowledge,
    config,
    lang,
    mode,
    message,
    history,
    context,
    cls,
    voice,
    seed,
    hits,
    matchTopic: (text) => matchTopic(knowledge, text)
  };
  const d = new Draft();
  if (cls.intent === 'assessment_request') {
    // Normally refused by the route before the engine is called; kept here
    // too so the engine can never answer such a request on its own.
    const r = refusalAnswer({ knowledge, lang, mode, message, reason: 'active', conceptId: topicId || null });
    d.composer = 'assessment-refusal';
    d.add(r.text);
    r.suggestions.forEach((s) => d.suggest(s));
    d.flag('general');
  } else {
    (COMPOSERS[cls.intent] || COMPOSERS.unknown)(ctx, d);
  }
  if (d.composer === 'unknown' || d.composer === 'which-topic') {
    // Offer the closest verified website question, if retrieval found one.
    const faqHit = hits.find((h) => h.kind === 'faq');
    if (faqHit) d.suggest({ label: faqHit.entry.question[lang], prompt: faqHit.entry.question[lang] });
  }
  return finalize(ctx, d);
}

function finalize(ctx, d) {
  const { knowledge, lang, voice, cls, config, seed } = ctx;
  const target = Math.min(lengthTarget(cls.intent, lang), config.limits.maxAnswerChars);
  const blocks = d.blocks.slice();
  const dropped = [];
  const join = (bs) => bs.map((b) => b.text).join('\n');
  const isSampleId = (id) => knowledge.idIndex.has(id) && knowledge.idIndex.get(id).provenance !== 'approved';
  // The sample label is mandatory, so its length is reserved up front.
  const willBeSample = (t) => d.flags.has('generated') || [...d.used].some(isSampleId) || extractCitationIds(t).some(isSampleId);
  const labelRoom = (t) => (willBeSample(t) ? voice.say('sample.label').length + 1 : 0);
  let text = join(blocks);
  while (text.length + labelRoom(text) > target) {
    let idx = -1;
    let pr = 0;
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      if (blocks[i].priority > pr) {
        pr = blocks[i].priority;
        idx = i;
      }
    }
    if (idx < 0) break;
    dropped.push({ priority: blocks[idx].priority, chars: blocks[idx].text.length });
    blocks.splice(idx, 1);
    text = join(blocks);
  }

  const cited = extractCitationIds(text).filter((id) => knowledge.idIndex.has(id));
  const used = [...new Set([...cited, ...[...d.used].filter((id) => knowledge.idIndex.has(id))])];
  const isSample = (id) => knowledge.idIndex.get(id).provenance !== 'approved';
  const sampleUsed = used.some(isSample) || d.flags.has('generated');
  if (sampleUsed) text += '\n' + voice.say('sample.label');
  text = truncateAtSentence(text, config.limits.maxAnswerChars).text;

  const provenance = [];
  if (used.some((id) => !isSample(id))) provenance.push('approved');
  if (sampleUsed) provenance.push('sample-unapproved');
  if (d.flags.has('general') || d.flags.has('generated') || used.length === 0) provenance.push('general-guidance');

  const sig = cls.signals;
  return {
    text,
    citations: cited,
    usedIds: used,
    provenance,
    source: 'local',
    links: d.links,
    attachments: d.attachments,
    suggestions: d.suggestions,
    intent: cls.intent,
    confidence: cls.confidence,
    sampleContentUsed: sampleUsed,
    debug: {
      engine: 'local',
      engine_version: LOCAL_ENGINE_VERSION,
      knowledge_version: knowledge.version,
      intent: cls.intent,
      confidence: cls.confidence,
      rule: cls.rule,
      topic: sig.topic ? { id: sig.topic.concept.id, score: sig.topic.score, term: sig.topic.term ? sig.topic.term.term : null, matched: sig.topic.hits } : null,
      topic_alternatives: sig.topicAlternatives,
      faq: sig.faq ? { id: sig.faq.faq.id, score: sig.faq.score, matched: sig.faq.hits } : null,
      faq_alternatives: sig.faqAlternatives,
      history: {
        turns: sig.state.turns,
        cited_ids: sig.state.cited,
        practice_ref: sig.state.practiceRef,
        shown_practice: sig.state.shownPractice,
        concept: sig.state.conceptId,
        concept_via: sig.state.conceptVia
      },
      retrieved: ctx.hits.slice(0, 5).map((h) => ({ id: h.id, kind: h.kind, score: h.score })),
      composer: d.composer,
      frames: voice.trace,
      seed,
      length: { target, chars: text.length, dropped_blocks: dropped },
      used_ids: used
    }
  };
}
