/**
 * termList.js — deliberate, manual edits to ev_terms.json.
 *
 * Nothing in fixTranscript.js ever calls addTerm(). It only runs when
 * someone clicks "Add to term list" on a specific correction in the
 * review UI -- reviewing/saving a transcript never touches this file.
 */

const fs = require('fs');

/**
 * Add one wrong->correct mapping to a category. Safe to call repeatedly --
 * de-dupes both at the entry level and the variant level.
 *
 * @param {string} termsPath  path to ev_terms.json
 * @param {string} category   e.g. "vehicles", "charging", "units"
 * @param {string} correct    the correct spelling, e.g. "NACS"
 * @param {string} wrong      the mis-transcription, e.g. "knacks"
 * @returns {{ added: boolean, reason?: string }}
 */
function addTerm(termsPath, category, correct, wrong) {
  const data = JSON.parse(fs.readFileSync(termsPath, 'utf8'));

  if (!data[category]) data[category] = [];
  const wrongLower = wrong.trim().toLowerCase();

  let entry = data[category].find(
    (e) => e.correct.toLowerCase() === correct.trim().toLowerCase()
  );

  if (!entry) {
    entry = { correct: correct.trim(), wrong: [] };
    data[category].push(entry);
  }

  if (entry.wrong.some((w) => w.toLowerCase() === wrongLower)) {
    return { added: false, reason: 'already in list' };
  }

  entry.wrong.push(wrongLower);
  fs.writeFileSync(termsPath, JSON.stringify(data, null, 2) + '\n');
  return { added: true };
}

/** Flat list for a "manage terms" admin view -- category, correct, all variants. */
function listTerms(termsPath) {
  const data = JSON.parse(fs.readFileSync(termsPath, 'utf8'));
  const rows = [];
  for (const [category, entries] of Object.entries(data)) {
    if (category.startsWith('_') || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      rows.push({ category, correct: entry.correct, wrong: entry.wrong });
    }
  }
  return rows;
}

/** Remove a specific wrong variant (not the whole entry) -- for cleaning up a bad add. */
function removeVariant(termsPath, category, correct, wrong) {
  const data = JSON.parse(fs.readFileSync(termsPath, 'utf8'));
  const entry = (data[category] || []).find(
    (e) => e.correct.toLowerCase() === correct.trim().toLowerCase()
  );
  if (!entry) return { removed: false, reason: 'no such entry' };

  const before = entry.wrong.length;
  entry.wrong = entry.wrong.filter((w) => w.toLowerCase() !== wrong.trim().toLowerCase());
  if (entry.wrong.length === before) return { removed: false, reason: 'no such variant' };

  fs.writeFileSync(termsPath, JSON.stringify(data, null, 2) + '\n');
  return { removed: true };
}

module.exports = { addTerm, listTerms, removeVariant };
