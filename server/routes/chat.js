// IRUSHY - POST /api/chat
//
// Backend-agnostic: the configured engine (local by default) answers through
// one interface. Order of work, all decided on the server:
//   1. validate the body and the message (400 / 413)
//   2. language (Auto: Tamil script, then Accept-Language) and mode
//      (resolveMode: a client "teacher" request is never proof)
//   3. assessment guard: test-answer requests and mistake explanations
//      without a verified completed token are refused here, and NO engine
//      is called
//   4. engine.answer() behind duplicate collapse + a concurrency gate
//   5. one response builder for success / blocked / error

import express from 'express';
import crypto from 'node:crypto';
import { cleanInput, cleanHistory } from '../lib/sanitize.js';
import { detectLang } from '../lib/lang.js';
import { resolveMode, evaluateAssessment, resultsAccess } from '../lib/policy.js';
import { classify } from '../lib/engine/intent.js';
import { refusalAnswer } from '../lib/engine/refusals.js';
import { successResponse, blockedResponse, errorResponse, siteLinksFor } from '../lib/respond.js';
import { createConcurrencyGate, createDeduper, LimitError } from '../lib/limits.js';

const SUBJECTS = new Set(['Computer Science', 'Computer Applications', 'Computer Technology']);
const MEDIUMS = new Set(['Tamil Medium', 'English Medium']);

function str(v, max) {
  if (typeof v !== 'string') return undefined;
  const s = cleanInput(v, max);
  return s || undefined;
}

// Only known context fields survive, each bounded.
export function cleanContext(raw) {
  const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  if (c.class === 11 || c.class === 12 || c.class === '11' || c.class === '12') out.class = Number(c.class);
  if (SUBJECTS.has(c.subject)) out.subject = c.subject;
  if (MEDIUMS.has(c.medium)) out.medium = c.medium;
  const topic = str(c.topic, 60);
  if (topic) out.topic = topic;
  const token = typeof c.assessmentToken === 'string' && c.assessmentToken.length <= 4096 ? c.assessmentToken.trim() : undefined;
  if (token) out.assessmentToken = token;
  for (const k of ['assessmentStatus', 'completedTest', 'testCompleted']) {
    if (c[k] !== undefined && c[k] !== null && c[k] !== '') out[k] = typeof c[k] === 'string' ? c[k].slice(0, 40) : !!c[k];
  }
  const testId = str(c.testId, 80);
  if (testId) out.testId = testId;
  const question = str(c.question, 600);
  if (question) out.question = question;
  if (c.selectedAnswer !== undefined && c.selectedAnswer !== null) out.selectedAnswer = String(c.selectedAnswer).slice(0, 200);
  if (c.correctAnswer !== undefined && c.correctAnswer !== null) out.correctAnswer = String(c.correctAnswer).slice(0, 200);
  const conceptRef = str(c.conceptRef, 80);
  if (conceptRef) out.conceptRef = conceptRef;
  const questionId = str(c.questionId, 100);
  if (questionId) out.questionId = questionId;
  return out;
}

