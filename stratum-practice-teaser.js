/* ============================================================
   STRATUM PRACTICE TEASER — DASHBOARD CARD (Sept 2026)
   ------------------------------------------------------------
   A single small card on the dashboard surfacing "Today's Practice
   Term" (same deterministic day-of-year pick as stratum-practice.js's
   full page — not shared code, since the two load on different
   pages, but the same pick logic against the same term list yields
   the same term) with a snippet and progress count, linking out to
   the full Practice Lab page rather than embedding the whole
   searchable library inline — that library is large (search, two
   filters, pagination) and embedding all of it here would undercut
   the "not overwhelming" goal the rest of this dashboard has been
   built around. This is deliberately a teaser, not a duplicate.

   Reuses stratum-dashboard.css's sh-dash-card classes directly
   (already loaded on this page) so it looks IDENTICAL to the Idea
   Log/Reminders/Excavation Center cards, per Ted's explicit
   requirement — not a close visual approximation, the same classes.

   Mounts INTO the same dark card stratum-header.js builds, via the
   same 'stratum:identity-ready' signal every other dashboard module
   uses. Its position in that mount order (and therefore on the page)
   is controlled by its script's position in system-page-template.php.

   Requires stratum-identity.js loaded first on this page.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var LANG_STORE_KEY = 'wlfc_preferred_lang';

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var LANG = lsGet(LANG_STORE_KEY) || 'en';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  // Same day-of-year-modulo approach as stratum-practice.js's
  // pickTodaysTerm() — intentionally duplicated (not shared) since
  // these two files load on different pages; both landing on the same
  // term for the same day only requires the same deterministic
  // function over the same ordered list, not shared code.
  function dayOfYear() {
    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / 86400000);
  }

  function fetchTerms(callback) {
    fetch(PROXY_URL + '/vocabulary?lang=' + encodeURIComponent(LANG))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.terms)) ? d.terms : []); })
      .catch(function () { callback([]); });
  }
  function fetchPracticedCount(studentId, terms, callback) {
    if (!studentId || !terms.length) { callback(null); return; }
    fetch(PROXY_URL + '/practiced-terms?studentId=' + encodeURIComponent(studentId))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var termIds = (d && d.termIds) || [];
        var done = termIds.filter(function (id) { return terms.some(function (t) { return String(t.id) === String(id); }); }).length;
        callback(done);
      })
      .catch(function () { callback(null); });
  }

  function buildCard(studentId) {
    var card = el('div', 'sh-dash-card');
    var head = el('div', 'sh-dash-card-head');
    mount(head, el('p', 'sh-dash-card-title', 'Practice Lab'));
    var openLink = document.createElement('a');
    openLink.className = 'sh-dash-open-btn';
    openLink.href = '/practice/';
    openLink.textContent = 'View';
    mount(head, openLink);
    mount(card, head);

    var body = el('div', 'sh-dash-card-body');
    mount(card, body);

    fetchTerms(function (terms) {
      if (!terms.length) {
        mount(body, el('div', 'sh-dash-empty', 'No practice terms yet.'));
        return;
      }
      var term = terms[dayOfYear() % terms.length];
      mount(body, el('p', 'sh-pt-label', "Today's Practice Term"));
      mount(body, el('div', 'sh-pt-word', term.word));
      if (term.definition) {
        var snippet = term.definition.length > 120 ? term.definition.slice(0, 117) + '\u2026' : term.definition;
        mount(body, el('div', 'sh-pt-snippet', snippet));
      }
      fetchPracticedCount(studentId, terms, function (done) {
        if (done == null) return;
        mount(body, el('div', 'sh-pt-progress', done + ' of ' + terms.length + ' terms practiced'));
      });
    });

    return card;
  }

  // Sept 2026: Practice Lab and Library now sit side by side in one
  // shared two-column row (same "teaser row" pattern), per Ted's
  // request — this function is duplicated identically in stratum-
  // library-teaser.js so either file can find-or-create the shared
  // row and slot its own card into it, regardless of which script
  // actually finishes loading/mounting first (same order-independence
  // technique already used for window.STRATUM_HEADER_WRAP elsewhere).
  function getOrCreateTeaserRow(wrapEl) {
    var existing = wrapEl.querySelector('.sh-teaser-row');
    if (existing) return existing;
    var section = el('div', 'sh-teaser-section');
    var row = el('div', 'sh-teaser-row');
    mount(section, row);
    mount(wrapEl, section);
    return row;
  }

  function mountInto(wrapEl, studentId) {
    if (!wrapEl || wrapEl.querySelector('.sh-pt-slot')) return; // avoid double-mount
    var row = getOrCreateTeaserRow(wrapEl);
    var slot = el('div', 'sh-pt-slot');
    mount(slot, buildCard(studentId));
    mount(row, slot);
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
