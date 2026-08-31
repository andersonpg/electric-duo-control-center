"use strict";

const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const db = require("./db");
const articleDb = db.articleDb;
const { getYoutubeClient } = require("./youtube");

const router = express.Router();

// In-memory cache for the Ford Fathom News WP category ID
let cachedCategoryId = null;

// Helper: Escape HTML special characters
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Helper: Extract smart focus keywords for Rank Math Pro
function extractFocusKeyword(title) {
  if (!title || typeof title !== "string") return "Ford EV";
  const clean = title.replace(/[^\w\s-]/g, " ").replace(/\s+/g, " ").trim();

  // Known high-value EV topics
  const knownKeywords = [
    "F-150 Lightning",
    "Mustang Mach-E",
    "Ford Lightning",
    "Mach-E",
    "Ford EV",
    "Ford Fathom",
    "Super Duty",
    "Ranger EV",
    "Transit Custom",
    "Explorer EV",
    "Capri EV",
    "BlueCruise",
    "NACS",
    "Tesla Supercharger",
  ];

  for (const kw of knownKeywords) {
    if (new RegExp(`\\b${kw.replace(/-/g, "[-\\s]")}\\b`, "i").test(clean)) {
      return kw;
    }
  }

  // Fallback: Pick first 2-3 significant words
  const stopWords = new Set([
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "with",
    "by", "from", "up", "about", "into", "over", "after", "is", "are", "was",
    "were", "will", "new", "how", "why", "what", "video", "watch", "review",
  ]);

  const words = clean
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w.toLowerCase()));

  if (words.length >= 2) {
    return words.slice(0, 3).join(" ");
  }

  return "Ford EV";
}

// Helper: Get WordPress settings (checking app_settings table first, falling back to process.env)
function getWpConfig() {
  let siteUrl = process.env.WP_SITE_URL || "https://theelectricduo.com";
  let username = process.env.WP_USERNAME || "patricka";
  let password = process.env.WP_APPLICATION_PASSWORD || "";

  try {
    const rows = articleDb
      .prepare(
        "SELECT key, value FROM app_settings WHERE key IN ('wp_site_url', 'wp_username', 'wp_application_password')"
      )
      .all();
    rows.forEach((r) => {
      if (r.key === "wp_site_url" && r.value) siteUrl = r.value;
      if (r.key === "wp_username" && r.value) username = r.value;
      if (r.key === "wp_application_password" && r.value) password = r.value;
    });
  } catch (e) {}

  siteUrl = siteUrl.replace(/\/$/, "");
  const authStr = `${username}:${password}`;
  const authHeader = `Basic ${Buffer.from(authStr).toString("base64")}`;

  return { siteUrl, username, password, authHeader };
}

// Helper: Extract YouTube Video ID from various URL formats
function extractYoutubeVideoId(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const str = rawUrl.trim();

  try {
    const parsed = new URL(str);
    const host = parsed.hostname.toLowerCase();

    if (host === "youtu.be" || host.endsWith(".youtu.be")) {
      const id = parsed.pathname.replace(/^\//, "").split("/")[0].split("?")[0];
      if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }

    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "m.youtube.com") {
      if (parsed.searchParams.has("v")) {
        const id = parsed.searchParams.get("v");
        if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
      }
      const match = parsed.pathname.match(/\/(embed|v|shorts|live)\/([a-zA-Z0-9_-]{11})/i);
      if (match && match[2]) return match[2];
    }
  } catch (e) {}

  // Fallback regex
  const regexMatch = str.match(
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
  );
  if (regexMatch && regexMatch[1]) {
    return regexMatch[1];
  }

  return null;
}

