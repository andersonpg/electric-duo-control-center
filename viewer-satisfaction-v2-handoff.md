# Rework the Viewer Satisfaction Score (v1 → v2)

Command Center — `/Users/patrick/Development/CommandCenter`. Target version **2.5.0**
(this is a methodology change, not a patch).

The Viewer Satisfaction Score shipped in 2.4.4–2.4.6 is a 3-signal average with
fixed ceilings. Calibrating it against the channel's real back catalogue (733
videos pulled from the YouTube Analytics API, 613 of them long-form VOD) showed
three defects that make the current output misleading. Every constant below is
**measured from that catalogue**, not assumed. Do not substitute your own.

---

## 1. What is wrong with v1

**(a) It penalises long content.** Retention falls predictably with duration:
`Spearman(v1 score, ln duration) = −0.232`. Median v1 score by length —
3–10m: 66, 10–20m: 55, 20–40m: 56, 40–60m: 53, 60m+: 52. A 40-minute episode is
structurally capped at a mediocre retention sub-score no matter how good it is.

**(b) The engagement component measures reach, not satisfaction.** Engaged
actions scale as `views^0.69` (R² = 0.77), so the engagement *rate* falls
mechanically as a video reaches a wider audience. Median engagement rate by view
decile runs **7.96% → 2.68%** bottom to top, while retention stays flat at ~25%
across every decile. At 33% weight this component rewards videos that did not
travel. `Spearman(engagement rate, ln views) = −0.646`.

**(c) The ceilings are wrong in both directions.** Against the real
distribution: the retention ceiling of 50% clips only **2.6%** of videos (far too
high — it squashes every score toward the bottom of the range), the sub-conversion
ceiling of 1% clips **2.9%** (too high), and the engagement ceiling of 6% clips
**37.4% of all videos at exactly 100** (far too low — no discriminating power).

Also fix, while in here:
- `server/audit.js` scores each video over **lifetime** (`startDate: "2020-01-01"`,
  `server/youtube-analytics.js:219`) while `server/channel-health.js` scores a
  rolling **28-day window**. The two numbers are presented as the same metric and
  are not on the same scale. See §4 — they need different baselines.
- `server/youtube-analytics.js:238` rounds retention to a whole number
  (`retentionRate: Math.round(r[3] || 0)`) before it is scored. Keep one decimal.

---

## 2. The v2 methodology

Two components, not three. Engagement leaves the score entirely and becomes a
separate display-only metric (§5).

### Retention component — weight 0.70

Score the video against the retention a video of **its own length** normally
earns on this channel, not against a flat ceiling.

```
d          = clamp(durationSec, 180, 5400)          // clamp is required, see note
L          = ln(d)
expected   = RET_INTERCEPT + RET_LOG*L + RET_LOG_SQ*L*L   ( + RET_WINDOW_OFFSET_PP on the window basis )
z          = (actualRetentionPct - expected) / residualSd
subScore   = clamp(50 + 50*tanh(z / 1.5), 0, 100)
```

The quadratic term is not decoration — it lifts R² from 0.464 to 0.502 and flattens
the residual bias at both ends of the length range. **The clamp at 5400s is
required**: the fitted parabola turns upward past ~86 minutes, so without it a
100-minute video would be handed an expected retention that is too high.

Expected retention this curve produces: 5m → 45.3%, 10m → 34.3%, 20m → 26.3%,
30m → 23.1%, 45m → 20.9%, 60m → 20.0%.

### Net subscriber conversion component — weight 0.30

Signed and re-centred, so a net subscriber *loss* scores below neutral instead of
flooring at zero alongside a video that netted nothing.

```
subScore = clamp(50 + 50*tanh(netSubConversionPct / SUB_TANH_SCALE), 0, 100)
```

50 = neutral, the channel's p90 conversion (0.647%) lands at 85, and a net loss
falls below 50. No hard cap at either end.

### Composite

```
score = round(0.70*retentionSubScore + 0.30*subConversionSubScore)
```

**Missing components.** Retention is the anchor — with no measured retention,
return `null` and report the score unavailable, as v1 does today. If retention is
present but net-sub data is not, substitute **50** (the calibrated neutral point)
for the sub component and set `partial: true`. Do *not* renormalise the weights
onto the surviving component, and do *not* "impute the average of the other
components" — with a plain mean that is arithmetically identical to dropping the
component, so it fixes nothing.

**Minimum views.** Rate metrics are denominator noise on low-view videos: net-sub
rate standard deviation is 1.441 below 250 views versus 0.223 in the 1000–2500
band. Below **250** views, return no score. Between 250 and 999, return the score
with `confidence: "low"` and surface that in the UI.

---

## 3. Calibration constants — frozen, versioned, committed

Fitted 2026-09-13 on 520 long-form VOD videos (>180s, non-live, ≥1000 lifetime
views). **These are constants in source, not values recomputed per request.** A
baseline that refits on every call would silently rewrite a video's historical
score and make the Channel Health prior-period delta meaningless.

```js
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
  subConversion: { tanhScalePct: 0.7458 },
  weights:       { retention: 0.70, subConversion: 0.30 },
  zSoftness: 1.5,
  minViewsToScore: 250,
  minViewsConfident: 1000,
};
```

Add `scripts/calibrate-satisfaction.js` that refits these against live Analytics
and **prints** a replacement block for a human to paste in. It must not write to
the running config. Re-run quarterly.

---

## 4. Why Channel Health needs its own baseline

A video's 28-day-window retention runs measurably below its lifetime retention —
the launch audience is warmer than the search and suggested traffic that finds it
later. Measured across six independent consecutive 28-day windows the gap is
stable: −3.82, −2.78, −2.97, −3.42, −2.77, −3.66 pp (mean **−3.242 pp**).

If both surfaces shared the lifetime baseline, Channel Health would sit roughly
10–12 points below the per-video scores forever, for no real reason. Hence
`windowOffsetPp` and `windowResidualSd`, selected by a `basis` argument
(`"lifetime"` | `"window"`).

---

## 5. Core-Audience Intensity (replaces the engagement component)

The engagement rate stays visible but leaves the score, relabelled so a high
number reads as *narrow, devoted audience* rather than *satisfying*.

- Value: `(likes + comments + shares) / views * 100`, one decimal.
- Label: **Core-Audience Intensity**.
- Caption: "Engaged actions per view. This runs inversely to reach — a video
  served to a wide cold audience will always show a lower figure than one that
  stayed with the core audience. It is a read on who watched, not on how well it
  satisfied them, so it is shown here rather than folded into the score."
- Channel reference percentiles for context: p25 3.55%, p50 4.81%, p75 6.76%,
  p90 8.47%.

Do **not** weight comments ×5 / shares ×3 into anything user-facing. Likes are
74.8% of the raw engagement sum, comments 11.4%, shares 13.8%; weighting changes
the number without changing what it measures, which is reach.

---

## 6. File-by-file changes

### `server/satisfaction-score.js` — rewrite

Delete `RETENTION_CEILING`, `ENGAGEMENT_CEILING`, `SUB_CONVERSION_CEILING` and
`scoreSatisfactionComponents`. Export:

- `SCORE_VERSION`, `CALIBRATION`
- `expectedRetention(durationSec, basis)`
- `scoreSatisfaction({ retentionPct, durationSec, subConversionRate, views, basis })`
  → `{ score, scoreVersion, partial, confidence, components: { retention: {value, expected, subScore}, subConversion: {value, subScore} } }`, or `null`
- `computeCoreAudienceIntensity({ likes, comments, shares, views })`
- `computeSubConversionRate` (keep as-is)
- `METHODOLOGY_NOTE` — rewritten to describe the length-adjusted baseline, the
  two-component weighting, why engagement was removed, and the fit date and
  sample size. Keep the existing "not an official YouTube metric" disclosure.

Retire `computeEngagementRate` from the scoring path; keep it only if
`computeCoreAudienceIntensity` wraps it.

### `server/audit.js` — lines 272–295, 312, 411

- Pass `durationSec` (already computed at line ~212) and `basis: "lifetime"`.
- Drop `engagementRate` from the score inputs; add
  `coreAudienceIntensity` alongside `satisfactionScore` in the returned metrics.
- Keep the existing `rawSubsGained`/`rawSubsLost` handling at lines 278–284 — it
  correctly distinguishes a measured zero from a missing value. Do not "simplify"
  it back to the display variables.
- Line 312: also push `"viewer satisfaction score"` when views < 250.
- Line 411: append confidence when `confidence === "low"`, e.g.
  `… : 62/100 (low confidence — under 1,000 views)`.

### `server/channel-health.js` — lines 960–1000, 1106–1130

Replace the aggregate-driven satisfaction block. `queryLongFormChannelMetrics`
stays for the main scorecard; the score now aggregates per-video results.

1. New `queryLongFormVideoMetrics(ytAnalytics, startDate, endDate)`:
   ```
   dimensions: "video",
   metrics:    "views,averageViewPercentage,subscribersGained,subscribersLost",
   filters:    "creatorContentType==video_on_demand",
   sort:       "-views",
   maxResults: 200
   ```
   **This report is hard-capped at 200 rows. `startIndex: 201` returns HTTP 400
   "The query is not supported" — do not add paging.** 200 rows covers 96.1% of
   long-form window views, which is fine; report the shortfall rather than hiding it.

2. Durations: fetch via Data API `videos.list(part=contentDetails)` in chunks of
   50 ids (4 calls for 200 videos). Do not join the local `videos` table as the
   primary source — the existing comment at line 956 is right that the local
   catalogue's duration data can be incomplete. Local catalogue is an acceptable
   fallback; videos with no resolvable duration are excluded and counted.

3. Score each video with `basis: "window"`, including only those with **≥100
   window views**.

4. Channel score = **view-weighted mean** of those per-video scores, rounded.
   Same computation over the prior window for `scoreDelta`.

5. Add to the `satisfactionScore` payload: `videosScored`, `coverage` (scored
   views ÷ total long-form window views), `scoreVersion`.

6. Replace `components.engagementRate` with the Core-Audience Intensity metric,
   marked as display-only.

### `frontend/src/ChannelHealth.jsx` — lines 626–666, 1458

- Relabel the third tile (line 659) to Core-Audience Intensity and mark it
  visually as not part of the score (muted border, or a "context" chip).
- Show `videosScored` and `coverage` under the badge: "Across 191 long-form
  videos · 96% of window views".
- Keep the 40 / 70 band thresholds in `SatisfactionScoreBadge` — verified against
  the new scale, they give a 21% / 53% / 27% red/amber/green split.
- Update the explanatory paragraph at lines 634–638 — it currently says "three
  measured long-form signals".

### `frontend/src/AuditReportModal.jsx` — lines 613–660, 1238

- Same relabel at line 639.
- Show a confidence note when `confidence === "low"`.
- Show the length-adjusted context under the retention figure — "26.3% vs 23.1%
  expected for a 30-minute video" is the single most useful thing this rework
  produces; do not drop it.
- Keep the 40 / 70 bands in `SatisfactionBadge`.

### Stored reports

`video_audits.metrics_json` and `channel_health_reports.report_json` hold scores
computed under v1. Do not migrate or recompute them. Where a stored score has a
missing or `< 2` `scoreVersion`, the UI must show "scored under an earlier
methodology — refresh to update" and must not render a delta against a v2 score.

---

## 7. Acceptance criteria

Run against live Analytics, long-form VOD, ≥1000 lifetime views, ≥90 days old
(n ≈ 499):

1. `Spearman(score, ln duration)` within **±0.05** — v1 is −0.232.
2. `Spearman(score, ln views)` within **±0.05** — v1 is −0.246. The score must be
   reach-neutral: a satisfaction metric that tracks views is a reach metric with
   extra steps.
3. Score distribution roughly p10 32 / p50 56 / p75 71 / p90 81, sd ≈ 18.5
   (v1: p10 38 / p50 55 / p90 69, sd 12.6). The spread must widen.
4. Median score by duration band within a ~10-point spread: expect
   3–10m 64, 10–20m 54, 20–40m 58, 40–60m 55, 60m+ 58.
5. A video with negative net subs scores strictly below an otherwise identical
   video with zero net subs.
6. Channel Health for the current 28-day window returns **≈63** over ~191 videos
   at ~96% coverage. (The old formula's aggregate retention sub-score for the
   same window was 43.)
7. No video under 250 views receives a score anywhere in the UI.

---

## 8. Explicitly do not do

- **Do not score the residual as a percentile of the catalogue.** It pegs the
  median at 50 by construction, so the channel can never improve and the
  prior-period delta on Channel Health becomes noise. The frozen baseline in §3
  exists precisely to avoid this.
- **Do not add returning-viewer rate.** The YouTube Analytics API does not expose
  new-vs-returning viewers; it is a Studio-only breakdown. Verify before
  spending any time on it.
- **Do not fold traffic-source mix into the score.** A search-heavy video showing
  low retention is a real interpretation problem, but baking it in makes the
  number uninterpretable. Display the existing `trafficShare` beside the score
  instead — both modules already compute it.
- **Do not recompute the calibration at request time.**
