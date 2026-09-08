# Handoff: Video classifier accuracy + fabricated-data audit

Two parts. Part A explains why the category classifier is performing badly and how to fix it.
Part B is a full sweep of every place the app presents invented numbers as measurements, ranked
by how much damage they do.

Findings marked **[verified]** were checked against `data/database.sqlite` on 2026-09-08, not
just read from source.

---

# PART A — WHY THE CLASSIFIER IS DOING BADLY

## A.1 The root cause: there are two different category vocabularies, and they don't overlap

**[verified]** `content_categories` currently holds six categories:

```
How Tos/Guides            Tutorials, charging adapter setups, and EV ownership guides
News/Quick Charge         EV industry news, breaking updates, and Quick Charge news episodes
Other                     Livestreams, announcements, and channel updates
Road Trip/Travel Series   Long-distance EV journeys, route tests, and charging vlogs
Sponsor Content           Dedicated sponsor segments and product spotlights
Walkarounds/Reviews       Vehicle deep dives, first looks, and hardware reviews
```

**[verified]** But the `videos.content_type` column holds an entirely different set:

| content_type            | videos |
|-------------------------|--------|
| Review                  | 356    |
| EV News                 | 124    |
| Road Trip / Vlog        | 79     |
| How-To / Instructional  | 11     |
| EV Review               | 1      |
| **Total**               | **571**|

Zero videos carry a value that matches any of the six current categories.

This breaks several things at once:

- **Channel Health's category breakdown** filters with `longFormVideos.filter(v => v.content_type === cat.name)`
  at `server/channel-health.js:480`. With the data as it stands, every category matches zero
  videos. Anything the page shows as uncategorised or "Other" is this mismatch, not a judgement
  the AI made.
- **Video Audit benchmarks** are keyed on the *old* vocabulary. `CATEGORY_BENCHMARKS` at
  `server/audit.js:9` has keys `Review`, `How-To / Instructional`, `EV News`, `Road Trip / Vlog`.
  So today they resolve. But the moment you run a successful bulk reclassify, every video gets a
  *new*-vocabulary name, none of which is a key, and `server/audit.js:58` silently falls back to
  the `Review` benchmark for every video on the channel.
- **The catalog sync writes the old names back.** `server/youtube.js:576-583` keyword-guesses
  `Review` / `How-To / Instructional` / `EV News` / `Road Trip / Vlog` on every ingested video.
  So even after a clean reclassify, the next sync reintroduces the old vocabulary.
- `EV Review` with a single video is a stray variant of `Review`.

**Fix this first — nothing else in Part A will hold until it is done.**

1. Make `content_categories` the single source of truth for category names everywhere.
2. Add `avg_ctr`, `avg_retention`, `avg_view_duration`, and `traffic_share_json` columns to
   `content_categories`, migrate the four `CATEGORY_BENCHMARKS` entries into rows, and delete the
   hardcoded constant in `server/audit.js`. Then a benchmark can never drift from a category name
   again. See Part B for why those benchmark numbers need review regardless.
3. Write a one-time migration mapping old names to new: `Review` and `EV Review` →
   `Walkarounds/Reviews`, `EV News` → `News/Quick Charge`, `Road Trip / Vlog` →
   `Road Trip/Travel Series`, `How-To / Instructional` → `How Tos/Guides`. Set
   `category_source = 'migrated'` so these are visibly distinct from AI-assigned and manual.
4. Delete the keyword-guessing block at `server/youtube.js:576-583`. New videos should be
   ingested with `content_type = NULL` and `category_source = 'unclassified'` so they queue for
   the classifier instead of being guessed at.
5. Add a guard that refuses to write a `content_type` that is not a current category name, so
   this cannot silently recur.

## A.2 The classifier is running almost blind

**[verified]** `videos.description` is not the real YouTube description. `server/youtube.js:569`
writes a synthesised placeholder:

```js
const description = `Watch the official video "${title}" on The Electric Duo YouTube channel.`;
```

Every sampled row in the database matches that template. The classifier at
`server/channel-health.js:200` feeds `description.substring(0, 150)` to the model, which is
therefore just the title restated inside a fixed sentence. The model is classifying on the title
alone, and paying tokens to read it twice.

