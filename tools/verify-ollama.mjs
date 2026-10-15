#!/usr/bin/env node
// IRUSHY - OPTIONAL check of a self-hosted Ollama. npm run verify:ollama
//
// Only needed if you choose IRUSHY_ENGINE=ollama. The default local engine
// needs no model and never calls Ollama. This script talks only to
// OLLAMA_BASE_URL (default http://127.0.0.1:11434), and only after the same
// checks the server makes at startup (OLLAMA_MODEL set; another machine or an
// Ollama cloud model only with IRUSHY_OLLAMA_ALLOW_REMOTE=true).
//
// It reads OLLAMA_* from .env (or the environment), then:
//   1. GET  /api/version  - is Ollama running?
//   2. GET  /api/tags     - is the exact model installed, and local?
//   3. POST /api/chat     - one tiny completion
//   4. POST /api/chat     - the same request again: same reply?   (informational)
//   5. POST /api/chat     - a short Tamil message: Tamil reply?   (informational)
// If the settings are incomplete it sends nothing and exits with code 2.

import path from 'node:path';
import { ROOT, loadEnvFile, buildConfig } from '../server/config.js';
import { ollamaChat, findListedModel } from '../server/lib/engine/ollama.js';
import { tamilShare } from '../server/lib/lang.js';

const envSetting = process.env.IRUSHY_ENV_FILE;
loadEnvFile(envSetting === 'none' ? null : envSetting ? path.resolve(ROOT, envSetting) : path.join(ROOT, '.env'));

let o;
try {
  o = buildConfig({ ...process.env, IRUSHY_ENGINE: 'ollama' }).ollama;
} catch (err) {
  process.stderr.write(
    `verify-ollama: ${err.message}\nNothing was sent.\n` +
      'This check is optional: IRUSHY\'s default local engine needs no model and no Ollama.\n'
  );
  process.exit(2);
}

const rows = [];
const row = (step, ok, detail, { info = false } = {}) => {
  rows.push({ step, ok, info });
  const tag = ok ? 'PASS' : info ? 'NOTE' : 'FAIL';
  process.stdout.write(`${tag}  ${step}${detail ? `  (${detail})` : ''}\n`);
};
const timed = (ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
};

process.stdout.write(
  `Ollama: ${o.baseUrl} (${o.remote ? 'another machine, allowed by IRUSHY_OLLAMA_ALLOW_REMOTE' : 'this machine'})\n` +
    `Model: ${o.model}${o.cloud ? ' (cloud model, allowed by IRUSHY_OLLAMA_ALLOW_REMOTE)' : ''}\n\n`
);

let reachable = false;
{
  const t = timed(5000);
  try {
    const res = await fetch(`${o.baseUrl}/api/version`, { headers: { Accept: 'application/json' }, signal: t.signal });
    const json = await res.json().catch(() => null);
    reachable = res.ok;
    row('Ollama is running', res.ok, res.ok ? `version ${json && json.version ? json.version : 'unknown'}` : `HTTP ${res.status}`);
  } catch (err) {
    row('Ollama is running', false, err.name === 'AbortError' ? 'no answer within 5 s' : 'not reachable: start it with "ollama serve" or the Ollama app');
  } finally {
    t.done();
  }
}

if (reachable) {
  const t = timed(5000);
  try {
    const res = await fetch(`${o.baseUrl}/api/tags`, { headers: { Accept: 'application/json' }, signal: t.signal });
    const json = await res.json().catch(() => null);
    const models = json && Array.isArray(json.models) ? json.models : [];
    const entry = findListedModel(models, o.model);
    row(`model "${o.model}" is installed`, !!entry, entry ? entry.name : `not in "ollama list" (${models.length} installed): run "ollama pull ${o.model}"`);
    if (entry) {
      const remote = !!(entry.remote_host || entry.remote_model);
      row('model runs on this machine', !remote || o.allowRemote, remote ? `it points at ${entry.remote_model || 'a cloud model'}${o.allowRemote ? ' (allowed by IRUSHY_OLLAMA_ALLOW_REMOTE)' : '; set IRUSHY_OLLAMA_ALLOW_REMOTE=true or use a local model'}` : 'local weights');
    }
  } catch (err) {
    row(`model "${o.model}" is installed`, false, err.name === 'AbortError' ? 'no answer within 5 s' : err.message);
  } finally {
    t.done();
  }

  const ask = (messages, numPredict) =>
    ollamaChat({
      baseUrl: o.baseUrl,
      model: o.model,
      messages,
      options: { temperature: 0, seed: 7, num_predict: numPredict },
      timeoutMs: Math.max(o.timeoutMs, 60000), // a first request may load the model
      maxRetries: 0,
      fetchImpl: (...a) => fetch(...a)
    });
  const tiny = [
    { role: 'system', content: 'Reply with the single word: ready' },
    { role: 'user', content: 'Are you ready?' }
  ];
  let first = null;
  try {
    const out = await ask(tiny, 16);
    first = out.content;
    row('one small completion', true, `reply "${String(out.content).slice(0, 40).replace(/\s+/g, ' ')}"${out.totalMs ? `, ${out.totalMs} ms` : ''}`);
  } catch (err) {
    row('one small completion', false, `${err.code || 'error'}: ${err.message}`);
  }
  if (first !== null) {
    try {
      const again = await ask(tiny, 16);
      row('same request twice gives the same reply (temperature 0, fixed seed)', again.content === first, again.content === first ? '' : 'replies differ on this model/hardware', { info: true });
    } catch (err) {
      row('same request twice gives the same reply', false, `${err.code || 'error'}: ${err.message}`, { info: true });
    }
    try {
      const ta = await ask(
        [
          { role: 'system', content: 'Answer in Tamil, in one short sentence.' },
          { role: 'user', content: 'வணக்கம்! நீங்கள் தயாரா?' }
        ],
        60
      );
      const share = tamilShare(ta.content);
      row('answers a Tamil message in Tamil', share >= 0.3, `Tamil share ${share.toFixed(2)}${share >= 0.3 ? '' : ': this model may answer Tamil questions in English'}`, { info: true });
    } catch (err) {
      row('answers a Tamil message in Tamil', false, `${err.code || 'error'}: ${err.message}`, { info: true });
    }
  }
}

const failed = rows.filter((r) => !r.ok && !r.info).length;
process.stdout.write(`\n${failed ? `${failed} step(s) failed.` : 'This Ollama looks usable for IRUSHY_ENGINE=ollama.'}\n`);
process.stdout.write('Not checked: answer quality. Ask a teacher to try the questions in docs/VERIFICATION.md.\n');
process.exit(failed ? 1 : 0);
