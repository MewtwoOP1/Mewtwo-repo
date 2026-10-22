const assert = require("node:assert/strict");
const provider = require("../providers/crunchy-anime.js");
const manifest = require("../index.json");

const SITE = "https://anime.uniquestream.net";
const API = SITE + "/api/v1";
const calls = [];
const seriesRecord = {
  content_id: "SER1",
  title: "Kaiju No. 8",
  description: "A defense force fights kaiju.",
  images: [
    { type: "poster_tall", url: "https://img.example/kaiju-poster.jpg" },
    { type: "poster_wide", url: "https://img.example/kaiju-wide.jpg" },
  ],
  genre: [{ title: "Action" }, { title: "Sci-Fi" }],
  status: "RELEASING",
  audio_locales: ["ja-JP", "en-US", "es-419"],
  subtitle_locales: ["en-US", "es-419", "pt-BR"],
  seasons: [{
    content_id: "SEASON1",
    title: "Season 1",
    season_number: 1,
    season_seq_number: 1,
    display_number: 1,
    episode_count: 21,
  }],
};

function episode(id, number) {
  return {
    content_id: id,
    title: "Episode " + number,
    episode: String(number),
    episode_number: number,
    audio_locales: ["ja-JP", "en-US", "es-419"],
  };
}

function mediaFor(locale, id) {
  if (locale === "ja-JP") {
    return {
      content_id: id,
      media_id: "MEDIA-" + id,
      hls: {
        locale: "ja-JP",
        playlist: "https://cdn.example/raw-master.m3u8",
        subtitles: [
          { language: "English", url: "https://cdn.example/en.vtt" },
          { language: "Spanish (Latin America)", url: "https://cdn.example/es-419.vtt" },
        ],
        hard_subs: [
          { locale: "en-US", playlist: "https://cdn.example/raw-hard-en.m3u8" },
          { locale: "es-419", playlist: "https://cdn.example/raw-hard-es.m3u8" },
        ],
      },
      dash: {
        locale: "ja-JP",
        playlist: "https://cdn.example/raw-master.mpd",
        quality: "1080p",
      },
      versions: {
        hls: [
          { locale: "en-US", playlist: "https://cdn.example/dub-en.m3u8" },
          { locale: "es-419", playlist: "https://cdn.example/dub-es-419.m3u8" },
          {
            locale: "fr-FR",
            playlist: "https://cdn.example/dub-fr.m3u8",
            hard_subs: [
              { locale: "en-US", playlist: "https://cdn.example/dub-fr-hard-en.m3u8" },
            ],
          },
        ],
        dash: [
          { locale: "en-US", playlist: "https://cdn.example/dub-en.mpd", quality: "720p" },
        ],
      },
    };
  }
  if (locale === "en-US") {
    return {
      content_id: id,
      media_id: "MEDIA-" + id + "-EN",
      hls: {
        locale: "en-US",
        playlist: "https://cdn.example/dub-en.m3u8",
        subtitles: [{ locale: "es-419", url: "https://cdn.example/dub-en-es.vtt" }],
      },
    };
  }
  if (locale === "es-419") {
    return {
      content_id: id,
      media_id: "MEDIA-" + id + "-ES",
      hls: {
        locale: "es-419",
        playlist: "https://cdn.example/dub-es-419.m3u8",
      },
    };
  }
  return {};
}

