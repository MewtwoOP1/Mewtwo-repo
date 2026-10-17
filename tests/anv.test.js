const assert = require("node:assert/strict");
global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
};
const provider = require("../providers/anv.js");
const calls = [];
const media = {
  id: 123, idMal: 456, slug: "frieren", title: { english: "Frieren: Beyond Journey's End" },
  coverImage: { large: "https://img.example/frieren.jpg" }, episodes: 2, format: "TV",
  streamingEpisodes: [{ title: "Episode 1 - The End", thumbnail: "https://img.example/ep1.jpg" }, { title: "Episode 2 - It Didn't Have To Be" }],
  genres: ["Adventure", "Fantasy"], seasonYear: 2023, description: "A mage keeps travelling."
};
global.fetch = async function (url, options) {
  url = String(url);
  options = options || {};
  calls.push({ url, options });
  if (url === "https://anv.to/api/catalog" && options.method === "POST") {
    const req = JSON.parse(options.body);
    if (req.operation === "BrowseAnime") return { status: 200, body: JSON.stringify({ data: { Page: { media: [media] } } }) };
    if (req.operation === "AnimeDetail") return { status: 200, body: JSON.stringify({ data: { Media: media } }) };
    if (req.operation === "PopularAnime") return { status: 200, body: JSON.stringify({ data: { Page: { media: [media] } } }) };
  }
  if (url === "https://anv.to/anime/frieren-episode-1" || url === "https://anv.to/anime/frieren-episode-2") {
    return { status: 200, headers: { "set-cookie": "shiro_watch=test-session; Path=/; HttpOnly" }, body: "<html>episode</html>" };
  }
  if (url === "https://anv.to/api/episode" && options.method === "POST") {
    assert.equal(options.headers.Cookie, "shiro_watch=test-session");
    assert.ok(options.headers.Referer.includes("/anime/frieren-episode-1"));
    return { status: 200, body: JSON.stringify({ status: "ready", variants: [
      { id: "sub", sources: [{ label: "1080p", url: "https://cdn.example/frieren.m3u8", tracks: [{ language: "en", label: "English", src: "https://cdn.example/en.vtt" }] }] }
    ] }) };
  }
  return { status: 404, body: "not found" };
};
async function main() {
  assert.equal(provider.version, "1.0.0");
  assert.equal(provider.getInfo().name, "AnV");
  assert.deepEqual(await provider.search("", 1, {}), []);
  const results = await provider.search("Frieren", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Frieren: Beyond Journey's End");
  assert.equal(results[0].url, "https://anv.to/anime/frieren");
  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].title, "The End");
  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/frieren.m3u8");
  assert.equal(streams[0].quality, 1080);
  assert.equal(streams[0].subtitles[0].url, "https://cdn.example/en.vtt");
  assert.ok(calls.some(c => c.url === "https://anv.to/api/catalog"));
  console.log("AnV mocked catalogue, session and stream tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });