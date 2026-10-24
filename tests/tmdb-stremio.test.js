const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const calls = [];
global.__settings = {
  "tmdb-stremio": {
    tmdbApiKey: "test-user-key",
    addonUrls: "https://addon.example/manifest.json?token=secret\nhttps://second.example/manifest.json",
    enableAddonCatalogs: false,
    showP2P: false,
    maxStreamsPerAddon: "10",
  },
};

global.fetch = async (url) => {
  const requestUrl = String(url);
  calls.push(requestUrl);
  let body = {};

  if (requestUrl.includes("https://catalog.example/manifest.json")) {
    body = {
      id: "catalog-only",
      name: "Catalog Add-on",
      resources: ["catalog", "stream"],
      types: ["movie", "series"],
      catalogs: [{
        type: "series",
        id: "popular",
        name: "Popular",
        extra: [{ name: "search" }],
      }],
    };
  } else if (requestUrl.includes("/catalog/series/popular")) {
    body = {
      metas: [{
        id: "tt222",
        type: "series",
        name: "Catalog Show",
        poster: "https://img.example/catalog-poster.jpg",
        background: "https://img.example/catalog-background.jpg",
        description: "Catalogue-provided description",
        releaseInfo: "2022",
        genres: ["Drama"],
      }],
    };
  } else if (requestUrl.includes("/trending/movie/week")) {
    body = { results: [{ id: 11, title: "Mock Film", release_date: "2024-01-01", poster_path: "/poster.jpg", media_type: "movie", vote_average: 7.8 }] };
  } else if (requestUrl.includes("/trending/tv/week")) {
    body = { results: [{ id: 22, name: "Mock Show", first_air_date: "2022-01-01", media_type: "tv", vote_average: 8.2 }] };
  } else if (requestUrl.includes("/movie/popular") || requestUrl.includes("/tv/popular")) {
    body = { results: [] };
  } else if (requestUrl.includes("/search/multi")) {
    body = { results: [{ id: 11, title: "Mock Film", release_date: "2024-01-01", media_type: "movie" }] };
  } else if (requestUrl.includes("/find/tt222")) {
    body = { tv_results: [{ id: 22, name: "Mock Show", first_air_date: "2022-01-01" }], movie_results: [] };
  } else if (requestUrl.includes("/tv/22?")) {
    body = { id: 22, name: "Mock Show", first_air_date: "2022-01-01", number_of_seasons: 1, external_ids: { imdb_id: "tt222" }, genres: [{ name: "Drama" }] };
  } else if (requestUrl.includes("/tv/22/season/1")) {
    body = { episodes: [{ episode_number: 1, name: "Pilot", air_date: "2022-01-02" }] };
  } else if (requestUrl.includes("/manifest.json")) {
    body = { id: "mock-addon", resources: ["stream"] };
  } else if (requestUrl.includes("/stream/series/tt222%3A1%3A1.json")) {
    body = { streams: [{ name: "Mock Add-on", title: "1080p", url: "https://cdn.example/video.m3u8", behaviorHints: { proxyHeaders: { request: { Referer: "https://addon.example/" } } } }] };
  }

  return { status: 200, body: JSON.stringify(body) };
};

const provider = require("../providers/tmdb-stremio.js");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "index.json"), "utf8"));
const source = manifest.sources.find((item) => item.id === "tmdb-stremio");

