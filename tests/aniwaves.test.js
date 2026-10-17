const assert = require("node:assert/strict");

global.htmlText = function (s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
};

const provider = require("../providers/aniwaves.js");
const calls = [];
global.extractVideo = async function (url, opts) {
  calls.push({ url: String(url), extract: true, opts: opts || {} });
  const cat = String(url).includes("/dub") ? "dub" : "sub";
  return [{
    url: "https://cdn.example/frieren-" + cat + ".m3u8",
    quality: "1080p",
    container: "hls",
    headers: (opts && opts.headers) || {},
    kind: opts && opts.kind,
    audioLang: opts && opts.audioLang
  }];
};

global.fetch = async function (url, options) {
  url = String(url);
  calls.push({ url, options: options || {} });

  const card = '<div class="ani items"><div class="item"><div class="poster"><a href="/anime/frieren-123"><img src="https://img.example/frieren.jpg" alt="Frieren: Beyond Journey\'s End"></a></div><div class="info"><div class="name d-title"><a href="/anime/frieren-123">Frieren: Beyond Journey\'s End</a></div><div class="meta"><span class="right">TV</span></div><div class="ep-status sub"><span>28</span></div><div class="ep-status dub"><span>12</span></div></div></div></div>';

  if (url === "https://aniwaves.ru/filter?keyword=Frieren") {
    return { status: 200, body: card };
  }
  if (url === "https://aniwaves.ru/home") {
    return { status: 200, body: card };
  }
  if (url === "https://aniwaves.ru/anime/frieren-123") {
    return {
      status: 200,
      body: '<h1 class="title" data-jp="Sousou Frieren">Frieren: Beyond Journey\'s End</h1><div id="watch-main" data-id="123"></div><div class="poster"><img src="https://img.example/frieren.jpg"></div><div class="synopsis"><div class="shorting">An elf mage travels on.</div></div><div class="bmeta"><div>Premiered <a>2023</a></div></div>'
    };
  }
  if (url === "https://aniwaves.ru/ajax/episode/list/123") {
    return {
      status: 200,
      body: JSON.stringify({
        status: 200,
        result: '<ul><li><a data-ids="4&amp;eps=1" data-num="1" data-sub="1" data-dub="1" title="A Real Adventure">1</a></li></ul>'
      })
    };
  }
  if (url === "https://aniwaves.ru/ajax/server/list?servers=4&eps=1") {
    return {
      status: 200,
      body: JSON.stringify({
        status: 200,
        result: '<div class="type" data-type="sub"><ul><li data-link-id="100" data-sv-id="4">Vidplay</li></ul></div><div class="type" data-type="dub"><ul><li data-link-id="101" data-sv-id="4">Vidplay</li></ul></div>'
      })
    };
  }
  if (url === "https://aniwaves.ru/ajax/sources?id=100&asi=0&autoPlay=0") {
    return { status: 200, body: JSON.stringify({ status: 200, result: { url: "https://vidtube.site/embed/456/sub" } }) };
  }
  if (url === "https://aniwaves.ru/ajax/sources?id=101&asi=0&autoPlay=0") {
    return { status: 200, body: JSON.stringify({ status: 200, result: { url: "https://vidtube.site/embed/456/dub" } }) };
  }
  return { status: 404, body: "not found" };
};

async function main() {
  assert.equal(provider.version, "1.0.0");
  assert.equal(provider.getInfo().name, "AniWaves");
  assert.equal(provider.getInfo().baseUrl, "https://aniwaves.ru");
  assert.deepEqual(provider.getSettings(), []);
  assert.deepEqual(await provider.search("", 1, {}), []);

  const results = await provider.search("Frieren", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Frieren: Beyond Journey's End");
  assert.equal(results[0].cover, "https://img.example/frieren.jpg");

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].items[0].id, "frieren-123");

  const detail = await provider.getDetail("https://aniwaves.ru/anime/frieren-123", { category: "sub" });
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.description, "An elf mage travels on.");
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].number, 1);
  assert.ok(detail.episodes[0].url.startsWith("aniwaves://sub/123/1/"));

  const cachedEpisodes = await provider.getEpisodes("https://aniwaves.ru/anime/frieren-123", { category: "sub" });
  assert.equal(cachedEpisodes.length, 1);
  assert.equal(calls.filter((c) => c.url === "https://aniwaves.ru/ajax/episode/list/123").length, 1,
    "episode list should be cached between detail and getEpisodes");

  const subStreams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(subStreams.length, 1);
  assert.equal(subStreams[0].url, "https://cdn.example/frieren-sub.m3u8");
  assert.equal(subStreams[0].kind, "sub");
  assert.ok(calls.some((c) => c.url === "https://aniwaves.ru/ajax/sources?id=100&asi=0&autoPlay=0"));
  assert.ok(!calls.some((c) => c.url === "https://aniwaves.ru/ajax/sources?id=101&asi=0&autoPlay=0"),
    "sub mode must not load dub-only server links");

  const dubDetail = await provider.getDetail("https://aniwaves.ru/anime/frieren-123", { category: "dub" });
  assert.equal(dubDetail.episodes.length, 1);
  assert.ok(dubDetail.episodes[0].url.startsWith("aniwaves://dub/123/1/"));
  const dubStreams = await provider.getVideoSources(dubDetail.episodes[0].url, {});
  assert.equal(dubStreams.length, 1);
  assert.equal(dubStreams[0].url, "https://cdn.example/frieren-dub.m3u8");
  assert.equal(dubStreams[0].kind, "dub");

  console.log("AniWaves search, detail cache, category isolation and shared-extractor tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