export function chatRouter({ config, knowledge, engine, sessions, index, log, chatLimiter, clientKey }) {
  const router = express.Router();
  const gate = createConcurrencyGate({ max: config.limits.maxConcurrent, queueTimeoutMs: config.limits.queueTimeoutMs, maxQueue: config.limits.maxQueue });
  const deduper = createDeduper({ windowMs: config.limits.duplicateWindowMs });

  router.post('/chat', async (req, res) => {
    const started = Date.now();
    const body = req.body;
    const requestId =
      body && typeof body.request_id === 'string' && /^[A-Za-z0-9._:-]{4,80}$/.test(body.request_id)
        ? body.request_id
        : crypto.randomBytes(8).toString('hex');
    const session = sessions.read(req);
    const rawMessage = body && typeof body.message === 'string' ? body.message : '';
    const message = cleanInput(rawMessage);
    const { lang, how } = detectLang({ requested: body && body.lang, message, acceptLanguage: req.headers['accept-language'] });
    const modeInfo = resolveMode(body && body.mode_requested, session);
    const notices = [];
    if (modeInfo.notice) notices.push(modeInfo.notice);
    const base = {
      request_id: requestId,
      mode: modeInfo.mode,
      mode_requested: modeInfo.requested,
      lang,
      lang_how: how,
      results_access: resultsAccess()
    };
    const send = (out) => res.status(out.status).json(out.body);

    // per-IP chat budget (always applies, whichever engine)
    const rl = chatLimiter.hit(clientKey(req));
    if (!rl.ok) {
      res.set('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return send(errorResponse({ knowledge, engine, base, code: 'rate_limited', notices, started, retryAfterMs: rl.retryAfterMs }));
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(errorResponse({ knowledge, engine, base, code: 'bad_request', notices, started }));
    if (!message) return send(errorResponse({ knowledge, engine, base, code: 'empty_message', notices, started }));
    if (rawMessage.length > config.limits.maxInputChars) return send(errorResponse({ knowledge, engine, base, code: 'message_too_long', notices, started }));

    const { history, trimmed } = cleanHistory(body.history, {
      maxMessages: config.limits.maxHistoryMessages,
      maxChars: config.limits.maxHistoryChars,
      maxItemChars: config.limits.maxHistoryItemChars
    });
    const context = cleanContext(body.context);
    const wantDebug = body.debug === true && config.features.debugField;

    // ---- assessment guard (no engine involved) ---------------------------
    const assessment = evaluateAssessment({ context, session, secret: config.assessmentSecret });
    const cls = classify({ message, mode: modeInfo.mode, history, context, knowledge });
    let blockReason = null;
    if (assessment.present && assessment.status !== 'completed') blockReason = assessment.reason || 'test_still_active';
    else if (cls.intent === 'assessment_request') blockReason = 'answers_for_a_test';
    else if (cls.intent === 'mistake_explanation' && assessment.status !== 'completed') blockReason = 'mistake_needs_completed_token';
    const assessmentView = {
      status: assessment.status,
      verified: assessment.verified,
      source: assessment.source,
      reason: assessment.reason,
      testId: assessment.testId
    };
    if (blockReason) {
      const refusal = refusalAnswer({
        knowledge,
        lang,
        mode: modeInfo.mode,
        message,
        reason: blockReason === 'mistake_needs_completed_token' ? 'mistake_needs_token' : 'active',
        conceptId: cls.signals.topic ? cls.signals.topic.concept.id : cls.signals.state.conceptId
      });
      log.info('chat_blocked', { request_id: requestId, reason: blockReason, mode: modeInfo.mode, lang });
      const view = blockReason === 'answers_for_a_test' || blockReason === 'mistake_needs_completed_token'
        ? { ...assessmentView, status: assessment.status === 'completed' ? 'completed' : 'active' }
        : assessmentView;
      return res.status(200).json(blockedResponse({ knowledge, engine, base, refusal, notices, assessment: view, reason: blockReason, intent: cls.intent, started, debug: wantDebug }));
    }

    if (!engine.connected()) return send(errorResponse({ knowledge, engine, base, code: 'not_connected', notices, assessment: assessmentView, started }));

    const hits = index.search(message, { limit: 6 });
    const destinations = siteLinksFor(knowledge, modeInfo.mode);
    const input = {
      mode: modeInfo.mode,
      lang,
      message,
      history,
      hits,
      destinations,
      context,
      notices,
      classification: cls,
      assessment
    };
    const dedupeKey = `${session.sid || clientKey(req)}|${requestId}`;
    try {
      const { value: answered, duplicate } = await deduper.run(dedupeKey, () => gate.run(() => engine.answer(input)));
      // The intent comes from the same local classifier for every backend, so
      // the widget can rely on meta.intent (e.g. the results notice).
      const result = answered.intent ? answered : { ...answered, intent: cls.intent, confidence: cls.confidence };
      const out = successResponse({
        knowledge,
        engine,
        base,
        result,
        notices,
        assessment: assessmentView,
        started,
        duplicate,
        historyTrimmed: trimmed,
        debug: wantDebug,
        maxAnswerChars: config.limits.maxAnswerChars
      });
      log.info('chat_answered', {
        request_id: requestId,
        engine: engine.name,
        intent: result.intent || null,
        mode: modeInfo.mode,
        lang,
        chars_in: message.length,
        chars_out: out.answer.length,
        history: history.length,
        duplicate,
        ms: out.meta.ms,
        ...(config.log.messageBodies ? { message } : {})
      });
      return res.status(200).json(out);
    } catch (err) {
      let code = 'engine_error';
      let retryAfterMs = 0;
      if (err instanceof LimitError) {
        code = err.code;
        retryAfterMs = err.retryAfterMs;
      } else if (err && err.name === 'EngineError') {
        code = err.code;
        retryAfterMs = err.retryAfterMs || 0;
      }
      if (engine.name === 'local' && code !== 'busy') code = 'engine_error';
      log.warn('chat_failed', { request_id: requestId, engine: engine.name, code, error: String(err && err.message ? err.message : err).slice(0, 300) });
      if (retryAfterMs) res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return send(errorResponse({ knowledge, engine, base, code, notices, assessment: assessmentView, started, retryAfterMs }));
    }
  });

  return router;
}
