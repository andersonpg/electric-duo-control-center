"use strict";

const assert = require("assert");
const {
  SCORE_VERSION,
  CALIBRATION,
  expectedRetention,
  scoreSatisfaction,
  computeCoreAudienceIntensity,
  computeSubConversionRate,
} = require("../server/satisfaction-score");

console.log("Running Viewer Satisfaction Score v2 Unit Tests...\n");

// 1. Expected Retention Curve points from §2
console.log("1. Testing Expected Retention curve at duration benchmarks...");
const curvePoints = [
  { min: 5, sec: 300, expected: 45.3 },
  { min: 10, sec: 600, expected: 34.3 },
  { min: 20, sec: 1200, expected: 26.3 },
  { min: 30, sec: 1800, expected: 23.1 },
  { min: 45, sec: 2700, expected: 20.9 },
  { min: 60, sec: 3600, expected: 20.0 },
];

for (const { min, sec, expected } of curvePoints) {
  const actual = expectedRetention(sec, "lifetime");
  assert.strictEqual(
    actual,
    expected,
    `Expected retention for ${min}m (${sec}s) should be ${expected}%, got ${actual}%`
  );
}
console.log("✓ All 6 duration curve benchmarks match exactly to 0.1%");

// 2. Duration clamping at [180, 5400]
console.log("\n2. Testing duration clamping at [180, 5400]...");
const atMin = expectedRetention(180);
const belowMin = expectedRetention(60); // 1m clamped to 180s
assert.strictEqual(belowMin, atMin, "Duration below 180s must clamp to 180s");

const atMax = expectedRetention(5400);
const aboveMax = expectedRetention(7200); // 120m clamped to 5400s
assert.strictEqual(aboveMax, atMax, "Duration above 5400s must clamp to 5400s");
console.log("✓ Clamping at 180s and 5400s works correctly");

// 3. Window basis offset
console.log("\n3. Testing window basis offset (-3.242 pp)...");
const lifetimeExpected = expectedRetention(1800, "lifetime");
const windowExpected = expectedRetention(1800, "window");
assert.ok(
  Math.abs((windowExpected - lifetimeExpected) - (-3.242)) < 0.15,
  `Window basis offset must shift expected retention by ~-3.2 pp (got ${windowExpected - lifetimeExpected})`
);
console.log("✓ Window basis offset correctly applied");

// 4. Subscriber conversion tanh scaling
console.log("\n4. Testing net subscriber conversion tanh scaling...");
// 0.0% conversion -> neutral 50
const neutralScore = scoreSatisfaction({
  retentionPct: 23.1,
  durationSec: 1800,
  subConversionRate: 0.0,
  views: 2000,
  basis: "lifetime",
});
assert.strictEqual(neutralScore.components.subConversion.subScore, 50, "0.0% net sub conversion must yield 50 subScore");

// p90 conversion (0.647%) -> 85 subScore
const p90Score = scoreSatisfaction({
  retentionPct: 23.1,
  durationSec: 1800,
  subConversionRate: 0.647,
  views: 2000,
  basis: "lifetime",
});
assert.strictEqual(p90Score.components.subConversion.subScore, 85, "0.647% net sub conversion must yield 85 subScore");

// Negative net sub conversion -> below 50
const lossScore = scoreSatisfaction({
  retentionPct: 23.1,
  durationSec: 1800,
  subConversionRate: -0.2,
  views: 2000,
  basis: "lifetime",
});
assert.ok(
  lossScore.components.subConversion.subScore < 50,
  "Negative net sub conversion must yield subScore < 50"
);
console.log("✓ Sub conversion scaling (neutral=50, p90=85, loss<50) verified");

// 5. Acceptance Criterion 5: Negative net subs scores strictly below zero net subs
console.log("\n5. Testing Acceptance Criterion 5 (negative subs vs zero subs)...");
const zeroSubVideo = scoreSatisfaction({
  retentionPct: 25.0,
  durationSec: 1200,
  subConversionRate: 0.0,
  views: 1500,
});
const negSubVideo = scoreSatisfaction({
  retentionPct: 25.0,
  durationSec: 1200,
  subConversionRate: -0.25,
  views: 1500,
});
assert.ok(
  negSubVideo.score < zeroSubVideo.score,
  `Video with negative net subs (${negSubVideo.score}) must score strictly below zero net subs (${zeroSubVideo.score})`
);
console.log("✓ Criterion 5 satisfied: negative net subs scores strictly below zero net subs");

// 6. Acceptance Criterion 7: Minimum views (< 250 -> null, 250-999 -> low confidence, >=1000 -> high)
console.log("\n6. Testing Acceptance Criterion 7 (view thresholds: 250 and 1000)...");
const underMinViews = scoreSatisfaction({
  retentionPct: 30.0,
  durationSec: 1200,
  subConversionRate: 0.1,
  views: 249,
});
assert.strictEqual(underMinViews, null, "Videos under 250 views must return null score");

const lowConfidence = scoreSatisfaction({
  retentionPct: 30.0,
  durationSec: 1200,
  subConversionRate: 0.1,
  views: 250,
});
assert.ok(lowConfidence !== null, "Videos with 250 views must receive a score");
assert.strictEqual(lowConfidence.confidence, "low", "Views in [250, 999] must have confidence: 'low'");

const highConfidence = scoreSatisfaction({
  retentionPct: 30.0,
  durationSec: 1200,
  subConversionRate: 0.1,
  views: 1000,
});
assert.strictEqual(highConfidence.confidence, "high", "Views >= 1000 must have confidence: 'high'");
console.log("✓ Criterion 7 satisfied: no score under 250 views, low confidence 250-999, high >= 1000");

// 7. Missing components handling
console.log("\n7. Testing missing components handling...");
const missingRetention = scoreSatisfaction({
  retentionPct: null,
  durationSec: 1200,
  subConversionRate: 0.1,
  views: 1500,
});
assert.strictEqual(missingRetention, null, "Missing retention must return null");

const missingSubs = scoreSatisfaction({
  retentionPct: 26.3, // expected for 20m is 26.3 -> z = 0 -> retSubScore = 50
  durationSec: 1200,
  subConversionRate: null,
  views: 1500,
});
assert.ok(missingSubs !== null, "Missing subs with valid retention must score");
assert.strictEqual(missingSubs.partial, true, "Missing subs must set partial: true");
assert.strictEqual(missingSubs.components.subConversion.subScore, 50, "Missing subs must use neutral 50");
assert.strictEqual(missingSubs.score, 50, "Score with z=0 retention and neutral subs must be 50");
console.log("✓ Missing components handled per specification");

// 8. Core-Audience Intensity
console.log("\n8. Testing Core-Audience Intensity calculation...");
const intensity = computeCoreAudienceIntensity({
  likes: 120,
  comments: 18,
  shares: 22,
  views: 3320,
});
// (120 + 18 + 22) / 3320 * 100 = 160 / 3320 * 100 = 4.819% -> 4.8%
assert.strictEqual(intensity, 4.8, `Core-Audience Intensity should round to 1 decimal (expected 4.8, got ${intensity})`);

const intensityNoViews = computeCoreAudienceIntensity({
  likes: 10,
  comments: 2,
  shares: 1,
  views: 0,
});
assert.strictEqual(intensityNoViews, null, "0 views must return null intensity");
console.log("✓ Core-Audience Intensity verified");

console.log("\n=========================================");
console.log("ALL VIEWER SATISFACTION V2 TESTS PASSED!");
console.log("=========================================\n");
