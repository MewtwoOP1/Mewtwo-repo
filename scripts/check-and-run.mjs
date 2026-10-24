#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "index.json");
const providersDir = path.join(rootDir, "providers");
const testsDir = path.join(rootDir, "tests");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function main() {
  console.log("\n=== Manifest and provider validation ===");
  assert(fs.existsSync(manifestPath), "index.json is missing");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(manifest.name, "Manifest is missing a name");
  assert(Array.isArray(manifest.sources) && manifest.sources.length > 0,
    "Expected at least one source in index.json");

  const sourceIds = new Set();
  const sourceFiles = new Set();
  const registeredFiles = new Set();

  for (const source of manifest.sources) {
    for (const field of ["id", "name", "version", "type", "lang", "file", "logo"]) {
      assert(typeof source[field] === "string" && source[field].trim(),
        "Manifest source is missing " + field + ": " + JSON.stringify(source));
    }
    assert(!sourceIds.has(source.id), "Duplicate source id: " + source.id);
    assert(!sourceFiles.has(source.file), "Duplicate provider file in manifest: " + source.file);
    sourceIds.add(source.id);
    sourceFiles.add(source.file);

    const sourcePath = path.resolve(rootDir, source.file);
    const rel = path.relative(providersDir, sourcePath);
    assert(rel && !rel.startsWith("..") && !path.isAbsolute(rel),
      "Provider path must point inside providers/: " + source.file);
    assert(fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile(),
      "Provider file is missing: " + source.file);

    let provider = require(sourcePath);
    let scriptGlobalProvider = false;

    // AniKoto is intentionally kept in the original Zangetsu script-global form:
    // the app evaluates its functions directly, while CommonJS require() returns
    // an empty object. Validate that same form without modifying the provider.
    if (source.id === "anikoto" && (!provider || typeof provider.getInfo !== "function")) {
      const sandbox = { console, URL, URLSearchParams, setTimeout, clearTimeout };
      vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), sandbox, { filename: sourcePath });
      const info = typeof sandbox.getInfo === "function" ? sandbox.getInfo() : {};
      provider = {
        version: info.version,
        getInfo: sandbox.getInfo,
        getSettings: () => [],
        getHome: sandbox.getHome,
        search: sandbox.search,
        getDetail: sandbox.getDetail,
        getEpisodes: sandbox.getEpisodes,
        getVideoSources: sandbox.getVideoSources,
        getStreams: sandbox.getVideoSources
      };
      scriptGlobalProvider = true;
    }

    assert(provider && typeof provider === "object", "Provider must export an object: " + source.id);
    for (const method of ["getInfo", "getSettings", "getHome", "search", "getDetail", "getEpisodes", "getVideoSources", "getStreams"]) {
      assert(typeof provider[method] === "function",
        "Missing provider method " + method + " in " + source.id);
    }

    const info = provider.getInfo();
    const settings = source.settings || [];
    const providerSettings = provider.getSettings();
    assert(info && info.name === source.name, "Provider name does not match manifest: " + source.id);
    if (!scriptGlobalProvider) {
      assert(info.version === source.version && provider.version === source.version,
        "Provider version does not match manifest: " + source.id);
      assert(info.logo === source.logo, "Provider logo does not match manifest: " + source.id);
    }
    assert(info.lang === source.lang, "Provider language does not match manifest: " + source.id);
    assert(info.type === source.type, "Provider type does not match manifest: " + source.id);
    assert(Array.isArray(settings), "Manifest settings must be an array: " + source.id);
    assert(Array.isArray(providerSettings), "getSettings() must return an array: " + source.id);
    assert(providerSettings.length === settings.length,
      "getSettings() and manifest setting counts differ for " + source.id);
    assert(JSON.stringify(providerSettings.map((item) => item.key)) === JSON.stringify(settings.map((item) => item.key)),
      "getSettings() keys do not match manifest for " + source.id);

    for (const setting of settings) {
      for (const field of ["key", "label", "description", "type"]) {
        assert(typeof setting[field] === "string" && setting[field].trim(),
          "Setting for " + source.id + " is missing " + field);
      }
      assert(["text", "bool", "enum", "multiEnum"].includes(setting.type),
        "Unsupported setting type in " + source.id + ": " + setting.type);
    }

    registeredFiles.add(source.file);
    execFileSync(process.execPath, ["--check", sourcePath], { stdio: "inherit" });
    console.log("[PASS] " + source.name + ": manifest, settings, " + (scriptGlobalProvider ? "script-global runtime" : "exports") + ", and syntax");
  }

  console.log("\n=== Orphan provider check ===");
  assert(fs.existsSync(providersDir), "providers/ directory is missing");
  const providerFiles = fs.readdirSync(providersDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => "providers/" + name);
  for (const file of providerFiles) {
    assert(registeredFiles.has(file), "Provider file is not registered in index.json: " + file);
  }
  console.log("[PASS] Every providers/*.js file is registered");

  console.log("\n=== Mocked integration tests ===");
  assert(fs.existsSync(testsDir), "tests/ directory is missing");
  const testPaths = fs.readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort()
    .map((name) => path.join(testsDir, name));
  assert(testPaths.length > 0, "No tests/*.test.js files found");
  for (const testPath of testPaths) {
    execFileSync(process.execPath, [testPath], { stdio: "inherit" });
    console.log("[PASS] " + path.basename(testPath));
  }
  const luciferLiveTest = path.join(testsDir, "lucifer-donghua.live.js");
  execFileSync(process.execPath, ["--check", luciferLiveTest], { stdio: "inherit" });
  console.log("[PASS] Lucifer Donghua live test syntax");
  if (process.env.RUN_LUCIFER_DONGHUA_LIVE === "1") {
    execFileSync(process.execPath, [luciferLiveTest], { stdio: "inherit", env: process.env });
  }
  console.log("\nAll repository checks passed.");
}

try {
  main();
} catch (error) {
  console.error("\n[FAIL] " + (error && error.stack ? error.stack : String(error)));
  process.exitCode = 1;
}
