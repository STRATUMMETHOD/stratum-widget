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
  var CONTACT_WHATSAPP = 'https://wa.me/50684192287';

  // localStorage keys. Shared with the coach so the My Project tab and the
  // coaching session stay in sync without any direct JS coupling.
  var PROJ_KEYS = {
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

  var STRATUM_SID_COOKIE = 'stratum_sid';
  var STRATUM_SID_MAX_AGE = 60 * 60 * 24 * 365 * 2; // ~2 years

  var LESSON = null;
  var LESSON_ID = null;
  var TIER = 'guided';
  var STORE_KEY = null;

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
    document.cookie = name + '=' + encodeURIComponent(value) +
      '; max-age=' + maxAgeSeconds + '; path=/; SameSite=Lax';
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

  // Every piece of local state (notes, tasks, project fields, per-lesson
  // coaching history) is cached in localStorage keyed only by lesson/field
  // name, never by student. That's fine for the normal case, but if the
  // identity behind stratum_sid ever changes on this browser - a deleted
  // and recreated D1 identity during testing, a shared/reused device, a
  // student manually clearing their cookie - the old identity's cached
  // content would otherwise sit there and get shown to whoever resolves
  // next, until (and unless) a server fetch happens to overwrite it.
  //
  // CACHE_OWNER_KEY records which student the currently-cached local data
  // actually belongs to. Whenever STUDENT_ID is established or changes
  // (page load with an existing cookie, or a fresh /resolve-identity call),
  // clearStaleLocalCache() compares the two and wipes every wlfc_* key
  // (plus the legacy-named task tracker key) if they don't match, before
  // anything is read from or written to local storage for this identity.
  var CACHE_OWNER_KEY = 'wlfc_cache_owner';

  function clearStaleLocalCache(currentId) {
    if (!currentId) return;
    var owner = lsGet(CACHE_OWNER_KEY);
    if (owner && owner !== currentId) {
      try {
        var toRemove = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!k || k === CACHE_OWNER_KEY) continue;
          if (k.indexOf('wlfc_') === 0 || k === TRACKER_KEY) toRemove.push(k);
        }
        toRemove.forEach(function (k) {
          try { localStorage.removeItem(k); } catch (e) {}
        });
      } catch (e) {}
    }
    lsSet(CACHE_OWNER_KEY, currentId);
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

  var STUDENT_ID = readCookie(STRATUM_SID_COOKIE);
  var STUDENT_EMAIL = readSessionValue('email');
  clearStaleLocalCache(STUDENT_ID);

  function isEmailConfirmed() {
    return !!STUDENT_ID;
  }

  // Resolves (or mints) the durable identity behind a given email.
  // Returns a promise resolving to { ok, isNew }. isNew is true only when
  // the Worker minted a brand-new identity row - it's false when this
  // email matched an existing identity (e.g. a returning student
  // reconnecting on a new device).
  function ensureDurableIdentity(email) {
    return fetch(PROXY_URL + '/resolve-identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.stratumId) {
          STUDENT_ID = d.stratumId;
          clearStaleLocalCache(STUDENT_ID);
          STUDENT_EMAIL = email;
          setCookie(STRATUM_SID_COOKIE, STUDENT_ID, STRATUM_SID_MAX_AGE);
          return { ok: true, isNew: !!d.isNew };
        }
        return { ok: false, isNew: false };
      })
      .catch(function () { return { ok: false, isNew: false }; });
  }

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

  function buildTranscript(container, mediaId, startOpen) {
    var details = el('details', 'lec-transcript lec-resource');
    details.id = 'lecTranscript';
    details.open = startOpen !== false;

    var summary = el('summary', 'lec-resource-bar', 'Transcript');
    mount(details, summary);

    var body = el('div', 'lec-transcript-body');
    mount(body, el('p', 'lec-transcript-hint',
      'Click any word to jump straight to that point in the video.'));

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

    details.addEventListener('toggle', function () {
      if (!details.open) return;
      window.dispatchEvent(new Event('resize'));
      setTimeout(function () {
        var t = details.querySelector('wistia-transcript');
        var fb = document.getElementById('lecTranscriptFallback');
        if (!t || !fb) return;
        fb.style.display = (t.offsetHeight < 24) ? 'block' : 'none';
      }, 2500);
    });
  }

  function buildContactLine(container) {
    var div = el('div', 'lec-contact');
    div.appendChild(document.createTextNode('Stuck? '));

    var mail = el('a', null, 'Email Ted');
    mail.href = 'https://mail.google.com/mail/?view=cm&fs=1&to=' +
                encodeURIComponent(CONTACT_EMAIL) + '&su=Course%20Question';
    mail.target = '_blank';
    mail.rel = 'noopener';
    mount(div, mail);

    div.appendChild(document.createTextNode(' \u00B7 '));

    var wa = el('a', null, 'WhatsApp');
    wa.href = CONTACT_WHATSAPP;
    wa.target = '_blank';
    wa.rel = 'noopener';
    mount(div, wa);

    mount(container, div);
  }

  function buildResource(container, resource) {
    if (!resource) return;

    var pdfs = Array.isArray(resource.pdfs) ? resource.pdfs.filter(function (p) { return p && p.title && p.url; }) : [];
    if (pdfs.length) {
      pdfs.forEach(function (pdf, i) {
        var details = el('details', 'lec-resource');
        details.id = 'lecResource' + i;
        mount(details, el('summary', 'lec-resource-bar', pdf.title));

        var body = el('div', 'lec-resource-body lec-resource-body--pdf');

        var iframe = document.createElement('iframe');
        iframe.className = 'lec-resource-pdf-frame';
        iframe.src = pdf.url;
        iframe.title = pdf.title;
        mount(body, iframe);

        var fallback = el('p', 'lec-resource-pdf-fallback');
        fallback.appendChild(document.createTextNode('Having trouble viewing it? '));
        var link = document.createElement('a');
        link.href = pdf.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Open the PDF directly';
        fallback.appendChild(link);
        mount(body, fallback);

        mount(details, body);
        mount(container, details);
      });
      return;
    }

    if (resource.title) {
      var legacyDetails = el('details', 'lec-resource');
      legacyDetails.id = 'lecResource';
      mount(legacyDetails, el('summary', 'lec-resource-bar', resource.title));
      var legacyBody = el('div', 'lec-resource-body');
      legacyBody.innerHTML = resource.html || textToParagraphs(resource.text || '');
      mount(legacyDetails, legacyBody);
      mount(container, legacyDetails);
    }
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

  var SUB_TABS = [
    { id: 'Video',     label: 'Video & Transcript', build: buildVideoTranscriptPanel },
    { id: 'Resources', label: 'Lesson Resources',   build: buildResourcesPanel },
    { id: 'Coaching',  label: 'Coaching',           build: buildCoachTab }
  ];

  function buildVideoTranscriptPanel(panel) {
    buildVideo(panel, LESSON.video.mediaId);
    buildTranscript(panel, LESSON.video.mediaId);
  }

  function buildResourcesPanel(panel) {
    var hasPdfs = LESSON.resource && Array.isArray(LESSON.resource.pdfs) &&
      LESSON.resource.pdfs.some(function (p) { return p && p.title && p.url; });
    var hasLegacy = LESSON.resource && LESSON.resource.title;
    if (!hasPdfs && !hasLegacy) {
      mount(panel, el('p', 'lec-resource-empty', 'This lesson has no additional resources.'));
      return;
    }
    buildResource(panel, LESSON.resource);
  }

  function buildSubNav(container) {
    var bar = el('div', 'stratum-subnav');

    SUB_TABS.forEach(function (tab, index) {
      var btn = el('button', 'sublink', tab.label);
      btn.type = 'button';
      btn.addEventListener('click', function (evt) { openSubTab(evt, tab.id); });
      if (index === 0) btn.id = 'defaultOpen';
      mount(bar, btn);
    });

    mount(container, bar);

    SUB_TABS.forEach(function (tab) {
      var panel = el('div', 'stratum-subsection');
      panel.id = tab.id;
      tab.build(panel);
      mount(container, panel);
    });

    var defaultBtn = document.getElementById('defaultOpen');
    if (defaultBtn) defaultBtn.click();
  }

  function openSubTab(evt, tabName) {
    var panels = document.getElementsByClassName('stratum-subsection');
    for (var i = 0; i < panels.length; i++) panels[i].style.display = 'none';

    var links = document.getElementsByClassName('sublink');
    for (var j = 0; j < links.length; j++) {
      links[j].className = links[j].className.replace(' active', '');
    }

    document.getElementById(tabName).style.display = 'block';
    evt.currentTarget.className += ' active';
  }

  // Order here drives both the tab bar and which view opens by default
  // (index 0). Dashboard first, This Lesson second, Contact last.
  var TOP_DESTINATIONS = [
    { id: 'view-dashboard', label: 'Dashboard',   build: buildDashboardView },
    { id: 'view-lesson',    label: 'This Lesson', build: buildLessonView },
    { id: 'view-contact',   label: 'Contact',     build: buildContactView }
  ];

  function buildTopNav(container) {
    var nav = el('div', 'stratum-topnav');

    TOP_DESTINATIONS.forEach(function (dest, index) {
      var btn = el('button', 'toplink' + (index === 0 ? ' active' : ''), dest.label);
      btn.type = 'button';
      btn.addEventListener('click', function (evt) { showTopView(evt, dest.id); });
      mount(nav, btn);
    });

    mount(container, nav);

    TOP_DESTINATIONS.forEach(function (dest, index) {
      var view = el('div', 'stratum-section');
      view.id = dest.id;
      if (index !== 0) view.style.display = 'none';
      mount(container, view);
      dest.build(view);
    });
  }

  function showTopView(evt, viewId) {
    var views = document.getElementsByClassName('stratum-section');
    for (var i = 0; i < views.length; i++) views[i].style.display = 'none';
    var links = document.getElementsByClassName('toplink');
    for (var j = 0; j < links.length; j++) links[j].className = links[j].className.replace(' active', '');
    document.getElementById(viewId).style.display = 'block';
    evt.currentTarget.className += ' active';
  }

  function buildLessonView(container) {
    buildSubNav(container);
  }

  function buildDashboardView(container) {
    var grid = el('div', 'dash-grid');

    var notesPanel = el('div', 'dash-card');
    notesPanel.id = 'Notes';
    buildNotesTab(notesPanel);
    mount(grid, notesPanel);

    var tasksPanel = el('div', 'dash-card');
    tasksPanel.id = 'Tasks';
    buildTasksTab(tasksPanel);
    mount(grid, tasksPanel);

    mount(container, grid);

    var projectPanel = el('div', 'dash-card dash-project');
    projectPanel.id = 'Project';
    buildProjectTab(projectPanel);
    mount(container, projectPanel);

    // Dashboard is the first thing a student sees (see TOP_DESTINATIONS
    // order below). If no identity is confirmed yet, the modal is
    // mandatory - no close, no dismiss - so it shows every time an
    // unconfirmed visitor reaches Dashboard, full stop.
    if (!isEmailConfirmed()) {
      showIdentityModal();
    }
  }

  function buildJotformEmbed(container, formId, label) {
    if (!formId) return;
    var domId = 'JotFormIFrame-' + formId;
    var wrap = el('div', 'jf-embed-wrap');
    var iframe = document.createElement('iframe');
    iframe.id = domId;
    iframe.title = label || 'Form';
    iframe.src = 'https://form.jotform.com/' + formId;
    iframe.className = 'jf-embed-frame';
    mount(wrap, iframe);
    mount(container, wrap);

    var script = document.createElement('script');
    script.src = 'https://cdn.jotfor.ms/s/umd/latest/for-form-embed-handler.js';
    script.onload = function () {
      if (window.jotformEmbedHandler) {
        window.jotformEmbedHandler("iframe[id='" + domId + "']", 'https://form.jotform.com/');
      }
    };
    document.body.appendChild(script);
  }

  function buildContactView(container) {
    buildJotformEmbed(container, '261614223369860', 'Contact Form');
  }

  function buildEssentialsDropdowns(container) {
    var items = [
      { id: 'Exercise',   label: 'Exercise',   formId: LESSON.essentials && LESSON.essentials.exerciseFormId },
      { id: 'Reflection', label: 'Reflection', formId: LESSON.essentials && LESSON.essentials.reflectionFormId }
    ];

    items.forEach(function (item) {
      if (!item.formId) return;
      var details = el('details', 'lec-resource');
      details.id = 'lecEssentials' + item.id;
      details.open = false;

      mount(details, el('summary', 'lec-resource-bar', item.label));

      var body = el('div', 'lec-resource-body lec-resource-body--pdf');

      if (item.id === 'Reflection') {
        var ci = LESSON.coachingIntro;
        if (ci && ci.text) {
          var introWrap = el('div', 'lec-coaching-intro');
          mount(introWrap, el('div', 'lec-coaching-intro-title', ci.title || 'Before you begin'));
          var introBody = el('div', 'lec-coaching-intro-body');
          introBody.innerHTML = textToParagraphs(ci.text);
          mount(introWrap, introBody);
          mount(introWrap, el('hr', 'lec-coaching-intro-divider'));
          mount(body, introWrap);
        }
      }

      buildJotformEmbed(body, item.formId, item.label);

      mount(details, body);
      mount(container, details);
    });
  }

  function buildEssentialsPage(container) {
    buildVideo(container, LESSON.video.mediaId);
    buildTranscript(container, LESSON.video.mediaId, false);
    buildResource(container, LESSON.resource);
    buildEssentialsDropdowns(container);
  }

  function goToProjectTab() {
    var views = document.getElementsByClassName('stratum-section');
    for (var i = 0; i < views.length; i++) views[i].style.display = 'none';
    var links = document.getElementsByClassName('toplink');
    for (var j = 0; j < links.length; j++) links[j].className = links[j].className.replace(' active', '');
    var dashView = document.getElementById('view-dashboard');
    if (dashView) dashView.style.display = 'block';
    // Dashboard is now the first tab (index 0) - see TOP_DESTINATIONS order.
    if (links[0]) links[0].className += ' active';
    var projectPanel = document.getElementById('Project');
    if (projectPanel && projectPanel.scrollIntoView) {
      projectPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Shown inside Notes / Tasks / Coaching when no identity is confirmed yet
  // - a student would normally already have resolved this via the
  // mandatory Dashboard modal, but this remains as a fallback (e.g. a
  // direct link straight into a sub-tab). My Project (inside Dashboard)
  // is the permanent fallback path.
  function buildIdentityGate(panel, itemLabel) {
    var wrap = el('div', 'proj-gate');
    var title = el('div', 'proj-gate-title', 'Keep your ' + itemLabel);
    mount(wrap, title);
    var msg = el('p', 'proj-gate-text',
      'This makes sure your ' + itemLabel + ' actually stays with you. Add your email in My Project on the Dashboard, then come straight back.');
    mount(wrap, msg);
    var btn = el('button', 'proj-gate-btn', 'Go to My Project');
    btn.type = 'button';
    btn.addEventListener('click', goToProjectTab);
    mount(wrap, btn);
    mount(panel, wrap);
  }

  function refreshGatedTabs() {
    var notesPanel = document.getElementById('Notes');
    if (notesPanel) { notesPanel.innerHTML = ''; buildNotesTab(notesPanel); }
    var tasksPanel = document.getElementById('Tasks');
    if (tasksPanel) { tasksPanel.innerHTML = ''; buildTasksTab(tasksPanel); }
    var coachPanel = document.getElementById('Coaching');
    if (coachPanel) { coachPanel.innerHTML = ''; buildCoachTab(coachPanel); }
  }

  function buildNotesTab(panel) {
    if (!isEmailConfirmed()) { buildIdentityGate(panel, 'notes'); return; }

    mount(panel, el('h3', null, 'Notes'));

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
      lsSet(NOTES_KEY, ta.value);
      saveNotesToD1();
    });

    loadNotesFromD1();
  }

  function loadNotesFromD1() {
    if (!STUDENT_ID) return;
    fetch(PROXY_URL + '/notes?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
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

  function buildTasksTab(panel) {
    if (!isEmailConfirmed()) { buildIdentityGate(panel, 'tasks'); return; }

    mount(panel, el('h3', null, 'Tasks'));

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
    lsSet(TRACKER_KEY, JSON.stringify(tasks));
    saveTasksToD1();
  }

  function loadTasksFromD1() {
    if (!STUDENT_ID) return;
    fetch(PROXY_URL + '/tasks?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known) return;
        lsSet(TRACKER_KEY, JSON.stringify(d.tasks || []));
        renderTracker();
      })
      .catch(function () {});
  }

  var saveTasksToD1 = debounce(function () {
    if (!STUDENT_ID) return;
    fetch(PROXY_URL + '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, tasks: loadTasks() })
    }).catch(function () {});
  }, 2000);

  function flushTasksToD1() {
    if (!STUDENT_ID) return;
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

  var PROJECT_FIELDS = [
    {
      key: 'studentName', id: 'projStudentName', type: 'text', maxLength: 60,
      label: 'Your first name',
      hint: 'So your coach already knows who you are — no need to introduce yourself at the start of every lesson.',
      placeholder: 'e.g. John'
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

    var label = el('label', 'proj-label', spec.label);
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
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'proj-input';
      if (spec.maxLength) input.maxLength = spec.maxLength;
      if (spec.placeholder) input.placeholder = spec.placeholder;
    }
    input.id = spec.id;
    mount(field, input);

    return field;
  }

  function buildEmailField(panel) {
    if (isEmailConfirmed()) return;

    var wrap = el('div', 'proj-field proj-email-field');
    wrap.id = 'projEmailWrap';

    var label = el('label', 'proj-label', 'Your email');
    label.setAttribute('for', 'projEmail');
    mount(wrap, label);
    var hint = el('span', 'proj-hint', 'Required \u2014 this is what keeps your notes, tasks, and coaching history with you.');
    mount(wrap, hint);
    var input = document.createElement('input');
    input.type = 'email';
    input.id = 'projEmail';
    input.className = 'proj-input';
    input.required = true;
    input.placeholder = 'you@example.com';
    mount(wrap, input);

    mount(panel, wrap);
  }

  function buildProjectTab(panel) {
    mount(panel, el('h3', null, 'My Project'));

    var reminder = el('p', null,
      'Complete and save this before using Notes, Tasks, or starting your first coaching session \u2014 that\u2019s what ties everything to you.');
    reminder.style.cssText = 'font-size:13px;font-style:italic;color:#8a7a5e;line-height:1.5;margin:4px 0 18px;';
    mount(panel, reminder);

    var topActions = el('div', 'proj-actions proj-actions-top');
    topActions.style.marginBottom = '28px';
    var topSave = el('button', 'proj-save-btn', 'Save Project Details');
    topSave.type = 'button';
    topSave.id = 'projSaveBtnTop';
    topSave.addEventListener('click', saveProjectFields);
    mount(topActions, topSave);

    var topStatus = el('span', 'proj-status');
    topStatus.id = 'projStatusTop';
    mount(topActions, topStatus);

    mount(panel, topActions);

    buildEmailField(panel);

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
    fillProjectForm(cached);

    if (!STUDENT_ID) return;

    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known) return;
        var merged = Object.assign({}, d);
        if (!merged.studentName) merged.studentName = lsGet(PROJ_KEYS.studentName) || '';
        fillProjectForm(merged);
        eachProjectSpec(function (spec) {
          lsSet(PROJ_KEYS[spec.key], merged[spec.key] || '');
        });
      })
      .catch(function () {});
  }

  function saveProjectFields() {
    // Two Save buttons exist now (top and bottom of the form, both class
    // 'proj-save-btn'/'proj-status') so a long My Project form never buries
    // the only way to save below the fold. Both stay in lockstep - every
    // status/enabled change below applies to the whole set, not just one.
    var statusEls = document.querySelectorAll('.proj-status');
    var btns = document.querySelectorAll('.proj-save-btn');

    function setStatus(text, cls) {
      statusEls.forEach(function (el) {
        el.textContent = text;
        el.className = cls;
      });
    }
    function setDisabled(state) {
      btns.forEach(function (b) { b.disabled = state; });
    }

    var fields = {};
    eachProjectSpec(function (spec) {
      var node = document.getElementById(spec.id);
      var value = node ? node.value : '';
      fields[spec.key] = (spec.type === 'select') ? value : value.trim();
    });

    // Deliberately NOT written to localStorage yet. If this is a brand-new
    // email being resolved below, clearStaleLocalCache() runs inside
    // ensureDurableIdentity() and would wipe anything written here first -
    // persistFieldsLocally() is called only after ownership is settled,
    // in both branches below.
    function persistFieldsLocally() {
      eachProjectSpec(function (spec) {
        lsSet(PROJ_KEYS[spec.key], fields[spec.key]);
      });
    }

    function doServerSave() {
      setDisabled(true);
      setStatus('Saving…', 'proj-status');

      fetch(PROXY_URL + '/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ studentId: STUDENT_ID, email: STUDENT_EMAIL }, fields))
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          setDisabled(false);
          if (d && d.ok) {
            setStatus("Saved. Every lesson's coach will know your project.", 'proj-status ok');
          } else {
            setStatus("Saved on this device only - couldn't reach the server.", 'proj-status err');
          }
        })
        .catch(function () {
          setDisabled(false);
          setStatus("Saved on this device only - couldn't reach the server.", 'proj-status err');
        });
    }

    if (isEmailConfirmed()) {
      persistFieldsLocally();
      doServerSave();
      return;
    }

    var emailInput = document.getElementById('projEmail');
    var email = emailInput ? emailInput.value.trim() : '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('Enter a valid email first — it keeps your notes, tasks, and coaching history with you.', 'proj-status err');
      if (emailInput) emailInput.focus();
      return;
    }

    setDisabled(true);
    setStatus('Confirming your email…', 'proj-status');

    ensureDurableIdentity(email).then(function (result) {
      if (!result.ok) {
        setDisabled(false);
        setStatus("Couldn't confirm that email. Double-check it and try again.", 'proj-status err');
        return;
      }

      // Name is only required the moment a brand-new identity is minted.
      // A returning student resolving on a new device already has one, so
      // don't block them behind a name they've already given us before.
      if (result.isNew) {
        var nameInput = document.getElementById('projStudentName');
        var studentNameValue = nameInput ? nameInput.value.trim() : '';
        if (!studentNameValue) {
          setDisabled(false);
          setStatus('Enter your first name too — it lets your coach greet you by name instead of asking every time.', 'proj-status err');
          if (nameInput) nameInput.focus();
          return;
        }
      }

      persistFieldsLocally();

      var wrap = document.getElementById('projEmailWrap');
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
      refreshGatedTabs();
      doServerSave();
    });
  }

  /* ==========================================================
     IDENTITY MODAL
     ------------------------------------------------------------
     Triggered from buildDashboardView() whenever an unconfirmed
     visitor lands on Dashboard - now the first tab a student
     sees. Mandatory: no close button, no dismiss link. Email and
     first name are both always required, regardless of whether
     the identity turns out to be new or already exists - so the
     modal only ever disappears once a real identity is confirmed
     and stored (stratum_sid cookie set).
     ========================================================== */

  function showIdentityModal() {
    if (isEmailConfirmed()) return;
    if (document.getElementById('srxIdentityOverlay')) return;

    var overlay = el('div', 'srx-identity-overlay');
    overlay.id = 'srxIdentityOverlay';

    var modal = el('div', 'srx-identity-modal');

    mount(modal, el('div', 'srx-identity-title', 'Welcome To Stratum'));
    mount(modal, el('p', 'srx-identity-text',
      'Enter your email and first name to keep your notes, tasks, and coaching history tied to you throughout the course.'));

    var emailField = el('div', 'srx-identity-field');
    mount(emailField, el('label', 'srx-identity-label', 'Email'));
    var emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.className = 'srx-identity-input';
    emailInput.placeholder = 'you@example.com';
    mount(emailField, emailInput);
    mount(modal, emailField);

    var nameField = el('div', 'srx-identity-field');
    mount(nameField, el('label', 'srx-identity-label', 'First name'));
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'srx-identity-input';
    nameInput.placeholder = 'e.g. John';
    nameInput.maxLength = 60;
    mount(nameField, nameInput);
    mount(modal, nameField);

    var btn = el('button', 'srx-identity-btn', 'Continue');
    btn.type = 'button';
    mount(modal, btn);

    var status = el('div', 'srx-identity-status');
    mount(modal, status);

    mount(overlay, modal);
    mount(document.body, overlay);
    emailInput.focus();

    function submit() {
      var email = emailInput.value.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        status.textContent = 'Enter a valid email.';
        status.className = 'srx-identity-status err';
        emailInput.focus();
        return;
      }

      var name = nameInput.value.trim();
      if (!name) {
        status.textContent = 'Enter your first name too.';
        status.className = 'srx-identity-status err';
        nameInput.focus();
        return;
      }

      btn.disabled = true;
      status.textContent = 'Checking…';
      status.className = 'srx-identity-status';

      ensureDurableIdentity(email).then(function (result) {
        if (!result.ok) {
          btn.disabled = false;
          status.textContent = "Couldn't confirm that email. Double-check it and try again.";
          status.className = 'srx-identity-status err';
          return;
        }

        // Safe to write locally here - ensureDurableIdentity() already
        // reconciled cache ownership (cleared any stale prior identity's
        // data) before this .then() ever runs.
        studentName = name;
        lsSet(PROJ_KEYS.studentName, name);

        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        refreshGatedTabs();
      });
    }

    btn.addEventListener('click', submit);
    emailInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  }

  var conversationHistory = [];
  var conversationId = null;
  var studentName = '';
  var reflectionComplete = false;
  var poolExhausted = false;
  var busy = false;

  var chatEl, formEl, inputEl, sendBtn;

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

    if (LESSON.resource && LESSON.resource.title) {
      parts.push(
        'RESOURCE DOCUMENT THE STUDENT CAN READ ON THIS PAGE (' + LESSON.resource.title + '):\n"""\n' +
        (LESSON.resource.text || '') +
        '\n"""\nThis is reference material for you, not a script. The student has access to this same document on the page and may or may not have read it yet. Use it to understand any concepts, frameworks, or techniques it teaches so you can draw on them naturally in conversation and apply them to what the student actually says. Never quote, recite, or paraphrase-at-length from this document to the student - if they have not read it, summarize the relevant idea briefly in your own words instead of reading it to them.'
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

      'THE DEPTH RULE - HOLD THE LINE GENTLY:\nIf you were the live coach in the room, you would not let someone get away with a flat, surface-level first answer. So: when an answer is generic, rehearsed-sounding, or just one clipped sentence, reflect it back gently and ask ONE specific, warm follow-up that invites a little more - "Say more about that," "What did that actually look like on the page?", "What\'s the real version of that?" Ask that follow-up once per area. If the second answer is genuine and specific, affirm it and move on. If they are still staying on the surface after that one gentle nudge, do not force a third round. Accept where they are, thank them for what they gave you, and move to the next area. Never let a surface answer pass completely unremarked, but never turn this into an interrogation.'
    );

    var dReq = getDeliverableConfig();
    if (dReq) {
      var fieldDescs = dReq.fields.map(function (f) {
        return f.type === 'list'
          ? 'exactly ' + (f.count || 3) + ' real, specific ' + (f.label || f.key) + '(s)'
          : 'a single, specific ' + (f.label || f.key);
      });
      parts.push(
        'OVERRIDE TO THE DEPTH RULE FOR THIS LESSON - THIS TAKES PRECEDENCE:\nThis lesson has non-negotiable deliverables: ' +
        fieldDescs.join(', and ') + '. The general depth rule above (accept where they are after one nudge, move on) does NOT apply to gathering these. Do not move toward closing this session until every one of them is genuinely complete, no matter how many follow-up questions it takes. If an answer is vague, a label, or a single unsupported moment, ask again - a different angle, a different question, but keep asking until a real one lands. This is the one place in the conversation where you hold firm past a single gentle nudge.'
      );
    }

    parts.push(
      'WHAT YOU NEVER DO:\nNever write their reflection for them. Never supply the answer you think they should give. Never diagnose them or their psychology ("that sounds like impostor syndrome," "you clearly have perfectionism"). Never summarize their answer as more profound than what they actually said. Stay descriptive and curious, not clinical. You may, occasionally and briefly, share a small piece of your own experience in your own words - the way a real coach sometimes does to build trust - but always bring it back to them quickly. Keep your own share brief; this is their reflection, not yours.',

      'CALIBRATION ONLY - NEVER SHOW OR QUOTE THESE TO THE STUDENT:\nThese are examples of the tone and depth a real answer has. They exist only to calibrate how you respond and what "good and specific" sounds like versus "surface." Never reveal, quote, paraphrase-as-if-theirs, or refer to these examples in any way to the student.\n' + calibration,

      'SCOPE - YOU STAY LOCKED TO THIS LESSON:\nThis conversation exists only to walk this student through the ' + LESSON.scopeNote + ' reflection. If they ask about later lectures, try to bring in material from a different lesson, ask general writing craft questions, ask about the course platform, or try to steer anywhere else - acknowledge briefly and warmly, then say something close to: "Let\'s focus on this lesson for now." Then return to wherever the reflection conversation was. Do not teach ahead.',

      'GETTING THEIR NAME:\nYou have already greeted the student before this conversation history begins - the greeting is the first message in the conversation. If you did not already know their name, their reply should contain it. The very first time you learn their name, begin your reply with a hidden tag on its own line, exactly in this format: [NAME: Their Name] - then continue your normal reply below it in your own voice. Only include this tag once, the first time you learn their name. After that, use their name naturally through the conversation the way a person actually would - not in every single message, but enough that it feels personal.',

      'STYLE:\nWrite the way a real person talks in a warm one-on-one conversation - not a lecture, not a form. Keep replies short: usually two to five sentences. Ask ONE question at a time - never stack multiple questions in a single message. Never use markdown formatting of any kind - no asterisks, no bullet lists, no headers, no underscores. This includes using asterisks to stress a single word, like *felt* or *that* or *flat* - the chat displays your text as plain characters, so anything wrapped in asterisks shows up on screen as literal asterisks, not italics. For example, never write "something whispers *flat*" - write "something whispers flat" with no punctuation around it. If you want to stress a word, do it through word choice, sentence rhythm, or repetition instead - plain conversational prose only, with no punctuation marks used for emphasis.'
    );

    var wrapParts = [
      'Once all the areas have been genuinely explored - not perfectly, not exhaustively, just past a first surface answer - bring the conversation to a warm close. Thank them for what they shared, tell them this becomes something they can keep, and let them know ' + LESSON.nextLessonLabel + ' is next.'
    ];

    var dWrap = getDeliverableConfig();
    if (dWrap) {
      var tagLines = '';
      var tagNamesForClose = [];
      dWrap.fields.forEach(function (f) {
        var tag = fieldTagName(f.key);
        tagNamesForClose.push(tag);
        if (f.type === 'list') {
          var count = f.count || 3;
          var payloadHint = Array.isArray(f.parts) && f.parts.length
            ? f.parts.join(' | ')
            : 'exactly what applies for this one, stated specifically';
          for (var i = 1; i <= count; i++) {
            tagLines += '[' + tag + '_' + i + ': ' + payloadHint + ']\n';
          }
        } else {
          tagLines += '[' + tag + ': the finished, specific ' + (f.label || f.key) + ']\n';
        }
      });

      var fieldSummary = dWrap.fields.map(function (f) {
        return f.type === 'list' ? (f.count || 3) + ' ' + (f.label || f.key) + '(s)' : (f.label || f.key);
      }).join(', ');

      wrapParts.push(
        'CAPTURING THE DELIVERABLE - REQUIRED BEFORE YOU CAN CLOSE:\nBefore your closing message, on their own lines, include hidden tags capturing every finished deliverable field - ' + fieldSummary + ' - exactly in this format (one line each, pipe-separated where shown, no line breaks inside a tag):\n\n' + tagLines +
        '\nEvery field must contain real, specific content the student actually gave you - never a placeholder, never something you infer or invent on their behalf. Do not emit these tags, and do not close the session, until you actually have all of this. If the student trails off or seems ready to stop before you have a complete deliverable, gently keep gathering it rather than closing early - this deliverable is the entire point of the lesson.'
      );

      wrapParts.push(
        'Immediately after the ' + tagNamesForClose.join('/') + ' tags, on its own line, include a hidden tag capturing the single most important thing that surfaced across the whole conversation, in one plain sentence, third person, under twenty words - exactly in this format: [SUMMARY: One sentence capturing the core insight that surfaced.] - this is never shown to the student, it is used only to build their record of the course. End that closing message with the exact tag [REFLECTION_COMPLETE] on its own line at the very end, after every other tag. Only include these tags once, in the message where you are genuinely wrapping up, and only once every deliverable field above is complete and specific.'
      );
    } else {
      wrapParts.push(
        'Immediately before your closing sentence, on its own line, include a hidden tag capturing the single most important thing that surfaced across the whole conversation, in one plain sentence, third person, under twenty words - exactly in this format: [SUMMARY: One sentence capturing the core insight that surfaced.] - this is never shown to the student, it is used only to build their record of the course. End that closing message with the exact tag [REFLECTION_COMPLETE] on its own line at the very end, after the summary tag. Only include either tag once, in the message where you are genuinely wrapping up - not before all areas are covered.'
      );
    }

    parts.push('WRAPPING UP:\n' + wrapParts.join('\n\n'));

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
      block += '\n\nLANGUAGE: This student has selected ' + v.language + ' as their preferred coaching language. From this point forward, conduct the entire conversation in ' + v.language + ' - every question, every follow-up, every reflection, and the closing message. Write naturally and idiomatically in ' + v.language + ', not as a literal word-for-word translation. Exception: keep every hidden bracket tag - [NAME: ...], [SUMMARY: ...], every deliverable field tag such as [FIELDKEY: ...] or [FIELDKEY_n: ...], and [REFLECTION_COMPLETE] - exactly in their English bracket format as instructed elsewhere in this prompt - only the name inside the NAME tag should reflect what the student actually typed, and the sentence inside the SUMMARY tag must always be written in English regardless of ' + v.language + ', because it is read by the instructor, not the student. The content inside deliverable field tags should be written in ' + v.language + ' since it belongs to the student, matching whatever language they did the session in.';
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

  // Renders the "Before You Begin" intro the admin panel captures under
  // Coaching Intro Text (title + content, plus a "shows an intro message"
  // checkbox). Reuses the existing .lec-resource accordion styling so it's
  // visually consistent with Lesson Resources: bordered, collapsible,
  // closed by default (matching the admin panel's "default closed" label).
  function buildCoachingIntro(panel) {
    var ci = LESSON.coachingIntro;
    if (!ci || !ci.text || ci.enabled === false) return;

    var details = el('details', 'lec-resource');
    details.id = 'lecCoachingIntro';
    details.open = false;

    mount(details, el('summary', 'lec-resource-bar', ci.title || 'Before You Begin'));

    var body = el('div', 'lec-resource-body');
    body.innerHTML = textToParagraphs(ci.text);
    mount(details, body);

    mount(panel, details);
  }

  function buildCoachTab(panel) {
    if (!isEmailConfirmed()) { buildIdentityGate(panel, 'coaching history'); return; }

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

  // Sentinel prefix marking a hidden, engine-injected corrective turn. These
  // exist only to steer the model back on track after an invalid attempt to
  // close (see validateDeliverable / retryForDeliverable below) - they are
  // real entries in conversationHistory (the API needs them for context) but
  // are never rendered in the chat UI and never included in the downloaded
  // Word document. Uses a zero-width space so it can never collide with
  // anything a real student could type or paste.
  var SYSTEM_RETRY_PREFIX = '\u200B[STRATUM_INTERNAL_RETRY]';

  function isHiddenSystemMessage(msg) {
    return !!msg && msg.role === 'user' && typeof msg.content === 'string' &&
      msg.content.indexOf(SYSTEM_RETRY_PREFIX) === 0;
  }

  var MAX_DELIVERABLE_RETRIES = 2;
  var deliverableRetryCount = 0;
  var lastDeliverable = null; // { fields: { <key>: string | string[] | object[] } } once validated

  // Generalized (Sept 2026) deliverable system - a lesson's deliverable can
  // now be any number of independently named fields instead of one
  // hardcoded "behavior + N instances" shape. Each field is either:
  //   type "single" - one string value, tag format [KEY: value]
  //   type "list"   - an array of `count` items, tag format [KEY_n: value].
  //                   If the field also defines `parts` (an array of
  //                   sub-field names, e.g. ["context","people","action"]),
  //                   each item's tag payload is pipe-delimited matching
  //                   those parts and gets parsed into an object; if
  //                   `parts` is omitted, each item is just a plain string.
  //
  // normalizeDeliverableConfig() auto-converts any OLD-shape config already
  // saved in D1 (behaviorLabel/instanceLabel/instanceCount, no fields[])
  // into the new fields[] shape at read time, so Lesson 1's already-tested,
  // already-live config keeps working without Ted needing to re-enter it -
  // new lessons entered through the admin panel write the new shape
  // directly, and old ones are upgraded transparently on load.
  function normalizeDeliverableConfig(raw) {
    if (!raw || !raw.required) return null;
    if (Array.isArray(raw.fields) && raw.fields.length) {
      return { required: true, fields: raw.fields };
    }
    // Legacy shape fallback. Field keys are chosen to exactly reproduce the
    // original hardcoded tag names (BEHAVIOR / INSTANCE_n) via
    // fieldTagName() below - not just the same shape - so a conversation
    // already in progress at deploy time, or an already-saved legacy
    // config, keeps parsing correctly with zero behavior change.
    return {
      required: true,
      fields: [
        { key: 'behavior', label: raw.behaviorLabel || 'Anchor Behavior', type: 'single' },
        {
          key: 'instance',
          label: raw.instanceLabel || 'Instance',
          type: 'list',
          count: raw.instanceCount || 3,
          parts: ['context', 'people', 'action']
        }
      ]
    };
  }

  function getDeliverableConfig() {
    var raw = (LESSON && LESSON.reflectionFramework) ? LESSON.reflectionFramework.deliverable : null;
    return normalizeDeliverableConfig(raw);
  }

  // Turns a field key into the bracket-tag name used in the model's output
  // - uppercased, non-alphanumerics stripped, so a key like "hiddenTruth"
  // becomes the tag HIDDENTRUTH and "causalLock" becomes CAUSALLOCK.
  function fieldTagName(key) {
    return String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // Strips every deliverable tag for the given config out of a block of
  // text - used both when discarding an invalid completion attempt and
  // when cleaning the transcript for the Word doc export, so the two stay
  // in sync automatically as fields are added or renamed.
  function stripDeliverableTags(text, config) {
    var out = text;
    (config && config.fields ? config.fields : []).forEach(function (f) {
      var tag = fieldTagName(f.key);
      if (f.type === 'list') {
        out = out.replace(new RegExp('\\[' + tag + '_\\d+:\\s*[^\\]]+\\]\\s*', 'gi'), '');
      } else {
        out = out.replace(new RegExp('\\[' + tag + ':\\s*[^\\]]+\\]\\s*', 'i'), '');
      }
    });
    return out;
  }

  function extractTags(raw) {
    var text = raw;
    var name = null;
    var complete = false;
    var summary = null;
    var fields = {};

    var nameMatch = text.match(/^\[NAME:\s*([^\]]+)\]\s*/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
      text = text.replace(nameMatch[0], '');
    }

    // Generic deliverable field parsing - walks the lesson's own field
    // config (single value vs. repeatable list, with or without
    // pipe-delimited sub-parts) rather than assuming a fixed BEHAVIOR /
    // INSTANCE_n shape, so any lesson's deliverable fields parse the same
    // way without engine changes.
    var config = getDeliverableConfig();
    (config && config.fields ? config.fields : []).forEach(function (f) {
      var tag = fieldTagName(f.key);
      if (f.type === 'list') {
        var count = f.count || 3;
        var re = new RegExp('\\[' + tag + '_(\\d+):\\s*([^\\]]+)\\]\\s*', 'gi');
        var items = [];
        var im;
        while ((im = re.exec(raw)) !== null) {
          var payload = im[2];
          var value;
          if (Array.isArray(f.parts) && f.parts.length) {
            var pieces = payload.split('|').map(function (s) { return s.trim(); });
            value = {};
            f.parts.forEach(function (partName, i) { value[partName] = pieces[i] || ''; });
          } else {
            value = payload.trim();
          }
          items[Number(im[1]) - 1] = value;
        }
        text = text.replace(re, '');
        // Drop any holes (a skipped index) rather than leaving `undefined`
        // entries, so length checks in validateDeliverable are accurate.
        fields[f.key] = items.filter(function (v) { return v !== undefined; });
      } else {
        var reSingle = new RegExp('\\[' + tag + ':\\s*([^\\]]+)\\]\\s*', 'i');
        var m = text.match(reSingle);
        fields[f.key] = m ? m[1].trim() : null;
        if (m) text = text.replace(reSingle, '');
      }
    });

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
      summary: summary,
      fields: fields
    };
  }

  // Checks a parsed deliverable against the lesson's requirement. Returns
  // { valid: bool, missing: [strings describing what's missing or empty] }
  // so the corrective message can be specific rather than generic. Walks
  // config.fields generically instead of assuming a fixed shape.
  function validateDeliverable(parsed, config) {
    var missing = [];
    var data = parsed.fields || {};

    (config.fields || []).forEach(function (f) {
      var label = f.label || f.key;
      var val = data[f.key];

      if (f.type === 'list') {
        var required = f.count || 3;
        var have = Array.isArray(val) ? val.length : 0;
        if (have < required) {
          missing.push((required - have) + ' more ' + label + (required - have === 1 ? '' : 's'));
        }
        (val || []).forEach(function (item, i) {
          if (Array.isArray(f.parts) && f.parts.length) {
            var incomplete = f.parts.some(function (p) { return !item || !item[p]; });
            if (incomplete) missing.push('a complete ' + f.parts.join('/') + ' for ' + label + ' ' + (i + 1) + ' (one or more parts were left blank)');
          } else if (!item) {
            missing.push('a complete ' + label + ' ' + (i + 1) + ' (it was left blank)');
          }
        });
      } else {
        if (!val) missing.push('the ' + label + ' itself');
      }
    });

    return { valid: missing.length === 0, missing: missing };
  }

  function reportLessonComplete(summaryText) {
    if (!STUDENT_ID) return;
    var body = { studentId: STUDENT_ID, lesson: LESSON_ID, summary: summaryText || null };
    // Send the validated structured deliverable (whatever fields this
    // lesson's config defines) alongside the summary when this lesson has
    // one - lets the admin audit view (GET /admin/deliverables) show
    // exactly what a student's session produced, not just the one-sentence
    // summary.
    if (lastDeliverable) body.deliverable = lastDeliverable;
    fetch(PROXY_URL + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(function () {});
  }

  function persist() {
    lsSet(STORE_KEY, JSON.stringify({
      conversationId: conversationId,
      history: conversationHistory,
      studentName: studentName,
      reflectionComplete: reflectionComplete,
      deliverable: lastDeliverable
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
    lastDeliverable = saved.deliverable || null;

    for (var i = 1; i < conversationHistory.length; i++) {
      var m = conversationHistory[i];
      if (isHiddenSystemMessage(m)) continue;
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

  // Turns a parsed list-item value (either a plain string, or a
  // {part: value, ...} object when the field defines `parts`) into one
  // display line - joining parts with an em dash the same way the
  // original context/people/action instances always displayed.
  function formatListItemText(item, field) {
    if (item && typeof item === 'object' && Array.isArray(field.parts)) {
      return field.parts.map(function (p) { return item[p] || ''; }).filter(Boolean).join(' — ');
    }
    return String(item || '');
  }

  // Renders a clean, plain-language snapshot of the captured deliverable -
  // shown both at the moment of completion and folded into the Word doc.
  // Kept as its own function so both call sites stay in sync automatically.
  // Generalized (Sept 2026) to render any number of named fields, each
  // either a single value or a numbered list, rather than one hardcoded
  // behavior + instances layout.
  function buildDeliverableSnapshotEl(deliverable, config) {
    var box = el('div', 'srx-deliverable');
    var data = (deliverable && deliverable.fields) ? deliverable.fields : {};

    (config && config.fields ? config.fields : []).forEach(function (f) {
      var label = (f.label || f.key).toUpperCase();
      var val = data[f.key];

      if (f.type === 'list') {
        mount(box, el('div', 'srx-deliverable-label', label));
        var list = el('div', 'srx-deliverable-instances');
        (val || []).forEach(function (item, i) {
          var row = el('div', 'srx-deliverable-instance');
          mount(row, el('div', 'srx-deliverable-instance-num', String(i + 1)));
          var text = el('div', 'srx-deliverable-instance-text');
          text.textContent = formatListItemText(item, f);
          mount(row, text);
          mount(list, row);
        });
        mount(box, list);
      } else {
        mount(box, el('div', 'srx-deliverable-label', label));
        mount(box, el('div', 'srx-deliverable-behavior', val || ''));
      }
    });

    return box;
  }

  function showDownloadCard() {
    var card = el('div', 'srx-download-card');

    if (lastDeliverable) {
      mount(card, buildDeliverableSnapshotEl(lastDeliverable, getDeliverableConfig()));
    }

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
  }

  var LT = String.fromCharCode(60);
  var GT = String.fromCharCode(62);
  function otag(name, attrs) { return LT + name + (attrs ? ' ' + attrs : '') + GT; }
  function ctag(name) { return LT + '/' + name + GT; }

  function generateDoc() {
    var dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var name = studentName || 'Student';
    var body = '';

    if (lastDeliverable) {
      var cfg = getDeliverableConfig();
      var data = lastDeliverable.fields || {};

      body += otag('div', 'style="background:#F5EFE0;border:1px solid #DDD0B8;border-left:4px solid #C9A46C;padding:16px 20px;margin:0 0 22px;"');

      (cfg && cfg.fields ? cfg.fields : []).forEach(function (f) {
        var label = f.label || f.key;
        var val = data[f.key];

        if (f.type === 'list') {
          (val || []).forEach(function (item, i) {
            body += otag('p', 'style="margin:0 0 8px;"') +
                    otag('strong') + escapeHtml(label) + ' ' + (i + 1) + ':' + ctag('strong') + ' ' +
                    escapeHtml(formatListItemText(item, f)) +
                    ctag('p');
          });
        } else {
          body += otag('p', 'style="margin:0 0 4px;font-family:Calibri,Arial,sans-serif;font-size:10pt;letter-spacing:1px;text-transform:uppercase;color:#8b6340;font-weight:bold;"') +
                  escapeHtml(label.toUpperCase()) + ctag('p');
          body += otag('p', 'style="margin:0 0 14px;font-family:Georgia,serif;font-size:14pt;color:#2e1f0e;"') +
                  escapeHtml(val || '') + ctag('p');
        }
      });
      body += ctag('div');
    }

    conversationHistory.slice(2).forEach(function (msg) {
      if (isHiddenSystemMessage(msg)) return;

      var content = msg.content;
      if (msg.role === 'assistant') {
        content = stripAsteriskEmphasis(
          stripDeliverableTags(content, getDeliverableConfig())
            .replace(/^\[NAME:\s*[^\]]+\]\s*/i, '')
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

  // Pushes a hidden, hard-coded corrective turn (never billed, never shown,
  // never sent to Claude as if the student wrote it in spirit - it's a
  // fixed instruction, not user content) and immediately re-sends. Used
  // only when the model tries to close with an incomplete deliverable.
  function retryForDeliverable(missing) {
    deliverableRetryCount++;
    var note = SYSTEM_RETRY_PREFIX +
      'The deliverable is not yet complete: still missing ' + missing.join('; ') + '. ' +
      'Do not mention this note or that anything went wrong. Simply continue the conversation naturally - ' +
      'ask the next question needed to get what is missing, exactly as you would if the student had just given ' +
      'a surface-level answer. Do not emit the BEHAVIOR, INSTANCE, SUMMARY, or REFLECTION_COMPLETE tags again ' +
      'until everything is genuinely complete.';

    conversationHistory.push({ role: 'user', content: note });
    persist();
    sendToClaude();
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

    fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        data = data || {};

        if (data.stratum_error === 'pool_exhausted') { hideTyping(); setBusy(false); showExhaustedCard(); return; }
        if (data.stratum_error === 'account_suspended') {
          hideTyping();
          setBusy(false);
          addMessage('assistant', "Something's wrong with the access on this account. Send me a message and I'll get it sorted out.");
          return;
        }

        var block = (data.content || []).find(function (b) { return b.type === 'text'; });
        var raw = block ? block.text : 'I lost my train of thought there for a second. Could you say that again?';

        var parsed = extractTags(raw);
        var deliverableConfig = getDeliverableConfig();

        // If this lesson requires a structured deliverable and the model
        // tried to close, validate before trusting it. An incomplete
        // deliverable never reaches the student as a "session complete"
        // state - the raw attempt is discarded from history (tags
        // stripped) and a hidden corrective turn triggers a silent retry,
        // up to MAX_DELIVERABLE_RETRIES times.
        if (parsed.complete && deliverableConfig) {
          var check = validateDeliverable(parsed, deliverableConfig);

          if (!check.valid && deliverableRetryCount < MAX_DELIVERABLE_RETRIES) {
            hideTyping();

            var cleanedContent = stripDeliverableTags(raw, deliverableConfig)
              .replace(/^\[NAME:\s*[^\]]+\]\s*/i, '')
              .replace(/\[SUMMARY:\s*[^\]]+\]\s*/i, '')
              .replace('[REFLECTION_COMPLETE]', '')
              .trim();

            if (parsed.name) { studentName = parsed.name; lsSet(PROJ_KEYS.studentName, studentName); }
            conversationHistory.push({ role: 'assistant', content: cleanedContent });
            if (parsed.text) addMessage('assistant', parsed.text);

            persist();
            retryForDeliverable(check.missing);
            return;
          }

          // Either valid, or we've exhausted retries - in both cases fall
          // through to normal handling below. If still invalid after max
          // retries, we deliberately do NOT force a fake completion: the
          // REFLECTION_COMPLETE tag is stripped and the session simply
          // keeps going as an ordinary conversation until a real
          // deliverable is captured on some later turn.
          if (!check.valid) {
            parsed.complete = false;
            raw = raw.replace('[REFLECTION_COMPLETE]', '');
          } else {
            lastDeliverable = { fields: parsed.fields };
          }
        }

        hideTyping();
        setBusy(false);

        if (parsed.name) {
          studentName = parsed.name;
          lsSet(PROJ_KEYS.studentName, studentName);
        }

        conversationHistory.push({ role: 'assistant', content: raw });
        addMessage('assistant', parsed.text);

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
    });
  }

  function showFatalError(container, message) {
    var box = el('div', 'lec-contact');
    box.style.padding = '20px';
    box.textContent = message;
    container.innerHTML = '';
    mount(container, box);
  }

  function buildLessonPage(container) {
    if (TIER === 'essentials') {
      buildEssentialsPage(container);
      return;
    }
    buildTopNav(container);
  }

  function init() {
    LESSON_ID = window.STRATUM_LESSON_ID;
    TIER = window.STRATUM_TIER === 'essentials' ? 'essentials' : 'guided';

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

    fetch(PROXY_URL + '/lesson-config?lessonId=' + encodeURIComponent(LESSON_ID) + '&tier=' + TIER)
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
