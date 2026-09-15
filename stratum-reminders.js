/* ============================================================
   STRATUM REMINDERS — PAGE LOGIC (Sept 2026)
   ------------------------------------------------------------
   Full port of the old engine's Tasks tab (buildTasksTab, formerly
   "Action Items", and its supporting functions in stratum-lesson-
   engine.js): add/toggle/delete/clear-completed/reset, a category
   preset dropdown that fills the text input, an optional due date,
   and a .txt download — same /tasks GET/POST endpoint, same JSON-
   array-of-tasks record shape. This page IS the "Open" destination
   from the Reminders card on the System Page dashboard (stratum-
   dashboard.js) — reached only from there, not from the avatar
   dropdown.

   Requires stratum-identity.js AND stratum-header.js (for
   window.StratumHeader.buildTopbar) loaded first on this page.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var WP_USER = window.StratumIdentity ? window.StratumIdentity.getWpUser() : { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };

  var PRESETS = [
    'Finish a chapter draft', 'Revise a scene', 'Outline next section',
    'Character deep dive', 'Check continuity', 'Polish opening paragraph',
    'Deadline for manuscript changes', 'Submit to beta reader',
    'Research setting details', 'Track word count goal',
    'Prepare query letter', 'Finalize antagonist arc'
  ];

  var STUDENT_ID = null;
  var tasks = [];
  var listEl, countEl, categorySelect, textInput, dateInput;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  function formatDate(isoDate) {
    var parts = String(isoDate).split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ----------------------------------------------------------
  // DATA
  // ----------------------------------------------------------
  function loadTasks(callback) {
    fetch(PROXY_URL + '/tasks?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) { tasks = (d && d.known && Array.isArray(d.tasks)) ? d.tasks : []; callback(); })
      .catch(function () { tasks = []; callback(); });
  }
  function saveTasks() {
    fetch(PROXY_URL + '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, tasks: tasks })
    }).catch(function () {});
  }

  function addTask() {
    var text = textInput.value.trim();
    if (!text) return;
    var dueDate = dateInput.value || null;
    tasks.push({ id: Date.now().toString(), text: text, done: false, dueDate: dueDate });
    saveTasks();
    textInput.value = '';
    dateInput.value = '';
    renderList();
  }
  function toggleTask(id) {
    var task = tasks.find(function (t) { return t.id === id; });
    if (task) task.done = !task.done;
    saveTasks();
    renderList();
  }
  function deleteTask(id) {
    tasks = tasks.filter(function (t) { return t.id !== id; });
    saveTasks();
    renderList();
  }
  function clearCompleted() {
    tasks = tasks.filter(function (t) { return !t.done; });
    saveTasks();
    renderList();
  }
  function resetAll() {
    if (!confirm('Delete all reminders? This cannot be undone.')) return;
    tasks = [];
    saveTasks();
    renderList();
  }

  // ----------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------
  function renderList() {
    listEl.innerHTML = '';
    if (!tasks.length) {
      mount(listEl, el('div', 'sh-rm-empty', 'No reminders yet. Add one above.'));
      countEl.textContent = '';
      return;
    }
    var remaining = tasks.filter(function (t) { return !t.done; }).length;
    countEl.textContent = remaining === 0 ? 'All reminders complete.' : (remaining + ' of ' + tasks.length + ' remaining.');
    var todayStr = new Date().toISOString().slice(0, 10);
    tasks.forEach(function (task) {
      var row = el('div', 'sh-rm-item' + (task.done ? ' sh-rm-done' : ''));
      var check = el('div', 'sh-rm-checkbox');
      check.addEventListener('click', function () { toggleTask(task.id); });
      mount(row, check);
      var textWrap = el('div', 'sh-rm-text-wrap');
      var text = el('div', 'sh-rm-text', task.text);
      text.addEventListener('click', function () { toggleTask(task.id); });
      mount(textWrap, text);
      if (task.dueDate) {
        var overdue = !task.done && task.dueDate < todayStr;
        var due = el('div', 'sh-rm-due' + (overdue ? ' sh-rm-overdue' : ''),
          (overdue ? 'Overdue \u2014 was due ' : 'Due ') + formatDate(task.dueDate));
        mount(textWrap, due);
      }
      mount(row, textWrap);
      var del = el('button', 'sh-rm-delete', '\u00d7');
      del.type = 'button';
      del.title = 'Delete reminder';
      del.addEventListener('click', function () { deleteTask(task.id); });
      mount(row, del);
      mount(listEl, row);
    });
  }

  function downloadTasks() {
    if (!tasks.length) { alert('No reminders to download.'); return; }
    var dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var txt = 'THE STRATUM METHOD \u2014 MY REMINDERS\nExported: ' + dateStr + '\n==========================================\n\n';
    tasks.forEach(function (t) {
      txt += (t.done ? '[x] ' : '[ ] ') + t.text;
      if (t.dueDate) txt += '  (due ' + formatDate(t.dueDate) + ')';
      txt += '\n';
    });
    var remaining = tasks.filter(function (t) { return !t.done; }).length;
    txt += '\n==========================================\n' + remaining + ' of ' + tasks.length + ' remaining.\n';
    var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'MyReminders.txt';
    link.click();
  }

  // ----------------------------------------------------------
  // PAGE SHELL
  // ----------------------------------------------------------
  function buildGate(container, message, linkHref, linkText) {
    container.innerHTML = '';
    var wrap = el('div', 'sh-wrap sh-page');
    if (window.StratumHeader) window.StratumHeader.buildTopbar(wrap);
    var body = el('div', 'sh-gate');
    mount(body, el('p', null, message));
    var link = document.createElement('a');
    link.className = 'sh-save-btn';
    link.href = linkHref;
    link.textContent = linkText;
    mount(body, link);
    mount(wrap, body);
    mount(container, wrap);
  }

  function buildPage(container) {
    var wrap = el('div', 'sh-wrap sh-page');
    if (window.StratumHeader) window.StratumHeader.buildTopbar(wrap);

    var crumb = el('div', 'sh-page-topbar');
    var back = document.createElement('a');
    back.className = 'sh-page-back';
    back.href = '/system/';
    back.textContent = '\u2190 Back to Dashboard';
    mount(crumb, back);
    mount(wrap, crumb);

    var body = el('div', 'sh-form-body');
    mount(body, el('h1', 'sh-form-title', 'Reminders'));
    mount(body, el('p', 'sh-form-sub', "Track what's next for your WIP \u2014 finish a draft, revise a scene, prep a query. Your coach refers to this during your sessions."));

    // ---- Add form ----
    var form = el('div', 'sh-rm-form');
    var presetRow = el('div', 'sh-rm-preset-row');
    categorySelect = document.createElement('select');
    categorySelect.className = 'sh-rm-preset-select';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a type\u2026';
    categorySelect.appendChild(placeholder);
    PRESETS.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p;
      o.textContent = p;
      categorySelect.appendChild(o);
    });
    var customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Write your own\u2026';
    categorySelect.appendChild(customOpt);
    mount(presetRow, categorySelect);
    mount(form, presetRow);

    var inputRow = el('div', 'sh-rm-input-row');
    textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'sh-rm-text-input';
    textInput.placeholder = "Add a reminder \u2014 e.g. Rewrite Eleanor's kitchen scene";
    textInput.maxLength = 200;
    textInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') addTask(); });
    mount(inputRow, textInput);
    categorySelect.addEventListener('change', function () {
      var val = categorySelect.value;
      if (!val) return;
      textInput.value = (val === '__custom__') ? '' : val;
      textInput.focus();
      categorySelect.value = '';
    });
    dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'sh-rm-date-input';
    mount(inputRow, dateInput);
    var addBtn = el('button', 'sh-save-btn', 'Add');
    addBtn.type = 'button';
    addBtn.addEventListener('click', addTask);
    mount(inputRow, addBtn);
    mount(form, inputRow);
    mount(body, form);

    countEl = el('div', 'sh-rm-count');
    mount(body, countEl);

    listEl = el('div', 'sh-rm-list');
    mount(body, listEl);

    var actions = el('div', 'sh-rm-actions');
    var dlBtn = el('button', 'sh-rm-action-btn', 'Download');
    dlBtn.type = 'button';
    dlBtn.addEventListener('click', downloadTasks);
    mount(actions, dlBtn);
    var clearBtn = el('button', 'sh-rm-action-btn', 'Clear Completed');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', clearCompleted);
    mount(actions, clearBtn);
    var resetBtn = el('button', 'sh-rm-action-btn sh-rm-action-btn--danger', 'Reset All');
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', resetAll);
    mount(actions, resetBtn);
    mount(body, actions);

    mount(wrap, body);
    mount(container, wrap);

    loadTasks(renderList);
  }

  function init() {
    var container = document.getElementById('stratum-reminders');
    if (!container) {
      console.error('[Stratum] No #stratum-reminders container found on this page.');
      return;
    }
    if (!WP_USER.loggedIn) {
      buildGate(container, 'Please log in to view your Reminders.', WP_USER.loginUrl, 'Log in');
      return;
    }
    if (!WP_USER.hasMembership) {
      buildGate(container, 'Your account doesn\u2019t have an active Stratum Method membership yet.', '/membership-account/', 'Go to My Account');
      return;
    }
    window.StratumIdentity.init(function (studentId) {
      if (!studentId) {
        buildGate(container, 'Could not connect your account. Refresh and try again.', '/system/', '\u2190 Back to Dashboard');
        return;
      }
      STUDENT_ID = studentId;
      buildPage(container);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
