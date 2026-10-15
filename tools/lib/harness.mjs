// IRUSHY test harness: start servers, talk HTTP, count checks.

import { spawn } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DENY_NETWORK = path.join(ROOT, 'tools', 'lib', 'deny-network.mjs');

export function createReporter(title) {
  const r = { title, pass: 0, fail: 0, failures: [], sections: [], current: null };
  r.section = (name) => {
    r.current = { name, pass: 0, fail: 0 };
    r.sections.push(r.current);
    process.stdout.write(`\n## ${name}\n`);
  };
  r.check = (name, cond, detail) => {
    const ok = !!cond;
    if (!r.current) r.section('general');
    if (ok) {
      r.pass += 1;
      r.current.pass += 1;
      process.stdout.write(`  PASS  ${name}\n`);
    } else {
      r.fail += 1;
      r.current.fail += 1;
      const d = detail === undefined ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}`;
      r.failures.push(`[${r.current.name}] ${name}${d}`);
      process.stdout.write(`  FAIL  ${name}${d}\n`);
    }
    return ok;
  };
  r.summary = () => {
    process.stdout.write(`\n${'='.repeat(72)}\n${title}\n`);
    for (const s of r.sections) process.stdout.write(`  ${s.fail ? 'FAIL' : 'ok  '}  ${String(s.pass + s.fail).padStart(4)} checks  ${s.name}${s.fail ? `  (${s.fail} failed)` : ''}\n`);
    process.stdout.write(`\nRESULT: ${r.pass} passed, ${r.fail} failed, ${r.pass + r.fail} total\n`);
    if (r.failures.length) {
      process.stdout.write('\nFailures:\n');
      for (const f of r.failures) process.stdout.write(`  - ${f}\n`);
    }
    return r.fail === 0;
  };
  return r;
}

export function rid() {
  return 'test-' + crypto.randomBytes(6).toString('hex');
}

// Starts `node server/index.js` on a free port with a hermetic environment:
// no .env file is read, and nothing is inherited except PATH/HOME.
export async function startServer({ name, env = {}, denyNetwork = true, timeoutMs = 15000 }) {
  const args = denyNetwork ? ['--import', DENY_NETWORK, 'server/index.js'] : ['server/index.js'];
  const childEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    IRUSHY_ENV_FILE: 'none',
    HOST: '127.0.0.1',
    PORT: '0',
    IRUSHY_LOG_LEVEL: 'info',
    ...env
  };
  for (const [k, v] of Object.entries(childEnv)) if (v === undefined || v === null) delete childEnv[k];
  const child = spawn(process.execPath, args, { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (err += d));
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const started = Date.now();
  let port = null;
  while (Date.now() - started < timeoutMs) {
    const m = out.match(/"msg":"listening"[^\n]*?"port":(\d+)/);
    if (m) {
      port = Number(m[1]);
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!port) {
    child.kill('SIGKILL');
    throw new Error(`server "${name}" did not start:\n${out}\n${err}`);
  }
  const srv = {
    name,
    port,
    base: `http://127.0.0.1:${port}`,
    logs: () => out + err,
    stdout: () => out,
    stderr: () => err,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        const t = setTimeout(() => child.kill('SIGKILL'), 4000);
        await exited;
        clearTimeout(t);
      }
      return { out, err };
    }
  };
  return srv;
}

// Runs `node <args>` without blocking this process (spawnSync would freeze
// an in-process mock server the child needs to reach). Hermetic env, as above.
export function runNode(args, { env = {}, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, IRUSHY_ENV_FILE: 'none', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('exit', (status) => {
      clearTimeout(t);
      resolve({ status, stdout, stderr });
    });
  });
}

export async function http(srv, method, p, { body, headers = {}, cookie, raw = false } = {}) {
  const h = { Accept: 'application/json', ...headers };
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  if (cookie) h.Cookie = cookie;
  const res = await fetch(srv.base + p, {
    method,
    headers: h,
    body: body === undefined ? undefined : raw || typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, headers: res.headers, json, text };
}

export async function chat(srv, message, o = {}) {
  const body = {
    message,
    lang: o.lang || 'auto',
    mode_requested: o.mode || 'student',
    request_id: o.request_id || rid(),
    history: o.history || [],
    context: o.context || {},
    debug: o.debug === undefined ? true : o.debug
  };
  if (o.extra) Object.assign(body, o.extra);
  return http(srv, 'POST', '/api/chat', { body, headers: o.headers || {}, cookie: o.cookie });
}

export function turn(user, response) {
  return [
    { role: 'user', content: user },
    { role: 'assistant', content: String((response && response.json && response.json.answer) || '').slice(0, 1200) }
  ];
}
