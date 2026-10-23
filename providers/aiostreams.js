/*
 * AIOStreams - native Zangetsu anime source
 *
 * Ported from worldInColors/aiostreams-extension's native Aniyomi extension.
 * This is NOT a Stremio-addon importer. Kitsu provides browsing/search/details;
 * AniZip supplies cross-service IDs and episode metadata; AIOStreams' own
 * authenticated /api/v1/search endpoint aggregates playable streams.
 *
 * Zangetsu source contract: getInfo, getSettings, getHome, search, getDetail,
 * getEpisodes, getVideoSources. ES5-compatible syntax; no external packages.
 */

var AIO_ID = 'aiostreams';
var KITSU_API = 'https://kitsu.app/api/edge';
var ANIZIP_API = 'https://api.ani.zip/mappings';
var ANILIST_API = 'https://graphql.anilist.co';
var JIKAN_API = 'https://api.jikan.moe/v4';
var SEADEX_API = 'https://releases.moe/api/collections/entries/records';
var AIO_VERSION = '1.0.0';
var AIO_PAGE_SIZE = 20;
var AIO_UA = 'Zangetsu-AIOStreams/1.0';
var AIO_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'http://nyaa.tracker.wf:7777/announce',
  'udp://open.demonii.com:1333/announce',
  'udp://tracker.torrent.eu.org:451/announce'
];
var _aioDetailCache = {};
var _aioMappingCache = {};
var _aioEpisodeCache = {};
var _aioAiringCache = {};
var _aioSeaDexCache = {};

