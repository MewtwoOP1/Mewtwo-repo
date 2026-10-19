const assert = require("node:assert/strict");

const TOKEN_OLD = "old.eyJleHAiOjQwMDAwMDAwMDB9.signature";
const TOKEN_NEW = "fresh.eyJleHAiOjQwMDAwMDAwMDB9.signature";
let currentToken = TOKEN_OLD;
let bootstrapCount = 0;
let bootstrapAttempts = 0;
let rejectOldPlayback = false;
const failedDetailIds = new Set();
const calls = [];

const movie = {
  subjectId: "movie-1", title: "Mock Movie", subjectType: 1, releaseDate: "2024-05-01",
  cover: { url: "https://img.example/movie.jpg" },
  dubs: [{ subjectId: "movie-1", lanName: "Original" }, { subjectId: "dub-1", lanName: "Hindi" }]
};
const series = {
  subjectId: "series-1", title: "Mock Series", subjectType: 7, releaseDate: "2023-01-01",
  cover: { url: "https://img.example/series.jpg" },
  dubs: [{ subjectId: "series-1", lanName: "Original" }, { subjectId: "series-dub-1", lanName: "Hindi" }]
};
const seriesDub = Object.assign({}, series, { subjectId: "series-dub-1", dubs: [{ subjectId: "series-dub-1", lanName: "Hindi" }] });
const POLICY_COOKIE = "Edge-Cache-Cookie=urlprefix=aHR0cHM6Ly9jZG4uZXhhbXBsZS9ub3R0aGVjbGlw";

global.fetch = async function (url, options) {
  url = String(url);
  options = options || {};
  calls.push({ url, options });

  if (url.indexOf("/tab-operating?") >= 0) {
    bootstrapAttempts += 1;
    assert.ok(String(options.headers["user-agent"]).startsWith("com.community.oneroom/50020088"),
      "bootstrap must use the separate OneRoom playback identity");
    assert.ok(String(options.headers["x-client-info"]).includes('"package_name":"com.community.oneroom"'));
    assert.ok(options.headers["x-tr-signature"], "bootstrap request must be signed");
    assert.equal(options.headers.Authorization, undefined, "bootstrap must not send a stale bearer");
    // Upstream may return HTTP 200 without x-user; ensureToken must try fallback.
    return { status: 200, headers: {}, body: JSON.stringify({ code: 0, data: {} }) };
  }

  if (url.indexOf("/tab/ranking-list?") >= 0 && url.indexOf("perPage=1") >= 0) {
    bootstrapCount += 1;
    bootstrapAttempts += 1;
    currentToken = bootstrapCount > 1 ? TOKEN_NEW : TOKEN_OLD;
    assert.ok(String(options.headers["user-agent"]).startsWith("com.community.oneroom/50020088"));
    return { status: 200, headers: { "x-user": JSON.stringify({ token: currentToken }) }, body: JSON.stringify({ code: 0, data: { items: [] } }) };
  }

  const headers = { "x-user": JSON.stringify({ token: currentToken }) };
  if (url.indexOf("/tab/ranking-list?") >= 0) {
    return { status: 200, headers, body: JSON.stringify({ code: 0, data: { items: [movie] } }) };
  }
  if (url.indexOf("/subject-api/list") >= 0) {
    return { status: 200, headers, body: JSON.stringify({ code: 0, data: { items: [movie] } }) };
  }
  if (url.indexOf("/subject-api/search/v2") >= 0) {
    return { status: 200, headers, body: JSON.stringify({ code: 0, data: { results: [{ subjects: [movie] }] } }) };
  }
  if (url.indexOf("/subject-api/season-info?") >= 0) {
    const id = decodeURIComponent((url.match(/[?&]subjectId=([^&]+)/) || [])[1] || "");
    const seasons = id === "series-1" ? [{ se: 1, maxEp: 2 }]
      : id === "series-dub-1" ? [{ se: 1, maxEp: 3 }, { se: 2, maxEp: 1 }]
      : [];
    return { status: 200, headers, body: JSON.stringify({ code: 0, data: { subjectId: id, seasons } }) };
  }
  if (url.indexOf("/subject-api/get?subjectId=") >= 0) {
    const id = decodeURIComponent(url.split("subjectId=")[1].split("&")[0]);
    if (failedDetailIds.has(id)) {
      return { status: 503, headers: {}, body: JSON.stringify({ message: "temporary upstream outage" }) };
    }
    const data = id === "series-1" ? series
      : id === "series-dub-1" ? seriesDub
      : id === "dub-1" ? Object.assign({}, movie, { subjectId: "dub-1", dubs: [] })
      : movie;
    return { status: 200, headers, body: JSON.stringify({ code: 0, data }) };
  }
  if (url.indexOf("/subject-api/play-info?") >= 0) {
    const auth = options.headers && (options.headers.Authorization || options.headers.authorization);
    if (rejectOldPlayback && auth === "Bearer " + TOKEN_OLD) {
      return { status: 403, headers: {}, body: JSON.stringify({ message: "expired bearer token" }) };
    }
    const id = decodeURIComponent((url.match(/[?&]subjectId=([^&]+)/) || [])[1] || "");
    return { status: 200, headers, body: JSON.stringify({ code: 0, data: { streams: [{
      id: "stream-" + id, url: "https://cdn.example/" + id + ".m3u8", format: "HLS",
      resolution: "1080", signCookie: POLICY_COOKIE, languageName: id === "dub-1" ? "Hindi" : "Original"
    }] } }) };
  }
  if (url.indexOf("/subject-api/get-stream-captions?") >= 0 || url.indexOf("/subject-api/get-ext-captions?") >= 0) {
    return { status: 200, headers, body: JSON.stringify({ code: 0, data: { extCaptions: [] } }) };
  }
  return { status: 404, headers: {}, body: JSON.stringify({ message: "not found" }) };
};

