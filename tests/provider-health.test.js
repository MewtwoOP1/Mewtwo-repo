'use strict';

/*
 * Provider health contract + optional live stream-content smoke test.
 *
 * This file is intentionally provider-agnostic: it does not edit provider code,
 * patch provider globals, or require provider-specific selectors/URLs. The only
 * inputs assumed are the public methods validated by scripts/check-and-run.mjs
 * and the standard shapes consumed by Zangetsu.
 *
 * Default CI mode is network-isolated and deterministic:
 *   - checks manifest/provider public contract and cleartext HTTP literals;
 *   - runs public entry points against a controlled HTTP 503 response;
 *   - verifies every attempted fetch uses an absolute HTTPS URL;
 *   - tests that stream probing distinguishes playable content from HTML/errors.
 *
 * Optional live mode:
 *   PROVIDER_HEALTH_CASES='{"av1encodes":{"args":["/download/.../episode.mkv",true]}}'
 *   node tests/provider-health.test.js
 *
 * Each key must be a manifest source ID. The value may specify "method"
 * (default: getVideoSources) and "args" (an array passed to that public method).
 * Live mode requires a case for each provider the user wants checked; no
 * provider-specific episode IDs, domains, or CSS selectors are hardcoded here.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PROVIDERS_DIR = path.join(ROOT, 'providers');
const MANIFEST_PATH = path.join(ROOT, 'index.json');
const HEALTH_QUERY = 'provider-health-check-no-results-9d84731';
const CALL_TIMEOUT_MS = 3000;
const LIVE_TIMEOUT_MS = 20000;
const MAX_LIVE_STREAM_PROBES = 3;
const nativeFetch = global.fetch;

let pass = 0;
let fail = 0;
const failures = [];
const warnings = [];

function ok(name, condition, details) {
  if (condition) {
    pass += 1;
    console.log('  [PASS] ' + name);
  } else {
    fail += 1;
    const message = name + (details ? ' — ' + details : '');
    failures.push(message);
    console.error('  [FAIL] ' + message);
  }
}

function note(message) {
  warnings.push(message);
  console.log('  [INFO] ' + message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function headersObject(values) {
  const lower = {};
  Object.keys(values || {}).forEach(function (key) {
    lower[key.toLowerCase()] = String(values[key]);
  });
  return {
    get: function (name) { return lower[String(name).toLowerCase()] || null; },
    forEach: function (callback) {
      Object.keys(lower).forEach(function (key) { callback(lower[key], key); });
    },
    entries: function () { return Object.entries(lower)[Symbol.iterator](); }
  };
}

function mockResponse(url, status, body, headerValues) {
  const payload = body == null ? '' : body;
  const headers = headersObject(Object.assign({
    'content-type': 'text/html; charset=utf-8'
  }, headerValues || {}));
  return {
    status: status,
    statusCode: status,
    statusText: status === 404 ? 'Not Found' : 'Health Test Response',
    ok: status >= 200 && status < 300,
    url: url,
    headers: headers,
    body: payload,
    text: async function () {
      if (Buffer.isBuffer(payload)) return payload.toString('utf8');
      return String(payload);
    },
    json: async function () {
      const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload);
      return JSON.parse(text);
    },
    arrayBuffer: async function () {
      const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function settleWithin(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(function (value) {
      return { settled: true, fulfilled: true, value: value };
    }, function (error) {
      return { settled: true, fulfilled: false, error: error };
    }),
    new Promise(function (resolve) {
      timer = setTimeout(function () {
        resolve({ settled: false, label: label });
      }, timeoutMs);
    })
  ]).finally(function () {
    if (timer) clearTimeout(timer);
  });
}

function readHeader(response, name) {
  const headers = response && response.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    try { return String(headers.get(name) || ''); } catch (_) {}
  }
  const wanted = String(name).toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return String(headers[key] || '');
  }
  return '';
}

async function readSample(response, maxBytes) {
  if (!response) return Buffer.alloc(0);
  const body = response.body;
  if (Buffer.isBuffer(body)) return body.subarray(0, maxBytes);
  if (typeof body === 'string') return Buffer.from(body).subarray(0, maxBytes);
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    try {
      const result = await reader.read();
      if (!result || result.done || !result.value) return Buffer.alloc(0);
      const view = Buffer.from(result.value);
      return view.subarray(0, maxBytes);
    } finally {
      try { await reader.cancel(); } catch (_) {}
    }
  }
  // Test doubles may expose only text(); live Fetch responses use a stream and
  // take the bounded reader path above, so this branch never buffers live media.
  if (typeof response.text === 'function') {
    try { return Buffer.from(await response.text()).subarray(0, maxBytes); }
    catch (_) { return Buffer.alloc(0); }
  }
  return Buffer.alloc(0);
}

function looksLikeHtmlOrChallenge(bytes, contentType) {
  const text = Buffer.from(bytes || []).toString('utf8').slice(0, 2048).trim().toLowerCase();
  if (/text\/html|application\/xhtml\+xml/i.test(contentType || '')) return true;
  return /^<!doctype html|^<html[\s>]|^<head[\s>]|^<body[\s>]/i.test(text) ||
    /cloudflare ray id|cf-chl-|just a moment|verify you are human|access denied|connection blacklisted|not available in your region/i.test(text);
}

function expectedContainer(url, contentType) {
  const pathname = new URL(url).pathname.toLowerCase();
  const type = String(contentType || '').toLowerCase();
  if (pathname.endsWith('.m3u8') || /mpegurl|m3u8/i.test(type)) return 'hls';
  if (pathname.endsWith('.mpd') || /dash\+xml/i.test(type)) return 'dash';
  if (/\.(mkv|webm)$/.test(pathname) || /matroska|webm/i.test(type)) return 'mkv';
  if (/\.(mp4|m4v|mov)$/.test(pathname) || /video\/mp4/i.test(type)) return 'mp4';
  return 'unknown';
}

/*
 * A stream is available only when:
 *   - its URL is HTTPS;
 *   - a bounded Range GET returns 2xx/206;
 *   - non-empty sample bytes arrive;
 *   - the response is not an HTML/challenge/error page;
 *   - HLS/DASH URLs contain a recognizable manifest signature.
 *
 * HEAD is diagnostic, not the final verdict. Many valid CDNs reject HEAD, so
 * the function still tries a bounded Range GET. The reader is cancelled after
 * the first chunk to avoid downloading the whole media file.
 */
