'use strict';
const assert = require('node:assert/strict');
global.htmlText = function (s) {
  return String(s || '').replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
};
const calls = [];
let failHd1 = false;
const searchHtml = '<section class="film_list-wrap"><div class="flw-item"><a class="film-poster-ahref" href="/watch/frieren-999"><img class="film-poster-img" data-src="https://img.example/frieren.jpg"></a><h3 class="film-name"><a href="/watch/frieren-999" title="Frieren: Beyond Journey&#39;s End">Frieren: Beyond Journey&#39;s End</a></h3></div></section>';
const detailHtml = '<h1 class="film-name">Frieren: Beyond Journey&#39;s End</h1>' +
  '<div class="anisc-poster"><img data-src="https://img.example/poster.jpg"></div>' +
  '<div class="anisc-info"><div class="text">An elf mage travels on.</div>' +
  '<div class="item-title"><span class="item-head">Aired:</span><span class="name">2023</span></div>' +
  '<div class="item-title"><span class="item-head">Status:</span><span class="name">RELEASING</span></div>' +
  '<div class="item-title"><span class="item-head">Genres:</span><div class="item-list"><a>Fantasy</a><a>Adventure</a></div></div>' +
  '<div class="item-title"><span class="item-head">Studios:</span><div class="item-list"><a>Madhouse</a></div></div></div>';
