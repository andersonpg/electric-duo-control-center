/**
 * fixTranscript.js — EV vocabulary cleanup for SRT/plain text, ported from
 * the Python CLI version. Pure function, no filesystem/CLI dependency, so
 * it drops straight into an Express route on cc.theelectricduo.com.
 *
 * const { fixSrt, loadRules } = require('./fixTranscript');
 * const rules = loadRules(require('./ev_terms.json'));
 * const { output, log } = fixSrt(srtText, rules);
 */

const NUM_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const TENS = new Set([20, 30, 40, 50, 60, 70, 80, 90]);
const UNIT_TOKENS = ['kWh', 'kW', 'MWh', 'MW', 'mph', 'hp', 'amps', 'volts', 'miles', 'percent'];

const SRT_TIME = /^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/;
const SRT_INDEX = /^\s*\d+\s*$/;
const VTT_META = /^\s*(WEBVTT|NOTE|STYLE|REGION)\b/;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build ordered regex rules from the same JSON shape as ev_terms.json. */
function loadRules(termsData) {
  const pairs = [];
  for (const [category, entries] of Object.entries(termsData)) {
    if (category.startsWith('_') || !Array.isArray(entries)) continue;
    for (const entry of entries) {
      for (const wrong of entry.wrong) {
        pairs.push({ wrong, correct: entry.correct, category });
      }
    }
  }
  // longest source phrase first, so multi-word matches win over substrings
  pairs.sort((a, b) => b.wrong.length - a.wrong.length);

  return pairs.map(({ wrong, correct, category }) => {
    const body = escapeRegExp(wrong).replace(/\\ /g, '[\\s-]+');
    const pattern = new RegExp(`(?<![\\w-])${body}(?![\\w-])`, 'gi');
    return { pattern, correct, category, wrong };
  });
}

function matchCase(replacement, original) {
  if (replacement !== replacement.toLowerCase()) return replacement;
  if (/^[A-Z]/.test(original)) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function wordsToNumber(phrase) {
  const tokens = phrase.toLowerCase().replace(/-/g, ' ').split(/\s+/);
  // "one fifty" (=150 spoken shorthand) is ambiguous with simple summing --
  // leave it untouched rather than write a wrong spec number.
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = NUM_WORDS[tokens[i]];
    const b = NUM_WORDS[tokens[i + 1]];
    if (a >= 1 && a <= 9 && TENS.has(b)) return null;
  }
  let total = 0;
  let current = 0;
  for (const token of tokens) {
    if (token === 'and') continue;
    if (!(token in NUM_WORDS)) return null;
    const value = NUM_WORDS[token];
    if (value === 100) {
      if (current === 0) return null;
      current *= 100;
    } else {
      current += value;
    }
  }
  total += current;
  return total || null;
}

function numeralizeUnits(text, log) {
  const numberWord = Object.keys(NUM_WORDS).join('|');
  const units = UNIT_TOKENS.map(escapeRegExp).join('|');
  const pattern = new RegExp(
    `\\b((?:(?:${numberWord})[\\s-]*){1,3})(?=\\s+(?:${units})\\b)`,
    'gi'
  );
  return text.replace(pattern, (match, phrase) => {
    const value = wordsToNumber(phrase.trim());
    if (value === null) return match;
    log.push({ before: phrase.trim(), after: String(value), category: 'numerals' });
    return String(value);
  });
}

function fixText(text, rules, log, doNumerals = true) {
  let out = text;
  for (const { pattern, correct, category } of rules) {
    out = out.replace(pattern, (m) => {
      const replaced = matchCase(correct, m);
      if (replaced !== m) log.push({ before: m, after: replaced, category });
      return replaced;
    });
  }
  if (doNumerals) out = numeralizeUnits(out, log);
  return out;
}

function isStructural(line, isVtt) {
  const s = line.trim();
  if (!s) return true;
  if (SRT_TIME.test(s)) return true;
  if (SRT_INDEX.test(s)) return true;
  if (isVtt && VTT_META.test(s)) return true;
  return false;
}

/**
 * Fix an SRT/VTT/plain-text string. Timing lines and cue numbers pass
 * through untouched.
 * @returns {{ output: string, log: Array, summary: Array }}
 */
function fixSrt(text, rules, { isVtt = false, numeralize = true } = {}) {
  const log = [];
  const lines = text.split(/\r?\n/);
  const out = lines.map((line) =>
    isStructural(line, isVtt) ? line : fixText(line, rules, log, numeralize)
  );

  // collapse into a de-duplicated, counted summary for a review UI
  const counts = new Map();
  for (const { before, after, category } of log) {
    const key = `${before.toLowerCase()}→${after}→${category}`;
    counts.set(key, (counts.get(key) || { before, after, category, count: 0 }));
    counts.get(key).count += 1;
  }
  const summary = [...counts.values()].sort((a, b) => b.count - a.count);

  return { output: out.join('\n'), log, summary };
}

/** Strip an SRT down to plain spoken text -- useful as the title-prompt input. */
function srtToPlainText(srtText) {
  return srtText
    .split(/\r?\n/)
    .filter((line) => !isStructural(line, false))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { loadRules, fixSrt, srtToPlainText };
