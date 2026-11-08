'use strict';

/*
 * AniHQ provider contract tests.
 * Uses a deterministic fetch double to verify parsing and resolution rules
 * without touching the network.
 */

const assert = require('node:assert/strict');

global.__settings = {
  anihq: { verifyPlayback: true }
};

function mockResponse(status, body, headers) {
  const normalized = {};
  Object.keys(headers || {}).forEach((key) => {
    normalized[key.toLowerCase()] = String(headers[key]);
  });
  return {
    status: status,
    headers: { get(name) { return normalized[String(name).toLowerCase()] || ''; } },
    text: async function () { return String(body == null ? '' : body); }
  };
}

const calls = [];

global.fetch = async function (input, init) {
  const url = String(input && input.url ? input.url : input);
  const options = init || {};
  const method = String(options.method || 'GET').toUpperCase();
  calls.push({ url: url, method: method });
  if (!/^https:\/\//i.test(url)) throw new Error('Non-HTTPS fetch attempted: ' + url);

  if (url.indexOf('/wp-json/wp/v2/anime') !== -1) {
    var termGroups = [
      [{ taxonomy: 'genre', name: 'Action' }],
      [{ taxonomy: 'studio', name: 'Test Studio' }],
      [{ taxonomy: 'anime_status', name: 'Finished Airing' }],
      [{ taxonomy: 'anime_type', name: 'TV' }],
      [{ taxonomy: 'premiered', name: '2020' }]
    ];
    var post = { id: 201, slug: 'test-anime', title: { rendered: 'Test Anime' }, link: 'https://anihq.cc/anime-show/test-anime/', content: { rendered: '<p>A test synopsis.</p>' }, excerpt: { rendered: '' }, _embedded: { 'wp:featuredmedia': [{ source_url: 'https://img.example/test.jpg' }], 'wp:term': termGroups } };
    if (url.indexOf('search=') !== -1) {
      return mockResponse(200, JSON.stringify([post]), { 'content-type': 'application/json' });
    }
    if (url.indexOf('slug=') !== -1) {
      return mockResponse(200, JSON.stringify(post), { 'content-type': 'application/json' });
    }
    return mockResponse(200, JSON.stringify([post]), { 'content-type': 'application/json' });
  }

  if (url === 'https://anihq.cc/anime-show/test-anime/') {
    return mockResponse(200, '<html><body>' +
      '<a href="https://anihq.cc/watch/test-anime-episode-1/">Episode 1</a>' +
      '<a href="https://anihq.cc/watch/test-anime-episode-2/">Episode 2</a>' +
      '</body></html>', { 'content-type': 'text/html' });
  }

  if (url.indexOf('/watch/') !== -1) {
    return mockResponse(200, '<html><body>' +
      '<iframe src="https://voe.sx/e/test123"></iframe>' +
      '</body></html>', { 'content-type': 'text/html' });
  }

  return mockResponse(404, 'not found');
};

const provider = require('../providers/anihq.js');

async function main() {
  const manifest = require('../index.json');
  const source = manifest.sources.find((item) => item.id === 'anihq');
  assert.ok(source, 'anihq must be registered in index.json');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);
  assert.equal(provider.getInfo().type, source.type);
  assert.deepEqual(provider.getSettings().map((item) => item.key), source.settings.map((item) => item.key));

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].title, 'AniHQ Anime');
  assert.equal(home[0].items.length, 1);
  assert.equal(home[0].items[0].title, 'Test Anime');

  const results = await provider.search('test anime', 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Test Anime');
  assert.equal(results[0].type, 'anime');

  const detail = await provider.getDetail('https://anihq.cc/anime-show/test-anime/', {});
  assert.equal(detail.title, 'Test Anime');
  assert.equal(detail.cover, 'https://img.example/test.jpg');
  assert.ok(detail.status === 'Finished Airing' || detail.status === 'unknown', 'status should be Finished Airing or unknown');
  assert.equal(detail.year, 2020);
  assert.equal(detail.type, 'anime');
  assert.deepEqual(detail.genres, ['Action']);
  assert.deepEqual(detail.studios, ['Test Studio']);

  const episodes = await provider.getEpisodes(detail.url, {});
  assert.ok(episodes.length >= 0, 'episodes should be an array');
  if (episodes.length > 0) {
    assert.equal(episodes[0].number, 1);
  }

  const streams = await provider.getVideoSources(episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://voe.sx/e/test123');
  assert.equal(streams[0].label, 'AniHQ VOE');

  assert.ok(calls.length > 0, 'the provider should have made requests');
  assert.ok(calls.every((call) => /^https:\/\//i.test(call.url)), 'every provider request must be HTTPS');

  console.log('AniHQ provider contract tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
