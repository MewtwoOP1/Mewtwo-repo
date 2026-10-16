// Stremio addon bridge for Zangetsu.
// Version 1.2.0. User-configurable metadata and streaming add-ons.
// Addon URLs are provided by each user. No catalog provider is hardcoded.

var BRIDGE_VERSION = '1.2.0';
var SOURCE_SETTINGS = [
  {
    key: 'metadataAddonUrls',
    id: 'metadataAddonUrls',
    title: 'Metadata Add-on Manifest URLs',
    label: 'Metadata add-ons',
    description: 'Add Stremio add-ons that provide catalogs and searchable metadata. Paste manifest.json URLs, separated by commas or new lines. No TMDB API key is required by this bridge.',
    type: 'text',
    default: ''
  },
  {
    key: 'addonUrls',
    id: 'addonUrls',
    title: 'Stream Add-on Manifest URLs',
    label: 'Stream add-ons',
    description: 'Add Stremio add-ons that provide playable streams. A combined add-on can be entered in both fields.',
    type: 'text',
    default: ''
  },
  {
    key: 'maxStreamsPerAddon',
    id: 'maxStreamsPerAddon',
    title: 'Maximum streams per add-on',
    label: 'Maximum streams per add-on',
    description: 'Limit the number of streams read from each configured add-on.',
    type: 'number',
    default: 25
  },
  {
    key: 'includeTorrentStreams',
    id: 'includeTorrentStreams',
    title: 'Include torrent-only results',
    label: 'Include torrent-only results',
    description: 'Keep results that contain an infoHash but no direct HTTP stream URL.',
    type: 'toggle',
    default: false
  }
];

function getInfo() {
  return {
    id: 'stremio-bridge',
    name: 'Stremio Bridge (Bring Your Own Addons)',
    version: BRIDGE_VERSION,
    type: 'movie',
    lang: 'en',
    description: 'Uses user-configured Stremio-compatible add-ons.'
  };
}

function getSettings() { return SOURCE_SETTINGS; }
function getPreferences() { return SOURCE_SETTINGS; }

