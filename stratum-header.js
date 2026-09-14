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

   Real login/membership data (Sept 2026): reads window.STRATUM_WP_USER,
   injected server-side by system-page-template.php via wp_get_current_user()
   / pmpro_hasMembershipLevel(). The old PLACEHOLDER_STUDENT_NAME stub is
   gone — this file now shows the real logged-in name, or a login prompt
   if nobody's logged in.

   Identity resolution (stratum_sid cookie ↔ WP login email) now lives in
   stratum-identity.js, a shared module — load that file BEFORE this one.
   It's shared because stratum-wip-profile.js needs the exact same
   resolution logic on a different page, and duplicating it a second
   time would just be two copies to keep in sync.

   Assumptions made without explicit confirmation (flag for review):
     - Coach / Practice / Library nav links point to '#' placeholders
       (their pages don't exist yet) with a TODO comment each, rather
       than guessed-at real slugs.
     - Tutorial dropdown renders with its open/close interaction
       working now, but an empty state (no dummy Wistia entries)
       until real video IDs are supplied — see TUTORIAL_VIDEOS below.
     - "User Profile" links to PMPro's own account page
       (/membership-account/, matching the page PMPro's setup wizard
       already generated) rather than a custom-built duplicate — PMPro
       already owns password/email changes correctly; no reason to
       rebuild that.
     - "WIP Profile" links to /wip-profile/, a new page built from the
       wip-profile-template.php template — TODO: confirm/adjust this
       slug to whatever the real WordPress page ends up using.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var LANG_STORE_KEY = 'wlfc_preferred_lang'; // same key the old engine already uses — keep in sync

  // Server-authoritative login/membership state — see stratum-identity.js.
  var WP_USER = window.StratumIdentity ? window.StratumIdentity.getWpUser() : { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };

  // TODO: real page slugs once Coach / Practice(Glossary) / Library pages exist.
  var NAV_LINKS = {
    coach: '#',
    practice: '#',
    library: '#',
    userProfile: '/membership-account/',
    wipProfile: '/wip-profile/'
  };

  // TODO: populate with real Wistia media IDs once tutorial videos are recorded.
  // Shape: [{ label: 'Getting started', wistiaId: 'xxxxxxxxxx' }, ...]
  var TUTORIAL_VIDEOS = [];

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }

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
    window.StratumIdentity.init(function (studentId) {
      if (studentId) {
        fetch(PROXY_URL + '/student/lang', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: studentId, lang: code, language: coachingName || undefined })
        })
          .catch(function () {})
          .then(function () { location.reload(); });
      } else {
        location.reload();
      }
    });
  }

  function fetchWipSummary(studentId, callback) {
    if (!studentId) { callback(null); return; }
    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(studentId))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known) { callback(null); return; }
        callback({ wipTitle: d.wipTitle || '', genre: d.genre || '' });
      })
      .catch(function () { callback(null); });
  }

  // Avatar dropdown — "User Profile" links to PMPro's own account page
  // (name/email/password, already handled correctly there — no reason to
  // rebuild it); "WIP Profile" links to the new dedicated page holding
  // the full work-in-progress form (title, genre, characters, etc.).
  // Logged-out visitors get a single "Log in" item instead.
  function buildAvatarDropdown() {
    var avatarInitial = WP_USER.loggedIn && WP_USER.firstName ? WP_USER.firstName.charAt(0).toUpperCase() : '?';
    var wrap = el('div', 'sh-nav-dropdown');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sh-avatar-btn';
    mount(btn, el('div', 'sh-avatar', avatarInitial));
    mount(wrap, btn);
    var panel = el('div', 'sh-dropdown-panel');
    if (WP_USER.loggedIn) {
      var profileLink = document.createElement('a');
      profileLink.className = 'sh-dropdown-item';
      profileLink.href = NAV_LINKS.userProfile;
      profileLink.textContent = 'User Profile';
      mount(panel, profileLink);
      var wipLink = document.createElement('a');
      wipLink.className = 'sh-dropdown-item';
      wipLink.href = NAV_LINKS.wipProfile;
      wipLink.textContent = 'WIP Profile';
      mount(panel, wipLink);
    } else {
      var loginLink = document.createElement('a');
      loginLink.className = 'sh-dropdown-item';
      loginLink.href = WP_USER.loginUrl;
      loginLink.textContent = 'Log in';
      mount(panel, loginLink);
    }
    mount(wrap, panel);
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var willOpen = !wrap.classList.contains('open');
      closeAllDropdowns();
      wrap.classList.toggle('open', willOpen);
    });
    return wrap;
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
    mount(nav, buildAvatarDropdown());
    mount(topbar, nav);
    mount(wrap, topbar);

    // ---- Welcome ----
    var welcomeRow = el('div', 'sh-welcome-row');
    var welcomeText = WP_USER.loggedIn
      ? 'Welcome back, ' + (WP_USER.firstName || 'there')
      : 'Welcome to The Stratum Method';
    mount(welcomeRow, el('h2', 'sh-welcome', welcomeText));
    mount(wrap, welcomeRow);

    // ---- WIP hero ----
    var heroRow = el('div', 'sh-hero-row');
    var left = document.createElement('div');
    var titleEl, genreEl, resumeBtn;

    if (!WP_USER.loggedIn) {
      // Logged out: no WIP to show, and the resume button becomes a real
      // login link rather than the disabled placeholder used elsewhere.
      // Once the System Page itself is restricted to "The Stratum Method"
      // level via PMPro's Content Settings, a logged-out visitor won't
      // reach this template at all — this branch is a safety fallback
      // for while that restriction isn't configured yet.
      mount(left, el('p', 'sh-eyebrow', 'Members only'));
      titleEl = el('h1', 'sh-wip-title', 'Log in to continue');
      mount(left, titleEl);
      genreEl = el('p', 'sh-wip-genre', '');
      mount(left, genreEl);
      resumeBtn = document.createElement('a');
      resumeBtn.className = 'sh-resume-btn';
      resumeBtn.href = WP_USER.loginUrl;
      resumeBtn.textContent = 'Log in \u2192';
    } else if (!WP_USER.hasMembership) {
      // Logged in, but no active membership on this account — e.g. a WP
      // account exists without a completed/active PMPro membership.
      mount(left, el('p', 'sh-eyebrow', 'Account found'));
      titleEl = el('h1', 'sh-wip-title', 'No active membership yet');
      mount(left, titleEl);
      genreEl = el('p', 'sh-wip-genre', '');
      mount(left, genreEl);
      resumeBtn = el('button', 'sh-resume-btn', 'Resume excavating \u2192');
      resumeBtn.type = 'button';
      resumeBtn.disabled = true;
    } else {
      mount(left, el('p', 'sh-eyebrow', 'You are currently excavating'));
      titleEl = el('h1', 'sh-wip-title', 'Loading\u2026');
      mount(left, titleEl);
      genreEl = el('p', 'sh-wip-genre', '');
      mount(left, genreEl);
      resumeBtn = el('button', 'sh-resume-btn', 'Resume excavating \u2192');
      resumeBtn.type = 'button';
      resumeBtn.disabled = true; // enabled once Coach destination exists — see NAV_LINKS.coach TODO
      resumeBtn.addEventListener('click', function () {
        if (NAV_LINKS.coach && NAV_LINKS.coach !== '#') window.location.href = NAV_LINKS.coach;
      });
    }

    mount(heroRow, left);
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

    // stratum-identity.js owns resolution + broadcasting (sync global +
    // event, so dashboard.js and any other consumer never race this) —
    // this call either returns already-settled instantly, or queues the
    // callback until the in-flight /resolve-identity call finishes.
    window.StratumIdentity.init(function (studentId) {
      if (!WP_USER.loggedIn || !WP_USER.hasMembership) return; // titleEl/genreEl only exist in the active-member branch above
      fetchWipSummary(studentId, function (summary) {
        if (summary && summary.wipTitle) {
          titleEl.textContent = summary.wipTitle;
          genreEl.textContent = summary.genre || '';
        } else {
          titleEl.textContent = 'No WIP on file yet';
          genreEl.textContent = 'Add your WIP details to get started';
        }
      });
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
