/* ============================================================
   STRATUM WIP PANEL — EMBEDDED PROFILE SECTION (Sept 2026)
   ------------------------------------------------------------
   Replaces the old standalone /wip-profile/ page entirely — the WIP
   profile now lives directly in the System Page header, mounted into
   the same dark card stratum-header.js builds, via the same 'stratum:
   identity-ready' handoff stratum-dashboard.js already uses (both
   modules wait on the same signal; script load order between them is
   set in system-page-template.php).

   Two-column layout, per Ted's spec:
     Column 1 ("Project Description" label): Working Title, Genre,
     Stage of Progress, Story Style, POV, Theme/Focus (one merged
     free-text field — the old separate Theme and Focus fields, and
     the FOCUS_GUIDANCE enum-matching logic in stratum-coach.js that
     depended on Focus being a fixed dropdown, are both retired).
     Column 2 ("Characters" label): a repeatable list, up to 15 rows,
     each with Name / Type / Role Type / Core Conflict — Role Type and
     Core Conflict are cascading selects whose options depend on that
     row's own Type (Protagonist / Antagonist / Supporting Character).

   Everything here is server-authoritative via /project GET/POST — no
   localStorage caching — so a student's profile carries correctly
   across devices, per Ted's explicit requirement. This data also
   feeds directly into every coaching session's system prompt (see
   buildProjectContextBlock() in stratum-coach.js), same as Global
   Instructions and each session's own per-layer instructions.

   "Where you're stuck" (the old challenges field) is eliminated
   entirely per Ted's decision — there is no replacement for it.

   Requires stratum-identity.js AND stratum-header.js (for
   window.StratumHeader / the identity-ready signal) loaded first.

   ---- Translation (Sept 2026) ----
   Card chrome, field labels, placeholders, status messages, and the
   top-level Genre/Stage/Story Style/POV/Character-Type option labels
   all translate via STRINGS/t(), keyed off the same 'wlfc_preferred_
   lang' the header sets. Every dropdown's stored VALUE stays the
   canonical English string (option.value, what actually gets saved
   to /project) — only the displayed label changes — so a WIP saved
   in one language still reads back correctly after switching to
   another.

   Sept 24 2026: the ~50 Role Type / Core Conflict options (ROLE_TYPE_
   BY_TYPE / CORE_CONFLICT_BY_TYPE) now translate too, via
   cascadeLabel(): DB keys 'wip.roleType.<slug>' and
   'wip.coreConflict.<slug>', where slug = the English value
   lowercased with every run of non-alphanumerics turned into '_'
   (e.g. 'Love/Connection' -> 'wip.coreConflict.love_connection').
   Those keys are registered in UI_STRING_KEYS in worker.js — keep the
   slug rule identical on both sides. Falls back to the English value
   when no DB translation exists.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var MAX_CHARACTERS = 15;

  var STUDENT_ID = null;
  var currentProfile = null; // last-loaded server record, used to preserve studentName/language on save
  var characterRows = [];    // [{ id, nameInput, typeSelect, roleTypeSelect, coreConflictSelect, rowEl }]
  var rowCounter = 0;

  var LANG_STORE_KEY = 'wlfc_preferred_lang'; // same key the header's Language dropdown sets
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var LANG = lsGet(LANG_STORE_KEY) || 'en';

  var STRINGS = {
    en: {
      profileTitle: 'Profile',
      profileSubtitle: 'Your WIP feeds into all coaching sessions, notes, and reminders.',
      viewBtn: 'View',
      closeBtn: 'Close',
      workInProgress: 'Work in Progress',
      newWip: '+ New WIP',
      deleteThisWip: 'Delete this WIP',
      untitledWip: 'Untitled WIP',
      selectWipOption: 'Select WIP',
      noWipYet: 'No WIP yet \u2014 open to add your first one.',
      noWipProfileYet: 'No WIP profile yet \u2014 open to add yours.',
      noWipAtAllMsg: 'You don\u2019t have a work-in-progress yet \u2014 click + New WIP above to add one.',
      autosaveLabel: 'Your changes save automatically',
      saving: 'Saving\u2026',
      saved: 'Saved',
      editing: 'Editing\u2026',
      creating: 'Creating\u2026',
      couldNotSave: 'Could not save \u2014 will retry on your next change',
      networkErrorSave: 'Network error \u2014 will retry on your next change',
      couldNotCreateWip: 'Could not create a new WIP',
      networkErrorCreateWip: 'Network error \u2014 could not create a new WIP',
      networkErrorDeleteWip: 'Network error \u2014 could not delete',
      confirmDeleteWip: 'Delete \u201c{name}\u201d and its character list? This can\u2019t be undone. (Any excavation progress already recorded for its characters stays in the system but becomes unreachable.)',
      projectDescription: 'Project Description',
      workingTitle: 'Working Title',
      workingTitlePlaceholder: 'e.g. What the River Kept',
      genre: 'Genre',
      stageOfProgress: 'Stage of Progress',
      storyStyle: 'Story Style',
      pov: 'POV',
      themeFocus: 'Theme/Focus',
      themeFocusPlaceholder: 'What big idea are you exploring, and what do you most want your coach to focus on?',
      charactersLabel: 'Characters',
      colName: 'Name',
      colType: 'Type',
      colRoleType: 'Role Type',
      colCoreConflict: 'Core Conflict',
      characterNamePlaceholder: 'Character name',
      typePlaceholder: 'Type\u2026',
      roleTypePlaceholder: 'Role type\u2026',
      coreConflictPlaceholder: 'Core conflict\u2026',
      removeCharacter: 'Remove character',
      addCharacter: '+ Add Character',
      maxCharacters: 'Maximum {n} characters',
      wipsCount: '{n} WIPs',
      wipsCountSingular: '{n} WIP',
      currentlyExcavating: 'Currently excavating: {name}',
      resumeExcavating: 'Resume excavating',
      charactersCountSingular: '{n} character',
      charactersCountPlural: '{n} characters',
      chooseGenre: 'Choose a genre\u2026',
      chooseOne: 'Choose one\u2026',
      genreOptions: {
        'Thriller/Suspense': 'Thriller / Suspense',
        'Literary Fiction': 'Literary Fiction',
        'Historical Fiction': 'Historical Fiction',
        'Romance/Domestic Fiction': 'Romance / Domestic Fiction',
        'Fantasy/Science Fiction': 'Fantasy / Science Fiction',
        'Other': 'Other / Not sure yet'
      },
      stageOptions: { Outlining: 'Outlining', Drafting: 'Drafting', Revising: 'Revising', Polishing: 'Polishing' },
      styleOptions: { 'Plot Driven': 'Plot Driven', 'Character Driven': 'Character Driven' },
      povOptions: {
        'First Person': 'First Person', 'Second Person': 'Second Person',
        'Third Person Limited': 'Third Person Limited', 'Third Person Omniscient': 'Third Person Omniscient',
        'Third Person Objective': 'Third Person Objective'
      },
      characterTypeOptions: { Protagonist: 'Protagonist', Antagonist: 'Antagonist', 'Supporting Character': 'Supporting Character' }
    },
    es: {
      profileTitle: 'Perfil',
      profileSubtitle: 'Tu obra en progreso alimenta todas las sesiones de coaching, notas y recordatorios.',
      viewBtn: 'Ver',
      closeBtn: 'Cerrar',
      workInProgress: 'Obra en progreso',
      newWip: '+ Nueva obra',
      deleteThisWip: 'Eliminar esta obra',
      untitledWip: 'Obra sin título',
      selectWipOption: 'Selecciona una obra',
      noWipYet: 'Aún no hay una obra \u2014 abre para agregar la primera.',
      noWipProfileYet: 'Aún no hay perfil de obra \u2014 abre para agregar el tuyo.',
      noWipAtAllMsg: 'Aún no tienes una obra en progreso \u2014 haz clic en + Nueva obra arriba para agregar una.',
      autosaveLabel: 'Tus cambios se guardan automáticamente',
      saving: 'Guardando\u2026',
      saved: 'Guardado',
      editing: 'Editando\u2026',
      creating: 'Creando\u2026',
      couldNotSave: 'No se pudo guardar \u2014 se reintentará con tu próximo cambio',
      networkErrorSave: 'Error de red \u2014 se reintentará con tu próximo cambio',
      couldNotCreateWip: 'No se pudo crear la nueva obra',
      networkErrorCreateWip: 'Error de red \u2014 no se pudo crear la nueva obra',
      networkErrorDeleteWip: 'Error de red \u2014 no se pudo eliminar',
      confirmDeleteWip: '\u00bfEliminar \u201c{name}\u201d y su lista de personajes? Esta acción no se puede deshacer. (El progreso de excavación ya registrado para sus personajes permanece en el sistema pero deja de ser accesible.)',
      projectDescription: 'Descripción del proyecto',
      workingTitle: 'Título de trabajo',
      workingTitlePlaceholder: 'p. ej. Lo que dejó el río',
      genre: 'Género',
      stageOfProgress: 'Etapa de progreso',
      storyStyle: 'Estilo narrativo',
      pov: 'Punto de vista',
      themeFocus: 'Tema/Enfoque',
      themeFocusPlaceholder: '\u00bfQué gran idea estás explorando y en qué quieres que se enfoque tu coach?',
      charactersLabel: 'Personajes',
      colName: 'Nombre',
      colType: 'Tipo',
      colRoleType: 'Tipo de rol',
      colCoreConflict: 'Conflicto central',
      characterNamePlaceholder: 'Nombre del personaje',
      typePlaceholder: 'Tipo\u2026',
      roleTypePlaceholder: 'Tipo de rol\u2026',
      coreConflictPlaceholder: 'Conflicto central\u2026',
      removeCharacter: 'Eliminar personaje',
      addCharacter: '+ Agregar personaje',
      maxCharacters: 'Máximo {n} personajes',
      wipsCount: '{n} obras',
      wipsCountSingular: '{n} obra',
      currentlyExcavating: 'Excavando ahora: {name}',
      resumeExcavating: 'Retomar la excavación',
      charactersCountSingular: '{n} personaje',
      charactersCountPlural: '{n} personajes',
      chooseGenre: 'Elige un género\u2026',
      chooseOne: 'Elige uno\u2026',
      genreOptions: {
        'Thriller/Suspense': 'Suspenso / Thriller',
        'Literary Fiction': 'Ficción literaria',
        'Historical Fiction': 'Ficción histórica',
        'Romance/Domestic Fiction': 'Romance / Ficción doméstica',
        'Fantasy/Science Fiction': 'Fantasía / Ciencia ficción',
        'Other': 'Otro / Aún no lo sé'
      },
      stageOptions: { Outlining: 'Esquematizando', Drafting: 'Redactando', Revising: 'Revisando', Polishing: 'Puliendo' },
      styleOptions: { 'Plot Driven': 'Impulsada por la trama', 'Character Driven': 'Impulsada por el personaje' },
      povOptions: {
        'First Person': 'Primera persona', 'Second Person': 'Segunda persona',
        'Third Person Limited': 'Tercera persona limitada', 'Third Person Omniscient': 'Tercera persona omnisciente',
        'Third Person Objective': 'Tercera persona objetiva'
      },
      characterTypeOptions: { Protagonist: 'Protagonista', Antagonist: 'Antagonista', 'Supporting Character': 'Personaje secundario' }
    }
  };
  var DB_COMMON_KEYS = { viewBtn: 'view', closeBtn: 'close', untitledWip: 'untitledWip' };
  var GENRE_SLUGS = {
    'Thriller/Suspense': 'thrillerSuspense', 'Literary Fiction': 'literaryFiction',
    'Historical Fiction': 'historicalFiction', 'Romance/Domestic Fiction': 'romanceDomestic',
    'Fantasy/Science Fiction': 'fantasySciFi', 'Other': 'other'
  };
  var STAGE_SLUGS = { Outlining: 'outlining', Drafting: 'drafting', Revising: 'revising', Polishing: 'polishing' };
  var STYLE_SLUGS = { 'Plot Driven': 'plotDriven', 'Character Driven': 'characterDriven' };
  var POV_SLUGS = {
    'First Person': 'first', 'Second Person': 'second', 'Third Person Limited': 'thirdLimited',
    'Third Person Omniscient': 'thirdOmniscient', 'Third Person Objective': 'thirdObjective'
  };
  var CHARTYPE_SLUGS = { Protagonist: 'protagonist', Antagonist: 'antagonist', 'Supporting Character': 'supporting' };
  var GROUP_DB_INFO = {
    genreOptions: { prefix: 'wip.genre.', slugs: GENRE_SLUGS },
    stageOptions: { prefix: 'wip.stage.', slugs: STAGE_SLUGS },
    styleOptions: { prefix: 'wip.style.', slugs: STYLE_SLUGS },
    povOptions: { prefix: 'wip.pov.', slugs: POV_SLUGS },
    characterTypeOptions: { prefix: 'wip.charType.', slugs: CHARTYPE_SLUGS }
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
      var dbKey = DB_COMMON_KEYS[key] ? ('common.' + DB_COMMON_KEYS[key]) : ('wip.' + key);
      if (DB_STRINGS[dbKey] != null) return DB_STRINGS[dbKey];
    }
    return (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key];
  }
  function optLabel(groupKey, value) {
    if (DB_STRINGS) {
      var info = GROUP_DB_INFO[groupKey];
      var slug = info && info.slugs[value];
      if (slug && DB_STRINGS[info.prefix + slug] != null) return DB_STRINGS[info.prefix + slug];
    }
    var group = (STRINGS[LANG] && STRINGS[LANG][groupKey]) || STRINGS.en[groupKey];
    return (group && group[value]) || value;
  }
  // Sept 24 2026: display label for a Role Type / Core Conflict option.
  // Slug rule must match the keys registered in worker.js UI_STRING_KEYS.
  function cascadeLabel(prefix, value) {
    var k = prefix + String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return (DB_STRINGS && DB_STRINGS[k] != null) ? DB_STRINGS[k] : value;
  }

  // Sept 2026 (multiple WIPs): a student can now have more than one
  // work-in-progress, each with its own Characters list (characters are
  // never shared across WIPs). WIPS is the lightweight list ({id, title,
  // genre, stage, characterCount, updatedAt}) used to populate the
  // selector; ACTIVE_WIP_ID is whichever one the form is currently
  // showing/saving. WIP_LOCK_KEY is the SAME sessionStorage key stratum-
  // coach.js and stratum-excavation-center.js use, so all three surfaces
  // agree on "current WIP" within one browser tab without another
  // server round-trip just to sync that choice.
  var WIPS = [];
  var ACTIVE_WIP_ID = null;
  var WIP_LOCK_KEY = 'stratum_wip_active';
  function sessGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function sessSet(key, value) { try { sessionStorage.setItem(key, value); } catch (e) {} }

  // ----------------------------------------------------------
  // OPTION LISTS — canonical (English) values, used as option.value
  // and as what's actually stored/matched; optLabel()/cascadeLabel()
  // above supply the displayed, language-appropriate text.
  // ----------------------------------------------------------
  var GENRE_VALUES = ['Thriller/Suspense', 'Literary Fiction', 'Historical Fiction', 'Romance/Domestic Fiction', 'Fantasy/Science Fiction', 'Other'];
  var STAGE_VALUES = ['Outlining', 'Drafting', 'Revising', 'Polishing'];
  var STORY_STYLE_VALUES = ['Plot Driven', 'Character Driven'];
  var POV_VALUES = ['First Person', 'Second Person', 'Third Person Limited', 'Third Person Omniscient', 'Third Person Objective'];

  var CHARACTER_TYPES = ['Protagonist', 'Antagonist', 'Supporting Character'];

  // Labels translated via cascadeLabel() — see file header note.
  var ROLE_TYPE_BY_TYPE = {
    'Protagonist': ['Hero protagonist', 'Antihero protagonist', 'Tragic protagonist', 'Everyman protagonist', 'Dynamic protagonist', 'Static protagonist', 'Reluctant protagonist', 'Multiple protagonist'],
    'Antagonist': ['Villain', 'Ideological', 'Societal', 'Nature or Circumstance', 'Internal', 'Moral Foil', 'Ally', 'Inanimate'],
    'Supporting Character': ['Sidekick', 'Mentor', 'Love Interest', 'Foil', 'Confidant', 'Comic Relief', 'Catalyst']
  };
  var CORE_CONFLICT_BY_TYPE = {
    'Protagonist': ['Survival', 'Revenge', 'Redemption', 'Love/Connection', 'Power/Control', 'Knowledge/Discovery', 'Freedom/Independence', 'Justice/Balance', 'Identity/Belonging'],
    'Antagonist': ['Preserve Power', 'Prevent Discovery', 'Revenge', 'Protect Order', 'Survival', 'Greed/Acquisition', 'Fear of Change', 'Corruption', 'Obsession', 'Chaos/Destruction'],
    'Supporting Character': ['Loyalty vs. Betrayal', 'Guidance vs. Control', 'Love vs. Independence', 'Truth vs. Protection', 'Courage vs. Fear', 'Comedy vs. Seriousness', 'Catalyst vs. Stability', 'Self-Interest vs. Sacrifice', 'Belonging vs. Outsider', 'Transformation']
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  // Sept 2026 fix: every dashboard-card module used to just blind-append
  // to the end of wrapEl once its own async fetch resolved, so the
  // visual order of the whole dashboard was a pure network race -
  // whichever module's fetch happened to finish first ended up first,
  // and that changed on every reload. This inserts at a FIXED rank
  // instead, via a data-dash-order attribute every dashboard section now
  // carries, so the final order is deterministic no matter which
  // module's fetch finishes first. Duplicated identically in every
  // dashboard-card module (stratum-updates.js, stratum-dashboard.js,
  // stratum-excavation-center.js, stratum-practice-teaser.js, stratum-
  // library-teaser.js) - same reasoning as mount()/el() already being
  // duplicated per file rather than shared, since these are independent
  // scripts with no module system between them. RANK ORDER (keep these
  // numbers identical across every file that defines this helper): 0
  // What's New, 1 Profile, 2 Coaching columns (Story & Character/
  // General/Writing), 3 Practice/Library teaser row, 4 Idea Log/
  // Reminders. Anything without a data-dash-order attribute (the
  // header's own art/topbar/welcome/hero elements) is always treated as
  // coming before every ranked section.
  function insertAtDashOrder(wrapEl, section, rank) {
    section.setAttribute('data-dash-order', String(rank));
    var children = Array.prototype.slice.call(wrapEl.children);
    var before = null;
    for (var i = 0; i < children.length; i++) {
      var childRank = children[i].getAttribute('data-dash-order');
      if (childRank !== null && Number(childRank) > rank) { before = children[i]; break; }
    }
    wrapEl.insertBefore(section, before); // before === null means insertBefore appends at the end, which is correct here
  }
  function buildSelect(className, values, groupKey, placeholderText) {
    var select = document.createElement('select');
    select.className = className;
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = placeholderText;
    select.appendChild(ph);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = optLabel(groupKey, v);
      select.appendChild(o);
    });
    return select;
  }
  function buildPlainSelect(className, values, placeholder) {
    var select = document.createElement('select');
    select.className = className;
    var ph = document.createElement('option');
    ph.value = '';
    ph.textContent = placeholder;
    select.appendChild(ph);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = optLabel('characterTypeOptions', v);
      select.appendChild(o);
    });
    return select;
  }

  // ----------------------------------------------------------
  // CHARACTER ROWS (repeatable, cascading Type -> Role Type / Core Conflict)
  // ----------------------------------------------------------
  function repopulateCascadingSelects(row) {
    var type = row.typeSelect.value;
    var roleOptions = ROLE_TYPE_BY_TYPE[type] || [];
    var conflictOptions = CORE_CONFLICT_BY_TYPE[type] || [];
    var prevRole = row.roleTypeSelect.value;
    var prevConflict = row.coreConflictSelect.value;
    row.roleTypeSelect.innerHTML = '';
    row.roleTypeSelect.appendChild(new Option(t('roleTypePlaceholder'), ''));
    roleOptions.forEach(function (v) { row.roleTypeSelect.appendChild(new Option(cascadeLabel('wip.roleType.', v), v)); });
    row.coreConflictSelect.innerHTML = '';
    row.coreConflictSelect.appendChild(new Option(t('coreConflictPlaceholder'), ''));
    conflictOptions.forEach(function (v) { row.coreConflictSelect.appendChild(new Option(cascadeLabel('wip.coreConflict.', v), v)); });
    row.roleTypeSelect.disabled = !type;
    row.coreConflictSelect.disabled = !type;
    // Preserve the prior selection if it's still valid for the new type
    // (covers re-rendering a saved row on load); otherwise reset to blank
    // rather than silently keep a role/conflict that no longer matches
    // the selected type.
    if (roleOptions.indexOf(prevRole) !== -1) row.roleTypeSelect.value = prevRole;
    if (conflictOptions.indexOf(prevConflict) !== -1) row.coreConflictSelect.value = prevConflict;
  }

  // Sept 2026: stable per-character id, required so character-scoped
  // excavation progress (a writer excavating their protagonist
  // separately from their antagonist) survives a rename or reorder of
  // this list - the array position or name alone isn't a safe key.
  // Reused from saved data when loading an existing character; freshly
  // generated, once, only for a row that's genuinely new.
  function makeCharacterId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'char-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function buildCharacterRow(data, listEl, addBtn) {
    rowCounter++;
    var rowEl = el('div', 'sh-char-row');
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'sh-char-name';
    nameInput.placeholder = t('characterNamePlaceholder');
    nameInput.maxLength = 80;
    nameInput.value = (data && data.name) || '';
    mount(rowEl, nameInput);

    var typeSelect = buildPlainSelect('sh-char-type', CHARACTER_TYPES, t('typePlaceholder'));
    if (data && data.type) typeSelect.value = data.type;
    mount(rowEl, typeSelect);

    var roleTypeSelect = document.createElement('select');
    roleTypeSelect.className = 'sh-char-role';
    mount(rowEl, roleTypeSelect);

    var coreConflictSelect = document.createElement('select');
    coreConflictSelect.className = 'sh-char-conflict';
    mount(rowEl, coreConflictSelect);

    var removeBtn = el('button', 'sh-char-remove', '\u00d7');
    removeBtn.type = 'button';
    removeBtn.title = t('removeCharacter');
    mount(rowEl, removeBtn);

    mount(listEl, rowEl);
    var characterId = (data && data.id) || makeCharacterId();
    var row = { id: 'row-' + rowCounter, characterId: characterId, nameInput: nameInput, typeSelect: typeSelect, roleTypeSelect: roleTypeSelect, coreConflictSelect: coreConflictSelect, rowEl: rowEl };
    characterRows.push(row);

    repopulateCascadingSelects(row);
    if (data && data.roleType) row.roleTypeSelect.value = data.roleType;
    if (data && data.coreConflict) row.coreConflictSelect.value = data.coreConflict;

    typeSelect.addEventListener('change', function () { repopulateCascadingSelects(row); scheduleAutosave(); });
    roleTypeSelect.addEventListener('change', scheduleAutosave);
    coreConflictSelect.addEventListener('change', scheduleAutosave);
    nameInput.addEventListener('input', scheduleAutosave);
    removeBtn.addEventListener('click', function () {
      characterRows = characterRows.filter(function (r) { return r.id !== row.id; });
      rowEl.remove();
      updateAddButtonState(addBtn, listEl);
      scheduleAutosave();
    });

    updateAddButtonState(addBtn, listEl);
    return row;
  }

  function updateAddButtonState(addBtn, listEl) {
    var atMax = characterRows.length >= MAX_CHARACTERS;
    addBtn.disabled = atMax;
    addBtn.textContent = atMax ? format(t('maxCharacters'), { n: MAX_CHARACTERS }) : t('addCharacter');
  }

  function collectCharacters() {
    return characterRows
      .map(function (row) {
        return {
          id: row.characterId,
          name: row.nameInput.value.trim(),
          type: row.typeSelect.value,
          roleType: row.roleTypeSelect.value,
          coreConflict: row.coreConflictSelect.value
        };
      })
      .filter(function (c) { return c.name || c.type; }); // drop fully-empty rows on save
  }

  // ----------------------------------------------------------
  // AUTOSAVE
  // ----------------------------------------------------------
  // Sept 2026: replaces the old explicit "Save Profile" button per Ted's
  // decision — every field change schedules a save after a short pause
  // in activity, rather than requiring a manual click. A shared debounce
  // timer across the WHOLE form (not per-field) means rapid successive
  // changes — e.g. typing a title, then immediately picking a genre —
  // collapse into one save once things settle, not one request per
  // keystroke. This also naturally handles the cascading Type dropdown:
  // changing Type resets Role Type/Core Conflict to blank synchronously,
  // but the debounce window gives the student time to pick the real
  // values before anything is actually sent — if they walk away right
  // after changing Type, the blank role/conflict just saves as-is and
  // gets corrected by the next autosave whenever they do fill it in.
  var AUTOSAVE_DEBOUNCE_MS = 800;
  var autosaveTimer = null;
  var statusEl = null;
  var statusFadeTimer = null;

  function setStatus(text, cls) {
    if (!statusEl) return;
    if (statusFadeTimer) { clearTimeout(statusFadeTimer); statusFadeTimer = null; }
    statusEl.textContent = text;
    statusEl.className = 'sh-wip-status' + (cls ? ' ' + cls : '');
  }
  function fadeStatusSoon() {
    if (statusFadeTimer) clearTimeout(statusFadeTimer);
    statusFadeTimer = setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 2200);
  }

  function collectProfilePayload() {
    return {
      studentId: STUDENT_ID,
      wipId: ACTIVE_WIP_ID,
      email: (currentProfile && currentProfile.email) || undefined,
      studentName: (currentProfile && currentProfile.studentName) || '', // preserved, not edited here — see WordPress account
      language: (currentProfile && currentProfile.language) || '',       // preserved, not edited here — see header Language dropdown
      wipTitle: fields.titleInput.value.trim(),
      genre: fields.genreSelect.value,
      stage: fields.stageSelect.value,
      storyStyle: fields.styleSelect.value,
      pov: fields.povSelect.value,
      theme: fields.themeInput.value.trim(),
      characters: collectCharacters()
    };
  }

  function doSave() {
    if (!ACTIVE_WIP_ID) return; // shouldn't be reachable (fields are hidden with no active WIP), but defensive
    var payload = collectProfilePayload();
    setStatus(t('saving'));
    fetch(PROXY_URL + '/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) {
          currentProfile = Object.assign({}, currentProfile, d);
          renderSummary(currentProfile);
          // Sept 2026 fix: the dropdown's option label for this WIP was
          // never refreshed after a save, so retitling a WIP (e.g. from
          // blank/"Select WIP" to a real title) left the old label
          // showing in the selector until a full page reload. WIPS is
          // the same array populateWipSelect() reads from, so updating
          // the matching entry in place and re-populating fixes it.
          var wipEntry = WIPS.filter(function (w) { return w.id === ACTIVE_WIP_ID; })[0];
          if (wipEntry) {
            wipEntry.title = d.wipTitle || '';
            wipEntry.genre = d.genre || '';
            wipEntry.stage = d.stage || '';
            populateWipSelect(WIPS, ACTIVE_WIP_ID);
          }
          setStatus(t('saved'), 'sh-ok');
          fadeStatusSoon();
        } else {
          setStatus(t('couldNotSave'), 'sh-err');
        }
      })
      .catch(function () {
        setStatus(t('networkErrorSave'), 'sh-err');
      });
  }

  function scheduleAutosave() {
    if (!ACTIVE_WIP_ID) return; // no WIP selected yet - nothing to save into
    if (autosaveTimer) clearTimeout(autosaveTimer);
    setStatus(t('editing'));
    autosaveTimer = setTimeout(function () {
      autosaveTimer = null;
      doSave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  // Safety net: if the student navigates away (or the tab is hidden)
  // while a debounced save is still pending, don't lose those last few
  // seconds of edits — fire an immediate best-effort save. keepalive
  // lets this fetch outlive the page unload; sendBeacon isn't used here
  // since the /project endpoint needs a JSON POST body with headers,
  // which sendBeacon doesn't support cleanly.
  function flushPendingSave() {
    if (!autosaveTimer) return; // nothing pending — last change was already saved
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    try {
      fetch(PROXY_URL + '/project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectProfilePayload()),
        keepalive: true
      });
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushPendingSave();
  });
  window.addEventListener('pagehide', flushPendingSave);

  // ----------------------------------------------------------
  // BUILD
  // ----------------------------------------------------------
  // Sept 2026: wrapped in the same sh-dash-card container + collapsed/
  // View pattern as Idea Log, Reminders, and Excavation Center, per
  // Ted's request. Deliberately reuses stratum-dashboard.css's sh-dash-*
  // classes rather than defining new ones — that file is already loaded
  // on this page, and reusing its classes is what guarantees this looks
  // IDENTICAL to the other cards rather than a close visual approximation.
  // The full form is built once, up front, and only ever shown/hidden
  // (not destroyed/rebuilt) when toggling — autosave's debounce timer
  // and DOM references stay valid across a collapse/expand cycle.
  var expanded = false;
  var summaryEl = null;
  var formWrapEl = null;
  var openBtn = null;

  // Sept 24 2026 (dark re-theme, per Ted's approved mockup): the
  // collapsed Profile card now shows the active WIP's title with genre /
  // character count / WIP count as quiet meta, then an inner panel
  // listing the characters with a Resume excavating pill. Also fills
  // the "Currently excavating: {title}" status line under the welcome
  // headline (see updateStatusLine) - done here rather than in
  // stratum-header.js since this file already owns the WIP data.
  var COACH_URL = '/coach/character-excavation/';

  function updateStatusLine(title) {
    var wrapEl = window.STRATUM_HEADER_WRAP;
    var row = wrapEl && wrapEl.querySelector('.sh-welcome-row');
    if (!row) return;
    var line = row.querySelector('.sh-status-line');
    if (!title) { if (line) line.remove(); return; }
    if (!line) line = mount(row, el('p', 'sh-status-line'));
    line.textContent = format(t('currentlyExcavating'), { name: title });
  }

  function renderSummary(profile) {
    if (!summaryEl) return;
    summaryEl.innerHTML = '';
    if (!ACTIVE_WIP_ID || !profile) {
      updateStatusLine('');
      mount(summaryEl, el('div', 'sh-dash-empty', t('noWipYet')));
      return;
    }
    // Sept 24 2026: WIP title / character list / Resume pill removed
    // per Ted - students may be in coaching that doesn't involve a WIP.
    // Collapsed card shows the WIP count only, as before.
    var n = WIPS.length || 1;
    var countText = format(t(n === 1 ? 'wipsCountSingular' : 'wipsCount'), { n: n });
    mount(summaryEl, el('div', 'sh-wip-summary-line', countText));

    updateStatusLine(profile.wipTitle || '');
  }

  function toggleExpanded() {
    expanded = !expanded;
    openBtn.textContent = expanded ? t('closeBtn') : t('viewBtn');
    summaryEl.style.display = expanded ? 'none' : '';
    formWrapEl.style.display = expanded ? '' : 'none';
  }

  function buildPanel(wrapEl) {
    var card = el('div', 'sh-dash-card');
    var head = el('div', 'sh-dash-card-head');
    var headTop = el('div', 'sh-dash-card-head-top');
    mount(headTop, el('p', 'sh-dash-card-title', t('profileTitle')));
    openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'sh-dash-open-btn';
    openBtn.textContent = t('viewBtn');
    openBtn.addEventListener('click', toggleExpanded);
    mount(headTop, openBtn);
    mount(head, headTop);
    mount(head, el('p', 'sh-dash-card-subtitle', t('profileSubtitle')));
    mount(card, head);

    var body = el('div', 'sh-dash-card-body');
    summaryEl = el('div', 'sh-wip-summary');
    mount(body, summaryEl);

    formWrapEl = el('div', 'sh-wip-section');
    formWrapEl.style.display = 'none';

    mount(formWrapEl, buildWipSelectRow());
    noWipMsgEl = el('div', 'sh-dash-empty', t('noWipAtAllMsg'));
    noWipMsgEl.style.display = 'none';
    mount(formWrapEl, noWipMsgEl);

    var topActions = el('div', 'sh-wip-top-actions');
    mount(topActions, el('p', 'sh-wip-col-label sh-wip-autosave-label', t('autosaveLabel')));
    statusEl = el('span', 'sh-wip-status');
    mount(topActions, statusEl);
    mount(formWrapEl, topActions);
    topActionsEl = topActions;

    var grid = el('div', 'sh-wip-grid');
    gridEl = grid;

    // ---- Column 1: Project Description ----
    var col1 = el('div', 'sh-wip-col');
    mount(col1, el('p', 'sh-wip-col-label', t('projectDescription')));

    var titleField = el('div', 'sh-wip-field');
    mount(titleField, el('label', null, t('workingTitle')));
    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'sh-wip-input';
    titleInput.maxLength = 150;
    titleInput.placeholder = t('workingTitlePlaceholder');
    titleInput.addEventListener('input', scheduleAutosave);
    mount(titleField, titleInput);
    mount(col1, titleField);

    var genreField = el('div', 'sh-wip-field');
    mount(genreField, el('label', null, t('genre')));
    var genreSelect = buildSelect('sh-wip-select', GENRE_VALUES, 'genreOptions', t('chooseGenre'));
    genreSelect.addEventListener('change', scheduleAutosave);
    mount(genreField, genreSelect);
    mount(col1, genreField);

    var stageField = el('div', 'sh-wip-field');
    mount(stageField, el('label', null, t('stageOfProgress')));
    var stageSelect = buildSelect('sh-wip-select', STAGE_VALUES, 'stageOptions', t('chooseOne'));
    stageSelect.addEventListener('change', scheduleAutosave);
    mount(stageField, stageSelect);
    mount(col1, stageField);

    var styleField = el('div', 'sh-wip-field');
    mount(styleField, el('label', null, t('storyStyle')));
    var styleSelect = buildSelect('sh-wip-select', STORY_STYLE_VALUES, 'styleOptions', t('chooseOne'));
    styleSelect.addEventListener('change', scheduleAutosave);
    mount(styleField, styleSelect);
    mount(col1, styleField);

    var povField = el('div', 'sh-wip-field');
    mount(povField, el('label', null, t('pov')));
    var povSelect = buildSelect('sh-wip-select', POV_VALUES, 'povOptions', t('chooseOne'));
    povSelect.addEventListener('change', scheduleAutosave);
    mount(povField, povSelect);
    mount(col1, povField);

    var themeField = el('div', 'sh-wip-field');
    mount(themeField, el('label', null, t('themeFocus')));
    var themeInput = document.createElement('textarea');
    themeInput.className = 'sh-wip-textarea';
    themeInput.maxLength = 600;
    themeInput.placeholder = t('themeFocusPlaceholder');
    themeInput.addEventListener('input', scheduleAutosave);
    mount(themeField, themeInput);
    mount(col1, themeField);

    mount(grid, col1);

    // ---- Column 2: Characters ----
    var col2 = el('div', 'sh-wip-col');
    mount(col2, el('p', 'sh-wip-col-label', t('charactersLabel')));

    var charHead = el('div', 'sh-char-head');
    mount(charHead, el('span', null, t('colName')));
    mount(charHead, el('span', null, t('colType')));
    mount(charHead, el('span', null, t('colRoleType')));
    mount(charHead, el('span', null, t('colCoreConflict')));
    mount(charHead, el('span', null, ''));
    mount(col2, charHead);

    var charList = el('div', 'sh-char-list');
    mount(col2, charList);

    var addBtn = el('button', 'sh-char-add', t('addCharacter'));
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () {
      buildCharacterRow(null, charList, addBtn);
      scheduleAutosave();
    });
    mount(col2, addBtn);

    mount(grid, col2);
    mount(formWrapEl, grid);
    mount(body, formWrapEl);
    mount(card, body);
    var section = el('div', 'sh-wip-panel-section');
    mount(section, card);
    insertAtDashOrder(wrapEl, section, 1);

    return {
      titleInput: titleInput, genreSelect: genreSelect, stageSelect: stageSelect,
      styleSelect: styleSelect, povSelect: povSelect, themeInput: themeInput,
      charList: charList, addBtn: addBtn
    };
  }

  var fields = null;
  var gridEl = null;       // the two-column Project Description/Characters grid - hidden entirely when there's no active WIP
  var noWipMsgEl = null;   // shown in its place when the student has zero WIPs
  var topActionsEl = null; // the autosave-label row - Sept 2026: now hidden alongside the grid, not just the grid, so nothing but the selector shows until a WIP is chosen

  // ----------------------------------------------------------
  // WIP LIST / SELECTOR (Sept 2026, multiple WIPs)
  // ----------------------------------------------------------
  function fetchWips(callback) {
    fetch(PROXY_URL + '/wips?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.wips)) ? d.wips : []); })
      .catch(function () { callback([]); });
  }

  function populateWipSelect(wips, activeId) {
    if (!wipSelectEl) return;
    wipSelectEl.innerHTML = '';
    wips.forEach(function (w) {
      var o = document.createElement('option');
      o.value = w.id;
      o.textContent = w.title || t('selectWipOption');
      if (w.id === activeId) o.selected = true;
      wipSelectEl.appendChild(o);
    });
    deleteWipBtn.disabled = !wips.length;
  }

  // Loads (or re-loads) the WIP list from the server, then selects
  // preferredId if it's still present, else whatever's locked for this
  // tab, else the first WIP, else shows the empty state. Used on initial
  // page load and after creating/deleting a WIP.
  function loadWipListThenSelect(preferredId) {
    fetchWips(function (wips) {
      WIPS = wips;
      if (!wips.length) {
        populateWipSelect([], null);
        selectWip(null);
        return;
      }
      var lockedId = preferredId || sessGet(WIP_LOCK_KEY);
      var active = (lockedId && wips.filter(function (w) { return w.id === lockedId; })[0]) || wips[0];
      populateWipSelect(wips, active.id);
      selectWip(active.id);
    });
  }

  function selectWip(wipId) {
    ACTIVE_WIP_ID = wipId || null;
    sessSet(WIP_LOCK_KEY, ACTIVE_WIP_ID || '');
    if (!ACTIVE_WIP_ID) { showNoWipState(); return; }
    loadProfile();
  }

  function showNoWipState() {
    currentProfile = null;
    if (gridEl) gridEl.style.display = 'none';
    if (topActionsEl) topActionsEl.style.display = 'none';
    if (noWipMsgEl) noWipMsgEl.style.display = '';
    renderSummary(null);
  }

  // Creates a blank WIP immediately (title/fields empty, no confirmation
  // needed - it's just an empty row until the student fills it in), then
  // switches the panel to editing it. Deliberately a direct request, not
  // routed through the debounced autosave, so "+ New WIP" always creates
  // exactly one WIP per click regardless of the autosave timer's state.
  function createNewWip() {
    setStatus(t('creating'));
    fetch(PROXY_URL + '/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, wipTitle: '', genre: '', stage: '', storyStyle: '', pov: '', theme: '', characters: [] })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.wipId) { setStatus(t('couldNotCreateWip'), 'sh-err'); return; }
        loadWipListThenSelect(d.wipId);
      })
      .catch(function () { setStatus(t('networkErrorCreateWip'), 'sh-err'); });
  }

  function deleteCurrentWip() {
    if (!ACTIVE_WIP_ID) return;
    var wip = WIPS.filter(function (w) { return w.id === ACTIVE_WIP_ID; })[0];
    var name = (wip && wip.title) || t('untitledWip');
    if (!window.confirm(format(t('confirmDeleteWip'), { name: name }))) return;
    fetch(PROXY_URL + '/wips?studentId=' + encodeURIComponent(STUDENT_ID) + '&wipId=' + encodeURIComponent(ACTIVE_WIP_ID), { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function () { loadWipListThenSelect(null); })
      .catch(function () { setStatus(t('networkErrorDeleteWip'), 'sh-err'); });
  }

  var wipSelectEl = null;
  var newWipBtn = null;
  var deleteWipBtn = null;

  function buildWipSelectRow() {
    var row = el('div', 'sh-wip-select-row');
    mount(row, el('label', 'sh-wip-select-label', t('workInProgress')));
    wipSelectEl = document.createElement('select');
    wipSelectEl.className = 'sh-wip-select-main';
    wipSelectEl.addEventListener('change', function () { selectWip(wipSelectEl.value); });
    mount(row, wipSelectEl);
    newWipBtn = el('button', 'sh-wip-new-btn', t('newWip'));
    newWipBtn.type = 'button';
    newWipBtn.addEventListener('click', createNewWip);
    mount(row, newWipBtn);
    deleteWipBtn = el('button', 'sh-wip-delete-btn', t('deleteThisWip'));
    deleteWipBtn.type = 'button';
    deleteWipBtn.addEventListener('click', deleteCurrentWip);
    mount(row, deleteWipBtn);
    return row;
  }

  function fillForm(profile) {
    fields.titleInput.value = profile.wipTitle || '';
    fields.genreSelect.value = profile.genre || '';
    fields.stageSelect.value = profile.stage || '';
    fields.styleSelect.value = profile.storyStyle || '';
    fields.povSelect.value = profile.pov || '';
    fields.themeInput.value = profile.theme || '';
    fields.charList.innerHTML = '';
    characterRows = [];
    (Array.isArray(profile.characters) ? profile.characters : []).forEach(function (c) {
      buildCharacterRow(c, fields.charList, fields.addBtn);
    });
  }

  function loadProfile() {
    if (!ACTIVE_WIP_ID) { renderSummary(null); return; }
    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(STUDENT_ID) + '&wipId=' + encodeURIComponent(ACTIVE_WIP_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known) { renderSummary(null); return; }
        currentProfile = d;
        if (gridEl) gridEl.style.display = '';
        if (topActionsEl) topActionsEl.style.display = '';
        if (noWipMsgEl) noWipMsgEl.style.display = 'none';
        fillForm(d); // filling from a fresh load never itself schedules an autosave — only real user input does
        renderSummary(d);
      })
      .catch(function () { renderSummary(null); });
  }

  function mountInto(wrapEl) {
    if (!wrapEl || wrapEl.querySelector('.sh-wip-summary')) return; // avoid double-mount
    fields = buildPanel(wrapEl);
  }

  function proceed(studentId) {
    if (!studentId) return; // logged-out / no-membership pages never reach here — see header's own gating
    STUDENT_ID = studentId;
    loadUiStrings(function () {
      mountInto(window.STRATUM_HEADER_WRAP);
      loadWipListThenSelect(null);
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
