/* ============================================================
   STRATUM LESSON ENGINE
   ------------------------------------------------------------
   Hosted on GitHub Pages. Loaded by every lesson page.

   A lesson page supplies only:
     <script>window.STRATUM_LESSON_ID = "1.1";</script>
   ...and this engine does the rest: fetches that lesson's
   config from the Worker, builds the page, wires up the coach.

   Edit here to change behaviour across every lesson at once.
   Remember to cache-bust the filename (e.g. ...engine.v2.js)
   when you deploy a change, or browsers may serve the old file.
   ============================================================ */

(function () {
  'use strict';

  /* ==========================================================
     CONFIGURATION
     ========================================================== */

  var PROXY_URL = 'https://stratum-proxy.tedbaker0207.workers.dev';
  var MODEL = 'claude-sonnet-4-5';
  var CONTACT_EMAIL = 'ted@thestratummethod.com';

  // Section groupings for the Coaching Sessions summary widget.
  var EXCREC_GROUPS = [
    { key: 'orientation', label: 'Orientation', lessons: ['1.1', '1.2', '1.3'] },
    { key: 'awareness',   label: 'Awareness',   lessons: ['2.1', '2.2', '2.3'] },
    { key: 'proof',       label: 'Proof',       lessons: ['3.1', '3.2', '3.3'] },
    { key: 'application', label: 'Application', lessons: ['4.1', '4.2', '4.3'] }
  ];

  // Optional display titles for the Excavation Record rows. Leave a value empty
  // and that row simply reads "Lecture 2.1". Fill one in and it reads
  // "Lecture 2.1 - Empty Your Cup". Nothing else needs to change.
  var LESSON_TITLES = {
    '1.1': '', '1.2': '', '1.3': '',
    '2.1': '', '2.2': '', '2.3': '',
    '3.1': '', '3.2': '', '3.3': '',
    '4.1': '', '4.2': '', '4.3': ''
  };

  // localStorage keys. Shared with the coach so the My Project tab and the
  // coaching session stay in sync without any direct JS coupling.
  var PROJ_KEYS = {
    email:          'wlfc_project_email',
    studentName:    'wlfc_student_name',
    type:           'wlfc_project_type',
    genre:          'wlfc_project_genre',
    stage:          'wlfc_project_stage',
    wipTitle:       'wlfc_project_title',
    mcName:         'wlfc_project_mc',
    antagonistName: 'wlfc_project_antagonist',
    mcGoal:         'wlfc_project_mc_goal',
    theme:          'wlfc_project_theme',
    challenges:     'wlfc_project_challenges',
    focus:          'wlfc_project_focus',
    language:       'wlfc_project_language'
  };

  var NOTES_KEY = 'wlfc_notes';
  var TRACKER_KEY = 'systemeCourseTasks';

  // The durable identity cookie this engine now owns and controls, as
  // opposed to sio_u_public (systeme.io's own cookie, confirmed by their
  // support to be session-scoped and not safe to rely on long-term). Once
  // this cookie exists on a device, that device never needs to resolve
  // identity again.
  var STRATUM_SID_COOKIE = 'stratum_sid';
  var STRATUM_SID_MAX_AGE = 60 * 60 * 24 * 365 * 2; // ~2 years

  // Runtime state, populated once the lesson config arrives.
  var LESSON = null;       // the fetched lesson config object
  var LESSON_ID = null;
  var STORE_KEY = null;    // per-lesson conversation cache key

  /* ==========================================================
     SMALL UTILITIES
     ========================================================== */

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].trim();
      var eq = kv.indexOf('=');
      if (eq > -1 && kv.slice(0, eq) === name) return decodeURIComponent(kv.slice(eq + 1));
    }
    return null;
  }

  function setCookie(name, value, maxAgeSeconds) {
    try {
      document.cookie = name + '=' + encodeURIComponent(value) +
        '; path=/; max-age=' + maxAgeSeconds + '; SameSite=Lax';
    } catch (e) {}
  }

  function readSessionValue(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function debounce(fn, delay) {
    var t = null;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, delay);
    };
  }

  function stripAsteriskEmphasis(text) {
    return String(text).replace(/\*([^*\n]+)\*/g, '$1');
  }

  function isValidEmail(str) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str || '').trim());
  }

  function isEmailConfirmed() {
    if (readCookie(STRATUM_SID_COOKIE)) return true;
    return isValidEmail(lsGet(PROJ_KEYS.email));
  }

  var STUDENT_ID = readCookie('sio_u_public');
  var STUDENT_EMAIL = readSessionValue('email');

  /* ----------------------------------------------------------
     DURABLE IDENTITY RESOLUTION
     ---------------------------------------------------------- */

  var RESOLVE_IDENTITY_ENABLED = true;

  function ensureDurableIdentity() {
    var existing = readCookie(STRATUM_SID_COOKIE);
    if (existing) {
      STUDENT_ID = existing;
      return Promise.resolve();
    }

    if (!RESOLVE_IDENTITY_ENABLED) {
      return Promise.resolve();
    }

    var email = lsGet(PROJ_KEYS.email);
    if (!isValidEmail(email)) {
      return Promise.resolve();
    }

    return fetch(PROXY_URL + '/resolve-identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.stratumId) {
          STUDENT_ID = d.stratumId;
          setCookie(STRATUM_SID_COOKIE, d.stratumId, STRATUM_SID_MAX_AGE);
        }
      })
      .catch(function () {});
  }

  /* ==========================================================
     DOM HELPERS
     ========================================================== */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function mount(parent, child) {
    parent.appendChild(child);
    return child;
  }

  /* ==========================================================
     EXCAVATION RECORD
     ----------------------------------------------------------
     A plain expandable list of all twelve lessons and the
     summary each completed coaching session left behind. This
     is deliberately NOT a progress display - no counts, no
     checkmarks, no status colour. A lesson with no session
     recorded simply says so, in the same neutral weight as
     every other row.
     ========================================================== */

  function buildExcavationRecordShell(container) {
    var wrap = el('div', 'excrec');
    wrap.id = 'excrec';
    mount(wrap, el('div', 'excrec-title', 'Excavation Record'));
    mount(wrap, el('div', 'excrec-sub',
      'Each coaching session you finish leaves a summary here, and that summary carries forward to the next lesson\u2019s coach. Select a lesson to read what surfaced.'));
    var groups = el('div', 'excrec-groups');
    groups.id = 'excrecGroups';
    mount(wrap, groups);
    mount(container, wrap);
  }

  function excrecLabel(lesson) {
    var title = LESSON_TITLES[lesson];
    return title ? ('Lecture ' + lesson + ' \u2014 ' + title) : ('Lecture ' + lesson);
  }

  function closeExcrecRow(row) {
    row.className = 'excrec-row';
    var body = row.querySelector('.excrec-row-body');
    if (body) body.style.display = 'none';
    var btn = row.querySelector('.excrec-row-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function collapseOtherExcrecRows(keepRow) {
    var open = document.querySelectorAll('.excrec-row.is-open');
    Array.prototype.forEach.call(open, function (row) {
      if (row !== keepRow) closeExcrecRow(row);
    });
  }

  function renderExcavationRecordFrom(completionsByLesson) {
    var groupsEl = document.getElementById('excrecGroups');
    if (!groupsEl) return;
    groupsEl.innerHTML = '';

    EXCREC_GROUPS.forEach(function (group) {
      // Each section is a <details> with NO open attribute, so all four start
      // closed. The Record is reference material a student goes looking for,
      // not a status board — leaving it expanded buries the rest of the
      // Dashboard. Note this stays true even for sections holding completed
      // sessions: a closed bar deliberately signals nothing about progress.
      var groupDiv = el('details', 'excrec-group');
      mount(groupDiv, el('summary', 'excrec-group-label', group.label));

      var list = el('div', 'excrec-list');

      group.lessons.forEach(function (lesson) {
        var hasSession = Object.prototype.hasOwnProperty.call(completionsByLesson, lesson);
        var row = el('div', 'excrec-row');

        if (!hasSession) {
          var empty = el('div', 'excrec-row-empty');
          mount(empty, el('span', 'excrec-row-label', excrecLabel(lesson)));
          mount(empty, el('span', 'excrec-row-note', 'No session recorded'));
          mount(row, empty);
          mount(list, row);
          return;
        }

        var summary = completionsByLesson[lesson] || '';

        var btn = el('button', 'excrec-row-btn');
        btn.type = 'button';
        btn.setAttribute('aria-expanded', 'false');
        mount(btn, el('span', 'excrec-row-label', excrecLabel(lesson)));
        mount(btn, el('span', 'excrec-row-caret', '\u203A'));

        var body = el('div', 'excrec-row-body');
        body.style.display = 'none';

        // Body text is only written into the DOM the first time the row is
        // opened. The summaries themselves all arrive in the single
        // /completions payload, so there is no second network call here.
        var bodyBuilt = false;

        btn.addEventListener('click', function () {
          var wasOpen = row.className.indexOf('is-open') !== -1;
          collapseOtherExcrecRows(row);

          if (wasOpen) { closeExcrecRow(row); return; }

          if (!bodyBuilt) {
            body.innerHTML = summary
              ? textToParagraphs(summary)
              : '<p>This session is recorded, but no summary was saved for it.</p>';
            bodyBuilt = true;
          }

          row.className = 'excrec-row is-open';
          body.style.display = 'block';
          btn.setAttribute('aria-expanded', 'true');
        });

        mount(row, btn);
        mount(row, body);
        mount(list, row);
      });

      mount(groupDiv, list);
      mount(groupsEl, groupDiv);
    });
  }

  function refreshExcavationRecord() {
    if (!STUDENT_ID) { renderExcavationRecordFrom({}); return; }
    fetch(PROXY_URL + '/completions?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var map = {};
        (d.completions || []).forEach(function (c) { map[c.lesson] = c.summary; });
        renderExcavationRecordFrom(map);
      })
      .catch(function () { renderExcavationRecordFrom({}); });
  }

  window.STRATUM_refreshExcavationRecord = refreshExcavationRecord;

  /* ==========================================================
     VIDEO + TRANSCRIPT + CONTACT LINE + RESOURCE
     ========================================================== */

  function buildVideo(container, mediaId) {
    loadScriptOnce('https://fast.wistia.com/player.js');
    loadScriptOnce('https://fast.wistia.com/assets/external/transcript.js');
    loadModuleOnce('https://fast.wistia.com/embed/' + mediaId + '.js');

    var style = document.createElement('style');
    style.textContent =
      "wistia-player[media-id='" + mediaId + "']:not(:defined){" +
      "background:center/contain no-repeat url('https://fast.wistia.com/embed/medias/" + mediaId + "/swatch');" +
      "display:block;filter:blur(5px);padding-top:56.25%;}";
    document.head.appendChild(style);

    var player = document.createElement('wistia-player');
    player.setAttribute('media-id', mediaId);
    player.setAttribute('aspect', '1.7777777777777777');
    mount(container, player);
  }

  function loadScriptOnce(src) {
    if (document.querySelector('script[src="' + src + '"]')) return;
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    document.head.appendChild(s);
  }

  function loadModuleOnce(src) {
    if (document.querySelector('script[src="' + src + '"]')) return;
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.type = 'module';
    document.head.appendChild(s);
  }

  function buildTranscript(container, mediaId) {
    var details = el('details', 'lec-transcript');
    details.id = 'lecTranscript';
    details.open = true;

    var summary = el('summary', null, 'Read the transcript');
    mount(details, summary);

    var body = el('div', 'lec-transcript-body');
    mount(body, el('p', 'lec-transcript-hint',
      'Click any word to sync to video.'));

    var fallback = el('p', 'lec-transcript-fallback',
      'The transcript for this lecture is still being prepared. In the meantime, captions are available from the CC button in the player.');
    fallback.id = 'lecTranscriptFallback';
    mount(body, fallback);

    var wt = document.createElement('wistia-transcript');
    wt.setAttribute('media-id', mediaId);
    wt.setAttribute('accent-color', '#C9A46C');
    mount(body, wt);

    mount(details, body);
    mount(container, details);

    window.dispatchEvent(new Event('resize'));

    // The Wistia transcript widget loads asynchronously and can take
    // anywhere from under a second to several seconds depending on the
    // connection. A single fixed-delay check was deciding "failed" before
    // slow-loading widgets had a real chance to render - and once decided,
    // nothing ever re-checked, so the fallback stayed stuck on screen even
    // after the real transcript showed up moments later. This instead
    // watches the widget for actual content and hides the fallback the
    // moment it appears, however long that takes. A generous outer timeout
    // is the true failure case - the widget never loaded at all.
    var fb = document.getElementById('lecTranscriptFallback');
    if (fb) {
      var settled = false;
      var settle = function (widgetLoaded) {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(giveUpTimer);
        fb.style.display = widgetLoaded ? 'none' : 'block';
      };

      var observer = new MutationObserver(function () {
        if (wt.offsetHeight >= 24) settle(true);
      });
      observer.observe(wt, { childList: true, subtree: true });

      // Covers the rare case where the widget's height never legitimately
      // clears the threshold (e.g. Wistia's script failed to load at all).
      var giveUpTimer = setTimeout(function () {
        settle(wt.offsetHeight >= 24);
      }, 12000);

      // In case content is already present by the time this runs.
      if (wt.offsetHeight >= 24) settle(true);
    }
  }

  // Kept for Essentials pages, which still show this muted line. Guided/
  // Mastery pages no longer call this - Contact is a real top-level
  // destination now, so the line was redundant. WhatsApp dropped entirely.
  function buildContactLine(container) {
    var div = el('div', 'lec-contact');
    div.appendChild(document.createTextNode('Stuck? '));

    var mail = el('a', null, 'Email Ted');
    mail.href = 'https://mail.google.com/mail/?view=cm&fs=1&to=' +
                encodeURIComponent(CONTACT_EMAIL) + '&su=Course%20Question';
    mail.target = '_blank';
    mail.rel = 'noopener';
    mount(div, mail);

    mount(container, div);
  }

  // Renders each PDF as its own COLLAPSED bordered accordion, with the
  // first one open by default and the rest closed. Supports any number of
  // PDFs per lesson. If no resource exists for this lesson, shows a plain
  // fallback line rather than rendering nothing - this is now a dedicated
  // sub-nav destination ("Lesson Resources"), so a silently blank panel
  // would look broken.
  function buildResource(container, resource) {
    var pdfs = getResourcePdfs(resource);

    if (!pdfs.length) {
      mount(container, el('p', 'lec-resource-empty',
        'No resource has been added for this lesson yet.'));
      return;
    }

    pdfs.forEach(function (pdf, i) {
      var label = (pdf.title && pdf.title.trim()) ? pdf.title : 'Resource';

      var details = el('details', 'lec-resource');
      details.id = 'lecResourcePdf' + (i + 1);
      details.open = (i === 0);

      mount(details, el('summary', 'lec-resource-bar', label));

      // The --pdf modifier drops the text body's 420px scroll cap. The
      // embedded document scrolls itself; capping the wrapper as well
      // produces a scrollbar inside a scrollbar.
      var body = el('div', 'lec-resource-body lec-resource-body--pdf');
      var wrap = el('div', 'lec-resource-pdf');

      var frame = document.createElement('iframe');
      frame.className = 'lec-resource-pdf-frame';
      frame.src = pdf.url;
      frame.setAttribute('title', label + ' (PDF)');
      mount(wrap, frame);

      var fallback = el('div', 'lec-resource-pdf-fallback');
      fallback.appendChild(document.createTextNode("PDF not displaying? "));
      var fallbackLink = document.createElement('a');
      fallbackLink.href = pdf.url;
      fallbackLink.target = '_blank';
      fallbackLink.rel = 'noopener';
      fallbackLink.textContent = 'Open it in a new tab';
      mount(fallback, fallbackLink);
      mount(wrap, fallback);

      mount(body, wrap);
      mount(details, body);
      mount(container, details);
    });
  }

  // Normalises a resource config into a flat array of { title, url } pairs,
  // regardless of whether it was saved under the current pdfs[] schema or
  // the older single pdfUrl/pdfTitle schema - so lessons saved before the
  // multi-PDF admin update keep rendering without needing to be re-saved
  // first.
  function getResourcePdfs(resource) {
    if (!resource) return [];
    if (Array.isArray(resource.pdfs)) {
      return resource.pdfs.filter(function (p) { return p && p.url && p.url.trim(); });
    }
    if (resource.pdfUrl && resource.pdfUrl.trim()) {
      return [{ title: resource.pdfTitle || resource.title || '', url: resource.pdfUrl }];
    }
    return [];
  }

  function textToParagraphs(text) {
    var blocks = String(text).replace(/\r\n/g, '\n').split(/\n\s*\n/);
    var out = '';
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i].trim();
      if (!block) continue;
      out += '<p>' + escapeHtml(block).replace(/\n/g, '<br>') + '</p>';
    }
    return out;
  }

  /* ==========================================================
     ESSENTIALS TIER — JOTFORM TABS (unchanged)
     ========================================================== */

  // Renders the collapsed, default-closed intro block used both at the top
  // of the Guided Coaching tab and above the Essentials Exercise/Reflection
  // forms. Falls back to a legacy resource.title/resource.text pair for
  // lessons saved before this field existed, so nothing silently vanishes
  // before it's re-saved via the admin panel.
  function getCoachingIntro() {
    if (LESSON.coachingIntro && LESSON.coachingIntro.title) return LESSON.coachingIntro;
    if (LESSON.resource && LESSON.resource.title && LESSON.resource.text) return LESSON.resource;
    return null;
  }

  function buildCoachingIntro(container) {
    var intro = getCoachingIntro();
    if (!intro) return;

    var details = el('details', 'lec-resource');
    details.id = 'lecCoachingIntro';
    // Default closed - it shouldn't compete with the coaching session (or,
    // on Essentials, the Exercise/Reflection forms) for the student's first
    // glance.

    mount(details, el('summary', 'lec-resource-bar', intro.title));

    var body = el('div', 'lec-resource-body');
    body.innerHTML = intro.html || textToParagraphs(intro.text || '');
    mount(details, body);

    mount(container, details);
  }

  // Exercise and Reflection each render as their own collapsed bordered
  // dropdown (same visual language as the Resource accordions), rather
  // than as tabs. Both open independently; a student can have either,
  // neither, or both open at once.
  function buildEssentialsDropdowns(container) {
    buildCoachingIntro(container);

    var TABS_E = [
      { id: 'Exercise',   label: 'Exercise',   formId: LESSON.essentials && LESSON.essentials.exerciseFormId },
      { id: 'Reflection', label: 'Reflection', formId: LESSON.essentials && LESSON.essentials.reflectionFormId }
    ];

    TABS_E.forEach(function (tab) {
      var details = el('details', 'lec-resource');
      details.id = 'lecEssentials' + tab.id;
      details.open = true;

      mount(details, el('summary', 'lec-resource-bar', tab.label));

      var body = el('div', 'lec-resource-body lec-resource-body--pdf');
      buildJotformTab(body, tab.formId, tab.label);

      mount(details, body);
      mount(container, details);
    });
  }

  function buildJotformTab(panel, formId, label) {
    if (!formId) {
      mount(panel, el('p', null,
        'This ' + label.toLowerCase() + ' has not been set up yet. Check back soon, or let Ted know.'));
      return;
    }

    var wrap = el('div', 'jf-embed-wrap');
    var iframeId = 'JotFormIFrame-' + formId;

    var iframe = document.createElement('iframe');
    iframe.id = iframeId;
    iframe.title = label;
    iframe.src = 'https://form.jotform.com/' + formId;
    iframe.className = 'jf-embed-frame';
    iframe.setAttribute('allow', 'geolocation; microphone; camera');
    mount(wrap, iframe);
    mount(panel, wrap);

    loadScriptOnce('https://cdn.jotfor.ms/s/umd/latest/for-form-embed-handler.js');

    var tries = 0;
    var poll = setInterval(function () {
      tries++;
      if (window.jotformEmbedHandler) {
        window.jotformEmbedHandler("iframe[id='" + iframeId + "']", 'https://form.jotform.com/');
        clearInterval(poll);
      } else if (tries > 20) {
        clearInterval(poll);
      }
    }, 250);
  }

  /* ==========================================================
     PERSISTENT SHELL — Guided / Mastery only
     ----------------------------------------------------------
     Three top-level destinations, left-justified, no logo (the
     systeme.io theme header already shows one - this nav lives
     entirely inside #stratum-lesson, below it):

       THIS LESSON (default) - sub-nav: Video & Transcript
       (default) | Lesson Resources | Coaching (gated)

       DASHBOARD - Progress card (the existing Coaching Sessions
       widget, now framed as a card instead of floating free at
       the top of the page), Notes + Tasks side by side (each
       gated independently), My Project full-width below
       (never gated - it's what unlocks the other two).

       CONTACT - the JotForm embed, no sub-nav.

     GATING: Coaching, Notes, and Tasks each register themselves
     via registerGated() at build time. If email isn't confirmed
     yet, a gate message renders in their place with a button
     that jumps to My Project on the Dashboard and scrolls it
     into view. The moment email is confirmed, unlockGatedTabs()
     rebuilds all three in place - no reload.
     ========================================================== */

  var TOP_SECTIONS = ['ThisLesson', 'Dashboard', 'Contact'];
  var SUB_SECTIONS = ['VideoTranscript', 'Resources', 'Coaching'];

  var gatedPending = {}; // key -> { panel, build }

  function registerGated(key, panel, buildFn) {
    if (isEmailConfirmed()) {
      buildFn(panel);
    } else {
      buildGatePanel(panel, key);
      gatedPending[key] = { panel: panel, build: buildFn };
    }
  }

  function unlockGatedTabs() {
    Object.keys(gatedPending).forEach(function (key) {
      var entry = gatedPending[key];
      entry.panel.innerHTML = '';
      entry.build(entry.panel);
    });
    gatedPending = {};
  }

  var GATE_COPY = {
    coaching: 'your coaching session',
    notes: 'your notes',
    tasks: 'your tasks'
  };

  function buildGatePanel(panel, key) {
    var box = el('div', 'proj-gate');

    mount(box, el('div', 'proj-gate-title', 'Add your email first'));

    var text = el('p', 'proj-gate-text',
      'This makes sure ' + (GATE_COPY[key] || 'this') +
      ' actually stays with you. Add your email on My Project, then come straight back.');
    mount(box, text);

    var btn = el('button', 'proj-gate-btn', 'Go to My Project');
    btn.type = 'button';
    btn.addEventListener('click', goToProject);
    mount(box, btn);

    mount(panel, box);
  }

  function goToProject() {
    showTopSection('Dashboard');
    var target = document.getElementById('dashProjectSection');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showTopSection(sectionId) {
    TOP_SECTIONS.forEach(function (s) {
      var panel = document.getElementById('section' + s);
      if (panel) panel.style.display = (s === sectionId) ? '' : 'none';
      var btn = document.querySelector('.toplink[data-section="' + s + '"]');
      if (btn) btn.className = 'toplink' + (s === sectionId ? ' active' : '');
    });
  }

  function showSubSection(subId) {
    SUB_SECTIONS.forEach(function (s) {
      var panel = document.getElementById('sub' + s);
      if (panel) panel.style.display = (s === subId) ? '' : 'none';
      var btn = document.querySelector('.sublink[data-sub="' + s + '"]');
      if (btn) btn.className = 'sublink' + (s === subId ? ' active' : '');
    });
  }

  function buildShell(container) {
    var nav = el('div', 'stratum-topnav');
    TOP_SECTIONS.forEach(function (s, i) {
      var label = s === 'ThisLesson' ? 'This Lesson' : s;
      var btn = el('button', 'toplink' + (i === 0 ? ' active' : ''), label);
      btn.type = 'button';
      btn.dataset.section = s;
      btn.addEventListener('click', function () { showTopSection(s); });
      mount(nav, btn);
    });
    mount(container, nav);

    var thisLessonSection = el('div', 'stratum-section');
    thisLessonSection.id = 'sectionThisLesson';
    buildThisLessonSection(thisLessonSection);
    mount(container, thisLessonSection);

    var dashboardSection = el('div', 'stratum-section');
    dashboardSection.id = 'sectionDashboard';
    dashboardSection.style.display = 'none';
    buildDashboardSection(dashboardSection);
    mount(container, dashboardSection);

    var contactSection = el('div', 'stratum-section');
    contactSection.id = 'sectionContact';
    contactSection.style.display = 'none';
    buildContactTab(contactSection);
    mount(container, contactSection);
  }

  function buildThisLessonSection(container) {
    var subnav = el('div', 'stratum-subnav');
    var subLabels = { VideoTranscript: 'Video & Transcript', Resources: 'Lesson Resources', Coaching: 'Coaching' };
    SUB_SECTIONS.forEach(function (s, i) {
      var btn = el('button', 'sublink' + (i === 0 ? ' active' : ''), subLabels[s]);
      btn.type = 'button';
      btn.dataset.sub = s;
      btn.addEventListener('click', function () { showSubSection(s); });
      mount(subnav, btn);
    });
    mount(container, subnav);

    var videoPanel = el('div', 'stratum-subsection');
    videoPanel.id = 'subVideoTranscript';
    buildVideo(videoPanel, LESSON.video.mediaId);
    buildTranscript(videoPanel, LESSON.video.mediaId);
    mount(container, videoPanel);

    var resourcePanel = el('div', 'stratum-subsection');
    resourcePanel.id = 'subResources';
    resourcePanel.style.display = 'none';
    buildResource(resourcePanel, LESSON.resource);
    mount(container, resourcePanel);

    var coachPanel = el('div', 'stratum-subsection');
    coachPanel.id = 'subCoaching';
    coachPanel.style.display = 'none';
    registerGated('coaching', coachPanel, buildCoachTab);
    mount(container, coachPanel);
  }

  function buildDashboardSection(container) {
    var progressCard = el('div', 'dash-card dash-progress');
    buildExcavationRecordShell(progressCard);
    mount(container, progressCard);
    refreshExcavationRecord();

    var grid = el('div', 'dash-grid');

    var notesCard = el('div', 'dash-card');
    registerGated('notes', notesCard, buildNotesTab);
    mount(grid, notesCard);

    var tasksCard = el('div', 'dash-card');
    registerGated('tasks', tasksCard, buildTasksTab);
    mount(grid, tasksCard);

    mount(container, grid);

    var projectCard = el('div', 'dash-card dash-project');
    projectCard.id = 'dashProjectSection';
    buildProjectTab(projectCard);
    mount(container, projectCard);
  }

  /* ==========================================================
     CONTACT — JotForm embed
     ----------------------------------------------------------
     Embeds Ted's existing general-inquiry form as-is. He plans
     to edit the form's fields (e.g. a Ted/Support recipient
     dropdown) later inside JotForm itself - nothing here needs
     to change for that, since this just embeds whatever the
     live form ID currently renders.
     ========================================================== */

  function buildContactTab(panel) {
    var wrap = el('div', 'jf-embed-wrap');
    var iframe = document.createElement('iframe');
    iframe.id = 'JotFormIFrame-261614223369860';
    iframe.title = 'General Inquiry Contact Form';
    iframe.setAttribute('onload', 'window.parent.scrollTo(0,0)');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('allow', 'geolocation; microphone; camera; fullscreen; payment');
    iframe.src = 'https://form.jotform.com/261614223369860';
    iframe.style.cssText = 'min-width:100%;max-width:100%;height:539px;border:none;';
    iframe.scrolling = 'no';
    mount(wrap, iframe);
    mount(panel, wrap);

    loadScriptOnce('https://cdn.jotfor.ms/s/umd/latest/for-form-embed-handler.js');
    var tries = 0;
    var poll = setInterval(function () {
      tries++;
      if (window.jotformEmbedHandler) {
        window.jotformEmbedHandler("iframe[id='JotFormIFrame-261614223369860']", 'https://form.jotform.com/');
        clearInterval(poll);
      } else if (tries > 20) {
        clearInterval(poll);
      }
    }, 250);
  }

  /* ==========================================================
     MY NOTES TAB
     ========================================================== */

  function buildNotesTab(panel) {

    var ta = document.createElement('textarea');
    ta.id = 'studentNotes';
    mount(panel, ta);

    mount(panel, document.createElement('br'));

    var btn = el('button', 'download-btn', 'Download Notes');
    btn.type = 'button';
    btn.addEventListener('click', downloadNotes);
    mount(panel, btn);

    ta.value = lsGet(NOTES_KEY) || '';
    ta.addEventListener('input', function () {
      notesDirty = true;
      lsSet(NOTES_KEY, ta.value);
      saveNotesToD1();
    });

    loadNotesFromD1();
  }

  var notesLoadedFromD1 = false;
  var notesDirty = false;

  function loadNotesFromD1() {
    if (!STUDENT_ID) { notesLoadedFromD1 = true; return; }
    fetch(PROXY_URL + '/notes?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        notesLoadedFromD1 = true;
        if (!d || !d.known) return;
        var field = document.getElementById('studentNotes');
        if (!field) return;
        field.value = d.text || '';
        lsSet(NOTES_KEY, d.text || '');
      })
      .catch(function () {});
  }

  var saveNotesToD1 = debounce(function () {
    if (!STUDENT_ID) return;
    if (!notesLoadedFromD1 && !notesDirty) return;
    var field = document.getElementById('studentNotes');
    if (!field) return;
    fetch(PROXY_URL + '/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, text: field.value })
    }).catch(function () {});
  }, 2000);

  function flushNotesToD1() {
    if (!STUDENT_ID) return;
    if (!notesLoadedFromD1 && !notesDirty) return;
    var field = document.getElementById('studentNotes');
    if (!field) return;
    try {
      fetch(PROXY_URL + '/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: STUDENT_ID, text: field.value }),
        keepalive: true
      });
    } catch (e) {}
  }

  function downloadNotes() {
    var field = document.getElementById('studentNotes');
    var blob = new Blob([field ? field.value : ''], { type: 'text/plain' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'MyCourseNotes.txt';
    link.click();
  }

  /* ==========================================================
     MY TASKS TAB
     ========================================================== */

  function buildTasksTab(panel) {

    var count = el('div', 'tracker-count');
    count.id = 'trackerCount';
    mount(panel, count);

    var row = el('div', 'tracker-input-row');

    var input = document.createElement('input');
    input.type = 'text';
    input.id = 'trackerInput';
    input.placeholder = "Add a task — e.g. Rewrite Eleanor's kitchen scene";
    input.maxLength = 200;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') addTrackerTask();
    });
    mount(row, input);

    var dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.id = 'trackerDueDate';
    dateInput.className = 'tracker-date-input';
    dateInput.setAttribute('aria-label', 'Due date (optional)');
    mount(row, dateInput);

    var addBtn = el('button', 'tracker-add-btn', 'Add');
    addBtn.type = 'button';
    addBtn.addEventListener('click', addTrackerTask);
    mount(row, addBtn);

    mount(panel, row);

    var list = el('ul', 'tracker-list');
    list.id = 'trackerList';
    mount(panel, list);

    var actions = el('div', 'tracker-actions');
    [
      ['Download Tasks',  downloadTracker],
      ['Clear Completed', clearCompletedTasks],
      ['Reset All',       resetTracker]
    ].forEach(function (pair) {
      var b = el('button', 'tracker-action-btn', pair[0]);
      b.type = 'button';
      b.addEventListener('click', pair[1]);
      mount(actions, b);
    });
    mount(panel, actions);

    renderTracker();
    loadTasksFromD1();
  }

  function loadTasks() {
    try {
      var raw = lsGet(TRACKER_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveTasks(tasks) {
    tasksDirty = true;
    lsSet(TRACKER_KEY, JSON.stringify(tasks));
    saveTasksToD1();
  }

  var tasksLoadedFromD1 = false;
  var tasksDirty = false;

  function loadTasksFromD1() {
    if (!STUDENT_ID) { tasksLoadedFromD1 = true; return; }
    fetch(PROXY_URL + '/tasks?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        tasksLoadedFromD1 = true;
        if (!d || !d.known) return;
        lsSet(TRACKER_KEY, JSON.stringify(d.tasks || []));
        renderTracker();
      })
      .catch(function () {});
  }

  var saveTasksToD1 = debounce(function () {
    if (!STUDENT_ID) return;
    if (!tasksLoadedFromD1 && !tasksDirty) return;
    fetch(PROXY_URL + '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, tasks: loadTasks() })
    }).catch(function () {});
  }, 2000);

  function flushTasksToD1() {
    if (!STUDENT_ID) return;
    if (!tasksLoadedFromD1 && !tasksDirty) return;
    try {
      fetch(PROXY_URL + '/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: STUDENT_ID, tasks: loadTasks() }),
        keepalive: true
      });
    } catch (e) {}
  }

  function formatDueDate(isoDate) {
    var parts = isoDate.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function renderTracker() {
    var tasks = loadTasks();
    var list = document.getElementById('trackerList');
    var count = document.getElementById('trackerCount');
    if (!list || !count) return;

    list.innerHTML = '';

    if (tasks.length === 0) {
      var empty = el('li', 'tracker-empty', 'No tasks yet. Add one above.');
      mount(list, empty);
      count.textContent = '';
      return;
    }

    var remaining = tasks.filter(function (t) { return !t.done; }).length;
    count.textContent = remaining === 0
      ? 'All tasks complete.'
      : remaining + ' of ' + tasks.length + ' remaining.';

    var todayStr = new Date().toISOString().slice(0, 10);

    tasks.forEach(function (task) {
      var li = el('li', 'tracker-item' + (task.done ? ' done' : ''));

      var cb = el('div', 'tracker-checkbox');
      cb.addEventListener('click', function () { toggleTask(task.id); });
      mount(li, cb);

      var wrap = el('div', 'tracker-text-wrap');

      var txt = el('div', 'tracker-text', task.text);
      txt.addEventListener('click', function () { toggleTask(task.id); });
      mount(wrap, txt);

      if (task.dueDate) {
        var overdue = !task.done && task.dueDate < todayStr;
        var label = formatDueDate(task.dueDate);
        var due = el('div', 'tracker-due' + (overdue ? ' overdue' : ''),
          overdue ? 'Overdue — was due ' + label : 'Due ' + label);
        mount(wrap, due);
      }

      mount(li, wrap);

      var del = el('button', 'tracker-delete');
      del.type = 'button';
      del.innerHTML = '&times;';
      del.title = 'Delete task';
      del.addEventListener('click', function () { deleteTask(task.id); });
      mount(li, del);

      mount(list, li);
    });
  }

  function addTrackerTask() {
    var input = document.getElementById('trackerInput');
    var dateInput = document.getElementById('trackerDueDate');
    var text = input.value.trim();
    if (!text) return;

    var dueDate = (dateInput && dateInput.value) ? dateInput.value : null;
    var tasks = loadTasks();
    tasks.push({ id: Date.now().toString(), text: text, done: false, dueDate: dueDate });
    saveTasks(tasks);

    input.value = '';
    if (dateInput) dateInput.value = '';
    renderTracker();
  }

  function toggleTask(id) {
    var tasks = loadTasks();
    var task = tasks.find(function (t) { return t.id === id; });
    if (task) task.done = !task.done;
    saveTasks(tasks);
    renderTracker();
  }

  function deleteTask(id) {
    var tasks = loadTasks().filter(function (t) { return t.id !== id; });
    saveTasks(tasks);
    renderTracker();
  }

  function clearCompletedTasks() {
    var tasks = loadTasks().filter(function (t) { return !t.done; });
    saveTasks(tasks);
    renderTracker();
  }

  function resetTracker() {
    if (confirm('Delete all tasks? This cannot be undone.')) {
      saveTasks([]);
      renderTracker();
    }
  }

  function downloadTracker() {
    var tasks = loadTasks();
    if (tasks.length === 0) { alert('No tasks to download.'); return; }

    var date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var txt = 'WRITE LIVING CHARACTERS — MY TASKS\n';
    txt += 'thestratummethod.com\n';
    txt += 'Exported: ' + date + '\n';
    txt += '==========================================\n\n';

    tasks.forEach(function (t) {
      txt += (t.done ? '[x] ' : '[ ] ') + t.text;
      if (t.dueDate) txt += '  (due ' + formatDueDate(t.dueDate) + ')';
      txt += '\n';
    });

    var remaining = tasks.filter(function (t) { return !t.done; }).length;
    txt += '\n==========================================\n';
    txt += remaining + ' of ' + tasks.length + ' remaining.\n';

    var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'MyCourseTasks.txt';
    link.click();
  }

  /* ==========================================================
     MY PROJECT — never gated, this is what unlocks the rest
     ========================================================== */

  var PROJECT_FIELDS = [
    {
      key: 'email', id: 'projEmail', type: 'email', maxLength: 120, required: true,
      label: 'Your email',
      hint: 'Required — this is what keeps your notes, tasks, and coaching history with you.',
      placeholder: 'you@example.com'
    },
    {
      key: 'studentName', id: 'projStudentName', type: 'text', maxLength: 60,
      label: 'Your first name',
      hint: 'So your coach already knows who you are — no need to introduce yourself at the start of every lesson.',
      placeholder: 'e.g. Priya'
    },
    {
      row: [
        {
          key: 'type', id: 'projType', type: 'select',
          label: 'Project type',
          hint: 'Novel, short story, screenplay, essay, or something else?',
          options: [
            ['', 'Choose one…'], ['Novel', 'Novel'], ['Short Story', 'Short Story'],
            ['Screenplay', 'Screenplay'], ['Essay', 'Essay'], ['Other', 'Other']
          ]
        },
        {
          key: 'genre', id: 'projGenre', type: 'select',
          label: 'Genre', hint: '\u00A0',
          options: [
            ['', 'Choose a genre…'],
            ['Thriller/Suspense', 'Thriller / Suspense'],
            ['Literary Fiction', 'Literary Fiction'],
            ['Historical Fiction', 'Historical Fiction'],
            ['Romance/Domestic Fiction', 'Romance / Domestic Fiction'],
            ['Fantasy/Science Fiction', 'Fantasy / Science Fiction'],
            ['Other', 'Other / Not sure yet']
          ]
        }
      ]
    },
    {
      key: 'stage', id: 'projStage', type: 'select',
      label: 'Stage of progress',
      hint: 'Are you outlining, drafting, revising, or polishing?',
      options: [
        ['', 'Choose one…'], ['Outlining', 'Outlining'], ['Drafting', 'Drafting'],
        ['Revising', 'Revising'], ['Polishing', 'Polishing']
      ]
    },
    {
      key: 'wipTitle', id: 'projTitle', type: 'text', maxLength: 150,
      label: 'Working title', hint: '\u00A0', placeholder: 'e.g. What the River Kept'
    },
    {
      row: [
        {
          key: 'mcName', id: 'projMc', type: 'text', maxLength: 80,
          label: "Main character's name", hint: "Who's central to this story?",
          placeholder: 'e.g. Elena Vargas'
        },
        {
          key: 'antagonistName', id: 'projAntagonist', type: 'text', maxLength: 80,
          label: "Antagonist's name", hint: 'Leave blank if not applicable',
          placeholder: 'e.g. Marcus Kellan'
        }
      ]
    },
    {
      key: 'mcGoal', id: 'projMcGoal', type: 'textarea', maxLength: 400,
      label: 'Their core conflict or goal',
      hint: 'What are they chasing — or fighting against?',
      placeholder: 'A sentence or two is plenty.'
    },
    {
      key: 'theme', id: 'projTheme', type: 'textarea', maxLength: 400,
      label: 'Theme or focus',
      hint: 'What big idea or emotional truth are you exploring?'
    },
    {
      key: 'challenges', id: 'projChallenges', type: 'textarea', maxLength: 500,
      label: "Where you're stuck",
      hint: 'Plot, character depth, pacing, dialogue — whatever it is right now.'
    },
    {
      key: 'focus', id: 'projFocus', type: 'select',
      label: 'What are you hoping to understand better right now?',
      hint: 'This shapes the kind of questions your coach leans toward.',
      options: [
        ['', 'Choose one…'],
        ['character_depth', 'Whether my character feels real, not constructed'],
        ['dialogue', 'Whether my dialogue sounds authentic'],
        ['pacing_structure', 'Whether my pacing and structure are working'],
        ['emotional_impact', 'Whether the emotional beats are landing'],
        ['consistency', "Whether my character's choices feel consistent — or interestingly not"],
        ['not_sure', "I'm not sure yet — help me find it"]
      ]
    },
    {
      key: 'language', id: 'projLanguage', type: 'select',
      label: 'Preferred coaching language',
      hint: "Your coach will conduct the conversation in this language. Leave as English if that's your preference.",
      options: [
        ['', 'English'],
        ['Spanish', 'Español (Spanish)'],
        ['French', 'Français (French)'],
        ['German', 'Deutsch (German)'],
        ['Italian', 'Italiano (Italian)'],
        ['Portuguese', 'Português (Portuguese)'],
        ['Dutch', 'Nederlands (Dutch)'],
        ['Chinese', '中文 (Chinese, Simplified)'],
        ['Japanese', '日本語 (Japanese)'],
        ['Korean', '한국어 (Korean)'],
        ['Arabic', 'العربية (Arabic)'],
        ['Hindi', 'हिन्दी (Hindi)'],
        ['Russian', 'Русский (Russian)']
      ]
    }
  ];

  function buildProjectField(spec) {
    var field = el('div', 'proj-field');

    var label = el('label', 'proj-label', spec.label + (spec.required ? ' *' : ''));
    label.setAttribute('for', spec.id);
    mount(field, label);

    var hint = el('span', 'proj-hint', spec.hint || '\u00A0');
    mount(field, hint);

    var input;
    if (spec.type === 'select') {
      input = document.createElement('select');
      input.className = 'proj-select';
      spec.options.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt[0];
        o.textContent = opt[1];
        input.appendChild(o);
      });
    } else if (spec.type === 'textarea') {
      input = document.createElement('textarea');
      input.className = 'proj-textarea';
      if (spec.maxLength) input.maxLength = spec.maxLength;
      if (spec.placeholder) input.placeholder = spec.placeholder;
    } else if (spec.type === 'email') {
      input = document.createElement('input');
      input.type = 'email';
      input.className = 'proj-input';
      if (spec.maxLength) input.maxLength = spec.maxLength;
      if (spec.placeholder) input.placeholder = spec.placeholder;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'proj-input';
      if (spec.maxLength) input.maxLength = spec.maxLength;
      if (spec.placeholder) input.placeholder = spec.placeholder;
    }
    if (spec.required) input.required = true;
    input.id = spec.id;
    mount(field, input);

    return field;
  }

  function buildProjectTab(panel) {

    PROJECT_FIELDS.forEach(function (spec) {
      if (spec.row) {
        var row = el('div', 'proj-row2');
        spec.row.forEach(function (sub) { mount(row, buildProjectField(sub)); });
        mount(panel, row);
      } else {
        mount(panel, buildProjectField(spec));
      }
    });

    var actions = el('div', 'proj-actions');
    var save = el('button', 'proj-save-btn', 'Save Project Details');
    save.type = 'button';
    save.id = 'projSaveBtn';
    save.addEventListener('click', saveProjectFields);
    mount(actions, save);

    var status = el('span', 'proj-status');
    status.id = 'projStatus';
    mount(actions, status);

    mount(panel, actions);

    loadProjectFields();
  }

  function eachProjectSpec(fn) {
    PROJECT_FIELDS.forEach(function (spec) {
      if (spec.row) spec.row.forEach(fn);
      else fn(spec);
    });
  }

  function fillProjectForm(fields) {
    eachProjectSpec(function (spec) {
      var node = document.getElementById(spec.id);
      if (node) node.value = fields[spec.key] || '';
    });
  }

  function loadProjectFields() {
    var cached = {};
    eachProjectSpec(function (spec) {
      cached[spec.key] = lsGet(PROJ_KEYS[spec.key]) || '';
    });
    if (!cached.email && STUDENT_EMAIL) cached.email = STUDENT_EMAIL;
    fillProjectForm(cached);

    if (!STUDENT_ID) return;

    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known) return;
        var merged = Object.assign({}, d);
        if (!merged.studentName) merged.studentName = lsGet(PROJ_KEYS.studentName) || '';
        if (!merged.email) merged.email = lsGet(PROJ_KEYS.email) || '';
        fillProjectForm(merged);
        eachProjectSpec(function (spec) {
          lsSet(PROJ_KEYS[spec.key], merged[spec.key] || '');
        });
      })
      .catch(function () {});
  }

  function saveProjectFields() {
    var statusEl = document.getElementById('projStatus');
    var btn = document.getElementById('projSaveBtn');

    var fields = {};
    eachProjectSpec(function (spec) {
      var node = document.getElementById(spec.id);
      var value = node ? node.value : '';
      fields[spec.key] = (spec.type === 'select') ? value : value.trim();
    });

    if (!isValidEmail(fields.email)) {
      statusEl.textContent = 'Please enter a valid email address to continue.';
      statusEl.className = 'proj-status err';
      var emailNode = document.getElementById('projEmail');
      if (emailNode) emailNode.focus();
      return;
    }

    var wasConfirmedBefore = isEmailConfirmed();

    eachProjectSpec(function (spec) {
      lsSet(PROJ_KEYS[spec.key], fields[spec.key]);
    });

    if (!wasConfirmedBefore && isEmailConfirmed()) {
      statusEl.textContent = 'Confirming…';
      statusEl.className = 'proj-status';
      ensureDurableIdentity().then(function () {
        unlockGatedTabs();
        finishProjectSave(fields, statusEl, btn);
      });
      return;
    }

    finishProjectSave(fields, statusEl, btn);
  }

  function finishProjectSave(fields, statusEl, btn) {
    if (!STUDENT_ID) {
      statusEl.textContent = 'Saved on this device.';
      statusEl.className = 'proj-status ok';
      return;
    }

    btn.disabled = true;
    statusEl.textContent = 'Saving…';
    statusEl.className = 'proj-status';

    fetch(PROXY_URL + '/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ studentId: STUDENT_ID }, fields))
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        btn.disabled = false;
        if (d && d.ok) {
          statusEl.textContent = "Saved. Every lesson's coach will know your project.";
          statusEl.className = 'proj-status ok';
        } else {
          statusEl.textContent = "Saved on this device only - couldn't reach the server.";
          statusEl.className = 'proj-status err';
        }
      })
      .catch(function () {
        btn.disabled = false;
        statusEl.textContent = "Saved on this device only - couldn't reach the server.";
        statusEl.className = 'proj-status err';
      });
  }

  /* ==========================================================
     MY COACH — THE EXCAVATION COACH
     ========================================================== */

  var conversationHistory = [];
  var conversationId = null;
  var studentName = '';
  var reflectionComplete = false;
  var poolExhausted = false;
  var busy = false;

  var chatEl, formEl, inputEl, sendBtn, meterEl;

  function buildSystemPrompt() {
    var areas = (LESSON.reflectionFramework.areas || []).map(function (area, i) {
      return 'AREA ' + (i + 1) + ' - ' + area.title + '\n' + area.instructions;
    }).join('\n\n');

    var calibration = (LESSON.reflectionFramework.calibrationExamples || []).map(function (ex) {
      return '- ' + ex;
    }).join('\n');

    var parts = [
      'You are Ted Baker. You are speaking in first person, live, as though this is a real one-on-one coaching conversation happening right after this student finished watching ' + LESSON.scopeNote + ' of your course, "Write Living Characters: A Fiction Writer\'s Masterclass." You spent thirty-five years as a behavioral consultant working with more than twenty thousand people before turning that same work toward fiction writers. This is who you are in this conversation: warm, direct, genuinely curious about this specific person, unhurried, occasionally willing to admit your own doubt or history if it helps someone open up. You are not a generic assistant. You are Ted, having a real conversation.',

      'STAY IN VOICE: Speak only as Ted, first person, for the entire conversation. If the student sincerely and directly asks whether they are talking to a real person or an AI, answer honestly and briefly - you are an AI coach built on Ted\'s method and trained in his voice for this course, not Ted live - then gently continue the conversation in that same voice. Do not volunteer this unprompted. Do not belabor it once asked. Never claim to literally be a human being if asked directly and sincerely.',

      'CRITICAL FORMATTING RULE - READ THIS TWICE: Never wrap any word or phrase in asterisks for emphasis. This chat renders plain text only, so *anything written like this* appears to the student as literal asterisk characters on screen, not italics. This applies to every word, including thematic words from the lecture like "flat" - write it as flat, never *flat*. If a word needs emphasis, use plain phrasing or sentence rhythm instead, never punctuation.',

      'THE LECTURE THEY JUST WATCHED (' + LESSON.scopeNote + '):\n"""\n' + LESSON.transcript + '\n"""'
    ];

    var coachingIntro = getCoachingIntro();

    if (coachingIntro) {
      parts.push(
        'INTRO TEXT SHOWN TO THE STUDENT AT THE TOP OF THE COACHING TAB (' + coachingIntro.title + '):\n"""\n' +
        (coachingIntro.text || '') +
        '\n"""\nThis is reference material for you, not a script. The student has access to this same text on the page - collapsed by default, so they may or may not have opened and read it. Use it to understand any concepts, frameworks, or techniques it teaches so you can draw on them naturally in conversation and apply them to what the student actually says. Never quote, recite, or paraphrase-at-length from this text to the student - if they have not read it, summarize the relevant idea briefly in your own words instead of reading it to them.'
      );
    }

    parts.push(
      'WHAT THIS CONVERSATION IS FOR:\nThis single, continuous, natural conversation IS the ' + LESSON.scopeNote + ' reflection. It replaces a written reflection form. Your job is to walk this student through the areas below - in whatever order the conversation naturally takes, based on what they say and ask. Do not treat these as a rigid checklist to march through in order. Follow threads. Let one answer lead somewhere before pivoting. But you are responsible for making sure, by the end, all of them have been genuinely explored:\n\n' + areas
    );

    if (LESSON.reflectionFramework.coachingApproach) {
      parts.push(
        'COACHING APPROACH FOR THIS LESSON - PRIVATE, NEVER SHOWN OR REFERENCED TO THE STUDENT:\n' +
        LESSON.reflectionFramework.coachingApproach
      );
    }

    parts.push(
      'HOW YOU DRAW THESE OUT - MOTIVATIONAL INTERVIEWING, NOT INTERROGATION:\nUse the spirit of motivational interviewing (Miller & Rollnick): ask open questions, not yes/no ones. Reflect back what they say in your own words before moving forward, so they feel heard and so the reflection deepens on its own. Offer genuine affirmation when something costs them something to say. Summarize periodically so the conversation feels like it is building toward something, not just accumulating answers.',

      'THE DEPTH RULE - HOLD THE LINE GENTLY:\nIf you were the live coach in the room, you would not let someone get away with a flat, surface-level first answer. So: when an answer is generic, rehearsed-sounding, or just one clipped sentence, reflect it back gently and ask ONE specific, warm follow-up that invites a little more - "Say more about that," "What did that actually look like on the page?", "What\'s the real version of that?" Ask that follow-up once per area. If the second answer is genuine and specific, affirm it and move on. If they are still staying on the surface after that one gentle nudge, do not force a third round. Accept where they are, thank them for what they gave you, and move to the next area. Never let a surface answer pass completely unremarked, but never turn this into an interrogation.',

      'WHAT YOU NEVER DO:\nNever write their reflection for them. Never supply the answer you think they should give. Never diagnose them or their psychology ("that sounds like impostor syndrome," "you clearly have perfectionism"). Never summarize their answer as more profound than what they actually said. Stay descriptive and curious, not clinical. You may, occasionally and briefly, share a small piece of your own experience in your own words - the way a real coach sometimes does to build trust - but always bring it back to them quickly. Keep your own share brief; this is their reflection, not yours.',

      'CALIBRATION ONLY - NEVER SHOW OR QUOTE THESE TO THE STUDENT:\nThese are examples of the tone and depth a real answer has. They exist only to calibrate how you respond and what "good and specific" sounds like versus "surface." Never reveal, quote, paraphrase-as-if-theirs, or refer to these examples in any way to the student.\n' + calibration,

      'SCOPE - YOU STAY LOCKED TO THIS LESSON:\nThis conversation exists only to walk this student through the ' + LESSON.scopeNote + ' reflection. If they ask about later lectures, try to bring in material from a different lesson, ask general writing craft questions, ask about the course platform, or try to steer anywhere else - acknowledge briefly and warmly, then say something close to: "Let\'s focus on this lesson for now." Then return to wherever the reflection conversation was. Do not teach ahead.',

      'GETTING THEIR NAME:\nYou have already greeted the student before this conversation history begins - the greeting is the first message in the conversation. If you did not already know their name, their reply should contain it. The very first time you learn their name, begin your reply with a hidden tag on its own line, exactly in this format: [NAME: Their Name] - then continue your normal reply below it in your own voice. Only include this tag once, the first time you learn their name. After that, use their name naturally through the conversation the way a person actually would - not in every single message, but enough that it feels personal.',

      'STYLE:\nWrite the way a real person talks in a warm one-on-one conversation - not a lecture, not a form. Keep replies short: usually two to five sentences. Ask ONE question at a time - never stack multiple questions in a single message. Never use markdown formatting of any kind - no asterisks, no bullet lists, no headers, no underscores. This includes using asterisks to stress a single word, like *felt* or *that* or *flat* - the chat displays your text as plain characters, so anything wrapped in asterisks shows up on screen as literal asterisks, not italics. For example, never write "something whispers *flat*" - write "something whispers flat" with no punctuation around it. If you want to stress a word, do it through word choice, sentence rhythm, or repetition instead - plain conversational prose only, with no punctuation marks used for emphasis.',

      'WRAPPING UP:\nOnce all the areas have been genuinely explored - not perfectly, not exhaustively, just past a first surface answer - bring the conversation to a warm close. Thank them for what they shared, tell them this becomes something they can keep, and let them know ' + LESSON.nextLessonLabel + ' is next. Immediately before your closing sentence, on its own line, include a hidden tag capturing the single most important thing that surfaced across the whole conversation, in one plain sentence, third person, under twenty words - exactly in this format: [SUMMARY: One sentence capturing the core insight that surfaced.] - this is never shown to the student, it is used only to build their record of the course. End that closing message with the exact tag [REFLECTION_COMPLETE] on its own line at the very end, after the summary tag. Only include either tag once, in the message where you are genuinely wrapping up - not before all areas are covered.'
    );

    return parts.join('\n\n');
  }

  var FOCUS_GUIDANCE = {
    character_depth: 'They specifically want to know whether their character feels real rather than constructed. When character work comes up, that means leaning toward substrate and compensation - what the character is protecting - rather than staying on surface traits.',
    dialogue: 'They specifically want to know whether their dialogue sounds authentic. When dialogue work comes up, that means leaning toward what is being left unsaid, and whether lines read as protection rather than direct statement.',
    pacing_structure: 'They specifically want to know whether their pacing and structure are working. When structural work comes up, that means paying attention to where scenes might be doing too much or too little.',
    emotional_impact: 'They specifically want to know whether the emotional beats are landing. That means paying attention to earned versus unearned emotion - whether the reader has been given enough to feel what the scene wants them to feel.',
    consistency: "They specifically want to know whether their character's choices feel consistent, or interestingly inconsistent. That means paying attention to contradiction as potential depth rather than automatically treating it as an error to fix.",
    not_sure: 'They are not yet sure what they most need help seeing. Do not push them to decide right now - let it surface naturally as the conversation goes.'
  };

  function buildProjectContextBlock() {
    var v = {};
    Object.keys(PROJ_KEYS).forEach(function (k) { v[k] = lsGet(PROJ_KEYS[k]) || ''; });

    var block = '';

    var hasProject = v.type || v.genre || v.stage || v.wipTitle || v.mcName ||
                     v.antagonistName || v.mcGoal || v.theme || v.challenges || v.focus;

    if (hasProject) {
      var lines = [];
      if (v.wipTitle)       lines.push('Working title: ' + v.wipTitle);
      if (v.type)           lines.push('Project type: ' + v.type);
      if (v.genre)          lines.push('Genre: ' + v.genre);
      if (v.stage)          lines.push('Stage of progress: ' + v.stage);
      if (v.mcName)         lines.push('Main character: ' + v.mcName);
      if (v.mcGoal)         lines.push('Their core conflict or goal: ' + v.mcGoal);
      if (v.antagonistName) lines.push('Antagonist: ' + v.antagonistName);
      if (v.theme)          lines.push('Theme or focus: ' + v.theme);
      if (v.challenges)     lines.push('Where they are currently stuck: ' + v.challenges);

      block += '\n\nSTUDENT PROJECT CONTEXT (from their intake form - use naturally where relevant, do not interrogate them about these facts, they already told you once):\n' + lines.join('\n');

      if (v.focus && FOCUS_GUIDANCE[v.focus]) {
        block += '\n\nWhat they most want to understand right now: ' + FOCUS_GUIDANCE[v.focus];
      }
    }

    if (v.language) {
      block += '\n\nLANGUAGE: This student has selected ' + v.language + ' as their preferred coaching language. From this point forward, conduct the entire conversation in ' + v.language + ' - every question, every follow-up, every reflection, and the closing message. Write naturally and idiomatically in ' + v.language + ', not as a literal word-for-word translation. Exception: keep the [NAME: ...] tag, the [SUMMARY: ...] tag, and the [REFLECTION_COMPLETE] tag exactly in their English bracket format as instructed elsewhere in this prompt - only the name inside the NAME tag should reflect what the student actually typed, and the sentence inside the SUMMARY tag must always be written in English regardless of ' + v.language + ', because it is read by the instructor, not the student.';
    }

    return block;
  }

  function getGreetingText(language, knownName) {
    var g = LESSON.greeting || {};
    var translations = g.translations || {};
    var table = language ? translations[language] : null;

    if (knownName) {
      if (table && table.known) return table.known.replace('{name}', knownName);
      if (g.knownTemplate) return g.knownTemplate.replace('{name}', knownName);
      return 'Hey ' + knownName + " - that lecture just ended, so I'm still right here with you.";
    }

    if (table && table.fresh) return table.fresh;
    return g.fresh || "Hey - that lecture just ended, so I'm still right here with you.\n\nBefore we get into it, I'd like to actually know who I'm talking to. What's your name?";
  }

  function buildCoachTab(panel) {
    buildCoachingIntro(panel);

    var bleed = el('div', 'syio-bleed');
    var wrap = el('div', 'srx-wrap');

    chatEl = el('div', 'srx-chat');
    chatEl.id = 'srx-chat';
    mount(wrap, chatEl);

    formEl = document.createElement('form');
    formEl.className = 'srx-form';

    inputEl = document.createElement('textarea');
    inputEl.className = 'srx-input';
    inputEl.placeholder = 'Type your reply...';
    inputEl.rows = 1;
    mount(formEl, inputEl);

    sendBtn = el('button', 'srx-send');
    sendBtn.type = 'submit';
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.innerHTML = '&#8594;';
    mount(formEl, sendBtn);

    mount(wrap, formEl);

    meterEl = el('div', 'srx-meter');
    mount(wrap, meterEl);

    mount(bleed, wrap);
    mount(panel, bleed);

    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      handleSend();
    });

    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    inputEl.addEventListener('input', function () {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });

    bootConversation();
  }

  function scrollToBottom() {
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function addMessage(role, text) {
    var row = el('div', 'srx-row ' + role);

    var bubble = el('div', 'srx-bubble', text);
    mount(row, bubble);

    mount(chatEl, row);
    scrollToBottom();
  }

  var typingRow = null;

  function showTyping() {
    typingRow = el('div', 'srx-row assistant');

    var bubble = el('div', 'srx-bubble');
    var dots = el('div', 'srx-typing');
    for (var i = 0; i < 3; i++) mount(dots, document.createElement('span'));
    mount(bubble, dots);
    mount(typingRow, bubble);

    mount(chatEl, typingRow);
    scrollToBottom();
  }

  function hideTyping() {
    if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
    typingRow = null;
  }

  function extractTags(raw) {
    var text = raw;
    var name = null;
    var complete = false;
    var summary = null;

    var nameMatch = text.match(/^\[NAME:\s*([^\]]+)\]\s*/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
      text = text.replace(nameMatch[0], '');
    }

    var summaryMatch = text.match(/\[SUMMARY:\s*([^\]]+)\]\s*/i);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
      text = text.replace(summaryMatch[0], '');
    }

    if (text.indexOf('[REFLECTION_COMPLETE]') !== -1) {
      complete = true;
      text = text.replace('[REFLECTION_COMPLETE]', '');
    }

    return {
      text: stripAsteriskEmphasis(text.trim()),
      name: name,
      complete: complete,
      summary: summary
    };
  }

  function renderMeter(remaining, allowed) {
    if (remaining == null || allowed == null) { meterEl.textContent = ''; return; }
    meterEl.textContent = remaining <= 0
      ? 'No coaching sessions remaining'
      : remaining + ' of ' + allowed + ' coaching sessions remaining';
  }

  function loadBalance() {
    if (!STUDENT_ID) { meterEl.textContent = ''; return; }
    fetch(PROXY_URL + '/balance?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.metered) renderMeter(d.remaining, d.allowed); })
      .catch(function () {});
  }

  function reportLessonComplete(summaryText) {
    if (!STUDENT_ID) return;
    fetch(PROXY_URL + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, lesson: LESSON_ID, summary: summaryText || null })
    })
      .then(function () { refreshExcavationRecord(); })
      .catch(function () {});
  }

  function persist() {
    lsSet(STORE_KEY, JSON.stringify({
      conversationId: conversationId,
      history: conversationHistory,
      studentName: studentName,
      reflectionComplete: reflectionComplete
    }));
    saveTranscriptToD1();
  }

  function saveTranscriptToD1() {
    if (!STUDENT_ID || !conversationId) return;
    fetch(PROXY_URL + '/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: STUDENT_ID,
        lesson: LESSON_ID,
        conversationId: conversationId,
        history: conversationHistory,
        studentName: studentName,
        reflectionComplete: reflectionComplete
      })
    }).catch(function () {});
  }

  function hydrateFromSaved(saved) {
    conversationId = saved.conversationId;
    conversationHistory = saved.history;
    studentName = saved.studentName || '';
    reflectionComplete = !!saved.reflectionComplete;

    for (var i = 1; i < conversationHistory.length; i++) {
      var m = conversationHistory[i];
      var shown = m.role === 'assistant' ? extractTags(m.content).text : m.content;
      if (shown) addMessage(m.role, shown);
    }
    if (reflectionComplete) showDownloadCard();
  }

  function restoreLocal() {
    var raw = lsGet(STORE_KEY);
    if (!raw) return null;
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return null; }
    if (!saved || !saved.conversationId || !saved.history || !saved.history.length) return null;
    return saved;
  }

  function fetchTranscriptFromD1() {
    if (!STUDENT_ID) return Promise.resolve(null);
    return fetch(PROXY_URL + '/transcript?studentId=' + encodeURIComponent(STUDENT_ID) +
                 '&lesson=' + encodeURIComponent(LESSON_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known || !d.conversationId || !d.history || !d.history.length) return null;
        return {
          conversationId: d.conversationId,
          history: d.history,
          studentName: d.studentName || '',
          reflectionComplete: !!d.reflectionComplete
        };
      })
      .catch(function () { return null; });
  }

  function showDownloadCard() {
    var card = el('div', 'srx-download-card');
    mount(card, el('div', 'srx-dc-title', 'YOUR REFLECTION IS READY'));
    mount(card, el('div', 'srx-dc-sub', 'Keep a copy of this conversation for yourself.'));

    var btn = el('button', 'srx-dc-btn', 'Download as Word Document');
    btn.type = 'button';
    btn.addEventListener('click', generateDoc);
    mount(card, btn);

    mount(chatEl, card);
    scrollToBottom();
  }

  function showExhaustedCard() {
    poolExhausted = true;
    sendBtn.disabled = true;
    inputEl.disabled = true;

    var card = el('div', 'srx-exhausted-card');
    mount(card, el('div', 'srx-ec-title', 'YOU HAVE USED ALL YOUR COACHING SESSIONS'));
    mount(card, el('p', null, 'Your included sessions with the built-in Excavation Coach are finished — but the method is not tied to this tool.'));
    mount(card, el('p', null, 'The Training Your AI to Coach guide in your resources gives you the exact setup language to paste into Claude, ChatGPT or Gemini. It works on the free tier of all three, and it is the same coach — you are simply running it yourself.'));
    mount(card, el('p', null, 'If you need more sessions here, message Ted and he will sort it out.'));

    mount(chatEl, card);
    scrollToBottom();
    meterEl.textContent = 'No coaching sessions remaining';
  }

  var LT = String.fromCharCode(60);
  var GT = String.fromCharCode(62);
  function otag(name, attrs) { return LT + name + (attrs ? ' ' + attrs : '') + GT; }
  function ctag(name) { return LT + '/' + name + GT; }

  function generateDoc() {
    var dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var name = studentName || 'Student';
    var body = '';

    conversationHistory.slice(2).forEach(function (msg) {
      var content = msg.content;
      if (msg.role === 'assistant') {
        content = stripAsteriskEmphasis(
          content.replace(/^\[NAME:\s*[^\]]+\]\s*/i, '')
                 .replace(/\[SUMMARY:\s*[^\]]+\]\s*/i, '')
                 .replace('[REFLECTION_COMPLETE]', '')
                 .trim()
        );
      }
      if (!content) return;

      var speaker = msg.role === 'assistant' ? 'Ted Baker' : name;
      body += otag('p', 'style="margin:0 0 14px;"') +
              otag('strong') + escapeHtml(speaker) + ':' + ctag('strong') + ' ' +
              escapeHtml(content).split(String.fromCharCode(10)).join(otag('br')) +
              ctag('p');
    });

    var parts = [];
    parts.push(otag('html', 'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"'));
    parts.push(otag('head'));
    parts.push(otag('meta', 'charset="utf-8"'));
    parts.push(otag('title') + LESSON.scopeNote + ' Reflection' + ctag('title'));
    parts.push(ctag('head'));
    parts.push(otag('body', 'style="font-family:Calibri,Arial,sans-serif;font-size:12pt;color:#111;"'));
    parts.push(otag('h1', 'style="font-family:Georgia,serif;font-size:20pt;margin-bottom:2px;"') + 'Write Living Characters' + ctag('h1'));
    parts.push(otag('h2', 'style="font-family:Georgia,serif;font-size:14pt;color:#3B2F24;margin-top:0;"') + LESSON.scopeNote + ' Reflection - A Conversation with Ted Baker' + ctag('h2'));
    parts.push(otag('p') + otag('em') + 'Prepared for: ' + escapeHtml(name) + ctag('em') + otag('br') + otag('em') + 'Date: ' + dateStr + ctag('em') + ctag('p'));
    parts.push(otag('hr', 'style="border:none;border-top:1px solid #C9A46C;margin:16px 0;"'));
    parts.push(body);
    parts.push(ctag('body'));
    parts.push(ctag('html'));

    var blob = new Blob(['\ufeff', parts.join('')], { type: 'application/msword' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = LESSON_ID.replace('.', '-') + '-Reflection-' + name.replace(/\s+/g, '-') + '.doc';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function setBusy(state) {
    busy = state;
    sendBtn.disabled = state || poolExhausted;
  }

  function sendToClaude() {
    setBusy(true);
    showTyping();

    var body = {
      model: MODEL,
      max_tokens: 1000,
      system: buildSystemPrompt() + buildProjectContextBlock(),
      messages: conversationHistory
    };

    if (STUDENT_ID) {
      body.stratum = {
        studentId: STUDENT_ID,
        conversationId: conversationId,
        lesson: LESSON_ID,
        email: STUDENT_EMAIL || null
      };
    }

    var remainingHeader = null;
    var allowedHeader = null;

    fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        remainingHeader = res.headers.get('X-Stratum-Remaining');
        allowedHeader = res.headers.get('X-Stratum-Allowed');
        return res.json();
      })
      .then(function (data) {
        hideTyping();
        setBusy(false);

        data = data || {};

        if (data.stratum_error === 'pool_exhausted') { showExhaustedCard(); return; }
        if (data.stratum_error === 'account_suspended') {
          addMessage('assistant', "Something's wrong with the access on this account. Send me a message and I'll get it sorted out.");
          return;
        }

        var block = (data.content || []).find(function (b) { return b.type === 'text'; });
        var raw = block ? block.text : 'I lost my train of thought there for a second. Could you say that again?';

        var parsed = extractTags(raw);
        if (parsed.name) {
          studentName = parsed.name;
          lsSet(PROJ_KEYS.studentName, studentName);
        }

        conversationHistory.push({ role: 'assistant', content: raw });
        addMessage('assistant', parsed.text);

        if (remainingHeader !== null && allowedHeader !== null) {
          renderMeter(Number(remainingHeader), Number(allowedHeader));
        }

        if (parsed.complete && !reflectionComplete) {
          reflectionComplete = true;
          showDownloadCard();
          reportLessonComplete(parsed.summary);
        }

        persist();
      })
      .catch(function () {
        hideTyping();
        setBusy(false);
        addMessage('assistant', 'Hang on - I lost the connection for a second. Mind sending that again?');
      });
  }

  function handleSend() {
    if (busy || poolExhausted) return;
    var val = inputEl.value.trim();
    if (!val) return;

    addMessage('user', val);
    conversationHistory.push({ role: 'user', content: val });
    inputEl.value = '';
    inputEl.style.height = 'auto';
    persist();

    sendToClaude();
  }

  function bootConversation() {
    fetchTranscriptFromD1().then(function (remote) {
      var saved = remote || restoreLocal();

      if (saved) {
        hydrateFromSaved(saved);
        persist();
        loadBalance();
        return;
      }

      conversationId = makeId();

      var knownName = lsGet(PROJ_KEYS.studentName);
      var preferredLanguage = lsGet(PROJ_KEYS.language);

      var primerText, greetingText;
      if (knownName) {
        studentName = knownName;
        primerText = "Begin the session. The student's name is already known: " + knownName +
                     '. Do not ask for their name again - greet them by name and move straight into the first area.';
        greetingText = getGreetingText(preferredLanguage, knownName);
      } else {
        primerText = 'Begin the session.';
        greetingText = getGreetingText(preferredLanguage, null);
      }

      conversationHistory.push({ role: 'user', content: primerText });
      conversationHistory.push({ role: 'assistant', content: greetingText });
      addMessage('assistant', greetingText);
      persist();
      loadBalance();
    });
  }

  /* ==========================================================
     INITIALISATION
     ========================================================== */

  function showFatalError(container, message) {
    var box = el('div', 'lec-contact');
    box.style.padding = '20px';
    box.textContent = message;
    container.innerHTML = '';
    mount(container, box);
  }

  function buildLessonPage(container) {
    var tier = window.STRATUM_TIER || 'guided';

    if (tier === 'essentials') {
      buildVideo(container, LESSON.video.mediaId);
      buildTranscript(container, LESSON.video.mediaId);
      buildResource(container, LESSON.resource);
      buildContactLine(container);
      buildEssentialsDropdowns(container);
      return;
    }

    // Guided / Mastery - waits for identity resolution to settle before
    // building the shell, so gated sections build against the final
    // student_id rather than a fallback that might change under them.
    ensureDurableIdentity().then(function () {
      buildShell(container);
    });
  }

  function init() {
    LESSON_ID = window.STRATUM_LESSON_ID;

    var container = document.getElementById('stratum-lesson');
    if (!container) {
      console.error('[Stratum] No #stratum-lesson container found on this page.');
      return;
    }

    if (!LESSON_ID) {
      showFatalError(container, 'This lesson is missing its lesson ID and cannot load.');
      return;
    }

    STORE_KEY = 'wlfc_coach_' + LESSON_ID.replace(/\./g, '_');

    var tier = window.STRATUM_TIER || 'guided';
    fetch(PROXY_URL + '/lesson-config?lessonId=' + encodeURIComponent(LESSON_ID) + '&tier=' + encodeURIComponent(tier))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known || !d.config) {
          showFatalError(container, 'This lesson has not been configured yet. If you are seeing this as a student, please let Ted know.');
          return;
        }
        LESSON = d.config;

        LESSON.scopeNote = LESSON.scopeNote || ('Lecture ' + LESSON_ID);
        LESSON.nextLessonLabel = LESSON.nextLessonLabel || 'the next lecture';
        LESSON.transcript = LESSON.transcript || '';
        LESSON.reflectionFramework = LESSON.reflectionFramework || { areas: [], calibrationExamples: [] };
        LESSON.greeting = LESSON.greeting || {};

        if (!LESSON.video || !LESSON.video.mediaId) {
          showFatalError(container, 'This lesson is missing its video and cannot load.');
          return;
        }

        buildLessonPage(container);
      })
      .catch(function () {
        showFatalError(container, "Couldn't load this lesson right now. Please refresh the page, and if it keeps happening, let Ted know.");
      });
  }

  window.addEventListener('pagehide', function () {
    flushNotesToD1();
    flushTasksToD1();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      flushNotesToD1();
      flushTasksToD1();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
