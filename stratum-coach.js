/* ============================================================
   STRATUM COACH — COACHING SESSION PAGE LOGIC (Sept 2026)
   ------------------------------------------------------------
   Character Excavation is the first Excavation built on this page;
   the format is reused for every future one (a growing list, managed
   entirely from the Stratum admin's Excavations tab — see stratum-
   lesson-admin.html). This is a port of the working "ladder" coaching
   logic that originally existed in stratum-lesson-engine.js, restyled
   for the dark/warm design system and reconnected to stratum-
   identity.js instead of that file's own cookie-only identity
   handling.

   Data model: an Excavation (title, ONE video, ONE shared transcript,
   ONE coaching intro) has an ordered list of Layers, each keyed by a
   simple 1/2/3... layer_number scoped to that excavation (not the old
   free-text lesson ids). Session/layer data comes LIVE from the
   Worker via window.StratumSessions (stratum-sessions.js) — no more
   static per-session registry file; a new Excavation the admin
   creates shows up here automatically. Layer completions, transcripts,
   and the end-of-excavation synthesis are all keyed server-side by
   the compound string "excavationSlug:layerNumber" (see lessonKey()
   below) — a bare layer number alone isn't unique across excavations.

   IMPORTANT — data sourcing: this file fetches WIP profile, Idea
   Log, and Reminders context directly from /project, /notes, /tasks
   at conversation-start time, NOT from localStorage. stratum-wip-
   panel.js and stratum-dashboard.js both read/write the server
   directly — reusing an old localStorage cache here would silently
   see nothing.

   Requires stratum-identity.js, stratum-header.js (for
   window.StratumHeader.buildTopbar), AND stratum-sessions.js loaded
   first on this page.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var WP_USER = window.StratumIdentity ? window.StratumIdentity.getWpUser() : { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };
  var LANG_STORE_KEY = 'wlfc_preferred_lang'; // same key stratum-header.js's Language dropdown writes
  var MODEL = 'claude-sonnet-4-5';


  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function stripAsteriskEmphasis(text) {
    return String(text).replace(/\*([^*\n]+)\*/g, '$1');
  }
  function textToParagraphs(text) {
    var blocks = String(text).replace(/\r\n/g, '\n').split(/\n\s*\n/);
    var out = '';
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i].trim();
      if (!block) continue;
      out += '<p>' + escapeHtml(block).replace(/\n/g, '<br>') + '</p>';
    }
    return out;
  }

  // ----------------------------------------------------------
  // STATE
  // ----------------------------------------------------------
  var SESSION = null;          // resolved SESSION_DEFINITIONS entry
  var STUDENT_ID = null;
  var LANG = lsGet(LANG_STORE_KEY) || 'en';
  var currentLayerIndex = 0;
  var completedLayerIds = {};
  var LAYER_CONFIG = null;     // current layer's lesson_config
  var conversationHistory = [];
  var conversationId = null;
  var studentName = WP_USER.firstName || '';
  var lastDeliverable = null;
  var deliverableRetryCount = 0;
  var MAX_DELIVERABLE_RETRIES = 2;
  var busy = false;
  var poolExhausted = false;
  var ENGINE_MODE = 'excavation'; // set from SESSION.track once loaded — 'excavation' = Linear Layers -> Synthesis (unchanged); 'general'/'writing' = Recurring Check-In (see buildRecurringPage() etc below)
  var ALL_CHECKIN_NOTES = [];     // Recurring engine only — every past check-in across every topic in this session, fetched once and reused for both the topic list and each conversation's injected history
  var topicListEl = null;         // Recurring engine only
  var SELECTED_CHARACTER = null;  // {id, name, type, roleType, coreConflict} — set via the character picker for any excavation with requiresCharacter true; null for every other excavation

  var railEl, messagesEl, formEl, inputEl, sendBtn, contentEl;

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ----------------------------------------------------------
  // VIDEO — only layer[0] carries a video for the whole session
  // ----------------------------------------------------------
  function buildVideo(container, mediaId) {
    if (!mediaId) return;
    if (!document.querySelector('script[src="https://fast.wistia.com/player.js"]')) {
      var s = document.createElement('script');
      s.src = 'https://fast.wistia.com/player.js';
      s.async = true;
      document.head.appendChild(s);
    }
    var moduleSrc = 'https://fast.wistia.com/embed/' + mediaId + '.js';
    if (!document.querySelector('script[src="' + moduleSrc + '"]')) {
      var m = document.createElement('script');
      m.src = moduleSrc;
      m.type = 'module';
      m.async = true;
      document.head.appendChild(m);
    }
    var wrap = el('div', 'sh-coach-video-wrap');
    var player = document.createElement('wistia-player');
    player.setAttribute('media-id', mediaId);
    player.setAttribute('aspect', '2.4');
    mount(wrap, player);
    mount(container, wrap);
  }

  // ----------------------------------------------------------
  // STRATA RAIL
  // ----------------------------------------------------------
  // Graduated brown/sediment tones, lightest to darkest — same muted
  // ancient palette family as the header's strata artwork. The warm
  // accent color is deliberately NOT used as a base fill here; it's
  // reserved for the current-layer ring, the progress track, and the
  // done checkmark, so it stays a clear "this is active/complete" signal
  // rather than blending into decoration.
  var RAIL_TONES = ['#2A2217', '#332A1C', '#3D3220', '#463A26', '#4F422C', '#584A32'];

  // Sept 2026: a vertical progress track runs down the rail's left edge,
  // filling (with a smooth CSS transition) to mark how far the student
  // has advanced, plus a pulsing marker dot at the current position —
  // per Ted's request for a real "sense of movement" as layers complete,
  // rather than a static list of rows that only differ by opacity.
  function renderRail() {
    railEl.innerHTML = '';
    var track = el('div', 'sh-rail-track');
    var fill = el('div', 'sh-rail-track-fill');
    var fillPct = (currentLayerIndex / SESSION.layers.length) * 100;
    fill.style.setProperty('--sh-rail-fill-pct', fillPct + '%');
    mount(track, fill);
    var marker = el('div', 'sh-rail-marker');
    marker.style.setProperty('--sh-rail-fill-pct', fillPct + '%');
    mount(track, marker);
    mount(railEl, track);

    SESSION.layers.forEach(function (layer, i) {
      var isDone = !!completedLayerIds[lessonKey(layer.layerNumber)];
      var isCurrent = i === currentLayerIndex;
      var state = isDone ? 'sh-done' : (isCurrent ? 'sh-current' : 'sh-pending');
      var row = el('div', 'sh-rail-layer ' + state);
      row.style.background = RAIL_TONES[i % RAIL_TONES.length];
      var check = el('div', 'sh-rail-check', isDone ? '\u2713' : '');
      mount(row, check);
      mount(row, el('div', 'sh-rail-label', layer.label));
      mount(railEl, row);
    });
  }

  // ----------------------------------------------------------
  // CONTEXT FETCHING (WIP profile, Idea Log, Reminders, Global
  // Instructions) — all server-authoritative, fetched fresh, not from
  // localStorage. See file header note.
  // ----------------------------------------------------------

  function fetchProjectData(callback) {
    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && d.known) ? d : null); })
      .catch(function () { callback(null); });
  }
  function fetchIdeaLogEntries(callback) {
    fetch(PROXY_URL + '/notes?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known || !d.text) { callback([]); return; }
        var parsed;
        try { parsed = JSON.parse(d.text); } catch (e) { parsed = null; }
        callback(Array.isArray(parsed) ? parsed : []);
      })
      .catch(function () { callback([]); });
  }
  function fetchTasks(callback) {
    fetch(PROXY_URL + '/tasks?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && d.known && Array.isArray(d.tasks)) ? d.tasks : []); })
      .catch(function () { callback([]); });
  }
  function fetchGlobalInstructions(callback) {
    fetch(PROXY_URL + '/global-instructions')
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.instructions)) ? d.instructions : []); })
      .catch(function () { callback([]); });
  }
  // Sept 2026: Global Coaching Philosophy — the Track-level voice/
  // technique layer (motivational-interviewing style, how hard to press,
  // tone), admin-editable in the Global Instructions tab. This is
  // SEPARATE from the tag-capture mechanics ([NAME:]/[SUMMARY:]/
  // [REFLECTION_COMPLETE]) below in buildSystemPrompt(), which stay
  // hardcoded here and are never exposed to admin editing — a bad prose
  // edit to those could silently break every session's ability to
  // capture names/summaries/deliverables with no obvious symptom.
  function fetchCoachingPhilosophy(track, callback) {
    fetch(PROXY_URL + '/coaching-philosophy?track=' + encodeURIComponent(track))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && d.known) ? d.content : ''); })
      .catch(function () { callback(''); });
  }
  // ---- Recurring Check-In engine (General/Writing tracks) ----
  // Every past check-in across every topic in this session type, in one
  // running append-only log — NOT a single deliverable/synthesis, since
  // this engine has no fixed completion. Fetched once per page load and
  // reused both for the topic list's "N check-ins so far" display and
  // for injecting full history into each fresh conversation's system
  // prompt (per Ted's "access to all information from previous
  // sessions" requirement).
  function fetchCheckinNotes(sessionSlug, callback) {
    fetch(PROXY_URL + '/checkin-notes?studentId=' + encodeURIComponent(STUDENT_ID) + '&sessionSlug=' + encodeURIComponent(sessionSlug))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.notes)) ? d.notes : []); })
      .catch(function () { callback([]); });
  }
  function postCheckinNote(sessionSlug, layerNumber, layerLabel, note, callback) {
    fetch(PROXY_URL + '/checkin-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, sessionSlug: sessionSlug, layerNumber: layerNumber, layerLabel: layerLabel, note: note })
    })
      .then(function () { callback(); })
      .catch(function () { callback(); });
  }

  // Sept 2026: reads the restructured /project record — wipTitle/genre/
  // stage/storyStyle/pov unchanged, theme now holds the MERGED Theme/
  // Focus free text (the old separate "focus" enum field and its
  // FOCUS_GUIDANCE lookup are retired along with the "challenges" field
  // — see stratum-wip-panel.js), and mcName/antagonistName/
  // antagonistType/mcGoal are replaced by a real characters[] list, each
  // with name/type/roleType/coreConflict, listed out individually so the
  // coach has the full cast, not just one protagonist and one antagonist.
  function buildProjectContextBlock(project, ideaLog, tasks, globalInstructions, coachingPhilosophy) {
    var block = '';
    if (coachingPhilosophy) {
      block += '\n\nCOACHING PHILOSOPHY FOR THIS TRACK - PRIVATE, NEVER SHOWN TO THE STUDENT, APPLIES ACROSS EVERY EXCAVATION (this layer\'s own Coaching Approach below, if any, refines or takes precedence where they conflict):\n' + coachingPhilosophy;
    }
    if (project) {
      var lines = [];
      if (project.wipTitle) lines.push('Working title: ' + project.wipTitle);
      if (project.genre) lines.push('Genre: ' + project.genre);
      if (project.storyStyle) lines.push('Story style: ' + project.storyStyle);
      if (project.pov) lines.push('Point of view: ' + project.pov);
      if (project.stage) lines.push('Stage of progress: ' + project.stage);
      if (project.theme) lines.push('Theme/focus: ' + project.theme);
      if (lines.length) {
        block += '\n\nSTUDENT PROJECT CONTEXT (from their WIP profile - use naturally where relevant, do not interrogate them about these facts, they already told you once):\n' + lines.join('\n');
      }
      var characters = Array.isArray(project.characters) ? project.characters.filter(function (c) { return c && c.name; }) : [];
      if (characters.length) {
        var charLines = characters.map(function (c) {
          var bits = [c.type, c.roleType, c.coreConflict].filter(Boolean).join(' \u2014 ');
          return c.name + (bits ? ' (' + bits + ')' : '');
        });
        block += '\n\nCHARACTERS (the student\'s full cast, as they defined it - use naturally, do not interrogate them about these facts, they already told you once):\n' + charLines.join('\n');
      }
      if (project.language) {
        block += '\n\nLANGUAGE: This student has selected ' + project.language + ' as their preferred coaching language. From this point forward, conduct the entire conversation in ' + project.language + ', every question, every follow-up, every reflection, and the closing message. Write naturally and idiomatically, not as a literal translation. Exception: keep every hidden bracket tag exactly in English bracket format as instructed elsewhere in this prompt - only the name inside a NAME tag and the content inside deliverable field tags should reflect what the student actually said.';
      }
    }
    if (ideaLog.length) {
      var sorted = ideaLog.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 20);
      var ideaLines = sorted.map(function (e) { return '[' + e.category + '] ' + (e.text || ''); });
      block += '\n\nSTUDENT\'S IDEA LOG (things they have privately noted between sessions, newest first, each tagged with a category - reference material, not a script. Draw on it naturally where it helps; never recite it back verbatim or treat it as a checklist):\n' + ideaLines.join('\n');
    }
    if (tasks.length) {
      var capped = tasks.slice(-20);
      var taskLines = capped.map(function (tk) { return (tk.done ? '[done] ' : '[open] ') + tk.text; });
      block += '\n\nSTUDENT\'S REMINDERS (their own self-set to-do list for this WIP - only bring one up if directly relevant to what they are already saying; never quiz them on the whole list):\n' + taskLines.join('\n');
    }
    if (globalInstructions.length) {
      var applicable = globalInstructions.filter(function (item) {
        // Track/Module scoping: null track = applies to every track;
        // otherwise must match this session's own track and, if a
        // module is set, this specific session type's slug.
        var itemTracks = Array.isArray(item.tracks) ? item.tracks : [];
        if (itemTracks.length && itemTracks.indexOf(SESSION.track || 'excavation') === -1) return false;
        if (itemTracks.length === 1 && item.module && item.module !== SESSION.slug) return false;
        // Existing WIP-field matching, combinable with the above.
        if (!item.matchField || !project) return !item.matchField;
        var fieldVal = project[item.matchField];
        return !!fieldVal && fieldVal === item.matchValue;
      });
      if (applicable.length) {
        var byCategory = {}; var order = [];
        applicable.forEach(function (item) {
          var cat = item.category || 'General';
          if (!byCategory[cat]) { byCategory[cat] = []; order.push(cat); }
          byCategory[cat].push(item.content);
        });
        var giLines = [];
        order.forEach(function (cat) {
          giLines.push(cat.toUpperCase() + ':');
          byCategory[cat].forEach(function (c) { giLines.push('- ' + c); });
        });
        block += '\n\nGLOBAL COACHING INSTRUCTIONS - PRIVATE, NEVER SHOWN TO THE STUDENT, APPLY ACROSS EVERY LAYER (this layer\'s own Coaching Approach below, if any, refines or takes precedence where they conflict):\n' + giLines.join('\n');
      }
    }
    return block;
  }

  // ----------------------------------------------------------
  // SYSTEM PROMPT (per layer)
  // ----------------------------------------------------------
  function fieldTagName(key) {
    return String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  function getDeliverableConfig() {
    var raw = LAYER_CONFIG && LAYER_CONFIG.reflectionFramework ? LAYER_CONFIG.reflectionFramework.deliverable : null;
    if (!raw || !raw.required) return null;
    if (Array.isArray(raw.fields) && raw.fields.length) return { required: true, fields: raw.fields };
    return {
      required: true,
      fields: [
        { key: 'behavior', label: raw.behaviorLabel || 'Anchor Behavior', type: 'single' },
        { key: 'instance', label: raw.instanceLabel || 'Instance', type: 'list', count: raw.instanceCount || 3, parts: ['context', 'people', 'action'] }
      ]
    };
  }
  function buildSystemPrompt(contextBlock) {
    var layer = SESSION.layers[currentLayerIndex];
    var rf = LAYER_CONFIG.reflectionFramework;
    var areasList = rf.areas || [];
    var isLegacyArea = areasList.length && areasList[0].whatToSurface == null && areasList[0].technique == null && areasList[0].instructions != null;
    var areas;
    if (isLegacyArea) {
      // Legacy area shape (saved before the Sept 2026 per-area
      // restructuring) - rendered as best-effort so an un-migrated
      // layer still coaches reasonably rather than going blank.
      areas = areasList.map(function (area, i) {
        return 'AREA ' + (i + 1) + ' - ' + area.title + '\n' + area.instructions;
      }).join('\n\n');
    } else {
      areas = areasList.map(function (area, i) {
        var lines = ['AREA ' + (i + 1) + ' - ' + area.title];
        if (area.whatToSurface) lines.push('What to surface: ' + area.whatToSurface);
        if (area.technique) lines.push('Technique: ' + area.technique);
        if (area.exitSignal) lines.push('Exit signal (do not move past this area until this is genuinely reached): ' + area.exitSignal);
        var areaCal = Array.isArray(area.calibrationExamples) ? area.calibrationExamples : [];
        if (areaCal.length) {
          lines.push('Calibration for this area:');
          areaCal.forEach(function (ex) {
            if (ex.title) lines.push('  - ' + ex.title);
            if (ex.weak) lines.push('    Weak (stop here): ' + ex.weak);
            if (ex.strong) lines.push('    Strong (this passes): ' + ex.strong);
            if (ex.note) lines.push('    Coaching note: ' + ex.note);
          });
        }
        return lines.join('\n');
      }).join('\n\n');
    }
    var workedExamples = (Array.isArray(LAYER_CONFIG.workedExamples) ? LAYER_CONFIG.workedExamples : []).map(function (ex) {
      var lines = [];
      if (ex.label) lines.push(ex.label + ':');
      if (ex.script) lines.push(ex.script);
      if (ex.note) lines.push('Why this works: ' + ex.note);
      return lines.join('\n');
    }).join('\n\n---\n\n');
    var scopeNote = LAYER_CONFIG.scopeNote || layer.label;
    var parts = [
      'You are a professional writing coach, live, in a real one-on-one coaching conversation exploring "' + layer.label + '" as part of the ' + SESSION.title + ' coaching session on The Stratum Method. You have no name and no personal biography - you are simply an experienced, well-trained coach who works with fiction writers on their own work, using the Socratic method: you draw the person\u2019s own answers out of them, you never supply the answer yourself. This is who you are in this conversation: warm, direct, genuinely curious about this specific person, unhurried.',
      'STAY IN VOICE: Speak only in first person as this coach, for the entire conversation. If the person sincerely and directly asks whether they are talking to a real person or an AI, answer honestly and briefly - you are an AI coach trained in the Socratic method, not a human live - then gently continue the conversation.',
      'CRITICAL FORMATTING RULE: Never wrap any word in asterisks for emphasis - this chat renders plain text only, so *anything like this* appears to the person as literal asterisks. If a word needs emphasis, use plain phrasing or sentence rhythm instead.'
    ];
    if (SELECTED_CHARACTER) {
      var charLines = ['THE CHARACTER THIS EXCAVATION IS ABOUT:\nEverything in this conversation is specifically about ' + (SELECTED_CHARACTER.name || 'this character') + ', not the writer themselves and not any other character in their project. Keep every question anchored to this one character.'];
      var charFacts = [];
      if (SELECTED_CHARACTER.type) charFacts.push('Type: ' + SELECTED_CHARACTER.type);
      if (SELECTED_CHARACTER.roleType) charFacts.push('Role: ' + SELECTED_CHARACTER.roleType);
      if (SELECTED_CHARACTER.coreConflict) charFacts.push('Core conflict: ' + SELECTED_CHARACTER.coreConflict);
      if (charFacts.length) charLines.push(charFacts.join(' | '));
      parts.push(charLines.join('\n'));
    }
    parts.push(
      'WHAT THIS LAYER COVERS (' + scopeNote + ')' + (SESSION.transcript ? ':\n"""\n' + SESSION.transcript + '\n"""' : '.'),
      'WHAT THIS CONVERSATION IS FOR:\nThis single, continuous, natural conversation IS the exploration of ' + layer.label + '. The areas below run in STRICT ORDER - work through Area 1 first and do not move into real depth on Area 2 until Area 1\u2019s exit signal has been genuinely reached, and so on down the list. If the person tries to jump ahead on their own, that\u2019s fine to acknowledge warmly, but gently bring the conversation back to the current area rather than following them ahead of where the work actually is:\n\n' + areas
    );
    if (workedExamples) {
      parts.push('WORKED EXAMPLES - HOW A WELL-TRAINED COACH HANDLES MOMENTS LIKE THESE - NEVER SHOWN OR QUOTED TO THE PERSON:\n' + workedExamples);
    }
    if (contextBlock) parts.push(contextBlock);
    if (isLegacyArea === false && rf.coachingApproach) {
      // Legacy layer-level field (saved before the per-area
      // restructuring, not yet redistributed into individual areas).
      parts.push('ADDITIONAL GUIDANCE FOR THIS LAYER (legacy, not yet sorted into individual areas) - PRIVATE, NEVER SHOWN TO THE PERSON:\n' + rf.coachingApproach);
    }
    parts.push(
      'HOW YOU DRAW THESE OUT - MOTIVATIONAL INTERVIEWING, NOT INTERROGATION:\nUse the spirit of motivational interviewing: ask open questions, reflect back what they say before moving forward, offer genuine affirmation when something costs them something to say, summarize periodically.',
      'THE DEPTH RULE:\nIf an answer is generic or surface-level, reflect it back gently and ask ONE specific follow-up inviting more. If they are still on the surface after that one gentle nudge, accept where they are and move on. Never let a surface answer pass completely unremarked, but never turn this into an interrogation.'
    );
    var deliverable = getDeliverableConfig();
    if (deliverable) {
      var fieldDescs = deliverable.fields.map(function (f) {
        return f.type === 'list' ? 'exactly ' + (f.count || 3) + ' real, specific ' + (f.label || f.key) + '(s)' : 'a single, specific ' + (f.label || f.key);
      });
      parts.push('OVERRIDE TO THE DEPTH RULE FOR THIS LAYER - THIS TAKES PRECEDENCE:\nThis layer has non-negotiable deliverables: ' + fieldDescs.join(', and ') + '. Do not move toward closing this layer until every one is genuinely complete, no matter how many follow-up questions it takes.');
    }
    var legacyCal = (isLegacyArea === false && Array.isArray(rf.calibrationExamples) && rf.calibrationExamples.length) ? rf.calibrationExamples : null;
    parts.push(
      'WHAT YOU NEVER DO:\nNever write their reflection for them. Never diagnose them or their psychology. Stay descriptive and curious, not clinical.'
    );
    if (legacyCal) {
      var legacyCalText = legacyCal.map(function (ex) {
        if (typeof ex === 'string') return '- ' + ex;
        var lines = [];
        if (ex.title) lines.push('- ' + ex.title);
        if (ex.weak) lines.push('  Weak (stop here): ' + ex.weak);
        if (ex.strong) lines.push('  Strong (this passes): ' + ex.strong);
        if (ex.note) lines.push('  Coaching note: ' + ex.note);
        return lines.join('\n');
      }).join('\n');
      parts.push('ADDITIONAL CALIBRATION (legacy, not yet sorted into individual areas) - NEVER SHOW OR QUOTE THESE TO THE PERSON:\n' + legacyCalText);
    }
    parts.push(
      'GETTING THEIR NAME:\nYou have already greeted the person before this conversation history begins. If you did not already know their name, their reply should contain it. The very first time you learn their name, begin your reply with a hidden tag on its own line, exactly: [NAME: Their Name] - then continue your reply below it. Only include this tag once.',
      'STYLE:\nWrite the way a real person talks in a warm one-on-one conversation. Keep replies short: two to five sentences. Ask ONE question at a time. Never use markdown formatting of any kind, including asterisks for emphasis.'
    );
    var wrapParts = ['Once every area has been genuinely explored, in order, each past its exit signal - not perfectly, just genuinely past a first surface answer - bring this layer to a warm close.'];
    if (deliverable) {
      var tagLines = '';
      deliverable.fields.forEach(function (f) {
        var tag = fieldTagName(f.key);
        if (f.type === 'list') {
          var count = f.count || 3;
          var payloadHint = Array.isArray(f.parts) && f.parts.length ? f.parts.join(' | ') : 'exactly what applies, stated specifically';
          for (var i = 1; i <= count; i++) tagLines += '[' + tag + '_' + i + ': ' + payloadHint + ']\n';
        } else {
          tagLines += '[' + tag + ': the finished, specific ' + (f.label || f.key) + ']\n';
        }
      });
      var fieldSummary = deliverable.fields.map(function (f) {
        return f.type === 'list' ? (f.count || 3) + ' ' + (f.label || f.key) + '(s)' : (f.label || f.key);
      }).join(', ');
      wrapParts.push('CAPTURING THE DELIVERABLE - REQUIRED BEFORE YOU CAN CLOSE:\nBefore your closing message, on their own lines, include hidden tags capturing every finished deliverable field - ' + fieldSummary + ':\n\n' + tagLines + '\nEvery field must contain real, specific content the person actually gave you. Do not emit these tags, and do not close the layer, until you actually have all of this.');
      wrapParts.push('Immediately after those tags, on its own line, include a hidden tag: [SUMMARY: One plain sentence, third person, under twenty words, capturing the core insight that surfaced.] - never shown to the person. End your closing message with the exact tag [REFLECTION_COMPLETE] on its own line at the very end, after every other tag.');
    } else {
      wrapParts.push('Immediately before your closing sentence, include a hidden tag: [SUMMARY: One plain sentence, third person, under twenty words.] - never shown to the person. End with [REFLECTION_COMPLETE] on its own line at the very end.');
    }
    parts.push('WRAPPING UP:\n' + wrapParts.join('\n\n'));
    return parts.join('\n\n');
  }

  // ----------------------------------------------------------
  // TAG EXTRACTION / VALIDATION (unchanged logic from the old engine)
  // ----------------------------------------------------------
  function extractTags(raw) {
    var text = raw;
    var name = null, complete = false, summary = null, fields = {};
    var nameMatch = text.match(/^\[NAME:\s*([^\]]+)\]\s*/i);
    if (nameMatch) { name = nameMatch[1].trim(); text = text.replace(nameMatch[0], ''); }
    var config = getDeliverableConfig();
    (config && config.fields ? config.fields : []).forEach(function (f) {
      var tag = fieldTagName(f.key);
      if (f.type === 'list') {
        var re = new RegExp('\\[' + tag + '_(\\d+):\\s*([^\\]]+)\\]\\s*', 'gi');
        var items = [], im;
        while ((im = re.exec(raw)) !== null) {
          var payload = im[2], value;
          if (Array.isArray(f.parts) && f.parts.length) {
            var pieces = payload.split('|').map(function (s) { return s.trim(); });
            value = {};
            f.parts.forEach(function (partName, i) { value[partName] = pieces[i] || ''; });
          } else { value = payload.trim(); }
          items[Number(im[1]) - 1] = value;
        }
        text = text.replace(re, '');
        fields[f.key] = items.filter(function (v) { return v !== undefined; });
      } else {
        var reSingle = new RegExp('\\[' + tag + ':\\s*([^\\]]+)\\]\\s*', 'i');
        var m = text.match(reSingle);
        fields[f.key] = m ? m[1].trim() : null;
        if (m) text = text.replace(reSingle, '');
      }
    });
    var summaryMatch = text.match(/\[SUMMARY:\s*([^\]]+)\]\s*/i);
    if (summaryMatch) { summary = summaryMatch[1].trim(); text = text.replace(summaryMatch[0], ''); }
    if (text.indexOf('[REFLECTION_COMPLETE]') !== -1) { complete = true; text = text.replace('[REFLECTION_COMPLETE]', ''); }
    return { text: stripAsteriskEmphasis(text.trim()), name: name, complete: complete, summary: summary, fields: fields };
  }
  function validateDeliverable(parsed, config) {
    var missing = [];
    var data = parsed.fields || {};
    (config.fields || []).forEach(function (f) {
      var label = f.label || f.key;
      var val = data[f.key];
      if (f.type === 'list') {
        var required = f.count || 3;
        var have = Array.isArray(val) ? val.length : 0;
        if (have < required) missing.push((required - have) + ' more ' + label + (required - have === 1 ? '' : 's'));
        (val || []).forEach(function (item, i) {
          if (Array.isArray(f.parts) && f.parts.length) {
            var incomplete = f.parts.some(function (p) { return !item || !item[p]; });
            if (incomplete) missing.push('a complete ' + label + ' ' + (i + 1) + ' (some parts were left blank)');
          } else if (!item) missing.push('a complete ' + label + ' ' + (i + 1));
        });
      } else if (!val) missing.push('the ' + label + ' itself');
    });
    return { valid: missing.length === 0, missing: missing };
  }

  // ----------------------------------------------------------
  // CHAT UI
  // ----------------------------------------------------------
  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }
  function addMessage(role, text) {
    var row = el('div', 'sh-msg-row sh-' + role);
    mount(row, el('div', 'sh-msg-bubble', text));
    mount(messagesEl, row);
    scrollToBottom();
  }
  function addDivider(text) {
    mount(messagesEl, el('div', 'sh-msg-divider', '\u2014 ' + text + ' \u2014'));
    scrollToBottom();
  }
  var typingRow = null;
  function showTyping() {
    typingRow = el('div', 'sh-msg-row sh-assistant');
    var bubble = el('div', 'sh-msg-bubble');
    var dots = el('div', 'sh-typing');
    for (var i = 0; i < 3; i++) mount(dots, document.createElement('span'));
    mount(bubble, dots);
    mount(typingRow, bubble);
    mount(messagesEl, typingRow);
    scrollToBottom();
  }
  function hideTyping() {
    if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
    typingRow = null;
  }
  function setBusy(state) { busy = state; sendBtn.disabled = state || poolExhausted; }

  function saveTranscript() {
    if (!STUDENT_ID || !conversationId) return;
    fetch(PROXY_URL + '/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: STUDENT_ID,
        lesson: lessonKey(SESSION.layers[currentLayerIndex].layerNumber),
        conversationId: conversationId,
        history: conversationHistory,
        studentName: studentName,
        reflectionComplete: false
      })
    }).catch(function () {});
  }
  function reportLayerComplete(summaryText) {
    if (!STUDENT_ID) return;
    var body = { studentId: STUDENT_ID, lesson: lessonKey(SESSION.layers[currentLayerIndex].layerNumber), summary: summaryText || null };
    if (lastDeliverable) body.deliverable = lastDeliverable;
    fetch(PROXY_URL + '/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(function () {});
  }

  var CONTEXT_BLOCK_CACHE = null;
  function getContextBlock(callback) {
    if (CONTEXT_BLOCK_CACHE !== null) { callback(CONTEXT_BLOCK_CACHE); return; }
    fetchProjectData(function (project) {
      fetchIdeaLogEntries(function (ideaLog) {
        fetchTasks(function (tasks) {
          fetchGlobalInstructions(function (globalInstructions) {
            fetchCoachingPhilosophy(SESSION.track || 'excavation', function (coachingPhilosophy) {
              CONTEXT_BLOCK_CACHE = buildProjectContextBlock(project, ideaLog, tasks, globalInstructions, coachingPhilosophy);
              callback(CONTEXT_BLOCK_CACHE);
            });
          });
        });
      });
    });
  }

  function retryForDeliverable(missing) {
    deliverableRetryCount++;
    var note = '\u200B[STRATUM_INTERNAL_RETRY] The deliverable is not yet complete: still missing ' + missing.join('; ') + '. ' +
      'Do not mention this note or that anything went wrong. Simply continue the conversation naturally - ask the next question needed to get what is missing. ' +
      'Do not emit the deliverable field, SUMMARY, or REFLECTION_COMPLETE tags again until everything is genuinely complete.';
    conversationHistory.push({ role: 'user', content: note });
    saveTranscript();
    sendToClaude();
  }

  function sendToClaude() {
    setBusy(true);
    showTyping();
    getContextBlock(function (contextBlock) {
      var body = {
        model: MODEL,
        max_tokens: 1000,
        system: buildSystemPrompt(contextBlock),
        messages: conversationHistory
      };
      if (STUDENT_ID) {
        body.stratum = { studentId: STUDENT_ID, conversationId: conversationId, lesson: lessonKey(SESSION.layers[currentLayerIndex].layerNumber), email: WP_USER.email || null };
      }
      fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          data = data || {};
          if (data.stratum_error === 'pool_exhausted') { hideTyping(); setBusy(false); poolExhausted = true; addMessage('assistant', 'You\u2019ve used all your coaching sessions for now. Message Ted and he\u2019ll sort it out.'); return; }
          if (data.stratum_error === 'account_suspended') { hideTyping(); setBusy(false); addMessage('assistant', 'Something\u2019s wrong with the access on this account. Send a message and it will get sorted out.'); return; }
          var block = (data.content || []).find(function (b) { return b.type === 'text'; });
          var raw = block ? block.text : 'I lost my train of thought there for a second. Could you say that again?';
          var parsed = extractTags(raw);
          var deliverableConfig = getDeliverableConfig();
          if (parsed.complete && deliverableConfig) {
            var check = validateDeliverable(parsed, deliverableConfig);
            if (!check.valid && deliverableRetryCount < MAX_DELIVERABLE_RETRIES) {
              hideTyping();
              if (parsed.name) { studentName = parsed.name; }
              conversationHistory.push({ role: 'assistant', content: raw });
              if (parsed.text) addMessage('assistant', parsed.text);
              saveTranscript();
              retryForDeliverable(check.missing);
              return;
            }
            if (!check.valid) { parsed.complete = false; }
            else { lastDeliverable = { fields: parsed.fields }; }
          }
          hideTyping();
          setBusy(false);
          if (parsed.name) studentName = parsed.name;
          conversationHistory.push({ role: 'assistant', content: raw });
          addMessage('assistant', parsed.text);
          saveTranscript();
          if (parsed.complete) {
            reportLayerComplete(parsed.summary);
            advanceOrFinish();
          }
        })
        .catch(function () {
          hideTyping();
          setBusy(false);
          addMessage('assistant', 'Hang on - I lost the connection for a second. Mind sending that again?');
        });
    });
  }

  // ----------------------------------------------------------
  // RECURRING CHECK-IN ENGINE (General/Writing tracks — Sept 2026)
  // ----------------------------------------------------------
  // Parallel to buildSystemPrompt()/sendToClaude() above, deliberately
  // kept SEPARATE rather than woven into those with conditionals — the
  // two engines diverge enough (no deliverable, no fixed completion, a
  // running history instead of a synthesis) that sharing one function
  // risked destabilizing the working Excavation flow. Reuses the same
  // NAME/SUMMARY/REFLECTION_COMPLETE tag mechanics (still code-owned,
  // same reasoning as buildSystemPrompt) and the same extractTags()/
  // addMessage()/getContextBlock() plumbing.
  function buildRecurringSystemPrompt(contextBlock, checkinHistoryText) {
    var layer = SESSION.layers[currentLayerIndex];
    var rf = LAYER_CONFIG.reflectionFramework;
    var areasList = rf.areas || [];
    var isLegacyArea = areasList.length && areasList[0].whatToSurface == null && areasList[0].technique == null && areasList[0].instructions != null;
    var areas;
    if (isLegacyArea) {
      areas = areasList.map(function (area, i) {
        return 'AREA ' + (i + 1) + ' - ' + area.title + '\n' + area.instructions;
      }).join('\n\n');
    } else {
      areas = areasList.map(function (area, i) {
        var lines = ['AREA ' + (i + 1) + ' - ' + area.title];
        if (area.whatToSurface) lines.push('What to surface: ' + area.whatToSurface);
        if (area.technique) lines.push('Technique: ' + area.technique);
        if (area.exitSignal) lines.push('What genuinely complete looks like: ' + area.exitSignal);
        var areaCal = Array.isArray(area.calibrationExamples) ? area.calibrationExamples : [];
        if (areaCal.length) {
          lines.push('Calibration for this area:');
          areaCal.forEach(function (ex) {
            if (ex.title) lines.push('  - ' + ex.title);
            if (ex.weak) lines.push('    Weak (stop here): ' + ex.weak);
            if (ex.strong) lines.push('    Strong (this passes): ' + ex.strong);
            if (ex.note) lines.push('    Coaching note: ' + ex.note);
          });
        }
        return lines.join('\n');
      }).join('\n\n');
    }
    var workedExamples = (Array.isArray(LAYER_CONFIG.workedExamples) ? LAYER_CONFIG.workedExamples : []).map(function (ex) {
      var lines = [];
      if (ex.label) lines.push(ex.label + ':');
      if (ex.script) lines.push(ex.script);
      if (ex.note) lines.push('Why this works: ' + ex.note);
      return lines.join('\n');
    }).join('\n\n---\n\n');
    var scopeNote = LAYER_CONFIG.scopeNote || layer.label;
    var parts = [
      'You are a professional writing coach, live, in a real one-on-one coaching conversation about "' + layer.label + '", part of the ongoing ' + SESSION.title + ' coaching relationship on The Stratum Method. You have no name and no personal biography - you are simply an experienced, well-trained coach who works with fiction writers on their own work, using the Socratic method: you draw the person\u2019s own answers out of them, you never supply the answer yourself. This is who you are in this conversation: warm, direct, genuinely curious about this specific person, unhurried.',
      'STAY IN VOICE: Speak only in first person as this coach, for the entire conversation. If the person sincerely and directly asks whether they are talking to a real person or an AI, answer honestly and briefly - you are an AI coach trained in the Socratic method, not a human live - then gently continue the conversation.',
      'CRITICAL FORMATTING RULE: Never wrap any word in asterisks for emphasis - this chat renders plain text only, so *anything like this* appears to the person as literal asterisks. If a word needs emphasis, use plain phrasing or sentence rhythm instead.',
      'THIS IS A RECURRING CHECK-IN, NOT A ONE-TIME SESSION: Unlike Stratum\u2019s Excavation coaching, this topic has no fixed completion and no required deliverable. The person may return to it many times over weeks or months. Each visit is a genuinely fresh conversation - you do not remember the literal back-and-forth of past visits, only the summaries below - so treat this as picking up an ongoing relationship, not starting from zero and not pretending to recall exact wording you were never given.',
      'WHAT THIS TOPIC COVERS (' + scopeNote + ')' + (SESSION.transcript ? ':\n"""\n' + SESSION.transcript + '\n"""' : '.'),
      'WHAT THIS CONVERSATION IS FOR:\nThis single, continuous, natural conversation is a check-in on ' + layer.label + '. Draw on the areas below - in whatever order the conversation naturally takes - as a guide to what\u2019s worth exploring, not a checklist that must all be covered before you can close:\n\n' + areas
    ];
    if (workedExamples) {
      parts.push('WORKED EXAMPLES - HOW A WELL-TRAINED COACH HANDLES MOMENTS LIKE THESE - NEVER SHOWN OR QUOTED TO THE PERSON:\n' + workedExamples);
    }
    if (contextBlock) parts.push(contextBlock);
    if (checkinHistoryText) {
      parts.push('PREVIOUS CHECK-INS - PRIVATE, NEVER SHOWN TO THE PERSON, use naturally for continuity ("last time you mentioned...") without reciting this list verbatim or treating it as a script:\n' + checkinHistoryText);
    }
    if (isLegacyArea === false && rf.coachingApproach) {
      parts.push('ADDITIONAL GUIDANCE FOR THIS TOPIC (legacy, not yet sorted into individual areas) - PRIVATE, NEVER SHOWN TO THE PERSON:\n' + rf.coachingApproach);
    }
    parts.push(
      'HOW YOU DRAW THESE OUT - MOTIVATIONAL INTERVIEWING, NOT INTERROGATION:\nUse the spirit of motivational interviewing: ask open questions, reflect back what they say before moving forward, offer genuine affirmation when something costs them something to say, summarize periodically.',
      'THE DEPTH RULE:\nIf an answer is generic or surface-level, reflect it back gently and ask ONE specific follow-up inviting more. If they are still on the surface after that one gentle nudge, accept where they are and move on. Never let a surface answer pass completely unremarked, but never turn this into an interrogation.',
      'WHAT YOU NEVER DO:\nNever write their reflection for them. Never diagnose them or their psychology. Stay descriptive and curious, not clinical.'
    );
    var legacyCal = (isLegacyArea === false && Array.isArray(rf.calibrationExamples) && rf.calibrationExamples.length) ? rf.calibrationExamples : null;
    if (legacyCal) {
      var legacyCalText = legacyCal.map(function (ex) {
        if (typeof ex === 'string') return '- ' + ex;
        var lines = [];
        if (ex.title) lines.push('- ' + ex.title);
        if (ex.weak) lines.push('  Weak (stop here): ' + ex.weak);
        if (ex.strong) lines.push('  Strong (this passes): ' + ex.strong);
        if (ex.note) lines.push('  Coaching note: ' + ex.note);
        return lines.join('\n');
      }).join('\n');
      parts.push('ADDITIONAL CALIBRATION (legacy, not yet sorted into individual areas) - NEVER SHOW OR QUOTE THESE TO THE PERSON:\n' + legacyCalText);
    }
    parts.push(
      'GETTING THEIR NAME:\nYou have already greeted the person before this conversation history begins. If you did not already know their name, their reply should contain it. The very first time you learn their name, begin your reply with a hidden tag on its own line, exactly: [NAME: Their Name] - then continue your reply below it. Only include this tag once.',
      'STYLE:\nWrite the way a real person talks in a warm one-on-one conversation. Keep replies short: two to five sentences. Ask ONE question at a time. Never use markdown formatting of any kind, including asterisks for emphasis.',
      'WRAPPING UP:\nOnce the check-in feels naturally complete - the person has said what they came to say and gotten what they needed - bring it to a warm, brief close. There is no fixed list that must all be covered first; use judgment. Immediately before your closing sentence, include a hidden tag: [SUMMARY: One plain sentence, third person, under twenty words, capturing what this check-in was about and anything useful to remember next time.] - never shown to the person. End with the exact tag [REFLECTION_COMPLETE] on its own line at the very end.'
    );
    return parts.join('\n\n');
  }

  function sendRecurringMessage() {
    setBusy(true);
    showTyping();
    getContextBlock(function (contextBlock) {
      var historyText = ALL_CHECKIN_NOTES.map(function (n) {
        var when = n.createdAt ? new Date(n.createdAt.indexOf('Z') === -1 ? n.createdAt.replace(' ', 'T') + 'Z' : n.createdAt).toLocaleDateString() : '';
        return '[' + when + (n.layerLabel ? ' \u2014 ' + n.layerLabel : '') + '] ' + n.note;
      }).join('\n');
      var body = {
        model: MODEL,
        max_tokens: 1000,
        system: buildRecurringSystemPrompt(contextBlock, historyText),
        messages: conversationHistory
      };
      var layer = SESSION.layers[currentLayerIndex];
      if (STUDENT_ID) {
        body.stratum = { studentId: STUDENT_ID, conversationId: conversationId, lesson: lessonKey(layer.layerNumber), email: WP_USER.email || null };
      }
      fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          data = data || {};
          if (data.stratum_error === 'pool_exhausted') { hideTyping(); setBusy(false); poolExhausted = true; addMessage('assistant', 'You\u2019ve used all your coaching sessions for now. Message Ted and he\u2019ll sort it out.'); return; }
          if (data.stratum_error === 'account_suspended') { hideTyping(); setBusy(false); addMessage('assistant', 'Something\u2019s wrong with the access on this account. Send a message and it will get sorted out.'); return; }
          var block = (data.content || []).find(function (b) { return b.type === 'text'; });
          var raw = block ? block.text : 'I lost my train of thought there for a second. Could you say that again?';
          var parsed = extractTags(raw);
          hideTyping();
          setBusy(false);
          if (parsed.name) studentName = parsed.name;
          conversationHistory.push({ role: 'assistant', content: raw });
          addMessage('assistant', parsed.text);
          if (parsed.complete) {
            var note = parsed.summary || 'Check-in completed.';
            postCheckinNote(SESSION.slug, layer.layerNumber, layer.label, note, function () {
              ALL_CHECKIN_NOTES.push({ layerNumber: layer.layerNumber, layerLabel: layer.label, note: note, createdAt: new Date().toISOString() });
              returnToTopicList();
            });
          }
        })
        .catch(function () {
          hideTyping();
          setBusy(false);
          addMessage('assistant', 'Hang on - I lost the connection for a second. Mind sending that again?');
        });
    });
  }

  function handleSend() {
    if (busy || poolExhausted) return;
    var val = inputEl.value.trim();
    if (!val) return;
    addMessage('user', val);
    conversationHistory.push({ role: 'user', content: val });
    inputEl.value = '';
    inputEl.style.height = 'auto';
    if (ENGINE_MODE === 'excavation') {
      saveTranscript();
      sendToClaude();
    } else {
      sendRecurringMessage();
    }
  }

  function buildChatPanel(container) {
    var panel = el('div', 'sh-coach-panel');
    messagesEl = el('div', 'sh-coach-messages');
    mount(panel, messagesEl);
    formEl = document.createElement('form');
    formEl.className = 'sh-coach-form';
    inputEl = document.createElement('textarea');
    inputEl.className = 'sh-coach-input';
    inputEl.placeholder = 'Type your reply...';
    inputEl.rows = 1;
    mount(formEl, inputEl);
    sendBtn = el('button', 'sh-coach-send', '\u2192');
    sendBtn.type = 'submit';
    mount(formEl, sendBtn);
    mount(panel, formEl);
    mount(container, panel);

    formEl.addEventListener('submit', function (e) { e.preventDefault(); handleSend(); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    inputEl.addEventListener('input', function () {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });
  }

  // ----------------------------------------------------------
  // LAYER LOADING / BOOTING / ADVANCING
  // ----------------------------------------------------------
  // Every layer completion/transcript/synthesis input is keyed server-side
  // as "excavationSlug:layerNumber" (see worker.js) — a plain layer number
  // alone isn't unique across excavations, since Character Excavation's
  // Layer 1 and a future Worldbuilding's Layer 1 are different things.
  function lessonKey(layerNumber) {
    return SESSION.slug + ':' + layerNumber + (SELECTED_CHARACTER ? ':' + SELECTED_CHARACTER.id : '');
  }

  function loadLayerConfig(layerNumber, callback) {
    fetch(PROXY_URL + '/excavation-layer?excavationSlug=' + encodeURIComponent(SESSION.slug) + '&layerNumber=' + layerNumber + '&lang=' + encodeURIComponent(LANG))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known || !d.config) { callback(null); return; }
        var cfg = d.config;
        cfg.scopeNote = cfg.scopeNote || '';
        cfg.reflectionFramework = cfg.reflectionFramework || { areas: [], calibrationExamples: [] };
        cfg.greeting = cfg.greeting || {};
        callback(cfg);
      })
      .catch(function () { callback(null); });
  }

  function getGreetingText(knownName) {
    var g = LAYER_CONFIG.greeting || {};
    var template = knownName ? (g.knownTemplate || g.fresh) : g.fresh;
    if (!template) {
      return knownName
        ? 'Hey ' + knownName + ' - good to have you back. Let\u2019s pick up where we left off.'
        : 'Hey - let\u2019s get started. What\u2019s your name?';
    }
    if (knownName) return template.indexOf('{name}') !== -1 ? template.replace('{name}', knownName) : template;
    return template.replace(/,?\s*\{name\}/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  function resetSessionState() {
    conversationHistory = [];
    conversationId = makeId();
    lastDeliverable = null;
    deliverableRetryCount = 0;
    messagesEl.innerHTML = '';
  }

  function bootLayer(index, showDivider) {
    currentLayerIndex = index;
    renderRail();
    var layer = SESSION.layers[index];
    loadLayerConfig(layer.layerNumber, function (cfg) {
      if (!cfg) {
        addMessage('assistant', 'This layer hasn\u2019t been set up yet. Let Ted know.');
        return;
      }
      LAYER_CONFIG = cfg;
      resetSessionState();
      if (showDivider) addDivider(layer.label);
      var knownName = studentName;
      var primerText = knownName
        ? "Begin the session. The student's name is already known: " + knownName + '. Do not ask for their name again - greet them by name and move straight into the first area.'
        : 'Begin the session.';
      var greetingText = getGreetingText(knownName);
      conversationHistory.push({ role: 'user', content: primerText });
      conversationHistory.push({ role: 'assistant', content: greetingText });
      addMessage('assistant', greetingText);
      saveTranscript();
    });
  }

  function advanceOrFinish() {
    var layer = SESSION.layers[currentLayerIndex];
    completedLayerIds[lessonKey(layer.layerNumber)] = true;
    var nextIndex = currentLayerIndex + 1;
    if (nextIndex < SESSION.layers.length) {
      bootLayer(nextIndex, true);
    } else {
      renderRail();
      synthesizeMasterDeliverable();
    }
  }

  // ----------------------------------------------------------
  // MASTER SYNTHESIS (end of session)
  // ----------------------------------------------------------
  function synthesizeMasterDeliverable() {
    contentEl.innerHTML = '';
    mount(contentEl, el('div', 'sh-coach-loading', 'Bringing together everything you\u2019ve excavated\u2026'));
    var charParam = SELECTED_CHARACTER ? '&characterId=' + encodeURIComponent(SELECTED_CHARACTER.id) : '';
    fetch(PROXY_URL + '/excavation/master-deliverable?studentId=' + encodeURIComponent(STUDENT_ID) + '&excavationSlug=' + encodeURIComponent(SESSION.slug) + charParam)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.known && d.text) { renderSynthesisCard(d.text); return; }
        var body = { studentId: STUDENT_ID, excavationSlug: SESSION.slug, lang: LANG };
        if (SELECTED_CHARACTER) body.characterId = SELECTED_CHARACTER.id;
        return fetch(PROXY_URL + '/excavation/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
          .then(function (r2) { return r2.json(); })
          .then(function (d2) {
            if (d2 && d2.ok && d2.text) renderSynthesisCard(d2.text);
            else contentEl.innerHTML = '<div class="sh-coach-loading">Couldn\u2019t generate your synthesis right now. Refresh to try again.</div>';
          });
      })
      .catch(function () {
        contentEl.innerHTML = '<div class="sh-coach-loading">Couldn\u2019t load your synthesis right now. Refresh to try again.</div>';
      });
  }
  function renderSynthesisCard(text) {
    contentEl.innerHTML = '';
    var card = el('div', 'sh-synthesis-card');
    mount(card, el('div', 'sh-synthesis-title', SESSION.title + ' \u2014 Complete'));
    var layerCount = SESSION.layers.length;
    mount(card, el('p', 'sh-synthesis-sub', studentName ? ('Nice work, ' + studentName + '. All ' + layerCount + ' layers are excavated.') : ('All ' + layerCount + ' layers are excavated.')));
    var body = el('div', 'sh-synthesis-text');
    body.innerHTML = textToParagraphs(text);
    mount(card, body);
    var dlBtn = el('button', 'sh-synthesis-download', 'Download');
    dlBtn.type = 'button';
    dlBtn.addEventListener('click', function () { downloadSynthesis(text); });
    mount(card, dlBtn);
    mount(contentEl, card);
  }
  function downloadSynthesis(text) {
    var dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    var who = studentName || 'Student';
    var txt = SESSION.title.toUpperCase() + ' \u2014 COMPLETE PROFILE\n' + who + ' \u2014 ' + dateStr + '\n' +
      '==========================================\n\n' + text;
    var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = SESSION.title.replace(/\s+/g, '-') + '-' + who.replace(/\s+/g, '-') + '.txt';
    link.click();
  }

  // ----------------------------------------------------------
  // RESUME-IN-PROGRESS
  // ----------------------------------------------------------
  function loadProgressThenStart() {
    if (!SESSION.layers.length) {
      // No layers saved for this excavation yet - without this guard,
      // the "are all layers complete?" check below is vacuously true
      // for an empty list (0 of 0), which sent this straight into
      // synthesizeMasterDeliverable() with nothing to synthesize -
      // producing a confusing "Couldn't generate your synthesis right
      // now" error on a session that was simply never set up yet.
      contentEl.innerHTML = '';
      mount(contentEl, el('div', 'sh-coach-loading', 'This excavation doesn\u2019t have any layers set up yet. Check back soon.'));
      return;
    }
    fetch(PROXY_URL + '/completions?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var completions = (d && d.completions) ? d.completions : [];
        completedLayerIds = {};
        completions.forEach(function (c) { completedLayerIds[c.lesson] = true; });
        var firstIncomplete = -1;
        for (var i = 0; i < SESSION.layers.length; i++) {
          if (!completedLayerIds[lessonKey(SESSION.layers[i].layerNumber)]) { firstIncomplete = i; break; }
        }
        if (firstIncomplete === -1) {
          renderRail();
          synthesizeMasterDeliverable();
        } else {
          bootLayer(firstIncomplete, false);
        }
      })
      .catch(function () {
        bootLayer(0, false);
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
    var shell = el('div', 'sh-wrap');
    if (window.StratumHeader) window.StratumHeader.buildTopbar(shell);

    var page = el('div', 'sh-coach-page');
    mount(page, el('h1', 'sh-coach-title', SESSION.title || ''));
    var charIndicatorSlot = el('div');
    mount(page, charIndicatorSlot);
    var videoOuter = el('div', 'sh-coach-video-outer');
    var videoSlot = el('div');
    videoSlot.id = 'shCoachVideoSlot';
    mount(videoOuter, videoSlot);
    mount(page, videoOuter);

    var introSlot = el('div');
    introSlot.id = 'shCoachIntroSlot';
    mount(page, introSlot);

    var body = el('div', 'sh-coach-body');
    railEl = el('div', 'sh-rail');
    mount(body, railEl);
    contentEl = el('div');
    mount(body, contentEl);
    mount(page, body);

    mount(shell, page);      // <-- was mounted to `container` directly before, as a SIBLING of the
    mount(container, shell); //     dark card rather than inside it — that's why the page background
                              //     showed white beneath/around the video and rail.

    if (SESSION.videoMediaId) buildVideo(videoSlot, SESSION.videoMediaId);
    if (SESSION.coachingIntro && SESSION.coachingIntro.text) buildCoachingIntro(introSlot, SESSION.coachingIntro);

    if (SESSION.requiresCharacter) {
      resolveCharacterThenStart(contentEl, charIndicatorSlot);
    } else {
      startExcavationProper();
    }
  }

  function startExcavationProper() {
    buildChatPanel(contentEl);
    renderRail();
    loadProgressThenStart();
  }

  // ----------------------------------------------------------
  // CHARACTER PICKER — excavations with requiresCharacter true
  // ----------------------------------------------------------
  // Some excavations (Character Excavation; not World Building, Plot,
  // etc.) run once PER CHARACTER, not once per student — a writer can
  // excavate their protagonist, then separately come back and excavate
  // their antagonist, with genuinely separate progress (see
  // SELECTED_CHARACTER, lessonKey(), and the character context block
  // in buildSystemPrompt()). This gate runs before anything else so
  // every save from this point on threads the right character through.
  //
  // Sept 2026: once picked, the character is LOCKED for this browser
  // tab via sessionStorage (not localStorage - this is deliberately
  // per-tab, not a standing preference) so a mid-session reload, back-
  // button, or any other ordinary navigation resumes the SAME character
  // silently rather than re-showing the picker and risking an
  // accidental switch partway through a layer. The only way to change
  // characters is the explicit "Switch character" link the indicator
  // shows once one is selected - intentional, never accidental.
  var CHAR_LOCK_PREFIX = 'stratum_char_';
  function sessGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function sessSet(key, value) { try { sessionStorage.setItem(key, value); } catch (e) {} }
  function sessRemove(key) { try { sessionStorage.removeItem(key); } catch (e) {} }

  function showCharacterIndicator(slot) {
    slot.innerHTML = '';
    var line = el('p', 'sh-coach-sub');
    line.appendChild(document.createTextNode('Excavating: ' + (SELECTED_CHARACTER.name || 'this character') + '  \u00b7  '));
    var switchLink = document.createElement('a');
    switchLink.href = '#';
    switchLink.className = 'sh-char-switch-link';
    switchLink.textContent = 'Switch character';
    switchLink.addEventListener('click', function (e) {
      e.preventDefault();
      sessRemove(CHAR_LOCK_PREFIX + SESSION.slug);
      location.reload();
    });
    line.appendChild(switchLink);
    mount(slot, line);
  }

  function resolveCharacterThenStart(container, indicatorSlot) {
    container.innerHTML = '';
    mount(container, el('div', 'sh-coach-loading', 'Loading your characters\u2026'));
    fetchProjectData(function (project) {
      var characters = (project && Array.isArray(project.characters)) ? project.characters.filter(function (c) { return c.name; }) : [];
      var lockedId = sessGet(CHAR_LOCK_PREFIX + SESSION.slug);
      var locked = lockedId ? characters.filter(function (c) { return c.id === lockedId; })[0] : null;
      if (locked) {
        // Resuming this tab's already-locked character - skip the
        // picker entirely, no prompt, no chance to pick a different one.
        SELECTED_CHARACTER = locked;
        showCharacterIndicator(indicatorSlot);
        startExcavationProper();
        return;
      }
      container.innerHTML = '';
      if (!characters.length) {
        var empty = el('div', 'sh-coach-page');
        mount(empty, el('p', null, 'This excavation is done one character at a time, and there\u2019s no character in your profile yet to excavate. Add one, then come back here.'));
        var link = document.createElement('a');
        link.className = 'sh-save-btn';
        link.href = '/system/';
        link.textContent = '\u2190 Add a character';
        mount(empty, link);
        mount(container, empty);
        return;
      }
      var wrap = el('div', 'sh-recurring-topics');
      mount(container, el('p', 'sh-coach-sub', 'Who is this excavation for? Once you start, this stays locked to that character for this session.'));
      characters.forEach(function (c) {
        var row = el('div', 'sh-recurring-topic-row');
        row.addEventListener('click', function () {
          SELECTED_CHARACTER = c;
          sessSet(CHAR_LOCK_PREFIX + SESSION.slug, c.id);
          showCharacterIndicator(indicatorSlot);
          startExcavationProper();
        });
        mount(row, el('div', 'sh-recurring-topic-title', c.name));
        var metaBits = [c.type, c.roleType].filter(Boolean);
        mount(row, el('div', 'sh-recurring-topic-meta', metaBits.join(' \u00b7 ') || '\u00a0'));
        mount(wrap, row);
      });
      mount(container, wrap);
    });
  }

  // ----------------------------------------------------------
  // RECURRING CHECK-IN PAGE (General/Writing tracks)
  // ----------------------------------------------------------
  // No video slot, no strata rail, no locked sequence — every topic
  // (Layer) is always available, since this engine has no fixed
  // progression. Instead: a topic list showing each topic's check-in
  // count and how recently it was visited, and clicking one opens a
  // fresh conversation with the full history of past check-ins across
  // every topic in this session type injected as context.
  function buildRecurringPage(container) {
    var shell = el('div', 'sh-wrap');
    if (window.StratumHeader) window.StratumHeader.buildTopbar(shell);

    var page = el('div', 'sh-coach-page');
    mount(page, el('h1', 'sh-coach-title', SESSION.title || ''));
    mount(page, el('p', 'sh-coach-sub', 'Pick a topic to start a check-in. Each visit is a fresh conversation \u2014 your coach carries everything forward from before.'));

    if (SESSION.coachingIntro && SESSION.coachingIntro.text) {
      var introSlot = el('div');
      mount(page, introSlot);
      buildCoachingIntro(introSlot, SESSION.coachingIntro);
    }

    topicListEl = el('div', 'sh-recurring-topics');
    mount(page, topicListEl);

    var chatOuter = el('div');
    chatOuter.id = 'shRecurringChatOuter';
    chatOuter.style.display = 'none';
    mount(page, chatOuter);

    mount(shell, page);
    mount(container, shell);

    fetchCheckinNotes(SESSION.slug, function (notes) {
      ALL_CHECKIN_NOTES = notes;
      renderTopicList();
    });
  }

  function formatRelativeDate(iso) {
    if (!iso) return '';
    var d = new Date(iso.indexOf('Z') === -1 ? iso.replace(' ', 'T') + 'Z' : iso);
    if (isNaN(d.getTime())) return '';
    var days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return days + ' days ago';
    var weeks = Math.floor(days / 7);
    if (weeks === 1) return '1 week ago';
    if (weeks < 5) return weeks + ' weeks ago';
    return d.toLocaleDateString();
  }

  function renderTopicList() {
    topicListEl.innerHTML = '';
    if (!SESSION.layers.length) {
      mount(topicListEl, el('div', 'sh-coach-loading', 'This session doesn\u2019t have any topics set up yet. Check back soon.'));
      return;
    }
    SESSION.layers.forEach(function (layer, i) {
      var layerNotes = ALL_CHECKIN_NOTES.filter(function (n) { return n.layerNumber === layer.layerNumber; });
      var row = el('div', 'sh-recurring-topic-row');
      row.addEventListener('click', function () { startCheckin(i); });
      mount(row, el('div', 'sh-recurring-topic-title', layer.label));
      var meta = layerNotes.length
        ? (layerNotes.length + ' check-in' + (layerNotes.length === 1 ? '' : 's') + ' \u00b7 last ' + formatRelativeDate(layerNotes[layerNotes.length - 1].createdAt))
        : 'No check-ins yet';
      mount(row, el('div', 'sh-recurring-topic-meta', meta));
      mount(topicListEl, row);
    });
  }

  function startCheckin(layerIndex) {
    currentLayerIndex = layerIndex;
    var layer = SESSION.layers[layerIndex];
    loadLayerConfig(layer.layerNumber, function (cfg) {
      if (!cfg) { alert('This topic isn\u2019t set up yet.'); return; }
      LAYER_CONFIG = cfg;
      var chatOuter = document.getElementById('shRecurringChatOuter');
      chatOuter.innerHTML = '';
      chatOuter.style.display = '';
      topicListEl.style.display = 'none';
      var backLink = document.createElement('a');
      backLink.href = '#';
      backLink.className = 'sh-recurring-back';
      backLink.textContent = '\u2190 Back to topics';
      backLink.addEventListener('click', function (e) { e.preventDefault(); returnToTopicList(); });
      mount(chatOuter, backLink);
      mount(chatOuter, el('h2', 'sh-recurring-topic-heading', layer.label));
      buildChatPanel(chatOuter);
      resetSessionState();
      var knownName = studentName;
      var primerText = knownName
        ? "Begin the check-in. The student's name is already known: " + knownName + '. Do not ask for their name again - greet them by name and move straight in.'
        : 'Begin the check-in.';
      var greetingText = getGreetingText(knownName);
      conversationHistory.push({ role: 'user', content: primerText });
      conversationHistory.push({ role: 'assistant', content: greetingText });
      addMessage('assistant', greetingText);
    });
  }

  function returnToTopicList() {
    var chatOuter = document.getElementById('shRecurringChatOuter');
    chatOuter.style.display = 'none';
    chatOuter.innerHTML = '';
    topicListEl.style.display = '';
    renderTopicList();
  }

  // "Before You Begin" — the same admin-authored coaching intro field the
  // old per-lesson engine showed (Coaching Intro Text in the Stratum
  // admin), rendered once above the chat panel using the SESSION's first
  // layer's intro. Collapsible, closed by default, matching the admin
  // panel's own "default closed" framing for this field.
  function buildCoachingIntro(container, intro) {
    var details = document.createElement('details');
    details.className = 'sh-coach-intro';
    var summary = document.createElement('summary');
    summary.textContent = intro.title || 'Before You Begin';
    mount(details, summary);
    var body = el('div', 'sh-coach-intro-body');
    body.innerHTML = textToParagraphs(intro.text);
    mount(details, body);
    mount(container, details);
  }

  function init() {
    var container = document.getElementById('stratum-coach');
    if (!container) {
      console.error('[Stratum] No #stratum-coach container found on this page.');
      return;
    }
    var slug = window.STRATUM_SESSION_SLUG || '';
    if (!window.StratumSessions) {
      buildGate(container, 'This coaching session hasn\u2019t been configured yet.', '/system/', '\u2190 Back to Dashboard');
      return;
    }
    window.StratumSessions.ready(function () {
      SESSION = window.StratumSessions.get(slug);
      if (!SESSION) {
        buildGate(container, 'This coaching session hasn\u2019t been configured yet.', '/system/', '\u2190 Back to Dashboard');
        return;
      }
      if (!WP_USER.loggedIn) {
        buildGate(container, 'Please log in to start this coaching session.', WP_USER.loginUrl, 'Log in');
        return;
      }
      if (!WP_USER.hasMembership) {
        buildGate(container, 'Your account doesn\u2019t have an active Stratum Method membership yet.', '/membership-account/', 'Go to My Account');
        return;
      }
      window.StratumIdentity.init(function (studentId) {
        if (!studentId) {
          buildGate(container, 'Could not connect your account. Refresh and try again.', '/system/', '\u2190 Back to Dashboard');
          return;
        }
        STUDENT_ID = studentId;
        ENGINE_MODE = SESSION.track || 'excavation';
        if (ENGINE_MODE === 'excavation') {
          buildPage(container);
        } else {
          buildRecurringPage(container);
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
