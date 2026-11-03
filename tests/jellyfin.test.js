'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const calls = [];
let expectedToken = 'session-token-1';
let authCount = 0;
let expireNextItemsRequest = false;
let activeCredentials = { Username: 'viewer', Pw: 'correct-password' };

global.__settings = {
  jellyfin: {
    serverUrl: 'https://jf.example.test/jellyfin/web/index.html',
    username: activeCredentials.Username,
    password: activeCredentials.Pw,
    pageSize: '25',
    homeSections: ['resume', 'nextUp', 'recent', 'favorites', 'libraries'],
    contentTypes: ['Movie', 'Series', 'Episode'],
    showCollections: true,
    sortBy: 'DateCreated',
    maxStreamingBitrate: '40000000',
    preferTranscoding: false,
    includeSubtitles: true,
    cacheTtl: '30000',
    requestTimeoutMs: '10000'
  }
};

function response(status, data) {
  return { status, body: typeof data === 'string' ? data : JSON.stringify(data) };
}

function movie(id, name, extra = {}) {
  return {
    Id: id, Name: name, Type: 'Movie', ProductionYear: 2024,
    Overview: name + ' synopsis', CommunityRating: 8.2,
    Genres: ['Drama'], ImageTags: { Primary: 'poster-' + id },
    BackdropImageTags: ['backdrop-' + id],
    ...extra
  };
}

function series(id, name, extra = {}) {
  return {
    Id: id, Name: name, Type: 'Series', ProductionYear: 2020,
    Overview: name + ' synopsis', Status: 'Continuing',
    Genres: ['Mystery', 'Drama'],
    Studios: [{ Name: 'Example Studio' }],
    People: [
      { Name: 'Actor One', Type: 'Actor', Role: 'Lead' },
      { Name: 'Director One', Type: 'Director' }
    ],
    ImageTags: { Primary: 'poster-' + id },
    BackdropImageTags: ['backdrop-' + id],
    ProviderIds: { Imdb: 'tt1234567', Tmdb: '456', MyAnimeList: '5114', AniList: '21' },
    ...extra
  };
}

function episode(id, number, extra = {}) {
  return {
    Id: id, Name: number === 1 ? 'Pilot' : 'Episode ' + number,
    Type: 'Episode', SeriesName: 'Test Series', SeriesId: 'series-1',
    ParentIndexNumber: 1, IndexNumber: number,
    PremiereDate: '2024-01-' + String(number).padStart(2, '0') + 'T00:00:00Z',
    Overview: 'Episode ' + number + ' synopsis',
    ImageTags: { Primary: 'episode-' + id },
    ...extra
  };
}

