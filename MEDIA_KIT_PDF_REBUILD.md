# Rebuild the Media Kit PDF export

Command Center — `/Users/patrick/Development/CommandCenter`. Target version **2.6.0**
(architecture change, not a patch).

The Media Kit has section toggles for building sponsor-specific PDFs, but the
printed output degrades badly — especially when sections are deselected. The
intended workflow is **tiered disclosure**: send a basics-only kit on first
contact, then progressively fuller kits as a negotiation advances. The current
code cannot express that, and the print pipeline has independent defects that
make any selection look broken.

Two decisions are already made and are **not** open for reinterpretation:

1. **The PDF uses a light palette** (dark text on white), not the dark screen theme.
2. **PDFs are rendered server-side with Puppeteer**, not `window.print()`.

---

## 1. What is wrong today

### (a) The print layout falls off the responsive breakpoints — root cause of most of it

Chrome lays print out at the paper content width in CSS pixels: Letter at 0.5in
margins is **720px**. Tailwind's `md:` is 768px and `lg:` is 1024px, so those
variants **never match on paper**. Every multi-column grid collapses:

| Line | Class | Screen | Paper |
|---|---|---|---|
| `MediaKit.jsx:796` | `grid-cols-2 lg:grid-cols-4` | 4 across | 2×2 |
| `MediaKit.jsx:1124` | `grid-cols-1 md:grid-cols-3` | 3 across | 3 full-width stacks |
| `MediaKit.jsx:879` | `grid-cols-1 md:grid-cols-2` | 2 across | 1 column |
| `MediaKit.jsx:1387` | `grid-cols-1 md:grid-cols-2` | 2 across | 1 column |
| `MediaKit.jsx:1554` | `grid-cols-1 md:grid-cols-2` | 2 across | 1 column |
| `MediaKit.jsx:1663` | `grid-cols-1 md:grid-cols-2` | 2 across | 1 column |
| `MediaKit.jsx:1825` | `grid-cols-1 md:grid-cols-2` | 2 across | 1 column |

This was already hit once and patched by hand for a single grid —
`.recent-work-grid { grid-template-columns: repeat(3, 1fr) !important }` at
`MediaKitPrint.jsx:38`. That one-off is the symptom, not the fix.

Consequence: the document is 2–3× taller than it should be, in mobile-shaped
stacks.

### (b) `break-inside: avoid` is on nearly every card, leaving no legal break points

~15 cards carry `breakInside: "avoid"`, plus `.section-header { break-after: avoid }`
(`MediaKitPrint.jsx:33`). A tall card that does not fit the remaining space jumps
to the next page and leaves a dead band behind. Combined with (a), those bands are
large. **This is why deselecting sections makes the output worse rather than
shorter** — it re-rolls where every fits/doesn't-fit boundary lands.

### (c) There is no page composition model

No `break-before: page`, no cover page, no running header or footer, no page
numbers. It is a web scroll handed to a paginator.

### (d) Deselecting "partners" silently removes all contact information

`MediaKit.jsx:1891–1994` gates partner chips, the case study, **and** the
"Ready to collaborate?" CTA carrying the email (`:1963–1993`) behind one toggle.
`contact_details` is referenced nowhere else in the render. A basics-only kit
currently has no way for the sponsor to reach Patrick.

### (e) Background printing depends on a checkbox we do not control

`print-color-adjust: exact` (`MediaKitPrint.jsx:22–23`) does **not** override
Chrome's "Background graphics" setting. Unchecked → dark panels vanish and
`#E6EDF3` text lands on white paper. This is one of two reasons for the light-palette
decision; Puppeteer's `printBackground: true` is the other half of the fix.

### (f) `window.print()` fires blind at 1000ms

`MediaKitPrint.jsx:7–10`. Nothing awaits the `/api/media-kit` fetch,
`document.fonts.ready`, or image decode. Slow response or cold thumbnail cache →
print dialog over a spinner, or missing thumbnails.

### (g) Every saved PDF is named `The Electric Duo · Command Center.pdf`

Chrome uses `document.title`; the print route never sets it.

### (h) Dead and inconsistent state plumbing

- `.print-excluded { display: none }` (`MediaKitPrint.jsx:31`) can never fire —
  excluded sections are not rendered at all in print mode
  (`{(!isPrintMode || printSections.x) && ...}`).
- The `?sections=` parser (`MediaKit.jsx:52–60`) is never generated;
  `handleOpenPrint` (`:202–207`) only emits `?exclude=`.
- `exclude` semantics mean saved links are not stable snapshots: any section added
  later is silently included in every previously-saved link.

### (i) The selection model does not match the use case

- State is a single `localStorage` key, `media_kit_print_sections` (`:183`). One
  global config. "Ford — intro" and "Ford — round 2" cannot coexist; configuring
  one destroys the other.
- Ten fixed booleans (`:28–38`). No sub-section granularity, no ordering, no names,
  no record of what was actually sent.

---

## 2. Constraints

- Do **not** change any metric, calculation, or `server/media-kit.js` snapshot logic.
  This work is presentation and composition only.
- `MediaKit.jsx` is 3,230 lines and renders both screen and print. Do not fork it
  into a second component — that guarantees drift. Refactor in place.
- The screen (dark) view must be visually unchanged when this lands.
- Existing `media_kit_manual` data must survive. Add tables; do not alter existing ones.
- No breaking change to `/api/media-kit`, `/api/media-kit/manual`, or the snapshot
  endpoints.

---

## 3. Phase 1 — Print theme and layout correctness

### 3.1 Move the palette out of inline styles

**This must be done first, or every later theming rule silently fails.** The
palette is currently set as inline CSS custom properties in two places —
`MediaKit.jsx:401–406` (loading state) and `MediaKit.jsx:513–518` (main render).
Inline custom properties beat any stylesheet rule for that element and inherit
down, so a `@media print :root {}` override would do nothing.

Replace both with a class, e.g. `mk-theme`, and define the palettes in CSS:

```css
.mk-theme {
  --mk-bg: #0B1520;  --mk-card: #121E2A; --mk-border: #1E3140;
  --mk-text: #E6EDF3; --mk-muted: #8FA3B3; --mk-accent: #00B1E2;
  --mk-accent-soft: rgba(0, 177, 226, 0.12);
  --mk-accent-line: rgba(0, 177, 226, 0.30);
  --mk-warn: #F59E0B;
}
.mk-theme[data-theme="light"] {
  --mk-bg: #FFFFFF;  --mk-card: #FFFFFF; --mk-border: #D4DDE4;
  --mk-text: #0B1520; --mk-muted: #4A5A68; --mk-accent: #0077A3;
  --mk-accent-soft: rgba(0, 119, 163, 0.08);
  --mk-accent-line: rgba(0, 119, 163, 0.35);
  --mk-warn: #A15C00;
}
```

The accent **must** darken for print. `#00B1E2` on white is 2.50:1 and fails
WCAG AA; `#0077A3` is 5.04:1 and passes. Same reasoning for `--mk-warn`.

Because the whole component already reads `var(--mk-*)`, this one change flips
the entire document. Then hunt the hardcoded values that will **not** flip:

- `MediaKit.jsx:548, 550, 594, 596, 695, 705, 707` — `rgba(0, 177, 226, …)`
  literals → `var(--mk-accent-soft)` / `var(--mk-accent-line)`.
- `MediaKit.jsx:1427` — `color: "#F59E0B"` (Secondary Audience label) → `var(--mk-warn)`.
- `MediaKit.jsx:1489` — `bg-black` on the thumbnail container → `var(--mk-border)`.
- `MediaKit.jsx:510` — `bg-[#0B1520]` in the print branch → remove.
- `MediaKitPrint.jsx:14` — `bg-[#0B1520]` wrapper and the `background-color`
  in the `@media print` block → remove.

In light mode, cards are white-on-white: give `.duo-card`, `.stat-block` and the
section panels a visible `1px solid var(--mk-border)` and drop `shadow-xl`/`shadow-lg`,
which print as grey mud.

### 3.2 Drive the theme from the URL, not from `@media print`

The print route takes `?theme=light`. Set `data-theme` on the `mk-theme` element
from that param. Puppeteer will call `emulateMediaType('screen')`, so **what
Patrick sees at that URL in a normal browser tab is byte-for-byte what the PDF
contains.** Do not put layout decisions inside `@media print` — it destroys
previewability and is the reason the current bugs went unnoticed.

### 3.3 Never use responsive variants in print mode

Breakpoint variants are viewport-based and therefore unreliable in both Puppeteer
and preview. In `isPrintMode`, emit **explicit unprefixed** column classes. Apply
these targets:

