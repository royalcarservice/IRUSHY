// IRUSHY - configuration.
//
// Everything the server needs comes from environment variables, optionally
// loaded from a local `.env` file (never committed). There are no required
// variables: with no `.env` at all IRUSHY starts with its own local engine,
// which needs no key, no account and no network.
//
// The optional APInex backend is only used when IRUSHY_ENGINE=apinex is set
// explicitly. Nothing in this file falls back to it.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ENGINES = Object.freeze(['local', 'apinex']);
export const APINEX_KEY_PLACEHOLDER = 'sk-apx-REPLACE_ME';

// ---------------------------------------------------------------------------
// .env loader: KEY=VALUE lines, `#` comments (also trailing ` # comment`),
// optional single/double quotes. Real environment variables always win.
// ---------------------------------------------------------------------------
export function parseEnvText(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    if (/^"/.test(value)) {
      const end = value.indexOf('"', 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else if (/^'/.test(value)) {
      const end = value.indexOf("'", 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[m[1]] = value;
  }
  return out;
}

export function loadEnvFile(file, env = process.env) {
  if (!file || file === 'none') return { loaded: false, file: null, keys: [] };
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { loaded: false, file, keys: [] };
  }
  const parsed = parseEnvText(text);
  const keys = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] === undefined) {
      env[k] = v;
      keys.push(k);
    }
  }
  return { loaded: true, file, keys };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function str(env, name, fallback = '') {
  const v = env[name];
  return v === undefined || v === null ? fallback : String(v).trim();
}

