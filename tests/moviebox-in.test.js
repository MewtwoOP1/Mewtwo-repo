const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const API = 'https://api.inmoviebox.com';
const API_ROOT = API + '/wefeed-mobile-bff';
const DEFAULT_KEY = '76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O';
const ALT_KEY = 'Xqn2nnO41/L92o1iuXhSLHTbXvY4Z5ZZ62m8mSLA';
const calls = [];

function response(status, data) {
  return { status: status, body: JSON.stringify(data) };
}

function canonical(url, method, accept, contentType, body, timestamp) {
  const parsed = new URL(url);
  const values = new Map();
  parsed.searchParams.forEach((value, key) => {
    if (!values.has(key)) values.set(key, []);
    values.get(key).push(value);
  });
  const query = [...values.keys()].sort()
    .flatMap(key => values.get(key).map(value => key + '=' + value)).join('&');
  const bytes = body == null ? null : Buffer.from(String(body), 'utf8');
  const bodyHash = bytes == null ? '' : crypto.createHash('md5').update(bytes.subarray(0, 102400)).digest('hex');
  const bodyLength = bytes == null ? '' : String(bytes.length);
  return String(method || 'GET').toUpperCase() + '\n' +
    String(accept == null ? '' : accept) + '\n' +
    String(contentType == null ? '' : contentType) + '\n' +
    bodyLength + '\n' + timestamp + '\n' + bodyHash + '\n' +
    parsed.pathname + (query ? '?' + query : '');
}

function signedWith(url, options) {
  const headers = options.headers || {};
  const tokenParts = String(headers['x-client-token'] || '').split(',');
  assert.equal(tokenParts.length, 2, 'x-client-token should be timestamp,md5');
  const timestamp = tokenParts[0];
  assert.equal(tokenParts[1], crypto.createHash('md5').update(timestamp.split('').reverse().join('')).digest('hex'),
    'client token MD5 must match reversed timestamp');
  const signatureParts = String(headers['x-tr-signature'] || '').split('|');
  assert.equal(signatureParts.length, 3, 'signature should have timestamp|version|base64');
  assert.equal(signatureParts[0], timestamp, 'client token and signature timestamps must match');
  assert.equal(signatureParts[1], '2');
  const base = canonical(url, options.method, headers.accept, headers['content-type'], options.body, timestamp);
  for (const secret of [DEFAULT_KEY, ALT_KEY]) {
    const expected = crypto.createHmac('md5', Buffer.from(secret, 'base64')).update(base, 'utf8').digest('base64');
    if (expected === signatureParts[2]) return secret;
  }
  assert.fail('Request signature did not match either MovieBox key: ' + url);
}

function item(id, title, type, cover) {
  return { subjectId: String(id), title: title, subjectType: type || 1, cover: { url: cover || ('https://img.example/' + id + '.jpg') } };
}

const movie = {
  subjectId: '101',
  subjectType: 1,
  title: 'Test Movie',
  description: 'A fixture movie description.',
  releaseDate: '2024-03-04',
  duration: '2h 7m',
  genre: 'Action, Drama',
  imdbRatingValue: '7.8',
  cover: { url: 'https://img.example/test-movie.jpg' },
  countryName: 'India',
  staffList: [{ staffType: 1, name: 'Sample Actor', character: 'Lead', avatarUrl: 'https://img.example/actor.jpg' }],
  dubs: [
    { subjectId: '101', lanName: 'Hindi' },
    { subjectId: '102', lanName: 'English' }
  ]
};
const series = {
  subjectId: '201',
  subjectType: 2,
  title: 'Test Series',
  description: 'A fixture series description.',
  releaseDate: '2022-08-01',
  duration: '45m',
  genre: 'Drama, Mystery',
  cover: { url: 'https://img.example/test-series.jpg' },
  dubs: [{ subjectId: '201', lanName: 'Hindi' }]
};

global.fetch = async function (url, options) {
  url = String(url);
  options = options || {};
  const u = new URL(url);
  const headers = options.headers || {};
  const usedKey = signedWith(url, options);
  calls.push({ url: url, options: options, usedKey: usedKey });
  const p = u.pathname;
  const id = u.searchParams.get('subjectId');
  if (p === API_ROOT + '/tab-operating') {
    assert.equal(headers['x-play-mode'], '2');
    return response(200, { data: { items: [
      { title: 'banner', type: 'BANNER', banner: { banners: [{ subject: item(101, 'Top Movie') }] } },
      { title: 'Popular', type: 'SUBJECTS_MOVIE', subjects: [item(101, 'Top Movie'), item(201, 'Popular Series', 2)] },
      { title: 'Originals', type: 'CUSTOM', customData: { items: [{ subject: item(301, 'Custom Movie') }] } }
    ] } });
  }
  if (p === API_ROOT + '/subject-api/search/v2') {
    assert.equal(options.method, 'POST');
    const payload = JSON.parse(options.body);
    assert.equal(payload.keyword, 'Space & Time');
    assert.equal(payload.page, 2);
    assert.equal(payload.perPage, 10);
    return response(200, { data: { results: [
      { subjects: [item(101, 'Test Movie'), item(201, 'Test Series', 2)] },
      { subjects: [item(101, 'Duplicate Movie')] }
    ] } });
  }
  if (p === API_ROOT + '/subject-api/get') {
    if (id === '101') return response(200, { data: movie });
    if (id === '201') return response(200, { data: series });
    return response(404, { code: 404, message: 'not found' });
  }
  if (p === API_ROOT + '/subject-api/season-info' && id === '201') {
    return response(200, { data: { seasons: [{ se: 1, maxEp: 2 }, { se: 2, maxEp: 1 }] } });
  }
  if (p === API_ROOT + '/subject-api/play-info') {
    const se = Number(u.searchParams.get('se'));
    const ep = Number(u.searchParams.get('ep'));
    if (id === '102' && usedKey === DEFAULT_KEY) {
      return response(403, { code: 403, message: 'invalid signature' });
    }
    if (id === '101' && se === 0 && ep === 0) {
      return response(200, { data: { streams: [{
        id: 'stream-movie',
        url: 'https://cdn.example/movie.m3u8',
        format: 'HLS',
        resolutions: '1080P',
        codecName: 'h264',
        signCookie: 'session=movie-cookie'
      }] } });
    }
    if (id === '102' && se === 0 && ep === 0) {
      assert.equal(usedKey, ALT_KEY, 'alternate key should be retried after a signature failure');
      return response(200, { data: { streams: [{
        id: 'stream-dub',
        url: 'https://cdn.example/movie-dub.mp4',
        format: 'MP4',
        resolutions: '720P',
        codecName: 'h265'
      }] } });
    }
    if (id === '201' && se === 1 && ep === 2) {
      return response(200, { data: { streams: [{
        id: 'series-episode-2',
        url: 'https://cdn.example/series-episode-2.m3u8',
        format: 'HLS',
        resolutions: '1080P'
      }] } });
    }
    return response(200, { data: { streams: [] } });
  }
  if (p === API_ROOT + '/subject-api/get-stream-captions') {
    assert.equal(headers.accept, '');
    assert.equal(headers['content-type'], '');
    return response(200, { data: { extCaptions: [
      { url: 'https://cdn.example/caption-en.vtt', language: 'English' }
    ] } });
  }
  if (p === API_ROOT + '/subject-api/get-ext-captions') {
    return response(200, { data: { extCaptions: [
      { url: 'https://cdn.example/caption-hi.vtt', lan: 'Hindi' }
    ] } });
  }
  return response(404, { code: 404, message: 'no fixture for ' + p });
};

const provider = require('../providers/moviebox-in.js');

async function main() {
  assert.equal(provider.getInfo().name, 'MovieBox IN');
  assert.equal(provider.getInfo().version, '1.0.0');
  assert.equal(provider.version, '1.0.0');
  assert.equal(provider.getInfo().type, 'movie');
  assert.equal(provider.getInfo().lang, 'ta');
  assert.deepEqual(provider.getSettings(), []);

  const home = await provider.getHome({});
  assert.deepEqual(home.map(row => row.title), ['Top Picks', 'Popular', 'Originals']);
  assert.equal(home[0].items[0].url, 'moviebox-in://101');
  assert.equal(home[1].items[1].movieBoxSubjectType, 2);

  const results = await provider.search('Space & Time', 2, {});
  assert.equal(results.length, 2, 'duplicate subject IDs should be removed');
  assert.equal(results[0].title, 'Test Movie');
  assert.equal(results[1].movieBoxSubjectType, 2);
  assert.ok(calls.some(call => call.options.method === 'POST' && call.url.indexOf('/subject-api/search/v2') >= 0));

  const detail = await provider.getDetail(results[0].url, {});
  assert.equal(detail.title, 'Test Movie');
  assert.equal(detail.year, 2024);
  assert.equal(detail.score, 78);
  assert.equal(detail.duration, 127);
  assert.deepEqual(detail.genres, ['Action', 'Drama']);
  assert.equal(detail.actors[0].name, 'Sample Actor');
  assert.equal(detail.episodes.length, 1);
  assert.ok(detail.episodes[0].url.indexOf('moviebox-in-episode://') === 0);

  const seriesDetail = await provider.getDetail('moviebox-in://201', {});
  assert.equal(seriesDetail.title, 'Test Series');
  assert.equal(seriesDetail.episodes.length, 3);
  assert.equal(seriesDetail.episodes[0].season, 1);
  assert.equal(seriesDetail.episodes[2].season, 2);
  assert.equal(seriesDetail.episodes[2].episode, 1);
  const episodes = await provider.getEpisodes('moviebox-in://201', {});
  assert.equal(episodes.length, 3);

  const movieEpisode = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(movieEpisode.length, 2, 'original and dubbed streams should both be returned');
  assert.equal(movieEpisode[0].url, 'https://cdn.example/movie.m3u8');
  assert.equal(movieEpisode[0].quality, '1080p');
  assert.equal(movieEpisode[0].container, 'hls');
  assert.equal(movieEpisode[0].headers.Cookie, 'session=movie-cookie');
  assert.equal(movieEpisode[0].kind, 'sub');
  assert.ok(movieEpisode[0].subtitles.some(sub => sub.url === 'https://cdn.example/caption-en.vtt'));
  assert.ok(movieEpisode[0].subtitles.some(sub => sub.url === 'https://cdn.example/caption-hi.vtt'));
  assert.equal(movieEpisode[1].url, 'https://cdn.example/movie-dub.mp4');
  assert.equal(movieEpisode[1].audioLang, 'English');
  assert.equal(movieEpisode[1].kind, 'dub');
  const retries = calls.filter(call => call.url.indexOf('/subject-api/play-info?subjectId=102') >= 0);
  assert.equal(retries.length, 2, 'alternate key should be retried exactly once');
  assert.equal(retries[0].usedKey, DEFAULT_KEY);
  assert.equal(retries[1].usedKey, ALT_KEY);

  const seriesEpisode = seriesDetail.episodes[1];
  const seriesStreams = await provider.getVideoSources(seriesEpisode.url, {});
  assert.equal(seriesStreams.length, 1);
  assert.equal(seriesStreams[0].url, 'https://cdn.example/series-episode-2.m3u8');
  assert.ok(calls.some(call => call.url.indexOf('/play-info?subjectId=201&se=1&ep=2') >= 0));

  assert.deepEqual(await provider.getVideoSources('not-a-moviebox-url', {}), []);
  assert.ok(calls.every(call => !!call.options.headers['x-client-info']));
  console.log('MovieBox IN mocked home, search, details, seasons, signatures, dubs, subtitles and stream headers passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
