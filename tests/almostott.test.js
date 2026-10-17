const assert = require("node:assert/strict");
const provider = require("../providers/almostott.js");
const fs = require("node:fs");
const path = require("node:path");

const calls = [];
global.__settings = {
  almostott: { tmdbApiKey: "test-user-key" },
};

global.fetch = async (url, options = {}) => {
  const requestUrl = String(url);
  calls.push({ url: requestUrl, options });
  let body = {};

  if (requestUrl.includes("/trending/movie/week")) {
    body = { results: [{ id: 11, title: "Mock Film", release_date: "2024-01-01", poster_path: "/poster.jpg", media_type: "movie", vote_average: 7.8 }] };
  } else if (requestUrl.includes("/trending/tv/week")) {
    body = { results: [{ id: 22, name: "Mock Show", first_air_date: "2022-01-01", media_type: "tv", vote_average: 8.2 }] };
  } else if (requestUrl.includes("/movie/popular") || requestUrl.includes("/tv/popular")) {
    body = { results: [] };
  } else if (requestUrl.includes("/search/multi")) {
    body = { results: [{ id: 11, title: "Mock Film", release_date: "2024-01-01", media_type: "movie" }] };
  } else if (requestUrl.includes("/tv/22?")) {
    body = { id: 22, name: "Mock Show", first_air_date: "2022-01-01", number_of_seasons: 1, external_ids: { imdb_id: "tt222" }, genres: [{ name: "Drama" }] };
  } else if (requestUrl.includes("/tv/22/season/1")) {
    body = { episodes: [{ episode_number: 1, name: "Pilot", air_date: "2022-01-02", still_path: "/still.jpg" }] };
  } else if (requestUrl.includes("enc-dec.app/api/enc-vidlink?text=22")) {
    body = { status: 200, result: "ENC22" };
  } else if (requestUrl.includes("vidlink.pro/api/b/tv/ENC22/1/1?multiLang=0")) {
    body = {
      sourceId: "mock",
      stream: {
        id: "primary",
        type: "file",
        qualities: {
          "720": { type: "mp4", url: "https://cdn.example/episode-720.mp4?signature=mock" },
          "1080": { type: "mp4", url: "https://cdn.example/episode-1080.mp4?signature=mock" },
          "360": { type: "mp4", url: "https://cdn.example/episode-360.mp4?signature=mock" },
        },
      },
      captions: [
        { url: "https://cdn.example/subtitles/en.srt?token=mock", language: "English", type: "srt" },
      ],
    };
  } else if (requestUrl.includes("enc-dec.app/api/enc-vidlink?text=11")) {
    body = { status: 200, result: "ENC11" };
  } else if (requestUrl.includes("vidlink.pro/api/b/movie/ENC11?multiLang=0")) {
    body = {
      stream: {
        qualities: {
          "480": { type: "mp4", url: "https://cdn.example/movie-480.mp4" },
        },
      },
    };
  } else {
    return { status: 404, body: JSON.stringify({ error: "not mocked", url: requestUrl }) };
  }

  return { status: 200, body: JSON.stringify(body) };
};

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "index.json"), "utf8"));
  const source = manifest.sources.find((item) => item.id === "almostott");

  assert.ok(source, "AlmostOTT must be registered in index.json");
  assert.equal(source.file, "providers/almostott.js");
  assert.equal(source.version, "1.0.1");
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().baseUrl, "https://almostott.aethoflix.world");
  assert.deepEqual(provider.getSettings().map((setting) => setting.key), ["tmdbApiKey"]);
  assert.equal(provider._combinedSettings().tmdbApiKey, "test-user-key");
  assert.ok(provider._tmdbRequestUrl("/trending/movie/week").includes("api_key=test-user-key"));

  const home = await provider.getHome({});
  assert.equal(home.length, 2);
  assert.equal(home[0].items[0].tmdbId, 11);
  assert.equal(home[1].items[0].tmdbIsTv, true);

  const search = await provider.search("Mock", 1, {});
  assert.equal(search[0].title, "Mock Film (2024)");

  const detail = await provider.getDetail("tmdb://tv/22", {});
  assert.equal(detail.tmdbId, 22);
  assert.equal(detail.tmdbIsTv, true);
  assert.equal(detail.imdbId, "tt222");
  assert.equal(detail.episodes.length, 1);
  const packedEpisode = JSON.parse(detail.episodes[0].url);
  assert.equal(packedEpisode.tmdbId, 22);
  assert.equal(packedEpisode.season, 1);
  assert.equal(packedEpisode.episode, 1);

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 3);
  assert.equal(streams[0].quality, "1080p", "best video quality should be first");
  assert.equal(streams[0].url, "https://cdn.example/episode-1080.mp4?signature=mock");
  assert.equal(streams[0].container, "mp4");
  assert.equal(streams[0].kind, "raw");
  assert.equal(streams[0].headers.Referer, "https://vidlink.pro/");
  assert.equal(streams[0].headers.Origin, "https://vidlink.pro");
  assert.equal(streams[0].subtitles.length, 1);
  assert.equal(streams[0].subtitles[0].format, "srt");
  assert.equal(streams[0].subtitles[0].lang, "English");
  assert.equal((await provider.getStreams(detail.episodes[0].url, {})).length, 3);

  const movieStreams = await provider.getVideoSources("tmdb://movie/11", {});
  assert.equal(movieStreams.length, 1);
  assert.equal(movieStreams[0].quality, "480p");
  assert.equal(movieStreams[0].url, "https://cdn.example/movie-480.mp4");

  assert.deepEqual(await provider.getVideoSources("not-a-tmdb-episode", {}), []);
  assert.deepEqual(await provider.getVideoSources("tmdb://tv/22", {}), [], "TV playback requires an episode number");
  assert.deepEqual(await provider.getVideoSources(JSON.stringify({ tmdbId: 22, type: "series" }), {}), []);

  const encoderCalls = calls.filter((call) => call.url.includes("enc-dec.app"));
  const playerCalls = calls.filter((call) => call.url.includes("vidlink.pro/api/b/"));
  assert.equal(encoderCalls.length, 3);
  assert.equal(playerCalls.length, 3);
  assert.ok(encoderCalls.every((call) => !call.url.includes("test-user-key")));
  assert.ok(playerCalls.every((call) => !call.url.includes("test-user-key")));
  assert.ok(playerCalls.every((call) => call.options.headers.Referer === "https://vidlink.pro/"));
  assert.ok(playerCalls.every((call) => call.options.headers.Origin === "https://vidlink.pro"));

  global.__settings.almostott.tmdbApiKey = "";
  assert.ok(provider._tmdbRequestUrl("/trending/movie/week").startsWith("https://api.themoviedb.org/3/"));

  // A broken VidLink API route must not prevent trying alternate player hosts.
  const embedCalls = [];
  global.extractVideo = async (url, options) => {
    embedCalls.push({ url, options });
    if (url === "https://tgvid.lovable.app/embed/movie/33") {
      return [{
        url: "https://cdn.example/site-player.m3u8",
        quality: "720p",
        container: "hls",
        label: "Extracted source",
        audioLang: "English",
        kind: "dub",
      }];
    }
    return [];
  };
  const fallback = await provider.getVideoSources("tmdb://movie/33", {});
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].url, "https://cdn.example/site-player.m3u8");
  assert.equal(fallback[0].server, "TgVid");
  assert.equal(fallback[0].label, "AlmostOTT · TgVid · Extracted source · English Dub");
  assert.ok(embedCalls.some((call) => call.url === "https://bingr.one/watch/movie/33"));
  assert.ok(embedCalls.some((call) => call.url === "https://vidstuck.xyz/embed/movie/33?color=ffffff"));
  assert.equal(
    provider._almostottPlayerUrl(
      { base: "https://bingr.one", movie: "/watch/movie/", tv: "/watch/tv/" },
      { id: "22", type: "tv", season: 1, episode: 1 },
    ),
    "https://bingr.one/watch/tv/22/1/1",
  );
  delete global.extractVideo;

  console.log("AlmostOTT provider tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
