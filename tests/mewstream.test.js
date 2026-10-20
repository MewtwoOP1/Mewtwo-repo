// tests/mewstream.test.js — standalone test suite for providers/mewstream.js
// Run: node tests/mewstream.test.js
// Runs in Node 18+ / Termux without any npm deps.

'use strict';

// ── Node polyfills ──────────────────────────────────────────────────────
if (typeof globalThis.crypto === 'undefined') {
  try { globalThis.crypto = require('crypto').webcrypto; } catch (e) {}
}

// ── Test harness ────────────────────────────────────────────────────────
var passed = 0, failed = 0, skipped = 0;
var failures = [];

function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else      { failed++; failures.push({ name: name, detail: detail });
              console.log('  \x1b[31m✗\x1b[0m ' + name + (detail ? '  — ' + detail : '')); }
}
function skip(name, reason) { skipped++; console.log('  \x1b[33m○\x1b[0m ' + name + '  (skipped: ' + reason + ')'); }
function group(t) { console.log('\n\x1b[36m' + t + '\x1b[0m'); }
function eq(a, b, name) { ok(name || JSON.stringify(a) + ' == ' + JSON.stringify(b), a === b, 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

// ── Load provider ───────────────────────────────────────────────────────
var P;
try {
  P = require('../providers/mewstream.js');
} catch (e) {
  console.error('\x1b[31mFATAL: cannot load provider\x1b[0m — ' + e.message);
  console.error(e.stack);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════
//  1. STATIC / EXPORT SHAPE
// ═══════════════════════════════════════════════════════════════════════
group('1. Exports');

['getInfo', 'getSettings', 'getHome', 'popular', 'search',
 'getDetail', 'getEpisodes', 'getVideoSources', 'getStreams', 'getLinks',
 '_parseStreamId', '_debug', 'version'].forEach(function (fn) {
  ok('export .' + fn + ' exists', P[fn] !== undefined, 'undefined');
});

ok('.getInfo() returns name=Mewstream', P.getInfo().name === 'Mewstream');
ok('.getInfo() returns version=' + P.version, P.getInfo().version === P.version);
ok('.getSettings() is an array', Array.isArray(P.getSettings()));
ok('.getSettings() has 12 keys', P.getSettings().length === 12, 'got ' + P.getSettings().length);

var settingsKeys = P.getSettings().map(function (s) { return s.key; });
['tmdbApiKey','showboxToken','enableAnikoto','enableMegaplay','enableAnimesalt',
 'enableRareanimes','enableShowbox','enableVaplayer','enableVidrock','enableVidzee',
 'enableVidfast','enableHexa'].forEach(function (k) {
  if (k === 'tmdbApiKey' || k === 'showboxToken') {
    ok('setting "' + k + '" present', settingsKeys.indexOf(k) >= 0, settingsKeys.join(','));
  } else {
    ok('setting "' + k + '" present (default true)',
      settingsKeys.indexOf(k) >= 0 &&
      P.getSettings().filter(function (s) { return s.key === k; })[0].default === true,
      'missing or wrong default');
  }
});

ok('_debug has 5 probes', Object.keys(P._debug).length === 5, Object.keys(P._debug).join(','));

// ═══════════════════════════════════════════════════════════════════════
//  2. URL / STREAM-ID PARSING
// ═══════════════════════════════════════════════════════════════════════
group('2. _parseStreamId');

var p1 = P._parseStreamId(JSON.stringify({ imdbId: 'tt1234567', season: 1, episode: 3, title: 'X' }));
eq(p1.imdbId, 'tt1234567', 'imdbId extracted');
eq(p1.season, 1, 'season=1 kept');
eq(p1.episode, 3, 'episode=3 kept');
eq(p1.title, 'X', 'title kept');

var p2 = P._parseStreamId(JSON.stringify({ imdbId: 'tt1234567', season: 0, episode: 0 }));
eq(p2.season, null, 'season=0 normalized to null (movie)');

var p3 = P._parseStreamId('not json');
ok('garbage input returns object with null fields', p3 && p3.imdbId === null && p3.season === null);

var p4 = P._parseStreamId({ imdbId: 'tt9999999', tmdbId: 550, season: 2, episode: 5 });
eq(p4.imdbId, 'tt9999999');
eq(p4.tmdbId, 550);
eq(p4.season, 2);
eq(p4.episode, 5);

// ═══════════════════════════════════════════════════════════════════════
//  3. METADATA / SEARCH (LIVE)
// ═══════════════════════════════════════════════════════════════════════
group('3. Search (live — Cinemeta + Kitsu)');

(async function () {
  var results = [];
  try {
    results = await P.search('Inception');
  } catch (e) {
    ok('search("Inception") does not throw', false, e.message);
    return finish();
  }
  ok('search("Inception") returns an array', Array.isArray(results));
  ok('search("Inception") found at least 1 result', results.length >= 1, 'got ' + results.length);
  if (results.length) {
    var first = results[0];
    ok('result has id', !!first.id);
    ok('result has title', !!first.title);
    ok('result has url', !!first.url);
    ok('result.url starts with tmdb://', String(first.url).indexOf('tmdb://') === 0, first.url);
    ok('result.sourceId = "mewstream"', first.sourceId === 'mewstream');
  }

  // Detail from a real Cinemeta id
  group('4. Detail (live — Cinemeta)');
  var tmdbUrl = 'tmdb://movie/tt1375666';
  var d;
  try {
    d = await P.getDetail(tmdbUrl);
  } catch (e) {
    ok('getDetail(Inception) does not throw', false, e.message);
    return finish();
  }
  ok('getDetail returns object', !!d);
  if (d) {
    ok('title contains "Inception"', /inception/i.test(d.title), d.title);
    ok('has imdbId', !!d.imdbId, d.imdbId);
    ok('episodes array exists', Array.isArray(d.episodes));
    ok('movies have 1 pseudo-episode', d.episodes.length === 1, 'got ' + d.episodes.length);
    if (d.episodes[0]) {
      var ep = d.episodes[0];
      ok('episode has url', !!ep.url);
      var parsedEp = JSON.parse(ep.url);
      ok('episode URL carries imdbId', parsedEp.imdbId === 'tt1375666', parsedEp.imdbId);
    }
  }

  // Kitsu detail (anime)
  group('5. Anime Detail (live — Kitsu + Haglund bridge)');
  var animeDetail;
  try {
    animeDetail = await P.getDetail('tmdb://anime/kitsu-42765'); // Jujutsu Kaisen S1
  } catch (e) {
    ok('anime getDetail does not throw', false, e.message);
  }
  if (animeDetail) {
    ok('anime title present', !!animeDetail.title);
    ok('anime has kitsuId=42765', animeDetail.kitsuId === '42765', animeDetail.kitsuId);
    ok('anime has at least 1 episode', animeDetail.episodes.length >= 1, 'got ' + animeDetail.episodes.length);
    ok('anime episodes have season set', animeDetail.episodes.every(function (ep) { return ep.season >= 1; }));
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  6. LIVE SOURCE PROBES — expect partial success
  // ═══════════════════════════════════════════════════════════════════════
  group('6. Live source probes — AniKoto');
  var animeTitle = (animeDetail && animeDetail.title) || 'Jujutsu Kaisen';
  var epNum = 1;
  try {
    var anikoto = await P._debug.getAnikoto(animeTitle, 1, epNum, function () {});
    if (!anikoto || !anikoto.length) {
      skip('AniKoto streams for "' + animeTitle + '" S1E' + epNum,
           'site returned no streams (may be auth / catalog gap)');
    } else {
      ok('AniKoto streams found', anikoto.length > 0, 'got ' + anikoto.length);
      ok('AniKoto stream[0] has url', !!anikoto[0].url);
      ok('AniKoto stream[0] has label', !!anikoto[0].label);
      ok('AniKoto stream[0] has container', !!anikoto[0].container);
      ok('AniKoto URL is real http(s)',
        /^https?:\/\//.test(anikoto[0].url.split('#')[0]),
        anikoto[0].url.slice(0, 60));
    }
  } catch (e) { ok('AniKoto does not throw', false, e.message); }

  group('7. Live source probes — MegaPlay');
  try {
    var mp = await P._debug.getMegaplay(animeTitle, 1, epNum, function () {});
    if (!mp || !mp.length) skip('MegaPlay streams for "' + animeTitle + '"', 'site returned no streams');
    else {
      ok('MegaPlay streams found', mp.length > 0, 'got ' + mp.length);
      ok('MegaPlay stream[0].url is https', /^https:/.test(mp[0].url), mp[0].url.slice(0, 60));
    }
  } catch (e) { ok('MegaPlay does not throw', false, e.message); }

  group('8. Live source probes — AnimeSalt');
  try {
    var as = await P._debug.getAnimesalt(animeTitle, 1, epNum, function () {});
    if (!as || !as.length) skip('AnimeSalt streams for "' + animeTitle + '"', 'site returned no streams');
    else {
      ok('AnimeSalt streams found', as.length > 0, 'got ' + as.length);
    }
  } catch (e) { ok('AnimeSalt does not throw', false, e.message); }

  group('9. Live source probes — RareAnimes (Hindi-dub classics only)');
  try {
    var ra = await P._debug.getRareanimes('Naruto', 1, 1, function () {});
    if (!ra || !ra.length) skip('RareAnimes streams for "Naruto"', 'catalog miss or no player');
    else {
      ok('RareAnimes streams found', ra.length > 0, 'got ' + ra.length);
    }
  } catch (e) { ok('RareAnimes does not throw', false, e.message); }

  group('10. Live source probes — Showbox (needs token)');
  skip('Showbox', 'requires showboxToken in settings — set __settings.mewstream.showboxToken before running');

  // ═══════════════════════════════════════════════════════════════════════
  //  11. ORCHESTRATOR — metadata path returns diagnostics even with 0 sources
  // ═══════════════════════════════════════════════════════════════════════
  group('11. Orchestrator — getVideoSources on a movie');

  var originalLog = console.log;
  var logs = [];
  console.log = function () { logs.push(Array.prototype.slice.call(arguments).join(' ')); originalLog.apply(console, arguments); };

  var movieStreams;
  try {
    movieStreams = await P.getVideoSources(
      JSON.stringify({ imdbId: 'tt1375666', tmdbId: 27205, season: 0, episode: 0, title: 'Inception' }),
      { onSubtitle: function () {} }
    );
  } catch (e) {
    console.log = originalLog;
    ok('getVideoSources does not throw', false, e.message);
    return finish();
  }
  console.log = originalLog;

  ok('getVideoSources returns an array', Array.isArray(movieStreams));
  var sawDone = logs.some(function (l) { return /Mewstream DONE:/.test(l); });
  var sawZero = logs.some(function (l) { return /Mewstream: 0 streams —/.test(l); });
  ok('orchestrator logged DONE or 0-streams diagnostic', sawDone || sawZero,
    sawDone ? 'DONE' : (sawZero ? '0-streams diag' : 'neither (silent failure)'));

  if (movieStreams.length) {
    ok('every stream has url', movieStreams.every(function (s) { return typeof s.url === 'string' && s.url.length > 0; }));
    ok('every stream has label', movieStreams.every(function (s) { return !!s.label; }));
    ok('no duplicate urls', new Set(movieStreams.map(function (s) { return s.url; })).size === movieStreams.length);
  } else {
    skip('movie stream shape checks', 'no sources returned for Inception on this network');
  }

  finish();

  // ═══════════════════════════════════════════════════════════════════════
  function finish() {
    var total = passed + failed + skipped;
    console.log('\n' + '─'.repeat(60));
    console.log('\x1b[1mResults:\x1b[0m ' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped (' + total + ' total)');
    if (failed) {
      console.log('\n\x1b[31mFailures:\x1b[0m');
      failures.forEach(function (f) { console.log('  • ' + f.name + (f.detail ? '  — ' + f.detail : '')); });
    }
    console.log('─'.repeat(60) + '\n');
    process.exit(failed ? 1 : 0);
  }
})();
