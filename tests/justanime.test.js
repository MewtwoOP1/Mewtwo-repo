const assert = require("node:assert/strict");

// Exercise the provider's final detail-normalization error path. Normal
// descriptions are stripped as the host runtime's htmlText helper would do;
// one sentinel deliberately throws to emulate an unexpected malformed payload.
global.htmlText = function (value) {
  const text = String(value || "");
  if (text === "__FORCE_DETAIL_PARSE_ERROR__") throw new Error("synthetic detail normalization failure");
  return text.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
};

const calls = [];
const transientFailures = new Map();
const deadUrls = new Set([
  "https://core.justanime.to/api/anime/24",
  "https://core.justanime.to/api/anime/24/episodes?page=1",
  "https://core.justanime.to/api/anime/25",
  "https://core.justanime.to/api/anime/25/episodes?page=1"
]);
global.__settings = { justanime: { servers: "all", language: "sub" } };
global.fetch = async (url, options) => {
  const u = String(url);
  calls.push({ url: u, options: options || {} });
  if (deadUrls.has(u)) {
    return { status: 503, body: JSON.stringify({ error: "upstream down" }) };
  }
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
    body = { results: [{ id: 21, idMal: "999", anilistId: "777", title: { english: "Mock Anime", romaji: "Mock Anime Romaji" }, cover: "https://img.example/mock.jpg" }] };
  } else if (u === "https://core.justanime.to/api/search?query=Card%20Only&page=1") {
    body = { results: [{ id: 24, title: { english: "Card Only Anime", romaji: "Card Only Anime" }, cover: "https://img.example/card-only.jpg" }] };
  } else if (u === "https://core.justanime.to/api/search?query=Real%20Shape&page=1") {
    // The live search/home payload shape: only `id` (the AniList ID) — no
    // `anilistId` and no `idMal` field is ever sent for list items.
    body = { results: [{ id: 154587, title: { english: "Real Shape Anime", romaji: "Real Shape Romaji" }, cover: "https://img.example/real.jpg" }] };
  } else if (u === "https://core.justanime.to/api/search?query=Malformed%20Ids&page=1") {
    // Invalid-but-present alias fields must not suppress the valid catalogue id.
    body = { results: [{ id: 987654, anilistId: "", anilist_id: "0", idMal: "", malId: "52991",
      title: { english: "Malformed IDs", romaji: "Malformed IDs" }, cover: "https://img.example/malformed.jpg" }] };
  } else if (u === "https://core.justanime.to/api/search?query=Parse%20Error&page=1") {
    body = { results: [{ id: 26, anilistId: 777, idMal: 888,
      title: { english: "Parse Error Anime", romaji: "Parse Error Anime Romaji" },
      cover: "https://img.example/parse-error.jpg" }] };
  } else if (u === "https://core.justanime.to/api/anime/26") {
    body = { data: { id: 26, idMal: 888, title: { english: "Parse Error Anime" },
      coverImage: { extraLarge: "https://img.example/parse-error.jpg" },
      description: "__FORCE_DETAIL_PARSE_ERROR__", episodes: 1, status: "RELEASING" } };
  } else if (u === "https://core.justanime.to/api/anime/26/episodes?page=1") {
    body = { data: { episodes: [{ number: 1, title: "Parse Error Episode 1" }] } };
  } else if (u === "https://core.justanime.to/api/anime/154587") {
    // Regression fixture: the AniList ID is deliberately a distinct, large value.
    // It must be passed to JustAnime endpoints verbatim; no +/- offsets are valid.
    body = { data: { id: 154587, idMal: 52991, title: { english: "Real Shape Anime", romaji: "Real Shape Romaji" }, coverImage: { extraLarge: "https://img.example/real.jpg" }, description: "Exact ID test", genres: ["Action"], episodes: 2, seasonYear: 2026, status: "RELEASING" } };
  } else if (u === "https://core.justanime.to/api/anime/154587/episodes?page=1") {
    body = { data: { episodes: [
      { number: 1, title: "Real Shape Episode 1" },
      { number: 2, title: "Real Shape Episode 2" }
    ] } };
  } else if (u === "https://core.justanime.to/api/anime/198966") {
    // The live detail payload shape: AniList schema — `id` plus a separate
    // `idMal`, and no `anilistId` field.
    body = { data: { id: 198966, idMal: 62516, title: { english: "Detail Only Anime", romaji: "Detail Only Anime" }, coverImage: { extraLarge: "https://img.example/detail-only.jpg" }, description: "<p>Detail only</p>", genres: ["Action"], episodes: 2, seasonYear: 2026, status: "RELEASING" } };
  } else if (u === "https://core.justanime.to/api/anime/198966/episodes?page=1") {
    body = { data: { episodes: [
      { number: 1, title: "Detail Only Ep 1" },
      { number: 2, title: "Detail Only Ep 2" }
    ] } };
  } else if (u === "https://core.justanime.to/api/anime/987655") {
    // Detail APIs may serialize identifier fields as strings or invalid aliases.
    body = { data: { id: 987655, anilistId: "", anilist_id: "not-an-id", idMal: "52991",
      title: { english: "String ID Anime", romaji: "String ID Anime" },
      description: "ID normalization fixture", episodes: 1, status: "FINISHED" } };
  } else if (u === "https://core.justanime.to/api/anime/987655/episodes?page=1") {
    body = { data: { episodes: [{ number: 1, title: "Episode One" }] } };
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
  } else if (u === "https://core.justanime.to/api/anime/23") {
    body = { data: { id: 23, title: { english: "Count Fallback Anime" }, episodes: 3 } };
  } else if (u === "https://core.justanime.to/api/anime/23/episodes?page=1") {
    body = { data: { episodes: [] } };
  } else if (u === "https://core.justanime.to/api/watch/154587/episode/2/anineko") {
    body = { langs: { sub: [{ server: "hd1" }], dub: [] } };
  } else if (u === "https://core.justanime.to/api/watch/154587/episode/2/anineko/sub/hd1") {
    body = { sources: [{ url: "https://cdn.example/exact-id-154587.m3u8", quality: "1080p", isM3U8: true }], headers: { Referer: "https://justanime.to/" }, subtitles: [] };
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
  assert.equal(provider.version, "1.9.5");
  assert.equal(provider.getInfo().version, "1.9.5");

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
  // Home items carry only the AniList catalogue ID: it must surface as
  // anilistId (malId genuinely absent from list payloads stays null).
  assert.equal(home[0].items[0].anilistId, 21);
  assert.equal(home[0].items[0].malId, null);

  const search = await provider.search("Mock Anime", 1, {});
  assert.equal(search[0].id, "21");
  assert.equal(search[0].type, "anime");
  assert.equal(search[0].malId, 999);
  assert.equal(search[0].anilistId, 777, "an explicit anilistId field still wins over the catalogue id");
  assert.equal(search[0].englishTitle, "Mock Anime Romaji");

  const realShape = await provider.search("Real Shape", 1, {});
  assert.equal(realShape[0].id, "154587");
  assert.equal(realShape[0].anilistId, 154587, "list payloads send only `id`, which is the AniList ID");
  assert.equal(realShape[0].malId, null);

  const malformedIds = await provider.search("Malformed Ids", 1, {});
  assert.equal(malformedIds[0].id, "987654");
  assert.equal(malformedIds[0].anilistId, 987654,
    "empty or zero AniList aliases must fall back to the valid catalogue id");
  assert.equal(malformedIds[0].malId, 52991,
    "an invalid idMal field must not hide a valid alternate MAL id");

  const detail = await provider.getDetail("https://justanime.to/anime/21/mock-anime", {});
  assert.equal(detail.title, "Mock Anime");
  assert.equal(detail.malId, 999);
  assert.equal(detail.anilistId, 777, "detail should preserve AniList ID from search when detail endpoint omits it");
  assert.equal(detail.episodes.length, 2);
  assert.deepEqual(detail.episodes.map((ep) => ep.number), [1, 2], "episodes must be ascending for Z Mode canonical mapping");
  assert.equal(detail.episodes[0].url, "21||1");
  assert.equal(detail.episodes[0].title, "The Beginning");
  assert.equal(detail.episodes[0].thumbnail, "https://img.example/ep1.jpg");
  assert.equal(detail.episodes[1].title, "The Journey");
  assert.equal(detail.description, "A test anime");

  const fallbackDetail = await provider.getDetail("https://justanime.to/anime/22/fallback-anime", {});
  assert.equal(fallbackDetail.title, "Fallback Anime");
  assert.equal(fallbackDetail.episodes.length, 2);
  assert.deepEqual(fallbackDetail.episodes.map((ep) => ep.number), [1, 2]);
  assert.equal(fallbackDetail.episodes[0].title, "A Real Episode Title");
  assert.equal(fallbackDetail.episodes[0].description, "Episode synopsis");
  assert.equal(fallbackDetail.episodes[0].thumbnail, "https://img.example/fallback-ep.jpg");
  assert.equal(fallbackDetail.episodes[1].title, "Another Real Title");

  const countFallback = await provider.getDetail("https://justanime.to/anime/23/count-fallback-anime", {});
  assert.deepEqual(countFallback.episodes.map((ep) => ep.number), [1, 2, 3], "count-only fallback must be ascending");
  assert.deepEqual(countFallback.episodes.map((ep) => ep.url), ["23||1", "23||2", "23||3"]);

  // A detail opened without any preceding search/home card: the payload's
  // own `id` is the AniList ID and `idMal` the MAL ID — both must ship.
  // Exact AniList-ID passthrough regression: do not add/subtract one or
  // otherwise transform the API ID between catalogue, detail, episodes and streams.
  const exactDetail = await provider.getDetail("https://justanime.to/anime/154587/real-shape-anime", {});
  assert.equal(exactDetail.id, "154587");
  assert.equal(exactDetail.anilistId, 154587);
  assert.equal(exactDetail.malId, 52991);
  assert.equal(exactDetail.episodes[1].url, "154587||2");
  const exactStreams = await provider.getVideoSources(exactDetail.episodes[1].url, {});
  assert.equal(exactStreams.length, 1);
  assert.equal(exactStreams[0].url, "https://cdn.example/exact-id-154587.m3u8");
  assert.ok(calls.some((c) => c.url === "https://core.justanime.to/api/anime/154587"));
  assert.ok(calls.some((c) => c.url === "https://core.justanime.to/api/anime/154587/episodes?page=1"));
  assert.ok(calls.some((c) => c.url === "https://core.justanime.to/api/watch/154587/episode/2/anineko"));
  assert.ok(calls.some((c) => c.url === "https://core.justanime.to/api/watch/154587/episode/2/anineko/sub/hd1"));
  assert.ok(!calls.some((c) => /\/watch\/(?:154586|154588)\//.test(c.url)),
    "no -1/+1 ID mutation may appear in the stream request");

  // The search result already established this show's identity. If detail
  // normalization unexpectedly throws, keep the known title and IDs instead
  // of returning null (which makes the app treat the whole detail as failed).
  const parseErrorSearch = await provider.search("Parse Error", 1, {});
  assert.equal(parseErrorSearch[0].id, "26");
  const parseErrorDetail = await provider.getDetail("26", {});
  assert.ok(parseErrorDetail, "a parser exception must not erase a previously matched title");
  assert.equal(parseErrorDetail.title, "Parse Error Anime");
  assert.equal(parseErrorDetail.cover, "https://img.example/parse-error.jpg");
  assert.equal(parseErrorDetail.malId, 888);
  assert.equal(parseErrorDetail.anilistId, 777);
  assert.deepEqual(parseErrorDetail.episodes, [],
    "when source detail parsing fails, omit source episodes rather than guessing numbering");

  const stringIdDetail = await provider.getDetail("987655", {});
  assert.equal(stringIdDetail.anilistId, 987655,
    "detail must fall back to the valid catalogue id when alias fields are invalid");
  assert.equal(stringIdDetail.malId, 52991,
    "numeric-string MAL ids must be normalized to numbers for the app model");

  const detailOnly = await provider.getDetail("https://justanime.to/anime/198966/detail-only-anime", {});
  assert.equal(detailOnly.title, "Detail Only Anime");
  assert.equal(detailOnly.anilistId, 198966, "detail should derive AniList ID from the payload id when no card/detail field supplies it");
  assert.equal(detailOnly.malId, 62516);
  assert.equal(detailOnly.episodes.length, 2);

  // Both detail endpoints down, but search already resolved the title in
  // this session: getDetail must fall back to the cached card (empty
  // episode list), NOT return null — a null result throws in the app's JS
  // bridge ("getDetail returned null") and fails the whole detail screen,
  // which in Z Mode is reported as an AniList failure with a dead Play
  // button even though the title was known.
  const cardSearch = await provider.search("Card Only", 1, {});
  assert.equal(cardSearch[0].id, "24");
  const cardOnly = await provider.getDetail("24", {});
  assert.ok(cardOnly, "detail should fall back to the cached card when both endpoints fail");
  assert.equal(cardOnly.title, "Card Only Anime");
  assert.equal(cardOnly.anilistId, 24);
  assert.deepEqual(cardOnly.episodes, []);

  // Both endpoints down and nothing known about the title: null stays the
  // honest answer.
  const unknown = await provider.getDetail("25", {});
  assert.equal(unknown, null);

  const episodeFetchCount = calls.filter((c) => c.url === "https://core.justanime.to/api/anime/21/episodes?page=1").length;
  const listedEpisodes = await provider.getEpisodes("21", {});
  assert.equal(listedEpisodes.length, 2);
  assert.equal(calls.filter((c) => c.url === "https://core.justanime.to/api/anime/21/episodes?page=1").length, episodeFetchCount,
    "getEpisodes should reuse the successful cached detail instead of refetching the endpoint");

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
