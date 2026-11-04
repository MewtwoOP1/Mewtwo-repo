'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.__settings = {
  kickassanime: {
    audioMode: 'both',
    homeSections: 'trending,popular',
    requestTimeoutMs: '10000',
    showAdult: false
  }
};

const media = {
  id: 151807,
  idMal: 52299,
  title: { english: 'Mock Anime', romaji: 'Mock Anime', native: 'モックアニメ' },
  description: 'A mock synopsis',
  coverImage: { extraLarge: 'https://img.example/poster.jpg', large: 'https://img.example/poster-small.jpg' },
  bannerImage: 'https://img.example/banner.jpg',
  episodes: 3,
  status: 'RELEASING',
  format: 'TV',
  genres: ['Action'],
  seasonYear: 2024,
  averageScore: 84,
  isAdult: false,
  synonyms: []
};

function json(value, status) {
  return new Response(JSON.stringify(value), {
    status: status || 200,
    headers: { 'content-type': 'application/json' }
  });
}
function html(value, status) {
  return new Response(value, { status: status || 200, headers: { 'content-type': 'text/html' } });
}

const subPage = {
  pages: [{ number: 1, eps: [1, 2, 3] }],
  result: [
    { slug: 'ep-1-sub', episode_number: 1, title: 'Start' },
    { slug: 'ep-2-sub', episode_number: 2, title: 'Next' },
    { slug: 'ep-3-sub', episode_number: 3, title: 'End' }
  ]
};
const dubPage = {
  pages: [{ number: 1, eps: [1, 2] }],
  result: [
    { slug: 'ep-1-dub', episode_number: 1, title: 'Start Dub' },
    { slug: 'ep-2-dub', episode_number: 2, title: 'Next Dub' }
  ]
};
const candidate = {
  slug: 'mock-anime-da47',
  title: 'Mock Anime',
  title_en: 'Mock Anime',
  title_ja: 'モックアニメ',
  year: 2024,
  type: 'tv',
  locales: ['ja-JP', 'en-US']
};

const playerHtml = [
  '<html><script>',
  'var captions = [',
  '{"language":[0,"English"],"name":[0,"English"],"src":[0,"https:\\/\\/cdn.example\\/en.vtt"]},',
  '{"language":[0,"Spanish"],"name":[0,"Spanish (Latin America)"],"src":[0,"https:\\/\\/cdn.example\\/es.vtt"]},',
  '{"language":[0,"English"],"name":[0,"English duplicate"],"src":[0,"https:\\/\\/cdn.example\\/en.vtt"]}',
  '];',
  '</script></html>'
].join('\n');

const requests = [];
global.fetch = async (url, init) => {
  const target = String(url);
  const options = init || {};
  requests.push({ url: target, options });
  if (target === 'https://graphql.anilist.co') {
    const body = JSON.parse(options.body);
    if (body.query.includes('Media(id:$id')) return json({ data: { Media: media } });
    if (body.query.includes('Page(')) return json({ data: { Page: { media: [media] } } });
    return json({ errors: [{ message: 'unexpected query' }] });
  }
  if (target === 'https://kaa.lt/api/fsearch') {
    return json({ result: [candidate] });
  }
  if (target === 'https://kaa.lt/api/show/mock-anime-da47/episodes?ep=1&lang=ja-JP') {
    return json(subPage);
  }
  if (target === 'https://kaa.lt/api/show/mock-anime-da47/episodes?ep=1&lang=en-US') {
    return json(dubPage);
  }
  if (target === 'https://kaa.lt/api/show/mock-anime-da47/episode/ep-1-ep-1-sub') {
    return json({ servers: [
      { name: 'MegaPlay', src: 'https://megaplay.example/embed/1' },
      { name: 'VidStreaming', src: 'https://krussdomi.com/player?id=abc123&source=vidstream' }
    ] });
  }
  if (target === 'https://kaa.lt/api/show/mock-anime-da47/episode/ep-1-ep-1-dub') {
    return json({ servers: [
      { name: 'VidStreaming', src: 'https://krussdomi.com/player?id=dub123&source=vidstream' }
    ] });
  }
  if (target === 'https://krussdomi.com/player?id=abc123&source=vidstream') return html(playerHtml);
  if (target === 'https://krussdomi.com/player?id=dub123&source=vidstream') return html(playerHtml);
  return json({ error: 'not found' }, 404);
};

