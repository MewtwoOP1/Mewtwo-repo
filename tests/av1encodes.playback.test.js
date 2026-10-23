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
    num: 5,
    label: "Episode 5 [Dual]",
    href: "https://av1encodes.com/download/example-anime/1/1920%20x%201080/Example.Anime.%5BE05%5D%20%5B1080p%5D%20%5BDual%5D.mkv?token=ep05",
    ddl: {
      success: true,
      watch_link: "https://av1please.com/watch/ep05",
      stream_link: "https://cdn08.av1encodes.com/stream/.eJwOpaqueStreamToken",
      download_link: "https://cdn08.av1encodes.com/dl/.eJwOpaqueDownloadToken"
    }
  },
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
  },
  {
    num: 4,
    label: "Episode 4 [Sub]",
    href: "/download/example-anime/1/1920%20x%201080/Example.Anime.%5BE04%5D%20%5B1080p%5D%20%5BSub%5D.mkv?token=ep04"
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

const DDL_EP3 = JSON.stringify({
  success: true,
  watch_link: "https://av1please.com/watch/ep03-fallback",
  stream_link: "https://cdn.example/ep03-fallback.m3u8",
  download_link: "https://cdn.example/ep03-fallback.mkv",
  subtitles: [{ language: "English", url: "https://cdn.example/ep03-fallback.vtt" }]
});

const DOWNLOAD_EP3 =
  '<iframe id="anime-video-player" src="/watch/ep03-fallback"></iframe>' +
  '<script>const token = "AAAAabcdefghij12345";</script>';

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

  // The signed CDN stream/download endpoints reject HEAD. The provider must
  // preserve their URLs rather than retry with GET and buffer video as text.
  if (host === "cdn08.av1encodes.com" && (pathname.startsWith("/stream/") || pathname.startsWith("/dl/"))) {
    if (method === "HEAD") return { status: 405, body: "Method Not Allowed", url };
    throw new Error("Opaque media endpoints must not be probed with GET");
  }

  // HEAD discovers redirects without buffering whole media responses.
  if (method === "HEAD") return { status: 200, body: "", url };

  if (pathname === "/") return { status: 200, body: HOME, url };
  if (pathname === "/search" && parsed.searchParams.get("q") === "example") {
    return { status: 200, body: SEARCH, url };
  }
  if (pathname === "/anime/example-anime") return { status: 200, body: DETAIL, url };
  if (/^\/episodes\/example-anime\/1\//.test(pathname)) {
    const items = JSON.parse(EPISODES);
    const resolution = pathname.split("/").pop();
    for (const item of items) {
      item.href = item.href.replace("1920%20x%201080", resolution);
    }
    return { status: 200, body: JSON.stringify(items), url };
  }
  if (/^\/download\//.test(pathname)) {
    const decodedPath = decodeURIComponent(pathname);
    if (/E04/i.test(decodedPath)) return { status: 200, body: DOWNLOAD_FAILED, url };
    if (/E03/i.test(decodedPath) && decodedPath.includes("/1920 x 1080/")) {
      return { status: 200, body: DOWNLOAD_FAILED, url };
    }
    if (/E03/i.test(decodedPath)) {
      return { status: 200, body: DOWNLOAD_EP3, url };
    }
    return { status: 200, body: DOWNLOAD_EP2, url };
  }
  if (/^\/get_ddl\//.test(pathname)) {
    return { status: 200, body: /E03/i.test(decodeURIComponent(pathname)) ? DDL_EP3 : DDL_EP2, url };
  }
  if (/^\/watch\//.test(pathname)) return { status: 200, body: "", url };
  if (host === "cdn.example") return { status: 200, body: "", url };
  return { status: 404, body: "", url };
};

async function main() {
  // Zangetsu source contract.
  assert.equal(provider.version, "1.0.2");
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
  assert.deepEqual(detail.episodes.map((episode) => episode.number), [5, 4, 3, 2, 1]);
  assert.ok(detail.episodes.every((episode) => episode.url.startsWith("/download/")));
  assert.ok(detail.episodes[4].url.includes("?token=ep01"));
  assert.ok(requests.some((request) => request.url.startsWith("https://av1please.com/")));

  // Embedded DDL should resolve immediately and only produce media URLs.
  const opaqueEpisode = detail.episodes[0];
  const opaqueStreams = await provider.getVideoSources(opaqueEpisode.url, true);
  assert.ok(opaqueStreams.some((stream) => stream.url === "https://cdn08.av1encodes.com/stream/.eJwOpaqueStreamToken"));
  assert.ok(opaqueStreams.some((stream) => stream.url === "https://cdn08.av1encodes.com/dl/.eJwOpaqueDownloadToken"));
  assert.ok(requests.some((request) => request.url === "https://cdn08.av1encodes.com/stream/.eJwOpaqueStreamToken" && request.method === "HEAD"));
  assert.ok(!requests.some((request) => request.url === "https://cdn08.av1encodes.com/stream/.eJwOpaqueStreamToken" && request.method === "GET"));
  assert.ok(!requests.some((request) => /https:\/\/(?:av1encodes\.com|animealpha\.cc|av1please\.com)\/stream\//i.test(request.url)),
    "opaque CDN stream URLs must not be rebased onto site/mirror domains");

  const ep1 = detail.episodes[4];
  const streams1 = await provider.getVideoSources(ep1.url, true);
  assert.ok(streams1.some((stream) => stream.url === "https://cdn.example/ep01.m3u8"));
  assert.ok(streams1.some((stream) => stream.url === "https://cdn.example/ep01.mkv"));
  assert.ok(streams1.some((stream) => stream.url === "https://av1please.com/dash/ep01/manifest.mpd"));
  assert.equal(streams1[0].preferred, true);
  assert.ok(streams1[0].quality.includes("1080p"));
  assert.ok(!streams1.some((stream) => stream.url.includes("/download/")));

  // Regular download-page -> token -> get_ddl flow for an episode without
  // embedded JSON DDL.
  const ep2 = detail.episodes[3];
  const streams2 = await provider.getVideoSources(ep2.url, true);
  assert.ok(streams2.some((stream) => stream.url === "https://cdn.example/ep02.m3u8"));
  assert.ok(streams2.some((stream) => stream.url === "https://cdn.example/ep02.mkv"));
  assert.ok(streams2.some((stream) => stream.url === "https://av1please.com/dash/ep02/manifest.mpd"));
  assert.equal(streams2[0].kind, "sub");
  assert.equal(streams2[0].audioLang, "ja");

  // Dual audio is not incorrectly filtered into the Japanese-sub-only bucket.
  assert.equal(streams1[0].kind, "unknown");
  assert.equal(streams1[0].audioLang, undefined);

  // Episode 3 fails at preferred 1080p, but its JSON episode item resolves
  // to a lower-resolution URL. This specifically guards JSON-aware fallback.
  const ep3 = detail.episodes[2];
  const fallbackStreams = await provider.getVideoSources(ep3.url, true);
  assert.ok(
    fallbackStreams.some((stream) => stream.url === "https://cdn.example/ep03-fallback.m3u8"),
    "should find a playable episode from the lower-resolution JSON list"
  );
  assert.ok(fallbackStreams.some((stream) => stream.url === "https://cdn.example/ep03-fallback.mkv"));
  assert.ok(fallbackStreams.every((stream) => !stream.url.includes("/download/")));

  // Episode 4 fails at every available resolution. The provider must not return
  // the site's HTML download page disguised as an MKV stream.
  const ep4 = detail.episodes[1];
  const noStreams = await provider.getVideoSources(ep4.url, true);
  assert.deepEqual(noStreams, []);

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
