"use strict";

const axios = require("axios");
const { GoogleGenAI } = require("@google/genai");
const db = require("./db").articleDb;
const { getYoutubeClient, getYoutubeChannelId } = require("./youtube");
const { getGeminiApiKey } = require("./gemini");

// How many runs to keep per competitor before pruning the oldest.
const MAX_REPORTS_PER_COMPETITOR = 12;

// ---------------------------------------------------------------------------
// Executive narrative.
//
// Instructions are editable in Admin Settings (title_prompt_settings.
// competitor_instructions). The structured data block stays assembled in code
// so a prompt edit can never break the data injection.
// ---------------------------------------------------------------------------
function getCompetitorInstructions() {
  try {
    const row = db.prepare("SELECT competitor_instructions FROM title_prompt_settings WHERE id = 1").get();
    if (row && row.competitor_instructions && row.competitor_instructions.trim()) {
      return row.competitor_instructions.trim();
    }
  } catch (e) {
    console.warn("Could not read competitor instructions:", e.message);
  }
  return require("./db").DEFAULT_COMPETITOR_PROMPT_INSTRUCTIONS || "";
}

function buildCompetitorDataBlock({ duoChannel, competitorChannel, outlierProfiles, underperformers, sideBySide, previousReport }) {
  const parts = [];

  const duoSubs = duoChannel.subscriberCount ?? duoChannel.subscribers ?? null;
  const compSubs = competitorChannel.subscriberCount ?? competitorChannel.subscribers ?? null;

  parts.push(`CHANNELS: "The Electric Duo" (${duoSubs != null ? duoSubs.toLocaleString() + " subscribers" : "subscriber count unavailable"}) vs "${competitorChannel.title}" (${compSubs != null ? compSubs.toLocaleString() + " subscribers" : "subscriber count unavailable"}).`);

  if (sideBySide.subscribers.ratio != null) {
    parts.push(`Scale ratio: the competitor is ~${sideBySide.subscribers.ratio}x our size.`);
  } else {
    parts.push(`Scale ratio: UNAVAILABLE — subscriber counts could not be resolved for both channels.`);
  }

  parts.push("");
  parts.push(`UPLOAD CADENCE: Duo ${sideBySide.cadence.duo.monthlyAvg} videos/month (avg length ${sideBySide.avgDuration.duo.formatted}) vs Competitor ${sideBySide.cadence.competitor.monthlyAvg} videos/month (avg length ${sideBySide.avgDuration.competitor.formatted}).`);

  // Packaging patterns were previously computed and then never passed to the model.
  if (sideBySide.titlePatterns) {
    const tp = sideBySide.titlePatterns;
    parts.push("");
    parts.push("TITLE PACKAGING (top view quartile of each channel):");
    parts.push(`- Duo: avg title length ${tp.duo.avgLength} chars, ${tp.duo.hasNumberPct}% contain a number. Frequent words: ${tp.duo.topKeywords.map((k) => k.word).slice(0, 8).join(", ") || "none"}`);
    parts.push(`- Competitor: avg title length ${tp.competitor.avgLength} chars, ${tp.competitor.hasNumberPct}% contain a number. Frequent words: ${tp.competitor.topKeywords.map((k) => k.word).slice(0, 8).join(", ") || "none"}`);
  }

  if (sideBySide.engagement) {
    const e = sideBySide.engagement;
    parts.push("");
    parts.push("ENGAGEMENT RATE (per 1,000 views — separates packaging wins from content wins):");
    parts.push(`- Duo: ${e.duo.likesPer1k} likes, ${e.duo.commentsPer1k} comments`);
    parts.push(`- Competitor: ${e.competitor.likesPer1k} likes, ${e.competitor.commentsPer1k} comments`);
  }

  if (sideBySide.publishTiming) {
    const pt = sideBySide.publishTiming;
    parts.push("");
    parts.push("PUBLISH TIMING (top view quartile):");
    parts.push(`- Duo most common day: ${pt.duo.topDay || "n/a"}`);
    parts.push(`- Competitor most common day: ${pt.competitor.topDay || "n/a"}`);
  }

  parts.push("");
  parts.push("STATISTICAL OUTLIERS (>= 3.0x that channel's own baseline):");
  if (!outlierProfiles || outlierProfiles.length === 0) {
    parts.push("  None found in the period analysed.");
  } else {
    outlierProfiles.slice(0, 6).forEach((o, idx) => {
      const bits = [`${o.multiplier}x baseline`];
      if (o.ageDays != null) bits.push(`${o.ageDays} days old`);
      if (o.stillAccumulating) bits.push("STILL ACCUMULATING — views not yet settled");
      if (o.engagement) bits.push(`${o.engagement.likesPer1k} likes/1k views`);
      parts.push(`  ${idx + 1}. "${o.title}" (${bits.join(", ")})`);
      parts.push(`     Replicability: ${(o.replicabilityFlags || []).map((f) => f.label).join(", ") || "none flagged"}`);
      parts.push(`     Packaging: ${o.packagingDiff?.keyDiffSummary || "no packaging difference identified"}`);
    });
  }

  parts.push("");
  parts.push("UNDERPERFORMERS / ANTI-PATTERNS (< 0.6x that channel's own baseline):");
  if (!underperformers || underperformers.length === 0) {
    parts.push("  None found in the period analysed.");
  } else {
    underperformers.slice(0, 4).forEach((u, idx) => {
      parts.push(`  ${idx + 1}. "${u.title}" (${u.multiplier}x baseline) — ${u.antiPatternDiagnosis}`);
    });
  }

  parts.push("");
  parts.push("TOPIC DISTRIBUTION:");
  sideBySide.topics.duo.forEach((t) => {
    const compMatch = sideBySide.topics.competitor.find((c) => c.name === t.name) || { pct: 0 };
    parts.push(`- ${t.name}: Duo ${t.pct}% vs Competitor ${compMatch.pct}%`);
  });

  // Change over time is more actionable than a single snapshot.
  if (previousReport) {
    parts.push("");
    parts.push(`CHANGE SINCE THE PREVIOUS RUN (${previousReport.createdAt}):`);
    const prev = previousReport.analysis;
    if (prev?.sideBySide?.cadence) {
      parts.push(`- Competitor cadence then: ${prev.sideBySide.cadence.competitor.monthlyAvg}/month, now: ${sideBySide.cadence.competitor.monthlyAvg}/month.`);
    }
    const prevTitles = new Set((prev?.outlierProfiles || []).map((o) => o.title));
    const newOutliers = (outlierProfiles || []).filter((o) => !prevTitles.has(o.title));
    if (newOutliers.length > 0) {
      parts.push(`- New outliers since last run: ${newOutliers.map((o) => `"${o.title}"`).join(", ")}`);
    } else {
      parts.push("- No new outliers since the last run.");
    }
    if (prev?.sideBySide?.topics?.competitor) {
      const shifts = sideBySide.topics.competitor
        .map((t) => {
          const before = (prev.sideBySide.topics.competitor.find((p) => p.name === t.name) || { pct: 0 }).pct;
          return { name: t.name, delta: t.pct - before };
        })
        .filter((x) => Math.abs(x.delta) >= 5);
      if (shifts.length > 0) {
        parts.push(`- Competitor topic shifts (percentage points): ${shifts.map((x) => `${x.name} ${x.delta >= 0 ? "+" : ""}${x.delta}`).join(", ")}`);
      }
    }
  } else {
    parts.push("");
    parts.push("CHANGE SINCE PREVIOUS RUN: this is the first report for this competitor, so no comparison is available.");
  }

  parts.push("");
  parts.push("WHAT THIS ANALYSIS CANNOT SEE — never estimate or invent these for the competitor:");
  parts.push("- Their retention, average percentage viewed, impressions, and click-through rate.");
  parts.push("- Their traffic sources and subscriber conversion.");
  parts.push("- Anything about videos outside the period analysed.");

  return parts.join("\n");
}

async function generateExecutiveSummary({ duoChannel, competitorChannel, benchmarks, outlierProfiles, underperformers, sideBySide, previousReport }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    return {
      summary: null,
      error: "Gemini API key is not configured, so the narrative could not be generated.",
    };
  }

  const prompt = `${getCompetitorInstructions()}

ABSOLUTE RULE ON DATA:
Every number and video title you cite must appear in the block below. Never estimate, extrapolate, or invent a figure. Where the data says a value is unavailable, say so rather than guessing.

STRUCTURED ANALYSIS DATA:
${buildCompetitorDataBlock({ duoChannel, competitorChannel, outlierProfiles, underperformers, sideBySide, previousReport })}`;

  const candidateModels = [
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
  ];

  let lastError = null;
  try {
    const ai = new GoogleGenAI({ apiKey });
    for (const mod of candidateModels) {
      try {
        const response = await ai.models.generateContent({ model: mod, contents: prompt });
        if (response && response.text) {
          let text = response.text.trim();
          text = text.replace(/^#\s*EXECUTIVE BRIEFING[^\n]*\n+/i, "");
          text = text.replace(/^\*\*TO:\*\*[^\n]*\n+/im, "");
          text = text.replace(/^\*\*FROM:\*\*[^\n]*\n+/im, "");
          text = text.replace(/^\*\*DATE:\*\*[^\n]*\n+/im, "");
          text = text.replace(/^\*\*SUBJECT:\*\*[^\n]*\n+/im, "");
          text = text.replace(/^---\s*\n+/m, "");
          return { summary: text.trim(), error: null, model: mod };
        }
      } catch (modErr) {
        lastError = modErr;
        console.warn(`Model ${mod} attempt failed:`, modErr.message);
      }
    }
  } catch (err) {
    lastError = err;
    console.warn("Narrative summary failed:", err.message);
  }

  // No heuristic fallback. The previous version asserted strategic opinions about
  // a channel it had not examined; an honest failure is more useful.
  return {
    summary: null,
    error: `The narrative could not be generated${lastError ? `: ${lastError.message}` : "."}. The structured findings below are unaffected.`,
  };
}


// Regenerate just the narrative summary for an existing report
async function regenerateExecutiveSummary(reportId) {
  const row = db.prepare("SELECT * FROM competitor_reports WHERE id = ?").get(reportId);
  if (!row) throw new Error("Report not found");

  let analysis = JSON.parse(row.analysis_json);
  const previousReport = getPreviousReport(row.competitor_channel_id, reportId);

  const result = await generateExecutiveSummary({
    duoChannel: analysis.duoChannel,
    competitorChannel: analysis.competitorChannel,
    benchmarks: analysis.benchmarks,
    outlierProfiles: analysis.outlierProfiles,
    underperformers: analysis.underperformers,
    sideBySide: analysis.sideBySide,
    previousReport,
  });

  analysis.executiveSummary = result.summary;
  analysis.executiveSummaryError = result.error;

  db.prepare("UPDATE competitor_reports SET analysis_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    JSON.stringify(analysis),
    reportId
  );

  return {
    reportId,
    executiveSummary: result.summary,
    executiveSummaryError: result.error,
  };
}

// Most recent earlier report for the same competitor, used for "what changed".
function getPreviousReport(competitorChannelId, excludeReportId = null) {
  const row = db.prepare(`
    SELECT id, analysis_json, created_at FROM competitor_reports
    WHERE competitor_channel_id = ? ${excludeReportId ? "AND id != ?" : ""}
    ORDER BY created_at DESC LIMIT 1
  `).get(...(excludeReportId ? [competitorChannelId, excludeReportId] : [competitorChannelId]));
  if (!row) return null;
  try {
    return { id: row.id, createdAt: row.created_at, analysis: JSON.parse(row.analysis_json) };
  } catch (e) {
    return null;
  }
}

// Convert ISO-8601 duration (PT18M6S) or standard format to seconds
function parseDurationToSeconds(durationStr) {
  if (!durationStr || typeof durationStr !== "string") return null;
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (match) {
    const hours = parseInt(match[1] || "0", 10);
    const minutes = parseInt(match[2] || "0", 10);
    const seconds = parseInt(match[3] || "0", 10);
    return hours * 3600 + minutes * 60 + seconds;
  }
  const parts = durationStr.split(":").map((p) => parseInt(p, 10));
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

// Format seconds into MM:SS or HH:MM:SS
function formatDuration(sec) {
  if (sec == null || isNaN(sec)) return "Unknown";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Extract handle, channelId, or vanity name from user input
function parseChannelInput(input) {
  if (!input || typeof input !== "string") return null;
  let clean = input.trim();
  
  // Direct channel ID
  if (clean.startsWith("UC") && clean.length >= 22) {
    return { type: "id", value: clean };
  }

  // Handle formats: @StateOfCharge, youtube.com/@StateOfCharge
  const handleMatch = clean.match(/@([a-zA-Z0-9_\-\.]+)/);
  if (handleMatch) {
    return { type: "handle", value: "@" + handleMatch[1] };
  }

  // Channel URL: youtube.com/channel/UC...
  const channelUrlMatch = clean.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_\-]+)/);
  if (channelUrlMatch) {
    return { type: "id", value: channelUrlMatch[1] };
  }

  // Custom / vanity URL: youtube.com/c/Name or youtube.com/user/Name
  const customUrlMatch = clean.match(/youtube\.com\/(?:c\/|user\/|)([a-zA-Z0-9_\-\.]+)/);
  if (customUrlMatch && !clean.includes("@")) {
    return { type: "forUsername", value: customUrlMatch[1] };
  }

  // Raw username or string
  return { type: "query", value: clean };
}

