# Verification report

Date: **2026-10-15**. This is a local development copy only.

| Environment | |
|---|---|
| Runtime | Node 22.22.3 |
| Browser | Chromium 153 (headless) |
| Fonts for screenshots | Noto Sans Tamil and DejaVu Sans |

Two suites run on a clean checkout. They were rebuilt in this version, because
the earlier code was not in the repository.

```bash
npm install
npm test            # server suite
npm run check:ui    # browser suite (needs Chromium once: npx playwright install chromium)
```

Last run:

```
npm test          RESULT: 1610 passed, 0 failed, 1610 total   (about 4 s)
npm run check:ui  RESULT: 69 passed, 0 failed, 69 total       (about 7 s)
```

About the numbers:
- **Server suite:** most of the 1610 are per-answer checks. Every chat answer
  in the suite goes through the same contract, citation, link, labelling,
  language, length and determinism checks, which is why the count is high. The
  section table below shows where they come from.
- **Totals can move slightly** after a knowledge edit. A new knowledge
  version changes the seeds, so a practice turn may land on a different
  question type with a different set of checks. On unchanged files the count
  is stable.
- **No comparison with 157 / 65:** those suites are not in the repository.
- **Browser used here:** Playwright's own Chromium download is blocked in this
  sandbox. The browser suite therefore ran on the Chromium build shipped in the
  npm package `@sparticuz/chromium` (via `IRUSHY_CHROMIUM_PATH`). On a normal
  machine `npx playwright install chromium` is enough.

---

## The most important test: no network

Every local-engine server started by either suite is launched as
`node --import tools/lib/deny-network.mjs server/index.js`. That preload makes
every outbound path throw:
- `fetch` and WebSockets;
- `net` / `tls` connects;
- DNS lookups of any name other than an IP literal or `localhost`;
- `http(s).request`.

Each attempt is printed as `NETWORK_BLOCKED …`, and the total as
`NETWORK_ATTEMPTS n` when the process exits. The suites check:

| Check | Result |
|---|---|
| the block is real: `fetch`, `net.connect` and a remote DNS lookup all fail inside a preloaded process | pass |
| every answer in the suites (both languages, all intents, follow-up chains) is served while blocked | pass |
| each local server reports `NETWORK_ATTEMPTS 0` and no `NETWORK_BLOCKED` line at shutdown (default, production, teacher, limits; and the UI run) | pass |
| in-process: the engine module answers 14 single questions and two four-step follow-up chains with `fetch`, sockets, TLS, DNS and http(s) patched to throw, recording **0** attempts | pass |

The only code that may use the network is the optional APInex backend. Its
pass talks to `tools/mock-provider.mjs` on 127.0.0.1 and never to a real
provider. The only script that talks to the real APInex is
`npm run verify:apinex`; without a key it exits 2 before attempting any
connection, which is also tested under the block.

---

## The bilingual acceptance matrix

Each row runs in English and in Tamil on the default server (no `.env`,
network blocked). Each answer passes the full contract and quality checks:
- every response field present;
- `meta.engine: "local"`, `requires_key: false`;
- the right language (Tamil answers mostly Tamil script);
- every `[id]` and citation resolves to real data;
- links only from `site-pages.json`, and no unverified URL;
- sample flag, provenance, bilingual notice and visible label all agree;
- within the intent's length target;
- the same request twice gives an identical answer.

