const assert = require("node:assert/strict");
const provider = require("../providers/anizone.js");
const calls = [];
const catalog = [{slug:"sample-anime",main_title:"Sample Anime",title_list:{"1":"Sample Anime"},cover:"https://img.example/cover.jpg",start_year:2024}];
const episodes = [{slug:"1",title_list:{"1":"Episode One"}},{slug:"2",title_list:{"1":"Episode Two"}}];
function arg(name, value) { return name + ":JSON.parse('" + JSON.stringify(value).replace(/\\/g,"\\\\").replace(/'/g,"\\'") + "')"; }
global.fetch = async (url, opts) => {
  const u=String(url); calls.push({url:u,opts:opts||{}});
  if(u.includes("/anime?search=Sample%20Anime")||u==="https://anizone.to/anime") return {status:200,body:"<main><div x-data=\""+arg("items",catalog)+"\"></div></main>"};
  if(u==="https://anizone.to/anime/sample-anime") return {status:200,body:"<meta name=\"description\" content=\"Sample description\"><div x-data=\""+arg("items",episodes)+"\"></div>"};
  if(u==="https://anizone.to/anime/sample-anime/1") return {status:200,body:"<script>vidstackPlayer(JSON.parse('"+JSON.stringify({src:"https://cdn.example/video.m3u8",subtitles:[{file:"https://cdn.example/en.vtt",language:"en",default:true}]}).replace(/'/g,"\\'")+"'))</script>"};
  return {status:404,body:"not found"};
};
async function main(){
  assert.equal(provider.version,"1.0.1");
  assert.equal(provider.getInfo().name,"AniZone");
  assert.deepEqual(await provider.search("",1,{}),[]);
  const found=await provider.search("Sample Anime",1,{});
  assert.equal(found.length,1); assert.equal(found[0].id,"sample-anime");
  const detail=await provider.getDetail("sample-anime",{});
  assert.equal(detail.episodes.length,2); assert.equal(detail.episodes[1].number,2);
  const eps=await provider.getEpisodes("sample-anime",{});
  assert.equal(eps.length,2); assert.match(eps[0].url,/^anizone:\/\//);
  const streams=await provider.getVideoSources(eps[0].url,{});
  assert.equal(streams.length,1); assert.equal(streams[0].url,"https://cdn.example/video.m3u8");
  assert.equal(streams[0].subtitles.length,1);
  await assert.rejects(provider.getVideoSources("bad-url",{}),/invalid episode URL/);
  console.log("AniZone mocked integration tests passed.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
