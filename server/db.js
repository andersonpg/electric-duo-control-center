"use strict";

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 1. Control Center DB (Users, Sessions, Plan Checklist Events, KPIs)
const controlDbPath = path.join(DATA_DIR, "control-center.sqlite");
const controlDb = new Database(controlDbPath);
controlDb.pragma("journal_mode = WAL");

controlDb.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    oauth_state TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN ('checked', 'unchecked')),
    at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_task_events_lookup ON task_events (task_id, period_key, at);

  CREATE TABLE IF NOT EXISTS counter_values (
    counter_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    value INTEGER NOT NULL DEFAULT 0,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT,
    PRIMARY KEY (counter_id, period_key)
  );

  CREATE TABLE IF NOT EXISTS kpi_values (
    kpi_id TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id),
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS fathom_news_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    image_url TEXT,
    wp_media_id INTEGER,
    the_take TEXT,
    youtube_video_id TEXT,
    wp_post_id INTEGER,
    wp_post_url TEXT,
    status TEXT NOT NULL DEFAULT 'draft_created',
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_fathom_news_created ON fathom_news_history (created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_fathom_news_source_url ON fathom_news_history (source_url);
`);

// 2. Article Generator & Video Audit DB (YouTube Videos Catalog, Content Templates, App Settings, Video Audits)
const articleDbPath = path.join(DATA_DIR, "database.sqlite");

// Auto-seed pre-synced database if it doesn't exist in DATA_DIR
if (!fs.existsSync(articleDbPath)) {
  const seedPath = path.join(__dirname, "..", "seed", "database.sqlite");
  if (fs.existsSync(seedPath)) {
    try {
      fs.copyFileSync(seedPath, articleDbPath);
      console.log("Seeded database.sqlite copied to DATA_DIR.");
    } catch (e) {
      console.warn("Could not copy seed database.sqlite:", e.message);
    }
  }
}

const articleDb = new Database(articleDbPath);
articleDb.pragma("journal_mode = WAL");

articleDb.exec(`
  CREATE TABLE IF NOT EXISTS videos (
    youtube_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    published_at DATETIME NOT NULL,
    thumbnail_url TEXT,
    duration TEXT,
    content_type TEXT DEFAULT 'Review',
    custom_notes TEXT,
    status TEXT DEFAULT 'unprocessed',
    wp_post_id INTEGER,
    wp_draft_url TEXT,
    last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS content_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    prompt_template TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS video_audits (
    youtube_id TEXT PRIMARY KEY REFERENCES videos(youtube_id),
    metrics_json TEXT NOT NULL,
    evaluation_json TEXT NOT NULL,
    health_score INTEGER DEFAULT 75,
    generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS content_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT DEFAULT '#06b6d4',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS channel_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date DATE NOT NULL,
    period_days INTEGER DEFAULT 28,
    views INTEGER DEFAULT 0,
    watch_time_hours REAL DEFAULT 0,
    subs_gained INTEGER DEFAULT 0,
    subs_lost INTEGER DEFAULT 0,
    net_subs INTEGER DEFAULT 0,
    estimated_revenue REAL DEFAULT 0,
    avg_ctr REAL DEFAULT 5.0,
    avg_retention REAL DEFAULT 48.0,
    traffic_share_json TEXT,
    raw_data_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS video_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    youtube_id TEXT NOT NULL,
    snapshot_date DATE NOT NULL,
    views INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    ctr REAL DEFAULT 5.0,
    retention_rate REAL DEFAULT 48.0,
    watch_time_hours REAL DEFAULT 0,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    traffic_share_json TEXT,
    top_search_terms_json TEXT,
    raw_data_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS playlist_category_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id TEXT NOT NULL UNIQUE,
    playlist_title TEXT,
    category TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS timeline_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_date DATE NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS competitor_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    competitor_channel_id TEXT NOT NULL,
    competitor_title TEXT NOT NULL,
    competitor_handle TEXT,
    competitor_thumbnail TEXT,
    competitor_subs INTEGER DEFAULT 0,
    competitor_uploads_count INTEGER DEFAULT 0,
    duo_subs INTEGER DEFAULT 0,
    duo_uploads_count INTEGER DEFAULT 0,
    period_months INTEGER DEFAULT 12,
    our_ctr_benchmark REAL DEFAULT 5.0,
    our_avd_benchmark REAL DEFAULT 48.0,
    analysis_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS competitor_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES competitor_reports(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL,
    is_competitor INTEGER DEFAULT 1,
    youtube_id TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at DATETIME NOT NULL,
    duration_sec INTEGER DEFAULT 0,
    duration_iso TEXT,
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    thumbnail_url TEXT,
    tags_json TEXT,
    description TEXT,
    is_outlier INTEGER DEFAULT 0,
    multiplier REAL DEFAULT 1.0,
    baseline_views REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
  CREATE INDEX IF NOT EXISTS idx_video_audits_updated ON video_audits(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_channel_snapshots_date ON channel_snapshots(snapshot_date DESC);
  CREATE INDEX IF NOT EXISTS idx_video_snapshots_lookup ON video_snapshots(youtube_id, snapshot_date DESC);
  CREATE INDEX IF NOT EXISTS idx_competitor_reports_channel ON competitor_reports(competitor_channel_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_competitor_videos_report ON competitor_videos(report_id, is_competitor);

  CREATE TABLE IF NOT EXISTS transcripts (
    video_id TEXT PRIMARY KEY REFERENCES videos(youtube_id) ON DELETE CASCADE,
    raw_srt TEXT NOT NULL,
    cleaned_srt TEXT NOT NULL,
    plain_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_transcripts_video_id ON transcripts(video_id);

  CREATE TABLE IF NOT EXISTS title_prompt_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    instructions TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS youtube_description_backups (
    video_id TEXT PRIMARY KEY REFERENCES videos(youtube_id) ON DELETE CASCADE,
    previous_description TEXT,
    pushed_block TEXT NOT NULL,
    pushed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

function addColumnIfNotExists(targetDb, table, column, definition) {
  const columns = targetDb.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    targetDb.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    return true;
  }
  return false;
}

// User authorization & session state migrations
const addedAdmin = addColumnIfNotExists(controlDb, "users", "is_admin", "INTEGER NOT NULL DEFAULT 0");
if (addedAdmin) {
  controlDb.exec("UPDATE users SET is_admin = 1;");
}
addColumnIfNotExists(controlDb, "sessions", "oauth_state", "TEXT");

// Video and transcript column migrations
addColumnIfNotExists(articleDb, "videos", "transcript", "TEXT");
addColumnIfNotExists(articleDb, "videos", "category_source", "TEXT DEFAULT 'ai_inferred'");
addColumnIfNotExists(articleDb, "videos", "view_count", "INTEGER DEFAULT 0");
addColumnIfNotExists(articleDb, "videos", "privacy_status", "TEXT DEFAULT 'public'");
addColumnIfNotExists(articleDb, "videos", "working_title", "TEXT");
addColumnIfNotExists(articleDb, "videos", "caption_status", "TEXT DEFAULT 'none'");
addColumnIfNotExists(articleDb, "videos", "title_suggestions", "TEXT");
addColumnIfNotExists(articleDb, "videos", "youtube_title", "TEXT");

addColumnIfNotExists(articleDb, "title_prompt_settings", "thumbnail_instructions", "TEXT");
addColumnIfNotExists(articleDb, "title_prompt_settings", "description_instructions", "TEXT");
addColumnIfNotExists(articleDb, "title_prompt_settings", "chapter_instructions", "TEXT");

addColumnIfNotExists(articleDb, "transcripts", "status", "TEXT DEFAULT 'unfixed'");
addColumnIfNotExists(articleDb, "transcripts", "youtube_caption_id", "TEXT");
addColumnIfNotExists(articleDb, "transcripts", "uploaded_at", "DATETIME");

articleDb.exec("UPDATE videos SET privacy_status = 'public' WHERE privacy_status IS NULL;");
articleDb.exec("UPDATE videos SET youtube_title = title WHERE youtube_title IS NULL;");

try {
  articleDb.exec(`
    UPDATE videos SET caption_status = 'uploaded'
    WHERE youtube_id IN (SELECT video_id FROM transcripts WHERE status = 'uploaded');

    UPDATE videos SET caption_status = 'fixed'
    WHERE youtube_id IN (
      SELECT video_id FROM transcripts 
      WHERE (cleaned_srt IS NOT NULL AND length(cleaned_srt) > 0)
        AND (status IS NULL OR status != 'uploaded')
    );

    UPDATE videos SET caption_status = 'unfixed'
    WHERE youtube_id IN (
      SELECT video_id FROM transcripts 
      WHERE (cleaned_srt IS NULL OR length(cleaned_srt) = 0)
        AND (raw_srt IS NOT NULL AND length(raw_srt) > 0)
        AND (status IS NULL OR status != 'uploaded')
    );

    UPDATE videos SET caption_status = 'none' WHERE caption_status IS NULL;
  `);
} catch (e) {
  console.warn("Could not backfill caption_status defaults:", e.message);
}

// Seed default title prompt settings if not present
const DEFAULT_TITLE_PROMPT_INSTRUCTIONS = `You are a YouTube title strategist for The Electric Duo, a channel that
reviews EVs and EV chargers and covers EV industry news. You think about
titles the way Creator Hooks' Jake Thomas does: title performance comes down
to human psychology — primarily curiosity, secondarily desire and
fear/negativity — and every suggestion should be justifiable by what actually
earns clicks, not by taste.

Your goal is the highest CTR the video can honestly support. A good title
opens a real curiosity gap that the video actually closes. Never overpromise,
never state something that isn't true, and never suggest a title that only
works by misleading the viewer about what's in the video. If no honest
high-CTR angle exists, say so instead of inventing one.

Channel rules:
1. One subject per title. If two things are worth saying, that's two videos.
2. Zero exclamation points.
3. The first ~40 characters must work alone — that's what survives on mobile.
4. Never state the verdict up front. Pose the question, don't answer it.
5. Lead with a real number (price, miles, time, speed) when one exists.
6. A company/product name earns its place only if people actually search it;
   otherwise describe what the thing does.
7. Translate acronyms into outcomes (not "V2H" — "power your house from your
   car").
8. Keep the searchable noun (model name, product) AND the hook in the same
   title — one earns search traffic, the other earns Suggested/Browse.
9. Use "we" for firsthand access (spy shots, skunkworks, first drives) and
   "you" for utility (tutorials, buying advice).
10. Say "Ford" early when there's a genuine Ford angle — that's this
    channel's strongest search territory.

You'll be given a cleaned transcript and, optionally, a few lines of context
on what was surprising, frustrating, or numerically notable about the video.
Use those to find the hook that's specific to this footage, not a generic
angle that could apply to any EV video.`;

const DEFAULT_THUMBNAIL_PROMPT_INSTRUCTIONS = `You are a thumbnail strategist for The Electric Duo. For each title candidate, suggest 1-3 ultra-punchy thumbnail words or a short phrase (2 to 4 words maximum) designed to appear in large, bold text on the thumbnail image.

Thumbnail Rules:
1. 2 to 4 words maximum — readable at small size on mobile devices.
2. Complement, never repeat: do not just repeat words from the title. Create tension, curiosity, or an unanswered question that works together with the title.
3. Emotional triggers: Provoke an immediate reaction (e.g. "BIGGEST MISTAKE", "THEY LIED", "740 MILES LATER", "DON'T BUY THIS", "FINALLY FIXED?").
4. High contrast and immediate comprehension at a glance.`;

const DEFAULT_DESCRIPTION_PROMPT_INSTRUCTIONS = `You are a YouTube description strategist for The Electric Duo, an EV review, road trip, and news channel.
Write a compelling, viewer-first video description that maximizes viewer retention and search discoverability:

Description structure:
1. Hook: 2 to 3 punchy sentences opening the curiosity gap, outlining the central question, dilemma, or headline takeaway of the video.
2. Body: A concise, scannable summary covering what the video actually demonstrates — real-world charging speeds, range results, software quirks, build impressions, or highway test metrics. Keep paragraphs brief.
3. Closing: A thought-provoking discussion prompt for the comments to drive engagement, followed by a call to subscribe to The Electric Duo for real-world EV ownership guides and honest tests.`;

const DEFAULT_CHAPTER_PROMPT_INSTRUCTIONS = `You are a video chapter strategist for The Electric Duo. Generate 6 to 12 logical, chronological chapters based on the provided cleaned SRT transcript with exact timestamps.

Chapter rules:
1. The first chapter must start at 0:00.
2. Generate between 6 and 12 chapters total.
3. Keep labels short, scannable, descriptive, and non-clickbait (under 40 characters each).
4. Each chapter must represent a meaningful transition, vehicle section, test phase, feature deep dive, or discussion topic.
5. Every chapter must run at least 10 seconds.
6. Chapter start timestamps must ascend chronologically and never exceed the video's total duration.`;

try {
  const existingTitlePrompt = articleDb.prepare("SELECT instructions, thumbnail_instructions, description_instructions, chapter_instructions FROM title_prompt_settings WHERE id = 1").get();
  if (!existingTitlePrompt) {
    articleDb.prepare(`
      INSERT INTO title_prompt_settings (id, instructions, thumbnail_instructions, description_instructions, chapter_instructions, updated_at)
      VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(DEFAULT_TITLE_PROMPT_INSTRUCTIONS, DEFAULT_THUMBNAIL_PROMPT_INSTRUCTIONS, DEFAULT_DESCRIPTION_PROMPT_INSTRUCTIONS, DEFAULT_CHAPTER_PROMPT_INSTRUCTIONS);
  } else {
    if (!existingTitlePrompt.thumbnail_instructions || !existingTitlePrompt.thumbnail_instructions.trim()) {
      articleDb.prepare("UPDATE title_prompt_settings SET thumbnail_instructions = ? WHERE id = 1").run(DEFAULT_THUMBNAIL_PROMPT_INSTRUCTIONS);
    }
    if (!existingTitlePrompt.description_instructions || !existingTitlePrompt.description_instructions.trim()) {
      articleDb.prepare("UPDATE title_prompt_settings SET description_instructions = ? WHERE id = 1").run(DEFAULT_DESCRIPTION_PROMPT_INSTRUCTIONS);
    }
    if (!existingTitlePrompt.chapter_instructions || !existingTitlePrompt.chapter_instructions.trim()) {
      articleDb.prepare("UPDATE title_prompt_settings SET chapter_instructions = ? WHERE id = 1").run(DEFAULT_CHAPTER_PROMPT_INSTRUCTIONS);
    }
  }
} catch (e) {
  console.warn("Could not seed title_prompt_settings:", e.message);
}

// Seed default categories
const defaultCategories = [
  { name: "News/Quick Charge", description: "EV industry news, breaking updates, and Quick Charge news episodes", color: "#06b6d4" },
  { name: "Road Trip/Travel Series", description: "Long-distance EV journeys, route tests, and charging vlogs", color: "#3b82f6" },
  { name: "Walkarounds/Reviews", description: "Vehicle deep dives, first looks, and hardware reviews", color: "#8b5cf6" },
  { name: "How Tos/Guides", description: "Tutorials, charging adapter setups, and EV ownership guides", color: "#10b981" },
  { name: "Sponsor Content", description: "Dedicated sponsor segments and product spotlights", color: "#f59e0b" },
  { name: "Other", description: "Livestreams, announcements, and channel updates", color: "#64748b" },
];

const insertCatStmt = articleDb.prepare("INSERT OR IGNORE INTO content_categories (name, description, color) VALUES (?, ?, ?)");
defaultCategories.forEach((cat) => {
  insertCatStmt.run(cat.name, cat.description, cat.color);
});

// Compatibility layer
controlDb.controlDb = controlDb;
controlDb.articleDb = articleDb;

module.exports = controlDb;
