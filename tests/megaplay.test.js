'use strict';
const assert = require('node:assert/strict');
const calls = [];
global.htmlText = function(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\\s+/g, ' ').trim(); };
global.fetch = async function(url, options) {
  url = String(url); calls.push({url, options: options || {}});
  if (url === 'https://anikototv.to/filter?keyword=Frieren&page=1') return {status:200,body:'<div class="item"><a href="/watch/frieren"><img data-src="https://img.example/frieren.jpg"><div class="name d-title">Frieren</div></a></div>'};
  if (url === 'https://anikotoapi.site/recent-anime?page=1&per_page=24') return {status:200,body:JSON.stringify({data:[{slug:'frieren',title:'Frieren',poster:'https://img.example/frieren.jpg'}]})};
  if (url === 'https://anikototv.to/watch/frieren') return {status:200,body:'<h1 class="title d-title">Frieren: Beyond Journey\'s End</h1><div data-id="42"></div><meta property="og:image" content="https://img.example/frieren.jpg"><div class="synopsis">An elf mage travels on.</div>'};
  if (url === 'https://anikototv.to/ajax/episode/list/42') return {status:200,body:JSON.stringify({result:'<a data-id="501" data-ids="sub-server-1,dub-server-1" data-num="1" data-sub="1" data-dub="1" title="Episode 1">Episode 1</a>'})};
  if (url === 'https://anikototv.to/ajax/server/list?servers=sub-server-1%2Cdub-server-1') return {status:200,body:JSON.stringify({result:'<div data-type="sub"><a data-link-id="sub-link">MegaPlay</a></div><div data-type="dub"><a data-link-id="dub-link">MegaPlay</a></div>'})};
  if (url === 'https://anikototv.to/ajax/server?get=sub-link') return {status:200,body:JSON.stringify({result:{url:'https://megaplays.se/stream/s-2/7788/sub'}})};
  if (url === 'https://anikototv.to/ajax/server?get=dub-link') return {status:200,body:JSON.stringify({result:{url:'https://megaplays.se/stream/s-2/7788/dub'}})};
  if (url === 'https://megaplays.se/stream/s-2/7788/sub' || url === 'https://megaplays.se/stream/s-2/7788/dub') return {status:200,body:'<div data-id="7788"></div><script src="/assets/newclient.js"></script>'};
  if (url === 'https://megaplays.se/assets/newclient.js') return {status:200,body:"const legacy='stream/getSources'; const modern='stream/getSourcesNew'; /* AES-CBC */"};
  if (url === 'https://megaplays.se/stream/getSourcesNew?id=7788&id=7788&type=sub') return {status:200,body:JSON.stringify({sources:{file:'https://cdn.example/frieren-sub.m3u8'},tracks:[{file:'https://cdn.example/sub.vtt',label:'English',kind:'captions'}]})};
  if (url === 'https://megaplays.se/stream/getSources?id=7788&id=7788&type=sub') return {status:200,body:JSON.stringify({sources:{file:'https://cdn.example/frieren-sub-legacy.m3u8'}})};
  if (url === 'https://megaplays.se/stream/getSourcesNew?id=7788&id=7788&type=dub') return {status:200,body:JSON.stringify({sources:{file:'https://cdn.example/frieren-dub.m3u8'}})};
  if (url === 'https://megaplays.se/stream/getSources?id=7788&id=7788&type=dub') return {status:200,body:JSON.stringify({sources:{file:'https://cdn.example/frieren-dub-legacy.m3u8'}})};
  if (url === 'https://anikototv.to/ajax/server/list?servers=vidstream-server') return {status:200,body:JSON.stringify({result:'<div data-type="sub"><a data-link-id="vidstream-link">Vidstream</a></div>'})};
  if (url === 'https://anikototv.to/ajax/server?get=vidstream-link') return {status:200,body:JSON.stringify({result:{url:'https://vidstream.example/stream/123'}})};
  if (url === 'https://vidstream.example/stream/123') return {status:200,body:'<div data-id="9900"></div><script src="/assets/player.js"></script>'};
  if (url === 'https://vidstream.example/assets/player.js') return {status:200,body:"const legacy='stream/getSources'; const modern='stream/getSourcesNew'; /* AES-CBC */"};
  if (url === 'https://vidstream.example/stream/getSourcesNew?id=9900&id=9900&type=sub') return {status:200,body:JSON.stringify({sources:{file:'https://cdn.example/vidstream-sub.m3u8'}})};
  if (url === 'https://vidstream.example/stream/getSources?id=9900&id=9900&type=sub') return {status:200,body:JSON.stringify({sources:{file:'https://cdn.example/vidstream-sub-legacy.m3u8'}})};
  if (url === 'https://anikototv.to/ajax/server/list?servers=direct-server') return {status:200,body:JSON.stringify({result:'<div data-type="sub"><a data-link-id="direct-link">Direct HLS</a></div>'})};
  if (url === 'https://anikototv.to/ajax/server?get=direct-link') return {status:200,body:JSON.stringify({result:{url:'https://cdn.example/direct.m3u8?token=abc'}})};
  return {status:404,body:''};
};
const provider = require('../providers/megaplay.js');
async function main() {
  assert.equal(provider.version, '1.0.3');
  assert.equal(provider.getInfo().name, 'MegaPlay');
  const results = await provider.search('Frieren', 1, {});
  assert.equal(results.length, 1); assert.equal(results[0].id, 'frieren');
  const detail = await provider.getDetail('frieren', {});
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.episodes.length, 2);
  assert.ok(detail.episodes[0].url.includes(encodeURIComponent('sub-server-1,dub-server-1')));
  const sub = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(sub.length, 1);
  assert.equal(sub[0].url, 'https://cdn.example/frieren-sub.m3u8');
  assert.equal(sub[0].embed, false); assert.equal(sub[0].container, 'hls');
  assert.equal(sub[0].subtitles[0].url, 'https://cdn.example/sub.vtt');
  const dub = await provider.getVideoSources(detail.episodes[1].url, {});
  assert.equal(dub[0].url, 'https://cdn.example/frieren-dub.m3u8');
  assert.ok(calls.some(c => c.url === 'https://anikototv.to/ajax/server/list?servers=sub-server-1%2Cdub-server-1'));
  assert.ok(calls.some(c => c.url === 'https://anikototv.to/ajax/server?get=sub-link'));
  assert.ok(calls.some(c => c.url === 'https://anikototv.to/ajax/server?get=dub-link'));
  assert.ok(calls.some(c => c.url === 'https://megaplays.se/stream/getSourcesNew?id=7788&id=7788&type=sub'));
  assert.ok(calls.some(c => c.url === 'https://megaplays.se/stream/getSourcesNew?id=7788&id=7788&type=dub'));

  const vidstream = await provider.getVideoSources('megaplay://501/sub/1/vidstream-server', {});
  assert.equal(vidstream.length, 1);
  assert.equal(vidstream[0].url, 'https://cdn.example/vidstream-sub.m3u8');
  assert.equal(vidstream[0].container, 'hls');
  assert.ok(calls.some(c => c.url === 'https://vidstream.example/stream/getSourcesNew?id=9900&id=9900&type=sub'));

  const direct = await provider.getVideoSources('megaplay://501/sub/1/direct-server', {});
  assert.equal(direct.length, 1);
  assert.equal(direct[0].url, 'https://cdn.example/direct.m3u8?token=abc');
  assert.equal(direct[0].hls, true);
  assert.equal(direct[0].embed, false);

  console.log('MegaPlay mocked catalog, sub/dub, encrypted embed, Vidstream and direct HLS tests passed.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
