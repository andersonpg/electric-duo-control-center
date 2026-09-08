# Antigravity Fix — Chapter Timestamps Are Guessed, Not Derived

The chapter generator in `POST /api/videos/:videoId/generate-chapters`
(`server/app.js`) picks the right topical sections but assigns wrong start
times. There are two independent causes. Fix both. Change nothing else in that
route beyond what is described here.

## Cause 1 — most of the transcript never reaches the model

The prompt truncates the subtitle file:

```js
userPrompt += `Cleaned SRT Transcript with Timestamps:\n${transRow.cleaned_srt.slice(0, 45000)}\n\n`;
```

A SubRip file carries an index line and a timestamp line for every cue, so it
runs roughly 75 characters per cue and auto-captions emit a cue every two to
three seconds. For this channel's typical runtimes that means:

| Video length | Approx. SRT size | Portion the model sees |
|---|---|---|
| 36 min | ~65,000 chars | first ~25 min |
| 57 min | ~103,000 chars | first ~25 min |
| 65 min | ~117,000 chars | first ~25 min |

Everything past roughly the twenty-five minute mark is invisible, so any
chapter in that region is pure invention. The model is also told the true total
runtime, which actively encourages it to fabricate plausible-looking times
across a span it cannot see.

## Cause 2 — the model is being asked to do timestamp arithmetic

Even inside the visible window, language models are unreliable at binding
content to precise cue times in a long subtitle file. They read the text,
decide where the topics change, then estimate times roughly proportionally.
That is exactly the reported symptom: correct sections, guessed times.

The fix is to stop asking the model for timestamps at all.

---

## The fix

### Step 1 — parse the cleaned SRT into cues

Add a helper that turns `cleaned_srt` into an array of
`{ startSec, endSec, text }`. There is no cue parser in the codebase yet;
`fixTranscript.js` only exposes the `SRT_TIME` regex at line 21, which you can
reuse to spot timestamp lines. Handle both comma and period as the millisecond
separator.

### Step 2 — condense the cues into indexed windows

Group the cues into fixed thirty-second windows. Each window gets a sequential
index, the start time of its first cue, and that window's text joined together.
Render them for the prompt as:

```
[0] 0:00 — Welcome back to the channel, today we are testing...
[1] 0:30 — so the first thing I want to look at is the charging curve...
[2] 1:00 — ...
```

A sixty-five minute video yields about 130 windows, which is a fraction of the
raw file and comfortably fits with no truncation. **Delete the `.slice(0, 45000)`
call entirely.** If a video ever produces more than 400 windows, widen the
window size until it fits rather than truncating.

### Step 3 — have the model return window indices, not seconds

Change the response schema from `startSeconds` to `startWindow`, an integer
index into the list above. Update the prompt to say that each chapter must name
the window where that topic begins, and that the first chapter must be window
zero.

The model now only has to answer "which block does this section start in",
which it does reliably. It never performs arithmetic.

### Step 4 — map indices back to exact times server-side

For each returned `startWindow`, look up that window and take the start time of
its **first cue**. This gives cue-level precision rather than snapping to a
thirty-second grid.

Discard any index that is out of range. Keep the existing sort, the ten-second
minimum gap, the runtime bound, and the fewer-than-three check, all of which
are correct as written.

### Step 5 — fix the opening-chapter handling

The current code does `sanitized[0].startSeconds = 0`, which relabels whatever
the model returned first as the opening chapter. If the model's first chapter
was genuinely four minutes in, its title is now attached to the wrong part of
the video.

Replace that with: if the first chapter resolves to within thirty seconds of
zero, snap it to zero. Otherwise leave it where it is and prepend a separate
`0:00 Intro` chapter.

### Step 6 — derive runtime from the transcript

`parseDurationSec` in `server/channel-health.js` returns `900` when the
duration string is missing. That silently caps chapters at fifteen minutes for
any video whose `duration` column is null, dropping every later chapter and
often triggering a confusing "transcript too sparse" error.

In this route, take the runtime from the end time of the last SRT cue, falling
back to the `duration` column, and return a 400 if neither is available. Do not
accept the 900 default. Do not change `parseDurationSec` itself, since other
callers depend on its current behavior.

### Step 7 — make the result reviewable

Include in each returned chapter object a `sourceExcerpt` field holding the
first hundred or so characters of transcript text at that timestamp. Render it
in small muted type beneath each chapter row in `frontend/src/Transcripts.jsx`.

This makes a bad timestamp obvious at a glance instead of requiring the creator
to scrub the video to find out.

---

## Acceptance criteria

1. Generating chapters for a video over forty minutes produces chapters spread
   across the full runtime, with the last chapter in the final third.
2. No call to `.slice()` remains on the transcript in this route.
3. The Gemini response schema contains `startWindow` and no longer contains
   `startSeconds`.
4. Each chapter's `sourceExcerpt` visibly matches its title when checked
   against the video.
5. A video whose `duration` column is null still generates correct chapters
   rather than stopping at fifteen minutes.
6. Spot-check three chapters on a long video against the actual playback
   position. Each should land within a few seconds of the topic change.

Bump the version and add a CHANGELOG entry.
