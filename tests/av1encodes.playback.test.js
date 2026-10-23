const assert = require("node:assert/strict");

global.htmlText = function (s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
};

// ── Fixtures ───────────────────────────────────────────────────────────────

const HOME = \`
<article class="spotlight-slide">
  <a href="/anime/example-anime">
    <img data-src="https://av1encodes.com/images/example.jpg" />
    <h3>Example Anime</h3>
  </a>
</article>
\`;

const SEARCH = \`
<div class="card">
  <a href="/anime/example-anime">
    <img src="https://av1encodes.com/images/example.jpg" />
    <h3>Example Anime</h3>
  </a>
</div>
\`;

const DETAIL = \`
<h1>Example Anime</h1>
<img class="anime-poster" src="https://av1encodes.com/images/example.jpg" />
<div class="anime-synopsis">A short synopsis for the example anime.</div>
<a href="/genre/action">Action</a>
<div data-season="1"></div>
\`;

const EPISODES = \`
<a href="/download/example-anime/1/1920%20x%201080/Example.Anime.S01E01.1080p.mkv">E01</a>
<a href="/download/example-anime/1/1920%20x%201080/Example.Anime.S01E02.1080p.mkv">E02</a>
\`;

const DOWNLOAD = \`
<iframe id="anime-video-player" src="https://av1encodes.com/watch/xyz"></iframe>
<script>const token = "AAAAabcdefghij12345";</script>
\`;

const DDL = JSON.stringify({
  watch_link: "https://av1encodes.com/watch/xyz",
  stream_link: "https://cdn.example/stream.m3u8",
  download_link: "https://cdn.example/download.mkv",
  torrent_link: "https://cdn.example/torrent.torrent",
  subtitles: [
    { language: "English", url: "https://cdn.example/subs.vtt" }
  ]
});

// ── fetch stub ─────────────────────────────────────────────────────────────

global.fetch = async function (url, options) {
  url = String(url);

  if (url === "https://av1encodes.com/") return { status: 200, body: HOME, url };
  if (url === "https://av1encodes.com/search?q=example&page=1") return { status: 200, body: SEARCH, url };
  if (url === "https://av1encodes.com/anime/example-anime") return { status: 200, body: DETAIL, url };

  if (/^https:\/\/av1encodes\.com\/episodes\/example-anime\/1\//.test(url)) {
    return { status: 200, body: EPISODES, url };
  }
  if (/^https:\/\/av1encodes\.com\/download\//.test(url)) {
    return { status: 200, body: DOWNLOAD, url };
  }
  if (/^https:\/\/av1encodes\.com\/get_ddl\//.test(url)) {
    return { status: 200, body: DDL, url };
  }

  if (url === "https://av1encodes.com/watch/xyz") return { status: 200, body: "", url };
  if (url === "https://cdn.example/stream.m3u8") return { status: 200, body: "", url };
  if (url === "https://cdn.example/download.mkv") return { status: 200, body: "", url };
  if (url === "https://cdn.example/torrent.torrent") return { status: 200, body: "", url };
  if (url === "https://cdn.example/subs.vtt") return { status: 200, body: "WEBVTT", url };

  return { status: 404, body: "", url };
};

const provider = require("../providers/av1encodes.js");

async function main() {
  // Contract
  assert.equal(provider.version, "1.0.0");
  const info = provider.getInfo();
  assert.equal(info.name, "AV1Encodes");
  assert.equal(info.logo, "icons/av1encodes.png");
  assert.equal(info.lang, "en");
  assert.equal(info.type, "anime");
  assert.deepEqual(provider.getSettings(), []);

  // Search
  const results = await provider.search("example", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Example Anime");
  assert.equal(results[0].url, "/anime/example-anime");
  assert.equal(results[0].cover, "https://av1encodes.com/images/example.jpg");

  // Home
  const home = await provider.getHome({});
  assert.ok(Array.isArray(home));
  assert.ok(home.length >= 1);
  assert.equal(home[0].title, "Popular");
  assert.ok(home[0].items.length >= 1);
  assert.equal(home[0].items[0].id, "/anime/example-anime");

  // Detail + episodes
  const detail = await provider.getDetail("/anime/example-anime", {});
  assert.equal(detail.title, "Example Anime");
  assert.equal(detail.cover, "https://av1encodes.com/images/example.jpg");
  assert.ok(detail.description.indexOf("short synopsis") !== -1);
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 2);
  assert.equal(detail.episodes[1].number, 1);
  assert.ok(detail.episodes[0].url.indexOf("/download/") === 0);
  assert.ok(detail.episodes[0].url.indexOf("E02") !== -1);

  const eps = await provider.getEpisodes("/anime/example-anime", {});
  assert.equal(eps.length, 2);

  // Stream extraction
  const ep = detail.episodes[0];
  const streams = await provider.getVideoSources(ep.url, {});
  assert.ok(streams.length >= 3, "expected Stream, Direct DL and Dash entries");
  assert.ok(streams.some((s) => s.url === "https://cdn.example/stream.m3u8"));
  assert.ok(streams.some((s) => s.url === "https://cdn.example/download.mkv"));
  assert.ok(streams.some((s) => s.url === "https://av1encodes.com/dash/xyz/manifest.mpd"));
  assert.equal(streams[0].preferred, true);
  assert.ok(streams[0].quality.indexOf("1080p") !== -1);

  // getStreams alias
  const alias = await provider.getStreams(ep.url, {});
  assert.equal(alias.length, streams.length);

  console.log("[PASS] av1encodes: search, home, detail, episodes, stream extraction, getStreams alias");
}

main().catch((error) => {
  console.error("[FAIL] av1encodes test");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
