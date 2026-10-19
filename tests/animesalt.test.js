const assert = require("node:assert/strict");

// Zangetsu injects htmlText into provider scripts; mirror the host helper in Node.
global.htmlText = function (html) {
  return String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
};

const provider = require("../providers/animesalt.js");

const calls = [];
global.fetch = async (url) => {
  const requestUrl = String(url);
  calls.push(requestUrl);

  if (requestUrl.includes("/filter?keyword=Solo%20Leveling")) {
    return {
      status: 200,
      body: '<div class="item"><a href="/anime/solo-leveling"><img data-src="https://img.example/poster.jpg"></a><div class="name"><a data-jp="Solo Leveling" href="/anime/solo-leveling">Solo Leveling</a></div><span class="sub"></span><span class="dub"></span></div>',
    };
  }

  if (requestUrl === "https://animesalt.to/anime/solo-leveling") {
    return {
      status: 200,
      body: '<html><meta property="og:image" content="https://img.example/poster.jpg"><h1 itemprop="name">Solo Leveling</h1><div class="short cts-block"><div>A hunter fights monsters.</div></div><div data-id="123"></div></html>',
    };
  }

  if (requestUrl.includes("/ajax/episode/list/123?vrf=")) {
    return {
      status: 200,
      body: JSON.stringify({
        status: 200,
        result: '<a data-ids="server-1,server-2" data-sub="1" data-dub="1" data-slug="1" title="I Am the Strongest">1</a>',
      }),
    };
  }

  return { status: 200, body: "" };
};

async function main() {
  assert.equal(provider.version, "1.0.1");
  assert.equal(provider.getInfo().name, "AnimeSalt");
  assert.equal(provider.getInfo().baseUrl, "https://animesalt.to");

  const empty = await provider.search("", 1, {});
  assert.deepEqual(empty, []);

  const results = await provider.search("Solo Leveling", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "solo-leveling");
  assert.equal(results[0].title, "Solo Leveling");
  assert.equal(results[0].cover, "https://img.example/poster.jpg");

  const detail = await provider.getDetail("solo-leveling", { category: "sub" });
  assert.equal(detail.title, "Solo Leveling");
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[0].title, "I Am the Strongest");
  assert.match(detail.episodes[0].url, /^animesalt:\/\/sub\//);
  assert.ok(calls.some((url) => url.includes("/ajax/episode/list/123?vrf=")));

  const episodes = await provider.getEpisodes("solo-leveling", { category: "sub" });
  assert.equal(episodes.length, 1);
  console.log("AnimeSalt mocked integration tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
