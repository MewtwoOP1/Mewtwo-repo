import assert from "node:assert/strict";
import provider from "../providers/uniquestream.js";

const BASE = "https://anime.uniquestream.net";
const TIMEOUT_MS = 15000;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": BASE + "/",
  "Origin": BASE,
};

async function request(url) {
  let response;
  try {
    response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Error("NETWORK ERROR " + url + ": " + String(error));
  }
  const body = await response.text();
  console.log("HTTP", response.status, response.headers.get("content-type") || "(no content-type)", url);
  if (!response.ok) throw new Error("HTTP " + response.status + " from " + url + ": " + body.slice(0, 220));
  try {
    return JSON.parse(body.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("NON-JSON response from " + url + ": " + body.slice(0, 220));
  }
}

function asRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function main() {
  // Search API uses query + page/t/limit; the HTML /search page is not the data source.
  const searchUrl = BASE + "/api/v1/search?page=1&query=" +
    encodeURIComponent("Solo Leveling") + "&t=all&limit=6";
  const search = await request(searchUrl);
  const series = Array.isArray(search?.series) ? search.series : [];
  const movies = Array.isArray(search?.movies) ? search.movies : [];
  console.log("SEARCH SHAPE", JSON.stringify({
    keys: Object.keys(search || {}),
    series: series.length,
    movies: movies.length,
    sample: (series[0] || movies[0])?.title || null,
  }));
  assert.ok(series.length + movies.length > 0,
    "Search API returned no series or movies; response keys=" + Object.keys(search || {}).join(","));

  const popularUrl = BASE + "/api/v1/videos/popular?page=1&limit=10&type=all";
  const popular = await request(popularUrl);
  const popularRows = asRows(popular);
  console.log("POPULAR SHAPE", JSON.stringify({
    isArray: Array.isArray(popular),
    rows: popularRows.length,
    first: popularRows[0]?.title || null,
  }));
  assert.ok(popularRows.length > 0, "Popular API returned no rows");

  const firstSeries = series.find((row) => row?.content_id) || null;
  if (firstSeries) {
    const detail = await request(BASE + "/api/v1/series/" + encodeURIComponent(firstSeries.content_id));
    assert.ok(detail?.title, "Series endpoint returned no title");
    assert.ok(Array.isArray(detail?.seasons), "Series endpoint returned no seasons array");
    console.log("DETAIL SHAPE", JSON.stringify({
      title: detail.title,
      contentId: detail.content_id,
      seasons: detail.seasons.length,
      episodeCount: detail.seasons.reduce((n, season) => n + Number(season.episode_count || 0), 0),
    }));
    const season = detail.seasons.find((row) => row?.content_id);
    if (season) {
      const episodeUrl = BASE + "/api/v1/season/" + encodeURIComponent(season.content_id) +
        "/episodes?page=1&limit=20&order_by=asc";
      const episodes = asRows(await request(episodeUrl));
      assert.ok(episodes.length > 0, "Season endpoint returned no episodes for " + season.content_id);
      console.log("EPISODES SHAPE", JSON.stringify({
        season: season.title || season.content_id,
        count: episodes.length,
        first: episodes[0]?.title || null,
        episodeId: episodes[0]?.content_id || null,
      }));
    }
  }
  // Exercise the actual Zangetsu provider adapter too, not only raw API URLs.
  const providerResults = await provider.search("Solo Leveling", 1);
  console.log("PROVIDER SEARCH", JSON.stringify({
    version: provider.version,
    count: providerResults.length,
    sample: providerResults[0]?.title || null,
    url: providerResults[0]?.url || null,
  }));
  assert.ok(providerResults.length > 0,
    "Zangetsu provider.search returned no results despite a working live search API");

  const home = await provider.getHome();
  console.log("PROVIDER HOME", JSON.stringify({
    sections: home.length,
    count: home.reduce((n, section) => n + (Array.isArray(section.items) ? section.items.length : 0), 0),
    first: home[0]?.items?.[0]?.title || null,
  }));
  assert.ok(home.some((section) => Array.isArray(section.items) && section.items.length > 0),
    "Zangetsu provider.getHome returned no catalogue cards despite a working live popular API");

  const detail = await provider.getDetail(providerResults[0].url);
  console.log("PROVIDER DETAIL", JSON.stringify({
    title: detail.title,
    cover: Boolean(detail.cover),
    seasons: detail.seasons,
    episodeCount: detail.episodeCount,
    parsedEpisodes: detail.episodes?.length || 0,
  }));
  assert.ok(detail.title, "Zangetsu provider.getDetail returned no title");

  console.log("Uniquestream live API smoke passed.");
}

main().catch((error) => {
  console.error("Uniquestream live API smoke failed:", error && error.stack || String(error));
  process.exitCode = 1;
});
