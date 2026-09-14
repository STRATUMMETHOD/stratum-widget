/* ============================================================
   STRATUM COACH — COACHING SESSION PAGE LOGIC (Sept 2026)
   ------------------------------------------------------------
   Character Excavation is the first coaching session built on this
   page; the format is designed to be reused for every future one
   (Essentials, Mastery per Ted) — see SESSION_DEFINITIONS below.
   This is a port of the working "ladder" coaching logic that
   already existed in stratum-lesson-engine.js (LADDER_MODE and its
   supporting functions), restyled for the new dark/warm design
   system and reconnected to stratum-identity.js instead of that
   file's own cookie-only identity handling. The underlying data
   model is UNCHANGED: same lesson_configs records (tier 'guided',
   ids 1.1-1.6), same /complete per-layer completion + deliverable
   capture, same /excavation/synthesize + /excavation/master-
   deliverable endpoints for the single end-of-session synthesis.

   Session → layer mapping lives here (SESSION_DEFINITIONS), not in
   the Stratum admin, per Ted's decision to keep the admin panel
   untouched this round — the admin panel still edits each LAYER's
   content (areas, coaching approach, deliverable fields, and, for
   the first layer only, the one video for the whole session); this
   file just knows which ordered set of layer ids make up which
   session and what their on-screen strata labels are. Adding a
   future session (Essentials, Mastery) is a new entry here, not new
   code, once those layers' lesson_configs ids are decided.

   IMPORTANT — data sourcing: this file fetches WIP profile, Idea
   Log, and Reminders context directly from /project, /notes, /tasks
   at conversation-start time, NOT from localStorage. The old
   engine's PROJ_KEYS/NOTES_KEY/TRACKER_KEY localStorage cache is not
   populated anywhere in this new architecture (stratum-wip-
   profile.js and stratum-dashboard.js both read/write the server
   directly) — reusing those keys here would silently see nothing.

   Requires stratum-identity.js AND stratum-header.js (for
   window.StratumHeader.buildTopbar) loaded first on this page.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var WP_USER = window.StratumIdentity ? window.StratumIdentity.getWpUser() : { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };
  var LANG_STORE_KEY = 'wlfc_preferred_lang'; // same key stratum-header.js's Language dropdown writes
  var MODEL = 'claude-sonnet-4-5';

  // ----------------------------------------------------------
  // SESSION DEFINITIONS
  // ----------------------------------------------------------
  var SESSION_DEFINITIONS = {
    'character-excavation': {
      tier: 'guided',
      synthesisEndpoint: '/excavation/synthesize',       // unchanged Worker endpoint — scoped to the 1.x ids today
      masterDeliverableEndpoint: '/excavation/master-deliverable',
      layers: [
        { id: '1.1', label: 'The Anchor Behavior' },
        { id: '1.2', label: 'The Hidden Truth' },
        { id: '1.3', label: 'The Formative Wound' },
        { id: '1.4', label: 'The Lies They Believe' },
        { id: '1.5', label: 'Their Wants and Needs' },
        { id: '1.6', label: 'Their Fears & Desires' }
      ]
    }
    // TODO: 'essentials', 'mastery' — add here once their layer ids and
    // on-screen labels are finalized. synthesisEndpoint/
    // masterDeliverableEndpoint above are Character-Excavation-specific
    // in the Worker today (LADDER_LESSON_IDS is hardcoded to 1.1-1.6) —
    // the Worker will need a matching generalization before a second
    // session can actually synthesize its own deliverable.
  };

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
  function renderRail() {
    railEl.innerHTML = '';
    SESSION.layers.forEach(function (layer, i) {
      var state = completedLayerIds[layer.id] ? 'sh-done' : (i === currentLayerIndex ? 'sh-current' : 'sh-pending');
      var row = el('div', 'sh-rail-layer ' + state);
      var check = el('div', 'sh-rail-check', completedLayerIds[layer.id] ? '\u2713' : '');
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
  var FOCUS_GUIDANCE = {
    character_depth: 'They specifically want to know whether their character feels real rather than constructed. When character work comes up, that means leaning toward substrate and compensation - what the character is protecting - rather than staying on surface traits.',
    dialogue: 'They specifically want to know whether their dialogue sounds authentic. When dialogue work comes up, that means leaning toward what is being left unsaid, and whether lines read as protection rather than direct statement.',
    pacing_structure: 'They specifically want to know whether their pacing and structure are working. When structural work comes up, that means paying attention to where scenes might be doing too much or too little.',
    emotional_impact: 'They specifically want to know whether the emotional beats are landing. That means paying attention to earned versus unearned emotion - whether the reader has been given enough to feel what the scene wants them to feel.',
    consistency: "They specifically want to know whether their character's choices feel consistent, or interestingly inconsistent. That means paying attention to contradiction as potential depth rather than automatically treating it as an error to fix.",
    not_sure: 'They are not yet sure what they most need help seeing. Do not push them to decide right now - let it surface naturally as the conversation goes.'
  };

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

  function buildProjectContextBlock(project, ideaLog, tasks, globalInstructions) {
    var block = '';
    if (project) {
      var lines = [];
      if (project.wipTitle) lines.push('Working title: ' + project.wipTitle);
      if (project.type) lines.push('Project type: ' + project.type);
      if (project.genre) lines.push('Genre: ' + project.genre);
      if (project.storyStyle) lines.push('Story style: ' + project.storyStyle);
      if (project.pov) lines.push('Point of view: ' + project.pov);
      if (project.stage) lines.push('Stage of progress: ' + project.stage);
      if (project.mcName) lines.push('Main character: ' + project.mcName);
      if (project.mcGoal) lines.push('Their core conflict or goal: ' + project.mcGoal);
      if (project.antagonistName) lines.push('Antagonist: ' + project.antagonistName);
      if (project.antagonistType) lines.push('Type of antagonist: ' + project.antagonistType);
      if (project.theme) lines.push('Theme or focus: ' + project.theme);
      if (project.challenges) lines.push('Where they are currently stuck: ' + project.challenges);
      if (lines.length) {
        block += '\n\nSTUDENT PROJECT CONTEXT (from their WIP profile - use naturally where relevant, do not interrogate them about these facts, they already told you once):\n' + lines.join('\n');
      }
      if (project.focus && FOCUS_GUIDANCE[project.focus]) {
        block += '\n\nWhat they most want to understand right now: ' + FOCUS_GUIDANCE[project.focus];
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
    var calibration = (LAYER_CONFIG.reflectionFramework.calibrationExamples || []).map(function (ex) { return '- ' + ex; }).join('\n');
    var scopeNote = LAYER_CONFIG.scopeNote || layer.label;
    var parts = [
      'You are Ted Baker. You are speaking in first person, live, as though this is a real one-on-one coaching conversation exploring "' + layer.label + '" as part of the Character Excavation coaching session on The Stratum Method. You spent thirty-five years as a behavioral consultant working with more than twenty thousand people before turning that same work toward fiction writers. This is who you are in this conversation: warm, direct, genuinely curious about this specific person, unhurried, occasionally willing to admit your own doubt or history if it helps someone open up.',
      'STAY IN VOICE: Speak only as Ted, first person, for the entire conversation. If the student sincerely and directly asks whether they are talking to a real person or an AI, answer honestly and briefly - you are an AI coach built on Ted\'s method and trained in his voice, not Ted live - then gently continue in that same voice.',
      'CRITICAL FORMATTING RULE: Never wrap any word in asterisks for emphasis - this chat renders plain text only, so *anything like this* appears to the student as literal asterisks. If a word needs emphasis, use plain phrasing or sentence rhythm instead.',
      'WHAT THIS LAYER COVERS (' + scopeNote + '):\n"""\n' + (LAYER_CONFIG.transcript || '') + '\n"""',
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
        lesson: SESSION.layers[currentLayerIndex].id,
        conversationId: conversationId,
        history: conversationHistory,
        studentName: studentName,
        reflectionComplete: false
      })
    }).catch(function () {});
  }
  function reportLayerComplete(summaryText) {
    if (!STUDENT_ID) return;
    var body = { studentId: STUDENT_ID, lesson: SESSION.layers[currentLayerIndex].id, summary: summaryText || null };
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
            CONTEXT_BLOCK_CACHE = buildProjectContextBlock(project, ideaLog, tasks, globalInstructions);
            callback(CONTEXT_BLOCK_CACHE);
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
        body.stratum = { studentId: STUDENT_ID, conversationId: conversationId, lesson: SESSION.layers[currentLayerIndex].id, email: WP_USER.email || null };
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
  function loadLayerConfig(layerId, callback) {
    fetch(PROXY_URL + '/lesson-config?lessonId=' + encodeURIComponent(layerId) + '&tier=' + SESSION.tier + '&lang=' + encodeURIComponent(LANG))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.known || !d.config) { callback(null); return; }
        var cfg = d.config;
        cfg.scopeNote = cfg.scopeNote || '';
        cfg.transcript = cfg.transcript || '';
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
    loadLayerConfig(layer.id, function (cfg) {
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
    completedLayerIds[layer.id] = true;
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
    fetch(PROXY_URL + SESSION.masterDeliverableEndpoint + '?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.known && d.text) { renderSynthesisCard(d.text); return; }
        return fetch(PROXY_URL + SESSION.synthesisEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId: STUDENT_ID })
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
    mount(card, el('div', 'sh-synthesis-title', 'Character Excavation \u2014 Complete'));
    mount(card, el('p', 'sh-synthesis-sub', studentName ? ('Nice work, ' + studentName + '. All six layers are excavated.') : 'All six layers are excavated.'));
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
    var txt = 'CHARACTER EXCAVATION \u2014 COMPLETE PROFILE\n' + who + ' \u2014 ' + dateStr + '\n' +
      '==========================================\n\n' + text;
    var blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'Character-Excavation-' + who.replace(/\s+/g, '-') + '.txt';
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
          if (!completedLayerIds[SESSION.layers[i].id]) { firstIncomplete = i; break; }
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
    mount(container, shell);

    var page = el('div', 'sh-coach-page');
    var videoSlot = el('div');
    videoSlot.id = 'shCoachVideoSlot';
    mount(page, videoSlot);

    var body = el('div', 'sh-coach-body');
    railEl = el('div', 'sh-rail');
    mount(body, railEl);
    contentEl = el('div');
    mount(body, contentEl);
    mount(page, body);
    mount(container, page);

    buildChatPanel(contentEl);
    renderRail();

    loadLayerConfig(SESSION.layers[0].id, function (cfg) {
      if (cfg && cfg.video && cfg.video.mediaId) buildVideo(videoSlot, cfg.video.mediaId);
    });

    loadProgressThenStart();
  }

  function init() {
    var container = document.getElementById('stratum-coach');
    if (!container) {
      console.error('[Stratum] No #stratum-coach container found on this page.');
      return;
    }
    var slug = window.STRATUM_SESSION_SLUG || '';
    SESSION = SESSION_DEFINITIONS[slug];
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
