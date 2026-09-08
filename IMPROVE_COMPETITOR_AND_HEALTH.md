# Handoff: Competitor Comparison + Channel Health improvements

Two goals: make the AI instructions for both pages user-editable from Admin Settings, and fix
the data problems that make the current output less useful than it looks.

---

# PART 1 — COMPETITOR COMPARISON

## 1.1 Where the instructions live today

`server/competitor-comparison.js`, function `generateExecutiveSummary()`, line 19. It is a
hardcoded JavaScript template literal. It is NOT stored in the database and NOT editable from
the UI. Model cascade is `gemini-3.7-flash` → `3.6` → `3.5` → `3.1-flash-lite` (line 55).
If every model fails, `generateFallbackSummary()` (line 90) returns a hand-written English
paragraph with the top outlier title spliced in — that fallback text is largely fabricated
opinion and should eventually be cut down.

## 1.2 The current prompt, verbatim

```
You are a YouTube growth consultant who has just reviewed two EV channels — "The Electric Duo"
(Patrick & Liv, ~{duoSubs} subscribers) and "{competitorTitle}" (~{compSubs} subscribers).

You have the structured analysis below. Write your findings as if you're talking directly to
the creator (Patrick & Liv): direct, opinionated, conversational, and grounded.

STRUCTURE YOUR FINDINGS EXACTLY AS FOLLOWS:

1. A 2-3 sentence bottom line — what's the single biggest thing this competitor does that's
   worth learning from, and why.

2. "What to learn from them" — 2-4 specific, concrete takeaways, each explained in plain
   language (why it worked, not just that it worked). Reference specific videos by title when
   useful, but don't dump the underlying numbers into the sentence — the reasoning should read
   like insight, not a citation.

3. "What NOT to copy" — 2-3 things that worked for them but likely won't transfer (scale
   advantages, a format that doesn't fit our channel, a one-off news event, resources we don't
   have). Be specific about WHY it won't transfer, not just that it's flagged.

4. One honest caveat or blind spot in this analysis itself (e.g. "we can't see their retention
   data, so this is packaging-only evidence").

WRITING RULES:
- Write like you're explaining it to a smart friend over coffee, not filing a dense corporate
  report.
- Avoid restating percentages, view counts, or multipliers in every sentence — use them
  sparingly, only where the number itself is the point (e.g. "this got 4x their normal views"
  is fine once).
- Do NOT invent numbers — reference the findings already calculated below.
- Do NOT include any email/memo headers like "TO:", "FROM:", "DATE:", "SUBJECT:", or
  "+---+---+" ASCII tables.

STRUCTURED ANALYSIS DATA FOR CONTEXT:
- Scale Ratio: Competitor is ~{ratio}x our size.
- Upload Cadence: Duo {n} videos/mo (avg length: {mm:ss}) vs Competitor {n} videos/mo
  (avg length: {mm:ss}).
- Statistical Outliers (>= 3.0x baseline):
  1. "{title}" (Multiplier: {x}x, Replicability: {flags}, Diff: {packagingDiff})
  ... up to 6
- Underperformers / Anti-patterns (< 0.6x baseline):
  1. "{title}" (Multiplier: {x}x, Diagnosis: {antiPatternDiagnosis})
  ... up to 4
- Topic Distribution:
  • {topic}: Duo {n}% vs Competitor {n}%
  ... 6 fixed topics
```

## 1.3 Data the model actually receives

Only what appears above: subscriber ratio, cadence, average duration, six outliers, four
underperformers, and the six-bucket topic split.

**Bug worth fixing first.** `computeSideBySideSummary()` also computes `titlePatterns` for both
channels — top keywords in each channel's top view quartile, average title character length,
and the percentage of top titles containing a number. It is stored in `analysis_json` and shown
in the UI, but it is never passed into the prompt. The model is being asked to comment on
packaging while the packaging data is withheld.

Also not passed: thumbnails, descriptions, publish day and time of day, likes and comments per
view, and video age. Every outlier is compared on views alone.

## 1.4 Is it easily modified? Yes

The project already has the exact pattern for this. `title_prompt_settings` is a single-row
table with one TEXT column per editable prompt (`instructions`, `thumbnail_instructions`,
`description_instructions`, `chapter_instructions`), a GET/PUT pair at
`server/app.js:1007` and `:1017`, defaults seeded in `server/db.js:411`, and a textarea per
prompt in the Terms tab of `frontend/src/AdminSettings.jsx` around line 1483.

