# Verification report

Date: **2026-10-15** · Environment: Node 20.20.2, Chromium 156 (headless),
local development copy only.

Two suites, both reproducible on a clean checkout:

```bash
npm install
npm test            # 157 checks - server behaviour, end to end
npm run check:ui    # 65 checks  - real browser, desktop + mobile + screenshots
```

Last run:

```
npm test          RESULT: 157 passed, 0 failed
npm run check:ui  UI CHECK: 65 passed, 0 failed
```

The UI suite writes the screenshots in `docs/screenshots/`, so the result can be
looked at as well as read.

---

## How the tests are able to make a real request path work without a key

`tools/mock-provider.mjs` is a small stand-in for APInex that speaks the same
OpenAI-compatible contract the provider publishes
(`POST /v1/chat/completions`, `Authorization: Bearer …`, `{model, messages,
max_tokens, temperature, stream}`, OpenAI-shaped success and error bodies,
`retry-after` and `x-ratelimit-*` headers). The suite points IRUSHY at it with a
throw-away key.

That means the test exercises the **real** pipeline — configuration, the
provider client, prompt construction, retrieval, sanitising, attachments,
error mapping — rather than a stub. It also lets the suite assert things about
the wire format that a real key could not be asked to prove, for example that
the model id on the wire is exactly `free/gemini-3.8-flash` and that the key is
present in the `Authorization` header but absent from the request body.

Only `npm run verify:apinex` talks to the real service, and it refuses to run
without a key (exit code 2), so a fresh clone cannot spend anything.

---

## What the 157 server checks cover

**Pass A — a fresh clone with no credentials (server started with no key)**
- `/api/health` reports `connected: false`, the exact configured model,
  results access unavailable, and `transcriptStored: false`
- `/api/config` exposes no key material, no key length, no hash
- a chat request returns `ok: false`, `code: not_connected`, `answer: null`
  (no canned reply), with the message *"IRUSHY is not connected yet."*
- the 4+ verified website links are still returned, all on `tnhhsscta.com`
- the failure carries an `adminHint` naming the variable to set
- a Tamil message is detected as Tamil and answered in Tamil
- `mode_requested: "teacher"` from a visitor is **downgraded to home** and the
  downgrade is explained
- `/api/teacher/coverage` and `/api/teacher/results/...` return `403` for a
  visitor
- an empty message → `400`; an over-long message → `413`
- a client-claimed `assessmentStatus: "completed"` is ignored and the answer is
  refused

**Pass B — full request path against the mock provider**
- English and Tamil answers, Tamil script verified in the output
- model id, Bearer auth, output-token cap, non-streaming, system-prompt-first,
  mode rules present, citation instruction present
- **only retrieved entries are injected** (block count bounded, not the corpus)
- hostile model output: `<script>` and tags stripped, an invented external URL
  removed and reported in `urlsRemoved`, an invented citation id not attached,
  a real citation id attached
- failure mapping for `401 → invalid_credentials`, `402 → insufficient_quota`,
  `429 → rate_limited`, `503 → provider_unavailable`, `400 → invalid_request`,
  each with static help links, bilingual text and no key material
- a hang → `timeout` within the configured window including the bounded retry
- duplicate submissions (same `request_id`) reach the provider **once**
- the assessment guard in both directions (see below)
- teacher sign-in sets an `HttpOnly`, `SameSite` cookie; a wrong password is
  `401`; a paper is assembled as a draft that requires review, with a separate
  answer key; gaps are reported instead of invented; the results endpoint stays
  `503`/`neverSimulated` even for a teacher
- safety headers: `DENY` framing, `default-src 'none'` CSP, `no-store`, CORS
  only for the configured origin
- the local site copy: all five frames load, `ROWS="23%,77%"` and
  `COLS="20%,65%,20%"` preserved, Teacher Registration / Student Registration /
  Materials / web-admin portrait / NEET logins all still present, and the
  frameset copies carry no widget tag of their own
- the widget JS contains no credential, uses `textContent` (no `innerHTML`
  assignment), and has the language selector, clear-chat and lazy video load

**Pass C — limits**
- rate limiting engages (`429` + `Retry-After` + bilingual message)
- reads and health checks are **not** starved by the chat budget
- a long history is trimmed, not refused; a body above the configured limit is
  refused with `413`; a non-object JSON body is refused

**Assessment guard, verified in both directions**

| Case | Expected | Result |
|---|---|---|
| client says "completed", no token | refused, provider not called | pass |
| server-signed token, `status: "completed"` | mistake explanation allowed | pass |
| tampered signature | rejected | pass |
| token signed with a different secret | rejected | pass |
| server-signed token, `status: "active"` | refused, `provider_called: false` | pass |

---

## What the 65 browser checks cover

**Desktop 1280×900** — launcher present after the frameset loads and visible;
panel starts hidden; opens on click; 384 px wide; fully inside the viewport;
focus moves to the input; language and mode selectors labelled; close button
named; a real English answer renders; model text is not parsed as HTML (the card
has zero child elements); a verified `AmmaURL.asp` link appears; an
approved-source chip appears; a Tamil answer renders in Tamil script; choosing
Teacher shows the sign-in hint; a diagram renders; **no video iframe exists
before the click** and one appears after, on `youtube-nocookie.com` with a
title; an outage shows a readable error card with links and a Retry control;
`Escape` closes and focus returns to the launcher; Tab stays trapped and a
visible focus ring is defined; Clear chat resets to the empty state; no page
errors for the whole run.

