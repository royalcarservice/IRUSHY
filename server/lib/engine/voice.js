// IRUSHY local engine - the phrasebook "voice".
//
// data/knowledge/phrasebook.<lang>.json holds:
//   frames: { "<slot>": ["variant 1", "variant 2", ...] }   2-4 variants
//   fixed:  { "<key>": "single text" }                       labels, notices
// Variants contain {named} slots. The variant is picked with the request
// seed, and the same frame always resolves to the same variant within one
// answer, so numbered lists stay consistent.

import { seededIndex } from './seed.js';

const SLOT_RE = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

export function fillTemplate(template, slots, key) {
  return String(template).replace(SLOT_RE, (m, name) => {
    const v = slots[name];
    if (v === undefined || v === null) throw new Error(`phrasebook: slot {${name}} has no value in "${key}"`);
    return String(v);
  });
}

export class Voice {
  constructor(knowledge, lang, seed) {
    this.books = knowledge.phrasebook;
    this.book = knowledge.phrasebook[lang] || {};
    this.lang = lang;
    this.seed = seed;
    this.trace = [];
    this._chosen = new Map();
  }

  has(key) {
    return Array.isArray(this.book.frames?.[key]) && this.book.frames[key].length > 0;
  }

  say(key, slots = {}) {
    const variants = this.book.frames?.[key];
    if (!Array.isArray(variants) || variants.length === 0) {
      throw new Error(`phrasebook: frame "${key}" is missing for language "${this.lang}"`);
    }
    let i = this._chosen.get(key);
    if (i === undefined) {
      i = seededIndex(this.seed, key, variants.length);
      this._chosen.set(key, i);
      this.trace.push({ frame: key, variant: i + 1, of: variants.length });
    }
    return fillTemplate(variants[i], slots, key);
  }

  fixed(key, slots = {}) {
    const text = this.book.fixed?.[key];
    if (typeof text !== 'string') throw new Error(`phrasebook: fixed text "${key}" is missing for language "${this.lang}"`);
    return fillTemplate(text, slots, key);
  }

  // Fixed text in a specific language (attachment labels are sent in both).
  fixedIn(lang, key, slots = {}) {
    const text = this.books?.[lang]?.fixed?.[key];
    if (typeof text !== 'string') throw new Error(`phrasebook: fixed text "${key}" is missing for language "${lang}"`);
    return fillTemplate(text, slots, key);
  }
}

// Bilingual fixed text (used for notices that are always sent in both).
export function fixedBoth(knowledge, key) {
  const en = knowledge.phrasebook.en?.fixed?.[key];
  const ta = knowledge.phrasebook.ta?.fixed?.[key];
  if (typeof en !== 'string' || typeof ta !== 'string') throw new Error(`phrasebook: fixed text "${key}" must exist in en and ta`);
  return { en, ta };
}
