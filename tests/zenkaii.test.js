const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const requestLog = [];
let graphQlFallbackCalls = 0;

global.__settings = {
  zenkaii: { server: "megaplay", audio: "sub" },
};

// Avoid real-world waits while still exercising the provider's serialized
// request queue and cooldown state.
const originalSetTimeout = global.setTimeout;
global.setTimeout = (fn) => originalSetTimeout(fn, 0);

function json(status, value) {
  return { status, body: JSON.stringify(value) };
}

global.fetch = async (url, options = {}) => {
  const requestUrl = String(url);
  requestLog.push({ url: requestUrl, options });

  if (requestUrl.startsWith("https://animap.id/api/search?")) {
    const parsed = new URL(requestUrl);
    const query = parsed.searchParams.get("q") || "";
    if (/Solo Leveling/i.test(query)) {
      return json(200, [{
        mal_id: 52299,
        anilist_id: [195604],
        titles: ["Solo Leveling", "Ore dake Level Up na Ken"],
        year: 2024
      }]);
    }
    if (/One Piece/i.test(query)) {
      return json(200, [{
        mal_id: 21,
        anilist_id: [21],
        titles: ["One Piece", "ワンピース"],
        year: 1999
      }]);
    }
    return json(200, []);
  }

  if (requestUrl === "https://animap.id/api/anilist/195604") {
    return json(200, {
      anilist_id: 195604,
      id_mal: 52299,
      title_romaji: "Ore dake Level Up na Ken",
      title_english: "Solo Leveling",
      title_native: "俺だけレベルアップな件",
      synonyms: ["I Level Up Alone"],
      format: "TV",
      status: "RELEASING",
      season_year: 2024,
      episodes: 12,
      description: "A hunter grows stronger.",
      genres: ["Action", "Fantasy"],
      studios: ["A-1 Pictures"],
      cover_image: "https://img.example/cover.jpg",
      banner_image: "https://img.example/banner.jpg"
    });
  }

  if (requestUrl === "https://animap.id/api/anilist/21") {
    return json(200, {
      anilist_id: 21,
      id_mal: 21,
      title_romaji: "One Piece",
      title_english: "One Piece",
      title_native: "ワンピース",
      synonyms: [],
      format: "TV",
      status: "RELEASING",
      season_year: 1999,
      episodes: 0,
      description: "A pirate adventure.",
      genres: ["Action", "Adventure"],
      studios: ["Toei Animation"],
      cover_image: "https://img.example/one-piece.jpg",
      banner_image: null
    });
  }

  if (requestUrl === "https://animap.id/api/mal/21") {
    return json(200, {
      mal_id: 21,
      title: "One Piece",
      title_english: "One Piece",
      episodes: 1242,
      status: "Currently Airing",
      genres: ["Action", "Adventure"],
      studios: ["Toei Animation"],
      synopsis: "A pirate adventure.",
      image_url: "https://img.example/one-piece-mal.jpg"
    });
  }

  if (requestUrl === "https://animap.id/api/anilist/21/raw") {
    return json(200, {
      id: 21,
      idMal: 21,
      nextAiringEpisode: { episode: 1243 }
    });
  }

  if (requestUrl === "https://graphql.anilist.co") {
    const request = JSON.parse(options.body || "{}");
    if (request.query && request.query.includes("Page(page: 1")) {
      return json(200, {
        data: {
          Page: {
            media: [{
              id: 195604,
              idMal: 52299,
              title: { english: "Solo Leveling", romaji: "Ore dake Level Up na Ken" },
              format: "TV",
              status: "RELEASING",
              seasonYear: 2024,
              episodes: 12,
              nextAiringEpisode: null,
              averageScore: 86,
              description: "A hunter grows stronger.",
              genres: ["Action", "Fantasy"],
              studios: { nodes: [{ name: "A-1 Pictures" }] },
              coverImage: { extraLarge: "https://img.example/cover.jpg", large: null },
              bannerImage: "https://img.example/banner.jpg",
              synonyms: ["I Level Up Alone"]
            }]
          }
        }
      });
    }

    if (request.query && request.query.includes("media(search: $search")) {
      graphQlFallbackCalls += 1;
      return {
        status: 429,
        headers: { "retry-after": "60" },
        body: JSON.stringify({
          errors: [{ status: 429, message: "Too Many Requests." }],
          data: null
        })
      };
    }

    if (request.query && request.query.includes("Media(id: $id")) {
      return json(200, { data: { Media: null } });
    }
  }

  throw new Error("Unexpected test URL: " + requestUrl);
};

const provider = require("../providers/zenkaii.js");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "index.json"), "utf8"));
const source = manifest.sources.find((item) => item.id === "zenkaii");

