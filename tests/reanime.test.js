'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.__settings = {
  reanime: {
    audioMode: 'both',
    requestTimeoutMs: '12000',
    maxStreams: '4'
  }
};

function json(value, status, headers) {
  return new Response(JSON.stringify(value), {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {})
  });
}
function html(value, status, headers) {
  return new Response(value, {
    status: status || 200,
    headers: Object.assign({ 'content-type': 'text/html' }, headers || {})
  });
}

const item = {
  anime_id: 'mock-anime',
  title: 'Mock Anime',
  cover_image: { extra_large: 'https://img.example/poster.jpg' },
  anilist_id: 123,
  subbed: 2,
  dubbed: 2
};
const detailData = {
  anime_id: 'mock-anime',
  title: 'Mock Anime',
  description: 'A mock Re:Anime synopsis',
  status: 'ongoing',
  genres: ['Action', 'Fantasy'],
  season_year: 2024,
  mal_id: 456,
  anilist_id: 123,
  subbed: 2,
  dubbed: 2,
  cover_image: { extra_large: 'https://img.example/poster.jpg' }
};
const episodes = {
  data: [
    { episode_number: 1, episodeId: 'ep-1', title: 'First' },
    { episode_number: 2, episodeId: 'ep-2', title: 'Second' }
  ]
};
const watch = {
  anime: { anilist_id: 123 },
  episode_links: [
    { dataType: 'sub', serverName: 'Direct', dataLink: 'https://cdn.example/episode.mkv' },
    { dataType: 'sub', serverName: 'Direct duplicate', dataLink: 'https://cdn.example/episode.mkv' },
    { dataType: 'sub', serverName: 'FlixCloud', dataLink: 'https://flixcloud.cc/e/abc123' },
    { dataType: 'dub', serverName: 'FlixCloud Dub', dataLink: 'https://flixcloud.cc/e/dub123' }
  ]
};

const flixMeta = {
  abc123: JSON.stringify({
    fileId: '11111111-1111-1111-1111-111111111111',
    token: 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6IjEifQ.signature',
    base: 'https://fetch8.flixcloud.cc',
    resolution: '1080p'
  }),
  dub123: JSON.stringify({
    fileId: '22222222-2222-2222-2222-222222222222',
    token: 'eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6IjIifQ.signature',
    base: 'https://fetch9.flixcloud.cc',
    resolution: '720p'
  })
};

const requests = [];
let challengeSearch = 1;
global.fetch = async (url, init) => {
  const target = String(url);
  const options = init || {};
  requests.push({ url: target, options });

  if (target.indexOf('https://reanime.to/api/v1/search?') === 0) {
    if (challengeSearch > 0 && options.browser !== true) {
      challengeSearch -= 1;
      return html('<html><body>Just a moment...</body></html>', 403, { 'cf-mitigated': 'challenge' });
    }
    return json({ success: true, data: [item] });
  }
  if (target === 'https://reanime.to/api/v1/home/latest-aired?limit=12') {
    return json({ success: true, data: [item] });
  }
  if (target === 'https://reanime.to/api/v1/anime/mock-anime') {
    return json({ success: true, data: detailData });
  }
  if (target === 'https://reanime.to/api/v1/anime/mock-anime/episodes?limit=2000') {
    return json({ success: true, data: episodes.data });
  }
  if (target === 'https://reanime.to/api/watch/mock-anime/1') {
    return json(watch);
  }
  if (target === 'https://reanime.to/api/watch/missing-anime/1') {
    // Next.js 404 shells contain the same boot text as a Cloudflare challenge.
    return html('<html><body>Please enable JavaScript and cookies to continue.</body></html>', 404);
  }
  if (target === 'https://reanime.to/api/flix/123/1') {
    return json({ servers: [{ dataType: 'sub', dataLink: 'https://flixcloud.cc/e/abc123' }] });
  }
  if (target === 'https://flixcloud.cc/d/abc123/__data.json') return new Response(flixMeta.abc123, { status: 200 });
  if (target === 'https://flixcloud.cc/d/dub123/__data.json') return new Response(flixMeta.dub123, { status: 200 });
  if (target.indexOf('https://fetch8.flixcloud.cc/download/11111111-1111-1111-1111-111111111111/progress') === 0) {
    return new Response('{"status":"ready"}', { status: 200 });
  }
  if (target.indexOf('https://fetch9.flixcloud.cc/download/22222222-2222-2222-2222-222222222222/progress') === 0) {
    return new Response('{"status":"ready"}', { status: 200 });
  }
  return json({ success: false, message: 'not found' }, 404);
};

const provider = require('../providers/reanime.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((entry) => entry.id === 'reanime');

async function main() {
  assert.ok(source, 'Re:Anime must be registered in the manifest');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);
  assert.deepEqual(provider.getSettings().map((entry) => entry.key), source.settings.map((entry) => entry.key));

  assert.equal(provider._directMedia('http://cdn.example/file.mkv', 'x', 'sub'), null);
  assert.equal(provider._directMedia('https://cdn.example/file.jpg', 'x', 'sub'), null);
  assert.equal(provider._directMedia('https://cdn.example/file.m3u8', 'x', 'sub').container, 'hls');
  assert.equal(provider._directMedia('https://cdn.example/file.mkv', 'x', 'sub').container, 'mkv');
  assert.equal(provider._serverAudio({ dataType: 's-dub' }), 'dub');
  assert.equal(provider._serverAudio({ dataType: 'softsub' }), 'sub');
  assert.equal(provider._anilistId({ cover_image: { extra_large: 'https://img.example/bx12345-cover.jpg' } }), '12345');
  assert.deepEqual(provider._episodeParts('mock-anime|1|ep-1|123|dub'), {
    slug: 'mock-anime', epNum: 1, suppliedAid: '123', category: 'dub'
  });

  const home = await provider.getHome({});
  assert.equal(home.length, 2);
  assert.deepEqual(home.map((row) => row.title), ['Latest Aired', 'Popular Anime']);
  assert.ok(home.every((row) => row.items.length === 1));

  const search = await provider.search('Mock Anime', 1, {});
  assert.equal(search.length, 1);
  assert.equal(search[0].url, 'mock-anime');
  assert.equal(search[0].sourceId, 'reanime');
  assert.ok(requests.some((entry) => entry.url.indexOf('https://reanime.to/api/v1/search?') === 0 && entry.options.browser === true),
    'a Cloudflare challenge is retried with the browser flag');

  const detail = await provider.getDetail('mock-anime', {});
  assert.equal(detail.title, 'Mock Anime');
  assert.equal(detail.description, 'A mock Re:Anime synopsis');
  assert.equal(detail.year, '2024');
  assert.equal(detail.malId, 456);
  assert.equal(detail.anilistId, 123);
  assert.equal(detail.episodes.length, 2, 'one row per episode number, both audio tracks');
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 2);
  assert.equal(detail.episodes[0].url, 'mock-anime|1|ep-1|123|both');
  assert.equal(detail.episodes[0].title, 'Episode 1 - First');
  assert.equal(detail.episodes[1].url, 'mock-anime|2|ep-2|123|both');

  const bothOne = detail.episodes[0];
  const bothStreams = await provider.getVideoSources(bothOne.url, {});
  assert.equal(bothStreams.length, 3, 'a both episode exposes the direct sub link plus sub and dub FlixCloud downloads');
  assert.ok(bothStreams.some((entry) => entry.url === 'https://cdn.example/episode.mkv' && entry.kind === 'sub' && entry.container === 'mkv'),
    'direct sub MKV stream');
  assert.ok(bothStreams.some((entry) => entry.url.indexOf('https://fetch8.flixcloud.cc/download/11111111-1111-1111-1111-111111111111') === 0 && entry.kind === 'sub'),
    'sub FlixCloud download');
  assert.ok(bothStreams.some((entry) => entry.url.indexOf('https://fetch9.flixcloud.cc/download/22222222-2222-2222-2222-222222222222') === 0 && entry.kind === 'dub'),
    'dub FlixCloud download');
  const cachedBothStreams = await provider.getVideoSources(bothOne.url, {});
  assert.equal(cachedBothStreams, bothStreams, 'resolved streams are cached for repeated source sweeps');

  // A sub-only sweep collapses the both row to sub streams only.
  global.__settings.reanime.audioMode = 'sub';
  const subOnlyDetail = await provider.getDetail('mock-anime', {});
  assert.equal(subOnlyDetail.episodes.length, 2);
  assert.ok(subOnlyDetail.episodes.every((entry) => entry.category === 'sub'));
  const subStreams = await provider.getVideoSources(subOnlyDetail.episodes[0].url, {});
  assert.ok(subStreams.every((entry) => entry.kind === 'sub'));
  assert.ok(subStreams.some((entry) => entry.url.indexOf('https://fetch8.flixcloud.cc/download/11111111') === 0));

  global.__settings.reanime.audioMode = 'sub';
  const subOnly = await provider.getDetail('mock-anime', {});
  assert.equal(subOnly.episodes.length, 2);
  assert.ok(subOnly.episodes.every((entry) => entry.category === 'sub'));

  global.__settings.reanime.audioMode = 'dub';
  const dubOnly = await provider.getDetail('mock-anime', {});
  assert.equal(dubOnly.episodes.length, 2);
  assert.ok(dubOnly.episodes.every((entry) => entry.category === 'dub'));
  const dubStreams = await provider.getVideoSources(dubOnly.episodes[0].url, {});
  assert.ok(dubStreams.every((entry) => entry.kind === 'dub'));
  assert.ok(dubStreams.some((entry) => entry.url.indexOf('https://fetch9.flixcloud.cc/download/22222222') === 0));
  global.__settings.reanime.audioMode = 'both';

  assert.equal(provider._mergeServers({ episode_links: watch.episode_links }, { servers: watch.episode_links }).length, 3);
  assert.equal(provider._mergeServers(null, { servers: [
    { serverName: 'HD-1', dataLink: 'https://flixcloud.cc/e/abc123?v=1', dataType: 'sub' },
    { serverName: 'HD-2', dataLink: 'https://flixcloud.cc/e/abc123?v=2', dataType: 'sub' },
    { serverName: 'HD-1', dataLink: 'https://flixcloud.cc/e/abc123?v=1', dataType: 'dub' }
  ] }).length, 2, 'HD-1/HD-2 mirrors collapse per audio track but keep sub and dub separate');

  const watchBefore = requests.filter((entry) => entry.url === 'https://reanime.to/api/watch/missing-anime/1').length;
  const missingStreams = await provider.getVideoSources('missing-anime|1|ep-1|123|sub', {});
  const watchAfter = requests.filter((entry) => entry.url === 'https://reanime.to/api/watch/missing-anime/1').length;
  assert.equal(watchAfter - watchBefore, 1,
    'a 404 HTML shell is not mistaken for a Cloudflare challenge and retried across mirrors');
  assert.equal(missingStreams.length, 1, 'the FlixCloud lookup still works when the watch endpoint is missing');

  await assert.rejects(() => provider.getDetail(''), /missing anime slug/i);
  assert.deepEqual(await provider.getVideoSources('', {}), []);
  assert.ok(requests.some((entry) => entry.url === 'https://flixcloud.cc/d/abc123/__data.json'));
  assert.ok(requests.some((entry) => entry.url.indexOf('https://fetch8.flixcloud.cc/download/11111111-1111-1111-1111-111111111111/progress') === 0));

  console.log('Re:Anime tests passed: manifest parity, real Response handling, Cloudflare browser retry, search/home/detail, SUB/DUB episodes, direct MKV and FlixCloud downloads, deduplication, cached streams, 404 handling, settings, and invalid input.');
}

main().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
