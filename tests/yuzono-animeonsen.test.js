const assert = require("node:assert/strict");
const requests = [];
global.fetch = async function (url, opts) {
  url = String(url); opts = opts || {}; requests.push({ url, method: opts.method || "GET" });
  if (url === "https://www.animeonsen.xyz/") return { status: 200, body: '<html><meta name="ao-search-token" content="search-token-123"></html>' };
  if (url === "https://auth.animeonsen.xyz/oauth/token") return { status: 200, body: JSON.stringify({ access_token: "api-token" }) };
  if (url === "https://search.animeonsen.xyz/indexes/content/search") return { status: 200, body: JSON.stringify({
    hits: [{ content_id: "solo-leveling", content_title: "Solo Leveling", content_title_en: "Solo Leveling", content_image: "https://img.example/solo.jpg" }]
  }) };
  if (url === "https://api.animeonsen.xyz/v4/content/index?start=0&limit=30") return { status: 200, body: JSON.stringify({
    content: [{ content_id: "solo-leveling", content_title: "Solo Leveling", content_image: "https://img.example/solo.jpg" }],
    cursor: { next: [false] }
  }) };
  if (url === "https://api.animeonsen.xyz/v4/content/solo-leveling/extensive") return { status: 200, body: JSON.stringify({
    content_id: "solo-leveling", content_title: "Solo Leveling", content_title_en: "Solo Leveling",
    mal_id: 999, mal_data: { synopsis: "Hunters fight monsters.", genres: [{ name: "Action" }], status: "finished_airing" }
  }) };
  if (url === "https://api.animeonsen.xyz/v4/content/solo-leveling/episodes") return { status: 200, body: JSON.stringify({
    "1": { contentTitle_episode_en: "I'm Used to It" }, "2": { contentTitle_episode_en: "If I Had One More Chance" }
  }) };
  if (url === "https://api.animeonsen.xyz/v4/content/solo-leveling/video/2") return { status: 200, body: JSON.stringify({
    metadata: { subtitles: { en: "English" } },
    uri: { stream: "https://cdn.example/animeonsen/master.m3u8", subtitles: { en: "https://cdn.example/subs/2.ass" } }
  }) };
  return { status: 404, body: "{}" };
};
const provider = require("../providers/yuzono-animeonsen.js");
async function main() {
  assert.equal(provider.getInfo().name, "AnimeOnsen (Yuzono)");
  const search = await provider.search("Solo Leveling", 1, {});
  assert.equal(search.length, 1);
  assert.equal(search[0].id, "solo-leveling");
  const home = await provider.getHome({});
  assert.equal(home[0].items[0].title, "Solo Leveling");
  const detail = await provider.getDetail("solo-leveling", {});
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.malId, 999);
  const streams = await provider.getVideoSources("solo-leveling|2", {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/animeonsen/master.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].subtitles[0].url, "https://cdn.example/subs/2.ass");
  assert.ok(requests.some(r => r.url === "https://auth.animeonsen.xyz/oauth/token" && r.method === "POST"));
  assert.ok(requests.some(r => r.url === "https://search.animeonsen.xyz/indexes/content/search" && r.method === "POST"));
  console.log("AnimeOnsen authenticated API, catalogue, episode and HLS tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