// Helper: Clean and truncate text to 2-3 sentences (~350-400 chars)
function truncateToSentences(text, maxSentences = 3, maxChars = 420) {
  if (!text || typeof text !== "string") return "";
  const cleaned = text
    .replace(/https?:\/\/\S+/gi, "") // remove URLs
    .replace(/#\w+/g, "") // remove hashtags
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const sentences = cleaned.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [cleaned];
  const chosen = sentences.slice(0, maxSentences).map((s) => s.trim()).join(" ");

  if (chosen.length > maxChars) {
    return chosen.slice(0, maxChars).replace(/[,\s]+[^,\s]*$/, "") + "…";
  }
  return chosen;
}

// Helper: Fetch YouTube metadata via googleapis or oembed fallback
async function fetchYouTubeMetadata(videoId) {
  let title = "";
  let description = "";
  let imageUrl = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

  // 1. Try Google YouTube Data API client
  try {
    const youtube = getYoutubeClient();
    const res = await youtube.videos.list({
      part: "snippet",
      id: videoId,
    });

    const item = res.data.items?.[0];
    if (item && item.snippet) {
      title = item.snippet.title || "";
      description = item.snippet.description || "";
      const thumbs = item.snippet.thumbnails;
      imageUrl =
        thumbs?.maxres?.url ||
        thumbs?.standard?.url ||
        thumbs?.high?.url ||
        thumbs?.medium?.url ||
        imageUrl;

      return {
        title,
        summary: truncateToSentences(description, 3, 400),
        imageUrl,
      };
    }
  } catch (apiErr) {
    console.warn(`YouTube Data API lookup for ${videoId} failed, trying oEmbed fallback:`, apiErr.message);
  }

  // 2. Fallback: YouTube oEmbed + public thumbnail endpoint
  try {
    const oembedRes = await axios.get(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { timeout: 6000 }
    );
    title = oembedRes.data?.title || `YouTube Video (${videoId})`;
    description = `Watch the video on YouTube by ${oembedRes.data?.author_name || "creator"}.`;
    imageUrl = oembedRes.data?.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    return {
      title,
      summary: description,
      imageUrl,
    };
  } catch (oembedErr) {
    console.warn(`YouTube oEmbed fallback failed for ${videoId}:`, oembedErr.message);
  }

  return {
    title: `YouTube Video: ${videoId}`,
    summary: `YouTube video content for ${videoId}.`,
    imageUrl,
  };
}

// Helper: Fetch Article metadata with axios + cheerio
async function fetchArticleMetadata(articleUrl) {
  const response = await axios.get(articleUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: 10000,
    maxRedirects: 5,
  });

  const html = response.data;
  if (!html || typeof html !== "string") {
    throw new Error("Received empty HTML content from target URL");
  }

  const $ = cheerio.load(html);

  // Extract Title
  let title =
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    $('meta[property="twitter:title"]').attr("content") ||
    $("title").first().text() ||
    $("h1").first().text() ||
    "";
  title = title.replace(/\s+/g, " ").trim();

  // Extract Description / Summary
  let summary =
    $('meta[property="og:description"]').attr("content") ||
    $('meta[name="twitter:description"]').attr("content") ||
    $('meta[property="twitter:description"]').attr("content") ||
    $('meta[name="description"]').attr("content") ||
    "";

  if (!summary || summary.trim().length < 20) {
    const candidatePs = $("article p, main p, .entry-content p, .article-body p, .post-content p, p");
    candidatePs.each((_, el) => {
      const text = $(el).text().trim();
      if (
        text.length > 40 &&
        !text.toLowerCase().includes("cookie") &&
        !text.toLowerCase().includes("subscribe")
      ) {
        summary = text;
        return false;
      }
    });
  }

  summary = truncateToSentences(summary, 3, 450);

  // Extract Image URL
  let imageUrl =
    $('meta[property="og:image:secure_url"]').attr("content") ||
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $('meta[property="twitter:image"]').attr("content") ||
    $('link[rel="image_src"]').attr("href") ||
    "";

  if (!imageUrl) {
    const heroImg = $("article img, main img, .entry-content img, img").first().attr("src");
    if (heroImg) imageUrl = heroImg;
  }

  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, articleUrl).href;
    } catch (e) {}
  }

  return {
    title,
    summary,
    imageUrl: imageUrl || null,
  };
}

