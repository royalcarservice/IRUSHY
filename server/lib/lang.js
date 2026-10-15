// IRUSHY - language detection and text matching helpers (Tamil + English).
//
// Matching is deliberately simple and deterministic:
//   - English tokens are lower-cased and lightly stemmed (plural "s").
//   - Tamil words take suffixes (case markers, plural, clitics), so a Tamil
//     keyword matches any word that STARTS with the keyword's stem. The stem
//     drops a final "ம்", a final virama or a final vowel sign, because those
//     are the letters that change when a suffix is added:
//       தேர்வு -> தேர்வ  matches தேர்வை, தேர்வில், தேர்வுக்கு
//       நினைவகம் -> நினைவக matches நினைவகத்தை, நினைவகம்
//       பயன் -> பயன matches பயனை, பயனர்

export const TAMIL_RE = /[\u0B80-\u0BFF]/;
const TAMIL_RE_G = /[\u0B80-\u0BFF]/g;
const LATIN_LETTER_G = /[A-Za-z]/g;

const VIRAMA = '\u0BCD';
const VOWEL_SIGNS = new Set(['\u0BBE', '\u0BBF', '\u0BC0', '\u0BC1', '\u0BC2', '\u0BC6', '\u0BC7', '\u0BC8', '\u0BCA', '\u0BCB', '\u0BCC', '\u0BD7']);

export function hasTamil(text) {
  return TAMIL_RE.test(String(text || ''));
}

// Share of letters that are Tamil (0..1). Digits and punctuation are ignored.
export function tamilShare(text) {
  const s = String(text || '');
  const ta = (s.match(TAMIL_RE_G) || []).length;
  const en = (s.match(LATIN_LETTER_G) || []).length;
  return ta + en === 0 ? 0 : ta / (ta + en);
}

export function parseAcceptLanguage(header) {
  if (typeof header !== 'string' || !header) return [];
  return header
    .split(',')
    .slice(0, 20)
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const qp = params.find((p) => p.trim().startsWith('q='));
      const q = qp ? Number.parseFloat(qp.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
}

// Auto mode: Tamil script in the message wins, then Accept-Language, then
// English. A language chosen in the panel always wins.
// An explicit "explain ... in Tamil" / "ஆங்கிலத்தில் விளக்குங்கள்" in the message
// is honoured in Auto mode ("what is RAM in Tamil" is a term question, not a
// language switch, so it needs an explain/answer verb).
const ASK_TA = /\b(?:explain|answer|reply|tell|say|write|teach|describe|respond)\b[^.?!]{0,60}\b(?:in|into)\s+tamil\b/i;
const ASK_EN = /\b(?:explain|answer|reply|tell|say|write|teach|describe|respond)\b[^.?!]{0,60}\b(?:in|into)\s+english\b|ஆங்கிலத்தில்\s*(?:விளக்க|சொல்|பதில்|கூற|எழுத)/i;

export function detectLang({ requested, message, acceptLanguage }) {
  if (requested === 'ta' || requested === 'en') return { lang: requested, how: 'selected' };
  const m = String(message || '');
  if (ASK_EN.test(m)) return { lang: 'en', how: 'asked-in-message' };
  if (ASK_TA.test(m) || /தமிழில்\s*(?:விளக்க|சொல்|பதில்|கூற|எழுத)/.test(m)) return { lang: 'ta', how: 'asked-in-message' };
  if (hasTamil(m)) return { lang: 'ta', how: 'tamil-script' };
  for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
    const primary = tag.split('-')[0];
    if (primary === 'ta') return { lang: 'ta', how: 'accept-language' };
    if (primary === 'en') return { lang: 'en', how: 'accept-language' };
  }
  return { lang: 'en', how: 'default' };
}

