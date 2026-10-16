#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "index.json");
const testPaths = [
  path.join(rootDir, "tests/tmdb-stremio.test.js"),
  path.join(rootDir, "tests/justanime.test.js")
];

function fail(message) {
  console.error("[FAIL] " + message);
  process.exitCode = 1;
}
function pass(message) {
  console.log("[PASS] " + message);
}

function main() {
  console.log("\n=== Manifest validation ===");
  if (!fs.existsSync(manifestPath)) throw new Error("index.json is missing");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.name || !Array.isArray(manifest.sources) || manifest.sources.length < 1) {
    throw new Error("Expected at least one source in index.json");
  }

  const checkedFiles = new Set();
  for (const source of manifest.sources) {
    for (const field of ["id", "name", "version", "type", "lang", "file"]) {
      if (!source[field]) fail("Manifest source is missing " + field);
    }
    if (!["anime", "movie", "manga", "novel"].includes(source.type)) fail("Invalid source type: " + source.type);
    const settings = source.settings || [];
    if (!Array.isArray(settings)) fail("Source settings must be an array: " + source.id);
    for (const setting of settings) {
      if (!setting.key || !setting.label || !setting.description) fail("Every setting needs a key, label, and description");
      if (!["text", "bool", "enum", "multiEnum"].includes(setting.type)) fail("Unsupported setting type: " + setting.type);
    }

    const sourcePath = path.join(rootDir, source.file);
    if (!fs.existsSync(sourcePath)) throw new Error("Provider file is missing: " + source.file);
    const provider = require(sourcePath);
    if (provider.version !== source.version) fail("Provider version does not match manifest for " + source.id);
    for (const method of ["getInfo", "getSettings", "getHome", "search", "getDetail", "getEpisodes", "getVideoSources", "getStreams"]) {
      if (typeof provider[method] !== "function") fail("Missing provider method " + method + " in " + source.id);
    }
    if (provider.getSettings().length !== settings.length) fail("getSettings() and manifest setting counts differ for " + source.id);
    if (provider.getInfo().version !== source.version) fail("getInfo() version does not match manifest for " + source.id);
    if (checkedFiles.has(source.file)) continue;
    checkedFiles.add(source.file);
    execFileSync(process.execPath, ["--check", sourcePath], { stdio: "inherit" });
    pass("Manifest, settings, and syntax valid: " + source.name);
  }

  console.log("\n=== Mocked integration tests ===");
  for (const testPath of testPaths) {
    if (!fs.existsSync(testPath)) continue;
    execFileSync(process.execPath, [testPath], { stdio: "inherit" });
    pass("Mocked integration tests passed: " + path.basename(testPath));
  }
}
main();
