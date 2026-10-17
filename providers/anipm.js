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
    logo: SITE + '/favicon.ico', type: 'anime', version: '1.0.0' };
}
function getSettings() { return []; }
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _num(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
}
function _absolute(url) {
  if (!url) return null;
  try { return new URL(String(url), SITE).href; } catch (e) { return String(url); }
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
function _json(url, ref) {
  return fetch(url, { headers: _headers(ref), timeoutMs: 12000 })
    .then(function (r) {
      var body = r && r.body ? r.body : '';
      if (r && r.status && (r.status < 200 || r.status >= 300)) return null;
      try {
        var j = JSON.parse(body || 'null');
        // Cloudflare challenge HTML is not valid JSON and becomes null.
        return j && typeof j === 'object' ? j : null;
      } catch (e) { return null; }
    }).catch(function () { return null; });
}
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
function _slug(item) { return _trim(item && (item.slug || item.source || item.urlSlug) || ''); }
function _title(item) {
  return _trim(item && (item.title || item.english || item.name || item.native) || 'Untitled');
}
function _titles(item) {
  return {
    englishTitle: _trim(item && (item.title || item.english) || ''),
    nativeTitle: _trim(item && (item.native || item.nativeTitle) || ''),
    malId: _num(item && (item.malId || item.mal_id)),
    anilistId: _num(item && (item.anilistId || item.anilist_id || item.anilist))
  };
}
function _card(item) {
  var id = _id(item);
  if (!id) return null;
  var meta = _titles(item);
  var slug = _slug(item);
  var url = 'anipm://' + id + '|' + encodeURIComponent(slug) + '|'
    + encodeURIComponent(_title(item)) + '|' + encodeURIComponent(String(item.year || ''))
    + '|' + (meta.malId || '') + '|' + (meta.anilistId || '');
  cache[String(id)] = item;
  return {
    id: url, title: _title(item), englishTitle: meta.englishTitle || _title(item),
    nativeTitle: meta.nativeTitle || null,
    cover: item.poster || item.cover || item.image || null,
    banner: item.banner || null, description: item.synopsis || item.description || '',
    url: url, type: 'anime', sourceId: SOURCE_ID,
    year: item.year || null, malId: meta.malId, anilistId: meta.anilistId,
    subCount: _num(item.subCount) || _num(item.episodeCount) || 0,
    dubCount: _num(item.dubCount) || 0
  };
}
function _searchApi(query, page, endpoint) {
  var url = API + '/' + endpoint + '?q=' + encodeURIComponent(query || '')
    + '&page=' + Math.max(1, Number(page) || 1);
  return _json(url, SITE + '/').then(function (j) { return _payloadItems(j); });
}
function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  return _searchApi(q, page, 'catalog').then(function (items) {
    if (items.length) return items;
    return _searchApi(q, page, 'search');
  }).then(function (items) {
    var out = [], seen = {};
    for (var i = 0; i < items.length; i++) {
      var c = _card(items[i]);
      if (c && !seen[c.url]) { seen[c.url] = 1; out.push(c); }
    }
    return out;
  }).catch(function () { return []; });
}
function getHome(opts) {
  // The catalogue endpoint can return its first/latest page without a query.
  return _json(API + '/catalog?page=1', SITE + '/').then(function (j) {
    var items = _payloadItems(j), out = [], seen = {};
    for (var i = 0; i < items.length; i++) {
      var c = _card(items[i]);
      if (c && !seen[c.url]) { seen[c.url] = 1; out.push(c); }
    }
    return out.length ? [{ title: 'Ani.pm Catalogue', items: out }] : [];
  }).catch(function () { return []; });
}
function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    (rows || []).forEach(function (row) { (row.items || []).forEach(function (item) { out.push(item); }); });
    return out;
  });
}
function _parseCardUrl(url) {
  var s = String(url || '').replace(/^anipm:\/\//, '');
  var p = s.split('|');
  if (p.length < 1) return null;
  var id = _num(p[0]);
  if (!id) return null;
  return {
    id: id,
    slug: decodeURIComponent(p[1] || ''),
    title: decodeURIComponent(p[2] || ''),
    year: decodeURIComponent(p[3] || ''),
    malId: _num(p[4]),
    anilistId: _num(p[5])
  };
}
function _seriesFrom(j) {
  if (!j) return null;
  return j.series || j.anime || j.item || j.data && (j.data.series || j.data.anime || j.data) || j;
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
function _episodeUrl(cat, id, slug, ep, malId, anilistId) {
  return 'anipm-episode://' + cat + '|' + id + '|' + encodeURIComponent(slug || '')
    + '|' + ep + '|' + (malId || '') + '|' + (anilistId || '');
}
function getDetail(url, opts) {
  var key = _parseCardUrl(url);
  if (!key) return Promise.resolve(null);
  var cached = cache[String(key.id)] || {};
  return _json(API + '/series/' + key.id, SITE + '/').then(function (j) {
    var series = _seriesFrom(j);
    if (!series || typeof series !== 'object') series = cached;
    var title = _title(series) !== 'Untitled' ? _title(series) : (key.title || 'Untitled');
    var meta = _titles(series);
    var slug = _slug(series) || key.slug;
    var eps = _episodes(series);
    var subCount = _num(series.subCount) || _num(series.episodeCount) || eps.length;
    var dubCount = _num(series.dubCount) || (eps.filter(function (e) { return !!e.raw.dub; }).length);
    var result = {
      id: 'anipm://' + key.id, title: title, englishTitle: meta.englishTitle || key.title || title,
      nativeTitle: meta.nativeTitle || null,
      cover: series.poster || series.cover || series.image || cached.poster || null,
      banner: series.banner || cached.banner || null,
      description: series.synopsis || series.description || cached.synopsis || '',
      status: series.status || 'unknown', genres: Array.isArray(series.genres) ? series.genres : [],
      studios: Array.isArray(series.studios) ? series.studios : [],
      type: 'anime', sourceId: SOURCE_ID,
      year: _num(series.year) || _num(key.year), malId: meta.malId || key.malId,
      anilistId: meta.anilistId || key.anilistId,
      subCount: subCount, dubCount: dubCount, episodes: []
    };
    for (var i = 0; i < eps.length; i++) {
      result.episodes.push({
        id: String(eps[i].number), number: eps[i].number, title: eps[i].title,
        thumbnail: eps[i].raw.thumbnail || null,
        description: eps[i].raw.description || '',
        url: _episodeUrl(_mode(opts), key.id, slug, eps[i].number, result.malId, result.anilistId)
      });
    }
    // If Ani.pm's detail endpoint fails, keep the catalogue metadata intact
    // rather than returning null and letting a caller discard its metadata.
    return result;
  }).catch(function () {
    var c = _card(cached);
    if (!c) return null;
    return {
      id: 'anipm://' + key.id, title: key.title || c.title, englishTitle: c.englishTitle,
      nativeTitle: c.nativeTitle, cover: c.cover, banner: c.banner, description: c.description,
      status: cached.status || 'unknown', genres: cached.genres || [], studios: cached.studios || [],
      type: 'anime', sourceId: SOURCE_ID, year: _num(key.year), malId: key.malId || c.malId,
      anilistId: key.anilistId || c.anilistId, subCount: c.subCount, dubCount: c.dubCount, episodes: []
    };
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d ? d.episodes : []; }).catch(function () { return []; });
}
function _parseEpisodeUrl(url) {
  var s = String(url || '').replace(/^anipm-episode:\/\//, '');
  var p = s.split('|');
  if (p.length < 4) return null;
  var id = _num(p[1]), ep = _num(p[3]);
  if (!id || !ep) return null;
  return {
    category: p[0] === 'dub' ? 'dub' : 'sub', id: id,
    slug: decodeURIComponent(p[2] || ''), episode: ep,
    malId: _num(p[4]), anilistId: _num(p[5])
  };
}
function _serverList(j, cat) {
  if (!j) return [];
  var data = j.data && !Array.isArray(j.data) ? j.data : j;
  var list = data[cat];
  return Array.isArray(list) ? list : [];
}
function _serverRequest(key, title) {
  var params = 'title=' + encodeURIComponent(title || '')
    + '&ep=' + encodeURIComponent(key.episode)
    + (key.anilistId ? '&anilistId=' + encodeURIComponent(key.anilistId) : '')
    + (key.malId ? '&malId=' + encodeURIComponent(key.malId) : '');
  return _json(API + '/src/servers?' + params, SITE + '/').then(function (j) {
    return { json: j, list: _serverList(j, key.category) };
  });
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
  var cached = cache[String(key.id)] || {};
  var slug = key.slug || _slug(cached);
  var title = slug || _title(cached);
  function fetchList(primary, fallback) {
    return _serverRequest(key, primary).then(function (result) {
      if (result.list.length || !fallback || fallback === primary) return result.list;
      return _serverRequest(key, fallback).then(function (second) { return second.list; });
    });
  }
  return fetchList(title, _title(cached)).then(function (servers) {
    var out = [], seen = {};
    servers.sort(function (a, b) { return (_num(b.priority) || 0) - (_num(a.priority) || 0); });
    for (var i = 0; i < servers.length; i++) {
      var s = servers[i] || {};
      var kind = String(s.kind || '').toLowerCase();
      if ((kind !== 'hls' && kind !== 'file') || !s.url) continue; // never pretend an iframe is a direct stream
      var u = _absolute(s.url);
      if (!u || seen[u]) continue;
      seen[u] = 1;
      out.push({
        url: u, quality: s.quality || s.name || s.provider || (kind === 'hls' ? 'HLS' : 'MP4'),
        container: kind === 'hls' ? 'hls' : 'mp4',
        headers: { 'User-Agent': UA, 'Referer': SITE + '/', 'Origin': SITE },
        kind: key.category, audioLang: key.category === 'dub' ? 'und' : 'ja',
        subtitles: _subtitles(s), label: 'Ani.pm · ' + (s.name || s.provider || kind)
      });
    }
    return out;
  }).catch(function () { return []; });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.0', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources,
    getStreams: getStreams, getLinks: getLinks
  };
}
