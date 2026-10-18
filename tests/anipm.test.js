'use strict';
const assert = require('node:assert/strict');

const calls = [];
const bootstrapCounts = new Map();
const transientFailures = new Map();
global.__settings = { anipm: { language: 'sub' } };
global.fetch = async (url, options) => {
  const u = String(url);
  calls.push({ url: u, options: options || {} });
  const remaining = transientFailures.get(u) || 0;
  if (remaining > 0) {
    transientFailures.set(u, remaining - 1);
    return { status: 503, body: JSON.stringify({ error: 'temporary upstream failure' }) };
  }

  let body = {};
  if (u === 'https://ani.pm/api/anime/search?q=Mock%20Anime&page=1') {
    body = { items: [{
      id: '123', source: 'anime', title: { english: 'Mock Anime', romaji: 'Mock Anime Romaji' },
      anilistId: 123, malId: 999, cover: 'https://img.example/anipm.jpg'
    }] };
  } else if (u === 'https://ani.pm/api/partner/v1/titles?q=Partner%20API') {
    body = { items: [{ id: 'partner-1', title: { english: 'Partner API Anime' }, malId: 777 }] };
  } else if (u === 'https://ani.pm/api/partner/v1/titles?q=Partner%20Backup') {
    body = { data: [{ id: 'internal-99', anilistId: 16498, title: 'Partner Backup Anime',
      url: 'https://ani.pm/ani/16498', episodes: { sub: 12 } }] };
  } else if (u === 'https://ani.pm/api/partner/v1/series/16498') {
    body = { data: { episodeList: [{ number: 1, title: 'Episode 1' }] } };
  } else if (u.indexOf('https://ani.pm/api/anime/playback-bootstrap/anilist/16498?') === 0) {
    body = { backupEmbed: { available: true, url: 'https://megaplay.buzz/stream/s-2/16498/sub' } };
  } else if (u.indexOf('https://ani.pm/api/anime/playback-bootstrap/anime/123?') === 0) {
    const lang = new URL(u).searchParams.get('lang');
    const count = (bootstrapCounts.get(lang) || 0) + 1;
    bootstrapCounts.set(lang, count);
    if (lang === 'sub' && count === 1) {
      body = { core: { title: { english: 'Mock Anime' } }, packages: { episodes: {} }, settlarSelection: 'empty-sub-selection' };
    } else body = {
      core: {
        title: { english: 'Mock Anime', romaji: 'Mock Anime Romaji' }, anilistId: 123, malId: 999,
        episodes: [{ number: 1, title: 'The Beginning' }, { number: 2, title: 'The Journey' }]
      },
      packages: { episodes: { '1': { sub: true, dub: true }, '2': { sub: true } } },
      settlarSelection: 'selection-token'
    };
  } else if (u === 'https://ani.pm/api/anime/search?q=Broken%20Anime&page=1') {
    body = { items: [{ id: '456', source: 'anime', title: { english: 'Broken Anime' }, anilistId: 456, malId: 654 }] };
  } else if (u === 'https://ani.pm/api/anime/search?q=ID%20Aliases&page=1') {
    body = { items: [{ id: 'external-42', source: 'anime', title: { english: 'ID Aliases' },
      anilistId: '0', anilist_id: '4567', malId: '', mal_id: '1234' }] };
  } else if (u.indexOf('https://ani.pm/api/anime/playback-bootstrap/anime/external-42?') === 0) {
    body = {};
  } else if (u === 'https://ani.pm/api/anime/search?q=URL%20AniList%20ID&page=1') {
    body = { items: [{ id: 'source-key-42', source: 'anime', title: { english: 'URL AniList ID' },
      url: 'https://ani.pm/ani/4321' }] };
  } else if (u.indexOf('https://ani.pm/api/anime/playback-bootstrap/anime/source-key-42?') === 0) {
    body = {};
  } else if (u === 'https://ani.pm/api/anime/search?q=Nested%20AniList%20ID&page=1') {
    body = { items: [{ id: 'nested-key-42', source: 'anime', title: { english: 'Nested AniList ID' },
      ids: { anilist: { id: '87654' } } }] };
  } else if (u.indexOf('https://ani.pm/api/anime/playback-bootstrap/anime/nested-key-42?') === 0) {
    body = {};
  } else if (u === 'https://ani.pm/api/anime/search?q=Legacy%20Generic&page=1') {
    body = { items: [] };
  } else if (u === 'https://ani.pm/api/partner/v1/titles?q=Legacy%20Generic') {
    body = { items: [{ id: '789', title: { english: 'Legacy Generic ID Anime' }, malId: 654,
      url: 'https://ani.pm/series/789' }] };
  } else if (u === 'https://ani.pm/api/partner/v1/series/789') {
    body = { title: { english: 'Legacy Generic ID Anime' }, malId: 654, episodes: [] };
  } else if (u === 'https://ani.pm/api/anime/search?q=Legacy%20Explicit&page=1') {
    body = { items: [] };
  } else if (u === 'https://ani.pm/api/partner/v1/titles?q=Legacy%20Explicit') {
    body = { items: [{ id: '777', title: { english: 'Legacy Explicit ID Anime' },
      anilistId: '123456', malId: '654', url: 'https://ani.pm/series/777' }] };
  } else if (u === 'https://ani.pm/api/partner/v1/series/777') {
    body = { title: { english: 'Legacy Explicit ID Anime' }, malId: 654, episodes: [] };
  } else if (u === 'https://ani.pm/api/partner/v1/lookup?anilist=123456') {
    body = { items: [{ englishTitle: 'Legacy Explicit ID Anime', anilistId: 123456, malId: 654 }] };
  } else if (u.indexOf('https://ani.pm/api/anime/settlar/session?') === 0) {
    body = { embedUrl: 'https://embed.settlar.io/embed?t=session-token' };
  } else if (u === 'https://embed.settlar.io/api/embed/session?t=session-token') {
    body = {
      source: 'https://cdn.example/mock-episode.m3u8',
      subtitles: [{ url: 'https://cdn.example/en.vtt', label: 'English' }]
    };
  }
  return { status: 200, body: JSON.stringify(body) };
};

const provider = require('../providers/anipm.js');

async function main() {
  assert.equal(provider.version, '1.3.9');
  assert.equal(provider.getInfo().name, 'Ani.pm');
  assert.equal(provider.getInfo().type, 'anime');
  assert.equal(provider.getSettings()[0].default, 'sub');

  const searchUrl = 'https://ani.pm/api/anime/search?q=Mock%20Anime&page=1';
  transientFailures.set(searchUrl, 1);
  const results = await provider.search('Mock Anime', 1, {});
  assert.equal(calls.filter((c) => c.url === searchUrl).length, 2, 'transient API failures should retry');
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Mock Anime');
  assert.equal(results[0].englishTitle, 'Mock Anime Romaji');
  assert.equal(results[0].malId, 999);
  assert.equal(results[0].anilistId, 123);

  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.title, 'Mock Anime');
  assert.equal(detail.malId, 999);
  assert.equal(detail.episodes.length, 2);
  assert.deepEqual(detail.episodes.map((ep) => ep.number), [1, 2], 'episodes must be ascending for Z Mode canonical mapping');
  assert.equal(detail.episodes[0].title, 'The Beginning');
  assert.equal(detail.episodes[1].title, 'The Journey');

  const partnerCallsBefore = calls.length;
  const partnerResults = await provider.search('Partner API', 1, {});
  assert.equal(partnerResults.length, 1);
  assert.equal(partnerResults[0].title, 'Partner API Anime');
  assert.equal(partnerResults[0].id, 'partner-1');
  assert.ok(calls.slice(partnerCallsBefore).some((c) => c.url === 'https://ani.pm/api/partner/v1/titles?q=Partner%20API'),
    'search should use Ani.pm partner v1 first');
  assert.ok(!calls.slice(partnerCallsBefore).some((c) => c.url === 'https://ani.pm/api/anime/search?q=Partner%20API&page=1'),
    'newer catalogue endpoint should only be used as fallback when partner search has no results');

  const backupResults = await provider.search('Partner Backup', 1, {});
  assert.equal(backupResults.length, 1);
  assert.equal(backupResults[0].url, 'https://ani.pm/ani/16498',
    'canonical AniList URL must outrank a partner API internal row ID');
  const backupEpisodes = await provider.getEpisodes(backupResults[0].url, {});
  assert.equal(backupEpisodes.length, 1);
  assert.equal(backupEpisodes[0].url, 'https://ani.pm/ani/16498||1',
    'legacy episode URLs must preserve the explicit AniList playback route');
  const backupStreams = await provider.getVideoSources(backupEpisodes[0].url, {});
  assert.equal(backupStreams.length, 1);
  assert.equal(backupStreams[0].url, 'https://megaplay.buzz/stream/s-2/16498/sub');
  assert.equal(backupStreams[0].container, 'embed',
    'use Ani.pm bootstrap MegaPlay backup when legacy Settlar resolution returns no source');

  // Zangetsu may use detail.episodes directly without calling getEpisodes().
  // Those URLs must retain the AniList ID so playback fallback can resolve.
  const backupDetail = await provider.getDetail(backupResults[0].url, {});
  assert.equal(backupDetail.episodes.length, 1);
  assert.equal(backupDetail.episodes[0].url, 'https://ani.pm/ani/16498||1',
    'detail-generated episodes must preserve the canonical AniList route');
  const detailBackupStreams = await provider.getVideoSources(backupDetail.episodes[0].url, {});
  assert.equal(detailBackupStreams.length, 1);
  assert.equal(detailBackupStreams[0].url, 'https://megaplay.buzz/stream/s-2/16498/sub',
    'detail-generated episode URLs must reach the Ani.pm backup stream fallback');
  assert.ok(calls.some((c) => c.url.indexOf('https://ani.pm/api/anime/playback-bootstrap/anilist/16498?') === 0),
    'legacy partner results must try modern bootstrap backup when legacy Settlar resolution fails');

  const brokenResults = await provider.search('Broken Anime', 1, {});
  assert.equal(brokenResults.length, 1);
  const brokenDetail = await provider.getDetail(brokenResults[0].url, {});
  assert.ok(brokenDetail, "a known search result must survive empty/failed bootstrap responses");
  assert.equal(brokenDetail.title, "Broken Anime");
  assert.equal(brokenDetail.anilistId, 456);
  assert.equal(brokenDetail.malId, 654);
  assert.deepEqual(brokenDetail.episodes, [],
    "the fallback must not invent episodes when bootstrap has no usable episode metadata");

  const aliasResults = await provider.search('ID Aliases', 1, {});
  assert.equal(aliasResults[0].id, 'anime:external-42');
  assert.equal(aliasResults[0].url, 'anipm://anime/external-42');
  assert.equal(aliasResults[0].anilistId, 4567, 'first valid explicit AniList alias wins');
  assert.equal(aliasResults[0].malId, 1234, 'first valid explicit MAL alias wins');
  const aliasDetail = await provider.getDetail(aliasResults[0].url, {});
  assert.equal(aliasDetail.anilistId, 4567);
  assert.equal(aliasDetail.malId, 1234);
  assert.ok(calls.some((c) => c.url.indexOf('/playback-bootstrap/anime/external-42?') >= 0),
    'source identifier must be passed through unchanged');

  const urlIdResults = await provider.search('URL AniList ID', 1, {});
  assert.equal(urlIdResults.length, 1);
  assert.equal(urlIdResults[0].url, 'anipm://anime/source-key-42');
  assert.equal(urlIdResults[0].anilistId, 4321,
    'extract the AniList ID from an /ani/<id> URL on current API results');
  const urlIdDetail = await provider.getDetail(urlIdResults[0].url, {});
  assert.equal(urlIdDetail.anilistId, 4321,
    'preserve the URL-derived AniList ID in cached/fallback detail');
  assert.ok(calls.some((c) => c.url.indexOf('/playback-bootstrap/anime/source-key-42?') >= 0),
    'detail lookup must use the unmodified source-native ID, not the AniList ID');
  assert.ok(!calls.some((c) => c.url.indexOf('/playback-bootstrap/anime/4320?') >= 0 ||
    c.url.indexOf('/playback-bootstrap/anime/4322?') >= 0),
    'do not offset any IDs when passing them to Ani.pm');

  const nestedIdResults = await provider.search('Nested AniList ID', 1, {});
  assert.equal(nestedIdResults.length, 1);
  assert.equal(nestedIdResults[0].anilistId, 87654,
    'read the AniList ID from nested identifiers');
  const nestedIdDetail = await provider.getDetail(nestedIdResults[0].url, {});
  assert.equal(nestedIdDetail.anilistId, 87654,
    'preserve nested AniList IDs in detail');

  const legacyGeneric = await provider.search('Legacy Generic', 1, {});
  assert.equal(legacyGeneric.length, 1);
  assert.equal(legacyGeneric[0].id, '789', 'legacy source ID must outrank a separate MAL ID');
  assert.equal(legacyGeneric[0].malId, 654);
  assert.equal(legacyGeneric[0].anilistId, null, 'generic legacy source ID is not an AniList ID');
  const genericDetail = await provider.getDetail(legacyGeneric[0].url, {});
  assert.equal(genericDetail.id, '789');
  assert.equal(genericDetail.malId, 654);
  assert.equal(genericDetail.anilistId, undefined);
  assert.ok(calls.some((c) => c.url === 'https://ani.pm/api/partner/v1/series/789'));
  assert.ok(!calls.some((c) => c.url.indexOf('/partner/v1/lookup?anilist=789') >= 0),
    'do not query AniList lookup with a generic source ID');

  const legacyExplicit = await provider.search('Legacy Explicit', 1, {});
  assert.equal(legacyExplicit[0].id, '777');
  assert.equal(legacyExplicit[0].anilistId, 123456);
  const explicitDetail = await provider.getDetail(legacyExplicit[0].url, {});
  assert.equal(explicitDetail.anilistId, 123456, 'preserve a separately identified tracker ID verbatim');
  assert.ok(calls.some((c) => c.url === 'https://ani.pm/api/partner/v1/lookup?anilist=123456'));
  assert.ok(!calls.some((c) => c.url.indexOf('/partner/v1/lookup?anilist=123455') >= 0 ||
    c.url.indexOf('/partner/v1/lookup?anilist=123457') >= 0), 'no +/- ID mutation is permitted');

  const bootstrapCallsBeforeEpisodes = calls.filter((c) => c.url.indexOf('https://ani.pm/api/anime/playback-bootstrap/anime/123?') === 0).length;
  const episodes = await provider.getEpisodes(results[0].url, {});
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].title, 'The Beginning');
  assert.equal(calls.filter((c) => c.url.indexOf('https://ani.pm/api/anime/playback-bootstrap/anime/123?') === 0).length, bootstrapCallsBeforeEpisodes,
    'getEpisodes should reuse successful detail bootstrap data');

  const streams = await provider.getVideoSources(episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/mock-episode.m3u8');
  assert.equal(streams[0].container, 'hls');
  assert.equal(streams[0].headers.Referer, 'https://embed.settlar.io/');
  assert.equal(streams[0].subtitles[0].file, 'https://cdn.example/en.vtt');
  assert.ok(calls.every((c) => c.options.headers && c.options.headers.Referer));

  console.log('Ani.pm mocked integration tests passed.');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