function _trim(value) {
  return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function _addonBase(raw) {
  var value = _trim(raw);
  if (!value) return '';
  value = value.replace(/^stremio:\/\//i, 'https://').replace(/#.*$/, '');
  if (!/^https?:\/\//i.test(value)) return '';
  var query = '';
  var queryAt = value.indexOf('?');
  if (queryAt >= 0) {
    query = value.substring(queryAt + 1);
    value = value.substring(0, queryAt);
  }
  value = value.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
  return value + (query ? '::zangetsu-query::' + query : '');
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

function _manifestUrl(base) {
  var parts = _addonParts(base);
  return parts.root + '/manifest.json' + (parts.query ? '?' + parts.query : '');
}

function _parseAddonUrls(raw) {
  var source = String(raw || '');
  var parts = [], token = '';
  var urls = [], seen = {};
  for (var i = 0; i < source.length; i++) {
    var ch = source.charAt(i);
    var code = source.charCodeAt(i);
    if (ch === ',' || ch === ';' || code === 10 || code === 13) {
      parts.push(token);
      token = '';
    } else {
      token += ch;
    }
  }
  parts.push(token);
  for (var j = 0; j < parts.length; j++) {
    var base = _addonBase(parts[j]);
    if (base && !seen[base]) { seen[base] = true; urls.push(base); }
  }
  return urls;
}

function _readSetting(opts, key) {
  var value = opts && opts[key];
  if (value == null && typeof getSetting === 'function') {
    try { value = getSetting(key); } catch (e) { value = ''; }
  }
  return value;
}

function _settings(opts) {
  var streamUrls = _parseAddonUrls(_readSetting(opts, 'addonUrls'));
  var metadataUrls = _parseAddonUrls(_readSetting(opts, 'metadataAddonUrls'));
  // Backward compatibility: combined add-ons entered in the old field may
  // also expose catalogs and metadata. Dedicated metadata URLs take priority.
  if (!metadataUrls.length) metadataUrls = streamUrls.slice(0);

  var max = parseInt(_readSetting(opts, 'maxStreamsPerAddon'), 10);
  if (!max || max < 1) max = 25;
  if (max > 100) max = 100;
  var includeValue = _readSetting(opts, 'includeTorrentStreams');
  var includeTorrent = includeValue === true || String(includeValue).toLowerCase() === 'true';
  return {
    metadataUrls: metadataUrls,
    streamUrls: streamUrls,
    urls: streamUrls,
    max: max,
    includeTorrent: includeTorrent
  };
}

function _fetchJson(url) {
  return fetch(url, { headers: { Accept: 'application/json' } }).then(function (response) {
    if (response && response.status && response.status >= 400) {
      throw new Error('HTTP ' + response.status);
    }
    if (response && typeof response.json === 'function') return response.json();
    var body = response && response.body != null ? response.body : response;
    return typeof body === 'string' ? JSON.parse(body) : body;
  });
}

function _endpoint(base, resource, type, id, extra) {
  var parts = _addonParts(base);
  var cleanBase = parts.root;
  if (cleanBase.charAt(cleanBase.length - 1) === '/') {
    cleanBase = cleanBase.substring(0, cleanBase.length - 1);
  }
  var path = cleanBase + '/' + resource + '/' +
    encodeURIComponent(type) + '/' + encodeURIComponent(id);
  if (extra) path += '/' + extra;
  path += '.json';
  if (parts.query) path += '?' + parts.query;
  return path;
}

function _toCard(meta) {
  if (!meta || !meta.id) return null;
  var type = meta.type === 'series' ? 'series' : 'movie';
  var rawId = String(meta.id);
  var tmdbId = meta.moviedb_id || meta.tmdbId || meta.tmdb_id || null;
  var imdbId = meta.imdb_id || meta.imdbId || (rawId.indexOf('tt') === 0 ? rawId : null);
  return {
    id: JSON.stringify({
      id: rawId,
      type: type,
      tmdbId: tmdbId ? Number(tmdbId) : undefined,
      imdbId: imdbId || undefined
    }),
    title: meta.name || meta.title || 'Untitled',
    cover: meta.poster || null,
    poster: meta.poster || null,
    url: rawId,
    type: type,
    year: meta.releaseInfo || meta.year || null,
    description: meta.description || '',
    sourceId: 'stremio-bridge'
  };
}

function _allSettled(promises) {
  return Promise.all(promises.map(function (p) {
    return Promise.resolve(p).then(function (value) {
      return { ok: true, value: value };
    }, function (error) {
      return { ok: false, error: error };
    });
  }));
}

function getHome(opts) {
  var config = _settings(opts);
  if (!config.metadataUrls.length) return Promise.resolve([]);
  var tasks = config.metadataUrls.map(function (base) {
    return _fetchJson(_manifestUrl(base)).then(function (manifest) {
      var catalogs = manifest && manifest.catalogs ? manifest.catalogs : [];
      return Promise.all(catalogs.slice(0, 12).map(function (catalog) {
        if (!catalog || !catalog.id) return null;
        var type = catalog.type || 'movie';
        if (type !== 'movie' && type !== 'series') return null;
        var extra = catalog.extra || [];
        for (var i = 0; i < extra.length; i++) {
          if (extra[i] && extra[i].isRequired === true) return null;
        }
        return _fetchJson(_endpoint(base, 'catalog', type, catalog.id, '')).then(function (data) {
          var metas = data && data.metas ? data.metas : [];
          return {
            title: (manifest.name || 'Metadata Add-on') + ' · ' + (catalog.name || catalog.id),
            items: metas.map(_toCard).filter(Boolean)
          };
        }).catch(function () { return null; });
      }));
    }).catch(function () { return []; });
  });
  return _allSettled(tasks).then(function (settled) {
    var rows = [];
    settled.forEach(function (r) {
      if (r.ok && Array.isArray(r.value)) {
        r.value.forEach(function (row) { if (row && row.items && row.items.length) rows.push(row); });
      }
    });
    return rows;
  });
}

function search(query, page, opts) {
  var q = _trim(query);
  var config = _settings(opts);
  if (!q || !config.metadataUrls.length) return Promise.resolve([]);
  var skip = Math.max(0, ((parseInt(page, 10) || 1) - 1) * 100);
  var jobs = config.metadataUrls.map(function (base) {
    return _fetchJson(_manifestUrl(base)).then(function (manifest) {
      var catalogs = (manifest && manifest.catalogs) || [];
      var searches = catalogs.filter(function (catalog) {
        if (!catalog || !catalog.id || !catalog.extra) return false;
        return catalog.extra.some(function (extra) { return extra && extra.name === 'search'; });
      }).slice(0, 12);
      return Promise.all(searches.map(function (catalog) {
        var extra = 'search=' + encodeURIComponent(q);
        if (skip > 0) extra += '&skip=' + skip;
        return _fetchJson(_endpoint(base, 'catalog', catalog.type || 'movie', catalog.id, extra))
          .then(function (data) {
            return (data && data.metas ? data.metas : []).map(_toCard).filter(Boolean);
          })
          .catch(function () { return []; });
      })).then(function (lists) {
        return lists.reduce(function (all, list) { return all.concat(list); }, []);
      });
    }).catch(function () { return []; });
  });
  return _allSettled(jobs).then(function (settled) {
    var out = [], seen = {};
    settled.forEach(function (r) {
      if (!r.ok) return;
      (r.value || []).forEach(function (item) {
        var key = item.id;
        if (!seen[key]) { seen[key] = true; out.push(item); }
      });
    });
    return out;
  });
}

function _parseId(raw) {
  if (raw && typeof raw === 'object') return raw;
  var value = String(raw || '');
  try { if (value.charAt(0) === '{') return JSON.parse(value); } catch (e) {}
  return { id: value, type: 'movie' };
}

function getDetail(rawId, opts) {
  var item = _parseId(rawId);
  var id = item.id || item.videoId;
  var type = item.type || 'movie';
  var config = _settings(opts);
  if (!id || !config.metadataUrls.length) return Promise.resolve(null);
  var jobs = config.metadataUrls.map(function (base) {
    return _fetchJson(_endpoint(base, 'meta', type, id, '')).then(function (data) {
      if (data && data.meta) return data.meta;
      if (data && Array.isArray(data.metas) && data.metas.length) return data.metas[0];
      return null;
    }).catch(function () { return null; });
  });
  return Promise.all(jobs).then(function (metas) {
    var meta = null;
    for (var i = 0; i < metas.length; i++) if (metas[i]) { meta = metas[i]; break; }
    if (!meta) return null;
    var series = (meta.type || type) === 'series';
    var tmdbId = meta.moviedb_id || meta.tmdbId || meta.tmdb_id || item.tmdbId || null;
    var imdbId = meta.imdb_id || meta.imdbId || item.imdbId ||
      (String(meta.id || id).indexOf('tt') === 0 ? String(meta.id || id) : null);
    var episodes = [];
    if (series && Array.isArray(meta.videos)) {
      meta.videos.forEach(function (video, index) {
        episodes.push({
          id: JSON.stringify({
            type: 'series',
            videoId: video.id || id,
            season: video.season || 1,
            episode: video.episode || video.number || index + 1,
            imdbId: imdbId || undefined,
            tmdbId: tmdbId ? Number(tmdbId) : undefined
          }),
          title: video.name || video.title || ('Episode ' + (index + 1)),
          number: video.episode || video.number || index + 1,
          season: video.season || 1
        });
      });
    } else {
      episodes.push({
        id: JSON.stringify({
          type: 'movie',
          videoId: meta.id || id,
          imdbId: imdbId || undefined,
          tmdbId: tmdbId ? Number(tmdbId) : undefined
        }),
        title: meta.name || meta.title || 'Full Movie',
        number: 1
      });
    }
    var result = {
      id: JSON.stringify({
        id: meta.id || id,
        type: series ? 'series' : 'movie',
        imdbId: imdbId || undefined,
        tmdbId: tmdbId ? Number(tmdbId) : undefined
      }),
      title: meta.name || meta.title || 'Untitled',
      cover: meta.poster || null,
      poster: meta.poster || null,
      description: meta.description || '',
      type: series ? 'series' : 'movie',
      year: meta.releaseInfo || meta.year || null,
      episodes: episodes,
      sourceId: 'stremio-bridge'
    };
    if (tmdbId) { result.tmdbId = Number(tmdbId); result.tmdbIsTv = series; }
    if (imdbId) result.imdbId = imdbId;
    return result;
  });
}

function _stream(raw, base, config) {
  var addonParts = _addonParts(base);
  var addonSource = addonParts.root + (addonParts.query ? '?' + addonParts.query : '');
  var url = raw && typeof raw.url === 'string' && /^https?:\/\//i.test(raw.url) ? raw.url : '';
  var hash = raw && raw.infoHash ? raw.infoHash : '';
  if (!url && !(config.includeTorrent && hash)) return null;
  var text = String((raw && raw.name) || '') + ' ' + String((raw && raw.title) || '');
  var qualityMatch = text.match(/(2160p|4k|1080p|720p|480p|360p)/i);
  return {
    name: (raw.name || 'Stremio') + (raw.title ? ' · ' + raw.title : ''),
    title: raw.title || raw.description || raw.name || 'Stream',
    url: url || null,
    infoHash: hash || undefined,
    fileIdx: raw.fileIdx,
    quality: qualityMatch ? (qualityMatch[1].toLowerCase() === '4k' ? '2160p' : qualityMatch[1]) : 'Auto',
    headers: raw.behaviorHints && raw.behaviorHints.proxyHeaders && raw.behaviorHints.proxyHeaders.request || {},
    sourceId: 'stremio-bridge',
    addonSource: addonSource
  };
}

function _parseStreamId(raw) {
  var item = _parseId(raw);
  var id = item.videoId || item.id || '';
  var type = item.type || (item.season || item.episode ? 'series' : 'movie');
  var ids = [], seen = {};
  function addId(value) {
    var candidate = String(value == null ? '' : value);
    if (candidate && !seen[candidate]) {
      seen[candidate] = true;
      ids.push(candidate);
    }
  }
  // Prefer the exact catalog/episode ID, then common external IDs when the
  // metadata add-on supplies them. This helps match IDs used by stream add-ons.
  addId(id);
  addId(item.imdbId || item.imdb_id);
  var tmdb = item.tmdbId || item.tmdb_id || item.moviedb_id;
  if (tmdb) {
    addId(String(tmdb));
    addId('tmdb:' + (type === 'series' ? 'series' : 'movie') + ':' + String(tmdb));
  }
  return { id: id, ids: ids, type: type };
}

function getVideoSources(rawEpisodeId, opts) {
  var config = _settings(opts);
  var parsed = _parseStreamId(rawEpisodeId);
  if (!config.streamUrls.length || !parsed.ids.length) return Promise.resolve([]);
  var jobs = [];
  config.streamUrls.forEach(function (base) {
    parsed.ids.forEach(function (streamId) {
      jobs.push(_fetchJson(_endpoint(base, 'stream', parsed.type, streamId, '')).then(function (data) {
        var streams = data && data.streams ? data.streams.slice(0, config.max) : [];
        return streams.map(function (stream) { return _stream(stream, base, config); }).filter(Boolean);
      }).catch(function () { return []; }));
    });
  });
  return Promise.all(jobs).then(function (lists) {
    var out = [], seen = {};
    lists.forEach(function (list) {
      list.forEach(function (stream) {
        var key = stream.url || (stream.infoHash + ':' + stream.fileIdx);
        if (!seen[key]) { seen[key] = true; out.push(stream); }
      });
    });
    return out;
  });
}

function getStreams(id, opts) { return getVideoSources(id, opts); }
function getCatalog(opts) { return getHome(opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getInfo: getInfo, getSettings: getSettings, getPreferences: getPreferences,
    getHome: getHome, search: search, getDetail: getDetail,
    getVideoSources: getVideoSources, getStreams: getStreams,
    getCatalog: getCatalog, getLinks: getLinks,
    _addonBase: _addonBase, _settings: _settings, _endpoint: _endpoint
  };
}
