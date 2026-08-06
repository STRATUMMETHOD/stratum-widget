var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
var DEFAULT_POOL = 36;
var ALLOWED_MODELS = ["claude-sonnet-4-5"];
var DEFAULT_MODEL = "claude-sonnet-4-5";
var MAX_TOKENS_CEIL = 2e3;
var ADMIN_MAX_TOKENS = 8e3;
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Stratum-Admin-Key"
};
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS)
  });
}
__name(json, "json");
async function callAnthropic(payload, env, extraHeaders) {
  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: Object.assign(
      { "Content-Type": "application/json" },
      CORS,
      extraHeaders || {}
    )
  });
}
__name(callAnthropic, "callAnthropic");
function buildCourseCorpus(rows, includeFullText) {
  const out = [];
  for (const row of rows) {
    let cfg;
    try {
      cfg = JSON.parse(row.config_json);
    } catch (e) {
      continue;
    }
    const L = [];
    L.push("=== LESSON " + (cfg.lessonId || row.lesson_id) + " ===");
    if (cfg.scopeNote) L.push("Scope note: " + cfg.scopeNote);
    if (cfg.nextLessonLabel) L.push("Next lesson label: " + cfg.nextLessonLabel);
    const rf = cfg.reflectionFramework || {};
    const areas = Array.isArray(rf.areas) ? rf.areas : [];
    if (areas.length) {
      L.push("REFLECTION AREAS (" + areas.length + "):");
      areas.forEach(function(a, i) {
        L.push("  " + (i + 1) + ". " + (a.title || "(untitled)"));
        if (a.instructions) L.push("     " + a.instructions);
      });
    } else {
      L.push("REFLECTION AREAS: none entered yet");
    }
    if (rf.coachingApproach) L.push("COACHING APPROACH (coach-only):\n" + rf.coachingApproach);
    const cal = Array.isArray(rf.calibrationExamples) ? rf.calibrationExamples : [];
    if (cal.length) {
      L.push("CALIBRATION EXAMPLES (" + cal.length + "):");
      cal.forEach(function(c, i) {
        L.push("  " + (i + 1) + ". " + (typeof c === "string" ? c : JSON.stringify(c)));
      });
    }
    const g = cfg.greeting || {};
    if (g.fresh) L.push("GREETING (fresh): " + g.fresh);
    if (g.knownTemplate) L.push("GREETING (returning): " + g.knownTemplate);
    const langs = g.translations ? Object.keys(g.translations) : [];
    L.push("Greeting translations present: " + (langs.length ? langs.join(", ") : "none"));
    if (cfg.resource && cfg.resource.title) {
      L.push("RESOURCE: " + cfg.resource.title);
      if (includeFullText && cfg.resource.text) L.push("RESOURCE TEXT:\n" + cfg.resource.text);
    } else {
      L.push("RESOURCE: none");
    }
    if (includeFullText && cfg.transcript) L.push("LECTURE TRANSCRIPT:\n" + cfg.transcript);
    out.push(L.join("\n"));
  }
  return out.join("\n\n");
}
__name(buildCourseCorpus, "buildCourseCorpus");
var worker_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS });
    }
    const url = new URL(request.url);
    if (url.pathname === "/balance") {
      const studentId2 = url.searchParams.get("studentId");
      if (!studentId2) return json({ error: "missing studentId" }, 400);
      if (!env.DB) return json({ metered: false }, 200);
      const row = await env.DB.prepare("SELECT sessions_allowed, sessions_used, status FROM students WHERE student_id = ?").bind(studentId2).first();
      if (!row) {
        return json({
          metered: true,
          known: false,
          status: "active",
          allowed: DEFAULT_POOL,
          used: 0,
          remaining: DEFAULT_POOL
        }, 200);
      }
      return json({
        metered: true,
        known: true,
        status: row.status,
        allowed: row.sessions_allowed,
        used: row.sessions_used,
        remaining: Math.max(0, row.sessions_allowed - row.sessions_used)
      }, 200);
    }
    if (url.pathname === "/admin/student") {
      if (!env.STRATUM_ADMIN_KEY || request.headers.get("X-Stratum-Admin-Key") !== env.STRATUM_ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401);
      }
      if (!env.DB) return json({ error: "no database bound" }, 500);
      let b;
      try {
        b = await request.json();
      } catch (e) {
        return json({ error: "invalid JSON" }, 400);
      }
      if (!b.studentId) return json({ error: "missing studentId" }, 400);
      await env.DB.prepare("INSERT OR IGNORE INTO students (student_id, sessions_allowed) VALUES (?, ?)").bind(String(b.studentId), DEFAULT_POOL).run();
      if (b.sessionsAllowed != null) {
        await env.DB.prepare("UPDATE students SET sessions_allowed = ? WHERE student_id = ?").bind(Number(b.sessionsAllowed), String(b.studentId)).run();
      }
      if (b.status) {
        await env.DB.prepare("UPDATE students SET status = ? WHERE student_id = ?").bind(String(b.status), String(b.studentId)).run();
      }
      if (b.resetUsed) {
        await env.DB.prepare("UPDATE students SET sessions_used = 0 WHERE student_id = ?").bind(String(b.studentId)).run();
      }
      const row = await env.DB.prepare("SELECT * FROM students WHERE student_id = ?").bind(String(b.studentId)).first();
      return json({ ok: true, student: row }, 200);
    }
    if (url.pathname === "/project" && request.method === "GET") {
      const studentId2 = url.searchParams.get("studentId");
      if (!studentId2) return json({ error: "missing studentId" }, 400);
      if (!env.DB) return json({ known: false }, 200);
      const row = await env.DB.prepare("SELECT student_first_name, project_type, project_genre, project_stage, project_wip_title, project_mc_name, project_antagonist_name, project_mc_goal, project_theme, project_challenges, project_focus, project_language, project_updated_at FROM students WHERE student_id = ?").bind(studentId2).first();
      if (!row) return json({ known: false }, 200);
      return json({
        known: true,
        studentName: row.student_first_name || "",
        type: row.project_type || "",
        genre: row.project_genre || "",
        stage: row.project_stage || "",
        wipTitle: row.project_wip_title || "",
        mcName: row.project_mc_name || "",
        antagonistName: row.project_antagonist_name || "",
        mcGoal: row.project_mc_goal || "",
        theme: row.project_theme || "",
        challenges: row.project_challenges || "",
        focus: row.project_focus || "",
        language: row.project_language || "",
        updatedAt: row.project_updated_at || null
      }, 200);
    }
    if (url.pathname === "/project" && request.method === "POST") {
      if (!env.DB) return json({ error: "no database bound" }, 500);
      let b;
      try {
        b = await request.json();
      } catch (e) {
        return json({ error: "invalid JSON" }, 400);
      }
      if (!b.studentId) return json({ error: "missing studentId" }, 400);
      const studentId2 = String(b.studentId);
      const cap = /* @__PURE__ */ __name((v, max) => v == null ? "" : String(v).trim().slice(0, max), "cap");
      const studentName = cap(b.studentName, 60);
      const type = cap(b.type, 30);
      const genre = cap(b.genre, 60);
      const stage = cap(b.stage, 30);
      const wipTitle = cap(b.wipTitle, 150);
      const mcName = cap(b.mcName, 80);
      const antagonistName = cap(b.antagonistName, 80);
      const mcGoal = cap(b.mcGoal, 400);
      const theme = cap(b.theme, 400);
      const challenges = cap(b.challenges, 500);
      const focus = cap(b.focus, 30);
      const language = cap(b.language, 40);
      await env.DB.prepare("INSERT OR IGNORE INTO students (student_id, sessions_allowed) VALUES (?, ?)").bind(studentId2, DEFAULT_POOL).run();
      await env.DB.prepare("UPDATE students SET student_first_name = ?, project_type = ?, project_genre = ?, project_stage = ?, project_wip_title = ?, project_mc_name = ?, project_antagonist_name = ?, project_mc_goal = ?, project_theme = ?, project_challenges = ?, project_focus = ?, project_language = ?, project_updated_at = datetime('now') WHERE student_id = ?").bind(studentName, type, genre, stage, wipTitle, mcName, antagonistName, mcGoal, theme, challenges, focus, language, studentId2).run();
      return json({
        ok: true,
        studentName,
        type,
        genre,
        stage,
        wipTitle,
        mcName,
        antagonistName,
        mcGoal,
        theme,
        challenges,
        focus,
        language
      }, 200);
    }
    if (url.pathname === "/notes" && request.method === "GET") {
      const studentId2 = url.searchParams.get("studentId");
      if (!studentId2) return json({ error: "missing studentId" }, 400);
      if (!env.DB) return json({ known: false }, 200);
      const row = await env.DB.prepare("SELECT notes_text, notes_updated_at FROM students WHERE student_id = ?").bind(studentId2).first();
      if (!row || row.notes_text == null) return json({ known: false }, 200);
      return json({
        known: true,
        text: row.notes_text || "",
        updatedAt: row.notes_updated_at || null
      }, 200);
    }
    if (url.pathname === "/notes" && request.method === "POST") {
      if (!env.DB) return json({ error: "no database bound" }, 500);
      let b;
      try {
        b = await request.json();
      } catch (e) {
        return json({ error: "invalid JSON" }, 400);
      }
      if (!b.studentId) return json({ error: "missing studentId" }, 400);
      const studentId2 = String(b.studentId);
      const text = b.text == null ? "" : String(b.text).slice(0, 2e4);
      await env.DB.prepare("INSERT OR IGNORE INTO students (student_id, sessions_allowed) VALUES (?, ?)").bind(studentId2, DEFAULT_POOL).run();
      await env.DB.prepare("UPDATE students SET notes_text = ?, notes_updated_at = datetime('now') WHERE student_id = ?").bind(text, studentId2).run();
      return json({ ok: true }, 200);
    }
    if (url.pathname === "/tasks" && request.method === "GET") {
      const studentId2 = url.searchParams.get("studentId");
      if (!studentId2) return json({ error: "missing studentId" }, 400);
      if (!env.DB) return json({ known: false }, 200);
      const row = await env.DB.prepare("SELECT tasks_json, tasks_updated_at FROM students WHERE student_id = ?").bind(studentId2).first();
      if (!row || row.tasks_json == null) return json({ known: false }, 200);
      let tasks = [];
      try {
        tasks = JSON.parse(row.tasks_json) || [];
      } catch (e) {
        tasks = [];
      }
      return json({
        known: true,
        tasks,
        updatedAt: row.tasks_updated_at || null
      }, 200);
    }
    if (url.pathname === "/tasks" && request.method === "POST") {
      if (!env.DB) return json({ error: "no database bound" }, 500);
      let b;
      try {
        b = await request.json();
      } catch (e) {
        return json({ error: "invalid JSON" }, 400);
      }
      if (!b.studentId) return json({ error: "missing studentId" }, 400);
      const studentId2 = String(b.studentId);
      const tasks = Array.isArray(b.tasks) ? b.tasks.slice(0, 500) : [];
      const tasksJson = JSON.stringify(tasks).slice(0, 1e5);
      await env.DB.prepare("INSERT OR IGNORE INTO students (student_id, sessions_allowed) VALUES (?, ?)").bind(studentId2, DEFAULT_POOL).run();
      await env.DB.prepare("UPDATE students SET tasks_json = ?, tasks_updated_at = datetime('now') WHERE student_id = ?").bind(tasksJson, studentId2).run();
      return json({ ok: true }, 200);
    }
    if (url.pathname === "/complete" && request.method === "POST") {
      if (!env.DB) return json({ error: "no database bound" }, 500);
      let b;
      try {
        b = await request.json();
      } catch (e) {
        return json({ error: "invalid JSON" }, 400);
      }
      if (!b.studentId) return json({ error: "missing studentId" }, 400);
      if (!b.lesson) return json({ error: "missing lesson" }, 400);
      const studentId2 = String(b.studentId);
      const lesson = String(b.lesson);
      const summary = b.summary == null ? null : String(b.summary).slice(0, 500);
      await env.DB.prepare("INSERT OR IGNORE INTO students (student_id, sessions_allowed) VALUES (?, ?)").bind(studentId2, DEFAULT_POOL).run();
      await env.DB.prepare("INSERT INTO completions (student_id, lesson, summary, completed_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(student_id, lesson) DO UPDATE SET summary = excluded.summary, completed_at = excluded.completed_at").bind(studentId2, lesson, summary).run();
      return json({ ok: true }, 200);
    }
    if (url.pathname === "/completions" && request.method === "GET") {
      const studentId2 = url.searchParams.get("studentId");
      if (!studentId2) return json({ error: "missing studentId" }, 400);
      if (!env.DB) return json({ completions: [] }, 200);
      const { results } = await env.DB.prepare("SELECT lesson, summary FROM completions WHERE student_id = ? ORDER BY completed_at ASC").bind(studentId2).all();
      return json({ completions: results || [] }, 200);
    }
    if (url.pathname === "/transcript" && request.method === "GET") {
      const studentId2 = url.searchParams.get("studentId");
      const lesson2 = url.searchParams.get("lesson");
      if (!studentId2) return json({ error: "missing studentId" }, 400);
      if (!lesson2) return json({ error: "missing lesson" }, 400);
      if (!env.DB) return json({ known: false }, 200);
      const row = await env.DB.prepare("SELECT conversation_id, history_json, student_name, reflection_complete, updated_at FROM conversation_transcripts WHERE student_id = ? AND lesson = ?").bind(studentId2, lesson2).first();
      if (!row || !row.history_json) return json({ known: false }, 200);
      let history = [];
      try {
        history = JSON.parse(row.history_json) || [];
      } catch (e) {
        history = [];
      }
      return json({
        known: true,
        conversationId: row.conversation_id || null,
        history,
        studentName: row.student_name || "",
        reflectionComplete: !!row.reflection_complete,
        updatedAt: row.updated_at || null
      }, 200);
    }
    if (url.pathname === "/transcript" && request.method === "POST") {
      if (!env.DB) return json({ error: "no database bound" }, 500);
      let b;
      try {
        b = await request.json();
      } catch (e) {
        return json({ error: "invalid JSON" }, 400);
      }
      if (!b.studentId) return json({ error: "missing studentId" }, 400);
      if (!b.lesson) return json({ error: "missing lesson" }, 400);
      const studentId2 = String(b.studentId);
      const lesson2 = String(b.lesson);
      const conversationId2 = b.conversationId ? String(b.conversationId) : null;
      const history = Array.isArray(b.history) ? b.history : [];
      const historyJson = JSON.stringify(history).slice(0, 5e5);
      const studentName2 = b.studentName == null ? "" : String(b.studentName).slice(0, 60);
      const reflectionComplete2 = b.reflectionComplete ? 1 : 0;
      await env.DB.prepare("INSERT INTO conversation_transcripts (student_id, lesson, conversation_id, history_json, student_name, reflection_complete, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(student_id, lesson) DO UPDATE SET conversation_id = excluded.conversation_id, history_json = excluded.history_json, student_name = excluded.student_name, reflection_complete = excluded.reflection_complete, updated_at = excluded.updated_at").bind(studentId2, lesson2, conversationId2, historyJson, studentName2, reflectionComplete2).run();
      return json({ ok: true }, 200);
    }
    if (url.pathname === "/lesson-config" && request.method === "GET") {
      const lessonId = url.searchParams.get("lessonId");
      if (!lessonId) return json({ error: "missing lessonId" }, 400);
      if (!env.DB) return json({ known: false }, 200);
      const row = await env.DB.prepare("SELECT config_json, updated_at FROM lesson_configs WHERE lesson_id = ?").bind(lessonId).first();
      if (!row || !row.config_json) return json({ known: false }, 200);
      let config = null;
      try {
        config = JSON.parse(row.config_json);
      } catch (e) {
        return json({ known: false, error: "stored config is not valid JSON" }, 200);
      }
      return json({
        known: true,
        config,
        updatedAt: row.updated_at || null
      }, 200);
    }
    if (url.pathname === "/lesson-config" && request.method === "POST") {
      if (!env.STRATUM_ADMIN_KEY || request.headers.get("X-Stratum-Admin-Key") !== env.STRATUM_ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401);
      }
      if (!env.DB) return json({ error: "no database bound" }, 500);
      let b;
      try {
        b = await request.json();
      } catch (e) {
        return json({ error: "invalid JSON" }, 400);
      }
      if (!b.lessonId) return json({ error: "missing lessonId" }, 400);
      if (!b.config || typeof b.config !== "object") return json({ error: "missing config" }, 400);
      const lessonId = String(b.lessonId);
      const configJson = JSON.stringify(b.config);
      if (configJson.length > 5e5) return json({ error: "config too large" }, 413);
      await env.DB.prepare("INSERT INTO lesson_configs (lesson_id, config_json, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(lesson_id) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at").bind(lessonId, configJson).run();
      return json({ ok: true, lessonId }, 200);
    }
    if (url.pathname === "/lesson-configs" && request.method === "GET") {
      if (!env.STRATUM_ADMIN_KEY || request.headers.get("X-Stratum-Admin-Key") !== env.STRATUM_ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401);
      }
      if (!env.DB) return json({ lessons: [] }, 200);
      const { results } = await env.DB.prepare("SELECT lesson_id, updated_at FROM lesson_configs ORDER BY lesson_id ASC").all();
      return json({ lessons: results || [] }, 200);
    }
    if (url.pathname === "/admin/chat" && request.method === "POST") {
      if (!env.STRATUM_ADMIN_KEY || request.headers.get("X-Stratum-Admin-Key") !== env.STRATUM_ADMIN_KEY) {
        return json({ error: "unauthorized" }, 401);
      }
      if (!env.DB) return json({ error: "no database bound" }, 500);
      let b;
      try {
        b = await request.json();
      } catch (e) {
        return json({ error: "invalid JSON" }, 400);
      }
      const messages = Array.isArray(b.messages) ? b.messages : [];
      if (!messages.length) return json({ error: "missing messages" }, 400);
      const includeFullText = !!b.includeTranscripts;
      const { results } = await env.DB.prepare("SELECT lesson_id, config_json FROM lesson_configs ORDER BY lesson_id ASC").all();
      const rows = results || [];
      const corpus = buildCourseCorpus(rows, includeFullText);
      const system = [
        "You are Ted Baker's editorial partner on his fiction-writing course, Write Living Characters: A Fiction Writer's Masterclass, taught under the STRATUM brand.",
        "",
        "You are talking to Ted himself, not to a student. He is authoring the course. Speak to him as a collaborator: direct, specific, willing to disagree. Do not coach him and do not ask him Socratic questions - that is what the student-facing Excavation Coach does, and it is the wrong register here.",
        "",
        "WHAT YOU HAVE: the live configuration for every lesson currently stored in the course database, exactly as students will experience it. This is the source of truth. When Ted asks about continuity, overlap, gaps, or escalation across lessons, answer from this data rather than from assumption. If a lesson has no data entered yet, say so plainly rather than inferring what it probably contains.",
        "",
        "HOW THE COURSE WORKS: 12 lessons in four sections - Orientation (1.1-1.3), Awareness (2.1-2.3), Proof (3.1-3.3), Application (4.1-4.3). Each lesson has a video, an optional resource document, and one continuous coaching session. The session is driven by reflectionFramework.areas, which the coach walks through conversationally rather than as a rigid checklist. coachingApproach and calibrationExamples are private coach-only direction and are never shown to students.",
        "",
        "NON-NEGOTIABLE BRAND RULES when drafting anything:",
        "- The coach ASKS, it never ANSWERS. It does not generate content, interpret, summarise, or evaluate for the student. Anything you draft must preserve this.",
        "- Load-bearing vocabulary, never swapped for synonyms: excavation, substrate, compensation, construct, elenchus, Excavation Coach, Level (never Layer), Briefing, Coached Excavation.",
        "- Never use the phrase 'Socratic AI' - it belongs to a competitor.",
        "- Tone is precise and anti-adjective. No overclaiming, no hype, honest about what AI can and cannot do.",
        "- The method is Adlerian at root: wound gives rise to compensation, compensation calcifies into personality. Depth means reaching what a character or writer is protecting, not adding backstory.",
        "",
        "WHEN DRAFTING REFLECTION AREAS: each area needs a short uppercase title and instructions written to the coach, not to the student. Instructions should say what the area is trying to surface, what a surface answer looks like, and when to press. Check the existing areas across all lessons first and say explicitly which ones you are steering clear of and why.",
        "",
        "Be concrete. If Ted asks whether something repeats, name the specific lesson and the specific area it repeats, and quote the overlapping phrasing rather than describing it in the abstract.",
        "",
        "===== LIVE COURSE DATA (" + rows.length + " lessons stored) =====",
        "",
        corpus || "(no lessons have been entered yet)"
      ].join("\n");
      return callAnthropic({
        model: DEFAULT_MODEL,
        max_tokens: ADMIN_MAX_TOKENS,
        system,
        messages
      }, env, {
        "X-Stratum-Path": "admin-chat",
        "X-Stratum-Lessons": String(rows.length)
      });
    }
    if (request.method !== "POST") {
      return json({ error: "method not allowed" }, 405);
    }
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: "invalid JSON body" }, 400);
    }
    const meta = payload.stratum || null;
    delete payload.stratum;
    if (!meta || !meta.studentId || !env.DB) {
      return callAnthropic(payload, env, { "X-Stratum-Path": "legacy" });
    }
    const studentId = String(meta.studentId);
    const conversationId = meta.conversationId ? String(meta.conversationId) : null;
    const lesson = meta.lesson ? String(meta.lesson) : null;
    const email = meta.email ? String(meta.email) : null;
    if (!conversationId) {
      return json({ stratum_error: "missing_conversation_id" }, 400);
    }
    if (ALLOWED_MODELS.indexOf(payload.model) === -1) payload.model = DEFAULT_MODEL;
    payload.max_tokens = Math.min(Number(payload.max_tokens) || 1e3, MAX_TOKENS_CEIL);
    await env.DB.prepare("INSERT OR IGNORE INTO students (student_id, email, sessions_allowed) VALUES (?, ?, ?)").bind(studentId, email, DEFAULT_POOL).run();
    const student = await env.DB.prepare("SELECT sessions_allowed, sessions_used, status FROM students WHERE student_id = ?").bind(studentId).first();
    if (!student || student.status !== "active") {
      return json({ stratum_error: "account_suspended" }, 403);
    }
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO conversations (conversation_id, student_id, lesson, turns, last_at) VALUES (?, ?, ?, 0, datetime('now'))").bind(conversationId, studentId, lesson).run();
    const isNewConversation = claim.meta.changes === 1;
    if (isNewConversation) {
      const spend = await env.DB.prepare("UPDATE students SET sessions_used = sessions_used + 1, last_seen = datetime('now'), email = COALESCE(?, email) WHERE student_id = ? AND sessions_used < sessions_allowed").bind(email, studentId).run();
      if (spend.meta.changes === 0) {
        await env.DB.prepare("DELETE FROM conversations WHERE conversation_id = ?").bind(conversationId).run();
        return json({
          stratum_error: "pool_exhausted",
          allowed: student.sessions_allowed,
          used: student.sessions_used,
          remaining: 0
        }, 403);
      }
    } else {
      await env.DB.prepare("UPDATE conversations SET turns = turns + 1, last_at = datetime('now') WHERE conversation_id = ?").bind(conversationId).run();
    }
    const used = student.sessions_used + (isNewConversation ? 1 : 0);
    const remaining = Math.max(0, student.sessions_allowed - used);
    return callAnthropic(payload, env, {
      "X-Stratum-Path": "metered",
      "X-Stratum-Remaining": String(remaining),
      "X-Stratum-Allowed": String(student.sessions_allowed),
      "X-Stratum-New-Session": isNewConversation ? "1" : "0"
    });
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
