'use strict';
if (typeof globalThis.crypto === 'undefined') { try { globalThis.crypto = require('crypto').webcrypto; } catch (e) {} }
var P = require('../providers/mewstream.js');
var pass = 0, fail = 0, skip = 0, failures = [];
function ok(n, c, d) { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  \x1b[31m✗\x1b[0m ' + n + (d ? '  — ' + d : '')); } }
function skipT(n, r) { skip++; console.log('  \x1b[33m○\x1b[0m ' + n + '  (' + r + ')'); }
function g(t) { console.log('\n\x1b[36m' + t + '\x1b[0m'); }

(async function () {
  g('1. Exports');
  ['getInfo','getSettings','getHome','popular','search','getDetail','getEpisodes','getVideoSources','getStreams','getLinks','_parseStreamId','_debug']
    .forEach(function (k) { ok('export .' + k, P[k] !== undefined); });
  ok('getSettings() has 17 settings', P.getSettings().length === 17, String(P.getSettings().length));
  ok('getInfo().name = Mewstream', P.getInfo().name === 'Mewstream');
  ['tmdbApiKey','showboxToken','enableMegaplayDirect','enableAnikoto','enableAnizone','enableAnimesalt','enableRareanimes','enableShowbox','enableVaplayer','enableVidrock','enableVidzee','enableVidfast','enableHexa','enableVidsrc','enableVidcore','enableMoviesapi','enableVidnest']
    .forEach(function (k) { ok('setting "' + k + '" present', P.getSettings().some(function (s) { return s.key === k; })); });
  ['classify','sim','titleOk','getMegaplayDirect','getAnikoto','getAnizone','getAnimesalt','getRareanimes','getShowbox','getVaplayer','getVidrock','getVidzee','getVidfast','getHexa','getVidsrc','getVidcore','getVidup','getMoviesapi','getVidnest']
    .forEach(function (k) { ok('_debug.' + k + ' exists', typeof P._debug[k] === 'function'); });

  g('2. Classifier');
  var C = P._debug.classify;
  [
    { name: 'Inception', m: { genres: ['Action','Thriller'], originCountry: ['US'], originalLanguage: 'en', isSeries: false }, want: false },
    { name: 'Breaking Bad', m: { genres: ['Drama','Crime'], originCountry: ['US'], originalLanguage: 'en', isSeries: true }, want: false },
    { name: 'Toy Story', m: { genres: ['Animation','Family'], originCountry: ['US'], originalLanguage: 'en', isSeries: false }, want: false },
    { name: 'Arcane', m: { genres: ['Animation','Sci-Fi'], originCountry: ['FR','US'], originalLanguage: 'en', isSeries: true }, want: false },
    { name: 'Jujutsu Kaisen', m: { kitsuId: '42765', genres: [], originCountry: [], originalLanguage: '', isSeries: true }, want: true },
    { name: 'Demon Slayer', m: { genres: ['Animation','Action'], originCountry: ['JP'], originalLanguage: 'ja', isSeries: true }, want: true },
    { name: 'Spirited Away', m: { genres: ['Animation','Fantasy'], originCountry: ['JP'], originalLanguage: 'ja', isSeries: false }, want: true },
    { name: 'Planet Earth', m: { genres: ['Documentary'], originCountry: ['GB'], originalLanguage: 'en', isSeries: true }, want: false }
  ].forEach(function (c) { var r = C(c.m); ok(c.name + ' → ' + (c.want ? 'anime' : 'not anime'), r.isAnime === c.want, 'score=' + r.score + ' reason=' + r.reason); });

  g('3. Title guard');
  ok('exact match', P._debug.titleOk('Jujutsu Kaisen', 'Jujutsu Kaisen'));
  ok('season suffix', P._debug.titleOk('Jujutsu Kaisen', 'Jujutsu Kaisen Season 2'));
  ok('unrelated rejected', !P._debug.titleOk('Inception', 'Inception: The Animation'));
  ok('prefix collision rejected', !P._debug.titleOk('Naruto', 'Naruto Shippuden'));
  ok('normalised match', P._debug.titleOk('Attack on Titan', 'attack-on-titan'));

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
  try { await P.getVideoSources(JSON.stringify({ imdbId: 'tt1375666', tmdbId: 27205, season: null, episode: 0, title: 'Inception', isAnime: false }), { onSubtitle: function () {} }); } catch (e) {}
  var fl = logs.filter(function (l) { return /Mewstream/i.test(l); }).join(' | ');
  ok('Inception anime=false', logs.some(function (l) { return /anime=false/.test(l); }), fl);
  ok('Inception anime skipped', logs.some(function (l) { return /anime-sources:skipped/.test(l); }), fl);
  ok('Inception no anime attempted', !logs.some(function (l) { return /from AniKoto|from AniZone|from AnimeSalt|from RareAnimes|from MegaPlay-Direct/.test(l); }), fl);
  logs = [];
  try { await P.getVideoSources(JSON.stringify({ tmdbId: 95479, malId: 52299, anilistId: 151807, season: 1, episode: 3, title: 'Jujutsu Kaisen', isAnime: true }), { onSubtitle: function () {} }); } catch (e) {}
  var al = logs.filter(function (l) { return /Mewstream/i.test(l); }).join(' | ');
  ok('Jujutsu Kaisen anime=true', logs.some(function (l) { return /anime=true/.test(l); }), al);
  console.log = orig;

  g('6. Live metadata (skipped if unreachable)');
  var f;
  try { f = await P.getDetail('tmdb://movie/tt1375666'); } catch (e) {}
  if (f) { ok('Inception type=movie', f.type === 'movie', f.type); ok('Inception isAnime=false', f.isAnime === false); ok('Inception 1 slot', f.episodes.length === 1); } else skipT('film detail', 'Cinemeta blocked');
  var a;
  try { a = await P.getDetail('tmdb://anime/kitsu-42765'); } catch (e) {}
  if (a) { ok('Jujutsu Kaisen type=anime', a.type === 'anime', a.type); ok('Jujutsu Kaisen isAnime=true', a.isAnime === true); ok('kitsuId 42765', a.kitsuId === '42765'); } else skipT('anime detail', 'Kitsu blocked');

  g('7. Search (skipped if unreachable)');
  var rs;
  try { rs = await P.search('Inception'); } catch (e) {}
  if (rs && rs.length) { ok('search found results', rs.length >= 1, 'got ' + rs.length); ok('result has url', !!rs[0].url); ok('sourceId=mewstream', rs[0].sourceId === 'mewstream'); } else skipT('search("Inception")', 'Cinemeta blocked');

  var tt = pass + fail + skip;
  console.log('\n' + '─'.repeat(60));
  console.log('\x1b[1m' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped (' + tt + ')\x1b[0m');
  if (failures.length) failures.forEach(function (f) { console.log('  • ' + f); });
  console.log('─'.repeat(60));
  process.exit(fail ? 1 : 0);
})();
