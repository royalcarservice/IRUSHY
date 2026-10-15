# IRUSHY's own engine

IRUSHY answers with its **own local engine** by default (`IRUSHY_ENGINE=local`).
It needs **no API key, no account, no quota and no network**. It is
**deterministic**: the same request against the same knowledge files always
returns the same answer, word for word.

It is a rule-based engine, not a language model. It does not write new facts.
It recognises what is being asked, then assembles the answer from:

- the verified website FAQ and page list,
- the published materials list,
- the concept notes in `data/knowledge/concepts.json`,
- the question banks,
- a phrasebook of fixed wording.

What it cannot answer from those, it says it does not know.

Two optional backends sit behind the same interface: APInex, a hosted gateway
(`IRUSHY_ENGINE=apinex`), and Ollama, a model on this machine
(`IRUSHY_ENGINE=ollama`). Neither is used unless you set it, and neither is ever
a fallback. See §10.

---

## 1. How a question becomes an answer

```
POST /api/chat
  │
  ├─ server/routes/chat.js
  │    language   Auto: Tamil script → Tamil; else Accept-Language; a
  │               language chosen in the panel always wins
  │    mode       resolveMode(): "teacher" needs a signed teacher session
  │    guard      a test-answer request, or a mistake explanation without a
  │               server-signed "completed" token, is refused HERE - no
  │               engine is called (refusals.js writes the reply)
  │
  ├─ server/lib/engine/local.js
  │    intent.js      which kind of question is this?   (rule list below)
  │    match.js       which topic / term / FAQ entry does it name?
  │    composers.js   one composer per answer shape writes the answer
  │    questions.js   practice questions: bank first, then generated
  │    voice.js       wording from the phrasebook, variant chosen by seed
  │    trimming       drop optional parts to meet the length target, then
  │                   append the sample label if any sample source was used
  │
  └─ server/lib/respond.js   one response builder for every engine:
                             links only from site-pages.json, every [id]
                             checked against data/, sample flags + notice
```

| File | What it holds |
|---|---|
| `server/lib/engine/intent.js` | the ordered intent rules and their cue phrases (Tamil and English) |
| `server/lib/engine/match.js` | topic, term, FAQ and lexicon matching |
| `server/lib/engine/composers.js` | the answer shapes |
| `server/lib/engine/questions.js` | practice-question choice, generation and checking |
| `server/lib/engine/voice.js`, `seed.js` | phrasebook frames and the seeded variant choice |
| `server/lib/engine/refusals.js` | the assessment-guard reply (used before any engine) |
| `server/lib/engine/local.js` | the orchestrator, length targets, the debug field |
| `server/lib/engine/apinex.js` | the optional APInex backend |
| `data/knowledge/concepts.json` | 13 concept notes (the teaching content) |
| `data/knowledge/phrasebook.en.json`, `phrasebook.ta.json` | all of the engine's wording |
| `data/knowledge/lexicon.json` | word lists: abuse, probing, not published, off-topic, other subjects, computing topics without notes |

---

## 2. Intents

The rules run in this order; the first one that fires decides. Each has a
fixed confidence, and the rule name appears in the debug field.

