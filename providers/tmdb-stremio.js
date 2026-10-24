// Combined TMDB metadata and user-configured Stremio streaming for Zangetsu.
// TMDB catalogue flow follows the approach used by Spyou/zangetsu-providers.
// No video sources are hosted by this repository.

var TMDB_API = 'https://api.themoviedb.org/3';
var TMDB_POSTER = 'https://image.tmdb.org/t/p/w500';
var TMDB_BACKDROP = 'https://image.tmdb.org/t/p/w780';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'tmdb-stremio';
var ADDON_CATALOG_META_CACHE = {};
var ADDON_MANIFEST_CACHE = {};
var TMDB_RESPONSE_CACHE = {};

function getInfo() {
  return {
    name: 'TMDB + Stremio',
    lang: 'en',
    baseUrl: 'https://www.themoviedb.org',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io',
    type: 'movie',
    version: '3.2.1'
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
      key: 'enableAddonCatalogs',
      label: 'Use configured add-on catalogues and metadata',
      description: 'When enabled, browse configured add-on catalogues and prefer the add-on metadata for those items. Disable to use TMDB catalogues only.',
      type: 'bool',
      default: false
    },
    {
      key: 'showP2P',
      label: 'Show torrent / P2P streams',
      description: 'Allow magnet and infoHash results from configured add-ons. Enable only if the Zangetsu player supports torrent links.',
      type: 'bool',
      default: false
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
    useAddonCatalogs: _readSetting('enableAddonCatalogs') === true || String(_readSetting('enableAddonCatalogs')).toLowerCase() === 'true',
    showP2P: _readSetting('showP2P') === true || String(_readSetting('showP2P')).toLowerCase() === 'true',
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
  var config = _combinedSettings();
  var customKey = config.tmdbApiKey;
  var primaryUrl = _tmdbRequestUrl(path);
  var cacheKey = primaryUrl;
  var cached = TMDB_RESPONSE_CACHE[cacheKey];
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);

  var headers = { Accept: 'application/json' };
  if (customKey) headers.Host = 'api.themoviedb.org';

  function _responseJson(response) {
    if (response && response.status && response.status >= 400) {
      var httpError = new Error('TMDB HTTP ' + response.status);
      httpError.status = response.status;
      throw httpError;
    }
    var body = response && response.body != null ? response.body : '';
    return typeof body === 'string' ? JSON.parse(body || 'null') : body;
  }

  function _remember(value) {
    if (value && typeof value === 'object') {
      TMDB_RESPONSE_CACHE[cacheKey] = {
        value: value,
        expiresAt: Date.now() + 120000,
        staleUntil: Date.now() + 21600000
      };
      var keys = Object.keys(TMDB_RESPONSE_CACHE);
      while (keys.length > 160) delete TMDB_RESPONSE_CACHE[keys.shift()];
    }
    return value;
  }

  function _request(url, requestHeaders) {
    return fetch(url, { headers: requestHeaders, timeoutMs: 15000 }).then(_responseJson);
  }

  function _staleOrNull(error) {
    var entry = TMDB_RESPONSE_CACHE[cacheKey];
    var status = Number(error && error.status) || 0;
    var retryable = !status || status === 429 || status >= 500;
    if (entry && entry.staleUntil > Date.now() && retryable) {
      console.warn('TMDB request failed; using cached metadata:', path, String(error));
      return entry.value;
    }
    return null;
  }

  return _request(primaryUrl, headers).then(_remember).catch(function (error) {
    console.warn('TMDB request failed:', path, String(error));
    // Custom credentials bypass Zangetsu's primary-host API-key interceptor.
    // Retry on TMDB's alternate API hostname when the trailing-dot host is unavailable.
    var canUseAlternateHost = !!customKey &&
      /^https:\/\/api\.themoviedb\.org\.\/3(?:\/|\?)/i.test(primaryUrl) &&
      (!error.status || error.status === 429 || error.status >= 500);
    if (!canUseAlternateHost) return _staleOrNull(error);
    var fallbackUrl = primaryUrl.replace(/^https:\/\/api\.themoviedb\.org\.\/3/i, 'https://api.tmdb.org/3');
    return _request(fallbackUrl, { Accept: 'application/json' }).then(_remember).catch(function (fallbackError) {
      console.warn('TMDB alternate-host request failed:', path, String(fallbackError));
      return _staleOrNull(fallbackError);
    });
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


function _catalogManifestUrl(base) {
  var parts = _addonParts(base);
  return parts.root + '/manifest.json' + (parts.query ? '?' + parts.query : '');
}

function _catalogEndpoint(base, resource, type, id, searchQuery) {
  var parts = _addonParts(base);
  var path = '/' + resource + '/' + encodeURIComponent(type) + '/' + encodeURIComponent(id);
  if (searchQuery) path += '/search=' + encodeURIComponent(searchQuery);
  return parts.root + path + '.json' + (parts.query ? '?' + parts.query : '');
}

function _catalogItem(meta, base, fallbackType) {
  if (!meta || meta.id == null) return null;
  var type = String(meta.type || fallbackType || 'movie').toLowerCase();
  if (type === 'tv') type = 'series';
  if (type !== 'movie' && type !== 'series') return null;
  var id = String(meta.id);
  var encodedBase = encodeURIComponent(base);
  var url = 'stremio-addon://' + encodedBase + '/' + encodeURIComponent(type) + '/' + encodeURIComponent(id);
  var title = _trim(meta.name || meta.title || (meta.aliases && meta.aliases[0]) || '');
  if (!title) return null;
  var item = {
    id: url, url: url, title: title,
    cover: meta.poster || meta.cover || null,
    banner: meta.background || meta.banner || null,
    type: 'movie', sourceId: SOURCE_ID,
    addonType: type, addonId: id, addonBase: base,
    year: String(meta.releaseInfo || meta.year || meta.release_date || meta.first_air_date || '').slice(0,4) || null
  };
  var rating = Number(meta.imdbRating != null ? meta.imdbRating : (meta.rating != null ? meta.rating : meta.score));
  if (isFinite(rating)) item.score = Math.round(rating > 10 ? rating : rating * 10);
  // Keep the catalogue preview so detail can still render for add-ons that
  // publish catalog + stream but do not implement the optional meta resource.
  try { ADDON_CATALOG_META_CACHE[url] = meta; } catch (e) {}
  return item;
}

async function _addonCatalogRows(query) {
  var config = _combinedSettings();
  if (!config.useAddonCatalogs || !config.urls.length) return [];
  var groups = await Promise.all(config.urls.map(async function (base) {
    try {
      var manifest = await _addonManifest(base);
      if (!manifest || !Array.isArray(manifest.catalogs)) return [];
      var catalogs = manifest.catalogs.filter(function (catalog) {
        if (!catalog || !catalog.id || !catalog.type) return false;
        var type = String(catalog.type).toLowerCase();
        if (type !== 'movie' && type !== 'series') return false;
        if (query) return Array.isArray(catalog.extra) && catalog.extra.some(function (x) {
          return x && String(x.name).toLowerCase() === 'search';
        });
        return true;
      }).slice(0, 20);
      var rows = await Promise.all(catalogs.map(async function (catalog) {
        try {
          var data = await _json(_catalogEndpoint(base, 'catalog', catalog.type, catalog.id, query));
          var metas = data && Array.isArray(data.metas) ? data.metas : [];
          var items = metas.map(function (meta) { return _catalogItem(meta, base, catalog.type); }).filter(Boolean);
          return items.length ? { title: (manifest.name ? manifest.name + ' · ' : '') + (catalog.name || catalog.id), items: items } : null;
        } catch (e) { return null; }
      }));
      return rows.filter(Boolean);
    } catch (e) { return []; }
  }));
  return groups.reduce(function (all, rows) { return all.concat(rows || []); }, []);
}

function _parseAddonItem(value) {
  var match = String(value || '').match(/^stremio-addon:\/\/([^/]+)\/([^/]+)\/(.+)$/i);
  if (!match) return null;
  try {
    var type = decodeURIComponent(match[2]).toLowerCase();
    if (type === 'tv') type = 'series';
    if (type !== 'movie' && type !== 'series') return null;
    return { base: decodeURIComponent(match[1]), type: type, id: decodeURIComponent(match[3]), url: String(value) };
  } catch (e) { return null; }
}

function _addonCanonicalIds(meta, fallbackId) {
  meta = meta || {};
  var rawId = String(meta.id || fallbackId || ''), external = meta.external_ids || meta.externalIds || {}, ids = meta.ids || {};
  function first(values) { for (var i = 0; i < values.length; i++) if (values[i] != null && String(values[i]).trim()) return String(values[i]).trim(); return ''; }
  var imdb = first([meta.imdb_id, meta.imdbId, external.imdb_id, external.imdbId, ids.imdb]);
  var tmdb = first([meta.moviedb_id, meta.tmdb_id, meta.tmdbId, external.tmdb_id, external.tmdbId, ids.tmdb]);
  var tvdb = first([meta.tvdb_id, meta.tvdbId, meta.theTVDBId, external.tvdb_id, external.tvdbId, ids.tvdb, ids.tvdb_id]);
  var mal = first([meta.mal_id, meta.malId, meta.myanimelist_id, external.mal_id, external.malId, ids.mal, ids.myanimelist, ids.myanimelist_id]);
  var anilist = first([meta.anilist_id, meta.anilistId, external.anilist_id, external.anilistId, ids.anilist]);
  var kitsu = first([meta.kitsu_id, meta.kitsuId, external.kitsu_id, external.kitsuId, ids.kitsu]);
  var anidb = first([meta.anidb_id, meta.anidbId, external.anidb_id, external.anidbId, ids.anidb]);
  if (!imdb && /^tt\d+$/i.test(rawId)) imdb = rawId;
  if (!tmdb) { var m = rawId.match(/^(?:tmdb:)?(?:movie|tv|series):(\d+)$/i) || rawId.match(/^tmdb:(\d+)$/i); if (m) tmdb = m[1]; }
  var native = rawId.match(/^(mal|myanimelist|anilist|kitsu|anidb|tvdb)[:-](\d+)$/i);
  if (native) {
    var ns = native[1].toLowerCase();
    if ((ns === 'mal' || ns === 'myanimelist') && !mal) mal = native[2];
    else if (ns === 'anilist' && !anilist) anilist = native[2];
    else if (ns === 'kitsu' && !kitsu) kitsu = native[2];
    else if (ns === 'anidb' && !anidb) anidb = native[2];
    else if (ns === 'tvdb' && !tvdb) tvdb = native[2];
  }
  return { imdbId: imdb || null, tmdbId: tmdb || null, tvdbId: tvdb || null, malId: mal || null, anilistId: anilist || null, kitsuId: kitsu || null, anidbId: anidb || null };
}

function _addonDetail(parsed) {
  var catalogMeta = ADDON_CATALOG_META_CACHE[parsed.url] || null;
  return _addonManifest(parsed.base).then(function (manifest) {
    if (!manifest || !Array.isArray(manifest.resources)) return null;
    var supportsMeta = manifest.resources.some(function (resource) {
      return resource === 'meta' || (resource && resource.name === 'meta' &&
        (!Array.isArray(resource.types) || resource.types.indexOf(parsed.type) >= 0) &&
        (!Array.isArray(resource.idPrefixes) || resource.idPrefixes.some(function (prefix) { return parsed.id.indexOf(String(prefix)) === 0; })));
    });
    if (!supportsMeta) return null;
    return _json(_catalogEndpoint(parsed.base, 'meta', parsed.type, parsed.id)).then(function (data) {
      var meta = data && (data.meta || data);
      if (!meta || !(meta.name || meta.title || (meta.aliases && meta.aliases[0]))) return null;
      var ids = _addonCanonicalIds(meta, parsed.id);
      var type = String(meta.type || parsed.type).toLowerCase();
      var isTv = type === 'tv' || type === 'series' || parsed.type === 'series';
      var name = String(meta.name || meta.title || (meta.aliases && meta.aliases[0]) || 'Untitled');
      var episodes = [];
      if (isTv && Array.isArray(meta.videos)) {
        meta.videos.forEach(function (video, index) {
          if (!video) return;
          var season = parseInt(video.season, 10);
          var episode = parseInt(video.episode, 10);
          var videoId = String(video.id || '');
          if ((!season || !episode) && videoId) {
            var numberMatch = videoId.match(/:(\d+):(\d+)$/) || videoId.match(/[Ss](\d+)[Ee](\d+)/);
            if (numberMatch) { if (!season) season = parseInt(numberMatch[1],10); if (!episode) episode = parseInt(numberMatch[2],10); }
          }
          if (!season || season < 1) season = 1;
          if (!episode || episode < 1) episode = index + 1;
          episodes.push({
            id: String(season) + 'x' + String(episode),
            title: 'S' + _pad(season) + ' E' + _pad(episode) + ' - ' + String(video.title || video.name || ''),
            number: episode, season: season,
            url: _episodeId('tv', Number(ids.tmdbId) || 0, ids.imdbId, season, episode, undefined, ids),
            date: video.released || video.firstAired || video.releaseInfo || null,
            thumbnail: video.thumbnail || null
          });
        });
      } else if (!isTv) {
        episodes.push({ id: 'movie', title: name, number: 1, url: _episodeId('movie', Number(ids.tmdbId) || 0, ids.imdbId, 0, 0, undefined, ids) });
      }
      var genres = Array.isArray(meta.genres) ? meta.genres : (Array.isArray(meta.genre) ? meta.genre : []);
      var result = {
        id: 'stremio-addon://' + encodeURIComponent(parsed.base) + '/' + encodeURIComponent(parsed.type) + '/' + encodeURIComponent(parsed.id),
        url: 'stremio-addon://' + encodeURIComponent(parsed.base) + '/' + encodeURIComponent(parsed.type) + '/' + encodeURIComponent(parsed.id),
        title: name, cover: meta.poster || meta.cover || null,
        banner: meta.background || meta.banner || null, description: meta.description || '',
        status: _status(meta.status), genres: genres, studios: meta.studios || [],
        type: 'movie', sourceId: SOURCE_ID, year: String(meta.releaseInfo || meta.year || meta.release_date || meta.first_air_date || '').slice(0,4) || null,
        imdbId: ids.imdbId, tmdbId: ids.tmdbId, tmdbIsTv: isTv,
        episodes: episodes, subCount: episodes.length, dubCount: 0
      };
      var rating = Number(meta.imdbRating != null ? meta.imdbRating : (meta.rating != null ? meta.rating : meta.score));
      if (isFinite(rating)) result.score = Math.round(rating > 10 ? rating : rating * 10);
      return result;
    });
  }).catch(function () { return null; }).then(function (detail) {
    return detail || _addonFallbackDetail(parsed, catalogMeta);
  });
}


function _addonFallbackDetail(parsed, catalogMeta) {
  var meta = catalogMeta || {};
  var ids = _addonCanonicalIds(meta, parsed.id);
  if (!ids.imdbId && /^tt\d+$/i.test(String(parsed.id || ''))) ids.imdbId = String(parsed.id);
  var mediaType = parsed.type === 'series' ? 'tv' : 'movie';

  function withPreview(detail) {
    if (!detail) return _addonPreviewDetail(parsed, meta, ids);
    var title = _trim(meta.name || meta.title || (meta.aliases && meta.aliases[0]) || '');
    if (title) detail.title = title;
    if (meta.poster || meta.cover) detail.cover = meta.poster || meta.cover;
    if (meta.background || meta.banner) detail.banner = meta.background || meta.banner;
    if (meta.description) detail.description = meta.description;
    var year = String(meta.releaseInfo || meta.year || meta.release_date || meta.first_air_date || '').slice(0, 4);
    if (year) detail.year = year;
    var genres = Array.isArray(meta.genres) ? meta.genres : (Array.isArray(meta.genre) ? meta.genre : null);
    if (genres && genres.length) detail.genres = genres;
    var score = Number(meta.imdbRating != null ? meta.imdbRating : (meta.rating != null ? meta.rating : meta.score));
    if (isFinite(score)) detail.score = Math.round(score > 10 ? score : score * 10);
    if (mediaType === 'movie' && Array.isArray(detail.episodes) && detail.episodes.length && title) {
      detail.episodes[0].title = title;
    }
    return detail;
  }

  if (ids.tmdbId && isFinite(Number(ids.tmdbId))) {
    return getDetail(_tmdbUrl(mediaType, ids.tmdbId)).then(withPreview);
  }

  if (!ids.imdbId) return Promise.resolve(_addonPreviewDetail(parsed, meta, ids));

  return _tmdbJson('/find/' + encodeURIComponent(ids.imdbId) + '?external_source=imdb_id').then(function (found) {
    if (found) {
      var wanted = mediaType === 'tv' ? found.tv_results : found.movie_results;
      var alternate = mediaType === 'tv' ? found.movie_results : found.tv_results;
      var record = Array.isArray(wanted) && wanted.length ? wanted[0] :
        (Array.isArray(alternate) && alternate.length ? alternate[0] : null);
      if (record && record.id != null) {
        var actualType = Array.isArray(wanted) && wanted.length ? mediaType : (mediaType === 'tv' ? 'movie' : 'tv');
        return getDetail(_tmdbUrl(actualType, record.id)).then(withPreview);
      }
    }
    return _addonPreviewDetail(parsed, meta, ids);
  }).catch(function () {
    return _addonPreviewDetail(parsed, meta, ids);
  });
}

function _addonPreviewDetail(parsed, meta, ids) {
  meta = meta || {};
  ids = ids || _addonCanonicalIds(meta, parsed.id);
  var isTv = parsed.type === 'series';
  var title = _trim(meta.name || meta.title || (meta.aliases && meta.aliases[0]) || parsed.id || 'Untitled');
  var episodes = [];
  if (!isTv) {
    episodes.push({
      id: 'movie',
      title: title,
      number: 1,
      url: _episodeId('movie', Number(ids.tmdbId) || 0, ids.imdbId, 0, 0, undefined, ids)
    });
  }
  return {
    id: parsed.url || ('stremio-addon://' + encodeURIComponent(parsed.base) + '/' + encodeURIComponent(parsed.type) + '/' + encodeURIComponent(parsed.id)),
    url: parsed.url || ('stremio-addon://' + encodeURIComponent(parsed.base) + '/' + encodeURIComponent(parsed.type) + '/' + encodeURIComponent(parsed.id)),
    title: title,
    cover: meta.poster || meta.cover || null,
    banner: meta.background || meta.banner || null,
    description: meta.description || '',
    status: _status(meta.status),
    genres: Array.isArray(meta.genres) ? meta.genres : (Array.isArray(meta.genre) ? meta.genre : []),
    studios: meta.studios || [],
    type: 'movie',
    sourceId: SOURCE_ID,
    year: String(meta.releaseInfo || meta.year || meta.release_date || meta.first_air_date || '').slice(0, 4) || null,
    imdbId: ids.imdbId || null,
    tmdbId: ids.tmdbId || null,
    tmdbIsTv: isTv,
    episodes: episodes,
    subCount: episodes.length,
    dubCount: 0
  };
}

function getHome(opts) {
  var addonRows = _addonCatalogRows(null);
  return addonRows.then(function (rows) {
    if (rows.length) return rows;
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
  return _addonCatalogRows(q).then(function (rows) {
    var items = [], seen = {};
    rows.forEach(function (row) { (row.items || []).forEach(function (item) { if (item && !seen[item.id]) { seen[item.id] = true; items.push(item); } }); });
    if (items.length) return items;
    return _tmdbJson('/search/multi?query=' + encodeURIComponent(q) + '&page=' + p)
      .then(function (json) { return _mapResults(json, null); });
  });
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
  // An empty object from append_to_response is still a complete result and
  // must not trigger a redundant second request for external IDs.
  var embedded = detail && detail.external_ids;
  if (embedded && typeof embedded === 'object' && !Array.isArray(embedded)) return Promise.resolve(embedded);
  var path = type === 'tv' ? '/tv/' + id + '/external_ids' : '/movie/' + id + '/external_ids';
  return _tmdbJson(path).then(function (json) { return json && typeof json === 'object' ? json : {}; });
}

function _pad(value) {
  var n = parseInt(value, 10) || 0;
  return n < 10 ? '0' + n : String(n);
}

function _episodeId(type, id, imdbId, season, episode, absoluteEpisode, externalIds) {
  var numericId = Number(id), validTmdbId = isFinite(numericId) && numericId > 0 ? numericId : undefined;
  var identity = externalIds || {}, nested = identity.ids || {};
  function first(values) { for (var i = 0; i < values.length; i++) if (values[i] != null && String(values[i]).trim()) return String(values[i]).trim(); return undefined; }
  var result = { id: _tmdbUrl(type, validTmdbId || 0), videoId: _tmdbUrl(type, validTmdbId || 0), type: type === 'tv' ? 'series' : 'movie', tmdbId: validTmdbId, tmdbIsTv: type === 'tv', imdbId: first([imdbId, identity.imdb_id, identity.imdbId, nested.imdb]), season: season || 0, episode: episode || 0, absoluteEpisode: absoluteEpisode || undefined };
  [
    ['tvdbId', [identity.tvdbId, identity.tvdb_id, identity.thetvdb_id, nested.tvdb, nested.tvdb_id]],
    ['malId', [identity.malId, identity.mal_id, identity.myanimelist_id, nested.mal, nested.myanimelist, nested.myanimelist_id]],
    ['anilistId', [identity.anilistId, identity.anilist_id, nested.anilist]],
    ['kitsuId', [identity.kitsuId, identity.kitsu_id, nested.kitsu]],
    ['anidbId', [identity.anidbId, identity.anidb_id, nested.anidb]]
  ].forEach(function (entry) { var value = first(entry[1]); if (value) result[entry[0]] = value; });
  return JSON.stringify(result);
}

function _mapWithConcurrency(items, limit, mapper) {
  var results = new Array(items.length), nextIndex = 0, workerCount = Math.min(items.length, Math.max(1, Number(limit) || 1));
  function worker() {
    if (nextIndex >= items.length) return Promise.resolve();
    var index = nextIndex++;
    return Promise.resolve().then(function () { return mapper(items[index], index); }).then(function (v) { results[index] = v; return worker(); }, function () { results[index] = null; return worker(); });
  }
  var workers = []; for (var i = 0; i < workerCount; i++) workers.push(worker());
  return Promise.all(workers).then(function () { return results; });
}
function _tvEpisodes(id, imdbId, seasonCount, externalIds) {
  var count = Math.min(Math.max(1, parseInt(seasonCount, 10) || 1), 40), jobs = [];
  for (var season = 1; season <= count; season++) jobs.push(season);
  return _mapWithConcurrency(jobs, 5, function (seasonNumber) {
    return _tmdbJson('/tv/' + id + '/season/' + seasonNumber).then(function (json) { return { season: seasonNumber, episodes: json && Array.isArray(json.episodes) ? json.episodes : [] }; });
  }).then(function (seasons) {
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
          url: _episodeId('tv', id, imdbId, seasonNumber, relativeNumber, absoluteNumber, externalIds),
          date: episode.air_date || null,
          thumbnail: episode.still_path ? 'https://image.tmdb.org/t/p/w300' + episode.still_path : null
        });
      });
    });
    return out;
  });
}

