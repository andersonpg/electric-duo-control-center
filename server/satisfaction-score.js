"use strict";

// Shared Viewer Satisfaction Score methodology (v2), used by both the Channel
// Health scorecard (server/channel-health.js) and the per-video Video Audit
// (server/audit.js) so the two can never drift out of sync.
//
// YouTube does not expose its own internal viewer-satisfaction survey score
// to creators. This is a transparent proxy calibrated against the channel's
// real catalogue, not an official YouTube metric.

const SCORE_VERSION = 2;

const CALIBRATION = {
  version: 2,
  fittedAt: "2026-09-13",
  sampleSize: 520,
  retention: {
    intercept:        251.4371,
    logSlope:         -54.2223,
    logSqSlope:         3.1695,
    residualSd:         5.4609,  // lifetime basis  — Video Audit
    windowOffsetPp:    -3.242,   // 28-day basis    — Channel Health
    windowResidualSd:   6.326,
    durationClampSec: [180, 5400],
  },
  ultraLongCredit: {
    minDurationSec: 2700,    // 45 minutes
    maxDurationSec: 5400,    // 90 minutes
    maxAvdWeight: 0.40,      // Max weight given to absolute view duration at 90m (scales smoothly from 0 at 45m)
    avdNeutralSec: 300,      // 5.0 minutes of view duration = 50 sub-score (neutral)
    avdScaleSec: 180,        // 8.0 minutes of view duration = ~88 sub-score
  },
  subConversion: { tanhScalePct: 0.7458 },
  weights:       { retention: 0.70, subConversion: 0.30 },
  zSoftness: 1.5,
  minViewsToScore: 250,
  minViewsConfident: 1000,
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function expectedRetention(durationSec, basis = "lifetime") {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) {
    return null;
  }
  const [minD, maxD] = CALIBRATION.retention.durationClampSec;
  const d = clamp(durationSec, minD, maxD);
  const L = Math.log(d);
  let expected =
    CALIBRATION.retention.intercept +
    CALIBRATION.retention.logSlope * L +
    CALIBRATION.retention.logSqSlope * L * L;
  if (basis === "window") {
    expected += CALIBRATION.retention.windowOffsetPp;
  }
  return Number(expected.toFixed(1));
}

function computeCoreAudienceIntensity({ likes, comments, shares, views }) {
  if (!views || views <= 0) return null;
  return Number((((likes || 0) + (comments || 0) + (shares || 0)) / views * 100).toFixed(1));
}

const computeEngagementRate = computeCoreAudienceIntensity;

function computeSubConversionRate({ netSubs, views }) {
  if (netSubs == null || !views || views <= 0) return null;
  return Number((netSubs / views * 100).toFixed(3));
}

function scoreSatisfaction({ retentionPct, durationSec, subConversionRate, views, basis = "lifetime" }) {
  if (views == null || views < CALIBRATION.minViewsToScore) {
    return null;
  }
  if (retentionPct == null || !Number.isFinite(retentionPct)) {
    return null;
  }

  const expected = expectedRetention(durationSec || 900, basis);
  if (expected == null) {
    return null;
  }

  const residualSd =
    basis === "window"
      ? CALIBRATION.retention.windowResidualSd
      : CALIBRATION.retention.residualSd;

  const z = (retentionPct - expected) / residualSd;
  const relativeSubScore = clamp(50 + 50 * Math.tanh(z / CALIBRATION.zSoftness), 0, 100);

  // Absolute Watch Duration Credit for ultra-long videos (>45m)
  // When a video exceeds 45 minutes, percentage retention naturally compresses, but holding
  // viewers for substantial minutes (e.g. 5–8+ minutes) delivers massive watch time value.
  // Requires at least 4.0 minutes (240s) of view duration to qualify.
  let retSubScore = relativeSubScore;
  let watchDurationCredit = null;
  const avdSec = (retentionPct / 100) * (durationSec || 0);

  if (durationSec && durationSec > CALIBRATION.ultraLongCredit.minDurationSec && avdSec >= 240) {
    const { minDurationSec, maxDurationSec, maxAvdWeight, avdNeutralSec, avdScaleSec } = CALIBRATION.ultraLongCredit;
    const durationRatio = clamp((durationSec - minDurationSec) / (maxDurationSec - minDurationSec), 0, 1);
    const avdWeight = maxAvdWeight * durationRatio;
    const avdScore = clamp(50 + 50 * Math.tanh((avdSec - avdNeutralSec) / avdScaleSec), 0, 100);
    const blended = (1 - avdWeight) * relativeSubScore + avdWeight * avdScore;
    const diff = Math.round(blended - relativeSubScore);
    if (diff > 0) {
      retSubScore = clamp(blended, 0, 100);
      watchDurationCredit = diff;
    }
  }

  let partial = false;
  let subConversionSubScore = 50;

  if (subConversionRate != null && Number.isFinite(subConversionRate)) {
    subConversionSubScore = clamp(
      50 + 50 * Math.tanh(subConversionRate / CALIBRATION.subConversion.tanhScalePct),
      0,
      100
    );
  } else {
    partial = true;
  }

  const score = Math.round(
    CALIBRATION.weights.retention * retSubScore +
    CALIBRATION.weights.subConversion * subConversionSubScore
  );

  return {
    score,
    scoreVersion: SCORE_VERSION,
    partial,
    confidence: views < CALIBRATION.minViewsConfident ? "low" : "high",
    components: {
      retention: {
        value: Number(retentionPct.toFixed(1)),
        expected,
        subScore: Math.round(retSubScore),
        avgViewDurationSec: Math.round(avdSec),
        watchDurationCredit,
      },
      subConversion: {
        value: subConversionRate != null ? Number(subConversionRate.toFixed(3)) : null,
        subScore: Math.round(subConversionSubScore),
      },
    },
  };
}

const METHODOLOGY_NOTE =
  "Composite of two measured signals calibrated to the channel's long-form library (fitted on 2026-09-13 across 520 videos): retention scored against a duration-adjusted baseline (weight 70%) and net subscriber conversion per view (weight 30%). Engagement rate is reported separately as Core-Audience Intensity because engaged actions mechanically measure audience reach rather than viewer satisfaction. A net subscriber loss scores below neutral (50). YouTube never exposes its internal viewer-satisfaction survey score to creators, so this is a disclosed proxy, not an official YouTube metric.";

module.exports = {
  SCORE_VERSION,
  CALIBRATION,
  expectedRetention,
  scoreSatisfaction,
  computeCoreAudienceIntensity,
  computeEngagementRate,
  computeSubConversionRate,
  METHODOLOGY_NOTE,
};
