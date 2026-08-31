# The Electric Duo Command Center · Tech Stack Summary

**Application URL**: [https://cc.theelectricduo.com](https://cc.theelectricduo.com)  
**Repository**: `andersonpg/electric-duo-control-center`  
**Target Channel**: [@TheElectricDuo](https://youtube.com/@TheElectricDuo) (`UCuhhyTS-Q66qq-gWrCcTOzg`)

---

## 1. Frontend Architecture

* **Core Framework**: **React 19** (`react`, `react-dom`) — Single Page Application (SPA) with functional components, custom hooks, and modular tabs.
* **Build Tool & Bundler**: **Vite 8** — High-performance bundling, Hot Module Replacement (HMR), asset fingerprinting, and optimized production chunking.
* **Styling & Design System**:
  * **Tailwind CSS v4** (`@tailwindcss/vite`, `tailwindcss`, `postcss`, `autoprefixer`)
  * Modern dark-mode palette (`slate-950` base, cyan/blue accent glow, and custom glassmorphism containers).
  * Custom line-by-line Markdown parsing and formatting for executive debriefs, tables, and callouts without third-party CDN bloat.
* **Iconography**: **Lucide React** (`lucide-react`) — Clean, lightweight SVG icon system.

---

## 2. Backend Architecture

* **Runtime**: **Node.js v22 LTS**
* **Web & API Framework**: **Express 4** (`express`, `cors`, `cookie-parser`, `dotenv`) REST API.
* **Database & Persistence**:
  * **better-sqlite3** (`better-sqlite3`) — Embedded, synchronous, high-throughput SQLite engine.
  * **Dual Database Architecture**:
    * `database.sqlite` — User accounts, password hashes, KPI metrics, period run-rates, and session tracking.
    * `control-center.sqlite` (via `DATA_DIR=/home/cc/data`) — 500+ video back-catalog, YouTube Studio snapshots, content categories, content templates, video audit diagnostics, and competitor comparison reports.
* **Authentication & Security**:
  * Cookie-based HTTP-only session tokens (`sid` cookie).
  * **bcryptjs** for salted password hashing and secure account management.

---

## 3. AI & Intelligence Layer

* **SDK & Client**: **Google Gen AI SDK** (`@google/genai`)
* **Active LLM Fallback Chain**:
  * `gemini-3.7-flash` *(Primary multimodal & fast generation model)*
  * Failover ladder: `gemini-3.6-flash` $\rightarrow$ `gemini-3.5-flash` $\rightarrow$ `gemini-3.5-flash-lite` $\rightarrow$ `gemini-3.1-flash-lite` $\rightarrow$ `gemini-flash-latest` $\rightarrow$ Local Heuristic Engine.
* **AI Modules & Capabilities**:
  1. **Article Generator**: Converts YouTube captions, video descriptions, and custom notes into fully formatted, SEO-optimized WordPress articles with embedded media.
  2. **Video Diagnostic Audits**: Generates 30-second hook drop-off analysis, 2x2 discovery matrix (packaging vs. algorithm bottlenecks), thumbnail visual contrast reviews, and 3–5 alternative title concepts.
  3. **Competitor Comparison**: Ingests competitor uploads, computes rolling 10-video baseline medians, flags $\ge 3\times$ statistical outliers vs. $< 0.6\times$ underperformers, and writes conversational YouTube Growth Consultant debriefs.
  4. **Catalog Auto-Classification**: Dynamic category classification and on-the-fly prompt template creation.

---

## 4. Integrations & External APIs

* **YouTube Data API v3 & YouTube Analytics API** (`googleapis`):
  * Google OAuth 2.0 integration for live YouTube Studio analytics (real view counts, watch time, subscribers gained/lost, traffic source breakdown).
  * Zero-quota fallback web scraper to maintain uptime during API quota exhaustions.
* **Captions Extraction**: `youtube-transcript` with automatic SQLite caption caching and metadata fallback.
* **WordPress REST API** (`axios`):
  * Application password authentication directly creating and formatting draft posts on `https://theelectricduo.com`.

---

## 5. Infrastructure & Deployment

* **Host & Server**: Ubuntu Linux VPS (Vultr / IP: `45.76.227.193`)
* **Process Manager**: **PM2** (`nodejs-cc.theelectricduo.com`) for process daemonization, zero-downtime restarts, and environment configuration management.
* **Web Server & SSL**: Reverse-proxied via **Nginx** with Let's Encrypt TLS/SSL certificates at `https://cc.theelectricduo.com`.
* **Version Control & CI/CD**: Git with GitHub repository (`andersonpg/electric-duo-control-center`) and automated production build scripts.
