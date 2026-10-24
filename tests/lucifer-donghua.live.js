'use strict';

// Real-network integration test, run by the verification workflow on PR #170.
// It checks search -> detail -> episodes -> host extraction -> real media/HLS bytes.

const assert = require('node:assert/strict');
const provider = require('../providers/lucifer-donghua.js');
const query = process.env.LUCIFER_DONGHUA_QUERY || 'Soul Land 2: The Peerless Tang Sect';
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

async function sampleBody(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    return Buffer.from(text).subarray(0, maxBytes);
  }
  const reader = response.body.getReader();
  try {
    const chunk = await reader.read();
    return chunk && chunk.value ? Buffer.from(chunk.value).subarray(0, maxBytes) : Buffer.alloc(0);
  } finally {
    try { await reader.cancel(); } catch (_) {}
  }
}

async function main() {
  assert.equal(provider.getInfo().name, 'Lucifer Donghua');
  const calls = [];
  global.fetch = async function (input, init) {
    const url = String(input);
    assert.equal(new URL(url).protocol, 'https:');
    calls.push(url);
    return nativeFetch(input, Object.assign({}, init || {}, {
      signal: (init && init.signal) || AbortSignal.timeout(15000)
    }));
  };

  const results = await within(provider.search(query, 1), 60000, 'live search');
  assert.ok(Array.isArray(results) && results.length, 'search returned no results for ' + query);
  assert.ok(results.some(function (result) {
    return /Soul Land 2.*Peerless Tang Sect/i.test(String(result && result.title || ''));
  }), 'known live title was not present in search results; site response or card parsing may have changed');
  pass('real HTTP search returned ' + results.length + ' title(s), including Soul Land 2');

  // Search can return a movie first (e.g. a Soul Land film). Find a result
  // whose own detail page actually advertises episodes before testing series flow.
  let item = null, detail = null, episodes = [], skipped = [];
  for (const candidate of results.slice(0, 12)) {
    if (!candidate || !candidate.url) continue;
    try {
      const foundDetail = await within(provider.getDetail(candidate.url), 45000, 'live detail');
      const foundEpisodes = foundDetail && Array.isArray(foundDetail.episodes) ? foundDetail.episodes : [];
      if (foundDetail && foundDetail.title && foundEpisodes.length) {
        item = candidate;
        detail = foundDetail;
        episodes = foundEpisodes;
        break;
      }
      skipped.push((foundDetail && foundDetail.title) || candidate.title || candidate.url);
    } catch (error) {
      skipped.push((candidate.title || candidate.url) + ' (' + error.message + ')');
    }
  }
  assert.ok(item && detail && episodes.length,
    'search results did not contain a series with parsed episodes; candidates: ' + skipped.join(' | '));
  pass('series metadata: ' + detail.title);
  pass('detail parser returned ' + episodes.length + ' episode(s)');

  const viaEpisodeMethod = await within(provider.getEpisodes(item.url), 60000, 'live getEpisodes');
  assert.ok(Array.isArray(viaEpisodeMethod) && viaEpisodeMethod.length,
    'getEpisodes did not return the series episodes after detail succeeded');
  pass('getEpisodes returned ' + viaEpisodeMethod.length + ' episode(s)');

  let streams = [];
  for (let i = 0; i < Math.min(5, viaEpisodeMethod.length); i++) {
    const episode = viaEpisodeMethod[i];
    if (!episode || !episode.url) continue;
    const before = calls.length;
    streams = await within(provider.getVideoSources(episode.url), 60000, 'live stream extraction');
    console.log('[DIAG] episode ' + episode.number + ' ' + episode.url +
      ' -> ' + streams.length + ' streams; provider requests: ' + calls.slice(before).join(' | '));
    if (streams.length) break;
  }
  if (!streams.length && viaEpisodeMethod[0] && viaEpisodeMethod[0].url) {
    const episodeUrl = viaEpisodeMethod[0].url;
    try {
      const response = await nativeFetch(episodeUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', 'Referer': 'https://luciferdonghua.in/' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000)
      });
      const body = await response.text();
      console.log('[DIAG] episode-page status=' + response.status + ' final=' + response.url +
        ' content-type=' + response.headers.get('content-type'));
      const iframeTags = body.match(/<iframe[^>]*>/gi) || [];
      const optionTags = body.match(/<option[^>]*>/gi) || [];
      const hrefs = body.match(/href=["'][^"']{1,180}["']/gi) || [];
      console.log('[DIAG] episode-page markers=' + JSON.stringify({
        iframes: iframeTags.length,
        iframeTags: iframeTags.slice(0, 5),
        options: optionTags.length,
        optionTags: optionTags.slice(0, 8),
        dataIndex: (body.match(/data-index/gi) || []).length,
        dataEm: (body.match(/data-em/gi) || []).length,
        v1Route: body.indexOf('/v/1/') >= 0,
        hrefs: hrefs.slice(0, 20)
      }));
      const route = episodeUrl.replace(/\/+$/, '') + '/v/1/';
      try {
        const mirrorResponse = await nativeFetch(route, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', 'Referer': episodeUrl },
          redirect: 'follow',
          signal: AbortSignal.timeout(12000)
        });
        const mirrorBody = await mirrorResponse.text();
        const mirrorFrames = mirrorBody.match(/<iframe[^>]*>/gi) || [];
        const mirrorLinks = mirrorBody.match(/href=["'][^"']{1,180}["']/gi) || [];
        console.log('[DIAG] mirror-page status=' + mirrorResponse.status + ' final=' + mirrorResponse.url +
          ' content-type=' + mirrorResponse.headers.get('content-type'));
        console.log('[DIAG] mirror-page markers=' + JSON.stringify({
          frames: mirrorFrames.slice(0, 5),
          dataIndex: (mirrorBody.match(/data-index/gi) || []).length,
          dataEm: (mirrorBody.match(/data-em/gi) || []).length,
          meta: (mirrorBody.match(/<meta[^>]*>/gi) || []).filter(function (item) { return /embedUrl|og:video|og:title/i.test(item); }).slice(0, 5),
          links: mirrorLinks.slice(0, 15),
          body: mirrorBody.slice(0, 1200).replace(/\s+/g, ' ')
        }));
      } catch (error) { console.log('[DIAG] mirror-page failure=' + error.message); }
    } catch (error) { console.log('[DIAG] episode-page failure=' + error.message); }
  }
    assert.ok(streams.length, 'no enabled host returned stream candidates from the first five episodes');
  pass('host extractors returned ' + streams.length + ' candidate(s)');

  let playable = false, last = '';
  for (const stream of streams.slice(0, 4)) {
    try {
      const response = await within(nativeFetch(stream.url, {
        headers: Object.assign({}, stream.headers || {}, { Range: 'bytes=0-1023' }),
        redirect: 'follow',
        signal: AbortSignal.timeout(12000)
      }), 15000, 'stream probe');
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      let sample;
      if (/mpegurl|m3u8/i.test(contentType) || /\.m3u8(?:[?#]|$)/i.test(stream.url)) {
        sample = Buffer.from(await response.text()).subarray(0, 8192);
        playable = response.ok && /#EXTM3U/i.test(sample.toString('utf8'));
      } else {
        sample = await sampleBody(response, 2048);
        playable = response.ok && sample.length > 0 && !/text\/html|application\/xhtml/i.test(contentType) &&
          !/^\s*(?:<!doctype html|<html|<head|<body)/i.test(sample.toString('utf8'));
      }
      last = stream.url + ' status=' + response.status + ' type=' + contentType +
        ' bytes=' + sample.length + ' sample=' + sample.subarray(0, 32).toString('hex');
      if (playable) break;
    } catch (error) {
      last = stream.url + ': ' + error.message;
    }
  }
  assert.ok(playable, 'none of the returned candidates passed the bounded media/HLS content probe: ' + last);
  pass('at least one returned stream served media/HLS content');
  pass('real provider HTTP requests: ' + calls.length);
}

main().catch(function (error) {
  console.error('[FAIL] Lucifer Donghua live integration: ' + (error && error.stack || error));
  process.exitCode = 1;
}).finally(function () { global.fetch = nativeFetch; });
