const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.__settings = {
  xfdm: {
    requestTimeoutMs: '10000',
    maxTitleCandidates: '5',
    maxMirrorChannels: '2',
    homeSections: 'trending,popular',
    cacheSeconds: '0',
    showAdult: false
  }
};

const media = {
  id: 9001, idMal: 9002,
  title: { english: 'Mock Anime', romaji: 'Mock Anime', native: 'モック作品' },
  description: 'Mock synopsis',
  coverImage: { extraLarge: 'https://img.example/poster.jpg' },
  bannerImage: null,
  episodes: 12, status: 'FINISHED', genres: ['Drama'],
  seasonYear: 2024, averageScore: 78, isAdult: false, synonyms: ['Mock Title']
};
const calls = [];
let noCatalog = false;
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
  if (u.startsWith('https://api.bgm.tv/v0/search/subjects?')) {
    assert.equal(o.method, 'POST');
    const body = JSON.parse(o.body);
    assert.equal(body.keyword, 'モック作品');
    assert.deepEqual(body.filter.type, [2]);
    return response(200, {
      data: [{ id: 555, type: 2, name: 'モック作品', name_cn: '模特作品', score: 7.8, date: '2024-01-01' }]
    });
  }
  if (u.startsWith('https://dm1.xfdm.pro/index.php/ajax/suggest?')) {
    if (noCatalog) return response(200, { list: [] });
    return response(200, {
      list: [{ id: 3500, name: '模特作品', pic: 'https://img.xfdm.pro/pic/cover/l/6f/42/555_cover.jpg' }]
    });
  }
  if (u.startsWith('https://dm1.xfdm.pro/search.html?')) {
    return response(200, noCatalog ? '<div class="public-list-box search-box"></div>' : '');
  }
  if (u === 'https://dm1.xfdm.pro/bangumi/3500.html') {
    return response(200,
      '<a href="/watch/3500/1/1.html">第01集</a>' +
      '<a href="/watch/3500/2/1.html">第01集</a>' +
      '<a href="/watch/3500/1/2.html">第02集</a>');
  }
  if (u === 'https://dm1.xfdm.pro/watch/3500/1/1.html') {
    return response(200, 'var player_aaaa = {"encrypt":0,"url":"https:\\\\/\\\\/apn.moedot.net\\\\/episode-1.mp4"};');
  }
  if (u === 'https://dm1.xfdm.pro/watch/3500/2/1.html') {
    return response(200, 'var player_aaaa = {"encrypt":0,"url":"https:\\\\/\\\\/play.xfvod.pro\\\\/episode-1.mp4"};');
  }
  if (u === 'https://dm1.xfdm.pro/watch/3500/1/2.html') {
    return response(200, 'var player_aaaa = {"encrypt":0,"url":"https:\\\\/\\\\/play.xfvod.pro\\\\/episode-2.mp4"};');
  }
  if (u === 'https://api.hiyori.tv/episodes/9001') {
    return response(200, {
      providers: {
        kiwi: { episodes: { sub: [{ id: 'watch/kiwi/9001/sub/xfdm-1', number: 1, title: 'Fallback Episode' }] } }
      }
    });
  }
  if (u.startsWith('https://api.hiyori.tv/watch/kiwi/')) {
    return response(200, { streams: [{ url: 'https://cdn.example/xfdm-fallback.m3u8', type: 'hls', quality: '720p' }] });
  }
  return response(404, { message: 'not found' });
};

