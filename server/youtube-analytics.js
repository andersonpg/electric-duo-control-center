"use strict";

const { google } = require("googleapis");
const db = require("./db").articleDb;

const SCOPES = [
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

function getRedirectUri() {
  const customUri = getSetting("google_redirect_uri");
  if (customUri) return customUri;
  const host = process.env.BASE_URL || "https://cc.theelectricduo.com";
  return `${host.replace(/\/$/, "")}/api/auth/google/callback`;
}

function getSetting(key) {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
    if (row && row.value && row.value.trim()) return row.value.trim();
  } catch (e) {
    console.warn(`Could not read app_setting ${key}:`, e.message);
  }
  return process.env[key.toUpperCase()] || null;
}

function setSetting(key, value) {
  try {
    db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
  } catch (e) {
    console.warn(`Error setting app_setting ${key}:`, e.message);
  }
}

function getOAuthCredentials() {
  const clientId = getSetting("google_client_id") || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = getSetting("google_client_secret") || process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = getRedirectUri();
  return { clientId, clientSecret, redirectUri };
}

function createOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = getOAuthCredentials();
  if (!clientId || !clientSecret) return null;
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getSavedTokens() {
  const raw = getSetting("google_oauth_tokens");
  let tokens = null;
  if (raw) {
    try {
      tokens = JSON.parse(raw);
    } catch (e) {
      tokens = null;
    }
  }

  // Fallback to process.env.GOOGLE_REFRESH_TOKEN if not stored or missing refresh_token
  const envRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (envRefreshToken) {
    if (!tokens) {
      tokens = { refresh_token: envRefreshToken };
    } else if (!tokens.refresh_token) {
      tokens.refresh_token = envRefreshToken;
    }
  }

  return tokens;
}

function saveTokens(tokens) {
  setSetting("google_oauth_tokens", JSON.stringify(tokens));
}

function getAuthenticatedClient() {
  const oauth2Client = createOAuth2Client();
  if (!oauth2Client) return null;

  const tokens = getSavedTokens();
  if (!tokens || (!tokens.access_token && !tokens.refresh_token)) return null;

  oauth2Client.setCredentials(tokens);

  // Auto-save refreshed tokens
  oauth2Client.on("tokens", (newTokens) => {
    const current = getSavedTokens() || {};
    const merged = { ...current, ...newTokens };
    saveTokens(merged);
  });

  return oauth2Client;
}

function isOAuthConnected() {
  const tokens = getSavedTokens();
  return !!(tokens && (tokens.access_token || tokens.refresh_token));
}

function generateAuthUrl(state) {
  const oauth2Client = createOAuth2Client();
  if (!oauth2Client) {
    throw new Error("Google Client ID and Client Secret must be configured before connecting.");
  }

  const options = {
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  };
  if (state) options.state = state;

  return oauth2Client.generateAuthUrl(options);
}

async function handleAuthCallback(code) {
  const oauth2Client = createOAuth2Client();
  if (!oauth2Client) throw new Error("Google OAuth credentials missing.");

  const { tokens } = await oauth2Client.getToken(code);
  saveTokens(tokens);
  oauth2Client.setCredentials(tokens);

  // Fetch channel name to verify connection
  try {
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const channelRes = await youtube.channels.list({ part: "snippet", mine: true });
    const channel = channelRes.data.items?.[0];
    if (channel) {
      setSetting("connected_channel_title", channel.snippet.title);
      setSetting("connected_channel_id", channel.id);
    }
  } catch (e) {
    console.warn("Could not fetch connected channel info:", e.message);
  }

  return tokens;
}

function disconnectOAuth() {
  try {
    db.prepare("DELETE FROM app_settings WHERE key IN ('google_oauth_tokens', 'connected_channel_title', 'connected_channel_id')").run();
  } catch (e) {
    console.warn("Could not delete OAuth settings on disconnect:", e.message);
  }
}

function getGrantedScopes() {
  const tokens = getSavedTokens();
  if (!tokens || tokens.scope === undefined || tokens.scope === null) return null;
  if (Array.isArray(tokens.scope)) return tokens.scope;
  if (typeof tokens.scope === "string") return tokens.scope.split(" ").filter(Boolean);
  return null;
}

async function getOAuthStatus() {
  const { clientId, clientSecret, redirectUri } = getOAuthCredentials();
  const connected = isOAuthConnected();
  const channelTitle = getSetting("connected_channel_title") || (connected ? "The Electric Duo" : null);
  const channelId = getSetting("connected_channel_id") || getSetting("youtube_channel_id");

  const grantedScopes = getGrantedScopes();
  let hasCaptionScope = null;
  let captionScopeStatus = "unknown";

  if (connected) {
    if (grantedScopes === null) {
      hasCaptionScope = null; // unknown: stored tokens have no scope field
      captionScopeStatus = "unknown";
    } else {
      hasCaptionScope = grantedScopes.includes("https://www.googleapis.com/auth/youtube.force-ssl");
      captionScopeStatus = hasCaptionScope ? "granted" : "missing";
    }
  }

  return {
    isConfigured: !!(clientId && clientSecret),
    isConnected: connected,
    clientIdConfigured: !!clientId,
    redirectUri,
    channelTitle,
    channelId,
    grantedScopes,
    hasCaptionScope,
    captionScopeStatus,
  };
}

