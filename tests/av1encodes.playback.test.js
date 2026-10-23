// AV1Encodes regression tests for the clean Yuzuno source port.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROVIDER_PATH = path.join(__dirname, '..', 'providers', 'av1encodes.js');
const BASE = 'https://av1encodes.com';
const routes = [];
const calls = [];
function route(pattern, handler) { routes.push({ pattern, handler }); }
function reply(body, url, status, headers) {
  const text = String(body == null ? '' : body);
  const code = status == null ? 200 : status;
  return {
    status: code,
    ok: code >= 200 && code < 300,
    url: url || '',
    headers: headers || {},
    body: text,
    text: () => Promise.resolve(text)
  };
}
function mockFetch(url, options) {
  const target = String(url);
  calls.push({ url: target, options: options || {} });
  for (const r of routes) {
    r.pattern.lastIndex = 0;
    if (r.pattern.test(target)) return Promise.resolve(r.handler(target, options || {}));
  }
  return Promise.resolve(reply('not found: ' + target, target, 404));
}
function freshProvider() {
  routes.length = 0;
  calls.length = 0;
  const sandbox = {
    __SOURCE_ID: 'av1encodes',
    __settings: { av1encodes: {
      preferred_domain: BASE,
      preferred_quality: '1920 x 1080',
      preferred_link_type: 'Stream',
      show_torrent: false
    } },
    fetch: mockFetch,
    console: { log: console.log, warn: () => {}, error: console.error },
    Promise, JSON, String, Number, Boolean, Object, Array, Math, RegExp, Error, Date,
    Set, Map, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, setTimeout, clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(PROVIDER_PATH, 'utf8'), sandbox, { filename: PROVIDER_PATH });
  return sandbox;
}
let P = freshProvider();
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + (e && e.stack || String(e))); }
}
function json(value) { return JSON.parse(JSON.stringify(value)); }

(async function run() {
  console.log('\nAV1Encodes Yuzuno-port regression tests\n');

  await test('provider contract and upstream preference values match the manifest', async () => {
    P = freshProvider();
    assert.strictEqual(P.getInfo().name, 'AV1Encodes');
    assert.strictEqual(P.getInfo().lang, 'en');
    assert.strictEqual(P.getInfo().version, '1.1.9');
    const settings = P.getSettings();
    assert.deepStrictEqual(json(settings.map(s => s.key)), [
      'preferred_domain', 'preferred_quality', 'preferred_link_type', 'show_torrent'
    ]);
    assert.strictEqual(settings[0].default, BASE);
    assert.deepStrictEqual(json(settings[0].options.map(o => o.value)), [
      'https://av1encodes.com', 'https://animealpha.cc', 'https://av1please.com'
    ]);
    assert.deepStrictEqual(json(settings[1].options.map(o => o.value)), [
      '1920 x 1080', '1280 x 720', '854 x 480', '640 x 360'
    ]);
    assert.deepStrictEqual(json(settings[2].options.map(o => o.value)), ['Stream', 'Direct DL', 'Dash', 'Torrent']);
  });

  await test('search uses upstream route and preserves source title and poster', async () => {
    P = freshProvider();
    const html = '<html><body><article class="anime-card"><a href="/anime/black-clover">' +
      '<h3>Black Clover</h3><img src="/covers/black-clover.jpg"></a></article></body></html>';
    route(/^https:\/\/av1encodes\.com\/search\?q=Black%20Clover&page=1$/, () => reply(html));
    const results = await P.search('Black Clover', 1, {});
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].title, 'Black Clover');
    assert.strictEqual(results[0].url, '/anime/black-clover');
    assert.strictEqual(results[0].cover, BASE + '/covers/black-clover.jpg');
    assert.ok(calls.some(c => c.url === BASE + '/search?q=Black%20Clover&page=1'));
  });

  await test('detail metadata uses upstream selectors, genre fallback, and airing status', async () => {
    P = freshProvider();
    const html = '<html><head><meta property="og:image" content="/meta-cover.jpg"></head><body>' +
      '<section class="anime-hero"><h1>Source Detail Title</h1><img class="anime-poster" src="/poster.jpg"></section>' +
      '<div class="anime-synopsis">Source synopsis text.</div>' +
      '<p class="anime-meta">Type: TV | Genre: Adventure, Fantasy | Status: Airing</p>' +
      '<span class="studio-name">Source Studio</span><span class="status-airing">Airing</span>' +
      '<div class="season-tab" data-season="1"></div></body></html>';
    route(/^https:\/\/av1encodes\.com\/anime\/metadata-show$/, () => reply(html));
    route(/^https:\/\/av1encodes\.com\/episodes\/metadata-show\/1\/.*$/, () => reply('[]'));
    const detail = await P.getDetail('/anime/metadata-show', {});
    assert.strictEqual(detail.title, 'Source Detail Title');
    assert.strictEqual(detail.cover, BASE + '/poster.jpg');
    assert.strictEqual(detail.description, 'Source synopsis text.');
    assert.strictEqual(detail.genre, 'Adventure, Fantasy');
    assert.deepStrictEqual(json(detail.genres), ['Adventure', 'Fantasy']);
    assert.strictEqual(detail.author, 'Source Studio');
    assert.strictEqual(detail.status, 'ongoing');
  });

  await test('season buckets and JSON items follow the exact upstream sort and label behavior', async () => {
    P = freshProvider();
    const animeHtml = '<html><body>' +
      '<div class="season-tab" data-season="1"></div>' +
      '<div class="season-option" data-season="4"></div>' +
      '<div class="season-tab" data-season="2"></div></body></html>';
    const item = (num, label, hrefSeason, ep, token) => ({
      num, label,
      href: '/download/mixed-show/' + hrefSeason + '/1920%20x%201080/%5BE' +
        String(ep).padStart(3, '0') + '%5D%20Mixed%20Show%20%5B1080p%5D.mkv?token=' + token
    });
    const season1 = [
      item(1, 'Season 1 Ep 01 - Mixed Show', 4, 1, 's1e1'),
      item(2, 'Season 1 Ep 02 - Mixed Show', 4, 2, 's1e2')
    ];
    const season2 = [item(1, 'Season 2 Ep 01 - Mixed Show', 2, 1, 's2e1')];
    const season4 = [
      item(1, 'Season 4 Ep 01 - Mixed Show', 1, 1, 's4e1'),
      item(2, 'Season 4 Ep 02 - Mixed Show', 1, 2, 's4e2')
    ];
    route(/^https:\/\/av1encodes\.com\/anime\/mixed-show$/, () => reply(animeHtml));
    route(/^https:\/\/av1encodes\.com\/episodes\/mixed-show\/4\/1920%20x%201080$/, () => reply(JSON.stringify(season4)));
    route(/^https:\/\/av1encodes\.com\/episodes\/mixed-show\/2\/1920%20x%201080$/, () => reply(JSON.stringify(season2)));
    route(/^https:\/\/av1encodes\.com\/episodes\/mixed-show\/1\/1920%20x%201080$/, () => reply(JSON.stringify(season1)));
    const episodes = await P.getEpisodes('/anime/mixed-show', {});
    // Upstream sorts data-season selectors numerically descending, and each
    // JSON bucket by its own source num descending. Labels/URL route season are
    // deliberately contradictory; neither is used to "correct" the sequence.
    assert.deepStrictEqual(json(episodes.map(e => e.title)), [
      'Season 4 Ep 02 - Mixed Show',
      'Season 4 Ep 01 - Mixed Show',
      'Season 2 Ep 01 - Mixed Show',
      'Season 1 Ep 02 - Mixed Show',
      'Season 1 Ep 01 - Mixed Show'
    ]);
    // setUrlWithoutDomain() in Aniyomi returns the source-relative href;
    // Zangetsu keeps that same relative URL in its episode record.
    assert.deepStrictEqual(json(episodes.map(e => e.url)), [
      season4[1].href, season4[0].href,
      season2[0].href, season1[1].href, season1[0].href
    ]);
    assert.deepStrictEqual(json(episodes.map(e => e.number)), [2, 1, 1, 2, 1]);
  });

  await test('HTML episode fallback uses the upstream descending E-number rule within a season', async () => {
    P = freshProvider();
    const animeHtml = '<html><body><div data-season="1"></div></body></html>';
    route(/^https:\/\/av1encodes\.com\/anime\/fallback-show$/, () => reply(animeHtml));
    route(/^https:\/\/av1encodes\.com\/episodes\/fallback-show\/1\/1920%20x%201080$/, () =>
      reply('<html><body><a href="/download/fallback-show/1/1920%20x%201080/%5BE001%5D%20Fallback%20Show%20%5B1080p%5D.mkv">Ep 1</a>' +
        '<a href="/download/fallback-show/1/1920%20x%201080/%5BE003%5D%20Fallback%20Show%20%5B1080p%5D.mkv">Ep 3</a>' +
        '<a href="/download/fallback-show/1/1920%20x%201080/%5BE002%5D%20Fallback%20Show%20%5B1080p%5D.mkv">Ep 2</a></body></html>'));
    const episodes = await P.getEpisodes('/anime/fallback-show', {});
    assert.deepStrictEqual(json(episodes.map(e => e.title)), [
      'Season 1 Ep 003 - Fallback Show',
      'Season 1 Ep 002 - Fallback Show',
      'Season 1 Ep 001 - Fallback Show'
    ]);
  });

  await test('playback resolves upstream iframe, DDL stream/direct links and DASH', async () => {
    P = freshProvider();
    const filename = '%5BE001%5D%20Black%20Clover%20%5B1080p%5D%20%5BDual%5D.mkv';
    const makeHref = res => '/download/black-clover/1/' + encodeURIComponent(res) .replace(/%20/g, '%20') + '/' + filename + '?token=token-1';
    const episodePath = '/download/black-clover/1/1920%20x%201080/' + filename + '?token=token-1';
    const qualities = ['1920%20x%201080', '1280%20x%20720', '854%20x%20480', '640%20x%20360'];
    for (const quality of qualities.slice(1)) {
      route(new RegExp('^https://av1encodes\\\\.com/episodes/black-clover/1/' + quality + '$'), () =>
        reply('<html><body><a href="/download/black-clover/1/' + quality + '/' + filename +
          '?token=token-1">Episode 1</a></body></html>'));
    }
    route(/^https:\/\/av1encodes\.com\/download\/black-clover\/1\/.*E001.*$/, () =>
      reply('<html><body><iframe id="anime-video-player" src="/watch/ep-001"></iframe>' +
        '<script>window.__ddl_token = "AAAAA1234567890";</script></body></html>'));
    route(/^https:\/\/av1encodes\.com\/get_ddl\/.*$/, () => reply(JSON.stringify({
      success: true,
      watch_link: 'https://av1encodes.com/watch/ep-001',
      stream_link: 'https://av1encodes.com/redirect/stream/ep-001',
      download_link: 'https://av1encodes.com/redirect/download/ep-001.mp4',
      torrent_link: 'https://av1encodes.com/redirect/torrent/ep-001'
    })));
    route(/^https:\/\/av1encodes\.com\/watch\/ep-001$/, () => reply('', BASE + '/watch/ep-001'));
    route(/^https:\/\/av1encodes\.com\/redirect\/stream\/ep-001$/, () => reply('', 'https://cdn.example.com/ep-001.m3u8'));
    route(/^https:\/\/av1encodes\.com\/redirect\/download\/ep-001\.mp4$/, () => reply('', 'https://cdn.example.com/ep-001.mp4'));
    route(/^https:\/\/av1encodes\.com\/redirect\/torrent\/ep-001$/, () => reply('', 'https://cdn.example.com/ep-001.torrent'));
    const videos = await P.getVideoSources(episodePath, {});
    assert.ok(videos.some(v => v.linkType === 'Stream' && v.url === 'https://cdn.example.com/ep-001.m3u8'));
    assert.ok(videos.some(v => v.linkType === 'Direct DL' && v.url === 'https://cdn.example.com/ep-001.mp4'));
    assert.ok(videos.some(v => v.linkType === 'Dash' && v.url === BASE + '/dash/ep-001/manifest.mpd'));
    assert.ok(videos.every(v => v.headers && v.headers.Referer === BASE + '/'));
  });

  await test('preferred hoster and show-torrent options are taken from the source preferences', async () => {
    P = freshProvider();
    P.__settings.av1encodes.preferred_link_type = 'Direct DL';
    P.__settings.av1encodes.show_torrent = true;
    const episodePath = '/download/show/1/1920%20x%201080/%5BE001%5D%20Show%20%5B1080p%5D.mkv?token=x';
    route(/^https:\/\/av1encodes\.com\/download\/show\/1\/.*$/, () =>
      reply('<html><body><iframe id="anime-video-player" src="/watch/example"></iframe></body></html>'));
    route(/^https:\/\/av1encodes\.com\/episodes\/show\/1\/.*$/, () =>
      reply('<html><body><a href="/download/show/1/1920%20x%201080/%5BE001%5D%20Show%20%5B1080p%5D.mkv?token=x">Episode 1</a></body></html>'));
    const result = await P.getVideoSources(episodePath, {});
    // DDL/token is absent, so the source's fallback direct link remains available.
    assert.ok(result.length);
    assert.strictEqual(result[0].linkType, 'Direct DL');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed) process.exitCode = 1;
})().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
