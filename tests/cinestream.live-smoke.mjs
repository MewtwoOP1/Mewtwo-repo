import assert from "node:assert/strict";

const timeoutMs = 12000;
const baseCatalog = "https://cinemeta-catalogs.strem.io";
const metaApi = "https://v3-cinemeta.strem.io";
const kitsuCatalog = "https://anime-kitsu.strem.fun";

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  assert.equal(response.ok, true, url + " returned HTTP " + response.status + ": " + body.slice(0, 160));
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(url + " returned invalid JSON: " + body.slice(0, 160));
  }
}

async function main() {
  const movieCatalog = await getJson(baseCatalog + "/top/catalog/movie/top/skip=0.json");
  assert.ok(Array.isArray(movieCatalog.metas) && movieCatalog.metas.length > 0,
    "Live Cinemeta movie catalogue returned no metas");
  const movie = movieCatalog.metas.find((row) => /^tt\d+$/.test(String(row.id)) && row.type === "movie");
  assert.ok(movie, "Live Cinemeta movie catalogue returned no valid IMDb movie entry");
  const movieResponse = await getJson(metaApi + "/meta/movie/" + encodeURIComponent(movie.id) + ".json");
  const movieMeta = movieResponse.meta || movieResponse;
  assert.ok(movieMeta.name || movieMeta.title, "Live movie metadata contains no title");
  assert.ok(String(movieMeta.id || movie.id).length > 0, "Live movie metadata contains no id");

  // A known series provides a stable check of the episodes contract independently
  // of whichever title happens to be first in the live popular catalogue.
  let seriesMeta = null;
  let seriesSource = metaApi + "/meta/series/tt0903747.json";
  try {
    const response = await getJson(seriesSource);
    seriesMeta = response.meta || response;
  } catch (_) {
    const seriesCatalog = await getJson(baseCatalog + "/top/catalog/series/top/skip=0.json");
    assert.ok(Array.isArray(seriesCatalog.metas) && seriesCatalog.metas.length > 0,
      "Live Cinemeta series catalogue returned no metas");
    const candidate = seriesCatalog.metas.find((row) => /^tt\d+$/.test(String(row.id)) && row.type === "series");
    assert.ok(candidate, "Live Cinemeta series catalogue returned no valid IMDb series entry");
    seriesSource = metaApi + "/meta/series/" + encodeURIComponent(candidate.id) + ".json";
    const response2 = await getJson(seriesSource);
    seriesMeta = response2.meta || response2;
  }

  assert.ok(seriesMeta && (seriesMeta.name || seriesMeta.title), "Live series metadata contains no title");
  assert.ok(Array.isArray(seriesMeta.videos), "Live series metadata does not contain a videos array");
  const episodes = seriesMeta.videos.filter((ep) =>
    Number(ep.season) > 0 && Number(ep.episode) > 0 &&
    (!ep.released || Number.isNaN(Date.parse(ep.released)) || Date.parse(ep.released) <= Date.now())
  );
  assert.ok(episodes.length > 0, "Live series metadata returned no released episodes");

  const kitsu = await getJson(kitsuCatalog + "/catalog/anime/kitsu-anime-airing/skip=0.json");
  assert.ok(Array.isArray(kitsu.metas) && kitsu.metas.length > 0,
    "Live Kitsu airing-anime catalogue returned no metas");

  console.log("CineStream LIVE smoke passed.");
  console.log(JSON.stringify({
    movieCatalogue: movieCatalog.metas.length,
    sampleMovie: movieMeta.name || movieMeta.title,
    series: seriesMeta.name || seriesMeta.title,
    releasedEpisodes: episodes.length,
    kitsuCatalogue: kitsu.metas.length,
  }, null, 2));
}

main().catch((error) => {
  console.error("CineStream LIVE smoke failed:", error && error.stack || String(error));
  process.exitCode = 1;
});