**Mobile 390×844 (iPhone-class)** — launcher is ≥44 px and inside the viewport;
panel is full width and does not exceed the viewport; close button and input are
on screen; the composer is ≥40 px tall; the input font is ≥16 px so iOS does not
zoom; viewport meta is `width=device-width`; an answer renders; with the
**visual viewport shrunk to 420 px** (simulated on-screen keyboard) the panel is
limited to the visible height and both the close button and the input stay on
screen; no page errors.

**No-credentials server** — the panel shows *"IRUSHY is not connected yet."*, the
error is not a canned reply, and the verified links are still offered.

**Accessibility** — the panel opens under `prefers-reduced-motion` and animation
is suppressed; the site iframe is not resized or hidden; no key material in the
page or in the server log.

**Screenshots** (`docs/screenshots/`) — homepage closed, panel open, English
answer, Tamil answer, diagram + lazily loaded video, provider outage, mobile
panel, mobile answer, mobile with keyboard open, not-connected state.

---

## Screenshot evidence

| File | Shows |
|---|---|
| `01-homepage-desktop-closed.png` | the untouched TNHHSSCTA home page with the *Ask IRUSHY* launcher |
| `02-panel-open-desktop.png` | compact desktop panel, language + mode selectors |
| `03-answer-desktop.png` | verified "not connected" state with the real website links |
| `04-tamil-answer-desktop.png` | a Tamil answer |
| `05-diagram-and-video-desktop.png` | sample diagram (labelled) + video attachment before loading |
| `06-provider-outage-desktop.png` | explicit outage message, links and Retry |
| `07-mobile-panel-empty.png` | full-screen mobile panel |
| `08-mobile-answer.png` | answer with source chip and follow-up actions |
| `09-mobile-keyboard-open.png` | keyboard-open state: input and close button still visible |
| `10-not-connected-desktop.png` | "IRUSHY is not connected yet." with static help |

---

## Bugs this process found and fixed

Recorded because they show the checks are doing real work:

1. **Frameset overlay was impossible.** The launcher existed in the DOM of the
   frameset document and measured 0×0 px, because in a frameset page
   `document.body` *is* the `<frameset>`. The widget now detects this and, in
   order: uses the shell page, or injects itself into the largest frame, or
   offers the full-screen assistant page. (Found by measurement, not assumption.)
2. **SVG attribute validator rejected valid diagrams** because it scanned the
   whole file for `name=` patterns and matched the *text content* `"byte = 8
   bit"` in a `<text>` element. Rewritten as a real tag walk.
3. **Glossary entries silently dropped** (54 of them) because they had no `id`;
   ids are now derived for glossary rows.
4. **Rate limiter starved reads.** A single bucket on `/api` meant ~15 polled
   reads could consume a visitor's whole chat budget. Now two instances: a
   generous read budget and a strict chat budget.
5. **Mobile keyboard hid the input.** `position: fixed; bottom: 0` anchors to the
   layout viewport, which the keyboard covers. The panel now anchors to the top
   of the *visual* viewport with its height, verified with a simulated 420 px
   viewport.
6. **Attachment title collapsed to one word per line** (caught by reading a
   screenshot): a long title squeezed beside a label chip in a 384 px panel. The
   header is now stacked, and a regression check asserts the title stays wide.
7. **Eight links at once swamped the panel**; capped at four with a
   "Show N more links" control, except in outage replies where every link stays
   visible because that is the whole point.

---

## What could **not** be verified here, and how to verify it

| Item | Why not verified here | How to verify |
|---|---|---|
| A live APInex call | requires a real key, which must stay outside this workspace | put your key in `.env`, run `npm run verify:apinex` (prints no key material, checks balance, checks the exact model is listed, makes one small completion, probes the error mapping) |
| Provider behaviour under a paid tier / higher RPM | needs the paid plan | raise `IRUSHY_PROVIDER_RPM` and re-run `npm test`; the limiter is driven by config |
| Real completed-test tokens | the ASP/DB side does not exist yet | the smoke test mints tokens with `IRUSHY_ASSESSMENT_SECRET` in the exact documented format; share the secret with the test backend and call `POST /api/chat` with `context.assessmentToken` |
| Teacher → student results | no permission source exists yet | `/api/teacher/results/:studentRef` returns `503`; it should stay that way until real permissions and an audit trail are in place |
| Real phone hardware | headless Chromium with a simulated visual viewport | open the local preview on a phone; the widget's keyboard handling uses `visualViewport` and `dvh` |
| Deployment on IIS/Plesk | this copy is local by design | see `docs/INTEGRATION.md` |

---

## Manual spot checks

```bash
npm start
# then, in another shell:
curl -s localhost:8787/api/health | head -40
curl -s localhost:8787/api/site/links?mode=student | head -20
curl -s localhost:8787/api/diagnostics          # key names only, never values
curl -s -X POST localhost:8787/api/chat \
     -H 'content-type: application/json' \
     -d '{"message":"Where are the materials?","lang":"en"}' | head -40
# a visitor cannot become a teacher:
curl -s -X POST localhost:8787/api/chat -H 'content-type: application/json' \
     -d '{"message":"build a paper","mode_requested":"teacher"}' | grep -o '"mode":"[a-z]*"'
```
