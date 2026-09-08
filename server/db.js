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
    content_type TEXT DEFAULT NULL,
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
    avg_ctr REAL,
    avg_retention REAL,
    avg_view_duration TEXT,
    traffic_share_json TEXT,
    benchmarks_updated_at DATETIME,
    is_fallback INTEGER DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS classification_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL DEFAULT 'applied',
    total INTEGER DEFAULT 0,
    by_playlist INTEGER DEFAULT 0,
    by_ai INTEGER DEFAULT 0,
    needs_review INTEGER DEFAULT 0,
    failed_batches INTEGER DEFAULT 0,
    total_batches INTEGER DEFAULT 0,
    changes_json TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS channel_health_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_days INTEGER NOT NULL,
    period_start DATE,
    period_end DATE,
    is_live_studio_data INTEGER DEFAULT 0,
    report_json TEXT NOT NULL,
    narrative TEXT,
    label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS youtube_description_backups (
    video_id TEXT PRIMARY KEY REFERENCES videos(youtube_id) ON DELETE CASCADE,
    previous_description TEXT,
    pushed_block TEXT NOT NULL,
    pushed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_classification_runs_created ON classification_runs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_channel_health_reports_created ON channel_health_reports(period_days, created_at DESC);
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

// Classification provenance and real YouTube metadata (see FIX_CLASSIFIER_AND_FABRICATED_DATA.md A.2/A.4)
addColumnIfNotExists(articleDb, "videos", "tags_json", "TEXT");
addColumnIfNotExists(articleDb, "videos", "classification_confidence", "REAL");
addColumnIfNotExists(articleDb, "videos", "classification_reason", "TEXT");
addColumnIfNotExists(articleDb, "videos", "description_is_placeholder", "INTEGER DEFAULT 1");

// Per-category benchmarks live on the category row so they can never drift from the name.
// Deliberately left NULL: a benchmark is only real once entered from YouTube Studio.
addColumnIfNotExists(articleDb, "content_categories", "avg_ctr", "REAL");
addColumnIfNotExists(articleDb, "content_categories", "avg_retention", "REAL");
addColumnIfNotExists(articleDb, "content_categories", "avg_view_duration", "TEXT");
addColumnIfNotExists(articleDb, "content_categories", "traffic_share_json", "TEXT");
addColumnIfNotExists(articleDb, "content_categories", "benchmarks_updated_at", "DATETIME");
addColumnIfNotExists(articleDb, "content_categories", "is_fallback", "INTEGER DEFAULT 0");

addColumnIfNotExists(articleDb, "competitor_reports", "report_label", "TEXT");

addColumnIfNotExists(articleDb, "title_prompt_settings", "thumbnail_instructions", "TEXT");
addColumnIfNotExists(articleDb, "title_prompt_settings", "competitor_instructions", "TEXT");
addColumnIfNotExists(articleDb, "title_prompt_settings", "channel_health_instructions", "TEXT");
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

const DEFAULT_CHAPTER_PROMPT_INSTRUCTIONS = `You are a video chapter strategist for The Electric Duo. Generate logical, chronological chapters based on the indexed transcript windows.

Rules for Chapter Titles:
1. Every title must contain at least one concrete noun, figure, or proper name taken directly from that section of the transcript (e.g., vehicle model names, specific feature names, measurements, kW charge rates, prices, range numbers, trim levels, or hardware components).
2. Never use standalone generic labels. Words like "Intro", "Overview", "Tech", "Features", "Specs", "Interior", "Driving", "Final Thoughts", or "Conclusion" must NEVER appear alone; they may only appear when qualified by specific nouns or features (e.g., "Silverado EV Intro & Goal", not "Intro").
3. Keep titles concise: between 2 and 7 words. Use ampersands (&) when joining two related subjects in the same section.
4. Non-clickbait: accurate, scannable, viewer-focused labels that help EV buyers and owners find specific information.

Title Examples (Weak vs. Strong):
- Weak: "Frunk" ➔ Strong: "Frunk Space & 120V Power Outlet"
- Weak: "Driving" ➔ Strong: "Driving Impressions & Sidewinder 4-Wheel Steering"
- Weak: "Cabin Tech" ➔ Strong: "17-Inch Infotainment Screen & Drive Modes"
- Weak: "Final Verdict" ➔ Strong: "Final Verdict, Pricing & Conclusion"

Timestamp & Quote Requirements:
- For each chapter, identify the exact point the section begins.
- Provide "anchorQuote": 6 to 12 words copied VERBATIM from the transcript text at the exact moment this topic starts. Do not paraphrase or alter punctuation in the quote.
- Provide "startWindow": the integer window index [index] where that section starts as a fallback.
- The first chapter must begin at the very start of the video (window 0).`;

const DEFAULT_COMPETITOR_PROMPT_INSTRUCTIONS = `You are a YouTube growth strategist advising "The Electric Duo" — Patrick and Liv, a two-person EV channel. You have been handed a structured comparison against one competitor channel. Write to Patrick directly.

Your job is to find things we can act on in the next 30 days. A takeaway we cannot execute with two people, one camera setup, and our current subscriber base is not a takeaway.

STRUCTURE:

1. BOTTOM LINE — 2-3 sentences. The single most important pattern in this competitor's results, and what it implies for us.

2. WHAT TO LEARN — 2 to 4 items. For each one: name the pattern, name the specific video or videos that show it, explain the mechanism (why this made someone click or keep watching), and give one concrete thing we could do on a video in the next month.

3. WHAT NOT TO COPY — 2 to 3 items. Each must name the specific reason it will not transfer: audience scale, a one-time news event, production resources we do not have, or a format that conflicts with our channel. If a video is flagged with a scale-advantage replicability flag, treat it with suspicion.

4. WHERE WE ARE ALREADY AHEAD — 1 to 2 sentences. Something our own numbers show we do better, or that we should keep doing rather than change.

5. CONFIDENCE AND BLIND SPOTS — 2 to 3 sentences. State plainly what this analysis cannot see. We have no retention, click-through, or impression data for the competitor. Everything here is inferred from public view counts and packaging. Say so, and name any conclusion above that is weaker than the others.

RULES:
- Ground every claim in the data block provided. Never invent a number, a video title, or a date.
- If the data is too thin to support a section, say the data is too thin. Do not fill space.
- Multipliers are relative to each channel's own baseline. Never compare our raw view counts to theirs and never suggest we should be hitting their absolute numbers.
- Use a number only when the number itself is the point. At most one per bullet.
- Plain, direct prose. No memo headers, no ASCII tables, no closing summary paragraph.
- Do not congratulate, hedge, or pad. If something is not working, say it is not working.`;

const DEFAULT_CHANNEL_HEALTH_PROMPT_INSTRUCTIONS = `You are a YouTube channel analyst reviewing "The Electric Duo" — Patrick and Liv, a two-person EV channel. You have this channel's own analytics for the reporting period below, plus the prior period for comparison. Write to Patrick directly.

Your job is to say what changed, whether it matters, and what to do about it. Distinguish clearly between normal fluctuation and a real signal.

STRUCTURE:

1. HEADLINE — 2-3 sentences. Is the channel up, flat, or down this period, and what is driving it? Name the one metric that matters most right now.

2. WHAT'S WORKING — 2 to 3 items, each tied to a specific video or category. Say what the pattern is and what it suggests we should do more of.

3. WHAT NEEDS ATTENTION — 2 to 3 items. Be specific and unsentimental. Name the video or category, the metric that is soft, and the most likely cause. If a video underperformed on views but held retention, say so — that is a packaging problem, not a content problem, and the reverse is also true.

4. THIS PERIOD'S ONE EXPERIMENT — a single, concrete thing to try on the next upload, and the metric that would tell us within two weeks whether it worked.

5. DATA CONFIDENCE — 1 to 3 sentences. State which figures are measured and which are unavailable. Never present an unavailable figure as measured.

RULES:
- A short period is a small sample. Do not read a trend into two videos.
- Distinguish a metric moving because performance changed from a metric moving because the upload count changed.
- Never invent a number, a video title, or a date. If something is missing, say it is missing.
- Compare against our own prior period only. Do not reference other channels' absolute numbers.
- Plain, direct prose. No memo headers, no ASCII tables, no closing pep talk.`;

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

  // Seed the competitor + channel health narrative instructions if blank.
  const promptRow = articleDb.prepare("SELECT competitor_instructions, channel_health_instructions FROM title_prompt_settings WHERE id = 1").get() || {};
  if (!promptRow.competitor_instructions || !promptRow.competitor_instructions.trim()) {
    articleDb.prepare("UPDATE title_prompt_settings SET competitor_instructions = ? WHERE id = 1").run(DEFAULT_COMPETITOR_PROMPT_INSTRUCTIONS);
  }
  if (!promptRow.channel_health_instructions || !promptRow.channel_health_instructions.trim()) {
    articleDb.prepare("UPDATE title_prompt_settings SET channel_health_instructions = ? WHERE id = 1").run(DEFAULT_CHANNEL_HEALTH_PROMPT_INSTRUCTIONS);
  }

  // One-time migration for chapter prompt v2 (guarded by app_settings flag)
  const migrationFlag = articleDb.prepare("SELECT value FROM app_settings WHERE key = 'chapter_prompt_v2_migrated'").get();
  if (!migrationFlag) {
    articleDb.prepare("UPDATE title_prompt_settings SET chapter_instructions = ? WHERE id = 1").run(DEFAULT_CHAPTER_PROMPT_INSTRUCTIONS);
    articleDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('chapter_prompt_v2_migrated', '1')").run();
  }
} catch (e) {
  console.warn("Could not seed or migrate title_prompt_settings:", e.message);
}

