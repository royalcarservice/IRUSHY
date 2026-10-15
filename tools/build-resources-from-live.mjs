#!/usr/bin/env node
// IRUSHY - READ-ONLY re-check of the published materials and site pages.
//   npm run build:data                 dry run: report only, writes nothing
//   npm run build:data -- --write      update data/resources.json
//   npm run build:data -- --no-pages   skip the site-page reachability check
//
// What it does, and does not do:
//   - GET https://tnhhsscta.com/AmmaURL.asp (the Materials page) and list every
//     file linked under /Material/ (PDFs, plus the odd .ppt / .jpg). Ids,
//     class, subject and medium come from the published file name
//     (TNHHSSCTA-<SUBJ>-<YEAR>-<MEDIUM>-Mat<N>.<ext>).
//   - Compare with data/resources.json and print what was added or is missing.
//   - With --write: add newly published files, refresh titles, keep every
//     existing id and metadata. Files no longer linked are reported, never
//     deleted automatically.
//   - Re-check that the 9 entry points in data/site-pages.json still answer.
//   - It never logs in, never posts a form, never uploads anything.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://tnhhsscta.com';
const MATERIALS_PAGE = `${ORIGIN}/AmmaURL.asp`;

const SUBJECTS = { CS: 'Computer Science', CA: 'Computer Applications', CT: 'Computer Technology', GI: 'General Instructions' };
const MEDIUMS = { TM: 'Tamil Medium', EM: 'English Medium' };

// Published files are mostly PDFs, but the site also links a PowerPoint
// (Mat36.ppt) and an image (Mat52.jpg) under /Material/.
const FILE_EXT = '(?:pdf|pptx?|docx?|xlsx?|jpe?g|png|zip)';

export function materialFromFile(file) {
  const m = String(file).match(new RegExp(`^TNHHSSCTA-([A-Z]{2})-([12])-([A-Z]{2})-Mat(\\d+)\\.(${FILE_EXT.slice(3, -1)})$`, 'i'));
  if (!m) return null;
  const [, subj, year, med, n, ext] = m;
  const S = subj.toUpperCase();
  const M = med.toUpperCase();
  return {
    id: `mat.${S}-${year}-${M}-${Number(n)}`,
    subject: SUBJECTS[S] || S,
    class: year === '1' ? 11 : 12,
    year: year === '1' ? '1st year' : '2nd year',
    medium: MEDIUMS[M] || M,
    language: M === 'TM' ? 'ta' : 'en',
    file: `TNHHSSCTA-${S}-${year}-${M}-Mat${n}.${ext.toLowerCase()}`
  };
}

function cleanText(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// Every file link under /Material/ with the text of its table row (the title).
export function parseMaterialLinks(html, base = MATERIALS_PAGE) {
  const out = new Map();
  const rows = String(html).split(/<tr\b/i);
  const linkRe = new RegExp(`href\\s*=\\s*["']([^"']*Material\\/[^"']+\\.${FILE_EXT})["']`, 'gi');
  for (const rowHtml of rows) {
    const links = [...rowHtml.matchAll(linkRe)].map((m) => m[1]);
    if (!links.length) continue;
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cleanText(m[1])).filter((t) => t && !/^(view|download)$/i.test(t));
    const title = cells.sort((a, b) => b.length - a.length)[0] || '';
    for (const href of links) {
      let url;
      try {
        url = new URL(href, base);
      } catch {
        continue;
      }
      if (url.hostname !== 'tnhhsscta.com' && url.hostname !== 'www.tnhhsscta.com') continue;
      const file = decodeURIComponent(url.pathname.split('/').pop());
      if (!out.has(file)) out.set(file, { file, url: `${ORIGIN}/Material/${file}`, title });
    }
  }
  return [...out.values()];
}

export function diffResources(existing, found) {
  const byFile = new Map(existing.map((r) => [r.file, r]));
  const foundFiles = new Set(found.map((f) => f.file));
  const added = found.filter((f) => !byFile.has(f.file));
  const missing = existing.filter((r) => !foundFiles.has(r.file));
  const retitled = found.filter((f) => byFile.has(f.file) && f.title && byFile.get(f.file).title.en !== f.title);
  return { added, missing, retitled, unchanged: found.length - added.length - retitled.length };
}

export function mergeResources(existing, found, today) {
  const items = existing.map((r) => ({ ...r }));
  const byFile = new Map(items.map((r) => [r.file, r]));
  for (const f of found) {
    const cur = byFile.get(f.file);
    if (cur) {
      if (f.title) cur.title = { en: f.title, ta: f.title };
      cur.verified = today;
      continue;
    }
    const meta = materialFromFile(f.file);
    if (!meta) continue;
    items.push({
      id: meta.id,
      kind: 'material',
      status: 'approved-published',
      title: { en: f.title || f.file, ta: f.title || f.file },
      topic: null,
      class: meta.class,
      subject: meta.subject,
      year: meta.year,
      medium: meta.medium,
      language: meta.language,
      file: meta.file,
      url: f.url,
      source: { page: MATERIALS_PAGE, selector: 'AmmaURL.asp > materials table' },
      verified: today
    });
  }
  items.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return items;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    process.stdout.write('Usage: node tools/build-resources-from-live.mjs [--write] [--no-pages]\nRead-only: GET requests to https://tnhhsscta.com only. Dry run unless --write.\n');
    return 0;
  }
  const write = args.has('--write');
  const resPath = path.join(ROOT, 'data', 'resources.json');
  const doc = JSON.parse(fs.readFileSync(resPath, 'utf8'));
  process.stdout.write(`${write ? 'WRITE' : 'DRY RUN'}: reading ${MATERIALS_PAGE} (GET only)\n`);
  let html;
  try {
    const res = await fetch(MATERIALS_PAGE, { headers: { 'User-Agent': 'IRUSHY-resource-check (read-only)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    process.stderr.write(`Could not read ${MATERIALS_PAGE}: ${err.message}\nNothing was changed.\n`);
    return 3;
  }
  const found = parseMaterialLinks(html);
  const d = diffResources(doc.items, found);
  process.stdout.write(`Published material links found: ${found.length}; in data/resources.json: ${doc.items.length}\n`);
  process.stdout.write(`  new on the site: ${d.added.length}\n`);
  for (const a of d.added) process.stdout.write(`    + ${a.file}  "${a.title}"\n`);
  process.stdout.write(`  no longer linked (kept, review by hand): ${d.missing.length}\n`);
  for (const m of d.missing) process.stdout.write(`    - ${m.file}  (${m.id})\n`);
  process.stdout.write(`  title changed: ${d.retitled.length}\n`);
  if (!args.has('--no-pages')) {
    const pages = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site-pages.json'), 'utf8')).items;
    for (const p of pages) {
      let status = 'error';
      try {
        status = (await fetch(p.url, { method: 'GET', redirect: 'manual' })).status;
      } catch (err) {
        status = `error: ${err.message}`;
      }
      process.stdout.write(`  page ${p.id}: ${status}\n`);
    }
  }
  if (!write) {
    process.stdout.write('Dry run: nothing written. Re-run with --write to update data/resources.json.\n');
    return 0;
  }
  const today = new Date().toISOString().slice(0, 10);
  doc.items = mergeResources(doc.items, found, today);
  doc._meta = { ...doc._meta, generatedAt: new Date().toISOString(), count: doc.items.length };
  fs.writeFileSync(resPath, JSON.stringify(doc, null, 2) + '\n');
  process.stdout.write(`Wrote ${doc.items.length} entries to data/resources.json. Run npm test before committing.\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code), (err) => {
    process.stderr.write(`${err.stack || err}\n`);
    process.exit(1);
  });
}
