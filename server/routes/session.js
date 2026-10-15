// IRUSHY - session routes. The demo teacher sign-in exists ONLY for local
// permission testing (IRUSHY_ENABLE_DEMO_LOGIN=true plus a user and a
// password in .env). There is no real teacher account store yet.

import express from 'express';
import crypto from 'node:crypto';

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export function sessionRouter({ config, sessions, log }) {
  const router = express.Router();

  router.get('/session', (req, res) => {
    const s = sessions.read(req);
    res.json({
      ok: true,
      role: s.role,
      modes_allowed: s.role === 'teacher' ? ['home', 'student', 'teacher'] : ['home', 'student'],
      demo_login_enabled: config.features.demoLogin
    });
  });

  router.post('/session/login', (req, res) => {
    if (!config.features.demoLogin) {
      return res.status(501).json({
        ok: false,
        error: {
          code: 'login_not_available',
          retryable: false,
          message: {
            en: 'Teacher sign-in is not connected yet. Please do not type a password into the chat.',
            ta: 'ஆசிரியர் உள்நுழைவு இன்னும் இணைக்கப்படவில்லை. உரையாடலில் கடவுச்சொல்லை டைப் செய்ய வேண்டாம்.'
          }
        }
      });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const okUser = typeof body.username === 'string' && safeEqual(body.username, config.demo.user);
    const okPass = typeof body.password === 'string' && safeEqual(body.password, config.demo.pass);
    if (!(okUser && okPass)) {
      log.warn('demo_login_failed', {});
      return res.status(401).json({
        ok: false,
        error: { code: 'invalid_login', retryable: false, message: { en: 'That sign-in did not work.', ta: 'உள்நுழைவு வெற்றிபெறவில்லை.' } }
      });
    }
    sessions.issue(req, res, { role: 'teacher', name: 'Demo teacher' });
    log.info('demo_login', { role: 'teacher' });
    return res.json({ ok: true, role: 'teacher', note: 'Demo sign-in for local permission testing only.' });
  });

  router.post('/session/logout', (req, res) => {
    sessions.clear(req, res);
    res.json({ ok: true, role: 'visitor' });
  });

  return router;
}
