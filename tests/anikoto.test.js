const assert = require("node:assert/strict");
global.htmlText = function (s) { return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim(); };
const calls = [];
global.extractVideo = async function (url, opts) {
  calls.push({ url: String(url), opts: opts || {} });
  return [{ url: "https://cdn.example/frieren.m3u8", container: "hls", quality: "1080p", headers: { Referer: String(url) } }];
};
const provider = require("../providers/anikoto.js");
global.fetch = async function (url, options) {
  url = String(url); calls.push({ url, options: options || {} });
  if (url === "https://anikotoapi.site/recent-anime?page=1&per_page=24") return { status: 200, body: JSON.stringify({ ok: true, data: [{ id: "42", title: "Frieren", poster: "https://img.example/f.jpg" }] }) };
  if (url === "https://anikotoapi.site/series/frieren") return { status: 200, body: JSON.stringify({ ok: true, anime: { id: "42", title: "Frieren: Beyond Journey's End", poster: "https://img.example/f.jpg", synopsis: "An elf mage travels on." }, episodes: [{ number: 1, embed_url: { sub: "https://megaplay.buzz/stream/mal/52991/1/sub", dub: "https://vidwish.live/stream/mal/52991/1/dub" } }] }) };
  return { status: 404, body: "{}" };
};
async function main() {
  assert.equal(provider.version, "1.1.0");
  assert.equal(provider.getInfo().name, "AniKoto");
  const home = await provider.getHome({});
  assert.equal(home[0].items[0].id, "42");
  assert.ok(calls.some(c => c.url === "https://anikotoapi.site/recent-anime?page=1&per_page=24"));
  const detail = await provider.getDetail("frieren", {});
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.episodes.length, 2);
  const sub = detail.episodes.find(e => e.audio === "sub");
  const streams = await provider.getVideoSources(sub.url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/frieren.m3u8");
  assert.ok(calls.some(c => c.url === "https://anikotoapi.site/series/frieren"));
  assert.ok(calls.some(c => c.url === "https://megaplay.buzz/stream/mal/52991/1/sub"));
  console.log("AniKoto API catalogue, episode embeds and stream extraction tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
