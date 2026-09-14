/* ============================================================
   STRATUM WIP PROFILE — PAGE LOGIC (Sept 2026)
   ------------------------------------------------------------
   The full work-in-progress form — same field set and options the
   old stratum-lesson-engine.js PROJECT_FIELDS used, so everything
   that already reads this data (buildProjectContextBlock() in the
   coach's system prompt, Global Instructions matching on Story
   Style/Genre/POV/Antagonist Type, etc.) keeps working unchanged.
   Reads/writes the SAME /project GET and POST endpoints, same field
   names — this is a new front end for existing data, not a new
   record shape.

   Two fields from the old form are deliberately NOT rendered here,
   per Ted's decision that account identity and WIP data are separate
   records now:
     - studentName — lives on the WordPress account (User Profile),
       not here. To avoid the shared /project POST endpoint blanking
       out the stored name (it writes whatever studentName it's given,
       unconditionally), this file re-sends the WP account's first
       name on every save rather than omitting the field.
     - language (the coaching-language NAME, e.g. "Spanish") — this is
       now set exclusively via the header's Language dropdown
       (PATCH /student/lang), which updates the same students.
       project_language column directly. Same reasoning: /project POST
       would blank it if omitted, so the value loaded from GET /project
       is held and re-sent unchanged on every save here, never edited
       on this page.

   Requires stratum-identity.js loaded first on this page (same as
   stratum-header.js) — this file does not duplicate identity
   resolution.
   ============================================================ */
