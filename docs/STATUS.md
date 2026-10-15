# What is finished, what is waiting, and why

An honest inventory. "Awaiting" never means "silently faked": in every case
below IRUSHY says so in the panel, and the API returns an explicit code or
label.

> **2026-10-15 rebuild.** The upload had no `server/` or `tools/` code. Both
> were rebuilt from the documents in this folder and the widget's contract,
> and the default engine is now IRUSHY's own local engine. The earlier test
> counts (157 / 65) belonged to code that is not in the repository; the new
> suites report their own numbers (`npm test` 1610, `npm run check:ui` 69).

---

## Finished and verified

### 1. IRUSHY's own engine (default)
- `IRUSHY_ENGINE=local` is the default. There is no key, no account and no
  quota, and it makes no network call.
  - **Proven by test:** every local-engine server in both suites runs with
    fetch, sockets, TLS, DNS and http(s) requests blocked, and reports zero
    attempts. The engine is also run in-process under the same block.
- It is deterministic: the same request twice gives a word-for-word identical
  answer. This is checked on every answer in the matrix, and across two
  separately started servers.
- It covers 23 intents in Tamil and English, from greetings to completed-test
  mistakes. The full list is in [`ENGINE.md`](ENGINE.md).
- `npm install && npm start` works with no `.env` and answers real questions.

### 2. Homepage assistant, end to end
- `Ask IRUSHY` launcher (48 px touch target), compact 384 px desktop panel,
  full-screen mobile panel. The widget is unchanged except for one line (see 9).
- Website answers come from **verified** data only:
  - what the site is;
  - the left menu;
  - the NEET logins;
  - the one published contact;
  - how to take the test;
  - what IRUSHY can and cannot see.
- 12 FAQ entries, each with source links into `data/site-pages.json`. Only
  verified URLs can appear in an answer.

### 3. Bilingual behaviour
- `Auto` matches the visitor:
  - Tamil script in the message → Tamil;
  - otherwise `Accept-Language`;
  - an explicit "explain … in Tamil" is honoured;
  - a language chosen in the panel always wins.
- Tamil answers are composed from Tamil wording:
  - verb-final sentences;
  - respect forms;
  - English technical terms kept, as Tamil-medium books do.

### 4. Student mode
- Explain a topic, define a term, step-by-step method, *Explain more simply*,
  *Show an example*, *Try a similar question*, *Show the answer*, and marking
  of the student's attempt.
- **Follow-ups keep the topic** by reading the ids cited in IRUSHY's previous
  answer. History is untrusted, so forged ids are ignored.
- Practice questions are chosen in this order:
  1. approved bank questions marked for practice (none yet);
  2. labelled sample bank questions;
  3. **generated** questions from the note, always labelled *not from the
     question bank and not an exam question*.
- Diagrams render as inline SVG. A video player is created only after a click.
  When no approved visual exists, IRUSHY says so.

### 5. Assessment guard (both directions verified)
- A client can never declare a test finished; such claims are ignored.
- Without a server-signed token from the test backend
  (`IRUSHY_ASSESSMENT_SECRET`), IRUSHY refuses to reveal or confirm answers
  before any engine is called. "Give me the answers for the test" is refused
  even when a completed token is present.
- With a verified **completed** token and the test page's context (question,
  selected answer, correct answer, `conceptRef`), IRUSHY explains the mistake
  in English or Tamil and points to the published lesson.
- Tested in both directions: wrong secret, tampered payload, an active test,
  completed-but-not-permitted, no secret configured.

### 6. Teacher mode
- Every teacher route requires a server-signed teacher session.
- The paper builder uses **approved questions only**:
  - it is deterministic;
  - every paper is a draft that requires review;
  - the answer key is a separate object, and there is a plain-text export;
  - gaps are reported, never filled.
- Labelled sample questions are used only on request, and such a paper is
  watermarked `SAMPLE - NOT APPROVED`.
- In teacher mode the chat summarises what the approved bank can build (today:
  nothing) and points to the builder.

### 7. Failure behaviour
- The local engine has no provider to fail. Its only failures are
  `engine_error` and `busy`, with the input and limit codes for bad requests.
- On the optional APInex backend:
  - provider failures map to explicit codes with bilingual messages, an
    `adminHint` and the verified links;
  - a missing key gives "IRUSHY is not connected yet.";
  - it never switches models on its own and never silently falls back.

### 8. Security and privacy
See [`SECURITY.md`](SECURITY.md). Verified by test:
- no key anywhere in the page, the widget, `/api/config`, responses or logs;
- logs are JSON with secrets redacted, and contain no message bodies by default;
- an `HttpOnly` + `SameSite` session cookie, and tampered cookies are rejected;
- `DENY` framing and `default-src 'none'` on the API;
- a site CSP that allows inline scripts by hash only;
- a CORS allow-list;
- `413` / `400` on bad bodies, `429` with `Retry-After`;
- duplicate submissions answered once, and history trimmed;
- hostile optional-backend output neutralised.

