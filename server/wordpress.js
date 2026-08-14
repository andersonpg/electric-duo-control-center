"use strict";

const axios = require("axios");

function getAuthHeader() {
  const username = process.env.WP_USERNAME;
  const password = process.env.WP_APPLICATION_PASSWORD;
  const authStr = `${username}:${password}`;
  const base64Auth = Buffer.from(authStr).toString("base64");
  return `Basic ${base64Auth}`;
}

// Convert raw HTML elements into native WordPress Gutenberg block markup
function convertToGutenbergBlocks(htmlContent, youtubeId) {
  let blocksHtml = htmlContent;

  // 1. Wrap <h2> headings into wp:heading
  blocksHtml = blocksHtml.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (match, p1) => {
    return `\n<!-- wp:heading {"level":2} -->\n<h2>${p1.trim()}</h2>\n<!-- /wp:heading -->\n`;
  });

  // 2. Wrap <h3> headings into wp:heading
  blocksHtml = blocksHtml.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (match, p1) => {
    return `\n<!-- wp:heading {"level":3} -->\n<h3>${p1.trim()}</h3>\n<!-- /wp:heading -->\n`;
  });

  // 3. Wrap <p> paragraphs into wp:paragraph
  blocksHtml = blocksHtml.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (match, p1) => {
    if (!p1.trim()) return "";
    return `\n<!-- wp:paragraph -->\n<p>${p1.trim()}</p>\n<!-- /wp:paragraph -->\n`;
  });

  // 4. Wrap <ul> lists into wp:list
  blocksHtml = blocksHtml.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, p1) => {
    return `\n<!-- wp:list -->\n<ul>${p1.trim()}</ul>\n<!-- /wp:list -->\n`;
  });

  // 5. Wrap <ol> lists into wp:list
  blocksHtml = blocksHtml.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, p1) => {
    return `\n<!-- wp:list {"ordered":true} -->\n<ol>${p1.trim()}</ol>\n<!-- /wp:list -->\n`;
  });

  // 6. Wrap <table> into wp:table
  blocksHtml = blocksHtml.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, p1) => {
    return `\n<!-- wp:table -->\n<figure class="wp-block-table"><table>${p1.trim()}</table></figure>\n<!-- /wp:table -->\n`;
  });

  // 7. Add native Gutenberg YouTube Embed Block at bottom
  const videoUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
  const embedBlock = `\n<!-- wp:embed {"url":"${videoUrl}","type":"video","providerNameSlug":"youtube","responsive":true,"className":"wp-block-embed-youtube"} -->
<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube"><div class="wp-block-embed__wrapper">
${videoUrl}
</div></figure>
<!-- /wp:embed -->\n`;

  return `${blocksHtml.trim()}\n\n${embedBlock}`;
}

// Format ISO date string into YYYY-MM-DDTHH:MM:SS for WordPress REST API
function formatWpDate(dateStr) {
  if (!dateStr) return new Date().toISOString().split(".")[0];
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date().toISOString().split(".")[0];

  const pad = (n) => String(n).padStart(2, "0");
  const year = d.getUTCFullYear();
  const month = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const hours = pad(d.getUTCHours());
  const minutes = pad(d.getUTCMinutes());
  const seconds = pad(d.getUTCSeconds());

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

async function uploadThumbnail(youtubeId, thumbnailUrl) {
  const wpSiteUrl = (process.env.WP_SITE_URL || "https://theelectricduo.com").replace(/\/$/, "");
  const mediaEndpoint = `${wpSiteUrl}/wp-json/wp/v2/media`;

  const highResUrl = `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`;
  const sdResUrl = `https://img.youtube.com/vi/${youtubeId}/sddefault.jpg`;
  const fallbackUrl = thumbnailUrl || `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`;

  const urlsToTry = [highResUrl, sdResUrl, fallbackUrl];

  for (const imgUrl of urlsToTry) {
    try {
      const imageRes = await axios.get(imgUrl, { responseType: "arraybuffer", timeout: 8000 });
      const imageBuffer = Buffer.from(imageRes.data, "binary");

      const uploadRes = await axios.post(mediaEndpoint, imageBuffer, {
        headers: {
          Authorization: getAuthHeader(),
          "Content-Type": "image/jpeg",
          "Content-Disposition": `attachment; filename="${youtubeId}-maxres.jpg"`,
        },
      });

      if (uploadRes.data && uploadRes.data.id) {
        console.log(`Uploaded high-res thumbnail for ${youtubeId} using ${imgUrl}`);
        return uploadRes.data.id;
      }
    } catch (error) {
      console.warn(`Image upload attempt for ${imgUrl} failed:`, error.response?.status || error.message);
    }
  }

  return null;
}

async function createWordPressDraft({ youtubeId, title, htmlContent, publishedAt, thumbnailUrl }) {
  const wpSiteUrl = (process.env.WP_SITE_URL || "https://theelectricduo.com").replace(/\/$/, "");
  const postsEndpoint = `${wpSiteUrl}/wp-json/wp/v2/posts`;

  // 1. Upload Featured Image
  let featuredMediaId = null;
  try {
    featuredMediaId = await uploadThumbnail(youtubeId, thumbnailUrl);
  } catch (err) {
    console.warn("Thumbnail upload skipped:", err.message);
  }

  // 2. Format native Gutenberg blocks HTML with embedded YouTube video
  const gutenbergContent = convertToGutenbergBlocks(htmlContent, youtubeId);

  // 3. Format exact date to YYYY-MM-DDTHH:MM:SS
  const formattedDate = formatWpDate(publishedAt);

  const postBody = {
    title: title,
    content: gutenbergContent,
    status: "draft",
    date: formattedDate,
    date_gmt: formattedDate,
  };

  if (featuredMediaId) {
    postBody.featured_media = featuredMediaId;
  }

  const postRes = await axios.post(postsEndpoint, postBody, {
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
  });

  const wpPostId = postRes.data.id;
  const wpDraftUrl = `${wpSiteUrl}/wp-admin/post.php?post=${wpPostId}&action=edit`;

  return { wpPostId, wpDraftUrl };
}

module.exports = { createWordPressDraft };
