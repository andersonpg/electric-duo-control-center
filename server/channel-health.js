"use strict";

const { GoogleGenAI } = require("@google/genai");
const { google } = require("googleapis");
const db = require("./db").articleDb;
const { getGeminiApiKey, DEFAULT_GEMINI_MODEL } = require("./gemini");
const { isOAuthConnected, getAuthenticatedClient } = require("./youtube-analytics");
const {
  getChannelReachSummary,
  getReachStatus,
  ensureReachJob,
  syncReachReports,
} = require("./youtube-reach");
const {
  scoreSatisfaction,
  computeCoreAudienceIntensity,
  computeSubConversionRate,
  SCORE_VERSION,
  METHODOLOGY_NOTE: SATISFACTION_METHODOLOGY_NOTE,
} = require("./satisfaction-score");

// Helper to parse ISO duration "PT18M6S" into seconds
function parseDurationSec(durationStr) {
  if (!durationStr) return 900;
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 900;
  const h = parseInt(match[1] || "0", 10);
  const m = parseInt(match[2] || "0", 10);
  const s = parseInt(match[3] || "0", 10);
  return h * 3600 + m * 60 + s;
}

// 1. Dynamic Category Management
function getCategories() {
  return db.prepare("SELECT * FROM content_categories ORDER BY name COLLATE NOCASE ASC").all();
}

function addCategory({ name, description, color, addToTemplates = false, promptTemplate = "" }) {
  if (!name || !name.trim()) throw new Error("Category name is required.");
  const cleanName = name.trim();

  // Insert into content_categories
  const stmt = db.prepare("INSERT INTO content_categories (name, description, color) VALUES (?, ?, ?)");
  const info = stmt.run(cleanName, description || "", color || "#06b6d4");

  // If requested, also create a content_template for Article Generator
  if (addToTemplates) {
    try {
      const templateStmt = db.prepare(`
        INSERT INTO content_templates (name, description, prompt_template)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description,
          prompt_template = excluded.prompt_template,
          updated_at = CURRENT_TIMESTAMP
      `);
      templateStmt.run(
        cleanName,
        description || `Article template for ${cleanName}`,
        promptTemplate && promptTemplate.trim()
          ? promptTemplate.trim()
          : `You are the lead content writer for The Electric Duo (theelectricduo.com). Write an in-depth, enthusiastic, first-person EV article based on the video transcript for "${cleanName}".`
      );
    } catch (tmplErr) {
      console.warn("Could not auto-create template for category:", tmplErr.message);
    }
  }

  return { id: info.lastInsertRowid, name: cleanName, description, color, addToTemplates };
}

function updateCategory(id, { name, description, color }) {
  if (!name || !name.trim()) throw new Error("Category name is required.");
  const existing = db.prepare("SELECT name FROM content_categories WHERE id = ?").get(id);
  if (!existing) throw new Error("Category not found.");

  db.prepare("UPDATE content_categories SET name = ?, description = ?, color = ? WHERE id = ?").run(
    name.trim(),
    description || "",
    color || "#06b6d4",
    id
  );

  if (existing.name !== name.trim()) {
    db.prepare("UPDATE videos SET content_type = ? WHERE content_type = ?").run(name.trim(), existing.name);
  }

  return { id, name: name.trim(), description, color };
}

// Benchmarks are entered by hand from YouTube Studio, or derived from measured
// Analytics data where the API actually exposes the metric. Impressions and
// impressions CTR have no Analytics API equivalent, so those stay manual.
function updateCategoryBenchmarks(id, { avg_ctr, avg_retention, avg_view_duration, traffic_share } = {}) {
  const existing = db.prepare("SELECT id FROM content_categories WHERE id = ?").get(id);
  if (!existing) throw new Error("Category not found.");

  const num = (x) => {
    if (x === "" || x === null || x === undefined) return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };

  db.prepare(`
    UPDATE content_categories
    SET avg_ctr = ?, avg_retention = ?, avg_view_duration = ?, traffic_share_json = ?,
        benchmarks_updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    num(avg_ctr),
    num(avg_retention),
    avg_view_duration && String(avg_view_duration).trim() ? String(avg_view_duration).trim() : null,
    traffic_share ? JSON.stringify(traffic_share) : null,
    id
  );

  return db.prepare("SELECT * FROM content_categories WHERE id = ?").get(id);
}

// Fill in the benchmarks the Analytics API can actually measure: average
// percentage viewed and average view duration, aggregated per category over
// the given window. CTR is left untouched because no API exposes it.
async function deriveCategoryBenchmarks(periodDays = 365) {
  const auth = getAuthenticatedClient();
  if (!auth) {
    return { success: false, error: "YouTube Analytics is not connected, so nothing can be derived." };
  }

  const now = new Date();
  const endDate = now.toISOString().split("T")[0];
  const startDate = new Date(now.getTime() - periodDays * 86400000).toISOString().split("T")[0];

  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });
  const data = await queryAnalytics(ytAnalytics, {
    ids: "channel==MINE",
    startDate,
    endDate,
    dimensions: "video",
    metrics: "views,averageViewDuration,averageViewPercentage",
    sort: "-views",
    maxResults: 200,
  }, "category benchmark derivation");

  if (!data || !data.rows || data.rows.length === 0) {
    return { success: false, error: "No per-video analytics rows were returned for this window." };
  }

  const byVideo = new Map(data.rows.map((r) => [r[0], { views: r[1] || 0, avd: r[2] || 0, pct: r[3] || 0 }]));
  const categories = getCategories();
  const updated = [];

  for (const cat of categories) {
    const vids = db
      .prepare("SELECT youtube_id FROM videos WHERE content_type = ? AND (privacy_status IS NULL OR privacy_status = 'public')")
      .all(cat.name)
      .map((r) => r.youtube_id)
      .filter((id) => byVideo.has(id));

    if (vids.length === 0) continue;

    // Weight by views so one tiny video cannot swing a category average.
    let totalViews = 0, wPct = 0, wAvd = 0;
    vids.forEach((id) => {
      const m = byVideo.get(id);
      totalViews += m.views;
      wPct += m.pct * m.views;
      wAvd += m.avd * m.views;
    });
    if (totalViews <= 0) continue;

    const avgPct = Number((wPct / totalViews).toFixed(1));
    const avgAvdSec = Math.round(wAvd / totalViews);
    const avdFormatted = `${Math.floor(avgAvdSec / 60)}:${String(avgAvdSec % 60).padStart(2, "0")}`;

    db.prepare(`
      UPDATE content_categories
      SET avg_retention = ?, avg_view_duration = ?, benchmarks_updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(avgPct, avdFormatted, cat.id);

    updated.push({ name: cat.name, sampleSize: vids.length, avgRetention: avgPct, avgViewDuration: avdFormatted });
  }

  return {
    success: true,
    periodDays,
    startDate,
    endDate,
    updated,
    note: "Impressions click-through rate is not exposed by the YouTube Analytics API and must still be entered by hand from YouTube Studio.",
  };
}

function deleteCategory(id) {
  const cat = db.prepare("SELECT name FROM content_categories WHERE id = ?").get(id);
  if (!cat) throw new Error("Category not found.");

  db.prepare("DELETE FROM content_categories WHERE id = ?").run(id);
  db.prepare("UPDATE videos SET content_type = 'Other' WHERE content_type = ?").run(cat.name);
  return { success: true };
}

// 2. Playlist-to-Category Mappings
function getPlaylistMappings() {
  return db.prepare("SELECT * FROM playlist_category_mappings ORDER BY updated_at DESC").all();
}

