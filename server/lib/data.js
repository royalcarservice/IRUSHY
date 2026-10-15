// IRUSHY - knowledge loader.
//
// Reads data/*.json (approved / verified), data/sample/*.json (labelled
// sample, only when IRUSHY_ALLOW_SAMPLE_CONTENT is on) and
// data/knowledge/*.json (concept notes, phrasebooks, lexicon). Everything is
// validated once at boot; anything invalid is dropped with a warning rather
// than shown. The result is frozen and carries a content version hash, which
// the local engine uses so that "same request + same knowledge = same answer".

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateSvg } from './svg.js';
import { slugify } from './lang.js';

export const SITE_HOSTS = new Set(['tnhhsscta.com', 'www.tnhhsscta.com']);
export const VIDEO_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be']);

export const TOPIC_ORDER = [
  'Number systems',
  'Boolean algebra',
  'Computer organisation',
  'Computer memory',
  'Operating systems',
  'Python basics',
  'HTML',
  'HTML / CSS',
  'Database / SQL',
  'Spreadsheet',
  'Computer networks',
  'Internet',
  'Internet safety'
];

export function isSiteUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && SITE_HOSTS.has(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isVideoUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && VIDEO_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function readJson(file, { optional = false } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (optional) return { json: null, text: '' };
    throw new Error(`IRUSHY could not read ${file}: ${err.message}`);
  }
  try {
    return { json: JSON.parse(text), text };
  } catch (err) {
    throw new Error(`IRUSHY could not parse ${file}: ${err.message}`);
  }
}

function itemsOf(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.items)) return json.items;
  return [];
}

const bi = (v) => (v && typeof v === 'object' ? { en: String(v.en || v.ta || ''), ta: String(v.ta || v.en || '') } : { en: String(v || ''), ta: String(v || '') });

