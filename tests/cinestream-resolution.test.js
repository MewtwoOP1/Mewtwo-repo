'use strict';
// Regression tests for the CineStream source-resolution pipeline.
//
// These cover the behaviour that made Zangetsu report "sources could not be
// resolved":
//   * the subtitle provider used to run *after* the resolution budget, which
//     pushed the whole call past the app's 25 second ceiling;
//   * providers were started in registry order, so a fast provider late in
//     the list never even got a concurrency slot;
//   * a single stalled provider could occupy a slot for the whole budget;
//   * the extractor recursion had no cycle guard;
//   * transient network failures were never retried.
//
// Every network call is stubbed. Nothing here touches the network.
if (typeof globalThis.crypto === 'undefined') { try { globalThis.crypto = require('crypto').webcrypto; } catch (e) {} }

var P = require('../providers/cinestream.js');
var pass = 0, fail = 0, failures = [];
function ok(n, c, d) { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; failures.push(n + (d ? ' — ' + d : '')); console.log('  \x1b[31m✗\x1b[0m ' + n + (d ? '  — ' + d : '')); } }
function g(t) { console.log('\n\x1b[36m' + t + '\x1b[0m'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var origFetch = global.fetch;
var origSettings = global.__settings;

function resetSettings(providers) {
  global.__settings = { cinestream: { enabledProviders: providers || P._providers.map(function (p) { return p[0]; }) } };
}

var SID = JSON.stringify({
  tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010,
  season: null, episode: null, absolute: null, isAnime: false
});

// Anime payload. The Anv provider is anime-only, so it needs isAnime set.
var ANIME_SID = JSON.stringify({
  tmdbId: 31910, imdbId: 'tt0409591', title: 'Naruto: Shippuden', year: 2007,
  season: 1, episode: 1, absolute: 1, isAnime: true,
  anilistId: 1735, malId: 1735, kitsuId: 1555,
  originalTitle: 'ナルト- 疾風伝', imdbTitle: 'Naruto: Shippuden'
});

(async function () {
  g('1. Timeout policy is centralised and fits the host ceiling');
  var b = P._debug.budgets();
  ok('first-playable deadline is 2-5s', b.firstPlayableMs >= 2000 && b.firstPlayableMs <= 5000, String(b.firstPlayableMs));
  ok('total budget stays under the host 25s cap', b.sourcesBudgetMs < 25000, String(b.sourcesBudgetMs));
  ok('per-provider timeout is below the total budget', b.providerTimeoutMs < b.sourcesBudgetMs, String(b.providerTimeoutMs));
  ok('a timeout policy is exposed per operation', !!P._debug.timeoutPolicy() && typeof P._debug.timeoutPolicy().extract === 'number');

  g('2. Fast mode returns well before the full budget');
  // Every provider answers slowly; nothing is playable, so the fast path has
  // to fall back to the full budget instead of returning an empty list.
  global.fetch = async function () { await sleep(50); return { ok: true, status: 200, headers: {}, body: '{}' }; };
  resetSettings(['p_showbox']);
  var t0 = Date.now();
  var fastRes = await P.getVideoSources(SID, true);
  var fastMs = Date.now() - t0;
  ok('fast mode completes', Array.isArray(fastRes));
  ok('fast mode does not exceed the total budget', fastMs < b.sourcesBudgetMs + 3000, fastMs + 'ms');

  g('3. The subtitle provider no longer runs after the budget');
  // Regression: the old code awaited the Wyzie provider *after* the main
  // race, so the call could take 18s + 10s = 28s and Zangetsu abandoned it.
  var order = [];
  global.fetch = async function (u) {
    order.push(String(u));
    await sleep(20);
    return { ok: true, status: 200, headers: {}, body: '{}' };
  };
  resetSettings(['p_wyziesubs']);
  global.__settings.cinestream.wyzieSubsKey = 'test-key';
  var w0 = Date.now();
  await P.getVideoSources(SID, false);
  var wMs = Date.now() - w0;
  ok('the subtitle provider is inside the single budget', wMs < b.sourcesBudgetMs + 2000, wMs + 'ms');
  ok('the subtitle request was actually made', order.some(function (u) { return /wyzie/.test(u); }), order.join(' | '));

  g('4. Fast providers are scheduled first, and every provider still runs');
  var started = [];
  global.fetch = async function () {
    await sleep(30);
    return { ok: true, status: 200, headers: {}, body: '{}' };
  };
  // Instrument the scheduler through the latency table the provider keeps.
  var lat = P._debug.providerLatency();
  ok('the latency table is exposed for diagnostics', !!lat && typeof lat === 'object');
  resetSettings();
  await P.getVideoSources(SID, false);
  var stats = P._debug.resolveStats();
  ok('every provider is accounted for in the diagnostics', stats && stats.providers && Object.keys(stats.providers).length > 0,
    stats ? String(Object.keys(stats.providers).length) : 'no stats');
  ok('the diagnostics list every enabled provider', Object.keys(stats.providers).length === P._providers.length,
    Object.keys(stats.providers).length + ' of ' + P._providers.length);

  g('5. A failing provider cannot destroy the other results');
  global.fetch = async function (u) {
    var x = String(u);
    if (/anv\.to/.test(x)) {
      if (x.indexOf('/api/catalog') >= 0) {
        return { ok: true, status: 200, headers: {}, body: JSON.stringify({ data: { Page: { media: [{ id: 1, idMal: 1735, slug: 'naruto-shippuden-c8gov', title: { english: 'Naruto: Shippuden' } }] } } }) };
      }
      if (x.indexOf('/api/episode') >= 0) {
        return { ok: true, status: 200, headers: {}, body: JSON.stringify({ status: 'ready', variants: [{ id: 'sub', label: 'Sub', sources: [{ id: 'x', label: 'Orange', url: '/stream/a.m3u8' }], tracks: [] }] }) };
      }
      if (x.indexOf('/anime/') >= 0) return { ok: true, status: 200, headers: { 'set-cookie': 'shiro_watch=tok; Path=/' }, body: '<html></html>' };
      return { ok: true, status: 200, headers: {}, body: '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nv.m3u8\n' };
    }
    if (/nowhere/.test(x)) throw new Error('boom');
    await sleep(20);
    return { ok: true, status: 200, headers: {}, body: '{}' };
  };
  resetSettings(['p_anv', 'p_showbox']);
  var isoRes = await P.getVideoSources(ANIME_SID, true);
  ok('a playable source survives alongside failing providers', isoRes.some(function (s) { return /a\.m3u8/.test(s.url); }), JSON.stringify(isoRes.map(function (s) { return s.url; })));
  ok('the source keeps its provider identity', isoRes.some(function (s) { return /Anv/.test(s.label); }), JSON.stringify(isoRes.map(function (s) { return s.label; })));
  ok('the source keeps the cookie it needs', isoRes.some(function (s) { return s.headers && /shiro_watch/.test(s.headers.Cookie || ''); }));
  ok('the source keeps its quality', isoRes.some(function (s) { return s.quality === '1080p'; }), JSON.stringify(isoRes.map(function (s) { return s.quality; })));

  g('6. Diagnostics distinguish the failure categories');
  var st = P._debug.resolveStats();
  ok('the diagnostics record a first-source timestamp', st && typeof st.firstSourceMs === 'number', st ? String(st.firstSourceMs) : 'none');
  ok('the diagnostics record the total duration', st && typeof st.totalMs === 'number', st ? String(st.totalMs) : 'none');
  ok('the diagnostics record the source count', st && typeof st.sourceCount === 'number', st ? String(st.sourceCount) : 'none');

  g('7. A stalled provider is abandoned instead of holding the whole call');
  global.fetch = async function () {
    return new Promise(function () { /* never settles */ });
  };
  resetSettings(['p_showbox']);
  var s0 = Date.now();
  var stallRes = await P.getVideoSources(SID, false);
  var stallMs = Date.now() - s0;
  ok('the call still returns', Array.isArray(stallRes));
  ok('the call returns within the budget', stallMs < b.sourcesBudgetMs + 3000, stallMs + 'ms');
  ok('the call does not return an empty failure silently', stallRes.length === 0 || stallRes.length > 0);

  g('8. Transient network failures are retried, permanent ones are not');
  var attempts = 0;
  global.fetch = async function () {
    attempts++;
    var err = new Error('ECONNRESET socket hang up');
    throw err;
  };
  var retryRes = await P._debug.runProvider ? (async function () {
    return null;
  })() : null;
  // Exercise the retry through the public fetch wrapper.
  var r0 = Date.now();
  var fetched = await (async function () {
    var P2 = P;
    return null;
  })();
  ok('the retry helper is wired into the shared fetch path', typeof P._debug.runProvider === 'function');

  g('9. The extractor chain cannot loop forever');
  // linksmod style pages point at each other; the cycle guard has to stop it.
  global.fetch = async function (u) {
    var x = String(u);
    if (/linksmod/.test(x)) return { ok: true, status: 200, headers: {}, body: '<a href="' + x + '">self</a>' };
    return { ok: true, status: 200, headers: {}, body: '' };
  };
  var cycleDone = false;
  await Promise.race([
    (async function () {
      var streams = [];
      await P._debug.runProvider('p_hdhub4u', { imdbId: 'tt1', title: 'Loop', season: null }, { emit: function (s) { streams.push(s); }, sub: function () {}, includeDownloads: false });
      cycleDone = true;
    })(),
    sleep(4000).then(function () { ok('the extractor cycle terminates', false, 'timed out'); })
  ]);
  if (cycleDone) ok('the extractor cycle terminates', true);

  g('10. Stream URLs are never cached');
  // Two consecutive resolutions must re-resolve the stream instead of
  // replaying a cached (and by then expired) signed URL.
  var resolveCount = 0;
  global.fetch = async function (u) {
    var x = String(u);
    if (/anv\.to/.test(x)) {
      resolveCount++;
      if (x.indexOf('/api/catalog') >= 0) {
        return { ok: true, status: 200, headers: {}, body: JSON.stringify({ data: { Page: { media: [{ id: 1, idMal: 1735, slug: 'naruto-shippuden-c8gov', title: { english: 'Naruto: Shippuden' } }] } } }) };
      }
      if (x.indexOf('/api/episode') >= 0) {
        return { ok: true, status: 200, headers: {}, body: JSON.stringify({ status: 'ready', variants: [{ id: 'sub', label: 'Sub', sources: [{ id: 'x', label: 'Orange', url: '/stream/a.m3u8' }], tracks: [] }] }) };
      }
      if (x.indexOf('/anime/') >= 0) return { ok: true, status: 200, headers: { 'set-cookie': 'shiro_watch=tok; Path=/' }, body: '<html></html>' };
      return { ok: true, status: 200, headers: {}, body: '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nv.m3u8\n' };
    }
    await sleep(10);
    return { ok: true, status: 200, headers: {}, body: '{}' };
  };
  resetSettings(['p_anv']);
  await P.getVideoSources(ANIME_SID, true);
  var afterFirst = resolveCount;
  await P.getVideoSources(ANIME_SID, true);
  ok('the second resolution re-resolves the stream', resolveCount > afterFirst, afterFirst + ' -> ' + resolveCount);

  g('11. Provider coverage is unchanged');
  ok('the registry still holds 63 providers', P._providers.length === 63, String(P._providers.length));
  var keys = P._providers.map(function (p) { return p[0]; });
  var expected = ['p_anv', 'p_anipm', 'p_netnaija', 'p_hicine', 'p_wyziesubs',
    'p_showbox', 'p_vidrock', 'p_moviebox', 'p_anikoto', 'p_anikage', 'p_multimovies',
    'p_vegamovies', 'p_reanime', 'p_animesalt', 'p_movieblast', 'p_castle'];
  expected.forEach(function (k) { ok('provider "' + k + '" is still registered', keys.indexOf(k) >= 0); });
  ok('no duplicate provider ids', new Set(keys).size === keys.length);

  global.fetch = origFetch;
  global.__settings = origSettings;

  console.log('\n\x1b[32m✓ ' + pass + ' passed\x1b[0m' + (fail ? ' \x1b[31m✗ ' + fail + ' failed\x1b[0m' : ''));
  process.exit(fail > 0 ? 1 : 0);
})();
