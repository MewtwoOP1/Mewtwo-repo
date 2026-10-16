const assert = require("node:assert/strict");

const requests = [];
const searchCard = '<article><a href="/movie/test-film-123/"><img alt="Test Film (2024)" src="/images/test.jpg"></a></article>';
const seriesCard = '<article><a href="/series/mock-show-654/"><img alt="Mock Show" data-src="/images/show.webp"></a></article>';

global.fetch = async (url, options) => {
  const requestUrl = String(url);
  requests.push({ url: requestUrl, options: options || {} });
  let body = "";

  if (requestUrl === "https://movies2watch.vc/") {
    body = searchCard + seriesCard;
  } else if (requestUrl.indexOf("https://movies2watch.vc/?s=Test%20Film") === 0) {
    body = searchCard;
  } else if (requestUrl.indexOf("https://movies2watch.vc/movie/test-film-123/") === 0) {
    body = '<html><head><meta property="og:title" content="Test Film (2024) | Movies2Watch"><meta property="og:description" content="A test description"><meta property="og:image" content="https://movies2watch.vc/images/test.jpg"><meta name="tmdb_id" content="1234"></head><body><h1>Test Film</h1><iframe src="https://embed.example/player/abc"></iframe></body></html>';
  } else if (requestUrl === "https://embed.example/player/abc") {
    body = '<html><body><video controls><source src="https://cdn.example/test/film-1080p.m3u8?token=abc" type="application/x-mpegURL"></video></body></html>';
  } else if (requestUrl === "https://movies2watch.vc/series/mock-show-654/") {
    body = '<html><head><meta property="og:title" content="Mock Show | Movies2Watch"></head><body><a href="/series/mock-show-654/season-1/episode-2/">Season 1 Episode 2</a><a href="/series/mock-show-654/season-1/episode-1/">S01E01</a></body></html>';
  }

  return { status: 200, body };
};

const provider = require("../providers/movies2watch.js");

async function main() {
  assert.equal(provider.version, "1.0.0");
  assert.equal(provider.getInfo().name, "Movies2Watch");
  assert.deepEqual(provider.getSettings(), []);

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].items.length, 2);
  assert.equal(home[0].items[0].title, "Test Film (2024)");
  assert.equal(home[0].items[0].cover, "https://movies2watch.vc/images/test.jpg");

  const results = await provider.search("Test Film", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://movies2watch.vc/movie/test-film-123/");

  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.title, "Test Film (2024)");
  assert.equal(detail.description, "A test description");
  assert.equal(detail.year, "2024");
  assert.equal(detail.tmdbId, 1234);
  assert.equal(detail.episodes.length, 1);

  const series = await provider.getDetail("https://movies2watch.vc/series/mock-show-654/", {});
  assert.equal(series.episodes.length, 2);
  assert.equal(series.episodes[0].season, 1);
  assert.equal(series.episodes[0].number, 1);

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/test/film-1080p.m3u8?token=abc");
  assert.equal(streams[0].quality, "1080p");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].headers.Referer, "https://embed.example/player/abc");
  assert.equal(await provider.getStreams(detail.episodes[0].url, {}).then((rows) => rows.length), 1);

  const sourceRequest = requests.find((entry) => entry.url === "https://embed.example/player/abc");
  assert.ok(sourceRequest);
  assert.equal(sourceRequest.options.headers.Referer, "https://movies2watch.vc/movie/test-film-123/");

  console.log("Movies2Watch mocked integration tests passed.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
