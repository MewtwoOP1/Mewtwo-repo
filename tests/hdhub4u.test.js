const assert = require("node:assert/strict");
global.htmlText = function (s) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); };
global.base64ToBytes = function (s) { return Array.from(Buffer.from(String(s || ""), "base64")); };
global.absUrl = function (u, b) { try { return new URL(String(u || ""), String(b || "")).toString(); } catch (e) { return String(u || ""); } };
const calls = [];
global.fetch = async function (url, options) {
  url = String(url); options = options || {}; calls.push({ url: url, options: options });
  if (url === "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json") {
    return { status: 200, body: JSON.stringify({ "HDHUB4u": "https://new5.hdhub4u.cl" }) };
  }
  if (url.indexOf("https://search.pingora.fyi/collections/post/documents/search?") === 0) {
    return { status: 200, body: JSON.stringify({ hits: [{ document: {
      permalink: "/download/frieren-movie/", post_title: "Frieren Movie (2024) 1080p BluRay",
      post_thumbnail: "https://img.example/frieren.jpg"
    } }] }) };
  }
  if (url === "https://new5.hdhub4u.cl/download/frieren-movie/") {
    return { status: 200, body: '<span class="material-text">Frieren Movie (2024)</span><meta property="og:image" content="https://img.example/frieren.jpg"><meta name="description" content="A test movie."><a href="https://hubcloud.example/file/abc">Download</a>' };
  }
  if (url.indexOf("https://api.themoviedb.org/3/search/") === 0) return { status: 200, body: JSON.stringify({ results: [] }) };
  if (url === "https://cdn.example/movie.m3u8") return { status: 200, body: "#EXTM3U" };
  return { status: 404, body: "{}" };
};
const provider = require("../providers/hdhub4u.js");
async function main() {
  assert.equal(provider.version, "1.2.4");
  assert.equal(provider.getInfo().name, "HDHub4u");
  assert.equal(provider.getInfo().type, "movie");
  assert.equal(provider.getInfo().lang, "hi");
  assert.deepEqual(provider.getSettings(), []);
  const search = await provider.search("Frieren", 1, {});
  assert.equal(search.length, 1);
  assert.equal(search[0].title, "Frieren Movie");
  assert.equal(search[0].url, "https://new5.hdhub4u.cl/download/frieren-movie/");
  const detail = await provider.getDetail(search[0].url, {});
  assert.equal(detail.title, "Frieren Movie");
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].url.indexOf("hdh://"), 0);
  const media = "hdh://" + encodeURIComponent(JSON.stringify(["https://cdn.example/movie.m3u8"]));
  const streams = await provider.getVideoSources(media, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/movie.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.ok(calls.some(c => c.url === "https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json"));
  console.log("HDHub4u mocked catalogue, movie detail and playback-URL tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
