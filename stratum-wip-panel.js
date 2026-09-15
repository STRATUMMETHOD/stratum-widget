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
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var MAX_CHARACTERS = 15;

  var STUDENT_ID = null;
  var currentProfile = null; // last-loaded server record, used to preserve studentName/language on save
  var characterRows = [];    // [{ id, nameInput, typeSelect, roleTypeSelect, coreConflictSelect, rowEl }]
  var rowCounter = 0;

  // ----------------------------------------------------------
  // OPTION LISTS
  // ----------------------------------------------------------
  var GENRE_OPTIONS = [
    ['', 'Choose a genre\u2026'],
    ['Thriller/Suspense', 'Thriller / Suspense'],
    ['Literary Fiction', 'Literary Fiction'],
    ['Historical Fiction', 'Historical Fiction'],
    ['Romance/Domestic Fiction', 'Romance / Domestic Fiction'],
    ['Fantasy/Science Fiction', 'Fantasy / Science Fiction'],
    ['Other', 'Other / Not sure yet']
  ];
  var STAGE_OPTIONS = [
    ['', 'Choose one\u2026'], ['Outlining', 'Outlining'], ['Drafting', 'Drafting'],
    ['Revising', 'Revising'], ['Polishing', 'Polishing']
  ];
  var STORY_STYLE_OPTIONS = [
    ['', 'Choose one\u2026'], ['Plot Driven', 'Plot Driven'], ['Character Driven', 'Character Driven']
  ];
  var POV_OPTIONS = [
    ['', 'Choose one\u2026'],
    ['First Person', 'First Person'],
    ['Second Person', 'Second Person'],
    ['Third Person Limited', 'Third Person Limited'],
    ['Third Person Omniscient', 'Third Person Omniscient'],
    ['Third Person Objective', 'Third Person Objective']
  ];

  var CHARACTER_TYPES = ['Protagonist', 'Antagonist', 'Supporting Character'];

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
  function buildSelect(className, options) {
    var select = document.createElement('select');
    select.className = className;
    options.forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0];
      o.textContent = opt[1];
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
      o.textContent = v;
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
    row.roleTypeSelect.appendChild(new Option('Role type\u2026', ''));
    roleOptions.forEach(function (v) { row.roleTypeSelect.appendChild(new Option(v, v)); });
    row.coreConflictSelect.innerHTML = '';
    row.coreConflictSelect.appendChild(new Option('Core conflict\u2026', ''));
    conflictOptions.forEach(function (v) { row.coreConflictSelect.appendChild(new Option(v, v)); });
    row.roleTypeSelect.disabled = !type;
    row.coreConflictSelect.disabled = !type;
    // Preserve the prior selection if it's still valid for the new type
    // (covers re-rendering a saved row on load); otherwise reset to blank
    // rather than silently keep a role/conflict that no longer matches
    // the selected type.
    if (roleOptions.indexOf(prevRole) !== -1) row.roleTypeSelect.value = prevRole;
    if (conflictOptions.indexOf(prevConflict) !== -1) row.coreConflictSelect.value = prevConflict;
  }

  function buildCharacterRow(data, listEl, addBtn) {
    rowCounter++;
    var rowEl = el('div', 'sh-char-row');
    var nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'sh-char-name';
    nameInput.placeholder = 'Character name';
    nameInput.maxLength = 80;
    nameInput.value = (data && data.name) || '';
    mount(rowEl, nameInput);

    var typeSelect = buildPlainSelect('sh-char-type', CHARACTER_TYPES, 'Type\u2026');
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
    removeBtn.title = 'Remove character';
    mount(rowEl, removeBtn);

    mount(listEl, rowEl);
    var row = { id: 'row-' + rowCounter, nameInput: nameInput, typeSelect: typeSelect, roleTypeSelect: roleTypeSelect, coreConflictSelect: coreConflictSelect, rowEl: rowEl };
    characterRows.push(row);

    repopulateCascadingSelects(row);
    if (data && data.roleType) row.roleTypeSelect.value = data.roleType;
    if (data && data.coreConflict) row.coreConflictSelect.value = data.coreConflict;

    typeSelect.addEventListener('change', function () { repopulateCascadingSelects(row); });
    removeBtn.addEventListener('click', function () {
      characterRows = characterRows.filter(function (r) { return r.id !== row.id; });
      rowEl.remove();
      updateAddButtonState(addBtn, listEl);
    });

    updateAddButtonState(addBtn, listEl);
    return row;
  }

  function updateAddButtonState(addBtn, listEl) {
    var atMax = characterRows.length >= MAX_CHARACTERS;
    addBtn.disabled = atMax;
    addBtn.textContent = atMax ? 'Maximum ' + MAX_CHARACTERS + ' characters' : '+ Add Character';
  }

  function collectCharacters() {
    return characterRows
      .map(function (row) {
        return {
          name: row.nameInput.value.trim(),
          type: row.typeSelect.value,
          roleType: row.roleTypeSelect.value,
          coreConflict: row.coreConflictSelect.value
        };
      })
      .filter(function (c) { return c.name || c.type; }); // drop fully-empty rows on save
  }

  // ----------------------------------------------------------
  // BUILD
  // ----------------------------------------------------------
  function buildPanel(wrapEl) {
    var section = el('div', 'sh-wip-section');

    var topActions = el('div', 'sh-wip-top-actions');
    var saveBtn = el('button', 'sh-save-btn', 'Save Profile');
    saveBtn.type = 'button';
    mount(topActions, saveBtn);
    var status = el('span', 'sh-wip-status');
    mount(topActions, status);
    mount(section, topActions);

    var grid = el('div', 'sh-wip-grid');

    // ---- Column 1: Project Description ----
    var col1 = el('div', 'sh-wip-col');
    mount(col1, el('p', 'sh-wip-col-label', 'Project Description'));

    var titleField = el('div', 'sh-wip-field');
    mount(titleField, el('label', null, 'Working Title'));
    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'sh-wip-input';
    titleInput.maxLength = 150;
    titleInput.placeholder = 'e.g. What the River Kept';
    mount(titleField, titleInput);
    mount(col1, titleField);

    var genreField = el('div', 'sh-wip-field');
    mount(genreField, el('label', null, 'Genre'));
    var genreSelect = buildSelect('sh-wip-select', GENRE_OPTIONS);
    mount(genreField, genreSelect);
    mount(col1, genreField);

    var stageField = el('div', 'sh-wip-field');
    mount(stageField, el('label', null, 'Stage of Progress'));
    var stageSelect = buildSelect('sh-wip-select', STAGE_OPTIONS);
    mount(stageField, stageSelect);
    mount(col1, stageField);

    var styleField = el('div', 'sh-wip-field');
    mount(styleField, el('label', null, 'Story Style'));
    var styleSelect = buildSelect('sh-wip-select', STORY_STYLE_OPTIONS);
    mount(styleField, styleSelect);
    mount(col1, styleField);

    var povField = el('div', 'sh-wip-field');
    mount(povField, el('label', null, 'POV'));
    var povSelect = buildSelect('sh-wip-select', POV_OPTIONS);
    mount(povField, povSelect);
    mount(col1, povField);

    var themeField = el('div', 'sh-wip-field');
    mount(themeField, el('label', null, 'Theme/Focus'));
    var themeInput = document.createElement('textarea');
    themeInput.className = 'sh-wip-textarea';
    themeInput.maxLength = 600;
    themeInput.placeholder = 'What big idea are you exploring, and what do you most want your coach to focus on?';
    mount(themeField, themeInput);
    mount(col1, themeField);

    mount(grid, col1);

    // ---- Column 2: Characters ----
    var col2 = el('div', 'sh-wip-col');
    mount(col2, el('p', 'sh-wip-col-label', 'Characters'));

    var charHead = el('div', 'sh-char-head');
    mount(charHead, el('span', null, 'Name'));
    mount(charHead, el('span', null, 'Type'));
    mount(charHead, el('span', null, 'Role Type'));
    mount(charHead, el('span', null, 'Core Conflict'));
    mount(charHead, el('span', null, ''));
    mount(col2, charHead);

    var charList = el('div', 'sh-char-list');
    mount(col2, charList);

    var addBtn = el('button', 'sh-char-add', '+ Add Character');
    addBtn.type = 'button';
    addBtn.addEventListener('click', function () { buildCharacterRow(null, charList, addBtn); });
    mount(col2, addBtn);

    mount(grid, col2);
    mount(section, grid);
    mount(wrapEl, section);

    saveBtn.addEventListener('click', function () { saveProfile(saveBtn, status); });

    return {
      titleInput: titleInput, genreSelect: genreSelect, stageSelect: stageSelect,
      styleSelect: styleSelect, povSelect: povSelect, themeInput: themeInput,
      charList: charList, addBtn: addBtn
    };
  }

  var fields = null;

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
    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known) return;
        currentProfile = d;
        fillForm(d);
      })
      .catch(function () {});
  }

  function saveProfile(saveBtn, status) {
    var payload = {
      studentId: STUDENT_ID,
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
    saveBtn.disabled = true;
    status.textContent = 'Saving\u2026';
    status.className = 'sh-wip-status';
    fetch(PROXY_URL + '/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        saveBtn.disabled = false;
        if (d && d.ok) {
          currentProfile = Object.assign({}, currentProfile, d);
          status.textContent = 'Saved. Your coach will use this from your next session.';
          status.className = 'sh-wip-status sh-ok';
        } else {
          status.textContent = 'Could not save \u2014 please try again.';
          status.className = 'sh-wip-status sh-err';
        }
      })
      .catch(function () {
        saveBtn.disabled = false;
        status.textContent = 'Network error \u2014 please try again.';
        status.className = 'sh-wip-status sh-err';
      });
  }

  function mountInto(wrapEl) {
    if (!wrapEl || wrapEl.querySelector('.sh-wip-section')) return; // avoid double-mount
    fields = buildPanel(wrapEl);
  }

  function proceed(studentId) {
    if (!studentId) return; // logged-out / no-membership pages never reach here — see header's own gating
    STUDENT_ID = studentId;
    mountInto(window.STRATUM_HEADER_WRAP);
    loadProfile();
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
