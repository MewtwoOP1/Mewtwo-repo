const assert = require("node:assert/strict");

const TOKEN = "header.eyJleHAiOjQwMDAwMDAwMDB9.signature";
const calls = [];
const movie = {
  subjectId: "movie-1", title: "Mock Movie", subjectType: 1, releaseDate: "2024-05-01",
  cover: { url: "https://img.example/movie.jpg" },
  dubs: [{ subjectId: "movie-1", lanName: "Original" }, { subjectId: "dub-1", lanName: "Hindi" }]
};
const series = {
  subjectId: "series-1", title: "Mock Series", subjectType: 2, releaseDate: "2023-01-01",
  cover: { url: "https://img.example/series.jpg" }, seasons: [{ se: 1, maxEp: 2 }]
};
global.fetch = async function (url, options) {
  url = String(url);
  options = options || {};
  calls.push({ url, options });
  const headers = { "x-user": JSON.stringify({ token: TOKEN }) };
  if (url.indexOf("/tab/ranking-list?") >= 0) {
    return { status: 200, headers, body: JSON.stringify({ data: { items: [movie] } }) };
  }
  if (url.indexOf("/subject-api/search/v2") >= 0) {
    return { status: 200, headers, body: JSON.stringify({ data: { results: [{ subjects: [movie] }] } }) };
  }
  if (url.indexOf("/subject-api/get?subjectId=") >= 0) {
    const id = decodeURIComponent(url.split("subjectId=")[1].split("&")[0]);
    const data = id === "series-1" ? series : (id === "dub-1" ? Object.assign({}, movie, { subjectId: "dub-1", dubs: [] }) : movie);
    return { status: 200, headers, body: JSON.stringify({ data }) };
  }
  if (url.indexOf("/subject-api/play-info?") >= 0) {
    const id = decodeURIComponent((url.match(/[?&]subjectId=([^&]+)/) || [])[1] || "");
    return { status: 200, headers, body: JSON.stringify({ data: { streams: [{
      id: "stream-" + id, url: "https://cdn.example/" + id + ".m3u8", format: "HLS",
      resolution: "1080", languageName: id === "dub-1" ? "Hindi" : "Original"
    }] } }) };
  }
  if (url.indexOf("/subject-api/get-stream-captions?") >= 0 || url.indexOf("/subject-api/get-ext-captions?") >= 0) {
    return { status: 200, headers, body: JSON.stringify({ data: { extCaptions: [] } }) };
  }
  return { status: 404, headers: {}, body: "{}" };
};

const provider = require("../providers/moviebox.js");
async function main() {
  assert.equal(provider.version, "1.0.2");
  assert.equal(provider.getInfo().name, "MovieBox");
  assert.equal(provider.getInfo().type, "movie");
  assert.deepEqual(provider.getSettings(), []);
  assert.equal(provider.getStreams, provider.getVideoSources);
  for (const method of ["getInfo", "getSettings", "getHome", "popular", "search", "getDetail", "getEpisodes", "getVideoSources", "getStreams"]) {
    assert.equal(typeof provider[method], "function", "missing provider method: " + method);
  }

  const found = await provider.search("Mock Movie", 1, {});
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "movie-1");

  const detail = await provider.getDetail("movie-1", {});
  assert.equal(detail.title, "Mock Movie");
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].url, "mbx://movie-1?se=0&ep=0");

  const eps = await provider.getEpisodes("series-1", {});
  assert.equal(eps.length, 2);
  assert.equal(eps[0].url, "mbx://series-1?se=1&ep=1");
  assert.equal(eps[1].url, "mbx://series-1?se=1&ep=2");

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 2, "original and dubbed stream variants should be exposed");
  assert.ok(streams.every((s) => s.container === "hls" && s.url.indexOf("https://cdn.example/") === 0));
  assert.ok(streams.some((s) => s.audioLang === "Hindi"));
  assert.ok(calls.some((c) => c.url.indexOf("/subject-api/play-info?") >= 0));
  assert.ok(calls.some((c) => c.url.indexOf("/subject-api/get?subjectId=") >= 0));
  console.log("MovieBox mocked contract, search, details, episodes, dub and HLS playback tests passed.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