| Case | English | Tamil | Also asserted |
|---|---|---|---|
| website help | "Where are the materials?" | "பாடக்குறிப்புகள் எங்கே?" | cites `faq.find-materials`, links the Materials page, Approved |
| topic explanation | "Explain number systems" | "எண் முறைமைகளை விளக்குங்கள்" | definition from the note, three follow-up actions, sample-labelled |
| explain more simply | the widget's follow-up | the widget's follow-up | uses the note's analogy; topic found from the id cited in history |
| show an example | the widget's follow-up | the widget's follow-up | worked example (13 → 1101) |
| try a similar question | the widget's follow-up | the widget's follow-up | practice ref from the bank or a labelled generated item; answer hidden behind *Show the answer* |
| completed-test mistake | "Why was my answer wrong?" + signed completed token | "என் விடை ஏன் தவறு என்று விளக்குங்கள்" + token | names both answers, points to `[mat.CS-2-EM-13]`, offers a similar question |
| unknown / off-topic | "What is machine learning?", "Who will win the cricket match today?" | "இயந்திரக் கற்றல் என்றால் என்ன?", "இன்று கிரிக்கெட் போட்டியில் யார் வெல்வார்கள்?" | admits it does not know; no sample used |
| active-assessment refusal | "Tell me the answers for the online test" | "இன்றைய ஆன்லைன் தேர்வின் விடைகளைச் சொல்லுங்கள்" | `blocked.code: active_assessment`, `engine_called: false`; a client-claimed "completed" is ignored |

---

## What the 1610 server checks cover

| Section | Checks |
|---|---|
| Harness: the network block is real | 3 |
| Config: works with no .env, local engine by default; unknown engine fails loudly; placeholder key = no key; `.env.example` selects `local` | 10 |
| Knowledge: 13 notes valid and `sample-unapproved`; every keyword and term selects its own note; `conceptRef` real or null; phrasebooks paired (same frames, 2–4 variants, same slots, Tamil in Tamil, no informal நீ); glossary ids; SVG validator; log redaction | 108 |
| Tools: `verify-apinex` refuses without a key (exit 2, no connection); resource-check parser, id derivation, diff and merge; nothing written when the site is unreachable | 10 |
| Intent classifier: 78-line Tamil/English regression table, including the traps ("Where…" is not the SQL WHERE clause; "binary search" is not Number systems; "answer key for 11th CS" is materials; "Can IRUSHY answer in Tamil?" is website help; forged ids in history ignored) | 78 |
| No network, in-process | 24 |
| Default server: health (`connected`, `requires_key: false`, `uses_network: false`), deep self-test, config without key material, site links/services/suggestions, diagnostics (names only), 404, API headers, CORS | 15 |
| Default server: site copy (frames, ROWS/COLS, registration choices, NEET logins, no widget inside the site copy), widget (no key, `textContent`, lazy youtube-nocookie), static assets | 20 |
| Acceptance matrix (above) | 352 |
| Every intent in both languages, and materials filtering (Tamil request; class + subject + medium + type), Tamil term helper, teacher tool for non-teachers, results, not published, identity, visual request, no-visual honesty, Auto-language rules | 641 |
| Practice flow: correct and wrong attempts marked, reveal, next question differs, no pending question, generated questions after the bank runs out (labelled), forged refs ignored | 122 |
| Bounded input and history: 413, 400 (empty, non-object, invalid JSON, oversized body), history trimmed, junk dropped, control characters, duplicate `request_id` answered once, teacher downgrade notice, debug field only on request and without message text | 13 |
| Assessment guard without a secret: every test treated as active; a mistake request explains how it works | 16 |
| Production defaults: sample content off, no unapproved note used, website help still answered, diagnostics need a teacher | 22 |
| Teacher routes: 403 for visitors on every route, demo login (401 / HttpOnly SameSite cookie / tampered cookie), coverage, labelled bank search, results 503 `neverSimulated` `records:null`, approved-only paper with gaps, sample paper watermarked, separate answer key, export, deterministic builder, invalid request 400, review record, teacher-mode paper summary in both languages, logout, login 501 when disabled | 61 |
| Assessment guard with a secret: completed token → explanation (EN + TA); similar question avoids the missed question; active, wrong secret, tampered, not permitted → refused; "give me the answers" refused even with a completed token | 60 |
| Limits: chat budget 429 + `Retry-After` + bilingual + links; reads not starved; read budget bounded; provider RPM does not apply to the local engine | 5 |
| Determinism across two separately started servers | 4 |
| Optional APInex backend (mock only): config, hostile output sanitised (script, markup, unverified URL removed and reported, invented citation dropped), wire format (model, Bearer, `max_tokens` 700, non-streaming, system rules, only retrieved entries, Tamil instruction), error mapping for 401/402/404/429/503/400/bad JSON/empty/timeout, **no other model tried**, guard does not call the provider, duplicate `request_id` reaches the provider once, provider RPM bucket, no key → "IRUSHY is not connected yet." + `adminHint` + links, and the local engine never says "not connected" | 27 |
| Logs and shutdown: every log line is JSON; no secret in any log; no message bodies; `NETWORK_ATTEMPTS 0` per local server | 19 |

