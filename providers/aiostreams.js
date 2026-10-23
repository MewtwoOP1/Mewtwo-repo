/*
 * AIOStreams native Zangetsu provider, major rebuild.
 * Catalogue metadata is separate from stream search: Kitsu/AniZip for anime,
 * Cinemeta for films and series, and the documented AIOStreams Search API for
 * personalized streams. The client never probes/rewrites returned playback URLs.
 * ES5-compatible source style for the Zangetsu provider runtime.
 */
var AIO_ID = 'aiostreams';
var AIO_VERSION = '2.0.0';
var AIO_LOGO = 'https://aiostreams.viren070.me/logo.png';
var KITSU = 'https://kitsu.app/api/edge';
var ANIZIP = 'https://api.ani.zip/mappings';
var CINEMETA = 'https://v3-cinemeta.strem.io';
var AIO_UA = 'Zangetsu-AIOStreams/2.0';
var DEFAULT_CONCURRENCY = 5;
var DEFAULT_REQUEST_TIMEOUT = 10000;
var DEFAULT_TOTAL_TIMEOUT = 20000;
var MAX_QUEUE = 30;
var _active = 0, _queue = [];
var _cache = {};

function getInfo() {
  return { name: 'AIOStreams', lang: 'en', baseUrl: 'https://aiostreams.viren070.me', logo: AIO_LOGO, type: 'movie', version: AIO_VERSION };
}
function getSettings() {
  return [
    { key: 'manifestUrl', label: 'AIOStreams Manifest URL (required)', description: 'Paste your personalized AIOStreams URL ending in /stremio/<id>/<config>/manifest.json.', type: 'text', default: '' },
    { key: 'userDataBase64', label: 'Optional AIOStreams UserData (base64)', description: 'Optional x-aiostreams-user-data header exported by AIOStreams. Leave blank to authenticate from the manifest URL.', type: 'text', default: '' },
    { key: 'titleLanguage', label: 'Anime title language', description: 'Preferred Kitsu title language.', type: 'enum', default: 'english', options: [{ value: 'english', label: 'English' }, { value: 'romaji', label: 'Romaji' }, { value: 'native', label: 'Native Japanese' }] },
    { key: 'idPriority', label: 'Stream ID priority', description: 'First valid identifier is used; unsupported or missing IDs are skipped.', type: 'enum', default: 'imdb,tmdb,tvdb,anilist,mal,kitsu', options: [{ value: 'imdb,tmdb,tvdb,anilist,mal,kitsu', label: 'IMDb → TMDB → TVDB → AniList → MAL → Kitsu' }, { value: 'tmdb,imdb,tvdb,anilist,mal,kitsu', label: 'TMDB → IMDb → TVDB → AniList → MAL → Kitsu' }, { value: 'anilist,mal,kitsu,imdb,tmdb,tvdb', label: 'AniList → MAL → Kitsu → IMDb → TMDB → TVDB' }, { value: 'mal,anilist,kitsu,imdb,tmdb,tvdb', label: 'MAL → AniList → Kitsu → IMDb → TMDB → TVDB' }] },
    { key: 'showP2P', label: 'Show torrent / P2P streams', description: 'Enable only when your Zangetsu player supports magnet links.', type: 'bool', default: false },
    { key: 'maxConcurrentRequests', label: 'Maximum concurrent requests', description: 'Maximum simultaneous metadata/API requests. This is not a cap on returned stream count.', type: 'enum', default: '5', options: [{ value: '1', label: '1 request' }, { value: '2', label: '2 requests' }, { value: '3', label: '3 requests' }, { value: '4', label: '4 requests' }, { value: '5', label: '5 requests' }] },
    { key: 'requestTimeoutMs', label: 'Per-request timeout', description: 'Maximum wait for each HTTP request in milliseconds.', type: 'enum', default: '10000', options: [{ value: '5000', label: '5 seconds' }, { value: '8000', label: '8 seconds' }, { value: '10000', label: '10 seconds' }, { value: '15000', label: '15 seconds' }] },
    { key: 'totalTimeoutMs', label: 'Stream lookup deadline', description: 'Maximum total time for one stream-search operation. Does not cap stream results.', type: 'enum', default: '20000', options: [{ value: '8000', label: '8 seconds' }, { value: '12000', label: '12 seconds' }, { value: '20000', label: '20 seconds' }, { value: '25000', label: '25 seconds' }] }
  ];
}
function _settings() { try { return typeof __settings !== 'undefined' && __settings ? (__settings[AIO_ID] || {}) : {}; } catch (e) { return {}; } }
function _cfg(key, fallback) { var v = _settings()[key]; return v === undefined || v === null || v === '' ? fallback : v; }
function _bool(v, fallback) { if (v === true || v === false) return v; if (v == null || v === '') return fallback; return /^(1|true|yes|on)$/i.test(String(v)); }
function _int(v, fallback, min, max) { var n = parseInt(v, 10); if (!isFinite(n)) n = fallback; return Math.max(min, Math.min(max, n)); }
function _trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
function _query(obj) { var out = [], k; for (k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && obj[k] !== '') out.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(obj[k]))); return out.join('&'); }
function _safeUrl(url) { return String(url || '').replace(/(\/stremio\/)[^/]+\/[^/]+/i, '$1[redacted]/[redacted]'); }
function _decode(value) { try { return decodeURIComponent(value); } catch (e) { return value; } }
function _parseManifest(url) {
  var value = _trim(url).replace(/^stremio:\/\//i, 'https://');
  // AIOStreams canonical path is /stremio/<uuid>/<password-or-config>/manifest.json.
  var n = /^(https?):\/\/([^/]+)(\/[^?#]*)?\/stremio\/([^/]+)\/([^/]+)\/manifest\.json(?:\?[^#]*)?$/i.exec(value);
  if (!n) return null;
  return { baseUrl: n[1] + '://' + n[2] + (n[3] || ''), uuid: _decode(n[4]), password: _decode(n[5]) };
}
function _b64(input) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bytes = [], out = '', i, c, j, a, b, d, num;
  for (i = 0; i < input.length; i++) { c = input.charCodeAt(i); if (c < 128) bytes.push(c); else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63); else bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63); }
  for (j = 0; j < bytes.length; j += 3) { a = bytes[j]; b = j + 1 < bytes.length ? bytes[j + 1] : 0; d = j + 2 < bytes.length ? bytes[j + 2] : 0; num = (a << 16) | (b << 8) | d; out += chars[num >> 18 & 63] + chars[num >> 12 & 63] + (j + 1 < bytes.length ? chars[num >> 6 & 63] : '=') + (j + 2 < bytes.length ? chars[num & 63] : '='); }
  return out;
}
function _responseBody(response) {
  if (response && response.body != null) {
    if (typeof response.body === 'string') { try { return JSON.parse(response.body || 'null'); } catch (e) { throw new Error('AIOStreams: invalid JSON response'); } }
    return response.body;
  }
  if (response && typeof response.json === 'function') return response.json().catch(function () { throw new Error('AIOStreams: invalid JSON response'); });
  throw new Error('AIOStreams: empty HTTP response');
}
function _fetchOnce(url, options, timeout) {
  var init = { method: options.method || 'GET', headers: options.headers || {}, timeoutMs: timeout };
  if (options.body != null) init.body = options.body;
  var controller = null;
  try { if (typeof AbortController !== 'undefined') { controller = new AbortController(); init.signal = controller.signal; } } catch (e) { controller = null; }
  var network;
  try { network = fetch(url, init); } catch (e) { network = Promise.reject(e); }
  return new Promise(function (resolve, reject) {
    var finished = false;
    var timer = typeof setTimeout === 'function' ? setTimeout(function () { if (finished) return; finished = true; try { if (controller) controller.abort(); } catch (e) {} reject(new Error('AIOStreams: request timeout after ' + timeout + 'ms')); }, timeout) : null;
    Promise.resolve(network).then(function (response) {
      if (finished) return;
      var status = Number(response && (response.status || response.statusCode) || 200);
      if (status >= 400) { var err = new Error('AIOStreams: HTTP ' + status + ' for ' + _safeUrl(url)); err.status = status; throw err; }
      return _responseBody(response);
    }).then(function (body) { if (finished) return; finished = true; if (timer != null) clearTimeout(timer); resolve(body); }, function (error) { if (finished) return; finished = true; if (timer != null) clearTimeout(timer); reject(error); });
  });
}
function _requestJson(url, options) {
  options = options || {};
  var timeout = _int(options.timeoutMs != null ? options.timeoutMs : _cfg('requestTimeoutMs', DEFAULT_REQUEST_TIMEOUT), DEFAULT_REQUEST_TIMEOUT, 1000, 25000);
  var headers = { Accept: 'application/json', 'User-Agent': AIO_UA };
  var k;
  for (k in (options.headers || {})) if (Object.prototype.hasOwnProperty.call(options.headers, k)) headers[k] = options.headers[k];
  function attempt(retries) {
    return _fetchOnce(url, { method: options.method, headers: headers, body: options.body }, timeout).catch(function (error) {
      if (retries > 0 && (error.status === 429 || error.status >= 500 || (!error.status && !/timeout/i.test(String(error.message || error))))) return new Promise(function (resolve) { setTimeout(resolve, 200); }).then(function () { return attempt(retries - 1); });
      throw error;
    });
  }
  // A bounded FIFO gate prevents parallel metadata and lookup bursts exceeding five.
  var max = _int(_cfg('maxConcurrentRequests', DEFAULT_CONCURRENCY), DEFAULT_CONCURRENCY, 1, 5);
  return new Promise(function (resolve, reject) {
    if (_active >= max && _queue.length >= MAX_QUEUE) { reject(new Error('AIOStreams: request queue is full')); return; }
    var task = { run: function () { if (options.deadlineAt && Date.now() >= options.deadlineAt) { reject(new Error('AIOStreams: stream lookup exceeded total deadline')); _release(); return; } attempt(1).then(resolve, reject).then(_release, _release); } };
    if (_active < max) { _active++; task.run(); } else _queue.push(task);
  });
}
function _release() { _active = Math.max(0, _active - 1); while (_queue.length && _active < _int(_cfg('maxConcurrentRequests', DEFAULT_CONCURRENCY), DEFAULT_CONCURRENCY, 1, 5)) { var next = _queue.shift(); _active++; next.run(); } }
function _withDeadline(promise, timeout) {
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('AIOStreams: stream lookup exceeded total deadline (' + timeout + 'ms)')); } }, timeout);
    Promise.resolve(promise).then(function (v) { if (done) return; done = true; clearTimeout(timer); resolve(v); }, function (e) { if (done) return; done = true; clearTimeout(timer); reject(e); });
  });
}
function _status(s) { s = String(s || '').toLowerCase(); return s === 'current' || s === 'returning series' ? 'ongoing' : s === 'finished' || s === 'ended' || s === 'released' ? 'completed' : s === 'upcoming' || s === 'unreleased' || s === 'planned' ? 'upcoming' : s === 'cancelled' || s === 'canceled' ? 'cancelled' : s === 'hiatus' ? 'hiatus' : 'unknown'; }
function _kitsuTitle(a) { var t = a.titles || {}, lang = String(_cfg('titleLanguage', 'english')).toLowerCase(); return lang === 'native' ? (t.ja_jp || t.ja || a.canonicalTitle || t.en || '') : lang === 'romaji' ? (t.en_jp || t.en || t.en_us || a.canonicalTitle || '') : (t.en || t.en_us || a.canonicalTitle || t.en_jp || t.ja_jp || ''); }
function _cover(a) { var p = a && a.posterImage || {}; return p.original || p.large || p.medium || p.small || null; }
function _kitsuItem(r) { if (!r || !r.id || !r.attributes) return null; var a = r.attributes; return { id: 'aio-kitsu-' + r.id, title: _kitsuTitle(a) || a.canonicalTitle || ('Anime ' + r.id), cover: _cover(a), banner: a.coverImage && (a.coverImage.original || a.coverImage.large) || null, url: 'aio://anime/' + encodeURIComponent(String(r.id)), type: String(a.subtype || '').toLowerCase() === 'movie' ? 'movie' : 'anime', description: a.synopsis || '', year: String(a.startDate || '').slice(0, 4) || null, status: _status(a.status), sourceId: AIO_ID }; }
function _kitsuList(page, query, latest) { var p = Math.max(1, parseInt(page, 10) || 1), params = { 'page[limit]': 20, 'page[offset]': (p - 1) * 20, sort: latest ? '-startDate' : '-userCount' }; if (query) params['filter[text]'] = query; if (latest) params['filter[status]'] = 'current'; return _requestJson(KITSU + '/anime?' + _query(params)).then(function (j) { if (!j || !Array.isArray(j.data)) throw new Error('AIOStreams: invalid Kitsu catalog response'); var out = [], seen = {}; j.data.forEach(function (r) { var item = _kitsuItem(r); if (item && !seen[item.url]) { seen[item.url] = true; out.push(item); } }); return out; }); }
function _cinemetaCatalog(type, query, page) { var skip = (Math.max(1, parseInt(page, 10) || 1) - 1) * 20; var path = '/catalog/' + type + '/top/skip=' + skip; if (query) path += '/search=' + encodeURIComponent(query); path += '.json'; return _requestJson(CINEMETA + path).then(function (j) { var metas = j && j.metas; if (!Array.isArray(metas)) return []; return metas.map(function (m) { return _cinemetaItem(m, type); }).filter(Boolean); }); }
function _catalogMediaUrl(type, id, ids) { var query = _query({ imdb: ids && ids.imdb, tmdb: ids && ids.tmdb, tvdb: ids && ids.tvdb, anilist: ids && ids.anilist, mal: ids && ids.mal, kitsu: ids && ids.kitsu }); return 'aio://catalog/' + type + '/' + encodeURIComponent(String(id)) + (query ? '?' + query : ''); }
function _cinemetaItem(m, type) { if (!m || !m.id || !m.name) return null; var mType = type === 'movie' ? 'movie' : 'series'; var ids = _idsFromMeta(m, type); return { id: 'aio-' + mType + '-' + m.id, title: m.name, cover: m.poster || null, banner: m.background || null, url: _catalogMediaUrl(mType, m.id, ids), type: 'movie', description: m.description || '', year: String(m.year || '').slice(0, 4) || null, status: 'unknown', imdbId: ids.imdb || null, tmdbId: ids.tmdb || null, tvdbId: ids.tvdb || null, sourceId: AIO_ID }; }
function _idsFromMeta(meta, fallbackType) {
  meta = meta || {}; var id = String(meta.id || ''), imdb = meta.imdb_id || (/^tt\d+/.test(id) ? id.split(':')[0] : ''), tmdb = meta.tmdb_id || meta.tmdbId || '', tvdb = meta.tvdb_id || meta.tvdbId || '';
  if (!tmdb && /^tmdb:/i.test(id)) tmdb = id.split(':')[1] || '';
  if (!tvdb && /^tvdb:/i.test(id)) tvdb = id.split(':')[1] || '';
  return { imdb: _validId('imdb', imdb), tmdb: _validId('tmdb', tmdb), tvdb: _validId('tvdb', tvdb), anilist: _validId('anilist', meta.anilist_id || meta.anilistId), mal: _validId('mal', meta.mal_id || meta.malId), kitsu: _validId('kitsu', meta.kitsu_id || meta.kitsuId) };
}
function _validId(kind, v) { if (v == null || v === '') return ''; var s = String(v).trim(); if (kind === 'imdb') { var match = s.match(/tt\d{5,}/i); return match ? match[0] : ''; } if (kind === 'tmdb' || kind === 'tvdb' || kind === 'anilist' || kind === 'mal' || kind === 'kitsu') { s = s.replace(/^(?:tmdb|tvdb|anilist|mal|kitsu):/i, '').replace(/\/+$/, ''); if (s.indexOf('/') >= 0) s = s.slice(s.lastIndexOf('/') + 1).split(/[?#]/)[0]; return /^\d+$/.test(s) && Number(s) > 0 ? s : ''; } return ''; }
function _animeId(url) { var m = /^aio:\/\/anime\/([^/?#]+)/i.exec(String(url || '')); return m ? _decode(m[1]) : null; }
function _catalogUrl(url) { var m = /^aio:\/\/catalog\/(movie|series)\/([^/?#]+)(?:\?([^#]*))?/i.exec(String(url || '')); if (!m) return null; var p = {}; String(m[3] || '').split('&').forEach(function (part) { if (!part) return; var ix = part.indexOf('='); var k = ix < 0 ? part : part.slice(0, ix); var v = ix < 0 ? '' : part.slice(ix + 1); p[_decode(k)] = _decode(v.replace(/\+/g, '%20')); }); return { type: m[1], id: _decode(m[2]), ids: { imdb: _validId('imdb', p.imdb), tmdb: _validId('tmdb', p.tmdb), tvdb: _validId('tvdb', p.tvdb), anilist: _validId('anilist', p.anilist), mal: _validId('mal', p.mal), kitsu: _validId('kitsu', p.kitsu) } }; }
function _aniZip(param) { var key = 'az:' + param; if (_cache[key]) return Promise.resolve(_cache[key]); return _requestJson(ANIZIP + '?' + param).then(function (j) { _cache[key] = j || {}; return _cache[key]; }).catch(function () { return {}; }); }
function _getKitsu(id) { var key = 'kitsu:' + id; if (_cache[key]) return Promise.resolve(_cache[key]); return _requestJson(KITSU + '/anime/' + encodeURIComponent(id) + '?include=mappings,categories').then(function (j) { if (!j || !j.data || !j.data.attributes) throw new Error('AIOStreams: anime metadata missing'); var maps = {}, cats = [], inc = j.included || []; inc.forEach(function (x) { var a = x && x.attributes || {}; if (x && x.type === 'mappings' && a.externalSite && a.externalId) maps[a.externalSite] = String(a.externalId); if (x && x.type === 'categories' && a.title) cats.push(a.title); }); _cache[key] = { id: String(j.data.id || id), attributes: j.data.attributes, mappings: maps, categories: cats }; return _cache[key]; }); }
function _normaliseIds(d, az) { var m = az && az.mappings || {}, dm = d.mappings || {}; return { kitsu: _validId('kitsu', d.id), mal: _validId('mal', m.mal_id || dm['myanimelist/anime'] || dm.myanimelist), anilist: _validId('anilist', m.anilist_id || dm.anilist), imdb: _validId('imdb', m.imdb_id || dm.imdb), tmdb: _validId('tmdb', m.themoviedb_id || dm['themoviedb/anime'] || dm['themoviedb/movie']), tvdb: _validId('tvdb', m.thetvdb_id || dm['thetvdb/series'] || dm.thetvdb) }; }
function _makeEpisodeUrl(kind, id, ids, season, ep, absolute, movie, title) { var params = { kind: kind, season: season == null ? '' : season, epInSeason: ep == null ? '' : ep, episode: ep == null ? '' : ep, absoluteEpisode: absolute == null ? '' : absolute, movie: movie ? '1' : '', title: title || '', imdb: ids.imdb, tmdb: ids.tmdb, tvdb: ids.tvdb, anilist: ids.anilist, mal: ids.mal, kitsu: ids.kitsu }; return 'aio://episode/' + encodeURIComponent(kind) + '/' + encodeURIComponent(String(id)) + '?' + _query(params); }
function _buildAnimeEpisodes(d, az, kitsuEpisodes) {
  var attrs = d.attributes || {}, ids = _normaliseIds(d, az), azEps = az && az.episodes || {}, list = [], seen = {}, count = Math.max(0, parseInt(attrs.episodeCount, 10) || 0), keys = Object.keys(azEps), i, n, rec, krec, date, num, season, title, total = Math.max(count, keys.length);
  kitsuEpisodes = kitsuEpisodes || {};
  keys.forEach(function (k) { var num = parseInt(k, 10); if (num > total) total = num; });
  // Use a hard cap to prevent malformed upstream metadata generating unbounded episodes.
  total = Math.min(total, 1000);
  for (i = 1; i <= total; i++) {
    n = String(i); rec = azEps[n] || null; krec = kitsuEpisodes[n] || null;
    date = rec && rec.airdate || krec && (krec.airdate || krec.releaseDate) || '';
    if (date && Date.parse(date) > Date.now()) continue;
    num = rec && parseInt(rec.episodeNumber, 10) || krec && parseInt(krec.number, 10) || i;
    season = rec && parseInt(rec.seasonNumber, 10); if (!isFinite(season) || season < 0) season = 1;
    title = rec && rec.title && (rec.title.en || rec.title.ja) || krec && krec.titles && (krec.titles.en || krec.titles.en_us || krec.titles.en_jp || krec.titles.ja_jp) || '';
    if (seen[season + ':' + num]) continue; seen[season + ':' + num] = true;
    var item = { id: season + 'x' + num, title: title ? 'Episode ' + num + ': ' + title : 'Episode ' + num, number: num, season: season, url: _makeEpisodeUrl('anime', d.id, ids, season, num, i, String(attrs.subtype || '').toLowerCase() === 'movie', _kitsuTitle(attrs)), date: date || null };
    if (rec && rec.overview) item.description = rec.overview; else if (krec && krec.synopsis) item.description = krec.synopsis;
    var img = rec && (rec.image || rec.thumbnail) || krec && krec.thumbnail && (krec.thumbnail.original || krec.thumbnail.large || krec.thumbnail.small); if (img) item.thumbnail = img;
    list.push(item);
  }
  return list;
}
function _detailAnime(id) {
  return _getKitsu(id).then(function (d) {
    return Promise.all([_aniZip('kitsu_id=' + encodeURIComponent(d.id)), _requestJson(KITSU + '/anime/' + encodeURIComponent(id) + '/episodes?' + _query({ 'page[limit]': 20, 'page[offset]': 0 })).catch(function () { return { data: [] }; })]).then(function (parts) {
      var az = parts[0] || {}, byNumber = {}, list = parts[1] && parts[1].data || [];
      list.forEach(function (e) { if (e && e.attributes && e.attributes.number != null) byNumber[String(e.attributes.number)] = e.attributes; });
      var a = d.attributes, ids = _normaliseIds(d, az), episodes = _buildAnimeEpisodes(d, az, byNumber);
      return { id: 'aio-kitsu-' + id, title: _kitsuTitle(a) || a.canonicalTitle || 'Anime', url: 'aio://anime/' + encodeURIComponent(id), type: String(a.subtype || '').toLowerCase() === 'movie' ? 'movie' : 'anime', cover: _cover(a), banner: a.coverImage && (a.coverImage.original || a.coverImage.large) || null, description: a.synopsis || '', genre: d.categories.join(', '), status: _status(a.status), year: String(a.startDate || '').slice(0, 4) || null, episodes: episodes, totalEpisodes: episodes.length, ids: ids, malId: ids.mal ? Number(ids.mal) : undefined, anilistId: ids.anilist ? Number(ids.anilist) : undefined, tmdbId: ids.tmdb ? Number(ids.tmdb) : undefined, tvdbId: ids.tvdb ? Number(ids.tvdb) : undefined, tmdbIsTv: false, sourceId: AIO_ID };
    });
  });
}
function _detailCinemeta(parsed) {
  var path = '/meta/' + parsed.type + '/' + encodeURIComponent(parsed.id) + '.json';
  return _requestJson(CINEMETA + path).then(function (j) {
    var m = j && j.meta; if (!m) return null;
    var ids = _idsFromMeta(m, parsed.type);
    Object.keys(parsed.ids || {}).forEach(function (k) { if (!ids[k] && parsed.ids[k]) ids[k] = parsed.ids[k]; });
    var isMovie = parsed.type === 'movie', episodes = [];
    if (isMovie) episodes.push({ id: 'movie', title: m.name || 'Movie', number: 1, season: 1, url: _makeEpisodeUrl('movie', m.id || parsed.id, ids, 1, 1, null, true, m.name) });
    else {
      var videos = Array.isArray(m.videos) ? m.videos : [];
      videos.forEach(function (v, i) {
        if (!v) return;
        var season = parseInt(v.season, 10), ep = parseInt(v.episode, 10), vId = String(v.id || '');
        if ((!season || season < 0) && /:\d+:\d+$/.test(vId)) season = parseInt(vId.split(':').slice(-2)[0], 10);
        if (!ep && /:\d+:\d+$/.test(vId)) ep = parseInt(vId.split(':').pop(), 10);
        if (!isFinite(season) || season < 0 || !isFinite(ep) || ep < 1) return;
        episodes.push({ id: season + 'x' + ep, title: 'S' + season + ' E' + ep + ' - ' + (v.title || ('Episode ' + ep)), number: ep, season: season, url: _makeEpisodeUrl('series', m.id || parsed.id, ids, season, ep, ep, false, m.name), date: v.released || null, thumbnail: v.thumbnail || null });
      });
      var seen = {}; episodes = episodes.filter(function (e) { var k = e.season + ':' + e.number; if (seen[k]) return false; seen[k] = true; return true; });
    }
    return { id: 'aio-' + parsed.type + '-' + (m.id || parsed.id), title: m.name || 'Untitled', url: _catalogMediaUrl(parsed.type, m.id || parsed.id, ids), type: 'movie', cover: m.poster || null, banner: m.background || null, description: m.description || '', year: String(m.year || '').slice(0, 4) || null, status: 'unknown', genre: Array.isArray(m.genres) ? m.genres.join(', ') : '', episodes: episodes, totalEpisodes: episodes.length, ids: ids, malId: ids.mal ? Number(ids.mal) : undefined, anilistId: ids.anilist ? Number(ids.anilist) : undefined, tmdbId: ids.tmdb ? Number(ids.tmdb) : undefined, tvdbId: ids.tvdb ? Number(ids.tvdb) : undefined, tmdbIsTv: !isMovie, sourceId: AIO_ID };
  });
}
function getHome() {
  return Promise.all([
    _kitsuList(1, '', false).catch(function () { return []; }),
    _kitsuList(1, '', true).catch(function () { return []; }),
    _cinemetaCatalog('movie', '', 1).catch(function () { return []; }),
    _cinemetaCatalog('series', '', 1).catch(function () { return []; })
  ]).then(function (r) { var rows = []; if (r[0].length) rows.push({ title: 'Popular Anime', items: r[0] }); if (r[1].length) rows.push({ title: 'Currently Airing Anime', items: r[1] }); if (r[2].length) rows.push({ title: 'Popular Movies', items: r[2] }); if (r[3].length) rows.push({ title: 'Popular Series', items: r[3] }); return rows; });
}
function popular(page) { return getHome().then(function (rows) { var all = []; rows.forEach(function (row) { row.items.forEach(function (item) { all.push(item); }); }); return all; }); }
function search(query, page) {
  var q = _trim(query); if (!q) return Promise.resolve([]);
  return Promise.all([_kitsuList(page || 1, q, false).catch(function () { return []; }), _cinemetaCatalog('movie', q, page || 1).catch(function () { return []; }), _cinemetaCatalog('series', q, page || 1).catch(function () { return []; })]).then(function (r) { var all = [], seen = {}; r.forEach(function (items) { items.forEach(function (item) { var key = String(item.url || item.id); if (!seen[key]) { seen[key] = true; all.push(item); } }); }); return all; });
}
function getDetail(url) { var anime = _animeId(url); if (anime) return _detailAnime(anime); var parsed = _catalogUrl(url); if (parsed) return _detailCinemeta(parsed); return Promise.reject(new Error('AIOStreams: invalid media URL')); }
function getEpisodes(url) { return getDetail(url).then(function (d) { return d && Array.isArray(d.episodes) ? d.episodes : []; }); }
function _parseEpisode(url) {
  var s = String(url || ''), m = /^aio:\/\/episode\/([^/]+)\/([^/?#]+)(?:\?([^#]*))?/i.exec(s);
  if (!m) return null;
  var p = {}, query = m[3] || '';
  query.split('&').forEach(function (part) { if (!part) return; var ix = part.indexOf('='); var k = ix < 0 ? part : part.slice(0, ix); var v = ix < 0 ? '' : part.slice(ix + 1); p[_decode(k)] = _decode(v.replace(/\+/g, '%20')); });
  var kind = _decode(m[1]), id = _decode(m[2]);
  return { kind: kind, id: id, params: p, title: p.title || '', movie: p.movie === '1' || kind === 'movie', season: parseInt(p.season, 10), episode: parseInt(p.epInSeason || p.episode, 10), absolute: parseInt(p.absoluteEpisode, 10), ids: { imdb: _validId('imdb', p.imdb), tmdb: _validId('tmdb', p.tmdb), tvdb: _validId('tvdb', p.tvdb), anilist: _validId('anilist', p.anilist), mal: _validId('mal', p.mal), kitsu: _validId('kitsu', p.kitsu) } };
}
function _selectId(ep, priority) {
  var order = String(priority || 'imdb,tmdb,tvdb,anilist,mal,kitsu').split(','), ids = ep.ids || {}, i, k, v, season = parseInt(ep.season, 10), number = parseInt(ep.episode, 10), isMovie = !!ep.movie, absolute = parseInt(ep.absolute, 10);
  for (i = 0; i < order.length; i++) {
    k = _trim(order[i]).toLowerCase(); v = _validId(k, ids[k]); if (!v) continue;
    if (k === 'imdb') return { id: isMovie ? v : v + ':' + (isFinite(season) && season >= 0 ? season : 1) + ':' + (isFinite(number) && number > 0 ? number : absolute), type: isMovie ? 'movie' : 'series', key: k };
    if (k === 'tmdb' || k === 'tvdb') return { id: k + ':' + v + (isMovie ? '' : ':' + (isFinite(season) && season >= 0 ? season : 1) + ':' + (isFinite(number) && number > 0 ? number : absolute)), type: isMovie ? 'movie' : 'series', key: k };
    if (k === 'kitsu') return { id: 'kitsu:' + v + (isMovie ? '' : ':' + (isFinite(number) && number > 0 ? number : absolute)), type: isMovie ? 'movie' : 'series', key: k };
    if (k === 'anilist' || k === 'mal') { var animeEpisode = isFinite(absolute) && absolute > 0 ? absolute : number; return { id: k + ':' + v + (isMovie ? '' : ':' + animeEpisode), type: isMovie ? 'movie' : 'series', key: k }; }
  }
  return null;
}
function _bytesLabel(value) {
  var n = Number(value); if (!isFinite(n) || n <= 0) return null;
  var units = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? String(Math.round(n)) : n.toFixed(1)) + ' ' + units[i];
}
function _streamMetadata(s) {
  var parsed = s.parsedFile || {}, name = String(s.name || s.title || s.filename || parsed.title || 'AIOStreams stream');
  var description = String(s.description || ''), filename = String(s.filename || ''), raw = name + ' ' + description + ' ' + filename;
  var resolution = parsed.resolution || parsed.quality || '', match = /\b(4320|2160|1440|1080|720|576|540|480|360)p?\b/i.exec(raw);
  var quality = resolution ? String(resolution) : match ? match[1] + 'p' : /\b(4k|uhd)\b/i.test(raw) ? '2160p' : 'auto';
  var codec = parsed.encode || (raw.match(/\b(AV1|HEVC|H\.265|x265|H\.264|AVC|x264|VP9|VP8)\b/i) || [])[1] || '';
  var langs = Array.isArray(parsed.languages) ? parsed.languages : [];
  var language = langs.length ? langs.join(', ') : (raw.match(/\b(dual audio|multi audio|japanese|english|hindi|tamil|telugu|eng sub|hin dub|dubbed|subbed)\b/i) || [])[1] || '';
  var sizeBytes = Number(s.size || s.folderSize || 0), size = _bytesLabel(sizeBytes) || (raw.match(/\b\d+(?:\.\d+)?\s*(?:B|KB|MB|GB|TB)\b/i) || [])[0] || null;
  var provider = s.addon || s.indexer || s.service || '';
  var label = name;
  if (quality !== 'auto' && label.toLowerCase().indexOf(quality.toLowerCase()) < 0) label += ' · ' + quality;
  if (codec && label.toLowerCase().indexOf(codec.toLowerCase()) < 0) label += ' · ' + codec;
  if (language && label.toLowerCase().indexOf(language.toLowerCase()) < 0) label += ' · ' + language;
  if (size && label.indexOf(String(size)) < 0) label += ' · ' + size;
  if (provider && label.indexOf(String(provider)) < 0) label += ' · ' + provider;
  if (s.seeders != null && Number(s.seeders) > 0) label += ' · ' + Number(s.seeders) + ' seeders';
  if (parsed.releaseGroup) label += ' · ' + parsed.releaseGroup;
  return { name: name, description: description, label: label, quality: quality, codec: codec || null, language: language || null, size: size, sizeBytes: sizeBytes || null, provider: provider || null, filename: filename || null, seeders: s.seeders == null ? null : Number(s.seeders), age: s.age == null ? null : Number(s.age), type: s.type || null, cached: s.cached == null ? null : s.cached, service: s.service || null, indexer: s.indexer || null, subtitles: Array.isArray(s.subtitles) ? s.subtitles : [], parsedFile: parsed };
}
function _validPlaybackUrl(u) { return typeof u === 'string' && (/^https?:\/\/[^\/?#\s]+(?:[\/?#]|$)/i.test(u) || /^magnet:\?xt=urn:btih:[a-f0-9]{40}(?:[&#]|$)/i.test(u)); }
function _matchesRequestedEpisode(s, ep) {
  if (!ep || ep.movie) return true;
  var pf = s && s.parsedFile;
  if (!pf || pf.seasonPack) return true;
  var requestedSeason = Number(ep.season), requestedEp = Number(ep.episode), requestedAbs = Number(ep.absolute);
  if (Array.isArray(pf.seasons) && pf.seasons.length && isFinite(requestedSeason) && requestedSeason >= 0 && pf.seasons.indexOf(requestedSeason) < 0) return false;
  if (Array.isArray(pf.episodes) && pf.episodes.length && isFinite(requestedEp) && requestedEp > 0 && pf.episodes.indexOf(requestedEp) < 0 && (!isFinite(requestedAbs) || requestedAbs <= 0 || pf.episodes.indexOf(requestedAbs) < 0)) return false;
  return true;
}
function _parseStreams(json, episode) {
  if (!json || json.success === false) { var message = json && json.error && json.error.message || json && json.detail || 'search failed'; throw new Error('AIOStreams API: ' + message); }
  var results = json.data && json.data.results;
  if (!Array.isArray(results)) throw new Error('AIOStreams: search response did not contain data.results');
  var showP2P = _bool(_cfg('showP2P', false), false), seen = {}, out = [], i, s, url, hash, magnet, meta, headers, key, k;
  for (i = 0; i < results.length; i++) {
    s = results[i] || {};
    if (!_matchesRequestedEpisode(s, episode)) continue;
    url = typeof s.url === 'string' ? s.url.trim() : ''; hash = String(s.infoHash || '').toLowerCase();
    if (hash === '<redacted>' || !/^[a-f0-9]{40}$/.test(hash)) hash = '';
    magnet = /^magnet:/i.test(url) || (!url && !!hash);
    if (magnet) { if (!showP2P) continue; if (!/^magnet:\?xt=urn:btih:[a-f0-9]{40}/i.test(url)) { if (!hash) continue; url = 'magnet:?xt=urn:btih:' + hash; } }
    if (!_validPlaybackUrl(url)) continue;
    key = url; if (seen[key]) continue; seen[key] = true;
    meta = _streamMetadata(s);
    var stream = { url: url, label: meta.label, title: meta.name, description: meta.description, quality: meta.quality, container: /\.m3u8(?:\?|$)/i.test(url) ? 'hls' : /\.mpd(?:\?|$)/i.test(url) ? 'dash' : (meta.parsedFile.container || undefined), kind: magnet ? 'torrent' : 'video', provider: meta.provider, codec: meta.codec, language: meta.language, size: meta.size, sizeBytes: meta.sizeBytes, seeders: meta.seeders, age: meta.age, service: meta.service, cached: meta.cached, filename: meta.filename, subtitles: meta.subtitles, sourceIcon: s.icon || s.logo || null };
    if (s.responseHeaders && typeof s.responseHeaders === 'object') stream.responseHeaders = s.responseHeaders;
    headers = s.requestHeaders || s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request;
    if (!magnet && headers && typeof headers === 'object') { var clean = {}; for (k in headers) if (Object.prototype.hasOwnProperty.call(headers, k) && typeof headers[k] === 'string' && !/^host$/i.test(k)) clean[k] = headers[k]; if (Object.keys(clean).length) stream.headers = clean; }
    out.push(stream);
  }
  if (!out.length) { var errors = json.data && Array.isArray(json.data.errors) ? json.data.errors : []; var detail = errors.slice(0, 3).map(function (e) { return String(e.title || 'Source') + (e.description ? ': ' + String(e.description) : ''); }).join('; '); throw new Error('AIOStreams: no playable streams returned' + (detail ? ' (' + detail + ')' : '')); }
  return out;
}
function getVideoSources(episodeUrl) {
  var ep = _parseEpisode(episodeUrl); if (!ep) return Promise.reject(new Error('AIOStreams: invalid episode URL'));
  var manifest = String(_cfg('manifestUrl', '') || '').trim(); if (!manifest) return Promise.reject(new Error('AIOStreams: configure the personalized Manifest URL in source settings'));
  var config = _parseManifest(manifest); if (!config) return Promise.reject(new Error('AIOStreams: invalid manifest URL; expected /stremio/<id>/<config>/manifest.json'));
  if (!ep.movie && !(isFinite(ep.episode) && ep.episode > 0) && !(isFinite(ep.absolute) && ep.absolute > 0)) return Promise.reject(new Error('AIOStreams: invalid or missing episode number'));
  var selected = _selectId({ movie: ep.movie, season: ep.season, episode: ep.episode, absolute: ep.absolute, ids: ep.ids }, _cfg('idPriority', 'imdb,tmdb,tvdb,anilist,mal,kitsu'));
  if (!selected) return Promise.reject(new Error('AIOStreams: no supported metadata ID is available for this item'));
  var base = config.baseUrl.replace(/\/$/, ''), url = base + '/api/v1/search?' + _query({ type: selected.type, id: selected.id, format: 'true' });
  var headers = { Accept: 'application/json' }, userdata = _trim(_cfg('userDataBase64', ''));
  if (userdata) headers['x-aiostreams-user-data'] = userdata;
  else headers.Authorization = 'Basic ' + _b64(config.uuid + ':' + config.password);
  var deadline = _int(_cfg('totalTimeoutMs', DEFAULT_TOTAL_TIMEOUT), DEFAULT_TOTAL_TIMEOUT, 1000, 25000);
  var requestTimeout = _int(_cfg('requestTimeoutMs', DEFAULT_REQUEST_TIMEOUT), DEFAULT_REQUEST_TIMEOUT, 1000, 25000);
  var deadlineAt = Date.now() + deadline;
  return _withDeadline(_requestJson(url, { headers: headers, timeoutMs: Math.min(requestTimeout, deadline), deadlineAt: deadlineAt }), deadline).then(function (json) { return _parseStreams(json, ep); });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = {
  version: AIO_VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome, popular: popular, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
  _parseManifest: _parseManifest, _parseEpisode: _parseEpisode, _selectId: _selectId, _parseStreams: _parseStreams, _matchesRequestedEpisode: _matchesRequestedEpisode, _activeRequests: function () { return _active; }, _queueLength: function () { return _queue.length; }
};
