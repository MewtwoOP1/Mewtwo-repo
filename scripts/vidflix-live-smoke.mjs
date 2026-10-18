#!/usr/bin/env node
// Optional live smoke test. This checks VidCore directly; no hosted resolver is used.
const provider = require("../providers/vidflix.js");

const originalFetch = global.fetch;
global.__settings = {};
global.fetch = async (url, init = {}) => {
  const options = {
    method: init.method || "GET",
    headers: init.headers || {},
    redirect: init.followRedirects === false ? "manual" : "follow"
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

async function main() {
  const episode = JSON.stringify({
    id: "tmdb://tv/95350", videoId: "tmdb://tv/95350",
    type: "series", tmdbId: 95350, tmdbIsTv: true, season: 1, episode: 1
  });
  const sources = await provider.getVideoSources(episode);
  console.log("VidCore live resolver returned", sources.length, "candidate stream(s).");
  if (!sources.length) throw new Error("VidCore returned no stream URLs; inspect the provider warnings above.");
  let verified = 0;
  for (const source of sources) {
    if (!/^https?:\/\//i.test(source.url)) throw new Error("Resolver returned a non-HTTP URL.");
    if (!/\.m3u8(?:[?#]|$)/i.test(source.url)) {
      console.log("UNVERIFIED media URL type:", source.label, source.container);
      continue;
    }
    const response = await originalFetch(source.url, {
      headers: { ...(source.headers || {}), Range: "bytes=0-4095" },
      signal: AbortSignal.timeout(20000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error("Manifest request failed: HTTP " + response.status + " (" + source.label + ")");
    if (!body.includes("#EXTM3U")) throw new Error("URL responded but body is not an HLS manifest (" + source.label + ").");
    verified++;
    console.log("PASS HLS manifest:", source.label, "HTTP", response.status);
  }
  if (!verified) throw new Error("No resolved HLS manifest was verified.");
  console.log("PASS VidCore direct-resolution smoke test.");
}
main().catch((error) => {
  console.error("VIDFLIX_LIVE_CHECK_FAILED:", String(error && error.message || error));
  process.exitCode = 1;
}).finally(() => { global.fetch = originalFetch; });
