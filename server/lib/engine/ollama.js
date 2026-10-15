// IRUSHY - OPTIONAL Ollama backend (a model on this machine).
//
// Off by default. Used only when IRUSHY_ENGINE=ollama is set explicitly
// together with OLLAMA_MODEL. It speaks Ollama's native API:
//   POST {OLLAMA_BASE_URL}/api/chat   (stream:false)   answers
//   GET  {OLLAMA_BASE_URL}/api/tags                    /api/health?deep=1
//
// What it shares with the APInex backend (server/lib/prompts.js): the rules,
// the reference entries and the completed-test block. What the response
// builder applies to its output, as to any model output: markup stripped,
// unverified URLs and invented [ids] removed, the answer length capped, and
// the sample label added whenever a sample entry was among the references.
//
// Never:
//   - sends a key or any credential (a self-hosted Ollama needs none);
//   - talks to another machine or uses an Ollama cloud model unless
//     IRUSHY_OLLAMA_ALLOW_REMOTE=true (enforced in server/config.js);
//   - switches to another model, or falls back to the local engine or to
//     APInex: an error is reported as an error.
//
// Requests are reproducible on IRUSHY's side: the same question sends the
// same messages with temperature 0 and the same seed. Word-for-word identical
// answers are guaranteed by the local engine only; with Ollama they also
// depend on the model, the Ollama version and the hardware.

import { EngineError } from '../errors.js';
import { buildMessages, buildReferences, referenceProvenance, testContextFor } from '../prompts.js';
import { makeSeed } from './seed.js';

export const OLLAMA_CLIENT_VERSION = '1.0.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function errorText(bodyText) {
  try {
    const j = JSON.parse(bodyText);
    return typeof j.error === 'string' ? j.error : '';
  } catch {
    return String(bodyText || '').slice(0, 200);
  }
}

// Ollama status codes (docs/api/errors): 400 bad request, 404 model not
// found, 429 rate limit (cloud), 500 server error, 502 cloud model
// unreachable, 503 overloaded (OLLAMA_MAX_QUEUE). 401/403 can only come from
// a proxy in front of Ollama.
export function mapOllamaStatus(status, bodyText) {
  const msg = errorText(bodyText);
  const detail = `Ollama returned HTTP ${status}${msg ? `: ${msg.slice(0, 160)}` : ''}`;
  if (status === 404 || /model[^"]{0,60}not found/i.test(msg)) return new EngineError('model_unavailable', detail, { status: 502 });
  if (status === 429) return new EngineError('rate_limited', detail, { status: 429, retryable: true, retryAfterMs: 15000 });
  if (status === 400 || status === 401 || status === 403 || status === 422) return new EngineError('invalid_request', detail, { status: 502 });
  if (status >= 500) return new EngineError('provider_unavailable', detail, { status: 503, retryable: true });
  return new EngineError('bad_provider_response', detail, { status: 502, retryable: true });
}

// Ollama's seed is an integer; 31 bits of the request hash.
export function seedNumber(hex) {
  return Number.parseInt(String(hex).slice(0, 8), 16) & 0x7fffffff;
}

export async function ollamaChat({ baseUrl, model, messages, options, timeoutMs, maxRetries, fetchImpl }) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    let text;
    try {
      res = await fetchImpl(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, options }),
        signal: controller.signal
      });
      text = await res.text();
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new EngineError('timeout', `Ollama did not answer within ${timeoutMs} ms`, { status: 504, retryable: true });
      const cause = err && err.cause && err.cause.code ? ` (${err.cause.code})` : '';
      throw new EngineError('network_error', `Ollama unreachable${cause}`, { status: 503, retryable: true });
    }
    clearTimeout(timer);
    if (!res.ok) {
      const e = mapOllamaStatus(res.status, text);
      if ([429, 502, 503, 504].includes(res.status) && attempt <= maxRetries) {
        await sleep(400 * attempt + Math.floor(Math.random() * 300)); // jitter only affects timing, never content
        continue;
      }
      throw e;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new EngineError('bad_provider_response', 'Ollama sent invalid JSON', { status: 502, retryable: true });
    }
    if (json && typeof json.error === 'string') throw new EngineError('provider_unavailable', `Ollama error: ${json.error.slice(0, 160)}`, { status: 503, retryable: true });
    const content = json && json.message && json.message.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new EngineError('bad_provider_response', 'Ollama sent no answer text', { status: 502, retryable: true });
    }
    // message.thinking (a reasoning trace) is never shown, so it is not read.
    return {
      content,
      model: typeof json.model === 'string' && json.model ? json.model : model,
      doneReason: json.done_reason || null,
      evalCount: Number.isFinite(json.eval_count) ? json.eval_count : null,
      promptEvalCount: Number.isFinite(json.prompt_eval_count) ? json.prompt_eval_count : null,
      totalMs: Number.isFinite(json.total_duration) ? Math.round(json.total_duration / 1e6) : null
    };
  }
}

