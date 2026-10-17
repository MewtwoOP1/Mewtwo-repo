// Ani.pm — anime provider for Zangetsu.
// Uses Ani.pm's catalogue + series APIs and resolves direct HLS/MP4 server entries.
// Embed/iframe-only entries are deliberately excluded: they are not direct streams.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'anipm';
var SITE = 'https://ani.pm';
var API = SITE + '/api/anime';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
var cache = {};

function getInfo() {
  return { name: 'Ani.pm', lang: 'en', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.7' };
}
function getSettings() { return []; }
function _mode(opts) { return (opts && opts.category === 'dub') ? 'dub' : 'sub'; }
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _num(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
}

function _absolute(url, base) {
  if (!url) return null;
  var value = String(url);
  if (/^https?:\/\//i.test(value)) return value;
  if (value.indexOf('//') === 0) return 'https:' + value;

  var originBase = String(base || SITE + '/');
  try {
    if (typeof URL === 'function') return new URL(value, originBase).href;
  } catch (e) {}

  // QuickJS runtimes do not always expose the browser URL constructor. Resolve
  // relative playlist/subtitle URLs without it so the player never receives a
  // bare "1080/index.m3u8" path. Strip query/hash first (signed master URLs
  // can carry tokens), then resolve against the containing directory.
  var cleanBase = originBase.split('#')[0].split('?')[0];
  var originMatch = cleanBase.match(/^(https?:\/\/[^/]+)/i);
  var origin = originMatch ? originMatch[1] : SITE;
  if (value.charAt(0) === '/') return origin + value;
  if (!originMatch) cleanBase = SITE + '/' + cleanBase.replace(/^\/+/, '');
  if (cleanBase.charAt(cleanBase.length - 1) !== '/') {
    cleanBase = cleanBase.substring(0, cleanBase.lastIndexOf('/') + 1);
  }
  return cleanBase + value;
}
function _headers(ref) {
  return {
    'User-Agent': UA,
    'Referer': ref || SITE + '/',
    'Origin': SITE,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-CH-UA': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'X-Requested-With': 'XMLHttpRequest'
  };
}

function _jsonRequest(url, headers) {
  return fetch(url, { headers: headers || {}, timeoutMs: 12000 }).then(function (r) {
    if (!r) return null;
    var status = Number(r.status) || 0;
    if (status && (status < 200 || status >= 300)) return null;
    try { var j = JSON.parse(r.body || 'null'); return j && typeof j === 'object' ? j : null; }
    catch (e) { return null; }
  }).catch(function () { return null; });
}
function _json(url, ref) { return _jsonRequest(url, _headers(ref || SITE + '/')); }
function _payloadItems(j) {
  if (!j) return [];
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.items)) return j.items;
  if (Array.isArray(j.results)) return j.results;
  if (j.data && Array.isArray(j.data.items)) return j.data.items;
  if (j.data && Array.isArray(j.data.results)) return j.data.results;
  return [];
}
function _id(item) { return _num(item && (item.id || item.seriesId || item.animeId)); }

function _slug(item) { return _trim(item && (item.slug || item.urlSlug || item.url_slug) || ''); }
function _route(item) {
  if (!item) return '';
  var route = item.routeId || item.route_id || item.route || '';
  if (route) return _trim(route);
  var slug = _slug(item), id = item.id || item.seriesId || item.animeId;
  if (slug && id != null && String(id)) return slug + '-' + String(id);
  return slug;
}

function _title(item) {
  var t = item && item.title;
  if (t && typeof t === 'object') t = t.english || t.romaji || t.native || t.userPreferred;
  return _trim(t || item && (item.english || item.name || item.native) || 'Untitled');
}

function _titles(item) {
  var t = item && item.title, titleObject = t && typeof t === 'object' ? t : {};
  return {
    englishTitle: _trim(titleObject.english || (typeof t === 'string' ? t : '') || item && (item.english || item.name) || ''),
    nativeTitle: _trim(titleObject.native || titleObject.romaji || item && (item.native || item.nativeTitle) || ''),
    malId: _num(item && (item.malId || item.mal_id || item.idMal || item.id_mal)),
    anilistId: _num(item && (item.anilistId || item.anilist_id || item.aniListId))
  };
}

