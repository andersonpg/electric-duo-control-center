"use strict";

const { google } = require("googleapis");
const { getAuthenticatedClient, isOAuthConnected } = require("./youtube-analytics");
const db = require("./db").articleDb;

const REPORT_TYPE_ID = "channel_reach_basic_a1";
const JOB_NAME = "Electric Duo Reach Basic";

function getSetting(key) {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
    if (row && row.value && row.value.trim()) return row.value.trim();
  } catch (e) {
    console.warn(`Could not read app_setting ${key}:`, e.message);
  }
  return null;
}

function setSetting(key, value) {
  try {
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(key, String(value));
  } catch (e) {
    console.warn(`Error setting app_setting ${key}:`, e.message);
  }
}

/**
 * Ensures the channel_reach_basic_a1 reporting job is registered with Google.
 */
async function ensureReachJob() {
  const auth = getAuthenticatedClient();
  if (!auth) {
    return { success: false, error: "YouTube OAuth client is not authenticated." };
  }

  const ytReporting = google.youtubereporting({ version: "v1", auth });

  // 1. Check if we already have a saved job ID
  let jobId = getSetting("youtube_reach_job_id");
  if (jobId) {
    try {
      const existing = await ytReporting.jobs.get({ jobId });
      if (existing.data && existing.data.id) {
        return { success: true, jobId, created: false };
      }
    } catch (e) {
      console.warn(`Saved reach job ${jobId} not found or inaccessible, querying list:`, e.message);
    }
  }

  // 2. Query existing jobs on the channel
  try {
    const listRes = await ytReporting.jobs.list({});
    const jobs = listRes.data?.jobs || [];
    const found = jobs.find((j) => j.reportTypeId === REPORT_TYPE_ID);

    if (found) {
      jobId = found.id;
      setSetting("youtube_reach_job_id", jobId);
      return { success: true, jobId, created: false, job: found };
    }

    // 3. Create the job if none exists
    console.log(`Creating new YouTube Reporting API job for ${REPORT_TYPE_ID}...`);
    const createRes = await ytReporting.jobs.create({
      requestBody: {
        reportTypeId: REPORT_TYPE_ID,
        name: JOB_NAME,
      },
    });

    jobId = createRes.data?.id;
    if (!jobId) {
      throw new Error("Job creation succeeded but no job ID was returned.");
    }

    setSetting("youtube_reach_job_id", jobId);
    console.log(`YouTube Reporting API job created successfully: ${jobId}`);
    return { success: true, jobId, created: true, job: createRes.data };
  } catch (err) {
    console.error("Failed to ensure YouTube reach reporting job:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Formats YYYYMMDD string to YYYY-MM-DD
 */
function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.length === 8 && !s.includes("-")) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s;
}

/**
 * Synchronizes and ingests all newly compiled reach CSV reports.
 */
async function syncReachReports() {
  const auth = getAuthenticatedClient();
  if (!auth) {
    return { success: false, error: "YouTube OAuth client is not authenticated." };
  }

  const jobInfo = await ensureReachJob();
  if (!jobInfo.success || !jobInfo.jobId) {
    return { success: false, error: jobInfo.error || "Could not resolve reach job." };
  }

  const jobId = jobInfo.jobId;
  const ytReporting = google.youtubereporting({ version: "v1", auth });

  try {
    const reportsRes = await ytReporting.jobs.reports.list({ jobId, pageSize: 50 });
    const reports = reportsRes.data?.reports || [];

    if (reports.length === 0) {
      return {
        success: true,
        message: "No compiled reports available yet. Google compiles reports once daily (first report requires 24-48h).",
        newReportsCount: 0,
        totalRowsIngested: 0,
        jobId,
      };
    }

    // Identify which reports have already been ingested
    const ingestedRows = db.prepare("SELECT report_id FROM reporting_ingested_reports WHERE job_id = ?").all(jobId);
    const ingestedSet = new Set(ingestedRows.map((r) => r.report_id));

    const pendingReports = reports.filter((r) => !ingestedSet.has(r.id));
    if (pendingReports.length === 0) {
      return {
        success: true,
        message: "All available reports are up to date.",
        newReportsCount: 0,
        totalRowsIngested: 0,
        jobId,
      };
    }

    const insertReachStmt = db.prepare(`
      INSERT INTO video_reach_daily (date, video_id, impressions, impressions_ctr)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(date, video_id) DO UPDATE SET
        impressions = excluded.impressions,
        impressions_ctr = excluded.impressions_ctr
    `);

    const recordReportStmt = db.prepare(`
      INSERT INTO reporting_ingested_reports (report_id, job_id, start_time, end_time, create_time, row_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(report_id) DO UPDATE SET
        row_count = excluded.row_count,
        ingested_at = CURRENT_TIMESTAMP
    `);

    let totalRowsIngested = 0;

    for (const report of pendingReports) {
      if (!report.downloadUrl) continue;

      try {
        const downloadRes = await auth.request({
          url: report.downloadUrl,
          responseType: "text",
        });

        const csvText = typeof downloadRes.data === "string" ? downloadRes.data : "";
        const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
        if (lines.length < 2) {
          recordReportStmt.run(report.id, jobId, report.startTime, report.endTime, report.createTime, 0);
          continue;
        }

        const headers = lines[0].split(",").map((h) => h.trim());
        const dateIdx = headers.indexOf("date");
        const videoIdIdx = headers.indexOf("video_id");
        const impressionsIdx = headers.indexOf("video_thumbnail_impressions");
        const ctrIdx = headers.indexOf("video_thumbnail_impressions_ctr");

        if (dateIdx === -1 || videoIdIdx === -1 || impressionsIdx === -1) {
          console.warn(`Report ${report.id} missing required headers (${headers.join(", ")}), skipping.`);
          continue;
        }

        let reportRowCount = 0;
        const ingestTransaction = db.transaction(() => {
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(",");
            const rawDate = cols[dateIdx];
            const videoId = cols[videoIdIdx];
            if (!rawDate || !videoId) continue;

            const date = normalizeDate(rawDate);
            const impressions = parseInt(cols[impressionsIdx], 10) || 0;
            const ctr = ctrIdx !== -1 ? parseFloat(cols[ctrIdx]) || 0.0 : 0.0;

            insertReachStmt.run(date, videoId, impressions, ctr);
            reportRowCount++;
          }
          recordReportStmt.run(report.id, jobId, report.startTime, report.endTime, report.createTime, reportRowCount);
        });

        ingestTransaction();
        totalRowsIngested += reportRowCount;
      } catch (dlErr) {
        console.error(`Failed to download/ingest reach report ${report.id}:`, dlErr.message);
      }
    }

    return {
      success: true,
      newReportsCount: pendingReports.length,
      totalRowsIngested,
      jobId,
      message: `Successfully ingested ${pendingReports.length} report(s) (${totalRowsIngested} daily video records).`,
    };
  } catch (err) {
    console.error("Error syncing YouTube reach reports:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Returns aggregated impressions and view-weighted CTR for a given date range.
 */
function getChannelReachSummary(startDateStr, endDateStr) {
  try {
    const row = db.prepare(`
      SELECT
        SUM(impressions) AS total_impressions,
        COUNT(DISTINCT video_id) AS videos_with_reach,
        COUNT(DISTINCT date) AS active_days,
        ROUND(SUM(impressions * impressions_ctr) / NULLIF(SUM(impressions), 0), 2) AS weighted_ctr
      FROM video_reach_daily
      WHERE date >= ? AND date <= ?
    `).get(startDateStr, endDateStr);

    if (!row || row.total_impressions == null) {
      return null;
    }

    return {
      totalImpressions: row.total_impressions || 0,
      weightedCtr: row.weighted_ctr != null ? row.weighted_ctr : null,
      videosWithReach: row.videos_with_reach || 0,
      activeDays: row.active_days || 0,
    };
  } catch (e) {
    console.warn("Could not query video_reach_daily summary:", e.message);
    return null;
  }
}

/**
 * Returns the status of the YouTube Reporting API reach integration.
 */
function getReachStatus() {
  const isConnected = isOAuthConnected();
  const jobId = getSetting("youtube_reach_job_id");

  let totalRecords = 0;
  let reportsIngested = 0;
  let minDate = null;
  let maxDate = null;

  try {
    const stats = db.prepare(`
      SELECT COUNT(*) AS total, MIN(date) AS min_d, MAX(date) AS max_d FROM video_reach_daily
    `).get();
    totalRecords = stats?.total || 0;
    minDate = stats?.min_d || null;
    maxDate = stats?.max_d || null;

    const repStats = db.prepare(`
      SELECT COUNT(*) AS total FROM reporting_ingested_reports WHERE job_id = ?
    `).get(jobId || "");
    reportsIngested = repStats?.total || 0;
  } catch (e) {
    /* ignore */
  }

  return {
    isConnected,
    jobId: jobId || null,
    jobActive: !!jobId,
    reportsIngested,
    totalRecords,
    minDate,
    maxDate,
  };
}

module.exports = {
  REPORT_TYPE_ID,
  ensureReachJob,
  syncReachReports,
  getChannelReachSummary,
  getReachStatus,
};