// Helper: Ensure the "Ford Fathom News" category exists in WordPress
async function getOrCreateFathomCategory(wpConfig) {
  if (cachedCategoryId) return cachedCategoryId;

  const categorySlug = "ford-fathom-news";
  const categoryEndpoint = `${wpConfig.siteUrl}/wp-json/wp/v2/categories`;

  try {
    const searchRes = await axios.get(`${categoryEndpoint}?slug=${categorySlug}`, {
      headers: { Authorization: wpConfig.authHeader },
      timeout: 8000,
    });

    if (Array.isArray(searchRes.data) && searchRes.data.length > 0) {
      cachedCategoryId = searchRes.data[0].id;
      console.log(`Found existing WP category "${categorySlug}" (ID: ${cachedCategoryId})`);
      return cachedCategoryId;
    }

    const createRes = await axios.post(
      categoryEndpoint,
      {
        name: "Ford Fathom News",
        slug: categorySlug,
        description: "Ford EV news, updates, and analysis curated by The Electric Duo.",
      },
      {
        headers: {
          Authorization: wpConfig.authHeader,
          "Content-Type": "application/json",
        },
        timeout: 8000,
      }
    );

    if (createRes.data && createRes.data.id) {
      cachedCategoryId = createRes.data.id;
      console.log(`Created new WP category "${categorySlug}" (ID: ${cachedCategoryId})`);
      return cachedCategoryId;
    }
  } catch (err) {
    console.warn(`Category lookup/creation for ${categorySlug} failed:`, err.response?.data?.message || err.message);
  }

  return null;
}