// Seed default categories
const defaultCategories = [
  { name: "News/Quick Charge", description: "EV industry news, breaking updates, and Quick Charge news episodes", color: "#06b6d4" },
  { name: "Road Trip/Travel Series", description: "Long-distance EV journeys, route tests, and charging vlogs", color: "#3b82f6" },
  { name: "Walkarounds/Reviews", description: "Vehicle deep dives, first looks, and hardware reviews", color: "#8b5cf6" },
  { name: "How Tos/Guides", description: "Tutorials, charging adapter setups, and EV ownership guides", color: "#10b981" },
  { name: "Sponsor Content", description: "Dedicated sponsor segments and product spotlights", color: "#f59e0b" },
  { name: "Livestreams & Channel Updates", description: "Livestreams, channel announcements, and channel updates only", color: "#64748b" },
];

const insertCatStmt = articleDb.prepare("INSERT OR IGNORE INTO content_categories (name, description, color) VALUES (?, ?, ?)");
defaultCategories.forEach((cat) => {
  insertCatStmt.run(cat.name, cat.description, cat.color);
});

// ---------------------------------------------------------------------------
// One-time migration: unify the category vocabulary.
//
// The videos table historically carried a different set of names ("Review",
// "EV News", "Road Trip / Vlog", "How-To / Instructional") than
// content_categories. Nothing matched, so every category breakdown resolved to
// zero and audit benchmarks silently fell back to a single default. This maps
// the legacy names onto the live vocabulary and quarantines anything unknown.
// ---------------------------------------------------------------------------
const LEGACY_CATEGORY_MAP = {
  "Review": "Walkarounds/Reviews",
  "EV Review": "Walkarounds/Reviews",
  "Reviews": "Walkarounds/Reviews",
  "EV News": "News/Quick Charge",
  "News": "News/Quick Charge",
  "Road Trip / Vlog": "Road Trip/Travel Series",
  "Road Trip/Vlog": "Road Trip/Travel Series",
  "How-To / Instructional": "How Tos/Guides",
  "How-To/Instructional": "How Tos/Guides",
  "Other": "Livestreams & Channel Updates",
};