// Resolve YouTube channel details using YouTube Data API or public lookup
async function resolveChannel(input) {
  const parsed = parseChannelInput(input);
  if (!parsed) throw new Error("Please enter a valid YouTube channel URL, handle, or ID.");

  const youtube = getYoutubeClient(true);

  // 1. If handle: channels.list(forHandle)
  if (parsed.type === "handle") {
    try {
      const res = await youtube.channels.list({
        part: "snippet,contentDetails,statistics",
        forHandle: parsed.value.replace(/^@/, ""),
      });
      if (res.data.items && res.data.items.length > 0) {
        return extractChannelInfo(res.data.items[0]);
      }
    } catch (e) {
      console.warn("Handle lookup failed via API, trying search/scrape fallback:", e.message);
    }
  }

  // 2. If ID: channels.list(id)
  if (parsed.type === "id") {
    try {
      const res = await youtube.channels.list({
        part: "snippet,contentDetails,statistics",
        id: parsed.value,
      });
      if (res.data.items && res.data.items.length > 0) {
        return extractChannelInfo(res.data.items[0]);
      }
    } catch (e) {
      console.warn("ID lookup failed via API:", e.message);
    }
  }

  // 3. If forUsername
  if (parsed.type === "forUsername") {
    try {
      const res = await youtube.channels.list({
        part: "snippet,contentDetails,statistics",
        forUsername: parsed.value,
      });
      if (res.data.items && res.data.items.length > 0) {
        return extractChannelInfo(res.data.items[0]);
      }
    } catch (e) {
      console.warn("Could not fetch channel by forUsername:", e.message);
    }
  }

  // 4. Web Scrape / Search fallback for Handles, Vanity URLs, and Channel Pages
  try {
    const isChannelId = parsed.type === "id" || parsed.value.startsWith("UC");
    const searchTarget = parsed.value.startsWith("@")
      ? `https://www.youtube.com/${parsed.value}`
      : parsed.value.startsWith("http")
      ? parsed.value
      : isChannelId
      ? `https://www.youtube.com/channel/${parsed.value}`
      : `https://www.youtube.com/@${parsed.value.replace(/^@/, "")}`;

    const webRes = await axios.get(searchTarget, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 8000,
    });
    const html = webRes.data;

    // Extract channelId and metadata from ytInitialData / meta tags
    const channelIdMatch = html.match(/<meta itemprop="channelId" content="([^"]+)">/) ||
      html.match(/"externalId":"(UC[a-zA-Z0-9_\-]+)"/) ||
      html.match(/"channelId":"(UC[a-zA-Z0-9_\-]+)"/) ||
      html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_\-]+)">/);

    const cId = channelIdMatch ? channelIdMatch[1] : null;

    // Try API first if we have cId
    if (cId) {
      try {
        const apiRes = await youtube.channels.list({
          part: "snippet,contentDetails,statistics",
          id: cId,
        });
        if (apiRes.data.items && apiRes.data.items.length > 0) {
          return extractChannelInfo(apiRes.data.items[0]);
        }
      } catch (apiErr) {
        console.warn("API quota exceeded during channel detail fetch, using direct page metadata:", apiErr.message);
      }
    }

    // Direct extraction from ytInitialData without API quota
    const jsonMatch = html.match(/var ytInitialData = ({.*?});<\/script>/) || html.match(/ytInitialData = ({.*?});/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      const meta = data.metadata?.channelMetadataRenderer || {};
      const header = data.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
      const rows = header?.metadata?.contentMetadataViewModel?.metadataRows || [];
      const subText = rows[1]?.metadataParts?.[0]?.text?.content || "";
      
      let subs = 0;
      const subMatch = subText.match(/([0-9\.]+)\s*([KM]?)\s*subscribers/i);
      if (subMatch) {
        const num = parseFloat(subMatch[1]);
        const mult = subMatch[2]?.toUpperCase() === "M" ? 1000000 : subMatch[2]?.toUpperCase() === "K" ? 1000 : 1;
        subs = Math.round(num * mult);
      }

      // Robust avatar extraction: modern pageHeaderViewModel, channelMetadataRenderer, or c4TabbedHeaderRenderer
      let avatarUrl = "";
      const headerAvatarSources = header?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources;
      if (Array.isArray(headerAvatarSources) && headerAvatarSources.length > 0) {
        avatarUrl = headerAvatarSources[headerAvatarSources.length - 1]?.url || "";
      }
      if (!avatarUrl && Array.isArray(meta.avatar?.thumbnails) && meta.avatar.thumbnails.length > 0) {
        avatarUrl = meta.avatar.thumbnails[meta.avatar.thumbnails.length - 1]?.url || "";
      }
      const c4Avatar = data.header?.c4TabbedHeaderRenderer?.avatar?.thumbnails;
      if (!avatarUrl && Array.isArray(c4Avatar) && c4Avatar.length > 0) {
        avatarUrl = c4Avatar[c4Avatar.length - 1]?.url || "";
      }

      const extractedId = cId || meta.externalId;
      if (extractedId) {
        return {
          channelId: extractedId,
          title: meta.title || "Competitor Channel",
          handle: meta.vanityChannelUrl ? meta.vanityChannelUrl.replace(/.*youtube\.com\//, "") : ("@" + (meta.title || "channel").replace(/\s+/g, "")),
          description: meta.description || "",
          thumbnailUrl: avatarUrl || "",
          subscriberCount: subs || 50000,
          videoCount: 100,
          viewCount: 1000000,
          uploadsPlaylistId: "UU" + extractedId.substring(2),
        };
      }
    }
  } catch (webErr) {
    console.warn("Web scrape channel resolver fallback failed:", webErr.message);
  }

  // 5. Final fallback: search.list type=channel
  try {
    const searchRes = await youtube.search.list({
      part: "snippet",
      q: parsed.value,
      type: "channel",
      maxResults: 1,
    });
    if (searchRes.data.items && searchRes.data.items.length > 0) {
      const cId = searchRes.data.items[0].snippet.channelId;
      const apiRes = await youtube.channels.list({
        part: "snippet,contentDetails,statistics",
        id: cId,
      });
      if (apiRes.data.items && apiRes.data.items.length > 0) {
        return extractChannelInfo(apiRes.data.items[0]);
      }
    }
  } catch (searchErr) {
    console.warn("Could not find channel via search fallback:", searchErr.message);
  }

  throw new Error(`Could not find a YouTube channel matching "${input}". Please provide the full channel URL or @handle.`);
}

function extractChannelInfo(item) {
  const snippet = item.snippet || {};
  const stats = item.statistics || {};
  const content = item.contentDetails || {};

  return {
    channelId: item.id,
    title: snippet.title || "Unknown Channel",
    handle: snippet.customUrl || (snippet.title ? "@" + snippet.title.replace(/\s+/g, "") : ""),
    description: snippet.description || "",
    thumbnailUrl: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || "",
    subscriberCount: parseInt(stats.subscriberCount || "0", 10),
    videoCount: parseInt(stats.videoCount || "0", 10),
    viewCount: parseInt(stats.viewCount || "0", 10),
    uploadsPlaylistId: content.relatedPlaylists?.uploads || ("UU" + item.id.substring(2)),
  };
}

