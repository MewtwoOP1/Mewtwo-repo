const assert = require("node:assert/strict");
const calls = [];
global.__settings = { animex: { language: "dub" } };
global.fetch = async (url, options) => {
  const u = String(url);
  calls.push({url:u,options:options||{}});
  let body = {};
  if (u === "https://graphql.animex.one/graphql") {
    const request = JSON.parse(options.body);
    if (request.query.includes("searchAnime")) {
      body = { data: { searchAnime: { items: [
        { id:"frieren-123", anilistId:154587, malId:52991, titleEnglish:"Frieren: Beyond Journey's End", titleRomaji:"Sousou no Frieren", coverImage:"https://img.example/frieren.jpg", episodeCount:28 }
      ] } } };
    } else if (request.query.includes("anime(malId")) {
      body = { data: { anime: { id:"frieren-123", anilistId:154587, malId:52991, titleEnglish:"Frieren: Beyond Journey's End", coverImage:"https://img.example/frieren.jpg", subCount:28, dubCount:28 } } };
    }
  } else if (u.includes("/episodes?id=frieren-123")) {
    body = [{number:1,title:"The Journey Begins"},{number:2,title:"It Didn't Have to Be Magic"}];
  } else if (u.includes("/servers?id=frieren-123&epNum=1")) {
    body = {subProviders:[{id:"uwu",default:true},{id:"kiwi",default:false}],dubProviders:[{id:"mimi",default:true}]};
  } else if (u.includes("/sources?id=frieren-123&epNum=1&type=dub&providerId=mimi")) {
    body = {sources:[{url:"https://media.example/dub.m3u8",quality:"1080p",type:"video/mpegurl"}],tracks:[{url:"https://media.example/en.vtt",label:"English",lang:"en"}],headers:{Referer:"https://plyr.animex.one/",Origin:"https://plyr.animex.one"}};
  } else if (u.includes("/sources?id=frieren-123&epNum=1&type=sub&providerId=uwu")) {
    body = {sources:[{url:"https://media.example/sub.m3u8",quality:"720p",type:"video/mpegurl"}],headers:{Referer:"https://plyr.animex.one/",Origin:"https://plyr.animex.one"}};
  }
  return {status:200,body:JSON.stringify(body)};
};
const provider=require("../providers/animex.js");
async function main(){
  assert.equal(provider.version,"1.0.0");
  assert.equal(provider.getInfo().name,"AnimeX");
  assert.equal(provider.getInfo().logo,"https://animex.one/_app/immutable/assets/favicon.CdbYna26.png");
  assert.equal(provider.getSettings()[0].key,"language");
  const rows=await provider.search("Frieren",1,{});
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,"frieren-123");
  assert.equal(rows[0].anilistId,154587);
  const detail=await provider.getDetail("frieren-123",{malId:52991});
  assert.deepEqual(detail.episodes.map(e=>e.number),[1,2]);
  const streams=await provider.getVideoSources(detail.episodes[0].url,{});
  assert.equal(streams.length,2);
  assert.ok(streams.some(s=>s.kind==="dub" && s.url==="https://media.example/dub.m3u8"));
  assert.ok(streams.some(s=>s.kind==="sub" && s.url==="https://media.example/sub.m3u8"));
  assert.ok(calls.some(c=>c.url==="https://graphql.animex.one/graphql" && c.options.method==="POST"));
  assert.ok(calls.every(c=>!c.url.includes("aniwatchtv.site")), "must not use deprecated challenged proxy hosts");
  console.log("AnimeX mocked integration tests passed.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