// "llama3.2" is listed by Ollama as "llama3.2:latest".
export function findListedModel(models, model) {
  const name = String(model);
  const slash = name.lastIndexOf('/');
  const hasTag = name.lastIndexOf(':') > slash;
  const wanted = new Set([name, hasTag ? name : `${name}:latest`]);
  return (Array.isArray(models) ? models : []).find((m) => m && (wanted.has(m.name) || wanted.has(m.model))) || null;
}

// When a model stops at num_predict it stops mid-sentence; keep whole
// sentences only.
export function dropUnfinishedSentence(text) {
  const s = String(text).trimEnd();
  if (/[.!?।)\]"']$/.test(s)) return s;
  const cut = Math.max(s.lastIndexOf('. '), s.lastIndexOf('? '), s.lastIndexOf('! '), s.lastIndexOf('। '), s.lastIndexOf('\n'));
  return cut > s.length * 0.3 ? `${s.slice(0, cut + 1).trimEnd()} …` : `${s} …`;
}

export function createOllamaEngine({ config, knowledge, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  const o = config.ollama;
  const where = o.remote ? 'another machine (IRUSHY_OLLAMA_ALLOW_REMOTE=true)' : 'this machine';
  return {
    name: 'ollama',
    version: OLLAMA_CLIENT_VERSION,
    requiresKey: false,
    usesNetwork: true,
    model: o.model,
    // Configured = connected. Whether Ollama is running and the model is
    // installed is checked by probe() (startup log, /api/health?deep=1).
    connected: () => true,
    describe: () => ({
      engine: 'ollama',
      engine_version: OLLAMA_CLIENT_VERSION,
      requires_key: false,
      uses_network: true,
      model: o.model,
      host: where,
      cloud_model: o.cloud
    }),
    async answer({ mode, lang, message, history, hits, destinations, context, classification, assessment }) {
      const testContext = testContextFor({ assessment, context, knowledge });
      const refs = buildReferences({ hits, knowledge, lang, classification, extraIds: testContext && testContext.conceptRef ? [testContext.conceptRef] : [] });
      const messages = buildMessages({ mode, lang, message, history, hits: refs, destinations, testContext });
      const seed = makeSeed(['ollama', OLLAMA_CLIENT_VERSION, knowledge.version, o.model, JSON.stringify(messages)]);
      const options = { temperature: 0, seed: seedNumber(seed), num_predict: o.maxOutputTokens, ...(o.numCtx ? { num_ctx: o.numCtx } : {}) };
      const result = await ollamaChat({
        baseUrl: o.baseUrl,
        model: o.model,
        messages,
        options,
        timeoutMs: o.timeoutMs,
        maxRetries: o.maxRetries,
        fetchImpl
      });
      const text = result.doneReason === 'length' ? dropUnfinishedSentence(result.content) : result.content;
      const provenance = referenceProvenance(refs);
      return {
        text,
        citations: [],
        usedIds: refs.map((r) => r.id),
        provenance,
        // the model may use a sample entry without citing it
        sampleContentUsed: provenance.includes('sample-unapproved'),
        source: 'ollama',
        providerModel: result.model,
        debug: {
          engine: 'ollama',
          engine_version: OLLAMA_CLIENT_VERSION,
          model: o.model,
          retrieved: (hits || []).map((h) => h.id),
          references: refs.map((r) => r.id),
          test_context: !!testContext,
          seed,
          options,
          done_reason: result.doneReason,
          eval_count: result.evalCount,
          prompt_eval_count: result.promptEvalCount,
          total_ms: result.totalMs
        }
      };
    },
    // Is Ollama running, and is the configured model installed (and local)?
    async probe() {
      const out = { ok: false, engine: 'ollama', model: o.model, reachable: false, modelListed: false, remoteModel: false, host: where };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(5000, o.timeoutMs));
      try {
        const res = await fetchImpl(`${o.baseUrl}/api/tags`, { headers: { Accept: 'application/json' }, signal: controller.signal });
        out.reachable = true;
        if (!res.ok) return { ...out, status: res.status };
        const json = await res.json().catch(() => null);
        const entry = findListedModel(json && json.models, o.model);
        out.modelListed = !!entry;
        // A local name can still point at a cloud model (remote_host).
        out.remoteModel = !!(entry && (entry.remote_host || entry.remote_model));
        out.ok = out.modelListed && (!out.remoteModel || o.allowRemote);
        return out;
      } catch (err) {
        return { ...out, reason: err && err.name === 'AbortError' ? 'timeout' : 'network_error' };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
