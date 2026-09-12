#!/usr/bin/env node
"use strict";

require("dotenv").config();
const { google } = require("googleapis");
const db = require("../server/db").articleDb;
const { getAuthenticatedClient, isOAuthConnected } = require("../server/youtube-analytics");
const { getEffectiveEndDate, isLongForm } = require("../server/media-kit");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateStr(d) {
  return d.toISOString().split("T")[0];
}

async function main() {
  console.log("=== Media Kit 28-Day & 365-Day Views Backfill ===");

  if (!isOAuthConnected()) {
    console.error("Error: YouTube OAuth is not connected. Please connect in Admin Settings first.");
    process.exit(1);
  }

  const auth = getAuthenticatedClient();
  if (!auth) {
    console.error("Error: Could not obtain authenticated OAuth client.");
    process.exit(1);
  }

  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth });
  const effectiveEnd = getEffectiveEndDate();
  console.log(`Using effective end date (reporting lag: T-3d): ${effectiveEnd}`);

  // 1. Backfill 28-Day Views
  console.log("\n--- Phase 1: 28-Day Views Backfill ---");
  const candidates28 = db.prepare(`
    SELECT youtube_id, title, published_at, duration
    FROM videos
    WHERE (privacy_status IS NULL OR privacy_status = 'public')
      AND date(published_at, '+27 days') <= date(?)
      AND youtube_id NOT IN (SELECT video_id FROM video_28day_views)
    ORDER BY published_at ASC
  `).all(effectiveEnd);

  const longForm28 = candidates28.filter((v) => isLongForm(v.duration));
  console.log(`Found ${longForm28.length} eligible public long-form videos pending 28-day capture.`);

  let count28 = 0;
  let errors28 = 0;

  for (let i = 0; i < longForm28.length; i++) {
    const video = longForm28[i];
    const pubDate = new Date(video.published_at);
    const windowStart = formatDateStr(pubDate);
    const endDate = new Date(pubDate.getTime() + 27 * 86400000);
    const windowEnd = formatDateStr(endDate);

    try {
      const res = await ytAnalytics.reports.query({
        ids: "channel==MINE",
        startDate: windowStart,
        endDate: windowEnd,
        metrics: "views",
        filters: `video==${video.youtube_id}`,
      });

      const views28d = res.data?.rows?.[0]?.[0] || 0;

      db.prepare(`
        INSERT INTO video_28day_views (video_id, published_at, window_start, window_end, views_28d, captured_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(video_id) DO UPDATE SET
          views_28d = excluded.views_28d,
          captured_at = CURRENT_TIMESTAMP
      `).run(video.youtube_id, video.published_at, windowStart, windowEnd, views28d);

      count28++;
      process.stdout.write(`\r[28d] ${count28}/${longForm28.length} videos processed (last: ${video.youtube_id} -> ${views28d} views)`);
    } catch (err) {
      errors28++;
      console.warn(`\n[Error 28d] Failed for ${video.youtube_id} (${video.title}): ${err.message}`);
    }

    // Rate throttle (350ms delay)
    await sleep(350);
  }
  console.log(`\nPhase 1 complete: ${count28} captured, ${errors28} errors.`);

  // 2. Backfill 365-Day Views (for evergreen multiple)
  console.log("\n--- Phase 2: 365-Day Views Backfill ---");
  const candidates365 = db.prepare(`
    SELECT v28.video_id, v28.published_at, v.title, v.duration
    FROM video_28day_views v28
    JOIN videos v ON v.youtube_id = v28.video_id
    WHERE (v.privacy_status IS NULL OR v.privacy_status = 'public')
      AND v28.views_365d IS NULL
      AND date(v28.published_at, '+364 days') <= date(?)
    ORDER BY v28.published_at ASC
  `).all(effectiveEnd);

  const longForm365 = candidates365.filter((v) => isLongForm(v.duration));
  console.log(`Found ${longForm365.length} eligible public videos pending 365-day capture.`);

  let count365 = 0;
  let errors365 = 0;

  for (let i = 0; i < longForm365.length; i++) {
    const item = longForm365[i];
    const pubDate = new Date(item.published_at);
    const windowStart = formatDateStr(pubDate);
    const endDate = new Date(pubDate.getTime() + 364 * 86400000);
    const windowEnd = formatDateStr(endDate);

    try {
      const res = await ytAnalytics.reports.query({
        ids: "channel==MINE",
        startDate: windowStart,
        endDate: windowEnd,
        metrics: "views",
        filters: `video==${item.video_id}`,
      });

      const views365d = res.data?.rows?.[0]?.[0] || 0;

      db.prepare(`
        UPDATE video_28day_views
        SET views_365d = ?, captured_365d_at = CURRENT_TIMESTAMP
        WHERE video_id = ?
      `).run(views365d, item.video_id);

      count365++;
      process.stdout.write(`\r[365d] ${count365}/${longForm365.length} videos processed (last: ${item.video_id} -> ${views365d} views)`);
    } catch (err) {
      errors365++;
      console.warn(`\n[Error 365d] Failed for ${item.video_id}: ${err.message}`);
    }

    // Rate throttle (350ms delay)
    await sleep(350);
  }

  console.log(`\nPhase 2 complete: ${count365} captured, ${errors365} errors.`);
  console.log("\n=== Backfill Finished Successfully ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nBackfill aborted with fatal error:", err);
  process.exit(1);
});
