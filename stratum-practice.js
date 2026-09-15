/* ============================================================
   STRATUM PRACTICE LAB — PAGE LOGIC (Sept 2026)
   ------------------------------------------------------------
   Full port of the old engine's Vocabulary tab (buildVocabularyTab
   and its supporting functions in stratum-lesson-engine.js), now
   titled "Practice Lab" on screen per Ted's nav relabel — the
   underlying data/endpoint is still called vocabulary, unchanged.
   Same /vocabulary?lang=... public GET endpoint, same term shape
   (word, definition, craftCategory, complexityLevel, exerciseSteps,
   relatedTerms), same student-facing filter set (Craft Category +
   Complexity Level only — Narrative Stage/Function were already
   dropped from the student view in an earlier engine update and
   stay dropped here), same pagination, same collapsible entries,
   same clickable "See also" cross-link chips.

   Language: reads the same 'wlfc_preferred_lang' localStorage key
   the header's Language dropdown already writes — this page doesn't
   introduce a separate language setting, it just respects whatever
   the student already picked.

   Requires stratum-identity.js AND stratum-header.js (for
   window.StratumHeader.buildTopbar) loaded first on this page.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var WP_USER = window.StratumIdentity ? window.StratumIdentity.getWpUser() : { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };
  var LANG_STORE_KEY = 'wlfc_preferred_lang'; // same key the header's Language dropdown writes

  var CRAFT_CATEGORIES = ['Character', 'Plot', 'Dialogue', 'Setting', 'Theme', 'Structure', 'Pacing', 'Point of View'];
  var COMPLEXITY_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
  var PAGE_SIZES = [25, 50, 100];

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  var LANG = lsGet(LANG_STORE_KEY) || 'en';
  var termsCache = null;
  var searchQuery = '';
  var pageSize = PAGE_SIZES[0];
  var currentPage = 1;
  var listEl, pagerEl, searchInput, craftSelect, complexitySelect;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  // ----------------------------------------------------------
  // DATA
  // ----------------------------------------------------------
  function loadTerms() {
    listEl.innerHTML = '';
    mount(listEl, el('div', 'sh-pl-empty', 'Loading\u2026'));
    fetch(PROXY_URL + '/vocabulary?lang=' + encodeURIComponent(LANG))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        termsCache = (d && Array.isArray(d.terms)) ? d.terms : [];
        renderList();
      })
      .catch(function () {
        termsCache = [];
        renderList();
      });
  }

  function performSearch() {
    searchQuery = searchInput.value.trim().toLowerCase();
    currentPage = 1;
    renderList();
  }
  function clearFilters() {
    searchInput.value = '';
    searchQuery = '';
    craftSelect.value = '';
    complexitySelect.value = '';
    currentPage = 1;
    renderList();
  }

  // ----------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------
  function renderList() {
    var terms = termsCache || [];
    var craft = craftSelect.value;
    var level = complexitySelect.value;
    var filtered = terms.filter(function (term) {
      if (craft && term.craftCategory !== craft) return false;
      if (level && term.complexityLevel !== level) return false;
      if (searchQuery) {
        var haystack = ((term.word || '') + ' ' + (term.definition || '')).toLowerCase();
        if (haystack.indexOf(searchQuery) === -1) return false;
      }
      return true;
    });

    listEl.innerHTML = '';
    pagerEl.innerHTML = '';

    if (!filtered.length) {
      var emptyMsg = terms.length ? 'No terms match these filters.' : 'No terms yet.';
      mount(listEl, el('div', 'sh-pl-empty', emptyMsg));
      return;
    }

    var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    var start = (currentPage - 1) * pageSize;
    var pageItems = filtered.slice(start, start + pageSize);

    pageItems.forEach(function (term) {
      var entry = document.createElement('details');
      entry.className = 'sh-pl-entry';
      if (term.id != null) entry.setAttribute('data-term-id', String(term.id));
      var summary = document.createElement('summary');
      mount(summary, el('span', 'sh-pl-word', term.word));
      var metaBits = [term.craftCategory, term.complexityLevel].filter(Boolean).join(' \u00b7 ');
      if (metaBits) mount(summary, el('span', 'sh-pl-summary-meta', metaBits));
      mount(entry, summary);

      var body = el('div', 'sh-pl-entry-body');
      var tags = el('div', 'sh-pl-tags');
      [term.craftCategory, term.narrativeStage, term.function, term.complexityLevel].forEach(function (v) {
        if (v) mount(tags, el('span', 'sh-pl-tag', v));
      });
      mount(body, tags);
      mount(body, el('div', 'sh-pl-definition', term.definition));

      if (Array.isArray(term.exerciseSteps) && term.exerciseSteps.length) {
        var exWrap = el('div', 'sh-pl-exercise');
        mount(exWrap, el('div', 'sh-pl-exercise-label', 'Try it'));
        var stepsList = document.createElement('ul');
        stepsList.className = 'sh-pl-exercise-list';
        term.exerciseSteps.forEach(function (step) {
          var li = document.createElement('li');
          li.textContent = step;
          stepsList.appendChild(li);
        });
        mount(exWrap, stepsList);
        mount(body, exWrap);
      }

      if (Array.isArray(term.relatedTerms) && term.relatedTerms.length) {
        var crossWrap = el('div', 'sh-pl-crosslinks');
        mount(crossWrap, el('span', 'sh-pl-crosslink-label', 'See also'));
        var chipsWrap = el('div', 'sh-pl-crosslink-chips');
        term.relatedTerms.forEach(function (rt) {
          var chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'sh-pl-crosslink-chip';
          chip.textContent = rt.word;
          chip.addEventListener('click', function () { jumpToTerm(rt.id); });
          mount(chipsWrap, chip);
        });
        mount(crossWrap, chipsWrap);
        mount(body, crossWrap);
      }

      mount(entry, body);
      mount(listEl, entry);
    });

    if (totalPages > 1) {
      var prevBtn = el('button', 'sh-pl-pager-btn', 'Previous');
      prevBtn.type = 'button';
      prevBtn.disabled = currentPage <= 1;
      prevBtn.addEventListener('click', function () {
        currentPage -= 1;
        renderList();
        listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      mount(pagerEl, prevBtn);
      mount(pagerEl, el('span', 'sh-pl-pager-status', 'Page ' + currentPage + ' of ' + totalPages));
      var nextBtn = el('button', 'sh-pl-pager-btn', 'Next');
      nextBtn.type = 'button';
      nextBtn.disabled = currentPage >= totalPages;
      nextBtn.addEventListener('click', function () {
        currentPage += 1;
        renderList();
        listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      mount(pagerEl, nextBtn);
    }
  }

  function jumpToTerm(id) {
    var target = (termsCache || []).find(function (t) { return String(t.id) === String(id); });
    if (!target) return;
    searchInput.value = '';
    searchQuery = '';
    craftSelect.value = '';
    complexitySelect.value = '';
    var idx = (termsCache || []).findIndex(function (t) { return String(t.id) === String(id); });
    currentPage = idx === -1 ? 1 : Math.floor(idx / pageSize) + 1;
    renderList();
    setTimeout(function () {
      var match = listEl.querySelector('[data-term-id="' + String(id) + '"]');
      if (match) {
        match.open = true;
        match.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  }

  // ----------------------------------------------------------
  // PAGE SHELL
  // ----------------------------------------------------------
  function buildGate(container, message, linkHref, linkText) {
    container.innerHTML = '';
    var wrap = el('div', 'sh-wrap sh-page');
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
    var wrap = el('div', 'sh-wrap sh-page');
    if (window.StratumHeader) window.StratumHeader.buildTopbar(wrap);

    var crumb = el('div', 'sh-page-topbar');
    var back = document.createElement('a');
    back.className = 'sh-page-back';
    back.href = '/system/';
    back.textContent = '\u2190 Back to Dashboard';
    mount(crumb, back);
    mount(wrap, crumb);

    var body = el('div', 'sh-form-body');
    mount(body, el('h1', 'sh-form-title', 'Practice Lab'));
    mount(body, el('p', 'sh-form-sub', 'A working glossary of craft terms. Search by keyword, or filter by category or complexity level to find what you need. Tap any term to open it.'));

    var toolbar = el('div', 'sh-pl-toolbar');

    var searchWrap = el('div', 'sh-pl-search-wrap');
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'sh-pl-search-input';
    searchInput.placeholder = 'Search terms and definitions\u2026';
    searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); performSearch(); } });
    mount(searchWrap, searchInput);
    var searchBtn = el('button', 'sh-pl-search-btn', 'Search');
    searchBtn.type = 'button';
    searchBtn.addEventListener('click', performSearch);
    mount(searchWrap, searchBtn);
    mount(toolbar, searchWrap);

    function buildFilterSelect(label, options) {
      var wrap = el('div', 'sh-pl-filter-wrap');
      mount(wrap, el('span', 'sh-pl-filter-label', label));
      var select = document.createElement('select');
      select.className = 'sh-pl-filter-select';
      var allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = 'All';
      select.appendChild(allOpt);
      options.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        select.appendChild(o);
      });
      select.addEventListener('change', function () { currentPage = 1; renderList(); });
      mount(wrap, select);
      return { wrap: wrap, select: select };
    }
    var craftFilter = buildFilterSelect('Craft Category', CRAFT_CATEGORIES);
    craftSelect = craftFilter.select;
    mount(toolbar, craftFilter.wrap);
    var complexityFilter = buildFilterSelect('Complexity Level', COMPLEXITY_LEVELS);
    complexitySelect = complexityFilter.select;
    mount(toolbar, complexityFilter.wrap);

    var pageSizeWrap = el('div', 'sh-pl-filter-wrap');
    mount(pageSizeWrap, el('span', 'sh-pl-filter-label', 'Show'));
    var pageSizeSelect = document.createElement('select');
    pageSizeSelect.className = 'sh-pl-filter-select';
    PAGE_SIZES.forEach(function (size) {
      var o = document.createElement('option');
      o.value = String(size);
      o.textContent = String(size);
      if (size === pageSize) o.selected = true;
      pageSizeSelect.appendChild(o);
    });
    pageSizeSelect.addEventListener('change', function () {
      pageSize = Number(pageSizeSelect.value) || PAGE_SIZES[0];
      currentPage = 1;
      renderList();
    });
    mount(pageSizeWrap, pageSizeSelect);
    mount(toolbar, pageSizeWrap);

    var clearBtn = el('button', 'sh-pl-clear-btn', 'Clear');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', clearFilters);
    mount(toolbar, clearBtn);

    mount(body, toolbar);

    listEl = el('div', 'sh-pl-list');
    mount(body, listEl);
    pagerEl = el('div', 'sh-pl-pager');
    mount(body, pagerEl);

    mount(wrap, body);
    mount(container, wrap);

    loadTerms();
  }

  function init() {
    var container = document.getElementById('stratum-practice');
    if (!container) {
      console.error('[Stratum] No #stratum-practice container found on this page.');
      return;
    }
    if (!WP_USER.loggedIn) {
      buildGate(container, 'Please log in to view the Practice Lab.', WP_USER.loginUrl, 'Log in');
      return;
    }
    if (!WP_USER.hasMembership) {
      buildGate(container, 'Your account doesn\u2019t have an active Stratum Method membership yet.', '/membership-account/', 'Go to My Account');
      return;
    }
    // No identity resolution needed to READ the glossary (the /vocabulary
    // endpoint is public, keyed only by language) — the login/membership
    // checks above are the actual gate. StratumIdentity isn't called here.
    buildPage(container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
