// IRUSHY - teacher routes. Every route calls requireTeacher() first; a client
// asking for Teacher mode is never enough.
//
//   GET  /api/teacher/coverage              approved vs sample bank coverage
//   GET  /api/teacher/bank                  search the banks (sample labelled)
//   POST /api/teacher/paper                 draft paper + separate answer key
//   POST /api/teacher/paper/:id/review      record that a named teacher read it
//   GET  /api/teacher/results/:studentRef   ALWAYS 503 - never simulated

import express from 'express';
import { requireTeacher, resultsAccess } from '../lib/policy.js';
import { coverageReport, buildPaper, normalizePaperSpec } from '../lib/paper.js';
import { normalize } from '../lib/lang.js';

export function teacherRouter({ config, knowledge, sessions, log }) {
  const router = express.Router();
  const teacherOnly = requireTeacher(sessions);
  const drafts = new Map(); // bounded, in memory only

  router.get('/teacher/coverage', teacherOnly, (req, res) => {
    res.json({ ok: true, coverage: coverageReport(knowledge), sampleContentEnabled: knowledge.allowSample });
  });

  router.get('/teacher/bank', teacherOnly, (req, res) => {
    const q = typeof req.query.q === 'string' ? normalize(req.query.q).slice(0, 100) : '';
    const includeSample = req.query.includeSample === '1' && knowledge.allowSample;
    const pool = [...knowledge.bank.approved, ...(includeSample ? knowledge.bank.sample : [])];
    const items = pool
      .filter((x) => !req.query.topic || x.topic === req.query.topic)
      .filter((x) => !req.query.type || x.type === req.query.type)
      .filter((x) => !req.query.class || String(x.class) === String(req.query.class))
      .filter((x) => !req.query.subject || x.subject === req.query.subject)
      .filter((x) => !req.query.medium || x.medium === req.query.medium)
      .filter((x) => !q || normalize(`${x.question.en} ${x.question.ta} ${x.topic} ${x.keywords.join(' ')}`).includes(q))
      .slice(0, 100)
      .map((x) => ({ ...x, label: x.sample ? 'Sample - not approved' : null, provenance: x.sample ? 'sample-unapproved' : 'approved' }));
    res.json({ ok: true, count: items.length, includeSample, items });
  });

  router.post('/teacher/paper', teacherOnly, (req, res) => {
    const { spec, errors } = normalizePaperSpec(req.body, knowledge);
    if (errors.length) return res.status(400).json({ ok: false, error: { code: 'invalid_paper_request', retryable: false, details: errors } });
    if (spec.useSample && !knowledge.allowSample) {
      return res.status(400).json({
        ok: false,
        error: { code: 'sample_disabled', retryable: false, details: ['Sample content is switched off on this server (IRUSHY_ALLOW_SAMPLE_CONTENT=false).'] }
      });
    }
    const built = buildPaper(knowledge, spec, { allowSample: knowledge.allowSample });
    if (drafts.size >= 50) drafts.delete(drafts.keys().next().value);
    drafts.set(built.paper.id, { paper: built.paper, reviews: [] });
    log.info('paper_draft', { id: built.paper.id, requested: built.coverage.requested, available: built.coverage.available, sample: !!built.paper.watermark });
    res.json({ ok: true, ...built });
  });

  router.post('/teacher/paper/:id/review', teacherOnly, (req, res) => {
    const d = drafts.get(req.params.id);
    if (!d) return res.status(404).json({ ok: false, error: { code: 'unknown_paper', retryable: false } });
    const reviewer = typeof req.body?.reviewer === 'string' ? req.body.reviewer.trim().slice(0, 80) : '';
    if (!reviewer) return res.status(400).json({ ok: false, error: { code: 'reviewer_required', retryable: false } });
    d.reviews.push({ reviewer, at: new Date().toISOString() });
    res.json({
      ok: true,
      paperId: d.paper.id,
      reviews: d.reviews,
      published: false,
      note: 'Recorded that a named teacher read this draft. Publishing is not implemented.'
    });
  });

  router.get('/teacher/results/:studentRef', teacherOnly, (req, res) => {
    res.status(503).json({ ok: false, records: null, ...resultsAccess() });
  });

  return router;
}