function savePlaylistMapping({ playlist_id, playlist_title, category }) {
  if (!playlist_id || !category) throw new Error("Playlist ID and Category are required.");
  const stmt = db.prepare(`
    INSERT INTO playlist_category_mappings (playlist_id, playlist_title, category, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(playlist_id) DO UPDATE SET
      playlist_title = excluded.playlist_title,
      category = excluded.category,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(playlist_id.trim(), playlist_title || "Playlist", category);
  return { success: true, playlist_id, playlist_title, category };
}

function deletePlaylistMapping(id) {
  db.prepare("DELETE FROM playlist_category_mappings WHERE id = ?").run(id);
  return { success: true };
}

// 3. Manual Category Override (Single & Batch)
function overrideVideoCategory(youtubeId, category) {
  const updateStmt = db.prepare("UPDATE videos SET content_type = ?, category_source = 'manual' WHERE youtube_id = ?");
  updateStmt.run(category, youtubeId);
  return { success: true, youtubeId, category, source: "manual" };
}

function batchOverrideVideoCategories(updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return { success: true, count: 0 };
  }

  const updateStmt = db.prepare("UPDATE videos SET content_type = ?, category_source = 'manual' WHERE youtube_id = ?");
  const runTx = db.transaction((list) => {
    let count = 0;
    for (const item of list) {
      if (item.youtubeId && item.category) {
        updateStmt.run(item.category, item.youtubeId);
        count++;
      }
    }
    return count;
  });

  const updatedCount = runTx(updates);
  return { success: true, count: updatedCount };
}

/**
 * Save manual overrides and accept all remaining AI-inferred categorizations.
 */
function saveAllAndAcceptAi({ manualOverrides = [], acceptAllAi = true, scopeYoutubeIds = null } = {}) {
  const updateManualStmt = db.prepare(`
    UPDATE videos
    SET content_type = ?, category_source = 'manual'
    WHERE youtube_id = ?
  `);

  const runTx = db.transaction(() => {
    let manualCount = 0;
    const manualIds = new Set();

    // 1. Process all staged manual overrides
    if (Array.isArray(manualOverrides)) {
      for (const item of manualOverrides) {
        if (item && item.youtubeId && item.category) {
          updateManualStmt.run(item.category, item.youtubeId);
          manualCount++;
          manualIds.add(item.youtubeId);
        }
      }
    }

    // 2. Accept all remaining AI-inferred categorizations (that have a valid content_type)
    let aiAcceptedCount = 0;
    if (acceptAllAi) {
      if (Array.isArray(scopeYoutubeIds) && scopeYoutubeIds.length > 0) {
        const acceptSingleStmt = db.prepare(`
          UPDATE videos
          SET category_source = 'manual'
          WHERE youtube_id = ?
            AND category_source = 'ai_inferred'
            AND content_type IS NOT NULL
            AND content_type != ''
        `);
        for (const yid of scopeYoutubeIds) {
          if (!manualIds.has(yid)) {
            const res = acceptSingleStmt.run(yid);
            if (res.changes > 0) aiAcceptedCount++;
          }
        }
      } else {
        const acceptAllStmt = db.prepare(`
          UPDATE videos
          SET category_source = 'manual'
          WHERE category_source = 'ai_inferred'
            AND content_type IS NOT NULL
            AND content_type != ''
        `);
        const res = acceptAllStmt.run();
        aiAcceptedCount = res.changes;
      }
    }

    return { manualCount, aiAcceptedCount };
  });

  const result = runTx();
  return {
    success: true,
    manualCount: result.manualCount,
    aiAcceptedCount: result.aiAcceptedCount,
    message: `Saved ${result.manualCount} manual adjustment${result.manualCount === 1 ? "" : "s"} and accepted ${result.aiAcceptedCount} AI categorization${result.aiAcceptedCount === 1 ? "" : "s"}.`
  };
}

// 4. Video Catalog Query for Easy Search & Re-categorization (Long-Form Only)
function getVideoCatalog({ page = 1, limit = 50, search = "", category = "", source = "" } = {}) {
  let where = "WHERE (privacy_status IS NULL OR privacy_status = 'public')";
  const params = [];

  if (search && search.trim()) {
    where += " AND (title LIKE ? OR description LIKE ?)";
    params.push(`%${search.trim()}%`, `%${search.trim()}%`);
  }

  if (category && category.trim() && category !== "all") {
    where += " AND content_type = ?";
    params.push(category.trim());
  }

  if (source && source.trim() && source !== "all") {
    if (source === "ai_inferred") {
      where += " AND category_source = 'ai_inferred'";
    } else if (source === "manual") {
      where += " AND category_source = 'manual'";
    } else if (source === "needs_review") {
      where += " AND COALESCE(category_source, '') IN ('needs_review', 'unclassified')";
    } else {
      where += " AND category_source = ?";
      params.push(source.trim());
    }
  }

  // Retrieve matching videos and filter out shorts (<4m)
  const allMatching = db.prepare(`SELECT * FROM videos ${where} ORDER BY published_at DESC`).all(...params);
  const longFormVideos = allMatching.filter((v) => parseDurationSec(v.duration) >= 240);

  const total = longFormVideos.length;
  const numLimit = Number(limit) || 50;
  const effectiveLimit = numLimit <= 0 ? Math.max(total, 1) : numLimit;
  const totalPages = Math.max(1, Math.ceil(total / effectiveLimit));
  const validPage = Math.max(1, Math.min(Number(page) || 1, totalPages));
  const offset = (validPage - 1) * effectiveLimit;
  const paginatedRows = numLimit <= 0 ? longFormVideos : longFormVideos.slice(offset, offset + effectiveLimit);

  // Compute source distribution across all long-form videos
  const allLongForm = db.prepare(`SELECT duration, category_source FROM videos WHERE (privacy_status IS NULL OR privacy_status = 'public')`)
    .all()
    .filter((v) => parseDurationSec(v.duration) >= 240);

  const sourceCounts = {
    all: allLongForm.length,
    ai_inferred: 0,
    manual: 0,
    needs_review: 0,
    migrated: 0,
  };
  for (const v of allLongForm) {
    const src = v.category_source || "unclassified";
    if (src === "ai_inferred") sourceCounts.ai_inferred++;
    else if (src === "manual") sourceCounts.manual++;
    else if (src === "needs_review" || src === "unclassified") sourceCounts.needs_review++;
    else if (src === "migrated") sourceCounts.migrated++;
  }

  return {
    videos: paginatedRows,
    total,
    page: validPage,
    limit: effectiveLimit,
    totalPages,
    sourceCounts,
  };
}

// ---------------------------------------------------------------------------
// 5. Library classification
//
// Three passes, most reliable first:
//   1. Playlist membership  — deterministic, no AI, 100% precision.
//   2. Gemini classification — structured output with a confidence score.
//   3. Review queue         — anything low-confidence or failed is left NULL
//                             and flagged, never keyword-guessed.
//
// A run is recorded in classification_runs so it can be previewed (dry run)
// and rolled back.
// ---------------------------------------------------------------------------

const MIN_CLASSIFY_CONFIDENCE = 0.7;
const CLASSIFY_BATCH_SIZE = 12;
const CLASSIFY_MAX_ATTEMPTS = 3;

function getCategoryContext() {
  const categories = getCategories();
  return {
    categories,
    names: categories.map((c) => c.name),
    descriptions: categories.map((c) => `- "${c.name}": ${c.description || "(no description)"}`).join("\n"),
    fallbackName: (categories.find((c) => c.is_fallback) || {}).name || null,
  };
}

// Resolve category from playlist membership. Highest-precision signal available
// and it costs no AI call, so it runs before anything else.
async function resolvePlaylistCategories(validNames) {
  const mappings = getPlaylistMappings().filter((m) => validNames.includes(m.category));
  const resolved = new Map();
  if (mappings.length === 0) return { resolved, playlistsChecked: 0, error: null };

  let youtube;
  try {
    const { getYoutubeClient } = require("./youtube");
    youtube = getYoutubeClient();
  } catch (e) {
    return { resolved, playlistsChecked: 0, error: `YouTube client unavailable: ${e.message}` };
  }
  if (!youtube) return { resolved, playlistsChecked: 0, error: "YouTube client unavailable." };

  let checked = 0;
  let firstError = null;

  for (const mapping of mappings) {
    let pageToken = null;
    try {
      do {
        const res = await youtube.playlistItems.list({
          part: "contentDetails",
          playlistId: mapping.playlist_id,
          maxResults: 50,
          pageToken: pageToken || undefined,
        });
        (res.data.items || []).forEach((item) => {
          const vId = item.contentDetails && item.contentDetails.videoId;
          // First mapped playlist to claim a video wins, so mappings are ordered
          // by recency in getPlaylistMappings().
          if (vId && !resolved.has(vId)) resolved.set(vId, mapping.category);
        });
        pageToken = res.data.nextPageToken;
      } while (pageToken);
      checked++;
    } catch (e) {
      if (!firstError) firstError = `Playlist ${mapping.playlist_id}: ${e.message}`;
      console.warn(`Could not read playlist ${mapping.playlist_id}:`, e.message);
    }
  }

  return { resolved, playlistsChecked: checked, error: firstError };
}

function buildVideoBlock(v, idx) {
  const parts = [`[${idx + 1}] ID: ${v.youtube_id}`, `    Title: "${v.title}"`];

  const durSec = parseDurationSec(v.duration);
  if (durSec != null) {
    parts.push(`    Duration: ${Math.floor(durSec / 60)}:${String(durSec % 60).padStart(2, "0")}`);
  }

  if (v.tags_json) {
    try {
      const tags = JSON.parse(v.tags_json);
      if (Array.isArray(tags) && tags.length > 0) {
        parts.push(`    Tags: ${tags.slice(0, 15).join(", ")}`);
      }
    } catch (e) {
      /* ignore malformed tags */
    }
  }

  // The scraper writes a synthesised description that merely restates the title.
  // Feeding it back adds no signal, so it is skipped when flagged as placeholder.
  if (v.description && !v.description_is_placeholder) {
    parts.push(`    Description: "${v.description.substring(0, 500).replace(/\s+/g, " ").trim()}"`);
  }

  if (v.transcript_opening) {
    parts.push(`    Transcript opening: "${v.transcript_opening.substring(0, 400).replace(/\s+/g, " ").trim()}"`);
  }

  return parts.join("\n");
}

function buildClassifierPrompt(ctx, chunk) {
  const fallbackClause = ctx.fallbackName
    ? `- "${ctx.fallbackName}" is ONLY for livestreams, channel announcements, and channel updates. Do NOT use it as a fallback for videos you are unsure about. If you are unsure, pick the best fit and lower your confidence instead.`
    : `- If you are unsure, pick the best fit and lower your confidence. Do not invent a category.`;

  return `You are classifying videos from "The Electric Duo", a two-person EV channel run by Patrick and Liv, into exactly one content category each.

CATEGORIES — you must use one of these names exactly:
${ctx.descriptions}

CLASSIFICATION RULES:
- Decide from what the video IS, not from a single keyword. A model year in the title does not make a video news. A review of a 2024 vehicle is a review.
- A vehicle deep dive, first look, walkaround, test drive, or hardware review belongs in the reviews category, even when it mentions news, price, or a model year.
- A dated news roundup or a reaction to an industry announcement belongs in the news category.
- A journey with charging stops along a route belongs in the road trip category, even if a vehicle is being reviewed along the way. The journey is the spine of the video.
- Instructional content that teaches a repeatable task belongs in the how-to category.
- Use the sponsor category only when the video's primary purpose is a paid product feature, not when a sponsor is merely mentioned.
- A vehicle-specific or brand-specific category is only correct when that vehicle or brand is the POINT of the video, not merely present in it. Apply this test: if the video would still make sense with a different vehicle in it, classify it by what the video DOES (review, road trip, news, how-to) rather than by which vehicle appears. A road trip in a given car is a road trip. A review of that car is a review.
${fallbackClause}
- When two categories both fit, choose the one describing the video's main purpose, and lower your confidence.

For each video return:
- youtube_id: exactly as given
- category: exactly one of the category names above
- confidence: 0.0 to 1.0, how certain you are
- reason: at most 12 words naming the specific evidence you used

Classify every video in the list. Never omit one. Never invent an ID.

VIDEOS:
${chunk.map((v, i) => buildVideoBlock(v, i)).join("\n\n")}`;
}

function formatApiError(err) {
  if (!err) return "Unknown error";
  let msg = err.message || "";
  try {
    const parsed = JSON.parse(msg);
    if (parsed.error && parsed.error.message) {
      msg = parsed.error.message;
    }
  } catch (e) {}
  return msg;
}

function isApiAccessError(err) {
  if (!err) return false;
  const msg = err.message || "";
  return (
    err.status === 401 ||
    err.status === 403 ||
    err.status === 429 ||
    /quota|resource_exhausted|rate_limit|rate limit|api_key|api key|permission_denied|unauthenticated|billing/i.test(msg)
  );
}

async function classifyChunk(ai, modelName, ctx, chunk) {
  const prompt = buildClassifierPrompt(ctx, chunk);

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            youtube_id: { type: "string" },
            category: { type: "string", enum: ctx.names },
            confidence: { type: "number" },
            reason: { type: "string" },
          },
          required: ["youtube_id", "category", "confidence"],
        },
      },
    },
  });

  let raw = (response.text || "").trim();
  raw = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Model did not return an array.");

  const byId = new Map();
  const requestedIds = new Set(chunk.map((v) => v.youtube_id));

  parsed.forEach((item, idx) => {
    if (!item || typeof item !== "object") return;
    // Prefer the returned id, but fall back to positional order when the model
    // echoes an index or mangles the id. Never accept an id we did not ask for.
    let id = typeof item.youtube_id === "string" ? item.youtube_id.trim() : null;
    if (!id || !requestedIds.has(id)) {
      id = chunk[idx] ? chunk[idx].youtube_id : null;
    }
    if (!id || !requestedIds.has(id)) return;
    if (!ctx.names.includes(item.category)) return;

    const confidence = Number.isFinite(item.confidence) ? Math.max(0, Math.min(1, item.confidence)) : 0;
    byId.set(id, {
      category: item.category,
      confidence,
      reason: typeof item.reason === "string" ? item.reason.slice(0, 200) : null,
    });
  });

  const missing = chunk.filter((v) => !byId.has(v.youtube_id)).map((v) => v.youtube_id);
  return { byId, missing };
}

async function bulkReclassifyLibrary(options = {}) {
  const dryRun = options.dryRun === true;
  const onlyUnclassified = options.onlyUnclassified === true;

  const ctx = getCategoryContext();
  if (ctx.names.length === 0) {
    return { success: false, message: "No content categories are defined." };
  }

  const baseQuery = `
    SELECT v.youtube_id, v.title, v.description, v.description_is_placeholder, v.duration,
           v.tags_json, v.content_type, v.category_source,
           SUBSTR(COALESCE(t.plain_text, t.cleaned_srt, t.raw_srt), 1, 400) AS transcript_opening
    FROM videos v
    LEFT JOIN transcripts t ON t.video_id = v.youtube_id
    WHERE (v.privacy_status IS NULL OR v.privacy_status = 'public')
      AND COALESCE(v.category_source, '') != 'manual'
      ${onlyUnclassified ? "AND (v.content_type IS NULL OR v.content_type = '' OR COALESCE(v.category_source,'') IN ('unclassified','needs_review'))" : ""}
  `;

  let videos;
  try {
    videos = db.prepare(baseQuery).all();
  } catch (e) {
    // Fall back if the transcripts table uses different column names.
    console.warn("Transcript join unavailable for classification:", e.message);
    videos = db.prepare(`
      SELECT youtube_id, title, description, description_is_placeholder, duration,
             tags_json, content_type, category_source, NULL AS transcript_opening
      FROM videos
      WHERE (privacy_status IS NULL OR privacy_status = 'public')
        AND COALESCE(category_source, '') != 'manual'
    `).all();
  }

  if (!videos || videos.length === 0) {
    return { success: true, total: 0, message: "No non-manual videos to classify." };
  }

  const changes = [];
  const stats = { byPlaylist: 0, byAi: 0, needsReview: 0, unchanged: 0, failedBatches: 0, totalBatches: 0 };

  // --- Pass 1: playlist membership (deterministic) ---
  const playlistResult = await resolvePlaylistCategories(ctx.names);
  const remaining = [];
  for (const v of videos) {
    const playlistCategory = playlistResult.resolved.get(v.youtube_id);
    if (playlistCategory) {
      stats.byPlaylist++;
      changes.push({
        youtube_id: v.youtube_id,
        title: v.title,
        from: v.content_type,
        to: playlistCategory,
        source: "playlist",
        confidence: 1,
        reason: "Member of a mapped playlist",
      });
    } else {
      remaining.push(v);
    }
  }

  // --- Pass 2: Gemini classification with structured output ---
  const apiKey = getGeminiApiKey();
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

  let modelName = DEFAULT_GEMINI_MODEL;
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'default_model'").get();
    if (row && row.value) modelName = row.value;
  } catch (e) {
    console.warn("Could not read default_model in channel-health:", e.message);
  }

  if (!ai && remaining.length > 0) {
    remaining.forEach((v) => {
      stats.needsReview++;
      changes.push({
        youtube_id: v.youtube_id,
        title: v.title,
        from: v.content_type,
        to: null,
        source: "needs_review",
        confidence: null,
        reason: "Gemini API key not configured",
      });
    });
  }

  if (ai) {
    for (let i = 0; i < remaining.length; i += CLASSIFY_BATCH_SIZE) {
      const chunk = remaining.slice(i, i + CLASSIFY_BATCH_SIZE);
      stats.totalBatches++;

      let result = null;
      let lastError = null;
      for (let attempt = 1; attempt <= CLASSIFY_MAX_ATTEMPTS; attempt++) {
        try {
          result = await classifyChunk(ai, modelName, ctx, chunk);
          break;
        } catch (err) {
          lastError = err;
          console.warn(`Classification batch ${stats.totalBatches} attempt ${attempt} failed:`, err.message);
          if (attempt < CLASSIFY_MAX_ATTEMPTS) {
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
      }

      if (!result) {
        const cleanErr = formatApiError(lastError);
        stats.lastError = cleanErr;

        if (isApiAccessError(lastError)) {
          console.error(`[Classifier] Gemini API access error on batch ${stats.totalBatches}:`, cleanErr);
          return {
            success: false,
            error: `Gemini API access error on ${modelName}: ${cleanErr}`,
            apiAccessError: true,
            failedBatches: stats.failedBatches + 1,
            totalBatches: Math.ceil(remaining.length / CLASSIFY_BATCH_SIZE),
          };
        }

        // A failed batch is reported as failed. It is never silently replaced
        // with keyword guesses.
        stats.failedBatches++;
        chunk.forEach((v) => {
          stats.needsReview++;
          changes.push({
            youtube_id: v.youtube_id,
            title: v.title,
            from: v.content_type,
            to: null,
            source: "needs_review",
            confidence: null,
            reason: `Classification failed: ${cleanErr.slice(0, 120)}`,
          });
        });
        continue;
      }

      for (const v of chunk) {
        const hit = result.byId.get(v.youtube_id);
        if (!hit) {
          stats.needsReview++;
          changes.push({
            youtube_id: v.youtube_id,
            title: v.title,
            from: v.content_type,
            to: null,
            source: "needs_review",
            confidence: null,
            reason: "Model returned no classification for this video",
          });
        } else if (hit.confidence < MIN_CLASSIFY_CONFIDENCE) {
          stats.needsReview++;
          changes.push({
            youtube_id: v.youtube_id,
            title: v.title,
            from: v.content_type,
            to: null,
            source: "needs_review",
            confidence: hit.confidence,
            reason: `Low confidence (${hit.confidence.toFixed(2)}): ${hit.reason || "no reason given"}`,
          });
        } else {
          stats.byAi++;
          changes.push({
            youtube_id: v.youtube_id,
            title: v.title,
            from: v.content_type,
            to: hit.category,
            source: "ai_inferred",
            confidence: hit.confidence,
            reason: hit.reason,
          });
        }
      }
    }
  }

  stats.unchanged = changes.filter((c) => c.from === c.to).length;

  // --- Persist ---
  const runStmt = db.prepare(`
    INSERT INTO classification_runs (mode, total, by_playlist, by_ai, needs_review, failed_batches, total_batches, changes_json, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  if (dryRun) {
    const info = runStmt.run(
      "dry_run", videos.length, stats.byPlaylist, stats.byAi, stats.needsReview,
      stats.failedBatches, stats.totalBatches, JSON.stringify(changes), playlistResult.error
    );
    return {
      success: true,
      dryRun: true,
      runId: info.lastInsertRowid,
      total: videos.length,
      ...stats,
      playlistsChecked: playlistResult.playlistsChecked,
      changes,
      message: `Preview only. Nothing was written.`,
    };
  }

  const applyStmt = db.prepare(
    "UPDATE videos SET content_type = ?, category_source = ?, classification_confidence = ?, classification_reason = ? WHERE youtube_id = ?"
  );
  const applyAll = db.transaction(() => {
    for (const c of changes) {
      applyStmt.run(c.to, c.source, c.confidence, c.reason, c.youtube_id);
    }
  });
  applyAll();

  const info = runStmt.run(
    "applied", videos.length, stats.byPlaylist, stats.byAi, stats.needsReview,
    stats.failedBatches, stats.totalBatches, JSON.stringify(changes), playlistResult.error
  );

  return {
    success: true,
    dryRun: false,
    runId: info.lastInsertRowid,
    total: videos.length,
    ...stats,
    playlistsChecked: playlistResult.playlistsChecked,
    // Kept for API compatibility with the existing UI toast.
    reclassified: stats.byPlaylist + stats.byAi,
    message: `${stats.byPlaylist} from playlists, ${stats.byAi} from AI, ${stats.needsReview} need review.`,
  };
}

// Roll a classification run back to the values recorded before it ran.
function rollbackClassificationRun(runId) {
  const run = db.prepare("SELECT * FROM classification_runs WHERE id = ?").get(runId);
  if (!run) throw new Error("Classification run not found.");
  if (run.mode !== "applied") throw new Error("Only an applied run can be rolled back.");

  const changes = JSON.parse(run.changes_json || "[]");
  const restoreStmt = db.prepare(
    "UPDATE videos SET content_type = ?, category_source = 'rolled_back', classification_confidence = NULL, classification_reason = NULL WHERE youtube_id = ?"
  );
  const restoreAll = db.transaction(() => {
    changes.forEach((c) => restoreStmt.run(c.from, c.youtube_id));
  });
  restoreAll();

  return { success: true, restored: changes.length, runId };
}

function listClassificationRuns(limit = 20) {
  return db.prepare(`
    SELECT id, mode, total, by_playlist, by_ai, needs_review, failed_batches, total_batches, error, created_at
    FROM classification_runs ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

// Videos the classifier could not confidently place.
function getReviewQueue(limit = 200) {
  return db.prepare(`
    SELECT youtube_id, title, content_type, category_source, classification_confidence, classification_reason, published_at, thumbnail_url
    FROM videos
    WHERE (privacy_status IS NULL OR privacy_status = 'public')
      AND COALESCE(category_source, '') IN ('needs_review', 'unclassified')
    ORDER BY published_at DESC
    LIMIT ?
  `).all(limit);
}


// 6. Non-Destructive Snapshot Capture Engine
async function captureSnapshot(periodDays = 28) {
  const snapshotDate = new Date().toISOString().split("T")[0];
  const report = await getChannelHealthReport(periodDays);

  const insertChannelSnapStmt = db.prepare(`
    INSERT INTO channel_snapshots (snapshot_date, period_days, views, watch_time_hours, subs_gained, subs_lost, net_subs, avg_ctr, avg_retention, traffic_share_json, raw_data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertChannelSnapStmt.run(
    snapshotDate,
    periodDays,
    report.scorecard.views.value,
    report.scorecard.watchTimeHours.value,
    report.scorecard.netSubs.value + 50,
    50,
    report.scorecard.netSubs.value,
    report.scorecard.avgCtr.value,
    report.scorecard.avgRetention.value,
    JSON.stringify(report.audienceShift.current),
    JSON.stringify({ isLiveStudioData: report.isLiveStudioData })
  );

  return {
    snapshotDate,
    periodDays,
    views: report.scorecard.views.value,
    watchTimeHours: report.scorecard.watchTimeHours.value,
    netSubs: report.scorecard.netSubs.value,
    isLiveStudioData: report.isLiveStudioData,
    success: true,
  };
}

// Helper: Calculate Percentage Change
function calcPctChange(curr, prev) {
  if (!prev || prev === 0) return 0;
  return Number((((curr - prev) / prev) * 100).toFixed(1));
}

// ---------------------------------------------------------------------------
// 7. Channel Health Report
//
// Every figure is measured or null. Impressions and impressions CTR are not
// exposed by the YouTube Analytics API, so they are reported as unavailable
// rather than back-computed from an assumed click-through rate.
// ---------------------------------------------------------------------------

// YouTube reclassified Shorts as up to 3 minutes in late 2024. The old 4-minute
// threshold silently dropped genuine short long-form videos from every metric.
const SHORTS_MAX_SEC = 180;

function isLongForm(video) {
  const sec = parseDurationSec(video.duration);
  // Unknown duration is not evidence of long-form. It is excluded and counted.
  if (sec == null) return false;
  return sec > SHORTS_MAX_SEC;
}

async function queryAnalytics(ytAnalytics, params, label) {
  try {
    const res = await ytAnalytics.reports.query(params);
    return res.data || null;
  } catch (err) {
    console.warn(`YouTube Analytics query failed (${label}):`, err.message);
    return null;
  }
}

// Long-form-only (Shorts and Live excluded) channel totals, used for both the
// main scorecard and the Viewer Satisfaction Score below it. Filtered
// server-side via YouTube's own creatorContentType classification rather than
// joined against the local video catalog, so it stays correct even if the
// local catalog's duration data is incomplete -- the same class of bug fixed
// in server/media-kit.js.
async function queryLongFormChannelMetrics(ytAnalytics, startDate, endDate, label) {
  const data = await queryAnalytics(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate,
      endDate,
      metrics: "views,estimatedMinutesWatched,likes,comments,shares,averageViewPercentage,subscribersGained,subscribersLost",
      filters: "creatorContentType==video_on_demand",
    },
    `${label} (Long-Form)`
  );
  return data?.rows?.[0] || null;
}

async function queryLongFormVideoMetrics(ytAnalytics, startDate, endDate, label = "videos") {
  const data = await queryAnalytics(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate,
      endDate,
      dimensions: "video",
      metrics: "views,averageViewPercentage,subscribersGained,subscribersLost",
      filters: "creatorContentType==video_on_demand",
      sort: "-views",
      maxResults: 200,
    },
    `${label} (Long-Form Video Breakdown)`
  );
  return data?.rows || [];
}

async function fetchVideoDurations(ytData, videoIds) {
  const durationMap = new Map();
  if (!videoIds || videoIds.length === 0) return durationMap;

  // Fetch in chunks of 50 via YouTube Data API videos.list(part=contentDetails)
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    try {
      const res = await ytData.videos.list({
        part: "contentDetails",
        id: chunk.join(","),
        maxResults: 50,
      });
      const items = res.data?.items || [];
      for (const item of items) {
        if (item.id && item.contentDetails?.duration) {
          const sec = parseDurationSec(item.contentDetails.duration);
          if (sec != null && sec > 0) {
            durationMap.set(item.id, sec);
          }
        }
      }
    } catch (err) {
      console.warn("Could not fetch video durations from YouTube Data API:", err.message);
    }
  }

  // Local catalogue fallback for any videos not resolved via Data API
  const missingIds = videoIds.filter((id) => !durationMap.has(id));
  if (missingIds.length > 0) {
    try {
      const placeholders = missingIds.map(() => "?").join(",");
      const rows = db.prepare(`SELECT youtube_id, duration FROM videos WHERE youtube_id IN (${placeholders})`).all(...missingIds);
      for (const r of rows) {
        if (r.duration) {
          const sec = parseDurationSec(r.duration);
          if (sec != null && sec > 0) {
            durationMap.set(r.youtube_id, sec);
          }
        }
      }
    } catch (e) {
      console.warn("Local catalogue duration lookup fallback failed:", e.message);
    }
  }

  return durationMap;
}

function computeAggregateSatisfactionScore(videoRows, durationMap, totalLongFormViews) {
  if (!videoRows || videoRows.length === 0) {
    return { score: null, videosScored: 0, coverage: null };
  }

  let weightedScoreSum = 0;
  let scoredViews = 0;
  let videosScored = 0;
  let unresolvableCount = 0;

  for (const row of videoRows) {
    const [videoId, views, avp, subsGained, subsLost] = row;
    // Only include videos with >= 100 window views
    if (views == null || views < 100) {
      continue;
    }

    const durationSec = durationMap.get(videoId);
    if (!durationSec) {
      unresolvableCount++;
      continue;
    }

    const netSubs = subsGained != null && subsLost != null ? subsGained - subsLost : null;
    const subConversionRate = computeSubConversionRate({ netSubs, views });

    const scored = scoreSatisfaction({
      retentionPct: avp,
      durationSec,
      subConversionRate,
      views,
      basis: "window",
    });

    if (scored && scored.score != null) {
      weightedScoreSum += scored.score * views;
      scoredViews += views;
      videosScored++;
    }
  }

  if (unresolvableCount > 0) {
    console.warn(`Viewer Satisfaction: ${unresolvableCount} videos had unresolvable durations and were excluded.`);
  }

  const score = scoredViews > 0 ? Math.round(weightedScoreSum / scoredViews) : null;
  const coverage = totalLongFormViews && totalLongFormViews > 0
    ? Number((scoredViews / totalLongFormViews).toFixed(3))
    : null;

  return {
    score,
    videosScored,
    coverage,
  };
}

// Derives every value the scorecard needs from one long-form channel metrics row:
// views, watch hours, retention %, Core-Audience Intensity %, net subscribers, and net sub conversion rate %.
// Any missing input yields a null component rather than a guessed one.
function deriveLongFormMetrics(row) {
  if (!row) {
    return { views: null, watchHours: null, retention: null, coreAudienceIntensity: null, engagementRate: null, netSubs: null, subConversionRate: null };
  }

  const [views, estMinutes, likes, comments, shares, avp, subsGained, subsLost] = row;
  const watchHours = estMinutes != null ? Number((estMinutes / 60).toFixed(1)) : null;
  const retention = avp != null ? Number(avp.toFixed(1)) : null;
  const netSubs = subsGained != null && subsLost != null ? subsGained - subsLost : null;
  const coreAudienceIntensity = computeCoreAudienceIntensity({ likes, comments, shares, views });
  const subConversionRate = computeSubConversionRate({ netSubs, views });

  return {
    views: views ?? null,
    watchHours,
    retention,
    coreAudienceIntensity,
    engagementRate: coreAudienceIntensity,
    netSubs,
    subConversionRate,
  };
}

function summariseTraffic(rows) {
  if (!rows || rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + (r[1] || 0), 0);
  if (total <= 0) return null;

  let browse = 0, suggested = 0, search = 0, other = 0;
  rows.forEach((r) => {
    const type = String(r[0]);
    const v = r[1] || 0;
    if (type.includes("BROWSE") || type.includes("HOME") || type.includes("SUBSCRIBER")) browse += v;
    else if (type.includes("SUGGESTED") || type.includes("RELATED")) suggested += v;
    else if (type.includes("SEARCH")) search += v;
    else other += v;
  });

  const pct = (n) => Number(((n / total) * 100).toFixed(1));
  return { browse: pct(browse), suggested: pct(suggested), search: pct(search), other: pct(other) };
}

async function getChannelHealthReport(periodDays = 28) {
  const categories = getCategories();
  const allVideos = db
    .prepare("SELECT * FROM videos WHERE (privacy_status IS NULL OR privacy_status = 'public') ORDER BY view_count DESC, published_at DESC")
    .all();

  const longFormVideos = allVideos.filter(isLongForm);
  const unknownDurationCount = allVideos.filter((v) => parseDurationSec(v.duration) == null).length;
  const videoMap = new Map(longFormVideos.map((v) => [v.youtube_id, v]));

  const auth = getAuthenticatedClient();

  const now = new Date();
  const endDateStr = now.toISOString().split("T")[0];
  const startDateStr = new Date(now.getTime() - periodDays * 86400000).toISOString().split("T")[0];
  const priorStartDateStr = new Date(now.getTime() - 2 * periodDays * 86400000).toISOString().split("T")[0];

  let topVideosLive = null;
  let trafficLive = null;
  let priorTrafficLive = null;
  let totalSubscribers = null;
  let longFormCurrRow = null;
  let longFormPriorRow = null;
  let longFormCurrVideos = null;
  let longFormPriorVideos = null;
  let durationMap = new Map();

  if (auth) {
    const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });
    const ytData = google.youtube({ version: "v3", auth });

    try {
      const chRes = await ytData.channels.list({ part: "statistics", mine: true });
      const count = chRes.data?.items?.[0]?.statistics?.subscriberCount;
      if (count) totalSubscribers = parseInt(count, 10);
    } catch (e) {
      console.warn("Could not fetch channel subscriber count:", e.message);
    }

    const [
      top,
      traffic,
      priorTraffic,
      longFormCurr,
      longFormPrior,
      lfCurrVideos,
      lfPriorVideos,
    ] = await Promise.all([
      queryAnalytics(ytAnalytics, {
        ids: "channel==MINE", startDate: startDateStr, endDate: endDateStr,
        dimensions: "video", metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
        sort: "-views", maxResults: 50,
      }, "top videos"),
      queryAnalytics(ytAnalytics, {
        ids: "channel==MINE", startDate: startDateStr, endDate: endDateStr,
        dimensions: "insightTrafficSourceType", metrics: "views", sort: "-views",
      }, "traffic sources"),
      // The prior-period traffic split used to be a hardcoded object, which made
      // every shift arrow meaningless. It is now measured.
      queryAnalytics(ytAnalytics, {
        ids: "channel==MINE", startDate: priorStartDateStr, endDate: startDateStr,
        dimensions: "insightTrafficSourceType", metrics: "views", sort: "-views",
      }, "prior traffic sources"),
      queryLongFormChannelMetrics(ytAnalytics, startDateStr, endDateStr, "current period"),
      queryLongFormChannelMetrics(ytAnalytics, priorStartDateStr, startDateStr, "prior period"),
      queryLongFormVideoMetrics(ytAnalytics, startDateStr, endDateStr, "current period"),
      queryLongFormVideoMetrics(ytAnalytics, priorStartDateStr, startDateStr, "prior period"),
    ]);

    if (top?.rows) topVideosLive = top.rows;
    if (traffic?.rows) trafficLive = traffic.rows;
    if (priorTraffic?.rows) priorTrafficLive = priorTraffic.rows;
    longFormCurrRow = longFormCurr;
    longFormPriorRow = longFormPrior;
    longFormCurrVideos = lfCurrVideos;
    longFormPriorVideos = lfPriorVideos;

    const allVideoIds = [
      ...new Set([
        ...(longFormCurrVideos || []).map((r) => r[0]),
        ...(longFormPriorVideos || []).map((r) => r[0]),
      ]),
    ];
    durationMap = await fetchVideoDurations(ytData, allVideoIds);
  }

  const isLive = !!longFormCurrRow;

  // ---- 1. Scorecard (measured only, long-form video-on-demand content only:
  // Shorts and Live are excluded via YouTube's own creatorContentType
  // classification, the same fix applied in server/media-kit.js) ----
  const lfCurrInputs = deriveLongFormMetrics(longFormCurrRow);
  const lfPriorInputs = deriveLongFormMetrics(longFormPriorRow);

  const currViews = lfCurrInputs.views;
  const currWatchHours = lfCurrInputs.watchHours;
  const currAvgRetention = lfCurrInputs.retention;
  const currNetSubs = lfCurrInputs.netSubs;

  const priorViews = lfPriorInputs.views;
  const priorWatchHours = lfPriorInputs.watchHours;
  const priorAvgRetention = lfPriorInputs.retention;
  const priorNetSubs = lfPriorInputs.netSubs;

  const trafficShare = summariseTraffic(trafficLive);
  const priorTrafficShare = summariseTraffic(priorTrafficLive);

  const metric = (value, prior, label, note) => ({
    value,
    prior,
    pctChange: value != null && prior != null ? calcPctChange(value, prior) : null,
    label,
    available: value != null,
    note: note || null,
  });

  // ---- Viewer Satisfaction Score (v2, long-form only) ----
  // Aggregated as the view-weighted mean of per-video scores on a duration-adjusted
  // 28-day window baseline for videos with >= 100 window views.
  const currSatisfaction = computeAggregateSatisfactionScore(
    longFormCurrVideos,
    durationMap,
    lfCurrInputs.views
  );
  const priorSatisfaction = computeAggregateSatisfactionScore(
    longFormPriorVideos,
    durationMap,
    lfPriorInputs.views
  );

  const satisfactionScoreValue = currSatisfaction.score;
  const satisfactionScorePrior = priorSatisfaction.score;
  const scoreDelta =
    satisfactionScoreValue != null && satisfactionScorePrior != null
      ? satisfactionScoreValue - satisfactionScorePrior
      : null;

  const satisfactionScore = {
    score: satisfactionScoreValue,
    scorePrior: satisfactionScorePrior,
    scoreDelta,
    available: satisfactionScoreValue != null,
    videosScored: currSatisfaction.videosScored,
    coverage: currSatisfaction.coverage,
    scoreVersion: SCORE_VERSION,
    components: {
      retention: metric(lfCurrInputs.retention, lfPriorInputs.retention, "Avg % Viewed (Long-Form)"),
      coreAudienceIntensity: {
        ...metric(lfCurrInputs.coreAudienceIntensity, lfPriorInputs.coreAudienceIntensity, "Core-Audience Intensity"),
        isContextOnly: true,
      },
      engagementRate: {
        ...metric(lfCurrInputs.coreAudienceIntensity, lfPriorInputs.coreAudienceIntensity, "Core-Audience Intensity"),
        isContextOnly: true,
      },
      subConversionRate: metric(lfCurrInputs.subConversionRate, lfPriorInputs.subConversionRate, "Net Subscriber Conversion (Long-Form)"),
    },
    methodology: `${SATISFACTION_METHODOLOGY_NOTE} Shorts, Live, and non-video-on-demand content are excluded via YouTube's own content-type classification. Scored across videos with ≥100 window views using a duration-adjusted window baseline.`,
  };

  const currReach = getChannelReachSummary(startDateStr, endDateStr);
  const priorReach = getChannelReachSummary(priorStartDateStr, startDateStr);
  const reachStatus = getReachStatus();

  let impressionsMetric;
  let avgCtrMetric;

  if (currReach && currReach.totalImpressions > 0) {
    impressionsMetric = metric(
      currReach.totalImpressions,
      priorReach?.totalImpressions ?? null,
      "Impressions"
    );
    avgCtrMetric = metric(
      currReach.weightedCtr,
      priorReach?.weightedCtr ?? null,
      "Channel Avg CTR"
    );
  } else if (reachStatus.jobActive) {
    const note = reachStatus.reportsIngested > 0
      ? "No reach reports within this date range."
      : "YouTube Reporting job active. Google is compiling the initial reach reports (24-48h).";
    impressionsMetric = metric(null, null, "Impressions", note);
    avgCtrMetric = metric(null, null, "Channel Avg CTR", note);
  } else {
    impressionsMetric = metric(null, null, "Impressions", "YouTube Reach reporting job not registered. Click to set up.");
    avgCtrMetric = metric(null, null, "Channel Avg CTR", "YouTube Reach reporting job not registered. Click to set up.");
  }

  const scorecard = {
    totalSubscribers: metric(totalSubscribers, null, "Total Subscribers"),
    views: metric(currViews, priorViews, "Total Views"),
    impressions: impressionsMetric,
    avgCtr: avgCtrMetric,
    watchTimeHours: metric(currWatchHours, priorWatchHours, "Watch Time (Hours)"),
    suggestedShare: metric(
      trafficShare ? trafficShare.suggested : null,
      priorTrafficShare ? priorTrafficShare.suggested : null,
      "Suggested Video Share"
    ),
    avgRetention: metric(currAvgRetention, priorAvgRetention, "Avg % Viewed"),
    netSubs: metric(currNetSubs, priorNetSubs, "Net Subscribers"),
    periodDays,
    periodStart: startDateStr,
    asOfDate: endDateStr,
  };

  // ---- 2. Per-video live metrics, keyed for reuse ----
  const liveByVideo = new Map();
  if (topVideosLive) {
    topVideosLive.forEach((row) => {
      liveByVideo.set(row[0], {
        views: row[1] || 0,
        watchMinutes: row[2] || 0,
        avgViewDuration: row[3] || 0,
        retentionRate: row[4] != null ? Number(row[4].toFixed(1)) : null,
      });
    });
  }

  const formatVideo = (v) => {
    const live = liveByVideo.get(v.youtube_id);
    return {
      youtubeId: v.youtube_id,
      title: v.title,
      category: v.content_type,
      categorySource: v.category_source || "unclassified",
      classificationConfidence: v.classification_confidence ?? null,
      publishedAt: v.published_at || "",
      thumbnailUrl: v.thumbnail_url || `https://img.youtube.com/vi/${v.youtube_id}/maxresdefault.jpg`,
      views: live ? live.views : v.view_count ?? null,
      viewsSource: live ? "analytics_period" : v.view_count != null ? "catalog_lifetime" : "unavailable",
      // Real measured retention, no constant substitute.
      retentionRate: live ? live.retentionRate : null,
      watchHours: live ? Math.round(live.watchMinutes / 60) : null,
      ctr: null,
      duration: v.duration || null,
    };
  };

  // ---- 3. Category breakdown from measured data ----
  const periodStartMs = new Date(startDateStr).getTime();
  const priorStartMs = new Date(priorStartDateStr).getTime();

  const categoryStats = categories.map((cat) => {
    const catVideos = longFormVideos.filter((v) => v.content_type === cat.name);
    const withLive = catVideos.map(formatVideo);

    const measuredRetentions = withLive.map((v) => v.retentionRate).filter((r) => r != null);
    const avgRetention = measuredRetentions.length > 0
      ? Number((measuredRetentions.reduce((a, b) => a + b, 0) / measuredRetentions.length).toFixed(1))
      : null;

    const periodViews = withLive
      .filter((v) => liveByVideo.has(v.youtubeId))
      .reduce((s, v) => s + (v.views || 0), 0);

    // Trajectory now compares this period's uploads against the prior period's,
    // instead of testing lifetime views against a fixed threshold.
    const currUploads = catVideos.filter((v) => new Date(v.published_at).getTime() >= periodStartMs).length;
    const priorUploads = catVideos.filter((v) => {
      const t = new Date(v.published_at).getTime();
      return t >= priorStartMs && t < periodStartMs;
    }).length;

    let trajectory = "unknown";
    if (isLive && (currUploads > 0 || priorUploads > 0)) {
      if (currUploads > priorUploads) trajectory = "up";
      else if (currUploads < priorUploads) trajectory = "down";
      else trajectory = "flat";
    }

    return {
      id: cat.id,
      name: cat.name,
      description: cat.description,
      color: cat.color,
      videoCount: catVideos.length,
      totalViews: catVideos.reduce((s, v) => s + (v.view_count || 0), 0),
      periodViews: isLive ? periodViews : null,
      uploadsThisPeriod: currUploads,
      uploadsPriorPeriod: priorUploads,
      // Benchmarks are user-entered from Studio; null means not yet entered.
      avgCtr: cat.avg_ctr ?? null,
      benchmarkRetention: cat.avg_retention ?? null,
      avgRetention,
      retentionSampleSize: measuredRetentions.length,
      trajectory,
    };
  });

  // ---- 4. Top / bottom performers ----
  let ranked = [];
  if (isLive && liveByVideo.size > 0) {
    ranked = longFormVideos.filter((v) => liveByVideo.has(v.youtube_id)).map(formatVideo);
  } else {
    ranked = longFormVideos.map(formatVideo);
  }

  const byViews = [...ranked].filter((v) => v.views != null && v.views > 0);
  const topByViews = [...byViews].sort((a, b) => b.views - a.views).slice(0, 5);
  const bottomUnderperformers = [...byViews].filter((v) => v.views > 0).sort((a, b) => a.views - b.views).slice(0, 5);
  const topByWatchTime = [...ranked].filter((v) => v.watchHours != null).sort((a, b) => b.watchHours - a.watchHours).slice(0, 5);

  // ---- 5. Flags ----
  const needsReviewCount = allVideos.filter((v) => ["needs_review", "unclassified"].includes(v.category_source)).length;
  const lowConfidenceCount = allVideos.filter(
    (v) => v.classification_confidence != null && v.classification_confidence < MIN_CLASSIFY_CONFIDENCE
  ).length;
  const uncategorisedCount = longFormVideos.filter((v) => !v.content_type).length;

  const flags = {
    pendingAiCount: allVideos.filter((v) => v.category_source === "ai_inferred").length,
    needsReviewCount,
    lowConfidenceCount,
    uncategorisedCount,
    unknownDurationCount,
    underperformingCount: bottomUnderperformers.length,
    underperformingVideos: bottomUnderperformers,
    decliningCategories: categoryStats.filter((c) => c.trajectory === "down"),
  };

  const audienceShift = {
    current: trafficShare,
    prior: priorTrafficShare,
    available: !!(trafficShare && priorTrafficShare),
    browseShift: trafficShare && priorTrafficShare ? Number((trafficShare.browse - priorTrafficShare.browse).toFixed(1)) : null,
    suggestedShift: trafficShare && priorTrafficShare ? Number((trafficShare.suggested - priorTrafficShare.suggested).toFixed(1)) : null,
    searchShift: trafficShare && priorTrafficShare ? Number((trafficShare.search - priorTrafficShare.search).toFixed(1)) : null,
  };

  const unavailableMetrics = [];
  if (!isLive) unavailableMetrics.push("all YouTube Analytics metrics (not connected)");
  if (!impressionsMetric.available) unavailableMetrics.push("impressions");
  if (!avgCtrMetric.available) unavailableMetrics.push("impressions click-through rate");
  if (!trafficShare) unavailableMetrics.push("traffic sources");
  if (totalSubscribers == null) unavailableMetrics.push("subscriber count");

  const uploadsThisPeriod = longFormVideos.filter((v) => new Date(v.published_at).getTime() >= periodStartMs).length;
  const uploadsPriorPeriod = longFormVideos.filter((v) => {
    const t = new Date(v.published_at).getTime();
    return t >= priorStartMs && t < periodStartMs;
  }).length;

  return {
    scorecard,
    categoryStats,
    topByViews,
    topByWatchTime,
    bottomUnderperformers,
    flags,
    audienceShift,
    satisfactionScore,
    uploadsThisPeriod,
    uploadsPriorPeriod,
    unavailableMetrics,
    isLiveStudioData: isLive,
    reachStatus,
    shortsThresholdSec: SHORTS_MAX_SEC,
  };
}

