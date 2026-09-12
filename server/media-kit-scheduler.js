"use strict";

const cron = require("node-cron");
const { runJobA, generateMediaKitSnapshot } = require("./media-kit");

let isJobARunning = false;
let isJobBRunning = false;

function initMediaKitScheduler() {
  const cronOptions = {
    timezone: "America/Los_Angeles",
  };

  // Job A: Nightly 28-day & 365-day capture at 3:00 AM America/Los_Angeles
  cron.schedule(
    "0 3 * * *",
    async () => {
      if (isJobARunning) {
        console.warn("[Media-Kit Scheduler] Job A is already running. Skipping trigger.");
        return;
      }
      isJobARunning = true;
      const startTime = Date.now();
      console.log("[Media-Kit Scheduler] Starting scheduled Job A (Nightly Views Capture)...");

      try {
        const result = await runJobA();
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Media-Kit Scheduler] Job A completed in ${durationSec}s.`, result);
      } catch (err) {
        console.error("[Media-Kit Scheduler] Scheduled Job A encountered an error:", err);
      } finally {
        isJobARunning = false;
      }
    },
    cronOptions
  );

  // Job B: Weekly snapshot rebuild, Monday 4:00 AM America/Los_Angeles (after Job A)
  cron.schedule(
    "0 4 * * 1",
    async () => {
      if (isJobBRunning) {
        console.warn("[Media-Kit Scheduler] Job B is already running. Skipping trigger.");
        return;
      }
      isJobBRunning = true;
      const startTime = Date.now();
      console.log("[Media-Kit Scheduler] Starting scheduled Job B (Weekly Snapshot Rebuild)...");

      try {
        const result = await generateMediaKitSnapshot((stage, msg) => {
          console.log(`[Media-Kit Scheduler Job B] ${stage}: ${msg}`);
        });
        const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Media-Kit Scheduler] Job B completed successfully in ${durationSec}s. Snapshot ID: #${result.snapshotId}`);
      } catch (err) {
        console.error("[Media-Kit Scheduler] Scheduled Job B encountered an error:", err);
      } finally {
        isJobBRunning = false;
      }
    },
    cronOptions
  );

  console.log("[Media-Kit Scheduler] Background cron tasks registered (Job A: 3am daily, Job B: 4am Mondays, America/Los_Angeles).");
}

module.exports = {
  initMediaKitScheduler,
};
