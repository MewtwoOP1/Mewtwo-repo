// test/av1encodes.test.js
// Mock tests for the AV1Encodes Zangetsu provider.
// These verify the provider contract against fixture HTML/JSON.
// They do NOT hit the live site — see "Known limitations" at the bottom.
//
// Run: node test/av1encodes.test.js
// Requires: Node 14+, no npm deps.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROVIDER_PATH = path.join(__dirname, '..', 'providers', 'av1encodes.js');
const BASE = 'https://av1encodes.com';

// ── Fixtures ──────────────────────────────────────────────────────────

const FIXTURES = {
  searchHtml: `<html><body>
    <article class="anime-card">
      <a href="/anime/one-piece"><img data-src="/covers/one-piece.jpg" /></a>
      <h3>One Piece</h3>
    </article>
    <article class="anime-card">
      <a href="/anime/naruto"><img src="https://cdn.example.com/naruto.jpg" /></a>
      <h3>Naruto</h3>
    </article>
  </body></html>`,

  animeListHtml: `<html><body>
    <ul>
      <li><a href="/anime/bleach">Bleach</a></li>
      <li><a href="/anime/dandadan">Dandadan</a></li>
    </ul>
  </body></html>`,

  detailHtml: `<html><body>
    <h1>One Piece</h1>
    <img data-src="/covers/one-piece.jpg" />
    <div class="synopsis">A pirate adventure.</div>
    <a href="/genre/action">Action</a>
    <a href="/genre/adventure">Adventure</a>
    <div class="season-tab" data-season="2">Season 2</div>
    <div class="season-tab" data-season="1">Season 1</div>
  </body></html>`,

  season1Html: `<html><body>
    <a href="/download/1/One Piece - E001 - [1080p] [Dual].mkv">One Piece E001</a>
    <a href="/download/1/One Piece - E002 - [1080p] [Dual].mkv">One Piece E002</a>
  </body></html>`,

  season2Html: `<html><body>
    <a href="/download/2/One Piece - E013 - [1080p] [Dual].mkv">One Piece E013</a>
  </body></html>`,

  episodePageHtml: `<html><body>
    <script>window.__ddl_token = "AAAA1234567890";</script>
  </body></html>`,

  ddlJson: JSON.stringify({
    success: true,
    stream_link: '/redirect/stream/abc',
    download_link: '/redirect/dl/def',
    watch_link: '/watch/xyz',
    file_name: 'One Piece - E001 - [1080p] [Dual].mkv',
    file_size: '1.4 GB',
    video_details: 'AV1 1080p',
    audio_details: 'Dual',
    subtitles: []
  }),

  popularHtml: `<html><body>
    <h2>Top Downloads</h2>
    <article class="anime-card">
      <a href="/anime/bleach"><h3>Bleach</h3></a>
    </article>
  </body></html>`,

  latestHtml: `<html><body>
    <article class="anime-card">
      <a href="/anime/dandadan"><h3>Dandadan</h3></a>
    </article>
  </body></html>`
};

const EP_URL =
  BASE + '/download/1/One%20Piece%20-%20E001%20-%20%5B1080p%5D%20%5BDual%5D.mkv';

// ── Mock fetch ────────────────────────────────────────────────────────

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

function notFound() {
  return {
    ok: false,
    status: 404,
    body: '',
    url: '',
    text: () => Promise.resolve('')
  };
}

function mockFetch(url, opts) {
  calls.push({ url, opts: opts || {} });
  for (const r of routes) {
    if (r.pattern.test(String(url))) {
      return Promise.resolve(r.handler(String(url), opts || {}));
    }
  }
  return Promise.resolve(notFound());
}

// ── Sandbox ──────────────────────────────────────────────────────────

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

// ── Runner ───────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  \u2713 ' + name);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log('  \u2717 ' + name);
    console.log('    ' + (e && e.message ? e.message : String(e)));
  }
}