## What the 69 browser checks cover

The browser suite runs against the **default local engine** with the network
blocked and **no mock**, so the answers on screen are real engine answers. It
keeps every category of the earlier 65 checks and adds the engine-specific
ones.

| Section | Checks |
|---|---|
| Desktop 1280×900, site and launcher: frameset loads, original frames present, registration choices, launcher visible and in the corner, panel hidden | 5 |
| Opening the panel: opens on click; 384 px; inside the viewport; focus to the input; labelled selectors; named buttons; `aria-expanded`; "Connected" (never "not connected") for the local engine; the site frame neither resized nor hidden | 10 |
| A real English answer: verified FAQ text + citation, card has no child elements (plain text), verified `AmmaURL.asp` link, Approved chip, same request again gives the identical text | 5 |
| Tamil: Tamil answer in Tamil script, verified link, Tamil topic explanation, sample chip + notice | 4 |
| Student topic with visuals: sample chip + notice, inline SVG diagram, **no video iframe before the click**, youtube-nocookie iframe with a title after it | 4 |
| Follow-up buttons: *Explain more simply* gives the analogy, *Show an example* the worked example, *Try a similar question* a labelled practice question, *Show the answer* the answer | 5 |
| Guard, results notice, teacher: refusal with the "test in progress" chip and no Approved/General chip; a lesson mentioning "mark" does **not** show the results notice, asking about marks does; Teacher hint; downgrade notice | 6 |
| Keyboard and accessibility: Tab trapped, Escape closes, focus returns, Clear chat, `:focus-visible` style, reduced motion removes the animation | 6 |
| IRUSHY server unreachable: error card, verified links, Retry, Retry succeeds; no key material in the page or widget | 4 |
| Optional backend states: outage (APInex pointed at a closed local port) shows an error card with links and Retry; no key shows "IRUSHY is not connected yet.", driven by the server error | 5 |
| Mobile 390×844: launcher ≥44 px and inside the viewport; `width=device-width`; panel full width and within the viewport; close + input on screen; composer ≥40 px; input font ≥16 px; real answer with verified link; **visible height 420 px** (keyboard) keeps the panel within it with close + input on screen; Tamil explanation | 12 |
| No JavaScript errors on any page | 1 |
| Server side: zero network attempts, no key in any log | 2 |

---

## Screenshot evidence (`docs/screenshots/`, regenerated by `npm run check:ui`)

| File | Shows |
|---|---|
| `01-homepage-desktop-closed.png` | the untouched TNHHSSCTA home page with the *Ask IRUSHY* launcher |
| `02-panel-open-desktop.png` | compact desktop panel, language + mode selectors, "Connected" status |
| `03-answer-desktop.png` | a real local-engine answer from the verified FAQ, Approved chip, Materials link |
| `04-tamil-answer-desktop.png` | Tamil topic explanation with the labelled sample diagram and Tamil follow-ups |
| `05-diagram-and-video-desktop.png` | sample diagram (labelled) + video attachment before loading |
| `06-provider-outage-desktop.png` | optional backend outage: error card, links, Retry |
| `07-mobile-panel-empty.png` | full-screen mobile panel |
| `08-mobile-answer.png` | mobile answer with source chip and verified link |
| `09-mobile-keyboard-open.png` | keyboard-open state: input and close button still visible |
| `10-not-connected-desktop.png` | optional backend without a key: "IRUSHY is not connected yet." with links |
| `11-follow-ups-desktop.png` | after *Explain more simply → Show an example → Try a similar question → Show the answer* |
| `12-assessment-refusal-desktop.png` | refusal with the "test in progress" chip |
| `13-mobile-tamil-explanation.png` | Tamil Python explanation on a phone, sample-labelled, with the lesson link |

