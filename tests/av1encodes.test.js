// Mock integration tests for the current AV1Encodes / AnimeAlpha routes.
// These tests use fixture HTML/JSON and do not claim live playback works.
// Run: node tests/av1encodes.test.js (Node 14+, no npm dependencies).

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROVIDER_PATH = path.join(__dirname, '..', 'providers', 'av1encodes.js');
const BASE = 'https://av1please.com';
const LEGACY_BASE = 'https://av1encodes.com';
const MIRROR = BASE;
const ANIMEALPHA = 'https://animealpha.cc';

function encodeName(name) {
  return encodeURIComponent(name);
}

const FILENAME = '[E001] One Piece 1999 [1080p] [Dual].mkv';
const ENCODED_FILENAME = encodeName(FILENAME);
const EP_URL = BASE + '/download/one-piece/1/1920%20x%201080/' +
  ENCODED_FILENAME + '?token=fixture-token';
const EP_URL_MIRROR = MIRROR + '/download/one-piece/1/1920%20x%201080/' +
  ENCODED_FILENAME + '?token=fixture-token';

const FIXTURES = {
  searchHtml: '<html><body>' +
    '<article class="anime-card"><a href="/anime/one-piece">' +
    '<img data-src="/covers/one-piece.jpg"><h3>One Piece</h3></a></article>' +
    '<article class="anime-card"><a href="/anime/naruto">' +
    '<img src="https://cdn.example.com/naruto.jpg"><h3>Naruto</h3></a></article>' +
    '<a class="anime-link" href="/anime/bleach"><h4>Bleach</h4></a>' +
    '</body></html>',

  animeListHtml: '<html><body><ul>' +
    '<li><a href="/anime/bleach">Bleach</a></li>' +
    '<li><a href="/anime/dandadan">Dandadan</a></li>' +
    '</ul></body></html>',

  detailHtml: '<html><head><meta property="og:image" content="/covers/one-piece.jpg"></head>' +
    '<body><h1>One Piece</h1><img data-src="/covers/one-piece.jpg">' +
    '<div class="anime-synopsis">A pirate adventure.</div>' +
    '<a href="/genre/action">Action</a><a href="/genre/adventure">Adventure</a>' +
    '<div class="season-tab" data-season="2">Season 2</div>' +
    '<div class="season-tab" data-season="1">Season 1</div>' +
    '</body></html>',

  season1Html: '<html><body>' +
    '<a href="/download/one-piece/1/1920%20x%201080/%5BE001%5D%20One%20Piece%20%5B1080p%5D%20%5BDual%5D.mkv?token=one">Episode 1 Dual</a>' +
    '<a href="/download/one-piece/1/1920%20x%201080/%5BE002%5D%20One%20Piece%20%5B1080p%5D%20%5BDual%5D.mkv?token=two">Episode 2 Dual</a>' +
    '</body></html>',

  season2Html: '<html><body>' +
    '<a href="/download/one-piece/2/1920%20x%201080/%5BE013%5D%20One%20Piece%20%5B1080p%5D%20%5BDual%5D.mkv?token=three">Episode 13 Dual</a>' +
    '</body></html>',

  lowQualityHtml: '<html><body>' +
    '<a href="/download/one-piece/1/1280%20x%20720/%5BE001%5D%20One%20Piece%20%5B720p%5D%20%5BDual%5D.mkv?token=720">Episode 1 Dual</a>' +
    '</body></html>',

  playerHtml: '<html><body><h1>One Piece</h1><p>Generating download link...</p>' +
    '<iframe id="anime-video-player" src="/watch/xyz"></iframe>' +
    '<script>window.__ddl_token = "AAAA1234567890";</script>' +
    '</body></html>',

  playerNoTokenHtml: '<html><body><h1>One Piece</h1>' +
    '<iframe id="anime-video-player" src="/watch/xyz"></iframe>' +
    '</body></html>',

  ddlJson: JSON.stringify({
    success: true,
    stream_link: '/redirect/stream/abc',
    download_link: '/redirect/dl/def',
    watch_link: '/watch/xyz',
    file_name: FILENAME,
    file_size: '1.4 GB',
    video_details: 'AV1 1080p',
    audio_details: 'Dual',
    subtitles: []
  }),

  popularHtml: '<html><body>' +
    '<article class="spotlight-slide"><a href="/anime/bleach">' +
    '<img data-src="/covers/bleach.jpg"><h3>Bleach</h3></a></article>' +
    '<article class="anime-card"><a href="/anime/one-piece">' +
    '<img src="/covers/one-piece.jpg"><h3>One Piece</h3></a></article>' +
    '</body></html>',

  latestHtml: '<html><body>' +
    '<article class="anime-card"><a href="/anime/dandadan">' +
    '<img data-lazy-src="/covers/dandadan.jpg"><h4>Dandadan</h4></a></article>' +
    '</body></html>'
};