// Fetch up to 12 months of uploads for a channel via YouTube Data API or zero-quota page parser
async function fetchChannelUploads(channelInfo, months = 12) {
  const youtube = getYoutubeClient(true);
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - months);

  const playlistId = channelInfo.uploadsPlaylistId;
  const videos = [];
  let pageToken = null;
  let reachedCutoff = false;
  let apiSuccess = false;

  // 1. Try Official YouTube Data API
  try {
    while (!reachedCutoff && videos.length < 250) {
      const playlistRes = await youtube.playlistItems.list({
        part: "snippet,contentDetails",
        playlistId: playlistId,
        maxResults: 50,
        pageToken: pageToken || undefined,
      });

      const items = playlistRes.data.items || [];
      if (items.length === 0) break;

      const videoIds = [];
      for (const item of items) {
        const vId = item.contentDetails?.videoId;
        const pubDate = new Date(item.snippet?.publishedAt || item.contentDetails?.videoPublishedAt || 0);

        if (pubDate < cutoffDate) {
          reachedCutoff = true;
          break;
        }
        if (vId) videoIds.push(vId);
      }

      if (videoIds.length > 0) {
        const statsRes = await youtube.videos.list({
          part: "snippet,contentDetails,statistics",
          id: videoIds.join(","),
        });

        for (const v of statsRes.data.items || []) {
          const snip = v.snippet || {};
          const stats = v.statistics || {};
          const content = v.contentDetails || {};
          const durationIso = content.duration || null;
          const durationSec = parseDurationToSeconds(durationIso);

          // Unknown duration is excluded rather than assumed to be long-form.
          if (durationSec != null && durationSec > 180) {
            videos.push({
              youtubeId: v.id,
              channelId: channelInfo.channelId,
              title: snip.title || "",
              publishedAt: snip.publishedAt || new Date().toISOString(),
              durationSec: durationSec,
              durationIso: durationIso,
              viewCount: parseInt(stats.viewCount || "0", 10),
              likeCount: parseInt(stats.likeCount || "0", 10),
              commentCount: parseInt(stats.commentCount || "0", 10),
              thumbnailUrl: snip.thumbnails?.maxres?.url || snip.thumbnails?.high?.url || `https://img.youtube.com/vi/${v.id}/hqdefault.jpg`,
              tags: Array.isArray(snip.tags) ? snip.tags : [],
              description: snip.description || "",
            });
          }
        }
      }

      pageToken = playlistRes.data.nextPageToken;
      if (!pageToken) break;
    }
    if (videos.length > 0) apiSuccess = true;
  } catch (err) {
    console.warn(`YouTube API quota exceeded or error on playlist ${playlistId}, engaging zero-quota web scraper:`, err.message);
  }

  // 2. Zero-Quota Public Web Scraper Fallback
  if (!apiSuccess || videos.length === 0) {
    try {
      const channelUrl = channelInfo.handle
        ? `https://www.youtube.com/${channelInfo.handle.startsWith("@") ? channelInfo.handle : "@" + channelInfo.handle}/videos`
        : `https://www.youtube.com/channel/${channelInfo.channelId}/videos`;

      const res = await axios.get(channelUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 9000,
      });

      const html = res.data;
      const jsonMatch = html.match(/var ytInitialData = ({.*?});<\/script>/) || html.match(/ytInitialData = ({.*?});/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
        const videoTab = tabs.find((t) => t.tabRenderer?.title === "Videos" || t.tabRenderer?.selected);
        const richGrid = videoTab?.tabRenderer?.content?.richGridRenderer?.contents || [];

        for (const item of richGrid) {
          const lockup = item.richItemRenderer?.content?.lockupViewModel;
          if (lockup) {
            const vId = lockup.contentId;
            const title = lockup.metadata?.lockupMetadataViewModel?.title?.content || "";
            const metaRows = lockup.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
            const parts = metaRows[0]?.metadataParts || [];
            const viewsStr = parts[0]?.text?.content || "10K views";
            const timeStr = parts[1]?.text?.content || "1 month ago";

            // Parse views (e.g. "7.1K views", "150K views", "1.2M views")
            let viewCount = 10000;
            const vMatch = viewsStr.match(/([0-9\.]+)\s*([KM]?)\s*views/i);
            if (vMatch) {
              const num = parseFloat(vMatch[1]);
              const mult = vMatch[2]?.toUpperCase() === "M" ? 1000000 : vMatch[2]?.toUpperCase() === "K" ? 1000 : 1;
              viewCount = Math.round(num * mult);
            }

            // Estimate publish date from timeStr (e.g. "6 days ago", "2 weeks ago", "3 months ago")
            const pubDate = new Date();
            if (timeStr.includes("day")) {
              const d = parseInt(timeStr, 10) || 1;
              pubDate.setDate(pubDate.getDate() - d);
            } else if (timeStr.includes("week")) {
              const w = parseInt(timeStr, 10) || 1;
              pubDate.setDate(pubDate.getDate() - w * 7);
            } else if (timeStr.includes("month")) {
              const m = parseInt(timeStr, 10) || 1;
              pubDate.setMonth(pubDate.getMonth() - m);
            } else if (timeStr.includes("year")) {
              const y = parseInt(timeStr, 10) || 1;
              pubDate.setFullYear(pubDate.getFullYear() - y);
            }

            videos.push({
              youtubeId: vId,
              channelId: channelInfo.channelId,
              title: title,
              publishedAt: pubDate.toISOString(),
              // The public scrape exposes neither duration nor engagement counts.
              // They stay null instead of being invented from a view-count ratio.
              durationSec: null,
              durationIso: null,
              viewCount: viewCount,
              likeCount: null,
              commentCount: null,
              thumbnailUrl: `https://img.youtube.com/vi/${vId}/hqdefault.jpg`,
              tags: [],
              description: title,
            });
          }
        }
      }
    } catch (scrapeErr) {
      console.warn("Public web scraper fallback error:", scrapeErr.message);
    }
  }

  // Sort chronological (oldest to newest for rolling baseline calculation)
  videos.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));
  return videos;
}

// Calculate rolling baseline & flag statistical outliers (views >= 3x baseline)
function detectOutliers(videos) {
  if (!videos || videos.length === 0) return [];

  // Compute rolling baseline using median or average of prior 10 videos (or all prior if < 10)
  return videos.map((video, idx) => {
    let windowVideos = [];
    if (idx === 0) {
      windowVideos = videos.slice(0, Math.min(videos.length, 10));
    } else {
      const start = Math.max(0, idx - 10);
      windowVideos = videos.slice(start, idx);
    }

    const viewList = windowVideos.map((v) => v.viewCount).filter((c) => c > 0);
    let baseline = 1000;

    if (viewList.length > 0) {
      viewList.sort((a, b) => a - b);
      const mid = Math.floor(viewList.length / 2);
      baseline = viewList.length % 2 !== 0 ? viewList[mid] : (viewList[mid - 1] + viewList[mid]) / 2;
    }

    // Protect against 0 baseline
    baseline = Math.max(baseline, 500);

    const multiplier = parseFloat((video.viewCount / baseline).toFixed(1));
    const isOutlier = multiplier >= 3.0;

    // A three-week-old video is being compared with an eleven-month-old one on
    // total views. Flag anything still accumulating so it is not read as settled.
    const publishedMs = new Date(video.publishedAt).getTime();
    const ageDays = Number.isNaN(publishedMs)
      ? null
      : Math.max(0, Math.round((Date.now() - publishedMs) / 86400000));
    const stillAccumulating = ageDays != null && ageDays < 30;
    const viewsPerDay = ageDays != null && ageDays > 0
      ? Math.round(video.viewCount / ageDays)
      : null;

    return {
      ...video,
      baselineViews: Math.round(baseline),
      multiplier: multiplier,
      isOutlier: isOutlier,
      ageDays,
      stillAccumulating,
      viewsPerDay,
      engagement: video.viewCount > 0 && video.likeCount != null && video.commentCount != null
        ? {
            likesPer1k: Number(((video.likeCount / video.viewCount) * 1000).toFixed(1)),
            commentsPer1k: Number(((video.commentCount / video.viewCount) * 1000).toFixed(1)),
          }
        : null,
    };
  });
}

