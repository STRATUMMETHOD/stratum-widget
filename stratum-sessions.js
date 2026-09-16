/* ============================================================
   STRATUM SESSIONS — LIVE EXCAVATIONS REGISTRY (Sept 2026)
   ------------------------------------------------------------
   Was a static, hand-maintained list of coaching sessions; now fetches
   the real Excavations + Layers data from the Worker (/excavations —
   see the new admin-managed excavations/excavation_layers tables and
   the Excavations tab in stratum-lesson-admin.html), so a new
   Excavation the admin creates shows up automatically everywhere this
   file is read, with no code change and no redeploy needed here.

   Consumers: stratum-excavation-center.js (the dashboard section
   listing every excavation with completion status) and stratum-
   coach.js (the actual coaching page, looking up one excavation by
   slug). Neither of those needed a nav dropdown anymore once the
   Excavation Center dashboard section became the entry point (that
   dropdown was removed from stratum-header.js per Ted's request) —
   so this file no longer needs to serve stratum-header.js at all.

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

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var LANG = lsGet(LANG_STORE_KEY) || 'en';

  var cachedExcavations = null; // null until the fetch resolves; [] is a valid resolved-but-empty result
  var pendingCallbacks = [];

  function finalize(excavations) {
    cachedExcavations = excavations || [];
    window.STRATUM_EXCAVATIONS_READY = true;
    document.dispatchEvent(new CustomEvent('stratum:excavations-ready', { detail: { excavations: cachedExcavations } }));
    pendingCallbacks.forEach(function (cb) { cb(cachedExcavations); });
    pendingCallbacks = [];
  }

  fetch(PROXY_URL + '/excavations?lang=' + encodeURIComponent(LANG))
    .then(function (r) { return r.json(); })
    .then(function (d) { finalize((d && Array.isArray(d.excavations)) ? d.excavations : []); })
    .catch(function () { finalize([]); });

  window.StratumSessions = {
    // Call before using list()/get() unless you've already confirmed
    // window.STRATUM_EXCAVATIONS_READY is true — callback fires
    // immediately if the fetch has already resolved, or once it does.
    ready: function (callback) {
      if (cachedExcavations !== null) { callback(cachedExcavations); return; }
      pendingCallbacks.push(callback);
    },
    // Synchronous accessors — only meaningful after ready() has fired
    // (matches window.StratumIdentity's init()-then-read pattern).
    list: function () { return cachedExcavations || []; },
    get: function (slug) {
      return (cachedExcavations || []).find(function (ex) { return ex.slug === slug; }) || null;
    }
  };
})();
