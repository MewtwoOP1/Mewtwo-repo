// Anime Hindi — provider for the documented ZeroTwo-Py Hindi Anime API.
// This API uses source-native anime_id slugs; it does not require AniList IDs.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'anime-hindi';
var VERSION = '1.0.0';
var API = 'https://anime-api-xza2.onrender.com';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36';

function getInfo() {
  return { name: 'Anime Hindi', lang: 'hi', baseUrl: API,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=anime-api-xza2.onrender.com',
    type: 'anime', version: VERSION };
}
function getSettings() { return []; }
function _json(path) {
  return fetch(API + path, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, timeoutMs: 20000 })
    .then(function(r) {
      if (!r || (r.status && r.status >= 400)) return null;
      var body = r.body == null ? '' : r.body;
      if (typeof body !== 'string') body = JSON.stringify(body);
      return JSON.parse(body || 'null');
    }).catch(function() { return null; });
}
function _unwrap(obj) {
  var v = obj;
  for (var i = 0; i < 5 && v && typeof v === 'object'; i++) {
    if (Array.isArray(v)) return v;
    if (v.data && typeof v.data === 'object') { v = v.data; continue; }
    if (v.results && typeof v.results === 'object') { v = v.results; continue; }
    if (Array.isArray(v.results)) return v.results;
    break;
  }
  return v || {};
}
function _slug(item) {
  return String(item && (item.anime_id || item.id || item.slug || item.url) || '')
    .replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '').replace(/^\/watch\//, '');
}
function _title(item) {
  var t = item && (item.title || item.name);
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') return t.english || t.romaji || t.native || '';
  return '';
}
function _poster(item) {
  var p = item && (item.poster || item.cover || item.image || item.thumbnail);
  if (p && typeof p === 'object') p = p.url || p.large || p.medium;
  if (typeof p !== 'string' || !p) return null;
  return p.replace(/\\\//g, '/');
}
function _rows(payload) {
  var v = _unwrap(payload);
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.results)) return v.results;
  if (v && Array.isArray(v.episodes)) return v.episodes;
  if (v && Array.isArray(v.data)) return v.data;
  return [];
}
function _card(item) {
  var id = _slug(item), title = _title(item);
  if (!id || !title) return null;
  return { id: id, title: title, url: id, cover: _poster(item), type: 'anime', sourceId: SOURCE_ID,
    year: item.year || item.release_year || null, description: item.overview || item.description || '' };
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _json('/api/search?s=' + encodeURIComponent(q) + '&page=' + Math.max(1, Number(page) || 1))
    .then(function(payload) { return _rows(payload).map(_card).filter(Boolean); });
}
function getHome(opts) {
  return _json('/api/newadded').then(function(payload) {
    var items = _rows(payload).map(_card).filter(Boolean), seen = {};
    items = items.filter(function(item) { if (seen[item.id]) return false; seen[item.id] = true; return true; });
    return items.length ? [{ title: 'Recently Added (Hindi)', items: items }] : [];
  }).catch(function() { return []; });
}
function _info(id) {
  return _json('/api/info?id=' + encodeURIComponent(id)).then(function(payload) {
    var v = payload && payload.data && typeof payload.data === 'object' ? payload.data : _unwrap(payload);
    return v && typeof v === 'object' && !Array.isArray(v) && _title(v) ? v : null;
  });
}
function _episodeRows(payload) {
  var v = _unwrap(payload);
  if (v && Array.isArray(v.episodes)) return v.episodes;
  if (Array.isArray(v)) return v;
  return [];
}
function _episodeNumber(ep, index) {
  var raw = ep && (ep.episode != null ? ep.episode : ep.number != null ? ep.number : ep.episode_number != null ? ep.episode_number : ep.ep);
  var m = String(raw == null ? '' : raw).match(/\d+/);
  return m ? Number(m[0]) : index + 1;
}
function _seasonCount(info) {
  var n = Number(info && info.seasons);
  return isFinite(n) && n > 0 ? Math.min(n, 50) : 1;
}
function _fetchEpisodes(id, season) {
  return _json('/api/episodes?id=' + encodeURIComponent(id) + '&season=' + season).then(function(payload) {
    var rows = _episodeRows(payload);
    if (payload && (rows.length || (payload.success === true && payload.results && payload.results.episodes))) return { rows: rows };
    return _json('/api/episode?id=' + encodeURIComponent(id) + '&season=' + season)
      .then(function(legacy) { return { rows: _episodeRows(legacy) }; });
  });
}
function _makeEpisode(id, season, ep, index) {
  var n = _episodeNumber(ep, index), title = _title(ep) || ep.name || ('Episode ' + n);
  return { id: id + '/' + season + '/' + n, number: n, title: title,
    url: 'animehindi://' + encodeURIComponent(id) + '/' + season + '/' + n,
    type: 'anime', sourceId: SOURCE_ID, season: season };
}
function getDetail(url, opts) {
  var id = _slug({ anime_id: url });
  if (!id) return Promise.resolve(null);
  return _info(id).then(function(info) {
    if (!info) return null;
    return _fetchEpisodes(id, 1).then(function(result) {
      var episodes = (result.rows || []).map(function(ep, i) { return _makeEpisode(id, 1, ep, i); });
      var detail = { id: id, title: _title(info) || id, url: id, cover: _poster(info),
        description: info.overview || info.description || '', year: info.year || null,
        status: info.status || null, genres: Array.isArray(info.genres) ? info.genres : [],
        type: 'anime', sourceId: SOURCE_ID, episodes: episodes,
        subCount: episodes.length, dubCount: episodes.length, seasons: _seasonCount(info) };
      if (!detail.cover) delete detail.cover;
      if (!detail.description) delete detail.description;
      if (!detail.year) delete detail.year;
      if (!detail.status) delete detail.status;
      if (!detail.genres.length) delete detail.genres;
      return detail;
    });
  }).catch(function() { return null; });
}
function getEpisodes(url, opts) {
  var id = '', season = 1;
  var m = String(url || '').match(/^animehindi:\/\/(.+?)\/(\d+)\/\d+$/i);
  if (m) { id = decodeURIComponent(m[1]); season = Number(m[2]) || 1; }
  else id = _slug({ anime_id: url });
  if (!id) return Promise.resolve([]);
  return _fetchEpisodes(id, season).then(function(result) {
    return (result.rows || []).map(function(ep, i) { return _makeEpisode(id, season, ep, i); });
  }).catch(function() { return []; });
}
function getVideoSources(episodeUrl, opts) {
  var m = String(episodeUrl || '').match(/^animehindi:\/\/(.+?)\/(\d+)\/(\d+)$/i);
  if (!m) return Promise.resolve([]);
  var id = decodeURIComponent(m[1]), season = Number(m[2]), ep = Number(m[3]);
  return _json('/api/stream?id=' + encodeURIComponent(id) + '&season=' + season + '&ep=' + ep).then(function(payload) {
    var rows = _rows(payload);
    var streams = rows.map(function(item, i) {
      var url = item && (item.url || item.embed || item.src || item.file);
      if (!url) return null;
      var kind = String(item.type || item.kind || (item.embed ? 'embed' : '')).toLowerCase();
      var isEmbed = kind.indexOf('embed') >= 0 || !!item.embed || !/\.m3u8(?:$|\?)/i.test(url);
      return { url: String(url), name: String(item.server || item.name || ('Server ' + (i + 1))),
        provider: String(item.server || item.name || 'Anime Hindi'), quality: item.quality || (isEmbed ? 'Embed' : 'Auto'),
        container: isEmbed ? 'embed' : 'm3u8', embed: isEmbed, hls: /\.m3u8(?:$|\?)/i.test(url),
        headers: item.headers || (item.referer ? { Referer: item.referer } : {}), isActive: item.isActive !== false };
    }).filter(Boolean);
    function resolveAt(i, out) {
      if (i >= streams.length) return Promise.resolve(out);
      var s = streams[i];
      if (s.embed && typeof extractVideo === 'function') {
        return Promise.resolve(extractVideo(s.url, { headers: s.headers || {} })).then(function(extracted) {
          (Array.isArray(extracted) ? extracted : (extracted ? [extracted] : [])).forEach(function(v) {
            if (v && v.url) out.push({ url: v.url, name: v.name || s.name, provider: v.provider || s.provider,
              quality: v.quality || s.quality, container: v.container || 'm3u8', hls: v.hls !== false,
              headers: v.headers || s.headers || {}, subtitles: v.subtitles || [] });
          });
        }).catch(function() { out.push(s); }).then(function() { return resolveAt(i + 1, out); });
      }
      out.push(s); return resolveAt(i + 1, out);
    }
    return resolveAt(0, []);
  }).catch(function() { return []; });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = {
  version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome,
  search: search, getDetail: getDetail, getEpisodes: getEpisodes,
  getVideoSources: getVideoSources, getStreams: getStreams
};