global.fetch = async (url, init = {}) => {
  const parsed = new URL(String(url));
  const pathname = parsed.pathname;
  const method = String(init.method || 'GET').toUpperCase();
  calls.push({ url: String(url), pathname, method, init });

  assert.ok(parsed.protocol === 'https:' || pathname === '/jf/System/Info/Public',
    'server calls must use the configured scheme');
  assert.ok(init.timeoutMs === 10000 || (pathname === '/jellyfin/UserItems/Resume' && init.timeoutMs === 2500));

  if (pathname === '/jellyfin/System/Info/Public') {
    assert.equal(method, 'GET');
    assert.match(init.headers.Authorization, /^MediaBrowser Client="Zangetsu"/);
    assert.doesNotMatch(init.headers.Authorization, /Token=/);
    return response(200, { ServerName: 'Den', Version: '10.10.7', Id: 'server-1' });
  }

  if (pathname === '/jellyfin/Users/AuthenticateByName') {
    assert.equal(method, 'POST');
    assert.match(init.headers.Authorization, /^MediaBrowser Client="Zangetsu"/);
    assert.doesNotMatch(init.headers.Authorization, /Token=/);
    assert.equal(init.headers['Content-Type'], 'application/json');
    const credentials = JSON.parse(init.body);
    authCount++;
    if (credentials.Username === 'bad-user') {
      return response(401, { Message: 'Invalid username or password' });
    }
    assert.deepEqual(credentials, activeCredentials);
    expectedToken = 'session-token-' + authCount;
    return response(200, {
      User: { Id: 'user-1', Name: credentials.Username },
      AccessToken: expectedToken,
      ServerId: 'server-1'
    });
  }

  assert.equal(init.headers.Authorization,
    'MediaBrowser Client="Zangetsu", Device="Zangetsu", DeviceId="zangetsu-jellyfin", Version="2.0.0", Token="' + expectedToken + '"');
  assert.equal(init.headers['X-Emby-Token'], undefined, 'new implementation must use MediaBrowser Authorization');

  if (expireNextItemsRequest && pathname === '/jellyfin/UserViews') {
    expireNextItemsRequest = false;
    return response(401, { Message: 'Expired token' });
  }

  if (pathname === '/jellyfin/UserViews') {
    assert.equal(parsed.searchParams.get('userId'), 'user-1');
    return response(200, { Items: [
      { Id: 'movies-library', Name: 'Movies', Type: 'CollectionFolder', CollectionType: 'movies' },
      { Id: 'shows-library', Name: 'TV Shows', Type: 'CollectionFolder', CollectionType: 'tvshows' },
      { Id: 'boxsets-library', Name: 'Collections', Type: 'CollectionFolder', CollectionType: 'boxsets' },
      { Id: 'mixed-library', Name: 'Everything', Type: 'CollectionFolder' },
      { Id: 'music-library', Name: 'Music', Type: 'CollectionFolder', CollectionType: 'music' }
    ] });
  }

  if (pathname === '/jellyfin/UserItems/Resume') {
    assert.equal(parsed.searchParams.get('mediaTypes'), 'Video');
    assert.equal(parsed.searchParams.get('limit'), '25');
    return response(200, { Items: [{
      Id: 'resume-ep', Name: 'Resume Episode', Type: 'Episode',
      SeriesId: 'series-1', SeriesName: 'Test Series',
      SeriesPrimaryImageTag: 'series-primary',
      ParentBackdropItemId: 'series-1',
      ParentBackdropImageTags: ['series-backdrop'],
      UserData: { PlaybackPositionTicks: 1000 }
    }] });
  }

  if (pathname === '/jellyfin/Shows/NextUp') {
    return response(200, { Items: [{
      Id: 'next-ep', Name: 'Next Episode', Type: 'Episode',
      SeriesId: 'series-1', SeriesName: 'Test Series',
      SeriesPrimaryImageTag: 'series-primary', ParentIndexNumber: 2, IndexNumber: 3
    }] });
  }

  if (pathname === '/jellyfin/Items' && parsed.searchParams.has('parentId') && !parsed.searchParams.has('searchTerm')) {
    const parentId = parsed.searchParams.get('parentId');
    if (parentId === 'movies-library') {
      assert.equal(parsed.searchParams.get('includeItemTypes'), 'Movie,Episode');
      return response(200, { Items: [movie('movie-1', 'Test Movie')], TotalRecordCount: 1 });
    }
    if (parentId === 'shows-library') {
      assert.equal(parsed.searchParams.get('includeItemTypes'), 'Series,Episode');
      return response(200, { Items: [series('series-1', 'Test Series')], TotalRecordCount: 1 });
    }
    if (parentId === 'boxsets-library') {
      assert.equal(parsed.searchParams.get('includeItemTypes'), 'BoxSet');
      return response(200, { Items: [{
        Id: 'boxset-1', Name: 'Collection One', Type: 'BoxSet',
        ImageTags: { Primary: 'collection-poster' }
      }], TotalRecordCount: 1 });
    }
    if (parentId === 'mixed-library') {
      assert.equal(parsed.searchParams.get('includeItemTypes'), 'Movie,Series,Episode');
      return response(200, { Items: [movie('mixed-movie', 'Mixed Movie')] });
    }
    if (parentId === 'boxset-1') {
      assert.equal(parsed.searchParams.get('recursive'), 'false');
      return response(200, { Items: [
        movie('collection-movie', 'Collection Movie'),
        series('collection-series', 'Collection Series')
      ], TotalRecordCount: 2 });
    }
  }

  if (pathname === '/jellyfin/Items' && parsed.searchParams.get('filters') === 'IsFavorite') {
    return response(200, { Items: [movie('favorite-1', 'Favorite Movie')] });
  }

  if (pathname === '/jellyfin/Items' && parsed.searchParams.has('searchTerm')) {
    assert.equal(parsed.searchParams.get('searchTerm'), 'Test');
    assert.equal(parsed.searchParams.get('startIndex'), '25');
    return response(200, { Items: [series('search-series', 'Test Series Search')], TotalRecordCount: 1 });
  }

  if (pathname === '/jellyfin/Items' && parsed.searchParams.has('sortBy')) {
    assert.ok(parsed.searchParams.has('fields'), 'recently added query must request metadata fields');
    assert.ok(parsed.searchParams.has('enableImageTypes'), 'recently added query must request poster/backdrop images');
    return response(200, { Items: [movie('recent-1', 'Recent Movie')] });
  }

  if (pathname === '/jellyfin/Items/series-1') {
    assert.equal(parsed.searchParams.get('userId'), 'user-1');
    return response(200, series('series-1', 'Test Series', {
      RunTimeTicks: 27000000000,
      OfficialRating: 'TV-14',
      EndDate: null,
      People: [
        { Name: 'Actor One', Type: 'Actor', Role: 'Lead' },
        { Name: 'Director One', Type: 'Director' },
        { Name: 'Actor Two', Type: 'Actor' }
      ]
    }));
  }

  if (pathname === '/jellyfin/Items/movie-1') {
    return response(200, movie('movie-1', 'Test Movie', {
      People: [{ Name: 'Movie Actor', Type: 'Actor' }],
      ProviderIds: { Imdb: 'tt7654321', Tmdb: '123' }
    }));
  }

  if (pathname === '/jellyfin/Items/boxset-1') {
    return response(200, {
      Id: 'boxset-1', Name: 'Collection One', Type: 'BoxSet',
      Overview: 'A collection description',
      ImageTags: { Primary: 'collection-poster' }
    });
  }

  if (pathname === '/jellyfin/Shows/series-1/Episodes') {
    assert.equal(parsed.searchParams.get('userId'), 'user-1');
    return response(200, {
      TotalRecordCount: 2,
      Items: [episode('episode-1', 1), episode('episode-2', 2)]
    });
  }

  if (pathname === '/jellyfin/Shows/long-series/Episodes') {
    const start = Number(parsed.searchParams.get('startIndex') || 0);
    if (start === 0) {
      return response(200, {
        TotalRecordCount: 501,
        Items: [episode('long-1', 1)]
      });
    }
    assert.equal(start, 500);
    return response(200, {
      TotalRecordCount: 501,
      Items: [episode('long-501', 501, { ParentIndexNumber: 2 })]
    });
  }

  if (pathname === '/jellyfin/Items/episode-1/PlaybackInfo') {
    assert.equal(method, 'POST');
    assert.equal(parsed.searchParams.get('userId'), 'user-1');
    assert.equal(parsed.searchParams.get('maxStreamingBitrate'), '40000000');
    const body = JSON.parse(init.body);
    assert.equal(body.UserId, 'user-1');
    assert.equal(body.MaxStreamingBitrate, 40000000);
    assert.equal(body.DeviceProfile.Name, 'Zangetsu');
    assert.ok(body.DeviceProfile.DirectPlayProfiles.length > 0);
    assert.ok(body.DeviceProfile.TranscodingProfiles.some((x) => x.Protocol === 'hls'));
    assert.ok(body.DeviceProfile.SubtitleProfiles.some((x) => x.Method === 'External'));
    return response(200, {
      PlaySessionId: 'play-session-1',
      MediaSources: [
        {
          Id: 'media-direct', Name: 'Original 1080p', Type: 'Default',
          SupportsDirectPlay: true, SupportsDirectStream: true,
          Container: 'mkv', ETag: 'etag-1',
          MediaStreams: [
            { Type: 'Video', Index: 0, Width: 1920, Height: 1080, Codec: 'h264', DisplayTitle: '1080p H264' },
            { Type: 'Audio', Index: 1, Language: 'eng', IsDefault: true, DisplayTitle: 'English AC3 5.1' },
            { Type: 'Subtitle', Index: 2, Language: 'eng', Codec: 'subrip', DeliveryMethod: 'External', DeliveryUrl: '/Videos/episode-1/media-direct/Subtitles/2/0/Stream.srt', IsDefault: true },
            { Type: 'Subtitle', Index: 3, Language: 'jpn', Codec: 'subrip', DeliveryMethod: 'Embed' }
          ]
        },
        {
          Id: 'media-transcode', Name: 'HLS transcode', Type: 'Default',
          SupportsDirectPlay: false, SupportsDirectStream: false,
          TranscodingUrl: '/videos/episode-1/master.m3u8?MediaSourceId=media-transcode',
          TranscodingSubProtocol: 'hls',
          Container: 'ts',
          MediaStreams: [
            { Type: 'Video', Index: 0, Width: 1280, Height: 720, Codec: 'h264' },
            { Type: 'Audio', Index: 1, Language: 'eng', IsDefault: true, DisplayTitle: 'English AAC' },
            { Type: 'Subtitle', Index: 4, Language: 'eng', Codec: 'srt', DeliveryMethod: 'External', DeliveryUrl: '/Videos/episode-1/media-transcode/Subtitles/4/0/Stream.srt' }
          ]
        }
      ]
    });
  }

  throw new Error('Unexpected Jellyfin request: ' + method + ' ' + parsed.pathname + parsed.search);
};

