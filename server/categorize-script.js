"use strict";

require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");
const db = require("./db").articleDb;
const { getGeminiApiKey } = require("./gemini");

async function runAutoCategorization() {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key is required.");
  }
  const ai = new GoogleGenAI({ apiKey });

  // 1. Get or Create candidate categories if missing
  const newCandidateCategories = [
    {
      name: "Solar & Home Energy",
      description: "Home solar installations, battery backup, bidirectional home charging, and energy efficiency",
      color: "#eab308"
    },
    {
      name: "Micromobility / E-Bikes",
      description: "Electric bikes, scooters, e-skateboards, and personal electric mobility devices",
      color: "#14b8a6"
    },
    {
      name: "EV Community & Meetups",
      description: "Cars & coffee, EV club gatherings, fan meetups, parades, and community events",
      color: "#ec4899"
    }
  ];

  for (const cat of newCandidateCategories) {
    try {
      db.prepare(`
        INSERT INTO content_categories (name, description, color)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET description = excluded.description
      `).run(cat.name, cat.description, cat.color);
      console.log(`Ensured category exists: ${cat.name}`);
    } catch (e) {
      console.warn(`Category ${cat.name} notice:`, e.message);
    }
  }

  // 2. Fetch all updated categories
  const allCategories = db.prepare("SELECT * FROM content_categories ORDER BY id ASC").all();
  const categoryNames = allCategories.map((c) => c.name);
  const categoriesListText = allCategories.map((c) => `- "${c.name}": ${c.description || ""}`).join("\n");

  console.log(`\nActive Categories in Database (${allCategories.length}):\n${categoriesListText}\n`);

  // 3. Fetch all videos older than 2025-11-30T08:00:00.000Z
  const anchorDate = "2025-11-30T08:00:00.000Z";
  const olderVideos = db.prepare(`
    SELECT youtube_id, title, description, content_type, category_source
    FROM videos
    WHERE published_at < ?
    ORDER BY published_at DESC
  `).all(anchorDate);

  console.log(`Found ${olderVideos.length} videos older than ${anchorDate}. Categorizing in batches...`);

  const chunkSize = 40;
  let totalUpdated = 0;
  const updateStmt = db.prepare("UPDATE videos SET content_type = ?, category_source = 'ai_inferred' WHERE youtube_id = ?");

  for (let i = 0; i < olderVideos.length; i += chunkSize) {
    const chunk = olderVideos.slice(i, i + chunkSize);
    const candidateModels = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"];

    const prompt = `You are the lead content cataloging specialist for 'The Electric Duo' YouTube channel.

YOUR TASK: Assign each video to the single most accurate category from the official category list below.

OFFICIAL CATEGORIES:
${categoriesListText}

VIDEOS TO CATEGORIZE:
${JSON.stringify(chunk.map((v) => ({ id: v.youtube_id, title: v.title, current: v.content_type })))}

RULES:
1. Choose strictly from the official category names: ${JSON.stringify(categoryNames)}.
2. Prioritize specific categories (e.g. "Mustang Mach-E Owner Content", "Ford Fathom / UEV Coverage", "Charging Equipment Reviews", "EV Charging Infrastructure", "Industry Events", "Emerging Tech", "Solar & Home Energy", "Micromobility / E-Bikes", "EV Community & Meetups", "Road Trip/Travel Series", "Walkarounds/Reviews", "How Tos/Guides", "News/Quick Charge", "Sponsor Content") over "Other".
3. Use "Other" ONLY for personal channel announcements or off-topic videos.
4. Output a strictly valid JSON array of objects with keys "id" and "category".

Example response format:
[
  { "id": "cxDx-0nbnag", "category": "How Tos/Guides" }
]`;

    let success = false;
    for (const model of candidateModels) {
      try {
        const res = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: { responseMimeType: "application/json" }
        });

        if (res && res.text) {
          const classifications = JSON.parse(res.text.trim());
          if (Array.isArray(classifications)) {
            const runTx = db.transaction((list) => {
              for (const item of list) {
                if (item.id && item.category && categoryNames.includes(item.category)) {
                  updateStmt.run(item.category, item.id);
                  totalUpdated++;
                }
              }
            });
            runTx(classifications);
            console.log(`Chunk ${Math.floor(i / chunkSize) + 1} (${chunk.length} videos) processed with ${model}.`);
            success = true;
            break;
          }
        }
      } catch (err) {
        console.warn(`Model ${model} failed on chunk ${Math.floor(i / chunkSize) + 1}:`, err.message);
      }
    }

    if (!success) {
      console.error(`Failed to categorize chunk ${Math.floor(i / chunkSize) + 1}.`);
    }

    // Rate-limit pause
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(`\nFinished categorization! Total videos updated: ${totalUpdated} / ${olderVideos.length}`);

  // Summary breakdown of older videos
  const finalBreakdown = db.prepare(`
    SELECT content_type, COUNT(*) as count
    FROM videos
    WHERE published_at < ?
    GROUP BY content_type
    ORDER BY count DESC
  `).all(anchorDate);

  console.log("\nNew Category Distribution for Videos Older than 11/30/2025:");
  console.table(finalBreakdown);
}

if (require.main === module) {
  runAutoCategorization()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal Error:", err);
      process.exit(1);
    });
}

module.exports = { runAutoCategorization };
