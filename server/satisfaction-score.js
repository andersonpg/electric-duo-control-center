"use strict";

// Shared Viewer Satisfaction Score methodology, used by both the Channel
// Health scorecard (server/channel-health.js) and the per-video Video Audit
// (server/audit.js) so the two can never drift out of sync.
//
// YouTube does not expose its own internal viewer-satisfaction survey score
// to creators. This is a transparent proxy built from three signals YouTube
// has publicly tied to satisfaction, not an official YouTube metric.

const RETENTION_CEILING = 50; // % average viewed treated as a 100-point ceiling
const ENGAGEMENT_CEILING = 6; // % (likes+comments+shares)/views treated as a 100-point ceiling
const SUB_CONVERSION_CEILING = 1; // % net subscriber conversion per view treated as a 100-point ceiling

function computeEngagementRate({ likes, comments, shares, views }) {
  if (!views || views <= 0) return null;
  return Number((((likes || 0) + (comments || 0) + (shares || 0)) / views * 100).toFixed(2));
}

function computeSubConversionRate({ netSubs, views }) {
  if (netSubs == null || !views || views <= 0) return null;
  return Number((netSubs / views * 100).toFixed(3));
}

// Maps each measured input onto a disclosed 0-100 point scale and averages
// whichever components are available. The ceilings are not official YouTube
// figures -- they are rule-of-thumb "strong performance" benchmarks, applied
// consistently and shown in full in METHODOLOGY_NOTE below. A net subscriber
// loss floors at 0 points rather than going negative.
function scoreSatisfactionComponents({ retention, engagementRate, subConversionRate }) {
  const clamp = (n) => Math.max(0, Math.min(100, n));
  const subScores = [];
  if (retention != null) subScores.push(clamp(Math.round((retention / RETENTION_CEILING) * 100)));
  if (engagementRate != null) subScores.push(clamp(Math.round((engagementRate / ENGAGEMENT_CEILING) * 100)));
  if (subConversionRate != null) subScores.push(clamp(Math.round((Math.max(0, subConversionRate) / SUB_CONVERSION_CEILING) * 100)));

  if (subScores.length === 0) return null;
  return Math.round(subScores.reduce((a, b) => a + b, 0) / subScores.length);
}

const METHODOLOGY_NOTE = "Composite of three signals YouTube has publicly tied to viewer satisfaction: average percentage viewed (50% = a 100-point ceiling), engagement rate — likes + comments + shares per view (6% = a 100-point ceiling), and net subscriber conversion per view (1% = a 100-point ceiling). Each is capped at 100 points and averaged; a net subscriber loss floors at 0 rather than going negative. YouTube's internal viewer-satisfaction survey score is never exposed to creators, so this is a disclosed proxy, not an official YouTube metric.";

module.exports = {
  RETENTION_CEILING,
  ENGAGEMENT_CEILING,
  SUB_CONVERSION_CEILING,
  computeEngagementRate,
  computeSubConversionRate,
  scoreSatisfactionComponents,
  METHODOLOGY_NOTE,
};
