"use strict";

const { GoogleGenAI } = require("@google/genai");
const { YoutubeTranscript } = require("youtube-transcript");
const db = require("./db").articleDb;

// Helper to fetch & cache video transcript in SQLite with resilient fallback
async function getTranscript(youtubeId, title = "") {
  // 1. Check SQLite cache first
  try {
    const cached = db.prepare("SELECT transcript FROM videos WHERE youtube_id = ?").get(youtubeId);
    if (cached && cached.transcript && cached.transcript.trim().length > 20) {
      return cached.transcript;
    }
  } catch (e) {}

  // 2. Fetch from YouTube Captions API
  try {
    const transcriptItems = await YoutubeTranscript.fetchTranscript(youtubeId);
    if (transcriptItems && transcriptItems.length > 0) {
      const fullText = transcriptItems.map((item) => item.text).join(" ").trim();

      // Cache into SQLite videos table
      if (fullText.length > 20) {
        try {
          db.prepare("UPDATE videos SET transcript = ? WHERE youtube_id = ?").run(fullText, youtubeId);
        } catch (e) {}
      }

      return fullText;
    }
  } catch (error) {
    console.warn(`Closed captions unavailable on YouTube for ${youtubeId} (${title}):`, error.message);
  }

  // 3. Fallback: Retrieve video metadata and custom notes from SQLite
  let fallbackContext = "";
  try {
    const v = db.prepare("SELECT description, custom_notes FROM videos WHERE youtube_id = ?").get(youtubeId);
    if (v) {
      if (v.description && v.description.length > 10) {
        fallbackContext += `Video Description & Outline:\n${v.description}\n\n`;
      }
      if (v.custom_notes && v.custom_notes.length > 5) {
        fallbackContext += `Creator Notes & Context:\n${v.custom_notes}\n\n`;
      }
    }
  } catch (e) {}

  if (!fallbackContext) {
    fallbackContext = `Video Title: "${title || youtubeId}"\nYouTube ID: ${youtubeId}`;
  }

  return `[Note: Auto-generated YouTube closed captions were not published for this video by YouTube. Synthesize a comprehensive article based on the video title, topic, outline, and custom context below]\n\n${fallbackContext}`;
}

// Helper to get active Gemini API key from SQLite settings or .env
function getGeminiApiKey() {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'gemini_api_key'").get();
    if (row && row.value && row.value.trim().length > 10) {
      return row.value.trim();
    }
  } catch (e) {}
  return process.env.GEMINI_API_KEY;
}

// Helper to call Gemini API with candidate models and clean error reporting
async function callGeminiWithRetry(ai, requestOptions, maxRetries = 2) {
  let attempt = 0;
  const primaryModel = requestOptions.model || "gemini-3.7-flash";
  const candidateModels = [
    primaryModel,
    "gemini-3.6-flash",
    "gemini-3.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-flash-latest",
    "gemini-pro-latest",
  ];

  const attemptedModels = [];
  let lastError = null;

  for (const targetModel of candidateModels) {
    if (!targetModel || attemptedModels.includes(targetModel)) continue;
    attemptedModels.push(targetModel);
    attempt = 0;

    while (attempt < maxRetries) {
      try {
        const opts = { ...requestOptions, model: targetModel };
        return await ai.models.generateContent(opts);
      } catch (err) {
        lastError = err;
        const isRateLimit = err.status === 429 || (err.message && err.message.includes("RESOURCE_EXHAUSTED"));
        const isModelNotFound = err.status === 404 || (err.message && err.message.includes("NOT_FOUND"));

        if (isModelNotFound) {
          console.warn(`Model ${targetModel} not available on this API key, trying next model candidate...`);
          break;
        }

        if (isRateLimit && attempt < maxRetries - 1) {
          console.warn(`Gemini API rate limited (429) on ${targetModel}. Retrying in 3 seconds...`);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          attempt++;
        } else {
          console.warn(`Gemini API error on ${targetModel}:`, err.message);
          break;
        }
      }
    }
  }

  const errorDetail = lastError ? ` (Last error: ${lastError.message})` : "";
  throw new Error(`Gemini API call failed across attempted models [${attemptedModels.join(", ")}]${errorDetail}`);
}

async function generateArticle({ youtubeId, title, contentType, customNotes, modelOverride, thinkingModeOverride }) {
  // Step 1: Fetch and cache real video transcript
  const transcript = await getTranscript(youtubeId, title);

  // Step 2: Determine model selection
  let selectedModel = modelOverride;
  if (!selectedModel) {
    const modelRow = db.prepare("SELECT value FROM app_settings WHERE key = 'default_model'").get();
    selectedModel = modelRow ? modelRow.value : "gemini-3.7-flash";
  }

  let thinkingMode = thinkingModeOverride;
  if (!thinkingMode) {
    const thinkingRow = db.prepare("SELECT value FROM app_settings WHERE key = 'thinking_mode'").get();
    thinkingMode = thinkingRow ? thinkingRow.value : "standard";
  }

  // Step 3: Fetch template prompt instructions from SQLite
  let templateRow = db.prepare("SELECT prompt_template FROM content_templates WHERE name = ?").get(contentType);
  if (!templateRow) {
    templateRow = db.prepare("SELECT prompt_template FROM content_templates WHERE name = ?").get("Review");
  }

  const promptTemplate = templateRow ? templateRow.prompt_template : "Write an EV article based on transcript.";

  let photosInstruction = "";
  if (photos && Array.isArray(photos) && photos.length > 0) {
    photosInstruction = `\nUPLOADED PHOTOS TO INCLUDE IN THE ARTICLE:
${photos.map((p, idx) => `Photo ${idx + 1}: ${p.url ? `URL: ${p.url}` : ""}${p.name ? ` Filename: ${p.name}` : ""}`).join("\n")}
Please embed these photos contextually within the article body using native WordPress figure blocks:
<figure class="wp-block-image"><img src="[URL]" alt="[Descriptive Alt Text]" /><figcaption>[Helpful Caption]</figcaption></figure>
`;
  }

  // Step 4: Construct full prompt with real video transcript
  const fullPrompt = `${promptTemplate}

USER CUSTOM NOTES / ADDITIONAL INSTRUCTIONS FOR THIS ARTICLE:
${customNotes || "None provided."}
${photosInstruction}
TARGET VIDEO DETAILS:
Title: ${title}
YouTube Video ID: ${youtubeId}

REAL VIDEO TRANSCRIPT:
${transcript}

CRITICAL MANDATES:
1. You MUST craft the article based specifically on the transcript and any custom user instructions provided above.
2. Honor the persona: Lead writer for TheElectricDuo.com, first-person ("we" / "I"), enthusiastic EV peer.
3. Output pure HTML suitable for WordPress Gutenberg editor (<h2>, <h3>, <p>, <ul>, <ol>, <strong>, <table>, <figure>). Do NOT wrap in markdown backticks or \`\`\`html.
4. ABSOLUTELY BANNED AI CLICHÉS: "delve", "game-changer", "testament", "unlock", "dive into", "revolutionize", "in conclusion".
`;

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API Key is not configured. Please set GEMINI_API_KEY in Admin Settings.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const requestOptions = {
    model: selectedModel,
    contents: fullPrompt,
  };

  // Step 5: Execute Gemini API call
  const response = await callGeminiWithRetry(ai, requestOptions);

  let htmlContent = response.text || "";
  htmlContent = htmlContent.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

  if (!htmlContent) {
    throw new Error("Gemini API returned an empty output response.");
  }

  return htmlContent;
}

module.exports = { getTranscript, generateArticle, getGeminiApiKey };
