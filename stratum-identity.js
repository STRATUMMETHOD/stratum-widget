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

   Sept 25 2026: it ALSO reads window.STRATUM_WP_AUTH = { email, ts, sig },
   printed by the stratum-auth.php must-use plugin for logged-in
   members (automatically via wp_head(), or via stratum_print_auth()
   in templates that don't call wp_head()). Those three values are sent
   to /resolve-identity, which verifies the signature before returning
   (or creating) the student's identity.

   Sept 25 2026 (lockdown): /resolve-identity also returns a signed
   session token. This file wraps window.fetch so EVERY request to the
   worker automatically carries it as "Authorization: Bearer <token>".
   The worker uses it to check that the studentId in a request really
   belongs to the person making it. No other Stratum file needs to know
   about the token — as long as this file loads first, their existing
   fetch() calls are covered.

   Public API (window.StratumIdentity):
     .PROXY_URL            — the Worker base URL, shared so pages
                              don't redeclare it.
     .getWpUser()           — returns the WP_USER object read from
                              window.STRATUM_WP_USER (safe fallback
                              shape if the template didn't set it).
     .getToken()            — the current session token, or null.
     .init(callback)         — resolves the stratum_sid identity for a
                              logged-in member, then calls
                              callback(studentId) once settled
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

  function setCookie(name, value, maxAgeSeconds) {
    document.cookie = name + '=' + encodeURIComponent(value) + '; max-age=' + maxAgeSeconds + '; path=/; SameSite=Lax';
  }
  function clearCookie(name) {
    document.cookie = name + '=; max-age=0; path=/; SameSite=Lax';
  }

  function getWpUser() {
    return window.STRATUM_WP_USER || { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };
  }
  function getWpAuth() {
    var a = window.STRATUM_WP_AUTH;
    return (a && a.email && a.ts && a.sig) ? a : null;
  }

  // ---- Session token + fetch wrapper (Sept 25 2026 lockdown) ----
  // The token lives in memory only (never a cookie or localStorage),
  // so it disappears when the page closes and is re-issued on the
  // next page load.
  var authToken = null;
  if (!window.__STRATUM_FETCH_WRAPPED && typeof window.fetch === 'function') {
    var nativeFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (authToken && url.indexOf(PROXY_URL) === 0) {
          init = init ? Object.assign({}, init) : {};
          var headers = new Headers(init.headers || (typeof input !== 'string' && input.headers) || {});
          if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + authToken);
          init.headers = headers;
        }
      } catch (e) { /* never let the wrapper break a request */ }
      return nativeFetch(input, init);
    };
    window.__STRATUM_FETCH_WRAPPED = true;
  }

  var studentId = null;
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

  // Sept 25 2026 fix: the cached stratum_sid cookie is NEVER used as a
  // fallback any more. It used to be returned whenever the user was
  // logged out or /resolve-identity failed — so a second person signing
  // in on the same browser (or anyone whose lookup failed) silently got
  // the PREVIOUS person's account and data. Identity now comes only
  // from a successful, signature-verified /resolve-identity call. Any
  // failure clears the cookie and settles on null, which shows the
  // normal "Could not connect" state instead of someone else's data.
  function fail() {
    authToken = null;
    clearCookie(SID_COOKIE);
    finalize(null);
  }

  function resolve() {
    if (resolving) return; // already in flight — every caller's callback is queued in pendingCallbacks
    resolving = true;
    var wpUser = getWpUser();
    var auth = getWpAuth();
    if (!wpUser.loggedIn || !wpUser.hasMembership || !auth) {
      fail();
      return;
    }
    fetch(PROXY_URL + '/resolve-identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: auth.email, ts: auth.ts, sig: auth.sig })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok && d.stratumId) {
          authToken = d.token || null; // set BEFORE finalize so every callback's first request carries it
          setCookie(SID_COOKIE, d.stratumId, SID_COOKIE_MAX_AGE);
          finalize(d.stratumId);
        } else {
          fail();
        }
      })
      .catch(fail);
  }

  function init(callback) {
    if (window.STRATUM_IDENTITY_READY) { callback(window.STRATUM_STUDENT_ID); return; }
    if (typeof callback === 'function') pendingCallbacks.push(callback);
    resolve();
  }

  window.StratumIdentity = {
    PROXY_URL: PROXY_URL,
    getWpUser: getWpUser,
    getToken: function () { return authToken; },
    init: init
  };
})();
