const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const calls = [];
global.__settings = {
  miruro: {
    apiHosts: 'https://primary.test\nhttps://fallback.test',
    providerOrder: 'bee,hop',
    disabledProviders: '',
    audioMode: 'both',
    autoFallback: true,
    maxProviderAttempts: '8',
    requestTimeoutMs: '8000',
    qualityPreference: '1080p',
    homeSections: 'spotlight,trending,invalid',
    showAdult: false,
    cacheSeconds: '0'
  }
};

const anime = {
  id: 178005,
  idMal: 59047,
  title: { romaji: "Tamon's B-Side", english: "Tamon's B-Side", native: '' },
  description: 'Mock detail',
  coverImage: { large: 'https://img.example/cover.jpg' },
  bannerImage: 'https://img.example/banner.jpg',
  seasonYear: 2026,
  status: 'RELEASING',
  averageScore: 82,
  genres: ['Comedy', 'Romance'],
  studios: { nodes: [{ name: 'Studio Mock' }] }
};
const episodes = {
  mappings: { anilistId: 178005, malId: 59047 },
  providers: {
    bee: { meta: { id: 'tamon-bside' }, episodes: {
      sub: [
        { id: 'watch/bee/178005/sub/anikoto-1', number: 1, title: 'Episode One', image: 'https://img.example/ep1.jpg', filler: false },
        { id: 'watch/bee/178005/sub/anikoto-2', number: 2, title: 'Episode Two' }
      ],
      dub: [{ id: 'watch/bee/178005/dub/anikoto-1', number: 1, title: 'Episode One Dub', audio: 'dub' }]
    }},
    hop: { meta: { id: 'tamon-hop' }, episodes: {
      sub: [{ id: 'watch/hop/178005/sub/kickassanime-1', number: 1, title: 'Episode One' }],
      dub: []
    }}
  }
};

function response(status, body) {
  return { status, body: typeof body === 'string' ? body : JSON.stringify(body) };
}
global.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, init: init || {} });
  if (u.startsWith('https://primary.test/')) {
    if (u.includes('/search?')) return response(403, { message: 'blocked' });
    if (u.includes('/episodes/')) return response(503, { message: 'upstream unavailable' });
    if (u.includes('/watch/')) return response(403, { message: 'blocked stream api' });
    if (u.includes('/info/')) return response(502, { message: 'unavailable' });
    if (u.includes('/spotlight')) return response(503, { message: 'unavailable' });
    if (u.includes('/trending')) return response(403, { message: 'blocked' });
  }
  if (u.startsWith('https://fallback.test/')) {
    if (u.includes('/search?')) return response(200, { page: 1, results: [
      { id: 178005, title: { romaji: "Tamon's B-Side" }, coverImage: { large: 'https://img.example/cover.jpg' }, seasonYear: 2026 },
      { id: 999, title: { romaji: 'Adult mock' }, isAdult: true }
    ] });
    if (u.includes('/episodes/')) return response(200, episodes);
    if (u.includes('/info/')) return response(200, anime);
    if (u.includes('/spotlight')) return response(200, { results: [anime] });
    if (u.includes('/trending')) return response(200, { results: [] });
    if (u.includes('/watch/bee/') || u.includes('/stream?provider=bee') || u.includes('/sources?')) return response(200, { streams: [] });
    if (u.includes('/watch/hop/')) return response(200, {
      streams: [{ url: 'https://cdn.example/master.m3u8', type: 'hls', quality: '1080p', referer: 'https://embed.example/' }],
      subtitles: [{ file: 'https://cdn.example/en.vtt', label: 'English', language: 'en', format: 'vtt' }]
    });
  }
  return response(404, { message: 'not found' });
};

