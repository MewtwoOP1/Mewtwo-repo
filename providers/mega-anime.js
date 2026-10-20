// Mega-Anime: AniList metadata with playback backed by the actual AniWaves
// and AniNami APIs from KSHITIJ8473/raghav/RaghavAnime.
// Keep this provider self-contained for Zangetsu's source runtime.
var SOURCE_ID = 'mega-anime';
var ANILIST = 'https://graphql.anilist.co';
var DEFAULT_ANI_WAVES = 'https://aniwaves.ru';
var DEFAULT_ANI_NAMI = 'https://www.aninami.site';
var ANI_WAVES = DEFAULT_ANI_WAVES;
var ANI_NAMI = DEFAULT_ANI_NAMI;
var DOMAIN_LOOKUP = 'https://cloudstreampluginhelper-default-rtdb.firebaseio.com/.json';
var DOMAIN_CACHE = null;
var DOMAIN_CACHE_AT = 0;
var DOMAIN_CACHE_TTL_MS = 5 * 60 * 1000;
var DOMAIN_LOAD_PROMISE = null;
var MEDIA_CACHE = {};
var MEDIA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

var MEDIA_FIELDS = 'id idMal title{romaji english native} coverImage{extraLarge large} bannerImage description(asHtml:false) status genres studios(isMain:true){nodes{name}} episodes format averageScore seasonYear nextAiringEpisode{episode}';
var SEARCH_QUERY = 'query($search:String,$page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){media(search:$search,type:ANIME,sort:POPULARITY_DESC){' + MEDIA_FIELDS + '}}}';
var HOME_QUERY = 'query($sort:[MediaSort],$page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){media(type:ANIME,sort:$sort){' + MEDIA_FIELDS + '}}}';
var DETAIL_QUERY = 'query($id:Int){Media(id:$id,type:ANIME){' + MEDIA_FIELDS + '}}';

