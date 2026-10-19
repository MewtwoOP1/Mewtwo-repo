const assert = require("node:assert/strict");
const provider = require("../providers/rareanimes.js");
const calls = [];
const b64 = s => Buffer.from(s, "utf8").toString("base64");
const playerJson = JSON.stringify([
  { name: "fsl", type: "fsl", stream_url: "https://worker.example/video.mkv" },
  { name: "10gbps", type: "10gbps", url: "https://worker2.example/video.mkv" },
  { name: "dead", type: "pixeldrain", url: "https://pixeldrain.example/file" }
]);
const listing = '<article class="post-123"><a href="https://www.rareanimes.mov/sample-anime/" title="Sample Anime Hindi Dubbed"><img src="https://img.example/poster.jpg"></a></article>';
const post = '<h1 class="entry-title">Sample Anime Hindi Dubbed</h1><meta property="og:image" content="https://img.example/poster.jpg"><article><div class="entry-content"><p>Episode 01 – Hindi</p><p><a href="https://codedew.com/zipper/?url=encodedHindi">WatchNow</a></p><p>Episode 02 – Tamil</p><p><a href="https://codedew.com/zipper/?url=encodedTamil">WatchNow</a></p></div></article>';
const player = '<title>Sample Anime Hindi</title><script>var maskedFileId = "sb_hi123"; var currentLangNative = "Hindi"; var playerSources = JSON.parse(atob("' + b64(playerJson) + '"));</script><button class="lang-btn" data-fid="sb_hi123" data-lang="Hindi"></button>';
global.fetch = async function (url, options) {
  url = String(url); calls.push({ url, options: options || {} });
  if (url === "https://www.rareanimes.mov/home/") return { status: 200, body: listing };
  if (url === "https://www.rareanimes.mov/?s=Sample+Anime") return { status: 200, body: listing };
  if (url === "https://www.rareanimes.mov/sample-anime/") return { status: 200, body: post };
  if (url === "https://codedew.com/zipper/?url=encodedHindi" || url === "https://codedew.com/zipper/?url=encodedTamil") return { status: 200, body: player };
  if (url === "https://codedew.com/streambeta/?url=encodedHindi" || url === "https://codedew.com/streambeta/?url=encodedTamil") return { status: 200, body: player };
  return { status: 404, body: "" };
};
async function main() {
  assert.equal(provider.version, "1.0.0");
  assert.equal(provider.getInfo().name, "RareAnimes • StreamBeta");
  const home = await provider.getHome();
  assert.ok(home.some(row => row.items.length === 1));
  const results = await provider.search("Sample Anime");
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Sample Anime");
  const detail = await provider.getDetail(results[0].url);
  assert.equal(detail.episodes.length, 2);
  assert.match(detail.episodes[0].url, /^rareanimes:\/\/episode\//);
  const streams = await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(streams.length, 2);
  assert.equal(streams[0].url, "https://worker.example/video.mkv");
  assert.equal(streams[0].container, "mp4");
  assert.ok(calls.some(c => c.url === "https://codedew.com/zipper/?url=encodedHindi"));
  console.log("RareAnimes catalog, episode parsing, base64 playerSources, and StreamBeta resolver tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