const provider = require('../providers/jellyfin.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((item) => item.id === 'jellyfin');

async function main() {
  assert.ok(source, 'Jellyfin source is registered in index.json');
  assert.equal(provider.version, source.version);
  assert.equal(provider.getInfo().version, '2.0.0');
  assert.equal(provider.getInfo().name, 'Jellyfin');
  assert.deepEqual(provider.getSettings().map((item) => item.key), source.settings.map((item) => item.key));
  assert.ok(provider.getSettings().some((item) => item.key === 'username'));
  assert.ok(provider.getSettings().some((item) => item.key === 'password'));
  assert.ok(!provider.getSettings().some((item) => item.key === 'apiKey'));

  assert.equal(provider._normalizeServerAddress('https://media.example.test/jellyfin/web/index.html/'), 'https://media.example.test/jellyfin');
  assert.equal(provider._normalizeServerAddress('jf.example.test:8096/web/'), 'http://jf.example.test:8096');
  assert.throws(() => provider._normalizeServerAddress('https://user:secret@jf.example.test'), /embedded credentials/i);
  assert.equal(provider._versionAtLeast('10.9.0', '10.9.0'), true);
  assert.equal(provider._versionAtLeast('10.10.7', '10.9.0'), true);
  assert.equal(provider._versionAtLeast('10.8.13', '10.9.0'), false);
  assert.equal(provider._versionAtLeast('4.8.10.0', '10.9.0'), false);
  assert.deepEqual(provider._parseItemUrl('jellyfin://boxset-1?collection=1'), { id: 'boxset-1', collection: true });

  const initialHome = await provider.getHome();
  const initialRows = initialHome.map((row) => row.title);
  assert.ok(initialRows.includes('Continue Watching'));
  assert.ok(initialRows.includes('Next Up'));
  assert.ok(initialRows.includes('Recently Added'));
  assert.ok(initialRows.includes('Favorites'));
  assert.ok(initialRows.includes('Movies'));
  assert.ok(initialRows.includes('TV Shows'));
  assert.ok(initialRows.includes('Collections'));
  assert.ok(!initialRows.includes('Music'));
  const resumeRow = initialHome.find((row) => row.title === 'Continue Watching');
  assert.equal(resumeRow.items[0].jellyfinId, 'series-1', 'episode resume entries map to their parent series');
  assert.equal(resumeRow.items[0].title, 'Test Series');
  const collectionRow = initialHome.find((row) => row.title === 'Collections');
  assert.equal(collectionRow.items[0].url, 'jellyfin://boxset-1?collection=1');
  const movieRow = initialHome.find((row) => row.title === 'Movies');
  assert.equal(movieRow.items[0].url, 'jellyfin://movie-1');
  assert.equal(movieRow.items[0].score, 82);
  assert.equal(movieRow.items[0].cover, 'https://jf.example.test/jellyfin/Items/movie-1/Images/Primary?quality=90&tag=poster-movie-1&maxHeight=600');
  assert.match(movieRow.items[0].coverHeaders.Authorization, /Token="session-token-/);

  const search = await provider.search('Test', 2);
  assert.ok(search.some((item) => item.title === 'Test Series Search'));
  const searchRequest = calls.find((call) => call.pathname === '/jellyfin/Items' && new URL(call.url).searchParams.has('searchTerm'));
  assert.equal(new URL(searchRequest.url).searchParams.get('startIndex'), '25');
  assert.ok(searchRequest.init.headers.Authorization.includes('Token='));

  const collection = await provider.getDetail('jellyfin://boxset-1?collection=1');
  assert.equal(collection.title, 'Collection One');
  assert.equal(collection.episodes.length, 2);
  assert.equal(collection.episodes[0].url, 'jellyfin://collection-movie');
  const collectionEpisodes = await provider.getEpisodes('jellyfin://boxset-1?collection=1');
  assert.equal(collectionEpisodes.length, 2);

  const detail = await provider.getDetail('jellyfin://series-1');
  assert.equal(detail.description, 'Test Series synopsis');
  assert.deepEqual(detail.genres, ['Mystery', 'Drama']);
  assert.deepEqual(detail.studios, ['Example Studio']);
  assert.deepEqual(detail.cast, ['Actor One', 'Actor Two']);
  assert.equal(detail.status, 'ongoing');
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.episodes[0].season, 1);
  assert.equal(detail.episodes[0].url, 'jellyfin://episode-1');
  assert.equal(detail.malId, 5114);
  assert.equal(detail.anilistId, 21);
  assert.equal(detail.tmdbId, 456);
  assert.equal(detail.imdbId, 'tt1234567');

  const episodes = await provider.getEpisodes('jellyfin://series-1');
  assert.equal(episodes.length, 2);

  const longEpisodes = await provider.getEpisodes('jellyfin://long-series');
  assert.equal(longEpisodes.length, 2, 'episode pagination fetches page 2 past the 500-item boundary');
  assert.ok(calls.some((call) => call.pathname === '/jellyfin/Shows/long-series/Episodes' &&
    new URL(call.url).searchParams.get('startIndex') === '500'));

  const streams = await provider.getVideoSources('jellyfin://episode-1');
  assert.equal(streams.length, 2);
  assert.ok(streams[0].url.includes('/jellyfin/Videos/episode-1/stream?'));
  assert.match(streams[0].url, /mediaSourceId=media-direct/);
  assert.match(streams[0].url, /playSessionId=play-session-1/);
  assert.equal(streams[0].label.includes('Direct Play'), true);
  assert.equal(streams[0].headers.Authorization.includes('Token='), true);
  assert.equal(streams[0].subtitles.length, 1, 'embedded subtitle tracks are not exposed as external soft subtitles');
  assert.equal(streams[0].subtitles[0].url, 'https://jf.example.test/jellyfin/Videos/episode-1/media-direct/Subtitles/2/0/Stream.srt');
  assert.equal(streams[0].subtitles[0].format, 'srt');
  assert.equal(streams[0].subtitles[0].default, true);
  assert.ok(streams[1].url.startsWith('https://jf.example.test/jellyfin/videos/episode-1/master.m3u8'));
  assert.equal(streams[1].container, 'hls');
  assert.equal(streams[1].subtitles.length, 1);
  assert.equal(streams[1].headers.Authorization.includes('Token='), true);
  assert.equal(new URL(streams[0].url).searchParams.has('api_key'), false, 'tokens are not copied into direct stream URLs');

  global.__settings.jellyfin.preferTranscoding = true;
  const preferredTranscode = await provider.getVideoSources('jellyfin://episode-1');
  assert.match(preferredTranscode[0].url, /\.m3u8/);

  const popular = await provider.popular({ page: 1 });
  assert.ok(Array.isArray(popular));
  assert.ok(popular.length > 0);
  assert.ok(popular.every((item) => item.url && item.jellyfinId));

  const authCalls = calls.filter((call) => call.pathname.endsWith('/Users/AuthenticateByName'));
  assert.equal(authCalls.length, 1, 'session login is shared across provider requests');
  assert.ok(calls.every((call) => call.pathname.endsWith('/System/Info/Public') ||
    call.pathname.endsWith('/Users/AuthenticateByName') ||
    call.init.headers.Authorization.includes('Token=')));

  // Force the UserViews request onto the network so the mock can return
  // an expired-session 401 instead of serving a cached library list.
  global.__settings.jellyfin.cacheTtl = '0';
  expireNextItemsRequest = true;
  const authBeforeRefresh = authCount;
  await provider.getHome();
  assert.equal(authCount, authBeforeRefresh + 1, 'expired token is reauthenticated and the failed request is retried');

  activeCredentials = { Username: 'bad-user', Pw: 'wrong-password' };
  global.__settings.jellyfin.username = activeCredentials.Username;
  global.__settings.jellyfin.password = activeCredentials.Pw;
  await assert.rejects(provider.getHome(), /rejected the username or password/i);

  console.log('Jellyfin MediaBrowser provider tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
