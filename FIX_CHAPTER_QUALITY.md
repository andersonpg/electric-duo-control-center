# Antigravity Fix — Chapter Timing Precision and Title Quality

The window-index rewrite works correctly, but it caps accuracy at the window
size and the model is still choosing the wrong window. Tested against
`BCiDAEHKdIo`, a 24-minute video, with the cleaned SRT as ground truth.

## Evidence

Every generated timestamp resolves to a thirty-second grid mark, confirming the
index-to-time mapping is functioning exactly as designed:

| Generated | Grid mark | First cue at or after it |
|---|---|---|
| 2:01 | 120s | 121.8s |
| 4:02 | 240s | 242.2s |
| 5:00 | 300s | 301.0s |
| 11:00 | 660s | 660.5s |
| 13:30 | 810s | 810.2s |
| 15:01 | 900s | 901.2s |
| 18:31 | 1110s | 1111.2s |

The mapping is not the bug. Accuracy against the real topic changes in the
transcript is:

| Section | True start in SRT | YouTube Ask Studio | Command Center |
|---|---|---|---|
| Exterior and styling | 0:54 | 0:54 | 2:01 |
| Frunk and 120V outlet | 3:56 | 3:56 | 4:02 |
| Front cabin | 5:23 | 5:22 | 5:00 |
| Infotainment and drive modes | 9:52 | 9:04 | missing |
| Rear seats | 11:00 | 11:00 | 11:00 |
| Midgate demo | 12:01 | 12:00 | missing |
| Tailgate and bed power | 13:43 | 13:45 | 13:30 |
| Driving and Sidewinder | 15:01 | 15:00 | 15:01 |
| Final verdict | 18:31 | 18:31 | 18:31 |

Four problems follow from this.

1. **Thirty-second windows cannot express the real boundaries.** Sections
   beginning at 0:54, 3:56, 5:23, 12:01 and 13:43 are unreachable on a
   thirty-second grid no matter how well the model performs.
2. **The model picks the wrong window anyway.** Choosing 2:01 for a section
   that begins at 0:54 is more than two windows of error. A thirty-second blob
   of merged text gives no clear signal for where a boundary sits, so the model
   lands where a topic feels established rather than where it starts.
3. **Too few chapters.** Eight for a twenty-four minute video. Two real
   sections were dropped entirely.
4. **Titles are generic.** "Front Cabin & Tech" and "Final Thoughts & Verdict"
   against Studio's "Front Cabin, Storage & Cup Holders" and "Final Verdict,
   Pricing & Conclusion". Every specific Studio used, the 478-mile range, the
   120V outlet, the 10-foot bed, Sidewinder, the price, is present in the
   transcript and was available.

---

## Fix 1 — Anchor quotes instead of window indices

This is the main change. Language models quote accurately and compute
timestamps badly, so have the model quote and let the server compute.

Add a required `anchorQuote` field to the response schema: six to twelve words,
copied **verbatim** from the transcript, at the exact point the section begins.
Keep `startWindow` as a fallback. Instruct the model that the quote must be
copied exactly, not paraphrased.

Resolve each quote server-side:

1. Build a normalized version of the full transcript by lowercasing, stripping
   punctuation, and collapsing whitespace, while keeping an array that maps
   each character offset back to its originating cue.
2. Normalize the returned quote the same way and search for it.
3. On a hit, take the start time of the cue containing the match. This lands
   within a couple of seconds of the true boundary.
4. On a miss, retry with the first six words of the quote. If that also misses,
   fall back to the existing `startWindow` behavior and mark the chapter
   `resolvedBy: "window"` so the imprecision is visible.

Return `resolvedBy` as either `quote` or `window` on every chapter and show it
in the UI. It tells you immediately whether a bad timestamp came from a bad
quote or a failed match.

## Fix 2 — Tighten the fallback windows to ten seconds

Change `windowSec` from 30 to 10, and raise the widening threshold from 400
windows to 1200 before it starts growing the window size. A sixty-five minute
video produces about 390 ten-second windows, which is well within budget.

Finer windows both improve the fallback path and give the model sharper local
context for choosing quotes.

## Fix 3 — Scale the chapter count to the runtime

Replace the fixed "6 to 12" instruction with a target computed from duration:
roughly one chapter every two minutes, with a floor of 8 for anything over
fifteen minutes and a ceiling of 20. Pass the computed target into the prompt
as an explicit number rather than a range.

A twenty-four minute video should be asked for about twelve chapters, not six
to twelve.

## Fix 4 — Rewrite the default chapter prompt

The seeded default asks for "short, scannable, non-clickbait labels", which
pushes the model straight toward generic output. Replace the value of
`chapter_instructions` in `server/db.js` with instructions that demand
specifics:

- Every title must contain at least one concrete noun, figure, or proper name
  taken from that section of the transcript. Model names, feature names,
  measurements, prices, ranges, and trim levels.
- Ban standalone generic labels. "Intro", "Overview", "Tech", "Features",
  "Final Thoughts", and "Conclusion" may not appear alone, only qualified by a
  specific.
- Titles run two to seven words. Ampersands are fine for joining two subjects.
- Include two or three worked examples in the prompt showing a weak title
  beside its strong replacement, for instance "Frunk" against "Frunk Space &
  120V Power Outlet", and "Driving" against "Driving Impressions & Sidewinder
  4-Wheel Steering".

Because this row already exists in the database, add a one-time migration that
overwrites `chapter_instructions` with the new default, guarded by a settings
flag so it does not clobber later hand edits. Note in the CHANGELOG that the
chapter prompt was reset.

---

## Acceptance criteria

Regenerate chapters for `BCiDAEHKdIo` and compare against the table above.

1. At least eleven chapters are produced.
2. The exterior section resolves between 0:50 and 1:00, not 2:01.
3. The frunk section resolves between 3:50 and 4:00.
4. Separate chapters exist for the infotainment and midgate sections, which are
   currently missing entirely.
5. At least eight of the chapters report `resolvedBy: "quote"`.
6. Every title contains a concrete noun, number, or proper name. No title is
   only a generic label.
7. No two chapters sit closer than ten seconds, and the first is at 0:00.

Bump the version and add a CHANGELOG entry.
