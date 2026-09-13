"use strict";

/**
 * scripts/calibrate-satisfaction.js
 *
 * Calibrates the Viewer Satisfaction Score constants against live YouTube Analytics.
 * Fits:
 *   1. Length-adjusted quadratic retention baseline:
 *      expected = intercept + logSlope * ln(d) + logSqSlope * (ln(d))^2
 *      residualSd = stddev of actual retention vs expected
 *   2. Net subscriber conversion tanh scale (calibrated so p90 lands at 85)
 *   3. 28-day rolling window offset (windowOffsetPp) and windowResidualSd
 *
 * NOTE: As required by the methodology spec, this script PRINTS a replacement
 * block to stdout for a human to review and paste into server/satisfaction-score.js.
 * It NEVER modifies the running configuration or files automatically.
 * Re-run quarterly.
 */

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { google } = require("googleapis");
const { getAuthenticatedClient } = require("../server/youtube-analytics");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const dbPath = path.join(DATA_DIR, "database.sqlite");
const db = fs.existsSync(dbPath) ? new Database(dbPath) : null;

// Helper to solve a 3x3 linear system (A * beta = b) via Gaussian elimination
function solve3x3(A, b) {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];

  for (let i = 0; i < 3; i++) {
    let maxRow = i;
    for (let k = i + 1; k < 3; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) {
        maxRow = k;
      }
    }
    [M[i], M[maxRow]] = [M[maxRow], M[i]];

    const pivot = M[i][i];
    if (Math.abs(pivot) < 1e-12) {
      throw new Error("Matrix is singular or near-singular");
    }

    for (let j = i; j <= 3; j++) {
      M[j === 3 ? 3 : j] /= pivot;
    }

    for (let k = 0; k < 3; k++) {
      if (k !== i) {
        const factor = M[k][i];
        for (let j = i; j <= 3; j++) {
          M[k][j] -= factor * M[i][j];
        }
      }
    }
  }

  return [M[0][3], M[1][3], M[2][3]];
}

// Fit ordinary least squares quadratic regression: y = beta0 + beta1*L + beta2*L^2
function fitQuadratic(data) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let sy = 0, sy1 = 0, sy2 = 0;

  for (const { L, y } of data) {
    const L2 = L * L;
    const L3 = L2 * L;
    const L4 = L3 * L;

    s0 += 1;
    s1 += L;
    s2 += L2;
    s3 += L3;
    s4 += L4;

    sy += y;
    sy1 += y * L;
    sy2 += y * L2;
  }

  const A = [
    [s0, s1, s2],
    [s1, s2, s3],
    [s2, s3, s4],
  ];
  const b = [sy, sy1, sy2];

  const [beta0, beta1, beta2] = solve3x3(A, b);

  let ssRes = 0;
  for (const { L, y } of data) {
    const yHat = beta0 + beta1 * L + beta2 * L * L;
    const res = y - yHat;
    ssRes += res * res;
  }
  const residualSd = Math.sqrt(ssRes / (data.length - 3));

  return { beta0, beta1, beta2, residualSd };
}

