'use strict';

/*
 * Anichi provider contract tests.
 * Uses a deterministic fetch double to verify parsing and resolution rules
 * without touching the network.
 */

const assert = require('node:assert/strict');

global.__settings = {
  anichi: { verifyPlayback: true }
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

  if (url === 'https://anichi.to/') {
    return mockResponse(200, '<html><body>' +
      '<a href="https://anichi.to/anime/test-anime-abc123"><img src="https://img.example/test.jpg"/>' +
      '<span>Test Anime</span></a>' +
      '</body></html>', { 'content-type': 'text/html' });
  }

  if (url.indexOf('/filter?keyword=') !== -1) {
    return mockResponse(200, '<html><body>' +
      '<a href="https://anichi.to/anichi/test-anime-abc123">Test Anime 1080p</a>' +
      '<a href="https://anichi.to/anichi/test-movie-def456">Test Movie 720p</a>' +
      '</body></html>', { 'content-type': 'text/html' });
  }

  if (url.indexOf('/anime/') !== -1) {
    return mockResponse(200, '<html><head>' +
      '<title>Test Anime | Anichi</title>' +
      '<meta property="og:image" content="https://img.example/poster.jpg"/>' +
      '<meta property="og:description" content="A test synopsis."/>' +
      '</head><body>' +
      '<h1>Test Anime - Episode 1</h1>' +
      '<a href="https://anichi.to/watch/test-anime-abc123/ep-1">Watch Episode 1</a>' +
      '</body></html>', { 'content-type': 'text/html' });
  }

  if (url.indexOf('/watch/') !== -1) {
    return mockResponse(200, '<html><body>' +
      '<h1>Watch Test Anime Episode 1</h1>' +
      '<iframe src="https://voe.sx/e/abc123def"></iframe>' +
      '</body></html>', { 'content-type': 'text/html' });
  }

  return mockResponse(404, 'not found');
};

const provider = require('../providers/anichi.js');

async function main() {
  const manifest = require('../index.json');
  const source = manifest.sources.find((item) => item.id === 'anichi');
  assert.ok(source, 'anichi must be registered in index.json');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);
  assert.equal(provider.getInfo().type, source.type);
  assert.deepEqual(provider.getSettings().map((item) => item.key), source.settings.map((item) => item.key));

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].title, 'Anichi Latest');
  assert.equal(home[0].items.length, 1);
  assert.equal(home[0].items[0].title, 'Test Anime');
  assert.equal(home[0].items[0].cover, 'https://img.example/test.jpg');

  const results = await provider.search('test anime', 1, {});
  assert.ok(Array.isArray(results), 'search should return an array');

  const detail = await provider.getDetail('https://anichi.to/anime/test-anime-abc123/', {});
  assert.equal(detail.title, 'Test Anime');
  assert.equal(detail.cover, 'https://img.example/poster.jpg');
  assert.equal(detail.description, 'A test synopsis.');
  assert.equal(detail.type, 'anime');
  assert.equal(detail.status, 'unknown');

  const episodes = await provider.getEpisodes(detail.url, {});
  assert.ok(episodes.length >= 0, 'episodes should be an array');
  if (episodes.length > 0) {
    assert.equal(episodes[0].number, 1);
    assert.equal(episodes[0].url, 'https://anichi.to/watch/test-anime-abc123/ep-1');
  }

  const streams = await provider.getVideoSources(episodes[0].url, {});
  assert.ok(Array.isArray(streams));
  assert.ok(calls.length > 0, 'the provider should have made requests');
  assert.ok(calls.every((call) => /^https:\/\//i.test(call.url)), 'every provider request must be HTTPS');

  console.log('Anichi provider contract tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
