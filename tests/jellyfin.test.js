'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const calls = [];
let token = '';
let authCount = 0;
let expireViewsOnce = true;
let longEpisodeRequests = 0;

global.__settings = {
  jellyfin: {
    serverUrl: 'https://aio.example.test/jellyfin/web',
    username: 'config-uuid',
    password: 'config-password',
    apiKey: '',
    userId: '',
    libraryId: '',
    pageSize: '25',
    homeSections: ['resume', 'nextUp', 'recent', 'favorites', 'libraries'],
    contentTypes: ['Movie', 'Series', 'BoxSet'],
    showCollections: true,
    sortBy: 'DateCreated',
    maxStreamingBitrate: '40000000',
    preferTranscoding: false,
    includeSubtitles: true,
    useRemoteUrl: true,
    cacheTtl: '0',
    requestTimeoutMs: '15000'
  }
};

function reply(status, value) {
  return { status: status, body: JSON.stringify(value) };
}
function param(url, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of url.searchParams.entries()) if (key.toLowerCase() === wanted) return value;
  return null;
}
function movie(id, name, extra = {}) {
  return Object.assign({
    Id: id, Name: name, Type: 'Movie', ProductionYear: 2024,
    Overview: name + ' synopsis', CommunityRating: 8.2, Genres: ['Drama'],
    ImageTags: { Primary: 'poster-' + id }, BackdropImageTags: ['backdrop-' + id],
    DateCreated: '2026-11-02T10:00:00Z'
  }, extra);
}
function series(id, name, extra = {}) {
  return Object.assign({
    Id: id, Name: name, Type: 'Series', ProductionYear: 2020,
    Overview: name + ' synopsis', Status: 'Continuing', Genres: ['Mystery', 'Drama'],
    Studios: [{ Name: 'Example Studio' }],
    People: [{ Name: 'Actor One', Type: 'Actor' }, { Name: 'Director One', Type: 'Director' }, { Name: 'Actor Two', Type: 'Actor' }],
    ImageTags: { Primary: 'poster-' + id }, BackdropImageTags: ['backdrop-' + id],
    ProviderIds: { Imdb: 'tt1234567', Tmdb: '456', Tvdb: '789', MyAnimeList: '5114', AniList: '21', Kitsu: '22', AniDB: '23' }
  }, extra);
}
function episode(id, number, extra = {}) {
  return Object.assign({
    Id: id, Name: number === 1 ? 'Pilot' : 'Episode ' + number, Type: 'Episode',
    SeriesName: 'Test Series', SeriesId: 'series-1', SeriesPrimaryImageTag: 'series-poster',
    ParentIndexNumber: 1, IndexNumber: number, SeasonId: 'season-1',
    PremiereDate: '2024-01-' + String(number).padStart(2, '0') + 'T00:00:00Z',
    Overview: 'Episode ' + number + ' synopsis', ImageTags: {}
  }, extra);
}

