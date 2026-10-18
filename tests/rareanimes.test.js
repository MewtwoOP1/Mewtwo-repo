'use strict';
const assert = require('node:assert/strict');
global.htmlText = function(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–').replace(/&#8217;/g, "'").replace(/\s+/g, ' ').trim();
};
const site = 'https://www.rareanimes.mov';
const post = site + '/naruto-season-6-hindi-episodes-download-hd/';
const categoryHtml = '<html><body>' +
  '<article class="post-123 post type-post"><h2 class="entry-title"><a title="Naruto Season 6 Hindi Episodes Download HD" href="' + post + '">Naruto Season 6 Hindi Episodes Download HD</a></h2>' +
  '<img class="wp-post-image" src="https://img.example/naruto.jpg"></article>' +
  '<article class="post-124 post type-post"><h2 class="entry-title"><a href="' + site + '/all-anime-cartoon-movies-list/">All Anime &amp; Cartoon Movies List</a></h2></article></body></html>';
const homeHtml = '<html><body><ul class="toc"><li><a href="' + site + '/naruto/">Naruto</a></li></ul>' +
  '<h2><a href="' + site + '/mushoku-tensei-season-3-hindi-dubbed-episodes-download-hd/">Mushoku Tensei Season 3 Hindi Dubbed Episodes Download HD</a></h2>' +
  '<h2><a href="' + site + '/blue-box-season-2-hindi-episodes-download-hd/">Blue Box Season 2 Hindi Episodes Download HD</a></h2></body></html>';
function streamBeta(url) {
  return '<html><title>RareAnimes StreamBeta</title><script>var maskedFileId = "abc"; var currentLangNative = "Hindi"; ' +
    'var playerSources = [{"name":"10gbps","type":"10gbps","title":"1080p","stream_url":"' + url + '"}];</script></html>';
}
function encodeJuicy(config) {
  const symbols = [String.fromCharCode(96),'%','-','+','*','$','!','_','^','='];
  let chars = '';
  for (const ch of config) {
    const digits = String(ch.charCodeAt(0)).padStart(4, '0');
    for (const d of digits) chars += symbols[Number(d)];
  }
  return Buffer.from(chars, 'latin1').toString('base64').replace(/\+/g, '_').replace(/\//g, '-') + 'ddd';
}
const juicyConfig = '{"file":"https://cdn.example/naruto-ep1.m3u8"}';
const calls = [];
global.fetch = async function(url, options) {
  url = String(url); calls.push({url, options: options || {}});
  if (url === site + '/hindi/category/hindi-dub/') return {status:200, body:categoryHtml, finalUrl:url};
  if (url === site + '/home/') return {status:200, body:homeHtml, finalUrl:url};
  if (url === site + '/') return {status:200, body:homeHtml, finalUrl:url};
  if (url === site + '/?s=Naruto') return {status:200, body:categoryHtml, finalUrl:url};
  if (url === post) return {status:200, body:
    '<html><head><meta property="og:title" content="Naruto Season 6 Hindi Episodes Download HD - Rare Toons India">' +
    '<meta property="og:image" content="https://img.example/naruto.jpg"><meta name="description" content="Naruto Hindi dubbed episodes."></head><body>' +
    '<article><div class="entry-content"><h4>Episode 01 – Deep Cover?! A Super S-Rank Mission!</h4>' +
    '<p>Hindi – [<a href="https://codedew.com/zipper/?url=MULTI01">WatchMultiQuality</a>] ' +
    '[<a href="https://codedew.com/zipper/?url=MEDIA01">MediaFire</a>]</p>' +
    '<h4>Episode 02 – A New Mission</h4><p>Hindi – [<a href="https://codedew.com/zipper/?url=MULTI02">WatchMultiQuality</a>]</p>' +
    '</div></article></body></html>', finalUrl:url};
  if (url === 'https://codedew.com/zipper/?url=MULTI01' || url === 'https://codedew.com/zipper/?url=MULTI02') {
    const code = url.endsWith('MULTI01') ? 'ARGON01' : 'ARGON02';
    return {status:200, body:'<a data-href="https://codedew.com/multiquality/?url=' + code + '">Continue</a>', finalUrl:url};
  }
  if (url === 'https://codedew.com/multiquality/?url=ARGON01' || url === 'https://codedew.com/multiquality/?url=ARGON02') {
    const code = url.endsWith('ARGON01') ? 'ARGON01' : 'ARGON02';
    return {status:200, body:'<a data-href="https://argon.razorshell.space/embed/' + code + '">Continue</a>', finalUrl:url};
  }
  if (url === 'https://argon.razorshell.space/embed/ARGON01') {
    return {status:200, body:'<script>_juicycodes("' + encodeJuicy(juicyConfig) + '");</script>', finalUrl:url};
  }
  if (url === 'https://argon.razorshell.space/embed/ARGON02') {
    return {status:200, body:'<script>_juicycodes("' + encodeJuicy('{"file":"https://cdn.example/naruto-ep2.m3u8"}') + '");</script>', finalUrl:url};
  }
  return {status:404, body:'', finalUrl:url};
};
const provider = require('../providers/rareanimes.js');
async function main() {
  assert.equal(provider.version, '1.0.1');
  assert.equal(provider.getInfo().version, '1.0.1');
  const home = await provider.getHome();
  assert.ok(home.length >= 1, 'home should have at least one catalog row');
  const allItems = home.flatMap(row => row.items || []);
  assert.ok(allItems.some(x => /Naruto Season 6/.test(x.title)), 'category results must expose real titles');
  assert.ok(allItems.some(x => /Mushoku Tensei/.test(x.title)), 'home heading fallback must expose current titles');
  assert.ok(allItems.every(x => x.title && x.url && x.id), 'catalog cards must have title, URL and ID');
  const results = await provider.search('Naruto', 1);
  assert.ok(results.some(x => /Naruto Season 6/.test(x.title)), 'search should parse WP category-style article cards');
  const detail = await provider.getDetail(post);
  assert.equal(detail.title, 'Naruto Season 6 Hindi Episodes Download HD');
  assert.equal(detail.cover, 'https://img.example/naruto.jpg');
  assert.equal(detail.description, 'Naruto Hindi dubbed episodes.');
  assert.equal(detail.episodes.length, 2);
  assert.match(detail.episodes[0].title, /Deep Cover/);
  assert.match(detail.episodes[1].title, /A New Mission/);
  const ep1 = await provider.getVideoSources(detail.episodes[0].url);
  assert.equal(ep1.length, 1);
  assert.equal(ep1[0].url, 'https://cdn.example/naruto-ep1.m3u8');
  assert.equal(ep1[0].container, 'hls');
  assert.ok(calls.some(c => c.url === 'https://argon.razorshell.space/embed/ARGON01'), 'MultiQuality URL should resolve to Argon embed');
  assert.ok(calls.some(c => c.url === 'https://argon.razorshell.space/embed/ARGON01'));
  const ep2 = await provider.getVideoSources(detail.episodes[1].url);
  assert.equal(ep2.length, 1);
  assert.equal(ep2[0].url, 'https://cdn.example/naruto-ep2.m3u8');
  assert.deepEqual(await provider.getVideoSources('not-a-rareanimes-link'), []);
  console.log('RareAnimes v1.0.1 tests passed: category catalog, homepage title fallback, search, metadata, episodes, Codedew zipper -> MultiQuality -> Argon -> decoded HLS.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
