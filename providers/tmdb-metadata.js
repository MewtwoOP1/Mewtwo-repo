// TMDB metadata catalogue for Zangetsu.
// Adapted from the TMDB catalogue flow used by Spyou/zangetsu-providers.
// Zangetsu's host injects its TMDB API key; this extension stores no key.

var TMDB_API = 'https://api.themoviedb.org/3';
var TMDB_POSTER = 'https://image.tmdb.org/t/p/w500';
var TMDB_BACKDROP = 'https://image.tmdb.org/t/p/w780';
var SOURCE_ID = 'tmdb-metadata';

function getInfo() {
  return {
    name: 'TMDB Metadata',
    lang: 'en',
    baseUrl: 'https://www.themoviedb.org',
    logo: 'https://www.themoviedb.org/assets/2/v4/logos/round.svg',
    type: 'movie',
    version: '1.0.0'
  };
}

function getSettings() { return []; }

function _trim(value) {
  return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function _tmdbJson(path) {
  return fetch(TMDB_API + path, {
    headers: { Accept: 'application/json' },
    timeoutMs: 15000
  }).then(function (response) {
    if (response && response.status && response.status >= 400) {
      throw new Error('TMDB HTTP ' + response.status);
    }
    var body = response && response.body != null ? response.body : '';
    return typeof body === 'string' ? JSON.parse(body || 'null') : body;
  }).catch(function (error) {
    console.warn('TMDB request failed:', path, String(error));
    return null;
  });
}

function _year(record) {
  return String(record.release_date || record.first_air_date || '').slice(0, 4) || null;
}

function _isTv(record, forcedType) {
  return forcedType === 'tv' || record.media_type === 'tv' || record.first_air_date != null;
}

function _tmdbUrl(type, id) {
  return 'tmdb://' + (type === 'tv' ? 'tv' : 'movie') + '/' + String(id);
}

function _item(record, forcedType) {
  if (!record || record.id == null) return null;
  var type = _isTv(record, forcedType) ? 'tv' : 'movie';
  if (record.media_type && record.media_type !== 'movie' && record.media_type !== 'tv') return null;
  var title = _trim(record.title || record.name || '');
  if (!title) return null;
  var id = Number(record.id);
  if (!isFinite(id) || id < 1) return null;
  var url = _tmdbUrl(type, id);
  var item = {
    id: url,
    title: _year(record) ? title + ' (' + _year(record) + ')' : title,
    cover: record.poster_path ? TMDB_POSTER + record.poster_path : null,
    banner: record.backdrop_path ? TMDB_BACKDROP + record.backdrop_path : null,
    url: url,
    type: 'movie',
    sourceId: SOURCE_ID,
    tmdbId: id,
    tmdbIsTv: type === 'tv'
  };
  if (record.vote_average != null && isFinite(Number(record.vote_average))) {
    item.score = Math.round(Number(record.vote_average) * 10);
  }
  return item;
}

function _mapResults(json, forcedType) {
  var results = json && Array.isArray(json.results) ? json.results : [];
  var out = [];
  for (var i = 0; i < results.length; i++) {
    var item = _item(results[i], forcedType);
    if (item) out.push(item);
  }
  return out;
}

function getHome(opts) {
  return Promise.all([
    _tmdbJson('/trending/movie/week'),
    _tmdbJson('/trending/tv/week'),
    _tmdbJson('/movie/popular'),
    _tmdbJson('/tv/popular')
  ]).then(function (results) {
    return [
      { title: 'Trending Movies', items: _mapResults(results[0], 'movie') },
      { title: 'Trending Series', items: _mapResults(results[1], 'tv') },
      { title: 'Popular Movies', items: _mapResults(results[2], 'movie') },
      { title: 'Popular Series', items: _mapResults(results[3], 'tv') }
    ].filter(function (row) { return row.items.length > 0; });
  });
}

function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    rows.forEach(function (row) {
      row.items.forEach(function (item) { out.push(item); });
    });
    return out;
  });
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  return _tmdbJson('/search/multi?query=' + encodeURIComponent(q) + '&page=' + p)
    .then(function (json) { return _mapResults(json, null); });
}

function _parseTmdbUrl(value) {
  if (value && typeof value === 'object') {
    var objectId = value.tmdbId || value.id || value.videoId;
    var objectType = value.tmdbIsTv === true || value.type === 'tv' || value.type === 'series' ? 'tv' : 'movie';
    if (objectId != null && isFinite(Number(objectId))) return { id: Number(objectId), type: objectType };
  }
  var s = String(value || '');
  var json = null;
  if (s.charAt(0) === '{') {
    try { json = JSON.parse(s); } catch (e) {}
    if (json) return _parseTmdbUrl(json);
  }
  var m = s.match(/^(?:tmdb|torbox):\/\/(movie|tv|series)\/(\d+)/i);
  if (!m) return null;
  return { id: Number(m[2]), type: m[1].toLowerCase() === 'tv' || m[1].toLowerCase() === 'series' ? 'tv' : 'movie' };
}

function _externalIds(type, id, detail) {
  var embedded = detail && detail.external_ids;
  if (embedded && embedded.imdb_id) return Promise.resolve(embedded.imdb_id);
  var path = type === 'tv' ? '/tv/' + id + '/external_ids' : '/movie/' + id + '/external_ids';
  return _tmdbJson(path).then(function (json) { return json && json.imdb_id ? json.imdb_id : null; });
}