| Line | Current | Print mode |
|---|---|---|
| `:727` | `grid-cols-1 sm:grid-cols-3` | `grid-cols-3` |
| `:796` | `grid-cols-2 lg:grid-cols-4` | `grid-cols-4` |
| `:879` | `grid-cols-1 md:grid-cols-2` | `grid-cols-2` |
| `:997` | `grid-cols-1 sm:grid-cols-2` | `grid-cols-2` |
| `:1124` | `grid-cols-1 md:grid-cols-3` | `grid-cols-3` |
| `:1387` | `grid-cols-1 md:grid-cols-2` | `grid-cols-2` |
| `:1476` | `grid-cols-1 sm:grid-cols-3` | `grid-cols-3` |
| `:1554` | `grid-cols-1 md:grid-cols-2` | `grid-cols-2` |
| `:1663` | `grid-cols-1 md:grid-cols-2` | `grid-cols-2` |
| `:1825` | `grid-cols-1 md:grid-cols-2` | `grid-cols-2` |
| `:1875` | `grid-cols-1 sm:grid-cols-2` | `grid-cols-2` |

Delete the `.recent-work-grid` override in `MediaKitPrint.jsx:37–43` once this lands.

The print document renders in a fixed **720px** container (7.5in at 96dpi),
centred, so preview and PDF are identical at any browser width.

### 3.4 Density and breaks

- Scale the headline stat numbers down for print: `text-3xl sm:text-4xl` → `text-2xl`.
  Keep body copy at 12px (= 9pt); do not go below 11px (= 8.25pt) anywhere.
- Reduce section panel padding `p-6 sm:p-8` → `p-4` and card padding `p-5`/`p-6` → `p-3.5`
  in print mode.
- **Relax `break-inside: avoid` to the smallest atomic units only** — individual stat
  cards, one duo bio, one Recent Work tile. Remove it from whole `<section>` wrappers
  and from the `header`. Keep `break-after: avoid` on section headers.

---

## 4. Phase 2 — Section and block registry

Replace the ten hardcoded booleans with data. This is the enabling change for
everything in Phase 3; do not skip it and bolt presets onto the current model.

Create `frontend/src/mediaKitSections.js`:

```js
export const MEDIA_KIT_BLOCKS = [
  { section: "survey",        id: "survey.stats",        label: "In-market qualification stats", tier: 1 },
  { section: "reach",         id: "reach.headline",      label: "Headline reach stats",          tier: 1 },
  { section: "reach",         id: "reach.perVideo",      label: "Expected 30-day reach / video", tier: 2 },
  { section: "reach",         id: "reach.engagement",    label: "Engagement & retention",        tier: 2 },
  { section: "reach",         id: "reach.trailing12m",   label: "Trailing 12 complete months",   tier: 3 },
  { section: "whoIsWatching", id: "audience.geo",        label: "Top geographic markets",        tier: 2 },
  { section: "whoIsWatching", id: "audience.buyingPower",label: "Buying power & demographics",   tier: 1 },
  { section: "whoIsWatching", id: "audience.intent",     label: "Intent & discovery",            tier: 3 },
  { section: "pillars",       id: "pillars.bars",        label: "Content pillar breakdown",      tier: 2 },
  { section: "pillars",       id: "pillars.whoWeReach",  label: "Primary / secondary audience",  tier: 2 },
  // …featuredIn, recentWork, duoBios, beyondChannel, events, partners, caseStudy
];

export const MEDIA_KIT_SECTIONS = [
  { id: "survey",        label: "Audience Survey",     defaultOrder: 10, printCols: 3 },
  // …one entry per section, carrying its print column count
];
```

Requirements:

- Each block maps to an existing JSX range. Use the section boundaries already in
  the file: survey `688–773`, reach `779–1023`, featuredIn `1030–1102`,
  whoIsWatching `1108–1294`, pillars `1300–1449`, recentWork `1455–1526`,
  duoBios `1533–1641`, beyondChannel `1647–1793`, events `1800–1885`,
  partners `1891–1994`.
- A section renders only if at least one of its blocks is selected. A section whose
  blocks are all deselected must not emit a header, a wrapper, or a margin.
- The existing availability guards (`hasFeaturedIn`, `hasDuoBios`,
  `hasEventCoverage`, `MediaKit.jsx:481–496`) still apply — a block whose data is
  empty is not offered in the UI and is not counted.
- Section **order** comes from the preset, not from source order.

### 4.1 Pin the invariants

- The header (`MediaKit.jsx:525–685`) is always rendered and has no toggle.
- **Extract the contact CTA (`:1963–1993`) out of the partners section** into its
  own always-on closing block. It must appear in every generated PDF regardless of
  selection. This fixes §1(d).
- Add a "Prepared for {recipient} · {Month Year}" line under the header, populated
  from the preset. Omit the line entirely when the preset has no recipient.

---

## 5. Phase 3 — Named presets

### 5.1 Schema

In `server/db.js`, inside the `articleDb.exec()` block, immediately after
`media_kit_manual` (which closes at line 355):

```sql
CREATE TABLE IF NOT EXISTS media_kit_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  recipient TEXT DEFAULT NULL,
  blocks_json TEXT NOT NULL,
  order_json TEXT NOT NULL,
  is_builtin INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_media_kit_presets_name ON media_kit_presets(name);
```

`blocks_json` stores an **explicit include list** of block ids, never an exclude
list — that is what makes a saved preset a stable snapshot (fixes §1(h)).

Seed three built-ins, matching the negotiation stages:

- **Intro** — tier 1 blocks only. Target: 1 page.
- **Standard** — tiers 1–2. Target: 2–3 pages.
- **Full** — everything available. 

### 5.2 API

Add to `server/app.js` in the Media Kit block (after `:2866`), all behind
`auth.requireAuth()` and following the existing `{ success: true, ... }` shape:

- `GET    /api/media-kit/presets` — list
- `POST   /api/media-kit/presets` — create (reject duplicate names, 400)
- `PUT    /api/media-kit/presets/:id` — update (reject writes to `is_builtin` rows, 403)
- `DELETE /api/media-kit/presets/:id` — delete (same guard)
- `POST   /api/media-kit/pdf` — render (§6)

Put the DB helpers in `server/media-kit.js` next to `getManualData` / `saveManualData`
(`:156–179`) and export them from the existing `module.exports` at `:1152`.

### 5.3 UI

Replace the `PDF: n/m sections` badge (`MediaKit.jsx:615–637`) with a preset bar:

- Preset dropdown; selecting one applies its blocks and order.
- "Save as…" (name + optional recipient), "Update preset", "Delete".
- Recipient field feeding the "Prepared for" line.
- A collapsible block picker grouped by section, with per-section select-all.
- Drag-to-reorder for sections.
- A live page-count estimate, and a "Preview" button opening
  `/media-kit/print?theme=light&preset={id}` in a tab.
- **Download PDF** posts to `/api/media-kit/pdf` and saves the returned file.

Keep `localStorage` only as the "last used preset id". Delete the
`media_kit_print_sections` key handling (`:62–70`, `:183`, `:189`) and the dead
`?exclude=` / `?sections=` parsing (`:41–60`). Migrate an existing saved
`media_kit_print_sections` value into a preset named "Imported" on first load, once.

---

## 6. Phase 4 — Puppeteer PDF service

Add `puppeteer` to `package.json` dependencies. Create `server/media-kit-pdf.js`.

### 6.1 Authentication

The print route is behind `auth.requireAuth({ redirectToLogin: true })`
(`server/app.js:2875`). Puppeteer runs on the same host, so **mint an ephemeral
real session rather than adding a new auth surface**:

1. Insert a `sessions` row for `req.user.id` with a 2-minute `expires_at`
   (reuse `auth.createSession`, see `server/auth.js:18–23`).
2. `page.setCookie({ name: "sid", value: token, domain: "127.0.0.1" })`.
3. Navigate to `http://127.0.0.1:${process.env.PORT || 3000}/media-kit/print?...`.
4. Delete the session row in a `finally` block, always.

No new token type, no change to `requireAuth`.

### 6.2 Render

```js
const browser = await puppeteer.launch({
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
});
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 1000, deviceScaleFactor: 2 });
await page.emulateMediaType("screen");          // theme comes from the URL, not @media print
await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(
    Array.from(document.images)
      .filter((i) => !i.complete)
      .map((i) => i.decode().catch(() => null))
  );
});
const pdf = await page.pdf({
  format: "letter",
  printBackground: true,
  margin: { top: "0.55in", bottom: "0.6in", left: "0.5in", right: "0.5in" },
  displayHeaderFooter: true,
  headerTemplate: "<div></div>",
  footerTemplate: `…`,
});
```

The explicit font/image wait replaces the 1s timer and fixes §1(f).

### 6.3 Footer

`footerTemplate` must carry, at ~8pt in `#4A5A68`:

`The Electric Duo · {contact email} · Page <span class="pageNumber"></span> of <span class="totalPages"></span>`

Puppeteer header/footer templates do not inherit page styles — inline every rule,
and give the footer enough bottom margin (0.6in above) that it does not collide
with content.

### 6.4 Endpoint and filename

`POST /api/media-kit/pdf` takes `{ presetId }` (or an inline block list for an
unsaved selection) and responds:

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="ElectricDuo-MediaKit-{Preset}-{YYYY-MM}.pdf"
```

Slugify the preset/recipient name. This fixes §1(g).

Serialise renders — one Puppeteer instance at a time, with a simple in-process
queue — and hard-cap at 60s. A single Chromium on a small VPS will not survive
concurrent invocations.

### 6.5 Retire the old path

- `MediaKitPrint.jsx` keeps rendering the preview route but **must not** call
  `window.print()`. Delete the `useEffect` at `:5–11`.
- Delete the `@media print` block at `:17–47` except the `@page` rule; layout now
  lives in the light theme, not in print media.
- `handleOpenPrint` (`:202–207`) becomes "open preview"; downloading goes through
  the API.

---

## 7. Acceptance criteria

1. The dark screen view is pixel-identical to `c872d3f` for a fully-selected kit.
2. `/media-kit/print?theme=light&preset=N` renders light, at a fixed 720px width,
   identically at 1280px and 1920px browser widths.
3. No `sm:`/`md:`/`lg:` class affects layout in print mode. Grep the print branch
   to confirm.
4. The **Intro** preset produces exactly **1 page**; **Standard** produces 2–3.
5. Every generated PDF, at every preset, contains the contact email and a
   `Page N of M` footer.
6. Deselecting any single block shortens the document or leaves it the same length.
   It never lengthens it, and never introduces a vertical gap taller than 1.5in.
7. No page ends with a section header stranded as its last element.
8. Recent Work thumbnails are present in every generated PDF across 10 consecutive
   cold-cache runs.
9. `--mk-accent` in light mode measures ≥ 4.5:1 against `--mk-bg`.
10. Saving a preset, adding a new block to the registry, then re-rendering that
    preset produces the **same** document as before the block was added.
11. Two presets with different section orders render in their own orders.
12. Concurrent `POST /api/media-kit/pdf` calls queue and both succeed.
13. The ephemeral `sessions` row is gone after every render, including on failure.
    Verify with `SELECT COUNT(*) FROM sessions` before and after.

---

## 8. Files touched

| File | Change |
|---|---|
| `frontend/src/MediaKit.jsx` | Palette → class; block registry; print columns; extract contact; preset bar |
| `frontend/src/MediaKitPrint.jsx` | Remove auto-print and print CSS; theme param; 720px container |
| `frontend/src/mediaKitSections.js` | **New** — block/section registry |
| `frontend/src/MediaKitPresetBar.jsx` | **New** — preset UI |
| `frontend/src/SectionPrintToggle.jsx` | Repurpose for blocks, or delete if the picker replaces it |
| `server/db.js` | `media_kit_presets` table after line 355 |
| `server/media-kit.js` | Preset CRUD helpers near `:156`; export at `:1152` |
| `server/media-kit-pdf.js` | **New** — Puppeteer service |
| `server/app.js` | Preset + PDF routes after `:2866` |
| `package.json` | `puppeteer`; version → 2.6.0 |
| `CHANGELOG.md` | 2.6.0 entry |

---

## 9. Deployment risk — read before starting Phase 4

`cc.theelectricduo.com` runs on a shared webserver. Puppeteer downloads a ~170MB
Chromium on install and needs `libnss3`, `libatk`, `libgbm` and friends. **Confirm
that host can run headless Chromium before committing to Phase 4.**

If it cannot, the fallbacks in order of preference:

1. `puppeteer-core` pointed at a system Chromium via `PUPPETEER_EXECUTABLE_PATH`.
2. Render PDFs on demand from Patrick's Mac against the production API.
3. Ship Phases 1–3 only and keep `window.print()` — Phase 1 alone fixes the
   layout collapse, the light palette, and the wait-for-images race. Phases 1–3
   are independently valuable and **must not** be blocked on Phase 4.

Phases 1–3 have no new runtime dependency. Land them first, verify against the
acceptance criteria above, and treat Phase 4 as a separate commit.
