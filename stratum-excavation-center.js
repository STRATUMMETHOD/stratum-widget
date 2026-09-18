/* ============================================================
   STRATUM EXCAVATION CENTER — DASHBOARD SECTION (Sept 2026)
   ------------------------------------------------------------
   Lists every coaching session (from the shared registry in
   stratum-sessions.js, merged across all three Tracks), now laid out
   as three columns — Excavation, General Coaching, Writing, in that
   fixed order — rather than one merged list, per Ted's request. Each
   column shows a status appropriate to its engine:
   - Excavation Track (Linear Layers -> Synthesis): Not Started / In
     Progress / Completed, computed from /completions the same way as
     before — a session is Completed when every layer id has a
     completion record.
   - General/Writing Tracks (Recurring Check-In): "N check-ins so far
     - last on <date>" or "No check-ins yet", computed from
     /checkin-notes, since these have no fixed completion for a
     Completed badge to describe.
   An empty track still renders its column with an empty-state
   message, rather than disappearing — the three-column structure
   stays predictable even before General/Writing have any session
   types created.

   Sept 2026 addition: an excavation flagged requiresCharacter (see the
   admin's Track toggle) shows one row PER CHARACTER in the student's
   WIP profile instead of one row for the whole program, since progress
   on a character-scoped excavation is tracked separately per character
   (see SELECTED_CHARACTER / lessonKey() in stratum-coach.js). A
   student with no characters yet sees a single "Add a character" row
   instead.

   Mounts INTO the same dark card stratum-header.js builds, directly
   below stratum-wip-panel.js's section and above stratum-
   dashboard.js's Idea Log/Reminders cards — see the script load
   order in system-page-template.php, which controls mount order via
   listener-attachment order on the shared 'stratum:identity-ready'
   signal (same pattern every module in this codebase uses).

   Each row's title links straight to that session's page — for an
   in-progress Excavation-Track session, the page itself already
   resumes at the first incomplete layer (see stratum-coach.js's
   loadProgressThenStart()); a Recurring-Track session's page always
   opens on its topic list, so no special resume handling is needed
   there either.

   Requires stratum-identity.js, stratum-header.js (for window.
   StratumHeader — not directly used here, but this section nests
   inside the wrap that function's topbar helper built), AND
   stratum-sessions.js loaded first on this page.

   ---- Spanish translation (Sept 2026) ----
   Chrome strings (column titles, status badges, empty states) go
   through STRINGS/t(), keyed off the same 'wlfc_preferred_lang' the
   header sets. Session titles themselves (session.title) are NOT
   translated here — they already come from the admin-managed,
   already-lang-aware /excavations?lang= endpoint (stratum-sessions.js
   requests the right language directly), so they arrive pre-
   translated whenever Ted has authored Spanish content for them.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';

  var LANG_STORE_KEY = 'wlfc_preferred_lang'; // same key the header's Language dropdown sets
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  var LANG = lsGet(LANG_STORE_KEY) || 'en';

  var STRINGS = {
    en: {
      colExcavation: 'Excavation Coaching',
      colGeneral: 'General Coaching',
      colWriting: 'Writer\u2019s Coaching',
      workInProgress: 'Work in progress:',
      untitledWip: 'Untitled WIP',
      loading: 'Loading\u2026',
      noSessionsYet: 'No sessions yet.',
      addACharacter: 'Add a character',
      notStarted: 'Not Started',
      completed: 'Completed',
      inProgress: 'In Progress',
      noCheckinsYet: 'No check-ins yet',
      checkinCountSingular: '{n} check-in',
      checkinCountPlural: '{n} check-ins',
      today: 'today',
      yesterday: 'yesterday',
      daysAgo: '{n} days ago',
      viewAll: 'View All',
      showLess: 'Show Less'
    },
    es: {
      colExcavation: 'Coaching de excavación',
      colGeneral: 'Coaching general',
      colWriting: 'Coaching de escritura',
      workInProgress: 'Obra en progreso:',
      untitledWip: 'Obra sin título',
      loading: 'Cargando\u2026',
      noSessionsYet: 'Aún no hay sesiones.',
      addACharacter: 'Agregar un personaje',
      notStarted: 'Sin comenzar',
      completed: 'Completado',
      inProgress: 'En progreso',
      noCheckinsYet: 'Aún no hay registros',
      checkinCountSingular: '{n} registro',
      checkinCountPlural: '{n} registros',
      today: 'hoy',
      yesterday: 'ayer',
      daysAgo: 'hace {n} días',
      viewAll: 'Ver todo',
      showLess: 'Ver menos'
    }
  };
  var DB_KEY_MAP = {
    untitledWip: 'common.untitledWip',
    workInProgress: 'ec.workInProgressColon',
    today: 'ec.todayLower',
    yesterday: 'ec.yesterdayLower',
    daysAgo: 'ec.daysAgoLower'
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
      var dbKey = DB_KEY_MAP[key] || ('ec.' + key);
      if (DB_STRINGS[dbKey] != null) return DB_STRINGS[dbKey];
    }
    return (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key];
  }

  var TRACK_COLUMNS = [
    { track: 'excavation', labelKey: 'colExcavation' },
    { track: 'general', labelKey: 'colGeneral' },
    { track: 'writing', labelKey: 'colWriting' }
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }

  function fetchCompletions(studentId, callback) {
    if (!studentId) { callback([]); return; }
    fetch(PROXY_URL + '/completions?studentId=' + encodeURIComponent(studentId))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.completions)) ? d.completions : []); })
      .catch(function () { callback([]); });
  }

  // Sept 2026 (multiple WIPs): characters are now scoped to one WIP
  // (never shared across WIPs), so listing them for the requiresCharacter
  // columns needs to know which WIP is active. WIP_LOCK_KEY is the SAME
  // sessionStorage key stratum-wip-panel.js and stratum-coach.js use, so
  // picking a WIP here also carries into whichever coaching session gets
  // opened next in this tab, and vice versa - all three surfaces agree
  // on "current WIP" without another round-trip just to sync it.
  var WIP_LOCK_KEY = 'stratum_wip_active';
  function sessGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function sessSet(key, value) { try { sessionStorage.setItem(key, value); } catch (e) {} }

  function fetchWips(studentId, callback) {
    if (!studentId) { callback([]); return; }
    fetch(PROXY_URL + '/wips?studentId=' + encodeURIComponent(studentId))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.wips)) ? d.wips : []); })
      .catch(function () { callback([]); });
  }

  // Sept 2026 (two-character conflicts): parallel to
  // fetchCharactersForWip above, but scoped per (WIP, excavation slug)
  // pair rather than per WIP alone, since conflict instances belong to
  // one specific requiresConflictPair session, not the WIP as a whole.
  // Called once per such session in the sessions list (see
  // fetchConflictDataForSessions), then reused as-is when building
  // every track column, same "fetch once up front, not once per row"
  // reasoning as characters.
  function fetchConflictInstancesForSession(studentId, wipId, excavationSlug, callback) {
    if (!studentId || !wipId) { callback([]); return; }
    fetch(PROXY_URL + '/conflict-instances?studentId=' + encodeURIComponent(studentId) + '&wipId=' + encodeURIComponent(wipId) + '&excavationSlug=' + encodeURIComponent(excavationSlug))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.instances)) ? d.instances : []); })
      .catch(function () { callback([]); });
  }

  function fetchConflictDataForSessions(conflictSessions, studentId, wipId, callback) {
    if (!conflictSessions.length) { callback({}); return; }
    var bySlug = {};
    var pending = conflictSessions.length;
    conflictSessions.forEach(function (s) {
      fetchConflictInstancesForSession(studentId, wipId, s.slug, function (instances) {
        bySlug[s.slug] = instances;
        pending--;
        if (pending === 0) callback(bySlug);
      });
    });
  }

  // Fetched fresh whenever the active WIP changes (initial load or the
  // selector), not once per dashboard load - the same Characters list is
  // reused across every requiresCharacter session in the Excavation
  // column for that one WIP, but a WIP switch means a different list.
  function fetchCharactersForWip(studentId, wipId, callback) {
    if (!studentId || !wipId) { callback([]); return; }
    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(studentId) + '&wipId=' + encodeURIComponent(wipId))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var characters = (d && d.known && Array.isArray(d.characters)) ? d.characters.filter(function (c) { return c.name; }) : [];
        callback(characters);
      })
      .catch(function () { callback([]); });
  }

  function buildWipSelector(wips, activeId, onChange) {
    var wrap = el('div', 'sh-ec-wip-select-wrap');
    mount(wrap, el('label', 'sh-ec-wip-select-label', t('workInProgress')));
    var select = document.createElement('select');
    select.className = 'sh-ec-wip-select';
    wips.forEach(function (w) {
      var o = document.createElement('option');
      o.value = w.id;
      o.textContent = w.title || t('untitledWip');
      if (w.id === activeId) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', function () { onChange(select.value); });
    mount(wrap, select);
    return wrap;
  }

  function fetchCheckinCount(studentId, sessionSlug, callback) {
    if (!studentId) { callback(0, null); return; }
    fetch(PROXY_URL + '/checkin-notes?studentId=' + encodeURIComponent(studentId) + '&sessionSlug=' + encodeURIComponent(sessionSlug))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var notes = (d && Array.isArray(d.notes)) ? d.notes : [];
        callback(notes.length, notes.length ? notes[notes.length - 1].createdAt : null);
      })
      .catch(function () { callback(0, null); });
  }

  function formatRelativeDate(iso) {
    if (!iso) return '';
    var d = new Date(iso.indexOf('Z') === -1 ? iso.replace(' ', 'T') + 'Z' : iso);
    if (isNaN(d.getTime())) return '';
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return t('today');
    if (days === 1) return t('yesterday');
    if (days < 7) return format(t('daysAgo'), { n: days });
    return d.toLocaleDateString(LANG === 'es' ? 'es-ES' : undefined);
  }

  function computeStatus(session, completedLessonKeys, characterId) {
    var total = session.layers.length;
    var suffix = characterId ? ':' + characterId : '';
    var done = session.layers.filter(function (l) {
      return completedLessonKeys.indexOf(session.slug + ':' + l.layerNumber + suffix) !== -1;
    }).length;
    if (done === 0) return { key: 'not-started', label: t('notStarted') };
    if (done === total) return { key: 'completed', label: t('completed') };
    return { key: 'in-progress', label: t('inProgress') };
  }

  function buildRow(session, statusLabel, statusKey, titleOverride) {
    var row = el('div', 'sh-ec-row');
    var link = document.createElement('a');
    link.className = 'sh-ec-title';
    // No href is stored in the admin-managed excavation data — derived
    // from the slug instead, matching the WordPress page Ted creates
    // manually for each session type (/coach/<slug>/). See the
    // "automatic listing, still-manual page creation" split Ted
    // confirmed. Every character's row for the same session links to
    // the same page - the coach page itself asks which character via
    // its own picker (see stratum-coach.js buildCharacterPicker()).
    link.href = '/coach/' + session.slug + '/';
    link.textContent = titleOverride || session.title;
    mount(row, link);
    mount(row, el('span', 'sh-ec-badge sh-ec-badge--' + statusKey, statusLabel));
    return row;
  }

  function buildColumn(columnDef, sessionsForTrack, studentId, completedLessonKeys, characters, conflictsBySlug) {
    var col = el('div', 'sh-dash-card sh-ec-column');
    var head = el('div', 'sh-dash-card-head');
    mount(head, el('p', 'sh-dash-card-title', t(columnDef.labelKey)));
    // Sept 2026: each card now caps at 2 rows by default, with a View
    // All / Show Less toggle - same collapsed/expanded pattern the
    // other dashboard cards already use, but per-card here rather than
    // for the whole section, since each of the three tracks can have
    // a different number of rows. Button only shown once there's
    // actually something to expand.
    var viewAllBtn = document.createElement('button');
    viewAllBtn.type = 'button';
    viewAllBtn.className = 'sh-dash-open-btn';
    viewAllBtn.textContent = t('viewAll');
    mount(head, viewAllBtn);
    mount(col, head);
    var body = el('div', 'sh-dash-card-body');
    var listEl = el('div', 'sh-ec-list');
    mount(body, listEl);
    mount(col, body);
    if (!sessionsForTrack.length) {
      mount(listEl, el('div', 'sh-ec-empty', t('noSessionsYet')));
      return col;
    }
    var rowEls = [];
    sessionsForTrack.forEach(function (session) {
      if (columnDef.track === 'excavation' && session.requiresCharacter) {
        // One row per character, not one row for the whole program -
        // this program's progress is tracked separately per character.
        if (!characters.length) {
          var noCharRow = el('div', 'sh-ec-row');
          var noCharLink = document.createElement('a');
          noCharLink.className = 'sh-ec-title';
          noCharLink.href = '/coach/' + session.slug + '/';
          noCharLink.textContent = session.title;
          mount(noCharRow, noCharLink);
          mount(noCharRow, el('span', 'sh-ec-badge sh-ec-badge--not-started', t('addACharacter')));
          mount(listEl, noCharRow);
          rowEls.push(noCharRow);
          return;
        }
        characters.forEach(function (c) {
          var status = computeStatus(session, completedLessonKeys, c.id);
          // Sept 2026: was session.title + ' — ' + c.name — per request,
          // the character's name no longer shows on the card label. Note
          // the side effect this creates on its own: with more than one
          // character, every row for this session now renders with the
          // identical title and the identical link, distinguishable only
          // by each row's status badge — there's no longer any visible
          // way to tell WHICH character a given row is for from the
          // dashboard alone (the coach page's own character picker still
          // knows, this is purely a Excavation Center display change).
          var row = buildRow(session, status.label, status.key);
          mount(listEl, row);
          rowEls.push(row);
        });
      } else if (columnDef.track === 'excavation' && session.requiresConflictPair) {
        // One row per CONFLICT INSTANCE, not one row for the whole
        // program and not one row per character — this program's
        // progress is tracked separately per conflict (a student may
        // have three unrelated conflicts going for the same session
        // type). Instance data comes pre-fetched via conflictsBySlug
        // (see fetchConflictDataForSessions() in buildSection) rather
        // than fetched here per-row, so the async work happens once
        // up front instead of once per session.
        var instances = (conflictsBySlug && conflictsBySlug[session.slug]) || [];
        if (!instances.length) {
          // Nothing to pick from the dashboard itself — the two-
          // character/label picker lives on the coach page — so this
          // is just a plain Not Started row linking there, not an
          // "add a character"-style prompt.
          var noConflictRow = el('div', 'sh-ec-row');
          var noConflictLink = document.createElement('a');
          noConflictLink.className = 'sh-ec-title';
          noConflictLink.href = '/coach/' + session.slug + '/';
          noConflictLink.textContent = session.title;
          mount(noConflictRow, noConflictLink);
          mount(noConflictRow, el('span', 'sh-ec-badge sh-ec-badge--not-started', t('notStarted')));
          mount(listEl, noConflictRow);
          rowEls.push(noConflictRow);
          return;
        }
        instances.forEach(function (inst) {
          var status = computeStatus(session, completedLessonKeys, inst.id);
          var row = buildRow(session, status.label, status.key);
          mount(listEl, row);
          rowEls.push(row);
        });
      } else if (columnDef.track === 'excavation') {
        var status2 = computeStatus(session, completedLessonKeys);
        var row2 = buildRow(session, status2.label, status2.key);
        mount(listEl, row2);
        rowEls.push(row2);
      } else {
        // Recurring engine (General/Writing Tracks) - a completion
        // badge doesn't apply, so show a check-in count instead,
        // fetched per session since it's scoped to one at a time.
        var row = buildRow(session, '\u2026', 'checkin');
        fetchCheckinCount(studentId, session.slug, function (count, lastAt) {
          var badge = row.querySelector('.sh-ec-badge');
          if (!badge) return;
          badge.textContent = count
            ? (format(t(count === 1 ? 'checkinCountSingular' : 'checkinCountPlural'), { n: count }) + (lastAt ? ' \u00b7 ' + formatRelativeDate(lastAt) : ''))
            : t('noCheckinsYet');
        });
        mount(listEl, row);
        rowEls.push(row);
      }
    });
    // Cap display to the first 2 rows - note this is list order (as
    // returned by the session registry / character list), not a true
    // "most recently active" sort: there's no reliable recency signal
    // across every row type (a character-scoped Excavation row has no
    // timestamp at all; only the Recurring rows' check-in dates would
    // support real recency, and those arrive asynchronously after the
    // row already exists). Flagging this rather than quietly claiming
    // true recency sorting that isn't actually there.
    var expanded = false;
    function updateVisibility() {
      rowEls.forEach(function (r, i) { r.style.display = (expanded || i < 2) ? '' : 'none'; });
    }
    updateVisibility();
    // Sept 2026 fix: was only shown when rowEls.length > 2, so a card
    // with 0-2 rows never got a button at all - looked like the button
    // was simply missing from that card. Ted asked for it on all three
    // cards, always, so it's now always rendered; it's just inert
    // (disabled, no-op) when there's nothing to expand.
    viewAllBtn.style.display = '';
    if (rowEls.length > 2) {
      viewAllBtn.addEventListener('click', function () {
        expanded = !expanded;
        viewAllBtn.textContent = expanded ? t('showLess') : t('viewAll');
        updateVisibility();
      });
    } else {
      viewAllBtn.disabled = true;
      viewAllBtn.style.opacity = '0.45';
      viewAllBtn.style.cursor = 'default';
    }
    return col;
  }

  function buildSection(studentId) {
    var section = el('div', 'sh-ec-section');

    var columnsEl = el('div', 'sh-ec-columns');
    mount(section, columnsEl);
    TRACK_COLUMNS.forEach(function (columnDef) {
      var col = el('div', 'sh-dash-card sh-ec-column');
      var head = el('div', 'sh-dash-card-head');
      mount(head, el('p', 'sh-dash-card-title', t(columnDef.labelKey)));
      mount(col, head);
      var body = el('div', 'sh-dash-card-body');
      mount(body, el('div', 'sh-ec-empty', t('loading')));
      mount(col, body);
      mount(columnsEl, col);
    });

    if (!window.StratumSessions) {
      columnsEl.innerHTML = '';
      TRACK_COLUMNS.forEach(function (columnDef) {
        mount(columnsEl, buildColumn(columnDef, [], studentId, [], [], {}));
      });
      return section;
    }
    window.StratumSessions.ready(function (sessions) {
      fetchCompletions(studentId, function (completions) {
        var completedLessonKeys = completions.map(function (c) { return c.lesson; });
        var needsCharacters = sessions.some(function (s) { return s.requiresCharacter; });
        var conflictSessions = sessions.filter(function (s) { return (s.track || 'excavation') === 'excavation' && s.requiresConflictPair; });
        var needsConflicts = conflictSessions.length > 0;
        function render(characters, conflictsBySlug) {
          columnsEl.innerHTML = '';
          TRACK_COLUMNS.forEach(function (columnDef) {
            var sessionsForTrack = sessions.filter(function (s) { return (s.track || 'excavation') === columnDef.track; });
            mount(columnsEl, buildColumn(columnDef, sessionsForTrack, studentId, completedLessonKeys, characters, conflictsBySlug));
          });
        }
        if (!needsCharacters && !needsConflicts) { render([], {}); return; }
        // Sept 2026 (multiple WIPs): both a requiresCharacter session's
        // row-per-character listing AND a requiresConflictPair
        // session's row-per-conflict listing need to know which WIP to
        // pull from - same WIP-first flow as the profile panel and the
        // coach page. The two data sets are fetched in parallel off
        // the same resolved WIP rather than sequentially, since
        // neither depends on the other.
        function loadForWip(wipId) {
          var pending = 0;
          var characters = [];
          var conflictsBySlug = {};
          function maybeRender() { pending--; if (pending === 0) render(characters, conflictsBySlug); }
          if (needsCharacters) {
            pending++;
            fetchCharactersForWip(studentId, wipId, function (c) { characters = c; maybeRender(); });
          }
          if (needsConflicts) {
            pending++;
            fetchConflictDataForSessions(conflictSessions, studentId, wipId, function (data) { conflictsBySlug = data; maybeRender(); });
          }
        }
        fetchWips(studentId, function (wips) {
          if (!wips.length) { render([], {}); return; }
          var lockedId = sessGet(WIP_LOCK_KEY);
          var active = (lockedId && wips.filter(function (w) { return w.id === lockedId; })[0]) || wips[0];
          if (!lockedId) sessSet(WIP_LOCK_KEY, active.id);
          if (wips.length > 1) {
            section.insertBefore(
              buildWipSelector(wips, active.id, function (wipId) {
                sessSet(WIP_LOCK_KEY, wipId);
                loadForWip(wipId);
              }),
              columnsEl
            );
          }
          loadForWip(active.id);
        });
      });
    });

    return section;
  }

  function mountInto(wrapEl, studentId) {
    if (!wrapEl || wrapEl.querySelector('.sh-ec-section')) return; // avoid double-mount
    mount(wrapEl, buildSection(studentId));
  }

  function proceed(studentId) {
    loadUiStrings(function () {
      mountInto(window.STRATUM_HEADER_WRAP, studentId || null);
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