async function main() {
  assert.ok(source, "Zenkai Player must be registered in index.json");
  assert.equal(source.version, provider.version);
  assert.equal(source.name, provider.getInfo().name);
  assert.equal(source.logo, provider.getInfo().logo);
  assert.equal(source.type, provider.getInfo().type);
  assert.equal(provider.getInfo().version, "1.1.0");

  const settings = provider.getSettings();
  assert.deepEqual(settings.map((x) => x.key), ["server", "audio"]);
  assert.deepEqual(source.settings.map((x) => x.key), ["server", "audio"]);

  assert.equal(provider.buildEmbedUrl(195604, 1, "megaplay", "sub"),
    "https://zenkaii.pages.dev/embed?id=195604&ep=1&server=megaplay&audio=sub");
  assert.equal(provider.buildEmbedUrl(195604, 12, "vidstream", "dub"),
    "https://zenkaii.pages.dev/embed?id=195604&ep=12&server=vidstream&audio=dub");
  assert.equal(provider.buildEmbedUrl(195604, 2, "flixcloud", "sub"),
    "https://zenkaii.pages.dev/embed?id=195604&ep=2&server=flixcloud&audio=sub");
  assert.equal(provider.buildEmbedUrl(195604, 3, "acdn", "dub"),
    "https://zenkaii.pages.dev/embed?id=195604&ep=3&server=acdn&audio=dub");
  assert.equal(provider.buildEmbedUrl(0, 1, "megaplay", "sub"), null);
  assert.equal(provider.buildEmbedUrl(195604, 0, "megaplay", "sub"), null);
  assert.equal(provider.buildEmbedUrl(195604, 1, "bad-server", "sub"), null);
  assert.equal(provider.buildEmbedUrl(195604, 1, "megaplay", "bad-audio"), null);

  assert.equal(provider._parseAniListId("anilist://195604"), 195604);
  assert.equal(provider._parseAniListId("195604"), 195604);
  assert.equal(provider._parseAniListId({ anilistId: 195604 }), 195604);
  assert.equal(provider._parseAniListId("not-an-id"), null);

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].items[0].anilistId, 195604);
  assert.equal(home[0].items[0].malId, 52299);

  const results = await provider.search("Solo Leveling", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Solo Leveling (2024)");
  assert.equal(results[0].anilistId, 195604);
  assert.equal(results[0].malId, 52299);
  assert.equal(results[0].cover, "https://img.example/cover.jpg");

  // Repeated searches use AniMap's cache instead of hammering AniList or
  // re-fetching metadata for the same mapping.
  const repeated = await provider.search("Solo Leveling", 1, {});
  assert.equal(repeated.length, 1);
  assert.equal(
    requestLog.filter((x) => x.url.startsWith("https://animap.id/api/search?") &&
      new URL(x.url).searchParams.get("q") === "Solo Leveling").length,
    1
  );

  const detail = await provider.getDetail("anilist://195604", {});
  assert.equal(detail.anilistId, 195604);
  assert.equal(detail.malId, 52299);
  assert.equal(detail.episodes.length, 12);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.studios[0], "A-1 Pictures");
  const parsedEpisode = JSON.parse(detail.episodes[0].url);
  assert.equal(parsedEpisode.anilistId, 195604);
  assert.equal(parsedEpisode.episode, 1);

  const episodeList = await provider.getEpisodes("195604", {});
  assert.equal(episodeList.length, 12);

  const subSources = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(subSources.length, 1);
  assert.equal(subSources[0].url,
    "https://zenkaii.pages.dev/embed?id=195604&ep=1&server=megaplay&audio=sub");
  assert.equal(subSources[0].container, "unknown");
  assert.equal(subSources[0].kind, "sub");
  assert.equal(subSources[0].audioLang, "ja");

  global.__settings.zenkaii = { server: "acdn", audio: "dub" };
  const dubSources = await provider.getVideoSources(detail.episodes[1].url, {});
  assert.equal(dubSources[0].url,
    "https://zenkaii.pages.dev/embed?id=195604&ep=2&server=acdn&audio=dub");
  assert.equal(dubSources[0].kind, "dub");
  assert.equal(dubSources[0].audioLang, "en");

  // Long-running anime: AniList can leave its total episodes unset. The
  // provider now fills it from the mapped MAL record and can exceed 500 eps.
  const onePieceSearch = await provider.search("One Piece", 1, {});
  assert.equal(onePieceSearch.length, 1);
  const onePiece = await provider.getDetail(onePieceSearch[0].url, {});
  assert.equal(onePiece.anilistId, 21);
  assert.equal(onePiece.malId, 21);
  assert.equal(onePiece.episodes.length, 1242);
  assert.equal(JSON.parse(onePiece.episodes[1241].url).episode, 1242);
  assert.equal(provider._episodeCount({
    id: 21, format: "TV", episodes: null,
    nextAiringEpisode: { episode: 1243 }
  }), 1242);

  // If AniMap has no mapping and AniList returns HTTP 429, the provider must
  // respect the cooldown instead of retrying each alias immediately.
  assert.deepEqual(await provider.search("Rate Limit Test", 1, {}), []);
  assert.deepEqual(await provider.search("Rate Limit Test Alias", 1, {}), []);
  assert.equal(graphQlFallbackCalls, 1);
  assert.ok(provider._debug.cooldownRemaining() > 0);

  assert.deepEqual(await provider.getVideoSources("invalid"), []);
  assert.deepEqual(await provider.getVideoSources(JSON.stringify({
    anilistId: 195604, episode: 0
  })), []);
  assert.deepEqual(await provider.getVideoSources(JSON.stringify({
    anilistId: 195604, episode: 1242
  })).then((rows) => rows.length), 1);

  console.log("Zenkaii AniMap/AniList metadata and playback tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.setTimeout = originalSetTimeout;
});