global.fetch = async function (url, options) {
  const requestUrl = String(url);
  calls.push({ url: requestUrl, options: options || {} });

  if (requestUrl === API + "/videos/new?page=1&limit=20&type=all") {
    return { status: 200, body: JSON.stringify([
      { content_id: "SER1", title: "Kaiju No. 8", type: "show", image: "https://img.example/new.jpg" },
    ]) };
  }
  if (requestUrl === API + "/videos/popular?page=1&limit=20&type=all") {
    return { status: 200, body: JSON.stringify({ data: [
      { content_id: "SER1", title: "Kaiju No. 8", type: "show", subbed: true, dubbed: true },
    ] }) };
  }
  if (requestUrl === API + "/videos/movies?page=1&limit=20&type=all") {
    return { status: 200, body: JSON.stringify([
      { content_id: "MOV1", title: "Kaiju No. 8: Mission", type: "movie", image: "https://img.example/movie.jpg" },
    ]) };
  }
  if (requestUrl === API + "/search?page=1&query=Kaiju%20No.%208&t=all&limit=20") {
    return { status: 200, body: JSON.stringify({
      series: [{ content_id: "SER1", title: "Kaiju No. 8", type: "show", audio_locales: ["ja-JP", "en-US"] }],
      movies: [{ content_id: "MOV1", title: "Kaiju No. 8: Mission", type: "movie" }],
      episodes: [],
      totals: { series: 1, movies: 1 },
    }) };
  }
  if (requestUrl === API + "/series/SER1") {
    return { status: 200, body: JSON.stringify(seriesRecord) };
  }
  if (requestUrl === API + "/movie/MOV1") {
    return { status: 200, body: JSON.stringify({
      content_id: "MOV1",
      title: "Kaiju No. 8: Mission",
      description: "A feature-length story.",
      images: [{ type: "poster_tall", url: "https://img.example/movie.jpg" }],
      audio_locales: ["ja-JP", "en-US"],
      subtitle_locales: ["en-US"],
      status: "RELEASED",
      seasons: null,
    }) };
  }
  if (requestUrl.indexOf(API + "/season/SEASON1/episodes?") === 0) {
    const page = Number((requestUrl.match(/[?&]page=(\d+)/) || [])[1] || 1);
    const items = [];
    const first = (page - 1) * 20 + 1;
    const last = Math.min(page * 20, 21);
    for (let n = first; n <= last; n++) items.push(episode("EP" + n, n));
    return { status: 200, body: JSON.stringify(items) };
  }
  const episodeMedia = requestUrl.match(/\/api\/v1\/episode\/([^/]+)\/media\/hls\/([^/?#]+)/);
  if (episodeMedia) {
    const id = decodeURIComponent(episodeMedia[1]);
    const locale = decodeURIComponent(episodeMedia[2]);
    return { status: 200, body: JSON.stringify(mediaFor(locale, id)) };
  }
  const movieMedia = requestUrl.match(/\/api\/v1\/movie\/([^/]+)\/media\/hls\/([^/?#]+)/);
  if (movieMedia) {
    const id = decodeURIComponent(movieMedia[1]);
    const locale = decodeURIComponent(movieMedia[2]);
    return { status: 200, body: JSON.stringify(mediaFor(locale, id)) };
  }

  return { status: 404, body: JSON.stringify({ error: "Not found", url: requestUrl }) };
};

async function main() {
  const manifestEntry = manifest.sources.find(source => source.id === "crunchy-anime");
  assert.ok(manifestEntry, "Crunchy-anime must be registered in index.json");
  assert.equal(provider.version, manifestEntry.version, "Provider and manifest versions must match");
  assert.equal(provider.getInfo().name, "Crunchy-anime");
  assert.equal(provider.getInfo().baseUrl, SITE);
  assert.equal(provider.getInfo().type, "anime");
  assert.deepEqual(provider.getSettings().map(setting => setting.key), ["hlsProxyUrl", "hlsProxyToken"]);

  const home = await provider.getHome({});
  assert.deepEqual(home.map(row => row.title), [
    "Latest on Crunchy-anime",
    "Popular on Crunchy-anime",
  ]);
  assert.equal(home[0].items[0].title, "Kaiju No. 8");

  const search = await provider.search("Kaiju No. 8", 1, {});
  assert.equal(search.length, 2);
  assert.equal(search[0].contentType, "series");
  assert.equal(search[1].contentType, "movie");
  assert.ok(calls.some(call => call.url === API + "/search?page=1&query=Kaiju%20No.%208&t=all&limit=20"));
  const emptySearch = await provider.search("", 1, {});
  assert.deepEqual(emptySearch, []);

  provider._clearCache();
  const detail = await provider.getDetail(search[0].url, {});
  assert.equal(detail.title, "Kaiju No. 8");
  assert.equal(detail.cover, "https://img.example/kaiju-poster.jpg");
  assert.equal(detail.banner, "https://img.example/kaiju-wide.jpg");
  assert.equal(detail.status, "ongoing");
  assert.deepEqual(detail.genres, ["Action", "Sci-Fi"]);
  assert.deepEqual(detail.audioLocales, ["ja-JP", "en-US", "es-419"]);
  assert.deepEqual(detail.subtitleLocales, ["en-US", "es-419", "pt-BR"]);
  assert.equal(detail.episodes.length, 21, "all episode pages must be retrieved");
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[20].number, 21);
  assert.equal(detail.episodes[20].contentId, "EP21");
  assert.ok(detail.episodes[0].url.startsWith("crunchyanime://episode/EP1?"));
  assert.ok(detail.episodes[0].url.includes("locales=ja-JP%2Cen-US%2Ces-419"));
  assert.ok(calls.some(call => call.url.indexOf("/season/SEASON1/episodes?page=2&") >= 0));

  const beforeEpisodeRead = calls.length;
  const episodeList = await provider.getEpisodes(search[0].url, {});
  assert.equal(episodeList.length, 21);
  assert.equal(calls.length, beforeEpisodeRead, "cached detail should avoid refetching all episode pages");

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  const streamUrls = streams.map(stream => stream.url);
  [
    "https://cdn.example/raw-master.m3u8",
    "https://cdn.example/raw-master.mpd",
    "https://cdn.example/raw-hard-en.m3u8",
    "https://cdn.example/raw-hard-es.m3u8",
    "https://cdn.example/dub-en.m3u8",
    "https://cdn.example/dub-es-419.m3u8",
    "https://cdn.example/dub-fr.m3u8",
    "https://cdn.example/dub-fr-hard-en.m3u8",
    "https://cdn.example/dub-en.mpd",
  ].forEach(url => assert.ok(streamUrls.includes(url), "missing media variant: " + url));

  const raw = streams.find(stream => stream.url === "https://cdn.example/raw-master.m3u8");
  assert.equal(raw.kind, "sub");
  assert.equal(raw.container, "hls");
  assert.equal(raw.headers.Referer, SITE + "/");
  assert.deepEqual(raw.subtitles.map(track => track.url), [
    "https://cdn.example/en.vtt",
    "https://cdn.example/es-419.vtt",
  ]);
  assert.equal(raw.subtitles[0].lang, "English");
  assert.equal(raw.subtitles[0].label, "English");
  assert.equal(raw.subtitles[0].format, "vtt");
  assert.equal(raw.subtitles[1].lang, "Spanish (Latin America)");
  assert.equal(raw.subtitles[1].format, "vtt");
  for (const stream of streams) {
    assert.equal(typeof stream.url, "string", "stream URL must be a string");
    assert.ok(["hls", "mp4", "torrent", "unknown"].includes(stream.container),
      "container must match Zangetsu's VideoSource enum");
    assert.ok(["sub", "dub", "raw", "unknown"].includes(stream.kind),
      "audio kind must match Zangetsu's VideoSource enum");
    for (const track of stream.subtitles || []) {
      assert.equal(typeof track.url, "string", "subtitle URL must be a string");
      assert.equal(typeof track.lang, "string", "subtitle lang is required by Zangetsu");
      assert.ok(track.lang.length > 0, "subtitle language cannot be empty");
    }
  }

  const englishDub = streams.find(stream => stream.url === "https://cdn.example/dub-en.m3u8");
  assert.equal(englishDub.kind, "dub");
  assert.ok(englishDub.label.includes("English"));
  const hardSub = streams.find(stream => stream.url === "https://cdn.example/raw-hard-en.m3u8");
  assert.equal(hardSub.kind, "sub");
  assert.ok(hardSub.label.includes("English Hard Subs"));

  assert.ok(calls.some(call => call.url === API + "/episode/EP1/media/hls/ja-JP"));
  assert.ok(calls.some(call => call.url === API + "/episode/EP1/media/hls/en-US"));
  assert.ok(calls.some(call => call.url === API + "/episode/EP1/media/hls/es-419"));

  // When the optional Worker endpoint is configured, the provider must wrap
  // each HLS playlist URL with its media ID and auth token. DASH stays direct.
  global.__settings = {
    "crunchy-anime": {
      hlsProxyUrl: "https://proxy.example.workers.dev",
      hlsProxyToken: "test-proxy-token",
    },
  };
  const proxiedStreams = await provider.getVideoSources(detail.episodes[0].url, {});
  const proxiedRaw = proxiedStreams.find(stream => stream.label.includes("Japanese Audio"));
  assert.ok(proxiedRaw, "proxied Japanese HLS stream must be returned");
  const proxiedUrl = new URL(proxiedRaw.url);
  assert.equal(proxiedUrl.origin, "https://proxy.example.workers.dev");
  assert.equal(proxiedUrl.pathname, "/m3u8");
  assert.equal(proxiedUrl.searchParams.get("url"), "https://cdn.example/raw-master.m3u8");
  assert.equal(proxiedUrl.searchParams.get("mid"), "MEDIA-EP1");
  assert.equal(proxiedUrl.searchParams.get("token"), "test-proxy-token");
  assert.ok(proxiedStreams.some(stream => stream.url === "https://cdn.example/raw-master.mpd"),
    "DASH is not routed through the HLS Worker");
  delete global.__settings;

  provider._clearCache();
  const movie = await provider.getDetail(search[1].url, {});
  assert.equal(movie.title, "Kaiju No. 8: Mission");
  assert.equal(movie.episodes.length, 1);
  assert.equal(movie.episodes[0].contentType, "movie");
  const movieStreams = await provider.getVideoSources(movie.episodes[0].url, {});
  assert.ok(movieStreams.some(stream => stream.url === "https://cdn.example/raw-master.m3u8"));
  assert.ok(calls.some(call => call.url === API + "/movie/MOV1/media/hls/ja-JP"));

  const direct = await provider.getVideoSources(API + "/episode/EP1/media/dash/ja-JP", {});
  assert.ok(direct.some(stream => stream.url === "https://cdn.example/raw-master.m3u8"));

  const invalid = await provider.getVideoSources("not-a-crunchyanime-url", {});
  assert.deepEqual(invalid, []);

  console.log("Crunchy-anime search, catalogue, metadata, pagination, movie, locale, subtitle, dub and stream-variant tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
