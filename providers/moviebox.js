// MovieBox standalone stream provider for Zangetsu.
// Uses TMDB for discovery/metadata and the MovieBox community worker for streams.
// Worker availability and playback are external dependencies; failures return [].
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'moviebox';
var TMDB = 'https://api.themoviedb.org/3';
var POSTER = 'https://image.tmdb.org/t/p/w500';
var BACKDROP = 'https://image.tmdb.org/t/p/w780';
var WORKER = 'https://moviebox.s4nch1tt.workers.dev';
var SITE = 'https://officialmoviebox.com';
var VERSION = '1.0.0';
function getInfo() { return { name: 'MovieBox', lang: 'en', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=themoviebox.org', type: 'movie', version: VERSION }; }
function getSettings() { return []; }
function trim(v) { return String(v == null ? '' : v).trim(); }
function json(url, headers) {
  return fetch(url, { headers: headers || { Accept: 'application/json' }, timeoutMs: 15000 }).then(function(r) {
    if (r && r.status >= 400) throw new Error('HTTP ' + r.status);
    var b = r && r.body != null ? r.body : '';
    return typeof b === 'string' ? JSON.parse(b || 'null') : b;
  }).catch(function() { return null; });
}
function tmdb(path) { return json(TMDB + path); }
function year(x) { return String(x && (x.release_date || x.first_air_date) || '').slice(0, 4); }
function mediaType(x, forced) { return forced || (x && (x.media_type === 'tv' || x.first_air_date) ? 'tv' : 'movie'); }
function mediaUrl(type, id) { return 'moviebox://' + (type === 'tv' ? 'tv' : 'movie') + '/' + id; }
function item(x, forced) {
  if (!x || x.id == null) return null;
  var type = mediaType(x, forced), title = trim(x.title || x.name);
  if (!title) return null;
  return { id: mediaUrl(type, x.id), title: title + (year(x) ? ' (' + year(x) + ')' : ''), cover: x.poster_path ? POSTER + x.poster_path : null, banner: x.backdrop_path ? BACKDROP + x.backdrop_path : null, url: mediaUrl(type, x.id), type: 'movie', sourceId: SOURCE_ID, tmdbId: Number(x.id), tmdbIsTv: type === 'tv', score: x.vote_average == null ? undefined : Math.round(Number(x.vote_average) * 10) };
}
function mapItems(data, forced) { return (data && Array.isArray(data.results) ? data.results : []).map(function(x) { return item(x, forced); }).filter(Boolean); }
function getHome() {
  return Promise.all([tmdb('/trending/movie/week'), tmdb('/trending/tv/week'), tmdb('/movie/popular')]).then(function(a) {
    return [{ title: 'Trending Movies', items: mapItems(a[0], 'movie') }, { title: 'Trending Series', items: mapItems(a[1], 'tv') }, { title: 'Popular Movies', items: mapItems(a[2], 'movie') }].filter(function(r) { return r.items.length; });
  });
}
function search(query, page) {
  var q = trim(query); if (!q) return Promise.resolve([]);
  return tmdb('/search/multi?query=' + encodeURIComponent(q) + '&page=' + Math.max(1, parseInt(page, 10) || 1)).then(function(data) {
    return mapItems(data).filter(function(x) { return x.tmdbId && x.id; });
  });
}
function parseMedia(value) {
  if (value && typeof value === 'object') {
    var oid = value.tmdbId || value.id || value.videoId;
    if (oid != null && isFinite(Number(oid))) return { id: Number(oid), type: value.tmdbIsTv || value.type === 'tv' || value.type === 'series' ? 'tv' : 'movie', season: Number(value.season) || 0, episode: Number(value.episode) || 0 };
  }
  var s = String(value || ''), m = s.match(/^moviebox:\/\/(movie|tv|series)\/(\d+)(?:\/(\d+)\/(\d+))?/i);
  if (m) return { id: Number(m[2]), type: m[1].toLowerCase() === 'tv' || m[1].toLowerCase() === 'series' ? 'tv' : 'movie', season: Number(m[3]) || 0, episode: Number(m[4]) || 0 };
  try { if (s.charAt(0) === '{') return parseMedia(JSON.parse(s)); } catch(e) {}
  return null;
}
function episodeUrl(type, id, season, episode) { return 'moviebox://' + type + '/' + id + (type === 'tv' ? '/' + season + '/' + episode : ''); }
function getDetail(url) {
  var p = parseMedia(url); if (!p) return Promise.resolve(null);
  return tmdb('/' + (p.type === 'tv' ? 'tv/' : 'movie/') + p.id + '?append_to_response=external_ids').then(function(info) {
    if (!info || !info.id) return null;
    var title = trim(info.title || info.name || 'Untitled'), eps = [];
    if (p.type !== 'tv') {
      eps.push({ id: 'movie', title: title, number: 1, url: episodeUrl('movie', p.id, 0, 0) });
      return build(info, eps);
    }
    var seasons = (info.seasons || []).filter(function(s) { return Number(s.season_number) > 0; });
    return Promise.all(seasons.map(function(season) {
      return tmdb('/tv/' + p.id + '/season/' + season.season_number).then(function(data) {
        return (data && Array.isArray(data.episodes) ? data.episodes : []).map(function(ep) {
          return { id: 's' + season.season_number + 'e' + ep.episode_number, title: 'S' + season.season_number + 'E' + ep.episode_number + ' · ' + trim(ep.name || 'Episode ' + ep.episode_number), number: ep.episode_number, season: season.season_number, url: episodeUrl('tv', p.id, season.season_number, ep.episode_number) };
        });
      });
    })).then(function(rows) { rows.forEach(function(row) { eps = eps.concat(row); }); return build(info, eps); });
    function build(data, episodes) {
      return { id: mediaUrl(p.type, p.id), title: title, cover: data.poster_path ? POSTER + data.poster_path : null, banner: data.backdrop_path ? BACKDROP + data.backdrop_path : null, url: mediaUrl(p.type, p.id), description: data.overview || '', genres: (data.genres || []).map(function(g) { return g.name; }), year: year(data), type: 'movie', sourceId: SOURCE_ID, tmdbId: p.id, tmdbIsTv: p.type === 'tv', imdbId: data.external_ids && data.external_ids.imdb_id || null, episodes: episodes, subCount: episodes.length, dubCount: 0 };
    }
  });
}
function getEpisodes(url) { return getDetail(url).then(function(d) { return d && Array.isArray(d.episodes) ? d.episodes : []; }); }
function getVideoSources(episodeUrlValue) { return getStreams(episodeUrlValue); }
function _mbUnwrap(obj) {
  if (!obj || typeof obj !== 'object') return {};
  if (obj.data && obj.data.data) return obj.data.data;
  if (obj.data) return obj.data;
  return obj;
}
function _mbBody(response) {
  var body = response && response.body != null ? response.body : '';
  if (typeof body !== 'string') return body;
  try { return JSON.parse(body || 'null'); } catch (e) { return null; }
}
function _mbHeaders(response) {
  var h = response && response.headers || {}, out = {};
  Object.keys(h).forEach(function(k) { out[String(k).toLowerCase()] = h[k]; });
  return out;
}
function _mbRequest(url, method, body, headers) {
  var opts = { method: method || 'GET', headers: headers || {}, timeoutMs: 20000 };
  if (body != null) {
    opts.body = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
  }
  return fetch(url, opts).then(function(r) {
    if (r && r.status >= 400) throw new Error('MovieBox HTTP ' + r.status);
    return { body: _mbBody(r), headers: _mbHeaders(r) };
  });
}
function getStreams(value, opts, seasonArg, episodeArg) {
  var p = parseMedia(value);
  if (!p && value != null && isFinite(Number(value))) {
    p = { id: Number(value), type: opts === 'tv' || opts === 'series' ? 'tv' : 'movie',
      season: Number(seasonArg) || 0, episode: Number(episodeArg) || 0 };
  }
  if (!p || !p.id) return Promise.resolve([]);
  if (p.type === 'tv' && (!(p.season || Number(seasonArg)) || !(p.episode || Number(episodeArg)))) return Promise.resolve([]);
  var titlePath = '/' + (p.type === 'tv' ? 'tv/' : 'movie/') + p.id + '?append_to_response=external_ids';
  return tmdb(titlePath).then(function(meta) {
    if (!meta) return [];
    var title = trim(meta.title || meta.name || '');
    if (!title) return [];
    var isTv = p.type === 'tv';
    var season = p.season || Number(seasonArg) || 1;
    var episode = p.episode || Number(episodeArg) || 1;
    var api = 'https://h5-api.aoneroom.com';
    var ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    return _mbRequest(api + '/wefeed-h5api-bff/app/get-latest-app-pkgs?app_name=moviebox', 'GET', null, { 'User-Agent': ua })
      .then(function(pkg) {
        var xuser = pkg.headers['x-user'] || pkg.headers['X-User'] || '';
        var token = '';
        try { token = (JSON.parse(String(xuser)) || {}).token || ''; } catch (e) {}
        if (!token) return [];
        var baseHeaders = {
          'X-Client-Info': '{"timezone":"Asia/Kolkata"}',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'application/json',
          'Referer': api,
          'Host': 'h5-api.aoneroom.com',
          'Authorization': 'Bearer ' + token,
          'User-Agent': ua
        };
        return _mbRequest(api + '/wefeed-h5api-bff/subject/search', 'POST',
          { keyword: title, page: 1, perPage: 24, subjectType: isTv ? 2 : 1 }, Object.assign({}, baseHeaders))
          .then(function(searchResponse) {
            var items = _mbUnwrap(searchResponse.body).items || [];
            var want = title.toLowerCase().replace(/\sS\d+.*$/i, '').trim();
            var selected = null, language = 'Original';
            for (var i = 0; i < items.length; i++) {
              var it = items[i], candidate = trim(it.title || it.name).toLowerCase();
              if (candidate && (candidate === want || candidate.indexOf(want) !== -1 || want.indexOf(candidate) !== -1)) {
                selected = it; break;
              }
            }
            if (!selected && items.length) selected = items[0];
            if (!selected) return [];
            var subjectId = selected.id || selected.subjectId;
            language = selected.lanName || selected.language || language;
            if (!subjectId) return [];
            var detailUrl = 'https://h5.aoneroom.com/wefeed-h5-bff/web/post/list/subject?id=' + encodeURIComponent(subjectId);
            return _mbRequest(detailUrl, 'GET', null, { 'User-Agent': ua, 'Accept': 'application/json' }).then(function(detail) {
              var detailItems = detail.body && detail.body.data && detail.body.data.items || [];
              var detailPath = detailItems.length && detailItems[0].subject ? detailItems[0].subject.detailPath || '' : '';
              var params = 'subjectId=' + encodeURIComponent(subjectId)
                + (isTv ? '&se=' + encodeURIComponent(season) + '&ep=' + encodeURIComponent(episode) : '')
                + (detailPath ? '&detailPath=' + encodeURIComponent(detailPath) : '');
              var referer = 'https://fmoviesunblocked.net/spa/videoPlayPage/movies/' + detailPath
                + '?id=' + encodeURIComponent(subjectId) + '&type=/movie/detail';
              var playHeaders = { 'Referer': referer, 'Origin': 'https://fmoviesunblocked.net', 'User-Agent': ua };
              function collect(path) {
                return _mbRequest(api + path + params, 'GET', null, Object.assign({}, baseHeaders, {
                  'Referer': referer, 'Origin': 'https://fmoviesunblocked.net'
                })).then(function(resp) {
                  var data = _mbUnwrap(resp.body), arr = data.downloads || data.streams || [], out = [];
                  (arr || []).forEach(function(stream) {
                    if (!stream || !stream.url || stream.vipLocked) return;
                    var res = stream.resolution || stream.resolutions || 'Auto';
                    var url = String(stream.url);
                    if (!/^https?:\/\//i.test(url)) return;
                    out.push({ url: url, quality: String(res), label: 'MovieBox [' + language + '] · ' + res,
                      name: 'MovieBox', source: 'MovieBox', container: /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : /\.mp4(?:[?#]|$)/i.test(url) ? 'mp4' : 'unknown',
                      headers: playHeaders, kind: 'raw', audioLang: '', subtitles: [] });
                  });
                  var captions = data.captions || [];
                  captions.forEach(function(c) {
                    if (!c || !c.url) return;
                    out.forEach(function(s) { s.subtitles.push({ url: c.url, language: c.lan || c.lanName || 'en', name: (c.lanName || c.lan || 'Subtitle') + ' [MovieBox]' }); });
                  });
                  return out;
                }).catch(function() { return []; });
              }
              return Promise.all([collect('/wefeed-h5api-bff/subject/download?'), collect('/wefeed-h5api-bff/subject/play?')])
                .then(function(rows) {
                  var out = [], seen = {};
                  rows.forEach(function(row) { row.forEach(function(s) { if (s && s.url && !seen[s.url]) { seen[s.url] = true; out.push(s); } }); });
                  out.sort(function(a,b) { return (parseInt(b.quality,10)||0) - (parseInt(a.quality,10)||0); });
                  return out;
                });
            });
          });
      }).catch(function(e) { console.warn('MovieBox source failed:', String(e)); return []; });
  }).catch(function() { return []; });
}
if (typeof module !== 'undefined' && module.exports) module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams };
