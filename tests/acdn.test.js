const assert = require("node:assert/strict");
global.htmlText = function (html) { return String(html || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\\s+/g, " ").trim(); };
const playlist = '#EXTM3U\\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Hindi",LANGUAGE="hi",URI="hi.m3u8"\\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Japanese",LANGUAGE="ja",URI="ja.m3u8"\\n#EXT-X-STREAM-INF:BANDWIDTH=800000\\nvideo.m3u8';
global.fetch = async function (url, options = {}) {
  url = String(url);
  if (url.startsWith("https://animesalt.to/filter?keyword=Naruto")) return {status:200,body:'<div class="flw-item"><h3 class="film-name"><a href="/watch/road-of-naruto-season-2/ep-1" title="Road of Naruto Season 2">Road of Naruto Season 2</a></h3></div>'};
  if (url === "https://animesalt.to/watch/road-of-naruto-season-2/ep-1") return {status:200,body:'<title>Watch Free! Road of Naruto Season 2 Episode 1 Online in HD - AnimeSalt</title><div id="wrapper" data-id="7174"></div>'};
  if (url === "https://animesalt.to/ajax/episode/list/7174") return {status:200,body:JSON.stringify({status:true,html:'<a class="item ep-item" data-number="2" data-id="episode-token-2" title="Episode 2">2</a><a class="item ep-item" data-number="1" data-id="episode-token-1" title="Episode 1">1</a>'})};
  if (url === "https://animedekho.app/?s=Road%20of%20Naruto%20Season%202") return {status:200,body:'<a href="https://animedekho.app/road-of-naruto/" class="lnk-blk">Road of Naruto</a>'};
  if (url === "https://animedekho.app/road-of-naruto/") return {status:200,body:'<ul class="seasons-lst"><li><a href="https://animedekho.app/epi/road-of-naruto-2x1/"><span>S2-E1</span></a></li></ul>'};
  if (url === "https://animedekho.app/epi/road-of-naruto-2x1/") return {status:200,body:'<body class="postid-123"><iframe src="https://as-cdn1.top/video/hash123"></iframe></body>'};
  if (url === "https://as-cdn1.top/player/index.php?data=hash123&do=getVideo") return {status:200,body:JSON.stringify({videoSource:"https://cdn.example/master.m3u8"})};
  if (url === "https://cdn.example/master.m3u8") return {status:200,body:playlist};
  return {status:404,body:""};
};
const provider = require("../providers/acdn.js");
async function main() {
  assert.equal(provider.version, "1.0.0");
  assert.equal(provider.getInfo().name, "ACDN Multi-Audio");
  const results = await provider.search("Naruto", 1, {});
  assert.equal(results.length, 1);
  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.season, 2);
  assert.deepEqual(detail.episodes.map(e => e.number), [1, 2]);
  assert.ok(detail.episodes[0].url.startsWith("acdn://"));
  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/master.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].label, "ACDN [Multi-audio]");
  assert.deepEqual(streams[0].audioTracks.map(t => t.language), ["hi", "ja"]);
  console.log("[PASS] ACDN search, season/episode metadata, direct HLS resolution and alternate audio parsing");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
