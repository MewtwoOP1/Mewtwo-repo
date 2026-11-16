const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { webcrypto } = require("node:crypto");
const provider = require("../providers/gotaku.js");

const calls = [];
let settings = {};
let failures = new Map();

global.__SOURCE_ID = "gotaku";
Object.defineProperty(global, "__settings", {
  configurable: true,
  get() {
    return { gotaku: settings };
  },
});

const PLAYER_KEY = [69, 142, 84, 3, 196, 10, 115, 51, 39, 6, 223, 64, 97, 147, 221, 107, 4, 10, 46, 169, 122, 107, 181, 155, 82, 178, 148, 166, 16, 6, 230, 239];

const title = {
  id: "vbhgad",
  url: "/title/vbhgad",
  watch_url: "/title/vbhgad?ep=1",
  name: "Frieren: Beyond Journey’s End",
  poster_url: "https://s4.anilist.co/cover.jpg",
  banner_url: "https://s4.anilist.co/banner.jpg",
  synopsis: "The adventure is over but life goes on.",
  format: "TV",
  age_rating: "PG-13",
  year: 2023,
  score: 9.24,
  is_adult: false,
  status: "Releasing",
  season: "Fall 2023",
  aired: "Oct 20, 1999",
  alt_names: ["葬送のフリーレン"],
  episodes: { latest_sub: 28, latest_dub: 27, total: null },
  links: { al: "https://anilist.co/anime/154587", mal: "https://myanimelist.net/anime/52991" },
  anilist_id: 154587,
  genres: [{ id: 1, name: "Adventure" }],
  themes: [{ id: 9, name: "Magic" }],
  studios: [{ id: 2, name: "Madhouse" }],
};

const detailPayload = {
  data: {
    title,
    seasons: [{ id: "abc", name: "Season 1", full_name: "Frieren Season 1", is_current: true }],
    relations: [],
  },
};

const episodeRows = [
  { id: "ep1", number: 1, label: "1", name: "The Journey's End", thumbnail_url: "https://gotaku.to/e1.jpg", aired_at: "2023-10-20T10:00:00Z", is_filler: false, is_canon: true, sub: true, dub: true },
  { id: "ep2", number: 2, label: "2", name: "Second", thumbnail_url: "https://gotaku.to/e2.jpg", aired_at: "2023-10-27T10:00:00Z", is_filler: false, is_canon: true, sub: true, dub: false },
];

// Seals the catalogue payloads the way gotaku.to does: AES-256-GCM under the
// API key with a marker byte in front, zlib compressed.
async function sealApi(value) {
  const key = await webcrypto.subtle.importKey("raw", Buffer.from(provider._sealKey()), "AES-GCM", false, ["encrypt"]);
  const iv = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const cipher = webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, zlib.deflateSync(Buffer.from(JSON.stringify(value))));
  const body = Buffer.from(await cipher);
  return Buffer.concat([Buffer.from([10]), iv, body]);
}

// Seals a player answer the way gotakudl.top does.
async function sealPlayer(value, salt) {
  const base = await webcrypto.subtle.importKey("raw", Buffer.from(PLAYER_KEY), "HKDF", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: Buffer.from(salt), info: Buffer.from("manifest-resp|v1") },
    base,
    256,
  );
  const key = await webcrypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt"]);
  const iv = Buffer.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2]);
  const body = Buffer.from(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, Buffer.from(JSON.stringify(value))));
  return Buffer.concat([iv, body]).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const embedPage = [
  "<html><body",
  ' data-manifest-base="https://gotakudl.top/embed/300848/manifest"',
  ' data-captions-base="https://gotakudl.top/embed/300848/captions"',
  ' data-manifest-stamp="1794822999.abcdefghijklmnop"',
  ' data-download-url="https://gotakudl.top/download/token">',
  "</body></html>",
].join("");

const session = {
  title: "Frieren - 001",
  source: "https://cdn.example/embed/1/master.m3u8",
  fallbacks: ["https://fallback-one.example", "https://fallback-two.example"],
  token: "abc",
  expiresAt: 1794822999,
  captions: [],
};