global.fetch = async function (url, options) {
  url = String(url); options = options || {};
  calls.push({ url: url, options: options });
  if (url === 'https://zanix.tr/search?keyword=Frieren&page=1') return { status: 200, body: searchHtml };
  if (url === 'https://zanix.tr/most-popular?page=1') return { status: 200, body: searchHtml };
  if (url === 'https://zanix.tr/frieren-999') return { status: 200, body: detailHtml };
  if (url === 'https://zanix.tr/watch/frieren-999?ep=1') {
    return { status: 200, body: '<script>window.AJAX_TOKEN = "test-token"; let animeId = 999;</script>',
      headers: { 'set-cookie': 'PHPSESSID=test-session; Path=/; HttpOnly' } };
  }
  if (url === 'https://zanix.tr/ajax/episodes?animeId=999') {
    assert.equal(options.headers['X-Page-Token'], 'test-token');
    assert.equal(options.headers.Cookie, 'PHPSESSID=test-session');
    assert.equal(options.headers['X-Requested-With'], 'XMLHttpRequest');
    assert.equal(options.headers.Referer, 'https://zanix.tr/watch/frieren-999?ep=1');
    return { status: 200, body: JSON.stringify({ episodes: [
      { id: 456, embed_id: 700, number: 1, sub: true, dub: true, titles: { en: 'The Journey' } },
      { id: 457, embed_id: 701, number: 2, sub: true, dub: false, title: 'Episode 2' }
    ] }) };
  }
  if (url === 'https://cdn.4animo.xyz/embed/hd-1/456/sub?k=1') {
    return { status: 200, body: 'var sourcesUrl = "/stream/getSources?id=sub-hd1";' };
  }
  if (url === 'https://cdn.4animo.xyz/embed/hd-2/456/sub?k=1') {
    return { status: 200, body: 'var sourcesUrl = "/stream/getSources?id=sub-hd2";' };
  }
  if (url === 'https://cdn.4animo.xyz/embed/s-1/700/sub?k=1') {
    return { status: 200, body: 'var sourcesUrl = "/stream/getSources?id=sub-s1";' };
  }
  if (url === 'https://cdn.4animo.xyz/embed/hd-1/456/dub?k=1') {
    return { status: 200, body: 'var sourcesUrl = "/stream/getSources?id=dub-hd1";' };
  }
  if (url === 'https://cdn.4animo.xyz/embed/hd-2/456/dub?k=1') {
    return { status: 200, body: 'var sourcesUrl = "/stream/getSources?id=dub-hd2";' };
  }
  if (url.indexOf('https://cdn.4animo.xyz/stream/getSources?id=') === 0) {
    const id = url.split('id=')[1];
    if (id === 'sub-hd1' && failHd1) return { status: 200, body: JSON.stringify({ sources: [] }) };
    if (id === 'sub-hd1') return { status: 200, body: JSON.stringify({ sources: [{ file: 'https://cdn.example/frieren-sub.m3u8' }], tracks: [{ kind: 'captions', label: 'English', file: '/subs/en.vtt', default: true }] }) };
    if (id === 'sub-hd2') return { status: 200, body: JSON.stringify({ sources: [{ file: 'https://cdn.example/frieren-fallback.m3u8' }], tracks: [] }) };
    if (id === 'dub-hd1') return { status: 200, body: JSON.stringify({ sources: [{ file: 'https://cdn.example/frieren-dub.m3u8' }], tracks: [] }) };
    return { status: 200, body: JSON.stringify({ sources: [] }) };
  }
  if (url === 'https://cdn.example/frieren-sub.m3u8') return { status: 200, body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n1080/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\n720/index.m3u8\n' };
  if (url === 'https://cdn.example/frieren-fallback.m3u8' || url === 'https://cdn.example/frieren-dub.m3u8') {
    return { status: 200, body: '#EXTM3U\n#EXTINF:5,\nsegment.ts\n#EXT-X-ENDLIST\n' };
  }
  return { status: 404, body: 'not found' };
};
const provider = require('../providers/zanix.js');
async function main() {
  assert.equal(provider.version, '1.0.0');
  assert.equal(provider.getInfo().name, 'Zanix');
  assert.equal(provider.getInfo().version, '1.0.0');
  assert.equal(provider.getInfo().type, 'anime');
  assert.deepEqual(provider.getSettings(), []);

  const results = await provider.search('Frieren', 1, {});
  assert.equal(results.length, 1, 'search parses one Zanix card');
  assert.equal(results[0].id, 'frieren-999');
  assert.equal(results[0].title, "Frieren: Beyond Journey's End");
  assert.equal(results[0].cover, 'https://img.example/frieren.jpg');

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].items.length, 1);

  const detail = await provider.getDetail(results[0].url, {});
  assert.ok(detail);
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.cover, 'https://img.example/poster.jpg');
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[0].title, 'Episode 1: The Journey');
  assert.equal(detail.episodes[1].number, 2);
  assert.deepEqual(await provider.getEpisodes(results[0].url, {}), detail.episodes);

  const sub = await provider.getVideoSources(detail.episodes[0].url, { category: 'sub' });
  assert.equal(sub[0].url, 'https://cdn.example/frieren-sub.m3u8');
  assert.equal(sub[0].container, 'hls');
  assert.equal(sub[0].kind, 'sub');
  assert.equal(sub[1].url, 'https://cdn.example/1080/index.m3u8');
  assert.equal(sub[1].quality, '1080p');
  assert.equal(sub[2].url, 'https://cdn.example/720/index.m3u8');
  assert.equal(sub[2].quality, '720p');
  assert.equal(sub[0].subtitles[0].url, 'https://cdn.4animo.xyz/subs/en.vtt');

  const dub = await provider.getVideoSources(detail.episodes[0].url, { category: 'dub' });
  assert.equal(dub[0].url, 'https://cdn.example/frieren-dub.m3u8');
  assert.equal(dub[0].kind, 'dub');
  assert.equal((await provider.getVideoSources(detail.episodes[1].url, { category: 'dub' })).length, 0,
    'must not return sub playback when that episode has no dub');

  failHd1 = true;
  const fallback = await provider.getVideoSources(detail.episodes[0].url, { category: 'sub' });
  assert.equal(fallback[0].url, 'https://cdn.example/frieren-fallback.m3u8',
    'falls back from a source endpoint with no media to the second server');
  assert.ok(calls.some(c => c.url === 'https://cdn.4animo.xyz/embed/hd-2/456/sub?k=1'));

  const invalid = await provider.getVideoSources('zanix://bad/url', { category: 'sub' });
  assert.deepEqual(invalid, []);
  console.log('Zanix mocked tests passed: catalogue, details, token+cookie episode API, sub/dub, source extraction, HLS variants/subtitles, and server fallback.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
