'use strict';
const assert = require('node:assert/strict');
const calls = [];
global.fetch = async function(url) {
  url = String(url); calls.push(url);
  if (url === 'https://allanime-api.mdtahseen7378.workers.dev/search?query=Naruto') return {status:200,body:JSON.stringify([{id:'show-42',title:'Naruto Shippuden',episodes_sub:500,episodes_dub:500}])};
  if (url === 'https://allanime-api.mdtahseen7378.workers.dev/anime/show-42') return {status:200,body:JSON.stringify({id:'show-42',title:'Naruto Shippuden',title_english:'Naruto Shippuden',thumbnail_url:'https://img.test/naruto.jpg',synopsis:'Ninja story',status:'Finished',episodes_sub:500,episodes_dub:500})};
  if (url === 'https://allanime-api.mdtahseen7378.workers.dev/episodes/show-42?mode=sub') return {status:200,body:JSON.stringify({mode:'sub',episodes:['1','2','2.5','3']})};
  if (url === 'https://allanime-api.mdtahseen7378.workers.dev/episodes/show-42?mode=dub') return {status:200,body:JSON.stringify({mode:'dub',episodes:['1','2']})};
  if (url === 'https://allanime-api.mdtahseen7378.workers.dev/episode_url?show_id=show-42&ep_no=2.5&mode=sub&quality=best') return {status:200,body:JSON.stringify({episode_url:'https://cdn.test/episode.m3u8',mode:'sub'})};
  if (url === 'https://allanime-api.mdtahseen7378.workers.dev/episode_url?show_id=show-42&ep_no=1&mode=dub&quality=best') return {status:200,body:JSON.stringify({episode_url:'https://cdn.test/dub.mp4',mode:'dub'})};
  return {status:404,body:''};
};
const provider = require('../providers/allanime.js');
async function main() {
  assert.equal(provider.version,'1.0.0');
  assert.equal(provider.getInfo().name,'AllAnime');
  const search = await provider.search('Naruto',1,{});
  assert.equal(search.length,1); assert.equal(search[0].id,'show-42');
  assert.equal(search[0].title,'Naruto Shippuden'); assert.equal(search[0].cover,undefined);
  const detail = await provider.getDetail('allanime://show-42/sub',{});
  assert.equal(detail.title,'Naruto Shippuden'); assert.equal(detail.episodes.length,4);
  assert.deepEqual(detail.episodes.map(e=>e.number),[1,2,2.5,3]);
  const dub = await provider.getEpisodes('allanime://show-42/dub',{});
  assert.equal(dub.length,2); assert.ok(calls.includes('https://allanime-api.mdtahseen7378.workers.dev/episodes/show-42?mode=dub'));
  const streams = await provider.getVideoSources('allanime://show-42/sub/2.5',{});
  assert.equal(streams.length,1); assert.equal(streams[0].url,'https://cdn.test/episode.m3u8'); assert.equal(streams[0].container,'m3u8');
  const dubStreams = await provider.getVideoSources('allanime://show-42/dub/1',{});
  assert.equal(dubStreams[0].url,'https://cdn.test/dub.mp4'); assert.equal(dubStreams[0].container,'mp4');
  console.log('AllAnime mocked tests passed: search, details, fractional episodes, sub/dub lists and direct playback URL handling.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
