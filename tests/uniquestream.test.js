const assert = require("node:assert/strict");

const provider = require("../providers/uniquestream.js");

const SEARCH = {
  series: [
    { content_id: "I35iIyC2", title: "Solo Leveling", type: "show", subbed: true, dubbed: true },
    { content_id: "Ab3kL9xQ", title: "Solo Leveling Specials", type: "show", subbed: true, dubbed: false },
  ],
  movies: [{ content_id: "Mv1Mv1Mv", title: "Solo Leveling: ReAwakening", type: "movie" }],
};

const SEASONS = {
  audio_locales: ["de-DE", "en-US", "es-419", "ja-JP"],
  seasons: [
    { content_id: "S1", title: "Solo Leveling", season_number: 1, episode_count: 2, mal_id: "52299" },
    { content_id: "S1B", title: "Solo Leveling Season 2 -Arise from the Shadow-", season_number: 2, episode_count: 13, mal_id: "58567" },
    { content_id: "S1C", title: "Solo Leveling OVAs", season_number: null, episode_count: 2, mal_id: null },
  ],
};

const EPISODES = [
  { content_id: "e1", episode_number: 1, audio_locales: ["ja-JP", "en-US"], is_clip: false },
  { content_id: "e2", episode_number: 2, audio_locales: ["en-US"], is_clip: false },
  { content_id: "clip", episode_number: 3, audio_locales: ["ja-JP"], is_clip: true },
  { content_id: "half", episode_number: 3.5, audio_locales: ["ja-JP"], is_clip: false },
];

const MEDIA_WITH_SOFT_SUBS = {
  media_id: "m1",
  hls: {
    locale: "ja-JP",
    playlist: "https://cdn/x/master.m3u8",
    subtitles: [{ language: "en-US", url: "https://cdn/x/subs/en-US.vtt", mimeType: "text/vtt" }],
    hard_subs: [{ locale: "en-US", playlist: "https://cdn/x/hard/en-US/master.m3u8" }],
  },
};

const MEDIA_HARD_SUBS_ONLY = {
  media_id: "m3",
  hls: {
    locale: "ja-JP",
    playlist: "https://cdn/x/master.m3u8",
    subtitles: [],
    hard_subs: [
      { locale: "ar-SA", playlist: "https://cdn/x/hard/ar-SA/master.m3u8" },
      { locale: "en-US", playlist: "https://cdn/x/hard/en-US/master.m3u8" },
    ],
  },
};

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function longShowEpisodes(page) {
  if (page === 1) {
    return Array.from({ length: 20 }, (_, i) => ({
      content_id: `long-${i + 1}`,
      episode_number: i + 1,
      audio_locales: ["ja-JP"],
      is_clip: false,
    }));
  }
  if (page === 2) {
    return [
      { content_id: "long-21", episode_number: 21, audio_locales: ["ja-JP"], is_clip: false },
      { content_id: "long-22", episode_number: 22, audio_locales: ["ja-JP"], is_clip: false },
    ];
  }
  return [];
}