// ---------------------------------------------------------------------------
// 8. Channel health narrative (Gemini), instructions editable in Admin Settings
// ---------------------------------------------------------------------------
function getChannelHealthInstructions() {
  try {
    const row = db.prepare("SELECT channel_health_instructions FROM title_prompt_settings WHERE id = 1").get();
    if (row && row.channel_health_instructions && row.channel_health_instructions.trim()) {
      return row.channel_health_instructions.trim();
    }
  } catch (e) {
    console.warn("Could not read channel health instructions:", e.message);
  }
  return require("./db").DEFAULT_CHANNEL_HEALTH_PROMPT_INSTRUCTIONS || "";
}

function buildHealthDataBlock(report) {
  const s = report.scorecard;
  const line = (m) => {
    if (!m || !m.available) return `- ${m ? m.label : "Metric"}: UNAVAILABLE${m && m.note ? ` (${m.note})` : ""}`;
    const change = m.pctChange != null ? ` (${m.pctChange >= 0 ? "+" : ""}${m.pctChange}% vs prior period)` : "";
    const suffix = (m.label.includes("CTR") || m.label.includes("Share") || m.label.includes("%")) ? "%" : (m.label.includes("Hours") ? "h" : "");
    return `- ${m.label}: ${typeof m.value === "number" ? m.value.toLocaleString() : m.value}${suffix}${change}`;
  };

  const parts = [];
  parts.push(`REPORTING PERIOD: ${s.periodStart} to ${s.asOfDate} (${s.periodDays} days), compared against the ${s.periodDays} days before it.`);
  parts.push(`DATA SOURCE: ${report.isLiveStudioData ? "YouTube Analytics API (measured)" : "YouTube Analytics is NOT connected — almost no performance data is available"}`);
  parts.push("");
  parts.push("SCORECARD:");
  ["totalSubscribers", "views", "impressions", "avgCtr", "watchTimeHours", "suggestedShare", "avgRetention", "netSubs"].forEach((k) => {
    parts.push(line(s[k]));
  });

  parts.push("");
  parts.push(`UPLOADS: ${report.uploadsThisPeriod} long-form videos this period vs ${report.uploadsPriorPeriod} in the prior period.`);

  if (report.audienceShift.available) {
    const a = report.audienceShift;
    parts.push("");
    parts.push("TRAFFIC SOURCES (this period vs prior, percentage points):");
    parts.push(`- Browse: ${a.current.browse}% (${a.browseShift >= 0 ? "+" : ""}${a.browseShift})`);
    parts.push(`- Suggested: ${a.current.suggested}% (${a.suggestedShift >= 0 ? "+" : ""}${a.suggestedShift})`);
    parts.push(`- Search: ${a.current.search}% (${a.searchShift >= 0 ? "+" : ""}${a.searchShift})`);
  }

  const catsWithData = report.categoryStats.filter((c) => c.videoCount > 0);
  if (catsWithData.length > 0) {
    parts.push("");
    parts.push("CATEGORY BREAKDOWN:");
    catsWithData.forEach((c) => {
      const bits = [`${c.videoCount} videos in catalog`, `${c.uploadsThisPeriod} published this period (prior: ${c.uploadsPriorPeriod})`];
      if (c.avgRetention != null) bits.push(`measured avg retention ${c.avgRetention}% across ${c.retentionSampleSize} videos`);
      parts.push(`- ${c.name}: ${bits.join(", ")}`);
    });
  }

  if (report.topByViews.length > 0) {
    const lifetime = report.topByViews[0].viewsSource === "catalog_lifetime";
    parts.push("");
    parts.push(lifetime
      ? "TOP VIDEOS BY LIFETIME CATALOG VIEWS (not period views — YouTube Analytics is not connected, so these are all-time totals from the last catalog sync and say nothing about this period):"
      : "TOP VIDEOS THIS PERIOD:");
    report.topByViews.forEach((v, i) => {
      const bits = [`${(v.views || 0).toLocaleString()} views`];
      if (v.retentionRate != null) bits.push(`${v.retentionRate}% retention`);
      if (v.watchHours != null) bits.push(`${v.watchHours} watch hours`);
      parts.push(`  ${i + 1}. "${v.title}" [${v.category || "Unclassified"}] — ${bits.join(", ")}`);
    });
  }

  if (report.bottomUnderperformers.length > 0) {
    const lifetime = report.bottomUnderperformers[0].viewsSource === "catalog_lifetime";
    parts.push("");
    parts.push(lifetime
      ? "LOWEST VIDEOS BY LIFETIME CATALOG VIEWS (not period views):"
      : "LOWEST PERFORMING VIDEOS THIS PERIOD:");
    report.bottomUnderperformers.forEach((v, i) => {
      const bits = [`${(v.views || 0).toLocaleString()} views`];
      if (v.retentionRate != null) bits.push(`${v.retentionRate}% retention`);
      parts.push(`  ${i + 1}. "${v.title}" [${v.category || "Unclassified"}] — ${bits.join(", ")}`);
    });
  }

  parts.push("");
  parts.push("METRICS THAT ARE NOT AVAILABLE — do NOT estimate, infer, or invent these:");
  report.unavailableMetrics.forEach((m) => parts.push(`- ${m}`));

  if (report.flags.uncategorisedCount > 0 || report.flags.needsReviewCount > 0) {
    parts.push("");
    parts.push(`DATA QUALITY: ${report.flags.uncategorisedCount} long-form videos have no category, and ${report.flags.needsReviewCount} are awaiting classification review. Category figures above are incomplete by that amount.`);
  }

  return parts.join("\n");
}

