// AlmostOTT catalogue and multi-server playback provider for Zangetsu.
// Catalogue metadata uses TMDB; playback tries the resolver API and player embeds offered by AlmostOTT.
// No video sources are hosted by this repository.

var TMDB_API = 'https://api.themoviedb.org/3';
var TMDB_POSTER = 'https://image.tmdb.org/t/p/w500';
var TMDB_BACKDROP = 'https://image.tmdb.org/t/p/w780';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'almostott';

function getInfo() {
  return {
    name: 'AlmostOTT',
    lang: 'en',
    baseUrl: 'https://almostott.aethoflix.world',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=almostott.aethoflix.world',
    type: 'movie',
    version: '1.0.1'
  };
}

function getSettings() {
  return [{
    key: 'tmdbApiKey',
    label: 'TMDB API Key (optional; blank uses app default)',
    description: 'Your personal TMDB v3 API key. Leave blank to use Zangetsu’s built-in key. Sent only to TMDB.',
    type: 'text',
    default: ''
  }];
}

function _readSetting(key) {
  try {
    var settings = typeof __settings !== 'undefined' && __settings ? __settings[SOURCE_ID] : null;
    return settings && settings[key] != null ? settings[key] : null;
  } catch (e) { return null; }
}

function _combinedSettings() {
  return { tmdbApiKey: _trim(_readSetting('tmdbApiKey')) };
}

function _tmdbRequestUrl(path) {
  var key = _combinedSettings().tmdbApiKey;
  if (!key) return TMDB_API + path;
  // The trailing-dot hostname bypasses the host app's default-key interceptor
  // while resolving to the same DNS hostname. The HTTP Host remains canonical.
  var base = 'https://api.themoviedb.org./3';
  return base + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'api_key=' + encodeURIComponent(key);
}

