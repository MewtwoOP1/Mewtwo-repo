// MovieBox API — self-hosted REST backend for Zangetsu.
// API base can be changed in provider settings if the deployment URL changes.
var API_BASE = 'https://moviebox-api-lovat-nu.vercel.app';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'moviebox-api';
var VERSION = '1.0.1';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'MovieBox API', lang: 'en', baseUrl: API_BASE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=moviebox.ph',
    type: 'movie', version: VERSION };
}
function getSettings() {
  return [{
    key: 'apiBase',
    label: 'MovieBox API base URL',
    description: 'Your self-hosted MovieBox API deployment. Do not include a trailing slash.',
    type: 'text',
    default: API_BASE
  }];
}
function _base(opts) {
  var s = opts && opts.apiBase ? String(opts.apiBase).trim() : API_BASE;
  return s.replace(/\/+$/, '');
}
function _request(path, opts) {
  var url = _base(opts) + path;
  return fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': UA }, timeoutMs: 25000 })
    .then(function(r) {
      if (r && r.status >= 400) throw new Error('MovieBox API HTTP ' + r.status);
      var body = r && r.body != null ? r.body : '';
      if (typeof body !== 'string') return body;
      try { return JSON.parse(body); } catch (_) { throw new Error('MovieBox API returned invalid JSON'); }
    });
}
function _text(v) {
  if (v == null) return '';
  return String(v).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
}
function _id(v) {
  var s = String(v == null ? '' : v);
  if (/^moviebox:\/\//i.test(s)) s = s.replace(/^moviebox:\/\//i, '');
  if (/^https?:\/\//i.test(s)) {
    var m = s.match(/\/(?:detail|episodes|stream)\/([^/?#]+)/i);
    if (m) s = m[1];
  }
  return decodeURIComponent(s.split(/[/?#]/)[0] || '');
}
function _detailPath(v) {
  if (!v) return '';
  try { return decodeURIComponent(String(v)); } catch (_) { return String(v); }
}
function _item(item) {
  var subjectId = String(item && (item.subject_id || item.subjectId || item.id) || '');
  if (!subjectId || subjectId === 'None' || subjectId === 'null') return null;
  var title = _text(item.title || item.name || '');
  if (!title) return null;
  var url = 'moviebox://' + encodeURIComponent(subjectId) + '/0/0';
  var year = item.release_date ? String(item.release_date).slice(0, 4) : null;
  var rating = Number(item.imdb_rating != null ? item.imdb_rating : item.imdbRating);
  var genres = item.genre == null ? [] : (Array.isArray(item.genre) ? item.genre : String(item.genre).split(/[,|]/));
  return {
    id: url, title: year ? title + ' (' + year + ')' : title, englishTitle: title,
    url: url, cover: item.cover || item.poster || item.image || null, year: year,
    type: 'movie', sourceId: SOURCE_ID, description: '',
    genres: genres.map(function(g) { return _text(g); }).filter(Boolean),
    score: isFinite(rating) && rating > 0 ? Math.round(rating * 10) : undefined,
    episodes: [], subCount: 0, dubCount: 0
  };
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, Number(page) || 1);
  return _request('/search?q=' + encodeURIComponent(q) + '&page=' + p + '&per_page=20', opts)
    .then(function(data) {
      var rows = data && (data.results || data.items || data.data) || [];
      if (!Array.isArray(rows)) return [];
      return rows.map(_item).filter(Boolean);
    }).catch(function() { return []; });
}
function getHome(opts) {
  return _request('/home', opts).then(function(data) {
    var sections = [];
    function add(title, list) {
      if (!Array.isArray(list)) return;
      var items = list.map(_item).filter(Boolean);
      if (items.length) sections.push({ title: title, items: items });
    }
    var d = data && (data.data || data) || {};
    add('Featured', d.banners || d.featured || []);
    add('Trending', d.trending || d.popular || []);
    (d.sections || d.rows || []).forEach(function(row) {
      if (row) add(_text(row.title || row.name || 'MovieBox'), row.items || row.results || row.subjects || []);
    });
    return sections;
  }).catch(function() { return []; });
}
function _parseEpisodeUrl(url) {
  var s = String(url || '').replace(/^moviebox:\/\//i, '');
  var parts = s.split('/');
  var id = '';
  try { id = decodeURIComponent(parts[0] || ''); } catch (_) { id = parts[0] || ''; }
  return { id: id, season: Math.max(0, Number(parts[1]) || 0), episode: Math.max(0, Number(parts[2]) || 0),
    detailPath: parts[3] ? _detailPath(parts[3]) : '' };
}
function _makeEpisodes(id, seasons, detailPath) {
  var out = [];
  (Array.isArray(seasons) ? seasons : []).forEach(function(s) {
    var sn = Math.max(0, Number(s.season != null ? s.season : s.se) || 1);
    var count = Math.max(0, Number(s.episode_count != null ? s.episode_count : s.maxEp) || 0);
    for (var n = 1; n <= count && n <= 300; n++) {
      out.push({ id: id + ':' + sn + ':' + n, number: n, episode: n, season: sn,
        title: 'S' + sn + ' · Episode ' + n,
        url: 'moviebox://' + encodeURIComponent(id) + '/' + sn + '/' + n + '/' + encodeURIComponent(detailPath || ''),
        sourceId: SOURCE_ID, type: 'movie' });
    }
  });
  return out;
}
function getDetail(url, opts) {
  var parsed = _parseEpisodeUrl(url), subjectId = parsed.id || _id(url);
  if (!subjectId) return Promise.resolve(null);
  var canonicalUrl = 'moviebox://' + encodeURIComponent(subjectId) + '/0/0';
  return Promise.all([
    _request('/detail/' + encodeURIComponent(subjectId), opts),
    _request('/episodes/' + encodeURIComponent(subjectId), opts).catch(function() { return { seasons: [] }; })
  ]).then(function(values) {
    var d = values[0] && (values[0].data || values[0]) || {};
    var seasonData = values[1] && (values[1].seasons || (values[1].data && values[1].data.seasons)) || [];
    var detailPath = d.detail_path || d.detailPath || '';
    var title = _text(d.title || d.name || '');
    if (!title) throw new Error('MovieBox detail returned no title for ' + subjectId);
    var genres = d.genre == null ? [] : (Array.isArray(d.genre) ? d.genre : String(d.genre).split(/[,|]/));
    var rating = Number(d.imdb_rating != null ? d.imdb_rating : d.imdbRating);
    var isSeries = String(d.type || '').toLowerCase() === 'series' || Number(d.subject_type || d.subjectType) === 2;
    var eps = isSeries ? _makeEpisodes(subjectId, seasonData, detailPath) : [];
    var dubs = Array.isArray(d.dubs) ? d.dubs.map(function(x) {
      return _text(x && (x.lang_name || x.language) || '');
    }).filter(Boolean) : [];
    return {
      id: canonicalUrl, title: title, englishTitle: title, url: canonicalUrl,
      cover: d.cover || d.poster || null, description: _text(d.description || d.plot || ''),
      year: d.release_date ? String(d.release_date).slice(0, 4) : null,
      status: 'unknown', genres: genres.map(function(g) { return _text(g); }).filter(Boolean),
      studios: [], country: _text(d.country || ''), language: _text(d.language || ''),
      duration: d.duration || null, score: isFinite(rating) && rating > 0 ? Math.round(rating * 10) : undefined,
      type: 'movie', sourceId: SOURCE_ID, episodes: eps, subCount: eps.length, dubCount: dubs.length,
      audioLanguages: dubs, detailPath: detailPath
    };
  }).catch(function(error) {
    console.warn('MovieBox metadata failed for ' + subjectId + ': ' + String(error));
    return null;
  });
}
function getEpisodes(url, opts) {
  var parsed = _parseEpisodeUrl(url), id = parsed.id || _id(url);
  if (!id) return Promise.resolve([]);
  return Promise.all([
    _request('/episodes/' + encodeURIComponent(id), opts),
    _request('/detail/' + encodeURIComponent(id), opts).catch(function() { return {}; })
  ]).then(function(values) {
    var d = values[1] && (values[1].data || values[1]) || {};
    var data = values[0] && (values[0].seasons || (values[0].data && values[0].data.seasons)) || [];
    return _makeEpisodes(id, data, d.detail_path || d.detailPath || '');
  }).catch(function() { return []; });
}
function _quality(s) {
  var q = String(s || '').match(/(2160|1440|1080|720|480|360|240)\s*p?/i);
  return q ? q[1] + 'p' : 'Auto';
}
function _captions(id, season, episode, opts) {
  return _request('/api/stream/' + encodeURIComponent(id) + '/captions?se=' + season + '&ep=' + episode, opts)
    .then(function(data) {
      var rows = data && (data.captions || data.subtitles || data.data || []) || [];
      if (!Array.isArray(rows)) return [];
      return rows.map(function(s) {
        return { url: s.url || s.link, lang: s.lang_name || s.language || s.lang || s.label || 'Unknown',
          label: s.lang_name || s.language || s.lang || s.label || 'Subtitle', format: s.format || 'srt' };
      }).filter(function(s) { return !!s.url; });
    }).catch(function() { return []; });
}
function getVideoSources(episodeUrl, opts) {
  var p = _parseEpisodeUrl(episodeUrl);
  var id = p.id || _id(episodeUrl);
  if (!id) return Promise.resolve([]);
  var detailPromise = p.detailPath ? Promise.resolve(p.detailPath) :
    _request('/detail/' + encodeURIComponent(id), opts).then(function(d) {
      d = d && (d.data || d) || {}; return d.detail_path || d.detailPath || '';
    }).catch(function() { return ''; });
  return detailPromise.then(function(detailPath) {
    var path = '/api/stream/' + encodeURIComponent(id) + '?se=' + p.season + '&ep=' + p.episode;
    if (detailPath) path += '&detail_path=' + encodeURIComponent(detailPath);
    return Promise.all([
      _request(path, opts),
      _captions(id, p.season, p.episode, opts)
    ]);
  }).then(function(values) {
    var data = values[0] && (values[0].data || values[0]) || {};
    var captions = values[1] || [];
    var streams = data.streams || data.sources || [];
    if (!Array.isArray(streams)) return [];
    var out = [], seen = {};
    streams.forEach(function(s) {
      if (!s || !s.url || seen[s.url]) return;
      seen[s.url] = 1;
      var fmt = String(s.format || '').toLowerCase();
      var u = String(s.url);
      var container = /dash|mpd/.test(fmt) || /\.mpd(?:[?#]|$)/i.test(u) ? 'dash' :
        /hls|m3u8/.test(fmt) || /\.m3u8(?:[?#]|$)/i.test(u) ? 'hls' : 'mp4';
      var headers = {};
      if (s.headers && typeof s.headers === 'object') Object.keys(s.headers).forEach(function(k) { headers[k] = s.headers[k]; });
      if (s.cookie && !headers.Cookie) headers.Cookie = s.cookie;
      out.push({ url: u, quality: _quality(s.quality || s.resolution_tag || s.format),
        label: String(s.source || 'MovieBox') + ' · ' + String(s.quality || s.resolution_tag || 'Auto'),
        container: container, kind: 'sub', headers: headers, subtitles: captions,
        size: s.size_mb || 0, codec: s.codec || '', duration: s.duration_sec || 0 });
    });
    out.sort(function(a,b) { return parseInt(b.quality,10) - parseInt(a.quality,10); });
    return out;
  }).catch(function() { return []; });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks };
}
