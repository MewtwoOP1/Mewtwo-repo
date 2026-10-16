const assert = require("node:assert/strict");

const requests = [];
const filmCard = '<div class="flw-item"><div class="film-poster"><img alt="Test Film (2024)" data-src="/images/test.jpg"></div><div class="film-detail"><h3 class="film-name"><a href="/movie/test-film-123/" title="Test Film (2024)">Test Film (2024)</a></h3></div></div>';
const showCard = '<div class="flw-item"><div class="film-poster"><img alt="Mock Show" data-src="/images/show.webp"></div><div class="film-detail"><h3 class="film-name"><a href="/series/mock-show-654/" title="Mock Show">Mock Show</a></h3></div></div>';

global.fetch = async (url, options) => {
  const requestUrl = String(url);
  requests.push({ url: requestUrl, options: options || {} });
  let body = "";

  if (requestUrl === "https://movies2watch.vc/filter.php?sort=updated&order=desc&page=1") {
    body = filmCard + showCard;
  } else if (requestUrl === "https://movies2watch.vc/filter.php?sort=rating&order=desc&page=1") {
    body = filmCard + showCard;
  } else if (requestUrl.indexOf("https://movies2watch.vc/filter.php?type=all&keyword=Test%20Film&sort=updated&order=desc&page=1") === 0) {
    body = filmCard;
  } else if (requestUrl === "https://movies2watch.vc/movie/test-film-123/") {
    body = '<html><head><meta property="og:title" content="Test Film (2024) | Movies2Watch"><meta property="og:description" content="A test description"><meta property="og:image" content="https://movies2watch.vc/images/test.jpg"><meta name="tmdb_id" content="1234"></head><body><h1 class="heading-name">Test Film (2024)</h1><script>const pl_url = "https://movies2watch.vc/ajax/movie-servers";</script></body></html>';
  } else if (requestUrl === "https://movies2watch.vc/series/mock-show-654/") {
    body = '<html><head><meta property="og:title" content="Mock Show | Movies2Watch"></head><body><div class="slt-seasons-dropdown"><div class="ss-item" data-id="seasonA" data-ss="1">Season 1</div></div></body></html>';
  } else if (requestUrl === "https://movies2watch.vc/ajax/ajax.php?episode=seasonA") {
    body = '<ul><li><a class="eps-item" href="/series/mock-show-654/1-2/" title="Episode 2">Episode 2</a></li><li><a class="eps-item" href="/series/mock-show-654/1-1/" title="Episode 1">Episode 1</a></li></ul>';
  } else if (requestUrl === "https://movies2watch.vc/ajax/movie-servers") {
    body = '<a class="sv-item" data-srv="UpCloud" data-id="https://embed.example/player/abc">UpCloud</a>';
  } else if (requestUrl === "https://embed.example/player/abc") {
    body = '<html><body><video controls><source src="https://cdn.example/test/film-1080p.m3u8?token=abc" type="application/x-mpegURL"></video></body></html>';
  }

  return { status: 200, body };
};

const provider = require("../providers/movies2watch.js");

async function main() {
  assert.equal(provider.version, "1.0.0");
  assert.equal(provider.getInfo().name, "Movies2Watch");
  assert.deepEqual(provider.getSettings(), []);

  const home = await provider.getHome({});
  assert.equal(home.length, 2);
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
  assert.equal(series.episodes[0].url, "https://movies2watch.vc/series/mock-show-654/1-1/");

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/test/film-1080p.m3u8?token=abc");
  assert.equal(streams[0].quality, "1080p");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].headers.Referer, "https://embed.example/player/abc");

  const serverRequest = requests.find((entry) => entry.url === "https://movies2watch.vc/ajax/movie-servers");
  assert.ok(serverRequest);
  assert.equal(serverRequest.options.headers["X-Requested-With"], "XMLHttpRequest");
  assert.equal(serverRequest.options.headers.Referer, "https://movies2watch.vc/movie/test-film-123/");

  const embedRequest = requests.find((entry) => entry.url === "https://embed.example/player/abc");
  assert.ok(embedRequest);
  assert.equal(embedRequest.options.headers.Referer, "https://movies2watch.vc/movie/test-film-123/");
  assert.equal(await provider.getStreams(detail.episodes[0].url, {}).then((rows) => rows.length), 1);

  console.log("Movies2Watch mocked integration tests passed.");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