const provider = require('../providers/miruro.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((item) => item.id === 'miruro');

async function main() {
  assert.ok(source, 'Miruro source must be registered');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);

  const settings = provider.getSettings();
  assert.deepEqual(settings.map((x) => x.key), (source.settings || []).map((x) => x.key));
  assert.ok(settings.every((x) => x.label && x.description));
  assert.deepEqual(provider._config().hosts, ['https://primary.test', 'https://fallback.test']);
  assert.equal(provider._config().autoFallback, true);
  assert.equal(provider._config().maxAttempts, 8);

  const found = await provider.search('Tamon', 1, {});
  assert.equal(found.length, 1, 'adult results are filtered by default');
  assert.equal(found[0].url, 'miruro://anime/178005');
  assert.equal(found[0].cover, 'https://img.example/cover.jpg');
  assert.ok(calls.some((x) => x.url.startsWith('https://primary.test/search?')));
  assert.ok(calls.some((x) => x.url.startsWith('https://fallback.test/search?')),
    'search retries an alternate API host after 403');

  calls.length = 0;
  const detail = await provider.getDetail('miruro://anime/178005', {});
  assert.equal(detail.title, "Tamon's B-Side");
  assert.equal(detail.status, 'ongoing');
  assert.deepEqual(detail.studios, ['Studio Mock']);
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 1);
  assert.equal(detail.episodes.length, 3);
  assert.ok(calls.some((x) => x.url.includes('/info/178005')));
  assert.ok(calls.some((x) => x.url.includes('/episodes/178005')));

  calls.length = 0;
  const episode = detail.episodes.find((x) => x.number === 1 && x.category === 'sub');
  const streams = await provider.getVideoSources(episode.url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://cdn.example/master.m3u8');
  assert.equal(streams[0].container, 'hls');
  assert.equal(streams[0].headers.Referer, 'https://embed.example/');
  assert.equal(streams[0].subtitles[0].url, 'https://cdn.example/en.vtt');
  assert.ok(calls.some((x) => x.url.includes('/watch/bee/')));
  assert.ok(calls.some((x) => x.url.includes('/stream?provider=bee')));
  assert.ok(calls.some((x) => x.url.includes('/sources?')));
  assert.ok(calls.some((x) => x.url.includes('/watch/hop/')),
    'empty stream results on the first backend fall through to the next one');

  global.__settings.miruro.audioMode = 'sub';
  const onlySub = await provider.getEpisodes('miruro://anime/178005', { forceRefresh: true });
  assert.ok(onlySub.length > 0);
  assert.ok(onlySub.every((x) => x.category === 'sub'));

  global.__settings.miruro.audioMode = 'both';
  global.__settings.miruro.autoFallback = false;
  calls.length = 0;
  await assert.rejects(() => provider.getVideoSources(episode.url, {}), /no stream endpoint returned playable sources/i);
  assert.equal(calls.filter((x) => x.url.includes('/watch/bee/')).length, 2,
    'one primary plus one API host retry is attempted, but no second provider');
  assert.ok(calls.some((x) => x.url.includes('/stream?provider=bee')));
  assert.ok(calls.some((x) => x.url.includes('/sources?')));

  global.__settings.miruro.autoFallback = true;
  global.__settings.miruro.providerOrder = 'hop,bee';
  global.__settings.miruro.maxProviderAttempts = '1';
  const cfg = provider._config();
  assert.deepEqual(cfg.providerOrder, ['hop', 'bee']);
  assert.equal(cfg.maxAttempts, 1);
  assert.equal(cfg.qualityPreference, '1080p');

  global.__settings.miruro.disabledProviders = 'bee';
  assert.equal(provider._config().disabledProviders[0], 'bee');
  const filtered = provider._buildEpisodes(178005, episodes);
  assert.ok(filtered.every((row) => provider._decodeEpisode(row.url).options.every((option) => option.provider !== 'bee')));
  const ordered = provider._qualitySort([{quality:'720p'}, {quality:'1080p'}, {quality:'480p'}], '1080p');
  assert.equal(ordered[0].quality, '1080p');

  assert.throws(() => provider._decodeEpisode('not-a-miruro-url'), /invalid episode URL/i);

  console.log('Miruro tests passed: manifest, settings, API-host fallback, catalogue mapping, audio filtering, server fallback, route fallback, stream/subtitle mapping, quality preference, disabled servers.');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});