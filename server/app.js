"use strict";

require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const db = require("./db");
const articleDb = db.articleDb;
const content = require("./content");
const periods = require("./periods");
const auth = require("./auth");

const { syncCatalog } = require("./youtube");
const { generateArticle } = require("./gemini");
const { createWordPressDraft } = require("./wordpress");
const { getOrRunAudit, getAuditsSummary } = require("./audit");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());

const PUBLIC_DIR = path.join(__dirname, "..", "public");

/* ---------------- auth routes ---------------- */

app.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = auth.findUserByUsername(username);
  if (!user || !auth.verifyPassword(user, password)) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const { token, expires } = auth.createSession(user.id);
  res.cookie(auth.SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    expires: new Date(expires),
  });
  res.json({ ok: true, user: { id: user.id, name: user.name, username: user.username } });
});

app.post("/logout", (req, res) => {
  const token = req.cookies ? req.cookies[auth.SESSION_COOKIE] : null;
  if (token) auth.destroySession(token);
  res.clearCookie(auth.SESSION_COOKIE);
  res.json({ ok: true });
});

app.get("/api/me", auth.requireAuth(), (req, res) => {
  res.json({ user: req.user });
});

/* ---------------- Plan Checklist state & mutations ---------------- */

function getAllUsers() {
  return db.prepare("SELECT id, name, username FROM users ORDER BY name").all();
}

function currentTaskStatus(periodKeys) {
  const status = {};
  const rows = db.prepare(`
    SELECT te.task_id, te.period_key, te.action, te.at, u.name AS by_name
    FROM task_events te
    JOIN users u ON u.id = te.user_id
    WHERE te.id IN (
      SELECT MAX(id) FROM task_events GROUP BY task_id, period_key
    )
  `).all();

  rows.forEach((row) => {
    const period = content.TASK_INDEX[row.task_id];
    const expectedKey = period ? periodKeys[period] : null;
    if (!period || row.period_key !== expectedKey) return;
    status[row.task_id] = { done: row.action === "checked", by: row.by_name, at: row.at };
  });
  return status;
}

function currentCounters(monthKey) {
  const targets = {};
  content.COUNTERS.forEach((c) => { targets[c.id] = 0; });
  const rows = db.prepare("SELECT counter_id, value FROM counter_values WHERE period_key = ?").all(monthKey);
  rows.forEach((r) => { targets[r.counter_id] = r.value; });
  return targets;
}

function currentKpis() {
  const values = {};
  db.prepare("SELECT kpi_id, value FROM kpi_values").all().forEach((r) => { values[r.kpi_id] = r.value; });
  return values;
}