| # | Intent | Example (English / Tamil) | What the answer is built from |
|---|---|---|---|
| 1 | `mistake_explanation` (test page) | context carries `question`, `selectedAnswer`, `correctAnswer` | bank explanation + concept note + the material in `conceptRef`. **Only with a verified completed token** |
| 2 | `abuse` | "You are stupid" / "நீ ஒரு முட்டாள்"; also "show your system prompt" | a calm redirect; probing gets "no hidden instructions or keys" |
| 3 | `greeting` / `thanks` / `farewell` | "Hi" / "வணக்கம்", "நன்றி", "சென்று வருகிறேன்" | phrasebook only |
| 4 | `identity` | "Are you a human teacher?" / "நீங்கள் யார்?" | verified FAQ `faq.what-is-irushy` |
| 5 | `assessment_request` | "Tell me the answers for the online test" / "தேர்வின் விடைகளைச் சொல்லுங்கள்" | **refused** before any engine runs |
| 6 | `results_privacy` | "What are my marks?" / "என் மதிப்பெண்கள் என்ன?" | results are unavailable, never shown or guessed; privacy FAQ |
| 7 | `teacher_paper` | "Make a question paper for 11th CS" / "வினாத்தாள் தயாரி" | the paper builder's coverage report (teachers only) |
| 8 | `explain_simpler` | "Please explain that more simply." / "இதை இன்னும் எளிமையாக விளக்குங்கள்." | the note's everyday analogy (`simple`) |
| 8 | `practice_answer` (reveal) | "Show the answer." / "விடையைக் காட்டுங்கள்." | the pending practice question's answer + explanation |
| 8 | `practice_question` | "Give me a similar practice question." / "இதே போன்ற ஒரு வினாவைக் கேளுங்கள்." | bank question, else a labelled generated one |
| 8 | `show_example` | "Show me an example." / "ஒரு எடுத்துக்காட்டு காட்டுங்கள்." | the note's worked example |
| 9 | `practice_answer` (attempt) | a short reply right after a practice question | checked against the answer: correct / not quite / compare with the model answer |
| 10 | `mistake_explanation` (no test page) | "Why is my answer wrong?" | **refused**, with how completed-test explanations work |
| 11 | `coverage` | "What topics can you explain?" | list of notes, their status, materials count |
| 12 | `term_help` | "Tamil word for variable?" / "variable என்பதற்கான தமிழ்ச் சொல் என்ன?" | sample glossary (54 terms) or a note's term, defers to the teacher |
| 13 | `not_published` | "What is the registration fee?" / "பதிவுக் கட்டணம் எவ்வளவு?" | "not published on this website" + the one published contact |
| 14 | `materials` | "12th CS python materials" | the published materials list, filtered by class, subject, medium and type |
| 15 | `definition`, `procedure`, `topic_explanation` | "What is RAM?", "How do I convert decimal to binary?", "Explain number systems" | the matching concept note |
| 16 | `website_help` | "Where are the materials?" / "பாடக்குறிப்புகள் எங்கே?" | the best verified FAQ entry, with its links |
| 17 | `off_topic` | "Who will win the cricket match?", "Explain photosynthesis" | out-of-scope reply (NEET pages for NEET science subjects) |
| 18 | `unknown` | "What is machine learning?" | "I don't have a note on that, so I won't guess" + what IRUSHY can help with |

---

## 3. Topics, terms and follow-ups

**Topic recognition** (`match.js`). Each concept note lists `keywords` in English
and Tamil, and `terms` (named terms with aliases). A question selects the
note with the highest score:

- each matching keyword phrase scores 1, plus 0.5 per extra word;
- the best matching term scores 1.5, plus 0.5 per extra word.

`excludePhrases` remove a note entirely. For example, "binary search" is not
Number systems, and "periodic table" is not Database.

Tamil words take suffixes, so a Tamil keyword matches any word that starts
with its stem. For example, தேர்வு matches தேர்வை and தேர்வில், and
நினைவகம் matches நினைவகத்தை. Two markers adjust a keyword:

- A trailing `!` requires the whole word, so நன்றி! does not match நன்று.
- A trailing `*` makes an English word a prefix, so regist* matches
  register and registration.

**Follow-ups use the citations in the previous answer.** The widget sends the
last 4 turns. When a visitor taps *Explain more simply*, *Show an example* or
*Try a similar question*, the engine:

- reads the `[concept.…]` id cited in IRUSHY's last answer, or the
  `Practice ref:` line under a practice question;
- checks that id against the loaded data, because history comes from the
  browser and is untrusted, so forged ids are ignored;
- continues on that topic.

That is why every topic answer cites its note in the first lines.

**Practice questions** (`questions.js`) are chosen in this order:

1. approved bank questions a teacher marked `practice: true`;
2. labelled sample bank questions;
3. questions generated from the note:
   - the common mistake as a true/false item;
   - the worked example;
   - each named term.

Generated questions always carry the line *"Generated practice question: not
from the question bank and not an exam question."* Questions already shown in
the conversation are skipped. For Tamil visitors, questions that have Tamil
text come first.

Attempts are marked as follows:
- MCQ letters, true/false (in both languages) and one-word answers are marked
  correct or wrong.
- Longer answers are shown next to the model answer for self-checking.
- Approved questions not marked for practice are reserved for papers. Their
  answers are never shown in chat.

**Completed-test mistakes** need the test page to send a server-signed token
(see `docs/STATUS.md`). The answer names the visitor's choice and the correct
one, explains why, and points to the lesson. The lesson comes from
`conceptRef`, but only if that id is a real published material. Otherwise
IRUSHY says no lesson is mapped yet.

---

## 4. Determinism

The engine uses no randomness and no clock. Each phrase variant is chosen by a
hash of the following, so the same request gives the same answer and different
questions still read naturally:

```
seed = sha256(engine version | knowledge version | language | mode | intent |
              normalised message | topic | ids cited in the previous answer)
variant(frame) = seed-derived index into that frame's 2-4 variants
```

