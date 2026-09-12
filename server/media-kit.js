"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { google } = require("googleapis");
const db = require("./db").articleDb;
const { isOAuthConnected, getAuthenticatedClient } = require("./youtube-analytics");
const { getYoutubeClient, getYoutubeChannelId } = require("./youtube");

// ---------------------------------------------------------------------------
// 1. Helpers & Date Lag Calculations
// ---------------------------------------------------------------------------

/**
 * Reporting lag helper: YouTube Analytics data lags roughly 48-72 hours.
 * Every query range must END 3 days before the run date, not yesterday.
 * @param {Date|string} [runDate]
 * @returns {string} YYYY-MM-DD
 */
function getEffectiveEndDate(runDate) {
  const d = runDate ? new Date(runDate) : new Date();
  d.setUTCDate(d.getUTCDate() - 3);
  return d.toISOString().split("T")[0];
}

/**
 * Format a Date object as YYYY-MM-DD
 */
function formatDateStr(d) {
  return d.toISOString().split("T")[0];
}

/**
 * Parse ISO 8601 duration string into seconds (e.g., PT18M6S -> 1086)
 */
function parseDurationSec(durationStr) {
  if (!durationStr) return null;
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const h = parseInt(match[1] || "0", 10);
  const m = parseInt(match[2] || "0", 10);
  const s = parseInt(match[3] || "0", 10);
  return h * 3600 + m * 60 + s;
}

/**
 * Duration-only filter: exclude Shorts (< 240 seconds)
 */
function isLongForm(durationStr) {
  const sec = parseDurationSec(durationStr);
  if (sec === null) return false;
  return sec >= 240;
}

/**
 * Helper to compute median, 25th percentile, and 75th percentile
 */
