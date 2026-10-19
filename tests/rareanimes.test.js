const assert = require("node:assert/strict");
const provider = require("../providers/rareanimes.js");
const calls = [];
const b64 = s => Buffer.from(s, "utf8").toString("base64");
const playerJson = JSON.stringify([
  { name: "fsl", type: "fsl", stream_url: "https://worker.example/video.m3u8" },
  { name: "10gbps", type: "10gbps", url: "https://worker2.example/video.mkv" },
  { name: "dead", type: "pixeldrain", url: "https://pixeldrain.example/file" }
]);
const listing = '<article class="post-123"><a href="https://www.rareanimes.mov/sample-anime/" title="Sample Anime Hindi Dubbed"><img src="https://img.example/poster.jpg"></a></article>';
const post = '<h1 class="entry-title">Sample Anime Hindi Dubbed</h1><meta property="og:image" content="https://img.example/poster.jpg"><article><div class="entry-content"><p>Episode 01 – First Chapter</p><p>Hindi – <a href="https://codedew.com/multiquality/?url=encodedHindi">WatchMultiQuality</a> <a href="https://codedew.com/zipper/?url=encodedHindi">WatchNow</a></p><p>Tamil – <a href="https://codedew.com/hubcloud/?url=encodedTamil">HubCloud</a> <a href="https://codedew.com/zipper/?url=encodedTamil">WatchNow</a></p><p>Episode 02 – NOT RELEASED YET</p><p>Episode 03 – Third Chapter</p><p>Hindi – <a href="https://codedew.com/zipper/?url=encodedHindi">WatchNow</a></p></div></article>';
const player = '<title>Sample Anime Hindi</title><script>var maskedFileId = "sb_hi123"; var currentLangNative = "Hindi"; var playerSources = JSON.parse(atob("' + b64(playerJson) + '"));</script><button class="lang-btn" data-fid="sb_hi123" data-lang="Hindi"></button>';
const tamilJson = JSON.stringify([
  { name: "fsl", type: "fsl", stream_url: "https://worker.example/tamil.m3u8" },
  { name: "10gbps", type: "10gbps", url: "https://worker2.example/tamil2.mkv" },
  { name: "dead", type: "pixeldrain", url: "https://pixeldrain.example/file" }
]);
const tamilPlayer = '<title>Sample Anime Tamil</title><script>var maskedFileId = "sb_ta456"; var currentLangNative = "Tamil"; var playerSources = JSON.parse(atob("' + b64(tamilJson) + '"));</script><button class="lang-btn" data-fid="sb_ta456" data-lang="Tamil"></button>';
global.fetch = async function (url, options) {
  url = String(url); calls.push({ url, options: options || {} });
  if (url === "https://www.rareanimes.mov/home/") return { status: 200, body: listing };
  if (url === "https://www.rareanimes.mov/?s=Sample+Anime") return { status: 200, body: listing };
  if (url === "https://www.rareanimes.mov/sample-anime/") return { status: 200, body: post };
  if (url === "https://codedew.com/zipper/?url=encodedHindi") return { status: 200, body: player };
  if (url === "https://codedew.com/zipper/?url=encodedTamil") return { status: 200, body: '<iframe src="https://codedew.com/streambeta/?url=encodedTamil"></iframe>' };
  if (url === "https://codedew.com/streambeta/?url=encodedHindi") return { status: 200, body: player };
  if (url === "https://codedew.com/streambeta/?url=encodedTamil") return { status: 200, body: tamilPlayer };
  return { status: 404, body: "" };
};
async function main() {
  assert.equal(provider.version, "1.0.3");
  assert.equal(provider.getInfo().name, "RareAnimes");
  const home = await provider.getHome();
  assert.ok(home.some(row => row.items.length === 1));
  const results = await provider.search("Sample Anime");
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Sample Anime");
  const detail = await provider.getDetail(results[0].url);
  assert.equal(detail.episodes.length, 3, "an episode without links must preserve its position");
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[0].title, "First Chapter");
  assert.equal(detail.episodes[0].sourceId, "rareanimes-streambeta");
  const payload = JSON.parse(decodeURIComponent(detail.episodes[0].url.split("/").slice(3).join("/")));
  assert.equal(payload.number, 1);
  assert.deepEqual(payload.variants.map(v => v.lang), ["Hindi", "Tamil"]);
  assert.match(detail.episodes[0].url, /^rareanimes:\/\/episode\//);
  const unavailable = JSON.parse(decodeURIComponent(detail.episodes[1].url.split("/").slice(3).join("/")));
  assert.equal(unavailable.number, 2);
  assert.deepEqual(unavailable.variants, []);
  assert.deepEqual(await provider.getVideoSources(detail.episodes[1].url), [],
    "an unreleased episode returns no streams without throwing");
  assert.equal(detail.episodes[2].number, 3, "episode after a gap keeps its actual number");
  const streams = await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(streams.length, 4);
  assert.equal(streams[0].url, "https://worker.example/video.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.ok(streams.some(s => /Hindi/.test(s.label) && s.kind === "dub"));
  assert.ok(streams.some(s => /Tamil/.test(s.label) && s.kind === "dub"));
  assert.ok(streams.some(s => s.url === "https://worker.example/tamil.m3u8" && s.container === "hls"));
  assert.ok(calls.some(c => c.url === "https://codedew.com/zipper/?url=encodedHindi"));
  assert.ok(calls.some(c => c.url === "https://codedew.com/zipper/?url=encodedTamil"));
  assert.ok(calls.some(c => c.url === "https://codedew.com/streambeta/?url=encodedTamil"),
    "the resolver should follow nested CodeDew player pages");
  console.log("RareAnimes catalog, episode parsing, base64 playerSources, and StreamBeta resolver tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
