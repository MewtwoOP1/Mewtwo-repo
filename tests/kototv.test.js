const assert=require("node:assert/strict");
global.htmlText=function(s){return String(s||"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/\s+/g," ").trim();};
const provider=require("../providers/kototv.js");
const calls=[];
global.extractVideo=async function(url,opts){calls.push({url:String(url),extract:true,options:opts||{}});if(String(url)==="https://player.kototv.to/embed/frieren-1")return [{url:"https://cdn.example/frieren-1080p.m3u8",quality:"1080p",container:"hls",headers:{Referer:"https://player.kototv.to/"}}];return [];};
global.__settings={};
global.fetch=async function(url,options){
 url=String(url);calls.push({url,options:options||{}});
 if(url==="https://kototv.to/anime?q=Frieren")return {status:200,body:'<div class="item"><a href="/anime/frieren" title="Frieren: Beyond Journey\'s End"><img src="https://img.example/f.jpg">Frieren</a></div>'};
 if(url==="https://kototv.to/")return {status:200,body:'<a title="Frieren" href="/anime/frieren"><span>Frieren</span></a>'};
 if(url==="https://kototv.to/anime/frieren/watch/1")return {status:200,body:'<h1>Frieren: Beyond Journey\'s End</h1><meta property="og:image" content="https://img.example/f.jpg"><a href="/anime/frieren/watch/1">Episode 1</a><iframe src="https://player.kototv.to/embed/frieren-1"></iframe>'};
 if(url==="https://player.kototv.to/embed/frieren-1")return {status:200,body:'<script>var player = {"file":"https://cdn.example/frieren-1080p.m3u8"};</script>'};
 return {status:404,body:"not found"};
};
async function main(){
 assert.equal(provider.version,"1.0.7");
 assert.equal(provider.getInfo().name,"KotoTV");
 assert.equal(provider.getInfo().baseUrl,"https://kototv.to");
 assert.deepEqual(await provider.search("",1,{}),[]);
 const results=await provider.search("Frieren",1,{});
 assert.equal(results.length,1);assert.equal(results[0].id,"frieren");assert.equal(results[0].title,"Frieren: Beyond Journey's End");
 const home=await provider.getHome({});
 assert.equal(home[0].items[0].id,"frieren");
 const detail=await provider.getDetail("frieren",{});
 assert.equal(detail.title,"Frieren: Beyond Journey's End");assert.equal(detail.episodes.length,1);assert.equal(detail.episodes[0].number,1);
 const streams=await provider.getVideoSources("kototv://frieren/1",{});
 assert.equal(streams.length,1);
 assert.equal(streams[0].url,"https://cdn.example/frieren-1080p.m3u8");
 assert.equal(streams[0].container,"hls");
 assert.ok(calls.some(c=>c.extract&&c.url==="https://player.kototv.to/embed/frieren-1"),"Zangetsu shared extractor must receive the actual player iframe URL");
 assert.ok(calls.some(c=>c.url==="https://kototv.to/anime?q=Frieren"),"search should use current catalog route");
 assert.ok(calls.some(c=>c.url==="https://kototv.to/anime/frieren/watch/1"),"detail and playback should use current watch route");
 assert.ok(calls.some(c=>c.url==="https://player.kototv.to/embed/frieren-1"),"player iframe should be requested at its actual host");
 assert.ok(!calls.some(c=>c.url==="https://kototv.to/embed/frieren-1"),"external player must not be rewritten to site host");
 console.log("KotoTV current-route and nested-player mocked tests passed.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
