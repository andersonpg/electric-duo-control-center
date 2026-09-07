# Changelog

All notable changes to The Electric Duo Command Center (`cc.theelectricduo.com`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.2.1] - 2026-09-07

### Fixed
- **Cloud Host Caption Retrieval & OAuth Bearer Token Forwarding**:
  - Implemented an OAuth-aware multi-client InnerTube subtitle extractor in `server/captions.js` to resolve YouTube's datacenter IP block (`LOGIN_REQUIRED: You need to be logged in to do that`).
  - Added dynamic Google OAuth 2.0 Bearer token retrieval via `getAuthenticatedClient().getAccessToken()` to authenticate InnerTube player requests as the verified channel owner.
  - Added high-resilience multi-client ladder (`ANDROID` v20.10.38 $\rightarrow$ `IOS` v20.10.4 $\rightarrow$ `ANDROID_VR` $\rightarrow$ `MWEB`) with dual-endpoint routing (`www.youtube.com` and `youtubei.googleapis.com`).
  - Added dual-format subtitle stream parser supporting both structured `json3` (`events[].segs`) and `srv3` / classic XML (`<p t="..." d="...">` / `<text start="..." dur="...">`).
  - Improved error messaging with actionable guidance when YouTube returns `LOGIN_REQUIRED`.

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