// Fetch live YouTube Analytics data for a specific video
async function fetchLiveVideoAnalytics(youtubeId) {
  const authClient = getAuthenticatedClient();
  if (!authClient) return null;

  const ytAnalytics = google.youtubeAnalytics({ version: "v2", auth: authClient });

  // Safe query helper: tries today's date first, falls back to yesterday if
  // timezone / processing boundaries reject today's date
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const yesterdayStr = new Date(now.getTime() - 86400000).toISOString().split("T")[0];

  async function querySafe(params, label) {
    try {
      const res = await ytAnalytics.reports.query({ ...params, endDate: todayStr });
      return res.data || null;
    } catch (err) {
      try {
        const res2 = await ytAnalytics.reports.query({ ...params, endDate: yesterdayStr });
        return res2.data || null;
      } catch (err2) {
        console.warn(`YouTube Analytics query failed for ${label}:`, err2.message);
        return null;
      }
    }
  }

  // 1. Core Performance Report (Views, Watch Time, AVD, Retention %, Subs, Engagement)
  let coreData = null;
  const coreRes = await querySafe(
    {
      ids: "channel==MINE",
      startDate: "2020-01-01",
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares",
      filters: `video==${youtubeId}`,
    },
    `core metrics ${youtubeId}`
  );

  if (coreRes?.rows && coreRes.rows.length > 0) {
    const r = coreRes.rows[0];
    const views = r[0] || 0;
    const watchMinutes = Math.round(r[1] || 0);
    // Only treat as valid measured data if there is actual recorded activity
    if (views > 0 || watchMinutes > 0) {
      coreData = {
        views,
        watchMinutes,
        avgViewDurationSec: Math.round(r[2] || 0),
        retentionRate: Number((r[3] || 0).toFixed(1)),
        subsGained: r[4] || 0,
        subsLost: r[5] || 0,
        likes: r[6] || 0,
        comments: r[7] || 0,
        shares: r[8] || 0,
      };
    }
  }

  // 2. Audience Retention Curve Report
  let retentionCurve = null;
  const retRes = await querySafe(
    {
      ids: "channel==MINE",
      startDate: "2020-01-01",
      metrics: "audienceWatchRatio",
      dimensions: "elapsedVideoTimeRatio",
      filters: `video==${youtubeId}`,
      sort: "elapsedVideoTimeRatio",
    },
    `retention curve ${youtubeId}`
  );

  if (retRes?.rows && retRes.rows.length > 0) {
    retentionCurve = retRes.rows.map((row) => {
      const ratio = parseFloat(row[0]);
      const pct = Math.round(parseFloat(row[1]) * 100);
      return {
        time: `${Math.round(ratio * 100)}%`,
        pct: Math.min(100, Math.max(0, pct)),
        ratio,
      };
    });
  }

  // 3. Traffic Source Breakdown Report
  let trafficShare = null;
  const trafficRes = await querySafe(
    {
      ids: "channel==MINE",
      startDate: "2020-01-01",
      metrics: "views",
      dimensions: "insightTrafficSourceType",
      filters: `video==${youtubeId}`,
    },
    `traffic sources ${youtubeId}`
  );

  if (trafficRes?.rows && trafficRes.rows.length > 0) {
    let totalViews = 0;
    const counts = { browse: 0, suggested: 0, search: 0, other: 0 };

    trafficRes.rows.forEach(([source, count]) => {
      totalViews += count;
      if (source === "BROWSE" || source === "SUBSCRIBER") counts.browse += count;
      else if (source === "RELATED_VIDEO") counts.suggested += count;
      else if (source === "YT_SEARCH") counts.search += count;
      else counts.other += count;
    });

    if (totalViews > 0) {
      trafficShare = {
        browse: Math.round((counts.browse / totalViews) * 100),
        suggested: Math.round((counts.suggested / totalViews) * 100),
        search: Math.round((counts.search / totalViews) * 100),
        other: Math.max(
          0,
          100 -
            (Math.round((counts.browse / totalViews) * 100) +
              Math.round((counts.suggested / totalViews) * 100) +
              Math.round((counts.search / totalViews) * 100))
        ),
      };
    }
  }

  return {
    coreData,
    retentionCurve,
    trafficShare,
    isLive: !!(coreData && (coreData.views > 0 || coreData.watchMinutes > 0)),
  };
}

module.exports = {
  getRedirectUri,
  getOAuthCredentials,
  generateAuthUrl,
  handleAuthCallback,
  disconnectOAuth,
  getOAuthStatus,
  getGrantedScopes,
  isOAuthConnected,
  getAuthenticatedClient,
  fetchLiveVideoAnalytics,
};
