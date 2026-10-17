const assert = require("node:assert/strict");
global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
};
const provider = require("../providers/twodhive.js");
const calls = [];
const card = '<a href="/anime?anime=52991"><h3><span class="truncate">Frieren: Beyond Journey&#39;s End</span></h3><img src="https://img.example/frieren.jpg" alt="Frieren"></a>';
global.fetch = async function (url, options) {
  url = String(url); options = options || {}; calls.push({ url, options });
  if (url === "https://2dhive.com/") return { status: 200, body: card };
  if (url === "https://2dhive.com/?q=Frieren") return { status: 200, body: card };
  if (url === "https://2dhive.com/anime?anime=52991") {
    return { status: 200, body: '<h1>Frieren: Beyond Journey’s End</h1><meta property="og:image" content="https://img.example/frieren.jpg"><p>Synopsis</p><p>An elf mage travels on.</p><astro-island component-url="/assets/EpisodeBrowser.js" props="{&quot;totalEpisodes&quot;:2,&quot;episodeMeta&quot;:[{&quot;number&quot;:1,&quot;title&quot;:&quot;The End&quot;},{&quot;number&quot;:2,&quot;title&quot;:&quot;It Didn’t Have To Be&quot;}]}"></astro-island><a href="/episode?anime=52991&amp;ep_num=1">1</a><a href="/episode?anime=52991&amp;ep_num=2">2</a>' };
  }
  if (url === "https://megaplay.buzz/stream/mal/52991/1/dub") return { status: 200, body: '<div data-id="77"></div>' };
  if (url === "https://megaplay.buzz/stream/mal/52991/1/sub") return { status: 200, body: '<div data-id="99"></div>' };
  if (url === "https://megaplay.buzz/stream/getSourcesNew?id=99&type=sub") {
    assert.equal(options.headers["X-Requested-With"], "XMLHttpRequest");
    assert.equal(options.headers.Origin, "https://megaplay.buzz");
    return { status: 200, body: JSON.stringify({ sources: { file: "https://cdn.example/master.m3u8" }, tracks: [{ kind: "captions", label: "English", file: "https://cdn.example/en.vtt" }] }) };
  }
  if (url === "https://megaplay.buzz/stream/getSources?id=99&type=sub") throw Error("fallback should not run");
  if (url === "https://cdn.example/master.m3u8") {
    return { status: 200, body: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nhigh.m3u8\n" };
  }
  return { status: 404, body: "not found" };
};
async function main() {
  assert.equal(provider.version, "1.0.0");
  assert.equal(provider.getInfo().name, "TwoDHive");
  const results = await provider.search("Frieren", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "52991");
  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.title, "Frieren: Beyond Journey’s End");
  assert.equal(detail.episodes.length, 4);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[0].title, "The End");
  assert.ok(detail.episodes.some(ep => ep.audio === "dub" && ep.number === 1));
  const streamData = detail.episodes.find(ep => ep.audio === "sub").url;
  const streams = await provider.getVideoSources(streamData, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/high.m3u8");
  assert.equal(streams[0].quality, 1080);
  assert.equal(streams[0].subtitles[0].url, "https://cdn.example/en.vtt");
  assert.ok(calls.some(call => call.url === "https://megaplay.buzz/stream/getSourcesNew?id=99&type=sub"));
  console.log("TwoDHive mocked catalogue, MegaPlay and master-playlist tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });