/* ============================================================
   STRATUM WHAT'S NEW — DASHBOARD CARD (Sept 2026)
   ------------------------------------------------------------
   Admin-authored announcements card, mounted above the Profile panel
   (see system-page-template.php script order — this file loads
   before stratum-wip-panel.js, and mount order is DOM order since
   every module's mountInto() just appends straight into the shared
   wrap). Content comes from GET /dashboard-updates, admin-managed via
   the Dashboard Updates screen — see worker.js.

   Unlike every other dashboard card, this one renders NOTHING at all
   — not even an empty-state card — when there are zero active
   entries, per explicit request: a quiet dashboard with no news is
   the correct state, not a card announcing "nothing here yet."

   Reuses stratum-dashboard.css's sh-dash-card classes directly (card
   shell, head, title, body) so it looks identical to the Idea Log/
   Reminders/Excavation Center cards. List rows and the cap-2 + View
   All/Show Less toggle follow stratum-excavation-center.js's exact
   pattern (same interaction already established on this dashboard,
   not a new one).

   Requires stratum-identity.js loaded first on this page.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var LANG_STORE_KEY = 'wlfc_preferred_lang';

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var LANG = lsGet(LANG_STORE_KEY) || 'en';

  var STRINGS = {
    en: { title: 'What\u2019s New', viewAll: 'View All', showLess: 'Show Less' },
    es: { title: 'Novedades', viewAll: 'Ver todo', showLess: 'Ver menos' }
  };
  var DB_STRINGS = null;
  var uiStringsCallbacks = [];
  function loadUiStrings(callback) {
    if (DB_STRINGS) { callback(); return; }
    uiStringsCallbacks.push(callback);
    if (uiStringsCallbacks.length > 1) return;
    fetch(PROXY_URL + '/ui-strings?lang=' + encodeURIComponent(LANG))
      .then(function (r) { return r.json(); })
      .then(function (d) { DB_STRINGS = (d && d.strings) || {}; })
      .catch(function () { DB_STRINGS = {}; })
      .then(function () {
        var cbs = uiStringsCallbacks; uiStringsCallbacks = [];
        cbs.forEach(function (cb) { cb(); });
      });
  }
  function t(key) {
    if (DB_STRINGS) {
      var dbVal = DB_STRINGS['dashboard.updates' + key.charAt(0).toUpperCase() + key.slice(1)];
      if (dbVal != null) return dbVal;
    }
    return (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key];
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  function fetchUpdates(callback) {
    fetch(PROXY_URL + '/dashboard-updates?lang=' + encodeURIComponent(LANG))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.updates)) ? d.updates : []); })
      .catch(function () { callback([]); });
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    // postedAt is stored as a plain YYYY-MM-DD, not a timestamp — parse
    // it as a local date (not UTC midnight) so it never displays one
    // day off depending on the viewer's timezone.
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(LANG === 'es' ? 'es-ES' : undefined, { month: 'short', day: 'numeric' });
  }

  function buildRow(update) {
    var row = el('div', 'sh-upd-row');
    mount(row, el('div', 'sh-upd-title', update.title));
    if (update.body) mount(row, el('div', 'sh-upd-body', update.body));
    var dateStr = formatDate(update.postedAt);
    if (dateStr) mount(row, el('div', 'sh-upd-date', dateStr));
    return row;
  }

  function buildCard(updates) {
    var card = el('div', 'sh-dash-card');
    var head = el('div', 'sh-dash-card-head');
    mount(head, el('p', 'sh-dash-card-title', t('title')));
    var viewAllBtn = document.createElement('button');
    viewAllBtn.type = 'button';
    viewAllBtn.className = 'sh-dash-open-btn';
    viewAllBtn.textContent = t('viewAll');
    mount(head, viewAllBtn);
    mount(card, head);

    var body = el('div', 'sh-dash-card-body');
    var listEl = el('div', 'sh-upd-list');
    mount(body, listEl);
    mount(card, body);

    var rowEls = updates.map(function (u) {
      var row = buildRow(u);
      mount(listEl, row);
      return row;
    });

    // Same cap-2 + View All/Show Less pattern as the Excavation Center
    // cards — only shown (and only active) once there's actually
    // something to expand.
    var expanded = false;
    function updateVisibility() {
      rowEls.forEach(function (r, i) { r.style.display = (expanded || i < 2) ? '' : 'none'; });
    }
    updateVisibility();
    if (rowEls.length > 2) {
      viewAllBtn.addEventListener('click', function () {
        expanded = !expanded;
        viewAllBtn.textContent = expanded ? t('showLess') : t('viewAll');
        updateVisibility();
      });
    } else {
      viewAllBtn.style.display = 'none';
    }

    return card;
  }

  function mountInto(wrapEl) {
    if (!wrapEl || wrapEl.querySelector('.sh-upd-list')) return; // avoid double-mount
    fetchUpdates(function (updates) {
      if (!updates.length) return; // no card at all when there's nothing new — see file header
      // Sept 2026 fix: every other dashboard module (stratum-dashboard.js's
      // .sh-dash-section, the teasers' .sh-teaser-section) wraps its card(s)
      // in a padded section before mounting into wrapEl. This file was
      // mounting the bare card straight into wrapEl with no such wrapper,
      // so it rendered flush against the page edge instead of inset like
      // every card below it - wrap it the same way here.
      var section = el('div', 'sh-upd-section');
      mount(section, buildCard(updates));
      // Sept 2026 fix, corrected: wrapEl.firstChild is actually the
      // background strata-art SVG (stratum-header.js inserts it via
      // insertAdjacentHTML('afterbegin', ...) before mounting anything
      // else) - inserting before firstChild would have pushed this card
      // above the topbar and "Welcome" heading entirely, not just above
      // Profile. Instead, find the last element that's actually part of
      // the header block (art / topbar / welcome row / the logged-out or
      // no-membership notice row, per stratum-header.css's sh-strata-art/
      // sh-topbar/sh-welcome-row/sh-hero-row classes) and insert right
      // after it. This works regardless of whether Profile (or anything
      // else) has already been appended by the time this async fetch
      // resolves - insertBefore(headerEl.nextSibling) lands right after
      // the header block either way, which is always above Profile
      // without needing to know Profile's own class name at all.
      var headerSelectors = ['.sh-strata-art', '.sh-topbar', '.sh-welcome-row', '.sh-hero-row'];
      var lastHeaderEl = null;
      Array.prototype.forEach.call(wrapEl.children, function (child) {
        var isHeaderPart = headerSelectors.some(function (sel) { return child.matches(sel); });
        if (isHeaderPart) lastHeaderEl = child;
      });
      wrapEl.insertBefore(section, lastHeaderEl ? lastHeaderEl.nextSibling : wrapEl.firstChild);
    });
  }

  function proceed() {
    loadUiStrings(function () {
      mountInto(window.STRATUM_HEADER_WRAP);
    });
  }

  function init() {
    if (window.STRATUM_IDENTITY_READY) {
      proceed();
      return;
    }
    document.addEventListener('stratum:identity-ready', function () {
      proceed();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
