// IRUSHY - refusals that are decided BEFORE any engine is consulted.
//
// The assessment guard lives in the route; when it refuses, this module
// writes the reply from the phrasebook. It is deterministic and makes no
// network call, so the refusal is identical whichever backend is configured
// (and the optional APInex backend is never called for it).

import { Voice } from './voice.js';
import { makeSeed } from './seed.js';
import { normalize } from '../lang.js';
import { matchTopic } from './match.js';

function shortTopic(concept, lang) {
  return String(concept.title[lang] || concept.title.en).replace(/\s*\([^)]*\)\s*$/, '').trim();
}

// reason: 'active' | 'no_token' | 'mistake_needs_token'
export function refusalAnswer({ knowledge, lang, mode, message, reason, conceptId = null }) {
  const seed = makeSeed(['refusal', knowledge.version, lang, mode, reason, normalize(message)]);
  const v = new Voice(knowledge, lang, seed);
  const lines = [];
  lines.push(v.say('assessment.refuse'));
  if (reason === 'mistake_needs_token') lines.push(v.say('assessment.howItWorks'));
  else lines.push(v.say('assessment.after'));
  let concept = conceptId ? knowledge.conceptById.get(conceptId) : null;
  if (!concept) {
    const m = matchTopic(knowledge, message);
    concept = m.best && m.best.score >= 1 ? m.best.concept : null;
  }
  const suggestions = [];
  if (concept) {
    const topic = shortTopic(concept, lang);
    lines.push(v.say('assessment.meanwhile', { topic }));
    suggestions.push({ label: v.fixed('label.explainTopic', { topic }), prompt: v.fixed('prompt.explainTopic', { topic }) });
  } else {
    lines.push(v.say('assessment.meanwhileGeneric'));
  }
  return { text: lines.join('\n'), suggestions, frames: v.trace, seed };
}
