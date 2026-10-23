/*
 * AIOStreams provider for Zangetsu.
 * TMDB is the only metadata/catalogue API. AIOStreams is used only for streams.
 * Playback lookup is priority-queued, bounded, and does not retry slow searches.
 */
var AIO_ID = 'aiostreams';
var AIO_VERSION = '2.1.0';
var AIO_LOGO = 'https://aiostreams.viren070.me/logo.png';
var TMDB = 'https://api.themoviedb.org/3';
var TMDB_IMAGE = 'https://image.tmdb.org/t/p/';
var AIO_UA = 'Zangetsu-AIOStreams/2.1';
var DEFAULT_CONCURRENCY = 5;
var DEFAULT_REQUEST_TIMEOUT = 5000;
var DEFAULT_STREAM_TIMEOUT = 7000;
var DEFAULT_TOTAL_TIMEOUT = 8000;
var MAX_QUEUE = 40;
var _active = 0, _queue = [], _httpCache = {}, _detailCache = {};

function getInfo() {
  return { name: 'AIOStreams', lang: 'en', baseUrl: 'https://www.themoviedb.org', logo: AIO_LOGO, type: 'movie', version: AIO_VERSION };
}
function getSettings() {
  return [
    { key: 'manifestUrl', label: 'AIOStreams Manifest URL (required)', description: 'Personalized URL ending in /stremio/<id>/<config>/manifest.json.', type: 'text', default: '' },
    { key: 'userDataBase64', label: 'Optional AIOStreams UserData (base64)', description: 'Optional x-aiostreams-user-data value. When provided, it takes precedence over Basic authentication.', type: 'text', default: '' },
    { key: 'tmdbApiKey', label: 'TMDB API key or Read Access Token (required)', description: 'Use a TMDB v3 API key or a TMDB API Read Access Token. Metadata and catalogues use TMDB only.', type: 'text', default: '' },
    { key: 'showP2P', label: 'Show torrent / P2P streams', description: 'Enable only if your Zangetsu player supports magnet links.', type: 'bool', default: false },
    { key: 'maxConcurrentRequests', label: 'Maximum concurrent requests', description: 'Maximum simultaneous requests. Playback lookups move ahead of queued metadata requests.', type: 'enum', default: '5', options: [{ value: '2', label: '2 requests' }, { value: '3', label: '3 requests' }, { value: '4', label: '4 requests' }, { value: '5', label: '5 requests' }] },
    { key: 'requestTimeoutMs', label: 'TMDB request timeout', description: 'Timeout for an individual TMDB metadata request.', type: 'enum', default: '5000', options: [{ value: '3000', label: '3 seconds' }, { value: '5000', label: '5 seconds' }, { value: '7000', label: '7 seconds' }, { value: '10000', label: '10 seconds' }] },
    { key: 'streamTimeoutMs', label: 'AIOStreams request timeout', description: 'Maximum wait for the AIOStreams stream API request.', type: 'enum', default: '7000', options: [{ value: '4000', label: '4 seconds' }, { value: '5000', label: '5 seconds' }, { value: '7000', label: '7 seconds' }, { value: '9000', label: '9 seconds' }] },
    { key: 'totalTimeoutMs', label: 'Total stream lookup deadline', description: 'Hard maximum wait for one stream lookup, including time waiting for a request slot.', type: 'enum', default: '8000', options: [{ value: '5000', label: '5 seconds' }, { value: '8000', label: '8 seconds' }, { value: '10000', label: '10 seconds' }, { value: '12000', label: '12 seconds' }] }
  ];
}
function _settings() { try { return typeof __settings !== 'undefined' && __settings ? (__settings[AIO_ID] || {}) : {}; } catch (e) { return {}; } }
function _cfg(key, fallback) { var v = _settings()[key]; return v === undefined || v === null || v === '' ? fallback : v; }
function _trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
function _bool(v, fallback) { if (v === true || v === false) return v; if (v == null || v === '') return fallback; return /^(1|true|yes|on)$/i.test(String(v)); }
function _int(v, fallback, min, max) { var n = parseInt(v, 10); if (!isFinite(n)) n = fallback; return Math.max(min, Math.min(max, n)); }
function _query(obj) { var out = [], k; for (k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') out.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(obj[k]))); return out.join('&'); }
function _safeUrl(url) { return String(url || '').replace(/(\/stremio\/)[^/]+\/[^/]+/i, '$1[redacted]/[redacted]'); }
function _decode(v) { try { return decodeURIComponent(v); } catch (e) { return v; } }
function _responseBody(response) {
  if (response && response.body != null) {
    if (typeof response.body === 'string') { try { return JSON.parse(response.body || 'null'); } catch (e) { throw new Error('AIOStreams: invalid JSON response'); } }
    return response.body;
  }
  if (response && typeof response.json === 'function') return response.json().catch(function () { throw new Error('AIOStreams: invalid JSON response'); });
  throw new Error('AIOStreams: empty HTTP response');
}
function _fetchOnce(url, options, timeout) {
  var init = { method: options.method || 'GET', headers: options.headers || {} };
  if (options.body != null) init.body = options.body;
  var controller = null;
  try { if (typeof AbortController !== 'undefined') { controller = new AbortController(); init.signal = controller.signal; } } catch (e) { controller = null; }
  var network;
  try { network = fetch(url, init); } catch (e) { network = Promise.reject(e); }
  return new Promise(function (resolve, reject) {
    var finished = false;
    var timer = typeof setTimeout === 'function' ? setTimeout(function () {
      if (finished) return;
      finished = true;
      try { if (controller) controller.abort(); } catch (e) {}
      reject(new Error('AIOStreams: request timeout after ' + timeout + 'ms'));
    }, timeout) : null;
    Promise.resolve(network).then(function (response) {
      if (finished) return;
      var status = Number(response && (response.status || response.statusCode) || 200);
      if (status >= 400) {
        var err = new Error('HTTP ' + status + ' for ' + _safeUrl(url));
        err.status = status;
        throw err;
      }
      return _responseBody(response);
    }).then(function (body) {
      if (finished) return;
      finished = true;
      if (timer != null) clearTimeout(timer);
      resolve(body);
    }, function (error) {
      if (finished) return;
      finished = true;
      if (timer != null) clearTimeout(timer);
      reject(error);
    });
  });
}
function _release() {
  _active = Math.max(0, _active - 1);
  while (_queue.length && _active < _int(_cfg('maxConcurrentRequests', DEFAULT_CONCURRENCY), DEFAULT_CONCURRENCY, 1, 5)) {
    var next = _queue.shift();
    if (next.cancelled) continue;
    _active++;
    next.run();
  }
}
function _requestJson(url, options) {
  options = options || {};
  var timeout = _int(options.timeoutMs != null ? options.timeoutMs : _cfg('requestTimeoutMs', DEFAULT_REQUEST_TIMEOUT), DEFAULT_REQUEST_TIMEOUT, 1000, 25000);
  var headers = { Accept: 'application/json', 'User-Agent': AIO_UA }, k;
  for (k in (options.headers || {})) if (Object.prototype.hasOwnProperty.call(options.headers, k)) headers[k] = options.headers[k];
  return new Promise(function (resolve, reject) {
    var task = { cancelled: false, run: function () {
      if (task.cancelled) { _release(); return; }
      var remaining = options.deadlineAt ? options.deadlineAt - Date.now() : timeout;
      if (remaining <= 0) { task.cancelled = true; reject(new Error('AIOStreams: stream lookup deadline exceeded')); _release(); return; }
      var budget = Math.max(1, Math.min(timeout, remaining));
      _fetchOnce(url, { method: options.method, headers: headers, body: options.body }, budget).then(function (value) {
        _release(); resolve(value);
      }, function (error) {
        if (!options.noRetry && !options.deadlineAt && options.retry !== false && (error.status === 429 || error.status >= 500 || (!error.status && !/timeout/i.test(String(error.message || error))))) {
          new Promise(function (done) { setTimeout(done, 120); }).then(function () {
            if (task.cancelled) return;
            _requestJson(url, { method: options.method, headers: headers, body: options.body, timeoutMs: timeout, noRetry: true }).then(resolve, reject);
          }).then(function () { _release(); }, function () { _release(); });
          return;
        }
        _release();
        reject(error);
      });
    } };
    if (_active < _int(_cfg('maxConcurrentRequests', DEFAULT_CONCURRENCY), DEFAULT_CONCURRENCY, 1, 5)) {
      _active++;
      task.run();
    } else {
      if (_queue.length >= MAX_QUEUE) { reject(new Error('AIOStreams: request queue is full')); return; }
      if (options.priority) _queue.unshift(task);
      else _queue.push(task);
    }
  });
}
function _tmdbAuth() {
  var value = _trim(_cfg('tmdbApiKey', ''));
  if (!value) throw new Error('AIOStreams: add a TMDB API key or Read Access Token in source settings');
  return value;
}
function _tmdbUrl(path, params) {
  var token = _tmdbAuth(), p = {}, k;
  for (k in (params || {})) if (Object.prototype.hasOwnProperty.call(params, k)) p[k] = params[k];
  var isReadToken = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
  var headers = { Accept: 'application/json' };
  if (isReadToken) headers.Authorization = 'Bearer ' + token;
  else p.api_key = token;
  return { url: TMDB + path + (Object.keys(p).length ? '?' + _query(p) : ''), headers: headers };
}
function _tmdbRequest(path, params, options) {
  options = options || {};
  var request = _tmdbUrl(path, params), cacheKey = request.url + (request.headers.Authorization ? '|bearer' : '');
  if (!options.noCache) {
    var cached = _httpCache[cacheKey];
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
  }
  return _requestJson(request.url, { headers: request.headers, timeoutMs: options.timeoutMs || _cfg('requestTimeoutMs', DEFAULT_REQUEST_TIMEOUT), noRetry: options.noRetry, priority: options.priority, deadlineAt: options.deadlineAt }).then(function (data) {
    if (!options.noCache) _httpCache[cacheKey] = { value: data, expires: Date.now() + 120000 };
    return data;
  });
}
function _image(path, size) { return path ? TMDB_IMAGE + (size || 'w500') + path : null; }
function _status(s) {
  s = String(s || '').toLowerCase();
  if (s === 'returning series' || s === 'in production') return 'ongoing';
  if (s === 'ended' || s === 'released' || s === 'canceled' || s === 'cancelled') return 'completed';
  if (s === 'planned' || s === 'pilot' || s === 'rumored') return 'upcoming';
  return 'unknown';
}
function _mediaType(m, fallback) { return m && (m.media_type === 'movie' || m.media_type === 'tv') ? m.media_type : fallback; }
function _tmdbItem(m, fallbackType) {
  if (!m || !m.id) return null;
  var mediaType = _mediaType(m, fallbackType);
  if (mediaType !== 'movie' && mediaType !== 'tv') return null;
  var title = mediaType === 'movie' ? (m.title || m.original_title) : (m.name || m.original_name);
  if (!title) return null;
  var date = mediaType === 'movie' ? (m.release_date || '') : (m.first_air_date || '');
  var id = String(m.id), url = 'aio://tmdb/' + mediaType + '/' + encodeURIComponent(id);
  var genreIds = Array.isArray(m.genre_ids) ? m.genre_ids : [];
  return {
    id: 'aio-tmdb-' + mediaType + '-' + id,
    title: title,
    englishTitle: title,
    cover: _image(m.poster_path),
    banner: _image(m.backdrop_path, 'original'),
    url: url,
    type: 'movie',
    description: m.overview || '',
    year: date ? String(date).slice(0, 4) : null,
    tmdbId: Number(id),
    tmdbIsTv: mediaType === 'tv',
    genres: Array.isArray(m.genres) ? m.genres.map(function (g) { return g && g.name; }).filter(Boolean) : [],
    score: m.vote_average == null ? undefined : Math.round(Number(m.vote_average) * 10),
    status: _status(m.status),
    sourceId: AIO_ID,
    _mediaType: mediaType,
    _genreIds: genreIds
  };
}
function _list(path, params, fallbackType) {
  return _tmdbRequest(path, params).then(function (j) {
    if (!j || !Array.isArray(j.results)) throw new Error('AIOStreams: invalid TMDB list response');
    return j.results.map(function (m) { return _tmdbItem(m, fallbackType); }).filter(Boolean);
  });
}
function _parseCatalogUrl(url) {
  var m = /^aio:\/\/tmdb\/(movie|tv)\/(\d+)(?:[?#].*)?$/i.exec(String(url || ''));
  return m ? { type: m[1].toLowerCase(), id: m[2] } : null;
}
function _catalogUrl(type, id) { return 'aio://tmdb/' + type + '/' + encodeURIComponent(String(id)); }
function _detailCacheKey(type, id) { return type + ':' + id; }
function _getTmdbDetail(parsed, options) {
  var key = _detailCacheKey(parsed.type, parsed.id), cached = _detailCache[key];
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
  var path = '/' + (parsed.type === 'movie' ? 'movie/' : 'tv/') + encodeURIComponent(parsed.id);
  return _tmdbRequest(path, { language: 'en-US' }, options).then(function (data) {
    if (!data || !data.id) throw new Error('AIOStreams: TMDB detail not found');
    _detailCache[key] = { value: data, expires: Date.now() + 120000 };
    return data;
  });
}
function _episodeUrl(type, id, season, episode, title) {
  var params = { season: season == null ? '' : season, episode: episode == null ? '' : episode, title: title || '', movie: type === 'movie' ? '1' : '' };
  return 'aio://episode/' + (type === 'movie' ? 'movie' : 'series') + '/' + encodeURIComponent(String(id)) + '?' + _query(params);
}
function _parseEpisodeUrl(url) {
  var m = /^aio:\/\/episode\/(movie|series)\/(\d+)(?:\?([^#]*))?/i.exec(String(url || ''));
  if (!m) return null;
  var params = {};
  String(m[3] || '').split('&').forEach(function (part) {
    if (!part) return;
    var ix = part.indexOf('='), key = ix < 0 ? part : part.slice(0, ix), value = ix < 0 ? '' : part.slice(ix + 1);
    params[_decode(key)] = _decode(value.replace(/\+/g, '%20'));
  });
  var movie = m[1].toLowerCase() === 'movie' || params.movie === '1';
  return { kind: m[1].toLowerCase(), id: m[2], movie: movie, season: parseInt(params.season, 10), episode: parseInt(params.episode, 10), title: params.title || '' };
}
function _movieEpisode(detail) {
  return { id: 'movie', title: detail.title || detail.name || 'Movie', number: 1, season: 1, url: _episodeUrl('movie', detail.id, 1, 1, detail.title || detail.name), date: detail.release_date || null };
}
function _detailToModel(detail, type) {
  var title = type === 'movie' ? (detail.title || detail.original_title) : (detail.name || detail.original_name);
  var date = type === 'movie' ? detail.release_date : detail.first_air_date;
  var data = {
    id: 'aio-tmdb-' + type + '-' + detail.id,
    title: title || 'Untitled',
    englishTitle: title || 'Untitled',
    url: _catalogUrl(type, detail.id),
    type: 'movie',
    cover: _image(detail.poster_path),
    banner: _image(detail.backdrop_path, 'original'),
    description: detail.overview || '',
    year: date ? String(date).slice(0, 4) : null,
    status: _status(detail.status),
    genres: Array.isArray(detail.genres) ? detail.genres.map(function (g) { return g && g.name; }).filter(Boolean) : [],
    tmdbId: Number(detail.id),
    tmdbIsTv: type === 'tv',
    score: detail.vote_average == null ? undefined : Math.round(Number(detail.vote_average) * 10),
    episodes: [],
    sourceId: AIO_ID
  };
  if (type === 'movie') data.episodes = [_movieEpisode(detail)];
  return data;
}
function _parseManifest(url) {
  var value = _trim(url).replace(/^stremio:\/\//i, 'https://');
  var m = /^(https?):\/\/([^/]+)(\/[^?#]*)?\/stremio\/([^/]+)\/([^/]+)\/manifest\.json(?:\?[^#]*)?$/i.exec(value);
  if (!m) return null;
  return { baseUrl: m[1] + '://' + m[2] + (m[3] || ''), uuid: _decode(m[4]), password: _decode(m[5]) };
}
function _b64(input) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes = [], out = '', i, c, j, a, b, d, num;
  for (i = 0; i < input.length; i++) {
    c = input.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63);
    else bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
  }
  for (j = 0; j < bytes.length; j += 3) {
    a = bytes[j]; b = j + 1 < bytes.length ? bytes[j + 1] : 0; d = j + 2 < bytes.length ? bytes[j + 2] : 0;
    num = (a << 16) | (b << 8) | d;
    out += chars[num >> 18 & 63] + chars[num >> 12 & 63] + (j + 1 < bytes.length ? chars[num >> 6 & 63] : '=') + (j + 2 < bytes.length ? chars[num & 63] : '=');
  }
  return out;
}
function getHome() {
  return Promise.all([
    _list('/movie/popular', { page: 1, language: 'en-US' }, 'movie').catch(function () { return []; }),
    _list('/tv/popular', { page: 1, language: 'en-US' }, 'tv').catch(function () { return []; }),
    _list('/discover/tv', { page: 1, language: 'en-US', with_genres: '16', with_origin_country: 'JP', with_original_language: 'ja', sort_by: 'popularity.desc' }, 'tv').catch(function () { return []; }),
    _list('/discover/movie', { page: 1, language: 'en-US', with_genres: '16', with_origin_country: 'JP', with_original_language: 'ja', sort_by: 'popularity.desc' }, 'movie').catch(function () { return []; })
  ]).then(function (rows) {
    var sections = [];
    if (rows[0].length) sections.push({ title: 'Popular Movies', items: rows[0] });
    if (rows[1].length) sections.push({ title: 'Popular TV Series', items: rows[1] });
    if (rows[2].length) sections.push({ title: 'Anime Series', items: rows[2] });
    if (rows[3].length) sections.push({ title: 'Anime Movies', items: rows[3] });
    return sections;
  });
}
function popular(page) {
  return _list('/trending/all/week', { page: Math.max(1, parseInt(page, 10) || 1), language: 'en-US' }).then(function (items) { return items.slice(0, 20); });
}
function search(query, page) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  return _list('/search/multi', { query: q, page: Math.max(1, parseInt(page, 10) || 1), include_adult: false, language: 'en-US' });
}
function getDetail(url) {
  var parsed = _parseCatalogUrl(url);
  if (!parsed) return Promise.reject(new Error('AIOStreams: invalid TMDB media URL'));
  return _getTmdbDetail(parsed).then(function (detail) { return _detailToModel(detail, parsed.type); });
}
function getEpisodes(url) {
  var parsed = _parseCatalogUrl(url);
  if (!parsed) return Promise.reject(new Error('AIOStreams: invalid TMDB media URL'));
  return _getTmdbDetail(parsed).then(function (detail) {
    if (parsed.type === 'movie') return [_movieEpisode(detail)];
    var seasons = Array.isArray(detail.seasons) ? detail.seasons.filter(function (s) { return s && Number(s.season_number) >= 0 && Number(s.episode_count) > 0; }) : [];
    if (!seasons.length) return [];
    return Promise.all(seasons.map(function (season) {
      var sn = Number(season.season_number);
      return _tmdbRequest('/tv/' + encodeURIComponent(parsed.id) + '/season/' + sn, { language: 'en-US' }, { timeoutMs: 5000, noRetry: true }).then(function (j) {
        return (Array.isArray(j && j.episodes) ? j.episodes : []).map(function (ep) {
          var epNum = Number(ep.episode_number), sNum = Number(ep.season_number != null ? ep.season_number : sn);
          return {
            id: sNum + 'x' + epNum,
            title: 'S' + sNum + ' E' + epNum + ' - ' + (ep.name || ('Episode ' + epNum)),
            number: epNum,
            season: sNum,
            url: _episodeUrl('tv', parsed.id, sNum, epNum, ep.name || detail.name),
            date: ep.air_date || null,
            thumbnail: _image(ep.still_path, 'w300'),
            description: ep.overview || undefined
          };
        });
      }).catch(function () { return []; });
    })).then(function (lists) {
      var all = [], seen = {};
      lists.forEach(function (list) { list.forEach(function (ep) { var key = ep.season + ':' + ep.number; if (!seen[key]) { seen[key] = true; all.push(ep); } }); });
      all.sort(function (a, b) { return a.season - b.season || a.number - b.number; });
      return all;
    });
  });
}
function _selectTmdbId(episode) {
  if (!episode || !/^\d+$/.test(String(episode.id || ''))) return null;
  if (episode.movie) return { id: 'tmdb:' + episode.id, type: 'movie' };
  if (!isFinite(episode.season) || episode.season < 0 || !isFinite(episode.episode) || episode.episode < 1) return null;
  return { id: 'tmdb:' + episode.id + ':' + episode.season + ':' + episode.episode, type: 'series' };
}
function _bytesLabel(value) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) return null;
  var units = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? String(Math.round(n)) : n.toFixed(1)) + ' ' + units[i];
}
function _streamMetadata(s) {
  var parsed = s.parsedFile || {}, name = String(s.name || s.title || s.filename || parsed.title || 'AIOStreams stream');
  var description = String(s.description || ''), raw = name + ' ' + description + ' ' + String(s.filename || '');
  var resolution = parsed.resolution || parsed.quality || s.quality || '';
  var match = /\b(4320|2160|1440|1080|720|576|540|480|360)p?\b/i.exec(raw);
  var quality = resolution ? String(resolution) : match ? match[1] + 'p' : /\b(4k|uhd)\b/i.test(raw) ? '2160p' : null;
  var codecMatch = raw.match(/\b(AV1|HEVC|H\.265|x265|H\.264|AVC|x264|VP9|VP8)\b/i);
  var codec = parsed.encode || (codecMatch ? codecMatch[1] : '');
  var langs = Array.isArray(parsed.languages) ? parsed.languages : [];
  var languageMatch = raw.match(/\b(dual audio|multi audio|japanese|english|hindi|tamil|telugu|eng sub|hin dub|dubbed|subbed)\b/i);
  var language = langs.length ? langs.join(', ') : (languageMatch ? languageMatch[1] : '');
  var sizeBytes = Number(s.size || s.folderSize || 0);
  var size = _bytesLabel(sizeBytes) || ((raw.match(/\b\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB)\b/i) || [])[0]) || null;
  var provider = s.addon || s.indexer || s.service || '';
  var label = name;
  if (quality && label.toLowerCase().indexOf(quality.toLowerCase()) < 0) label += ' · ' + quality;
  if (codec && label.toLowerCase().indexOf(String(codec).toLowerCase()) < 0) label += ' · ' + codec;
  if (language && label.toLowerCase().indexOf(language.toLowerCase()) < 0) label += ' · ' + language;
  if (size && label.indexOf(String(size)) < 0) label += ' · ' + size;
  if (provider && label.indexOf(String(provider)) < 0) label += ' · ' + provider;
  if (s.seeders != null && Number(s.seeders) > 0) label += ' · ' + Number(s.seeders) + ' seeders';
  if (parsed.releaseGroup) label += ' · ' + parsed.releaseGroup;
  var lower = raw.toLowerCase(), kind = 'unknown';
  if (/\braw\b/.test(lower)) kind = 'raw';
  else if (/\b(dub|dubbed|dual audio|multi audio)\b/.test(lower)) kind = 'dub';
  else if (/\b(sub|subbed|eng sub|softsub)\b/.test(lower)) kind = 'sub';
  return { name: name, description: description, label: label, quality: quality, codec: codec || null, language: language || null, size: size, sizeBytes: sizeBytes || null, provider: provider || null, filename: s.filename || null, seeders: s.seeders == null ? null : Number(s.seeders), cached: s.cached == null ? null : s.cached, subtitles: _subtitles(s.subtitles), kind: kind };
}
function _subtitles(input) {
  if (!Array.isArray(input)) return [];
  var out = [];
  input.forEach(function (v) {
    var sub = typeof v === 'string' ? { url: v } : (v && typeof v === 'object' ? v : null);
    if (!sub) return;
    var url = String(sub.url || sub.uri || sub.file || '').trim();
    if (!/^https?:\/\/[^\/?#\s]+(?:[\/?#]|$)/i.test(url)) return;
    var lang = String(sub.lang || sub.language || sub.languageCode || sub.name || 'Unknown');
    var label = sub.label || sub.name || undefined;
    var ext = url.split('?')[0].toLowerCase();
    out.push({ url: url, lang: lang, label: label, format: sub.format || (ext.slice(-4) === '.vtt' ? 'vtt' : ext.slice(-4) === '.srt' ? 'srt' : undefined), default: sub.default === true || sub.isDefault === true });
  });
  return out;
}
function _validPlaybackUrl(url) {
  return typeof url === 'string' && (/^https?:\/\/[^\/?#\s]+(?:[\/?#]|$)/i.test(url) || /^magnet:\?xt=urn:btih:[a-f0-9]{40}(?:[&#]|$)/i.test(url));
}
function _matchesRequestedEpisode(s, ep) {
  if (!ep || ep.movie) return true;
  var pf = s && s.parsedFile;
  if (!pf || pf.seasonPack) return true;
  if (Array.isArray(pf.seasons) && pf.seasons.length && pf.seasons.indexOf(ep.season) < 0) return false;
  if (Array.isArray(pf.episodes) && pf.episodes.length && pf.episodes.indexOf(ep.episode) < 0) return false;
  return true;
}
function _parseStreams(json, episode) {
  if (!json || json.success === false) throw new Error('AIOStreams API: ' + String(json && (json.error && json.error.message || json.detail) || 'search failed'));
  var results = json.data && json.data.results;
  if (!Array.isArray(results)) throw new Error('AIOStreams: search response did not contain data.results');
  var showP2P = _bool(_cfg('showP2P', false), false), seen = {}, out = [];
  results.forEach(function (s) {
    s = s || {};
    if (!_matchesRequestedEpisode(s, episode)) return;
    var url = typeof s.url === 'string' ? s.url.trim() : '';
    var hash = String(s.infoHash || '').toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(hash)) hash = '';
    var magnet = /^magnet:/i.test(url) || (!url && !!hash);
    if (magnet) {
      if (!showP2P) return;
      if (!/^magnet:\?xt=urn:btih:[a-f0-9]{40}/i.test(url)) {
        if (!hash) return;
        url = 'magnet:?xt=urn:btih:' + hash;
      }
    }
    if (!_validPlaybackUrl(url) || seen[url]) return;
    seen[url] = true;
    var meta = _streamMetadata(s), container = magnet ? 'torrent' : (/\.m3u8(?:\?|$)/i.test(url) ? 'hls' : /\.mp4(?:\?|$)/i.test(url) ? 'mp4' : 'unknown');
    var stream = { url: url, label: meta.label, quality: meta.quality || undefined, container: container, kind: meta.kind, audioLang: meta.language || undefined, subtitles: meta.subtitles };
    var headers = s.requestHeaders || (s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request);
    if (!magnet && headers && typeof headers === 'object') {
      var clean = {}, k;
      for (k in headers) if (Object.prototype.hasOwnProperty.call(headers, k) && typeof headers[k] === 'string' && !/^host$/i.test(k)) clean[k] = headers[k];
      if (Object.keys(clean).length) stream.headers = clean;
    }
    out.push(stream);
  });
  if (!out.length) {
    var errors = json.data && Array.isArray(json.data.errors) ? json.data.errors : [];
    var detail = errors.slice(0, 3).map(function (e) { return String(e.title || 'Source') + (e.description ? ': ' + String(e.description) : ''); }).join('; ');
    throw new Error('AIOStreams: no playable streams returned' + (detail ? ' (' + detail + ')' : ''));
  }
  return out;
}
function getVideoSources(episodeUrl) {
  var ep = _parseEpisodeUrl(episodeUrl);
  if (!ep) return Promise.reject(new Error('AIOStreams: invalid episode URL'));
  var manifest = _trim(_cfg('manifestUrl', ''));
  if (!manifest) return Promise.reject(new Error('AIOStreams: configure the personalized Manifest URL in source settings'));
  var config = _parseManifest(manifest);
  if (!config) return Promise.reject(new Error('AIOStreams: invalid manifest URL; expected /stremio/<id>/<config>/manifest.json'));
  if (!ep.movie && (!isFinite(ep.episode) || ep.episode < 1 || !isFinite(ep.season) || ep.season < 0)) return Promise.reject(new Error('AIOStreams: invalid season or episode number'));
  var selected = _selectTmdbId(ep);
  if (!selected) return Promise.reject(new Error('AIOStreams: missing TMDB ID; reopen the title from the TMDB catalogue'));
  var params = { type: selected.type, id: selected.id, format: 'true' };
  var searchUrl = config.baseUrl.replace(/\/$/, '') + '/api/v1/search?' + _query(params);
  var headers = { Accept: 'application/json' }, userdata = _trim(_cfg('userDataBase64', ''));
  if (userdata) headers['x-aiostreams-user-data'] = userdata;
  else headers.Authorization = 'Basic ' + _b64(config.uuid + ':' + config.password);
  var deadline = _int(_cfg('totalTimeoutMs', DEFAULT_TOTAL_TIMEOUT), DEFAULT_TOTAL_TIMEOUT, 1000, 25000);
  var timeout = _int(_cfg('streamTimeoutMs', DEFAULT_STREAM_TIMEOUT), DEFAULT_STREAM_TIMEOUT, 1000, 25000);
  var deadlineAt = Date.now() + deadline;
  return _requestJson(searchUrl, { headers: headers, timeoutMs: Math.min(timeout, deadline), deadlineAt: deadlineAt, noRetry: true, priority: true }).then(function (json) {
    if (Date.now() > deadlineAt) throw new Error('AIOStreams: stream lookup deadline exceeded');
    return _parseStreams(json, ep);
  });
}
function getStreams(url, options) { return getVideoSources(url, options); }
function getLinks(url, options) { return getVideoSources(url, options); }

if (typeof module !== 'undefined' && module.exports) module.exports = {
  version: AIO_VERSION,
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
  _parseManifest: _parseManifest,
  _parseEpisodeUrl: _parseEpisodeUrl,
  _selectTmdbId: _selectTmdbId,
  _parseStreams: _parseStreams,
  _activeRequests: function () { return _active; },
  _queueLength: function () { return _queue.length; }
};
