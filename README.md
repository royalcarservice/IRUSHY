# IRUSHY

A bilingual (Tamil / English) learning and website-help assistant for the
**TNHHSSCTA** website (<https://tnhhsscta.com>).

IRUSHY is an **AI assistant**, not a human teacher, and it says so in every
panel. It has three modes — **homepage help**, **student**, **teacher** — with
one shared widget, one shared server pipeline and one shared set of verified
data files.

> **This repository is a separate local development copy.** It was built by
> reading the public live site and it **never writes to it**. The live website
> has not been modified or deployed.

---

## 1. What is in this delivery

| Part | Where | State |
|---|---|---|
| Homepage assistant, end to end | `public/irushy/`, `server/routes/chat.js` | **Working** |
| Student mode (topics, mistake explanations, simple/example/similar follow-ups) | `server/routes/chat.js` + data files | **Working** |
| Teacher mode (resource search, paper builder + separate answer key) | `server/routes/teacher.js` | **Working**, needs an approved question bank (currently empty → it reports the gap instead of inventing questions) |
| Server-side key protection, limits, rate limiting, timeouts, retries | `server/config.js`, `server/lib/` | **Working** |
| Verified website knowledge and 58 approved material links | `data/`, `tools/build-resources-from-live.mjs` | **Working** (imported from the live site) |
| Local preview of the real site with the widget on it | `public/` | **Working** |
| Real APInex calls | `tools/verify-apinex.mjs` | **Ready** — needs your key in `.env` (never in chat) |
| Approved videos / diagrams / question bank | `data/videos.json`, `data/diagrams.json`, `data/question-bank.json` | **Awaiting content** — empty on purpose; sample files are clearly labelled |
| Test-integration (completed-test tokens) | `server/lib/policy.js` | **Interface ready, backend pending** — until the ASP/DB side issues signed tokens, IRUSHY refuses to discuss an in-progress test |
| Student results access | `server/routes/teacher.js` | **Deliberately unavailable** — needs authenticated teacher→student permissions; never simulated |

Full detail, including what is *not* done and why, is in
[`docs/STATUS.md`](docs/STATUS.md). Verification evidence is in
[`docs/VERIFICATION.md`](docs/VERIFICATION.md).

---

## 2. Quick start (local development copy)

```bash
cd irushy
npm install                 # one dependency: express

cp .env.example .env        # optional: without it IRUSHY runs in
                            # "not connected yet" mode, which is a valid state

npm start                   # http://localhost:8787
```

Open <http://localhost:8787>. You get the TNHHSSCTA home page exactly as it is
on the live site, with the **Ask IRUSHY** launcher in the corner.

To enable live answers, put your APInex key in `.env` (never in chat):

```ini
APINEX_API_KEY=sk-apx-...
```

then check it and restart:

```bash
npm run verify:apinex       # real API call; prints no key material
npm start
```

### Scripts

| Command | What it does |
|---|---|
| `npm start` | run the server (API + local site preview) on `PORT` (default 8787) |
| `npm run dev` | same, with auto-restart on file changes |
| `npm test` | **157** end-to-end checks: no-key behaviour, full request path against a mock APInex, error mapping, safety, teacher permissions, limits |
| `npm run check:ui` | **65** real-browser checks (desktop + mobile) and screenshots into `docs/screenshots/` |
| `npm run verify:apinex` | the only real APInex call. Refuses to run without a key |
| `npm run build:data` | re-import the published materials list from the live site (read-only) |

`npm run check:ui` needs a browser once:
`npm i -D playwright && npx playwright install chromium`.

### Accessibility & mobile

- launcher, panel, language selector, clear-chat, loading indicator, retry
- full keyboard support: `Escape` closes, `Tab` is trapped, focus returns to the launcher
- visible focus rings, `aria-live` log, labelled controls, high-contrast-safe colours
- `prefers-reduced-motion` respected; forced-colours supported
- on phones the panel is full-screen and re-anchors to the **visual** viewport, so
  the close button and the input are never hidden behind the on-screen keyboard

---

## 3. Architecture

```
                        browser (the website + the widget)
                          │  POST /api/chat   (no key, ever)
                          ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ IRUSHY server (Node + Express)                               │
   │                                                              │
   │  limits.js      rate limit, duplicate collapse, concurrency   │
   │  session.js     server-signed cookie -> role (visitor/teacher)│
   │  policy.js      mode decision, assessment guard, results gate │
   │  retrieve.js    BM25 over the data files (Tamil + English)    │
   │  prompts.js     rules, retrieved entries, verified links      │
   │  apinex.js      the ONLY place the key is used                │
   │  sanitize.js    strip markup, drop unverified URLs, label     │
   └──────────────────────────────────────────────────────────────┘
                          │  Bearer <key>   (server side only)
                          ▼
              https://api.apinex.bond/v1/chat/completions
                        model: free/gemini-3.8-flash
```

Data files, each maintainable on its own:

| File | Contents | Provenance |
|---|---|---|
| `data/site-pages.json` | the 9 verified public destinations | checked against the live site |
| `data/site-faq.json` | website-help answers, with source links | verified-site |
| `data/resources.json` | 58 published study-material PDFs | imported from the live site |
| `data/videos.json` | approved videos | **empty** until a teacher approves |
| `data/diagrams.json` | approved diagrams | **empty** until a teacher approves |
| `data/question-bank.json` | approved questions for papers | **empty** until the school approves |
| `data/sample/*.json` | sample videos, diagrams, questions, glossary | **sample-unapproved**, always labelled |

Every entry carries an `id`, and where known `topic`, `class`, `subject`,
`medium`, `language` and its `provenance`. Retrieval pulls only the relevant
few entries per request — the whole syllabus is never sent.

---

## 4. Integrating with the real website

The home page is a **frameset**
(`index` → `ToppageHome.asp` + `IrushyFrameHome.asp` → three nested frames).
That matters: **a frameset document cannot render an overlay of its own** — its
`<body>` *is* the `<frameset>`, so a floating button placed there gets a 0×0
box. This was measured in Chromium, not assumed.

The delivery therefore uses a shell page that embeds the untouched frameset and
hosts the widget in a normal top-level document:

```html
<!-- index.html - the only new file in the site path -->
<iframe id="site-frame" src="site-home.html" style="..."></iframe>
<link rel="stylesheet" href="/irushy/irushy.css">
<script defer src="/irushy/irushy.js" data-irushy-mode="home" data-irushy-host="top"></script>
```

Nothing on the site is redesigned: the same two-row frameset (23% / 77%), the
same three-column inner frameset (20% / 65% / 20%), the same left-hand
**Teacher Registration** and **Student Registration** choices, the same
top-left **web-admin portrait**, the same slide show and the same two NEET logins.

Two other integration routes are supported and documented in
[`docs/INTEGRATION.md`](docs/INTEGRATION.md):

1. **Edit an existing frame** — add the two lines to `AdminPageHome.asp`.
   Zero layout change; the widget sits in the left column.
2. **Put the script on the frameset itself** — IRUSHY detects the frameset,
   injects itself into the largest frame and mounts there, offering a
   full-screen assistant page (`/irushy/assistant.html`) when a frame is too
   narrow, as on a phone.

Reusing the widget for the Student and Teacher sections is one attribute:

```html
<script defer src="/irushy/irushy.js" data-irushy-mode="student"></script>
<script defer src="/irushy/irushy.js" data-irushy-mode="teacher"></script>
```

`data-irushy-mode` is only a *request*: the server decides the effective mode
from the signed session, so putting `teacher` in the page grants nothing.

---

## 5. API surface

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/chat` | any session | the assistant. Body: `{ message, lang, mode_requested, history, context, request_id }` |
| `GET /api/config` | any | public runtime configuration (no secrets) |
| `GET /api/health` | any | readiness; `?deep=1` also probes the provider |
| `GET /api/site/links?mode=&lang=` | any | verified website links — work with **no** AI |
| `GET /api/site/services?lang=` | any | the services published on the live site |
| `GET /api/suggestions?mode=&lang=` | any | starter questions taken from the FAQ |
| `GET /api/session`, `POST /api/session/login`, `POST /api/session/logout` | — | server-signed role |
| `GET /api/teacher/coverage` | **teacher** | what the approved bank can build |
| `GET /api/teacher/bank` | **teacher** | search the bank (approved + labelled sample) |
| `POST /api/teacher/paper` | **teacher** | assemble a paper + separate answer key |
| `POST /api/teacher/paper/:id/review` | **teacher** | mark a draft reviewed (publishing is *not* implemented) |
| `GET /api/teacher/results/:studentRef` | **teacher** | always `503` + "unavailable" until real permissions exist |

`mode`, `lang`, `answer`, `citations`, `links`, `attachments`, `provenance`,
`sampleContentUsed`, `notices`, `results_access`, `meta` are returned on chat
responses. Provider failures return `ok:false` with an explicit `error.code`
(`not_connected`, `invalid_credentials`, `insufficient_quota`,
`model_unavailable`, `rate_limited`, `provider_unavailable`, `timeout`,
`network_error`, `bad_provider_response`), a bilingual message, an
`adminHint`, and the verified website links so the widget stays useful.

---

## 6. Security posture (short version)

- The API key exists only in the server process. It is not in the widget, not
  in `/api/config`, not in any response, not in logs (a redactor strips the key,
  `sk-...` patterns and `Authorization` headers), and `.env` is git-ignored.
- Roles come from an **HMAC-signed, HttpOnly** cookie. A client-side "Teacher"
  selection is downgraded server-side and the downgrade is explained to the user.
- Model output is treated as untrusted: it is returned as plain text and
  assigned with `textContent`; no HTML, script or SVG from the model is ever
  executed. Invented URLs are removed and reported in `urlsRemoved`.
- Diagram SVG is validated twice — in the loader and again in the browser
  against a tag/attribute allow-list (no script, no event handlers, no external refs).
- Video players are created only after the visitor clicks **Load video**, and use
  `youtube-nocookie.com`.
- Bounded everything: input length, history, output tokens, timeouts, retries,
  body size, concurrency, per-IP rate limits (a separate, small budget for chat).
- No transcripts are stored. Chat history lives in the page's memory and is
  dropped on reload or **Clear chat**.
- No identifiable student data is sent to APInex. The assessment and results
  paths are gated behind server-side verification that does not exist yet, so
  they refuse rather than guess.

Details: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## 7. Verified state of the live site

Read-only inspection on **2026-10-15** (HTTP `200` for all nine destinations):
`Admin Login`, `School Login`, `Online One Word Test`, `Materials`,
`Teacher Registration`, `Student Registration`, `NEET Co-Ordinator Login`,
`NEET Student Login`, and the home page. The materials page lists 58 distinct
published PDFs across 11th/12th Computer Science, Computer Applications,
Computer Technology and General Instructions, in Tamil and English medium.
All of that is in `data/` with source ids; none of it was invented.

Nothing on the live site published: fees, refunds, timetables, staff lists,
results, or any policy text — so IRUSHY is instructed to say "not published on
this site" rather than guess. There were no video links on the live site
either, which is why `data/videos.json` starts empty.
