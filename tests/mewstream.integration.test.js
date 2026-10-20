'use strict';
var P = require('../providers/mewstream.js');
var pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (d ? ' — ' + d : '')); } }
function g(t) { console.log('\n\x1b[36m' + t + '\x1b[0m'); }

(async function () {
  g('Integration — mock network');

  var originalFetch = global.fetch;
  var calls = [];

  global.fetch = async function (url, opts) {
    calls.push(String(url));
    var u = String(url);
    if (u.indexOf('v3-cinemeta.strem.io/meta/movie/tt1375666') > -1) {
      return { body: JSON.stringify({ meta: { name: 'Inception', imdb_id: 'tt1375666', moviedb_id: 27205, genre: ['Action','Thriller'] } }) };
    }
    if (u.indexOf('api.themoviedb.org/3/movie/27205') > -1) {
      return { body: JSON.stringify({ genres: [{ name: 'Action' }, { name: 'Thriller' }], origin_country: ['US'], original_language: 'en' }) };
    }
    if (u.indexOf('streamdata.vaplayer.ru') > -1) {
      return { body: JSON.stringify({ data: { stream_urls: ['https://cdn.example.com/movie.m3u8'] } }) };
    }
    return { body: '' };
  };

  var logs = [], orig = console.log;
  console.log = function () { logs.push([].slice.call(arguments).join(' ')); orig.apply(console, arguments); };

  var res = await P.getVideoSources(JSON.stringify({
    imdbId: 'tt1375666', tmdbId: 27205, season: null, episode: 0,
    title: 'Inception', isAnime: false
  }), { onSubtitle: function () {} });

  console.log = orig;

  ok('returned an array', Array.isArray(res));
  ok('at least one stream', res.length >= 1, 'got ' + res.length);
  ok('stream has url', res.every(function (s) { return !!s.url; }));
  ok('log shows anime=false', logs.some(function (l) { return /anime=false/.test(l); }), logs.join(' | '));
  ok('no anime source called', !calls.some(function (u) { return /anikototv\.to|animesalt\.to|rareanimes\.mov|megaplays\.se/.test(u); }), calls.join('\n'));

  // Anime path: ensure absolute episode is used
  calls = [];
  global.fetch = async function (url) {
    calls.push(String(url));
    var u = String(url);
    if (u.indexOf('v3-cinemeta.strem.io/meta/series/tt1234567') > -1) {
      return { body: JSON.stringify({ meta: { name: 'Test Anime', imdb_id: 'tt1234567', moviedb_id: 99999, genre: ['Animation'], videos: [{ season: 1, episode: 1, name: 'E1' }, { season: 1, episode: 2, name: 'E2' }, { season: 1, episode: 3, name: 'E3' }] } }) };
    }
    if (u.indexOf('api.themoviedb.org/3/tv/99999') > -1) {
      return { body: JSON.stringify({ genres: [{ name: 'Animation' }], origin_country: ['JP'], original_language: 'ja', seasons: [{ season_number: 1 }] }) };
    }
    if (u.indexOf('anikototv.to/filter') > -1) {
      return { body: '<a href="/watch/test-anime">Test Anime</a>' };
    }
    if (u.indexOf('anikototv.to/watch/test-anime') > -1) {
      return { body: '<div data-id="555"></div>' };
    }
    if (u.indexOf('/ajax/episode/list/555') > -1) {
      return { body: JSON.stringify({ result: '<a data-id="1" data-num="1" data-ids="a" data-sub="1"></a><a data-id="2" data-num="2" data-ids="b" data-sub="1"></a><a data-id="3" data-num="3" data-ids="c" data-sub="1"></a>' }) };
    }
    if (u.indexOf('/ajax/server/list') > -1) {
      return { body: JSON.stringify({ result: '<li data-link-id="s1" data-type="sub">VidPlay</li>' }) };
    }
    if (u.indexOf('/ajax/server?get=') > -1) {
      return { body: JSON.stringify({ result: { url: 'https://megaplays.se/stream/s-2/abc/sub' } }) };
    }
    if (u.indexOf('megaplays.se/stream/s-2') > -1) {
      return { body: '<div data-id="777"></div>' };
    }
    if (u.indexOf('/stream/getSources') > -1) {
      return { body: JSON.stringify({ sources: { file: 'https://cdn.example.com/anime.m3u8' }, tracks: [] }) };
    }
    return { body: '' };
  };

  logs = [];
  console.log = function () { logs.push([].slice.call(arguments).join(' ')); orig.apply(console, arguments); };
  var animeRes = await P.getVideoSources(JSON.stringify({
    imdbId: 'tt1234567', tmdbId: 99999, season: 1, episode: 3, absolute: 3,
    title: 'Test Anime', isAnime: true
  }), { onSubtitle: function () {} });
  console.log = orig;

  ok('anime returned an array', Array.isArray(animeRes));
  ok('anime stream found', animeRes.length >= 1, 'got ' + animeRes.length);
  ok('log shows anime=true', logs.some(function (l) { return /anime=true/.test(l); }), logs.join(' | '));

  global.fetch = originalFetch;

  var tt = pass + fail;
  console.log('\n' + '─'.repeat(60));
  console.log('\x1b[1m' + pass + ' passed, ' + fail + ' failed (' + tt + ')\x1b[0m');
  console.log('─'.repeat(60));
  process.exit(fail ? 1 : 0);
})();