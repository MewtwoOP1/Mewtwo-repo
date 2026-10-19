const assert = require('node:assert/strict');

const calls = [];
const searchRows = {
  data: [{
    _id: 'anime-123',
    title: 'Sousou no Frieren',
    alternativeTitle: { english: "Frieren: Beyond Journey's End" },
    posterImage: { medium: 'https://img.example/frieren-medium.jpg', large: 'https://img.example/frieren-large.jpg' },
    year: 2023
  }]
};
const episodeRows = {
  data: [
    { uid: 'episode-02', title: 'Take Care', number: '2' },
    { uid: 'episode-01', title: 'The Journey Begins', number: '1' }
  ]
};

global.fetch = async function (url, options) {
  url = String(url);
  calls.push({ url, options: options || {} });
  if (url === 'https://api.animeparadise.moe/search?q=Frieren&limit=20') {
    return { status: 200, body: JSON.stringify(searchRows) };
  }
  if (url === 'https://api.animeparadise.moe/anime/anime-123/episode') {
    return { status: 200, body: JSON.stringify(episodeRows) };
  }
  if (url === 'https://api.animeparadise.moe/ep/episode-01?origin=anime-123') {
    return { status: 200, body: JSON.stringify({
      data: { episode: {
        streamLink: 'signed-token/+?=abc',
        subData: [
          { src: 'https://subs.example/frieren-en.vtt', label: 'English', lang: 'en' },
          { url: 'https://subs.example/frieren-en.vtt', label: 'English duplicate', lang: 'en' },
          { url: 'https://subs.example/frieren-jp.srt', language: 'Japanese' },
          { file: 'javascript:alert(1)', label: 'bad' }
        ]
      } }
    }) };
  }
  return { status: 404, body: '{}' };
};

const provider = require('../providers/animeparadise.js');

async function main() {
  assert.equal(provider.version, '1.0.0');
  assert.equal(provider.getInfo().name, 'AnimeParadise');
  assert.equal(provider.getInfo().version, '1.0.0');
  assert.deepEqual(provider.getSettings(), []);

  const found = await provider.search('Frieren', 1, {});
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'anime-123');
  assert.equal(found[0].title, "Frieren: Beyond Journey's End");
  assert.equal(found[0].cover, 'https://img.example/frieren-medium.jpg');
  assert.equal(found[0].year, 2023);

  const detail = await provider.getDetail(found[0].url, {});
  assert.equal(detail.id, 'anime-123');
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.cover, 'https://img.example/frieren-medium.jpg');
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[0].url, 'animeparadise://episode/episode-01?origin=anime-123');
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 0);

  // getEpisodes reuses the short-lived episode cache rather than issuing a second API call.
  const before = calls.filter(c => c.url === 'https://api.animeparadise.moe/anime/anime-123/episode').length;
  const eps = await provider.getEpisodes(found[0].url, {});
  const after = calls.filter(c => c.url === 'https://api.animeparadise.moe/anime/anime-123/episode').length;
  assert.equal(eps.length, 2);
  assert.equal(after, before);

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.match(streams[0].url, /^https:\/\/stream\.animeparadise\.moe\/m3u8\?url=/);
  assert.equal(decodeURIComponent(streams[0].url.split('?url=')[1]), 'signed-token/+?=abc');
  assert.equal(streams[0].container, 'hls');
  assert.equal(streams[0].kind, 'sub');
  assert.equal(streams[0].subtitles.length, 2);
  assert.equal(streams[0].subtitles[0].lang, 'en');
  assert.equal(streams[0].subtitles[1].format, 'srt');
  assert.ok(calls.every(c => c.options.headers && c.options.headers.Referer));
  assert.equal(calls.filter(c => c.url.includes('/ep/')).length, 1);

  await assert.rejects(() => provider.getVideoSources('animeparadise://episode/not-valid', {}), /invalid episode URL/);
  console.log('AnimeParadise search, episode cache, signed HLS URL, headers, subtitle normalization and invalid-input tests passed.');
}

main().catch(e => { console.error(e); process.exitCode = 1; });