function _card(item) {
  var rawId = item && (item.id || item.seriesId || item.animeId);
  var id = _num(rawId), slug = _slug(item), route = _route(item);
  if (!id && !route) return null;
  var keyId = id ? String(id) : String(route), meta = _titles(item), title = _title(item);
  var url = 'anipm://' + encodeURIComponent(keyId) + '|' + encodeURIComponent(slug) + '|'
    + encodeURIComponent(title) + '|' + encodeURIComponent(String(item.year || item.seasonYear || ''))
    + '|' + (meta.malId || '') + '|' + (meta.anilistId || '') + '|'
    + encodeURIComponent(route || slug) + '|'
    + encodeURIComponent(item.source === 'anilist' ? 'anilist' : (item.source === 'settlar' ? 'settlar' : ''));
  cache[keyId] = item;
  return {
    id: url, title: title, englishTitle: meta.englishTitle || title, nativeTitle: meta.nativeTitle || null,
    cover: item.poster || item.cover || item.image || null, banner: item.banner || null,
    description: item.synopsis || item.description || '', url: url,
    type: item.format === 'MOVIE' ? 'movie' : 'anime', sourceId: SOURCE_ID,
    year: item.year || item.seasonYear || null, malId: meta.malId, anilistId: meta.anilistId,
    subCount: _num(item.subCount) || _num(item.episodeCount) || _num(item.episodes) || 0,
    dubCount: _num(item.dubCount) || 0
  };
}

function _itemsFromSearchResponse(j) { return _payloadItems(j); }
function _searchCurrent(query) {
  return _json(API + '/search?q=' + encodeURIComponent(query || ''), SITE + '/').then(_itemsFromSearchResponse);
}
function _searchLegacy(query, page) {
  return _json(API + '/catalog?q=' + encodeURIComponent(query || '') + '&page=' + Math.max(1, Number(page) || 1), SITE + '/')
    .then(_itemsFromSearchResponse);
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  function cards(items) {
    var out = [], seen = {};
    for (var i = 0; i < items.length; i++) { var c = _card(items[i]); if (c && !seen[c.url]) { seen[c.url] = 1; out.push(c); } }
    return out;
  }
  return _searchCurrent(q).then(function (items) {
    if (items.length) return cards(items);
    return _searchLegacy(q, page).then(cards);
  }).catch(function () { return []; });
}

function getHome(opts) {
  function cards(items) {
    var out = [], seen = {};
    for (var i = 0; i < items.length; i++) { var c = _card(items[i]); if (c && !seen[c.url]) { seen[c.url] = 1; out.push(c); } }
    return out;
  }
  var trending = _json(API + '/catalog?sort=trending&page=1', SITE + '/').then(function (j) { return cards(_payloadItems(j)); }).catch(function () { return []; });
  var recent = _json(API + '/latest-episodes?page=1&limit=60', SITE + '/').then(function (j) {
    var items = _payloadItems(j), media = [];
    for (var i = 0; i < items.length; i++) { var item = items[i] || {}; media.push(item.media || item.series || item.anime || item); }
    return cards(media);
  }).catch(function () { return []; });
  return Promise.all([trending, recent]).then(function (rows) {
    var out = [];
    if (rows[0].length) out.push({ title: 'Trending Now', items: rows[0] });
    if (rows[1].length) out.push({ title: 'Latest Episodes', items: rows[1] });
    if (out.length) return out;
    return _json(API + '/catalog?page=1', SITE + '/').then(function (j) {
      var items = cards(_payloadItems(j)); return items.length ? [{ title: 'Ani.pm Catalogue', items: items }] : [];
    }).catch(function () { return []; });
  });
}
function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    (rows || []).forEach(function (row) { (row.items || []).forEach(function (item) { out.push(item); }); });
    return out;
  });
}

function _parseCardUrl(url) {
  var p = String(url || '').replace(/^anipm:\/\//, '').split('|');
  if (!p.length) return null;
  var rawId = decodeURIComponent(p[0] || '');
  if (!rawId) return null;
  var slug = decodeURIComponent(p[1] || '');
  return {
    id: rawId, catalogId: _num(rawId), slug: slug, title: decodeURIComponent(p[2] || ''),
    year: decodeURIComponent(p[3] || ''), malId: _num(p[4]), anilistId: _num(p[5]),
    routeId: decodeURIComponent(p[6] || '') || (slug && rawId ? slug + '-' + rawId : slug),
    source: decodeURIComponent(p[7] || '')
  };
}

function _seriesFrom(j) {
  if (!j) return null;
  return j.series || j.anime || j.item || (j.data && (j.data.series || j.data.anime || j.data.item || j.data)) || j;
}
function _episodes(series) {
  var source = Array.isArray(series.episodes) ? series.episodes
    : (series.data && Array.isArray(series.data.episodes) ? series.data.episodes : []);
  var out = [], seen = {};
  for (var i = 0; i < source.length; i++) {
    var ep = source[i] || {};
    var n = _num(ep.number || ep.episodeNumber || ep.ep || ep.episode) || (i + 1);
    if (seen[String(n)]) continue;
    seen[String(n)] = 1;
    out.push({ raw: ep, number: n, title: _trim(ep.title || ep.name || ('Episode ' + n)) });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}

function _episodeUrl(cat, id, slug, ep, malId, anilistId, source, catalogId, title) {
  return 'anipm-episode://' + cat + '|' + encodeURIComponent(String(id || '')) + '|'
    + encodeURIComponent(slug || '') + '|' + ep + '|' + (malId || '') + '|' + (anilistId || '')
    + '|' + encodeURIComponent(source || '') + '|' + (catalogId || '') + '|' + encodeURIComponent(title || '');
}
function _seriesRoute(key) { return key.routeId || (key.slug && key.id ? key.slug + '-' + key.id : key.slug || key.id); }
function _loadSeries(key) {
  var route = _seriesRoute(key);
  return _json(API + '/series/' + encodeURIComponent(route) + '?routes=e4', SITE + '/').then(function (j) {
    var series = _seriesFrom(j);
    if (series && typeof series === 'object' && _title(series) !== 'Untitled') return series;
    if (String(key.id) === String(route)) return cache[String(key.id)] || null;
    return _json(API + '/series/' + encodeURIComponent(String(key.id)), SITE + '/').then(function (oldJ) {
      var oldSeries = _seriesFrom(oldJ);
      return oldSeries && typeof oldSeries === 'object' && _title(oldSeries) !== 'Untitled' ? oldSeries : (cache[String(key.id)] || null);
    });
  }).catch(function () { return cache[String(key.id)] || null; });
}

function getDetail(url, opts) {
  var key = _parseCardUrl(url);
  if (!key) return Promise.resolve(null);
  var cached = cache[String(key.id)] || {};
  return _loadSeries(key).then(function (series) {
    series = series || cached;
    if (!series || typeof series !== 'object') return null;
    var title = _title(series) !== 'Untitled' ? _title(series) : (key.title || 'Untitled');
    var meta = _titles(series), slug = _slug(series) || key.slug;
    var route = _route(series) || key.routeId || _seriesRoute(key), eps = _episodes(series);
    var subCount = _num(series.subCount) || _num(series.episodeCount) || eps.length;
    var dubCount = _num(series.dubCount) || eps.filter(function (e) { return !!e.raw.dub; }).length;
    var source = series.source === 'anilist' ? 'anilist' : 'settlar';
    var playbackId = series.id || series.sid || route || key.id;
    var result = {
      id: 'anipm://' + key.id, title: title, englishTitle: meta.englishTitle || key.title || title,
      nativeTitle: meta.nativeTitle || null, cover: series.poster || series.cover || series.image || cached.poster || null,
      banner: series.banner || cached.banner || null, description: series.synopsis || series.description || cached.synopsis || '',
      status: series.status || 'unknown', genres: Array.isArray(series.genres) ? series.genres : [],
      studios: Array.isArray(series.studios) ? series.studios : [],
      type: series.format === 'MOVIE' ? 'movie' : 'anime', sourceId: SOURCE_ID,
      year: _num(series.year) || _num(series.seasonYear) || _num(key.year),
      malId: meta.malId || _num(series.idMal) || key.malId,
      anilistId: meta.anilistId || _num(series.anilistId) || key.anilistId,
      routeId: route, playbackSource: source, subCount: subCount, dubCount: dubCount, episodes: []
    };
    for (var i = 0; i < eps.length; i++) {
      var ep = eps[i];
      result.episodes.push({
        id: String(ep.number), number: ep.number, title: ep.title,
        thumbnail: ep.raw.thumbnail || null, description: ep.raw.description || '',
        url: _episodeUrl(_mode(opts), playbackId, slug, ep.number, result.malId,
          result.anilistId, source, key.catalogId || _num(key.id), title)
      });
    }
    return result;
  }).catch(function () { return null; });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d ? d.episodes : []; }).catch(function () { return []; });
}

