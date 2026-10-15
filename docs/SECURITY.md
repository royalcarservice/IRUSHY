# IRUSHY security and privacy notes

Everything below is implemented in `server/` and covered by
`npm test` (157 checks) and `npm run check:ui` (65 checks) unless marked
otherwise.

---

## 1. The API key

| Rule | Where it is enforced |
|---|---|
| Only ever read from `process.env` (via `.env` or the real environment) | `server/config.js` |
| Used in exactly one place: the outgoing `Authorization` header | `server/lib/apinex.js` |
| Absent from the browser bundle | `public/irushy/irushy.js` contains no credential; verified by test |
| Absent from `/api/config` | `publicConfig()` deliberately exposes only the model id and host, never the key, its length or a hash |
| Absent from every response, including errors | error objects carry a code, a status and a short provider detail string, never a header |
| Absent from logs | `server/lib/log.js` redacts the configured key, any secret-looking env value, `sk-...` patterns and `Authorization`/`x-api-key` headers |
| Not committed | `.gitignore` excludes `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `secrets.json` |
| Never requested in chat | the tool refuses without a key; the widget never asks for one; the sign-in route explicitly tells visitors not to type a password |

A key that is missing **or still the placeholder** (`sk-apx-REPLACE_ME`) counts
as *not connected*, so a mis-configured deployment reports
"IRUSHY is not connected yet." instead of leaking a confusing provider error.

## 2. Roles and permissions

- Sessions are an HMAC-SHA256 signed, `HttpOnly`, `SameSite=Lax` cookie
  (plus `Secure` in production / behind HTTPS). The payload is only
  `{ sid, role, exp }` — no personal data.
- `resolveMode()` takes the client's `mode_requested` and compares it with the
  **signed** role. A client asking for `teacher` is downgraded to `home`, the
  event is logged, and the visitor is told why.
- Every teacher route calls `requireTeacher()`; without a signed teacher
  session it returns `403` with a bilingual explanation.
- Credential comparison for the optional local demo account uses
  `crypto.timingSafeEqual`.
- The optional demo sign-in is **off by default** and exists only to
  demonstrate enforcement. The real sign-in is not connected yet.

## 3. Untrusted input, both directions

**From the visitor:** messages are length-capped, control characters stripped,
`context` fields are allow-listed (a non-`11/12` class, unknown medium or an
over-long topic is dropped), and the whole body is size-limited before parsing.

**From the model:** the answer is text, never markup.
- The server strips tags, script patterns and control characters
  (`sanitize.js`).
- Any URL the model typed is checked against the verified list: known-good URLs
  pass; `tnhhsscta.com` URLs the model typed are kept but could not have been
  invented from nothing; anything else is replaced with
  `[link removed - not verified]` and reported in `urlsRemoved`.
- The widget assigns answers with `textContent` only. There is no `innerHTML`
  on any model-derived value (checked by test).
- Citations are only attached if the cited id really exists in a data file,
  so a model-invented `[made.up.source]` cannot appear as a link.
- Diagram SVG is validated in the loader **and** rebuilt in the browser against
  a tag/attribute allow-list: no `<script>`, no `<foreignObject>`, no `on*`
  handlers, no `href`/`src`, no `javascript:` URLs.
- Retrieved knowledge entries are labelled *untrusted data* in the prompt, so a
  data file cannot issue instructions to the model.

**Framing and transport:** API responses set `X-Frame-Options: DENY`,
`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and
`Cache-Control: no-store`. The site CSP allows only same-origin scripts/styles,
`data:` images, and frames from YouTube only (a player is never created before a
click, and uses `youtube-nocookie.com`).

**CORS:** an explicit origin allow-list with credentials; `*` is never used and
an unknown origin gets no CORS headers (verified by test).

## 4. Privacy

- **No transcripts.** Nothing is written to disk. Conversation history lives in
  the page's memory (last few turns), is bounded server-side
  (`IRUSHY_MAX_HISTORY_MESSAGES`, `IRUSHY_MAX_HISTORY_CHARS`) and disappears on
  reload, on **Clear chat**, or when the panel closes and the page is left.
- **No personal data to the provider.** Nothing about a student is sent to
  APInex. The assessment path only accepts server-signed tokens; the results
  path is closed. `IRUSHY_LOG_MESSAGE_BODIES=false` by default, so message text
  is not logged either — the request log records `id`, `mode`, `lang`,
  character counts and history length only.
- The panel tells visitors: *"Nothing you type is stored."* and the FAQ entry on
  privacy tells them not to type exam numbers, phone numbers or passwords.
- Data files contain no personal data: the FAQ repeats only the contact details
  already published on the public home page.

## 5. Abuse and cost control

| Control | Default | Variable |
|---|---|---|
| Per-IP rate limit (chat) | 20 / 5 min | `IRUSHY_RATE_LIMIT_MAX`, `IRUSHY_RATE_LIMIT_WINDOW_MS` |
| Read-endpoint budget | 6× the chat limit, separate bucket | — |
| Provider-side requests per minute | 5 (matches the APInex free tier) | `IRUSHY_PROVIDER_RPM` |
| Output tokens | 700 | `IRUSHY_MAX_OUTPUT_TOKENS` |
| Input characters | 2000 | `IRUSHY_MAX_INPUT_CHARS` |
| History sent upstream | 8 messages / 6000 chars | `IRUSHY_MAX_HISTORY_MESSAGES`, `IRUSHY_MAX_HISTORY_CHARS` |
| Request timeout | 30 s | `IRUSHY_REQUEST_TIMEOUT_MS` |
| Retries | 1, for 429/502/503/504 only, jittered backoff | `IRUSHY_MAX_PROVIDER_RETRIES` |
| Concurrency | 2 in flight, 15 s queue, then a clear "busy" error | `IRUSHY_MAX_CONCURRENT` |
| Request body | 32 KB | `IRUSHY_BODY_LIMIT_KB` |
| Duplicate submissions | same `request_id` joins the in-flight call (provider hit once) | — |

An `AbortController` stops the provider call after the timeout, and the
assessment-refusal path answers **without** making a provider call at all.

### Capacity

The APInex free tier allows **5 requests/minute** (rolling 60 s, per account —
more keys do not help; see the provider's error documentation). One classroom
of students asking questions at once will hit that. Options before opening
IRUSHY to many students:
- move to a paid APInex tier and raise `IRUSHY_PROVIDER_RPM`,
- or keep IRUSHY in website-help mode for the homepage (most traffic is FAQ and
  static links, which cost nothing and are served even during an outage).

## 6. Reporting a problem

If a key is ever suspected of leaking: rotate it in the APInex dashboard, then
restart the server with the new value. Nothing in this repository needs to
change, and no secret is stored anywhere else.
