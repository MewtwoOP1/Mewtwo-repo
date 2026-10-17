const assert = require("node:assert/strict");
global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
};
const provider = require("../providers/animeworldindia.js");
const calls = [];
const card = '<article class="post"><a href="/series/arifureta"><img data-src="https://img.example/arifureta.jpg"></a><h2>Arifureta</h2></article>';
global.fetch = async function (url, options) {
  url = String(url); options = options || {}; calls.push({ url, options });
  if (url === "https://watchanimeworld.one/") return { status: 200, body: card };
  if (url.includes("/page/1/?s=Arifureta")) return { status: 200, body: card };
  if (url === "https://watchanimeworld.one/series/arifureta") {
    return { status: 200, body: '<h1>Arifureta: From Commonplace to World\'s Strongest</h1><div class="post-thumbnail"><img src="https://img.example/arifureta.jpg"></div><p class="description">A hunter survives.</p><div data-post="42"></div><button data-season="1">Season 1</button><a href="/episode/arifureta-1x01-episode-1">Episode 1</a>' };
  }
  if (url === "https://watchanimeworld.one/episode/arifureta-1x01-episode-1") {
    return { status: 200, body: '<iframe src="https://zephyrix.example/video/abcdef01"></iframe>' };
  }
  if (url === "https://zephyrix.example/player/index.php?data=abcdef01&do=getVideo") {
    assert.equal(options.method, "POST");
    assert.ok(String(options.body).includes("hash=abcdef01"));
    assert.ok(String(options.body).includes(encodeURIComponent("https://watchanimeworld.one/")));
    return { status: 200, body: JSON.stringify({ securedLink: "https://cdn.example/master.txt" }) };
  }
  return { status: 404, body: "not found" };
};
async function main() {
  assert.equal(provider.version, "1.0.1");
  assert.equal(provider.getInfo().name, "Anime World India");
  const home = await provider.getHome({});
  assert.equal(home[0].items[0].title, "Arifureta");
  const results = await provider.search("Arifureta", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://watchanimeworld.one/series/arifureta");
  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.title, "Arifureta: From Commonplace to World's Strongest");
  assert.equal(detail.episodes.length, 1);
  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/master.txt");
  assert.equal(streams[0].container, "hls", "Zephyrix securedLink stays HLS even with .txt extension");
  assert.equal(streams[0].headers.Referer, "https://zephyrix.example/");
  assert.ok(calls.some(call => call.url.includes("/player/index.php?data=abcdef01&do=getVideo")));
  console.log("Anime World India mocked catalogue and Zephyrix playback tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });