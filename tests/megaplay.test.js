'use strict';
const assert = require('node:assert/strict');
const calls = [];
global.htmlText = function(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); };
global.fetch = async function(url, options) {
  url = String(url); calls.push({url, options: options || {}});
  if (url === 'https://anikototv.to/filter?keyword=Frieren&page=1') return {status:200,body:'<div class="item"><a href="/watch/frieren"><img data-src="https://img.example/frieren.jpg"><div class="name d-title">Frieren</div></a></div>'};
  if (url === 'https://anikotoapi.site/recent-anime?page=1&per_page=24') return {status:200,body:JSON.stringify({data:[{slug:'frieren',title:'Frieren',poster:'https://img.example/frieren.jpg'}]})};
  if (url === 'https://anikototv.to/watch/frieren') return {status:200,body:'<h1 class="title d-title">Frieren: Beyond Journey\'s End</h1><div data-id="42"></div><meta property="og:image" content="https://img.example/frieren.jpg"><div class="synopsis">An elf mage travels on.</div>'};
  if (url === 'https://anikototv.to/ajax/episode/list/42') return {status:200,body:JSON.stringify({result:'<a data-id="501" data-num="1" data-sub="1" data-dub="1" title="Episode 1">Episode 1</a>'})};
  return {status:404,body:''};
};
const provider = require('../providers/megaplay.js');
async function main() {
  assert.equal(provider.version, '1.0.0');
  assert.equal(provider.getInfo().name, 'MegaPlay');
  const results = await provider.search('Frieren', 1, {});
  assert.equal(results.length, 1); assert.equal(results[0].id, 'frieren');
  const detail = await provider.getDetail('frieren', {});
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.episodes.length, 2);
  const sub = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(sub.length, 1);
  assert.equal(sub[0].url, 'https://megaplays.se/stream/s-2/501/sub');
  assert.equal(sub[0].embed, true); assert.equal(sub[0].container, 'embed');
  const dub = await provider.getVideoSources('megaplay://501/dub/1', {});
  assert.equal(dub[0].url, 'https://megaplays.se/stream/s-2/501/dub');
  assert.ok(calls.some(c => c.url === 'https://anikototv.to/ajax/episode/list/42'));
  console.log('MegaPlay mocked catalog, episode, sub/dub and embed-route tests passed.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