const provider = require('../providers/kickassanime.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((entry) => entry.id === 'kickassanime');

async function main() {
  assert.ok(source, 'KickAssAnime must be registered in the manifest');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);
  assert.deepEqual(provider.getSettings().map((entry) => entry.key), source.settings.map((entry) => entry.key));

  assert.equal(provider._titleSelectionScore('Mock Anime', 'Mock Anime'), 1);
  assert.ok(provider._titleSelectionScore('Mock Anime', 'Mock Anime Season 2') < 0.8);
  assert.equal(provider._seasonNumber('Mock Anime Season 2'), 2);
  assert.equal(provider._seasonNumber('Mock Anime 2nd Season'), 2);
  assert.equal(provider._seasonNumber('Mock Anime II'), 2);
  assert.equal(provider._seasonNumber('Mock Anime 2'), 2);
  assert.equal(provider._seasonNumber('Mobile Suit Gundam 00'), null);
  assert.equal(provider._candidate(candidate).slug, 'mock-anime-da47');

  const home = await provider.getHome({});
  assert.equal(home.length, 2);
  assert.ok(home.every((row) => row.items.length === 1));

  const search = await provider.search('Mock Anime', 1, {});
  assert.equal(search.length, 1);
  assert.equal(search[0].url, 'kaa://anime/151807');
  assert.equal(search[0].sourceId, 'kickassanime');

  const detail = await provider.getDetail('kaa://anime/151807', {});
  assert.equal(detail.title, 'Mock Anime (2024)');
  assert.equal(detail.status, 'ongoing');
  assert.equal(detail.episodes.length, 5, 'three sub and two dub rows');
  assert.equal(detail.subCount, 3);
  assert.equal(detail.dubCount, 2);
  assert.equal(detail.episodes[0].url, 'kaa://episode/151807/mock-anime-da47/1/sub');
  assert.equal(detail.episodes[0].title, 'Episode 1: Start');
  const dubOne = detail.episodes.find((entry) => entry.number === 1 && entry.category === 'dub');
  assert.equal(dubOne.title, 'Episode 1: Start Dub');

  const subOne = detail.episodes.find((entry) => entry.number === 1 && entry.category === 'sub');
  const subStreams = await provider.getVideoSources(subOne.url, {});
  assert.equal(subStreams.length, 1);
  assert.equal(subStreams[0].url, 'https://hls.krussdomi.com/manifest/abc123/master.m3u8');
  assert.equal(subStreams[0].type, 'hls');
  assert.equal(subStreams[0].container, 'hls');
  assert.equal(subStreams[0].kind, 'sub');
  assert.equal(subStreams[0].headers.Referer, 'https://krussdomi.com/');
  assert.equal(subStreams[0].headers.Origin, 'https://krussdomi.com');
  assert.equal(subStreams[0].subtitles.length, 2, 'duplicate subtitle URLs are deduplicated');
  assert.equal(subStreams[0].subtitles[0].format, 'vtt');
  assert.equal(subStreams[0].subtitles[0].url, 'https://cdn.example/en.vtt');

  const dubStreams = await provider.getVideoSources(dubOne.url, {});
  assert.equal(dubStreams.length, 1);
  assert.equal(dubStreams[0].url, 'https://hls.krussdomi.com/manifest/dub123/master.m3u8');
  assert.equal(dubStreams[0].kind, 'dub');
  assert.equal(dubStreams[0].audioLang, 'en-US');

  global.__settings.kickassanime.audioMode = 'sub';
  const subOnly = await provider.getDetail('kaa://anime/151807', {});
  assert.equal(subOnly.episodes.length, 3);
  assert.ok(subOnly.episodes.every((entry) => entry.category === 'sub'));

  global.__settings.kickassanime.audioMode = 'dub';
  const dubOnly = await provider.getDetail('kaa://anime/151807', {});
  assert.equal(dubOnly.episodes.length, 2);
  assert.ok(dubOnly.episodes.every((entry) => entry.category === 'dub'));
  global.__settings.kickassanime.audioMode = 'both';

  assert.deepEqual(provider._parseEpisode('kaa://episode/151807/mock-anime-da47/1/sub'), {
    anilistId: 151807, slug: 'mock-anime-da47', number: 1, category: 'sub'
  });
  assert.equal(provider._parseEpisode('kaa://episode/151807/mock%2Danime/1.5/dub').number, 1.5);
  assert.throws(() => provider._parseEpisode('kaa://episode/1'), /invalid episode URL/i);
  assert.throws(() => provider.getDetail('kaa://anime/nope'), /invalid AniList ID/i);
  assert.deepEqual(await provider.getVideoSources('kaa://episode/1', {}), []);
  assert.equal(provider._vidStreamingUrl({ servers: [{ name: 'MegaPlay', src: 'https://mega.example/1' }] }), '');
  assert.equal(provider._playerId('https://krussdomi.com/player?id=abc123&source=vidstream'), 'abc123');

  assert.ok(requests.some((entry) => entry.url === 'https://kaa.lt/api/fsearch'));
  assert.ok(requests.some((entry) => entry.url === 'https://krussdomi.com/player?id=abc123&source=vidstream'));

  console.log('KickAssAnime tests passed: manifest parity, real Response handling, AniList home/search/detail, title resolution, SUB/DUB episodes, VidStreaming HLS, subtitles, settings, and invalid input.');
}

main().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
