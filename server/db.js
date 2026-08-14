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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
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

  CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos(published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
  CREATE INDEX IF NOT EXISTS idx_video_audits_updated ON video_audits(updated_at DESC);
`);

// Add transcript column to videos table if not present
try {
  articleDb.exec("ALTER TABLE videos ADD COLUMN transcript TEXT;");
} catch (e) {
  // Column already exists
}

// Compatibility layer
controlDb.controlDb = controlDb;
controlDb.articleDb = articleDb;

module.exports = controlDb;
