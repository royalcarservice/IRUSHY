// IRUSHY - error codes the widget understands, with bilingual messages.

export class EngineError extends Error {
  constructor(code, message, { status = 502, retryable = false, retryAfterMs = 0, detail = null } = {}) {
    super(message || code);
    this.name = 'EngineError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.detail = detail;
  }
}

export const ERROR_TEXT = {
  bad_request: { status: 400, retryable: false, en: 'That request could not be read. Please type your question again.', ta: 'அந்தக் கோரிக்கையைப் படிக்க முடியவில்லை. உங்கள் கேள்வியை மீண்டும் டைப் செய்யுங்கள்.' },
  empty_message: { status: 400, retryable: false, en: 'Please type a question first.', ta: 'முதலில் ஒரு கேள்வியை டைப் செய்யுங்கள்.' },
  message_too_long: { status: 413, retryable: false, en: 'That message is too long. Please shorten it and try again.', ta: 'செய்தி மிக நீளமாக உள்ளது. சுருக்கி மீண்டும் முயற்சி செய்யுங்கள்.' },
  body_too_large: { status: 413, retryable: false, en: 'That request is too large.', ta: 'கோரிக்கை மிகப் பெரியதாக உள்ளது.' },
  rate_limited: { status: 429, retryable: true, en: 'Too many questions in a short time. Please wait a little and try again.', ta: 'குறுகிய நேரத்தில் அதிகமான கேள்விகள். சற்று நேரம் கழித்து மீண்டும் முயற்சி செய்யுங்கள்.' },
  busy: { status: 503, retryable: true, en: 'IRUSHY is busy right now. Please try again in a moment.', ta: 'IRUSHY தற்போது பரபரப்பாக உள்ளது. சிறிது நேரத்தில் மீண்டும் முயற்சி செய்யுங்கள்.' },
  engine_error: { status: 500, retryable: true, en: 'IRUSHY could not prepare an answer this time. Please try again, or use the links below.', ta: 'இந்த முறை IRUSHY யால் பதிலைத் தயாரிக்க முடியவில்லை. மீண்டும் முயற்சி செய்யுங்கள், அல்லது கீழே உள்ள இணைப்புகளைப் பயன்படுத்துங்கள்.' },
  // optional APInex backend only
  not_connected: { status: 503, retryable: false, en: 'IRUSHY is not connected yet. The website links below still work.', ta: 'IRUSHY இன்னும் இணைக்கப்படவில்லை. கீழே உள்ள இணையதள இணைப்புகள் வழக்கம்போல் செயல்படும்.' },
  invalid_credentials: { status: 502, retryable: false, en: 'The AI service rejected the server key. The site administrator needs to check it.', ta: 'சேவையகச் சாவியை AI சேவை ஏற்கவில்லை. தள நிர்வாகி அதைச் சரிபார்க்க வேண்டும்.' },
  insufficient_quota: { status: 502, retryable: false, en: 'The AI service account has no quota left. The site administrator needs to check it.', ta: 'AI சேவைக் கணக்கில் ஒதுக்கீடு தீர்ந்துவிட்டது. தள நிர்வாகி அதைச் சரிபார்க்க வேண்டும்.' },
  model_unavailable: { status: 502, retryable: false, en: 'The configured AI model is not available. IRUSHY does not switch models on its own.', ta: 'அமைக்கப்பட்ட AI மாதிரி கிடைக்கவில்லை. IRUSHY தானாக மாதிரியை மாற்றாது.' },
  provider_unavailable: { status: 503, retryable: true, en: 'The AI service is not responding right now. Please try again shortly.', ta: 'AI சேவை தற்போது பதிலளிக்கவில்லை. சிறிது நேரத்தில் மீண்டும் முயற்சி செய்யுங்கள்.' },
  invalid_request: { status: 502, retryable: false, en: 'The AI service could not process this request.', ta: 'இந்தக் கோரிக்கையை AI சேவையால் செயலாக்க முடியவில்லை.' },
  timeout: { status: 504, retryable: true, en: 'The AI service took too long to answer. Please try again.', ta: 'AI சேவை பதிலளிக்க அதிக நேரம் எடுத்தது. மீண்டும் முயற்சி செய்யுங்கள்.' },
  network_error: { status: 503, retryable: true, en: 'The server could not reach the AI service. Please try again shortly.', ta: 'சேவையகத்தால் AI சேவையை அணுக முடியவில்லை. சிறிது நேரத்தில் மீண்டும் முயற்சி செய்யுங்கள்.' },
  bad_provider_response: { status: 502, retryable: true, en: 'The AI service sent an unreadable answer. Please try again.', ta: 'AI சேவை படிக்க முடியாத பதிலை அனுப்பியது. மீண்டும் முயற்சி செய்யுங்கள்.' },
  server_error: { status: 500, retryable: true, en: 'Something went wrong. Please try again.', ta: 'ஏதோ தவறு நடந்தது. மீண்டும் முயற்சி செய்யுங்கள்.' }
};

// For the site administrator (English, names the setting to look at). Only the
// optional APInex backend can produce these configuration errors.
export const ADMIN_HINTS = {
  not_connected: 'IRUSHY_ENGINE=apinex needs APINEX_API_KEY in the server .env. Or remove IRUSHY_ENGINE to use the built-in local engine, which needs no key.',
  invalid_credentials: 'Check APINEX_API_KEY in the server .env, then run npm run verify:apinex.',
  insufficient_quota: 'The APInex account has no quota left. Top it up, or switch back to IRUSHY_ENGINE=local.',
  model_unavailable: 'APINEX_MODEL is not available on this account. IRUSHY does not switch models unless IRUSHY_ALLOW_MODEL_FALLBACK=true.',
  engine_error: 'See the server log line "chat_failed" for this request_id.'
};

export function errorInfo(code) {
  const e = ERROR_TEXT[code] || ERROR_TEXT.server_error;
  const known = ERROR_TEXT[code] ? code : 'server_error';
  const info = { code: known, status: e.status, retryable: e.retryable, message: { en: e.en, ta: e.ta } };
  if (ADMIN_HINTS[known]) info.adminHint = ADMIN_HINTS[known];
  return info;
}
