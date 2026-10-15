// IRUSHY local engine - composers (one per answer shape).
//
// A composer writes into a Draft: text blocks with a priority (0 = must keep,
// 1..3 = may be dropped, highest first, to meet the length target), the ids
// it relied on, verified site-page links, attachments and follow-up
// suggestions. All wording comes from the phrasebook (voice.say / fixed);
// all facts come from data/ (FAQ, materials, concept notes, banks). The
// composer never writes a URL into the text and never invents a source.

import { pick, normalize, contentTokens, overlapScore, hasTamil, tokenize } from '../lang.js';
import { matchGlossary } from './match.js';
import { classOf, subjectOf, mediumOf, materialWords, lessonNumber } from './intent.js';
import {
  pickPractice,
  resolvePracticeRef,
  checkAttempt,
  answerText,
  explanationText,
  conceptForPractice
} from './questions.js';
import { coverageReport, buildPaper, paperSpecFromText } from '../paper.js';

const cite = (id) => ` [${id}]`;
const NEET_SUBJECTS = /physics|chemistry|biology|botany|zoology|photosynthesis|cell biology|periodic table|இயற்பியல்|வேதியியல்|உயிரியல்|தாவரவியல்|விலங்கியல்|ஒளிச்சேர்க்கை/i;
const stripParen = (s) => String(s).replace(/\s*\([^)]*\)\s*$/, '').trim();

