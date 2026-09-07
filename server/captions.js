"use strict";

const { Readable } = require("stream");
const path = require("path");
const { google } = require("googleapis");

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
 * Convert raw text (e.g. copied from YouTube transcript panel with or without timestamps)
 * or plain text into a strictly compliant SubRip (.srt) timestamped string.
 * If already in SRT format (contains -->), returns as-is.
 */
function convertRawTranscriptToSrt(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  const trimmed = rawText.trim();
  if (/-->/.test(trimmed)) return trimmed;

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cues = [];
  let currentMs = null;
  let currentText = [];

  function parseStampToMs(stamp) {
    const parts = stamp.split(":").map(Number);
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
    if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    return 0;
  }

  const stampOnlyRegex = /^\d{1,2}:\d{2}(?::\d{2})?$/;
  const stampInlineRegex = /^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inlineMatch = line.match(stampInlineRegex);
    if (stampOnlyRegex.test(line)) {
      if (currentMs !== null && currentText.length > 0) {
        const nextMs = parseStampToMs(line);
        const durMs = Math.max(nextMs - currentMs, 1000);
        cues.push({ startMs: currentMs, endMs: currentMs + durMs, text: currentText.join(" ") });
        currentText = [];
      }
      currentMs = parseStampToMs(line);
    } else if (inlineMatch) {
      if (currentMs !== null && currentText.length > 0) {
        const nextMs = parseStampToMs(inlineMatch[1]);
        const durMs = Math.max(nextMs - currentMs, 1000);
        cues.push({ startMs: currentMs, endMs: currentMs + durMs, text: currentText.join(" ") });
        currentText = [];
      }
      currentMs = parseStampToMs(inlineMatch[1]);
      currentText.push(inlineMatch[2]);
    } else {
      currentText.push(line);
    }
  }

  if (currentMs !== null && currentText.length > 0) {
    cues.push({ startMs: currentMs, endMs: currentMs + 5000, text: currentText.join(" ") });
  }

  if (cues.length > 0) {
    return cues
      .map(
        (c, idx) =>
          `${idx + 1}\n${formatSrtTimestamp(c.startMs)} --> ${formatSrtTimestamp(c.endMs)}\n${c.text}\n`
      )
      .join("\n");
  }

  // Plain paragraphs: create 5-second pseudo-cues
  const sentences = trimmed.split(/(?<=[.!?])\s+|\n\n+/).filter(Boolean);
  let cursorMs = 0;
  return sentences
    .map((sent, idx) => {
      const startStamp = formatSrtTimestamp(cursorMs);
      cursorMs += 5000;
      const endStamp = formatSrtTimestamp(cursorMs);
      return `${idx + 1}\n${startStamp} --> ${endStamp}\n${sent.trim()}\n`;
    })
    .join("\n");
}

/**
 * Attempt to download captions via official authenticated YouTube Data API v3.
 * Works without any IP bot blocking for videos with official or uploaded caption tracks.
 */
async function fetchViaOfficialApi(videoId) {
  try {
    const authClient = getAuthenticatedClient();
    if (!authClient) return null;

    const youtube = google.youtube({ version: "v3", auth: authClient });
    const listRes = await youtube.captions.list({
      videoId,
      part: ["snippet"],
    });

    const items = listRes.data?.items || [];
    if (!items || items.length === 0) return null;

    console.log(`[Captions] Official API found ${items.length} track(s) for ${videoId}`);

    // Prioritize manual English tracks, then any English track, then any track
    const sorted = [...items].sort((a, b) => {
      const aEn = (a.snippet?.language || "").startsWith("en") ? 1 : 0;
      const bEn = (b.snippet?.language || "").startsWith("en") ? 1 : 0;
      const aManual = a.snippet?.trackKind !== "ASR" ? 2 : 0;
      const bManual = b.snippet?.trackKind !== "ASR" ? 2 : 0;
      return (bEn + bManual) - (aEn + aManual);
    });

    for (const track of sorted) {
      try {
        const downloadRes = await youtube.captions.download(
          { id: track.id, tfmt: "srt" },
          { responseType: "text" }
        );

        let body = downloadRes.data;
        if (body && typeof body !== "string") {
          if (Buffer.isBuffer(body)) body = body.toString("utf8");
          else if (typeof body.text === "function") body = await body.text();
          else if (typeof body.arrayBuffer === "function") body = Buffer.from(await body.arrayBuffer()).toString("utf8");
          else body = String(body);
        }
        if (body && body.trim()) {
          console.log(`[Captions] Official API successfully downloaded caption track ${track.id}`);
          const srt = body;
          const chunkCount = (srt.match(/-->/g) || []).length;
          return { srt, chunkCount, source: "official_api" };
        }
      } catch (dlErr) {
        console.warn(`[Captions] Official API error downloading track ${track.id}:`, dlErr.message || dlErr);
      }
    }
  } catch (err) {
    console.warn(`[Captions] Official API error for video ${videoId}:`, err.message || err);
    const status = err.status || (err.response && err.response.status) || (typeof err.code === "number" ? err.code : null);
    const msg = (err.message || "").toLowerCase();

    if (
      status === 403 ||
      msg.includes("insufficientpermissions") ||
      msg.includes("forbidden") ||
      msg.includes("insufficient authentication scopes")
    ) {
      const scopeErr = new Error(
        "The YouTube connection is missing the youtube.force-ssl permission and must be reconnected in Admin Settings."
      );
      scopeErr.isScopeError = true;
      throw scopeErr;
    }

    if (status === 401) {
      const authErr = new Error("YouTube authentication failed or expired. Please sign in again in Admin Settings.");
      authErr.isAuthError = true;
      throw authErr;
    }

    return null;
  }
  return null;
}

/**
 * 1. Caption Retrieval: Official YouTube Data API v3 for channel videos.
 */
async function fetchRawCaptionsAsSrt(videoId) {
  if (!videoId || typeof videoId !== "string") {
    throw new Error("Invalid or missing videoId for caption extraction.");
  }

  // Call official YouTube Data API v3 (for channel's existing/uploaded captions)
  const officialResult = await fetchViaOfficialApi(videoId);
  if (officialResult && officialResult.srt && officialResult.srt.trim()) {
    return officialResult;
  }

  // On null result, throw clear error with canQuickPaste = true
  const err = new Error("No downloadable caption track exists for this video yet.");
  err.canQuickPaste = true;
  err.youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  throw err;
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
  formatSrtTimestamp,
  convertRawTranscriptToSrt,
};
