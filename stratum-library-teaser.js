/* ============================================================
   STRATUM LIBRARY TEASER — DASHBOARD CARD (Sept 2026)
   ------------------------------------------------------------
   Sits in the shared two-column "teaser row" alongside Practice
   Lab's dashboard card (see stratum-practice-teaser.js/.css for the
   getOrCreateTeaserRow() pattern this file mirrors exactly — either
   file can find-or-create the shared row and slot its own card in,
   regardless of which script actually finishes loading first).

   Surfaces one deterministically-featured resource per day — same
   day-of-year-modulo pick technique as Practice Lab's "Today's
   Practice Term" (intentionally duplicated logic, not shared code,
   same reasoning as there: this file and stratum-library.js's own
   copy load on different pages). "A new file every day" — yes, this
   is exactly that: the pick changes once per calendar day, same
   featured resource for every student that day, cycling through the
   full active resource list in order.

   Reuses stratum-dashboard.css's sh-dash-card classes directly so it
   looks IDENTICAL to the other dashboard cards, same as every other
   teaser/section on this page.

   Requires stratum-identity.js loaded first on this page.

   ---- Database-backed translation (Sept 2026) ----
   t() checks DB overrides fetched from GET /ui-strings?lang= FIRST, then
   falls back to the STRINGS.en/es defaults below. This means adding a
   NEW language (anything beyond English/Spanish) needs zero code changes
   here - fill in translations for the "library.*" keys under Manage UI
   Strings in the admin panel and this card picks them up on next load.
   The fetch is awaited before building (see init()) so a language with
   no local en/es block still renders correctly on first paint, not just
   after a later patch.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var LANG_STORE_KEY = 'wlfc_preferred_lang'; // same key the header's Language dropdown sets
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var LANG = lsGet(LANG_STORE_KEY) || 'en';

  var STRINGS = {
    en: { title: 'Library', subtitle: 'Curated articles and resources on fiction writing.', view: 'View', noResourcesYet: 'No resources yet.', label: 'Today\u2019s Featured Resource', video: 'Video', pdf: 'PDF' },
    es: { title: 'Biblioteca', subtitle: 'Artículos y recursos seleccionados sobre la escritura de ficción.', view: 'Ver', noResourcesYet: 'Aún no hay recursos.', label: 'Recurso destacado de hoy', video: 'Video', pdf: 'PDF' }
  };
  // 'view' is shared across several cards - stored under the DB's
  // "common.*" namespace, not "library.*", so a translation entered once
  // (from any of those cards' perspective in admin) covers all of them.
  var DB_COMMON_KEYS = { view: 'view' };
  var DB_STRINGS = null;
  var uiStringsCallbacks = [];
  function loadUiStrings(callback) {
    if (DB_STRINGS) { callback(); return; }
    uiStringsCallbacks.push(callback);
    if (uiStringsCallbacks.length > 1) return; // a fetch is already in flight
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
      var dbKey = DB_COMMON_KEYS[key] ? ('common.' + DB_COMMON_KEYS[key]) : ('library.' + key);
      if (DB_STRINGS[dbKey] != null) return DB_STRINGS[dbKey];
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

  // Sept 2026 fix: see stratum-updates.js/stratum-wip-panel.js for the
  // full comment - duplicated identically here. RANK ORDER: 0 What's
  // New, 1 Profile, 2 Coaching columns, 3 Practice/Library teaser row
  // (this file), 4 Idea Log/Reminders.
  function insertAtDashOrder(wrapEl, section, rank) {
    section.setAttribute('data-dash-order', String(rank));
    var children = Array.prototype.slice.call(wrapEl.children);
    var before = null;
    for (var i = 0; i < children.length; i++) {
      var childRank = children[i].getAttribute('data-dash-order');
      if (childRank !== null && Number(childRank) > rank) { before = children[i]; break; }
    }
    wrapEl.insertBefore(section, before);
  }

  // Same day-of-year-modulo approach as stratum-practice-teaser.js and
  // stratum-practice.js's pickTodaysTerm() — intentionally duplicated,
  // not shared, since this loads on a different page than either.
  function dayOfYear() {
    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / 86400000);
  }

  function fetchResources(callback) {
    fetch(PROXY_URL + '/library')
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.resources)) ? d.resources : []); })
      .catch(function () { callback([]); });
  }

  function buildCard() {
    var card = el('div', 'sh-dash-card');
    var head = el('div', 'sh-dash-card-head');
    var headTop = el('div', 'sh-dash-card-head-top');
    mount(headTop, el('p', 'sh-dash-card-title', t('title')));
    var openLink = document.createElement('a');
    openLink.className = 'sh-dash-open-btn';
    openLink.href = '/library/';
    openLink.textContent = t('view');
    mount(headTop, openLink);
    mount(head, headTop);
    mount(head, el('p', 'sh-dash-card-subtitle', t('subtitle')));
    mount(card, head);

    var body = el('div', 'sh-dash-card-body');
    mount(card, body);

    fetchResources(function (resources) {
      if (!resources.length) {
        mount(body, el('div', 'sh-dash-empty', t('noResourcesYet')));
        return;
      }
      var resource = resources[dayOfYear() % resources.length];
      mount(body, el('p', 'sh-pt-label', t('label')));
      mount(body, el('div', 'sh-pt-word', resource.title));
      var meta = el('div', 'sh-lt-meta');
      mount(meta, el('span', 'sh-lt-tag', resource.category));
      mount(meta, el('span', 'sh-lt-tag sh-lt-tag--type', resource.type === 'video' ? t('video') : t('pdf')));
      mount(body, meta);
    });

    return card;
  }

  // Same find-or-create shared row as stratum-practice-teaser.js — see
  // that file for the fuller comment on why this is order-independent.
  function getOrCreateTeaserRow(wrapEl) {
    var existing = wrapEl.querySelector('.sh-teaser-row');
    if (existing) return existing;
    var section = el('div', 'sh-teaser-section');
    var row = el('div', 'sh-teaser-row');
    mount(section, row);
    insertAtDashOrder(wrapEl, section, 3);
    return row;
  }

  function mountInto(wrapEl) {
    if (!wrapEl || wrapEl.querySelector('.sh-lt-slot')) return; // avoid double-mount
    var row = getOrCreateTeaserRow(wrapEl);
    var slot = el('div', 'sh-lt-slot');
    mount(slot, buildCard());
    mount(row, slot);
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