**Task:** add two more columns the same way — `competitor_instructions` and
`channel_health_instructions` — via `addColumnIfNotExists` alongside `server/db.js:301-303`,
seed them with the defaults below, extend the existing GET/PUT payload, and add two textareas
to the same Admin Settings tab. Then have `generateExecutiveSummary()` read the column and fall
back to the seeded default when it is blank. Do not build a second settings system.

Keep the structured data block assembled in code. Only the instruction half should be editable,
so a bad edit can never break the data injection.

## 1.5 Suggested replacement instructions

```
You are a YouTube growth strategist advising "The Electric Duo" — Patrick and Liv, a two-person
EV channel. You have been handed a structured comparison against one competitor channel. Write
to Patrick directly.

Your job is to find things we can act on in the next 30 days. A takeaway we cannot execute with
two people, one camera setup, and our current subscriber base is not a takeaway.

STRUCTURE:

1. BOTTOM LINE — 2-3 sentences. The single most important pattern in this competitor's results,
   and what it implies for us.

2. WHAT TO LEARN — 2 to 4 items. For each one: name the pattern, name the specific video or
   videos that show it, explain the mechanism (why this made someone click or keep watching),
   and give one concrete thing we could do on a video in the next month.

3. WHAT NOT TO COPY — 2 to 3 items. Each must name the specific reason it will not transfer:
   audience scale, a one-time news event, production resources we do not have, or a format that
   conflicts with our channel. If a video is flagged with a scale-advantage replicability flag,
   treat it with suspicion.

4. WHERE WE ARE ALREADY AHEAD — 1 to 2 sentences. Something our own numbers show we do better,
   or that we should keep doing rather than change.

5. CONFIDENCE AND BLIND SPOTS — 2 to 3 sentences. State plainly what this analysis cannot see.
   We have no retention, click-through, or impression data for the competitor. Everything here
   is inferred from public view counts and packaging. Say so, and name any conclusion above that
   is weaker than the others.

RULES:
- Ground every claim in the data block below. Never invent a number, a video title, or a date.
- If the data is too thin to support a section, say the data is too thin. Do not fill space.
- Multipliers are relative to each channel's own baseline. Never compare our raw view counts to
  theirs and never suggest we should be hitting their absolute numbers.
- Use a number only when the number itself is the point. At most one per bullet.
- Plain, direct prose. No memo headers, no ASCII tables, no closing summary paragraph.
- Do not congratulate, hedge, or pad. If something is not working, say it is not working.
```

## 1.6 Other Competitor Analysis improvements, in priority order

**1. Keep history — this is the highest-value change.** `generateComparisonReport()` at
`server/competitor-comparison.js:1032` looks up an existing row by `competitor_channel_id` and
UPDATEs it in place, then deletes and reinserts the video rows. Re-running against the same
competitor destroys the previous report permanently. There is one row per competitor forever.

Change the upsert to an insert, so `competitor_reports` becomes an append-only run log keyed by
`(competitor_channel_id, created_at)`. Add a `report_label` column so a run can be named. Add a
run picker to the report header and a "compare to previous run" view. Optionally add a retention
policy so a competitor keeps its most recent N runs.

Once history exists, feed the previous run into the prompt and add a "What changed since last
time" section — new outliers, topics they moved into or abandoned, cadence shifts. Change over
time is far more actionable than a single snapshot.

**2. Pass the packaging data you already compute.** Add `sideBySide.titlePatterns` to the data
block for both channels. One extra template line, and it directly serves the packaging advice
the prompt is asking for.

**3. Add engagement rate.** `competitor_videos` already stores `like_count` and `comment_count`.
Compute likes-per-1000-views and comments-per-1000-views per channel and per outlier. A video
with a high view multiplier but a low engagement rate probably won on the thumbnail and lost the
viewer, which is exactly the "packaging vs substance" distinction the outlier profiles claim to
make but cannot currently support.

**4. Normalize for video age.** A video published three weeks ago is being compared against one
published eleven months ago on total views. Either restrict outlier detection to a fixed age
window, or estimate views-per-day-since-publish and flag any outlier under about 30 days old as
"still accumulating."

**5. Add publish timing.** You already store `published_at`. Day-of-week and hour-of-day
distribution for each channel's top quartile is cheap to compute and often reveals a real
cadence difference.

**6. Replace the hardcoded topic buckets.** `clusterTopics()` at line 800 is six fixed regex
rules over lowercased titles. Anything unmatched lands in "Other / Miscellaneous," which quietly
inflates. Either surface the bucket definitions in Admin Settings as editable keyword lists, or
have Gemini classify the titles in one batch call the way `bulkReclassifyLibrary()` already does
for your own catalog.

**7. Track more than one competitor at a time.** With history in place, a rollup across all
tracked competitors — which topics are gaining across the whole category, not just on one
channel — is a genuinely different and more useful report.

**8. Trim the heuristic fallback.** `generateFallbackSummary()` asserts specific strategic
opinions ("their relentless clarity around vehicle specifications") that are not derived from
any data. When Gemini is unavailable it should say the narrative could not be generated and show
the structured findings, not improvise.

---

# PART 2 — CHANNEL HEALTH

## 2.1 Correction to the assumption: there is no AI here

Channel Health does not call an AI model to write a report. `getChannelHealthReport()` at
`server/channel-health.js:305` returns pure computed metrics, and `frontend/src/ChannelHealth.jsx`
renders them. There is no narrative to edit.

The only AI in `server/channel-health.js` is the bulk video classifier at line 205, which assigns
each video a content category. That prompt is:

```
You are an expert YouTube content classifier for "The Electric Duo" (EV enthusiast channel).
Categorize each of the following videos into EXACTLY ONE of these categories:
{categoryDescriptions}

VIDEOS TO CLASSIFY:
[1] ID: {youtube_id} | Title: "{title}" | Desc: "{first 150 chars of description}"
... 25 per batch

Return a JSON array of objects with "youtube_id" and "category" (MUST match one of: {names}).
Return ONLY valid JSON.
```

That one is already partly editable, since the category names and descriptions come from the
`categories` table, which the Category Manager writes to. Editing a category description changes
classifier behavior today.

## 2.2 Fix the fabricated numbers before adding an AI narrative

This is the most important item in this document. Several figures on the Channel Health page are
hardcoded constants presented as measurements, and an AI narrative built on top of them would
launder invented numbers into confident-sounding advice.

- `server/channel-health.js:431` — `const avgCtr = 5.3;` The "Channel Avg CTR" card is a
  constant. Its `pctChange` is hardcoded to `0.0`.
- `server/channel-health.js:432-433` — Impressions are computed as `views / (5.3/100)` for both
  the current and prior period. The Impressions card is therefore just the Views card multiplied
  by 18.9, and its percent change is mathematically identical to the Views percent change.
- `server/channel-health.js:471` — `suggestedShare.pctChange` is hardcoded to `1.5`.
- `server/channel-health.js:486-487` — Per-category CTR and retention are assigned by matching
  the category *name* against strings. A category whose name contains "Road" is given 54%
  retention; everything else gets 46%. These are not measurements of anything.
- `server/channel-health.js:522` — Every video in the Top Performers table is given `ctr: 5.4`.
- `server/channel-health.js:497` — Category `trajectory` (up/flat/down) is decided by lifetime
  total views crossing 100,000 and 30,000. It is a size threshold, not a trend, so a large old
  category can never show "down" and a new one can never show "up."
- `server/channel-health.js:570` — `audienceShift.prior` is the literal object
  `{browse: 52, suggested: 30, search: 12, other: 6}`, so every traffic-shift arrow on the page
  is measured against a constant.
- `server/channel-health.js:419-427` — When the Analytics API is unavailable, watch hours become
  `views * 0.12`, net subscribers become `views * 0.0035`, and retention becomes `48.2`, with no
  visible indication that the page has switched to invented data. `isLiveStudioData` is returned
  but the fallback numbers look identical to real ones.

**What to do:**

Impressions and click-through rate are not exposed by the public YouTube Analytics API v2 —
they are YouTube Studio figures. Confirm this against current API docs before building, because
if a metric has since been added, pulling it is the right fix.

Assuming it is still unavailable, take the honest path instead:
1. Remove the derived Impressions card, or move it behind an explicit "Estimated" label that
   states the CTR assumption inline.
2. Make channel average CTR a value you enter in Admin Settings from Studio, dated, rather than
   a constant buried in code. `competitor_reports` already stores `our_ctr_benchmark`, so the
   concept exists — reuse it.