// Identify topic/keyword similarity between an outlier and regular videos
function findSimilarNonOutliers(outlier, allVideos) {
  const nonOutliers = allVideos.filter((v) => !v.isOutlier && v.youtubeId !== outlier.youtubeId);
  if (nonOutliers.length === 0) return [];

  const outlierWords = outlier.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["with", "this", "that", "from", "your", "what", "have", "first", "look", "video"].includes(w));

  const scored = nonOutliers.map((v) => {
    const vWords = v.title.toLowerCase();
    let matchScore = 0;
    outlierWords.forEach((w) => {
      if (vWords.includes(w)) matchScore += 2;
    });

    // Tag matching bonus
    if (outlier.tags && v.tags) {
      const sharedTags = outlier.tags.filter((t) => v.tags.map((x) => x.toLowerCase()).includes(t.toLowerCase()));
      matchScore += sharedTags.length;
    }

    return { video: v, matchScore };
  });

  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored.slice(0, 3).map((s) => s.video);
}

// Compute Packaging vs Substance diff
function analyzePackagingDiff(outlier, similarVideos) {
  const outlierTitleWords = outlier.title.split(/\s+/).length;
  const outlierHasNumbers = /\d+/.test(outlier.title);
  const outlierHasYear = /(?:2024|2025|2026|2027)/.test(outlier.title);
  const outlierHasQuestion = /\?/.test(outlier.title);
  const outlierHasColon = /:|-|\|/.test(outlier.title);

  const compStats = similarVideos.map((v) => ({
    title: v.title,
    views: v.viewCount,
    multiplier: v.multiplier,
    duration: formatDuration(v.durationSec),
    titleLength: v.title.length,
    hasNumbers: /\d+/.test(v.title),
  }));

  const avgSimilarTitleLen = similarVideos.length > 0
    ? Math.round(similarVideos.reduce((acc, v) => acc + v.title.length, 0) / similarVideos.length)
    : 60;

  return {
    outlierTitle: outlier.title,
    outlierViews: outlier.viewCount,
    outlierMultiplier: outlier.multiplier,
    outlierDuration: formatDuration(outlier.durationSec),
    outlierTitleLength: outlier.title.length,
    outlierTitleWords,
    hasNumbers: outlierHasNumbers,
    hasYear: outlierHasYear,
    hasQuestion: outlierHasQuestion,
    hasSeparator: outlierHasColon,
    avgSimilarTitleLen,
    similarVideos: compStats,
    keyDiffSummary: outlier.title.length < avgSimilarTitleLen
      ? "Punchier title length vs regular uploads"
      : "More descriptive / keyword-dense title structure",
  };
}

// Replicability Heuristics for Competitor Outliers
function evaluateReplicability(outlier, allCompetitorVideos, competitorSubs, duoSubs) {
  const flags = [];
  const titleLower = outlier.title.toLowerCase();

  // 1. Timing / Launch-driven
  const launchKeywords = ["reveal", "revealed", "first look", "launch", "announced", "all-new", "2026", "2027", "breaks cover", "concept", "pricing", "hands on"];
  const isLaunchDriven = launchKeywords.some((k) => titleLower.includes(k));
  if (isLaunchDriven) {
    flags.push({
      type: "timing",
      label: "Timing / News-Driven",
      color: "cyan",
      badge: "⚡ High Velocity Repeatable",
      detail: "Views spike aligned with manufacturer announcement or first-look momentum. Repeatable if The Electric Duo produces rapid-reaction coverage within 24h.",
    });
  }

  // 2. Algorithm momentum / upload streak (5+ uploads in prior 14 days)
  const outlierDate = new Date(outlier.publishedAt).getTime();
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  const priorStreakCount = allCompetitorVideos.filter((v) => {
    const d = new Date(v.publishedAt).getTime();
    return d < outlierDate && d >= outlierDate - fourteenDaysMs;
  }).length;

  if (priorStreakCount >= 5) {
    flags.push({
      type: "momentum",
      label: "Algorithm Momentum",
      color: "purple",
      badge: "🌊 Channel Momentum Wave",
      detail: `Competitor had ${priorStreakCount} uploads in the prior 14 days before this video. Spikes benefit from high algorithm frequency, not easily replicable from a single one-off video.`,
    });
  }

  // 3. Format / Duration deviation
  const withDuration = allCompetitorVideos.filter((v) => v.durationSec != null);
  const avgDuration = withDuration.length > 0
    ? withDuration.reduce((acc, v) => acc + v.durationSec, 0) / withDuration.length
    : null;

  if (avgDuration != null && outlier.durationSec != null && outlier.durationSec > avgDuration * 1.6) {
    flags.push({
      type: "format_long",
      label: "Deep Dive Format Deviation",
      color: "emerald",
      badge: "⏱️ Extended Deep Dive",
      detail: `Video is significantly longer (${formatDuration(outlier.durationSec)} vs ${formatDuration(Math.round(avgDuration))} avg). Long-form engagement drove search & browse authority.`,
    });
  } else if (avgDuration != null && outlier.durationSec != null && outlier.durationSec < avgDuration * 0.6) {
    flags.push({
      type: "format_short",
      label: "Punchy Format Deviation",
      color: "amber",
      badge: "🎯 Ultra-Focused Format",
      detail: `Video is significantly tighter (${formatDuration(outlier.durationSec)} vs ${formatDuration(Math.round(avgDuration))} avg). Higher retention rate likely propelled discovery.`,
    });
  }

  // 4. Scale advantage (> 3x subscriber count)
  if (competitorSubs > duoSubs * 3) {
    const subRatio = (competitorSubs / Math.max(duoSubs, 1000)).toFixed(1);
    flags.push({
      type: "scale",
      label: "Scale Advantage",
      color: "red",
      badge: `🏔️ ${subRatio}x Sub Scale Advantage`,
      detail: `Competitor has ${competitorSubs.toLocaleString()} subscribers (${subRatio}x our size). Built-in browse velocity on upload may not transfer directly to our current subscriber base.`,
    });
  }

  if (flags.length === 0) {
    flags.push({
      type: "topic",
      label: "Content Resonance",
      color: "blue",
      badge: "💡 High Core Topic Interest",
      detail: "Topic and packaging resonated strongly without external release anomalies. Strong candidate for testing with Duo's perspective.",
    });
  }

  return flags;
}

// "DO NOT COPY" & Underperformer Analyzer (Bottom quartile: < 0.5x baseline)
function detectUnderperformers(videos, competitorSubs, duoSubs) {
  const underperformers = videos
    .filter((v) => v.multiplier <= 0.6)
    .sort((a, b) => a.multiplier - b.multiplier)
    .slice(0, 8);

  return underperformers.map((v) => {
    const reasons = [];
    const title = v.title.toLowerCase();

    if (v.title.length > 80) {
      reasons.push("Overly verbose / cluttered title title exceeding 80 characters");
    }
    if (!/\d+/.test(v.title) && !/(?:ev|truck|charging|range|review|vs|battery)/.test(title)) {
      reasons.push("Vague title lacking recognizable EV models, numbers, or specific search keywords");
    }
    if (v.durationSec != null && v.durationSec > 2700) { // 45+ mins
      reasons.push("Extreme video duration (>45 min) without strong milestone hook");
    }
    if (/(?:podcast|q&a|livestream|talking|update|random|thoughts)/.test(title)) {
      reasons.push("Casual vlog / unedited talking format that relies on massive celebrity fandom rather than searchable value");
    }

    if (reasons.length === 0) {
      reasons.push("Weak initial packaging or generic EV topic that failed to generate browse click-through");
    }

    return {
      youtubeId: v.youtubeId,
      title: v.title,
      publishedAt: v.publishedAt,
      duration: formatDuration(v.durationSec),
      views: v.viewCount,
      multiplier: v.multiplier,
      thumbnailUrl: v.thumbnailUrl,
      antiPatternDiagnosis: reasons.join("; "),
      strategicGuidance: "Deprioritize this format/topic style. Even with their audience base, this struggled to reach 50% of regular baseline.",
    };
  });
}