The knowledge version is a hash of every loaded data file. Editing a note or
the phrasebook may change the wording of later answers, and that is expected.
`npm test` checks determinism on every answer (same request twice), and across
two separately started servers.

This guarantee is the local engine's. The optional Ollama backend sends a
byte-identical request for the same question, but its wording also depends on
the model, the Ollama version and the hardware (§10).

---

## 5. Length targets

An answer drops optional parts until it fits, lowest priority first: the
closing follow-up question, then the common mistake and the source line, then
the fourth key point. The sample label is never dropped.

| Intent | Target (English characters; Tamil allows 1.6×) |
|---|---|
| greeting / thanks / farewell | 340 / 220 / 200 |
| definition, explain more simply | 750 |
| website help | 800 |
| practice question / answer | 900 / 950 |
| materials, worked example, coverage | 1050 / 1150 / 1150 |
| mistake explanation, teacher paper | 1250 |
| topic explanation, procedure | 1350 |
| refusals, off-topic, unknown, not published, abuse | 500 to 750 |

Hard cap: `IRUSHY_MAX_ANSWER_CHARS` (2400).

---

## 6. For teachers: correcting, adding and approving notes

All teaching content lives in **`data/knowledge/concepts.json`**. Every note
starts as `"provenance": "sample-unapproved"`. While a note is unapproved,
every answer that uses it shows:
- the *Sample - not approved* chip;
- a notice in Tamil and English;
- the line *"Sample content: not yet approved by a teacher."*

### Correct a note

1. Open `data/knowledge/concepts.json` and find the note by its `topic`
   (for example `"topic": "Computer memory"`).
2. Edit the English and the Tamil text side by side. Each field is
   `{ "en": "...", "ta": "..." }`:
   - `definition`: one or two sentences;
   - `keyPoints`: 2 to 4 items;
   - `example`: `prompt`, optional `code` lines, `steps` (the same number in
     English and Tamil) and `answer`;
   - `mistake`: `claim`, the wrong idea written as a sentence, and
     `correction`;
   - `simple`: the everyday analogy used for *Explain more simply*;
   - `terms`: named terms that can be defined on their own.
3. Run `npm test`. It checks:
   - the note's shape;
   - that every keyword and term still selects this note;
   - that Tamil and English stay paired.
4. Restart the server (`npm start`).

### Approve a note

After a subject teacher has read both languages, set on that note:

```json
"provenance": "approved",
"approvedBy": "R. Kumar, PG Asst (Computer Science)",
"approvedOn": "2026-11-02"
```

Approved notes lose the sample label. They are also used in production, where
unapproved notes are switched off by default
(`IRUSHY_ALLOW_SAMPLE_CONTENT=false`).

### Point a note at the right lesson

`conceptRef` must be the `id` of a published material in `data/resources.json`,
for example `"mat.CS-2-EM-13"`. Today only Python and Computer networks have
one, because only their material titles name the topic. Lesson numbers were
never guessed. Add the right material once you know it, and use
`relatedMaterials` for the other medium.

### Add a new topic

Copy an existing note and give it a new `"id": "concept.<slug>"`. Set `topic`
to exactly the topic string used in the question bank. Then fill every field
in both languages and add keywords and terms. Questions are not matched by
title. If the topic has bank questions, practice questions follow
automatically.

### Fix the engine's wording

The wording outside notes comes from the phrasebooks:
- `data/knowledge/phrasebook.en.json`;
- `data/knowledge/phrasebook.ta.json`.

Each frame has 2 to 4 variants with `{slots}`. Keep the slots identical across
variants and across languages; `npm test` checks this. The Tamil rules:
- end sentences with the verb;
- use respect forms (நீங்கள், -ங்கள்);
- keep English technical terms;
- place `{topic}` only before case-free words such as பற்றி, தொடர்பான,
  என்ற or என்பது.

### Make IRUSHY recognise a new phrase

- **Topic words:** add them to the note's `keywords`.
- **Abuse, off-topic, not-published or other-subject words:** add them to
  `data/knowledge/lexicon.json`.
- **New ways of asking**, such as another way to say "explain more simply":
  edit the cue lists at the top of `server/lib/engine/intent.js`.

Then run `npm test`.

---

## 7. Seeing why IRUSHY gave an answer

Send `"debug": true` with a chat request (on by default; switch it off with
`IRUSHY_ENGINE_DEBUG=false`):

```bash
curl -s -X POST localhost:8787/api/chat -H 'content-type: application/json' \
     -d '{"message":"What is RAM?","lang":"en","debug":true}'
```

