'use strict';
const assert=require('node:assert/strict');
const calls=[];
function response(url,body,status=200){return {status,body:typeof body==='string'?body:JSON.stringify(body)};}
global.fetch=async function(url,opts){
  url=String(url);calls.push(url);
  if(url==='https://eng.animeapps.top/api/search3.php?keyword=Frieren')return response(url,{data:[{title:'Frieren: Beyond Journey\'s End',anilist:182255,postid:411733,image:'https://img.test/frieren.jpg'}]});
  if(url==='https://epeng.animeapps.top/api2.php?epid=182255')return response(url,[{server_name:'Server 1080p',server_data:[{slug:'1',name:'1',link:'opaque-ep1'},{slug:'2',name:'2',link:'opaque-ep2'}]}]);
  if(url==='https://epeng.animeapps.top/apilink.php?data=opaque-ep1')return response(url,[{server:'1080p',link:'https://player.test/embed/ep1'}]);
  if(url==='https://epeng.animeapps.top/apilink.php?data=opaque-ep2')return response(url,[{server:'720p',link:'https://player.test/embed/ep2'}]);
  if(url==='https://player.test/embed/ep1')return response(url,'{"videoUrl":"https://cdn.test/ep1.m3u8","tracks":[{"file":"https://cdn.test/en.vtt","label":"English"}]}');
  if(url==='https://player.test/embed/ep2')return response(url,'{"videoUrl":"https://cdn.test/ep2.mp4"}');
  return response(url,'',404);
};
const p=require('../providers/mmani.js');
async function main(){
  assert.equal(p.version,'1.0.0');assert.equal(p.getInfo().name,'MMani');
  const found=await p.search('Frieren',1,{});
  assert.equal(found.length,1);assert.equal(found[0].id,'182255');assert.equal(found[0].postId,'411733');
  const detail=await p.getDetail(found[0].url,{});
  assert.equal(detail.title,'Frieren: Beyond Journey\'s End');assert.deepEqual(detail.episodes.map(e=>e.number),[1,2]);
  const streams=await p.getVideoSources(detail.episodes[0].url,{});
  assert.equal(streams.length,1);assert.equal(streams[0].url,'https://cdn.test/ep1.m3u8');assert.equal(streams[0].container,'m3u8');
  assert.equal(streams[0].subtitles[0].url,'https://cdn.test/en.vtt');
  const next=await p.getVideoSources(detail.episodes[1].url,{});
  assert.equal(next[0].url,'https://cdn.test/ep2.mp4');
  assert.ok(calls.includes('https://epeng.animeapps.top/api2.php?epid=182255'));
  console.log('MMani mocked tests passed: catalog, episode list, player URL extraction, HLS/MP4 and subtitles.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
