"use strict";

const { GoogleGenAI } = require("@google/genai");
const db = require("./db").articleDb;
const { getTranscript, getGeminiApiKey, callGeminiWithRetry, DEFAULT_GEMINI_MODEL } = require("./gemini");
const { isOAuthConnected, fetchLiveVideoAnalytics } = require("./youtube-analytics");
const {
  scoreSatisfaction,
  computeCoreAudienceIntensity,
  computeSubConversionRate,
  SCORE_VERSION,
  METHODOLOGY_NOTE: SATISFACTION_METHODOLOGY_NOTE,
} = require("./satisfaction-score");
const { getVideoReachSummary, syncReachReports } = require("./youtube-reach");

// ---------------------------------------------------------------------------
// Video metrics.
//
// Every value here is either measured or null. Nothing is derived from a hash,
// a category average, or a plausible-looking constant. A metric we cannot
// measure is reported as unavailable so the UI can label it and the AI prompt
// can omit it, rather than reasoning confidently from noise.
// ---------------------------------------------------------------------------

// Per-category benchmarks come from the content_categories row so they can never
// drift from the category name. They are null until entered from YouTube Studio.
function getCategoryBenchmark(categoryName) {
  if (!categoryName) return null;
  try {
    const row = db
      .prepare("SELECT name, avg_ctr, avg_retention, avg_view_duration, traffic_share_json, benchmarks_updated_at FROM content_categories WHERE name = ?")
      .get(categoryName);
    if (!row) return null;
    const hasAny = row.avg_ctr != null || row.avg_retention != null || row.avg_view_duration != null;
    if (!hasAny) return null;
    let trafficShare = null;
    if (row.traffic_share_json) {
      try {
        trafficShare = JSON.parse(row.traffic_share_json);
      } catch (e) {
        trafficShare = null;
      }
    }
    return {
      name: row.name,
      avgCtr: row.avg_ctr,
      avgRetention: row.avg_retention,
      avgViewDuration: row.avg_view_duration,
      trafficShare,
      updatedAt: row.benchmarks_updated_at,
    };
  } catch (e) {
    console.warn("Could not read category benchmark:", e.message);
    return null;
  }
}