const nonEmptyBi = (v) => v && typeof v === 'object' && typeof v.en === 'string' && v.en.trim() && typeof v.ta === 'string' && v.ta.trim();
// Question text may exist in one language only (English-medium items have no
// Tamil); the missing side falls back and is flagged (questionHasTa).
const someText = (v) => v && typeof v === 'object' && ((typeof v.en === 'string' && v.en.trim()) || (typeof v.ta === 'string' && v.ta.trim()));

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// ---------------------------------------------------------------------------
export function loadKnowledge({ dataDir, allowSample, log = null }) {
  const warnings = [];
  const warn = (msg) => {
    warnings.push(msg);
    if (log) log.warn('data_warning', { detail: msg });
  };
  const hash = crypto.createHash('sha256');
  const files = [];

  function load(rel, opts) {
    const file = path.join(dataDir, rel);
    const r = readJson(file, opts);
    if (r.json) {
      files.push(rel);
      hash.update(rel + '\n' + r.text + '\n');
    }
    return r.json;
  }

  const idIndex = new Map();
  function register(id, kind, provenance, label, entry, title) {
    if (!id || typeof id !== 'string') return false;
    if (idIndex.has(id)) {
      warn(`duplicate id ${id} (${kind}) ignored`);
      return false;
    }
    idIndex.set(id, { id, kind, provenance, label, entry, title: bi(title) });
    return true;
  }

  // ---- site pages (verified) ----------------------------------------------
  const sitePages = [];
  for (const p of itemsOf(load('site-pages.json'))) {
    if (!p || !p.id || !isSiteUrl(p.url)) {
      warn(`site page ${p && p.id} dropped: url is not https on tnhhsscta.com`);
      continue;
    }
    const page = { id: p.id, url: p.url, path: p.path || new URL(p.url).pathname, role: p.role || 'home', title: bi(p.title) };
    if (register(page.id, 'site-page', 'approved', 'verified-site', page, page.title)) sitePages.push(page);
  }
  const sitePageById = new Map(sitePages.map((p) => [p.id, p]));

  // ---- FAQ (verified) -----------------------------------------------------
  const faq = [];
  for (const f of itemsOf(load('site-faq.json'))) {
    if (!f || !f.id || !nonEmptyBi(f.question) || !nonEmptyBi(f.answer)) {
      warn(`faq ${f && f.id} dropped: missing question/answer`);
      continue;
    }
    const links = [];
    for (const l of Array.isArray(f.links) ? f.links : []) {
      if (sitePageById.has(l.id)) links.push({ id: l.id, label: l.label ? bi(l.label) : sitePageById.get(l.id).title });
      else warn(`faq ${f.id}: link id ${l.id} is not in site-pages.json, dropped`);
    }
    const entry = {
      id: f.id,
      topic: f.topic || null,
      keywords: Array.isArray(f.keywords) ? f.keywords.map(String) : [],
      question: bi(f.question),
      answer: bi(f.answer),
      links,
      modes: Array.isArray(f.modes) ? f.modes : ['home', 'student', 'teacher'],
      audience: Array.isArray(f.audience) ? f.audience : []
    };
    if (register(entry.id, 'faq', 'approved', 'verified-site', entry, entry.question)) faq.push(entry);
  }

  // ---- materials (approved-published) ---------------------------------------
  const resources = [];
  for (const r of itemsOf(load('resources.json'))) {
    if (!r || !r.id || !isSiteUrl(r.url)) {
      warn(`material ${r && r.id} dropped: url is not https on tnhhsscta.com`);
      continue;
    }
    const entry = {
      id: r.id,
      title: bi(r.title),
      topic: r.topic || null,
      class: Number(r.class) || null,
      subject: r.subject || null,
      medium: r.medium || null,
      language: r.language || null,
      file: r.file || null,
      url: r.url
    };
    if (register(entry.id, 'material', 'approved', 'approved-published', entry, entry.title)) resources.push(entry);
  }
  const resourceById = new Map(resources.map((r) => [r.id, r]));

  // ---- videos -----------------------------------------------------------------
  function loadVideos(rel, sample) {
    const out = [];
    const json = load(rel, { optional: sample });
    for (const v of itemsOf(json)) {
      const approved = !sample && v && v.status === 'approved' && v.approvedBy && v.approvedOn;
      if (!v || !v.id || !isVideoUrl(v.url)) {
        warn(`video ${v && v.id} dropped: not an https YouTube link`);
        continue;
      }
      if (!sample && !approved) {
        warn(`video ${v.id} in videos.json is not approved (status/approvedBy/approvedOn), ignored`);
        continue;
      }
      const entry = {
        id: v.id,
        title: bi(v.title),
        url: v.url,
        channel: v.channel || null,
        topic: v.topic || null,
        class: Number(v.class) || null,
        language: v.language || null,
        contentReviewed: v.contentReviewed === true,
        keywords: Array.isArray(v.keywords) ? v.keywords.map(String) : [],
        sample
      };
      if (register(entry.id, 'video', sample ? 'sample-unapproved' : 'approved', sample ? 'sample-unapproved' : 'approved', entry, entry.title)) out.push(entry);
    }
    return out;
  }

  // ---- diagrams ---------------------------------------------------------------
  function loadDiagrams(rel, sample) {
    const out = [];
    const json = load(rel, { optional: sample });
    for (const d of itemsOf(json)) {
      if (!d || !d.id) continue;
      const approved = !sample && d.status === 'approved' && d.approvedBy && d.approvedOn;
      if (!sample && !approved) {
        warn(`diagram ${d.id} in diagrams.json is not approved, ignored`);
        continue;
      }
      const check = validateSvg(d.svg);
      if (!check.ok) {
        warn(`diagram ${d.id} dropped: SVG failed validation (${check.reason})`);
        continue;
      }
      const entry = {
        id: d.id,
        title: bi(d.title),
        caption: bi(d.caption),
        topic: d.topic || null,
        class: Number(d.class) || null,
        svg: d.svg,
        keywords: Array.isArray(d.keywords) ? d.keywords.map(String) : [],
        sample
      };
      if (register(entry.id, 'diagram', sample ? 'sample-unapproved' : 'approved', sample ? 'sample-unapproved' : 'approved', entry, entry.title)) out.push(entry);
    }
    return out;
  }

  // ---- question banks -----------------------------------------------------------
  const approvedBankJson = load('question-bank.json');
  const questionTypes = (approvedBankJson && approvedBankJson._meta && approvedBankJson._meta.questionTypes) || {
    one_word: { label: { en: 'One word', ta: 'ஒரு வார்த்தை' }, defaultMarks: 1 },
    mcq: { label: { en: 'Multiple choice', ta: 'பலவுள் தெரிவு' }, defaultMarks: 1 },
    two_mark: { label: { en: '2 marks', ta: '2 மதிப்பெண்' }, defaultMarks: 2 },
    three_mark: { label: { en: '3 marks', ta: '3 மதிப்பெண்' }, defaultMarks: 3 },
    five_mark: { label: { en: '5 marks', ta: '5 மதிப்பெண்' }, defaultMarks: 5 }
  };

  function loadBank(json, sample) {
    const out = [];
    for (const q of itemsOf(json)) {
      if (!q || !q.id || !someText(q.question) || typeof q.answer !== 'string' || !q.answer.trim()) {
        warn(`question ${q && q.id} dropped: missing question/answer`);
        continue;
      }
      const approved = !sample && q.status === 'approved' && q.approvedBy && q.approvedOn;
      if (!sample && !approved) {
        warn(`question ${q.id} in question-bank.json is not approved, ignored`);
        continue;
      }
      if (!questionTypes[q.type]) {
        warn(`question ${q.id} dropped: unknown type ${q.type}`);
        continue;
      }
      let conceptRef = q.conceptRef || null;
      if (conceptRef && !resourceById.has(conceptRef)) {
        warn(`question ${q.id}: conceptRef ${conceptRef} is not a published material, set to null`);
        conceptRef = null;
      }
      const entry = {
        id: q.id,
        class: Number(q.class) || null,
        subject: q.subject || null,
        medium: q.medium || null,
        language: q.language || null,
        topic: q.topic || null,
        type: q.type,
        marks: Number(q.marks) || questionTypes[q.type].defaultMarks || 1,
        difficulty: q.difficulty || null,
        question: bi(q.question),
        questionHasTa: !!(q.question && q.question.ta),
        options: Array.isArray(q.options)
          ? q.options.filter((o) => o && o.key).map((o) => ({ key: String(o.key), text: bi(o.text) }))
          : null,
        answer: String(q.answer),
        explanation: q.explanation ? bi(q.explanation) : null,
        conceptRef,
        keywords: Array.isArray(q.keywords) ? q.keywords.map(String) : [],
        // Approved questions are reserved for papers unless a teacher marks
        // them as practice too. Sample questions are practice material.
        practice: sample ? true : q.practice === true,
        sample
      };
      if (register(entry.id, 'question', sample ? 'sample-unapproved' : 'approved', sample ? 'sample-unapproved' : 'approved', entry, entry.question)) out.push(entry);
    }
    return out;
  }

  const bank = { approved: loadBank(approvedBankJson, false), sample: [] };
  const videos = { approved: loadVideos('videos.json', false), sample: [] };
  const diagrams = { approved: loadDiagrams('diagrams.json', false), sample: [] };
  let glossary = [];

  if (allowSample) {
    bank.sample = loadBank(load('sample/question-bank.sample.json', { optional: true }), true);
    videos.sample = loadVideos('sample/videos.sample.json', true);
    diagrams.sample = loadDiagrams('sample/diagrams.sample.json', true);

    // Glossary rows have no ids in the file; derive stable ones from the
    // English term so they can be cited and checked like everything else.
    const used = new Set();
    for (const g of itemsOf(load('sample/glossary.sample.json', { optional: true }))) {
      if (!g || typeof g.en !== 'string' || typeof g.ta !== 'string' || !g.en.trim() || !g.ta.trim()) continue;
      let id = g.id || `gl.${slugify(g.en)}`;
      let n = 2;
      while (used.has(id) || idIndex.has(id)) id = `gl.${slugify(g.en)}-${n++}`;
      used.add(id);
      const entry = { id, en: g.en.trim(), ta: g.ta.trim(), note: g.note ? String(g.note) : null, sample: true };
      if (register(id, 'glossary', 'sample-unapproved', 'sample-unapproved', entry, { en: entry.en, ta: entry.ta })) glossary.push(entry);
    }
  }

  // ---- concept notes ---------------------------------------------------------------
  const conceptsJson = load('knowledge/concepts.json', { optional: true });
  const concepts = [];
  for (const c of itemsOf(conceptsJson)) {
    const problems = conceptProblems(c);
    if (problems.length) {
      warn(`concept ${c && c.id} dropped: ${problems.join('; ')}`);
      continue;
    }
    const approved = c.provenance === 'approved' && !!c.approvedBy && !!c.approvedOn;
    if (!approved && !allowSample) continue; // sample notes are off in production by default
    let conceptRef = c.conceptRef || null;
    if (conceptRef && !resourceById.has(conceptRef)) {
      warn(`concept ${c.id}: conceptRef ${conceptRef} is not a published material, set to null`);
      conceptRef = null;
    }
    const relatedMaterials = (Array.isArray(c.relatedMaterials) ? c.relatedMaterials : []).filter((id) => {
      const ok = resourceById.has(id);
      if (!ok) warn(`concept ${c.id}: related material ${id} not found, dropped`);
      return ok;
    });
    const entry = {
      ...c,
      provenance: approved ? 'approved' : 'sample-unapproved',
      conceptRef,
      relatedMaterials,
      terms: Array.isArray(c.terms) ? c.terms : [],
      keywords: c.keywords || { en: [], ta: [] }
    };
    if (register(entry.id, 'concept', entry.provenance, entry.provenance, entry, entry.title)) concepts.push(entry);
  }
  concepts.sort((a, b) => topicRank(a.topic) - topicRank(b.topic) || a.id.localeCompare(b.id));

  // ---- phrasebooks + lexicon (the engine's voice; not syllabus content) ----------
  const phrasebook = {
    en: load('knowledge/phrasebook.en.json', { optional: true }) || { frames: {}, fixed: {} },
    ta: load('knowledge/phrasebook.ta.json', { optional: true }) || { frames: {}, fixed: {} }
  };
  const lexicon = load('knowledge/lexicon.json', { optional: true }) || {};

  hash.update(`allowSample=${allowSample ? 1 : 0}`);
  const version = 'k-' + hash.digest('hex').slice(0, 12);

  const knowledge = {
    version,
    allowSample: !!allowSample,
    files,
    sitePages,
    sitePageById,
    faq,
    resources,
    resourceById,
    videos,
    diagrams,
    bank,
    questionTypes,
    glossary,
    concepts,
    conceptById: new Map(concepts.map((c) => [c.id, c])),
    phrasebook,
    lexicon,
    idIndex,
    warnings,
    counts: {
      sitePages: sitePages.length,
      faq: faq.length,
      resources: resources.length,
      videos: { approved: videos.approved.length, sample: videos.sample.length },
      diagrams: { approved: diagrams.approved.length, sample: diagrams.sample.length },
      bank: { approved: bank.approved.length, sample: bank.sample.length },
      glossary: glossary.length,
      concepts: {
        total: concepts.length,
        approved: concepts.filter((c) => c.provenance === 'approved').length,
        sample: concepts.filter((c) => c.provenance !== 'approved').length
      },
      phrasebook: {
        en: Object.keys(phrasebook.en.frames || {}).length,
        ta: Object.keys(phrasebook.ta.frames || {}).length
      }
    }
  };
  // Maps are not frozen by deepFreeze; they are never mutated after boot.
  return deepFreeze(knowledge);
}

