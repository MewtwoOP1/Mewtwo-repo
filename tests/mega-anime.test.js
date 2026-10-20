const assert = require("node:assert/strict");
const provider = require("../providers/mega-anime.js");

const ANILIST = "https://graphql.anilist.co";
const ANIWAVES = "https://aniwaves.ru";
const ANINAMI = "https://aninami.me";

const calls = [];
let scenario = {};

function json(status, body) {
  return { status, json: async () => body, body: JSON.stringify(body) };
}

function fail(status) {
  return { status, json: async () => ({}), body: "" };
}

function media(overrides) {
  return Object.assign({
    id: 42,
    title: {
      romaji: "Solo Leveling",
      english: "Solo Leveling",
      native: "俺だけレベルアップな件"
    },
    coverImage: {
      extraLarge: "https://img.example/solo-xl.jpg",
      large: "https://img.example/solo-lg.jpg"
    },
    description: "A hunter fights monsters.",
    status: "RELEASING",
    genres: ["Action", "Fantasy"],
    studios: { nodes: [{ name: "A-1 Pictures" }] },
    episodes: 3,
    format: "TV",
    averageScore: 85,
    seasonYear: 2024,
    nextAiringEpisode: null
  }, overrides || {});
}

global.fetch = async function (url, options) {
  const u = String(url);
  calls.push({ url: u, options: options || {} });

  if (u === ANILIST) {
    const payload = JSON.parse(options.body);
    const v = payload.variables || {};
    if (Object.prototype.hasOwnProperty.call(v, "search")) {
      return scenario.anilistSearch(v.search);
    }
    if (Object.prototype.hasOwnProperty.call(v, "id")) {
      return scenario.anilistDetail(v.id);
    }
    if (Object.prototype.hasOwnProperty.call(v, "sort")) {
      return scenario.anilistHome(v.sort[0]);
    }
  }

  if (u.startsWith(ANIWAVES + "/api/search")) return scenario.aniwavesSearch();
  if (u.startsWith(ANIWAVES + "/api/anime/")) return scenario.aniwavesEpisode();
  if (u.startsWith(ANINAMI + "/api/search")) return scenario.aninamiSearch();
  if (u.startsWith(ANINAMI + "/api/anime/")) return scenario.aninamiEpisode();

  return fail(404);
};

global.extractVideo = function (url, opts) {
  if (scenario.extract) return scenario.extract(url, opts);
  return [];
};

function baseScenario() {
  return {
    anilistSearch: () => json(200, {
      data: {
        Page: {
          media: [
            media(),
            media({
              id: 99,
              title: { romaji: "Solo Leveling Movie", english: "Solo Leveling Movie" },
              format: "MOVIE",
              episodes: 1
            })
          ]
        }
      }
    }),
    anilistDetail: (id) => json(200, {
      data: {
        Media: id === 99
          ? media({
              id: 99,
              title: { romaji: "Solo Leveling Movie", english: "Solo Leveling Movie" },
              format: "MOVIE",
              episodes: 1
            })
          : media()
      }
    }),
    anilistHome: () => json(200, { data: { Page: { media: [media()] } } }),
    aniwavesSearch: () => json(200, {
      results: [{ title: "Solo Leveling", slug: "solo-leveling" }]
    }),
    aniwavesEpisode: () => json(200, {
      servers: [
        { url: "https://cdn.example/aniwaves-1.m3u8", quality: "720p" },
        { url: "https://vidtube.site/stream/abc", quality: "auto" }
      ]
    }),
    aninamiSearch: () => json(200, {
      data: [{ title: "Solo Leveling", id: "solo-leveling" }]
    }),
    aninamiEpisode: () => json(200, {
      sources: [
        { file: "https://cdn.example/aninami-1.m3u8", quality: "1080p" },
        { file: "https://cdn.example/aniwaves-1.m3u8", quality: "720p" }
      ]
    }),
    extract: () => [{
      url: "https://cdn.example/extracted.m3u8",
      container: "hls",
      kind: "video",
      quality: "auto"
    }]
  };
}

function reset() {
  calls.length = 0;
  scenario = baseScenario();
}

