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

   ---- Database-backed translation (Sept 24 2026) ----
   Every student-facing chrome string on this page (rail status, input
   placeholder, WIP/character/conflict pickers and indicators, error
   and empty states, synthesis card, recurring topic list) now goes
   through t(), which checks DB overrides from GET /ui-strings under
   the coachPage.* keys FIRST, then falls back to the local en/es
   STRINGS below — same t()/DB_STRINGS/loadUiStrings() pattern as
   stratum-practice.js and stratum-library.js. loadUiStrings() resolves
   before anything renders, so the first paint is already translated.
   The coach's own prompt text (buildSystemPrompt etc.) deliberately
   stays English — it's model-facing, not student-facing, and the
   LANGUAGE instruction in buildProjectContextBlock already makes the
   coach reply in the student's language.

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
  var SELECTED_CONFLICT = null;   // {instanceId, characterA, characterB, label} — set via the conflict-pair picker for any excavation with requiresConflictPair true; null for every other excavation. characterA/characterB are full {id, name, type, roleType, coreConflict} objects, same shape as SELECTED_CHARACTER.
  var ACTIVE_WIP_ID = null;       // Sept 2026 (multiple WIPs): every Excavation-Track session's coaching context (and, for requiresCharacter sessions, its character list) is scoped to one WIP — resolved by resolveWipThenStart() before anything else runs

  var railEl, messagesEl, formEl, inputEl, sendBtn, contentEl;

  // ----------------------------------------------------------
  // TRANSLATION (Sept 24 2026) — see file header
  // ----------------------------------------------------------
  var STRINGS = {
    en: {
      inProgress: 'In progress',
      typeYourReply: 'Type your reply...',
      poolExhausted: 'You\u2019ve used all your coaching sessions for now. Message Ted and he\u2019ll sort it out.',
      accountSuspended: 'Something\u2019s wrong with the access on this account. Send a message and it will get sorted out.',
      lostTrain: 'I lost my train of thought there for a second. Could you say that again?',
      lostConnection: 'Hang on - I lost the connection for a second. Mind sending that again?',
      layerNotSetUp: 'This layer hasn\u2019t been set up yet. Let Ted know.',
      greetBackFallback: 'Hey {name} - good to have you back. Let\u2019s pick up where we left off.',
      greetFreshFallback: 'Hey - let\u2019s get started. What\u2019s your name?',
      synthesizing: 'Bringing together everything you\u2019ve excavated\u2026',
      synthGenerateError: 'Couldn\u2019t generate your synthesis right now. Refresh to try again.',
      synthLoadError: 'Couldn\u2019t load your synthesis right now. Refresh to try again.',
      closingNameWho: 'Congratulations, {name} \u2014 you\u2019ve built a complete, usable profile for {who}. Everything we found across all six layers is pulled together below. You can download it or print it now to keep working from as you draft.',
      closingName: 'Congratulations, {name} \u2014 you\u2019ve built a complete, usable profile. Everything we found across all six layers is pulled together below. You can download it or print it now to keep working from as you draft.',
      closingWho: 'Congratulations \u2014 you\u2019ve built a complete, usable profile for {who}. Everything we found across all six layers is pulled together below. You can download it or print it now to keep working from as you draft.',
      closingPlain: 'Congratulations \u2014 you\u2019ve built a complete, usable profile. Everything we found across all six layers is pulled together below. You can download it or print it now to keep working from as you draft.',
      synthTitle: '{title} \u2014 Complete',
      synthTitleWho: '{title} \u2014 Complete: {who}',
      download: 'Download',
      print: 'Print',
      completeProfile: 'COMPLETE PROFILE',
      student: 'Student',
      noLayersYet: 'This excavation doesn\u2019t have any layers set up yet. Check back soon.',
      workingIn: 'Working in: {title}',
      untitledWip: 'Untitled WIP',
      switchWip: 'Switch WIP',
      noWipYet: 'You don\u2019t have a work-in-progress in your profile yet. Add one, then come back here.',
      addWip: '\u2190 Add a WIP',
      whichWip: 'Which work-in-progress is this session for?',
      characterCountOne: '{n} character',
      characterCountMany: '{n} characters',
      excavating: 'Excavating: {name}',
      thisCharacter: 'this character',
      switchCharacter: 'Switch character',
      noCharacterYet: 'This excavation is done one character at a time, and there\u2019s no character in this WIP yet to excavate. Add one, then come back here.',
      addCharacter: '\u2190 Add a character',
      whoIsThisFor: 'Who is this excavation for? Once you start, this stays locked to that character for this session.',
      workingThrough: 'Working through: {names}',
      switchConflict: 'Switch conflict',
      settingUpConflict: 'Setting up this conflict\u2026',
      conflictStartError: 'Couldn\u2019t start this conflict right now. Refresh to try again.',
      needTwoCharacters: 'This excavation is between two characters, and there aren\u2019t at least two in this WIP yet. Add another, then come back here.',
      pickSecond: 'And who is {name} in conflict with?',
      pickFirst: 'Which two characters is this conflict between? Choose the first.',
      whichConflict: 'Which conflict is this session for?',
      startNewConflict: '+ Start a new conflict',
      pickTopic: 'Pick a topic to start a check-in. Each visit is a fresh conversation \u2014 your coach carries everything forward from before.',
      relToday: 'today',
      relYesterday: 'yesterday',
      relDaysAgo: '{n} days ago',
      relWeekAgo: '1 week ago',
      relWeeksAgo: '{n} weeks ago',
      noTopicsYet: 'This session doesn\u2019t have any topics set up yet. Check back soon.',
      checkinCountOne: '{n} check-in \u00b7 last {when}',
      checkinCountMany: '{n} check-ins \u00b7 last {when}',
      noCheckinsYet: 'No check-ins yet',
      topicNotSetUp: 'This topic isn\u2019t set up yet.',
      whichCharacterCheckin: 'Which of your characters is this about? Optional \u2014 skip if it isn\u2019t about one specific character.',
      notAboutOneCharacter: 'Not about one specific character',
      backToTopics: '\u2190 Back to topics',
      aboutCharacter: 'About: {name}',
      beforeYouBegin: 'Before You Begin',
      notConfigured: 'This coaching session hasn\u2019t been configured yet.',
      backToDashboard: '\u2190 Back to Dashboard',
      loginToStart: 'Please log in to start this coaching session.',
      logIn: 'Log in',
      noMembership: 'Your account doesn\u2019t have an active Stratum Method membership yet.',
      goToMyAccount: 'Go to My Account',
      couldNotConnect: 'Could not connect your account. Refresh and try again.'
    },
    es: {
      inProgress: 'En curso',
      typeYourReply: 'Escribe tu respuesta...',
      poolExhausted: 'Has usado todas tus sesiones de coaching por ahora. Escríbele a Ted y él lo resolverá.',
      accountSuspended: 'Algo no está bien con el acceso de esta cuenta. Envía un mensaje y se resolverá.',
      lostTrain: 'Perdí el hilo por un segundo. ¿Podrías repetirlo?',
      lostConnection: 'Un momento: perdí la conexión por un segundo. ¿Puedes enviarlo de nuevo?',
      layerNotSetUp: 'Esta capa aún no está configurada. Avísale a Ted.',
      greetBackFallback: 'Hola {name}, qué bueno tenerte de vuelta. Retomemos donde lo dejamos.',
      greetFreshFallback: 'Hola, empecemos. ¿Cómo te llamas?',
      synthesizing: 'Reuniendo todo lo que has excavado\u2026',
      synthGenerateError: 'No se pudo generar tu síntesis en este momento. Actualiza la página para intentarlo de nuevo.',
      synthLoadError: 'No se pudo cargar tu síntesis en este momento. Actualiza la página para intentarlo de nuevo.',
      closingNameWho: 'Felicidades, {name}: has construido un perfil completo y útil para {who}. Todo lo que encontramos en las seis capas está reunido abajo. Puedes descargarlo o imprimirlo ahora para seguir trabajando con él mientras escribes.',
      closingName: 'Felicidades, {name}: has construido un perfil completo y útil. Todo lo que encontramos en las seis capas está reunido abajo. Puedes descargarlo o imprimirlo ahora para seguir trabajando con él mientras escribes.',
      closingWho: 'Felicidades: has construido un perfil completo y útil para {who}. Todo lo que encontramos en las seis capas está reunido abajo. Puedes descargarlo o imprimirlo ahora para seguir trabajando con él mientras escribes.',
      closingPlain: 'Felicidades: has construido un perfil completo y útil. Todo lo que encontramos en las seis capas está reunido abajo. Puedes descargarlo o imprimirlo ahora para seguir trabajando con él mientras escribes.',
      synthTitle: '{title} \u2014 Completo',
      synthTitleWho: '{title} \u2014 Completo: {who}',
      download: 'Descargar',
      print: 'Imprimir',
      completeProfile: 'PERFIL COMPLETO',
      student: 'Estudiante',
      noLayersYet: 'Esta excavación aún no tiene capas configuradas. Vuelve pronto.',
      workingIn: 'Trabajando en: {title}',
      untitledWip: 'Obra sin título',
      switchWip: 'Cambiar obra',
      noWipYet: 'Aún no tienes una obra en curso en tu perfil. Agrega una y luego vuelve aquí.',
      addWip: '\u2190 Agregar una obra',
      whichWip: '¿Para qué obra en curso es esta sesión?',
      characterCountOne: '{n} personaje',
      characterCountMany: '{n} personajes',
      excavating: 'Excavando: {name}',
      thisCharacter: 'este personaje',
      switchCharacter: 'Cambiar personaje',
      noCharacterYet: 'Esta excavación se hace un personaje a la vez, y todavía no hay ningún personaje en esta obra para excavar. Agrega uno y luego vuelve aquí.',
      addCharacter: '\u2190 Agregar un personaje',
      whoIsThisFor: '¿Para quién es esta excavación? Una vez que empieces, quedará fijada a ese personaje durante esta sesión.',
      workingThrough: 'Trabajando: {names}',
      switchConflict: 'Cambiar conflicto',
      settingUpConflict: 'Preparando este conflicto\u2026',
      conflictStartError: 'No se pudo iniciar este conflicto en este momento. Actualiza la página para intentarlo de nuevo.',
      needTwoCharacters: 'Esta excavación es entre dos personajes, y todavía no hay al menos dos en esta obra. Agrega otro y luego vuelve aquí.',
      pickSecond: '¿Y con quién está en conflicto {name}?',
      pickFirst: '¿Entre qué dos personajes es este conflicto? Elige el primero.',
      whichConflict: '¿Para qué conflicto es esta sesión?',
      startNewConflict: '+ Iniciar un nuevo conflicto',
      pickTopic: 'Elige un tema para iniciar un seguimiento. Cada visita es una conversación nueva \u2014 tu coach lleva consigo todo lo anterior.',
      relToday: 'hoy',
      relYesterday: 'ayer',
      relDaysAgo: 'hace {n} días',
      relWeekAgo: 'hace 1 semana',
      relWeeksAgo: 'hace {n} semanas',
      noTopicsYet: 'Esta sesión aún no tiene temas configurados. Vuelve pronto.',
      checkinCountOne: '{n} seguimiento \u00b7 último {when}',
      checkinCountMany: '{n} seguimientos \u00b7 último {when}',
      noCheckinsYet: 'Aún no hay seguimientos',
      topicNotSetUp: 'Este tema aún no está configurado.',
      whichCharacterCheckin: '¿Sobre cuál de tus personajes es esto? Opcional \u2014 omítelo si no se trata de un personaje específico.',
      notAboutOneCharacter: 'No se trata de un personaje específico',
      backToTopics: '\u2190 Volver a los temas',
      aboutCharacter: 'Sobre: {name}',
      beforeYouBegin: 'Antes de empezar',
      notConfigured: 'Esta sesión de coaching aún no está configurada.',
      backToDashboard: '\u2190 Volver al panel',
      loginToStart: 'Inicia sesión para comenzar esta sesión de coaching.',
      logIn: 'Iniciar sesión',
      noMembership: 'Tu cuenta aún no tiene una membresía activa de Stratum Method.',
      goToMyAccount: 'Ir a mi cuenta',
      couldNotConnect: 'No se pudo conectar tu cuenta. Actualiza la página e inténtalo de nuevo.'
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
    return String(str).replace(/\{(\w+)\}/g, function (m, k) { return (vars && vars[k] != null) ? vars[k] : m; });
  }
  function t(key, vars) {
    var dbVal = DB_STRINGS['coachPage.' + key];
    var str = dbVal != null ? dbVal : ((STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key);
    return vars ? format(str, vars) : str;
  }

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
    // Sept 2026 fix: was hardcoded to aspect="2.4" (a wide cinematic
    // ratio) regardless of the actual video's shape - every video here
    // is a standard 16:9 recording, so Wistia was reserving a taller
    // box than the video itself needed and filling the gap with black
    // bars. No aspect override at all lets the player use each video's
    // own native ratio automatically instead of assuming one fixed
    // ratio for every video this page will ever show.
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
    SESSION.layers.forEach(function (layer, i) {
      var isDone = !!completedLayerIds[lessonKey(layer.layerNumber)];
      var isCurrent = i === currentLayerIndex;
      var state = isDone ? 'sh-done' : (isCurrent ? 'sh-current' : 'sh-pending');
      var row = el('div', 'sh-rail-layer ' + state);
      // Current/done get their solid gold fill from the CSS state class;
      // only pending layers carry an inline depth tone, so the graduated
      // "deeper = darker" scale reads clearly against the two lit bands.
      if (state === 'sh-pending') row.style.background = RAIL_TONES[i % RAIL_TONES.length];
      var badge = el('div', 'sh-rail-badge', isDone ? '\u2713' : String(i + 1));
      mount(row, badge);
      var textWrap = el('div', 'sh-rail-text');
      mount(textWrap, el('div', 'sh-rail-label', layer.label));
      if (isCurrent) mount(textWrap, el('div', 'sh-rail-status', t('inProgress')));
      mount(row, textWrap);
      mount(railEl, row);
    });
  }

  // ----------------------------------------------------------
  // CONTEXT FETCHING (WIP profile, Idea Log, Reminders, Global
  // Instructions) — all server-authoritative, fetched fresh, not from
  // localStorage. See file header note.
  // ----------------------------------------------------------

  function fetchProjectData(callback) {
    if (!ACTIVE_WIP_ID) { callback(null); return; } // no WIP resolved yet - resolveWipThenStart() always runs first, see buildPage()
    fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(STUDENT_ID) + '&wipId=' + encodeURIComponent(ACTIVE_WIP_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && d.known) ? d : null); })
      .catch(function () { callback(null); });
  }
  function fetchWips(callback) {
    fetch(PROXY_URL + '/wips?studentId=' + encodeURIComponent(STUDENT_ID))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.wips)) ? d.wips : []); })
      .catch(function () { callback([]); });
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

  // Sept 2026: cross-excavation profile pull for requiresConflictPair
  // sessions (Conflict Resolution). The Layer 2 coaching content
  // ("The Real Stakes") is explicit that either character may already
  // have a completed Character Excavation profile, and when one does,
  // the session should pull it directly rather than re-deriving
  // Wants/Needs and Hidden Truth from scratch. CHARACTER_EXCAVATION_SLUG
  // must match whatever slug the admin actually saved Character
  // Development under (confirmed via D1 as 'character-excavation') —
  // if that ever changes, update it here too.
  var CHARACTER_EXCAVATION_SLUG = 'character-excavation';
  function fetchCharacterExcavationProfile(characterId, callback) {
    fetch(PROXY_URL + '/excavation/master-deliverable?studentId=' + encodeURIComponent(STUDENT_ID) + '&excavationSlug=' + encodeURIComponent(CHARACTER_EXCAVATION_SLUG) + '&characterId=' + encodeURIComponent(characterId))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && d.known && d.text) ? d.text : null); })
      .catch(function () { callback(null); });
  }
  // Sept 2026: generalized from the Conflict Resolution-only version —
  // Character Voice (and any future single-character Writing/General
  // topic) links a character per check-in via resolveCharacterForCheckin()
  // below, and needs the exact same profile pull SELECTED_CONFLICT
  // already gets. Guards against pulling a character's own excavation
  // profile into the Character Excavation session itself, which would
  // be circular and never actually useful.
  function fetchLinkedProfiles(callback) {
    if (SESSION.slug === CHARACTER_EXCAVATION_SLUG) { callback([]); return; }
    if (SELECTED_CONFLICT) {
      var pending = 2;
      var result = [];
      function maybeDone() { pending--; if (pending === 0) callback(result); }
      fetchCharacterExcavationProfile(SELECTED_CONFLICT.characterA.id, function (text) {
        if (text) result.push({ name: SELECTED_CONFLICT.characterA.name, text: text });
        maybeDone();
      });
      fetchCharacterExcavationProfile(SELECTED_CONFLICT.characterB.id, function (text) {
        if (text) result.push({ name: SELECTED_CONFLICT.characterB.name, text: text });
        maybeDone();
      });
      return;
    }
    if (SELECTED_CHARACTER) {
      fetchCharacterExcavationProfile(SELECTED_CHARACTER.id, function (text) {
        callback(text ? [{ name: SELECTED_CHARACTER.name, text: text }] : []);
      });
      return;
    }
    callback([]);
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
  function buildProjectContextBlock(project, ideaLog, tasks, globalInstructions, coachingPhilosophy, linkedProfiles) {
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
    if (linkedProfiles && linkedProfiles.length) {
      linkedProfiles.forEach(function (p) {
        block += '\n\nEXISTING CHARACTER EXCAVATION PROFILE FOR ' + p.name.toUpperCase() + ' (already confirmed by the writer in a prior Character Development session - use this directly rather than re-deriving Wants/Needs, Hidden Truth, or anything else it already covers from scratch; only ask live if this genuinely doesn\'t cover what\'s needed here):\n' + p.text;
      });
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
    } else if (SELECTED_CONFLICT) {
      var confLines = ['THE CONFLICT THIS EXCAVATION IS ABOUT:\nEverything in this conversation is specifically about the conflict between ' + SELECTED_CONFLICT.characterA.name + ' and ' + SELECTED_CONFLICT.characterB.name + ' - not the writer themselves, and not any other character or conflict in their project. Keep every question anchored to this one dispute between these two people.'];
      var aBits = [SELECTED_CONFLICT.characterA.type, SELECTED_CONFLICT.characterA.roleType, SELECTED_CONFLICT.characterA.coreConflict].filter(Boolean).join(' | ');
      var bBits = [SELECTED_CONFLICT.characterB.type, SELECTED_CONFLICT.characterB.roleType, SELECTED_CONFLICT.characterB.coreConflict].filter(Boolean).join(' | ');
      if (aBits) confLines.push(SELECTED_CONFLICT.characterA.name + ': ' + aBits);
      if (bBits) confLines.push(SELECTED_CONFLICT.characterB.name + ': ' + bBits);
      if (SELECTED_CONFLICT.label) confLines.push('This conflict\u2019s working label (as the writer named it): ' + SELECTED_CONFLICT.label);
      parts.push(confLines.join('\n'));
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
              fetchLinkedProfiles(function (linkedProfiles) {
                CONTEXT_BLOCK_CACHE = buildProjectContextBlock(project, ideaLog, tasks, globalInstructions, coachingPhilosophy, linkedProfiles);
                callback(CONTEXT_BLOCK_CACHE);
              });
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
          if (data.stratum_error === 'pool_exhausted') { hideTyping(); setBusy(false); poolExhausted = true; addMessage('assistant', t('poolExhausted')); return; }
          if (data.stratum_error === 'account_suspended') { hideTyping(); setBusy(false); addMessage('assistant', t('accountSuspended')); return; }
          var block = (data.content || []).find(function (b) { return b.type === 'text'; });
          var raw = block ? block.text : t('lostTrain');
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
          addMessage('assistant', t('lostConnection'));
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
    // Sept 2026: parallel to the Excavation engine's own SELECTED_CHARACTER
    // block - a Writing/General topic flagged requiresCharacter (Character
    // Voice) links a character per check-in via resolveCharacterForCheckin(),
    // not once per tab, so this is read fresh every time a check-in starts.
    if (SELECTED_CHARACTER) {
      var recCharLines = ['THE CHARACTER THIS CHECK-IN IS ABOUT:\nThe writer has said this check-in concerns ' + (SELECTED_CHARACTER.name || 'this character') + ' specifically. Ground your questions in this character where it helps, using anything already known about them below rather than treating this as a check-in about the writer\u2019s craft in the abstract.'];
      var recCharFacts = [SELECTED_CHARACTER.type, SELECTED_CHARACTER.roleType, SELECTED_CHARACTER.coreConflict].filter(Boolean).join(' | ');
      if (recCharFacts) recCharLines.push(recCharFacts);
      parts.push(recCharLines.join('\n'));
    }
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
    // Sept 2026: per-topic Stage 4 direction (the "Closing guidance"
    // admin field) - a fitting small commitment specific to THIS
    // pattern, as distinct from the generic WRAPPING UP instruction
    // below that applies to every recurring topic regardless of
    // pattern. Optional; most topics will have this once real content
    // exists, but nothing breaks if it's blank.
    if (LAYER_CONFIG.closingGuidance) {
      parts.push('CLOSING DIRECTION FOR THIS TOPIC - PRIVATE, NEVER SHOWN TO THE PERSON:\n' + LAYER_CONFIG.closingGuidance);
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
      'WRAPPING UP:\nOnce the check-in feels naturally complete - the person has said what they came to say and gotten what they needed - before closing, ask for one small, concrete commitment tied to their next actual writing session (see the closing direction above, if any, for a fitting shape for this specific topic). Resist letting them commit to something large or vague - press once toward something specific and small enough to actually happen. There is no fixed list that must all be covered first beyond that; use judgment. Immediately before your closing sentence, include a hidden tag: [SUMMARY: One plain sentence, third person, under twenty words, capturing what this check-in was about and anything useful to remember next time.] - never shown to the person. End with the exact tag [REFLECTION_COMPLETE] on its own line at the very end.'
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
          if (data.stratum_error === 'pool_exhausted') { hideTyping(); setBusy(false); poolExhausted = true; addMessage('assistant', t('poolExhausted')); return; }
          if (data.stratum_error === 'account_suspended') { hideTyping(); setBusy(false); addMessage('assistant', t('accountSuspended')); return; }
          var block = (data.content || []).find(function (b) { return b.type === 'text'; });
          var raw = block ? block.text : t('lostTrain');
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
          addMessage('assistant', t('lostConnection'));
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
    inputEl.placeholder = t('typeYourReply');
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
    var scopeId = SELECTED_CHARACTER ? SELECTED_CHARACTER.id : (SELECTED_CONFLICT ? SELECTED_CONFLICT.instanceId : null);
    return SESSION.slug + ':' + layerNumber + (scopeId ? ':' + scopeId : '');
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
        ? t('greetBackFallback', { name: knownName })
        : t('greetFreshFallback');
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
        addMessage('assistant', t('layerNotSetUp'));
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
    mount(contentEl, el('div', 'sh-coach-loading', t('synthesizing')));
    var scopeParam = SELECTED_CHARACTER ? '&characterId=' + encodeURIComponent(SELECTED_CHARACTER.id) : (SELECTED_CONFLICT ? '&instanceId=' + encodeURIComponent(SELECTED_CONFLICT.instanceId) : '');
    fetch(PROXY_URL + '/excavation/master-deliverable?studentId=' + encodeURIComponent(STUDENT_ID) + '&excavationSlug=' + encodeURIComponent(SESSION.slug) + scopeParam)
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.known && d.text) { renderSynthesisCard(d.text); return; }
        var body = { studentId: STUDENT_ID, excavationSlug: SESSION.slug, lang: LANG };
        if (SELECTED_CHARACTER) body.characterId = SELECTED_CHARACTER.id;
        else if (SELECTED_CONFLICT) body.instanceId = SELECTED_CONFLICT.instanceId;
        return fetch(PROXY_URL + '/excavation/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
          .then(function (r2) { return r2.json(); })
          .then(function (d2) {
            if (d2 && d2.ok && d2.text) renderSynthesisCard(d2.text);
            else { contentEl.innerHTML = ''; mount(contentEl, el('div', 'sh-coach-loading', t('synthGenerateError'))); }
          });
      })
      .catch(function () {
        contentEl.innerHTML = '';
        mount(contentEl, el('div', 'sh-coach-loading', t('synthLoadError')));
      });
  }
  function applyClosingTokens(template, name, character) {
    var out = template;
    out = name ? out.replace(/\{name\}/g, name) : out.replace(/,?\s*\{name\}/g, '');
    out = character ? out.replace(/\{character\}/g, character) : out.replace(/\s*for \{character\}/g, '').replace(/\{character\}/g, '');
    return out.replace(/\s{2,}/g, ' ').trim();
  }

  function renderSynthesisCard(text) {
    contentEl.innerHTML = '';
    // A genuine closing message from the coach, not just card copy -
    // styled as a chat bubble since that's the last thing the person
    // hears before the finished profile appears. Deterministic, not
    // model-generated - the excavation is already complete at this
    // point, there's nothing left to draw out with a live model call.
    // Admin-authored via the Closing Message field at Track level (see
    // the Track editor's Coaching Intro / Closing Message cards) - not
    // per-layer, since it's about finishing the whole excavation, not
    // any one layer. Falls back to a sensible built-in default when
    // left blank.
    var closingWrap = el('div', 'sh-msg-row sh-assistant');
    var closingBubble = el('div', 'sh-msg-bubble');
    var whoText = SELECTED_CHARACTER ? SELECTED_CHARACTER.name : (SELECTED_CONFLICT ? (SELECTED_CONFLICT.characterA.name + ' & ' + SELECTED_CONFLICT.characterB.name) : null);
    if (SESSION.closingMessage) {
      closingBubble.textContent = applyClosingTokens(SESSION.closingMessage, studentName, whoText);
    } else {
      var closingKey = studentName ? (whoText ? 'closingNameWho' : 'closingName') : (whoText ? 'closingWho' : 'closingPlain');
      closingBubble.textContent = t(closingKey, { name: studentName, who: whoText });
    }
    mount(closingWrap, closingBubble);
    mount(contentEl, closingWrap);

    var card = el('div', 'sh-synthesis-card');
    mount(card, el('div', 'sh-synthesis-title', whoText ? t('synthTitleWho', { title: SESSION.title, who: whoText }) : t('synthTitle', { title: SESSION.title })));
    var body = el('div', 'sh-synthesis-text');
    body.innerHTML = textToParagraphs(text);
    mount(card, body);
    var actions = el('div', 'sh-synthesis-actions');
    var dlBtn = el('button', 'sh-synthesis-download', t('download'));
    dlBtn.type = 'button';
    dlBtn.addEventListener('click', function () { downloadSynthesis(text); });
    mount(actions, dlBtn);
    var printBtn = el('button', 'sh-synthesis-download', t('print'));
    printBtn.type = 'button';
    printBtn.addEventListener('click', function () { window.print(); });
    mount(actions, printBtn);
    mount(card, actions);
    mount(contentEl, card);
  }
  function downloadSynthesis(text) {
    var dateStr;
    try { dateStr = new Date().toLocaleDateString(LANG, { year: 'numeric', month: 'long', day: 'numeric' }); }
    catch (e) { dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
    var who = studentName || t('student');
    var txt = SESSION.title.toUpperCase() + ' \u2014 ' + t('completeProfile') + '\n' + who + ' \u2014 ' + dateStr + '\n' +
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
      mount(contentEl, el('div', 'sh-coach-loading', t('noLayersYet')));
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
    var videoOuter = el('div', 'sh-coach-video-outer');
    var videoSlot = el('div');
    videoSlot.id = 'shCoachVideoSlot';
    mount(videoOuter, videoSlot);
    mount(page, videoOuter);

    var introSlot = el('div');
    introSlot.id = 'shCoachIntroSlot';
    mount(page, introSlot);

    // Sept 2026 fix: this indicator ("Working in: X - Switch WIP", and
    // for requiresCharacter excavations, "Excavating: Y - Switch
    // character" right alongside it) used to sit above the video, far
    // from the character list it actually governs, which read as
    // disconnected from the picker itself. Moved to sit directly above
    // where that list (or the chat panel, once resolved) renders.
    var charIndicatorSlot = el('div');
    mount(page, charIndicatorSlot);

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

    resolveWipThenStart(contentEl, charIndicatorSlot);
  }

  function startExcavationProper() {
    buildChatPanel(contentEl);
    renderRail();
    loadProgressThenStart();
  }

  // ----------------------------------------------------------
  // WIP PICKER — every Excavation-Track session is scoped to one WIP
  // ----------------------------------------------------------
  // Sept 2026 (multiple WIPs per student): a writer's profile can now
  // hold more than one work-in-progress, each with its own characters.
  // EVERY Excavation-Track session - not just ones with requiresCharacter
  // - needs to know which WIP its coaching context (buildProjectContextBlock,
  // via fetchProjectData) comes from, and a requiresCharacter session also
  // needs that WIP's character list. This gate runs BEFORE the character
  // picker (or before starting directly, for sessions that don't require
  // one), using the same locked-per-tab sessionStorage pattern the
  // character picker below uses - but keyed once per TAB rather than per
  // excavation slug (WIP_LOCK_KEY, shared with stratum-wip-panel.js and
  // stratum-excavation-center.js), since which WIP a writer is working in
  // is a broader choice than any one session: picking it once should
  // carry across every excavation opened in the same tab, and stay in
  // sync with whatever was last chosen in the profile panel or the
  // Excavation Center.
  var WIP_LOCK_KEY = 'stratum_wip_active';

  function showWipIndicator(slot, wip) {
    var line = el('p', 'sh-coach-sub');
    line.appendChild(document.createTextNode(t('workingIn', { title: wip.title || t('untitledWip') }) + '  \u00b7  '));
    var switchLink = document.createElement('a');
    switchLink.href = '#';
    switchLink.className = 'sh-char-switch-link';
    switchLink.textContent = t('switchWip');
    switchLink.addEventListener('click', function (e) {
      e.preventDefault();
      sessRemove(WIP_LOCK_KEY);
      sessRemove(CHAR_LOCK_PREFIX + SESSION.slug);
      sessRemove(CONFLICT_LOCK_PREFIX + SESSION.slug);
      location.reload();
    });
    line.appendChild(switchLink);
    mount(slot, line);
  }

  function afterWipResolved(container, indicatorSlot) {
    if (ENGINE_MODE !== 'excavation') {
      // Sept 2026: General/Writing sessions don't gate on a character
      // here even when requiresCharacter is set (Character Voice) -
      // that link is asked per check-in, not once per tab, since
      // "each visit is a fresh conversation" already means a different
      // visit may reasonably be about a different character. See
      // resolveCharacterForCheckin() in the recurring engine section.
      buildRecurringPage(container);
      return;
    }
    if (SESSION.requiresCharacter) {
      resolveCharacterThenStart(container, indicatorSlot);
    } else if (SESSION.requiresConflictPair) {
      resolveConflictThenStart(container, indicatorSlot);
    } else {
      startExcavationProper();
    }
  }

  function resolveWipThenStart(container, indicatorSlot) {
    container.innerHTML = ''; // left blank during the fetch, deliberately no "Loading..." text — see resolveCharacterThenStart() below for the same call
    fetchWips(function (wips) {
      var lockedId = sessGet(WIP_LOCK_KEY);
      var locked = lockedId ? wips.filter(function (w) { return w.id === lockedId; })[0] : null;
      if (locked) {
        ACTIVE_WIP_ID = locked.id;
        showWipIndicator(indicatorSlot, locked);
        afterWipResolved(container, indicatorSlot);
        return;
      }
      container.innerHTML = '';
      if (!wips.length) {
        // Sept 2026: only the Excavation engine hard-requires a WIP up
        // front - a character- or conflict-scoped excavation genuinely
        // has nothing to run without one. General/Writing sessions work
        // fine with no WIP on file at all (project context and any
        // linked-character profile pull are simply unavailable, same as
        // they silently were before this WIP-resolution step existed
        // for this engine), so they proceed straight through instead of
        // gating on this empty state.
        if (ENGINE_MODE !== 'excavation') {
          ACTIVE_WIP_ID = null;
          afterWipResolved(container, indicatorSlot);
          return;
        }
        var empty = el('div', 'sh-coach-page');
        mount(empty, el('p', null, t('noWipYet')));
        var link = document.createElement('a');
        link.className = 'sh-save-btn';
        link.href = '/system/';
        link.textContent = t('addWip');
        mount(empty, link);
        mount(container, empty);
        return;
      }
      if (wips.length === 1) {
        // Only one WIP - nothing to actually choose. Lock it silently
        // (so a reload doesn't re-show this) and go straight through.
        ACTIVE_WIP_ID = wips[0].id;
        sessSet(WIP_LOCK_KEY, wips[0].id);
        showWipIndicator(indicatorSlot, wips[0]);
        afterWipResolved(container, indicatorSlot);
        return;
      }
      var wrap = el('div', 'sh-recurring-topics');
      mount(container, el('p', 'sh-coach-sub', t('whichWip')));
      wips.forEach(function (w) {
        var row = el('div', 'sh-recurring-topic-row');
        row.addEventListener('click', function () {
          ACTIVE_WIP_ID = w.id;
          sessSet(WIP_LOCK_KEY, w.id);
          showWipIndicator(indicatorSlot, w);
          afterWipResolved(container, indicatorSlot);
        });
        mount(row, el('div', 'sh-recurring-topic-title', w.title || t('untitledWip')));
        var metaBits = [w.genre, w.characterCount ? t(w.characterCount === 1 ? 'characterCountOne' : 'characterCountMany', { n: w.characterCount }) : null].filter(Boolean);
        mount(row, el('div', 'sh-recurring-topic-meta', metaBits.join(' \u00b7 ') || '\u00a0'));
        mount(wrap, row);
      });
      mount(container, wrap);
    });
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
    // Sept 2026: no longer clears the slot first - showWipIndicator()
    // already put its own line in there (WIP is resolved before the
    // character picker runs, see resolveWipThenStart()/afterWipResolved()
    // above), and both indicators need to stay visible together. Either
    // "Switch" link does a full location.reload() anyway, so there's no
    // stale-DOM risk from appending rather than replacing.
    var line = el('p', 'sh-coach-sub');
    line.appendChild(document.createTextNode(t('excavating', { name: SELECTED_CHARACTER.name || t('thisCharacter') }) + '  \u00b7  '));
    var switchLink = document.createElement('a');
    switchLink.href = '#';
    switchLink.className = 'sh-char-switch-link';
    switchLink.textContent = t('switchCharacter');
    switchLink.addEventListener('click', function (e) {
      e.preventDefault();
      sessRemove(CHAR_LOCK_PREFIX + SESSION.slug);
      location.reload();
    });
    line.appendChild(switchLink);
    mount(slot, line);
  }

  function resolveCharacterThenStart(container, indicatorSlot) {
    container.innerHTML = ''; // deliberately no "Loading your characters..." text — see stated feedback; the gate is usually near-instant and the text only ever flashed
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
        mount(empty, el('p', null, t('noCharacterYet')));
        var link = document.createElement('a');
        link.className = 'sh-save-btn';
        link.href = '/system/';
        link.textContent = t('addCharacter');
        mount(empty, link);
        mount(container, empty);
        return;
      }
      var wrap = el('div', 'sh-recurring-topics');
      mount(container, el('p', 'sh-coach-sub', t('whoIsThisFor')));
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
  // CONFLICT-PAIR PICKER — excavations with requiresConflictPair true
  // ----------------------------------------------------------
  // Conflict Resolution (and any future requiresConflictPair
  // excavation) runs once PER CONFLICT INSTANCE, not once per student
  // and not once per character — a writer may have several unrelated
  // conflicts going in the same WIP, each with its own separate
  // progress (see SELECTED_CONFLICT, lessonKey(), and the conflict
  // context block in buildSystemPrompt()). Deliberately mirrors the
  // character picker immediately above: once picked, the instance is
  // LOCKED for this browser tab via sessionStorage so a reload resumes
  // the same conflict silently; the only way to change it is the
  // explicit "Switch conflict" link. Reuses the character picker's own
  // CSS classes (sh-recurring-topic-row etc.) rather than introducing
  // new ones, since the row shape is identical.
  var CONFLICT_LOCK_PREFIX = 'stratum_conflict_';

  function showConflictIndicator(slot) {
    var line = el('p', 'sh-coach-sub');
    var names = SELECTED_CONFLICT.characterA.name + ' & ' + SELECTED_CONFLICT.characterB.name;
    line.appendChild(document.createTextNode(t('workingThrough', { names: names }) + '  \u00b7  '));
    var switchLink = document.createElement('a');
    switchLink.href = '#';
    switchLink.className = 'sh-char-switch-link';
    switchLink.textContent = t('switchConflict');
    switchLink.addEventListener('click', function (e) {
      e.preventDefault();
      sessRemove(CONFLICT_LOCK_PREFIX + SESSION.slug);
      location.reload();
    });
    line.appendChild(switchLink);
    mount(slot, line);
  }

  function fetchConflictInstances(callback) {
    fetch(PROXY_URL + '/conflict-instances?studentId=' + encodeURIComponent(STUDENT_ID) + '&wipId=' + encodeURIComponent(ACTIVE_WIP_ID) + '&excavationSlug=' + encodeURIComponent(SESSION.slug))
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && Array.isArray(d.instances)) ? d.instances : []); })
      .catch(function () { callback([]); });
  }

  function createConflictInstance(characterAId, characterBId, callback) {
    fetch(PROXY_URL + '/conflict-instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: STUDENT_ID, wipId: ACTIVE_WIP_ID, excavationSlug: SESSION.slug, characterAId: characterAId, characterBId: characterBId })
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { callback((d && d.ok) ? d.instanceId : null); })
      .catch(function () { callback(null); });
  }

  function resolveConflictThenStart(container, indicatorSlot) {
    container.innerHTML = ''; // deliberately no loading text, same reasoning as resolveCharacterThenStart above
    fetchProjectData(function (project) {
      var characters = (project && Array.isArray(project.characters)) ? project.characters.filter(function (c) { return c.name; }) : [];
      var charById = {};
      characters.forEach(function (c) { charById[c.id] = c; });

      fetchConflictInstances(function (instances) {
        var lockedId = sessGet(CONFLICT_LOCK_PREFIX + SESSION.slug);
        var lockedInst = lockedId ? instances.filter(function (i) { return i.id === lockedId; })[0] : null;
        if (lockedInst && charById[lockedInst.characterAId] && charById[lockedInst.characterBId]) {
          // Resuming this tab's already-locked conflict — skip the
          // picker entirely, no prompt, no chance to switch by accident.
          SELECTED_CONFLICT = {
            instanceId: lockedInst.id,
            characterA: charById[lockedInst.characterAId],
            characterB: charById[lockedInst.characterBId],
            label: lockedInst.label || null
          };
          showConflictIndicator(indicatorSlot);
          startExcavationProper();
          return;
        }

        container.innerHTML = '';
        if (characters.length < 2) {
          var empty = el('div', 'sh-coach-page');
          mount(empty, el('p', null, t('needTwoCharacters')));
          var link = document.createElement('a');
          link.className = 'sh-save-btn';
          link.href = '/system/';
          link.textContent = t('addCharacter');
          mount(empty, link);
          mount(container, empty);
          return;
        }

        function startNewInstance(charA, charB) {
          container.innerHTML = '';
          mount(container, el('div', 'sh-coach-loading', t('settingUpConflict')));
          createConflictInstance(charA.id, charB.id, function (instanceId) {
            if (!instanceId) {
              container.innerHTML = '';
              mount(container, el('p', null, t('conflictStartError')));
              return;
            }
            SELECTED_CONFLICT = { instanceId: instanceId, characterA: charA, characterB: charB, label: null };
            sessSet(CONFLICT_LOCK_PREFIX + SESSION.slug, instanceId);
            showConflictIndicator(indicatorSlot);
            startExcavationProper();
          });
        }

        function renderPickSecond(charA) {
          container.innerHTML = '';
          mount(container, el('p', 'sh-coach-sub', t('pickSecond', { name: charA.name })));
          var wrap = el('div', 'sh-recurring-topics');
          characters.filter(function (c) { return c.id !== charA.id; }).forEach(function (c) {
            var row = el('div', 'sh-recurring-topic-row');
            row.addEventListener('click', function () { startNewInstance(charA, c); });
            mount(row, el('div', 'sh-recurring-topic-title', c.name));
            var metaBits = [c.type, c.roleType].filter(Boolean);
            mount(row, el('div', 'sh-recurring-topic-meta', metaBits.join(' \u00b7 ') || '\u00a0'));
            mount(wrap, row);
          });
          mount(container, wrap);
        }

        function renderPickFirst() {
          container.innerHTML = '';
          mount(container, el('p', 'sh-coach-sub', t('pickFirst')));
          var wrap = el('div', 'sh-recurring-topics');
          characters.forEach(function (c) {
            var row = el('div', 'sh-recurring-topic-row');
            row.addEventListener('click', function () { renderPickSecond(c); });
            mount(row, el('div', 'sh-recurring-topic-title', c.name));
            var metaBits = [c.type, c.roleType].filter(Boolean);
            mount(row, el('div', 'sh-recurring-topic-meta', metaBits.join(' \u00b7 ') || '\u00a0'));
            mount(wrap, row);
          });
          mount(container, wrap);
        }

        if (!instances.length) {
          renderPickFirst();
          return;
        }

        // Existing conflicts to resume, plus the option to start a new one.
        mount(container, el('p', 'sh-coach-sub', t('whichConflict')));
        var wrap = el('div', 'sh-recurring-topics');
        instances.forEach(function (inst) {
          var a = charById[inst.characterAId], b = charById[inst.characterBId];
          if (!a || !b) return; // a character behind this instance was since removed from the WIP — skip rather than show a broken row
          var row = el('div', 'sh-recurring-topic-row');
          row.addEventListener('click', function () {
            SELECTED_CONFLICT = { instanceId: inst.id, characterA: a, characterB: b, label: inst.label || null };
            sessSet(CONFLICT_LOCK_PREFIX + SESSION.slug, inst.id);
            showConflictIndicator(indicatorSlot);
            startExcavationProper();
          });
          mount(row, el('div', 'sh-recurring-topic-title', inst.label || (a.name + ' & ' + b.name)));
          mount(row, el('div', 'sh-recurring-topic-meta', inst.label ? (a.name + ' & ' + b.name) : '\u00a0'));
          mount(wrap, row);
        });
        var newRow = el('div', 'sh-recurring-topic-row');
        newRow.addEventListener('click', renderPickFirst);
        mount(newRow, el('div', 'sh-recurring-topic-title', t('startNewConflict')));
        mount(newRow, el('div', 'sh-recurring-topic-meta', '\u00a0'));
        mount(wrap, newRow);
        mount(container, wrap);
      });
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
    container.innerHTML = ''; // may be reached after resolveWipThenStart used this same container as scratch space for a WIP picker
    var shell = el('div', 'sh-wrap');
    if (window.StratumHeader) window.StratumHeader.buildTopbar(shell);

    var page = el('div', 'sh-coach-page');
    mount(page, el('h1', 'sh-coach-title', SESSION.title || ''));
    mount(page, el('p', 'sh-coach-sub', t('pickTopic')));

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
    if (days <= 0) return t('relToday');
    if (days === 1) return t('relYesterday');
    if (days < 7) return t('relDaysAgo', { n: days });
    var weeks = Math.floor(days / 7);
    if (weeks === 1) return t('relWeekAgo');
    if (weeks < 5) return t('relWeeksAgo', { n: weeks });
    return d.toLocaleDateString();
  }

  function renderTopicList() {
    topicListEl.innerHTML = '';
    if (!SESSION.layers.length) {
      mount(topicListEl, el('div', 'sh-coach-loading', t('noTopicsYet')));
      return;
    }
    SESSION.layers.forEach(function (layer, i) {
      var layerNotes = ALL_CHECKIN_NOTES.filter(function (n) { return n.layerNumber === layer.layerNumber; });
      var row = el('div', 'sh-recurring-topic-row');
      row.addEventListener('click', function () { startCheckin(i); });
      mount(row, el('div', 'sh-recurring-topic-title', layer.label));
      var meta = layerNotes.length
        ? t(layerNotes.length === 1 ? 'checkinCountOne' : 'checkinCountMany', { n: layerNotes.length, when: formatRelativeDate(layerNotes[layerNotes.length - 1].createdAt) })
        : t('noCheckinsYet');
      mount(row, el('div', 'sh-recurring-topic-meta', meta));
      mount(topicListEl, row);
    });
  }

  function startCheckin(layerIndex) {
    currentLayerIndex = layerIndex;
    var layer = SESSION.layers[layerIndex];
    loadLayerConfig(layer.layerNumber, function (cfg) {
      if (!cfg) { alert(t('topicNotSetUp')); return; }
      LAYER_CONFIG = cfg;
      if (SESSION.requiresCharacter) {
        resolveCharacterForCheckin(function () { reallyStartCheckin(layer); });
      } else {
        SELECTED_CHARACTER = null;
        reallyStartCheckin(layer);
      }
    });
  }

  // Sept 2026: Character Voice (and any future requiresCharacter
  // Writing/General topic) asks which existing character this check-in
  // is about BEFORE building the chat panel, so an existing Character
  // Development profile can be pulled in via fetchLinkedProfiles().
  // Deliberately NOT locked via sessionStorage the way the Excavation
  // engine's character picker is - "each visit is a fresh conversation"
  // already means a different visit may reasonably be about a different
  // character, so this is asked fresh every time a check-in starts
  // rather than remembered across the tab. Also unlike the Excavation
  // engine, this is enrichment, not a requirement: a "not about one
  // specific character" option is always offered, and having zero
  // characters in the WIP (or no WIP at all) never blocks starting the
  // check-in - it just proceeds with no character linked.
  function resolveCharacterForCheckin(onResolved) {
    var chatOuter = document.getElementById('shRecurringChatOuter');
    chatOuter.innerHTML = '';
    chatOuter.style.display = '';
    topicListEl.style.display = 'none';
    if (!ACTIVE_WIP_ID) {
      SELECTED_CHARACTER = null;
      onResolved();
      return;
    }
    fetchProjectData(function (project) {
      var characters = (project && Array.isArray(project.characters)) ? project.characters.filter(function (c) { return c.name; }) : [];
      if (!characters.length) {
        SELECTED_CHARACTER = null;
        onResolved();
        return;
      }
      chatOuter.innerHTML = '';
      mount(chatOuter, el('p', 'sh-coach-sub', t('whichCharacterCheckin')));
      var wrap = el('div', 'sh-recurring-topics');
      characters.forEach(function (c) {
        var row = el('div', 'sh-recurring-topic-row');
        row.addEventListener('click', function () {
          SELECTED_CHARACTER = c;
          CONTEXT_BLOCK_CACHE = null; // any cached context block was built for a different (or no) character - force a fresh fetch so the right profile gets pulled in
          onResolved();
        });
        mount(row, el('div', 'sh-recurring-topic-title', c.name));
        var metaBits = [c.type, c.roleType].filter(Boolean);
        mount(row, el('div', 'sh-recurring-topic-meta', metaBits.join(' \u00b7 ') || '\u00a0'));
        mount(wrap, row);
      });
      var skipRow = el('div', 'sh-recurring-topic-row');
      skipRow.addEventListener('click', function () {
        SELECTED_CHARACTER = null;
        CONTEXT_BLOCK_CACHE = null;
        onResolved();
      });
      mount(skipRow, el('div', 'sh-recurring-topic-title', t('notAboutOneCharacter')));
      mount(skipRow, el('div', 'sh-recurring-topic-meta', '\u00a0'));
      mount(wrap, skipRow);
      mount(chatOuter, wrap);
    });
  }

  function reallyStartCheckin(layer) {
    var chatOuter = document.getElementById('shRecurringChatOuter');
    chatOuter.innerHTML = '';
    chatOuter.style.display = '';
    topicListEl.style.display = 'none';
    var backLink = document.createElement('a');
    backLink.href = '#';
    backLink.className = 'sh-recurring-back';
    backLink.textContent = t('backToTopics');
    backLink.addEventListener('click', function (e) { e.preventDefault(); returnToTopicList(); });
    mount(chatOuter, backLink);
    mount(chatOuter, el('h2', 'sh-recurring-topic-heading', layer.label));
    if (SELECTED_CHARACTER) {
      mount(chatOuter, el('p', 'sh-coach-sub', t('aboutCharacter', { name: SELECTED_CHARACTER.name })));
    }
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
    summary.textContent = intro.title || t('beforeYouBegin');
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
    // Load this page's translated chrome before anything using t() runs,
    // including the gate messages - same ordering as stratum-practice.js.
    loadUiStrings().then(function () {
      var slug = window.STRATUM_SESSION_SLUG || '';
      if (!window.StratumSessions) {
        buildGate(container, t('notConfigured'), '/system/', t('backToDashboard'));
        return;
      }
      window.StratumSessions.ready(function () {
        SESSION = window.StratumSessions.get(slug);
        if (!SESSION) {
          buildGate(container, t('notConfigured'), '/system/', t('backToDashboard'));
          return;
        }
        if (!WP_USER.loggedIn) {
          buildGate(container, t('loginToStart'), WP_USER.loginUrl, t('logIn'));
          return;
        }
        if (!WP_USER.hasMembership) {
          buildGate(container, t('noMembership'), '/membership-account/', t('goToMyAccount'));
          return;
        }
        window.StratumIdentity.init(function (studentId) {
          if (!studentId) {
            buildGate(container, t('couldNotConnect'), '/system/', t('backToDashboard'));
            return;
          }
          STUDENT_ID = studentId;
          ENGINE_MODE = SESSION.track || 'excavation';
          if (ENGINE_MODE === 'excavation') {
            buildPage(container);
          } else {
            // Sept 2026: General/Writing sessions now resolve ACTIVE_WIP_ID
            // the same way Excavation sessions do (previously this engine
            // never called resolveWipThenStart at all, so fetchProjectData's
            // ACTIVE_WIP_ID guard silently returned null forever - no WIP
            // facts, no character list, and no linked-character profile
            // pull were ever possible here, even though buildProjectContextBlock
            // was written to include them). The indicator slot is
            // deliberately detached (never mounted) - recurring pages don't
            // show a "Working in: X" line the way Excavation pages do; see
            // afterWipResolved()'s ENGINE_MODE branch for what runs next.
            resolveWipThenStart(container, el('div'));
          }
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
  
