'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const requests = [];
const login = { username: 'goutam-test', password: 'correct-horse' };
global.__settings = {
  jellyfin: {
    serverUrl: 'https://jf.example.test/jellyfin/',
    username: login.username,
    password: login.password,
    apiKey: '',
    userId: '',
    pageSize: '25',
    catalogSections: ['resume', 'nextUp', 'latest', 'favorites', 'libraries'],
    contentTypes: ['Movie', 'Series', 'Episode'],
    browseSort: 'DateCreated',
    includePlayed: true,
    showCollections: false,
    preferTranscoding: false,
    maxBitrate: '16000000',
    includeSubtitles: true,
    imageWidth: '500',
    cacheTtl: '30000',
    requestTimeoutMs: '10000'
  }
};

const itemsForLibrary = (parentId) => parentId === 'movies-library'
  ? [{ Id: 'movie-1', Name: 'Test Movie', Type: 'Movie', ProductionYear: 2024, Overview: 'A movie synopsis', CommunityRating: 8.2, ImageTags: { Primary: 'poster-tag' }, BackdropImageTags: ['backdrop-tag'] }]
  : [{ Id: 'series-1', Name: 'Test Series', Type: 'Series', ProductionYear: 2020, Overview: 'A series synopsis', ImageTags: { Primary: 'series-tag' } }];

global.fetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  const pathName = parsed.pathname;
  requests.push({ url: String(url), init });

  assert.equal(parsed.protocol, 'https:');
  assert.equal(init.timeoutMs, 10000);

  if (pathName === '/jellyfin/Users/AuthenticateByName') {
    assert.equal(init.method, 'POST');
    assert.match(init.headers.Authorization, /MediaBrowser Client="Zangetsu"/);
    assert.match(init.headers.Authorization, /Token=""/);
    assert.deepEqual(JSON.parse(init.body), { Username: login.username, Pw: login.password });
    return { status: 200, body: JSON.stringify({ AccessToken: 'session-token-123', User: { Id: 'user-1', Name: 'Test User' } }) };
  }

  assert.equal(init.headers.Authorization, 'MediaBrowser Client="Zangetsu", Device="Zangetsu", DeviceId="zangetsu-jellyfin", Version="1.1.0", Token="session-token-123"');
  assert.equal(init.headers['X-Emby-Token'], 'session-token-123');

  if (pathName === '/jellyfin/UserViews') {
    assert.equal(parsed.searchParams.get('userId'), 'user-1');
    return { status: 200, body: JSON.stringify({ Items: [
      { Id: 'movies-library', Name: 'Movies', CollectionType: 'movies' },
      { Id: 'shows-library', Name: 'TV Shows', CollectionType: 'tvshows' }
    ] }) };
  }

  if (pathName === '/jellyfin/UserItems/Resume') {
    return { status: 200, body: JSON.stringify({ Items: [
      { Id: 'movie-resume', Name: 'Resume Movie', Type: 'Movie', UserData: { PlaybackPositionTicks: 1000 } }
    ] }) };
  }

  if (pathName === '/jellyfin/Shows/NextUp') {
    return { status: 200, body: JSON.stringify({ Items: [
      { Id: 'episode-next', Name: 'Next Episode', Type: 'Episode', ParentIndexNumber: 2, IndexNumber: 3, SeriesName: 'Next Series' }
    ] }) };
  }

  if (pathName === '/jellyfin/Users/user-1/Items' && parsed.searchParams.has('ParentId')) {
    return { status: 200, body: JSON.stringify({ Items: itemsForLibrary(parsed.searchParams.get('ParentId')) }) };
  }

  if (pathName === '/jellyfin/Users/user-1/Items' && parsed.searchParams.get('Filters') === 'IsFavorite') {
    return { status: 200, body: JSON.stringify({ Items: [
      { Id: 'favorite-1', Name: 'Favorite Movie', Type: 'Movie' }
    ] }) };
  }

  if (pathName === '/jellyfin/Users/user-1/Items' && parsed.searchParams.has('SearchTerm')) {
    assert.equal(parsed.searchParams.get('SearchTerm'), 'Test');
    return { status: 200, body: JSON.stringify({ Items: [
      { Id: 'series-1', Name: 'Test Series', Type: 'Series' }
    ], TotalRecordCount: 1 }) };
  }

  if (pathName === '/jellyfin/Users/user-1/Items/series-1') {
    return { status: 200, body: JSON.stringify({
      Id: 'series-1', Name: 'Test Series', Type: 'Series',
      Overview: 'Series synopsis', ProductionYear: 2020,
      Status: 'Continuing', Genres: ['Drama', 'Mystery'],
      Studios: [{ Name: 'Test Studio' }],
      People: [{ Name: 'Actor One', Type: 'Actor' }, { Name: 'Director One', Type: 'Director' }],
      ImageTags: { Primary: 'series-tag' }
    }) };
  }

  if (pathName === '/jellyfin/Shows/series-1/Episodes') {
    assert.equal(parsed.searchParams.get('userId'), 'user-1');
    return { status: 200, body: JSON.stringify({ Items: [
      { Id: 'episode-1', Name: 'Pilot', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 1, SeriesName: 'Test Series', PremiereDate: '2024-01-01T00:00:00Z', Overview: 'Episode synopsis', RunTimeTicks: 27000000000, ImageTags: { Primary: 'ep-tag' } },
      { Id: 'episode-2', Name: 'Second', Type: 'Episode', ParentIndexNumber: 1, IndexNumber: 2, SeriesName: 'Test Series' }
    ] }) };
  }

  if (pathName === '/jellyfin/Users/user-1/Items/movie-1') {
    return { status: 200, body: JSON.stringify({
      Id: 'movie-1', Name: 'Test Movie', Type: 'Movie', Overview: 'A movie synopsis',
      Genres: ['Drama'], People: [{ Name: 'Actor One', Type: 'Actor' }]
    }) };
  }

  if (pathName === '/jellyfin/Items/episode-1/PlaybackInfo') {
    return { status: 200, body: JSON.stringify({
      PlaySessionId: 'play-session-1',
      MediaSources: [{
        Id: 'media-1', Name: 'Original 1080p', Container: 'mp4', Height: 1080,
        DirectStreamUrl: '/Videos/episode-1/stream?static=true&mediaSourceId=media-1',
        TranscodingUrl: '/Videos/episode-1/master.m3u8?VideoCodec=h264',
        TranscodingSubProtocol: 'hls',
        MediaStreams: [
          { Index: 2, Type: 'Subtitle', Language: 'en', DisplayTitle: 'English', Codec: 'srt', IsDefault: true, DeliveryUrl: '/Videos/episode-1/Subtitles/2/Stream.srt' },
          { Index: 1, Type: 'Audio', Language: 'en', DisplayTitle: 'English' }
        ]
      }]
    }) };
  }

  throw new Error('Unexpected Jellyfin request: ' + pathName + parsed.search);
};

