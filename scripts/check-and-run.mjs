#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootDir = process.cwd();

function logPass(msg) {
  console.log(`[PASS] ${msg}`);
}

function logFail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exitCode = 1;
}

/**
 * Step 1: Validate index.json manifest rules from Spyou/zangetsu-providers
 */
function checkManifest() {
  console.log("\n=== 1. Validating index.json Manifest ===");
  const manifestPath = path.join(rootDir, "index.json");
  if (!fs.existsSync(manifestPath)) {
    logFail("index.json not found at repository root.");
    return [];
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.name || !Array.isArray(manifest.sources)) {
    logFail("index.json must contain 'name' and a 'sources' array.");
    return [];
  }

  const requiredFields = ["id", "name", "version", "type", "lang", "file"];
  for (const src of manifest.sources) {
    for (const field of requiredFields) {
      if (!src[field]) {
        logFail(`Source '${src.id || "unknown"}' is missing required field '${field}'.`);
      }
    }
    if (!["anime", "movie"].includes(src.type)) {
      logFail(`Source '${src.id}' has invalid type '${src.type}' (must be 'anime' or 'movie').`);
    }

    const filePath = path.join(rootDir, src.file);
    if (!fs.existsSync(filePath)) {
      logFail(`Source file '${src.file}' listed in index.json does not exist.`);
    } else {
      logPass(`Manifest entry '${src.id}' (${src.version}) -> ${src.file} exists.`);
    }
  }

  return manifest.sources;
}

/**
 * Step 2: Run `node --check` syntax verification and version sync check
 */
function checkProviderSyntaxAndExports(sources) {
  console.log("\n=== 2. Checking Provider Syntax & Exports ===");
  for (const src of sources) {
    const fullPath = path.join(rootDir, src.file);
    try {
      execFileSync(process.execPath, ["--check", fullPath], { stdio: "pipe" });
      logPass(`Syntax check passed: ${src.file}`);
    } catch (err) {
      logFail(`Syntax error in ${src.file}: ${err.message}`);
      continue;
    }

    const mod = require(fullPath);
    if (mod.version !== src.version) {
      logFail(
        `Version mismatch for '${src.id}': index.json has ${src.version}, but ${src.file} has ${mod.version}`
      );
    } else {
      logPass(`Version matches between index.json and ${src.file} (${mod.version})`);
    }

    for (const fn of ["getHome", "search", "getDetail", "getStreams"]) {
      if (typeof mod[fn] !== "function") {
        logFail(`Provider '${src.id}' is missing required function '${fn}()'`);
      } else {
        logPass(`Export verified: ${fn}()`);
      }
    }
  }
}

/**
 * Step 3: Live functional smoke test against Stremio endpoints
 */
async function runSmokeTest() {
  console.log("\n=== 3. Running Live Stremio Bridge Smoke Test ===");
  const provider = require(path.join(rootDir, "providers/stremio-bridge.js"));

  const customAddonUrl =
    process.env.STREMIO_ADDON_URL || "https://v3-cinemeta.strem.io/manifest.json";
  const runtimeSettings = {
    addonUrls: customAddonUrl,
    excludeNonHttp: false,
  };

  console.log(`Using Addon Manifest URL(s): ${customAddonUrl}`);

  // 3a. Search test
  const query = process.env.TEST_QUERY || "Big Buck Bunny";
  const searchResults = await provider.search(query, runtimeSettings);
  if (!Array.isArray(searchResults) || searchResults.length === 0) {
    logFail(`search("${query}") returned 0 results.`);
    return;
  }
  const firstMatch = searchResults[0];
  logPass(
    `search("${query}") returned ${searchResults.length} results. Top hit: "${firstMatch.title}" (${firstMatch.year})`
  );

  // 3b. Detail + Tracker Sync check
  const detail = await provider.getDetail(firstMatch.id, runtimeSettings);
  if (!detail || !Array.isArray(detail.episodes) || detail.episodes.length === 0) {
    logFail(`getDetail() failed to return episodes for "${firstMatch.title}".`);
    return;
  }
  logPass(
    `getDetail() resolved "${detail.title}" with ${detail.episodes.length} episode(s). Tracker sync tmdbId=${detail.tmdbId ?? "none"}, tmdbIsTv=${detail.tmdbIsTv ?? false}`
  );

  // 3c. Stream endpoint check
  const firstEp = detail.episodes[0];
  const streams = await provider.getStreams(firstEp.id, runtimeSettings);
  logPass(
    `getStreams() executed cleanly for episode "${firstEp.title}" (returned ${streams.length} stream(s) from configured addon).`
  );
  if (streams.length > 0) {
    console.log("Sample stream output:", JSON.stringify(streams[0], null, 2));
  }
}

async function main() {
  const sources = checkManifest();
  if (sources.length > 0) {
    checkProviderSyntaxAndExports(sources);
    await runSmokeTest();
  }
}

main().catch((err) => {
  logFail(`Unhandled error during test run: ${err.stack || err.message}`);
});
  
