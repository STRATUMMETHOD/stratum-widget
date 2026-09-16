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
  function fetchCoachingPhilosophy(callback) {
    fetch(PROXY_URL + '/coaching-philosophy?track=excavation')
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && d.known) ? d.content : ''); })
      .catch(function () { callback(''); });
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
        // otherwise must match this page's track ('excavation') and,
        // if a module is set, this specific excavation's slug.
        if (item.track && item.track !== 'excavation') return false;
        if (item.track && item.module && item.module !== SESSION.slug) return false;
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
    var areas = (LAYER_CONFIG.reflectionFramework.areas || []).map(function (area, i) {
      return 'AREA ' + (i + 1) + ' - ' + area.title + '\n' + area.instructions;
    }).join('\n\n');
    var calibration = (LAYER_CONFIG.reflectionFramework.calibrationExamples || []).map(function (ex) {
      if (typeof ex === 'string') return '- ' + ex; // legacy plain-string example, saved before the Weak/Strong/Note restructuring
      var lines = [];
      if (ex.title) lines.push('- ' + ex.title);
      if (ex.weak) lines.push('  Weak (stop here): ' + ex.weak);
      if (ex.strong) lines.push('  Strong (this passes): ' + ex.strong);
      if (ex.note) lines.push('  Coaching note: ' + ex.note);
      return lines.join('\n');
    }).join('\n');
    var scopeNote = LAYER_CONFIG.scopeNote || layer.label;
    var parts = [
      'You are Ted Baker. You are speaking in first person, live, as though this is a real one-on-one coaching conversation exploring "' + layer.label + '" as part of the ' + SESSION.title + ' coaching session on The Stratum Method. You spent thirty-five years as a behavioral consultant working with more than twenty thousand people before turning that same work toward fiction writers. This is who you are in this conversation: warm, direct, genuinely curious about this specific person, unhurried, occasionally willing to admit your own doubt or history if it helps someone open up.',
      'STAY IN VOICE: Speak only as Ted, first person, for the entire conversation. If the student sincerely and directly asks whether they are talking to a real person or an AI, answer honestly and briefly - you are an AI coach built on Ted\'s method and trained in his voice, not Ted live - then gently continue in that same voice.',
      'CRITICAL FORMATTING RULE: Never wrap any word in asterisks for emphasis - this chat renders plain text only, so *anything like this* appears to the student as literal asterisks. If a word needs emphasis, use plain phrasing or sentence rhythm instead.',
      'WHAT THIS LAYER COVERS (' + scopeNote + '):\n"""\n' + (SESSION.transcript || '') + '\n"""',
      'WHAT THIS CONVERSATION IS FOR:\nThis single, continuous, natural conversation IS the exploration of ' + layer.label + '. Your job is to walk the student through the areas below - in whatever order the conversation naturally takes - making sure, by the end, all of them have been genuinely explored:\n\n' + areas
    ];
    if (contextBlock) parts.push(contextBlock);
    if (LAYER_CONFIG.reflectionFramework.coachingApproach) {
      parts.push('COACHING APPROACH FOR THIS LAYER - PRIVATE, NEVER SHOWN TO THE STUDENT:\n' + LAYER_CONFIG.reflectionFramework.coachingApproach);
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
    parts.push(
      'WHAT YOU NEVER DO:\nNever write their reflection for them. Never diagnose them or their psychology. Stay descriptive and curious, not clinical.',
      'CALIBRATION ONLY - NEVER SHOW OR QUOTE THESE TO THE STUDENT:\n' + calibration,
      'GETTING THEIR NAME:\nYou have already greeted the student before this conversation history begins. If you did not already know their name, their reply should contain it. The very first time you learn their name, begin your reply with a hidden tag on its own line, exactly: [NAME: Their Name] - then continue your reply below it. Only include this tag once.',
      'STYLE:\nWrite the way a real person talks in a warm one-on-one conversation. Keep replies short: two to five sentences. Ask ONE question at a time. Never use markdown formatting of any kind, including asterisks for emphasis.'
    );
    var wrapParts = ['Once all the areas have been genuinely explored - not perfectly, just past a first surface answer - bring this layer to a warm close.'];
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
      wrapParts.push('CAPTURING THE DELIVERABLE - REQUIRED BEFORE YOU CAN CLOSE:\nBefore your closing message, on their own lines, include hidden tags capturing every finished deliverable field - ' + fieldSummary + ':\n\n' + tagLines + '\nEvery field must contain real, specific content the student actually gave you. Do not emit these tags, and do not close the layer, until you actually have all of this.');
      wrapParts.push('Immediately after those tags, on its own line, include a hidden tag: [SUMMARY: One plain sentence, third person, under twenty words, capturing the core insight that surfaced.] - never shown to the student. End your closing message with the exact tag [REFLECTION_COMPLETE] on its own line at the very end, after every other tag.');
    } else {
      wrapParts.push('Immediately before your closing sentence, include a hidden tag: [SUMMARY: One plain sentence, third person, under twenty words.] - never shown to the student. End with [REFLECTION_COMPLETE] on its own line at the very end.');
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
            fetchCoachingPhilosophy(function (coachingPhilosophy) {
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

  function handleSend() {
    if (busy || poolExhausted) return;
    var val = inputEl.value.trim();
    if (!val) return;
    addMessage('user', val);
    conversationHistory.push({ role: 'user', content: val });
    inputEl.value = '';
    inputEl.style.height = 'auto';
    saveTranscript();
    sendToClaude();
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
    return SESSION.slug + ':' + layerNumber;
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
    fetch(PROXY_URL + '/excavation/master-deliverable?studentId=' + encodeURIComponent(STUDENT_ID) + '&excavationSlug=' + encodeURIComponent(SESSION.slug))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.known && d.text) { renderSynthesisCard(d.text); return; }
        return fetch(PROXY_URL + '/excavation/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: STUDENT_ID, excavationSlug: SESSION.slug, lang: LANG })
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

    buildChatPanel(contentEl);
    renderRail();

    if (SESSION.videoMediaId) buildVideo(videoSlot, SESSION.videoMediaId);
    if (SESSION.coachingIntro && SESSION.coachingIntro.text) buildCoachingIntro(introSlot, SESSION.coachingIntro);

    loadProgressThenStart();
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
        buildPage(container);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