// Helper: Download remote image and upload to WordPress Media Library
async function uploadImageToWordPress(imageUrl, wpConfig, filenamePrefix = "fathom-news") {
  if (!imageUrl || typeof imageUrl !== "string") return null;

  try {
    const imgRes = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 12000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    const buffer = Buffer.from(imgRes.data, "binary");
    const rawContentType = imgRes.headers["content-type"] || "image/jpeg";
    const contentType = rawContentType.split(";")[0].trim().toLowerCase();

    let ext = "jpg";
    if (contentType.includes("png")) ext = "png";
    else if (contentType.includes("webp")) ext = "webp";
    else if (contentType.includes("gif")) ext = "gif";

    const filename = `${filenamePrefix}-${Date.now()}.${ext}`;
    const mediaEndpoint = `${wpConfig.siteUrl}/wp-json/wp/v2/media`;

    const uploadRes = await axios.post(mediaEndpoint, buffer, {
      headers: {
        Authorization: wpConfig.authHeader,
        "Content-Type": contentType.startsWith("image/") ? contentType : "image/jpeg",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
      timeout: 15000,
    });

    if (uploadRes.data && uploadRes.data.id) {
      console.log(`Uploaded WP featured media (ID: ${uploadRes.data.id}) for ${imageUrl}`);
      return uploadRes.data.id;
    }
  } catch (uploadErr) {
    console.warn(`WP Media upload failed for ${imageUrl}:`, uploadErr.response?.data?.message || uploadErr.message);
  }

  return null;
}

// Helper: Assemble the post HTML content with clean class-only markup
function assemblePostContent({ summary, theTake, sourceType, sourceUrl, youtubeVideoId, title }) {
  const cleanSummary = String(summary || "").trim();
  const cleanTake = String(theTake || "").trim();

  let html = "";
  if (cleanSummary) {
    html += `<p>${escapeHtml(cleanSummary)}</p>\n\n`;
  }

  html += `<!-- wp:html -->
<div class="fathom-take">
  <div class="fathom-take-header">
    <span class="fathom-take-icon">⚡</span>
    <h3 class="fathom-take-title">The Electric Duo's Take</h3>
  </div>
  <div class="fathom-take-body">${escapeHtml(cleanTake)}</div>
</div>
<!-- /wp:html -->\n\n`;

  if (sourceType === "article" && sourceUrl) {
    html += `<!-- wp:html -->
<div class="fathom-read-more-wrapper">
  <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="fathom-read-more-btn">
    <span>Read Full Article</span>
    <span class="fathom-read-more-arrow">&rarr;</span>
  </a>
</div>
<!-- /wp:html -->\n`;
  }

  if (sourceType === "video" && youtubeVideoId) {
    const videoUrl = `https://www.youtube.com/watch?v=${youtubeVideoId}`;
    html += `<!-- wp:embed {"url":"${videoUrl}","type":"video","providerNameSlug":"youtube","responsive":true,"className":"wp-block-embed-youtube"} -->
<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube fathom-video-embed">
  <div class="wp-block-embed__wrapper">
    <div class="fathom-video-frame">
      <iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(youtubeVideoId)}" title="${escapeHtml(title || "YouTube video")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
    </div>
  </div>
</figure>
<!-- /wp:embed -->\n`;
  }

  return html;
}

// Helper: Sync status of items with WordPress REST API
async function syncWpPostStatuses(items) {
  if (!Array.isArray(items) || items.length === 0) return items;

  const itemsWithPost = items.filter((it) => it.wp_post_id);
  if (itemsWithPost.length === 0) return items;

  const wpConfig = getWpConfig();
  if (!wpConfig.password) return items;

  const postIds = itemsWithPost.map((it) => it.wp_post_id);

  try {
    const postsEndpoint = `${wpConfig.siteUrl}/wp-json/wp/v2/posts`;
    const res = await axios.get(postsEndpoint, {
      params: {
        include: postIds.join(","),
        status: "publish,draft,pending,future,private,trash",
        _fields: "id,status,link",
      },
      headers: { Authorization: wpConfig.authHeader },
      timeout: 8000,
    });

    const wpPosts = Array.isArray(res.data) ? res.data : [];
    const wpMap = {};
    wpPosts.forEach((p) => {
      wpMap[p.id] = p;
    });

    const updateStmt = db.prepare(
      "UPDATE fathom_news_history SET status = ?, wp_post_url = COALESCE(?, wp_post_url) WHERE id = ?"
    );

    items.forEach((item) => {
      if (item.wp_post_id && wpMap[item.wp_post_id]) {
        const wpP = wpMap[item.wp_post_id];
        let normalizedStatus = item.status;

        if (wpP.status === "publish") {
          normalizedStatus = "published";
        } else if (wpP.status === "trash") {
          normalizedStatus = "trashed";
        } else if (wpP.status === "draft") {
          normalizedStatus = "draft_created";
        }

        const liveUrl = wpP.link || item.wp_post_url;

        if (normalizedStatus !== item.status) {
          try {
            updateStmt.run(normalizedStatus, liveUrl, item.id);
            item.status = normalizedStatus;
            item.wp_live_url = liveUrl;
          } catch (dbErr) {}
        }
      }
    });
  } catch (syncErr) {
    console.warn("WP post status sync skipped:", syncErr.response?.data?.message || syncErr.message);
  }

  return items;
}

/* ==========================================================================
   Routes
   ========================================================================== */

/**
 * 1. POST /api/fathom-news/preview
 * Fetches page metadata (YouTube API or Cheerio scraper) and checks for duplicates.
 */
router.post("/preview", async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ ok: false, error: "Please enter a valid URL." });
  }

  const trimmedUrl = url.trim();

  // 1. Check history for existing submission
  let alreadyExists = false;
  let existingRecord = null;
  try {
    const row = db.prepare("SELECT * FROM fathom_news_history WHERE source_url = ? ORDER BY id DESC LIMIT 1").get(trimmedUrl);
    if (row) {
      alreadyExists = true;
      existingRecord = row;
    }
  } catch (e) {}

  // 2. Detect if URL is YouTube vs generic article
  const youtubeVideoId = extractYoutubeVideoId(trimmedUrl);
  const sourceType = youtubeVideoId ? "video" : "article";

  try {
    let metadata;
    if (sourceType === "video") {
      metadata = await fetchYouTubeMetadata(youtubeVideoId);
    } else {
      metadata = await fetchArticleMetadata(trimmedUrl);
    }

    return res.json({
      ok: true,
      sourceType,
      title: metadata.title || "",
      summary: metadata.summary || "",
      imageUrl: metadata.imageUrl || "",
      youtubeVideoId: youtubeVideoId || null,
      sourceUrl: trimmedUrl,
      alreadyExists,
      existingRecord,
    });
  } catch (err) {
    console.warn(`Preview extraction failed for ${trimmedUrl}:`, err.message);
    return res.json({
      ok: false,
      error: `Could not auto-fetch page content (${err.message}). You can fill in the title, summary, and image manually below.`,
      canManualEntry: true,
      sourceType,
      title: "",
      summary: "",
      imageUrl: "",
      youtubeVideoId: youtubeVideoId || null,
      sourceUrl: trimmedUrl,
      alreadyExists,
      existingRecord,
    });
  }
});

