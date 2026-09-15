/* ============================================================
   STRATUM LIBRARY — PAGE LOGIC (Sept 2026)
   ------------------------------------------------------------
   Full build, replacing the earlier placeholder. Reads the new
   /library public endpoint (see worker.js), which serves the
   admin-managed library_resources table (built in stratum-lesson-
   admin.html's new Library tab) — same data model as Testimonials/
   Vocabulary: title, type ('pdf' or 'video'), category (required),
   topic (optional, the "Excavation Topic" filter), pdfFilename OR
   wistiaId depending on type.

   PDFs: pdfFilename is just a filename (e.g. The_Science_Of_
   Anchor_Behavior.pdf) — LIB_PDF_BASE_URL below is the SAME fixed
   GitHub Pages prefix the admin panel already assumes, prepended
   here to build the real URL. Opens in a popup overlay using the
   existing pdf-viewer.html (PDF.js-based, already built and hosted
   — avoids the iOS Safari native-PDF-viewer width-overflow bug a
   raw PDF link/iframe would hit), not a raw new-tab link.

   Videos: wistiaId opens in a popup overlay with the same Wistia
   embed technique already used for Tutorial videos and Coach
   session videos elsewhere in this codebase.

   Two client-side filters (Category, Excavation Topic), built from
   whatever distinct values are actually present in the loaded
   (active-only) resources — same filter mechanics as Practice Lab.

   Layout uses plain .sh-wrap (NOT .sh-page's 900px-centered
   constraint) so this page is full width, identical to the System
   Page dashboard, per Ted's explicit requirement that navigating
   here feel seamless.

   Requires stratum-identity.js AND stratum-header.js (for
   window.StratumHeader.buildTopbar) loaded first on this page.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var WP_USER = window.StratumIdentity ? window.StratumIdentity.getWpUser() : { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };

  // Same fixed base path the admin panel's own PDF-filename preview
  // assumes (see stratum-lesson-admin.html's updatePdfPreview()) —
  // keep these in sync if the hosting location ever changes.
  var LIB_PDF_BASE_URL = 'https://stratummethod.github.io/stratum-widget/';
  var PDF_VIEWER_URL = 'https://stratummethod.github.io/stratum-widget/pdf-viewer.html';

  var resourcesCache = [];
  var categoryFilterVal = '';
  var topicFilterVal = '';
  var listEl, categorySelect, topicSelect, countEl;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  function uniqueSorted(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) {
      v = (v || '').trim();
      if (!v || seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    out.sort(function (a, b) { return a.localeCompare(b); });
    return out;
  }

  // ----------------------------------------------------------
  // POPUP VIEWERS — PDF (via the existing pdf-viewer.html) and Video
  // (Wistia embed), same overlay pattern as the Tutorial video popup
  // elsewhere in this codebase.
  // ----------------------------------------------------------
  function closePopup(overlay) { overlay.remove(); }

  function openPopup(buildContent) {
    var overlay = el('div', 'sh-lib-overlay');
    var box = el('div', 'sh-lib-popup-box');
    var closeBtn = el('button', 'sh-lib-popup-close', '\u2715');
    closeBtn.type = 'button';
    closeBtn.addEventListener('click', function () { closePopup(overlay); });
    buildContent(box);
    box.appendChild(closeBtn);
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closePopup(overlay); });
    document.body.appendChild(overlay);
    return overlay;
  }

  function openPdfPopup(resource) {
    var fullUrl = LIB_PDF_BASE_URL + resource.pdfFilename;
    openPopup(function (box) {
      box.classList.add('sh-lib-popup-box--pdf');
      var iframe = document.createElement('iframe');
      iframe.className = 'sh-lib-pdf-frame';
      iframe.src = PDF_VIEWER_URL + '?file=' + encodeURIComponent(fullUrl);
      box.appendChild(iframe);
    });
  }

  function openVideoPopup(resource) {
    if (!document.querySelector('script[src="https://fast.wistia.com/player.js"]')) {
      var s = document.createElement('script');
      s.src = 'https://fast.wistia.com/player.js';
      s.async = true;
      document.head.appendChild(s);
    }
    var moduleSrc = 'https://fast.wistia.com/embed/' + resource.wistiaId + '.js';
    if (!document.querySelector('script[src="' + moduleSrc + '"]')) {
      var m = document.createElement('script');
      m.src = moduleSrc;
      m.type = 'module';
      m.async = true;
      document.head.appendChild(m);
    }
    openPopup(function (box) {
      box.classList.add('sh-lib-popup-box--video');
      var player = document.createElement('wistia-player');
      player.setAttribute('media-id', resource.wistiaId);
      box.appendChild(player);
    });
  }

  function openResource(resource) {
    if (resource.type === 'video') openVideoPopup(resource);
    else openPdfPopup(resource);
  }

  // ----------------------------------------------------------
  // DATA + FILTERS
  // ----------------------------------------------------------
  function loadResources() {
    listEl.innerHTML = '';
    mount(listEl, el('div', 'sh-pl-empty', 'Loading\u2026'));
    fetch(PROXY_URL + '/library')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        resourcesCache = (d && Array.isArray(d.resources)) ? d.resources : [];
        refreshFilters();
        renderList();
      })
      .catch(function () {
        resourcesCache = [];
        renderList();
      });
  }

  function refreshFilters() {
    var categories = uniqueSorted(resourcesCache.map(function (r) { return r.category; }));
    var topics = uniqueSorted(resourcesCache.map(function (r) { return r.topic; }));

    function fill(select, values, allLabel) {
      var current = select.value;
      select.innerHTML = '';
      var allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = allLabel;
      select.appendChild(allOpt);
      values.forEach(function (v) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        select.appendChild(o);
      });
      if (values.indexOf(current) !== -1) select.value = current;
    }
    fill(categorySelect, categories, 'All categories');
    fill(topicSelect, topics, 'All topics');
  }

  function renderList() {
    var filtered = resourcesCache.filter(function (r) {
      if (categoryFilterVal && r.category !== categoryFilterVal) return false;
      if (topicFilterVal && r.topic !== topicFilterVal) return false;
      return true;
    });

    listEl.innerHTML = '';
    countEl.textContent = resourcesCache.length ? (filtered.length + ' of ' + resourcesCache.length + ' resources') : '';

    if (!filtered.length) {
      var emptyMsg = resourcesCache.length ? 'No resources match these filters.' : 'No resources yet.';
      mount(listEl, el('div', 'sh-pl-empty', emptyMsg));
      return;
    }

    filtered.forEach(function (resource) {
      var row = el('div', 'sh-lib-row');
      row.addEventListener('click', function () { openResource(resource); });

      var iconWrap = el('div', 'sh-lib-icon sh-lib-icon--' + resource.type);
      iconWrap.textContent = resource.type === 'video' ? '\u25B6' : '\u2318';
      mount(row, iconWrap);

      var textWrap = el('div', 'sh-lib-text');
      mount(textWrap, el('div', 'sh-lib-title', resource.title));
      var meta = el('div', 'sh-lib-meta');
      mount(meta, el('span', 'sh-lib-tag', resource.category));
      if (resource.topic) mount(meta, el('span', 'sh-lib-tag sh-lib-tag--topic', resource.topic));
      mount(textWrap, meta);
      mount(row, textWrap);

      mount(row, el('div', 'sh-lib-open-label', resource.type === 'video' ? 'Watch' : 'View PDF'));

      mount(listEl, row);
    });
  }

  // ----------------------------------------------------------
  // PAGE SHELL
  // ----------------------------------------------------------
  function buildGate(container, message, linkHref, linkText) {
    container.innerHTML = '';
    var wrap = el('div', 'sh-wrap');
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
    var wrap = el('div', 'sh-wrap');
    if (window.StratumHeader) window.StratumHeader.buildTopbar(wrap);

    var crumb = el('div', 'sh-page-topbar');
    var back = document.createElement('a');
    back.className = 'sh-page-back';
    back.href = '/system/';
    back.textContent = '\u2190 Back to Dashboard';
    mount(crumb, back);
    mount(wrap, crumb);

    var body = el('div', 'sh-form-body');
    mount(body, el('h1', 'sh-form-title', 'Library'));
    mount(body, el('p', 'sh-form-sub', 'Every resource document and video, all in one place.'));

    var toolbar = el('div', 'sh-pl-toolbar');
    function buildFilterSelect(label) {
      var fwrap = el('div', 'sh-pl-filter-wrap');
      mount(fwrap, el('span', 'sh-pl-filter-label', label));
      var select = document.createElement('select');
      select.className = 'sh-pl-filter-select';
      mount(fwrap, select);
      return { wrap: fwrap, select: select };
    }
    var catFilter = buildFilterSelect('Category');
    categorySelect = catFilter.select;
    categorySelect.addEventListener('change', function () { categoryFilterVal = categorySelect.value; renderList(); });
    mount(toolbar, catFilter.wrap);
    var topicFilter = buildFilterSelect('Excavation Topic');
    topicSelect = topicFilter.select;
    topicSelect.addEventListener('change', function () { topicFilterVal = topicSelect.value; renderList(); });
    mount(toolbar, topicFilter.wrap);
    mount(body, toolbar);

    countEl = el('p', 'sh-pl-progress');
    mount(body, countEl);

    listEl = el('div', 'sh-lib-list');
    mount(body, listEl);

    mount(wrap, body);
    mount(container, wrap);

    loadResources();
  }

  function init() {
    var container = document.getElementById('stratum-library');
    if (!container) {
      console.error('[Stratum] No #stratum-library container found on this page.');
      return;
    }
    if (!WP_USER.loggedIn) {
      buildGate(container, 'Please log in to view the Library.', WP_USER.loginUrl, 'Log in');
      return;
    }
    if (!WP_USER.hasMembership) {
      buildGate(container, 'Your account doesn\u2019t have an active Stratum Method membership yet.', '/membership-account/', 'Go to My Account');
      return;
    }
    buildPage(container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