function int(env, name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = str(env, name, '');
  if (raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new ConfigError(`${name} must be a whole number (got "${raw}")`);
  return Math.min(max, Math.max(min, n));
}

function bool(env, name, fallback) {
  const raw = str(env, name, '').toLowerCase();
  if (raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`${name} must be true or false (got "${raw}")`);
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// ---------------------------------------------------------------------------
// buildConfig
// ---------------------------------------------------------------------------
export function buildConfig(env = process.env, { root = ROOT } = {}) {
  const nodeEnv = str(env, 'NODE_ENV', 'development') || 'development';
  const isProduction = nodeEnv === 'production';

  const engineRaw = str(env, 'IRUSHY_ENGINE', 'local').toLowerCase() || 'local';
  if (!ENGINES.includes(engineRaw)) {
    throw new ConfigError(
      `IRUSHY_ENGINE must be one of ${ENGINES.join(', ')} (got "${engineRaw}"). ` +
        'IRUSHY does not guess a backend; fix the setting and restart.'
    );
  }

  const apiKey = str(env, 'APINEX_API_KEY', '');
  const keyConfigured = apiKey !== '' && apiKey !== APINEX_KEY_PLACEHOLDER;

  const sessionSecretRaw = str(env, 'IRUSHY_SESSION_SECRET', '');
  const sessionSecret = sessionSecretRaw || crypto.randomBytes(32).toString('hex');

  const allowSample = bool(env, 'IRUSHY_ALLOW_SAMPLE_CONTENT', !isProduction);

  const demoUser = str(env, 'IRUSHY_DEMO_TEACHER_USER', '');
  const demoPass = str(env, 'IRUSHY_DEMO_TEACHER_PASS', '');
  const demoLoginRequested = bool(env, 'IRUSHY_ENABLE_DEMO_LOGIN', false);

  // The local engine costs no provider quota, so its default per-IP chat
  // budget is larger than the APInex one (which mirrors the 5 RPM free tier).
  const defaultChatMax = engineRaw === 'apinex' ? 20 : 60;
  const rateLimitMax = int(env, 'IRUSHY_RATE_LIMIT_MAX', defaultChatMax, { min: 1, max: 100000 });

  const allowedOrigins = str(
    env,
    'IRUSHY_ALLOWED_ORIGINS',
    'https://tnhhsscta.com,https://www.tnhhsscta.com,http://localhost:8787'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const config = {
    root,
    nodeEnv,
    isProduction,
    port: int(env, 'PORT', 8787, { min: 0, max: 65535 }),
    host: str(env, 'HOST', '0.0.0.0') || '0.0.0.0',
    trustProxy: bool(env, 'IRUSHY_TRUST_PROXY', false),

    dataDir: path.resolve(root, str(env, 'IRUSHY_DATA_DIR', 'data') || 'data'),
    publicDir: path.resolve(root, 'public'),

    engine: engineRaw,

    // Optional backend. Only read when engine === 'apinex'.
    apinex: {
      baseUrl: (str(env, 'APINEX_BASE_URL', 'https://api.apinex.bond/v1') || 'https://api.apinex.bond/v1').replace(/\/+$/, ''),
      model: str(env, 'APINEX_MODEL', 'free/gemini-3.8-flash') || 'free/gemini-3.8-flash',
      apiKey: keyConfigured ? apiKey : '',
      keyConfigured,
      keyPlaceholder: apiKey === APINEX_KEY_PLACEHOLDER,
      allowModelFallback: bool(env, 'IRUSHY_ALLOW_MODEL_FALLBACK', false),
      fallbackModel: str(env, 'APINEX_FALLBACK_MODEL', ''),
      maxOutputTokens: int(env, 'IRUSHY_MAX_OUTPUT_TOKENS', 700, { min: 50, max: 4000 }),
      timeoutMs: int(env, 'IRUSHY_REQUEST_TIMEOUT_MS', 30000, { min: 1000, max: 120000 }),
      maxRetries: int(env, 'IRUSHY_MAX_PROVIDER_RETRIES', 1, { min: 0, max: 2 }),
      rpm: int(env, 'IRUSHY_PROVIDER_RPM', 5, { min: 1, max: 600 }),
      enableWebSearch: bool(env, 'IRUSHY_ENABLE_WEB_SEARCH', false)
    },

    limits: {
      maxInputChars: int(env, 'IRUSHY_MAX_INPUT_CHARS', 2000, { min: 50, max: 20000 }),
      maxHistoryMessages: int(env, 'IRUSHY_MAX_HISTORY_MESSAGES', 8, { min: 0, max: 40 }),
      maxHistoryChars: int(env, 'IRUSHY_MAX_HISTORY_CHARS', 6000, { min: 0, max: 50000 }),
      maxHistoryItemChars: 1200,
      maxAnswerChars: int(env, 'IRUSHY_MAX_ANSWER_CHARS', 2400, { min: 200, max: 10000 }),
      bodyLimitKb: int(env, 'IRUSHY_BODY_LIMIT_KB', 32, { min: 1, max: 1024 }),
      rateLimitMax,
      rateLimitWindowMs: int(env, 'IRUSHY_RATE_LIMIT_WINDOW_MS', 300000, { min: 1000, max: 86400000 }),
      readLimitMax: int(env, 'IRUSHY_READ_LIMIT_MAX', rateLimitMax * 6, { min: 1, max: 1000000 }),
      maxConcurrent: int(env, 'IRUSHY_MAX_CONCURRENT', 2, { min: 1, max: 64 }),
      queueTimeoutMs: int(env, 'IRUSHY_QUEUE_TIMEOUT_MS', 15000, { min: 100, max: 120000 }),
      maxQueue: int(env, 'IRUSHY_MAX_QUEUE', 50, { min: 1, max: 10000 }),
      duplicateWindowMs: int(env, 'IRUSHY_DUPLICATE_WINDOW_MS', 30000, { min: 0, max: 600000 })
    },

    allowedOrigins,

    session: {
      secret: sessionSecret,
      secretEphemeral: sessionSecretRaw === '',
      cookieName: 'irushy_sid',
      ttlMs: 8 * 60 * 60 * 1000,
      secureCookies: isProduction
    },

    assessmentSecret: str(env, 'IRUSHY_ASSESSMENT_SECRET', ''),

    features: {
      allowSample,
      // Results stay unavailable whatever this says: there is no permission
      // source. The flag is read only so diagnostics can report it.
      studentResultsRequested: bool(env, 'IRUSHY_ENABLE_STUDENT_RESULTS', false),
      demoLogin: demoLoginRequested && demoUser !== '' && demoPass !== '',
      demoLoginRequested,
      debugField: bool(env, 'IRUSHY_ENGINE_DEBUG', true)
    },

    demo: { user: demoUser, pass: demoPass },

    log: {
      level: (str(env, 'IRUSHY_LOG_LEVEL', 'info') || 'info').toLowerCase(),
      messageBodies: bool(env, 'IRUSHY_LOG_MESSAGE_BODIES', false)
    }
  };

  return config;
}

// Strings that must never appear in a log line or a response.
export function secretValues(config) {
  return [
    config.apinex.apiKey,
    config.session.secretEphemeral ? '' : config.session.secret,
    config.session.secret,
    config.assessmentSecret,
    config.demo.pass
  ].filter((s) => typeof s === 'string' && s.length >= 6);
}

// Names of the variables a deployment cares about, with "set"/"unset" only.
export function diagnosticsView(config, env = process.env) {
  const state = (name) => {
    const v = env[name];
    if (v === undefined || String(v).trim() === '') return 'unset';
    if (name === 'APINEX_API_KEY' && String(v).trim() === APINEX_KEY_PLACEHOLDER) return 'placeholder';
    return 'set';
  };
  return {
    engine: config.engine,
    nodeEnv: config.nodeEnv,
    variables: {
      IRUSHY_ENGINE: state('IRUSHY_ENGINE'),
      APINEX_API_KEY: state('APINEX_API_KEY'),
      APINEX_BASE_URL: state('APINEX_BASE_URL'),
      APINEX_MODEL: state('APINEX_MODEL'),
      IRUSHY_SESSION_SECRET: state('IRUSHY_SESSION_SECRET'),
      IRUSHY_ASSESSMENT_SECRET: state('IRUSHY_ASSESSMENT_SECRET'),
      IRUSHY_ALLOW_SAMPLE_CONTENT: state('IRUSHY_ALLOW_SAMPLE_CONTENT'),
      IRUSHY_ENABLE_DEMO_LOGIN: state('IRUSHY_ENABLE_DEMO_LOGIN'),
      IRUSHY_DEMO_TEACHER_USER: state('IRUSHY_DEMO_TEACHER_USER'),
      IRUSHY_DEMO_TEACHER_PASS: state('IRUSHY_DEMO_TEACHER_PASS')
    },
    notes: [
      'Values are never shown here, only whether a variable is set.',
      config.engine === 'local'
        ? 'The local engine needs no API key; APINEX_* variables are ignored.'
        : 'IRUSHY_ENGINE=apinex: answers need APINEX_API_KEY on this server.'
    ]
  };
}
