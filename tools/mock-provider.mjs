// IRUSHY - mock OpenAI-compatible provider, used ONLY to test the optional
// APInex backend (IRUSHY_ENGINE=apinex). The default local engine never talks
// to it, and the UI suite does not use it.
//
//   node tools/mock-provider.mjs            (prints the port)
//   import { startMockProvider } from './mock-provider.mjs'
//
// Modes (POST /__control {"mode": "..."}):
//   ok       a "hostile" answer: a <script> tag, an unverified URL, a
//            verified URL, an invented citation and a real one
//   401 402 404 429 400 500 503   that HTTP status
//   slow     waits 5 s (to exercise the client timeout)
//   badjson  returns text that is not JSON
//   empty    returns a completion with no text

import http from 'node:http';

export const HOSTILE_ANSWER =
  'The study materials are on the Materials page [faq.find-materials]. ' +
  'Also see [faq.invented-entry]. <script>alert(1)</script> **Bold** ' +
  'Visit https://evil.example.com/steal and https://tnhhsscta.com/AmmaURL.asp';

export async function startMockProvider({ port = 0, model = 'free/gemini-3.8-flash' } = {}) {
  const state = { mode: 'ok', calls: [], modelsCalls: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 2e6) req.destroy();
    });
    req.on('end', async () => {
      const send = (status, obj, type = 'application/json') => {
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
        state.calls.push({ authorization: req.headers.authorization || null, body });
        const m = state.mode;
        if (/^\d{3}$/.test(m)) return send(Number(m), { error: { message: m === '404' ? 'model not found' : `mock ${m}` } });
        if (m === 'slow') {
          await new Promise((r) => setTimeout(r, 5000));
          if (res.writableEnded || res.destroyed) return undefined;
        }
        if (m === 'badjson') return send(200, 'this is not json', 'text/plain');
        if (m === 'empty') return send(200, { id: 'x', model, choices: [{ index: 0, message: { role: 'assistant', content: '' } }] });
        return send(200, {
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          model,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: HOSTILE_ANSWER } }]
        });
      }
      return send(404, { error: { message: 'not found' } });
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const actual = server.address().port;
  return {
    port: actual,
    baseUrl: `http://127.0.0.1:${actual}/v1`,
    state,
    setMode(mode) {
      state.mode = mode;
    },
    reset() {
      state.calls = [];
      state.mode = 'ok';
    },
    close: () => new Promise((r) => server.close(() => r()))
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = Number(process.env.PORT || 0);
  startMockProvider({ port: p }).then((m) => {
    process.stdout.write(`mock provider listening on ${m.baseUrl}\n`);
  });
}
