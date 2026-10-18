'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
global.htmlText = function(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); };
const calls = [];
global.fetch = async function(url, options) {
  url = String(url); options = options || {}; calls.push({url, options});
  if (url === 'https://graphql.anilist.co' && options.method === 'POST') {
    const body = JSON.parse(options.body || '{}');
    if (body.variables && body.variables.search) return {status:200,body:JSON.stringify({data:{Page:{media:[{id:16498,title:{english:'Attack on Titan',romaji:'Shingeki no Kyojin'},coverImage:{large:'https://img.test/a.jpg'},seasonYear:2013,description:'Titans'}]}}})};
    return {status:200,body:JSON.stringify({data:{Media:{id:16498,title:{english:'Attack on Titan',romaji:'Shingeki no Kyojin'},coverImage:{large:'https://img.test/a.jpg'},seasonYear:2013,description:'Titans',genres:['Action'],status:'FINISHED',episodes:25}}})};
  }
  if (url === 'https://anime-api-xza2.onrender.com/episodes/16498') return {status:200,body:JSON.stringify({
    reanime:{meta:{title:'Attack on Titan'},episodes:{sub:[{id:'watch/reanime/16498/sub/reanime-1',number:1,title:'To You, 2000 Years Ago',audio:'sub'}],dub:[{id:'watch/reanime/16498/dub/reanime-1',number:1,title:'To You, 2000 Years Ago',audio:'dub'}]}},
    anikoto:{episodes:{sub:[{id:'watch/anikoto/16498/sub/anikoto-1',number:1,title:'Episode 1',audio:'sub'},{id:'watch/anikoto/16498/sub/anikoto-2',number:2,title:'Episode 2',audio:'sub'}]}}
  })};
  if (url === 'https://anime-api-xza2.onrender.com/watch/reanime/16498/sub/reanime-1') return {status:200,body:JSON.stringify({anilistId:16498,episode:1,audio:'sub',streams:[{url:'https://cdn.test/master.m3u8',type:'hls',server:'Reanime',referer:'https://site.test/',priority:1,isActive:true}]})};
  if (url === 'https://anime-api-xza2.onrender.com/api/watch/anikoto/16498/sub/anikoto-2') return {status:200,body:JSON.stringify({data:{streams:[{url:'https://cdn.test/fallback.m3u8',type:'hls',server:'AniKoto-Fallback',isActive:true}]}})};
  if (url === 'https://anime-api-xza2.onrender.com/watch/reanime/16498/dub/reanime-1') return {status:200,body:JSON.stringify({streams:[{url:'https://embed.test/watch/1',type:'embed',server:'ExampleEmbed',isActive:true}]})};
  return {status:404,body:''};
};
global.extractVideo = async function(url, opts) { return [{url:'https://cdn.test/extracted.m3u8',type:'hls',server:'Extracted',headers:opts.headers}]; };
vm.runInThisContext(fs.readFileSync(require.resolve('../providers/mew-aniem.js'),'utf8'),{filename:'providers/mew-aniem.js'});
const provider={getInfo:global.getInfo,search:global.search,getDetail:global.getDetail,getVideoSources:global.getVideoSources};
async function main() {
  assert.equal(provider.getInfo().name,'Mew-Aniem');
  assert.equal(provider.getInfo().version,'1.1.0');
  const results=await provider.search('Attack on Titan',1,{});
  assert.equal(results.length,1); assert.equal(results[0].id,'16498');
  const detail=await provider.getDetail('16498',{});
  assert.equal(detail.id,'16498'); assert.equal(detail.episodes.length,3);
  assert.ok(detail.episodes.some(e=>e.url==='mewaniem://16498/reanime/sub/1'));
  assert.ok(detail.episodes.some(e=>e.url==='mewaniem://16498/anikoto/sub/1'));
  const streams=await provider.getVideoSources('mewaniem://16498/reanime/sub/1',{});
  assert.equal(streams.length,1); assert.equal(streams[0].url,'https://cdn.test/master.m3u8'); assert.equal(streams[0].hls,true);
  const dub=await provider.getVideoSources('mewaniem://16498/reanime/dub/1',{});
  assert.equal(dub.length,1); assert.equal(dub[0].url,'https://cdn.test/extracted.m3u8');
  assert.ok(calls.some(c=>c.url==='https://anime-api-xza2.onrender.com/episodes/16498'));
  assert.ok(calls.some(c=>c.url==='https://anime-api-xza2.onrender.com/watch/reanime/16498/sub/reanime-1'));
  const fallback=await provider.getVideoSources('mewaniem://16498/anikoto/sub/2',{});
  assert.equal(fallback.length,1); assert.equal(fallback[0].url,'https://cdn.test/fallback.m3u8');
  assert.ok(calls.some(c=>c.url==='https://anime-api-xza2.onrender.com/api/watch/anikoto/16498/sub/anikoto-2'));
  console.log('Mew-Aniem mocked tests passed: AniList search, all-provider aggregation, unchanged AniList ID, HLS and embed stream handling.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
