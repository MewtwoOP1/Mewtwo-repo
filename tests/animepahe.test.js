const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.__settings = {
  animepahe: {
    audioMode: 'both',
    miruroApiHosts: 'https://api.hiyori.tv\nhttps://miruro.zenos.my.id',
    directTimeoutMs: '3000',
    directLookup: true,
    preferH264: true,
    qualityPreference: '1080p',
    maxTitleCandidates: '3',
    requestCacheSeconds: '0'
  }
};

const media = {
  id: 321, idMal: 654,
  title: { english: 'Mock Anime', romaji: 'Mock Anime', native: 'モック' },
  description: 'Mock description',
  coverImage: { extraLarge: 'https://img.example/mock.jpg' },
  bannerImage: null, episodes: 12, status: 'FINISHED', genres: ['Action'],
  seasonYear: 2024, averageScore: 80, isAdult: false, synonyms: []
};
const episodes = {
  providers: {
    kiwi: { episodes: {
      sub: [
        { id: 'watch/kiwi/321/sub/animepahe-1', number: 1, title: 'Episode 1' },
        { id: 'watch/kiwi/321/sub/animepahe-2', number: 2, title: 'Episode 2' }
      ],
      dub: [{ id: 'watch/kiwi/321/dub/animepahe-1', number: 1, title: 'Episode 1 Dub' }]
    }}
  }
};
let directAllowed = false;
const calls = [];
function response(status, body) {
  return { status, body: typeof body === 'string' ? body : JSON.stringify(body), headers: {} };
}
global.fetch = async (url, init) => {
  const u = String(url);
  const o = init || {};
  calls.push({ url: u, options: o });

  if (u === 'https://graphql.anilist.co') {
    const query = JSON.parse(o.body).query;
    if (query.includes('Media(id:$id')) return response(200, { data: { Media: media } });
    if (query.includes('Page(')) return response(200, { data: { Page: { media: [media] } } });
  }

  if (u === 'https://api.hiyori.tv/episodes/321') return response(200, { success: true, results: episodes });
  if (u.startsWith('https://api.hiyori.tv/watch/kiwi/')) return response(200, { streams: [] });
  if (u.startsWith('https://api.hiyori.tv/stream?provider=kiwi')) return response(503, { message: 'temporarily unavailable' });
  if (u.startsWith('https://miruro.zenos.my.id/stream?provider=kiwi')) {
    return response(200, { streams: [{ url: 'https://cdn.example/fallback.m3u8', type: 'hls', quality: '720p', referer: 'https://embed.example/' }] });
  }
  if (u.startsWith('https://api.hiyori.tv/sources?')) return response(404, { message: 'not found' });
  if (u.startsWith('https://miruro.zenos.my.id/watch/kiwi/')) return response(200, { streams: [] });

  if (u.startsWith('https://animepahe.pw/api?m=search')) {
    if (!directAllowed) return response(403, 'Cloudflare challenge');
    return response(200, { data: [{ session: 'pahe-session', title: 'Mock Anime', episodes: 12 }] });
  }
  if (u === 'https://animepahe.pw/anime/pahe-session') {
    return response(200, '<a href="https://anilist.co/anime/321">AniList</a><a href="https://myanimelist.net/anime/654">MAL</a>');
  }
  if (u.startsWith('https://animepahe.pw/api?m=release')) {
    return response(200, { total: 12, per_page: 30, last_page: 1, data: [{ episode: 1, session: 'episode-session', audio: 'jpn' }] });
  }
  if (u === 'https://animepahe.pw/play/pahe-session/episode-session') {
    return response(200, '<div id="resolutionMenu"><button data-src="https://kwik.cx/e/mock" data-fansub="SubsPlease" data-resolution="1080" data-audio="jpn" data-av1="0">1080p</button><button data-src="https://kwik.cx/e/av1" data-fansub="AV1" data-resolution="1080" data-audio="jpn" data-av1="1">1080p AV1</button></div>');
  }
  if (u === 'https://kwik.cx/e/mock') return response(200, '<video src="https://vault.example/master.m3u8"></video>');

  return response(404, { message: 'not found' });
};

const provider = require('../providers/animepahe.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((x) => x.id === 'animepahe');

async function main() {
  assert.ok(source, 'AnimePahe must be registered in the manifest');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.deepEqual(provider.getSettings().map((x) => x.key), source.settings.map((x) => x.key));

  const results = await provider.search('Mock Anime', 1, {});
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'animepahe://anime/321');

  const detail = await provider.getDetail('animepahe://anime/321', {});
  assert.equal(detail.title, 'Mock Anime');
  assert.equal(detail.status, 'completed');
  assert.equal(detail.episodes.length, 3);
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 1);
  assert.ok(detail.episodes.every((x) => x.url.startsWith('animepahe://episode/')));

  const sub = detail.episodes.find((x) => x.number === 1 && x.category === 'sub');
  calls.length = 0;
  const fallback = await provider.getVideoSources(sub.url, {});
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].url, 'https://cdn.example/fallback.m3u8');
  assert.equal(fallback[0].container, 'hls');
  assert.equal(fallback[0].headers.Referer, 'https://embed.example/');
  assert.ok(calls.some((x) => x.url.startsWith('https://animepahe.pw/api?m=search') && x.options.browser === true),
    'direct requests opt into the native browser lane');
  assert.ok(calls.some((x) => x.url.startsWith('https://api.hiyori.tv/watch/kiwi/')),
    '403 from direct AnimePahe falls back to Kiwi');
  assert.ok(calls.some((x) => x.url.startsWith('https://api.hiyori.tv/stream?provider=kiwi')),
    'a no-stream watch response falls back to the quality-aware route');
  assert.ok(calls.some((x) => x.url.startsWith('https://miruro.zenos.my.id/stream?provider=kiwi')),
    'a failed API host rotates to the next configured host');

  // Turn the direct endpoints on and verify ID confirmation, Kwik parsing and H.264 selection.
  directAllowed = true;
  calls.length = 0;
  const direct = await provider.getVideoSources(sub.url, {});
  assert.equal(direct.length, 1);
  assert.equal(direct[0].url, 'https://vault.example/master.m3u8');
  assert.equal(direct[0].container, 'hls');
  assert.equal(direct[0].referer, 'https://kwik.cx/');
  assert.ok(calls.some((x) => x.url === 'https://animepahe.pw/anime/pahe-session'),
    'candidate must be confirmed by the series AniList/MAL IDs');
  assert.ok(calls.some((x) => x.url === 'https://kwik.cx/e/mock' && x.options.browser === true));

  const ids = provider._parseIds('<meta name="anilist" content="321"><meta name="mal" content="654">');
  assert.deepEqual(ids, { anilistId: 321, malId: 654 });
  const release = provider._parseRelease(JSON.stringify({ total: 1, per_page: 30, last_page: 1, data: [{ episode: 1, session: 'x' }] }));
  assert.equal(release.episodes[1], 'x');
  const variants = provider._variants('<button data-src="https://kwik.cx/e/a" data-resolution="720" data-audio="jpn" data-av1="0"><button data-src="https://kwik.cx/e/b" data-resolution="1080" data-audio="jpn" data-av1="1">');
  assert.equal(provider._selectVariant(variants, 'sub').url, 'https://kwik.cx/e/a', 'H.264 takes priority over an AV1 encode');
  assert.equal(provider._playlist('<video src="https://cdn.example/plain.m3u8"></video>'), 'https://cdn.example/plain.m3u8');

  global.__settings.animepahe.audioMode = 'dub';
  const dubOnly = await provider.getEpisodes('animepahe://anime/321', { forceRefresh: true });
  assert.ok(dubOnly.every((x) => x.category === 'dub'));

  console.log('AnimePahe tests passed: AniList search, Miruro/Kiwi episode catalogue, SUB/DUB settings, direct ID confirmation, browser-request opt-in, Cloudflare failure fallback, API-host rotation, route fallback, Kwik playlist extraction, and AV1 avoidance.');
}

main().catch((e) => { console.error(e && e.stack || e); process.exitCode = 1; });
