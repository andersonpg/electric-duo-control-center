"use strict";

const fs = require("fs");
const path = require("path");
const db = require("./db");
const articleDb = db.articleDb;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

// Tables in the control database that hold credentials or session material.
// These are never included in a downloadable export.
const SENSITIVE_TABLES = ["users", "sessions"];

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  return BACKUP_DIR;
}

function timestampSlug(d = new Date()) {
  return d.toISOString().replace(/[:.]/g, "-").replace("T", "_").split("Z")[0];
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Uses SQLite's online backup API rather than copying the file. A plain file
// copy of a live WAL-mode database can capture a torn snapshot that is missing
// committed transactions still sitting in the -wal file.
async function createBackup({ label = null } = {}) {
  ensureBackupDir();
  const name = `command-center_${timestampSlug()}${label ? "_" + label.replace(/[^a-zA-Z0-9_-]/g, "-") : ""}.sqlite`;
  const destination = path.join(BACKUP_DIR, name);

  await articleDb.backup(destination);

  const stats = fs.statSync(destination);
  return {
    success: true,
    filename: name,
    path: destination,
    bytes: stats.size,
    size: formatBytes(stats.size),
    createdAt: new Date().toISOString(),
  };
}

// A copy with credential-bearing tables dropped, safe to hand to a third party
// for debugging. The article database holds no credentials, but this guards
// against the set expanding later.
async function createSharableBackup({ label = null } = {}) {
  const backup = await createBackup({ label: label ? `${label}-shareable` : "shareable" });

  const Database = require("better-sqlite3");
  const copy = new Database(backup.path);
  const removed = [];
  try {
    const present = copy.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    for (const t of SENSITIVE_TABLES) {
      if (present.includes(t)) {
        copy.exec(`DROP TABLE IF EXISTS ${t};`);
        removed.push(t);
      }
    }
    copy.exec("VACUUM;");
  } finally {
    copy.close();
  }

  const stats = fs.statSync(backup.path);
  return { ...backup, bytes: stats.size, size: formatBytes(stats.size), removedTables: removed, shareable: true };
}

function listBackups() {
  ensureBackupDir();
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".sqlite"))
    .map((f) => {
      const stats = fs.statSync(path.join(BACKUP_DIR, f));
      return {
        filename: f,
        bytes: stats.size,
        size: formatBytes(stats.size),
        createdAt: stats.mtime.toISOString(),
        shareable: f.includes("shareable"),
      };
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Resolves a filename to a path inside the backup directory, refusing anything
// that escapes it.
function resolveBackupPath(filename) {
  if (!filename || typeof filename !== "string") throw new Error("A backup filename is required.");
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error("Invalid backup filename.");
  }
  if (!filename.endsWith(".sqlite")) throw new Error("Invalid backup filename.");

  const resolved = path.resolve(BACKUP_DIR, filename);
  if (path.dirname(resolved) !== path.resolve(BACKUP_DIR)) {
    throw new Error("Invalid backup filename.");
  }
  if (!fs.existsSync(resolved)) throw new Error("Backup not found.");
  return resolved;
}

function deleteBackup(filename) {
  fs.unlinkSync(resolveBackupPath(filename));
  return { success: true, filename };
}

// Keeps the newest N backups so the directory cannot grow without bound.
function pruneBackups(keep = 10) {
  const all = listBackups();
  const stale = all.slice(keep);
  stale.forEach((b) => {
    try {
      fs.unlinkSync(path.join(BACKUP_DIR, b.filename));
    } catch (e) {
      console.warn(`Could not prune backup ${b.filename}:`, e.message);
    }
  });
  return { pruned: stale.length, remaining: Math.min(all.length, keep) };
}

// A quick, human-readable summary so the state of a database can be checked
// without downloading it.
function describeDatabase() {
  const table = (name, query) => {
    try {
      return articleDb.prepare(query).get().n;
    } catch (e) {
      return null;
    }
  };

  const categories = (() => {
    try {
      return articleDb
        .prepare(`
          SELECT c.name, c.avg_ctr, c.avg_retention, COUNT(v.youtube_id) AS videos
          FROM content_categories c
          LEFT JOIN videos v ON v.content_type = c.name
          GROUP BY c.name ORDER BY videos DESC
        `)
        .all();
    } catch (e) {
      return [];
    }
  })();

  return {
    generatedAt: new Date().toISOString(),
    dataDir: DATA_DIR,
    counts: {
      videos: table("videos", "SELECT COUNT(*) n FROM videos"),
      publicVideos: table("videos", "SELECT COUNT(*) n FROM videos WHERE privacy_status IS NULL OR privacy_status = 'public'"),
      transcripts: table("transcripts", "SELECT COUNT(*) n FROM transcripts"),
      categories: table("content_categories", "SELECT COUNT(*) n FROM content_categories"),
      videoAudits: table("video_audits", "SELECT COUNT(*) n FROM video_audits"),
      competitorReports: table("competitor_reports", "SELECT COUNT(*) n FROM competitor_reports"),
      channelHealthReports: table("channel_health_reports", "SELECT COUNT(*) n FROM channel_health_reports"),
      classificationRuns: table("classification_runs", "SELECT COUNT(*) n FROM classification_runs"),
      videosWithViewCounts: table("videos", "SELECT COUNT(*) n FROM videos WHERE view_count > 0"),
      videosNeedingReview: table("videos", "SELECT COUNT(*) n FROM videos WHERE COALESCE(category_source,'') IN ('needs_review','unclassified')"),
    },
    categories,
  };
}

module.exports = {
  createBackup,
  createSharableBackup,
  listBackups,
  resolveBackupPath,
  deleteBackup,
  pruneBackups,
  describeDatabase,
  BACKUP_DIR,
};
