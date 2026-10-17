const assert = require("node:assert/strict");

global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
};

const calls = [];
global.fetch = async function (url, options) {
  url = String(url);
  options = options || {};
  calls.push({ url, options });
  if (url === "https://ani.pm/api/anime/search?q=Frieren") {
    return { status: 200, body: JSON.stringify({ items: [{
      id: 6351, routeId: "frieren-beyond-journey-end-6351",
      slug: "frieren-beyond-journey-end", title: "Frieren: Beyond Journey's End",
      source: "settlar", native: "Sousou no Frieren",
      poster: "https://img.example/frieren.jpg", year: 2023, episodeCount: 28,
      subCount: 28, dubCount: 28, malId: 52991, anilistId: 154587,
      synopsis: "An elf mage travels on."
    }] }) };
  }
  if (url === "https://ani.pm/api/anime/search?q=LocalIdCollision") {
    return { status: 200, body: JSON.stringify({ items: [{
      id: 1000000958, routeId: "local-id-collision-1000000958",
      slug: "local-id-collision", title: "Local Catalogue ID Test",
      anilist: 1000000958
    }] }) };
  }
  if (url === "https://ani.pm/api/anime/search?q=Bleach") {
    return { status: 200, body: JSON.stringify({ items: [] }) };
  }
  if (url === "https://ani.pm/api/anime/catalog?q=Bleach&page=1") {
    return { status: 200, body: JSON.stringify({ items: [{
      id: 999, routeId: "bleach-999", slug: "bleach", title: "Bleach",
      malId: 269, anilistId: 269
    }] }) };
  }
  if (url === "https://ani.pm/api/anime/series/frieren-beyond-journey-end-6351?routes=e4") {
    return { status: 200, body: JSON.stringify({
      id: 6351, sid: 6351, routeId: "frieren-beyond-journey-end-6351",
      source: "settlar", slug: "frieren-beyond-journey-end",
      title: "Frieren: Beyond Journey's End", native: "Sousou no Frieren",
      poster: "https://img.example/frieren.jpg", year: 2023,
      malId: 52991, anilistId: 154587, synopsis: "An elf mage travels on.",
      genres: ["Adventure", "Fantasy"], episodeCount: 28,
      episodes: [
        { number: 2, title: "It Would Be Embarrassing When We Met Again", sub: true, dub: true },
        { number: 1, title: "The End", thumbnail: "https://img.example/ep1.jpg", sub: true, dub: true }
      ]
    }) };
  }
  if (url === "https://ani.pm/api/anime/playback-bootstrap/settlar/6351?ep=1&lang=sub") {
    return { status: 200, body: JSON.stringify({
      settlarSelection: "selection-token", effectiveLanguage: "sub",
      availability: { sub: true, dub: true }
    }) };
  }
  if (url === "https://ani.pm/api/anime/settlar/session?selection=selection-token&provider=anipm&ep=1&channel=sub&telemetry=0") {
    return { status: 200, body: JSON.stringify({
      embedUrl: "https://embed.settlar.io/embed/v1?t=embed-token"
    }) };
  }
  if (url === "https://embed.settlar.io/api/embed/session?t=embed-token") {
    return { status: 200, body: JSON.stringify({
      source: "https://media.settlar.io/frieren/master.m3u8",
      subtitles: [
        { url: "https://media.settlar.io/sub.vtt", label: "English", default: true },
        { url: "https://media.settlar.io/sub-alt.vtt", label: "English CC", default: false }
      ]
    }) };
  }
  if (url === "https://media.settlar.io/frieren/master.m3u8") {
    return { status: 200, body: [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720",
      "720/index.m3u8",
      "#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1920x1080",
      "1080/index.m3u8",
      ""
    ].join("\n") };
  }
  // Legacy endpoint is only used after the current playback flow fails.
  if (url === "https://ani.pm/api/anime/src/servers?title=Legacy%20Series&ep=1&anilistId=154587") {
    return { status: 200, body: JSON.stringify({ sub: [
      { kind: "embed", name: "Must be ignored", url: "https://embed.example/watch/1", priority: 99 },
      { kind: "file", name: "Legacy MP4", url: "/api/anime/src/file?t=legacy", priority: 5 }
    ] }) };
  }
  return { status: 404, body: "{}" };
};