### 9. The one widget change
The widget used to show *"Student results are not available to IRUSHY."*
whenever the **answer** contained "result", "mark" or "score". Local-engine
lessons contain those words (the SQL example's `mark` column), so the notice
appeared on ordinary answers. It now appears only when the server reports
`meta.intent: "results_privacy"`. Rendering is still `textContent` only.

---

## Content awaiting teacher approval

IRUSHY labels all of this as sample content in every answer that uses it:
- the *Sample - not approved* chip;
- `sampleContentUsed: true`;
- a bilingual notice;
- a closing line in the answer itself.

| # | Content | File | Who should review | Status |
|---|---|---|---|---|
| 1 | **13 concept notes**: definition, 2–4 key points, worked example, common mistake, everyday analogy, English and Tamil | `data/knowledge/concepts.json` | subject teacher (content) + Tamil-medium teacher (Tamil) | written for this project, `sample-unapproved` |
| 2 | **109 named-term definitions** inside those notes, English and Tamil | same file, `terms` | same | `sample-unapproved` |
| 3 | **Topic placement**: class/subject per note follows the sample bank (e.g. HTML under 12th CS, Spreadsheet under 11th CA); no note is mapped to Computer Technology | same file | subject teacher | to confirm |
| 4 | **Lesson links** (`conceptRef`) for 11 topics: Number systems, Boolean algebra, Computer organisation, Computer memory, Operating systems, HTML, HTML/CSS, Database/SQL, Spreadsheet, Internet, Internet safety | same file | subject teacher | `null` on purpose. Only Python and Computer networks have a published material whose title names the topic; lesson numbers were never guessed |
| 5 | **Engine wording**: 115 frames × 2–4 variants + fixed labels | `data/knowledge/phrasebook.en.json`, `phrasebook.ta.json` | Tamil-medium teacher (Tamil), any teacher (English) | awaiting review |
| 6 | **Word lists** (abuse, off-topic, not published, other subjects, topics without notes) | `data/knowledge/lexicon.json` | a teacher, for false positives | awaiting review |
| 7 | **Sample glossary**: 54 Tamil technical terms | `data/sample/glossary.sample.json` | Tamil-medium teacher | `sample-unapproved` (unchanged) |
| 8 | **Sample question bank**: 28 questions | `data/sample/question-bank.sample.json` | subject teacher; move approved items into `data/question-bank.json` (add `"practice": true` to allow them as chat practice) | `sample-unapproved` (unchanged) |
| 9 | **Sample videos (3) and diagrams (3)** | `data/sample/videos.sample.json`, `diagrams.sample.json` | teacher | `sample-unapproved` (unchanged) |
| 10 | **Tamil fixes in the verified FAQ**: பொத்தானைச் சொடுக்கவும் (×4), சொல்லமாட்டேன், உரையாடலில், கேளுங்கள், என்ன பார்க்க முடியும்? | `data/site-faq.json` | Tamil-medium teacher, to confirm | changed in a separate commit |
| 11 | **FAQ wording notes, not changed**: the long first sentence of `faq.what-is-site`; "தமிழ் வடிவு / ஆங்கில வடிவு" (books say "தமிழ் வழி"); "தேர்வை தொடங்கவோ" (sandhi: தேர்வைத் தொடங்கவோ); "விசயங்களை" (விஷயங்களை) | `data/site-faq.json` | Tamil-medium teacher | left as they were |

How to approve a note, fix wording and map a lesson: [`ENGINE.md` §6](ENGINE.md#6-for-teachers-correcting-adding-and-approving-notes).

## Awaiting content (the assistant is truthful in the meantime)

| Waiting on | Effect today | How to fill it |
|---|---|---|
| Approved **video** links | IRUSHY says no approved video exists; 3 sample links are labelled | approve a link, move it into `data/videos.json` with `status: "approved"`, `approvedBy`, `approvedOn` |
| Approved **diagrams** | same; 3 sample SVGs are labelled | add validated inline SVG to `data/diagrams.json` |
| Approved **question bank** | the paper builder reports empty coverage and generates nothing | import approved questions into `data/question-bank.json`; `GET /api/teacher/coverage` shows what it can build |

---

## Awaiting integration

### 1. Real teacher sign-in
`IRUSHY_ENABLE_DEMO_LOGIN=false` by default. `POST /api/session/login` then
answers `501` and tells visitors not to type a password into the chat. The
throw-away demo sign-in exists only to prove server-side enforcement. To make
sign-in real, point `/api/session/login` at the school's account system (the
ASP auth) or a small teacher registry, then issue the session with
`sessions.issue(req, res, { role: 'teacher' })`.

### 2. Completed-test permission (the exact interface)

```
token = base64url(JSON({ studentRef, testId, status, completedAt, anonymousPermitted }))
        + "." + base64url(HMAC-SHA256(body, IRUSHY_ASSESSMENT_SECRET))
```

- `status` is `completed` or `active`. The secret is shared between the two
  services only.
- A completed token is honoured only for a signed-in student whose
  `studentRef` matches, unless `anonymousPermitted` is set.
- The test page sends it as `context.assessmentToken`, together with
  `question`, `selectedAnswer`, `correctAnswer`, `conceptRef` and, optionally,
  `questionId` and `topic`.

### 3. Student results
`GET /api/teacher/results/:studentRef` returns `503` with
`neverSimulated: true` and `records: null`, even for a signed-in teacher.
Real results need three things that don't exist yet:
- a teacher identity mapped to students;
- a per-student permission check on every request;
- an audit record.

### 4. Deployment to the live site
Not done, and deliberately not part of this work; the live site was not
modified. Steps are in [`INTEGRATION.md`](INTEGRATION.md). Production needs:
- `NODE_ENV=production`;
- `IRUSHY_SESSION_SECRET` set;
- HTTPS;
- an approval decision for the concept notes. In production, unapproved notes
  are off by default, and IRUSHY then answers website questions only.

---

## Not rebuilt / changed from the earlier documents

- **Web search** (`IRUSHY_ENABLE_WEB_SEARCH`) was an APInex-only option. It is
  not part of the rebuild; the local engine has no web access by design.
- **`verify-apinex`** does not check the account balance, because no balance
  endpoint is documented in this repository.
- **Self-hosted Ollama-compatible backend:** not built. It would sit behind the
  same engine interface, off by default.
- **`build-resources-from-live`** is rebuilt but could not be run against the
  live site from the sandbox, which had no route to tnhhsscta.com. Its parser
  is tested on markup built from `data/resources.json`.