`meta.debug` then shows, without any message text or secrets:

```json
{
  "intent": "definition", "confidence": 0.85, "rule": "definition",
  "topic": { "id": "concept.computer-memory", "score": 2.5, "term": "RAM", "matched": ["ram", "RAM"] },
  "faq": null,
  "history": { "turns": 0, "cited_ids": [], "practice_ref": null, "concept": null, "concept_via": null },
  "retrieved": [{ "id": "concept.computer-memory", "kind": "concept", "score": 5.067 }],
  "composer": "definition",
  "frames": [{ "frame": "definition.lead", "variant": 3, "of": 3 },
             { "frame": "definition.context", "variant": 1, "of": 3 }],
  "seed": "812c2931de8448dc",
  "length": { "target": 750, "chars": 377, "dropped_blocks": [] },
  "used_ids": ["concept.computer-memory"]
}
```

Read it top to bottom:
- **`rule`:** which intent rule fired.
- **`topic`:** which note was chosen, and the words that matched.
- **`history`:** where a follow-up found its topic.
- **`frames`:** which wording variants were used.
- **`used_ids`:** which data entries the answer relied on. Every one is a real
  id in `data/`.

The assessment guard reports `decided_by: "assessment-guard"` with its reason.

---

## 8. What the engine will not do

It will not:
- invent links, services, fees, policies, contacts, exam rules, marks or
  videos;
- show student results (it says they are unavailable);
- discuss answers to a test without a server-signed completed token;
- present a generated or sample question as an approved exam question;
- claim to be human or to have created media.

## 9. Known limits

- Recognition is rule-based. Unusual phrasings fall back to `unknown`, which
  answers honestly. Add the phrasing to a note's keywords, or to the cue lists
  in `intent.js`, and run `npm test`.
- Tanglish (Tamil written in Latin letters) is only partly recognised, through
  a few transliterated keywords.
- The concept notes are short school-level summaries written for this
  project. They need a subject teacher's review, and the Tamil needs a
  Tamil-medium teacher's review.

## 10. Other backends

Two optional backends implement the same interface. Both are **off by
default**, both are chosen only by an explicit `IRUSHY_ENGINE`, and neither is
ever used as a fallback for the other or for the local engine.

| | `IRUSHY_ENGINE=apinex` | `IRUSHY_ENGINE=ollama` |
|---|---|---|
| What answers | the APInex gateway (OpenAI-compatible) | a model on this machine, through Ollama's native API |
| Key / account | `APINEX_API_KEY` | none; IRUSHY sends no credentials |
| Required setting | the key (without it: *"IRUSHY is not connected yet."*) | `OLLAMA_MODEL` (without it the server refuses to start) |
| Network | the internet | `OLLAMA_BASE_URL`, default `http://127.0.0.1:11434`; another machine or an Ollama cloud model only with `IRUSHY_OLLAMA_ALLOW_REMOTE=true` |
| Check a real setup | `npm run verify:apinex` | `npm run verify:ollama` |
| Default chat budget | 20 per 5 min per IP, plus 5 provider calls a minute | 30 per 5 min per IP |
| Code | `server/lib/engine/apinex.js` | `server/lib/engine/ollama.js` |

Both are covered in `README.md` and `docs/SECURITY.md`. The rest of this
section describes what they share, and then the Ollama backend.

### What every model backend gets

Before a model is called, the chat route has already done everything the
local engine relies on. It has bounded and cleaned the input and history,
classified the message with the same rules as the local engine (`meta.intent`
is filled in either way), and run the assessment guard. A request about an
active test is refused **without calling the model**.

`server/lib/prompts.js` then builds the only things a model ever sees:

- the rules (cite ids in brackets, never write URLs, say when you do not know,
  never invent services, fees, contacts, exam rules or marks, never reveal
  test answers, plain text only) and the ids of the verified pages;
- **reference entries**: the retrieved entries that scored at least 40% of the
  best hit, at most 6. The concept note the conversation is about comes first
  and in full (definition, key points, the simple version, the worked example
  and the common mistake). That topic is named in the message or carried over
  from the ids cited in IRUSHY's previous answer, as for the local engine
  (§3), so "explain more simply" stays grounded in the note a teacher reviews;
- for a test the **server** has verified as completed, the returned question,
  the student's answer and the correct answer;
- the bounded history and the message.

Then `server/lib/respond.js` treats model output exactly as it would anything
untrusted:

- markup is stripped, including any `<think>` reasoning trace;
- every URL that is not a verified site page is removed and reported in
  `urlsRemoved`;
