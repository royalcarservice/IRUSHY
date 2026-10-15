/* ==========================================================================
   IRUSHY - bilingual (Tamil / English) assistant widget for TNHHSSCTA
   ---------------------------------------------------------------------------
   Design constraints honoured here:
   - No dependencies, no build step, one small file.
   - The API key never exists in this file: all provider traffic goes through
     the IRUSHY server (/api/chat).
   - Model output is rendered with textContent only. No HTML from the model is
     ever executed. Diagrams are re-built from an SVG allow-list. A video
     player is created only after the visitor clicks "Load video".
   - Frameset aware. A frameset document cannot render HTML of its own
     (its <body> IS the <frameset>), so a floating widget is impossible there.
     When the loader finds itself in a frameset it picks the largest child
     frame, injects itself into that frame and mounts there. For narrow frames
     (phones) it offers the full-screen assistant page instead of a cramped
     panel.
   - Full keyboard support: Escape closes, Tab is trapped while open, focus
     returns to the launcher on close.

   Include with:
     <link rel="stylesheet" href="/irushy/irushy.css">
     <script defer src="/irushy/irushy.js"
             data-irushy-mode="home"        // home | student | teacher
             data-irushy-api="/api"         // optional API base
             data-irushy-dock="float"       // float (default) | inline
             data-irushy-host="top"></script>

   Recommended: put those two lines on a normal page that shows the frameset in
   an iframe (see public/index.html). If they are placed on the frameset
   document itself, the widget still works - see the frameset branch below.
   ========================================================================== */
