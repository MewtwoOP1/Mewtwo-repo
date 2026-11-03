// Miruro multi-server anime source for Zangetsu.
// Uses JSON API mirrors so the provider runtime does not need binary gzip decoding.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'miruro';
var API_CACHE = {};
var DEFAULT_API_HOSTS = [
  'https://api.hiyori.tv',
  'https://miruro.zenos.my.id',
  'https://www.neoanime.tv'
];
var DEFAULT_PROVIDER_ORDER = [
  'bee', 'bonk', 'hop', 'kiwi', 'pewe', 'ally', 'nun', 'bun', 'twin',
  'cog', 'moo', 'sun', 'knob', 'telli'
];
var API_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

function getInfo() {
  return {
    name: 'Miruro', lang: 'en', baseUrl: 'https://www.miruro.to',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=miruro.to',
    type: 'anime', version: '1.0.1'
  };
}

function getSettings() {
  return [
    { key: 'apiHosts', label: 'API mirror URLs (comma or newline separated)', description: 'Ordered JSON API endpoints. The provider automatically switches to the next host when a request is blocked, unavailable, times out, or returns an invalid response. Leave the defaults unless you run your own compatible API.', type: 'text', default: DEFAULT_API_HOSTS.join('\n') },
    { key: 'providerOrder', label: 'Streaming server priority', description: 'Comma-separated server order. Servers missing from this list are still included after the listed servers. The same episode is retried on the next available server when a source fails.', type: 'text', default: DEFAULT_PROVIDER_ORDER.join(',') },
    { key: 'disabledProviders', label: 'Disabled streaming servers', description: 'Comma-separated server IDs to hide and skip. Leave blank to enable every server returned by the API.', type: 'text', default: '' },
    { key: 'audioMode', label: 'Audio tracks', description: 'Choose which episode tracks to display. Both keeps sub and dub when available.', type: 'enum', default: 'both', options: [{ value: 'both', label: 'Sub and dub' }, { value: 'sub', label: 'Sub only' }, { value: 'dub', label: 'Dub only' }] },
    { key: 'autoFallback', label: 'Automatic server fallback', description: 'Try the next available Miruro server when a selected server has no stream or returns an error.', type: 'bool', default: true },
    { key: 'maxProviderAttempts', label: 'Maximum server attempts per episode', description: 'Limits how many different streaming servers are tried for one episode.', type: 'enum', default: '8', options: [{ value: '3', label: '3 servers' }, { value: '5', label: '5 servers' }, { value: '8', label: '8 servers' }, { value: '14', label: 'All servers (14 max)' }] },
    { key: 'requestTimeoutMs', label: 'API request timeout', description: 'Maximum time for each API request before rotating to the next API host.', type: 'enum', default: '8000', options: [{ value: '8000', label: '8 seconds' }, { value: '15000', label: '15 seconds' }, { value: '25000', label: '25 seconds' }] },
    { key: 'qualityPreference', label: 'Preferred video quality', description: 'Choose the preferred quality when the API returns multiple stream variants. Other qualities remain available as fallbacks.', type: 'enum', default: 'auto', options: [{ value: 'auto', label: 'Automatic' }, { value: '1080p', label: '1080p' }, { value: '720p', label: '720p' }, { value: '480p', label: '480p' }, { value: '360p', label: '360p' }] },
    { key: 'homeSections', label: 'Home sections (comma separated)', description: 'Available sections: spotlight, trending, recent, popular, upcoming. Invalid or unavailable sections are skipped.', type: 'text', default: 'spotlight,trending,recent,popular' },
    { key: 'showAdult', label: 'Show adult catalogue entries', description: 'Include results marked as adult by the metadata API.', type: 'bool', default: false },
    { key: 'cacheSeconds', label: 'Metadata and episode cache', description: 'Short in-memory cache to avoid repeating identical API requests.', type: 'enum', default: '120', options: [{ value: '0', label: 'Disabled' }, { value: '60', label: '1 minute' }, { value: '120', label: '2 minutes' }, { value: '300', label: '5 minutes' }] }
  ];
}

