"use strict";

require("dotenv").config();
const path = require("path");
const express = require("express");
const fs = require("fs");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const axios = require("axios");
const db = require("./db");
const articleDb = db.articleDb;
const content = require("./content");
const periods = require("./periods");
const auth = require("./auth");

const { syncCatalog, purgeNonPublicVideos, syncAllVideoDurations, addManualVideo } = require("./youtube");
const { generateArticle, getGeminiApiKey, callGeminiWithRetry, DEFAULT_GEMINI_MODEL } = require("./gemini");
const { createWordPressDraft } = require("./wordpress");
const { getOrRunAudit, getAuditsSummary } = require("./audit");
const { GoogleGenAI } = require("@google/genai");
const competitorComparison = require("./competitor-comparison");
const fathomNewsRouter = require("./fathom-news");

const { loadRules, fixSrt, srtToPlainText } = require("../fixTranscript");
const { addTerm, listTerms, removeVariant } = require("../termList");
const {
  fetchRawCaptionsAsSrt,
  fixCaptionSrt,
  saveCaptionRecord,
  uploadCaptionsToYoutube,
  processVideoCaptions,
  convertRawTranscriptToSrt,
} = require("./captions");
const termsPath = path.join(__dirname, "..", "ev_terms.json");

const app = express();
app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://img.youtube.com", "https://i.ytimg.com"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'self'"],
      },
    },
  })
);

app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts from this IP, please try again in 15 minutes." },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many API requests, please try again later." },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI generation requests, please try again in an hour." },
});

app.use("/api/", apiLimiter);

const PUBLIC_DIR = path.join(__dirname, "..", "public");

/* ---------------- auth routes ---------------- */

app.post("/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const user = auth.findUserByUsername(username);
  if (!user || !auth.verifyPassword(user, password)) {
    const ip = req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress;
    console.warn(`[Auth] Failed login attempt for username "${username}" from IP ${ip}`);
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const { token, expires } = auth.createSession(user.id);
  res.cookie(auth.SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure,
    expires: new Date(expires),
  });
  res.json({ ok: true, user: { id: user.id, name: user.name, username: user.username, is_admin: Boolean(user.is_admin) } });
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

app.get("/api/version", (req, res) => {
  const pkg = require("../package.json");
  res.json({
    version: pkg.version || "2.1.0",
    name: pkg.name,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/changelog", (req, res, next) => {
  try {
    const changelogPath = path.join(__dirname, "..", "CHANGELOG.md");
    if (fs.existsSync(changelogPath)) {
      const content = fs.readFileSync(changelogPath, "utf8");
      res.type("text/markdown").send(content);
    } else {
      res.status(404).send("CHANGELOG.md not found");
    }
  } catch (err) {
    next(err);
  }
});

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
app.get("/api/videos", auth.requireAuth(), (req, res, next) => {
  try {
    const { search, status, contentType, privacy, excludeShorts, captionStatus } = req.query;

    let query = "SELECT * FROM videos WHERE 1=1";
    const params = [];

    // Privacy filter
    if (privacy === "unlisted") {
      query += " AND privacy_status = 'unlisted'";
    } else if (privacy === "all") {
      // Include all videos (public and unlisted)
    } else {
      // Default: only public videos
      query += " AND (privacy_status IS NULL OR privacy_status = 'public')";
    }

    if (status && status !== "all") {
      query += " AND status = ?";
      params.push(status);
    }

    if (contentType && contentType !== "all") {
      query += " AND content_type = ?";
      params.push(contentType);
    }

    if (captionStatus && captionStatus !== "all") {
      if (captionStatus === "none") {
        query += " AND (caption_status IS NULL OR caption_status = 'none')";
      } else {
        query += " AND caption_status = ?";
        params.push(captionStatus);
      }
    }

    if (search) {
      query += " AND (title LIKE ? OR description LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    query += " ORDER BY published_at DESC";

    let videos = articleDb.prepare(query).all(...params);

    if (excludeShorts === "true" || excludeShorts === true) {
      videos = videos.filter((v) => {
        const titleLower = (v.title || "").toLowerCase();
        if (titleLower.includes("#shorts") || titleLower.includes("shorts")) return false;
        if (!v.duration) return true;
        const match = v.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (match) {
          const h = parseInt(match[1] || "0", 10);
          const m = parseInt(match[2] || "0", 10);
          const s = parseInt(match[3] || "0", 10);
          const sec = h * 3600 + m * 60 + s;
          if (sec < 240) return false;
        }
        return true;
      });
    }

    res.json(videos);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/videos/:id", auth.requireAuth(), (req, res, next) => {
  try {
    const { id } = req.params;
    const allowed = ["content_type", "custom_notes", "working_title", "status", "caption_status"];
    const updates = [];
    const values = [];

    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }

    if (updates.length > 0) {
      values.push(id);
      articleDb.prepare(`UPDATE videos SET ${updates.join(", ")} WHERE youtube_id = ?`).run(...values);
    }

    const updated = articleDb.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(id);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.post("/api/videos/reset", auth.requireAuth(), (req, res, next) => {
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
    next(error);
  }
});

// YouTube Catalog Sync
const handleCatalogSync = async (req, res, next) => {
  try {
    const { mode } = req.body || {};
    const result = await syncCatalog(mode || "delta");
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

app.post("/api/sync", auth.requireAuth(), handleCatalogSync);
app.post("/api/catalog/sync", auth.requireAuth(), handleCatalogSync);

// YouTube Catalog Non-Public Video Purge
const handlePurgeNonPublic = async (req, res, next) => {
  try {
    const result = await purgeNonPublicVideos();
    res.json(result);
  } catch (error) {
    next(error);
  }
};

app.post("/api/catalog/purge-non-public", auth.requireAuth(), handlePurgeNonPublic);
app.post("/api/admin/purge-non-public", auth.requireAuth(), auth.requireAdmin(), handlePurgeNonPublic);

// Manually Add Unlisted Video
const handleAddUnlisted = async (req, res, next) => {
  try {
    const { urlOrId } = req.body || {};
    if (!urlOrId || !urlOrId.trim()) {
      return res.status(400).json({ error: "YouTube URL or Video ID is required." });
    }
    const video = await addManualVideo(urlOrId.trim(), "unlisted");
    res.json({ success: true, video });
  } catch (error) {
    next(error);
  }
};

app.post("/api/catalog/add-unlisted", auth.requireAuth(), handleAddUnlisted);
app.post("/api/admin/add-unlisted", auth.requireAuth(), auth.requireAdmin(), handleAddUnlisted);

// Content Templates
app.get("/api/templates", auth.requireAuth(), (req, res, next) => {
  try {
    const templates = articleDb.prepare("SELECT * FROM content_templates ORDER BY name COLLATE NOCASE ASC").all();
    res.json(templates);
  } catch (error) {
    next(error);
  }
});

app.post("/api/templates", auth.requireAuth(), (req, res, next) => {
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
    next(error);
  }
});

app.put("/api/templates/:id", auth.requireAuth(), (req, res, next) => {
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
    next(error);
  }
});

app.delete("/api/templates/:id", auth.requireAuth(), (req, res, next) => {
  try {
    const { id } = req.params;
    articleDb.prepare("DELETE FROM content_templates WHERE id = ?").run(id);
    res.json({ success: true, id });
  } catch (error) {
    next(error);
  }
});

// App Settings
app.get("/api/settings", auth.requireAuth(), (req, res, next) => {
  try {
    const rows = articleDb.prepare("SELECT * FROM app_settings").all();
    const settings = {};
    rows.forEach((r) => {
      settings[r.key] = r.value;
    });
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings", auth.requireAuth(), (req, res, next) => {
  try {
    const settings = req.body;
    const stmt = articleDb.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

    Object.entries(settings).forEach(([key, value]) => {
      stmt.run(key, String(value));
    });

    res.json({ success: true, settings });
  } catch (error) {
    next(error);
  }
});

// Article Generation & WordPress Publishing
app.post("/api/process", auth.requireAuth(), aiLimiter, async (req, res, next) => {
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
    next(error);
  }
});

// Single Video Article Generation with Custom Prompt Notes & Photos
app.post("/api/articles/generate-single", auth.requireAuth(), aiLimiter, async (req, res, next) => {
  try {
    const { youtubeId, templateName, customNotes, photos, modelOverride, thinkingModeOverride } = req.body || {};

    if (!youtubeId) {
      return res.status(400).json({ error: "youtubeId is required." });
    }

    const video = articleDb.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(youtubeId);
    if (!video) {
      return res.status(404).json({ error: "Video not found in catalog." });
    }

    const selectedTemplate = templateName || video.content_type || "Review";

    // Update video record notes and content_type
    articleDb.prepare("UPDATE videos SET content_type = ?, custom_notes = ? WHERE youtube_id = ?").run(
      selectedTemplate,
      customNotes || video.custom_notes || "",
      youtubeId
    );

    // Process uploaded photos (up to 3) to WordPress Media Library
    const uploadedPhotoUrls = [];
    if (photos && Array.isArray(photos) && photos.length > 0) {
      const { uploadMediaFile } = require("./wordpress");
      for (const [idx, p] of photos.slice(0, 3).entries()) {
        try {
          if (p.data) {
            const base64Clean = p.data.replace(/^data:image\/[a-z]+;base64,/, "");
            const buffer = Buffer.from(base64Clean, "base64");
            const filename = p.name || `photo-${youtubeId}-${idx + 1}.jpg`;
            const uploaded = await uploadMediaFile(buffer, filename, p.mimeType || "image/jpeg");
            if (uploaded && uploaded.url) {
              uploadedPhotoUrls.push({ url: uploaded.url, name: filename, id: uploaded.id });
            }
          }
        } catch (photoErr) {
          console.warn("Photo upload warning:", photoErr.message);
        }
      }
    }

    // Generate Article with Gemini 3.7 Flash
    const htmlContent = await generateArticle({
      youtubeId: video.youtube_id,
      title: video.title,
      contentType: selectedTemplate,
      customNotes: customNotes || video.custom_notes,
      photos: uploadedPhotoUrls,
      modelOverride,
      thinkingModeOverride,
    });

    // Create WordPress Post Draft
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
    `).run(wpPostId, wpDraftUrl, youtubeId);

    res.json({
      success: true,
      youtubeId,
      wpPostId,
      wpDraftUrl,
      photosUploaded: uploadedPhotoUrls.length,
    });
  } catch (error) {
    console.error("Single article generation error:", error);
    next(error);
  }
});

/* ---------------- Video Audit endpoints ---------------- */

app.get("/api/audits/summary", auth.requireAuth(), (req, res, next) => {
  try {
    const summary = getAuditsSummary();
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

app.get("/api/audit/:youtubeId", auth.requireAuth(), async (req, res, next) => {
  try {
    const { youtubeId } = req.params;
    const forceRefresh = req.query.refresh === "true";
    const audit = await getOrRunAudit(youtubeId, forceRefresh);
    res.json(audit);
  } catch (error) {
    next(error);
  }
});

app.post("/api/audit/:youtubeId", auth.requireAuth(), async (req, res, next) => {
  try {
    const { youtubeId } = req.params;
    const audit = await getOrRunAudit(youtubeId, true);
    res.json(audit);
  } catch (error) {
    next(error);
  }
});

/* ---------------- Transcripts & EV Vocabulary endpoints ---------------- */

// 1. Preview cleaned transcript & corrections summary without saving
app.post("/api/transcripts/preview", auth.requireAuth(), (req, res, next) => {
  try {
    const { srtText, isVtt } = req.body || {};
    if (!srtText || typeof srtText !== "string") {
      return res.status(400).json({ error: "srtText is required." });
    }
    const normalizedSrt = convertRawTranscriptToSrt(srtText);
    const termsData = JSON.parse(fs.readFileSync(termsPath, "utf8"));
    const rules = loadRules(termsData);
    const { output, log, summary } = fixSrt(normalizedSrt, rules, { isVtt: !!isVtt });
    const plainText = srtToPlainText(output);
    res.json({
      raw_srt: normalizedSrt,
      cleaned_srt: output,
      plain_text: plainText,
      summary,
      log,
    });
  } catch (error) {
    next(error);
  }
});

// 2. Save transcript linked 1:1 to video
app.post("/api/transcripts/:videoId", auth.requireAuth(), (req, res, next) => {
  try {
    const { videoId } = req.params;
    const { raw_srt, cleaned_srt, plain_text } = req.body || {};
    if (!raw_srt || !cleaned_srt) {
      return res.status(400).json({ error: "raw_srt and cleaned_srt are required." });
    }
    const plainText = plain_text || srtToPlainText(cleaned_srt);

    const stmt = articleDb.prepare(`
      INSERT INTO transcripts (video_id, raw_srt, cleaned_srt, plain_text, status, updated_at)
      VALUES (?, ?, ?, ?, 'fixed', CURRENT_TIMESTAMP)
      ON CONFLICT(video_id) DO UPDATE SET
        raw_srt = excluded.raw_srt,
        cleaned_srt = excluded.cleaned_srt,
        plain_text = excluded.plain_text,
        status = 'fixed',
        updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(videoId, raw_srt, cleaned_srt, plainText);

    // Also update videos.transcript and caption_status
    articleDb.prepare("UPDATE videos SET transcript = ?, caption_status = 'fixed' WHERE youtube_id = ?").run(plainText, videoId);

    const saved = articleDb.prepare("SELECT * FROM transcripts WHERE video_id = ?").get(videoId);
    res.json({ success: true, transcript: saved });
  } catch (error) {
    next(error);
  }
});

// 3. Get transcript for a video
app.get("/api/transcripts/:videoId", auth.requireAuth(), (req, res, next) => {
  try {
    const { videoId } = req.params;
    const transcript = articleDb.prepare("SELECT * FROM transcripts WHERE video_id = ?").get(videoId);
    const video = articleDb.prepare("SELECT youtube_id, title, duration, thumbnail_url, working_title, privacy_status, caption_status FROM videos WHERE youtube_id = ?").get(videoId);
    if (!transcript) {
      return res.status(404).json({ error: "Transcript not found for this video.", video: video || null });
    }
    res.json({ ...transcript, video });
  } catch (error) {
    next(error);
  }
});

// 4. Download Cleaned SRT file
app.get("/api/transcripts/:videoId/download", auth.requireAuth(), (req, res, next) => {
  try {
    const { videoId } = req.params;
    const transcript = articleDb.prepare("SELECT cleaned_srt FROM transcripts WHERE video_id = ?").get(videoId);
    if (!transcript || !transcript.cleaned_srt) {
      return res.status(404).send("Transcript not found for video.");
    }
    res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${videoId}-cleaned.srt"`);
    res.send(transcript.cleaned_srt);
  } catch (error) {
    next(error);
  }
});

// 4a. Retrieve raw YouTube captions (Bypasses Data API restrictions)
app.post("/api/videos/:videoId/captions/retrieve", auth.requireAuth(), async (req, res) => {
  try {
    const { videoId } = req.params;
    const { overwrite } = req.body || {};

    const existing = articleDb.prepare("SELECT * FROM transcripts WHERE video_id = ?").get(videoId);
    if (existing && (existing.raw_srt || existing.cleaned_srt) && !overwrite) {
      return res.status(409).json({
        promptConfirmation: true,
        message: "Captions already exist for this video. Overwrite existing captions?",
      });
    }

    const { srt, chunkCount } = await fetchRawCaptionsAsSrt(videoId);
    const fixed = fixCaptionSrt(srt);

    const saved = saveCaptionRecord(videoId, {
      raw_srt: srt,
      cleaned_srt: fixed.cleaned_srt,
      plain_text: fixed.plain_text,
      status: "unfixed",
    });

    res.json({
      success: true,
      videoId,
      status: "unfixed",
      chunkCount,
      summary: fixed.summary,
      transcript: saved,
    });
  } catch (error) {
    console.warn(`[Captions] Retrieve captions error for ${req.params?.videoId}:`, error.message);
    res.status(500).json({
      error: error.message,
      canQuickPaste: error.canQuickPaste ?? false,
      youtubeUrl: error.youtubeUrl || `https://www.youtube.com/watch?v=${req.params?.videoId}`,
      isCloudIpBlock: error.isCloudIpBlock ?? false,
      isScopeError: !!error.isScopeError,
      isAuthError: !!error.isAuthError,
    });
  }
});

// 4a-2. Paste raw transcript text or copied YouTube transcript directly
app.post("/api/videos/:videoId/captions/paste", auth.requireAuth(), (req, res, next) => {
  try {
    const { videoId } = req.params;
    const inputText = (req.body?.text || req.body?.rawText || "").trim();
    if (!inputText) {
      return res.status(400).json({ error: "Transcript text is required." });
    }

    const srt = convertRawTranscriptToSrt(inputText);
    const fixed = fixCaptionSrt(srt);
    const chunkCount = (srt.match(/-->/g) || []).length;

    const saved = saveCaptionRecord(videoId, {
      raw_srt: srt,
      cleaned_srt: fixed.cleaned_srt,
      plain_text: fixed.plain_text,
      status: "fixed",
    });

    res.json({
      success: true,
      videoId,
      status: "fixed",
      chunkCount,
      summary: fixed.summary,
      transcript: saved,
    });
  } catch (error) {
    next(error);
  }
});

// 4b. Clean existing captions with EV terminology
app.post("/api/videos/:videoId/captions/clean", auth.requireAuth(), (req, res, next) => {
  try {
    const { videoId } = req.params;
    const transcript = articleDb.prepare("SELECT * FROM transcripts WHERE video_id = ?").get(videoId);
    if (!transcript || !transcript.raw_srt) {
      return res.status(404).json({ error: "No raw captions found for this video. Retrieve captions first." });
    }

    const fixed = fixCaptionSrt(transcript.raw_srt);
    const saved = saveCaptionRecord(videoId, {
      raw_srt: transcript.raw_srt,
      cleaned_srt: fixed.cleaned_srt,
      plain_text: fixed.plain_text,
      status: "fixed",
    });

    res.json({
      success: true,
      videoId,
      status: "fixed",
      summary: fixed.summary,
      transcript: saved,
    });
  } catch (error) {
    next(error);
  }
});

// 4c. Upload cleaned SRT subtitle track to YouTube Data API v3
app.post("/api/videos/:videoId/captions/upload", auth.requireAuth(), async (req, res, next) => {
  try {
    const { videoId } = req.params;
    const transcript = articleDb.prepare("SELECT * FROM transcripts WHERE video_id = ?").get(videoId);
    if (!transcript || !transcript.cleaned_srt) {
      return res.status(400).json({ error: "Cleaned captions are not available. Clean transcript first." });
    }

    const uploadRes = await uploadCaptionsToYoutube(videoId, transcript.cleaned_srt);
    res.json({
      success: true,
      videoId,
      status: "uploaded",
      captionId: uploadRes.captionId,
    });
  } catch (error) {
    next(error);
  }
});

// 4d. Full Orchestrator: retrieve -> fix -> save -> upload
app.post("/api/videos/:videoId/captions/orchestrate", auth.requireAuth(), async (req, res, next) => {
  try {
    const { videoId } = req.params;
    const result = await processVideoCaptions(videoId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// 5. EV Terms Registry: list all terms
app.get("/api/terms", auth.requireAuth(), (req, res, next) => {
  try {
    const rows = listTerms(termsPath);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// 6. EV Terms Registry: add term mapping
app.post("/api/terms", auth.requireAuth(), (req, res, next) => {
  try {
    const category = req.body?.category;
    const correct = req.body?.correct || req.body?.term;
    const wrong = req.body?.wrong || req.body?.variant;
    if (!category || !correct || !wrong) {
      return res.status(400).json({ error: "category, correct, and wrong are required." });
    }
    const result = addTerm(termsPath, category.trim(), correct.trim(), wrong.trim());
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// 7. EV Terms Registry: remove variant
app.delete("/api/terms", auth.requireAuth(), (req, res, next) => {
  try {
    const category = req.body?.category;
    const correct = req.body?.correct || req.body?.term;
    const wrong = req.body?.wrong || req.body?.variant;
    if (!category || !correct || !wrong) {
      return res.status(400).json({ error: "category, correct, and wrong are required." });
    }
    const result = removeVariant(termsPath, category.trim(), correct.trim(), wrong.trim());
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

/* ---------------- Title Prompt Settings & Gemini Generation ---------------- */

// 1. Get Title & Thumbnail Prompt Instructions
app.get("/api/title-prompt-settings", auth.requireAuth(), (req, res, next) => {
  try {
    const row = articleDb.prepare("SELECT instructions, thumbnail_instructions, updated_at FROM title_prompt_settings WHERE id = 1").get();
    res.json(row || { instructions: "", thumbnail_instructions: "", updated_at: null });
  } catch (error) {
    next(error);
  }
});

// 2. Update Title & Thumbnail Prompt Instructions
app.put("/api/title-prompt-settings", auth.requireAuth(), (req, res, next) => {
  try {
    const { instructions, thumbnail_instructions } = req.body || {};
    const current = articleDb.prepare("SELECT instructions, thumbnail_instructions FROM title_prompt_settings WHERE id = 1").get() || {};
    const newInstructions = typeof instructions === "string" ? instructions : (current.instructions || "");
    const newThumbnail = typeof thumbnail_instructions === "string" ? thumbnail_instructions : (current.thumbnail_instructions || "");

    articleDb.prepare(`
      INSERT INTO title_prompt_settings (id, instructions, thumbnail_instructions, updated_at)
      VALUES (1, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        instructions = excluded.instructions,
        thumbnail_instructions = excluded.thumbnail_instructions,
        updated_at = CURRENT_TIMESTAMP
    `).run(newInstructions, newThumbnail);

    const updated = articleDb.prepare("SELECT instructions, thumbnail_instructions, updated_at FROM title_prompt_settings WHERE id = 1").get();
    res.json({ success: true, ok: true, ...updated });
  } catch (error) {
    next(error);
  }
});

// 3. Generate Gemini Title Suggestions (8 structured candidates with thumbnail words)
app.post("/api/videos/:videoId/generate-titles", auth.requireAuth(), aiLimiter, async (req, res, next) => {
  try {
    const { videoId } = req.params;
    const { context } = req.body || {};

    const video = articleDb.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(videoId);
    if (!video) {
      return res.status(404).json({ error: "Video not found in catalog." });
    }

    // Check for saved transcript
    const transRow = articleDb.prepare("SELECT plain_text FROM transcripts WHERE video_id = ?").get(videoId);
    const plainText = (transRow && transRow.plain_text) || video.transcript;
    if (!plainText || plainText.trim().length < 20) {
      return res.status(400).json({ error: "A saved transcript is required first before generating title ideas." });
    }

    // Retrieve title and thumbnail prompt instructions
    const promptRow = articleDb.prepare("SELECT instructions, thumbnail_instructions FROM title_prompt_settings WHERE id = 1").get();
    const titlePrompt = promptRow?.instructions || "You are a YouTube title strategist for The Electric Duo.";
    const thumbPrompt = promptRow?.thumbnail_instructions || "Suggest 1-3 punchy thumbnail words (2-4 words maximum) per candidate.";

    const systemPrompt = `${titlePrompt}\n\n=== THUMBNAIL WORDS INSTRUCTIONS ===\n${thumbPrompt}`;

    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      return res.status(400).json({ error: "Gemini API Key is not configured." });
    }

    const ai = new GoogleGenAI({ apiKey });

    let configuredModel = DEFAULT_GEMINI_MODEL;
    try {
      const row = articleDb.prepare("SELECT value FROM app_settings WHERE key = 'default_model'").get();
      if (row && row.value) configuredModel = row.value;
    } catch (e) {
      console.warn("Error reading default_model app setting:", e.message);
    }

    let userPrompt = `Video Title: "${video.title}"\n`;
    if (context && context.trim()) {
      userPrompt += `Creator Context & Highlights:\n${context.trim()}\n\n`;
    }
    userPrompt += `Cleaned Transcript:\n${plainText.slice(0, 45000)}\n\nGenerate exactly 8 high-CTR title suggestions adhering to all channel rules. For each candidate, also generate 2-4 punchy thumbnail words or phrase according to the thumbnail instructions. Return them as a JSON array matching the required schema.`;

    const requestOptions = {
      model: configuredModel,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "The YouTube title candidate" },
              charCount: { type: "integer", description: "Character count of the title" },
              first40Preview: { type: "string", description: "First 40 characters truncated for mobile survival" },
              emotion: {
                type: "string",
                enum: ["curiosity", "desire", "fear_negativity"],
                description: "Primary emotional psychological driver"
              },
              rationale: { type: "string", description: "One sentence explaining why this works for this specific video" },
              deliversOnPromise: {
                type: "boolean",
                description: "True if the video content actually backs up what the title implies"
              },
              thumbnailWords: {
                type: "string",
                description: "2 to 4 ultra-punchy thumbnail words or phrase (e.g. 'BIGGEST MISTAKE', '740 MILES LATER')"
              }
            },
            required: ["title", "charCount", "first40Preview", "emotion", "rationale", "deliversOnPromise", "thumbnailWords"]
          }
        }
      }
    };

    const response = await callGeminiWithRetry(ai, requestOptions, 2);
    let rawText = response.text || "";
    rawText = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

    let candidates = [];
    try {
      candidates = JSON.parse(rawText);
    } catch (parseErr) {
      const match = rawText.match(/\[[\s\S]*\]/);
      if (match) candidates = JSON.parse(match[0]);
    }

    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("Gemini AI failed to return valid title candidates. Response was: " + rawText.slice(0, 200));
    }

    // Ensure all 8 candidates are properly formatted
    const formatted = candidates.slice(0, 8).map((c) => {
      const title = (c.title || "").trim();
      const charCount = typeof c.charCount === "number" ? c.charCount : title.length;
      const first40Preview = c.first40Preview || title.slice(0, 40);
      const emotion = ["curiosity", "desire", "fear_negativity"].includes(c.emotion) ? c.emotion : "curiosity";
      const rationale = c.rationale || "";
      const deliversOnPromise = typeof c.deliversOnPromise === "boolean" ? c.deliversOnPromise : true;
      const thumbnailWords = (c.thumbnailWords || "").trim();
      return {
        title,
        charCount,
        first40Preview,
        emotion,
        rationale,
        deliversOnPromise,
        thumbnailWords,
      };
    });

    // Persist suggestions in database so they can be reloaded
    articleDb.prepare("UPDATE videos SET title_suggestions = ? WHERE youtube_id = ?")
      .run(JSON.stringify(formatted), videoId);

    res.json({ success: true, candidates: formatted });
  } catch (error) {
    console.error("Gemini title generation error:", error);
    next(error);
  }
});

// 4. Retrieve Previously Generated Title Suggestions
app.get("/api/videos/:videoId/title-suggestions", auth.requireAuth(), (req, res, next) => {
  try {
    const { videoId } = req.params;
    const row = articleDb.prepare("SELECT title_suggestions FROM videos WHERE youtube_id = ?").get(videoId);
    let candidates = [];
    if (row && row.title_suggestions) {
      try {
        candidates = JSON.parse(row.title_suggestions);
      } catch (e) {
        candidates = [];
      }
    }
    res.json({ ok: true, candidates, suggestions: candidates });
  } catch (error) {
    next(error);
  }
});

// 5. Save Selected Working Title to Video Record
app.post("/api/videos/:videoId/working-title", auth.requireAuth(), (req, res, next) => {
  try {
    const { videoId } = req.params;
    const { workingTitle } = req.body || {};
    articleDb.prepare("UPDATE videos SET working_title = ? WHERE youtube_id = ?").run(workingTitle || null, videoId);
    res.json({ success: true, videoId, working_title: workingTitle || null });
  } catch (error) {
    next(error);
  }
});

// 6. Manually Edit and Save Local Video Title
app.patch("/api/videos/:videoId/title", auth.requireAuth(), (req, res, next) => {
  try {
    const { videoId } = req.params;
    const { title } = req.body || {};
    const newTitle = (title || "").trim();
    if (!newTitle) {
      return res.status(400).json({ error: "Title cannot be empty." });
    }
    articleDb.prepare("UPDATE videos SET working_title = ? WHERE youtube_id = ?").run(newTitle, videoId);
    const updated = articleDb.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(videoId);
    res.json({ ok: true, title: newTitle, video: updated });
  } catch (error) {
    next(error);
  }
});

// 7. Push Local Title to YouTube via Google OAuth (User-Confirmed Action)
app.post("/api/videos/:videoId/title/push", auth.requireAuth(), async (req, res, next) => {
  try {
    const { videoId } = req.params;
    const { title } = req.body || {};
    const video = articleDb.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(videoId);
    if (!video) {
      return res.status(404).json({ error: "Video not found in catalog." });
    }
    const newTitle = typeof title === "string" ? title.trim() : (video.working_title || video.title || "").trim();
    if (!newTitle) {
      return res.status(400).json({ error: "Title to push cannot be empty." });
    }

    const { updateYoutubeVideoTitle } = require("./youtube");
    await updateYoutubeVideoTitle(videoId, newTitle);

    articleDb.prepare("UPDATE videos SET title = ?, youtube_title = ?, working_title = ? WHERE youtube_id = ?")
      .run(newTitle, newTitle, newTitle, videoId);

    const updated = articleDb.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(videoId);
    res.json({ ok: true, video: updated, message: `Successfully pushed title to YouTube: "${newTitle}"` });
  } catch (error) {
    next(error);
  }
});

/* ---------------- Google OAuth & YouTube Analytics endpoints ---------------- */

const youtubeAnalytics = require("./youtube-analytics");

app.get("/api/auth/google", auth.requireAuth(), auth.requireAdmin(), (req, res) => {
  try {
    const token = req.cookies ? req.cookies[auth.SESSION_COOKIE] : null;
    const state = crypto.randomBytes(24).toString("hex");
    auth.setSessionOAuthState(token, state);
    const url = youtubeAnalytics.generateAuthUrl(state);
    res.redirect(url);
  } catch (error) {
    res.status(400).send(`<html><body style="background:#020617;color:#f87171;font-family:sans-serif;padding:40px;"><h2>Google OAuth Configuration Error</h2><p>${error.message}</p><a href="/?module=admin" style="color:#38bdf8;">Return to Admin Settings</a></body></html>`);
  }
});

app.get("/api/auth/google/callback", auth.requireAuth(), auth.requireAdmin(), async (req, res) => {
  const { code, error, state } = req.query;
  const token = req.cookies ? req.cookies[auth.SESSION_COOKIE] : null;
  const storedState = auth.getSessionOAuthState(token);
  auth.clearSessionOAuthState(token);

  if (!state || !storedState || state !== storedState) {
    return res.status(400).send(`<html><body style="background:#020617;color:#f87171;font-family:sans-serif;padding:40px;"><h2>Invalid OAuth State</h2><p>Invalid or expired OAuth state token. Reconnect rejected for security.</p><a href="/?module=admin" style="color:#38bdf8;">Return to Admin Settings</a></body></html>`);
  }

  if (error) {
    return res.redirect(`/?module=admin&oauth_error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect(`/?module=admin&oauth_error=no_code`);
  }

  try {
    await youtubeAnalytics.handleAuthCallback(code);
    res.redirect(`/?module=admin&oauth_success=true`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(`/?module=admin&oauth_error=${encodeURIComponent(err.message)}`);
  }
});

app.post("/api/auth/google/disconnect", auth.requireAuth(), auth.requireAdmin(), (req, res, next) => {
  try {
    youtubeAnalytics.disconnectOAuth();
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/oauth-status", auth.requireAuth(), auth.requireAdmin(), async (req, res, next) => {
  try {
    const status = await youtubeAnalytics.getOAuthStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

/* ---------------- Admin & Settings endpoints ---------------- */

const bcrypt = require("bcryptjs");

// 1. Account Management
app.get("/api/admin/users", auth.requireAuth(), auth.requireAdmin(), (req, res, next) => {
  try {
    const users = db.prepare("SELECT id, name, username, is_admin, created_at FROM users ORDER BY name ASC").all();
    res.json(users);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users", auth.requireAuth(), auth.requireAdmin(), (req, res, next) => {
  try {
    const { name, username, password, is_admin } = req.body || {};
    if (!name || !username || !password) {
      return res.status(400).json({ error: "Name, username, and password are required." });
    }
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare("INSERT INTO users (name, username, password_hash, is_admin) VALUES (?, ?, ?, ?)").run(
      name,
      username.trim().toLowerCase(),
      hash,
      is_admin ? 1 : 0
    );
    res.json({ success: true, userId: info.lastInsertRowid });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users/password", auth.requireAuth(), (req, res, next) => {
  try {
    const { userId, newPassword } = req.body || {};
    if (!userId || !newPassword) {
      return res.status(400).json({ error: "User ID and new password are required." });
    }
    const targetId = Number(userId);
    const requesterId = Number(req.user.id);
    const isAdmin = Boolean(req.user.is_admin);

    if (targetId !== requesterId && !isAdmin) {
      return res.status(403).json({ error: "Forbidden: You can only change your own password." });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, targetId);
    auth.destroyUserSessions(targetId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 2. Integrations & API Keys
app.get("/api/admin/integrations", auth.requireAuth(), auth.requireAdmin(), (req, res, next) => {
  try {
    const rows = articleDb.prepare("SELECT * FROM app_settings").all();
    const settings = {};
    rows.forEach((r) => { settings[r.key] = r.value; });

    const rawSecret = settings.google_client_secret || process.env.GOOGLE_CLIENT_SECRET || "";

    res.json({
      youtube_channel_id: settings.youtube_channel_id || process.env.YOUTUBE_CHANNEL_ID || "UCuhhyTS-Q66qq-gWrCcTOzg",
      youtube_api_key_configured: !!(settings.youtube_api_key || process.env.YOUTUBE_API_KEY),
      google_client_id: settings.google_client_id || process.env.GOOGLE_CLIENT_ID || "",
      google_client_secret_configured: !!rawSecret,
      gemini_api_key_configured: !!(settings.gemini_api_key || process.env.GEMINI_API_KEY),
      wp_site_url: settings.wp_site_url || process.env.WP_SITE_URL || "https://theelectricduo.com",
      wp_username: settings.wp_username || process.env.WP_USERNAME || "patricka",
      wp_password_configured: !!(settings.wp_application_password || process.env.WP_APPLICATION_PASSWORD),
      default_model: settings.default_model || "gemini-3.7-flash",
      thinking_mode: settings.thinking_mode || "standard",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/integrations", auth.requireAuth(), auth.requireAdmin(), (req, res, next) => {
  try {
    const {
      youtube_api_key,
      youtube_channel_id,
      google_client_id,
      google_client_secret,
      gemini_api_key,
      wp_site_url,
      wp_username,
      wp_application_password,
      default_model,
      thinking_mode,
    } = req.body || {};

    const stmt = articleDb.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

    if (youtube_api_key && youtube_api_key.trim()) stmt.run("youtube_api_key", youtube_api_key.trim());
    if (youtube_channel_id && youtube_channel_id.trim()) stmt.run("youtube_channel_id", youtube_channel_id.trim());
    if (google_client_id !== undefined && google_client_id !== null && google_client_id.trim()) stmt.run("google_client_id", google_client_id.trim());
    if (google_client_secret !== undefined && google_client_secret !== null && google_client_secret.trim()) stmt.run("google_client_secret", google_client_secret.trim());
    if (gemini_api_key && gemini_api_key.trim()) stmt.run("gemini_api_key", gemini_api_key.trim());
    if (wp_site_url && wp_site_url.trim()) stmt.run("wp_site_url", wp_site_url.trim());
    if (wp_username && wp_username.trim()) stmt.run("wp_username", wp_username.trim());
    if (wp_application_password && wp_application_password.trim()) stmt.run("wp_application_password", wp_application_password.trim());
    if (default_model && default_model.trim()) stmt.run("default_model", default_model.trim());
    if (thinking_mode && thinking_mode.trim()) stmt.run("thinking_mode", thinking_mode.trim());

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 3. Test Connections
app.post("/api/admin/test-connection", auth.requireAuth(), auth.requireAdmin(), async (req, res) => {
  const { service } = req.body || {};
  try {
    if (service === "youtube") {
      const { getYoutubeClient, getYoutubeChannelId } = require("./youtube");
      const youtube = getYoutubeClient();
      const channelId = getYoutubeChannelId();
      const start = Date.now();
      const response = await youtube.channels.list({ part: "snippet", id: channelId });
      const latency = Date.now() - start;
      const title = response.data.items?.[0]?.snippet?.title || "Channel found";
      return res.json({ ok: true, message: `Connected to YouTube channel: "${title}" (${latency}ms)` });
    }

    if (service === "gemini") {
      const { GoogleGenAI } = require("@google/genai");
      const { getGeminiApiKey, DEFAULT_GEMINI_MODEL } = require("./gemini");
      const apiKey = getGeminiApiKey();
      if (!apiKey) throw new Error("Gemini API key is not configured.");
      const ai = new GoogleGenAI({ apiKey });

      let configuredModel = DEFAULT_GEMINI_MODEL;
      try {
        const row = articleDb.prepare("SELECT value FROM app_settings WHERE key = 'default_model'").get();
        if (row && row.value) configuredModel = row.value;
      } catch (e) {
        console.warn("Could not read default_model for connection test:", e.message);
      }

      const fastModels = [
        configuredModel,
        DEFAULT_GEMINI_MODEL,
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.5-flash-lite",
      ].filter((m, i, arr) => m && arr.indexOf(m) === i);

      let lastErr = null;
      for (const m of fastModels) {
        try {
          const start = Date.now();
          const response = await ai.models.generateContent({
            model: m,
            contents: "Respond with the single word: OK",
          });
          const latency = Date.now() - start;
          const reply = response.text ? response.text.trim() : "OK";
          return res.json({
            ok: true,
            model: m,
            latency,
            message: `Connected to Gemini API using ${m} (${latency}ms) — Response: ${reply}`,
          });
        } catch (err) {
          lastErr = err;
          console.warn(`Fast test connection attempt on ${m} failed:`, err.message);
        }
      }
      throw lastErr || new Error("Gemini API connection test failed.");
    }

    if (service === "wordpress") {
      const wpSiteUrl = (process.env.WP_SITE_URL || "https://theelectricduo.com").replace(/\/$/, "");
      const username = process.env.WP_USERNAME || "patricka";
      const password = process.env.WP_APPLICATION_PASSWORD;
      const authStr = Buffer.from(`${username}:${password}`).toString("base64");
      const start = Date.now();
      const response = await axios.get(`${wpSiteUrl}/wp-json/wp/v2/users/me`, {
        headers: { Authorization: `Basic ${authStr}` },
        timeout: 6000,
      });
      const latency = Date.now() - start;
      return res.json({ ok: true, message: `Authenticated as WordPress user "${response.data.name || username}" (${latency}ms)` });
    }

    res.status(400).json({ error: "Unknown service: " + service });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || "Connection failed";
    res.status(500).json({ ok: false, error: msg });
  }
});

// 4. Backfill exact durations for all videos
app.post("/api/catalog/sync-durations", auth.requireAuth(), async (req, res, next) => {
  try {
    const { syncAllVideoDurations } = require("./youtube");
    const result = await syncAllVideoDurations();
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// 5. Available AI Models (Returns cached or live from Google AI Studio)
app.get("/api/models", auth.requireAuth(), async (req, res) => {
  try {
    const { fetchAvailableGeminiModels } = require("./gemini");
    // Check cached models first
    try {
      const row = articleDb.prepare("SELECT value FROM app_settings WHERE key = 'cached_gemini_models'").get();
      if (row && row.value) {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return res.json(parsed);
        }
      }
    } catch (e) {
      console.warn("Could not read or parse cached_gemini_models:", e.message);
    }

    // Fetch live from AI Studio
    const models = await fetchAvailableGeminiModels();
    res.json(models);
  } catch (error) {
    // Verified fallback active models if API temporarily busy
    res.json([
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Latest Preview)", recommended: true },
      { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash (Recommended · Multimodal)", recommended: true },
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite (Sub-Second Latency)" },
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    ]);
  }
});

// 5b. Refresh Models from Google AI Studio Live
app.post("/api/models/refresh", auth.requireAuth(), async (req, res, next) => {
  try {
    const { fetchAvailableGeminiModels } = require("./gemini");
    const models = await fetchAvailableGeminiModels();
    res.json({ success: true, count: models.length, models });
  } catch (error) {
    next(error);
  }
});

/* ---------------- Channel Health & Snapshots endpoints ---------------- */

const channelHealth = require("./channel-health");

app.get("/api/channel-health/report", auth.requireAuth(), async (req, res, next) => {
  try {
    const periodDays = parseInt(req.query.period || "28", 10);
    const report = await channelHealth.getChannelHealthReport(periodDays);
    res.json(report);
  } catch (error) {
    next(error);
  }
});

app.post("/api/channel-health/snapshot", auth.requireAuth(), async (req, res, next) => {
  try {
    const periodDays = parseInt(req.body?.periodDays || "28", 10);
    const result = await channelHealth.captureSnapshot(periodDays);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/channel-health/video-catalog", auth.requireAuth(), (req, res, next) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "50", 10);
    const search = req.query.search || "";
    const category = req.query.category || "";
    const catalog = channelHealth.getVideoCatalog({ page, limit, search, category });
    res.json(catalog);
  } catch (error) {
    next(error);
  }
});

app.get("/api/channel-health/categories", auth.requireAuth(), (req, res, next) => {
  try {
    res.json(channelHealth.getCategories());
  } catch (error) {
    next(error);
  }
});

app.post("/api/channel-health/categories", auth.requireAuth(), (req, res, next) => {
  try {
    const cat = channelHealth.addCategory(req.body || {});
    res.json({ success: true, category: cat });
  } catch (error) {
    next(error);
  }
});

app.put("/api/channel-health/categories/:id", auth.requireAuth(), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const cat = channelHealth.updateCategory(id, req.body || {});
    res.json({ success: true, category: cat });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/channel-health/categories/:id", auth.requireAuth(), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = channelHealth.deleteCategory(id);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/channel-health/reclassify", auth.requireAuth(), async (req, res, next) => {
  try {
    const result = await channelHealth.bulkReclassifyLibrary();
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/channel-health/override-category", auth.requireAuth(), (req, res, next) => {
  try {
    const { youtubeId, category } = req.body || {};
    if (!youtubeId || !category) return res.status(400).json({ error: "youtubeId and category are required." });
    const result = channelHealth.overrideVideoCategory(youtubeId, category);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/channel-health/batch-override-categories", auth.requireAuth(), (req, res, next) => {
  try {
    const { updates } = req.body || {};
    if (!updates || !Array.isArray(updates)) {
      return res.status(400).json({ error: "updates array is required." });
    }
    const result = channelHealth.batchOverrideVideoCategories(updates);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/channel-health/annotations", auth.requireAuth(), (req, res, next) => {
  try {
    res.json(channelHealth.getAnnotations());
  } catch (error) {
    next(error);
  }
});

app.post("/api/channel-health/annotations", auth.requireAuth(), (req, res, next) => {
  try {
    const anno = channelHealth.addAnnotation(req.body || {});
    res.json({ success: true, annotation: anno });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/channel-health/annotations/:id", auth.requireAuth(), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    res.json(channelHealth.deleteAnnotation(id));
  } catch (error) {
    next(error);
  }
});

app.get("/api/channel-health/playlists", auth.requireAuth(), (req, res, next) => {
  try {
    res.json(channelHealth.getPlaylistMappings());
  } catch (error) {
    next(error);
  }
});

app.post("/api/channel-health/playlists", auth.requireAuth(), (req, res, next) => {
  try {
    res.json(channelHealth.savePlaylistMapping(req.body || {}));
  } catch (error) {
    next(error);
  }
});

app.delete("/api/channel-health/playlists/:id", auth.requireAuth(), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    res.json(channelHealth.deletePlaylistMapping(id));
  } catch (error) {
    next(error);
  }
});

/* ---------------- Competitor Comparison Endpoints ---------------- */

// 1. List all saved comparison reports
app.get("/api/comparison/reports", auth.requireAuth(), (req, res, next) => {
  try {
    const reports = competitorComparison.listSavedReports();
    res.json(reports);
  } catch (error) {
    next(error);
  }
});

// 2. Get specific comparison report by ID
app.get("/api/comparison/reports/:id", auth.requireAuth(), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const report = competitorComparison.getReportById(id);
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }
    res.json(report);
  } catch (error) {
    next(error);
  }
});

// 3. Generate new comparison report or update existing
app.post("/api/comparison/generate", auth.requireAuth(), aiLimiter, async (req, res, next) => {
  try {
    const { channelUrl, ourCtr, ourAvd } = req.body || {};
    if (!channelUrl || !channelUrl.trim()) {
      return res.status(400).json({ error: "Please enter a valid YouTube channel URL, handle, or ID." });
    }
    const result = await competitorComparison.generateComparisonReport(
      channelUrl.trim(),
      ourCtr || 5.0,
      ourAvd || 48.0
    );
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Comparison report generation failed:", error);
    next(error);
  }
});

// 4. Refresh existing report
app.post("/api/comparison/reports/:id/refresh", auth.requireAuth(), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const report = competitorComparison.getReportById(id);
    if (!report) {
      return res.status(404).json({ error: "Report not found" });
    }
    const { ourCtr, ourAvd } = req.body || {};
    const result = await competitorComparison.generateComparisonReport(
      report.competitorChannelId,
      ourCtr || report.analysis?.benchmarks?.ourCtr || 5.0,
      ourAvd || report.analysis?.benchmarks?.ourAvd || 48.0
    );
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Report refresh failed:", error);
    next(error);
  }
});

// 4b. Regenerate only narrative executive summary without re-pulling API data
app.post("/api/comparison/reports/:id/regenerate-summary", auth.requireAuth(), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await competitorComparison.regenerateExecutiveSummary(id);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Executive summary regeneration failed:", error);
    next(error);
  }
});

// 5. Delete comparison report
app.delete("/api/comparison/reports/:id", auth.requireAuth(), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    competitorComparison.deleteReport(id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 6. Export report to CSV
app.get("/api/comparison/reports/:id/export-csv", auth.requireAuth(), (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const csvData = competitorComparison.generateReportCsv(id);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="competitor-comparison-report-${id}.csv"`);
    res.send(csvData);
  } catch (error) {
    next(error);
  }
});

/* ---------------- Ford Fathom News Endpoints ---------------- */
app.use("/api/fathom-news", auth.requireAuth(), fathomNewsRouter);

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

app.use("/api/*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Centralized Express error handler
app.use((err, req, res, next) => {
  const correlationId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  console.error(`[Error ${correlationId}] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({
    error: "An internal server error occurred.",
    correlationId,
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Electric Duo Command Center running on port ${PORT}`);
  });
}

module.exports = app;
