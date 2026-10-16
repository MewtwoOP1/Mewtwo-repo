// Re:ANIME source for Zangetsu.
// Uses Re:ANIME's public catalogue/watch JSON endpoints. Existing providers are
// intentionally left untouched. Playback links are handed to Zangetsu's
// registered embed extractors; unsupported FlixCloud links are skipped.
var SITE = 'https://reanime.to';
var API = SITE + '/api';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'reanime';
var VERSION = '1.0.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var _cardsBySlug = {};
var _details = {};

function getInfo() {
  return { name: 'Re:ANIME', lang: 'en', baseUrl: SITE,
    logo: SITE + '/favicon.ico', type: 'anime', version: VERSION };
}
function _getJson(url, referer) {
  return fetch(url, { headers: {
    'User-Agent': UA, 'Accept': 'application/json, */*',
    'Referer': referer || SITE + '/'
  }, timeoutMs: 15000 }).then(function (r) {
    if (r && r.status >= 400) throw new Error('Re:ANIME HTTP ' + r.status);
    var body = r && r.body != null ? r.body : '';
    return JSON.parse(typeof body === 'string' ? (body || '{}') : JSON.stringify(body));
  });
}
function _arr(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== 'object') return [];
  if (Array.isArray(v.data)) return v.data;
  if (Array.isArray(v.results)) return v.results;
  if (Array.isArray(v.items)) return v.items;
  if (Array.isArray(v.episodes)) return v.episodes;
  return [];
}
function _title(a) {
  var t = a && (a.title || a.name || a.english_title || a.english);
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') return t.english || t.romaji || t.native || '';
  return '';
}
function _cover(a) {
  var c = a && (a.cover_image || a.cover || a.poster || a.poster_image || a.image);
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object') return c.extra_large || c.extraLarge || c.large || c.medium || c.url || '';
  return '';
}
function _slug(a) {
  return String(a && (a.slug || a.id || a.anime_slug) || '');
}
function _num(v) {
  var n = Number(v);
  return isFinite(n) && n > 0 ? n : null;
}
function _card(a) {
  var slug = _slug(a), title = _title(a);
  if (!slug || !title) return null;
  var aid = _num(a.anilist || a.anilist_id || a.anilistId);
  var card = {
    id: slug, title: title, englishTitle: a.english_title || a.englishTitle || null,
    url: slug, cover: _cover(a) || null, type: 'anime', sourceId: SOURCE_ID,
    anilistId: aid, subCount: 1, dubCount: 1
  };
  _cardsBySlug[slug] = card;
  if (!card.cover) delete card.cover;
  if (!card.englishTitle || card.englishTitle === title) delete card.englishTitle;
  if (!card.anilistId) delete card.anilistId;
  return card;
}
function _cards(data) {
  var out = [], seen = {};
  _arr(data).forEach(function (a) {
    var c = _card(a);
    if (c && !seen[c.url]) { seen[c.url] = true; out.push(c); }
  });
  return out;
}
function getHome() {
  return Promise.all([
    _getJson(API + '/home/latest-aired?limit=18').then(function (d) {
      return { title: 'Recently Aired', items: _cards(d) };
    }).catch(function () { return { title: 'Recently Aired', items: [] }; }),
    _getJson(API + '/top/anime?period=week&limit=18').then(function (d) {
      return { title: 'Top Anime', items: _cards(d) };
    }).catch(function () { return { title: 'Top Anime', items: [] }; })
  ]).then(function (rows) {
    return rows.filter(function (r) { return r.items.length > 0; });
  });
}
function popular(opts) {
  var page = Math.max(1, Number(opts && opts.page) || 1);
  return _getJson(API + '/top/anime?period=week&limit=24&offset=' + ((page - 1) * 24))
    .then(_cards).catch(function () { return []; });
}
function search(query, page) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, Number(page) || 1);
  return _getJson(API + '/search?q=' + encodeURIComponent(q) + '&limit=24&offset=' + ((p - 1) * 24))
    .then(_cards).catch(function () { return []; });
}
function _epNumber(e, index) {
  var n = Number(e && (e.number || e.episode || e.episode_number || e.ep));
  return isFinite(n) && n > 0 ? n : index + 1;
}
function _episodeList(data, slug) {
  var list = _arr(data), out = [];
  list.forEach(function (e, i) {
    var n = _epNumber(e, i);
    var url = String(e && (e.url || e.slug || e.id) || '');
    if (!url) url = String(n);
    out.push({ id: slug + '||' + n, number: n,
      title: String(e && (e.title || e.name) || ('Episode ' + n)),
      url: slug + '||' + n });
  });
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}
function getDetail(url) {
  var slug = String(url || '').replace(/^reanime:\/\//, '').split('||')[0].replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+|\/+$/g, '');
  if (!slug) return Promise.resolve(null);
  if (_details[slug]) return Promise.resolve(_details[slug]);
  return Promise.all([
    _getJson(API + '/watch/' + encodeURIComponent(slug) + '/1').catch(function () { return null; }),
    _getJson(API + '/episodes/' + encodeURIComponent(slug)).catch(function () { return null; })
  ]).then(function (results) {
    var watch = results[0] || {};
    var anime = watch.anime || watch.data || watch;
    var card = _cardsBySlug[slug] || _card(anime);
    var episodes = _episodeList(results[1], slug);
    if (!card && !episodes.length) return null;
    var detail = {
      id: slug, title: _title(anime) || (card && card.title) || slug,
      url: slug, cover: _cover(anime) || (card && card.cover) || null,
      description: anime.description || anime.synopsis || '',
      status: anime.status || undefined, genres: anime.genres || undefined,
      year: anime.year || anime.release_year || undefined,
      type: 'anime', sourceId: SOURCE_ID, episodes: episodes,
      anilistId: _num(anime.anilist || anime.anilist_id || anime.anilistId) || (card && card.anilistId) || undefined,
      subCount: episodes.length, dubCount: episodes.length
    };
    if (!detail.cover) delete detail.cover;
    if (!detail.description) delete detail.description;
    if (!detail.status) delete detail.status;
    if (!detail.genres || !detail.genres.length) delete detail.genres;
    if (!detail.year) delete detail.year;
    _details[slug] = detail;
    return detail;
  }).catch(function () { return null; });
}
function getEpisodes(url) {
  return getDetail(url).then(function (d) { return d && d.episodes || []; });
}
function getVideoSources(episodeUrl, opts) {
  var value = String(episodeUrl && (episodeUrl.url || episodeUrl.id) || episodeUrl || '');
  var m = value.match(/^(.+?)\|\|(\d+)$/);
  if (!m) return Promise.reject(new Error('Re:ANIME: invalid episode reference'));
  var slug = m[1], ep = Number(m[2]);
  return _getJson(API + '/watch/' + encodeURIComponent(slug) + '/' + ep)
    .then(function (watch) {
      var anime = watch && watch.anime || {};
      var links = Array.isArray(watch && watch.episode_links) ? watch.episode_links : [];
      var mode = opts && opts.category === 'dub' ? 'dub' : 'sub';
      var selected = links.filter(function (s) {
        var t = String(s && (s.dataType || s.type) || '').toLowerCase();
        return t === mode || (mode === 'sub' && t === 's-sub');
      });
      if (typeof extractVideo !== 'function') {
        throw new Error('Re:ANIME: this Zangetsu runtime has no embed extractor bridge');
      }
      var jobs = selected.map(function (s) {
        var link = String(s && (s.dataLink || s.url || s.link) || '');
        if (!/^https?:\/\//i.test(link)) return Promise.resolve([]);
        return extractVideo(link, { headers: { 'Referer': SITE + '/', 'User-Agent': UA },
          kind: mode, audioLang: mode === 'dub' ? 'en' : 'ja' })
          .then(function (rows) {
            return (rows || []).map(function (row) {
              row.label = 'Re:ANIME ' + String(s.serverName || 'Server') + ' ' + mode.toUpperCase();
              return row;
            });
          }).catch(function () { return []; });
      });
      return Promise.all(jobs).then(function (lists) {
        var out = [], seen = {};
        lists.forEach(function (rows) {
          rows.forEach(function (r) {
            if (r && r.url && !seen[r.url]) { seen[r.url] = true; out.push(r); }
          });
        });
        if (!out.length) throw new Error('Re:ANIME: no playable stream extracted from available servers');
        return out;
      });
    });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: VERSION, getInfo: getInfo, getHome: getHome,
    popular: popular, search: search, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams,
    _card: _card, _cards: _cards, _episodeList: _episodeList };
}
