#!/usr/bin/env node
/**
 * Documentation checks.
 *
 * Verifies that every relative link, image reference and asset path in the
 * Markdown files of this repository points at something that exists, and that
 * every referenced heading anchor actually exists.
 *
 * It deliberately does not check absolute URLs — those are outside this
 * repository's control and checking them would make CI flaky.
 *
 * Usage:
 *   node scripts/check-docs.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

// Mirrors GitHub's heading slugger: lowercase, drop everything that is not a
// word character, a space or a hyphen, then turn each remaining space into a
// hyphen. Whitespace is deliberately not collapsed — "Step 5 — Updating
// sources" becomes "step-5--updating-sources", exactly as GitHub renders it.
function slugify(heading) {
  return String(heading)
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/ /g, "-");
}

function headingsOf(markdown) {
  const anchors = new Set();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) anchors.add(slugify(match[2]));
  }
  return anchors;
}

function checkFile(file, relFile) {
  const markdown = fs.readFileSync(file, "utf8");
  const dir = path.dirname(file);

  // Inline images and links: ![alt](target) and [text](target)
  const pattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    const target = match[1].trim();
    if (!target) continue;
    if (target.startsWith("#")) {
      // Same-page anchor.
      const anchors = headingsOf(markdown);
      if (!anchors.has(target.slice(1).toLowerCase())) {
        problems.push(relFile + ": anchor not found on this page: " + target);
      }
      continue;
    }
    if (/^(https?:|mailto:|data:)/i.test(target)) continue;

    const [pathPart, anchor] = target.split("#");
    if (!pathPart) continue;

    const resolved = path.resolve(dir, decodeURIComponent(pathPart));
    if (!resolved.startsWith(rootDir)) {
      problems.push(relFile + ": link escapes the repository: " + target);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      problems.push(relFile + ": missing target: " + target);
      continue;
    }
    if (anchor && resolved.endsWith(".md")) {
      const anchors = headingsOf(fs.readFileSync(resolved, "utf8"));
      if (!anchors.has(anchor.toLowerCase())) {
        problems.push(relFile + ": anchor not found: " + target);
      }
    }
  }

  // HTML image and link tags in Markdown
  const htmlPattern = /(?:src|href)="([^"]+)"/g;
  while ((match = htmlPattern.exec(markdown)) !== null) {
    const target = match[1].trim();
    if (!target || target.startsWith("#")) continue;
    if (/^(https?:|mailto:|data:)/i.test(target)) continue;
    const [pathPart] = target.split("#");
    if (!pathPart) continue;
    const resolved = path.resolve(dir, decodeURIComponent(pathPart));
    if (!resolved.startsWith(rootDir)) {
      problems.push(relFile + ": link escapes the repository: " + target);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      problems.push(relFile + ": missing target: " + target);
    }
  }
}

function checkAssets() {
  const assetDir = path.join(rootDir, "assets");
  if (!fs.existsSync(assetDir)) return;
  for (const entry of fs.readdirSync(assetDir, { withFileTypes: true })) {
    const full = path.join(assetDir, entry.name);
    if (!entry.isFile() || !entry.name.endsWith(".svg")) continue;
    const svg = fs.readFileSync(full, "utf8");
    const rel = path.relative(rootDir, full);
    if (!/<svg[\s>]/i.test(svg)) problems.push(rel + ": does not start with an <svg> element");
    if (!/viewBox="/i.test(svg)) problems.push(rel + ": has no viewBox");
    if (/<image[\s>]/i.test(svg)) problems.push(rel + ": embeds a raster image");
    if (/xlink:href|href="https?:/i.test(svg)) problems.push(rel + ": has an external dependency");
    if (!/<\/svg>\s*$/.test(svg.trim())) problems.push(rel + ": is not closed with </svg>");
  }
}

function main() {
  const files = walk(rootDir);
  for (const file of files) {
    checkFile(file, path.relative(rootDir, file));
  }
  checkAssets();

  if (problems.length) {
    console.error("[FAIL] Documentation problems found:");
    for (const problem of problems) console.error("  - " + problem);
    process.exitCode = 1;
    return;
  }
  console.log("[PASS] Documentation links, anchors and assets are consistent (" + files.length + " markdown files checked)");
}

main();
