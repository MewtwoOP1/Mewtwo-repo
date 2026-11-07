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

function astroPlayer(props) {
  const encoded = JSON.stringify(props).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return '<html><body><astro-island props="' + encoded + '"></astro-island></body></html>';
}
const catPlayerHtml = astroPlayer({
  manifest: [0, '//bl.krussdomi.com/playlist/cat123/master.m3u8'],
  subtitles: [1, [
    [0, { format: [0, 'srt'], language: [0, 'en'], name: [0, 'English'], src: [0, 'https:///subbl.krussdomi.com/cat123/en.srt'] }]
  ]],
  type: [0, 'hls'],
  source: [0, 'catstream']
});
const dashPlayerHtml = astroPlayer({
  manifest: [0, 'https:////bl.krussdomi.com/mpd/bird123/master.mpd'],
  subtitles: [1, []],
  type: [0, 'dash'],
  source: [0, 'catstream']
});

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
  if (target === 'https://kaa.lt/api/show/mock-anime-da47/episodes?ep=2&lang=ja-JP') {
    return json(subPage);
  }
  if (target === 'https://kaa.lt/api/show/mock-anime-da47/episodes?ep=2&lang=en-US') {
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
  if (target === 'https://kaa.lt/api/show/mock-anime-da47/episode/ep-2-ep-2-sub') {
    return json({ servers: [
      { name: 'CatStream', src: 'https://krussdomi.com/cat-player/player?id=cat123&type=hls&source=catstream' }
    ] });
  }
  if (target === 'https://kaa.lt/api/show/mock-anime-da47/episode/ep-2-ep-2-dub') {
    return json({ servers: [] });
  }
  if (target === 'https://krussdomi.com/player?id=abc123&source=vidstream') return html(playerHtml);
  if (target === 'https://krussdomi.com/player?id=dub123&source=vidstream') return html(playerHtml);
  if (target === 'https://krussdomi.com/cat-player/player?id=cat123&type=hls&source=catstream') return html(catPlayerHtml);
  if (target === 'https://krussdomi.com/cat-player/player?id=bird123&type=dash') return html(dashPlayerHtml);
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

  const anilistMediaCalls = () => requests.filter((entry) => {
    if (entry.url !== 'https://graphql.anilist.co') return false;
    try { return JSON.parse(entry.options.body).query.includes('Media(id:$id'); } catch (_) { return false; }
  }).length;
  const mediaCallsBeforeDetail = anilistMediaCalls();
  const detail = await provider.getDetail('kaa://anime/151807', {});
  assert.equal(anilistMediaCalls(), mediaCallsBeforeDetail,
    'detail reuses the AniList row already returned by search/home');
  assert.equal(requests.filter((entry) => entry.url === 'https://kaa.lt/api/fsearch').length, 1,
    'duplicate English/romaji titles are searched once and a confident match stops alias probing');
  assert.equal(detail.title, 'Mock Anime (2024)');
  assert.equal(detail.status, 'ongoing');
  assert.equal(detail.episodes.length, 3, 'one row per episode number, both audio tracks');
  assert.equal(detail.subCount, 3);
  assert.equal(detail.dubCount, 2);
  assert.equal(detail.episodes[0].url, 'kaa://episode/151807/mock-anime-da47/1/both');
  assert.equal(detail.episodes[0].title, 'Episode 1: Start');
  assert.equal(detail.episodes[1].url, 'kaa://episode/151807/mock-anime-da47/2/both');
  assert.equal(detail.episodes[2].url, 'kaa://episode/151807/mock-anime-da47/3/sub');

  const bothOne = detail.episodes[0];
  const bothStreams = await provider.getVideoSources(bothOne.url, {});
  assert.equal(bothStreams.length, 2, 'a both episode exposes sub and dub streams');
  assert.ok(bothStreams.some((entry) => entry.url === 'https://hls.krussdomi.com/manifest/abc123/master.m3u8' && entry.kind === 'sub'),
    'sub VidStreaming HLS');
  assert.ok(bothStreams.some((entry) => entry.url === 'https://hls.krussdomi.com/manifest/dub123/master.m3u8' && entry.kind === 'dub' && entry.audioLang === 'en-US'),
    'dub VidStreaming HLS');
  assert.equal(bothStreams[0].subtitles.length, 2, 'duplicate subtitle URLs are deduplicated');
  assert.equal(bothStreams[0].subtitles[0].format, 'vtt');
  assert.equal(bothStreams[0].subtitles[0].url, 'https://cdn.example/en.vtt');

  const catManifest = provider._playerManifest(catPlayerHtml);
  assert.deepEqual(catManifest, { url: 'https://bl.krussdomi.com/playlist/cat123/master.m3u8', type: 'hls' });
  const catSubtitles = provider._subtitles(catPlayerHtml);
  assert.equal(catSubtitles.length, 1, 'CatStream Astro props expose one subtitle');
  assert.equal(catSubtitles[0].url, 'https://subbl.krussdomi.com/cat123/en.srt');
  assert.equal(catSubtitles[0].format, 'srt');
  assert.deepEqual(provider._playerManifest(dashPlayerHtml), {
    url: 'https://bl.krussdomi.com/mpd/bird123/master.mpd', type: 'dash'
  });
  assert.equal(provider._serverUrl({ servers: [
    { name: 'BirdStream', src: 'https://krussdomi.com/cat-player/player?id=bird123&type=dash' },
    { name: 'CatStream', src: 'https://krussdomi.com/cat-player/player?id=cat123&type=hls&source=catstream' }
  ] }), 'https://krussdomi.com/cat-player/player?id=cat123&type=hls&source=catstream',
    'the native priority prefers VidStreaming, then CatStream, then BirdStream');

  const bothTwo = detail.episodes.find((entry) => entry.number === 2 && entry.category === 'both');
  const catStreams = await provider.getVideoSources(bothTwo.url, {});
  assert.equal(catStreams.length, 1, 'a both episode with a dub-only empty server list still returns the sub stream');
  assert.equal(catStreams[0].url, 'https://bl.krussdomi.com/playlist/cat123/master.m3u8');
  assert.equal(catStreams[0].type, 'hls');
  assert.equal(catStreams[0].kind, 'sub');
  assert.equal(catStreams[0].subtitles[0].format, 'srt');

  // A dub-only row whose server list is empty falls back to the Japanese stream.
  global.__settings.kickassanime.audioMode = 'dub';
  const dubOnlyForFallback = await provider.getDetail('kaa://anime/151807', {});
  const dubOnlyRow = dubOnlyForFallback.episodes.find((entry) => entry.number === 2 && entry.category === 'dub');
  const dubFallback = await provider.getVideoSources(dubOnlyRow.url, {});
  assert.equal(dubFallback.length, 1, 'a dub row with no servers falls back to the Japanese stream');
  assert.equal(dubFallback[0].kind, 'sub');
  assert.match(dubFallback[0].label, /dub unavailable/i);
  assert.equal(dubFallback[0].url, 'https://bl.krussdomi.com/playlist/cat123/master.m3u8');

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

  console.log('KickAssAnime tests passed: manifest parity, real Response handling, AniList home/search/detail, title resolution, SUB/DUB episodes, VidStreaming HLS, CatStream/DASH manifests, subtitles, dub fallback, settings, and invalid input.');
}

main().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