function reset() {
  calls.length = 0;
  routes.length = 0;
  sandbox.__settings = { av1encodes: {} };
}

// ── Tests ────────────────────────────────────────────────────────────

(async function run() {
  console.log('\nAV1Encodes provider tests\n');

  await test('getInfo returns anime source with correct shape', async () => {
    reset();
    const info = P.getInfo();
    assert.strictEqual(info.name, 'AV1Encodes');
    assert.strictEqual(info.lang, 'en');
    assert.strictEqual(info.type, 'anime');
    assert.ok(/^https?:\/\//.test(info.baseUrl), 'baseUrl is absolute');
    assert.strictEqual(typeof info.version, 'string');
  });

  await test('getSettings declares domain and quality', async () => {
    reset();
    const s = P.getSettings();
    assert.ok(Array.isArray(s));
    const byKey = Object.fromEntries(s.map(x => [x.key, x]));
    assert.ok(byKey.domain, 'domain setting present');
    assert.ok(byKey.quality, 'quality setting present');
    assert.strictEqual(byKey.quality.type, 'enum');
    assert.ok(byKey.quality.options.some(o => o.value === '1080p'));
  });

  await test('search(query) hits /search and parses cards', async () => {
    reset();
    route(/\/search\?q=/, () => ok(FIXTURES.searchHtml));
    const res = await P.search('one piece', 1, {});
    assert.strictEqual(res.length, 2);
    assert.strictEqual(res[0].title, 'One Piece');
    assert.strictEqual(res[0].url, BASE + '/anime/one-piece');
    assert.strictEqual(res[0].cover, BASE + '/covers/one-piece.jpg');
    assert.strictEqual(res[0].type, 'anime');
    assert.strictEqual(res[0].sourceId, 'av1encodes');
    assert.strictEqual(res[1].title, 'Naruto');
    assert.strictEqual(res[1].cover, 'https://cdn.example.com/naruto.jpg');
  });

  await test('search(empty) hits /anime and parses list layout', async () => {
    reset();
    route(/\/anime\?page=1/, () => ok(FIXTURES.animeListHtml));
    const res = await P.search('', 1, {});
    assert.strictEqual(res.length, 2);
    assert.strictEqual(res[0].title, 'Bleach');
    assert.strictEqual(res[1].title, 'Dandadan');
  });

  await test('search returns [] on network failure', async () => {
    reset();
    route(/\/search/, notFound);
    const res = await P.search('x', 1, {});
    assert.strictEqual(res.length, 0);
  });

  await test('getDetail returns metadata + episodes', async () => {
    reset();
    route(/\/anime\/one-piece$/, () => ok(FIXTURES.detailHtml));
    route(/\/episodes\/one-piece\/2\/1080p/, () => ok(FIXTURES.season2Html));
    route(/\/episodes\/one-piece\/1\/1080p/, () => ok(FIXTURES.season1Html));

    const d = await P.getDetail(BASE + '/anime/one-piece', {});
    assert.strictEqual(d.title, 'One Piece');
    assert.strictEqual(d.cover, BASE + '/covers/one-piece.jpg');
    assert.strictEqual(d.description, 'A pirate adventure.');
    assert.strictEqual(JSON.stringify(d.genres), JSON.stringify(['Action', 'Adventure']));
    assert.strictEqual(d.status, 'completed');
    assert.strictEqual(d.type, 'anime');
    assert.strictEqual(d.sourceId, 'av1encodes');
    assert.ok(Array.isArray(d.episodes));
    assert.strictEqual(d.episodes.length, 3);
  });

  await test('getEpisodes returns episode list', async () => {
    reset();
    route(/\/anime\/one-piece$/, () => ok(FIXTURES.detailHtml));
    route(/\/episodes\/one-piece\/2\/1080p/, () => ok(FIXTURES.season2Html));
    route(/\/episodes\/one-piece\/1\/1080p/, () => ok(FIXTURES.season1Html));

    const eps = await P.getEpisodes(BASE + '/anime/one-piece', {});
    assert.strictEqual(eps.length, 3);
    for (const ep of eps) {
      assert.ok(ep.id, 'episode id present');
      assert.ok(ep.url, 'episode url present');
      assert.strictEqual(typeof ep.number, 'number');
      assert.strictEqual(typeof ep.title, 'string');
    }
  });

  await test('getVideoSources parses token, calls get_ddl, resolves links', async () => {
    reset();
    route(/\/download\/1\//, () => ok(FIXTURES.episodePageHtml));
    route(/\/get_ddl\//, (url, opts) => {
      assert.strictEqual(opts.headers['X-Ddl-Token'], 'AAAA1234567890');
      return ok(FIXTURES.ddlJson);
    });
    route(/\/redirect\/stream\/abc/, () =>
      ok('', 'https://cdn.example.com/stream/one-piece-e001.mp4'));
    route(/\/redirect\/dl\/def/, () =>
      ok('', 'https://cdn.example.com/dl/one-piece-e001.mkv'));

    const streams = await P.getVideoSources(EP_URL);
    assert.strictEqual(streams.length, 2);

    const s1 = streams.find(s => /Stream/.test(s.quality));
    const s2 = streams.find(s => /Direct DL/.test(s.quality));
    assert.ok(s1, 'stream source present');
    assert.ok(s2, 'download source present');

    assert.strictEqual(s1.url, 'https://cdn.example.com/stream/one-piece-e001.mp4');
    assert.strictEqual(s1.container, 'mp4');
    assert.strictEqual(s1.kind, 'sub');
    assert.ok(/AV1/.test(s1.quality));
    assert.ok(/1080p/.test(s1.quality));

    assert.strictEqual(s2.url, 'https://cdn.example.com/dl/one-piece-e001.mkv');
    assert.strictEqual(s2.container, 'unknown');

    for (const s of streams) {
      assert.ok(typeof s.url === 'string' && s.url.length > 0);
      assert.ok(['hls', 'mp4', 'unknown'].includes(s.container), 'container in contract set');
      assert.ok(['sub', 'dub'].includes(s.kind), 'kind in contract set');
      assert.ok(Array.isArray(s.subtitles));
      assert.ok(s.headers && typeof s.headers === 'object');
    }
  });

  await test('getVideoSources falls back when no ddl-token present', async () => {
    reset();
    route(/\/download\/1\//, () => ok('<html><body>no token here</body></html>'));
    const streams = await P.getVideoSources(EP_URL);
    assert.strictEqual(streams.length, 1);
    assert.strictEqual(streams[0].container, 'unknown');
    assert.ok(/Direct DL/.test(streams[0].quality));
    assert.strictEqual(streams[0].url, EP_URL);
  });

  await test('getVideoSources falls back when get_ddl returns non-JSON', async () => {
    reset();
    route(/\/download\/1\//, () => ok(FIXTURES.episodePageHtml));
    route(/\/get_ddl\//, () => ok('not json'));
    const streams = await P.getVideoSources(EP_URL);
    assert.strictEqual(streams.length, 1);
  });

  await test('getVideoSources falls back when success is false', async () => {
    reset();
    route(/\/download\/1\//, () => ok(FIXTURES.episodePageHtml));
    route(/\/get_ddl\//, () => ok(JSON.stringify({ success: false })));
    const streams = await P.getVideoSources(EP_URL);
    assert.strictEqual(streams.length, 1);
  });

  await test('getVideoSources falls back when both redirects fail', async () => {
    reset();
    route(/\/download\/1\//, () => ok(FIXTURES.episodePageHtml));
    route(/\/get_ddl\//, () => ok(FIXTURES.ddlJson));
    route(/\/redirect\/stream\/abc/, notFound);
    route(/\/redirect\/dl\/def/, notFound);
    const streams = await P.getVideoSources(EP_URL);
    assert.strictEqual(streams.length, 1);
    assert.ok(/Direct DL/.test(streams[0].quality));
  });

  await test('getVideoSources surfaces HTTP 403 as fallback', async () => {
    reset();
    route(/\/download\/1\//, () => ({ ok: false, status: 403, body: '', url: '' }));
    const streams = await P.getVideoSources(EP_URL);
    assert.strictEqual(streams.length, 1);
    assert.strictEqual(streams[0].url, EP_URL);
  });

  await test('getHome returns Popular and Latest sections', async () => {
    reset();
    route(/\/stats$/, () => ok(FIXTURES.popularHtml));
    route(/^https:\/\/av1encodes\.com\/$/, () => ok(FIXTURES.latestHtml));
    const sections = await P.getHome({});
    assert.ok(sections.length >= 1);
    const titles = sections.map(s => s.title);
    assert.ok(titles.includes('Popular'));
    assert.ok(titles.includes('Latest'));
    const pop = sections.find(s => s.title === 'Popular');
    assert.strictEqual(pop.items[0].title, 'Bleach');
    const lat = sections.find(s => s.title === 'Latest');
    assert.strictEqual(lat.items[0].title, 'Dandadan');
  });

  await test('domain and quality settings are honored', async () => {
    reset();
    sandbox.__settings.av1encodes = {
      domain: 'https://mirror.example.com',
      quality: '720p'
    };
    assert.strictEqual(P.getInfo().baseUrl, 'https://mirror.example.com');

    route(/^https:\/\/mirror\.example\.com\/anime\/one-piece$/, () =>
      ok(FIXTURES.detailHtml));
    route(/\/episodes\/one-piece\/2\/720p/, () => ok(FIXTURES.season2Html));
    route(/\/episodes\/one-piece\/1\/720p/, () => ok(FIXTURES.season1Html));

    const d = await P.getDetail('https://mirror.example.com/anime/one-piece', {});
    assert.strictEqual(d.episodes.length, 3);
    assert.ok(
      calls.some(c => /\/720p/.test(c.url)),
      'quality=720p was used in episode request'
    );
  });

  await test('getVideoSources exposes a resolved DASH manifest as unknown container', async () => {
    reset();
    route(/\/download\/1\//, () => ok(FIXTURES.episodePageHtml));
    route(/\/get_ddl\//, () => ok(FIXTURES.ddlJson));
    route(/\/watch\/xyz/, () =>
      ok('', 'https://media.example.com/watch/xyz'));
    route(/\/redirect\/stream\/abc/, notFound);
    route(/\/redirect\/dl\/def/, notFound);

    const streams = await P.getVideoSources(EP_URL);
    assert.strictEqual(streams.length, 1);
    assert.strictEqual(
      streams[0].url,
      'https://media.example.com/dash/xyz/manifest.mpd'
    );
    assert.strictEqual(streams[0].container, 'unknown');
    assert.ok(/DASH/.test(streams[0].quality));
    assert.ok(streams[0].headers && typeof streams[0].headers === 'object');
  });

  await test('all returned stream containers are in the contract set', async () => {
    reset();
    route(/\/download\/1\//, () => ok(FIXTURES.episodePageHtml));
    route(/\/get_ddl\//, () => ok(FIXTURES.ddlJson));
    route(/\/redirect\/stream\/abc/, () =>
      ok('', 'https://cdn.example.com/stream/e001.mp4'));
    route(/\/redirect\/dl\/def/, () =>
      ok('', 'https://cdn.example.com/dl/e001.mkv'));
    const streams = await P.getVideoSources(EP_URL);
    const allowed = ['hls', 'mp4', 'unknown'];
    for (const s of streams) {
      assert.ok(allowed.includes(s.container), 'container=' + s.container);
    }
  });

  // ── Summary ────────────────────────────────────────────────────────

  console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
  if (failed > 0) {
    for (const f of failures) {
      console.error('FAILED: ' + f.name);
      console.error(f.error && f.error.stack ? f.error.stack : f.error);
      console.error('');
    }
    process.exit(1);
  }
})();
