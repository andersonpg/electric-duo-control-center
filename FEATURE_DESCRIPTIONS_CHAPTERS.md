# Antigravity Feature Prompt — Description & Chapter Generation

Add two transcript-driven generators to the EV Transcripts & Title Strategist
page, plus an optional guarded push to YouTube. Build the sections in order and
confirm each works before moving on. Do not refactor anything not listed here.

## Background you need before starting

**YouTube has no separate chapters field.** Chapters are parsed out of the video
description. So the description and the chapter list are one payload, and the
ordering is: generated description first, chapter list below it, previous
description below that.

For YouTube to recognize chapters, all of these must hold:

- the first timestamp is exactly `0:00`
- there are at least three timestamps
- every chapter runs at least ten seconds
- timestamps ascend, and each starts its own line, followed by a space and the
  chapter title

**`videos.update` replaces the entire snippet.** Any field you omit is wiped.
There is already a correct read-modify-write implementation of this in
`server/youtube.js`, in `updateYoutubeVideoTitle`. Mirror its structure exactly
for the description update. Do not write a fresh one from scratch.

---

## Section 1 — Prompt settings

The single-row `title_prompt_settings` table already holds two prompts,
`instructions` and `thumbnail_instructions`. It is the de facto prompt store,
so extend it rather than adding new tables. The table name is a misnomer now;
leave it alone, renaming is a separate task.

In `server/db.js`, add two columns using the existing `addColumnIfNotExists`
helper:

- `description_instructions TEXT`
- `chapter_instructions TEXT`

Seed both with sensible defaults following the pattern already used for
`DEFAULT_THUMBNAIL_PROMPT_INSTRUCTIONS`. The description default should
describe an EV-channel YouTube description: a two or three sentence hook, a
short body covering what the video actually demonstrates, and a closing line.
The chapter default should ask for six to twelve chapters with short,
scannable, non-clickbait labels.

Extend `GET` and `PUT /api/title-prompt-settings` to read and write both new
fields. In `frontend/src/AdminSettings.jsx`, add two textareas to the existing
prompt settings panel so both are editable alongside the title and thumbnail
prompts.

---

## Section 2 — Generation endpoints

Both routes go in `server/app.js`, modeled closely on
`POST /api/videos/:videoId/generate-titles`, including `auth.requireAuth()`,
`aiLimiter`, the Gemini client setup, the `default_model` app setting lookup,
and `responseMimeType: "application/json"` with an explicit `responseSchema`.

### `POST /api/videos/:videoId/generate-description`

Accepts an optional `context` string in the body, the same way the title route
does, so the creator can add highlights the transcript will not convey.

Read `plain_text` from the `transcripts` table. Reject with 400 unless the
transcript row exists and its `status` is `fixed` or `uploaded`, with the
message that the transcript must be retrieved and EV-cleaned first.

Return an object with `description` as a plain-text string, and `charCount`.
Reject or flag any result over 4,500 characters, leaving headroom under
YouTube's 5,000 limit for the chapter block and the existing description.

### `POST /api/videos/:videoId/generate-chapters`

Read `cleaned_srt`, **not** `plain_text`. The plain text has no timestamps and
chapters cannot be derived from it. Same status gating as above, plus a 400 if
`cleaned_srt` is empty.

Parse the video's `duration` column, which is ISO 8601 such as `PT36M35S`.
There is already a `parseDurationSec` helper in `server/channel-health.js`;
reuse it rather than writing another parser. Pass the total runtime to Gemini
so it does not invent chapters past the end of the video.

Return an array of objects with `startSeconds` as an integer and `title` as a
string.

Then **validate the model output server-side before returning it.** Do not
trust the model to follow the rules:

- sort ascending by `startSeconds`
- force the first entry to `0`
- drop any entry within ten seconds of the previous one
- drop any entry at or beyond the video duration
- if fewer than three survive, return 422 with a message saying the transcript
  was too short or sparse to derive valid chapters

Format each as `M:SS` when under an hour and `H:MM:SS` at or above it, and
return both the raw array and a preformatted `chapterBlock` string ready to
paste.

---

## Section 3 — Transcripts page UI

In `frontend/src/Transcripts.jsx`, add a panel below the existing title
generation section, visible only when a video is selected and its transcript
status is `fixed` or `uploaded`. When the transcript is missing or still
`unfixed`, show a short disabled-state note explaining why rather than hiding
the panel entirely.

The panel holds two generate buttons, each rendering its result into an
editable textarea so the creator can revise before using it. Add a copy button
to each that writes to the clipboard and confirms with the existing toast
helper. Reuse the loading and error patterns already in that file.

---

## Section 4 — Guarded push to YouTube

Build this only after sections 1 to 3 are working.

### Scope

Enable the push button **only for videos whose `privacy_status` is
`unlisted`.** These are pre-publish drafts, so a bad push costs nothing. Keep
the restriction in one clearly commented condition so it can be lifted later.

### Storage

Add a `youtube_description_backups` table keyed by `video_id`, holding
`previous_description`, `pushed_block`, and `pushed_at`.

### `POST /api/videos/:videoId/push-description`

Body carries the final `description` and `chapterBlock` strings, taken from the
editable textareas so the creator's edits are what ships.

1. Reject unless the video is `unlisted`.
2. Fetch the current snippet with `videos.list`, exactly as
   `updateYoutubeVideoTitle` does.
3. Compose the new description as the generated description, a blank line, the
   chapter block, a blank line, then the previous description.
4. **Handle repeat pushes.** Look up `pushed_block` for this video. If the
   current YouTube description starts with that stored string, replace that
   leading block rather than prepending again. Otherwise prepend. Without this,
   pressing the button twice stacks two descriptions and two chapter lists.
   Do not use marker comments; YouTube descriptions are plain text and viewers
   would see them.
5. Reject with a clear message if the composed result exceeds 5,000 characters.
   Report the actual length so the creator knows how much to cut.
6. Save `previous_description` and the newly composed leading block to the
   backup table **before** calling `videos.update`.
7. Call `videos.update` with `part: ["snippet"]`, preserving `title`,
   `categoryId`, `tags`, `defaultLanguage`, and `defaultAudioLanguage` from the
   fetched snippet, exactly as the title updater does.

### `POST /api/videos/:videoId/restore-description`

Reads the backup row and writes `previous_description` back through the same
read-modify-write path. Surface it in the UI as an undo button, shown whenever
a backup row exists for the selected video.

### UI requirements

The push button must open a confirmation modal showing the exact final
description that will be sent, scrollable, with its character count. No blind
push. Label the button so it is obvious it writes to YouTube.

---

## Acceptance criteria

1. Both generators are unavailable, with an explanatory note, until a
   transcript exists with status `fixed` or `uploaded`.
2. Generated chapters always start at `0:00`, always number at least three,
   never sit closer than ten seconds apart, and never exceed the video runtime.
3. Both results are editable before copying or pushing, and copy puts the
   edited text on the clipboard.
4. The push button does not appear for public videos.
5. Pushing to an unlisted video prepends the description and chapters while
   leaving the previous description intact below them.
6. Pushing a second time replaces the previously pushed block instead of
   stacking a duplicate.
7. Restore returns the description to its exact pre-push state.
8. A composition over 5,000 characters is rejected before any YouTube call,
   naming the actual length.
9. Video title, tags, and category are unchanged after a push. Verify in
   YouTube Studio.

Bump the version, and add a CHANGELOG entry.