async function main() {
  assert.ok(source, "TMDB + Stremio must be registered in index.json");
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo, "provider and manifest logos should stay in sync");

  const settings = provider.getSettings();
  assert.deepEqual(settings.map((setting) => setting.key), [
    "tmdbApiKey",
    "addonUrls",
    "enableAddonCatalogs",
    "showP2P",
    "maxStreamsPerAddon",
  ]);
  assert.ok(settings.every((setting) => setting.description && setting.label));
  assert.equal(settings.find((setting) => setting.key === "enableAddonCatalogs").default, false);
  assert.equal(provider._combinedSettings().useAddonCatalogs, false);
  assert.equal(provider._combinedSettings().showP2P, false);
  assert.equal(provider._combinedSettings().max, 10);
  assert.deepEqual(provider._parseAddonUrls(global.__settings["tmdb-stremio"].addonUrls).map(provider._manifestUrl), [
    "https://addon.example/manifest.json?token=secret",
    "https://second.example/manifest.json",
  ]);

  const fenixUrl = "https://fenix.example/qualities=4k,1080p,720p,sd|audio=dublado,legendado|catalogs=popular_movie,popular_series/manifest.json";
  assert.deepEqual(provider._parseAddonUrls(fenixUrl).map(provider._manifestUrl), [fenixUrl],
    "commas inside a configured manifest path must not be treated as URL separators");

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

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/video.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].headers.Referer, "https://addon.example/");
  assert.equal(await provider.getStreams(detail.episodes[0].url, {}).then((rows) => rows.length), 1);

  // Regression: a Stremio add-on with catalog + stream resources but no meta
  // resource must still open from its cached catalogue item and resolve episodes
  // from TMDB using the catalogue item's IMDb ID.
  global.__settings["tmdb-stremio"].addonUrls = "https://catalog.example/manifest.json";
  global.__settings["tmdb-stremio"].enableAddonCatalogs = true;
  assert.equal(provider._combinedSettings().useAddonCatalogs, true);

  const addonHome = await provider.getHome({});
  assert.equal(addonHome.length, 1);
  assert.equal(addonHome[0].title, "Catalog Add-on · Popular");
  assert.equal(addonHome[0].items.length, 1);
  assert.equal(addonHome[0].items[0].title, "Catalog Show");

  const addonSearch = await provider.search("Mock", 1, {});
  assert.equal(addonSearch.length, 1);
  assert.equal(addonSearch[0].title, "Catalog Show");

  const addonDetail = await provider.getDetail(addonHome[0].items[0].url, {});
  assert.equal(addonDetail.title, "Catalog Show");
  assert.equal(addonDetail.cover, "https://img.example/catalog-poster.jpg");
  assert.equal(addonDetail.tmdbId, 22);
  assert.equal(addonDetail.episodes.length, 1);
  assert.match(addonDetail.episodes[0].url, /"imdbId":"tt222"/);

  const addonStreams = await provider.getVideoSources(addonDetail.episodes[0].url, {});
  assert.equal(addonStreams.length, 1);
  assert.equal(addonStreams[0].url, "https://cdn.example/video.m3u8");
  assert.ok(calls.some((url) => url.includes("/catalog/series/popular.json")));
  assert.ok(calls.some((url) => url.includes("/find/tt222?external_source=imdb_id")));
  assert.ok(calls.some((url) => url.includes("/stream/series/tt222%3A1%3A1.json")));

  const tmdbCalls = calls.filter((url) => url.includes("themoviedb.org"));
  assert.ok(tmdbCalls.length > 0);
  assert.ok(tmdbCalls.every((url) => url.includes("api_key=test-user-key")));
  const addOnCalls = calls.filter((url) => url.includes("addon.example") || url.includes("second.example") || url.includes("catalog.example"));
  assert.ok(addOnCalls.length > 0);
  assert.ok(addOnCalls.every((url) => !url.includes("test-user-key")));
  assert.ok(addOnCalls.some((url) => url.includes("?token=secret")));

  // Honor manifest ID prefixes, rather than query unsupported identifier variants.
  global.__settings["tmdb-stremio"].addonUrls = "https://prefix.example/manifest.json";
  global.fetch = async (url) => {
    const u = String(url); calls.push(u); let body = {};
    if (u.includes("prefix.example/manifest.json")) body = { id:"prefix-addon", types:["movie","series"], resources:[{name:"stream",types:["series"],idPrefixes:["tt"]}] };
    else if (u.includes("/stream/series/tt222%3A1%3A1.json")) body = { streams:[{name:"Prefix match",url:"https://cdn.example/prefix.m3u8"}] };
    return {status:200,body:JSON.stringify(body)};
  };
  const prefixStart = calls.length;
  const prefixStreams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(prefixStreams.length,1);
  const prefixRequests = calls.slice(prefixStart).filter((url)=>url.includes("/stream/series/"));
  assert.ok(prefixRequests.length>0);
  assert.ok(prefixRequests.every((url)=>/\/stream\/series\/tt/.test(decodeURIComponent(url))));

  // P2P results require explicit opt-in and valid content hashes.
  global.__settings["tmdb-stremio"].addonUrls = "https://torrent.example/manifest.json";
  global.fetch = async (url) => {
    const u=String(url); calls.push(u); let body={};
    if(u.includes("torrent.example/manifest.json"))body={id:"torrent-addon",types:["movie","series"],resources:["stream"]};
    else if(u.includes("/stream/series/tt222%3A1%3A1.json"))body={streams:[
      {name:"Torrent magnet",title:"1080p",url:"magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567"},
      {name:"Torrent hash",infoHash:"abcdef0123456789abcdef0123456789abcdef01"},
      {name:"Bad magnet",url:"magnet:?xt=urn:btih:not-a-valid-hash"}
    ]};
    return {status:200,body:JSON.stringify(body)};
  };
  global.__settings["tmdb-stremio"].showP2P=false;
  assert.equal((await provider.getVideoSources(detail.episodes[0].url,{})).length,0);
  global.__settings["tmdb-stremio"].showP2P=true;
  const torrentStreams=await provider.getVideoSources(detail.episodes[0].url,{});
  assert.equal(torrentStreams.length,2);
  assert.ok(torrentStreams.every((row)=>row.container==="torrent"));
  assert.ok(torrentStreams.some((row)=>row.url==="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567"));
  assert.ok(torrentStreams.some((row)=>row.url==="magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01"));
  assert.ok(torrentStreams.every((row)=>!row.headers||Object.keys(row.headers).length===0));

  const animeIds=provider._parseStreamId(JSON.stringify({id:"tmdb://tv/22",type:"anime",tmdbId:22,imdbId:"tt222",malId:30831,anilistId:21202,kitsuId:10941,anidbId:11261,tvdbId:333,season:1,episode:2}));
  assert.equal(animeIds.type,"series");
  assert.ok(animeIds.ids.includes("mal:30831:2"));
  assert.ok(animeIds.ids.includes("mal:30831:1:2"));
  assert.ok(animeIds.ids.includes("anilist:21202:2"));
  assert.ok(animeIds.ids.includes("kitsu:10941:1:2"));
  assert.ok(animeIds.ids.includes("anidb:11261:1:2"));
  assert.ok(animeIds.ids.includes("tvdb:333:1:2"));
  const routeIds=provider._parseStreamId("zm://anime/mal:61469/ep/2");
  assert.equal(routeIds.type,"series");
  assert.ok(routeIds.ids.includes("mal:61469:2"));
  const noTmdbIds = provider._parseStreamId(JSON.stringify({ id:"tmdb://tv/0", type:"series", season:1, episode:1 }));
  assert.equal(noTmdbIds.ids.length, 0, "placeholder TMDB ID 0 must not be queried");

  // Bound TMDB season lookup fan-out on long-running shows.
  global.__settings["tmdb-stremio"].addonUrls="";
  global.__settings["tmdb-stremio"].tmdbApiKey="";
  let running=0,peak=0;
  global.fetch=async(url)=>{
    const u=new URL(String(url));
    if(u.pathname==="/3/tv/777")return{status:200,body:JSON.stringify({id:777,name:"Long Running Show",number_of_seasons:8,external_ids:{imdb_id:"tt777",tvdb_id:"777"},seasons:Array.from({length:8},(_,i)=>({season_number:i+1,episode_count:1}))})};
    const m=u.pathname.match(/^\/3\/tv\/777\/season\/(\d+)$/);
    if(m){running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,5));running--;return{status:200,body:JSON.stringify({episodes:[{episode_number:1,season_number:Number(m[1]),name:"Episode"}]})};}
    return{status:200,body:JSON.stringify({})};
  };
  const longShow=await provider.getDetail("tmdb://tv/777",{});
  assert.equal(longShow.episodes.length,8);
  assert.ok(peak<=5);

  // Retry custom-key requests on TMDB's alternate host when the trailing-dot host is unreachable.
  global.__settings["tmdb-stremio"].addonUrls = "";
  global.__settings["tmdb-stremio"].tmdbApiKey = "personal-key";
  const tmdbHostCalls = [];
  global.fetch = async (url) => {
    const u = new URL(String(url));
    tmdbHostCalls.push({ host: u.hostname, path: u.pathname, key: u.searchParams.get("api_key") });
    if (u.hostname === "api.themoviedb.org.") throw new Error("Failed host lookup");
    if (u.hostname === "api.tmdb.org") return { status: 200, body: JSON.stringify({
      results: [{ id: 41, title: "Fallback Film", release_date: "2025-01-01", media_type: "movie" }]
    }) };
    throw new Error("Unexpected TMDB host " + u.hostname);
  };
  const fallbackSearch = await provider.search("fallback", 1, {});
  assert.equal(fallbackSearch[0].title, "Fallback Film (2025)");
  assert.ok(tmdbHostCalls.some((call) => call.host === "api.themoviedb.org." && call.key === "personal-key"));
  assert.ok(tmdbHostCalls.some((call) => call.host === "api.tmdb.org" && call.key === "personal-key"));

  // Empty append_to_response external_ids must not cause a duplicate request.
  global.__settings["tmdb-stremio"].tmdbApiKey = "";
  const emptyExternalCalls = [];
  global.fetch = async (url) => {
    const u = new URL(String(url));
    emptyExternalCalls.push(u.pathname);
    if (u.pathname === "/3/tv/888") return { status: 200, body: JSON.stringify({
      id: 888, name: "No External IDs", number_of_seasons: 1,
      external_ids: {}, seasons: [{ season_number: 1, episode_count: 1 }]
    }) };
    if (u.pathname === "/3/tv/888/season/1") return { status: 200, body: JSON.stringify({
      episodes: [{ episode_number: 1, season_number: 1, name: "Pilot" }]
    }) };
    throw new Error("Unexpected TMDB request " + u.pathname);
  };
  const noExternalIds = await provider.getDetail("tmdb://tv/888", {});
  assert.equal(noExternalIds.episodes.length, 1);
  assert.equal(emptyExternalCalls.includes("/3/tv/888/external_ids"), false,
    "empty append_to_response external_ids must not cause a duplicate API call");

  global.__settings["tmdb-stremio"].tmdbApiKey="";
  assert.ok(provider._tmdbRequestUrl("/trending/movie/week").startsWith("https://api.themoviedb.org/3/"));
  console.log("TMDB + Stremio combined provider tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
