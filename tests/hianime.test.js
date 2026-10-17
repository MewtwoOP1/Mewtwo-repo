const assert = require("node:assert/strict");
global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
};
global.base64ToBytes = function (s) { return Array.from(Buffer.from(String(s || ""), "base64")); };
const calls = [];
global.fetch = async function (url, options) {
  url = String(url); options = options || {}; calls.push({ url: url, options: options });
  if (url === "https://hianime.at/search?keyword=Frieren") {
    return { status: 200, body: '<section><div class="film_list-wrap"><div class="flw-item"><a href="/watch/frieren-beyond-journeys-end-999"><img class="film-poster-img" alt="Frieren: Beyond Journey\'s End Poster" src="https://img.example/frieren.jpg"></a></div></div></section>' };
  }
  if (url === "https://hianime.at/frieren-beyond-journeys-end-999") {
    return { status: 200, body: '<div class="film-stats"><span class="tick-sub">28</span></div><h2 class="film-name">Frieren: Beyond Journey\'s End</h2><div class="anisc-poster"><img src="https://img.example/frieren.jpg"></div><div class="film-description"><div class="text">An elf mage travels on.</div></div><div class="item-head">Aired:</span><span class="name">2023</span><div data-animeid="999"></div>' };
  }
  if (url === "https://hianime.at/api/theme/episode/list/999") {
    return { status: 200, body: JSON.stringify({ status: 200, html: '<a class="ep-item" data-id="456" data-number="1" title="The End"></a>' }) };
  }
  if (url === "https://hianime.at/api/theme/episode/servers?episodeId=456") {
    const b64 = Buffer.from("https://vidtube.site/embed/abc").toString("base64");
    return { status: 200, body: JSON.stringify({ status: 200, html: '<div data-type="sub" data-server-name="VidPlay" data-hash="' + b64 + '"></div>' }) };
  }
  if (url === "https://kitsu.io/api/edge/mappings?filter%5BexternalSite%5D=myanimelist/anime&filter%5BexternalId%5D=52991&include=item") {
    return { status: 200, body: JSON.stringify({ data: [], included: [] }) };
  }
  if (url === "https://vidtube.site/embed/abc") return { status: 200, body: '<div data-id="77"></div>' };
  if (url === "https://vidtube.site/stream/getSources?id=77&type=sub") {
    assert.equal(options.headers.Referer, "https://vidtube.site/embed/abc");
    return { status: 200, body: JSON.stringify({ sources: { file: "https://cdn.example/frieren.m3u8" }, tracks: [{ kind: "captions", label: "English", file: "https://cdn.example/en.vtt" }] }) };
  }
  if (url === "https://cdn.example/frieren.m3u8") return { status: 200, body: "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1920x1080\nhigh.m3u8\n" };
  return { status: 404, body: "{}" };
};
const provider = require("../providers/hianime.js");
async function main() {
  assert.equal(provider.version, "1.2.2");
  assert.equal(provider.getInfo().name, "HiAnime");
  assert.equal(provider.getInfo().type, "anime");
  assert.deepEqual(provider.getSettings(), []);
  const search = await provider.search("Frieren", 1, {});
  assert.equal(search.length, 1);
  assert.equal(search[0].title, "Frieren: Beyond Journey's End");
  assert.equal(search[0].id, "frieren-beyond-journeys-end-999");
  const detail = await provider.getDetail(search[0].url, {});
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[0].title, "The End");
  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams[0].url, "https://cdn.example/frieren.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[1].url, "https://cdn.example/high.m3u8");
  assert.equal(streams[1].quality, "1080p");
  assert.equal(streams[0].subtitles[0].url, "https://cdn.example/en.vtt");
  assert.ok(calls.some(c => c.url === "https://vidtube.site/stream/getSources?id=77&type=sub"));
  console.log("HiAnime mocked catalogue, detail, episodes and stream tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
