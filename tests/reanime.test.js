const assert = require("node:assert/strict");
global.fetch = async function (url, opts) {
  url = String(url);
  if (url.includes("/api/v1/search?") && url.includes("q=CloudflareFallback")) {
    if (url.startsWith("https://reanime.to/")) {
      return { status: 403, body: "<html><title>Just a moment...</title><div id='cf-chl-widget'></div></html>", headers: { "cf-mitigated": "challenge" } };
    }
    if (url.startsWith("https://reanime.cz/")) return { status: 200, body: JSON.stringify({
      limit: 36, offset: 0, total: 1, results: [
        { anime_id: "cloudflare-fallback-title", title: { romaji: "Fallback Title" } }
      ]
    }) };
  }
  if (url.includes("/api/v1/search?") && url.includes("q=NeedsAnilist")) return { status: 200, body: JSON.stringify({
    limit: 36, offset: 0, total: 1, results: [
      { anime_id: "needs-anilist", title: { romaji: "Needs AniList" }, anilist_id: 0 }
    ]
  }) };
  if (url.includes("/api/v1/search?")) return { status: 200, body: JSON.stringify({
    limit: 36, offset: 0, total: 1, results: [
      { anime_id: "solo-leveling-abc", title: { romaji: "Solo Leveling" },
        cover_image: { large: "https://img.example/solo.jpg" }, anilist_id: 123 }
    ]
  }) };
  if (url === "https://reanime.to/api/v1/anime/needs-anilist") return { status: 200, body: JSON.stringify({
    anime_id: "needs-anilist", title: { romaji: "Needs AniList" }, anilist_id: 456789,
    season_year: 2026, start_date: { year: 2026 }, subbed: 1, dubbed: 0
  }) };
  if (url === "https://reanime.to/api/v1/anime/needs-anilist/episodes?limit=2000") return { status: 200, body: JSON.stringify({ data: [] }) };
  if (url === "https://reanime.to/api/v1/anime/solo-leveling-abc") return { status: 200, body: JSON.stringify({
    anime_id: "solo-leveling-abc", title: { romaji: "Solo Leveling", english: "Solo Leveling" },
    description: "Hunters fight monsters.", anilist_id: 123, mal_id: 999,
    cover_image: { large: "https://img.example/solo.jpg" }, season_year: 2025, subbed: 2, dubbed: 0
  }) };
  if (url === "https://reanime.to/api/v1/anime/solo-leveling-abc/episodes?limit=2000") return { status: 200, body: JSON.stringify({
    data: [
      { episode_number: 1, title: "I'm Used to It", episodeId: "episode-one" },
      { episode_number: 2, title: "If I Had One More Chance", episodeId: "episode-two" }
    ]
  }) };
  if (url === "https://reanime.to/api/watch/solo-leveling-abc/2") return { status: 200, body: JSON.stringify({
    anime: { anilist_id: 123 },
    episode_links: [{ serverName: "Watch API direct", dataType: "sub", dataLink: "https://cdn.example/episode.m3u8" }]
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
  if (url === "https://flixcloud.cc/d/token123/__data.json") return { status: 200, body: JSON.stringify({
    file_id: "12345678-1234-1234-1234-123456789abc",
    token: "eyJhbGciOiJub25lIn0.eyJleHAiOjF9.signature",
    base: "https://fetch1.flixcloud.cc",
    resolution: "1080p"
  }) };
  if (url === "https://fetch1.flixcloud.cc/download/12345678-1234-1234-1234-123456789abc/progress?token=eyJhbGciOiJub25lIn0.eyJleHAiOjF9.signature") {
    return { status: 200, body: 'data: {"status":"ready"}\n\n' };
  }
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
  assert.equal(provider.getInfo().version, "1.2.6");
  assert.equal(provider.version, "1.2.6");
  const results = await provider.search("Solo Leveling", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "solo-leveling-abc");
  assert.equal(results[0].cover, "https://img.example/solo.jpg");
  assert.equal(results[0].anilistId, 123,
    "Search cards must carry anilistId, or the app re-resolves the title via AniList");
  const missingAid = await provider.search("NeedsAnilist", 1, {});
  assert.equal(missingAid.length, 1);
  assert.equal(missingAid[0].anilistId, 456789,
    "A zero/missing card AniList ID must be filled from detail API without +/- arithmetic");
  const needsAidDetail = await provider.getDetail("needs-anilist", {});
  assert.equal(needsAidDetail.year, "2026",
    "Numeric season_year must be serialized as a string for the detail parser");
  const fallback = await provider.search("CloudflareFallback", 1, {});
  assert.equal(fallback.length, 1, "Re:Anime must rotate to a supported upstream domain after a Cloudflare Moment page");
  assert.equal(fallback[0].id, "cloudflare-fallback-title");
  const detail = await provider.getDetail("solo-leveling-abc", {});
  assert.equal(detail.anilistId, 123,
    "Detail must carry anilistId, or the app re-resolves the title via AniList");
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[0].url, "solo-leveling-abc|1|episode-one|123",
    "AniList ID must be carried verbatim with no +/- offset");
  const streams = await provider.getVideoSources("solo-leveling-abc|2|episode-two|123", {});
  assert.equal(streams.length, 1, "Watch API and /api/flix duplicate direct links must be deduplicated");
  assert.equal(streams[0].url, "https://cdn.example/episode.m3u8");
  assert.equal(streams[0].container, "hls");
  const resolved = await provider.getVideoSources("solo-leveling-abc|1|episode-one|123", {});
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].url, "https://fetch1.flixcloud.cc/download/12345678-1234-1234-1234-123456789abc?token=eyJhbGciOiJub25lIn0.eyJleHAiOjF9.signature");
  assert.equal(resolved[0].container, "mkv", "FlixCloud download is an MKV, not an MP4");
  assert.match(resolved[0].label, /Download/);
  assert.ok(!resolved[0].url.includes("parse-flixcloud"),
    "Manifest rewriting endpoint must not be mislabelled as a playable media URL");
  console.log("Re:Anime AniList, metadata schema, Cloudflare fallback, and direct-download tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
