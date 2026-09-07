"use strict";

const { Readable } = require("stream");
const path = require("path");
const axios = require("axios");
const { google } = require("googleapis");
const { YoutubeTranscript } = require("youtube-transcript");
let getSubtitlesFallback = null;
try {
  getSubtitlesFallback = require("youtube-caption-extractor").getSubtitles;
} catch (e) {}

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
 * Parse JSON3 formatted YouTube subtitle event data into chunks.
 */
function parseJson3Subtitles(jsonText) {
  const data = typeof jsonText === "string" ? JSON.parse(jsonText) : jsonText;
  const events = data?.events || [];
  const chunks = [];
  for (const ev of events) {
    if (!ev.segs || ev.aAppend === 1) continue;
    const raw = ev.segs.map((s) => s.utf8 || "").join("");
    const text = decodeHtmlEntities(raw.replace(/<[^>]+>/g, "")).trim();
    if (!text || text === "\n") continue;
    const startMs = ev.tStartMs || 0;
    const durMs = ev.dDurationMs || 0;
    chunks.push({
      offset: startMs,
      duration: Math.max(durMs, 500),
      text,
    });
  }
  return chunks;
}

/**
 * Parse XML formatted YouTube subtitle data (srv3 or classic) into chunks.
 */
function parseXmlSubtitles(xmlText) {
  const chunks = [];
  if (typeof xmlText !== "string") return chunks;

  // srv3 format: <p t="ms" d="ms">...<s>text</s>...</p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(xmlText)) !== null) {
    const rawText = pMatch[3].replace(/<[^>]+>/g, "");
    const text = decodeHtmlEntities(rawText).trim();
    if (text) {
      chunks.push({
        offset: parseInt(pMatch[1], 10),
        duration: Math.max(parseInt(pMatch[2], 10), 500),
        text,
      });
    }
  }
  if (chunks.length > 0) return chunks;

  // Classic format: <text start="sec" dur="sec">text</text>
  const textRegex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
  let tMatch;
  while ((tMatch = textRegex.exec(xmlText)) !== null) {
    const text = decodeHtmlEntities(tMatch[3].replace(/<[^>]+>/g, "")).trim();
    if (text) {
      chunks.push({
        offset: Math.round(parseFloat(tMatch[1]) * 1000),
        duration: Math.round(parseFloat(tMatch[2]) * 1000),
        text,
      });
    }
  }
  return chunks;
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
        const downloadRes = await youtube.captions.download({
          id: track.id,
          tfmt: "srt",
        });
        if (downloadRes.data && typeof downloadRes.data === "string" && downloadRes.data.trim()) {
          console.log(`[Captions] Official API successfully downloaded caption track ${track.id}`);
          const srt = downloadRes.data;
          const chunkCount = (srt.match(/-->/g) || []).length;
          return { srt, chunkCount, source: "official_api" };
        }
      } catch (dlErr) {
        // May fail on ASR tracks
      }
    }
  } catch (err) {
    // Official API list failed or unauthenticated
  }
  return null;
}

const CLIENT_PROFILES = [
  {
    name: "android",
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
  },
  {
    name: "ios",
    clientName: "IOS",
    clientVersion: "20.10.4",
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    context: {
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      platform: "MOBILE",
      osName: "iOS",
      osVersion: "18.3.2.22D82",
    },
  },
  {
    name: "android_vr",
    clientName: "ANDROID_VR",
    clientVersion: "1.62.20",
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.62.20 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    context: {
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      platform: "MOBILE",
      osName: "Android",
      osVersion: "12L",
      androidSdkVersion: 32,
    },
  },
];

/**
 * Fetch subtitle chunks directly from YouTube InnerTube player endpoint.
 */
