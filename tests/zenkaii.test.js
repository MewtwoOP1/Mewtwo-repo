const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCipheriv } = require("node:crypto");
global.base64ToBytes = (value) => Array.from(Buffer.from(value, "base64"));

const requestLog = [];
let graphQlFallbackCalls = 0;
let hostRateLimitCalls = 0;
let throwAniListRateLimit = false;

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
    if (/Fallback Sample/i.test(query)) {
      return json(200, [{
        mal_id: 999,
        anilist_id: [999],
        titles: ["Fallback Sample"],
        year: 2022
      }]);
    }
    if (/GraphQL Fallback/i.test(query)) {
      return { status: 503, body: "AniMap temporarily unavailable" };
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

  if (requestUrl === "https://animap.id/api/anilist/999") {
    return { status: 404, body: JSON.stringify({ error: "Not fetched" }) };
  }

  if (requestUrl === "https://animap.id/api/mal/999") {
    return json(200, {
      mal_id: 999,
      title: "Fallback Sample",
      title_english: "Fallback Sample",
      episodes: 24,
      year: 2022,
      image_url: "https://img.example/fallback-sample.jpg",
      genres: ["Drama"],
      studios: ["Sample Studio"]
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
      episodes: 0,
      status: "Currently Airing",
      genres: ["Action", "Adventure"],
      studios: ["Toei Animation"],
      synopsis: "A pirate adventure.",
      image_url: "https://img.example/one-piece-mal.jpg"
    });
  }

  if (requestUrl === "https://animap.id/api/anilist/195604/raw") {
    return json(200, { id: 195604, idMal: 52299, averageScore: 86 });
  }

  if (requestUrl === "https://animap.id/api/anilist/21/raw") {
    return json(200, {
      id: 21,
      idMal: 21,
      title: { english: "One Piece", romaji: "One Piece" },
      nextAiringEpisode: { episode: 1243 },
      averageScore: 83
    });
  }

  if (requestUrl === "https://animap.id/api/v1/map/anilist/333") {
    return { status: 404, body: JSON.stringify({ error: "Not mapped" }) };
  }

  if (requestUrl === "https://animap.id/api/anilist/777") {
    return { status: 404, body: JSON.stringify({ error: "Not fetched" }) };
  }

  if (requestUrl === "https://animap.id/api/v1/map/anilist/777") {
    return json(200, {
      sources: [
        "https://anilist.co/anime/777",
        "https://myanimelist.net/anime/777"
      ],
      title: "Mapped Detail",
      type: "TV",
      status: "FINISHED",
      episodes: 0,
      animeSeason: { season: "SPRING", year: 2019 },
      picture: "https://img.example/mapped-detail.jpg",
      thumbnail: "https://img.example/mapped-detail.jpg",
      synonyms: ["Mapped Alias"],
      studios: ["Mapped Studio"],
      tags: ["Mystery"]
    });
  }

  if (requestUrl === "https://animap.id/api/mal/777") {
    return json(200, {
      mal_id: 777,
      title: "Mapped Detail",
      episodes: 24,
      synopsis: "Description from MAL metadata.",
      image_url: "https://img.example/mal-mapped-detail.jpg",
      genres: ["Mystery"]
    });
  }

  if (requestUrl === "https://animap.id/api/anilist/777/raw") {
    return json(200, { id: 777, idMal: 777, averageScore: 81 });
  }

  if (requestUrl.startsWith("https://zenkaii.pages.dev/api/stream?")) {
    const parsed = new URL(requestUrl);
    assert.equal(parsed.searchParams.get("server"), "acdn");
    assert.equal(parsed.searchParams.get("id"), "195604");
    assert.equal(parsed.searchParams.get("title"), "Solo Leveling");
    assert.equal(parsed.searchParams.get("format"), "TV");
    if (parsed.searchParams.get("ep") === "4") {
      return json(404, { error: "No multi-audio stream found on ACDN for this episode" });
    }
    assert.equal(parsed.searchParams.get("ep"), "1");
    return json(200, {
      success: true,
      server: "ACDN",
      audio: "multi",
      multiAudio: true,
      streamUrl: "https://proxy-publish-pilot.lovable.app/api/public/proxy?url=" +
        encodeURIComponent("https://ravok.buzz/cdn/hls/test/master.m3u8?md5=fixture-token&expires=1793469632") +
        "&referer=" + encodeURIComponent("https://ravok.buzz/") + "&seg=1",
      subtitles: [],
      intro: null,
      outro: null
    });
  }

  if (requestUrl.startsWith("https://zenkaii.pages.dev/api/servers?")) {
    const parsed = new URL(requestUrl);
    assert.equal(parsed.searchParams.get("id"), "195604");
    assert.equal(parsed.searchParams.get("ep"), "1");
    return json(200, {
      success: true,
      servers: {
        megaplay: { sub: true, dub: true },
        vidstream: { sub: true, dub: false },
        flixcloud: { sub: true, dub: true },
        acdn: { sub: true, dub: true, multi: true }
      }
    });
  }

  if (requestUrl === "https://megaplay.buzz/stream/ani/195604/1/sub?s=bcdn") {
    return { status: 200, body: '<div data-id="7788"></div>' };
  }
  if (requestUrl === "https://megaplay.buzz/stream/getSources?id=7788&s=bcdn") {
    return json(200, {
      sources: { file: "https://cdn.example/solo-leveling-sub.m3u8" },
      tracks: [
        { file: "https://cdn.example/english.vtt", label: "English", kind: "captions", default: true },
        { file: "https://cdn.example/thumbs.vtt", label: "Thumbnails", kind: "thumbnails" }
      ]
    });
  }
  if (requestUrl === "https://megaplay.buzz/stream/ani/195604/2/dub?s=vidstream") {
    return { status: 200, body: '<div data-id="8899"></div>' };
  }
  if (requestUrl === "https://megaplay.buzz/stream/getSources?id=8899&s=vidstream") {
    const payload = JSON.stringify({
      sources: [{ file: "https://cdn.example/solo-leveling-dub.m3u8" }],
      tracks: [{ file: "https://cdn.example/dub-en.vtt", label: "English", kind: "captions" }]
    });
    const key = Buffer.alloc(32); Buffer.from("i?LMTAx0Q6,:}50U").copy(key);
    const iv = Buffer.from("W0;27ToaUpl_P%'c");
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    return json(200, { enc: encrypted.toString("base64url") });
  }
  if (requestUrl === "https://megaplay.buzz/stream/ani/195604/3/sub?s=vidstream") {
    return { status: 200, body: '<div data-id="9900"></div>' };
  }
  if (requestUrl === "https://megaplay.buzz/stream/getSources?id=9900&s=vidstream") {
    return json(200, { sources: { file: "https://cdn.example/solo-leveling-episode-3.mp4" } });
  }
  if (requestUrl === "https://megaplay.buzz/stream/ani/195604/4/sub?s=bcdn" ||
      requestUrl === "https://megaplay.buzz/stream/ani/195604/4/sub?s=vidstream") {
    return { status: 404, body: "not available" };
  }
  if (requestUrl === "https://megaplay.buzz/stream/ani/195604/3/sub?s=bcdn") {
    return { status: 200, body: "<html>not available</html>" };
  }
  if (requestUrl === "https://graphql.anilist.co") {
    const request = JSON.parse(options.body || "{}");
    const vars = request.variables || {};
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
      if (vars.search === "Host Rate Limit" && throwAniListRateLimit) {
        hostRateLimitCalls += 1;
        throw new Error("DioException [request cancelled]: null");
      }
      if (vars.search === "GraphQL Fallback") {
        return json(200, {
          data: {
            Page: {
              media: [{
                id: 333,
                idMal: 444,
                title: { english: "GraphQL Fallback", romaji: "GraphQL Fallback" },
                format: "TV",
                status: "FINISHED",
                seasonYear: 2020,
                episodes: 3,
                averageScore: 75,
                description: "GraphQL fallback metadata.",
                genres: ["Drama"],
                studios: { nodes: [{ name: "Fallback Studio" }] },
                coverImage: { extraLarge: "https://img.example/graphql-fallback.jpg" },
                bannerImage: null,
                synonyms: []
              }]
            }
          }
        });
      }
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
      assert.equal(vars.id, 333);
      return json(200, {
        data: {
          Media: {
            id: 333,
            idMal: 444,
            title: { english: "AniList Detail Fallback", romaji: "AniList Detail Fallback" },
            format: "TV",
            status: "FINISHED",
            seasonYear: 2020,
            episodes: 3,
            averageScore: 75,
            description: "AniList detail fallback metadata.",
            genres: ["Drama"],
            studios: { nodes: [{ name: "Fallback Studio" }] },
            coverImage: { extraLarge: "https://img.example/graphql-fallback.jpg" },
            bannerImage: null,
            synonyms: []
          }
        }
      });
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
  assert.equal(source.version, "1.4.0");
  assert.equal(provider.getInfo().version, "1.4.0");

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
  const aniListCalls = requestLog.filter((call) => call.url === "https://graphql.anilist.co");
  assert.ok(aniListCalls.length > 0);
  assert.ok(aniListCalls.every((call) => call.options.headers.Referer === "https://anilist.co/"),
    "AniList requests must carry the app-required Referer header");

  const results = await provider.search("Solo Leveling", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Solo Leveling (2024)");
  assert.equal(results[0].anilistId, 195604);
  assert.equal(results[0].malId, 52299);
  assert.equal(results[0].cover, null, "Search should return mapping cards without per-result metadata fetches");
  assert.equal(
    requestLog.filter((x) => /^https:\/\/animap\.id\/api\/anilist\/\d+$/.test(x.url)).length,
    0,
    "AniMap search must not fetch each result's metadata record"
  );

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
  assert.equal(detail.score, undefined, "Fast parsed metadata does not make a second /raw request for score");
  assert.equal(detail.episodes[0].embedUrl,
    "https://zenkaii.pages.dev/embed?id=195604&ep=1&server=megaplay&audio=sub");
  const parsedEpisode = JSON.parse(detail.episodes[0].url);
  assert.equal(parsedEpisode.anilistId, 195604);
  assert.equal(parsedEpisode.episode, 1);
  assert.equal(parsedEpisode.providerVersion, "1.4.0",
    "Versioned episode URLs must invalidate previous stream cache entries");
  assert.equal(parsedEpisode.format, "TV", "Store AniList format for ACDN movie/series routing");

  const episodeList = await provider.getEpisodes("195604", {});
  assert.equal(episodeList.length, 12);

  // Official public MegaPlay direct route, resolved using the same data-id ->
  // getSources -> AES-CBC decode flow as the repository's MegaPlay provider.
  assert.equal(provider.getEmbedUrl(detail.episodes[0].url),
    "https://zenkaii.pages.dev/embed?id=195604&ep=1&server=megaplay&audio=sub");
  const subSources = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(subSources.length, 1);
  assert.equal(subSources[0].url, "https://cdn.example/solo-leveling-sub.m3u8");
  assert.equal(subSources[0].container, "hls");
  assert.equal(subSources[0].kind, "sub");
  assert.equal(subSources[0].audioLang, "ja");
  assert.equal(subSources[0].headers.Referer, "https://megaplay.buzz/");
  assert.equal(subSources[0].subtitles.length, 1);
  assert.equal(subSources[0].subtitles[0].url, "https://cdn.example/english.vtt");
  assert.ok(requestLog.some((x) => x.url === "https://megaplay.buzz/stream/ani/195604/1/sub?s=bcdn"));
  assert.ok(requestLog.some((x) => x.url === "https://megaplay.buzz/stream/getSources?id=7788&s=bcdn"));

  // VidStream's direct route can return encrypted AES-CBC sources. Ensure the
  // local decrypter yields an actual media URL and subtitle tracks.
  global.__settings.zenkaii = { server: "vidstream", audio: "dub" };
  const dubSources = await provider.getVideoSources(detail.episodes[1].url, {});
  assert.equal(dubSources.length, 1);
  assert.equal(dubSources[0].url, "https://cdn.example/solo-leveling-dub.m3u8");
  assert.equal(dubSources[0].container, "hls");
  assert.equal(dubSources[0].kind, "dub");
  assert.equal(dubSources[0].audioLang, "en");
  assert.equal(dubSources[0].subtitles.length, 1);
  assert.ok(requestLog.some((x) => x.url === "https://megaplay.buzz/stream/ani/195604/2/dub?s=vidstream"));

  // MP4 sources are classified separately from HLS playlists.
  global.__settings.zenkaii = { server: "vidstream", audio: "sub" };
  const mp4Source = await provider.getVideoSources(detail.episodes[2].url, {});
  assert.equal(mp4Source.length, 1);
  assert.equal(mp4Source[0].url, "https://cdn.example/solo-leveling-episode-3.mp4");
  assert.equal(mp4Source[0].container, "mp4");

  // If both direct resolvers have no source for the requested episode, the
  // provider returns an empty list rather than an HTML player page.
  global.__settings.zenkaii = { server: "flixcloud", audio: "sub" };
  assert.deepEqual(await provider.getVideoSources(detail.episodes[3].url, {}), []);

  // FlixCloud still falls back to the working public direct resolvers.
  global.__settings.zenkaii = { server: "flixcloud", audio: "sub" };
  const fallback = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(fallback.length, 1);
  assert.ok(fallback[0].label.includes("fallback from flixcloud"));

  // ACDN is a separate multi-audio route in Zenkai. It must call the official
  // /api/stream?server=acdn endpoint with the X-Zenkai-Embed marker. If the
  // returned proxy wraps a signed CDN URL, try that URL directly first with
  // its upstream Referer, while keeping the proxy as a fallback.
  global.__settings.zenkaii = { server: "acdn", audio: "dub" };
  const acdnSources = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(acdnSources.length, 2);
  assert.equal(acdnSources[0].url,
    "https://ravok.buzz/cdn/hls/test/master.m3u8?md5=fixture-token&expires=1793469632");
  assert.equal(acdnSources[0].container, "hls");
  assert.equal(acdnSources[0].kind, "dub");
  assert.equal(acdnSources[0].audioLang, "multi");
  assert.ok(acdnSources[0].label.includes("ACDN"));
  assert.equal(acdnSources[0].headers.Referer, "https://ravok.buzz/");
  assert.equal(acdnSources[0].headers.Origin, "https://ravok.buzz");
  assert.equal(acdnSources[1].url.startsWith(
    "https://proxy-publish-pilot.lovable.app/api/public/proxy?url="), true);
  assert.ok(acdnSources[1].label.includes("Proxy fallback"));
  const acdnRequest = requestLog.find((x) => x.url.startsWith("https://zenkaii.pages.dev/api/stream?"));
  assert.ok(acdnRequest, "ACDN selection must call the ACDN resolver route");
  assert.equal(acdnRequest.options.headers["X-Zenkai-Embed"], "1");
  assert.ok(acdnRequest.options.headers.Referer.includes("/embed?id=195604&ep=1&server=acdn"));

  // ACDN can legitimately have no mapping/source for a particular episode.
  // It must return no source rather than silently substituting MegaPlay or
  // VidStream while the user has explicitly selected ACDN.
  const directCallsBeforeMissingAcdn = requestLog.filter((x) =>
    x.url.startsWith("https://megaplay.buzz/stream/ani/195604/4/")).length;
  const missingAcdn = await provider.getVideoSources(detail.episodes[3].url, {});
  assert.deepEqual(missingAcdn, []);
  const directCallsAfterMissingAcdn = requestLog.filter((x) =>
    x.url.startsWith("https://megaplay.buzz/stream/ani/195604/4/")).length;
  assert.equal(directCallsAfterMissingAcdn, directCallsBeforeMissingAcdn);

  // The API's private /api/stream route is not used. HTML player pages are
  // never returned to Zangetsu as native media sources.
  assert.deepEqual(await provider.getStreams("invalid", {}), []);
  assert.deepEqual(await provider.getLinks("invalid", {}), []);
  assert.equal(requestLog.some((x) => x.url.includes("zenkaii.pages.dev/api/stream") &&
    new URL(x.url).searchParams.get("server") !== "acdn"), false);
  assert.equal(requestLog.some((x) => x.url.includes("zenkaii.pages.dev/embed")), false);
  assert.equal(requestLog.some((x) => x.url.includes("megaplay.buzz") && x.url.includes("getSources")), true);

  const availability = await provider.getServerAvailability(195604, 1, "Solo Leveling");
  assert.equal(availability.megaplay.sub, true);
  assert.equal(availability.acdn.multi, true);

  // Long-running anime: AniList can leave its total episodes unset. The
  // provider now fills it from the mapped MAL record and can exceed 500 eps.
  const onePieceSearch = await provider.search("One Piece", 1, {});
  assert.equal(onePieceSearch.length, 1);
  const onePiece = await provider.getDetail(onePieceSearch[0].url, {});
  assert.equal(onePiece.anilistId, 21);
  assert.equal(onePiece.malId, 21);
  assert.equal(onePiece.episodes.length, 1242,
    "When AniList and MAL totals are unknown, use the raw next-airing episode");
  assert.equal(onePiece.score, 83);
  assert.equal(JSON.parse(onePiece.episodes[1241].url).episode, 1242);
  assert.ok(requestLog.some((x) => x.url === "https://animap.id/api/anilist/21/raw"),
    "Fetch the raw AniList snapshot only for unresolved episode totals");
  assert.equal(provider._episodeCount({
    id: 21, format: "TV", episodes: null,
    nextAiringEpisode: { episode: 1243 }
  }), 1242);

  // If the parsed AniList snapshot is missing, the v1 map lookup recovers
  // the MAL ID, title, art and season metadata, and MAL supplies episode count.
  const mappedDetail = await provider.getDetail("anilist://777", {});
  const mapDetailRefresh = await provider.getDetail("anilist://777", {});
  assert.equal(mapDetailRefresh.title, "Mapped Detail");
  assert.equal(
    requestLog.filter((x) => x.url === "https://animap.id/api/anilist/777").length,
    1,
    "404 AniMap snapshots should be negative-cached across detail refreshes"
  );
  assert.equal(mappedDetail.title, "Mapped Detail");
  assert.equal(mappedDetail.malId, 777);
  assert.equal(mappedDetail.cover, "https://img.example/mapped-detail.jpg");
  assert.equal(mappedDetail.episodes.length, 24);
  assert.equal(mappedDetail.studios[0], "Mapped Studio");

  // When neither AniMap parsed metadata nor a cross-service map is available,
  // the official AniList detail query remains the final fallback.
  const directAniListDetail = await provider.getDetail("anilist://333", {});
  assert.equal(directAniListDetail.title, "AniList Detail Fallback");
  assert.equal(directAniListDetail.episodes.length, 3);
  assert.equal(directAniListDetail.score, 75);

  // If AniMap has no mapping and AniList returns HTTP 429, the provider must
  // respect the cooldown instead of retrying each alias immediately.
  assert.deepEqual(await provider.search("Rate Limit Test", 1, {}), []);
  assert.deepEqual(await provider.search("Rate Limit Test Alias", 1, {}), []);
  assert.equal(graphQlFallbackCalls, 1);
  assert.ok(provider._debug.cooldownRemaining() > 0);

  // When an AniList snapshot is not in AniMap yet, mapped MAL metadata still
  // supplies the display title and poster for the search result.
  const malFallback = await provider.search("Fallback Sample", 1, {});
  assert.equal(malFallback.length, 1);
  assert.equal(malFallback[0].cover, null, "Search results use the mapping index and defer poster loading to detail");
  assert.equal(malFallback[0].malId, 999);

  // Clear the cooldown from the preceding simulated HTTP 429 so this
  // separate case can verify a successful AniList fallback request.
  provider._debug.reset();

  // If AniMap is temporarily unavailable, a successful AniList GraphQL search
  // remains usable as a fallback.
  const graphQlFallback = await provider.search("GraphQL Fallback", 1, {});
  assert.equal(graphQlFallback.length, 1);
  assert.equal(graphQlFallback[0].anilistId, 333);

  // AniList can throw its own adapter exception instead of returning HTTP 429.
  // That error must establish the same cooldown, not trigger another network hit.
  provider._debug.reset();
  throwAniListRateLimit = true;
  const beforeHostLimit = hostRateLimitCalls;
  assert.deepEqual(await provider.search("Host Rate Limit", 1, {}), []);
  assert.ok(provider._debug.cooldownRemaining() >= 55000);
  assert.deepEqual(await provider.search("Host Rate Limit Alias", 1, {}), []);
  assert.equal(hostRateLimitCalls, beforeHostLimit + 1);

  assert.deepEqual(await provider.getVideoSources("invalid"), []);
  assert.equal(provider.getEmbedUrl("invalid"), null);
  assert.deepEqual(await provider.getVideoSources(JSON.stringify({
    anilistId: 195604, episode: 0
  })), []);
  assert.deepEqual(await provider.getVideoSources(JSON.stringify({
    anilistId: 195604, episode: 1242
  })), []);

  console.log("Zenkaii AniMap/AniList metadata and playback tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.setTimeout = originalSetTimeout;
});
