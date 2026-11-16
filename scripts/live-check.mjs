import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const providerId = process.argv[2] || "anipm";
const episodeArg = process.argv[3] || "";

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
    const buffer = Buffer.from(await response.arrayBuffer());
    const body = buffer.toString("utf8");
    const headers = Object.fromEntries(response.headers.entries());
    return {
      status: response.status,
      body,
      headers,
      url: response.url,
      ok: response.ok,
      text: async () => body,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      json: async () => JSON.parse(body || "null"),
    };
  };
  return originalFetch;
}

installHostFetchShim();
global.__SOURCE_ID = providerId;
const provider = require(path.join(rootDir, "providers", providerId + ".js"));

const show = (label, value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  console.log("\n=== " + label + " ===\n" + (text || "").slice(0, 1400));
};

const results = await provider.search("frieren", 1, {});
show("search", results.map((r) => ({ title: r.title, url: r.url, malId: r.malId, anilistId: r.anilistId, year: r.year, cover: (r.cover || "").slice(0, 60) })));

if (results.length) {
  const detail = await provider.getDetail(results[0].url, {});
  show("detail", {
    title: detail.title, format: detail.format, status: detail.status, season: detail.season,
    malId: detail.malId, anilistId: detail.anilistId, year: detail.year,
    episodes: detail.episodes.length, sub: detail.subCount, dub: detail.dubCount,
    firstEpisodes: detail.episodes.slice(0, 4).map((e) => ({ n: e.number, cat: e.category, url: e.url })),
  });
  const episodeUrl = episodeArg || (detail.episodes[0] && detail.episodes[0].url);
  if (episodeUrl) {
    const streams = await provider.getVideoSources(episodeUrl, {});
    show("video sources", streams.map((s) => ({ url: s.url.slice(0, 90), container: s.container, kind: s.kind, subs: (s.subtitles || []).length })));
    for (const stream of streams) {
      try {
        const res = await fetch(stream.url, { headers: stream.headers || {} });
        const text = await res.text();
        show("stream probe", { status: res.status, type: res.headers.get("content-type"), head: text.slice(0, 160) });
      } catch (e) {
        show("stream probe", "FAILED " + e.message);
      }
      break;
    }
  }
}
