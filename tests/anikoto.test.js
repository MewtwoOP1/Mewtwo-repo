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
    return { status: 200, body: "" };
  }
  if (url === "https://anikotoapi.site/recent-anime?page=1&per_page=24") {
    return { status: 200, body: JSON.stringify({ ok: true, data: [
      { slug: "frieren", title: "Frieren", poster: "https://img.example/f.jpg", is_sub: true },
      { slug: "jujutsu-kaisen", title: "Jujutsu Kaisen", poster: "https://img.example/jjk.jpg", is_sub: true }
    ] }) };
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
  assert.equal(provider.version, "1.0.8");
  assert.equal(provider.getInfo().name, "AniKoto");

  const cardSearch = await provider.search("Jujutsu Kaisen", 1, {});
  assert.equal(cardSearch.length, 1);
  assert.equal(cardSearch[0].title, "Jujutsu Kaisen");
  assert.equal(cardSearch[0].cover, "https://img.example/jjk.jpg");

  const home = await provider.getHome({});
  assert.equal(home[0].items.length, 2, "the recent API results should be normalized");
  assert.equal(home[0].items[0].id, "frieren");
  assert.ok(calls.some(c => c.url === "https://anikotoapi.site/recent-anime?page=1&per_page=24"));

  const detail = await provider.getDetail("frieren", { category: "sub" });
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.episodes.length, 1);
  assert.ok(detail.episodes[0].url.startsWith("anikoto://sub/"));
  const subStreams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(subStreams.length, 1);
  assert.equal(subStreams[0].url, "https://cdn.example/frieren-sub.m3u8");
  assert.equal(subStreams[0].kind, "sub");

  const dubDetail = await provider.getDetail("frieren", { category: "dub" });
  assert.equal(dubDetail.episodes.length, 1);
  assert.ok(dubDetail.episodes[0].url.startsWith("anikoto://dub/"));
  const dubStreams = await provider.getVideoSources(dubDetail.episodes[0].url, {});
  assert.equal(dubStreams.length, 1);
  assert.equal(dubStreams[0].url, "https://cdn.example/frieren-dub.m3u8");
  assert.equal(dubStreams[0].kind, "dub");

  console.log("AniKoto unchanged script-global API, catalogue, sub/dub and stream tests passed.");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