/**
 * 2. POST /api/fathom-news/publish
 * Uploads media, creates category if needed, injects Rank Math Pro SEO metadata,
 * publishes draft post in WordPress, and stores in history.
 */
router.post("/publish", async (req, res) => {
  const { url, sourceType, title, summary, imageUrl, youtubeVideoId, theTake } = req.body || {};

  const cleanUrl = String(url || "").trim();
  const cleanTitle = String(title || "").trim();
  const cleanTake = String(theTake || "").trim();
  const cleanSummary = String(summary || "").trim();
  const cleanType = sourceType === "video" ? "video" : "article";
  const cleanYtId = cleanType === "video" ? youtubeVideoId || extractYoutubeVideoId(cleanUrl) : null;
  const username = req.user?.username || req.user?.name || "admin";

  if (!cleanUrl) {
    return res.status(400).json({ ok: false, error: "Source URL is required." });
  }
  if (!cleanTitle) {
    return res.status(400).json({ ok: false, error: "Post title is required." });
  }
  if (!cleanTake) {
    return res.status(400).json({ ok: false, error: "The Electric Duo's Take is required." });
  }

  const wpConfig = getWpConfig();
  if (!wpConfig.password) {
    return res.status(500).json({
      ok: false,
      error: "WordPress Application Password is not configured. Please configure it in Admin Settings.",
    });
  }

  let wpMediaId = null;
  let wpPostId = null;
  let wpPostUrl = null;

  try {
    // 1. Upload Featured Image to WordPress Media Library (if provided)
    if (imageUrl && imageUrl.trim()) {
      try {
        wpMediaId = await uploadImageToWordPress(imageUrl.trim(), wpConfig, "fathom-news");
      } catch (mediaErr) {
        console.warn("Featured image upload failed, proceeding without media ID:", mediaErr.message);
      }
    }

    // 2. Ensure Category "ford-fathom-news" exists
    const categoryId = await getOrCreateFathomCategory(wpConfig);

    // 3. Assemble HTML Content (clean class-only markup)
    const assembledContent = assemblePostContent({
      summary: cleanSummary,
      theTake: cleanTake,
      sourceType: cleanType,
      sourceUrl: cleanUrl,
      youtubeVideoId: cleanYtId,
      title: cleanTitle,
    });

    // 4. Rank Math Pro SEO metadata
    const focusKeyword = extractFocusKeyword(cleanTitle);
    const seoDescription = cleanSummary || truncateToSentences(cleanTake, 2, 160);

    // 5. Create WordPress Draft Post
    const postsEndpoint = `${wpConfig.siteUrl}/wp-json/wp/v2/posts`;
    const postPayload = {
      title: cleanTitle,
      content: assembledContent,
      status: "draft",
      meta: {
        rank_math_title: cleanTitle,
        rank_math_description: seoDescription,
        rank_math_focus_keyword: focusKeyword,
        rank_math_canonical_url: cleanType === "article" ? cleanUrl : "",
        rank_math_og_title: cleanTitle,
        rank_math_og_description: seoDescription,
        rank_math_og_image: imageUrl || "",
        rank_math_twitter_title: cleanTitle,
        rank_math_twitter_description: seoDescription,
        rank_math_twitter_image: imageUrl || "",
        rank_math_robots: ["index", "follow"],
        rank_math_news_article: true,
        rank_math_rich_snippet: "newsarticle",
      },
    };

    if (categoryId) {
      postPayload.categories = [categoryId];
    }
    if (wpMediaId) {
      postPayload.featured_media = wpMediaId;
    }

    const postRes = await axios.post(postsEndpoint, postPayload, {
      headers: {
        Authorization: wpConfig.authHeader,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    wpPostId = postRes.data?.id;
    wpPostUrl = `${wpConfig.siteUrl}/wp-admin/post.php?post=${wpPostId}&action=edit`;

    // 6. Optional Rank Math REST API updateMeta hook (if enabled)
    try {
      await axios.post(
        `${wpConfig.siteUrl}/wp-json/rankmath/v1/updateMeta`,
        {
          objectID: wpPostId,
          objectType: "post",
          meta: {
            rank_math_title: cleanTitle,
            rank_math_description: seoDescription,
            rank_math_focus_keyword: focusKeyword,
            rank_math_canonical_url: cleanType === "article" ? cleanUrl : "",
            rank_math_robots: ["index", "follow"],
            rank_math_rich_snippet: "newsarticle",
          },
        },
        {
          headers: {
            Authorization: wpConfig.authHeader,
            "Content-Type": "application/json",
          },
          timeout: 6000,
        }
      );
    } catch (rmErr) {}

    // 7. Insert successful record into SQLite fathom_news_history
    const insertStmt = db.prepare(`
      INSERT INTO fathom_news_history (
        source_url, source_type, title, summary, image_url,
        wp_media_id, the_take, youtube_video_id, wp_post_id,
        wp_post_url, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft_created', ?)
    `);

    const info = insertStmt.run(
      cleanUrl,
      cleanType,
      cleanTitle,
      cleanSummary,
      imageUrl || null,
      wpMediaId || null,
      cleanTake,
      cleanYtId || null,
      wpPostId,
      wpPostUrl,
      username
    );

    const newRecord = db.prepare("SELECT * FROM fathom_news_history WHERE id = ?").get(info.lastInsertRowid);

    return res.json({
      ok: true,
      success: true,
      wpPostId,
      wpPostUrl,
      historyItem: newRecord,
    });
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message || "Failed to publish draft to WordPress";
    console.error("Fathom News publish failed:", errorMsg);

    // Log failure record to SQLite so it does not silently disappear
    try {
      db.prepare(`
        INSERT INTO fathom_news_history (
          source_url, source_type, title, summary, image_url,
          wp_media_id, the_take, youtube_video_id, wp_post_id,
          wp_post_url, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'failed', ?)
      `).run(
        cleanUrl,
        cleanType,
        cleanTitle,
        cleanSummary,
        imageUrl || null,
        wpMediaId || null,
        cleanTake,
        cleanYtId || null,
        username
      );
    } catch (dbErr) {
      console.error("Failed to log failed fathom news history entry:", dbErr.message);
    }

    return res.status(500).json({
      ok: false,
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * 3. GET /api/fathom-news/history
 * Returns paginated history records with search and status/type filtering,
 * synced dynamically against WordPress live status.
 */
router.get("/history", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const search = req.query.search ? String(req.query.search).trim() : "";
    const status = req.query.status ? String(req.query.status).trim() : "";
    const sourceType = req.query.sourceType ? String(req.query.sourceType).trim() : "";

    let whereClauses = [];
    let params = [];

    if (search) {
      whereClauses.push("(title LIKE ? OR source_url LIKE ? OR the_take LIKE ?)");
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    if (status && (status === "draft_created" || status === "published" || status === "failed" || status === "trashed")) {
      whereClauses.push("status = ?");
      params.push(status);
    }

    if (sourceType && (sourceType === "article" || sourceType === "video")) {
      whereClauses.push("source_type = ?");
      params.push(sourceType);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const totalRow = db.prepare(`SELECT count(*) as total FROM fathom_news_history ${whereSql}`).get(...params);
    const total = totalRow ? totalRow.total : 0;

    let items = db
      .prepare(`SELECT * FROM fathom_news_history ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    // Sync status against WordPress live post data
    items = await syncWpPostStatuses(items);

    return res.json({
      ok: true,
      items,
      total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("Failed to fetch fathom news history:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 4. POST /api/fathom-news/sync-status
 * Explicitly triggers a batch sync of all historical posts against WordPress.
 */
router.post("/sync-status", async (req, res) => {
  try {
    const items = db.prepare("SELECT * FROM fathom_news_history WHERE wp_post_id IS NOT NULL ORDER BY id DESC LIMIT 100").all();
    const updated = await syncWpPostStatuses(items);
    return res.json({ ok: true, syncedCount: updated.length });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * 5. DELETE /api/fathom-news/history/:id
 * Removes a history item by ID.
 */
router.delete("/history/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ ok: false, error: "Invalid history ID" });

    db.prepare("DELETE FROM fathom_news_history WHERE id = ?").run(id);
    return res.json({ ok: true, deletedId: id });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
