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

const HOME =
  '<article class="spotlight-slide">' +
  '<a href="/anime/example-anime">' +
  '<img data-src="https://av1please.com/images/example.jpg" />' +
  '<h3>Example Anime</h3></a></article>';

const SEARCH =
  '<div class="card"><a href="/anime/example-anime">' +
  '<img src="https://av1please.com/images/example.jpg" />' +
  '<h3>Example Anime</h3></a></div>';

const DETAIL =
  '<h1>Example Anime</h1>' +
  '<img class="anime-poster" src="https://av1please.com/images/example.jpg" />' +
  '<div class="anime-synopsis">A short synopsis for the example anime.</div>' +
  '<a href="/genre/action">Action</a><div data-season="1"></div>';

const EPISODES = JSON.stringify([
  {
    num: 1,
    label: "Episode 1 [Dual]",
    href: "https://av1encodes.com/download/example-anime/1/1920%20x%201080/Example.Anime.%5BE01%5D%20%5B1080p%5D%20%5BDual%5D.mkv?token=ep01",
    ddl: {
      success: true,
      watch_link: "https://av1please.com/watch/ep01",
      stream_link: "https://cdn.example/ep01.m3u8",
      download_link: "https://cdn.example/ep01.mkv",
      subtitles: [{ language: "English", url: "https://cdn.example/ep01.vtt" }]
    }
  },
  {
    num: 2,
    label: "Episode 2 [Sub]",
    href: "/download/example-anime/1/1920%20x%201080/Example.Anime.%5BE02%5D%20%5B1080p%5D%20%5BSub%5D.mkv?token=ep02"
  },
  {
    num: 3,
    label: "Episode 3 [Sub]",
    href: "/download/example-anime/1/1920%20x%201080/Example.Anime.%5BE03%5D%20%5B1080p%5D%20%5BSub%5D.mkv?token=ep03"
  }
]);

const DOWNLOAD_EP2 =
  '<iframe id="anime-video-player" src="/watch/ep02"></iframe>' +
  '<script>const token = "AAAAabcdefghij12345";</script>';

const DOWNLOAD_FAILED =
  '<h1>Example Anime</h1><div>Generating download link...</div>' +
  '<div>Unable to generate download link</div>';

const DDL_EP2 = JSON.stringify({
  success: true,
  watch_link: "https://av1please.com/watch/ep02",
  stream_link: "https://cdn.example/ep02.m3u8",
  download_link: "https://cdn.example/ep02.mkv",
  subtitles: [{ language: "English", url: "https://cdn.example/ep02.vtt" }]
});

const provider = require("../providers/av1encodes.js");
const requests = [];

