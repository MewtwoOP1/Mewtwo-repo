'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
const targetIds = ['anichan', 'animepahe', 'xfdm', 'miruro'].filter((id) =>
  manifest.sources.some((item) => item.id === id)
);

function entryFor(id) {
  const entry = manifest.sources.find((item) => item.id === id);
  assert.ok(entry, 'manifest entry missing: ' + id);
  return entry;
}

test('provider manifest IDs are unique and every target source matches its module contract', () => {
  const ids = manifest.sources.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate provider ID in index.json');

  for (const id of targetIds) {
    const entry = entryFor(id);
    const absolutePath = path.join(root, entry.file);
    assert.ok(fs.existsSync(absolutePath), 'provider file missing: ' + entry.file);

    const provider = require(absolutePath);
    assert.equal(typeof provider.getInfo, 'function', id + '.getInfo');
    assert.equal(typeof provider.getSettings, 'function', id + '.getSettings');
    assert.equal(typeof provider.search, 'function', id + '.search');
    assert.equal(typeof provider.getDetail, 'function', id + '.getDetail');
    assert.equal(typeof provider.getEpisodes, 'function', id + '.getEpisodes');
    assert.equal(typeof provider.getVideoSources, 'function', id + '.getVideoSources');
    assert.equal(String(provider.getInfo().version), String(entry.version),
      id + ' provider/manifest version mismatch');
  }
});

test('AniChan SHA-256 and HMAC-SHA256 match standard vectors', () => {
  const provider = require(path.join(root, entryFor('anichan').file));
  assert.equal(Buffer.from(provider._sha256(Buffer.from('abc'))).toString('hex'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(Buffer.from(provider._hmac(Buffer.from('key'),
    Buffer.from('The quick brown fox jumps over the lazy dog'))).toString('hex'),
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
});

test('AniChan decrypts a signed AES-GCM server envelope through the runtime CTR bridge', async () => {
  const provider = require(path.join(root, entryFor('anichan').file));
  const keyset = provider._keysets[0];
  const nonce = 'test-session-nonce';
  const a = provider._b64(keyset.p);
  const b = provider._b64(keyset.i);
  const key0 = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) key0[i] = a[i] ^ b[i];
  const aesKey = Buffer.from(provider._hmac(key0, provider._utf8Ascii(nonce)));
  const iv = Buffer.from('00112233445566778899aabb', 'hex');
  const expected = { servers: [{ name: 'primary', type: 'hls', stream: 'https://cdn.example/master.m3u8' }] };
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(expected), 'utf8'), cipher.final()]);
  const encrypted = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  const previous = global.aesCtrDecrypt;
  global.aesCtrDecrypt = async ({ keyHex, counterHex, dataB64 }) => {
    assert.equal(counterHex, iv.toString('hex') + '00000002');
    const decipher = crypto.createDecipheriv('aes-256-ctr', Buffer.from(keyHex, 'hex'), Buffer.from(counterHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  };
  try {
    const result = await provider._decryptEnvelope({ v: 1, i: iv.toString('base64'), d: encrypted.toString('base64') }, { nonce }, keyset);
    assert.deepEqual(result, expected);
  } finally {
    if (previous === undefined) delete global.aesCtrDecrypt;
    else global.aesCtrDecrypt = previous;
  }
});
test('AnimePahe fallback inventory does not invent Kiwi episode routes', {
  skip: !manifest.sources.some((item) => item.id === 'animepahe')
}, () => {
  const provider = require(path.join(root, entryFor('animepahe').file));
  const episodes = provider._fallbackEpisodeList(154587, { episodes: 2 });
  assert.equal(episodes.length, 2);

  for (const episode of episodes) {
    const payload = JSON.parse(decodeURIComponent(
      episode.url.slice('animepahe://episode/'.length)
    ));
    assert.equal(payload.id, 154587);
    assert.equal(payload.route, '');
    assert.equal(payload.slug, '');
    assert.ok(payload.number > 0);
  }
});

test('AnimePahe shared episode inventory never invents Kiwi server IDs', {
  skip: !manifest.sources.some((item) => item.id === 'animepahe')
}, () => {
  const provider = require(path.join(root, entryFor('animepahe').file));
  const rows = provider._episodesFromMiruro(154587, {
    data: [{ episode_number: 1, title: 'Inventory-only episode', slug: 'pahe-ep-1' }]
  });
  assert.equal(rows.length, 1);
  const payload = JSON.parse(decodeURIComponent(
    rows[0].url.slice('animepahe://episode/'.length)
  ));
  assert.equal(payload.route, '');
  assert.equal(payload.slug, 'pahe-ep-1');
});

test('Miruro preserves API episode metadata and real provider routes', {
  skip: !manifest.sources.some((item) => item.id === 'miruro')
}, () => {
  const provider = require(path.join(root, entryFor('miruro').file));
  const episodes = provider._buildEpisodes(154587, {
    providers: {
      kiwi: {
        episodes: {
          sub: [{
            id: 'watch/kiwi/154587/sub/episode-one',
            number: 1,
            title: 'The First Episode',
            image: 'https://img.example/episode-one.jpg',
            airDate: '2025-01-01',
            description: 'Episode synopsis fixture',
            duration: 1420
          }]
        }
      }
    }
  });

  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].title, 'The First Episode');
  assert.equal(episodes[0].thumbnail, 'https://img.example/episode-one.jpg');
  assert.equal(episodes[0].date, '2025-01-01');
  assert.equal(episodes[0].description, 'Episode synopsis fixture');

  const payload = JSON.parse(decodeURIComponent(
    episodes[0].url.slice('miruro://episode/'.length)
  ));
  assert.equal(payload.options[0].provider, 'kiwi');
  assert.equal(payload.options[0].route, 'watch/kiwi/154587/sub/episode-one');
});

test('XFDM player URL parser reads JSON-escaped direct media URLs', {
  skip: !manifest.sources.some((item) => item.id === 'xfdm')
}, () => {
  const provider = require(path.join(root, entryFor('xfdm').file));
  const html = String.raw`<script>var player_aaaa={"encrypt":0,"url":"https:\\/\\/play.xfvod.pro:8088\\/temp\\/episode.mp4"};</script>`;
  assert.equal(
    provider._playerUrl(html),
    'https://play.xfvod.pro:8088/temp/episode.mp4'
  );
});
