/* ============================================================
   STRATUM HEADER — NEW SYSTEM PAGE INFRASTRUCTURE (Sept 2026)
   ------------------------------------------------------------
   Standalone module, decoupled from stratum-lesson-engine.js.
   This is stage 1 of the System Page rebuild: header only. It
   replaces the old buildHomeShell() sidebar nav entirely (Coach /
   Practice / Library / Tutorial / Language) per Ted's direction —
   the old Home/WIP/Writing Modules/Idea Log/Action Items/Glossary/
   Help sidebar is not rendered by this file. Body content (Recent
   Activity, Focus Tracking, etc.) is a later stage.

   Data sources — reuses the SAME backend the old engine used, so
   nothing about the student's account, WIP profile, or language
   preference is duplicated or forked:
     - stratum_sid cookie for identity (same cookie name/format the
       engine already sets via ensureDurableIdentity()).
     - GET /project?studentId=... for WIP title + genre.
     - GET /languages + PATCH /student/lang for the language
       dropdown (same endpoints, same localStorage key
       'wlfc_preferred_lang', as the old buildNavLanguageControl())
       — so if/when the engine is reintroduced for body content, the
       two stay in sync automatically.

   Known placeholder, flagged for a one-line swap once the
   login/registration/purchase plugin exists:
     PLACEHOLDER_STUDENT_NAME — used for "Welcome back" until real
     account data is wired in. Profile name is deliberately NOT
     sourced from the WIP profile (Ted's own instruction: the future
     account/profile record is separate from the WIP record).

   Assumptions made without explicit confirmation (flag for review):
     - Coach / Practice / Library nav links point to '#' placeholders
       (their pages don't exist yet) with a TODO comment each, rather
       than guessed-at real slugs.
     - Tutorial dropdown renders with its open/close interaction
       working now, but an empty state (no dummy Wistia entries)
       until real video IDs are supplied — see TUTORIAL_VIDEOS below.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = 'https://stratum-proxy.tedbaker0207.workers.dev';
  var SID_COOKIE = 'stratum_sid';
  var LANG_STORE_KEY = 'wlfc_preferred_lang'; // same key the engine already uses — keep in sync
  var PLACEHOLDER_STUDENT_NAME = 'Ted'; // TODO: swap for real account data once the login/registration plugin exists

  // TODO: real page slugs once Coach / Practice(Glossary) / Library pages exist.
  var NAV_LINKS = {
    coach: '#',
    practice: '#',
    library: '#'
  };

  // TODO: populate with real Wistia media IDs once tutorial videos are recorded.
  // Shape: [{ label: 'Getting started', wistiaId: 'xxxxxxxxxx' }, ...]
  var TUTORIAL_VIDEOS = [];

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].trim();
      var eq = kv.indexOf('=');
      if (eq > -1 && kv.slice(0, eq) === name) return decodeURIComponent(kv.slice(eq + 1));
    }
    return null;
  }
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

  var STUDENT_ID = readCookie(SID_COOKIE);

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  function closeAllDropdowns(except) {
    document.querySelectorAll('.sh-nav-dropdown.open').forEach(function (d) {
      if (d !== except) d.classList.remove('open');
    });
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.sh-nav-dropdown')) closeAllDropdowns();
  });

  function buildDropdown(labelText, panelBuilder) {
    var wrap = el('div', 'sh-nav-dropdown');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sh-nav-link';
    btn.appendChild(document.createTextNode(labelText));
    mount(btn, el('span', 'sh-caret', '\u25BE'));
    mount(wrap, btn);
    var panel = el('div', 'sh-dropdown-panel');
    panelBuilder(panel);
    mount(wrap, panel);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = !wrap.classList.contains('open');
      closeAllDropdowns();
      wrap.classList.toggle('open', willOpen);
    });
    return wrap;
  }

  function buildTutorialDropdown() {
    return buildDropdown('Tutorial', function (panel) {
      if (!TUTORIAL_VIDEOS.length) {
        mount(panel, el('div', 'sh-dropdown-empty', 'Tutorials coming soon'));
        return;
      }
      TUTORIAL_VIDEOS.forEach(function (v) {
        var item = el('button', 'sh-dropdown-item', v.label);
        item.type = 'button';
        item.addEventListener('click', function () { openTutorialPopup(v); });
        mount(panel, item);
      });
    });
  }

  // Popup player for a Wistia tutorial video — built once real IDs exist.
  function openTutorialPopup(video) {
    closeAllDropdowns();
    var overlay = el('div', 'sh-tutorial-overlay');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(8,8,8,.65);z-index:9999;display:flex;align-items:center;justify-content:center;padding:24px;';
    var box = el('div');
    box.style.cssText = 'width:100%;max-width:900px;aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden;position:relative;';
    var closeBtn = el('button', null, '\u2715');
    closeBtn.type = 'button';
    closeBtn.style.cssText = 'position:absolute;top:10px;right:10px;z-index:2;background:rgba(0,0,0,.6);color:#F4F2ED;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:14px;';
    closeBtn.addEventListener('click', function () { overlay.remove(); });
    var player = document.createElement('wistia-player');
    player.setAttribute('media-id', video.wistiaId);
    player.style.cssText = 'display:block;width:100%;height:100%;';
    box.appendChild(player);
    box.appendChild(closeBtn);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    if (!document.querySelector('script[src="https://fast.wistia.com/player.js"]')) {
      var s = document.createElement('script');
      s.src = 'https://fast.wistia.com/player.js';
      s.async = true;
      document.head.appendChild(s);
    }
    var moduleSrc = 'https://fast.wistia.com/embed/' + video.wistiaId + '.js';
    if (!document.querySelector('script[src="' + moduleSrc + '"]')) {
      var m = document.createElement('script');
      m.src = moduleSrc;
      m.type = 'module';
      m.async = true;
      document.head.appendChild(m);
    }
  }

  function buildLanguageDropdown() {
    var wrap = buildDropdown('Language', function (panel) {
      mount(panel, el('div', 'sh-dropdown-empty', 'Loading\u2026'));
    });
    var panel = wrap.querySelector('.sh-dropdown-panel');
    fetch(PROXY_URL + '/languages')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var langs = (d && Array.isArray(d.languages) && d.languages.length)
          ? d.languages
          : [{ code: 'en', label: 'English', coachingName: '' }];
        var current = lsGet(LANG_STORE_KEY) || 'en';
        panel.innerHTML = '';
        langs.forEach(function (lang) {
          var item = el('button', 'sh-dropdown-item' + (lang.code === current ? ' sh-active' : ''), lang.label);
          item.type = 'button';
          item.addEventListener('click', function () {
            if (lang.code === current) { wrap.classList.remove('open'); return; }
            switchLanguage(lang.code, lang.coachingName);
          });
          mount(panel, item);
        });
      })
      .catch(function () {
        panel.innerHTML = '';
        mount(panel, el('div', 'sh-dropdown-empty', 'Could not load languages'));
      });
    return wrap;
  }

  function switchLanguage(code, coachingName) {
    lsSet(LANG_STORE_KEY, code);
    if (STUDENT_ID) {
      fetch(PROXY_URL + '/student/lang', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: STUDENT_ID, lang: code, language: coachingName || undefined })
      })
        .catch(function () {})
        .then(function () { location.reload(); });
    } else {
      location.reload();
    }
  }

  function fetchWipSummary(callback) {
    if (!STUDENT_ID) { callback(null); return; }
    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known) { callback(null); return; }
        callback({ wipTitle: d.wipTitle || '', genre: d.genre || '' });
      })
      .catch(function () { callback(null); });
  }

  // Abstract geological strata cross-section, echoing the excavation
  // concept, rendered as a background accent along the header's right
  // edge. Static decoration — inserted as raw markup, not built via el().
  var STRATA_ART_SVG =
    '<svg class="sh-strata-art" viewBox="0 0 380 260" preserveAspectRatio="xMaxYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs>' +
        '<linearGradient id="shFade" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0%" stop-color="#0E0E10" stop-opacity="1"/>' +
          '<stop offset="100%" stop-color="#0E0E10" stop-opacity="0"/>' +
        '</linearGradient>' +
      '</defs>' +
      '<rect x="0" y="0" width="380" height="30" fill="#1E1E22"/>' +
      '<rect x="0" y="30" width="380" height="26" fill="#332821"/>' +
      '<rect x="0" y="56" width="380" height="34" fill="#4A3626"/>' +
      '<rect x="0" y="90" width="380" height="22" fill="#1E1E22"/>' +
      '<rect x="0" y="112" width="380" height="40" fill="#5C4230"/>' +
      '<rect x="0" y="152" width="380" height="18" fill="#332821"/>' +
      '<rect x="0" y="170" width="380" height="36" fill="#C97C4A" opacity="0.35"/>' +
      '<rect x="0" y="206" width="380" height="24" fill="#1E1E22"/>' +
      '<rect x="0" y="230" width="380" height="30" fill="#4A3626"/>' +
      '<line x1="60" y1="0" x2="60" y2="260" stroke="#C97C4A" stroke-opacity="0.25" stroke-width="1" stroke-dasharray="4 6"/>' +
      '<line x1="230" y1="0" x2="230" y2="260" stroke="#C97C4A" stroke-opacity="0.15" stroke-width="1" stroke-dasharray="4 6"/>' +
      '<circle cx="150" cy="128" r="4" fill="#C97C4A"/>' +
      '<circle cx="290" cy="184" r="3" fill="#F4F2ED" opacity="0.5"/>' +
      '<rect x="0" y="0" width="120" height="260" fill="url(#shFade)"/>' +
    '</svg>';

  function buildHeader(container) {
    var wrap = el('div', 'sh-wrap');
    wrap.insertAdjacentHTML('afterbegin', STRATA_ART_SVG);

    // ---- Top bar: brand + nav ----
    var topbar = el('div', 'sh-topbar');
    var brand = el('div', 'sh-brand');
    mount(brand, el('div', 'sh-brand-mark'));
    mount(brand, el('span', 'sh-brand-name', 'The Stratum Method'));
    var tagline = el('span', 'sh-for-writers', 'For writers');
    tagline.style.fontSize = '18px';
    tagline.style.color = 'var(--sh-warm)';
    mount(brand, tagline);
    mount(topbar, brand);

    var nav = el('div', 'sh-nav');
    [['Coach', NAV_LINKS.coach], ['Practice', NAV_LINKS.practice], ['Library', NAV_LINKS.library]].forEach(function (pair) {
      var a = document.createElement('a');
      a.className = 'sh-nav-link';
      a.href = pair[1];
      a.textContent = pair[0];
      mount(nav, a);
    });
    mount(nav, buildTutorialDropdown());
    mount(nav, buildLanguageDropdown());
    mount(nav, el('div', 'sh-avatar', PLACEHOLDER_STUDENT_NAME.charAt(0).toUpperCase()));
    mount(topbar, nav);
    mount(wrap, topbar);

    // ---- Welcome ----
    var welcomeRow = el('div', 'sh-welcome-row');
    mount(welcomeRow, el('h2', 'sh-welcome', 'Welcome back, ' + PLACEHOLDER_STUDENT_NAME));
    mount(wrap, welcomeRow);

    // ---- WIP hero ----
    var heroRow = el('div', 'sh-hero-row');
    var left = document.createElement('div');
    mount(left, el('p', 'sh-eyebrow', 'You are currently excavating'));
    var titleEl = el('h1', 'sh-wip-title', 'Loading\u2026');
    mount(left, titleEl);
    var genreEl = el('p', 'sh-wip-genre', '');
    mount(left, genreEl);
    mount(heroRow, left);

    var resumeBtn = el('button', 'sh-resume-btn', 'Resume excavating \u2192');
    resumeBtn.type = 'button';
    resumeBtn.disabled = true; // enabled once Coach destination exists — see NAV_LINKS.coach TODO
    resumeBtn.addEventListener('click', function () {
      if (NAV_LINKS.coach && NAV_LINKS.coach !== '#') window.location.href = NAV_LINKS.coach;
    });
    mount(heroRow, resumeBtn);
    mount(heroRow, document.createElement('div'));
    mount(wrap, heroRow);

    mount(container, wrap);

    // Publish the mounted card so other modules (e.g. stratum-dashboard.js)
    // can append their own sections into this SAME dark container instead
    // of building a second, disconnected one. Both a global reference (for
    // a module that loads after this one) and an event (for a module that
    // loads before/concurrently) are provided so load order never matters.
    window.STRATUM_HEADER_WRAP = wrap;
    document.dispatchEvent(new CustomEvent('stratum:header-mounted', { detail: { wrapEl: wrap } }));

    fetchWipSummary(function (summary) {
      if (summary && summary.wipTitle) {
        titleEl.textContent = summary.wipTitle;
        genreEl.textContent = summary.genre || '';
      } else {
        titleEl.textContent = 'No WIP on file yet';
        genreEl.textContent = 'Add your WIP details to get started';
      }
    });
  }

  function init() {
    var container = document.getElementById('stratum-header');
    if (!container) {
      console.error('[Stratum] No #stratum-header container found on this page.');
      return;
    }
    buildHeader(container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