export class Draft {
  constructor() {
    this.blocks = [];
    this.used = new Set();
    this.links = [];
    this.attachments = [];
    this.suggestions = [];
    this.flags = new Set();
    this.composer = null;
  }
  add(text, priority = 0) {
    if (text && String(text).trim()) this.blocks.push({ text: String(text), priority });
    return this;
  }
  use(id) {
    if (id) this.used.add(id);
    return this;
  }
  link(id) {
    if (id && !this.links.includes(id)) this.links.push(id);
    return this;
  }
  suggest(s) {
    if (this.suggestions.length < 4 && !this.suggestions.some((x) => x.label === s.label)) this.suggestions.push(s);
    return this;
  }
  flag(name) {
    this.flags.add(name);
    return this;
  }
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------
function capFirst(s) {
  return /^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s;
}

// "operating system" for Operating systems, "database" for Database / SQL.
function termIsTopic(term, concept) {
  const topicWords = new Set(tokenize(`${concept.topic} ${concept.title.en}`));
  const termWords = tokenize(term.term);
  return termWords.length > 0 && termWords.every((w) => topicWords.has(w));
}

function topicTitle(concept, lang) {
  return pick(concept.title, lang);
}

function shortTopic(concept, lang) {
  return stripParen(pick(concept.title, lang));
}

function topicList(ctx, n = 6) {
  const list = ctx.knowledge.concepts.slice(0, n).map((c) => shortTopic(c, ctx.lang));
  return list.join(', ');
}

export function resolveConcept(ctx) {
  const t = ctx.cls.signals.topic;
  if (t && t.score >= 1) return { concept: t.concept, term: t.term, via: 'message' };
  const st = ctx.cls.signals.state;
  if (st.conceptId && ctx.knowledge.conceptById.has(st.conceptId)) {
    return { concept: ctx.knowledge.conceptById.get(st.conceptId), term: null, via: st.conceptVia };
  }
  const topic = ctx.context && typeof ctx.context.topic === 'string' ? ctx.context.topic : null;
  if (topic) {
    const c = ctx.knowledge.concepts.find((x) => normalize(x.topic) === normalize(topic));
    if (c) return { concept: c, term: null, via: 'context' };
  }
  return null;
}

function followups(ctx, d, { simpler = true, example = true, similar = true } = {}) {
  const v = ctx.voice;
  if (simpler) d.suggest({ action: 'explain_more_simply', label: v.fixed('label.simpler'), prompt: v.fixed('prompt.simpler') });
  if (example) d.suggest({ action: 'show_example', label: v.fixed('label.example'), prompt: v.fixed('prompt.example') });
  if (similar) d.suggest({ action: 'try_similar', label: v.fixed('label.similar'), prompt: v.fixed('prompt.similar') });
}

function starterSuggestions(ctx, d) {
  const v = ctx.voice;
  d.suggest({ label: v.fixed('label.materials'), prompt: v.fixed('prompt.materials') });
  d.suggest({ label: v.fixed('label.oneWordTest'), prompt: v.fixed('prompt.oneWordTest') });
  const first = ctx.knowledge.concepts[0];
  if (first) d.suggest({ label: v.fixed('label.explainTopic', { topic: shortTopic(first, ctx.lang) }), prompt: v.fixed('prompt.explainTopic', { topic: shortTopic(first, ctx.lang) }) });
}

function materialFor(ctx, concept) {
  const k = ctx.knowledge;
  const ids = [concept.conceptRef, ...(concept.relatedMaterials || [])].filter(Boolean);
  if (!ids.length) return null;
  const medium = mediumOf(ctx.message, ctx.context || {}, true) || (ctx.lang === 'ta' ? 'Tamil Medium' : null);
  const mats = ids.map((id) => k.resourceById.get(id)).filter(Boolean);
  return mats.find((m) => medium && m.medium === medium) || mats[0] || null;
}

function addSourceLine(ctx, d, concept, priority) {
  const m = materialFor(ctx, concept);
  if (!m) return false;
  d.add(ctx.voice.say('source.material', { title: pick(m.title, ctx.lang), id: m.id }) , priority);
  d.link('nav.materials');
  return true;
}

function orderedPoints(concept, term, lang) {
  const pts = concept.keyPoints.map((p) => pick(p, lang));
  if (!term) return pts;
  const words = [term.term, ...(term.aliases || [])].map((w) => normalize(w));
  const hit = (p) => words.some((w) => normalize(p).includes(w));
  return [...pts.filter(hit), ...pts.filter((p) => !hit(p))];
}

function addMisconception(ctx, d, concept, priority) {
  const v = ctx.voice;
  const lang = ctx.lang;
  d.add(
    `${v.say('misconception.lead')} ${v.say('misconception.claim', { claim: pick(concept.mistake.claim, lang) })} ${v.say('misconception.fix', {
      correction: pick(concept.mistake.correction, lang)
    })}`,
    priority
  );
}

function addWorkedExample(ctx, d, concept, priority, { withLead = true } = {}) {
  const v = ctx.voice;
  const lang = ctx.lang;
  const ex = concept.example;
  if (withLead) d.add(v.say('example.lead'), priority);
  d.add(v.say('example.question', { prompt: pick(ex.prompt, lang) }), priority);
  if (Array.isArray(ex.code) && ex.code.length) {
    d.add(v.say('example.code.lead'), priority);
    d.add(ex.code.map((line) => `    ${line}`).join('\n'), priority);
  }
  d.add(v.say('example.steps.lead'), priority);
  ex.steps[lang].forEach((s, i) => d.add(v.say('example.step', { n: i + 1, text: s }), priority));
  d.add(v.say('example.answer', { answer: pick(ex.answer, lang) }), priority);
}

// Visuals: a diagram is attached to explanations and examples when one
// exists for the topic; a video only when the visitor asked for a visual.
function addVisuals(ctx, d, concept, { explicit = false, wantsVideo = false } = {}) {
  const k = ctx.knowledge;
  const v = ctx.voice;
  const lang = ctx.lang;
  const diagrams = [...k.diagrams.approved, ...k.diagrams.sample].filter((x) => x.topic === concept.topic);
  const videosAll = [...k.videos.approved, ...k.videos.sample].filter((x) => x.topic === concept.topic);
  const videos = [...videosAll.filter((x) => x.language === lang), ...videosAll.filter((x) => x.language !== lang)];
  const added = [];
  if (diagrams.length) {
    const dg = diagrams[0];
    d.attachments.push({
      type: 'diagram',
      id: dg.id,
      title: pick(dg.title, lang),
      caption: pick(dg.caption, lang),
      svg: dg.svg,
      label: dg.sample ? { en: v.fixedIn('en', 'label.sampleDiagram'), ta: v.fixedIn('ta', 'label.sampleDiagram') } : null,
      provenance: dg.sample ? 'sample-unapproved' : 'approved'
    });
    d.use(dg.id);
    added.push(dg);
  }
  if ((explicit || wantsVideo) && videos.length) {
    const vd = videos[0];
    d.attachments.push({
      type: 'video',
      id: vd.id,
      title: pick(vd.title, lang),
      url: vd.url,
      channel: vd.channel,
      contentReviewed: vd.contentReviewed,
      label: vd.sample ? { en: v.fixedIn('en', 'label.sampleVideo'), ta: v.fixedIn('ta', 'label.sampleVideo') } : null,
      provenance: vd.sample ? 'sample-unapproved' : 'approved'
    });
    d.use(vd.id);
    added.push(vd);
  }
  const topic = shortTopic(concept, lang);
  if (added.length) {
    const ids = added.map((x) => `[${x.id}]`).join(' ');
    d.add(v.say(added.some((x) => x.sample) ? 'visual.sampleAttached' : 'visual.approvedAttached', { ids }), explicit ? 0 : 2);
    if (added.some((x) => x.url)) d.add(v.say('visual.videoClick'), explicit ? 0 : 2);
    if ((explicit || wantsVideo) && !videos.length) d.add(v.say('visual.noVideo', { topic }), 1);
  } else if (explicit) {
    d.add(v.say('visual.none', { topic }), 0);
  }
}

function whichTopic(ctx, d, frame) {
  const v = ctx.voice;
  d.composer = 'which-topic';
  d.add(v.say(frame));
  d.add(v.say('unknown.offer', { topics: topicList(ctx) }));
  starterSuggestions(ctx, d);
  d.flag('general');
}

// ---------------------------------------------------------------------------
// small talk and identity
// ---------------------------------------------------------------------------
export function greeting(ctx, d) {
  d.composer = 'greeting';
  d.add(ctx.voice.say('greeting.reply'));
  d.add(ctx.voice.say('greeting.offer'));
  starterSuggestions(ctx, d);
  d.flag('general');
}

export function thanks(ctx, d) {
  d.composer = 'thanks';
  d.add(ctx.voice.say('thanks.reply'));
  d.add(ctx.voice.say('thanks.more'));
  d.flag('general');
}

export function farewell(ctx, d) {
  d.composer = 'farewell';
  d.add(ctx.voice.say('farewell.reply'));
  d.flag('general');
}

export function identity(ctx, d) {
  d.composer = 'identity';
  const f = ctx.knowledge.faq.find((x) => x.id === 'faq.what-is-irushy');
  if (f) d.add(pick(f.answer, ctx.lang) + cite(f.id));
  else d.add(ctx.voice.say('identity.lead'));
  d.add(ctx.voice.say('identity.engine'), 1);
  starterSuggestions(ctx, d);
}

// ---------------------------------------------------------------------------
// website help (verified FAQ)
// ---------------------------------------------------------------------------
const RELATED_FAQ = {
  'faq.find-materials': ['faq.one-word-test', 'faq.student-registration'],
  'faq.one-word-test': ['faq.find-materials', 'faq.student-registration'],
  'faq.teacher-registration': ['faq.sign-in', 'faq.teacher-section'],
  'faq.student-registration': ['faq.one-word-test', 'faq.sign-in'],
  'faq.sign-in': ['faq.teacher-registration', 'faq.student-registration'],
  'faq.neet': ['faq.sign-in', 'faq.find-materials'],
  'faq.teacher-section': ['faq.teacher-registration', 'faq.student-registration'],
  'faq.contact': ['faq.what-is-site', 'faq.privacy'],
  'faq.what-is-site': ['faq.find-materials', 'faq.one-word-test'],
  'faq.language': ['faq.what-is-irushy', 'faq.find-materials'],
  'faq.what-is-irushy': ['faq.privacy', 'faq.language'],
  'faq.privacy': ['faq.what-is-irushy', 'faq.contact']
};

export function websiteHelp(ctx, d) {
  d.composer = 'website-help';
  const k = ctx.knowledge;
  const forced = ctx.cls.signals.faqId;
  const f = (forced && k.faq.find((x) => x.id === forced)) || (ctx.cls.signals.faq && ctx.cls.signals.faq.faq);
  if (!f) return unknown(ctx, d);
  const v = ctx.voice;
  d.add(v.say('website.lead'), 2);
  d.add(pick(f.answer, ctx.lang) + cite(f.id));
  for (const l of f.links) d.link(l.id);
  if (f.links.length) d.add(v.say('website.link'), 2);
  for (const rid of RELATED_FAQ[f.id] || []) {
    const r = k.faq.find((x) => x.id === rid);
    if (r) d.suggest({ label: pick(r.question, ctx.lang), prompt: pick(r.question, ctx.lang) });
  }
}

// ---------------------------------------------------------------------------
// materials (approved, published)
// ---------------------------------------------------------------------------
const STUDY_WORDS = /lesson|chapter|practical|book\s*back|question|answer|material|python|network|syllabus|evaluat|one\s*word|marks?|slow|minimum|presentation|ppt|function|class|object|programs?/i;

function subjectName(v, subject) {
  const key = { 'Computer Science': 'subject.cs', 'Computer Applications': 'subject.ca', 'Computer Technology': 'subject.ct', 'General Instructions': 'subject.gi' }[subject];
  return key ? v.fixed(key) : subject || '';
}

function mediumName(v, medium) {
  const key = { 'Tamil Medium': 'medium.tm', 'English Medium': 'medium.em' }[medium];
  return key ? v.fixed(key) : medium || '';
}

export function materials(ctx, d) {
  d.composer = 'materials';
  const k = ctx.knowledge;
  const v = ctx.voice;
  const lang = ctx.lang;
  const raw = ctx.message;
  const filters = {
    class: classOf(raw, ctx.context || {}),
    subject: subjectOf(raw, ctx.context || {}),
    medium: mediumOf(raw, ctx.context || {}, false),
    types: materialWords(raw),
    lesson: lessonNumber(raw)
  };
  const topicHit = ctx.cls.signals.topic && ctx.cls.signals.topic.score >= 1 ? ctx.cls.signals.topic.concept : null;
  // Material titles on the site are English, so only English words can match
  // a title; class / subject / medium are already applied as filters above
  // (in either language).
  const qTokens = contentTokens(raw).filter(
    (t) => !hasTamil(t) && !/^(material|note|pdf|download|study|11th|12th|11|12|class|medium|tamil|english|computer|science|application|technology|cs|ca|ct|give|send|list|need|want|share|any|book|plus|one|two|xi|xii)$/.test(t)
  );

  const scored = [];
  for (const m of k.resources) {
    if (filters.class && m.class !== filters.class) continue;
    if (filters.subject && m.subject !== filters.subject) continue;
    if (filters.medium && m.medium !== filters.medium) continue;
    const title = `${m.title.en} ${m.topic || ''}`;
    let score = 0;
    for (const t of filters.types) {
      const re = { practical: /practical/i, 'book back': /book\s*back/i, 'one word': /one\s*word|one\s*mark/i, 'question paper': /question\s*paper/i, 'answer key': /answer\s*key|key\s*answer|answerkey/i, syllabus: /syllabus/i, 'slow learners': /slow|minimum|mlm/i, 'question bank': /question\s*bank/i, evaluation: /evaluat|evaluvat/i, presentation: /ppt|presentation|power\s*point/i, lesson: /lesson|chapter/i, '5 marks': /5\s*marks?|five/i }[t];
      if (re && re.test(title)) score += 3;
    }
    if (filters.lesson && new RegExp(`(?:lesson|chapter)\\D{0,3}(?:\\d+\\s*(?:-|to)\\s*)?${filters.lesson}\\b`, 'i').test(title)) score += 4;
    if (topicHit && [topicHit.conceptRef, ...(topicHit.relatedMaterials || [])].includes(m.id)) score += 5;
    if (qTokens.length) score += 2 * overlapScore(qTokens, title);
    if (STUDY_WORDS.test(m.title.en)) score += 0.5;
    // A Tamil question with no medium named: Tamil-medium files first (tie-break only).
    if (!filters.medium && lang === 'ta' && m.medium === 'Tamil Medium') score += 0.3;
    const wanted = filters.types.length || filters.lesson || topicHit || qTokens.length;
    if (wanted && score < 1) continue;
    scored.push({ m, score });
  }
  scored.sort((a, b) => b.score - a.score || a.m.class - b.m.class || String(a.m.subject).localeCompare(String(b.m.subject)) || a.m.id.localeCompare(b.m.id));

  d.link('nav.materials');
  if (!scored.length) {
    d.add(v.say('materials.none'));
    const f = k.faq.find((x) => x.id === 'faq.find-materials');
    if (f) d.add(pick(f.answer, lang) + cite(f.id), 1);
    d.suggest({ label: v.fixed('label.materials'), prompt: v.fixed('prompt.materials') });
    return;
  }
  const shown = scored.slice(0, 5);
  d.add(v.say('materials.lead'));
  for (const { m } of shown) {
    d.add(
      v.say('materials.item', {
        title: pick(m.title, lang),
        cls: v.fixed('class.n', { n: m.class }),
        subject: subjectName(v, m.subject),
        medium: mediumName(v, m.medium),
        id: m.id
      })
    );
  }
  if (scored.length > shown.length) d.add(v.say('materials.more', { n: scored.length - shown.length }), 1);
  const f = k.faq.find((x) => x.id === 'faq.find-materials');
  d.add(v.say('materials.howto') + (f ? cite(f.id) : ''), 0);
  if (topicHit) d.suggest({ label: v.fixed('label.explainTopic', { topic: shortTopic(topicHit, lang) }), prompt: v.fixed('prompt.explainTopic', { topic: shortTopic(topicHit, lang) }) });
}

// ---------------------------------------------------------------------------
// topics (concept notes)
// ---------------------------------------------------------------------------
export function explanation(ctx, d) {
  const r = resolveConcept(ctx);
  if (!r) return whichTopic(ctx, d, 'unknown.whichTopic');
  d.composer = 'explanation';
  const { concept, term } = r;
  const v = ctx.voice;
  const lang = ctx.lang;
  const sig = ctx.cls.signals;
  d.add(v.say('explain.opener', { topic: topicTitle(concept, lang) }));
  // Focus on a named term only when it is a part of the topic ("binary" in
  // Number systems), not the topic itself ("computer network").
  if (term && r.via === 'message' && !termIsTopic(term, concept)) {
    d.add(v.say('explain.termFocus', { term: capFirst(term.term), definition: pick(term.definition, lang) }) + cite(concept.id));
    d.add(pick(concept.definition, lang), 2);
  } else {
    d.add(pick(concept.definition, lang) + cite(concept.id));
  }
  d.add(v.say('explain.keypoints.lead'));
  orderedPoints(concept, term, lang).forEach((p, i) => d.add(v.say('explain.step', { n: i + 1, text: p }), i < 2 ? 0 : i === 2 ? 1 : 2));
  if (sig.includeExample) addWorkedExample(ctx, d, concept, 1);
  else addMisconception(ctx, d, concept, 2);
  addVisuals(ctx, d, concept, { explicit: sig.wantsVisual, wantsVideo: sig.wantsVideo });
  addSourceLine(ctx, d, concept, 1);
  d.add(v.say('next.followup'), 3);
  followups(ctx, d);
}

export function definition(ctx, d) {
  const r = resolveConcept(ctx);
  if (!r) return whichTopic(ctx, d, 'unknown.whichTopic');
  d.composer = 'definition';
  const { concept, term } = r;
  const v = ctx.voice;
  const lang = ctx.lang;
  if (term && r.via === 'message') {
    d.add(v.say('definition.lead', { term: term.term }));
    d.add(pick(term.definition, lang) + cite(concept.id));
    d.add(v.say('definition.context', { topic: shortTopic(concept, lang) }), 1);
  } else {
    d.add(v.say('definition.topicLead', { topic: topicTitle(concept, lang) }));
    d.add(pick(concept.definition, lang) + cite(concept.id));
    d.add(pick(concept.keyPoints[0], lang), 2);
  }
  addSourceLine(ctx, d, concept, 2);
  d.add(v.say('next.followup'), 3);
  followups(ctx, d);
}

export function procedure(ctx, d) {
  const r = resolveConcept(ctx);
  if (!r) return whichTopic(ctx, d, 'unknown.whichTopic');
  d.composer = 'procedure';
  const { concept } = r;
  const v = ctx.voice;
  const lang = ctx.lang;
  const q = contentTokens(ctx.message);
  // The key point that best matches the question is the method.
  let best = null;
  concept.keyPoints.forEach((p, i) => {
    const s = overlapScore(q, `${p.en} ${p.ta}`);
    if (!best || s > best.s) best = { i, s };
  });
  const ex = concept.example;
  const exScore = overlapScore(q, `${ex.prompt.en} ${ex.prompt.ta} ${ex.steps.en.join(' ')}`);
  d.add(v.say('procedure.lead', { topic: shortTopic(concept, lang) }));
  d.add(v.say('procedure.method', { text: pick(concept.keyPoints[best.i], lang) }) + cite(concept.id));
  if (exScore >= 0.34) {
    addWorkedExample(ctx, d, concept, 1);
  } else {
    d.add(v.say('procedure.exampleOffer', { prompt: pick(ex.prompt, lang) }), 2);
  }
  addMisconception(ctx, d, concept, 3);
  addSourceLine(ctx, d, concept, 2);
  followups(ctx, d, { simpler: true, example: exScore < 0.34, similar: true });
}

export function simpler(ctx, d) {
  const r = resolveConcept(ctx);
  if (!r) return whichTopic(ctx, d, 'unknown.whichTopic');
  d.composer = 'simpler';
  const { concept } = r;
  const v = ctx.voice;
  const lang = ctx.lang;
  d.add(v.say('simpler.opener'));
  if (concept.simple) d.add(pick(concept.simple, lang) + cite(concept.id));
  else d.add(pick(concept.keyPoints[0], lang) + cite(concept.id));
  const firstSentence = pick(concept.definition, lang).split(/(?<=[.!?])\s+/)[0];
  d.add(v.say('simpler.core', { text: firstSentence }), 1);
  d.add(v.say('next.afterSimpler'), 3);
  followups(ctx, d, { simpler: false });
}

export function example(ctx, d) {
  const r = resolveConcept(ctx);
  if (!r) return whichTopic(ctx, d, 'unknown.whichTopicExample');
  d.composer = 'example';
  const { concept } = r;
  const v = ctx.voice;
  d.add(v.say('example.lead') + cite(concept.id));
  addWorkedExample(ctx, d, concept, 0, { withLead: false });
  addVisuals(ctx, d, concept, { explicit: ctx.cls.signals.wantsVisual, wantsVideo: ctx.cls.signals.wantsVideo });
  d.add(v.say('next.afterExample'), 3);
  followups(ctx, d, { example: false });
}

// ---------------------------------------------------------------------------
// practice questions
// ---------------------------------------------------------------------------
function presentPractice(ctx, d, concept, picked) {
  const v = ctx.voice;
  const lang = ctx.lang;
  if (picked.source === 'bank') {
    const q = picked.question;
    d.add(v.say(q.sample ? 'practice.lead.sampleBank' : 'practice.lead.bank', { topic: shortTopic(concept, lang) }));
    d.add(pick(q.question, lang) + cite(q.id));
    if (lang === 'ta' && !q.questionHasTa) d.add(v.fixed('question.englishOnly'));
    if (Array.isArray(q.options) && q.options.length) {
      d.add(v.say('practice.options.lead'));
      for (const o of q.options) d.add(v.fixed('practice.option', { key: o.key, text: pick(o.text, lang) }));
    }
    d.add(v.fixed('practice.ref', { ref: q.id }));
    if (q.sample) d.add(v.say('practice.bank.sampleLabel'));
  } else {
    const it = picked.item;
    d.add(v.say('practice.lead.generated', { topic: shortTopic(concept, lang) }));
    if (it.kind === 'true_false') d.add(v.say('practice.tf.prompt', { claim: pick(it.prompt, lang) }) + cite(concept.id));
    else if (it.kind === 'worked') d.add(v.say('practice.example.prompt', { prompt: pick(it.prompt, lang) }) + cite(concept.id));
    else d.add(v.say('practice.term.prompt', { term: it.term }) + cite(concept.id));
    d.add(v.fixed('practice.ref', { ref: it.id }));
    d.add(v.say('practice.generated.label'));
    d.flag('generated');
  }
  d.add(v.say('practice.instructions'), 1);
  d.suggest({ label: v.fixed('label.showAnswer'), prompt: v.fixed('prompt.showAnswer') });
  d.suggest({ action: 'try_similar', label: v.fixed('label.similar'), prompt: v.fixed('prompt.similar') });
}

export function practiceQuestion(ctx, d) {
  let r = resolveConcept(ctx);
  // After a practice question, "similar" means the same topic.
  const st = ctx.cls.signals.state;
  if (!r && st.practiceRef) {
    const c = conceptForPractice(ctx.knowledge, resolvePracticeRef(ctx.knowledge, st.practiceRef));
    if (c) r = { concept: c, term: null, via: 'history-practice-ref' };
  }
  if (!r) return whichTopic(ctx, d, 'practice.whichTopic');
  d.composer = 'practice-question';
  const exclude = [...st.shownPractice];
  // a question the visitor got wrong in a returned test is not repeated
  if (ctx.context && typeof ctx.context.questionId === 'string') exclude.push(ctx.context.questionId);
  const medium = mediumOf(ctx.message, ctx.context || {}, true) || (ctx.context && ctx.context.medium) || null;
  let picked = pickPractice(ctx.knowledge, r.concept, { exclude, seed: ctx.seed, medium, lang: ctx.lang });
  if (!picked) {
    d.add(ctx.voice.say('practice.exhausted', { topic: shortTopic(r.concept, ctx.lang) }), 1);
    picked = pickPractice(ctx.knowledge, r.concept, { exclude: [], seed: ctx.seed, medium, lang: ctx.lang });
  }
  presentPractice(ctx, d, r.concept, picked);
}

export function practiceAnswer(ctx, d) {
  d.composer = 'practice-answer';
  const v = ctx.voice;
  const lang = ctx.lang;
  const ref = ctx.cls.signals.state.practiceRef;
  const resolved = ref ? resolvePracticeRef(ctx.knowledge, ref) : null;
  if (!resolved || resolved.source === 'reserved') {
    d.add(v.say(resolved ? 'practice.reserved' : 'practice.none'));
    d.add(v.say('unknown.offer', { topics: topicList(ctx) }), 2);
    d.flag('general');
    return;
  }
  const concept = conceptForPractice(ctx.knowledge, resolved);
  const id = resolved.source === 'bank' ? resolved.question.id : null;
  const citeId = id || (concept ? concept.id : null);
  const verdict = ctx.cls.signals.reveal ? 'reveal' : checkAttempt(resolved, ctx.message);
  if (verdict === 'correct') d.add(v.say('practice.correct'));
  else if (verdict === 'incorrect') d.add(v.say('practice.incorrect'));
  else if (verdict === 'self-check') d.add(v.say('practice.selfcheck'));
  d.add(v.say('practice.answer', { answer: answerText(resolved, lang) }) + (citeId ? cite(citeId) : ''));
  const why = explanationText(resolved, lang);
  if (why) d.add(v.say('practice.explanation', { text: why }), 1);
  if (resolved.source === 'generated') {
    d.add(v.say('practice.generated.label'));
    d.flag('generated');
  } else if (resolved.question.sample) {
    d.add(v.say('practice.bank.sampleLabel'));
  }
  d.add(v.say('next.afterPractice'), 3);
  d.suggest({ action: 'try_similar', label: v.fixed('label.similar'), prompt: v.fixed('prompt.similar') });
  if (concept) d.suggest({ label: v.fixed('label.explainTopic', { topic: shortTopic(concept, lang) }), prompt: v.fixed('prompt.explainTopic', { topic: shortTopic(concept, lang) }) });
}

// ---------------------------------------------------------------------------
// completed-test mistake explanation (only reached with a verified,
// completed assessment token - the route enforces that)
// ---------------------------------------------------------------------------
function clip(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

export function mistake(ctx, d) {
  d.composer = 'mistake';
  const k = ctx.knowledge;
  const v = ctx.voice;
  const lang = ctx.lang;
  const c = ctx.context || {};
  const question = clip(c.question, 300);
  const selected = clip(c.selectedAnswer, 120) || '-';
  const correct = clip(c.correctAnswer, 120) || '-';
  const bankQ = typeof c.questionId === 'string' ? k.idIndex.get(c.questionId) : null;
  const bank = bankQ && bankQ.kind === 'question' ? bankQ.entry : null;
  let concept = null;
  if (typeof c.topic === 'string') concept = k.concepts.find((x) => normalize(x.topic) === normalize(c.topic)) || null;
  if (!concept && bank) concept = k.concepts.find((x) => x.topic === bank.topic) || null;
  if (!concept) {
    const m = ctx.cls.signals.topic && ctx.cls.signals.topic.score >= 1 ? ctx.cls.signals.topic : null;
    concept = m ? m.concept : null;
  }
  if (!concept && question) {
    const r = ctx.matchTopic(question);
    if (r.best && r.best.score >= 1) concept = r.best.concept;
  }

  d.add(v.say('mistake.opener'));
  if (question) d.add(v.say('mistake.question', { question }));
  d.add(v.say('mistake.compare', { selected, correct }) + (bank ? cite(bank.id) : ''));
  let explained = false;
  if (bank && bank.explanation) {
    d.add(v.say('mistake.why', { text: pick(bank.explanation, lang) }));
    explained = true;
  }
  if (concept) {
    if (!explained) d.add(v.say('mistake.concept', { text: pick(concept.definition, lang) }) + cite(concept.id));
    else d.add(v.say('mistake.concept', { text: pick(concept.keyPoints[0], lang) }) + cite(concept.id), 1);
    d.add(`${v.say('misconception.lead')} ${pick(concept.mistake.correction, lang)}`, 2);
    explained = true;
  }
  if (!explained) d.add(v.say('mistake.noExplanation'));

  // conceptRef from the test page must be a real published material
  const refId = typeof c.conceptRef === 'string' && k.resourceById.has(c.conceptRef) ? c.conceptRef : null;
  const mat = refId ? k.resourceById.get(refId) : concept ? materialFor(ctx, concept) : null;
  if (mat) {
    d.add(v.say('mistake.revise', { title: pick(mat.title, lang), id: mat.id }));
    d.link('nav.materials');
  } else {
    d.add(v.say('mistake.noMaterial'), 1);
  }
  if (concept) {
    d.suggest({ action: 'try_similar', label: v.fixed('label.similar'), prompt: v.fixed('prompt.similar') });
    d.suggest({ label: v.fixed('label.explainTopic', { topic: shortTopic(concept, lang) }), prompt: v.fixed('prompt.explainTopic', { topic: shortTopic(concept, lang) }) });
  }
}

// ---------------------------------------------------------------------------
// teacher tools
// ---------------------------------------------------------------------------
export function teacherPaper(ctx, d) {
  d.composer = 'teacher-paper';
  const v = ctx.voice;
  const lang = ctx.lang;
  const k = ctx.knowledge;
  if (ctx.mode !== 'teacher') {
    d.add(v.say('teacher.needSignIn'));
    d.link('nav.teacher-registration');
    d.flag('general');
    return;
  }
  const spec = paperSpecFromText(ctx.message, k, ctx.context || {});
  const approved = buildPaper(k, { ...spec, useSample: false }, { allowSample: false });
  const requested = approved.coverage.requested;
  const available = approved.coverage.available;
  d.add(v.say('teacher.paper.lead'));
  d.add(v.say('teacher.paper.requested', { summary: approved.coverage.summary[lang] }));
  if (available === 0) d.add(v.say('teacher.paper.empty'));
  else d.add(v.say('teacher.paper.available', { available, requested }));
  if (approved.coverage.gaps.length) {
    d.add(v.say('teacher.paper.gaps', { gaps: approved.coverage.gaps.map((g) => g.text[lang]).join('; ') }), 1);
  }
  if (k.allowSample) {
    const sample = buildPaper(k, { ...spec, useSample: true }, { allowSample: true });
    const extra = sample.coverage.available - available;
    if (extra > 0) d.add(v.say('teacher.paper.sampleOption', { n: extra }), 1);
  }
  d.add(v.say('teacher.paper.builder'), 1);
  d.add(v.say('teacher.paper.never'), 2);
  for (const q of approved.paper.sections.flatMap((s) => s.questions)) d.use(q.id);
  d.suggest({ label: v.fixed('label.coverage'), prompt: v.fixed('prompt.coverage') });
}

export function coverage(ctx, d) {
  d.composer = 'coverage';
  const v = ctx.voice;
  const lang = ctx.lang;
  const k = ctx.knowledge;
  const titles = k.concepts.map((c) => shortTopic(c, lang)).join(', ');
  if (k.concepts.length) {
    d.add(v.say('coverage.lead', { n: k.concepts.length, topics: titles }));
    const sampleCount = k.concepts.filter((c) => c.provenance !== 'approved').length;
    if (sampleCount) {
      d.add(v.say('coverage.sampleNote', { n: sampleCount }));
      // cite one note so the answer carries the sample label it needs
      d.use(k.concepts.find((c) => c.provenance !== 'approved').id);
    } else {
      d.add(v.say('coverage.approvedNote'));
    }
  } else {
    d.add(v.say('coverage.none'));
  }
  const f = k.faq.find((x) => x.id === 'faq.find-materials');
  d.add(v.say('coverage.materials', { n: k.resources.length }) + (f ? cite(f.id) : ''));
  d.link('nav.materials');
  if (ctx.mode === 'teacher') {
    const rep = coverageReport(k);
    d.add(v.say('coverage.teacherBank', { approved: rep.approved.total, sample: rep.sample.total }), 1);
    d.add(v.say('coverage.teacherMedia', { videos: k.videos.approved.length, diagrams: k.diagrams.approved.length }), 1);
  }
  starterSuggestions(ctx, d);
}

// ---------------------------------------------------------------------------
// results / privacy, terms, not published
// ---------------------------------------------------------------------------
export function resultsPrivacy(ctx, d) {
  d.composer = 'results-privacy';
  const v = ctx.voice;
  const k = ctx.knowledge;
  const sig = ctx.cls.signals;
  const privacy = k.faq.find((x) => x.id === 'faq.privacy');
  if (sig.results) {
    d.add(v.say('results.unavailable'));
    d.add(v.say('results.why'), 1);
  }
  if (sig.privacy || !sig.results) {
    if (privacy) d.add(pick(privacy.answer, ctx.lang) + cite(privacy.id));
  } else if (privacy) {
    d.add(v.say('results.contact') + cite(privacy.id), 1);
  }
  if (privacy) for (const l of privacy.links) d.link(l.id);
}

export function termHelp(ctx, d) {
  d.composer = 'term-help';
  const v = ctx.voice;
  const lang = ctx.lang;
  const g = matchGlossary(ctx.knowledge, ctx.message);
  const topic = ctx.cls.signals.topic;
  if (g) {
    if (g.side === 'en') d.add(v.say('term.tamil', { en: g.entry.en, ta: g.entry.ta }) + cite(g.entry.id));
    else d.add(v.say('term.english', { en: g.entry.en, ta: g.entry.ta }) + cite(g.entry.id));
    if (lang === 'en' && g.entry.note) d.add(v.fixed('term.note', { note: g.entry.note }), 2);
  } else if (topic && topic.term && topic.term.ta) {
    d.add(v.say('term.fromNote', { en: topic.term.term, ta: topic.term.ta }) + cite(topic.concept.id));
  } else {
    d.add(v.say('term.unknown'));
    d.flag('general');
    return;
  }
  d.add(v.say('term.defer'), 1);
}

export function notPublished(ctx, d) {
  d.composer = 'not-published';
  const v = ctx.voice;
  const f = ctx.knowledge.faq.find((x) => x.id === 'faq.contact');
  d.add(v.say('notPublished.admit'));
  d.add(v.say('notPublished.contact') + (f ? cite(f.id) : ''));
  if (f) for (const l of f.links) d.link(l.id);
}

// ---------------------------------------------------------------------------
// out of scope, abuse, unknown
// ---------------------------------------------------------------------------
export function offTopic(ctx, d) {
  d.composer = 'off-topic';
  const v = ctx.voice;
  if (ctx.cls.signals.otherSubject) {
    d.add(v.say('outOfScope.otherSubject'));
    const neet = ctx.knowledge.faq.find((x) => x.id === 'faq.neet');
    // The NEET pages are only relevant to NEET science subjects.
    if (neet && NEET_SUBJECTS.test(String(ctx.cls.signals.thing || ''))) {
      d.add(v.say('outOfScope.neet') + cite(neet.id), 1);
      for (const l of neet.links) d.link(l.id);
    }
  } else {
    d.add(v.say('outOfScope.redirect'));
  }
  d.add(v.say('unknown.offer', { topics: topicList(ctx) }), 2);
  starterSuggestions(ctx, d);
  d.flag('general');
}

export function abuse(ctx, d) {
  d.composer = ctx.cls.signals.probe ? 'probe' : 'abuse';
  const v = ctx.voice;
  if (ctx.cls.signals.probe) d.add(v.say('probe.reply'));
  else d.add(v.say('abuse.calm'));
  d.add(v.say('abuse.redirect'));
  starterSuggestions(ctx, d);
  d.flag('general');
}

export function unknown(ctx, d) {
  d.composer = 'unknown';
  const v = ctx.voice;
  d.add(v.say(ctx.cls.rule === 'not-covered' ? 'unknown.notCovered' : 'unknown.admit'));
  d.add(v.say('unknown.offer', { topics: topicList(ctx) }));
  d.link('site.home');
  d.link('nav.materials');
  starterSuggestions(ctx, d);
  d.flag('general');
}

export const COMPOSERS = {
  greeting,
  thanks,
  farewell,
  identity,
  website_help: websiteHelp,
  materials,
  topic_explanation: explanation,
  definition,
  procedure,
  explain_simpler: simpler,
  show_example: example,
  practice_question: practiceQuestion,
  practice_answer: practiceAnswer,
  mistake_explanation: mistake,
  teacher_paper: teacherPaper,
  coverage,
  results_privacy: resultsPrivacy,
  term_help: termHelp,
  not_published: notPublished,
  off_topic: offTopic,
  abuse,
  unknown
};
