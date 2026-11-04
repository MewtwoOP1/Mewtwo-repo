const assert = require("node:assert/strict");

const provider = require("../providers/animekhor.js");

const SEARCH_HTML = `
<div class="listupd">
  <article class="bs" itemscope="itemscope">
    <div class="bsx">
      <a href="https://animekhor.org/anime/battle-through-the-heavens-season-4/" itemprop="url" title="Battle Through the Heavens Season 4" class="tip" rel="65760">
        <div class="limit"><div class="status Completed">Completed</div><div class="typez ONA">ONA</div></div>
      </a>
    </div>
  </article>
  <article class="bs" itemscope="itemscope">
    <div class="bsx">
      <a href="https://animekhor.org/anime/battle-through-the-heavens-comics/" itemprop="url" title="Battle Through the Heavens Comics" class="tip">
        <div class="limit"><div class="typez Comic">Comic</div></div>
      </a>
    </div>
  </article>
</div>`;

const SERIES_URL = "https://animekhor.org/anime/battle-through-the-heavens-season-4/";
const EPISODE_637_URL = "https://animekhor.org/battle-through-the-heavens-episode-637-to-638/";
const EPISODE_636_URL = "https://animekhor.org/battle-through-the-heavens-episode-636/";
const EPISODE_1_URL = "https://animekhor.org/battle-through-the-heavens-episode-1/";

const SERIES_HTML = `
<html><head>
  <meta property="og:image" content="https://img.animekhor.example/bth-s4.jpg">
</head><body>
  <h1>Battle Through the Heavens Season 4</h1>
  <div class="eplister">
    <div class="ephead"><div class="eph-num">Ep</div></div>
    <ul>
      <li data-index="0"><a href="${EPISODE_637_URL}"><div class="epl-num">637 to 638</div><div class="epl-title">Episode 637 to 638</div></a></li>
      <li data-index="1"><a href="${EPISODE_636_URL}"><div class="epl-num">636</div><div class="epl-title">Episode 636</div></a></li>
      <li data-index="2"><a href="${EPISODE_1_URL}"><div class="epl-num">1</div><div class="epl-title">Episode 1</div></a></li>
    </ul>
  </div>
</body></html>`;

function base64(html) {
  return Buffer.from(html, "utf8").toString("base64");
}

const DM_MIRROR = base64(
  '<div style="position:relative"> <iframe src="https://www.dailymotion.com/embed/video/k4xRwgAFycWf5OHH5Hg" allowfullscreen> </iframe> </div>',
);
const OK_MIRROR = base64(
  '<iframe width="640" height="360" src="//ok.ru/videoembed/16395424172640" frameborder="0" allowfullscreen></iframe>',
);
const EMTURBO_MIRROR = base64('<iframe src="https://emturbovid.com/t/6a524624e82b3" frameborder="0"></iframe>');

const EPISODE_HTML = `
<div class="mobius">
  <select class="mirror" name="mirror" onchange="loadMi(this);">
    <option value="">Select Video Server</option>
    <option value="${DM_MIRROR}" data-index="1">VidPlayer [MULTI SUB]</option>
    <option value="${OK_MIRROR}" data-index="2">ok.ru&#12298;Ads Free&#12299; [ENGLISH]</option>
  </select>
</div>`;

const DM_METADATA = {
  qualities: {
    auto: [{ url: "https://cdn.dm.example/hls/master.m3u8", type: "application/x-mpegURL" }],
    "720": [{ url: "https://cdn.dm.example/720.mp4", type: "video/mp4" }],
  },
};

const OK_SERIES_URL = "https://animekhor.org/anime/battle-through-the-heavens-ok/";
const OK_EPISODE_URL = "https://animekhor.org/battle-through-the-heavens-ok-episode-1/";
const OK_SERIES_HTML = `
<h1>Battle Through the Heavens OK</h1>
<div class="eplister"><ul>
  <li><a href="${OK_EPISODE_URL}"><div class="epl-num">1</div></a></li>
</ul></div>`;
const OK_EPISODE_HTML = `
<div class="mobius"><select class="mirror">
  <option value="">Select Video Server</option>
  <option value="${OK_MIRROR}" data-index="1">ok.ru</option>
</select></div>`;
const OK_EMBED_HTML = `<html><script>var opts = {&quot;metadataUrl&quot;:&quot;https:\\/\\/ok.ru\\/metadata\\/16395424172640&quot;};</script></html>`;
const OK_METADATA = { videos: [{ url: "https://ok.ru/video/16395424172640-720.mp4", name: "720p" }] };

