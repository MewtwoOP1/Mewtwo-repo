const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const calls = [];
const SETTINGS_ID = "serenity-cinestream";
global.__settings = {
  [SETTINGS_ID]: {
    audioLanguage: "auto",
    timeout: "12000",
    catalog: "both",
    sameTitle: "series",
    metadataCatalogs: ["cinemeta", "tmdb", "simkl"],
    tmdbApiKey: "test-tmdb-key",
    simklClientId: "test-simkl-client",
    simklAccessToken: "",
    streamSources: ["vaplayer", "stremio"],
    addonUrls: "https://addon.example/manifest.json?token=addon-secret",
    maxStreamsPerAddon: "10",
    concurrency: "6",
    providerOrder: "vaplayer,stremio,torrentio,torrentsdb",
    wyzieSubsKey: "",
    subtitles: true,
    streamServer: "all",
  },
};

global.fetch = async (url, options = {}) => {
  const requestUrl = String(url);
  calls.push({ url: requestUrl, options });
  let body = {};

  if (requestUrl.includes("cinemeta-catalogs.strem.io")) {
    body = {
      metas: [{
        id: "tt1111111", type: "movie", name: "Cine Mock",
        poster: "https://img.example/cine.jpg", imdbRating: "7.8",
      }],
      hasMore: true,
    };
  } else if (requestUrl.includes("anime-kitsu.strem.fun")) {
    body = {
      metas: [{
        id: "kitsu:123", type: "anime", name: "Kitsu Mock",
        poster: "https://img.example/kitsu.jpg",
      }],
      hasMore: true,
    };
  } else if (requestUrl.includes("v3-cinemeta.strem.io/catalog/movie/top/search=")) {
    body = { metas: [{ id: "tt1111111", type: "movie", name: "Cine Mock", poster: "https://img.example/cine.jpg" }] };
  } else if (requestUrl.includes("v3-cinemeta.strem.io/catalog/series/top/search=")) {
    body = { metas: [{ id: "tt2222222", type: "series", name: "TMDB Mock Show" }] };
  } else if (requestUrl.includes("/meta/movie/tt1111111.json")) {
    body = { meta: {
      id: "tt1111111", type: "movie", name: "Cine Mock",
      description: "Fictional test movie", year: "2024", poster: "https://img.example/cine.jpg",
      videos: [],
    } };
  } else if (requestUrl.includes("api.themoviedb.org")) {
    if (requestUrl.includes("/search/multi")) {
      body = { page: 1, total_pages: 1, results: [{
        id: 22, media_type: "tv", name: "TMDB Mock Show",
        first_air_date: "2022-01-01", poster_path: "/poster.jpg",
      }] };
    } else if (requestUrl.includes("/tv/22/season/1")) {
      body = { episodes: [{
        id: 221, episode_number: 1, season_number: 1, name: "Pilot",
        air_date: "2022-01-02", still_path: "/still.jpg",
      }] };
    } else if (requestUrl.includes("/tv/22/external_ids")) {
      body = { imdb_id: "tt2222222" };
    } else if (requestUrl.includes("/tv/22?")) {
      body = {
        id: 22, name: "TMDB Mock Show", first_air_date: "2022-01-01",
        poster_path: "/poster.jpg", backdrop_path: "/backdrop.jpg",
        status: "Returning Series", overview: "A mock show",
        genres: [{ name: "Drama" }], external_ids: { imdb_id: "tt2222222" },
        seasons: [{ season_number: 1 }],
        credits: { cast: [{ name: "Mock Actor", character: "Pilot" }] },
        videos: { results: [{ key: "abc123", site: "YouTube", type: "Trailer" }] },
      };
    } else {
      body = { page: 1, total_pages: 1, results: [{
        id: 22, media_type: "tv", name: "TMDB Mock Show",
        first_air_date: "2022-01-01", poster_path: "/poster.jpg",
      }] };
    }
  } else if (requestUrl.includes("data.simkl.in")) {
    body = [{
      title: "Simkl Mock", year: 2020, poster: "12345",
      ids: { simkl: 301, imdb: "tt3333333" }, url: "/movies/301/simkl-mock", type: "movie",
    }];
  } else if (requestUrl.includes("api.simkl.com/search")) {
    body = [{
      title: "Simkl Search Mock", year: 2020, poster: "12345",
      ids: { simkl: 301, imdb: "tt3333333" }, url: "/movies/301/simkl-mock", type: "movie",
    }];
  } else if (requestUrl.includes("api.simkl.com")) {
    body = { movie: { title: "Simkl API item", year: 2020, ids: { simkl: 301, imdb: "tt3333333" }, type: "movie" } };
  } else if (requestUrl.includes("streamdata.vaplayer.ru")) {
    body = { data: { stream_urls: ["https://cdn.example/vaplayer.mp4"] }, default_subs: [] };
  } else if (requestUrl.includes("addon.example") && requestUrl.includes("/manifest.json")) {
    body = { name: "Mock add-on", resources: ["stream"] };
  } else if (requestUrl.includes("addon.example") && requestUrl.includes("/stream/")) {
    body = { streams: [{
      name: "Mock add-on stream", title: "1080p", url: "https://cdn.example/addon.mp4",
      behaviorHints: { proxyHeaders: { request: { Referer: "https://addon.example/" } } },
    }] };
  } else if (requestUrl.includes("sub.wyzie.io")) {
    body = [];
  }

  return { status: 200, body: JSON.stringify(body), text: async () => JSON.stringify(body) };
};

