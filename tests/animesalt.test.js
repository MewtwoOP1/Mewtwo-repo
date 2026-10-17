const assert = require("node:assert/strict");
global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\\s+/g, " ").trim();
};
global.absUrl = function (href, base) { try { return new URL(href, base).href; } catch (_) { return href; } };
const provider = require("../providers/animesalt.js");
const calls = [];
const home = "<html>" + "x".repeat(900) + "</html>";
global.fetch = async function (url, options) {
  url = String(url); options = options || {}; calls.push({url, options});
  if (url === "https://animesalt.cx/") return {status:200, body:home};
  if (url.indexOf("https://animesalt.cx/?s=naruto") === 0) {
    return {status:200, body:'<article class="post"><a href="https://animesalt.cx/series/naruto/"><h2 class="entry-title">Naruto</h2><img src="https://img.example/naruto.jpg"></a></article>'};
  }
  if (url === "https://animesalt.cx/series/naruto/") {
    return {status:200, body:'<h1>Naruto</h1><meta property="og:image" content="https://img.example/naruto.jpg"><div data-post="77"></div><button data-season="1">Season 1</button><a href="/episode/naruto-1x1/">Episode 1</a>'};
  }
  if (url === "https://animesalt.cx/episode/naruto-1x1/") {
    return {status:200, body:'<iframe src="https://as-cdn21.top/video/abcdef"></iframe>'};
  }
  if (url === "https://as-cdn21.top/player/index.php?data=abcdef&do=getVideo") {
    return {status:200, body:JSON.stringify({videoSource:"https://cdn.example/master.m3u8"})};
  }
  return {status:404, body:""};
};
async function main() {
  assert.equal(provider.getInfo().name, "AnimeSalt");
  assert.equal(provider.getInfo().type, "anime");
  assert.deepEqual(provider.getSettings(), []);
  const results = await provider.search("naruto", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Naruto");
  const detail = await provider.getDetail(results[0].url, {category:"dub"});
  assert.equal(detail.episodes.length, 1);
  assert.match(detail.episodes[0].url, /^animesalt:\/\//);
  const streams = await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/master.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.ok(calls.some(c => c.url.includes("/player/index.php?data=abcdef&do=getVideo")));
  console.log("AnimeSalt mocked search, episode and HLS resolution tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