const provider = require('../providers/jellyfin.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((item) => item.id === 'jellyfin');

async function main() {
  assert.ok(source, 'Jellyfin source is present in index.json');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().version, '1.1.0');
  assert.deepEqual(provider.getSettings().map((x) => x.key), source.settings.map((x) => x.key));
  assert.ok(provider.getSettings().some((x) => x.key === 'password'));
  assert.ok(provider.getSettings().some((x) => x.key === 'catalogSections' && x.type === 'multiEnum'));
  assert.equal(provider._config().server, 'https://jf.example.test/jellyfin');

  const home = await provider.getHome();
  const titles = home.map((row) => row.title);
  assert.ok(titles.includes('Continue Watching'));
  assert.ok(titles.includes('Next Up'));
  assert.ok(titles.includes('Recently Added'));
  assert.ok(titles.includes('Favorites'));
  assert.ok(titles.includes('Movies'));
  assert.ok(titles.includes('TV Shows'));
  const movieRow = home.find((row) => row.title === 'Movies');
  assert.equal(movieRow.items[0].url, 'jellyfin://movie-1');
  assert.equal(movieRow.items[0].score, 82);
  assert.equal(movieRow.items[0].cover, 'https://jf.example.test/jellyfin/Items/movie-1/Images/Primary?tag=poster-tag&maxWidth=500');
  assert.match(movieRow.items[0].coverHeaders.Authorization, /Token="session-token-123"/);

  const search = await provider.search('Test', 2);
  assert.equal(search[0].jellyfinType, 'series');
  const searchRequest = requests.find((r) => new URL(r.url).searchParams.get('SearchTerm') === 'Test');
  assert.equal(new URL(searchRequest.url).searchParams.get('StartIndex'), '25');

  const detail = await provider.getDetail('jellyfin://series-1');
  assert.equal(detail.description, 'Series synopsis');
  assert.deepEqual(detail.genres, ['Drama', 'Mystery']);
  assert.deepEqual(detail.studios, ['Test Studio']);
  assert.deepEqual(detail.cast, ['Actor One']);
  assert.equal(detail.status, 'ongoing');
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].season, 1);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[0].url, 'jellyfin://episode-1');
  assert.equal(detail.episodes[0].thumbnail, 'https://jf.example.test/jellyfin/Items/episode-1/Images/Primary?tag=ep-tag&maxWidth=500');

  const episodes = await provider.getEpisodes('jellyfin://series-1');
  assert.equal(episodes.length, 2);

  const streams = await provider.getVideoSources('jellyfin://episode-1');
  assert.equal(streams.length, 2, 'direct play and server transcode are both exposed');
  assert.match(streams[0].url, /mediaSourceId=media-1/);
  assert.equal(streams[0].container, 'mp4');
  assert.equal(streams[0].subtitles[0].url, 'https://jf.example.test/Videos/episode-1/Subtitles/2/Stream.srt');
  assert.equal(streams[0].subtitles[0].default, true);
  assert.equal(streams[1].container, 'hls');
  assert.match(streams[1].url, /PlaySessionId=play-session-1/);
  assert.ok(streams[0].headers.Authorization.includes('session-token-123'));

  const popular = await provider.popular({ page: 1 });
  assert.ok(Array.isArray(popular));
  assert.ok(popular.length >= 2);
  assert.ok(popular.every((item) => item.url && item.jellyfinId));

  const loginRequests = requests.filter((r) => new URL(r.url).pathname.endsWith('/Users/AuthenticateByName'));
  assert.equal(loginRequests.length, 1, 'username/password login is cached for subsequent calls');
  assert.ok(requests.every((r) => new URL(r.url).pathname.endsWith('/Users/AuthenticateByName') ||
    r.init.headers.Authorization.includes('session-token-123')));

  global.__settings.jellyfin.serverUrl = 'file:///etc';
  assert.throws(() => provider._config(), /Invalid Jellyfin server address/);
  global.__settings.jellyfin.serverUrl = 'https://jf.example.test/jellyfin';

  console.log('Jellyfin provider tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
