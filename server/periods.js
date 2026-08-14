"use strict";

function pad(n) { return n < 10 ? "0" + n : "" + n; }

function dayKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

function weekKey(d) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const start = new Date(t.getFullYear(), 0, 1);
  const wk = Math.ceil((((t - start) / 86400000) + 1) / 7);
  return t.getFullYear() + "-W" + pad(wk);
}

function monthKey(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
function quarterKey(d) { return d.getFullYear() + "-Q" + (Math.floor(d.getMonth() / 3) + 1); }
function yearKey(d) { return "" + d.getFullYear(); }

// "build" is a one-time 90-day plan, not a rolling period — it always uses this fixed key
const BUILD_KEY = "build-v1";

function currentKeys(now = new Date()) {
  return {
    daily: dayKey(now),
    weekly: weekKey(now),
    monthly: monthKey(now),
    quarterly: quarterKey(now),
    seasonal: yearKey(now),
    build: BUILD_KEY
  };
}

module.exports = { dayKey, weekKey, monthKey, quarterKey, yearKey, currentKeys, BUILD_KEY };