async function generateHealthNarrative(report) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return { narrative: null, error: "Gemini API key is not configured." };
  }

  let modelName = DEFAULT_GEMINI_MODEL;
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'default_model'").get();
    if (row && row.value) modelName = row.value;
  } catch (e) {
    /* use default */
  }

  const prompt = `${getChannelHealthInstructions()}

ABSOLUTE RULE ON DATA:
Every number you cite must appear in the block below. Never estimate, extrapolate, or invent a metric listed as unavailable. If an analysis needs a number you do not have, say plainly that it is not available and what to check in YouTube Studio.

CHANNEL DATA:
${buildHealthDataBlock(report)}`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({ model: modelName, contents: prompt });
    const text = (response.text || "").trim();
    if (!text) return { narrative: null, error: "Model returned an empty response." };
    return { narrative: text, error: null };
  } catch (err) {
    console.warn("Channel health narrative failed:", err.message);
    return { narrative: null, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// 9. Channel health report history
// ---------------------------------------------------------------------------
function saveHealthReport(report, narrative, label) {
  const info = db.prepare(`
    INSERT INTO channel_health_reports (period_days, period_start, period_end, is_live_studio_data, report_json, narrative, label)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    report.scorecard.periodDays,
    report.scorecard.periodStart,
    report.scorecard.asOfDate,
    report.isLiveStudioData ? 1 : 0,
    JSON.stringify(report),
    narrative || null,
    label || null
  );
  return info.lastInsertRowid;
}

function listHealthReports(limit = 50) {
  return db.prepare(`
    SELECT id, period_days, period_start, period_end, is_live_studio_data, label, created_at,
           CASE WHEN narrative IS NULL THEN 0 ELSE 1 END AS has_narrative
    FROM channel_health_reports
    ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}

function getHealthReportById(id) {
  const row = db.prepare("SELECT * FROM channel_health_reports WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: row.id,
    periodDays: row.period_days,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    isLiveStudioData: !!row.is_live_studio_data,
    label: row.label,
    createdAt: row.created_at,
    narrative: row.narrative,
    report: JSON.parse(row.report_json),
  };
}

function deleteHealthReport(id) {
  return db.prepare("DELETE FROM channel_health_reports WHERE id = ?").run(id);
}

// Run a report, generate the narrative, and archive both.
async function runAndSaveHealthReport(periodDays = 28, options = {}) {
  const report = await getChannelHealthReport(periodDays);
  let narrative = null;
  let narrativeError = null;

  if (options.withNarrative !== false) {
    const result = await generateHealthNarrative(report);
    narrative = result.narrative;
    narrativeError = result.error;
  }

  const id = saveHealthReport(report, narrative, options.label);
  return { id, report, narrative, narrativeError };
}


module.exports = {
  getCategories,
  addCategory,
  updateCategory,
  deleteCategory,
  updateCategoryBenchmarks,
  deriveCategoryBenchmarks,
  getPlaylistMappings,
  savePlaylistMapping,
  deletePlaylistMapping,
  overrideVideoCategory,
  batchOverrideVideoCategories,
  saveAllAndAcceptAi,
  getVideoCatalog,
  bulkReclassifyLibrary,
  rollbackClassificationRun,
  listClassificationRuns,
  getReviewQueue,
  captureSnapshot,
  getChannelHealthReport,
  generateHealthNarrative,
  runAndSaveHealthReport,
  listHealthReports,
  getHealthReportById,
  deleteHealthReport,
  ensureReachJob,
  syncReachReports,
  getReachStatus,
  parseDurationSec,
  isLongForm,
  SHORTS_MAX_SEC,
};