const provider = require("../providers/serenity-cinestream.js");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "index.json"), "utf8"));
const source = manifest.sources.find((item) => item.id === SETTINGS_ID);

async function main() {
  assert.ok(source, "CineStream must remain registered in index.json");
  assert.equal(source.version, "0.3.0");
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);

  const settingDefs = provider.getSettings();
  assert.deepEqual(settingDefs.map((s) => s.key), source.settings.map((s) => s.key));
  assert.ok(settingDefs.every((s) => s.label && s.description && s.type));
  assert.ok(settingDefs.find((s) => s.key === "metadataCatalogs").options.some((o) => o.value === "simkl"));
  assert.ok(settingDefs.find((s) => s.key === "streamSources").options.some((o) => o.value === "stremio"));

  const home = await provider.getHome({});
  assert.ok(home.length >= 45, "CineStream, TMDB and Simkl catalogues should be available together");
  for (const title of ["Top Movies", "Top Series", "Airing Anime", "Trending", "Popular Movies", "Trending Movies Today", "Top Rated Anime"]) {
    assert.ok(home.some((row) => row.title === title), "Missing catalogue: " + title);
  }
  assert.ok(home.every((row) => Array.isArray(row.items)), "Each catalogue should return a list");

  const results = await provider.search("Mock", 1);
  assert.ok(results.some((item) => item.title === "Cine Mock"), "Cinemeta search result missing");
  assert.ok(results.some((item) => item.title === "TMDB Mock Show"), "TMDB search result missing");
  assert.ok(results.some((item) => item.title === "Simkl Search Mock"), "Simkl search result missing");

  const tmdbItem = results.find((item) => item.title === "TMDB Mock Show" && decodeURIComponent(item.url).includes('"engine":"tmdb"'));
  assert.ok(tmdbItem.url.startsWith("cinestream://item?data="), "TMDB results must use a restorable provider URL");
  const detail = await provider.getDetail(tmdbItem.url);
  assert.equal(detail.title, "TMDB Mock Show");
  assert.equal(detail.tmdbId, 22);
  assert.equal(detail.tmdbIsTv, true);
  assert.equal(detail.imdbId, "tt2222222");
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].title, "S1E1 · Pilot");
  assert.equal(detail.cast[0].name, "Mock Actor");
  assert.equal(detail.trailer, "https://www.youtube.com/watch?v=abc123");

  const streams = await provider.getVideoSources(detail.episodes[0].url);
  assert.ok(streams.some((s) => s.url === "https://cdn.example/vaplayer.mp4"), "VaPlayer stream missing");
  assert.ok(streams.some((s) => s.url === "https://cdn.example/addon.mp4"), "Stremio add-on stream missing");
  assert.equal(streams.find((s) => s.url === "https://cdn.example/addon.mp4").headers.Referer, "https://addon.example/");
  assert.equal(await provider.getStreams(detail.episodes[0].url).then((rows) => rows.length), streams.length);

  const tmdbCalls = calls.filter((c) => c.url.includes("api.themoviedb.org"));
  assert.ok(tmdbCalls.length > 0, "TMDB endpoint must be queried");
  assert.ok(tmdbCalls.every((c) => c.url.includes("api_key=test-tmdb-key")), "Custom TMDB key must reach TMDB requests");
  const addonCalls = calls.filter((c) => c.url.includes("addon.example"));
  assert.ok(addonCalls.length > 0, "Configured Stremio add-on must be queried");
  assert.ok(addonCalls.every((c) => !c.url.includes("test-tmdb-key")), "TMDB key must not leak to add-ons");
  assert.ok(addonCalls.every((c) => c.url.includes("token=addon-secret")), "Configured add-on token must be retained only on that add-on");
  assert.ok(calls.some((c) => c.url.includes("streamdata.vaplayer.ru")), "VaPlayer endpoint must be queried");
  console.log("CineStream mocked catalogue, metadata, episodes, streams, settings and key-isolation tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