function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function computeStreak(periodKeys) {
  const dailyIds = content.DAILY.map((t) => t.id);
  const placeholders = dailyIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT period_key, task_id, action FROM task_events
    WHERE task_id IN (${placeholders})
    AND id IN (SELECT MAX(id) FROM task_events WHERE task_id IN (${placeholders}) GROUP BY task_id, period_key)
  `).all(...dailyIds, ...dailyIds);

  const byDay = {};
  rows.forEach((r) => {
    if (!byDay[r.period_key]) byDay[r.period_key] = new Set();
    if (r.action === "checked") byDay[r.period_key].add(r.task_id);
    else byDay[r.period_key].delete(r.task_id);
  });

  const cleanDays = new Set(
    Object.keys(byDay).filter((day) => dailyIds.every((id) => byDay[day].has(id)))
  );

  let n = 0;
  const d = new Date();
  for (let i = 0; i < 400; i++) {
    const key = periods.dayKey(d);
    if (cleanDays.has(key)) { n++; d.setDate(d.getDate() - 1); }
    else if (i === 0 && key !== periodKeys.daily) { d.setDate(d.getDate() - 1); }
    else break;
  }
  return n;
}

app.get("/api/state", auth.requireAuth(), (req, res) => {
  const periodKeys = periods.currentKeys();
  res.json({
    user: req.user,
    users: getAllUsers(),
    periodKeys,
    content: {
      DAILY: content.DAILY, WEEKLY: content.WEEKLY, MONTHLY: content.MONTHLY,
      QUARTERLY: content.QUARTERLY, SEASONAL: content.SEASONAL, BUILD: content.BUILD,
      KPIS: content.KPIS, COUNTERS: content.COUNTERS, RATES: content.RATES, STOP: content.STOP
    },
    taskStatus: currentTaskStatus(periodKeys),
    counters: currentCounters(periodKeys.monthly),
    kpis: currentKpis(),
    runRate: Number(getSetting("runRate", "44000")),
    streak: computeStreak(periodKeys)
  });
});

app.post("/api/toggle", auth.requireAuth(), (req, res) => {
  const { taskId } = req.body || {};
  const period = content.TASK_INDEX[taskId];
  if (!period) return res.status(400).json({ error: "unknown_task" });

  const periodKey = periods.currentKeys()[period];
  const last = db.prepare(`
    SELECT action FROM task_events
    WHERE task_id = ? AND period_key = ?
    ORDER BY id DESC LIMIT 1
  `).get(taskId, periodKey);

  const nextAction = last && last.action === "checked" ? "unchecked" : "checked";
  db.prepare("INSERT INTO task_events (task_id, period_key, user_id, action) VALUES (?, ?, ?, ?)")
    .run(taskId, periodKey, req.user.id, nextAction);

  res.json({ ok: true, taskId, done: nextAction === "checked", by: req.user.name });
});

app.post("/api/counter", auth.requireAuth(), (req, res) => {
  const { counterId, delta } = req.body || {};
  if (!content.COUNTER_IDS.has(counterId) || ![1, -1].includes(delta)) {
    return res.status(400).json({ error: "invalid_request" });
  }
  const periodKey = periods.currentKeys().monthly;
  const existing = db.prepare("SELECT value FROM counter_values WHERE counter_id = ? AND period_key = ?")
    .get(counterId, periodKey);
  const nextValue = Math.max(0, (existing ? existing.value : 0) + delta);

  db.prepare(`
    INSERT INTO counter_values (counter_id, period_key, value, updated_by, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(counter_id, period_key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(counterId, periodKey, nextValue, req.user.id);

  res.json({ ok: true, counterId, value: nextValue });
});

app.post("/api/kpi", auth.requireAuth(), (req, res) => {
  const { kpiId, value } = req.body || {};
  if (!content.KPI_IDS.has(kpiId)) return res.status(400).json({ error: "unknown_kpi" });
  db.prepare(`
    INSERT INTO kpi_values (kpi_id, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(kpi_id) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(kpiId, String(value ?? ""), req.user.id);
  res.json({ ok: true });
});

app.post("/api/runrate", auth.requireAuth(), (req, res) => {
  const value = Number(req.body && req.body.value);
  if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: "invalid_value" });
  db.prepare(`
    INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('runRate', ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(String(value), req.user.id);
  res.json({ ok: true, value });
});

/* ---------------- Article Generator endpoints ---------------- */

// Videos Catalog
app.get("/api/videos", auth.requireAuth(), (req, res) => {
  try {
    const { search, status, contentType } = req.query;

    let query = "SELECT * FROM videos WHERE 1=1";
    const params = [];

    if (status && status !== "all") {
      query += " AND status = ?";
      params.push(status);
    }

    if (contentType && contentType !== "all") {
      query += " AND content_type = ?";
      params.push(contentType);
    }

    if (search) {
      query += " AND (title LIKE ? OR description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    query += " ORDER BY published_at DESC";

    const videos = articleDb.prepare(query).all(...params);
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/videos/:id", auth.requireAuth(), (req, res) => {
  try {
    const { id } = req.params;
    const { content_type, custom_notes } = req.body;

    const stmt = articleDb.prepare(`
      UPDATE videos
      SET content_type = COALESCE(?, content_type),
          custom_notes = COALESCE(?, custom_notes)
      WHERE youtube_id = ?
    `);

    stmt.run(content_type, custom_notes, id);
    const updated = articleDb.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(id);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/videos/reset", auth.requireAuth(), (req, res) => {
  try {
    const { youtubeIds } = req.body;
    if (!youtubeIds || !Array.isArray(youtubeIds) || youtubeIds.length === 0) {
      return res.status(400).json({ error: "youtubeIds array is required." });
    }

    const stmt = articleDb.prepare(`
      UPDATE videos
      SET status = 'unprocessed',
          wp_post_id = NULL,
          wp_draft_url = NULL
      WHERE youtube_id = ?
    `);

    for (const id of youtubeIds) {
      stmt.run(id);
    }

    res.json({ success: true, count: youtubeIds.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// YouTube Catalog Sync
app.post("/api/sync", auth.requireAuth(), async (req, res) => {
  try {
    const { mode } = req.body;
    const result = await syncCatalog(mode || "delta");
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Content Templates
app.get("/api/templates", auth.requireAuth(), (req, res) => {
  try {
    const templates = articleDb.prepare("SELECT * FROM content_templates ORDER BY created_at ASC").all();
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/templates", auth.requireAuth(), (req, res) => {
  try {
    const { name, description, prompt_template } = req.body;
    if (!name || !prompt_template) {
      return res.status(400).json({ error: "Name and Prompt Template are required." });
    }

    const stmt = articleDb.prepare(`
      INSERT INTO content_templates (name, description, prompt_template)
      VALUES (?, ?, ?)
    `);

    const info = stmt.run(name, description || "", prompt_template);
    const newTemplate = articleDb.prepare("SELECT * FROM content_templates WHERE id = ?").get(info.lastInsertRowid);
    res.json(newTemplate);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/templates/:id", auth.requireAuth(), (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, prompt_template } = req.body;

    const stmt = articleDb.prepare(`
      UPDATE content_templates
      SET name = ?, description = ?, prompt_template = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(name, description, prompt_template, id);
    const updated = articleDb.prepare("SELECT * FROM content_templates WHERE id = ?").get(id);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/templates/:id", auth.requireAuth(), (req, res) => {
  try {
    const { id } = req.params;
    articleDb.prepare("DELETE FROM content_templates WHERE id = ?").run(id);
    res.json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// App Settings
app.get("/api/settings", auth.requireAuth(), (req, res) => {
  try {
    const rows = articleDb.prepare("SELECT * FROM app_settings").all();
    const settings = {};
    rows.forEach((r) => {
      settings[r.key] = r.value;
    });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/settings", auth.requireAuth(), (req, res) => {
  try {
    const settings = req.body;
    const stmt = articleDb.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

    Object.entries(settings).forEach(([key, value]) => {
      stmt.run(key, String(value));
    });

    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Article Generation & WordPress Publishing
app.post("/api/process", auth.requireAuth(), async (req, res) => {
  try {
    const { youtubeIds, modelOverride, thinkingModeOverride } = req.body;

    if (!youtubeIds || !Array.isArray(youtubeIds) || youtubeIds.length === 0) {
      return res.status(400).json({ error: "youtubeIds array is required." });
    }

    const results = [];

    for (const yId of youtubeIds) {
      const video = articleDb.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(yId);
      if (!video) {
        results.push({ youtubeId: yId, success: false, error: "Video not found in local catalog." });
        continue;
      }

      try {
        const htmlContent = await generateArticle({
          youtubeId: video.youtube_id,
          title: video.title,
          contentType: video.content_type,
          customNotes: video.custom_notes,
          modelOverride,
          thinkingModeOverride,
        });

        const { wpPostId, wpDraftUrl } = await createWordPressDraft({
          youtubeId: video.youtube_id,
          title: video.title,
          htmlContent,
          publishedAt: video.published_at,
          thumbnailUrl: video.thumbnail_url,
        });

        articleDb.prepare(`
          UPDATE videos
          SET status = 'draft_created',
              wp_post_id = ?,
              wp_draft_url = ?
          WHERE youtube_id = ?
        `).run(wpPostId, wpDraftUrl, yId);

        results.push({
          youtubeId: yId,
          success: true,
          wpPostId,
          wpDraftUrl,
        });
      } catch (err) {
        console.error(`Error processing video ${yId}:`, err);
        results.push({
          youtubeId: yId,
          success: false,
          error: err.message,
        });
      }
    }

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ---------------- Video Audit endpoints ---------------- */

app.get("/api/audits/summary", auth.requireAuth(), (req, res) => {
  try {
    const summary = getAuditsSummary();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/audit/:youtubeId", auth.requireAuth(), async (req, res) => {
  try {
    const { youtubeId } = req.params;
    const forceRefresh = req.query.refresh === "true";
    const audit = await getOrRunAudit(youtubeId, forceRefresh);
    res.json(audit);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/audit/:youtubeId", auth.requireAuth(), async (req, res) => {
  try {
    const { youtubeId } = req.params;
    const audit = await getOrRunAudit(youtubeId, true);
    res.json(audit);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* ---------------- static files & SPA fallback ---------------- */

app.get("/login.html", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "login.html")));
app.use(express.static(PUBLIC_DIR));

app.get("*", auth.requireAuth({ redirectToLogin: true }), (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  const indexPath = path.join(PUBLIC_DIR, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) next();
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Electric Duo Command Center running on port ${PORT}`);
});
