// Combined TMDB metadata and user-configured Stremio streaming for Zangetsu.
// TMDB catalogue flow follows the approach used by Spyou/zangetsu-providers.
// No video sources are hosted by this repository.

var TMDB_API = 'https://api.themoviedb.org/3';
var TMDB_POSTER = 'https://image.tmdb.org/t/p/w500';
var TMDB_BACKDROP = 'https://image.tmdb.org/t/p/w780';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'tmdb-stremio';

function getInfo() {
  return {
    name: 'TMDB + Stremio',
    lang: 'en',
    baseUrl: 'https://www.themoviedb.org',
    logo: 'https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/assets/icon.svg',
    type: 'movie',
    version: '3.0.0'
  };
}

function getSettings() {
  return [
    {
      key: 'tmdbApiKey',
      label: 'TMDB API Key (optional; blank uses app default)',
      description: 'Your personal TMDB v3 API key. Leave blank to use Zangetsu’s built-in key. Sent only to TMDB.',
      type: 'text',
      default: ''
    },
    {
      key: 'addonUrls',
      label: 'Stremio Add-on URLs (manifest URLs; comma/newline separated)',
      description: 'One or more Stremio-compatible add-on manifest URLs. The add-ons provide streams; this repo does not host video.',
      type: 'text',
      default: ''
    },
    {
      key: 'maxStreamsPerAddon',
      label: 'Max streams per add-on (limit results from each add-on)',
      description: 'Maximum number of streams considered per configured add-on.',
      type: 'enum',
      default: '25',
      options: [
        { value: '5', label: '5 streams' },
        { value: '10', label: '10 streams' },
        { value: '25', label: '25 streams' },
        { value: '50', label: '50 streams' },
        { value: '100', label: '100 streams' }
      ]
    }
  ];
}

function _readSetting(key) {
  try {
    var settings = typeof __settings !== 'undefined' && __settings ? __settings[SOURCE_ID] : null;
    return settings && settings[key] != null ? settings[key] : null;
  } catch (e) { return null; }
}

function _combinedSettings() {
  var max = parseInt(_readSetting('maxStreamsPerAddon'), 10);
  if (!max || max < 1) max = 25;
  if (max > 100) max = 100;
  return {
    tmdbApiKey: _trim(_readSetting('tmdbApiKey')),
    urls: _parseAddonUrls(_readSetting('addonUrls')),
    max: max
  };
}

function _tmdbRequestUrl(path) {
  var key = _combinedSettings().tmdbApiKey;
  if (!key) return TMDB_API + path;
  // The host app injects its own key for api.themoviedb.org. The trailing-dot
  // hostname is the same DNS host but avoids that interceptor overwriting the
  // user's explicitly supplied v3 key.
  var base = 'https://api.themoviedb.org./3';
  return base + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key);
}