const provider = require('../providers/xfdm.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((x) => x.id === 'xfdm');

async function main() {
  assert.ok(source, 'XFDM must be registered in the manifest');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);
  assert.deepEqual(provider.getSettings().map((x) => x.key), source.settings.map((x) => x.key));

  assert.equal(provider._normal('Mock Anime'), provider._normal('mock-anime'));
  assert.notEqual(provider._normal('Same Title Season 1'), provider._normal('Same Title Season 2'),
    'normalization must retain season markers and avoid false cross-season matches');
  const chosen = provider._chooseBangumi([
    { id: 1, type: 2, name: 'モック作品', name_cn: '模特作品', date: '2013-01-01' },
    { id: 2, type: 2, name: 'モック作品', name_cn: '模特作品', date: '2024-01-01' }
  ], ['モック作品'], media);
  assert.equal(chosen.id, 2, 'ambiguous exact names are resolved by year');

  const pathFromSearch = provider._suggestPath(
    '<div class="public-list-box search-box"><div style="background-image:url(https://img/pic/cover/l/6f/42/555_cover.jpg)"></div><a href="/bangumi/3500.html">Title</a></div>',
    555
  );
  assert.equal(pathFromSearch, '/bangumi/3500.html');

  const episodeRows = provider._episodeRows(
    '<a href="/watch/3500/1/1.html">第01集</a><a href="/watch/3500/2/1.html">第01集</a><a href="/watch/3500/1/2.html">第02集</a>'
  );
  assert.deepEqual(episodeRows.map((x) => [x.number, x.channel]), [[1, 1], [1, 2], [2, 1]]);

  const parsedPlayer = provider._playerUrl('var player_aaaa = {"encrypt":0,"url":"https:\\\\/\\\\/cdn.example\\\\/movie.mp4"};');
  assert.equal(parsedPlayer, 'https://cdn.example/movie.mp4');
  assert.equal(
    provider._playerUrl('<script>player_style=2</script><script>var player_aaaa = {"encrypt":0,"url":"https:\\\\/\\\\/cdn.example\\\\/after-style.mp4"};</script>'),
    'https://cdn.example/after-style.mp4',
    'an unrelated player_style assignment must not hide the real player config'
  );

  const home = await provider.getHome({});
  assert.equal(home.length, 2);
  assert.ok(home.every((section) => section.items.length === 1));

  const search = await provider.search('Mock Anime', 1, {});
  assert.equal(search.length, 1);
  assert.equal(search[0].url, 'xfdm://anime/9001');

  const detail = await provider.getDetail('xfdm://anime/9001', {});
  assert.equal(detail.title, 'Mock Anime (2024)');
  assert.equal(detail.year, '2024');
  assert.equal(detail.malId, 9002);
  assert.equal(detail.episodes.length, 2, 'episodes are deduplicated across mirrors/channels');
  assert.equal(provider._fallbackEpisodes(9001, 12).length, 12, 'AniList episode count remains visible when Bangumi has no exact subject match');
  assert.deepEqual(detail.episodes.map((x) => x.number), [1, 2]);
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 0);

  calls.length = 0;
  const sources = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(sources.length, 2, 'one second channel is retained as manual failover');
  assert.equal(sources[0].url, 'https://play.xfvod.pro/episode-1.mp4',
    'faster host should be ordered before the slow origin');
  assert.equal(sources[0].container, 'mp4');
  assert.equal(sources[0].kind, 'sub');
  assert.equal(sources[0].audioLang, 'ja');
  assert.deepEqual(sources[0].headers, {});
  assert.ok(!sources[0].subtitles || sources[0].subtitles.length === 0,
    'Chinese subtitles are burned into the video, not exposed as a selectable track');
  assert.ok(calls.every((x) => !x.url.includes('http://')), 'all provider requests remain HTTPS');
  assert.ok(calls.every((x) => !x.url.includes('play.xfvod.pro')), 'XFDM MP4s are not probed at playback time');

  assert.ok(calls.some((x) => x.url.startsWith('https://api.bgm.tv/v0/search/subjects?')),
    'Bangumi subject matching must be performed using its subject-search endpoint');
  assert.ok(calls.some((x) => x.url.includes('/index.php/ajax/suggest?')),
    'the XFDM suggestion endpoint should be used before HTML search');

  noCatalog = true;
  calls.length = 0;
  const fallback = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].url, 'https://cdn.example/xfdm-fallback.m3u8');
  assert.equal(fallback[0].kind, 'sub');
  assert.ok(calls.some((x) => x.url === 'https://api.hiyori.tv/episodes/9001'));

  await assert.rejects(async () => provider.getVideoSources('invalid-xfdm-url'), /invalid episode URL/i);
  await assert.rejects(async () => provider.getDetail('xfdm://anime/nope'), /invalid AniList ID/i);

  console.log('XFDM tests passed: manifest parity, season-aware normalization, Bangumi subject matching, cover-ID verification, episode label parsing and dedupe, player JSON extraction, MP4 mirror ordering without probing, no false subtitle/dub metadata, Miruro fallback, and invalid input handling.');
}

main().catch((e) => { console.error(e && e.stack || e); process.exitCode = 1; });
