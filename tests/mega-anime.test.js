const assert = require("node:assert/strict");
const provider = require("../providers/mega-anime.js");

const ANILIST = "https://graphql.anilist.co";
const ANI_WAVES = "https://aniwaves.ru";
const ANI_NAMI = "https://www.aninami.site";
const calls = [];
let scenario = {};

function response(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text), body: text };
}
function media(overrides) {
  return Object.assign({
    id: 42, idMal: 123, title: { romaji: "Solo Leveling", english: "Solo Leveling", native: "Solo Leveling" },
    coverImage: { extraLarge: "https://img.example/solo-xl.jpg", large: "https://img.example/solo-lg.jpg" },
    description: "A hunter fights monsters.", status: "RELEASING", genres: ["Action", "Fantasy"],
    studios: { nodes: [{ name: "A-1 Pictures" }] }, episodes: 3, format: "TV",
    averageScore: 85, seasonYear: 2024, nextAiringEpisode: null
  }, overrides || {});
}
function baseScenario() {
  return {
    anilistSearch: () => response(200, { data: { Page: { media: [media(), media({ id: 99, title: { romaji: "Solo Leveling Movie", english: "Solo Leveling Movie" }, format: "MOVIE", episodes: 1 })] } } }),
    anilistDetail: id => response(200, { data: { Media: id === 99 ? media({ id: 99, title: { romaji: "Solo Leveling Movie", english: "Solo Leveling Movie" }, format: "MOVIE", episodes: 1 }) : media() } }),
    anilistHome: () => response(200, { data: { Page: { media: [media()] } } }),
    waveSearch: () => response(200, '<div class="ani items"><div class="item"><div class="info"><a href="/solo-leveling-42"><img src="/poster.jpg" alt="Solo Leveling Poster"></a><a class="name" href="/solo-leveling-42">Solo Leveling</a></div></div></div>'),
    waveWatch: () => response(200, '<div id="watch-main" data-id="700"></div>'),
    waveEpisodes: () => response(200, { status: 200, result: '<li><a data-num="1" data-sub="1" data-dub="0" data-ids="srv%3A1&amp;x%3D2"></a></li>' }),
    waveServers: () => response(200, { status: 200, result: '<div class="type" data-type="sub"><ul><li data-link-id="link-11">VidPlay</li><li data-link-id="link-12">Mirror</li></ul></div>' }),
    waveSource: id => response(200, { status: 200, result: { url: id === "link-11" ? "https://vidtube.site/embed/abc" : "https://cdn.example/wave.m3u8" } }),
    aninamiEpisodes: () => response(200, { success: true, results: { providers: {
      vidtube: { episodes: { sub: [{ id: "watch/vidtube/42/sub/solo-leveling-1", number: 1, title: "Episode 1" }], dub: [{ id: "watch/vidtube/42/dub/solo-leveling-1", number: 1 }] } }
    } } }),
    aninamiWatch: () => response(200, { success: true, results: { streams: [
      { url: "https://cdn.example/nami.m3u8", type: "hls", quality: "1080p", server: "VidTube", referer: "https://www.aninami.site/" },
      { url: "https://cdn.example/movie.mp4", type: "mp4", quality: "720p", server: "Mirror", referer: "https://www.aninami.site/" }
    ] } }),
    extract: () => [{ url: "https://cdn.example/extracted.m3u8", container: "hls", kind: "video", quality: "auto" }]
  };
}
function reset() { calls.length = 0; scenario = baseScenario(); }

global.fetch = async function (url, options) {
  const u = String(url); options = options || {}; calls.push({ url: u, options });
  if (u === ANILIST) {
    const q = JSON.parse(options.body), v = q.variables || {};
    if (Object.prototype.hasOwnProperty.call(v, "search")) return scenario.anilistSearch(v.search);
    if (Object.prototype.hasOwnProperty.call(v, "id")) return scenario.anilistDetail(v.id);
    if (Object.prototype.hasOwnProperty.call(v, "sort")) return scenario.anilistHome(v.sort[0]);
  }
  if (u.startsWith(ANI_WAVES + "/filter?keyword=")) return scenario.waveSearch();
  if (u === ANI_WAVES + "/solo-leveling-42") return scenario.waveWatch();
  if (u === ANI_WAVES + "/ajax/episode/list/700") return scenario.waveEpisodes();
  if (u.startsWith(ANI_WAVES + "/ajax/server/list?servers=")) return scenario.waveServers();
  if (u.startsWith(ANI_WAVES + "/ajax/sources?id=")) {
    const id = new URL(u).searchParams.get("id");
    return scenario.waveSource(id);
  }
  if (u === ANI_NAMI + "/api/episodes/42") return scenario.aninamiEpisodes();
  if (u.startsWith(ANI_NAMI + "/api/watch/")) return scenario.aninamiWatch();
  return response(404, "not found");
};
global.extractVideo = (url, opts) => scenario.extract(url, opts);

