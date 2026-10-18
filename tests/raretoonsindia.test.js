'use strict';
const assert = require('node:assert/strict');
global.htmlText = function(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/\\s+/g, ' ').trim(); };
const calls = [];
global.fetch = async function(url, options) {
  url = String(url); calls.push({url, options: options || {}});
  if (url === 'https://www.rareanimes.mov/home/') return {status:200,body:'<article><a href="/naruto/" title="Naruto"><img src="https://img.example/naruto.jpg" alt="Naruto"></a></article>'};
  if (url === 'https://www.rareanimes.mov/search/Naruto/') return {status:200,body:'<article><a href="https://www.rareanimes.mov/naruto/" title="Naruto"><img src="https://img.example/naruto.jpg" alt="Naruto"></a></article>'};
  if (url === 'https://www.rareanimes.mov/naruto/') return {status:200,body:'<meta property="og:title" content="Naruto - Rare Toons India"><meta property="og:image" content="https://img.example/naruto.jpg"><div class="entry-content"><h2>Episode 1</h2><p><a href="https://cdn.example/naruto-ep1.mp4">720p Download</a></p></div><footer>End</footer>'};
  return {status:404,body:''};
};
const provider = require('../providers/raretoonsindia.js');
async function main() {
  assert.equal(provider.version, '1.0.0');
  assert.equal(provider.getInfo().name, 'Rare Toons India');
  const home = await provider.getHome();
  assert.equal(home.length, 1);
  assert.equal(home[0].items[0].title, 'Naruto');
  const results = await provider.search('Naruto', 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'https://www.rareanimes.mov/naruto/');
  const detail = await provider.getDetail(results[0].id);
  assert.equal(detail.title, 'Naruto - Rare Toons India');
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].number, 1);
  const streams = await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/naruto-ep1.mp4');
  assert.equal(streams[0].container, 'mp4');
  console.log('Rare Toons India mocked home, search, detail, episode and direct-media tests passed.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
