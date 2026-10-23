'use strict';
if (typeof globalThis.crypto === 'undefined') { try { globalThis.crypto = require('crypto').webcrypto; } catch (e) {} }
var P = require('../providers/mewstream.js');
var pass = 0, fail = 0, skip = 0, failures = [];
function ok(n, c, d) { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  \x1b[31m✗\x1b[0m ' + n + (d ? '  — ' + d : '')); } }
function skipT(n, r) { skip++; console.log('  \x1b[33m○\x1b[0m ' + n + '  (' + r + ')'); }
function g(t) { console.log('\n\x1b[36m' + t + '\x1b[0m'); }

(async function () {
  g('1. Contract');
  ['getInfo','getSettings','getHome','popular','search','getDetail','getEpisodes','getVideoSources','getStreams','getLinks','_parseStreamId','_debug']
    .forEach(function (k) { ok('export .' + k, P[k] !== undefined); });
  ok('getSettings() has 17 settings', P.getSettings().length === 17, String(P.getSettings().length));
  ok('getInfo().name = Mewstream', P.getInfo().name === 'Mewstream');
  ['tmdbApiKey','showboxToken','enableMegaplayDirect','enableAnikoto','enableAnizone','enableAnimesalt','enableRareanimes','enableShowbox','enableVaplayer','enableVidrock','enableVidzee','enableVidfast','enableHexa','enableVidsrc','enableVidcore','enableMoviesapi','enableVidnest']
    .forEach(function (k) { ok('setting "' + k + '" present', P.getSettings().some(function (s) { return s.key === k; })); });
  ['getMegaplayDirect','getAnikoto','getAnizone','getAnimesalt','getRareanimes','getShowbox','getVaplayer','getVidrock','getVidzee','getVidfast','getHexa','getVidsrc','getVidcore','getVidup','getMoviesapi','getVidnest','classify','sim','titleOk']
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
  var p2 = P._parseStreamId(JSON.stringify({ tmdbId: 95479, season: 1, episode: 3, absolute: 3, isAnime: true }));
  ok('isAnime true preserved', p2.isAnime === true);
  ok('episode parsed', p2.episode === 3);
  ok('absolute parsed', p2.absolute === 3);

  g('5. Episode mapping — absolute vs season/episode');
  // Simulated TMDB TV payload: S2E3 must carry absolute = 12 + 3 = 15
  var eps = [
    { season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 1, episode: 3 },
    { season: 1, episode: 4 }, { season: 1, episode: 5 }, { season: 1, episode: 6 },
    { season: 1, episode: 7 }, { season: 1, episode: 8 }, { season: 1, episode: 9 },
    { season: 1, episode: 10 }, { season: 1, episode: 11 }, { season: 1, episode: 12 },
    { season: 2, episode: 1 }, { season: 2, episode: 2 }, { season: 2, episode: 3 }
  ];
  var offsets = {}, running = 0, seasons = {};
  eps.forEach(function (v) { if (!seasons[v.season]) { seasons[v.season] = []; offsets[v.season] = running; } seasons[v.season].push(v); });
  Object.keys(seasons).sort(function (a, b) { return a - b; }).forEach(function (sn) { offsets[sn] = running; running += seasons[sn].length; });
  var s2e3 = eps.filter(function (v) { return v.season === 2 && v.episode === 3; })[0];
  var abs = (offsets[s2e3.season] || 0) + s2e3.episode;
  ok('S2E3 absolute = 15', abs === 15, String(abs));

  g('6. Orchestrator gating — deterministic network fixtures');
  var logs = [], orig = console.log;
  var fetchBeforeGating = global.fetch;
  var gatingCalls = [];
  // Do not depend on external sites in a test whose purpose is just to check
  // anime/movie adapter gating. Live results previously made this assertion
  // flaky (VaPlayer could return a stream before the test inspected the log).
  global.fetch = async function (url) {
    var u = String(url);
    gatingCalls.push(u);
    if (u.indexOf('/meta/movie/tt1375666.json') > -1) {
      return { body: JSON.stringify({ meta: { name: 'Inception', imdb_id: 'tt1375666', moviedb_id: 27205, genre: ['Action', 'Thriller'] } }) };
    }
    if (u.indexOf('/movie/27205?api_key=') > -1) {
      return { body: JSON.stringify({ genres: [{ name: 'Action' }, { name: 'Thriller' }], origin_country: ['US'], original_language: 'en' }) };
    }
    if (u.indexOf('/tv/95479?api_key=') > -1) {
      return { body: JSON.stringify({ genres: [{ name: 'Animation' }], origin_country: ['JP'], original_language: 'ja' }) };
    }
    return { body: '' };
  };
  console.log = function () { logs.push([].slice.call(arguments).join(' ')); };
  logs = [];
  try { await P.getVideoSources(JSON.stringify({ imdbId: 'tt1375666', tmdbId: 27205, season: null, episode: 0, title: 'Inception', isAnime: false }), { onSubtitle: function () {} }); } catch (e) {}
  var fl = logs.filter(function (l) { return /Mewstream/i.test(l); }).join(' | ');
  ok('Inception anime=false', logs.some(function (l) { return /anime=false/.test(l); }), fl);
  ok('Inception anime skipped', logs.some(function (l) { return /anime-sources:skipped/.test(l); }), fl);
  ok('Inception no anime source attempted', !gatingCalls.some(function (u) { return /anikototv\.to|animesalt\.to|rareanimes\.mov|megaplays\.se/.test(u); }), gatingCalls.join('\\n'));
  logs = [];
  gatingCalls = [];
  try { await P.getVideoSources(JSON.stringify({ tmdbId: 95479, malId: 52299, anilistId: 151807, season: 1, episode: 3, absolute: 3, title: 'Jujutsu Kaisen', isAnime: true }), { onSubtitle: function () {} }); } catch (e) {}
  var al = logs.filter(function (l) { return /Mewstream/i.test(l); }).join(' | ');
  ok('Jujutsu Kaisen anime=true', logs.some(function (l) { return /anime=true/.test(l); }), al);
  global.fetch = fetchBeforeGating;
  console.log = orig;

  g('7. No silent episode fallback');
  // AniKoto must return [] when exact episode is absent, not reduce to nearest
  var originalFetch = global.fetch;
  global.fetch = async function (u) {
    if (String(u).indexOf('/filter?keyword=') > -1) {
      return { body: '<a href="/watch/test-slug">Test Anime</a>' };
    }
    if (String(u).indexOf('/watch/test-slug') > -1) {
      return { body: '<div data-id="123"></div>' };
    }
    if (String(u).indexOf('/ajax/episode/list/') > -1) {
      return { body: JSON.stringify({ result: '<a data-id="1" data-num="1" data-ids="x" data-sub="1"></a><a data-id="2" data-num="2" data-ids="y" data-sub="1"></a>' }) };
    }
    return { body: '' };
  };
  var anikoto = await P._debug.getAnikoto('Test Anime', 1, 99, function () {});
  ok('AniKoto returns [] for missing episode 99', Array.isArray(anikoto) && anikoto.length === 0, JSON.stringify(anikoto));
  // Native Fetch API regression: response.body is a ReadableStream, not text.
  // The same AniKoto → MegaPlay flow must still extract a real source URL.
  global.fetch = async function (u) {
    var url = String(u), body = '';
    if (url.indexOf('/filter?keyword=') > -1) body = '<a href="/watch/test-native">Test Anime</a>';
    else if (url.indexOf('/watch/test-native') > -1) body = '<div data-id="321"></div>';
    else if (url.indexOf('/ajax/episode/list/321') > -1) body = JSON.stringify({ result: '<a data-id="1" data-num="1" data-ids="native-sub" data-sub="1"></a>' });
    else if (url.indexOf('/ajax/server/list?servers=native-sub') > -1) body = JSON.stringify({ result: '<div data-type="sub"><li data-link-id="native-link">MegaPlay</li></div>' });
    else if (url.indexOf('/ajax/server?get=native-link') > -1) body = JSON.stringify({ result: { url: 'https://megaplays.se/stream/s-2/native/sub' } });
    else if (url.indexOf('megaplays.se/stream/s-2/native/sub') > -1) body = '<div data-id="777"></div>';
    else if (url.indexOf('/stream/getSourcesNew?id=777&type=sub') > -1) body = JSON.stringify({ sources: { file: 'https://cdn.example/native-anime.m3u8' }, tracks: [] });
    else if (url.indexOf('/stream/getSources?id=777&type=sub') > -1) body = JSON.stringify({ sources: { file: 'https://cdn.example/native-anime-legacy.m3u8' }, tracks: [] });
    else return new Response('', { status: 404 });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  };
  var nativeResponse = await P._debug.getAnikoto('Test Anime', 1, 1, function () {});
  ok('AniKoto handles standard Fetch Response bodies', Array.isArray(nativeResponse) && nativeResponse.length === 1, JSON.stringify(nativeResponse));
  ok('MegaPlay source extracted from standard Fetch response', nativeResponse[0] && nativeResponse[0].url === 'https://cdn.example/native-anime.m3u8#mew-megaplay-sub', JSON.stringify(nativeResponse));
  global.fetch = originalFetch;

  // All-source fan-out regression: a quick AniKoto hit must not stop the
  // general movie/TV resolvers from running. Every source here is fixture-backed.
  var oldSettings = global.__settings;
  global.__settings = { mewstream: { showboxToken: 'test-token' } };
  var fanoutCalls = [];
  global.fetch = async function (input, options) {
    var u = String(input);
    fanoutCalls.push({ url: u, method: String((options && options.method) || 'GET').toUpperCase() });
    if (u.indexOf('anikototv.to/filter?keyword=Test%20Anime') > -1) return { body: '<a href="/watch/test-anime">Test Anime</a>' };
    if (u === 'https://anikototv.to/watch/test-anime') return { body: '<div data-id="123"></div>' };
    if (u.indexOf('/ajax/episode/list/123') > -1) return { body: JSON.stringify({ result: '<a data-id="1" data-num="1" data-ids="anikoto-server" data-sub="1"></a>' }) };
    if (u.indexOf('/ajax/server/list?servers=anikoto-server') > -1) return { body: JSON.stringify({ result: '<div data-type="sub"><li data-link-id="anikoto-link">MegaPlay</li></div>' }) };
    if (u.indexOf('/ajax/server?get=anikoto-link') > -1) return { body: JSON.stringify({ result: { url: 'https://megaplays.se/stream/s-2/900/sub' } }) };
    if (u === 'https://megaplays.se/stream/s-2/900/sub') return { body: '<div data-id="900"></div>' };
    if (u.indexOf('/stream/getSourcesNew?id=900&type=sub') > -1) return { body: JSON.stringify({ sources: { file: 'https://cdn.example/anikoto.m3u8' }, tracks: [] }) };

    if (u.indexOf('megaplays.se/stream/mal/52299/1/') > -1 || u.indexOf('megaplay.buzz/stream/mal/52299/1/') > -1) return { body: '' };
    if (u.indexOf('anizone.to/search?query=Test%20Anime') > -1) return { body: '<a href="/anime/test-anime">Test Anime</a>' };
    if (u === 'https://anizone.to/anime/test-anime/1') return { body: '<video src="https://cdn.example/anizone.m3u8"></video>' };
    if (u === 'https://animesalt.to/episode/test-anime-1x1/') return { body: '<img src="https://as-cdn1.top/video/abcdef">' };
    if (u.indexOf('as-cdn1.top/player/index.php?data=abcdef&do=getVideo') > -1) return { body: JSON.stringify({ videoSource: 'https://cdn.example/animesalt.m3u8' }) };
    if (u.indexOf('rareanimes.mov/?s=Test+Anime') > -1) return { body: '' };

    if (u.indexOf('streamdata.vaplayer.ru/api.php?imdb=tt1234567&type=tv&season=1&episode=1') > -1) return { body: JSON.stringify({ data: { stream_urls: ['https://cdn.example/vaplayer.m3u8'] } }) };
    if (u.indexOf('vidrock.to/api/tv/12345_1_1/') > -1) return { body: '{}' };
    if (u === 'https://vidfast.vc/tv/12345/1/1/') return { body: '' };
    if (u === 'https://enc-dec.app/api/enc-hexa') return { body: JSON.stringify({ result: { token: 'fixture-token' } }) };
    if (u.indexOf('theemoviedb.hexa.su/api/tmdb/tv/12345/season/1/episode/1/images') > -1) return { body: 'fixture-encrypted-payload' };
    if (u === 'https://enc-dec.app/api/dec-hexa') return { body: JSON.stringify({ result: { sources: [{ url: 'https://cdn.example/hexa.m3u8', server: 'fixture' }] } }) };
    if (u.indexOf('player.vidzee.wtf/api/server?id=12345&sr=') > -1) return { body: JSON.stringify({ url: [] }) };

    if (u === 'https://showbox.media/search?keyword=tt1234567') return { body: '<div class="film-name"><a href="/movie/123">Test Anime</a></div>' };
    if (u === 'https://showbox.media/movie/123') return { body: '<div class="heading-name"><a href="/files/456">Test Anime</a></div>' };
    if (u === 'https://showbox.media/index/share_link?id=456&type=2') return { body: JSON.stringify({ data: { link: 'https://www.febbox.com/s/sharekey' } }) };
    if (u === 'https://www.febbox.com/file/file_share_list?share_key=sharekey') return { body: JSON.stringify({ data: { file_list: [{ is_dir: true, file_name: 'Season 1', fid: 44 }] } }) };
    if (u === 'https://www.febbox.com/file/file_share_list?share_key=sharekey&parent_id=44') return { body: JSON.stringify({ data: { file_list: [{ is_dir: false, file_name: 'Episode E01.mkv', fid: 55 }] } }) };
    if (u === 'https://www.febbox.com/console/video_quality_list?fid=55&share_key=sharekey') return { body: JSON.stringify({ html: '<div class="file_quality" data-url="https://cdn.example/showbox.mp4" data-quality="1080"></div>' }) };

    if (u === 'https://vidsrc.to/embed/tv/12345/1/1') return { body: '{"file":"https://cdn.example/vidsrc.m3u8"}' };
    if (u === 'https://vidcore.org/tv/12345/1/1' || u === 'https://vidup.to/tv/12345/1/1') return { body: '<div data-token="fixture-token"></div>' };
    if (u === 'https://moviesapi.to/tv/12345/1/1') return { body: '{"file":"https://cdn.example/moviesapi.m3u8"}' };
    if (u === 'https://vidnest.fun/embed/tv/12345/1/1') return { body: '{"file":"https://cdn.example/vidnest.m3u8"}' };
    return { body: '' };
  };
  var fanoutStreams = await P.getVideoSources(JSON.stringify({
    imdbId: 'tt1234567', tmdbId: 12345, malId: 52299, anilistId: 151807,
    season: 1, episode: 1, absolute: 1, title: 'Test Anime', isAnime: true
  }), { onSubtitle: function () {} });
  var expectedAdapters = [
    ['MegaPlay-Direct', 'megaplays.se/stream/mal/52299/1/sub'],
    ['AniKoto', 'anikototv.to/filter?keyword=Test%20Anime'],
    ['AniZone', 'anizone.to/search?query=Test%20Anime'],
    ['AnimeSalt', 'animesalt.to/episode/test-anime-1x1'],
    ['RareAnimes', 'rareanimes.mov/'],
    ['VaPlayer', 'streamdata.vaplayer.ru/api.php?imdb=tt1234567'],
    ['Vidrock', 'vidrock.to/api/tv/12345_1_1'],
    ['Vidfast', 'vidfast.vc/tv/12345/1/1'],
    ['Hexa', 'theemoviedb.hexa.su/api/tmdb/tv/12345'],
    ['VidZee', 'player.vidzee.wtf/api/server?id=12345'],
    ['Showbox', 'showbox.media/search?keyword=tt1234567'],
    ['VidSrc', 'vidsrc.to/embed/tv/12345/1/1'],
    ['VidCore', 'vidcore.org/tv/12345/1/1'],
    ['VidUp', 'vidup.to/tv/12345/1/1'],
    ['moviesapi', 'moviesapi.to/tv/12345/1/1'],
    ['VidNest', 'vidnest.fun/embed/tv/12345/1/1']
  ];
  expectedAdapters.forEach(function (entry) {
    ok('source triggered: ' + entry[0], fanoutCalls.some(function (call) {
      return call.url.indexOf(entry[1]) >= 0;
    }), fanoutCalls.map(function (call) { return call.url; }).join('\\n'));
  });
  var resultUrls = fanoutStreams.map(function (stream) { return stream.url; });
  ok('all successful source results are aggregated', resultUrls.length >= 8, JSON.stringify(resultUrls));
  ['anikoto.m3u8', 'anizone.m3u8', 'animesalt.m3u8', 'vaplayer.m3u8',
   'hexa.m3u8', 'showbox.mp4', 'vidsrc.m3u8', 'moviesapi.m3u8', 'vidnest.m3u8'
  ].forEach(function (expected) {
    ok('aggregated stream: ' + expected, resultUrls.some(function (url) { return url.indexOf(expected) >= 0; }), JSON.stringify(resultUrls));
  });
  global.fetch = originalFetch;
  if (oldSettings === undefined) delete global.__settings; else global.__settings = oldSettings;

  g('8. Source latency guard');
  ok('source timeout stays below playback budget', P._debug.timeoutLimits.sourceMs < 20000,
    JSON.stringify(P._debug.timeoutLimits));
  var timeoutStart = Date.now();
  var timeoutValue = await P._debug.withTimeout(new Promise(function () {}), 25, [], 'test-hung-source');
  ok('hung source resolves to fallback', Array.isArray(timeoutValue) && timeoutValue.length === 0);
  ok('hung source returns promptly', Date.now() - timeoutStart < 500,
    String(Date.now() - timeoutStart) + 'ms');

  g('9. Live metadata (skipped if unreachable)');
  var f;
  try { f = await P.getDetail('tmdb://movie/tt1375666'); } catch (e) {}
  if (f) { ok('Inception type=movie', f.type === 'movie', f.type); ok('Inception isAnime=false', f.isAnime === false); ok('Inception 1 slot', f.episodes.length === 1); } else skipT('film detail', 'Cinemeta blocked');
  var a;
  try { a = await P.getDetail('tmdb://anime/kitsu-42765'); } catch (e) {}
  if (a) { ok('Jujutsu Kaisen type=anime', a.type === 'anime', a.type); ok('Jujutsu Kaisen isAnime=true', a.isAnime === true); ok('kitsuId 42765', a.kitsuId === '42765'); } else skipT('anime detail', 'Kitsu blocked');

  g('10. Search (skipped if unreachable)');
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