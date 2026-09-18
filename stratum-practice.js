/* ============================================================
   STRATUM PRACTICE LAB — PAGE LOGIC (Sept 2026 REDESIGN)
   ------------------------------------------------------------
   Reoriented from "searchable glossary" toward "practicing skills,"
   per Ted's direction. Still the same underlying data (/vocabulary,
   term shape unchanged: word, definition, craftCategory,
   complexityLevel, exerciseSteps, relatedTerms) — what changed:

     1. EXERCISE LEADS, DEFINITION FOLLOWS. Each entry now shows its
        "Try it" exercise first; the definition is secondary framing,
        not the headline.
     2. PRACTICED TRACKING. A new per-student endpoint,
        /practiced-terms (GET/POST — see worker.js), lets a student
        mark a term's exercise as done. A progress line ("X of Y
        practiced") turns browsing into a checklist with visible
        progress, not a static reference.
     3. SEQUENCED, NOT ALPHABETICAL. Terms sort by Complexity Level
        (Beginner -> Intermediate -> Advanced) as the primary order,
        with a section header wherever the level changes — reads as a
        progression to work through, not a dictionary.
     4. TODAY'S PRACTICE TERM. One term is deterministically featured
        at the top of the page each day (same pick all day, changes
        daily) — a return-and-practice hook, and the same term/pick
        logic backs the dashboard teaser card (stratum-practice-
        teaser.js) so the two stay in sync without sharing code (both
        derive the same day-index pick from the same full term list).
     5. APPLIED TO THEIR OWN WORK. Where the student has an active
        Protagonist in their WIP Characters list (see stratum-wip-
        panel.js's /project data), a short "Try it with: <name>" hint
        appears under the exercise — using data they already entered,
        not a generic prompt. This is a light touch, not per-exercise
        text substitution (that would need new Stratum-admin authoring
        support, out of scope this round) — just a name reference.

   Same student-facing filter set (Craft Category + Complexity Level),
   same search, same pagination, same clickable "See also" cross-link
   chips — those mechanics are unchanged, just reordered/re-emphasized.

   Language: reads the same 'wlfc_preferred_lang' localStorage key the
   header's Language dropdown already writes.

   Requires stratum-identity.js AND stratum-header.js (for
   window.StratumHeader.buildTopbar) loaded first on this page.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var WP_USER = window.StratumIdentity ? window.StratumIdentity.getWpUser() : { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };
  var LANG_STORE_KEY = 'wlfc_preferred_lang';

  var CRAFT_CATEGORIES = ['Character', 'Plot', 'Dialogue', 'Setting', 'Theme', 'Structure', 'Pacing', 'Point of View'];
  var COMPLEXITY_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
  var COMPLEXITY_ORDER = { 'Beginner': 0, 'Intermediate': 1, 'Advanced': 2 };
  var PAGE_SIZES = [25, 50, 100];

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  var LANG = lsGet(LANG_STORE_KEY) || 'en';
  var STUDENT_ID = null;
  var termsCache = null;
  var practicedIds = {};       // { [termId]: true }
  var protagonistName = '';    // from the student's own WIP Characters list, if any
  var searchQuery = '';
  var pageSize = PAGE_SIZES[0];
  var currentPage = 1;
  var listEl, pagerEl, searchInput, craftSelect, complexitySelect, progressEl, todaySlotEl;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  function dayOfYear() {
    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / 86400000);
  }
  function pickTodaysTerm(terms) {
    if (!terms.length) return null;
    return terms[dayOfYear() % terms.length];
  }

  function loadTerms(callback) {
    fetch(PROXY_URL + '/vocabulary?lang=' + encodeURIComponent(LANG))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        termsCache = (d && Array.isArray(d.terms)) ? d.terms : [];
        callback();
      })
      .catch(function () { termsCache = []; callback(); });
  }
  function loadPracticedIds(callback) {
    if (!STUDENT_ID) { practicedIds = {}; callback(); return; }
    fetch(PROXY_URL + '/practiced-terms?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        practicedIds = {};
        ((d && d.termIds) || []).forEach(function (id) { practicedIds[id] = true; });
        callback();
      })
      .catch(function () { practicedIds = {}; callback(); });
  }
  function savePracticedIds() {
    if (!STUDENT_ID) return;
    fetch(PROXY_URL + '/practiced-terms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, termIds: Object.keys(practicedIds).map(Number) })
    }).catch(function () {});
  }
  function loadProtagonistName(callback) {
    if (!STUDENT_ID) { protagonistName = ''; callback(); return; }
    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var chars = (d && Array.isArray(d.characters)) ? d.characters : [];
        var protagonist = chars.find(function (c) { return c && c.type === 'Protagonist' && c.name; });
        protagonistName = protagonist ? protagonist.name : '';
        callback();
      })
      .catch(function () { protagonistName = ''; callback(); });
  }

  function togglePracticed(termId) {
    if (practicedIds[termId]) delete practicedIds[termId];
    else practicedIds[termId] = true;
    savePracticedIds();
    renderProgress();
  }

  function renderProgress() {
    if (!progressEl || !termsCache) return;
    var total = termsCache.length;
    var done = Object.keys(practicedIds).filter(function (id) {
      return termsCache.some(function (t) { return String(t.id) === String(id); });
    }).length;
    progressEl.textContent = total ? (done + ' of ' + total + ' terms practiced') : '';
  }

  function buildTermCard(term, opts) {
    opts = opts || {};
    var isPracticed = !!practicedIds[term.id];
    var entry = opts.collapsible ? document.createElement('details') : el('div');
    entry.className = 'sh-pl-entry' + (isPracticed ? ' sh-pl-practiced' : '');
    if (term.id != null) entry.setAttribute('data-term-id', String(term.id));

    var head = opts.collapsible ? document.createElement('summary') : el('div', 'sh-pl-static-head');
    mount(head, el('span', 'sh-pl-word', term.word));
    var metaBits = [term.craftCategory, term.complexityLevel].filter(Boolean).join(' \u00b7 ');
    if (metaBits) mount(head, el('span', 'sh-pl-summary-meta', metaBits));
    if (isPracticed) mount(head, el('span', 'sh-pl-practiced-badge', '\u2713 Practiced'));
    mount(entry, head);

    var body = el('div', 'sh-pl-entry-body');

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
      if (protagonistName) {
        mount(exWrap, el('div', 'sh-pl-applied-hint', 'Try it with: ' + protagonistName));
      }
      var practiceBtn = el('button', 'sh-pl-practice-btn' + (isPracticed ? ' sh-pl-practice-btn--done' : ''), isPracticed ? '\u2713 Practiced' : 'Mark as Practiced');
      practiceBtn.type = 'button';
      practiceBtn.addEventListener('click', function (e) {
        e.preventDefault();
        togglePracticed(term.id);
        practiceBtn.textContent = practicedIds[term.id] ? '\u2713 Practiced' : 'Mark as Practiced';
        practiceBtn.classList.toggle('sh-pl-practice-btn--done', !!practicedIds[term.id]);
        entry.classList.toggle('sh-pl-practiced', !!practicedIds[term.id]);
      });
      mount(exWrap, practiceBtn);
      mount(body, exWrap);
    }

    var tags = el('div', 'sh-pl-tags');
    [term.craftCategory, term.narrativeStage, term.function, term.complexityLevel].forEach(function (v) {
      if (v) mount(tags, el('span', 'sh-pl-tag', v));
    });
    mount(body, tags);
    mount(body, el('div', 'sh-pl-definition', term.definition));

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
    return entry;
  }

  function renderTodaysTerm() {
    if (!todaySlotEl) return;
    todaySlotEl.innerHTML = '';
    var term = pickTodaysTerm(termsCache || []);
    if (!term) return;
    var card = el('div', 'sh-pl-today-card');
    mount(card, el('p', 'sh-pl-today-label', "Today's Practice Term"));
    mount(card, buildTermCard(term, { collapsible: false }));
    mount(todaySlotEl, card);
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

    filtered.sort(function (a, b) {
      var la = COMPLEXITY_ORDER[a.complexityLevel];
      var lb = COMPLEXITY_ORDER[b.complexityLevel];
      la = la == null ? 99 : la;
      lb = lb == null ? 99 : lb;
      if (la !== lb) return la - lb;
      return (a.word || '').localeCompare(b.word || '');
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

    var lastLevel = null;
    pageItems.forEach(function (term) {
      if (term.complexityLevel !== lastLevel) {
        mount(listEl, el('p', 'sh-pl-level-header', term.complexityLevel || 'Other'));
        lastLevel = term.complexityLevel;
      }
      mount(listEl, buildTermCard(term, { collapsible: true }));
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
    renderList();
    setTimeout(function () {
      var match = listEl.querySelector('[data-term-id="' + String(id) + '"]');
      if (match) {
        if (match.tagName === 'DETAILS') match.open = true;
        match.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 0);
  }

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

    var body = el('div', 'sh-form-body');
    mount(body, el('h1', 'sh-form-title', 'Practice Lab'));
    mount(body, el('p', 'sh-form-sub', 'Work through craft skills, one exercise at a time \u2014 not just definitions to look up.'));
    progressEl = el('p', 'sh-pl-progress');
    mount(body, progressEl);

    todaySlotEl = el('div');
    mount(body, todaySlotEl);

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
      var fwrap = el('div', 'sh-pl-filter-wrap');
      mount(fwrap, el('span', 'sh-pl-filter-label', label));
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
      mount(fwrap, select);
      return { wrap: fwrap, select: select };
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

    loadTerms(function () {
      renderTodaysTerm();
      renderList();
      renderProgress();
      loadPracticedIds(function () {
        renderTodaysTerm();
        renderList();
        renderProgress();
      });
      loadProtagonistName(function () {
        renderTodaysTerm();
        renderList();
      });
    });
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
    if (window.StratumIdentity) {
      window.StratumIdentity.init(function (studentId) {
        STUDENT_ID = studentId;
        buildPage(container);
      });
    } else {
      buildPage(container);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
