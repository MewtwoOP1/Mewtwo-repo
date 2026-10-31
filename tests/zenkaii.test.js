const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const requestLog = [];
global.__settings = {
  zenkaii: { server: "megaplay", audio: "sub" },
};

global.fetch = async (url, options = {}) => {
  requestLog.push({ url: String(url), options });
  const body = JSON.parse(options.body || "{}");
  const vars = body.variables || {};
  let data;

  if (body.query && body.query.includes("Page(page: 1")) {
    data = { Page: { media: [{
      id: 195604,
      title: { english: "Solo Leveling", romaji: "Ore dake Level Up na Ken" },
      format: "TV",
      status: "RELEASING",
      seasonYear: 2024,
      episodes: 12,
      averageScore: 86,
      description: "A hunter grows stronger.",
      genres: ["Action", "Fantasy"],
      coverImage: { extraLarge: "https://img.example/cover.jpg", large: null },
      bannerImage: "https://img.example/banner.jpg"
    }] } };
  } else if (body.query && body.query.includes("media(search: $search")) {
    data = { Page: { media: [{
      id: 195604,
      title: { english: "Solo Leveling" },
      format: "TV",
      episodes: 12,
      seasonYear: 2024,
      coverImage: { extraLarge: "https://img.example/cover.jpg" }
    }] } };
  } else if (body.query && body.query.includes("Media(id: $id")) {
    assert.equal(vars.id, 195604);
    data = { Media: {
      id: 195604,
      title: { english: "Solo Leveling", romaji: "Ore dake Level Up na Ken" },
      format: "TV",
      status: "RELEASING",
      seasonYear: 2024,
      episodes: 12,
      averageScore: 86,
      description: "A hunter grows stronger.",
      genres: ["Action", "Fantasy"],
      coverImage: { extraLarge: "https://img.example/cover.jpg" },
      bannerImage: "https://img.example/banner.jpg"
    } };
  } else {
    data = {};
  }
  return { status: 200, body: JSON.stringify({ data }) };
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

  const results = await provider.search("Solo Leveling", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Solo Leveling (2024)");

  const detail = await provider.getDetail("anilist://195604", {});
  assert.equal(detail.anilistId, 195604);
  assert.equal(detail.episodes.length, 12);
  assert.equal(detail.episodes[0].number, 1);
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

  assert.deepEqual(await provider.getVideoSources("invalid"), []);
  assert.deepEqual(await provider.getVideoSources(JSON.stringify({
    anilistId: 195604, episode: 0
  })), []);

  assert.ok(requestLog.every((call) => call.url === "https://graphql.anilist.co"));
  console.log("Zenkaii provider mocked integration tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
