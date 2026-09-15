/* ============================================================
   STRATUM SESSIONS — SHARED REGISTRY (Sept 2026)
   ------------------------------------------------------------
   Single source of truth for coaching session metadata, consumed by:
     - stratum-header.js (the Coach nav dropdown)
     - stratum-coach.js (the actual coaching engine on each session's page)
     - stratum-excavation-center.js (the dashboard section listing
       sessions with their completion status)

   Before this file existed, the same facts (session label, href,
   layer ids/labels) were duplicated across stratum-header.js and
   stratum-coach.js independently — a real drift risk (add a session
   in one place, forget the other, and the two silently disagree).
   Adding a third consumer (Excavation Center) made a third copy of
   the same data indefensible, so this got pulled out now rather than
   compounding the problem further.

   Character Excavation is the only session that exists today; adding
   a future one (Essentials, Mastery) is one more entry here — no
   other file needs to change to pick it up, aside from
   synthesisEndpoint/masterDeliverableEndpoint below being Character-
   Excavation-specific in the Worker currently (LADDER_LESSON_IDS is
   hardcoded to the 1.x ids) — the Worker needs a matching
   generalization before a second session can synthesize its own
   deliverable. See stratum-coach.js for where that matters.

   Load this file BEFORE stratum-header.js, stratum-coach.js, and
   stratum-excavation-center.js on any page that uses any of them —
   same in-order loading requirement (async=false) as every other
   shared module in this codebase.
   ============================================================ */
(function () {
  'use strict';

  var SESSION_DEFINITIONS = {
    'character-excavation': {
      title: 'Character Excavation',
      href: '/coach/character-excavation/',
      tier: 'guided',
      synthesisEndpoint: '/excavation/synthesize',       // Character-Excavation-specific in the Worker today
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
    // on-screen labels are finalized.
  };

  // Ordered list — object key order isn't guaranteed in every JS engine
  // for non-integer-like keys, though it is in practice for modern
  // browsers; this makes display order an explicit, intentional choice
  // rather than relying on that.
  var SESSION_ORDER = ['character-excavation'];

  window.StratumSessions = {
    definitions: SESSION_DEFINITIONS,
    order: SESSION_ORDER,
    // Convenience accessor — returns [{ slug, ...definition }, ...] in
    // SESSION_ORDER, skipping any slug in ORDER with no matching
    // definition (defensive, shouldn't normally happen).
    list: function () {
      return SESSION_ORDER
        .filter(function (slug) { return !!SESSION_DEFINITIONS[slug]; })
        .map(function (slug) {
          var def = SESSION_DEFINITIONS[slug];
          return Object.assign({ slug: slug }, def);
        });
    },
    get: function (slug) { return SESSION_DEFINITIONS[slug] || null; }
  };
})();
