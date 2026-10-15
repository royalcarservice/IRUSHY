// IRUSHY - logger with secret redaction.
//
// One JSON object per line. Message bodies are never logged unless
// IRUSHY_LOG_MESSAGE_BODIES=true, and even then every known secret value,
// anything that looks like an API key, and Authorization headers are
// replaced with [redacted] before the line is written.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const KEY_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  // "password":"..." inside a JSON line: keep the quotes so the line stays JSON
  /("(?:authorization|x-api-key|api[_-]?key|apikey|password|passwd|secret|token)"\s*:\s*")([^"]*)(")/gi,
  // password=... / Authorization: ... in plain text
  /\b(authorization|x-api-key|api[_-]?key|password|secret)(\s*[:=]\s*)([^\s",}]+)/gi
];

export function makeRedactor(secrets = []) {
  const list = [...new Set(secrets.filter((s) => typeof s === 'string' && s.length >= 6))].sort(
    (a, b) => b.length - a.length
  );
  return function redact(text) {
    let out = String(text);
    for (const s of list) out = out.split(s).join('[redacted]');
    out = out.replace(KEY_PATTERNS[0], '[redacted]');
    out = out.replace(KEY_PATTERNS[1], 'Bearer [redacted]');
    out = out.replace(KEY_PATTERNS[2], '$1[redacted]$3');
    out = out.replace(KEY_PATTERNS[3], '$1$2[redacted]');
    return out;
  };
}

export function createLogger({ level = 'info', secrets = [], sink } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const redact = makeRedactor(secrets);
  const write =
    sink ||
    ((lvl, line) => {
      if (lvl === 'error' || lvl === 'warn') process.stderr.write(line + '\n');
      else process.stdout.write(line + '\n');
    });

  function emit(lvl, msg, fields) {
    if ((LEVELS[lvl] ?? 99) > threshold) return;
    let line;
    try {
      line = JSON.stringify({ t: new Date().toISOString(), level: lvl, msg, ...(fields || {}) });
    } catch {
      line = JSON.stringify({ t: new Date().toISOString(), level: lvl, msg: String(msg) });
    }
    write(lvl, redact(line));
  }

  return {
    error: (msg, fields) => emit('error', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    debug: (msg, fields) => emit('debug', msg, fields),
    redact
  };
}
