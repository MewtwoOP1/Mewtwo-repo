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
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.6' };
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
function _currentPlayback(key) {
  var source = key.source === 'anilist' ? 'anilist' : 'settlar';
  var path = '/playback-bootstrap/' + source + '/' + encodeURIComponent(key.id)
    + '?ep=' + encodeURIComponent(key.episode) + '&lang=' + encodeURIComponent(key.category);
  return _json(API + path, SITE + '/').then(function (boot) {
    if (!boot) {
      if (key.source) return [];
      var alt = '/playback-bootstrap/anilist/' + encodeURIComponent(key.id)
        + '?ep=' + encodeURIComponent(key.episode) + '&lang=' + encodeURIComponent(key.category);
      return _json(API + alt, SITE + '/').then(function (fallbackBoot) { return _streamsFromBootstrap(fallbackBoot, key); });
    }
    if (boot.effectiveLanguage && boot.effectiveLanguage !== key.category) return [];
    if (boot.availability && boot.availability[key.category] === false) return [];
    return _streamsFromBootstrap(boot, key);
  }).catch(function () { return []; });
}
function _streamsFromBootstrap(boot, key) {
  if (!boot || !boot.settlarSelection) return Promise.resolve([]);
  var sessPath = '/settlar/session?selection=' + encodeURIComponent(boot.settlarSelection)
    + '&provider=anipm&ep=' + encodeURIComponent(key.episode)
    + '&channel=' + encodeURIComponent(key.category) + '&telemetry=0';
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
          format: /\.vtt(?:\?|$)/i.test(u) ? 'vtt' : (/\.srt(?:\?|$)/i.test(u) ? 'srt' : 'unknown') });
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
            label: 'Ani.pm · ' + (key.category === 'dub' ? 'Dub' : 'Sub') + ' · ' + (h ? h + 'p' : 'Auto'),
            container: 'hls', headers: {}, kind: key.category,
            audioLang: key.category === 'dub' ? 'en' : 'ja', subtitles: subtitles });
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

function getVideoSources(episodeUrl, opts) {
  var key = _parseEpisodeUrl(episodeUrl);
  if (!key) return Promise.resolve([]);
  return _currentPlayback(key).catch(function () { return []; }).then(function (streams) {
    if (streams && streams.length) return streams;
    return _legacyStreams(key);
  }).then(function (streams) {
    var out = [], seen = {};
    for (var i = 0; i < (streams || []).length; i++) {
      var item = streams[i] || {};
      if (!item.url || seen[item.url]) continue;
      seen[item.url] = 1; out.push(item);
    }
    return out;
  }).catch(function () { return []; });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.6', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources,
    getStreams: getStreams, getLinks: getLinks
  };
}
