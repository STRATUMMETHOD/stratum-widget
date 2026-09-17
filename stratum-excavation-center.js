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
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var TRACK_COLUMNS = [
    { track: 'excavation', label: 'Excavation Coaching' },
    { track: 'general', label: 'General Coaching' },
    { track: 'writing', label: 'Writer\u2019s Coaching' }
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
    mount(wrap, el('label', 'sh-ec-wip-select-label', 'Work in progress:'));
    var select = document.createElement('select');
    select.className = 'sh-ec-wip-select';
    wips.forEach(function (w) {
      var o = document.createElement('option');
      o.value = w.id;
      o.textContent = w.title || 'Untitled WIP';
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
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    return d.toLocaleDateString();
  }

  function computeStatus(session, completedLessonKeys, characterId) {
    var total = session.layers.length;
    var suffix = characterId ? ':' + characterId : '';
    var done = session.layers.filter(function (l) {
      return completedLessonKeys.indexOf(session.slug + ':' + l.layerNumber + suffix) !== -1;
    }).length;
    if (done === 0) return { key: 'not-started', label: 'Not Started' };
    if (done === total) return { key: 'completed', label: 'Completed' };
    return { key: 'in-progress', label: 'In Progress' };
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

  function buildColumn(columnDef, sessionsForTrack, studentId, completedLessonKeys, characters) {
    var col = el('div', 'sh-dash-card sh-ec-column');
    var head = el('div', 'sh-dash-card-head');
    mount(head, el('p', 'sh-dash-card-title', columnDef.label));
    mount(col, head);
    var body = el('div', 'sh-dash-card-body');
    var listEl = el('div', 'sh-ec-list');
    mount(body, listEl);
    mount(col, body);
    if (!sessionsForTrack.length) {
      mount(listEl, el('div', 'sh-ec-empty', 'No sessions yet.'));
      return col;
    }
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
          mount(noCharRow, el('span', 'sh-ec-badge sh-ec-badge--not-started', 'Add a character'));
          mount(listEl, noCharRow);
          return;
        }
        characters.forEach(function (c) {
          var status = computeStatus(session, completedLessonKeys, c.id);
          mount(listEl, buildRow(session, status.label, status.key, session.title + ' \u2014 ' + c.name));
        });
      } else if (columnDef.track === 'excavation') {
        var status2 = computeStatus(session, completedLessonKeys);
        mount(listEl, buildRow(session, status2.label, status2.key));
      } else {
        // Recurring engine (General/Writing Tracks) - a completion
        // badge doesn't apply, so show a check-in count instead,
        // fetched per session since it's scoped to one at a time.
        var row = buildRow(session, '\u2026', 'checkin');
        fetchCheckinCount(studentId, session.slug, function (count, lastAt) {
          var badge = row.querySelector('.sh-ec-badge');
          if (!badge) return;
          badge.textContent = count
            ? (count + ' check-in' + (count === 1 ? '' : 's') + (lastAt ? ' \u00b7 ' + formatRelativeDate(lastAt) : ''))
            : 'No check-ins yet';
        });
        mount(listEl, row);
      }
    });
    return col;
  }

  function buildSection(studentId) {
    var section = el('div', 'sh-ec-section');

    var columnsEl = el('div', 'sh-ec-columns');
    mount(section, columnsEl);
    TRACK_COLUMNS.forEach(function (columnDef) {
      var col = el('div', 'sh-dash-card sh-ec-column');
      var head = el('div', 'sh-dash-card-head');
      mount(head, el('p', 'sh-dash-card-title', columnDef.label));
      mount(col, head);
      var body = el('div', 'sh-dash-card-body');
      mount(body, el('div', 'sh-ec-empty', 'Loading\u2026'));
      mount(col, body);
      mount(columnsEl, col);
    });

    if (!window.StratumSessions) {
      columnsEl.innerHTML = '';
      TRACK_COLUMNS.forEach(function (columnDef) {
        mount(columnsEl, buildColumn(columnDef, [], studentId, [], []));
      });
      return section;
    }
    window.StratumSessions.ready(function (sessions) {
      fetchCompletions(studentId, function (completions) {
        var completedLessonKeys = completions.map(function (c) { return c.lesson; });
        var needsCharacters = sessions.some(function (s) { return s.requiresCharacter; });
        function render(characters) {
          columnsEl.innerHTML = '';
          TRACK_COLUMNS.forEach(function (columnDef) {
            var sessionsForTrack = sessions.filter(function (s) { return (s.track || 'excavation') === columnDef.track; });
            mount(columnsEl, buildColumn(columnDef, sessionsForTrack, studentId, completedLessonKeys, characters));
          });
        }
        if (!needsCharacters) { render([]); return; }
        // Sept 2026 (multiple WIPs): a requiresCharacter session's
        // row-per-character listing needs to know which WIP to pull
        // characters from - same WIP-first flow as the profile panel
        // and the coach page.
        fetchWips(studentId, function (wips) {
          if (!wips.length) { render([]); return; }
          var lockedId = sessGet(WIP_LOCK_KEY);
          var active = (lockedId && wips.filter(function (w) { return w.id === lockedId; })[0]) || wips[0];
          if (!lockedId) sessSet(WIP_LOCK_KEY, active.id);
          if (wips.length > 1) {
            section.insertBefore(
              buildWipSelector(wips, active.id, function (wipId) {
                sessSet(WIP_LOCK_KEY, wipId);
                fetchCharactersForWip(studentId, wipId, render);
              }),
              columnsEl
            );
          }
          fetchCharactersForWip(studentId, active.id, render);
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
    mountInto(window.STRATUM_HEADER_WRAP, studentId || null);
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
