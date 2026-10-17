// Re:Anime — direct site API provider for Zangetsu.
// Catalogue and episode IDs come from reanime.to itself; AniList is not required.
// FlixCloud embeds use rotating WASM/AES stream decryption. This provider only
// returns direct media URLs it can actually identify as playable, rather than
// pretending an embed page is an HLS stream.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'reanime';
var SITE = 'https://reanime.to';
// Public resolver fallback for FlixCloud's rotating embed decryption.
// Catalogue/search still use Re:Anime directly; no AniList API query is made.
var STREAM_API = 'https://lvrcdn2.rewcrew.lv';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
var HEADERS = { 'User-Agent': UA, 'Accept': 'application/json, */*', 'Referer': SITE + '/' };

function getInfo() {
  return { name: 'Re:Anime', lang: 'en', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=reanime.to', type: 'anime', version: '1.0.0' };
}
function getSettings() { return []; }

function _fetch(url) {
  return fetch(url, { headers: HEADERS }).then(function (r) {
    if (!r || (r.status && r.status >= 400)) throw new Error('Re:Anime HTTP ' + (r ? r.status : 'error'));
    var body = r.body;
    if (typeof body !== 'string') body = body == null ? '' : String(body);
    return body;
  });
}
function _json(url) {
  return _fetch(url).then(function (body) {
    var j = JSON.parse(body);
    if (j && j.success === false) throw new Error('Re:Anime API returned success=false');
    return j;
  });
}
function _array(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.anime)) return data.anime;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.episodes)) return data.episodes;
  return [];
}
function _first(obj, keys) {
  for (var i = 0; obj && i < keys.length; i++) {
    var v = obj[keys[i]];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}
function _slug(item) {
  var s = _first(item, ['slug', 'anime_slug', 'id', 'url_slug']);
  if (s && String(s).indexOf('/') < 0) return String(s);
  var u = String(_first(item, ['url', 'href', 'link']) || '');
  var m = u.match(/\/anime\/([^/?#]+)/);
  return m ? m[1] : (s ? String(s) : '');
}
function _title(item) {
  return String(_first(item, ['title', 'name', 'romaji', 'english', 'anime_title']) || 'Untitled anime');
}
function _cover(item) {
  var c = _first(item, ['cover', 'poster', 'image', 'cover_image', 'thumbnail']);
  if (c && typeof c === 'object') c = _first(c, ['extra_large', 'large', 'medium', 'url']);
  if (typeof c !== 'string') return null;
  if (c.indexOf('//') === 0) return 'https:' + c;
  return c;
}
function _item(item) {
  var slug = _slug(item);
  if (!slug) return null;
  return { id: slug, title: _title(item), url: slug, cover: _cover(item), type: 'anime', sourceId: SOURCE_ID };
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(0, ((parseInt(page, 10) || 1) - 1) * 20);
  return _json(SITE + '/api/search?q=' + encodeURIComponent(q) + '&limit=20&offset=' + p)
    .then(function (data) {
      var arr = _array(data);
      var out = [], seen = {};
      arr.forEach(function (v) {
        var it = _item(v);
        if (it && !seen[it.id]) { seen[it.id] = 1; out.push(it); }
      });
      return out;
    }).catch(function () { return []; });
}
function getHome(opts) {
  return Promise.all([
    _json(SITE + '/api/home/latest-aired?limit=20').catch(function () { return []; }),
    _json(SITE + '/api/top/anime?period=week&limit=20').catch(function () { return []; })
  ]).then(function (all) {
    function map(data) {
      var out = [], seen = {};
      _array(data).forEach(function (v) {
        var it = _item(v);
        if (it && !seen[it.id]) { seen[it.id] = 1; out.push(it); }
      });
      return out;
    }
    var rows = [];
    var latest = map(all[0]), top = map(all[1]);
    if (latest.length) rows.push({ title: 'Latest Aired', items: latest });
    if (top.length) rows.push({ title: 'Trending', items: top });
    return rows;
  }).catch(function () { return []; });
}
function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    rows.forEach(function (r) { (r.items || []).forEach(function (i) { out.push(i); }); });
    return out;
  });
}
function _episode(ep, index) {
  var num = parseInt(_first(ep, ['number', 'episode_number', 'episode', 'ep']), 10);
  if (!(num > 0)) num = index + 1;
  var id = String(_first(ep, ['number', 'episode_number', 'episode', 'ep', 'id']) || num);
  return {
    id: id,
    number: num,
    title: String(_first(ep, ['title', 'name', 'episode_title']) || ('Episode ' + num)),
    url: id
  };
}
function getDetail(url, opts) {
  var slug = String(url || '').replace(/^.*\/anime\//, '').split(/[?#/]/)[0];
  if (!slug) return Promise.reject(new Error('Re:Anime: missing anime slug'));
  return Promise.all([
    _json(SITE + '/api/watch/' + encodeURIComponent(slug) + '/1').catch(function () { return {}; }),
    _json(SITE + '/api/episodes/' + encodeURIComponent(slug)).catch(function () { return []; })
  ]).then(function (res) {
    var watch = res[0] || {};
    var anime = watch.anime || watch.data || watch;
    var eps = _array(res[1]);
    var item = _item(anime) || { id: slug, title: slug, url: slug, type: 'anime', sourceId: SOURCE_ID };
    item.id = slug; item.url = slug;
    item.description = String(_first(anime, ['description', 'synopsis', 'overview']) || '');
    item.status = String(_first(anime, ['status']) || 'unknown').toLowerCase();
    item.genres = Array.isArray(anime.genres) ? anime.genres.map(function (g) { return typeof g === 'string' ? g : _title(g); }) : [];
    item.year = _first(anime, ['year', 'release_year', 'aired_year']);
    item.episodes = eps.map(function (ep, i) { var e = _episode(ep, i); e.url = slug + '|' + e.number; return e; });
    item.subCount = item.episodes.length;
    item.dubCount = 0;
    return item;
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; });
}
function _anilistId(anime) {
  var id = _first(anime, ['anilist', 'anilist_id', 'anilistId']);
  if (id && /^\d+$/.test(String(id))) return String(id);
  var covers = anime && anime.cover_image;
  if (covers && typeof covers === 'object') {
    var keys = ['extra_large', 'large', 'medium'];
    for (var i = 0; i < keys.length; i++) {
      var m = String(covers[keys[i]] || '').match(/\/bx(\d+)-/);
      if (m) return m[1];
    }
  }
  return null;
}
function _mapResolvedStreams(data, audio) {
  var streams = Array.isArray(data && data.streams) ? data.streams : [];
  var out = [], seen = {};
  streams.forEach(function (s) {
    var u = String(s && s.url || '');
    if (!/^https?:\/\//i.test(u) || !/\.(m3u8|mp4|m4v)(\?|$)/i.test(u) || seen[u]) return;
    seen[u] = 1;
    var headers = {};
    var rawHeaders = s.headers && typeof s.headers === 'object' ? s.headers : {};
    Object.keys(rawHeaders).forEach(function (k) { headers[k] = String(rawHeaders[k]); });
    if (!headers.Referer && s.referer) headers.Referer = String(s.referer);
    var subs = [];
    (Array.isArray(s.subtitles) ? s.subtitles : []).forEach(function (sub) {
      if (!sub || !sub.url) return;
      subs.push({
        url: String(sub.url),
        lang: String(sub.srclang || sub.lang || sub.language || sub.label || 'Sub'),
        label: String(sub.label || sub.language || sub.srclang || 'Sub'),
        format: /\.srt(\?|$)/i.test(String(sub.url)) ? 'srt' : 'vtt',
        'default': !!sub['default']
      });
    });
    out.push({
      url: u, quality: 'Auto', label: String(s.server || s.name || 'Re:Anime'),
      container: /\.m3u8(\?|$)/i.test(u) ? 'hls' : 'mp4',
      headers: Object.keys(headers).length ? headers : HEADERS,
      kind: audio, audioLang: audio === 'dub' ? 'en' : 'ja', subtitles: subs
    });
  });
  return out;
}
function getVideoSources(episodeUrl, opts) {
  var raw = String(episodeUrl || '');
  var p = raw.split('|');
  var slug = p.length > 1 ? p[0] : '';
  var ep = parseInt(p.length > 1 ? p[1] : raw, 10);
  if (!slug || !(ep > 0)) return Promise.reject(new Error('Re:Anime: invalid episode reference'));
  return _json(SITE + '/api/watch/' + encodeURIComponent(slug) + '/' + ep).then(function (watch) {
    var links = Array.isArray(watch.episode_links) ? watch.episode_links : [];
    var out = [], seen = {};
    links.forEach(function (link) {
      var u = String(_first(link, ['url', 'dataLink', 'link', 'src']) || '');
      if (!/^https?:\/\//i.test(u) || seen[u]) return;
      // Only expose actual media URLs. FlixCloud embed pages require rotating
      // WASM-based decryption and are deliberately not mislabeled as playable.
      if (!/\.(m3u8|mp4|m4v)(\?|$)/i.test(u)) return;
      seen[u] = 1;
      var dub = /dub/i.test(String(_first(link, ['dataType', 'type', 'language']) || ''));
      out.push({
        url: u,
        quality: 'Auto',
        label: String(_first(link, ['serverName', 'name']) || 'Re:Anime'),
        container: /\.m3u8(\?|$)/i.test(u) ? 'hls' : 'mp4',
        headers: HEADERS,
        kind: dub ? 'dub' : 'sub',
        audioLang: dub ? 'en' : 'ja',
        subtitles: []
      });
    });
    if (out.length) return out;
    // FlixCloud embed URLs cannot be played directly. Resolve through the
    // public Anivexa endpoint using the ID already present in Re:Anime's own
    // metadata/cover URL; this does not call AniList itself.
    var aid = _anilistId(watch.anime || watch.data || {});
    if (!aid) throw new Error('Re:Anime: no direct media URLs and no embedded media ID for FlixCloud resolution');
    var audio = (opts && String(opts.category || '').toLowerCase() === 'dub') ? 'dub' : 'sub';
    var route = STREAM_API + '/watch/reanime/' + encodeURIComponent(aid) + '/' + audio + '/rean' + 'ime-' + ep;
    return _json(route).then(function (resolved) {
      var playable = _mapResolvedStreams(resolved, audio);
      if (!playable.length) throw new Error('Re:Anime: resolver returned no direct playable streams');
      return playable;
    });
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
