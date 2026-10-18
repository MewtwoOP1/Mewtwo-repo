// Mew-Aniem — single-source aggregator for every provider exposed by Anivexa API.
// AniList IDs are passed through unchanged; never apply +/-1 adjustments.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'mew-aniem';
var VERSION = '1.0.0';
var API = 'https://anivexa-api9.onrender.com';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var SEARCH_QUERY = 'query ($search: String, $page: Int) { Page(page: $page, perPage: 20) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) { id title { english romaji native } coverImage { extraLarge large medium } seasonYear startDate { year } description(asHtml: false) } } }';
var HOME_QUERY = 'query { Page(page: 1, perPage: 24) { media(type: ANIME, sort: TRENDING_DESC) { id title { english romaji native } coverImage { extraLarge large medium } seasonYear startDate { year } description(asHtml: false) } } }';
var DETAIL_QUERY = 'query ($id: Int) { Media(id: $id, type: ANIME) { id title { english romaji native } coverImage { extraLarge large medium } seasonYear startDate { year } description(asHtml: false) episodes status genres } }';

function getInfo() { return { name: 'Mew-Aniem', lang: 'en', baseUrl: API, logo: 'https://www.google.com/s2/favicons?sz=256&domain=anivexa-api9.onrender.com', type: 'anime', version: VERSION }; }
function getSettings() { return []; }
function _request(url, options) {
  var opts = options || {};
  opts.headers = opts.headers || {};
  opts.headers['User-Agent'] = UA;
  return fetch(url, opts).then(function(r) {
    if (!r || (r.status && r.status >= 400)) return '';
    return r.body || '';
  }).catch(function() { return ''; });
}
function _json(url, options) {
  return _request(url, options).then(function(body) { try { return JSON.parse(body || 'null'); } catch (_) { return null; } });
}
function _anilist(query, variables) {
  return _json(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: query, variables: variables || {} }), timeoutMs: 18000 });
}
function _title(m) { return m && m.title ? (m.title.english || m.title.romaji || m.title.native || 'Unknown anime') : 'Unknown anime'; }
function _cover(m) { return m && m.coverImage ? (m.coverImage.extraLarge || m.coverImage.large || m.coverImage.medium || null) : null; }
function _card(m) {
  var id = m && m.id != null ? String(m.id) : '';
  if (!/^\d+$/.test(id)) return null;
  return { id: id, title: _title(m), url: id, cover: _cover(m), type: 'anime', sourceId: SOURCE_ID,
    year: m.seasonYear || (m.startDate && m.startDate.year) || null,
    description: m.description ? htmlText(String(m.description).replace(/<br\s*\/?>/gi, ' ')).trim() : '' };
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _anilist(SEARCH_QUERY, { search: q, page: Math.max(1, Number(page) || 1) }).then(function(j) {
    return ((j && j.data && j.data.Page && j.data.Page.media) || []).map(_card).filter(Boolean);
  }).catch(function() { return []; });
}
function getHome(opts) {
  return _anilist(HOME_QUERY, {}).then(function(j) {
    var items = ((j && j.data && j.data.Page && j.data.Page.media) || []).map(_card).filter(Boolean);
    return items.length ? [{ title: 'Trending Anime', items: items }] : [];
  }).catch(function() { return []; });
}
function _id(value) {
  var s = String(value == null ? '' : value).replace(/^mewaniem:\/\//i, '').replace(/^https?:\/\/[^/]+\/?/, '').replace(/^\/+|\/+$/g, '');
  return /^\d+$/.test(s) ? s : '';
}
function _providerKeys(payload) {
  if (!payload || typeof payload !== 'object') return [];
  return Object.keys(payload).filter(function(k) { return k !== 'map' && k.charAt(0) !== '_' && payload[k] && typeof payload[k] === 'object'; });
}
function _episodeRows(pd, audio) {
  var eps = pd && pd.episodes;
  if (Array.isArray(eps)) return eps.filter(function(e) { return !e.audio || e.audio === audio; });
  return eps && Array.isArray(eps[audio]) ? eps[audio] : [];
}
function _episodeNumber(ep) {
  if (ep && ep.number != null && /^\d+$/.test(String(ep.number))) return String(ep.number);
  var m = String(ep && ep.id || '').match(/(?:-|\/)(\d+)$/);
  return m ? m[1] : '';
}
function _makeEpisodes(id, data) {
  var out = [], seen = {};
  _providerKeys(data).forEach(function(provider) {
    ['sub', 'dub'].forEach(function(audio) {
      _episodeRows(data[provider], audio).forEach(function(ep) {
        var number = _episodeNumber(ep);
        if (!number) return;
        var key = provider + '/' + audio + '/' + number;
        if (seen[key]) return;
        seen[key] = true;
        out.push({ id: key, number: Number(number), title: String(ep.title || ep.name || ('Episode ' + number)) + (audio === 'dub' ? ' (Dub)' : ' (Sub)'),
          url: 'mewaniem://' + id + '/' + provider + '/' + audio + '/' + number,
          type: 'anime', category: audio, sourceId: SOURCE_ID, provider: provider });
      });
    });
  });
  out.sort(function(a, b) { return a.number - b.number || a.provider.localeCompare(b.provider) || a.category.localeCompare(b.category); });
  return out;
}
function getDetail(url, opts) {
  var id = _id(url);
  if (!id) return Promise.resolve(null);
  // Preserve the original AniList ID exactly in both requests.
  return Promise.all([
    _anilist(DETAIL_QUERY, { id: Number(id) }),
    _json(API + '/episodes/' + id, { timeoutMs: 45000 })
  ]).then(function(results) {
    var media = results[0] && results[0].data && results[0].data.Media;
    var payload = results[1] || {};
    if (payload.error && !media) return null;
    var card = media ? _card(media) : { id: id, title: 'Anime ' + id, url: id, cover: null, type: 'anime', sourceId: SOURCE_ID };
    if (!card) return null;
    card.description = card.description || '';
    card.genres = media && media.genres || [];
    card.status = media && media.status || 'unknown';
    card.episodes = _makeEpisodes(id, payload);
    card.sourceCount = _providerKeys(payload).length;
    card.url = id;
    return card;
  }).catch(function() { return null; });
}
function getEpisodes(url, opts) { return getDetail(url, opts).then(function(d) { return d && Array.isArray(d.episodes) ? d.episodes : []; }); }
function _streamList(p) {
  if (!p) return [];
  if (Array.isArray(p)) return p;
  if (Array.isArray(p.streams)) return p.streams;
  if (Array.isArray(p.sources)) return p.sources;
  return p.data ? _streamList(p.data) : [];
}
function _normalise(s, index, provider) {
  if (!s || !s.url) return null;
  var kind = String(s.type || s.kind || '').toLowerCase(), embed = kind.indexOf('embed') !== -1 || s.embed === true;
  var headers = s.headers && typeof s.headers === 'object' ? s.headers : {};
  if (s.referer && !headers.Referer && !headers.referer) headers.Referer = s.referer;
  var subs = Array.isArray(s.subtitles) ? s.subtitles.map(function(t) {
    return { url: t.url, label: t.label || t.lang || t.srclang || 'Subtitle', lang: t.srclang || t.lang || '' };
  }).filter(function(t) { return !!t.url; }) : [];
  return { url: String(s.url), name: String(s.server || s.name || provider || ('Source ' + (index + 1))),
    provider: String(s.server || provider || 'Anivexa'), quality: String(s.quality || s.resolution || (embed ? 'Embed' : 'Unknown')),
    resolution: String(s.resolution || s.quality || (embed ? 'Embed' : 'Unknown')),
    container: embed ? 'embed' : (kind.indexOf('hls') !== -1 || /\.m3u8(?:$|\?)/i.test(s.url) ? 'm3u8' : kind || 'mp4'),
    hls: kind.indexOf('hls') !== -1 || /\.m3u8(?:$|\?)/i.test(s.url), embed: embed,
    downloadable: !!s.downloadable, headers: headers, subtitles: subs,
    isActive: s.isActive !== false, priority: Number(s.priority) || 0 };
}
function _resolveStreams(streams, i, out) {
  if (i >= streams.length) return Promise.resolve(out);
  var s = streams[i];
  if (!s || !s.url) return _resolveStreams(streams, i + 1, out);
  var kind = String(s.type || s.kind || '').toLowerCase(), embed = kind.indexOf('embed') !== -1 || s.embed === true;
  if (embed && typeof extractVideo === 'function') {
    var headers = s.headers && typeof s.headers === 'object' ? s.headers : {};
    if (s.referer && !headers.Referer && !headers.referer) headers.Referer = s.referer;
    return Promise.resolve(extractVideo(String(s.url), { headers: headers })).then(function(extracted) {
      (Array.isArray(extracted) ? extracted : (extracted ? [extracted] : [])).forEach(function(item, n) {
        var norm = _normalise(item, n, s.server || s.name); if (norm) out.push(norm);
      });
    }).catch(function() { var norm = _normalise(s, out.length, s.server || s.name); if (norm) out.push(norm); })
      .then(function() { return _resolveStreams(streams, i + 1, out); });
  }
  var norm = _normalise(s, out.length, s.server || s.name); if (norm) out.push(norm);
  return _resolveStreams(streams, i + 1, out);
}
function getVideoSources(episodeUrl, opts) {
  var m = String(episodeUrl || '').match(/^mewaniem:\/\/(\d+)\/([a-z0-9_-]+)\/(sub|dub)\/(\d+)$/i);
  if (!m) return Promise.resolve([]);
  var id = m[1], provider = m[2], audio = m[3], ep = m[4];
  var url = API + '/watch/' + encodeURIComponent(provider) + '/' + id + '/' + audio + '/' + encodeURIComponent(provider + '-' + ep);
  return _json(url, { timeoutMs: 45000 }).then(function(payload) {
    return _resolveStreams(_streamList(payload), 0, []);
  }).catch(function() { return []; });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams };
