"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("./db");

const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;

function findUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(String(username || "").trim().toLowerCase());
}

function verifyPassword(user, password) {
  return bcrypt.compareSync(password || "", user.password_hash);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(token, userId, expires);
  return { token, expires };
}

function destroySession(token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function setSessionOAuthState(token, state) {
  if (!token) return;
  db.prepare("UPDATE sessions SET oauth_state = ? WHERE token = ?").run(state, token);
}

function getSessionOAuthState(token) {
  if (!token) return null;
  const row = db.prepare("SELECT oauth_state FROM sessions WHERE token = ?").get(token);
  return row ? row.oauth_state : null;
}

function clearSessionOAuthState(token) {
  if (!token) return;
  db.prepare("UPDATE sessions SET oauth_state = NULL WHERE token = ?").run(token);
}

function cleanExpiredSessions() {
  try {
    const info = db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
    if (info.changes > 0) {
      console.log(`[Auth] Purged ${info.changes} expired session(s) on startup.`);
    }
  } catch (e) {
    console.warn("[Auth] Failed to purge expired sessions:", e.message);
  }
}
cleanExpiredSessions();

function getUserFromToken(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now')`
  ).get(token);
  return row || null;
}

// Express middleware: attaches req.user, or responds 401 for API routes / redirects for pages
function requireAuth({ redirectToLogin } = {}) {
  return (req, res, next) => {
    const token = req.cookies ? req.cookies[SESSION_COOKIE] : null;
    const user = getUserFromToken(token);
    if (!user) {
      if (redirectToLogin) return res.redirect("/login.html");
      return res.status(401).json({ error: "not_authenticated" });
    }
    req.user = {
      id: user.id,
      name: user.name,
      username: user.username,
      is_admin: Boolean(user.is_admin),
    };
    next();
  };
}

// Express middleware: requires authenticated user with is_admin = 1
function requireAdmin() {
  return (req, res, next) => {
    const token = req.cookies ? req.cookies[SESSION_COOKIE] : null;
    const user = getUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: "not_authenticated" });
    }
    req.user = {
      id: user.id,
      name: user.name,
      username: user.username,
      is_admin: Boolean(user.is_admin),
    };
    if (!req.user.is_admin) {
      return res.status(403).json({ error: "Forbidden: Administrator access required" });
    }
    next();
  };
}

function destroyUserSessions(userId) {
  if (!userId) return;
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

module.exports = {
  SESSION_COOKIE,
  findUserByUsername,
  verifyPassword,
  createSession,
  destroySession,
  destroyUserSessions,
  getUserFromToken,
  requireAuth,
  requireAdmin,
  setSessionOAuthState,
  getSessionOAuthState,
  clearSessionOAuthState,
  cleanExpiredSessions,
};

