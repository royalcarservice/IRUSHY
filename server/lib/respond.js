// IRUSHY - builds every /api/chat response (success, blocked, error) so the
// contract is identical whichever engine answered:
//
//   ok, request_id, mode, mode_requested, lang, lang_how, answer, citations,
//   links, attachments, provenance, sampleContentUsed, sampleNotice,
//   urlsRemoved, suggestions, notices, results_access, assessment, blocked,
//   meta{ engine, engine_version, intent, confidence, knowledge_version,
//         transcript_stored:false, key_on_server_only:true, requires_key,
//         duplicate, history_trimmed, ms, debug? }

import { pick } from './lang.js';
import { filterUrls, dropUnknownCitations, stripMarkup, extractCitationIds, truncateAtSentence } from './sanitize.js';
import { errorInfo, EngineError } from './errors.js';
import { fixedBoth } from './engine/voice.js';
import { isVideoUrl } from './data.js';
import { validateSvg } from './svg.js';

export function linkObjects(knowledge, ids) {
  const out = [];
  for (const id of ids || []) {
    const p = knowledge.sitePageById.get(id);
    if (p && !out.some((x) => x.id === id)) out.push({ id: p.id, title: p.title, url: p.url });
  }
  return out;
}

const ROLE_ORDER = { home: ['home', 'student', 'teacher'], student: ['student', 'home', 'teacher'], teacher: ['teacher', 'home', 'student'] };

export function siteLinksFor(knowledge, mode = 'home') {
  const order = ROLE_ORDER[mode] || ROLE_ORDER.home;
  const pages = knowledge.sitePages.slice().sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  // Home and Materials first: they are the most useful fallbacks.
  const first = ['site.home', 'nav.materials', 'nav.one-word-test'];
  pages.sort((a, b) => {
    const ia = first.indexOf(a.id);
    const ib = first.indexOf(b.id);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return 0;
  });
  return pages.map((p) => ({ id: p.id, title: p.title, url: p.url }));
}

export function citationObjects(knowledge, ids, lang) {
  return ids
    .filter((id) => knowledge.idIndex.has(id))
    .map((id) => {
      const rec = knowledge.idIndex.get(id);
      const c = { id, kind: rec.kind, title: pick(rec.title, lang), provenance: rec.label };
      if (rec.kind === 'material' || rec.kind === 'site-page') c.url = rec.entry.url;
      return c;
    });
}

function safeAttachments(list) {
  const out = [];
  for (const a of list || []) {
    if (a.type === 'diagram' && validateSvg(a.svg).ok) out.push(a);
    else if (a.type === 'video' && isVideoUrl(a.url)) out.push(a);
  }
  return out;
}

function baseMeta({ engine, knowledge, started, requestId, intent = null, confidence = null }) {
  return {
    request_id: requestId,
    engine: engine.name,
    engine_version: engine.version,
    intent,
    confidence,
    knowledge_version: knowledge.version,
    transcript_stored: false,
    key_on_server_only: true,
    requires_key: engine.requiresKey,
    ms: Date.now() - started
  };
}

// The visible sample label for model output (the local engine adds its own,
// picked with the request seed). First variant, so it is stable.
export function modelSampleLabel(knowledge, lang) {
  const frames = knowledge.phrasebook[lang] && knowledge.phrasebook[lang].frames;
  const variants = frames && frames['sample.label'];
  if (!Array.isArray(variants) || !variants.length) throw new Error(`phrasebook: frame "sample.label" is missing for language "${lang}"`);
  return variants[0];
}

export function successResponse({ knowledge, engine, base, result, notices, assessment, started, duplicate = false, historyTrimmed = false, debug = false, maxAnswerChars = 2400 }) {
  const lang = base.lang;
  const fromModel = result.source !== 'local';
  let text = String(result.text || '');
  if (fromModel) text = stripMarkup(text);
  const urls = filterUrls(text, knowledge.sitePages.map((p) => p.url));
  text = urls.text;
  const dc = dropUnknownCitations(text, knowledge.idIndex);
  text = dc.text.trim();
  // Nothing left once markup, unverified URLs and invented ids are gone:
  // report it as an unreadable answer rather than send an empty one.
  if (fromModel && !text) throw new EngineError('bad_provider_response', 'model answer was empty after cleaning', { status: 502, retryable: true });
  const cited = extractCitationIds(text);

  let used =
    result.source === 'local'
      ? [...new Set([...(result.usedIds || []), ...cited])].filter((id) => knowledge.idIndex.has(id))
      : cited.filter((id) => knowledge.idIndex.has(id));
  const attachments = safeAttachments(result.attachments);
  const isSample = (id) => knowledge.idIndex.get(id).provenance !== 'approved';
  const sampleContentUsed = !!result.sampleContentUsed || used.some(isSample) || attachments.some((a) => a.label);

  // Model output gets the same two guarantees the local engine builds in:
  // a bounded length, and the visible sample label as the last line.
  if (fromModel) {
    const label = sampleContentUsed ? modelSampleLabel(knowledge, lang) : '';
    text = truncateAtSentence(text, Math.max(100, maxAnswerChars - (label ? label.length + 1 : 0))).text;
    if (label) text = `${text}\n${label}`;
    used = extractCitationIds(text).filter((id) => knowledge.idIndex.has(id));
  }

  let links;
  if (result.source === 'local') {
    links = linkObjects(knowledge, result.links || []);
  } else {
    const ids = [];
    for (const id of used) {
      const rec = knowledge.idIndex.get(id);
      if (rec.kind === 'faq') rec.entry.links.forEach((l) => ids.push(l.id));
      if (rec.kind === 'material') ids.push('nav.materials');
    }
    links = linkObjects(knowledge, ids);
  }

  const provenance = [];
  if (used.some((id) => !isSample(id))) provenance.push('approved');
  if (sampleContentUsed) provenance.push('sample-unapproved');
  if ((result.provenance || []).includes('general-guidance') || used.length === 0) provenance.push('general-guidance');

  const meta = baseMeta({ engine, knowledge, started, requestId: base.request_id, intent: result.intent || null, confidence: result.confidence ?? null });
  meta.duplicate = duplicate;
  meta.history_trimmed = historyTrimmed;
  if (fromModel) meta.provider_model = result.providerModel || null;
  if (result.source === 'apinex') meta.model_fallback_used = !!result.fallbackUsed;
  if (debug && result.debug) meta.debug = result.debug;

  return {
    ok: true,
    ...base,
    answer: text,
    citations: citationObjects(knowledge, used, lang),
    links,
    attachments,
    provenance,
    sampleContentUsed,
    sampleNotice: sampleContentUsed ? fixedBoth(knowledge, 'notice.sample') : null,
    urlsRemoved: urls.removed,
    suggestions: (result.suggestions || []).slice(0, 4),
    notices,
    assessment,
    blocked: null,
    meta
  };
}

export function blockedResponse({ knowledge, engine, base, refusal, notices, assessment, reason, intent, started, debug = false }) {
  const meta = baseMeta({ engine, knowledge, started, requestId: base.request_id, intent, confidence: null });
  if (debug) meta.debug = { decided_by: 'assessment-guard', reason, frames: refusal.frames, seed: refusal.seed };
  return {
    ok: true,
    ...base,
    answer: refusal.text,
    citations: [],
    links: linkObjects(knowledge, ['site.home']),
    attachments: [],
    provenance: [],
    sampleContentUsed: false,
    sampleNotice: null,
    urlsRemoved: [],
    suggestions: refusal.suggestions,
    notices,
    assessment,
    blocked: { code: 'active_assessment', reason, engine_called: false, provider_called: false },
    meta
  };
}

export function errorResponse({ knowledge, engine, base, code, notices = [], assessment = null, started, retryAfterMs = 0 }) {
  const info = errorInfo(code, engine && engine.name);
  const meta = baseMeta({ engine, knowledge, started, requestId: base.request_id });
  if (retryAfterMs) meta.retry_after_s = Math.ceil(retryAfterMs / 1000);
  return {
    status: info.status,
    body: {
      ok: false,
      ...base,
      error: { code: info.code, retryable: info.retryable, message: info.message, ...(info.adminHint ? { adminHint: info.adminHint } : {}) },
      answer: null,
      citations: [],
      links: siteLinksFor(knowledge, base.mode),
      attachments: [],
      provenance: [],
      sampleContentUsed: false,
      sampleNotice: null,
      urlsRemoved: [],
      suggestions: [],
      notices,
      assessment,
      blocked: null,
      meta
    }
  };
}
