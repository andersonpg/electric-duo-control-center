"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const rootDir = path.join(__dirname, "..");
const frontendDir = path.join(rootDir, "frontend");
const viteBin = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");

if (fs.existsSync(viteBin)) {
  try {
    console.log("Compiling frontend bundle with Vite...");
    execSync("npm --prefix frontend run build", { stdio: "inherit", cwd: rootDir });
    execSync("cp -r frontend/dist/* public/", { stdio: "inherit", cwd: rootDir });
    console.log("Frontend assets successfully updated in public/");
  } catch (err) {
    console.warn("Vite build encountered an issue, using existing pre-built public/ assets:", err.message);
  }
} else {
  console.log("Production server deployment: Using pre-built production assets in public/");
}

process.exit(0);
