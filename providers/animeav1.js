// AnimeAV1 — anime source for the Zangetsu provider repo (animeav1.com).
//
// SvelteKit site; every page has a `__data.json` twin carrying the page data as a devalue-flattened
// JSON document:
//   GET /catalogo/__data.json?search=<title>   -> { results: [{slug, title}] }
//   GET /media/<slug>/__data.json              -> { media: { malId, episodes: [{number}], ... } }
//   GET /media/<slug>/<n>/__data.json          -> { episode: {variants: {SUB, DUB}}, embeds: {SUB:[...], DUB:[...]} }
//
// Spanish-focused: Japanese audio with Spanish hard subtitles, plus a Latino Spanish dub where one
// exists. Hard-coded subtitles are never advertised as selectable tracks and no English variant is
// invented.
//
// Embeds resolved over plain HTTP:
//   VOE       -> HLS master from the encoded player config
//   YourUpload-> og:video MP4 (requires the host's Referer)
//   MP4Upload -> needs a per-host extractor the repo does not carry; skipped rather than faked

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animeav1';

var BASE = 'https://animeav1.com';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
var SUB_CAT = 'SUB';
var DUB_CAT = 'DUB';
var CACHE_TTL_MS = 30 * 60 * 1000;

var _detailCache = {};

function getInfo() {
  return { name: 'AnimeAV1', lang: 'es', baseUrl: BASE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animeav1.com', type: 'anime', version: '1.0.0' };
}
function getSettings() { return []; }

// ── Networking ─────────────────────────────────────────────────────────────
function _raceTimeout(promise, ms, fallback) {
  var hasTimers = typeof setTimeout === 'function' && typeof clearTimeout === 'function';
  if (!hasTimers) return promise;
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () { settled = true; resolve(fallback); }, ms);
    promise.then(function (value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, function (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function _fetchText(url, referer) {
  var h = { 'User-Agent': UA, 'Referer': referer || BASE + '/' };
  return _raceTimeout(fetch(url, { headers: h }).then(function (r) {
    if (!r) throw new Error('AnimeAV1: empty response');
    if (!r.ok) throw new Error('AnimeAV1: HTTP ' + r.status + ' for ' + url);
    return r.text();
  }), 15000, null).then(function (v) {
    if (v == null) throw new Error('AnimeAV1: timeout for ' + url);
    return v;
  });
}

function _fetchData(path, query) {
  var url = BASE + '/' + path + '/__data.json';
  if (query) {
    var params = [];
    for (var k in query) {
      if (query[k] != null && query[k] !== '') params.push(encodeURIComponent(k) + '=' + encodeURIComponent(query[k]));
    }
    if (params.length) url += '?' + params.join('&');
  }
  return _fetchText(url, BASE + '/').then(function (body) {
    var page = _parsePageData(body);
    if (!page) throw new Error('AnimeAV1: no page data for ' + path);
    return page;
  });
}

// ── SvelteKit devalue hydration ────────────────────────────────────────────
function _parsePageData(body) {
  var root;
  try { root = JSON.parse(body); } catch (e) { return null; }
  var nodes = root && root.nodes;
  if (!Array.isArray(nodes) || !nodes.length) return null;
  var dataNode = null;
  for (var i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i] && nodes[i].type === 'data') { dataNode = nodes[i]; break; }
  }
  if (!dataNode || !Array.isArray(dataNode.data)) return null;
  return _hydrate(dataNode.data, 0, 0);
}

function _hydrate(flat, index, depth) {
  if (index < 0 || index >= flat.length || depth > 64) return null;
  var value = flat[index];
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      // A typed value such as ["Date", "…"] carries literals, not references.
      if (value.length && typeof value[0] === 'string') return value;
      return value.map(function (ref) {
        if (typeof ref === 'number') return _hydrate(flat, ref, depth + 1);
        return ref;
      });
    }
    var out = {};
    for (var k in value) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
      var ref = value[k];
      out[k] = (typeof ref === 'number') ? _hydrate(flat, ref, depth + 1) : ref;
    }
    return out;
  }
  return value;
}

