"use strict";

const { GoogleGenAI } = require("@google/genai");
const db = require("./db").articleDb;
const { getTranscript, getGeminiApiKey, callGeminiWithRetry, DEFAULT_GEMINI_MODEL } = require("./gemini");
const { isOAuthConnected, fetchLiveVideoAnalytics } = require("./youtube-analytics");

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

async function getVideoMetrics(youtubeId, video) {
  const category = video.content_type || null;
  const benchmark = getCategoryBenchmark(category);
  const durationSec = parseIsoDurationSec(video.duration);

  let liveAnalytics = null;
  if (isOAuthConnected()) {
    try {
      liveAnalytics = await fetchLiveVideoAnalytics(youtubeId);
    } catch (e) {
      console.warn(`Could not fetch live analytics for ${youtubeId}:`, e.message);
    }
  }

  const core = (liveAnalytics && liveAnalytics.coreData) || null;
  const isLive = !!core;

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

  // Impressions and impressions click-through rate are YouTube Studio figures
  // and are not exposed by the public YouTube Analytics API. They stay null
  // rather than being back-computed from an assumed CTR.
  const impressions = null;
  const ctr = null;
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

  return {
    isLiveStudioData: isLive,
    viewsSource,
    views,
    impressions,
    ctr,
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
    trafficShare,
    category,
    categoryBenchmark: benchmark,
    unavailableMetrics: unavailable,
  };
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

  // Mandates are only issued for analyses the data can actually support.
  const mandates = [];
  let mandateNum = 1;
  if (hasHookData) {
    mandates.push(`${mandateNum++}. Hook / Retention Diagnosis: Using the measured 30-second hook drop-off of -${metrics.hookDropPercent}%, analyse whether this was an intro issue (taking too long to deliver on the title/thumbnail promise) or a mid-video pacing bleed. Ground this in the transcript.`);
  } else {
    mandates.push(`${mandateNum++}. Hook / Retention Diagnosis: Retention data is NOT available for this video. Assess the intro from the transcript alone — how quickly it delivers on the title and thumbnail promise — and state explicitly that no retention measurement was available to confirm it.`);
  }
  if (hasDiscoveryData) {
    mandates.push(`${mandateNum++}. Discovery 2x2 Matrix: Classify into one of 4 quadrants:
   - "High Impressions / High CTR" (Star Performer)
   - "High Impressions / Low CTR" (Packaging Problem)
   - "Low Impressions / High CTR" (Distribution Bottleneck)
   - "Low Impressions / Low CTR" (Topic / Packaging Overhaul)`);
  } else {
    mandates.push(`${mandateNum++}. Discovery Matrix: SKIP THIS. Impressions and click-through rate are not available, so the quadrant cannot be determined. Return "quadrant": "Unavailable", "quadrant_number": 0, and a diagnosis field explaining that impressions and CTR are not exposed by the YouTube Analytics API and must be read from YouTube Studio.`);
  }
  mandates.push(`${mandateNum++}. Title & Thumbnail Critique: Evaluate mobile legibility, colour contrast against the YouTube UI, emotional clarity, curiosity gap without clickbait, and mobile title truncation. This is a qualitative judgement of the packaging itself and does not require performance data.`);
  mandates.push(`${mandateNum++}. Alternative Concepts: Generate 3-5 SPECIFIC alternative title and thumbnail concepts grounded directly in the vehicle, hardware, and transcript discussion above. DO NOT produce generic template placeholders (e.g. "The Truth About Ford!").`);
  mandates.push(`${mandateNum++}. Provide 3-5 Concrete, Prioritized Action Items (numbered and specific).`);
  mandates.push(`${mandateNum++}. Calculate an Overall Video Health Score from 0 to 100. Base it ONLY on evidence you actually have. If most performance metrics are unavailable, score the packaging and content craft, and say in the verdict that the score reflects packaging rather than measured performance.`);

  const prompt = `You are the principal YouTube Strategy & Editorial Director for "The Electric Duo", a two-person EV channel run by Patrick and Liv.
Perform a comprehensive Video Audit & Diagnostic Evaluation for this specific video.

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

PERFORMANCE METRICS (${metrics.isLiveStudioData ? "MEASURED VIA THE YOUTUBE ANALYTICS API" : "LIMITED — YouTube Analytics is not connected for this video"}):
${metricLines.join("\n")}
${unavailableBlock}
ABSOLUTE RULE ON DATA:
Every number you cite must appear above. Do not estimate, extrapolate, or invent any metric that is listed as unavailable. If an analysis requires a number you do not have, say plainly that the data is not available and explain what the user would need to check in YouTube Studio. A clearly stated gap is worth more than a confident guess.

CRITICAL EVALUATION MANDATES:
${mandates.join("\n")}

You MUST reply ONLY with a valid JSON object with this EXACT structure (no markdown fences, no \`\`\`json):
{
  "health_score": 84,
  "health_tier": "Strong Performer",
  "scorecard": {
    "hook_status": "pass",
    "ctr_status": "unavailable",
    "retention_status": "pass",
    "seo_status": "pass",
    "one_line_verdict": "Detailed one-line strategic verdict."
  },
  "hook_diagnosis": {
    "hook_drop_30s": ${hasHookData ? `"-${metrics.hookDropPercent}%"` : `"Unavailable"`},
    "diagnosis_type": "Intro Hook Bottleneck",
    "verdict": "One-line verdict, or a statement that retention data was unavailable.",
    "analysis": "Explanation grounded in the transcript."
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
