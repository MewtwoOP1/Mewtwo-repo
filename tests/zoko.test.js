'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.__settings = {
  zoko: {
    audioMode: 'both',
    homeSections: 'trending,popular',
    requestTimeoutMs: '10000',
    showAdult: false
  }
};

const media = {
  id: 151807,
  idMal: 52299,
  title: { english: 'Mock Anime', romaji: 'Mock Anime', native: 'モックアニメ' },
  description: 'A mock synopsis',
  coverImage: { extraLarge: 'https://img.example/poster.jpg', large: 'https://img.example/poster-small.jpg' },
  bannerImage: 'https://img.example/banner.jpg',
  episodes: 3,
  status: 'RELEASING',
  genres: ['Action', 'Fantasy'],
  seasonYear: 2026,
  averageScore: 88,
  isAdult: false,
  synonyms: ['Mock Title']
};

function payloadHtml(payload) {
  const text = JSON.stringify(payload);
  const bytes = Buffer.from(text, 'utf8');
  const key = Buffer.from('otaku-embed-v1', 'utf8');
  const encoded = Buffer.from(bytes.map((byte, index) => byte ^ key[index % key.length])).toString('base64');
  return '<!doctype html><script>window.__P = "' + encoded + '";</script>';
}

const requests = [];
function json(value, status) {
  return new Response(JSON.stringify(value), {
    status: status || 200,
    headers: { 'content-type': 'application/json' }
  });
}
function html(value, status) {
  return new Response(value, { status: status || 200, headers: { 'content-type': 'text/html' } });
}

global.fetch = async (url, init) => {
  const target = String(url);
  const options = init || {};
  requests.push({ url: target, options });
  if (target === 'https://graphql.anilist.co') {
    const body = JSON.parse(options.body);
    if (body.query.includes('Media(id:$id')) return json({ data: { Media: media } });
    if (body.query.includes('Page(')) return json({ data: { Page: { media: [media] } } });
    return json({ errors: [{ message: 'unexpected query' }] });
  }
  if (target === 'https://zokoanime.video/stream/mal/52299/1/sub') {
    return html(payloadHtml({
      src: 'https://cdn.example/sub/master.m3u8',
      subtitles: [
        { src: 'https://cdn.example/sub/en.vtt', lang: 'en', label: 'English', default: true },
        { src: 'https://cdn.example/sub/en.vtt', lang: 'en', label: 'English duplicate' }
      ],
      skip: { intro: [0, 90], outro: [1320, 1440] }
    }));
  }
  if (target === 'https://zokoanime.video/stream/mal/52299/1/dub') {
    return html(payloadHtml({ src: 'https://cdn.example/dub/master.m3u8', subtitles: [] }));
  }
  return html('not found', 404);
};

