// IRUSHY - OPTIONAL APInex backend (OpenAI-compatible gateway).
//
// Off by default. Used only when IRUSHY_ENGINE=apinex is set explicitly and
// APINEX_API_KEY is on the server. It never switches to another model unless
// IRUSHY_ALLOW_MODEL_FALLBACK=true AND APINEX_FALLBACK_MODEL is set, and it
// is never used as a silent fallback for the local engine. Its RPM bucket
// (IRUSHY_PROVIDER_RPM) only exists here.

import { EngineError } from '../errors.js';
import { buildMessages } from '../prompts.js';
import { createProviderLimiter } from '../limits.js';
import { pick } from '../lang.js';

export const APINEX_CLIENT_VERSION = '1.0.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mapStatus(status, bodyText) {
  if (status === 401 || status === 403) return new EngineError('invalid_credentials', 'provider rejected the key', { status: 502 });
  if (status === 402) return new EngineError('insufficient_quota', 'provider quota exhausted', { status: 502 });
  if (status === 404 || /model[^"]{0,40}(not found|does not exist|unavailable)/i.test(bodyText || '')) {
    return new EngineError('model_unavailable', 'configured model unavailable', { status: 502 });
  }
  if (status === 429) return new EngineError('rate_limited', 'provider rate limit', { status: 429, retryable: true, retryAfterMs: 15000 });
  if (status === 400 || status === 422) return new EngineError('invalid_request', 'provider rejected the request', { status: 502 });
  if (status >= 500) return new EngineError('provider_unavailable', `provider returned ${status}`, { status: 503, retryable: true });
  return new EngineError('bad_provider_response', `unexpected provider status ${status}`, { status: 502, retryable: true });
}

export async function chatCompletion({ baseUrl, apiKey, model, messages, maxTokens, timeoutMs, maxRetries, fetchImpl }) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2, stream: false }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new EngineError('timeout', 'provider timed out', { status: 504, retryable: true });
      throw new EngineError('network_error', 'provider unreachable', { status: 503, retryable: true });
    }
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const e = mapStatus(res.status, text);
      const retryable = [429, 502, 503, 504].includes(res.status);
      if (retryable && attempt <= maxRetries) {
        await sleep(400 * attempt + Math.floor(Math.random() * 300)); // jitter only affects timing, never content
        continue;
      }
      throw e;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new EngineError('bad_provider_response', 'provider sent invalid JSON', { status: 502, retryable: true });
    }
    const content = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new EngineError('bad_provider_response', 'provider sent no answer text', { status: 502, retryable: true });
    }
    return { content, model: json.model || model };
  }
}

function hitText(h, lang) {
  const e = h.entry;
  switch (h.kind) {
    case 'faq':
      return `${pick(e.question, lang)} ${pick(e.answer, lang)}`;
    case 'material':
      return `${pick(e.title, lang)} (${e.class}th ${e.subject}, ${e.medium})`;
    case 'concept':
      return `${pick(e.title, lang)}: ${pick(e.definition, lang)} ${e.keyPoints.map((p) => pick(p, lang)).join(' ')}`;
    case 'question':
      return `${pick(e.question, lang)}`;
    case 'glossary':
      return `${e.en} = ${e.ta}`;
    default:
      return pick(e.title, lang);
  }
}

export function createApinexEngine({ config, knowledge, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  const a = config.apinex;
  const limiter = createProviderLimiter({ rpm: a.rpm });
  return {
    name: 'apinex',
    version: APINEX_CLIENT_VERSION,
    requiresKey: true,
    usesNetwork: true,
    model: a.model,
    connected: () => a.keyConfigured,
    describe: () => ({ engine: 'apinex', engine_version: APINEX_CLIENT_VERSION, requires_key: true, uses_network: true, model: a.model }),
    limiter,
    async answer({ mode, lang, message, history, hits, destinations }) {
      if (!a.keyConfigured) throw new EngineError('not_connected', 'no APInex key on this server', { status: 503 });
      const slot = limiter.tryAcquire();
      if (!slot.ok) throw new EngineError('rate_limited', 'provider RPM budget used', { status: 429, retryable: true, retryAfterMs: slot.retryAfterMs });
      const refs = (hits || []).map((h) => ({ id: h.id, kind: h.kind, provenance: knowledge.idIndex.get(h.id)?.provenance || 'unknown', text: hitText(h, lang) }));
      const messages = buildMessages({ mode, lang, message, history, hits: refs, destinations });
      let result;
      try {
        result = await chatCompletion({
          baseUrl: a.baseUrl,
          apiKey: a.apiKey,
          model: a.model,
          messages,
          maxTokens: a.maxOutputTokens,
          timeoutMs: a.timeoutMs,
          maxRetries: a.maxRetries,
          fetchImpl
        });
      } catch (err) {
        // Only an explicit opt-in may try ONE other model, and only for an
        // unavailable model. Never on by default.
        if (err.code === 'model_unavailable' && a.allowModelFallback && a.fallbackModel) {
          result = await chatCompletion({ baseUrl: a.baseUrl, apiKey: a.apiKey, model: a.fallbackModel, messages, maxTokens: a.maxOutputTokens, timeoutMs: a.timeoutMs, maxRetries: 0, fetchImpl });
          result.fallbackUsed = true;
        } else {
          throw err;
        }
      }
      const usedIds = refs.map((r) => r.id);
      const provenance = [];
      if (refs.some((r) => r.provenance === 'approved')) provenance.push('approved');
      if (refs.some((r) => r.provenance === 'sample-unapproved')) provenance.push('sample-unapproved');
      return {
        text: result.content,
        citations: [],
        usedIds,
        provenance,
        source: 'apinex',
        providerModel: result.model,
        fallbackUsed: !!result.fallbackUsed,
        debug: { engine: 'apinex', model: a.model, retrieved: refs.map((r) => r.id) }
      };
    },
    async probe() {
      if (!a.keyConfigured) return { ok: false, reason: 'not_connected' };
      try {
        const res = await fetchImpl(`${a.baseUrl}/models`, { headers: { Authorization: `Bearer ${a.apiKey}` } });
        if (!res.ok) return { ok: false, status: res.status };
        const json = await res.json().catch(() => null);
        const ids = Array.isArray(json && json.data) ? json.data.map((m) => m.id) : [];
        return { ok: ids.includes(a.model), modelListed: ids.includes(a.model) };
      } catch {
        return { ok: false, reason: 'network_error' };
      }
    }
  };
}
