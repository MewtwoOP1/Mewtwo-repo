const assert = require("node:assert/strict");
const provider = require("../providers/rareanimes.js");
const calls = [];
const b64 = s => Buffer.from(s, "utf8").toString("base64");

const listing = '<article class="post-123"><a href="https://www.rareanimes.mov/sample-anime/" title="Sample Anime Hindi Dubbed"><img src="https://img.example/poster.jpg"></a></article>';
const post = '<h1 class="entry-title">Sample Anime Hindi Dubbed</h1><meta property="og:image" content="https://img.example/poster.jpg"><article><div class="entry-content"><p>Episode 01 – First Chapter</p><p>Hindi – <a href="https://codedew.com/multiquality/?url=encodedHindi">WatchMultiQuality</a> <a href="https://codedew.com/zipper/?url=encodedHindi">WatchNow</a></p><p>Tamil – <a href="https://codedew.com/hubcloud/?url=encodedTamil">HubCloud</a> <a href="https://codedew.com/zipper/?url=encodedTamil">WatchNow</a></p><p>Episode 02 – NOT RELEASED YET</p><p>Episode 03 – Third Chapter</p><p>Hindi – <a href="https://codedew.com/zipper/?url=encodedHindi">WatchNow</a></p></div></article>';

const languages = [
  { lang: "Hindi", fid: "sb_hi123", url: "https://worker.example/hindi.m3u8" },
  { lang: "Tamil", fid: "sb_ta456", url: "https://worker.example/tamil.m3u8" },
  { lang: "Telugu", fid: "sb_te789", url: "https://worker.example/telugu.m3u8" },
  { lang: "Malayalam", fid: "sb_ml789", url: "https://worker.example/malayalam.m3u8" },
  { lang: "Bengali", fid: "sb_bn789", url: "https://worker.example/bengali.m3u8" },
  { lang: "Kannada", fid: "sb_kn789", url: "https://worker.example/kannada.m3u8" },
  // Non sb_* IDs use the legacy ?url= route rather than ?v=.
  { lang: "English", fid: "generic_english_123", url: "https://worker.example/english.m3u8" }
];

function player(lang, fid, url) {
  const sources = JSON.stringify([
    { name: lang + " FSL", type: "fsl", stream_url: url },
    { name: lang + " 10gbps", type: "10gbps", url: url.replace(".m3u8", ".mkv") },
    { name: "dead", type: "pixeldrain", url: "https://pixeldrain.example/file" }
  ]);
  const buttons = languages.map(v => '<button class="lang-btn" data-fid="' + v.fid + '" data-lang="' + v.lang + '"></button>').join("");
  return '<title>Sample Anime ' + lang + '</title><script>var maskedFileId = "' + fid + '"; var currentLangNative = "' + lang + '"; var playerSources = JSON.parse(atob("' + b64(sources) + '"));</script>' + buttons;
}
const playersByFid = {};
languages.forEach(v => { playersByFid[v.fid] = player(v.lang, v.fid, v.url); });

global.fetch = async function (url, options) {
  url = String(url);
  calls.push({ url, options: options || {} });
  if (url === "https://www.rareanimes.mov/home/") return { status: 200, body: listing };
  if (url === "https://www.rareanimes.mov/?s=Sample+Anime") return { status: 200, body: listing };
  if (url === "https://www.rareanimes.mov/sample-anime/") return { status: 200, body: post };
  if (url === "https://codedew.com/zipper/?url=encodedHindi") return { status: 200, body: playersByFid.sb_hi123 };
  if (url === "https://codedew.com/zipper/?url=encodedTamil") return { status: 200, body: '<iframe src="https://codedew.com/streambeta/?url=encodedTamil"></iframe>' };
  if (url === "https://codedew.com/streambeta/?url=encodedTamil") return { status: 200, body: playersByFid.sb_ta456 };

  const route = url.match(/^https:\/\/codedew\.com\/streambeta\/\?(v|url)=([^&]+)/);
  if (route) {
    const id = decodeURIComponent(route[2]);
    if (playersByFid[id]) return { status: 200, body: playersByFid[id] };
  }
  return { status: 404, body: "" };
};

async function main() {
  assert.equal(provider.version, "1.0.5");
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
  const expectedLanguages = languages.map(v => v.lang);
  expectedLanguages.forEach(lang => {
    assert.ok(streams.some(s => s.label.indexOf(lang) >= 0),
      "expected playable stream for " + lang);
  });
  assert.equal(streams.length, languages.length * 2, "each of seven language FIDs should return both working non-Pixeldrain mirrors");
  assert.ok(streams.every(s => /^https:\/\//.test(s.url)));
  assert.ok(streams.every(s => s.container === "hls" || s.container === "mp4"));
  assert.ok(streams.some(s => s.url === "https://worker.example/telugu.m3u8" && s.container === "hls"));
  assert.ok(streams.some(s => s.url === "https://worker.example/hindi.m3u8" && s.container === "hls"));
  assert.ok(calls.some(c => c.url === "https://codedew.com/streambeta/?v=sb_te789"),
    "sb_* FIDs must use the ?v= route");
  assert.ok(calls.some(c => c.url === "https://codedew.com/streambeta/?url=generic_english_123"),
    "ordinary FIDs must use the ?url= route");
  assert.ok(calls.some(c => c.url === "https://codedew.com/streambeta/?url=encodedTamil"),
    "the resolver should follow nested CodeDew player pages");
  assert.equal(provider._test._streamBetaFidCandidates("sb_hi123")[0],
    "https://codedew.com/streambeta/?v=sb_hi123");
  assert.equal(provider._test._streamBetaFidCandidates("generic_english_123")[0],
    "https://codedew.com/streambeta/?url=generic_english_123");
  console.log("RareAnimes mocked catalog, episode, seven-language FID routing, fallback, and stream tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
