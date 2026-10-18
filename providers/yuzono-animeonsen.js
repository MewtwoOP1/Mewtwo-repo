// AnimeOnsen — JavaScript port of the Yuzono Aniyomi extension.
// Upstream: https://github.com/yuzono/anime-extensions/tree/master/src/all/animeonsen
// Uses AnimeOnsen's authenticated v4 API and returns its own HLS stream URL;
// this avoids scraping iframe pages or returning embed HTML as a stream.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'yuzono-animeonsen';
var SITE = 'https://www.animeonsen.xyz';
var API = 'https://api.animeonsen.xyz/v4';
var SEARCH_API = 'https://search.animeonsen.xyz';
var AUTH_API = 'https://auth.animeonsen.xyz/oauth/token';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var CLIENT_ID = 'f296be26-28b5-4358-b5a1-6259575e23b7';
var CLIENT_SECRET = '349038c4157d0480784753841217270c3c5b35f4281eaee029de21cb04084235';
var _token = null;
var _searchToken = null;

function getInfo() {
  return { name: 'AnimeOnsen (Yuzono)', lang: 'all', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animeonsen.xyz',
    type: 'anime', version: '1.0.0' };
}
function getSettings() { return []; }
function _headers(referer, accept) {
  return {
    'User-Agent': UA,
    'Accept': accept || 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || SITE + '/',
    'Origin': SITE
  };
}
function _request(url, opts) {
  return fetch(url, opts).then(function (r) {
    if (!r || (r.status && r.status >= 400)) throw new Error('AnimeOnsen HTTP ' + (r && r.status));
    return { body: String(r.body || ''), headers: r.headers || {}, status: r.status || 200 };
  });
}
function _json(url, referer) {
  return _request(url, { headers: _headers(referer, 'application/json, text/plain, */*'), timeoutMs: 12000 })
    .then(function (r) { return JSON.parse(r.body || 'null'); });
}
function _getToken() {
  if (_token) return Promise.resolve(_token);
  var body = 'client_id=' + encodeURIComponent(CLIENT_ID) +
    '&client_secret=' + encodeURIComponent(CLIENT_SECRET) +
    '&grant_type=client_credentials';
  return _request(AUTH_API, {
    method: 'POST',
    headers: {
      'User-Agent': UA, 'Accept': 'application/json',
      'Origin': SITE, 'Referer': SITE + '/',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body, timeoutMs: 10000
  }).then(function (r) {
    var j = JSON.parse(r.body || '{}');
    if (!j.access_token) throw new Error('AnimeOnsen auth response had no access_token');
    _token = String(j.access_token);
    return _token;
  });
}
function _apiJson(path, referer) {
  return _getToken().then(function (token) {
    return _request(API + path, {
      headers: Object.assign(_headers(referer || SITE + '/', 'application/json, text/plain, */*'),
        { 'Authorization': 'Bearer ' + token }),
      timeoutMs: 12000
    }).then(function (r) { return JSON.parse(r.body || 'null'); });
  }).catch(function (e) {
    // Refresh once on an expired token; no infinite retries.
    _token = null;
    return _getToken().then(function (token) {
      return _request(API + path, {
        headers: Object.assign(_headers(referer || SITE + '/', 'application/json, text/plain, */*'),
          { 'Authorization': 'Bearer ' + token }),
        timeoutMs: 12000
      }).then(function (r) { return JSON.parse(r.body || 'null'); });
    });
  });
}
function _getSearchToken() {
  if (_searchToken) return Promise.resolve(_searchToken);
  return _request(SITE + '/', { headers: _headers(SITE + '/'), timeoutMs: 10000 })
    .then(function (r) {
      var m = r.body.match(/<meta\b[^>]*name=["']ao-search-token["'][^>]*content=["']([^"']*)["']/i) ||
        r.body.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']ao-search-token["']/i);
      _searchToken = m ? (m[1] || '') : '';
      return _searchToken;
    }).catch(function () { return ''; });
}
function _search(query) {
  return _getSearchToken().then(function (token) {
    if (!token) return { hits: [] };
    return _request(SEARCH_API + '/indexes/content/search', {
      method: 'POST',
      headers: Object.assign(_headers(SITE + '/', 'application/json'), {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({ q: String(query || '') }),
      timeoutMs: 12000
    }).then(function (r) { return JSON.parse(r.body || '{}'); });
  });
}
function _title(o) {
  return String(o.content_title_en || o.content_title || o.content_title_jp || o.content_id || 'Untitled anime');
}
function _item(o) {
  if (!o || !o.content_id) return null;
  var poster = o.content_image || o.thumbnail || null;
  if (poster && poster.indexOf('//') === 0) poster = 'https:' + poster;
  return {
    id: String(o.content_id), url: String(o.content_id), title: _title(o), name: _title(o),
    cover: poster, poster: poster, type: 'anime', sourceId: SOURCE_ID
  };
}
function _items(list) {
  var out = [], seen = {};
  (Array.isArray(list) ? list : []).forEach(function (o) {
    var it = _item(o);
    if (it && !seen[it.id]) { seen[it.id] = 1; out.push(it); }
  });
  return out;
}
function search(query, page) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _search(q).then(function (j) { return _items(j && j.hits); }).catch(function () { return []; });
}
function getHome() {
  return _apiJson('/content/index?start=0&limit=30', SITE + '/')
    .then(function (j) {
      var items = _items(j && j.content);
      return items.length ? [{ title: 'AnimeOnsen Catalogue', items: items }] : [];
    }).catch(function () { return []; });
}
function popular() {
  return _apiJson('/content/index?start=0&limit=30', SITE + '/')
    .then(function (j) { return _items(j && j.content); }).catch(function () { return []; });
}
function _episodeMap(contentId) {
  return _apiJson('/content/' + encodeURIComponent(contentId) + '/episodes', SITE + '/details/' + contentId)
    .then(function (j) {
      var out = [], map = j && typeof j === 'object' ? j : {};
      Object.keys(map).forEach(function (epNum) {
        var ep = map[epNum] || {};
        var n = Number(epNum);
        if (!isFinite(n)) return;
        var title = ep.contentTitle_episode_en || ep.contentTitle_episode_jp || '';
        out.push({
          id: String(contentId) + '|' + String(epNum),
          url: String(contentId) + '|' + String(epNum),
          number: n,
          title: title ? 'Episode ' + epNum + ': ' + title : 'Episode ' + epNum
        });
      });
      out.sort(function (a, b) { return b.number - a.number; });
      return out;
    });
}
function getDetail(url) {
  var id = String(url || '').split(/[?#/|]/)[0];
  if (!id) return Promise.reject(new Error('AnimeOnsen: missing content id'));
  return Promise.all([
    _apiJson('/content/' + encodeURIComponent(id) + '/extensive', SITE + '/details/' + id),
    _episodeMap(id).catch(function () { return []; })
  ]).then(function (res) {
    var d = res[0] || {};
    var mal = d.mal_data && typeof d.mal_data === 'object' ? d.mal_data : {};
    var item = _item({
      content_id: d.content_id || id,
      content_title: d.content_title,
      content_title_en: d.content_title_en
    }) || { id: id, url: id, title: id, type: 'anime', sourceId: SOURCE_ID };
    item.id = String(d.content_id || id); item.url = item.id;
    item.cover = API + '/image/210x300/' + encodeURIComponent(item.id);
    item.poster = item.cover;
    item.description = String(mal.synopsis || '');
    item.genres = Array.isArray(mal.genres) ? mal.genres.map(function (g) { return g.name || ''; }).filter(Boolean) : [];
    item.status = String(mal.status || 'unknown').toLowerCase();
    item.malId = Number(d.mal_id || 0) || undefined;
    item.episodes = res[1];
    item.subCount = item.episodes.length;
    item.dubCount = 0;
    return item;
  });
}
function getEpisodes(url) { return getDetail(url).then(function (d) { return d.episodes || []; }); }
function getVideoSources(episodeUrl) {
  var p = String(episodeUrl || '').split('|');
  var contentId = p[0] || '';
  var epNum = p[1] || '';
  if (!contentId || !epNum) return Promise.reject(new Error('AnimeOnsen: invalid episode reference'));
  return _apiJson('/content/' + encodeURIComponent(contentId) + '/video/' + encodeURIComponent(epNum),
    SITE + '/details/' + contentId).then(function (j) {
      var uri = j && j.uri || {};
      var media = String(uri.stream || '');
      if (!/^https?:\/\//i.test(media)) throw new Error('AnimeOnsen returned no HLS stream');
      var metadata = j && j.metadata || {};
      var subtitleLangs = metadata.subtitles || {};
      var subtitleUrls = uri.subtitles || {};
      var subs = [];
      Object.keys(subtitleUrls).forEach(function (key) {
        var u = String(subtitleUrls[key] || '');
        if (!/^https?:\/\//i.test(u)) return;
        var lang = String(subtitleLangs[key] || key || 'Subtitle');
        subs.push({ url: u, lang: lang, label: lang, format: /\.ass(?:\?|$)/i.test(u) ? 'ass' : /\.srt(?:\?|$)/i.test(u) ? 'srt' : 'vtt' });
      });
      return [{
        url: media, quality: '720p', label: 'AnimeOnsen',
        container: 'hls', headers: _headers(SITE + '/'),
        kind: 'sub', audioLang: 'ja', subtitles: subs
      }];
    });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.0', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks
  };
}