const calls = [];
const routes = [];

function route(pattern, handler) {
  routes.push({ pattern, handler });
}

function ok(body, url) {
  const textBody = String(body == null ? '' : body);
  return {
    ok: true,
    status: 200,
    body: textBody,
    url: url || '',
    text: () => Promise.resolve(textBody)
  };
}

function notFound(status) {
  const code = status || 404;
  return {
    ok: false,
    status: code,
    body: '',
    url: '',
    text: () => Promise.resolve('')
  };
}

function mockFetch(url, opts) {
  const urlText = String(url);
  calls.push({ url: urlText, opts: opts || {} });
  for (const r of routes) {
    r.pattern.lastIndex = 0;
    if (r.pattern.test(urlText)) return Promise.resolve(r.handler(urlText, opts || {}));
  }
  return Promise.resolve(notFound());
}

const sandbox = {
  __SOURCE_ID: 'av1encodes',
  __settings: { av1encodes: {} },
  fetch: mockFetch,
  console,
  Promise, JSON, String, Number, Boolean, Object, Array, Math,
  RegExp, Error,
  encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
  setTimeout, clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(PROVIDER_PATH, 'utf8'), sandbox);
const P = sandbox;

assert.strictEqual(typeof P.getInfo, 'function', 'provider loaded');
assert.strictEqual(typeof P.search, 'function');
assert.strictEqual(typeof P.getDetail, 'function');
assert.strictEqual(typeof P.getEpisodes, 'function');
assert.strictEqual(typeof P.getVideoSources, 'function');
assert.strictEqual(typeof P.getHome, 'function');
assert.strictEqual(typeof P.getSettings, 'function');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log('  ✗ ' + name);
    console.log('    ' + (e && e.message ? e.message : String(e)));
  }
}

function reset() {
  calls.length = 0;
  routes.length = 0;
  sandbox.__settings = { av1encodes: {} };
}

