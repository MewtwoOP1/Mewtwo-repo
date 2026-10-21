// AV1Encodes v1.0.2 full integration regression tests; all network calls are mocked.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const PROVIDER_PATH = path.join(__dirname, '..', 'providers', 'av1encodes.js');
const BASE = 'https://av1please.com';
const LEGACY = 'https://av1encodes.com';
const ALT = 'https://animealpha.cc';
const FILENAME = '[S01-E01] One Piece 1999 [1080p] [Dual].mkv';
const ENCODED_FILENAME = encodeURIComponent(FILENAME);
const EP_URL = BASE + '/download/one-piece/1/1920%20x%201080/' + ENCODED_FILENAME + '?token=expired-token';
const FIXTURES = {
  detail: '<html><head><meta property="og:image" content="/covers/one-piece.jpg">' +
    '<meta name="description" content="Pirate adventure."></head><body><h1>One Piece</h1>' +
    '<img data-src="/covers/one-piece.jpg"><div class="anime-synopsis">A pirate adventure.</div>' +
    '<a href="/genre/action">Action</a><a href="/genre/adventure">Adventure</a>' +
    '<div data-season="1">Season 1</div><div data-season="2">Season 2</div></body></html>',
  episodesJson: JSON.stringify([
    { num: 2, label: 'Episode 02', href: '/download/one-piece/1/1920%20x%201080/%5BS01-E02%5D%20One%20Piece%20%5B1080p%5D%20%5BDual%5D.mkv?token=old-two' },
    { num: 1, label: 'Episode 01', href: '/download/one-piece/1/1920%20x%201080/%5BS01-E01%5D%20One%20Piece%201999%20%5B1080p%5D%20%5BDual%5D.mkv?token=old-one',
      ddl: { success: true, watch_link: '/watch/one-piece-01', stream_link: '/redirect/stream/one-piece-01',
        download_link: '/redirect/download/one-piece-01', torrent_link: 'magnet:?xt=urn:btih:abcdef' } }
  ]),
  emptyEpisodes: '<html><body>No episodes at this resolution.</body></html>',
  player: '<html><body><iframe id="anime-video-player" src="/watch/one-piece-01"></iframe>' +
    '<script>window.__ddl_token = "AAAAA1234567890";</script></body></html>',
  playerWithoutToken: '<html><body><iframe id="anime-video-player" src="/watch/one-piece-01"></iframe></body></html>',
  ddl: JSON.stringify({ success: true, watch_link: '/watch/one-piece-01',
    stream_link: '/redirect/stream/one-piece-01', download_link: '/redirect/download/one-piece-01',
    file_name: FILENAME, file_size: '1.4 GB', subtitles: [] }),
  home: '<html><article class="spotlight-slide"><a href="/anime/bleach"><h3>Bleach</h3></a></article>' +
    '<article class="anime-card"><a href="/anime/one-piece"><h3>One Piece</h3></a></article>' +
    '<article class="latest-panel"><a href="/anime/naruto"><h3>Naruto</h3></a></article></html>',
  search: '<html><article class="anime-card"><a href="/anime/one-piece"><h3>One Piece</h3></a></article>' +
    '<article class="anime-card"><a href="/anime/naruto"><h3>Naruto</h3></a></article>' +
    '<a class="anime-link" href="/anime/bleach"><h4>Bleach</h4></a></html>'
};
const routes = [];
const calls = [];
function route(pattern, handler) { routes.push({ pattern: pattern, handler: handler }); }
function ok(body, url) {
  const text = String(body == null ? '' : body);
  return { ok: true, status: 200, body: text, url: url || '', text: () => Promise.resolve(text) };
}
function fail(status, body) {
  const text = String(body || '');
  return { ok: false, status: status || 404, body: text, url: '', text: () => Promise.resolve(text) };
}
function mockFetch(url, options) {
  const target = String(url);
  calls.push({ url: target, options: options || {} });
  for (const r of routes) {
    r.pattern.lastIndex = 0;
    if (r.pattern.test(target)) return Promise.resolve(r.handler(target, options || {}));
  }
  return Promise.resolve(fail(404));
}
const sandbox = {
  __SOURCE_ID: 'av1encodes',
  __settings: { av1encodes: {} },
  fetch: mockFetch, console,
  Promise, JSON, String, Number, Boolean, Object, Array, Math, RegExp, Error,
  encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(PROVIDER_PATH, 'utf8'), sandbox);
