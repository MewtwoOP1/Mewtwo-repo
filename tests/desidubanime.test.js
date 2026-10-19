const assert = require("node:assert/strict");

const calls = [];
const enc = (s) => Buffer.from(s, "binary").toString("base64");
const anime = {
  id: 812,
  slug: "naruto-shippuden",
  title: { rendered: "Naruto &amp; Shippuden" },
  excerpt: { rendered: "<p>Hindi dubbed anime</p>" },
  _embedded: { "wp:featuredmedia": [{ source_url: "https://img.example/naruto.jpg" }] }
};
const episodes = [
  { slug: "naruto-shippuden-episode-1", title: { rendered: "Watch Now" } },
  { slug: "naruto-shippuden-episode-2", title: { rendered: "Episode Two" } }
];
global.fetch = async function (url, options) {
  url = String(url); calls.push({ url, options: options || {} });
  let body = "", status = 200;
  if (url.includes("/wp-json/wp/v2/anime?tags=74")) {
    body = JSON.stringify([{slug:"naruto-shippuden",title:{rendered:"Naruto &amp; Shippuden"}}]);
  } else if (url.includes("/wp-json/wp/v2/anime?tags=78")) {
    body = JSON.stringify([{slug:"tamil-title",title:{rendered:"Tamil Title"}}]);
  } else if (url.includes("/wp-json/wp/v2/anime?tags=79")) {
    body = JSON.stringify([{slug:"telugu-title",title:{rendered:"Telugu Title"}}]);
  } else if (url.includes("/wp-json/wp/v2/anime?search=Naruto")) {
    body = JSON.stringify([{slug:"naruto-shippuden",title:{rendered:"Naruto &amp; Shippuden"}}]);
  } else if (url.includes("/wp-json/wp/v2/anime?slug=naruto-shippuden")) {
    body = JSON.stringify([anime]);
  } else if (url === "https://www.desidubanime.me/anime/naruto-shippuden/") {
    body = '<a href="/watch/naruto-shippuden-episode-1/"></a><a href="/watch/naruto-shippuden-episode-2/"></a>';
  } else if (url.includes("/wp-json/wp/v2/episode?search=naruto%20shippuden")) {
    body = JSON.stringify(episodes);
  } else if (url === "https://www.desidubanime.me/watch/naruto-shippuden-episode-1/") {
    body = '<span data-embed-id="' + enc("VidMoly") + ':' + enc("https://vidmoly.example/embed/abc") + '"></span>';
  } else if (url === "https://vidmoly.example/embed/abc") {
    body = "sources: [{file: 'https://cdn.example/master.m3u8'}]";
  } else {
    status = 404;
  }
  return { status, ok: status >= 200 && status < 300, body, text: async () => body, json: async () => JSON.parse(body) };
};

const provider = require("../providers/desidubanime.js");
async function main() {
  assert.equal(provider.version, "1.0.1");
  assert.equal(provider.getInfo().name, "DesiDub Anime");
  assert.equal(provider.getInfo().logo, "https://www.google.com/s2/favicons?sz=256&domain=desidubanime.me");
  assert.deepEqual(provider.getSettings(), []);
  assert.deepEqual(await provider.search("   "), []);
  const found = await provider.search("Naruto");
  assert.equal(found.length, 1);
  assert.equal(found[0].title, "Naruto & Shippuden");
  assert.equal(found[0].url, "desidubanime://anime/naruto-shippuden");
  const home = await provider.getHome();
  assert.deepEqual(home.map(x => x.title), ["Hindi Dubbed", "Tamil Dubbed", "Telugu Dubbed"]);
  assert.equal(home[0].items[0].title, "Naruto & Shippuden");
  const detail = await provider.getDetail(found[0].url);
  assert.equal(detail.title, "Naruto & Shippuden");
  assert.equal(detail.description, "Hindi dubbed anime");
  assert.equal(detail.episodes.length, 2);
  assert.deepEqual(detail.episodes.map(e => e.number), [1, 2]);
  assert.equal(detail.episodes[0].title, "Episode 1");
  const streams = await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://cdn.example/master.m3u8");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[0].kind, "dub");
  assert.ok(calls.some(x => x.url.includes("/wp-json/wp/v2/episode?search=naruto%20shippuden")));
  assert.ok(calls.some(x => x.url === "https://vidmoly.example/embed/abc"));
  console.log("DesiDub mocked catalog, language rows, metadata, episode IDs and VidMoly HLS extraction tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
