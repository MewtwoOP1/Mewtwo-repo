const assert = require("node:assert/strict");
const provider = require("../providers/anipm.js");

const calls = [];
const failures = new Map();
let settings = {};

global.__SOURCE_ID = "anipm";
Object.defineProperty(global, "__settings", {
  configurable: true,
  get() {
    return { anipm: settings };
  },
});

const DOMAIN = "https://ani.pm";

function json(body, status) {
  return { status: status || 200, body: JSON.stringify(body), headers: {} };
}
function fail(domain, times) {
  failures.set(domain, times);
}
function consumeFailure(domain) {
  const left = failures.get(domain) || 0;
  if (left > 0) {
    failures.set(domain, left - 1);
    return true;
  }
  return false;
}

const title = {
  anilistId: 154587,
  malId: 52991,
  title: "Frieren: Beyond Journey’s End",
  nativeTitle: "葬送のフリーレン",
  format: "TV",
  status: "Finished",
  year: 2023,
  season: "fall",
  score: 9.24,
  rating: "PG-13",
  durationMinutes: 24,
  episodes: { total: 28, sub: 28, dub: 28 },
  genres: ["Adventure", "Drama"],
  studios: ["MADHOUSE"],
  adult: false,
  synopsis: "The adventure is over but life goes on.",
  poster: "/api/anime/cover?anilistId=154587&malId=52991",
  banner: null,
  url: "https://ani.pm/anime/frieren-beyond-journeys-end-6351-wixprd",
  embed: "https://ani.pm/embed/ani/154587/1/sub",
};

const episodesPayload = {
  data: [
    { number: 1, title: null, runtimeSeconds: 1560, aired: null, thumbnail: null,
      available: { sub: true, dub: true, subHard: true, dubHard: false },
      embed: { sub: "https://ani.pm/embed/ani/154587/1/sub", dub: "https://ani.pm/embed/ani/154587/1/dub" } },
    { number: 2, title: "The Journey", runtimeSeconds: 1470,
      available: { sub: true, dub: false, subHard: false, dubHard: false },
      embed: { sub: "https://ani.pm/embed/ani/154587/2/sub", dub: "https://ani.pm/embed/ani/154587/2/dub" } },
    { number: 3, title: null,
      available: { sub: true, dub: true, subHard: false, dubHard: false },
      embed: { sub: "https://ani.pm/embed/ani/154587/3/sub", dub: "https://ani.pm/embed/ani/154587/3/dub" } },
  ],
};

const embedPage = '<script type="application/json" id="anipm-embed-config">' + JSON.stringify({
  v: 1,
  nonce: "test-nonce",
  publicOrigin: "https://ani.pm",
  playerOrigin: "https://player.example",
  title: { anilistId: 154587, malId: 52991, name: "Frieren" },
  episode: 1,
  options: { lang: "sub", hardsub: false, adult: true },
}) + "</script>";

global.fetch = async (url, opts) => {
  const u = String(url);
  calls.push({ url: u, opts: opts || {} });
  const path = u.split("?")[0];
  const origin = u.startsWith("https://") ? u.slice(0, u.indexOf("/", 8)) : "";
  if (consumeFailure(origin)) return { status: 503, body: "temporary", headers: {} };
  if (u.startsWith(DOMAIN + "/api/partner/v1/titles?")) {
    if (u.indexOf("q=Sample") >= 0) return json({ data: [title], page: 1, limit: 50, total: 1, hasMore: false });
    return json({ data: [] });
  }
  if (path === DOMAIN + "/api/partner/v1/titles/154587") return json({ data: title });
  if (path === DOMAIN + "/api/partner/v1/titles/154587/episodes") return json(episodesPayload);
  if (path === DOMAIN + "/api/partner/v1/titles/21") return json({ data: { ...title, anilistId: 21, malId: null } });
  if (u.startsWith(DOMAIN + "/api/partner/v1/top")) return json({ data: [title] });
  if (u.startsWith(DOMAIN + "/api/partner/v1/recent")) return json({ data: [] });
  if (u.startsWith(DOMAIN + "/api/partner/v1/session")) {
    return json({ token: "session-token", embedUrl: "https://player.example/embed/v1?t=session-token", expiresAt: 1794833708, availability: { sub: true, dub: true } });
  }
  if (u === DOMAIN + "/embed/ani/154587/1/sub" || u === DOMAIN + "/embed/ani/154587/2/sub" || u === DOMAIN + "/embed/ani/154587/3/sub") {
    return { status: 200, body: embedPage, headers: {} };
  }
  if (u.startsWith("https://player.example/api/embed/session")) {
    return json({
      source: "https://cdn.example/master.m3u8",
      kind: "hls",
      audioLang: "ja",
      subtitles: [{ url: "https://cdn.example/en.vtt", label: "English", srclang: "en" }],
    });
  }
  return { status: 404, body: "not found", headers: {} };
};