async function main() {
  reset();
  assert.equal(provider.version, "1.0.2");
  assert.equal(provider.getInfo().version, "1.0.2");
  assert.equal(provider.getInfo().name, "Mega-Anime");
  assert.deepEqual(provider.getSettings(), []);
  assert.equal(provider.getStreams, provider.getVideoSources);

  const found = await provider.search("Solo Leveling", 1, {});
  assert.equal(found.length, 2);
  assert.equal(found[0].id, "anilist:42");
  assert.equal(found[1].type, "movie");

  reset();
  const home = await provider.getHome({});
  assert.equal(home.length, 3);
  assert.equal(home[0].items.length, 1);

  reset();
  const detail = await provider.getDetail("anilist:42");
  assert.equal(detail.title, "Solo Leveling");
  assert.equal(detail.episodes.length, 3);
  assert.equal(detail.malId, 123);
  assert.equal((await provider.getEpisodes("anilist:42")).length, 3);

  // Never extract arbitrary digits or alter an AniList ID with +/- offsets.
  reset();
  assert.equal(await provider.getDetail("anilist:+42"), null);
  assert.equal(await provider.getDetail("anilist:-42"), null);
  assert.equal(await provider.getDetail("unrelated-title-42"), null);
  assert.equal(await provider.getDetail("anilist:0"), null);
  assert.equal(calls.length, 0, "malformed detail IDs must not be sent to AniList");

  reset();
  const streams = await provider.getVideoSources("mega-anime:42:1:sub");
  assert.ok(streams.some(s => s.url === "https://cdn.example/wave.m3u8"), "AniWaves server->source route should resolve direct media URL");
  assert.ok(streams.some(s => s.url === "https://cdn.example/nami.m3u8"), "AniNami API watch endpoint should resolve HLS");
  assert.ok(streams.some(s => s.url === "https://cdn.example/movie.mp4"), "AniNami direct MP4 should be preserved");
  assert.ok(streams.some(s => s.url === "https://cdn.example/extracted.m3u8"), "AniWaves embed should be delegated to extractVideo");
  assert.ok(calls.some(c => c.url === ANI_WAVES + "/filter?keyword=Solo%20Leveling"));
  assert.ok(calls.some(c => c.url === ANI_WAVES + "/ajax/episode/list/700"));
  assert.ok(calls.some(c => c.url.startsWith(ANI_WAVES + "/ajax/server/list?servers=")));
  assert.ok(calls.some(c => c.url.startsWith(ANI_WAVES + "/ajax/sources?id=")));
  assert.ok(calls.some(c => c.url === ANI_NAMI + "/api/episodes/42"));
  assert.ok(calls.some(c => c.url === ANI_NAMI + "/api/watch/vidtube/42/sub/solo-leveling-1"));
  assert.ok(streams.every(s => s.headers && s.headers.Referer), "streams should carry Referer headers");

  reset();
  scenario.aninamiEpisodes = () => response(200, { success: true, results: { providers: {} } });
  const waveOnly = await provider.getVideoSources("mega-anime:42:1:sub");
  assert.ok(waveOnly.some(s => s.url === "https://cdn.example/wave.m3u8"), "AniNami empty results must not suppress AniWaves");
  assert.ok(!waveOnly.some(s => s.url === "https://cdn.example/nami.m3u8"));

  reset();
  scenario.waveSearch = () => response(503, "unavailable");
  const namiOnly = await provider.getVideoSources("mega-anime:42:1:sub");
  assert.ok(namiOnly.some(s => s.url === "https://cdn.example/nami.m3u8"), "AniWaves failure must not suppress AniNami");

  reset();
  for (const invalid of [
    "not-an-episode",
    "mega-anime:+42:1:sub",
    "mega-anime:-42:1:sub",
    "mega-anime:42:+1:sub",
    "mega-anime:42:-1:sub",
    "mega-anime:0:1:sub",
    "mega-anime:42:1:other"
  ]) {
    assert.deepEqual(await provider.getVideoSources(invalid), [], "should reject " + invalid);
  }
  assert.equal(calls.length, 0, "signed/invalid IDs must not trigger AniList requests");

  reset();
  scenario.anilistDetail = () => response(200, { errors: [{ message: "offline" }] });
  assert.deepEqual(await provider.getVideoSources("mega-anime:42:1:sub"), []);

  reset();
  scenario.aninamiEpisodes = () => response(200, { results: { providers: { vidtube: { episodes: { dub: [{ id: "watch/vidtube/42/dub/solo-leveling-1", number: 1 }] } } } } });
  const dub = await provider.getVideoSources("mega-anime:42:1:dub");
  assert.ok(dub.length > 0);
  assert.ok(dub.every(s => s.kind === "dub"));

  console.log("Mega-Anime tests passed: metadata, real AniWaves/AniNami route shapes, header propagation, sub/dub selection and source isolation.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