const provider = require("../providers/anipm.js");

async function main() {
  assert.equal(provider.version, "1.0.5");
  assert.equal(provider.getInfo().version, "1.0.5");
  assert.equal(provider.getInfo().name, "Ani.pm");
  assert.equal(provider.getInfo().type, "anime");
  assert.deepEqual(provider.getSettings(), []);

  const results = await provider.search("Frieren", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Frieren: Beyond Journey's End");
  assert.equal(results[0].malId, 52991);
  assert.equal(results[0].anilistId, 154587);
  assert.match(results[0].url, /\|frieren-beyond-journey-end-6351\|/);

  // A local catalogue ID must not be mistaken for a real AniList metadata ID.
  const localIdResult = await provider.search("LocalIdCollision", 1, {});
  assert.equal(localIdResult.length, 1);
  assert.equal(localIdResult[0].anilistId, null);

  const detail = await provider.getDetail(results[0].url, { category: "sub" });
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.malId, 52991);
  assert.equal(detail.anilistId, 154587);
  assert.deepEqual(detail.episodes.map(e => e.number), [1, 2]);
  assert.match(detail.episodes[0].url, /^anipm-episode:\/\/sub\|6351\|/);
  assert.match(detail.episodes[0].url, /\|settlar\|6351\|Frieren%3A%20Beyond%20Journey%27s%20End$/);

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 2, "HLS master variants should be returned, best quality first");
  assert.equal(streams[0].url, "https://media.settlar.io/frieren/1080/index.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].quality, "1080p");
  assert.equal(streams[1].url, "https://media.settlar.io/frieren/720/index.m3u8");
  assert.equal(streams[0].subtitles[0].url, "https://media.settlar.io/sub.vtt");
  assert.equal(streams[0].subtitles[0].file, "https://media.settlar.io/sub.vtt");
  assert.equal(streams[0].kind, "sub");

  // The current route (search -> routeId -> series -> bootstrap -> Settlar
  // session -> embed session -> HLS master) must complete without the stale API.
  assert.ok(calls.some(c => c.url === "https://ani.pm/api/anime/search?q=Frieren"));
  assert.ok(calls.some(c => c.url === "https://ani.pm/api/anime/series/frieren-beyond-journey-end-6351?routes=e4"));
  assert.ok(calls.some(c => c.url === "https://ani.pm/api/anime/playback-bootstrap/settlar/6351?ep=1&lang=sub"));
  assert.ok(calls.some(c => c.url.indexOf("https://embed.settlar.io/api/embed/session?t=") === 0));
  assert.ok(!calls.some(c => c.url.indexOf("/src/servers?") >= 0),
    "legacy API must not be required when the current playback flow succeeds");

  // Older saved episode links remain supported: when bootstrap is unavailable,
  // the legacy endpoint is tried using the actual AniList metadata ID first.
  const legacyUrl = "anipm-episode://sub|legacy-id|legacy-slug|1|52991|154587||800|Legacy%20Series";
  const legacyStreams = await provider.getVideoSources(legacyUrl, {});
  assert.equal(legacyStreams.length, 1);
  assert.equal(legacyStreams[0].url, "https://ani.pm/api/anime/src/file?t=legacy");
  assert.equal(legacyStreams[0].container, "mp4");
  assert.ok(calls.some(c => c.url === "https://ani.pm/api/anime/src/servers?title=Legacy%20Series&ep=1&anilistId=154587"));
  assert.ok(!legacyStreams.some(s => s.url.indexOf("embed.example") >= 0),
    "iframe rows must not be mislabeled as direct playable streams");

  const fallback = await provider.search("Bleach", 1, {});
  assert.equal(fallback.length, 1, "legacy search fallback should be used when current search is empty");
  console.log("Ani.pm current search/detail/bootstrap/Settlar/HLS + legacy fallback tests passed.");
}

main().catch(e => { console.error(e); process.exitCode = 1; });
