'use strict';
const assert = require('node:assert/strict');
const calls = [];
const site = 'https://animeheaven.me';
const showUrl = site + '/anime.php?heavenid=naruto';
const showKey = 'heavenid=naruto';
const card = (title, key, img) => '<a href="/anime.php?' + key + '"><img src="' + img + '" alt="' + title + ' Poster"><span class="fastname">' + title + '</span></a>';
const homeHtml = '<html><title>Anime Heaven</title><main>' + card('Featured Anime', 'heavenid=featured', 'https://img.example/featured.jpg') + '</main></html>';
const newHtml = '<html><h1>New Episodes</h1>' + card('Naruto Shippuden', 'heavenid=naruto', 'https://img.example/naruto.jpg') + '</html>';
const popularHtml = '<html><h1>Popular Today</h1>' + card('One Piece', 'heavenid=onepiece', 'https://img.example/onepiece.jpg') + '</html>';
const searchHtml = '<div id="results">' + card('Naruto Shippuden', 'heavenid=naruto', 'https://img.example/naruto.jpg') + '</div>';
const detailHtml = '<html><head><title>Naruto Shippuden Anime | AnimeHeaven.Me</title>' +
  '<meta property="og:image" content="https://img.example/naruto-cover.jpg">' +
  '<meta name="description" content="A ninja adventure."></head><body><h1>Naruto Shippuden</h1>' +
  '<a href="gate.php" onclick="gateh(\'episode-token-2\', this)"><span class="watch2">Episode 2</span></a>' +
  '<a href="gate.php" onclick="gateh(\'episode-token-1\', this)"><span class="watch2">Episode 1</span></a>' +
  '</body></html>';
let searchAttempts = 0;
let gateAttempts = 0;
global.fetch = async function(url, options) {
  url = String(url); options = options || {}; calls.push({url, options});
  if (url === site + '/') return {status:200, body:homeHtml, finalUrl:url};
  if (url === site + '/new.php') return {status:200, body:newHtml, finalUrl:url};
  if (url === site + '/popular.php') return {status:200, body:popularHtml, finalUrl:url};
  if (url === site + '/fastsearch.php?xhr=1&s=Naruto') {
    searchAttempts++;
    if (searchAttempts === 1) return {status:503, body:'', finalUrl:url};
    if (searchAttempts === 2) return {status:200, body:'<html></html>', finalUrl:url};
    return {status:200, body:searchHtml, finalUrl:url, headers:{'set-cookie':['session=alpha; Path=/; HttpOnly']}};
  }
  if (url === showUrl) return {status:200, body:detailHtml, finalUrl:url, headers:{'set-cookie':['detail=loaded; Path=/']}};
  if (url === site + '/gate.php') {
    gateAttempts++;
    assert.ok(String(options.headers.Cookie || '').includes('episode-token-1') || String(options.headers.Cookie || '').includes('episode-token-2'));
    assert.ok(String(options.headers.Cookie || '').includes('session=alpha') || String(options.headers.Cookie || '').includes('detail=loaded'));
    assert.equal(options.headers.Referer, showUrl);
    if (gateAttempts === 1) return {status:200, body:'<html><body>Watch episode on AnimeHeaven.me</body></html>', finalUrl:url};
    return {status:200, body:'<html><video controls><source src="https://cdn.example/naruto-ep1.mp4" type="video/mp4"></video></html>', finalUrl:url};
  }
  return {status:404, body:'', finalUrl:url};
};
const provider = require('../providers/animeheaven.js');
async function main() {
  assert.equal(provider.version, '1.0.0');
  assert.equal(provider.getInfo().name, 'AnimeHeaven');
  assert.equal(provider.getInfo().type, 'anime');
  assert.deepEqual(provider.getSettings(), []);

  const home = await provider.getHome({});
  assert.ok(home.length >= 2, 'home must return catalog rows from live-style site pages');
  assert.ok(home.flatMap(x => x.items).some(x => x.title === 'Naruto Shippuden'), 'new page must expose real title');
  assert.ok(home.flatMap(x => x.items).every(x => x.title && x.id && x.url), 'all catalog cards need titles and identifiers');

  const results = await provider.search('Naruto', 1, {});
  assert.equal(searchAttempts, 3, 'empty/transient search responses must be retried until titles appear');
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Naruto Shippuden');
  assert.equal(results[0].cover, 'https://img.example/naruto.jpg');
  assert.equal(results[0].url, showUrl);

  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.title, 'Naruto Shippuden');
  assert.equal(detail.cover, 'https://img.example/naruto-cover.jpg');
  assert.equal(detail.description, 'A ninja adventure.');
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 1, 'episode list must be sorted numerically');
  assert.ok(detail.episodes[0].url.startsWith('animeheaven://'));

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(gateAttempts, 2, 'placeholder gate responses must be retried');
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/naruto-ep1.mp4');
  assert.equal(streams[0].container, 'mp4');
  assert.equal(streams[0].embed, false);
  assert.ok(calls.some(c => c.url === site + '/fastsearch.php?xhr=1&s=Naruto'));
  assert.ok(calls.some(c => c.url === site + '/gate.php'));
  assert.deepEqual(await provider.getVideoSources('not-an-animeheaven-link', {}), []);
  console.log('AnimeHeaven v1.0.0 tests passed: catalog titles, retrying search, metadata, sorted episodes, cookie-aware gate retry, and MP4 extraction.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });