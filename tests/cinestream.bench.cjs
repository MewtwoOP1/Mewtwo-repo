'use strict';
// Reproducible latency benchmark for CineStream source resolution.
//
// The host `fetch` is stubbed with a deterministic profile so the numbers are
// stable across runs and machines. It models three classes of host:
//
//   fast  -> the Anv anime API answers immediately and yields a real,
//            playable m3u8 source. This is the provider that represents
//            "the first playable source".
//   slow  -> a normal provider that needs a while (e.g. an HTML scraper).
//   dead  -> a provider whose host never answers. This is the tail that used
//            to hold the whole resolution open.
//
// Usage:
//   node tests/cinestream.bench.mjs            human readable
//   node tests/cinestream.bench.mjs json       machine readable
//
// The same file runs against the pre-optimisation tree, so the before/after
// numbers are produced by identical code paths.

var ANV = 'https://anv.to';

function jsonResponse(body, status, headers) {
  var text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 400,
    status: status || 200,
    statusText: 'OK',
    url: ANV,
    headers: headers || { 'content-type': 'application/json' },
    body: text,
    text: function () { return Promise.resolve(text); },
    json: function () { return Promise.resolve(JSON.parse(text)); }
  };
}

// The latency profile. Values are milliseconds.
var PROFILE = {
  slowMs: 6000,     // a normal but slow provider
  deadMs: 60000,    // a host that never answers within the budget
  deadHosts: [
    'hianime', 'gogoanime', 'kwik', 'vidmoly', 'bysesayeveum',
    '9anime', 'aniwaves', 'anidap', 'senshi', 'nepu', 'toonix', 'movy'
  ]
};

function isDead(url) {
  var u = String(url).toLowerCase();
  for (var i = 0; i < PROFILE.deadHosts.length; i++) {
    if (u.indexOf(PROFILE.deadHosts[i]) >= 0) return true;
  }
  return false;
}

var requestLog = [];

function makeFetch() {
  return function (url, init) {
    var u = String(url);
    var opts = init || {};
    requestLog.push(u);

    // --- Anv: the fast provider that produces a real playable source ---
    if (u.indexOf(ANV) === 0) {
      if (u.indexOf('/api/catalog') >= 0) {
        return Promise.resolve(jsonResponse({
          data: { Page: { media: [{
            id: 1000001498, idMal: 1735, slug: 'naruto-shippuden-c8gov',
            title: { english: 'Naruto: Shippuden' }
          }], pageInfo: { hasNextPage: false } } }
        }));
      }
      if (u.indexOf('/api/episode') >= 0) {
        return Promise.resolve(jsonResponse({
          status: 'ready',
          variants: [{
            id: 'sub', label: 'Sub',
            sources: [{ id: 'x', label: 'Orange', url: '/stream/bench.m3u8' }],
            tracks: [{ label: 'English', language: 'en', src: '/subs/en.vtt' }]
          }]
        }));
      }
      if (u.indexOf('/anime/') >= 0) {
        return Promise.resolve(jsonResponse('<html></html>', 200, {
          'content-type': 'text/html',
          'set-cookie': 'shiro_watch=benchcookie; Path=/'
        }));
      }
      if (u.indexOf('.m3u8') >= 0) {
        return Promise.resolve(jsonResponse(
          '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1404x1080\nbench-1080.m3u8\n'));
      }
      return Promise.resolve(jsonResponse({}));
    }

    // --- Wyzie: the subtitle-only provider ---
    if (u.indexOf('sub.wyzie.io') >= 0) {
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(jsonResponse({})); }, 9000);
      });
    }

    // --- A host that never answers ---
    if (isDead(u)) {
      var t = opts.timeoutMs ? Math.min(opts.timeoutMs, PROFILE.deadMs) : PROFILE.deadMs;
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(jsonResponse('dead', 502)); }, t);
      });
    }

    // --- Every other host: normal but slow ---
    var d = opts.timeoutMs ? Math.min(PROFILE.slowMs, opts.timeoutMs) : PROFILE.slowMs;
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(jsonResponse({})); }, d);
    });
  };
}

function now() { return Number(process.hrtime.bigint() / 1000000n); }

(async function () {
  global.fetch = makeFetch();
  var P = require('../providers/cinestream.js');
  var conc = process.env.BENCH_CONCURRENCY || '10';
  global.__settings = {
    cinestream: {
      enabledProviders: P._providers.map(function (p) { return p[0]; }),
      concurrency: conc
    }
  };

  var payload = JSON.stringify({
    tmdbId: 27205, imdbId: 'tt1375666', title: 'Naruto: Shippuden', year: 2007,
    season: 1, episode: 1, absolute: 1, isAnime: true,
    anilistId: 1735, malId: 1735, kitsuId: 1555,
    originalTitle: 'ナルト- 疾風伝', imdbTitle: 'Naruto: Shippuden'
  });

  // Warm-up run so the adaptive latency table is populated (cold start is
  // reported separately).
  var results = [];

  for (var run = 0; run < 2; run++) {
    requestLog = [];
    var t0 = now();
    var res = await P.getVideoSources(payload, true);
    var t1 = now();
    var stats = P._debug.resolveStats ? P._debug.resolveStats() : null;
    results.push({
      run: run === 0 ? 'cold' : 'warm',
      totalMs: t1 - t0,
      sourceCount: (res || []).length,
      firstSourceMs: stats ? stats.firstSourceMs : null,
      requests: requestLog.length,
      firstUrl: res && res[0] ? res[0].url : null,
      firstQuality: res && res[0] ? res[0].quality : null
    });
  }

  // Full sweep (host did not ask for the fast path).
  requestLog = [];
  var f0 = now();
  var full = await P.getVideoSources(payload, false);
  var f1 = now();
  var fullStats = P._debug.resolveStats ? P._debug.resolveStats() : null;

  var out = {
    fastMode: results,
    fullMode: {
      totalMs: f1 - f0,
      sourceCount: (full || []).length,
      firstSourceMs: fullStats ? fullStats.firstSourceMs : null,
      requests: requestLog.length
    },
    budgets: P._debug.budgets ? P._debug.budgets() : null,
    providerCount: P._providers.length
  };

  if (process.argv.indexOf('json') >= 0) {
    console.log(JSON.stringify(out));
  } else {
    console.log('providers              : ' + out.providerCount);
    console.log('budgets                : ' + JSON.stringify(out.budgets));
    out.fastMode.forEach(function (r) {
      console.log('fast/' + r.run + '  total=' + r.totalMs + 'ms  firstSource=' + r.firstSourceMs +
        'ms  sources=' + r.sourceCount + '  requests=' + r.requests);
    });
    console.log('full     total=' + out.fullMode.totalMs + 'ms  firstSource=' + out.fullMode.firstSourceMs +
      'ms  sources=' + out.fullMode.sourceCount + '  requests=' + out.fullMode.requests);
  }
})().catch(function (e) {
  console.error(e && e.stack || String(e));
  process.exit(1);
});
