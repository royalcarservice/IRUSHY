// IRUSHY - mock model provider, used ONLY to test the optional backends:
//   OpenAI-compatible routes (/v1/...)  for IRUSHY_ENGINE=apinex
//   Ollama native routes     (/api/...) for IRUSHY_ENGINE=ollama
// The default local engine never talks to it, and the UI suite does not use
// it. No real provider and no real Ollama is ever contacted by the suites.
//
//   node tools/mock-provider.mjs            (prints the port)
//   import { startMockProvider } from './mock-provider.mjs'
//
// Modes (POST /__control {"mode": "..."}), for both APIs:
//   ok       a "hostile" answer: a <script> tag, an unverified URL, a
//            verified URL, an invented citation and a real one
//   401 402 404 429 400 500 503   that HTTP status
//   slow     waits 5 s (to exercise the client timeout)
//   badjson  returns text that is not JSON
//   empty    returns a completion with no text
//   onlyurl  an answer that is nothing but an unverified URL
//   sample   an answer citing a sample-unapproved concept note
//   long     an answer far longer than IRUSHY_MAX_ANSWER_CHARS
//   think    a reasoning block (<think>...</think>) before the answer
//   length   stopped at the token limit, mid-sentence (Ollama: done_reason)
// Ollama only: a model that is not in MOCK_OLLAMA_MODELS gets the real
// Ollama 404 ("model ... not found, try pulling it first").

import http from 'node:http';

export const HOSTILE_ANSWER =
  'The study materials are on the Materials page [faq.find-materials]. ' +
  'Also see [faq.invented-entry]. <script>alert(1)</script> **Bold** ' +
  'Visit https://evil.example.com/steal and https://tnhhsscta.com/AmmaURL.asp';

export const REASONING_MARKER = 'REASONING-TRACE-MUST-NOT-SHOW';

const LONG_SENTENCE = 'RAM is the working memory of a computer and it loses its contents when the power goes off [concept.computer-memory]. ';

export const MODE_ANSWERS = {
  ok: HOSTILE_ANSWER,
  onlyurl: 'https://evil.example.com/only',
  sample: 'RAM is volatile memory: it loses its contents when the power goes off [concept.computer-memory].',
  long: LONG_SENTENCE.repeat(60),
  think: `<think>${REASONING_MARKER} the student wants materials</think>The study materials are on the Materials page [faq.find-materials].`,
  length: 'RAM is volatile memory [concept.computer-memory]. It keeps the programs that are running. When the power goes off, the data in RAM is'
};

// What GET /api/tags lists. The alias points at a cloud model, the way a
// local name can (remote_host / remote_model).
export const MOCK_OLLAMA_MODELS = [
  { name: 'irushy-test:latest', model: 'irushy-test:latest', size: 1, digest: 'mock', details: { format: 'gguf', family: 'mock', parameter_size: '1B' } },
  { name: 'irushy-alias:latest', model: 'irushy-alias:latest', remote_model: 'gpt-oss:120b', remote_host: 'https://ollama.com:443', details: {} }
];

function ollamaListed(model) {
  const name = String(model || '');
  const tagged = name.lastIndexOf(':') > name.lastIndexOf('/') ? name : `${name}:latest`;
  return MOCK_OLLAMA_MODELS.some((m) => m.name === tagged || m.name === name);
}

export async function startMockProvider({ port = 0, model = 'free/gemini-3.8-flash' } = {}) {
  const state = { mode: 'ok', calls: [], modelsCalls: 0, tagsCalls: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2e6) req.destroy();
    });
    req.on('end', async () => {
      const send = (status, obj, type = 'application/json') => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(status, { 'Content-Type': type });
        res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
      };
      if (req.url === '/__control' && req.method === 'POST') {
        try {
          const b = JSON.parse(raw || '{}');
          if (b.mode) state.mode = b.mode;
          if (b.reset) state.calls = [];
        } catch {
          /* ignore */
        }
        return send(200, { ok: true, mode: state.mode });
      }
      if (req.url === '/__calls') return send(200, state.calls);

      // ---- OpenAI-compatible (APInex) ----------------------------------
      if (req.url === '/v1/models') {
        state.modelsCalls += 1;
        return send(200, { object: 'list', data: [{ id: model, object: 'model' }] });
      }
      if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        let body = null;
        try {
          body = JSON.parse(raw);
        } catch {
          /* ignore */
        }
        state.calls.push({ api: 'openai', authorization: req.headers.authorization || null, body });
        const m = state.mode;
        if (/^\d{3}$/.test(m)) return send(Number(m), { error: { message: m === '404' ? 'model not found' : `mock ${m}` } });
        if (m === 'slow') await new Promise((r) => setTimeout(r, 5000));
        if (m === 'badjson') return send(200, 'this is not json', 'text/plain');
        if (m === 'empty') return send(200, { id: 'x', model, choices: [{ index: 0, message: { role: 'assistant', content: '' } }] });
        return send(200, {
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          model,
          choices: [{ index: 0, finish_reason: m === 'length' ? 'length' : 'stop', message: { role: 'assistant', content: MODE_ANSWERS[m] || HOSTILE_ANSWER } }]
        });
      }

      // ---- Ollama native API -------------------------------------------
      if (req.url === '/api/version') return send(200, { version: '0.12.0-mock' });
      if (req.url === '/api/tags' && req.method === 'GET') {
        state.tagsCalls += 1;
        return send(200, { models: MOCK_OLLAMA_MODELS });
      }
      if (req.url === '/api/chat' && req.method === 'POST') {
        let body = null;
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { error: 'invalid JSON' });
        }
        state.calls.push({ api: 'ollama', authorization: req.headers.authorization || null, body });
        const m = state.mode;
        if (!ollamaListed(body.model)) return send(404, { error: `model "${body.model}" not found, try pulling it first` });
        if (/^\d{3}$/.test(m)) return send(Number(m), { error: m === '404' ? `model "${body.model}" not found, try pulling it first` : `mock ${m}` });
        if (m === 'slow') await new Promise((r) => setTimeout(r, 5000));
        if (m === 'badjson') return send(200, 'this is not json', 'text/plain');
        const content = m === 'empty' ? '' : MODE_ANSWERS[m] || HOSTILE_ANSWER;
        // The two probes sent by tools/verify-ollama.mjs get short replies.
        const last = Array.isArray(body.messages) && body.messages.length ? String(body.messages[body.messages.length - 1].content || '') : '';
        let reply = content;
        if (/^வணக்கம்/.test(last.trim())) reply = 'வணக்கம். நான் தயாராக இருக்கிறேன்.';
        else if (/single word: ready/i.test(JSON.stringify(body.messages || []))) reply = 'ready';
        return send(200, {
          model: body.model,
          created_at: '2026-10-15T00:00:00Z',
          message: { role: 'assistant', content: reply, ...(m === 'think' ? { thinking: REASONING_MARKER } : {}) },
          done: true,
          done_reason: m === 'length' ? 'length' : 'stop',
          total_duration: 1234000000,
          prompt_eval_count: 321,
          eval_count: 42
        });
      }
      return send(404, { error: 'not found' });
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const actual = server.address().port;
  return {
    port: actual,
    baseUrl: `http://127.0.0.1:${actual}/v1`,
    ollamaUrl: `http://127.0.0.1:${actual}`,
    state,
    setMode(mode) {
      state.mode = mode;
    },
    reset() {
      state.calls = [];
      state.mode = 'ok';
    },
    close: () =>
      new Promise((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      })
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = Number(process.env.PORT || 0);
  startMockProvider({ port: p }).then((m) => {
    process.stdout.write(`mock provider listening on ${m.baseUrl} (OpenAI-compatible) and ${m.ollamaUrl} (Ollama)\n`);
  });
}
