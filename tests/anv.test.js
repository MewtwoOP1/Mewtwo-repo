const assert = require("node:assert/strict");
global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
};
const provider = require("../providers/anv.js");
const calls = [];
const media = {
  id: 1000000123, idMal: 456, slug: "frieren",
  title: { english: "Frieren: Beyond Journey's End" },
  coverImage: { large: "https://img.example/frieren.jpg" },
  episodes: 2, format: "TV", genres: ["Adventure", "Fantasy"],
  seasonYear: 2023, description: "A mage keeps travelling."
};
function response(status, body, headers) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: {
      get: name => (headers || {})[String(name).toLowerCase()] || null,
      getSetCookie: () => (headers && headers["set-cookie"]) ? [headers["set-cookie"]] : []
    },
    text: async () => typeof body === "string" ? body : JSON.stringify(body)
  };
}
global.fetch = async function (url, options) {
  url = String(url); options = options || {}; calls.push({ url, options });
  if (url === "https://anv.to/api/catalog" && options.method === "POST") {
    const req = JSON.parse(options.body);
    if (req.operation === "SearchAnime") return response(200, { data: { Page: { media: [media] } } });
    if (req.operation === "AnimeDetail") return response(200, { data: { Media: media } });
    if (req.operation === "HomeAnime") return response(200, { data: { hero: { media: [media] }, trending: { media: [media] } } });
  }
  if (url === "https://anv.to/api/recent-episodes") return response(200, { schedules: [] });
  if (url === "https://anv.to/anime/frieren-episode-1" || url === "https://anv.to/anime/frieren-episode-2") {
    return response(200, '<html>"episodes":2</html>', { "set-cookie": "shiro_watch=test-session; Path=/; HttpOnly" });
  }
  if (url === "https://anv.to/api/episode" && options.method === "POST") {
    assert.equal(options.headers.Cookie, "shiro_watch=test-session");
    const req = JSON.parse(options.body);
    assert.equal(req.anilistId, 1000000123, "use AnV's full catalogue ID");
    assert.equal(req.first, true);
    return response(200, { status: "ready", variants: [
      { id: "sub", sources: [
        { label: "Orange", url: "/stream/orange/index.m3u8?k=orange", tracks: [{ lang: "English", src: "/subs/en.vtt" }] },
        { label: "Pear", url: "/stream/pear/index.m3u8?k=pear", tracks: [{ lang: "English", src: "/subs/en.vtt" }] }
      ] }
    ] });
  }
  if (url.includes("/stream/pear/index.m3u8")) {
    assert.equal(options.headers.Cookie, "shiro_watch=test-session");
    return response(200, "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080\n/stream/pear/1080.m3u8\n");
  }
  return response(404, "not found");
};
async function main() {
  assert.equal(provider.getInfo().name, "AnV");
  assert.equal(provider.getInfo().version, "1.0.4");
  assert.deepEqual(provider.getSettings(), []);
  const results = await provider.search("Frieren", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Frieren: Beyond Journey's End");
  assert.equal(results[0].malId, 456, "explicit idMal is normalized to the host's malId field");
  assert.equal(results[0].url, "anv://anime/frieren");
  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].url, "anv://ep/frieren/1000000123/456/1");
  assert.equal(detail.malId, 456, "MAL ID should remain available for exact source matching");
  assert.equal(detail.anilistId, undefined, "AnV catalogue IDs must not be mislabeled as AniList IDs");
  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.ok(streams.some(s => s.url === "https://anv.to/stream/pear/1080.m3u8"));
  assert.ok(streams.some(s => s.url === "https://anv.to/stream/pear/index.m3u8?k=pear"));
  assert.ok(streams.every(s => !s.url.includes("orange")));
  assert.ok(streams.every(s => s.headers.Cookie === "shiro_watch=test-session"));
  assert.ok(calls.some(c => c.url === "https://anv.to/api/catalog"));
  console.log("AnV full-catalog ID, session, HLS expansion and clean-server tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
