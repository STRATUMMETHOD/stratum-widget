/* ============================================================
   STRATUM IDEA LOG — PAGE LOGIC (Sept 2026)
   ------------------------------------------------------------
   Full port of the old engine's Notes tab (buildNotesTab and its
   supporting functions in stratum-lesson-engine.js): categorized,
   dated entries, add/filter/delete, and a .txt download — same
   /notes GET/POST endpoint, same JSON-array-of-entries record shape,
   same legacy-single-blob migration for any pre-existing student
   whose notes_text predates this format. This page IS the "Open"
   destination from the Idea Log card on the System Page dashboard
   (stratum-dashboard.js) — reached only from there, not from the
   avatar dropdown.

   Requires stratum-identity.js AND stratum-header.js (for
   window.StratumHeader.buildTopbar) loaded first on this page.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var WP_USER = window.StratumIdentity ? window.StratumIdentity.getWpUser() : { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };

  var CATEGORIES = ['Character', 'Plot', 'Theme', 'Revision', 'Research', 'Deadlines', 'Inspiration'];
  var GENERAL_CATEGORY = 'General'; // tag used for migrated legacy single-blob notes

  var STUDENT_ID = null;
  var entries = [];
  var listEl, filterSelect, categorySelect, textInput, addStatusEl;

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
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ----------------------------------------------------------
  // DATA
  // ----------------------------------------------------------
  function loadEntries(callback) {
    fetch(PROXY_URL + '/notes?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known || !d.text) { entries = []; callback(); return; }
        var parsed;
        try { parsed = JSON.parse(d.text); } catch (e) { parsed = null; }
        if (Array.isArray(parsed)) {
          entries = parsed;
        } else if (String(d.text).trim()) {
          // Legacy single free-text blob from before this format existed —
          // migrate into one General-tagged entry rather than losing it.
          entries = [{
            id: 'legacy-' + Date.now().toString(36),
            category: GENERAL_CATEGORY,
            date: new Date().toISOString().slice(0, 10),
            createdAt: Date.now(),
            text: d.text
          }];
          saveEntries();
        } else {
          entries = [];
        }
        callback();
      })
      .catch(function () { entries = []; callback(); });
  }
  function saveEntries() {
    fetch(PROXY_URL + '/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, text: JSON.stringify(entries) })
    }).catch(function () {});
  }

  function addEntry() {
    var category = categorySelect.value;
    var text = textInput.value.trim();
    if (!category || !text) {
      addStatusEl.textContent = 'Choose a category and write something first.';
      return;
    }
    entries.unshift({
      id: Date.now().toString(),
      category: category,
      date: new Date().toISOString().slice(0, 10),
      createdAt: Date.now(),
      text: text
    });
    saveEntries();
    categorySelect.value = '';
    textInput.value = '';
    addStatusEl.textContent = '';
    renderList();
  }
  function deleteEntry(id) {
    entries = entries.filter(function (e) { return e.id !== id; });
    saveEntries();
    renderList();
  }

  // ----------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------
  function renderList() {
    var sorted = entries.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var filterVal = filterSelect.value;
    var filtered = filterVal ? sorted.filter(function (e) { return e.category === filterVal; }) : sorted;
    listEl.innerHTML = '';
    if (!filtered.length) {
      mount(listEl, el('div', 'sh-il-empty', filterVal ? 'No entries in this category yet.' : 'No entries yet. Add one above.'));
      return;
    }
    filtered.forEach(function (entry) {
      var isLegacy = entry.category === GENERAL_CATEGORY;
      var row = el('div', 'sh-il-entry' + (isLegacy ? ' sh-il-legacy' : ''));
      var head = el('div', 'sh-il-entry-head');
      mount(head, el('span', 'sh-il-tag', entry.category));
      mount(head, el('span', 'sh-il-date', formatDate(entry.date)));
      mount(row, head);
      mount(row, el('div', 'sh-il-text', entry.text));
      var del = el('button', 'sh-il-delete', '\u00d7');
      del.type = 'button';
      del.title = 'Delete entry';
      del.addEventListener('click', function () { deleteEntry(entry.id); });
      mount(row, del);
      mount(listEl, row);
    });
  }

  function downloadEntries() {
    var sorted = entries.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    if (!sorted.length) { alert('No entries to download.'); return; }
    var dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var txt = 'THE STRATUM METHOD \u2014 MY IDEA LOG\nExported: ' + dateStr + '\n==========================================\n\n';
    sorted.forEach(function (e) {
      txt += '[' + e.category + '] ' + formatDate(e.date) + '\n' + e.text + '\n\n';
    });
    var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'MyIdeaLog.txt';
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
    mount(body, el('h1', 'sh-form-title', 'Idea Log'));
    mount(body, el('p', 'sh-form-sub', 'Jot down character insights, a plot twist, a research note, or a passing thought. Your coach reads these and folds them into your sessions.'));

    // ---- Add form ----
    var form = el('div', 'sh-il-form');
    var formRow = el('div', 'sh-il-form-row');
    categorySelect = document.createElement('select');
    categorySelect.className = 'sh-il-category-select';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose a category\u2026';
    categorySelect.appendChild(placeholder);
    CATEGORIES.forEach(function (cat) {
      var o = document.createElement('option');
      o.value = cat;
      o.textContent = cat;
      categorySelect.appendChild(o);
    });
    mount(formRow, categorySelect);
    textInput = document.createElement('textarea');
    textInput.className = 'sh-il-text-input';
    textInput.placeholder = 'Write your note\u2026';
    textInput.maxLength = 2000;
    mount(formRow, textInput);
    mount(form, formRow);
    var formFoot = el('div', 'sh-il-form-foot');
    addStatusEl = el('span', 'sh-il-add-status');
    mount(formFoot, addStatusEl);
    var addBtn = el('button', 'sh-save-btn', 'Add Entry');
    addBtn.type = 'button';
    addBtn.addEventListener('click', addEntry);
    mount(formFoot, addBtn);
    mount(form, formFoot);
    mount(body, form);

    // ---- Filter ----
    var toolbar = el('div', 'sh-il-toolbar');
    mount(toolbar, el('span', 'sh-il-filter-label', 'Filter'));
    filterSelect = document.createElement('select');
    filterSelect.className = 'sh-il-filter-select';
    var allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All';
    filterSelect.appendChild(allOpt);
    CATEGORIES.concat([GENERAL_CATEGORY]).forEach(function (cat) {
      var o = document.createElement('option');
      o.value = cat;
      o.textContent = cat;
      filterSelect.appendChild(o);
    });
    filterSelect.addEventListener('change', renderList);
    mount(toolbar, filterSelect);
    var dlBtn = el('button', 'sh-il-download-btn', 'Download');
    dlBtn.type = 'button';
    dlBtn.addEventListener('click', downloadEntries);
    mount(toolbar, dlBtn);
    mount(body, toolbar);

    listEl = el('div', 'sh-il-list');
    mount(body, listEl);

    mount(wrap, body);
    mount(container, wrap);

    loadEntries(renderList);
  }

  function init() {
    var container = document.getElementById('stratum-idea-log');
    if (!container) {
      console.error('[Stratum] No #stratum-idea-log container found on this page.');
      return;
    }
    if (!WP_USER.loggedIn) {
      buildGate(container, 'Please log in to view your Idea Log.', WP_USER.loginUrl, 'Log in');
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