const provider = require("../providers/moviebox.js");

async function main() {
  assert.equal(provider.version, "1.0.5");
  assert.equal(provider.getInfo().name, "MovieBox");
  assert.equal(provider.getInfo().type, "movie");
  assert.equal(provider.getSettings().length, 0);
  assert.equal(provider.getStreams, provider.getVideoSources);
  for (const method of ["getInfo", "getSettings", "getHome", "popular", "search", "getDetail", "getEpisodes", "getVideoSources", "getStreams"]) {
    assert.equal(typeof provider[method], "function", "missing provider method: " + method);
  }

  const found = await provider.search("Mock Movie", 1, {});
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "movie-1");

  // The MovieBox listing has already matched the canonical catalogue title.
  // A temporary detail API outage must use that cached result and return zero
  // source episodes, allowing Z Mode to retain its AniList/TMDB catalogue page.
  failedDetailIds.add("movie-1");
  const cachedDetail = await provider.getDetail("movie-1", {});
  failedDetailIds.delete("movie-1");
  assert.equal(cachedDetail.id, "movie-1");
  assert.equal(cachedDetail.title, "Mock Movie");
  assert.equal(cachedDetail.cover, "https://img.example/movie.jpg");
  assert.deepEqual(cachedDetail.episodes, []);
  assert.equal(cachedDetail.subCount, 0);

  assert.equal(bootstrapCount, 1, "fallback bootstrap must obtain a token before protected API requests");
  assert.equal(bootstrapAttempts, 2, "tab-operating without x-user must fall back to ranking-list");

  const category = await provider.getCategory("1|1", 3);
  assert.equal(category.length, 1);
  const categoryCall = calls.find((c) => c.url.indexOf("/subject-api/list") >= 0);
  assert.ok(categoryCall);
  assert.equal(JSON.parse(categoryCall.options.body).page, 3, "filtered categories must honor requested pagination");

  const detail = await provider.getDetail("movie-1", {});
  assert.equal(detail.title, "Mock Movie");
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].url, "mbx://movie-1?se=0&ep=0");

  const eps = await provider.getEpisodes("series-1", {});
  assert.equal(eps.length, 4, "season-info from original and dub subject IDs must be merged");
  assert.deepEqual(eps.map((ep) => ep.url), [
    "mbx://series-1?se=1&ep=1",
    "mbx://series-1?se=1&ep=2",
    "mbx://series-1?se=1&ep=3",
    "mbx://series-1?se=2&ep=1"
  ]);
  assert.ok(calls.some((c) => c.url.indexOf("/subject-api/season-info?subjectId=series-1") >= 0));
  assert.ok(calls.some((c) => c.url.indexOf("/subject-api/season-info?subjectId=series-dub-1") >= 0));

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 2, "original and dubbed stream variants should be exposed");
  assert.ok(streams.every((s) => s.container === "hls" && s.url.endsWith(".m3u8")));
  assert.ok(streams.some((s) => s.audioLang === "Hindi"));
  assert.ok(streams.every((s) => s.headers.Referer === "https://api3.aoneroom.com"));
  assert.ok(streams.every((s) => String(s.headers["User-Agent"]).startsWith("com.community.oneroom/50020088")));
  assert.ok(streams.every((s) => String(s.headers.Cookie).indexOf("Edge-Cache-Cookie=") >= 0));
  const playCall = calls.find((c) => c.url.indexOf("/subject-api/play-info?") >= 0);
  assert.ok(playCall);
  assert.ok(String(playCall.options.headers["x-client-info"]).includes('"package_name":"com.community.oneroom"'));
  assert.ok(String(playCall.options.headers.Authorization).startsWith("Bearer "));
  assert.ok(calls.some((c) => c.url.indexOf("/subject-api/get?subjectId=") >= 0));

  // An expired/revoked bearer must trigger host fallback, re-bootstrap, and one authenticated retry.
  rejectOldPlayback = true;
  const beforeRefresh = bootstrapCount;
  const refreshedStreams = await provider.getVideoSources(detail.episodes[0].url, {});
  rejectOldPlayback = false;
  assert.equal(refreshedStreams.length, 2);
  assert.ok(bootstrapCount > beforeRefresh, "auth failure must trigger a fresh token bootstrap");
  assert.ok(bootstrapAttempts >= 4, "each token refresh should retry tab-operating then ranking-list fallback");
  assert.ok(calls.some((c) => c.url.indexOf("/subject-api/play-info?") >= 0 &&
    c.options.headers && c.options.headers.Authorization === "Bearer " + TOKEN_NEW));

  console.log("MovieBox mocked API contract, auth bootstrap/retry, category pagination, season-info episodes, dub streams, direct signed URLs, and HLS header tests passed.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
