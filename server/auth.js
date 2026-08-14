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
    req.user = { id: user.id, name: user.name, username: user.username };
    next();
  };
}

module.exports = {
  SESSION_COOKIE,
  findUserByUsername,
  verifyPassword,
  createSession,
  destroySession,
  getUserFromToken,
  requireAuth
};
