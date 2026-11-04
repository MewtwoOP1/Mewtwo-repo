const assert = require("node:assert/strict");

const provider = require("../providers/animeheaven.js");

// Fixtures follow the live markup (2026-11): apostrophe-quoted attributes, stray whitespace,
// newest-first episode rows and a decoy <source> that does not carry the episode's gate key.
const SEARCH_HTML = `
  <div class='info3 bc1'>
    <div class='similarimg'><div class='p1'>
      <a href='anime.php?ak2gr'><img class='coverimg' src='image.php?z4mfi' alt='Frieren: Beyond Journey&#039;s End' loading='lazy'></a>
      <div class='similarname c'><a href='anime.php?ak2gr' class='c'>Frieren: Beyond Journey&#039;s End</a></div>
    </div></div>
    <div class='similarimg'><div class='p1'>
      <a href='anime.php?hgj3i'><img class='coverimg' src='image.php?q2wer' alt='Frieren 2nd Season' loading='lazy'></a>
      <div class='similarname c'><a href='anime.php?hgj3i' class='c'>Frieren 2nd Season</a></div>
    </div></div>
  </div>`;

const DETAIL_HTML = `
  <html><head>
    <meta property='og:title' content='Frieren: Beyond Journey&#039;s End'>
    <meta property='og:image' content='https://animeheaven.me/image.php?kxmc6'>
  </head><body>
    <div class='infotitle c'>Frieren: Beyond Journey&#039;s End</div>
    <div class='infodes c'>An elf mage walks the world after the hero's party.</div>
    <div class='infoyear c'>Episodes: <div class='inline c2'>2</div> Year: <div class='inline c2'>2023</div></div>
    <a class='c' id='47edc338ae59c34cc3ea427c7f6871df' onclick='gatea( "47edc338ae59c34cc3ea427c7f6871df")' onmouseover='gateh( "47edc338ae59c34cc3ea427c7f6871df")' href='gate.php'>
      <div class='trackep watchb bc'><div class='watch1 bc c'>Episode</div><div  class= ' watch2 bc '  >2</div></div>
    </a>
    <a class='c' id='aaef295ca750e9bf2d7077cbc27df63d' onclick='gatea( "aaef295ca750e9bf2d7077cbc27df63d")' onmouseover='gateh( "aaef295ca750e9bf2d7077cbc27df63d")' href='gate.php'>
      <div class='trackep watchb bc'><div class='watch1 bc c'>Episode</div><div  class= ' watch2 bc '  >1</div></div>
    </a>
  </body></html>`;

const GATE_HTML = `
  <video id='vid' controls>
    <!-- decoy for scrapers -->
    <source src='https://ax.animeheaven.me/video.mp4?2c523c8cd9cc129bd13fc7407fa81220&deadbeef' type='video/mp4'>
    <source src='https://rt.animeheaven.me/video.mp4?47edc338ae59c34cc3ea427c7f6871df&aaaa' type='video/mp4' onstalled="xhr3()">
    <source src='https://ct.animeheaven.me/video.mp4?47edc338ae59c34cc3ea427c7f6871df&aaaa&error' type='video/mp4' onerror="xhr()">
    <source src='https://ck.animeheaven.me/video.mp4?47edc338ae59c34cc3ea427c7f6871df&aaaa&error2' type='video/mp4' onerror="xhr2()">
    <source src='https://rt.animeheaven.me/video.mp4?47edc338ae59c34cc3ea427c7f6871df&aaaa' type='video/mp4'>
  </video>`;

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
  };
}

const calls = [];
global.fetch = async (url, init) => {
  const requestUrl = String(url);
  calls.push({ url: requestUrl, headers: (init && init.headers) || {} });

  if (requestUrl.includes("/search.php?s=Frieren")) return response(SEARCH_HTML);
  if (requestUrl.endsWith("/anime.php?ak2gr")) return response(DETAIL_HTML);
  if (requestUrl.endsWith("/gate.php")) return response(GATE_HTML);
  if (requestUrl === "https://animeheaven.me/") return response(SEARCH_HTML);
  return response("", 404);
};