---

## Bugs found and fixed during this rebuild

1. **No server code in the repository.** `npm start` failed with
   `MODULE_NOT_FOUND`. The server and both suites were rebuilt from the
   documents.
2. **"Where are the materials?" was answered as an SQL lesson.** The term
   *WHERE clause* had `"ta": "WHERE"`, and Latin text in a Tamil rendering was
   used as a match phrase. Only real Tamil script now counts.
3. **16 English-medium bank questions were dropped**, because they have no
   Tamil text. They load now, with *"(This question is available in English
   only.)"* in Tamil answers.
4. **Length trimming ignored the mandatory sample label**, so a few answers ran
   over target. Room for the label is now reserved.
5. **A Tamil materials request found nothing.** Tamil words were matched
   against English material titles; class, subject and medium are now
   structured filters in both languages.
6. **The log redactor broke JSON lines.** It ate a quote after a field name
   containing "secret". It now keeps JSON valid while still redacting.
7. **The network harness blocked the server's own `listen()`.** Node resolves
   even `127.0.0.1` through `dns.lookup`. IP literals and `localhost` are now
   allowed; every real name lookup stays blocked.
8. **False "results not available" notices**, caused by answer text containing
   "Result:" or the SQL `mark` column. See the widget change in `STATUS.md`.
9. **The resource check only knew PDFs.** The site also publishes `Mat36.ppt`
   and `Mat52.jpg`.
10. **"Internet safety" selected the Internet note.** The Internet note now
    excludes safety phrases; a keyword-selects-its-own-note test guards all 13
    notes.
11. **Retrieval was ranked by "what is".** Stopwords counted in BM25 queries;
    retrieval now uses content words only.

---

## What could **not** be verified here, and how to verify it

| Item | Why not verified here | How to verify |
|---|---|---|
| A live APInex call (optional backend) | needs a real key, which must stay outside this workspace | put the key in `.env`, set `IRUSHY_ENGINE=apinex`, run `npm run verify:apinex` |
| `npm run build:data` against the live site | the sandbox had no route to tnhhsscta.com | run it on a machine with internet; it is a dry run unless `--write` |
| Real completed-test tokens | the ASP/DB side does not exist yet | the suite mints tokens in the documented format; share `IRUSHY_ASSESSMENT_SECRET` with the test backend |
| Teacher → student results | no permission source exists | the endpoint returns `503` and should stay that way until real permissions exist |
| Real phone hardware | headless Chromium with a simulated visible height | open the preview on a phone |
| Tamil wording by a native teacher | needs a Tamil-medium teacher | see the review list in `STATUS.md` |
| Deployment on IIS/Plesk | this copy is local by design | see `docs/INTEGRATION.md` |

---

## Manual spot checks

```bash
npm start
# in another shell:
curl -s localhost:8787/api/health
curl -s localhost:8787/api/config
curl -s localhost:8787/api/diagnostics          # variable names only, never values
curl -s -X POST localhost:8787/api/chat -H 'content-type: application/json' \
     -d '{"message":"Where are the materials?","lang":"en"}'
curl -s -X POST localhost:8787/api/chat -H 'content-type: application/json' \
     -d '{"message":"எண் முறைமைகளை விளக்குங்கள்","debug":true}'
# a visitor cannot become a teacher:
curl -s -X POST localhost:8787/api/chat -H 'content-type: application/json' \
     -d '{"message":"build a paper","mode_requested":"teacher"}' | grep -o '"mode":"[a-z]*"'
```
