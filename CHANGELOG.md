# Changelog

All notable changes to The Electric Duo Command Center (`cc.theelectricduo.com`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.4.8] - 2026-09-13

### Added
- **Per-Video Impressions & Impressions CTR via YouTube Reporting API**:
  - Connected the Video Audit module directly to Google's official `channel_reach_basic_a1` reports from the YouTube Reporting API, eliminating the previous "YouTube Studio only" placeholder.
  - Added `getVideoReachSummary(videoId)` in `server/youtube-reach.js` to compute authentic lifetime measured impressions (`SUM(impressions)`) and view-weighted CTR (`ROUND(SUM(impressions * impressions_ctr) * 100.0 / NULLIF(SUM(impressions), 0), 2)`) for individual videos.
  - Video audits now inject authentic impressions and CTR into `metrics.impressions` and `metrics.ctr`.
  - Unlocked the **Discovery 2x2 Performance Matrix**: Gemini now receives authentic impressions and CTR and classifies videos into their real quadrant (Star Performer, Packaging Problem, Distribution Bottleneck, or Topic/Packaging Overhaul), highlighting the active quadrant and generating tailored strategy recommendations.
  - Added automated nightly sync of reach reports into the scheduler (`server/media-kit-scheduler.js`, Job A), plus opportunistic sync during manual audit refreshes.
  - Updated `AuditReportModal.jsx` metric cards, status pills, and empty states to label verified reach data as `Reporting API` and clearly explain Google's daily batch compilation when awaiting reach reports.

## [2.4.7] - 2026-09-13

### Fixed
- **Video Audit Analytics Status vs 48–72h Ingestion Lag**:
  - Fixed a misleading UX state where recently published videos (under ~48–72 hours old) falsely displayed "Analytics Not Connected", "Not connected" pills, and suggested reconnecting in Admin Settings even though OAuth was properly authenticated.
  - YouTube's Analytics API (`reports.query`) runs on an aggregation delay of 48–72 hours for video-level queries and returns all zeroes or empty rows for recent uploads before data settles. The audit engine now distinguishes between OAuth being genuinely disconnected (`isOAuthConnected: false`) versus a video awaiting YouTube's analytics processing pipeline (`isOAuthConnected: true` with pending video data).
  - When OAuth is connected but video data is still in processing, the audit header displays a cyan "Awaiting Video Data" badge with clear tooltips, metric cards display "Awaiting data" instead of "Not connected", and section fallbacks explain the 48–72h processing window rather than prompting the user to visit Admin Settings.
  - Added safe date query fallback in `server/youtube-analytics.js` (`querySafe`) that automatically retries with yesterday's date if timezone or date-boundary validation rejects today's date.
  - Added user-facing toast notifications when manual audit refresh fails, avoiding silent fallback to stale cached reports.

## [2.4.6] - 2026-09-13

### Added
- **Per-Video Viewer Satisfaction Score (Video Audits)**:
  - New card on the Core Performance tab of each video's audit report, showing the same disclosed 0-100 composite score as the Channel Health page, computed from that single video's own measured retention, engagement rate, and net subscriber conversion.
  - Extracted the scoring formula into a new shared module, `server/satisfaction-score.js`, so Channel Health and Video Audits can never drift out of sync on methodology or ceilings.
  - Uses the video's raw measured likes/comments/shares/subscriber counts rather than the display-oriented variables elsewhere in the audit (which coerce a genuine zero into "unavailable"), so a real zero-engagement result scores correctly instead of being silently dropped.
- **Mid-Video Retention Cliff Detection, Correlated With the Transcript**:
  - New analysis alongside the existing 30-second hook check: scans the full retention curve (excluding the first minute, which the hook check already covers) for the steepest decline anywhere in the video, using a rolling 5%-of-video window to avoid single-sample noise.
  - When a significant drop (5+ points) is found, pulls the actual timestamped transcript (SRT, not the timestamp-free plain text used elsewhere) for that exact moment and feeds it to Gemini, producing a grounded diagnosis and a specific fix tied to what was actually being said, not just a retention percentage.
  - New "Mid-Video Retention Cliff" card on the Retention & Hook Diagnosis tab shows the timestamp range, the quoted transcript segment, and the AI's diagnosis and fix; the retention curve chart now highlights the drop window directly on the graph.
  - Audits generated before this feature was added are labeled as such (rather than misreported as "no cliff found") and prompt the user to refresh the report.

---

## [2.4.5] - 2026-09-12

### Fixed
- **Channel Health Scorecard Silently Included Shorts**:
  - The main "Total Views," "Watch Time (Hours)," "Avg % Viewed," and "Net Subscribers" tiles at the top of Channel Health were computed from a raw, unfiltered channel-wide YouTube Analytics query — Shorts and Live included — even though the page is headed "Long-form content (excludes < 4 min Shorts)."
  - Replaced that query with the same long-form-only (`creatorContentType==video_on_demand`) query already added for the Viewer Satisfaction Score in v2.4.4, so both sections now derive from one consistent, correctly-scoped data source. The "Avg % Viewed" scorecard tile and the Satisfaction Score's retention component now always agree, instead of silently disagreeing depending on how much Shorts activity happened to occur in the window.
  - This also removed two redundant Analytics API calls per page load (the old unfiltered current/prior period queries), since the long-form query already covers everything the scorecard needs.

---

## [2.4.4] - 2026-09-12

### Added
- **Viewer Satisfaction Score (Channel Health)**:
  - New card on the Channel Health page, directly below the period scorecard, showing a composite 0-100 score built from three long-form-only signals YouTube has publicly tied to viewer satisfaction: average percentage viewed, engagement rate (likes+comments+shares per view), and net subscriber conversion per view.
  - Each component is capped at a disclosed 100-point ceiling (50% retention, 6% engagement rate, 1% net subscriber conversion) and averaged; a net subscriber loss floors at 0 rather than scoring negative. The full methodology is shown in-app (a hover tooltip on desktop, inline text on mobile).
  - Sourced via YouTube's own `creatorContentType==video_on_demand` classification (the same fix applied to the Media Kit in v2.4.3), so Shorts and Live content cannot blend into the score — it does not depend on the local video catalog's duration data being complete.
  - Headline score is color-banded (emerald/amber/red) and shows a point-change delta against the prior comparable period; each of the three components renders using the existing scorecard tile style, with its own prior-period trend.
  - Explicitly labeled as a disclosed proxy, not an official YouTube metric — YouTube never exposes its internal viewer-satisfaction survey score to creators.

---

## [2.4.3] - 2026-09-12

