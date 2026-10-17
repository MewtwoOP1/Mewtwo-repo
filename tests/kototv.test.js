const assert=require("node:assert/strict");
global.htmlText=function(s){return String(s||"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g," ").trim();};
const provider=require("../providers/kototv.js");
const calls=[];
global.fetch=async function(url,options){
 url=String(url);calls.push(url);
 if(url==="https://kototv.to/anime?q=Attack%20on%20Titan")return {status:200,body:'<a href="/anime/attack-on-titan"><img src="/a.jpg"><span class="title">Attack on Titan</span></a>'};
 if(url==="https://kototv.to/anime/attack-on-titan/watch/1")return {status:200,body:'<h1>Attack on Titan</h1><meta property="og:image" content="https://img.example/a.jpg"><a href="/anime/attack-on-titan/watch/1">1 Episode 1 SUBDUB</a><a href="/anime/attack-on-titan/watch/2">2 Episode 2 SUBDUB</a><iframe src="https://player.kototv.to/embed/abc123/sub"></iframe>'};
 if(url==="https://player.kototv.to/embed/abc123/sub")return {status:200,body:'<div id="player" data-id="7788"></div><script src="/player.js"></script>'};
 if(url==="https://player.kototv.to/stream/getSources?id=7788&type=sub")return {status:200,body:JSON.stringify({sources:{file:"https://media.example/master.m3u8"},tracks:[]})};
 return {status:404,body:"not found"};
};
async function main(){
 assert.equal(provider.getInfo().name,"KotoTV");
 assert.equal(provider.getInfo().baseUrl,"https://kototv.to");
 assert.deepEqual(provider.getSettings(),[]);
 assert.deepEqual(await provider.search("",1,{}),[]);
 const results=await provider.search("Attack on Titan",1,{});
 assert.equal(results.length,1);assert.equal(results[0].id,"attack-on-titan");
 const detail=await provider.getDetail("attack-on-titan",{});
 assert.equal(detail.episodes.length,2);assert.equal(detail.episodes[0].title,"Episode 1");
 const streams=await provider.getVideoSources(detail.episodes[0].url,{});
 assert.equal(streams.length,1);assert.equal(streams[0].url,"https://media.example/master.m3u8");assert.equal(streams[0].container,"hls");
 assert(calls.includes("https://player.kototv.to/embed/abc123/sub"));
 assert(calls.includes("https://player.kototv.to/stream/getSources?id=7788&type=sub"));
 console.log("KotoTV current-route/player-iframe tests passed.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
