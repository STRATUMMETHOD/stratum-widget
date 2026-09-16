/* ============================================================
   STRATUM EXCAVATION CENTER — DASHBOARD SECTION (Sept 2026)
   ------------------------------------------------------------
   Lists every coaching session (from the shared registry in
   stratum-sessions.js — Character Excavation today, more later)
   with its completion status, computed session-agnostically from the
   existing /completions endpoint: a session is Completed when every
   one of its layer ids has a completion record, In Progress when
   some but not all do, and Not Started when none do. This works
   identically for any future session (Essentials, Mastery) with no
   session-specific logic — deliberately NOT using the Character-
   Excavation-specific /excavation/master-deliverable endpoint for
   this, since that endpoint doesn't generalize to other sessions.

   Mounts INTO the same dark card stratum-header.js builds, directly
   below stratum-wip-panel.js's section and above stratum-
   dashboard.js's Idea Log/Reminders cards — see the script load
   order in system-page-template.php, which controls mount order via
   listener-attachment order on the shared 'stratum:identity-ready'
   signal (same pattern every module in this codebase uses).

   Each row's title links straight to that session's page — for an
   in-progress session, the page itself already resumes at the first
   incomplete layer (see stratum-coach.js's loadProgressThenStart()),
   so no special "which layer are they on" handling is needed here.

   Requires stratum-identity.js, stratum-header.js (for window.
   StratumHeader — not directly used here, but this section nests
   inside the wrap that function's topbar helper built), AND
   stratum-sessions.js loaded first on this page.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  function fetchCompletions(studentId, callback) {
    if (!studentId) { callback([]); return; }
    fetch(PROXY_URL + '/completions?studentId=' + encodeURIComponent(studentId))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.completions)) ? d.completions : []); })
      .catch(function () { callback([]); });
  }

  function computeStatus(session, completedLessonKeys) {
    var total = session.layers.length;
    var done = session.layers.filter(function (l) {
      return completedLessonKeys.indexOf(session.slug + ':' + l.layerNumber) !== -1;
    }).length;
    if (done === 0) return { key: 'not-started', label: 'Not Started' };
    if (done === total) return { key: 'completed', label: 'Completed' };
    return { key: 'in-progress', label: 'In Progress' };
  }

  function buildRow(session, status) {
    var row = el('div', 'sh-ec-row');
    var link = document.createElement('a');
    link.className = 'sh-ec-title';
    // No href is stored in the admin-managed excavation data — derived
    // from the slug instead, matching the WordPress page Ted creates
    // manually for each excavation (/coach/<slug>/). See the "automatic
    // listing, still-manual page creation" split Ted confirmed.
    link.href = '/coach/' + session.slug + '/';
    link.textContent = session.title;
    mount(row, link);
    mount(row, el('span', 'sh-ec-badge sh-ec-badge--' + status.key, status.label));
    return row;
  }

  function buildSection(studentId) {
    var section = el('div', 'sh-ec-section');
    mount(section, el('p', 'sh-ec-label', 'Excavation Center'));

    var listEl = el('div', 'sh-ec-list');
    mount(section, listEl);
    mount(listEl, el('div', 'sh-ec-empty', 'Loading\u2026'));

    if (!window.StratumSessions) {
      listEl.innerHTML = '';
      mount(listEl, el('div', 'sh-ec-empty', 'No coaching sessions available yet.'));
      return section;
    }
    window.StratumSessions.ready(function (sessions) {
      if (!sessions.length) {
        listEl.innerHTML = '';
        mount(listEl, el('div', 'sh-ec-empty', 'No coaching sessions available yet.'));
        return;
      }
      fetchCompletions(studentId, function (completions) {
        var completedLessonKeys = completions.map(function (c) { return c.lesson; });
        listEl.innerHTML = '';
        sessions.forEach(function (session) {
          var status = computeStatus(session, completedLessonKeys);
          mount(listEl, buildRow(session, status));
        });
      });
    });

    return section;
  }

  function mountInto(wrapEl, studentId) {
    if (!wrapEl || wrapEl.querySelector('.sh-ec-section')) return; // avoid double-mount
    mount(wrapEl, buildSection(studentId));
  }

  function proceed(studentId) {
    mountInto(window.STRATUM_HEADER_WRAP, studentId || null);
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
