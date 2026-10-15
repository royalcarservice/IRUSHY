# IRUSHY

A bilingual (Tamil / English) learning and website-help assistant for the
**TNHHSSCTA** website (<https://tnhhsscta.com>).

IRUSHY is an **AI assistant**, not a human teacher, and it says so in every
panel. It has three modes (**homepage help**, **student**, **teacher**) that
share one widget, one server pipeline and one set of verified data files.

IRUSHY answers with **its own local engine**. It needs no API key, no account,
no quota and no network, and the same question always gets the same answer.
Two optional backends can be switched on instead: APInex (a hosted gateway,
needs a key) or Ollama (a model on your own machine, no key). Nothing uses
either of them unless you ask for it.

> **This repository is a separate local development copy.** It was built by
> reading the public live site and it **never writes to it**. The live website
> has not been modified or deployed.

> **About this version (2026-10-15).** The original upload contained the site
> copy, the widget, the data and the documents, but **none of the server or
> test code** (`server/` and `tools/` were missing, so `npm start` failed).
> The server and both test suites were **rebuilt from these documents and the
> widget's contract**, with the local engine added. Test counts are new numbers
> for new suites; they are not comparable with the earlier 157 / 65.

---

## 1. What is in this delivery

| Part | Where | State |
|---|---|---|
| IRUSHY's own engine (default) | `server/lib/engine/`, `data/knowledge/` | **Working**: no key, no network, deterministic. See [`docs/ENGINE.md`](docs/ENGINE.md) |
| Homepage assistant, end to end | `public/irushy/`, `server/routes/chat.js` | **Working** |
| Student mode: explain, explain more simply, worked example, similar practice question, show the answer | local engine + `data/knowledge/concepts.json` | **Working**. The 13 concept notes are **sample-unapproved** and always labelled until a teacher approves them |
| Completed-test mistake explanation | local engine + `server/lib/policy.js` | **Working** with a server-signed token; the ASP/DB side that issues tokens is **not built yet**, so today IRUSHY refuses |
| Teacher mode: coverage, bank search, paper builder with separate answer key | `server/routes/teacher.js` | **Working**, but the approved question bank is empty, so it reports the gap instead of inventing questions |
| Server-side policy, limits, sessions, logging with redaction | `server/config.js`, `server/lib/` | **Working** |
| Verified website knowledge and 58 published material links | `data/` | **Working** (recorded from the live site on 2026-10-15) |
| Local preview of the real site with the widget on it | `public/` | **Working** |
| Optional APInex backend | `server/lib/engine/apinex.js`, `tools/verify-apinex.mjs` | **Off by default**; needs your key in `.env` (never in chat) |
| Optional Ollama backend | `server/lib/engine/ollama.js`, `tools/verify-ollama.mjs` | **Off by default**; a model on this machine, no key. Tested against a mock only, **not yet with a real Ollama install** |
| Approved videos / diagrams / question bank | `data/videos.json`, `data/diagrams.json`, `data/question-bank.json` | **Awaiting content**: empty on purpose; sample files are clearly labelled |
| Student results access | `server/routes/teacher.js` | **Deliberately unavailable**: needs real teacher→student permissions; never simulated |

What is finished, what is waiting and why: [`docs/STATUS.md`](docs/STATUS.md).
Test evidence: [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

---

## 2. Quick start

```bash
npm install          # one runtime dependency: express (Playwright is dev-only)
npm start            # http://localhost:8787
```

That is all: **no `.env` is needed**. Open <http://localhost:8787>. You get the
TNHHSSCTA home page exactly as it is on the live site, with the **Ask IRUSHY**
launcher in the corner, answering from the local engine.

`.env` is optional. Copy `.env.example` only to change a default (port, limits,
sample content, the assessment secret, the demo teacher sign-in).

### Optional: the APInex backend

Only if you want answers from the APInex gateway instead of the local engine,
put this in your local `.env` (never in chat, never committed):

```ini
IRUSHY_ENGINE=apinex
APINEX_API_KEY=sk-apx-...
```

```bash
npm run verify:apinex    # one real call; prints no key material
npm start
```

With `IRUSHY_ENGINE=apinex` and no key, IRUSHY answers
*"IRUSHY is not connected yet."* and still offers the verified site links. The
local engine never shows that message. IRUSHY never falls back from one
backend to the other on its own, and never switches to a paid model.

### Optional: a model on this machine (Ollama)

Only if you want answers from a language model running on the same machine.
Install [Ollama](https://ollama.com), pull a model that you have tried in
Tamil and English, and put this in your local `.env`:

```ini
IRUSHY_ENGINE=ollama
OLLAMA_MODEL=llama3.2          # example: any name from "ollama list"
# OLLAMA_BASE_URL=http://127.0.0.1:11434   (the default)
```

```bash
ollama pull llama3.2     # once, on this machine
npm run verify:ollama    # running? model installed? one tiny answer; Tamil?
npm start                # the startup log says whether Ollama and the model answered
```

- **No key, no account.** IRUSHY sends no credentials to Ollama.
- **This machine only.** Another machine (a LAN box, a docker service) or an
  Ollama cloud model (a name ending in `cloud`, run on ollama.com and possibly
  paid) would send visitors' questions off the server. IRUSHY refuses to start
  with either unless you also set `IRUSHY_OLLAMA_ALLOW_REMOTE=true`.
- **No fallback.** If Ollama is not running or the model is missing, the
  visitor gets a clear error with the verified links and the admin gets an
  `adminHint` (`ollama serve`, `ollama pull …`). IRUSHY never switches models
  and never quietly answers from another engine instead.
- **Same guard rails as every answer:** markup stripped, unverified URLs and
  invented `[ids]` removed, length capped, sample content labelled, test
  answers refused before the model is called.
- **Determinism is only guaranteed by the local engine.** IRUSHY sends the
  same request for the same question (temperature 0, a fixed seed), but the
  words also depend on the model, the Ollama version and the hardware.

How it works and what it sends: [`docs/ENGINE.md` §10](docs/ENGINE.md#10-other-backends).

### Scripts

| Command | What it does |
|---|---|
| `npm start` | run the server (API + local site preview) on `PORT` (default 8787) |
| `npm run dev` | same, with auto-restart on file changes |
| `npm test` | **1725** server checks in about 8 s. Every local-engine server runs with **outbound network blocked**. Covers the bilingual acceptance matrix, every intent, determinism, guards, limits, teacher tools, and both optional backends against a mock (the Ollama servers with the network blocked except their own address) |
| `npm run check:ui` | **69** real-browser checks (desktop + mobile) against the local engine, no mock; screenshots into `docs/screenshots/` |
| `npm run verify:apinex` | the only real APInex call, for the optional backend. Refuses without a key (exit 2) |
| `npm run verify:ollama` | checks a real Ollama for the optional backend: running, model installed and local, one tiny answer, same reply twice, Tamil reply. Refuses without `OLLAMA_MODEL` (exit 2) |
| `npm run build:data` | read-only re-check of the published materials and site pages; dry run unless `--write` |

`npm run check:ui` needs Chromium once: `npx playwright install chromium`, or
point `IRUSHY_CHROMIUM_PATH` at any Chromium build.

### Accessibility & mobile

- launcher, compact panel, language selector, clear chat, loading indicator, retry
- full keyboard support: `Escape` closes, `Tab` is trapped, focus returns to the launcher
- visible focus rings, `aria-live` log, labelled controls, high-contrast-safe colours
- `prefers-reduced-motion` respected; forced colours supported
- on phones the panel is full-screen and re-anchors to the **visual** viewport, so
  the close button and the input are never hidden behind the on-screen keyboard

---

## 3. Architecture

```
                        browser (the website + the widget)
                          │  POST /api/chat   (no key, ever)
                          ▼
   ┌───────────────────────────────────────────────────────────────┐
   │ IRUSHY server (Node + Express)                                │
   │                                                               │
   │  limits.js      per-IP limits, duplicate collapse, concurrency│
   │  session.js     server-signed cookie -> role (visitor/teacher)│
   │  policy.js      mode decision, assessment guard, results gate │
   │  routes/chat.js backend-agnostic; refusals decided here       │
   │                                                               │
   │  engine/ ── local (default) ─ intent → composer → phrasebook  │
   │         │                     no key, no network, same answer │
   │         ├── apinex (optional, off) ─ hosted gateway, key      │
   │         └── ollama (optional, off) ─ model on this machine,   │
   │                                      no key; no fallback      │
   │  respond.js     links only from site-pages, [ids] checked,    │
   │                 sample label + notice, length cap: all engines│
   └───────────────────────────────────────────────────────────────┘
```

Data files, each maintainable on its own:

| File | Contents | Provenance |
|---|---|---|
| `data/site-pages.json` | the 9 verified public destinations | checked against the live site |
| `data/site-faq.json` | website-help answers, with source links | verified-site |
| `data/resources.json` | 58 published study materials (PDF, plus one .ppt and one .jpg) | recorded from the live site |
| `data/knowledge/concepts.json` | 13 bilingual concept notes, one per question-bank topic | **sample-unapproved** until a teacher signs off |
| `data/knowledge/phrasebook.en.json`, `phrasebook.ta.json` | the engine's wording | engine wording, awaiting review |
| `data/knowledge/lexicon.json` | word lists (abuse, off-topic, not published, …) | engine configuration |
| `data/videos.json`, `data/diagrams.json`, `data/question-bank.json` | approved media and questions | **empty** until approved |
| `data/sample/*.json` | sample videos, diagrams, questions, glossary | **sample-unapproved**, always labelled |

---

## 4. Integrating with the real website

The home page is a **frameset**
(`index` → `ToppageHome.asp` + `IrushyFrameHome.asp` → three nested frames).
That matters: **a frameset document cannot render an overlay of its own**. Its
`<body>` *is* the `<frameset>`, so a floating button placed there gets a 0×0
box.

The delivery therefore uses a shell page that embeds the untouched frameset and
hosts the widget in a normal top-level document:

```html
<!-- public/index.html - the only new file in the site path -->
<iframe id="site-frame" src="site-home.html"></iframe>
<link rel="stylesheet" href="/irushy/irushy.css">
<script defer src="/irushy/irushy.js" data-irushy-mode="home" data-irushy-host="top"></script>
```

Nothing on the site is redesigned. The copy keeps:
- the same two-row frameset (23% / 77%);
- the same three-column inner frameset (20% / 65% / 20%);
- the same left-hand **Teacher Registration** and **Student Registration**
  choices;
- the same top-left **web-admin portrait**;
- the same slide show and the same two NEET logins.

Two other integration routes are documented in
[`docs/INTEGRATION.md`](docs/INTEGRATION.md). `data-irushy-mode` is only a
*request*: the server decides the effective mode from the signed session, so
putting `teacher` in the page grants nothing.

---

## 5. API surface

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/chat` | any session | the assistant. Body: `{ message, lang, mode_requested, history, context, request_id, debug? }` |
| `GET /api/config` | any | public runtime configuration (no secrets) |
| `GET /api/health` | any | readiness; `?deep=1` runs the engine's self-test (local), probes the provider (apinex), or checks that Ollama runs and the model is installed (ollama) |
| `GET /api/site/links?mode=&lang=` | any | verified website links |
| `GET /api/site/services?lang=` | any | the services published on the live site |
| `GET /api/suggestions?mode=&lang=` | any | starter questions |
| `GET /api/diagnostics` | any (teacher in production) | variable **names** with set/unset, never values |
| `GET /api/session`, `POST /api/session/login`, `POST /api/session/logout` | none | server-signed role |
| `GET /api/teacher/coverage` | **teacher** | what the approved bank can build |
| `GET /api/teacher/bank` | **teacher** | search the bank (approved + labelled sample) |
| `POST /api/teacher/paper` | **teacher** | assemble a draft paper + separate answer key |
| `POST /api/teacher/paper/:id/review` | **teacher** | record that a named teacher read a draft (publishing is *not* implemented) |
| `GET /api/teacher/results/:studentRef` | **teacher** | always `503` + "unavailable" until real permissions exist |

Every chat response carries the same fields, whichever engine answered:

- `ok`, `mode`, `lang`, `lang_how`, `answer`;
- `citations` (each id is real data), `links` (verified only), `attachments`;
- `provenance`, `sampleContentUsed`, `sampleNotice`, `urlsRemoved`;
- `suggestions`, `notices`, `results_access`, `assessment`, `blocked`;
- `meta`: `engine`, `engine_version`, `intent`, `confidence`,
  `knowledge_version`, `transcript_stored: false`, `key_on_server_only: true`,
  `requires_key`, and `debug` when asked for. The optional backends add
  `provider_model`.

Failures return `ok: false` with an explicit `error.code`, a bilingual
message, an `adminHint` for configuration problems, and the verified website
links. The local engine can only fail with `engine_error`, `busy` or the
input and limit codes. The optional backends add (Ollama never uses the
first three, which are about keys and accounts):

| `not_connected` | `invalid_credentials` | `insufficient_quota` | `model_unavailable` | `rate_limited` |
|---|---|---|---|---|
| **`provider_unavailable`** | **`invalid_request`** | **`timeout`** | **`network_error`** | **`bad_provider_response`** |

---

## 6. Security posture (short version)

- The default engine has **no key at all**, and neither has the optional
  Ollama backend. When the optional APInex backend is on, its key exists only
  in the server process. It is never in the widget,
  `/api/config`, a response or a log; a redactor strips it, `sk-...` patterns
  and `Authorization` headers. `.env` is git-ignored.
- Roles come from an **HMAC-signed, HttpOnly** cookie. A client-side "Teacher"
  selection is downgraded on the server, and the downgrade is explained.
- Answers are plain text assigned with `textContent`. Only verified site URLs
  can appear; anything else is removed and reported in `urlsRemoved`. Every
  cited `[id]` must exist in `data/`.
- Diagram SVG is validated twice, and videos load only after a click, on
  `youtube-nocookie.com`.
- Bounded everything: input, history, answer length, timeouts, retries, body
  size, concurrency, and per-IP rate limits, with a separate chat budget.
- No transcripts are stored.
- Answers to a test are never revealed or confirmed without a server-signed
  "completed" token. Student results are never shown or simulated.

Details: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## 7. Verified state of the live site (as recorded on 2026-10-15)

A read-only inspection returned HTTP `200` for all nine destinations:
- `Admin Login` and `School Login`;
- `Online One Word Test` and `Materials`;
- `Teacher Registration` and `Student Registration`;
- `NEET Co-Ordinator Login` and `NEET Student Login`;
- the home page.

The materials page lists 58 published files across 11th/12th Computer Science,
Computer Applications, Computer Technology and General Instructions, in Tamil
and English medium. All of that is in `data/` with source ids. None of it was
invented, and it was not re-checked from the sandbox used for this rebuild
(`npm run build:data` does that, read-only).

Nothing on the live site publishes fees, refunds, timetables, staff lists,
results or any policy text, so IRUSHY says "not published on this website"
rather than guess. There were no video links on the live site either, which is
why `data/videos.json` starts empty.
