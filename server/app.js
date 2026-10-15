// IRUSHY - Express application (exported separately so tests can build it).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { createSessionManager } from './lib/session.js';
import { createRateLimiter } from './lib/limits.js';
import { buildIndex } from './lib/retrieve.js';
import { errorInfo } from './lib/errors.js';
import { siteRouter } from './routes/site.js';
import { sessionRouter } from './routes/session.js';
import { chatRouter } from './routes/chat.js';
import { teacherRouter } from './routes/teacher.js';

// Hashes of the inline <script> blocks in the site copy, so the page CSP can
// allow exactly those scripts and nothing else inline.
function inlineScriptHashes(publicDir) {
  const hashes = new Set();
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.html')) {
        const html = fs.readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
          hashes.add(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`);
        }
      }
    }
  };
  walk(publicDir);
  return [...hashes];
}

export function createApp({ config, knowledge, engine, log }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const startedAt = Date.now();

  const sessions = createSessionManager({
    secret: config.session.secret,
    cookieName: config.session.cookieName,
    ttlMs: config.session.ttlMs,
    secureCookies: config.session.secureCookies
  });
  const index = buildIndex(knowledge);
  const clientKey = (req) => (config.trustProxy ? req.ip : req.socket.remoteAddress) || 'unknown';
  const readLimiter = createRateLimiter({ windowMs: config.limits.rateLimitWindowMs, max: config.limits.readLimitMax, name: 'read' });
  const chatLimiter = createRateLimiter({ windowMs: config.limits.rateLimitWindowMs, max: config.limits.rateLimitMax, name: 'chat' });

  const scriptHashes = inlineScriptHashes(config.publicDir);
  const siteCsp = [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self' https://www.youtube-nocookie.com",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');

  // ---- security headers -------------------------------------------------
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    if (req.path.startsWith('/api/')) {
      res.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      res.set('X-Frame-Options', 'DENY');
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');
    } else {
      res.set('Content-Security-Policy', siteCsp);
      res.set('X-Frame-Options', 'SAMEORIGIN');
      res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    }
    next();
  });

  // ---- CORS: only allow-listed origins get CORS headers. Same-origin
  // requests (the widget on this server) never need them.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
        res.set('Access-Control-Max-Age', '600');
        return res.status(204).end();
      }
    } else if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  });

  // ---- read budget for every GET /api/* (the chat budget is separate) ----
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const r = readLimiter.hit(clientKey(req));
    if (!r.ok) {
      res.set('Retry-After', String(Math.ceil(r.retryAfterMs / 1000)));
      const info = errorInfo('rate_limited');
      return res.status(429).json({ ok: false, error: { code: info.code, retryable: true, message: info.message } });
    }
    return next();
  });

  app.use('/api', express.json({ limit: `${config.limits.bodyLimitKb}kb`, strict: true, type: ['application/json', 'application/*+json'] }));

  app.use('/api', siteRouter({ config, knowledge, engine, sessions, startedAt }));
  app.use('/api', sessionRouter({ config, sessions, log }));
  app.use('/api', chatRouter({ config, knowledge, engine, sessions, index, log, chatLimiter, clientKey }));
  app.use('/api', teacherRouter({ config, knowledge, sessions, log }));

  app.use('/api', (req, res) => {
    res.status(404).json({ ok: false, error: { code: 'not_found', retryable: false, message: { en: 'Unknown API route.', ta: 'தெரியாத API வழி.' } } });
  });

  // ---- the local copy of the website + the widget ------------------------
  app.use(
    express.static(config.publicDir, {
      index: 'index.html',
      extensions: ['html'],
      dotfiles: 'ignore',
      maxAge: config.isProduction ? '1h' : 0
    })
  );

  // ---- errors ---------------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const isApi = req.path.startsWith('/api/');
    let code = 'server_error';
    if (err && err.type === 'entity.too.large') code = 'body_too_large';
    else if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) code = 'bad_request';
    if (code === 'server_error') log.error('unhandled_error', { path: req.path, error: String(err && err.message ? err.message : err).slice(0, 300) });
    const info = errorInfo(code);
    if (!isApi) return res.status(info.status).type('text/plain').send(info.message.en);
    return res.status(info.status).json({
      ok: false,
      lang: 'en',
      error: { code: info.code, retryable: info.retryable, message: info.message },
      links: knowledge.sitePages.slice(0, 4).map((p) => ({ id: p.id, title: p.title, url: p.url }))
    });
  });

  return app;
}
