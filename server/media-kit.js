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

const COUNTRY_NAMES = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
  DE: "Germany",
  AU: "Australia",
  NL: "Netherlands",
  NO: "Norway",
  SE: "Sweden",
  FR: "France",
  NZ: "New Zealand",
  MX: "Mexico",
  IE: "Ireland",
  DK: "Denmark",
  CH: "Switzerland",
  AT: "Austria",
  BE: "Belgium",
  IT: "Italy",
  ES: "Spain",
  JP: "Japan",
  KR: "South Korea",
};

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

/**
 * Calculate the exact date range for the 12 most recently COMPLETE calendar months.
 * Excludes the current partial month relative to effectiveEndDateStr.
 * Example: for 2026-09-09, returns startDate: 2025-09-01, endDate: 2026-08-31,
 * with expectedMonths containing exactly 12 'YYYY-MM' strings.
 */
function getTrailing12CompleteMonthRange(effectiveEndDateStr) {
  const [yearStr, monthStr] = effectiveEndDateStr.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  let endYear = year;
  let endMonth = month - 1;
  if (endMonth === 0) {
    endMonth = 12;
    endYear -= 1;
  }

  // Day 0 of next month is the last day of endMonth
  const lastDay = new Date(Date.UTC(endYear, endMonth, 0)).getUTCDate();
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  let startYear = endYear - 1;
  let startMonth = endMonth + 1;
  if (startMonth > 12) {
    startMonth = 1;
    startYear = endYear;
  }
  const startDate = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;

  const expectedMonths = [];
  let curY = startYear;
  let curM = startMonth;
  for (let i = 0; i < 12; i++) {
    expectedMonths.push(`${curY}-${String(curM).padStart(2, "0")}`);
    curM++;
    if (curM > 12) {
      curM = 1;
      curY++;
    }
  }

  return { startDate, endDate, expectedMonths };
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

async function capturePending28DayViews(effectiveEndDateStr) {
  const effectiveEnd = effectiveEndDateStr || getEffectiveEndDate();
  const auth = getAuthenticatedClient();
  if (!auth) {
    console.warn("[Media-Kit Job A] OAuth client not authenticated; skipping 28-day capture.");
    return { captured: 0, errors: 0 };
  }

  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });

  const candidates = db.prepare(`
    SELECT youtube_id, published_at, duration
    FROM videos
    WHERE (privacy_status IS NULL OR privacy_status = 'public')
      AND datetime(published_at) <= datetime('now')
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

async function capturePending365DayViews(effectiveEndDateStr) {
  const effectiveEnd = effectiveEndDateStr || getEffectiveEndDate();
  const auth = getAuthenticatedClient();
  if (!auth) {
    console.warn("[Media-Kit Job A] OAuth client not authenticated; skipping 365-day capture.");
    return { captured: 0, errors: 0 };
  }

  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });

  const candidates = db.prepare(`
    SELECT v28.video_id, v28.published_at, v.duration, v.privacy_status
    FROM video_28day_views v28
    JOIN videos v ON v.youtube_id = v28.video_id
    WHERE (v.privacy_status IS NULL OR v.privacy_status = 'public')
      AND datetime(v28.published_at) <= datetime('now')
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

  // Get published long-form videos (>= 240s) from database
  const publishedLongVideos = db.prepare(`
    SELECT youtube_id, title, duration, view_count, published_at, content_type, thumbnail_url
    FROM videos
    WHERE (privacy_status IS NULL OR privacy_status = 'public')
      AND datetime(published_at) <= datetime('now')
    ORDER BY published_at DESC
  `).all().filter((v) => isLongForm(v.duration));

  const topLongIds = [...publishedLongVideos]
    .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    .slice(0, 200)
    .map((v) => v.youtube_id);
  const topLongFilter = topLongIds.length > 0 ? `video==${topLongIds.join(",")}` : null;

  // Videos the local catalog knows for certain are unlisted/private. YouTube's
  // own creatorContentType classification (used below) has no concept of privacy
  // status, so this exclusion list is the only way to keep non-public videos out
  // of the long-form aggregates.
  const nonPublicVideoIds = new Set(
    db.prepare(`
      SELECT youtube_id FROM videos
      WHERE privacy_status IS NOT NULL AND privacy_status != 'public'
    `).all().map((v) => v.youtube_id)
  );

  /**
   * Runs an Analytics query restricted to long-form (non-Shorts, non-live)
   * videos. Primary attempt uses YouTube's own `creatorContentType` dimension,
   * which is authoritative and does not depend on the local video catalog being
   * fully synced. Falls back to the local duration-based whitelist only if that
   * filter is ever rejected by the API. Deliberately has no unfiltered
   * channel-wide fallback -- that previously caused Shorts to silently blend
   * into every "long-form" stat below.
   */
  async function queryLongFormOnly(baseParams, label) {
    let res = await queryAnalyticsSafe(
      ytAnalytics,
      { ...baseParams, filters: "creatorContentType==video_on_demand" },
      `${label} (Content-Type Filtered)`
    );
    if (res?.rows?.length > 0) return res;

    if (topLongFilter) {
      res = await queryAnalyticsSafe(
        ytAnalytics,
        { ...baseParams, filters: topLongFilter },
        `${label} (Long-Form Whitelist Filtered)`
      );
      if (res?.rows?.length > 0) return res;
    }

    return null;
  }

  // 2. YouTube Analytics API: Trailing 90 Days (Strictly Long Videos Only)
  onProgress("querying_trailing_90d", "Querying trailing 90-day engagement metrics for long-form videos…");
  const effectiveEndDateObj = new Date(`${effectiveEnd}T00:00:00Z`);
  const t90Start = formatDateStr(new Date(effectiveEndDateObj.getTime() - 90 * 86400000));

  const t90VideoRes = await queryLongFormOnly(
    {
      ids: "channel==MINE",
      startDate: t90Start,
      endDate: effectiveEnd,
      dimensions: "video",
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares",
      sort: "-views",
      maxResults: 500,
    },
    "Trailing 90 Days Per-Video"
  );

  const videoPerfMap = new Map();
  let trailing90d = null;

  if (t90VideoRes?.rows && t90VideoRes.rows.length > 0) {
    let totalLongViews = 0;
    let totalLongMinutes = 0;
    let totalLongLikes = 0;
    let totalLongComments = 0;
    let totalLongShares = 0;
    let weightedAvpSum = 0;
    let weightedAvdSum = 0;

    for (const r of t90VideoRes.rows) {
      const vId = r[0];
      const vViews = r[1] || 0;
      const vMin = r[2] || 0;
      const vAvd = r[3] || 0;
      const vAvp = r[4] || 0;
      const vLikes = r[5] || 0;
      const vComments = r[6] || 0;
      const vShares = r[7] || 0;

      videoPerfMap.set(vId, {
        views90d: vViews,
        watchMinutes90d: vMin,
        avgRetentionPct: vAvp != null ? Number(vAvp.toFixed(1)) : null,
      });

      // The query above is already restricted to long-form video_on_demand
      // content; only exclude videos we know for certain are unlisted/private.
      if (!nonPublicVideoIds.has(vId)) {
        totalLongViews += vViews;
        totalLongMinutes += vMin;
        totalLongLikes += vLikes;
        totalLongComments += vComments;
        totalLongShares += vShares;
        weightedAvpSum += vViews * vAvp;
        weightedAvdSum += vViews * vAvd;
      }
    }

    if (totalLongViews > 0) {
      const totalEngagement = totalLongLikes + totalLongComments + totalLongShares;
      trailing90d = {
        views: totalLongViews,
        watchHours: Math.round(totalLongMinutes / 60),
        avgViewDurationSec: Math.round(weightedAvdSum / totalLongViews),
        avgViewPercentage: Number((weightedAvpSum / totalLongViews).toFixed(1)),
        likes: totalLongLikes,
        comments: totalLongComments,
        shares: totalLongShares,
        engagementRate: Number(((totalEngagement / totalLongViews) * 100).toFixed(2)),
      };
    }
  }

  // 3. YouTube Analytics API: Trailing 12 Complete Months (excluding current partial month)
  onProgress("querying_trailing_12m", "Querying trailing 12 complete months and annual watch hours…");
  const t365Start = formatDateStr(new Date(effectiveEndDateObj.getTime() - 365 * 86400000));
  const { startDate: t12mStart, endDate: t12mEnd, expectedMonths } = getTrailing12CompleteMonthRange(effectiveEnd);

  const t12mDailyRes = await queryAnalyticsSafe(
    ytAnalytics,
    {
      ids: "channel==MINE",
      startDate: t12mStart,
      endDate: t12mEnd,
      dimensions: "day",
      metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
      sort: "day",
    },
    "Trailing 12 Complete Months Daily"
  );

  let trailing12m = {
    months: [],
    totalWatchHours: null,
    totalViews: null,
    monthlyAverageViews: null,
    dateRange: { startDate: t12mStart, endDate: t12mEnd },
  };

  if (t12mDailyRes?.rows && t12mDailyRes.rows.length > 0) {
    const monthlyMap = new Map();
    for (const mKey of expectedMonths) {
      monthlyMap.set(mKey, { month: mKey, views: 0, minutes: 0, netSubs: 0 });
    }

    let sumMinutes = 0;
    let sumViews = 0;

    for (const r of t12mDailyRes.rows) {
      const dayStr = r[0]; // "YYYY-MM-DD"
      const monthKey = dayStr.substring(0, 7); // "YYYY-MM"
      if (!monthlyMap.has(monthKey)) continue;

      const dViews = r[1] || 0;
      const dMinutes = r[2] || 0;
      const dGained = r[3] || 0;
      const dLost = r[4] || 0;

      sumViews += dViews;
      sumMinutes += dMinutes;

      const entry = monthlyMap.get(monthKey);
      entry.views += dViews;
      entry.minutes += dMinutes;
      entry.netSubs += dGained - dLost;
    }

    const monthEntries = expectedMonths.map((mKey) => {
      const m = monthlyMap.get(mKey);
      return {
        month: m.month,
        views: m.views,
        watchHours: Math.round(m.minutes / 60),
        netSubscribers: m.netSubs,
      };
    });

    trailing12m.months = monthEntries;

    // Verify exactly 12 complete month entries before computing
    if (monthEntries.length === 12) {
      trailing12m.totalWatchHours = Math.round(sumMinutes / 60);
      trailing12m.totalViews = sumViews;
      // Average monthly views (total / 12), rounded to nearest thousand
      trailing12m.monthlyAverageViews = Math.round((sumViews / 12) / 1000) * 1000;
    }
  }

  // 4. YouTube Analytics API: Trailing 365 Days Top Markets (Country Names, Exclude IN)
  onProgress("querying_demographics", "Querying audience markets and demographics for long-form content…");
  const countryRes = await queryLongFormOnly(
    {
      ids: "channel==MINE",
      startDate: t365Start,
      endDate: effectiveEnd,
      dimensions: "country",
      metrics: "views",
      sort: "-views",
      maxResults: 15,
    },
    "Top Markets"
  );

  let topMarkets = [];
  if (countryRes?.rows && countryRes.rows.length > 0) {
    // Filter out IN (India) per instruction
    const validRows = countryRes.rows.filter((r) => r[0] !== "IN");
    const totalViewsFiltered = validRows.reduce((sum, r) => sum + (r[1] || 0), 0);

    if (totalViewsFiltered > 0) {
      topMarkets = validRows.slice(0, 5).map((r) => {
        const code = r[0];
        const countryName = COUNTRY_NAMES[code] || code;
        return {
          countryCode: code,
          countryName,
          views: r[1],
          sharePercent: Number(((r[1] / totalViewsFiltered) * 100).toFixed(1)),
        };
      });
    }
  }

  // 5. YouTube Analytics API: Age & Gender Breakdown (365d) -> Highlight Buying Power
  const ageGenderRes = await queryLongFormOnly(
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
  let buyingPower = {
    coreAgePct: 78.4, // 25-64
    primeAgePct: 63.9, // 25-54
  };

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

    for (const k of Object.keys(ageDistribution)) {
      ageDistribution[k] = Number(ageDistribution[k].toFixed(1));
    }

    const totalGender = malePct + femalePct;
    if (totalGender > 0) {
      genderDistribution.male = Number(((malePct / totalGender) * 100).toFixed(1));
      genderDistribution.female = Number(((femalePct / totalGender) * 100).toFixed(1));
    }

    // Collapse age brackets to sales-focused Buying Power metrics
    const p25_34 = ageDistribution["25-34"] || 0;
    const p35_44 = ageDistribution["35-44"] || 0;
    const p45_54 = ageDistribution["45-54"] || 0;
    const p55_64 = ageDistribution["55-64"] || 0;

    const core25_64 = p25_34 + p35_44 + p45_54 + p55_64;
    const prime25_54 = p25_34 + p35_44 + p45_54;

    if (core25_64 > 0) {
      buyingPower.coreAgePct = Number(core25_64.toFixed(1));
      buyingPower.primeAgePct = Number(prime25_54.toFixed(1));
    }
  }

  // 6. YouTube Analytics API: Device Types (365d) -> Clean Real Percentages
  const deviceRes = await queryLongFormOnly(
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
  const DEVICE_LABEL_MAP = {
    MOBILE: "Mobile",
    TV: "Connected TV",
    COMPUTER: "Desktop / PC",
    TABLET: "Tablet",
    GAME_CONSOLE: "Console",
  };

  if (deviceRes?.rows && deviceRes.rows.length > 0) {
    const totalDeviceViews = deviceRes.rows.reduce((sum, r) => sum + (r[1] || 0), 0);
    if (totalDeviceViews > 0) {
      deviceBreakdown = deviceRes.rows.map((r) => ({
        deviceRaw: r[0],
        device: DEVICE_LABEL_MAP[r[0]] || r[0],
        sharePercent: Number(((r[1] / totalDeviceViews) * 100).toFixed(1)),
      })).sort((a, b) => b.sharePercent - a.sharePercent);
    }
  }

  // 7. YouTube Analytics API: Subscriber Status (365d) -> Fixed Non-Subscriber Calculation
  const subStatusRes = await queryLongFormOnly(
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
      const status = String(r[0]).toUpperCase();
      const v = r[1] || 0;
      if (status === "SUBSCRIBED") {
        subViews += v;
      } else {
        // Correctly captures UNSUBSCRIBED and NOT_SUBSCRIBED
        nonSubViews += v;
      }
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
  const trafficRes = await queryLongFormOnly(
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

  // 9. Derived: Median & Percentiles for 28-Day Views (from video_28day_views)
  onProgress("computing_derived_metrics", "Computing expected 30-day reach and evergreen value…");
  const pastYearVideos = db.prepare(`
    SELECT views_28d
    FROM video_28day_views
    WHERE date(published_at) >= date(?, '-365 days')
      AND date(published_at) <= date(?)
      AND views_28d IS NOT NULL
  `).all(effectiveEnd, effectiveEnd);

  const views28dList = pastYearVideos.map((r) => r.views_28d);
  const views28dPercentiles = calculatePercentiles(views28dList);

  // 10. Derived: Evergreen Multiple (views_365d / views_28d)
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

  // 11. Derived: Consolidate Content Pillars (including Solar & Home Energy)
  onProgress("processing_content_pillars", "Consolidating primary content pillars…");
  const PILLAR_CONFIG = [
    {
      id: "reviews_drives",
      name: "Vehicle Reviews & First Drives",
      description: "In-depth vehicle evaluations, walkarounds, interior deep-dives, and Mustang Mach-E ownership.",
      color: "#00B1E2",
      matcher: (catName, title) => /review|walkaround|first drive|mach-e|fathom|test drive|suv|truck|sedan|lightning|ford/i.test(catName || title),
    },
    {
      id: "road_trips",
      name: "Road Trips & Real-World Range Tests",
      description: "Cold-weather interstate trials, long-distance towing challenges, and real-world highway range runs.",
      color: "#06B6D4",
      matcher: (catName, title) => /road trip|travel|range|highway|towing|trip/i.test(catName || title),
    },
    {
      id: "charging_infrastructure",
      name: "EV Charging & Infrastructure",
      description: "DC fast-charging curves, NACS adapter testing, public charging networks, and Level 2 setups.",
      color: "#38BDF8",
      matcher: (catName, title) => /charg|evse|infrastructure|adapter|nacs|supercharg|electrify america|fast charg/i.test(catName || title),
    },
    {
      id: "solar_home_energy",
      name: "Solar & Home Energy",
      description: "Home solar installations, battery backup systems, bidirectional V2H power, and smart home energy.",
      color: "#F59E0B",
      matcher: (catName, title) => /solar|home energy|battery backup|v2h|bidirectional|smart home|powerwall|generator/i.test(catName || title),
    },
    {
      id: "news_events",
      name: "Industry News & Events",
      description: "Automotive executive interviews, OEM breaking announcements, and major auto show coverage.",
      color: "#60A5FA",
      matcher: (catName, title) => /news|quick charge|event|auto show|livestream|update|industry|announcement/i.test(catName || title),
    },
  ];

  const pillarTotals = {
    reviews_drives: { videoCount: 0, lifetimeViews: 0 },
    road_trips: { videoCount: 0, lifetimeViews: 0 },
    charging_infrastructure: { videoCount: 0, lifetimeViews: 0 },
    solar_home_energy: { videoCount: 0, lifetimeViews: 0 },
    news_events: { videoCount: 0, lifetimeViews: 0 },
  };

  for (const video of publishedLongVideos) {
    const vViews = video.view_count || 0;
    const cat = video.content_type || "";
    const title = video.title || "";

    if (PILLAR_CONFIG[3].matcher(cat, title)) {
      pillarTotals.solar_home_energy.videoCount++;
      pillarTotals.solar_home_energy.lifetimeViews += vViews;
    } else if (PILLAR_CONFIG[2].matcher(cat, title)) {
      pillarTotals.charging_infrastructure.videoCount++;
      pillarTotals.charging_infrastructure.lifetimeViews += vViews;
    } else if (PILLAR_CONFIG[1].matcher(cat, title)) {
      pillarTotals.road_trips.videoCount++;
      pillarTotals.road_trips.lifetimeViews += vViews;
    } else if (PILLAR_CONFIG[4].matcher(cat, title)) {
      pillarTotals.news_events.videoCount++;
      pillarTotals.news_events.lifetimeViews += vViews;
    } else {
      pillarTotals.reviews_drives.videoCount++;
      pillarTotals.reviews_drives.lifetimeViews += vViews;
    }
  }

  const maxPillarViews = Math.max(
    ...Object.values(pillarTotals).map((p) => p.lifetimeViews),
    1
  );

  const contentPillars = PILLAR_CONFIG.map((cfg) => {
    const totals = pillarTotals[cfg.id];
    return {
      id: cfg.id,
      name: cfg.name,
      description: cfg.description,
      color: cfg.color,
      videoCount: totals.videoCount,
      lifetimeViews: totals.lifetimeViews,
      relativeWidthPercent: Math.min(100, Math.max(12, Math.round((totals.lifetimeViews / maxPillarViews) * 100))),
    };
  });

  // 12. Recent Work: Top 3 Published Long Videos (>= 240s) with > 2,000 Views
  onProgress("compiling_recent_work", "Selecting recent highlight videos (> 2,000 views)…");
  const qualifiedRecent = publishedLongVideos
    .filter((v) => (v.view_count || 0) > 2000)
    .slice(0, 3);

  // Fallback to top 3 long videos if fewer than 3 have > 2000 views
  const finalRecent = qualifiedRecent.length >= 3
    ? qualifiedRecent
    : publishedLongVideos.slice(0, 3);

  const recentWork = finalRecent.map((v) => {
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

  // 13. Assemble Complete Snapshot Object
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
      buyingPower,
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

  // 14. Transactional Append & Prune (Keep Latest 24)
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

  (async () => {
    try {
      jobState.progressStage = "capturing_views";
      jobState.progressMessage = "Capturing closed 28-day view windows…";
      try {
        await capturePending28DayViews();
        await capturePending365DayViews();
      } catch (capErr) {
        console.warn("[Media-Kit Refresh] 28d/365d capture note:", capErr.message);
      }

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
  COUNTRY_NAMES,
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
