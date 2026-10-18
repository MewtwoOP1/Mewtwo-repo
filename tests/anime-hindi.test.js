'use strict';
const assert = require('node:assert/strict');
global.fetch = async function(url) {
  const u = String(url);
  if (u === 'https://anime-api-xza2.onrender.com/api/search?s=Solo%20Leveling&page=1') return {status:200,body:JSON.stringify({success:true,results:{currentPage:1,totalPages:1,results:[{title:'Solo Leveling',anime_id:'solo-leveling',poster:'https://img.test/solo.jpg'}]}})};
  if (u === 'https://anime-api-xza2.onrender.com/api/newadded') return {status:200,body:JSON.stringify({success:true,results:[{title:'Solo Leveling',anime_id:'solo-leveling',season:2,episode:6,poster:'https://img.test/solo.jpg'}]})};
  if (u === 'https://anime-api-xza2.onrender.com/api/info?id=solo-leveling') return {status:200,body:JSON.stringify({success:true,data:{title:'Solo Leveling',poster:'https://img.test/solo.jpg',overview:'Hunter story',seasons:'2',episodes:'25',genres:['Action'],year:'2024'}})};
  if (u === 'https://anime-api-xza2.onrender.com/api/episodes?id=solo-leveling&season=1') return {status:200,body:JSON.stringify({success:true,results:{episodes:[{episode:1,title:'I’m Used to It'},{episode:2,title:'If I Had One More Chance'}],seasons:[]}})};
  if (u === 'https://anime-api-xza2.onrender.com/api/episodes?id=solo-leveling&season=2') return {status:200,body:JSON.stringify({success:true,results:{episodes:[{episode:1,title:'You Aren’t E-Rank, Are You?'},{episode:6,title:'The Real Hunt Begins'}]}})};
  if (u === 'https://anime-api-xza2.onrender.com/api/stream?id=solo-leveling&season=2&ep=6') return {status:200,body:JSON.stringify({success:true,results:[{server:'options-0',embed:'https://embed.test/player/6'},{server:'direct',url:'https://cdn.test/video.m3u8',type:'hls'}]})};
  return {status:404,body:''};
};
global.extractVideo = async function(url, opts) { return [{url:'https://cdn.test/extracted.m3u8',name:'Resolved Embed',type:'hls',headers:opts.headers}]; };
const provider = require('../providers/anime-hindi.js');
async function main() {
  assert.equal(provider.getInfo().name,'Anime Hindi');
  assert.equal(provider.version,'1.0.0');
  const results=await provider.search('Solo Leveling',1,{});
  assert.equal(results.length,1); assert.equal(results[0].id,'solo-leveling');
  const home=await provider.getHome({});
  assert.equal(home.length,1); assert.equal(home[0].items[0].id,'solo-leveling');
  const detail=await provider.getDetail('solo-leveling',{});
  assert.equal(detail.title,'Solo Leveling'); assert.equal(detail.episodes.length,2);
  assert.equal(detail.episodes[0].url,'animehindi://solo-leveling/1/1');
  const season2=await provider.getEpisodes('animehindi://solo-leveling/2/1',{});
  assert.equal(season2.length,2); assert.equal(season2[1].number,6);
  const streams=await provider.getVideoSources('animehindi://solo-leveling/2/6',{});
  assert.equal(streams.length,2);
  assert.equal(streams[0].url,'https://cdn.test/extracted.m3u8');
  assert.equal(streams[1].url,'https://cdn.test/video.m3u8');
  assert.ok(!('anilistId' in detail), 'source-native slugs must not be mislabeled as AniList IDs');
  console.log('Anime Hindi mocked tests passed: documented search, home, detail, multi-season episodes, embed extraction and direct HLS.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
