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
  if (url === "https://anikototv.to/filter?keyword=Jujutsu%20Kaisen&page=1") return { status: 200, body: '<div class="item"><a href="/watch/jujutsu-kaisen" title="24 24 24 TV"><img data-src="https://img.example/jjk.jpg" alt="Jujutsu Kaisen Poster"><div class="name d-title">Jujutsu Kaisen</div><span>24 24 24 TV</span></a></div>' };
  if (url === "https://anikotoapi.site/recent-anime?page=1&per_page=24") return { status: 200, body: JSON.stringify({ ok: true, data: [{ id: "42", title: "Frieren", poster: "https://img.example/f.jpg" }, { id: "43", title: { english: "Jujutsu Kaisen", romaji: "Jujutsu Kaisen" }, poster: "https://img.example/jjk.jpg" }, { id: "99", title: "24 24 24 TV" }] }) };
  if (url === "https://anikotoapi.site/series/frieren") return { status: 200, body: JSON.stringify({ ok: true, anime: { id: "42", title: "Frieren: Beyond Journey's End", poster: "https://img.example/f.jpg", synopsis: "An elf mage travels on." }, episodes: [{ number: 1, embed_url: { sub: "https://megaplay.buzz/stream/mal/52991/1/sub", dub: "https://vidwish.live/stream/mal/52991/1/dub" } }] }) };
  return { status: 404, body: "{}" };
};
async function main() {
  assert.equal(provider.version, "1.1.0");
  assert.equal(provider.getInfo().name, "AniKoto");
  const cardSearch = await provider.search("Jujutsu Kaisen", 1, {});
  assert.equal(cardSearch.length, 1, "numeric-only card metadata must not become an anime title");
  assert.equal(cardSearch[0].title, "Jujutsu Kaisen");
  const home = await provider.getHome({});
  assert.equal(home[0].items.length, 2, "API titles must be normalized and numeric-only titles skipped");
  assert.equal(home[0].items[0].id, "42");
  assert.equal(home[0].items[1].title, "Jujutsu Kaisen");
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
