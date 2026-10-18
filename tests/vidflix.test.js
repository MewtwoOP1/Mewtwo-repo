const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.__settings = { vidflix: { resolverUrl: "https://resolver.example/" } };
const calls = [];
global.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  let body = {};
  if (u.includes("/trending/movie/week")) body = { results: [{ id: 11, title: "Mock Film", release_date: "2024-01-01", poster_path: "/p.jpg", media_type: "movie" }] };
  else if (u.includes("/trending/tv/week")) body = { results: [{ id: 95350, name: "Lanterns", first_air_date: "2026-01-01", media_type: "tv" }] };
  else if (u.includes("/movie/popular") || u.includes("/tv/popular")) body = { results: [] };
  else if (u.includes("/search/multi")) body = { results: [{ id: 95350, name: "Lanterns", first_air_date: "2026-01-01", media_type: "tv" }] };
  else if (u.includes("/tv/95350?")) body = { id: 95350, name: "Lanterns", first_air_date: "2026-01-01", number_of_seasons: 1, external_ids: { imdb_id: "tt1234567" }, genres: [{ name: "Drama" }] };
  else if (u.includes("/tv/95350/season/1")) body = { episodes: [{ episode_number: 1, name: "Pilot", air_date: "2026-08-16" }] };
  else if (u.includes("/api/resolve?")) body = [
    JSON.stringify({ event: "meta", title: "Lanterns", year: "2026" }),
    JSON.stringify({ event: "server", server: { name: "Orbit", ok: true, ms: 21, url: "https://cdn.example/master.m3u8", play: "http://127.0.0.1:7860/api/hls?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8&server=Orbit" } }),
    JSON.stringify({ event: "server", server: { name: "Broken", ok: false } }),
    ""
  ].join("\n");
  return { status: 200, body: typeof body === "string" ? body : JSON.stringify(body) };
};

const provider = require("../providers/vidflix.js");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "index.json"), "utf8"));
const source = manifest.sources.find((item) => item.id === "vidflix");

async function main() {
  assert.ok(source, "VidFlix must be registered in index.json");
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.deepEqual(provider.getSettings().map((s) => s.key), ["resolverUrl"]);
  assert.equal(provider._resolveUrl({ type: "tv", id: 95350, season: 1, episode: 1 }), "https://resolver.example/api/resolve?type=tv&id=95350&season=1&episode=1");
  assert.equal(provider._toAbsolute("/api/hls?url=x"), "https://resolver.example/api/hls?url=x");
  assert.equal(provider._toAbsolute("http://127.0.0.1:7860/api/hls?url=x"), "https://resolver.example/api/hls?url=x");

  const home = await provider.getHome();
  assert.equal(home.length, 2);
  assert.equal(home[1].items[0].tmdbId, 95350);
  const found = await provider.search("Lanterns", 1);
  assert.equal(found[0].tmdbIsTv, true);
  const detail = await provider.getDetail("tmdb://tv/95350");
  assert.equal(detail.title, "Lanterns");
  assert.equal(detail.episodes.length, 1);
  assert.match(detail.episodes[0].url, /"season":1/);

  const streams = await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(streams.length, 1);
  assert.match(streams[0].url, /^https:\/\/resolver\.example\/api\/hls\?/);
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].kind, "raw");
  assert.match(streams[0].label, /VidFlix · VidCore · Orbit/);
  assert.equal(await provider.getStreams(detail.episodes[0].url).then((r) => r.length), 1);
  assert.ok(calls.some((u) => u.includes("/api/resolve?type=tv&id=95350&season=1&episode=1")));
  console.log("VidFlix mocked integration tests passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
