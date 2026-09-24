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
        panel.js's /project data), a short "Try it with: <n>" hint
        appears under the exercise — using data they already entered,
        not a generic prompt. This is a light touch, not per-exercise
        text substitution (that would need new Stratum-admin authoring
        support, out of scope this round) — just a name reference.

   Same student-facing filter set (Craft Category + Complexity Level),
   same search, same pagination, same clickable "See also" cross-link
   chips — those mechanics are unchanged, just reordered/re-emphasized.

   Language: reads the same 'wlfc_preferred_lang' localStorage key the
   header's Language dropdown already writes.

   ---- Database-backed translation (Sept 2026) ----
   This page's own chrome (labels, buttons, filter text, empty states —
   not the term DATA, which the Worker translates per language) checks
   the same DB-backed ui_strings table every other dashboard and page
   file uses, under the practicePage.* keys — a language override there
   wins; otherwise falls back to the hardcoded en/es tables below. Same
   t()/DB_STRINGS/loadUiStrings() pattern as stratum-library.js, and
   loadUiStrings() resolves before buildPage()/buildGate() runs so the
   very first paint is already in the right language.

   ---- Canonical enum keys (Sept 24 2026 fix) ----
   /vocabulary?lang=xx now returns craftCategory/complexityLevel (and
   the other badge fields) ALREADY TRANSLATED in place (worker's
   vocab_enum_label overlay). The filters, the Beginner->Advanced sort,
   and the level section headers all need the canonical English value,
   so in any non-English language loadTerms() also fetches
   /vocabulary?lang=en and attaches term.craftCategoryKey /
   term.complexityLevelKey by id (ids are the same English row ids in
   every language). Filtering/sorting/headers use the *Key fields;
   displayed badges keep the translated values. If the English fetch
   fails, the keys fall back to the displayed values (English pages are
   unaffected either way — key === value).

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

  var STRINGS = {
    en: {
      title: 'Practice Lab',
      sub: 'Work through craft skills, one exercise at a time \u2014 not just definitions to look up.',
      todaysTerm: 'Today\u2019s Practice Term',
      practicedOf: '{done} of {total} terms practiced',
      searchPlaceholder: 'Describe what you\u2019re looking for\u2026',
      search: 'Ask the Librarian',
      searching: 'Searching\u2026',
      clearSearch: '\u2715 Clear search',
      librarianNoMatches: 'The Librarian didn\u2019t find a strong match for that \u2014 try describing it differently, or browse below.',
      librarianError: 'Could not reach the Librarian \u2014 try again in a moment.',
      librarianResultsFor: 'Librarian results for \u201c{q}\u201d',
      craftCategory: 'Craft Category',
      complexityLevel: 'Complexity Level',
      show: 'Show',
      clear: 'Clear',
      all: 'All',
      previous: 'Previous',
      next: 'Next',
      pageOf: 'Page {page} of {total}',
      tryIt: 'Try it',
      markAsPracticed: 'Mark as Practiced',
      practicedBadge: '\u2713 Practiced',
      seeAlso: 'See also',
      tryItWith: 'Try it with: {name}',
      noTermsMatch: 'No terms match these filters.',
      noTermsYet: 'No terms yet.',
      loginToView: 'Please log in to view the Practice Lab.',
      logIn: 'Log in',
      noMembership: 'Your account doesn\u2019t have an active Stratum Method membership yet.',
      goToMyAccount: 'Go to My Account',
      craftCategoryOptions: { Character: 'Character', Plot: 'Plot', Dialogue: 'Dialogue', Setting: 'Setting', Theme: 'Theme', Structure: 'Structure', Pacing: 'Pacing', 'Point of View': 'Point of View' },
      complexityLevelOptions: { Beginner: 'Beginner', Intermediate: 'Intermediate', Advanced: 'Advanced' }
    },
    es: {
      title: 'Laboratorio de Pr\u00e1ctica',
      sub: 'Trabaja las habilidades de escritura, un ejercicio a la vez \u2014 no solo definiciones para consultar.',
      todaysTerm: 'T\u00e9rmino de pr\u00e1ctica de hoy',
      practicedOf: '{done} de {total} t\u00e9rminos practicados',
      searchPlaceholder: 'Describe lo que buscas\u2026',
      search: 'Preguntar al bibliotecario',
      searching: 'Buscando\u2026',
      clearSearch: '\u2715 Borrar b\u00fasqueda',
      librarianNoMatches: 'El bibliotecario no encontr\u00f3 una coincidencia clara \u2014 intenta describirlo de otra forma, o explora la lista de abajo.',
      librarianError: 'No se pudo contactar al bibliotecario \u2014 intenta de nuevo en un momento.',
      librarianResultsFor: 'Resultados del bibliotecario para \u201c{q}\u201d',
      craftCategory: 'Categor\u00eda de t\u00e9cnica',
      complexityLevel: 'Nivel de complejidad',
      show: 'Mostrar',
      clear: 'Borrar',
      all: 'Todos',
      previous: 'Anterior',
      next: 'Siguiente',
      pageOf: 'P\u00e1gina {page} de {total}',
      tryIt: 'Pract\u00edcalo',
      markAsPracticed: 'Marcar como practicado',
      practicedBadge: '\u2713 Practicado',
      seeAlso: 'Ver tambi\u00e9n',
      tryItWith: 'Pract\u00edcalo con: {name}',
      noTermsMatch: 'Ning\u00fan t\u00e9rmino coincide con estos filtros.',
      noTermsYet: 'A\u00fan no hay t\u00e9rminos.',
      loginToView: 'Inicia sesi\u00f3n para ver el Laboratorio de Pr\u00e1ctica.',
      logIn: 'Iniciar sesi\u00f3n',
      noMembership: 'Tu cuenta a\u00fan no tiene una membres\u00eda activa de Stratum Method.',
      goToMyAccount: 'Ir a mi cuenta',
      craftCategoryOptions: { Character: 'Personaje', Plot: 'Trama', Dialogue: 'Di\u00e1logo', Setting: 'Ambientaci\u00f3n', Theme: 'Tema', Structure: 'Estructura', Pacing: 'Ritmo', 'Point of View': 'Punto de vista' },
      complexityLevelOptions: { Beginner: 'Principiante', Intermediate: 'Intermedio', Advanced: 'Avanzado' }
    }
  };
  var DB_STRINGS = {};
  function loadUiStrings() {
    return fetch(PROXY_URL + '/ui-strings?lang=' + encodeURIComponent(LANG))
      .then(function (r) { return r.json(); })
      .then(function (d) { DB_STRINGS = (d && d.strings) || {}; })
      .catch(function () { DB_STRINGS = {}; });
  }
  function format(str, vars) {
    return str.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }
  function t(key) {
    var dbVal = DB_STRINGS['practicePage.' + key];
    if (dbVal != null) return dbVal;
    return (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key];
  }
  function tOption(mapKey, value) {
    var dbVal = DB_STRINGS['practicePage.' + mapKey + '.' + value];
    if (dbVal != null) return dbVal;
    var lang = STRINGS[LANG] && STRINGS[LANG][mapKey];
    if (lang && lang[value] != null) return lang[value];
    return (STRINGS.en[mapKey] && STRINGS.en[mapKey][value]) || value;
  }

  var STUDENT_ID = null;
  var termsCache = null;
  var practicedIds = {};       // { [termId]: true }
  var protagonistName = '';    // from the student's own WIP Characters list, if any
  var pageSize = PAGE_SIZES[0];
  var currentPage = 1;
  var listEl, pagerEl, searchInput, craftSelect, complexitySelect, progressEl, todaySlotEl;
  var searchBtn, searchStatusEl, librarianResultsEl, searchClearBtnEl;

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

  function fetchTermsFor(lang) {
    return fetch(PROXY_URL + '/vocabulary?lang=' + encodeURIComponent(lang))
      .then(function (r) { return r.json(); })
      .then(function (d) { return (d && Array.isArray(d.terms)) ? d.terms : []; });
  }

  // See "Canonical enum keys" in the file header.
  function loadTerms(callback) {
    var main = fetchTermsFor(LANG);
    var canonical = LANG === 'en' ? main : fetchTermsFor('en').catch(function () { return []; });
    Promise.all([main, canonical])
      .then(function (res) {
        var terms = res[0];
        var enById = {};
        res[1].forEach(function (tm) { enById[String(tm.id)] = tm; });
        terms.forEach(function (tm) {
          var en = enById[String(tm.id)];
          tm.craftCategoryKey = (en && en.craftCategory) || tm.craftCategory || '';
          tm.complexityLevelKey = (en && en.complexityLevel) || tm.complexityLevel || '';
        });
        termsCache = terms;
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
    progressEl.textContent = total ? format(t('practicedOf'), { done: done, total: total }) : '';
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
    if (isPracticed) mount(head, el('span', 'sh-pl-practiced-badge', t('practicedBadge')));
    mount(entry, head);

    var body = el('div', 'sh-pl-entry-body');

    if (Array.isArray(term.exerciseSteps) && term.exerciseSteps.length) {
      var exWrap = el('div', 'sh-pl-exercise');
      mount(exWrap, el('div', 'sh-pl-exercise-label', t('tryIt')));
      var stepsList = document.createElement('ul');
      stepsList.className = 'sh-pl-exercise-list';
      term.exerciseSteps.forEach(function (step) {
        var li = document.createElement('li');
        li.textContent = step;
        stepsList.appendChild(li);
      });
      mount(exWrap, stepsList);
      if (protagonistName) {
        mount(exWrap, el('div', 'sh-pl-applied-hint', format(t('tryItWith'), { name: protagonistName })));
      }
      var practiceBtn = el('button', 'sh-pl-practice-btn' + (isPracticed ? ' sh-pl-practice-btn--done' : ''), isPracticed ? t('practicedBadge') : t('markAsPracticed'));
      practiceBtn.type = 'button';
      practiceBtn.addEventListener('click', function (e) {
        e.preventDefault();
        togglePracticed(term.id);
        practiceBtn.textContent = practicedIds[term.id] ? t('practicedBadge') : t('markAsPracticed');
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
      mount(crossWrap, el('span', 'sh-pl-crosslink-label', t('seeAlso')));
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
    mount(card, el('p', 'sh-pl-today-label', t('todaysTerm')));
    mount(card, buildTermCard(term, { collapsible: false }));
    mount(todaySlotEl, card);
  }

  function clearFilters() {
    searchInput.value = '';
    updateSearchClearVisibility();
    craftSelect.value = '';
    complexitySelect.value = '';
    currentPage = 1;
    clearLibrarianSearch();
    renderList();
  }

  // ----------------------------------------------------------
  // THE LIBRARIAN — AI search over vocabulary terms (Sept 2026),
  // same pattern as stratum-library.js's runLibrarianSearch/
  // renderLibrarianResults/clearLibrarianSearch, pointed at the new
  // POST /vocabulary/search endpoint instead of /library/search.
  // Category/Complexity filters keep working independently against
  // the normal list underneath, exactly as they do on the Library
  // page relative to its own Librarian results.
  // ----------------------------------------------------------
  function updateSearchClearVisibility() {
    if (!searchClearBtnEl) return;
    if (searchInput.value.trim()) searchClearBtnEl.classList.add('sh-pl-visible');
    else searchClearBtnEl.classList.remove('sh-pl-visible');
  }

  function runLibrarianSearch() {
    var query = searchInput.value.trim();
    if (!query) return;
    searchBtn.disabled = true;
    searchStatusEl.textContent = t('searching');
    librarianResultsEl.innerHTML = '';
    librarianResultsEl.style.display = '';
    listEl.style.display = 'none';
    pagerEl.style.display = 'none';
    fetch(PROXY_URL + '/vocabulary/search', {
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
    updateSearchClearVisibility();
    librarianResultsEl.innerHTML = '';
    librarianResultsEl.style.display = 'none';
    listEl.style.display = '';
    pagerEl.style.display = '';
  }

  function renderLibrarianResults(query, matches) {
    librarianResultsEl.innerHTML = '';
    var header = el('div', 'sh-pl-librarian-head');
    mount(header, el('p', 'sh-pl-librarian-title', format(t('librarianResultsFor'), { q: query })));
    var clearBtn = el('button', 'sh-pl-librarian-clear', t('clearSearch'));
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', clearLibrarianSearch);
    mount(header, clearBtn);
    mount(librarianResultsEl, header);

    if (!matches.length) {
      mount(librarianResultsEl, el('div', 'sh-pl-empty', t('librarianNoMatches')));
      return;
    }
    matches.forEach(function (match) {
      // Match id back to the full cached term (search results only carry
      // display fields) so opening/expanding it works exactly like the
      // normal list.
      var term = (termsCache || []).filter(function (tm) { return String(tm.id) === String(match.id); })[0];
      if (!term) return;
      var card = buildTermCard(term, { collapsible: true });
      if (match.reason) {
        card.querySelector('summary').appendChild(el('div', 'sh-pl-librarian-reason', match.reason));
      }
      mount(librarianResultsEl, card);
    });
  }

  function renderList() {
    var terms = termsCache || [];
    var craft = craftSelect.value;
    var level = complexitySelect.value;
    var filtered = terms.filter(function (term) {
      if (craft && term.craftCategoryKey !== craft) return false;
      if (level && term.complexityLevelKey !== level) return false;
      return true;
    });

    filtered.sort(function (a, b) {
      var la = COMPLEXITY_ORDER[a.complexityLevelKey];
      var lb = COMPLEXITY_ORDER[b.complexityLevelKey];
      la = la == null ? 99 : la;
      lb = lb == null ? 99 : lb;
      if (la !== lb) return la - lb;
      return (a.word || '').localeCompare(b.word || '');
    });

    listEl.innerHTML = '';
    pagerEl.innerHTML = '';

    if (!filtered.length) {
      var emptyMsg = terms.length ? t('noTermsMatch') : t('noTermsYet');
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
      if (term.complexityLevelKey !== lastLevel) {
        mount(listEl, el('p', 'sh-pl-level-header', (term.complexityLevelKey && tOption('complexityLevelOptions', term.complexityLevelKey)) || term.complexityLevel || 'Other'));
        lastLevel = term.complexityLevelKey;
      }
      mount(listEl, buildTermCard(term, { collapsible: true }));
    });

    if (totalPages > 1) {
      var prevBtn = el('button', 'sh-pl-pager-btn', t('previous'));
      prevBtn.type = 'button';
      prevBtn.disabled = currentPage <= 1;
      prevBtn.addEventListener('click', function () {
        currentPage -= 1;
        renderList();
        listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      mount(pagerEl, prevBtn);
      mount(pagerEl, el('span', 'sh-pl-pager-status', format(t('pageOf'), { page: currentPage, total: totalPages })));
      var nextBtn = el('button', 'sh-pl-pager-btn', t('next'));
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
    clearLibrarianSearch();
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
    var body = el('div', 'sh-gate sh-pl-page');
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

    var body = el('div', 'sh-form-body sh-pl-page');
    mount(body, el('h1', 'sh-form-title', t('title')));
    mount(body, el('p', 'sh-form-sub', t('sub')));
    progressEl = el('p', 'sh-pl-progress');
    mount(body, progressEl);

    todaySlotEl = el('div');
    mount(body, todaySlotEl);

    var toolbar = el('div', 'sh-pl-toolbar');

    var searchBar = el('div', 'sh-pl-search-bar');
    var searchInputWrap = el('div', 'sh-pl-search-input-wrap');
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'sh-pl-search-input';
    searchInput.placeholder = t('searchPlaceholder');
    searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runLibrarianSearch(); } });
    searchInput.addEventListener('input', updateSearchClearVisibility);
    mount(searchInputWrap, searchInput);
    var searchClearBtn = el('button', 'sh-pl-search-input-clear', '\u2715');
    searchClearBtnEl = searchClearBtn;
    searchClearBtn.type = 'button';
    searchClearBtn.setAttribute('aria-label', t('clearSearch'));
    searchClearBtn.addEventListener('click', function () { clearLibrarianSearch(); searchInput.focus(); });
    mount(searchInputWrap, searchClearBtn);
    mount(searchBar, searchInputWrap);
    searchBtn = el('button', 'sh-pl-search-btn', t('search'));
    searchBtn.type = 'button';
    searchBtn.addEventListener('click', runLibrarianSearch);
    mount(searchBar, searchBtn);
    mount(body, searchBar);
    searchStatusEl = el('p', 'sh-pl-progress');
    mount(body, searchStatusEl);

    function buildFilterSelect(label, options, optionMapKey) {
      var fwrap = el('div', 'sh-pl-filter-wrap');
      mount(fwrap, el('span', 'sh-pl-filter-label', label));
      var select = document.createElement('select');
      select.className = 'sh-pl-filter-select';
      var allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = t('all');
      select.appendChild(allOpt);
      options.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt; // canonical English value — matched against term.*Key, never translated
        o.textContent = optionMapKey ? tOption(optionMapKey, opt) : opt;
        select.appendChild(o);
      });
      select.addEventListener('change', function () { currentPage = 1; renderList(); });
      mount(fwrap, select);
      return { wrap: fwrap, select: select };
    }
    var craftFilter = buildFilterSelect(t('craftCategory'), CRAFT_CATEGORIES, 'craftCategoryOptions');
    craftSelect = craftFilter.select;
    mount(toolbar, craftFilter.wrap);
    var complexityFilter = buildFilterSelect(t('complexityLevel'), COMPLEXITY_LEVELS, 'complexityLevelOptions');
    complexitySelect = complexityFilter.select;
    mount(toolbar, complexityFilter.wrap);

    var pageSizeWrap = el('div', 'sh-pl-filter-wrap');
    mount(pageSizeWrap, el('span', 'sh-pl-filter-label', t('show')));
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

    var clearBtn = el('button', 'sh-pl-clear-btn', t('clear'));
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', clearFilters);
    mount(toolbar, clearBtn);

    mount(body, toolbar);

    librarianResultsEl = el('div', 'sh-pl-list sh-pl-librarian-results');
    librarianResultsEl.style.display = 'none';
    mount(body, librarianResultsEl);

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
    // Load this page's own translated chrome before anything using t()
    // runs, including the logged-out/no-membership gate messages -
    // otherwise the very first paint (or the gate) would flash English
    // before a later re-render caught up. Same ordering as stratum-
    // library.js.
    loadUiStrings().then(function () {
      if (!WP_USER.loggedIn) {
        buildGate(container, t('loginToView'), WP_USER.loginUrl, t('logIn'));
        return;
      }
      if (!WP_USER.hasMembership) {
        buildGate(container, t('noMembership'), '/membership-account/', t('goToMyAccount'));
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
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
