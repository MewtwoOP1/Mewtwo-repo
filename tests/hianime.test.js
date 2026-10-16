const assert=require("node:assert/strict");
global.htmlText=function(s){return String(s||"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();};
const provider=require("../providers/hianime.js");
const calls=[];
global.fetch=async function(url,options){
 url=String(url);calls.push({url,options:options||{}});
 if(url==="https://hianime.dk/search?keyword=Frieren&page=1")return {status:200,body:'<h3 class="film-name"><a href="/watch/frieren-beyond-journeys-end-123" title="Frieren: Beyond Journey\'s End">Frieren</a></h3><img src="https://img.example/f.jpg">'};
 if(url==="https://hianime.dk/watch/frieren-beyond-journeys-end-123")return {status:200,body:'<h1>Frieren: Beyond Journey\'s End</h1><a href="/watch/frieren-beyond-journeys-end-123?ep=1">Episode 1</a><meta property="og:image" content="https://img.example/f.jpg"><iframe src="https://player.example/embed/ep1"></iframe>'};
 if(url==="https://player.example/embed/ep1")return {status:200,body:'<script>var player = {"file":"https://cdn.example/frieren-1080p.m3u8"};</script>'};
 return {status:404,body:""};
};
async function main(){
 assert.equal(provider.getInfo().name,"HiAnime");
 assert.equal(provider.version,"1.0.4");
 assert.deepEqual(await provider.search("",1,{}),[]);
 const found=await provider.search("Frieren",1,{});
 assert.equal(found.length,1);
 assert.equal(found[0].sourceId,"hianime");
 assert.equal(found[0].id,"frieren-beyond-journeys-end-123","search IDs must not retain watch/ prefix");
 assert.equal(found[0].url,"frieren-beyond-journeys-end-123");
 const detail=await provider.getDetail(found[0].id,{});
 assert.equal(detail.title,"Frieren: Beyond Journey's End");
 assert.equal(detail.episodes.length,1);
 assert.equal(detail.episodes[0].number,1);
 assert.equal(detail.episodes[0].url,"hianime://frieren-beyond-journeys-end-123/1");
 assert.ok(!calls.some(c=>c.url.includes("/watch/watch/")),"detail must not duplicate watch path");
 const streams=await provider.getVideoSources(detail.episodes[0].url,{});
 assert.equal(streams.length,1);
 assert.equal(streams[0].url,"https://cdn.example/frieren-1080p.m3u8");
 assert.equal(streams[0].container,"hls");
 assert.equal(streams[0].headers.Referer,"https://player.example/");
 assert.ok(calls.some(c=>c.url==="https://player.example/embed/ep1"),"external player must be requested directly");
 global.__settings={hianime:{domain:"https://hianime.al"}};
 assert.equal(provider.getInfo().baseUrl,"https://hianime.dk","HiAnime remains pinned to one domain");
 console.log("HiAnime slug normalization and iframe media extraction tests passed.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
