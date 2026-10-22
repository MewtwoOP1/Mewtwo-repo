// AV1Encodes realistic end-to-end regression tests.
// HTML and route shapes mirror the currently served AnimeAlpha pages.
// All requests are deterministic mocks; a live upstream generator failure is
// asserted separately from episode discovery and stream extraction.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROVIDER_PATH = path.join(__dirname, '..', 'providers', 'av1encodes.js');
const BASE = 'https://av1please.com';
const ALT = 'https://animealpha.cc';
const LEGACY = 'https://av1encodes.com';
const SLUG = 'black-clover';
const EPISODE_PATH = '/download/black-clover/1/1920%20x%201080/%5BE001%5D%20Black%20Clover%20%5B1080p%5D%20%5BDual%5D.mkv?token=listing-token';
const FRESH_EPISODE_RE = /\/download\/black-clover\/1\/1920%20x%201080\/.*[?&]token=fresh-token(?:&|$)/;

const fixtures = {
  search: '<html><article class="anime-card"><a href="/anime/black-clover">' +
    '<h3>Black Clover</h3><img src="/covers/black-clover.jpg"></a></article></html>',
  detail: '<!doctype html><html><head><title>Black Clover</title></head><body>' +
    '<h1>Black Clover</h1>' +
    '<a href="/episodes/black-clover/1/640%20x%20360">640 x 360</a>' +
    '<a href="/episodes/black-clover/1/854%20x%20480">854 x 480</a>' +
    '<a href="/episodes/black-clover/1/1280%20x%20720">1280 x 720</a>' +
    '<a href="/episodes/black-clover/1/1920%20x%201080">1920 x 1080</a>' +
    '</body></html>',
  episodes: '<!doctype html><html><body>' +
    '<a href="' + EPISODE_PATH + '">Episode 01 Dual</a>' +
    '<a href="/download/black-clover/1/1920%20x%201080/%5BE002%5D%20Black%20Clover%20%5B1080p%5D%20%5BDual%5D.mkv?token=second-token">Episode 02 Dual</a>' +
    '</body></html>',
  player: '<!doctype html><html><body>' +
    '<iframe id="anime-video-player" src="/watch/black-clover-ep-001"></iframe>' +
    '<script>window.__ddl_token = "AAAAA1234567890";</script>' +
    '</body></html>',
  ddl: JSON.stringify({
    success: true,
    watch_link: '/watch/black-clover-ep-001',
    stream_link: '/redirect/stream/black-clover-ep-001',
    download_link: '/redirect/download/black-clover-ep-001',
    file_name: '[E001] Black Clover [1080p] [Dual].mkv'
  }),
  generatorError: '<!doctype html><html><body><h1>Oops! Something went wrong</h1>' +
    '<p>Unable to generate download link</p><button>Try Again</button></body></html>'
};

const routes = [];
const calls = [];
function route(pattern, handler) { routes.push({ pattern, handler }); }
function ok(body, url, headers) {
  const text = String(body == null ? '' : body);
  return { ok: true, status: 200, body: text, url: url || '', headers: headers || {}, text: () => Promise.resolve(text) };
}
function fail(status, body, headers) {
  const text = String(body || '');
  return { ok: false, status: status || 404, body: text, url: '', headers: headers || {}, text: () => Promise.resolve(text) };
}
function mockFetch(url, options) {
  const target = String(url);
  calls.push({ url: target, options: options || {} });
  for (const r of routes) {
    r.pattern.lastIndex = 0;
    if (r.pattern.test(target)) return Promise.resolve(r.handler(target, options || {}));
  }
  return Promise.resolve(fail(404, 'mock route not configured: ' + target));
}
function createProviderSandbox() {
  const sandbox = {
    __SOURCE_ID: 'av1encodes',
    __settings: { av1encodes: {} },
    fetch: mockFetch,
    console: { log: console.log, warn: () => {}, error: console.error },
    Promise, JSON, String, Number, Boolean, Object, Array, Math, RegExp, Error, Date,
    encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(PROVIDER_PATH, 'utf8'), sandbox);
  return sandbox;
}
let P = createProviderSandbox();
let passed = 0;
let failed = 0;
const failures = [];
async function test(name, body) {
  try {
    await body();
    passed++;
    console.log('  ✓ ' + name);
  } catch (error) {
    failed++;
    failures.push({ name, error });
    console.log('  ✗ ' + name);
    console.log('    ' + (error && error.message || String(error)));
  }
}
function reset() {
  routes.length = 0;
  calls.length = 0;
  P = createProviderSandbox();
}
function routeResolutionPages(host, slug) {
  const esc = value => String(value).replace(/\./g, '\\.');
  route(new RegExp('^' + esc(host) + '/episodes/' + esc(slug) + '/1/1920%20x%201080$'),
    () => ok(fixtures.episodes));
}
function routeStreamExtraction(host) {
  const esc = value => String(value).replace(/\./g, '\\.');
  route(new RegExp('^' + esc(host) + '/download/black-clover/1/1920%20x%201080/.*[?&]token=listing-token(?:&|$)'), () =>
    ok(fixtures.player));
  route(/^https:\/\/av1please\.com\/get_token$/, () =>
    ok(JSON.stringify({ token: 'fresh-token' })));
  route(FRESH_EPISODE_RE, () => ok(fixtures.player));
  route(new RegExp('^' + esc(host) + '/get_ddl/'), (url, options) => {
    assert.strictEqual(options.headers['X-Ddl-Token'], 'AAAAA1234567890');
    assert.ok(options.headers.Referer.includes('token=listing-token'), 'DDL lookup must refer to the signed source href');
    return ok(fixtures.ddl);
  });
  route(new RegExp('^' + esc(host) + '/watch/black-clover-ep-001$'), () =>
    ok('', host + '/watch/black-clover-ep-001'));
  route(new RegExp('^' + esc(host) + '/redirect/stream/black-clover-ep-001$'), () =>
    ok('', 'https://cdn.example.com/black-clover-ep-001.m3u8'));
  route(new RegExp('^' + esc(host) + '/redirect/download/black-clover-ep-001$'), () =>
    ok('', 'https://cdn.example.com/black-clover-ep-001.mp4'));
}

(async function run() {
  console.log('\nAV1Encodes AnimeAlpha session + signed playback integration tests\n');

  await test('search discovers Black Clover from an anime-card page', async () => {
    reset();
    route(/^https:\/\/av1please\.com\/search\?q=black%20clover&page=1$/, () => ok(fixtures.search));
    const items = await P.search('black clover', 1, {});
    assert.ok(items.some(item => item.title === 'Black Clover'));
    const result = items.find(item => item.title === 'Black Clover');
    assert.strictEqual(result.url, BASE + '/anime/' + SLUG);
  });

  await test('session cookie from a 403 is sent on the retry and subsequent page requests', async () => {
    reset();
    let searchAttempts = 0;
    route(/^https:\/\/av1please\.com\/$/, () => ok('<html>Home</html>'));
    route(/^https:\/\/av1please\.com\/search\?q=black%20clover&page=1$/, (url, options) => {
      searchAttempts++;
      const cookie = String(options.headers.Cookie || options.headers.cookie || '');
      if (cookie.includes('av1_client_id=client-123')) return ok(fixtures.search);
      return fail(403, 'Forbidden', {
        'Set-Cookie': 'av1_client_id=client-123; Path=/; Max-Age=600; HttpOnly; Secure'
      });
    });

    const items = await P.search('black clover', 1, {});
    assert.ok(items.some(item => item.title === 'Black Clover'),
      'source should recover when the server issues a normal session cookie');
    assert.ok(searchAttempts >= 2, 'the blocked request must be retried');
    assert.ok(calls.some(call =>
      call.url.indexOf('/search?') >= 0 &&
      String(call.options.headers.Cookie || call.options.headers.cookie || '').includes('av1_client_id=client-123')),
      'the cookie from Set-Cookie must persist across separate JS fetch calls');
  });

  await test('full path: search -> detail -> episode 1 -> extracted playable stream URLs', async () => {
    reset();
    route(/^https:\/\/av1please\.com\/search\?q=black%20clover&page=1$/, () => fail(403, 'Forbidden'));
    route(/^https:\/\/animealpha\.cc\/search\?q=black%20clover&page=1$/, () => ok(fixtures.search));
    route(/^https:\/\/animealpha\.cc\/anime\/black-clover$/, () => ok(fixtures.detail));
    routeResolutionPages(ALT, SLUG);
    routeStreamExtraction(ALT);

    const found = await P.search('black clover', 1, {});
    const anime = found.find(item => item.title === 'Black Clover');
    assert.ok(anime, 'search must return the target anime');
    assert.strictEqual(anime.url, ALT + '/anime/' + SLUG);

    const detail = await P.getDetail(anime.url, {});
    assert.strictEqual(detail.title, 'Black Clover');
    assert.ok(detail.episodes.length >= 2, 'detail must include the source episode list');

    const episodeOne = detail.episodes.find(item => item.number === 1);
    assert.ok(episodeOne, 'episode 1 must be identified by its filename number');
    assert.ok(episodeOne.url.startsWith(ALT + '/download/black-clover/1/'),
      'episode URL must preserve the domain serving the episode list');
    assert.ok(episodeOne.url.includes('token=listing-token'),
      'episode URL must preserve the upstream listing token');

    const streams = await P.getVideoSources(episodeOne.url);
    assert.ok(streams.some(source => source.url === ALT + '/dash/black-clover-ep-001/manifest.mpd'),
      'watch link must produce a DASH manifest URL');
    assert.ok(streams.some(source => source.url === 'https://cdn.example.com/black-clover-ep-001.m3u8'),
      'stream link must resolve to a playable HLS URL');
    assert.ok(streams.some(source => source.url === 'https://cdn.example.com/black-clover-ep-001.mp4'),
      'download link must resolve to a direct media URL');
    assert.ok(!streams.some(source => /\/download\//.test(source.url)),
      'HTML download pages must never be exposed as media streams');
    assert.ok(!calls.some(call => /\/get_token(?:\?|$)/.test(call.url)),
      'a valid signed episode URL with a player must not need a speculative token request');
  });

  await test('episode lookup tries the third official mirror after the pinned host and default fail', async () => {
    reset();
    route(/^https:\/\/av1encodes\.com\/anime\/black-clover$/, () => fail(403, 'Forbidden'));
    route(/^https:\/\/av1encodes\.com\/$/, () => ok('<html>Home</html>'));
    route(/^https:\/\/av1please\.com\/anime\/black-clover$/, () => fail(403, 'Forbidden'));
    routeResolutionPages(ALT, SLUG);
    route(/^https:\/\/animealpha\.cc\/anime\/black-clover$/, () => ok(fixtures.detail));

    const episodes = await P.getEpisodes(LEGACY + '/anime/black-clover', {});
    assert.ok(episodes.some(item => item.number === 1),
      'episodes must still load from mirror three when the first two hosts fail');
    assert.ok(episodes[0].url.startsWith(ALT + '/download/'));
    assert.ok(calls.some(call => call.url === ALT + '/anime/black-clover'));
    assert.ok(calls.some(call => call.url === ALT + '/episodes/black-clover/1/1920%20x%201080'));
  });

  await test('legacy metadata keeps Episode 45 addressable and resolves its embedded stream links', async () => {
    reset();
    const detail = '<html><body><h1>Long Anime</h1><div data-season="1">Season 1</div></body></html>';
    route(/^https:\/\/av1please\.com\/anime\/long-anime$/, () => ok(detail));

    const episodeItems = [];
    for (let n = 1; n <= 50; n++) {
      const padded = String(n).padStart(3, '0');
      const item = {
        num: n,
        label: 'Episode ' + String(n).padStart(2, '0'),
        href: '/download/long-anime/1/1920%20x%201080/%5BE' + padded +
          '%5D%20Long%20Anime%20%5B1080p%5D%20%5BDual%5D.mkv?token=token-' + n
      };
      if (n === 45) {
        item.ddl = {
          success: true,
          watch_link: '/watch/episode-45',
          stream_link: 'https://cdn.example.com/episode-45.m3u8',
          download_link: 'https://cdn.example.com/episode-45.mp4'
        };
      }
      episodeItems.push(item);
    }
    route(/^https:\/\/av1please\.com\/episodes\/long-anime\/1\/1920%20x%201080$/, () =>
      ok(JSON.stringify(episodeItems)));
    route(/^https:\/\/av1please\.com\/watch\/episode-45$/, () =>
      ok('', BASE + '/watch/episode-45'));

    const episodes = await P.getEpisodes(BASE + '/anime/long-anime', {});
    assert.strictEqual(episodes.length, 50, 'all 50 source episodes must survive parsing');
    assert.strictEqual(episodes[44].number, 45, 'Zangetsu resolves episode N using the Nth source-list entry');
    assert.strictEqual(episodes[44].title, 'Episode 45', 'legacy label formatting must be restored');
    assert.ok(episodes[44].url.includes('__av1ddl='), 'legacy inline DDL must remain attached to the episode URL');
    assert.ok(episodes[44].url.includes('token=token-45'));

    const streams = await P.getVideoSources(episodes[44].url);
    assert.ok(streams.some(stream => stream.url === BASE + '/dash/episode-45/manifest.mpd'),
      'episode 45 must yield a DASH URL');
    assert.ok(streams.some(stream => stream.url === 'https://cdn.example.com/episode-45.m3u8'),
      'episode 45 must yield its upstream HLS URL');
    assert.ok(streams.some(stream => stream.url === 'https://cdn.example.com/episode-45.mp4'),
      'episode 45 must yield its direct media URL');
  });

  await test('a terminal generator page on one mirror does not mask a healthy mirror', async () => {
    reset();
    route(/^https:\/\/av1please\.com\/download\/black-clover\/1\/1920%20x%201080\/.*[?&]token=listing-token(?:&|$)/,
      () => ok(fixtures.generatorError));
    route(/^https:\/\/animealpha\.cc\/download\/black-clover\/1\/1920%20x%201080\/.*[?&]token=listing-token(?:&|$)/,
      () => ok('<html><iframe id="anime-video-player" src="/watch/black-clover-ep-001"></iframe></html>'));
    route(/^https:\/\/animealpha\.cc\/watch\/black-clover-ep-001$/,
      () => ok('', ALT + '/watch/black-clover-ep-001'));

    const streams = await P.getVideoSources(BASE + EPISODE_PATH);
    assert.ok(streams.some(stream => stream.url === ALT + '/dash/black-clover-ep-001/manifest.mpd'),
      'a healthy mirror must be tried when the first mirror serves the terminal generator error');
    assert.ok(calls.some(call => call.url.startsWith(ALT + '/download/black-clover/1/')),
      'the signed episode URL must be tested against AnimeAlpha');
  });

  await test('upstream download-generator error is classified as no streams, never a fake media URL', async () => {
    reset();
    route(/^https:\/\/av1please\.com\/download\/black-clover\/1\/1920%20x%201080\/.*[?&]token=listing-token(?:&|$)/,
      () => ok(fixtures.generatorError));
    const episodeUrl = BASE + EPISODE_PATH;
    const streams = await P.getVideoSources(episodeUrl);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(streams)), []);
    assert.ok(!streams.some(source => /\/download\//.test(source.url)));
    assert.ok(!calls.some(call => /\/get_token(?:\?|$)/.test(call.url)),
      'the provider must not preflight /get_token when the signed page has a terminal generator error');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    for (const item of failures) {
      console.error('FAILED: ' + item.name);
      console.error(item.error && item.error.stack ? item.error.stack : item.error);
      console.error('');
    }
    process.exit(1);
  }
})();
