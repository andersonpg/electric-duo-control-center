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
 * Fetch OAuth access token if Google OAuth is connected.
 * Handles automatic token refresh if token is expired.
 */
async function getOAuthAccessToken() {
  try {
    const authClient = getAuthenticatedClient();
    if (!authClient) return null;
    const tokenRes = await authClient.getAccessToken();
    return tokenRes?.token || (typeof tokenRes === "string" ? tokenRes : null);
  } catch (err) {
    console.warn("[Captions] Could not obtain OAuth access token:", err.message);
    return null;
  }
}

const CLIENT_PROFILES = [
  {
    name: "android",
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    clientNameHeader: "3",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
  },
  {
    name: "ios",
    clientName: "IOS",
    clientVersion: "20.10.4",
    clientNameHeader: "5",
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
    clientNameHeader: "28",
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
  {
    name: "mweb",
    clientName: "MWEB",
    clientVersion: "2.20251209.01.00",
    clientNameHeader: "2",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    context: {
      platform: "MOBILE",
      osName: "iOS",
      osVersion: "17.5.1",
    },
  },
];

/**
 * Fetch subtitle chunks directly from YouTube InnerTube player endpoint.
 * Supports passing Google OAuth 2.0 Bearer token to bypass datacenter LOGIN_REQUIRED.
 */
async function fetchInnerTubeCaptions(videoId, authToken = null) {
  const failures = [];

  for (const client of CLIENT_PROFILES) {
    const endpoints = [
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      "https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false",
    ];

    for (const endpoint of endpoints) {
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
          "X-YouTube-Client-Name": client.clientNameHeader,
          "X-YouTube-Client-Version": client.clientVersion,
          Origin: "https://www.youtube.com",
        };
        if (authToken) {
          headers["Authorization"] = `Bearer ${authToken}`;
        }

        const res = await axios.post(endpoint, body, { headers, timeout: 10000 });
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

  let chunks = null;
  let lastError = null;
  let sawLoginRequired = false;

  // Step 1: Attempt direct InnerTube with OAuth token (if available)
  const authToken = await getOAuthAccessToken();
  if (authToken) {
    try {
      const res = await fetchInnerTubeCaptions(videoId, authToken);
      if (res && res.chunks && res.chunks.length > 0) {
        chunks = res.chunks;
      }
    } catch (err) {
      lastError = err;
      if (err.message && err.message.includes("LOGIN_REQUIRED")) {
        sawLoginRequired = true;
      }
    }
  }

  // Step 2: Attempt InnerTube unauthenticated (or if OAuth was not connected or failed)
  if (!chunks || chunks.length === 0) {
    try {
      const res = await fetchInnerTubeCaptions(videoId, null);
      if (res && res.chunks && res.chunks.length > 0) {
        chunks = res.chunks;
      }
    } catch (err) {
      lastError = err;
      if (err.message && err.message.includes("LOGIN_REQUIRED")) {
        sawLoginRequired = true;
      }
    }
  }

  // Fallback 1: youtube-transcript with English preference
  if (!chunks || chunks.length === 0) {
    try {
      chunks = await YoutubeTranscript.fetchTranscript(videoId, { lang: "en" });
    } catch (err) {
      lastError = err;
    }
  }

  // Fallback 2: youtube-transcript without language filter
  if (!chunks || chunks.length === 0) {
    try {
      chunks = await YoutubeTranscript.fetchTranscript(videoId);
    } catch (err) {
      lastError = err;
    }
  }

  // Fallback 3: youtube-caption-extractor
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

    if (sawLoginRequired || errorMsg.includes("LOGIN_REQUIRED")) {
      if (isOAuthConnected()) {
        throw new Error(
          "YouTube returned LOGIN_REQUIRED for this video. Please reconnect Google OAuth in Admin Settings with an account that has manager/owner access to the channel."
        );
      } else {
        throw new Error(
          "YouTube requires authentication to retrieve captions on this server (LOGIN_REQUIRED). Please connect Google OAuth in Admin Settings."
        );
      }
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
