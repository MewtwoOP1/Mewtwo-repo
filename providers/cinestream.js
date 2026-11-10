// cinestream.js — native CineStream port for Zangetsu.
//
// Ported from the GPL-3.0 CineStream CloudStream extension by megix
// (https://github.com/SaurabhKaperwan/CSX/tree/master/CineStream).
// This file is a derivative work distributed under GPL-3.0; see
// LICENSE-CINESTREAM.md and NOTICE-CINESTREAM.md.
//
// Stremio add-on discovery/manifests/registration and the Torrentio,
// TorrentsDB, AnimeTosho-torrent and StremioSubs integrations are
// intentionally NOT ported (user requirement). All native HTTP providers
// and Wyzie Subs are preserved.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'cinestream';
var VERSION = '1.0.9';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
var MOBILE_UA = 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36';
var TMDB = 'https://api.themoviedb.org/3';
var TMDB_IMG = 'https://image.tmdb.org/t/p';
var ANILIST = 'https://graphql.anilist.co';
var ARM = 'https://arm.haglund.dev/api/v2';
var MULTI = 'https://enc-dec.app/api';
var WYZIE = 'https://sub.wyzie.io';
var FETCH_TIMEOUT = 5000;
var META_TIMEOUT = 8000;
var SOURCE_TIMEOUT = 15000;
// Overall budget for getVideoSources in playback mode. Zangetsu gives a
// ~20s playback budget on a single JS bridge; return whatever streams we have
// before it elapses rather than waiting for slow/dead providers.
var SOURCES_BUDGET_MS = 18000;

// ── Caching layer ────────────────────────────────────────────────────────
// TTL cache for metadata/API responses. Stream URLs are NOT cached (they
// expire quickly and are session/signer bound).
var _CACHE = {};
var _CACHE_ORDER = [];
var _CACHE_MAX = 128;
var _CACHE_TTL = {
  tmdb: 300000,   // 5 min
  anilist: 600000, // 10 min
  arm: 600000,    // 10 min
  search: 120000,  // 2 min
  home: 300000,   // 5 min
  default: 300000  // 5 min
};
function _cacheGet(key) {
  var entry = _CACHE[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    delete _CACHE[key];
    return null;
  }
  return entry.data;
}
function _cacheSet(key, data, ttl) {
  if (_CACHE_ORDER.length >= _CACHE_MAX) {
    var old = _CACHE_ORDER.shift();
    delete _CACHE[old];
  }
  _CACHE[key] = { ts: Date.now(), ttl: ttl || _CACHE_TTL.default, data: data };
  _CACHE_ORDER.push(key);
}
// Request deduplication: track in-flight promises by URL to avoid
// duplicate fetches for the same resource.
var _INFLIGHT = {};
function _inflightKey(method, url, body) {
  return method + '|' + url + '|' + (body || '');
}
function _inflightFetch(url, opts) {
  var method = (opts && opts.method) || 'GET';
  var body = opts && opts.body != null ? opts.body : '';
  var k = _inflightKey(method, url, body);
  var p = _INFLIGHT[k];
  if (p) return p;
  p = _fetch(url, opts);
  _INFLIGHT[k] = p;
  p.then(function () { delete _INFLIGHT[k]; }, function () { delete _INFLIGHT[k]; });
  return p;
}

// ── Cached TMDB/AniList/ARM wrappers ────────────────────────────────────
var _tmdbCache = {};
async function _tmdbJsonCached(path, params, ttlKey) {
  var cacheKey = 'tmdb:' + path + ':' + JSON.stringify(params || {});
  var cached = _cacheGet(cacheKey);
  if (cached) return cached;
  var r = await _tmdbJson(path, params);
  if (r) _cacheSet(cacheKey, r, _CACHE_TTL[ttlKey || 'tmdb']);
  return r;
}
async function _aniListSearchCached(title, year) {
  var cacheKey = 'anilist:' + title + ':' + (year || '');
  var cached = _cacheGet(cacheKey);
  if (cached) return cached;
  var r = await _aniListSearch(title, year);
  if (r) _cacheSet(cacheKey, r, _CACHE_TTL.anilist);
  return r;
}
async function _armFromAniListCached(anilistId) {
  var cacheKey = 'arm:' + anilistId;
  var cached = _cacheGet(cacheKey);
  if (cached) return cached;
  var r = await _armFromAniList(anilistId);
  if (r) _cacheSet(cacheKey, r, _CACHE_TTL.arm);
  return r;
}
// ── Cached search/home ─────────────────────────────────────────────────
var _SEARCH_CACHE = {};
var _HOME_CACHE = null;
var _HOME_CACHE_TS = 0;
var _HOME_CACHE_TTL = 300000;
async function _cachedSearch(q) {
  var key = 'search:' + q.toLowerCase();
  var cached = _SEARCH_CACHE[key];
  if (cached && Date.now() - cached.ts < _CACHE_TTL.search) return cached.data;
  // Actual search implementation (TMDB multi search)
  q = _trim(q);
  if (!q) return [];
  var j = await _tmdbJsonCached('/search/multi', { query: q, include_adult: 'false', page: 1 }, 'tmdb');
  var out = [];
  if (j && j.results) {
    for (var i = 0; i < j.results.length; i++) {
      var it = _tmdbItem(j.results[i], j.results[i].media_type);
      if (it) out.push(it);
    }
  }
  var result = _uniqBy(out, function (x) { return x.url; });
  _SEARCH_CACHE[key] = { ts: Date.now(), data: result };
  // Trim cache
  var keys = Object.keys(_SEARCH_CACHE);
  if (keys.length > 50) { delete _SEARCH_CACHE[keys[0]]; }
  return result;
}
async function _cachedHome() {
  if (_HOME_CACHE && Date.now() - _HOME_CACHE_TS < _HOME_CACHE_TTL) return _HOME_CACHE;
  var rows = [];
  var defs = [
    { title: 'Trending Movies', path: '/trending/movie/week', kind: 'movie' },
    { title: 'Trending Series', path: '/trending/tv/week', kind: 'tv' },
    { title: 'Popular Movies', path: '/movie/popular', kind: 'movie' },
    { title: 'Popular Series', path: '/tv/popular', kind: 'tv' },
    { title: 'Popular Anime', path: '/discover/tv', kind: 'tv', params: { with_genres: '16', with_origin_country: 'JP', sort_by: 'popularity.desc' } }
  ];
  var results = await _parallel(defs, 5, async function (d) {
    var j = await _tmdbJsonCached(d.path, d.params, 'tmdb');
    return j && j.results ? j.results : null;
  });
  for (var i = 0; i < defs.length; i++) {
    var list = results[i] || [];
    var items = [];
    for (var k = 0; k < list.length; k++) {
      var it = _tmdbItem(list[k], defs[i].kind);
      if (it) items.push(it);
    }
    if (items.length) rows.push({ title: defs[i].title, items: items });
  }
  _HOME_CACHE = rows;
  _HOME_CACHE_TS = Date.now();
  return rows;
}

// ── Settings ───────────────────────────────────────────────────────────
var PROVIDERS = [
  ['p_showbox', 'Showbox'],
  ['p_vidrock', 'Vidrock'],
  ['p_moviebox', 'Moviebox'],
  ['p_movieblast', 'MovieBlast'],
  ['p_fibwatch', 'Fibwatch'],
  ['p_allmovieland', 'Allmovieland'],
  ['p_hdhub4u', 'Hdhub4u'],
  ['p_hexa', 'Hexa'],
  ['p_fshare', 'Fshare'],
  ['p_videasy', 'Videasy'],
  ['p_vaplayer', 'VaPlayer'],
  ['p_vidzee', 'Vidzee'],
  ['p_peachify', 'Peachify'],
  ['p_vidfastpro', 'VidFastPro'],
  ['p_cinejoy', 'Cinejoy'],
  ['p_vidcore', 'Vidcore'],
  ['p_av1encodes', 'Av1encodes'],
  ['p_castle', 'Castle'],
  ['p_reanime', 'Reanime'],
  ['p_just4anime', 'Just4Anime'],
  ['p_zinkmovies', 'Zinkmovies'],
  ['p_bollywood', 'Gramcinema'],
  ['p_vegamovies', 'VegaMovies'],
  ['p_rogmovies', 'RogMovies'],
  ['p_bollyflix', 'Bollyflix'],
  ['p_topmovies', 'TopMovies'],
  ['p_vidup', 'Vidup'],
  ['p_meowtv', 'Meowtv'],
  ['p_moviesmod', 'Moviesmod'],
  ['p_movies4u', 'Movies4u'],
  ['p_dudefilms', 'Dudefilms'],
  ['p_uhdmovies', 'UHDMovies'],
  ['p_moviesdrive', 'MoviesDrive'],
  ['p_hindmoviez', 'Hindmoviez'],
  ['p_4khdhub', '4KHDHub'],
  ['p_primesrc', 'PrimeSrc'],
  ['p_projectfreetv', 'ProjectFreeTV'],
  ['p_mlsbd', 'Mlsbd'],
  ['p_levidia', 'Levidia'],
  ['p_animesalt', 'Animesalt'],
  ['p_m4ufree', 'M4ufree'],
  ['p_multimovies', 'Multimovies'],
  ['p_akwam', 'Akwam'],
  ['p_rtally', 'Rtally'],
  ['p_asiaflix', 'Asiaflix'],
  ['p_skymovies', 'SkyMovies'],
  ['p_kisskh', 'KissKH'],
  ['p_onetouchtv', 'Onetouchtv'],
  ['p_toonstream', 'Toonstream'],
  ['p_anineko', 'Anineko'],
  ['p_animedao', 'Animedao'],
  ['p_anikoto', 'Anikoto'],
  ['p_anikage', 'Anikage'],
  ['p_anidb', 'Anidb'],
  ['p_animetoshohttp', 'AnimeToshoHttp'],
  ['p_tokyoinsider', 'TokyoInsider'],
  ['p_anizone', 'Anizone'],
  ['p_animekizz', 'Animekizz'],
  ['p_wyziesubs', 'Wyzie Subs']
];
var PROVIDER_NAMES = {};
for (var _pi = 0; _pi < PROVIDERS.length; _pi++) PROVIDER_NAMES[PROVIDERS[_pi][0]] = PROVIDERS[_pi][1];

function _schema(key, label, type, def, options) {
  var out = { key: key, label: label, type: type, default: def };
  if (options) out.options = options;
  return out;
}
function _rs(key) {
  try {
    if (typeof __settings === 'undefined' || !__settings) return null;
    if (__settings[SOURCE_ID] && __settings[SOURCE_ID][key] != null) return __settings[SOURCE_ID][key];
    if (__settings[key] != null) return __settings[key];
  } catch (e) {}
  return null;
}
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _str(key, def) { var v = _rs(key); return v == null ? (def == null ? '' : def) : _trim(v); }
function _bool(key, def) {
  var v = _rs(key);
  if (v == null || v === '') return !!def;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).toLowerCase() === 'true' || String(v) === '1';
}
function _num(key, def) { var v = parseInt(_rs(key), 10); return isFinite(v) && v > 0 ? v : def; }
function _enabledProviders() {
  var saved = _rs('enabledProviders');
  var all = PROVIDERS.map(function (p) { return p[0]; });
  if (!Array.isArray(saved)) return all;
  var picked = {};
  for (var i = 0; i < saved.length; i++) picked[String(saved[i])] = true;
  return all.filter(function (k) { return picked[k]; });
}
function getSettings() {
  var opts = PROVIDERS.map(function (p) { return { value: p[0], label: p[1] }; });
  return [
    _schema('enabledProviders', 'Enabled providers', 'multiEnum', PROVIDERS.map(function (p) { return p[0]; }), opts),
    _schema('showboxToken', 'Showbox / Febbox UI token', 'text', ''),
    _schema('wyzieSubsKey', 'Wyzie Subs API key', 'text', ''),
    _schema('gramcinemaToken', 'GramCinema bearer token', 'text', ''),
    _schema('tmdbApiKey', 'TMDB API key (optional)', 'text', ''),
    _schema('movieblastToken', 'MovieBlast token', 'text', ''),
    _schema('movieblastApi', 'MovieBlast API base', 'text', ''),
    _schema('movieblastKey', 'MovieBlast signing key', 'text', ''),
    _schema('castleKey', 'Castle APK sign key', 'text', ''),
    _schema('concurrency', 'Provider concurrency', 'enum', '10', [
      { value: '4', label: '4' }, { value: '6', label: '6' }, { value: '8', label: '8' },
      { value: '10', label: '10 (default)' }, { value: '14', label: '14' }
    ]),
    _schema('includeDownloadLinks', 'Include download-only links', 'bool', false)
  ];
}
function getInfo() {
  return {
    name: 'CineStream', lang: 'en', baseUrl: 'https://www.themoviedb.org',
    logo: 'https://raw.githubusercontent.com/SaurabhKaperwan/CSX/master/CineStream/icon.png',
    type: 'movie', version: VERSION
  };
}

// ── Small utilities ────────────────────────────────────────────────────
function _slug(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function _titleSlug(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '-'); }
function _cleanTitle(s) {
  return String(s == null ? '' : s).replace(/[^a-zA-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function _yearOf(v) { var m = String(v == null ? '' : v).match(/\d{4}/); return m ? parseInt(m[0], 10) : null; }
function _abs(u, base) {
  u = _trim(u);
  if (!u) return '';
  // Never turn script/pseudo schemes into http URLs (e.g. "javascript:var a=").
  if (/^(javascript|data|mailto|blob|tel|about):/i.test(u)) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (!base) return u;
  var m = String(base).match(/^(https?:\/\/[^\/]+)/i);
  if (!m) return u;
  if (u.charAt(0) === '/') return m[1] + u;
  return m[1] + '/' + u.replace(/^\.?\//, '');
}
function _origin(u) { var m = String(u || '').match(/^(https?:\/\/[^\/]+)/i); return m ? m[1] : ''; }
function _host(u) { var m = String(u || '').match(/^https?:\/\/([^\/:?#]+)/i); return m ? m[1].toLowerCase().replace(/^www\./, '') : ''; }
function _fix(u, domain) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  return domain.replace(/\/+$/, '') + (u.charAt(0) === '/' ? '' : '/') + u;
}
function _attr(html, name) {
  var m = String(html || '').match(new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? (m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4])) : '';
}
function _tagAttr(tag, name) { return _attr(tag, name); }
function _all(re, s, group) {
  var out = [], m;
  var r = new RegExp(re.source, re.flags.indexOf('g') >= 0 ? re.flags : re.flags + 'g');
  while ((m = r.exec(String(s || ''))) !== null) {
    out.push(group == null ? m[0] : (m[group] || ''));
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}
function _first(re, s, group) { var m = String(s || '').match(re); return m ? (group == null ? m[0] : (m[group] || '')) : ''; }
function _text(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); })
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ').trim();
}
function _jsonAttr(html, name) {
  var m = String(html || '').match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'));
  return m ? m[1] : '';
}
function _parseJson(s) { try { return JSON.parse(String(s || '')); } catch (e) { return null; } }
function _decodeEntities(s) { return _text(s); }
function _chunks(list, size) {
  var out = [];
  for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
function _uniqBy(list, keyFn) {
  var seen = {}, out = [];
  for (var i = 0; i < list.length; i++) {
    var k = keyFn(list[i]);
    if (k && !seen[k]) { seen[k] = true; out.push(list[i]); }
  }
  return out;
}
function _quality(str) {
  var s = String(str == null ? '' : str);
  var m = s.match(/(\d{3,4})[pP]/);
  if (m) return parseInt(m[1], 10);
  var l = s.toLowerCase();
  if (l.indexOf('8k') >= 0) return 4320;
  if (l.indexOf('4k') >= 0 || l.indexOf('2160') >= 0) return 2160;
  if (l.indexOf('1440') >= 0 || l.indexOf('2k') >= 0) return 1440;
  if (l.indexOf('1080') >= 0) return 1080;
  if (l.indexOf('720') >= 0) return 720;
  if (l.indexOf('480') >= 0) return 480;
  if (l.indexOf('360') >= 0) return 360;
  return 0;
}
function _qualityLabel(q) {
  var n = parseInt(q, 10);
  if (!isFinite(n) || n <= 0) return 'Auto';
  return n >= 2160 ? '4K' : n + 'p';
}
function _formatSize(bytes) {
  var b = Number(bytes);
  if (!isFinite(b) || b <= 0) return '';
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
  return (b / 1024).toFixed(0) + ' KB';
}
function _packSize(s) {
  var m = String(s || '').match(/(\d+(?:\.\d+)?\s?(?:MB|GB|TB))/i);
  return m ? m[1].toUpperCase() : '';
}
function _simplify(title) {
  var s = String(title || '');
  var tags = [];
  function grab(re, label) { if (re.test(s)) { tags.push(label); s = s.replace(re, ' '); } }
  grab(/UHD\s*BluRay/i, '4K UHD BluRay'); grab(/BluRay\s*REMUX/i, 'BluRay REMUX');
  grab(/BluRay/i, 'BluRay'); grab(/BDRip/i, 'BDRip'); grab(/BRRip/i, 'BRRip');
  grab(/WEB[- ]?DL/i, 'WEB-DL'); grab(/WEBRip/i, 'WEBRip'); grab(/HDRip/i, 'HDRip');
  grab(/HDTV/i, 'HDTV'); grab(/DVDRip/i, 'DVDRip'); grab(/DVD/i, 'DVD');
  grab(/CAM/i, 'CAM'); grab(/TeleSync/i, 'TeleSync'); grab(/HDR/i, 'HDR');
  grab(/x265|h\.?265|HEVC/i, 'HEVC'); grab(/x264|h\.?264|AVC/i, 'H.264');
  grab(/AV1/i, 'AV1'); grab(/Dual\s*Audio/i, 'Dual Audio');
  grab(/Multi\s*Audio/i, 'Multi Audio'); grab(/Multi\s*Sub/i, 'Multi Subs');
  var size = _packSize(String(title || ''));
  if (size) tags.push(size + ' 💾');
  return tags.length ? '\n' + tags.join(' | ') : '';
}
function _langName(code) {
  var map = {
    en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada',
    bn: 'Bengali', mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu',
    ar: 'Arabic', tr: 'Turkish', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', ru: 'Russian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
    th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', tl: 'Filipino',
    nl: 'Dutch', pl: 'Polish', sv: 'Swedish', da: 'Danish', no: 'Norwegian',
    fi: 'Finnish', el: 'Greek', he: 'Hebrew', fa: 'Persian', uk: 'Ukrainian',
    cs: 'Czech', hu: 'Hungarian', ro: 'Romanian', sk: 'Slovak', bg: 'Bulgarian',
    hr: 'Croatian', sr: 'Serbian', sl: 'Slovenian', et: 'Estonian', lv: 'Latvian',
    lt: 'Lithuanian', 'pt-br': 'Portuguese (BR)', 'zh-hans': 'Chinese (Simplified)',
    'zh-hant': 'Chinese (Traditional)'
  };
  var k = String(code || '').toLowerCase().replace(/_/g, '-');
  if (map[k]) return map[k];
  var base = k.split('-')[0];
  return map[base] || String(code || 'Unknown');
}
function _sub(url, lang, label, isDefault) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  var l = _langName(lang || label || 'Unknown');
  return { url: url, lang: l, label: label || l, format: /\.vtt(\?|$)/i.test(url) ? 'vtt' : 'srt', 'default': !!isDefault };
}
function _stream(url, quality, label, container, headers, kind, audioLang, subtitles) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  var q = parseInt(quality, 10);
  return {
    url: url,
    quality: isFinite(q) && q > 0 ? _qualityLabel(q) : 'Auto',
    label: label || 'CineStream',
    container: container || (/\.m3u8(\?|$)/i.test(url) ? 'hls' : (/\.(mp4|mkv|webm)(\?|$)/i.test(url) ? 'mp4' : 'unknown')),
    headers: headers || {},
    kind: kind || 'unknown',
    audioLang: audioLang || null,
    subtitles: subtitles || []
  };
}

// ── Base64 / UTF-8 ─────────────────────────────────────────────────────
var _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _utf8Bytes(str) {
  var out = [], s = String(str);
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var c2 = s.charCodeAt(++i);
      var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function _bytesUtf8(bytes) {
  var s = '', i = 0;
  while (i < bytes.length) {
    var b = bytes[i++];
    if (b < 0x80) s += String.fromCharCode(b);
    else if (b < 0xe0) s += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
    else if (b < 0xf0) s += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    else {
      var cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      cp -= 0x10000;
      s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
    }
  }
  return s;
}
function _b64Bytes(bytes) {
  var out = '', i = 0;
  while (i < bytes.length) {
    var c1 = bytes[i++] & 255, c2 = i < bytes.length ? bytes[i++] & 255 : NaN, c3 = i < bytes.length ? bytes[i++] & 255 : NaN;
    out += _B64.charAt(c1 >> 2) + _B64.charAt(((c1 & 3) << 4) | (c2 >> 4)) +
      (isNaN(c2) ? '=' : _B64.charAt(((c2 & 15) << 2) | (c3 >> 6))) +
      (isNaN(c3) ? '=' : _B64.charAt(c3 & 63));
  }
  return out;
}
function _bytesB64(s) {
  // Keep padding: stripping "=" made the final group incomplete, and
  // charAt() past the end returned "" whose indexOf("") is 0, appending a
  // stray NUL byte to every padded decode (corrupting URLs).
  s = String(s || '').replace(/[^A-Za-z0-9+/=]/g, '');
  var out = [];
  for (var i = 0; i < s.length; i += 4) {
    var c1 = s.charAt(i), c2 = s.charAt(i + 1), c3 = s.charAt(i + 2), c4 = s.charAt(i + 3);
    var e1 = _B64.indexOf(c1), e2 = _B64.indexOf(c2);
    if (e1 < 0 || e2 < 0) break;
    out.push((e1 << 2) | (e2 >> 4));
    var e3 = c3 ? _B64.indexOf(c3) : -1;
    if (e3 >= 0) out.push(((e2 & 15) << 4) | (e3 >> 2));
    var e4 = c4 ? _B64.indexOf(c4) : -1;
    if (e4 >= 0) out.push(((e3 & 3) << 6) | e4);
  }
  return out;
}
function _b64e(s) { return _b64Bytes(_utf8Bytes(String(s))); }
function _b64d(s) { return _bytesUtf8(_bytesB64(s)); }
function _b64urlEncode(s) { return _b64e(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function _b64urlDecode(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  try { return _b64d(s); } catch (e) { return ''; }
}
function _hexBytes(hex) {
  var out = [], h = String(hex || '');
  for (var i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.substr(i, 2), 16));
  return out;
}
function _bytesHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) { var x = (bytes[i] & 255).toString(16); s += x.length === 1 ? '0' + x : x; }
  return s;
}

// ── SHA-256 / HMAC-SHA256 (sync, for signing) ──────────────────────────
var _K256 = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
function _rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
function _sha256Bytes(bytes) {
  var h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var l = bytes.length, b = bytes.slice(0);
  b.push(0x80);
  while (b.length % 64 !== 56) b.push(0);
  var hi = Math.floor(l * 8 / 0x100000000), lo = (l * 8) >>> 0;
  b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
  b.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
  for (var off = 0; off < b.length; off += 64) {
    var w = new Array(64);
    for (var i = 0; i < 16; i++) w[i] = ((b[off + 4 * i] << 24) | (b[off + 4 * i + 1] << 16) | (b[off + 4 * i + 2] << 8) | b[off + 4 * i + 3]) >>> 0;
    for (var i2 = 16; i2 < 64; i2++) {
      var s0 = (_rotr(w[i2 - 15], 7) ^ _rotr(w[i2 - 15], 18) ^ (w[i2 - 15] >>> 3)) >>> 0;
      var s1 = (_rotr(w[i2 - 2], 17) ^ _rotr(w[i2 - 2], 19) ^ (w[i2 - 2] >>> 10)) >>> 0;
      w[i2] = (w[i2 - 16] + s0 + w[i2 - 7] + s1) >>> 0;
    }
    var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (var i3 = 0; i3 < 64; i3++) {
      var S1 = (_rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25)) >>> 0;
      var ch = ((e & f) ^ (~e & g)) >>> 0;
      var t1 = (hh + S1 + ch + _K256[i3] + w[i3]) >>> 0;
      var S0 = (_rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22)) >>> 0;
      var maj = ((a & bb) ^ (a & c) ^ (bb & c)) >>> 0;
      var t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + bb) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  var out = [];
  for (var i4 = 0; i4 < 8; i4++) out.push((h[i4] >>> 24) & 255, (h[i4] >>> 16) & 255, (h[i4] >>> 8) & 255, h[i4] & 255);
  return out;
}
function _sha256Hex(s) { return _bytesHex(_sha256Bytes(_utf8Bytes(String(s)))); }
function _hmacSha256Hex(key, msg) {
  var k = _utf8Bytes(String(key));
  if (k.length > 64) k = _sha256Bytes(k);
  while (k.length < 64) k.push(0);
  var ip = [], op = [];
  for (var i = 0; i < 64; i++) { ip.push(k[i] ^ 0x36); op.push(k[i] ^ 0x5c); }
  return _bytesHex(_sha256Bytes(op.concat(_sha256Bytes(ip.concat(_utf8Bytes(String(msg)))))));
}

// ── AES (CBC + GCM decrypt) ────────────────────────────────────────────
var _AES_SBOX = null, _AES_INV = null, _AES_RCON = null;
function _aesInit() {
  if (_AES_SBOX) return;
  _AES_SBOX = new Array(256); _AES_INV = new Array(256); _AES_RCON = new Array(11);
  var exp = new Array(256), log = new Array(256), x = 1;
  for (var j = 0; j < 255; j++) { exp[j] = x; log[x] = j; x ^= (x << 1) ^ ((x & 0x80) ? 0x11b : 0); x &= 0xff; }
  function inv(a) { return a === 0 ? 0 : exp[(255 - log[a]) % 255]; }
  function rotl8(a, n) { return ((a << n) | (a >>> (8 - n))) & 0xff; }
  for (var k = 0; k < 256; k++) {
    var iv = inv(k);
    var s = inv ^ rotl8(iv, 1) ^ rotl8(iv, 2) ^ rotl8(iv, 3) ^ rotl8(iv, 4) ^ 0x63;
    _AES_SBOX[k] = s & 0xff; _AES_INV[s & 0xff] = k;
  }
  var r = 1;
  for (var ri = 0; ri < 10; ri++) { _AES_RCON[ri] = r; r = ((r << 1) ^ ((r & 0x80) ? 0x1b : 0)) & 0xff; }
}
function _aesExpand(key) {
  _aesInit();
  var nk = key.length / 4, nr = nk + 6, w = [];
  for (var i = 0; i < nk; i++) w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  for (var i2 = nk; i2 < 4 * (nr + 1); i2++) {
    var t = w[i2 - 1];
    if (i2 % nk === 0) {
      t = ((_AES_SBOX[(t >>> 16) & 0xff] << 24) | (_AES_SBOX[(t >>> 8) & 0xff] << 16) | (_AES_SBOX[t & 0xff] << 8) | _AES_SBOX[(t >>> 24) & 0xff]) ^ ((_AES_RCON[i2 / nk - 1] || 0) << 24);
    } else if (nk > 6 && i2 % nk === 4) {
      t = (_AES_SBOX[(t >>> 24) & 0xff] << 24) | (_AES_SBOX[(t >>> 16) & 0xff] << 16) | (_AES_SBOX[(t >>> 8) & 0xff] << 8) | _AES_SBOX[t & 0xff];
    }
    w[i2] = (w[i2 - nk] ^ t) >>> 0;
  }
  return { w: w, nr: nr };
}
function _xtime(a) { return ((a << 1) ^ ((a & 0x80) ? 0x1b : 0)) & 0xff; }
function _gmul(a, b) { var r = 0; while (b) { if (b & 1) r ^= a; a = _xtime(a); b >>>= 1; } return r & 0xff; }
function _aesEncBlock(block, ks) {
  var w = ks.w, nr = ks.nr, s = block.slice(0);
  function rk(r) { for (var c = 0; c < 4; c++) { var v = w[r * 4 + c]; s[4 * c] ^= (v >>> 24) & 0xff; s[4 * c + 1] ^= (v >>> 16) & 0xff; s[4 * c + 2] ^= (v >>> 8) & 0xff; s[4 * c + 3] ^= v & 0xff; } }
  rk(0);
  for (var round = 1; round <= nr; round++) {
    for (var i = 0; i < 16; i++) s[i] = _AES_SBOX[s[i]];
    var t = s.slice(0);
    for (var c1 = 0; c1 < 4; c1++) for (var r1 = 0; r1 < 4; r1++) s[4 * c1 + r1] = t[4 * ((c1 + r1) % 4) + r1];
    if (round !== nr) {
      for (var c2 = 0; c2 < 4; c2++) {
        var a0 = s[4 * c2], a1 = s[4 * c2 + 1], a2 = s[4 * c2 + 2], a3 = s[4 * c2 + 3];
        s[4 * c2] = _gmul(a0, 2) ^ _gmul(a1, 3) ^ a2 ^ a3;
        s[4 * c2 + 1] = a0 ^ _gmul(a1, 2) ^ _gmul(a2, 3) ^ a3;
        s[4 * c2 + 2] = a0 ^ a1 ^ _gmul(a2, 2) ^ _gmul(a3, 3);
        s[4 * c2 + 3] = _gmul(a0, 3) ^ a1 ^ a2 ^ _gmul(a3, 2);
      }
    }
    rk(round);
  }
  return s;
}
function _aesDecBlock(block, ks) {
  _aesInit();
  var w = ks.w, nr = ks.nr, s = block.slice(0);
  function rk(r) { for (var c = 0; c < 4; c++) { var v = w[r * 4 + c]; s[4 * c] ^= (v >>> 24) & 0xff; s[4 * c + 1] ^= (v >>> 16) & 0xff; s[4 * c + 2] ^= (v >>> 8) & 0xff; s[4 * c + 3] ^= v & 0xff; } }
  rk(nr);
  for (var round = nr - 1; round >= 1; round--) {
    var t = s.slice(0);
    for (var c1 = 0; c1 < 4; c1++) for (var r1 = 0; r1 < 4; r1++) s[4 * ((c1 + r1) % 4) + r1] = t[4 * c1 + r1];
    for (var i = 0; i < 16; i++) s[i] = _AES_INV[s[i]];
    rk(round);
    for (var c2 = 0; c2 < 4; c2++) {
      var a0 = s[4 * c2], a1 = s[4 * c2 + 1], a2 = s[4 * c2 + 2], a3 = s[4 * c2 + 3];
      s[4 * c2] = _gmul(a0, 14) ^ _gmul(a1, 11) ^ _gmul(a2, 13) ^ _gmul(a3, 9);
      s[4 * c2 + 1] = _gmul(a0, 9) ^ _gmul(a1, 14) ^ _gmul(a2, 11) ^ _gmul(a3, 13);
      s[4 * c2 + 2] = _gmul(a0, 13) ^ _gmul(a1, 9) ^ _gmul(a2, 14) ^ _gmul(a3, 11);
      s[4 * c2 + 3] = _gmul(a0, 11) ^ _gmul(a1, 13) ^ _gmul(a2, 9) ^ _gmul(a3, 14);
    }
  }
  var t2 = s.slice(0);
  for (var c3 = 0; c3 < 4; c3++) for (var r2 = 0; r2 < 4; r2++) s[4 * ((c3 + r2) % 4) + r2] = t2[4 * c3 + r2];
  for (var i2 = 0; i2 < 16; i2++) s[i2] = _AES_INV[s[i2]];
  rk(0);
  return s;
}
function _aesCbcDecrypt(key, iv, data) {
  var ks = _aesExpand(key), out = [], prev = iv.slice(0);
  for (var off = 0; off < data.length; off += 16) {
    var block = data.slice(off, off + 16), dec = _aesDecBlock(block, ks);
    for (var i = 0; i < 16; i++) out.push(dec[i] ^ prev[i]);
    prev = block;
  }
  if (out.length) { var pad = out[out.length - 1]; if (pad > 0 && pad <= 16) out = out.slice(0, out.length - pad); }
  return out;
}
function _aesGcmDecrypt(key, iv, data, aad) {
  var ks = _aesExpand(key);
  var H = _aesEncBlock([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0], ks);
  var X = new Array(16).fill(0);
  function gmul(A, B) {
    var Z = new Array(16).fill(0), V = B.slice(0);
    for (var i = 0; i < 128; i++) {
      if ((A[(i / 8) | 0] >>> (7 - (i % 8))) & 1) for (var j = 0; j < 16; j++) Z[j] ^= V[j];
      var lsb = V[15] & 1;
      for (var k = 15; k > 0; k--) V[k] = ((V[k] >>> 1) | ((V[k - 1] & 1) << 7)) & 0xff;
      V[0] = (V[0] >>> 1) & 0xff;
      if (lsb) V[0] ^= 0xe1;
    }
    return Z;
  }
  function ghash(bytes) {
    for (var off = 0; off < bytes.length; off += 16) {
      var blk = bytes.slice(off, off + 16);
      while (blk.length < 16) blk.push(0);
      for (var i = 0; i < 16; i++) X[i] ^= blk[i];
      X = gmul(X, H);
    }
  }
  var ad = aad || [];
  ghash(ad);
  var ct = data.slice(0, data.length - 16);
  ghash(ct);
  var lenBlock = new Array(16).fill(0);
  var aBits = ad.length * 8, cBits = ct.length * 8;
  for (var lb = 0; lb < 4; lb++) { lenBlock[11 - lb] = (aBits >>> (8 * lb)) & 0xff; lenBlock[15 - lb] = (cBits >>> (8 * lb)) & 0xff; }
  for (var i3 = 0; i3 < 16; i3++) X[i3] ^= lenBlock[i3];
  X = gmul(X, H);
  var j0 = iv.concat(new Array(16 - iv.length).fill(0)); j0[15] = 1;
  var tag = _aesEncBlock(j0, ks);
  for (var i4 = 0; i4 < 16; i4++) tag[i4] ^= X[i4];
  var expect = data.slice(data.length - 16);
  for (var i5 = 0; i5 < 16; i5++) if (tag[i5] !== expect[i5]) throw new Error('AES-GCM authentication failed');
  var counter = iv.concat([0, 0, 0, 2]), out = [];
  for (var off2 = 0; off2 < ct.length; off2 += 16) {
    var kb = _aesEncBlock(counter, ks), chunk = ct.slice(off2, off2 + 16);
    for (var j2 = 0; j2 < chunk.length; j2++) out.push(chunk[j2] ^ kb[j2]);
    for (var c4 = 15; c4 >= 0; c4--) { counter[c4] = (counter[c4] + 1) & 0xff; if (counter[c4] !== 0) break; }
  }
  return out;
}
function _decryptVidzee(encrypted, secret) {
  try {
    var decoded = _b64d(encrypted);
    var parts = decoded.split(/:(.+)/);
    if (parts.length < 2) return null;
    var iv = _bytesB64(parts[0]), ct = _bytesB64(parts[1]);
    var key = _utf8Bytes(String(secret).padEnd ? String(secret).padEnd(32, '\u0000') : (String(secret) + new Array(33).join('\u0000')).slice(0, 32));
    return _bytesUtf8(_aesCbcDecrypt(key, iv, ct));
  } catch (e) { return null; }
}
function _decryptVidrock(payload) {
  try {
    var key = _hexBytes('7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f');
    var s = String(payload).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var data = _bytesB64(s);
    return _bytesUtf8(_aesGcmDecrypt(key, data.slice(0, 12), data.slice(12), []));
  } catch (e) { return null; }
}
function _decryptPeachify(encrypt) {
  try {
    var parts = String(encrypt).split('.');
    if (parts.length < 3) return null;
    function ub(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return _bytesB64(s); }
    var iv = ub(parts[0]), data = ub(parts[1]).concat(ub(parts[2]));
    var key = _hexBytes('a8f2a1b5e9c470814f6b2c3a5d8e7f9c1a2b3c4d5e3f7a8b8cad1e2d0a4d5c5d');
    return _bytesUtf8(_aesGcmDecrypt(key, iv, data, []));
  } catch (e) { return null; }
}

// ── HTTP layer ─────────────────────────────────────────────────────────
var _COOKIE_JAR = {};
function _lowerHeaders(raw) {
  var out = {};
  if (!raw) return out;
  for (var k in raw) if (Object.prototype.hasOwnProperty.call(raw, k)) out[String(k).toLowerCase()] = raw[k];
  return out;
}
function _hget(h, name) {
  if (!h) return '';
  var l = String(name).toLowerCase();
  for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k) && String(k).toLowerCase() === l) return h[k] == null ? '' : String(h[k]);
  return '';
}
function _cookieHeader(url) {
  var jar = _COOKIE_JAR[_host(url)];
  if (!jar) return '';
  var parts = [];
  for (var k in jar) if (Object.prototype.hasOwnProperty.call(jar, k)) parts.push(k + '=' + jar[k]);
  return parts.join('; ');
}
function _storeCookies(url, headers) {
  var sc = _hget(headers, 'set-cookie');
  if (!sc) return;
  var host = _host(url);
  if (!host) return;
  var jar = _COOKIE_JAR[host] || (_COOKIE_JAR[host] = {});
  var parts = String(sc).split(/,(?=\s*[^;,\s=]+=)/);
  for (var i = 0; i < parts.length; i++) {
    var first = parts[i].split(';')[0];
    var m = first.match(/^\s*([^=\s]+)=([^;]*)/);
    if (!m) continue;
    var name = m[1], value = m[2];
    if (/^(expires|path|domain|max-age|samesite|secure|httponly)$/i.test(name)) continue;
    jar[name] = value;
  }
}
function _race(p, ms, fallback) {
  return Promise.race([
    p,
    new Promise(function (res) { if (typeof setTimeout === 'function') setTimeout(function () { res(fallback); }, ms || 1); else res(fallback); })
  ]);
}
async function _fetch(url, opts) {
  opts = opts || {};
  url = String(url || '');
  if (!/^https?:\/\//i.test(url)) return { ok: false, status: 0, headers: {}, body: '', url: url, error: 'bad-url' };
  var headers = Object.assign({ 'User-Agent': UA, 'Accept': '*/*' }, opts.headers || {});
  var jar = _cookieHeader(url);
  if (jar && !_hget(headers, 'cookie')) headers.Cookie = jar;
  var init = { method: opts.method || 'GET', headers: headers };
  if (opts.body != null) init.body = opts.body;
  if (opts.followRedirects === false) init.followRedirects = false;
  if (opts.timeoutMs) init.timeoutMs = opts.timeoutMs;
  var res = null;
  try {
    res = await _race(fetch(url, init), opts.timeoutMs || FETCH_TIMEOUT, null);
  } catch (e) {
    return { ok: false, status: 0, headers: {}, body: '', url: url, error: String(e && e.message || e) };
  }
  if (!res) return { ok: false, status: 0, headers: {}, body: '', url: url, error: 'timeout' };
  var h = _lowerHeaders(res.headers);
  _storeCookies(url, h);
  var body = '';
  var rawBytes = null;
  if (opts.binary && typeof res.arrayBuffer === 'function') {
    try {
      var ab = await _race(res.arrayBuffer(), 5000, null);
      if (ab) rawBytes = Array.from(new Uint8Array(ab));
    } catch (e) { rawBytes = null; }
  }
  try {
    if (typeof res.text === 'function') body = await _race(res.text(), 5000, '');
    else body = res.body == null ? '' : String(res.body);
  } catch (e) { body = ''; }
  return { ok: res.ok !== false, status: res.status || 0, headers: h, body: body == null ? '' : String(body), bytes: rawBytes, url: res.url || url };
}
async function _get(url, opts) { var r = await _fetch(url, opts); return r.body; }
async function _getJson(url, opts) { return _parseJson(await _get(url, opts)); }
async function _post(url, opts) {
  // NOTE: this used to call _fetch(url, opts) without method:'POST', so every
  // "POST" in the port silently became a GET. enc-dec.app's stage1 server and
  // the vidfast/vidcore/vidup stream endpoints answer GET with 404
  // "Cannot GET ...", which is exactly what the device log showed. Keep the
  // method explicit here and let callers pass an optional body.
  opts = Object.assign({}, opts || {});
  opts.method = 'POST';
  if (opts.body == null) opts.body = '';
  return _fetch(url, opts);
}
function _formBody(obj) {
  var parts = [];
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(obj[k])));
  return parts.join('&');
}
async function _postForm(url, obj, opts) {
  opts = opts || {};
  var headers = Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, opts.headers || {});
  return _fetch(url, { method: 'POST', headers: headers, body: _formBody(obj), followRedirects: opts.followRedirects, timeoutMs: opts.timeoutMs });
}
async function _postJson(url, obj, opts) {
  opts = opts || {};
  var headers = Object.assign({ 'Content-Type': 'application/json', 'Accept': 'application/json' }, opts.headers || {});
  return _fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(obj), followRedirects: opts.followRedirects, timeoutMs: opts.timeoutMs });
}
async function _parallel(items, limit, fn) {
  var out = new Array(items.length), next = 0;
  var workers = [];
  var n = Math.max(1, Math.min(limit || 4, items.length || 1));
  for (var w = 0; w < n; w++) {
    workers.push((async function () {
      while (true) {
        var i = next++;
        if (i >= items.length) return;
        try { out[i] = await fn(items[i], i); } catch (e) { out[i] = null; }
      }
    })());
  }
  await Promise.all(workers);
  return out;
}