function getInfo() { return { id: AIO_ID, name: 'AIOStreams', lang: 'en', baseUrl: 'https://kitsu.app', logo: 'https://kitsu.app/favicon.ico', type: 'anime', version: AIO_VERSION }; }
function getSettings() {
  return [
    { key: 'manifestUrl', label: 'AIOStreams Manifest URL (required)', type: 'text', default: '' },
    { key: 'titleLanguage', label: 'Title Language', type: 'enum', default: 'english', options: [{ value: 'english', label: 'English' }, { value: 'romaji', label: 'Romaji' }, { value: 'native', label: 'Native Japanese' }] },
    { key: 'idPriority', label: 'Stream ID Priority', type: 'enum', default: 'kitsu,imdb,mal,anilist,tmdb', options: [
      { value: 'kitsu,imdb,mal,anilist,tmdb', label: 'Kitsu → IMDb → MAL → AniList → TMDB' },
      { value: 'mal,kitsu,imdb,anilist,tmdb', label: 'MAL → Kitsu → IMDb → AniList → TMDB' },
      { value: 'kitsu,mal,imdb,anilist,tmdb', label: 'Kitsu → MAL → IMDb → AniList → TMDB' },
      { value: 'mal,imdb,kitsu,anilist,tmdb', label: 'MAL → IMDb → Kitsu → AniList → TMDB' },
      { value: 'imdb,mal,kitsu,anilist,tmdb', label: 'IMDb → MAL → Kitsu → AniList → TMDB' },
      { value: 'imdb,kitsu,mal,anilist,tmdb', label: 'IMDb → Kitsu → MAL → AniList → TMDB' },
      { value: 'imdb,anilist,mal,kitsu,tmdb', label: 'IMDb → AniList → MAL → Kitsu → TMDB' },
      { value: 'anilist,kitsu,mal,imdb,tmdb', label: 'AniList → Kitsu → MAL → IMDb → TMDB' },
      { value: 'anilist,mal,kitsu,imdb,tmdb', label: 'AniList → MAL → Kitsu → IMDb → TMDB' }
    ] },
    { key: 'markFillers', label: 'Mark filler and recap episodes', type: 'boolean', default: false },
    { key: 'showP2P', label: 'Show torrent / P2P streams', type: 'boolean', default: false },
    { key: 'highlightSeaDex', label: 'Highlight SeaDex best releases', type: 'boolean', default: true },
    { key: 'sortSeaDex', label: 'Move SeaDex best releases to the top', type: 'boolean', default: true },
    { key: 'tvdbApiKey', label: 'TVDB API Key (optional)', type: 'text', default: '' },
    { key: 'useAniDB', label: 'Use AniDB title fallback', type: 'boolean', default: false }
  ];
}
function _aioSettings() { try { return (__settings && __settings[AIO_ID]) || {}; } catch (e) { return {}; } }
function _cfg(key, fallback) { var s = _aioSettings(), v = s[key]; return v === undefined || v === null || v === '' ? fallback : v; }
function _bool(value, fallback) { if (value === undefined || value === null || value === '') return fallback; if (typeof value === 'boolean') return value; if (typeof value === 'number') return value !== 0; return /^(true|1|yes|on)$/i.test(String(value).trim()); }
function _title(attrs) {
  attrs = attrs || {}; var t = attrs.titles || {}; var lang = String(_cfg('titleLanguage', 'english')).toLowerCase();
  if (lang === 'native') return t.ja_jp || t.ja || attrs.canonicalTitle || t.en || t.en_us || '';
  if (lang === 'romaji') return t.en_jp || t.en || t.en_us || attrs.canonicalTitle || '';
  return t.en || t.en_us || attrs.canonicalTitle || t.en_jp || t.ja_jp || '';
}
function _poster(a) { a = a || {}; var p = a.posterImage || {}; return p.original || p.large || p.medium || p.small || ''; }
function _cover(a) { a = a || {}; var c = a.coverImage || {}; return c.original || c.large || c.small || ''; }
function _status(s) { return s === 'current' ? 'ongoing' : s === 'finished' ? 'completed' : (s === 'upcoming' || s === 'unreleased') ? 'upcoming' : s === 'cancelled' ? 'hiatus' : 'unknown'; }
function _kind(a) { return String(a && a.subtype || '').toLowerCase() === 'movie' ? 'movie' : 'anime'; }
function _item(r) {
  if (!r || !r.id || !r.attributes) return null; var a = r.attributes;
  return { id: 'aiostreams-' + r.id, title: _title(a) || a.canonicalTitle || ('Anime ' + r.id), cover: _poster(a), url: 'aio://anime/' + encodeURIComponent(String(r.id)), type: _kind(a), description: a.synopsis || '', year: a.startDate ? String(a.startDate).slice(0, 4) : undefined, status: _status(a.status) };
}
function _cleanItems(resources) { var out = [], seen = {}, i, it; resources = resources || []; for (i = 0; i < resources.length; i++) { it = _item(resources[i]); if (it && !seen[it.url]) { seen[it.url] = true; out.push(it); } } return out; }
function _encodeQuery(p) { var out = [], k; for (k in p) if (Object.prototype.hasOwnProperty.call(p, k) && p[k] !== undefined && p[k] !== null && p[k] !== '') out.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(p[k]))); return out.join('&'); }
function _safeUrl(u) { return String(u || '').replace(/(\/stremio\/)[^/]+\/[^/]+/i, '$1[redacted]/[redacted]'); }
function _requestJson(url, options) {
  options = options || {}; var headers = { Accept: options.accept || 'application/vnd.api+json, application/json;q=0.9, */*;q=0.8', 'User-Agent': AIO_UA }, supplied = options.headers || {}, k;
  for (k in supplied) if (Object.prototype.hasOwnProperty.call(supplied, k)) headers[k] = supplied[k];
  var init = { method: options.method || 'GET', headers: headers }; if (options.body !== undefined) init.body = options.body;
  return fetch(url, init).then(function (r) {
    if (!r) throw new Error('AIOStreams: empty HTTP response');
    if (!r.ok) { var e = new Error('AIOStreams: HTTP ' + r.status + ' for ' + _safeUrl(url)); e.status = r.status; throw e; }
    return r.json().catch(function () { throw new Error('AIOStreams: invalid JSON from ' + _safeUrl(url)); });
  });
}
function _list(page, query, mode) {
  var p = parseInt(page, 10); if (isNaN(p) || p < 1) p = 1;
  var params = { 'page[limit]': AIO_PAGE_SIZE, 'page[offset]': (p - 1) * AIO_PAGE_SIZE, include: 'mediaRelationships.destination' };
  if (mode === 'latest') { params['filter[status]'] = 'current'; params.sort = '-startDate'; }
  else { if (query) params['filter[text]'] = String(query).trim(); params.sort = '-userCount'; }
  return _requestJson(KITSU_API + '/anime?' + _encodeQuery(params)).then(function (j) {
    if (!j || !Array.isArray(j.data)) throw new Error('AIOStreams: Kitsu returned unexpected catalogue response');
    return { items: _cleanItems(j.data), hasNextPage: !!(j.links && j.links.next) };
  });
}
function getHome() {
  return Promise.all([_list(1, '', 'popular').catch(function () { return { items: [] }; }), _list(1, '', 'latest').catch(function () { return { items: [] }; })]).then(function (p) {
    var rows = []; if (p[0].items.length) rows.push({ title: 'Popular Anime', items: p[0].items }); if (p[1].items.length) rows.push({ title: 'Currently Airing', items: p[1].items }); return rows;
  });
}
function search(query, page) { return _list(page || 1, String(query || ''), 'search').then(function (r) { return r.items; }); }
function _idFromUrl(url) { var m = /^aio:\/\/anime\/([^|?]+)/.exec(String(url || '')); return m ? decodeURIComponent(m[1]) : null; }
function _fetchDetail(id) {
  if (_aioDetailCache[id]) return Promise.resolve(_aioDetailCache[id]);
  return _requestJson(KITSU_API + '/anime/' + encodeURIComponent(id) + '?include=mappings,categories').then(function (j) {
    if (!j || !j.data || !j.data.attributes) throw new Error('AIOStreams: anime details not found');
    var attrs = j.data.attributes, mappings = {}, categories = [], inc = j.included || [], i, x, a;
    for (i = 0; i < inc.length; i++) { x = inc[i] || {}; a = x.attributes || {}; if (x.type === 'mappings' && a.externalSite && a.externalId) mappings[a.externalSite] = String(a.externalId); if (x.type === 'categories' && a.title) categories.push(a.title); }
    var result = { id: String(j.data.id || id), attributes: attrs, mappings: mappings, categories: categories };
    _aioDetailCache[id] = result; return result;
  });
}
function _anizip(param) {
  if (_aioMappingCache[param]) return Promise.resolve(_aioMappingCache[param]);
  return _requestJson(ANIZIP_API + '?' + param).then(function (j) { _aioMappingCache[param] = j || {}; return j || {}; }).catch(function () { return {}; });
}
function _episodeCount(details, az) {
  var n = parseInt(details.attributes.episodeCount, 10) || 0, eps = az && az.episodes || {}, keys = Object.keys(eps), max = 0, i;
  for (i = 0; i < keys.length; i++) { var k = parseInt(keys[i], 10); if (!isNaN(k) && k > max) max = k; }
  if (max > n) n = max; return n;
}
function _airingInfo(anilistId) {
  if (!anilistId) return Promise.resolve(null);
  if (_aioAiringCache[anilistId]) return Promise.resolve(_aioAiringCache[anilistId]);
  var query = 'query ($id: Int) { Media(id: $id, type: ANIME) { nextAiringEpisode { episode airingAt } airingSchedule(notYetAired: false, perPage: 50) { nodes { episode } } streamingEpisodes { title thumbnail } } }';
  return _requestJson(ANILIST_API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: query, variables: { id: parseInt(anilistId, 10) } }) }).then(function (j) {
    var m = j && j.data && j.data.Media; if (!m) return null; _aioAiringCache[anilistId] = m; return m;
  }).catch(function () { return null; });
}
function _jikanEpisodes(malId, total) {
  if (!malId || parseInt(malId, 10) < 1) return Promise.resolve({});
  var pages = Math.min(10, Math.max(1, Math.ceil((total || 100) / 100))), jobs = [], i;
  for (i = 1; i <= pages; i++) (function (page) { jobs.push(_requestJson(JIKAN_API + '/anime/' + encodeURIComponent(malId) + '/episodes?page=' + page).then(function (j) { return (j && j.data) || []; }).catch(function () { return []; })); })(i);
  return Promise.all(jobs).then(function (lists) { var out = {}, a, z; for (a = 0; a < lists.length; a++) for (z = 0; z < lists[a].length; z++) { var ep = lists[a][z] || {}; if (ep.mal_id) out[String(ep.mal_id)] = ep; } return out; });
}
function _resolveIds(details, az) {
  az = az || {}; var maps = az.mappings || {}, dmap = details.mappings || {};
  var mal = maps.mal_id || dmap['myanimelist/anime'] || dmap.myanimelist || '', anilist = maps.anilist_id || dmap.anilist || '', imdb = maps.imdb_id || '', tmdb = maps.themoviedb_id || dmap['themoviedb/anime'] || dmap['themoviedb/movie'] || '';
  if (String(mal).indexOf('/') >= 0) mal = String(mal).split('/').pop(); if (String(anilist).indexOf('/') >= 0) anilist = String(anilist).split('/').pop(); if (String(tmdb).indexOf('/') >= 0) tmdb = String(tmdb).split('/').pop();
  return { kitsu: String(details.id || ''), mal: String(mal || ''), anilist: String(anilist || ''), imdb: String(imdb || ''), tmdb: String(tmdb || '') };
}
function _episodeUrl(id, ep, season, ids, title, isMovie) {
  var qs = { season: season || 1, epInSeason: ep, kitsu: ids.kitsu, mal: ids.mal, anilist: ids.anilist, imdb: ids.imdb, tmdb: ids.tmdb, title: title || '', movie: isMovie ? '1' : '' };
  return 'aio://episode/' + encodeURIComponent(id) + '/' + encodeURIComponent(String(ep)) + '?' + _encodeQuery(qs);
}
function _parseQuery(s) { var o = {}, parts = String(s || '').split('&'), i, p; for (i = 0; i < parts.length; i++) { p = parts[i].split('='); if (p[0]) { try { o[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, '%20')); } catch (e) {} } } return o; }
function _parseEpisodeUrl(url) {
  var m = /^aio:\/\/episode\/([^/]+)\/([^?]+)(?:\?(.*))?$/.exec(String(url || '')); if (!m) return null;
  return { id: decodeURIComponent(m[1]), episode: decodeURIComponent(m[2]), params: _parseQuery(m[3] || '') };
}
function _buildEpisodes(details, az, kitsuEps, jikanEps, airing) {
  var attrs = details.attributes || {}, ids = _resolveIds(details, az), azEps = az.episodes || {}, count = _episodeCount(details, az), maxReleased = Infinity, nowSeconds = Math.floor(Date.now() / 1000), out = [], i, n, ae, ke, je, streamEp, title, date, num;
  if (airing && airing.nextAiringEpisode && airing.nextAiringEpisode.episode) maxReleased = Math.min(maxReleased, airing.nextAiringEpisode.episode - 1);
  for (i = 1; i <= count; i++) {
    n = String(i); ae = azEps[n] || null; ke = kitsuEps[n] || null; je = jikanEps[n] || null;
    if (i > maxReleased) continue;
    date = ae && ae.airdate || ke && ke.airdate || je && je.aired && (je.aired.from || je.aired.to) || '';
    if (date && /^\d{4}-\d{2}-\d{2}/.test(String(date)) && Date.parse(date) > Date.now()) continue;
    streamEp = airing && airing.streamingEpisodes && airing.streamingEpisodes[i - 1];
    title = ae && ae.title && (ae.title.en || ae.title.ja) || ke && ke.titles && (ke.titles.en || ke.titles.en_us || ke.titles.en_jp || ke.titles.ja_jp) || je && je.title || streamEp && streamEp.title || '';
    var image = ke && ke.thumbnail && (ke.thumbnail.original || ke.thumbnail.large || ke.thumbnail.small) || streamEp && streamEp.thumbnail || ae && ae.image || '';
    var epObj = { id: 'aio-ep-' + ids.kitsu + '-' + i, title: title ? 'Episode ' + i + ': ' + title : 'Episode ' + i, url: _episodeUrl(details.id, i, ae && ae.seasonNumber || 1, ids, _title(attrs), _kind(attrs) === 'movie'), number: i, season: ae && ae.seasonNumber || 1 };
    if (date) epObj.date = date; if (ae && ae.overview) epObj.description = ae.overview; else if (ke && ke.synopsis) epObj.description = ke.synopsis; if (image) epObj.thumbnail = image;
    if (je && (je.filler || je.recap)) epObj.filler = !!je.filler, epObj.recap = !!je.recap;
    out.push(epObj);
  }
  return out;
}
function getDetail(url) {
  var id = _idFromUrl(url); if (!id) return Promise.reject(new Error('AIOStreams: invalid anime URL'));
  return _fetchDetail(id).then(function (d) { return _anizip('kitsu_id=' + encodeURIComponent(d.id)).then(function (az) {
    var total = _episodeCount(d, az), maps = _resolveIds(d, az), airingPromise = (d.attributes.status === 'current' || d.attributes.status === 'upcoming') ? _airingInfo(maps.anilist) : Promise.resolve(null);
    return Promise.all([_requestJson(KITSU_API + '/anime/' + encodeURIComponent(id) + '/episodes?' + _encodeQuery({ 'page[limit]': 20, 'page[offset]': 0 })).then(function (j) { var o = {}; (j.data || []).forEach(function (x) { if (x.attributes && x.attributes.number) o[String(x.attributes.number)] = x.attributes; }); return o; }).catch(function () { return {}; }), _jikanEpisodes(maps.mal, total), airingPromise]).then(function (p) {
      var eps = _buildEpisodes(d, az, p[0], p[1], p[2]); var a = d.attributes, result = { id: 'aiostreams-' + id, title: _title(a) || a.canonicalTitle || 'Anime', url: 'aio://anime/' + encodeURIComponent(id), type: _kind(a), cover: _poster(a), episodes: eps, description: a.synopsis || '', genre: (d.categories || []).join(', '), status: _status(a.status), year: a.startDate ? String(a.startDate).slice(0, 4) : undefined, banner: _cover(a), totalEpisodes: total };
      return result;
    });
  }); });
}
function getEpisodes(url) { return getDetail(url).then(function (d) { return d.episodes || []; }); }
function _parseManifestUrl(url) {
  var match = /^(https?:\/\/[^/]+)\/stremio\/([^/]+)\/([^/]+)\/manifest\.json(?:\?.*)?$/i.exec(String(url || '').trim());
  if (!match) return null; return { baseUrl: match[1], uuid: match[2], encryptedBlob: match[3] };
}
function _selectApiId(ep, priority) {
  var ids = ep.ids || {}, order = String(priority || 'kitsu,imdb,mal,anilist,tmdb').split(','), isMovie = !!ep.isMovie, i, key, value, finalId;
  for (i = 0; i < order.length; i++) { key = order[i].trim(); value = ids[key]; if (!value) continue;
    if (key === 'imdb') finalId = isMovie ? value : value + ':' + (ep.season || 1) + ':' + (ep.epInSeason || ep.episode);
    else if (key === 'tmdb') { finalId = 'tmdb:' + value; if (!isMovie) finalId += ':' + (ep.season || 1) + ':' + (ep.epInSeason || ep.episode); }
    else if (key === 'kitsu') { finalId = 'kitsu:' + value; if (!isMovie) finalId += ':' + (ep.epInSeason || ep.episode); }
    else if (key === 'anilist') { finalId = 'anilist:' + value; if (!isMovie) finalId += ':' + (ep.season || 1) + ':' + (ep.epInSeason || ep.episode); }
    else if (key === 'mal') { finalId = 'mal:' + value; if (!isMovie) finalId += ':' + (ep.episode || ep.epInSeason); }
    if (finalId) return { id: finalId, type: isMovie ? 'movie' : 'series' };
  }
  return null;
}
function _authHeader(config) { var raw = config.uuid + ':' + config.encryptedBlob; var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=', bytes = [], i, c; for (i = 0; i < raw.length; i++) { c = raw.charCodeAt(i); if (c < 128) bytes.push(c); else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63)); else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63)); } var out = '', j; for (j = 0; j < bytes.length; j += 3) { var b0 = bytes[j], b1 = j + 1 < bytes.length ? bytes[j + 1] : 0, b2 = j + 2 < bytes.length ? bytes[j + 2] : 0, n = (b0 << 16) | (b1 << 8) | b2; out += alphabet[(n >> 18) & 63] + alphabet[(n >> 12) & 63] + (j + 1 < bytes.length ? alphabet[(n >> 6) & 63] : '=') + (j + 2 < bytes.length ? alphabet[n & 63] : '='); } return 'Basic ' + out; }
function _streamQuality(s) { var text = String(s.name || '') + ' ' + String(s.description || '') + ' ' + String(s.url || ''); var m = /\b(4320|2160|1080|720|480|360)p\b/i.exec(text); if (m) return m[1] + 'p'; if (/\b(4k|uhd)\b/i.test(text)) return '2160p'; if (/\.m3u8(?:\?|$)/i.test(s.url || '')) return 'hls'; if (/\.mpd(?:\?|$)/i.test(s.url || '')) return 'dash'; return 'auto'; }
function _seaDexBest(anilistId) {
  if (!anilistId) return Promise.resolve({ best: {}, fallback: {} }); if (_aioSeaDexCache[anilistId]) return Promise.resolve(_aioSeaDexCache[anilistId]);
  return _requestJson(SEADEX_API + '?' + _encodeQuery({ expand: 'trs', filter: 'alID=' + anilistId, sort: '-trs.isBest' })).then(function (j) {
    var best = {}, fallback = {}, items = j && j.items || [], i, ts, t, hash; for (i = 0; i < items.length; i++) { ts = items[i].expand && items[i].expand.trs || []; for (var x = 0; x < ts.length; x++) { t = ts[x] || {}; hash = String(t.infoHash || '').toLowerCase(); if (!/^[a-f0-9]{40}$/.test(hash)) continue; if (t.isBest) best[hash] = true; else fallback[hash] = true; } }
    var result = { best: Object.keys(best).length ? best : fallback, fallback: fallback }; _aioSeaDexCache[anilistId] = result; return result;
  }).catch(function () { return { best: {}, fallback: {} }; });
}
function _withTrackers(hash) { var url = 'magnet:?xt=urn:btih:' + hash + '&dn=' + hash; for (var i = 0; i < AIO_TRACKERS.length; i++) url += '&tr=' + encodeURIComponent(AIO_TRACKERS[i]); return url; }
function getVideoSources(episodeUrl) {
  var ep = _parseEpisodeUrl(episodeUrl); if (!ep) return Promise.reject(new Error('AIOStreams: invalid episode reference'));
  var manifest = String(_cfg('manifestUrl', '') || '').trim(); if (!manifest) return Promise.reject(new Error('AIOStreams: configure your personalized Manifest URL in source settings first'));
  var config = _parseManifestUrl(manifest); if (!config) return Promise.reject(new Error('AIOStreams: manifest URL format is invalid; expected /stremio/<uuid>/<config>/manifest.json'));
  var q = ep.params, isMovie = q.movie === '1' || ep.episode === 'movie' || ep.episode === '0', select = _selectApiId({ isMovie: isMovie, season: parseInt(q.season, 10) || 1, epInSeason: parseInt(q.epInSeason, 10) || parseInt(ep.episode, 10) || 1, episode: ep.episode, ids: { kitsu: q.kitsu, imdb: q.imdb, mal: q.mal, anilist: q.anilist, tmdb: q.tmdb } }, _cfg('idPriority', 'kitsu,imdb,mal,anilist,tmdb'));
  if (!select) return Promise.reject(new Error('AIOStreams: no supported ID mapping found for this title'));
  var apiUrl = config.baseUrl + '/api/v1/search?' + _encodeQuery({ type: select.type, id: select.id, format: 'true', requiredFields: 'infoHash' });
  var auth = _authHeader(config);
  return _requestJson(apiUrl, { headers: { Authorization: auth, Accept: 'application/json' } }).then(function (json) {
    var results = json && json.data && json.data.results; if (!Array.isArray(results)) throw new Error('AIOStreams: search response did not include data.results'); if (!results.length) throw new Error('AIOStreams: no streams found for selected anime and episode');
    var hashes = {}, bestJob = _bool(_cfg('highlightSeaDex', true), true) && q.anilist ? _seaDexBest(q.anilist) : Promise.resolve({ best: {} });
    return bestJob.then(function (sea) { var streams = [], i, s, hash, url, magnet, best, label, quality; for (i = 0; i < results.length; i++) {
      s = results[i] || {}; hash = String(s.infoHash || '').toLowerCase(); url = String(s.url || ''); if (hash === '<redacted>') hash = ''; if (hash && !/^[a-f0-9]{40}$/.test(hash)) hash = ''; magnet = /^magnet:/i.test(url) || (!url && !!hash); if (magnet && !_bool(_cfg('showP2P', false), false)) continue; if (!url && !hash) continue;
      best = !!(hash && sea.best && sea.best[hash]); label = String(s.name || 'AIOStreams stream'); quality = _streamQuality(s); if (best && _bool(_cfg('highlightSeaDex', true), true)) label = '⭐ ' + label; if (s.description) label += ' · ' + String(s.description).slice(0, 220); if (quality && quality !== 'auto' && quality !== 'hls' && quality !== 'dash') label += ' · ' + quality;
      if (magnet) url = _withTrackers(hash || (url.match(/btih:([a-f0-9]{40})/i) || [])[1] || '');
      if (magnet && !/^magnet:\?xt=urn:btih:[a-f0-9]{40}/i.test(url)) continue;
      var item = { url: url, quality: quality, label: label, title: label, container: /\.m3u8(?:\?|$)/i.test(url) ? 'hls' : /\.mpd(?:\?|$)/i.test(url) ? 'dash' : undefined, kind: magnet ? 'torrent' : 'video', preferred: best };
      if (!magnet) item.headers = { Authorization: auth };
      if (hash) hashes[hash] = true; streams.push(item);
    }
    if (_bool(_cfg('sortSeaDex', true), true)) streams.sort(function (a, b) { return Number(!!b.preferred) - Number(!!a.preferred); });
    if (!streams.length) throw new Error('AIOStreams: no playable streams remain; enable torrent/P2P results if appropriate, or check your AIOStreams config'); return streams;
    });
  });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, _parseManifestUrl: _parseManifestUrl, _selectApiId: _selectApiId };
