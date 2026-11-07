'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.__settings = {
  animegg: { audioMode: 'both', requestTimeoutMs: '12000' }
};

function html(value, status) {
  return new Response(value, {
    status: status || 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

const searchHtml = [
  '<html><body>',
  '<a href="/series/mock-anime" class="mse">',
  '<div class="media searchre"><img src="https://img.example/mock.jpg" class="media-object">',
  '<div class="media-body"><div class="first"><h2>Mock Anime</h2>',
  '<p class="infoami"><div>Episodes: 2</div>',
  '<div>Alt Titles : モック; Mock Anime Alternative</div>',
  '<div>Status : Ongoing</div></p></div></div></div></a>',
  '<a href="/series/mock-anime-2" class="mse">',
  '<div class="media searchre"><img src="https://img.example/mock2.jpg" class="media-object">',
  '<div class="media-body"><div class="first"><h2>Mock Anime 2</h2>',
  '<p class="infoami"><div>Episodes: 1</div><div>Status : Completed</div></p></div></div></div></a>',
  '</body></html>'
].join('\n');

const popularHtml = [
  '<html><body><ul>',
  '<li class="fea"><div class="img"><img src="https://img.example/pop.jpg">',
  '<a href="/series/popular-anime" class="fealink">Watch Anime</a></div>',
  '<div class="rightpop"><a href="/series/popular-anime">Popular Anime</a>',
  '<div><ul class="tags"><li><a class="btn btn-default btn-sm disabled">12 Episodes</a></li>',
  '<li><a class="btn btn-default btn-sm disabled">Ongoing</a></li></ul></div></div></li>',
  '</ul></body></html>'
].join('\n');

const seriesHtml = [
  '<html><body>',
  '<div class="fattynav"><div class="media">',
  '<img src="https://img.example/series.jpg" class="media-object">',
  '<div class="media-body"><div class="first"><h1>Mock Anime</h1>',
  '<p class="infoami"><span>Episodes: 2</span><span>Status: Ongoing</span></p>',
  '<p class="infoami"><span>Alternate Titles: Mock Anime Alt; モック</span></p>',
  '</div></div></div></div>',
  '<div class="second"><ul class="tagscat">',
  '<li><a href="/genre/action">Action</a></li>',
  '<li><a href="/genre/fantasy">Fantasy</a></li>',
  '</ul></div>',
  '<p class="ptext">A mock AnimeGG synopsis.</p>',
  '<ul>',
  '<li><div><a href="/mock-anime-episode-1" class="anm_det_pop"><strong>Mock Anime 1</strong></a>',
  '<i class="anititle">Episode 1</i><a href="/mock-anime-episode-1#subbed"><span class="btn-subbed">SUBBED</span></a>',
  '<a href="/mock-anime-episode-1#dubbed"><span class="btn-dubbed">DUBBED</span></a></div></li>',
  '<li><div><a href="/mock-anime-episode-2" class="anm_det_pop"><strong>Mock Anime 2</strong></a>',
  '<i class="anititle">The Second</i><a href="/mock-anime-episode-2#subbed"><span class="btn-subbed">SUBBED</span></a></div></li>',
  '</ul></body></html>'
].join('\n');

const episodeHtml = [
  '<html><body><ul id="videos">',
  '<li><a href="#subbed-Animegg" data-id=\'131519\' data-mirror="Animegg" data-version="subbed">SUBBED</a></li>',
  '<li><a href="#dubbed-Animegg" data-id=\'131769\' data-mirror="Animegg" data-version="dubbed">DUBBED</a></li>',
  '</ul></body></html>'
].join('\n');

const embedHtml = [
  '<html><head>',
  '<meta property="og:video" content="/play/445674/video.mp4?for=101794068324935"/>',
  '</head></html>'
].join('\n');

const requests = [];
global.fetch = async (url, init) => {
  const target = String(url);
  const options = init || {};
  requests.push({ url: target, options });
  if (target.startsWith('https://www.animegg.org/search/?q=')) return html(searchHtml);
  if (target === 'https://www.animegg.org/popular-series') return html(popularHtml);
  if (target === 'https://www.animegg.org/series/mock-anime') return html(seriesHtml);
  if (target === 'https://www.animegg.org/mock-anime-episode-1') return html(episodeHtml);
  if (target === 'https://www.animegg.org/mock-anime-episode-2') {
    return html('<li><a href="#subbed-Animegg" data-id=\'222222\' data-version="subbed">SUBBED</a></li>');
  }
  if (target === 'https://www.animegg.org/embed/131519') return html(embedHtml);
  if (target === 'https://www.animegg.org/embed/131769') {
    return html('<meta property="og:video" content="/play/447569/video.mp4?for=101794068329467"/>');
  }
  if (target === 'https://www.animegg.org/embed/222222') {
    return html('<meta property="og:video" content="/play/333333/video.mp4?for=42"/>');
  }
  return html('not found', 404);
};

const provider = require('../providers/animegg.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((entry) => entry.id === 'animegg');

async function main() {
  assert.ok(source, 'AnimeGG must be registered in index.json');
  assert.deepEqual(provider.getInfo(), {
    name: source.name,
    lang: source.lang,
    baseUrl: 'https://www.animegg.org',
    logo: source.logo,
    type: source.type,
    version: source.version
  });
  assert.deepEqual(provider.getSettings().map((item) => item.key),
    source.settings.map((item) => item.key));

  const search = await provider.search('Mock Anime', 1, {});
  assert.equal(search.length, 2);
  assert.equal(search[0].id, 'mock-anime');
  assert.equal(search[0].title, 'Mock Anime');
  assert.equal(search[0].cover, 'https://img.example/mock.jpg');
  assert.equal(search[0].episodesCount, 2);
  assert.equal(search[0].status, 'ongoing');

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].title, 'Popular Anime');
  assert.equal(home[0].items[0].id, 'popular-anime');
  assert.equal(home[0].items[0].episodesCount, 12);

  const detail = await provider.getDetail('mock-anime', {});
  assert.equal(detail.title, 'Mock Anime');
  assert.equal(detail.cover, 'https://img.example/series.jpg');
  assert.equal(detail.description, 'A mock AnimeGG synopsis.');
  assert.deepEqual(detail.genres, ['Action', 'Fantasy']);
  assert.deepEqual(detail.altTitles, ['Mock Anime Alt', 'モック']);
  assert.equal(detail.episodes.length, 3);
  assert.deepEqual(detail.episodes.map((ep) => [ep.number, ep.category]),
    [[1, 'sub'], [1, 'dub'], [2, 'sub']]);
  assert.equal(detail.episodes[1].title, 'Episode 1');
  assert.equal(detail.episodes[2].title, 'Episode 2: The Second');
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 1);

  const sub = await provider.getVideoSources('animegg://episode/mock-anime/1/sub', {});
  assert.equal(sub.length, 1);
  assert.equal(sub[0].url, 'https://www.animegg.org/play/445674/video.mp4?for=101794068324935');
  assert.equal(sub[0].container, 'mp4');
  assert.equal(sub[0].kind, 'sub');
  assert.equal(sub[0].headers.Referer, 'https://www.animegg.org/');

  const dub = await provider.getVideoSources('animegg://episode/mock-anime/1/dub', {});
  assert.equal(dub.length, 1);
  assert.equal(dub[0].url, 'https://www.animegg.org/play/447569/video.mp4?for=101794068329467');
  assert.equal(dub[0].audioLang, 'en');

  const missing = await provider.getVideoSources('animegg://episode/mock-anime/2/dub', {});
  assert.deepEqual(missing, []);

  assert.deepEqual(await provider.getVideoSources('not-an-episode', {}), []);
  assert.equal(requests.every((entry) => entry.url.startsWith('https://')), true);

  global.__settings.animegg.audioMode = 'sub';
  const subOnly = await provider.getDetail('mock-anime', {});
  assert.equal(subOnly.episodes.every((ep) => ep.category === 'sub'), true);
  assert.equal(subOnly.episodes.length, 2);

  console.log('animegg provider tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
