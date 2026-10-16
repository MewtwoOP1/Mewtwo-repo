const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const calls = [];
global.__settings = {
  "tmdb-stremio": {
    tmdbApiKey: "test-user-key",
    addonUrls: "https://addon.example/manifest.json?token=secret\nhttps://second.example/manifest.json",
    maxStreamsPerAddon: "10",
  },
};

global.fetch = async (url) => {
  const requestUrl = String(url);
  calls.push(requestUrl);
  let body = {};

  if (requestUrl.includes("/trending/movie/week")) {
    body = { results: [{ id: 11, title: "Mock Film", release_date: "2024-01-01", poster_path: "/poster.jpg", media_type: "movie", vote_average: 7.8 }] };
  } else if (requestUrl.includes("/trending/tv/week")) {
    body = { results: [{ id: 22, name: "Mock Show", first_air_date: "2022-01-01", media_type: "tv", vote_average: 8.2 }] };
  } else if (requestUrl.includes("/movie/popular") || requestUrl.includes("/tv/popular")) {
    body = { results: [] };
  } else if (requestUrl.includes("/search/multi")) {
    body = { results: [{ id: 11, title: "Mock Film", release_date: "2024-01-01", media_type: "movie" }] };
  } else if (requestUrl.includes("/tv/22?")) {
    body = { id: 22, name: "Mock Show", first_air_date: "2022-01-01", number_of_seasons: 1, external_ids: { imdb_id: "tt222" }, genres: [{ name: "Drama" }] };
  } else if (requestUrl.includes("/tv/22/season/1")) {
    body = { episodes: [{ episode_number: 1, name: "Pilot", air_date: "2022-01-02" }] };
  } else if (requestUrl.includes("/manifest.json")) {
    body = { id: "mock-addon", resources: ["stream"] };
  } else if (requestUrl.includes("/stream/series/tt222%3A1%3A1.json")) {
    body = { streams: [{ name: "Mock Add-on", title: "1080p", url: "https://cdn.example/video.m3u8", behaviorHints: { proxyHeaders: { request: { Referer: "https://addon.example/" } } } }] };
  }

  return { status: 200, body: JSON.stringify(body) };
};

const provider = require("../providers/tmdb-stremio.js");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "index.json"), "utf8"));
const source = manifest.sources.find((item) => item.id === "tmdb-stremio");

async function main() {
  assert.ok(source, "TMDB + Stremio must be registered in index.json");
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo, "provider and manifest logos should stay in sync");

  const settings = provider.getSettings();
  assert.deepEqual(settings.map((setting) => setting.key), ["tmdbApiKey", "addonUrls", "maxStreamsPerAddon"]);
  assert.ok(settings.every((setting) => setting.description && setting.label));
  assert.equal(provider._combinedSettings().max, 10);
  assert.deepEqual(provider._parseAddonUrls(global.__settings["tmdb-stremio"].addonUrls).map(provider._manifestUrl), [
    "https://addon.example/manifest.json?token=secret",
    "https://second.example/manifest.json",
  ]);

  const home = await provider.getHome({});
  assert.equal(home.length, 2);
  assert.equal(home[0].items[0].tmdbId, 11);
  assert.equal(home[1].items[0].tmdbIsTv, true);

  const search = await provider.search("Mock", 1, {});
  assert.equal(search[0].title, "Mock Film (2024)");

  const detail = await provider.getDetail("tmdb://tv/22", {});
  assert.equal(detail.tmdbId, 22);
  assert.equal(detail.tmdbIsTv, true);
  assert.equal(detail.imdbId, "tt222");
  assert.equal(detail.episodes.length, 1);

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/video.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].headers.Referer, "https://addon.example/");
  assert.equal(await provider.getStreams(detail.episodes[0].url, {}).then((rows) => rows.length), 1);

  const tmdbCalls = calls.filter((url) => url.includes("themoviedb.org"));
  assert.ok(tmdbCalls.length > 0);
  assert.ok(tmdbCalls.every((url) => url.includes("api_key=test-user-key")));
  const addOnCalls = calls.filter((url) => url.includes("addon.example") || url.includes("second.example"));
  assert.ok(addOnCalls.length > 0);
  assert.ok(addOnCalls.every((url) => !url.includes("test-user-key")));
  assert.ok(addOnCalls.some((url) => url.includes("?token=secret")));

  global.__settings["tmdb-stremio"].tmdbApiKey = "";
  assert.ok(provider._tmdbRequestUrl("/trending/movie/week").startsWith("https://api.themoviedb.org/3/"));
  console.log("TMDB + Stremio combined provider tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