(function () {
  'use strict';

  var script = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    return all[all.length - 1];
  })();

  var API = (script && script.getAttribute('data-irushy-api')) || '/api';
  var DEFAULT_MODE = (script && script.getAttribute('data-irushy-mode')) || 'home';
  var DOCK = (script && script.getAttribute('data-irushy-dock')) || 'float';
  var MIN_PANEL_WIDTH = 360;   // below this a frame is too narrow for a panel

  /* is this document a frameset? then no HTML of ours can be painted here */
  function isFramesetDocument(doc) {
    try {
      var b = doc.body;
      if (!b) return true;                       // frameset documents have no body
      return b.nodeName === 'FRAMESET' || !!doc.querySelector('frameset');
    } catch (e) { return false; }
  }
  function frameArea(f) {
    try {
      var w = f.clientWidth || f.offsetWidth || 0;
      var h = f.clientHeight || f.offsetHeight || 0;
      return w * h;
    } catch (e) { return 0; }
  }

  /* ------------------------------------------------------------ verified fallback
     These nine destinations were checked against the live site on 2026-10-15
     (HTTP 200 each). They are embedded so website help keeps working even when
     the IRUSHY API cannot be reached at all. Nothing here is invented. */
  var FALLBACK_LINKS = [
    { id: 'site.home', title: { en: 'Home page', ta: 'முகப்புப் பக்கம்' }, url: 'https://tnhhsscta.com/' },
    { id: 'nav.materials', title: { en: 'Materials', ta: 'பாடக்குறிப்புகள்' }, url: 'https://tnhhsscta.com/AmmaURL.asp' },
    { id: 'nav.one-word-test', title: { en: 'Online One Word Test', ta: 'ஆன்லைன் ஒரு வார்த்தைத் தேர்வு' }, url: 'https://tnhhsscta.com/QuestionChangeIrushy.asp' },
    { id: 'nav.teacher-registration', title: { en: 'Teacher Registration', ta: 'ஆசிரியர் பதிவு' }, url: 'https://tnhhsscta.com/TeacherRegFormIrushy.asp' },
    { id: 'nav.student-registration', title: { en: 'Student Registration', ta: 'மாணவர் பதிவு' }, url: 'https://tnhhsscta.com/LYMCPGOLD600523KB.asp' },
    { id: 'nav.school-login', title: { en: 'School Login', ta: 'பள்ளி உள்நுழைவு' }, url: 'https://tnhhsscta.com/IrushySchool2020/loginhomeschool.html' },
    { id: 'nav.admin-login', title: { en: 'Admin Login', ta: 'நிர்வாக உள்நுழைவு' }, url: 'https://tnhhsscta.com/LoginHome.html' },
    { id: 'nav.neet-student-login', title: { en: 'NEET Student Login', ta: 'நீட் மாணவர் உள்நுழைவு' }, url: 'https://tnhhsscta.com/IrushyNeet2020/IrushyRFD2021.asp' },
    { id: 'nav.neet-coordinator-login', title: { en: 'NEET Co-Ordinator Login', ta: 'நீட் ஒருங்கிணைப்பாளர் உள்நுழைவு' }, url: 'https://tnhhsscta.com/IrushyNeet2020/ULIS10090KB.asp' }
  ];

  /* ------------------------------------------------------------------- i18n */
  var T = {
    en: {
      launcher: 'Ask IRUSHY', open: 'Open the IRUSHY assistant', close: 'Close the assistant',
      title: 'IRUSHY', subtitle: 'AI assistant - not a human teacher',
      language: 'Language', mode: 'Mode', auto: 'Auto (match my language)',
      mHome: 'Website help', mStudent: 'Student', mTeacher: 'Teacher',
      clear: 'Clear chat', send: 'Send', placeholder: 'Ask about the website or a topic...',
      thinking: 'IRUSHY is thinking', retry: 'Retry', you: 'You', irushy: 'IRUSHY',
      greeting: 'Hello. I am IRUSHY, an AI assistant for this website.',
      intro: 'I can help you find pages and services here, and explain topics from the materials published on the site. I am not a human teacher.',
      starters: 'You can try:',
      more: 'More:', sources: 'Sources', links: 'Website links',
      loadVideo: 'Load video', videoLoaded: 'Video player', openVideo: 'Open on YouTube',
      sample: 'Sample - not approved', approved: 'Approved', general: 'General guidance',
      generalNote: 'Parts of this answer are general guidance, not approved syllabus text. Please check anything important with your teacher.',
      downgraded: 'Teacher tools need a signed-in teacher account, so I answered as website help. Selecting Teacher here does not grant access.',
      notConnected: 'IRUSHY is not connected yet.',
      notConnectedBody: 'No AI key is configured on the server, so I cannot answer live questions. These verified website links still work.',
      teacherHint: 'Teacher mode needs a server-signed sign-in.',
      resultUnavailable: 'Student results are not available to IRUSHY.',
      chars: 'characters', countWarn: 'close to the limit', transcript: 'Nothing you type is stored.',
      langChanged: 'Language changed. New answers will be in',
      copy: 'Copy last answer', copied: 'Copied'
    },
    ta: {
      launcher: 'IRUSHYயிடம் கேள்', open: 'IRUSHY உதவியாளரைத் திற', close: 'உதவியாளரை மூடு',
      title: 'IRUSHY', subtitle: 'AI உதவியாளர் - மனித ஆசிரியர் அல்ல',
      language: 'மொழி', mode: 'பயன்முறை', auto: 'தானாக (என் மொழியைப் பொருத்து)',
      mHome: 'இணையதள உதவி', mStudent: 'மாணவர்', mTeacher: 'ஆசிரியர்',
      clear: 'உரையாடலை அழி', send: 'அனுப்பு', placeholder: 'இணையதளம் அல்லது ஒரு பாடம் பற்றிக் கேளுங்கள்...',
      thinking: 'IRUSHY யோசிக்கிறது', retry: 'மீண்டும் முயற்சி', you: 'நீங்கள்', irushy: 'IRUSHY',
      greeting: 'வணக்கம். நான் IRUSHY, இந்த இணையதளத்திற்கான AI உதவியாளர்.',
      intro: 'இங்குள்ள பக்கங்களையும் சேவைகளையும் கண்டுபிடிக்க உதவுவேன்; இணையதளத்தில் வெளியிடப்பட்ட பாடக்குறிப்புகளிலிருந்து விளக்கமும் தருவேன். நான் மனித ஆசிரியர் அல்ல.',
      starters: 'இவற்றை முயற்சிக்கலாம்:',
      more: 'மேலும்:', sources: 'மூலங்கள்', links: 'இணையதள இணைப்புகள்',
      loadVideo: 'வீடியோவை ஏற்று', videoLoaded: 'வீடியோ', openVideo: 'YouTube இல் திற',
      sample: 'மாதிரி - அங்கீகரிக்கப்படவில்லை', approved: 'அங்கீகரிக்கப்பட்டது', general: 'பொது வழிகாட்டுதல்',
      generalNote: 'இந்தப் பதிலின் சில பகுதிகள் பொது வழிகாட்டுதல்; அங்கீகரிக்கப்பட்ட பாடநூல் உரை அல்ல. முக்கியமானவற்றை ஆசிரியரிடம் உறுதிப்படுத்துங்கள்.',
      downgraded: 'ஆசிரியர் கருவிகளுக்கு உள்நுழைந்த ஆசிரியர் கணக்கு தேவை. எனவே இணையதள உதவியாகப் பதிலளித்தேன்.',
      notConnected: 'IRUSHY இன்னும் இணைக்கப்படவில்லை.',
      notConnectedBody: 'சேவையகத்தில் AI சாவி அமைக்கப்படவில்லை. எனவே நேரடிக் கேள்விகளுக்குப் பதில் சொல்ல முடியாது. கீழே உள்ள இணையதள இணைப்புகள் வேலை செய்யும்.',
      teacherHint: 'ஆசிரியர் பயன்முறைக்கு சேவையக உள்நுழைவு தேவை.',
      resultUnavailable: 'மாணவர் முடிவுகள் IRUSHY க்கு கிடைக்காது.',
      chars: 'எழுத்துகள்', countWarn: 'வரம்பை நெருங்குகிறது', transcript: 'நீங்கள் டைப் செய்வது எதுவும் சேமிக்கப்படவில்லை.',
      langChanged: 'மொழி மாற்றப்பட்டது. அடுத்த பதில்கள்:',
      copy: 'கடைசி பதிலை நகலெடு', copied: 'நகலெடுக்கப்பட்டது'
    }
  };

  var state = {
    open: false, lang: 'auto', mode: DEFAULT_MODE, inFlight: false, lastMessage: null,
    config: null, teacherHinted: false, abort: null, counters: { chars: 0, limit: 2000 }
  };

  var ATTR_LANG = script && (script.getAttribute('data-irushy-lang') || script.getAttribute('data-lang'));
  if (ATTR_LANG === 'ta' || ATTR_LANG === 'en') state.lang = ATTR_LANG;
  try {
    var savedLang = ATTR_LANG ? null : window.localStorage.getItem('irushy.lang');
    var savedMode = window.localStorage.getItem('irushy.mode');
    if (savedLang === 'ta' || savedLang === 'en' || savedLang === 'auto') state.lang = savedLang;
    if (savedMode === 'home' || savedMode === 'student' || savedMode === 'teacher') state.mode = savedMode;
  } catch (e) { /* storage may be blocked; not important */ }

  var t = function (key) { return (T[uiLang()] || T.en)[key] || T.en[key] || key; };
  function uiLang() { return state.lang === 'ta' ? 'ta' : 'en'; }

  /* ------------------------------------------------------------ tiny helpers */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;          // always safe
      else if (k === 'html') { /* never used: reserved to make misuse obvious */ }
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, String(v));
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function hostAllowed(url, kinds) {
    try {
      var u = new URL(url, window.location.href);
      if (u.protocol !== 'https:') return false;
      var h = u.host.toLowerCase();
      if (h === 'tnhhsscta.com' || h === 'www.tnhhsscta.com') return true;
      if (kinds && kinds.indexOf('video') !== -1) {
        return h === 'www.youtube.com' || h === 'youtube.com' || h === 'youtu.be' || h === 'www.youtube-nocookie.com' || h === 'vimeo.com' || h === 'www.vimeo.com';
      }
      return false;
    } catch (e) { return false; }
  }
  function youtubeId(url) {
    var m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/.exec(url || '');
    return m ? m[1] : null;
  }

  /* --------------------------------------------------- SVG allow-list rebuild
     A diagram can only be displayed if every element and attribute is on the
     list below. Anything else is dropped, so an SVG can never carry script,
     external references or event handlers into the page. */
  var SVG_TAGS = ['svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'tspan', 'title', 'desc'];
  var SVG_ATTRS = ['xmlns', 'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
    'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline', 'transform', 'opacity',
    'role', 'aria-label', 'aria-labelledby', 'id', 'dy', 'dx', 'letter-spacing'];
  var SVG_ATTR_LOWER = SVG_ATTRS.map(function (a) { return a.toLowerCase(); });

  function safeSvg(markup) {
    if (!markup || typeof markup !== 'string') return null;
    var parsed;
    try {
      parsed = new DOMParser().parseFromString(markup, 'image/svg+xml');
    } catch (e) { return null; }
    if (!parsed || parsed.getElementsByTagName('parsererror').length) return null;
    var src = parsed.documentElement;
    if (!src || src.nodeName.toLowerCase() !== 'svg') return null;

    function rebuild(node) {
      if (node.nodeType === 3) return document.createTextNode(node.nodeValue); // text only
      if (node.nodeType !== 1) return null;
      var name = node.nodeName.toLowerCase();
      if (SVG_TAGS.indexOf(name) === -1) return null;
      var out = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (var i = 0; i < node.attributes.length; i++) {
        var a = node.attributes[i];
        var an = a.name.toLowerCase();
        if (SVG_ATTR_LOWER.indexOf(an) === -1) continue;               // drop unknown attrs
        if (/^(href|src|xlink:href|on)/i.test(an)) continue;           // drop refs and handlers
        var av = a.value;
        if (/javascript:|data:text\/html/i.test(av)) continue;
        out.setAttribute(a.name, av);
      }
      for (var j = 0; j < node.childNodes.length; j++) {
        var kid = rebuild(node.childNodes[j]);
        if (kid) out.appendChild(kid);
      }
      return out;
    }
    return rebuild(src);
  }

  /* ---------------------------------------------------------------- shell UI */
  var root, launcher, panel, log, input, sendBtn, statusBar, countEl, lastFocus = null, live;

  function build() {
    root = el('div', { class: 'ir-root' + (DOCK === 'inline' ? ' ir-docked' : '') });

    launcher = el('button', {
      class: 'ir-launcher', type: 'button', id: 'irushy-launcher',
      'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': t('open'), title: t('open'),
      onclick: toggle
    }, [
      el('span', { class: 'ir-launcher-icon', 'aria-hidden': 'true', text: 'AI' }),
      el('span', { text: t('launcher') })
    ]);

    var INLINE = DOCK === 'inline';
    var closeBtn = INLINE ? null : el('button', {
      class: 'ir-icon-btn', type: 'button', 'aria-label': t('close'), title: t('close'), onclick: function () { close(true); }
    }, [el('span', { 'aria-hidden': 'true', text: '\u2715' })]);

    var langSelect = el('select', {
      class: 'ir-select', id: 'irushy-lang', 'aria-label': t('language'), onchange: onLangChange
    }, [
      el('option', { value: 'auto', text: t('auto'), selected: state.lang === 'auto' }),
      el('option', { value: 'ta', text: '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd', selected: state.lang === 'ta' }),
      el('option', { value: 'en', text: 'English', selected: state.lang === 'en' })
    ]);
    langSelect.value = state.lang;

    var modeSelect = el('select', {
      class: 'ir-select', id: 'irushy-mode', 'aria-label': t('mode'), onchange: onModeChange
    }, [
      el('option', { value: 'home', text: t('mHome') }),
      el('option', { value: 'student', text: t('mStudent') }),
      el('option', { value: 'teacher', text: t('mTeacher') })
    ]);
    modeSelect.value = state.mode;

    panel = el('section', {
      class: 'ir-panel', id: 'irushy-panel', role: 'dialog', 'aria-modal': 'false',
      'aria-label': 'IRUSHY', hidden: 'hidden'
    }, [
      el('header', { class: 'ir-header' }, [
        el('div', { class: 'ir-title' }, [
          el('span', { class: 'ir-title-mark', 'aria-hidden': 'true', text: 'AI' }),
          el('span', { class: 'ir-title-text' }, [
            el('h2', { text: t('title') }),
            el('p', { text: t('subtitle') })
          ])
        ]),
        el('div', { class: 'ir-header-actions' }, [
          el('button', {
            class: 'ir-icon-btn', type: 'button', 'aria-label': t('clear'), title: t('clear'), onclick: clearChat
          }, [el('span', { 'aria-hidden': 'true', text: '\u21ba' })]),
          closeBtn
        ]),
        el('div', { class: 'ir-controls' }, [
          el('span', { class: 'ir-field' }, [el('label', { for: 'irushy-lang', text: t('language') }), langSelect]),
          el('span', { class: 'ir-field' }, [el('label', { for: 'irushy-mode', text: t('mode') }), modeSelect])
        ])
      ]),
      statusBar = el('div', { class: 'ir-status', id: 'irushy-status', role: 'status', 'aria-live': 'polite', 'data-show': '0' }),
      log = el('div', { class: 'ir-log', id: 'irushy-log', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions text', tabindex: '0' }),
      el('div', { class: 'ir-composer' }, [
        el('div', { class: 'ir-input-row' }, [
          input = el('textarea', {
            class: 'ir-input', id: 'irushy-input', rows: '1', maxlength: '4000',
            placeholder: t('placeholder'), 'aria-label': t('placeholder'), onkeydown: onInputKey, oninput: onInput
          }),
          sendBtn = el('button', {
            class: 'ir-send', type: 'button', 'aria-label': t('send'), title: t('send'), onclick: function () { submit(input.value); }
          }, [el('span', { 'aria-hidden': 'true', text: '\u27a4' })])
        ]),
        el('div', { class: 'ir-composer-foot' }, [
          el('span', { text: t('transcript') }),
          countEl = el('span', { class: 'ir-count', id: 'irushy-count', text: '0 / 2000', 'aria-hidden': 'true' })
        ])
      ])
    ]);

    root.appendChild(launcher);
    root.appendChild(panel);

    if (DOCK === 'inline') {
      // Standalone assistant page: the panel is the page, always open.
      launcher.setAttribute('hidden', 'hidden');
      panel.classList.add('ir-panel-docked');
      panel.removeAttribute('hidden');
      state.open = true;
      var mountPoint = document.querySelector('[data-irushy-dock-target]') || document.body;
      mountPoint.appendChild(root);
    } else {
      (document.body || document.documentElement).appendChild(root);
    }
    live = panel;

    showEmptyState();
    document.addEventListener('keydown', onDocKey, true);
    window.addEventListener('resize', fitToViewport);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fitToViewport);
    applyLangToChrome();
  }

  function applyLangToChrome() {
    if (launcher && !launcher.hasAttribute('hidden')) {
      launcher.setAttribute('aria-label', t('open'));
      if (launcher.lastChild) launcher.lastChild.textContent = t('launcher');
    }
    var sel = document.getElementById('irushy-mode');
    if (sel) {
      sel.options[0].textContent = t('mHome');
      sel.options[1].textContent = t('mStudent');
      sel.options[2].textContent = t('mTeacher');
    }
    var ls = document.getElementById('irushy-lang');
    if (ls) {
      ls.options[0].textContent = t('auto');
      ls.setAttribute('aria-label', t('language'));
    }
  }

  function showStatus(kind, title, body, actions) {
    clear(statusBar);
    statusBar.setAttribute('data-show', '1');
    statusBar.setAttribute('data-kind', kind);
    var wrap = el('div', {}, [
      el('strong', { text: title }),
      body ? el('div', { text: body }) : null
    ]);
    statusBar.appendChild(wrap);
    if (actions && actions.length) {
      var box = el('div', { class: 'ir-actions', style: 'margin-top:6px' });
      actions.forEach(function (a) { box.appendChild(a); });
      statusBar.appendChild(box);
    }
  }
  function hideStatus() { statusBar.setAttribute('data-show', '0'); clear(statusBar); }

  /* -------------------------------------------------------------- rendering */
  function addMessage(role, buildContent) {
    // the greeting and its starter questions belong to the empty state only
    if (role === 'user') {
      var empty = log.querySelector('.ir-empty');
      if (empty && empty.parentNode) empty.parentNode.removeChild(empty);
    }
    var wrap = el('div', { class: 'ir-msg ir-msg-' + role });
    buildContent(wrap);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap;
  }

  function chip(kind, label) { return el('span', { class: 'ir-chip ir-chip-' + kind, text: label }); }

  var MAX_VISIBLE_LINKS = 4;

  function linkList(links, lang, options) {
    if (!links || !links.length) return null;
    var opts = options || {};
    var safe = links.filter(function (l) { return hostAllowed(l.url); });  // client-side second check
    if (!safe.length) return null;

    var box = el('div', { class: 'ir-links', 'aria-label': t('links') });
    var limit = opts.expandable === false ? safe.length : Math.min(safe.length, MAX_VISIBLE_LINKS);
    var hidden = [];

    function addLink(l) {
      var title = (l.title && (typeof l.title === 'string' ? l.title : (l.title[lang] || l.title.en))) || l.url;
      box.appendChild(el('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', text: '\u2197 ' + title }));
    }

    safe.slice(0, limit).forEach(addLink);
    if (safe.length > limit) {
      var more = el('button', {
        class: 'ir-links-more', type: 'button',
        'aria-expanded': 'false',
        text: (lang === 'ta' ? '\u0bae\u0bc0\u0ba4\u0bae\u0bcd ' + (safe.length - limit) + ' \u0b87\u0ba3\u0bc8\u0baa\u0bcd\u0baa\u0bc1\u0b95\u0bb3\u0bcd \u0b95\u0bbe\u0b9f\u0bcd\u0b9f\u0bc1' : 'Show ' + (safe.length - limit) + ' more links'),
        onclick: function () {
          safe.slice(limit).forEach(function (l) { hidden.push(addLink(l)); });
          more.setAttribute('aria-expanded', 'true');
          more.parentNode.removeChild(more);
        }
      });
      box.appendChild(more);
    }
    return box;
  }

  function renderDiagram(att, lang) {
    var svg = safeSvg(att.svg);
    if (!svg) return null;
    svg.setAttribute('role', 'img');
    var fig = el('figure', { class: 'ir-figure' }, [svg]);
    if (att.caption) fig.appendChild(el('figcaption', { text: att.caption }));
    return el('div', { class: 'ir-attach' }, [
      el('div', { class: 'ir-attach-head' }, [
        el('span', { class: 'ir-attach-title', text: '\u25a6 ' + (att.title || '') }),
        att.label ? chip('sample', att.label[lang] || att.label.en) : chip('approved', t('approved'))
      ]),
      el('div', { class: 'ir-attach-body' }, [fig])
    ]);
  }

  function renderVideo(att, lang) {
    var head = el('div', { class: 'ir-attach-head' }, [
      el('span', { class: 'ir-attach-title', text: '\u25b6 ' + (att.title || '') }),
      att.label ? chip('sample', att.label[lang] || att.label.en) : chip('approved', t('approved'))
    ]);
    var body = el('div', { class: 'ir-attach-body' });
    var metaText = [att.channel || '', att.contentReviewed === false
      ? (lang === 'ta' ? 'பள்ளியால் சரிபார்க்கப்படவில்லை' : 'not reviewed by the school') : '']
      .filter(Boolean).join(' \u00b7 ');
    var meta = el('div', { class: 'ir-attach-sub' }, [el('span', { text: metaText })]);
    body.appendChild(meta);

    var load = el('button', {
      class: 'ir-action ir-action-primary', type: 'button',
      onclick: function () {
        // nothing is fetched from the video host until this click happens
        var id = youtubeId(att.url);
        if (!id) { window.open(att.url, '_blank', 'noopener'); return; }
        clear(body);
        var frame = el('div', { class: 'ir-video-frame' });
        var iframe = document.createElement('iframe');
        iframe.setAttribute('src', 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0');
        iframe.setAttribute('title', att.title || 'video');
        iframe.setAttribute('loading', 'lazy');
        iframe.setAttribute('allow', 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen');
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        frame.appendChild(iframe);
        body.appendChild(frame);
        body.appendChild(el('div', { style: 'margin-top:6px' }, [
          el('a', { href: att.url, target: '_blank', rel: 'noopener noreferrer', class: 'ir-action', text: t('openVideo') })
        ]));
      }
    }, [el('span', { text: '\u25b6 ' + t('loadVideo') })]);

    body.appendChild(el('div', { class: 'ir-actions' }, [load]));
    return el('div', { class: 'ir-attach' }, [head, body]);
  }

  function renderAnswer(data) {
    var lang = data.lang === 'ta' ? 'ta' : 'en';
    var wrap = el('div', { class: 'ir-msg ir-msg-assistant' }, [
      el('div', { style: 'font-size:11.5px;color:#53627a;font-weight:600', text: t('irushy') })
    ]);
    var body = el('div', { class: 'ir-card' });
    body.textContent = data.answer || '';              // PLAIN TEXT ONLY
    wrap.appendChild(body);

    var meta = el('div', { class: 'ir-meta' });
    var prov = data.provenance || [];
    if (data.blocked && data.blocked.code === 'active_assessment') meta.appendChild(chip('blocked', lang === 'ta' ? 'தேர்வு நடைபெறுகிறது' : 'test in progress'));
    if (prov.indexOf('approved') !== -1) meta.appendChild(chip('approved', t('approved')));
    if (data.sampleContentUsed) meta.appendChild(chip('sample', t('sample')));
    if (prov.indexOf('approved') === -1 && !data.sampleContentUsed && !(data.blocked)) meta.appendChild(chip('general', t('general')));
    if (meta.childNodes.length) wrap.appendChild(meta);

    if (prov.indexOf('approved') === -1 && !data.sampleContentUsed && data.answer && data.answer.length > 220 && !data.blocked) {
      wrap.appendChild(el('div', { style: 'font-size:12.5px;color:#7a4a00;background:#fdf3e0;border:1px solid #e2c287;border-radius:8px;padding:7px 9px;line-height:1.4', text: t('generalNote') }));
    }
    if (data.sampleNotice) {
      wrap.appendChild(el('div', { style: 'font-size:12.5px;color:#7a4a00;background:#fdf3e0;border:1px solid #e2c287;border-radius:8px;padding:7px 9px;line-height:1.4', text: data.sampleNotice[lang] || data.sampleNotice.en }));
    }

    var links = linkList(data.links, lang);
    if (links) wrap.appendChild(links);

    (data.attachments || []).forEach(function (att, i) {
      var node = att.type === 'diagram' ? renderDiagram(att, lang) : att.type === 'video' ? renderVideo(att, lang) : null;
      if (node) wrap.appendChild(node);
    });

    if (data.notices && data.notices.length) {
      // server-side decisions the visitor should see, in plain language
      data.notices.forEach(function (n) {
        if (/teacher/i.test(n) && /downgrad|NOT signed/i.test(n) && !/answer as/i.test(n)) {
          wrap.appendChild(el('div', { style: 'font-size:12.5px;color:#24408a;background:#e9eefb;border:1px solid #b8c6ea;border-radius:8px;padding:7px 9px;line-height:1.4', text: t('downgraded') }));
        }
      });
    }

    var actions = el('div', { class: 'ir-actions' });
    (data.suggestions || []).forEach(function (s) {
      actions.appendChild(el('button', {
        class: 'ir-action', type: 'button', text: s.label,
        onclick: function () { submit(s.prompt || followUpFor(s.action, lang)); }
      }));
    });
    actions.appendChild(el('button', {
      class: 'ir-action', type: 'button', text: t('copy'),
      onclick: function (ev) {
        try {
          navigator.clipboard.writeText(data.answer || '');
          ev.target.textContent = t('copied');
          setTimeout(function () { ev.target.textContent = t('copy'); }, 1500);
        } catch (e) { /* clipboard may be blocked; not important */ }
      }
    }));
    wrap.appendChild(actions);
    return wrap;
  }

  function followUpFor(action, lang) {
    var ta = lang === 'ta';
    if (action === 'explain_more_simply') return ta ? '\u0b87\u0ba4\u0bc8 \u0b87\u0ba9\u0bcd\u0ba9\u0bc1\u0bae\u0bcd \u0b8e\u0bb3\u0bbf\u0bae\u0bc8\u0baf\u0bbe\u0b95 \u0bb5\u0bbf\u0bb3\u0b95\u0bcd\u0b95\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd.' : 'Please explain that more simply.';
    if (action === 'show_example') return ta ? '\u0b92\u0bb0\u0bc1 \u0b8e\u0b9f\u0bc1\u0ba4\u0bcd\u0ba4\u0bc1\u0b95\u0bcd\u0b95\u0bbe\u0b9f\u0bcd\u0b9f\u0bc1 \u0b95\u0bbe\u0b9f\u0bcd\u0b9f\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd.' : 'Show me an example.';
    if (action === 'try_similar') return ta ? '\u0b87\u0ba4\u0bc7 \u0baa\u0bcb\u0ba9\u0bcd\u0bb1 \u0b92\u0bb0\u0bc1 \u0bb5\u0bbf\u0ba9\u0bbe\u0bb5\u0bc8\u0b95\u0bcd \u0b95\u0bc7\u0bb3\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd.' : 'Give me a similar practice question.';
    return '';
  }

  function renderError(data) {
    var lang = data.lang === 'ta' ? 'ta' : 'en';
    var msg = (data.error && data.error.message && (data.error.message[lang] || data.error.message.en)) || 'Something went wrong.';
    var wrap = el('div', { class: 'ir-msg ir-msg-assistant' }, [
      el('div', { style: 'font-size:11.5px;color:#53627a;font-weight:600', text: t('irushy') }),
      el('div', { class: 'ir-card ir-card-error', text: msg })
    ]);
    if (data.error && data.error.code === 'not_connected') {
      wrap.insertBefore(el('div', { class: 'ir-card ir-card-warn', text: t('notConnectedBody') }), wrap.children[1]);
    }
    // during an outage these links are the whole point, so never collapse them
    var links = linkList(data.links, lang, { expandable: false });
    if (links) wrap.appendChild(links);
    var actions = el('div', { class: 'ir-actions' });
    if (!data.error || data.error.retryable !== false) {
      actions.appendChild(el('button', {
        class: 'ir-action ir-action-primary', type: 'button', text: t('retry'),
        onclick: function () { if (state.lastMessage) submit(state.lastMessage, { isRetry: true }); }
      }));
    }
    actions.appendChild(el('button', {
      class: 'ir-action', type: 'button', text: t('mHome'),
      onclick: function () { window.open('https://tnhhsscta.com/', '_blank', 'noopener'); }
    }));
    wrap.appendChild(actions);
    return wrap;
  }

  function showEmptyState() {
    clear(log);
    var box = el('div', { class: 'ir-empty' }, [
      el('h3', { text: t('greeting') }),
      el('p', { text: t('intro') })
    ]);
    var chips = el('div', { class: 'ir-actions' }, [
      el('button', {
        class: 'ir-action', type: 'button',
        text: uiLang() === 'ta' ? '\u0baa\u0bbe\u0b9f\u0b95\u0bcd\u0b95\u0bc1\u0bb1\u0bbf\u0baa\u0bcd\u0baa\u0bc1\u0b95\u0bb3\u0bcd \u0b8e\u0b99\u0bcd\u0b95\u0bc7?' : 'Where are the materials?',
        onclick: function () { submit(uiLang() === 'ta' ? '\u0baa\u0bbe\u0b9f\u0b95\u0bcd\u0b95\u0bc1\u0bb1\u0bbf\u0baa\u0bcd\u0baa\u0bc1\u0b95\u0bb3\u0bcd \u0b8e\u0b99\u0bcd\u0b95\u0bc7?' : 'Where are the materials?'); }
      }),
      el('button', {
        class: 'ir-action', type: 'button',
        text: uiLang() === 'ta' ? '\u0b86\u0ba9\u0bcd\u0bb2\u0bc8\u0ba9\u0bcd \u0ba4\u0bc7\u0bb0\u0bcd\u0bb5\u0bc1 \u0b8e\u0baa\u0bcd\u0baa\u0b9f\u0bbf?' : 'How do I take the online test?',
        onclick: function () { submit(uiLang() === 'ta' ? '\u0b86\u0ba9\u0bcd\u0bb2\u0bc8\u0ba9\u0bcd \u0ba4\u0bc7\u0bb0\u0bcd\u0bb5\u0bc8 \u0b8e\u0baa\u0bcd\u0baa\u0b9f\u0bbf \u0b8e\u0b9f\u0bc1\u0baa\u0bcd\u0baa\u0ba4\u0bc1?' : 'How do I take the online one word test?'); }
      }),
      el('button', {
        class: 'ir-action', type: 'button',
        text: uiLang() === 'ta' ? '\u0b86\u0b9a\u0bbf\u0bb0\u0bbf\u0baf\u0bb0\u0bcd \u0baa\u0ba4\u0bbf\u0bb5\u0bc1 \u0b8e\u0baa\u0bcd\u0baa\u0b9f\u0bbf?' : 'How does a teacher register?',
        onclick: function () { submit(uiLang() === 'ta' ? '\u0b86\u0b9a\u0bbf\u0bb0\u0bbf\u0baf\u0bb0\u0bcd \u0baa\u0ba4\u0bbf\u0bb5\u0bc1 \u0b8e\u0baa\u0bcd\u0baa\u0b9f\u0bbf \u0b9a\u0bc6\u0baf\u0bcd\u0bb5\u0ba4\u0bc1?' : 'How does a teacher register?'); }
      })
    ]);
    box.appendChild(el('p', { style: 'font-weight:600;margin-top:2px', text: t('starters') }));
    box.appendChild(chips);
    log.appendChild(box);
  }

  /* ---------------------------------------------------------------- requests */
  function setStatusFromConfig(cfg) {
    if (!cfg) {
      showStatus('warn', t('notConnected'), t('notConnectedBody'));
      return;
    }
    state.counters.limit = (cfg.limits && cfg.limits.maxInputChars) || 2000;
    input.setAttribute('maxlength', String(Math.max(state.counters.limit, 100)));
    onInput();
    if (!cfg.connected) {
      showStatus('warn', t('notConnected'), t('notConnectedBody'));
    } else if (cfg.features && cfg.features.sampleContent) {
      showStatus('info', 'IRUSHY', uiLang() === 'ta'
        ? '\u0b9a\u0bc7\u0bb5\u0bc8 \u0b87\u0ba3\u0bc8\u0b95\u0bcd\u0b95\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f\u0bc1\u0bb3\u0bcd\u0bb3\u0ba4\u0bc1. \u0b9a\u0bbf\u0bb2 \u0baa\u0ba4\u0bbf\u0bb2\u0bcd\u0b95\u0bb3\u0bbf\u0bb2\u0bcd \u0b85\u0b99\u0bcd\u0b95\u0bc0\u0b95\u0bb0\u0bbf\u0b95\u0bcd\u0b95\u0baa\u0bcd\u0baa\u0b9f\u0bbe\u0ba4 \u0bae\u0bbe\u0ba4\u0bbf\u0bb0\u0bbf \u0b89\u0bb3\u0bcd\u0bb3\u0b9f\u0b95\u0bcd\u0b95\u0bae\u0bcd \u0b87\u0bb0\u0bc1\u0ba8\u0bcd\u0ba4\u0bbe\u0bb2\u0bcd \u0b85\u0ba4\u0bc1 \u0b95\u0bc1\u0bb1\u0bbf\u0b95\u0bcd\u0b95\u0baa\u0bcd\u0baa\u0b9f\u0bc1\u0bae\u0bcd.'
        : 'Connected. Some answers use clearly-labelled sample content that the school has not approved yet.');
    } else {
      hideStatus();
    }
  }

  function loadConfig() {
    return fetch(API + '/config', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { state.config = j.config; setStatusFromConfig(state.config); })
      .catch(function () { setStatusFromConfig(null); });
  }

  function onInput() {
    var len = input.value.length;
    state.counters.chars = len;
    countEl.textContent = len + ' / ' + state.counters.limit;
    countEl.setAttribute('data-warn', len > state.counters.limit * 0.9 ? '1' : '0');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 132) + 'px';
  }

  function onInputKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(input.value);
    }
  }

  function onLangChange(e) {
    state.lang = e.target.value;
    try { window.localStorage.setItem('irushy.lang', state.lang); } catch (err) {}
    applyLangToChrome();
    if (log.childNodes.length > 1) {
      showStatus('info', t('langChanged') + ' ' + (state.lang === 'ta' ? '\u0ba4\u0bae\u0bbf\u0bb4\u0bcd' : state.lang === 'en' ? 'English' : t('auto')));
      setTimeout(hideStatus, 4000);
    }
  }

  function onModeChange(e) {
    state.mode = e.target.value;
    try { window.localStorage.setItem('irushy.mode', state.mode); } catch (err) {}
    if (state.mode === 'teacher') showStatus('info', t('teacherHint'));
    else hideStatus();
  }

  function setBusy(busy) {
    state.inFlight = busy;
    sendBtn.disabled = busy;
    input.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function addTyping() {
    var node = addMessage('assistant', function (wrap) {
      wrap.appendChild(el('div', { style: 'font-size:11.5px;color:#53627a;font-weight:600', text: t('irushy') }));
      wrap.appendChild(el('div', { class: 'ir-typing' }, [
        el('span', { text: t('thinking') }),
        el('span', { class: 'ir-dots', 'aria-hidden': 'true' }, [el('i'), el('i'), el('i')])
      ]));
    });
    return node;
  }

  function submit(rawText, opts) {
    var text = (rawText || '').trim();
    if (!text || state.inFlight) return;                 // no duplicate submissions
    state.lastMessage = text;
    opts = opts || {};

    if (input.value.trim() === text) { input.value = ''; onInput(); }

    addMessage('user', function (wrap) {
      wrap.appendChild(el('div', { class: 'ir-bubble', text: text }));
    });
    var typing = addTyping();
    setBusy(true);
    if (opts.isRetry) hideStatus();

    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    state.abort = controller;
    var timeout = setTimeout(function () { if (controller) controller.abort(); }, 60000);

    rememberTurn('user', text);

    var payload = {
      message: text,
      lang: state.lang,
      mode_requested: state.mode,
      request_id: uid(),
      // Bounded, in-memory history only. No transcripts are written anywhere.
      history: historyFor(),
      context: contextFor(text)
    };

    fetch(API + '/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false, error: { code: 'bad_response', message: { en: 'The IRUSHY server sent an unreadable reply.', ta: '\u0baa\u0b9f\u0bbf\u0b95\u0bcd\u0b95 \u0bae\u0bc1\u0b9f\u0bbf\u0baf\u0bbe\u0ba4 \u0baa\u0ba4\u0bbf\u0bb2\u0bcd.' } } };
        });
      })
      .then(function (data) {
        clearTimeout(timeout);
        typing.parentNode.removeChild(typing);
        setBusy(false);
        state.abort = null;
        if (data.ok) {
          var node = renderAnswer(data);
          log.appendChild(node);
          rememberTurn('assistant', data.answer || '');
          if (data.mode && data.mode !== state.mode && state.mode === 'teacher') showStatus('info', t('downgraded'));
          if (data.results_access && data.results_access.available === false && /result|mark|score/i.test(text + ' ' + (data.answer || ''))) {
            showStatus('info', t('resultUnavailable'));
          }
        } else {
          // a server-level error object (may lack a nested error block)
          if (!data.error) data.error = { code: 'server_error', message: { en: 'Something went wrong. Please retry.', ta: '\u0b9a\u0bbf\u0b95\u0bcd\u0b95\u0bb2\u0bcd. \u0bae\u0bc0\u0ba3\u0bcd\u0b9f\u0bc1\u0bae\u0bcd \u0bae\u0bc1\u0baf\u0bb1\u0bcd\u0b9a\u0bbf\u0b95\u0bcd\u0b95\u0bb5\u0bc1\u0bae\u0bcd.' } };
          if (!data.lang) data.lang = state.lang === 'ta' ? 'ta' : 'en';
          log.appendChild(renderError(data));
        }
        log.scrollTop = log.scrollHeight;
      })
      .catch(function (err) {
        clearTimeout(timeout);
        if (typing.parentNode) typing.parentNode.removeChild(typing);
        setBusy(false);
        state.abort = null;
        if (err && err.name === 'AbortError') {
          log.appendChild(renderError({
            lang: state.lang,
            error: { code: 'timeout', retryable: true, message: { en: 'The request was stopped or timed out. You can retry.', ta: '\u0b95\u0bcb\u0bb0\u0bbf\u0b95\u0bcd\u0b95\u0bc8 \u0ba8\u0bbf\u0bb1\u0bc1\u0ba4\u0bcd\u0ba4\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f\u0ba4\u0bc1. \u0bae\u0bc0\u0ba3\u0bcd\u0b9f\u0bc1\u0bae\u0bcd \u0bae\u0bc1\u0baf\u0bb1\u0bcd\u0b9a\u0bbf\u0b95\u0bcd\u0b95\u0bb5\u0bc1\u0bae\u0bcd.' } },
            links: FALLBACK_LINKS.slice(0, 4)
          }));
        } else {
          log.appendChild(renderError({
            lang: state.lang,
            error: { code: 'network', retryable: true, message: { en: 'I could not reach the IRUSHY server. Check the connection and retry.', ta: 'IRUSHY \u0b9a\u0bc7\u0bb5\u0bc8\u0baf\u0b95\u0ba4\u0bcd\u0ba4\u0bc8 \u0b85\u0ba3\u0bc1\u0b95 \u0bae\u0bc1\u0b9f\u0bbf\u0baf\u0bb5\u0bbf\u0bb2\u0bcd\u0bb2\u0bc8.' } },
            links: FALLBACK_LINKS.slice(0, 4)
          }));
        }
        log.scrollTop = log.scrollHeight;
      });
  }

  /* In-memory only, last 6 turns, capped. Cleared by Clear chat and on reload. */
  var turns = [];
  function rememberTurn(role, content) {
    turns.push({ role: role, content: String(content).slice(0, 1200) });
    if (turns.length > 6) turns = turns.slice(-6);
  }
  function historyFor() {
    // The current user message is sent separately, so drop the last turn
    // (which is the one just recorded) and keep only a short recent window.
    return turns.slice(0, -1).slice(-4);
  }
  function contextFor(text) {
    var c = {};
    if (state.mode === 'student') {
      var m = /\b(11|12|plus one|plus two)\b/.exec(text) || /(\u0baa\u0ba4\u0bbf\u0ba9\u0bca\u0ba9\u0bcd\u0bb1\u0bbe\u0bae\u0bcd|\u0baa\u0ba9\u0bcd\u0ba9\u0bbf\u0bb0\u0ba3\u0bcd\u0b9f\u0bbe\u0bae\u0bcd)/.exec(text);
      if (m) c.class = Number(m[1] === '11' || m[1] === '12' ? m[1] : (/11|\u0baa\u0ba4\u0bbf\u0ba9\u0bca/.test(text) ? 11 : 12));
      if (/computer\s*application|\u0baa\u0baf\u0ba9\u0bcd\u0baa\u0bbe\u0b9f\u0bc1/i.test(text)) c.subject = 'Computer Applications';
      else if (/computer\s*(science|\u0b85\u0bb1\u0bbf\u0bb5\u0bbf\u0baf\u0bb2\u0bcd)/i.test(text)) c.subject = 'Computer Science';
      if (/\u0ba4\u0bae\u0bbf\u0bb4\u0bcd|tamil medium/i.test(text)) c.medium = 'Tamil Medium';
      if (/english medium/i.test(text)) c.medium = 'English Medium';
    }
    // NOTE: no assessment status is ever asserted by the browser. The server
    // only accepts a signed token, which this widget never fabricates.
    return c;
  }

  /* --------------------------------------------------------------- open/close */
  function toggle() { state.open ? close(true) : open(); }

  function open() {
    if (state.open) return;
    lastFocus = document.activeElement;
    panel.removeAttribute('hidden');
    launcher.setAttribute('aria-expanded', 'true');
    state.open = true;
    fitToViewport();
    var first = panel.querySelector('.ir-input');
    if (first) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }, 30);
  }

  function close(returnFocus) {
    if (!state.open) return;
    if (state.abort) { try { state.abort.abort(); } catch (e) {} }
    panel.setAttribute('hidden', 'hidden');
    launcher.setAttribute('aria-expanded', 'false');
    state.open = false;
    if (returnFocus !== false) {
      var target = lastFocus && lastFocus.focus && lastFocus !== document.body ? lastFocus : launcher;
      try { target.focus(); } catch (e) { launcher.focus(); }
    }
  }

  function clearChat() {
    if (state.abort) { try { state.abort.abort(); } catch (e) {} }
    turns = [];
    setBusy(false);
    hideStatus();
    showEmptyState();
    if (state.config) setStatusFromConfig(state.config);
    input.focus();
  }

  function onDocKey(e) {
    if (!state.open) return;
    if (e.key === 'Escape') {
      // On the standalone page the panel IS the page, so Escape does nothing.
      if (DOCK === 'inline') return;
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      var focusables = panel.querySelectorAll('button, textarea, select, a[href], input, [tabindex]:not([tabindex="-1"])');
      var list = Array.prototype.filter.call(focusables, function (n) { return !n.disabled && n.offsetParent !== null; });
      if (!list.length) return;
      var first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }

  /**
   * Keep the panel usable when the mobile keyboard opens.
   *
   * `position: fixed; bottom: 0` is relative to the LAYOUT viewport, which the
   * on-screen keyboard covers, so anchoring to the bottom would hide the input
   * behind the keyboard. Instead we anchor the panel to the top of the VISUAL
   * viewport and give it exactly the visible height, so the close button and
   * the composer are both always on screen.
   */
  function fitToViewport() {
    if (!panel) return;
    var vv = window.visualViewport;
    var narrow = window.innerWidth <= 560;
    if (vv && narrow) {
      var h = Math.round(vv.height);
      panel.style.setProperty('--ir-vh', h + 'px');
      panel.classList.add('ir-kb');
      panel.style.top = Math.round(vv.offsetTop) + 'px';
      panel.style.bottom = 'auto';
    } else {
      panel.classList.remove('ir-kb');
      panel.style.removeProperty('--ir-vh');
      panel.style.removeProperty('top');
      panel.style.removeProperty('bottom');
    }
  }

  /* --------------------------------------------------------- frame bridging */
  var SOURCE = 'irushy-widget';
  function isTopWindow() { try { return window.self === window.top; } catch (e) { return false; } }

  function mount() {
    build();
    loadConfig();
    if (state.mode === 'teacher') showStatus('info', t('teacherHint'));
  }

  /** Injected-into-a-frame mode: mount a normal widget, but warn if cramped. */
  function mountInner() {
    build();
    loadConfig();
    if (window.innerWidth < MIN_PANEL_WIDTH) {
      var box = el('div', { style: 'font-size:12.5px;color:#7a4a00;background:#fdf3e0;border:1px solid #e2c287;border-radius:8px;padding:7px 9px;line-height:1.4' });
      box.appendChild(el('span', { text: uiLang() === 'ta'
        ? 'இந்த இணையதளம் frame பயன்படுத்துகிறது, எனவே இங்கு அரங்கு குறுகலாக உள்ளது. '
        : 'This website uses frames, so the panel is narrow here. ' }));
      box.appendChild(el('a', { href: '/irushy/assistant.html?mode=' + encodeURIComponent(state.mode), target: '_top',
        style: 'color:#7a4a00;text-decoration:underline', text: uiLang() === 'ta' ? 'முழுத்திரை உதவியாளரைத் திற' : 'Open the full-screen assistant' }));
      log.insertBefore(box, log.firstChild);
    }
  }

  /**
   * Frameset fallback: choose the largest frame, inject the widget's own CSS
   * and script into that frame (same origin), and let it mount itself there.
   */
  function mountIntoFrameset() {
    var frames = Array.prototype.slice.call(document.querySelectorAll('frame'));
    var best = null;
    var bestArea = 0;
    frames.forEach(function (f) {
      var a = frameArea(f);
      // prefer frames that can actually host a panel
      if (a > bestArea) { bestArea = a; best = f; }
    });
    if (!best) return false;
    var doc = null;
    try { doc = best.contentDocument; } catch (e) { doc = null; }
    if (!doc) return false;                       // cross-origin: give up quietly
    var doInject = function () {
      try {
        if (!doc.querySelector('link[data-irushy-css]')) {
          var link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.href = '/irushy/irushy.css';
          link.setAttribute('data-irushy-css', '1');
          doc.head.appendChild(link);
        }
        if (!doc.querySelector('script[data-irushy-injected]')) {
          var tag = doc.createElement('script');
          tag.src = '/irushy/irushy.js';
          tag.defer = true;
          tag.setAttribute('data-irushy-mode', DEFAULT_MODE);
          tag.setAttribute('data-irushy-injected', '1');
          doc.head.appendChild(tag);
        }
        return true;
      } catch (e) { return false; }
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', doInject);
    else doInject();
    // tell the injected copy to mount even though it is not the top window
    try {
      window.addEventListener('message', function (ev) {
        if (ev.data && ev.data.source === 'irushy-widget' && ev.data.type === 'injected-ready') return;
      });
    } catch (e) { /* ignore */ }
    return true;
  }

  // -------------------------------------------------------------------------
  // Boot: decide where the widget can live.
  // -------------------------------------------------------------------------
  if (isTopWindow() && isFramesetDocument(document) && DOCK !== 'inline') {
    // (1) frameset top document - cannot paint here, mount inside a frame
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountIntoFrameset);
    else mountIntoFrameset();
  } else if (isTopWindow()) {
    // (2) normal page (or the shell page around the frameset) - full overlay
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
  } else if (script && script.getAttribute('data-irushy-injected') === '1') {
    // (3) we were injected into a frame by the frameset branch
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountInner);
    else mountInner();
  } else {
    // Inside a frame: ask the top-level IRUSHY host to open instead of being
    // clipped. If no host answers, fall back to an in-frame widget.
    var answered = false;
    window.addEventListener('message', function (ev) {
      if (ev.origin !== window.location.origin || !ev.data || ev.data.source !== SOURCE) return;
      if (ev.data.type === 'ready') answered = true;
    });
    try { window.top.postMessage({ source: SOURCE, type: 'open-request' }, window.location.origin); } catch (e) {}
    setTimeout(function () {
      if (!answered && !document.getElementById('irushy-panel')) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
        else mount();
      }
    }, 800);
  }

  // Host side of the bridge: a child frame can ask us to open the panel.
  window.addEventListener('message', function (ev) {
    if (ev.origin !== window.location.origin || !ev.data || ev.data.source !== SOURCE) return;
    if (ev.data.type === 'open-request' && isTopWindow()) {
      if (document.getElementById('irushy-panel')) { open(); try { ev.source.postMessage({ source: SOURCE, type: 'ready' }, ev.origin); } catch (e) {} }
    }
  });

  // expose a tiny API for the surrounding page (no secrets, no state leaks)
  window.IRUSHY = {
    open: function () { if (isTopWindow()) open(); },
    close: function () { if (isTopWindow()) close(true); },
    ask: function (text) { if (isTopWindow()) { open(); submit(text); } },
    setLanguage: function (lang) { if (lang === 'ta' || lang === 'en' || lang === 'auto') { state.lang = lang; applyLangToChrome(); } },
    setMode: function (mode) { if (mode === 'home' || mode === 'student' || mode === 'teacher') { state.mode = mode; var s = document.getElementById('irushy-mode'); if (s) s.value = mode; } },
    version: '1.0.0'
  };
})();
