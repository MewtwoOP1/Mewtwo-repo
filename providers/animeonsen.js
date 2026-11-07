// AnimeOnsen — authenticated v4 API with DASH playback and external subtitles.
// The provider uses the public client credentials from the maintained Aniyomi
// extension, refreshes tokens on demand, and returns AnimeOnsen's own CDN stream.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animeonsen';
var SITE = 'https://www.animeonsen.xyz';
var API = 'https://api.animeonsen.xyz/v4';
var SEARCH_API = 'https://search.animeonsen.xyz';
var AUTH_API = 'https://auth.animeonsen.xyz/oauth/token';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var CLIENT_ID = 'f296be26-28b5-4358-b5a1-6259575e23b7';
var CLIENT_SECRET = '349038c4157d0480784753841217270c3c5b35f4281eaee029de21cb04084235';
var _token = null;
var _tokenExpiresAt = 0;
var _tokenPromise = null;
var _searchToken = null;

function getInfo() {
  return { name: 'AnimeOnsen', lang: 'all', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animeonsen.xyz',
    type: 'anime', version: '1.0.0' };
}
function getSettings() {
  return [
    { key: 'requestTimeoutMs', label: 'Request timeout', description: 'Maximum wait for an individual AnimeOnsen API request.', type: 'enum', default: '12000', options: [{ value: '6000', label: '6 seconds' }, { value: '12000', label: '12 seconds' }, { value: '18000', label: '18 seconds' }] },
    { key: 'homeLimit', label: 'Home catalogue size', description: 'Number of titles requested for the AnimeOnsen home row.', type: 'enum', default: '30', options: [{ value: '15', label: '15 titles' }, { value: '30', label: '30 titles' }, { value: '50', label: '50 titles' }] },
    { key: 'includeSubtitles', label: 'Include external subtitles', description: 'Add AnimeOnsen ASS subtitle tracks to each episode when available.', type: 'bool', default: true }
  ];
}
function _setting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.animeonsen || {};
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
function _config() {
  return {
    timeoutMs: _int(_setting('requestTimeoutMs'), 12000, 3000, 30000),
    homeLimit: _int(_setting('homeLimit'), 30, 5, 60),
    subtitles: _bool(_setting('includeSubtitles'), true)
  };
}
function _headers(referer, accept) {
  return {
    'User-Agent': UA,
    'Accept': accept || 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || SITE + '/',
    'Origin': SITE
  };
}
function _responseBody(response) {
  var body = response && response.body != null ? response.body : '';
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') return JSON.stringify(body);
  return String(body || '');
}
function _readResponse(response) {
  var body = response && response.body;
  if (typeof body === 'string') return Promise.resolve(body);
  if (response && typeof response.text === 'function') {
    try { return Promise.resolve(response.text()); } catch (e) { /* fall through */ }
  }
  if (body && typeof body === 'object') return Promise.resolve(JSON.stringify(body));
  return Promise.resolve(String(body == null ? '' : body));
}
function _request(url, opts) {
  var options = opts || {};
  return fetch(url, Object.assign({}, options, { timeoutMs: options.timeoutMs || _config().timeoutMs })).then(function (r) {
    r = r || {};
    return _readResponse(r).then(function (body) {
      var status = Number(r.status || r.statusCode || 0) || 200;
      if (status < 200 || status >= 300) {
        var error = new Error('AnimeOnsen HTTP ' + status);
        error.status = status;
        throw error;
      }
      return { body: String(body || ''), headers: r.headers || {}, status: status, url: r.url || url };
    });
  });
}
function _json(url, referer) {
  return _request(url, { headers: _headers(referer, 'application/json, text/plain, */*') })
    .then(function (r) {
      try { return JSON.parse(r.body || 'null'); }
      catch (e) { throw new Error('AnimeOnsen returned invalid JSON'); }
    });
}
function _getToken() {
  if (_token && Date.now() < _tokenExpiresAt) return Promise.resolve(_token);
  if (_tokenPromise) return _tokenPromise;
  var body = 'client_id=' + encodeURIComponent(CLIENT_ID) +
    '&client_secret=' + encodeURIComponent(CLIENT_SECRET) +
    '&grant_type=client_credentials';
  var request = _request(AUTH_API, {
    method: 'POST',
    headers: {
      'User-Agent': UA, 'Accept': 'application/json',
      'Origin': SITE, 'Referer': SITE + '/',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body
  }).then(function (r) {
    var j;
    try { j = JSON.parse(r.body || '{}'); } catch (e) { throw new Error('AnimeOnsen auth returned invalid JSON'); }
    if (!j.access_token) throw new Error('AnimeOnsen auth response had no access_token');
    _token = String(j.access_token);
    _tokenExpiresAt = Date.now() + Math.max(60, Number(j.expires_in) || 3600) * 1000 - 60000;
    return _token;
  });
  _tokenPromise = request.then(function (value) { _tokenPromise = null; return value; }, function (error) { _tokenPromise = null; throw error; });
  return _tokenPromise;
}
function _apiJson(path, referer) {
  function request(token) {
    return _request(API + path, {
      headers: Object.assign(_headers(referer || SITE + '/', 'application/json, text/plain, */*'),
        { 'Authorization': 'Bearer ' + token })
    }).then(function (r) {
      try { return JSON.parse(r.body || 'null'); }
      catch (e) { throw new Error('AnimeOnsen returned invalid JSON'); }
    });
  }
  return _getToken().then(request).catch(function () {
    _token = null;
    _tokenExpiresAt = 0;
    return _getToken().then(request);
  });
}
function _getSearchToken() {
  if (_searchToken) return Promise.resolve(_searchToken);
  return _request(SITE + '/', { headers: _headers(SITE + '/', 'text/html,application/xhtml+xml,*/*;q=0.8') })
    .then(function (r) {
      var m = r.body.match(/<meta\b[^>]*name=["']ao-search-token["'][^>]*content=["']([^"']*)["']/i) ||
        r.body.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']ao-search-token["']/i);
      _searchToken = m ? (m[1] || '') : '';
      return _searchToken;
    }).catch(function () { return ''; });
}
function _search(query) {
  return _getSearchToken().then(function (token) {
    if (!token) return Promise.resolve({ hits: [] });
    return _request(SEARCH_API + '/indexes/content/search', {
      method: 'POST',
      headers: Object.assign(_headers(SITE + '/', 'application/json'), {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify({ q: String(query || '') })
    }).then(function (r) { return JSON.parse(r.body || '{}'); });
  }).catch(function () { return { hits: [] }; });
}
function _title(o) {
  return String(o && (o.content_title_en || o.content_title || o.content_title_jp || o.content_id) || 'Untitled anime');
}
function _item(o) {
  if (!o || !o.content_id) return null;
  var poster = o.content_image || o.thumbnail || null;
  if (poster && poster.indexOf('//') === 0) poster = 'https:' + poster;
  var item = {
    id: String(o.content_id), url: String(o.content_id), title: _title(o), name: _title(o),
    cover: poster, poster: poster, type: 'anime', sourceId: SOURCE_ID
  };
  if (o.mal_id) item.malId = Number(o.mal_id) || undefined;
  if (o.anilist_id) item.anilistId = Number(o.anilist_id) || undefined;
  return item;
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
function _catalogue(limit) {
  var count = Math.max(1, Math.min(60, Number(limit) || _config().homeLimit));
  return _apiJson('/content/index?start=0&limit=' + count, SITE + '/')
    .then(function (j) { return _items(j && j.content); });
}
function getHome() {
  return _catalogue(_config().homeLimit).then(function (items) {
    return items.length ? [{ title: 'AnimeOnsen Catalogue', items: items }] : [];
  }).catch(function () { return []; });
}
function popular() {
  return _catalogue(_config().homeLimit).catch(function () { return []; });
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
        var id = String(contentId) + '|' + String(epNum);
        out.push({
          id: id, url: id, number: n,
          title: title ? 'Episode ' + epNum + ': ' + title : 'Episode ' + epNum,
          category: 'sub', sourceId: SOURCE_ID, type: 'anime'
        });
      });
      out.sort(function (a, b) { return a.number - b.number; });
      return out;
    });
}
function _contentId(value) {
  var raw = String(value || '').trim();
  var match = raw.match(/\/details\/([^/?#]+)/i) || raw.match(/\/([A-Za-z0-9]{6,})(?:[/?#]|$)/) || raw.match(/^([A-Za-z0-9_-]{6,})$/);
  if (!match) throw new Error('AnimeOnsen: missing content id');
  try { return decodeURIComponent(match[1]); } catch (e) { return match[1]; }
}
function _year(value) {
  var match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
}
function getDetail(url) {
  var id = _contentId(url);
  return Promise.all([
    _apiJson('/content/' + encodeURIComponent(id) + '/extensive', SITE + '/details/' + id),
    _episodeMap(id).catch(function () { return []; })
  ]).then(function (res) {
    var d = res[0] || {};
    var mal = d.mal_data && typeof d.mal_data === 'object' ? d.mal_data : {};
    var item = _item({
      content_id: d.content_id || id,
      content_title: d.content_title,
      content_title_en: d.content_title_en,
      content_image: d.content_image,
      mal_id: d.mal_id || mal.mal_id || mal.id,
      anilist_id: d.anilist_id || mal.anilist_id
    }) || { id: id, url: id, title: id, type: 'anime', sourceId: SOURCE_ID };
    item.id = String(d.content_id || id); item.url = item.id;
    item.cover = API + '/image/210x300/' + encodeURIComponent(item.id);
    item.poster = item.cover;
    item.description = String(mal.synopsis || d.content_description || '');
    item.genres = Array.isArray(mal.genres) ? mal.genres.map(function (g) { return g.name || ''; }).filter(Boolean) : [];
    item.status = String(mal.status || d.status || 'unknown').toLowerCase();
    item.malId = Number(d.mal_id || mal.mal_id || mal.id) || undefined;
    item.anilistId = Number(d.anilist_id || mal.anilist_id) || undefined;
    item.year = _year(mal.start_date || d.start_date || d.year);
    item.episodes = res[1];
    item.subCount = item.episodes.length;
    item.dubCount = 0;
    return item;
  });
}
function getEpisodes(url) { return getDetail(url).then(function (d) { return d.episodes || []; }); }
function _episodeParts(value) {
  var parts = String(value || '').split('|');
  var contentId = parts[0] || '';
  var epNum = parts[1] || '';
  if (!contentId || !epNum) return null;
  return { contentId: contentId, epNum: epNum };
}
function _subtitleFormat(_url) {
  return 'ass';
}
function _streamQuality(metadata) {
  var raw = metadata && typeof metadata === 'object'
    ? (metadata.quality || metadata.height || metadata.resolution)
    : metadata;
  if (raw == null || raw === '') return 'Auto';
  var text = String(raw).trim();
  if (/^\d{3,4}$/.test(text)) return text + 'p';
  return text;
}
function getVideoSources(episodeUrl) {
  var p = _episodeParts(episodeUrl);
  if (!p) return Promise.reject(new Error('AnimeOnsen: invalid episode reference'));
  return _apiJson('/content/' + encodeURIComponent(p.contentId) + '/video/' + encodeURIComponent(p.epNum),
    SITE + '/details/' + p.contentId).then(function (j) {
      var uri = j && j.uri || {};
      var media = String(uri.stream || '');
      if (!/^https:\/\//i.test(media)) throw new Error('AnimeOnsen returned no playable stream');
      var metadata = j && j.metadata || {};
      var subtitleLangs = metadata.subtitles || {};
      var subtitleUrls = uri.subtitles || {};
      var subs = [];
      if (_config().subtitles) {
        Object.keys(subtitleUrls).forEach(function (key) {
          var u = String(subtitleUrls[key] || '');
          if (!/^https:\/\//i.test(u)) return;
          var lang = String(subtitleLangs[key] || key || 'Subtitle');
          subs.push({ url: u, lang: key, label: lang, format: _subtitleFormat(u),
            headers: _headers(SITE + '/'), default: String(key).toLowerCase().indexOf('en') === 0 });
        });
      }
      var dash = /\.mpd(?:[?#]|$)/i.test(media);
      var container = dash ? 'dash' : (/\.m3u8(?:[?#]|$)/i.test(media) ? 'hls' : 'mp4');
      return [{
        url: media, quality: _streamQuality(metadata), label: 'AnimeOnsen',
        type: container, container: container, hls: container === 'hls',
        headers: _headers(SITE + '/'), kind: 'sub', audioLang: 'ja', subtitles: subs,
        isActive: true
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
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _config: _config, _contentId: _contentId, _episodeParts: _episodeParts,
    _title: _title, _item: _item, _episodeMap: _episodeMap, _streamQuality: _streamQuality
  };
}
