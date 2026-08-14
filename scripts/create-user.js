"use strict";
/**
 * Usage:
 *   node scripts/create-user.js "Patrick" patrick@example.com "a-strong-password"
 *
 * Creates the account if the username doesn't exist yet, or resets the
 * password if it does. Run this on the server (via SSH/xCloud terminal),
 * never over the web — there is no public sign-up page by design.
 */

const bcrypt = require("bcryptjs");
const db = require("../server/db");

const [, , name, username, password] = process.argv;

if (!name || !username || !password) {
  console.error("Usage: node scripts/create-user.js \"Full Name\" username password");
  process.exit(1);
}

if (password.length < 10) {
  console.error("Please use a password of at least 10 characters.");
  process.exit(1);
}

const cleanUsername = username.trim().toLowerCase();
const hash = bcrypt.hashSync(password, 12);

const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(cleanUsername);
if (existing) {
  db.prepare("UPDATE users SET name = ?, password_hash = ? WHERE id = ?").run(name, hash, existing.id);
  console.log(`Updated existing user "${cleanUsername}" (password reset).`);
} else {
  db.prepare("INSERT INTO users (name, username, password_hash) VALUES (?, ?, ?)").run(name, cleanUsername, hash);
  console.log(`Created user "${cleanUsername}".`);
}
