/* ============================================================
   STRATUM DASHBOARD — IDEA LOG & REMINDERS (Sept 2026)
   ------------------------------------------------------------
   Both cards now carry their FULL functionality inline — add,
   filter, full list, delete, and (for Reminders) toggle/clear-
   completed/reset — collapsed by default (showing the same compact
   recent-entries summary as before) and expanding in place when
   "View" is clicked, rather than navigating to a separate page. Per
   Ted's decision, the standalone /idea-log/ and /reminders/ pages
   are retired; this file is now the only place either of these is
   editable. (stratum-idea-log.js/.css and stratum-reminders.js/.css,
   and their WordPress page templates, are unused as of this change —
   nothing loads them anymore. Safe to remove from the repo/WP at
   Ted's convenience; not required for anything to keep working.)

   Same /notes and /tasks endpoints and record shapes as always —
   this is a UI change, not a data-model change.

   Mounts INTO the same dark card stratum-header.js builds, via the
   'stratum:header-mounted' handoff that file publishes (window.
   STRATUM_HEADER_WRAP + a matching event, so load order never
   matters) — this file never builds its own separate container.

   Data timing: waits for the header's 'stratum:identity-ready'
   event/global (see stratum-identity.js) rather than reading the
   stratum_sid cookie directly — resolution is async and this file
   would otherwise race it.

   ---- Spanish translation (Sept 2026) ----
   Every visible string in this file now goes through STRINGS/t(),
   keyed off the SAME 'wlfc_preferred_lang' value the header's
   Language dropdown already sets (stratum-header.js's
   switchLanguage()) and reloads the page on change, so a fresh read
   here on load is enough — no live-update logic needed. Category
   names and reminder presets keep their ENGLISH value as the stored/
   matched value (option.value, entry.category, filter comparisons)
   and only their DISPLAYED label changes — so switching languages
   never breaks matching against data saved under the other language.
   Date formatting also switches locale (DATE_LOCALE) so "Today" /
   relative dates / the exported .txt files' dates read naturally in
   either language.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var IDEA_LOG_LIMIT = 1;    // shown in the collapsed summary view — only the latest entry
  var REMINDERS_LIMIT = 1;   // shown in the collapsed summary view — only the latest reminder

  var LANG_STORE_KEY = 'wlfc_preferred_lang'; // same key the header's Language dropdown sets
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var LANG = lsGet(LANG_STORE_KEY) || 'en';
  var DATE_LOCALE = LANG === 'es' ? 'es-ES' : 'en-US';

  var STRINGS = {
    en: {
      ideaLogTitle: 'Idea Log',
      remindersTitle: 'Reminders',
      viewBtn: 'View',
      closeBtn: 'Close',
      noIdeaEntries: 'No idea log entries yet.',
      chooseCategory: 'Choose a category\u2026',
      writeNote: 'Write your note\u2026',
      addEntry: 'Add Entry',
      chooseCategoryAndWrite: 'Choose a category and write something first.',
      filterLabel: 'Filter',
      all: 'All',
      download: 'Download',
      noEntriesInCategory: 'No entries in this category yet.',
      noEntriesAddOne: 'No entries yet. Add one above.',
      deleteEntry: 'Delete entry',
      noEntriesToDownload: 'No entries to download.',
      noRemindersYet: 'No reminders yet.',
      chooseType: 'Choose a type\u2026',
      writeYourOwn: 'Write your own\u2026',
      addReminderPlaceholder: 'Add a reminder\u2026',
      add: 'Add',
      noRemindersAddOne: 'No reminders yet. Add one above.',
      clearCompleted: 'Clear Completed',
      resetAll: 'Reset All',
      confirmDeleteAllReminders: 'Delete all reminders? This cannot be undone.',
      overdue: 'Overdue \u2014 ',
      due: 'Due ',
      deleteReminder: 'Delete reminder',
      noRemindersToDownload: 'No reminders to download.',
      today: 'Today',
      yesterday: 'Yesterday',
      daysAgo: '{n} days ago',
      exportHeaderReminders: 'THE STRATUM METHOD \u2014 MY REMINDERS',
      exportHeaderIdeaLog: 'THE STRATUM METHOD \u2014 MY IDEA LOG',
      exported: 'Exported: ',
      remainingOf: '{remaining} of {total} remaining.',
      categories: {
        Character: 'Character', Plot: 'Plot', Theme: 'Theme', Revision: 'Revision',
        Research: 'Research', Deadlines: 'Deadlines', Inspiration: 'Inspiration', General: 'General'
      },
      presets: {
        'Finish a chapter draft': 'Finish a chapter draft',
        'Revise a scene': 'Revise a scene',
        'Outline next section': 'Outline next section',
        'Character deep dive': 'Character deep dive',
        'Check continuity': 'Check continuity',
        'Polish opening paragraph': 'Polish opening paragraph',
        'Deadline for manuscript changes': 'Deadline for manuscript changes',
        'Submit to beta reader': 'Submit to beta reader',
        'Research setting details': 'Research setting details',
        'Track word count goal': 'Track word count goal',
        'Prepare query letter': 'Prepare query letter',
        'Finalize antagonist arc': 'Finalize antagonist arc'
      }
    },
    es: {
      ideaLogTitle: 'Registro de ideas',
      remindersTitle: 'Recordatorios',
      viewBtn: 'Ver',
      closeBtn: 'Cerrar',
      noIdeaEntries: 'Aún no hay entradas en el registro de ideas.',
      chooseCategory: 'Elige una categoría\u2026',
      writeNote: 'Escribe tu nota\u2026',
      addEntry: 'Agregar entrada',
      chooseCategoryAndWrite: 'Elige una categoría y escribe algo primero.',
      filterLabel: 'Filtrar',
      all: 'Todas',
      download: 'Descargar',
      noEntriesInCategory: 'Aún no hay entradas en esta categoría.',
      noEntriesAddOne: 'Aún no hay entradas. Agrega una arriba.',
      deleteEntry: 'Eliminar entrada',
      noEntriesToDownload: 'No hay entradas para descargar.',
      noRemindersYet: 'Aún no hay recordatorios.',
      chooseType: 'Elige un tipo\u2026',
      writeYourOwn: 'Escribe el tuyo\u2026',
      addReminderPlaceholder: 'Agrega un recordatorio\u2026',
      add: 'Agregar',
      noRemindersAddOne: 'Aún no hay recordatorios. Agrega uno arriba.',
      clearCompleted: 'Borrar completados',
      resetAll: 'Restablecer todo',
      confirmDeleteAllReminders: '\u00bfEliminar todos los recordatorios? Esta acción no se puede deshacer.',
      overdue: 'Atrasado \u2014 ',
      due: 'Vence ',
      deleteReminder: 'Eliminar recordatorio',
      noRemindersToDownload: 'No hay recordatorios para descargar.',
      today: 'Hoy',
      yesterday: 'Ayer',
      daysAgo: 'Hace {n} días',
      exportHeaderReminders: 'THE STRATUM METHOD \u2014 MIS RECORDATORIOS',
      exportHeaderIdeaLog: 'THE STRATUM METHOD \u2014 MI REGISTRO DE IDEAS',
      exported: 'Exportado: ',
      remainingOf: '{remaining} de {total} pendientes.',
      categories: {
        Character: 'Personaje', Plot: 'Trama', Theme: 'Tema', Revision: 'Revisión',
        Research: 'Investigación', Deadlines: 'Plazos', Inspiration: 'Inspiración', General: 'General'
      },
      presets: {
        'Finish a chapter draft': 'Terminar el borrador de un capítulo',
        'Revise a scene': 'Revisar una escena',
        'Outline next section': 'Esquematizar la próxima sección',
        'Character deep dive': 'Profundizar en un personaje',
        'Check continuity': 'Revisar la continuidad',
        'Polish opening paragraph': 'Pulir el párrafo inicial',
        'Deadline for manuscript changes': 'Plazo para cambios al manuscrito',
        'Submit to beta reader': 'Enviar a un lector beta',
        'Research setting details': 'Investigar detalles del entorno',
        'Track word count goal': 'Seguir la meta de conteo de palabras',
        'Prepare query letter': 'Preparar la carta de presentación',
        'Finalize antagonist arc': 'Finalizar el arco del antagonista'
      }
    }
  };
  var DB_COMMON_KEYS = { viewBtn: 'view', closeBtn: 'close', today: 'today', yesterday: 'yesterday', daysAgo: 'daysAgo' };
  var PRESET_SLUGS = {
    'Finish a chapter draft': 'finishChapter',
    'Revise a scene': 'reviseScene',
    'Outline next section': 'outlineSection',
    'Character deep dive': 'characterDeepDive',
    'Check continuity': 'checkContinuity',
    'Polish opening paragraph': 'polishOpening',
    'Deadline for manuscript changes': 'deadlineChanges',
    'Submit to beta reader': 'submitBeta',
    'Research setting details': 'researchSetting',
    'Track word count goal': 'trackWordCount',
    'Prepare query letter': 'prepareQuery',
    'Finalize antagonist arc': 'finalizeAntagonist'
  };
  var DB_STRINGS = null;
  var uiStringsCallbacks = [];
  function loadUiStrings(callback) {
    if (DB_STRINGS) { callback(); return; }
    uiStringsCallbacks.push(callback);
    if (uiStringsCallbacks.length > 1) return;
    fetch(PROXY_URL + '/ui-strings?lang=' + encodeURIComponent(LANG))
      .then(function (r) { return r.json(); })
      .then(function (d) { DB_STRINGS = (d && d.strings) || {}; })
      .catch(function () { DB_STRINGS = {}; })
      .then(function () {
        var cbs = uiStringsCallbacks; uiStringsCallbacks = [];
        cbs.forEach(function (cb) { cb(); });
      });
  }
  function format(str, vars) {
    return str.replace(/\{(\w+)\}/g, function (_, k) { return (vars && vars[k] != null) ? vars[k] : ''; });
  }
  function t(key) {
    if (DB_STRINGS) {
      var dbKey = DB_COMMON_KEYS[key] ? ('common.' + DB_COMMON_KEYS[key]) : ('dashboard.' + key);
      if (DB_STRINGS[dbKey] != null) return DB_STRINGS[dbKey];
    }
    return (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key];
  }
  function catLabel(cat) {
    if (DB_STRINGS && DB_STRINGS['dashboard.cat.' + cat] != null) return DB_STRINGS['dashboard.cat.' + cat];
    return ((STRINGS[LANG] && STRINGS[LANG].categories) || STRINGS.en.categories)[cat] || cat;
  }
  function presetLabel(p) {
    var slug = PRESET_SLUGS[p];
    if (DB_STRINGS && slug && DB_STRINGS['dashboard.preset.' + slug] != null) return DB_STRINGS['dashboard.preset.' + slug];
    return ((STRINGS[LANG] && STRINGS[LANG].presets) || STRINGS.en.presets)[p] || p;
  }

  // Canonical (English) values — these are what's actually STORED and
  // matched against (entry.category, filterSelect comparisons, option
  // .value); catLabel()/presetLabel() above supply the displayed text.
  var IDEA_LOG_CATEGORIES = ['Character', 'Plot', 'Theme', 'Revision', 'Research', 'Deadlines', 'Inspiration'];
  var GENERAL_CATEGORY = 'General'; // tag used for migrated legacy single-blob notes
  var REMINDER_PRESETS = [
    'Finish a chapter draft', 'Revise a scene', 'Outline next section',
    'Character deep dive', 'Check continuity', 'Polish opening paragraph',
    'Deadline for manuscript changes', 'Submit to beta reader',
    'Research setting details', 'Track word count goal',
    'Prepare query letter', 'Finalize antagonist arc'
  ];

  var STUDENT_ID = null; // set from the 'stratum:identity-ready' event detail — see init()

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  function formatRelativeDate(isoDateOrMs) {
    var d = typeof isoDateOrMs === 'number' ? new Date(isoDateOrMs) : new Date(isoDateOrMs + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    var days = Math.round((new Date().setHours(0, 0, 0, 0) - d.setHours(0, 0, 0, 0)) / 86400000);
    if (days <= 0) return t('today');
    if (days === 1) return t('yesterday');
    if (days < 14) return format(t('daysAgo'), { n: days });
    return d.toLocaleDateString(DATE_LOCALE, { month: 'short', day: 'numeric' });
  }
  function formatFullDate(isoDate) {
    var d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString(DATE_LOCALE, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function formatShortDate(isoDate) {
    var d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(DATE_LOCALE, { month: 'short', day: 'numeric' });
  }

  // ============================================================
  // IDEA LOG — data
  // ============================================================
  var ideaLogEntries = [];

  function loadIdeaLogEntries(callback) {
    if (!STUDENT_ID) { ideaLogEntries = []; callback(); return; }
    fetch(PROXY_URL + '/notes?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known || !d.text) { ideaLogEntries = []; callback(); return; }
        var parsed;
        try { parsed = JSON.parse(d.text); } catch (e) { parsed = null; }
        if (Array.isArray(parsed)) {
          ideaLogEntries = parsed;
        } else if (String(d.text).trim()) {
          ideaLogEntries = [{
            id: 'legacy-' + Date.now().toString(36),
            category: GENERAL_CATEGORY,
            date: new Date().toISOString().slice(0, 10),
            createdAt: Date.now(),
            text: d.text
          }];
          saveIdeaLogEntries();
        } else {
          ideaLogEntries = [];
        }
        callback();
      })
      .catch(function () { ideaLogEntries = []; callback(); });
  }
  function saveIdeaLogEntries() {
    if (!STUDENT_ID) return;
    fetch(PROXY_URL + '/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, text: JSON.stringify(ideaLogEntries) })
    }).catch(function () {});
  }

  // ============================================================
  // REMINDERS — data
  // ============================================================
  var tasks = [];

  function loadTasks(callback) {
    if (!STUDENT_ID) { tasks = []; callback(); return; }
    fetch(PROXY_URL + '/tasks?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        tasks = (d && d.known && Array.isArray(d.tasks)) ? d.tasks : [];
        callback();
      })
      .catch(function () { tasks = []; callback(); });
  }
  function saveTasks() {
    if (!STUDENT_ID) return;
    fetch(PROXY_URL + '/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, tasks: tasks })
    }).catch(function () {});
  }

  // ============================================================
  // IDEA LOG CARD
  // ============================================================
  var ideaLogExpanded = false;
  var ideaLogBodyEl = null;
  var ideaLogOpenBtn = null;
  var ideaLogFilterVal = '';

  function renderIdeaLogCollapsed() {
    ideaLogBodyEl.innerHTML = '';
    var grid = el('div', 'sh-idea-grid');
    var sorted = ideaLogEntries.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var recent = sorted.slice(0, IDEA_LOG_LIMIT);
    if (!recent.length) {
      mount(ideaLogBodyEl, el('div', 'sh-dash-empty', t('noIdeaEntries')));
      return;
    }
    recent.forEach(function (entry) {
      var item = el('div', 'sh-idea-entry');
      mount(item, el('div', 'sh-idea-icon', '\u{1F4AC}'));
      var text = document.createElement('div');
      var top = el('div', 'sh-idea-top');
      mount(top, el('span', 'sh-idea-tag', catLabel(entry.category || 'General')));
      mount(top, el('span', null, formatRelativeDate(entry.createdAt || entry.date)));
      mount(text, top);
      mount(text, el('div', 'sh-idea-text', entry.text || ''));
      mount(item, text);
      mount(grid, item);
    });
    mount(ideaLogBodyEl, grid);
  }

  function renderIdeaLogExpanded() {
    ideaLogBodyEl.innerHTML = '';

    var form = el('div', 'sh-dash-form');
    var formRow = el('div', 'sh-dash-form-row');
    var categorySelect = document.createElement('select');
    categorySelect.className = 'sh-dash-select';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('chooseCategory');
    categorySelect.appendChild(placeholder);
    IDEA_LOG_CATEGORIES.forEach(function (cat) {
      var o = document.createElement('option');
      o.value = cat;
      o.textContent = catLabel(cat);
      categorySelect.appendChild(o);
    });
    mount(formRow, categorySelect);
    var textInput = document.createElement('textarea');
    textInput.className = 'sh-dash-textarea';
    textInput.placeholder = t('writeNote');
    textInput.maxLength = 2000;
    mount(formRow, textInput);
    mount(form, formRow);
    var formFoot = el('div', 'sh-dash-form-foot');
    var addStatus = el('span', 'sh-dash-add-status');
    mount(formFoot, addStatus);
    var addBtn = el('button', 'sh-dash-add-btn', t('addEntry'));
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () {
      var category = categorySelect.value;
      var text = textInput.value.trim();
      if (!category || !text) { addStatus.textContent = t('chooseCategoryAndWrite'); return; }
      ideaLogEntries.unshift({
        id: Date.now().toString(),
        category: category,
        date: new Date().toISOString().slice(0, 10),
        createdAt: Date.now(),
        text: text
      });
      saveIdeaLogEntries();
      categorySelect.value = '';
      textInput.value = '';
      addStatus.textContent = '';
      renderIdeaLogFullList();
    });
    mount(formFoot, addBtn);
    mount(form, formFoot);
    mount(ideaLogBodyEl, form);

    var toolbar = el('div', 'sh-dash-toolbar');
    mount(toolbar, el('span', 'sh-dash-filter-label', t('filterLabel')));
    var filterSelect = document.createElement('select');
    filterSelect.className = 'sh-dash-select';
    var allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = t('all');
    filterSelect.appendChild(allOpt);
    IDEA_LOG_CATEGORIES.concat([GENERAL_CATEGORY]).forEach(function (cat) {
      var o = document.createElement('option');
      o.value = cat;
      o.textContent = catLabel(cat);
      filterSelect.appendChild(o);
    });
    filterSelect.value = ideaLogFilterVal;
    filterSelect.addEventListener('change', function () { ideaLogFilterVal = filterSelect.value; renderIdeaLogFullList(); });
    mount(toolbar, filterSelect);
    var dlBtn = el('button', 'sh-dash-download-btn', t('download'));
    dlBtn.type = 'button';
    dlBtn.addEventListener('click', downloadIdeaLog);
    mount(toolbar, dlBtn);
    mount(ideaLogBodyEl, toolbar);

    var listEl = el('div', 'sh-dash-full-list');
    listEl.id = 'shDashIdeaLogFullList';
    mount(ideaLogBodyEl, listEl);
    renderIdeaLogFullList();
  }

  function renderIdeaLogFullList() {
    var listEl = document.getElementById('shDashIdeaLogFullList');
    if (!listEl) return;
    var sorted = ideaLogEntries.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var filtered = ideaLogFilterVal ? sorted.filter(function (e) { return e.category === ideaLogFilterVal; }) : sorted;
    listEl.innerHTML = '';
    if (!filtered.length) {
      mount(listEl, el('div', 'sh-dash-empty', ideaLogFilterVal ? t('noEntriesInCategory') : t('noEntriesAddOne')));
      return;
    }
    filtered.forEach(function (entry) {
      var isLegacy = entry.category === GENERAL_CATEGORY;
      var row = el('div', 'sh-dash-list-entry' + (isLegacy ? ' sh-dash-legacy' : ''));
      var head = el('div', 'sh-dash-list-entry-head');
      mount(head, el('span', 'sh-idea-tag', catLabel(entry.category)));
      mount(head, el('span', 'sh-dash-list-entry-date', formatFullDate(entry.date)));
      mount(row, head);
      mount(row, el('div', 'sh-dash-list-entry-text', entry.text));
      var del = el('button', 'sh-dash-list-delete', '\u00d7');
      del.type = 'button';
      del.title = t('deleteEntry');
      del.addEventListener('click', function () {
        ideaLogEntries = ideaLogEntries.filter(function (e) { return e.id !== entry.id; });
        saveIdeaLogEntries();
        renderIdeaLogFullList();
      });
      mount(row, del);
      mount(listEl, row);
    });
  }

  function downloadIdeaLog() {
    var sorted = ideaLogEntries.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    if (!sorted.length) { alert(t('noEntriesToDownload')); return; }
    var dateStr = new Date().toLocaleDateString(DATE_LOCALE, { year: 'numeric', month: 'long', day: 'numeric' });
    var txt = t('exportHeaderIdeaLog') + '\n' + t('exported') + dateStr + '\n==========================================\n\n';
    sorted.forEach(function (e) { txt += '[' + catLabel(e.category) + '] ' + formatFullDate(e.date) + '\n' + e.text + '\n\n'; });
    var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'MyIdeaLog.txt';
    link.click();
  }

  function toggleIdeaLog() {
    ideaLogExpanded = !ideaLogExpanded;
    ideaLogOpenBtn.textContent = ideaLogExpanded ? t('closeBtn') : t('viewBtn');
    if (ideaLogExpanded) renderIdeaLogExpanded();
    else renderIdeaLogCollapsed();
  }

  function buildIdeaLogCard() {
    var card = el('div', 'sh-dash-card');
    var head = el('div', 'sh-dash-card-head');
    mount(head, el('p', 'sh-dash-card-title', t('ideaLogTitle')));
    ideaLogOpenBtn = document.createElement('button');
    ideaLogOpenBtn.type = 'button';
    ideaLogOpenBtn.className = 'sh-dash-open-btn';
    ideaLogOpenBtn.textContent = t('viewBtn');
    ideaLogOpenBtn.addEventListener('click', toggleIdeaLog);
    mount(head, ideaLogOpenBtn);
    mount(card, head);

    ideaLogBodyEl = el('div', 'sh-dash-card-body');
    mount(card, ideaLogBodyEl);

    loadIdeaLogEntries(renderIdeaLogCollapsed);
    return card;
  }

  // ============================================================
  // REMINDERS CARD
  // ============================================================
  var remindersExpanded = false;
  var remindersBodyEl = null;
  var remindersOpenBtn = null;

  function renderRemindersCollapsed() {
    remindersBodyEl.innerHTML = '';
    // "Latest" = most recently added, regardless of done state — ids are
    // Date.now().toString(), so sorting numerically descending gives
    // true recency rather than the old open-before-done ordering, which
    // stopped making sense once only one item is ever shown here.
    var sorted = tasks.slice().sort(function (a, b) { return Number(b.id) - Number(a.id); });
    var visible = sorted.slice(0, REMINDERS_LIMIT);
    if (!visible.length) {
      mount(remindersBodyEl, el('div', 'sh-dash-empty', t('noRemindersYet')));
      return;
    }
    visible.forEach(function (task) {
      var row = el('div', 'sh-reminder-row' + (task.done ? ' sh-row-done' : ''));
      var check = el('div', 'sh-check' + (task.done ? ' sh-done' : ''), task.done ? '\u2713' : '');
      mount(row, check);
      var textWrap = el('div', 'sh-reminder-text');
      mount(textWrap, el('div', 'sh-reminder-title', task.text || ''));
      if (!task.done && task.dueDate) mount(textWrap, el('div', 'sh-reminder-meta', t('due') + formatShortDate(task.dueDate)));
      mount(row, textWrap);
      if (task.dueDate) mount(row, el('div', 'sh-reminder-date', formatShortDate(task.dueDate)));
      mount(remindersBodyEl, row);
    });
  }

  function renderRemindersExpanded() {
    remindersBodyEl.innerHTML = '';

    var form = el('div', 'sh-dash-form');
    var presetSelect = document.createElement('select');
    presetSelect.className = 'sh-dash-select sh-dash-select--full';
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('chooseType');
    presetSelect.appendChild(placeholder);
    REMINDER_PRESETS.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p;
      o.textContent = presetLabel(p);
      presetSelect.appendChild(o);
    });
    var customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = t('writeYourOwn');
    presetSelect.appendChild(customOpt);
    mount(form, presetSelect);

    var inputRow = el('div', 'sh-dash-form-row');
    var textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'sh-dash-input';
    textInput.placeholder = t('addReminderPlaceholder');
    textInput.maxLength = 200;
    mount(inputRow, textInput);
    presetSelect.addEventListener('change', function () {
      var val = presetSelect.value;
      if (!val) return;
      textInput.value = (val === '__custom__') ? '' : presetLabel(val);
      textInput.focus();
      presetSelect.value = '';
    });
    var dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.className = 'sh-dash-date-input';
    mount(inputRow, dateInput);
    mount(form, inputRow);

    var formFoot = el('div', 'sh-dash-form-foot');
    var countEl = el('span', 'sh-dash-add-status');
    mount(formFoot, countEl);
    var addBtn = el('button', 'sh-dash-add-btn', t('add'));
    addBtn.type = 'button';
    function addTask() {
      var text = textInput.value.trim();
      if (!text) return;
      tasks.push({ id: Date.now().toString(), text: text, done: false, dueDate: dateInput.value || null });
      saveTasks();
      textInput.value = '';
      dateInput.value = '';
      renderRemindersFullList();
    }
    addBtn.addEventListener('click', addTask);
    textInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') addTask(); });
    mount(formFoot, addBtn);
    mount(form, formFoot);
    mount(remindersBodyEl, form);

    var listEl = el('div', 'sh-dash-full-list');
    listEl.id = 'shDashRemindersFullList';
    mount(remindersBodyEl, listEl);

    var actions = el('div', 'sh-dash-toolbar');
    var dlBtn = el('button', 'sh-dash-download-btn', t('download'));
    dlBtn.type = 'button';
    dlBtn.addEventListener('click', downloadReminders);
    mount(actions, dlBtn);
    var clearBtn = el('button', 'sh-dash-download-btn', t('clearCompleted'));
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', function () {
      tasks = tasks.filter(function (t) { return !t.done; });
      saveTasks();
      renderRemindersFullList();
    });
    mount(actions, clearBtn);
    var resetBtn = el('button', 'sh-dash-download-btn sh-dash-download-btn--danger', t('resetAll'));
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', function () {
      if (!confirm(t('confirmDeleteAllReminders'))) return;
      tasks = [];
      saveTasks();
      renderRemindersFullList();
    });
    mount(actions, resetBtn);
    mount(remindersBodyEl, actions);

    renderRemindersFullList();
  }

  function renderRemindersFullList() {
    var listEl = document.getElementById('shDashRemindersFullList');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!tasks.length) {
      mount(listEl, el('div', 'sh-dash-empty', t('noRemindersAddOne')));
      return;
    }
    var todayStr = new Date().toISOString().slice(0, 10);
    tasks.forEach(function (task) {
      var row = el('div', 'sh-dash-list-entry sh-dash-reminder-full' + (task.done ? ' sh-row-done' : ''));
      var check = el('div', 'sh-check' + (task.done ? ' sh-done' : ''), task.done ? '\u2713' : '');
      check.addEventListener('click', function () { task.done = !task.done; saveTasks(); renderRemindersFullList(); });
      mount(row, check);
      var textWrap = el('div', 'sh-dash-list-entry-text sh-dash-reminder-full-text');
      textWrap.addEventListener('click', function () { task.done = !task.done; saveTasks(); renderRemindersFullList(); });
      textWrap.textContent = task.text;
      mount(row, textWrap);
      if (task.dueDate) {
        var overdue = !task.done && task.dueDate < todayStr;
        mount(row, el('span', 'sh-dash-list-entry-date' + (overdue ? ' sh-dash-overdue' : ''), (overdue ? t('overdue') : t('due')) + formatShortDate(task.dueDate)));
      }
      var del = el('button', 'sh-dash-list-delete', '\u00d7');
      del.type = 'button';
      del.title = t('deleteReminder');
      del.addEventListener('click', function () {
        tasks = tasks.filter(function (t) { return t.id !== task.id; });
        saveTasks();
        renderRemindersFullList();
      });
      mount(row, del);
      mount(listEl, row);
    });
  }

  function downloadReminders() {
    if (!tasks.length) { alert(t('noRemindersToDownload')); return; }
    var dateStr = new Date().toLocaleDateString(DATE_LOCALE, { year: 'numeric', month: 'long', day: 'numeric' });
    var txt = t('exportHeaderReminders') + '\n' + t('exported') + dateStr + '\n==========================================\n\n';
    tasks.forEach(function (task) {
      txt += (task.done ? '[x] ' : '[ ] ') + task.text;
      if (task.dueDate) txt += '  (' + t('due').toLowerCase() + formatShortDate(task.dueDate) + ')';
      txt += '\n';
    });
    var remaining = tasks.filter(function (task) { return !task.done; }).length;
    txt += '\n==========================================\n' + format(t('remainingOf'), { remaining: remaining, total: tasks.length }) + '\n';
    var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'MyReminders.txt';
    link.click();
  }

  function toggleReminders() {
    remindersExpanded = !remindersExpanded;
    remindersOpenBtn.textContent = remindersExpanded ? t('closeBtn') : t('viewBtn');
    if (remindersExpanded) renderRemindersExpanded();
    else renderRemindersCollapsed();
  }

  function buildRemindersCard() {
    var card = el('div', 'sh-dash-card');
    var head = el('div', 'sh-dash-card-head');
    mount(head, el('p', 'sh-dash-card-title', t('remindersTitle')));
    remindersOpenBtn = document.createElement('button');
    remindersOpenBtn.type = 'button';
    remindersOpenBtn.className = 'sh-dash-open-btn';
    remindersOpenBtn.textContent = t('viewBtn');
    remindersOpenBtn.addEventListener('click', toggleReminders);
    mount(head, remindersOpenBtn);
    mount(card, head);

    remindersBodyEl = el('div', 'sh-dash-card-body');
    mount(card, remindersBodyEl);

    loadTasks(renderRemindersCollapsed);
    return card;
  }

  // ============================================================
  // SECTION SHELL
  // ============================================================
  function buildDashboardSection() {
    var section = el('div', 'sh-dash-section');
    var panels = el('div', 'sh-dash-panels');
    mount(panels, buildIdeaLogCard());
    mount(panels, buildRemindersCard());
    mount(section, panels);
    return section;
  }

  function mountInto(wrapEl) {
    if (!wrapEl || wrapEl.querySelector('.sh-dash-section')) return; // avoid double-mount
    mount(wrapEl, buildDashboardSection());
  }

  function proceed(studentId) {
    STUDENT_ID = studentId || null;
    loadUiStrings(function () {
      mountInto(window.STRATUM_HEADER_WRAP);
    });
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
