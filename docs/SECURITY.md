# IRUSHY security and privacy notes

Everything below is implemented in `server/` and covered by `npm test`
(1725 checks) and `npm run check:ui` (69 checks) unless marked otherwise.

---

## 1. Keys: none by default

The default engine (`IRUSHY_ENGINE=local`) uses **no key of any kind** and
makes **no outbound network call**. That is tested by running every local
server with all outbound paths blocked.

The rules below apply only if you switch on the optional APInex backend
(`IRUSHY_ENGINE=apinex`):

| Rule | Where it is enforced |
|---|---|
| The key is only ever read from `process.env` (via `.env` or the real environment) | `server/config.js` |
| Used in exactly one place: the outgoing `Authorization` header | `server/lib/engine/apinex.js` |
| Absent from the browser bundle | `public/irushy/irushy.js` contains no credential; verified by test |
| Absent from `/api/config` | only the engine name, model id and flags are exposed, never the key, its length or a hash |
| Absent from every response, including errors | errors carry a code, a bilingual message and an `adminHint` naming the variable, never a header or a value |
| Absent from logs | `server/lib/log.js` redacts configured secrets, `sk-...` patterns, `Bearer` tokens and password/secret/token fields, and keeps each line valid JSON |
| Not committed | `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `secrets.json` |
| Never requested in chat | the widget never asks; `verify-apinex` refuses without a key; the sign-in route tells visitors not to type a password |

- **Missing or placeholder key:** a key that is missing, or still the
  placeholder `sk-apx-REPLACE_ME`, counts as *not connected*. Chat then says
  "IRUSHY is not connected yet."
- **No fallback:** IRUSHY never falls back from APInex to the local engine or
  the other way. It never switches models unless
  `IRUSHY_ALLOW_MODEL_FALLBACK=true` (off by default).

The optional Ollama backend (`IRUSHY_ENGINE=ollama`) has **no key either**:

- **No credentials are sent.** IRUSHY sends no `Authorization` header or
  credential of any kind to Ollama, and the suite checks the wire for this.
  An `OLLAMA_BASE_URL` containing a user name or password is refused at
  startup, without echoing it.
- **The address is not secret, but it is not exposed.** `/api/config` shows
  only the model name. `/api/diagnostics` shows set/unset only.
- **Questions stay on this machine by default.** A non-loopback
  `OLLAMA_BASE_URL` (a LAN box, a docker service name, a hosted service) and an
  Ollama cloud model (a tag of `cloud` or ending in `-cloud`, run on
  ollama.com, possibly on a paid plan) both make the server refuse to start,
  unless `IRUSHY_OLLAMA_ALLOW_REMOTE=true`.
- **A cloud model behind a local name** (`remote_host` in Ollama's model
  list) cannot be seen from the name. The startup check logs a warning for it,
  and `/api/health?deep=1` reports it as not ok. For a strictly local Ollama,
  also disable cloud features on the Ollama side (`OLLAMA_NO_CLOUD=1`).
- **No fallback:** IRUSHY never switches models, and never answers from
  another engine when Ollama fails.

## 2. Roles and permissions

- **The session cookie** is HMAC-SHA256 signed, `HttpOnly` and `SameSite=Lax`,
  plus `Secure` in production or behind HTTPS. The payload is
  `{ sid, role, exp }`, with no personal data. Tampered cookies count as
  visitors.
- **`resolveMode()`** is the only decision point. A client asking for `teacher`
  without a signed teacher session is downgraded to `home`, and the visitor is
  told why.
- **`requireTeacher()`** runs on every teacher route; without a teacher session
  the route returns `403` with a bilingual explanation.
- **The optional demo sign-in** is off by default and compares credentials in
  constant time.

## 3. Untrusted input, both directions

**From the visitor:**
- messages are length-capped and control characters are stripped;
- the body is size-limited before parsing, and a non-object body is refused;
- `context` fields are allow-listed and bounded;
- `history` is trimmed to the configured turns and characters.

History is also treated as untrusted *data*: ids cited in earlier answers are
only used if they exist in `data/`, so a forged `[concept.x]` or
`Practice ref:` changes nothing.

**From the engine:**
- Answers are plain text, and the widget assigns them with `textContent`
  only.
- The local engine writes text only from the phrasebook and `data/`.
- For any engine, the response builder:
  - removes any URL that is not in `data/site-pages.json` and reports it in
    `urlsRemoved`;
  - drops any `[id]` that does not exist in the loaded data;
  - attaches links only by verified page id.
- Output from the optional backends (APInex, Ollama) also gets:
  - tags, script patterns, Markdown and `<think>` reasoning traces stripped;
  - a cut at a sentence end to fit `IRUSHY_MAX_ANSWER_CHARS`;
  - the sample label, whenever a sample entry was among the model's
    references (cited or not);
  - `bad_provider_response` instead of an answer if nothing is left after
    cleaning.
- Diagram SVG is validated in the loader and rebuilt in the browser against
  the same tag/attribute allow-list:
  - no `<script>` or `<foreignObject>`;
  - no `on*` handlers;
  - no external references or `javascript:` URLs.

**Framing and transport:**
- API responses set `X-Frame-Options: DENY`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and
  `Cache-Control: no-store`.
- The site CSP allows:
  - same-origin scripts, plus the site copy's two inline scripts **by SHA-256
    hash only**;
  - `data:` images;
  - frames from the site and `youtube-nocookie.com` only. A player is never
    created before a click.

**CORS:** an explicit origin allow-list with credentials. `*` is never used,
and an unknown origin gets no CORS headers.

## 4. Assessments and results

- IRUSHY never reveals or confirms answers for a test that may still be
  assessed. The decision is made in the route before any engine runs, so
  neither optional backend is ever called for it (tested for both).
  - **Test status comes only from a server-signed token**
    (`IRUSHY_ASSESSMENT_SECRET`, HMAC-SHA256, constant-time comparison).
  - **No secret configured** means every test counts as active.
  - **Client claims** such as `assessmentStatus: "completed"` are ignored.
- Student results are **unavailable**. The endpoint returns `503` with
  `neverSimulated: true` and `records: null`, even for teachers. No mark or
  record is simulated anywhere.

## 5. Privacy

- **No transcripts.** Nothing is written to disk. History lives in the page's
  memory (the last few turns), is bounded on the server, and disappears on
  reload or **Clear chat**.
- **No message text in logs** by default (`IRUSHY_LOG_MESSAGE_BODIES=false`).
  The request log records id, engine, intent, mode, language, character counts,
  history length and timing.
- **With the local engine, nothing a visitor types leaves the server.**
- With the optional APInex backend, the message, the bounded history and the
  selected reference entries go to APInex.
- With the optional Ollama backend, the same go to the Ollama process at
  `OLLAMA_BASE_URL`, which is this machine unless you opted in to another.
- For a test the server has verified as completed, the backends also receive
  the returned question and both answers.
- No student record is ever sent.
- The panel says *"Nothing you type is stored."*, and the privacy answer
  tells visitors not to type exam numbers, phone numbers or passwords.
- The data files contain no personal data beyond the contact already
  published on the public home page.

## 6. Abuse and cost control

| Control | Default | Variable |
|---|---|---|
| Per-IP chat budget | **60 / 5 min** with the local engine, 30 / 5 min with Ollama, 20 / 5 min with APInex | `IRUSHY_RATE_LIMIT_MAX`, `IRUSHY_RATE_LIMIT_WINDOW_MS` |
| Read-endpoint budget | 6× the chat budget, separate bucket | `IRUSHY_READ_LIMIT_MAX` |
| Provider requests per minute | 5, **APInex backend only** (the local engine has no provider) | `IRUSHY_PROVIDER_RPM` |
| Answer length | per-intent targets, hard cap 2400 characters | `IRUSHY_MAX_ANSWER_CHARS` |
| Output tokens (APInex, Ollama) | 700 (`num_predict` for Ollama) | `IRUSHY_MAX_OUTPUT_TOKENS` |
| Input characters | 2000 | `IRUSHY_MAX_INPUT_CHARS` |
| History | 8 messages / 6000 chars (1200 per turn) | `IRUSHY_MAX_HISTORY_MESSAGES`, `IRUSHY_MAX_HISTORY_CHARS` |
| Provider timeout (APInex, Ollama) | 30 s (the widget waits at most 60 s) | `IRUSHY_REQUEST_TIMEOUT_MS` |
| Provider retries (APInex, Ollama) | 1, for 429/502/503/504 only, never with another model | `IRUSHY_MAX_PROVIDER_RETRIES` |
| Concurrency | 2 in flight, bounded queue with a 15 s wait, then a clear "busy" error | `IRUSHY_MAX_CONCURRENT`, `IRUSHY_QUEUE_TIMEOUT_MS`, `IRUSHY_MAX_QUEUE` |
| Request body | 32 KB | `IRUSHY_BODY_LIMIT_KB` |
| Duplicate submissions | the same `request_id` is answered once (joined or replayed for 30 s) | `IRUSHY_DUPLICATE_WINDOW_MS` |
| Socket timeouts | request 30 s, headers 15 s, keep-alive 5 s | — |

### Capacity

The local engine answers in a few milliseconds with no external quota. The
practical limit is the per-IP chat budget. A whole school lab behind one
address shares it, so raise `IRUSHY_RATE_LIMIT_MAX` for lab use.

The optional APInex free tier allows **5 requests per minute** per account,
and one classroom will exceed that.

With the optional Ollama backend there is no quota, but each answer takes
seconds of this machine's CPU or GPU:

- IRUSHY sends at most `IRUSHY_MAX_CONCURRENT` (2) requests at a time, and
  Ollama itself works on `OLLAMA_NUM_PARALLEL` at a time (Ollama's default
  is 1);
- other visitors wait in IRUSHY's queue for up to 15 s, then get the clear
  "busy" error.

Measure the chosen model on the real machine before a class uses it.

## 7. Reporting a problem

If an APInex key is ever suspected of leaking, rotate it in the APInex
dashboard and restart the server with the new value. With the default local
engine there is no key to leak.