async function fetchInnerTubeCaptions(videoId) {
  const failures = [];

  for (const client of CLIENT_PROFILES) {
    try {
      const body = {
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: "en",
            gl: "US",
            ...(client.context || {}),
          },
          user: { lockedSafetyMode: false },
          request: { useSsl: true },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      };

      const headers = {
        "Content-Type": "application/json",
        "User-Agent": client.userAgent,
      };

      const res = await axios.post(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        body,
        { headers, timeout: 10000 }
      );

      const playability = res.data?.playabilityStatus?.status;
      if (playability && playability !== "OK") {
        const reason = res.data?.playabilityStatus?.reason || "";
        failures.push(`${client.name}: ${playability}${reason ? ` - ${reason}` : ""}`);
        continue;
      }

      const tracks = res.data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (!tracks || tracks.length === 0) {
        failures.push(`${client.name}: OK but no caption tracks`);
        continue;
      }

      const track =
        tracks.find((t) => t.vssId === ".en") ||
        tracks.find((t) => t.vssId === "a.en") ||
        tracks.find((t) => t.languageCode === "en") ||
        tracks.find((t) => t.vssId?.includes("en")) ||
        tracks.find((t) => t.languageCode?.startsWith("en")) ||
        tracks[0];

      // 1. Try json3
      try {
        const jsonUrl = track.baseUrl.replace(/&fmt=[^&]+/, "") + "&fmt=json3";
        const jsonRes = await axios.get(jsonUrl, {
          headers: { "User-Agent": client.userAgent },
          timeout: 10000,
        });
        const chunks = parseJson3Subtitles(jsonRes.data);
        if (chunks && chunks.length > 0) {
          return { chunks, client: client.name };
        }
      } catch (jsonErr) {}

      // 2. Fall back to XML (srv3 / classic)
      try {
        const xmlRes = await axios.get(track.baseUrl, {
          headers: { "User-Agent": client.userAgent },
          timeout: 10000,
        });
        const chunks = parseXmlSubtitles(xmlRes.data);
        if (chunks && chunks.length > 0) {
          return { chunks, client: client.name };
        }
      } catch (xmlErr) {
        failures.push(`${client.name}: timedtext fetch error: ${xmlErr.message}`);
      }
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message || err.message;
      failures.push(`${client.name}: ${status ? status + " " : ""}${msg}`);
    }
  }

  const err = new Error(`InnerTube extraction failed: ${failures.join("; ")}`);
  err.failures = failures;
  throw err;
}

/**
 * 1. Caption Retrieval: Bypass official API restriction to fetch auto-generated/public captions.
 * Reconstructs chunks into compliant SRT.
 */
async function fetchRawCaptionsAsSrt(videoId) {
  if (!videoId || typeof videoId !== "string") {
    throw new Error("Invalid or missing videoId for caption extraction.");
  }

  // Step 1: Check official YouTube Data API v3 (for channel's existing/uploaded captions)
  const officialResult = await fetchViaOfficialApi(videoId);
  if (officialResult && officialResult.srt && officialResult.srt.trim()) {
    return officialResult;
  }

  let chunks = null;
  let lastError = null;
  let sawLoginRequired = false;

  // Step 2: Attempt direct InnerTube
  try {
    const res = await fetchInnerTubeCaptions(videoId);
    if (res && res.chunks && res.chunks.length > 0) {
      chunks = res.chunks;
    }
  } catch (err) {
    lastError = err;
    if (err.message && err.message.includes("LOGIN_REQUIRED")) {
      sawLoginRequired = true;
    }
  }

  // Step 3: Fallback to youtube-transcript
  if (!chunks || chunks.length === 0) {
    try {
      chunks = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    } catch (err) {
      lastError = err;
      if (err.message && (err.message.includes("LOGIN_REQUIRED") || err.message.includes("too many requests") || err.message.includes("captcha"))) {
        sawLoginRequired = true;
      }
    }
  }

  if (!chunks || chunks.length === 0) {
    try {
      chunks = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (err) {
      lastError = err;
    }
  }

  // Step 4: Fallback to youtube-caption-extractor
  if ((!chunks || chunks.length === 0) && getSubtitlesFallback) {
    try {
      const subs = await getSubtitlesFallback({ videoID: videoId, lang: "en" });
      if (subs && subs.length > 0) {
        chunks = subs;
      }
    } catch (err) {
      lastError = err;
      if (err.message && err.message.includes("LOGIN_REQUIRED")) {
        sawLoginRequired = true;
      }
    }
  }

  if (!chunks || chunks.length === 0) {
    const errorMsg = lastError ? lastError.message : "No captions found";

    if (sawLoginRequired || errorMsg.includes("LOGIN_REQUIRED") || errorMsg.includes("captcha")) {
      const botErr = new Error(
        "YouTube blocked automated transcript retrieval on this cloud server (bot protection / LOGIN_REQUIRED). YouTube restricts cloud/datacenter IPs from downloading transcripts. You can copy the transcript from YouTube and paste it directly using Quick Paste."
      );
      botErr.isCloudIpBlock = true;
      botErr.canQuickPaste = true;
      botErr.youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
      throw botErr;
    }

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
    source: "innertube",
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
  convertRawTranscriptToSrt,
};