// Side-by-Side Summary Metrics & Topic Distribution
function computeSideBySideSummary(duoVideos, compVideos, duoSubs, compSubs) {
  // 1. Cadence (uploads / month)
  const calcCadence = (vList) => {
    if (vList.length === 0) return { total: 0, monthlyAvg: 0, byMonth: {} };
    const byMonth = {};
    vList.forEach((v) => {
      const m = v.publishedAt.substring(0, 7); // YYYY-MM
      byMonth[m] = (byMonth[m] || 0) + 1;
    });
    const monthCount = Math.max(1, Object.keys(byMonth).length);
    return {
      total: vList.length,
      monthlyAvg: parseFloat((vList.length / monthCount).toFixed(1)),
      byMonth,
    };
  };

  const duoCadence = calcCadence(duoVideos);
  const compCadence = calcCadence(compVideos);

  // 2. Average Duration
  const calcAvgDuration = (vList) => {
    if (vList.length === 0) return { avgSec: 0, formatted: "0:00" };
    const measured = vList.filter((v) => v.durationSec != null);
    if (measured.length === 0) return { avgSec: null, formatted: "Unknown", sampleSize: 0 };
    const total = measured.reduce((acc, v) => acc + v.durationSec, 0);
    const avg = Math.round(total / measured.length);
    return { avgSec: avg, formatted: formatDuration(avg), sampleSize: measured.length };
  };

  const duoAvgDuration = calcAvgDuration(duoVideos);
  const compAvgDuration = calcAvgDuration(compVideos);

  // 3. Topic & Keyword Categorization
  const clusterTopics = (vList) => {
    const topics = {
      "Reviews & First Looks": 0,
      "Industry News & Analysis": 0,
      "Charging & Range Tests": 0,
      "Road Trips & Travel": 0,
      "Ownership & Guides": 0,
      "Other / Miscellaneous": 0,
    };

    vList.forEach((v) => {
      const t = v.title.toLowerCase();
      if (/(?:review|walkaround|first look|interior|test drive|tour|first drive|hands on)/.test(t)) {
        topics["Reviews & First Looks"]++;
      } else if (/(?:news|quick charge|breakthrough|announced|revealed|future|sales|policy|update)/.test(t)) {
        topics["Industry News & Analysis"]++;
      } else if (/(?:charging|charger|nacs|ccs|range test|70 mph|speed|fast charge|battery)/.test(t)) {
        topics["Charging & Range Tests"]++;
      } else if (/(?:road trip|towing|travel|journey|cross country|camping|route)/.test(t)) {
        topics["Road Trips & Travel"]++;
      } else if (/(?:guide|how to|diy|tips|tricks|adapter|ownership|long term|cost)/.test(t)) {
        topics["Ownership & Guides"]++;
      } else {
        topics["Other / Miscellaneous"]++;
      }
    });

    return Object.entries(topics).map(([name, count]) => ({
      name,
      count,
      pct: vList.length > 0 ? Math.round((count / vList.length) * 100) : 0,
    }));
  };

  const duoTopics = clusterTopics(duoVideos);
  const compTopics = clusterTopics(compVideos);

  // 4. Common Title Patterns in Top Quartile
  const extractTitlePatterns = (vList) => {
    const sorted = [...vList].sort((a, b) => b.viewCount - a.viewCount);
    const topQuartile = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.25)));

    const wordCounts = {};
    topQuartile.forEach((v) => {
      const words = v.title
        .replace(/[^a-zA-Z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !["with", "this", "that", "from", "your", "what", "have", "video", "electric", "duo"].includes(w.toLowerCase()));

      words.forEach((w) => {
        const clean = w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        wordCounts[clean] = (wordCounts[clean] || 0) + 1;
      });
    });

    const topKeywords = Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, freq]) => ({ word, freq }));

    const avgLength = topQuartile.length > 0
      ? Math.round(topQuartile.reduce((acc, v) => acc + v.title.length, 0) / topQuartile.length)
      : 60;

    const hasNumberPct = topQuartile.length > 0
      ? Math.round((topQuartile.filter((v) => /\d+/.test(v.title)).length / topQuartile.length) * 100)
      : 0;

    return { topKeywords, avgLength, hasNumberPct };
  };

  const duoPatterns = extractTitlePatterns(duoVideos);
  const compPatterns = extractTitlePatterns(compVideos);

  // Engagement rate separates a packaging win (high views, low engagement) from a
  // content win. Both counts are already stored per video.
  const engagementRate = (vList) => {
    // Only videos with measured counts contribute. The public scraper cannot see
    // likes or comments, so those rows are excluded rather than counted as zero.
    const measured = vList.filter((v) => v.likeCount != null && v.commentCount != null && v.viewCount > 0);
    if (measured.length === 0) return { likesPer1k: null, commentsPer1k: null, sampleSize: 0 };
    const totalViews = measured.reduce((s, v) => s + v.viewCount, 0);
    if (totalViews <= 0) return { likesPer1k: null, commentsPer1k: null, sampleSize: 0 };
    const totalLikes = measured.reduce((s, v) => s + v.likeCount, 0);
    const totalComments = measured.reduce((s, v) => s + v.commentCount, 0);
    return {
      likesPer1k: Number(((totalLikes / totalViews) * 1000).toFixed(1)),
      commentsPer1k: Number(((totalComments / totalViews) * 1000).toFixed(1)),
      sampleSize: measured.length,
    };
  };

  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const publishTiming = (vList) => {
    const sorted = [...vList].sort((a, b) => b.viewCount - a.viewCount);
    const topQuartile = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.25)));
    const dayCounts = {};
    topQuartile.forEach((v) => {
      const d = new Date(v.publishedAt);
      if (Number.isNaN(d.getTime())) return;
      const name = DAY_NAMES[d.getUTCDay()];
      dayCounts[name] = (dayCounts[name] || 0) + 1;
    });
    const entries = Object.entries(dayCounts).sort((a, b) => b[1] - a[1]);
    return {
      topDay: entries.length > 0 ? entries[0][0] : null,
      distribution: entries.map(([day, count]) => ({ day, count })),
    };
  };

  // Subscriber counts may be unresolvable. A ratio built on invented defaults is
  // worse than no ratio, so it stays null.
  const ratio = duoSubs > 0 && compSubs > 0
    ? parseFloat((compSubs / duoSubs).toFixed(1))
    : null;

  return {
    subscribers: {
      duo: duoSubs || null,
      competitor: compSubs || null,
      ratio,
    },
    engagement: {
      duo: engagementRate(duoVideos),
      competitor: engagementRate(compVideos),
    },
    publishTiming: {
      duo: publishTiming(duoVideos),
      competitor: publishTiming(compVideos),
    },
    cadence: {
      duo: duoCadence,
      competitor: compCadence,
    },
    avgDuration: {
      duo: duoAvgDuration,
      competitor: compAvgDuration,
    },
    topics: {
      duo: duoTopics,
      competitor: compTopics,
    },
    titlePatterns: {
      duo: duoPatterns,
      competitor: compPatterns,
    },
  };
}

