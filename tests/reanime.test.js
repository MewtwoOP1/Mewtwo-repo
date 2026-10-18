const assert = require("node:assert/strict");
global.fetch = async function (url, opts) {
  url = String(url);
  if (url.includes("/api/v1/search?")) return { status: 200, body: JSON.stringify({
    limit: 36, offset: 0, total: 1, results: [
      { anime_id: "solo-leveling-abc", title: { romaji: "Solo Leveling" },
        cover_image: { large: "https://img.example/solo.jpg" }, anilist_id: 1000000958 }
    ]
  }) };
  if (url === "https://reanime.to/api/v1/anime/solo-leveling-abc") return { status: 200, body: JSON.stringify({
    anime_id: "solo-leveling-abc", title: { romaji: "Solo Leveling", english: "Solo Leveling" },
    description: "Hunters fight monsters.", anilist_id: 1000000958, mal_id: 999,
    cover_image: { large: "https://img.example/solo.jpg" }, subbed: 2, dubbed: 0
  }) };
  if (url === "https://reanime.to/api/v1/anime/solo-leveling-abc/episodes?limit=2000") return { status: 200, body: JSON.stringify({
    data: [
      { episode_number: 1, title: "I'm Used to It", episodeId: "episode-one" },
      { episode_number: 2, title: "If I Had One More Chance", episodeId: "episode-two" }
    ]
  }) };
  if (url === "https://reanime.to/api/flix/1000000958/2") return { status: 200, body: JSON.stringify({
    success: true, servers: [
      { serverName: "Direct", dataType: "sub", dataLink: "https://cdn.example/episode.m3u8" }
    ]
  }) };
  if (url === "https://reanime.to/api/flix/1000000958/1") return { status: 200, body: JSON.stringify({
    success: true, servers: [
      { serverName: "HD-2", dataType: "sub", dataLink: "https://flixcloud.cc/e/token123" }
    ]
  }) };
  if (url === "https://flixcloud.cc/d/token123/__data.json") return { status: 200, body: JSON.stringify({
    fileId: "12345678-1234-1234-1234-123456789abc",
    token: "eyJheader.payload.signature",
    base: "https://fetch1.flixcloud.cc", resolution: "1080p"
  }) };
  if (url.includes("https://fetch1.flixcloud.cc/download/12345678-1234-1234-1234-123456789abc/progress?")) {
    return { status: 200, body: 'data: {"status":"ready"}\n\n' };
  }
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
  assert.equal(detail.episodes[0].url, "solo-leveling-abc|1|episode-one|1000000958", "AniList ID must be carried unchanged");
  const streams = await provider.getVideoSources("solo-leveling-abc|2|episode-two|1000000958", {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/episode.m3u8");
  assert.equal(streams[0].container, "hls");
  const resolved = await provider.getVideoSources("solo-leveling-abc|1|episode-one|1000000958", {});
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].url, "https://fetch1.flixcloud.cc/download/12345678-1234-1234-1234-123456789abc?token=eyJheader.payload.signature");
  assert.equal(resolved[0].container, "mkv");
  console.log("Re:Anime upstream API and direct/download URL tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
