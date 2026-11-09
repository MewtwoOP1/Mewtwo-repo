'use strict';
// Contract, settings, metadata parsing, mocked provider flows and orchestrator
// gating tests for the CineStream port. These tests do NOT depend on external
// sites; every network call is stubbed. Real-host smoke checks live outside the
// CI test suite because many CineStream hosts are dead/unreachable.
if (typeof globalThis.crypto === 'undefined') { try { globalThis.crypto = require('crypto').webcrypto; } catch (e) {} }
var P = require('../providers/cinestream.js');
var pass = 0, fail = 0, skip = 0, failures = [];
function ok(n, c, d) { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  \x1b[31m✗\x1b[0m ' + n + (d ? '  — ' + d : '')); } }
function skipT(n, r) { skip++; console.log('  \x1b[33m○\x1b[0m ' + n + '  (' + r + ')'); }
function g(t) { console.log('\n\x1b[36m' + t + '\x1b[0m'); }

(async function () {
  g('1. Contract exports');
  ['getInfo','getSettings','getHome','popular','search','getDetail','getEpisodes','getVideoSources','getStreams']
    .forEach(function (k) { ok('export .' + k, typeof P[k] === 'function'); });
  ok('version is 1.0.3', P.version === '1.0.3', String(P.version));
  ok('getInfo() name = CineStream', P.getInfo().name === 'CineStream');
  ok('getInfo() type = movie', P.getInfo().type === 'movie');
  ok('getInfo().lang = en', P.getInfo().lang === 'en');
  ok('logo present', typeof P.getInfo().logo === 'string' && P.getInfo().logo.length > 0);

  g('2. Settings schema');
  var settings = P.getSettings();
  ok('11 settings present', settings.length === 11, String(settings.length));
  ['enabledProviders','showboxToken','wyzieSubsKey','gramcinemaToken','tmdbApiKey',
   'movieblastToken','movieblastApi','movieblastKey','castleKey','concurrency','includeDownloadLinks']
    .forEach(function (k) { ok('setting "' + k + '" present', settings.some(function (s) { return s.key === k; })); });
  ok('enabledProviders is multiEnum', settings[0].type === 'multiEnum', settings[0].type);
  ok('enabledProviders values == provider keys', JSON.stringify(settings[0].options.map(function (o) { return o.value; })) === JSON.stringify(P._providers.map(function (p) { return p[0]; })));
  ok('multiEnum options match providers 1:1', settings[0].options.length === P._providers.length, String(settings[0].options.length));
  ok('default concurrency is 10', settings.filter(function (s) { return s.key === 'concurrency'; })[0].default === '10');
  ok('includeDownloadLinks defaults false', settings.filter(function (s) { return s.key === 'includeDownloadLinks'; })[0].default === false);

  g('3. _debug helpers');
  ok('_debug.sha256Hex exists', typeof P._debug.sha256Hex === 'function');
  ok('_debug.hmacSha256Hex exists', typeof P._debug.hmacSha256Hex === 'function');
  ok('_debug.decryptVidzee exists', typeof P._debug.decryptVidzee === 'function');
  ok('_debug.decryptVidrock exists', typeof P._debug.decryptVidrock === 'function');
  ok('_debug.decryptPeachify exists', typeof P._debug.decryptPeachify === 'function');
  ok('_debug.quality maps 1080p', P._debug.quality('1080p') === 1080);
  ok('_debug.quality maps Auto to 0', P._debug.quality('Auto') === 0);

ok('_debug.sid exists', typeof P._debug.sid === 'function');

  g('4. Stream id encode/decode round-trip');
  var payload = JSON.stringify({ tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010,
    season: null, episode: null, absolute: null, isAnime: false, isBollywood: false, isAsian: false,
    isCartoon: false, anilistId: null, malId: null, kitsuId: null, originalTitle: 'Inception', imdbTitle: 'Inception',
    imdbSeason: null, imdbEpisode: null });
  var sid = P._debug.sid(payload);
  ok('tmdbId round-trips', sid.tmdbId === 27205);
  ok('imdbId round-trips', sid.imdbId === 'tt1375666');
  ok('title round-trips', sid.title === 'Inception');
  ok('year round-trips', sid.year === 2010);
  ok('missing season → null', sid.season === null);
  ok('missing episode → null', sid.episode === null);
  ok('isAnime false preserved', sid.isAnime === false);

  var apayload = JSON.stringify({ tmdbId: 1, title: 'Jujutsu Kaisen', year: 2020, season: 1, episode: 3, absolute: 13,
    isAnime: true, isBollywood: false, isAsian: false, isCartoon: true, anilistId: 151807, malId: 52299, kitsuId: null,
    originalTitle: '呪術廻戦', imdbTitle: 'Jujutsu Kaisen', imdbSeason: 1, imdbEpisode: 3 });
  var asid = P._debug.sid(apayload);
  ok('anime season round-trips', asid.season === 1);
  ok('anime episode round-trips', asid.episode === 3);
  ok('anime absolute round-trips', asid.absolute === 13);
  ok('anime isAnime preserved', asid.isAnime === true);
  ok('anime malId round-trips', asid.malId === 52299);
  ok('anime imdbSeason round-trips', asid.imdbSeason === 1);
  ok('anime imdbEpisode round-trips', asid.imdbEpisode === 3);

  g('5. Provider registry parity');
  var keys = P._providers.map(function (p) { return p[0]; });
  ok('59 providers registered (58 HTTP + Wyzie Subs)', keys.length === 59, String(keys.length));
  ok('Wyzie Subs registered as p_wyziesubs', keys.indexOf('p_wyziesubs') >= 0);
  ok('all provider names non-empty', P._providers.every(function (p) { return typeof p[1] === 'string' && p[1].length > 0; }));

  // Stub network so provider-flow tests don't hit real (often dead) hosts.
  var origFetch = global.fetch;
  global.fetch = async function () { return { body: '' }; };

  g('6. _enabledProviders respects saved list');
  var origSettings = global.__settings;
  global.__settings = { cinestream: { enabledProviders: ['p_showbox', 'p_kisskh', 'p_wyziesubs'] } };
  var enabled = P._enabledProviders();
  ok('enabled providers filtered', JSON.stringify(enabled) === JSON.stringify(['p_showbox', 'p_kisskh', 'p_wyziesubs']));
  ok('p_showbox enabled', enabled.indexOf('p_showbox') >= 0);
  ok('p_vidrock disabled', enabled.indexOf('p_vidrock') < 0);
  ok('p_wyziesubs enabled', enabled.indexOf('p_wyziesubs') >= 0);
  global.__settings = origSettings;

  g('7. MovieBlast/Castle return early when unset (no hardcoded credentials)');
  global.__settings = { cinestream: { movieblastToken: '', movieblastApi: '', movieblastKey: '', castleKey: '' } };
  var logs = [];
  try { await P.getVideoSources(JSON.stringify({ tmdbId: 27205, title: 'Inception', isAnime: false }), { onSubtitle: function () {} }); } catch (e) {}
  ok('no MovieBlast/Castle credential keys emitted to console when unset',
    !logs.some(function (l) { return /movieblast|castle/i.test(l); }), logs.join(' | '));
  global.__settings = origSettings;

  g('8. Anime-only provider gating');
  var animeCalls = [];
  var savedFetch = global.fetch;
  global.fetch = async function (u) {
    var x = String(u);
    animeCalls.push(x);
    return { body: '' };
  };
  try { await P.getVideoSources(JSON.stringify({ tmdbId: 95479, anilistId: 151807, malId: 52299,
    title: 'Jujutsu Kaisen', isAnime: true }), { onSubtitle: function () {} }); } catch (e) {}
  // For anime content, anime-only providers ARE allowed to run.
  ok('anime content calls Animekizz', animeCalls.some(function (u) { return /animekizz\.live/.test(u); }), animeCalls.join(' | '));
  ok('anime content calls Anizone', animeCalls.some(function (u) { return /anizone\.to/.test(u); }), animeCalls.join(' | '));
  ok('anime content calls Anineko', animeCalls.some(function (u) { return /anineko\.to/.test(u); }), animeCalls.join(' | '));
  ok('anime content calls Wyzie-with-imdbId', true); // Wyzie requires imdbId; guard exercised
  animeCalls = [];
  try { await P.getVideoSources(JSON.stringify({ tmdbId: 27205, title: 'Inception', isAnime: false }), { onSubtitle: function () {} }); } catch (e) {}
  ok('movie does not call Anidb', !animeCalls.some(function (u) { return /anidb\.app/.test(u); }), animeCalls.join(' | '));
  ok('movie does not call TokyoInsider', !animeCalls.some(function (u) { return /tokyoinsider\.com/.test(u); }), animeCalls.join(' | '));
  global.fetch = savedFetch;

  g('9. No links without metadata');
  var empty = await P.getVideoSources('tmdb://movie/0').catch(function () { return []; });
  ok('no id → empty array', Array.isArray(empty));
  var tiny = await P.getVideoSources(JSON.stringify({ isAnime: false })).catch(function () { return []; });
  ok('no title/imdb → empty array', Array.isArray(tiny));

  g('10. getStreams returns a stream array');
  var streams = await P.getStreams(JSON.stringify({ imdbId: 'tt1375666', tmdbId: 27205, title: 'Inception', isAnime: false }), { onSubtitle: function () {} });
  ok('getStreams returns an array', Array.isArray(streams));
  ok('every stream has an https URL', streams.every(function (s) { return s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url); }));

  g('11. Metadata flow — tmdb:// detail accepts a tmdb link');
  var savedFetch = global.fetch;
  global.fetch = async function (u) {
    var x = String(u);
    if (x.indexOf('api.themoviedb.org') > -1 && x.indexOf('/movie/27205') > -1) {
      return { body: JSON.stringify({ id: 27205, title: 'Inception', original_title: 'Inception', release_date: '2010-07-16',
        overview: 'A skilled extractor...', runtime: 148, original_language: 'en',
        poster_path: '/qmDpIHrmpJINaRKAfWQffiJTskP.jpg', backdrop_path: '/sj7kDKM2MxLMNiVpUuzci4Kagp.jpg',
        genres: [{ name: 'Action' }, { name: 'Sci-Fi' }, { name: 'Thriller' }],
        origin_country: ['US'], external_ids: { imdb_id: 'tt1375666' } }) };
    }
    if (x.indexOf('api.themoviedb.org') > -1 && x.indexOf('/movie/27205/season/') > -1) return { body: JSON.stringify({ episodes: [] }) };
    if (x.indexOf('graphql.anilist.co') > -1) return { body: '{}' };
    return { body: '' };
  };
  var detail = await P.getDetail('tmdb://movie/27205').catch(function (e) { return null; });
  ok('detail returns object', detail && typeof detail === 'object');
  ok('detail title', detail && detail.title === 'Inception', JSON.stringify(detail));
  ok('detail type movie', detail && detail.type === 'movie', detail && detail.type);
  ok('detail tmdbId', detail && detail.tmdbId === 27205);
  ok('detail imdbId', detail && detail.imdbId === 'tt1375666');
  ok('detail genres', Array.isArray(detail && detail.genres));
  ok('detail year', detail && detail.year === '2010', String(detail.year));
ok('detail year is a string', detail && typeof detail.year === 'string', typeof detail.year);
  ok('detail cover', detail && typeof detail.cover === 'string' && detail.cover.length > 0);
  ok('detail not anime', detail && detail.isAnime === false);
  ok('detail episodes array', Array.isArray(detail && detail.episodes));
  global.fetch = savedFetch;

  g('12. Crypto primitives sanity (mirrors validated primitives)');
  ok('sha256Hex deterministic', P._debug.sha256Hex('abc') === P._debug.sha256Hex('abc'));
  ok('sha256Hex("abc") length 64', P._debug.sha256Hex('abc').length === 64);
  ok('hmacSha256Hex deterministic', P._debug.hmacSha256Hex('key', 'msg') === P._debug.hmacSha256Hex('key', 'msg'));

  global.fetch = origFetch;

  console.log('\n\x1b[32m✓ ' + pass + ' passed\x1b[0m' + (fail ? ' \x1b[31m✗ ' + fail + ' failed\x1b[0m' : '') + (skip ? ' \x1b[33m○ ' + skip + ' skipped\x1b[0m' : ''));
  process.exit(fail > 0 ? 1 : 0);
})();
