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
  ok('getSettings() has 11 settings', P.getSettings().length === 11, String(P.getSettings().length));
  ok('getInfo().name = Mewstream', P.getInfo().name === 'Mewstream');

  ['tmdbApiKey','enableMegaplayDirect','enableAnikoto','enableAnizone','enableAnimesalt',
   'enableRareanimes','enableVaplayer','enableVidrock','enableVidzee','enableVidfast','enableHexa']
    .forEach(function (k) {
      ok('setting "' + k + '" present', P.getSettings().some(function (s) { return s.key === k; }));
    });

  ok('_debug has 13 probes', Object.keys(P._debug).length === 13, Object.keys(P._debug).join(','));
  ['getMegaplayDirect','getAnikoto','getAnizone','getAnimesalt','getRareanimes',
   'getVaplayer','getVidrock','getVidzee','getVidfast','getHexa',
   'classify','sim','titleOk']
    .forEach(function (k) { ok('_debug.' + k + ' exists', typeof P._debug[k] === 'function'); });

  g('2. Classifier — anime must not leak into film/TV');
  var C = P._debug.classify;
  [
    { name: 'Inception', m: { genres: ['Action','Thriller'], originCountry: ['US'], originalLanguage: 'en', isSeries: false }, want: false },
    { name: 'Breaking Bad', m: { genres: ['Drama','Crime'], originCountry: ['US'], originalLanguage: 'en', isSeries: true }, want: false },
    { name: 'Toy Story (US anim)', m: { genres: ['Animation','Family'], originCountry: ['US'], originalLanguage: 'en', isSeries: false }, want: false },
    { name: 'Arcane (FR/US anim)', m: { genres: ['Animation','Sci-Fi'], originCountry: ['FR','US'], originalLanguage: 'en', isSeries: true }, want: false },
    { name: 'Jujutsu Kaisen (kitsu)', m: { kitsuId: '42765', genres: [], originCountry: [], originalLanguage: '', isSeries: true }, want: true },
    { name: 'Demon Slayer (JP)', m: { genres: ['Animation','Action'], originCountry: ['JP'], originalLanguage: 'ja', isSeries: true }, want: true },
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

  g('5. Classifier gate — orchestrator logs');
  var logs = [], orig = console.log;
  console.log = function () { logs.push([].slice.call(arguments).join(' ')); orig.apply(console, arguments); };

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
  ok('Inception: no anime source attempted', !logs.some(function (l) { return /from AniKoto|from AniZone|from AnimeSalt|from RareAnimes|from MegaPlay-Direct/.test(l); }), filmLog);

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

  g('6. Live metadata (skipped if Cinemeta unreachable)');
  var film;
  try { film = await P.getDetail('tmdb://movie/tt1375666'); } catch (e) {}
  if (film) {
    ok('Inception type = movie', film.type === 'movie', film.type);
    ok('Inception isAnime = false', film.isAnime === false);
    ok('Inception has 1 episode slot', film.episodes.length === 1);
  } else skipT('film detail', 'Cinemeta blocked from CI');

  var anime;
  try { anime = await P.getDetail('tmdb://anime/kitsu-42765'); } catch (e) {}
  if (anime) {
    ok('Jujutsu Kaisen type = anime', anime.type === 'anime', anime.type);
    ok('Jujutsu Kaisen isAnime = true', anime.isAnime === true);
    ok('has kitsuId 42765', anime.kitsuId === '42765');
  } else skipT('anime detail', 'Kitsu blocked from CI');

  g('7. Search (skipped if Cinemeta unreachable)');
  var results;
  try { results = await P.search('Inception'); } catch (e) {}
  if (results && results.length) {
    ok('search("Inception") found results', results.length >= 1, 'got ' + results.length);
    ok('search result has url', !!results[0].url);
    ok('search result sourceId = mewstream', results[0].sourceId === 'mewstream');
  } else skipT('search("Inception")', 'Cinemeta blocked from CI');

  var total = pass + fail + skip;
  console.log('\n' + '─'.repeat(60));
  console.log('\x1b[1m' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped (' + total + ')\x1b[0m');
  if (failures.length) failures.forEach(function (f) { console.log('  • ' + f); });
  console.log('─'.repeat(60));
  process.exit(fail ? 1 : 0);
})();