// Channel CTR baseline is a value the user enters from YouTube Studio, not a constant.
function getChannelCtrBaseline() {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'channel_ctr_benchmark'").get();
    if (!row || !row.value) return null;
    const parsed = parseFloat(row.value);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function parseIsoDurationSec(durationStr) {
  if (!durationStr || typeof durationStr !== "string") return null;
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const h = parseInt(match[1] || "0", 10);
  const m = parseInt(match[2] || "0", 10);
  const s = parseInt(match[3] || "0", 10);
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

function formatSeconds(sec) {
  if (sec == null || !Number.isFinite(sec)) return null;
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

// The live retention curve is keyed on elapsedVideoTimeRatio (a percentage of the
// video), not on seconds. Reading index 2 as "30 seconds" is wrong for every
// video whose length is not ~25 minutes. Interpolate the real 30-second point.
function computeHookDropAt30s(retentionCurve, durationSec) {
  if (!Array.isArray(retentionCurve) || retentionCurve.length < 2) return null;
  if (!durationSec || durationSec <= 30) return null;

  const targetRatio = 30 / durationSec;
  const points = retentionCurve
    .filter((p) => p && Number.isFinite(p.ratio) && Number.isFinite(p.pct))
    .sort((a, b) => a.ratio - b.ratio);
  if (points.length < 2) return null;

  if (targetRatio <= points[0].ratio) return Math.max(0, Math.round(100 - points[0].pct));
  if (targetRatio >= points[points.length - 1].ratio) return null;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (targetRatio >= a.ratio && targetRatio <= b.ratio) {
      const span = b.ratio - a.ratio;
      const t = span === 0 ? 0 : (targetRatio - a.ratio) / span;
      const pct = a.pct + (b.pct - a.pct) * t;
      return Math.max(0, Math.round(100 - pct));
    }
  }
  return null;
}

// Finds the steepest decline anywhere in the retention curve past the first
// minute, using a rolling window (default 5% of the video) rather than
// point-to-point deltas so single-sample noise does not register as a
// "cliff." Deliberately excludes the opening minute, which the 30-second hook
// figure above already covers -- this is about problems later in the video.
// Returns null only when the curve itself is unusable; { detected: false }
// means the curve is fine and no notable drop was found.
function findSteepestRetentionDrop(retentionCurve, durationSec, opts = {}) {
  const { excludeFirstSec = 60, windowPct = 5, minDropPoints = 5 } = opts;
  if (!Array.isArray(retentionCurve) || retentionCurve.length < 2 || !durationSec) return null;

  const minRatio = Math.min(0.9, excludeFirstSec / durationSec);
  const points = retentionCurve
    .filter((p) => p && Number.isFinite(p.ratio) && Number.isFinite(p.pct) && p.ratio >= minRatio)
    .sort((a, b) => a.ratio - b.ratio);
  if (points.length < 2) return { detected: false };

  let best = null;
  for (let i = 0; i < points.length; i++) {
    const start = points[i];
    const targetRatio = start.ratio + windowPct / 100;
    let end = null;
    for (let j = i + 1; j < points.length; j++) {
      if (points[j].ratio >= targetRatio) {
        end = points[j];
        break;
      }
    }
    if (!end) end = points[points.length - 1];
    if (end === start) continue;

    const drop = start.pct - end.pct;
    if (!best || drop > best.drop) best = { drop, start, end };
  }

  if (!best || best.drop < minDropPoints) return { detected: false };

  const startSec = Math.round(best.start.ratio * durationSec);
  const endSec = Math.round(best.end.ratio * durationSec);
  return {
    detected: true,
    dropPoints: Math.round(best.drop),
    startSec,
    endSec,
    startFormatted: formatSeconds(startSec),
    endFormatted: formatSeconds(endSec),
    videoPercentStart: Math.round(best.start.ratio * 100),
    videoPercentEnd: Math.round(best.end.ratio * 100),
  };
}

// Reads the timestamped transcript (SRT) for a video directly from the cache,
// separate from getTranscript() in server/gemini.js, which returns
// timestamp-free plain text and is not usable for aligning a moment in the
// video to what was actually said at that moment.
function getTranscriptWithTimestamps(youtubeId) {
  try {
    const row = db.prepare("SELECT cleaned_srt, raw_srt FROM transcripts WHERE video_id = ?").get(youtubeId);
    if (row?.cleaned_srt && row.cleaned_srt.trim().length > 20) return row.cleaned_srt;
    if (row?.raw_srt && row.raw_srt.trim().length > 20) return row.raw_srt;
  } catch (e) {
    console.warn(`Could not read timestamped transcript for ${youtubeId}:`, e.message);
  }
  return null;
}

const SRT_CUE_TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function parseSrtCues(srtText) {
  if (!srtText) return [];
  const toSec = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  const cues = [];
  for (const block of srtText.split(/\r?\n\r?\n+/)) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const timeLineIdx = lines.findIndex((l) => SRT_CUE_TIME.test(l));
    if (timeLineIdx === -1) continue;
    const m = lines[timeLineIdx].match(SRT_CUE_TIME);
    const text = lines.slice(timeLineIdx + 1).join(" ").trim();
    if (!text) continue;
    cues.push({ startSec: toSec(m[1], m[2], m[3], m[4]), endSec: toSec(m[5], m[6], m[7], m[8]), text });
  }
  return cues;
}

// Extracts the spoken transcript covering a specific time window (plus a
// small pad on each side for context), so a measured retention drop can be
// paired with what was actually being said at that moment.
function getTranscriptSegment(srtText, startSec, endSec, padSec = 12) {
  const cues = parseSrtCues(srtText);
  if (cues.length === 0) return null;
  const rangeStart = Math.max(0, startSec - padSec);
  const rangeEnd = endSec + padSec;
  const inRange = cues.filter((c) => c.endSec >= rangeStart && c.startSec <= rangeEnd);
  if (inRange.length === 0) return null;
  return inRange.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim().slice(0, 1200);
}

async function getVideoMetrics(youtubeId, video) {
  const category = video.content_type || null;
  const benchmark = getCategoryBenchmark(category);
  const durationSec = parseIsoDurationSec(video.duration);

  const oauthConnected = isOAuthConnected();
  let liveAnalytics = null;
  if (oauthConnected) {
    try {
      liveAnalytics = await fetchLiveVideoAnalytics(youtubeId);
    } catch (e) {
      console.warn(`Could not fetch live analytics for ${youtubeId}:`, e.message);
    }
  }

  const core = (liveAnalytics && liveAnalytics.coreData) || null;
  // A video is only considered live-measured if core metrics show actual recorded activity
  const isLive = !!(core && (core.views > 0 || core.watchMinutes > 0));

  // Views: live figure preferred, catalog figure as a real (if stale) fallback.
  let views = null;
  let viewsSource = "unavailable";
  if (core && core.views > 0) {
    views = core.views;
    viewsSource = "youtube_analytics";
  } else if (video.view_count && video.view_count > 0) {
    views = video.view_count;
    viewsSource = "catalog_snapshot";
  }

  const retentionRate = core && core.retentionRate > 0 ? core.retentionRate : null;
  const avgViewDurationSec = core && core.avgViewDurationSec > 0 ? core.avgViewDurationSec : null;
  const totalWatchTimeHours = core && core.watchMinutes > 0 ? Math.round(core.watchMinutes / 60) : null;

  const likes = core && core.likes > 0 ? core.likes : null;
  const comments = core && core.comments > 0 ? core.comments : null;
  const shares = core && core.shares > 0 ? core.shares : null;
  const subsGained = core && core.subsGained > 0 ? core.subsGained : null;
  const subsLost = core && Number.isFinite(core.subsLost) ? core.subsLost : null;
  const netSubs = subsGained != null && subsLost != null ? subsGained - subsLost : null;

  const retentionCurve = (liveAnalytics && liveAnalytics.retentionCurve && liveAnalytics.retentionCurve.length > 0)
    ? liveAnalytics.retentionCurve
    : null;
  const hookDropPercent = computeHookDropAt30s(retentionCurve, durationSec);
  const trafficShare = (liveAnalytics && liveAnalytics.trafficShare) || null;

  // Mid-video retention cliff: the steepest drop anywhere after the first
  // minute, paired with the transcript actually spoken at that moment. A
  // single video needs no Shorts/Live exclusion (it IS one video), so this
  // reuses the shared formula directly on this video's own measured numbers.
  const retentionCliffRaw = findSteepestRetentionDrop(retentionCurve, durationSec);
  let retentionCliff = retentionCliffRaw;
  if (retentionCliffRaw && retentionCliffRaw.detected) {
    const srtText = getTranscriptWithTimestamps(youtubeId);
    const transcriptSegment = srtText
      ? getTranscriptSegment(srtText, retentionCliffRaw.startSec, retentionCliffRaw.endSec)
      : null;
    retentionCliff = { ...retentionCliffRaw, transcriptSegment };
  }

  // Viewer Satisfaction Score (v2): duration-adjusted retention + net sub conversion
  // (server/satisfaction-score.js), applied to this video's own measured numbers.
  // Uses core.* directly rather than the display-oriented variables above, which
  // coerce a real zero into null for display purposes.
  const rawSubsGained = core && Number.isFinite(core.subsGained) ? core.subsGained : null;
  const rawSubsLost = core && Number.isFinite(core.subsLost) ? core.subsLost : null;
  const rawNetSubs = rawSubsGained != null && rawSubsLost != null ? rawSubsGained - rawSubsLost : null;
  const coreAudienceIntensity = core
    ? computeCoreAudienceIntensity({ likes: core.likes, comments: core.comments, shares: core.shares, views: core.views })
    : null;
  const subConversionRate = core ? computeSubConversionRate({ netSubs: rawNetSubs, views: core.views }) : null;

  const scoreResult = scoreSatisfaction({
    retentionPct: retentionRate,
    durationSec,
    subConversionRate,
    views: core?.views ?? views,
    basis: "lifetime",
  });

  const satisfactionScore = scoreResult
    ? {
        score: scoreResult.score,
        scoreVersion: scoreResult.scoreVersion,
        available: true,
        partial: scoreResult.partial,
        confidence: scoreResult.confidence,
        components: scoreResult.components,
        methodology: SATISFACTION_METHODOLOGY_NOTE,
      }
    : {
        score: null,
        scoreVersion: SCORE_VERSION,
        available: false,
        components: null,
        methodology: SATISFACTION_METHODOLOGY_NOTE,
      };

  // Impressions and impressions click-through rate from the YouTube Reporting API (channel_reach_basic_a1).
  // These are authentic daily reach numbers compiled by Google.
  const videoReach = getVideoReachSummary(youtubeId);
  const impressions = videoReach ? videoReach.impressions : null;
  const ctr = videoReach ? videoReach.ctr : null;
  const channelBaselineCtr = getChannelCtrBaseline();

  const unavailable = [];
  if (views == null) unavailable.push("views");
  if (impressions == null) unavailable.push("impressions");
  if (ctr == null) unavailable.push("click-through rate");
  if (retentionRate == null) unavailable.push("retention rate");
  if (avgViewDurationSec == null) unavailable.push("average view duration");
  if (totalWatchTimeHours == null) unavailable.push("watch time");
  if (hookDropPercent == null) unavailable.push("30-second hook drop");
  if (!retentionCurve) unavailable.push("retention curve");
  if (!trafficShare) unavailable.push("traffic sources");
  if (netSubs == null) unavailable.push("net subscribers");
  if (!satisfactionScore.available || (views != null && views < 250)) unavailable.push("viewer satisfaction score");

  return {
    isOAuthConnected: oauthConnected,
    isLiveStudioData: isLive,
    viewsSource,
    views,
    impressions,
    ctr,
    reachSource: videoReach ? "youtube_reporting_api" : null,
    reachDays: videoReach?.activeDays || 0,
    channelBaselineCtr,
    ctrDelta: ctr != null && channelBaselineCtr != null ? Number((ctr - channelBaselineCtr).toFixed(1)) : null,
    durationSec,
    durationFormatted: formatSeconds(durationSec),
    retentionRate,
    avgViewDurationSec,
    avdFormatted: formatSeconds(avgViewDurationSec),
    totalWatchTimeHours,
    subsGained,
    subsLost,
    netSubs,
    likes,
    comments,
    shares,
    retentionCurve,
    retentionCurveAxis: retentionCurve ? "percent_of_video" : null,
    hookDropPercent,
    retentionCliff,
    satisfactionScore,
    coreAudienceIntensity,
    trafficShare,
    category,
    categoryBenchmark: benchmark,
    unavailableMetrics: unavailable,
  };
}


function getAuditInstructions() {
  try {
    const row = db.prepare("SELECT audit_instructions FROM title_prompt_settings WHERE id = 1").get();
    if (row && row.audit_instructions && row.audit_instructions.trim()) {
      return row.audit_instructions.trim();
    }
  } catch (e) {
    console.warn("Could not read audit instructions:", e.message);
  }
  const dbModule = require("./db");
  return dbModule.DEFAULT_AUDIT_PROMPT_INSTRUCTIONS || "";
}

// Generate Multimodal AI Evaluation via Gemini
async function generateAIEvaluation(video, metrics) {
  let transcriptSnippet = "Not available.";
  try {
    const fullTranscript = await getTranscript(video.youtube_id, video.title);
    if (fullTranscript) {
      transcriptSnippet = fullTranscript.substring(0, 3500);
    }
  } catch (e) {
    console.warn(`Could not load transcript for audit of ${video.youtube_id}:`, e.message);
  }

  // Build the metrics block from measured values only. A metric we do not have is
  // stated as unavailable so the model says so instead of inventing a diagnosis.
  const metricLines = [];
  if (metrics.views != null) {
    const sourceNote = metrics.viewsSource === "catalog_snapshot" ? " (from catalog sync, not Studio)" : "";
    metricLines.push(`- Total Views: ${metrics.views.toLocaleString()}${sourceNote}`);
  }
  if (metrics.impressions != null) {
    metricLines.push(`- Impressions: ${metrics.impressions.toLocaleString()} (measured via YouTube Reporting API${metrics.reachDays ? `, ${metrics.reachDays} days recorded` : ""})`);
  }
  if (metrics.ctr != null) {
    const deltaNote = metrics.ctrDelta != null
      ? ` (${metrics.ctrDelta >= 0 ? "+" : ""}${metrics.ctrDelta}% vs channel baseline ${metrics.channelBaselineCtr}%)`
      : "";
    metricLines.push(`- Impressions Click-Through Rate (CTR): ${metrics.ctr}%${deltaNote} (measured via YouTube Reporting API)`);
  }
  if (metrics.totalWatchTimeHours != null) metricLines.push(`- Total Watch Time: ${metrics.totalWatchTimeHours} hours`);
  if (metrics.avdFormatted && metrics.retentionRate != null) {
    metricLines.push(`- Average View Duration: ${metrics.avdFormatted} (${metrics.retentionRate}% average percentage viewed)`);
  } else if (metrics.avdFormatted) {
    metricLines.push(`- Average View Duration: ${metrics.avdFormatted}`);
  }
  if (metrics.hookDropPercent != null) {
    metricLines.push(`- 30-Second Hook Drop-Off: -${metrics.hookDropPercent}% of viewers left in the first 30 seconds (interpolated from the measured retention curve)`);
  }
  if (metrics.netSubs != null) metricLines.push(`- Net Subscribers: ${metrics.netSubs >= 0 ? "+" : ""}${metrics.netSubs}`);
  if (metrics.likes != null || metrics.comments != null) {
    const parts = [];
    if (metrics.likes != null) parts.push(`Likes: ${metrics.likes.toLocaleString()}`);
    if (metrics.comments != null) parts.push(`Comments: ${metrics.comments.toLocaleString()}`);
    metricLines.push(`- ${parts.join(", ")}`);
  }
  if (metrics.trafficShare) {
    metricLines.push(`- Traffic Sources: Browse ${metrics.trafficShare.browse}%, Suggested ${metrics.trafficShare.suggested}%, Search ${metrics.trafficShare.search}%, Other ${metrics.trafficShare.other}%`);
  }
  if (metrics.satisfactionScore?.available) {
    const confNote = metrics.satisfactionScore.confidence === "low" ? " (low confidence — under 1,000 views)" : "";
    metricLines.push(`- Viewer Satisfaction Score (measured proxy, not an official YouTube metric): ${metrics.satisfactionScore.score}/100${confNote}`);
  }
  if (metrics.retentionCliff?.detected) {
    const c = metrics.retentionCliff;
    metricLines.push(`- Mid-Video Retention Cliff: -${c.dropPoints} points between ${c.startFormatted} and ${c.endFormatted} (${c.videoPercentStart}%-${c.videoPercentEnd}% through the video), separate from the 30-second hook drop above`);
  }
  if (metrics.categoryBenchmark) {
    const b = metrics.categoryBenchmark;
    const bParts = [];
    if (b.avgCtr != null) bParts.push(`avg CTR ${b.avgCtr}%`);
    if (b.avgRetention != null) bParts.push(`avg retention ${b.avgRetention}%`);
    if (b.avgViewDuration) bParts.push(`avg view duration ${b.avgViewDuration}`);
    if (bParts.length > 0) {
      metricLines.push(`- Category Benchmark for "${b.name}" (entered from YouTube Studio): ${bParts.join(", ")}`);
    }
  }
  if (metricLines.length === 0) {
    metricLines.push("- No performance metrics are available for this video.");
  }

  const unavailableBlock = metrics.unavailableMetrics && metrics.unavailableMetrics.length > 0
    ? `\nMETRICS THAT ARE NOT AVAILABLE FOR THIS VIDEO — you do NOT have these numbers and must not estimate, infer, or invent them:\n${metrics.unavailableMetrics.map((m) => `- ${m}`).join("\n")}\n`
    : "";

  const hasDiscoveryData = metrics.impressions != null && metrics.ctr != null;
  const hasHookData = metrics.hookDropPercent != null;

  // Context-aware data availability safeguards
  const dataSafeguards = [];
  if (hasHookData) {
    dataSafeguards.push(`- Measured 30-second hook drop-off: -${metrics.hookDropPercent}%. Ground hook analysis in this number and transcript.`);
  } else {
    dataSafeguards.push(`- Retention data is NOT available for this video. Assess the intro from the transcript alone and state explicitly that no retention measurement was available to confirm it.`);
  }
  if (hasDiscoveryData) {
    dataSafeguards.push(`- Measured impressions (${metrics.impressions.toLocaleString()}) and CTR (${metrics.ctr}%) are available from the YouTube Reporting API. Classify into the Discovery 2x2 Matrix quadrant (High/Low Impressions vs High/Low CTR) relative to channel baseline CTR (${metrics.channelBaselineCtr}%).`);
  } else {
    dataSafeguards.push(`- Impressions and CTR are NOT available in the YouTube Reporting API for this video yet. SKIP the Discovery Matrix (return "quadrant": "Unavailable", "quadrant_number": 0, and explain that reach data has not yet compiled in the YouTube Reporting API).`);
  }
  if (metrics.retentionCliff?.detected) {
    const c = metrics.retentionCliff;
    const transcriptNote = c.transcriptSegment
      ? `The transcript at this exact moment says: "${c.transcriptSegment}"`
      : "No transcript could be aligned to this timestamp -- diagnose from the curve position and surrounding context alone, and say so.";
    dataSafeguards.push(`- Measured a ${c.dropPoints}-point retention drop between ${c.startFormatted} and ${c.endFormatted} (${c.videoPercentStart}%-${c.videoPercentEnd}% through the video). This is separate from the 30-second hook and must be diagnosed on its own in retention_cliff. ${transcriptNote}`);
  } else if (metrics.retentionCurve) {
    dataSafeguards.push(`- The retention curve was measured and no significant drop (5+ points within a 5% span) was found after the first minute. Report retention_cliff.detected as false rather than inventing one.`);
  } else {
    dataSafeguards.push(`- The retention curve is NOT available, so no mid-video retention cliff could be measured. Report retention_cliff.detected as false and say the curve was unavailable.`);
  }

  if (metrics.retentionRate != null) {
    const expRetention = metrics.categoryBenchmark?.avgRetention ?? metrics.satisfactionScore?.components?.retention?.expected;
    const expNote = expRetention != null ? ` (expected duration baseline: ${expRetention}%)` : "";
    dataSafeguards.push(`- Measured retention rate: ${metrics.retentionRate}%${expNote}. If retention is significantly below expected, mark scorecard.retention_status as "warn".`);
  }
  if (metrics.satisfactionScore?.available) {
    dataSafeguards.push(`- Viewer Satisfaction Score proxy: ${metrics.satisfactionScore.score}/100. This is an objective proxy based 70% on duration-adjusted retention and 30% on sub conversion.`);
  }

  if (!metrics.isLiveStudioData && metrics.isOAuthConnected) {
    dataSafeguards.push(`- NOTE ON INTEGRATION: The channel's YouTube Analytics API IS connected and active. However, this video was uploaded recently and YouTube Analytics typically requires 48-72 hours to aggregate video-level watch time, retention, and traffic metrics. DO NOT tell the user to connect their YouTube account or visit Admin Settings. Instead, explain that YouTube's reporting pipeline is still aggregating data for this recent upload.`);
  }

  const editorialInstructions = getAuditInstructions();

  let metricsHeaderStatus = "MEASURED VIA THE YOUTUBE ANALYTICS API";
  if (!metrics.isLiveStudioData) {
    if (metrics.isOAuthConnected) {
      metricsHeaderStatus = "LIMITED — YouTube Analytics is connected, but video-level metrics are still aggregating in YouTube's 48-72h pipeline. Real-time views are synced from the catalog.";
    } else {
      metricsHeaderStatus = "LIMITED — YouTube Analytics is not connected for this video";
    }
  }

  const prompt = `${editorialInstructions}

TARGET VIDEO DETAILS:
- Title: "${video.title}"
- YouTube ID: ${video.youtube_id}
- Thumbnail URL: ${video.thumbnail_url || `https://img.youtube.com/vi/${video.youtube_id}/maxresdefault.jpg`}
- Content Category: ${metrics.category || "Unclassified"}
- Duration: ${metrics.durationFormatted || "Unknown"}
- Published Date: ${video.published_at}
- Description: ${video.description && !video.description_is_placeholder ? video.description.substring(0, 600) : "None provided"}

ACTUAL VIDEO DISCUSSION & TRANSCRIPT CONTEXT:
${transcriptSnippet}

PERFORMANCE METRICS (${metricsHeaderStatus}):
${metricLines.join("\n")}
${unavailableBlock}
DATA AVAILABILITY SAFEGUARDS:
${dataSafeguards.join("\n")}

ABSOLUTE RULE ON DATA:
Every number you cite must appear above. Do not estimate, extrapolate, or invent any metric that is listed as unavailable. If an analysis requires a number you do not have, say plainly that the data is not available and explain what the user would need to check in YouTube Studio. A clearly stated gap is worth more than a confident guess.

You MUST reply ONLY with a valid JSON object with this EXACT structure (no markdown fences, no \`\`\`json):
{
  "health_score": 84,
  "health_tier": "Strong Performer",
  "scorecard": {
    "hook_status": ${JSON.stringify(hasHookData ? (metrics.hookDropPercent <= 30 ? "pass" : "warn") : "unavailable")},
    "ctr_status": ${JSON.stringify(hasDiscoveryData ? (metrics.ctr >= (metrics.channelBaselineCtr ?? 5.0) ? "pass" : "warn") : "unavailable")},
    "retention_status": ${JSON.stringify(metrics.retentionRate != null ? (metrics.retentionRate >= (metrics.categoryBenchmark?.avgRetention ?? metrics.satisfactionScore?.components?.retention?.expected ?? 30.0) ? "pass" : "warn") : "unavailable")},
    "seo_status": "pass",
    "one_line_verdict": "Detailed one-line strategic verdict."
  },
  "hook_diagnosis": {
    "hook_drop_30s": ${hasHookData ? `"-${metrics.hookDropPercent}%"` : `"Unavailable"`},
    "diagnosis_type": "Intro Hook Bottleneck",
    "verdict": "One-line verdict, or a statement that retention data was unavailable.",
    "analysis": "Explanation grounded in the transcript."
  },
  "retention_cliff": {
    "detected": ${metrics.retentionCliff?.detected ? "true" : "false"},
    "timestamp_range": ${metrics.retentionCliff?.detected ? `"${metrics.retentionCliff.startFormatted}–${metrics.retentionCliff.endFormatted}"` : `"Unavailable"`},
    "drop_points": ${metrics.retentionCliff?.detected ? metrics.retentionCliff.dropPoints : "null"},
    "diagnosis": "If detected, explain what the transcript segment shows was happening at this exact moment and why viewers likely left. If not detected, say plainly that no significant mid-video drop was measured (or that the curve was unavailable) rather than inventing one.",
    "fix": "Specific, concrete edit to make (e.g. cut this segment, move it earlier, re-pace it), or 'No action needed' if none was detected."
  },
  "discovery_matrix": {
    "quadrant": ${hasDiscoveryData ? `"High Impressions / Low CTR"` : `"Unavailable"`},
    "quadrant_number": ${hasDiscoveryData ? 2 : 0},
    "bottleneck": "Packaging (Title/Thumb)",
    "diagnosis": "Diagnosis, or an explanation that impressions and CTR are not available.",
    "strategy": "Recommended strategy, or what to check in YouTube Studio."
  },
  "title_thumb_critique": {
    "thumbnail_critique": {
      "mobile_legibility": "Analysis of text size and clarity on mobile.",
      "contrast_score": "7/10",
      "visual_promise": "Analysis of visual subject and framing.",
      "focal_weakness": "Specific area of improvement."
    },
    "title_critique": {
      "value_prop": "Analysis of value proposition.",
      "mobile_truncation": "Analysis of title length.",
      "curiosity_gap": "Curiosity and engagement analysis."
    },
    "alternative_concepts": [
      {
        "title": "Specific Alternative Title 1 grounded in video context",
        "thumbnail_visual": "Visual concept description",
        "thumbnail_text": "BOLD 3-WORD TEXT",
        "rationale": "Why this packaging is stronger"
      },
      {
        "title": "Specific Alternative Title 2 grounded in video context",
        "thumbnail_visual": "Visual concept description",
        "thumbnail_text": "BOLD TEXT 2",
        "rationale": "Why this packaging is stronger"
      },
      {
        "title": "Specific Alternative Title 3 grounded in video context",
        "thumbnail_visual": "Visual concept description",
        "thumbnail_text": "BOLD TEXT 3",
        "rationale": "Why this packaging is stronger"
      }
    ]
  },
  "monetization_insights": {
    "ad_read_retention": "Retention assessment, or a statement that retention data was unavailable.",
    "sponsor_appeal": "Relevance for EV sponsors, based on the content itself."
  },
  "search_seo_analysis": {
    "top_captured_terms": ["term the title and description actually target"],
    "missed_opportunities": ["missed term 1", "missed term 2"],
    "actionable_seo_tip": "Specific keyword optimization recommendation."
  },
  "data_confidence": {
    "measured": ["list the metrics you were actually given"],
    "unavailable": ["list the metrics that were not available"],
    "note": "One sentence on how the missing data limits this audit."
  },
  "action_items": [
    {
      "priority": 1,
      "category": "Thumbnail",
      "action": "Specific action item.",
      "impact": "High"
    },
    {
      "priority": 2,
      "category": "Title",
      "action": "Specific action item.",
      "impact": "High"
    },
    {
      "priority": 3,
      "category": "Description & SEO",
      "action": "Specific action item.",
      "impact": "Medium"
    }
  ]
}`;


  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API Key is not configured. Please set GEMINI_API_KEY in Admin Settings.");
  }

  const ai = new GoogleGenAI({ apiKey });

  let configuredModel = DEFAULT_GEMINI_MODEL;
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'default_model'").get();
    if (row && row.value) configuredModel = row.value;
  } catch (e) {
    console.warn("Could not read default_model for audit:", e.message);
  }

  if (configuredModel.includes("2.5") || configuredModel.includes("2.0") || configuredModel.includes("1.5") || configuredModel.includes("3.5-pro") || configuredModel === "gemini-flash-latest") {
    configuredModel = DEFAULT_GEMINI_MODEL;
  }

  const response = await callGeminiWithRetry(
    ai,
    {
      model: configuredModel,
      contents: prompt,
    },
    2
  );

  let rawText = response.text || "";
  rawText = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

  let evaluation = null;
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    evaluation = JSON.parse(jsonMatch[0]);
  } else {
    evaluation = JSON.parse(rawText);
  }

  if (evaluation) {
    if (!evaluation.scorecard) evaluation.scorecard = {};
    // Ground scorecard statuses in authentic measured benchmarks rather than model hallucination
    if (metrics.hookDropPercent != null) {
      evaluation.scorecard.hook_status = metrics.hookDropPercent <= 30 ? "pass" : "warn";
    }
    if (metrics.ctr != null) {
      evaluation.scorecard.ctr_status = metrics.ctr >= (metrics.channelBaselineCtr ?? 5.0) ? "pass" : "warn";
    }
    if (metrics.retentionRate != null) {
      const bench = metrics.categoryBenchmark?.avgRetention ?? metrics.satisfactionScore?.components?.retention?.expected;
      evaluation.scorecard.retention_status = bench != null
        ? (metrics.retentionRate >= bench ? "pass" : "warn")
        : (metrics.retentionRate >= 30.0 ? "pass" : "warn");
    }
    if (!evaluation.scorecard.seo_status) {
      evaluation.scorecard.seo_status = "pass";
    }

    // Record what the model was actually given, so the UI can show provenance
    // even if the model omits its own data_confidence block.
    if (!evaluation.data_confidence) {
      evaluation.data_confidence = {
        measured: [],
        unavailable: metrics.unavailableMetrics || [],
        note: "Provenance recorded by the server.",
      };
    }
  }

  if (!evaluation || !evaluation.health_score) {
    throw new Error("Gemini AI audit generation failed to produce a valid evaluation object.");
  }

  return evaluation;
}

