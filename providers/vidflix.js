// VidFlix movie/series source for Zangetsu.
// Uses VidCore's resolver API to turn TMDB movie/TV IDs into unlocked streams.
// The resolver also exposes an HLS relay for hosts that require server-side
// Referer/CORS handling; never return the VidFlix watch page as a playable URL.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'vidflix';
var VERSION = '1.0.0';
var TMDB_API = 'https://api.themoviedb.org/3';
var POSTER = 'https://image.tmdb.org/t/p/w500';
var BACKDROP = 'https://image.tmdb.org/t/p/w780';
var LOGO = 'https://www.google.com/s2/favicons?sz=256&domain=vidflix.site';
var DEFAULT_RESOLVER = 'https://advmtaxi-vidcore.hf.space';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'VidFlix', lang: 'en', baseUrl: 'https://vidflix.site', logo: LOGO, type: 'movie', version: VERSION };
}

function getSettings() {
  return [{
    key: 'resolverUrl',
    label: 'VidCore resolver URL',
    description: 'Resolver API base URL. The default is the public VidCore resolver; for a private deployment, enter its base URL (not /api/resolve).',
    type: 'text',
    default: DEFAULT_RESOLVER
  }];
}

function _trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
function _settings() {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : null;
    var s = all && all[SOURCE_ID] ? all[SOURCE_ID] : {};
    return { resolverUrl: _trim(s.resolverUrl || DEFAULT_RESOLVER).replace(/\/+$/, '') };
  } catch (e) { return { resolverUrl: DEFAULT_RESOLVER }; }
}
function _json(path) {
  return fetch(TMDB_API + path, { headers: { Accept: 'application/json' }, timeoutMs: 15000 })
    .then(function (r) {
      if (r && r.status && r.status >= 400) throw new Error('TMDB HTTP ' + r.status);
      var b = r && r.body != null ? r.body : '';
      return typeof b === 'string' ? JSON.parse(b || 'null') : b;
    }).catch(function () { return null; });
}
function _year(o) { return String(o && (o.release_date || o.first_air_date) || '').slice(0, 4) || null; }
function _kind(o, forced) { return forced || (o && (o.media_type === 'tv' || o.first_air_date) ? 'tv' : 'movie'); }
function _url(type, id) { return 'tmdb://' + (type === 'tv' ? 'tv' : 'movie') + '/' + String(id); }
function _item(o, forced) {
  if (!o || o.id == null) return null;
  var type = _kind(o, forced);
  if (o.media_type && o.media_type !== 'movie' && o.media_type !== 'tv') return null;
  var title = _trim(o.title || o.name);
  if (!title) return null;
  var url = _url(type, o.id);
  var item = {
    id: url, title: title + (_year(o) ? ' (' + _year(o) + ')' : ''),
    cover: o.poster_path ? POSTER + o.poster_path : null,
    banner: o.backdrop_path ? BACKDROP + o.backdrop_path : null,
    url: url, type: 'movie', sourceId: SOURCE_ID, tmdbId: Number(o.id), tmdbIsTv: type === 'tv'
  };
  if (o.vote_average != null && isFinite(Number(o.vote_average))) item.score = Math.round(Number(o.vote_average) * 10);
  return item;
}
function _items(r, forced) {
  var rows = r && Array.isArray(r.results) ? r.results : [];
  return rows.map(function (o) { return _item(o, forced); }).filter(Boolean);
}
function getHome() {
  return Promise.all([
    _json('/trending/movie/week'), _json('/trending/tv/week'),
    _json('/movie/popular'), _json('/tv/popular')
  ]).then(function (r) {
    return [
      { title: 'Trending Movies', items: _items(r[0], 'movie') },
      { title: 'Trending Series', items: _items(r[1], 'tv') },
      { title: 'Popular Movies', items: _items(r[2], 'movie') },
      { title: 'Popular Series', items: _items(r[3], 'tv') }
    ].filter(function (x) { return x.items.length; });
  });
}
function search(query, page) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  return _json('/search/multi?query=' + encodeURIComponent(q) + '&page=' + Math.max(1, parseInt(page, 10) || 1))
    .then(function (r) { return _items(r, null); });
}
function _parseId(raw) {
  if (raw && typeof raw === 'object') {
    var objectId = raw.tmdbId || raw.tmdb_id || raw.videoId || raw.id;
    var type = raw.tmdbIsTv === true || raw.type === 'tv' || raw.type === 'series' ? 'tv' : 'movie';
    if (objectId != null && isFinite(Number(objectId))) return { id: Number(objectId), type: type, season: Number(raw.season) || 0, episode: Number(raw.episode) || 0 };
  }
  var s = String(raw || '');
  if (s.charAt(0) === '{') { try { return _parseId(JSON.parse(s)); } catch (e) {} }
  var m = s.match(/^(?:tmdb|torbox):\/\/(movie|tv|series)\/(\d+)/i);
  if (!m) return null;
  return { id: Number(m[2]), type: /^(tv|series)$/i.test(m[1]) ? 'tv' : 'movie', season: 0, episode: 0 };
}
function _episodeUrl(type, id, imdb, season, episode) {
  return JSON.stringify({
    id: _url(type, id), videoId: _url(type, id), type: type === 'tv' ? 'series' : 'movie',
    tmdbId: Number(id), tmdbIsTv: type === 'tv', imdbId: imdb || null,
    season: Number(season) || 0, episode: Number(episode) || 0
  });
}
function _episodes(id, imdb, count) {
  var n = Math.min(40, Math.max(1, Number(count) || 1));
  return Promise.all(Array.from({ length: n }, function (_, i) {
    var season = i + 1;
    return _json('/tv/' + id + '/season/' + season).then(function (r) {
      return { season: season, episodes: r && Array.isArray(r.episodes) ? r.episodes : [] };
    });
  })).then(function (seasons) {
    var out = [];
    seasons.forEach(function (row) {
      row.episodes.forEach(function (ep, i) {
        if (ep.episode_number == null) return;
        var num = Number(ep.episode_number) || i + 1;
        var sn = row.season;
        out.push({
          id: sn + 'x' + num, title: 'S' + (sn < 10 ? '0' : '') + sn + ' E' + (num < 10 ? '0' : '') + num + ' - ' + (ep.name || ('Episode ' + num)),
          number: num, season: sn, url: _episodeUrl('tv', id, imdb, sn, num),
          date: ep.air_date || null, thumbnail: ep.still_path ? 'https://image.tmdb.org/t/p/w300' + ep.still_path : null
        });
      });
    });
    return out;
  });
}
function getDetail(raw) {
  var parsed = _parseId(raw);
  if (!parsed) return Promise.resolve(null);
  var path = parsed.type === 'tv' ? '/tv/' + parsed.id + '?append_to_response=external_ids' : '/movie/' + parsed.id + '?append_to_response=external_ids';
  return _json(path).then(function (info) {
    if (!info || info.id == null) return null;
    var imdb = info.external_ids && info.external_ids.imdb_id || null;
    var episodesPromise = parsed.type === 'tv'
      ? _episodes(parsed.id, imdb, info.number_of_seasons || (info.seasons || []).length || 1)
      : Promise.resolve([{ id: 'movie', title: _trim(info.title || info.name), number: 1, url: _episodeUrl('movie', parsed.id, imdb, 0, 0) }]);
    return episodesPromise.then(function (episodes) {
      var result = {
        id: _url(parsed.type, parsed.id), title: _trim(info.title || info.name || 'Untitled'),
        cover: info.poster_path ? POSTER + info.poster_path : null,
        banner: info.backdrop_path ? BACKDROP + info.backdrop_path : null,
        url: _url(parsed.type, parsed.id), description: info.overview || '',
        status: String(info.status || '').toLowerCase(), genres: (info.genres || []).map(function (g) { return g.name; }).filter(Boolean),
        studios: [], type: 'movie', sourceId: SOURCE_ID, year: _year(info),
        tmdbId: Number(parsed.id), tmdbIsTv: parsed.type === 'tv', imdbId: imdb,
        episodes: episodes, subCount: episodes.length, dubCount: 0
      };
      if (info.vote_average != null && isFinite(Number(info.vote_average))) result.score = Math.round(Number(info.vote_average) * 10);
      return result;
    });
  });
}
function getEpisodes(raw) {
  return getDetail(raw).then(function (d) { return d && Array.isArray(d.episodes) ? d.episodes : []; });
}
function _resolverBase() {
  var u = _settings().resolverUrl;
  if (!/^https?:\/\//i.test(u)) return '';
  return u.replace(/\/api\/resolve\/?$/i, '').replace(/\/$/, '');
}
function _resolveUrl(request) {
  var base = _resolverBase();
  if (!base) return '';
  var q = 'type=' + encodeURIComponent(request.type) + '&id=' + encodeURIComponent(request.id);
  if (request.type === 'tv') q += '&season=' + encodeURIComponent(request.season) + '&episode=' + encodeURIComponent(request.episode);
  return base + '/api/resolve?' + q;
}
function _toAbsolute(url) {
  var s = String(url || '');
  var base = _resolverBase();
  if (!base) return '';
  if (!/^https?:\/\//i.test(s)) return base + (s.charAt(0) === '/' ? '' : '/') + s;
  try {
    var parsed = new URL(s);
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(parsed.hostname) || /^10\./.test(parsed.hostname) || /^192\.168\./.test(parsed.hostname)) {
      return base + parsed.pathname + parsed.search + parsed.hash;
    }
  } catch (e) {}
  return s;
}
function _streamContainer(url, hint) {
  var u = String(url || '');
  if (hint === 'hls' || /\.m3u8(?:[?#]|$)/i.test(u) || /\/api\/hls\?/i.test(u)) return 'hls';
  if (/\.mpd(?:[?#]|$)/i.test(u)) return 'dash';
  if (/\.(mp4|m4v|mov|webm)(?:[?#]|$)/i.test(u)) return 'mp4';
  return 'unknown';
}
function getVideoSources(raw) {
  var parsed = _parseId(raw);
  if (!parsed) return Promise.resolve([]);
  var season = parsed.season, episode = parsed.episode;
  // The app's episode URL is JSON from _episodeUrl; getDetail's series entries carry S/E separately.
  if (raw && typeof raw === 'object') {
    season = Number(raw.season) || season; episode = Number(raw.episode) || episode;
  }
  if (typeof raw === 'string' && raw.charAt(0) === '{') {
    try { var obj = JSON.parse(raw); season = Number(obj.season) || season; episode = Number(obj.episode) || episode; } catch (e) {}
  }
  var type = parsed.type === 'tv' ? 'tv' : 'movie';
  if (type === 'tv' && (season < 1 || episode < 1)) return Promise.resolve([]);
  var apiUrl = _resolveUrl({ type: type, id: parsed.id, season: season, episode: episode });
  if (!apiUrl) return Promise.resolve([]);
  return fetch(apiUrl, { headers: { Accept: 'application/x-ndjson, application/json' }, timeoutMs: 25000 })
    .then(function (response) {
      if (response && response.status && response.status >= 400) throw new Error('VidFlix resolver HTTP ' + response.status);
      var body = response && response.body != null ? response.body : '';
      if (typeof body !== 'string') body = JSON.stringify(body || '');
      var lines = body.split(/\r?\n/), out = [], seen = {};
      lines.forEach(function (line) {
        if (!line) return;
        var row;
        try { row = JSON.parse(line); } catch (e) { return; }
        if (row.event !== 'server' || !row.server || row.server.ok === false) return;
        var server = row.server;
        // Prefer the resolver's HLS relay: it adds the upstream Referer and rewrites
        // segment URLs. Direct CDN links remain a fallback for native players.
        var viaRelay = server.play ? _toAbsolute(server.play) : '';
        var url = viaRelay || (server.url && /^https?:\/\//i.test(server.url) ? server.url : '');
        if (!url || seen[url]) return;
        seen[url] = true;
        var direct = !viaRelay;
        var name = String(server.name || 'Server');
        out.push({
          url: url,
          quality: 'Auto',
          container: _streamContainer(url, direct ? '' : 'hls'),
          kind: 'raw',
          audioLang: '',
          subtitles: [],
          label: 'VidFlix · VidCore · ' + name + (server.ms != null ? ' (' + Math.max(0, Number(server.ms) || 0) + ' ms)' : ''),
          headers: direct ? { 'Referer': 'https://vidcore.net/', 'Origin': 'https://vidcore.net/', 'User-Agent': UA } : {}
        });
      });
      return out;
    }).catch(function (error) {
      console.warn('VidFlix resolver failed:', String(error));
      return [];
    });
}
function getStreams(raw, opts) { return getVideoSources(raw, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome,
    search: search, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams,
    _parseId: _parseId, _resolveUrl: _resolveUrl, _toAbsolute: _toAbsolute, _streamContainer: _streamContainer
  };
}