**Fix:** pull the real `snippet.description` and `snippet.tags` from the Data API during sync.
Then give the classifier real signal:

- Real description, first 500 characters.
- Tags.
- Duration. A 45-minute video is very unlikely to be a news episode.
- Playlist membership. See A.5 — this is the strongest signal available and it needs no AI.
- The first 300 to 500 characters of the transcript, when one exists. The `transcripts` table is
  already populated. The opening of a video states what it is far more reliably than its title.

## A.3 Failures are silent and are counted as successes

In `bulkReclassifyLibrary()` at `server/channel-health.js:174`:

- If the Gemini call throws, or the response is truncated, or `JSON.parse` fails, the `catch` at
  line 233 logs a console warning and leaves `classifiedMap` empty.
- All 25 videos in that chunk then fall through to the keyword ladder at line 239.
- `reclassifiedCount++` runs for every video regardless of where its category came from.

So the UI can report "AI reclassified 571 / 571 videos" when the model contributed nothing at
all, and the keyword ladder assigned everything. That single behaviour is enough to produce a
library full of bad categories with no visible error.

**Fix:** count model-assigned, fallback-assigned, and failed separately. Return all three. Show
them in the toast. Retry a failed chunk at least twice with backoff before falling back. If more
than a small fraction of chunks fail, abort and report rather than writing keyword guesses over
the whole library.

## A.4 The output contract is fragile

- The map is keyed on `item.youtube_id` at line 236. Any drift — the model returning the `[3]`
  index instead of the ID, adding whitespace, or inventing an ID — fails the
  `categoryNames.includes()` guard and drops that video to the keyword ladder silently.
- There is no `responseMimeType: "application/json"` and no `responseSchema`. The code strips
  markdown fences with regex and hopes. One stray token loses all 25 videos in the batch.
- No temperature is set. Classification should run at or near 0.
- Batches of 25 with no per-item reasoning degrade accuracy. 10 to 12 is a better size.

**Fix:** use structured output with a response schema — an array of objects with `youtube_id`,
`category` as an enum of the exact category names, and a `confidence` number. Validate that the
returned count matches the batch size and that every requested ID came back; re-request the
missing ones individually rather than defaulting them.

## A.5 Use the playlist mappings you already have

`playlist_category_mappings` exists, with `getPlaylistMappings()` and `savePlaylistMapping()` at
`server/channel-health.js:88`. A video sitting in your "Quick Charge" playlist is a Quick Charge
episode with certainty no prompt can match.

**Fix:** run playlist mapping as a deterministic pass *before* the AI pass, mark those
`category_source = 'playlist'`, and exclude them from the AI batch entirely. This will likely
resolve a large share of the library at 100% accuracy and shrink the AI's job to the genuinely
ambiguous remainder.

## A.6 The keyword fallback ladder is actively harmful

At `server/channel-health.js:240`:

```js
if (lowerTitle.includes("quick charge") || lowerTitle.includes("news")
    || lowerTitle.includes("update") || lowerTitle.includes("202")) {
  matchedCategory = "News/Quick Charge";
}
```

`includes("202")` matches any title containing a model year — "2024 Mustang Mach-E Review",
"2025 Ioniq 5 Road Trip" — and it is tested *before* the review and road-trip branches. On an EV
channel, model years are in a large share of titles, so this rule alone miscategorises a great
many reviews as news. The identical bug is in the sync classifier at `server/youtube.js:581`.

Anything reaching the final `else` is assigned `Other`, which is the second source of the "Other"
pile.

**Fix:** delete the ladder. A video the model could not classify should be left
`content_type = NULL`, `category_source = 'needs_review'`, and surfaced in a review queue. An
honest unknown is worth more than a confident wrong answer, and it makes the real accuracy
visible instead of hiding it behind guesses.

## A.7 "Other" is being used as an escape hatch

Its description is "Livestreams, announcements, and channel updates" — a narrow, specific
category. But it is the only obvious refuge when the model is unsure, so it absorbs everything
ambiguous.

