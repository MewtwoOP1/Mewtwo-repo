const assert = require("node:assert/strict");
global.fetch = async function (url) {
  url = String(url);
  if (url.includes("/api/search?")) return { status: 200, body: JSON.stringify({ data: [
    { slug: "solo-leveling-abc", title: "Solo Leveling", cover_image: { large: "https://img.example/solo.jpg" } }
  ] }) };
  if (url === "https://reanime.to/api/watch/solo-leveling-abc/1") return { status: 200, body: JSON.stringify({
    anime: { slug: "solo-leveling-abc", title: "Solo Leveling", description: "Hunters fight monsters." },
    episode_links: []
  }) };
  if (url === "https://reanime.to/api/episodes/solo-leveling-abc") return { status: 200, body: JSON.stringify([
    { number: 1, title: "I'm Used to It", id: "1" }, { number: 2, title: "If I Had One More Chance", id: "2" }
  ]) };
  if (url === "https://reanime.to/api/watch/solo-leveling-abc/2") return { status: 200, body: JSON.stringify({
    anime: { slug: "solo-leveling-abc", title: "Solo Leveling", anilist: 123 },
    episode_links: [
      { serverName: "HD-2", dataType: "sub", dataLink: "https://flixcloud.cc/e/token?v=2" },
      { serverName: "Direct", dataType: "sub", dataLink: "https://cdn.example/episode.m3u8" }
    ]
  }) };
  if (url === "https://reanime.to/api/watch/solo-leveling-abc/1") return { status: 200, body: JSON.stringify({
    anime: { slug: "solo-leveling-abc", title: "Solo Leveling", anilist: 123 },
    episode_links: [{ serverName: "HD-2", dataType: "sub", dataLink: "https://flixcloud.cc/e/token?v=2" }]
  }) };
  if (url === "https://lvrcdn2.rewcrew.lv/watch/reanime/123/sub/reanime-1") return { status: 200, body: JSON.stringify({
    streams: [{ url: "https://cdn.example/resolved.m3u8", type: "hls", server: "HD-2", referer: "https://flixcloud.cc/" }]
  }) };
  return { status: 404, body: "{}" };
};
const provider = require("../providers/reanime.js");
async function main() {
  assert.equal(provider.getInfo().name, "Re:Anime");
  assert.equal(provider.getInfo().type, "anime");
  const results = await provider.search("Solo Leveling", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "solo-leveling-abc");
  assert.equal(results[0].cover, "https://img.example/solo.jpg");
  const detail = await provider.getDetail("solo-leveling-abc", {});
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 1);
  const streams = await provider.getVideoSources("solo-leveling-abc|2", {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/episode.m3u8");
  assert.equal(streams[0].container, "hls");
  const fallback = await provider.getVideoSources("solo-leveling-abc|1", {});
  assert.equal(fallback[0].url, "https://cdn.example/resolved.m3u8");
  assert.equal(fallback[0].container, "hls");
  assert.ok(fallback[0].headers.Referer);
  console.log("Re:Anime catalogue/episode/direct-stream tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
