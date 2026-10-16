'use strict';
const assert = require('node:assert/strict');

const calls = [];
const bootstrapCounts = new Map();
const transientFailures = new Map();
global.__settings = { anipm: { language: 'sub' } };
global.fetch = async (url, options) => {
  const u = String(url);
  calls.push({ url: u, options: options || {} });
  const remaining = transientFailures.get(u) || 0;
  if (remaining > 0) {
    transientFailures.set(u, remaining - 1);
    return { status: 503, body: JSON.stringify({ error: 'temporary upstream failure' }) };
  }

  let body = {};
  if (u === 'https://ani.pm/api/anime/search?q=Mock%20Anime&page=1') {
    body = { items: [{
      id: '123', source: 'anime', title: { english: 'Mock Anime', romaji: 'Mock Anime Romaji' },
      anilistId: 123, malId: 999, cover: 'https://img.example/anipm.jpg'
    }] };
  } else if (u.indexOf('https://ani.pm/api/anime/playback-bootstrap/anime/123?') === 0) {
    const lang = new URL(u).searchParams.get('lang');
    const count = (bootstrapCounts.get(lang) || 0) + 1;
    bootstrapCounts.set(lang, count);
    if (lang === 'sub' && count === 1) {
      body = { core: { title: { english: 'Mock Anime' } }, packages: { episodes: {} }, settlarSelection: 'empty-sub-selection' };
    } else body = {
      core: {
        title: { english: 'Mock Anime', romaji: 'Mock Anime Romaji' }, anilistId: 123, malId: 999,
        episodes: [{ number: 1, title: 'The Beginning' }, { number: 2, title: 'The Journey' }]
      },
      packages: { episodes: { '1': { sub: true, dub: true }, '2': { sub: true } } },
      settlarSelection: 'selection-token'
    };
  } else if (u.indexOf('https://ani.pm/api/anime/settlar/session?') === 0) {
    body = { embedUrl: 'https://embed.settlar.io/embed?t=session-token' };
  } else if (u === 'https://embed.settlar.io/api/embed/session?t=session-token') {
    body = {
      source: 'https://cdn.example/mock-episode.m3u8',
      subtitles: [{ url: 'https://cdn.example/en.vtt', label: 'English' }]
    };
  }
  return { status: 200, body: JSON.stringify(body) };
};

const provider = require('../providers/anipm.js');

async function main() {
  assert.equal(provider.version, '1.3.0');
  assert.equal(provider.getInfo().name, 'Ani.pm');
  assert.equal(provider.getInfo().type, 'anime');
  assert.equal(provider.getSettings()[0].default, 'sub');

  const searchUrl = 'https://ani.pm/api/anime/search?q=Mock%20Anime&page=1';
  transientFailures.set(searchUrl, 1);
  const results = await provider.search('Mock Anime', 1, {});
  assert.equal(calls.filter((c) => c.url === searchUrl).length, 2, 'transient API failures should retry');
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Mock Anime');
  assert.equal(results[0].englishTitle, 'Mock Anime Romaji');
  assert.equal(results[0].malId, 999);
  assert.equal(results[0].anilistId, 123);

  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.title, 'Mock Anime');
  assert.equal(detail.malId, 999);
  assert.equal(detail.episodes.length, 2);
  assert.deepEqual(detail.episodes.map((ep) => ep.number), [1, 2], 'episodes must be ascending for Z Mode canonical mapping');
  assert.equal(detail.episodes[0].title, 'The Beginning');
  assert.equal(detail.episodes[1].title, 'The Journey');

  const bootstrapCallsBeforeEpisodes = calls.filter((c) => c.url.indexOf('https://ani.pm/api/anime/playback-bootstrap/anime/123?') === 0).length;
  const episodes = await provider.getEpisodes(results[0].url, {});
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].title, 'The Beginning');
  assert.equal(calls.filter((c) => c.url.indexOf('https://ani.pm/api/anime/playback-bootstrap/anime/123?') === 0).length, bootstrapCallsBeforeEpisodes,
    'getEpisodes should reuse successful detail bootstrap data');

  const streams = await provider.getVideoSources(episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/mock-episode.m3u8');
  assert.equal(streams[0].container, 'hls');
  assert.equal(streams[0].headers.Referer, 'https://embed.settlar.io/');
  assert.equal(streams[0].subtitles[0].file, 'https://cdn.example/en.vtt');
  assert.ok(calls.every((c) => c.options.headers && c.options.headers.Referer));

  console.log('Ani.pm mocked integration tests passed.');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
