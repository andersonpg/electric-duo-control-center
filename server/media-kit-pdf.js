"use strict";

const crypto = require("crypto");
const puppeteer = require("puppeteer");
const db = require("./db");
const mediaKit = require("./media-kit");

// In-process serialized rendering queue
class RenderQueue {
  constructor() {
    this.queue = [];
    this.running = false;
  }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.processNext();
    });
  }

  async processNext() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const { fn, resolve, reject } = this.queue.shift();
    try {
      const res = await fn();
      resolve(res);
    } catch (err) {
      reject(err);
    } finally {
      this.running = false;
      this.processNext();
    }
  }
}

const renderQueue = new RenderQueue();

function createEphemeralSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expires);
  return token;
}

function destroyEphemeralSession(token) {
  if (!token) return;
  try {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  } catch (err) {
    console.error("Failed to delete ephemeral session:", err);
  }
}

function slugify(text) {
  return String(text || "")
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Render Media Kit PDF via Puppeteer
 * @param {Object} options
 * @param {number} options.userId User ID requesting the render
 * @param {number|string} [options.presetId] Saved preset ID
 * @param {string} [options.recipient] Recipient string
 * @param {Array<string>} [options.blocks] Array of block IDs
 * @param {Array<string>} [options.order] Array of section IDs
 * @returns {Promise<{ pdf: Buffer, filename: string }>}
 */
async function generateMediaKitPdf({ userId, presetId, recipient, blocks, order }) {
  return renderQueue.enqueue(async () => {
    let token = null;
    let browser = null;

    try {
      // 1. Mint ephemeral session token valid for 2 minutes
      token = createEphemeralSession(userId);

      // 2. Fetch preset details if presetId is provided
      let presetName = "Custom";
      let presetRecipient = recipient;
      if (presetId && presetId !== "custom") {
        const p = mediaKit.getPresetById(presetId);
        if (p) {
          presetName = p.name;
          if (!presetRecipient && p.recipient) {
            presetRecipient = p.recipient;
          }
        }
      }

      // Fetch manual data for contact details
      const manual = mediaKit.getManualData();
      const contactEmail = manual?.contact_details?.email || "partnerships@theelectricduo.com";

      // 3. Build target URL
      const port = process.env.PORT || 3000;
      const params = new URLSearchParams();
      params.set("theme", "light");
      if (presetId && presetId !== "custom") params.set("preset", String(presetId));
      if (presetRecipient) params.set("recipient", presetRecipient);
      if (blocks && Array.isArray(blocks) && blocks.length > 0) {
        params.set("blocks", blocks.join(","));
      }
      if (order && Array.isArray(order) && order.length > 0) {
        params.set("order", order.join(","));
      }

      const targetUrl = `http://127.0.0.1:${port}/media-kit/print?${params.toString()}`;

      // 4. Launch headless Chromium with standard sandboxing flags
      browser = await puppeteer.launch({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--font-render-hinting=none",
        ],
        timeout: 30000,
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 800, height: 1000, deviceScaleFactor: 2 });

      // 5. Authenticate via ephemeral session cookie
      await page.setCookie({
        name: "sid",
        value: token,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
      });

      // 6. Emulate screen media so light theme from ?theme=light is applied verbatim
      await page.emulateMediaType("screen");

      // 7. Navigate and wait for network idle
      await page.goto(targetUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // 8. Explicitly wait for fonts ready and all images decoded
      await page.evaluate(async () => {
        if (document.fonts) {
          await document.fonts.ready;
        }
        await Promise.all(
          Array.from(document.images)
            .filter((i) => !i.complete)
            .map((i) => i.decode().catch(() => null))
        );
      });

      // 9. Generate PDF with standard Letter margins and Page N of M footer
      const footerHtml = `
        <div style="font-size: 8pt; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #4A5A68; width: 100%; padding: 0 0.5in; display: flex; justify-content: space-between; align-items: center; box-sizing: border-box;">
          <span>The Electric Duo &middot; ${contactEmail}</span>
          <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `;

      const pdf = await page.pdf({
        format: "letter",
        printBackground: true,
        margin: {
          top: "0.55in",
          bottom: "0.6in",
          left: "0.5in",
          right: "0.5in",
        },
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: footerHtml,
        timeout: 30000,
      });

      // 10. Generate clean filename
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const namePart = presetRecipient ? `${slugify(presetRecipient)}-${slugify(presetName)}` : slugify(presetName);
      const filename = `ElectricDuo-MediaKit-${namePart}-${yearMonth}.pdf`;

      return { pdf, filename };
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
      if (token) {
        destroyEphemeralSession(token);
      }
    }
  });
}

module.exports = {
  generateMediaKitPdf,
  createEphemeralSession,
  destroyEphemeralSession,
};
