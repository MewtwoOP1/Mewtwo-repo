const assert = require("node:assert/strict");
global.fetch = async function (url, opts) {
  url = String(url);
  if (url.includes("/api/v1/search?")) return { status: 200, body: JSON.stringify({
    limit: 36, offset: 0, total: 1, results: [
      { anime_id: "solo-leveling-abc", title: { romaji: "Solo Leveling" },
        cover_image: { large: "https://img.example/solo.jpg" }, anilist_id: 123 }
    ]
  }) };
  if (url === "https://reanime.to/api/v1/anime/solo-leveling-abc") return { status: 200, body: JSON.stringify({
    anime_id: "solo-leveling-abc", title: { romaji: "Solo Leveling", english: "Solo Leveling" },
    description: "Hunters fight monsters.", anilist_id: 123, mal_id: 999,
    cover_image: { large: "https://img.example/solo.jpg" }, subbed: 2, dubbed: 0
  }) };
  if (url === "https://reanime.to/api/v1/anime/solo-leveling-abc/episodes?limit=2000") return { status: 200, body: JSON.stringify({
    data: [
      { episode_number: 1, title: "I'm Used to It", episodeId: "episode-one" },
      { episode_number: 2, title: "If I Had One More Chance", episodeId: "episode-two" }
    ]
  }) };
  if (url === "https://reanime.to/api/flix/123/2") return { status: 200, body: JSON.stringify({
    success: true, servers: [
      { serverName: "Direct", dataType: "sub", dataLink: "https://cdn.example/episode.m3u8" }
    ]
  }) };
  if (url === "https://reanime.to/api/flix/123/1") return { status: 200, body: JSON.stringify({
    success: true, servers: [
      { serverName: "HD-2", dataType: "sub", dataLink: "https://flixcloud.cc/e/token123" }
    ]
  }) };
  if (url === "https://flixcloud.cc/e/token123") return { status: 200, body:
    '<script>const data = { type: "data", data: { video: "encoded", subtitles: [], intro_chapter: null, outro_chapter: null }, uses: [] };</script>' };
  if (url === "https://enc-dec.app/api/dec-flixcloud?type=token" && opts && opts.method === "POST") {
    return { status: 200, body: JSON.stringify({ status: 200, result: { token: "tok123", context: { ctx: "token-context" } } }) };
  }
  if (url === "https://flixcloud.cc/api/m3u8/tok123") {
    return { status: 200, body: JSON.stringify({ encrypted: "manifest" }) };
  }
  if (url === "https://enc-dec.app/api/dec-flixcloud?type=stream" && opts && opts.method === "POST") {
    return { status: 200, body: JSON.stringify({ status: 200, result: {
      stream: "https://cdn.example/master.m3u8?token=abc", context: { w_payload: "payload value" }
    } }) };
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
  const streams = await provider.getVideoSources("solo-leveling-abc|2|episode-two|123", {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/episode.m3u8");
  assert.equal(streams[0].container, "hls");
  const resolved = await provider.getVideoSources("solo-leveling-abc|1|episode-one|123", {});
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].url, "https://enc-dec.app/api/parse-flixcloud?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8%3Ftoken%3Dabc&w_payload=payload%20value");
  assert.equal(resolved[0].container, "hls");
  console.log("Re:Anime upstream API and direct/download URL tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