const provider = require('../providers/zoko.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((entry) => entry.id === 'zoko');

async function main() {
  assert.ok(source, 'Zoko must be registered in the manifest');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);
  assert.deepEqual(provider.getSettings().map((entry) => entry.key), source.settings.map((entry) => entry.key));

  const decoded = provider._decodePayload(payloadHtml({ src: 'https://cdn.example/probe.m3u8', subtitles: [] }));
  assert.equal(decoded.src, 'https://cdn.example/probe.m3u8');
  assert.equal(provider._decodePayload('<html>no payload</html>'), null);
  assert.equal(provider._item(Object.assign({}, media, { isAdult: true })), null, 'adult rows are hidden by default');
  global.__settings.zoko.showAdult = true;
  assert.ok(provider._item(Object.assign({}, media, { isAdult: true })), 'adult rows follow the setting');
  global.__settings.zoko.showAdult = false;

  const home = await provider.getHome({});
  assert.equal(home.length, 2);
  assert.deepEqual(home.map((row) => row.title), ['Trending Anime', 'Popular Anime']);
  assert.ok(home.every((row) => row.items.length === 1));

  const search = await provider.search('Mock Anime', 1, {});
  assert.equal(search.length, 1);
  assert.equal(search[0].url, 'zoko://anime/151807');
  assert.equal(search[0].malId, 52299);
  assert.equal(search[0].cover, 'https://img.example/poster.jpg');
  assert.equal(search[0].sourceId, 'zoko');

  assert.equal(provider._episodeCount({ episodes: 0, nextAiringEpisode: { episode: 13 } }), 12,
    'ongoing titles without an episode total fall back to the next airing number');
  assert.equal(provider._episodeCount({ episodes: 26, nextAiringEpisode: { episode: 27 } }), 26,
    'the published episode total wins when it is already known');

  const mediaQueriesBefore = requests.filter((entry) => {
    if (entry.url !== 'https://graphql.anilist.co') return false;
    try { return JSON.parse(entry.options.body).query.includes('Media(id:$id'); } catch (_) { return false; }
  }).length;
  const detail = await provider.getDetail('zoko://anime/151807', {});
  const mediaQueriesAfter = requests.filter((entry) => {
    if (entry.url !== 'https://graphql.anilist.co') return false;
    try { return JSON.parse(entry.options.body).query.includes('Media(id:$id'); } catch (_) { return false; }
  }).length;
  assert.equal(mediaQueriesAfter, mediaQueriesBefore,
    'detail reuses the AniList row already returned by search/home');
  assert.equal(detail.title, 'Mock Anime (2026)');
  assert.equal(detail.year, '2026');
  assert.equal(detail.malId, 52299);
  assert.equal(detail.status, 'ongoing');
  assert.equal(detail.episodes.length, 3, 'one row per episode number, both audio tracks');
  assert.equal(detail.subCount, 3);
  assert.equal(detail.dubCount, 3);
  assert.equal(detail.episodes[0].url, 'zoko://episode/151807/52299/1/both');
  assert.ok(detail.episodes.every((entry) => entry.category === 'both'));

  const availability = await provider._availability(52299);
  assert.deepEqual(availability, { sub: true, dub: true });

  const bothEpisode = detail.episodes[0];
  const bothStreams = await provider.getVideoSources(bothEpisode.url, {});
  assert.equal(bothStreams.length, 2, 'a both episode exposes sub and dub HLS streams');
  assert.ok(bothStreams.some((entry) => entry.url === 'https://cdn.example/sub/master.m3u8' && entry.kind === 'sub'),
    'sub HLS stream');
  assert.ok(bothStreams.some((entry) => entry.url === 'https://cdn.example/dub/master.m3u8' && entry.kind === 'dub'),
    'dub HLS stream');
  assert.equal(bothStreams[0].subtitles.length, 1, 'duplicate subtitle URLs are deduplicated');
  assert.equal(bothStreams[0].subtitles[0].format, 'vtt');
  assert.equal(bothStreams[0].subtitles[0].url, 'https://cdn.example/sub/en.vtt');
  assert.equal(requests.filter((entry) => entry.url === 'https://zokoanime.video/stream/mal/52299/1/sub').length, 1,
    'the availability probe and playback share one cached player page');

  // A sub-only sweep collapses the both row to sub streams only.
  global.__settings.zoko.audioMode = 'sub';
  const subOnly = await provider.getDetail('zoko://anime/151807', {});
  assert.equal(subOnly.episodes.length, 3);
  assert.ok(subOnly.episodes.every((entry) => entry.category === 'sub'));
  const subStreams = await provider.getVideoSources(subOnly.episodes[0].url, {});
  assert.equal(subStreams.length, 1);
  assert.equal(subStreams[0].url, 'https://cdn.example/sub/master.m3u8');
  assert.equal(subStreams[0].kind, 'sub');
  assert.equal(subStreams[0].audioLang, 'ja');

  global.__settings.zoko.audioMode = 'dub';
  const dubOnly = await provider.getDetail('zoko://anime/151807', {});
  assert.equal(dubOnly.episodes.length, 3);
  assert.ok(dubOnly.episodes.every((entry) => entry.category === 'dub'));
  const dubStreams = await provider.getVideoSources(dubOnly.episodes[0].url, {});
  assert.equal(dubStreams.length, 1);
  assert.equal(dubStreams[0].url, 'https://cdn.example/dub/master.m3u8');
  assert.equal(dubStreams[0].kind, 'dub');
  assert.equal(dubStreams[0].audioLang, 'en');
  global.__settings.zoko.audioMode = 'both';

  assert.deepEqual(provider._parseEpisode('zoko://episode/151807/52299/1/both'), {
    anilistId: 151807, malId: 52299, number: 1, category: 'both'
  });
  assert.deepEqual(provider._parseEpisode('zoko://episode/151807/52299/1/sub'), {
    anilistId: 151807, malId: 52299, number: 1, category: 'sub'
  });
  assert.equal(provider._parseEpisode('zoko://episode/151807/52299/1.5/dub').number, 1.5);
  assert.throws(() => provider._parseEpisode('zoko://episode/1'), /invalid episode URL/i);
  assert.throws(() => provider.getDetail('zoko://anime/nope'), /invalid AniList ID/i);
  const invalidStreams = await provider.getVideoSources('zoko://episode/1', {});
  assert.deepEqual(invalidStreams, []);
  assert.deepEqual(await provider._availability(999999), { sub: false, dub: false }, 'missing MAL ids do not appear available');

  assert.ok(requests.some((entry) => entry.url === 'https://graphql.anilist.co'));
  assert.ok(requests.some((entry) => entry.url === 'https://zokoanime.video/stream/mal/52299/1/sub'));

  console.log('Zoko tests passed: manifest parity, real Response handling, AniList home/search/detail, cached media/player pages, next-airing episode counts, SUB/DUB availability, XOR payload decoding, HLS headers/subtitles, settings, and invalid input.');
}

main().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