// ---------------------------------------------------------------------------
// normalisation + tokens
// ---------------------------------------------------------------------------
export function normalize(text) {
  return String(text || '')
    .normalize('NFC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const TOKEN_RE = /[a-z0-9]+(?:\+\+|#)?|[\u0B80-\u0BFF]+/g;

export function stemEnglish(token) {
  let t = token;
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 4 && /(?:sses|shes|ches|xes)$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) return t.slice(0, -1);
  return t;
}

// Stems are never shorter than 3 code units, so short words such as ரேம்
// (RAM) keep their full form instead of becoming a two-letter prefix.
export function stemTamil(word) {
  const w = word;
  if (w.length >= 5 && w.endsWith('ம' + VIRAMA)) return w.slice(0, -2);
  const last = w[w.length - 1];
  if (w.length >= 4 && (last === VIRAMA || VOWEL_SIGNS.has(last))) return w.slice(0, -1);
  return w;
}

export function isTamilToken(token) {
  return TAMIL_RE.test(token);
}

// Tokens of a message: English stemmed, Tamil kept whole (prefix-compared).
export function tokenize(text) {
  const norm = normalize(text);
  const raw = norm.match(TOKEN_RE) || [];
  return raw.map((t) => (isTamilToken(t) ? t : stemEnglish(t)));
}

// ---------------------------------------------------------------------------
// phrase matching
// ---------------------------------------------------------------------------
// A compiled phrase is a list of unit matchers. English units compare equal
// after stemming; Tamil units compare by prefix on the keyword's stem.
// Two markers make a word stricter or looser:
//   word!   Tamil: prefix on the WHOLE word, no stemming (நன்றி! does not
//           match நன்று)
//   word*   English: prefix match (regist* matches register, registration)
export function compilePhrase(phrase) {
  const units = [];
  for (const word of String(phrase).trim().split(/\s+/)) {
    const exact = word.endsWith('!');
    const prefix = word.endsWith('*');
    const w = exact || prefix ? word.slice(0, -1) : word;
    for (const t of normalize(w).match(TOKEN_RE) || []) {
      if (isTamilToken(t)) units.push({ ta: true, stem: exact ? t : stemTamil(t) });
      else if (prefix) units.push({ ta: false, prefix: t });
      else units.push({ ta: false, value: stemEnglish(t) });
    }
  }
  return { phrase, units };
}

function unitMatches(unit, token) {
  if (unit.ta) return isTamilToken(token) && token.startsWith(unit.stem);
  if (unit.prefix) return !isTamilToken(token) && token.startsWith(unit.prefix);
  return unit.value === token;
}

// Returns the index of the first token where the phrase matches, or -1.
export function findPhrase(compiled, tokens) {
  const u = compiled.units;
  if (!u.length || u.length > tokens.length) return -1;
  outer: for (let i = 0; i <= tokens.length - u.length; i += 1) {
    for (let j = 0; j < u.length; j += 1) {
      if (!unitMatches(u[j], tokens[i + j])) continue outer;
    }
    return i;
  }
  return -1;
}

export function matchesAny(compiledList, tokens) {
  for (const c of compiledList) if (findPhrase(c, tokens) >= 0) return c.phrase;
  return null;
}

// ---------------------------------------------------------------------------
// content-word overlap (used to rank FAQ entries, key points and examples)
// ---------------------------------------------------------------------------
const STOP_EN = new Set(
  ('a an the is are was were be been am do does did i me my we you your it its this that these those to of in on at for ' +
    'and or but with about can could would should will shall please tell explain give show from by as which what how why ' +
    'when where who whom there here have has had get got want need know like just also so than then too very more most ' +
    'some any one into out up down if not no yes ok okay hi hello thank thanks sir madam mam irushy')
    .split(/\s+/)
    .map(stemEnglish)
);

const STOP_TA = [
  'என்ன', 'எப்படி', 'என்றால்', 'என்பது', 'ஒரு', 'இந்த', 'அந்த', 'மற்றும்', 'பற்றி', 'எனக்கு', 'நான்', 'நீங்கள்', 'உங்கள்',
  'ஆகும்', 'உள்ளது', 'உள்ளன', 'செய்ய', 'வேண்டும்', 'தயவுசெய்து', 'சொல்லுங்கள்', 'கூறுங்கள்', 'விளக்குங்கள்', 'இது', 'அது',
  'எது', 'ஏன்', 'எங்கே', 'யார்', 'எவ்வாறு', 'கொண்டு', 'இல்', 'கூட', 'தான்', 'ஆம்', 'இல்லை'
];

export function contentTokens(text) {
  const out = [];
  for (const t of tokenize(text)) {
    if (isTamilToken(t)) {
      if (STOP_TA.some((s) => t === s)) continue;
      if (t.length < 2) continue;
      out.push(t);
    } else {
      if (STOP_EN.has(t)) continue;
      if (t.length < 2 && !/\d/.test(t)) continue;
      out.push(t);
    }
  }
  return out;
}

// Fraction of query content words that appear in the candidate text
// (Tamil words compared by shared stem prefix).
export function overlapScore(queryTokens, candidateText) {
  if (!queryTokens.length) return 0;
  const cand = contentTokens(candidateText);
  if (!cand.length) return 0;
  let hits = 0;
  for (const q of queryTokens) {
    if (isTamilToken(q)) {
      const qs = stemTamil(q);
      if (cand.some((c) => isTamilToken(c) && (c.startsWith(qs) || q.startsWith(stemTamil(c))))) hits += 1;
    } else if (cand.includes(q)) {
      hits += 1;
    }
  }
  return hits / queryTokens.length;
}

export function slugify(text) {
  return (
    normalize(text)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item'
  );
}

export function pick(obj, lang) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] || obj.en || obj.ta || '';
}
