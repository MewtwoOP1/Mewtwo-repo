'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../providers/aiostreams.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../index.json'), 'utf8'));
const registered = manifest.sources.find((entry) => entry.id === 'aiostreams');

function response(data, status) {
  return { status: status || 200, body: typeof data === 'string' ? data : JSON.stringify(data) };
}
function load(fetcher, settings) {
  const sandbox = {
    module: { exports: {} },
    fetch: fetcher,
    __settings: { aiostreams: settings || {} },
    Promise, Date, Math, Object, String, Array, Number, RegExp, Error, JSON,
    parseInt, isFinite, encodeURIComponent, decodeURIComponent,
    setTimeout, clearTimeout, AbortController, console
  };
  vm.runInNewContext(source, sandbox, { timeout: 1000 });
  return sandbox.module.exports;
}
const settings = {
  tmdbApiKey: 'TEST_TMDB_KEY',
  manifestUrl: 'https://aio.example/stremio/test-user/test-password/manifest.json',
  showP2P: false,
  maxConcurrentRequests: '5',
  requestTimeoutMs: '5000',
  streamTimeoutMs: '7000',
  totalTimeoutMs: '8000'
};
const tmdbMovie = {
  id: 501, media_type: 'movie', title: 'Example Film', original_title: 'Example Film',
  overview: 'Film overview', poster_path: '/film.jpg', backdrop_path: '/film-wide.jpg',
  release_date: '2024-02-03', genre_ids: [28], vote_average: 7.8
};
const tmdbTv = {
  id: 601, media_type: 'tv', name: 'Example Series', original_name: 'Example Series',
  overview: 'Series overview', poster_path: '/series.jpg', backdrop_path: '/series-wide.jpg',
  first_air_date: '2023-04-05', genre_ids: [16], vote_average: 8.1
};
function movieDetail() {
  return {
    id: 501, title: 'Example Film', original_title: 'Example Film', overview: 'Film overview',
    poster_path: '/film.jpg', backdrop_path: '/film-wide.jpg', release_date: '2024-02-03',
    genres: [{ id: 28, name: 'Action' }], status: 'Released', vote_average: 7.8
  };
}
function tvDetail(seasonCount) {
  const count = seasonCount || 2;
  return {
    id: 601, name: 'Example Series', original_name: 'Example Series',
    overview: 'Series overview', poster_path: '/series.jpg', backdrop_path: '/series-wide.jpg',
    first_air_date: '2023-04-05', genres: [{ id: 16, name: 'Animation' }],
    status: 'Returning Series', vote_average: 8.1,
    seasons: Array.from({ length: count }, (_, i) => ({ id: 700 + i, season_number: i + 1, episode_count: 1 }))
  };
}
function streams() {
  const results = [{
    name: 'Example 1080p English Dubbed',
    url: 'https://cdn.example/episode.mp4',
    requestHeaders: { Referer: 'https://origin.example/', Host: 'must-not-forward.example', Authorization: 'Bearer playback' },
    addon: 'Test Addon',
    size: 1073741824,
    seeders: 20,
    parsedFile: { resolution: '1080p', encode: 'HEVC', languages: ['English'], seasons: [2], episodes: [1] },
    subtitles: [{ url: 'https://cdn.example/en.vtt', lang: 'en', label: 'English', format: 'vtt', default: true }, { url: 'file:///blocked.srt', lang: 'xx' }]
  }, {
    name: 'HLS stream 2', url: 'https://cdn.example/stream.m3u8'
  }, {
    name: 'Stream 3', url: 'https://cdn.example/3?token=ok'
  }, {
    name: 'Stream 4', url: 'https://cdn.example/4.mp4'
  }, {
    name: 'Stream 5', url: 'https://cdn.example/5.mp4'
  }, {
    name: 'Stream 6', url: 'https://cdn.example/6.mp4'
  }, {
    name: 'Stream 7', url: 'https://cdn.example/7.mp4'
  }, {
    name: 'wrong season', url: 'https://cdn.example/wrong.mp4', parsedFile: { seasons: [1], episodes: [1] }
  }, {
    name: 'duplicate', url: 'https://cdn.example/episode.mp4'
  }, {
    name: 'unsafe', url: 'javascript:alert(1)'
  }, {
    name: 'magnet', url: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567'
  }];
  return { success: true, data: { results: results, errors: [] } };
}
async function main() {
  assert.ok(registered, 'AIOStreams stays registered');
  const provider = load(() => Promise.reject(new Error('unexpected fetch')), settings);
  assert.equal(provider.version, registered.version);
  assert.equal(provider.getInfo().version, '2.1.1');
  assert.equal(provider.getInfo().type, 'movie');
  assert.deepEqual(JSON.parse(JSON.stringify(provider.getSettings().map((x) => x.key))), registered.settings.map((x) => x.key));
  assert.ok(provider.getSettings().some((x) => x.key === 'tmdbApiKey'), 'TMDB credential setting exists');
  assert.ok(!source.includes('kitsu.app') && !source.includes('api.ani.zip') && !source.includes('cinemeta'), 'non-TMDB metadata APIs have been removed');
  assert.deepEqual(JSON.parse(JSON.stringify(provider._parseManifest(settings.manifestUrl))), {
    baseUrl: 'https://aio.example', uuid: 'test-user', password: 'test-password'
  });
  assert.equal(provider._parseManifest('https://aio.example/manifest.json'), null);

  const urls = [];
  const mainProvider = load((url, init) => {
    const parsed = new URL(String(url));
    urls.push({ url: String(url), headers: init.headers || {} });
    assert.equal(parsed.hostname === 'api.themoviedb.org' || parsed.hostname === 'aio.example', true, 'only TMDB metadata and AIOStreams stream hosts are called');
    if (parsed.hostname === 'api.themoviedb.org') {
      assert.equal(parsed.searchParams.get('api_key'), 'TEST_TMDB_KEY');
      if (parsed.pathname === '/3/movie/popular') return Promise.resolve(response({ results: [tmdbMovie] }));
      if (parsed.pathname === '/3/tv/popular') return Promise.resolve(response({ results: [tmdbTv] }));
      if (parsed.pathname === '/3/discover/tv') return Promise.resolve(response({ results: [{ ...tmdbTv, id: 602, name: 'Anime TV' }] }));
      if (parsed.pathname === '/3/discover/movie') return Promise.resolve(response({ results: [{ ...tmdbMovie, id: 502, title: 'Anime Film' }] }));
      if (parsed.pathname === '/3/trending/all/week') return Promise.resolve(response({ results: [tmdbMovie, tmdbTv] }));
      if (parsed.pathname === '/3/search/multi') return Promise.resolve(response({ results: [tmdbMovie, tmdbTv, { id: 900, media_type: 'person', name: 'Person result' }] }));
      if (parsed.pathname === '/3/movie/501') return Promise.resolve(response(movieDetail()));
      if (parsed.pathname === '/3/tv/601') return Promise.resolve(response(tvDetail(2)));
      if (parsed.pathname === '/3/tv/601/season/1') return Promise.resolve(response({ episodes: [{ id: 800, season_number: 1, episode_number: 1, name: 'Pilot', overview: 'Pilot synopsis', air_date: '2023-04-06', still_path: '/pilot.jpg' }] }));
      if (parsed.pathname === '/3/tv/601/season/2') return Promise.resolve(response({ episodes: [{ id: 801, season_number: 2, episode_number: 1, name: 'Return', air_date: '2024-04-06' }] }));
      throw new Error('Unexpected TMDB request ' + parsed.pathname);
    }
    if (parsed.pathname === '/api/v1/search') {
      assert.equal(parsed.searchParams.get('type'), 'series');
      assert.equal(parsed.searchParams.get('id'), 'tmdb:601:2:1');
      assert.equal(parsed.searchParams.get('format'), 'true');
      assert.equal(init.headers.Authorization, 'Basic ' + Buffer.from('test-user:test-password').toString('base64'));
      assert.equal(init.headers['x-aiostreams-user-data'], undefined);
      return Promise.resolve(response(streams()));
    }
    throw new Error('Unexpected host/path ' + parsed.hostname + parsed.pathname);
  }, settings);

  const home = await mainProvider.getHome();
  const sectionNames = home.map((x) => x.title);
  assert.deepEqual(JSON.parse(JSON.stringify(sectionNames)), ['Popular Movies', 'Popular TV Series', 'Anime Series', 'Anime Movies']);
  assert.equal(home[0].items[0].tmdbId, 501);
  assert.equal(home[1].items[0].tmdbIsTv, true);
  assert.ok(home[2].items[0].url.includes('/tv/602'));
  assert.ok(home[3].items[0].url.includes('/movie/502'));

  const search = await mainProvider.search('example', 1);
  assert.deepEqual(JSON.parse(JSON.stringify(search.map((x) => x.title))), ['Example Film', 'Example Series']);
  assert.equal(search[1].tmdbIsTv, true);
  const trending = await mainProvider.popular(1);
  assert.equal(trending.length, 2);

  const movie = await mainProvider.getDetail('aio://tmdb/movie/501');
  assert.equal(movie.title, 'Example Film');
  assert.equal(movie.tmdbId, 501);
  assert.deepEqual(JSON.parse(JSON.stringify(movie.genres)), ['Action']);
  assert.equal(movie.episodes.length, 1);
  const movieEpisodes = await mainProvider.getEpisodes('aio://tmdb/movie/501');
  assert.equal(movieEpisodes.length, 1);
  assert.equal(mainProvider._parseEpisodeUrl(movieEpisodes[0].url).movie, true);

  const show = await mainProvider.getDetail('aio://tmdb/tv/601');
  assert.equal(show.tmdbIsTv, true);
  assert.deepEqual(JSON.parse(JSON.stringify(show.genres)), ['Animation']);
  assert.equal(show.episodes.length, 2, 'TV detail contains episodes for the app detail screen');
  const eps = await mainProvider.getEpisodes('aio://tmdb/tv/601');
  assert.deepEqual(JSON.parse(JSON.stringify(eps.map((e) => [e.season, e.number, e.title]))), [
    [1, 1, 'S1 E1 - Pilot'], [2, 1, 'S2 E1 - Return']
  ]);
  const parsedEp = mainProvider._parseEpisodeUrl(eps[1].url);
  assert.equal(parsedEp.id, '601');
  assert.equal(parsedEp.season, 2);
  assert.equal(parsedEp.episode, 1);

  const sources = await mainProvider.getVideoSources(eps[1].url);
  assert.equal(sources.length, 7, 'all seven unique playable HTTP results are returned; not capped at five');
  const first = sources[0];
  assert.equal(first.url, 'https://cdn.example/episode.mp4');
  assert.equal(first.container, 'mp4');
  assert.equal(first.kind, 'dub');
  assert.equal(first.audioLang, 'English');
  assert.equal(first.quality, '1080p');
  assert.equal(first.headers.Referer, 'https://origin.example/');
  assert.equal(first.headers.Authorization, 'Bearer playback');
  assert.equal(first.headers.Host, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(first.subtitles)), [{ url: 'https://cdn.example/en.vtt', lang: 'en', label: 'English', format: 'vtt', default: true }]);
  assert.equal(sources[1].container, 'hls');
  assert.equal(sources[1].kind, 'unknown');
  assert.equal(sources.some((x) => x.url.includes('/wrong.mp4') || x.url.startsWith('javascript:') || x.url.startsWith('magnet:')), false);
  assert.equal(urls.filter((x) => new URL(x.url).hostname === 'api.themoviedb.org').length > 0, true);
  assert.equal(urls.some((x) => /kitsu|ani\.zip|cinemeta/i.test(x.url)), false);

  const p2p = load((url) => Promise.resolve(response({ success: true, data: { results: [{ url: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567', name: 'P2P' }] } })), { ...settings, showP2P: true });
  const p2pResults = await p2p.getVideoSources('aio://episode/movie/501?season=1&episode=1&movie=1');
  assert.equal(p2pResults.length, 1);
  assert.equal(p2pResults[0].container, 'torrent');

  let failedSearches = 0;
  const noRetry = load((url) => {
    if (String(url).includes('/api/v1/search')) {
      failedSearches++;
      return Promise.resolve(response({ message: 'temporarily unavailable' }, 503));
    }
    throw new Error('No TMDB request expected');
  }, settings);
  await assert.rejects(noRetry.getVideoSources('aio://episode/series/601?season=1&episode=1'), /HTTP 503/);
  assert.equal(failedSearches, 1, 'stream fetching does not spend time retrying a failed API request');

  let running = 0, peak = 0;
  const manySeasonFetch = load((url) => {
    const parsed = new URL(String(url));
    running++;
    peak = Math.max(peak, running);
    let result;
    if (parsed.pathname === '/3/tv/601') result = tvDetail(8);
    else if (/\/3\/tv\/601\/season\/\d+$/.test(parsed.pathname)) {
      const season = Number(parsed.pathname.split('/').pop());
      result = { episodes: [{ season_number: season, episode_number: 1, name: 'Episode ' + season }] };
    } else throw new Error('Unexpected concurrency request ' + parsed.pathname);
    return new Promise((resolve) => setTimeout(() => { running--; resolve(response(result)); }, 15));
  }, settings);
  const manyEpisodes = await manySeasonFetch.getEpisodes('aio://tmdb/tv/601');
  assert.equal(manyEpisodes.length, 8);
  assert.ok(peak <= 5, 'metadata requests never exceed configured concurrency');

  const priorityOrder = [];
  const prioritySettings = { ...settings, maxConcurrentRequests: '1' };
  const priorityProvider = load((url) => {
    const pathName = new URL(String(url)).pathname;
    priorityOrder.push(pathName);
    const data = pathName === '/api/v1/search' ? streams() : { results: [tmdbMovie] };
    return new Promise((resolve) => setTimeout(() => resolve(response(data)), 20));
  }, prioritySettings);
  const homePromise = priorityProvider.getHome();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const playbackPromise = priorityProvider.getVideoSources('aio://episode/series/601?season=2&episode=1');
  await Promise.all([homePromise, playbackPromise]);
  assert.ok(priorityOrder.indexOf('/api/v1/search') < priorityOrder.indexOf('/3/tv/popular'), 'queued playback lookup jumps ahead of catalog requests');

  // The production Zangetsu fetch interceptor supplies its built-in TMDB key
  // for the exact api.themoviedb.org host. A blank per-source key must still
  // request metadata rather than reject or display an empty catalogue.
  const defaultKeyRequests = [];
  const defaultKeyProvider = load((url, init) => {
    const parsed = new URL(String(url));
    defaultKeyRequests.push({ url: String(url), headers: init.headers || {} });
    assert.equal(parsed.hostname, 'api.themoviedb.org', 'default auth must use the host intercepted by Zangetsu');
    assert.equal(parsed.searchParams.has('api_key'), false, 'the provider delegates its built-in key to Zangetsu');
    assert.equal((init.headers || {}).Authorization, undefined);
    if (parsed.pathname === '/3/movie/popular') return Promise.resolve(response({ results: [tmdbMovie] }));
    if (parsed.pathname === '/3/tv/popular') return Promise.resolve(response({ results: [tmdbTv] }));
    if (parsed.pathname === '/3/discover/tv') return Promise.resolve(response({ results: [] }));
    if (parsed.pathname === '/3/discover/movie') return Promise.resolve(response({ results: [] }));
    throw new Error('Unexpected default-key request ' + parsed.pathname);
  }, { manifestUrl: settings.manifestUrl });
  const defaultHome = await defaultKeyProvider.getHome();
  assert.deepEqual(JSON.parse(JSON.stringify(defaultHome.map((x) => x.title))), ['Popular Movies', 'Popular TV Series']);
  assert.equal(defaultKeyRequests.length, 4, 'all TMDB home endpoints are reached without a custom key');

  const defaultUrl = defaultKeyProvider._tmdbUrl('/movie/popular', { page: 1 });
  assert.equal(new URL(defaultUrl.url).hostname, 'api.themoviedb.org');
  assert.equal(new URL(defaultUrl.url).searchParams.has('api_key'), false);

  const customKeyUrl = provider._tmdbUrl('/movie/501', { language: 'en-US' });
  assert.equal(new URL(customKeyUrl.url).hostname, 'api.themoviedb.org.');
  assert.equal(new URL(customKeyUrl.url).searchParams.get('api_key'), 'TEST_TMDB_KEY');
  assert.equal(customKeyUrl.headers.Host, 'api.themoviedb.org');

  const bearer = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ0ZXN0In0.signature';
  const bearerProvider = load(() => Promise.reject(new Error('unexpected network')), { ...settings, tmdbApiKey: bearer });
  const bearerUrl = bearerProvider._tmdbUrl('/movie/501', {});
  assert.equal(new URL(bearerUrl.url).hostname, 'api.themoviedb.org.');
  assert.equal(bearerUrl.headers.Authorization, 'Bearer ' + bearer);
  assert.equal(new URL(bearerUrl.url).searchParams.has('api_key'), false);
  assert.equal(bearerUrl.headers.Host, 'api.themoviedb.org');

  const allFail = load(() => Promise.resolve(response({ status_message: 'Invalid API key', status_code: 7 }, 401)), { ...settings, tmdbApiKey: 'invalid' });
  await assert.rejects(allFail.getHome(), /AIOStreams TMDB metadata failed: HTTP 401/);

  console.log('AIOStreams TMDB auth and stream-resolution tests passed.');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
