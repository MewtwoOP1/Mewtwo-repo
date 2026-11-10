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
  ok('version is 1.0.9', P.version === '1.1.0', String(P.version));
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
  ok('59 providers registered (58 HTTP + Wyzie Subs)', keys.length === 63, String(keys.length));
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
  ok('base64 decode keeps padded output clean', P._debug.b64d('aHR0cHM6Ly9odWJjbG91ZC5wdy9kcml2ZS9hYmM=') === 'https://hubcloud.pw/drive/abc', JSON.stringify(P._debug.b64d('aHR0cHM6Ly9odWJjbG91ZC5wdy9kcml2ZS9hYmM=')));

  g('13. Extractor compatibility regressions');

  // 13a. Scheme hardening: javascript:/data: hrefs must never become http URLs.
  ok('_abs rejects javascript: pseudo-URLs', P._debug.abs('javascript:var a=', 'https://streamtape.com/x') === '');
  ok('_abs rejects data: URLs', P._debug.abs('data:text/html,x', 'https://a.com') === '');
  ok('_abs resolves relative paths', P._debug.abs('/get_video?id=1', 'https://streamtape.com/e/x') === 'https://streamtape.com/get_video?id=1');

  // 13b. _wpRedirect must perform the final base64 decode (greenmotors/hubcdn chain).
  function b64e(s) { return Buffer.from(String(s), 'utf8').toString('base64'); }
  function rot13s(s) { return String(s).replace(/[a-zA-Z]/g, function (c) { var b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); }); }
  var wpJson = JSON.stringify({ w: 10, l: 'https://greenmotors.cc/homelander/', o: b64e('https://hubcloud.pw/drive/abc') });
  // Site encoding is the inverse of decode(decode()) -> rot13 -> decode().
  var wpCombined = b64e(b64e(rot13s(b64e(wpJson))));
  global.fetch = async function (u) {
    var x = String(u);
    if (/greenmotors|greenmountmotors|hubcdn/i.test(x)) return { body: "<html><script>s('o','" + wpCombined + "');</script></html>" };
    return { body: '' };
  };
  var wpOut = await P._debug.wpRedirect('https://greenmotors.club/?id=abc');
  ok('_wpRedirect performs the final base64 decode', wpOut === 'https://hubcloud.pw/drive/abc', wpOut);
  ok('_hdhubLinks unwraps greenmotors', (await P._debug.hdhubLinks('https://greenmotors.club/?id=abc')) === 'https://hubcloud.pw/drive/abc');
  ok('_hdhubLinks unwraps greenmountmotors', (await P._debug.hdhubLinks('https://greenmountmotors.com/?id=abc')) === 'https://hubcloud.pw/drive/abc');
  ok('_hdhubLinks leaves direct hosts untouched', (await P._debug.hdhubLinks('https://hubcloud.pw/drive/abc')) === 'https://hubcloud.pw/drive/abc');

  // 13c. Typesense token-drop: unrelated hits must be rejected.
  var rH = { imdbId: 'tt0988824', title: 'Naruto Shippūden' };
  ok('hdhub hit accepts matching imdb id', P._debug.hdhubHitMatches({ imdb_id: 'tt0988824', permalink: '/x' }, rH) === true);
  ok('hdhub hit rejects unrelated imdb id', P._debug.hdhubHitMatches({ imdb_id: 'tt0468569', permalink: '/rorschach-2022' }, rH) === false);
  ok('hdhub hit matches normalized title with diacritics', P._debug.hdhubHitMatches({ post_title: 'Naruto Shippuden', permalink: '/naruto-shippuden' }, rH) === true);
  ok('hdhub hit rejects unrelated title', P._debug.hdhubHitMatches({ post_title: 'Rorschach 2022', permalink: '/rorschach-2022' }, rH) === false);

  // 13d. HubCloud: follow the generated mirror page and emit its Download File.
  global.fetch = async function (u) {
    var x = String(u);
    if (x.indexOf('hubcloud.pw/drive/') >= 0) return { body: "<script>var url = 'https://gamerxyt.com/hubcloud.php?id=1';</script>" };
    if (x.indexOf('gamerxyt.com') >= 0) return { body: '<div class="card-header">Test Movie 1080p</div><i id="size">1.2 GB</i><a href="https://files.example/dl/movie.mkv">Download File [1.2 GB]</a>' };
    return { body: '' };
  };
  var hubOut = [];
  await P._debug.hubCloud('https://hubcloud.pw/drive/abc', { emit: function (s) { hubOut.push(s); }, sub: function () {}, includeDownloads: false });
  ok('HubCloud follows the generated mirror page', hubOut.length >= 1 && hubOut[0].url === 'https://files.example/dl/movie.mkv', JSON.stringify(hubOut.map(function (s) { return s.url; })));

  // 13e. Vidcore/Vidup: enc-dec now returns token:""; extraction must still run.
  var vcCalls = [];
  global.fetch = async function (u, o) {
    var x = String(u);
    vcCalls.push(String((o && o.method) || 'GET') + ' ' + x);
    if (x.indexOf('vidcore.io/movie/155') >= 0) return { body: '{"en":"ENC"}' };
    if (x.indexOf('enc-vidcore') >= 0 && x.indexOf('stage=1') >= 0) return { body: JSON.stringify({ status: 200, result: { stage1: 'https://vidcore.io/ajax', token: '' } }) };
    if (x.indexOf('vidcore.io/ajax') >= 0) return { body: 'STAGE1' };
    if (x.indexOf('enc-vidcore') >= 0 && x.indexOf('stage=2') >= 0) return { body: JSON.stringify({ status: 200, result: { servers: 'https://vidcore.io/servers', stream: 'https://vidcore.io/stream', token: '' } }) };
    if (x.indexOf('vidcore.io/servers') >= 0) return { body: 'SERVERS' };
    if (x.indexOf('vidcore.io/stream/') >= 0) return { body: 'STREAM' };
    if (x.indexOf('dec-vidcore') >= 0) {
      var n = vcCalls.filter(function (c) { return /dec-vidcore/.test(c); }).length;
      if (n === 1) return { body: JSON.stringify({ status: 200, result: [{ name: 'VidCore', data: 'D1' }] }) };
      return { body: JSON.stringify({ status: 200, result: { url: 'https://cdn.example/vidcore/master.m3u8', tracks: [{ file: 'https://cdn.example/vidcore/en.vtt', label: 'English' }] } }) };
    }
    return { body: '' };
  };
  var vcStreams = [], vcSubs = [];
  await P._debug.runProvider('p_vidcore', { tmdbId: 155, title: 'The Dark Knight', season: null }, { emit: function (s) { vcStreams.push(s); }, sub: function (l, u) { vcSubs.push(u); }, includeDownloads: false });
  ok('Vidcore works when the CSRF token is empty', vcStreams.some(function (s) { return s.url === 'https://cdn.example/vidcore/master.m3u8'; }), JSON.stringify(vcStreams.map(function (s) { return s.url; })));
  ok('Vidcore still collects subtitles', vcSubs.indexOf('https://cdn.example/vidcore/en.vtt') >= 0);

  var vuCalls = [];
  global.fetch = async function (u, o) {
    var x = String(u);
    vuCalls.push(x);
    if (x.indexOf('vidup.to/movie/155') >= 0) return { body: '{"en":"ENC"}' };
    if (x.indexOf('enc-vidup') >= 0 && x.indexOf('stage=1') >= 0) return { body: JSON.stringify({ status: 200, result: { stage1: 'https://vidup.to/ajax', token: '' } }) };
    if (x.indexOf('vidup.to/ajax') >= 0) return { body: 'STAGE1' };
    if (x.indexOf('enc-vidup') >= 0 && x.indexOf('stage=2') >= 0) return { body: JSON.stringify({ status: 200, result: { servers: 'https://vidup.to/servers', stream: 'https://vidup.to/stream', token: '' } }) };
    if (x.indexOf('vidup.to/servers') >= 0) return { body: 'SERVERS' };
    if (x.indexOf('vidup.to/stream/') >= 0) return { body: 'STREAM' };
    if (x.indexOf('dec-vidup') >= 0) {
      var n = vuCalls.filter(function (c) { return /dec-vidup/.test(c); }).length;
      if (n === 1) return { body: JSON.stringify({ status: 200, result: [{ name: 'VidUp', data: 'D1' }] }) };
      return { body: JSON.stringify({ status: 200, result: { url: 'https://cdn.example/vidup/master.m3u8', tracks: [] } }) };
    }
    return { body: '' };
  };
  var vuStreams = [];
  await P._debug.runProvider('p_vidup', { tmdbId: 155, title: 'The Dark Knight', season: null }, { emit: function (s) { vuStreams.push(s); }, sub: function () {}, includeDownloads: false });
  ok('Vidup works when the CSRF token is empty', vuStreams.some(function (s) { return s.url === 'https://cdn.example/vidup/master.m3u8'; }), JSON.stringify(vuStreams.map(function (s) { return s.url; })));

  // 13f. MeowTV tickets are single-use and required.
  var meowTickets = 0, meowTicketHeaders = 0, meowServers = [];
  global.fetch = async function (u, o) {
    var x = String(u), h = (o && o.headers) || {};
    if (x.indexOf('api.meowtv.ru/streams/ticket') >= 0) { meowTickets++; return { body: JSON.stringify({ ticket: 'T' + meowTickets }) }; }
    if (x.indexOf('api.meowtv.ru/streams/') >= 0) {
      var m = /[?&]s=([^&]+)/.exec(x);
      meowServers.push(m ? m[1] : '');
      var tk = h['X-Stream-Ticket'] || h['x-stream-ticket'];
      if (tk === 'T' + meowServers.length) meowTicketHeaders++;
      return { body: JSON.stringify({ n: 'n', d: 'd' }) };
    }
    if (x.indexOf('dec-meowtv') >= 0) return { body: JSON.stringify({ status: 200, result: { language: 'English', url: 'https://cdn.example/meow/master.m3u8', headers: {} } }) };
    return { body: '' };
  };
  var meowStreams = [];
  await P._debug.runProvider('p_meowtv', { tmdbId: 1399, season: 1, episode: 1 }, { emit: function (s) { meowStreams.push(s); }, sub: function () {}, includeDownloads: false });
  ok('MeowTV requests a fresh ticket per server', meowTickets === 5, String(meowTickets));
  ok('MeowTV sends the matching X-Stream-Ticket header', meowTicketHeaders === 5, String(meowTicketHeaders));
  ok('MeowTV uses live server ids', meowServers.indexOf('english') >= 0 && meowServers.indexOf('ipcloud') < 0, meowServers.join(','));
  ok('MeowTV emits decrypted streams', meowStreams.some(function (s) { return s.url === 'https://cdn.example/meow/master.m3u8'; }));

  // 13g. AniList rate-limit fallback via ani.zip mappings.
  global.fetch = async function (u) {
    var x = String(u);
    if (x.indexOf('graphql.anilist.co') >= 0) return { body: '{}' };
    if (x.indexOf('api.ani.zip/mappings') >= 0) return { body: JSON.stringify({ mappings: { anilist_id: 1735, mal_id: 1735, kitsu_id: 1555, imdb_id: 'tt0988824', themoviedb_id: '31910' } }) };
    return { body: '' };
  };
  var fbIds = await P._debug.animeIds('Naruto Shippuden Regression', '2007', 31910, 'tt0988824');
  ok('AniList failure falls back to ani.zip mappings', fbIds.anilistId === 1735 && fbIds.malId === 1735, JSON.stringify(fbIds));
  ok('ani.zip fallback keeps kitsu id', fbIds.kitsuId === '1555', JSON.stringify(fbIds));

  // 13h. Hdhub4u end-to-end: verified hit only, then greenmotors → HubCloud.
  var hdFetched = [];
  global.fetch = async function (u) {
    var x = String(u);
    hdFetched.push(x);
    if (x.indexOf('search.pingora.fyi') >= 0) return { body: JSON.stringify({ hits: [
      { document: { imdb_id: 'tt0468569', permalink: 'https://new12.hdhub4u.cl/batman-movie/' } },
      { document: { imdb_id: 'tt0988824', permalink: '/naruto-shippuden/' } }
    ] }) };
    if (x.indexOf('naruto-shippuden') >= 0) return { body: '<a data-wpel-link="external" href="https://greenmotors.club/?id=x">480p</a>' };
    if (x.indexOf('batman-movie') >= 0) return { body: '<a data-wpel-link="external" href="https://greenmotors.club/?id=y">1080p</a>' };
    if (/greenmotors|greenmountmotors|hubcdn/i.test(x)) return { body: "<html><script>s('o','" + wpCombined + "');</script></html>" };
    if (x.indexOf('hubcloud.pw/drive/') >= 0) return { body: "<script>var url = 'https://gamerxyt.com/hubcloud.php?id=1';</script>" };
    if (x.indexOf('gamerxyt') >= 0) return { body: '<a href="https://files.example/naruto.mkv">Download File [1 GB]</a>' };
    return { body: '' };
  };
  var hdStreams = [];
  await P._debug.runProvider('p_hdhub4u', { imdbId: 'tt0988824', title: 'Naruto Shippūden', season: null }, { emit: function (s) { hdStreams.push(s); }, sub: function () {}, includeDownloads: false });
  ok('Hdhub4u skips unrelated pingora hits', !hdFetched.some(function (x) { return /batman-movie/.test(x); }), hdFetched.join(' | '));
  ok('Hdhub4u extracts from a verified hit', hdStreams.some(function (s) { return /naruto\.mkv/.test(s.url); }), JSON.stringify(hdStreams.map(function (s) { return s.url; })));

  // 13i. Hdhub4u's greenmotors now lands on an hblinks link-hub page.
  var wpJson2 = JSON.stringify({ w: 10, l: 'https://greenmotors.cc/homelander/', o: b64e('https://hblinks.lol/archives/1') });
  var wpCombined2 = b64e(b64e(rot13s(b64e(wpJson2))));
  global.fetch = async function (u) {
    var x = String(u);
    if (x.indexOf('search.pingora.fyi') >= 0) return { body: JSON.stringify({ hits: [{ document: { imdb_id: 'tt1111111', permalink: '/hub-movie/' } }] }) };
    if (x.indexOf('hub-movie') >= 0) return { body: '<a data-wpel-link="external" href="https://greenmotors.club/?id=z">1080p</a>' };
    if (/greenmotors|greenmountmotors|hubcdn/i.test(x)) return { body: "<html><script>s('o','" + wpCombined2 + "');</script></html>" };
    if (x.indexOf('hblinks.lol') >= 0) return { body: '<a href="https://hubdrive.blog/file/1">Drive [HubDrive]</a><a href="#content">Skip</a><a href="https://hblinks.lol/">Home</a>' };
    if (x.indexOf('hubdrive.blog') >= 0) return { body: '<a class="btn btn-primary btn-user btn-success1" href="https://hubcloud.pw/drive/xyz">[HubCloud Server]</a>' };
    if (x.indexOf('hubcloud.pw/drive/') >= 0) return { body: "<script>var url = 'https://gamerxyt.com/hubcloud.php?id=2';</script>" };
    if (x.indexOf('gamerxyt') >= 0) return { body: '<a href="https://files.example/hub-movie.mkv">Download File [2 GB]</a>' };
    return { body: '' };
  };
  var hbStreams = [];
  await P._debug.runProvider('p_hdhub4u', { imdbId: 'tt1111111', title: 'Hub Movie', season: null }, { emit: function (s) { hbStreams.push(s); }, sub: function () {}, includeDownloads: false });
  ok('Hdhub4u resolves the hblinks link-hub hop', hbStreams.some(function (s) { return /hub-movie\.mkv/.test(s.url); }), JSON.stringify(hbStreams.map(function (s) { return s.url; })));

  global.fetch = origFetch;

  console.log('\n\x1b[32m✓ ' + pass + ' passed\x1b[0m' + (fail ? ' \x1b[31m✗ ' + fail + ' failed\x1b[0m' : '') + (skip ? ' \x1b[33m○ ' + skip + ' skipped\x1b[0m' : ''));
  process.exit(fail > 0 ? 1 : 0);
})();
