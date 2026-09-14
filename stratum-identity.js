/* ============================================================
   STRATUM IDENTITY — SHARED MODULE (Sept 2026)
   ------------------------------------------------------------
   Extracted out of stratum-header.js so the same WordPress-login →
   stratum_sid identity resolution logic isn't duplicated across every
   page that needs it (System Page, WIP Profile, and any future page).
   Load this ONE file first on any page that needs identity, before
   stratum-header.js / stratum-wip-profile.js / etc.

   Every consuming page's PHP template must set window.STRATUM_WP_USER
   the same way system-page-template.php already does (loggedIn,
   hasMembership, firstName, email, loginUrl) — this file reads that,
   same contract as before.

   Public API (window.StratumIdentity):
     .PROXY_URL            — the Worker base URL, shared so pages
                              don't redeclare it.
     .getWpUser()           — returns the WP_USER object read from
                              window.STRATUM_WP_USER (safe fallback
                              shape if the template didn't set it).
     .init(callback)         — resolves/creates the stratum_sid
                              identity for a logged-in member (same
                              /resolve-identity call as before), then
                              calls callback(studentId) once settled
                              (studentId is null if logged out, no
                              membership, or resolution failed). Safe
                              to call from multiple scripts on the same
                              page — only resolves once; later callers
                              get the already-settled result.

   Same dual pattern as before (synchronous global + event) so load
   order between scripts on a page never matters:
     window.STRATUM_IDENTITY_READY / window.STRATUM_STUDENT_ID
     'stratum:identity-ready' event, detail: { studentId }
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = 'https://stratum-proxy.tedbaker0207.workers.dev';
  var SID_COOKIE = 'stratum_sid';
  var SID_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 2; // ~2 years, matches the old engine's cookie lifetime

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split(';') : [];
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].trim();
      var eq = kv.indexOf('=');
      if (eq > -1 && kv.slice(0, eq) === name) return decodeURIComponent(kv.slice(eq + 1));
    }
    return null;
  }
  function setCookie(name, value, maxAgeSeconds) {
    document.cookie = name + '=' + encodeURIComponent(value) + '; max-age=' + maxAgeSeconds + '; path=/; SameSite=Lax';
  }

  function getWpUser() {
    return window.STRATUM_WP_USER || { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };
  }

  var studentId = readCookie(SID_COOKIE);
  var pendingCallbacks = [];
  var resolving = false;

  function finalize(id) {
    studentId = id;
    window.STRATUM_IDENTITY_READY = true;
    window.STRATUM_STUDENT_ID = studentId;
    document.dispatchEvent(new CustomEvent('stratum:identity-ready', { detail: { studentId: studentId } }));
    pendingCallbacks.forEach(function (cb) { cb(studentId); });
    pendingCallbacks = [];
  }

  function resolve() {
    if (resolving) return; // already in flight — every caller's callback is queued in pendingCallbacks
    resolving = true;
    var wpUser = getWpUser();
    if (studentId || !wpUser.loggedIn || !wpUser.hasMembership || !wpUser.email) {
      // Nothing to resolve: cookie already set, or nothing to resolve it
      // from (logged out / no active membership / no email on file).
      finalize(studentId);
      return;
    }
    fetch(PROXY_URL + '/resolve-identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: wpUser.email })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.stratumId) {
          setCookie(SID_COOKIE, d.stratumId, SID_COOKIE_MAX_AGE);
          finalize(d.stratumId);
        } else {
          finalize(null);
        }
      })
      .catch(function () { finalize(null); });
  }

  function init(callback) {
    if (window.STRATUM_IDENTITY_READY) { callback(window.STRATUM_STUDENT_ID); return; }
    if (typeof callback === 'function') pendingCallbacks.push(callback);
    resolve();
  }

  window.StratumIdentity = {
    PROXY_URL: PROXY_URL,
    getWpUser: getWpUser,
    init: init
  };
})();