(function () {
  'use strict';

  var PROXY_URL = window.StratumIdentity ? window.StratumIdentity.PROXY_URL : 'https://stratum-proxy.tedbaker0207.workers.dev';
  var WP_USER = window.StratumIdentity ? window.StratumIdentity.getWpUser() : { loggedIn: false, hasMembership: false, firstName: '', email: '', loginUrl: '#' };

  // Held-and-preserved values — loaded from GET /project, never edited
  // on this page, always re-sent unchanged on save. See file header.
  var preservedStudentName = WP_USER.firstName || '';
  var preservedLanguage = '';

  var FIELDS = [
    {
      row: [
        {
          key: 'type', id: 'wipType', type: 'select',
          label: 'Project type',
          hint: 'Novel, short story, screenplay, essay, or something else?',
          options: [
            ['', 'Choose one\u2026'], ['Novel', 'Novel'], ['Short Story', 'Short Story'],
            ['Screenplay', 'Screenplay'], ['Essay', 'Essay'], ['Other', 'Other']
          ]
        },
        {
          key: 'genre', id: 'wipGenre', type: 'select',
          label: 'Genre', hint: '',
          options: [
            ['', 'Choose a genre\u2026'],
            ['Thriller/Suspense', 'Thriller / Suspense'],
            ['Literary Fiction', 'Literary Fiction'],
            ['Historical Fiction', 'Historical Fiction'],
            ['Romance/Domestic Fiction', 'Romance / Domestic Fiction'],
            ['Fantasy/Science Fiction', 'Fantasy / Science Fiction'],
            ['Other', 'Other / Not sure yet']
          ]
        }
      ]
    },
    {
      key: 'stage', id: 'wipStage', type: 'select',
      label: 'Stage of progress',
      hint: 'Are you outlining, drafting, revising, or polishing?',
      options: [
        ['', 'Choose one\u2026'], ['Outlining', 'Outlining'], ['Drafting', 'Drafting'],
        ['Revising', 'Revising'], ['Polishing', 'Polishing']
      ]
    },
    {
      row: [
        {
          key: 'storyStyle', id: 'wipStoryStyle', type: 'select',
          label: 'Story style',
          hint: 'Is this driven more by plot or by character?',
          options: [
            ['', 'Choose one\u2026'], ['Plot Driven', 'Plot Driven'], ['Character Driven', 'Character Driven']
          ]
        },
        {
          key: 'pov', id: 'wipPov', type: 'select',
          label: 'Point of view', hint: '',
          options: [
            ['', 'Choose one\u2026'],
            ['First Person', 'First Person'],
            ['Second Person', 'Second Person'],
            ['Third Person Limited', 'Third Person Limited'],
            ['Third Person Omniscient', 'Third Person Omniscient'],
            ['Third Person Objective', 'Third Person Objective']
          ]
        }
      ]
    },
    {
      key: 'wipTitle', id: 'wipTitle', type: 'text', maxLength: 150,
      label: 'Working title', hint: '', placeholder: 'e.g. What the River Kept'
    },
    {
      row: [
        {
          key: 'mcName', id: 'wipMc', type: 'text', maxLength: 80,
          label: "Main character's name", hint: "Who's central to this story?",
          placeholder: 'e.g. Elena Vargas'
        },
        {
          key: 'antagonistName', id: 'wipAntagonist', type: 'text', maxLength: 80,
          label: "Antagonist's name", hint: 'Leave blank if not applicable',
          placeholder: 'e.g. Marcus Kellan'
        }
      ]
    },
    {
      key: 'antagonistType', id: 'wipAntagonistType', type: 'select',
      label: 'Type of antagonist',
      hint: 'Leave blank if not applicable',
      options: [
        ['', 'Choose one\u2026'],
        ['Villain', 'Villain'],
        ['Ideological', 'Ideological'],
        ['Societal', 'Societal'],
        ['Nature or Circumstance', 'Nature or Circumstance'],
        ['Internal', 'Internal'],
        ['Moral Foil', 'Moral Foil'],
        ['Ally', 'Ally'],
        ['Inanimate', 'Inanimate']
      ]
    },
    {
      key: 'mcGoal', id: 'wipMcGoal', type: 'textarea', maxLength: 400,
      label: 'Their core conflict or goal',
      hint: 'What are they chasing \u2014 or fighting against?',
      placeholder: 'A sentence or two is plenty.'
    },
    {
      key: 'theme', id: 'wipTheme', type: 'textarea', maxLength: 400,
      label: 'Theme or focus',
      hint: 'What big idea or emotional truth are you exploring?'
    },
    {
      key: 'challenges', id: 'wipChallenges', type: 'textarea', maxLength: 500,
      label: "Where you're stuck",
      hint: 'Plot, character depth, pacing, dialogue \u2014 whatever it is right now.'
    },
    {
      key: 'focus', id: 'wipFocus', type: 'select',
      label: 'What are you hoping to understand better right now?',
      hint: 'This shapes the kind of questions your coach leans toward.',
      options: [
        ['', 'Choose one\u2026'],
        ['character_depth', 'Whether my character feels real, not constructed'],
        ['dialogue', 'Whether my dialogue sounds authentic'],
        ['pacing_structure', 'Whether my pacing and structure are working'],
        ['emotional_impact', 'Whether the emotional beats are landing'],
        ['consistency', "Whether my character's choices feel consistent \u2014 or interestingly not"],
        ['not_sure', "I'm not sure yet \u2014 help me find it"]
      ]
    }
  ];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function mount(parent, child) { parent.appendChild(child); return child; }
  function eachFieldSpec(fn) {
    FIELDS.forEach(function (spec) {
      if (spec.row) spec.row.forEach(fn);
      else fn(spec);
    });
  }

  function buildField(spec) {
    var field = el('div', 'sh-field');
    var label = document.createElement('label');
    label.setAttribute('for', spec.id);
    label.textContent = spec.label;
    mount(field, label);
    if (spec.hint) mount(field, el('span', 'sh-field-hint', spec.hint));
    var input;
    if (spec.type === 'select') {
      input = document.createElement('select');
      spec.options.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt[0];
        o.textContent = opt[1];
        input.appendChild(o);
      });
    } else if (spec.type === 'textarea') {
      input = document.createElement('textarea');
      if (spec.maxLength) input.maxLength = spec.maxLength;
      if (spec.placeholder) input.placeholder = spec.placeholder;
    } else {
      input = document.createElement('input');
      input.type = 'text';
      if (spec.maxLength) input.maxLength = spec.maxLength;
      if (spec.placeholder) input.placeholder = spec.placeholder;
    }
    input.id = spec.id;
    mount(field, input);
    return field;
  }

  function fillForm(values) {
    eachFieldSpec(function (spec) {
      var node = document.getElementById(spec.id);
      if (node) node.value = values[spec.key] || '';
    });
  }

  function collectForm() {
    var out = {};
    eachFieldSpec(function (spec) {
      var node = document.getElementById(spec.id);
      out[spec.key] = node ? node.value.trim() : '';
    });
    return out;
  }

  function buildGate(container) {
    container.innerHTML = '';
    var wrap = el('div', 'sh-wrap sh-page');
    var body = el('div', 'sh-gate');
    var msg = WP_USER.loggedIn
      ? 'Your account doesn\u2019t have an active Stratum Method membership yet.'
      : 'Please log in to view your WIP profile.';
    mount(body, el('p', null, msg));
    var link = document.createElement('a');
    link.className = 'sh-save-btn';
    link.href = WP_USER.loggedIn ? '/membership-account/' : WP_USER.loginUrl;
    link.textContent = WP_USER.loggedIn ? 'Go to My Account' : 'Log in';
    mount(body, link);
    mount(wrap, body);
    mount(container, wrap);
  }

  function buildForm(container) {
    var wrap = el('div', 'sh-wrap sh-page');

    var topbar = el('div', 'sh-page-topbar');
    var back = document.createElement('a');
    back.className = 'sh-page-back';
    back.href = '/system/';
    back.textContent = '\u2190 Back to Dashboard';
    mount(topbar, back);
    mount(wrap, topbar);

    var body = el('div', 'sh-form-body');
    mount(body, el('h1', 'sh-form-title', 'My WIP'));
    mount(body, el('p', 'sh-form-sub', 'This is what your coach reads before every session \u2014 keep it current so the questions stay specific to your work, not generic.'));

    var form = document.createElement('div');
    FIELDS.forEach(function (spec) {
      if (spec.row) {
        var row = el('div', 'sh-field-row');
        spec.row.forEach(function (sub) { mount(row, buildField(sub)); });
        mount(form, row);
      } else {
        mount(form, buildField(spec));
      }
    });
    mount(body, form);

    var actions = el('div', 'sh-form-actions');
    var saveBtn = el('button', 'sh-save-btn', 'Save WIP Details');
    saveBtn.type = 'button';
    mount(actions, saveBtn);
    var status = el('span', 'sh-save-status');
    mount(actions, status);
    mount(body, actions);

    mount(wrap, body);
    mount(container, wrap);

    saveBtn.addEventListener('click', function () {
      window.StratumIdentity.init(function (studentId) {
        if (!studentId) {
          status.textContent = 'Could not save \u2014 account not linked yet. Refresh and try again.';
          status.className = 'sh-save-status sh-err';
          return;
        }
        var fields = collectForm();
        fields.studentId = studentId;
        fields.email = WP_USER.email;
        fields.studentName = preservedStudentName; // never edited here — see file header
        fields.language = preservedLanguage;        // never edited here — see file header
        saveBtn.disabled = true;
        status.textContent = 'Saving\u2026';
        status.className = 'sh-save-status';
        fetch(PROXY_URL + '/project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields)
        })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            saveBtn.disabled = false;
            if (d && d.ok) {
              status.textContent = 'Saved. Your coach will use this from your next session.';
              status.className = 'sh-save-status sh-ok';
            } else {
              status.textContent = 'Could not save \u2014 please try again.';
              status.className = 'sh-save-status sh-err';
            }
          })
          .catch(function () {
            saveBtn.disabled = false;
            status.textContent = 'Network error \u2014 please try again.';
            status.className = 'sh-save-status sh-err';
          });
      });
    });

    // Load current values.
    window.StratumIdentity.init(function (studentId) {
      if (!studentId) return;
      fetch(PROXY_URL + '/project?studentId=' + encodeURIComponent(studentId))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.known) return;
          fillForm(d);
          if (d.studentName) preservedStudentName = d.studentName;
          preservedLanguage = d.language || '';
        })
        .catch(function () {});
    });
  }

  function init() {
    var container = document.getElementById('stratum-wip-profile');
    if (!container) {
      console.error('[Stratum] No #stratum-wip-profile container found on this page.');
      return;
    }
    if (!WP_USER.loggedIn || !WP_USER.hasMembership) {
      buildGate(container);
      return;
    }
    buildForm(container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
