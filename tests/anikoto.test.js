const assert=require("node:assert/strict");
global.htmlText=function(s){return String(s||"").replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g," ").trim();};
const provider=require("../providers/anikoto.js"),calls=[];
global.fetch=async function(url,options){url=String(url);options=options||{};calls.push({url,options});
 if(url==="https://anikototv.to/filter?keyword=Frieren&page=1")return {status:200,body:'<div class="item"><a href="/watch/frieren" data-jp="Frieren: Beyond Journey\'s End" class="name d-title">Frieren</a><img data-src="https://img.example/f.jpg"></div>'};
 if(url==="https://anikototv.to/watch/frieren")return {status:200,body:'<h1 class="d-title">Frieren: Beyond Journey\'s End</h1><div data-id="42"></div><meta property="og:image" content="https://img.example/f.jpg">'};
 if(url==="https://anikototv.to/ajax/episode/list/42")return {status:200,body:JSON.stringify({status:200,result:'<a data-id="9001" data-ids="srv-ids" data-num="1" data-sub="1" data-dub="0" title="Episode 1"></a>'})};
 if(url==="https://anikototv.to/ajax/server/list?servers=srv-ids")return {status:200,body:JSON.stringify({status:200,result:'<div data-type="sub"><a data-link-id="501">VidPlay</a></div>'})};
 if(url==="https://anikototv.to/ajax/server?get=501")return {status:200,body:JSON.stringify({status:200,result:{url:"https://vidtube.site/embed/9001"}})};
 if(url==="https://vidtube.site/embed/9001")return {status:200,body:'<div data-id="77"></div>'};
 if(url==="https://vidtube.site/stream/getSources?id=77&type=sub"){assert.equal(options.headers.Referer,"https://vidtube.site/embed/9001");return {status:200,body:JSON.stringify({sources:{file:"https://cdn.example/frieren.m3u8"},tracks:[{kind:"captions",label:"English",file:"https://cdn.example/en.vtt"}]})};}
 if(url==="https://anikotoapi.site/recent-anime?page=1&per_page=24")return {status:200,body:JSON.stringify({data:[{slug:"frieren",title:"Frieren",poster:"https://img.example/f.jpg"}]})};
 return {status:404,body:"not found"};};
async function main(){assert.equal(provider.version,"1.0.9");assert.equal(provider.getInfo().name,"AniKoto");
 const results=await provider.search("Frieren",1,{});assert.equal(results.length,1);assert.equal(results[0].url,"frieren");
 const detail=await provider.getDetail(results[0].url,{});assert.equal(detail.title,"Frieren: Beyond Journey's End");assert.equal(detail.episodes.length,1);
 const streams=await provider.getVideoSources(detail.episodes[0].url,{});assert.equal(streams.length,1);assert.equal(streams[0].url,"https://cdn.example/frieren.m3u8");assert.equal(streams[0].container,"hls");assert.equal(streams[0].subtitles[0].url,"https://cdn.example/en.vtt");
 assert.ok(calls.some(c=>c.url==="https://anikototv.to/ajax/server/list?servers=srv-ids"));assert.ok(calls.some(c=>c.url==="https://vidtube.site/stream/getSources?id=77&type=sub"));console.log("AniKoto AJAX server-chain and stream tests passed.");}
main().catch(e=>{console.error(e);process.exitCode=1;});