global.fetch = async (url, opts) => {
  const u = String(url);
  calls.push({ url: u, opts: opts || {} });
  const origin = u.startsWith("https://") ? u.slice(0, u.indexOf("/", 8)) : "";
  const left = failures.get(origin) || 0;
  if (left > 0) {
    failures.set(origin, left - 1);
    return { status: 503, body: "temporary", headers: {}, arrayBuffer: async () => new ArrayBuffer(0) };
  }
  const path = u.split("?")[0];
  if (path === "https://gotaku.to/api/v1/titles") {
    return { status: 200, body: JSON.stringify({ data: [title], meta: { page: 1, limit: 25, total: 1, has_more: false } }), headers: {} };
  }
  if (path === "https://gotaku.to/api/v1/titles/vbhgad") {
    return { status: 200, body: JSON.stringify(detailPayload), headers: {} };
  }
  if (path === "https://gotaku.to/api/v1/titles/vbhgad/episodes") {
    const sealed = await sealApi({ data: episodeRows });
    return { status: 200, body: sealed.toString("binary"), headers: {}, arrayBuffer: async () => sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength) };
  }
  if (path === "https://gotaku.to/api/v1/episodes/ep1/embed") {
    const sealed = await sealApi({ data: { url: "https://gotakudl.top/embed/token", skip: null } });
    return { status: 200, body: sealed.toString("binary"), headers: {}, arrayBuffer: async () => sealed.buffer.slice(sealed.byteOffset, sealed.byteOffset + sealed.byteLength) };
  }
  if (path.indexOf("https://gotakudl.top/embed/") === 0 && path.indexOf("/manifest/") < 0) {
    return { status: 200, body: embedPage, headers: {} };
  }
  if (path.indexOf("/manifest/") >= 0) {
    // Read the nonce the provider sent so the answer can be sealed with it.
    const token = path.split("/").pop();
    const raw = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const key = await webcrypto.subtle.importKey("raw", Buffer.from(PLAYER_KEY), "AES-GCM", false, ["decrypt"]);
    const plain = Buffer.from(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12)));
    const nonce = JSON.parse(plain.toString("utf8")).nonce;
    const salt = Buffer.from(nonce.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const answer = await sealPlayer(session, salt);
    return { status: 200, body: answer, headers: {} };
  }
  return { status: 404, body: "not found", headers: {} };
};