try {
  const catMigrationFlag = articleDb.prepare("SELECT value FROM app_settings WHERE key = 'category_vocabulary_v3_migrated'").get();
  if (!catMigrationFlag) {
    const runCategoryMigration = articleDb.transaction(() => {
      // Rename the vague "Other" bucket so it stops acting as a dumping ground.
      const otherRow = articleDb.prepare("SELECT id FROM content_categories WHERE name = 'Other'").get();
      const newOtherRow = articleDb.prepare("SELECT id FROM content_categories WHERE name = 'Livestreams & Channel Updates'").get();
      if (otherRow && !newOtherRow) {
        articleDb.prepare("UPDATE content_categories SET name = 'Livestreams & Channel Updates', description = 'Livestreams, channel announcements, and channel updates only' WHERE id = ?").run(otherRow.id);
      } else if (otherRow && newOtherRow) {
        articleDb.prepare("DELETE FROM content_categories WHERE id = ?").run(otherRow.id);
      }

      // Mark the fallback category so code can recognise it without hardcoding a string.
      articleDb.prepare("UPDATE content_categories SET is_fallback = 1 WHERE name = 'Livestreams & Channel Updates'").run();

      const validNames = new Set(articleDb.prepare("SELECT name FROM content_categories").all().map((c) => c.name));

      // Remap legacy names, preserving manual assignments as manual.
      const updateStmt = articleDb.prepare(
        "UPDATE videos SET content_type = ?, category_source = CASE WHEN category_source = 'manual' THEN 'manual' ELSE 'migrated' END WHERE content_type = ?"
      );
      for (const [legacy, current] of Object.entries(LEGACY_CATEGORY_MAP)) {
        if (validNames.has(current)) updateStmt.run(current, legacy);
      }

      // Anything still not matching a live category becomes an explicit unknown
      // rather than a confident wrong answer.
      const stragglers = articleDb.prepare(
        "SELECT DISTINCT content_type FROM videos WHERE content_type IS NOT NULL AND content_type != ''"
      ).all().map((r) => r.content_type).filter((n) => !validNames.has(n));

      if (stragglers.length > 0) {
        const clearStmt = articleDb.prepare(
          "UPDATE videos SET content_type = NULL, category_source = 'needs_review' WHERE content_type = ?"
        );
        stragglers.forEach((n) => clearStmt.run(n));
        console.warn(`Category migration: quarantined ${stragglers.length} unknown category name(s) for review: ${stragglers.join(", ")}`);
      }
    });

    runCategoryMigration();
    articleDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('category_vocabulary_v3_migrated', '1')").run();
    console.log("Category vocabulary migration complete.");
  }

  // -------------------------------------------------------------------------
  // Corrective migration: undo the "Other" -> "Livestreams & Channel Updates"
  // relabel for videos that were never livestreams.
  //
  // The v3 vocabulary migration renamed the "Other" category on the assumption
  // that it only held livestreams and channel updates, which was true of the
  // seeded description but not of the live data. In production "Other" was a
  // general dumping bucket holding 241 videos: interviews, event coverage,
  // solar payback, charging network explainers. Renaming it gave every one of
  // them a confident, wrong label, which is worse than the honest "Other" they
  // had before.
  //
  // These rows are returned to an explicit unknown so the classifier can place
  // them properly. Manual assignments are never touched. The change is recorded
  // in classification_runs so it can be reviewed and rolled back.
  // -------------------------------------------------------------------------
  const livestreamResetFlag = articleDb.prepare("SELECT value FROM app_settings WHERE key = 'livestream_mislabel_reset_v1'").get();
  if (!livestreamResetFlag) {
    const affected = articleDb.prepare(`
      SELECT youtube_id, title, content_type FROM videos
      WHERE content_type = 'Livestreams & Channel Updates'
        AND COALESCE(category_source, '') = 'migrated'
    `).all();

    if (affected.length > 0) {
      const runReset = articleDb.transaction(() => {
        const stmt = articleDb.prepare(`
          UPDATE videos
          SET content_type = NULL,
              category_source = 'needs_review',
              classification_confidence = NULL,
              classification_reason = 'Reset: was in the legacy "Other" bucket, relabelled in error as a livestream'
          WHERE youtube_id = ?
        `);
        affected.forEach((v) => stmt.run(v.youtube_id));

        const changes = affected.map((v) => ({
          youtube_id: v.youtube_id,
          title: v.title,
          from: v.content_type,
          to: null,
          source: "needs_review",
          confidence: null,
          reason: "Corrective reset of the Other -> Livestreams relabel",
        }));

        articleDb.prepare(`
          INSERT INTO classification_runs (mode, total, by_playlist, by_ai, needs_review, failed_batches, total_batches, changes_json, error)
          VALUES ('applied', ?, 0, 0, ?, 0, 0, ?, ?)
        `).run(
          affected.length,
          affected.length,
          JSON.stringify(changes),
          "Corrective migration: undo the Other -> Livestreams & Channel Updates relabel"
        );
      });

      runReset();
      console.log(`Reset ${affected.length} video(s) mislabelled as livestreams; they are queued for reclassification.`);
    }

    articleDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('livestream_mislabel_reset_v1', '1')").run();
  }

  // -------------------------------------------------------------------------
  // Scope the Mustang Mach-E category to genuine ownership content.
  //
  // 261 of 746 videos mention the Mach-E, spread across reviews, road trips,
  // news and how-tos. Left as a general "all about the Mach-E" bucket it would
  // absorb roughly a third of the library and recreate the overload that made
  // the old Walkarounds/Reviews category useless for comparison.
  //
  // The category is kept, but narrowed: it is for content where being an owner
  // is the point, not for anything that happens to feature the car. The
  // previous description is preserved in app_settings so this is reversible.
  // -------------------------------------------------------------------------
  const MACHE_CATEGORY = "Mustang Mach-E Owner Content";
  const MACHE_SCOPED_DESCRIPTION =
    "Long-term Mustang Mach-E ownership: living-with-it updates, owner tips, maintenance, mods, and software or feature walkthroughs from an owner's perspective. NOT for reviews, road trips, comparisons, or news that merely feature a Mach-E.";

  const macheScopeFlag = articleDb.prepare("SELECT value FROM app_settings WHERE key = 'mache_category_scoped_v1'").get();
  if (!macheScopeFlag) {
    const macheRow = articleDb.prepare("SELECT id, description FROM content_categories WHERE name = ?").get(MACHE_CATEGORY);
    if (macheRow) {
      articleDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('mache_category_previous_description', ?)")
        .run(macheRow.description || "");
      articleDb.prepare("UPDATE content_categories SET description = ? WHERE id = ?")
        .run(MACHE_SCOPED_DESCRIPTION, macheRow.id);
      console.log(`Scoped "${MACHE_CATEGORY}" to genuine ownership content.`);
    }
    articleDb.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('mache_category_scoped_v1', '1')").run();
  }

  // Runs on every boot: an older seed list could reintroduce a bare "Other"
  // row after the rename, leaving two buckets meaning the same thing.
  const strayOther = articleDb.prepare("SELECT id FROM content_categories WHERE name = 'Other'").get();
  if (strayOther) {
    const canonical = articleDb.prepare("SELECT id FROM content_categories WHERE name = 'Livestreams & Channel Updates'").get();
    if (canonical) {
      articleDb.prepare("UPDATE videos SET content_type = 'Livestreams & Channel Updates' WHERE content_type = 'Other'").run();
      articleDb.prepare("DELETE FROM content_categories WHERE id = ?").run(strayOther.id);
    } else {
      articleDb.prepare("UPDATE content_categories SET name = 'Livestreams & Channel Updates', description = 'Livestreams, channel announcements, and channel updates only', is_fallback = 1 WHERE id = ?").run(strayOther.id);
    }
  }
} catch (e) {
  console.warn("Could not run category vocabulary migration:", e.message);
}

// Compatibility layer
controlDb.controlDb = controlDb;
controlDb.articleDb = articleDb;
controlDb.DEFAULT_COMPETITOR_PROMPT_INSTRUCTIONS = DEFAULT_COMPETITOR_PROMPT_INSTRUCTIONS;
controlDb.DEFAULT_CHANNEL_HEALTH_PROMPT_INSTRUCTIONS = DEFAULT_CHANNEL_HEALTH_PROMPT_INSTRUCTIONS;

module.exports = controlDb;