async function main() {
  const calls = [];
  global.fetch = async (url) => {
    const requestUrl = String(url);
    calls.push(requestUrl);

    if (requestUrl.includes("/search?query=Solo%20Leveling&limit=20")) return response(SEARCH);
    if (requestUrl.endsWith("/series/I35iIyC2")) return response(SEASONS);
    if (requestUrl.endsWith("/season/S1/episodes?limit=20&page=1")) return response(EPISODES);
    if (requestUrl.includes("/episode/e1/media/hls/ja-JP")) return response(MEDIA_WITH_SOFT_SUBS);
    if (requestUrl.includes("/episode/e1/media/hls/en-US")) return response(MEDIA_WITH_SOFT_SUBS);
    if (requestUrl.includes("/episode/e3/media/hls/ja-JP")) return response(MEDIA_HARD_SUBS_ONLY);
    if (requestUrl.includes("/episode/e4/media/hls/ja-JP")) {
      return response({ media_id: "m4", hls: { locale: "ja-JP", playlist: null, subtitles: [], hard_subs: [] } });
    }
    if (requestUrl.includes("/episode/e5/media/hls/ja-JP")) return response({ error: "not encoded" }, 404);
    if (requestUrl.includes("/episode/e5/media/hls/en-US")) return response(MEDIA_WITH_SOFT_SUBS);
    if (requestUrl.endsWith("/series/S2")) {
      return response({ seasons: [{ content_id: "S2", title: "Long Show", season_number: 1, episode_count: 22, mal_id: null }] });
    }
    const seasonPage = requestUrl.match(/\/season\/S2\/episodes\?limit=20&page=(\d+)/);
    if (seasonPage) return response(longShowEpisodes(Number(seasonPage[1])));
    return response("", 404);
  };

  assert.equal(provider.getInfo().name, "UniqueStream");
  assert.equal(provider.getInfo().type, "anime");
  assert.equal(provider.getInfo().lang, "en");
  assert.deepEqual(await provider.getHome(), []);

  // ── search ────────────────────────────────────────────────────────────────
  assert.deepEqual(await provider.search("", 1, {}), []);
  assert.deepEqual(await provider.search("Solo Leveling", 2, {}), []);

  const results = await provider.search("Solo Leveling", 1, {});
  assert.equal(results.length, 2);
  assert.equal(results[0].id, "I35iIyC2");
  assert.equal(results[0].title, "Solo Leveling");
  assert.equal(results[0].url, "uniquestream://I35iIyC2?t=Solo%20Leveling");
  assert.equal(results[1].url, "uniquestream://Ab3kL9xQ?t=Solo%20Leveling%20Specials");
  assert.ok(!results.some((r) => /ReAwakening/.test(r.title)), "movies must not become series cards");

  // ── detail picks the season whose title is the query, not the sequel ───────
  const detail = await provider.getDetail("uniquestream://I35iIyC2?t=Solo%20Leveling", {});
  assert.equal(detail.title, "Solo Leveling");
  assert.equal(detail.episodes.length, 2);
  assert.deepEqual(detail.episodes.map((ep) => ep.number), [1, 2]);
  assert.deepEqual(detail.episodes.map((ep) => ep.category), ["sub", "dub"]);
  assert.equal(detail.episodes[0].url, "uniquestream://e1/1/sub");
  assert.equal(detail.episodes[1].url, "uniquestream://e2/2/dub");
  assert.equal(detail.subCount, 1);
  assert.equal(detail.dubCount, 2);
  // Clips and fractional episode numbers are dropped by the parser.
  assert.ok(!detail.episodes.some((ep) => ep.number === 3));

  const episodes = await provider.getEpisodes("uniquestream://I35iIyC2?t=Solo%20Leveling", {});
  assert.equal(episodes.length, 2);

  // ── sub stream prefers the clean playlist when soft subs exist ────────────
  const sub = await provider.getVideoSources("uniquestream://e1/1/sub", {});
  assert.equal(sub.length, 1);
  assert.equal(sub[0].url, "https://cdn/x/master.m3u8");
  assert.equal(sub[0].container, "hls");
  assert.equal(sub[0].kind, "sub");
  assert.equal(sub[0].audioLang, "ja");
  assert.equal(sub[0].playlistKey, "uniquestream:m1");
  assert.deepEqual(sub[0].subtitles, [
    { url: "https://cdn/x/subs/en-US.vtt", label: "en-US", lang: "en", format: "vtt", mimeType: "text/vtt" },
  ]);

  // ── dub uses the en-US encode ─────────────────────────────────────────────
  const dub = await provider.getVideoSources("uniquestream://e1/1/dub", {});
  assert.equal(dub[0].url, "https://cdn/x/master.m3u8");
  assert.equal(dub[0].kind, "dub");
  assert.equal(dub[0].audioLang, "en");
  // The endpoint shipped a soft-subtitle track alongside the dub, so it is kept rather than hidden.
  assert.deepEqual(dub[0].subtitles.map((t) => t.lang), ["en"]);

  // ── with no soft subs, sub uses the burned-in English encode ──────────────
  const hard = await provider.getVideoSources("uniquestream://e3/1/sub", {});
  assert.equal(hard[0].url, "https://cdn/x/hard/en-US/master.m3u8");
  assert.match(hard[0].label, /Hard-subbed/);
  assert.deepEqual(hard[0].subtitles, []);

  // ── a missing locale falls back to the other one ──────────────────────────
  const fallback = await provider.getVideoSources("uniquestream://e5/1/sub", {});
  assert.equal(fallback[0].url, "https://cdn/x/master.m3u8");

  // ── no playlist at all fails instead of inventing a URL ───────────────────
  await assert.rejects(() => provider.getVideoSources("uniquestream://e4/1/sub", {}), /no playable HLS stream/);
  await assert.rejects(() => provider.getVideoSources("uniquestream://e1/0/sub", {}), /invalid episode URL/);
  await assert.rejects(() => provider.getVideoSources("nonsense", {}), /invalid episode URL/);

  // ── pagination: a 22-episode season needs both pages ──────────────────────
  calls.length = 0;
  const long = await provider.getDetail("uniquestream://S2?t=Long%20Show", {});
  assert.equal(long.episodes.length, 22);
  assert.equal(long.episodes[21].number, 22);
  assert.ok(calls.some((u) => u.includes("/season/S2/episodes?limit=20&page=1")));
  assert.ok(calls.some((u) => u.includes("/season/S2/episodes?limit=20&page=2")));

  console.log("UniqueStream search, season selection, pagination, HLS variants, and key marker passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