function _parseEpisodeUrl(url) {
  var p = String(url || '').replace(/^anipm-episode:\/\//, '').split('|');
  if (p.length < 4) return null;
  var rawId = decodeURIComponent(p[1] || ''), ep = _num(p[3]);
  if (!rawId || !ep) return null;
  return {
    category: p[0] === 'dub' ? 'dub' : 'sub', id: rawId,
    slug: decodeURIComponent(p[2] || ''), episode: ep, malId: _num(p[4]), anilistId: _num(p[5]),
    source: decodeURIComponent(p[6] || ''), catalogId: _num(p[7]) || _num(rawId),
    title: decodeURIComponent(p[8] || ''), isLegacy: p.length < 7
  };
}

function _serverList(j, cat) {
  if (!j) return [];
  var data = j.data && !Array.isArray(j.data) ? j.data : j;
  return Array.isArray(data[cat]) ? data[cat] : [];
}

function _serverRequest(key, title, id) {
  var params = 'title=' + encodeURIComponent(title || '') + '&ep=' + encodeURIComponent(key.episode)
    + (id ? '&anilistId=' + encodeURIComponent(String(id)) : '')
    + (key.malId ? '&malId=' + encodeURIComponent(key.malId) : '');
  return _json(API + '/src/servers?' + params, SITE + '/').then(function (j) {
    return { json: j, list: _serverList(j, key.category) };
  });
}

function _currentPlayback(key, category, withBackup) {
  var lang = category || key.category;
  var source = key.source === 'anilist' ? 'anilist' : 'settlar';
  var path = '/playback-bootstrap/' + source + '/' + encodeURIComponent(key.id)
    + '?ep=' + encodeURIComponent(key.episode) + '&lang=' + encodeURIComponent(lang)
    + (withBackup ? '&backup=1' : '');
  return _json(API + path, SITE + '/').then(function (boot) {
    if (boot) return boot;
    if (key.source) return null;
    var alt = '/playback-bootstrap/anilist/' + encodeURIComponent(key.id)
      + '?ep=' + encodeURIComponent(key.episode) + '&lang=' + encodeURIComponent(lang)
      + (withBackup ? '&backup=1' : '');
    return _json(API + alt, SITE + '/');
  }).catch(function () { return null; });
}

function _streamsFromBootstrap(boot, key, category) {
  var lang = category || key.category;
  if (!boot || !boot.settlarSelection) return Promise.resolve([]);
  var sessPath = '/settlar/session?selection=' + encodeURIComponent(boot.settlarSelection)
    + '&provider=anipm&ep=' + encodeURIComponent(key.episode)
    + '&channel=' + encodeURIComponent(lang) + '&telemetry=0';
  return _json(API + sessPath, SITE + '/').then(function (session) {
    if (!session || !session.embedUrl) return [];
    var tokenMatch = String(session.embedUrl).match(/[?&]t=([^&#]+)/);
    if (!tokenMatch) return [];
    var hostMatch = String(session.embedUrl).match(/^(https?:\/\/[^/]+)/);
    var host = hostMatch ? hostMatch[1] : 'https://embed.settlar.io';
    var hdrs = {
      'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'en-US,en;q=0.9',
      'Referer': session.embedUrl, 'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty'
    };
    return _jsonRequest(host + '/api/embed/session?t=' + tokenMatch[1], hdrs).then(function (data) {
      if (!data || !data.source) return [];
      var subtitles = [], seenSubs = [], tracks = Array.isArray(data.subtitles) ? data.subtitles.slice() : [];
      tracks.sort(function (a, b) { return (b.default ? 1 : 0) - (a.default ? 1 : 0); });
      for (var i = 0; i < tracks.length; i++) {
        var tr = tracks[i] || {}, u = _absolute(tr.url || tr.file, session.embedUrl);
        if (!u || seenSubs.indexOf(u) >= 0) continue;
        seenSubs.push(u);
        subtitles.push({ url: u, file: u, lang: tr.srclang || tr.lang || tr.label || 'und',
          label: tr.label || tr.srclang || tr.lang || 'Subtitles',
          format: /\.vtt(?:\?|$)/i.test(u) ? 'vtt' : (/\.srt(?:\?|$)/i.test(u) ? 'srt' : 'unknown'),
          default: !!tr.default });
      }
      return fetch(data.source, { headers: { 'User-Agent': UA }, timeoutMs: 12000 }).then(function (r) {
        var status = Number(r && r.status) || 0;
        if (!r || (status && (status < 200 || status >= 300))) return [];
        var body = r.body || '';
        if (body.indexOf('#EXTM3U') < 0) return [];
        var variants = _parseMaster(body, data.source);
        if (!variants.length) variants = [{ url: data.source, height: 0 }];
        var out = [];
        for (var v = 0; v < variants.length; v++) {
          var h = variants[v].height;
          out.push({ url: variants[v].url, quality: h ? h + 'p' : 'auto',
            label: 'Ani.pm · ' + (lang === 'dub' ? 'Dub' : 'Sub') + ' · ' + (h ? h + 'p' : 'Auto'),
            container: 'hls', headers: {}, kind: lang,
            audioLang: lang === 'dub' ? 'en' : 'ja', subtitles: subtitles });
        }
        return out;
      }).catch(function () { return []; });
    });
  }).catch(function () { return []; });
}

function _parseMaster(text, masterUrl) {
  if (!text || String(text).indexOf('#EXTM3U') < 0) return [];
  if (/#EXT-X-MEDIA:[^\r\n]*TYPE=AUDIO/i.test(text)) return [];
  var lines = String(text).split(/\r?\n/), out = [], seen = {};
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].indexOf('#EXT-X-STREAM-INF') < 0) continue;
    var m = lines[i].match(/RESOLUTION=(\d+)x(\d+)/i), height = m ? Number(m[2]) : 0, uri = '';
    for (var j = i + 1; j < lines.length; j++) {
      var line = _trim(lines[j]);
      if (line && line.charAt(0) !== '#') { uri = line; break; }
    }
    if (!uri) continue;
    var resolved = _absolute(uri, masterUrl);
    if (!resolved || seen[resolved]) continue;
    seen[resolved] = 1; out.push({ url: resolved, height: height });
  }
  out.sort(function (a, b) { return b.height - a.height; });
  return out;
}
function _legacyStreams(key) {
  var ids = [];
  function addId(v) { if (v != null && String(v) !== '' && ids.indexOf(String(v)) < 0) ids.push(String(v)); }
  if (key.source === 'anilist') addId(key.id);
  addId(key.anilistId); addId(key.catalogId);
  if (key.source !== 'anilist') addId(key.id);
  var titles = [];
  function addTitle(v) { if (v && titles.indexOf(String(v)) < 0) titles.push(String(v)); }
  addTitle(key.title); addTitle(key.slug);
  if (!titles.length) addTitle(key.id);
  function tryAt(i, j) {
    if (i >= ids.length) return Promise.resolve([]);
    if (j >= titles.length) return tryAt(i + 1, 0);
    return _serverRequest(key, titles[j], ids[i]).then(function (result) {
      if (result.list && result.list.length) return _mapLegacyServers(result.list, key);
      return tryAt(i, j + 1);
    }).catch(function () { return tryAt(i, j + 1); });
  }
  return tryAt(0, 0);
}
function _mapLegacyServers(servers, key) {
  var out = [], seen = {};
  servers.sort(function (a, b) { return (_num(b.priority) || 0) - (_num(a.priority) || 0); });
  for (var i = 0; i < servers.length; i++) {
    var s = servers[i] || {}, kind = String(s.kind || '').toLowerCase();
    if ((kind !== 'hls' && kind !== 'file') || !s.url) continue;
    var u = _absolute(s.url, SITE + '/');
    if (!u || seen[u]) continue;
    seen[u] = 1;
    out.push({ url: u, quality: s.quality || s.name || s.provider || (kind === 'hls' ? 'HLS' : 'MP4'),
      container: kind === 'hls' ? 'hls' : 'mp4',
      headers: { 'User-Agent': UA, 'Referer': SITE + '/', 'Origin': SITE },
      kind: key.category, audioLang: key.category === 'dub' ? 'en' : 'ja',
      subtitles: _subtitles(s), label: 'Ani.pm · ' + (s.name || s.provider || kind) });
  }
  return out;
}
function _subtitles(server) {
  var out = [], seen = {};
  var items = [];
  if (server.subtitle) items.push({ file: server.subtitle, label: 'Subtitles', kind: 'captions' });
  if (Array.isArray(server.tracks)) items = items.concat(server.tracks);
  for (var i = 0; i < items.length; i++) {
    var tr = items[i] || {}, u = _absolute(tr.file || tr.url);
    if (!u || seen[u]) continue;
    seen[u] = 1;
    out.push({ url: u, lang: tr.label || tr.lang || 'und', label: tr.label || tr.lang || 'Subtitles',
      format: /\.vtt(?:\?|$)/i.test(u) ? 'vtt' : (/\.srt(?:\?|$)/i.test(u) ? 'srt' : 'unknown') });
  }
  return out;
}



var MEGAPLAY_ENC_KEY = "i?LMTAx0Q6,:}50U";
var MEGAPLAY_ENC_IV = "W0;27ToaUpl_P%'c";
var MEGAPLAY_CDN_SECRET = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";
var MEGAPLAY_TOKEN_TTL = 21600;
function _padBytes(s, n) {
  var out = [], v = String(s || '');
  for (var i = 0; i < n; i++) out[i] = i < v.length ? v.charCodeAt(i) & 255 : 0;
  return out;
}
function _b64urlDecodeBytes(s) {
  var t = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  while (t.length % 4) t += '=';
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = [];
  for (var i = 0; i < t.length; i += 4) {
    var a = chars.indexOf(t.charAt(i)), b = chars.indexOf(t.charAt(i + 1));
    var c = t.charAt(i + 2) === '=' ? -1 : chars.indexOf(t.charAt(i + 2));
    var d = t.charAt(i + 3) === '=' ? -1 : chars.indexOf(t.charAt(i + 3));
    if (a < 0 || b < 0) break;
    out.push((a << 2) | (b >> 4));
    if (c >= 0) out.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) out.push(((c & 3) << 6) | d);
  }
  return out;
}

var _SBOX=[0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _ISBOX=[0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
function _xtime(a){a<<=1;if(a&0x100)a^=0x11b;return a&0xff;}
function _gmul(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return p&0xff;}
function _keyExp(key){
  var Nk=key.length/4,Nr=Nk+6,w=[],i;
  for(i=0;i<Nk;i++)w.push([key[4*i],key[4*i+1],key[4*i+2],key[4*i+3]]);
  var rcon=1;
  for(i=Nk;i<4*(Nr+1);i++){
    var t=w[i-1].slice();
    if(i%Nk===0){t=[t[1],t[2],t[3],t[0]];t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];t[0]^=rcon;rcon=_xtime(rcon);}
    else if(Nk>6&&i%Nk===4){t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];}
    w.push([w[i-Nk][0]^t[0],w[i-Nk][1]^t[1],w[i-Nk][2]^t[2],w[i-Nk][3]^t[3]]);
  }
  return {w:w,Nr:Nr};
}
function _invCipher(inb,ks){
  var w=ks.w,Nr=ks.Nr,s=[[],[],[],[]],r,c,i;
  for(i=0;i<16;i++)s[i%4][(i/4)|0]=inb[i];
  function ark(round){for(c=0;c<4;c++)for(r=0;r<4;r++)s[r][c]^=w[round*4+c][r];}
  function isub(){for(r=0;r<4;r++)for(c=0;c<4;c++)s[r][c]=_ISBOX[s[r][c]];}
  function ishift(){for(r=1;r<4;r++){var row=s[r].slice();for(c=0;c<4;c++)s[r][c]=row[(c-r+4)%4];}}
  function imix(){for(c=0;c<4;c++){var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,14)^_gmul(a1,11)^_gmul(a2,13)^_gmul(a3,9);
    s[1][c]=_gmul(a0,9)^_gmul(a1,14)^_gmul(a2,11)^_gmul(a3,13);
    s[2][c]=_gmul(a0,13)^_gmul(a1,9)^_gmul(a2,14)^_gmul(a3,11);
    s[3][c]=_gmul(a0,11)^_gmul(a1,13)^_gmul(a2,9)^_gmul(a3,14);}}
  ark(Nr);
  for(var round=Nr-1;round>=1;round--){ishift();isub();ark(round);imix();}
  ishift();isub();ark(0);
  var out=[];for(i=0;i<16;i++)out[i]=s[i%4][(i/4)|0];return out;
}
function _aesCbcDecrypt(ct,key,iv){
  var ks=_keyExp(key),out=[],prev=iv.slice(),off,i;
  for(off=0;off+16<=ct.length;off+=16){
    var block=ct.slice(off,off+16),dec=_invCipher(block,ks);
    for(i=0;i<16;i++)out.push(dec[i]^prev[i]);
    prev=block;
  }
  var pad=out[out.length-1];
  if(pad>0&&pad<=16)out=out.slice(0,out.length-pad);
  return out;
}
function _bytesToStr(b){var s='',i=0;while(i<b.length){var c=b[i++];if(c<0x80)s+=String.fromCharCode(c);else if(c<0xE0)s+=String.fromCharCode(((c&0x1f)<<6)|(b[i++]&0x3f));else if(c<0xF0)s+=String.fromCharCode(((c&0x0f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f));else{var cp=((c&0x07)<<18)|((b[i++]&0x3f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f);cp-=0x10000;s+=String.fromCharCode(0xD800+(cp>>10),0xDC00+(cp&0x3FF));}}return s;}
function _bytesOf(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 0xff);
    return out;
  }

function _sha256(bytes) {
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
      0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
      0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
      0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
      0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
      0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    var H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    var msg = bytes.slice();
    var bitLen = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    // Inputs here are a few hundred bytes at most, so the high length word is 0.
    msg.push(0, 0, 0, 0);
    msg.push((bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

    var rotr = function (x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; };
    var w = new Array(64);
    for (var off = 0; off < msg.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        w[t] = ((msg[off + t * 4] << 24) | (msg[off + t * 4 + 1] << 16) |
                (msg[off + t * 4 + 2] << 8) | msg[off + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var s0 = (rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)) >>> 0;
        var s1 = (rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)) >>> 0;
        w[t] = (((w[t - 16] + s0) >>> 0) + ((w[t - 7] + s1) >>> 0)) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3];
      var e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var temp1 = (((((h + S1) >>> 0) + ch) >>> 0) + ((K[t] + w[t]) >>> 0)) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e;
        e = (d + temp1) >>> 0;
        d = c; c = b; b = a;
        a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = [];
    for (var i = 0; i < 8; i++) {
      out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff);
    }
    return out;
  }

function _hmacSha256(keyStr, msgStr) {
    var key = _bytesOf(keyStr);
    if (key.length > 64) key = _sha256(key);
    while (key.length < 64) key.push(0);
    var ipad = [], opad = [];
    for (var i = 0; i < 64; i++) { ipad.push(key[i] ^ 0x36); opad.push(key[i] ^ 0x5c); }
    var inner = _sha256(ipad.concat(_bytesOf(msgStr)));
    return _sha256(opad.concat(inner));
  }

function _b64urlEncode(bytes) {
    var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    var out = "", i = 0, n = bytes.length;
    while (i < n) {
      var a = bytes[i++];
      out += t[a >> 2];
      if (i === n) { out += t[(a & 3) << 4]; break; }
      var b = bytes[i++];
      out += t[((a & 3) << 4) | (b >> 4)];
      if (i === n) { out += t[(b & 15) << 2]; break; }
      var c = bytes[i++];
      out += t[((b & 15) << 2) | (c >> 6)];
      out += t[c & 63];
    }
    return out; // padding omitted, as the player's own encoder does
  }

function _decodeEncSources(enc) {
  try {
    var ct = _b64urlDecodeBytes(enc);
    if (!ct.length || ct.length % 16 !== 0) return '';
    var plain = _aesCbcDecrypt(ct, _padBytes(MEGAPLAY_ENC_KEY, 32), _padBytes(MEGAPLAY_ENC_IV, 16));
    var text = _bytesToStr(plain), data = JSON.parse(text);
    if (typeof data === 'string') return data;
    if (data && data.file) return data.file;
    if (data && data.sources) {
      var s = data.sources;
      return typeof s === 'string' ? s : (s.file || (Array.isArray(s) && s[0] && s[0].file) || '');
    }
    if (Array.isArray(data) && data.length) return data[0].file || data[0].url || '';
  } catch (e) {}
  return '';
}
function _signCdnUrl(url) {
  if (!url || /[?&]token=/.test(url)) return url;
  var m = String(url).match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
  if (!m) return url;
  var path = m[1].toLowerCase() + '/' + m[2].toLowerCase();
  var msg = (Math.floor(Date.now() / 1000) + MEGAPLAY_TOKEN_TTL) + '|' + path;
  var token = _b64urlEncode(_bytesOf(msg)) + '.' + _b64urlEncode(_hmacSha256(MEGAPLAY_CDN_SECRET, msg));
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + token;
}
function _megaplayStreams(boot, key, category) {
  var be = boot && boot.backupEmbed;
  if (!be || !be.available || !be.url) return Promise.resolve([]);
  var apiHostMatch = String(be.url).match(/^(https?:\/\/[^/]+)/);
  if (!apiHostMatch) return Promise.resolve([]);
  var apiHost = apiHostMatch[1];
  return fetch(be.url, { headers: { 'User-Agent': UA, 'Referer': SITE + '/' }, timeoutMs: 12000 }).then(function (page) {
    var status = Number(page && page.status) || 0;
    if (!page || (status && (status < 200 || status >= 300))) return [];
    var dataId = ((page.body || '').match(/data-id="(\d+)"/) || [])[1];
    if (!dataId) return [];
    return _jsonRequest(apiHost + '/stream/getSources?id=' + encodeURIComponent(dataId), {
      'User-Agent': UA, 'Referer': apiHost + '/', 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json'
    }).then(function (sd) {
      var source = '';
      if (sd && sd.sources) {
        if (typeof sd.sources === 'string') source = sd.sources;
        else if (sd.sources.file) source = sd.sources.file;
        else if (Array.isArray(sd.sources) && sd.sources.length) source = sd.sources[0].file || '';
      }
      if (!source && sd && sd.enc) source = _decodeEncSources(sd.enc);
      if (!source) return [];
      source = _signCdnUrl(source);
      return fetch(source, { headers: { 'User-Agent': UA, 'Referer': apiHost + '/' }, timeoutMs: 12000 }).then(function (playlist) {
        var status = Number(playlist && playlist.status) || 0, body = playlist && playlist.body || '';
        if (!playlist || (status && (status < 200 || status >= 300)) || body.indexOf('#EXTM3U') < 0) return [];
        var variants = _parseMaster(body, source);
        if (!variants.length) variants = [{ url: source, height: 0 }];
        var out = [];
        for (var i = 0; i < variants.length; i++) {
          var h = variants[i].height;
          out.push({ url: variants[i].url, quality: h ? h + 'p' : 'auto',
            label: 'Ani.pm · MegaPlay · ' + (category === 'dub' ? 'Dub' : 'Sub') + ' · ' + (h ? h + 'p' : 'Auto'),
            container: 'hls', headers: { 'User-Agent': UA, 'Referer': apiHost + '/' },
            kind: category, audioLang: category === 'dub' ? 'en' : 'ja', subtitles: [] });
        }
        return out;
      }).catch(function () { return []; });
    }).catch(function () { return []; });
  }).catch(function () { return []; });
}

function getVideoSources(episodeUrl, opts) {
  var key = _parseEpisodeUrl(episodeUrl);
  if (!key) return Promise.resolve([]);
  var langs = key.category === 'dub' ? ['dub', 'sub'] : ['sub', 'dub'];
  var boots = {}, availability = null;

  function cloneForLang(lang) {
    var langKey = {};
    Object.keys(key).forEach(function (k) { langKey[k] = key[k]; });
    langKey.category = lang;
    return langKey;
  }
  function primaryAt(i) {
    if (i >= langs.length) return backupAt(0);
    var lang = langs[i];
    if (availability && availability[lang] === false) return primaryAt(i + 1);
    var langKey = cloneForLang(lang);
    return _currentPlayback(langKey, lang, false).then(function (boot) {
      if (boot && boot.availability) availability = boot.availability;
      if (!boot || (boot.effectiveLanguage && boot.effectiveLanguage !== lang)) return primaryAt(i + 1);
      boots[lang] = boot;
      return _streamsFromBootstrap(boot, langKey, lang).then(function (streams) {
        if (streams && streams.length) return streams;
        return primaryAt(i + 1);
      });
    }).catch(function () { return primaryAt(i + 1); });
  }
  function backupAt(i) {
    if (i >= langs.length) return legacyAt(0);
    var lang = langs[i];
    if (availability && availability[lang] === false) return backupAt(i + 1);
    var langKey = cloneForLang(lang);
    function tryBackup(boot) {
      return _megaplayStreams(boot, langKey, lang).then(function (streams) {
        if (streams && streams.length) return streams;
        return backupAt(i + 1);
      }).catch(function () { return backupAt(i + 1); });
    }
    var existing = boots[lang];
    if (existing && existing.backupEmbed && existing.backupEmbed.available) return tryBackup(existing);
    return _currentPlayback(langKey, lang, true).then(function (boot) {
      if (boot && boot.availability) availability = boot.availability;
      if (boot && boot.effectiveLanguage && boot.effectiveLanguage !== lang) return backupAt(i + 1);
      if (boot) boots[lang] = boot;
      return tryBackup(boot);
    }).catch(function () { return backupAt(i + 1); });
  }
  function legacyAt(i) {
    if (i >= langs.length) return Promise.resolve([]);
    var langKey = cloneForLang(langs[i]);
    return _legacyStreams(langKey).then(function (streams) {
      if (streams && streams.length) return streams;
      return legacyAt(i + 1);
    }).catch(function () { return legacyAt(i + 1); });
  }
  return primaryAt(0).then(function (streams) {
    var out = [], seen = {};
    for (var i = 0; i < (streams || []).length; i++) {
      var item = streams[i] || {};
      if (!item.url || seen[item.url]) continue;
      seen[item.url] = 1;
      out.push(item);
    }
    return out;
  }).catch(function () { return []; });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.7', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources,
    getStreams: getStreams, getLinks: getLinks
  };
}
