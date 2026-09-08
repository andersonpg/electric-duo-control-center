# Changelog

All notable changes to The Electric Duo Command Center (`cc.theelectricduo.com`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