async function probeStreamContent(url, options) {
  options = options || {};
  const fetchImpl = options.fetchImpl || nativeFetch;
  const timeoutMs = options.timeoutMs || 7000;
  const headers = Object.assign({}, options.headers || {});
  let parsed;

  try { parsed = new URL(String(url)); }
  catch (_) { return { available: false, reason: 'invalid-url', url: String(url || '') }; }

  if (parsed.protocol !== 'https:') {
    return { available: false, reason: 'https-required', url: parsed.href };
  }
  if (typeof fetchImpl !== 'function') {
    return { available: false, reason: 'fetch-unavailable', url: parsed.href };
  }

  async function request(method, range) {
    const reqHeaders = Object.assign({}, headers);
    if (range) reqHeaders.Range = 'bytes=0-1023';
    let controller;
    let timer;
    try {
      if (typeof AbortController === 'function') {
        controller = new AbortController();
        timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      }
      const response = await fetchImpl(parsed.href, {
        method: method,
        headers: reqHeaders,
        redirect: 'follow',
        signal: controller ? controller.signal : undefined
      });
      return response;
    } catch (error) {
      return { status: 0, url: parsed.href, headers: headersObject({}), body: '', error: error };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const head = await request('HEAD', false);
  const headStatus = Number(head && (head.status || head.statusCode)) || 0;
  const headType = readHeader(head, 'content-type');

  // If HEAD confirms a clear auth/server error, still try Range GET: some CDNs
  // intentionally disable HEAD while serving GET correctly.
  const response = await request('GET', true);
  const status = Number(response && (response.status || response.statusCode)) || 0;
  const contentType = readHeader(response, 'content-type') || headType;
  const finalUrl = response && response.url ? String(response.url) : parsed.href;

  let final;
  try { final = new URL(finalUrl); }
  catch (_) { return { available: false, reason: 'invalid-final-url', url: finalUrl, headStatus: headStatus, status: status }; }
  if (final.protocol !== 'https:') {
    return { available: false, reason: 'insecure-redirect', url: final.href, headStatus: headStatus, status: status };
  }
  if (!(status >= 200 && status < 300)) {
    return {
      available: false,
      reason: response && response.error ? 'request-failed' : 'http-status',
      url: final.href, headStatus: headStatus, status: status, contentType: contentType
    };
  }

  const sample = await readSample(response, 1024);
  if (!sample.length) {
    return { available: false, reason: 'empty-content', url: final.href, headStatus: headStatus, status: status, contentType: contentType };
  }
  if (looksLikeHtmlOrChallenge(sample, contentType)) {
    return { available: false, reason: 'html-or-challenge', url: final.href, headStatus: headStatus, status: status, contentType: contentType };
  }

  const container = expectedContainer(final.href, contentType);
  const sampleText = sample.toString('utf8').trimStart();
  if (container === 'hls' && !sampleText.startsWith('#EXTM3U')) {
    return { available: false, reason: 'invalid-hls-manifest', url: final.href, headStatus: headStatus, status: status, contentType: contentType };
  }
  if (container === 'dash' && !/<MPD(?:\s|>)/i.test(sampleText)) {
    return { available: false, reason: 'invalid-dash-manifest', url: final.href, headStatus: headStatus, status: status, contentType: contentType };
  }

  return {
    available: true, reason: 'content-received', url: final.href,
    headStatus: headStatus, status: status, contentType: contentType,
    container: container, sampleBytes: sample.length
  };
}

function loadProvider(source) {
  const sourcePath = path.resolve(ROOT, source.file);
  const sourceText = fs.readFileSync(sourcePath, 'utf8');
  let provider = require(sourcePath);

  // Some legacy providers expose script globals rather than CommonJS exports.
  // Load that public script form unchanged; bridge fetch calls to the current
  // global fetch so the exact same HTTPS recorder is used.
  if (!provider || typeof provider.getInfo !== 'function') {
    const sandbox = {
      console: console,
      URL: URL,
      URLSearchParams: URLSearchParams,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      Buffer: Buffer,
      crypto: crypto.webcrypto,
      fetch: function () { return global.fetch.apply(global, arguments); },
      htmlText: function (value) {
        return String(value || '').replace(/<[^>]*>/g, ' ')
          .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
      }
    };
    vm.runInNewContext(sourceText, sandbox, { filename: sourcePath, timeout: 3000 });
    provider = {
      getInfo: sandbox.getInfo,
      getSettings: sandbox.getSettings || function () { return []; },
      getHome: sandbox.getHome,
      popular: sandbox.popular,
      search: sandbox.search,
      getDetail: sandbox.getDetail,
      getEpisodes: sandbox.getEpisodes,
      getVideoSources: sandbox.getVideoSources,
      getStreams: sandbox.getStreams || sandbox.getVideoSources
    };
  }
  return { provider: provider, sourceText: sourceText, sourcePath: sourcePath };
}

async function main() {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'index.json must exist');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.ok(Array.isArray(manifest.sources) && manifest.sources.length > 0, 'manifest sources are required');

  console.log('\n=== Provider-neutral contract and HTTPS checks ===');
  const originalFetch = global.fetch;
  const requestLog = [];
  global.fetch = async function (input, init) {
    const url = input && typeof input === 'object' && input.url ? String(input.url) : String(input);
    requestLog.push({ url: url, method: String((init && init.method) || 'GET').toUpperCase() });
    return mockResponse(url, 503, '', { 'content-type': 'text/html; charset=utf-8' });
  };

  let providersLoaded = 0;
  let callsSettled = 0;
  let callsRejected = 0;
  try {
    for (const source of manifest.sources) {
      const loaded = loadProvider(source);
      const provider = loaded.provider;
      const info = provider && typeof provider.getInfo === 'function' ? provider.getInfo() : null;
      const label = source.id;

      ok(label + ': public metadata exists', isObject(info) && typeof info.name === 'string' && info.name.length > 0);
      ok(label + ': manifest/provider names agree', !!info && info.name === source.name,
        'manifest=' + source.name + ', provider=' + (info && info.name));
      ok(label + ': public settings method exists', typeof provider.getSettings === 'function');
      ok(label + ': public home/search/detail/episode/stream methods exist',
        ['getHome', 'search', 'getDetail', 'getEpisodes', 'getVideoSources', 'getStreams']
          .every(function (method) { return typeof provider[method] === 'function'; }));

      const insecureLiteral = loaded.sourceText.match(/https?:\/\/[^"' \t\r\n]+/g) || [];
      ok(label + ': no cleartext HTTP URL literals', !insecureLiteral.some(function (literal) { return /^http:\/\//i.test(literal); }),
        insecureLiteral.filter(function (literal) { return /^http:\/\//i.test(literal); }).join(', '));

      const baseUrl = info && typeof info.baseUrl === 'string' && /^https:\/\//i.test(info.baseUrl)
        ? info.baseUrl.replace(/\/+$/, '')
        : 'https://provider-health.invalid';
      const sampleEpisodeUrl = baseUrl + '/__provider_health_probe__';
      const jobs = [
        ['getHome', function () { return provider.getHome({}); }],
        ['search', function () { return provider.search(HEALTH_QUERY, 1, {}); }],
        ['getDetail', function () { return provider.getDetail(baseUrl, {}); }],
        ['getEpisodes', function () { return provider.getEpisodes(baseUrl, {}); }],
        ['getVideoSources', function () { return provider.getVideoSources(sampleEpisodeUrl, true); }],
        ['getStreams', function () { return provider.getStreams(sampleEpisodeUrl, true); }]
      ];
      if (typeof provider.popular === 'function') {
        jobs.push(['popular', function () { return provider.popular('sub', 1, 1); }]);
      }

      const before = requestLog.length;
      for (const job of jobs) {
        let pending;
        try {
          pending = Promise.resolve().then(job[1]);
        } catch (error) {
          pending = Promise.reject(error);
        }
        const outcome = await settleWithin(pending, CALL_TIMEOUT_MS, label + '.' + job[0]);
        ok(label + ': ' + job[0] + ' settles on upstream HTTP errors', outcome.settled,
          outcome.settled ? '' : 'exceeded ' + CALL_TIMEOUT_MS + 'ms');
        if (outcome.settled) {
          callsSettled += 1;
          if (!outcome.fulfilled) {
            callsRejected += 1;
            note(label + '.' + job[0] + ' surfaced a controlled HTTP-fixture rejection: ' +
              String(outcome.error && outcome.error.message || outcome.error).slice(0, 180));
          } else if (outcome.value != null) {
            const expectsArray = ['getHome', 'search', 'getEpisodes', 'getVideoSources', 'getStreams', 'popular'].includes(job[0]);
            if (expectsArray) {
              ok(label + ': ' + job[0] + ' returns an array when fulfilled',
                Array.isArray(outcome.value), Object.prototype.toString.call(outcome.value));
            } else if (job[0] === 'getDetail') {
              ok(label + ': getDetail returns an object when fulfilled', isObject(outcome.value),
                Object.prototype.toString.call(outcome.value));
            }
          }
        }
      }
      const sourceRequests = requestLog.slice(before);
      ok(label + ': every attempted fetch is an absolute HTTPS URL',
        sourceRequests.every(function (entry) {
          try { return new URL(entry.url).protocol === 'https:'; } catch (_) { return false; }
        }),
        sourceRequests.filter(function (entry) {
          try { return new URL(entry.url).protocol !== 'https:'; } catch (_) { return true; }
        }).map(function (entry) { return entry.method + ' ' + entry.url; }).slice(0, 5).join(' | '));
      if (sourceRequests.length === 0) note(label + ' made no fetch calls for generic negative fixtures; live-case mode can exercise its actual endpoints.');
      providersLoaded += 1;
    }
  } finally {
    global.fetch = originalFetch;
  }

  console.log('\n=== Stream content availability checker tests ===');
  let calls = [];
  async function hlsFetch(url, init) {
    const method = String(init && init.method || 'GET').toUpperCase();
    calls.push({ url: url, method: method, headers: init && init.headers || {} });
    if (method === 'HEAD') {
      return mockResponse(url, 405, '', { 'content-type': 'application/vnd.apple.mpegurl' });
    }
    return mockResponse(url, 206, '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4.0,\nsegment0.ts\n',
      { 'content-type': 'application/vnd.apple.mpegurl', 'content-range': 'bytes 0-55/56' });
  }
  const hls = await probeStreamContent('https://media.example.test/master.m3u8', { fetchImpl: hlsFetch, timeoutMs: 100 });
  ok('HLS stream with HEAD disabled is checked with Range GET', hls.available && hls.container === 'hls', JSON.stringify(hls));
  ok('content probe sends bounded Range header', calls.some(function (call) {
    return call.method === 'GET' && (call.headers.Range === 'bytes=0-1023' || call.headers.range === 'bytes=0-1023');
  }));

  async function mp4Fetch(url, init) {
    const method = String(init && init.method || 'GET').toUpperCase();
    if (method === 'HEAD') return mockResponse(url, 200, '', { 'content-type': 'video/mp4' });
    return mockResponse(url, 206, Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
      { 'content-type': 'video/mp4', 'content-range': 'bytes 0-11/10000' });
  }
  const mp4 = await probeStreamContent('https://media.example.test/video.mp4', { fetchImpl: mp4Fetch, timeoutMs: 100 });
  ok('MP4 endpoint serves non-empty media bytes', mp4.available && mp4.sampleBytes > 0, JSON.stringify(mp4));

  async function htmlFetch(url, init) {
    const method = String(init && init.method || 'GET').toUpperCase();
    return method === 'HEAD'
      ? mockResponse(url, 200, '', { 'content-type': 'text/html' })
      : mockResponse(url, 200, '<!doctype html><html><title>Access denied</title></html>',
          { 'content-type': 'text/html; charset=utf-8' });
  }
  const html = await probeStreamContent('https://media.example.test/not-a-stream.m3u8', { fetchImpl: htmlFetch, timeoutMs: 100 });
  ok('HTTP 200 HTML/challenge page is rejected as a stream', !html.available && html.reason === 'html-or-challenge', JSON.stringify(html));

  async function emptyFetch(url, init) {
    const method = String(init && init.method || 'GET').toUpperCase();
    return mockResponse(url, method === 'HEAD' ? 200 : 206, '', { 'content-type': 'video/mp4' });
  }
  const empty = await probeStreamContent('https://media.example.test/empty.mp4', { fetchImpl: emptyFetch, timeoutMs: 100 });
  ok('empty media response is not marked playable', !empty.available && empty.reason === 'empty-content', JSON.stringify(empty));

  let httpWasRequested = false;
  const httpResult = await probeStreamContent('http://media.example.test/video.mp4', {
    fetchImpl: async function () { httpWasRequested = true; return mockResponse('http://media.example.test/video.mp4', 200, 'bytes'); },
    timeoutMs: 100
  });
  ok('non-HTTPS media URLs are rejected before a request', !httpResult.available && httpResult.reason === 'https-required' && !httpWasRequested, JSON.stringify(httpResult));

  console.log('\n=== Optional live provider stream cases ===');
  const liveCasesRaw = process.env.PROVIDER_HEALTH_CASES;
  if (!liveCasesRaw) {
    note('live checks are opt-in; set PROVIDER_HEALTH_CASES to a JSON object of sourceId -> {method,args}.');
  } else {
    assert.equal(typeof nativeFetch, 'function', 'Node native fetch is required for live stream tests');
    let liveCases;
    try { liveCases = JSON.parse(liveCasesRaw); }
    catch (error) { throw new Error('PROVIDER_HEALTH_CASES must be valid JSON: ' + error.message); }
    assert.ok(isObject(liveCases), 'PROVIDER_HEALTH_CASES must be an object keyed by manifest source ID');

    for (const sourceId of Object.keys(liveCases)) {
      const source = manifest.sources.find(function (item) { return item.id === sourceId; });
      assert.ok(source, 'Unknown live-case source ID: ' + sourceId);
      const loaded = loadProvider(source);
      const testCase = liveCases[sourceId] || {};
      const method = testCase.method || 'getVideoSources';
      assert.ok(typeof loaded.provider[method] === 'function', sourceId + ' does not export ' + method);
      assert.ok(Array.isArray(testCase.args), sourceId + ' live case requires an args array');

      const outgoing = [];
      global.fetch = async function (input, init) {
        const url = input && typeof input === 'object' && input.url ? String(input.url) : String(input);
        outgoing.push({ url: url, method: String((init && init.method) || 'GET').toUpperCase() });
        let parsed;
        try { parsed = new URL(url); } catch (_) { parsed = null; }
        if (!parsed || parsed.protocol !== 'https:') {
          throw new Error('Provider attempted a non-HTTPS/invalid fetch: ' + url);
        }
        return nativeFetch(input, Object.assign({}, init || {}, { signal: (init && init.signal) || AbortSignal.timeout(LIVE_TIMEOUT_MS) }));
      };

      let outcome;
      try {
        outcome = await settleWithin(
          Promise.resolve().then(function () { return loaded.provider[method].apply(loaded.provider, testCase.args); }),
          LIVE_TIMEOUT_MS,
          sourceId + '.' + method
        );
      } finally {
        global.fetch = originalFetch;
      }
      ok(sourceId + ': live ' + method + ' completes', outcome.settled && outcome.fulfilled,
        outcome.settled ? String(outcome.error && outcome.error.message || outcome.error || '') : 'timed out');
      if (!outcome.settled || !outcome.fulfilled) continue;

      const streams = outcome.value;
      assert.ok(Array.isArray(streams), sourceId + '.' + method + ' must return an array for stream checking');
      const candidates = streams.filter(function (stream) { return stream && typeof stream.url === 'string'; });
      ok(sourceId + ': resolver returned candidate streams', candidates.length > 0, JSON.stringify(streams).slice(0, 500));
      for (const stream of candidates.slice(0, MAX_LIVE_STREAM_PROBES)) {
        const result = await probeStreamContent(stream.url, {
          fetchImpl: nativeFetch,
          headers: isObject(stream.headers) ? stream.headers : {},
          timeoutMs: 7000
        });
        ok(sourceId + ': stream content available (' + stream.url.slice(0, 100) + ')', result.available, JSON.stringify(result));
      }
      const badCalls = outgoing.filter(function (entry) {
        try { return new URL(entry.url).protocol !== 'https:'; } catch (_) { return true; }
      });
      ok(sourceId + ': all live provider fetches used HTTPS', badCalls.length === 0, JSON.stringify(badCalls.slice(0, 5)));
    }
    global.fetch = originalFetch;
  }

  console.log('\n=== Provider health suite summary ===');
  console.log('Providers loaded: ' + providersLoaded + '/' + manifest.sources.length);
  console.log('Network calls settled: ' + callsSettled + '; controlled-fixture rejections: ' + callsRejected);
  console.log('Passed: ' + pass + '; failed: ' + fail + '; informational notes: ' + warnings.length);
  if (failures.length) {
    console.error('\nFailures:\n- ' + failures.join('\n- '));
    process.exitCode = 1;
  }
}

main().catch(function (error) {
  console.error('[FAIL] provider-health.test.js crashed: ' + (error && error.stack || error));
  process.exitCode = 1;
});
