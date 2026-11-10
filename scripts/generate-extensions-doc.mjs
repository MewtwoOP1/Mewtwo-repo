#!/usr/bin/env node
/**
 * Generates docs/EXTENSIONS.md from the two sources of truth:
 *
 *   index.json             — source identity, version, type, language, settings
 *   docs/source-notes.json — human-written prose (purpose, behaviour, limitations)
 *
 * The manifest half is always authoritative, so counts, versions and setting
 * lists in the generated document can never drift from the code.
 *
 * Usage:
 *   node scripts/generate-extensions-doc.mjs           # write docs/EXTENSIONS.md
 *   node scripts/generate-extensions-doc.mjs --check   # fail if the file is stale
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(rootDir, "index.json");
const notesPath = path.join(rootDir, "docs", "source-notes.json");
const outputPath = path.join(rootDir, "docs", "EXTENSIONS.md");
const readmePath = path.join(rootDir, "README.md");

const GENERATED_HEADER = [
  "<!--",
  "  AUTO-GENERATED FILE — do not edit by hand.",
  "  Source of truth: index.json (identity, version, type, language, settings)",
  "                    docs/source-notes.json (purpose, behaviour, limitations)",
  "  Regenerate: node scripts/generate-extensions-doc.mjs",
  "  Verify:     node scripts/generate-extensions-doc.mjs --check",
  "-->",
].join("\n");

function fail(message) {
  console.error("[FAIL] " + message);
  process.exitCode = 1;
}

function setupBadge(level, levels) {
  return levels[level]?.badge ?? level;
}

function settingDefault(setting) {
  if (setting.default === undefined || setting.default === null) return "—";
  if (Array.isArray(setting.default)) {
    if (!setting.default.length) return "_(empty list)_";
    return "`" + setting.default.length + " selected`";
  }
  const text = String(setting.default);
  if (!text) return "_(empty)_";
  if (text.length > 70) return "`" + text.slice(0, 67) + "…`";
  return "`" + text.replace(/\|/g, "\\|") + "`";
}

function settingOptions(setting) {
  if (!setting.options || !setting.options.length) return "";
  return setting.options.map((option) => option.label).join(", ");
}

function build() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const notes = JSON.parse(fs.readFileSync(notesPath, "utf8"));
  const levels = notes.setupLevels;
  const sources = manifest.sources || [];
  const noteMap = notes.sources || {};

  // Consistency: every manifest source needs a note, and no note may be orphaned.
  const missing = sources.filter((source) => !noteMap[source.id]).map((source) => source.id);
  const orphaned = Object.keys(noteMap).filter((id) => !sources.some((source) => source.id === id));
  if (missing.length) fail("index.json sources without an entry in docs/source-notes.json: " + missing.join(", "));
  if (orphaned.length) fail("docs/source-notes.json entries that are not in index.json: " + orphaned.join(", "));
  if (missing.length || orphaned.length) return null;

  const unknownLevels = sources
    .filter((source) => noteMap[source.id].setup && !levels[noteMap[source.id].setup])
    .map((source) => source.id);
  if (unknownLevels.length) fail("Unknown setup level for: " + unknownLevels.join(", "));
  if (unknownLevels.length) return null;

  const anime = sources.filter((source) => source.type === "anime");
  const movie = sources.filter((source) => source.type !== "anime");
  const readyCount = sources.filter((source) => noteMap[source.id].setup === "ready").length;
  const defaultsCount = sources.filter((source) => noteMap[source.id].setup === "ready-with-defaults").length;
  const optionalCount = sources.filter((source) => noteMap[source.id].setup === "optional-credentials").length;
  const configCount = sources.filter((source) => noteMap[source.id].setup === "requires-config").length;
  const accountCount = sources.filter((source) => noteMap[source.id].setup === "requires-account").length;

  const lines = [];
  const push = (...parts) => lines.push(...parts);

  push(GENERATED_HEADER);
  push("");
  push("# Source catalogue");
  push("");
  push(
    "Every source published by this repository, with the exact version in the manifest and the " +
      "setup it actually needs. Setup levels are derived from the provider code — see " +
      "[SOURCE_CONFIGURATION.md](SOURCE_CONFIGURATION.md) for the step-by-step configuration walkthroughs."
  );
  push("");
  push("![Setup requirement legend](../assets/setup-legend.svg)");
  push("");
  push("| | Count | Sources |");
  push("|:--|--:|:--|");
  push(`| 🟢 Ready to use | ${readyCount} | No settings, no credentials. |`);
  push(`| 🔵 Ready with defaults | ${defaultsCount} | Settings exist and every default works. |`);
  push(`| 🟡 Optional credentials | ${optionalCount} | Works as installed; a key unlocks extra hosts. |`);
  push(`| 🟠 Requires configuration | ${configCount} | A URL or add-on list must be entered. |`);
  push(`| 🔴 Requires an account or server | ${accountCount} | Needs your own server and login. |`);
  push(`| **Total** | **${sources.length}** | ${anime.length} anime · ${movie.length} movie and TV |`);
  push("");
  push("---");
  push("");
  push("## Index");
  push("");
  push("| Source | Type | Lang | Version | Setup | Purpose |");
  push("|:--|:--|:--:|:--|:--|:--|");
  for (const source of sources) {
    const note = noteMap[source.id];
    push(
      `| [${source.name}](#${anchor(source.name)}) | ${source.type} | ${source.lang} | \`${source.version}\` | ` +
        `${setupBadge(note.setup, levels)} | ${oneLine(note.purpose)} |`
    );
  }
  push("");

  const sections = [
    { title: "Movie and TV sources", list: movie },
    { title: "Anime sources", list: anime },
  ];

  for (const section of sections) {
    push("---");
    push("");
    push(`## ${section.title} (${section.list.length})`);
    push("");
    for (const source of section.list) {
      const note = noteMap[source.id];
      const settings = source.settings || [];
      push(`### ${source.name}`);
      push("");
      push(`\`id: ${source.id}\` · \`v${source.version}\` · ${source.type} · ${source.lang} · ` +
        `${source.nsfw ? "NSFW flagged" : "not flagged NSFW"}`);
      push("");
      push("| Field | Value |");
      push("|:--|:--|");
      push(`| **Purpose** | ${note.purpose} |`);
      push(`| **Metadata** | ${note.metadata} |`);
      push(`| **Setup** | ${setupBadge(note.setup, levels)} — ${note.setupNote || levels[note.setup].short} |`);
      if (note.licence) push(`| **Licence** | ${note.licence} — see [Licensing](README.md#licensing) |`);
      push(`| **Settings** | ${settings.length ? settings.length + " exposed" : "none"} |`);
      push("");
      if (note.credentials && note.credentials.length) {
        push("**Credentials and settings**");
        push("");
        for (const credential of note.credentials) push(`- ${credential}`);
        push("");
      }
      if (settings.length) {
        push("| Setting | Type | Default | Choices |");
        push("|:--|:--|:--|:--|");
        for (const setting of settings) {
          push(
            `| ${setting.label} (\`${setting.key}\`) | ${setting.type} | ${settingDefault(setting)} | ` +
              `${settingOptions(setting) || "—"} |`
          );
        }
        push("");
      }
      if (note.behaviour) {
        push("**Behaviour**");
        push("");
        push(note.behaviour);
        push("");
      }
      if (note.limitations && note.limitations.length) {
        push("**Limitations**");
        push("");
        for (const limitation of note.limitations) push(`- ${limitation}`);
        push("");
      }
    }
  }

  push("---");
  push("");
  push("## Settings reference");
  push("");
  push("Every setting key exposed by any source, for quick lookup.");
  push("");
  push("| Key | Source | Type | Default |");
  push("|:--|:--|:--|:--|");
  for (const source of sources) {
    for (const setting of source.settings || []) {
      push(`| \`${setting.key}\` | ${source.name} | ${setting.type} | ${settingDefault(setting)} |`);
    }
  }
  push("");
  push("---");
  push("");
  push("## Related documentation");
  push("");
  push("- [Source configuration](SOURCE_CONFIGURATION.md) — step-by-step setup for every configurable source");
  push("- [Installation](INSTALLATION.md) — adding the repository and installing sources");
  push("- [Getting started](GETTING_STARTED.md) — from install to first playback");
  push("- [Architecture](ARCHITECTURE.md) — how providers are loaded and executed");
  push("");
  push("<sub>Generated from `index.json` and `docs/source-notes.json`. Run `node scripts/generate-extensions-doc.mjs` to refresh.</sub>");
  push("");

  return lines.join("\n");
}

function oneLine(text) {
  return String(text || "").replace(/\s+/g, " ").replace(/\|/g, "\\|");
}

// Mirrors GitHub's heading slugger: lowercase, drop everything that is not a
// word character, a space or a hyphen, then turn each remaining space into a
// hyphen. Whitespace is deliberately not collapsed, so "TMDB + Stremio"
// becomes "tmdb--stremio" exactly as GitHub renders it.
function anchor(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/ /g, "-");
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const content = build();
  if (content === null) return;

  if (checkOnly) {
    const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
    if (existing !== content) {
      fail("docs/EXTENSIONS.md is out of date. Run: node scripts/generate-extensions-doc.mjs");
      return;
    }
    console.log("[PASS] docs/EXTENSIONS.md matches index.json and docs/source-notes.json");
    return;
  }

  fs.writeFileSync(outputPath, content, "utf8");
  console.log("[PASS] Wrote docs/EXTENSIONS.md (" + content.split("\n").length + " lines)");

  // Keep the source count badge in the README honest.
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const count = (manifest.sources || []).length;
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, "utf8");
    const badge = /badge\/Sources-(\d+)-/.exec(readme);
    if (badge && Number(badge[1]) !== count) {
      fail(
        "README badge says " + badge[1] + " sources but index.json publishes " + count +
          ". Update the badge in README.md."
      );
    } else if (badge) {
      console.log("[PASS] README source badge matches the manifest (" + count + ")");
    }
  }
}

main();
