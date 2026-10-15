// IRUSHY - teacher paper builder and question-bank coverage.
//
// Papers are assembled ONLY from data/question-bank.json (approved). Labelled
// sample questions are added only when the teacher asks for them
// (useSample: true) and sample content is enabled; such a paper carries the
// watermark "SAMPLE - NOT APPROVED". Gaps are reported, never filled with
// invented questions. Every paper is a draft that requires teacher review,
// and the answer key is a separate object. Selection is deterministic.

import crypto from 'node:crypto';
import { pick } from './lang.js';
import { classOf, subjectOf, mediumOf } from './engine/intent.js';
import { matchTopic } from './engine/match.js';

export const SUBJECTS = ['Computer Science', 'Computer Applications', 'Computer Technology'];
export const MEDIUMS = ['Tamil Medium', 'English Medium'];
export const DEFAULT_SECTIONS = [
  { type: 'one_word', count: 5 },
  { type: 'mcq', count: 5 },
  { type: 'two_mark', count: 3 }
];

function tally(items, keyFn) {
  const out = {};
  for (const it of items) {
    const k = keyFn(it);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

export function coverageReport(knowledge) {
  const summarize = (items) => ({
    total: items.length,
    byType: tally(items, (q) => q.type),
    byTopic: tally(items, (q) => q.topic || 'unknown'),
    byClassSubjectMedium: tally(items, (q) => `${q.class} | ${q.subject} | ${q.medium}`)
  });
  return {
    approved: summarize(knowledge.bank.approved),
    sample: summarize(knowledge.bank.sample),
    questionTypes: Object.fromEntries(Object.entries(knowledge.questionTypes).map(([k, v]) => [k, { label: v.label, defaultMarks: v.defaultMarks }])),
    concepts: knowledge.counts.concepts,
    media: { videos: knowledge.counts.videos, diagrams: knowledge.counts.diagrams },
    note: {
      en: 'Papers use approved questions only. Sample questions are labelled and are used only when you ask for them.',
      ta: 'வினாத்தாள்கள் அங்கீகரிக்கப்பட்ட வினாக்களை மட்டுமே பயன்படுத்துகின்றன. மாதிரி வினாக்கள் குறிக்கப்பட்டுள்ளன; நீங்கள் கேட்டால் மட்டுமே அவை சேர்க்கப்படும்.'
    }
  };
}

export function knownTopics(knowledge) {
  const set = new Set();
  for (const q of [...knowledge.bank.approved, ...knowledge.bank.sample]) if (q.topic) set.add(q.topic);
  for (const c of knowledge.concepts) set.add(c.topic);
  return [...set];
}

// Validates a paper request (from the API body or from chat text).
export function normalizePaperSpec(input, knowledge) {
  const errors = [];
  const s = input && typeof input === 'object' ? input : {};
  let cls = s.class === undefined || s.class === null || s.class === '' ? null : Number(s.class);
  if (cls !== null && ![11, 12].includes(cls)) {
    errors.push('class must be 11 or 12');
    cls = null;
  }
  let subject = s.subject || null;
  if (subject && !SUBJECTS.includes(subject)) {
    errors.push(`subject must be one of: ${SUBJECTS.join(', ')}`);
    subject = null;
  }
  let medium = s.medium || null;
  if (medium && !MEDIUMS.includes(medium)) {
    errors.push(`medium must be one of: ${MEDIUMS.join(', ')}`);
    medium = null;
  }
  const allTopics = knownTopics(knowledge);
  let topics = Array.isArray(s.topics) ? s.topics.filter((t) => typeof t === 'string' && t.trim()).slice(0, 13) : [];
  const unknownTopics = topics.filter((t) => !allTopics.includes(t));
  if (unknownTopics.length) errors.push(`unknown topics: ${unknownTopics.join(', ')}`);
  topics = topics.filter((t) => allTopics.includes(t));
  let sections = Array.isArray(s.sections) && s.sections.length ? s.sections : DEFAULT_SECTIONS;
  sections = sections
    .slice(0, 6)
    .map((x) => ({ type: String(x && x.type), count: Math.max(1, Math.min(50, Number.parseInt(x && x.count, 10) || 0)) }))
    .filter((x) => {
      const ok = !!knowledge.questionTypes[x.type];
      if (!ok) errors.push(`unknown question type: ${x.type}`);
      return ok;
    });
  if (!sections.length) sections = DEFAULT_SECTIONS;
  const durationMin = Math.max(10, Math.min(300, Number.parseInt(s.durationMin, 10) || 60));
  const title = typeof s.title === 'string' && s.title.trim() ? s.title.trim().slice(0, 120) : null;
  return { spec: { class: cls, subject, medium, topics, sections, durationMin, title, useSample: s.useSample === true }, errors };
}

const TYPE_LABEL_EN = (k, t) => (k.questionTypes[t] && k.questionTypes[t].label && k.questionTypes[t].label.en) || t;
const TYPE_LABEL_TA = (k, t) => (k.questionTypes[t] && k.questionTypes[t].label && k.questionTypes[t].label.ta) || t;

function summaryText(k, spec) {
  const en = [
    spec.class ? `Class ${spec.class}` : 'Class 11 or 12',
    spec.subject || 'any subject',
    spec.medium || 'any medium',
    spec.topics.length ? `topics: ${spec.topics.join(', ')}` : 'all topics',
    spec.sections.map((x) => `${x.count} × ${TYPE_LABEL_EN(k, x.type)}`).join(' + ')
  ].join('; ');
  const ta = [
    spec.class ? `${spec.class} ஆம் வகுப்பு` : '11 அல்லது 12 ஆம் வகுப்பு',
    spec.subject || 'எந்தப் பாடமும்',
    spec.medium === 'Tamil Medium' ? 'தமிழ் வழி' : spec.medium === 'English Medium' ? 'ஆங்கில வழி' : 'எந்த வழியும்',
    spec.topics.length ? `தலைப்புகள்: ${spec.topics.join(', ')}` : 'எல்லாத் தலைப்புகளும்',
    spec.sections.map((x) => `${x.count} × ${TYPE_LABEL_TA(k, x.type)}`).join(' + ')
  ].join('; ');
  return { en, ta };
}

export function buildPaper(knowledge, rawSpec, { allowSample = false } = {}) {
  const { spec } = normalizePaperSpec(rawSpec, knowledge);
  const useSample = spec.useSample && allowSample && knowledge.allowSample;
  const pool = (useSample ? [...knowledge.bank.approved, ...knowledge.bank.sample] : knowledge.bank.approved).filter(
    (q) =>
      (!spec.class || q.class === spec.class) &&
      (!spec.subject || q.subject === spec.subject) &&
      (!spec.medium || q.medium === spec.medium) &&
      (!spec.topics.length || spec.topics.includes(q.topic))
  );
  const used = new Set();
  let n = 0;
  const sections = [];
  const answers = [];
  const gaps = [];
  let requested = 0;
  let available = 0;
  for (const sec of spec.sections) {
    const candidates = pool
      .filter((q) => q.type === sec.type && !used.has(q.id))
      .sort((a, b) => (a.sample === b.sample ? (a.id < b.id ? -1 : 1) : a.sample ? 1 : -1));
    const taken = candidates.slice(0, sec.count);
    taken.forEach((q) => used.add(q.id));
    requested += sec.count;
    available += taken.length;
    const marksEach = (knowledge.questionTypes[sec.type] && knowledge.questionTypes[sec.type].defaultMarks) || 1;
    sections.push({
      type: sec.type,
      label: knowledge.questionTypes[sec.type] ? knowledge.questionTypes[sec.type].label : { en: sec.type, ta: sec.type },
      marksEach,
      requested: sec.count,
      questions: taken.map((q) => {
        n += 1;
        answers.push({ n, id: q.id, answer: q.answer, explanation: q.explanation, sample: q.sample });
        return { n, id: q.id, question: q.question, options: q.options, marks: q.marks || marksEach, topic: q.topic, sample: q.sample };
      })
    });
    if (taken.length < sec.count) {
      gaps.push({
        type: sec.type,
        requested: sec.count,
        available: taken.length,
        text: {
          en: `${TYPE_LABEL_EN(knowledge, sec.type)}: ${taken.length} of ${sec.count} available`,
          ta: `${TYPE_LABEL_TA(knowledge, sec.type)}: ${sec.count} இல் ${taken.length} மட்டுமே கிடைக்கின்றன`
        }
      });
    }
  }
  const anySample = answers.some((a) => a.sample);
  const id =
    'draft-' +
    crypto
      .createHash('sha256')
      .update(JSON.stringify({ spec, useSample, v: knowledge.version }))
      .digest('hex')
      .slice(0, 12);
  const totalMarks = sections.reduce((s, sec) => s + sec.questions.reduce((t, q) => t + (q.marks || 0), 0), 0);

  // How many more questions labelled sample content could add (never used
  // unless the teacher asks for it).
  let canFillWithLabelledSample = false;
  if (!useSample && gaps.length && knowledge.allowSample) {
    const samplePool = knowledge.bank.sample.filter(
      (q) =>
        (!spec.class || q.class === spec.class) &&
        (!spec.subject || q.subject === spec.subject) &&
        (!spec.medium || q.medium === spec.medium) &&
        (!spec.topics.length || spec.topics.includes(q.topic))
    );
    canFillWithLabelledSample = gaps.some((g) => samplePool.some((q) => q.type === g.type));
  }

  const paper = {
    id,
    title: spec.title || 'Draft question paper',
    status: 'draft',
    requiresTeacherReview: true,
    published: false,
    watermark: anySample ? 'SAMPLE - NOT APPROVED' : null,
    provenance: anySample ? 'sample-unapproved' : 'approved',
    spec,
    durationMin: spec.durationMin,
    totalMarks,
    sections
  };
  const answerKey = { paperId: id, requiresTeacherReview: true, watermark: paper.watermark, answers };
  return {
    paper,
    answerKey,
    coverage: { requested, available, gaps, canFillWithLabelledSample, summary: summaryText(knowledge, spec) },
    export: exportText(paper, answerKey)
  };
}

function exportText(paper, key) {
  const lines = [];
  if (paper.watermark) lines.push(`*** ${paper.watermark} ***`);
  lines.push(paper.title, `Status: draft - requires teacher review`, `Time: ${paper.durationMin} minutes   Total marks: ${paper.totalMarks}`, '');
  for (const sec of paper.sections) {
    lines.push(`${pick(sec.label, 'en')} (${sec.marksEach} mark${sec.marksEach === 1 ? '' : 's'} each)`);
    if (!sec.questions.length) lines.push('  (no approved questions available for this section)');
    for (const q of sec.questions) {
      lines.push(`  ${q.n}. ${pick(q.question, 'en')}`);
      for (const o of q.options || []) lines.push(`     ${o.key}) ${pick(o.text, 'en')}`);
    }
    lines.push('');
  }
  const keyLines = [];
  if (key.watermark) keyLines.push(`*** ${key.watermark} ***`);
  keyLines.push(`Answer key for ${key.paperId} (separate from the paper)`);
  for (const a of key.answers) keyLines.push(`  ${a.n}. ${a.answer}`);
  return { paper: lines.join('\n'), answerKey: keyLines.join('\n') };
}

// Reads a paper request out of a chat message (teacher mode).
export function paperSpecFromText(message, knowledge, context = {}) {
  const raw = String(message || '');
  const sections = [];
  const patterns = [
    ['one_word', /(\d{1,2})\s*(?:one[\s-]*word|1[\s-]*mark|ஒரு\s*வார்த்தை|ஒரு\s*மதிப்பெண்)/i],
    ['mcq', /(\d{1,2})\s*(?:mcqs?|multiple[\s-]*choice|பலவுள்)/i],
    ['two_mark', /(\d{1,2})\s*(?:two[\s-]*marks?|2[\s-]*marks?|இரண்டு\s*மதிப்பெண்|2\s*மதிப்பெண்)/i],
    ['three_mark', /(\d{1,2})\s*(?:three[\s-]*marks?|3[\s-]*marks?|3\s*மதிப்பெண்)/i],
    ['five_mark', /(\d{1,2})\s*(?:five[\s-]*marks?|5[\s-]*marks?|5\s*மதிப்பெண்)/i]
  ];
  for (const [type, re] of patterns) {
    const m = raw.match(re);
    if (m) sections.push({ type, count: Number(m[1]) });
  }
  const topics = matchTopic(knowledge, raw)
    .all.filter((t) => t.score >= 1)
    .map((t) => t.concept.topic);
  return {
    class: classOf(raw, context),
    subject: subjectOf(raw, context),
    medium: mediumOf(raw, context, true),
    topics,
    sections: sections.length ? sections : DEFAULT_SECTIONS,
    useSample: false
  };
}
