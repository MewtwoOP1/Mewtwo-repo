'use strict';

/*
 * KayoAnime provider contract tests.
 *
 * KayoAnime is a WordPress release index whose posts link to Google Drive
 * folders/files. These tests use a deterministic fetch double so the suite
 * verifies real parsing and resolution rules without touching the network:
 *   - WordPress REST search/home/detail and the HTML search fallback;
 *   - public Drive folder listings (escaped _DRIVE_ivd JSON);
 *   - private "Google Group" folders are reported, never bypassed;
 *   - one episode row per real file, quality variants grouped as streams;
 *   - direct Drive byte endpoints and confirmation-page resolution;
 *   - every attempted request is HTTPS and no Drive preview URL is returned.
 */

const assert = require('node:assert/strict');

global.__settings = {
  kayoanime: { verifyPlayback: true, maxFiles: 300, preferredAudio: 'any' }
};

function mockResponse(status, body, headers) {
  const normalized = {};
  Object.keys(headers || {}).forEach((key) => {
    normalized[key.toLowerCase()] = String(headers[key]);
  });
  return {
    status: status,
    headers: {
      get(name) { return normalized[String(name).toLowerCase()] || ''; }
    },
    text: async function () { return String(body == null ? '' : body); }
  };
}

function makePost(id, slug, title, categories, content, cover) {
  return {
    id: id,
    date: '2024-01-01T00:00:00',
    link: 'https://kayoanime.com/' + slug + '/',
    title: { rendered: title },
    excerpt: { rendered: '<p>Excerpt for ' + title + '</p>' },
    content: { rendered: content },
    categories: categories || [],
    _embedded: {
      'wp:featuredmedia': cover ? [{ source_url: cover }] : [],
      'wp:term': [(categories || []).map((categoryId) => ({
        taxonomy: 'category',
        name: categoryId === 2 ? 'Anime Movie' : categoryId === 4 ? 'Anime Series' : categoryId === 3 ? 'Ongoing Anime' : 'Action'
      }))]
    }
  };
}

function infoBlock(values) {
  const data = values || {};
  return '<div class="toggle"><h3 class="toggle-head">Information</h3><div class="toggle-content"><ul>' +
    '<li>Type: ' + (data.type || 'TV') + '</li>' +
    '<li>Episodes: ' + (data.episodes || '12') + '</li>' +
    '<li>Status: ' + (data.status || 'Finished Airing') + '</li>' +
    '<li>Aired: ' + (data.aired || 'Jan 1, 2020') + '</li>' +
    '<li>Premiered: ' + (data.premiered || '') + '</li>' +
    '<li>Studios: ' + (data.studios || 'Test Studio') + '</li>' +
    '<li>Genres: ' + (data.genres || 'Action, Fantasy') + '</li>' +
    '<li>Duration: ' + (data.duration || '24 min.') + '</li>' +
    '<li>Rating: ' + (data.rating || 'PG-13') + '</li>' +
    '</ul></div></div>';
}

function drivePage(title, files) {
  const rows = files.map((file) => [
    file.id, ['parent-folder'], file.name, file.mime || 'video/x-matroska',
    0, null, 0, 0, 0, 0, 0, null, null, file.size || 0
  ]);
  const json = JSON.stringify([rows]).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return '<html><head><title>' + title + ' \u2013 Google Drive</title></head><body>' +
    '<script>window[\'_DRIVE_ivd\'] = \'' + json + '\';</script></body></html>';
}

const posts = {
  'test-series': makePost(101, 'test-series', 'Test Series (Season 1) 1080p Dual Audio HEVC', [4],
    '<p>A test synopsis.</p>' + infoBlock({ type: 'TV', episodes: '2', status: 'Finished Airing', aired: 'Jan 1, 2020', studios: 'Test Studio', genres: 'Action, Fantasy' }) +
    '<div class="toggle"><h3 class="toggle-head">Test Series</h3><div class="toggle-content">' +
    '<a href="https://drive.google.com/drive/folders/FOLDER_PUBLIC">1080p</a>' +
    '<a href="https://drive.google.com/drive/folders/FOLDER_PRIVATE">720p [Private Drive]</a>' +
    '<a href="https://groups.google.com/g/testgroup">Google Group</a>' +
    '</div></div>', 'https://img.example/test-series.jpg'),
  'test-movie-variants': makePost(102, 'test-movie-variants', 'Test Movie 1080p Dual Audio HEVC', [2],
    '<p>A movie synopsis.</p>' + infoBlock({ type: 'Movie', episodes: '1', status: 'Finished Airing', aired: 'Jan 1, 2021', studios: 'Test Studio', genres: 'Adventure', duration: '2 hr.', rating: 'PG-13' }) +
    '<div class="toggle"><h3 class="toggle-head">Test Movie</h3><div class="toggle-content">' +
    '<a href="https://drive.google.com/drive/folders/FOLDER_720">720p</a>' +
    '<a href="https://drive.google.com/file/d/FILE_1080_DIRECT/view">1080p</a>' +
    '</div></div>', 'https://img.example/test-movie.jpg'),
  'test-confirm': makePost(103, 'test-confirm', 'Confirm Movie 1080p HEVC', [2],
    '<p>Confirm synopsis.</p>' + infoBlock({ type: 'Movie', episodes: '1', status: 'Finished Airing', aired: 'Jan 1, 2022', studios: 'Test Studio', genres: 'Drama', duration: '2 hr.', rating: 'PG-13' }) +
    '<div class="toggle"><h3 class="toggle-head">Confirm Movie</h3><div class="toggle-content">' +
    '<a href="https://drive.google.com/file/d/FILE_CONFIRM/view">1080p</a>' +
    '</div></div>', null)
};

const folders = {
  FOLDER_PUBLIC: drivePage('Test Series - S01', [
    { id: 'FILE_EP1', name: 'Test Series - S01E01.mkv', size: 1000 },
    { id: 'FILE_EP2', name: 'Test Series - S01E02.mkv', size: 2000 },
    { id: 'FILE_NCOP', name: 'Test Series - NCOP.mkv', size: 500 }
  ]),
  FOLDER_PRIVATE: '<html><head><title>Google Drive: Sign-in</title></head><body>Sign in to continue</body></html>',
  FOLDER_720: drivePage('Test Movie', [
    { id: 'FILE_720', name: 'Test Movie 720p.mkv', size: 1000 }
  ])
};

const files = {
  FILE_EP1: { type: 'application/octet-stream', length: '1000', disposition: 'attachment; filename="Test Series - S01E01.mkv"' },
  FILE_EP2: { type: 'application/octet-stream', length: '2000', disposition: 'attachment; filename="Test Series - S01E02.mkv"' },
  FILE_720: { type: 'application/octet-stream', length: '1000', disposition: 'attachment; filename="Test Movie 720p.mkv"' },
  FILE_1080_DIRECT: { type: 'application/octet-stream', length: '2000', headHtml: true, disposition: 'attachment; filename="Test Movie.mkv"' },
  FILE_CONFIRM: 'html',
  FILE_PRIVATE: 'private'
};

const confirmationHtml = '<html><body><form action="https://drive.usercontent.google.com/download" method="post">' +
  '<input type="hidden" name="id" value="FILE_CONFIRM">' +
  '<input type="hidden" name="export" value="download">' +
  '<input type="hidden" name="confirm" value="t">' +
  '<input type="hidden" name="uuid" value="abc">' +
  '</form></body></html>';

const searchRows = [
  makePost(201, 'search-anime', 'Search Anime 1080p', [4], '', 'https://img.example/search-anime.jpg'),
  makePost(201, 'search-anime', 'Search Anime 1080p', [4], '', 'https://img.example/search-anime.jpg'),
  makePost(202, 'search-movie', 'Search Movie', [2], '', null)
];

const homeRows = {
  latest: [makePost(301, 'latest-anime', 'Latest Anime', [4], '', 'https://img.example/latest.jpg')],
  ongoing: [makePost(302, 'ongoing-anime', 'Ongoing Anime', [3], '', null)],
  movies: [makePost(303, 'home-movie', 'Home Movie', [2], '', null)],
  chinese: [makePost(304, 'chinese-anime', 'Chinese Anime', [31], '', null)]
};

const calls = [];

global.fetch = async function (input, init) {
  const url = String(input && input.url ? input.url : input);
  const options = init || {};
  const method = String(options.method || 'GET').toUpperCase();
  calls.push({ url: url, method: method, headers: options.headers || {} });
  if (!/^https:\/\//i.test(url)) throw new Error('Non-HTTPS fetch attempted: ' + url);

  if (url.indexOf('/wp-json/wp/v2/posts?search=') !== -1) {
    if (url.indexOf('search=fallback') !== -1) return mockResponse(500, 'search unavailable');
    return mockResponse(200, JSON.stringify(searchRows), { 'content-type': 'application/json' });
  }

  if (url.indexOf('/wp-json/wp/v2/posts?slug=') !== -1) {
    const slug = decodeURIComponent((url.match(/[?&]slug=([^&]+)/) || [])[1] || '');
    const post = posts[slug];
    return post ? mockResponse(200, JSON.stringify([post]), { 'content-type': 'application/json' }) : mockResponse(200, '[]', { 'content-type': 'application/json' });
  }

  if (url.indexOf('/wp-json/wp/v2/posts?per_page=12') !== -1) {
    if (url.indexOf('categories=31') !== -1) return mockResponse(200, JSON.stringify(homeRows.chinese), { 'content-type': 'application/json' });
    if (url.indexOf('categories=3') !== -1) return mockResponse(200, JSON.stringify(homeRows.ongoing), { 'content-type': 'application/json' });
    if (url.indexOf('categories=2') !== -1) return mockResponse(200, JSON.stringify(homeRows.movies), { 'content-type': 'application/json' });
    return mockResponse(200, JSON.stringify(homeRows.latest), { 'content-type': 'application/json' });
  }

  if (url.indexOf('https://kayoanime.com/?s=') === 0) {
    return mockResponse(200, '<h2 class="post-title"><a href="https://kayoanime.com/fallback-result/">Fallback Result</a></h2>',
      { 'content-type': 'text/html' });
  }

  if (url.indexOf('https://drive.google.com/drive/folders/') === 0) {
    const folderId = url.split('/folders/')[1].split(/[?#]/)[0];
    return folders[folderId] ? mockResponse(200, folders[folderId], { 'content-type': 'text/html' }) : mockResponse(404, 'missing');
  }

  if (url.indexOf('https://drive.usercontent.google.com/download') === 0) {
    const id = decodeURIComponent((url.match(/[?&]id=([^&]+)/) || [])[1] || '');
    if (url.indexOf('uuid=abc') !== -1) {
      return mockResponse(206, '', {
        'content-type': 'application/octet-stream',
        'content-range': 'bytes 0-1/5000',
        'content-disposition': 'attachment; filename="Confirmed.mkv"'
      });
    }
    const file = files[id];
    if (file === 'private') return mockResponse(403, 'forbidden');
    if (file === 'html') {
      if (method === 'HEAD') return mockResponse(200, '', { 'content-type': 'text/html' });
      return mockResponse(200, confirmationHtml, { 'content-type': 'text/html' });
    }
    if (!file) return mockResponse(404, 'missing');
    if (method === 'HEAD' && file.headHtml) {
      return mockResponse(200, '', { 'content-type': 'text/html', 'content-length': '0' });
    }
    if (method === 'HEAD') {
      return mockResponse(200, '', {
        'content-type': file.type,
        'content-length': file.length,
        'content-disposition': file.disposition
      });
    }
    return mockResponse(206, '', {
      'content-type': file.type,
      'content-length': '2',
      'content-range': 'bytes 0-1/' + file.length,
      'content-disposition': file.disposition
    });
  }

  return mockResponse(404, 'not found');
};

const provider = require('../providers/kayoanime.js');

async function main() {
  const manifest = require('../index.json');
  const source = manifest.sources.find((item) => item.id === 'kayoanime');
  assert.ok(source, 'kayoanime must be registered in index.json');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().name, source.name);
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider.getInfo().lang, source.lang);
  assert.equal(provider.getInfo().type, source.type);
  assert.equal(provider.getInfo().baseUrl, 'https://kayoanime.com');
  assert.deepEqual(provider.getSettings().map((item) => item.key), source.settings.map((item) => item.key));

  assert.deepEqual(await provider.search('', 1, {}), []);
  const results = await provider.search('test anime', 1, {});
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Search Anime 1080p');
  assert.equal(results[0].cover, 'https://img.example/search-anime.jpg');
  assert.equal(results[0].type, 'anime');
  assert.equal(results[0].year, null);
  assert.match(results[0].url, /^kayoanime:\/\/media\//);
  assert.equal(results[1].type, 'movie');

  const fallback = await provider.search('fallback query', 1, {});
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].title, 'Fallback Result');
  assert.equal(fallback[0].url, 'kayoanime://media/' + encodeURIComponent('https://kayoanime.com/fallback-result/'));

  const home = await provider.getHome({});
  assert.deepEqual(home.map((section) => section.title), ['Latest Releases', 'Ongoing Anime', 'Anime Movies', 'Chinese Anime']);
  assert.equal(home[0].items[0].title, 'Latest Anime');
  assert.equal(home[1].items[0].status, 'ongoing');
  assert.equal(home[2].items[0].type, 'movie');
  assert.equal(home[3].items[0].title, 'Chinese Anime');

  const detail = await provider.getDetail('https://kayoanime.com/test-series/', {});
  assert.equal(detail.title, 'Test Series (Season 1)');
  assert.equal(detail.cover, 'https://img.example/test-series.jpg');
  assert.equal(detail.status, 'Finished Airing');
  assert.equal(detail.year, 2020);
  assert.equal(detail.type, 'anime');
  assert.deepEqual(detail.genres, ['Action', 'Fantasy']);
  assert.deepEqual(detail.studios, ['Test Studio']);
  assert.equal(detail.episodes.length, 2);
  assert.deepEqual(detail.episodes.map((episode) => [episode.season, episode.number]), [[1, 1], [1, 2]]);
  assert.equal(detail.episodes[0].quality, '1080p');
  assert.equal(detail.episodes[0].encoding, 'HEVC');
  assert.equal(detail.episodes[0].audio, 'Dual Audio');
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 0);
  assert.match(detail.description, /Restricted Google Drive folder "720p \[Private Drive\]"/);
  assert.match(detail.description, /Extra video files \(not episodes\): Test Series - NCOP\.mkv/);
  assert.match(detail.description, /https:\/\/groups\.google\.com\/g\/testgroup/);
  assert.ok(!/drive\.google\.com\/file\/d\/[^ ]+\/preview/i.test(detail.description));

  const episodes = await provider.getEpisodes('https://kayoanime.com/test-series/', {});
  assert.equal(episodes.length, 2);

  const streams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, 'https://drive.usercontent.google.com/download?id=FILE_EP1&export=download&confirm=t');
  assert.equal(streams[0].container, 'mkv');
  assert.equal(streams[0].quality, '1080p');
  assert.equal(streams[0].encoding, 'HEVC');
  assert.equal(streams[0].audio, 'Dual Audio');
  assert.equal(streams[0].label, 'KayoAnime 1080p HEVC Dual Audio');
  assert.equal(streams[0].downloadable, true);
  assert.equal(streams[0].size, 1000);
  assert.equal(streams[0].isActive, true);
  assert.ok(/Mozilla\/5\.0/.test(streams[0].headers['User-Agent']));
  assert.ok(!/\/view|\/preview/.test(streams[0].url));

  assert.equal(provider._movieTitle('[Kayoanime] [The Boy and the Beast] - [720p] - [Dual Audio].mkv'), 'The Boy and the Beast');
  assert.equal(provider._movieTitle('Test Movie 720p.mkv'), 'Test Movie');

  const movie = await provider.getDetail('https://kayoanime.com/test-movie-variants/', {});
  assert.equal(movie.type, 'movie');
  assert.equal(movie.episodes.length, 1);
  assert.equal(movie.episodes[0].number, 1);
  assert.equal(movie.episodes[0].title, 'Test Movie');
  const movieStreams = await provider.getVideoSources(movie.episodes[0].url, {});
  assert.equal(movieStreams.length, 2);
  assert.equal(movieStreams[0].quality, '1080p');
  assert.equal(movieStreams[1].quality, '720p');
  assert.equal(movieStreams[0].url, 'https://drive.usercontent.google.com/download?id=FILE_1080_DIRECT&export=download&confirm=t');
  assert.equal(movieStreams[1].url, 'https://drive.usercontent.google.com/download?id=FILE_720&export=download&confirm=t');
  assert.equal(movieStreams[0].isActive, true);
  assert.equal(movieStreams[1].isActive, false);
  assert.equal(movieStreams[0].size, 2000);
  assert.equal(movieStreams[1].size, 1000);

  const confirm = await provider.getDetail('https://kayoanime.com/test-confirm/', {});
  assert.equal(confirm.episodes.length, 1);
  assert.equal(confirm.episodes[0].title, 'Movie');
  const confirmStreams = await provider.getVideoSources(confirm.episodes[0].url, {});
  assert.equal(confirmStreams.length, 1);
  assert.match(confirmStreams[0].url, /uuid=abc/);
  assert.equal(confirmStreams[0].container, 'mkv');
  assert.equal(confirmStreams[0].size, 5000);

  await assert.rejects(
    provider.getVideoSources('kayoanime://file/FILE_PRIVATE?name=Private.mkv', {}),
    /private|access-restricted/i
  );

  assert.deepEqual(await provider.getVideoSources('https://kayoanime.com/__not_an_episode__', {}), []);

  assert.ok(calls.length > 0, 'the provider should have made requests');
  assert.ok(calls.every((call) => /^https:\/\//i.test(call.url)), 'every provider request must be HTTPS');

  console.log('KayoAnime WordPress search, metadata, public/private Drive folders, direct files, confirmation pages, variant grouping, and playback validation tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
