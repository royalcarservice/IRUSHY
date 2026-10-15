# Integrating IRUSHY with the TNHHSSCTA website

The live site is classic ASP on IIS (Plesk, `x-powered-by: ASP.NET`) and its
home page is a **frameset**. That single fact drives the whole integration
story, so it is worth stating plainly:

> **A frameset document cannot render an HTML overlay of its own.**
> In a frameset page, `document.body` *is* the `<frameset>` element. Anything
> appended to it gets a 0×0 box and is never painted. Measured in Chromium
> against the real frameset: the launcher existed in the DOM with
> `position: fixed; z-index: 2147483000; display: flex` and still measured
> `0 × 0`.

The deliverable therefore ships three supported integration routes. Pick one;
none of them redesigns the site.

---

## Route A — shell page around the frameset (used by the local preview)

`public/index.html` is a normal page that shows the untouched frameset in an
iframe and hosts the widget in the real top-level document.

```html
<iframe id="site-frame" src="site-home.html" title="TNHHSSCTA website"></iframe>
<link rel="stylesheet" href="/irushy/irushy.css">
<script defer src="/irushy/irushy.js" data-irushy-mode="home" data-irushy-host="top"></script>
```

On IIS this is a change of the *default document only*:

1. upload `index.html` (from `public/`) as the site's default document,
2. rename the existing frameset file so it keeps working —
   `index` (no extension) stays, but the shell needs a name.
   The cleanest arrangement is:
   - `/irushy-shell.html` → the shell page (set as a default document above `index`),
   - leave `index`, `ToppageHome.asp`, `IrushyFrameHome.asp` untouched.
3. upload `/irushy/irushy.css` and `/irushy/irushy.js`.

Pros: the frameset keeps working for anything that links to it; the widget is a
true overlay; deep links to the frameset still work.
Cons: one extra document in the chain; the address bar shows the shell URL.

---

## Route B — add the widget to an existing frame (smallest possible change)

Because the frameset has a **left navigation frame** that is already scrollable,
the widget can live there with **zero layout change**. Add exactly two lines to
`AdminPageHome.asp`, just before `</head>`:

```html
<link rel="stylesheet" href="/irushy/irushy.css">
<script defer src="/irushy/irushy.js" data-irushy-mode="home"></script>
```

What the widget does with that:

- it is not the top window and has no `data-irushy-injected` attribute, so it
  asks the top window to open the panel (postMessage) and otherwise mounts a
  normal widget in the frame it was loaded in,
- if the frame is narrower than 360 px it adds a short note offering the
  full-screen assistant (`/irushy/assistant.html`).

Pros: two lines, no markup change, the launcher sits in the left column next to
the existing buttons.
Cons: the panel is clipped to that frame (about 20% of the width on desktop,
so it is only really useful on wide screens; phones get the full-screen link).

---

## Route C — put the script on the frameset itself

If you add the two lines to the frameset document (`index` / `site-home.html`),
the widget cannot paint there. It notices, picks the **largest** child frame,
injects its own `<link>` and `<script>` into that frame's document (same
origin, so this is allowed) and mounts itself there.

```
frameset detected
   → choose largest <frame> by area
   → inject /irushy/irushy.css + /irushy/irushy.js into that frame
   → widget mounts in the frame; cramped frames offer the full-screen page
   → if nothing can be reached (cross-origin frame), it fails silently
```

Pros: one place to add two lines, covers every page that uses that frameset.
Cons: the widget lives inside a frame, so the panel is bounded by the frame.

**Recommendation: Route A for the public home page** (best experience on
desktop and phone), and Route B for section pages that use the frameset but
want the smallest possible change.

---

## Reusing the widget for the Student and Teacher sections

One attribute changes the mode. The mode only affects prompting, retrieval and
which server-side permissions are required — the component is the same file.

```html
<!-- student page -->
<script defer src="/irushy/irushy.js" data-irushy-mode="student"></script>

<!-- teacher page -->
<script defer src="/irushy/irushy.js" data-irushy-mode="teacher"></script>
```

`data-irushy-mode="teacher"` is a **request**, never a permission. The server's
`resolveMode()` downgrades it to `home` unless the session cookie (HMAC-signed,
HttpOnly, set by the server) says `role=teacher`, and the panel tells the user:

> "Teacher tools need a signed-in teacher account, so I answered as website
> help. Selecting Teacher here does not grant access."

For the full-screen page, use the query string the widget already supports:

```
/irushy/assistant.html?mode=student&lang=ta
```

---

## Where the widget is mounted in the local preview

| URL | What it is |
|---|---|
| `/` | shell + the untouched frameset + the widget (Route A) |
| `/site-home.html` | the frameset copy on its own (opening it directly triggers Route C) |
| `/AdminPageHome.html` | the left navigation frame — add the widget lines here for Route B |
| `/irushy/assistant.html` | standalone full-screen assistant |
| `/#` frames | `ToppageHome.html`, `IrushyFrameHome.html`, `SlideShowNaga.html`, `NagaPage.html` |

The frameset copies keep the live geometry exactly: `ROWS="23%,77%"` in
`site-home.html` and `COLS="20%,65%,20%"` in `IrushyFrameHome.html`.

---

## Not changing the live site

Everything here is a **local development copy**. The build only ever performed
read-only `GET` requests against `https://tnhhsscta.com` (to import the
materials catalogue and verify the nine destinations). No file was uploaded,
no login was attempted, and there is no deployment step in this repository.
When you are ready to deploy, the files to copy are the three in
`public/irushy/` plus whichever shell file you chose in Route A/B/C.
