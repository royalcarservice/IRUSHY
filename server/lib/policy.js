// IRUSHY - server-side policy decisions.
//
//   resolveMode()        the ONLY place that decides home | student | teacher
//   requireTeacher()     middleware every /api/teacher/* route uses
//   evaluateAssessment() the assessment guard: answers for a test are only
//                        discussed when a server-signed token says the test
//                        is completed and returned
//   resultsAccess()      student results: always unavailable, never simulated
//
// None of these trust anything the browser says about itself.

import crypto from 'node:crypto';

export const MODES = Object.freeze(['home', 'student', 'teacher']);

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
export function resolveMode(requested, session) {
  const req = MODES.includes(requested) ? requested : 'home';
  if (req === 'teacher' && session?.role !== 'teacher') {
    return {
      mode: 'home',
      requested: req,
      downgraded: true,
      reason: 'not_signed_in_as_teacher',
      notice:
        'Teacher mode was requested but this session is NOT signed in as a teacher, ' +
        'so the request was downgraded to Home mode. Teacher tools need a real teacher sign-in.'
    };
  }
  return { mode: req, requested: req, downgraded: false, reason: null, notice: null };
}

export function requireTeacher(sessions) {
  return function requireTeacherMiddleware(req, res, next) {
    const session = sessions.read(req);
    if (session.role !== 'teacher') {
      return res.status(403).json({
        ok: false,
        error: {
          code: 'teacher_only',
          retryable: false,
          message: {
            en: 'This is a teacher tool. It needs a signed-in teacher account. Choosing Teacher in the panel does not grant access.',
            ta: 'இது ஆசிரியர்களுக்கான கருவி. இதற்கு உள்நுழைந்த ஆசிரியர் கணக்கு தேவை. குழுவில் "ஆசிரியர்" என்பதைத் தேர்வு செய்வதால் மட்டும் அனுமதி கிடைக்காது.'
          }
        }
      });
    }
    req.irushySession = session;
    return next();
  };
}

// ---------------------------------------------------------------------------
// Assessment token
//   token = base64url(JSON({studentRef, testId, status, completedAt,
//                           anonymousPermitted?})) + "." +
//           base64url(HMAC-SHA256(body, IRUSHY_ASSESSMENT_SECRET))
// ---------------------------------------------------------------------------
export function mintAssessmentToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAssessmentToken(token, secret) {
  if (!secret) return { valid: false, reason: 'no_secret_configured' };
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) return { valid: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { valid: false, reason: 'malformed' };
  const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'bad_signature' };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  if (!payload || typeof payload !== 'object') return { valid: false, reason: 'malformed' };
  if (!['active', 'completed'].includes(payload.status)) return { valid: false, reason: 'unknown_status' };
  if (typeof payload.testId !== 'string' || !payload.testId) return { valid: false, reason: 'missing_test_id' };
  return { valid: true, payload };
}

// Fields that mean "this request is about a test". If any is present the
// guard decides before any engine is called.
const ASSESSMENT_FIELDS = [
  'assessmentToken',
  'assessmentStatus',
  'completedTest',
  'testCompleted',
  'testId',
  'selectedAnswer',
  'correctAnswer'
];

export function evaluateAssessment({ context, session, secret }) {
  const ctx = context && typeof context === 'object' ? context : {};
  const present = ASSESSMENT_FIELDS.some((f) => ctx[f] !== undefined && ctx[f] !== null && ctx[f] !== '');
  if (!present) {
    return { present: false, status: 'none', verified: false, source: 'none', reason: null, testId: null };
  }
  const claimed = ctx.assessmentStatus ?? ctx.completedTest ?? ctx.testCompleted;
  if (!ctx.assessmentToken) {
    return {
      present: true,
      status: 'active',
      verified: false,
      source: claimed !== undefined ? 'client-claim-ignored' : 'no-token',
      reason: 'no_signed_token',
      testId: null
    };
  }
  const v = verifyAssessmentToken(ctx.assessmentToken, secret);
  if (!v.valid) {
    return { present: true, status: 'active', verified: false, source: 'signed-token', reason: v.reason, testId: null };
  }
  const p = v.payload;
  if (p.status !== 'completed') {
    return { present: true, status: 'active', verified: true, source: 'signed-token', reason: 'test_still_active', testId: p.testId };
  }
  const studentMatches = session?.role === 'student' && session.studentRef && session.studentRef === p.studentRef;
  if (!studentMatches && p.anonymousPermitted !== true) {
    return {
      present: true,
      status: 'active',
      verified: true,
      source: 'signed-token',
      reason: 'completed_but_not_permitted_for_this_session',
      testId: p.testId
    };
  }
  return { present: true, status: 'completed', verified: true, source: 'signed-token', reason: null, testId: p.testId };
}

// ---------------------------------------------------------------------------
// Student results
// ---------------------------------------------------------------------------
export function resultsAccess() {
  return {
    available: false,
    reason: 'no_permission_source',
    neverSimulated: true,
    message: {
      en: 'Student results are not available. They need real teacher-to-student permissions, which do not exist yet.',
      ta: 'மாணவர் முடிவுகள் கிடைக்கவில்லை. அதற்கு உண்மையான ஆசிரியர்-மாணவர் அனுமதி அமைப்பு தேவை; அது இன்னும் உருவாக்கப்படவில்லை.'
    }
  };
}