// Helper: Pull channel-wide weighted CTR from YouTube Reporting API reach records if available
function getReportingApiCtr() {
  try {
    const row = db.prepare(`
      SELECT ROUND(SUM(impressions * impressions_ctr) / NULLIF(SUM(impressions), 0), 2) AS weighted_ctr
      FROM video_reach_daily
    `).get();
    if (row && row.weighted_ctr != null) {
      return parseFloat(row.weighted_ctr);
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

const DUO_DEFAULT_AVATAR = "https://yt3.googleusercontent.com/Al-4PHbFW51ukUyBMrk6M-iWW_YCkvIu5QTO94XRlImHGiZnoY_Harm4L39pfcSZf6EvNkd3=s900-c-k-c0x00ffffff-no-rj";

// Master Report Generator: Compares The Electric Duo with any Competitor Channel
async function generateComparisonReport(competitorInput, ctrBenchmark = null, avdBenchmark = null, reportLabel = null) {
  // 1. Resolve Competitor Channel
  const competitorInfo = await resolveChannel(competitorInput);

  // 2. Resolve The Electric Duo Channel
  const duoChannelId = getYoutubeChannelId();
  let duoInfo;
  try {
    duoInfo = await resolveChannel(duoChannelId);
    if (!duoInfo.thumbnailUrl) {
      duoInfo.thumbnailUrl = DUO_DEFAULT_AVATAR;
    }
  } catch (e) {
    duoInfo = {
      channelId: duoChannelId,
      title: "The Electric Duo",
      handle: "@TheElectricDuo",
      thumbnailUrl: DUO_DEFAULT_AVATAR,
      subscriberCount: 24800,
      uploadsPlaylistId: "UU" + duoChannelId.substring(2),
    };
  }

  // 3. Ingest last 12 months for both channels (filtering out <4 min Shorts)
  const [rawDuoVideos, rawCompVideos] = await Promise.all([
    fetchChannelUploads(duoInfo, 12),
    fetchChannelUploads(competitorInfo, 12),
  ]);

  if (rawCompVideos.length === 0) {
    throw new Error(`No long-form uploads (>= 4 min) found for "${competitorInfo.title}" in the last 12 months.`);
  }

  // 4. Run Independent Outlier Detection (per channel relative baseline)
  const duoVideosWithOutliers = detectOutliers(rawDuoVideos);
  const compVideosWithOutliers = detectOutliers(rawCompVideos);

  // 5. Build Competitor Outlier Profiles (Packaging vs Substance + Replicability Heuristics)
  const compOutliers = compVideosWithOutliers
    .filter((v) => v.isOutlier)
    .sort((a, b) => b.multiplier - a.multiplier);

  const outlierProfiles = compOutliers.map((outlier) => {
    const similarVideos = findSimilarNonOutliers(outlier, compVideosWithOutliers);
    const packagingDiff = analyzePackagingDiff(outlier, similarVideos);
    const replicabilityFlags = evaluateReplicability(
      outlier,
      compVideosWithOutliers,
      competitorInfo.subscriberCount,
      duoInfo.subscriberCount
    );

    return {
      youtubeId: outlier.youtubeId,
      title: outlier.title,
      publishedAt: outlier.publishedAt,
      duration: formatDuration(outlier.durationSec),
      durationSec: outlier.durationSec,
      views: outlier.viewCount,
      likes: outlier.likeCount,
      comments: outlier.commentCount,
      thumbnailUrl: outlier.thumbnailUrl,
      multiplier: outlier.multiplier,
      baselineViews: outlier.baselineViews,
      packagingDiff,
      replicabilityFlags,
      actionableTakeaway: `Compare packaging: outlier reached ${outlier.multiplier}x baseline (${outlier.viewCount.toLocaleString()} views vs ${outlier.baselineViews.toLocaleString()} normal).`,
    };
  });

  // 6. Build "DO NOT COPY" & Underperformer Analysis
  const underperformers = detectUnderperformers(
    compVideosWithOutliers,
    competitorInfo.subscriberCount,
    duoInfo.subscriberCount
  );

  // 7. Side-by-Side Summary Matrix & Topic Clustering
  const sideBySide = computeSideBySideSummary(
    duoVideosWithOutliers,
    compVideosWithOutliers,
    duoInfo.subscriberCount,
    competitorInfo.subscriberCount
  );

  // 8. Executive narrative, with the previous run for this competitor as context
  const previousReport = getPreviousReport(competitorInfo.channelId);
  let executiveSummary = null;
  let executiveSummaryError = null;

  const reportingCtr = getReportingApiCtr();
  const effectiveCtr = ctrBenchmark != null && !isNaN(parseFloat(ctrBenchmark))
    ? parseFloat(ctrBenchmark)
    : (reportingCtr != null ? reportingCtr : 5.0);
  const effectiveAvd = avdBenchmark != null && !isNaN(parseFloat(avdBenchmark))
    ? parseFloat(avdBenchmark)
    : 48.0;

  try {
    const result = await generateExecutiveSummary({
      duoChannel: duoInfo,
      competitorChannel: competitorInfo,
      benchmarks: {
        ourCtr: effectiveCtr,
        ourAvd: effectiveAvd,
      },
      outlierProfiles,
      underperformers,
      sideBySide,
      previousReport,
    });
    executiveSummary = result.summary;
    executiveSummaryError = result.error;
  } catch (summaryErr) {
    console.warn("Executive summary generation warning:", summaryErr.message);
    executiveSummaryError = summaryErr.message;
  }

  // 9. Assemble Master Analysis Payload
  const analysis = {
    generatedAt: new Date().toISOString(),
    duoChannel: {
      channelId: duoInfo.channelId,
      title: duoInfo.title,
      handle: duoInfo.handle,
      thumbnailUrl: duoInfo.thumbnailUrl || DUO_DEFAULT_AVATAR,
      subscribers: duoInfo.subscriberCount,
      videoCount12M: duoVideosWithOutliers.length,
      outlierCount: duoVideosWithOutliers.filter((v) => v.isOutlier).length,
    },
    competitorChannel: {
      channelId: competitorInfo.channelId,
      title: competitorInfo.title,
      handle: competitorInfo.handle,
      thumbnailUrl: competitorInfo.thumbnailUrl,
      subscribers: competitorInfo.subscriberCount,
      videoCount12M: compVideosWithOutliers.length,
      outlierCount: compOutliers.length,
    },
    benchmarks: {
      ourCtr: effectiveCtr,
      ourAvd: effectiveAvd,
      reportingCtr: reportingCtr,
    },
    executiveSummary,
    executiveSummaryError,
    previousReportId: previousReport ? previousReport.id : null,
    outlierProfiles,
    underperformers,
    sideBySide,
    guardrailsNote: "All outliers and performance multipliers are calculated relative to each channel's independent baseline. Never chase raw cross-channel view counts.",
  };

  // 9. Persist. Reports are append-only: re-running against the same competitor
  // adds a new run rather than overwriting (and permanently destroying) the last
  // one, so "what changed since last time" is answerable.
  const insertRes = db.prepare(`
    INSERT INTO competitor_reports (
      competitor_channel_id, competitor_title, competitor_handle, competitor_thumbnail,
      competitor_subs, competitor_uploads_count, duo_subs, duo_uploads_count,
      our_ctr_benchmark, our_avd_benchmark, analysis_json, report_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    competitorInfo.channelId,
    competitorInfo.title,
    competitorInfo.handle,
    competitorInfo.thumbnailUrl,
    competitorInfo.subscriberCount,
    compVideosWithOutliers.length,
    duoInfo.subscriberCount,
    duoVideosWithOutliers.length,
    parseFloat(ctrBenchmark) || null,
    parseFloat(avdBenchmark) || null,
    JSON.stringify(analysis),
    reportLabel || null
  );
  const reportId = insertRes.lastInsertRowid;

  // Retain the most recent runs per competitor so history does not grow forever.
  try {
    const stale = db.prepare(`
      SELECT id FROM competitor_reports
      WHERE competitor_channel_id = ?
      ORDER BY created_at DESC
      LIMIT -1 OFFSET ?
    `).all(competitorInfo.channelId, MAX_REPORTS_PER_COMPETITOR);
    if (stale.length > 0) {
      const del = db.prepare("DELETE FROM competitor_reports WHERE id = ?");
      stale.forEach((r) => del.run(r.id));
    }
  } catch (e) {
    console.warn("Could not prune old competitor reports:", e.message);
  }

  // Batch insert competitor videos
  const insertVideoStmt = db.prepare(`
    INSERT INTO competitor_videos (
      report_id, channel_id, is_competitor, youtube_id, title, published_at,
      duration_sec, duration_iso, view_count, like_count, comment_count,
      thumbnail_url, tags_json, description, is_outlier, multiplier, baseline_views
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const v of compVideosWithOutliers) {
      insertVideoStmt.run(
        reportId,
        competitorInfo.channelId,
        1,
        v.youtubeId,
        v.title,
        v.publishedAt,
        v.durationSec,
        v.durationIso,
        v.viewCount,
        v.likeCount,
        v.commentCount,
        v.thumbnailUrl,
        JSON.stringify(v.tags || []),
        v.description || "",
        v.isOutlier ? 1 : 0,
        v.multiplier,
        v.baselineViews
      );
    }
  });
  insertAll();

  return {
    reportId,
    analysis,
  };
}

// Get list of saved reports
// Latest run per competitor, for the report list view.
function listSavedReports() {
  return db
    .prepare(`
      SELECT r.id, r.competitor_channel_id, r.competitor_title, r.competitor_handle,
             r.competitor_thumbnail, r.competitor_subs, r.competitor_uploads_count,
             r.duo_subs, r.duo_uploads_count, r.report_label, r.created_at, r.updated_at,
             (SELECT COUNT(*) FROM competitor_reports x WHERE x.competitor_channel_id = r.competitor_channel_id) AS run_count
      FROM competitor_reports r
      WHERE r.id = (
        SELECT id FROM competitor_reports y
        WHERE y.competitor_channel_id = r.competitor_channel_id
        ORDER BY y.created_at DESC, y.id DESC LIMIT 1
      )
      ORDER BY r.created_at DESC
    `)
    .all();
}

// Every run for one competitor, newest first.
function listReportHistory(competitorChannelId) {
  return db
    .prepare(`
      SELECT id, competitor_channel_id, competitor_title, competitor_subs,
             competitor_uploads_count, report_label, created_at
      FROM competitor_reports
      WHERE competitor_channel_id = ?
      ORDER BY created_at DESC, id DESC
    `)
    .all(competitorChannelId);
}

// Get full report by ID
function getReportById(id) {
  const row = db.prepare("SELECT * FROM competitor_reports WHERE id = ?").get(id);
  if (!row) return null;

  let analysis = null;
  try {
    analysis = JSON.parse(row.analysis_json);
  } catch (e) {
    console.warn(`Could not parse analysis_json for competitor report ${id}:`, e.message);
  }

  return {
    id: row.id,
    competitorChannelId: row.competitor_channel_id,
    competitorTitle: row.competitor_title,
    competitorHandle: row.competitor_handle,
    competitorThumbnail: row.competitor_thumbnail,
    competitorSubs: row.competitor_subs,
    duoSubs: row.duo_subs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    analysis,
  };
}

// Delete report
function deleteReport(id) {
  return db.prepare("DELETE FROM competitor_reports WHERE id = ?").run(id);
}

// Generate CSV export string
function generateReportCsv(id) {
  const report = getReportById(id);
  if (!report || !report.analysis) throw new Error("Report not found");

  const a = report.analysis;
  const lines = [];

  // Header & Overview
  lines.push(`"Competitor Comparison Report: The Electric Duo vs ${report.competitorTitle}"`);
  lines.push(`"Generated At:","${a.generatedAt}"`);
  lines.push(`"The Electric Duo Subscribers:","${a.duoChannel.subscribers.toLocaleString()}"`);
  lines.push(`"${report.competitorTitle} Subscribers:","${a.competitorChannel.subscribers.toLocaleString()}"`);
  lines.push(`"Our Target CTR Benchmark:","${a.benchmarks.ourCtr}%"`);
  lines.push("");

  // Outliers Table
  lines.push(`"COMPETITOR STATISTICAL OUTLIERS (>= 3.0x Baseline)"`);
  lines.push(`"Title","Published Date","Duration","Views","Baseline Views","Outlier Multiplier","Replicability Flags","Key Packaging Takeaway"`);

  (a.outlierProfiles || []).forEach((o) => {
    const flags = (o.replicabilityFlags || []).map((f) => f.label).join(" | ");
    lines.push(
      `"${o.title.replace(/"/g, '""')}","${o.publishedAt.substring(0, 10)}","${o.duration}","${o.views}","${o.baselineViews}","${o.multiplier}x","${flags}","${o.packagingDiff?.keyDiffSummary || ''}"`
    );
  });
  lines.push("");

  // Underperformers Table
  lines.push(`"DO NOT COPY / UNDERPERFORMING PATTERNS (< 0.6x Baseline)"`);
  lines.push(`"Title","Published Date","Duration","Views","Multiplier","Anti-Pattern Diagnosis","Strategic Guidance"`);

  (a.underperformers || []).forEach((u) => {
    lines.push(
      `"${u.title.replace(/"/g, '""')}","${u.publishedAt.substring(0, 10)}","${u.duration}","${u.views}","${u.multiplier}x","${u.antiPatternDiagnosis.replace(/"/g, '""')}","${u.strategicGuidance.replace(/"/g, '""')}"`
    );
  });
  lines.push("");

  // Topic Distribution
  lines.push(`"TOPIC DISTRIBUTION COMPARISON"`);
  lines.push(`"Topic Category","The Electric Duo Share %","Competitor Share %"`);
  const compTopicsMap = {};
  (a.sideBySide?.topics?.competitor || []).forEach((t) => { compTopicsMap[t.name] = t.pct; });
  (a.sideBySide?.topics?.duo || []).forEach((t) => {
    lines.push(`"${t.name}","${t.pct}%","${compTopicsMap[t.name] || 0}%"`);
  });

  return lines.join("\n");
}

module.exports = {
  resolveChannel,
  generateComparisonReport,
  regenerateExecutiveSummary,
  listReportHistory,
  getPreviousReport,
  listSavedReports,
  getReportById,
  deleteReport,
  generateReportCsv,
  getReportingApiCtr,
};
