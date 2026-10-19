const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
};

const calls = [];
global.fetch = async function (url, options) {
  url = String(url);
  calls.push({ url, options: options || {} });

  if (url === "https://anikototv.to/filter?keyword=Jujutsu%20Kaisen&page=1") {
    return { status: 200, body: '<div class="item"><a href="/watch/jujutsu-kaisen" title="24 24 24 TV"><img data-src="https://img.example/jjk.jpg" alt="Jujutsu Kaisen Poster"><div class="name d-title">Jujutsu Kaisen</div><span>24 24 24 TV</span></a></div>' };
  }
  if (url === "https://anikototv.to/home") {
    return { status: 200, body: '<section id="hotest"><div class="swiper-slide item"><a href="/watch/frieren"><h2 class="title d-title">Frieren</h2><div style="background-image: url(https://img.example/f.jpg)"></div></a></div><div class="swiper-slide item"><a href="/watch/jujutsu-kaisen"><h2 class="title d-title">Jujutsu Kaisen</h2><div style="background-image: url(https://img.example/jjk.jpg)"></div></a></div></section>' };
  }
  if (url === "https://anikototv.to/watch/frieren") {
    return { status: 200, body: '<h1 class="title d-title">Frieren: Beyond Journey\'s End</h1><div data-id="42"></div><meta property="og:image" content="https://img.example/f.jpg"><div class="synopsis">An elf mage travels on.</div>' };
  }
  if (url === "https://anikototv.to/ajax/episode/list/42") {
    return { status: 200, body: JSON.stringify({ ok: true, result: '<a data-id="501" data-ids="4" data-num="1" data-sub="1" data-dub="1" title="Episode 1">Episode 1</a>' }) };
  }
  if (url === "https://anikototv.to/ajax/server/list?servers=4") {
    return { status: 200, body: JSON.stringify({ ok: true, result: '<div data-type="sub"><li data-link-id="100">VidPlay</li></div><div data-type="dub"><li data-link-id="101">VidPlay</li></div>' }) };
  }
  if (url === "https://anikototv.to/ajax/server?get=100") {
    return { status: 200, body: JSON.stringify({ ok: true, result: { url: "https://vidtube.site/stream/mal/52991/1/sub" } }) };
  }
  if (url === "https://anikototv.to/ajax/server?get=101") {
    return { status: 200, body: JSON.stringify({ ok: true, result: { url: "https://vidtube.site/stream/mal/52991/1/dub" } }) };
  }
  if (url === "https://vidtube.site/stream/mal/52991/1/sub" ||
      url === "https://vidtube.site/stream/mal/52991/1/dub") {
    return { status: 200, body: '<div data-id="9001"></div>' };
  }
  if (url === "https://vidtube.site/stream/getSources?id=9001&type=sub") {
    return { status: 200, body: JSON.stringify({ sources: { file: "https://cdn.example/frieren-sub.m3u8" }, tracks: [] }) };
  }
  if (url === "https://vidtube.site/stream/getSources?id=9001&type=dub") {
    return { status: 200, body: JSON.stringify({ sources: { file: "https://cdn.example/frieren-dub.m3u8" }, tracks: [] }) };
  }
  if (url === "https://anikototv.to/ajax/server/list?servers=direct-server") {
    return { status: 200, body: JSON.stringify({ ok: true, result: '<div data-type="sub"><li data-link-id="direct-link">Direct HLS</li></div>' }) };
  }
  if (url === "https://anikototv.to/ajax/server?get=direct-link") {
    return { status: 200, body: JSON.stringify({ ok: true, result: { url: "https://cdn.example/direct.m3u8?token=abc" } }) };
  }
  if (url === "https://anikototv.to/ajax/server/list?servers=vidstream-server") {
    return { status: 200, body: JSON.stringify({ ok: true, result: '<div data-type="sub"><li data-link-id="vidstream-link">Vidstream</li></div>' }) };
  }
  if (url === "https://anikototv.to/ajax/server?get=vidstream-link") {
    return { status: 200, body: JSON.stringify({ ok: true, result: { url: "https://vidstream.example/stream/123" } }) };
  }
  if (url === "https://vidstream.example/stream/123") {
    return { status: 200, body: '<div data-id="9002"></div>' };
  }
  if (url === "https://vidstream.example/stream/getSources?id=9002&type=sub") {
    return { status: 200, body: JSON.stringify({ sources: { file: "https://cdn.example/vidstream.m3u8" }, tracks: [] }) };
  }
  return { status: 404, body: "{}" };
};