3. Derive per-category CTR and retention from the real per-video Analytics rows you already
   fetch, aggregated by `content_type`. You are querying `dimensions: "video"` with
   `averageViewPercentage` at line 355, so real per-video retention is already in hand and is
   simply being overwritten by the constant at line 522.
4. Fix `trajectory` to compare the category's views in the current period against the prior
   period, not against a fixed threshold.
5. Fix `audienceShift.prior` by running the existing traffic-source query a second time against
   the prior date range, the same way the scorecard already queries both periods.
6. Make the fallback path visually obvious — a banner, and either grey out or omit any metric
   that is estimated rather than measured.

## 2.3 Then add a Channel Health narrative

Once the numbers are real, add a Gemini narrative to `getChannelHealthReport()` mirroring the
competitor pattern: a `channel_health_instructions` column in `title_prompt_settings`, seeded
default below, editable in the same Admin Settings tab, rendered at the top of the Channel
Health page with a Regenerate button. Reuse the same model cascade.

Suggested default instructions:

```
You are a YouTube channel analyst reviewing "The Electric Duo" — Patrick and Liv, a two-person
EV channel. You have this channel's own analytics for the reporting period below, plus the
prior period for comparison. Write to Patrick directly.

Your job is to say what changed, whether it matters, and what to do about it. Distinguish
clearly between normal fluctuation and a real signal.

STRUCTURE:

1. HEADLINE — 2-3 sentences. Is the channel up, flat, or down this period, and what is driving
   it? Name the one metric that matters most right now.

2. WHAT'S WORKING — 2 to 3 items, each tied to a specific video or category. Say what the
   pattern is and what it suggests we should do more of.

3. WHAT NEEDS ATTENTION — 2 to 3 items. Be specific and unsentimental. Name the video or
   category, the metric that is soft, and the most likely cause. If a video underperformed on
   views but held retention, say so — that is a packaging problem, not a content problem, and
   the reverse is also true.

4. THIS PERIOD'S ONE EXPERIMENT — a single, concrete thing to try on the next upload, and the
   metric that would tell us within two weeks whether it worked.

5. DATA CONFIDENCE — 1 to 3 sentences. State which figures are measured and which are
   estimated. Never present an estimated figure as measured.

RULES:
- A short period is a small sample. Do not read a trend into two videos.
- Distinguish a metric moving because performance changed from a metric moving because the
  upload count changed.
- Never invent a number, a video title, or a date. If something is missing, say it is missing.
- Compare against our own prior period only. Do not reference other channels' absolute numbers.
- Plain, direct prose. No memo headers, no ASCII tables, no closing pep talk.
```

Pass it: the full scorecard with both periods, the category breakdown with real per-category
metrics, top and bottom performers with views and retention, traffic-source split for both
periods, the number of videos published in each period, and an explicit list of which fields are
estimated rather than measured.

## 2.4 Other Channel Health improvements

**1. Use the snapshot history you already capture.** `captureSnapshot()` at line 264 writes to
`channel_snapshots` and `video_snapshots`, and `server/db.js:248` indexes them by date, but
`getChannelHealthReport()` never reads them. It only queries the live API for the current and
prior period. Reading the snapshot table would give you real multi-period trend lines, per-video
velocity since publish, and a chart rather than a pair of numbers. Confirm whether the snapshot
job is actually running on a schedule — if not, that comes first.

**2. Store health reports as history.** Same argument as the competitor reports. A
`channel_health_reports` table holding the scorecard JSON plus the generated narrative per run
lets you scroll back through past periods and diff the advice. Add a period selector so 7, 28,
90, and 365 day views are all retained rather than recomputed and lost.

**3. Add a per-video velocity view.** With `video_snapshots` populated, "views in the first 7
days" is the single most useful number for judging a new video, and it is far better than
lifetime views for spotting what is actually working right now.

**4. Fix the Shorts boundary.** Everything under 240 seconds is filtered out as a Short. YouTube's
actual Shorts limit is 3 minutes as of late 2024, and a genuine 3.5 minute long-form video is
currently being dropped from every calculation on the page. Consider using the real Shorts flag
where available rather than a duration threshold.

**5. Annotate the timeline.** A `timeline_annotations` table already exists at `server/db.js:195`
and appears unused here. Surfacing annotations on the health charts would let a spike be
explained rather than guessed at, and those annotations could be passed to the narrative model
as context.