function topicRank(topic) {
  const i = TOPIC_ORDER.indexOf(topic);
  return i === -1 ? 999 : i;
}

// Schema check for one concept note. Returns a list of problems (empty = ok).
export function conceptProblems(c) {
  const p = [];
  if (!c || typeof c !== 'object') return ['not an object'];
  if (typeof c.id !== 'string' || !/^concept\.[a-z0-9-]+$/.test(c.id)) p.push('id must look like concept.<slug>');
  if (typeof c.topic !== 'string' || !c.topic) p.push('topic missing');
  if (!nonEmptyBi(c.title)) p.push('title.en/title.ta missing');
  if (!nonEmptyBi(c.definition)) p.push('definition.en/definition.ta missing');
  const kp = c.keyPoints;
  if (!Array.isArray(kp) || kp.length < 2 || kp.length > 4 || !kp.every(nonEmptyBi)) p.push('keyPoints must be 2-4 bilingual items');
  const ex = c.example;
  if (!ex || !nonEmptyBi(ex.prompt) || !nonEmptyBi(ex.answer) || !ex.steps || !Array.isArray(ex.steps.en) || !Array.isArray(ex.steps.ta) || ex.steps.en.length !== ex.steps.ta.length || ex.steps.en.length === 0) {
    p.push('example needs prompt, answer and matching en/ta steps');
  }
  const mi = c.mistake;
  if (!mi || !nonEmptyBi(mi.claim) || !nonEmptyBi(mi.correction)) p.push('mistake needs claim and correction');
  if (!c.keywords || !Array.isArray(c.keywords.en) || !Array.isArray(c.keywords.ta) || !c.keywords.en.length || !c.keywords.ta.length) p.push('keywords.en and keywords.ta needed');
  if (c.simple !== undefined && !nonEmptyBi(c.simple)) p.push('simple must be bilingual when present');
  if (c.terms !== undefined) {
    if (!Array.isArray(c.terms)) p.push('terms must be a list');
    else
      c.terms.forEach((t, i) => {
        if (!t || typeof t.term !== 'string' || !nonEmptyBi(t.definition)) p.push(`terms[${i}] needs term and bilingual definition`);
      });
  }
  if (!c.source || typeof c.source !== 'object') p.push('source (who wrote it) missing');
  if (!['approved', 'sample-unapproved'].includes(c.provenance)) p.push('provenance must be approved or sample-unapproved');
  return p;
}
