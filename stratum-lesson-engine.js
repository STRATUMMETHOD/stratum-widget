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

  // Section groupings for the Coaching Sessions summary widget.
  var EXCREC_GROUPS = [
    { key: 'orientation', label: 'Orientation', lessons: ['1.1', '1.2', '1.3'] },
    { key: 'awareness',   label: 'Awareness',   lessons: ['2.1', '2.2', '2.3'] },
    { key: 'proof',       label: 'Proof',       lessons: ['3.1', '3.2', '3.3'] },
    { key: 'application', label: 'Application', lessons: ['4.1', '4.2', '4.3'] }
  ];

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

  // Collapses rapid-fire saves (every keystroke for Notes, every add/toggle/
  // delete for Tasks) into a single network call after the student pauses.
  // localStorage still writes instantly at the call site for responsiveness -
  // this only governs the push to D1.
  function debounce(fn, delay) {
    var t = null;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, delay);
    };
  }

  // SAFETY NET - independent of whether the model follows the no-asterisks
  // instruction in the system prompt. Strips *word* style emphasis down to
  // plain text so a slip never reaches the screen as literal asterisks.
  // Deliberately narrow: only matches a single pair around text with no
  // asterisk or newline inside, so it cannot eat a stray "3 * 4".
  function stripAsteriskEmphasis(text) {
    return String(text).replace(/\*([^*\n]+)\*/g, '$1');
  }

  var STUDENT_ID = readCookie('sio_u_public');
  var STUDENT_EMAIL = readSessionValue('email');

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
     COACHING SESSIONS SUMMARY WIDGET
     ----------------------------------------------------------
     Four always-visible section labels, each showing a small
     fixed-size checkmark tile for every lesson completed in
     that section so far. Sections with zero completions still
     show their label and reserve the same row height, but no
     tiles. Hovering a tile reveals the summary that was
     carried forward from that session.
     ========================================================== */

  function buildExcavationRecordShell(container) {
    var wrap = el('div', 'excrec');
    wrap.id = 'excrec';
    mount(wrap, el('div', 'excrec-title', 'Coaching Sessions'));
    mount(wrap, el('div', 'excrec-sub',
      'The following is a summary of your completed coaching sessions. Hover over a lesson for a review of the session.'));
    var groups = el('div', 'excrec-groups');
    groups.id = 'excrecGroups';
    mount(wrap, groups);
    mount(container, wrap);
  }

  function renderExcavationRecordFrom(completionsByLesson) {
    var groupsEl = document.getElementById('excrecGroups');
    if (!groupsEl) return;
    groupsEl.innerHTML = '';

    EXCREC_GROUPS.forEach(function (group) {
      var groupDiv = el('div', 'excrec-group');

      // Section label - always visible, always its own subtle colored pill,
      // never conditional on whether anything in this section is complete.
      var labelDiv = el('div', 'excrec-group-label excrec-pill-' + group.key, group.label);
      mount(groupDiv, labelDiv);

      // Tile row - reserves height even when empty; only renders a tile for
      // lessons this student has actually completed.
      var rowDiv = el('div', 'strata-group');

      group.lessons.forEach(function (lesson) {
        if (!Object.prototype.hasOwnProperty.call(completionsByLesson, lesson)) return;

        var tile = el('div', 'stratum excrec-tile-' + group.key);

        var tip = el('div', 'excrec-tooltip');
        mount(tip, el('div', 'excrec-tooltip-lecture', 'Lecture ' + lesson));
        tip.appendChild(document.createTextNode(completionsByLesson[lesson] || 'Completed.'));
        mount(tile, tip);

        mount(tile, el('div', 'stratum-check', '\u2713'));
        mount(rowDiv, tile);
      });

      mount(groupDiv, rowDiv);
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

  // Exposed so the coach can trigger a live redraw right after a lesson
  // completes, without requiring a page refresh.
  window.STRATUM_refreshExcavationRecord = refreshExcavationRecord;

  /* ==========================================================
     VIDEO + TRANSCRIPT + CONTACT + RESOURCE
     ========================================================== */

  function buildVideo(container, mediaId) {
    // Wistia's player.js and transcript.js each load exactly once per page.
    // The per-media embed script is separate and loads per video.
    loadScriptOnce('https://fast.wistia.com/player.js');
    loadScriptOnce('https://fast.wistia.com/assets/external/transcript.js');
    loadModuleOnce('https://fast.wistia.com/embed/' + mediaId + '.js');

    // Placeholder styling while the custom element is still undefined.
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

    var summary = el('summary', null, 'Read the transcript');
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

    // The Wistia transcript is a web component that measures itself on render.
    // Inside a closed <details> it has no box to measure, so on first open we
    // nudge it with a resize event. If nothing has rendered a couple of seconds
    // later, the media has no generated transcript in Wistia yet - show the
    // fallback line rather than an empty panel.
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

  // Renders inline on the page as a COLLAPSED bordered accordion. The labeled
  // title bar is the toggle. Not a download, not a new-tab link.
  // Only called when the lesson config actually has a resource.
  // If resource.pdfUrl is present, a STRATUM-styled download button is
  // rendered below the text content. Both text and PDF are independently
  // optional — either or both may be present.
  function buildResource(container, resource) {
    if (!resource || !resource.title) return;

    var details = el('details', 'lec-resource');
    details.id = 'lecResource';

    mount(details, el('summary', 'lec-resource-bar', resource.title));

    var body = el('div', 'lec-resource-body');

    // Plain text content — only rendered when present.
    if (resource.text && resource.text.trim()) {
      body.innerHTML = resource.html || textToParagraphs(resource.text);
    }

    // PDF download button — only rendered when a URL is present.
    if (resource.pdfUrl && resource.pdfUrl.trim()) {
      var pdfWrap = el('div', 'lec-resource-pdf');

      var pdfBtn = document.createElement('a');
      pdfBtn.className = 'lec-resource-pdf-btn';
      pdfBtn.href = resource.pdfUrl;
      pdfBtn.target = '_blank';
      pdfBtn.rel = 'noopener';

      // Download icon SVG
      var iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      iconSvg.setAttribute('viewBox', '0 0 24 24');
      iconSvg.setAttribute('width', '14');
      iconSvg.setAttribute('height', '14');
      iconSvg.setAttribute('fill', 'none');
      iconSvg.setAttribute('stroke', 'currentColor');
      iconSvg.setAttribute('stroke-width', '2');
      iconSvg.setAttribute('stroke-linecap', 'round');
      iconSvg.setAttribute('stroke-linejoin', 'round');
      iconSvg.setAttribute('aria-hidden', 'true');
      var pathLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      pathLine.setAttribute('x1', '12'); pathLine.setAttribute('y1', '3');
      pathLine.setAttribute('x2', '12'); pathLine.setAttribute('y2', '15');
      iconSvg.appendChild(pathLine);
      var pathArrow = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pathArrow.setAttribute('points', '7 10 12 15 17 10');
      iconSvg.appendChild(pathArrow);
      var pathBase = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      pathBase.setAttribute('x1', '5'); pathBase.setAttribute('y1', '21');
      pathBase.setAttribute('x2', '19'); pathBase.setAttribute('y2', '21');
      iconSvg.appendChild(pathBase);

      pdfBtn.appendChild(iconSvg);
      pdfBtn.appendChild(document.createTextNode('\u00A0 Download PDF'));

      mount(pdfWrap, pdfBtn);
      mount(body, pdfWrap);
    }

    mount(details, body);
    mount(container, details);
  }

  // Blank lines separate paragraphs; single newlines become line breaks.
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
     TAB STRUCTURE
     ----------------------------------------------------------
     Tabs are for things you DO (interactive, stateful).
     The page itself is for things you READ.
     Four tabs only - they must not wrap to two lines on mobile.
     ========================================================== */

  var TABS = [
    { id: 'Project',  label: 'My Project', build: buildProjectTab },
    { id: 'Notes',    label: 'My Notes',   build: buildNotesTab },
    { id: 'Tasks',    label: 'My Tasks',   build: buildTasksTab },
    { id: 'Coaching', label: 'My Coach',   build: buildCoachTab }
  ];

  function buildTabs(container) {
    var bar = el('div', 'tab');

    TABS.forEach(function (tab, index) {
      var btn = el('button', 'tablinks', tab.label);
      btn.type = 'button';
      btn.addEventListener('click', function (evt) { openTab(evt, tab.id); });
      if (index === 0) btn.id = 'defaultOpen';
      mount(bar, btn);
    });

    mount(container, bar);

    TABS.forEach(function (tab) {
      var panel = el('div', 'tabcontent');
      panel.id = tab.id;
      tab.build(panel);
      mount(container, panel);
    });
  }

  function openTab(evt, tabName) {
    var panels = document.getElementsByClassName('tabcontent');
    for (var i = 0; i < panels.length; i++) panels[i].style.display = 'none';

    var links = document.getElementsByClassName('tablinks');
    for (var j = 0; j < links.length; j++) {
      links[j].className = links[j].className.replace(' active', '');
    }

    document.getElementById(tabName).style.display = 'block';
    evt.currentTarget.className += ' active';
  }

  /* ==========================================================
     MY NOTES TAB
     ========================================================== */

  function buildNotesTab(panel) {
    var h = el('h3');
    var strong = el('strong');
    mount(strong, el('em', null,
      'Your notes are saved to your account and available on any device you sign in from. Download a copy any time.'));
    mount(h, strong);
    mount(panel, h);

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
      .catch(function () { /* local cache already shown - fail quietly */ });
  }

  var saveNotesToD1 = debounce(function () {
    if (!STUDENT_ID) return;
    var field = document.getElementById('studentNotes');
    if (!field) return;
    fetch(PROXY_URL + '/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, text: field.value })
    }).catch(function () { /* localStorage already has it - sync is best-effort */ });
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

  /* ==========================================================
     MY TASKS TAB
     ========================================================== */

  function buildTasksTab(panel) {
    var h = el('h3', 'tracker-notice');
    mount(h, el('em', null,
      'Your tasks are saved to your account and available on any device you sign in from. Download a copy any time.'));
    mount(panel, h);

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
      .catch(function () { /* local cache already shown - fail quietly */ });
  }

  // Hooked into saveTasks() rather than each individual action, so add,
  // toggle, delete, clear-completed and reset all get the debounced D1 push
  // automatically through their existing saveTasks() call.
  var saveTasksToD1 = debounce(function () {
    if (!STUDENT_ID) return;
    fetch(PROXY_URL + '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, tasks: loadTasks() })
    }).catch(function () { /* localStorage already has it - sync is best-effort */ });
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

  // isoDate is "YYYY-MM-DD" from the date input - parse as local, not UTC,
  // so "Aug 10" doesn't shift to Aug 9 for anyone west of UTC.
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
     MY PROJECT TAB
     ----------------------------------------------------------
     localStorage is the shared channel between this tab and the
     coach: the coach reads these same keys fresh on every
     message it sends, so saving here takes effect immediately
     without any direct JS coupling between the two. D1 is the
     source of truth; localStorage is a fast local cache.
     ========================================================== */

  var PROJECT_FIELDS = [
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

  function buildProjectTab(panel) {
    var h = el('h3', 'tracker-notice');
    mount(h, el('em', null,
      "This information is saved to your account and carries forward to every lesson's coach — so it already knows your project by the time you get there. Update it any time your story changes."));
    mount(panel, h);

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
    // Instant fill from local cache so the form never opens empty on a repeat visit.
    var cached = {};
    eachProjectSpec(function (spec) {
      cached[spec.key] = lsGet(PROJ_KEYS[spec.key]) || '';
    });
    fillProjectForm(cached);

    if (!STUDENT_ID) return;

    // Then reconcile against D1, in case this student edited from another device.
    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known) return;
        // If the coach already learned this student's name mid-conversation
        // (via the [NAME: ...] tag) but that name was never explicitly saved
        // through My Project, D1 won't have it yet. Don't let an empty D1
        // value blank out a name that's already known locally.
        var merged = Object.assign({}, d);
        if (!merged.studentName) merged.studentName = lsGet(PROJ_KEYS.studentName) || '';
        fillProjectForm(merged);
        eachProjectSpec(function (spec) {
          lsSet(PROJ_KEYS[spec.key], merged[spec.key] || '');
        });
      })
      .catch(function () { /* local cache already shown - fail quietly */ });
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

    // Save locally right away regardless of network - the coach can use it
    // this session even if the server write is still in flight or fails.
    eachProjectSpec(function (spec) {
      lsSet(PROJ_KEYS[spec.key], fields[spec.key]);
    });

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
     MY COACH TAB — THE EXCAVATION COACH
     ========================================================== */

  var conversationHistory = [];
  var conversationId = null;
  var studentName = '';
  var reflectionComplete = false;
  var poolExhausted = false;
  var busy = false;

  var chatEl, formEl, inputEl, sendBtn, meterEl;

  /* ----------------------------------------------------------
     SYSTEM PROMPT ASSEMBLY
     ----------------------------------------------------------
     Universal coaching behaviour lives here and applies to
     every lesson. Lesson-specific material (transcript,
     reflection areas, calibration examples) comes from the
     fetched config. Change coaching behaviour once here and
     every lesson inherits it.
     ---------------------------------------------------------- */

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

  /* ----------------------------------------------------------
     PROJECT CONTEXT + LANGUAGE
     ---------------------------------------------------------- */

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

  /* ----------------------------------------------------------
     GREETING SELECTION
     ---------------------------------------------------------- */

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

  /* ----------------------------------------------------------
     CHAT UI
     ---------------------------------------------------------- */

  function buildCoachTab(panel) {
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

    var avatar = el('div', 'srx-avatar',
      role === 'assistant' ? 'TB' : (studentName ? studentName.charAt(0).toUpperCase() : 'Y'));
    mount(row, avatar);

    var bubble = el('div', 'srx-bubble', text);
    mount(row, bubble);

    mount(chatEl, row);
    scrollToBottom();
  }

  var typingRow = null;

  function showTyping() {
    typingRow = el('div', 'srx-row assistant');
    mount(typingRow, el('div', 'srx-avatar', 'TB'));

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

  /* ----------------------------------------------------------
     SESSION BALANCE
     ---------------------------------------------------------- */

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
      .catch(function () { /* balance is cosmetic - stay quiet */ });
  }

  function reportLessonComplete(summaryText) {
    if (!STUDENT_ID) return;
    fetch(PROXY_URL + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, lesson: LESSON_ID, summary: summaryText || null })
    })
      .then(function () { refreshExcavationRecord(); })
      .catch(function () { /* record update is cosmetic - fail quietly */ });
  }

  /* ----------------------------------------------------------
     PERSISTENCE
     ---------------------------------------------------------- */

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
    }).catch(function () { /* localStorage already has it - sync is best-effort */ });
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

  /* ----------------------------------------------------------
     CARDS
     ---------------------------------------------------------- */

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

  /* ----------------------------------------------------------
     WORD EXPORT
     ---------------------------------------------------------- */

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

  /* ----------------------------------------------------------
     SENDING
     ---------------------------------------------------------- */

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

  /* ----------------------------------------------------------
     BOOT
     ---------------------------------------------------------- */

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
    buildExcavationRecordShell(container);
    refreshExcavationRecord();

    buildVideo(container, LESSON.video.mediaId);
    buildTranscript(container, LESSON.video.mediaId);
    buildContactLine(container);

    buildResource(container, LESSON.resource);

    buildTabs(container);

    var defaultBtn = document.getElementById('defaultOpen');
    if (defaultBtn) defaultBtn.click();
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

    fetch(PROXY_URL + '/lesson-config?lessonId=' + encodeURIComponent(LESSON_ID))
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

  /* ==========================================================
     FLUSH ON EXIT
     ========================================================== */

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