### Fixed
- **Engagement Rate & Long-Form Audience Stats Silently Blending In Shorts**:
  - The "Engagement Rate" and "Avg % Viewed" figures, and the underlying Top Markets, Age & Gender, Device, Subscriber Status, and Traffic Source breakdowns, were falling back to raw channel-wide totals (Shorts and Live included) whenever the local video catalog's long-form matching came up empty — while the card stayed labeled "Long-Form."
  - Confirmed against live YouTube Analytics data for the same 90-day window: true long-form (video-on-demand) engagement rate was 3.80%, versus the 2.22% shown, because Shorts (0.54% engagement rate) were being blended into the total.
  - Replaced the local-duration-based video whitelist with YouTube's own `creatorContentType` classification (`video_on_demand`) as the primary filter across all six sections. This is authoritative and no longer depends on the local video catalog's `duration` field being complete or fresh.
  - Removed the unfiltered channel-wide fallback entirely. A section now renders blank rather than silently mixing in Shorts/Live data if long-form data can't be retrieved.
  - Added an explicit unlisted/private video exclusion (from the local catalog's `privacy_status`) on top of the content-type filter, since YouTube Analytics has no privacy-status filter of its own.
  - Widened the local duration-based whitelist (used only as a secondary fallback) from the top 25 to the top 200 highest-viewed long-form videos for better coverage in the rare case it's needed.

---

## [2.4.2] - 2026-09-12

### Added
- **New Section: Featured In**:
  - Compact horizontal strip highlighting media coverage (outlet name, article title, URL, outlet logo) directly below the Reach section.
  - Includes an optional Industry Recognition line for awards and journalistic honors.
  - Backed by manual data array seeded completely empty; renders nothing if unpopulated.
- **New Section: Meet the Duo**:
  - Two-column biographical showcase for Patrick and team with photo, name, role line, bio paragraph, credential list, and external links.
  - Seeded completely empty with placeholder labels.
  - Hardened with `break-inside: avoid` to guarantee bio cards are never split across pages in print.
- **New Section: Event & Trade Show Coverage**:
  - Dense credibility inventory directly after "Beyond the Channel" detailing major auto shows covered, industry trade events attended, on-site booth/launch coverage scope, and speaking/panel appearances.
  - Backed by manual data seeded completely empty; renders nothing if unpopulated.
- **New Section: Website Resources**:
  - Evergreen tools and guides on `theelectricduo.com` rendered cleanly within "Beyond the Channel".
  - Seeded completely empty; renders nothing if unpopulated.
- **New Proof Block: Who We Reach**:
  - Two-column audience breakdown (Primary: EV Owners & Near-Term Buyers; Secondary: Home Energy & Smart Home) positioned directly after Content Pillars bars.
  - Live aggregate proof stats (lifetime views and video counts) computed directly from the snapshot based on a configurable pillar-to-audience mapping.
  - Configurable in the manual edit drawer: defaults all pillars to Primary except "Solar & Home Energy", which defaults to Secondary.

### Changed & Refined
- **Audience Reach Trailing 12 Complete Months Stat Block**:
  - Replaced the 12-month bar chart component and "Consistent Monthly Video View Progression" heading with a clean, factual Audience Reach stat block.
  - Strictly queries the 12 most recently complete calendar months relative to the effective end date, excluding the current partial month.
  - Verifies exactly 12 month entries before computing total views and average monthly views (rounded to the nearest thousand).
  - Synchronized this figure with the "Monthly Views" card in the Reach section.
  - Preserved the raw 12-month series in the snapshot JSON for historical trend analysis across snapshots.
- **Removed Industry Standing / Professional Credentials Section**:
  - Deleted Column 3 from "Beyond the Channel" so credentials live cleanly within the new Duo member bios.
- **Manual Data & Seeding**:
  - All new manual fields seed completely empty with placeholder labels and zero fabricated content.
  - Sections with no entered data render `null`, completely eliminating empty container shells and orphaned headers.
- **Print Layout Hardening**:
  - Enforced `break-inside: avoid` on duo cards, featured in strip, reach stat block, and event lists, ensuring clean multi-page pagination targeting 4 to 6 pages.

---

## [2.4.1] - 2026-09-12

### Changed & Refined
- **Prominent Audience Survey Showcase & Custom Data Editor**:
  - Featured high-value audience purchasing power stats prominently at the top of the Media Kit (88% EV owners/lessees, 94% committed next-EV buyers, 82% home charging/solar installed).
  - Added dedicated editor in the "Edit off-platform data" drawer to customize survey percentages, labels, and citation source.
- **Audience Engagement & Who is Watching for Long Videos Only (≥ 4 Min)**:
  - Sourced trailing 90-day views, watch hours, average view duration, average view percentage, and engagement rate strictly from published long-form videos (≥ 240s) via per-video reports.
  - Filtered demographic and intent queries to long-form video catalogs.
- **Fixed Monthly Views & Annual Watch Hours Blank State**:
  - Resolved YouTube Analytics API month-boundary validation error by querying daily intervals (`dimensions=day`) and aggregating into clean calendar months in JavaScript.
  - Rendered interactive 12-Month Audience Growth Curve on the Media Kit dashboard.
- **Corrected Non-Subscriber Reach Calculation**:
  - Fixed case-insensitive mapping for `subscribedStatus` to correctly capture all unsubscribed viewers instead of reporting 0%.
- **Sales-Focused Media Buyer Language & Rebranding**:
  - Reframed 28-day stats into sponsor-friendly language: *"Expected 30-Day Reach per Video: 2,100 – 4,800 views"*.
  - Replaced internal algorithmic labels with sponsor value copy: *"Evergreen Search Value: High sustained views from active buyers researching specific models"*.
  - Renamed "Verified YouTube Subscribers" to "YouTube Subscribers", and "Verified Editorial Credentials" to "Professional Credentials".
  - Replaced "Rolling trailing window" with dynamic quarter label (e.g. *"Q3 2026"*).
- **Consolidated 4 Primary Content Pillars**:
  - Re-grouped micro-categories into 4 core programming pillars: *Vehicle Reviews & First Drives*, *Road Trips & Real-World Range Tests*, *EV Charging & Energy Tech*, and *Industry News & Events*.
- **Demographics & Geographic Refinements**:
  - Collapsed raw age brackets to highlight prime buying power: 78.4% aged 25–64 (and 63.9% aged 25–54).
  - Translated two-letter ISO country codes into full country names and excluded India (`IN`) from top geographic automotive markets.
  - Replaced generated fluff with real measured device percentage splits.
- **Print Layout & Recent Work Pagination Fixes**:
  - Restricted Recent Work to published long-form videos with > 2,000 views.
  - Fixed Recent Work grid to 3-across with 16:9 thumbnails and added `break-after: avoid` on section headers and `break-inside: avoid` on the grid container, eliminating multi-page overflow on printed Letter PDFs.

---

## [2.4.0] - 2026-09-11

### Added
- **Partnership Media Kit Module (`/media-kit`)**:
  - Added dedicated, high-impact sales document designed specifically for prospective sponsors and automotive brand partners.
  - Sourced completely from cached snapshot data (`media_kit_snapshots`) with zero live API calls on page load for instant rendering.
  - Adheres strictly to the sales document principle: displays no diagnostic flags, no period-over-period deltas, no underperforming videos, and renders missing metrics as clean em dashes (`—`) without fabricating numbers.
  - Integrated into the top-level **Analytics** navigation group across desktop dropdown and mobile drawer menus.
- **Automated Snapshot Background Jobs & Cron Scheduling**:
  - Implemented `node-cron` with `America/Los_Angeles` timezone:
    - **Job A (Nightly 3:00 AM)**: Captures closed 28-day and 365-day view windows for public long-form videos ($\ge 240$ seconds) into `video_28day_views`.
    - **Job B (Weekly Monday 4:00 AM)**: Computes comprehensive metrics snapshot, appends to `media_kit_snapshots`, and prunes history to the most recent 24 rows.
  - Added non-blocking asynchronous snapshot generation for on-demand **"Refresh now"** with real-time job status polling (`GET /api/media-kit/snapshot/status/:jobId`) to avoid proxy timeouts.
  - Implemented one-off throttled CLI backfill utility (`scripts/backfill-28day-views.js`).
- **Reporting Lag & Data Integrity Engine**:
  - Standardized all YouTube Analytics query date ranges to end 3 days before run date ($T - 3\text{d}$) to eliminate incomplete metric reporting.
  - Sourced video performance and retention directly from trailing 90-day per-video queries (`dimensions=video, metrics=views,averageViewPercentage`).
  - Computed 28-day median, 25th, and 75th percentiles across the trailing 12 months, and calculated evergreen long-tail multiples (`views_365d / views_28d`).
  - Aggregated Content Pillars based on qualified video categories ($\ge 4$ videos and $\ge 10{,}000$ views) with proportional visual bar widths.
- **Editable Off-Platform Information & Partner Logos**:
  - Added interactive **"Edit off-platform data"** drawer to manage email newsletter counts, cross-platform social followings (Facebook, Instagram, Threads), EV club network reach, editorial standing bullets, and case studies.
  - Stored partner logo uploads directly on disk under `public/uploads/media-kit/` with a 100KB size cap.
- **Dedicated Print & PDF Route (`/media-kit/print`)**:
  - Designed print stylesheet with Letter page size, forced color printing (`-webkit-print-color-adjust: exact`), automatic card page-break prevention (`break-inside: avoid`), stripped app chrome, and automated `window.print()` trigger.

---

## [2.3.7] - 2026-09-11

### Fixed
- **Channel Health & Benchmarks Impressions CTR Calculation**:
  - Corrected weighted Impressions CTR calculation from YouTube Reporting API (`video_reach_daily`). The API provides `video_thumbnail_impressions_ctr` as a decimal ratio (0..1); multiplied by `100.0` in the weighted sum aggregate so CTR correctly formats as a percentage (e.g. `5.x%` instead of `0.05%`).
  - Fixed weighted CTR calculation in `server/youtube-reach.js` (`getChannelReachSummary`) used by the Channel Health scorecard and AI narrative briefing.
  - Fixed weighted CTR calculation in `server/competitor-comparison.js` (`getReportingApiCtr`) used for competitor comparison benchmarks and baseline reporting.
  - Added unit suffixes (`%`, `h`) in `server/channel-health.js` prompt data block formatting to ensure the AI narrative generator receives clear unit context.

---

## [2.3.6] - 2026-09-08

### Added
- **Editable Video Audit Strategic Prompts (Admin Settings → AI Models & Prompts)**:
  - Exposed the Video Audit diagnostic prompt in Admin Settings under **AI Models & Prompts** (as well as Section B of Title Strategist settings).
  - Editorial directors and admins can now view, customize, and save the exact strategic instructions given to Gemini during video evaluations (including hook retention drop-off critique, packaging assessment, alternative concepts, and prioritized action items).
  - Added a dedicated **"Video Audit"** tab pill with character and word counters and a factory **"Reset to Default"** action.
  - Added `audit_instructions` column to `title_prompt_settings` in SQLite with guarded migration and automatic seeding from `DEFAULT_AUDIT_PROMPT_INSTRUCTIONS`.
  - Updated `server/audit.js` to dynamically load `audit_instructions` while keeping metadata injection, transcript excerpts, measured metrics, and JSON response schema safely protected.

---

## [2.3.5] - 2026-09-08

### Added
- **AI System Prompts & Instructions Management (Admin Settings → AI Models & Prompts)**:
  - Added full prompt inspection and editing interface under the AI Models & Prompts tab.
  - Enables viewing and editing prompts for:
    - **Competitor Comparison**: Strategic executive summary and comparison briefing instructions.
    - **Channel Health Narrative**: 30-day channel diagnostic narrative instructions.
    - **Video Title Ideas**: Creative direction and structure for AI title generation.
    - **Thumbnail Words**: 3-4 word thumbnail text overlay instructions.
    - **Video Description**: Structured YouTube description copy generation instructions.
    - **Video Chapters**: Timestamp & chapter label generation instructions.
  - Added individual **"Reset to Default"** action buttons backed by `GET /api/title-prompt-settings/defaults`.
  - Added live character and word counters and unified **"Save All Prompts"** persistence.
- **Competitor Comparison "Our CTR" Reporting API Integration**:
  - Automatically queries view-weighted CTR from the YouTube Reporting API (`video_reach_daily`).
  - Added `GET /api/comparison/channel-benchmarks` to serve real measured CTR and default benchmarks.
  - Pre-populates the "Our CTR" input placeholder with the authentic Reporting API rate while preserving user manual entry and custom overrides.

### Fixed
- **Competitor Comparison Channel Logos & Avatars**:
  - Attached official high-resolution channel logo (`thumbnailUrl`) to `analysis.duoChannel` and updated the frontend to render The Electric Duo's logo with fallback badge.
  - Removed broken `mqdefault.jpg` fallback and implemented direct YouTube web scraper extraction (`ytInitialData` view models) for competitor avatars.
  - Added `referrerPolicy="no-referrer"` to all competitor channel logos, avatar images, and video thumbnails to prevent Google CDN hotlink blocking (`403 Forbidden`).
- **Competitor Report Refresh 500 Error**:
  - Fixed channel scraper in `resolveChannel()` when YouTube API quota is exceeded. Channel IDs (`UC...`) now correctly target `https://www.youtube.com/channel/UC...` instead of invalid `@UC...` URLs that resulted in 404s and a 500 error.
  - Updated `POST /api/comparison/reports/:id/refresh` to pass `report.competitorHandle || report.competitorChannelId`.

---

## [2.3.4] - 2026-09-08

### Added
- **Re-categorize Video Library "Save All" & AI Acceptance Workflow**:
  - Added a prominent **"Save All"** button in both the header and footer of the Re-categorize Video Library modal.
  - Automatically saves all manually adjusted categories as `category_source = 'manual'` and accepts all remaining AI-categorized videos (`category_source = 'ai_inferred'`) as verified manual entries in an atomic transaction.
  - Added **Source Filter Tabs** (`All Videos`, `🤖 AI Tagged`, `⚠️ Needs Review`, `✓ Manual`, `📦 Migrated`) with live record counts.
  - Automatically defaults to the `🤖 AI Tagged` view when opened from the review flag banner or when unreviewed AI tags exist.
  - Staged manual overrides in the UI with visual `✏️ Manual Adjust (Pending)` indicators and one-click revert (↺) before saving.
  - Added clean pagination controls (`Previous`, `Page X of Y`, `Next`) and per-page limit selector (50, 100, 250, Show All).
  - Exposed `POST /api/channel-health/save-all` backend endpoint supporting batch manual overrides and atomic AI acceptance.

---

## [2.3.3] - 2026-09-08

### Added
- **YouTube Reporting API Reach Integration (`channel_reach_basic_a1`)**:
  - Integrated Google's official reach report from the YouTube Reporting API (introduced January 15, 2026) to capture authentic impressions and impressions click-through rate.
  - Automatically registers and manages the `channel_reach_basic_a1` background reporting job via existing OAuth credentials.
  - Created `video_reach_daily` and `reporting_ingested_reports` database tables to store daily impressions and CTR per video.
  - Added Reach sync pipeline (`server/youtube-reach.js`) with authenticated CSV download and deduplication.
  - Populates Channel Health scorecard with real measured Impressions and view-weighted CTR, with clear compilation notices while initial batch reports compile.
  - Added "Sync Reach" button directly to Channel Health action toolbar.

---

## [2.3.2] - 2026-09-08

### Fixed
- **Reset 241 Videos Wrongly Relabelled As Livestreams**:
  - The v2.3.0 vocabulary migration renamed the `Other` category to `Livestreams & Channel Updates` based on its seeded description. That description was accurate in a local copy but not in production, where `Other` was a general dumping bucket holding 241 videos: charging network interviews, auto show coverage, solar payback, NACS explainers. Only two were actually livestreams.
  - Renaming the bucket gave all 241 a confident, wrong label, which is worse than the honest `Other` they had before and is precisely the failure mode v2.3.0 set out to remove.
  - Adds a guarded corrective migration (`livestream_mislabel_reset_v1`) returning those rows to an explicit unknown (`content_type = NULL`, `category_source = 'needs_review'`) so the classifier can place them properly. Manual assignments are untouched, and the change is recorded in `classification_runs` so it is reviewable and reversible via the existing rollback path.
  - Verified against a copy of the production database: 241 rows reset, 61 manual rows preserved, 746 total unchanged, idempotent across repeated boots.
- **Fail Fast and Notify Immediately on AI API Access Errors**:
  - When batch classification encounters an API access error (quota exhaustion, rate limits, 401/403, or authentication failures), the process halts immediately and returns a descriptive error rather than looping through subsequent batches. Surfaced directly via instant toast notifications and detailed preview banner alerts.

### Changed
- **Scoped the Mustang Mach-E Category to Genuine Ownership Content**:
  - 261 of 746 videos mention the Mach-E, spread across reviews, road trips, news, and how-tos. As a general "all about the Mach-E" bucket the category would have absorbed roughly a third of the library, recreating the overload that made the old `Walkarounds/Reviews` category useless for comparison.
  - Narrows the description to long-term ownership, owner tips, maintenance, mods, and owner-perspective software walkthroughs, explicitly excluding reviews, road trips, comparisons, and news that merely feature the car. Guarded by `mache_category_scoped_v1`, with the previous description preserved in `app_settings` so the change is reversible.
  - Adds a general classifier rule: a vehicle- or brand-specific category is only correct when that vehicle or brand is the point of the video. If the video would still make sense with a different vehicle in it, it is classified by format instead. The rule is written generically so it applies to any future vehicle-specific category.
  - Verified against production data: a deliberately hard set of 10 Mach-E videos distributed across 7 categories, with only the total-cost-of-ownership analysis and an owner-facing software feature remaining in the Mach-E bucket.

---

## [2.3.1] - 2026-09-08

### Added
- **Database Backup, Download & Inspection (Admin Settings → Catalog Maintenance)**:
  - `POST /api/admin/database/backup` creates a snapshot via SQLite's online backup API rather than copying the file, so it is safe to run against a live WAL-mode database without capturing a torn state.
  - **Shareable copy** option drops the `users` and `sessions` tables and vacuums, producing a file safe to hand to a third party for debugging.
  - `GET /api/admin/database/backups/:filename/download` serves a backup, with filename validation rejecting path traversal, nested paths, and non-`.sqlite` extensions.
  - `GET /api/admin/database/describe` returns row counts and the live category list with per-category video counts, so the state of the deployed database can be checked without downloading it.
  - Automatic retention keeps the ten most recent backups. All routes are admin-only; backups are written to `data/backups/`, which is gitignored.
- **Category Benchmark Entry & Derivation**:
  - v2.3.0 moved per-category benchmarks onto `content_categories` and had the Video Audit read them, but provided no way to enter them, so they remained `NULL`. Added average CTR, average retention, and average view duration fields to each row in the Category Manager, saved on blur.
  - **Derive from Analytics** fills retention and average view duration per category from measured per-video data over the last 365 days, weighted by views so a low-view video cannot swing the average.
  - Click-through rate is excluded from derivation and labelled `(Studio)` in the UI, because impressions CTR has no YouTube Analytics API equivalent and can only be read from YouTube Studio.

---

## [2.3.0] - 2026-09-08

### Removed
- **Fabricated Video Audit Metrics (`server/audit.js`)**:
  - Deleted `getCalibratedMetrics` and its `hashString` seed helper, which derived an entire analytics profile from a hash of the video ID. Because the values were deterministic they never changed between page loads and read as measured data.
  - Impressions and impressions CTR had **no live-data branch at all**, so both were fabricated even when OAuth was connected, while the prompt header labelled the block `GROUND-TRUTH YOUTUBE STUDIO DATA`. Both are now `null` and reported as YouTube Studio only.
  - Removed hash-derived card CTR, end-screen CTR, and the hardcoded geography (74/12/6/8) and device (58/26/14/2) splits, none of which were ever overridden by live data.
  - Removed the hardcoded `searchTerms` fallback and the invented `estimated_rpm` and `seo_score` fields.
  - Removed the synthetic 10-point retention curve with its fixed narrative labels ("30s Hook Gate", "Mid-video / Sponsor read"), which described the structure of a video nobody had watched.
- **Fabricated Channel Health Metrics (`server/channel-health.js`)**:
  - Removed the hardcoded `avgCtr = 5.3` and the impressions figure back-computed from it, which made the Impressions card a constant multiple of Views with an identical percent change by construction.
  - Removed the hardcoded `suggestedShare.pctChange` of 1.5, the constant `ctr: 5.4` stamped on every top-performer row, and per-category CTR and retention assigned by pattern-matching the category name against strings.
  - Removed the hardcoded `audienceShift.prior` object, which made every traffic-shift arrow a comparison against a literal.
- **Heuristic Competitor Fallback (`server/competitor-comparison.js`)**:
  - Removed `generateFallbackSummary`, which asserted specific strategic opinions about a competitor it had not examined whenever Gemini was unavailable. Failures now report honestly and leave the structured findings intact.

### Fixed
- **Category Vocabulary Mismatch (root cause of poor classification)**:
  - `videos.content_type` held a legacy vocabulary (`Review`, `EV News`, `Road Trip / Vlog`, `How-To / Instructional`, `EV Review`) that matched **none** of the six `content_categories` rows, so the Channel Health category breakdown resolved to zero for every category.
  - Added a guarded one-time migration (`category_vocabulary_v3_migrated`) mapping all 571 videos onto the live names, preserving manual assignments and quarantining unknown names as `needs_review`.
  - Moved per-category benchmarks onto `content_categories` (`avg_ctr`, `avg_retention`, `avg_view_duration`, `traffic_share_json`) so they can never drift from the category name, replacing the `CATEGORY_BENCHMARKS` constant. Left `NULL` by design: a benchmark is only real once entered from YouTube Studio.
  - Removed the keyword guesser in `syncRealChannelVideosScraper` that rewrote legacy names on every sync and mapped any title containing `"202"` to news, capturing most model-year reviews on an EV channel.
  - Renamed the vague `Other` bucket to `Livestreams & Channel Updates` and flagged it `is_fallback` so it stops acting as an escape hatch; corrected the seed list so it is not recreated on boot.
- **Silent Classifier Failures**:
  - A thrown or unparseable Gemini batch previously fell through to a keyword ladder for all 25 videos while still incrementing the success counter, so the UI could report "reclassified 571 / 571" when the model contributed nothing.
  - Model-assigned, playlist-assigned, and failed counts are now tracked separately and surfaced. Batches retry up to three times with backoff before being reported as failures.
- **Mislabelled 30-Second Hook Drop**:
  - `retentionCurve[2]` was read as the 30-second mark, but the live curve is keyed on `elapsedVideoTimeRatio` (percentage of video), making index 2 roughly 2% in: about 10 seconds on an 8-minute video and 48 seconds on a 40-minute one.
  - Replaced with true interpolation to 30 seconds using the video's duration, returning `null` when no curve is available.
- **Unpopulated View Counts**:
  - `videos.view_count` was read in three places but never written, because the catalog sync omitted the `statistics` part from `videos.list`. All 571 rows were zero. The sync now requests and stores it.
- **Silent Defaults Entering the Maths**:
  - Unknown durations no longer default to `PT15M00S`, which sat above the long-form threshold and silently counted unknown-length videos (including Shorts) as long-form everywhere.
  - Unknown subscriber counts no longer default to 24,800 (ours) and 100,000 (competitor), which fed an invented scale ratio to the model as fact.
  - Missing view counts are no longer credited 1,500 (Channel Health) or 2,300 (Video Audit).
  - The competitor scraper no longer invents `likeCount` and `commentCount` from view-count ratios.
- **Shorts Threshold**:
  - Corrected from 240s to 180s to match YouTube's current 3-minute Shorts definition, which had been silently excluding genuine short long-form videos from every figure on the page.
- **Category Trajectory**:
  - Now compares uploads this period against the prior period instead of testing lifetime total views against fixed 100,000 / 30,000 thresholds, under which a large old category could never show "down".

### Added
- **Editable AI Instructions for Competitor & Channel Health**:
  - Extended `title_prompt_settings` with `competitor_instructions` and `channel_health_instructions`, pre-seeded with EV-tailored defaults and exposed as editable textareas with live counters in Admin Settings.
  - The structured data block remains assembled in code for both, so a prompt edit cannot break the data injection.
- **Channel Health AI Narrative & Report History**:
  - `POST /api/channel-health/narrative`: generates a Gemini narrative from measured data only and archives it.
  - `GET|DELETE /api/channel-health/reports[/:id]`: new `channel_health_reports` table storing the scorecard JSON plus narrative per run.
  - The prompt receives an explicit list of unavailable metrics and is instructed never to estimate them.
- **Three-Pass Classifier with Review Queue**:
  - **Pass 1** resolves categories from `playlist_category_mappings` via `playlistItems.list` — deterministic, no AI call, and the highest-precision signal available.
  - **Pass 2** calls Gemini with `responseSchema`, a category enum, `confidence`, and `reason` at temperature 0, in batches of 12 rather than 25.
  - **Pass 3** routes anything below 0.7 confidence, unreturned, or failed to a review queue as `NULL` rather than guessing.
  - Feeds real descriptions, tags, duration, and transcript openings. The scraper had been writing a placeholder description that only restated the title, so the model was effectively classifying on the title alone.
  - Persists `classification_confidence` and `classification_reason` per video so a wrong call is diagnosable.
- **Classification Dry Run, History & Rollback**:
  - New `classification_runs` table records every run. `POST /api/channel-health/reclassify` accepts `dryRun` and previews proposed changes in a diff table before anything is written.
  - `POST /api/channel-health/classification-runs/:id/rollback` restores prior values; `GET /api/channel-health/review-queue` lists unresolved videos.
- **Append-Only Competitor Report History**:
  - Reports no longer upsert by `competitor_channel_id`. Re-running against the same competitor previously overwrote and permanently destroyed the prior run.
  - Added `report_label`, a 12-run retention policy per competitor, `GET /api/comparison/reports/:id/history`, and a **"What changed since the previous run"** section covering cadence shifts, new outliers, and topic movement.
- **Richer Competitor Analysis Inputs**:
  - Now passes `titlePatterns` (top-quartile keywords, average title length, percentage containing a number), which was computed and stored but never given to the model despite the prompt asking for packaging advice.
  - Added engagement rate per 1,000 views, publish-day distribution, and video-age normalisation flagging outliers under 30 days as still accumulating.
- **Data Provenance Throughout the UI**:
  - Scorecard tiles, status pills, and metric cards render an em dash plus the reason when a metric is unavailable, instead of a plausible-looking number.
  - The Video Audit modal shows a "Not Connected" badge, an explicit unavailable-metrics list, and suppresses the Discovery 2x2 quadrant when impressions and CTR are missing.

---

## [2.2.8] - 2026-09-07

### Fixed
- **Verbatim Anchor Quotes & Exact Boundary Precision**:
  - Replaced imprecise window snapping with server-side anchor quote resolution. The model returns 6 to 12 words copied verbatim from the transcript at the exact start of each section.
  - Built a normalized transcript character-to-cue index mapping. Quotes match directly to their originating cue, achieving within-seconds boundary precision (e.g. 0:54 for Exterior, 3:56 for Frunk, 9:52 for Infotainment, 12:01 for Midgate).
  - Implemented 6-word retry fallback and graceful degradation to `startWindow`, marking each chapter with `resolvedBy: "quote"` or `resolvedBy: "window"` in the UI.
- **Tightened Fallback Windows**:
  - Reduced fallback window size from 30s to 10s (`windowSec = 10`), and raised widening threshold from 400 to 1,200 windows for sharper model context and finer fallback grid.
- **Dynamic Chapter Count Scaling**:
  - Replaced fixed "6 to 12" instruction with a runtime-derived target (~1 chapter every 2 minutes, floor 8 for videos $\ge 15$ minutes, ceiling 20) passed explicitly to the model.
- **Concrete Title Generation & Prompt Reset**:
  - Reset `chapter_instructions` to a rewritten default demanding concrete nouns, figures, kW metrics, model names, and measurements while banning standalone generic labels ("Intro", "Tech", "Driving", "Conclusion").
  - Executed a guarded one-time migration in `server/db.js` (`chapter_prompt_v2_migrated`) to update existing databases.
- **Verification UI Resolution Badges**:
  - Added resolution badges (`quote` vs `window`) and match summary stats ("X/Y resolved via quote") to the chapter verification list in `frontend/src/Transcripts.jsx`.

## [2.2.7] - 2026-09-07

### Fixed
- **Derived Chapter Timestamps (Cues & Indexed Windows Pipeline)**:
  - Fixed hallucinated/estimated chapter timestamps by eliminating timestamp arithmetic requests to Gemini and removing the `.slice(0, 45000)` prompt truncation.
  - **SRT Cue Parser**: Added `parseSrtCues` in `server/app.js` supporting comma and period millisecond separators to extract cue-level `{ startSec, endSec, text }`.
  - **30-Second Indexed Windows**: Condenses full subtitle files into indexed 30-second windows (`[0] 0:00 — text...`, `[1] 0:30 — text...`), dynamically widening window sizes if videos exceed 400 windows so that entire transcripts are evaluated without truncation.
  - **Window Index Schema**: Changed Gemini response schema to return `startWindow` integer indices rather than arithmetic `startSeconds`.
  - **Server-Side Exact Cue Mapping**: Maps returned `startWindow` indices back to the exact start time of the first cue in that window, achieving cue-level precision.
  - **Opening Chapter Snapping**: Chapters starting within 30 seconds of zero snap cleanly to `0:00`; otherwise, preserves the first chapter and prepends a dedicated `0:00 Intro` chapter.
  - **Accurate Runtime Derivation**: Derives total duration from the end time of the last SRT cue instead of falling back to 900 seconds when the video metadata duration is NULL.
  - **Reviewable Chapter Excerpts in UI**: Returned chapters now include a `sourceExcerpt` showing the first 100 characters of spoken dialogue at that timestamp, displayed in muted text beneath each chapter row in `frontend/src/Transcripts.jsx` for instant verification.

## [2.2.6] - 2026-09-07

### Added
- **Transcript-Driven YouTube Description Generation**:
  - `POST /api/videos/:videoId/generate-description`: Generates high-retention, viewer-first YouTube descriptions (2–3 sentence hook, video content breakdown, and engaging discussion closing) based on the cleaned transcript and optional creator context.
  - Enforces a 4,500 character ceiling to guarantee ample headroom under YouTube's 5,000 character limit for chapters and existing descriptions.
  - Requires cleaned transcript status (`fixed` or `uploaded`) before generating.
- **Transcript-Driven YouTube Chapter Generation & Server Validation**:
  - `POST /api/videos/:videoId/generate-chapters`: Derives 6 to 12 logical, chronological chapters from `cleaned_srt` with timestamps.
  - Server-side validation pipeline: forces the first chapter to `0:00`, drops any entries within 10 seconds of the previous chapter, drops timestamps beyond video duration (`parseDurationSec`), and validates that at least 3 chapters survive (returning `422` otherwise).
  - Formats timestamps as `M:SS` (<1 hour) and `H:MM:SS` (>=1 hour), returning both the structured array and a preformatted `chapterBlock` ready to copy or push.
- **AI Prompt Settings Configuration for Descriptions & Chapters**:
  - Extended `title_prompt_settings` table in SQLite with `description_instructions` and `chapter_instructions` columns, pre-seeded with EV-tailored defaults.
  - Added dedicated editable textareas with live character and word counters in Admin Settings under the AI System Instructions tab.
- **Transcripts & Title Strategist UI Panel**:
  - Added dual Description and Chapters generator cards below the Title Strategist with editable textareas, character meters, and one-click clipboard copy actions with toast notifications.
  - Displays an informative disabled-state note when a transcript is missing or unfixed.
- **Guarded Push to YouTube & Rollback Restore for Unlisted Videos**:
  - `POST /api/videos/:videoId/push-description`: Strictly restricted to unlisted videos (`privacy_status === 'unlisted'`).
  - Read-modify-write YouTube API v3 update preserving `title`, `categoryId`, `tags`, `defaultLanguage`, and `defaultAudioLanguage`.
  - Repeat push protection: Automatically detects previously pushed leading block and replaces it rather than stacking duplicate descriptions or chapter lists.
  - Created `youtube_description_backups` table storing `previous_description` and `pushed_block` prior to calling YouTube API.
  - Character threshold guard: Rejects any composed description exceeding 5,000 characters before making external calls.
  - Confirmation Modal: Displays scrollable preview of the full composed payload, character count, and repeat-push detection badge before write execution.
  - `POST /api/videos/:videoId/restore-description`: Instant undo button in UI allowing creators to roll back the YouTube description to its exact pre-push state.

## [2.2.5] - 2026-09-07

### Added
- **Click-to-Scroll in Transcripts Diff**: Clicking on any word or subtitle block in "Original Raw Input" smoothly scrolls the "Cleaned Output" pane to the matching location and highlights the corresponding segment.
- **4-Option Correction Dialogue**: Upgraded term editing to a dedicated 4-option correction dialog (`Cancel`, `Fix one time`, `Fix all in this video`, `Add to Term List`), allowing users to make instant inline corrections or permanently expand the deterministic EV dictionary.
- **Thumbnail Titles Manual Editing & Match Tracking**:
  - Added in-place title editing and persistence in the video details header (`PATCH /api/videos/:videoId/title`).
  - Added live tracking comparison with YouTube (`Matches YouTube` vs `Differs from YouTube`).
  - Provided "Copy Title" clipboard action and a user-confirmed "Push to YouTube" action with confirmation modal (`POST /api/videos/:videoId/title/push`) using Google OAuth2 and YouTube Data API v3.
- **Stored Title Suggestions & Re-generation**:
  - Automatically persists generated title suggestions to the SQLite database (`videos.title_suggestions`).
  - Stored suggestions load automatically when selecting a video, with the button toggling between "Generate Title Ideas" and "Regenerate Title Ideas".
- **Thumbnail Words Suggestion**:
  - Gemini now generates punchy 2–4 word phrases for video thumbnails alongside each title recommendation.
  - Added an editable instructions section for Thumbnail Words in Admin AI settings (`title_prompt_settings.thumbnail_instructions`).
- **Gemini API Test Pop-up**: Updated the Admin test button to "Test Gemini API" with a modal displaying the exact active Gemini model version and latency upon successful connection.

## [2.2.4] - 2026-09-07

### Fixed
- **Content Security Policy on Login**: Moved inline script from `public/login.html` into `public/assets/login.js` to comply with CSP `script-src 'self'`. Replaced external `app.css` link with self-contained styling.
- **Build Asset Retention**: Updated `scripts/build.js` to preserve `public/assets/login.js` when clearing assets, ensuring login scripts are never deleted during Vite bundle compilation.
- **Cleaned Orphan Prototype Assets**: Deleted `public/dashboard.html` which referenced deleted legacy assets.
- **Transcripts Function References**: Resolved `handlePreviewText is not defined` by calling `runPreview`, and fixed `loadTranscriptForVideo` to call `handleSelectVideo(selectedVideo)` in `frontend/src/Transcripts.jsx`.
- **Frontend Oxlint Environment**: Configured `"env": { "browser": true }` in `frontend/.oxlintrc.json` so standard browser globals (`window`, `document`, `fetch`, `setTimeout`) pass lint verification.
- **Admin Startup Persistence**: Removed improper startup `UPDATE users SET is_admin = 1` query in `server/db.js` so accounts created with `is_admin = 0` remain non-admin across server restarts.
- **Proxy-Aware Rate Limiting & Secure Cookies**: Configured `app.set("trust proxy", 1)` for accurate single-hop client IP resolution behind nginx reverse proxy, preventing collective rate limit lockouts; simplified cookie `secure` option in `/login` to rely directly on `req.secure`.
- **Repository Cleanliness**: Purged sensitive `AUDIT_2026-09-07.md` from the public git history.

## [2.2.3] - 2026-09-07

### Security
- **Admin Role-Based Access Control**:
  - Added `is_admin` column to `users` table and `requireAdmin` middleware.
  - Protected all `/api/admin/*` endpoints and OAuth connect/disconnect routes with administrator access requirements.
  - Restricted password changes (`POST /api/admin/users/password`) to self-service unless authenticated as an administrator.
  - Added immediate invalidation of all existing sessions for a user upon password change (`destroyUserSessions`).
- **Google Client Secret Masking**:
  - `GET /api/admin/integrations` masks `google_client_secret` into `google_client_secret_configured: boolean`, omitting raw secret string.
  - Admin UI renders a write-only masked placeholder (`••••••••••••`), only overwriting if a new value is explicitly supplied.
- **OAuth CSRF Protection**:
  - Added cryptographically random 24-byte state token generation on `GET /api/auth/google`, linked to active user session in SQLite.
  - Callback strictly verifies state match and clears token upon inspection, rejecting mismatched or expired attempts with `400 Bad Request`.
- **SSRF & Stored XSS Hardening**:
  - Implemented private IP, link-local, loopback, and cloud metadata rejection in `server/fathom-news.js` with timeout and payload size bounds.
  - Escaped HTML entities (`&`, `<`, `>`, `"`, `'`) in Competitor Comparison markdown renderer prior to formatting.
- **Rate Limiting & Security Headers**:
  - Configured `express-rate-limit` for `POST /login` (5 attempts / 15 minutes with IP and username failure logging).
  - Added global API rate limiter (100 req / minute) and AI endpoint limiter (10 req / minute).
  - Integrated `helmet` with Content Security Policy and frame protection.
- **Centralized Error Handling**:
  - Routed server exceptions to centralized error middleware with unique correlation IDs (`crypto.randomUUID()`), preventing raw stack trace leaks to clients.

### Fixed
- **Caption API Download Decoding**:
  - Fixed gaxios binary decoding issue in `fetchViaOfficialApi` by explicitly setting `{ responseType: "text" }` and normalizing Buffer/Blob/ArrayBuffer payload formats.
  - Removed all unofficial caption scraping code and uninstalled `youtube-transcript` and `youtube-caption-extractor` dependencies.
- **OAuth Scope Verification**:
  - Added `youtube.force-ssl` scope audit to `getOAuthStatus()` and surfaced actionable reconnect banner in Admin Settings if missing.

### Housekeeping
- **Stale Asset Purge**:
  - Updated `scripts/build.js` and `npm run build:frontend` to wipe `public/assets` before copying fresh Vite bundles.
- **Dynamic Updates & Code Hygiene**:
  - Replaced `COALESCE` in `PATCH /api/videos/:id` with dynamic SQL only updating supplied fields.
  - Exported shared `DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"` from `server/gemini.js`.
  - Audited and added contextual warning logging to all 27 catch blocks across server modules.
  - Corrected database file descriptions in `TECH_STACK.md` and removed `pm2` from runtime dependencies.

---

## [2.2.2] - 2026-09-07

### Added
- **Official YouTube Data API v3 Caption Retrieval Fallback**:
  - Added `fetchViaOfficialApi(videoId)` leveraging official `youtube.captions.list` and `youtube.captions.download({ id, tfmt: 'srt' })` via the channel's authenticated OAuth client.
  - Successfully retrieves any uploaded or official caption tracks directly, immune to datacenter IP scraping blocks.
- **Direct YouTube Transcript Converter (`convertRawTranscriptToSrt`)**:
  - Parses raw text copied directly from YouTube's desktop player transcript box (e.g. `0:00 Hello\n0:05 World`, or raw blocks without timestamps) into strictly formatted SubRip (`.srt`) timing cues.
- **1-Click Quick Paste Capability**:
  - Added `POST /api/videos/:videoId/captions/paste` to convert, clean with `fixCaptionSrt`, and save transcripts in one single click.
  - Added Quick Paste modal on Video Audit cards, Video Audit Report modal, and Transcripts workspace with direct link to the video on YouTube and step-by-step instructions.

### Fixed
- **Resolved Misleading OAuth Reconnect Error**:
  - Fixed issue where cloud datacenter IP blocks (`LOGIN_REQUIRED`) were mistakenly diagnosed as an OAuth disconnect. Google Cloud Console OAuth bearer tokens are rejected with 401 by YouTube's private InnerTube endpoints; InnerTube headers have been sanitized and the user is provided with immediate Quick Paste options instead of misleading OAuth reconnect prompts.

---

## [2.2.1] - 2026-09-07

### Fixed
- **Caption Retrieval Diagnostics & Cloud Host Error Handling**:
  - Diagnosed cloud VPS datacenter IP restrictions (`LOGIN_REQUIRED`) encountered during unauthenticated caption scraping.
  - Added actionable error handling and diagnostic reporting guiding users to official authenticated paths or Quick Paste when automated scraping is restricted.
  - Prepared architecture for transition to official YouTube Data API v3 caption management.

---

## [2.2.0] - 2026-09-07

### Added
- **Auto-Generated YouTube Caption Retrieval (Bypassing API Restriction)**:
  - Added public caption extractor engine in `server/captions.js` utilizing `youtube-transcript` with `youtube-caption-extractor` fallback to extract timed transcript chunks without official API restrictions.
  - Reconstructs transcript chunks into fully compliant SubRip (`.srt`) format with sequential numbering, `00:00:00,000 --> 00:00:00,000` timestamps, and decoded HTML entities.
  - Added "Retrieve Captions" action button across Video Audit cards, the Video Audit Report modal, and the Transcripts studio.
  - Added confirmation dialog prompt (`Are you sure? ...`) when retrieving captions for a video that already has existing transcripts/edits.
  - Added automatic caption download on future Catalog Syncs (`syncCatalog`) for newly discovered videos.
- **Caption Status Tracking & Indicator Badges**:
  - Added `caption_status` column to `videos` table (`none`, `unfixed`, `fixed`, `uploaded`) and status tracking to `transcripts` table (`status`, `youtube_caption_id`, `uploaded_at`).
  - Added visual indicator badges on `VideoAudit.jsx`:
    - `No Captions` (Gray badge)
    - `Unfixed Captions` (Amber badge)
    - `Fixed Captions` (Cyan badge)
    - `Uploaded` (Emerald badge)
  - Added Caption Status filter dropdown in Video Audit Hub (filter by All / No Captions / Unfixed / Fixed / Uploaded).
  - Added 1-click "Clean Captions" action on unfixed videos to apply EV-terminology corrections immediately.
- **YouTube Subtitle Track Publishing via Data API v3**:
  - Added `uploadCaptionsToYoutube` leveraging `googleapis` with `https://www.googleapis.com/auth/youtube.force-ssl` OAuth2 scope.
  - Inserts caption track with `part: ['snippet']`, `snippet: { videoId, language: 'en', name: 'English (Edited)', isDraft: false }`, and cleaned SRT readable stream (omitting deprecated `sync` parameter).
  - Added "Upload Clean Captions" button on Video Audit cards, the Audit Report modal, and the Transcripts workspace.
  - Fallback support for `process.env.GOOGLE_REFRESH_TOKEN` for OAuth credentials.
- **Orchestrator Pipeline**:
  - Exported `processVideoCaptions(videoId)` orchestrator function that executes the complete pipeline in one call: caption retrieval $\rightarrow$ EV vocabulary cleanup $\rightarrow$ database persistence $\rightarrow$ YouTube subtitle upload.
- **Standardized on SRT**:
  - Switched all subtitle/transcript download routes across the application to SubRip (`.srt`) with `application/x-subrip; charset=utf-8` MIME type.

---

## [2.1.0] - 2026-09-07

### Added
- **Transcripts & EV Vocabulary Engine**:
  - SQLite `transcripts` table storing `raw_srt`, `cleaned_srt`, and `plain_text` 1:1 with videos.
  - Deterministic EV vocabulary correction engine integrating `fixTranscript.js` (`fixSrt`, `loadRules`, `srtToPlainText`), `ev_terms.json`, and `termList.js`.
  - Comprehensive transcript review workspace in `Transcripts.jsx` with subtitle file drag-and-drop / paste, side-by-side diff view, category pills with count badges (`vehicles`, `charging`, `tech`, `units`, `numerals`, `people_places`), and `.srt` file download.
  - Manual term correction modal with explicit `addTerm()` calls (never automated).
  - EV Terms Registry management tab in `AdminSettings.jsx` supporting term search, category filtering, rule additions, and variant deletions via `termList.js`.
- **Gemini Title Strategist**:
  - `title_prompt_settings` single-row database table holding editable system prompt instructions, seeded verbatim with The Electric Duo's custom title strategist guidelines.
  - Title suggestions endpoint (`POST /api/videos/:videoId/generate-titles`) leveraging Gemini with intelligent candidate failover ladder (`gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.5-flash`).
  - Structured generation returning 8 title candidates with `charCount`, `first40Preview`, `emotion`, `rationale`, and `deliversOnPromise`.
  - 1-click "Select as Working Title" action persisting chosen title to `videos.working_title`.
- **Unlisted Video Catalog Ingestion & Isolation**:
  - Unlisted videos are now ingested into the video catalog with `privacy_status = 'unlisted'`.
  - Unlisted videos are strictly excluded from channel health metrics, audits, and analytics queries.
  - Catalog UI in `ArticleGenerator.jsx` and `Transcripts.jsx` now features dedicated "Public Catalog" and "Unlisted Videos" tab views.
  - Added "Manually Add Unlisted Video to Catalog" card under Catalog Maintenance in `AdminSettings.jsx`.
- **Shorts Exclusion**:
  - Video Audit and analytics now strictly exclude Shorts (< 4 minutes / 240 seconds or titles containing `#shorts`).
- **Navigation & Deep Linking**:
  - Added dedicated top-level **Video Audits** navigation dropdown containing **Video Audit** and **Transcripts**.
  - Added "Upload Transcript" button in the Video Audit Report modal (`AuditReportModal.jsx`) linking directly to the transcript upload screen for that video.
  - Added version badge (`v2.1.0`) in the navigation bar.

---

## [2.0.4] - 2026-09-05

### Changed
- Revised Fathom News posts for native Gutenberg blocks (`Eduo Take` and `Read More` blocks).

---

## [2.0.3] - 2026-09-03

### Added
- Added Gemini 3.8 Flash model support.
- Pinned audit scorecard banner and SEO score calculation.

### Performance
- Optimized AI Studio model discovery REST response latency.

---

## [2.0.2] - 2026-09-02

### Fixed
- Fixed video duration backfill and video audits parsing.
- Fast Gemini connection test and dynamic AI Studio model refresh.

---

## [2.0.1] - 2026-09-02

### Fixed
- Added `pm2` dependency and PATH resolution for xCloud server runner.
- Fixed xCloud deployment script in `scripts/build.js` to ensure resilient builds.

---

## [2.0.0] - 2026-08-31

### Initial Release
- The Electric Duo Master Command Center 2.0 release.
- Integrated Plan Checklist, Article Generator, Fathom News, Video Audit, Channel Health, and Competitor Benchmark modules.
