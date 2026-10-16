// Stremio stream bridge for Zangetsu.
// Streaming only. Catalogue metadata lives in the separate TMDB Metadata source.
// Configure one or more Stremio-compatible stream add-on manifest URLs here.

var BRIDGE_VERSION = '2.0.0';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'stremio-bridge';

function getInfo() {
  return {
    name: 'Stremio Stream Bridge',
    lang: 'en',
    baseUrl: 'https://www.stremio.com',
    logo: 'https://www.stremio.com/website/stremio-logo-small.png',
    type: 'movie',
    version: BRIDGE_VERSION
  };
}

function getSettings() {
  return [
    {
      key: 'addonUrls',
      label: 'Stream Add-on Manifest URLs',
      type: 'text',
      default: ''
    },
    {
      key: 'maxStreamsPerAddon',
      label: 'Maximum streams per add-on',
      type: 'enum',
      default: '25',
      options: [
        { value: '5', label: '5' },
        { value: '10', label: '10' },
        { value: '25', label: '25' },
        { value: '50', label: '50' },
        { value: '100', label: '100' }
      ]
    },
    {
      key: 'includeTorrentStreams',
      label: 'Include torrent-only results',
      type: 'bool',
      default: false
    }
  ];
}

function _trim(value) {
  return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function _readSetting(key) {
  try {
    var settings = typeof __settings !== 'undefined' && __settings ? __settings[SOURCE_ID] : null;
    return settings && settings[key] != null ? settings[key] : null;
  } catch (e) { return null; }
}

function _parseAddonUrls(raw) {
  var source = String(raw || '');
  var parts = source.split(/[,;\\r\\n]+/);
  var out = [], seen = {};
  for (var i = 0; i < parts.length; i++) {
    var value = _trim(parts[i]);
    if (!value) continue;
    value = value.replace(/^stremio:\/\//i, 'https://').replace(/#.*$/, '');
    if (!/^https?:\/\//i.test(value)) continue;
    value = value.replace(/\/$/, '').replace(/\/manifest\.json$/i, '');
    if (!seen[value]) { seen[value] = true; out.push(value); }
  }
  return out;
}

function _settings() {
  var max = parseInt(_readSetting('maxStreamsPerAddon'), 10);
  if (!max || max < 1) max = 25;
  if (max > 100) max = 100;
  var torrentValue = _readSetting('includeTorrentStreams');
  return {
    urls: _parseAddonUrls(_readSetting('addonUrls')),
    max: max,
    includeTorrent: torrentValue === true || String(torrentValue).toLowerCase() === 'true'
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

function _manifestUrl(base) { return base + '/manifest.json'; }

function _streamEndpoint(base, type, id) {
  return base + '/stream/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
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

  add(id);
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
  var hash = raw.infoHash ? String(raw.infoHash) : '';
  if (!url && !(config.includeTorrent && hash)) return null;
  var text = String(raw.name || '') + ' ' + String(raw.title || '');
  var qualityMatch = text.match(/(2160p|4k|1080p|720p|480p|360p)/i);
  return {
    name: (raw.name || 'Stremio') + (raw.title ? ' · ' + raw.title : ''),
    title: raw.title || raw.description || raw.name || 'Stream',
    url: url || null,
    infoHash: hash || undefined,
    fileIdx: raw.fileIdx,
    quality: qualityMatch ? (qualityMatch[1].toLowerCase() === '4k' ? '2160p' : qualityMatch[1]) : 'Auto',
    headers: raw.behaviorHints && raw.behaviorHints.proxyHeaders && raw.behaviorHints.proxyHeaders.request || {},
    sourceId: SOURCE_ID,
    addonSource: base
  };
}

function getHome() { return Promise.resolve([]); }
function popular() { return Promise.resolve([]); }
function search() { return Promise.resolve([]); }
function getDetail() { return Promise.resolve(null); }
function getEpisodes() { return Promise.resolve([]); }

function getVideoSources(episodeUrl, opts) {
  var config = _settings();
  if (!config.urls.length) return Promise.resolve([]);
  var parsed = _parseStreamId(episodeUrl);
  if (!parsed.ids.length) return Promise.resolve([]);

  var jobs = [];
  config.urls.forEach(function (base) {
    parsed.ids.forEach(function (id) {
      jobs.push(_json(_manifestUrl(base)).then(function (manifest) {
        var resources = manifest && manifest.resources;
        var hasStreams = !Array.isArray(resources) || resources.some(function (resource) {
          return resource === 'stream' || (resource && resource.name === 'stream');
        });
        if (!hasStreams) return [];
        return _json(_streamEndpoint(base, parsed.type, id)).then(function (data) {
          var streams = data && Array.isArray(data.streams) ? data.streams.slice(0, config.max) : [];
          return streams.map(function (stream) { return _stream(stream, base, config); }).filter(Boolean);
        }).catch(function () { return []; });
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
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getInfo: getInfo, getSettings: getSettings, getHome: getHome,
    popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources,
    getStreams: getStreams, getLinks: getLinks,
    _settings: _settings, _parseStreamId: _parseStreamId
  };
}
