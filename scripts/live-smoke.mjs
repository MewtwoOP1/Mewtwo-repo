#!/usr/bin/env node
/**
 * Optional live smoke test for a single provider.
 *
 * The default CI mode is network-isolated (see tests/provider-health.test.js).
 * This script is the manual counterpart: it hits the real upstream, resolves a
 * real stream and — when the stream is an HLS manifest — verifies that the
 * manifest is really an HLS playlist and not an HTML error page.
 *
 * Usage:
 *   node scripts/live-smoke.mjs <providerId> [episodeUrl]
 *   node scripts/live-smoke.mjs --list
 *
 * Examples:
 *   node scripts/live-smoke.mjs anizone
 *   node scripts/live-smoke.mjs cinestream "{\"tmdbId\":27205,\"type\":\"movie\"}"
 *
 * Nothing here is required by CI. It is a debugging aid for a maintainer who
 * is chasing a single broken host.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Episode payloads that work without any argument. Every provider that needs
 * something more specific accepts it as the second argument instead.
 */
const SAMPLE_EPISODES = {
  anizone: "anizone://one-piece/1",
  animesuge: "animesuge://one-piece/1",
  animegg: "animegg://one-piece/1",
  animeav1: "animeav1://one-piece/1",
  animeonsen: "animeonsen://1",
};

function installHostFetchShim() {
  const originalFetch = global.fetch;
  global.__settings = global.__settings || {};
  global.fetch = async (url, init = {}) => {
    const options = {
      method: init.method || "GET",
      headers: init.headers || {},
      redirect: init.followRedirects === false ? "manual" : "follow",
    };
    if (init.body != null) options.body = init.body;
    if (init.timeoutMs) options.signal = AbortSignal.timeout(init.timeoutMs);
    const response = await originalFetch(String(url), options);
    const body = await response.text();
    const headers = Object.fromEntries(response.headers.entries());
    if (typeof response.headers.getSetCookie === "function") {
      const cookies = response.headers.getSetCookie();
      if (cookies.length) headers["set-cookie"] = cookies;
    }
    return { status: response.status, body, headers, url: response.url };
  };
  return originalFetch;
}

function findSource(providerId) {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "index.json"), "utf8"));
  return (manifest.sources || []).find((source) => source.id === providerId) || null;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "index.json"), "utf8"));
    for (const source of manifest.sources || []) {
      const sample = SAMPLE_EPISODES[source.id] ? "  (sample episode available)" : "";
      console.log(source.id.padEnd(22) + source.version.padEnd(9) + sample);
    }
    return;
  }

  const providerId = args[0];
  if (!providerId) {
    console.error("Usage: node scripts/live-smoke.mjs <providerId> [episodeUrl]");
    console.error("       node scripts/live-smoke.mjs --list");
    process.exitCode = 1;
    return;
  }

  const source = findSource(providerId);
  if (!source) {
    console.error("No source with id '" + providerId + "' is registered in index.json.");
    console.error("Run: node scripts/live-smoke.mjs --list");
    process.exitCode = 1;
    return;
  }

  const episodeUrl = args[1] || SAMPLE_EPISODES[providerId];
  if (!episodeUrl) {
    console.error(
      "No sample episode is known for '" + providerId + "'.\n" +
        "Pass the episode URL as the second argument."
    );
    process.exitCode = 1;
    return;
  }

  const originalFetch = installHostFetchShim();
  try {
    const provider = require(path.join(rootDir, source.file));
    const streams = await provider.getVideoSources(episodeUrl);
    const list = Array.isArray(streams) ? streams : [];
    console.log(
      provider.getInfo().name +
        " returned " + list.length + " candidate stream(s) for " + episodeUrl
    );

    let verified = 0;
    for (const stream of list) {
      if (!/^https?:\/\//i.test(stream.url)) throw new Error("Resolver returned a non-HTTP URL.");
      if (!/\.m3u8(?:[?#]|$)/i.test(stream.url)) {
        console.log("UNVERIFIED media URL type: " + stream.label + " (" + stream.container + ")");
        continue;
      }
      const response = await originalFetch(stream.url, {
        headers: { ...(stream.headers || {}), Range: "bytes=0-4095" },
        signal: AbortSignal.timeout(20000),
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error("Manifest request failed: HTTP " + response.status + " (" + stream.label + ")");
      }
      if (!body.includes("#EXTM3U")) {
        throw new Error("URL responded but body is not an HLS manifest (" + stream.label + ").");
      }
      verified++;
      console.log("PASS HLS manifest: " + stream.label + " HTTP " + response.status);
    }

    if (!list.length) {
      console.log("NO STREAMS. The upstream did not resolve this episode.");
      process.exitCode = 1;
      return;
    }
    if (!verified) {
      console.log("No resolved HLS manifest could be verified.");
      process.exitCode = 1;
      return;
    }
    console.log("PASS live smoke test for " + providerId + ".");
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error("LIVE_SMOKE_FAILED:", String((error && error.message) || error));
  process.exitCode = 1;
});
