/* ============================================================
   STRATUM LIBRARY — PAGE LOGIC (Sept 2026)
   ------------------------------------------------------------
   Reads the /library public endpoint (see worker.js), which now
   serves three resource types instead of two:
     - 'doc': rich text entered directly in admin, translates
       automatically with the rest of the library - see the new
       body/keyConcept/coreTakeaway fields below.
     - 'pdf': legacy, GitHub Pages-hosted PDFs (unchanged from
       before this round - pdfFilename + LIB_PDF_BASE_URL).
     - 'video': Wistia-hosted, unchanged (wistiaId).
   /library now takes ?lang=, with the same per-resource-group
   fallback-to-English every other lang-aware endpoint in this
   codebase already uses - a resource with no translation for the
   student's language yet still shows (in English) rather than
   silently disappearing.

   Two client-side filters (Category, Excavation Topic) work exactly
   as before, built from whatever distinct values are present in the
   loaded (active-only, already-lang-resolved) resources.

   ---- The Librarian (Sept 2026) ----
   A search box above the filters lets a student describe what
   they're looking for in their own words. POST /library/search runs
   that against the CURRENT list of resources (server-side, one
   Anthropic call) and returns a short, relevance-ordered list with a
   one-line reason for each match. Selecting a result opens that
   resource the same way clicking it in the normal list would; for a
   'doc' type resource, any highlight phrases the search returned are
   wrapped in <mark> inside the rendered body so the student can see
   exactly what matched. PDFs and videos can still show up as
   matches (their title/category/Key Concept/Core Takeaway are
   enough to judge relevance from) - they just never carry highlight
   terms, since there's no stored text to highlight inside an
   external PDF viewer or a video embed.

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

  var LANG_STORE_KEY = 'wlfc_preferred_lang'; // same key the header's Language dropdown sets
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var LANG = lsGet(LANG_STORE_KEY) || 'en';

  var STRINGS = {
    en: {
      title: 'Library', sub: 'Every resource document and video, all in one place.',
      backToDashboard: '\u2190 Back to Dashboard', category: 'Category', excavationTopic: 'Excavation Topic',
      allCategories: 'All categories', allTopics: 'All topics',
      noResourcesMatch: 'No resources match these filters.', noResourcesYet: 'No resources yet.',
      loading: 'Loading\u2026', read: 'Read', watch: 'Watch', viewPdf: 'View PDF',
      resourcesOf: function (shown, total) { return shown + ' of ' + total + ' resources'; },
      askLibrarian: 'Ask the Librarian', searchPlaceholder: 'Describe what you\u2019re looking for\u2026',
      searching: 'Searching\u2026', clearSearch: '\u2715 Clear search',
      librarianNoMatches: 'The Librarian didn\u2019t find a strong match for that \u2014 try describing it differently, or browse below.',
      librarianError: 'Could not reach the Librarian \u2014 try again in a moment.',
      librarianResultsFor: function (q) { return 'Librarian results for \u201c' + q + '\u201d'; },
      keyConcept: 'Key Concept', coreTakeaway: 'Core Takeaway',
      loginToView: 'Please log in to view the Library.', logIn: 'Log in',
      noMembership: 'Your account doesn\u2019t have an active Stratum Method membership yet.', goToMyAccount: 'Go to My Account'
    },
    es: {
      title: 'Biblioteca', sub: 'Todos los documentos y videos de referencia, en un solo lugar.',
      backToDashboard: '\u2190 Volver al panel', category: 'Categor\u00eda', excavationTopic: 'Tema de excavaci\u00f3n',
      allCategories: 'Todas las categor\u00edas', allTopics: 'Todos los temas',
      noResourcesMatch: 'Ning\u00fan recurso coincide con estos filtros.', noResourcesYet: 'A\u00fan no hay recursos.',
      loading: 'Cargando\u2026', read: 'Leer', watch: 'Ver', viewPdf: 'Ver PDF',
      resourcesOf: function (shown, total) { return shown + ' de ' + total + ' recursos'; },
      askLibrarian: 'Preguntar al bibliotecario', searchPlaceholder: 'Describe lo que buscas\u2026',
      searching: 'Buscando\u2026', clearSearch: '\u2715 Borrar b\u00fasqueda',
      librarianNoMatches: 'El bibliotecario no encontr\u00f3 una coincidencia clara \u2014 intenta describirlo de otra forma, o explora la lista de abajo.',
      librarianError: 'No se pudo contactar al bibliotecario \u2014 intenta de nuevo en un momento.',
      librarianResultsFor: function (q) { return 'Resultados del bibliotecario para \u201c' + q + '\u201d'; },
      keyConcept: 'Concepto clave', coreTakeaway: 'Idea principal',
      loginToView: 'Inicia sesi\u00f3n para ver la Biblioteca.', logIn: 'Iniciar sesi\u00f3n',
      noMembership: 'Tu cuenta a\u00fan no tiene una membres\u00eda activa de Stratum Method.', goToMyAccount: 'Ir a mi cuenta'
    }
  };
  function t(key) { return (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key]; }

  // Same fixed base path the admin panel's own PDF-filename preview
  // assumes (see stratum-lesson-admin.html's updatePdfPreview()) —
  // keep these in sync if the hosting location ever changes.
  var LIB_PDF_BASE_URL = 'https://stratummethod.github.io/stratum-widget/';
  var PDF_VIEWER_URL = 'https://stratummethod.github.io/stratum-widget/pdf-viewer.html';

  var resourcesCache = [];
  var categoryFilterVal = '';
  var topicFilterVal = '';
  var listEl, categorySelect, topicSelect, countEl;
  var searchInput, searchBtn, searchStatusEl, librarianResultsEl;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }
  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

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

  function typeIcon(type) {
    if (type === 'video') return '\u25B6';
    if (type === 'doc') return '\u2261';
    return '\u2318'; // pdf
  }
  function typeActionLabel(type) {
    if (type === 'video') return t('watch');
    if (type === 'doc') return t('read');
    return t('viewPdf');
  }

  // ----------------------------------------------------------
  // POPUP VIEWERS — PDF (via the existing pdf-viewer.html), Video
  // (Wistia embed), and Document (rendered body HTML, new). Same
  // overlay pattern as the Tutorial video popup elsewhere in this
  // codebase.
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

  // Document popup (Sept 2026) — resource.body is admin-authored HTML
  // (already sanitized server-side of <script> tags on save), rendered
  // directly. `highlights`, when present (only ever set when opening a
  // resource from a Librarian search result), is an array of exact
  // substrings to wrap in <mark> — each is escaped for safe regex use
  // and matched case-insensitively against the rendered HTML's text,
  // not against markup, so a highlight phrase spanning a tag boundary
  // simply won't match rather than corrupting the HTML.
  function openDocPopup(resource, highlights) {
    openPopup(function (box) {
      box.classList.add('sh-lib-popup-box--doc');
      var scroller = el('div', 'sh-lib-doc-scroller');
      mount(scroller, el('h2', 'sh-lib-doc-title', resource.title));
      if (resource.keyConcept || resource.coreTakeaway) {
        var metaBox = el('div', 'sh-lib-doc-meta');
        if (resource.keyConcept) {
          mount(metaBox, el('div', 'sh-lib-doc-meta-label', t('keyConcept')));
          mount(metaBox, el('div', 'sh-lib-doc-meta-value', resource.keyConcept));
        }
        if (resource.coreTakeaway) {
          mount(metaBox, el('div', 'sh-lib-doc-meta-label', t('coreTakeaway')));
          mount(metaBox, el('div', 'sh-lib-doc-meta-value', resource.coreTakeaway));
        }
        mount(scroller, metaBox);
      }
      var bodyEl = el('div', 'sh-lib-doc-body');
      var html = resource.body || '';
      (highlights || []).forEach(function (phrase) {
        if (!phrase) return;
        var re = new RegExp('(' + escapeRegExp(phrase) + ')', 'gi');
        html = html.replace(re, '<mark class="sh-lib-highlight">$1</mark>');
      });
      bodyEl.innerHTML = html;
      mount(scroller, bodyEl);
      box.appendChild(scroller);
    });
  }

  function openResource(resource, highlights) {
    if (resource.type === 'video') openVideoPopup(resource);
    else if (resource.type === 'doc') openDocPopup(resource, highlights);
    else openPdfPopup(resource);
  }

  // ----------------------------------------------------------
  // DATA + FILTERS
  // ----------------------------------------------------------
  function loadResources() {
    listEl.innerHTML = '';
    mount(listEl, el('div', 'sh-pl-empty', t('loading')));
    fetch(PROXY_URL + '/library?lang=' + encodeURIComponent(LANG))
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
    fill(categorySelect, categories, t('allCategories'));
    fill(topicSelect, topics, t('allTopics'));
  }

  function buildRow(resource, onClick) {
    var row = el('div', 'sh-lib-row');
    row.addEventListener('click', onClick);

    var iconWrap = el('div', 'sh-lib-icon sh-lib-icon--' + resource.type);
    iconWrap.textContent = typeIcon(resource.type);
    mount(row, iconWrap);

    var textWrap = el('div', 'sh-lib-text');
    mount(textWrap, el('div', 'sh-lib-title', resource.title));
    var meta = el('div', 'sh-lib-meta');
    mount(meta, el('span', 'sh-lib-tag', resource.category));
    if (resource.topic) mount(meta, el('span', 'sh-lib-tag sh-lib-tag--topic', resource.topic));
    mount(textWrap, meta);
    mount(row, textWrap);

    mount(row, el('div', 'sh-lib-open-label', typeActionLabel(resource.type)));
    return row;
  }

  function renderList() {
    var filtered = resourcesCache.filter(function (r) {
      if (categoryFilterVal && r.category !== categoryFilterVal) return false;
      if (topicFilterVal && r.topic !== topicFilterVal) return false;
      return true;
    });

    listEl.innerHTML = '';
    countEl.textContent = resourcesCache.length ? t('resourcesOf')(filtered.length, resourcesCache.length) : '';

    if (!filtered.length) {
      var emptyMsg = resourcesCache.length ? t('noResourcesMatch') : t('noResourcesYet');
      mount(listEl, el('div', 'sh-pl-empty', emptyMsg));
      return;
    }

    filtered.forEach(function (resource) {
      mount(listEl, buildRow(resource, function () { openResource(resource); }));
    });
  }

  // ----------------------------------------------------------
  // THE LIBRARIAN — AI search (Sept 2026)
  // ----------------------------------------------------------
  function runLibrarianSearch() {
    var query = searchInput.value.trim();
    if (!query) return;
    searchBtn.disabled = true;
    searchStatusEl.textContent = t('searching');
    librarianResultsEl.innerHTML = '';
    librarianResultsEl.style.display = '';
    listEl.style.display = 'none';
    fetch(PROXY_URL + '/library/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, lang: LANG })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        searchBtn.disabled = false;
        searchStatusEl.textContent = '';
        renderLibrarianResults(query, (d && Array.isArray(d.matches)) ? d.matches : []);
      })
      .catch(function () {
        searchBtn.disabled = false;
        searchStatusEl.textContent = '';
        librarianResultsEl.innerHTML = '';
        mount(librarianResultsEl, el('div', 'sh-pl-empty', t('librarianError')));
      });
  }

  function clearLibrarianSearch() {
    searchInput.value = '';
    librarianResultsEl.innerHTML = '';
    librarianResultsEl.style.display = 'none';
    listEl.style.display = '';
  }

  function renderLibrarianResults(query, matches) {
    librarianResultsEl.innerHTML = '';
    var header = el('div', 'sh-lib-librarian-head');
    mount(header, el('p', 'sh-lib-librarian-title', t('librarianResultsFor')(query)));
    var clearBtn = el('button', 'sh-lib-librarian-clear', t('clearSearch'));
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', clearLibrarianSearch);
    mount(header, clearBtn);
    mount(librarianResultsEl, header);

    if (!matches.length) {
      mount(librarianResultsEl, el('div', 'sh-pl-empty', t('librarianNoMatches')));
      return;
    }
    matches.forEach(function (match) {
      // Match id back to the full cached resource (search results only
      // carry display fields, not pdfFilename/wistiaId/body) so opening
      // it works exactly like opening it from the plain list.
      var resource = resourcesCache.filter(function (r) { return String(r.id) === String(match.id); })[0];
      if (!resource) return;
      var row = buildRow(resource, function () { openResource(resource, match.highlights); });
      if (match.reason) {
        var reasonEl = el('div', 'sh-lib-librarian-reason', match.reason);
        row.querySelector('.sh-lib-text').appendChild(reasonEl);
      }
      mount(librarianResultsEl, row);
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
    back.textContent = t('backToDashboard');
    mount(crumb, back);
    mount(wrap, crumb);

    var body = el('div', 'sh-form-body');
    mount(body, el('h1', 'sh-form-title', t('title')));
    mount(body, el('p', 'sh-form-sub', t('sub')));

    // ---- The Librarian search bar ----
    var searchBar = el('div', 'sh-lib-search-bar');
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'sh-lib-search-input';
    searchInput.placeholder = t('searchPlaceholder');
    searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') runLibrarianSearch(); });
    mount(searchBar, searchInput);
    searchBtn = el('button', 'sh-lib-search-btn', t('askLibrarian'));
    searchBtn.type = 'button';
    searchBtn.addEventListener('click', runLibrarianSearch);
    mount(searchBar, searchBtn);
    mount(body, searchBar);
    searchStatusEl = el('p', 'sh-pl-progress');
    mount(body, searchStatusEl);

    var toolbar = el('div', 'sh-pl-toolbar');
    function buildFilterSelect(label) {
      var fwrap = el('div', 'sh-pl-filter-wrap');
      mount(fwrap, el('span', 'sh-pl-filter-label', label));
      var select = document.createElement('select');
      select.className = 'sh-pl-filter-select';
      mount(fwrap, select);
      return { wrap: fwrap, select: select };
    }
    var catFilter = buildFilterSelect(t('category'));
    categorySelect = catFilter.select;
    categorySelect.addEventListener('change', function () { categoryFilterVal = categorySelect.value; renderList(); });
    mount(toolbar, catFilter.wrap);
    var topicFilter = buildFilterSelect(t('excavationTopic'));
    topicSelect = topicFilter.select;
    topicSelect.addEventListener('change', function () { topicFilterVal = topicSelect.value; renderList(); });
    mount(toolbar, topicFilter.wrap);
    mount(body, toolbar);

    countEl = el('p', 'sh-pl-progress');
    mount(body, countEl);

    librarianResultsEl = el('div', 'sh-lib-list sh-lib-librarian-results');
    librarianResultsEl.style.display = 'none';
    mount(body, librarianResultsEl);

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
      buildGate(container, t('loginToView'), WP_USER.loginUrl, t('logIn'));
      return;
    }
    if (!WP_USER.hasMembership) {
      buildGate(container, t('noMembership'), '/membership-account/', t('goToMyAccount'));
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