// ── Dynamic provider hosts (public upstream config) ────────────────────
var _DYN_DEFAULT = {
  '4khdhub': 'https://4khdhub.one', 'bollyflix': 'https://bollyflix.church',
  'rtally': 'https://rtally.lol', 'hindmoviez': 'https://hindmovie.dad',
  'moviesdrive': 'https://new1.moviesdrive.cyou', 'movies4u': 'https://www.google.com',
  'multimovies': 'https://m1.multimovies.courses', 'skymovies': 'https://new4.skymovieshd.clinic',
  'uhdmovies': 'https://uhdmovies.beauty', 'moviesmod': 'https://moviesmod.tw',
  'topmovies': 'https://moviesleech.club', 'vegamovies': 'https://1vegamovies.shop',
  'rogmovies': 'https://rogmovies.asia', 'gdflix': 'https://new9.gdflix.io',
  'hubcloud': 'https://hubcloud.pw', 'toonstream': 'https://toonstream.us',
  'zinkmovies': 'https://new6.zinkmovies.mobi', 'vcloud': 'https://vcloud.fit',
  'dudefilms': 'https://new1.dudefilms.church', 'm4ufree': 'https://ww5.m4ufree.lat',
  'animedao': 'https://anidao.to', 'mlsbd': 'https://mlsbd.co',
  'fibwatch': 'https://fibwatch.art', 'hdhub4u': 'https://new12.hdhub4u.cl'
};
var _DYN = null;
async function _dynamic() {
  if (_DYN) return _DYN;
  var merged = Object.assign({}, _DYN_DEFAULT);
  try {
    var j = await _getJson('https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json', { timeoutMs: 4000 });
    if (j && typeof j === 'object') for (var k in j) if (typeof j[k] === 'string' && /^https?:\/\//i.test(j[k])) merged[k] = j[k].replace(/\/+$/, '');
  } catch (e) {}
  _DYN = merged;
  return merged;
}
async function _dyn(key) { var d = await _dynamic(); return d[key] || ''; }

// ── TMDB metadata ──────────────────────────────────────────────────────
function _tmdbKey() { return _str('tmdbApiKey', ''); }
function _tmdbUrl(path, params) {
  var key = _tmdbKey();
  var base = key ? 'https://api.themoviedb.org./3' : TMDB;
  var qs = [];
  if (params) for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null) qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k])));
  if (key) qs.push('api_key=' + encodeURIComponent(key));
  return base + path + (qs.length ? (path.indexOf('?') >= 0 ? '&' : '?') + qs.join('&') : '');
}
async function _tmdbJson(path, params) {
  var headers = { Accept: 'application/json' };
  if (_tmdbKey()) headers.Host = 'api.themoviedb.org';
  var url = _tmdbUrl(path, params);
  var r = await _inflightFetch(url, { headers: headers, timeoutMs: META_TIMEOUT });
  if (!r.ok && !r.body) return null;
  var j = _parseJson(r.body);
  if (j && j.status_code) return null;
  return j;
}
function _img(path, size) { return path ? TMDB_IMG + '/' + (size || 'w500') + path : null; }
function _fmtYear(v) { var y = _yearOf(v); return y || null; }
function _animeFrom(genres, countries, lang) {
  var g = (genres || []).map(function (x) { return String(x).toLowerCase(); });
  var c = (countries || []).map(function (x) { return String(x).toUpperCase(); });
  var animation = g.indexOf('animation') >= 0 || g.indexOf('anime') >= 0;
  var asia = c.indexOf('JP') >= 0 || c.indexOf('CN') >= 0 || c.indexOf('KR') >= 0 || c.indexOf('TW') >= 0;
  var langAsia = /^(ja|zh|ko)$/i.test(String(lang || ''));
  return animation && (asia || langAsia);
}
function _isBollywood(countries) {
  return (countries || []).some(function (x) { return /^(IN|PK)$/i.test(String(x)); });
}
function _isAsian(countries) {
  return (countries || []).some(function (x) { return /^(KR|CN|TW|TH|JP|HK|PH|VN|ID|MY)$/i.test(String(x)); });
}
function _tmdbItem(rec, kind) {
  if (!rec || !rec.id) return null;
  var tv = kind === 'tv' || rec.media_type === 'tv' || rec.first_air_date != null;
  if (rec.media_type && rec.media_type !== 'movie' && rec.media_type !== 'tv') return null;
  var title = rec.title || rec.name || rec.original_title || rec.original_name || '';
  if (!title) return null;
  var genres = (rec.genre_ids || []).slice(0);
  var anime = genres.indexOf(16) >= 0 && /^(ja|zh|ko)$/i.test(String(rec.original_language || ''));
  var u = 'tmdb://' + (tv ? 'tv' : 'movie') + '/' + rec.id;
  return { id: u, url: u, title: title, cover: _img(rec.poster_path, 'w500'), type: anime ? 'anime' : 'movie', sourceId: SOURCE_ID };
}
async function getHome() {
  return _cachedHome();
}
async function popular() {
  var rows = await getHome(), out = [];
  for (var i = 0; i < rows.length; i++) for (var j = 0; j < rows[i].items.length; j++) out.push(rows[i].items[j]);
  return out;
}
async function search(q) {
  q = _trim(q);
  if (!q) return [];
  return _cachedSearch(q);
}
async function _aniListSearch(title, year) {
  if (!title) return null;
  var query = 'query($q:String,$y:Int){Media(search:$q,type:ANIME,seasonYear:$y){id idMal title{english romaji}}}';
  var vars = { q: title, y: year || null };
  if (!year) { query = 'query($q:String){Media(search:$q,type:ANIME){id idMal title{english romaji}}}'; vars = { q: title }; }
  var r = await _postJson(ANILIST, { query: query, variables: vars }, { timeoutMs: META_TIMEOUT });
  var j = _parseJson(r.body);
  if (!j || !j.data || !j.data.Media) return null;
  return { anilistId: j.data.Media.id || null, malId: j.data.Media.idMal || null };
}
async function _armFromAniList(anilistId) {
  if (!anilistId) return null;
  var j = await _getJson(ARM + '/ids?source=anilist&id=' + encodeURIComponent(anilistId), { timeoutMs: META_TIMEOUT });
  return j && !j.message ? j : null;
}
// AniList rate-limits by IP and can answer 404/empty for a while. Fall back to
// ani.zip mappings (keyed by TMDB/IMDb) so anime providers still get their ids.
async function _aniZipIds(tmdbId, imdbId) {
  var key = 'anizip:' + (tmdbId || '') + ':' + (imdbId || '');
  var cached = _cacheGet(key);
  if (cached) return cached;
  var urls = [];
  if (tmdbId) urls.push(API.anizip + '/mappings?themoviedb_id=' + encodeURIComponent(tmdbId));
  if (imdbId) urls.push(API.anizip + '/mappings?imdb_id=' + encodeURIComponent(imdbId));
  var out = null;
  for (var i = 0; i < urls.length && !out; i++) {
    var j = await _getJson(urls[i], { timeoutMs: META_TIMEOUT });
    var m = j && j.mappings;
    if (m && (m.anilist_id || m.mal_id)) {
      out = {
        anilistId: m.anilist_id || null,
        malId: m.mal_id || null,
        kitsuId: m.kitsu_id ? String(m.kitsu_id) : null,
        imdbId: m.imdb_id || null,
        tmdbId: m.themoviedb_id || null
      };
    }
  }
  if (out) _cacheSet(key, out, _CACHE_TTL.arm);
  return out;
}
async function _animeIdsCached(title, year, tmdbId, imdbId) {
  var out = { anilistId: null, malId: null, kitsuId: null, imdbId: null, tmdbId: null };
  var al = await _aniListSearchCached(title, year);
  if (al && al.anilistId) {
    out.anilistId = al.anilistId;
    out.malId = al.malId;
    var arm = await _armFromAniListCached(al.anilistId);
    if (arm) {
      out.kitsuId = arm.kitsu ? String(arm.kitsu) : null;
      out.imdbId = arm.imdb || null;
      out.tmdbId = arm.themoviedb || null;
    }
  }
  if (!out.anilistId) {
    var fb = await _aniZipIds(tmdbId, imdbId);
    if (fb) {
      out.anilistId = fb.anilistId || null;
      if (!out.malId) out.malId = fb.malId || null;
      if (!out.kitsuId) out.kitsuId = fb.kitsuId;
      if (!out.imdbId) out.imdbId = fb.imdbId;
      if (!out.tmdbId) out.tmdbId = fb.tmdbId;
    }
  }
  return out;
}
function _parseTmdbUrl(raw) {
  var m = String(raw || '').match(/^tmdb:\/\/(movie|tv)\/(\d+)/i);
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : null;
}
function _eu(o) {
  return JSON.stringify({
    tmdbId: o.tmdbId || null, imdbId: o.imdbId || null, title: o.title || null, year: o.year || null,
    season: o.season == null ? null : o.season, episode: o.episode == null ? null : o.episode,
    absolute: o.absolute == null ? null : o.absolute, isAnime: o.isAnime === true,
    isBollywood: o.isBollywood === true, isAsian: o.isAsian === true, isCartoon: o.isCartoon === true,
    anilistId: o.anilistId || null, malId: o.malId || null, kitsuId: o.kitsuId || null,
    originalTitle: o.originalTitle || null, imdbTitle: o.imdbTitle || null,
    imdbSeason: o.imdbSeason == null ? null : o.imdbSeason, imdbEpisode: o.imdbEpisode == null ? null : o.imdbEpisode
  });
}
function _sid(raw) {
  var o = raw && typeof raw === 'object' ? raw : null;
  if (!o) { try { o = JSON.parse(String(raw || '{}')); } catch (e) { o = {}; } }
  var se = parseInt(o.season, 10);
  if (!isFinite(se) || se <= 0) se = null;
  var ep = parseInt(o.episode, 10);
  if (!isFinite(ep) || ep <= 0) ep = null;
  var ab = parseInt(o.absolute, 10);
  if (!isFinite(ab) || ab <= 0) ab = ep;
  return {
    tmdbId: o.tmdbId || null, imdbId: o.imdbId || null, title: o.title || null,
    year: parseInt(o.year, 10) || null, season: se, episode: ep, absolute: ab,
    isAnime: o.isAnime === true, isBollywood: o.isBollywood === true, isAsian: o.isAsian === true,
    isCartoon: o.isCartoon === true, anilistId: o.anilistId || null,
    malId: o.malId || null, kitsuId: o.kitsuId || null,
    originalTitle: o.originalTitle || null, imdbTitle: o.imdbTitle || null,
    imdbSeason: parseInt(o.imdbSeason, 10) || null, imdbEpisode: parseInt(o.imdbEpisode, 10) || null
  };
}
async function getDetail(url) {
  var t = _parseTmdbUrl(url);
  if (!t) return null;
  var tv = t.kind === 'tv';
  var info = await _tmdbJsonCached('/' + t.kind + '/' + t.id, { append_to_response: 'external_ids' }, 'tmdb');
  if (!info) return null;
  var genres = (info.genres || []).map(function (g) { return g.name; });
  var countries = info.origin_country || info.production_countries && info.production_countries.map(function (c) { return c.iso_3166_1; }) || [];
  var lang = info.original_language || '';
  var anime = _animeFrom(genres, countries, lang);
  var title = info.title || info.name || info.original_title || info.original_name || 'Untitled';
  var originalTitle = info.original_title || info.original_name || title;
  var year = _fmtYear(info.release_date || info.first_air_date);
  var imdbId = info.external_ids && info.external_ids.imdb_id ? info.external_ids.imdb_id : null;
  var tmdbId = parseInt(t.id, 10);
  var anilistId = null, malId = null, kitsuId = null;
  if (anime) {
    var ids = await _animeIdsCached(title, year, tmdbId, imdbId);
    anilistId = ids.anilistId; malId = ids.malId; kitsuId = ids.kitsuId;
    if (!imdbId) imdbId = ids.imdbId;
    if (tmdbId == null && ids.tmdbId) tmdbId = ids.tmdbId;
  }
  var base = {
    tmdbId: tmdbId, imdbId: imdbId, title: title, year: year == null ? null : String(year),
    isAnime: anime, isBollywood: _isBollywood(countries), isAsian: _isAsian(countries),
    isCartoon: genres.some(function (g) { return /^animation$/i.test(g); }),
    anilistId: anilistId, malId: malId, kitsuId: kitsuId,
    originalTitle: originalTitle, imdbTitle: title
  };
  var eps = [];
  if (tv) {
    var seasons = (info.seasons || []).filter(function (s) { return s.season_number !== 0; })
      .sort(function (a, b) { return a.season_number - b.season_number; });
    var seasonData = await _parallel(seasons, 4, async function (s) {
      return await _tmdbJson('/tv/' + t.id + '/season/' + s.season_number);
    });
    var offset = 0;
    for (var i = 0; i < seasons.length; i++) {
      var sd = seasonData[i];
      if (!sd || !sd.episodes) continue;
      for (var k = 0; k < sd.episodes.length; k++) {
        var ep = sd.episodes[k];
        var sn = ep.season_number || seasons[i].season_number;
        var en = ep.episode_number;
        if (!en) continue;
        var abs = offset + en;
        var payload = Object.assign({}, base, { season: sn, episode: en, absolute: abs, imdbSeason: sn, imdbEpisode: en });
        eps.push({
          id: sn + 'x' + en,
          title: 'S' + String(sn).padStart(2, '0') + 'E' + String(en).padStart(2, '0') + (ep.name ? ' - ' + ep.name : ''),
          number: en, season: sn, absolute: abs,
          url: _eu(payload), thumbnail: _img(ep.still_path, 'w300')
        });
      }
      offset += sd.episodes.length;
    }
  } else {
    eps.push({
      id: 'movie', title: title, number: 1,
      url: _eu(Object.assign({}, base, { season: null, episode: null, absolute: null }))
    });
  }
  return {
    id: url, url: url, title: title,
    cover: _img(info.poster_path, 'w500'), banner: _img(info.backdrop_path, 'w780'),
    description: info.overview || '', type: anime ? 'anime' : 'movie',
    isAnime: anime, isSeries: tv, genres: genres, originCountry: countries, originalLanguage: lang,
    sourceId: SOURCE_ID, year: year == null ? null : String(year), imdbId: imdbId, tmdbId: tmdbId,
    anilistId: anilistId, malId: malId, kitsuId: kitsuId, episodes: eps
  };
}
async function getEpisodes(url) { var d = await getDetail(url); return d ? d.episodes : []; }

// ── HTML helpers ───────────────────────────────────────────────────────
function _baseUrl(u) { var m = String(u || '').match(/^(https?:\/\/[^\/]+)/i); return m ? m[1] : ''; }
function _anchors(html) {
  var out = [], re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    out.push({ attrs: m[1], href: _attr(m[1], 'href'), text: _text(m[2]) });
  }
  return out;
}
function _tags(html, name) {
  var out = [], re = new RegExp('<' + name + '\\b([^>]*)>([\\s\\S]*?)<\\/' + name + '>', 'gi'), m;
  while ((m = re.exec(String(html || ''))) !== null) out.push({ attrs: m[1], text: _text(m[2]), html: m[0] });
  return out;
}
function _blockByClass(html, cls) {
  var s = String(html || ''), re = new RegExp('<([a-z0-9]+)\\b[^>]*class="[^"]*' + cls + '[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1>', 'i');
  var m = s.match(re);
  return m ? m[2] : '';
}
function _scriptText(html) {
  var out = [], re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) out.push(m[1]);
  return out.join('\n');
}
function _imgSrc(html) {
  var m = String(html || '').match(/<img\b[^>]*src=["']([^"']+)["']/i);
  return m ? m[1] : '';
}
function _metaRefresh(html) {
  var m = String(html || '').match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"']+)["']/i);
  return m ? m[1] : '';
}
function _queryParams(u) {
  var out = {}, s = String(u || '').split('#')[0];
  var q = s.indexOf('?') >= 0 ? s.slice(s.indexOf('?') + 1) : '';
  if (!q) return out;
  var parts = q.split('&');
  for (var i = 0; i < parts.length; i++) {
    var kv = parts[i].split('=');
    if (kv.length === 2) { try { out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]); } catch (e) { out[kv[0]] = kv[1]; } }
  }
  return out;
}
function _rot13(s) {
  return String(s || '').replace(/[a-zA-Z]/g, function (c) {
    var base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// ── Signing helpers ────────────────────────────────────────────────────
function _hmacSha256Bytes(key, msg) {
  var k = _utf8Bytes(String(key));
  if (k.length > 64) k = _sha256Bytes(k);
  while (k.length < 64) k.push(0);
  var ip = [], op = [];
  for (var i = 0; i < 64; i++) { ip.push(k[i] ^ 0x36); op.push(k[i] ^ 0x5c); }
  return _sha256Bytes(op.concat(_sha256Bytes(ip.concat(_utf8Bytes(String(msg))))));
}

// ── Redirect / link unwrapping ─────────────────────────────────────────
async function _resolveFinalUrl(startUrl) {
  var cur = startUrl;
  for (var i = 0; i < 7; i++) {
    var r = await _fetch(cur, { method: 'HEAD', followRedirects: false, timeoutMs: 4000 });
    var loc = _hget(r.headers, 'location');
    if (!loc) break;
    cur = _abs(loc, cur);
  }
  return cur;
}
async function _wpRedirect(url) {
  try {
    var html = await _get(url, { timeoutMs: 8000 });
    var re = /s\('o','([A-Za-z0-9+/=]+)'|ck\('_wp_http_\d+','([^']+)'/g, m;
    var combined = '';
    while ((m = re.exec(html)) !== null) combined += m[1] || m[2] || '';
    if (!combined) return '';
    // Upstream order: decode(decode(combined)) -> rot13 -> decode -> JSON.
    // Skipping the final decode leaves a base64 blob and JSON.parse fails.
    var inner = _b64d(_b64d(combined));
    var decoded = '';
    if (_parseJson(inner)) decoded = inner;
    else decoded = _b64d(_rot13(inner));
    var j = _parseJson(decoded);
    if (!j) return '';
    var encodedUrl = _b64d(j.o || '').trim();
    if (encodedUrl) return encodedUrl;
    var data = _b64e(j.data || '').trim();
    var blog = String(j.blog_url || '').trim();
    if (blog && data) {
      var r = await _fetch(blog + '?re=' + encodeURIComponent(data), { timeoutMs: 8000 });
      var m2 = r.body.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      return _text(m2 ? m2[1] : r.body).trim();
    }
  } catch (e) {}
  return '';
}

// ── Extractor: HubCloud / V-Cloud ──────────────────────────────────────
async function _latestBase(base, key) {
  var d = await _dyn(key);
  var nb = _origin(d || '');
  return nb || base;
}
async function _hubCloud(url, ctx) {
  var base = _baseUrl(url);
  var key = /vcloud/i.test(url) ? 'vcloud' : 'hubcloud';
  var nb = await _latestBase(base, key);
  var page = nb && base && nb !== base ? url.replace(base, nb) : url;
  if (nb) base = nb;
  var html = await _get(page, { timeoutMs: 10000 });
  if (!html) return;
  var link = '';
  if (page.indexOf('/video/') >= 0) {
    var m0 = html.match(/<div[^>]*class="[^"]*\bvd\b[^"]*"[^>]*>[\s\S]*?<center>[\s\S]*?<a[^>]+href=["']([^"']+)/i);
    link = m0 ? m0[1] : '';
  } else if (/vcloud/i.test(page)) {
    var m1 = html.match(/var\s+url\s*=\s*atob\s*\(\s*atob\s*\(\s*['"]([^'"]+)['"]\s*\)\s*\)/i);
    if (m1) { try { link = _b64d(_b64d(m1[1])); } catch (e) { link = ''; } }
  } else {
    var scripts = [];
    var sre = /<script\b[^>]*>([\s\S]*?)<\/script>/gi, sm;
    while ((sm = sre.exec(html)) !== null) if (sm[1].indexOf('url') >= 0) scripts.push(sm[1]);
    for (var i = 0; i < scripts.length; i++) {
      var m2 = scripts[i].match(/var\s+url\s*=\s*['"]([^'"]*)['"]/i);
      if (m2 && m2[1]) { link = m2[1]; break; }
    }
  }
  if (!link) return;
  if (!/^https?:\/\//i.test(link)) link = base + (link.charAt(0) === '/' ? '' : '/') + link;
  var doc = await _get(link, { timeoutMs: 10000 });
  if (!doc) return;
  var header = _text(_blockByClass(doc, 'card-header'));
  var size = _text((doc.match(/<i[^>]*id=["']size["'][^>]*>([\s\S]*?)<\/i>/i) || [])[1] || '');
  var q = _quality(header) || 0;
  // Current HubCloud pages first expose a "Generate Direct Download Link" button;
  // the real mirrors (FSL / Download File / 10Gbps) live on the page it opens.
  var docs = [doc];
  var genAnchors = _anchors(doc);
  for (var ga = 0; ga < genAnchors.length; ga++) {
    if (/Generate Direct Download Link/i.test(genAnchors[ga].text) && /^https?:\/\//i.test(genAnchors[ga].href)) {
      var gdoc = await _get(genAnchors[ga].href, { timeoutMs: 10000, headers: { Referer: base + '/' } });
      if (gdoc) docs.push(gdoc);
      break;
    }
  }
  for (var di = 0; di < docs.length; di++) {
    var cur = docs[di];
    var anchors = _anchors(cur);
    for (var a = 0; a < anchors.length; a++) {
      var href = anchors[a].href, text = anchors[a].text;
      if (!href) continue;
      if (/FSL Server|FSLv2|Mega Server|Download File/i.test(text)) {
        ctx.emit(_mkStream(href, q, 'HubCloud ' + text, null, base, size, header));
      } else if (/pixeldra/i.test(href)) {
        var px = cur.match(/var\s+pxl\s*=\s*["']([^"']+)["']/i);
        var pl = px ? px[1] : href;
        var pb = _baseUrl(pl);
        var final = /download/i.test(pl) ? pl : pb + '/api/file/' + pl.split('/').pop() + '?download';
        ctx.emit(_mkStream(final, q, 'HubCloud [Pixeldrain]', null, base, size, header));
      } else if (/Buzz Server/i.test(text)) {
        var buzzBase = _baseUrl(href);
        var bdoc = await _get(href, { timeoutMs: 8000 });
        var bm = bdoc.match(/class="[^"]*download-btn[^"]*"[^>]*href=["']([^"']+)/i);
        if (bm) ctx.emit(_mkStream(buzzBase + bm[1], q, 'HubCloud [Buzz]', null, base, size, header));
      } else if (/Gofile/i.test(text)) {
        await _gofile(href, ctx);
      } else if (ctx.includeDownloads && /10Gbps/i.test(text)) {
        var rl = await _resolveFinalUrl(href);
        if (rl) ctx.emit(_mkStream(rl.indexOf('link=') >= 0 ? rl.split('link=')[1] : rl, q, 'HubCloud [Download]', null, base, size, header));
      }
    }
  }
}

// ── Extractor: GDFlix family ───────────────────────────────────────────
async function _gdflix(url, ctx) {
  var html = await _get(url, { timeoutMs: 10000 });
  if (!html) return;
  var name = _first(/Name\s*:\s*([^<]+)/i, html);
  var size = _first(/Size\s*:\s*([^<]+)/i, html);
  var q = _quality(name) || _quality(url) || 0;
  var anchors = _anchors(html);
  for (var i = 0; i < anchors.length; i++) {
    var href = anchors[i].href, text = anchors[i].text;
    if (!href) continue;
    if (/FSL V2|DIRECT DL|DIRECT SERVER|CLOUD DOWNLOAD|FAST CLOUD/i.test(text) || /pixeldra/i.test(href) || /gofile/i.test(href)) {
      if (/gofile/i.test(href)) { await _gofile(href, ctx); continue; }
      if (/pixeldra/i.test(href)) {
        var pb = _baseUrl(href);
        var final = /download/i.test(href) ? href : pb + '/api/file/' + href.split('/').pop() + '?download';
        ctx.emit(_mkStream(final, q, 'GDFlix [Pixeldrain]', null, _baseUrl(url), size, name));
        continue;
      }
      ctx.emit(_mkStream(href, q, 'GDFlix ' + text, null, _baseUrl(url), size, name));
      continue;
    }
    if (/GD Index/i.test(text)) {
      var link = _baseUrl(url) + href;
      for (var t = 1; t <= 2; t++) {
        var idx = await _get(link + '?type=' + t, { timeoutMs: 8000 });
        var btns = _anchors(idx);
        for (var b = 0; b < btns.length; b++) if (/btn-success/.test(btns[b].attrs) && btns[b].href) ctx.emit(_mkStream(btns[b].href, q, 'GDFlix [CF]', null, _baseUrl(url), size, name));
      }
    }
  }
}

// ── Extractor: Gofile ──────────────────────────────────────────────────
async function _gofile(url, ctx) {
  var m = String(url).match(/\/(?:d\/|\?c=)([0-9a-zA-Z-]+)/);
  if (!m) return;
  var id = m[1];
  var gUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
  var base = 'https://gofile.io';
  var hdrs = { 'User-Agent': gUA, Referer: base + '/', Origin: base };
  var acc = await _post('https://api.gofile.io/accounts', { headers: hdrs, timeoutMs: 8000 });
  var token = _first(/"token"\s*:\s*"([^"]+)"/, acc.body);
  if (!token) return;
  var timeSlot = Math.floor(Date.now() / 1000 / 14400);
  var websiteToken = _sha256Hex(gUA + '::en-GB::' + token + '::' + timeSlot + '::12af056dacea0b');
  var headers = { Referer: base + '/', 'User-Agent': gUA, Authorization: 'Bearer ' + token, 'X-BL': 'en-GB', 'X-Website-Token': websiteToken };
  var j = await _getJson('https://api.gofile.io/contents/' + id + '?page=1&pageSize=100&sortField=name&sortDirection=1', { headers: headers, timeoutMs: 10000 });
  var children = j && j.data && j.data.children ? j.data.children : null;
  if (!children) return;
  for (var k in children) {
    if (!Object.prototype.hasOwnProperty.call(children, k)) continue;
    var f = children[k];
    if (!f || !f.link || f.type !== 'file') continue;
    var s = _mkStream(f.link, _quality(f.name), 'Gofile ' + (f.name || ''), null, base, _formatSize(f.size), f.name);
    s.headers = { Cookie: 'accountToken=' + token };
    ctx.emit(s);
  }
}

// ── Extractor: Driveleech / Driveseed ──────────────────────────────────
async function _driveleech(url, ctx) {
  var base = _baseUrl(url);
  var target = url;
  if (/r\?key=/.test(url)) {
    var first = await _get(url, { timeoutMs: 8000 });
    var mm = first.match(/replace\(["']([^"']+)["']\)/i);
    if (mm) target = base + mm[1];
  }
  var html = await _get(target, { timeoutMs: 10000 });
  if (!html) return;
  var name = _first(/Name\s*:\s*([^<]+)/i, html);
  var size = _first(/Size\s*:\s*([^<]+)/i, html);
  var q = _quality(name) || 0;
  var anchors = _anchors(html);
  for (var i = 0; i < anchors.length; i++) {
    var href = anchors[i].href, text = anchors[i].text;
    if (!href) continue;
    if (/Cloud Download/i.test(text)) ctx.emit(_mkStream(href, q, 'Driveleech [Cloud]', null, base, size, name));
    else if (/gofile/i.test(text)) await _gofile(href, ctx);
    else if (/Resume Cloud/i.test(text)) {
      var d = await _get(base + href, { timeoutMs: 10000 });
      var bm = d.match(/<a[^>]*class="[^"]*btn-success[^"]*"[^>]*href=["']([^"']+)/i);
      if (bm) ctx.emit(_mkStream(bm[1], q, 'Driveleech [ResumeCloud]', null, base, size, name));
    } else if (/Direct Links/i.test(text)) {
      for (var t = 1; t <= 2; t++) {
        var d2 = await _get(base + href + '?type=' + t, { timeoutMs: 8000 });
        var btns = _anchors(d2);
        for (var b = 0; b < btns.length; b++) if (/btn-success/.test(btns[b].attrs) && btns[b].href) ctx.emit(_mkStream(btns[b].href, q, 'Driveleech [CF]', null, base, size, name));
      }
    } else if (/Resume Worker Bot/i.test(text)) {
      var rb = await _resumeBot(href);
      if (rb) ctx.emit(_mkStream(rb, q, 'Driveleech [ResumeBot]', null, base, size, name));
    } else if (ctx.includeDownloads && /Instant Download/i.test(text)) {
      var r = await _fetch(href, { followRedirects: false, timeoutMs: 8000 });
      var loc = _hget(r.headers, 'location');
      if (loc && loc.indexOf('url=') >= 0) ctx.emit(_mkStream(loc.split('url=')[1], q, 'Driveleech [Instant]', null, base, size, name));
    }
  }
}
async function _resumeBot(url) {
  var page = await _fetch(url, { timeoutMs: 10000 });
  var html = page.body;
  var ssid = '';
  var jar = _COOKIE_JAR[_host(url)] || {};
  if (jar.PHPSESSID) ssid = jar.PHPSESSID;
  var token = _first(/formData\.append\('token', '([a-f0-9]+)'\)/i, html);
  var path = _first(/fetch\('\/download\?id=([a-zA-Z0-9+/]+)'/i, html);
  var base = url.split('/download')[0];
  if (!token || !path) return null;
  var r = await _postForm(base + '/download?id=' + path, { token: token }, {
    headers: { Accept: '*/*', Origin: base, 'Sec-Fetch-Site': 'same-origin', Referer: url, Cookie: 'PHPSESSID=' + ssid },
    timeoutMs: 10000
  });
  var j = _parseJson(r.body);
  return j && j.url ? j.url : null;
}

// ── Extractor: Asianload / Embedload ───────────────────────────────────
async function _asianload(url, ctx) {
  var html = await _get(url, { timeoutMs: 10000 });
  if (!html) return;
  var script = '';
  var m = html.match(/<div[^>]*id=["']player["'][^>]*>[\s\S]*?<script\b[^>]*>([\s\S]*?)<\/script>/i);
  if (m) script = m[1];
  if (!script) script = _scriptText(html);
  var unpacked = script;
  try { if (typeof unpackJs === 'function') unpacked = unpackJs(script); } catch (e) {}
  var re = /window\.atob\("([^"]+)"\)/g, mm;
  while ((mm = re.exec(unpacked)) !== null) {
    var link = '';
    try { link = _b64d(mm[1]); } catch (e) { link = ''; }
    if (!/^https?:\/\//i.test(link)) continue;
    if (/\.mp4/i.test(link)) ctx.emit(_mkStream(link, 0, 'AsianLoad (mp4)', 'mp4', url));
    else if (/\.m3u8/i.test(link)) ctx.emit(_mkStream(link, 0, 'AsianLoad (m3u8)', 'hls', url));
  }
}

// ── Extractor: VibePlayer ──────────────────────────────────────────────
async function _vibe(url, ctx) {
  var html = await _get(url, { timeoutMs: 8000 });
  var m = html.match(/const\s+src\s*=\s*["']([^"']+)["']/i);
  if (m) ctx.emit(_mkStream(m[1], 1080, 'VibePlayer', 'hls', _baseUrl(url)));
}

// ── Extractor: MegaPlay ────────────────────────────────────────────────
async function _megaplay(url, referer, ctx) {
  var host = 'https://megaplay.buzz';
  var html = await _get(url, { headers: { Referer: referer || 'https://anikototv.to/' }, timeoutMs: 10000 });
  if (!html) return;
  var sid = '';
  var m = html.match(/id=["']megaplay-player["'][^>]*data-(?:id|realid)=["']([^"']+)/i);
  if (m) sid = m[1];
  if (!sid) m = url.match(/\/stream\/s-\d+\/(\d+)\//);
  if (m && !sid) sid = m[1];
  if (!sid) return;
  var type = /\/dub/i.test(url) ? 'dub' : 'sub';
  var j = await _getJson(host + '/stream/getSources?id=' + encodeURIComponent(sid) + '&type=' + type, { headers: { Referer: url }, timeoutMs: 10000 });
  var file = j && j.sources && j.sources.file ? j.sources.file : '';
  if (file) ctx.emit(_mkStream(file, 1080, 'MegaPlay', 'hls', host));
  if (j && j.tracks) for (var i = 0; i < j.tracks.length; i++) {
    var tr = j.tracks[i];
    if (tr && tr.file && /^(captions|subtitles)$/i.test(String(tr.kind || ''))) ctx.sub(tr.file, tr.label || 'Unknown');
  }
}

// ── Generic embed resolver ─────────────────────────────────────────────
function _mediaFromHtml(html) {
  var out = [];
  var patterns = [
    /(?:file|src|url|link)\s*[:=]\s*["'](https?:\/\/[^"']+?\.(?:m3u8|mp4|mkv)(?:\?[^"']*)?)["']/gi,
    /["'](https?:\/\/[^"'\s]+?\.(?:m3u8|mp4|mkv)(?:\?[^"'\s]*)?)["']/gi,
    /(https?:\/\/[^"'\s<>]+?\.(?:m3u8|mp4|mkv)(?:\?[^"'\s<>]*)?)/gi,
    /(https?:\/\/[^"'\s<>]+\/get_video[^"'\s<>]*)/gi
  ];
  for (var p = 0; p < patterns.length; p++) {
    var re = patterns[p], m;
    while ((m = re.exec(String(html || ''))) !== null) {
      var u = m[1].replace(/\\\//g, '/');
      if (!/^https?:\/\//i.test(u)) continue;
      if (/\.(?:css|js|png|jpg|jpeg|gif|webp|svg|woff2?)(?:\?|$)/i.test(u)) continue;
      if (out.indexOf(u) < 0) out.push(u);
    }
  }
  return out;
}
async function _resolveEmbed(url, ctx, referer, depth) {
  depth = depth || 0;
  if (depth > 2) return;
  var html = await _get(url, { headers: referer ? { Referer: referer } : null, timeoutMs: 10000 });
  if (!html) return;
  var texts = [html];
  try { if (typeof unpackJs === 'function') texts.push(unpackJs(html)); } catch (e) {}
  var scripts = _scriptText(html);
  if (scripts && typeof unpackJs === 'function') { try { texts.push(unpackJs(scripts)); } catch (e) {} }
  var found = [];
  for (var i = 0; i < texts.length; i++) {
    var list = _mediaFromHtml(texts[i]);
    for (var k = 0; k < list.length; k++) if (found.indexOf(list[k]) < 0) found.push(list[k]);
  }
  if (found.length) {
    for (var f = 0; f < found.length; f++) {
      var u = found[f];
      ctx.emit(_mkStream(u, _quality(u) || 0, 'Embed', null, _baseUrl(url)));
    }
    return;
  }
  var iframes = _all(/<iframe\b[^>]*src=["']([^"']+)["']/gi, html, 1);
  for (var j = 0; j < iframes.length; j++) {
    var src = _abs(iframes[j], url);
    if (!src || /youtube|google|facebook|doubleclick|ads?\./i.test(src)) continue;
    await _resolveEmbed(src, ctx, url, depth + 1);
  }
}

// ── Extractor dispatcher ───────────────────────────────────────────────
async function _loadSource(name, url, referer, ctx, quality, size) {
  url = _abs(_trim(url), referer || '');
  if (!/^https?:\/\//i.test(url)) return;
  var q = quality || _quality(url) || 0;
  var wrapped = {
    includeDownloads: ctx.includeDownloads,
    emit: function (s) {
      if (!s) return;
      s.label = name + ' [' + s.label + ']' + (size ? ' ' + size : '');
      if (quality) s.quality = _qualityLabel(quality);
      ctx.emit(s);
    },
    sub: ctx.sub
  };
  try {
    if (/hubcloud\.|vcloud\./i.test(url)) return await _hubCloud(url, wrapped);
    if (/gdflix\.|gdlink\./i.test(url)) return await _gdflix(url, wrapped);
    if (/fastdlserver\./i.test(url)) {
      var r = await _fetch(url, { followRedirects: false, timeoutMs: 8000 });
      var loc = _hget(r.headers, 'location');
      if (loc) await _loadSource(name, _abs(loc, url), referer, ctx, quality, size);
      return;
    }
    if (/linksmod\./i.test(url)) {
      var lm = await _get(url, { timeoutMs: 8000 });
      var la = _anchors(lm);
      for (var i = 0; i < la.length; i++) if (la[i].href) await _loadSource(name, la[i].href, url, ctx, quality, size);
      return;
    }
    // Hdhub4u's greenmotors wrapper now lands on a link-hub page (hblinks.*)
    // that lists HubDrive/GDTot/GoFile targets instead of a direct mirror.
    if (/hblinks?\./i.test(url)) {
      var hl = await _get(url, { timeoutMs: 10000 });
      var hla = _anchors(hl), hjobs = [];
      for (var h = 0; h < hla.length; h++) {
        var hu = hla[h].href;
        if (!hu || hu.charAt(0) === '#' || _host(hu) === _host(url)) continue;
        if (/hubdrive|gdtot|gofile|pixeldra|hubcloud|drive|download|file/i.test(hla[h].text + ' ' + hu)) hjobs.push(hu);
      }
      await _parallel(hjobs, 3, async function (hu) { await _loadSource(name, hu, url, ctx, quality, size); });
      return;
    }
    if (/hubdrive\./i.test(url)) {
      var hd = await _get(url, { timeoutMs: 8000 });
      var hm = hd.match(/class="[^"]*btn-user[^"]*"[^>]*href=["']([^"']+)/i) || hd.match(/class="[^"]*btn-success1[^"]*"[^>]*href=["']([^"']+)/i);
      if (hm) await _loadSource(name, hm[1], url, ctx, quality, size);
      return;
    }
    if (/gofile\./i.test(url)) return await _gofile(url, wrapped);
    if (/driveleech\.|driveseed\./i.test(url)) return await _driveleech(url, wrapped);
    if (/howblogs\./i.test(url)) {
      var hb = await _get(url, { timeoutMs: 8000 });
      var ha = _anchors(_blockByClass(hb, 'center_it'));
      for (var h = 0; h < ha.length; h++) if (ha[h].href) await _loadSource(name, ha[h].href, url, ctx, quality, size);
      return;
    }
    if (/asianload\.|embedload\./i.test(url)) return await _asianload(url, wrapped);
    if (/vivibebe\.|bibiemb\.|vibeplayer\./i.test(url)) return await _vibe(url, wrapped);
    if (/megaplay\.|vidwish\.|vidtube\./i.test(url)) return await _megaplay(url, referer, wrapped);
    if (/modiplay\./i.test(url)) {
      var md = await _get(url, { timeoutMs: 8000 });
      var re = /switchServer\(['"](https?:\/\/[^'"]+)/g, mm;
      while ((mm = re.exec(md)) !== null) await _resolveEmbed(mm[1], wrapped, url);
      return;
    }
    return await _resolveEmbed(url, wrapped, referer);
  } catch (e) {
    console.warn('CineStream extractor failed for ' + _host(url) + ': ' + (e && e.message || e));
  }
}

// ── Stream builders ────────────────────────────────────────────────────
function _mkStream(url, quality, label, container, referer, size, infoLine) {
  var headers = {};
  if (referer) headers.Referer = referer;
  var s = _stream(url, quality, label, container, headers, 'unknown');
  if (!s) return null;
  if (size || infoLine) s.label = s.label + '\n' + [infoLine || '', size || ''].filter(Boolean).join(' | ');
  return s;
}

// ── Provider constants (upstream parity) ───────────────────────────────
var API = {
  tokyoInsider: 'https://www.tokyoinsider.com', allmovieland: 'https://allmovieland.one',
  anizone: 'https://anizone.to', primesrc: 'https://primesrc.me', asiaflix: 'https://asiaflix.net',
  hexa: 'https://theemoviedb.hexa.su', videasy: 'https://api.speedracelight.com', vidlink: 'https://vidlink.pro',
  animetosho: 'https://feed.animetosho.xyz', animetoshoBase: 'https://animetosho.xyz', anizip: 'https://api.ani.zip',
  vidzee: 'https://player.vidzee.wtf', kisskh: 'https://kisskh.nl', vidup: 'https://vidup.to',
  gramApi: 'https://tga-hd.api.hashhackers.com', gramBase: 'https://bollywood.eu.org',
  akwam: 'https://akwam.it', levidia: 'https://www.levidia.ch', showbox: 'https://showbox.media',
  febbox: 'https://www.febbox.com', anikoto: 'https://anikototv.to', projectfreetv: 'https://projectfreetv.sx',
  vidrock: 'https://vidrock.ru', animekizz: 'https://animekizz.live', vidfast: 'https://vidfast.vc',
  onetouch: 'https://api3.devcorp.me', av1: 'https://av1encodes.com', peachify: 'https://x.eat-peach.sbs',
  peachifyBase: 'https://peachify.top', reanime: 'https://reanime.to', animesalt: 'https://animesalt.ac',
  anidb: 'https://anidb.app', vaplayer: 'https://streamdata.vaplayer.ru', fshare: 'https://fsharetv.cc',
  castle: 'https://api.hlowb.com', vidcore: 'https://vidcore.io', anikage: 'https://anikage.cc',
  meowtvBase: 'https://meowtv.ru', meowtv: 'https://api.meowtv.ru', anineko: 'https://anineko.to',
  cinejoy: 'https://api.shegu.st', cinejoyBase: 'https://cinejoy.to',
  just4anime: 'https://api.just4anime.online/api/v1', just4animeBase: 'https://just4anime.online',
  movieboxHost: 'https://h5-api.aoneroom.com', movieboxWeb: 'https://h5.aoneroom.com',
  fibwatchPlaybackReferer: 'https://urlshortlink.top/'
};

// ── Provider helpers ───────────────────────────────────────────────────
function _cap(s) { s = String(s == null ? '' : s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function _quote(s) { return encodeURIComponent(String(s == null ? '' : s)); }
function _epSlug(season, episode) {
  return [season == null ? '' : (season < 10 ? '0' + season : '' + season),
          episode == null ? '' : (episode < 10 ? '0' + episode : '' + episode)];
}
function _slug2(s) {
  return String(s == null ? '' : s).replace(/[^\p{L}\p{N}\s]/gu, '').replace(/^\s+|\s+$/g, '').replace(/\s+/g, '-').toLowerCase();
}
function _urlTitle(s) { return String(s == null ? '' : s).replace(/[^a-zA-Z\d]/g, '-'); }
function _randHex(n) {
  var out = '';
  for (var i = 0; i < n; i++) out += ('0' + Math.floor(Math.random() * 256).toString(16)).slice(-2);
  return out;
}
function _emitH(ctx, url, q, label, container, headers, size, info) {
  var s = _stream(url, q, label, container, headers || {});
  if (!s) return;
  if (size || info) s.label = s.label + '\n' + [info || '', size || ''].filter(Boolean).join(' | ');
  ctx.emit(s);
}
function _subsFrom(ctx, list, source) {
  if (!list) return;
  for (var i = 0; i < list.length; i++) {
    var x = list[i];
    if (x && x.url) ctx.sub(x.lang || x.label || x.language || 'Unknown', x.url, source || 'CineStream');
  }
}
async function _jsonPost(url, obj, headers, timeout) {
  var r = await _postJson(url, obj, { headers: headers || {}, timeoutMs: timeout || FETCH_TIMEOUT });
  return _parseJson(r.body);
}
function _md5hex(s) { return _sha256Hex(String(s)).slice(0, 32); } // only used as legacy fallback

// ── 1. Showbox ─────────────────────────────────────────────────────────
var SHOWBOX_HEADERS = { Accept: 'application/json, text/html, */*', 'Accept-Language': 'en', 'User-Agent': UA };
function _showboxParseSearchHref(html) {
  var m = html.match(/class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/i) ||
          html.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/i);
  return m ? API.showbox + m[1] : null;
}
function _showboxParseHeadingId(html) {
  var m = html.match(/class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i);
  if (!m) return null;
  var v = m[1].split('/').filter(Boolean).pop();
  var n = parseInt(v, 10);
  return isFinite(n) ? n : null;
}
async function _showboxSearch(imdbId) {
  for (var a = 0; a < 7; a++) {
    var html = await _get(API.showbox + '/search?keyword=' + encodeURIComponent(imdbId), { headers: SHOWBOX_HEADERS, timeoutMs: 8000 });
    var href = _showboxParseSearchHref(html || '');
    if (href) {
      var detail = await _get(href, { headers: SHOWBOX_HEADERS, timeoutMs: 8000 });
      var id = _showboxParseHeadingId(detail || '');
      if (id != null) return id;
    }
  }
  return null;
}
function _showboxTokenHeader(t) {
  t = String(t || '');
  return /^ui=/.test(t) ? t : 'ui=' + t;
}
async function provShowbox(r, ctx) {
  var token = _str('showboxToken', '');
  if (!r.imdbId || !token) return;
  var mediaId = await _showboxSearch(r.imdbId);
  if (mediaId == null) return;
  var type = r.season != null ? 2 : 1;
  var sl = await _getJson(API.showbox + '/index/share_link?id=' + mediaId + '&type=' + type, { headers: SHOWBOX_HEADERS, timeoutMs: 8000 });
  var shareKey = sl && sl.data && sl.data.link ? String(sl.data.link).split('/').pop() : null;
  if (!shareKey) return;
  async function list(parentId) {
    var u = API.febbox + '/file/file_share_list?share_key=' + encodeURIComponent(shareKey);
    if (parentId != null) u += '&parent_id=' + parentId + '&page=1';
    var j = await _getJson(u, { headers: SHOWBOX_HEADERS, timeoutMs: 8000 });
    return j && j.data ? j.data : null;
  }
  var root = await list(null);
  var files = root && root.file_list ? root.file_list : null;
  if (!files) return;
  var target = null;
  if (r.season != null && r.episode != null) {
    var es = _epSlug(r.season, r.episode);
    var folder = null;
    for (var i = 0; i < files.length; i++) {
      var f = files[i], nm = String(f.file_name || '').toLowerCase();
      if (f.is_dir && (nm.indexOf('season ' + r.season) >= 0 || nm.indexOf('s' + es[0]) >= 0)) { folder = f; break; }
    }
    if (!folder) { for (var j2 = 0; j2 < files.length; j2++) if (files[j2].is_dir) { folder = files[j2]; break; } }
    if (!folder) return;
    var sub = await list(folder.fid);
    var eps = sub && sub.file_list ? sub.file_list : null;
    if (!eps) return;
    for (var k = 0; k < eps.length; k++) {
      var e = eps[k], en = String(e.file_name || '').toLowerCase();
      if (!e.is_dir && (en.indexOf('e' + es[1]) >= 0 || en.indexOf('ep' + es[1]) >= 0 || en.indexOf('episode ' + r.episode) >= 0)) { target = e; break; }
    }
    if (!target) { for (var m = 0; m < eps.length; m++) if (!eps[m].is_dir) { target = eps[m]; break; } }
  } else {
    for (var n = 0; n < files.length; n++) if (!files[n].is_dir) { target = files[n]; break; }
  }
  if (!target) return;
  var qr = await _getJson(API.febbox + '/console/video_quality_list?fid=' + target.fid + '&share_key=' + encodeURIComponent(shareKey), {
    headers: Object.assign({}, SHOWBOX_HEADERS, { Cookie: _showboxTokenHeader(token) }), timeoutMs: 10000
  });
  var html = qr && qr.html ? qr.html : '';
  var re = /<div[^>]*class="[^"]*file_quality[^"]*"[^>]*>/gi, m2;
  var vh = { Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.8', Connection: 'keep-alive', Range: 'bytes=0-', Referer: 'https://www.febbox.com', 'User-Agent': UA };
  while ((m2 = re.exec(html)) !== null) {
    var tag = m2[0];
    var u2 = _first(/data-url="([^"]+)"/i, tag);
    var q2 = _first(/data-quality="([^"]+)"/i, tag);
    if (!u2 || !q2) continue;
    u2 = u2.replace(/\\\//g, '/');
    _emitH(ctx, u2, q2 === 'ORG' ? 2160 : _quality(q2), 'Showbox ' + (q2 === 'ORG' ? 'ORG' : q2), /\.m3u8/i.test(u2) ? 'hls' : 'mp4', vh);
  }
}

// ── 2. Vidrock ─────────────────────────────────────────────────────────
async function provVidrock(r, ctx) {
  if (!r.tmdbId) return;
  var type = r.season == null ? 'movie' : 'tv';
  var query = type === 'movie' ? String(r.tmdbId) : r.tmdbId + '_' + r.season + '_' + r.episode;
  var headers = { Origin: API.vidrock, Referer: API.vidrock + '/', 'User-Agent': UA };
  var j = await _getJson(API.vidrock + '/api/' + type + '/' + query + '/', { headers: headers, timeoutMs: 10000 });
  if (!j) return;
  for (var server in j) {
    if (!Object.prototype.hasOwnProperty.call(j, server)) continue;
    var sd = j[server];
    if (!sd || !sd.url || sd.url === 'error' || sd.url === 'null') continue;
    var url = _decryptVidrock(sd.url);
    if (!url) continue;
    _emitH(ctx, url, 0, 'Vidrock[' + server + ']', /m3u8/i.test(url) ? 'hls' : null, headers);
  }
}

// ── 3. Moviebox ────────────────────────────────────────────────────────
function _unwrapData(j) {
  if (!j || typeof j !== 'object') return {};
  var d = j.data;
  if (!d || typeof d !== 'object') return j;
  return d.data && typeof d.data === 'object' ? d.data : d;
}
async function provMoviebox(r, ctx) {
  var title = r.title; if (!title) return;
  var base = API.movieboxHost;
  var latest = await _fetch(base + '/wefeed-h5api-bff/app/get-latest-app-pkgs?app_name=moviebox', { timeoutMs: 10000 });
  // Zangetsu's fetch bridge strips some response headers (e.g. x-user). Fall back
  // to extracting the JWT token from the set-cookie header.
  var xUser = _hget(latest.headers, 'x-user') || _hget(latest.headers, 'set-cookie') || '';
  var token = '';
  var m = xUser.match(/"token"\s*:\s*"([^"]+)"/);
  if (m) token = m[1];
  else {
    m = xUser.match(/token=([^;]+)/);
    if (m) token = m[1];
  }
  if (!token) return;
  var baseHeaders = {
    'X-Client-Info': '{"timezone":"Africa/Nairobi"}', 'Accept-Language': 'en-US,en;q=0.5', Accept: 'application/json',
    Referer: base, Host: 'h5-api.aoneroom.com', Connection: 'keep-alive', Authorization: 'Bearer ' + token,
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
  };
  var subjectType = r.season != null ? 2 : 1;
  var search = await _jsonPost(base + '/wefeed-h5api-bff/subject/search', { keyword: title, page: 1, perPage: 24, subjectType: subjectType }, { headers: baseHeaders, timeoutMs: 10000 });
  var items = search && _unwrapData(search).items ? _unwrapData(search).items : null;
  if (!items) return;
  var titleRe = new RegExp('^' + String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s+\\[([^\\]]+)\\])?$', 'i');
  var ids = {}, order = [];
  for (var i = 0; i < items.length; i++) {
    var it = items[i]; if (!it) continue;
    var id = it.subjectId; if (!id) continue;
    var clean = String(it.title || '').replace(/\sS\d+(?:-S?\d+)*$/i, '');
    var mm = clean.match(titleRe); if (!mm) continue;
    if (!ids[id]) { ids[id] = mm[1] || 'Original'; order.push(id); }
  }
  if (!order.length) return;
  var seenQ = {};
  for (var oi = 0; oi < order.length; oi++) {
    var sid = order[oi], language = ids[sid];
    var detail = await _getJson(API.movieboxWeb + '/wefeed-h5-bff/web/post/list/subject?id=' + sid, { headers: baseHeaders, timeoutMs: 10000 });
    var detailPath = detail && detail.data && detail.data.items && detail.data.items[0] && detail.data.items[0].subject
      ? detail.data.items[0].subject.detailPath : '';
    if (!detailPath) continue;
    var params = 'subjectId=' + sid + (r.season != null ? '&se=' + r.season + '&ep=' + r.episode : '') + '&detailPath=' + encodeURIComponent(detailPath);
    var reqHeaders = Object.assign({}, baseHeaders, {
      Referer: 'https://fmoviesunblocked.net/spa/videoPlayPage/movies/' + detailPath + '?id=' + sid + '&type=/movie/detail',
      Origin: 'https://fmoviesunblocked.net'
    });
    var dl = await _getJson(base + '/wefeed-h5api-bff/subject/download?' + params, { headers: reqHeaders, timeoutMs: 12000 }) || {};
    var pl = await _getJson(base + '/wefeed-h5api-bff/subject/play?' + params, { headers: reqHeaders, timeoutMs: 12000 }) || {};
    var dd = _unwrapData(dl), pd = _unwrapData(pl);
    var ph = { Referer: 'https://fmoviesunblocked.net/', Origin: 'https://fmoviesunblocked.net' };
    var downloads = dd.downloads || [];
    for (var d = 0; d < downloads.length; d++) {
      var x = downloads[d]; if (!x || !x.url || x.vipLocked) continue;
      var res = parseInt(x.resolution, 10) || 0; seenQ[res] = true;
      _emitH(ctx, x.url, res, 'MovieBox [' + language + ']', null, ph);
    }
    var streams = pd.streams || [];
    for (var s = 0; s < streams.length; s++) {
      var y = streams[s]; if (!y || !y.url || y.vipLocked) continue;
      var rs = parseInt(y.resolutions, 10) || parseInt(y.resolution, 10) || 0;
      if (seenQ[rs]) continue; seenQ[rs] = true;
      _emitH(ctx, y.url, rs, 'MovieBox [' + language + ']', null, ph);
    }
    var dash = pd.dash || [];
    for (var z = 0; z < dash.length; z++) if (dash[z] && dash[z].url && !dash[z].vipLocked)
      _emitH(ctx, dash[z].url, 0, 'MovieBox Auto [' + language + '] (DASH)', null, ph);
    var caps = dd.captions || [];
    for (var c = 0; c < caps.length; c++) if (caps[c] && caps[c].url)
      ctx.sub(caps[c].lanName || caps[c].lan || 'Unknown', caps[c].url, 'Moviebox');
  }
}

// ── 4. MovieBlast (build-time credentials are settings here) ───────────
function _movieblastSigned(url, key) {
  try {
    var path = String(url).replace(/^https?:\/\/[^\/]+/i, '').split('?')[0];
    var ts = String(Math.floor(Date.now() / 1000));
    var sig = _b64Bytes(_hmacSha256Bytes(key, path + ts));
    return url + '?verify=' + ts + '-' + encodeURIComponent(sig);
  } catch (e) { return null; }
}
async function provMovieblast(r, ctx) {
  var api = _str('movieblastApi', '');
  var tok = _str('movieblastToken', '');
  var key = _str('movieblastKey', '');
  if (!api || !tok || !key || !r.title) return;
  var headers = { 'User-Agent': 'MovieBlast', Referer: 'MovieBlast', 'x-request-x': 'com.movieblast' };
  var encoded = encodeURIComponent(r.title).replace(/%20/g, '%20');
  var search = await _getJson(api.replace(/\/+$/, '') + '/search/' + encoded + '/' + tok, { headers: headers, timeoutMs: 12000 });
  if (!search || !search.search) return;
  var expected = r.season == null ? 'movie' : 'serie';
  var item = null;
  for (var i = 0; i < search.search.length; i++) {
    var it = search.search[i];
    if (it.type !== expected) continue;
    if (String(it.name || '').toLowerCase() === String(r.title).toLowerCase() ||
        String(it.originalName || '').toLowerCase() === String(r.title).toLowerCase()) { item = it; break; }
  }
  if (!item) return;
  var type = r.season == null ? 'media/detail' : 'series/show';
  var details = await _getJson(api.replace(/\/+$/, '') + '/' + type + '/' + item.id + '/' + tok, { headers: headers, timeoutMs: 12000 });
  if (!details) return;
  var videos = details.videos;
  if (r.season != null) {
    var se = (details.seasons || []).find(function (x) { return x.seasonNumber === r.season; });
    var ep = se && se.episodes ? se.episodes.find(function (x) { return x.episodeNumber === r.episode; }) : null;
    videos = ep ? ep.videos : null;
  }
  (videos || []).forEach(function (v) {
    if (!v.link) return;
    var full = /^http/i.test(v.link) ? v.link : 'https://' + v.link;
    var signed = _movieblastSigned(full, key);
    if (!signed) return;
    _emitH(ctx, signed, _quality(v.server || ''), 'MovieBlast(Multi Audio)', /\.m3u8/i.test(signed) ? 'hls' : null, headers);
  });
  (details.subtitles || []).forEach(function (s) {
    var link = s.link; if (!link) return;
    if (!/^http/i.test(link)) link = 'https://' + link;
    ctx.sub(s.lang || 'Unknown', link, 'MovieBlast');
  });
}

// ── 5. Fibwatch ────────────────────────────────────────────────────────
function _fibQuality(raw) {
  var l = String(raw || '').toLowerCase();
  if (l.indexOf('2160') >= 0 || l.indexOf('4k') >= 0) return '4K';
  if (l.indexOf('1080') >= 0) return '1080p';
  if (l.indexOf('720') >= 0) return '720p';
  if (l.indexOf('480') >= 0) return '480p';
  if (l.indexOf('360') >= 0) return '360p';
  return 'Unknown';
}
async function _fibResolve(initial, fallback) {
  var current = initial;
  var hdrs = { 'User-Agent': UA, Referer: _baseUrl(initial) + '/' };
  var html = await _get(current, { headers: hdrs, timeoutMs: 10000 });
  if (!html) return null;
  var generic = /https?:\/\/[a-zA-Z0-9-.]+\/[^\s"'`<>]*\.(?:mp4|mkv|m3u8)/i;
  var cdn = /https?:\/\/[a-zA-Z0-9-]+\.b-cdn\.net\/[^\s"'`<>]+\.(?:mkv|mp4|m3u8)/i;
  var next = _first(/<a[^>]*class="[^"]*hidden-button[^"]*buttonDownloadnew[^"]*"[^>]*href="([^"]+)"/i, html) ||
             _first(/<a[^>]*href="([^"]*watch2=1[^"]*)"/i, html);
  if (next) {
    var target = next;
    if (next.indexOf('url=http') >= 0) {
      var enc = next.split('url=')[1].split('&')[0].trim();
      try { target = decodeURIComponent(enc); } catch (e) { target = enc; }
      if (generic.test(target) || cdn.test(target)) return [target, fallback];
    }
    try { current = new URL(target, current).toString(); } catch (e) {}
    html = await _get(current, { headers: hdrs, timeoutMs: 10000 });
    if (!html) return null;
  }
  var stream = (html.match(cdn) || [])[0] || null;
  if (!stream) {
    var ifr = _all(/<iframe\b[^>]*src=["']([^"']+)["']/gi, html, 1).find(function (s) { return s && !/youtube|google/i.test(s); });
    if (ifr) {
      var abs = _abs(ifr, current);
      var ih = await _get(abs, { headers: { 'User-Agent': UA, Referer: API.fibwatchPlaybackReferer, Origin: 'https://urlshortlink.top' }, timeoutMs: 10000 });
      stream = (ih.match(cdn) || [])[0] || (ih.match(generic) || [])[0] || null;
    }
  }
  if (!stream) stream = (html.match(generic) || [])[0] || null;
  if (!stream) return null;
  if (stream.indexOf('url=http') >= 0) {
    var e2 = stream.split('url=')[1].split('&')[0].trim();
    try { stream = decodeURIComponent(e2); } catch (e) { stream = e2; }
  }
  var rq = _fibQuality(stream);
  return [stream, rq !== 'Unknown' ? rq : fallback];
}
async function provFibwatch(r, ctx) {
  if (!r.title) return;
  var base = await _dyn('fibwatch');
  if (!base) return;
  var isTv = r.season != null && r.episode != null;
  var hdrs = { 'User-Agent': UA, Referer: base + '/' };
  var html = await _get(base + '/search?keyword=' + _quote(r.title) + '&page_id=1', { headers: hdrs, timeoutMs: 10000 });
  if (!html) return;
  var results = [], re = /<div[^>]*class="[^"]*video-thumb[^"]*"[\s\S]*?<\/div>/gi, m;
  var anchors = _anchors(html);
  var thumbRe = /<div[^>]*class="[^"]*video-thumb[^"]*"[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)/gi;
  while ((m = thumbRe.exec(html)) !== null) {
    var t = _first(/<p[^>]*class="[^"]*hptag[^"]*"[^>]*>([\s\S]*?)<\/p>/i, html.slice(m.index, m.index + 900));
    results.push([_text(t || ''), m[1]]);
  }
  if (!results.length) {
    for (var i = 0; i < anchors.length; i++) if (anchors[i].href) results.push([anchors[i].text, anchors[i].href]);
  }
  if (!results.length) return;
  var lower = r.title.toLowerCase();
  var match = results.find(function (x) { return x[0].toLowerCase().indexOf(lower) >= 0; }) || results[0];
  var detailUrl = /^http/i.test(match[1]) ? match[1] : base + match[1];
  var detail = await _get(detailUrl, { headers: hdrs, timeoutMs: 10000 });
  var videoId = _first(/<input[^>]*id="video-id"[^>]*value="([^"]+)"/i, detail);
  if (!videoId) return;
  var candidates = [];
  async function switcher(vid) {
    var s = await _getJson(base + '/ajax/resolution_switcher.php?video_id=' + vid, { headers: hdrs, timeoutMs: 10000 });
    if (!s) return;
    if (s.current) candidates = candidates.concat(s.current);
    if (s.popup) candidates = candidates.concat(s.popup);
  }
  if (isTv) {
    var eps = await _getJson(base + '/ajax/episodes.php?video_id=' + videoId, { headers: hdrs, timeoutMs: 10000 });
    var list = eps && eps.episodes ? eps.episodes : [];
    var epUrl = null;
    for (var e = 0; e < list.length; e++) {
      var mm = String(list[e].title || '').toLowerCase().match(/s(\d{1,2})e(\d{1,3})/);
      if (mm && parseInt(mm[1], 10) === r.season && parseInt(mm[2], 10) === r.episode) { epUrl = list[e].url; break; }
    }
    if (!epUrl) epUrl = list[0] && list[0].url;
    if (!epUrl) return;
    var full = /^http/i.test(epUrl) ? epUrl : base + epUrl;
    var ed = await _get(full, { headers: hdrs, timeoutMs: 10000 });
    var evid = _first(/<input[^>]*id="video-id"[^>]*value="([^"]+)"/i, ed);
    if (!evid) return;
    await switcher(evid);
  } else await switcher(videoId);
  var seen = {};
  for (var c = 0; c < candidates.length; c++) {
    var cand = candidates[c]; var url = cand.url ? String(cand.url).trim() : '';
    if (!url) continue;
    if (!/^http/i.test(url)) url = base + url;
    var fb = _fibQuality(cand.res || url);
    var resolved, quality;
    if (/\.(mp4|mkv|m3u8)/i.test(url)) { resolved = url; quality = fb; }
    else {
      var rr2 = await _fibResolve(url, fb);
      if (!rr2) continue;
      resolved = rr2[0]; quality = rr2[1];
    }
    if (seen[resolved]) continue; seen[resolved] = true;
    var ph = { 'User-Agent': UA, Referer: API.fibwatchPlaybackReferer, Origin: 'https://urlshortlink.top' };
    _emitH(ctx, resolved, _quality(quality), 'FibWatch' + (isTv ? ' (Combined)' : ''), /\.m3u8/i.test(resolved) ? 'hls' : null, ph);
  }
}

// ── 6. Allmovieland ────────────────────────────────────────────────────
async function provAllmovieland(r, ctx) {
  if (!r.imdbId) return;
  var script = await _get('https://allmovieland.link/player.js?v=60%20128', { timeoutMs: 10000 });
  var host = _first(/const\s+AwsIndStreamDomain[^']*'([^']+)'/i, script);
  if (!host) return;
  var referer = API.allmovieland + '/';
  var page = await _get(host + '/play/' + r.imdbId, { headers: { Referer: referer }, timeoutMs: 10000 });
  var data = _first(/<script[^>]*>[\s\S]*?playlist[\s\S]*?\{([\s\S]*?)\}[\s\S]*?<\/script>/i, page);
  if (!data) return;
  var j = _parseJson('{' + data);
  if (!j) return;
  var headers = { 'X-CSRF-TOKEN': String(j.key || '') };
  var serverRes = await _get(_abs(j.file || '', host), { headers: headers, Referer: referer, timeoutMs: 10000 });
  serverRes = String(serverRes || '').replace(/,\s*\[\]/g, '');
  var servers = _parseJson(serverRes);
  if (!servers) return;
  var list = [];
  if (r.season == null) list = servers.map(function (x) { return [x.file, x.title]; });
  else {
    var se = servers.find(function (x) { return String(x.id) === String(r.season); });
    var ep = se && se.folder ? se.folder.find(function (x) { return String(x.episode) === String(r.episode); }) : null;
    if (ep && ep.folder) list = ep.folder.map(function (x) { return [x.file, x.title]; });
  }
  for (var i = 0; i < list.length; i++) {
    if (!list[i][0]) continue;
    var r2 = await _post(host + '/playlist/' + list[i][0] + '.txt', { headers: headers, timeoutMs: 10000 });
    if (r2.body) _emitH(ctx, r2.body.trim(), 1080, 'Allmovieland [' + (list[i][1] || '') + ']', 'hls', null);
  }
}

// ── 7. Hdhub4u ─────────────────────────────────────────────────────────
async function _hdhubLinks(url) {
  // Live Hdhub4u/4KHDHub pages now use greenmotors.club; older mirrors used
  // greenmountmotors / hubcdn. All of them are the same redirect wrapper.
  if (/greenmountmotors|greenmotors|hubcdn/i.test(url)) return await _wpRedirect(url);
  return url;
}
function _normTitle(s) {
  s = String(s || '');
  try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
// Typesense drops query tokens when there is no exact match, so a search for an
// IMDb id can return the latest unrelated posts. Only accept verified hits.
function _hdhubHitMatches(doc, r) {
  if (!doc) return false;
  var hitImdb = String(doc.imdb_id || '').trim().toLowerCase();
  if (hitImdb) return hitImdb === String(r.imdbId || '').trim().toLowerCase();
  var want = _normTitle(r.title);
  if (!want) return false;
  var hay = _normTitle(doc.post_title) + ' ' + _normTitle(doc.permalink);
  return hay.indexOf(want) >= 0;
}
async function _getHdhub4uStreams(url, ctx, q, size) {
  var src = await _hdhubLinks(url);
  if (src) await _loadSource('Hdhub4u', src, '', ctx, q, size);
}
async function provHdhub4u(r, ctx) {
  if (!r.imdbId) return;
  var base = await _dyn('hdhub4u');
  if (!base) return;
  var searchUrl = 'https://search.pingora.fyi/collections/post/documents/search?q=' + encodeURIComponent(r.imdbId) +
    '&query_by=post_title%2Ccategory%2Cstars%2Cdirector%2Cimdb_id&query_by_weights=4%2C2%2C2%2C2%2C4&sort_by=sort_by_date%3Adesc&limit=15&highlight_fields=none&use_cache=true&page=1';
  var j = await _getJson(searchUrl, { headers: { Referer: base + '/' }, timeoutMs: 10000 });
  if (!j || !j.hits) return;
  for (var i = 0; i < j.hits.length; i++) {
    var hitDoc = j.hits[i].document || {};
    if (!_hdhubHitMatches(hitDoc, r)) continue;
    var raw = hitDoc.permalink;
    if (!raw) continue;
    var path = String(raw).replace(/^https?:\/\/[^\/]+/i, '').replace(/^\//, '');
    var page = await _get(base + '/' + path, { timeoutMs: 10000 });
    if (!page) continue;
    if (r.season == null) {
      var links = _all(/<a[^>]*data-wpel-link=["']?external["']?[^>]*href=["']([^"']+)/gi, page, 1)
        .concat(_all(/<a[^>]*href=["']([^"']+)["'][^>]*data-wpel-link=["']?external["']?/gi, page, 1));
      links = _uniqBy(links.map(function (x) { return { url: x }; }), function (x) { return x.url; }).map(function (x) { return x.url; });
      await _parallel(links, 4, async function (l) { if (l) await _getHdhub4uStreams(l, ctx); });
    } else {
      var titleText = _text(page.match(/<h1[^>]*class="[^"]*page-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) ? page.match(/<h1[^>]*class="[^"]*page-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)[1] : '') ||
                      _text(_first(/<title[^>]*>([\s\S]*?)<\/title>/i, page));
      var sre = new RegExp('(?:Season\\s*0*|S0*)' + r.season + '\\b', 'i');
      if (!sre.test(titleText)) continue;
      var targetEp = r.episode || 1;
      var epRe = new RegExp('\\bEPiSODE\\s*0*' + targetEp + '\\b', 'i');
      var anyEp = /\bEPiSODE\s*\d+\b/i;
      var pos = page.search(epRe);
      if (pos < 0) continue;
      var chunk = page.slice(pos, pos + 12000);
      var stop = chunk.search(anyEp);
      if (stop > 0 && chunk.slice(stop + 5).search(anyEp) >= 0) { /* keep first block */ }
      var found = _all(/<a[^>]*data-wpel-link=["']?external["']?[^>]*href=["']([^"']+)/gi, chunk, 1)
        .concat(_all(/<a[^>]*href=["']([^"']+)["'][^>]*data-wpel-link=["']?external["']?/gi, chunk, 1));
      var uniq = _uniqBy(found.map(function (x) { return { url: x }; }), function (x) { return x.url; });
      await _parallel(uniq, 4, async function (item) {
        var u = item.url;
        if (/whatsapp\.com|telegram|catimages/i.test(u)) return;
        await _getHdhub4uStreams(u, ctx);
      });
    }
  }
}

// ── 8. Hexa ────────────────────────────────────────────────────────────
async function provHexa(r, ctx) {
  if (!r.tmdbId) return;
  var key = _randHex(32);
  var url = r.season == null ? API.hexa + '/api/tmdb/movie/' + r.tmdbId + '/images'
    : API.hexa + '/api/tmdb/tv/' + r.tmdbId + '/season/' + r.season + '/episode/' + r.episode + '/images';
  var tokRes = await _getJson(MULTI + '/enc-hexa', { timeoutMs: 10000 });
  var token = tokRes && tokRes.result ? tokRes.result.token : '';
  if (!token) return;
  var headers = { 'User-Agent': UA, Accept: 'text/plain', 'X-Api-Key': key, 'X-Fingerprint-Lite': 'e9136c41504646444', Referer: 'https://hexa.su/', 'X-Cap-Token': token };
  var enc = await _get(url, { headers: headers, timeoutMs: 10000 });
  if (!enc) return;
  var dec = await _jsonPost(MULTI + '/dec-hexa', { text: enc, key: key }, { 'Content-Type': 'application/json' }, 12000);
  var result = dec && dec.result ? dec.result : null;
  if (!result || !result.sources) return;
  for (var i = 0; i < result.sources.length; i++) {
    var s = result.sources[i];
    if (!s || !s.url) continue;
    _emitH(ctx, s.url, 0, 'Hexa ' + _cap(s.server || ''), /m3u8/i.test(s.url) ? 'hls' : null, { Referer: 'https://hexa.su/' });
  }
}

// ── 9. Fshare (movies only upstream) ───────────────────────────────────
async function provFshare(r, ctx) {
  if (r.season != null || !r.title || !r.imdbId) return;
  var slug = _slug2(r.title + ' episode 1 ' + r.imdbId);
  var url = API.fshare + '/w/' + slug;
  var doc = await _get(url, { timeoutMs: 10000 });
  if (!doc) return;
  var token = _first(/Movie\.setSource\('([^']+)'/i, doc);
  var trailer = _first(/<input[^>]*id="trailer"[^>]*value="([^"]*)"/i, doc);
  if (!token || trailer === '') return;
  var j = await _getJson(API.fshare + '/api/file/' + token + '/source?trailer=' + encodeURIComponent(trailer) + '&type=watch', { timeoutMs: 10000 });
  if (!j || !j.data || !j.data.file) return;
  var f = j.data.file;
  var sources = (f.sources || []).concat.apply(f.sources || [], f.alternatives || []);
  var seen = {}, headers = { referer: url, 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36' };
  for (var i = 0; i < sources.length; i++) {
    var s = sources[i]; if (!s || !s.src || seen[s.id]) continue; seen[s.id] = true;
    _emitH(ctx, API.fshare + s.src, parseInt(s.quality, 10) || 0, 'Fshare', 'mp4', headers);
  }
}

// ── 10. Videasy ────────────────────────────────────────────────────────
async function provVideasy(r, ctx) {
  if (!r.title) return;
  var decodeServers = ['myflixerzupcloud','downloader2','m4uhd','hdmovie','cdn','superflix','lamovie','jett','tejo','neon2','ym'];
  var headers = { Accept: '*/*', 'User-Agent': UA, Origin: 'https://player.videasy.to', Referer: 'https://player.videasy.to/' };
  var seedJson = await _getJson(API.videasy + '/seed?mediaId=' + r.tmdbId, { headers: headers, timeoutMs: 10000 });
  var seed = seedJson && seedJson.seed ? seedJson.seed : '';
  if (!seed) return;
  var encTitle = _quote(_quote(r.title));
  var season = r.season;
  await _parallel(decodeServers, 4, async function (server) {
    var url = season == null
      ? API.videasy + '/' + server + '/sources-with-title?title=' + encTitle + '&mediaType=movie&year=' + (r.year || '') + '&tmdbId=' + r.tmdbId + '&imdbId=' + (r.imdbId || '') + '&enc=2&seed=' + encodeURIComponent(seed)
      : API.videasy + '/' + server + '/sources-with-title?title=' + encTitle + '&mediaType=tv&year=' + (r.year || '') + '&tmdbId=' + r.tmdbId + '&episodeId=' + r.episode + '&seasonId=' + r.season + '&imdbId=' + (r.imdbId || '') + '&enc=2&seed=' + encodeURIComponent(seed);
    var encData = await _get(url, { headers: headers, timeoutMs: 10000 });
    if (!encData) return;
    var dec = await _jsonPost(MULTI + '/dec-videasy', { text: encData, id: r.tmdbId, seed: seed }, {}, 12000);
    var result = dec && dec.result ? dec.result : null;
    if (!result) return;
    var cap = _cap(server);
    (result.sources || []).forEach(function (s) {
      if (!s || !s.url) return;
      _emitH(ctx, s.url, _quality(s.quality), 'Videasy[' + cap + '] ' + (s.quality || ''), /\.m3u8/i.test(s.url) ? 'hls' : (/\.(mp4|mkv)/i.test(s.url) ? 'mp4' : null), headers);
    });
    (result.subtitles || []).forEach(function (s) { if (s && s.url) ctx.sub(s.language || 'Unknown', s.url, 'Videasy'); });
  });
}

// ── 11. VaPlayer ───────────────────────────────────────────────────────
async function provVaplayer(r, ctx) {
  if (!r.imdbId) return;
  var referer = 'https://nextgencloudfabric.com/';
  var url = r.season == null ? API.vaplayer + '/api.php?imdb=' + r.imdbId + '&type=movie'
    : API.vaplayer + '/api.php?imdb=' + r.imdbId + '&type=tv&season=' + r.season + '&episode=' + r.episode;
  var j = await _getJson(url, { headers: { Referer: referer }, timeoutMs: 12000 });
  if (!j) return;
  var data = j.data || j;
  (data.stream_urls || []).forEach(function (u) { _emitH(ctx, u, 0, 'VaPlayer', /m3u8/i.test(u) ? 'hls' : null, { Referer: referer }); });
  (j.default_subs || []).forEach(function (s) { if (s && s.url) ctx.sub(s.lang || s.code || 'Unknown', s.url, 'VaPlayer'); });
}

// ── 12. Vidzee ─────────────────────────────────────────────────────────
async function provVidzee(r, ctx) {
  if (!r.tmdbId) return;
  var secret = _b64d('QTdrUDl4TTJRdjhMcjROejFIdDZZYzNCdzVKZjBEc1U=');
  var referer = API.vidzee + '/';
  var servers = [0, 1, 2, 4, 5, 6, 7];
  for (var i = 0; i < servers.length; i++) {
    var sr = servers[i];
    var url = r.season == null ? API.vidzee + '/api/server?id=' + r.tmdbId + '&sr=' + sr
      : API.vidzee + '/api/server?id=' + r.tmdbId + '&sr=' + sr + '&ss=' + r.season + '&ep=' + r.episode;
    var j = await _getJson(url, { timeoutMs: 10000 });
    if (!j) continue;
    var gh = {}; if (j.headers) for (var k in j.headers) if (Object.prototype.hasOwnProperty.call(j.headers, k)) gh[k] = j.headers[k];
    var urls = j.url || [];
    for (var u = 0; u < urls.length; u++) {
      var o = urls[u]; if (!o || !o.link) continue;
      var final = _decryptVidzee(o.link, secret);
      if (!final || final.indexOf('https:') < 0) continue;
      var name = o.name || '', t = (o.type || 'hls').toLowerCase(), lang = o.lang || 'Unknown', flag = o.flag || '';
      var hh = Object.assign({}, gh);
      var rf = hh.referer || hh.Referer || referer;
      _emitH(ctx, final, 1080, 'VidZee ' + name + ' (' + lang + (flag ? ' - ' + flag : '') + ')', t === 'hls' ? 'hls' : 'mp4', hh, null, rf);
    }
    (j.tracks || []).forEach(function (t2) { if (t2 && t2.url) ctx.sub(t2.lang || 'Unknown', t2.url, 'Vidzee'); });
  }
}

// ── 13. Peachify ───────────────────────────────────────────────────────
async function provPeachify(r, ctx) {
  if (!r.tmdbId) return;
  var headers = { Origin: API.peachifyBase, Referer: API.peachifyBase + '/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36' };
  var servers = ['multi', 'hr', 'holly', 'air', 'moviebox'];
  var tasks = servers.map(function (server) {
    return { server: server, url: r.season == null ? API.peachify + '/' + server + '/movie/' + r.tmdbId : API.peachify + '/' + server + '/tv/' + r.tmdbId + '/' + r.season + '/' + r.episode };
  });
  await _parallel(tasks, 5, async function (t) {
    var text = await _get(t.url, { headers: headers, timeoutMs: 6000 });
    if (!text) return null;
    var j = _parseJson(text);
    var enc = j && j.data ? j.data : '';
    if (!enc) return null;
    var dec = _decryptPeachify(enc);
    if (!dec) return null;
    var data = _parseJson(dec);
    if (!data || !data.sources) return null;
    var provider = _cap(data.providerName || 'Peachify');
    for (var s = 0; s < data.sources.length; s++) {
      var src = data.sources[s]; if (!src || !src.url) continue;
      var raw = src.url;
      var isProxy = raw.indexOf('/m3u8-proxy') >= 0 || raw.indexOf('/mp4-proxy') >= 0;
      var finalUrl = raw, ph = {};
      if (isProxy) {
        var q = _queryParams(raw);
        finalUrl = q.url || raw;
        if (q.headers) { try { ph = JSON.parse(q.headers) || {}; } catch (e) { ph = {}; } }
      }
      var sh = src.headers || {};
      var rh = ph.referer || sh.referer || API.peachifyBase + '/';
      var oh = ph.origin || sh.origin || API.peachifyBase;
      var uh = ph['user-agent'] || sh['user-agent'] || UA;
      _emitH(ctx, finalUrl, parseInt(src.quality, 10) || 0, 'Peachify[' + provider + ']' + (src.dub ? ' • ' + src.dub : ''), src.type === 'hls' ? 'hls' : null, { Origin: oh, Referer: rh, 'User-Agent': uh });
    }
    return null;
  });
}

// ── 14. VidFastPro ─────────────────────────────────────────────────────
async function provVidfastpro(r, ctx) {
  if (!r.tmdbId) return;
  var base = API.vidfast;
  var url = r.season == null ? base + '/movie/' + r.tmdbId + '/' : base + '/tv/' + r.tmdbId + '/' + r.season + '/' + r.episode + '/';
  var headers = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36', Referer: base + '/' };
  var response = await _get(url, { headers: headers, timeoutMs: 12000 });
  var enc = _first(/\\?"(?:en|token)\\?":\\?"(.*?)\\?"/i, response);
  if (!enc) return;
  // Two-stage enc-dec.app flow (API changed: requires stage param)
  var s1 = await _getJson(MULTI + '/enc-vidfast?text=' + encodeURIComponent(enc) + '&stage=1', { timeoutMs: 12000 });
  if (!s1 || !s1.result || !s1.result.stage1) return;
  headers['X-CSRF-Token'] = s1.result.token || '';
  var s1text = await _post(s1.result.stage1, { headers: headers, timeoutMs: 12000 });
  if (!s1text || !s1text.body) return;
  var s2 = await _getJson(MULTI + '/enc-vidfast?text=' + encodeURIComponent(s1text.body) + '&stage=2', { timeoutMs: 12000 });
  var d = s2 && s2.result ? s2.result : null;
  if (!d || !d.servers || !d.stream) return;
  headers['X-CSRF-Token'] = d.token || '';
  var serversEnc = await _post(d.servers, { headers: headers, timeoutMs: 12000 });
  var dec = await _jsonPost(MULTI + '/dec-vidfast', { text: serversEnc.body }, {}, 12000);
  var list = dec && dec.result ? dec.result : null;
  if (!list) return;
  for (var i = 0; i < list.length; i++) {
    var server = list[i]; if (!server || !server.data) continue;
    var finalUrl = d.stream + '/' + server.data;
    var streamEnc = await _post(finalUrl, { headers: headers, timeoutMs: 12000 });
    if (!streamEnc.body) continue;
    var sj = await _jsonPost(MULTI + '/dec-vidfast', { text: streamEnc.body }, {}, 12000);
    var stream = sj && sj.result ? sj.result : null;
    if (!stream) continue;
    (stream.tracks || []).forEach(function (t) { if (t && t.file) ctx.sub(t.label || 'Unknown', t.file, 'Vidfast'); });
    if (!stream.url) continue;
    var is4k = stream.is4kAvailable === true || String(server.description || '').toLowerCase().indexOf('4k') >= 0;
    _emitH(ctx, stream.url, is4k ? 2160 : 1080, 'Vidfast[' + (server.name || '') + '] ' + (server.description || ''), /\.m3u8/i.test(stream.url) ? 'hls' : 'mp4', headers);
  }
}

// ── 15. Cinejoy ────────────────────────────────────────────────────────
function _b64urlNoPad(bytes) {
  var s = _b64Bytes(bytes);
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlBytes(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return _bytesB64(s);
}
async function provCinejoy(r, ctx) {
  var isSeries = r.season != null && r.episode != null;
  var type = isSeries ? 'series' : 'movie';
  var headers = { Accept: '*/*', Origin: API.cinejoyBase, Referer: API.cinejoyBase + '/', 'User-Agent': UA };
  var serversRes = await _getJson(API.cinejoy + '/servers', { headers: headers, timeoutMs: 10000 });
  var servers = serversRes && serversRes.servers ? serversRes.servers.map(function (x) { return x.name; }).filter(Boolean) : [];
  if (!servers.length) return;
  for (var i = 0; i < servers.length; i++) {
    var server = servers[i];
    var target = API.cinejoy + '/?title=' + _quote(r.title) + '&type=' + type + '&year=' + (r.year || '') + '&imdb=' + (r.imdbId || '') + '&tmdb=' + (r.tmdbId || '') + '&server=' + encodeURIComponent(server);
    if (isSeries) target += '&season=' + r.season + '&episode=' + r.episode;
    var encRes = await _getJson(MULTI + '/enc-cinejoy?url=' + encodeURIComponent(target), { timeoutMs: 12000 });
    if (!encRes || encRes.status !== 200 || !encRes.result) continue;
    var dataStr = encRes.result.data, state = encRes.result.state;
    if (!dataStr || !state) continue;
    var decoded = _b64urlBytes(dataStr);
    var post = await _fetch(API.cinejoy + '/g', { method: 'POST', headers: Object.assign({}, headers, { 'Content-Type': 'application/octet-stream' }), body: decoded, binary: true, timeoutMs: 15000 });
    var bytes = post.bytes || _utf8Bytes(post.body || '');
    var b64 = _b64urlNoPad(bytes);
    var decRes = await _jsonPost(MULTI + '/dec-cinejoy', { text: b64, state: state }, {}, 15000);
    var result = decRes && decRes.result ? decRes.result.data : null;
    if (!result || result.error) continue;
    var streams = result.stream || [];
    for (var s = 0; s < streams.length; s++) {
      var st = streams[s]; if (!st) continue;
      if (st.type === 'hls' && st.playlist) _emitH(ctx, st.playlist, 1080, 'Cinejoy - ' + _cap(server), 'hls', { Referer: headers.Referer });
      else if (st.type === 'file' && st.qualities) {
        for (var qk in st.qualities) if (Object.prototype.hasOwnProperty.call(st.qualities, qk)) {
          var qd = st.qualities[qk];
          if (!qd || !qd.url || qd.url.indexOf('https') < 0) continue;
          var qv = qk === '4k' ? 2160 : (parseInt(qk, 10) || 0);
          _emitH(ctx, qd.url, qv, 'Cinejoy - ' + _cap(server) + ' (' + qk + ')', /\.m3u8/i.test(qd.url) ? 'hls' : null, { Referer: headers.Referer });
        }
      }
      (st.captions || []).forEach(function (c) { if (c && c.url) ctx.sub(c.language || c.id || 'Unknown', c.url, 'Cinejoy'); });
    }
  }
}

// ── 16. Vidcore ────────────────────────────────────────────────────────
async function provVidcore(r, ctx) {
  if (!r.tmdbId) return;
  var headers = { 'User-Agent': UA, Referer: API.vidcore + '/', 'X-Requested-With': 'XMLHttpRequest' };
  var base = r.season == null ? API.vidcore + '/movie/' + r.tmdbId : API.vidcore + '/tv/' + r.tmdbId + '/' + r.season + '/' + r.episode;
  var page = await _get(base, { timeoutMs: 12000 });
  var enc = _first(/\\?"(?:en|token)\\?":\\?"(.*?)\\?"/i, page);
  if (!enc) return;
  // Two-stage enc-dec.app flow (API changed: requires stage param)
  var s1 = await _getJson(MULTI + '/enc-vidcore?text=' + encodeURIComponent(enc) + '&stage=1', { timeoutMs: 12000 });
  if (!s1 || !s1.result || !s1.result.stage1) return;
  headers['X-CSRF-Token'] = s1.result.token || '';
  var s1text = await _post(s1.result.stage1, { headers: headers, timeoutMs: 12000 });
  if (!s1text || !s1text.body) return;
  var s2 = await _getJson(MULTI + '/enc-vidcore?text=' + encodeURIComponent(s1text.body) + '&stage=2', { timeoutMs: 12000 });
  var d = s2 && s2.result ? s2.result : null;
  if (!d || !d.servers || !d.stream) return;
  headers['X-CSRF-Token'] = d.token || '';
  var serversEnc = await _post(d.servers, { headers: headers, timeoutMs: 12000 });
  var dec = await _jsonPost(MULTI + '/dec-vidcore', { text: serversEnc.body }, headers, 12000);
  var list = dec && dec.result ? dec.result : null;
  if (!list) return;
  for (var i = 0; i < list.length; i++) {
    var server = list[i]; if (!server || !server.data) continue;
    var se = await _post(d.stream + '/' + server.data, { headers: headers, timeoutMs: 12000 });
    var sj = await _jsonPost(MULTI + '/dec-vidcore', { text: se.body }, {}, 12000);
    var stream = sj && sj.result ? sj.result : null;
    if (!stream || !stream.url) continue;
    _emitH(ctx, stream.url, 0, 'Vidcore - ' + _cap(server.name || ''), /\.m3u8/i.test(stream.url) ? 'hls' : null, { Referer: API.vidcore + '/' });
    (stream.tracks || []).forEach(function (t) { if (t && t.file) ctx.sub(t.label || 'Unknown', t.file, 'Vidcore'); });
  }
}

// ── 17. Av1encodes ─────────────────────────────────────────────────────
async function provAv1encodes(r, ctx) {
  if (!r.title) return;
  var slug = String(r.title).toLowerCase().trim().replace(/\s+/g, '-').replace(/:/g, '');
  var slug2 = r.season == null ? 'movie/1920%20x%201080' : r.season + '/1920%20x%201080';
  var url = API.av1 + '/episodes/' + slug + '/' + slug2;
  var headers = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8', dnt: '1', priority: 'u=0, i', referer: API.av1 + '/',
    'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Linux"',
    'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin', 'sec-fetch-user': '?1',
    'sec-gpc': '1', 'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Linux; Android 9; moto e(6) plus) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.86 Mobile Safari/537.36'
  };
  var page = await _get(url, { headers: headers, timeoutMs: 12000 });
  if (!page) return;
  var target = null;
  if (r.season != null && r.episode != null) {
    var blocks = _all(/<div[^>]*class="[^"]*episode-item[^"]*"[\s\S]*?<\/div>/gi, page, 0);
    var re = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<span[^>]*class="[^"]*episode-label[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, m;
    while ((m = re.exec(page)) !== null) {
      var num = parseInt(String(m[2]).replace(/\D/g, ''), 10);
      if (num === r.episode) { target = m[1]; break; }
    }
  } else target = _first(/<div[^>]*class="[^"]*episode-item[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i, page);
  if (!target) return;
  var fileName = String(target).split('/').pop().split('?')[0];
  var epText = await _get(API.av1 + target, { headers: headers, timeoutMs: 12000 });
  var ddl = _first(/'X-DDL-Token'\s*:\s*"([^"]+)"/i, epText);
  if (!ddl) return;
  var uh = Object.assign({}, headers, { accept: 'application/json', 'x-ddl-token': ddl });
  var j = await _getJson(API.av1 + '/get_ddl/' + fileName, { headers: uh, timeoutMs: 12000 });
  if (!j || !j.success || !j.stream_link) return;
  var dual = false;
  var audio = j.audio_details && j.audio_details.audio ? j.audio_details.audio : [];
  for (var a = 0; a < audio.length; a++) if (audio[a] && String(audio[a].language || '').toLowerCase() === 'english') { dual = true; break; }
  var tag = dual ? '[DUAL]' : '[SUB]';
  var vh = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-GB,en;q=0.9', dnt: '1', priority: 'u=0, i',
    'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138"', 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Linux"',
    'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site', 'sec-gpc': '1',
    'upgrade-insecure-requests': '1',
    'user-agent': 'Mozilla/5.0 (Linux; Android 11; Mi 9T Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Mobile Safari/537.36 EdgA/95.0.1020.48'
  };
  _emitH(ctx, API.av1 + j.stream_link, 1080, 'Av1encodes ' + tag + ' ' + (j.file_size || ''), 'mp4', vh);
}

// ── 18. Castle (APK credentials must be configured) ────────────────────
function _castleDecrypt(cipher, b64key) {
  try {
    var pepper = _utf8Bytes('T!BgJB');
    var keyWords = _bytesB64(b64key);
    var combined = keyWords.concat(pepper);
    var key = combined.slice(0, 16);
    while (key.length < 16) key.push(0);
    return _bytesUtf8(_aesCbcDecrypt(key, key, _bytesB64(cipher)));
  } catch (e) { return null; }
}
async function _castleRequest(url, securityKey, method, body) {
  var headers = { 'User-Agent': 'okhttp/4.9.3', Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', Connection: 'Keep-Alive', Referer: API.castle + '/' };
  var res;
  if (method === 'POST' && body) res = await _postJson(url, body, { headers: headers, timeoutMs: 15000 });
  else res = await _fetch(url, { headers: headers, timeoutMs: 15000 });
  var text = String(res.body || '').trim();
  var cipher = text;
  var tmp = _parseJson(text);
  if (tmp && typeof tmp.data === 'string') cipher = tmp.data;
  var dec = _castleDecrypt(cipher, securityKey);
  if (!dec) return null;
  var j = _parseJson(dec);
  return j && j.data && typeof j.data === 'object' ? j.data : j;
}
async function provCastle(r, ctx) {
  if (!r.title) return;
  var key = _str('castleKey', '');
  if (!key) return;
  var pkg = 'com.external.castle', channel = 'IndiaA', ct = '1', lang = 'en-US';
  try {
    var secRes = await _get(API.castle + '/v0.1/system/getSecurityKey/1?channel=' + channel + '&clientType=' + ct + '&lang=' + lang, {
      headers: { 'User-Agent': 'okhttp/4.9.3', Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9', Connection: 'Keep-Alive', Referer: API.castle + '/' }, timeoutMs: 12000
    });
    var secJson = _parseJson(secRes);
    var securityKey = secJson && secJson.data ? secJson.data : '';
    if (!securityKey) return;
    var searchUrl = API.castle + '/film-api/v1.1.0/movie/searchByKeyword?channel=IndiaA&clientType=' + ct + '&keyword=' + _quote(r.title) + '&lang=' + lang + '&mode=1&packageName=' + pkg + '&page=1&size=30';
    var searchData = await _castleRequest(searchUrl, securityKey);
    if (!searchData || !searchData.rows) return;
    var rows = searchData.rows, movieId = '';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], rt = row.title || row.name || '';
      if (String(rt).toLowerCase().indexOf(String(r.title).toLowerCase()) >= 0 || String(r.title).toLowerCase().indexOf(String(rt).toLowerCase()) >= 0) {
        movieId = row.id || row.redirectId || row.redirectIdStr || '';
        if (movieId) break;
      }
    }
    if (!movieId && rows.length) movieId = rows[0].id || rows[0].redirectId || rows[0].redirectIdStr || '';
    if (!movieId) return;
    var details = await _castleRequest(API.castle + '/film-api/v1.9.9/movie?channel=' + channel + '&clientType=' + ct + '&lang=' + lang + '&movieId=' + movieId + '&packageName=' + pkg, securityKey);
    if (!details) return;
    var effective = movieId;
    if (r.season != null && r.episode != null && details.seasons) {
      for (var s = 0; s < details.seasons.length; s++) {
        var season = details.seasons[s];
        if (parseInt(season.number, 10) === r.season && season.movieId && season.movieId !== movieId) {
          details = await _castleRequest(API.castle + '/film-api/v1.9.9/movie?channel=' + channel + '&clientType=' + ct + '&lang=' + lang + '&movieId=' + season.movieId + '&packageName=' + pkg, securityKey);
          effective = season.movieId;
          break;
        }
      }
    }
    var episodes = details && details.episodes ? details.episodes : null;
    if (!episodes) return;
    var episodeId = '', target = null;
    if (r.season != null && r.episode != null) {
      for (var e = 0; e < episodes.length; e++) if (parseInt(episodes[e].number, 10) === r.episode) { episodeId = episodes[e].id; target = episodes[e]; break; }
    } else if (episodes.length) { target = episodes[0]; episodeId = target.id; }
    if (!episodeId || !target) return;
    var videoUrl = API.castle + '/film-api/v2.0.1/movie/getVideo2?clientType=' + ct + '&packageName=' + pkg + '&channel=' + channel + '&lang=' + lang;
    var body = { mode: '1', appMarket: 'GuanWang', clientType: ct, woolUser: 'false', apkSignKey: key, androidVersion: '13', movieId: effective, episodeId: episodeId, isNewUser: 'true', resolution: '2', packageName: pkg };
    var videoData = await _castleRequest(videoUrl, securityKey, 'POST', body);
    if (!videoData || !videoData.videoUrl) return;
    _emitH(ctx, videoData.videoUrl, 0, 'Castle Auto (USE VLC)', 'hls', { Referer: API.castle });
    (videoData.subtitles || []).forEach(function (sub) {
      if (sub && sub.url) ctx.sub(sub.abbreviate || sub.title || 'English', sub.url, 'Castle');
    });
  } catch (e) { console.warn('CineStream Castle failed: ' + (e && e.message || e)); }
}

// ── 19. Reanime ────────────────────────────────────────────────────────
async function provReanime(r, ctx) {
  if (!r.anilistId) return;
  var headers = { Referer: API.reanime + '/', 'User-Agent': UA };
  var j = await _getJson(API.reanime + '/api/flix/' + r.anilistId + '/' + (r.absolute || r.episode || 1), { headers: headers, timeoutMs: 12000 });
  if (!j || !j.success) return;
  for (var i = 0; i < (j.servers || []).length; i++) {
    var server = j.servers[i]; if (!server || !server.dataLink) continue;
    await _loadSource('Reanime[' + _cap(server.dataType || '') + ']', server.dataLink, '', ctx);
  }
}

// ── 20. Just4Anime ─────────────────────────────────────────────────────
async function provJust4anime(r, ctx) {
  if (!r.anilistId || !r.episode) return;
  var headers = { Referer: API.just4animeBase + '/', 'User-Agent': UA };
  var j = await _getJson(API.just4anime + '/meta/availability/' + r.anilistId + '/servers', { headers: headers, timeoutMs: 12000 });
  var servers = j && j.data ? j.data.servers : null;
  if (!servers) return;
  for (var i = 0; i < servers.length; i++) {
    var server = servers[i];
    if (!server || !server.hasEpisode || !server.code) continue;
    var types = server.types || [];
    for (var t = 0; t < types.length; t++) {
      var type = types[t].replace('h-sub', 'hsub');
      var meta = await _getJson(API.just4anime + '/meta/sources/' + r.anilistId + '?provider=' + encodeURIComponent(server.code) + '&num=' + r.episode + '&type=' + encodeURIComponent(type), { headers: headers, timeoutMs: 12000 });
      var md = meta && meta.data ? meta.data : null;
      if (!md) continue;
      (md.subtitles || []).forEach(function (s) { if (s && s.url) ctx.sub(s.language || s.lang || 'English', s.url, 'Just4Anime'); });
      var label = 'Just4Anime [' + _cap(server.displayName || server.code) + '] [' + _cap(type) + ']';
      (md.sources || []).forEach(function (src) {
        if (!src || !src.url) return;
        var sh = src.headers || {};
        var rf = sh.referer || API.just4animeBase + '/';
        _emitH(ctx, src.url, _quality(src.quality || ''), label, (src.isM3U8 || /\.m3u8/i.test(src.url)) ? 'hls' : null, sh, null, rf);
      });
      (md.iframe || []).forEach(function (fr) { if (fr && fr.url) _loadSource(label, fr.url, API.just4anime + '/', ctx); });
    }
  }
}

// ── Zink links helper ──────────────────────────────────────────────────
async function _zinkLinks(url) {
  var out = [];
  try {
    var page = await _get(url, { timeoutMs: 12000 });
    if (!page) return out;
    var title = _text(_first(/<h1[^>]*class="[^"]*file-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i, page));
    var randomId = _first(/generateDownloadLink\(['"]([^'"]+)/i, page);
    var ajax = _first(/(https:\/\/[^"'\s]+ajax_generate_token\.php)/i, page);
    var dl = _first(/(https:\/\/[^"'\s]+\/dl\/)/i, page);
    if (!randomId || !ajax || !dl) return out;
    var token = '';
    for (var a = 0; a < 3 && !token; a++) {
      var tr = await _postForm(ajax + '?random_id=' + encodeURIComponent(randomId), { random_id: randomId }, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, timeoutMs: 10000 });
      var tj = _parseJson(tr.body);
      if (tj && tj.token) token = tj.token;
    }
    if (!token) return out;
    var genUrl = dl + token;
    var gen = await _get(genUrl, { timeoutMs: 12000 });
    var re = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
    while ((m = re.exec(gen)) !== null) {
      if (!/mirror-buttons/i.test(gen.slice(Math.max(0, m.index - 400), m.index))) continue;
      var href = m[1].trim(); if (!href) continue;
      var name = _text(m[2]).replace(/Generate/gi, '').trim();
      out.push({ name: name, url: href, title: title });
    }
    var workerBtn = _first(/<[^>]*id="worker-btn"[^>]*onclick="([^"]*)"/i, gen);
    var workerId = _first(/handleServerRequest\(['"]worker['"]\s*,\s*['"]([^'"]+)/i, workerBtn);
    var handler = _first(/SERVER_HANDLER_URL\s*=\s*["']([^"']+)["']/i, gen);
    if (workerId && handler) {
      var wj = await _jsonPost(handler, { server: 'worker', random_id: workerId }, { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json', Origin: genUrl.split('/dl/')[0], Referer: genUrl }, 12000);
      var wu = wj ? (wj.url || wj.download || '') : '';
      if (wu) out.push({ name: 'WORKER', url: wu, title: title });
    }
  } catch (e) { console.warn('CineStream Zink failed: ' + (e && e.message || e)); }
  return _uniqBy(out, function (x) { return x.url; });
}
async function _getZinkLinks(url, ctx) {
  var links = await _zinkLinks(url);
  for (var i = 0; i < links.length; i++) {
    var link = links[i];
    if (/worker/i.test(link.name)) _emitH(ctx, link.url, _quality(link.title), 'Zinkmovies Worker' + _simplify(link.title), null, null);
    else await _loadSource('Zinkmovies', link.url, '', ctx);
  }
}

// ── 21. Zinkmovies ─────────────────────────────────────────────────────
function _zinkSeasonLinks(content, season) {
  var out = [], inTarget = false;
  var re = /<(div|section|article)\b([^>]*)>([\s\S]*?)<\/\1>/gi, m;
  // simple sequential scan over classed blocks
  var tagRe = /<div\b([^>]*)>([\s\S]*?)<\/div>/gi;
  while ((m = tagRe.exec(content)) !== null) {
    var attrs = m[1], inner = m[2];
    if (/class="[^"]*lgtagmessage[^"]*"/i.test(attrs)) {
      inTarget = new RegExp('Season\\s+0*' + season + '\\b', 'i').test(_text(inner));
    } else if (/class="[^"]*movie-button-container[^"]*"/i.test(attrs) && inTarget) {
      var href = _first(/<a[^>]*class="[^"]*movie-simple-button[^"]*"[^>]*href="([^"]+)"/i, inner) ||
                 _first(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*movie-simple-button[^"]*"/i, inner);
      if (href) out.push(href);
    }
  }
  return out;
}
async function provZinkmovies(r, ctx) {
  if (!r.title) return;
  var base = await _dyn('zinkmovies');
  if (!base) return;
  var search = await _get(base + '/?s=' + _quote(r.title + ' ' + (r.year || '')), { timeoutMs: 12000 });
  if (!search) return;
  var typeSpan = r.season != null ? 'tvshows' : 'movies';
  var articles = _all(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi, search, 0);
  var urls = [];
  for (var i = 0; i < articles.length; i++) {
    var art = articles[i];
    if (!new RegExp('class="[^"]*' + typeSpan + '[^"]*"', 'i').test(art)) continue;
    var titleA = _first(/<div[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i, art);
    var tt = _text(_first(/<div[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i, art));
    var yr = _text(_first(/<span[^>]*class="[^"]*year[^"]*"[^>]*>([\s\S]*?)<\/span>/i, art));
    if (tt.toLowerCase().indexOf(String(r.title).toLowerCase()) < 0) continue;
    if (r.year && yr && parseInt(yr, 10) !== r.year) continue;
    if (titleA) urls.push(titleA);
  }
  if (!urls.length) return;
  urls = _uniqBy(urls.map(function (u) { return { u: u }; }), function (x) { return x.u; }).map(function (x) { return x.u; });
  for (var u = 0; u < urls.length; u++) {
    var detail = await _get(urls[u], { timeoutMs: 12000 });
    if (!detail) continue;
    var content = _first(/<div[^>]*class="[^"]*wp-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<\/article>|$)/i, detail) || detail;
    if (r.season != null && r.episode != null) {
      var seasonLinks = _zinkSeasonLinks(content, r.season);
      for (var s = 0; s < seasonLinks.length; s++) {
        var epPage = await _get(seasonLinks[s], { timeoutMs: 12000 });
        var re = /<a[^>]*class="[^"]*maxbutton-download-now[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, m;
        while ((m = re.exec(epPage)) !== null) {
          var num = parseInt(_first(/EPISODE\s*-\s*0*(\d+)/i, _text(m[2])), 10);
          if (num === r.episode) { await _getZinkLinks(m[1], ctx); break; }
        }
      }
    } else {
      var btns = _all(/<div[^>]*class="[^"]*movie-button-container[^"]*"[^>]*>[\s\S]*?<a[^>]*class="[^"]*movie-simple-button[^"]*"[^>]*href="([^"]+)"/gi, content, 1);
      for (var b = 0; b < btns.length; b++) if (btns[b]) await _getZinkLinks(btns[b], ctx);
    }
  }
}

// ── 22. GramCinema (Bollywood) ─────────────────────────────────────────
async function provBollywood(r, ctx) {
  var token = _str('gramcinemaToken', '');
  if (!token || !r.title) return;
  if (!r.season) { /* movies and series both handled below */ }
  var es = _epSlug(r.season, r.episode);
  var titleSlug = String(r.title).replace(/ /g, '.');
  var headers = {
    Origin: API.gramBase, Referer: API.gramBase + '/', 'User-Agent': UA, Authorization: 'Bearer ' + token
  };
  var url = r.season == null
    ? API.gramApi + '/mix_media_files/search?q=' + encodeURIComponent(titleSlug + '.' + (r.year || '')) + '&page=1'
    : API.gramApi + '/mix_media_files/search?q=' + encodeURIComponent(titleSlug + '.S' + es[0] + 'E' + es[1]) + '&page=1';
  var j = await _getJson(url, { headers: headers, timeoutMs: 30000 });
  if (!j || !j.files) return;
  var files = j.files.filter(function (x) { return String(x.file_name || '').indexOf('.' + titleSlug) < 0; }).slice(0, 5);
  for (var i = 0; i < files.length; i++) {
    var item = files[i];
    var lr = await _getJson(API.gramApi + '/genLink?type=mix_media&id=' + item.id, { headers: headers, timeoutMs: 20000 });
    if (!lr || !lr.url) continue;
    var simp = _simplify((item.file_name || '') + ' ' + _formatSize(item.file_size));
    _emitH(ctx, lr.url, _quality(item.file_name || ''), '[GramCinema] ' + (item.file_name || '') + (simp ? ' ' + simp : ''), 'mp4', { Referer: API.gramBase });
  }
}

  // ── 23/24. VegaMovies & RogMovies ──────────────────────────────────────
async function _formFields(html) {
  var form = (html.match(/<form\b[^>]*id=["']landing["'][^>]*>[\s\S]*?<\/form>/i) || [''])[0];
  var action = _first(/action=["']([^"']+)["']/i, form);
  var fields = {}, re = /<input\b[^>]*>/gi, m;
  while ((m = re.exec(form)) !== null) {
    var name = _first(/name=["']([^"']+)["']/i, m[0]);
    var value = _first(/value=["']([^"']*)["']/i, m[0]);
    if (name) fields[name] = value;
  }
  return { action: action, fields: fields };
}
async function _bypassHrefli(url) {
  try {
    var host = _baseUrl(url);
    var html = await _get(url, { timeoutMs: 12000 });
    var f = _formFields(html);
    if (!f.action) return null;
    var formUrl = _abs(f.action, url);
    var r = await _postForm(formUrl, f.fields, { timeoutMs: 12000 });
    f = _formFields(r.body);
    if (!f.action) return null;
    formUrl = _abs(f.action, formUrl);
    r = await _postForm(formUrl, f.fields, { timeoutMs: 12000 });
    var token = _first(/\?go=([^"'\s]+)/i, r.body);
    if (!token) return null;
    var cookies = f.fields['_wp_http2'] ? { Cookie: token + '=' + f.fields['_wp_http2'] } : null;
    var goRes = await _fetch(host + '?go=' + token, { headers: cookies || {}, timeoutMs: 12000 });
    var refresh = _first(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"']+)["']/i, goRes.body);
    if (!refresh) return null;
    var driveUrl = _abs(refresh, host);
    var driveHtml = await _get(driveUrl, { timeoutMs: 12000 });
    var path = _first(/replace\("([^"]+)"\)/i, driveHtml);
    if (!path || path === '/404') return null;
    return _abs(path, _baseUrl(driveUrl));
  } catch (e) { return null; }
}

async function _vegamovies(sourceName, dynKey, r, ctx) {
  if (!r.imdbId) return;
  var api = await _dyn(dynKey);
  if (!api) return;
  var j = await _getJson(api + '/search.php?q=' + encodeURIComponent(r.imdbId) + '&page=1', { timeoutMs: 12000 });
  var urls = j && j.hits ? j.hits.map(function (h) { return _fix(h.document ? h.document.permalink : '', api); }).filter(Boolean) : [];
  for (var i = 0; i < urls.length; i++) {
    var page = await _get(urls[i], { timeoutMs: 12000 });
    if (!page) continue;
    var current = _first(/<a[^>]*href="[^"]*imdb[^"]*"[^>]*>/i, page);
    var cid = _first(/title\/(tt\d+)/i, current);
    if (cid !== r.imdbId) continue;
    if (r.season == null) {
      var btnRe = /<button[^>]*class="[^"]*dwd-button[^"]*"[\s\S]*?<\/button>/gi, m;
      while ((m = btnRe.exec(page)) !== null) {
        var parent = page.slice(Math.max(0, m.index - 500), m.index);
        var link = _first(/href="([^"]+)"/i, parent.slice(parent.lastIndexOf('<a')));
        if (!link) continue;
        var d = await _get(link, { timeoutMs: 12000 });
        var re = /<p[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, mm;
        while ((mm = re.exec(d)) !== null) await _loadSource(sourceName, mm[1], '', ctx);
      }
    } else {
      // locate season heading then scan following anchors
      var hre = new RegExp('<h[34][^>]*>[\\s\\S]*?Season\\s*0*' + r.season + '[\\s\\S]*?<\\/h[34]>', 'gi'), hm;
      while ((hm = hre.exec(page)) !== null) {
        var seg = page.slice(hm.index + hm[0].length, hm.index + hm[0].length + 6000);
        var anRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, am;
        while ((am = anRe.exec(seg)) !== null) {
          if (!/V-Cloud|Single|Episode|G-Direct/i.test(_text(am[2]))) continue;
          var dd = await _get(am[1], { timeoutMs: 12000 });
          var epRe = new RegExp('<h4[^>]*>[^<]*Episode[^<]*' + r.episode + '[^<]*<\\/h4>[\\s\\S]*?<a[^>]+href="([^"]+)"[^>]*>[\\s\\S]*?V-Cloud', 'i');
          var ep = _first(epRe, dd);
          if (ep) await _loadSource(sourceName, ep, '', ctx);
        }
      }
    }
  }
}
async function provVegamovies(r, ctx) { if (!r.isBollywood) await _vegamovies('VegaMovies', 'vegamovies', r, ctx); }
async function provRogmovies(r, ctx) { if (r.isBollywood) await _vegamovies('RogMovies', 'rogmovies', r, ctx); }

// ── 25. Bollyflix ──────────────────────────────────────────────────────
async function provBollyflix(r, ctx) {
  if (!r.imdbId) return;
  var base = await _dyn('bollyflix');
  if (!base) return;
  var search = await _get(base + '/search/' + r.imdbId, { timeoutMs: 12000 });
  if (!search) return;
  var links = _all(/<div[^>]*>[\s\S]*?<article[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, search, 1);
  for (var i = 0; i < links.length; i++) {
    var page = await _get(links[i], { timeoutMs: 12000 });
    if (!page) continue;
    var hTag = r.season == null ? 'h5' : 'h4';
    var sTag = r.season == null ? '' : 'Season ' + r.season;
    var re = new RegExp('<(?:' + hTag + ')[^>]*>([\\s\\S]*?)<\\/(?:' + hTag + ')>', 'gi'), m;
    while ((m = re.exec(page)) !== null) {
      var headText = _text(m[1]);
      if (r.season != null && headText.toLowerCase().indexOf(sTag.toLowerCase()) < 0) continue;
      if (!/(480p|720p|1080p|2160p)/i.test(headText) || /Download/i.test(headText)) continue;
      var after = page.slice(m.index + m[0].length, m.index + m[0].length + 1500);
      var href = _first(/<a[^>]+href="([^"]+)"/i, after);
      if (!href) continue;
      if (r.season == null) await _loadSource('Bollyflix', href, '', ctx);
      else {
        var tok = href.indexOf('?id=') >= 0 ? href.split('?id=')[1] : '';
        if (tok) {
          var enc = await _get('https://web.sidexfee.com/?id=' + tok, { timeoutMs: 10000 });
          var b64 = _first(/link"\s*:\s*"([^"]+)/i, enc);
          if (b64) { try { href = _b64d(b64); } catch (e) {} }
        }
        var epPage = await _get(href, { timeoutMs: 12000 });
        var epText = 'Episode ' + String(r.episode).padStart(2, '0');
        var epLink = _first(new RegExp('<article[^>]*>[\\s\\S]*?<h3[^>]*>[\\s\\S]*?<a[^>]+href="([^"]+)"[^>]*>[^<]*' + epText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), epPage);
        if (epLink) await _loadSource('Bollyflix', epLink, '', ctx);
      }
    }
  }
}

// ── 26. TopMovies ──────────────────────────────────────────────────────
async function provTopmovies(r, ctx) {
  if (!r.imdbId) return;
  var base = await _dyn('topmovies');
  if (!base) return;
  var search = await _get(base + '/search/' + r.imdbId, { timeoutMs: 12000 });
  if (!search) return;
  var links = _all(/<div[^>]*id="content_box"[^>]*>[\s\S]*?<article[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, search, 1);
  for (var i = 0; i < links.length; i++) {
    var page = await _get(links[i], { headers: { 'User-Agent': UA }, timeoutMs: 12000 });
    if (!page) continue;
    var hTag = r.season == null ? 'h3' : 'div.single_post h3';
    var aTag = r.season == null ? 'Download' : 'G-Drive';
    var sTag = r.season == null ? '' : '(Season ' + r.season + ')';
    var blockRe = /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, m;
    while ((m = blockRe.exec(page)) !== null) {
      var head = _text(m[1]);
      if (!/(480p|720p|1080p|2160p|4K)/i.test(head)) continue;
      if (r.season != null && head.toLowerCase().indexOf(sTag.toLowerCase()) < 0) continue;
      if (/Batch\/Zip|Info:/i.test(head)) continue;
      var after = page.slice(m.index + m[0].length, m.index + m[0].length + 2500);
      var src = _first(new RegExp('<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*>[^<]*' + aTag, 'i'), after);
      var srcHref = _first(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*maxbutton/i, after);
      if (!srcHref) continue;
      var sub = await _get(srcHref, { headers: { 'User-Agent': UA }, timeoutMs: 12000 });
      var sel = r.season == null ? /<a[^>]*class="[^"]*maxbutton-5[^"]*"[^>]*>[^<]*Server[\s\S]*?<\/a>/i : new RegExp('<h3[^>]*>[\\s\\S]*?<a[^>]+href="([^"]+)"[^>]*>[^<]*Episode ' + r.episode, 'i');
      var candidate = r.season == null ? (sub.match(sel) || [])[0] : _first(sel, sub);
      var href2 = r.season == null ? (/href="([^"]+)"/i.exec(candidate || '') || [])[1] : candidate;
      if (!href2) continue;
      var by = await _bypassHrefli(href2);
      if (by) await _loadSource('Topmovies', by, '', ctx);
    }
  }
}

// ── 27. Vidup ──────────────────────────────────────────────────────────
async function provVidup(r, ctx) {
  if (!r.tmdbId) return;
  var headers = { 'User-Agent': UA, Referer: API.vidup + '/', 'X-Requested-With': 'XMLHttpRequest' };
  var url = r.season != null ? API.vidup + '/tv/' + r.tmdbId + '/' + r.season + '/' + r.episode : API.vidup + '/movie/' + r.tmdbId;
  var text = await _get(url, { timeoutMs: 12000 });
  var enc = _first(/\\?"(?:en|token)\\?":\\?"(.*?)\\?"/i, text);
  if (!enc) return;
  // Two-stage enc-dec.app flow (API changed: requires stage param)
  var s1 = await _getJson(MULTI + '/enc-vidup?text=' + encodeURIComponent(enc) + '&stage=1', { headers: headers, timeoutMs: 12000 });
  if (!s1 || s1.status !== 200 || !s1.result || !s1.result.stage1) return;
  var ph = Object.assign({}, headers, { 'X-CSRF-Token': s1.result.token || '' });
  var s1text = await _post(s1.result.stage1, { headers: ph, timeoutMs: 12000 });
  if (!s1text || !s1text.body) return;
  var s2 = await _getJson(MULTI + '/enc-vidup?text=' + encodeURIComponent(s1text.body) + '&stage=2', { headers: headers, timeoutMs: 12000 });
  if (!s2 || s2.status !== 200 || !s2.result) return;
  var d = s2.result;
  if (!d.servers || !d.stream) return;
  ph['X-CSRF-Token'] = d.token || '';
  var serversEnc = await _post(d.servers, { headers: ph, timeoutMs: 12000 });
  var dec = await _jsonPost(MULTI + '/dec-vidup', { text: serversEnc.body }, {}, 12000);
  if (!dec || dec.status !== 200 || !dec.result) return;
  for (var i = 0; i < dec.result.length; i++) {
    var server = dec.result[i]; if (!server || !server.data) continue;
    var streamEnc = await _post(d.stream + '/' + server.data, { headers: ph, timeoutMs: 12000 });
    var fj = await _jsonPost(MULTI + '/dec-vidup', { text: streamEnc.body }, {}, 12000);
    if (!fj || fj.status !== 200 || !fj.result) continue;
    var sr = fj.result;
    if (sr.url) _emitH(ctx, sr.url, 1080, 'Vidup ' + (server.name || ''), /\.m3u8/i.test(sr.url) ? 'hls' : null, { Referer: API.vidup + '/' });
    (sr.tracks || []).forEach(function (t) { if (t && t.file) ctx.sub(t.label || 'Unknown', t.file, 'Vidup'); });
  }
}

// ── 28. Meowtv ─────────────────────────────────────────────────────────
async function _meowTicket() {
  var r = await _post(API.meowtv + '/streams/ticket', {
    headers: { 'User-Agent': UA, Origin: API.meowtvBase, Referer: API.meowtvBase + '/' },
    timeoutMs: 8000
  });
  var j = _parseJson(r && r.body);
  return j && j.ticket ? j.ticket : '';
}
async function provMeowtv(r, ctx) {
  if (!r.tmdbId) return;
  var headers = { 'User-Agent': UA, Origin: API.meowtvBase, Referer: API.meowtvBase + '/' };
  var type = r.season != null ? 'tv' : 'movie';
  // Live server ids. ipcloud/turkce/hindiv3 now answer "Unknown server".
  var servers = ['english', 'acme', 'dcloud', 'tik', 'hindi'];
  for (var i = 0; i < servers.length; i++) {
    // Tickets are single-use: one fresh ticket per server request.
    var ticket = await _meowTicket();
    if (!ticket) continue;
    var h2 = Object.assign({}, headers, { 'X-Stream-Ticket': ticket });
    var url = API.meowtv + '/streams/' + type + '/' + r.tmdbId + (r.season != null ? '/' + r.season + '/' + r.episode : '') + '?s=' + servers[i];
    var text = await _get(url, { headers: h2, timeoutMs: 12000 });
    var raw = _parseJson(text);
    if (!raw) continue;
    var dec = await _jsonPost(MULTI + '/dec-meowtv', { data: raw }, { 'Content-Type': 'application/json' }, 12000);
    var parsed = dec && dec.result ? dec.result : null;
    if (!parsed || !parsed.url) continue;
    _emitH(ctx, parsed.url, 1080, 'Meowtv[' + servers[i] + '] ' + (parsed.language || ''), /\.m3u8/i.test(parsed.url) ? 'hls' : null, headers);
  }
}

// ── 29. Moviesmod ──────────────────────────────────────────────────────
async function _modflix(api, r, ctx) {
  if (!r.imdbId) return;
  var url = r.season == null ? api + '/search/' + r.imdbId : api + '/search/' + r.imdbId + '%20' + r.season;
  var search = await _get(url, { timeoutMs: 12000 });
  var href = _first(/<div[^>]*id="content_box"[^>]*>[\s\S]*?<article[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/i, search);
  if (!href) return;
  var page = await _get(href, { timeoutMs: 12000 });
  if (!page) return;
  var hTag = r.season == null ? 'h4' : 'h3';
  var aTag = r.season == null ? 'Download' : 'Episode';
  var sTag = r.season == null ? '' : '(S0' + r.season + '|Season ' + r.season + ')';
  var re = new RegExp('<' + hTag + '\\b[^>]*>([\\s\\S]*?)<\\/' + hTag + '>', 'gi'), m;
  while ((m = re.exec(page)) !== null) {
    var head = _text(m[1]);
    if (!/(480p|720p|1080p|2160p)/i.test(head)) continue;
    if (r.season != null && !new RegExp(sTag, 'i').test(head)) continue;
    if (/MoviesMod/i.test(head)) continue;
    var after = page.slice(m.index + m[0].length, m.index + m[0].length + 2500);
    var link = _first(new RegExp('<a[^>]+href="([^"]+)"[^>]*>[\\s\\S]*?' + aTag, 'i'), after);
    if (!link) continue;
    link = link.split('=').pop();
    if (!link) continue;
    var srcPage = await _get(link, { timeoutMs: 12000 });
    var selector = r.season == null
      ? _first(/<p[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*class="[^"]*maxbutton/i, srcPage)
      : _first(new RegExp('<h3[^>]*>[\\s\\S]*?<a[^>]+href="([^"]+)"[^>]*>[\\s\\S]*?Episode ' + r.episode, 'i'), srcPage);
    if (!selector) continue;
    var by = await _bypassHrefli(selector);
    if (by) await _loadSource('Moviesmod', by, '', ctx);
  }
}
async function provMoviesmod(r, ctx) {
  if (r.isBollywood) return;
  var api = await _dyn('moviesmod');
  if (api) await _modflix(api, r, ctx);
}

// ── 30. Movies4u ───────────────────────────────────────────────────────
async function provMovies4u(r, ctx) {
  if (!r.imdbId || !r.title) return;
  var api = await _dyn('movies4u');
  // The upstream url list ships a google.com placeholder for this dead host.
  // Searching Google yields unrelated pages, so skip unless a real host is set.
  if (!api || /(^|\.)google\.com$/i.test(_host(api))) return;
  var query = r.season == null ? String(r.title).replace(/ /g, '+') + '+' + (r.year || '') : String(r.title).replace(/ /g, '+') + '+season+' + r.season;
  var headers = { Cookie: 'xla=s4t', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36', Referer: api + '/' };
  var search = await _get(api + '/?s=' + query, { headers: headers, timeoutMs: 12000 });
  if (!search) return;
  var links = _all(/<article\b[\s\S]*?<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, search, 1);
  for (var i = 0; i < links.length; i++) {
    var post = await _get(links[i], { headers: headers, timeoutMs: 12000 });
    var imdbLink = _first(/<p[^>]*>[\s\S]*?<a[^>]+href="([^"]*imdb[^"]*)"/i, post);
    var cid = _first(/title\/(tt\d+)/i, imdbLink);
    if (cid !== r.imdbId) continue;
    if (r.season == null) {
      var inner = _first(/<div[^>]*class="[^"]*download-links-div[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*class="[^"]*btn/i, post);
      if (!inner) continue;
      var innerPage = await _get(inner, { headers: headers, timeoutMs: 12000 });
      var srcs = _all(/<div[^>]*class="[^"]*downloads-btns-div[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*class="[^"]*btn/gi, innerPage, 1);
      for (var s = 0; s < srcs.length; s++) if (srcs[s]) await _loadSource('Movies4u', srcs[s], '', ctx);
    } else {
      var blockRe = /<div[^>]*class="[^"]*downloads-btns-div[^"]*"[^>]*>/gi, bm;
      while ((bm = blockRe.exec(post)) !== null) {
        var before = post.slice(0, bm.index);
        var headerText = _text(before.slice(before.lastIndexOf('<h')));
        if (headerText.toLowerCase().indexOf(('Season ' + r.season).toLowerCase()) < 0) continue;
        var seg = post.slice(bm.index, bm.index + 4000);
        var seasonLink = _first(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*btn/i, seg);
        if (!seasonLink) continue;
        var epPage = await _get(seasonLink, { headers: headers, timeoutMs: 12000 });
        var blocks = _all(/<div[^>]*class="[^"]*downloads-btns-div[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*downloads-btns-div|$)/gi, epPage, 0);
        if (r.episode != null && r.episode >= 1 && r.episode <= blocks.length) {
          var eps = _all(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*btn/gi, blocks[r.episode - 1], 1);
          for (var e = 0; e < eps.length; e++) if (eps[e]) await _loadSource('Movies4u', eps[e], '', ctx);
        }
      }
    }
  }
}

// ── 31. Dudefilms ──────────────────────────────────────────────────────
async function provDudefilms(r, ctx) {
  if (!r.imdbId) return;
  var base = await _dyn('dudefilms');
  if (!base) return;
  var search = await _get(base + '/?s=' + r.imdbId, { timeoutMs: 12000 });
  if (!search) return;
  var links = _all(/<a[^>]*class="[^"]*simple-grid-grid-post-thumbnail-link[^"]*"[^>]*href="([^"]+)"/gi, search, 1);
  for (var i = 0; i < links.length; i++) {
    var page = await _get(links[i], { timeoutMs: 12000 });
    if (!page) continue;
    if (r.season == null && r.episode == null) {
      var mids = _all(/<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*href="([^"]+)"/gi, page, 1);
      for (var m = 0; m < mids.length; m++) {
        var midPage = await _get(mids[m], { timeoutMs: 12000 });
        var srcs = _all(/<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*href="([^"]+)"/gi, midPage, 1);
        for (var s = 0; s < srcs.length; s++) if (srcs[s]) await _loadSource('Dudefilms', srcs[s], '', ctx);
      }
    } else {
      var h4Re = /<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, hm;
      var found = [];
      while ((hm = h4Re.exec(page)) !== null) {
        if (new RegExp('Season\\s*0*' + r.season + '\\b', 'i').test(_text(hm[1]))) found.push(hm.index + hm[0].length);
      }
      for (var f = 0; f < found.length; f++) {
        var seg = page.slice(found[f], found[f] + 12000);
        var pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi, pm;
        while ((pm = pRe.exec(seg)) !== null) {
          if (pm.index < 0) break;
          var aRe = /<a\b[^>]*href="([^"]+)"/gi, am;
          while ((am = aRe.exec(pm[1])) !== null) {
            var epPage = await _get(am[1], { timeoutMs: 12000 });
            var btnRe = /<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, bm;
            while ((bm = btnRe.exec(epPage)) !== null) {
              var n = parseInt(_first(/(?:Episode|Ep|E)\s*(\d+)/i, _text(bm[2])), 10);
              if (n === r.episode) { await _loadSource('Dudefilms', bm[1], '', ctx); break; }
            }
          }
        }
      }
    }
  }
}

// ── 32. UHDMovies ──────────────────────────────────────────────────────
async function provUhdmovies(r, ctx) {
  if (!r.title) return;
  var base = await _dyn('uhdmovies');
  if (!base) return;
  var search = await _get(base + '/search/' + encodeURIComponent(r.title + ' ' + (r.year || '')), { timeoutMs: 12000 });
  var pageUrl = _first(/<article\b[\s\S]*?<div[^>]*class="[^"]*entry-image[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"/i, search);
  if (!pageUrl) return;
  var page = await _get(pageUrl, { timeoutMs: 12000 });
  if (!page) return;
  var sel = r.season == null ? new RegExp(String(r.year || ''), 'i') : new RegExp('(?:S0?' + r.season + '|Season 0?' + r.season + ')', 'i');
  var epSel = r.season == null ? /Download/i : new RegExp('Episode ' + r.episode, 'i');
  var pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi, pm;
  while ((pm = pRe.exec(page)) !== null) {
    if (!sel.test(_text(pm[1]))) continue;
    var after = page.slice(pm.index + pm[0].length, pm.index + pm[0].length + 4000);
    var aRe = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, am;
    while ((am = aRe.exec(after)) !== null) {
      if (!epSel.test(_text(am[2]))) continue;
      var href = am[1];
      var drive;
      if (/driveleech|driveseed/i.test(href)) {
        var b = _baseUrl(href);
        var text = await _get(href, { timeoutMs: 12000 });
        var rel = _first(/window\.location\.replace\(["'](.*?)["']\)/i, text);
        if (!rel) continue;
        drive = b + rel;
      } else drive = await _bypassHrefli(href);
      if (drive) await _loadSource('UHDMovies', drive, '', ctx);
    }
  }
}

// ── 33. MoviesDrive ────────────────────────────────────────────────────
async function _mdriveLinks(html) {
  return _all(/<a\b[^>]*href="([^"]+)"/gi, html, 1).filter(function (h) { return /hubcloud|gdflix|gdlink/i.test(h); });
}
async function provMoviesdrive(r, ctx) {
  if (!r.imdbId || !r.title) return;
  var base = await _dyn('moviesdrive');
  if (!base) return;
  var j = await _getJson(base + '/search.php?q=' + encodeURIComponent(r.imdbId), { timeoutMs: 12000 });
  if (!j || !j.hits) return;
  for (var i = 0; i < j.hits.length; i++) {
    var doc = j.hits[i].document;
    if (!doc || String(doc.imdb_id || '') !== r.imdbId) continue;
    var page = await _get(base + doc.permalink, { timeoutMs: 12000 });
    if (!page) continue;
    if (r.season == null) {
      var h5s = _all(/<h5\b[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, page, 1);
      for (var h = 0; h < h5s.length; h++) {
        var inner = await _get(h5s[h], { timeoutMs: 12000 });
        var list = await _mdriveLinks(inner);
        for (var l = 0; l < list.length; l++) await _loadSource('MoviesDrive', list[l], '', ctx);
      }
    } else {
      var es = _epSlug(r.season, r.episode);
      var stag = 'Season ' + r.season + '|S' + es[0];
      var sep = 'Ep' + es[1] + '|Ep' + r.episode;
      var hre = new RegExp('<h5[^>]*>[\\s\\S]*?(?:' + stag + ')[\\s\\S]*?<\\/h5>', 'gi'), hm;
      while ((hm = hre.exec(page)) !== null) {
        var seg = page.slice(hm.index + hm[0].length, hm.index + hm[0].length + 3000);
        var href = _first(/<a[^>]+href="([^"]+)"/i, seg);
        if (!href) continue;
        var epPage = await _get(href, { timeoutMs: 12000 });
        var epSeg = new RegExp('<h5[^>]*>[\\s\\S]*?(?:' + sep + ')[\\s\\S]*?<\\/h5>[\\s\\S]*?(?:<h5|$)', 'i').exec(epPage);
        if (!epSeg) continue;
        var srcs = _all(/<a[^>]+href="([^"]+)"/gi, epSeg[0], 1);
        for (var s = 0; s < srcs.length; s++) if (srcs[s]) await _loadSource('MoviesDrive', srcs[s], '', ctx);
      }
    }
  }
}

// ── 34. Hindmoviez ─────────────────────────────────────────────────────
var HINDMOVIEZ_SECRET = _b64d('NWU5NjA4NWM1NmUwZjU0ZWRhNjU3NzkwYWM1OGQxOWIyNzE0NzljNTA0MzY3ZmM5ZTZhNmMzM2YxZjgyNGU2Yg==');
function _hindSign(rawId, domain) {
  var t = Math.floor(Date.now() / 1000);
  var encoded = _b64urlEncode(rawId);
  var sig = _hmacSha256Hex(HINDMOVIEZ_SECRET, encoded + '|' + t).slice(0, 16);
  return domain + '/r.php?d=' + encodeURIComponent(encoded) + '&t=' + t + '&s=' + sig;
}
async function _getHindLinks(url, ctx) {
  var page = await _get(url, { timeoutMs: 20000 });
  if (!page) return;
  var name = _text(_first(/<div[^>]*class="[^"]*container[^"]*"[^>]*>[\s\S]*?<p[^>]*>[^<]*Name:\s*([^<]+)/i, page));
  var size = _text(_first(/<div[^>]*class="[^"]*container[^"]*"[^>]*>[\s\S]*?<p[^>]*>[^<]*Size:\s*([^<]+)/i, page));
  var link = _first(/<a[^>]*class="[^"]*btn-info[^"]*"[^>]*href="([^"]+)"/i, page);
  if (!link) return;
  var doc = await _get(link, { timeoutMs: 20000 });
  var btns = _all(/<a[^>]*class="[^"]*button[^"]*"[^>]*href="([^"]+)"/gi, doc, 1);
  for (var i = 0; i < btns.length; i++) {
    _emitH(ctx, btns[i], _quality(name), 'Hindmoviez ' + _simplify(name + ' ' + size) + ' ' + size, 'mp4', null);
  }
}
async function provHindmoviez(r, ctx) {
  if (!r.imdbId) return;
  var base = await _dyn('hindmoviez');
  if (!base) return;
  var search = await _get(base + '/?s=' + encodeURIComponent(r.imdbId), { timeoutMs: 8000 });
  if (!search) return;
  var titles = _all(/<h2[^>]*class="[^"]*entry-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, search, 1);
  for (var i = 0; i < titles.length; i++) {
    var page = await _get(titles[i], { timeoutMs: 8000 });
    if (!page) continue;
    if (r.episode == null) {
      var mids = _all(/<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*href="([^"]+)"/gi, page, 1);
      for (var m = 0; m < mids.length; m++) {
        var mid = await _get(mids[m], { timeoutMs: 8000 });
        var href = _first(/<a[^>]*class="[^"]*get-link-btn[^"]*"[^>]*href="([^"]+)"/i, mid);
        if (!href || href.indexOf('/?id=') < 0) continue;
        var hbase = href.split('/?id=')[0], raw = href.split('id=').pop();
        var link = _hindSign(raw, hbase);
        await _getHindLinks(link, ctx);
      }
    } else {
      var blocks = _all(/<a[^>]*class="[^"]*maxbutton[^"]*"[^>]*href="([^"]+)"/gi, page, 1);
      for (var b = 0; b < blocks.length; b++) {
        var before = page.slice(0, page.indexOf(blocks[b]));
        var text = _text(before.slice(before.lastIndexOf('</h')));
        if (text.toLowerCase().indexOf(('Season ' + r.season).toLowerCase()) < 0) continue;
        var sub = await _get(blocks[b], { timeoutMs: 8000 });
        var anchors = _all(/<h3\b[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, sub, 1);
        var epHref = anchors[r.episode - 1];
        if (!epHref) continue;
        var base2 = epHref.split('/?id=')[0], raw2 = epHref.split('id=').pop();
        var l2 = _hindSign(raw2, base2);
        await _getHindLinks(l2, ctx);
      }
    }
  }
}

// ── 35. 4KHDHub ────────────────────────────────────────────────────────
async function prov4khdhub(r, ctx) {
  if (!r.title) return;
  var base = await _dyn('4khdhub');
  if (!base) return;
  var search = await _get(base + '/?s=' + _quote(r.title), { timeoutMs: 12000 });
  if (!search) return;
  var cards = _all(/<div[^>]*class="[^"]*card-grid[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[\s\S]*?<div[^>]*class="[^"]*movie-card-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, search, 0);
  var link = null;
  var cardRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, cm;
  while ((cm = cardRe.exec(search)) !== null) {
    var content = _text(cm[2]).toLowerCase();
    if (content.indexOf(String(r.title).toLowerCase()) < 0) continue;
    if (r.year && content.indexOf(String(r.year)) < 0) continue;
    link = cm[1]; break;
  }
  if (!link) return;
  var doc = await _get(base + (link.charAt(0) === '/' ? link : '/' + link), { timeoutMs: 12000 });
  if (!doc) return;
  var sourceAnchors = [];
  if (r.season == null) sourceAnchors = _all(/<div[^>]*class="[^"]*download-item[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, doc, 1);
  else {
    var es = _epSlug(r.season, r.episode);
    var re = new RegExp('<div[^>]*class="[^"]*episode-download-item[^"]*"[^>]*>[\\s\\S]*?S' + es[0] + 'E' + es[1] + '[\\s\\S]*?<\\/div>', 'gi'), m;
    while ((m = re.exec(doc)) !== null) sourceAnchors = sourceAnchors.concat(_all(/<a[^>]+href="([^"]+)"/gi, m[0], 1));
  }
  for (var i = 0; i < sourceAnchors.length; i++) {
    var src = sourceAnchors[i];
    if (!/hubcloud|hubdrive/i.test(src)) src = await _wpRedirect(src);
    if (src) await _loadSource('4Khdhub', src, '', ctx);
  }
}

// ── 36. PrimeSrc ───────────────────────────────────────────────────────
async function provPrimesrc(r, ctx) {
  if (!r.imdbId) return;
  var headers = { Referer: API.primesrc + '/', 'User-Agent': UA };
  var url = r.season == null ? API.primesrc + '/api/v1/s?imdb=' + r.imdbId + '&type=movie'
    : API.primesrc + '/api/v1/s?imdb=' + r.imdbId + '&season=' + r.season + '&episode=' + r.episode + '&type=tv';
  var list = await _getJson(url, { headers: headers, timeoutMs: 12000 });
  if (!list || !list.servers) return;
  for (var i = 0; i < list.servers.length; i++) {
    var server = list.servers[i]; if (!server || !server.key) continue;
    var lj = await _getJson(API.primesrc + '/api/v1/l?key=' + encodeURIComponent(server.key), { headers: headers, timeoutMs: 12000 });
    if (lj && lj.link) await _loadSource('PrimeWire', lj.link, API.primesrc, ctx);
  }
}

// ── 37. ProjectFreeTV ──────────────────────────────────────────────────
async function provProjectfreetv(r, ctx) {
  if (!r.title) return;
  var query = r.season == null ? String(r.title).replace(/ /g, '+') : String(r.title).replace(/ /g, '+') + '+-+season+' + r.season;
  var search = await _getJson(API.projectfreetv + '/data/browse/?lang=3&keyword=' + query + '&year=' + (r.year || '') + '&networks=&rating=&votes=&genre=&country=&cast=&directors=&type=&order_by=&page=1&limit=1', { headers: { Referer: API.projectfreetv }, timeoutMs: 20000 });
  if (!search || !search.movies || !search.movies.length) return;
  var id = search.movies[0]._id; if (!id) return;
  var j = await _getJson(API.projectfreetv + '/data/watch/?_id=' + id, { headers: { Referer: API.projectfreetv }, timeoutMs: 20000 });
  if (!j || !j.streams) return;
  for (var i = 0; i < j.streams.length; i++) {
    var item = j.streams[i];
    var cur = parseInt(item.e, 10);
    if (r.episode == null || cur === r.episode) if (item.stream) await _loadSource('ProjectFreeTV', item.stream, '', ctx);
  }
}

// ── 38. Mlsbd ──────────────────────────────────────────────────────────
async function provMlsbd(r, ctx) {
  if (!r.title) return;
  var base = await _dyn('mlsbd');
  if (!base) return;
  var slug = _slug2((r.title + ' ' + (r.year || '')).trim());
  var page = await _get(base + '/' + slug, { timeoutMs: 12000 });
  if (!page) return;
  var dl = _first(/<[^>]*class="[^"]*post-section-title[^"]*download[^"]*"[^>]*>([\s\S]*?)<\//i, page);
  if (_text(dl) !== 'Download Now') return;
  var tag = r.season != null ? '[Combined]' : '';
  var links = _all(/<div[^>]*class="[^"]*post-content[^"]*"[^>]*>[\s\S]*?<p[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, page, 1);
  for (var i = 0; i < links.length; i++) {
    var doc = await _get(links[i], { timeoutMs: 12000 });
    var srcs = _all(/<li\b[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, doc, 1);
    for (var s = 0; s < srcs.length; s++) if (srcs[s]) await _loadSource('Mlsbd' + tag, srcs[s], '', ctx);
  }
}

// ── 39. Levidia ────────────────────────────────────────────────────────
async function provLevidia(r, ctx) {
  if (!r.title || !r.year) return;
  var q = _quote(r.title) + '+' + r.year;
  var url = API.levidia + '/search.php?q=' + q + '&v=' + (r.season == null ? 'movies' : 'episodes');
  var res = await _fetch(url, { timeoutMs: 12000 });
  var jar = _COOKIE_JAR[_host(API.levidia)] || {};
  var session = jar.PHPSESSID || '';
  var chk = _first(/_3chk\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\)/i, res.body);
  var m3 = res.body.match(/_3chk\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\)/i);
  if (!m3) return;
  var headers = { 'User-Agent': UA, Referer: API.levidia + '/', Cookie: 'PHPSESSID=' + session + ';' + m3[1] + '=' + m3[2] };
  var href = null;
  var itemRe = /<li[^>]*class="[^"]*mlist[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*mainlink[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, im;
  while ((im = itemRe.exec(res.body)) !== null) {
    var title = _text(_first(/<strong[^>]*>([\s\S]*?)<\/strong>/i, im[2]));
    var yr = parseInt(_text(im[2]).replace(/\D/g, ''), 10);
    if (title.toLowerCase() === String(r.title).toLowerCase() && yr === r.year) { href = im[1]; break; }
  }
  if (!href) return;
  var doc = await _get(href, { headers: headers, timeoutMs: 12000 });
  if (!doc) return;
  var targets = [];
  if (r.season == null) targets = _all(/<a[^>]*class="[^"]*xxx[^"]*"[^>]*href="([^"]+)"/gi, doc, 1);
  else {
    var epRe = new RegExp('[^a-z]s0?' + r.season + 'e0?' + r.episode + '[^0-9]', 'i');
    var eplinks = _all(/<li[^>]*class="[^"]*mlist[^"]*links[^"]*"[^>]*>[\s\S]*?<b[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/gi, doc, 1);
    var ep = eplinks.find(function (x) { return epRe.test(x); });
    if (!ep) return;
    var doc2 = await _get(API.levidia + '/' + ep.replace(/^\//, ''), { headers: headers, timeoutMs: 12000 });
    targets = _all(/<a[^>]*class="[^"]*xxx[^"]*"[^>]*href="([^"]+)"/gi, doc2, 1);
  }
  for (var i = 0; i < targets.length; i++) {
    var rr = await _fetch(targets[i], { headers: headers, followRedirects: false, timeoutMs: 10000 });
    var loc = _hget(rr.headers, 'location');
    if (loc) await _loadSource('Levidia', _abs(loc, targets[i]), API.levidia + '/', ctx);
  }
}

// ── 40. Animesalt ──────────────────────────────────────────────────────
async function provAnimesalt(r, ctx) {
  if (!r.title) return;
  var slug = _slug2(r.title);
  var headers = { Referer: API.animesalt + '/', 'User-Agent': UA };
  var url = r.season == null ? API.animesalt + '/movies/' + slug + '/' : API.animesalt + '/episode/' + slug + '-' + r.season + 'x' + r.episode + '/';
  var html = await _get(url, { headers: headers, timeoutMs: 12000 });
  if (!html) return;
  var m = html.match(/src="(https:\/\/as-cdn\d+\.top\/video\/([a-f0-9]+))"/i);
  if (!m) return;
  var playerUrl = m[1], hash = m[2], cdn = playerUrl.split('/video/')[0];
  var body = 'hash=' + hash + '&r=' + encodeURIComponent(API.animesalt + '/');
  var res = await _postForm(cdn + '/player/index.php?data=' + hash + '&do=getVideo', { hash: hash, r: API.animesalt + '/' }, {
    headers: { Referer: API.animesalt + '/', Origin: cdn, 'X-Requested-With': 'XMLHttpRequest' }, timeoutMs: 12000
  });
  var j = _parseJson(res.body);
  if (!j) return;
  var m3u8 = j.videoSource || j.securedLink;
  if (!m3u8) return;
  _emitH(ctx, m3u8, 1080, 'AnimeSalt[Multi]', 'hls', headers);
}

// ── 41. M4ufree ────────────────────────────────────────────────────────
async function provM4ufree(r, ctx) {
  if (!r.title || !r.year) return;
  var base = await _dyn('m4ufree');
  if (!base) return;
  var q = r.season == null ? _urlTitle(r.title) + '-' + r.year + '?type=movie' : _urlTitle(r.title) + '-' + r.year + '?type=tvs';
  var search = await _get(base + '/search/' + q, { timeoutMs: 12000 });
  if (!search) return;
  var anchors = _all(/<div[^>]*class="[^"]*item[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, search, 0);
  var link = null;
  var aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, am;
  while ((am = aRe.exec(search)) !== null) {
    var t = _attr(am[1], 'title') || _text(am[2]);
    if (t.toLowerCase().indexOf((r.title + ' (' + r.year).toLowerCase()) >= 0 || t.toLowerCase().indexOf((r.title + ' ' + r.year).toLowerCase()) >= 0) {
      link = _attr(am[1], 'href'); break;
    }
  }
  if (!link) return;
  link = _fix(link, base);
  var req = await _fetch(link, { timeoutMs: 12000 });
  var doc = req.body;
  var token = _first(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/i, doc);
  if (!token) return;
  var m4u = '';
  if (r.season == null && r.episode == null) {
    m4u = _first(/<span[^>]*(?:class="[^"]*singlemv[^"]*active[^"]*"|id="fem")[^>]*data="([^"]+)"/i, doc);
  } else {
    var code = 'S' + String(r.season).padStart(2, '0') + '-E' + String(r.episode).padStart(2, '0');
    var btnRe = /<button[^>]*class="[^"]*episode[^"]*"[^>]*>([\s\S]*?)<\/button>/gi, bm;
    var idep = '';
    while ((bm = btnRe.exec(doc)) !== null) if (_text(bm[1]).trim().toUpperCase() === code) { idep = _attr(bm[0], 'idepisode'); break; }
    if (!idep) return;
    var embed = await _postForm(base + '/ajaxtv', { idepisode: idep, _token: token }, { headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: link }, timeoutMs: 12000 });
    m4u = _first(/<span[^>]*(?:class="[^"]*singlemv[^"]*active[^"]*"|id="fem")[^>]*data="([^"]+)"/i, embed.body);
  }
  if (!m4u) return;
  var ajax = await _postForm(base + '/ajax', { m4u: m4u, _token: token }, { headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: link }, timeoutMs: 12000 });
  var iframe = _first(/<iframe[^>]+src="([^"]+)"/i, ajax.body);
  if (iframe) await _loadSource('M4uhd', _fix(iframe, link), base, ctx);
}

// ── 42. Multimovies ────────────────────────────────────────────────────
async function provMultimovies(r, ctx) {
  if (!r.title) return;
  var base = await _dyn('multimovies');
  if (!base) return;
  var slug = _slug2(r.title);
  var url = r.season == null ? base + '/movies/' + slug : base + '/episodes/' + slug + '-' + r.season + 'x' + r.episode;
  var page = await _get(url, { timeoutMs: 12000 });
  if (!page) return;
  var liRe = /<li\b([^>]*)>/gi, m;
  while ((m = liRe.exec(page)) !== null) {
    var post = _attr(m[1], 'data-post'), nume = _attr(m[1], 'data-nume'), type = _attr(m[1], 'data-type');
    if (!post || !nume || /trailer/i.test(nume)) continue;
    var r2 = await _postForm(base + '/wp-admin/admin-ajax.php', { action: 'doo_player_ajax', post: post, nume: nume, type: type }, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: url }, timeoutMs: 12000
    });
    var j = _parseJson(r2.body);
    var embed = j && j.embed_url ? j.embed_url : '';
    var link = _first(/["']([^"']+)["']/, embed);
    if (!link || /youtube/i.test(link)) continue;
    await _loadSource('Multimovies', link, base, ctx);
  }
}

// ── 43. Akwam ──────────────────────────────────────────────────────────
async function provAkwam(r, ctx) {
  if (!r.imdbId || !r.title || !r.year) return;
  var type = r.season == null ? 'movie' : 'series';
  var searchUrl = API.akwam + '/search?q=' + _quote(r.title) + '&section=' + type + '&year=' + r.year + '&rating=0&formats=0&quality=0';
  var search = await _get(searchUrl, { headers: { Referer: API.akwam + '/' }, timeoutMs: 12000 });
  var pageUrl = _first(/<a[^>]*class="[^"]*box[^"]*"[^>]*href="([^"]+)"/i, search);
  if (!pageUrl) return;
  var page = await _get(pageUrl, { headers: { Referer: API.akwam + '/' }, timeoutMs: 12000 });
  var imdb = _first(/<a[^>]+href="[^"]*imdb\.com[^"]*title\/(tt\d+)/i, page);
  if (imdb !== r.imdbId) return;
  async function getLink(u) {
    var a = await _get(u, { headers: { Referer: API.akwam + '/' }, timeoutMs: 12000 });
    var l1 = _first(/<a[^>]*class="[^"]*link-download[^"]*"[^>]*href="([^"]+)"/i, a);
    if (!l1) return null;
    var b = await _get(l1, { headers: { Referer: API.akwam + '/' }, timeoutMs: 12000 });
    var l2 = _first(/<a[^>]*class="[^"]*download-link[^"]*"[^>]*href="([^"]+)"/i, b);
    if (!l2) return null;
    var c = await _get(l2, { headers: { Referer: API.akwam + '/' }, timeoutMs: 12000 });
    return _first(/<a[^>]*class="[^"]*link[^"]*"[^>]*href="([^"]+)"/i, c);
  }
  var source;
  if (r.season == null) source = await getLink(pageUrl);
  else {
    var epRe = new RegExp('(?:حلقة|Episode)\\s+' + r.episode + '(?!\\d)', 'i');
    var aRe = /<h2[^>]*>[\s\S]*?<a[^>]*class="[^"]*text-white[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, am, epUrl = null;
    while ((am = aRe.exec(page)) !== null) if (epRe.test(_text(am[2]))) { epUrl = am[1]; break; }
    if (!epUrl) return;
    source = await getLink(epUrl);
  }
  if (!source) return;
  _emitH(ctx, source, 720, 'Akwam 🇸🇦', null, { Connection: 'keep-alive', Referer: API.akwam + '/', 'User-Agent': UA });
}

// ── 44. Rtally ─────────────────────────────────────────────────────────
async function provRtally(r, ctx) {
  if (!r.title || r.season != null) return;
  var base = await _dyn('rtally');
  if (!base) return;
  var page = await _get(base + '/post/' + _slug2(r.title), { timeoutMs: 12000 });
  if (!page) return;
  var out = [];
  var re = /\\?"(small|medium|large|extraLarge)\\?":\\?"(https?:\/\/[^\\"]+)/gi, m;
  while ((m = re.exec(page)) !== null) out.push(m[2]);
  var sre = /\\?"(lulustream|strmup|filemoon|turbo|vidhide|doodStream|streamwish)Url\\?":\\?"?([^\\"]+)/gi, sm;
  while ((sm = sre.exec(page)) !== null) {
    var service = sm[1], id = sm[2];
    if (id === 'null') continue;
    var map = { vidhide: 'https://vidhideplus.com/v/', lulustream: 'https://lulustream.com/e/', filemoon: 'https://filemoon.sx/e/', streamwish: 'https://playerwish.com/e/', strmup: 'https://strmup.cc/' };
    if (map[service]) out.push(map[service] + id);
  }
  out = _uniqBy(out.map(function (u) { return { u: u }; }), function (x) { return x.u; }).map(function (x) { return x.u; });
  for (var i = 0; i < out.length; i++) await _loadSource('Rtally', out[i], '', ctx);
}

// ── 45. Asiaflix ───────────────────────────────────────────────────────
function _httpsify(u) { return String(u || '').replace(/^\/\//, 'https://'); }
async function provAsiaflix(r, ctx) {
  if (!r.title || r.isAnime) return;
  if (r.season != null && r.season !== 1) return;
  var headers = { Referer: API.asiaflix, 'X-Access-Control': 'web', 'User-Agent': UA };
  var j = await _getJson('https://api.asiaflix.net/v1/drama/search?q=' + _quote(r.title), { headers: headers, timeoutMs: 12000 });
  if (!j || !j.body) return;
  var match = null;
  for (var i = 0; i < j.body.length; i++) if (String(j.body[i].name || '').indexOf(r.title) >= 0) { match = j.body[i]; break; }
  if (!match) return;
  var slug = String(match.name).replace(/ /g, '-');
  var epUrl = API.asiaflix + '/play/' + slug + '-1/' + match._id + '/1';
  var page = await _get(epUrl, { timeoutMs: 12000 });
  var state = _first(/<script[^>]*id="ng-state"[^>]*>([\s\S]*?)<\/script>/i, page);
  if (!state) return;
  var ep = r.episode || 1;
  var full = new RegExp('"number"\\s*:\\s*' + ep + '\\b[\\s\\S]*?"streamUrls"\\s*:\\s*(\\[[\\s\\S]*?\\])').exec(state);
  if (!full) return;
  var re = /"url"\s*:\s*"(.*?)"/g, m;
  while ((m = re.exec(full[1])) !== null) {
    var src = _httpsify(m[1]);
    if (src) await _loadSource('Asiaflix', src, '', ctx);
  }
}

// ── 46. Skymovies ──────────────────────────────────────────────────────
async function provSkymovies(r, ctx) {
  if (r.isAnime || !r.title) return;
  var base = await _dyn('skymovies');
  if (!base) return;
  var year = r.year || '';
  var wanted = r.title + (year ? ' (' + year + ')' : '');
  var url = base + '/search.php?search=' + _quote(wanted) + '&cat=All';
  var html = await _get(url, { timeoutMs: 12000 });
  if (!html) return;
  var page = _baseUrl(url);
  var links = _all(/<div[^>]*class="[^"]*\bL\b[^"]*"[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/gi, html);
  var anchors = [];
  var re = /<div[^>]*class="[^"]*\bL\b[^"]*"[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) anchors.push({ href: _attr(m[1], 'href'), text: _text(m[2]) });
  var eps = _epSlug(1, r.episode || 1);
  var eSlug = eps[1];
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    if (!a.href || a.text.indexOf(wanted) !== 0) continue;
    var singleEp = false;
    if (r.episode != null && /\bS\d{2}E\d{2}\b/i.test(a.text)) {
      if (!new RegExp('E' + eSlug + '\\b', 'i').test(a.text)) continue;
      singleEp = true;
    }
    var detail = await _get(_abs(a.href, page), { headers: { Referer: page }, timeoutMs: 12000 });
    var dre = /<div[^>]*class="[^"]*\bBolly\b[^"]*"[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/gi, dm;
    while ((dm = dre.exec(detail || '')) !== null) {
      var text = _text(dm[2]);
      var href = _attr(dm[1], 'href');
      if (!href) continue;
      if (r.episode == null || singleEp) {
        await _loadSource('Skymovies', href, page, ctx);
      } else if (text.indexOf('Episode') >= 0) {
        if (text.indexOf('Episode ' + eSlug) >= 0) await _loadSource('Skymovies', href, page, ctx);
      } else {
        await _loadSource('Skymovies(Combined)', href, page, ctx);
      }
    }
  }
}

// ── 47. KissKH ─────────────────────────────────────────────────────────
async function provKisskh(r, ctx) {
  if (!r.isAsian || !r.title) return;
  var base = API.kisskh;
  var slug = _slug(r.title);
  var type = r.season == null ? '2' : '1';
  var resRaw = await _get(base + '/api/DramaList/Search?q=' + _quote(r.title) + '&type=' + type, {
    headers: { Referer: base + '/' }, timeoutMs: 12000
  });
  var res = _parseJson(resRaw);
  if (!Array.isArray(res) || !res.length) return;
  var picked = null;
  if (res.length === 1) picked = res[0];
  else {
    for (var i = 0; i < res.length; i++) {
      var t = String(res[i].title || ''), ts = _slug(t);
      if (!ts) continue;
      var ok = false;
      if (r.season == null) ok = ts === slug;
      else if (r.season === 1) ok = ts === slug || (ts.indexOf(slug) >= 0 && (t.indexOf(String(r.year || '')) >= 0 || /season 1/i.test(t)));
      else ok = ts.indexOf(slug) >= 0 && new RegExp('season ' + r.season, 'i').test(t);
      if (ok) { picked = res[i]; break; }
    }
    if (!picked) {
      for (var k = 0; k < res.length; k++) if (String(res[k].title || '').toLowerCase() === r.title.toLowerCase()) { picked = res[k]; break; }
    }
  }
  if (!picked || !picked.id) return;
  var detailRef = base + '/Drama/' + _urlTitle(picked.title || r.title) + '?id=' + picked.id;
  var detail = _parseJson(await _get(base + '/api/DramaList/Drama/' + picked.id + '?isq=false', { headers: { Referer: detailRef }, timeoutMs: 12000 }));
  if (!detail || !Array.isArray(detail.episodes)) return;
  var epsId = null;
  if (r.season == null) epsId = detail.episodes[0] && detail.episodes[0].id;
  else {
    for (var e = 0; e < detail.episodes.length; e++) if (Number(detail.episodes[e].number) === Number(r.episode)) { epsId = detail.episodes[e].id; break; }
  }
  if (epsId == null) return;
  var vidKeyJson = _parseJson(await _get(MULTI + '/enc-kisskh?text=' + _quote(epsId) + '&type=vid', { headers: { Referer: base }, timeoutMs: 12000 }));
  if (!vidKeyJson || !vidKeyJson.result) return;
  var srcJson = _parseJson(await _get(base + '/api/DramaList/Episode/' + epsId + '.png?err=false&ts=&time=&kkey=' + _quote(vidKeyJson.result), { headers: { Referer: base }, timeoutMs: 12000 }));
  if (!srcJson) return;
  var links = [srcJson.video, srcJson.thirdParty];
  for (var s = 0; s < links.length; s++) {
    var link = links[s];
    if (!link) continue;
    if (/\.m3u8|\.mp4/i.test(link)) {
      _emitH(ctx, _abs(link, base), 720, 'Kisskh', null, { Referer: base, Origin: base }, null, null);
    } else {
      var cleaned = link.split('?')[0];
      if (cleaned) await _loadSource('Kisskh', cleaned, base + '/', ctx, 720);
    }
  }
  var subKeyJson = _parseJson(await _get(MULTI + '/enc-kisskh?text=' + _quote(epsId) + '&type=sub', { timeoutMs: 12000 }));
  if (subKeyJson && subKeyJson.result) {
    var subs = _parseJson(await _get(base + '/api/Sub/' + epsId + '?kkey=' + _quote(subKeyJson.result), { headers: { Referer: base }, timeoutMs: 12000 }));
    if (Array.isArray(subs)) for (var x = 0; x < subs.length; x++) {
      if (subs[x].label && subs[x].src) ctx.sub(subs[x].label, _abs(subs[x].src, base), 'Kisskh');
    }
  }
}

// ── 48. Onetouchtv ─────────────────────────────────────────────────────
async function provOnetouchtv(r, ctx) {
  if (!r.title || !r.year) return;
  var base = API.onetouch;
  var query = r.title;
  if (r.season != null && r.season !== 1) query += ' Season ' + r.season + ' (' + r.year + ')';
  else query += ' (' + r.year + ')';
  var enc = await _get(base + '/vod/search?page=1&keyword=' + _quote(query), { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  if (!enc) return;
  var dec = await _jsonPost(MULTI + '/dec-onetouchtv', { text: enc }, { Referer: base + '/' }, 15000);
  var items = dec && dec.result;
  if (typeof items === 'string') items = _parseJson(items);
  if (!Array.isArray(items)) return;
  var match = null;
  for (var i = 0; i < items.length; i++) if (String(items[i].title || '').toLowerCase() === query.toLowerCase()) { match = items[i]; break; }
  if (!match || match.id == null) return;
  var epEnc = await _get(base + '/web/vod/' + match.id + '/episode/' + (r.episode || 0), { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  if (!epEnc) return;
  var epDec = await _jsonPost(MULTI + '/dec-onetouchtv', { text: epEnc }, { Referer: base + '/' }, 15000);
  var data = epDec && epDec.result;
  if (typeof data === 'string') data = _parseJson(data);
  if (!data) return;
  var sources = Array.isArray(data.sources) ? data.sources : [];
  for (var s = 0; s < sources.length; s++) {
    var src = sources[s];
    if (!src || !src.url) continue;
    var q = _quality(src.quality) || 1080;
    _emitH(ctx, src.url, q, 'Onetouchtv', /hls|m3u8/i.test(src.type || '') ? 'hls' : null, src.headers || {}, null, null);
  }
  var track = Array.isArray(data.track) ? data.track : [];
  for (var t = 0; t < track.length; t++) if (track[t] && track[t].file) ctx.sub(track[t].name || 'Unknown', track[t].file, 'Onetouchtv');
}

// ── 49. Toonstream ─────────────────────────────────────────────────────
async function provToonstream(r, ctx) {
  if (!(r.isAnime || r.isCartoon) || !r.title) return;
  var base = await _dyn('toonstream');
  if (!base) return;
  var slug = _slug(r.title);
  var url = r.season == null ? base + '/movies/' + slug + '/' : base + '/episode/' + slug + '-' + r.season + 'x' + (r.episode || 1) + '/';
  var html = await _get(url, { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  if (!html) return;
  var iframes = [];
  var re = /<div[^>]*class="[^"]*\bvideo\b[^"]*"[^>]*>[\s\S]*?<iframe\b([^>]*)>/gi, m;
  while ((m = re.exec(html)) !== null) iframes.push(_attr(m[1], 'data-src') || _attr(m[1], 'src'));
  for (var i = 0; i < iframes.length; i++) {
    var src = _abs(iframes[i], base);
    if (!src) continue;
    var page = await _get(src, { headers: { Referer: url }, timeoutMs: 15000 });
    var inner = [], r2 = /<div[^>]*class="[^"]*\bVideo\b[^"]*"[^>]*>[\s\S]*?<iframe\b([^>]*)>/gi, m2;
    while ((m2 = r2.exec(page || '')) !== null) inner.push(_attr(m2[1], 'src'));
    for (var k = 0; k < inner.length; k++) if (inner[k]) await _loadSource('ToonStream', inner[k], base + '/', ctx);
  }
}

// ── 50. Anineko ────────────────────────────────────────────────────────
async function provAnineko(r, ctx) {
  if (!r.title) return;
  var base = API.anineko;
  var raw = await _get(base + '/ajax/search?q=' + _quote(r.title), { headers: { Referer: base + '/', 'X-Requested-With': 'XMLHttpRequest' }, timeoutMs: 15000 });
  var data = _parseJson(raw);
  var first = data && data.results && data.results[0];
  if (!first || !first.url) return;
  var epUrl = base + first.url + '/ep-' + (r.episode || 1);
  var html = await _get(epUrl, { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  if (!html) return;
  var re = /<button[^>]*class="[^"]*server-video[^"]*"([^>]*)>([\s\S]*?)<\/button>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var attrs = m[1], inner = m[2];
    var rawUrl = _attr(attrs, 'data-video');
    if (!rawUrl) continue;
    var serverName = _text(inner);
    var typeM = inner.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
    var type = typeM ? _text(typeM[1]) : 'SUB';
    var vttRe = /(https?:\/\/[^&"']+\.vtt)/g, vm;
    var langM = /(?:sub_1|c1_label)=([^&]+)/.exec(rawUrl);
    var lang = langM ? decodeURIComponent(langM[1]) : 'English';
    while ((vm = vttRe.exec(rawUrl)) !== null) ctx.sub(lang, vm[1], 'Anineko');
    await _loadSource('Anineko ' + serverName + ' [' + type + ']', rawUrl, base + '/', ctx);
  }
}

// ── 51. Animedao ───────────────────────────────────────────────────────
function _qp(u, name) {
  var m = new RegExp('[?&]' + name + '=([^&]*)').exec(String(u || ''));
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
}
async function provAnimedao(r, ctx) {
  var base = await _dyn('animedao');
  if (!base || !r.title) return;
  var q = r.originalTitle || r.imdbTitle || r.title;
  var search = base + '/search.html?keyword=' + _quote(q) + '&year%5B%5D=' + (r.year || '') + '&sort=title_az';
  var html = await _get(search, { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  var href = _first(/<article[^>]*class="[^"]*an-anime-card[^"]*"[^>]*>[\s\S]*?<a\b[^>]*href="([^"]+)"/i, html, 1);
  if (!href && q !== r.title) {
    html = await _get(base + '/search.html?keyword=' + _quote(r.title) + '&year%5B%5D=&sort=title_az', { headers: { Referer: base + '/' }, timeoutMs: 15000 });
    href = _first(/<article[^>]*class="[^"]*an-anime-card[^"]*"[^>]*>[\s\S]*?<a\b[^>]*href="([^"]+)"/i, html, 1);
  }
  if (!href) {
    html = await _get(base + '/search?q=' + _quote(q), { headers: { Referer: base + '/' }, timeoutMs: 15000 });
    href = _first(/<article[^>]*class="[^"]*an-anime-card[^"]*"[^>]*>[\s\S]*?<a\b[^>]*href="([^"]+)"/i, html, 1);
  }
  if (!href) return;
  var showUrl = href.replace('/anime/', '/watch-online/');
  var page = await _get(base + showUrl + '-episode-' + (r.episode || 1), { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  if (!page) return;
  var pre = /<div[^>]*class="[^"]*an-server-panel[^"]*"([^>]*)>([\s\S]*?)(?=<div[^>]*class="[^"]*an-server-panel|<\/body|$)/gi, pm;
  while ((pm = pre.exec(page)) !== null) {
    var type = _cap(_attr(pm[1], 'data-an-panel'));
    var block = pm[2];
    var bre = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi, bm;
    while ((bm = bre.exec(block)) !== null) {
      var rawUrl = _attr(bm[1], 'data-an-video');
      if (!rawUrl) continue;
      var span = bm[2].match(/<span[^>]*>([\s\S]*?)<\/span>/i);
      var server = span ? _text(span[1]) : '';
      var subUrl = _qp(rawUrl, 'sub') || _qp(rawUrl, 'caption_1') || _qp(rawUrl, 'c1_file');
      var subLang = _qp(rawUrl, 'sub_1') || _qp(rawUrl, 'c1_label') || 'English';
      if (subUrl) ctx.sub(subLang, _abs(subUrl, base), 'Animedao');
      await _loadSource('Animedao[' + type + '] ' + server, rawUrl, base + '/', ctx);
    }
  }
}

// ── 52. Anikoto ────────────────────────────────────────────────────────
async function provAnikoto(r, ctx) {
  var base = API.anikoto;
  var term = r.imdbTitle || r.title;
  if (!term) return;
  var html = await _get(base + '/filter?keyword=' + _quote(term) + '&type=&year%5B%5D=' + (r.year || '') + '&ep_min=&ep_max=&sort=default', { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  var tip = _first(/<div[^>]*class="[^"]*\btip\b[^"]*\bani\b[^"]*"[^>]*data-tip="([^"]+)"/i, html, 1);
  if (!tip) return;
  var hdr = { Referer: base + '/', 'X-Requested-With': 'XMLHttpRequest' };
  var listJson = _parseJson(await _get(base + '/ajax/episode/list/' + tip + '?vrf=', { headers: hdr, timeoutMs: 15000 }));
  if (!listJson || !listJson.result) return;
  var epA = new RegExp('<a\\b[^>]*data-num=["\']' + (r.episode || 1) + '["\'][^>]*data-ids=["\']([^"\']+)', 'i').exec(listJson.result) ||
            new RegExp('data-ids=["\']([^"\']+)["\'][^>]*data-num=["\']' + (r.episode || 1) + '["\']', 'i').exec(listJson.result);
  if (!epA) return;
  var dataIds = epA[1];
  var serversJson = _parseJson(await _get(base + '/ajax/server/list?servers=' + dataIds, { headers: hdr, timeoutMs: 15000 }));
  if (!serversJson || !serversJson.result) return;
  var tre = /<div[^>]*class="[^"]*\btype\b[^"]*"[^>]*data-type="([^"]*)"[^>]*>([\s\S]*?)<\/div>/gi, tm;
  var types = [];
  while ((tm = tre.exec(serversJson.result)) !== null) types.push({ type: _cap(tm[1]), html: tm[2] });
  if (!types.length) types.push({ type: '', html: serversJson.result });
  for (var i = 0; i < types.length; i++) {
    var lre = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi, lm;
    while ((lm = lre.exec(types[i].html)) !== null) {
      var linkId = _attr(lm[1], 'data-link-id');
      if (!linkId) continue;
      var serverName = _text(lm[2]);
      var sr = _parseJson(await _get(base + '/ajax/server?get=' + _quote(linkId), { headers: hdr, timeoutMs: 15000 }));
      var embed = sr && sr.result && sr.result.url;
      if (!embed) continue;
      await _loadSource('Anikoto[' + types[i].type + '] ' + serverName, embed, base + '/', ctx);
    }
  }
}

// ── 53. Anikage ────────────────────────────────────────────────────────
async function provAnikage(r, ctx) {
  if (!r.title || r.anilistId == null) return;
  var base = API.anikage;
  var search = _parseJson(await _get(base + '/api/media/anime/browse?q=' + _quote(r.title) + '&sort=popularity&page=1&limit=25&adult=true', { headers: { Referer: base + '/' }, timeoutMs: 8000 }));
  var arr = search && search.data;
  if (!Array.isArray(arr)) return;
  var match = null;
  for (var i = 0; i < arr.length; i++) if (Number(arr[i].anilistId) === Number(r.anilistId)) { match = arr[i]; break; }
  if (!match || !match.slug) return;
  var ep = r.episode || 1;
  var srv = _parseJson(await _get(base + '/api/media/anime/' + match.slug + '/episodes/' + ep + '/servers', { headers: { Referer: base + '/' }, timeoutMs: 8000 }));
  if (!srv || !Array.isArray(srv.servers)) return;
  var langs = ['sub', 'dub'];
  var tasks = [];
  for (var s = 0; s < srv.servers.length; s++) {
    var server = srv.servers[s] && srv.servers[s].id;
    if (!server) continue;
    for (var l = 0; l < langs.length; l++) tasks.push({ server: server, lang: langs[l] });
  }
  await _parallel(tasks, 8, async function (t) {
    var sourceRes = _parseJson(await _get(base + '/api/media/anime/' + match.slug + '/episodes/' + ep + '/sources?provider=' + _quote(t.server) + '&lang=' + _quote(t.lang), { headers: { Referer: base + '/' }, timeoutMs: 8000 }));
    if (!sourceRes) return null;
    var label = 'Anikage[' + _cap(t.server) + '] ' + _cap(t.lang);
    var srcs = Array.isArray(sourceRes.sources) ? sourceRes.sources : [];
    for (var k = 0; k < srcs.length; k++) {
      if (!srcs[k] || !srcs[k].url) continue;
      var proxied = 'https://og.bakayaro.live/' + (srcs[k].isM3U8 ? 'm3u8' : 'stream') + '/' + srcs[k].url;
      _emitH(ctx, proxied, 1080, label, srcs[k].isM3U8 ? 'hls' : null, { Referer: base + '/' }, null, null);
    }
    var embeds = Array.isArray(sourceRes.embeds) ? sourceRes.embeds : [];
    for (var e = 0; e < embeds.length; e++) {
      if (embeds[e] && embeds[e].url) await _loadSource('Anikage [' + _cap(embeds[e].type) + ']', embeds[e].url, base + '/', ctx);
    }
    var subs = Array.isArray(sourceRes.subtitles) ? sourceRes.subtitles : [];
    for (var q = 0; q < subs.length; q++) if (subs[q] && subs[q].file) ctx.sub(subs[q].label || 'Unknown', subs[q].file, 'Anikage');
    return null;
  });
}

// ── 54. Anidb ──────────────────────────────────────────────────────────
async function provAnidb(r, ctx) {
  var base = API.anidb;
  var term = r.imdbTitle || r.title;
  if (!term) return;
  var html = await _get(base + '/browse?q=' + _quote(term) + '&type=&status=&season=&year=' + (r.year || '') + '&genres=&sort=order_top', { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  var href = _first(/<div[^>]*class="[^"]*anime-grid[^"]*"[^>]*>[\s\S]*?<a\b[^>]*href="([^"]+)"/i, html, 1);
  if (!href) return;
  var id = href.split('-').pop();
  var eps = _parseJson(await _get(base + '/api/frontend/anime/' + id + '/episodes', { headers: { Referer: base + '/' }, timeoutMs: 15000 }));
  if (!eps || !Array.isArray(eps.episodes)) return;
  var entry = eps.episodes[(r.episode || 1) - 1];
  if (!entry || entry.id == null) return;
  var langs = _parseJson(await _get(base + '/api/frontend/episode/' + entry.id + '/languages', { headers: { Referer: base + '/' }, timeoutMs: 15000 }));
  if (!langs || !Array.isArray(langs.languages)) return;
  for (var i = 0; i < langs.languages.length; i++) {
    var lang = langs.languages[i];
    if (!lang || !lang.embedUrl) continue;
    var page = await _get(lang.embedUrl, { headers: { Referer: base + '/' }, timeoutMs: 15000 });
    var m = /file:\s*'([^']+)'/.exec(page || '');
    if (!m) continue;
    _emitH(ctx, m[1], 1080, 'Anidb ' + (lang.code === 'eng' ? '[DUB]' : '[SUB]'), 'hls', { Referer: lang.embedUrl }, null, null);
  }
}

// ── 55. AnimeTosho (HTTP) ──────────────────────────────────────────────
async function provAnimetoshoHttp(r, ctx) {
  if (!r.title || r.malId == null) return;
  var map = _parseJson(await _get(API.anizip + '/mappings?mal_id=' + r.malId, { timeoutMs: 12000 }));
  var entry = map && map.episodes && map.episodes[String(r.episode || 1)];
  var eid = entry && entry.anidbEid;
  if (eid == null) return;
  var html = await _get(API.animetoshoBase + '/episode/' + eid, { headers: { Referer: API.animetoshoBase + '/' }, timeoutMs: 15000 });
  if (!html) return;
  var blocks = _all(/<div[^>]*class="[^"]*home_list_entry[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, html);
  if (!blocks.length) blocks = html.split(/<div[^>]*class="[^"]*home_list_entry[^"]*"[^>]*>/i).slice(1);
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    var titleM = /<div[^>]*class="[^"]*link[^"]*"[^>]*>[\s\S]*?<a\b([^>]*)>/i.exec(block);
    var text = titleM ? (_attr(titleM[1], 'title') || _text(block)) : _text(block);
    var size = _packSize(_first(/<div[^>]*class="[^"]*size[^"]*"[^>]*>([\s\S]*?)<\/div>/i, block, 1));
    var quality = _quality(text);
    var type = /dual audio|dub/i.test(text) ? 'DUB' : 'SUB';
    var are = /<div[^>]*class="[^"]*links[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block);
    var linksHtml = are ? are[1] : block;
    var lre = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, lm;
    while ((lm = lre.exec(linksHtml)) !== null) {
      var href = _attr(lm[1], 'href');
      var atext = _text(lm[2]);
      if (!href || /torrent|magnet/i.test(atext)) continue;
      await _loadSource('Animetosho[' + type + ']', href, API.animetoshoBase + '/', ctx, quality, size);
    }
  }
}

// ── 56. TokyoInsider ───────────────────────────────────────────────────
async function provTokyoinsider(r, ctx) {
  var base = API.tokyoInsider;
  var title = r.originalTitle || r.title;
  if (!title) return;
  var first = /^[A-Za-z]/.test(title) ? title.charAt(0).toUpperCase() : '0';
  var tvtype = r.episode == null ? '_(Movie)' : '_(TV)';
  var slug = title.replace(/ /g, '_');
  var html = await _get(base + '/anime/' + first + '/' + slug + tvtype, { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  if (!html) return;
  var anchors = [], re = /<a\b([^>]*class="[^"]*download-link[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) anchors.push({ href: _attr(m[1], 'href'), text: _text(m[2]) });
  if (!anchors.length) return;
  var pick = anchors[0];
  if (r.episode != null) {
    for (var i = 0; i < anchors.length; i++) if (new RegExp('episode ' + (r.episode) + '\\b', 'i').test(anchors[i].text)) { pick = anchors[i]; break; }
  }
  if (!pick.href) return;
  var page = await _get(_abs(pick.href, base), { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  var lre = /<div[^>]*class="[^"]*c_h2[^"]*"[^>]*>[\s\S]*?<div[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>/gi, lm;
  while ((lm = lre.exec(page || '')) !== null) {
    var href = _attr(lm[1], 'href');
    var name = _text(lm[2]);
    if (!href) continue;
    _emitH(ctx, _abs(href, base), _quality(name) || 720, '[TokyoInsider] - ' + name, null, { Referer: base + '/' }, null, null);
  }
}

// ── 57. Anizone ────────────────────────────────────────────────────────
async function provAnizone(r, ctx) {
  var base = API.anizone;
  var title = r.originalTitle || r.title;
  if (!title) return;
  var html = await _get(base + '/anime?search=' + _quote(title), { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  var link = _first(/<div[^>]*class="[^"]*truncate[^"]*"[^>]*>[\s\S]*?<a\b[^>]*href="([^"]+)"/i, html, 1);
  if (!link) return;
  var page = await _get(_abs(link, base) + '/' + (r.episode || 1), { headers: { Referer: base + '/' }, timeoutMs: 15000 });
  if (!page) return;
  var tre = /<track\b([^>]*)>/gi, tm;
  while ((tm = tre.exec(page)) !== null) {
    var src = _attr(tm[1], 'src');
    if (src) ctx.sub(_attr(tm[1], 'label') || 'Unknown', _abs(src, base), 'Anizone');
  }
  var srcM = /<media-player\b([^>]*)>/i.exec(page);
  var media = srcM ? _attr(srcM[1], 'src') : '';
  if (media) _emitH(ctx, _abs(media, base), 1080, 'Anizone Multi Audio 🌐', 'hls', { Referer: base + '/' }, null, null);
}

// ── 58. Animekizz ──────────────────────────────────────────────────────
async function provAnimekizz(r, ctx) {
  if (!r.title || r.anilistId == null) return;
  var base = API.animekizz;
  var query = r.title.replace(/ /g, '-') + '-' + r.anilistId + ':' + (r.episode || 1);
  var srv = _parseJson(await _get(base + '/api/v1/video/servers/' + query, { headers: { Referer: base + '/' }, timeoutMs: 8000 }));
  if (!srv || !Array.isArray(srv.servers)) return;
  await _parallel(srv.servers, 8, async function (s) {
    if (!s || !s.id) return null;
    var name = _cap(s.name), stype = _cap(s.server_type);
    var rr = await _postJson(base + '/api/v1/video/resolve', { episode_id: query, server_id: s.id }, { headers: { Referer: base + '/' }, timeoutMs: 8000 });
    var resolve = rr && typeof rr.body === 'string' ? _parseJson(rr.body) : null;
    if (!resolve || !Array.isArray(resolve.sources)) return null;
    for (var k = 0; k < resolve.sources.length; k++) {
      var src = resolve.sources[k];
      if (!src || !src.url) continue;
      var u = src.url.indexOf('/proxy/') === 0 ? base + src.url : src.url;
      var q = src.quality === 'auto' ? 1080 : (_quality(src.quality) || 1080);
      _emitH(ctx, u, q, 'Animekizz [' + name + '] [' + stype + ']', /hls/i.test(src.format || '') ? 'hls' : null, { Referer: base + '/', Origin: base }, null, null);
    }
    return null;
  });
}

// ── 59. Wyzie Subs (subtitles only) ────────────────────────────────────
async function provWyzie(r, ctx) {
  var key = _str('wyzieSubsKey', '');
  if (!key || !r.imdbId) return;
  var id = String(r.imdbId);
  var url = WYZIE + '/search?id=' + _quote(id) + (r.season != null ? '&season=' + r.season + '&episode=' + (r.episode || 1) : '') + '&source=all&key=' + _quote(key);
  var list = _parseJson(await _get(url, { headers: { Accept: 'application/json' }, timeoutMs: 10000 }));
  if (!Array.isArray(list)) return;
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (!s || !s.url) continue;
    ctx.sub(s.display || s.language || 'Unknown', s.url, 'WyzieSubs');
  }
}

// ── Orchestrator ───────────────────────────────────────────────────────
var PROVIDER_FN = {
  p_showbox: provShowbox, p_vidrock: provVidrock, p_moviebox: provMoviebox,
  p_movieblast: provMovieblast, p_fibwatch: provFibwatch, p_allmovieland: provAllmovieland,
  p_hdhub4u: provHdhub4u, p_hexa: provHexa, p_fshare: provFshare, p_videasy: provVideasy,
  p_vaplayer: provVaplayer, p_vidzee: provVidzee, p_peachify: provPeachify,
  p_vidfastpro: provVidfastpro, p_cinejoy: provCinejoy, p_vidcore: provVidcore,
  p_av1encodes: provAv1encodes, p_castle: provCastle, p_reanime: provReanime,
  p_just4anime: provJust4anime, p_zinkmovies: provZinkmovies, p_bollywood: provBollywood,
  p_vegamovies: provVegamovies, p_rogmovies: provRogmovies, p_bollyflix: provBollyflix,
  p_topmovies: provTopmovies, p_vidup: provVidup, p_meowtv: provMeowtv,
  p_moviesmod: provMoviesmod, p_movies4u: provMovies4u, p_dudefilms: provDudefilms,
  p_uhdmovies: provUhdmovies, p_moviesdrive: provMoviesdrive, p_hindmoviez: provHindmoviez,
  p_4khdhub: prov4khdhub, p_primesrc: provPrimesrc, p_projectfreetv: provProjectfreetv,
  p_mlsbd: provMlsbd, p_levidia: provLevidia, p_animesalt: provAnimesalt,
  p_m4ufree: provM4ufree, p_multimovies: provMultimovies, p_akwam: provAkwam,
  p_rtally: provRtally, p_asiaflix: provAsiaflix, p_skymovies: provSkymovies,
  p_kisskh: provKisskh, p_onetouchtv: provOnetouchtv, p_toonstream: provToonstream,
  p_anineko: provAnineko, p_animedao: provAnimedao, p_anikoto: provAnikoto,
  p_anikage: provAnikage, p_anidb: provAnidb, p_animetoshohttp: provAnimetoshoHttp,
  p_tokyoinsider: provTokyoinsider, p_anizone: provAnizone, p_animekizz: provAnimekizz,
  p_wyziesubs: provWyzie
};
// Providers that are anime-only in the upstream registry.
var ANIME_ONLY = {
  p_anineko: 1, p_animedao: 1, p_anikoto: 1, p_anikage: 1, p_anidb: 1,
  p_animetoshohttp: 1, p_tokyoinsider: 1, p_anizone: 1, p_animekizz: 1
};

async function _runProvider(key, r, ctx) {
  var fn = PROVIDER_FN[key];
  if (!fn) return;
  if (ANIME_ONLY[key] && !r.isAnime) return;
  var local = { emit: ctx.emit, sub: ctx.sub, includeDownloads: ctx.includeDownloads };
  try { await fn(r, local); }
  catch (e) { console.warn('CineStream provider ' + (PROVIDER_NAMES[key] || key) + ' failed: ' + (e && e.message || e)); }
}

function _providerEnabled(key) {
  var list = _enabledProviders();
  for (var i = 0; i < list.length; i++) if (list[i] === key) return true;
  return false;
}

async function getVideoSources(id, fast) {
  var r = _sid(id);
  var out = [], subs = [], seen = {};
  if (!r.imdbId && !r.title) return out;
  var opt = fast && typeof fast === 'object' ? fast : {};
  var onSub = typeof opt.onSubtitle === 'function' ? opt.onSubtitle : null;
  var ctx = {
    includeDownloads: _bool('includeDownloadLinks', false),
    emit: function (s) {
      if (!s || !s.url || seen[s.url]) return;
      seen[s.url] = 1;
      out.push(s);
    },
    sub: function (lang, url, source) {
      var s = _sub(url, lang, null);
      if (!s) return;
      var k = s.url + '|' + s.lang;
      if (seen[k]) return;
      seen[k] = 1;
      s.source = source || 'CineStream';
      subs.push(s);
      if (onSub) { try { onSub(s); } catch (e) {} }
    }
  };
  var keys = [];
  for (var i = 0; i < PROVIDERS.length; i++) if (_providerEnabled(PROVIDERS[i][0]) && PROVIDERS[i][0] !== 'p_wyziesubs') keys.push(PROVIDERS[i][0]);
  // Run ALL enabled providers concurrently (matching upstream CineStream behavior
  // which invokes every provider). The overall budget race prevents slow/dead
  // providers from blocking playback past Zangetsu's ~20s ceiling. Providers
  // that work return results; providers that don't fail independently without
  // preventing other providers from returning streams.
  var limit = _num('concurrency', 10);
  await _race(_parallel(keys, limit, function (key) { return _runProvider(key, r, ctx); }), SOURCES_BUDGET_MS, null);
  if (_providerEnabled('p_wyziesubs')) await _runProvider('p_wyziesubs', r, ctx);
  // Zangetsu's VideoSource carries subtitles per stream. Providers may have
  // already attached their own; otherwise inherit the collected set.
  if (subs.length) {
    for (var o = 0; o < out.length; o++) {
      if (!out[o].subtitles || !out[o].subtitles.length) out[o].subtitles = subs.slice();
    }
  }
  return out;
}
async function getStreams(id, fast) { return getVideoSources(id, fast); }

// ── Exports ────────────────────────────────────────────────────────────
var _api = {
  version: VERSION, getInfo: getInfo, getSettings: getSettings,
  getHome: getHome, popular: popular, search: search,
  getDetail: getDetail, getEpisodes: getEpisodes,
  getVideoSources: getVideoSources, getStreams: getStreams,
  _enabledProviders: _enabledProviders, _providers: PROVIDERS,
  _debug: {
    quality: _quality, slug: _slug, eu: _eu, sid: _sid,
    abs: _abs, wpRedirect: _wpRedirect, hdhubLinks: _hdhubLinks,
    hdhubHitMatches: _hdhubHitMatches, anizipIds: _aniZipIds, normTitle: _normTitle,
    b64d: _b64d, b64e: _b64e,
    hubCloud: _hubCloud, runProvider: _runProvider, animeIds: _animeIdsCached,
    decryptVidzee: _decryptVidzee, decryptVidrock: _decryptVidrock,
    decryptPeachify: _decryptPeachify, sha256Hex: _sha256Hex, hmacSha256Hex: _hmacSha256Hex
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = _api;
else if (typeof globalThis !== 'undefined') globalThis.CineStream = _api;
