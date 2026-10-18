'use strict';
const assert=require('node:assert/strict');
const calls=[];
function response(body,status=200){return {status,body:typeof body==='string'?body:JSON.stringify(body)};}
global.fetch=async function(url,opts){url=String(url);calls.push({url,opts});
 if(url==='https://eng.animeapps.top/api/search3.php?keyword=Frieren&limit=30&page=1')return response({data:[{postname:"Frieren: Beyond Journey's End",anilist:182255,postid:411733,ani_cover_large:'https://img.test/frieren.jpg'}],pagination:{current_page:1,total_pages:1}});
 if(url==='https://epeng.animeapps.top/api2.php?epid=182255')return response([{server_name:'Server 1080p',server_data:[{slug:'1',name:'1',link:'opaque-ep1'},{slug:'2',name:'2',link:'opaque-ep2'}]}]);
 if(url==='https://epeng.animeapps.top/apilink.php?data=opaque-ep1')return response([{server:'1080p',link:'https://playeng.animeapps.top/playsub.php?url=abc123'}]);
 if(url==='https://epeng.animeapps.top/apilink.php?data=opaque-ep2')return response([{server:'720p',link:'https://playeng.animeapps.top/playdub.php?url=def456'}]);
 return response('',404);};
const p=require('../providers/mmani.js');
async function main(){assert.equal(p.version,'1.0.3');assert.equal(p.getInfo().name,'MMani');const found=await p.search('Frieren',1,{});assert.equal(found.length,1);assert.equal(found[0].title,"Frieren: Beyond Journey's End");assert.equal(found[0].id,'182255');assert.equal(found[0].postId,'411733');assert.equal(found[0].cover,'https://img.test/frieren.jpg');assert.ok(calls.some(c=>c.url.includes('&limit=30&page=1')));const detail=await p.getDetail(found[0].url,{});assert.deepEqual(detail.episodes.map(e=>e.number),[1,2]);const sub=await p.getVideoSources(detail.episodes[0].url,{});assert.equal(sub.length,1);assert.equal(sub[0].url,'https://playeng.animeapps.top/r2/cachesub/abc123/index.m3u8');assert.equal(sub[0].container,'m3u8');assert.equal(sub[0].subtitles[0].url,'https://ani10.nukitashi.top/abc123/sub.vtt');const dub=await p.getVideoSources(detail.episodes[1].url,{});assert.equal(dub[0].url,'https://playeng.animeapps.top/r2/cachehd/def456/index.m3u8');console.log('MMani contract tests passed: postname/postid/ani_cover_large, paginated search, episode lookup, sub/dub HLS and subtitle URL.');}
main().catch(e=>{console.error(e);process.exitCode=1;});