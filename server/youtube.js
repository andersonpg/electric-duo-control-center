"use strict";

require("dotenv").config();
const { google } = require("googleapis");
const axios = require("axios");
const db = require("./db").articleDb;
const { getAuthenticatedClient, isOAuthConnected } = require("./youtube-analytics");

function getYoutubeApiKey() {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'youtube_api_key'").get();
    if (row && row.value && row.value.trim().length > 10) return row.value.trim();
  } catch (e) {}
  return process.env.YOUTUBE_API_KEY;
}

function getYoutubeChannelId() {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'youtube_channel_id'").get();
    if (row && row.value && row.value.trim().length > 5) return row.value.trim();
  } catch (e) {}
  return process.env.YOUTUBE_CHANNEL_ID || "UCuhhyTS-Q66qq-gWrCcTOzg";
}

function getYoutubeClient(preferApiKey = false) {
  // If preferApiKey is false and OAuth2 is connected, try OAuth client first
  if (!preferApiKey && isOAuthConnected()) {
    try {
      const oauthClient = getAuthenticatedClient();
      if (oauthClient) {
        return google.youtube({ version: "v3", auth: oauthClient });
      }
    } catch (e) {
      console.warn("OAuth client init failed, falling back to API Key:", e.message);
    }
  }

  const apiKey = getYoutubeApiKey();
  if (apiKey) {
    return google.youtube({
      version: "v3",
      auth: apiKey,
    });
  }

  // Fallback to OAuth client if apiKey not found
  if (isOAuthConnected()) {
    const oauthClient = getAuthenticatedClient();
    if (oauthClient) {
      return google.youtube({ version: "v3", auth: oauthClient });
    }
  }

  throw new Error("YouTube API Key is not configured. Please set YOUTUBE_API_KEY or connect via Google OAuth in Admin Settings.");
}

async function getUploadsPlaylistId(channelId) {
  const youtube = getYoutubeClient();
  const res = await youtube.channels.list({
    part: "contentDetails",
    id: channelId,
  });

  const items = res.data.items;
  if (!items || items.length === 0) {
    throw new Error(`YouTube Channel not found for ID: ${channelId}`);
  }

  return items[0].contentDetails.relatedPlaylists.uploads;
}

