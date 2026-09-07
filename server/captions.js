"use strict";

const { Readable } = require("stream");
const { google } = require("googleapis");
const { YoutubeTranscript } = require("youtube-transcript");
let getSubtitlesFallback = null;
try {
  getSubtitlesFallback = require("youtube-caption-extractor").getSubtitles;
} catch (e) {}

const path = require("path");
const db = require("./db").articleDb;
const { getAuthenticatedClient, isOAuthConnected } = require("./youtube-analytics");
const { fixSrt, loadRules, srtToPlainText } = require("../fixTranscript");

const termsPath = path.join(__dirname, "..", "ev_terms.json");
let cachedRules = null;
function getEvRules() {
  if (!cachedRules) {
    try {
      const termsData = require(termsPath);
      cachedRules = loadRules(termsData);
    } catch (e) {
      console.warn("Could not load ev_terms.json for captions:", e.message);
      cachedRules = [];
    }
  }
  return cachedRules;
}

/** Decode common XML/HTML entities found in YouTube subtitle tracks. */
function decodeHtmlEntities(text) {
  if (!text) return "";
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Format milliseconds into compliant SubRip timestamp: HH:MM:SS,mmm
 * Example: 65120 -> "00:01:05,120"
 */
function formatSrtTimestamp(ms) {
  const totalMs = Math.max(0, Math.round(ms));
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  const remMs = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(remMs).padStart(3, "0")}`;
}

/**
 * Convert transcript chunks into compliant SRT format with sequential numbering
 * and valid timestamps.
 */
function chunksToSrt(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return "";
  return chunks
    .map((chunk, index) => {
      const startMs =
        typeof chunk.offset === "number"
          ? chunk.offset
          : parseFloat(chunk.start || 0) * 1000;
      const durMs =
        typeof chunk.duration === "number"
          ? chunk.duration
          : parseFloat(chunk.dur || 0) * 1000;
      const endMs = startMs + Math.max(durMs, 500);

      const startStamp = formatSrtTimestamp(startMs);
      const endStamp = formatSrtTimestamp(endMs);
      const text = decodeHtmlEntities(chunk.text || "").trim();

      return `${index + 1}\n${startStamp} --> ${endStamp}\n${text}\n`;
    })
    .join("\n");
}

/**
 * 1. Caption Retrieval: Bypass official API restriction to fetch auto-generated/public captions.
 * Reconstructs chunks into compliant SRT.
 */
async function fetchRawCaptionsAsSrt(videoId) {
  if (!videoId || typeof videoId !== "string") {
    throw new Error("Invalid or missing videoId for caption extraction.");
  }

  let chunks = null;
  let lastError = null;

  // Primary: youtube-transcript with English preference
  try {
    chunks = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
  } catch (err) {
    lastError = err;
  }

  // Fallback 1: youtube-transcript without language filter (e.g. autodetect)
  if (!chunks || chunks.length === 0) {
    try {
      chunks = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (err) {
      lastError = err;
    }
  }

  // Fallback 2: youtube-caption-extractor
  if ((!chunks || chunks.length === 0) && getSubtitlesFallback) {
    try {
      const subs = await getSubtitlesFallback({ videoID: videoId, lang: "en" });
      if (subs && subs.length > 0) {
        chunks = subs;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!chunks || chunks.length === 0) {
    const errorMsg = lastError ? lastError.message : "No captions found";
    if (
      errorMsg.includes("Could not find transcript") ||
      errorMsg.includes("Transcript is disabled") ||
      errorMsg.includes("Subtitles are disabled")
    ) {
      throw new Error(
        "Captions are not currently available for this video on YouTube. Auto-generated captions may still be processing, or captions are disabled."
      );
    }
    throw new Error(`Failed to retrieve captions: ${errorMsg}`);
  }

  const srt = chunksToSrt(chunks);
  return {
    srt,
    chunkCount: chunks.length,
  };
}

/**
 * 2. Fix/Cleanup: Run EV vocabulary correction on an SRT string.
 */
function fixCaptionSrt(srtText) {
  if (!srtText || typeof srtText !== "string") {
    return { raw_srt: "", cleaned_srt: "", plain_text: "", summary: [], log: [] };
  }
  const rules = getEvRules();
  const { output: cleaned_srt, log, summary } = fixSrt(srtText, rules);
  const plain_text = srtToPlainText(cleaned_srt);

  return {
    raw_srt: srtText,
    cleaned_srt,
    plain_text,
    summary,
    log,
  };
}

/**
 * Save or update caption records in the database.
 */
function saveCaptionRecord(videoId, { raw_srt, cleaned_srt, plain_text, status = "unfixed" }) {
  if (!videoId) throw new Error("videoId is required.");

  const stmt = db.prepare(`
    INSERT INTO transcripts (video_id, raw_srt, cleaned_srt, plain_text, status, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(video_id) DO UPDATE SET
      raw_srt = excluded.raw_srt,
      cleaned_srt = excluded.cleaned_srt,
      plain_text = excluded.plain_text,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `);

  stmt.run(videoId, raw_srt || "", cleaned_srt || "", plain_text || "", status);

  // Sync plain_text and caption_status with videos table
  db.prepare(`
    UPDATE videos
    SET transcript = ?,
        caption_status = ?
    WHERE youtube_id = ?
  `).run(plain_text || "", status, videoId);

  return db.prepare("SELECT * FROM transcripts WHERE video_id = ?").get(videoId);
}

/**
 * 3. YouTube Subtitle Upload via YouTube Data API v3
 * Uses OAuth2 client with https://www.googleapis.com/auth/youtube.force-ssl scope.
 * Uploads cleaned SRT stream as 'English (Edited)' without deprecated sync parameter.
 */
async function uploadCaptionsToYoutube(videoId, cleanedSrt) {
  if (!videoId) throw new Error("videoId is required for caption upload.");
  if (!cleanedSrt || !cleanedSrt.trim()) {
    throw new Error("Cannot upload empty captions. Please ensure cleaned SRT is generated.");
  }

  const authClient = getAuthenticatedClient();
  if (!authClient) {
    throw new Error(
      "YouTube OAuth is not connected or authorized with upload permissions. Please connect YouTube in Admin Settings or configure GOOGLE_REFRESH_TOKEN."
    );
  }

  const youtube = google.youtube({ version: "v3", auth: authClient });
  const mediaStream = Readable.from([cleanedSrt]);

  // Insert caption track: part: ['snippet'], snippet: { videoId, language: 'en', name: 'English (Edited)', isDraft: false }
  // Do NOT pass sync: true or deprecated sync param.
  const res = await youtube.captions.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        videoId,
        language: "en",
        name: "English (Edited)",
        isDraft: false,
      },
    },
    media: {
      mimeType: "*/*",
      body: mediaStream,
    },
  });

  const captionId = res.data?.id || null;

  // Update status in transcripts and videos table
  db.prepare(`
    UPDATE transcripts
    SET status = 'uploaded',
        youtube_caption_id = ?,
        uploaded_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE video_id = ?
  `).run(captionId, videoId);

  db.prepare(`
    UPDATE videos
    SET caption_status = 'uploaded'
    WHERE youtube_id = ?
  `).run(videoId);

  return {
    success: true,
    captionId,
    status: "uploaded",
    data: res.data,
  };
}

/**
 * 4. Exported Orchestrator: processVideoCaptions(videoId)
 * Performs full pipeline: extract raw -> fix EV vocabulary -> save -> upload to YouTube.
 */
async function processVideoCaptions(videoId) {
  if (!videoId) throw new Error("videoId is required for caption processing.");

  // Step 1: Extract public auto/timedtext captions as SRT
  const { srt, chunkCount } = await fetchRawCaptionsAsSrt(videoId);

  // Step 2: Fix EV vocabulary
  const fixed = fixCaptionSrt(srt);

  // Step 3: Save record as fixed
  saveCaptionRecord(videoId, {
    raw_srt: srt,
    cleaned_srt: fixed.cleaned_srt,
    plain_text: fixed.plain_text,
    status: "fixed",
  });

  // Step 4: Upload clean captions to YouTube
  const uploadRes = await uploadCaptionsToYoutube(videoId, fixed.cleaned_srt);

  return {
    videoId,
    success: true,
    chunkCount,
    captionId: uploadRes.captionId,
    status: "uploaded",
    summary: fixed.summary,
  };
}

module.exports = {
  fetchRawCaptionsAsSrt,
  fixCaptionSrt,
  saveCaptionRecord,
  uploadCaptionsToYoutube,
  processVideoCaptions,
  chunksToSrt,
  formatSrtTimestamp,
};
