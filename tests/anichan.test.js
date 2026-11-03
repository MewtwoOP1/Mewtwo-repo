const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.__settings = {
  anichan: {
    audioMode: 'both',
    homeSections: 'trending,popular',
    requestTimeoutMs: '10000',
    sessionRefresh: true,
    maxStreams: '8',
    showAdult: false
  }
};

const media = {
  id: 123,
  idMal: 456,
  title: { english: 'Mock Anime', romaji: 'Mock Anime', native: 'モック' },
  description: 'Mock description',
  coverImage: { extraLarge: 'https://img.example/poster.jpg' },
  bannerImage: 'https://img.example/banner.jpg',
  episodes: 12,
  status: 'RELEASING',
  genres: ['Action'],
  seasonYear: 2026,
  averageScore: 82,
  isAdult: false,
  synonyms: [],
  studios: { nodes: [{ name: 'Studio Test' }] }
};
let sessionCalls = 0;
let serverCalls = 0;
const requests = [];

function response(status, body, headers) {
  return { status, body: typeof body === 'string' ? body : JSON.stringify(body), headers: headers || {} };
}

global.fetch = async (url, init) => {
  const u = String(url);
  const o = init || {};
  requests.push({ url: u, options: o });
  if (u === 'https://graphql.anilist.co') {
    const payload = JSON.parse(o.body);
    if (payload.query.includes('Media(id:$id')) return response(200, { data: { Media: media } });
    if (payload.query.includes('Page(')) return response(200, { data: { Page: { media: [media] } } });
  }
  if (u === 'https://anichan.to/api/watch/episodes?anilistId=123') {
    return response(200, { episodes: 2, dubAvailable: true });
  }
  if (u === 'https://anichan.to/api/watch/session') {
    sessionCalls += 1;
    return response(200, { exp: Math.floor(Date.now() / 1000) + 7200 }, {
      'set-cookie': 'anichan_ws=session-' + sessionCalls + '; Path=/; Max-Age=7200'
    });
  }
  if (u.includes('/api/watch/servers?')) {
    serverCalls += 1;
    const cookie = (o.headers || {}).Cookie || (o.headers || {}).cookie || '';
    assert.ok(cookie.startsWith('anichan_ws=session-'));
    if (serverCalls === 1) return response(401, { detail: 'session' });
    return response(200, {
      servers: [
        { name: 'MegaPlay_HD1', stream: '/duplicate.m3u8', label: '1080p', rank: 0, subtitles: [] },
        { name: 'AniChan Main', stream: '/hls/master.m3u8', label: '★1080p', rank: 1,
          subtitles: [{ url: '/subs/English (CR)0.vtt?token=abc', lang: 'eng' }] },
        { name: 'Backup HLS', stream: 'https://cdn.example/backup.m3u8', label: '720p', rank: 2, subtitles: [] }
      ]
    });
  }
  return response(404, { message: 'not found' });
};

const provider = require('../providers/anichan.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((x) => x.id === 'anichan');

async function main() {
  assert.ok(source, 'AniChan must be registered in the manifest');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.deepEqual(provider.getSettings().map((x) => x.key), source.settings.map((x) => x.key));

  const search = await provider.search('Mock Anime', 1, {});
  assert.equal(search.length, 1);
  assert.equal(search[0].url, 'anichan://anime/123');
  assert.equal(search[0].cover, 'https://img.example/poster.jpg');

  const detail = await provider.getDetail('anichan://anime/123', {});
  assert.equal(detail.title, 'Mock Anime');
  assert.equal(detail.status, 'ongoing');
  assert.equal(detail.episodes.length, 4);
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 2);
  assert.ok(detail.episodes.every((x) => ['sub', 'dub'].includes(x.category)));

  const subEpisode = detail.episodes.find((x) => x.number === 1 && x.category === 'sub');
  const streams = await provider.getVideoSources(subEpisode.url, {});
  assert.equal(streams.length, 2, 'duplicate MegaPlay server is excluded');
  assert.equal(streams[0].url, 'https://anichan.to/hls/master.m3u8');
  assert.equal(streams[0].container, 'hls');
  assert.equal(streams[0].quality, '1080p');
  assert.equal(streams[0].subtitles[0].url, 'https://anichan.to/subs/English%20(CR)0.vtt?token=abc');
  assert.equal(streams[0].subtitles[0].lang, 'en');
  assert.equal(streams[1].url, 'https://cdn.example/backup.m3u8');
  assert.equal(sessionCalls, 2, '401 causes the session cookie to be refreshed once');
  assert.equal(serverCalls, 2, 'the server list is retried once after session refresh');

  global.__settings.anichan.audioMode = 'sub';
  const subOnly = await provider.getDetail('anichan://anime/123', {});
  assert.ok(subOnly.episodes.every((x) => x.category === 'sub'));

  global.__settings.anichan.audioMode = 'dub';
  const dubOnly = await provider.getDetail('anichan://anime/123', {});
  assert.ok(dubOnly.episodes.every((x) => x.category === 'dub'));

  assert.ok(requests.some((x) => x.url === 'https://anichan.to/api/watch/session' && x.options.method === 'POST'));
  assert.ok(requests.some((x) => x.url.includes('/api/watch/servers?anilistId=123&ep=1&category=sub')));
  assert.throws(() => provider.getVideoSources('not-anichan://episode/1'), /invalid episode URL/i);

  console.log('AniChan tests passed: AniList metadata, episode catalogue, sub/dub settings, session cookie creation, 401 refresh, duplicate backend filtering, HLS and VTT mapping.');
}

main().catch((e) => { console.error(e && e.stack || e); process.exitCode = 1; });
