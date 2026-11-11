#!/usr/bin/env node
/**
 * Integrates the provider modules produced under /tmp/opencode/mods/ into
 * providers/cinestream.js and index.json.
 *
 * A module is a standalone file that ends with a `//__META__ {json}` line.
 * The integrator:
 *   1. reads the metadata,
 *   2. strips the module's `module.exports` block and the meta line,
 *   3. inserts the remaining code into providers/cinestream.js before the
 *      orchestrator,
 *   4. registers the provider in PROVIDERS / PROVIDER_FN / ANIME_ONLY,
 *   5. adds it to index.json (default list + settings options).
 *
 * Idempotent: re-running replaces a previously integrated module instead of
 * duplicating it.
 *
 * Usage: node scripts/integrate-mods.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modsDir = process.env.MODS_DIR || "/tmp/opencode/mods";
const providerFile = path.join(rootDir, "providers", "cinestream.js");
const manifestFile = path.join(rootDir, "index.json");
const dryRun = process.argv.includes("--dry");

const MARK_START = "// ── raghav/extension provider modules ─────────────────────────────";
const MARK_END = "// ── end raghav/extension provider modules ──────────────────────────";

function readMeta(file) {
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/\/\/__META__\s*(\{[\s\S]*\})\s*$/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

function stripModule(text) {
  let out = text.replace(/\/\/__META__\s*\{[\s\S]*\}\s*$/m, "");
  out = out.replace(/if \(typeof module !== 'undefined' && module\.exports\) \{[\s\S]*?\n\}\n?/g, "");
  out = out.replace(/^\s*'use strict';\s*$/m, "");
  return out.trim();
}

const mods = fs.existsSync(modsDir)
  ? fs.readdirSync(modsDir).filter((f) => f.endsWith(".js") && f !== "harness.js")
  : [];

const entries = [];
for (const file of mods) {
  const full = path.join(modsDir, file);
  const meta = readMeta(full);
  if (!meta || !meta.id || !meta.name) {
    console.log("[SKIP] " + file + " (no usable //__META__ line)");
    continue;
  }
  entries.push({ file, meta, code: stripModule(fs.readFileSync(full, "utf8")) });
}
entries.sort((a, b) => a.meta.id.localeCompare(b.meta.id));

console.log("[INFO] " + entries.length + " module(s) to integrate");
for (const e of entries) console.log("       " + e.meta.id + "  " + e.meta.name + "  [" + (e.meta.category || "?") + "]  " + (e.meta.status || "?"));

// ── 1. providers/cinestream.js ────────────────────────────────────────
let src = fs.readFileSync(providerFile, "utf8");

// Remove any previously integrated block.
const startIdx = src.indexOf(MARK_START);
const endIdx = src.indexOf(MARK_END);
if (startIdx >= 0 && endIdx > startIdx) {
  src = src.slice(0, startIdx) + src.slice(endIdx + MARK_END.length);
  src = src.replace(/\n{3,}/g, "\n\n");
}

const block = MARK_START + "\n\n" + entries.map((e) =>
  "// " + e.meta.name + " — " + (e.meta.domain || "") + "\n" +
  "// status: " + (e.meta.status || "UNVERIFIED") + (e.meta.notes ? " — " + e.meta.notes : "") + "\n" +
  e.code + "\n"
).join("\n") + "\n" + MARK_END;

const anchor = "// ── Orchestrator ───────────────────────────────────────────────────────";
if (src.indexOf(anchor) < 0) throw new Error("orchestrator anchor not found in providers/cinestream.js");
src = src.replace(anchor, block + "\n\n" + anchor);

// Register in PROVIDERS (the visible list).
const providerListAnchor = "  ['p_wyziesubs', 'Wyzie Subs']";
if (src.indexOf(providerListAnchor) < 0) throw new Error("PROVIDERS anchor not found");
const newProviderRows = entries.map((e) => "  ['" + e.meta.id + "', " + JSON.stringify(e.meta.name) + "],").join("\n");
src = src.replace(providerListAnchor, newProviderRows + "\n" + providerListAnchor);

// Register in PROVIDER_FN.
const fnAnchor = "  p_wyziesubs: provWyzie\n};";
if (src.indexOf(fnAnchor) < 0) throw new Error("PROVIDER_FN anchor not found");
const fnRows = entries.map((e) => {
  const fn = e.meta.fn || ("prov" + e.meta.name.replace(/[^A-Za-z0-9]/g, ""));
  return "  " + e.meta.id + ": " + fn;
}).join(",\n");
src = src.replace(fnAnchor, "  p_wyziesubs: provWyzie,\n" + fnRows + "\n};");

// Anime-only gate.
const animeIds = entries.filter((e) => (e.meta.category || "") === "anime").map((e) => e.meta.id);
if (animeIds.length) {
  const animeAnchor = "  p_anv: 1, p_anipm: 1\n};";
  if (src.indexOf(animeAnchor) < 0) throw new Error("ANIME_ONLY anchor not found");
  src = src.replace(animeAnchor, "  p_anv: 1, p_anipm: 1,\n  " + animeIds.join(", ") + "\n};");
}

if (!dryRun) fs.writeFileSync(providerFile, src);

// ── 2. index.json ─────────────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const cine = manifest.sources.find((s) => s.id === "cinestream");
if (!cine) throw new Error("cinestream source not found in index.json");
const enabled = cine.settings.find((s) => s.key === "enabledProviders");
if (!enabled) throw new Error("enabledProviders setting not found");

for (const e of entries) {
  if (!enabled.default.includes(e.meta.id)) enabled.default.push(e.meta.id);
  if (!enabled.options.some((o) => o.value === e.meta.id)) {
    enabled.options.push({ value: e.meta.id, label: e.meta.name });
  }
}
// Keep the default list and the option list in the same order so the UI and
// the runtime agree.
const order = new Map(enabled.options.map((o, i) => [o.value, i]));
enabled.default.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

if (!dryRun) fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");

console.log("[INFO] providers/cinestream.js: " + entries.length + " provider(s) registered");
console.log("[INFO] index.json: enabledProviders default now has " + enabled.default.length + " entries");
if (dryRun) console.log("[INFO] dry run — nothing written");
