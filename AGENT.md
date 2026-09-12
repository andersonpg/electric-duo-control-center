# AGENT.md — Developer & Autonomous Agent Runbook

This runbook defines the required architecture, release procedures, and exact deployment steps for **The Electric Duo Command Center** (`cc.theelectricduo.com`). Follow these step-by-step procedures to make changes, build, commit, and deploy without guessing or encountering deployment failures.

---

## 1. System Overview & Architecture

- **Stack**: Node.js (v20+) + Express (`server/app.js`), React 19 + Tailwind CSS + Vite (`frontend/`).
- **Production Host**: xCloud Node.js Application Site (`cc.theelectricduo.com`, SSR / PM2 process).
  - **Site UUID**: `da07e2db-75fa-4207-a1f8-0d6bef4112c5`
  - **Server UUID**: `468d2818-7af5-4c37-8fef-9c6092996605`
  - **App Directory**: `/var/www/cc.theelectricduo.com`
  - **PM2 Process**: `nodejs-cc.theelectricduo.com`
- **Data Storage**: Local SQLite database files in `/var/www/cc.theelectricduo.com/data/`:
  - `data/control-center.sqlite`: Users, sessions, plan checklist tasks, KPI values, app settings.
  - `data/database.sqlite`: YouTube catalog, video audits, category benchmarks, reach metrics (`video_reach_daily`).
- **Public Assets**: The `public/assets/` directory is checked into Git so the production server serves pre-built production assets directly without running frontend build tools on the server.

---

## 2. Release & Versioning Requirements

Every code change must adhere to the versioning contract:

1. **Synchronize Version Numbers**:
   - Update `package.json` (`"version": "X.Y.Z"`).
   - Update `frontend/package.json` (`"version": "X.Y.Z"`).
   *Note: `frontend/src/App.jsx` imports `../package.json` to dynamically render the version tag (`vX.Y.Z`) in the top navigation bar. If frontend package.json is not updated, the header will display an outdated version.*

2. **Update CHANGELOG.md**:
   - Add a top-level release section following Keep a Changelog formatting:
     ```markdown
     ## [X.Y.Z] - YYYY-MM-DD

     ### Added / Fixed / Changed
     - Description of changes
     ```

3. **Compile Frontend Production Bundle**:
   - Always run the build script from the root directory:
     ```bash
     npm run build
     ```
   - This executes `scripts/build.js`, which:
     - Runs `npm --prefix frontend run build` using Vite.
     - Syncs compiled assets from `frontend/dist/*` into `public/`.
     - Regenerates `public/index.html` and `public/assets/index-[hash].js`.

---

## 3. Git & GitHub Repository Requirements (CRITICAL)

The xCloud site deployment uses a `manual_public` Git integration targeting `https://github.com/andersonpg/electric-duo-control-center.git`.

> [!IMPORTANT]
> **Repository Visibility Requirement**:
> The GitHub repository `andersonpg/electric-duo-control-center` **MUST be public** during deployment.
> If the repository is set to private, the server runner will fail with:
> `fatal: could not read Username for 'https://github.com': terminal prompts disabled`
> `ERROR: git pull failed for cc.theelectricduo.com (exit 128)`.

### Pre-Deployment Git Verification:
1. Check repository visibility:
   ```bash
   gh repo view andersonpg/electric-duo-control-center --json visibility
   ```
2. If private, set to public:
   ```bash
   gh repo edit andersonpg/electric-duo-control-center --visibility public --accept-visibility-change-consequences
   ```
3. Stage, commit, and push all modified files (including `public/assets/`):
   ```bash
   git add -A
   git commit -m "<type>(<scope>): <concise description> (vX.Y.Z)"
   git push origin main
   ```

---

## 4. Exact Step-by-Step Deployment via xCloud

Deployments are executed using the xCloud MCP tools.

### Step 1: Trigger Git Deployment
Call MCP tool `sites_git_deploy`:
- **Server**: `xcloud`
- **Tool**: `sites_git_deploy`
- **Arguments**:
  ```json
  {
    "uuid": "da07e2db-75fa-4207-a1f8-0d6bef4112c5",
    "confirm": true
  }
  ```
Expected response: HTTP 202 `{"success": true, "message": "Site deployment queued"}`.

### Step 2: Poll Deployment Progress
Call MCP tool `sites_events`:
- **Server**: `xcloud`
- **Tool**: `sites_events`
- **Arguments**:
  ```json
  {
    "uuid": "da07e2db-75fa-4207-a1f8-0d6bef4112c5",
    "page": 1,
    "per_page": 5
  }
  ```
Locate the topmost deployment event (type `deployment`). Extract its `uuid` (e.g. `task_uuid`).

### Step 3: Inspect Deployment Event Logs
Call MCP tool `sites_events_show`:
- **Server**: `xcloud`
- **Tool**: `sites_events_show`
- **Arguments**:
  ```json
  {
    "uuid": "da07e2db-75fa-4207-a1f8-0d6bef4112c5",
    "task_uuid": "<task_uuid_from_step_2>"
  }
  ```
Verify:
- `status`: `"finished"`
- `exit_code`: `0`
- Log output contains: `XCLOUD_DEPLOYED_COMMIT`, `PM2 app started`, and `Deployment complete.`

### Step 4: Verify Live Server Status
Verify that the server is serving traffic cleanly:
```bash
curl -I https://cc.theelectricduo.com
```
Confirm HTTP 200/302 response with active Cloudflare / Nginx headers.

### Step 5: Purge Edge Cache
Call MCP tool `sites_cache_purge`:
- **Server**: `xcloud`
- **Tool**: `sites_cache_purge`
- **Arguments**:
  ```json
  {
    "uuid": "da07e2db-75fa-4207-a1f8-0d6bef4112c5"
  }
  ```
Ensures edge caches immediately serve the newly compiled bundle and HTML templates.

---

## 5. Quick Reference Checklist

When a task requires a production deployment:

- [ ] 1. Implement code changes and verify with local checks / tests.
- [ ] 2. Bump version in `package.json` and `frontend/package.json`.
- [ ] 3. Add release entry to `CHANGELOG.md`.
- [ ] 4. Run `npm run build` to build frontend into `public/`.
- [ ] 5. Verify GitHub repository is public (`gh repo view ...`).
- [ ] 6. Commit and push to `origin main`.
- [ ] 7. Deploy via xCloud MCP tool `sites_git_deploy`.
- [ ] 8. Poll `sites_events` / `sites_events_show` until `status == "finished"` and `exit_code == 0`.
- [ ] 9. Purge cache via `sites_cache_purge`.
- [ ] 10. Verify live site with `curl -I https://cc.theelectricduo.com`.
