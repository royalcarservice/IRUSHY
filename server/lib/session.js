// IRUSHY - signed session cookie.
//
// The cookie is the only proof of role. It is HttpOnly (page scripts cannot
// read it), SameSite=Lax, and signed with HMAC-SHA256 over the payload using
// IRUSHY_SESSION_SECRET. Anything that fails verification is treated as an
// anonymous visitor. A client can ask for Teacher mode in the request body;
// that request is never proof of anything (see policy.js).

import crypto from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function signPayload(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySigned(token, secret) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || header.length > 8192) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export const VISITOR = Object.freeze({ role: 'visitor', sid: null, name: null });

export function createSessionManager({ secret, cookieName = 'irushy_sid', ttlMs = 8 * 3600 * 1000, secureCookies = false }) {
  function read(req) {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (!token) return VISITOR;
    const payload = verifySigned(token, secret);
    if (!payload || typeof payload !== 'object') return VISITOR;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return VISITOR;
    if (!['teacher', 'student'].includes(payload.role)) return VISITOR;
    return Object.freeze({
      role: payload.role,
      sid: typeof payload.sid === 'string' ? payload.sid : null,
      name: typeof payload.name === 'string' ? payload.name.slice(0, 60) : null,
      studentRef: typeof payload.studentRef === 'string' ? payload.studentRef.slice(0, 80) : null
    });
  }

  function cookieAttrs(req, maxAgeSec) {
    const secure = secureCookies || req.secure;
    return [
      `Path=/`,
      `HttpOnly`,
      `SameSite=Lax`,
      `Max-Age=${maxAgeSec}`,
      secure ? 'Secure' : null
    ]
      .filter(Boolean)
      .join('; ');
  }

  function issue(req, res, { role, name = null, studentRef = null }) {
    const payload = {
      sid: crypto.randomBytes(12).toString('base64url'),
      role,
      name,
      studentRef,
      exp: Date.now() + ttlMs
    };
    const token = signPayload(payload, secret);
    res.append('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; ${cookieAttrs(req, Math.floor(ttlMs / 1000))}`);
    return payload;
  }

  function clear(req, res) {
    res.append('Set-Cookie', `${cookieName}=; ${cookieAttrs(req, 0)}`);
  }

  return { read, issue, clear, cookieName };
}
