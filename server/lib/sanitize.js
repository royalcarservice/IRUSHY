// IRUSHY - input cleaning and output checks.
//
// The widget renders answers with textContent, so nothing here is the last
// line of defence; it keeps answers honest:
//   - only verified site URLs may appear in an answer, others are removed
//   - [citation] ids must exist in the loaded data, others are removed
//   - optional-backend (model) output additionally has markup stripped

export function cleanInput(text, maxChars = Infinity) {
  let s = String(text ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > maxChars) s = s.slice(0, maxChars);
  return s;
}

export function cleanHistory(history, { maxMessages, maxChars, maxItemChars }) {
  if (!Array.isArray(history) || maxMessages <= 0) return { history: [], trimmed: Array.isArray(history) && history.length > 0 };
  let items = history
    .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .map((h) => ({ role: h.role, content: cleanInput(h.content, maxItemChars) }))
    .filter((h) => h.content);
  let trimmed = items.length !== history.length;
  if (items.length > maxMessages) {
    items = items.slice(-maxMessages);
    trimmed = true;
  }
  let total = items.reduce((s, h) => s + h.content.length, 0);
  while (items.length && total > maxChars) {
    total -= items[0].content.length;
    items.shift();
    trimmed = true;
  }
  return { history: items, trimmed };
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+|\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s<>"'`)\]]*/gi;

function canonical(u) {
  return String(u).replace(/[.,;:!?]+$/, '').replace(/\/+$/, '').toLowerCase();
}

// Removes every URL that is not exactly one of the allowed (verified) URLs.
export function filterUrls(text, allowedUrls) {
  const allowed = new Set([...allowedUrls].map(canonical));
  const removed = [];
  const out = String(text).replace(URL_RE, (m) => {
    const trail = m.match(/[.,;:!?]+$/);
    const core = trail ? m.slice(0, -trail[0].length) : m;
    if (allowed.has(canonical(core))) return m;
    removed.push(core);
    return trail ? trail[0] : '';
  });
  return { text: out.replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n'), removed };
}

const CITE_RE = /\[([A-Za-z][A-Za-z0-9._:-]{2,100})\]/g;

export function extractCitationIds(text) {
  const ids = [];
  for (const m of String(text).matchAll(CITE_RE)) if (!ids.includes(m[1])) ids.push(m[1]);
  return ids;
}

// Drops [ids] that are not in the index (an invented citation is never kept).
export function dropUnknownCitations(text, idIndex) {
  const dropped = [];
  const out = String(text).replace(CITE_RE, (m, id) => {
    if (idIndex.has(id)) return m;
    dropped.push(id);
    return '';
  });
  return { text: out.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:!?])/g, '$1').replace(/ +\n/g, '\n'), dropped };
}

// For optional-backend output only: strip tags, script-ish patterns and
// Markdown decoration. The local engine writes plain text by construction.
export function stripMarkup(text) {
  return String(text)
    // a model's reasoning trace is never shown: whole blocks, a block whose
    // opening tag is missing, and a block cut off at the token limit
    .replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '')
    .replace(/^[\s\S]*?<\/(think|thinking)>/i, '')
    .replace(/<(think|thinking)>[\s\S]*$/i, '')
    .replace(/<\s*(script|style|iframe|object|embed|svg)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<[^>]{0,500}>/g, '')
    .replace(/\bjavascript\s*:/gi, '')
    .replace(/\bon[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Looks for anything that must never be in an answer, from any engine.
export function unsafePatterns(text) {
  const found = [];
  const s = String(text);
  if (/<\s*script/i.test(s)) found.push('script-tag');
  if (/<\s*iframe/i.test(s)) found.push('iframe-tag');
  if (/\bjavascript\s*:/i.test(s)) found.push('javascript-url');
  if (/\bon(?:error|load|click|mouseover)\s*=/i.test(s)) found.push('event-handler');
  if (/sk-[A-Za-z0-9_-]{8,}/.test(s)) found.push('key-like-string');
  return found;
}

export function truncateAtSentence(text, max) {
  const s = String(text);
  if (s.length <= max) return { text: s, truncated: false };
  const cut = s.slice(0, max);
  const lastBreak = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '), cut.lastIndexOf('। '));
  const body = lastBreak > max * 0.5 ? cut.slice(0, lastBreak + 1) : cut;
  return { text: body.trimEnd() + ' …', truncated: true };
}
