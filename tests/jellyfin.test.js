'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const requests = [];
global.__settings = {
  jellyfin: {
    serverUrl: 'https://jf.example.test/',
    apiKey: 'test-api-key',
    userId: 'user-1',
    pageSize: '25',
    includeTrailers: false
  }
};

global.fetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  requests.push({ url: String(url), init });
  assert.equal(parsed.protocol, 'https:');
  assert.equal(init.headers['X-Emby-Token'], 'test-api-key');
  let body = {};
  if (parsed.pathname === '/Users/user-1/Views') {
    body = { Items: [{ Id: 'library-1', Name: 'Movies', CollectionType: 'movies' }] };
  } else if (parsed.pathname === '/Users/user-1/Items' && parsed.searchParams.get('ParentId') === 'library-1') {
    body = { Items: [{ Id: 'movie-1', Name: 'Test Movie', Type: 'Movie', ProductionYear: 2024, Overview: 'A test synopsis', ImageTags: { Primary: 'tag1' } }] };
  } else if (parsed.pathname === '/Users/user-1/Items' && parsed.searchParams.has('SearchTerm')) {
    body = { Items: [{ Id: 'series-1', Name: 'Test Series', Type: 'Series', ProductionYear: 2020 }] };
  } else if (parsed.pathname === '/Users/user-1/Items/movie-1') {
    body = { Id: 'movie-1', Name: 'Test Movie', Type: 'Movie', Overview: 'A test synopsis', Genres: ['Drama'], People: [{ Name: 'Actor One', Type: 'Actor' }] };
  } else if (parsed.pathname === '/Shows/series-1/Episodes') {
    body = { Items: [{ Id: 'episode-1', Name: 'Pilot', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1, SeriesName: 'Test Series', PremiereDate: '2024-01-01T00:00:00Z' }] };
  } else if (parsed.pathname === '/Users/user-1/Items/series-1') {
    body = { Id: 'series-1', Name: 'Test Series', Type: 'Series', Overview: 'Series synopsis' };
  } else if (parsed.pathname === '/Items/episode-1/PlaybackInfo') {
    body = { MediaSources: [{ Id: 'media-1', Name: 'Original', Container: 'mp4', MediaStreams: [{ Type: 'Subtitle', Language: 'en', DisplayTitle: 'English', Codec: 'srt', DeliveryUrl: '/Videos/episode-1/Subtitles/0/Stream.srt' }] }] };
  } else if (parsed.pathname === '/Users') {
    body = [{ Id: 'user-1', Name: 'Test User' }];
  } else if (parsed.pathname === '/Users/user-1/Items') {
    body = { Items: [] };
  } else if (parsed.pathname === '/Items/movie-1') {
    body = { Id: 'movie-1', Name: 'Test Movie', Type: 'Movie' };
  } else {
    throw new Error('Unexpected Jellyfin request: ' + parsed.pathname + parsed.search);
  }
  return { status: 200, body: JSON.stringify(body) };
};

const provider = require('../providers/jellyfin.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((item) => item.id === 'jellyfin');

async function main() {
  assert.ok(source);
  assert.equal(provider.version, source.version);
  assert.deepEqual(provider.getSettings().map((x) => x.key), source.settings.map((x) => x.key));
  assert.equal(provider.getInfo().name, 'Jellyfin');
  assert.equal(provider.getInfo().logo, source.logo);
  assert.equal(provider._config().server, 'https://jf.example.test');

  const home = await provider.getHome();
  assert.equal(home.length, 1);
  assert.equal(home[0].title, 'Movies');
  assert.equal(home[0].items[0].jellyfinId, 'movie-1');
  assert.equal(home[0].items[0].overview, 'A test synopsis');
  assert.equal(home[0].items[0].cover, 'https://jf.example.test/Items/movie-1/Images/Primary?tag=tag1');

  const search = await provider.search('Test', 1);
  assert.equal(search[0].jellyfinType, 'series');

  const detail = await provider.getDetail('jellyfin://movie-1');
  assert.equal(detail.description, 'A test synopsis');
  assert.deepEqual(detail.genres, ['Drama']);
  assert.deepEqual(detail.cast, ['Actor One']);

  const episodes = await provider.getEpisodes('jellyfin://series-1');
  assert.equal(episodes.length, 0, 'episode enumeration uses series detail only; series request is mocked next');
  const series = await provider.getDetail('jellyfin://series-1');
  assert.equal(series.episodes.length, 1);
  assert.equal(series.episodes[0].url, 'jellyfin://episode-1');
  const streams = await provider.getVideoSources('jellyfin://episode-1');
  assert.equal(streams.length, 1);
  assert.match(streams[0].url, /mediaSourceId=media-1/);
  assert.match(streams[0].url, /api_key=test-api-key/);
  assert.equal(streams[0].subtitles[0].url, 'https://jf.example.test/Videos/episode-1/Subtitles/0/Stream.srt');
  assert.ok(requests.every((x) => x.init.headers['X-Emby-Authorization'].includes('Token="test-api-key"')));

  global.__settings.jellyfin.serverUrl = 'file:///etc';
  assert.throws(() => provider._config(), /Invalid Jellyfin server URL/);
  global.__settings.jellyfin.serverUrl = 'https://jf.example.test';
  console.log('Jellyfin provider tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