function _pad(value) {
  var n = parseInt(value, 10) || 0;
  return n < 10 ? '0' + n : String(n);
}

function _episodeId(type, id, imdbId, season, episode, absoluteEpisode) {
  return JSON.stringify({
    id: _tmdbUrl(type, id),
    videoId: _tmdbUrl(type, id),
    type: type === 'tv' ? 'series' : 'movie',
    tmdbId: id,
    tmdbIsTv: type === 'tv',
    imdbId: imdbId || undefined,
    season: season || 0,
    episode: episode || 0,
    absoluteEpisode: absoluteEpisode || undefined
  });
}

function _tvEpisodes(id, imdbId, seasonCount) {
  var count = Math.min(Math.max(1, parseInt(seasonCount, 10) || 1), 40);
  var jobs = [];
  for (var season = 1; season <= count; season++) {
    (function (seasonNumber) {
      jobs.push(_tmdbJson('/tv/' + id + '/season/' + seasonNumber).then(function (json) {
        return { season: seasonNumber, episodes: json && Array.isArray(json.episodes) ? json.episodes : [] };
      }));
    })(season);
  }
  return Promise.all(jobs).then(function (seasons) {
    var out = [];
    seasons.sort(function (a, b) { return a.season - b.season; });
    seasons.forEach(function (row) {
      var continuous = false;
      for (var c = 0; c < row.episodes.length; c++) {
        var candidateNumber = row.episodes[c].episode_number;
        if (candidateNumber != null && Number(candidateNumber) !== c + 1) {
          continuous = true;
          break;
        }
      }
      row.episodes.forEach(function (episode, index) {
        if (episode.episode_number == null) return;
        var tmdbNumber = Number(episode.episode_number) || index + 1;
        var seasonNumber = Number(row.season);
        var relativeNumber = continuous ? index + 1 : tmdbNumber;
        var absoluteNumber = continuous ? tmdbNumber : null;
        out.push({
          id: String(seasonNumber) + 'x' + String(relativeNumber),
          title: 'S' + _pad(seasonNumber) + ' E' + _pad(relativeNumber) + ' - ' + (episode.name || ('Episode ' + (absoluteNumber || tmdbNumber))),
          number: absoluteNumber || tmdbNumber,
          season: seasonNumber,
          url: _episodeId('tv', id, imdbId, seasonNumber, relativeNumber, absoluteNumber),
          date: episode.air_date || null,
          thumbnail: episode.still_path ? 'https://image.tmdb.org/t/p/w300' + episode.still_path : null
        });
      });
    });
    return out;
  });
}

function getDetail(url, opts) {
  var parsed = _parseTmdbUrl(url);
  if (!parsed) return Promise.resolve(null);
  var id = parsed.id;
  var type = parsed.type;
  var path = type === 'tv'
    ? '/tv/' + id + '?append_to_response=external_ids'
    : '/movie/' + id + '?append_to_response=external_ids';
  return _tmdbJson(path).then(function (info) {
    if (!info || info.success === false || info.id == null) return null;
    return _externalIds(type, id, info).then(function (imdbId) {
      var title = _trim(info.title || info.name || 'Untitled');
      var year = _year(info);
      var genres = (info.genres || []).map(function (genre) { return genre && genre.name; }).filter(Boolean);
      var episodes;
      if (type === 'tv') {
        return _tvEpisodes(id, imdbId, info.number_of_seasons || (info.seasons || []).length || 1).then(function (tvEpisodes) {
          episodes = tvEpisodes;
          return _detailResult();
        });
      }
      episodes = [{
        id: 'movie',
        title: title,
        number: 1,
        url: _episodeId('movie', id, imdbId, 0, 0)
      }];
      return _detailResult();

      function _detailResult() {
        var result = {
          id: _tmdbUrl(type, id),
          title: title,
          cover: info.poster_path ? TMDB_POSTER + info.poster_path : null,
          banner: info.backdrop_path ? TMDB_BACKDROP + info.backdrop_path : null,
          url: _tmdbUrl(type, id),
          description: info.overview || '',
          status: info.status || 'unknown',
          genres: genres,
          studios: [],
          type: 'movie',
          sourceId: SOURCE_ID,
          year: year,
          tmdbId: id,
          tmdbIsTv: type === 'tv',
          imdbId: imdbId || null,
          episodes: episodes,
          subCount: episodes.length,
          dubCount: 0
        };
        if (info.vote_average != null && isFinite(Number(info.vote_average))) result.score = Math.round(Number(info.vote_average) * 10);
        return result;
      }
    });
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) {
    return detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  });
}

// Keep the catalogue and stream provider separate, but let a metadata result
// hand playback to the configured Stremio Bridge when that provider is installed.
function getVideoSources(episodeUrl, opts) {
  var providers = typeof globalThis !== 'undefined' && globalThis.__providers ? globalThis.__providers : null;
  var bridge = providers && providers['stremio-bridge'];
  if (!bridge || typeof bridge.getVideoSources !== 'function') return Promise.resolve([]);
  return Promise.resolve(bridge.getVideoSources(episodeUrl, opts)).catch(function (error) {
    console.warn('Stremio Bridge handoff failed:', String(error));
    return [];
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getInfo: getInfo, getSettings: getSettings, getHome: getHome,
    popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources,
    _item: _item, _parseTmdbUrl: _parseTmdbUrl, _episodeId: _episodeId
  };
}
