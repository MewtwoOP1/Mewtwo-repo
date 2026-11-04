'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.__settings = {
  animeonsen: {
    requestTimeoutMs: '12000',
    homeLimit: '30',
    includeSubtitles: true
  }
};

function json(value, status) {
  return new Response(JSON.stringify(value), {
    status: status || 200,
    headers: { 'content-type': 'application/json' }
  });
}
function html(value, status) {
  return new Response(value, { status: status || 200, headers: { 'content-type': 'text/html' } });
}

const content = {
  content_id: 'VW2uXR5DvjxlLSw5',
  content_title_en: 'Mock Anime',
  content_title: 'Mock Anime',
  content_image: 'https://img.example/poster.jpg',
  mal_id: 52299,
  anilist_id: 151807,
  mal_data: {
    synopsis: 'A mock AnimeOnsen synopsis',
    status: 'Currently Airing',
    start_date: '2024-01-01',
    genres: [{ name: 'Action' }, { name: 'Fantasy' }]
  }
};
const episodeMap = {
  '12': { contentTitle_episode_en: 'Finale' },
  '2': { contentTitle_episode_en: 'Second' },
  '1': { contentTitle_episode_en: 'First' }
};
const video = {
  uri: {
    stream: 'https://cdn.animeonsen.xyz/video/mp4-dash/VW2uXR5DvjxlLSw5/1/manifest.mpd',
    subtitles: {
      'en-US': 'https://api.animeonsen.xyz/v4/subtitles/VW2uXR5DvjxlLSw5/en-US/1',
      'es-ES': 'https://api.animeonsen.xyz/v4/subtitles/VW2uXR5DvjxlLSw5/es-ES/1'
    }
  },
  metadata: {
    quality: 1080,
    subtitles: { 'en-US': 'English', 'es-ES': 'Spanish' }
  }
};

const requests = [];
let authCalls = 0;
let siteCalls = 0;
global.fetch = async (url, init) => {
  const target = String(url);
  const options = init || {};
  requests.push({ url: target, options });
  if (target === 'https://www.animeonsen.xyz/') {
    siteCalls += 1;
    return html('<html><head><meta name="ao-search-token" content="search-token-1"></head></html>');
  }
  if (target === 'https://auth.animeonsen.xyz/oauth/token') {
    authCalls += 1;
    assert.match(String(options.body || ''), /grant_type=client_credentials/);
    return json({ access_token: 'access-token-1', expires_in: 3600 });
  }
  if (target === 'https://search.animeonsen.xyz/indexes/content/search') {
    assert.equal(String((options.headers || {}).Authorization), 'Bearer search-token-1');
    return json({ hits: [content] });
  }
  if (target === 'https://api.animeonsen.xyz/v4/content/index?start=0&limit=30') {
    return json({ content: [content] });
  }
  if (target === 'https://api.animeonsen.xyz/v4/content/VW2uXR5DvjxlLSw5/extensive') {
    return json(content);
  }
  if (target === 'https://api.animeonsen.xyz/v4/content/VW2uXR5DvjxlLSw5/episodes') {
    return json(episodeMap);
  }
  if (target === 'https://api.animeonsen.xyz/v4/content/VW2uXR5DvjxlLSw5/video/1') {
    return json(video);
  }
  return json({ error: 'not found' }, 404);
};

const provider = require('../providers/animeonsen.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((entry) => entry.id === 'animeonsen');

async function main() {
  assert.ok(source, 'AnimeOnsen must be registered in the manifest');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);
  assert.deepEqual(provider.getSettings().map((entry) => entry.key), source.settings.map((entry) => entry.key));

  assert.equal(provider._contentId('VW2uXR5DvjxlLSw5'), 'VW2uXR5DvjxlLSw5');
  assert.equal(provider._contentId('https://www.animeonsen.xyz/details/VW2uXR5DvjxlLSw5'), 'VW2uXR5DvjxlLSw5');
  assert.throws(() => provider._contentId('not a content id'), /missing content id/i);
  assert.deepEqual(provider._episodeParts('VW2uXR5DvjxlLSw5|12'), { contentId: 'VW2uXR5DvjxlLSw5', epNum: '12' });
  assert.equal(provider._streamQuality(1080), '1080p');
  assert.equal(provider._streamQuality({ quality: '720p' }), '720p');

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].items.length, 1);
  assert.equal(home[0].items[0].title, 'Mock Anime');

  const search = await provider.search('Mock Anime', 1, {});
  assert.equal(search.length, 1);
  assert.equal(search[0].id, 'VW2uXR5DvjxlLSw5');
  assert.equal(search[0].url, 'VW2uXR5DvjxlLSw5');
  assert.equal(search[0].sourceId, 'animeonsen');

  const detail = await provider.getDetail('VW2uXR5DvjxlLSw5', {});
  assert.equal(detail.title, 'Mock Anime');
  assert.equal(detail.cover, 'https://api.animeonsen.xyz/v4/image/210x300/VW2uXR5DvjxlLSw5');
  assert.equal(detail.malId, 52299);
  assert.equal(detail.anilistId, 151807);
  assert.equal(detail.year, '2024');
  assert.equal(detail.description, 'A mock AnimeOnsen synopsis');
  assert.deepEqual(detail.genres, ['Action', 'Fantasy']);
  assert.equal(detail.episodes.length, 3);
  assert.deepEqual(detail.episodes.map((entry) => entry.number), [1, 2, 12]);
  assert.equal(detail.episodes[0].title, 'Episode 1: First');
  assert.equal(detail.subCount, 3);
  assert.equal(detail.dubCount, 0);
  assert.ok(detail.episodes.every((entry) => entry.category === 'sub'));

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.animeonsen.xyz/video/mp4-dash/VW2uXR5DvjxlLSw5/1/manifest.mpd');
  assert.equal(streams[0].type, 'dash');
  assert.equal(streams[0].container, 'dash');
  assert.equal(streams[0].quality, '1080p');
  assert.equal(streams[0].kind, 'sub');
  assert.equal(streams[0].headers.Referer, 'https://www.animeonsen.xyz/');
  assert.equal(streams[0].subtitles.length, 2);
  assert.equal(streams[0].subtitles[0].format, 'ass');
  assert.equal(streams[0].subtitles[0].label, 'English');
  assert.equal(streams[0].subtitles[0].headers.Referer, 'https://www.animeonsen.xyz/');
  assert.equal(streams[0].subtitles[1].label, 'Spanish');

  assert.equal(authCalls, 1, 'the token is minted once and shared by concurrent API calls');
  assert.equal(siteCalls, 1, 'the search token is cached');

  global.__settings.animeonsen.includeSubtitles = false;
  const noSubs = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(noSubs.length, 1);
  assert.deepEqual(noSubs[0].subtitles, []);
  global.__settings.animeonsen.includeSubtitles = true;

  await assert.rejects(() => provider.getVideoSources('invalid episode'), /invalid episode reference/i);

  assert.ok(requests.some((entry) => entry.url === 'https://search.animeonsen.xyz/indexes/content/search'));
  assert.ok(requests.some((entry) => entry.url === 'https://api.animeonsen.xyz/v4/content/VW2uXR5DvjxlLSw5/video/1'));

  console.log('AnimeOnsen tests passed: manifest parity, real Response handling, OAuth token sharing, search/home/detail, ascending episodes, DASH playback, ASS subtitles, subtitle settings, and invalid input.');
}

main().catch((error) => { console.error(error && error.stack || error); process.exitCode = 1; });
