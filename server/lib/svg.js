// IRUSHY - server-side SVG check (the widget checks again before rendering).
//
// Walks every tag and attribute against an allow-list. Text between tags is
// never scanned as if it were an attribute. Anything unexpected (script,
// foreignObject, event handlers, external references, entities) fails.

// Same lists as the widget (public/irushy/irushy.js, SVG_TAGS / SVG_ATTRS), so
// anything that passes here is something the browser will actually draw.
const ALLOWED_TAGS = new Set([
  'svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path',
  'text', 'tspan', 'title', 'desc'
]);

const ALLOWED_ATTRS = new Set([
  'xmlns', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'transform', 'opacity',
  'role', 'aria-label', 'aria-labelledby', 'id', 'dy', 'dx', 'letter-spacing'
]);

export const MAX_SVG_BYTES = 40000;

export function validateSvg(markup) {
  if (typeof markup !== 'string') return { ok: false, reason: 'not_a_string' };
  if (markup.length === 0) return { ok: false, reason: 'empty' };
  if (Buffer.byteLength(markup) > MAX_SVG_BYTES) return { ok: false, reason: 'too_large' };
  const trimmed = markup.trim();
  if (!/^<svg[\s>]/i.test(trimmed)) return { ok: false, reason: 'not_svg_root' };
  if (/<!(?:doctype|entity|\[cdata\[)/i.test(trimmed) || /<\?/.test(trimmed)) return { ok: false, reason: 'declaration' };
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d{1,5}|#x[0-9a-f]{1,4});)/i.test(trimmed)) return { ok: false, reason: 'entity' };

  const tagRe = /<\/?([A-Za-z][A-Za-z0-9:-]*)([^>]*)>/g;
  let m;
  let seenTags = 0;
  while ((m = tagRe.exec(trimmed))) {
    seenTags += 1;
    const name = m[1].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) return { ok: false, reason: `tag:${name}` };
    const attrText = m[2].replace(/\/\s*$/, '');
    if (m[0].startsWith('</')) {
      if (attrText.trim()) return { ok: false, reason: 'closing_tag_attrs' };
      continue;
    }
    const attrRe = /([A-Za-z_:][A-Za-z0-9_:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let rest = attrText;
    let a;
    while ((a = attrRe.exec(attrText))) {
      const an = a[1].toLowerCase();
      const value = a[3] ?? a[4] ?? '';
      if (!ALLOWED_ATTRS.has(an)) return { ok: false, reason: `attr:${an}` };
      if (/^on/.test(an)) return { ok: false, reason: `attr:${an}` };
      if (/(javascript|vbscript|data)\s*:/i.test(value)) return { ok: false, reason: 'scheme' };
      if (/url\s*\(\s*['"]?\s*(?!#)/i.test(value)) return { ok: false, reason: 'external_url' };
      if (/expression\s*\(/i.test(value)) return { ok: false, reason: 'expression' };
      rest = rest.replace(a[0], '');
    }
    // Anything left over that is not whitespace is a malformed or
    // unquoted attribute; refuse rather than guess.
    if (rest.trim()) return { ok: false, reason: 'unparsed_attribute' };
  }
  if (seenTags < 2) return { ok: false, reason: 'too_few_tags' };
  if (!/<\/svg>\s*$/i.test(trimmed)) return { ok: false, reason: 'unclosed_root' };
  return { ok: true, reason: null };
}