function routeEpisodePages() {
  route(/\/episodes\/one-piece\/2\/1920%20x%201080/, () => ok(FIXTURES.season2Html));
  route(/\/episodes\/one-piece\/1\/1920%20x%201080/, () => ok(FIXTURES.season1Html));
  route(/\/episodes\/one-piece\/1\/1280%20x%20720/, () => ok(FIXTURES.lowQualityHtml));
  route(/\/episodes\/one-piece\//, () => ok('<html><body>No episodes at this quality</body></html>'));
}

(async function run() {
  console.log('\nAV1Encodes / AnimeAlpha provider tests\n');

  await test('getInfo uses the correct provider metadata and version', async () => {
    reset();
    const info = P.getInfo();
    assert.strictEqual(info.name, 'AV1Encodes');
    assert.strictEqual(info.lang, 'en');
    assert.strictEqual(info.type, 'anime');
    assert.strictEqual(info.version, '1.2.4');
    assert.ok(/^https?:\/\//.test(info.baseUrl));
  });

  await test('settings expose domain and 1080p/720p/480p/360p quality choices', async () => {
    reset();
    const settings = P.getSettings();
    const byKey = Object.fromEntries(settings.map(s => [s.key, s]));
    assert.ok(byKey.domain);
    assert.ok(byKey.quality);
    assert.strictEqual(byKey.quality.type, 'enum');
    assert.strictEqual(JSON.stringify(byKey.quality.options.map(o => o.value)),
      JSON.stringify(['1080p', '720p', '480p', '360p']));
  });

  await test('search parses multiple card results and lazy-loaded covers', async () => {
    reset();
    route(/\/search\?q=one%20piece&page=1/, () => ok(FIXTURES.searchHtml));
    const res = await P.search('one piece', 1, {});
    assert.strictEqual(res.length, 3);
    assert.strictEqual(res[0].title, 'One Piece');
    assert.strictEqual(res[0].url, BASE + '/anime/one-piece');
    assert.strictEqual(res[0].cover, BASE + '/covers/one-piece.jpg');
    assert.strictEqual(res[0].sourceId, 'av1encodes');
    assert.ok(res.some(x => x.title === 'Naruto'));
    assert.ok(res.some(x => x.title === 'Bleach'));
    assert.strictEqual(new Set(res.map(x => x.url)).size, res.length);
  });

  await test('blank search browses the A-Z anime list starting at page zero', async () => {
    reset();
    route(/\/anime\?page=0/, () => ok(FIXTURES.animeListHtml));
    const res = await P.search('', 1, {});
    assert.strictEqual(res.length, 2);
    assert.ok(res.some(x => x.title === 'Bleach'));
    assert.ok(res.some(x => x.title === 'Dandadan'));
  });

  await test('search fails over to another official mirror when av1please.com returns 403', async () => {
    reset();
    route(/^https:\/\/av1please\.com\/search\?q=naruto/, () => notFound(403));
    route(/^https:\/\/animealpha\.cc\/search\?q=naruto/, () => ok(FIXTURES.searchHtml));
    route(/^https:\/\/av1encodes\.com\/search\?q=naruto/, () => notFound(403));
    const res = await P.search('naruto', 1, {});
    assert.strictEqual(res.length, 3);
    assert.ok(res.every(x => x.url.indexOf(ANIMEALPHA + '/') === 0));
  });

  await test('search returns an empty array when every domain fails', async () => {
    reset();
    route(/\/search/, () => notFound(403));
    const res = await P.search('x', 1, {});
    assert.strictEqual(res.length, 0);
  });

  await test('search warms up the site session after 403 and retries the same route', async () => {
    reset();
    sandbox.__settings = { av1encodes: { domain: LEGACY_BASE } };
    let attempts = 0;
    route(/^https:\/\/av1encodes\.com\/search\?q=warmup/, () => {
      attempts++;
      return attempts === 1 ? notFound(403) : ok(FIXTURES.searchHtml);
    });
    route(/^https:\/\/av1please\.com\/$/, () => ok(FIXTURES.popularHtml));
    const res = await P.search('warmup', 1, {});
    assert.strictEqual(attempts, 2);
    assert.strictEqual(res.length, 3);
    assert.ok(calls.some(call => call.url === LEGACY_BASE + '/'));
  });

  await test('getDetail returns metadata and episodes from dimension-based routes', async () => {
    reset();
    route(/\/anime\/one-piece$/, () => ok(FIXTURES.detailHtml));
    routeEpisodePages();
    const detail = await P.getDetail(BASE + '/anime/one-piece', {});
    assert.strictEqual(detail.title, 'One Piece');
    assert.strictEqual(detail.cover, BASE + '/covers/one-piece.jpg');
    assert.strictEqual(detail.description, 'A pirate adventure.');
    assert.strictEqual(JSON.stringify(detail.genres), JSON.stringify(['Action', 'Adventure']));
    assert.strictEqual(detail.type, 'anime');
    assert.strictEqual(detail.sourceId, 'av1encodes');
    assert.strictEqual(detail.episodes.length, 3);
    assert.ok(calls.some(c => c.url.indexOf('/episodes/one-piece/2/1920%20x%201080') >= 0));
  });

  await test('getEpisodes returns real download routes with token query strings intact', async () => {
    reset();
    route(/\/anime\/one-piece$/, () => ok(FIXTURES.detailHtml));
    routeEpisodePages();
    const episodes = await P.getEpisodes(BASE + '/anime/one-piece', {});
    assert.strictEqual(episodes.length, 3);
    for (const episode of episodes) {
      assert.ok(episode.id);
      assert.ok(episode.url);
      assert.strictEqual(typeof episode.number, 'number');
      assert.ok(episode.url.indexOf('/download/one-piece/') >= 0);
      assert.ok(/\?token=/.test(episode.url));
    }
    // Zangetsu Mode canonicalizes by list position, so source entries must be
    // chronological or canonical episode 1 can map to the source's latest file.
    assert.strictEqual(episodes.map(ep => ep.number).join(','), '1,2,13');
    assert.strictEqual(episodes[0].title, 'Episode 1');
    assert.strictEqual(episodes[1].title, 'Episode 2');
    assert.strictEqual(episodes[2].title, 'Episode 13');
    assert.ok(episodes.every(ep => !/Season\s+\d|\bDual\b|\bDub\b|\bSub\b/i.test(ep.title)));
  });

  await test('getEpisodes tries lower resolutions when the preferred quality has no episodes', async () => {
    reset();
    route(/\/anime\/one-piece$/, () => ok(FIXTURES.detailHtml));
    route(/\/episodes\/one-piece\/2\//, () => ok('<html></html>'));
    route(/\/episodes\/one-piece\/1\/1920%20x%201080/, () => ok('<html><body>Empty quality</body></html>'));
    route(/\/episodes\/one-piece\/1\/1280%20x%20720/, () => ok(FIXTURES.lowQualityHtml));
    route(/\/episodes\/one-piece\//, () => ok('<html></html>'));
    const episodes = await P.getEpisodes(BASE + '/anime/one-piece', {});
    assert.strictEqual(episodes.length, 1);
    assert.ok(/1280%20x%20720/.test(episodes[0].url));
  });

  await test('episode JSON responses are supported as well as HTML', async () => {
    reset();
    route(/\/anime\/one-piece$/, () => ok('<html><h1>One Piece</h1><div data-season="1"></div></html>'));
    const json = JSON.stringify([{
      num: 1,
      href: '/download/one-piece/1/1920%20x%201080/%5BE001%5D%20One%20Piece%20%5B1080p%5D.mkv?token=json',
      label: 'Episode 1'
    }]);
    route(/\/episodes\/one-piece\/1\/1920%20x%201080/, () => ok(json));
    route(/\/episodes\/one-piece\//, () => ok('<html></html>'));
    const episodes = await P.getEpisodes(BASE + '/anime/one-piece', {});
    assert.strictEqual(episodes.length, 1);
    assert.strictEqual(episodes[0].number, 1);
    assert.ok(/token=json/.test(episodes[0].url));
  });

  await test('fresh-token lookup succeeds on the active av1please.com mirror', async () => {
    reset();
    route(/^https:\/\/av1please\.com\/get_token$/, () => ok(JSON.stringify({ token: 'mirror-token-456' })));
    route(/^https:\/\/av1please\.com\/download\/one-piece\/1\/.*[?&]token=mirror-token-456/, () =>
      ok(FIXTURES.playerHtml));
    route(/\/get_ddl\//, () => ok(FIXTURES.ddlJson));
    route(/\/watch\/xyz/, () => ok('', 'https://animealpha.cc/watch/xyz'));
    route(/\/redirect\/stream\/abc/, () =>
      ok('', 'https://cdn.example.com/stream/one-piece-e001.mp4'));
    route(/\/redirect\/dl\/def/, () =>
      ok('', 'https://cdn.example.com/dl/one-piece-e001.mkv'));
    route(/\/episodes\/one-piece\//, () => ok('<html></html>'));

    const streams = await P.getVideoSources(EP_URL);
    assert.ok(calls.some(call => call.url === BASE + '/get_token'));
    assert.ok(calls.some(call => call.url.indexOf(BASE + '/download/one-piece/1/') === 0 &&
      /[?&]token=mirror-token-456(?:&|$)/.test(call.url)));
    assert.ok(streams.some(stream => /DASH/.test(stream.quality) &&
      stream.url === ANIMEALPHA + '/dash/xyz/manifest.mpd'));
  });

  await test('getVideoSources refreshes expired episode token before fetching the download page', async () => {
    reset();
    route(/\/get_token$/, () => ok(JSON.stringify({ token: 'fresh-token-123' })));
    route(/\/download\/one-piece\/1\/.*[?&]token=fresh-token-123/, () =>
      ok(FIXTURES.playerHtml));
    route(/\/get_ddl\//, (url, opts) => {
      assert.strictEqual(opts.headers['X-Ddl-Token'], 'AAAA1234567890');
      return ok(FIXTURES.ddlJson);
    });
    route(/\/watch\/xyz/, () => ok('', BASE + '/watch/xyz'));
    route(/\/redirect\/stream\/abc/, () =>
      ok('', 'https://cdn.example.com/stream/one-piece-e001.mp4'));
    route(/\/redirect\/dl\/def/, () =>
      ok('', 'https://cdn.example.com/dl/one-piece-e001.mkv'));
    route(/\/episodes\/one-piece\//, () => ok('<html></html>'));

    const streams = await P.getVideoSources(EP_URL);
    assert.ok(calls.some(call => /\/get_token$/.test(call.url)));
    const downloadCalls = calls.filter(call => /\/download\/one-piece\/1\//.test(call.url));
    assert.ok(downloadCalls.some(call => /[?&]token=fresh-token-123(?:&|$)/.test(call.url)));
    assert.ok(downloadCalls.every(call => !/[?&]token=fixture-token(?:&|$)/.test(call.url)));
    assert.ok(streams.some(stream => /DASH/.test(stream.quality) && /\.mpd/.test(stream.url)));
  });

  await test('getVideoSources resolves iframe DASH, stream, and direct download links', async () => {
    reset();
    route(/\/download\/one-piece\/1\//, () => ok(FIXTURES.playerHtml));
    route(/\/get_ddl\//, (url, opts) => {
      assert.strictEqual(opts.headers['X-Ddl-Token'], 'AAAA1234567890');
      return ok(FIXTURES.ddlJson);
    });
    route(/\/watch\/xyz/, () => ok('', BASE + '/watch/xyz'));
    route(/\/redirect\/stream\/abc/, () =>
      ok('', 'https://cdn.example.com/stream/one-piece-e001.mp4'));
    route(/\/redirect\/dl\/def/, () =>
      ok('', 'https://cdn.example.com/dl/one-piece-e001.mkv'));
    route(/\/episodes\/one-piece\//, () => ok('<html></html>'));

    const streams = await P.getVideoSources(EP_URL);
    assert.ok(streams.length >= 3);
    assert.ok(streams.some(s => /DASH/.test(s.quality) &&
      s.url === BASE + '/dash/xyz/manifest.mpd' && s.container === 'unknown'));
    assert.ok(streams.some(s => /Stream/.test(s.quality) &&
      s.url === 'https://cdn.example.com/stream/one-piece-e001.mp4' && s.container === 'mp4'));
    assert.ok(streams.some(s => /Direct DL/.test(s.quality) &&
      s.url === 'https://cdn.example.com/dl/one-piece-e001.mkv' && s.container === 'unknown'));
    for (const s of streams) {
      assert.ok(typeof s.url === 'string' && s.url.length > 0);
      assert.ok(['hls', 'mp4', 'unknown'].includes(s.container));
      assert.ok(['sub', 'dub'].includes(s.kind));
      assert.ok(Array.isArray(s.subtitles));
      assert.ok(s.headers && typeof s.headers === 'object');
    }
  });

  await test('getVideoSources uses the embedded player even without a DDL token', async () => {
    reset();
    route(/\/download\/one-piece\/1\//, () => ok(FIXTURES.playerNoTokenHtml));
    route(/\/watch\/xyz/, () => ok('', BASE + '/watch/xyz'));
    route(/\/episodes\/one-piece\//, () => ok('<html></html>'));
    const streams = await P.getVideoSources(EP_URL);
    assert.ok(streams.some(s => s.url === BASE + '/dash/xyz/manifest.mpd'));
  });

  await test('getVideoSources does not mislabel an HTML download page as a playable stream', async () => {
    reset();
    route(/\/download\/one-piece\/1\//, () => ok('<html><body>No player or DDL token</body></html>'));
    route(/\/episodes\/one-piece\//, () => ok('<html></html>'));
    const streams = await P.getVideoSources(EP_URL);
    assert.strictEqual(streams.length, 0);
  });

  await test('getVideoSources stops checking further resolutions after finding a playable stream', async () => {
    reset();
    route(/\/get_token$/, () => ok(JSON.stringify({ token: 'fresh-token-fast' })));
    route(/\/download\/one-piece\/1\/1920%20x%201080\/.*[?&]token=fresh-token-fast/, () =>
      ok(FIXTURES.playerNoTokenHtml));
    route(/\/watch\/xyz/, () => ok('', BASE + '/watch/xyz'));
    route(/\/episodes\/one-piece\//, () => ok('<html><body>No alternate episodes</body></html>'));

    const streams = await P.getVideoSources(EP_URL);
    assert.ok(streams.some(stream => /DASH/.test(stream.quality)));
    assert.ok(!calls.some(call => /\/episodes\/one-piece\/1\/1280%20x%20720/.test(call.url)),
      'must not scan lower resolutions once a playable stream exists');
  });

  await test('getVideoSources applies request timeouts and stops fallback after blocked playback route', async () => {
    reset();
    route(/\/get_token$/, () => notFound(503));
    route(/\/download\/one-piece\/1\//, () => notFound(403));
    const streams = await P.getVideoSources(EP_URL);
    assert.strictEqual(streams.length, 0);
    assert.ok(calls.some(call => /\/get_token$/.test(call.url) && call.opts.timeoutMs === 1500));
    assert.ok(calls.some(call => /\/download\/one-piece\/1\//.test(call.url) && call.opts.timeoutMs === 1500));
    assert.ok(!calls.some(call => /\/episodes\/one-piece\//.test(call.url)),
      'must stop instead of retrying all lower resolutions after a blocked route');
  });

  await test('getVideoSources falls back to 720p when the 1080p link generator fails', async () => {
    reset();
    route(/\/get_token$/, () => ok(JSON.stringify({ token: 'fresh-fallback-token' })));
    route(/\/download\/one-piece\/1\/1920%20x%201080\/.*[?&]token=fresh-fallback-token/, () =>
      ok('<html><body><h1>Oops! Something went wrong</h1><p>Unable to generate download link</p></body></html>'));
    route(/\/episodes\/one-piece\/1\/1280%20x%20720/, () => ok(FIXTURES.lowQualityHtml));
    route(/\/download\/one-piece\/1\/1280%20x%20720\/.*[?&]token=fresh-fallback-token/, () =>
      ok(FIXTURES.playerNoTokenHtml));
    route(/\/watch\/xyz/, () => ok('', BASE + '/watch/xyz'));
    const streams = await P.getVideoSources(EP_URL);
    assert.ok(calls.some(call => /\/episodes\/one-piece\/1\/1280%20x%20720/.test(call.url)),
      'must attempt the next quality after link generation fails');
    assert.ok(streams.some(stream => /720p/.test(stream.quality) && /DASH/.test(stream.quality)));
    assert.ok(!calls.some(call => /\/episodes\/one-piece\/1\/854%20x%20480/.test(call.url)),
      'must stop checking qualities after finding a playable stream');
  });

  await test('getVideoSources searches other resolutions for the same episode', async () => {
    reset();
    route(/\/episodes\/one-piece\/1\/1280%20x%20720/, () => ok(FIXTURES.lowQualityHtml));
    route(/\/download\/one-piece\/1\/1280%20x%20720\//, () => ok(FIXTURES.playerNoTokenHtml));
    route(/\/watch\/xyz/, () => ok('', BASE + '/watch/xyz'));
    route(/\/episodes\/one-piece\//, () => ok('<html></html>'));
    const streams = await P.getVideoSources(EP_URL);
    assert.ok(calls.some(c => c.url.indexOf('/episodes/one-piece/1/1280%20x%20720') >= 0));
    assert.ok(streams.some(s => /720p/.test(s.quality) && /DASH/.test(s.quality)));
  });

  await test('getHome parses the homepage spotlight and latest cards separately', async () => {
    reset();
    route(/^https:\/\/av1please\.com\/$/, () => ok(FIXTURES.popularHtml));
    const sections = await P.getHome({});
    const popular = sections.find(s => s.title === 'Popular');
    const latest = sections.find(s => s.title === 'Latest');
    assert.ok(popular);
    assert.ok(latest);
    assert.strictEqual(popular.items[0].title, 'Bleach');
    assert.strictEqual(latest.items[0].title, 'One Piece');
  });

  await test('custom domain and preferred quality settings are honored', async () => {
    reset();
    sandbox.__settings.av1encodes = {
      domain: 'https://mirror.example.com',
      quality: '720p'
    };
    assert.strictEqual(P.getInfo().baseUrl, 'https://mirror.example.com');
    route(/^https:\/\/mirror\.example\.com\/anime\/one-piece$/, () => ok(FIXTURES.detailHtml));
    route(/\/episodes\/one-piece\/2\/1280%20x%20720/, () => ok(FIXTURES.season2Html));
    route(/\/episodes\/one-piece\/1\/1280%20x%20720/, () => ok(FIXTURES.season1Html));
    route(/\/episodes\/one-piece\//, () => ok('<html></html>'));
    const detail = await P.getDetail('https://mirror.example.com/anime/one-piece', {});
    assert.strictEqual(detail.episodes.length, 3);
    assert.ok(calls.some(c => /\/episodes\/one-piece\/1\/1280%20x%20720/.test(c.url)));
  });

  await test('container detection never mislabels MKV as MP4', async () => {
    reset();
    route(/\/download\/one-piece\/1\//, () => ok(FIXTURES.playerNoTokenHtml));
    route(/\/watch\/xyz/, () => ok('', BASE + '/watch/xyz'));
    route(/\/episodes\/one-piece\//, () => ok('<html></html>'));
    const streams = await P.getVideoSources(EP_URL);
    for (const stream of streams) {
      assert.notStrictEqual(stream.container, 'mkv');
      assert.ok(!/\.mpd(\?|#|$)/i.test(stream.url) || stream.container === 'unknown');
    }
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    for (const failure of failures) {
      console.error('FAILED: ' + failure.name);
      console.error(failure.error && failure.error.stack ? failure.error.stack : failure.error);
      console.error('');
    }
    process.exit(1);
  }
})();