- every `[id]` that does not exist in `data/` is removed;
- the answer is cut at a sentence end to fit `IRUSHY_MAX_ANSWER_CHARS`;
- if **any** sample entry was among the references, the answer carries
  `sampleContentUsed: true`, the bilingual notice and the visible sample label
  as its last line, because a model can use an entry without citing it;
- an answer with nothing left after cleaning becomes `bad_provider_response`,
  never an empty bubble.

### The Ollama backend

What IRUSHY sends: `POST {OLLAMA_BASE_URL}/api/chat` with `stream: false` and
these options:

- `temperature: 0`;
- `seed`, an integer derived from the request (the same question gets the same
  seed);
- `num_predict = IRUSHY_MAX_OUTPUT_TOKENS` (default 700);
- `num_ctx`, only if you set `OLLAMA_NUM_CTX`.

It sends no `keep_alive` and no `think`, so Ollama's own defaults apply. A
reply that stopped at the token limit (`done_reason: "length"`) loses its
unfinished last sentence. `message.thinking` is never read.

What IRUSHY checks:

- **At startup** (`GET /api/tags`) it logs `engine_probe`: Ollama reachable,
  the model installed, and whether that name actually points at a cloud model
  (`remote_host` in Ollama's list). `/api/health?deep=1` runs the same check.
- **At configuration**, before anything is sent, it refuses to start when:
  - `OLLAMA_MODEL` is missing;
  - the address is not http(s), or holds a user name or password;
  - the host is not a loopback address, or the model's tag is `cloud` or ends
    in `-cloud` (Ollama runs those on ollama.com, possibly on a paid plan),
    unless `IRUSHY_OLLAMA_ALLOW_REMOTE=true`.

  For a strictly local Ollama you can also turn Ollama's cloud features off on
  the Ollama side (`OLLAMA_NO_CLOUD=1`, see Ollama's FAQ). Note that IRUSHY
  reads `OLLAMA_BASE_URL`; `OLLAMA_HOST` is Ollama's own server setting.

How failures look to the visitor: a bilingual error, the verified links, and
Retry. For the admin, `error.adminHint` and the log line `chat_failed` say what
to do:

| Ollama | IRUSHY `error.code` | `adminHint` points to |
|---|---|---|
| not running / refused | `network_error` (503) | `OLLAMA_BASE_URL`, `ollama serve`, `npm run verify:ollama` |
| no answer within `IRUSHY_REQUEST_TIMEOUT_MS` | `timeout` (504) | a smaller model, fewer output tokens, or a longer timeout (the widget waits 60 s) |
| HTTP 404, model not found | `model_unavailable` (502) | `ollama pull <model>`, `ollama list` |
| HTTP 400 / 401 / 403 / 422 | `invalid_request` (502) | the HTTP status in the log; a proxy if 401/403 |
| HTTP 429 | `rate_limited` (429) | (from a proxy or a cloud model) |
| HTTP 5xx | `provider_unavailable` (503) | the log; memory for the model |
| invalid JSON, empty, or nothing left after cleaning | `bad_provider_response` (502) | thinking models using up the token budget |

Retries: at most `IRUSHY_MAX_PROVIDER_RETRIES` (default 1), and only for 429,
502, 503 and 504. IRUSHY never retries with another model.

What it does **not** promise:

- **Word-for-word determinism.** IRUSHY's side is deterministic: the same
  question sends a byte-identical request, and the suite checks this. The
  reply also depends on the model, the Ollama version and the hardware.
  `npm run verify:ollama` shows whether your setup repeats itself.
- **Tamil quality.** That depends on the model. `npm run verify:ollama` reports
  whether the model replied to a Tamil message in Tamil. Only a teacher can
  judge whether the Tamil is right.
- **Answer quality.** The guard rails above stop invented links, ids and test
  answers. They cannot make a model's explanation correct, so ask a teacher to
  try the acceptance questions in `docs/VERIFICATION.md` with your model before
  students use it.

Seeing why an answer was given works as in §7. With `"debug": true`,
`meta.debug` shows `engine: "ollama"`, the model, the retrieved and the sent
reference ids, `test_context`, the seed and options, `done_reason`, the token
counts and the time Ollama reported. It never contains message text.

What was verified, and what was not: every behaviour above is checked by
`npm test` against a mock Ollama (`tools/mock-provider.mjs`). Those test
servers run with the network blocked except for the mock's one port, and the
suite checks they contacted nothing else. It has **not** been run against a
real Ollama install: the build sandbox could not download Ollama or a model.
