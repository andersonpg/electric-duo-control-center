"use strict";

const { GoogleGenAI } = require("@google/genai");
const { YoutubeTranscript } = require("youtube-transcript");
const db = require("./db").articleDb;

// Helper to fetch real video transcript
async function getTranscript(youtubeId, title) {
  try {
    const transcriptItems = await YoutubeTranscript.fetchTranscript(youtubeId);
    if (!transcriptItems || transcriptItems.length === 0) {
      throw new Error("No transcript items returned.");
    }
    const fullText = transcriptItems.map((item) => item.text).join(" ");
    return fullText;
  } catch (error) {
    console.warn(`Could not fetch captions for ${youtubeId}:`, error.message);
    throw new Error(`Transcript unavailable for video ${youtubeId}. Ensure captions are enabled for this video.`);
  }
}

// Helper to call Gemini API with model fallback and retry
async function callGeminiWithRetry(ai, requestOptions, maxRetries = 3) {
  let attempt = 0;
  const candidateModels = [requestOptions.model, "gemini-flash-latest", "gemini-pro-latest", "gemini-2.0-flash"];

  for (const targetModel of candidateModels) {
    if (!targetModel) continue;
    attempt = 0;
    while (attempt < maxRetries) {
      try {
        const opts = { ...requestOptions, model: targetModel };
        return await ai.models.generateContent(opts);
      } catch (err) {
        const isRateLimit = err.status === 429 || (err.message && err.message.includes("RESOURCE_EXHAUSTED"));
        const isModelNotFound = err.status === 404 || (err.message && err.message.includes("NOT_FOUND"));

        if (isModelNotFound) {
          console.warn(`Model ${targetModel} not found/supported, trying next candidate...`);
          break;
        }

        if (isRateLimit && attempt < maxRetries - 1) {
          console.warn(`Gemini API rate limited (429) on ${targetModel}. Retrying in 4 seconds (Attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise((resolve) => setTimeout(resolve, 4000));
          attempt++;
        } else {
          console.warn(`Failed on ${targetModel}:`, err.message);
          break;
        }
      }
    }
  }

  throw new Error("Gemini API call failed across all candidate models.");
}

async function generateArticle({ youtubeId, title, contentType, customNotes, modelOverride, thinkingModeOverride }) {
  // Step 1: Fetch real video transcript
  const transcript = await getTranscript(youtubeId, title);

  // Step 2: Determine model selection
  let selectedModel = modelOverride;
  if (!selectedModel || selectedModel === "gemini-3.6-flash" || selectedModel === "gemini-3.1-pro") {
    selectedModel = "gemini-flash-latest";
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

  // Step 4: Construct full prompt with real video transcript
  const fullPrompt = `${promptTemplate}

USER CUSTOM NOTES / CONTEXT FOR THIS VIDEO:
${customNotes || "None provided."}

TARGET VIDEO DETAILS:
Title: ${title}
YouTube Video ID: ${youtubeId}

REAL VIDEO TRANSCRIPT:
${transcript}

CRITICAL MANDATES:
1. You MUST craft the article based specifically on the transcript provided above.
2. Honor the persona: Lead writer for TheElectricDuo.com, first-person ("we" / "I"), enthusiastic EV peer.
3. Output pure HTML suitable for WordPress Gutenberg editor (<h2>, <h3>, <p>, <ul>, <ol>, <strong>, <table>). Do NOT wrap in markdown backticks or \`\`\`html.
4. ABSOLUTELY BANNED AI CLICHÉS: "delve", "game-changer", "testament", "unlock", "dive into", "revolutionize", "in conclusion".
`;

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const requestOptions = {
    model: selectedModel,
    contents: fullPrompt,
  };

  // Step 5: Execute Gemini API call
  const response = await callGeminiWithRetry(ai, requestOptions);

  let htmlContent = response.text || "";
  htmlContent = htmlContent.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();

  if (!htmlContent) {
    throw new Error("Gemini API returned empty output.");
  }

  return htmlContent;
}

module.exports = { getTranscript, generateArticle };
