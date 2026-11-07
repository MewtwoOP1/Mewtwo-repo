'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.__settings = {
  animeav1: { audioMode: 'both', requestTimeoutMs: '12000' }
};

function json(value, status) {
  return new Response(JSON.stringify(value), {
    status: status || 200,
    headers: { 'content-type': 'application/json' }
  });
}
function html(value, status) {
  return new Response(value, {
    status: status || 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

// Pack a plain object into the flattened "devalue" shape SvelteKit emits.
function devalue(root) {
  const flat = [];
  function pack(value) {
    const index = flat.length;
    flat.push(null);
    if (Array.isArray(value)) {
      flat[index] = value.map(pack);
    } else if (value && typeof value === 'object') {
      const object = {};
      Object.keys(value).forEach((key) => { object[key] = pack(value[key]); });
      flat[index] = object;
    } else {
      flat[index] = value;
    }
    return index;
  }
  const rootIndex = pack(root);
  assert.equal(rootIndex, 0);
  return { type: 'data', nodes: [null, { type: 'data', data: flat }] };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function rot13(value) {
  return value.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
  });
}
function encodeVoe(config) {
  let text = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
  text = [...text].reverse().map((c) => String.fromCharCode(c.charCodeAt(0) + 3)).join('');
  text = Buffer.from(text, 'latin1').toString('base64');
  const junk = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += text.charAt(i);
    if (i % 7 === 3) out += junk[(i >> 3) % junk.length];
  }
  return rot13(out);
}
function voePage(config) {
  return '<html><body><script type="application/json">' +
    JSON.stringify([encodeVoe(config)]) + '</script></body></html>';
}

const searchPage = devalue({
  results: [
    {
      id: '159',
      title: 'Mock Anime',
      synopsis: 'Un resumen de prueba.',
      slug: 'mock-anime',
      category: { id: 1, name: 'TV Anime' }
    },
    {
      id: '3560',
      title: 'Mock Anime 2nd Season',
      synopsis: 'Otra temporada.',
      slug: 'mock-anime-2nd-season',
      category: { id: 1, name: 'TV Anime' }
    }
  ],
  total: 2
});

const cataloguePage = devalue({
  results: [
    { id: '4479', title: 'Catalogue Anime', synopsis: 'Catálogo.', slug: 'catalogue-anime' }
  ],
  total: 1
});

const mediaPage = devalue({
  media: {
    id: 159,
    title: 'Mock Anime',
    synopsis: 'Un resumen de prueba.',
    malId: 52991,
    startDate: '2023-09-29',
    score: 9.25,
    aka: { 'en-us': 'Mock Anime: English', 'ja-jp': 'モックアニメ' },
    genres: [{ id: 2, name: 'Aventura' }, { id: 6, name: 'Drama' }],
    episodes: [
      { id: 2047, number: 1 },
      { id: 2051, number: 2 },
      { id: 9999, number: 2.5 }
    ]
  }
});

const episodePage = devalue({
  media: { id: 159, title: 'Mock Anime' },
  episode: { number: 1, variants: { SUB: 1, DUB: 1 } },
  embeds: {
    SUB: [
      { server: 'Voe', url: 'https://voe.example/e/sub123' },
      { server: 'YourUpload', url: 'https://www.yourupload.com/embed/sub123' },
      { server: 'StreamTape', url: 'https://streamtape.com/e/ignored' }
    ],
    DUB: [
      { server: 'Voe', url: 'https://voe.example/e/dub123' }
    ]
  }
});

const episodePageNoDub = devalue({
  media: { id: 159, title: 'Mock Anime' },
  episode: { number: 2, variants: { SUB: 1 } },
  embeds: {
    SUB: [{ server: 'YourUpload', url: 'https://www.yourupload.com/embed/sub456' }],
    DUB: []
  }
});

const requests = [];
global.fetch = async (url, init) => {
  const target = String(url);
  const options = init || {};
  requests.push({ url: target, options });
  if (target.startsWith('https://animeav1.com/catalogo/__data.json?search=')) return json(searchPage);
  if (target === 'https://animeav1.com/catalogo/__data.json') return json(cataloguePage);
  if (target === 'https://animeav1.com/media/mock-anime/__data.json') return json(mediaPage);
  if (target === 'https://animeav1.com/media/mock-anime/1/__data.json') return json(episodePage);
  if (target === 'https://animeav1.com/media/mock-anime/2/__data.json') return json(episodePageNoDub);
  if (target === 'https://voe.example/e/sub123') {
    return html('<script>window.location.href = "https://voe.example/e/sub123-resolved";</script>');
  }
  if (target === 'https://voe.example/e/sub123-resolved') {
    return html(voePage({ source: 'https://cdn.example/voe-sub/master.m3u8' }));
  }
  if (target === 'https://voe.example/e/dub123') {
    return html(voePage({ source: 'https://cdn.example/voe-dub/master.m3u8' }));
  }
  if (target === 'https://www.yourupload.com/embed/sub123') {
    return html('<meta property="og:video" content="https://cdn.example/yourupload-sub.mp4"/>');
  }
  if (target === 'https://www.yourupload.com/embed/sub456') {
    return html('<meta property="og:video" content="https://cdn.example/yourupload-456.mp4"/>');
  }
  return html('not found', 404);
};

const provider = require('../providers/animeav1.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((entry) => entry.id === 'animeav1');

async function main() {
  assert.ok(source, 'AnimeAV1 must be registered in index.json');
  assert.deepEqual(provider.getInfo(), {
    name: source.name,
    lang: source.lang,
    baseUrl: 'https://animeav1.com',
    logo: source.logo,
    type: source.type,
    version: source.version
  });
  assert.deepEqual(provider.getSettings().map((item) => item.key),
    source.settings.map((item) => item.key));

  const search = await provider.search('Mock Anime', 1, {});
  assert.equal(search.length, 2);
  assert.equal(search[0].id, 'av1://media/mock-anime');
  assert.equal(search[0].title, 'Mock Anime');
  assert.equal(search[0].cover, 'https://cdn.animeav1.com/covers/159.jpg');
  assert.equal(search[0].description, 'Un resumen de prueba.');

  const home = await provider.getHome({});
  assert.equal(home.length, 1);
  assert.equal(home[0].title, 'AnimeAV1 Catálogo');
  assert.equal(home[0].items[0].id, 'av1://media/catalogue-anime');

  const detail = await provider.getDetail('av1://media/mock-anime', {});
  assert.equal(detail.title, 'Mock Anime');
  assert.equal(detail.malId, 52991);
  assert.equal(detail.year, '2023');
  assert.deepEqual(detail.genres, ['Aventura', 'Drama']);
  assert.deepEqual(detail.episodes.map((ep) => [ep.number, ep.category]),
    [[1, 'sub'], [1, 'dub'], [2, 'sub'], [2, 'dub']]);
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 2);

  const sub = await provider.getVideoSources('av1://episode/mock-anime/1/sub', {});
  assert.equal(sub.length, 2);
  assert.equal(sub[0].label, 'AnimeAV1 VOE');
  assert.equal(sub[0].url, 'https://cdn.example/voe-sub/master.m3u8');
  assert.equal(sub[0].type, 'hls');
  assert.equal(sub[1].label, 'AnimeAV1 YourUpload');
  assert.equal(sub[1].url, 'https://cdn.example/yourupload-sub.mp4');
  assert.equal(sub[1].headers.Referer, 'https://www.yourupload.com/');
  assert.equal(sub[0].isActive, true);
  assert.equal(sub[1].isActive, false);

  const dub = await provider.getVideoSources('av1://episode/mock-anime/1/dub', {});
  assert.equal(dub.length, 1);
  assert.equal(dub[0].url, 'https://cdn.example/voe-dub/master.m3u8');
  assert.equal(dub[0].audioLang, 'es');

  // A dub episode whose page has no DUB embeds falls back to the SUB host.
  const fallback = await provider.getVideoSources('av1://episode/mock-anime/2/dub', {});
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].url, 'https://cdn.example/yourupload-456.mp4');

  assert.deepEqual(await provider.getVideoSources('not-an-episode', {}), []);
  assert.equal(requests.every((entry) => entry.url.startsWith('https://')), true);

  global.__settings.animeav1.audioMode = 'sub';
  const subOnly = await provider.getDetail('av1://media/mock-anime', {});
  assert.equal(subOnly.episodes.every((ep) => ep.category === 'sub'), true);
  assert.equal(subOnly.episodes.length, 2);

  console.log('animeav1 provider tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