global.fetch = async (rawUrl, init = {}) => {
  const url = new URL(String(rawUrl));
  const pathname = url.pathname;
  const method = String(init.method || 'GET').toUpperCase();
  calls.push({ url: String(rawUrl), pathname: pathname, method: method, init: init });

  if (pathname === '/jellyfin/System/Info/Public') {
    assert.equal(init.headers.Authorization, undefined);
    return reply(200, { ServerName: 'AIOStreams', Version: '2.35.0', aiostreams: { features: { versions: true, genreRequired: true } } });
  }
  if (pathname === '/jellyfin/Users/AuthenticateByName') {
    assert.equal(method, 'POST');
    const credentials = JSON.parse(init.body);
    assert.deepEqual(credentials, { Username: 'config-uuid', Pw: 'config-password' });
    authCount += 1;
    token = 'session-token-' + authCount;
    return reply(200, { User: { Id: 'user-1', Name: 'AIOStreams viewer' }, AccessToken: token });
  }
  if (pathname === '/jellyfin/Users/user-1/Views') {
    assert.ok(init.headers.Authorization.includes('Token="' + token + '"'));
    if (expireViewsOnce) {
      expireViewsOnce = false;
      return reply(401, { Message: 'Expired token' });
    }
    return reply(200, { Items: [
      { Id: 'movies-lib', Name: 'Movies', Type: 'CollectionFolder', CollectionType: 'movies' },
      { Id: 'shows-lib', Name: 'TV Shows', Type: 'CollectionFolder', CollectionType: 'tvshows', aiostreams: { genreRequired: true } },
      { Id: 'collections-lib', Name: 'Collections', Type: 'CollectionFolder', CollectionType: 'boxsets' },
      { Id: 'music-lib', Name: 'Music', Type: 'CollectionFolder', CollectionType: 'music' }
    ] });
  }
  assert.ok(init.headers.Authorization && init.headers.Authorization.includes('Token="' + token + '"'),
    'authenticated requests must use the current token');

  if (pathname === '/jellyfin/Genres') {
    assert.equal(param(url, 'ParentId'), 'shows-lib');
    return reply(200, { Items: [{ Id: 'genre-none', Name: 'None' }, { Id: 'genre-anime', Name: 'Anime' }] });
  }
  if (pathname === '/jellyfin/Users/user-1/Items/Resume') {
    return reply(200, { Items: [{ Id: 'resume-episode', Name: 'Episode title', Type: 'Episode', SeriesId: 'series-1', SeriesName: 'Test Series', SeriesPrimaryImageTag: 'series-poster', ParentIndexNumber: 1, IndexNumber: 4 }] });
  }
  if (pathname === '/jellyfin/Shows/NextUp') {
    return reply(200, { Items: [{ Id: 'next-episode', Name: 'Episode 5', Type: 'Episode', SeriesId: 'series-1', SeriesName: 'Test Series', SeriesPrimaryImageTag: 'series-poster', ParentIndexNumber: 1, IndexNumber: 5 }] });
  }
  if (pathname === '/jellyfin/Users/user-1/Items') {
    const parent = param(url, 'ParentId');
    const types = param(url, 'IncludeItemTypes') || '';
    const term = param(url, 'SearchTerm');
    if (term) {
      assert.ok(!/MediaSources|MediaStreams/i.test(param(url, 'Fields') || ''));
      if (parent === 'movies-lib') return reply(200, { Items: [movie('search-movie', 'Test Movie Search')] });
      if (parent === 'shows-lib') return reply(200, { Items: [series('search-series', 'Test Series Search')] });
      return reply(200, { Items: [] });
    }
    if (parent === 'movies-lib') {
      assert.equal(types, 'Movie,BoxSet');
      if (param(url, 'Filters') === 'IsFavorite') return reply(200, { Items: [movie('favorite-movie', 'Favorite Movie')] });
      return reply(200, { Items: [movie('movie-1', 'Test Movie')] });
    }
    if (parent === 'shows-lib') {
      assert.equal(types, 'Series,BoxSet');
      assert.equal(param(url, 'GenreIds'), 'genre-none');
      if (param(url, 'Filters') === 'IsFavorite') return reply(200, { Items: [] });
      return reply(200, { Items: [series('series-1', 'Test Series')] });
    }
    if (parent === 'collections-lib') {
      assert.equal(types, 'Movie,Series,BoxSet');
      return reply(200, { Items: [{ Id: 'boxset-1', Name: 'Collection One', Type: 'BoxSet', ImageTags: { Primary: 'collection-poster' } }] });
    }
    if (parent === 'boxset-1') return reply(200, { Items: [movie('collection-movie', 'Collection Movie')] });
    if (parent === 'long-series') return reply(200, { Items: [] });
    if (parent === 'season-fallback') return reply(200, { TotalRecordCount: 1, Items: [episode('fallback-episode', 1)] });
  }
  if (pathname === '/jellyfin/Users/user-1/Items/series-1') {
    assert.ok(!/MediaSources|MediaStreams/i.test(param(url, 'Fields') || ''));
    return reply(200, series('series-1', 'Test Series'));
  }
  if (pathname === '/jellyfin/Shows/series-1/Seasons') {
    return reply(200, { Items: [{ Id: 'season-1', Name: 'Season 1', Type: 'Season', IndexNumber: 1, SeriesId: 'series-1' }] });
  }
  if (pathname === '/jellyfin/Shows/series-1/Episodes') {
    assert.equal(param(url, 'SeasonId'), 'season-1');
    assert.ok(!/MediaSources|MediaStreams/i.test(param(url, 'Fields') || ''));
    return reply(200, { TotalRecordCount: 2, Items: [episode('episode-1', 1), episode('episode-2', 2)] });
  }
  if (pathname === '/jellyfin/Users/user-1/Items/long-series') return reply(200, series('long-series', 'Long Series'));
  if (pathname === '/jellyfin/Shows/long-series/Seasons') return reply(200, { Items: [] });
  if (pathname === '/jellyfin/Shows/long-series/Episodes') {
    const start = Number(param(url, 'StartIndex') || 0);
    longEpisodeRequests += 1;
    if (start === 0) {
      const rows = Array.from({ length: 500 }, (_, i) => episode('long-' + (i + 1), i + 1, { SeriesId: 'long-series', SeriesName: 'Long Series' }));
      return reply(200, { TotalRecordCount: 501, Items: rows });
    }
    assert.equal(start, 500);
    return reply(200, { TotalRecordCount: 501, Items: [episode('long-501', 501, { SeriesId: 'long-series', SeriesName: 'Long Series', ParentIndexNumber: 2 })] });
  }
  if (pathname === '/jellyfin/Users/user-1/Items/fallback-series') return reply(200, series('fallback-series', 'Fallback Series'));
  if (pathname === '/jellyfin/Shows/fallback-series/Seasons') return reply(200, { Items: [{ Id: 'season-fallback', Name: 'Season 1', Type: 'Season', IndexNumber: 1 }] });
  if (pathname === '/jellyfin/Shows/fallback-series/Episodes') return reply(404, { Message: 'Not Found' });

  if (pathname === '/jellyfin/Items/episode-1/PlaybackInfo') {
    assert.equal(method, 'POST');
    const body = JSON.parse(init.body);
    assert.equal(body.IsPlayback, false);
    assert.equal(body.Fresh, true);
    assert.equal(body.EnableRequiredHttpHeaders, true);
    assert.equal(body.DeviceProfile.Name, 'Zangetsu');
    return reply(200, {
      PlaySessionId: 'play-session-1',
      MediaSources: [
        {
          Id: 'aio-version-1', Name: '1080p WEB-DL',
          Path: 'https://cdn.example.test/anime/episode-1.mkv?playPath=jellyfin',
          IsRemote: true, Container: 'mkv',
          RequiredHttpHeaders: { Referer: 'https://addon.example.test/' },
          aiostreams: { name: '1080p WEB-DL', resolution: '1080p', addon: 'Example addon', description: 'Example version' },
          MediaStreams: [
            { Type: 'Audio', Index: 0, Language: 'jpn', DisplayTitle: 'Japanese' },
            { Type: 'Subtitle', Index: 1000, IsExternal: true, SupportsExternalStream: true, Codec: 'ass', Language: 'eng', DisplayTitle: 'English', DeliveryUrl: '/Videos/episode-1/aio-version-1/Subtitles/1000/0/Stream.ass?PlaySessionId=play-session-1' },
            { Type: 'Subtitle', Index: 1, IsExternal: false, Codec: 'pgs', Language: 'jpn', DisplayTitle: 'Japanese PGS' }
          ]
        },
        {
          Id: 'native-version', Name: 'Native Jellyfin file',
          Path: '', IsRemote: false, Container: 'mp4',
          SupportsDirectPlay: true, SupportsDirectStream: true,
          MediaStreams: [{ Type: 'Audio', Index: 0, Language: 'eng', DisplayTitle: 'English' }]
        }
      ]
    });
  }
  throw new Error('Unexpected request: ' + method + ' ' + pathname + url.search);
};