function _trim(value) {
  return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function _tmdbJson(path) {
  var customKey = _combinedSettings().tmdbApiKey;
  var headers = { Accept: 'application/json' };
  // Keep the HTTP Host canonical while using the trailing-dot DNS form to
  // avoid Zangetsu's built-in TMDB-key interceptor replacing a custom key.
  if (customKey) headers.Host = 'api.themoviedb.org';
  return fetch(_tmdbRequestUrl(path), {
    headers: headers,
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


// Parse the provider's packed episode URL, retaining TMDB IDs and relative
// season/episode coordinates. A plain tmdb:// URL is also accepted for movies.
function _parsePlaybackEpisode(raw) {
  var item = raw && typeof raw === 'object' ? raw : null;
  if (!item) {
    var value = String(raw || '');
    if (value.charAt(0) === '{') {
      try { item = JSON.parse(value); } catch (e) {}
    }
    if (!item) {
      var parsedUrl = _parseTmdbUrl(value);
      if (!parsedUrl) return null;
      if (parsedUrl.type === 'tv') return null;
      return { id: parsedUrl.id, type: parsedUrl.type, season: 0, episode: 0 };
    }
  }

  var id = item.tmdbId || item.tmdb_id || item.moviedb_id || null;
  var kind = String(item.type || '').toLowerCase();
  var isTv = item.tmdbIsTv === true || kind === 'tv' || kind === 'series';
  if (!id) {
    var urlMatch = String(item.id || item.videoId || '').match(/^tmdb:\/\/(tv|series|movie)\/(\d+)/i);
    if (urlMatch) {
      isTv = urlMatch[1].toLowerCase() !== 'movie';
      id = urlMatch[2];
    }
  }
  id = String(id || '');
  if (!/^\d+$/.test(id) || Number(id) < 1) return null;
  var season = parseInt(item.season, 10) || 0;
  var episode = parseInt(item.episode, 10) || 0;
  if (isTv && (season < 1 || episode < 1)) return null;
  return { id: id, type: isTv ? 'tv' : 'movie', season: season, episode: episode };
}

var VIDLINK_BASE = 'https://vidlink.pro';
var ENC_DEC_BASE = 'https://enc-dec.app/api/enc-vidlink';
var VIDLINK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

function _jsonRequest(url, options, label) {
  var opts = options || {};
  opts.timeoutMs = opts.timeoutMs || 12000;
  return fetch(url, opts).then(function (response) {
    if (response && response.status && response.status >= 400) {
      throw new Error(label + ' HTTP ' + response.status);
    }
    var body = response && response.body != null ? response.body : '';
    var data = typeof body === 'string' ? JSON.parse(body || 'null') : body;
    return data;
  });
}

function _encodeVidlinkId(tmdbId) {
  return _jsonRequest(ENC_DEC_BASE + '?text=' + encodeURIComponent(String(tmdbId)), {
    headers: { Accept: 'application/json', 'User-Agent': VIDLINK_UA },
    timeoutMs: 8000
  }, 'VidLink ID encoder').then(function (data) {
    var encoded = data && data.result;
    if (typeof encoded !== 'string' || !encoded || data.status != null && Number(data.status) !== 200) {
      throw new Error('VidLink ID encoder returned no ID');
    }
    return encoded;
  });
}

function _qualitySortNumber(value) {
  var text = String(value || '').toLowerCase();
  if (text === '4k') return 2160;
  if (text === 'auto' || text === 'unknown') return 0;
  var m = text.match(/\d{3,4}/);
  return m ? Number(m[0]) : 0;
}

function _qualityLabel(value) {
  var text = String(value || 'auto').toLowerCase();
  if (text === '4k') return '2160p';
  if (/^\d{3,4}$/.test(text)) return text + 'p';
  if (/^\d{3,4}p$/.test(text)) return text;
  if (text === 'auto' || text === 'unknown') return 'Auto';
  return text;
}

function _subtitleTracks(captions) {
  if (!Array.isArray(captions)) return [];
  var out = [];
  for (var i = 0; i < captions.length; i++) {
    var track = captions[i];
    if (!track || typeof track.url !== 'string' || !/^https?:\/\//i.test(track.url)) continue;
    out.push({
      url: track.url,
      lang: _trim(track.language || track.lang || track.label || 'Unknown'),
      label: _trim(track.label || track.language || track.lang || 'Subtitle'),
      format: String(track.type || (/\.srt(?:[?#]|$)/i.test(track.url) ? 'srt' : 'vtt')).toLowerCase(),
      'default': !!track.default
    });
  }
  return out;
}

function _vidlinkSources(data, type) {
  var stream = data && data.stream;
  var qualities = stream && stream.qualities;
  var subtitles = _subtitleTracks(data && (data.captions || data.subtitles));
  var out = [];
  if (qualities && typeof qualities === 'object') {
    var entries = Object.keys(qualities).map(function (key) {
      return { key: key, entry: qualities[key] };
    }).filter(function (row) {
      return row.entry && typeof row.entry.url === 'string' && /^https?:\/\//i.test(row.entry.url);
    });
    entries.sort(function (a, b) {
      return _qualitySortNumber(b.key) - _qualitySortNumber(a.key);
    });
    for (var i = 0; i < entries.length; i++) {
      var row = entries[i], entry = row.entry, quality = _qualityLabel(row.key);
      var url = entry.url;
      var typeHint = String(entry.type || '').toLowerCase();
      var container = typeHint === 'hls' || /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' :
        typeHint === 'mp4' || /\.(?:mp4|m4v|mov|webm)(?:[?#]|$)/i.test(url) ? 'mp4' : 'unknown';
      out.push({
        url: url,
        quality: quality,
        label: 'AlmostOTT · VidLink ' + quality,
        container: container,
        headers: {
          'User-Agent': VIDLINK_UA,
          Referer: VIDLINK_BASE + '/',
          Origin: VIDLINK_BASE
        },
        kind: 'raw',
        subtitles: subtitles
      });
    }
  }

  // Some resolver responses offer a single adaptive playlist instead of a
  // quality map. Keep that path supported without fabricating qualities.
  var playlist = stream && (stream.playlist || stream.url);
  if (!out.length && typeof playlist === 'string' && /^https?:\/\//i.test(playlist)) {
    out.push({
      url: playlist,
      quality: 'Auto',
      label: 'AlmostOTT · VidLink Auto',
      container: /\.m3u8(?:[?#]|$)/i.test(playlist) ? 'hls' : 'unknown',
      headers: {
        'User-Agent': VIDLINK_UA,
        Referer: VIDLINK_BASE + '/',
        Origin: VIDLINK_BASE
      },
      kind: 'raw',
      subtitles: subtitles
    });
  }
  return out;
}

// These are the movie/TV player choices exposed by AlmostOTT's public player selector.
// They are iframe/player endpoints, so resolve them through Zangetsu's shared extractor
// instead of returning the embed pages as if they were playable video files.
var ALMOSTOTT_PLAYERS = [
  { name: 'TgVid', base: 'https://tgvid.lovable.app', movie: '/embed/movie/', tv: '/embed/tv/' },
  { name: 'VidStuck', base: 'https://vidstuck.xyz', movie: '/embed/movie/', tv: '/embed/tv/', query: '?color=ffffff' },
  { name: 'ZXCStream', base: 'https://zxcstream.xyz', movie: '/player/movie/', tv: '/player/tv/' },
  { name: 'Bingr', base: 'https://bingr.one', movie: '/watch/movie/', tv: '/watch/tv/' },
  { name: 'NXShA', base: 'https://nxsha.space', movie: '/embed/movie/', tv: '/embed/tv/' },
  { name: 'Flix', base: 'https://flix.vumeto.xyz', movie: '/embed/movie/', tv: '/embed/tv/' }
];

function _almostottPlayerUrl(player, parsed) {
  var path = parsed.type === 'tv'
    ? player.tv + parsed.id + '/' + parsed.season + '/' + parsed.episode
    : player.movie + parsed.id;
  return player.base + path + (player.query || '');
}

function _withPlayerLabel(source, player) {
  if (!source || typeof source.url !== 'string' || !/^https?:\/\//i.test(source.url)) return null;
  var copy = {};
  Object.keys(source).forEach(function (key) { copy[key] = source[key]; });
  var existing = _trim(source.label || source.name || '');
  var parts = ['AlmostOTT', player.name];
  if (existing && existing.toLowerCase().indexOf(player.name.toLowerCase()) < 0) parts.push(existing);
  var language = _trim(source.audioLang || source.language || '');
  var kind = _trim(source.kind || '').toLowerCase();
  if (language) parts.push(language + (kind === 'dub' ? ' Dub' : kind === 'sub' ? ' Sub' : ''));
  copy.label = parts.join(' · ');
  copy.server = player.name;
  return copy;
}

function _extractPlayerSources(parsed) {
  if (typeof extractVideo !== 'function') return Promise.resolve([]);
  var jobs = ALMOSTOTT_PLAYERS.map(function (player) {
    var embedUrl = _almostottPlayerUrl(player, parsed);
    return Promise.resolve().then(function () {
      return extractVideo(embedUrl, {
        headers: { Referer: 'https://almostott.aethoflix.world/' }
      });
    }).then(function (sources) {
      if (!Array.isArray(sources)) return [];
      return sources.map(function (source) { return _withPlayerLabel(source, player); }).filter(Boolean);
    }).catch(function (error) {
      console.warn('AlmostOTT ' + player.name + ' extractor failed:', String(error));
      return [];
    });
  });
  return Promise.all(jobs).then(function (lists) {
    var out = [];
    lists.forEach(function (list) { out = out.concat(list); });
    return out;
  });
}

function _vidlinkResolverSources(parsed) {
  return _encodeVidlinkId(parsed.id).then(function (encoded) {
    var path = parsed.type === 'tv'
      ? '/api/b/tv/' + encodeURIComponent(encoded) + '/' + parsed.season + '/' + parsed.episode + '?multiLang=0'
      : '/api/b/movie/' + encodeURIComponent(encoded) + '?multiLang=0';
    var playerPage = parsed.type === 'tv'
      ? VIDLINK_BASE + '/tv/' + parsed.id + '/' + parsed.season + '/' + parsed.episode
      : VIDLINK_BASE + '/movie/' + parsed.id;
    return _jsonRequest(VIDLINK_BASE + path, {
      headers: {
        Accept: 'application/json',
        'User-Agent': VIDLINK_UA,
        Referer: playerPage,
        Origin: VIDLINK_BASE
      },
      timeoutMs: 12000
    }, 'VidLink stream resolver');
  }).then(function (data) {
    return _vidlinkSources(data, parsed.type);
  }).catch(function (error) {
    console.warn('AlmostOTT VidLink resolver failed:', String(error));
    return [];
  });
}

function _dedupeSources(lists) {
  var out = [], seen = {};
  (lists || []).forEach(function (list) {
    (list || []).forEach(function (source) {
      if (!source || typeof source.url !== 'string') return;
      var key = source.url;
      if (!seen[key]) { seen[key] = true; out.push(source); }
    });
  });
  return out;
}

function getVideoSources(episodeUrl, opts) {
  var parsed = _parsePlaybackEpisode(episodeUrl);
  if (!parsed) return Promise.resolve([]);
  return Promise.all([
    _vidlinkResolverSources(parsed),
    _extractPlayerSources(parsed)
  ]).then(_dedupeSources).catch(function (error) {
    console.warn('AlmostOTT source lookup failed:', String(error));
    return [];
  });
}

function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.1',
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    popular: popular,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams,
    getLinks: getLinks,
    _combinedSettings: _combinedSettings,
    _tmdbRequestUrl: _tmdbRequestUrl,
    _parseTmdbUrl: _parseTmdbUrl,
    _parsePlaybackEpisode: _parsePlaybackEpisode,
    _encodeVidlinkId: _encodeVidlinkId,
    _vidlinkSources: _vidlinkSources,
    _almostottPlayerUrl: _almostottPlayerUrl,
    _extractPlayerSources: _extractPlayerSources
  };
}