async function main() {
  reset();

  // contract
  assert.equal(provider.version, "1.0.0");
  assert.equal(provider.getInfo().name, "Mega-Anime");
  assert.equal(provider.getInfo().version, "1.0.0");
  assert.equal(provider.getInfo().type, "anime");
  assert.equal(provider.getInfo().lang, "en");
  assert.deepEqual(provider.getSettings(), []);
  assert.equal(provider.getStreams, provider.getVideoSources);

  // search + movie type
  const found = await provider.search("Solo Leveling", 1, {});
  assert.equal(found.length, 2);
  assert.equal(found[0].id, "anilist:42");
  assert.equal(found[0].title, "Solo Leveling");
  assert.equal(found[0].type, "anime");
  assert.equal(found[1].type, "movie");

  // empty search
  reset();
  scenario.anilistSearch = () => json(200, { data: { Page: { media: [] } } });
  assert.deepEqual(await provider.search("", 1, {}), []);

  // AniList search failure is isolated
  reset();
  scenario.anilistSearch = () => json(200, { errors: [{ message: "boom" }] });
  assert.deepEqual(await provider.search("Solo Leveling", 1, {}), []);

  // home
  reset();
  const home = await provider.getHome({});
  assert.equal(home.length, 3);
  assert.equal(home[0].title, "Trending Now");
  assert.equal(home[0].items.length, 1);
  assert.equal(home[0].items[0].id, "anilist:42");

  // detail + episodes
  reset();
  const detail = await provider.getDetail("anilist:42");
  assert.equal(detail.title, "Solo Leveling");
  assert.equal(detail.type, "anime");
  assert.equal(detail.episodes.length, 3);
  assert.deepEqual(detail.episodes.map((e) => e.number), [1, 2, 3]);
  assert.ok(detail.episodes.every((e) => e.id.endsWith(":sub")));
  assert.ok(detail.episodes.every((e) => !("dub" in e)));

  // movie detail
  reset();
  const movie = await provider.getDetail("anilist:99");
  assert.equal(movie.type, "movie");

  // invalid detail
  assert.equal(await provider.getDetail("nope"), null);

  // getEpisodes
  reset();
  const episodes = await provider.getEpisodes("anilist:42");
  assert.equal(episodes.length, 3);

  // video sources: aggregation + dedupe
  reset();
  const streams = await provider.getVideoSources("mega-anime:42:1:sub");
  assert.equal(streams.length, 3);
  assert.equal(
    streams.filter((s) => s.url === "https://cdn.example/aniwaves-1.m3u8").length,
    1,
    "duplicate URL+quality should be removed"
  );

  const aniwaves = streams.find((s) => s.url === "https://cdn.example/aniwaves-1.m3u8");
  const aninami = streams.find((s) => s.url === "https://cdn.example/aninami-1.m3u8");
  const extracted = streams.find((s) => s.url === "https://cdn.example/extracted.m3u8");
  assert.ok(aniwaves);
  assert.ok(aninami);
  assert.ok(extracted);
  assert.equal(aniwaves.container, "hls");
  assert.equal(aniwaves.headers.Referer, ANIWAVES + "/");
  assert.equal(aninami.container, "hls");

  // source isolation: AniWaves fails
  reset();
  scenario.aniwavesSearch = () => fail(500);
  const isolated = await provider.getVideoSources("mega-anime:42:1:sub");
  assert.equal(isolated.length, 2);
  assert.ok(isolated.every((s) => !s.url.includes("extracted")));

  // source isolation: AniNami fails
  reset();
  scenario.aninamiSearch = () => fail(500);
  const isolated2 = await provider.getVideoSources("mega-anime:42:1:sub");
  assert.equal(isolated2.length, 2);
  assert.ok(isolated2.some((s) => s.url === "https://cdn.example/aniwaves-1.m3u8"));
  assert.ok(isolated2.some((s) => s.url === "https://cdn.example/extracted.m3u8"));

  // direct MP4
  reset();
  scenario.aniwavesEpisode = () => json(200, {
    servers: [{ url: "https://cdn.example/video.mp4", quality: "480p" }]
  });
  scenario.aninamiSearch = () => fail(404);
  const mp4 = await provider.getVideoSources("mega-anime:42:1:sub");
  assert.equal(mp4.length, 1);
  assert.equal(mp4[0].container, "mp4");

  // invalid episode URL
  assert.deepEqual(await provider.getVideoSources("bad"), []);

  // AniList detail failure is isolated
  reset();
  scenario.anilistDetail = () => json(200, { errors: [{ message: "down" }] });
  assert.deepEqual(await provider.getVideoSources("mega-anime:42:1:sub"), []);

  // no source results
  reset();
  scenario.aniwavesSearch = () => json(200, { results: [] });
  scenario.aninamiSearch = () => json(200, { data: [] });
  assert.deepEqual(await provider.getVideoSources("mega-anime:42:1:sub"), []);

  console.log("Mega-Anime mocked integration tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
