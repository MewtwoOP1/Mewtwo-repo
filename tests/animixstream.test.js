const assert = require("node:assert/strict");

global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
};

const provider = require("../providers/animixstream.js");
const calls = [];
global.fetch = async function (url, options) {
  url = String(url);
  options = options || {};
  calls.push({ url, options });

  if (url === "https://animixstream.com/search.php?q=Frieren") {
    return { status: 200, body: '<a class="anime-card" href="/anime.php?id=15"><div class="card-poster"><img src="/assets/frieren.jpg" alt="Frieren: Beyond Journey\'s End"></div><div class="card-title">Frieren: Beyond Journey\'s End</div></a>' };
  }
  if (url === "https://animixstream.com/") {
    return { status: 200, body: '<section><h2>Trending Now</h2><a class="anime-card" href="/anime.php?id=15"><img src="/assets/frieren.jpg" alt="Frieren: Beyond Journey\'s End"><div class="card-title">Frieren: Beyond Journey\'s End</div></a></section>' };
  }
  if (url === "https://animixstream.com/anime.php?id=15") {
    return { status: 200, body: '<h1>Frieren: Beyond Journey\'s End</h1><meta property="og:image" content="/assets/frieren.jpg"><meta property="og:description" content="An elf mage travels on."><script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"position":1,"url":"/watch.php?id=77","name":"Episode 1 — The Journey"}]}</script>' };
  }
  if (url === "https://animixstream.com/watch.php?id=77") {
    return { status: 200, body: '<iframe src="https://play.zephyrflick.top/video/abcdef123456"></iframe>' };
  }
  if (url === "https://play.zephyrflick.top/player/index.php?data=abcdef123456&do=getVideo") {
    return { status: 200, body: JSON.stringify({ videoSource: "https://cdn.example/master.m3u8?token=fresh" }) };
  }
  return { status: 404, body: "not found" };
};

async function main() {
  assert.equal(provider.version, "1.0.0");
  assert.equal(provider.getInfo().name, "AnimixStream");
  assert.equal(provider.getInfo().lang, "hi");
  assert.deepEqual(provider.getSettings(), []);
  assert.deepEqual(await provider.search("", 1, {}), []);

  const results = await provider.search("Frieren", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Frieren: Beyond Journey's End");
  assert.equal(results[0].cover, "https://animixstream.com/assets/frieren.jpg");

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].title, "Trending Now");

  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.description, "An elf mage travels on.");
  assert.equal(detail.cover, "https://animixstream.com/assets/frieren.jpg");
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].number, 1);
  assert.ok(detail.episodes[0].url.startsWith("animixstream://"));

  const again = await provider.getEpisodes(results[0].url, {});
  assert.equal(again.length, 1);
  assert.equal(calls.filter((c) => c.url === "https://animixstream.com/anime.php?id=15").length, 1,
    "detail should be cached across getDetail/getEpisodes");

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/master.m3u8?token=fresh");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].kind, "dub");
  assert.equal(streams[0].audioLang, "hi");
  assert.ok(calls.some((c) => c.url === "https://play.zephyrflick.top/player/index.php?data=abcdef123456&do=getVideo" && c.options.method === "POST"),
    "playback should call the player API directly, not load the challenge page");

  console.log("AnimixStream catalogue, episode caching and direct-HLS tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