const provider = require('../providers/jellyfin.js');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'index.json'), 'utf8'));
const source = manifest.sources.find((item) => item.id === 'jellyfin');

async function main() {
  assert.ok(source, 'Jellyfin source is registered');
  assert.equal(provider.version, '3.0.0');
  assert.equal(provider.getInfo().version, source.version);
  assert.deepEqual(provider.getSettings().map((s) => s.key), source.settings.map((s) => s.key));
  assert.ok(provider.getSettings().some((s) => s.key === 'apiKey'));
  assert.ok(provider.getSettings().some((s) => s.key === 'libraryId'));
  assert.equal(provider._normalizeServerAddress('https://aio.example.test/jellyfin/web/index.html/'), 'https://aio.example.test/jellyfin');
  assert.equal(provider._normalizeServerAddress('aio.example.test/jellyfin'), 'https://aio.example.test/jellyfin');
  assert.throws(() => provider._normalizeServerAddress('https://viewer:secret@aio.example.test'), /embedded credentials/i);
  assert.equal(provider._libraryKind({ CollectionType: 'tvshows' }), 'series');
  assert.equal(provider._libraryKind({ CollectionType: 'music' }), 'unsupported');

  const home = await provider.getHome();
  const names = home.map((row) => row.title);
  for (const row of ['Continue Watching', 'Next Up', 'Recently Added', 'Favorites', 'Movies', 'TV Shows', 'Collections']) {
    assert.ok(names.includes(row), 'missing Home row: ' + row);
  }
  assert.ok(!names.includes('Music'));
  const resume = home.find((row) => row.title === 'Continue Watching');
  assert.equal(resume.items[0].title, 'Test Series');
  assert.equal(resume.items[0].jellyfinItemId, 'resume-episode');
  assert.equal(home.find((row) => row.title === 'Movies').items[0].score, 82);
  assert.equal(home.find((row) => row.title === 'Movies').items[0].dateCreated, '2026-11-02T10:00:00Z');

  const search = await provider.search('Test', 1);
  assert.ok(search.some((item) => item.title === 'Test Movie Search'));
  assert.ok(search.some((item) => item.title === 'Test Series Search'));

  const detail = await provider.getDetail(provider._itemUri('series-1', 'Series'));
  assert.equal(detail.description, 'Test Series synopsis');
  assert.deepEqual(detail.genres, ['Mystery', 'Drama']);
  assert.deepEqual(detail.studios, ['Example Studio']);
  assert.deepEqual(detail.cast, ['Actor One', 'Actor Two']);
  assert.equal(detail.status, 'ongoing');
  assert.equal(detail.episodes.length, 2);
  assert.equal(detail.episodes[0].number, 1);
  assert.equal(detail.malId, 5114);
  assert.equal(detail.anilistId, 21);
  assert.equal(detail.kitsuId, 22);
  assert.equal(detail.anidbId, 23);
  assert.equal(detail.tmdbId, 456);
  assert.equal(detail.imdbId, 'tt1234567');

  assert.equal((await provider.getEpisodes(provider._itemUri('series-1', 'Series'))).length, 2);
  assert.equal((await provider.getEpisodes(provider._itemUri('long-series', 'Series'))).length, 501);
  assert.equal(longEpisodeRequests, 2, 'episode pagination reads the page beyond 500 results');
  assert.equal((await provider.getEpisodes(provider._itemUri('fallback-series', 'Series'))).length, 1,
    'episode lists fall back to the parent-items route when the show route is unavailable');

  const streams = await provider.getVideoSources(provider._episodeUri('episode-1', 'series-1', 'season-1', 1, 1));
  assert.equal(streams.length, 2);
  assert.equal(streams[0].url, 'https://cdn.example.test/anime/episode-1.mkv?playPath=jellyfin');
  assert.equal(streams[0].quality, '1080p');
  assert.equal(streams[0].container, 'mkv');
  assert.equal(streams[0].headers.Referer, 'https://addon.example.test/');
  assert.equal(streams[0].headers.Authorization, undefined);
  assert.equal(streams[0].subtitles.length, 1);
  assert.equal(streams[0].subtitles[0].url,
    'https://aio.example.test/jellyfin/Videos/episode-1/aio-version-1/Subtitles/1000/0/Stream.ass?PlaySessionId=play-session-1');
  assert.ok(streams[0].subtitles[0].headers.Authorization.includes('Token='));
  assert.equal(streams[0].audioTracks[0].lang, 'jpn');
  assert.match(streams[1].url, /\/jellyfin\/Videos\/episode-1\/stream\?static=true/);
  assert.match(streams[1].url, /MediaSourceId=native-version/);
  assert.ok(streams[1].headers.Authorization.includes('Token='));

  assert.ok(authCount >= 2, 'an expired session is authenticated again');
  assert.equal(calls.filter((c) => c.pathname === '/jellyfin/Users/user-1/Views').length, 2);
  for (const call of calls) {
    if (/\/Shows\/.*\/Episodes$/.test(call.pathname)) {
      assert.ok(!/MediaSources|MediaStreams/i.test(param(new URL(call.url), 'Fields') || ''));
    }
  }
  console.log('Jellyfin v3 catalogue and playback tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
