#!/usr/bin/env node
// IRUSHY - OPTIONAL check of a real APInex account. npm run verify:apinex
//
// This is the only script in the repository that talks to the real APInex
// service, and it is only needed if you choose IRUSHY_ENGINE=apinex. The
// default local engine needs no key and never calls it.
//
// It reads APINEX_* from .env (or the environment), then:
//   1. GET  /models            - is the exact configured model listed?
//   2. POST /chat/completions  - one tiny completion (max_tokens 16)
//   3. POST /chat/completions  - with a deliberately invalid key, to confirm
//                                IRUSHY maps the rejection to invalid_credentials
// It never prints key material (not even its length).
// Without a key it refuses, sends nothing, and exits with code 2.

import path from 'node:path';
import { ROOT, loadEnvFile, buildConfig } from '../server/config.js';
import { chatCompletion } from '../server/lib/engine/apinex.js';

const envSetting = process.env.IRUSHY_ENV_FILE;
loadEnvFile(envSetting === 'none' ? null : envSetting ? path.resolve(ROOT, envSetting) : path.join(ROOT, '.env'));
const config = buildConfig(process.env);
const a = config.apinex;

if (!a.keyConfigured) {
  process.stderr.write(
    'verify-apinex: APINEX_API_KEY is not set (or is still the placeholder), so nothing was sent.\n' +
      'This check is optional: IRUSHY\'s default local engine needs no key.\n' +
      'To check an APInex account, put APINEX_API_KEY in your local .env (never commit it) and run again.\n'
  );
  process.exit(2);
}

const rows = [];
const row = (step, ok, detail) => {
  rows.push({ step, ok, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? `  (${detail})` : ''}\n`);
};

process.stdout.write(`APInex base URL: ${a.baseUrl}\nConfigured model: ${a.model}\nKey: set on this machine (not shown)\n\n`);

try {
  const res = await fetch(`${a.baseUrl}/models`, { headers: { Authorization: `Bearer ${a.apiKey}`, Accept: 'application/json' } });
  const json = await res.json().catch(() => null);
  const ids = Array.isArray(json && json.data) ? json.data.map((m) => m.id) : [];
  row('model list reachable', res.ok, `HTTP ${res.status}`);
  row(`exact model "${a.model}" is listed`, ids.includes(a.model), ids.length ? `${ids.length} models listed` : 'no list returned');
} catch (err) {
  row('model list reachable', false, `network error: ${err.message}`);
}

try {
  const out = await chatCompletion({
    baseUrl: a.baseUrl,
    apiKey: a.apiKey,
    model: a.model,
    messages: [
      { role: 'system', content: 'Reply with the single word: ready' },
      { role: 'user', content: 'Are you ready?' }
    ],
    maxTokens: 16,
    timeoutMs: a.timeoutMs,
    maxRetries: 0,
    fetchImpl: (...args) => fetch(...args)
  });
  row('one small completion', true, `model ${out.model}; reply "${String(out.content).slice(0, 40).replace(/\s+/g, ' ')}"`);
} catch (err) {
  row('one small completion', false, `${err.code || 'error'}: ${err.message}`);
}

try {
  await chatCompletion({
    baseUrl: a.baseUrl,
    apiKey: 'sk-apx-invalid-key-for-irushy-mapping-check',
    model: a.model,
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 4,
    timeoutMs: a.timeoutMs,
    maxRetries: 0,
    fetchImpl: (...args) => fetch(...args)
  });
  row('an invalid key is rejected', false, 'the service accepted an invalid key');
} catch (err) {
  row('an invalid key maps to invalid_credentials', err.code === 'invalid_credentials', err.code);
}

const failed = rows.filter((r) => !r.ok).length;
process.stdout.write(`\n${failed ? `${failed} step(s) failed.` : 'APInex account looks usable for IRUSHY_ENGINE=apinex.'}\n`);
process.stdout.write('Not checked: account balance (no balance endpoint is documented in this repository).\n');
process.exit(failed ? 1 : 0);
