"use strict";

const axios = require("axios");
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "database.sqlite")
  : path.join(__dirname, "..", "..", "..", "data", "database.sqlite");

const db = new Database(dbPath);

function parseViews(str) {
  if (!str) return 0;
  const clean = str.replace(/ views?/i, "").trim();
  if (clean.endsWith("K") || clean.endsWith("k")) {
    return Math.round(parseFloat(clean) * 1000);
  }
  if (clean.endsWith("M") || clean.endsWith("m")) {
    return Math.round(parseFloat(clean) * 1000000);
  }
  return parseInt(clean.replace(/,/g, ""), 10) || 0;
}

async function syncAllRealViews() {
  console.log("Fetching channel video catalog from @TheElectricDuo...");
  const res = await axios.get("https://www.youtube.com/@TheElectricDuo/videos", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const html = res.data;
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const apiKey = apiKeyMatch ? apiKeyMatch[1] : null;

  const jsonMatch = html.match(/var ytInitialData = ({.*?});<\/script>/);
  if (!jsonMatch) throw new Error("Could not parse initial data.");

  const data = JSON.parse(jsonMatch[1]);
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const videosTab = tabs.find((t) => t.tabRenderer?.title === "Videos" || t.tabRenderer?.selected);
  const contents = videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];

  const updateStmt = db.prepare("UPDATE videos SET view_count = ? WHERE youtube_id = ?");
  let updatedCount = 0;

  function processItems(items) {
    let nextTok = null;
    items.forEach((item) => {
      const lockup = item.richItemRenderer?.content?.lockupViewModel;
      if (lockup) {
        const vId = lockup.contentId;
        const meta = lockup.metadata?.lockupMetadataViewModel;
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        let viewStr = "";
        rows.forEach((r) => {
          (r.metadataParts || []).forEach((p) => {
            if (p.text?.content && p.text.content.includes("view")) {
              viewStr = p.text.content;
            }
          });
        });
        const views = parseViews(viewStr);
        if (vId && views > 0) {
          updateStmt.run(views, vId);
          updatedCount++;
        }
      }
      if (item.continuationItemRenderer) {
        nextTok = item.continuationItemRenderer.continuationEndpoint?.continuationCommand?.token;
      }
    });
    return nextTok;
  }

  let token = processItems(contents);
  let page = 0;

  while (token && page < 30) {
    page++;
    try {
      const contRes = await axios.post(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240101.00.00",
          },
        },
        continuation: token,
      });

      const actions = contRes.data.onResponseReceivedActions || [];
      let newItems = [];
      actions.forEach((act) => {
        const gridCont = act.appendContinuationItemsAction?.continuationItems;
        if (gridCont) newItems = newItems.concat(gridCont);
      });

      token = processItems(newItems);
    } catch (e) {
      console.warn("Continuation error:", e.message);
      break;
    }
  }

  console.log(`Successfully updated exact real view counts for ${updatedCount} videos in database.`);
  return updatedCount;
}

if (require.main === module) {
  syncAllRealViews()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}

module.exports = { syncAllRealViews };
