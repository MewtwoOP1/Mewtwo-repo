const assert = require("node:assert/strict");

const calls = [];
const transientFailures = new Map();
global.__settings = { justanime: { servers: "all", language: "sub" } };
global.fetch = async (url, options) => {
  const u = String(url);
  calls.push({ url: u, options: options || {} });
  const remainingFailures = transientFailures.get(u) || 0;
  if (remainingFailures > 0) {
    transientFailures.set(u, remainingFailures - 1);
    return { status: 503, body: JSON.stringify({ error: "temporary upstream failure" }) };
  }
  let body = {};
  if (u === "https://core.justanime.to/api/home") {
    body = { latestEpisode: [{ id: 21, title: { english: "Mock Anime", romaji: "Mock Anime" }, cover: "https://img.example/mock.jpg" }] };
  } else if (u === "https://core.justanime.to/api/search?page=1") {
    body = { results: [{ id: 21, title: { english: "Mock Anime" }, cover: "https://img.example/mock.jpg" }], pageInfo: { hasNextPage: true } };
  } else if (u === "https://core.justanime.to/api/search?query=Mock%20Anime&page=1" ||
             u === "https://core.justanime.to/api/search?query=Retry%20Anime&page=1") {
    body = { results: [{ id: 21, idMal: "999", title: { english: "Mock Anime", romaji: "Mock Anime Romaji" }, cover: "https://img.example/mock.jpg" }] };
  } else if (u === "https://core.justanime.to/api/anime/21") {
    body = { data: { id: 21, idMal: 999, title: { english: "Mock Anime", romaji: "Mock Anime" }, coverImage: { extraLarge: "https://img.example/mock.jpg" }, description: "<p>A test anime</p>", genres: ["Action"], episodes: 2, seasonYear: 2024, status: "FINISHED" } };
  } else if (u === "https://core.justanime.to/api/anime/21/episodes?page=1") {
    body = { data: { episodes: [
      { number: 1, title: "The Beginning", thumbnail: "https://img.example/ep1.jpg" },
      { number: 2, title: "The Journey", thumbnail: "https://img.example/ep2.jpg" }
    ] } };
  } else if (u === "https://core.justanime.to/api/anime/22") {
    body = { data: { id: 22, title: { english: "Fallback Anime" }, episodes: [
      { number: 1, title: "A Real Episode Title", description: "Episode synopsis", thumbnail: "https://img.example/fallback-ep.jpg" },
      { number: 2, title: { english: "Another Real Title" }, episodeNumber: 2 }
    ] } };
  } else if (u === "https://core.justanime.to/api/anime/22/episodes?page=1") {
    body = { data: { episodes: [] } };
  } else if (u === "https://core.justanime.to/api/watch/21/episode/2/anineko/sub/hd1") {
    body = { sources: [{ url: "https://cdn.example/mock-1080p.m3u8", quality: "1080p", isM3U8: true }], headers: { Referer: "https://justanime.to/" }, subtitles: [] };
  } else if (u === "https://core.justanime.to/api/watch/21/episode/2/anineko/dub/hd1") {
    body = { sources: [{ url: "https://cdn.example/play?id=opaque123", quality: "720p", isM3U8: true }] };
  } else if (u === "https://core.justanime.to/api/watch/21/episode/2/megaplay") {
    body = { sub: { sources: [{ url: "https://cdn.example/mock-1080p.m3u8", quality: "1080p", isM3U8: true }], headers: { Referer: "https://megaplay.buzz/" }, subtitles: [{ file: "https://cdn.example/en.vtt", label: "English" }] } };
  } else if (u === "https://core.justanime.to/api/watch/21/episode/2/animegg") {
    body = { dub: { sources: [{ url: "https://cdn.example/play?id=opaque123", quality: "720p", isM3U8: true }] } };
  } else if (u === "https://core.justanime.to/api/watch/21/episode/2/anineko") {
    body = { langs: { sub: [], dub: [] } };
  }
  return { status: 200, body: JSON.stringify(body) };
};

const provider = require("../providers/justanime.js");

async function main() {
  assert.equal(provider.version, "1.6.0");

  // A temporary server error should be retried instead of immediately
  // collapsing into an empty detail/episode response.
  const retryUrl = "https://core.justanime.to/api/search?query=Retry%20Anime&page=1";
  transientFailures.set(retryUrl, 1);
  const retryResults = await provider.search("Retry Anime", 1, {});
  assert.equal(retryResults.length, 1);
  assert.equal(retryResults[0].title, "Mock Anime");
  assert.equal(calls.filter((c) => c.url === retryUrl).length, 2);
  assert.equal(provider.getInfo().name, "JustAnime");
  assert.equal(provider.getInfo().type, "anime");
  assert.deepEqual(provider.getSettings().map((s) => s.key), ["servers", "language"]);
  assert.ok(provider.getSettings().every((s) => s.description && s.label));

  const home = await provider.getHome({});
  assert.equal(home.length, 2);
  assert.equal(home[0].items[0].title, "Mock Anime");
  assert.equal(home[0].items[0].cover, "https://img.example/mock.jpg");

  const search = await provider.search("Mock Anime", 1, {});
  assert.equal(search[0].id, "21");
  assert.equal(search[0].type, "anime");
  assert.equal(search[0].malId, 999);
  assert.equal(search[0].englishTitle, "Mock Anime Romaji");

  const detail = await provider.getDetail("https://justanime.to/anime/21/mock-anime", {});
  assert.equal(detail.title, "Mock Anime");
  assert.equal(detail.malId, 999);
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].url, "21||2");
  assert.equal(detail.episodes[0].title, "The Journey");
  assert.equal(detail.episodes[0].thumbnail, "https://img.example/ep2.jpg");
  assert.equal(detail.description, "A test anime");

  const fallbackDetail = await provider.getDetail("https://justanime.to/anime/22/fallback-anime", {});
  assert.equal(fallbackDetail.title, "Fallback Anime");
  assert.equal(fallbackDetail.episodes.length, 2);
  assert.equal(fallbackDetail.episodes[1].title, "A Real Episode Title");
  assert.equal(fallbackDetail.episodes[1].description, "Episode synopsis");
  assert.equal(fallbackDetail.episodes[1].thumbnail, "https://img.example/fallback-ep.jpg");
  assert.equal(fallbackDetail.episodes[0].title, "Another Real Title");

  const streams = await provider.getVideoSources("21||2", {});
  assert.equal(streams.length, 2);
  assert.equal(streams[0].url, "https://cdn.example/mock-1080p.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].headers.Referer, "https://megaplay.buzz/");
  assert.equal(streams[1].url, "https://cdn.example/play?id=opaque123");
  assert.equal(streams[1].container, "hls");
  assert.ok(calls.every((c) => c.options.headers.Origin === "https://justanime.to"));
  assert.equal(await provider.getStreams("21||2", {}).then((x) => x.length), 2);

  console.log("JustAnime mocked integration tests passed.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