function _anilist(query, variables) {
  return fetch(ANILIST, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': UA
  }, body: JSON.stringify({ query: query, variables: variables || {} }) }).then(function (r) {
    if (r.status < 200 || r.status >= 300) throw new Error('AniList HTTP ' + r.status);
    return r.json();
  }).then(function (body) {
    if (body.errors && body.errors.length) throw new Error('AniList: ' + body.errors[0].message);
    return body;
  });
}
function _cacheMedia(m) {
  if (!m || !(Number(m.id) > 0)) return;
  MEDIA_CACHE[String(m.id)] = { value: m, at: Date.now() };
  var keys = Object.keys(MEDIA_CACHE);
  if (keys.length > 100) {
    keys.sort(function (a, b) { return MEDIA_CACHE[a].at - MEDIA_CACHE[b].at; });
    while (keys.length > 100) delete MEDIA_CACHE[keys.shift()];
  }
}
function _cachedMedia(id) {
  var item = MEDIA_CACHE[String(id)];
  if (!item) return null;
  if (!item.at || Date.now() - item.at > MEDIA_CACHE_TTL_MS) {
    delete MEDIA_CACHE[String(id)];
    return null;
  }
  return item.value || null;
}
function _cacheMediaList(list) { (list || []).forEach(_cacheMedia); }
function _titleOf(m) { return m && m.title ? (m.title.english || m.title.romaji || m.title.native || 'Unknown') : 'Unknown'; }
function _coverOf(m) { return m && m.coverImage ? (m.coverImage.extraLarge || m.coverImage.large || null) : null; }
function _typeOf(m) { return m && m.format === 'MOVIE' ? 'movie' : 'anime'; }
function _mediaToItem(m) {
  _cacheMedia(m);
  return { id: 'anilist:' + m.id, title: _titleOf(m), url: 'anilist:' + m.id,
    cover: _coverOf(m), type: _typeOf(m), sourceId: SOURCE_ID };
}
// IDs are opaque identifiers. Accept only an unsigned, positive numeric ID in a known
// namespace; never shift IDs with +/- offsets or extract digits from arbitrary text.
function _positiveNumericId(value) {
  var s = String(value == null ? '' : value);
  if (!/^\d+$/.test(s)) return null;
  var n = Number(s);
  return isFinite(n) && n > 0 && Math.floor(n) === n ? n : null;
}
function _parseId(url) {
  var s = String(url || '');
  var m = s.match(/^anilist:(\d+)$/i)
    || s.match(/^mega-anime:(\d+)$/i)
    || s.match(/^(\d+)$/);
  if (!m) return 0;
  var id = _positiveNumericId(m[1]);
  return id === null ? 0 : id;
}
function _episodesFor(media, opts) {
  var kind = String(opts && opts.category || 'sub').toLowerCase() === 'dub' ? 'dub' : 'sub';
  var count = Number(media.episodes) || 0;
  if (media.nextAiringEpisode && Number(media.nextAiringEpisode.episode) > 0) {
    var released = Number(media.nextAiringEpisode.episode) - 1;
    if (!count || released < count) count = released;
  }
  if (count < 1 && media.format === 'MOVIE') count = 1;
  if (count < 1) count = 1;
  var out = [];
  for (var i = 1; i <= count; i++) {
    var id = 'mega-anime:' + media.id + ':' + i + ':' + kind;
    out.push({ id: id, title: 'Episode ' + i, number: i, url: id, date: null });
  }
  return out;
}
function _text(s) {
  return String(s || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function _abs(base, u) {
  if (!u) return '';
  try { return new URL(u, base).toString(); } catch (e) { return /^https?:\/\//i.test(u) ? u : ''; }
}

function _domainBase(value, fallback) {
  var s = String(value || '').trim();
  if (!s) return fallback;
  if (!/^https?:\\/\\//i.test(s)) s = 'https://' + s;
  return s.replace(/\\/+$/, '');
}
function _refreshDomains() {
  if (DOMAIN_CACHE && Date.now() - DOMAIN_CACHE_AT < DOMAIN_CACHE_TTL_MS) return Promise.resolve(DOMAIN_CACHE);
  if (DOMAIN_LOAD_PROMISE) return DOMAIN_LOAD_PROMISE;
  DOMAIN_LOAD_PROMISE = fetch(DOMAIN_LOOKUP, { headers: { 'Accept': 'application/json', 'User-Agent': UA }, timeoutMs: 5000 })
    .then(function (r) {
      if (!r || (r.status && (r.status < 200 || r.status >= 300))) throw new Error('HTTP ' + (r && r.status));
      if (typeof r.json === 'function') return r.json();
      if (typeof r.text === 'function') return r.text().then(function (s) { return JSON.parse(s); });
      return JSON.parse(String(r.body || '{}'));
    }).then(function (data) {
      var d = data && typeof data === 'object' ? data : {};
      var wave = d.aniwaves || d.aniwaves_url || d.aniwaves_domain;
      var nami = d.aninami || d.aninami_url || d.aninami_domain;
      if (typeof wave === 'string' && wave.trim()) ANI_WAVES = _domainBase(wave, DEFAULT_ANI_WAVES);
      if (typeof nami === 'string' && nami.trim()) ANI_NAMI = _domainBase(nami, DEFAULT_ANI_NAMI);
      DOMAIN_CACHE = d;
      DOMAIN_CACHE_AT = Date.now();
      return d;
    }).catch(function (e) {
      DOMAIN_CACHE = DOMAIN_CACHE || {};
      DOMAIN_CACHE_AT = Date.now();
      console.warn('[mega-anime] domain discovery failed; using fallback domains: ' + (e && e.message || e));
      return DOMAIN_CACHE;
    }).then(function (d) { DOMAIN_LOAD_PROMISE = null; return d; });
  return DOMAIN_LOAD_PROMISE;
}

function _requestText(url, referer, ajax) {
  var headers = { 'User-Agent': UA, 'Accept': '*/*', 'Referer': referer || url };
  if (ajax) headers['X-Requested-With'] = 'XMLHttpRequest';
  var origin = ((headers.Referer || '').match(/^(https?:\\/\\/[^/]+)/i) || [])[1];
  if (ajax && origin) headers.Origin = origin;
  return fetch(url, { headers: headers, timeoutMs: 15000 }).then(function (r) {
    if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status + ' for ' + url);
    if (typeof r.text === 'function') return r.text();
    if (typeof r.body === 'string') return r.body;
    return '';
  });
}
function _requestJson(url, referer, ajax) {
  return _requestText(url, referer, ajax).then(function (body) {
    try { return JSON.parse(body || 'null'); } catch (e) { throw new Error('Invalid JSON from ' + url); }
  });
}
function _ajax(base, path, referer) { return _requestJson(base + path, referer || base + '/', true); }
function _dedupe(list) {
  var seen = {};
  return (list || []).filter(function (s) {
    if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) return false;
    var k = s.url + '|' + (s.quality || '') + '|' + (s.kind || '');
    if (seen[k]) return false;
    seen[k] = true; return true;
  });
}
function _video(url, quality, referer, kind, server, typeHint) {
  var hint = String(typeHint || '').toLowerCase();
  var hls = hint === 'hls' || hint === 'm3u8' || /\.m3u8(?:[?#]|$)/i.test(url);
  var headers = { 'User-Agent': UA, 'Referer': referer || ANI_NAMI + '/' };
  // If Origin is needed, it should match the source page, not the media CDN.
  var origin = ((headers.Referer || '').match(/^(https?:\/\/[^/]+)/i) || [])[1];
  if (origin) headers.Origin = origin;
  return { url: url, quality: quality || 'auto', label: (server || 'Mega-Anime') + ' · ' + (quality || 'auto'),
    container: hls ? 'hls' : 'mp4', hls: hls, kind: kind || 'sub',
    audioLang: kind === 'dub' ? 'en' : 'ja', headers: headers, subtitles: [] };
}
function _dedupeVideos(list) { return _dedupe(list); }
function _titleNorm(s) { return _text(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function _titleMatch(a, b) {
  var x = _titleNorm(a), y = _titleNorm(b);
  return !!x && !!y && (x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0);
}
function getInfo() {
  return { name: 'Mega-Anime', lang: 'en', baseUrl: 'https://anilist.co',
    logo: 'https://anilist.co/favicon.ico', type: 'anime', version: '1.0.4' };
}
function getSettings() { return []; }
function search(query, page, opts) {
  return _anilist(SEARCH_QUERY, { search: String(query || ''), page: page || 1, perPage: 30 })
    .then(function (body) { return ((body.data || {}).Page || {}).media || []; })
    .then(function (media) { return media.map(_mediaToItem); })
    .catch(function (e) { console.error('[mega-anime] search failed: ' + e.message); return []; });
}
function getHome(opts) {
  function row(sort, title) {
    return _anilist(HOME_QUERY, { sort: [sort], page: 1, perPage: 20 }).then(function (body) {
      var media = ((body.data || {}).Page || {}).media || [];
      _cacheMediaList(media);
      return { title: title, items: media.map(_mediaToItem) };
    }).catch(function () { return { title: title, items: [] }; });
  }
  return Promise.all([row('TRENDING_DESC', 'Trending Now'), row('POPULARITY_DESC', 'Popular This Season'),
    row('SCORE_DESC', 'Top Rated')]);
}
function getDetail(url, opts) {
  var id = _parseId(url);
  if (!id) return Promise.resolve(null);
  return _anilist(DETAIL_QUERY, { id: id }).then(function (body) {
    var m = body.data && body.data.Media;
    if (!m) return null;
    _cacheMedia(m);
    var studios = [];
    ((m.studios && m.studios.nodes) || []).forEach(function (s) { if (s && s.name) studios.push(s.name); });
    return { id: 'anilist:' + m.id, title: _titleOf(m), url: 'anilist:' + m.id,
      cover: _coverOf(m), description: m.description || '', status: m.status || 'UNKNOWN',
      genres: m.genres || [], studios: studios, type: _typeOf(m), sourceId: SOURCE_ID,
      episodes: _episodesFor(m, opts), malId: m.idMal || null };
  }).catch(function (e) { console.error('[mega-anime] detail failed: ' + e.message); return null; });
}
function getEpisodes(seriesUrl, opts) { return getDetail(seriesUrl, opts).then(function (d) { return d && d.episodes ? d.episodes : []; }); }

// -------------------------- AniWaves resolver -------------------------------
// Actual site chain: /filter?keyword=, /<anime-slug>, /ajax/episode/list/<id>,
// /ajax/server/list?servers=<server_ids>, /ajax/sources?id=<link-id>&asi=0&autoPlay=0.
function _parseAniWavesCards(html) {
  var out = [], seen = {};
  var re = /<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html || '')) !== null) {
    var href = m[2] || '';
    if (!/\/watch\//i.test(href) && !/\/anime\//i.test(href) && !/\/(?:[^/?#]+-\d+)\/?(?:[?#]|$)/i.test(href)) continue;
    var title = (m[1].match(/title=["']([^"']+)["']/i) || [])[1]
      || (m[3].match(/alt=["']([^"']+)["']/i) || [])[1]
      || _text(m[3]);
    title = _text(title).replace(/\s+Poster$/i, '');
    if (!title) continue;
    var url = _abs(ANI_WAVES, href);
    var slug = (url.match(/\/([^/?#]+)\/?(?:[?#]|$)/) || [])[1];
    if (!slug || seen[slug]) continue;
    seen[slug] = true;
    var img = (m[3].match(/(?:src|data-src)=["']([^"']+)["']/i) || [])[1];
    out.push({ slug: slug, title: title, url: url, cover: _abs(ANI_WAVES, img) });
  }
  return out;
}
function _pickAniWaves(html, titles) {
  var list = _parseAniWavesCards(html);
  for (var i = 0; i < titles.length; i++) {
    var match = list.find(function (x) { return _titleMatch(x.title, titles[i]); });
    if (match) return match;
  }
  return list.length === 1 ? list[0] : null;
}
function _normalizeExtracted(arr, referer, kind, serverName) {
  return Array.isArray(arr) ? arr.map(function (s) {
    if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) return null;
    var copy = Object.assign({}, s);
    copy.label = copy.label || (serverName || 'Mega-Anime') + ' · ' + (copy.quality || 'auto');
    copy.headers = Object.assign({ 'User-Agent': UA, 'Referer': referer || ANI_NAMI + '/' }, s.headers || {});
    copy.kind = kind || 'sub';
    copy.audioLang = kind === 'dub' ? 'en' : 'ja';
    return copy;
  }).filter(Boolean) : [];
}

var MEGA_AES_KEY = 'i?LMTAx0Q6,:}50U';
var MEGA_AES_IV = "W0;27ToaUpl_P%'c";

function _padBytes(s, n) {
  var out = [], i;
  for (i = 0; i < n; i++) out[i] = 0;
  var b = String(s || '');
  for (i = 0; i < b.length && i < n; i++) out[i] = b.charCodeAt(i) & 0xff;
  return out;
}
function _b64urlBytes(s) {
  var t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  var pad = (4 - (t.length % 4)) % 4;
  while (pad--) t += '=';
  try { return base64ToBytes(t); } catch (e) { return []; }
}
// Plain sources.file when present; otherwise AES-CBC-decrypt `enc` → {file}.
function _fileFromSources(j) {
  var root = j && (j.results || j.result || j);
  var s = root && root.sources;
  var file = s ? (s.file || (s[0] && s[0].file)) : null;
  if (file) return file;
  if (!root || !root.enc) return null;
  try {
    var ct = _b64urlBytes(root.enc);
    if (!ct.length || ct.length % 16 !== 0) return null;
    var pt = _bytesToStr(_aesCbcDecrypt(ct, _padBytes(MEGA_AES_KEY, 32), _padBytes(MEGA_AES_IV, 16)));
    var o = JSON.parse(pt);
    if (!o) return null;
    if (o.file) return o.file;
    s = o.sources;
    return s ? (s.file || (s[0] && s[0].file)) : null;
  } catch (e) { return null; }
}

var _SBOX=[0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _ISBOX=[0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
function _xtime(a){a<<=1;if(a&0x100)a^=0x11b;return a&0xff;}
function _gmul(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return p&0xff;}
function _keyExp(key){
  var Nk=key.length/4,Nr=Nk+6,w=[],i;
  for(i=0;i<Nk;i++)w.push([key[4*i],key[4*i+1],key[4*i+2],key[4*i+3]]);
  var rcon=1;
  for(i=Nk;i<4*(Nr+1);i++){
    var t=w[i-1].slice();
    if(i%Nk===0){t=[t[1],t[2],t[3],t[0]];t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];t[0]^=rcon;rcon=_xtime(rcon);}
    else if(Nk>6&&i%Nk===4){t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];}
    w.push([w[i-Nk][0]^t[0],w[i-Nk][1]^t[1],w[i-Nk][2]^t[2],w[i-Nk][3]^t[3]]);
  }
  return {w:w,Nr:Nr};
}
function _invCipher(inb,ks){
  var w=ks.w,Nr=ks.Nr,s=[[],[],[],[]],r,c,i;
  for(i=0;i<16;i++)s[i%4][(i/4)|0]=inb[i];
  function ark(round){for(c=0;c<4;c++)for(r=0;r<4;r++)s[r][c]^=w[round*4+c][r];}
  function isub(){for(r=0;r<4;r++)for(c=0;c<4;c++)s[r][c]=_ISBOX[s[r][c]];}
  function ishift(){for(r=1;r<4;r++){var row=s[r].slice();for(c=0;c<4;c++)s[r][c]=row[(c-r+4)%4];}}
  function imix(){for(c=0;c<4;c++){var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,14)^_gmul(a1,11)^_gmul(a2,13)^_gmul(a3,9);
    s[1][c]=_gmul(a0,9)^_gmul(a1,14)^_gmul(a2,11)^_gmul(a3,13);
    s[2][c]=_gmul(a0,13)^_gmul(a1,9)^_gmul(a2,14)^_gmul(a3,11);
    s[3][c]=_gmul(a0,11)^_gmul(a1,13)^_gmul(a2,9)^_gmul(a3,14);}}
  ark(Nr);
  for(var round=Nr-1;round>=1;round--){ishift();isub();ark(round);imix();}
  ishift();isub();ark(0);
  var out=[];for(i=0;i<16;i++)out[i]=s[i%4][(i/4)|0];return out;
}
function _aesCbcDecrypt(ct,key,iv){
  var ks=_keyExp(key),out=[],prev=iv.slice(),off,i;
  for(off=0;off+16<=ct.length;off+=16){
    var block=ct.slice(off,off+16),dec=_invCipher(block,ks);
    for(i=0;i<16;i++)out.push(dec[i]^prev[i]);
    prev=block;
  }
  var pad=out[out.length-1];
  if(pad>0&&pad<=16)out=out.slice(0,out.length-pad);
  return out;
}
function _bytesToStr(b){var s='',i=0;while(i<b.length){var c=b[i++];if(c<0x80)s+=String.fromCharCode(c);else if(c<0xE0)s+=String.fromCharCode(((c&0x1f)<<6)|(b[i++]&0x3f));else if(c<0xF0)s+=String.fromCharCode(((c&0x0f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f));else{var cp=((c&0x07)<<18)|((b[i++]&0x3f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f);cp-=0x10000;s+=String.fromCharCode(0xD800+(cp>>10),0xDC00+(cp&0x3FF));}}return s;}
function _megaPlayHost(url) {
  var host = (String(url || '').match(/^https?:\\/\\/([^/:?#]+)/i) || [])[1];
  if (!host) return false;
  host = host.toLowerCase().replace(/^www\\./, '');
  return /megaplay|megaplays|vidtube|vidstream/i.test(host);
}
function _resolveMegaPlay(embedUrl, referer, kind, serverName) {
  var origin = (String(embedUrl || '').match(/^https?:\\/\\/[^/]+/i) || [])[0];
  if (!origin) return Promise.resolve([]);
  return _requestText(embedUrl, referer || origin + '/', false).then(function (html) {
    var dataId = (html.match(/data-id=[\\\"']([^\\\"']+)[\\\"']/i) || [])[1]
      || (html.match(/data-realid=[\\\"']([^\\\"']+)[\\\"']/i) || [])[1];
    if (!dataId) throw new Error('player page has no data-id');
    var scriptUrls = [], re = /<script\\b[^>]+src=[\\\"']([^\\\"']+)[\\\"'][^>]*>/gi, m;
    while ((m = re.exec(html)) !== null) {
      var u = _abs(embedUrl, m[1]);
      if (u && scriptUrls.indexOf(u) < 0) scriptUrls.push(u);
    }
    var fallbackScript = origin + '/lib/newclient.min.js';
    if (scriptUrls.indexOf(fallbackScript) < 0) scriptUrls.push(fallbackScript);
    return Promise.all(scriptUrls.map(function (u) { return _requestText(u, embedUrl, false).catch(function () { return ''; }); }))
      .then(function (scripts) {
        var script = '';
        for (var i = 0; i < scripts.length; i++) {
          if (/getSources/i.test(scripts[i]) && /AES[- ]?CBC/i.test(scripts[i])) { script = scripts[i]; break; }
        }
        var routes = [], sr = /[\\\"'](stream\\/getSources[\\w/-]*)[\\\"']/gi, rm;
        while ((rm = sr.exec(script)) !== null) if (routes.indexOf(rm[1]) < 0) routes.push(rm[1]);
        if (!routes.length) routes = ['stream/getSourcesNew', 'stream/getSources'];
        routes.sort(function (a,b) { return a.length-b.length; });
        var legacy = routes[0], modern = null;
        routes.forEach(function (r) { if (r !== legacy && r.indexOf(legacy) === 0 && (!modern || r.length > modern.length)) modern = r; });
        function getSource(route) {
          if (!route) return Promise.resolve(null);
          var endpoint = origin + '/' + route + '?id=' + encodeURIComponent(dataId) +
            '&id=' + encodeURIComponent(dataId) + '&type=' + encodeURIComponent(kind === 'dub' ? 'dub' : 'sub');
          return _requestJson(endpoint, embedUrl, true).then(function (j) {
            var file = _fileFromSources(j);
            if (!file || !/^https?:\\/\\//i.test(file)) return null;
            file = String(file).replace('https://cdn.imgnex.top/anime', 'https://megap.norami.top');
            return { file: file, data: j };
          }).catch(function () { return null; });
        }
        return Promise.all([getSource(modern), getSource(legacy)]).then(function (results) {
          var found = results[0] || results[1];
          if (!found) throw new Error('source API returned no direct media URL');
          var stream = _video(found.file, 'auto', embedUrl, kind, serverName || 'MegaPlay',
            /\\.m3u8(?:[?#]|$)/i.test(found.file) ? 'hls' : (/\\.mp4(?:[?#]|$)/i.test(found.file) ? 'mp4' : 'hls'));
          stream.provider = 'MegaPlay';
          stream.embed = false;
          stream.downloadable = false;
          stream.subtitles = ((found.data && Array.isArray(found.data.tracks)) ? found.data.tracks : [])
            .filter(function (t) { return t && t.file && (!t.kind || t.kind === 'captions' || t.kind === 'subtitles'); })
            .map(function (t) {
              return { url: String(t.file).replace('https://cdn.imgnex.top/anime', 'https://megap.norami.top'),
                lang: t.label || 'Subtitle', label: t.label || 'Subtitle',
                format: /\\.srt(?:[?#]|$)/i.test(t.file) ? 'srt' : 'vtt', default: !!t.default };
            });
          return [stream];
        });
      });
  }).catch(function (e) {
    console.warn('[mega-anime] MegaPlay extraction failed: ' + (e && e.message || e));
    return [];
  });
}

function _extractEmbed(url, referer, kind, serverName) {
  if (_megaPlayHost(url)) return _resolveMegaPlay(url, referer, kind, serverName);
  if (typeof extractVideo !== 'function') return Promise.resolve([]);
  var headers = { 'User-Agent': UA, 'Referer': referer || ANI_NAMI + '/' };
  try {
    return Promise.resolve(extractVideo(url, { headers: headers })).then(function (arr) {
      return _normalizeExtracted(arr, referer, kind, serverName);
    }).catch(function () { return []; });
  } catch (e) { return Promise.resolve([]); }
}
function _getAniWavesEmbed(url, watchUrl, kind, serverName) {
  return _requestJson(url, watchUrl, true).then(function (j) {
    var embed = j && j.result && j.result.url;
    if (!embed || !/^https?:\/\//i.test(embed)) return [];
    var typeHint = /\.m3u8(?:[?#]|$)/i.test(embed) ? 'hls' : (/\.mp4(?:[?#]|$)/i.test(embed) ? 'mp4' : '');
    if (typeHint) return [_video(embed, 'auto', watchUrl, kind, serverName, typeHint)];
    return _extractEmbed(embed, watchUrl, kind, serverName);
  }).catch(function () { return []; });
}
function _resolveAniWaves(media, epNumber, kind) {
  var titles = [media.title && media.title.english, media.title && media.title.romaji, media.title && media.title.native].filter(Boolean);
  var q = encodeURIComponent(titles[0] || titles[1] || '');
  if (!q) return Promise.resolve([]);
  return _requestText(ANI_WAVES + '/filter?keyword=' + q, ANI_WAVES + '/', false)
    .then(function (html) {
      var match = _pickAniWaves(html, titles);
      if (!match) return [];
      return _requestText(match.url, ANI_WAVES + '/', false).then(function (watchHtml) {
        var watchTag = (watchHtml.match(/<[^>]*\bid=["']watch-main["'][^>]*>/i) || [])[0] || '';
        var animeId = (watchTag.match(/\bdata-id=["'](\d+)["']/i) || [])[1]
          || (watchHtml.match(/<[^>]*\bdata-id=["'](\d+)["'][^>]*\bid=["']watch-main["'][^>]*>/i) || [])[1];
        if (!animeId) {
          var pageSlug = (match.url.match(/\/([^/?#]+)\/?(?:[?#]|$)/) || [])[1] || '';
          animeId = (pageSlug.match(/-(\d+)$/) || [])[1] || '';
        }
        if (!animeId) return [];
        return _ajax(ANI_WAVES, '/ajax/episode/list/' + animeId, match.url).then(function (epData) {
          var result = epData && typeof epData.result === 'string' ? epData.result : '';
          var episodeLinks = [], re = /<a\b([^>]*)>/gi, em;
          while ((em = re.exec(result)) !== null) {
            var attrs = em[1], n = parseInt((attrs.match(/data-num=["'](\d+)/i) || [])[1] || '0', 10);
            if (!n) continue;
            var hasCat = kind === 'dub' ? /data-dub=["']1/i.test(attrs) : /data-sub=["']1/i.test(attrs);
            var ids = (attrs.match(/data-ids=["']([^"']*)["']/i) || [])[1] || '';
            ids = ids.replace(/&amp;/g, '&').trim();
            // The upstream provider falls back to animeId&eps=episode when data-ids is blank.
            if (!ids) ids = animeId + '&eps=' + n;
            if (n === Number(epNumber) && hasCat && ids) episodeLinks.push({ ids: ids, number: n });
          }
          if (!episodeLinks.length) return [];
          return Promise.all(episodeLinks.map(function (episodeInfo) {
            return _ajax(ANI_WAVES, '/ajax/server/list?servers=' + episodeInfo.ids, match.url)
              .then(function (srvData) {
                var markup = srvData && typeof srvData.result === 'string' ? srvData.result : '';
                var sections = [], typeRe = /<([a-z0-9]+)\b([^>]*class=["'][^"']*\btype\b[^"']*["'][^>]*)>([\s\S]*?)(?=<[a-z0-9]+\b[^>]*class=["'][^"']*\btype\b|$)/gi, tm;
                while ((tm = typeRe.exec(markup)) !== null) {
                  var st = String((tm[2].match(/data-type=["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
                  if (kind === 'dub' ? st !== 'dub' : (st !== 'sub' && st !== 'ssub')) continue;
                  var inner = tm[3], liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi, lm;
                  while ((lm = liRe.exec(inner)) !== null) {
                    var attrs2 = lm[1] + ' ' + lm[2];
                    var linkId = (attrs2.match(/data-link-id=["']([^"']+)["']/i) || [])[1];
                    if (!linkId || sections.some(function (s) { return s.id === linkId; })) continue;
                    sections.push({ id: linkId, name: _text(lm[2]) || 'AniWaves' });
                  }
                }
                return Promise.all(sections.map(function (srv) {
                  return _getAniWavesEmbed(ANI_WAVES + '/ajax/sources?id=' + encodeURIComponent(srv.id) + '&asi=0&autoPlay=0',
                    match.url, kind, srv.name);
                })).then(function (groups) { return [].concat.apply([], groups); });
              }).catch(function () { return []; });
          })).then(function (groups) { return _dedupeVideos([].concat.apply([], groups)); });
        });
      });
    }).catch(function (e) { console.warn('[mega-anime] AniWaves resolver failed: ' + e.message); return []; });
}

// -------------------------- AniNami resolver --------------------------------
// API shape taken from RaghavAniNami.kt: /api/episodes/{anilistId}, then
// /api/watch/{provider}/{anilistId}/{audioType}/{slug}.
function _resolveAniNami(mediaOrId, epNumber, kind) {
  // AniNami is keyed by the real AniList ID; this works even if GraphQL is down.
  var rawId = mediaOrId && typeof mediaOrId === 'object' ? mediaOrId.id : mediaOrId;
  var anilistId = _positiveNumericId(rawId);
  if (!anilistId) return Promise.resolve([]);
  return _requestJson(ANI_NAMI + '/api/episodes/' + anilistId, ANI_NAMI + '/', false).then(function (body) {
    var providers = body && body.results && body.results.providers || {};
    var entries = [];
    Object.keys(providers).forEach(function (providerName) {
      var categories = providers[providerName] && providers[providerName].episodes || {};
      (categories[kind] || []).forEach(function (item) {
        if (Number(item && item.number) === Number(epNumber) && item.id) {
          entries.push({ provider: providerName, id: String(item.id) });
        }
      });
    });
    if (!entries.length) return [];
    return Promise.all(entries.map(function (entry) {
      var p = entry.id.split('/');
      if (p.length < 5 || p[0] !== 'watch') return [];
      var provider = p[1], animeId = p[2], audioType = p[3], slug = p.slice(4).join('/');
      if (!provider || !animeId || !audioType || !slug) return [];
      var watchUrl = ANI_NAMI + '/api/watch/' + provider + '/' + animeId + '/' + audioType + '/' + slug;
      return _requestJson(watchUrl, ANI_NAMI + '/', false).then(function (streamBody) {
        var streams = streamBody && streamBody.results && streamBody.results.streams || [];
        var videos = [], jobs = [];
        streams.forEach(function (stream) {
          if (!stream || !stream.url || !/^https?:\/\//i.test(stream.url)) return;
          var st = String(stream.type || '').toLowerCase();
          var ref = stream.referer || ANI_NAMI + '/';
          var isHls = st === 'hls' || st === 'm3u8' || /\.m3u8(?:[?#]|$)/i.test(stream.url);
          var isDirectVideo = st === 'mp4' || st === 'video' || /\.mp4(?:[?#]|$)/i.test(stream.url);
          if (isHls || isDirectVideo) {
            videos.push(_video(stream.url, stream.quality || 'auto', ref, kind,
              stream.server || 'AniNami', isHls ? 'hls' : 'mp4'));
          } else {
            // extractVideo is asynchronous in Zangetsu. Do not test it as an array
            // synchronously or all embed-only AniNami servers silently disappear.
            jobs.push(_extractEmbed(stream.url, ref, kind, stream.server || 'AniNami').then(function (embedded) {
              videos.push.apply(videos, embedded);
            }));
          }
        });
        return Promise.all(jobs).then(function () { return videos; });
      }).catch(function (e) {
        console.warn('[mega-anime] AniNami watch failed: ' + e.message);
        return [];
      });
    })).then(function (groups) { return _dedupeVideos([].concat.apply([], groups)); });
  }).catch(function (e) {
    console.warn('[mega-anime] AniNami resolver failed: ' + e.message);
    return [];
  });
}
function _resolveAll(media, epNumber, kind) {
  return _refreshDomains().then(function () {
    return Promise.all([_resolveAniWaves(media, epNumber, kind), _resolveAniNami(media, epNumber, kind)]);
  }).then(function (groups) { return _dedupeVideos([].concat.apply([], groups)); });
}
function getVideoSources(episodeUrl, opts) {
  // Resolve host aliases from the same domain helper used by the reference provider.
  // Playback still falls back to known defaults if the helper is offline.
  // Episode IDs are <AniList ID>:<episode number>[:sub|dub].
  // Reject signed, partial or free-text IDs instead of silently changing them.
  var parsed = String(episodeUrl || '').match(/^(?:mega-anime:)?(\d+):(\d+)(?::(sub|dub))?$/i);
  if (!parsed) return Promise.resolve([]);
  var id = _positiveNumericId(parsed[1]);
  var ep = _positiveNumericId(parsed[2]);
  var kind = String(parsed[3] || 'sub').toLowerCase();
  if (id === null || ep === null || (kind !== 'sub' && kind !== 'dub')) return Promise.resolve([]);

  // Reuse media already fetched for details/search/home. Playback must not depend
  // on another AniList call if its API is temporarily down or rate-limiting.
  var cached = _cachedMedia(id);
  if (cached) return _resolveAll(cached, ep, kind);

  // AniNami only needs the numeric AniList ID and can resolve independently of
  // the metadata API. In parallel, fetch title metadata for the AniWaves search.
  return _refreshDomains().then(function () { return Promise.all([
    _resolveAniNami(id, ep, kind),
    _anilist(DETAIL_QUERY, { id: id }).then(function (body) {
      var media = body.data && body.data.Media;
      if (media) _cacheMedia(media);
      return media || null;
    }).catch(function (e) {
      console.warn('[mega-anime] AniList unavailable during playback: ' + e.message);
      return null;
    })
  ]).then(function (results) {
    var nami = results[0] || [];
    var media = results[1];
    if (!media) return _dedupeVideos(nami);
    return _resolveAniWaves(media, ep, kind).then(function (waves) {
      return _dedupeVideos(waves.concat(nami));
    });
  }).catch(function (e) {
    console.error('[mega-anime] sources failed: ' + e.message);
    return [];
  });
}
function __resetForTests() { MEDIA_CACHE = {}; }
var getStreams = getVideoSources;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: '1.0.4', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, __resetForTests: __resetForTests };
}
