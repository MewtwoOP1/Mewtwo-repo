'use strict';

/*
 * AnimeNosub provider contract tests.
 * Uses a deterministic fetch double to verify parsing and resolution rules
 * without touching the network.
 */

const assert = require('node:assert/strict');

global.__settings = {
  animenosub: { verifyPlayback: true }
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

  if (url.indexOf('/wp-json/wp/v2/posts') !== -1) {
    if (url.indexOf('/posts?') !== -1 && !url.includes('search=')) {
      return mockResponse(200, JSON.stringify([
        { id: 401, slug: 'test-anime', title: { rendered: 'Test Anime' }, link: 'https://animenosub.to/test-anime/', content: { rendered: '<p>A test synopsis.</p>' }, _embedded: { 'wp:featuredmedia': [{ source_url: 'https://img.example/test.jpg' }], 'wp:term': [{ taxonomy: 'category', name: 'Action' }] } }
      ]), { 'content-type': 'application/json' });
    }
    return mockResponse(200, JSON.stringify([]), { 'content-type': 'application/json' });
  }

  if (url.indexOf('/posts?slug=') !== -1) {
    return mockResponse(200, JSON.stringify({ id: 401, slug: 'test-anime', title: { rendered: 'Test Anime' }, link: 'https://animenosub.to/test-anime/', content: { rendered: '<p>A test synopsis.</p>' }, _embedded: { 'wp:featuredmedia': [{ source_url: 'https://img.example/test.jpg' }], 'wp:term': [{ taxonomy: 'category', name: 'Action' }] } }), { 'content-type': 'application/json' });
  }

  if (url === 'https://animenosub.to/test-anime/') {
    return mockResponse(200, '<html><body>' +
      '<a href="https://animenosub.to/category/test-anime-episode-1/">Episode 1</a>' +
      '<a href="https://animenosub.to/category/test-anime-episode-2/">Episode 2</a>' +
      '</body></html>', { 'content-type': 'text/html' });
  }

  return mockResponse(404, 'not found');
};

const provider = require('../providers/animenosub.js');

async function main() {
  const manifest = require('../index.json');
  const source = manifest.sources.find((item) => item.id === 'animenosub');
  assert.ok(source, 'animenosub must be registered in index.json');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);
  assert.equal(provider.getInfo().type, source.type);
  assert.deepEqual(provider.getSettings().map((item) => item.key), source.settings.map((item) => item.key));

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].title, 'AnimeNosub Latest');
  assert.equal(home[0].items.length, 1);
  assert.equal(home[0].items[0].title, 'Test Anime');

  const results = await provider.search('test anime', 1, {});
  assert.ok(Array.isArray(results));
  assert.ok(calls.length > 0, 'the provider should have made requests');
  assert.ok(calls.every((call) => /^https:\/\//i.test(call.url)), 'every provider request must be HTTPS');

  console.log('AnimeNosub provider contract tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
