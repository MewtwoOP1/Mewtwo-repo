const assert = require("node:assert/strict");

global.htmlText = function (html) {
  return String(html || "").replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
};

const calls = [];
const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Hindi"\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Japanese"\n#EXTINF:5,\nsegment.ts';
global.fetch = async function (url, options) {
  url = String(url); options = options || {}; calls.push({url, options});
  if (url.startsWith("https://animesalt.to/filter?keyword=Naruto")) {
    return {status:200,body:'<div class="flw-item"><div class="film-poster"><img data-src="https://img.example/naruto.jpg"></div><h3 class="film-name"><a href="/watch/road-of-naruto-ggjw8/ep-1" title="Road of Naruto">Road of Naruto</a></h3></div>'};
  }
  if (url === "https://animesalt.to/watch/road-of-naruto-ggjw8/ep-1") {
    return {status:200,body:'<html><head><title>Watch Free! Road of Naruto Episode 1 Online in HD - AnimeSalt</title><meta property="og:image" content="https://img.example/naruto.jpg"></head><body><div id="wrapper" data-id="7174"></div></body></html>'};
  }
  if (url === "https://animesalt.to/ajax/episode/list/7174") {
    return {status:200,body:JSON.stringify({status:true,html:'<a href="#" title="Full" class="item ep-item" data-number="1" data-id="episode-token-123"><div class="order">1</div></a>'})};
  }
  if (url === "https://animesalt.to/ajax/server/list?servers=episode-token-123") {
    return {status:200,body:JSON.stringify({status:true,html:'<div class="item server-item" data-type="sub" data-id="server-token-123" data-server-id="323"><a class="btn">Vidstream</a></div>'})};
  }
  if (url === "https://animesalt.to/ajax/server?get=server-token-123") {
    return {status:200,body:JSON.stringify({status:true,link:"https://megaplay.buzz/embed/sub/123"})};
  }
  if (url === "https://megaplay.buzz/embed/sub/123") {
    return {status:200,body:'<html><div data-id="123"></div></html>'};
  }
  if (url === "https://megaplay.buzz/stream/getSourcesNew?id=123&type=sub") {
    return {status:200,body:JSON.stringify({sources:{file:"https://cdn.example/master.m3u8?token=abc"}})};
  }
  if (url === "https://cdn.example/master.m3u8?token=abc") return {status:200,body:master};
  return {status:404,body:""};
};

const provider = require("../providers/animesalt.js");
async function main() {
  assert.equal(provider.version, "1.0.3");
  assert.equal(provider.getInfo().name, "AnimeSalt");
  assert.equal(provider.getInfo().baseUrl, "https://animesalt.to");
  assert.deepEqual(await provider.search("", 1, {}), []);
  const results = await provider.search("Naruto", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Road of Naruto");
  assert.equal(results[0].url, "watch/road-of-naruto-ggjw8/ep-1");
  assert.equal(results[0].cover, "https://img.example/naruto.jpg");
  const detail = await provider.getDetail(results[0].url, {category:"sub"});
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].number, 1);
  assert.match(detail.episodes[0].url, /^animesalt:\/\/sub\/episode-token-123/);
  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.ok(streams.length >= 1);
  assert.equal(streams[0].url, "https://cdn.example/master.m3u8?token=abc");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].kind, "sub");
  assert.ok(calls.some((x) => x.url === "https://animesalt.to/ajax/server/list?servers=episode-token-123"));
  assert.ok(calls.some((x) => x.url === "https://megaplay.buzz/stream/getSourcesNew?id=123&type=sub"));
  assert.match(master, /TYPE=AUDIO/);
  console.log("AnimeSalt live-site route contract, episode/server IDs, embed extraction and multi-audio HLS tests passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
