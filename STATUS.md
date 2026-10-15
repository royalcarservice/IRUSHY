# What is finished, what is waiting, and why

An honest inventory. "Awaiting" never means "silently faked": in every case
below IRUSHY says so in the panel, and the API returns an explicit code.

---

## Finished and verified

### 1. Homepage assistant, end to end
- `Ask IRUSHY` launcher (48 px touch target), compact 384 px desktop panel,
  full-screen mobile panel.
- Explained, from **verified** data only: what the site is, the left menu
  (Admin Login, School Login, Online One Word Test, Materials, Teacher
  Registration, Student Registration), the NEET logins, the one published
  contact, how to take the test, what IRUSHY can and cannot see.
- 12 FAQ entries, every one with a source link into `data/site-pages.json`, so
  a wrong or invented destination cannot be shown: the loader drops any URL
  that is not on `tnhhsscta.com`, and the responder removes any URL the model
  typed that is not in the verified list (`urlsRemoved` in the response).
- All nine destinations were checked with a real HTTP request on 2026-10-15.

### 2. Bilingual behaviour
- `Auto` matches the visitor (Tamil script in the message, else
  `Accept-Language`), with a labelled manual selector.
- Verified by test: a Tamil question produces a Tamil answer; the Tamil prompt
  is a first-class copy of the rules, not a translation afterthought.
- Sample glossary supplies Tamil technical vocabulary while keeping the English
  term, which is how Tamil-medium computer science is actually taught.

### 3. Student mode
- Concept explanations grounded in the approved materials, with the material
  entry (file name + URL) attached as the source.
- Four optional follow-ups: *Explain more simply*, *Show an example*,
  *Try a similar question*, plus *Copy last answer*.
- Diagrams render as inline SVG; videos are attached but a player is created
  **only after** the visitor clicks *Load video* (verified: zero iframes before
  the click).
- When no approved visual exists, IRUSHY is instructed to say so and explain in
  words; the approved video/diagram files are empty, so this is the normal case
  today and the sample files show exactly how to fill them.

### 4. Assessment guard (both directions verified)
- The client **cannot** assert that a test is finished. A client-supplied
  `assessmentStatus` / `completedTest` is ignored and the request still refuses
  to discuss answers.
- The server only accepts an **HMAC-signed token** from the test backend
  (`IRUSHY_ASSESSMENT_SECRET`). The smoke test mints a valid token and proves
  the mistake-explanation path opens; it also proves that a tampered token and a
  token signed with the wrong secret are both rejected, and that a verified
  **active** test is refused **without spending a provider call**.
- With no secret configured (the current default) every assessment is treated
  as active, so IRUSHY declines and explains. That is the safe default.
- What is *not* built: the ASP/DB side that issues those tokens, and the
  per-question record store. Until then, mistake-by-mistake feedback needs the
  question, selected answer, correct answer and concept reference to be sent in
  by a caller that already has the signed token.

### 5. Teacher mode
- Every teacher route requires a server-signed teacher session; a non-teacher
  gets `403` with an explanation of how access is actually granted.
- Paper builder: class, subject, medium, topics, duration, question types and
  counts; **assembled from the approved bank only**, deterministic, with a
  **separate answer key** object and a plain-text export.
- Coverage is reported honestly. Because the approved bank is empty, the
  builder reports the shortfall per section (`coverage.gaps`), never fills it,
  and offers the labelled-sample route as an explicit choice
  (`coverage.canFillWithLabelledSample`).
- Every paper is a **draft** that requires teacher review
  (`requiresTeacherReview`), and is watermarked when it contains sample
  questions. There is no publish step; `/teacher/paper/:id/review` only records
  that a named teacher read it.

### 6. Failure behaviour
- Explicit codes and bilingual messages for missing credentials, rejected
  credentials, exhausted quota, an unavailable model, rate limiting, an upstream
  outage, timeouts, network errors and unreadable responses.
- Missing credentials produce **"IRUSHY is not connected yet."** and
  `answer: null` — never a canned reply pretending to be AI.
- Every failure response still carries the verified website links, and
  `/api/site/links` works with no provider at all, so the widget stays useful
  during an outage.
- IRUSHY never switches models on its own (`IRUSHY_ALLOW_MODEL_FALLBACK=false`
  by default) — if `free/gemini-3.8-flash` is unavailable it says so.

### 7. Security and privacy
See [`SECURITY.md`](SECURITY.md). All of the following were verified by test,
not just implemented: no key in the widget, no key in `/api/config`, no key in
any response, no key in logs, `HttpOnly` + `SameSite` session cookie, `DENY`
framing and `default-src 'none'` on API responses, CORS allow-list only,
`413` on oversized bodies, `429` with `Retry-After` on bursts, duplicate
submissions reaching the provider once, history trimmed rather than forwarded
whole, and hostile model output (script tag, markup, invented URL) neutralised.

---

## Awaiting content (the assistant is truthful in the meantime)

| Waiting on | Effect today | How to fill it |
|---|---|---|
| Approved **video** links | IRUSHY says no approved video exists for the topic. Three sample links are labelled *"Sample link - not reviewed by the school"* | watch and approve a link, then move the entry into `data/videos.json` with `status: "approved"`, `approvedBy`, `approvedOn` |
| Approved **diagrams** | same as above; three sample SVGs are labelled *"Sample diagram - not approved"* | add validated inline SVG to `data/diagrams.json` |
| Approved **question bank** | the paper builder reports empty coverage and generates nothing | import approved questions into `data/question-bank.json`; `GET /api/teacher/coverage` shows what the bank can build |
| **Tamil term review** | glossary terms are marked sample and defer to the teacher's wording | review `data/sample/glossary.sample.json` with a Tamil-medium teacher |

Sample content is deliberately a *separate* file set. It never enters the
approved bank, it is off in production unless switched on, and every answer
that uses it carries `sampleContentUsed: true`, a visible label and a
`sampleNotice` in both languages.

---

## Awaiting integration

### 1. Real teacher sign-in
Today: `IRUSHY_ENABLE_DEMO_LOGIN=false` → `POST /api/session/login` answers
`501` and tells the visitor not to type a password into the chat. For local
permission testing you can enable a throw-away demo account; the sign-in exists
only to prove that server-side enforcement works, and it stores nothing.

To make it real, one of:
- point `/api/session/login` at the existing school account system
  (`SreeIrushySchool.asp` / the ASP auth), or
- add a small teacher registry the IRUSHY server can read,
and issue the session with `loginTeacher()` once the credentials check out.

### 2. Completed-test permission (the exact interface)
The test backend signs:

```
token = base64url(JSON({ studentRef, testId, status, completedAt, anonymousPermitted }))
        + "." + base64url(HMAC-SHA256(body, IRUSHY_ASSESSMENT_SECRET))
```

`status` is `completed` | `active`. Share `IRUSHY_ASSESSMENT_SECRET` between
the two services only. A completed token is only honoured for a signed-in
student unless `anonymousPermitted` is explicitly set.

### 3. Student results (server-enforced teacher → student permissions)
`GET /api/teacher/results/:studentRef` returns `503` with
`neverSimulated: true` and `records: null`, **even for a signed-in teacher**,
until a real permission source exists. That requires three things that are not
in place yet:
1. a teacher identity that maps to specific students/classes,
2. a per-student permission check on the server for every request,
3. an audit record of who looked at whose marks.

Nothing about marks or records is simulated anywhere in this codebase.

### 4. Deployment to the live site
Not done, and deliberately not part of this work. The live site was not
modified. Deployment steps are in [`INTEGRATION.md`](INTEGRATION.md).
A production deployment still needs: `NODE_ENV=production`,
`IRUSHY_SESSION_SECRET` set, HTTPS, `IRUSHY_ALLOW_SAMPLE_CONTENT=false` until
content is approved, and the APInex plan sized to the traffic (the free tier is
**5 requests/minute** — see [SECURITY.md](SECURITY.md#capacity)).