function getDetail(url, opts) {
  var addonItem = _parseAddonItem(url);
  if (addonItem && _combinedSettings().useAddonCatalogs) {
    return _addonDetail(addonItem).then(function (detail) {
      if (detail) return detail;
      var ids = _addonCanonicalIds({ id: addonItem.id }, addonItem.id);
      if (ids.tmdbId && isFinite(Number(ids.tmdbId))) return getDetail(_tmdbUrl(addonItem.type === 'series' ? 'tv' : 'movie', ids.tmdbId), opts);
      return null;
    });
  }
  var parsed = _parseTmdbUrl(url);
  if (!parsed) return Promise.resolve(null);
  var id = parsed.id;
  var type = parsed.type;
  var path = type === 'tv'
    ? '/tv/' + id + '?append_to_response=external_ids'
    : '/movie/' + id + '?append_to_response=external_ids';
  return _tmdbJson(path).then(function (info) {
    if (!info || info.success === false || info.id == null) return null;
    return _externalIds(type, id, info).then(function (externalIds) {
      var imdbId = externalIds && (externalIds.imdb_id || externalIds.imdbId) || null;
      var title = _trim(info.title || info.name || 'Untitled');
      var year = _year(info);
      var genres = (info.genres || []).map(function (genre) { return genre && genre.name; }).filter(Boolean);
      var episodes;
      if (type === 'tv') {
        return _tvEpisodes(id, imdbId, info.number_of_seasons || (info.seasons || []).length || 1, externalIds).then(function (tvEpisodes) {
          episodes = tvEpisodes;
          return _detailResult();
        });
      }
      episodes = [{
        id: 'movie',
        title: title,
        number: 1,
        url: _episodeId('movie', id, imdbId, 0, 0, undefined, externalIds)
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
          tvdbId: externalIds && (externalIds.tvdb_id || externalIds.tvdbId) || null,
          malId: externalIds && (externalIds.mal_id || externalIds.malId) || null,
          anilistId: externalIds && (externalIds.anilist_id || externalIds.anilistId) || null,
          kitsuId: externalIds && (externalIds.kitsu_id || externalIds.kitsuId) || null,
          anidbId: externalIds && (externalIds.anidb_id || externalIds.anidbId) || null,
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
  var parts = source.split(/(?:[;\r\n]+|,(?=\s*(?:https?:\/\/|stremio:\/\/)))/i);
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
  if (!item) { var value = String(raw || ''); if (value.charAt(0) === '{') { try { item = JSON.parse(value); } catch (e) {} } if (!item) item = { id: value }; }
  var originalId = String(item.videoId || item.id || '');
  var routeMatch = originalId.match(/^zm:\/\/(anime|movie|tv|series)\/([^/?#]+)/i);
  var tmdbRoute = originalId.match(/^(?:tmdb|torbox):\/\/(movie|tv|series)\/(\d+)(?:\/season\/(\d+))?(?:\/(?:ep|episode)\/(\d+))?/i);
  var kind = String(item.type || (item.season || item.episode ? 'series' : '')).toLowerCase(), id = originalId;
  if (routeMatch) { id = routeMatch[2]; var rk=routeMatch[1].toLowerCase(); if (rk==='anime'||rk==='tv'||rk==='series') kind='series'; else if(!kind)kind='movie'; }
  else if(tmdbRoute) kind=tmdbRoute[1].toLowerCase()==='movie'?'movie':'series';
  var type = kind==='series'||kind==='tv'||kind==='anime'?'series':'movie';
  var season = parseInt(item.season,10)||(tmdbRoute&&parseInt(tmdbRoute[3],10))||0, episode=parseInt(item.episode,10)||(tmdbRoute&&parseInt(tmdbRoute[4],10))||0;
  var routeEpisode=originalId.match(/\/(?:ep|episode)\/(\d+)/i);
  if(!episode&&routeEpisode)episode=parseInt(routeEpisode[1],10)||0;
  if(!season&&episode>0&&type==='series'&&routeMatch&&routeMatch[1].toLowerCase()==='anime')season=1;
  var external=item.externalIds||item.external_ids||{}, nested=item.ids||external.ids||{};
  var imdb=item.imdbId||item.imdb_id||external.imdb_id||external.imdbId||nested.imdb||'';
  var tmdb=item.tmdbId||item.tmdb_id||item.moviedb_id||external.tmdb_id||external.tmdbId||nested.tmdb||(tmdbRoute&&Number(tmdbRoute[2])>0?tmdbRoute[2]:null)||null;
  var tvdb=item.tvdbId||item.tvdb_id||item.thetvdb_id||external.tvdb_id||external.tvdbId||nested.tvdb||nested.tvdb_id||null;
  var mal=item.malId||item.mal_id||item.myanimelist_id||external.mal_id||external.malId||nested.mal||nested.myanimelist||nested.myanimelist_id||null;
  var anilist=item.anilistId||item.anilist_id||external.anilist_id||external.anilistId||nested.anilist||null;
  var kitsu=item.kitsuId||item.kitsu_id||external.kitsu_id||external.kitsuId||nested.kitsu||null;
  var anidb=item.anidbId||item.anidb_id||external.anidb_id||external.anidbId||nested.anidb||null;
  var ids=[],seen={};
  function add(v){v=String(v==null?'':v).trim();if(v&&!seen[v]){seen[v]=true;ids.push(v);}}
  function addIdentity(ns,v){
    var clean=String(v==null?'':v).trim().replace(new RegExp('^'+ns+'[:-]','i'),'');if(!clean)return;
    if(type==='series'&&episode>0){add(ns+':'+clean+':'+episode);if(season>0)add(ns+':'+clean+':'+season+':'+episode);if(ns==='mal'||ns==='anilist'){add(ns+'-'+clean+':'+episode);if(season>0)add(ns+'-'+clean+':'+season+':'+episode);}}
    add(ns+':'+clean);if(ns==='mal'||ns==='anilist')add(ns+'-'+clean);
  }
  var native=id.match(/^(mal|myanimelist|anilist|kitsu|anidb|tvdb)[:-](\d+)(?::\d+){0,2}$/i);
  if(!routeMatch&&!tmdbRoute&&!/^tmdb:\/\/(?:movie|tv|series)\//i.test(originalId))add(originalId);
  if(native&&(routeMatch||(type==='series'&&episode>0)))addIdentity(native[1].toLowerCase()==='myanimelist'?'mal':native[1].toLowerCase(),native[2]);
  // Never infer missing anime IDs from a TMDB number.
  if(mal)addIdentity('mal',mal);if(anilist)addIdentity('anilist',anilist);if(kitsu)addIdentity('kitsu',kitsu);if(anidb)addIdentity('anidb',anidb);
  if(imdb){if(type==='series'&&season>0&&episode>0)add(String(imdb)+':'+season+':'+episode);add(imdb);}
  if(tvdb){if(type==='series'&&season>0&&episode>0)add('tvdb:'+String(tvdb)+':'+season+':'+episode);add('tvdb:'+String(tvdb));}
  if(tmdb){var n=String(tmdb);if(/^\d+$/.test(n)){add(n);add('tmdb:'+(type==='series'?'series':'movie')+':'+n);if(type==='series'&&season>0&&episode>0)add('tmdb:series:'+n+':'+season+':'+episode);}else add(n);}
  return {ids:ids,type:type};
}

function _validMagnetUrl(url) {
  if (!/^magnet:\?/i.test(url)) return false;
  return url.substring(url.indexOf('?')+1).split('&').some(function (part) { return /^xt=urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(part); });
}
function _stream(raw, base, config) {
  if(!raw||typeof raw!=='object')return null;config=config||{};
  var rawUrl=typeof raw.url==='string'?raw.url.trim():'',url='',torrent=false;
  if(/^https?:\/\//i.test(rawUrl))url=rawUrl;
  else if(/^magnet:\?/i.test(rawUrl)){if(!config.showP2P||!_validMagnetUrl(rawUrl))return null;url=rawUrl;torrent=true;}
  else if(config.showP2P){var hash=String(raw.infoHash||raw.info_hash||raw.btih||'').trim();if(!/^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i.test(hash))return null;url='magnet:?xt=urn:btih:'+hash;torrent=true;}
  else return null;
  var text=String(raw.name||'')+' '+String(raw.title||'')+' '+String(raw.description||''),q=text.match(/(2160p|4k|1080p|720p|480p|360p)/i);
  var container=torrent?'torrent':(/\.m3u8(?:[?#]|$)/i.test(url)?'hls':/\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(url)?'mp4':'unknown');
  var headers=!torrent&&raw.behaviorHints&&raw.behaviorHints.proxyHeaders&&raw.behaviorHints.proxyHeaders.request&&typeof raw.behaviorHints.proxyHeaders.request==='object'?raw.behaviorHints.proxyHeaders.request:{};
  return {url:url,quality:q?(q[1].toLowerCase()==='4k'?'2160p':q[1]):'Auto',label:(raw.name||'Stremio')+(raw.title?' · '+raw.title:''),container:container,headers:headers,kind:'raw'};
}
function _addonManifest(base){
  var cached=ADDON_MANIFEST_CACHE[base],now=Date.now();
  if(cached&&cached.manifest&&now-cached.at<300000)return Promise.resolve(cached.manifest);
  return _json(_manifestUrl(base)).then(function(manifest){ADDON_MANIFEST_CACHE[base]={at:Date.now(),manifest:manifest};return manifest;}).catch(function(error){delete ADDON_MANIFEST_CACHE[base];throw error;});
}
function _streamResourceSupports(manifest,type,id){
  if(!manifest||!Array.isArray(manifest.resources))return true;
  for(var i=0;i<manifest.resources.length;i++){
    var r=manifest.resources[i],name=typeof r==='string'?r:(r&&r.name);if(name!=='stream')continue;
    var types=r&&typeof r==='object'&&Array.isArray(r.types)?r.types:manifest.types;
    if(Array.isArray(types)&&types.length&&types.indexOf(type)<0)continue;
    var prefixes=r&&typeof r==='object'&&Array.isArray(r.idPrefixes)?r.idPrefixes:manifest.idPrefixes;
    if(Array.isArray(prefixes)&&prefixes.length&&!prefixes.some(function(p){return String(id).indexOf(String(p))===0;}))continue;
    return true;
  }return false;
}
function _queryAddonIds(base,type,ids,manifest,config){
  var supported=ids.filter(function(id){return _streamResourceSupports(manifest,type,id);});if(!supported.length)return Promise.resolve([]);
  function query(candidates){return Promise.all(candidates.map(function(id){return _json(_streamEndpoint(base,type,id)).then(function(data){var streams=data&&Array.isArray(data.streams)?data.streams:[];return streams.map(function(x){return _stream(x,base,config);}).filter(Boolean);}).catch(function(){return[];});})).then(function(lists){var out=[],seen={};lists.forEach(function(list){list.forEach(function(x){if(!seen[x.url]&&out.length<config.max){seen[x.url]=true;out.push(x);}});});return out;});}
  var preferred=supported.slice(0,2),fallback=supported.slice(2);return query(preferred).then(function(rows){return rows.length||!fallback.length?rows:query(fallback);});
}
function getVideoSources(episodeUrl,opts){
  var config=_combinedSettings();if(!config.urls.length)return Promise.resolve([]);
  var parsed=_parseStreamId(episodeUrl);if(!parsed.ids.length)return Promise.resolve([]);
  return Promise.all(config.urls.map(function(base){return _addonManifest(base).then(function(manifest){if(!parsed.ids.some(function(id){return _streamResourceSupports(manifest,parsed.type,id);}))return[];return _queryAddonIds(base,parsed.type,parsed.ids,manifest,config);}).catch(function(){return[];});})).then(function(lists){var out=[],seen={};lists.forEach(function(list){list.forEach(function(x){if(!seen[x.url]){seen[x.url]=true;out.push(x);}});});return out;});
}


function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '3.2.1',
    getInfo: getInfo, getSettings: getSettings, getHome: getHome,
    popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources,
    getStreams: getStreams, getLinks: getLinks,
    _item: _item, _parseTmdbUrl: _parseTmdbUrl, _episodeId: _episodeId,
    _combinedSettings: _combinedSettings, _tmdbRequestUrl: _tmdbRequestUrl,
    _parseAddonUrls: _parseAddonUrls, _manifestUrl: _manifestUrl,
    _parseStreamId: _parseStreamId, _stream: _stream
  };
}