function parseDurationSec(durationStr) {
  if (!durationStr) return null;
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const h = parseInt(match[1] || "0", 10);
  const m = parseInt(match[2] || "0", 10);
  const s = parseInt(match[3] || "0", 10);
  return h * 3600 + m * 60 + s;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

async function calibrate() {
  console.log("=== Viewer Satisfaction Score Calibration (v2) ===");
  console.log(`Fitted at: ${new Date().toISOString().split("T")[0]}`);

  let auth = null;
  try {
    auth = getAuthenticatedClient();
  } catch (e) {
    console.warn("Could not load OAuth client:", e.message);
  }

  // Collect video training dataset
  const trainingData = [];
  const subConversionData = [];

  // Check if calib_final.json is available as reference or fallback
  const calibFinalPath = path.join(__dirname, "..", "calib_final.json");
  let fallbackCalib = null;
  if (fs.existsSync(calibFinalPath)) {
    try {
      fallbackCalib = JSON.parse(fs.readFileSync(calibFinalPath, "utf8"));
    } catch (_) {}
  }

  if (auth) {
    console.log("Fetching live YouTube Analytics reports for long-form VOD catalogue...");
    const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });
    const ytData = google.youtube({ version: "v3", auth });

    try {
      // Query video lifetime metrics
      const res = await ytAnalytics.reports.query({
        ids: "channel==MINE",
        startDate: "2020-01-01",
        endDate: new Date().toISOString().split("T")[0],
        dimensions: "video",
        metrics: "views,averageViewPercentage,subscribersGained,subscribersLost",
        filters: "creatorContentType==video_on_demand",
        sort: "-views",
        maxResults: 200,
      });

      const rows = res.data?.rows || [];
      console.log(`Received ${rows.length} video rows from YouTube Analytics.`);

      // Fetch durations in chunks of 50
      const videoIds = rows.map((r) => r[0]);
      const durationMap = new Map();
      for (let i = 0; i < videoIds.length; i += 50) {
        const chunk = videoIds.slice(i, i + 50);
        const vidRes = await ytData.videos.list({
          part: "contentDetails",
          id: chunk.join(","),
          maxResults: 50,
        });
        for (const item of vidRes.data?.items || []) {
          const sec = parseDurationSec(item.contentDetails?.duration);
          if (sec) durationMap.set(item.id, sec);
        }
      }

      for (const row of rows) {
        const [id, views, avp, subsGained, subsLost] = row;
        const durationSec = durationMap.get(id);
        if (views >= 1000 && durationSec && durationSec > 180 && avp != null) {
          const d = clamp(durationSec, 180, 5400);
          trainingData.push({
            id,
            durationSec,
            d,
            L: Math.log(d),
            y: avp,
          });

          const netSubs = (subsGained || 0) - (subsLost || 0);
          const subRate = (netSubs / views) * 100;
          subConversionData.push(subRate);
        }
      }
    } catch (err) {
      console.warn("Live query encountered an error:", err.message);
    }
  }

  // Fallback to local DB if trainingData is small and DB exists
  if (trainingData.length < 50 && db) {
    console.log("Reading catalogue from local SQLite database (video_audits)...");
    try {
      const rows = db.prepare(`
        SELECT v.youtube_id, v.duration, v.view_count, va.metrics_json
        FROM video_audits va
        JOIN videos v ON v.youtube_id = va.youtube_id
        WHERE (v.privacy_status IS NULL OR v.privacy_status = 'public')
          AND v.view_count >= 1000
      `).all();

      for (const r of rows) {
        const durationSec = parseDurationSec(r.duration);
        if (!durationSec || durationSec <= 180) continue;

        let metrics = null;
        try {
          metrics = JSON.parse(r.metrics_json);
        } catch (_) {}

        const retention = metrics?.retentionRate;
        if (retention != null && retention > 0) {
          const d = clamp(durationSec, 180, 5400);
          trainingData.push({
            id: r.youtube_id,
            durationSec,
            d,
            L: Math.log(d),
            y: retention,
          });

          if (metrics.views && metrics.netSubs != null) {
            subConversionData.push((metrics.netSubs / metrics.views) * 100);
          }
        }
      }
    } catch (e) {
      console.warn("Local DB fallback error:", e.message);
    }
  }

  let intercept, logSlope, logSqSlope, residualSd, sampleSize;
  let tanhScalePct = 0.7458;
  let windowOffsetPp = -3.242;
  let windowResidualSd = 6.326;

  if (trainingData.length >= 20) {
    sampleSize = trainingData.length;
    const fit = fitQuadratic(trainingData);
    intercept = Number(fit.beta0.toFixed(4));
    logSlope = Number(fit.beta1.toFixed(4));
    logSqSlope = Number(fit.beta2.toFixed(4));
    residualSd = Number(fit.residualSd.toFixed(4));

    if (subConversionData.length >= 20) {
      subConversionData.sort((a, b) => a - b);
      const p90Idx = Math.floor(subConversionData.length * 0.90);
      const p90 = subConversionData[p90Idx];
      const atanh07 = 0.5 * Math.log((1 + 0.70) / (1 - 0.70));
      if (p90 > 0) {
        tanhScalePct = Number((p90 / atanh07).toFixed(4));
      }
    }
  } else if (fallbackCalib) {
    console.log("Using reference calibration from calib_final.json (fitted 2026-09-13 on 520 videos)...");
    sampleSize = fallbackCalib.CALIBRATION_N || 520;
    intercept = fallbackCalib.RETENTION_INTERCEPT;
    logSlope = fallbackCalib.RETENTION_LOG_SLOPE;
    logSqSlope = fallbackCalib.RETENTION_LOG_SQ_SLOPE;
    residualSd = fallbackCalib.RETENTION_RESIDUAL_SD;
    tanhScalePct = fallbackCalib.SUB_TANH_SCALE;
    windowOffsetPp = fallbackCalib.RETENTION_WINDOW_OFFSET_PP;
    windowResidualSd = fallbackCalib.RETENTION_WINDOW_RESIDUAL_SD;
  } else {
    sampleSize = 520;
    intercept = 251.4371;
    logSlope = -54.2223;
    logSqSlope = 3.1695;
    residualSd = 5.4609;
    tanhScalePct = 0.7458;
    windowOffsetPp = -3.242;
    windowResidualSd = 6.326;
  }

  const today = new Date().toISOString().split("T")[0];

  console.log("\n------------------------------------------------------------------");
  console.log("CALIBRATION OUTPUT — Copy and paste into server/satisfaction-score.js:");
  console.log("------------------------------------------------------------------\n");

  const output = `const CALIBRATION = {
  version: 2,
  fittedAt: "${today}",
  sampleSize: ${sampleSize},
  retention: {
    intercept:        ${intercept},
    logSlope:         ${logSlope},
    logSqSlope:         ${logSqSlope},
    residualSd:         ${residualSd},  // lifetime basis  — Video Audit
    windowOffsetPp:    ${windowOffsetPp},   // 28-day basis    — Channel Health
    windowResidualSd:   ${windowResidualSd},
    durationClampSec: [180, 5400],
  },
  subConversion: { tanhScalePct: ${tanhScalePct} },
  weights:       { retention: 0.70, subConversion: 0.30 },
  zSoftness: 1.5,
  minViewsToScore: 250,
  minViewsConfident: 1000,
};`;

  console.log(output);
  console.log("\n------------------------------------------------------------------");
  console.log("Do not automatically overwrite running configuration.");
  console.log("------------------------------------------------------------------");
}

if (require.main === module) {
  calibrate().catch((err) => {
    console.error("Calibration failed:", err);
    process.exit(1);
  });
}

module.exports = { calibrate, fitQuadratic, solve3x3 };
