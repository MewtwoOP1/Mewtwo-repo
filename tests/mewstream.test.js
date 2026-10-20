// tests/mewstream.test.js — v2.0.0
// Verifies: exports, settings, classifier gate, title guard, orchestrator diagnostics.
// Network-dependent assertions skip gracefully (CI runners are blocked by Cinemeta).
'use strict';
if (typeof globalThis.crypto === 'undefined') { try { globalThis.crypto = require('crypto').webcrypto; } catch (e) {} }
var P = require('../providers/mewstream.js');

var pass = 0, fail = 0, skip = 0, failures = [];
function ok(n, c, d) {
  if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); }
  else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  \x1b[31m✗\x1b[0m ' + n + (d ? '  — ' + d : '')); }
}
function skipT(n, r) { skip++; console.log('  \x1b[33m○\x1b[0m ' + n + '  (' + r + ')'); }
function g(t) { console.log('\n\x1b[36m' + t + '\x1b[0m'); }

(async function () {

  g('1. Exports and settings');
  ['getInfo','getSettings','getHome','popular','search','getDetail','getEpisodes',
   'getVideoSources','getStreams','getLinks','_parseStreamId','_debug','version']
    .forEach(function (k) { ok('export .' + k, P[k] !== undefined); });
  ok('version is 2.0.2', P.version === '2.0.2', P.version);
  ok('getSettings() has 17 settings', P.getSettings().length === 17, String(P.getSettings().length));
  ok('getInfo().name = Mewstream', P.getInfo().name === 'Mewstream');
  ok('_debug has 13 probes', Object.keys(P._debug).length === 13, Object.keys(P._debug).join(','));

  ['getMegaplayDirect','getAnikoto','getAnizone','getAnimesalt','getRareanimes',
   'getShowbox','getVidsrc','getVidcore','getMoviesapi','getVidnest',
   'classify','titleOk','sim']
    .forEach(function (k) { ok('_debug.' + k + ' exists', typeof P._debug[k] === 'function'); });

  var settingKeys = P.getSettings().map(function (s) { return s.key; });
  ['tmdbApiKey','showboxToken','enableMegaplayDirect','enableAnikoto','enableAnizone',
   'enableAnimesalt','enableRareanimes','enableShowbox','enableVaplayer','enableVidrock',
   'enableVidzee','enableVidfast','enableHexa','enableVidsrc','enableVidcore',
   'enableMoviesapi','enableVidnest']
    .forEach(function (k) { ok('setting "' + k + '" present', settingKeys.indexOf(k) >= 0, settingKeys.join(',')); });

  g('2. Classifier — anime must not leak into film/TV');
  var C = P._debug.classify;
  [
    { name: 'Inception (film)', m: { genres: ['Action','Thriller'], originCountry: ['US'], originalLanguage: 'en', isSeries: false }, want: false },
    { name: 'Breaking Bad (series)', m: { genres: ['Drama','Crime'], originCountry: ['US'], originalLanguage: 'en', isSeries: true }, want: false },
    { name: 'Toy Story (US animation)', m: { genres: ['Animation','Family'], originCountry: ['US'], originalLanguage: 'en', isSeries: false }, want: false },
    { name: 'Arcane (FR/US animation)', m: { genres: ['Animation','Sci-Fi'], originCountry: ['FR','US'], originalLanguage: 'en', isSeries: true }, want: false },
    { name: 'Jujutsu Kaisen (kitsu)', m: { kitsuId: '42765', genres: [], originCountry: [], originalLanguage: '', isSeries: true }, want: true },
    { name: 'Demon Slayer (TMDB JP)', m: { genres: ['Animation','Action'], originCountry: ['JP'], originalLanguage: 'ja', isSeries: true }, want: true },
    { name: 'Spirited Away', m: { genres: ['Animation','Fantasy'], originCountry: ['JP'], originalLanguage: 'ja', isSeries: false }, want: true },
    { name: 'Planet Earth (doc)', m: { genres: ['Documentary'], originCountry: ['GB'], originalLanguage: 'en', isSeries: true }, want: false }
  ].forEach(function (c) {
    var r = C(c.m);
    ok(c.name + ' → ' + (c.want ? 'anime' : 'not anime'), r.isAnime === c.want, 'score=' + r.score + ' reason=' + r.reason);
  });

  g('3. Title guard');
  ok('exact match accepted', P._debug.titleOk('Jujutsu Kaisen', 'Jujutsu Kaisen'));
  ok('season suffix accepted', P._debug.titleOk('Jujutsu Kaisen', 'Jujutsu Kaisen Season 2'));
  ok('unrelated title rejected', !P._debug.titleOk('Inception', 'Inception: The Animation'));
  ok('prefix collision rejected', !P._debug.titleOk('Naruto', 'Naruto Shippuden'));
  ok('normalised match accepted', P._debug.titleOk('Attack on Titan', 'attack-on-titan'));

  g('4. _parseStreamId');
  var p = P._parseStreamId(JSON.stringify({ imdbId: 'tt1375666', tmdbId: 27205, season: 0, episode: 0, isAnime: false }));
  ok('season 0 → null', p.season === null);
  ok('isAnime false preserved', p.isAnime === false);
  var p2 = P._parseStreamId(JSON.stringify({ tmdbId: 95479, season: 1, episode: 3, isAnime: true }));
  ok('isAnime true preserved', p2.isAnime === true);
  ok('episode parsed', p2.episode === 3);

  g('5. Classifier gate — verified via orchestrator logs');
  var logs = [], orig = console.log;
  console.log = function () { logs.push([].slice.call(arguments).join(' ')); orig.apply(console, arguments); };

  // Film: classifier must yield anime=false and skip anime sources
  logs = [];
  try {
    await P.getVideoSources(
      JSON.stringify({ imdbId: 'tt1375666', tmdbId: 27205, season: null, episode: 0, title: 'Inception', isAnime: false }),
      { onSubtitle: function () {} }
    );
  } catch (e) {}

  var filmLog = logs.filter(function (l) { return /Mewstream/i.test(l); }).join(' | ');
  ok('Inception classifier yields anime=false', logs.some(function (l) { return /anime=false/.test(l); }), filmLog);
  ok('Inception: anime sources skipped', logs.some(function (l) { return /anime-sources:skipped/.test(l); }), filmLog);
  ok('Inception: no anime source attempted',
    !logs.some(function (l) { return /AniKoto|AniZone|AnimeSalt|RareAnimes|MegaPlay-Direct/.test(l); }),
    filmLog);

  // Anime: classifier must yield anime=true
  logs = [];
  try {
    await P.getVideoSources(
      JSON.stringify({ tmdbId: 95479, malId: 52299, anilistId: 151807, season: 1, episode: 3, title: 'Jujutsu Kaisen', isAnime: true }),
      { onSubtitle: function () {} }
    );
  } catch (e) {}

  var animeLog = logs.filter(function (l) { return /Mewstream/i.test(l); }).join(' | ');
  ok('Jujutsu Kaisen classifier yields anime=true', logs.some(function (l) { return /anime=true/.test(l); }), animeLog);

  console.log = orig;

  g('6. Live metadata (skipped if Cinemeta unreachable from CI)');
  var film;
  try { film = await P.getDetail('tmdb://movie/tt1375666'); } catch (e) {}
  if (film) {
    ok('Inception type = movie', film.type === 'movie', film.type);
    ok('Inception isAnime = false', film.isAnime === false);
    ok('Inception has 1 episode slot', film.episodes.length === 1);
  } else skipT('film detail', 'Cinemeta blocked from CI runner');

  var anime;
  try { anime = await P.getDetail('tmdb://anime/kitsu-42765'); } catch (e) {}
  if (anime) {
    ok('Jujutsu Kaisen type = anime', anime.type === 'anime', anime.type);
    ok('Jujutsu Kaisen isAnime = true', anime.isAnime === true);
    ok('has kitsuId 42765', anime.kitsuId === '42765');
  } else skipT('anime detail', 'Kitsu blocked from CI runner');

  g('7. Search (skipped if Cinemeta unreachable from CI)');
  var results;
  try { results = await P.search('Inception'); } catch (e) {}
  if (results && results.length) {
    ok('search("Inception") found at least 1 result', results.length >= 1, 'got ' + results.length);
    ok('search result has url', !!results[0].url);
    ok('search result sourceId = mewstream', results[0].sourceId === 'mewstream');
  } else skipT('search("Inception")', 'Cinemeta blocked from CI runner');

  var total = pass + fail + skip;
  console.log('\n' + '─'.repeat(60));
  console.log('\x1b[1m' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped (' + total + ')\x1b[0m');
  if (failures.length) failures.forEach(function (f) { console.log('  • ' + f); });
  console.log('─'.repeat(60));
  process.exit(fail ? 1 : 0);
})();
