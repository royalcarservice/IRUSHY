// IRUSHY - public read-only routes: config, health, verified site links,
// published services, starter suggestions, diagnostics (names only).

import express from 'express';
import { pick } from '../lib/lang.js';
import { siteLinksFor } from '../lib/respond.js';
import { diagnosticsView } from '../config.js';
import { resultsAccess } from '../lib/policy.js';

const MODES = ['home', 'student', 'teacher'];
const langOf = (q) => (q === 'ta' ? 'ta' : 'en');

export function siteRouter({ config, knowledge, engine, sessions, startedAt }) {
  const router = express.Router();

  router.get('/config', (req, res) => {
    res.json({
      ok: true,
      config: {
        connected: engine.connected(),
        engine: engine.name,
        engine_version: engine.version,
        requires_key: engine.requiresKey,
        key_on_server_only: true,
        ...(engine.name === 'apinex' ? { model: engine.model } : {}),
        features: {
          sampleContent: knowledge.allowSample,
          webSearch: false,
          demoLogin: config.features.demoLogin,
          studentResults: false,
          debugField: config.features.debugField
        },
        limits: {
          maxInputChars: config.limits.maxInputChars,
          maxHistoryMessages: config.limits.maxHistoryMessages,
          chatPerWindow: config.limits.rateLimitMax,
          windowSeconds: Math.round(config.limits.rateLimitWindowMs / 1000)
        },
        modes: MODES,
        languages: ['auto', 'ta', 'en'],
        transcriptStored: false
      }
    });
  });

  router.get('/health', async (req, res) => {
    const connected = engine.connected();
    const body = {
      ok: true,
      status: connected ? 'ready' : 'not_connected',
      engine: engine.name,
      engine_version: engine.version,
      connected,
      requires_key: engine.requiresKey,
      uses_network: !!engine.usesNetwork,
      ...(engine.name === 'apinex' ? { model: engine.model } : {}),
      knowledge: { version: knowledge.version, ...knowledge.counts, warnings: knowledge.warnings.length },
      results_access: { available: false, neverSimulated: true },
      transcriptStored: false,
      uptime_s: Math.round((Date.now() - startedAt) / 1000)
    };
    if (req.query.deep === '1') body.probe = await engine.probe();
    res.json(body);
  });

  router.get('/site/links', (req, res) => {
    const mode = MODES.includes(req.query.mode) ? req.query.mode : 'home';
    const lang = langOf(req.query.lang);
    res.json({
      ok: true,
      mode,
      lang,
      links: siteLinksFor(knowledge, mode).map((l) => ({ id: l.id, title: pick(l.title, lang), url: l.url })),
      source: 'data/site-pages.json (verified on the live site)'
    });
  });

  router.get('/site/services', (req, res) => {
    const lang = langOf(req.query.lang);
    const services = knowledge.faq
      .filter((f) => f.links.length)
      .map((f) => ({
        id: f.id,
        question: pick(f.question, lang),
        summary: pick(f.answer, lang),
        links: f.links.map((l) => {
          const p = knowledge.sitePageById.get(l.id);
          return { id: l.id, title: pick(l.label, lang), url: p.url };
        }),
        provenance: 'verified-site'
      }));
    res.json({ ok: true, lang, services });
  });

  router.get('/suggestions', (req, res) => {
    const mode = MODES.includes(req.query.mode) ? req.query.mode : 'home';
    const lang = langOf(req.query.lang);
    const faqs = knowledge.faq.filter((f) => f.modes.includes(mode)).slice(0, 4).map((f) => ({ label: pick(f.question, lang), prompt: pick(f.question, lang), source: f.id }));
    const topics =
      mode === 'student'
        ? knowledge.concepts.slice(0, 4).map((c) => {
            const t = String(pick(c.title, lang)).replace(/\s*\([^)]*\)\s*$/, '');
            const prompt = lang === 'ta' ? `${t} பற்றி விளக்குங்கள்` : `Explain ${t}`;
            return { label: prompt, prompt, source: c.id };
          })
        : [];
    res.json({ ok: true, mode, lang, suggestions: [...topics, ...faqs] });
  });

  // Variable NAMES and set/unset only. Outside production for anyone; in
  // production only for a signed-in teacher.
  router.get('/diagnostics', (req, res) => {
    if (config.isProduction && sessions.read(req).role !== 'teacher') {
      return res.status(403).json({ ok: false, error: { code: 'teacher_only', retryable: false, message: { en: 'Diagnostics are for signed-in teachers in production.', ta: 'உற்பத்திச் சூழலில் கண்டறிதல் விவரங்கள் உள்நுழைந்த ஆசிரியர்களுக்கு மட்டுமே.' } } });
    }
    return res.json({
      ok: true,
      ...diagnosticsView(config),
      engine: engine.describe(),
      knowledge: { version: knowledge.version, files: knowledge.files, warnings: knowledge.warnings },
      results_access: resultsAccess()
    });
  });

  return router;
}