// Main function: Get existing audit or generate fresh audit report
async function getOrRunAudit(youtubeId, forceRefresh = false) {
  if (!forceRefresh) {
    const existing = db.prepare("SELECT * FROM video_audits WHERE youtube_id = ?").get(youtubeId);
    if (existing) {
      return {
        youtubeId,
        metrics: JSON.parse(existing.metrics_json),
        evaluation: JSON.parse(existing.evaluation_json),
        healthScore: existing.health_score,
        generatedAt: existing.generated_at,
        updatedAt: existing.updated_at,
        isCached: true,
      };
    }
  } else if (isOAuthConnected()) {
    try {
      await syncReachReports();
    } catch (reachErr) {
      console.warn("Reach report sync skipped during audit refresh:", reachErr.message);
    }
  }

  const video = db.prepare("SELECT * FROM videos WHERE youtube_id = ?").get(youtubeId);
  if (!video) {
    throw new Error(`Video not found in local catalog with ID: ${youtubeId}`);
  }

  // 1. Collect measured metrics (live YouTube Analytics where available; nulls otherwise)
  const metrics = await getVideoMetrics(youtubeId, video);

  // 2. Generate AI Evaluation
  const evaluation = await generateAIEvaluation(video, metrics);
  const healthScore = evaluation.health_score || 75;

  // 3. Save to SQLite
  const stmt = db.prepare(`
    INSERT INTO video_audits (youtube_id, metrics_json, evaluation_json, health_score, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(youtube_id) DO UPDATE SET
      metrics_json = excluded.metrics_json,
      evaluation_json = excluded.evaluation_json,
      health_score = excluded.health_score,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run(youtubeId, JSON.stringify(metrics), JSON.stringify(evaluation), healthScore);

  return {
    youtubeId,
    metrics,
    evaluation,
    healthScore,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isCached: false,
  };
}

function getAuditsSummary() {
  const rows = db.prepare(`
    SELECT va.youtube_id, va.health_score, va.updated_at
    FROM video_audits va
    JOIN videos v ON va.youtube_id = v.youtube_id
    WHERE (v.privacy_status IS NULL OR v.privacy_status = 'public')
  `).all();
  const map = {};
  rows.forEach((r) => {
    map[r.youtube_id] = { healthScore: r.health_score, updatedAt: r.updated_at };
  });
  return map;
}

module.exports = {
  getOrRunAudit,
  getAuditsSummary,
};
