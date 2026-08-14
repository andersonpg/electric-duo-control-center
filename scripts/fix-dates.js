"use strict";

const path = require("path");
const Database = require("better-sqlite3");
const axios = require("axios");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const dbPath = path.join(DATA_DIR, "database.sqlite");
const db = new Database(dbPath);

async function fetchRealDate(vId) {
  try {
    const res = await axios.get(`https://www.youtube.com/watch?v=${vId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 8000,
    });
    const html = res.data;

    // 1. Try dateText in JSON
    const dateTextMatch = html.match(/"dateText":\{"simpleText":"([^"]+)"\}/);
    if (dateTextMatch && dateTextMatch[1]) {
      const d = new Date(dateTextMatch[1]);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    // 2. Try publishDate / uploadDate
    const publishDateMatch = html.match(/"publishDate":"([^"]+)"/);
    if (publishDateMatch && publishDateMatch[1]) {
      const d = new Date(publishDateMatch[1]);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    const uploadDateMatch = html.match(/"uploadDate":"([^"]+)"/);
    if (uploadDateMatch && uploadDateMatch[1]) {
      const d = new Date(uploadDateMatch[1]);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  } catch (e) {
    // console.warn(`Error on ${vId}:`, e.message);
  }
  return null;
}

async function run() {
  console.log("Checking videos with default/recent dates in:", dbPath);
  const videos = db.prepare("SELECT youtube_id, title, published_at FROM videos WHERE published_at LIKE '2026-08-14%' OR published_at IS NULL").all();

  console.log(`Found ${videos.length} video(s) to fix.`);
  if (videos.length === 0) {
    console.log("All video dates are already accurate!");
    return;
  }

  const updateStmt = db.prepare("UPDATE videos SET published_at = ? WHERE youtube_id = ?");

  let fixedCount = 0;
  let skippedCount = 0;
  const concurrency = 10;

  for (let i = 0; i < videos.length; i += concurrency) {
    const chunk = videos.slice(i, i + concurrency);
    await Promise.all(
      chunk.map(async (v) => {
        const realDate = await fetchRealDate(v.youtube_id);
        if (realDate) {
          updateStmt.run(realDate, v.youtube_id);
          fixedCount++;
          console.log(`[${fixedCount}/${videos.length}] ${v.youtube_id} -> ${realDate.substring(0, 10)} | ${v.title.substring(0, 45)}`);
        } else {
          skippedCount++;
        }
      })
    );
  }

  console.log(`\nDone! Fixed: ${fixedCount}, Skipped: ${skippedCount}, Total: ${videos.length}`);
}

run().catch(console.error);
