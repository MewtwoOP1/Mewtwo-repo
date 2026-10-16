// Stremio addon bridge for Zangetsu.
// Version 1.1.0. Uses the Zangetsu JS runtime's fetch/absUrl-compatible style.
// Addon URLs are provided by each user. No catalog provider is hardcoded.

var BRIDGE_VERSION = '1.1.0';
var SOURCE_SETTINGS = [
  {
    key: 'addonUrls',
    id: 'addonUrls',
    title: 'Stremio Add-on Manifest URLs',
    label: 'Manifest URLs',
    description: 'Paste complete manifest.json URLs for your own Stremio add-ons. Separate multiple URLs with commas or new lines.',
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
  value = value.replace(/\/manifest\.json(?:\?.*)?$/i, '').replace(/\/$/, '');
  return value;
}

function _settings(opts) {
  var o = opts || {};
  var raw = o.addonUrls;
  if (raw == null && typeof getSetting === 'function') {
    try { raw = getSetting('addonUrls'); } catch (e) { raw = ''; }
  }
  var parts = String(raw || '').split(/[\n,;]+/);
  var urls = [], seen = {};
  for (var i = 0; i < parts.length; i++) {
    var base = _addonBase(parts[i]);
    if (base && !seen[base]) { seen[base] = true; urls.push(base); }
  }
  var max = parseInt(o.maxStreamsPerAddon, 10);
  if (!max || max < 1) max = 25;
  if (max > 100) max = 100;
  var includeTorrent = o.includeTorrentStreams === true || String(o.includeTorrentStreams).toLowerCase() === 'true';
  return { urls: urls, max: max, includeTorrent: includeTorrent };
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
  var path = base.replace(/\/$/, '') + '/' + resource + '/' +
    encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
  if (extra) path += (path.indexOf('?') >= 0 ? '&' : '?') + extra;
  return path;
}

function _toCard(meta) {
  if (!meta || !meta.id) return null;
  var type = meta.type === 'series' ? 'series' : 'movie';
  return {
    id: JSON.stringify({ id: String(meta.id), type: type, tmdbId: meta.moviedb_id ? Number(meta.moviedb_id) : undefined }),
    title: meta.name || meta.title || 'Untitled',
    cover: meta.poster || null,
    poster: meta.poster || null,
    url: String(meta.id),
    type: type,
    year: meta.releaseInfo || null,
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
  if (!config.urls.length) return Promise.resolve([]);
  var tasks = config.urls.map(function (base) {
    return _fetchJson(base + '/manifest.json').then(function (manifest) {
      var catalogs = manifest && manifest.catalogs ? manifest.catalogs : [];
      return Promise.all(catalogs.slice(0, 8).map(function (catalog) {
        var type = catalog.type || 'movie';
        var id = catalog.id || 'top';
        var extra = '';
        return _fetchJson(_endpoint(base, 'catalog', type, id, extra)).then(function (data) {
          var metas = data && data.metas ? data.metas : [];
          return { title: (manifest.name || 'Stremio Add-on') + ' · ' + (catalog.name || id), items: metas.map(_toCard).filter(Boolean) };
        }).catch(function () { return null; });
      }));
    }).catch(function () { return []; });
  });
  return _allSettled(tasks).then(function (settled) {
    var rows = [];
    settled.forEach(function (r) {
      if (r.ok && Array.isArray(r.value)) r.value.forEach(function (row) { if (row && row.items.length) rows.push(row); });
    });
    return rows;
  });
}

function search(query, page, opts) {
  var q = _trim(query);
  var config = _settings(opts);
  if (!q || !config.urls.length) return Promise.resolve([]);
  var jobs = config.urls.map(function (base) {
    return _fetchJson(base + '/manifest.json').then(function (manifest) {
      var catalogs = (manifest && manifest.catalogs) || [];
      var searches = catalogs.filter(function (c) {
        return c && c.extra && c.extra.some(function (x) { return x.name === 'search'; });
      }).slice(0, 10);
      return Promise.all(searches.map(function (catalog) {
        return _fetchJson(_endpoint(base, 'catalog', catalog.type || 'movie', catalog.id, 'search=' + encodeURIComponent(q)))
          .then(function (data) { return (data && data.metas ? data.metas : []).map(_toCard).filter(Boolean); })
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
  if (!id || !config.urls.length) return Promise.resolve(null);
  var jobs = config.urls.map(function (base) {
    return _fetchJson(_endpoint(base, 'meta', type, id, '')).then(function (data) {
      return data && data.meta ? data.meta : null;
    }).catch(function () { return null; });
  });
  return Promise.all(jobs).then(function (metas) {
    var meta = null;
    for (var i = 0; i < metas.length; i++) if (metas[i]) { meta = metas[i]; break; }
    if (!meta) return null;
    var series = (meta.type || type) === 'series';
    var episodes = [];
    if (series && Array.isArray(meta.videos)) {
      meta.videos.forEach(function (video, index) {
        episodes.push({
          id: JSON.stringify({ type: 'series', videoId: video.id || id, season: video.season || 1, episode: video.episode || video.number || index + 1 }),
          title: video.name || video.title || ('Episode ' + (index + 1)),
          number: video.episode || video.number || index + 1,
          season: video.season || 1
        });
      });
    } else {
      episodes.push({ id: JSON.stringify({ type: 'movie', videoId: meta.id || id }), title: meta.name || 'Full Movie', number: 1 });
    }
    var result = {
      id: JSON.stringify({ id: meta.id || id, type: series ? 'series' : 'movie' }),
      title: meta.name || meta.title || 'Untitled',
      cover: meta.poster || null,
      poster: meta.poster || null,
      description: meta.description || '',
      type: series ? 'series' : 'movie',
      year: meta.releaseInfo || null,
      episodes: episodes,
      sourceId: 'stremio-bridge'
    };
    if (meta.moviedb_id) { result.tmdbId = Number(meta.moviedb_id); result.tmdbIsTv = series; }
    return result;
  });
}

function _stream(raw, base, config) {
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
    addonSource: base
  };
}

function _parseStreamId(raw) {
  var item = _parseId(raw);
  var id = item.videoId || item.id || '';
  var type = item.type || (item.season || item.episode ? 'series' : 'movie');
  return { id: id, type: type };
}

function getVideoSources(rawEpisodeId, opts) {
  var config = _settings(opts);
  var parsed = _parseStreamId(rawEpisodeId);
  if (!config.urls.length || !parsed.id) return Promise.resolve([]);
  var jobs = config.urls.map(function (base) {
    return _fetchJson(_endpoint(base, 'stream', parsed.type, parsed.id, '')).then(function (data) {
      var streams = data && data.streams ? data.streams.slice(0, config.max) : [];
      return streams.map(function (stream) { return _stream(stream, base, config); }).filter(Boolean);
    }).catch(function () { return []; });
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
