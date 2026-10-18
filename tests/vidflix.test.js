const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const calls = [];
function u64le(n) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(n));
  return out;
}
function encryptedPayload(value) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const fixed = Buffer.from("9b425029a188e1131dbc32a24632a5ac9124037d52587001844f02315c00ebb0", "hex");
  const master = crypto.createHash("sha256").update(Buffer.concat([fixed, u64le(1318175778), u64le(5464207410)])).digest();
  const key = crypto.createHash("sha256").update(Buffer.concat([master, salt])).digest();
  const plain = Buffer.concat([Buffer.alloc(8), Buffer.from(JSON.stringify(value))]);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([salt, iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]).toString("base64");
}

global.__settings = {};
const provider = require("../providers/vidflix.js");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "index.json"), "utf8"));
const source = manifest.sources.find((item) => item.id === "vidflix");
const originalFetch = global.fetch;

global.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, opts });
  let body = {};
  if (u.includes("/trending/movie/week")) body = { results: [{ id: 11, title: "Mock Film", release_date: "2024-01-01", poster_path: "/p.jpg", media_type: "movie" }] };
  else if (u.includes("/trending/tv/week")) body = { results: [{ id: 95350, name: "Lanterns", first_air_date: "2026-01-01", media_type: "tv" }] };
  else if (u.includes("/movie/popular") || u.includes("/tv/popular")) body = { results: [] };
  else if (u.includes("/search/multi")) body = { results: [{ id: 95350, name: "Lanterns", first_air_date: "2026-01-01", media_type: "tv" }] };
  else if (u.includes("/tv/95350?")) body = { id: 95350, name: "Lanterns", first_air_date: "2026-01-01", number_of_seasons: 1, external_ids: { imdb_id: "tt1234567" }, genres: [{ name: "Drama" }] };
  else if (u.includes("/tv/95350/season/1")) body = { episodes: [{ episode_number: 1, name: "Pilot", air_date: "2026-08-16" }] };
  else if (u === "https://vidcore.net/tv/95350/1/1") body = '<html>\\\"en\\\":\\\"mock-session-token\\\" \\\"server\\\":\\\"\\\"</html>';
  else if (u.includes("/sB2_etpff40/")) body = encryptedPayload([{ name: "Orbit", data: "mock-server-token" }]);
  else if (u.endsWith("/2ihd9UxHIsM/mock-server-token")) body = encryptedPayload({ url: "https://cdn.example/master.m3u8" });
  else if (u.includes("vidcore.net/838f93f8")) body = encryptedPayload({ error: "unexpected route" });
  return { status: 200, body: typeof body === "string" ? body : JSON.stringify(body), headers: {} };
};

async function main() {
  assert.ok(source, "VidFlix must be registered in index.json");
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.deepEqual(provider.getSettings(), [], "native resolution must not require a hosted resolver setting");

  for (const input of [[], [0, 1, 2, 3, 254, 255], Array.from(Buffer.from("VidFlix SHA-256 test"))]) {
    assert.deepEqual(Buffer.from(provider._sha256(input)), crypto.createHash("sha256").update(Buffer.from(input)).digest());
  }
  const key = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
  const iv = Buffer.from("aabbccddeeff00112233445566778899", "hex");
  const plain = Buffer.from("VidFlix AES-CBC test");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const expected = Buffer.concat([cipher.update(plain), cipher.final()]);
  assert.deepEqual(Buffer.from(provider._aesCbcEncrypt(Array.from(key), Array.from(iv), Array.from(plain))), expected);

  const payload = { servers: [{ name: "Orbit", data: "mock-server-token" }], status: "ok" };
  assert.deepEqual(provider._decryptResolvePayload(encryptedPayload(payload)), payload);
  assert.throws(() => provider._decryptResolvePayload("invalid"), /invalid encrypted catalog response/i);
  assert.match(provider._encryptResolveToken("mock-session-token"), /^[A-Za-z0-9_-]+$/);

  const home = await provider.getHome();
  assert.equal(home.length, 2);
  assert.equal(home[1].items[0].tmdbId, 95350);
  const found = await provider.search("Lanterns", 1);
  assert.equal(found[0].tmdbIsTv, true);
  const detail = await provider.getDetail("tmdb://tv/95350");
  assert.equal(detail.title, "Lanterns");
  assert.equal(detail.episodes.length, 1);
  assert.match(detail.episodes[0].url, /"season":1/);

  const streams = await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/master.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].kind, "raw");
  assert.match(streams[0].label, /VidFlix · VidCore · Orbit/);
  assert.equal(streams[0].headers.Referer, "https://vidcore.net/tv/95350/1/1");
  assert.equal(await provider.getStreams(detail.episodes[0].url).then((r) => r.length), 1);
  assert.ok(calls.some((c) => c.url === "https://vidcore.net/tv/95350/1/1"));
  assert.ok(calls.some((c) => c.url.includes("/sB2_etpff40/")));
  assert.ok(calls.some((c) => c.url.endsWith("/2ihd9UxHIsM/mock-server-token")));
  assert.ok(calls.every((c) => !c.url.includes("hf.space") && !c.url.includes("resolver.example")));

  global.fetch = async (url) => String(url).includes("vidcore.net/tv/95350/1/1")
    ? ({ status: 200, body: "<html>no session token</html>", headers: {} })
    : ({ status: 200, body: "{}", headers: {} });
  assert.deepEqual(await provider.getVideoSources(detail.episodes[0].url), []);
  console.log("VidFlix native resolver mocked integration tests passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });
