/* ============================================================
   STRATUM DASHBOARD — FOCUS TRACKING SECTION (Sept 2026)
   ------------------------------------------------------------
   Reads the SAME data the old engine's Notes ("Idea Log") and Tasks
   ("Reminders", formerly "Action Items") tabs already used — the
   /notes and /tasks endpoints and their existing record shapes are
   unchanged here, just rendered as a dashboard summary rather than a
   full editable list. This pass is read-only (see checkboxes below);
   the full Idea Log / Reminders views are a later stage, reached via
   the "Open" buttons once those pages exist.

   Mounts INTO the same dark card stratum-header.js builds, via the
   'stratum:header-mounted' handoff that file publishes (window.
   STRATUM_HEADER_WRAP + a matching event, so load order never
   matters) — this file never builds its own separate container.

   Data timing: stratum-header.js resolves the stratum_sid identity
   cookie asynchronously (a /resolve-identity round trip when logging
   in fresh via WordPress — see ensureIdentityFromWpUser() there), so
   this file does NOT read that cookie itself at load time, which
   would race that resolution and often run before the cookie exists.
   Instead it waits for the header's 'stratum:identity-ready' event
   and uses the studentId it carries, which is only fired once
   resolution has settled one way or another.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = 'https://stratum-proxy.tedbaker0207.workers.dev';
  var IDEA_LOG_LIMIT = 4;
  var REMINDERS_LIMIT = 4;

  // TODO: real page slugs once the full Idea Log / Reminders pages exist.
  var OPEN_LINKS = {
    ideaLog: '#',
    reminders: '#'
  };

  var STUDENT_ID = null; // set from the 'stratum:identity-ready' event detail — see init()

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  function formatRelativeDate(isoDateOrMs) {
    var d = typeof isoDateOrMs === 'number' ? new Date(isoDateOrMs) : new Date(isoDateOrMs + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    var days = Math.round((new Date().setHours(0, 0, 0, 0) - d.setHours(0, 0, 0, 0)) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 14) return days + ' days ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function formatShortDate(isoDate) {
    var d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fetchIdeaLogEntries(callback) {
    if (!STUDENT_ID) { callback([]); return; }
    fetch(PROXY_URL + '/notes?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known || !d.text) { callback([]); return; }
        var parsed;
        try { parsed = JSON.parse(d.text); } catch (e) { parsed = null; }
        callback(Array.isArray(parsed) ? parsed : []);
      })
      .catch(function () { callback([]); });
  }
  function fetchTasks(callback) {
    if (!STUDENT_ID) { callback([]); return; }
    fetch(PROXY_URL + '/tasks?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known || !Array.isArray(d.tasks)) { callback([]); return; }
        callback(d.tasks);
      })
      .catch(function () { callback([]); });
  }

  function buildIdeaLogCard() {
    var card = el('div', 'sh-dash-card');
    var head = el('div', 'sh-dash-card-head');
    mount(head, el('p', 'sh-dash-card-title', 'Idea Log'));
    var openBtn = document.createElement('a');
    openBtn.className = 'sh-dash-open-btn';
    openBtn.href = OPEN_LINKS.ideaLog;
    openBtn.textContent = 'Open';
    mount(head, openBtn);
    mount(card, head);

    var body = el('div', 'sh-dash-card-body');
    var grid = el('div', 'sh-idea-grid');
    mount(body, grid);
    mount(card, body);

    fetchIdeaLogEntries(function (entries) {
      var sorted = entries.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
      var recent = sorted.slice(0, IDEA_LOG_LIMIT);
      if (!recent.length) {
        grid.remove();
        mount(body, el('div', 'sh-dash-empty', 'No idea log entries yet.'));
        return;
      }
      recent.forEach(function (entry) {
        var item = el('div', 'sh-idea-entry');
        mount(item, el('div', 'sh-idea-icon', '\u{1F4AC}'));
        var text = document.createElement('div');
        var top = el('div', 'sh-idea-top');
        mount(top, el('span', 'sh-idea-tag', entry.category || 'General'));
        mount(top, el('span', null, formatRelativeDate(entry.createdAt || entry.date)));
        mount(text, top);
        mount(text, el('div', 'sh-idea-text', entry.text || ''));
        mount(item, text);
        mount(grid, item);
      });
    });

    return card;
  }

  function buildRemindersCard() {
    var card = el('div', 'sh-dash-card');
    var head = el('div', 'sh-dash-card-head');
    mount(head, el('p', 'sh-dash-card-title', 'Reminders'));
    var openBtn = document.createElement('a');
    openBtn.className = 'sh-dash-open-btn';
    openBtn.href = OPEN_LINKS.reminders;
    openBtn.textContent = 'Open';
    mount(head, openBtn);
    mount(card, head);

    var body = el('div', 'sh-dash-card-body');
    mount(card, body);

    fetchTasks(function (tasks) {
      // Open items first, then done — same ordering the old engine's
      // tracker rendered, so a returning student sees what's outstanding
      // before what's already checked off.
      var ordered = tasks.slice().sort(function (a, b) { return (a.done ? 1 : 0) - (b.done ? 1 : 0); });
      var visible = ordered.slice(0, REMINDERS_LIMIT);
      if (!visible.length) {
        mount(body, el('div', 'sh-dash-empty', 'No reminders yet.'));
        return;
      }
      visible.forEach(function (task) {
        var row = el('div', 'sh-reminder-row' + (task.done ? ' sh-row-done' : ''));
        var check = el('div', 'sh-check' + (task.done ? ' sh-done' : ''), task.done ? '\u2713' : '');
        mount(row, check);
        var textWrap = el('div', 'sh-reminder-text');
        mount(textWrap, el('div', 'sh-reminder-title', task.text || ''));
        if (!task.done && task.dueDate) {
          mount(textWrap, el('div', 'sh-reminder-meta', 'Due ' + formatShortDate(task.dueDate)));
        }
        mount(row, textWrap);
        if (task.dueDate) mount(row, el('div', 'sh-reminder-date', formatShortDate(task.dueDate)));
        mount(body, row);
      });
    });

    return card;
  }

  function buildDashboardSection() {
    var section = el('div', 'sh-dash-section');
    var panels = el('div', 'sh-dash-panels');
    mount(panels, buildIdeaLogCard());
    mount(panels, buildRemindersCard());
    mount(section, panels);
    return section;
  }

  function mountInto(wrapEl) {
    if (!wrapEl || wrapEl.querySelector('.sh-dash-section')) return; // avoid double-mount
    mount(wrapEl, buildDashboardSection());
  }

  // identity-ready always fires after the header's wrap element is
  // already mounted (see stratum-header.js — the wrap is built and
  // published before identity resolution even starts), so waiting on
  // this one signal covers both "DOM is ready" and "STUDENT_ID is
  // settled" — no separate wait on 'stratum:header-mounted' needed.
  function proceed(studentId) {
    STUDENT_ID = studentId || null;
    mountInto(window.STRATUM_HEADER_WRAP);
  }

  function init() {
    if (window.STRATUM_IDENTITY_READY) {
      proceed(window.STRATUM_STUDENT_ID);
      return;
    }
    document.addEventListener('stratum:identity-ready', function (e) {
      proceed(e.detail && e.detail.studentId);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
