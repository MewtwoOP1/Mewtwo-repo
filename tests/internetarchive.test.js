'use strict';
// Contract, settings, metadata, and stream extraction tests for the
// Internet Archive provider. Network calls are stubbed; real-host smoke
// checks live outside the CI test suite.
if (typeof globalThis.crypto === 'undefined') { try { globalThis.crypto = require('crypto').webcrypto; } catch (e) {} }
var P = require('../providers/internetarchive.js');
globalThis.__settings = { internetarchive: { maxResults: 20, includeMovies: true, includeTV: true } };
var pass = 0, fail = 0, skip = 0, failures = [];
function ok(n, c, d) { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  \x1b[31m✗\x1b[0m ' + n + (d ? '  — ' + d : '')); } }
function skipT(n, r) { skip++; console.log('  \x1b[33m○\x1b[0m ' + n + '  (' + r + ')'); }
function g(t) { console.log('\n\x1b[36m' + t + '\x1b[0m'); }

var origFetch = globalThis.fetch;

function stubFetch(responses) {
  globalThis.fetch = function (url, opts) {
    for (var i = 0; i < responses.length; i++) {
      var r = responses[i];
      if (url.indexOf(r.match) >= 0) {
        return Promise.resolve(r.result);
      }
    }
    return Promise.resolve({ ok: false, status: 404, text: function () { return Promise.resolve(''); } });
  };
}

function restoreFetch() { globalThis.fetch = origFetch; }

(async function () {
  g('1. Contract exports');
  ['getInfo','getSettings','getHome','search','getDetail','getVideoSources','getStreams']
    .forEach(function (k) { ok('export .' + k, typeof P[k] === 'function'); });
  ok('version is 1.0.1', P.version === '1.0.1', String(P.version));
  ok('getInfo() name = Internet Archive', P.getInfo().name === 'Internet Archive');
  ok('getInfo() type = movie', P.getInfo().type === 'movie');
  ok('getInfo().lang = en', P.getInfo().lang === 'en');
  ok('logo present', typeof P.getInfo().logo === 'string' && P.getInfo().logo.length > 0);

  g('2. Settings schema');
  var settings = P.getSettings();
  ok('3 settings present', settings.length === 3, String(settings.length));
  ['maxResults','includeMovies','includeTV']
    .forEach(function (k) { ok('setting "' + k + '" present', settings.some(function (s) { return s.key === k; })); });
  ok('maxResults is enum', settings[0].type === 'enum', settings[0].type);
  ok('includeMovies is bool', settings[1].type === 'bool', settings[1].type);
  ok('includeTV is bool', settings[2].type === 'bool', settings[2].type);

  g('3. Search (mocked)');
  stubFetch([
    { match: '/advancedsearch.php', result: { ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({
      response: {
        numFound: 2,
        docs: [
          { identifier: 'test-movie-1', title: 'Test Movie One', description: 'A test movie', year: 2020, mediatype: 'movies', format: 'MP4', size: 1000000000 },
          { identifier: 'test-tv-1', title: 'Test TV Show', description: 'A test TV show', year: 2019, mediatype: 'tv', format: 'MP4', size: 500000000 }
        ]
      }
    })) } } },
    { match: '/metadata/', result: { ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({
      metadata: { title: 'Test Movie One', description: 'A test movie', year: '2020', subject: 'Drama', language: 'eng', mediatype: 'movies' },
      files: [ { name: 'test-movie-1.mp4', size: 1000000000, format: 'MP4' }, { name: 'test-movie-1.srt', size: 50000, format: 'SRT' } ]
    })) } } },
    { match: '/metadata/test-movie-1', result: { ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({
      metadata: { title: 'Test Movie One', mediatype: 'movies' },
      files: [ { name: 'test-movie-1.mp4', size: 1000000000, format: 'MP4' }, { name: 'test-movie-1_720p.mp4', size: 500000000, format: 'MP4' }, { name: 'test-movie-1.srt', size: 50000, format: 'SRT' } ]
    })) } } }
  ]);
  var results = await P.search('test');
  ok('search returns array', Array.isArray(results));
  ok('search returns 2 results', results.length === 2, String(results.length));
  if (results.length > 0) {
    ok('result has id', typeof results[0].id === 'string' && results[0].id.length > 0);
    ok('result has title', typeof results[0].title === 'string' && results[0].title.length > 0);
    ok('result has year', typeof results[0].year === 'string');
    ok('result has mediatype', typeof results[0].mediatype === 'string');
  }
  restoreFetch();

  g('4. Detail (mocked)');
  stubFetch([
    { match: '/metadata/test-movie-1', result: { ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({
      metadata: { title: 'Test Movie One', description: 'A test movie', year: '2020', subject: 'Drama', language: 'eng', mediatype: 'movies' },
      files: [ { name: 'test-movie-1.mp4', size: 1000000000, format: 'MP4' }, { name: 'test-movie-1.srt', size: 50000, format: 'SRT' } ]
    })) } } }
  ]);
  var detail = await P.getDetail('test-movie-1');
  ok('detail returns object', detail !== null);
  if (detail) {
    ok('detail has id', detail.id === 'test-movie-1');
    ok('detail has title', detail.title === 'Test Movie One');
    ok('detail has year', detail.year === '2020');
    ok('detail has streamUrl', typeof detail.streamUrl === 'string' && detail.streamUrl.length > 0);
    ok('detail is movie', detail.isMovie === true);
    ok('detail is not TV', detail.isTV === false);
  }
  restoreFetch();

  g('5. Stream extraction (mocked)');
  stubFetch([
    { match: '/metadata/test-movie-1', result: { ok: true, status: 200, text: function () { return Promise.resolve(JSON.stringify({
      metadata: { title: 'Test Movie One', mediatype: 'movies' },
      files: [ { name: 'test-movie-1.mp4', size: 1000000000, format: 'MP4' }, { name: 'test-movie-1_720p.mp4', size: 500000000, format: 'MP4' }, { name: 'test-movie-1.srt', size: 50000, format: 'SRT' } ]
    })) } } }
  ]);
  var streams = await P.getVideoSources('test-movie-1');
  ok('getVideoSources returns array', Array.isArray(streams));
  ok('getVideoSources returns 2 streams', streams.length === 2, String(streams.length));
  if (streams.length > 0) {
    ok('stream has url', typeof streams[0].url === 'string' && streams[0].url.length > 0);
    ok('stream has container', typeof streams[0].container === 'string');
    ok('stream has source label', streams[0].source === 'Internet Archive');
    ok('stream url is archive.org', streams[0].url.indexOf('archive.org') >= 0);
    ok('stream is mp4', streams[0].container === 'mp4');
  }
  restoreFetch();

  g('6. Edge cases');
  ok('search empty returns array', Array.isArray(await P.search('')));
  ok('detail null returns null', (await P.getDetail(null)) === null);
  ok('detail empty returns null', (await P.getDetail('')) === null);
  ok('getVideoSources empty returns []', (await P.getVideoSources('')).length === 0);
  ok('getVideoSources null returns []', (await P.getVideoSources(null)).length === 0);

  g('7. Summary');
  console.log('\nPassed: ' + pass + ', Failed: ' + fail + ', Skipped: ' + skip);
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exit(1);
  }
  process.exit(0);
})();