async function main() {
  assert.equal(provider.version, "1.0.3");
  assert.equal(provider.getInfo().name, "AnimeHeaven");
  assert.equal(provider.getInfo().type, "anime");
  assert.equal(provider.getInfo().lang, "en");

  // Search
  assert.deepEqual(await provider.search("", 1, {}), []);
  assert.deepEqual(await provider.search("frieren", 2, {}), []);

  const results = await provider.search("Frieren", 1, {});
  assert.equal(results.length, 2);
  assert.equal(results[0].id, "anime.php?ak2gr");
  assert.equal(results[0].title, "Frieren: Beyond Journey's End");
  assert.equal(results[0].cover, "https://animeheaven.me/image.php?z4mfi");
  assert.equal(results[1].title, "Frieren 2nd Season");

  // Detail and episodes. Rows are newest-first on the site and must come back ascending.
  const detail = await provider.getDetail("anime.php?ak2gr", {});
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.cover, "https://animeheaven.me/image.php?kxmc6");
  assert.match(detail.description, /elf mage/);
  assert.equal(detail.episodes.length, 2);
  assert.deepEqual(detail.episodes.map((ep) => ep.number), [1, 2]);
  assert.equal(detail.episodes[0].url, "animeheaven://aaef295ca750e9bf2d7077cbc27df63d/1");
  assert.equal(detail.episodes[0].id, detail.episodes[0].url);
  assert.equal(detail.episodes[0].category, "sub");
  assert.equal(detail.episodes[0].sourceId, "animeheaven");

  const episodes = await provider.getEpisodes("anime.php?ak2gr", {});
  assert.deepEqual(episodes.map((ep) => ep.number), [1, 2]);

  // Gate resolution: the decoy clip is dropped and repeated mirrors are deduplicated.
  calls.length = 0;
  const streams = await provider.getVideoSources("animeheaven://47edc338ae59c34cc3ea427c7f6871df/2", {});
  assert.equal(streams.length, 3);
  assert.deepEqual(streams.map((s) => s.url), [
    "https://rt.animeheaven.me/video.mp4?47edc338ae59c34cc3ea427c7f6871df&aaaa",
    "https://ct.animeheaven.me/video.mp4?47edc338ae59c34cc3ea427c7f6871df&aaaa&error",
    "https://ck.animeheaven.me/video.mp4?47edc338ae59c34cc3ea427c7f6871df&aaaa&error2",
  ]);
  assert.ok(streams.every((s) => s.container === "mp4"));
  assert.ok(streams.every((s) => s.kind === "sub"));
  assert.ok(streams.every((s) => s.audioLang === "ja"));
  assert.ok(!streams.some((s) => s.url.includes("2c523c8cd9cc129bd13fc7407fa81220")));

  const gateCall = calls.find((c) => c.url.endsWith("/gate.php"));
  assert.ok(gateCall);
  assert.equal(gateCall.headers.Cookie, "key=47edc338ae59c34cc3ea427c7f6871df");
  assert.equal(gateCall.headers.Referer, "https://animeheaven.me/");

  // getStreams is an alias for the same resolver.
  const alias = await provider.getStreams("animeheaven://47edc338ae59c34cc3ea427c7f6871df/1", {});
  assert.equal(alias.length, 3);

  // Bad input and empty gate pages fail loudly instead of returning a placeholder.
  await assert.rejects(() => provider.getVideoSources("animeheaven://47edc338ae59c34cc3ea427c7f6871df/0", {}), /invalid episode URL/);
  await assert.rejects(() => provider.getVideoSources("nonsense", {}), /invalid episode URL/);

  const oldFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).endsWith("/gate.php")) return response("<html><body>no sources</body></html>");
    return response("", 404);
  };
  await assert.rejects(() => provider.getVideoSources("animeheaven://47edc338ae59c34cc3ea427c7f6871df/2", {}), /no video source/);
  global.fetch = oldFetch;

  // Transport resets are retried, while HTTP errors remain explicit.
  let retryCalls = 0;
  global.fetch = async (url) => {
    if (String(url).endsWith("/anime.php?retry")) {
      retryCalls++;
      if (retryCalls === 1) throw new Error("Connection reset by peer");
      return response(DETAIL_HTML);
    }
    return response("", 404);
  };
  const retried = await provider.getDetail("anime.php?retry", {});
  assert.equal(retried.episodes.length, 2);
  assert.equal(retryCalls, 2);
  global.fetch = oldFetch;

  console.log("AnimeHeaven search, detail, episodes, gate mirrors, and decoy filtering passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
