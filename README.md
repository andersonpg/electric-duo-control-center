# Electric Duo Control Center

A private, login-gated web app for The Electric Duo — starting with the
revenue-plan operating checklist, built to grow into video/sponsor tracking,
a media kit tool, and a stats dashboard.

## How it's built (and why)

- **Node.js + Express**, deployed as an xCloud Node.js site — no build step,
  no compiler needed on the server.
- **SQLite** (via `better-sqlite3`) as the database — a single file on disk.
  Plenty for 2–3 users; no separate database server to manage. If it ever
  needs to move to MySQL/Postgres, only `server/db.js` changes.
- **No public sign-up.** Accounts are created from the command line
  (`npm run create-user`) — there is no "create account" page for the
  internet to find.
- **Every checklist item's state is an append-only event log**
  (`task_events`: task, period, user, action, timestamp) — so "who checked
  this off" is a real record, not a guess. Nothing is ever overwritten.

## Local development

```
npm install
npm run create-user -- "Patrick" patrick "a-strong-password"
npm run create-user -- "Liv" liv "a-strong-password"
npm start
```

Visit `http://localhost:3000`, log in with one of the accounts above.

## Deploying on xCloud

1. In xCloud, create a new **Node.js** site and point it at this repo
   (or push these files directly — either Git-based deploy or a manual
   upload works).
2. Set the **start command** to `npm start` (equivalently `node server/app.js`).
3. Set the environment variable `DATA_DIR` to a path *outside* the deploy
   folder that survives redeploys (e.g. `/home/<site-user>/data`) — xCloud
   typically wipes the app folder on each deploy, and you don't want to lose
   the SQLite file. If left unset it defaults to `./data` next to the app,
   which is fine only if your deploy process doesn't touch that folder.
4. Put it behind xCloud's free SSL (it already handles this for Node sites)
   so the login cookie travels over HTTPS.
5. SSH into the site (or use xCloud's terminal) and run, once:
   ```
   npm install
   node scripts/create-user.js "Patrick" patrick "a-strong-password"
   node scripts/create-user.js "Liv" liv "a-strong-password"
   ```
6. Visit the domain, log in.

To add your future employee later, SSH in and run
`node scripts/create-user.js "Name" username "a-strong-password"` again —
no code changes needed. Same command resets a forgotten password.

## What's actually fixed vs. the original prototype

The file you'd started with (`electric-duo-ops-dashboard.html`) was built
against Claude's artifact storage API (`window.storage`), which only exists
inside claude.ai — it wouldn't have saved anything at all once moved to your
own server. This version:

- Has real accounts and a login page (only you and Liv can get in).
- Saves to an actual database file on your server, not browser/session storage.
- Records **who** checked each item and **when**, not just that it's checked.
- Keeps the same look, the same checklist content, and the same tab structure
  you already had.

## Extending it later

Everything content-related lives in one file: `server/content.js`. Adding,
removing, or rewording a checklist item is a one-line edit there — no
database migration needed, since the task list itself is code, and only
*completions* are stored in the database.

When you're ready for the next module (video tracker, sponsor tracker, etc.),
the pattern is the same: a new table in `server/db.js`, a couple of routes
in `server/app.js`, and a new tab in the front end. Happy to build the next
one whenever you want to prioritize it.
