# Changelog

All notable changes to The Electric Duo Command Center (`cc.theelectricduo.com`) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