function _trim(value) {
  return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function _tmdbJson(path) {
  return fetch(_tmdbRequestUrl(path), {
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

function _status(value) {
  var status = _trim(value).toLowerCase();
  if (status === 'returning series' || status === 'in production' || status === 'planned') return 'ongoing';
  if (status === 'ended' || status === 'released') return 'completed';
  if (status === 'canceled' || status === 'cancelled') return 'cancelled';
  if (status === 'hiatus') return 'hiatus';
  return 'unknown';
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
          status: _status(info.status),
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

function _parseAddonUrls(raw) {
  var source = String(raw || '');
  var parts = source.split(/[,;\r\n]+/);
  var out = [], seen = {};
  for (var i = 0; i < parts.length; i++) {
    var value = _trim(parts[i]);
    if (!value) continue;
    value = value.replace(/^stremio:\/\//i, 'https://').replace(/#.*$/, '');
    if (!/^https?:\/\//i.test(value)) continue;
    var query = '';
    var queryAt = value.indexOf('?');
    if (queryAt >= 0) {
      query = value.substring(queryAt + 1);
      value = value.substring(0, queryAt);
    }
    value = value.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
    var normalized = value + (query ? '::zangetsu-query::' + query : '');
    if (!seen[normalized]) { seen[normalized] = true; out.push(normalized); }
  }
  return out;
}

function _addonParts(base) {
  var value = String(base || '');
  var marker = value.indexOf('::zangetsu-query::');
  if (marker < 0) return { root: value, query: '' };
  return {
    root: value.substring(0, marker),
    query: value.substring(marker + '::zangetsu-query::'.length)
  };
}

function _streamSettings() {
  var max = parseInt(_readSetting('maxStreamsPerAddon'), 10);
  if (!max || max < 1) max = 25;
  if (max > 100) max = 100;
  return {
    urls: _parseAddonUrls(_readSetting('addonUrls')),
    max: max
  };
}

function _json(url) {
  return fetch(url, { headers: { Accept: 'application/json' }, timeoutMs: 12000 })
    .then(function (response) {
      if (response && response.status && response.status >= 400) throw new Error('HTTP ' + response.status);
      var body = response && response.body != null ? response.body : '';
      return typeof body === 'string' ? JSON.parse(body || 'null') : body;
    });
}

function _manifestUrl(base) {
  var parts = _addonParts(base);
  return parts.root + '/manifest.json' + (parts.query ? '?' + parts.query : '');
}

function _streamEndpoint(base, type, id) {
  var parts = _addonParts(base);
  return parts.root + '/stream/' + encodeURIComponent(type) + '/' +
    encodeURIComponent(id) + '.json' + (parts.query ? '?' + parts.query : '');
}

function _parseStreamId(raw) {
  var item = raw && typeof raw === 'object' ? raw : null;
  if (!item) {
    var value = String(raw || '');
    if (value.charAt(0) === '{') {
      try { item = JSON.parse(value); } catch (e) {}
    }
    if (!item) item = { id: value };
  }

  var id = String(item.videoId || item.id || '');
  var kind = String(item.type || (item.season || item.episode ? 'series' : 'movie')).toLowerCase();
  var type = kind === 'series' || kind === 'tv' ? 'series' : 'movie';
  var season = parseInt(item.season, 10) || 0;
  var episode = parseInt(item.episode, 10) || 0;
  var imdb = String(item.imdbId || item.imdb_id || '');
  var tmdb = item.tmdbId || item.tmdb_id || item.moviedb_id || null;
  var ids = [], seen = {};

  function add(value) {
    var candidate = String(value == null ? '' : value);
    if (candidate && !seen[candidate]) { seen[candidate] = true; ids.push(candidate); }
  }

  if (!/^tmdb:\/\/(?:movie|tv|series)\//i.test(id)) add(id);
  if (imdb) {
    if (type === 'series' && season > 0 && episode > 0) add(imdb + ':' + season + ':' + episode);
    add(imdb);
  }
  if (tmdb) {
    add(String(tmdb));
    add('tmdb:' + (type === 'series' ? 'series' : 'movie') + ':' + String(tmdb));
    if (type === 'series' && season > 0 && episode > 0) {
      add('tmdb:series:' + String(tmdb) + ':' + season + ':' + episode);
    }
  }
  return { ids: ids, type: type };
}

function _stream(raw, base, config) {
  if (!raw || typeof raw !== 'object') return null;
  var url = typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url) ? raw.url : '';
  if (!url) return null;
  var text = String(raw.name || '') + ' ' + String(raw.title || '') + ' ' + String(raw.description || '');
  var qualityMatch = text.match(/(2160p|4k|1080p|720p|480p|360p)/i);
  var container = /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' :
    /\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(url) ? 'mp4' : 'unknown';
  return {
    url: url,
    quality: qualityMatch ? (qualityMatch[1].toLowerCase() === '4k' ? '2160p' : qualityMatch[1]) : 'Auto',
    label: (raw.name || 'Stremio') + (raw.title ? ' · ' + raw.title : ''),
    container: container,
    headers: raw.behaviorHints && raw.behaviorHints.proxyHeaders && raw.behaviorHints.proxyHeaders.request || {},
    kind: 'raw'
  };
}

function getVideoSources(episodeUrl, opts) {
  var config = _combinedSettings();
  if (!config.urls.length) return Promise.resolve([]);
  var parsed = _parseStreamId(episodeUrl);
  if (!parsed.ids.length) return Promise.resolve([]);

  var jobs = config.urls.map(function (base) {
    return _json(_manifestUrl(base)).then(function (manifest) {
      var resources = manifest && manifest.resources;
      var hasStreams = !Array.isArray(resources) || resources.some(function (resource) {
        return resource === 'stream' || (resource && resource.name === 'stream');
      });
      if (!hasStreams) return [];
      return Promise.all(parsed.ids.map(function (id) {
        return _json(_streamEndpoint(base, parsed.type, id)).then(function (data) {
          var streams = data && Array.isArray(data.streams) ? data.streams.slice(0, config.max) : [];
          return streams.map(function (stream) { return _stream(stream, base, config); }).filter(Boolean);
        }).catch(function () { return []; });
      })).then(function (lists) {
        var out = [];
        lists.forEach(function (list) { out = out.concat(list); });
        return out;
      });
    }).catch(function () { return []; });
  });

  return Promise.all(jobs).then(function (lists) {
    var out = [], seen = {};
    lists.forEach(function (list) {
      list.forEach(function (stream) {
        var key = stream.url;
        if (!seen[key]) { seen[key] = true; out.push(stream); }
      });
    });
    return out;
  });
}


if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getInfo: getInfo, getSettings: getSettings, getHome: getHome,
    popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources,
    _item: _item, _parseTmdbUrl: _parseTmdbUrl, _episodeId: _episodeId,
    _combinedSettings: _combinedSettings, _tmdbRequestUrl: _tmdbRequestUrl,
    _parseAddonUrls: _parseAddonUrls, _parseStreamId: _parseStreamId
  };
}
