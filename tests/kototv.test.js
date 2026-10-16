const assert=require("node:assert/strict");
global.htmlText=function(s){return String(s||"").replace(/<[^>]*>/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();};
const provider=require("../providers/kototv.js");
const calls=[];
function encodePayload(value){
 const key="otaku-embed-v1",plain=unescape(encodeURIComponent(JSON.stringify(value)));
 let encoded="";
 for(let i=0;i<plain.length;i++)encoded+=String.fromCharCode(plain.charCodeAt(i)^key.charCodeAt(i%key.length));
 return Buffer.from(encoded,"binary").toString("base64");
}
const playerPayload=encodePayload({src:"https://cdn.example/frieren-1080p.m3u8",subtitles:[{src:"https://cdn.example/en.vtt",lang:"en",label:"English"}]});
global.__settings={};
global.fetch=async function(url,options){
 url=String(url);calls.push({url,options:options||{}});
 if(url==="https://kototv.to/api/ajax/search?q=Frieren&page=1")return {status:200,body:JSON.stringify({success:true,data:{results:[{slug:"frieren",title:"Frieren: Beyond Journey's End",poster:"https://img.example/f.jpg"}]}})};
 if(url==="https://kototv.to/anime/frieren")return {status:200,body:'<h1>Frieren</h1><meta content="https://img.example/f.jpg" property="og:image"><li data-dub="0" class="ep" data-num="1" data-sub="1"></li>'};
 if(url==="https://kototv.to/")return {status:200,body:'<a title="Frieren" href="/anime/frieren"><span>Frieren</span></a>'};
 if(url==="https://kototv.to/anime/frieren/watch/1")return {status:200,body:'<li data-dub="0" data-num="1" data-sub="1"></li><script>const baseEmbedUrl = "https://player.kototv.to/embed/frieren-1";</script>'};
 if(url==="https://player.kototv.to/embed/frieren-1/sub")return {status:200,body:'<script>window.__P = "'+playerPayload+'";</script>'};
 return {status:404,body:"not found"};
};
async function main(){
 assert.equal(provider.version,"1.0.4");
 assert.equal(provider.getInfo().name,"KotoTV");
 assert.equal(provider.getInfo().baseUrl,"https://kototv.to");
 assert.deepEqual(await provider.search("",1,{}),[]);
 const results=await provider.search("Frieren",1,{});
 assert.equal(results.length,1);assert.equal(results[0].id,"frieren");assert.equal(results[0].title,"Frieren: Beyond Journey's End");
 const home=await provider.getHome({});
 assert.equal(home[0].items[0].id,"frieren");
 const detail=await provider.getDetail("frieren",{});
 assert.equal(detail.title,"Frieren");assert.equal(detail.episodes.length,1);assert.equal(detail.episodes[0].number,1);
 assert.match(detail.episodes[0].url,/^kototv:\/\//);
 const streams=await provider.getVideoSources("kototv://frieren/1",{});
 assert.equal(streams.length,1);
 assert.equal(streams[0].url,"https://cdn.example/frieren-1080p.m3u8");
 assert.equal(streams[0].container,"hls");
 assert.equal(streams[0].headers.Referer,"https://player.kototv.to/");
 assert.equal(streams[0].subtitles[0].url,"https://cdn.example/en.vtt");
 assert.ok(calls.some(c=>c.url==="https://player.kototv.to/embed/frieren-1/sub"),"player request must preserve the external player hostname");
 assert.ok(!calls.some(c=>c.url==="https://kototv.to/embed/frieren-1/sub"),"player request must not be misrouted back to the anime site");
 global.__settings={kototv:{domain:"https://aniorbit.cc"}};
 const alt=await provider.search("Frieren",1,{});
 assert.equal(alt.length,0,"an unmocked domain must fail closed without cross-domain failover");
 assert.ok(calls.some(c=>c.url==="https://aniorbit.cc/api/ajax/search?q=Frieren&page=1"),"selected domain should control site requests");
 console.log("KotoTV mocked integration and external-player routing tests passed.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