// Live OK.ru embeds are entity-escaped and already carry hlsManifestUrl. That path must not spend a
// second request on the metadata document.
const OK_HLS_MIRROR = base64('<iframe src="//ok.ru/videoembed/77777"></iframe>');
const OK_HLS_SERIES_URL = "https://animekhor.org/anime/soul-land-5/";
const OK_HLS_EPISODE_URL = "https://animekhor.org/soul-land-5-episode-1/";
const OK_HLS_SERIES_HTML = `
<h1>Soul Land 5</h1>
<div class="eplister"><ul>
  <li><a href="${OK_HLS_EPISODE_URL}"><div class="epl-num">1</div></a></li>
</ul></div>`;
const OK_HLS_EPISODE_HTML = `
<div class="mobius"><select class="mirror">
  <option value="">Select Video Server</option>
  <option value="${OK_HLS_MIRROR}" data-index="1">ok.ru</option>
</select></div>`;
const OK_HLS_EMBED_HTML = `<html><script>var opts = {&quot;metadataUrl&quot;:&quot;https:\\/\\/ok.ru\\/metadata\\/77777&quot;,&quot;hlsManifestUrl&quot;:&quot;https:\\/\\/vd423.okcdn.ru\\/video.m3u8?expires=1\\u0026sig=abc&quot;};</script></html>`;

const BAD_SERIES_URL = "https://animekhor.org/anime/battle-through-the-heavens-bad/";
const BAD_EPISODE_URL = "https://animekhor.org/battle-through-the-heavens-bad-episode-1/";
const BAD_SERIES_HTML = `
<h1>Battle Through the Heavens Bad</h1>
<div class="eplister"><ul>
  <li><a href="${BAD_EPISODE_URL}"><div class="epl-num">1</div></a></li>
</ul></div>`;
const BAD_EPISODE_HTML = `
<div class="mobius"><select class="mirror">
  <option value="">Select Video Server</option>
  <option value="${EMTURBO_MIRROR}" data-index="1">Emturbovid</option>
</select></div>`;

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function episodeKey(seriesUrl, number) {
  return "animekhor://" + encodeURIComponent(seriesUrl) + "/" + number;
}

async function main() {
  const calls = [];
  global.fetch = async (url) => {
    const requestUrl = String(url);
    calls.push(requestUrl);

    if (requestUrl === "https://animekhor.org/?s=battle") return response(SEARCH_HTML);
    if (requestUrl === "https://animekhor.org/") return response(SEARCH_HTML);
    if (requestUrl === SERIES_URL) return response(SERIES_HTML);
    if (requestUrl === EPISODE_637_URL) return response(EPISODE_HTML);
    if (requestUrl === EPISODE_636_URL) return response(EPISODE_HTML);
    if (requestUrl === EPISODE_1_URL) return response(EPISODE_HTML);
    if (requestUrl.includes("dailymotion.com/player/metadata/video/k4xRwgAFycWf5OHH5Hg")) return response(DM_METADATA);
    if (requestUrl === OK_SERIES_URL) return response(OK_SERIES_HTML);
    if (requestUrl === OK_EPISODE_URL) return response(OK_EPISODE_HTML);
    if (requestUrl.includes("ok.ru/videoembed/77777")) return response(OK_HLS_EMBED_HTML);
    if (requestUrl.includes("ok.ru/videoembed/")) return response(OK_EMBED_HTML);
    if (requestUrl === OK_HLS_SERIES_URL) return response(OK_HLS_SERIES_HTML);
    if (requestUrl === OK_HLS_EPISODE_URL) return response(OK_HLS_EPISODE_HTML);
    if (requestUrl.includes("ok.ru/metadata/")) return response(OK_METADATA);
    if (requestUrl === BAD_SERIES_URL) return response(BAD_SERIES_HTML);
    if (requestUrl === BAD_EPISODE_URL) return response(BAD_EPISODE_HTML);
    return response("", 404);
  };

  assert.equal(provider.getInfo().name, "AnimeKhor");
  assert.equal(provider.getInfo().type, "anime");
  assert.equal(provider.getInfo().lang, "en");

  // ── search keeps the type badge and marks comics so they can be filtered ──
  assert.deepEqual(await provider.search("", 1, {}), []);
  assert.deepEqual(await provider.search("battle", 2, {}), []);

  const results = await provider.search("battle", 1, {});
  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Battle Through the Heavens Season 4");
  assert.equal(results[0].url, SERIES_URL);
  assert.equal(results[0].isComic, false);
  assert.equal(results[0].badge, "ONA");
  assert.equal(results[1].isComic, true);

  const home = await provider.getHome();
  assert.equal(home.length, 1);
  assert.deepEqual(home[0].items.map((i) => i.title), ["Battle Through the Heavens Season 4"]);

  // ── episode ranges expand, and both ends resolve to the same page ─────────
  const detail = await provider.getDetail(SERIES_URL, {});
  assert.equal(detail.title, "Battle Through the Heavens Season 4");
  assert.equal(detail.cover, "https://img.animekhor.example/bth-s4.jpg");
  assert.deepEqual(detail.episodes.map((ep) => ep.number), [1, 636, 637, 638]);
  assert.equal(detail.episodes[0].url, episodeKey(SERIES_URL, 1));

  const episodes = await provider.getEpisodes(SERIES_URL, {});
  assert.equal(episodes.length, 4);

  // ── Dailymotion + ok.ru mirrors resolve to direct files ───────────────────
  calls.length = 0;
  const streams = await provider.getVideoSources(episodeKey(SERIES_URL, 637), {});
  assert.equal(streams.length, 2);
  assert.equal(streams[0].url, "https://cdn.dm.example/hls/master.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].quality, "Auto");
  assert.equal(streams[0].kind, "sub");
  assert.equal(streams[0].audioLang, "zh");
  assert.equal(streams[1].url, "https://cdn.dm.example/720.mp4");
  assert.equal(streams[1].container, "mp4");
  assert.equal(streams[1].quality, "720p");
  assert.ok(calls.includes(EPISODE_637_URL), "the batched page must be fetched");

  // 638 is not listed separately; it must resolve through the same 637-638 page.
  calls.length = 0;
  const batched = await provider.getVideoSources(episodeKey(SERIES_URL, 638), {});
  assert.equal(batched.length, 2);
  assert.ok(calls.includes(EPISODE_637_URL));

  // ── ok.ru metadata resolves through the module's metadata URL ──────────────
  const okStreams = await provider.getVideoSources(episodeKey(OK_SERIES_URL, 1), {});
  assert.equal(okStreams.length, 1);
  assert.equal(okStreams[0].url, "https://ok.ru/video/16395424172640-720.mp4");
  assert.equal(okStreams[0].quality, "720p");
  assert.equal(okStreams[0].container, "mp4");
  assert.equal(okStreams[0].headers.Referer, "https://ok.ru/");

  // Live OK.ru embeds expose hlsManifestUrl directly; use it and skip the metadata request.
  calls.length = 0;
  const okHls = await provider.getVideoSources(episodeKey(OK_HLS_SERIES_URL, 1), {});
  assert.equal(okHls.length, 1);
  assert.equal(okHls[0].url, "https://vd423.okcdn.ru/video.m3u8?expires=1&sig=abc");
  assert.equal(okHls[0].container, "hls");
  assert.equal(okHls[0].quality, "Auto");
  assert.ok(!calls.some((u) => u.includes("ok.ru/metadata/")));

  // ── a mirror the repo cannot read fails with the host named, never faked ──
  await assert.rejects(
    () => provider.getVideoSources(episodeKey(BAD_SERIES_URL, 1), {}),
    /unsupported player: Emturbovid/,
  );
  await assert.rejects(() => provider.getVideoSources("nonsense", {}), /invalid episode URL/);

  // ── a page with no mirrors at all fails ───────────────────────────────────
  global.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl === SERIES_URL) return response(SERIES_HTML);
    if (requestUrl === EPISODE_1_URL) return response("<html><body>gone</body></html>");
    return response("", 404);
  };
  await assert.rejects(
    () => provider.getVideoSources(episodeKey(SERIES_URL, 1), {}),
    /no mirrors/,
  );

  console.log("AnimeKhor donghua search, range expansion, base64 mirrors, and host resolution passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