// The app evaluates this provider in script-global form. Preserve that original
// runtime model rather than rewriting the provider just to satisfy CommonJS tests.
vm.runInThisContext(fs.readFileSync(require.resolve("../providers/anikoto.js"), "utf8"), {
  filename: "providers/anikoto.js"
});
const provider = {
  version: global.getInfo().version,
  getInfo: global.getInfo,
  getSettings: () => [],
  getHome: global.getHome,
  search: global.search,
  getDetail: global.getDetail,
  getEpisodes: global.getEpisodes,
  getVideoSources: global.getVideoSources
};

async function main() {
  assert.equal(provider.version, "1.2.4");
  assert.equal(provider.getInfo().name, "AniKoto");

  const cardSearch = await provider.search("Jujutsu Kaisen", 1, {});
  assert.equal(cardSearch.length, 1);
  assert.equal(cardSearch[0].title, "Jujutsu Kaisen");
  assert.equal(cardSearch[0].cover, "https://img.example/jjk.jpg");

  const home = await provider.getHome({});
  assert.equal(home[0].items.length, 2, "the site spotlight should be parsed without an external catalogue API");
  assert.equal(home[0].items[0].id, "frieren");
  assert.ok(!calls.some(c => c.url.includes("anikotoapi.site")), "AniKoto must not depend on the API");

  const detail = await provider.getDetail("frieren", { category: "sub" });
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.episodes.length, 1);
  assert.ok(detail.episodes[0].url.startsWith("anikoto://sub/"));
  const subStreams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.ok(subStreams.length >= 1);
  const subStream = subStreams.find(stream => stream.url === "https://cdn.example/frieren-sub.m3u8");
  assert.ok(subStream, "sub server should resolve its expected HLS stream");
  assert.equal(subStream.kind, "sub");

  const dubDetail = await provider.getDetail("frieren", { category: "dub" });
  assert.equal(dubDetail.episodes.length, 1);
  assert.ok(dubDetail.episodes[0].url.startsWith("anikoto://dub/"));
  const dubStreams = await provider.getVideoSources(dubDetail.episodes[0].url, {});
  assert.ok(dubStreams.length >= 1);
  const dubStream = dubStreams.find(stream => stream.url === "https://cdn.example/frieren-dub.m3u8");
  assert.ok(dubStream, "dub server should resolve its expected HLS stream");
  assert.equal(dubStream.kind, "dub");

  const directStreams = await provider.getVideoSources("anikoto://sub/direct-server/1/1");
  assert.ok(directStreams.length >= 1);
  const directStream = directStreams.find(stream => stream.url === "https://cdn.example/direct.m3u8?token=abc");
  assert.ok(directStream, "direct server should resolve its expected HLS stream");
  assert.equal(directStream.container, "hls");
  assert.equal(directStream.kind, "sub");
  assert.equal(directStream.headers.Referer, "https://anikototv.to/");

  const vidstream = await provider.getVideoSources("anikoto://sub/vidstream-server/1/1");
  assert.ok(vidstream.length >= 1);
  const vidstreamSource = vidstream.find(stream => stream.url === "https://cdn.example/vidstream.m3u8");
  assert.ok(vidstreamSource, "Vidstream should resolve its expected HLS stream");
  assert.equal(vidstreamSource.container, "hls");

  console.log("AniKoto catalogue, sub/dub, direct HLS, Vidstream extraction and subtitle tests passed.");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