// ── Parsers ────────────────────────────────────────────────────────────────
function _parseSearchResults(page) {
  var results = (page && page.results) || [];
  return results.map(function (item) {
    if (!item || !item.slug) return null;
    return { slug: String(item.slug), title: String(item.title || '').trim() };
  }).filter(function (h) { return h && h.title; });
}

function _parseMedia(page) {
  var media = page && page.media;
  if (!media) throw new Error('AnimeAV1: page carried no media');
  var episodes = (media.episodes || []).map(function (ep) {
    var n = ep && ep.number;
    if (typeof n !== 'number' || n % 1 !== 0 || n < 1) return null;
    return n;
  }).filter(Boolean);
  // Deduplicate and sort.
  var seen = {}, unique = [];
  episodes.sort(function (a, b) { return a - b; }).forEach(function (n) {
    if (seen[n]) return;
    seen[n] = true;
    unique.push(n);
  });
  var title = '';
  if (media.title) {
    if (typeof media.title === 'string') title = media.title;
    else title = media.title.romaji || media.title.english || media.title.userPreferred || '';
  }
  var cover = '';
  if (media.poster) cover = media.poster;
  else if (media.cover) cover = media.cover;
  else if (media.coverImage) cover = media.coverImage.extraLarge || media.coverImage.large || media.coverImage;
  var description = media.description || media.synopsis || '';
  var genres = Array.isArray(media.genres) ? media.genres.slice() : [];
  var year = media.year || null;
  return {
    malId: media.malId != null ? parseInt(media.malId, 10) : null,
    episodes: unique,
    title: String(title || '').trim(),
    cover: cover || null,
    description: String(description || '').trim(),
    genres: genres,
    year: year
  };
}

function _parseVariants(page) {
  var variants = page && page.episode && page.episode.variants;
  if (!variants || typeof variants !== 'object') return new Set();
  var out = new Set();
  Object.keys(variants).forEach(function (k) {
    var v = variants[k];
    if (typeof v === 'number' ? v > 0 : !!v) out.add(k);
  });
  return out;
}

function _parseEmbeds(page, category) {
  var embeds = page && page.embeds && page.embeds[category];
  if (!Array.isArray(embeds)) return [];
  var seen = {};
  return embeds.map(function (item) {
    if (!item || !item.server || !item.url) return null;
    if (seen[item.url]) return null;
    seen[item.url] = true;
    return { server: String(item.server), url: String(item.url) };
  }).filter(Boolean);
}

// ── VOE decode ─────────────────────────────────────────────────────────────
function _rot13(s) {
  return String(s).replace(/[A-Za-z]/g, function (c) {
    var o = c.charCodeAt(0);
    if (o >= 65 && o <= 90) return String.fromCharCode(((o - 65 + 13) % 26) + 65);
    return String.fromCharCode(((o - 97 + 13) % 26) + 97);
  });
}

function _b64Decode(s) {
  try {
    var clean = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (clean.length % 4) clean += '=';
    return atob(clean);
  } catch (e) { return ''; }
}

function _voeConfig(html) {
  var tag = '<script type="application/json">';
  var open = html.indexOf(tag);
  if (open < 0) return null;
  var start = open + tag.length;
  var end = html.indexOf('</script>', start);
  if (end <= start) return null;
  var encoded;
  try {
    var arr = JSON.parse(html.substring(start, end));
    encoded = arr && arr[0];
  } catch (e) { return null; }
  if (!encoded) return null;
  try {
    var text = _rot13(encoded);
    ['@$', '^^', '~@', '%?', '*~', '!!', '#&'].forEach(function (j) { text = text.split(j).join(''); });
    var shifted = _b64Decode(text).split('').map(function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 3);
    }).join('');
    shifted = shifted.split('').reverse().join('');
    var decoded = _b64Decode(shifted);
    var obj = JSON.parse(decoded);
    return obj && typeof obj === 'object' ? obj : null;
  } catch (e) { return null; }
}

function _voeRedirect(html) {
  var marker = 'window.location.href';
  var pos = 0;
  while (true) {
    var idx = html.indexOf(marker, pos);
    if (idx < 0) return null;
    pos = idx + marker.length;
    var i = pos;
    while (i < html.length && /\s/.test(html.charAt(i))) i++;
    if (html.charAt(i) !== '=' || html.charAt(i + 1) === '=') continue;
    i++;
    while (i < html.length && /\s/.test(html.charAt(i))) i++;
    var quote = html.charAt(i);
    if (quote !== '\'' && quote !== '"') continue;
    var end = html.indexOf(quote, i + 1);
    if (end < 0) return null;
    var url = html.substring(i + 1, end);
    if (url.indexOf('https://') === 0) return url;
  }
}

function _ogVideo(html) {
  var idx = html.indexOf('og:video"');
  if (idx < 0) return null;
  var cidx = html.indexOf('content="', idx);
  if (cidx < 0) return null;
  var start = cidx + 'content="'.length;
  var end = html.indexOf('"', start);
  if (end <= start) return null;
  var url = html.substring(start, end);
  if (url.indexOf('http') === 0 && url.indexOf('/novideo.mp4') === -1) return url;
  return null;
}

function _hostRank(server) {
  var s = String(server || '').trim().toLowerCase();
  if (s === 'voe') return 0;
  if (s === 'yourupload') return 1;
  if (s === 'mp4upload') return 2;
  return 999;
}

// ── Detail ─────────────────────────────────────────────────────────────────
function _normalizeSlug(url) {
  var s = String(url || '').trim();
  if (s.indexOf('animeav1://') === 0) s = s.slice('animeav1://'.length);
  s = s.replace(/^https?:\/\/[^/]+/i, '');
  if (s.indexOf('/media/') === 0) s = s.slice('/media/'.length);
  return s.replace(/^\/+|\/+$/g, '').split('/')[0];
}

function _detailObject(slug, meta) {
  var episodes = meta.episodes.map(function (n) {
    return {
      id: 'animeav1://' + slug + '/' + n,
      number: n,
      title: 'Episode ' + n,
      url: 'animeav1://' + slug + '/' + n,
      type: 'anime',
      sourceId: SOURCE_ID
    };
  });
  return {
    id: slug,
    title: meta.title || slug,
    url: slug,
    malId: meta.malId,
    cover: meta.cover,
    description: meta.description,
    status: 'unknown',
    genres: meta.genres,
    type: 'anime',
    sourceId: SOURCE_ID,
    episodes: episodes,
    year: meta.year,
    subCount: episodes.length,
    dubCount: 0
  };
}

function _loadDetail(slug) {
  if (!slug) return Promise.reject(new Error('AnimeAV1: invalid slug'));
  var cached = _detailCache[slug];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.detail);
  return _fetchData('media/' + encodeURIComponent(slug)).then(function (page) {
    var meta = _parseMedia(page);
    var detail = _detailObject(slug, meta);
    _detailCache[slug] = { at: Date.now(), detail: detail };
    return detail;
  });
}

// ── Public API ─────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q || (page && page > 1)) return Promise.resolve([]);
  return _fetchData('catalogo', { search: q })
    .then(function (data) {
      var out = [], seen = {};
      _parseSearchResults(data).forEach(function (hit) {
        if (seen[hit.slug]) return;
        seen[hit.slug] = true;
        out.push({
          id: hit.slug,
          title: hit.title,
          url: hit.slug,
          cover: null,
          type: 'anime',
          sourceId: SOURCE_ID
        });
      });
      return out;
    })
    .catch(function () { return []; });
}

function getHome(opts) {
  return _fetchData('catalogo').then(function (data) {
    var out = [], seen = {};
    _parseSearchResults(data).forEach(function (hit) {
      if (seen[hit.slug]) return;
      seen[hit.slug] = true;
      out.push({ id: hit.slug, title: hit.title, url: hit.slug, cover: null, type: 'anime', sourceId: SOURCE_ID });
    });
    return out.length ? [{ title: 'AnimeAV1 catalogue', items: out.slice(0, 40) }] : [];
  }).catch(function () { return []; });
}

function getDetail(url, opts) {
  return _loadDetail(_normalizeSlug(url));
}

function getEpisodes(url, opts) {
  return _loadDetail(_normalizeSlug(url)).then(function (d) { return d.episodes; });
}

function _parseEpisodeUrl(episodeUrl) {
  var raw = String(episodeUrl || '');
  if (raw.indexOf('animeav1://') === 0) raw = raw.slice('animeav1://'.length);
  var slash = raw.lastIndexOf('/');
  if (slash < 0) return null;
  var slug = raw.slice(0, slash);
  var number = parseInt(raw.slice(slash + 1), 10);
  if (!slug || !(number >= 1)) return null;
  return { slug: slug, number: number };
}

function _resolveEmbed(embed, dub) {
  var rank = _hostRank(embed.server);
  var audio = dub ? 'Spanish' : null;
  var url = embed.url;
  if (url.indexOf('//') === 0) url = 'https:' + url;
  if (!/^https?:\/\//i.test(url)) url = BASE + '/' + url.replace(/^\/+/, '');

  if (rank === 0) return _resolveVoe(url, dub, audio);
  if (rank === 1) return _resolveYourUpload(url, dub, audio);
  return Promise.resolve([]);
}

function _resolveVoe(url, dub, audio) {
  return _fetchText(url, BASE + '/').then(function (html) {
    var config = _voeConfig(html);
    if (!config) {
      var redirect = _voeRedirect(html);
      if (!redirect) return null;
      return _fetchText(redirect, BASE + '/').then(_voeConfig);
    }
    return config;
  }).then(function (config) {
    var source = config && config.source;
    if (!source || String(source).indexOf('http') !== 0) return [];
    return [{
      url: source,
      quality: 'VOE',
      label: 'VOE' + (audio ? ' · ' + audio : ''),
      container: 'hls',
      headers: { 'User-Agent': UA },
      kind: dub ? 'dub' : 'sub',
      audioLang: dub ? 'es' : 'ja',
      audio: audio,
      subtitles: []
    }];
  }).catch(function () { return []; });
}

function _resolveYourUpload(url, dub, audio) {
  return _fetchText(url, BASE + '/').then(function (html) {
    var file = _ogVideo(html);
    if (!file) return [];
    var referer = 'https://www.yourupload.com/';
    return [{
      url: file,
      quality: 'YourUpload',
      label: 'YourUpload' + (audio ? ' · ' + audio : ''),
      container: 'mp4',
      headers: { 'User-Agent': UA, 'Referer': referer, 'Origin': referer },
      kind: dub ? 'dub' : 'sub',
      audioLang: dub ? 'es' : 'ja',
      audio: audio,
      subtitles: []
    }];
  }).catch(function () { return []; });
}

function getVideoSources(episodeUrl, opts) {
  var parsed = _parseEpisodeUrl(episodeUrl);
  if (!parsed) return Promise.reject(new Error('AnimeAV1: invalid episode URL'));
  var dub = !!(opts && opts.category === 'dub');
  var category = dub ? DUB_CAT : SUB_CAT;
  var audio = dub ? 'Spanish' : null;

  return _fetchData('media/' + encodeURIComponent(parsed.slug) + '/' + parsed.number).then(function (page) {
    var embeds = _parseEmbeds(page, category);
    if (!embeds.length) throw new Error('AnimeAV1 episode ' + parsed.number + ' has no ' + category + ' embeds');
    embeds.sort(function (a, b) { return _hostRank(a.server) - _hostRank(b.server); });
    return embeds.reduce(function (promise, embed) {
      return promise.then(function (streams) {
        if (streams && streams.length) return streams;
        return _resolveEmbed(embed, dub);
      });
    }, Promise.resolve(null)).then(function (streams) {
      if (!streams || !streams.length) {
        throw new Error('AnimeAV1 episode ' + parsed.number +
          ' offered no resolvable host (' + embeds.map(function (e) { return e.server; }).join(', ') + ')');
      }
      return streams;
    });
  });
}

function getStreams(id, opts) { return getVideoSources(id, opts); }
function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    (rows || []).forEach(function (r) { (r.items || []).forEach(function (i) { out.push(i); }); });
    return out;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.0',
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    popular: popular,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams
  };
}