async function fetchExactPublishDate(vId) {
  try {
    const res = await axios.get(`https://www.youtube.com/watch?v=${vId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 6000,
    });
    const html = res.data;

    const dateTextMatch = html.match(/"dateText":\{"simpleText":"([^"]+)"\}/);
    if (dateTextMatch && dateTextMatch[1]) {
      const d = new Date(dateTextMatch[1]);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

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
    console.warn(`Could not fetch exact date for ${vId}:`, e.message);
  }
  return null;
}

// Convert "18:06", "1:24:10", or "0:45" to ISO 8601 duration "PT18M6S"
function formatDurationToIso(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return "PT15M00S";
  const parts = timeStr.trim().split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return "PT15M00S";

  if (parts.length === 2) {
    const [min, sec] = parts;
    return `PT${min}M${sec}S`;
  } else if (parts.length === 3) {
    const [hr, min, sec] = parts;
    return `PT${hr}H${min}M${sec}S`;
  }
  return "PT15M00S";
}

// Extract video duration directly from search result without quota usage
async function fetchVideoDurationDirect(vId) {
  try {
    const res = await axios.get(`https://www.youtube.com/results?search_query=${vId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 5000,
    });
    const html = res.data;
    const match = html.match(/"lengthText":\{"accessibility":\{"accessibilityData":\{"label":"[^"]+"\}\},"simpleText":"([^"]+)"\}/);
    if (match && match[1]) {
      return formatDurationToIso(match[1]);
    }
  } catch (e) {}
  return null;
}

// Backfill real exact durations across all videos in the database
async function syncAllVideoDurations() {
  const videos = db.prepare("SELECT youtube_id, title, duration FROM videos").all();
  if (!videos || videos.length === 0) return { updated: 0, total: 0 };

  const updateStmt = db.prepare("UPDATE videos SET duration = ? WHERE youtube_id = ?");
  let updatedCount = 0;
  let apiSuccess = false;

  // 1. Try YouTube Data API (OAuth or API Key)
  try {
    const youtube = getYoutubeClient();
    const videoIds = videos.map((v) => v.youtube_id);

    for (let i = 0; i < videoIds.length; i += 50) {
      const chunk = videoIds.slice(i, i + 50);
      const res = await youtube.videos.list({
        part: "contentDetails,snippet",
        id: chunk.join(","),
      });

      const items = res.data.items || [];
      for (const item of items) {
        const vId = item.id;
        const duration = item.contentDetails?.duration;
        if (duration) {
          updateStmt.run(duration, vId);
          updatedCount++;
        }
      }
    }
    apiSuccess = true;
  } catch (apiErr) {
    console.warn("YouTube API quota exceeded or error, using direct duration parser fallback:", apiErr.message);
  }

  // 2. If API was blocked by quota, run direct zero-quota extractor
  if (!apiSuccess) {
    const targets = videos.filter((v) => !v.duration || v.duration === "PT15M00S" || v.duration === "PT15M");
    const listToProcess = targets.length > 0 ? targets : videos;

    for (let i = 0; i < listToProcess.length; i += 8) {
      const chunk = listToProcess.slice(i, i + 8);
      await Promise.all(
        chunk.map(async (v) => {
          const exactDuration = await fetchVideoDurationDirect(v.youtube_id);
          if (exactDuration && exactDuration !== "PT15M00S") {
            updateStmt.run(exactDuration, v.youtube_id);
            updatedCount++;
          }
        })
      );
    }
  }

  return { updated: updatedCount, total: videos.length, apiSuccess };
}

// 1. YouTube Data API v3 Sync Engine
async function syncCatalogViaYouTubeApi(mode = "delta") {
  const channelId = getYoutubeChannelId();
  const youtube = getYoutubeClient();
  const uploadsPlaylistId = await getUploadsPlaylistId(channelId);

  const insertVideoStmt = db.prepare(`
    INSERT INTO videos (youtube_id, title, description, published_at, thumbnail_url, duration)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(youtube_id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      thumbnail_url = excluded.thumbnail_url,
      published_at = excluded.published_at,
      duration = excluded.duration,
      last_synced_at = CURRENT_TIMESTAMP
  `);

  const checkExistsStmt = db.prepare("SELECT youtube_id FROM videos WHERE youtube_id = ?");

  let pageToken = null;
  let newCount = 0;
  let totalProcessed = 0;

  do {
    const playlistRes = await youtube.playlistItems.list({
      part: "snippet,contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken: pageToken || undefined,
    });

    const items = playlistRes.data.items || [];
    if (items.length === 0) break;

    const videoIds = items.map((item) => item.contentDetails.videoId);

    let durationMap = {};
    let realPublishDateMap = {};
    try {
      const videosRes = await youtube.videos.list({
        part: "snippet,contentDetails",
        id: videoIds.join(","),
      });

      (videosRes.data.items || []).forEach((v) => {
        durationMap[v.id] = v.contentDetails?.duration || "";
        if (v.snippet?.publishedAt) {
          realPublishDateMap[v.id] = v.snippet.publishedAt;
        }
      });
    } catch (e) {}

    let hitExistingInDelta = false;

    for (const item of items) {
      const vId = item.contentDetails.videoId;
      const snippet = item.snippet;
      const title = snippet.title;
      const description = snippet.description;
      const publishedAt = realPublishDateMap[vId] || snippet.publishedAt || item.contentDetails.videoPublishedAt || new Date().toISOString();
      const thumbnailUrl = `https://img.youtube.com/vi/${vId}/maxresdefault.jpg`;
      const duration = durationMap[vId] || "PT15M00S";

      const exists = checkExistsStmt.get(vId);

      insertVideoStmt.run(vId, title, description, publishedAt, thumbnailUrl, duration);

      if (!exists) {
        newCount++;
      } else if (mode === "delta") {
        hitExistingInDelta = true;
      }

      totalProcessed++;
    }

    if (mode === "delta" && hitExistingInDelta) {
      break;
    }

    pageToken = playlistRes.data.nextPageToken;
  } while (pageToken);

  return { newCount, totalProcessed, mode, isScraped: false };
}

// 2. Full Continuation Scraper Sync Engine Fallback
async function syncRealChannelVideosScraper(mode = "delta") {
  const channelUrl = "https://www.youtube.com/@TheElectricDuo/videos";

  const htmlRes = await axios.get(channelUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const html = htmlRes.data;
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const apiKey = apiKeyMatch ? apiKeyMatch[1] : null;

  const match = html.match(/var ytInitialData = ({.*?});<\/script>/);
  if (!match) throw new Error("Could not parse YouTube channel initial data.");

  const data = JSON.parse(match[1]);
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const videosTab = tabs.find((t) => t.tabRenderer?.title === "Videos" || t.tabRenderer?.selected);
  const contents = videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];

  const videoIds = new Set();

  function extractItems(items) {
    let nextTok = null;
    items.forEach((item) => {
      const str = JSON.stringify(item);
      const matches = str.match(/\/vi\/([a-zA-Z0-9_-]{11})\//g) || [];
      matches.forEach((m) => {
        const id = m.replace("/vi/", "").replace("/", "");
        videoIds.add(id);
      });

      if (item.continuationItemRenderer) {
        nextTok = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
      }
    });
    return nextTok;
  }

  let token = extractItems(contents);
  let page = 1;
  const maxPages = mode === "delta" ? 2 : 40;

  while (token && page < maxPages) {
    page++;
    try {
      const contRes = await axios.post(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240101.00.00",
          },
        },
        continuation: token,
      });

      const actions = contRes.data.onResponseReceivedActions || [];
      let newItems = [];
      actions.forEach((act) => {
        const gridCont = act.appendContinuationItemsAction?.continuationItems;
        if (gridCont) newItems = newItems.concat(gridCont);
      });

      token = extractItems(newItems);
    } catch (e) {
      break;
    }
  }

  const allVideoIds = Array.from(videoIds);

  const insertVideoStmt = db.prepare(`
    INSERT INTO videos (youtube_id, title, description, published_at, thumbnail_url, duration, content_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(youtube_id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      thumbnail_url = excluded.thumbnail_url,
      published_at = COALESCE(excluded.published_at, videos.published_at),
      last_synced_at = CURRENT_TIMESTAMP
  `);

  const checkExistsStmt = db.prepare("SELECT youtube_id, published_at FROM videos WHERE youtube_id = ?");

  let newCount = 0;
  let totalProcessed = 0;

  for (let i = 0; i < allVideoIds.length; i += 8) {
    const chunk = allVideoIds.slice(i, i + 8);
    await Promise.all(
      chunk.map(async (vId) => {
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${vId}&format=json`;
          const oembedRes = await axios.get(oembedUrl);
          const data = oembedRes.data;

          const title = data.title || "Electric Duo Video";
          const thumbnailUrl = `https://img.youtube.com/vi/${vId}/maxresdefault.jpg`;
          const description = `Watch the official video "${title}" on The Electric Duo YouTube channel.`;

          const exists = checkExistsStmt.get(vId);

          let publishedAt = exists && exists.published_at ? exists.published_at : null;
          if (!publishedAt) {
            publishedAt = (await fetchExactPublishDate(vId)) || new Date().toISOString();
          }

          let contentType = "Review";
          const lowerTitle = title.toLowerCase();
          if (lowerTitle.includes("how to") || lowerTitle.includes("guide") || lowerTitle.includes("setup")) {
            contentType = "How-To / Instructional";
          } else if (lowerTitle.includes("news") || lowerTitle.includes("update") || lowerTitle.includes("202")) {
            contentType = "EV News";
          } else if (lowerTitle.includes("trip") || lowerTitle.includes("road") || lowerTitle.includes("vlog")) {
            contentType = "Road Trip / Vlog";
          }

          insertVideoStmt.run(vId, title, description, publishedAt, thumbnailUrl, "PT15M00S", contentType);

          if (!exists) {
            newCount++;
          }

          totalProcessed++;
        } catch (err) {
          console.warn(`Failed metadata for ${vId}:`, err.message);
        }
      })
    );
  }

  return { newCount, totalProcessed, mode, isScraped: true };
}

async function syncCatalog(mode = "delta") {
  try {
    return await syncCatalogViaYouTubeApi(mode);
  } catch (apiErr) {
    console.warn("YouTube Data API call unavailable, attempting fallback scraper:", apiErr.message);
    return await syncRealChannelVideosScraper(mode);
  }
}

module.exports = {
  syncCatalog,
  syncAllVideoDurations,
  getYoutubeApiKey,
  getYoutubeChannelId,
  getYoutubeClient,
  fetchExactPublishDate,
};