function calculatePercentiles(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const quantile = (q) => {
    const pos = (n - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return Math.round(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
    }
    return Math.round(sorted[base]);
  };

  return {
    count: n,
    p25: quantile(0.25),
    median: quantile(0.50),
    p75: quantile(0.75),
    min: sorted[0],
    max: sorted[n - 1],
  };
}

// ---------------------------------------------------------------------------
// 2. Off-Platform Manual Data
// ---------------------------------------------------------------------------

function getManualData() {
  const row = db.prepare("SELECT data_json, updated_at FROM media_kit_manual WHERE id = 1").get();
  if (!row || !row.data_json) return null;
  try {
    const parsed = JSON.parse(row.data_json);
    return { ...parsed, updated_at: row.updated_at };
  } catch (e) {
    console.error("[Media-Kit] Failed to parse media_kit_manual JSON:", e.message);
    return null;
  }
}

function saveManualData(data) {
  if (!data || typeof data !== "object") throw new Error("Invalid manual data payload.");
  const jsonStr = JSON.stringify(data);
  db.prepare(`
    INSERT INTO media_kit_manual (id, data_json, updated_at)
    VALUES (1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      data_json = excluded.data_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(jsonStr);
  return getManualData();
}

// ---------------------------------------------------------------------------
// 3. Job A: 28-Day & 365-Day View Capture (Public Only)
// ---------------------------------------------------------------------------

/**
 * Capture 28-day views for public long-form videos whose 28-day window closed
 */
async function capturePending28DayViews(effectiveEndDateStr) {
  const effectiveEnd = effectiveEndDateStr || getEffectiveEndDate();
  const auth = getAuthenticatedClient();
  if (!auth) {
    console.warn("[Media-Kit Job A] OAuth client not authenticated; skipping 28-day capture.");
    return { captured: 0, errors: 0 };
  }

  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });

  // Find public videos where published_at + 27 days <= effectiveEnd and not in video_28day_views
  const candidates = db.prepare(`
    SELECT youtube_id, published_at, duration
    FROM videos
    WHERE (privacy_status IS NULL OR privacy_status = 'public')
      AND date(published_at, '+27 days') <= date(?)
      AND youtube_id NOT IN (SELECT video_id FROM video_28day_views)
    ORDER BY published_at ASC
  `).all(effectiveEnd);

  const longFormCandidates = candidates.filter((v) => isLongForm(v.duration));
  let captured = 0;
  let errors = 0;

  for (const video of longFormCandidates) {
    try {
      const pubDate = new Date(video.published_at);
      const windowStart = formatDateStr(pubDate);
      const endDate = new Date(pubDate.getTime() + 27 * 86400000);
      const windowEnd = formatDateStr(endDate);

      const res = await ytAnalytics.reports.query({
        ids: "channel==MINE",
        startDate: windowStart,
        endDate: windowEnd,
        metrics: "views",
        filters: `video==${video.youtube_id}`,
      });

      const views28d = res.data?.rows?.[0]?.[0] || 0;

      db.prepare(`
        INSERT INTO video_28day_views (video_id, published_at, window_start, window_end, views_28d, captured_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(video_id) DO UPDATE SET
          views_28d = excluded.views_28d,
          captured_at = CURRENT_TIMESTAMP
      `).run(video.youtube_id, video.published_at, windowStart, windowEnd, views28d);

      captured++;
    } catch (err) {
      errors++;
      console.warn(`[Media-Kit Job A] 28-day capture error for ${video.youtube_id}:`, err.message);
    }
  }

  return { captured, errors, totalEvaluated: longFormCandidates.length };
}

/**
 * Capture 365-day views for public long-form videos whose 365-day window closed
 */
async function capturePending365DayViews(effectiveEndDateStr) {
  const effectiveEnd = effectiveEndDateStr || getEffectiveEndDate();
  const auth = getAuthenticatedClient();
  if (!auth) {
    console.warn("[Media-Kit Job A] OAuth client not authenticated; skipping 365-day capture.");
    return { captured: 0, errors: 0 };
  }

  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });

  // Find videos in video_28day_views where views_365d is NULL and 365-day window closed
  const candidates = db.prepare(`
    SELECT v28.video_id, v28.published_at, v.duration, v.privacy_status
    FROM video_28day_views v28
    JOIN videos v ON v.youtube_id = v28.video_id
    WHERE (v.privacy_status IS NULL OR v.privacy_status = 'public')
      AND v28.views_365d IS NULL
      AND date(v28.published_at, '+364 days') <= date(?)
    ORDER BY v28.published_at ASC
  `).all(effectiveEnd);

  const longFormCandidates = candidates.filter((v) => isLongForm(v.duration));
  let captured = 0;
  let errors = 0;

  for (const item of longFormCandidates) {
    try {
      const pubDate = new Date(item.published_at);
      const windowStart = formatDateStr(pubDate);
      const endDate = new Date(pubDate.getTime() + 364 * 86400000);
      const windowEnd = formatDateStr(endDate);

      const res = await ytAnalytics.reports.query({
        ids: "channel==MINE",
        startDate: windowStart,
        endDate: windowEnd,
        metrics: "views",
        filters: `video==${item.video_id}`,
      });

      const views365d = res.data?.rows?.[0]?.[0] || 0;

      db.prepare(`
        UPDATE video_28day_views
        SET views_365d = ?, captured_365d_at = CURRENT_TIMESTAMP
        WHERE video_id = ?
      `).run(views365d, item.video_id);

      captured++;
    } catch (err) {
      errors++;
      console.warn(`[Media-Kit Job A] 365-day capture error for ${item.video_id}:`, err.message);
    }
  }

  return { captured, errors, totalEvaluated: longFormCandidates.length };
}

/**
 * Combined Job A runner
 */
async function runJobA() {
  const startTime = Date.now();
  const effectiveEnd = getEffectiveEndDate();
  console.log(`[Media-Kit Job A] Starting 28d/365d nightly capture (effectiveEndDate: ${effectiveEnd})`);

  const res28 = await capturePending28DayViews(effectiveEnd);
  const res365 = await capturePending365DayViews(effectiveEnd);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `[Media-Kit Job A] Finished in ${durationSec}s. 28d captured: ${res28.captured}/${res28.totalEvaluated} (${res28.errors} errors). 365d captured: ${res365.captured}/${res365.totalEvaluated} (${res365.errors} errors).`
  );

  return { res28, res365, durationSec };
}

// ---------------------------------------------------------------------------
// 4. Job B: Metric Computation & Snapshot Generation
// ---------------------------------------------------------------------------

async function queryAnalyticsSafe(ytAnalytics, params, label) {
  try {
    const res = await ytAnalytics.reports.query(params);
    return res.data || null;
  } catch (err) {
    console.warn(`[Media-Kit Query ${label}] Failed:`, err.message);
    return null;
  }
}

/**
 * Execute full metrics computation and create snapshot
 */
async function generateMediaKitSnapshot(onProgress = () => {}) {
  const startTime = Date.now();
  const effectiveEnd = getEffectiveEndDate();
  onProgress("validating_auth", "Checking YouTube authentication credentials…");

  if (!isOAuthConnected()) {
    throw new Error("YouTube OAuth is not connected. Please connect via Admin Settings.");
  }

  const auth = getAuthenticatedClient();
  if (!auth) {
    throw new Error("Failed to initialize authenticated YouTube OAuth client.");
  }

  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });
  const ytData = google.youtube({ version: "v3", auth });

  // 1. YouTube Data API v3: Channel Statistics
  onProgress("fetching_channel_stats", "Fetching channel-level statistics from YouTube…");
  let channelStats = null;
  try {
    const chRes = await ytData.channels.list({
      part: "statistics,snippet,contentDetails",
      mine: true,
    });
    const chItem = chRes.data?.items?.[0];
    if (chItem) {
      channelStats = {
        title: chItem.snippet?.title || "The Electric Duo",
        subscriberCount: parseInt(chItem.statistics?.subscriberCount || "0", 10) || null,
        lifetimeViews: parseInt(chItem.statistics?.viewCount || "0", 10) || null,
        videoCount: parseInt(chItem.statistics?.videoCount || "0", 10) || null,
        thumbnailUrl: chItem.snippet?.thumbnails?.medium?.url || null,
      };
    }
  } catch (err) {
    console.warn("[Media-Kit] Channel stats query failed:", err.message);
  }

  // 2. YouTube Analytics API: Trailing 90 Days
  onProgress("querying_trailing_90d", "Querying trailing 90-day engagement metrics…");
  const effectiveEndDateObj = new Date(`${effectiveEnd}T00:00:00Z`);
  const t90Start = formatDateStr(new Date(effectiveEndDateObj.getTime() - 90 * 86400000));

  const t90Res = await queryAnalyticsSafe(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate: t90Start,
      endDate: effectiveEnd,
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares",
    },
    "Trailing 90 Days"
  );

  let trailing90d = null;
  if (t90Res?.rows?.[0]) {
    const row = t90Res.rows[0];
    const views = row[0] || 0;
    const estMinutes = row[1] || 0;
    const avdSec = row[2] || 0;
    const avpPct = row[3] || 0;
    const likes = row[4] || 0;
    const comments = row[5] || 0;
    const shares = row[6] || 0;
    const totalEngagement = likes + comments + shares;

    trailing90d = {
      views: views || null,
      watchHours: estMinutes > 0 ? Math.round(estMinutes / 60) : null,
      avgViewDurationSec: avdSec || null,
      avgViewPercentage: avpPct > 0 ? Number(avpPct.toFixed(1)) : null,
      likes,
      comments,
      shares,
      engagementRate: views > 0 ? Number(((totalEngagement / views) * 100).toFixed(2)) : null,
    };
  }

  // 3. YouTube Analytics API: Trailing 12 Months Monthly Growth Curve
  onProgress("querying_trailing_12m", "Querying 12-month growth curve and annual watch hours…");
  const t365Start = formatDateStr(new Date(effectiveEndDateObj.getTime() - 365 * 86400000));

  const t12mRes = await queryAnalyticsSafe(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate: t365Start,
      endDate: effectiveEnd,
      dimensions: "month",
      metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
      sort: "month",
    },
    "Trailing 12 Months"
  );

  let trailing12m = {
    months: [],
    totalWatchHours: null,
    totalViews: null,
    monthlyAverageViews: null,
  };

  if (t12mRes?.rows && t12mRes.rows.length > 0) {
    let sumMinutes = 0;
    let sumViews = 0;

    trailing12m.months = t12mRes.rows.map((r) => {
      const mViews = r[1] || 0;
      const mMinutes = r[2] || 0;
      const gained = r[3] || 0;
      const lost = r[4] || 0;
      sumViews += mViews;
      sumMinutes += mMinutes;
      return {
        month: r[0],
        views: mViews,
        watchHours: Math.round(mMinutes / 60),
        netSubscribers: gained - lost,
      };
    });

    trailing12m.totalWatchHours = Math.round(sumMinutes / 60);
    trailing12m.totalViews = sumViews;
    trailing12m.monthlyAverageViews = Math.round(sumViews / trailing12m.months.length);
  }

  // 4. YouTube Analytics API: Trailing 365 Days Top Markets (Country)
  onProgress("querying_demographics", "Querying global audience markets and demographics…");
  const countryRes = await queryAnalyticsSafe(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate: t365Start,
      endDate: effectiveEnd,
      dimensions: "country",
      metrics: "views",
      sort: "-views",
      maxResults: 10,
    },
    "Top Markets"
  );

  let topMarkets = [];
  if (countryRes?.rows && countryRes.rows.length > 0) {
    const totalViewsAll = countryRes.rows.reduce((sum, r) => sum + (r[1] || 0), 0);
    if (totalViewsAll > 0) {
      topMarkets = countryRes.rows.slice(0, 5).map((r) => ({
        countryCode: r[0],
        views: r[1],
        sharePercent: Number(((r[1] / totalViewsAll) * 100).toFixed(1)),
      }));
    }
  }

  // 5. YouTube Analytics API: Age & Gender Breakdown (365d)
  const ageGenderRes = await queryAnalyticsSafe(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate: t365Start,
      endDate: effectiveEnd,
      dimensions: "ageGroup,gender",
      metrics: "viewerPercentage",
      sort: "ageGroup,gender",
    },
    "Age and Gender"
  );

  let ageDistribution = {};
  let genderDistribution = { male: null, female: null };
  if (ageGenderRes?.rows && ageGenderRes.rows.length > 0) {
    let malePct = 0;
    let femalePct = 0;

    ageGenderRes.rows.forEach((r) => {
      const ageGroup = r[0].replace("age", ""); // "age25-34" -> "25-34"
      const gender = r[1]; // "male" or "female"
      const pct = parseFloat(r[2]) || 0;

      if (!ageDistribution[ageGroup]) ageDistribution[ageGroup] = 0;
      ageDistribution[ageGroup] += pct;

      if (gender === "male") malePct += pct;
      if (gender === "female") femalePct += pct;
    });

    // Normalize age percentages to 1-decimal
    for (const k of Object.keys(ageDistribution)) {
      ageDistribution[k] = Number(ageDistribution[k].toFixed(1));
    }
    const totalGender = malePct + femalePct;
    if (totalGender > 0) {
      genderDistribution.male = Number(((malePct / totalGender) * 100).toFixed(1));
      genderDistribution.female = Number(((femalePct / totalGender) * 100).toFixed(1));
    }
  }

  // 6. YouTube Analytics API: Device Types (365d)
  const deviceRes = await queryAnalyticsSafe(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate: t365Start,
      endDate: effectiveEnd,
      dimensions: "deviceType",
      metrics: "views",
    },
    "Device Breakdown"
  );

  let deviceBreakdown = [];
  if (deviceRes?.rows && deviceRes.rows.length > 0) {
    const totalDeviceViews = deviceRes.rows.reduce((sum, r) => sum + (r[1] || 0), 0);
    if (totalDeviceViews > 0) {
      deviceBreakdown = deviceRes.rows.map((r) => ({
        device: r[0],
        sharePercent: Number(((r[1] / totalDeviceViews) * 100).toFixed(1)),
      }));
    }
  }

  // 7. YouTube Analytics API: Subscriber Status (365d)
  const subStatusRes = await queryAnalyticsSafe(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate: t365Start,
      endDate: effectiveEnd,
      dimensions: "subscribedStatus",
      metrics: "views",
    },
    "Subscriber Status"
  );

  let subscriberStatus = {
    subscriberViews: null,
    nonSubscriberViews: null,
    nonSubscriberSharePercent: null,
  };
  if (subStatusRes?.rows && subStatusRes.rows.length > 0) {
    let subViews = 0;
    let nonSubViews = 0;
    subStatusRes.rows.forEach((r) => {
      if (r[0] === "SUBSCRIBED") subViews += r[1] || 0;
      if (r[0] === "NOT_SUBSCRIBED") nonSubViews += r[1] || 0;
    });
    const totalSubStatusViews = subViews + nonSubViews;
    if (totalSubStatusViews > 0) {
      subscriberStatus = {
        subscriberViews: subViews,
        nonSubscriberViews: nonSubViews,
        nonSubscriberSharePercent: Number(((nonSubViews / totalSubStatusViews) * 100).toFixed(1)),
      };
    }
  }

  // 8. YouTube Analytics API: Traffic Sources (365d)
  const trafficRes = await queryAnalyticsSafe(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate: t365Start,
      endDate: effectiveEnd,
      dimensions: "insightTrafficSourceType",
      metrics: "views",
    },
    "Traffic Sources"
  );

  let trafficBreakdown = {
    searchPercent: null,
    browsePercent: null,
    suggestedPercent: null,
    otherPercent: null,
  };
  if (trafficRes?.rows && trafficRes.rows.length > 0) {
    let totalTraffic = 0;
    let search = 0;
    let browse = 0;
    let suggested = 0;
    let other = 0;

    trafficRes.rows.forEach(([src, v]) => {
      totalTraffic += v || 0;
      if (src === "YT_SEARCH") search += v;
      else if (src === "SUBSCRIBER" || src === "BROWSE") browse += v;
      else if (src === "RELATED_VIDEO") suggested += v;
      else other += v;
    });

    if (totalTraffic > 0) {
      trafficBreakdown = {
        searchPercent: Number(((search / totalTraffic) * 100).toFixed(1)),
        browsePercent: Number(((browse / totalTraffic) * 100).toFixed(1)),
        suggestedPercent: Number(((suggested / totalTraffic) * 100).toFixed(1)),
        otherPercent: Number(((other / totalTraffic) * 100).toFixed(1)),
      };
    }
  }

  // 9. YouTube Analytics API: Per-Video Trailing 90 Days (For Recent Work Retention & Views)
  onProgress("querying_recent_retention", "Fetching per-video views and retention for recent uploads…");
  const videoPerfRes = await queryAnalyticsSafe(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate: t90Start,
      endDate: effectiveEnd,
      dimensions: "video",
      metrics: "views,averageViewPercentage",
      sort: "-views",
      maxResults: 50,
    },
    "Per-Video 90d Performance"
  );

  const videoPerfMap = new Map();
  if (videoPerfRes?.rows && videoPerfRes.rows.length > 0) {
    videoPerfRes.rows.forEach(([vId, vViews, vAvp]) => {
      videoPerfMap.set(vId, {
        views90d: vViews || 0,
        avgRetentionPct: vAvp != null ? Number(vAvp.toFixed(1)) : null,
      });
    });
  }

  // 10. Derived: Median & Percentiles for 28-Day Views (from video_28day_views)
  onProgress("computing_derived_metrics", "Computing 28-day percentiles and long-tail multiples…");
  const pastYearVideos = db.prepare(`
    SELECT views_28d
    FROM video_28day_views
    WHERE date(published_at) >= date(?, '-365 days')
      AND date(published_at) <= date(?)
      AND views_28d IS NOT NULL
  `).all(effectiveEnd, effectiveEnd);

  const views28dList = pastYearVideos.map((r) => r.views_28d);
  const views28dPercentiles = calculatePercentiles(views28dList);

  // 11. Derived: Long-Tail Multiple (views_365d / views_28d)
  const evergreenVideos = db.prepare(`
    SELECT views_28d, views_365d
    FROM video_28day_views
    WHERE views_28d > 0
      AND views_365d IS NOT NULL
      AND views_365d > 0
  `).all();

  let longTailMultiple = null;
  if (evergreenVideos.length > 0) {
    const multiples = evergreenVideos.map((v) => v.views_365d / v.views_28d);
    const p = calculatePercentiles(multiples);
    if (p && p.median != null) {
      longTailMultiple = Number(p.median.toFixed(2));
    }
  }

  // 12. Derived: Content Pillars from Existing Categories & Videos
  onProgress("processing_content_pillars", "Aggregating content pillars and lifetime category reach…");
  const categoryAggregates = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.description,
      c.color,
      COUNT(v.youtube_id) AS video_count,
      COALESCE(SUM(v.view_count), 0) AS lifetime_views
    FROM content_categories c
    LEFT JOIN videos v ON v.content_type = c.name AND (v.privacy_status IS NULL OR v.privacy_status = 'public')
    GROUP BY c.id, c.name
    HAVING COUNT(v.youtube_id) >= 4 AND COALESCE(SUM(v.view_count), 0) >= 10000
    ORDER BY lifetime_views DESC
  `).all();

  const maxCategoryViews = categoryAggregates[0]?.lifetime_views || 1;
  const contentPillars = categoryAggregates.map((cat) => ({
    id: cat.id,
    name: cat.name,
    description: cat.description,
    color: cat.color || "#00B1E2",
    videoCount: cat.video_count,
    lifetimeViews: cat.lifetime_views,
    relativeWidthPercent: Math.min(100, Math.max(10, Math.round((cat.lifetime_views / maxCategoryViews) * 100))),
  }));

  // 13. Recent Work: 3 Most Recent Public Long-Form Videos
  onProgress("compiling_recent_work", "Selecting recent highlight videos…");
  const recentPublicVideos = db.prepare(`
    SELECT youtube_id, title, published_at, thumbnail_url, duration, view_count
    FROM videos
    WHERE (privacy_status IS NULL OR privacy_status = 'public')
    ORDER BY published_at DESC
  `).all();

  const recentLongForm = recentPublicVideos.filter((v) => isLongForm(v.duration)).slice(0, 3);
  const recentWork = recentLongForm.map((v) => {
    const perf = videoPerfMap.get(v.youtube_id);
    return {
      youtubeId: v.youtube_id,
      title: v.title,
      publishedAt: v.published_at,
      thumbnailUrl: v.thumbnail_url || `https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`,
      views: v.view_count || perf?.views90d || null,
      retentionRate: perf?.avgRetentionPct != null ? perf.avgRetentionPct : null,
    };
  });

  // 14. Assemble Complete Snapshot Object
  onProgress("saving_snapshot", "Assembling final snapshot and committing to storage…");
  const snapshotData = {
    effectiveEndDate: effectiveEnd,
    channel: channelStats,
    trailing90d,
    trailing12m,
    reach: {
      subscribers: channelStats?.subscriberCount || null,
      monthlyViews: trailing12m?.monthlyAverageViews || null,
      lifetimeViews: channelStats?.lifetimeViews || null,
      annualWatchHours: trailing12m?.totalWatchHours || null,
      medianViews28d: views28dPercentiles?.median || null,
      p25Views28d: views28dPercentiles?.p25 || null,
      p75Views28d: views28dPercentiles?.p75 || null,
      views28dCount: views28dPercentiles?.count || null,
      avgViewPercentage: trailing90d?.avgViewPercentage || null,
      engagementRate: trailing90d?.engagementRate || null,
    },
    audience: {
      topMarkets,
      ageDistribution,
      genderDistribution,
      deviceBreakdown,
      subscriberStatus,
      trafficBreakdown,
      longTailMultiple,
    },
    contentPillars,
    recentWork,
    generatedAt: new Date().toISOString(),
  };

  // 15. Transactional Append & Prune (Keep Latest 24)
  const insertAndPrune = db.transaction(() => {
    const insertStmt = db.prepare(`
      INSERT INTO media_kit_snapshots (snapshot_date, data_json, created_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
    `);
    const info = insertStmt.run(effectiveEnd, JSON.stringify(snapshotData));

    db.prepare(`
      DELETE FROM media_kit_snapshots
      WHERE id NOT IN (
        SELECT id FROM media_kit_snapshots
        ORDER BY id DESC
        LIMIT 24
      )
    `).run();

    return info.lastInsertRowid;
  });

  const snapshotId = insertAndPrune();
  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Media-Kit Job B] Snapshot #${snapshotId} created successfully in ${elapsedSec}s (pruned to 24)`);

  return {
    snapshotId,
    effectiveEndDate: effectiveEnd,
    snapshot: snapshotData,
    elapsedSec,
  };
}

// ---------------------------------------------------------------------------
// 5. In-Memory Job Runner for Asynchronous "Refresh Now"
// ---------------------------------------------------------------------------

const activeSnapshotJobs = new Map();

function startSnapshotJob() {
  // Check if a job is already in progress
  for (const [id, job] of activeSnapshotJobs.entries()) {
    if (job.status === "running") {
      return { jobId: id, alreadyRunning: true, status: job.status, progressStage: job.progressStage };
    }
  }

  const jobId = crypto.randomUUID ? crypto.randomUUID() : `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const jobState = {
    jobId,
    status: "running",
    progressStage: "initializing",
    progressMessage: "Starting snapshot rebuild…",
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    snapshotId: null,
  };

  activeSnapshotJobs.set(jobId, jobState);

  // Run in background without awaiting
  (async () => {
    try {
      // First run 28d/365d capture so the views table has fresh data
      jobState.progressStage = "capturing_views";
      jobState.progressMessage = "Capturing closed 28-day view windows…";
      try {
        await capturePending28DayViews();
        await capturePending365DayViews();
      } catch (capErr) {
        console.warn("[Media-Kit Refresh] 28d/365d capture note:", capErr.message);
      }

      // Generate the snapshot
      const result = await generateMediaKitSnapshot((stage, message) => {
        jobState.progressStage = stage;
        jobState.progressMessage = message;
      });

      jobState.status = "completed";
      jobState.progressStage = "done";
      jobState.progressMessage = "Snapshot generated successfully.";
      jobState.completedAt = new Date().toISOString();
      jobState.snapshotId = result.snapshotId;
    } catch (err) {
      console.error("[Media-Kit Refresh] Snapshot generation failed:", err);
      jobState.status = "failed";
      jobState.progressStage = "error";
      jobState.progressMessage = err.message || "Snapshot generation failed.";
      jobState.error = err.message;
      jobState.completedAt = new Date().toISOString();
    }
  })();

  return { jobId, alreadyRunning: false, status: "running" };
}

function getSnapshotJobStatus(jobId) {
  if (!jobId) {
    // Return latest job if no specific ID provided
    const jobs = Array.from(activeSnapshotJobs.values());
    return jobs[jobs.length - 1] || null;
  }
  return activeSnapshotJobs.get(jobId) || null;
}

// ---------------------------------------------------------------------------
// 6. Read Latest Snapshot for Zero-API-Call Page Load
// ---------------------------------------------------------------------------

function getLatestSnapshot() {
  const row = db.prepare(`
    SELECT id, snapshot_date, created_at, data_json
    FROM media_kit_snapshots
    ORDER BY id DESC
    LIMIT 1
  `).get();

  if (!row) return null;

  try {
    const data = JSON.parse(row.data_json);
    return {
      id: row.id,
      snapshotDate: row.snapshot_date,
      createdAt: row.created_at,
      data,
    };
  } catch (err) {
    console.error("[Media-Kit] Failed to parse latest snapshot JSON:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 7. Disk Storage for Partner Logo Uploads
// ---------------------------------------------------------------------------

const UPLOADS_DIR = path.join(__dirname, "..", "public", "uploads", "media-kit");

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

/**
 * Save an uploaded partner logo to disk
 * Accepts base64 data string (e.g. data:image/png;base64,... or raw base64)
 * Max size capped at 100KB
 */
function savePartnerLogo(base64Data, originalName = "logo.png") {
  ensureUploadsDir();

  let mimeType = "image/png";
  let rawBase64 = base64Data;

  if (base64Data.includes(";base64,")) {
    const parts = base64Data.split(";base64,");
    mimeType = parts[0].replace("data:", "");
    rawBase64 = parts[1];
  }

  const allowedTypes = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  };

  const ext = allowedTypes[mimeType];
  if (!ext) {
    throw new Error("Invalid image format. Allowed formats: PNG, WebP, JPEG, SVG.");
  }

  const buffer = Buffer.from(rawBase64, "base64");
  if (buffer.length > 100 * 1024) {
    throw new Error(`File exceeds maximum size limit of 100KB (size: ${Math.round(buffer.length / 1024)}KB).`);
  }

  const cleanName = path.basename(originalName, path.extname(originalName)).replace(/[^a-zA-Z0-9_-]/g, "");
  const filename = `partner_${cleanName}_${Date.now().toString(36)}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(filePath, buffer);

  return {
    url: `/uploads/media-kit/${filename}`,
    filename,
    sizeBytes: buffer.length,
  };
}

module.exports = {
  getEffectiveEndDate,
  parseDurationSec,
  isLongForm,
  getManualData,
  saveManualData,
  capturePending28DayViews,
  capturePending365DayViews,
  runJobA,
  generateMediaKitSnapshot,
  startSnapshotJob,
  getSnapshotJobStatus,
  getLatestSnapshot,
  savePartnerLogo,
};
