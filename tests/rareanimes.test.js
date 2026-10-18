'use strict';
const assert = require('node:assert/strict');
global.htmlText = function(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–').replace(/&#8217;/g, "'").replace(/\s+/g, ' ').trim();
};
const site = 'https://www.rareanimes.mov';
const post = site + '/naruto-season-6-hindi-episodes-download-hd/';
const homeHtml = '<article class="post-123 post type-post">' +
  '<h2 class="entry-title"><a href="' + post + '" title="Naruto Season 6 Hindi Episodes Download HD">Naruto Season 6 Hindi Episodes Download HD</a></h2>' +
  '<img class="wp-post-image" src="https://img.example/naruto.jpg"></article>' +
  '<article class="post-124 post type-post"><h2 class="entry-title"><a href="' + site + '/all-anime-cartoon-movies-list/">All Anime &amp; Cartoon Movies List</a></h2></article>';
const detailHtml = '<html><head><meta property="og:title" content="Naruto Season 6 Hindi Episodes Download HD - Rare Toons India">' +
  '<meta property="og:image" content="https://img.example/naruto.jpg"><meta name="description" content="Naruto Hindi dubbed episodes."></head><body>' +
  '<article><div class="entry-content"><h4>Episode 01 – Deep Cover?! A Super S-Rank Mission!</h4>' +
  '<p>Hindi – [<a href="https://codedew.com/zipper/?url=MULTI01">WatchMultiQuality</a>] ' +
  '[<a href="https://codedew.com/zipper/?url=HUB01">HubCloud</a>] ' +
  '[<a href="https://codedew.com/zipper/?url=WATCH01">WatchNow</a>]</p>' +
  '<h4>Episode 02 – A New Mission</h4><p>Hindi – [<a href="https://codedew.com/zipper/?url=HUB02">HubCloud</a>]</p>' +
  '</div></article></body></html>';
function streamBeta(url) {
  return '<html><script>var maskedFileId = "abc"; var currentLangNative = "Hindi"; ' +
    'var playerSources = [{"name":"10gbps","type":"10gbps","title":"1080p","stream_url":"' + url + '"}];</script></html>';
}
const calls = [];
global.fetch = async function(url, options) {
  url = String(url); calls.push({url, options: options || {}});
  if (url === site + '/home/') return {status:200, body:homeHtml, finalUrl:url};
  if (url === site + '/?s=Naruto') return {status:200, body:homeHtml, finalUrl:url};
  if (url === post) return {status:200, body:detailHtml, finalUrl:url};
  if (url === 'https://codedew.com/zipper/?url=WATCH01') {
    return {status:200, body:streamBeta('https://cdn.example/naruto-ep1.mkv'), finalUrl:'https://codedew.com/streambeta/?url=SB_ONE'};
  }
  if (url === 'https://codedew.com/zipper/?url=HUB02&ad_done=1') {
    return {status:200, body:'<div data-href="https://hubcloud.ist/drive/HUB_TWO"></div>', finalUrl:url};
  }
  if (url === 'https://codedew.com/streambeta/?url=HUB_TWO') {
    return {status:200, body:streamBeta('https://cdn.example/naruto-ep2.mkv'), finalUrl:url};
  }
  if (url === 'https://codedew.com/zipper/?url=HUB01&ad_done=1') {
    return {status:200, body:'<div data-href="https://hubcloud.ist/drive/HUB_ONE"></div>', finalUrl:url};
  }
  if (url === 'https://codedew.com/streambeta/?url=HUB_ONE') {
    return {status:200, body:streamBeta('https://cdn.example/naruto-ep1-hub.mkv'), finalUrl:url};
  }
  return {status:404, body:'', finalUrl:url};
};
const provider = require('../providers/rareanimes.js');
async function main() {
  assert.equal(provider.version, '1.0.0');
  assert.deepEqual(provider.getInfo(), {
    name:'RareAnimes', lang:'hi', baseUrl:site,
    logo:'https://www.google.com/s2/favicons?sz=256&domain=rareanimes.mov',
    type:'anime', version:'1.0.0'
  });
  const home = await provider.getHome();
  assert.equal(home.length, 1);
  assert.equal(home[0].items[0].title, 'Naruto Season 6 Hindi Episodes Download HD');
  assert.equal(home[0].items[0].cover, 'https://img.example/naruto.jpg');
  const results = await provider.search('Naruto', 1);
  assert.equal(results.length, 1);
  assert.ok(calls.some(c => c.url === site + '/?s=Naruto'), 'search must use the WordPress ?s= query');
  const detail = await provider.getDetail(results[0].id);
  assert.equal(detail.title, 'Naruto Season 6 Hindi Episodes Download HD');
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[1].number, 2);
  const episode1 = await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(episode1.length, 1);
  assert.equal(episode1[0].url, 'https://cdn.example/naruto-ep1.mkv');
  assert.equal(episode1[0].container, 'mkv');
  assert.equal(episode1[0].quality, '1080p');
  assert.ok(calls.some(c => c.url === 'https://codedew.com/zipper/?url=WATCH01'));
  const episode2 = await provider.getVideoSources(detail.episodes[1].url);
  assert.equal(episode2.length, 1);
  assert.equal(episode2[0].url, 'https://cdn.example/naruto-ep2.mkv');
  assert.ok(calls.some(c => c.url === 'https://codedew.com/zipper/?url=HUB02&ad_done=1'));
  assert.ok(calls.some(c => c.url === 'https://codedew.com/streambeta/?url=HUB_TWO'));
  assert.deepEqual(await provider.getVideoSources('not-a-rareanimes-link'), []);
  console.log('RareAnimes tests passed: home, WP search, episode parsing, WatchNow->StreamBeta stream_url, HubCloud fallback, manifest-compatible exports.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
