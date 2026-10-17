const assert = require("node:assert/strict");
global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
};
const calls = [];
global.fetch = async function (url, options) {
  url = String(url); options = options || {}; calls.push({url, options});
  if (url === "https://ani.pm/api/anime/catalog?q=Frieren&page=1") {
    return {status:200, body:JSON.stringify({items:[{
      id:6351, slug:"frieren-beyond-journey-end", title:"Frieren: Beyond Journey's End",
      native:"Sousou no Frieren", poster:"https://img.example/frieren.jpg", year:2023,
      episodeCount:28, subCount:28, dubCount:28, malId:52991, anilistId:154587,
      synopsis:"An elf mage travels on."
    }]})};
  }
  if (url === "https://ani.pm/api/anime/catalog?q=LocalIdCollision&page=1") {
    return {status:200, body:JSON.stringify({items:[{
      id:1000000958, slug:"local-id-collision", title:"Local Catalogue ID Test",
      anilist:1000000958
    }]})};
  }
  if (url === "https://ani.pm/api/anime/catalog?q=Bleach&page=1") {
    return {status:200, body:JSON.stringify({items:[]})};
  }
  if (url === "https://ani.pm/api/anime/search?q=Bleach&page=1") {
    return {status:200, body:JSON.stringify({items:[{
      id:999, slug:"bleach", title:"Bleach", malId:269, anilistId:269
    }]})};
  }
  if (url === "https://ani.pm/api/anime/series/6351") {
    return {status:200, body:JSON.stringify({id:6351, slug:"frieren-beyond-journey-end",
      title:"Frieren: Beyond Journey's End", native:"Sousou no Frieren",
      poster:"https://img.example/frieren.jpg", year:2023, malId:52991, anilistId:154587,
      synopsis:"An elf mage travels on.", genres:["Adventure","Fantasy"], episodeCount:28,
      episodes:[{number:2,title:"It Would Be Embarrassing When We Met Again"},
        {number:1,title:"The End",thumbnail:"https://img.example/ep1.jpg"}]})};
  }
  if (url.indexOf("https://ani.pm/api/anime/src/servers?title=frieren-beyond-journey-end&ep=1") === 0) {
    return {status:200, body:JSON.stringify({sub:[
      {kind:"embed",name:"Vidnest",url:"https://vidnest.example/embed/1",priority:99},
      {kind:"hls",name:"Onyx 1080p",provider:"onyx",url:"/api/anime/src/hls?t=abc",priority:10,
        tracks:[{file:"/api/anime/src/vtt?t=sub",label:"English",kind:"captions"}]},
      {kind:"file",name:"Vega MP4",provider:"vega",url:"/api/anime/src/file?t=def",priority:5}
    ],dub:[{kind:"hls",name:"Dub HLS",url:"/api/anime/src/hls?t=dub",priority:10}]})};
  }
  return {status:404, body:"{}"};
};
const provider = require("../providers/anipm.js");
async function main() {
  assert.equal(provider.version, "1.0.1");
  assert.equal(provider.getInfo().name, "Ani.pm");
  assert.equal(provider.getInfo().type, "anime");
  assert.deepEqual(provider.getSettings(), []);
  const results = await provider.search("Frieren", 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Frieren: Beyond Journey's End");
  assert.equal(results[0].malId, 52991);
  assert.equal(results[0].anilistId, 154587);
  // A large source catalogue ID must not be mistaken for an AniList ID just
  // because the source uses the ambiguous field name `anilist`.
  const localIdResult = await provider.search("LocalIdCollision", 1, {});
  assert.equal(localIdResult.length, 1);
  assert.equal(localIdResult[0].anilistId, null);
  assert.match(localIdResult[0].url, /^anipm:\/\/1000000958\\|/);
  const detail = await provider.getDetail(results[0].url, {category:"sub"});
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.malId, 52991);
  assert.equal(detail.anilistId, 154587);
  assert.deepEqual(detail.episodes.map(e => e.number), [1,2]);
  assert.match(detail.episodes[0].url, /^anipm-episode:\/\/sub\|6351\|/);
  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 2, "embed/iframe entries must not be returned as playable streams");
  assert.equal(streams[0].url, "https://ani.pm/api/anime/src/hls?t=abc");
  assert.equal(streams[0].container, "hls");
  assert.equal(streams[1].url, "https://ani.pm/api/anime/src/file?t=def");
  assert.equal(streams[1].container, "mp4");
  assert.equal(streams[0].subtitles[0].url, "https://ani.pm/api/anime/src/vtt?t=sub");
  assert.equal(streams[0].headers.Referer, "https://ani.pm/");
  const dubDetail = await provider.getDetail(results[0].url, {category:"dub"});
  assert.match(dubDetail.episodes[0].url, /^anipm-episode:\/\/dub\|/);
  const dubStreams = await provider.getVideoSources(dubDetail.episodes[0].url, {});
  assert.equal(dubStreams.length, 1);
  assert.equal(dubStreams[0].url, "https://ani.pm/api/anime/src/hls?t=dub");
  const fallback = await provider.search("Bleach", 1, {});
  assert.equal(fallback.length, 1, "search API fallback should be used when catalogue returns no results");
  assert.ok(calls.some(c => c.url.includes("/api/anime/series/6351")));
  console.log("Ani.pm mocked catalogue, metadata, episode order, sub/dub and direct HLS/MP4 tests passed.");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