const P = sandbox;
for (const key of ['getInfo','getSettings','getHome','search','getDetail','getEpisodes','getVideoSources','getStreams']) {
  assert.strictEqual(typeof P[key], 'function', key + ' should be exported');
}
let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; failures.push({ name: name, error: e }); console.log('  ✗ ' + name); console.log('    ' + (e && e.message || String(e))); }
}
function reset() {
  routes.length = 0; calls.length = 0; sandbox.__settings = { av1encodes: {} };
}
function routeDetail(slug, html) {
  route(new RegExp('/anime/' + slug + '$'), () => ok(html || FIXTURES.detail));
}
function routeEpisodePage(slug, season, resolution, body) {
  const encoded = encodeURIComponent(resolution);
  const esc = value => value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  route(new RegExp('/episodes/' + esc(slug) + '/' + esc(String(season)) + '/' + esc(encoded) + '$'), () => ok(body));
}
function routeRedirects() {
  route(/\/watch\/one-piece-01/, () => ok('', BASE + '/watch/one-piece-01'));
  route(/\/redirect\/stream\/one-piece-01/, () => ok('', 'https://cdn.example.com/one-piece-01.mp4'));
  route(/\/redirect\/download\/one-piece-01/, () => ok('', 'https://cdn.example.com/one-piece-01.mkv'));
}

(async function run() {
  console.log('\nAV1Encodes v1.0.2 full integration regression tests\n');

  await test('v1.0.2 provider contract and metadata', async () => {
    reset();
    assert.strictEqual(P.getInfo().name, 'AV1Encodes');
    assert.strictEqual(P.getInfo().version, '1.0.2');
    assert.strictEqual(P.getInfo().type, 'anime');
    assert.strictEqual(P.getInfo().lang, 'en');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(P.getSettings().map(x => x.key))), ['domain','quality','showTorrent']);
    const domain = P.getSettings().find(x => x.key === 'domain');
    assert.strictEqual(domain.type, 'enum');
    assert.strictEqual(domain.default, 'auto');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(domain.options.map(x => x.value))),
      ['auto', BASE, ALT, LEGACY]);
  });

  await test('search parses anime cards, covers and distinct URLs', async () => {
    reset();
    route(/\/search\?q=one%20piece&page=1/, () => ok(FIXTURES.search));
    const items = await P.search('one piece', 1, {});
    assert.strictEqual(items.length, 3);
    assert.ok(items.some(x => x.title === 'One Piece'));
    assert.ok(items.some(x => x.title === 'Naruto'));
    assert.ok(items.some(x => x.title === 'Bleach'));
    assert.strictEqual(new Set(items.map(x => x.url)).size, items.length);
  });

  await test('catalogue request fails over to a mirror after 403', async () => {
    reset();
    route(/^https:\/\/av1please\.com\/search\?q=naruto/, () => fail(403));
    route(/^https:\/\/animealpha\.cc\/search\?q=naruto/, () => ok(FIXTURES.search));
    const items = await P.search('naruto', 1, {});
    assert.strictEqual(items.length, 3);
    assert.ok(items.every(x => x.url.indexOf(ALT + '/') === 0));
  });

  await test('auto mode preserves the successful fallback domain through search, detail, episodes and playback URL', async () => {
    reset();
    // The default mirror is blocked; the second mirror serves the same title.
    route(/^https:\/\/av1please\.com\/search\?q=one%20piece&page=1$/, () => fail(403));
    route(/^https:\/\/animealpha\.cc\/search\?q=one%20piece&page=1$/, () => ok(FIXTURES.search));

    const results = await P.search('one piece', 1, {});
    const show = results.find(item => item.title === 'One Piece');
    assert.ok(show);
    assert.ok(show.url.startsWith(ALT + '/'));

    const detailHtml = '<html><body><h1>One Piece</h1><div data-season="1">Season 1</div></body></html>';
    route(/^https:\/\/animealpha\.cc\/anime\/one-piece$/, () => ok(detailHtml));
    route(/^https:\/\/animealpha\.cc\/episodes\/one-piece\/1\/1920%20x%201080$/, () => ok(FIXTURES.episodesJson));

    const detail = await P.getDetail(show.url, {});
    assert.strictEqual(detail.title, 'One Piece');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(detail.episodes.map(ep => ep.number))), [1, 2]);
    assert.ok(detail.episodes.every(ep => ep.url.startsWith(ALT + '/download/')),
      'episode links must stay on the mirror that returned the episode list');

    // Playback calls getEpisodes again. A successful detail result must be
    // reused, not re-fetched from the known-bad default mirror.
    const before = calls.length;
    const episodes = await P.getEpisodes(show.url, {});
    assert.strictEqual(episodes.length, 2);
    assert.strictEqual(calls.length, before, 'non-empty episode cache should avoid a duplicate detail/episode request');
    assert.ok(!calls.some(call => call.url.startsWith(BASE + '/episodes/')),
      'episode requests must not switch back to the default host');
    assert.strictEqual(episodes[0].url, detail.episodes[0].url);
  });

  await test('explicit optional domain selection intentionally overrides a known absolute anime URL', async () => {
    reset();
    sandbox.__settings = { av1encodes: { domain: ALT } };
    route(/^https:\/\/animealpha\.cc\/anime\/one-piece$/, () =>
      ok('<html><body><h1>One Piece</h1><div data-season="1"></div></body></html>'));
    route(/^https:\/\/animealpha\.cc\/episodes\/one-piece\/1\/1280%20x%20720$/, () => ok(FIXTURES.episodesJson));

    const episodes = await P.getEpisodes(BASE + '/anime/one-piece', {});
    assert.strictEqual(episodes.length, 2);
    assert.ok(calls.some(call => call.url === ALT + '/anime/one-piece'));
    assert.ok(calls.some(call => call.url === ALT + '/episodes/one-piece/1/1280%20x%20720'));
    assert.ok(!calls.some(call => call.url === BASE + '/anime/one-piece'));
  });

  await test('403 warm-up retries the original request once', async () => {
    reset();
    let count = 0;
    route(/^https:\/\/av1please\.com\/search\?q=warmup/, () => ++count === 1 ? fail(403) : ok(FIXTURES.search));
    route(/^https:\/\/av1please\.com\/$/, () => ok(FIXTURES.home));
    assert.strictEqual((await P.search('warmup', 1, {})).length, 3);
    assert.strictEqual(count, 2);
    assert.ok(calls.some(x => x.url === BASE + '/'));
  });

  await test('home separates popular and latest rows', async () => {
    reset();
    route(/^https:\/\/av1please\.com\/$/, () => ok(FIXTURES.home));
    const rows = await P.getHome({});
    assert.ok(rows.some(x => x.title === 'Popular'));
    assert.ok(rows.some(x => x.title === 'Latest'));
    assert.strictEqual(rows.find(x => x.title === 'Popular').items[0].title, 'Bleach');
    assert.ok(rows.find(x => x.title === 'Latest').items.some(x => x.title === 'One Piece'));
  });

  await test('detail parser extracts metadata and genres', async () => {
    reset();
    routeDetail('one-piece');
    for (const season of ['1','2']) {
      for (const quality of ['1920 x 1080','1280 x 720','854 x 480','640 x 360']) {
        routeEpisodePage('one-piece', season, quality, FIXTURES.emptyEpisodes);
      }
    }
    const detail = await P.getDetail(BASE + '/anime/one-piece', {});
    assert.strictEqual(detail.title, 'One Piece');
    assert.strictEqual(detail.cover, BASE + '/covers/one-piece.jpg');
    assert.strictEqual(detail.description, 'A pirate adventure.');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(detail.genres)), ['Action','Adventure']);
    assert.strictEqual(detail.episodes.length, 0);
  });

  await test('current episodes JSON is parsed, sorted, and carries inline DDL', async () => {
    reset();
    routeDetail('one-piece');
    routeEpisodePage('one-piece', '1', '1920 x 1080', FIXTURES.episodesJson);
    const items = await P.getEpisodes(BASE + '/anime/one-piece', {});
    assert.strictEqual(items.length, 2);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(items.map(x => x.number))), [1,2]);
    assert.strictEqual(items[0].title, 'Episode 01');
    assert.ok(items[0].url.indexOf('token=old-one') >= 0);
    assert.ok(!items[0].url.includes('__av1ddl='));
    assert.ok(!Object.prototype.hasOwnProperty.call(items[0], 'ddl'),
      'source episode objects should not expose synthetic DDL metadata');
  });

  await test('absolute upstream episode href keeps its signed host and token', async () => {
    reset();
    routeDetail('one-piece', '<html><body><h1>One Piece</h1><div data-season="1"></div></body></html>');
    const absoluteJson = JSON.stringify([{
      num: 1,
      label: 'Episode 01',
      href: 'https://av1encodes.com/download/one-piece/1/1920%20x%201080/%5BS01-E01%5D%20One%20Piece%20%5B1080p%5D.mkv?token=signed-for-legacy-host'
    }]);
    routeEpisodePage('one-piece', '1', '1920 x 1080', absoluteJson);
    const episodes = await P.getEpisodes(BASE + '/anime/one-piece', {});
    assert.strictEqual(episodes.length, 1);
    assert.ok(episodes[0].url.startsWith(LEGACY + '/download/'));
    assert.ok(episodes[0].url.endsWith('?token=signed-for-legacy-host'));
  });

  await test('HTML episode links parse S01-E01 names and retain the listing token', async () => {
    reset();
    routeDetail('one-piece');
    const html = '<html><a href="/download/one-piece/1/1920%20x%201080/%5BS01-E01%5D%20One%20Piece%201999%20%5B1080p%5D%20%5BDual%5D.mkv?token=episode-token">Episode 01 Dual</a>' +
      '<a href="/download/one-piece/1/1920%20x%201080/%5BS01-E02%5D%20One%20Piece%20%5B1080p%5D%20%5BDual%5D.mkv?token=second">Episode 02 Dual</a></html>';
    routeEpisodePage('one-piece', '1', '1920 x 1080', html);
    const items = await P.getEpisodes(BASE + '/anime/one-piece', {});
    assert.strictEqual(items.length, 2);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(items.map(x => x.number))), [1,2]);
    assert.strictEqual(items[0].title, 'Episode 01 Dual');
    assert.ok(items[0].url.endsWith('?token=episode-token'));
    assert.ok(!items[0].url.includes('__av1ddl='));
  });

  await test('episode listing falls back when the preferred resolution has no entries', async () => {
    reset();
    routeDetail('one-piece');
    routeEpisodePage('one-piece','1','1920 x 1080',FIXTURES.emptyEpisodes);
    routeEpisodePage('one-piece','1','1280 x 720',
      '<html><a href="/download/one-piece/1/1280%20x%20720/%5BE01%5D%20One%20Piece%20%5B720p%5D.mkv?token=720-token">Episode 1</a></html>');
    const items = await P.getEpisodes(BASE + '/anime/one-piece', {});
    assert.strictEqual(items.length, 1);
    assert.ok(items[0].url.indexOf('1280%20x%20720') >= 0);
  });

  await test('inline DDL avoids the stale-token and download-page waterfall', async () => {
    reset();
    routeDetail('one-piece');
    routeEpisodePage('one-piece','1','1920 x 1080',FIXTURES.episodesJson);
    routeRedirects();
    const items = await P.getEpisodes(BASE + '/anime/one-piece', {});
    const ep = items.find(x => x.number === 1);
    assert.ok(ep);
    calls.length = 0;
    const sources = await P.getVideoSources(ep.url);
    assert.ok(sources.some(x => /DASH/.test(x.quality) && x.url === BASE + '/dash/one-piece-01/manifest.mpd'),
      'inline DDL did not resolve; episode=' + ep.url + '; sources=' + JSON.stringify(sources) +
      '; calls=' + JSON.stringify(calls.map(x => x.url)));
    assert.ok(sources.some(x => /Stream/.test(x.quality) && x.url === 'https://cdn.example.com/one-piece-01.mp4'));
    assert.ok(sources.some(x => /Direct DL/.test(x.quality) && x.url === 'https://cdn.example.com/one-piece-01.mkv'));
    assert.ok(!calls.some(x => /\/get_token(?:\?|$)/.test(x.url)));
    assert.ok(!calls.some(x => /\/get_ddl\//.test(x.url)));
    assert.ok(!calls.some(x => /\/download\/one-piece\/1\//.test(x.url)));
  });

  await test('playback refreshes expired token and uses it on the download request', async () => {
    reset();
    route(/\/get_token$/, () => ok(JSON.stringify({ token: 'fresh-token-123' })));
    route(/\/download\/one-piece\/1\/1920%20x%201080\/.*[?&]token=fresh-token-123/, () => ok(FIXTURES.player));
    route(/\/get_ddl\//, (url, opts) => {
      assert.strictEqual(opts.headers['X-Ddl-Token'], 'AAAAA1234567890');
      assert.ok(opts.headers.Referer.indexOf('token=fresh-token-123') >= 0);
      return ok(FIXTURES.ddl);
    });
    routeRedirects();
    const sources = await P.getVideoSources(EP_URL);
    assert.ok(sources.some(x => /DASH/.test(x.quality)));
    const downloads = calls.filter(x => /\/download\/one-piece\/1\//.test(x.url));
    assert.ok(downloads.length > 0);
    assert.ok(downloads.every(x => /[?&]token=fresh-token-123(?:&|$)/.test(x.url)));
    assert.ok(downloads.every(x => !/[?&]token=expired-token(?:&|$)/.test(x.url)));
  });

  await test('iframe can produce DASH when the page has no DDL token', async () => {
    reset();
    route(/\/get_token$/, () => ok(JSON.stringify({ token: 'fresh-token' })));
    route(/\/download\/one-piece\/1\/1920%20x%201080\/.*[?&]token=fresh-token/, () => ok(FIXTURES.playerWithoutToken));
    routeRedirects();
    const sources = await P.getVideoSources(EP_URL);
    assert.ok(sources.some(x => /DASH/.test(x.quality) && /\/dash\/one-piece-01\/manifest\.mpd$/.test(x.url)));
    assert.ok(!calls.some(x => /\/get_ddl\//.test(x.url)));
  });

  await test('token failure does not return an HTML download page as video', async () => {
    reset();
    route(/\/get_token$/, () => fail(503));
    const sources = await P.getVideoSources(EP_URL);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sources)), []);
    assert.ok(!calls.some(x => /\/download\/one-piece\/1\//.test(x.url)));
  });

  await test('terminal HTML error is not returned as a media URL', async () => {
    reset();
    route(/\/get_token$/, () => ok(JSON.stringify({ token: 'fresh-token' })));
    route(/\/download\/one-piece\/1\/.*[?&]token=fresh-token/,
      () => ok('<html><h1>Oops! Something went wrong</h1><p>Unable to generate download link</p></html>'));
    const sources = await P.getVideoSources(EP_URL);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sources)), []);
    assert.ok(!sources.some(x => /\/download\//.test(x.url)));
  });

  await test('direct media URL is accepted but a site download route is not', async () => {
    reset();
    const direct = await P.getVideoSources('https://cdn.example.com/video.m3u8');
    assert.strictEqual(direct.length, 1);
    assert.strictEqual(direct[0].container, 'hls');
    const siteHtml = await P.getVideoSources(EP_URL.replace(/\.mkv\?token=.*$/, '.mkv'));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(siteHtml)), []);
  });

  await test('configured domain and preferred quality are honored', async () => {
    reset();
    sandbox.__settings = { av1encodes: { domain: ALT, quality: '720p' } };
    assert.strictEqual(P.getInfo().baseUrl, ALT);
    routeDetail('one-piece');
    routeEpisodePage('one-piece','1','1280 x 720',FIXTURES.episodesJson);
    routeEpisodePage('one-piece','2','1280 x 720',FIXTURES.episodesJson);
    const items = await P.getEpisodes(ALT + '/anime/one-piece', {});
    assert.ok(items.length > 0);
    assert.ok(calls.some(x => /\/episodes\/one-piece\/1\/1280%20x%20720/.test(x.url)));
  });

  await test('container detection keeps MP4 distinct and DASH as unknown', async () => {
    reset();
    route(/\/get_token$/, () => ok(JSON.stringify({ token: 'fresh-token' })));
    route(/\/download\/one-piece\/1\/1920%20x%201080\/.*[?&]token=fresh-token/, () => ok(FIXTURES.player));
    route(/\/get_ddl\//, () => ok(FIXTURES.ddl));
    routeRedirects();
    const sources = await P.getVideoSources(EP_URL);
    assert.ok(sources.some(x => x.container === 'mp4'));
    assert.ok(sources.some(x => x.container === 'unknown' && /\.mpd$/.test(x.url)));
    assert.ok(sources.every(x => x.url && x.headers && Array.isArray(x.subtitles)));
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) {
    failures.forEach(f => {
      console.error('FAILED: ' + f.name);
      console.error(f.error && f.error.stack ? f.error.stack : f.error);
      console.error('');
    });
    process.exit(1);
  }
})();
