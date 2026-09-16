/* ============================================================
   STRATUM SESSIONS — LIVE COACHING REGISTRY (Sept 2026)
   ------------------------------------------------------------
   Was a static, hand-maintained list of coaching sessions; now fetches
   the real session-type + Layer data from the Worker (/excavations —
   see the admin-managed excavations/excavation_layers tables and the
   Excavations tab in stratum-lesson-admin.html, now Track-aware), so a
   new session type the admin creates under ANY track shows up
   automatically everywhere this file is read, with no code change and
   no redeploy needed here.

   Sept 2026: now fetches all three Tracks (Excavation, General
   Coaching, Writing) in parallel and merges them, not just Excavation —
   list()/get() work uniformly regardless of which track a session
   belongs to; each entry carries its own `track` field so consumers
   (stratum-coach.js, stratum-excavation-center.js) know which engine
   to run for it (Linear Layers -> Synthesis for Excavation; Recurring
   Check-In, with no fixed completion, for General/Writing).

   Consumers: stratum-excavation-center.js (the dashboard section
   listing every session with its status) and stratum-coach.js (the
   actual coaching page, looking up one session by slug). Neither of
   those needed a nav dropdown anymore once the dashboard section
   became the entry point (that dropdown was removed from stratum-
   header.js per Ted's request) — so this file no longer needs to
   serve stratum-header.js at all.

   Same async-ready coordination pattern already used by stratum-
   identity.js (sync flag + pending-callback queue + a matching event),
   since fetching live data means callers can no longer assume list()/
   get() are answerable the instant this script finishes loading.
   Language: reads the same 'wlfc_preferred_lang' localStorage key the
   header's Language dropdown already writes, same as stratum-coach.js
   and stratum-practice.js already do.

   Load this file AFTER stratum-identity.js (for PROXY_URL) and BEFORE
   stratum-excavation-center.js / stratum-coach.js on any page that
   uses either — same in-order loading requirement (async=false) as
   every other shared module in this codebase.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var LANG_STORE_KEY = 'wlfc_preferred_lang';
  var TRACKS = ['excavation', 'general', 'writing'];

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var LANG = lsGet(LANG_STORE_KEY) || 'en';

  var cachedSessions = null; // null until every track's fetch resolves; [] is a valid resolved-but-empty result
  var pendingCallbacks = [];

  function finalize(sessions) {
    cachedSessions = sessions || [];
    window.STRATUM_EXCAVATIONS_READY = true;
    document.dispatchEvent(new CustomEvent('stratum:excavations-ready', { detail: { excavations: cachedSessions } }));
    pendingCallbacks.forEach(function (cb) { cb(cachedSessions); });
    pendingCallbacks = [];
  }

  Promise.all(TRACKS.map(function (track) {
    return fetch(PROXY_URL + '/excavations?lang=' + encodeURIComponent(LANG) + '&track=' + encodeURIComponent(track))
      .then(function (r) { return r.json(); })
      .then(function (d) { return (d && Array.isArray(d.excavations)) ? d.excavations : []; })
      .catch(function () { return []; });
  })).then(function (perTrack) {
    finalize(Array.prototype.concat.apply([], perTrack));
  });

  window.StratumSessions = {
    // Call before using list()/get() unless you've already confirmed
    // window.STRATUM_EXCAVATIONS_READY is true — callback fires
    // immediately if every track's fetch has already resolved, or once
    // it does.
    ready: function (callback) {
      if (cachedSessions !== null) { callback(cachedSessions); return; }
      pendingCallbacks.push(callback);
    },
    // Synchronous accessors — only meaningful after ready() has fired
    // (matches window.StratumIdentity's init()-then-read pattern).
    list: function () { return cachedSessions || []; },
    get: function (slug) {
      return (cachedSessions || []).find(function (ex) { return ex.slug === slug; }) || null;
    }
  };
})();
