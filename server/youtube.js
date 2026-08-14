"use strict";

const { google } = require("googleapis");
const axios = require("axios");
const db = require("./db").articleDb;

const youtube = google.youtube({
  version: "v3",
  auth: process.env.YOUTUBE_API_KEY,
});

async function getUploadsPlaylistId(channelId) {
  const res = await youtube.channels.list({
    part: "contentDetails",
    id: channelId,
  });

  const items = res.data.items;
  if (!items || items.length === 0) {
    throw new Error(`Channel not found for ID: ${channelId}`);
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

    // 1. Try dateText in initial JSON
    const dateTextMatch = html.match(/"dateText":\{"simpleText":"([^"]+)"\}/);
    if (dateTextMatch && dateTextMatch[1]) {
      const d = new Date(dateTextMatch[1]);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    // 2. Try publishDate / uploadDate microformat in JSON
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

// 1. YouTube Data API v3 Sync Engine
async function syncCatalogViaYouTubeApi(mode = "delta") {
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!channelId || !process.env.YOUTUBE_API_KEY) {
    throw new Error("YouTube API Key or Channel ID missing.");
  }

  const uploadsPlaylistId = await getUploadsPlaylistId(channelId);

  const insertVideoStmt = db.prepare(`
    INSERT INTO videos (youtube_id, title, description, published_at, thumbnail_url, duration)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(youtube_id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      thumbnail_url = excluded.thumbnail_url,
      published_at = excluded.published_at,
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
      const duration = durationMap[vId] || "";

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

// 2. Full 500+ Video Continuation Scraper Sync Engine with Real Watch Page Publish Dates
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
  if (!match) throw new Error("Could not parse channel initial data.");

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
    console.warn("YouTube Data API call not available, running exact date continuation sync engine:", apiErr.message);
    return await syncRealChannelVideosScraper(mode);
  }
}

module.exports = { syncCatalog, fetchExactPublishDate };
