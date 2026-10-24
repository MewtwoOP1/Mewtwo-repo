'use strict';

// Optional real-network integration test:
// RUN_LUCIFER_DONGHUA_LIVE=1 node tests/lucifer-donghua.live.js
// Opt-in because website markup and third-party hosters can change.

const assert = require('node:assert/strict');
const provider = require('../providers/lucifer-donghua.js');
const query = process.env.LUCIFER_DONGHUA_QUERY || 'soul land';
const nativeFetch = global.fetch;

function within(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise(function (_, reject) {
      timer = setTimeout(function () { reject(new Error(label + ' timed out after ' + ms + 'ms')); }, ms);
    })
  ]).finally(function () { if (timer) clearTimeout(timer); });
}
function pass(message) { console.log('[PASS] ' + message); }

async function main() {
  assert.equal(provider.getInfo().name, 'Lucifer Donghua');
  const calls = [];
  global.fetch = async function (input, init) {
    const url = String(input);
    assert.equal(new URL(url).protocol, 'https:');
    calls.push(url);
    return nativeFetch(input, Object.assign({}, init || {}, { signal: (init && init.signal) || AbortSignal.timeout(15000) }));
  };

  const results = await within(provider.search(query, 1), 60000, 'live search');
  assert.ok(Array.isArray(results) && results.length, 'search returned no results for ' + query);
  pass('real HTTP search returned ' + results.length + ' title(s)');

  const item = results.find(function (result) { return result && result.url; });
  assert.ok(item, 'no valid result URL found');
  const detail = await within(provider.getDetail(item.url), 60000, 'live details');
  assert.ok(detail && detail.title, 'title detail did not resolve');
  pass('details: ' + detail.title);

  const episodes = await within(provider.getEpisodes(item.url), 60000, 'live episodes');
  assert.ok(Array.isArray(episodes) && episodes.length, 'series returned no episodes');
  pass('episode parser returned ' + episodes.length + ' episode(s)');

  let streams = [];
  for (let i = 0; i < Math.min(4, episodes.length); i++) {
    if (episodes[i] && episodes[i].url) streams = await within(provider.getVideoSources(episodes[i].url), 60000, 'live stream extraction');
    if (streams.length) break;
  }
  assert.ok(streams.length, 'no host returned a stream candidate from the first four episodes');
  pass('host extractor returned ' + streams.length + ' stream candidate(s)');

  let playable = false, last = '';
  for (const stream of streams.slice(0, 4)) {
    try {
      const response = await within(nativeFetch(stream.url, {
        headers: Object.assign({}, stream.headers || {}, { Range: 'bytes=0-1023' }),
        redirect: 'follow',
        signal: AbortSignal.timeout(12000)
      }), 15000, 'stream probe');
      const type = String(response.headers.get('content-type') || '').toLowerCase();
      let sample;
      if (/mpegurl|m3u8/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(stream.url)) {
        sample = (await response.text()).slice(0, 8192);
        playable = response.ok && /#EXTM3U/i.test(sample);
      } else {
        const bytes = Buffer.from(await response.arrayBuffer());
        sample = bytes.subarray(0, 48).toString('hex');
        playable = response.ok && bytes.length > 0 && !/text\/html|application\/xhtml/i.test(type);
      }
      last = stream.url + ' status=' + response.status + ' type=' + type + ' sample=' + String(sample).slice(0, 100);
      if (playable) break;
    } catch (error) { last = stream.url + ': ' + error.message; }
  }
  assert.ok(playable, 'none of the returned candidates passed a bounded HTTP media/HLS probe: ' + last);
  pass('a returned stream URL passed the media-content probe');
  pass('real provider HTTP requests made: ' + calls.length);
}

main().catch(function (error) {
  console.error('[FAIL] Lucifer Donghua live integration: ' + (error && error.stack || error));
  process.exitCode = 1;
}).finally(function () {
  global.fetch = nativeFetch;
});