**Fix:** rename it to something specific like "Livestreams & Channel Updates", state in the
prompt that it is only for those, and add the `confidence` field so unsure items route to a
review queue rather than to a real category.

## A.8 Minor but worth fixing

- `server/channel-health.js:179` selects `WHERE ... category_source != 'manual'`. In SQLite,
  `NULL != 'manual'` evaluates to NULL, which is falsy, so any row with a NULL
  `category_source` is silently skipped. There are none today **[verified]**, but this will bite
  the moment a column is added without a default. Use
  `COALESCE(category_source, '') != 'manual'`.
- There is no dry-run. A bulk reclassify overwrites 571 rows with no preview and no undo. Add a
  preview mode that shows the proposed changes, and record the previous value so a run can be
  rolled back.

## A.9 Suggested classifier prompt

Use with structured output, temperature 0, batches of 10 to 12, after the playlist pass.

```
You are classifying videos from "The Electric Duo", a two-person EV channel run by Patrick and
Liv, into exactly one content category each.

CATEGORIES — you must use one of these names exactly:
{name}: {description}
...

CLASSIFICATION RULES:
- Decide from what the video IS, not from a single keyword. A model year in the title does not
  make a video news. A review of a 2024 vehicle is a review.
- A vehicle deep dive, first look, walkaround, test drive, or hardware review is
  "Walkarounds/Reviews", even when it mentions news, price, or a model year.
- A dated news roundup or a reaction to an industry announcement is "News/Quick Charge".
- A journey with charging stops along a route is "Road Trip/Travel Series", even if the vehicle
  is being reviewed along the way. The journey is the spine of the video.
- Instructional content that teaches a repeatable task is "How Tos/Guides".
- "Sponsor Content" only when the video's primary purpose is a paid product feature, not when a
  sponsor is merely mentioned.
- "Other" only for livestreams, channel announcements, and channel updates. Do NOT use it as a
  fallback for videos you are unsure about.
- When two categories both fit, choose the one describing the video's main purpose, and lower
  your confidence.

For each video return:
- youtube_id: exactly as given
- category: exactly one of the category names above
- confidence: 0.0 to 1.0, how certain you are
- reason: at most 12 words naming the specific evidence you used

Classify every video in the list. Never omit one. Never invent an ID.

VIDEOS:
[1] ID: {youtube_id}
    Title: "{title}"
    Duration: {mm:ss}
    Tags: {tags}
    Description: "{first 500 chars of the REAL description}"
    Transcript opening: "{first 400 chars}"
```

Persist `confidence` and `reason` on the video row. Anything below about 0.7 goes to the review
queue instead of being written as fact, and the stored reason makes a wrong call diagnosable
instead of mysterious.

---

# PART B — EVERY PLACE THE APP INVENTS NUMBERS

Ranked by damage. Item 1 is considerably worse than what I described for Channel Health.

## B.1 Video Audit fabricates an entire analytics profile — and mislabels it as ground truth

`getCalibratedMetrics()` at `server/audit.js:55`. The comment at line 43 says it plainly:
"Deterministic seed helper for consistent metrics per video ID." Metrics are derived from
`hashString(youtube_id)`, so they never change between page loads. That stability is exactly what
makes them read as real.

**Click-through rate and impressions are fabricated even when OAuth is connected.** Lines 89-91:

```js
const ctrVariation = ((seed % 35) - 15) / 10;
const ctr = Math.max(2.8, Math.min(9.4, Number((benchmark.avgCtr + ctrVariation).toFixed(1))));
const impressions = Math.round(views / (ctr / 100));
```

There is no `isLive` check on either line, and neither is reassigned anywhere later in the file.
Every other metric has a live branch. These two do not.

**Then line 233 labels the block for the model:**

```js
PERFORMANCE METRICS (${metrics.isLiveStudioData ? "GROUND-TRUTH YOUTUBE STUDIO DATA" : "CALIBRATED METRICS"}):
```

So when you connect OAuth, the prompt tells Gemini the numbers are ground-truth Studio data while
the CTR and impressions inside it are a hash of the video ID. This is the single most damaging
line in the codebase. It converts a data gap into confident, specific, wrong advice.

Everything downstream of those two numbers is therefore meaningless:

- **The Discovery 2x2 Matrix** (prompt mandate 2, line 247) sorts the video into "Star Performer",
  "Packaging Problem", "Distribution Bottleneck", or "Topic Overhaul" purely on impressions and
  CTR. The quadrant is decided by a hash of the video ID.
- **`ctrDelta`** compares the fabricated CTR against a hardcoded 5.0% channel baseline.

**The 30-second hook drop is invented and the model is told to explain it.** Line 116 sets
`hookDrop = 22 + (seed % 14)`, a number between 22 and 35 taken from the video ID. Line 246 then
instructs: "Analyze whether the 30s hook drop-off was an intro issue or a mid-video pacing
bleed." The model is being asked to diagnose the cause of an event that did not happen. It will
always produce a fluent answer.

**The retention curve is invented, with narrative labels.** Lines 128-138 build ten points
labelled "30s Hook Gate", "Topic transition", "Core demonstration", "Mid-video / Sponsor read",
"Summary verdict". Those describe the structure of a video nobody watched. Note also that the
labels are hardcoded to a roughly 15-minute shape and are applied to every video regardless of
length, so a 40-minute road trip gets a "Summary verdict" label at 12:30.

**Always fake, with no live branch at all, even with OAuth connected:**

- `cardCtr` — `2.1 + (seed % 18) / 10` (line 183)
- `endScreenCtr` — `4.3 + (seed % 25) / 10` (line 184)
- `geography` — the constant `74% United States, 12% Canada, 6% United Kingdom, 8% Australia &
  Other` (line 190)
- `devices` — the constant `58% Mobile, 26% Connected TV, 14% Desktop` (line 196)
- `searchTerms` — the first three words of the title plus four hardcoded phrases including
  "mustang mach-e charging" and "ev road trip" (line 153)

**Fake only when OAuth is unavailable:** likes are `views × (0.035 + seed%20/1000)`, comments
`views × (0.005 + seed%10/1500)`, shares `views × 0.008`, subscribers gained
`views × (0.0035 + seed%15/2500)`, subscribers lost `subsGained × 0.12`.

All of this is persisted to `video_audits.metrics_json` at line 432, so it also becomes the
historical record.

**What to do:**

1. Delete every `seed`-derived metric. If a number is not measured, do not manufacture one.
2. Never send a fabricated figure into a prompt. Omit the line entirely and tell the model the
   metric is unavailable, so it says so instead of reasoning from noise.
3. Fix the label. `CALIBRATED METRICS` is a euphemism for simulated. If any simulated value
   survives, the header must read `SIMULATED — NOT REAL DATA`, and the `GROUND-TRUTH` label must
   never appear over a block containing one.
4. Remove the Discovery 2x2 Matrix until real impressions and CTR exist. Note that impressions
   and click-through rate are not exposed by the public YouTube Analytics API — verify against
   current docs, and if that still holds, this feature needs a manual Studio entry or a CSV
   import, not a formula.
5. Drop the hook-drop mandate, geography, devices, card CTR, end-screen CTR, and search terms
   from both the prompt and the UI until they have a real source.
6. Mark every card in the audit UI with its provenance: measured, entered by you, or unavailable.

## B.2 The live hook-drop calculation is also wrong

`server/audit.js:121` reads the 30-second point as `retentionCurve[2].pct`. But the live curve is
queried with `dimensions: "elapsedVideoTimeRatio"` at `server/youtube-analytics.js:232`, which
returns a *percentage-of-video* axis, not seconds. Index 2 is roughly 2% into the video. That is
about 10 seconds on an 8-minute video and about 48 seconds on a 40-minute one, and it is reported
as "30-Second Hook Drop-Off" in every case.

Related: the fake curve uses absolute timestamps (`"0:30"`, `"2:30"`, `"7:30"`) while the live
curve uses percentages (`"2%"`, `"50%"`). The same chart axis silently changes meaning between
the two modes.

**Fix:** interpolate the true 30-second point using the video's duration —
`ratio = 30 / durationSec` — or switch the whole feature to percentage-of-video and label it that
way. Make both modes emit the same axis type.

## B.3 Channel Health

Covered in the previous handoff and still accurate: the hardcoded `avgCtr = 5.3` and the
impressions figure derived from it, the hardcoded `suggestedShare.pctChange` of 1.5, per-category
CTR and retention assigned by matching the category *name* against strings, every top-performer
row stamped with `ctr: 5.4`, category trajectory decided by a lifetime-views threshold rather than
a trend, and `audienceShift.prior` as a hardcoded object.

Two additions from this pass:

- Real per-video retention is already being fetched and then discarded. The Analytics query at
  `server/channel-health.js:355` requests `averageViewPercentage` with `dimensions: "video"`, and
  line 522 overwrites it with the constant `48` whenever the API returns zero. Use the real value
  and show the metric as unavailable when it is missing.
- The category breakdown at line 480 currently matches zero videos because of the vocabulary
  mismatch in A.1. Fixing A.1 fixes this.

## B.4 Silent defaults that quietly enter the maths

These are small individually and misleading together, because none of them is visible in the UI.

- `server/competitor-comparison.js:11-12` — if subscriber counts fail to resolve, they default to
  24,800 for us and 100,000 for the competitor. The scale ratio is then computed from invented
  numbers and stated to the model as fact: "Competitor is ~4.0x our size." Every replicability
  flag keyed on the subscriber ratio inherits the error.
- `server/channel-health.js:314` — channel subscribers default to 24,700 when the API call fails.
- `server/youtube.js:587` — a video whose duration cannot be fetched is stored as `PT15M00S`.
  That is above the 240-second threshold, so unknown-duration Shorts are silently counted as
  long-form everywhere.
- `server/channel-health.js:10` and `server/competitor-comparison.js:140` — `parseDurationSec`
  returns 900 seconds for a missing or unparseable duration, again landing above the long-form
  threshold.
- `server/channel-health.js:418` — in the non-live path, a video with no view count is credited
  with 1,500 views.
- `server/audit.js:85` — a video with no view count is credited with 2,300 views.

**Fix:** make each of these return null and propagate the absence. A metric that cannot be
computed should be shown as unavailable, not filled with a plausible number. Where a default is
genuinely needed to avoid a divide-by-zero, set a flag on the result so the UI and the prompt can
both say the value is estimated.

## B.5 The competitor fallback narrative asserts opinions with no basis

`generateFallbackSummary()` at `server/competitor-comparison.js:90` runs whenever every Gemini
model fails. It returns prose stating that the competitor's strength is "their relentless clarity
around vehicle specifications and immediate real-world pricing" and that their long discussion
vlogs work because of audience scale. None of that is derived from the data. It is a hardcoded
opinion about a channel the function has not examined, wrapped around whichever outlier title
happens to be first.

**Fix:** on failure, state that the narrative could not be generated and render the structured
findings. Do not improvise.

## B.6 Hardcoded channel facts inside prompts

`server/audit.js:218` opens with "The Electric Duo (25K+ subscribers, premier EV channel)" and
line 236 states "Channel Baseline is 5.0%". Both are frozen constants inside a prompt. The
subscriber count is available live, and the CTR baseline should be a dated value you enter from
Studio, as recommended in the previous handoff.

---

# SUGGESTED ORDER OF WORK

1. **A.1** — unify the category vocabulary and migrate. Everything else depends on it.
2. **B.1** — strip the fabricated metrics from Video Audit and fix the `GROUND-TRUTH` label. This
   is the one actively producing wrong advice you might act on.
3. **A.5 and A.3** — playlist pass first, then honest failure reporting in the classifier.
4. **A.2 and A.4** — fetch real descriptions and tags, move to structured output with confidence.
5. **A.6, A.7, A.8** — delete the keyword ladder, add the review queue, add a dry run.
6. **B.3 and B.4** — Channel Health metrics and the silent defaults.
7. **B.2, B.5, B.6** — the remaining labelling and fallback fixes.