function _setting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.miruro || {};
    return cfg[key] == null ? null : cfg[key];
  } catch (e) { return null; }
}
function _bool(value, fallback) {
  if (value == null) return fallback;
  if (value === true || String(value).toLowerCase() === 'true') return true;
  if (value === false || String(value).toLowerCase() === 'false') return false;
  return fallback;
}
function _int(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function _splitList(value) {
  return String(value == null ? '' : value).split(/[\n,;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}
function _normaliseHost(value) {
  var host = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(host)) return null;
  try {
    var parsed = new URL(host);
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch (e) { return null; }
}
function _config() {
  var hosts = _splitList(_setting('apiHosts')).map(_normaliseHost).filter(Boolean);
  if (!hosts.length) hosts = DEFAULT_API_HOSTS.slice();
  hosts = hosts.filter(function (x, i) { return hosts.indexOf(x) === i; });
  var order = _splitList(_setting('providerOrder')).map(function (x) { return x.toLowerCase(); });
  if (!order.length) order = DEFAULT_PROVIDER_ORDER.slice();
  return {
    hosts: hosts,
    providerOrder: order,
    disabledProviders: _splitList(_setting('disabledProviders')).map(function (x) { return x.toLowerCase(); }),
    audioMode: String(_setting('audioMode') || 'both').toLowerCase(),
    autoFallback: _bool(_setting('autoFallback'), true),
    maxAttempts: _int(_setting('maxProviderAttempts'), 8, 1, 14),
    timeoutMs: _int(_setting('requestTimeoutMs'), 8000, 3000, 30000),
    qualityPreference: String(_setting('qualityPreference') || 'auto').toLowerCase(),
    homeSections: _splitList(_setting('homeSections') || 'spotlight,trending,recent,popular').map(function (x) { return x.toLowerCase(); }),
    showAdult: _bool(_setting('showAdult'), false),
    cacheMs: _int(_setting('cacheSeconds'), 120, 0, 300) * 1000
  };
}

function _url(base, path) { return base.replace(/\/+$/, '') + '/' + String(path || '').replace(/^\/+/, ''); }
function _cacheGet(key) {
  var entry = API_CACHE[key];
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) return null;
  return entry.value;
}
function _cachePut(key, value, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return value;
  API_CACHE[key] = { value: value, expiresAt: Date.now() + ttlMs };
  var keys = Object.keys(API_CACHE);
  while (keys.length > 180) delete API_CACHE[keys[0]];
  return value;
}
function _unwrap(json) {
  if (!json || typeof json !== 'object') return json;
  if (json.success === false) throw new Error(String(json.message || json.error || 'API reported failure'));
  return json.results && typeof json.results === 'object' ? json.results : json;
}
function _requestText(url, timeoutMs) {
  return fetch(url, { headers: API_HEADERS, timeoutMs: timeoutMs }).then(function (response) {
    var status = Number(response && response.status || 0);
    var body = response && response.body != null ? response.body : '';
    if (status >= 400) {
      var error = new Error('HTTP ' + status + ' from ' + url);
      error.status = status;
      error.body = String(body).slice(0, 180);
      throw error;
    }
    if (typeof body !== 'string') body = JSON.stringify(body);
    var parsed;
    try { parsed = JSON.parse(body || 'null'); }
    catch (e) { throw new Error('Invalid JSON from ' + url + ': ' + String(e)); }
    if (!parsed || typeof parsed !== 'object') throw new Error('Empty JSON response from ' + url);
    return _unwrap(parsed);
  });
}
function _retryable(error) {
  var status = Number(error && error.status) || 0;
  return !status || status === 403 || status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}
function _apiGet(path, options) {
  var cfg = _config();
  var key = path;
  var useCache = !(options && options.noCache);
  var cached = useCache ? _cacheGet(key) : null;
  if (cached) return Promise.resolve(cached);
  var index = 0;
  var lastError = null;
  function next() {
    if (index >= cfg.hosts.length) {
      return Promise.reject(lastError || new Error('All API mirrors failed for ' + path));
    }
    var host = cfg.hosts[index++];
    return _requestText(_url(host, path), cfg.timeoutMs).then(function (data) {
      return _cachePut(key, data, (options && options.cacheMs != null) ? options.cacheMs : cfg.cacheMs);
    }).catch(function (error) {
      lastError = error;
      if (index < cfg.hosts.length && _retryable(error)) return next();
      throw error;
    });
  }
  return next();
}
function _title(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return value.english || value.romaji || value.native || '';
}
function _cover(value) {
  if (typeof value === 'string') return value;
  return value && (value.extraLarge || value.large || value.medium) || null;
}
function _isAdult(item) { return !!(item && (item.isAdult === true || item.is_adult === true)); }
function _mapItem(item) {
  if (!item || item.id == null) return null;
  var title = _title(item.title || item.name || item.title_romaji || item.romaji);
  if (!title) return null;
  if (!_config().showAdult && _isAdult(item)) return null;
  var id = Number(item.id);
  if (!isFinite(id) || id < 1) return null;
  return {
    id: 'miruro://anime/' + id,
    title: title + (item.seasonYear ? ' (' + item.seasonYear + ')' : ''),
    url: 'miruro://anime/' + id,
    cover: _cover(item.coverImage || item.cover || item.poster),
    banner: item.bannerImage || item.banner || item.background || null,
    description: item.description || '',
    type: 'anime', sourceId: SOURCE_ID,
    year: item.seasonYear || item.year || null,
    score: item.averageScore || item.meanScore || null,
    genres: Array.isArray(item.genres) ? item.genres : []
  };
}
function _itemsFrom(payload) {
  var rows = Array.isArray(payload) ? payload :
    (payload && (payload.results || payload.suggestions || payload.items || payload.anime)) || [];
  if (!Array.isArray(rows)) return [];
  return rows.map(_mapItem).filter(Boolean);
}
function _animeId(url) {
  var value = String(url || '');
  var m = value.match(/(?:miruro:\/\/anime\/|\/info\/|\/)(\d+)(?:[/?#]|$)/i);
  if (!m) m = value.match(/^(\d+)$/);
  if (!m) throw new Error('Miruro: invalid anime URL or AniList ID');
  return Number(m[1]);
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, _int(page, 1, 1, 100));
  return _apiGet('search?query=' + encodeURIComponent(q) + '&page=' + p + '&per_page=20')
    .then(_itemsFrom).catch(function (error) {
      console.warn('Miruro search failed:', String(error));
      return [];
    });
}
function getHome(opts) {
  var sections = _config().homeSections;
  var allowed = ['spotlight', 'trending', 'recent', 'popular', 'upcoming'];
  sections = sections.filter(function (name, i) { return allowed.indexOf(name) >= 0 && sections.indexOf(name) === i; });
  return Promise.all(sections.map(function (name) {
    return _apiGet(name + '?page=1&per_page=20').then(function (payload) {
      var items = _itemsFrom(payload);
      return items.length ? { title: name.charAt(0).toUpperCase() + name.slice(1) + ' Anime', items: items } : null;
    }).catch(function (error) {
      console.warn('Miruro home section failed:', name, String(error));
      return null;
    });
  })).then(function (rows) { return rows.filter(Boolean); });
}
function popular(opts) {
  return _apiGet('popular?page=1&per_page=20').then(_itemsFrom).catch(function () { return []; });
}
function _mapStatus(status) {
  var s = String(status || '').toUpperCase();
  if (s === 'FINISHED' || s === 'ENDED') return 'completed';
  if (s === 'RELEASING' || s === 'NOT_YET_RELEASED') return 'ongoing';
  if (s === 'CANCELLED') return 'cancelled';
  return 'unknown';
}
function _providerNames(providers, order) {
  var names = Object.keys(providers || {});
  return names.sort(function (a, b) {
    var ai = order.indexOf(a.toLowerCase()), bi = order.indexOf(b.toLowerCase());
    if (ai < 0) ai = 999;
    if (bi < 0) bi = 999;
    return ai === bi ? a.localeCompare(b) : ai - bi;
  });
}
function _episodeOptions(providerName, episode, category, animeId) {
  var rawId = String(episode && (episode.id || episode.url) || '');
  var slug = rawId.split('/').pop();
  if (!slug) slug = providerName + '-' + String(episode.number || '');
  return {
    provider: providerName,
    slug: slug,
    route: rawId.indexOf('watch/') === 0 ? rawId : ('watch/' + providerName + '/' + animeId + '/' + category + '/' + slug)
  };
}
function _buildEpisodes(animeId, payload) {
  var cfg = _config();
  var providers = payload && payload.providers || {};
  var names = _providerNames(providers, cfg.providerOrder);
  var grouped = { sub: {}, dub: {} };
  names.forEach(function (name) {
    if (cfg.disabledProviders.indexOf(name.toLowerCase()) >= 0) return;
    var entry = providers[name] || {};
    var lists = entry.episodes || entry;
    ['sub', 'dub'].forEach(function (category) {
      if (cfg.audioMode !== 'both' && cfg.audioMode !== category) return;
      var rows = Array.isArray(lists[category]) ? lists[category] : [];
      rows.forEach(function (ep) {
        var number = Number(ep && (ep.number || ep.episode || ep.ep));
        if (!(number > 0) || !isFinite(number)) return;
        var key = String(number);
        if (!grouped[category][key]) {
          grouped[category][key] = {
            id: null, number: number, title: ep.title || ('Episode ' + number),
            // Zangetsu's Episode JSON contract uses thumbnail/date/description.
            // Miruro calls the corresponding API fields image/airDate.
            thumbnail: ep.image || ep.thumbnail || null,
            date: ep.airDate || ep.aired || ep.date || null,
            description: ep.description || ep.synopsis || ep.overview || '',
            // The Miruro episode endpoint reports duration in seconds (e.g. 1420).
            runtimeMinutes: ep.duration != null && isFinite(Number(ep.duration))
              ? Math.round(Number(ep.duration) / 60) : null,
            filler: !!ep.filler,
            sourceId: SOURCE_ID, type: 'anime', category: category, _options: []
          };
        }
        var target = grouped[category][key];
        if (!target.title && ep.title) target.title = ep.title;
        if (!target.image && (ep.image || ep.thumbnail)) target.image = ep.image || ep.thumbnail;
        target._options.push(_episodeOptions(name, ep, category, animeId));
      });
    });
  });
  var out = [];
  ['sub', 'dub'].forEach(function (category) {
    Object.keys(grouped[category]).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (key) {
      var episode = grouped[category][key];
      episode._options = episode._options.sort(function (a, b) {
        var ai = cfg.providerOrder.indexOf(a.provider.toLowerCase()), bi = cfg.providerOrder.indexOf(b.provider.toLowerCase());
        if (ai < 0) ai = 999;
        if (bi < 0) bi = 999;
        return ai - bi;
      });
      var encoded = encodeURIComponent(JSON.stringify({ animeId: animeId, number: episode.number, category: category, options: episode._options }));
      episode.url = 'miruro://episode/' + encoded;
      episode.id = episode.url;
      delete episode._options;
      out.push(episode);
    });
  });
  return out.sort(function (a, b) { return a.number - b.number || (a.category === 'sub' ? -1 : 1); });
}
function _episodeList(animeId, force) {
  return _apiGet('episodes/' + animeId, { noCache: !!force, cacheMs: force ? 0 : _config().cacheMs }).then(function (payload) {
    var unwrapped = payload && payload.results && payload.results.providers ? payload.results : payload;
    return { payload: unwrapped, episodes: _buildEpisodes(animeId, unwrapped) };
  });
}
function getDetail(url, opts) {
  var id = _animeId(url);
  return Promise.all([
    _apiGet('info/' + id, { cacheMs: _config().cacheMs }).catch(function (e) {
      console.warn('Miruro detail metadata failed:', String(e));
      return { id: id, title: { romaji: 'Anime ' + id } };
    }),
    _episodeList(id, opts && opts.forceRefresh).catch(function (e) {
      console.warn('Miruro episode catalogue failed:', String(e));
      return { payload: { providers: {} }, episodes: [] };
    })
  ]).then(function (results) {
    var meta = results[0] && results[0].data ? results[0].data : results[0];
    if (meta && meta.results && typeof meta.results === 'object') meta = meta.results;
    var title = _title(meta && meta.title) || meta && meta.name || ('Anime ' + id);
    return {
      id: 'miruro://anime/' + id, title: title, url: 'miruro://anime/' + id,
      cover: _cover(meta && (meta.coverImage || meta.cover || meta.poster)),
      banner: meta && (meta.bannerImage || meta.banner) || null,
      description: meta && meta.description || '', status: _mapStatus(meta && meta.status),
      genres: Array.isArray(meta && meta.genres) ? meta.genres : [],
      studios: meta && meta.studios && meta.studios.nodes ? meta.studios.nodes.map(function (x) { return x.name; }) : [],
      type: 'anime', sourceId: SOURCE_ID, year: meta && (meta.seasonYear || meta.year) || null,
      score: meta && (meta.averageScore || meta.meanScore) || null,
      episodes: results[1].episodes,
      subCount: results[1].episodes.filter(function (ep) { return ep.category === 'sub'; }).length,
      dubCount: results[1].episodes.filter(function (ep) { return ep.category === 'dub'; }).length
    };
  });
}
function getEpisodes(url, opts) {
  return _episodeList(_animeId(url), opts && opts.forceRefresh).then(function (result) { return result.episodes; });
}
function _decodeEpisode(url) {
  var value = String(url || '');
  var m = value.match(/^miruro:\/\/episode\/(.+)$/i);
  if (!m) throw new Error('Miruro: invalid episode URL');
  var parsed;
  try { parsed = JSON.parse(decodeURIComponent(m[1])); }
  catch (e) { throw new Error('Miruro: malformed episode data'); }
  if (!parsed || !Number(parsed.animeId) || !Array.isArray(parsed.options)) throw new Error('Miruro: incomplete episode data');
  return parsed;
}
function _extractStreams(payload) {
  var data = payload && payload.results && typeof payload.results === 'object' ? payload.results : payload;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.streams)) return data.streams;
  if (data && data.bestStream && data.bestStream.url) return [data.bestStream].concat(data.streams || []);
  if (data && data.stream && data.stream.url) return [data.stream];
  return [];
}
function _mapStreams(payload, providerName) {
  var data = payload && payload.results && typeof payload.results === 'object' ? payload.results : payload;
  var streams = _extractStreams(payload);
  var subtitles = Array.isArray(data && data.subtitles) ? data.subtitles : [];
  var globalReferer = data && (data.referer || data.referrer) || null;
  var mapped = streams.map(function (stream, index) {
    if (!stream || !/^https?:\/\//i.test(String(stream.url || stream.file || ''))) return null;
    var url = String(stream.url || stream.file);
    var headers = {};
    if (stream.headers && typeof stream.headers === 'object') {
      Object.keys(stream.headers).forEach(function (key) { headers[key] = String(stream.headers[key]); });
    }
    var referer = stream.referer || globalReferer;
    if (referer && !headers.Referer && !headers.referer) headers.Referer = String(referer);
    return {
      url: url,
      quality: stream.quality || stream.label || stream.resolution || 'Auto',
      label: (stream.quality || stream.label || stream.resolution || 'Auto') + ' · ' + providerName,
      container: /\.mpd(?:[?#]|$)/i.test(url) || String(stream.type || '').toLowerCase() === 'dash' ? 'dash' :
        (/\.m3u8(?:[?#]|$)/i.test(url) || String(stream.type || '').toLowerCase() === 'hls' ? 'hls' : undefined),
      type: stream.type || stream.format || undefined,
      kind: stream.audio || stream.category || undefined,
      audioLang: stream.audioLanguage || stream.audioLang || undefined,
      headers: headers,
      referer: referer || undefined,
      subtitles: []
    };
  }).filter(Boolean);
  if (mapped.length && subtitles.length) {
    mapped[0].subtitles = subtitles.map(function (sub) {
      if (!sub || !/^https?:\/\//i.test(String(sub.url || sub.file || ''))) return null;
      return { url: sub.url || sub.file, label: sub.label || sub.title || sub.language || 'Subtitle', lang: sub.language || sub.lang || '', format: sub.format || 'vtt', default: !!(sub.isDefault || sub.default) };
    }).filter(Boolean);
  }
  return mapped;
}
function _qualitySort(streams, preference) {
  if (!preference || preference === 'auto' || streams.length < 2) return streams;
  var wanted = parseInt(preference, 10);
  if (!wanted) return streams;
  return streams.map(function (stream, index) {
    var match = String(stream.quality || stream.label || '').match(/(\d{3,4})\s*p/i);
    var height = match ? Number(match[1]) : 0;
    return { stream: stream, index: index, score: height ? Math.abs(height - wanted) : 10000 };
  }).sort(function (a, b) { return a.score - b.score || a.index - b.index; })
    .map(function (row) { return row.stream; });
}
function _watchPaths(episode, option) {
  var provider = encodeURIComponent(option.provider);
  var slug = encodeURIComponent(option.slug);
  var category = encodeURIComponent(episode.category);
  var animeId = encodeURIComponent(episode.animeId);
  var watch = String(option.route || '');
  if (!/^watch\/[a-z0-9_-]+\//i.test(watch)) {
    watch = 'watch/' + provider + '/' + animeId + '/' + category + '/' + slug;
  }
  return [
    watch,
    'stream?provider=' + provider + '&anilistId=' + animeId + '&category=' + category + '&slug=' + slug + '&quality=' + encodeURIComponent(_config().qualityPreference),
    'sources?episodeId=' + encodeURIComponent(watch) + '&provider=' + provider + '&anilistId=' + animeId + '&category=' + category
  ];
}
function _tryProviderPaths(episode, option, paths, index) {
  if (index >= paths.length) return Promise.reject(new Error('No stream endpoint returned playable sources for ' + option.provider));
  return _apiGet(paths[index], { noCache: true, cacheMs: 0 }).then(function (payload) {
    var streams = _mapStreams(payload, option.provider);
    if (streams.length) return _qualitySort(streams, _config().qualityPreference);
    throw new Error('No streams returned by ' + option.provider + ' at ' + paths[index]);
  }).catch(function (error) {
    console.warn('Miruro stream route failed:', option.provider, String(error));
    return _tryProviderPaths(episode, option, paths, index + 1);
  });
}
function _tryProviderOptions(episode, options, index, attempts, maxAttempts) {
  if (index >= options.length || attempts >= maxAttempts) {
    return Promise.reject(new Error('Miruro: no playable stream after trying ' + attempts + ' server(s)'));
  }
  var option = options[index];
  return _tryProviderPaths(episode, option, _watchPaths(episode, option), 0).catch(function (error) {
    console.warn('Miruro server failed:', option.provider, String(error));
    if (!_config().autoFallback) throw error;
    return _tryProviderOptions(episode, options, index + 1, attempts + 1, maxAttempts);
  });
}
function getVideoSources(episodeUrl, opts) {
  var episode = _decodeEpisode(episodeUrl);
  var cfg = _config();
  var options = episode.options.filter(function (option) { return cfg.disabledProviders.indexOf(String(option.provider || '').toLowerCase()) < 0; });
  if (!options.length) return Promise.reject(new Error('Miruro: no servers listed for this episode'));
  options.sort(function (a, b) {
    var ai = cfg.providerOrder.indexOf(String(a.provider || '').toLowerCase());
    var bi = cfg.providerOrder.indexOf(String(b.provider || '').toLowerCase());
    if (ai < 0) ai = 999;
    if (bi < 0) bi = 999;
    return ai - bi;
  });
  var count = cfg.autoFallback ? cfg.maxAttempts : 1;
  return _tryProviderOptions(episode, options, 0, 0, count);
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.1', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _config: _config, _buildEpisodes: _buildEpisodes, _mapStreams: _mapStreams,
    _decodeEpisode: _decodeEpisode, _apiGet: _apiGet, _watchPaths: _watchPaths, _qualitySort: _qualitySort
  };
}