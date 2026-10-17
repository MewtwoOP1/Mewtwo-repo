const assert=require("node:assert/strict");
global.htmlText=function(s){return String(s||"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();};
const provider=require("../providers/anikoto.js");
const calls=[];
global.extractVideo=async function(url,opts){calls.push({url:String(url),opts:opts||{}});if(String(url)==="https://megaplay.buzz/stream/s-2/9001/sub")return [{url:"https://cdn.example/episode.m3u8",container:"hls",quality:"Auto",headers:{Referer:"https://megaplay.buzz/"}}];return [];};
global.fetch=async function(url,options){
 url=String(url);calls.push({url,options:options||{}});
 if(url==="https://anikototv.to/search?keyword=Frieren")return {status:200,body:'<div><img src="https://img.example/f.jpg"><a class="name d-title" href="/watch/frieren/ep-1" data-jp="Frieren: Beyond Journey\'s End">Frieren</a></div>'};
 if(url==="https://anikototv.to/watch/frieren/ep-1")return {status:200,body:'<div id="player" data-id="42"></div>'};
 if(url==="https://megaplay.buzz/stream/s-2/9001/sub")return {status:200,body:'<div id="megaplay-player" data-id="77"></div>'};
 if(url==="https://megaplay.buzz/stream/getSourcesNew?id=77&type=sub")return {status:200,body:JSON.stringify({sources:{file:"https://cdn.example/episode.m3u8"},tracks:[]})};
 if(url==="https://anikotoapi.site/recent-anime?page=1&per_page=30")return {status:200,body:JSON.stringify({data:[{id:42,title:"Frieren",poster:"https://img.example/f.jpg"}]})};
 if(url==="https://anikotoapi.site/series/42")return {status:200,body:JSON.stringify({data:{anime:{id:42,title:"Frieren: Beyond Journey's End",poster:"https://img.example/f.jpg"},episodes:[{number:1,title:"Episode 1",episode_embed_id:"9001",embed_url:{sub:"https://megaplay.buzz/stream/s-2/9001/sub"}}]}})};
 return {status:404,body:"not found"};
};
async function main(){
 assert.equal(provider.getInfo().name,"AniKoto");
 assert.equal(provider.version,"1.0.1");
 const found=await provider.search("Frieren",1,{});
 assert.equal(found.length,1);assert.equal(found[0].sourceId,"anikoto");
 const detail=await provider.getDetail(found[0].url,{});
 assert.equal(detail.title,"Frieren: Beyond Journey's End");
 assert.equal(detail.episodes.length,1);assert.equal(detail.episodes[0].number,1);
 const streams=await provider.getVideoSources(detail.episodes[0].url,{});
 assert.equal(streams.length,1);assert.equal(streams[0].url,"https://cdn.example/episode.m3u8");
 assert.ok(calls.some(c=>c.url==="https://anikotoapi.site/series/42"));
 assert.ok(calls.some(c=>c.url==="https://megaplay.buzz/stream/getSourcesNew?id=77&type=sub"),"AniKoto should resolve MegaPlay through its native source endpoint");
 console.log("AniKoto replacement mocked integration tests passed.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