async function main() {
  assert.equal(provider.version, "1.0.1");
  assert.equal(provider.getInfo().name, "Gotaku");
  assert.equal(provider.getInfo().type, "anime");
  assert.equal(provider.getInfo().lang, "en");
  assert.equal(provider.getInfo().baseUrl, "https://gotaku.to");

  // Settings schema.
  const schema = provider.getSettings();
  const keys = schema.map((s) => s.key);
  for (const wanted of ["primaryDomain", "fallbackDomains", "autoFallback", "preferredDomain", "requestTimeoutMs", "maxRetries", "autoRecovery", "preferredAudio", "preferredAudioLanguage"]) {
    assert.ok(keys.includes(wanted), "settings must expose " + wanted);
  }
  for (const entry of schema) {
    assert.equal(typeof entry.key, "string");
    assert.equal(typeof entry.label, "string");
    assert.equal(typeof entry.description, "string");
    assert.ok(["text", "bool", "enum", "multiEnum"].includes(entry.type));
    if (entry.type === "enum") assert.ok(entry.options.some((o) => o.value === entry.default));
    if (entry.type === "bool") assert.equal(typeof entry.default, "boolean");
  }

  // Domain validation.
  assert.equal(provider._normaliseDomain("gotaku.to"), "gotaku.to");
  assert.equal(provider._normaliseDomain("https://gotaku.to/"), "gotaku.to");
  assert.equal(provider._normaliseDomain("not a domain"), "");
  assert.deepEqual(provider._domainList("gotaku.to, mirror.example\ngotaku.to"), ["gotaku.to", "mirror.example"]);

  // Search.
  assert.deepEqual(await provider.search("", 1, {}), []);
  const found = await provider.search("frieren", 1, {});
  assert.equal(found.length, 1);
  assert.equal(found[0].title, "Frieren: Beyond Journey’s End");
  assert.equal(found[0].url, "gotaku://title/vbhgad");
  assert.equal(found[0].anilistId, 154587);
  assert.equal(found[0].malId, 52991);
  assert.equal(found[0].cover, "https://s4.anilist.co/cover.jpg");

  // Detail and episode ordering.
  const detail = await provider.getDetail("gotaku://title/vbhgad", {});
  assert.equal(detail.title, "Frieren: Beyond Journey’s End");
  assert.equal(detail.format, "TV");
  assert.equal(detail.anilistId, 154587);
  assert.equal(detail.malId, 52991);
  assert.deepEqual(detail.genres, ["Adventure"]);
  assert.equal(detail.episodes.length, 2, "one row per episode: the app counts the rows it is given");
  assert.deepEqual(detail.episodes.map((e) => e.number), [1, 2]);
  assert.deepEqual(detail.episodes.map((e) => e.category), ["sub", "sub"]);
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 1);

  // The app asks for a track through opts.category.
  const dubFirst = await provider.getEpisodes("gotaku://title/vbhgad", { category: "dub" });
  assert.deepEqual(dubFirst.map((e) => e.category), ["dub", "sub"], "the requested track wins; an episode without it falls back");

  const episodes = await provider.getEpisodes("gotaku://title/vbhgad", {});
  assert.equal(episodes.length, 2);
  assert.match(episodes[0].url, /^gotaku:\/\/episode\/vbhgad\/ep1\/sub$/);

  // Stream resolution.
  const streams = await provider.getVideoSources("gotaku://episode/vbhgad/ep1/sub", {});
  assert.equal(streams.length, 3, "the playback source and its two fallbacks");
  assert.equal(streams[0].url, "https://cdn.example/embed/1/master.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].kind, "sub");
  assert.equal(streams[0].headers.Referer, "https://gotakudl.top/embed/token");
  assert.equal(streams[1].url, "https://fallback-one.example/embed/1/master.m3u8", "a fallback keeps the primary path");

  // A webpage is never handed back as a playable stream.
  assert.deepEqual(await provider.getVideoSources("not-an-episode-url", {}), []);

  // A malformed answer is a failure, not a crash.
  const saneFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).indexOf("/episodes") >= 0) return { status: 200, body: "not sealed", headers: {} };
    return saneFetch(url, opts);
  };
  await assert.rejects(provider.getDetail("gotaku://title/vbhgad", {}), /no episodes|not found/i);
  global.fetch = saneFetch;

  // Domain fallback: a broken primary moves to the next configured domain.
  settings = { primaryDomain: "gotaku.to", fallbackDomains: "mirror.example", autoFallback: true, maxRetries: "0" };
  failures.set("https://gotaku.to", 1);
  const before = calls.length;
  const fallbackFound = await provider.search("frieren", 1, {});
  assert.equal(fallbackFound.length, 0, "the mirror does not carry the sample title");
  assert.ok(calls.slice(before).some((c) => c.url.indexOf("https://mirror.example/") === 0), "the fallback domain must be tried");

  // Every domain failing produces a diagnostic.
  settings = { primaryDomain: "down.example", fallbackDomains: "also-down.example", autoFallback: true, maxRetries: "0" };
  failures.set("https://down.example", 1);
  failures.set("https://also-down.example", 1);
  await assert.rejects(provider.getDetail("gotaku://title/vbhgad", {}), /every configured domain failed/);

  // The preferred-audio setting decides which versions are listed.
  settings = { primaryDomain: "gotaku.to", preferredAudio: "sub" };
  const subOnly = await provider.getDetail("gotaku://title/vbhgad", {});
  assert.deepEqual(subOnly.episodes.map((e) => e.category), ["sub", "sub"]);
  settings = { primaryDomain: "gotaku.to", preferredAudio: "dub" };
  const dubOnly = await provider.getDetail("gotaku://title/vbhgad", {});
  assert.deepEqual(dubOnly.episodes.map((e) => e.category), ["dub", "sub"], "a dub-only preference still lists an episode that has no dub");

  // The sealed answer reaches a provider in more than one shape. The seal
  // authenticates it, so the source tries every reading and keeps the one that
  // verifies: raw bytes, a byte list, raw text and base64 text.
  const rawSeal = await sealApi({ data: episodeRows });
  const forms = {
    "raw bytes": Buffer.from(rawSeal),
    "byte list": "[" + Array.from(rawSeal).join(", ") + "]",
    "raw text": Buffer.from(rawSeal).toString("latin1"),
    "base64 text": Buffer.from(rawSeal).toString("base64"),
  };
  for (const [label, body] of Object.entries(forms)) {
    const opened = provider._openApiSeal(body);
    assert.equal(opened.length, Buffer.from(JSON.stringify({ data: episodeRows })).length, label + " must open to the same payload");
    assert.deepEqual(JSON.parse(Buffer.from(opened).toString("utf8")).data.length, 2, label + " must list both episodes");
  }
  assert.throws(() => provider._openApiSeal("not a sealed payload at all"), /could not be opened/, "an unreadable answer is a clear failure");

  console.log("Gotaku mocked integration tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