async function main() {
  assert.equal(provider.version, "1.0.0");
  assert.equal(provider.getInfo().name, "Ani.pm");
  assert.equal(provider.getInfo().type, "anime");
  assert.equal(provider.getInfo().lang, "en");

  // Settings schema: every descriptor is well formed and the defaults are sane.
  const schema = provider.getSettings();
  assert.ok(schema.length > 0);
  const keys = schema.map((s) => s.key);
  for (const wanted of ["primaryDomain", "fallbackDomains", "autoFallback", "preferredDomain", "requestTimeoutMs", "maxRetries", "autoRecovery", "preferredAudio", "preferredAudioLanguage"]) {
    assert.ok(keys.includes(wanted), "settings must expose " + wanted);
  }
  for (const entry of schema) {
    assert.equal(typeof entry.key, "string");
    assert.equal(typeof entry.label, "string");
    assert.equal(typeof entry.description, "string");
    assert.ok(["text", "bool", "enum", "multiEnum"].includes(entry.type));
    if (entry.type === "enum") {
      assert.ok(entry.options.some((o) => o.value === entry.default), entry.key + " default must be one of its options");
    }
    if (entry.type === "bool") assert.equal(typeof entry.default, "boolean");
  }

  // Domain validation: anything that is not a plain host is refused.
  assert.equal(provider._normaliseDomain("ani.pm"), "ani.pm");
  assert.equal(provider._normaliseDomain("https://ani.pm/"), "ani.pm");
  assert.equal(provider._normaliseDomain("ANI.PM"), "ani.pm");
  assert.equal(provider._normaliseDomain("not a domain"), "");
  assert.equal(provider._normaliseDomain(""), "");
  assert.deepEqual(provider._domainList("ani.pm, mirror.example\nani.pm"), ["ani.pm", "mirror.example"]);

  // Search.
  assert.deepEqual(await provider.search("", 1, {}), []);
  const found = await provider.search("Sample Anime", 1, {});
  assert.equal(found.length, 1);
  assert.equal(found[0].title, "Frieren: Beyond Journey’s End");
  assert.equal(found[0].malId, 52991);
  assert.equal(found[0].anilistId, 154587);
  assert.equal(found[0].url, "anipm://ani/154587");
  assert.equal(found[0].cover, "https://ani.pm/api/anime/cover?anilistId=154587&malId=52991");

  // Detail and episode ordering.
  const detail = await provider.getDetail("anipm://ani/154587", {});
  assert.equal(detail.title, "Frieren: Beyond Journey’s End");
  assert.equal(detail.format, "TV");
  assert.equal(detail.malId, 52991);
  assert.equal(detail.episodes.length, 5, "three episodes, sub and dub where both exist");
  assert.deepEqual(detail.episodes.map((e) => e.number), [1, 1, 2, 3, 3]);
  assert.deepEqual(detail.episodes.map((e) => e.category), ["sub", "dub", "sub", "sub", "dub"]);
  assert.equal(detail.subCount, 3);
  assert.equal(detail.dubCount, 2);

  const episodes = await provider.getEpisodes("anipm://ani/154587", {});
  assert.equal(episodes.length, 5);
  assert.match(episodes[0].url, /^anipm:\/\/ani\/154587\/1\/sub$/);

  // Stream resolution: the official embed chain, ending in a media URL.
  const streams = await provider.getVideoSources("anipm://ani/154587/1/sub", {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/master.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].kind, "sub");
  assert.equal(streams[0].subtitles.length, 1);
  assert.equal(streams[0].subtitles[0].url, "https://cdn.example/en.vtt");
  assert.equal(streams[0].headers.Referer, "https://player.example/");

  // A webpage is never handed back as a playable stream.
  assert.deepEqual(await provider.getVideoSources("not-an-episode-url", {}), []);
  assert.deepEqual(await provider.getVideoSources("", {}), []);

  // A player that answers with no media yields no stream, not a fake one.
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith("https://player.example/api/embed/session")) return json({ kind: "hls" });
    return realFetch(url, opts);
  };
  assert.deepEqual(await provider.getVideoSources("anipm://ani/154587/1/sub", {}), []);
  global.fetch = realFetch;

  // A malformed answer is a failure, not a crash.
  const saneFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.indexOf("/api/partner/v1/titles/154587/episodes") >= 0) return { status: 200, body: "{not json", headers: {} };
    return saneFetch(url, opts);
  };
  await assert.rejects(provider.getDetail("anipm://ani/154587", {}), /every configured domain failed|malformed/i);
  global.fetch = saneFetch;

  // Domain fallback: a broken primary moves to the next configured domain.
  settings = { primaryDomain: "ani.pm", fallbackDomains: "mirror.example", autoFallback: true, maxRetries: "0" };
  fail("https://ani.pm", 1);
  const fallbackCallsBefore = calls.length;
  const fallbackFound = await provider.search("Sample Anime", 1, {});
  assert.equal(fallbackFound.length, 0, "the mirror does not carry the sample title");
  assert.ok(calls.slice(fallbackCallsBefore).some((c) => c.url.indexOf("https://mirror.example/") === 0), "the fallback domain must be tried");

  // Every domain failing produces a diagnostic, not a silent empty answer.
  settings = { primaryDomain: "down.example", fallbackDomains: "also-down.example", autoFallback: true, maxRetries: "0" };
  fail("https://down.example", 1);
  fail("https://also-down.example", 1);
  await assert.rejects(provider.getDetail("anipm://ani/154587", {}), /every configured domain failed/);

  // Automatic recovery keeps the last healthy domain and retries the primary.
  settings = { primaryDomain: "ani.pm", fallbackDomains: "", autoFallback: true, maxRetries: "0" };
  const recovered = await provider.search("Sample Anime", 1, {});
  assert.equal(recovered.length, 1);

  // The preferred-audio setting decides which versions are listed.
  settings = { primaryDomain: "ani.pm", preferredAudio: "sub" };
  const subOnly = await provider.getDetail("anipm://ani/154587", {});
  assert.deepEqual(subOnly.episodes.map((e) => e.category), ["sub", "sub", "sub"]);
  settings = { primaryDomain: "ani.pm", preferredAudio: "dub" };
  const dubOnly = await provider.getDetail("anipm://ani/154587", {});
  assert.deepEqual(dubOnly.episodes.map((e) => e.category), ["dub", "dub"]);

  // A timeout is retried, bounded by the retry setting.
  settings = { primaryDomain: "ani.pm", maxRetries: "1" };
  fail("https://ani.pm", 1);
  const before = calls.length;
  const retried = await provider.search("Sample Anime", 1, {});
  assert.equal(retried.length, 1, "one transient failure is retried");
  assert.ok(calls.length > before);

  console.log("Ani.pm mocked integration tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
