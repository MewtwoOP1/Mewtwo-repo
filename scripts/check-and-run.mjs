#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "index.json");
const testPath = path.join(rootDir, "tests/tmdb-stremio.test.js");

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
  if (!manifest.name || !Array.isArray(manifest.sources) || manifest.sources.length !== 1) {
    throw new Error("Expected one combined source in index.json");
  }
  const source = manifest.sources[0];
  for (const field of ["id", "name", "version", "type", "lang", "file", "logo"]) {
    if (!source[field]) fail("Manifest source is missing " + field);
  }
  if (!["anime", "movie", "manga", "novel"].includes(source.type)) fail("Invalid source type");
  if (!Array.isArray(source.settings)) fail("Source settings must be an array");
  for (const setting of source.settings) {
    if (!setting.key || !setting.label || !setting.description) fail("Every setting needs a key, label, and description");
    if (!["text", "bool", "enum", "multiEnum"].includes(setting.type)) fail("Unsupported setting type: " + setting.type);
  }
  const sourcePath = path.join(rootDir, source.file);
  if (!fs.existsSync(sourcePath)) throw new Error("Provider file is missing: " + source.file);
  const provider = require(sourcePath);
  if (provider.version !== source.version) fail("Provider version does not match index.json");
  for (const method of ["getInfo", "getSettings", "getHome", "search", "getDetail", "getEpisodes", "getVideoSources", "getStreams"]) {
    if (typeof provider[method] !== "function") fail("Missing provider method: " + method);
  }
  if (provider.getSettings().length !== source.settings.length) fail("getSettings() and index.json setting counts differ");
  if (provider.getInfo().version !== source.version) fail("getInfo() version does not match index.json");
  pass("Single-source manifest and settings are valid");

  console.log("\n=== Syntax check ===");
  execFileSync(process.execPath, ["--check", sourcePath], { stdio: "inherit" });
  pass("Provider syntax is valid");

  console.log("\n=== Mocked integration tests ===");
  execFileSync(process.execPath, [testPath], { stdio: "inherit" });
  pass("Mocked integration tests passed");
}
main();