global.fetch = async function (input, options) {
  const url = String(input);
  const method = String((options && options.method) || "GET").toUpperCase();
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname;
  requests.push({ url, method });

  // Simulate the default domain and its former alias being blocked.
  if (host === "av1encodes.com" || host === "animealpha.cc") {
    return { status: 403, body: "Access denied", url };
  }

  // HEAD discovers redirects without buffering whole media responses.
  if (method === "HEAD") return { status: 200, body: "", url };

  if (pathname === "/") return { status: 200, body: HOME, url };
  if (pathname === "/search" && parsed.searchParams.get("q") === "example") {
    return { status: 200, body: SEARCH, url };
  }
  if (pathname === "/anime/example-anime") return { status: 200, body: DETAIL, url };
  if (/^\/episodes\/example-anime\/1\//.test(pathname)) {
    return { status: 200, body: EPISODES, url };
  }
  if (/^\/download\//.test(pathname)) {
    if (/E03/i.test(decodeURIComponent(pathname))) {
      return { status: 200, body: DOWNLOAD_FAILED, url };
    }
    return { status: 200, body: DOWNLOAD_EP2, url };
  }
  if (/^\/get_ddl\//.test(pathname)) return { status: 200, body: DDL_EP2, url };
  if (/^\/watch\//.test(pathname)) return { status: 200, body: "", url };
  if (host === "cdn.example") return { status: 200, body: "", url };
  return { status: 404, body: "", url };
};

async function main() {
  // Zangetsu source contract.
  assert.equal(provider.version, "1.0.0");
  const info = provider.getInfo();
  assert.equal(info.name, "AV1Encodes");
  assert.equal(info.logo, "icons/av1encodes.png");
  assert.equal(info.lang, "en");
  assert.equal(info.type, "anime");
  assert.deepEqual(provider.getSettings(), []);

  // Catalogue requests fail over from the blocked host.
  const results = await provider.search("example", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Example Anime");
  assert.equal(results[0].url, "/anime/example-anime");
  assert.equal(results[0].cover, "https://av1please.com/images/example.jpg");

  const home = await provider.getHome({});
  assert.ok(home.length >= 1);
  assert.equal(home[0].title, "Popular");
  assert.equal(home[0].items[0].id, "/anime/example-anime");

  // JSON episode API, absolute URL normalization, query token preservation,
  // stable order, and per-episode DDL cache.
  const detail = await provider.getDetail("/anime/example-anime", {});
  assert.equal(detail.title, "Example Anime");
  assert.equal(detail.cover, "https://av1please.com/images/example.jpg");
  assert.ok(detail.description.includes("short synopsis"));
  assert.deepEqual(detail.episodes.map((episode) => episode.number), [3, 2, 1]);
  assert.ok(detail.episodes.every((episode) => episode.url.startsWith("/download/")));
  assert.ok(detail.episodes[2].url.includes("?token=ep01"));
  assert.ok(requests.some((request) => request.url.startsWith("https://av1please.com/")));

  // Embedded DDL should resolve immediately and only produce media URLs.
  const ep1 = detail.episodes[2];
  const streams1 = await provider.getVideoSources(ep1.url, true);
  assert.ok(streams1.some((stream) => stream.url === "https://cdn.example/ep01.m3u8"));
  assert.ok(streams1.some((stream) => stream.url === "https://cdn.example/ep01.mkv"));
  assert.ok(streams1.some((stream) => stream.url === "https://av1please.com/dash/ep01/manifest.mpd"));
  assert.equal(streams1[0].preferred, true);
  assert.ok(streams1[0].quality.includes("1080p"));
  assert.ok(!streams1.some((stream) => stream.url.includes("/download/")));

  // Regular download-page -> token -> get_ddl flow for an episode without
  // embedded JSON DDL.
  const ep2 = detail.episodes[1];
  const streams2 = await provider.getVideoSources(ep2.url, true);
  assert.ok(streams2.some((stream) => stream.url === "https://cdn.example/ep02.m3u8"));
  assert.ok(streams2.some((stream) => stream.url === "https://cdn.example/ep02.mkv"));
  assert.ok(streams2.some((stream) => stream.url === "https://av1please.com/dash/ep02/manifest.mpd"));
  assert.equal(streams2[0].kind, "sub");
  assert.equal(streams2[0].audioLang, "ja");

  // Dual audio is not incorrectly filtered into the Japanese-sub-only bucket.
  assert.equal(streams1[0].kind, "unknown");
  assert.equal(streams1[0].audioLang, undefined);

  // Failed site-side generation returns no bogus HTML stream.
  const ep3 = detail.episodes[0];
  const failedStreams = await provider.getVideoSources(ep3.url, true);
  assert.deepEqual(failedStreams, []);

  // Legacy alias accepts an options object.
  const alias = await provider.getStreams(ep1.url, {});
  assert.equal(alias.length, streams1.length);

  // An incomplete site /download URL is an HTML endpoint, not a media URL.
  assert.deepEqual(
    await provider.getVideoSources("/download/example-anime/Example.Anime.E04.mkv", true),
    []
  );

  // Re-create the provider module to verify the app-compatible fetch bridge's
  // lack of a browser cookie jar is compensated by provider-side warm/replay.
  delete require.cache[require.resolve("../providers/av1encodes.js")];
  const warmProvider = require("../providers/av1encodes.js");
  const warmRequests = [];
  global.fetch = async function (input, options) {
    const url = String(input);
    const method = String((options && options.method) || "GET").toUpperCase();
    const parsed = new URL(url);
    const headers = (options && options.headers) || {};
    warmRequests.push({ url, method, headers });

    if (parsed.hostname === "av1encodes.com" && parsed.pathname === "/") {
      return {
        status: 200,
        body: HOME,
        url,
        headers: { "set-cookie": "av1_client_id=warm-session-123; Path=/; HttpOnly; Secure" }
      };
    }
    if (parsed.hostname === "av1encodes.com" && parsed.pathname === "/search") {
      const cookie = String(headers.Cookie || headers.cookie || "");
      if (!cookie.includes("av1_client_id=warm-session-123")) {
        return { status: 403, body: "Access denied", url, headers: {} };
      }
      return { status: 200, body: SEARCH, url, headers: {} };
    }
    return { status: 404, body: "", url, headers: {} };
  };

  const warmResults = await warmProvider.search("warm", 1, {});
  assert.equal(warmResults.length, 1, "provider should retry after warming av1_client_id");
  assert.ok(warmRequests.some((request) =>
    request.url === "https://av1encodes.com/" && request.method === "GET"
  ), "provider should warm the homepage after a 403");
  assert.ok(warmRequests.some((request) => {
    const headers = request.headers || {};
    return request.url.startsWith("https://av1encodes.com/search?") &&
      String(headers.Cookie || headers.cookie || "").includes("av1_client_id=warm-session-123");
  }), "retried request should carry the captured session cookie");

  console.log("[PASS] av1encodes: domain failover, episode contract, embedded DDL, regular DDL, fast mode, audio kind, failure handling, alias");
}

main().catch((error) => {
  console.error("[FAIL] av1encodes test");
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
