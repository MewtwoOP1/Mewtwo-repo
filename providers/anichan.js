// AniChan — anime source for the Zangetsu provider repo (anichan.to).
//
// AniChan keys everything on AniList IDs, so search is resolved through AniList's public GraphQL
// API and playback uses AniChan's own JSON API:
//   POST https://graphql.anilist.co                          -> title search / metadata
//   GET  /api/watch/episodes?anilistId=...                   -> { episodes, dubAvailable }
//   POST /api/watch/session  {"token":""}                    -> Set-Cookie: anichan_ws=…, nonce n
//   GET  /api/watch/servers?anilistId=&ep=&category=&tier=   -> { servers: […] } or an envelope
//
// The server list is tiered (`fast`, then `rest`) and the site signs the request with an `X-Wk`
// keyset id taken from its own JavaScript chunks. When the site answers with `{v:1,i,d}` the
// payload is AES-GCM; GCM is CTR plus a tag, so the host's AES-CTR bridge decrypts the ciphertext
// with counter `iv||00000002` and the tag is ignored. Keysets rotate, so a known-good one is kept
// and the chunks are re-read when a response cannot be decrypted.
//
// The `token` is a Cloudflare Turnstile response. The site currently publishes a null Turnstile
// site key, so an empty token is accepted; if that changes the session POST will fail and the
// provider surfaces the error instead of pretending playback works. CAPTCHA/Turnstile is never
// bypassed.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'anichan';

var BASE = 'https://anichan.to';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
var DEFAULT_SESSION_MS = 7200000;
var SESSION_SLACK_MS = 60000;
var CACHE_TTL_MS = 30 * 60 * 1000;

var _sessionCookie = '';
var _sessionNonce = '';
var _sessionExpiresAt = 0;
var _mediaCache = {};

// Current keyset at the time of writing. It is refreshed from the site's chunks when it stops
// decrypting, so an old entry is only a starting point, never a hard-coded secret to depend on.
var _keysets = [
  { id: '92b016e0', p: 'Nq23HocDMsXkFF3dW8dfTUOED+FDkNv7i0D/oxwzeEA=', i: 'xF6kQHsj25FisoW4XKizmYBdNIDyn83CldznQpfIjzw=' }
];
var _activeKeyset = null;
var _keysetsRefreshedAt = 0;
var KEYSET_TTL_MS = 30 * 60 * 1000;

function getInfo() {
  return { name: 'AniChan', lang: 'en', baseUrl: BASE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=anichan.to', type: 'anime', version: '1.0.1' };
}
function getSettings() { return []; }

// ── Networking ─────────────────────────────────────────────────────────────
function _nowMs() {
  try { return Date.now(); } catch (e) { return 0; }
}

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

function _captureSessionCookie(setCookie) {
  if (!setCookie) return;
  var m = /(?:^|[,;]\s*)anichan_ws=([^;,\s]+)/.exec(String(setCookie));
  if (m) {
    _sessionCookie = 'anichan_ws=' + m[1];
    _sessionExpiresAt = _nowMs() + DEFAULT_SESSION_MS - SESSION_SLACK_MS;
  }
}

function _fetchFull(url, opts) {
  opts = opts || {};
  var h = { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': BASE + '/' };
  if (_sessionCookie && !opts.noCookie) h['Cookie'] = _sessionCookie;
  if (opts.headers) { for (var k in opts.headers) h[k] = opts.headers[k]; }
  var init = { headers: h };
  if (opts.method) init.method = opts.method;
  if (opts.body != null) init.body = opts.body;
  return _raceTimeout(fetch(url, init).then(function (r) {
    if (!r) throw new Error('AniChan: empty response for ' + url);
    var setCookie = '';
    try {
      if (r.headers) {
        if (typeof r.headers.getSetCookie === 'function') {
          var arr = r.headers.getSetCookie();
          if (arr && arr.length) setCookie = arr.join('; ');
        }
        if (!setCookie && typeof r.headers.get === 'function') setCookie = r.headers.get('set-cookie') || '';
        else if (!setCookie && r.headers['set-cookie']) setCookie = String(r.headers['set-cookie']);
      }
    } catch (e) {}
    _captureSessionCookie(setCookie);
    return r.text().then(function (t) {
      return { ok: !!r.ok, status: r.status, body: t };
    });
  }), 15000, null).then(function (v) {
    if (v == null) throw new Error('AniChan: timeout for ' + url);
    return v;
  });
}

function _jsonBody(res, label) {
  try { return JSON.parse(res.body || 'null'); }
  catch (e) { throw new Error('AniChan: invalid JSON from ' + label); }
}

function _getJson(url) {
  return _fetchFull(url).then(function (res) {
    if (!res.ok) throw new Error('AniChan: HTTP ' + res.status + ' for ' + url);
    return _jsonBody(res, url);
  });
}

function _clearSession() {
  _sessionCookie = '';
  _sessionNonce = '';
  _sessionExpiresAt = 0;
}

function _mintSession() {
  // Empty Turnstile token — only valid while the site publishes a null site key. If the site turns
  // Turnstile on, this POST fails and the error is surfaced instead of silently returning nothing.
  return _fetchFull(BASE + '/api/watch/session', {
    method: 'POST',
    noCookie: true,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Origin': BASE,
      'Referer': BASE + '/'
    },
    body: JSON.stringify({ token: '' })
  }).then(function (res) {
    if (!res.ok) throw new Error('AniChan: session HTTP ' + res.status + ' (Turnstile may be enforced)');
    var body = _jsonBody(res, 'session');
    var nonce = body && body.n != null ? String(body.n) : '';
    if (!nonce) throw new Error('AniChan: session did not return a nonce');
    if (!_sessionCookie) throw new Error('AniChan: session did not return an anichan_ws cookie');
    _sessionNonce = nonce;
    var exp = Number(body && body.exp);
    if (exp > 0) {
      var ms = exp < 1000000000000 ? exp * 1000 : exp;
      _sessionExpiresAt = ms - SESSION_SLACK_MS;
    } else {
      _sessionExpiresAt = _nowMs() + DEFAULT_SESSION_MS - SESSION_SLACK_MS;
    }
    return body;
  });
}

function _ensureSession() {
  if (_sessionCookie && _sessionNonce && _sessionExpiresAt && _nowMs() < _sessionExpiresAt) {
    return Promise.resolve();
  }
  return _mintSession();
}

// ── AniList metadata / search ──────────────────────────────────────────────
var MEDIA_FIELDS = 'id idMal title{romaji english native userPreferred} coverImage{extraLarge large} '
  + 'bannerImage description(asHtml:false) genres seasonYear status format episodes '
  + 'nextAiringEpisode{episode}';

function _graphql(query, variables) {
  return _fetchFull(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query: query, variables: variables || {} })
  }).then(function (res) {
    if (!res.ok) throw new Error('AniChan: AniList HTTP ' + res.status);
    var json = _jsonBody(res, 'AniList');
    if (json && json.errors && json.errors.length) throw new Error('AniChan: AniList error: ' + json.errors[0].message);
    return json && json.data;
  });
}

function _mediaFromAniList(m) {
  if (!m || !m.id) return null;
  var title = m.title || {};
  var cover = m.coverImage || {};
  return {
    anilistId: Number(m.id),
    idMal: m.idMal != null ? Number(m.idMal) : null,
    title: title.english || title.romaji || title.userPreferred || title.native || ('AniList ' + m.id),
    englishTitle: title.english || null,
    romajiTitle: title.romaji || null,
    cover: cover.extraLarge || cover.large || null,
    banner: m.bannerImage || null,
    description: m.description || '',
    genres: Array.isArray(m.genres) ? m.genres.map(function (genre) {
      return typeof genre === 'string' ? genre.trim() : '';
    }).filter(function (genre) { return !!genre; }) : [],
    // Zangetsu's MediaDetail year field is String?, although AniList sends a number.
    year: m.seasonYear != null ? String(m.seasonYear) : null,
    status: String(m.status || '').toLowerCase() || 'unknown',
    format: m.format || null,
    episodes: typeof m.episodes === 'number' ? m.episodes : null,
    nextAiringEpisode: m.nextAiringEpisode || null
  };
}

function _aniListSearch(query, page) {
  var q = 'query ($search: String, $page: Int) { Page(page: $page, perPage: 20) { media(search: $search, type: ANIME, isAdult: false) { ' + MEDIA_FIELDS + ' } } }';
  return _graphql(q, { search: query, page: Math.max(1, page || 1) }).then(function (data) {
    var list = data && data.Page && data.Page.media;
    return (list || []).map(_mediaFromAniList).filter(Boolean);
  });
}

function _aniListMedia(id) {
  var key = String(id);
  if (_mediaCache[key] && _nowMs() - _mediaCache[key].at < CACHE_TTL_MS) return Promise.resolve(_mediaCache[key].media);
  var q = 'query ($id: Int) { Media(id: $id, type: ANIME) { ' + MEDIA_FIELDS + ' } }';
  return _graphql(q, { id: Number(id) }).then(function (data) {
    var media = _mediaFromAniList(data && data.Media);
    if (!media) throw new Error('AniChan: AniList has no media ' + id);
    _mediaCache[key] = { at: _nowMs(), media: media };
    return media;
  });
}

// ── URLs ───────────────────────────────────────────────────────────────────
function _seriesUrl(anilistId) {
  return 'anichan://' + anilistId;
}
function _parseSeriesUrl(url) {
  var raw = String(url || '');
  if (raw.indexOf('anichan://') === 0) raw = raw.slice('anichan://'.length);
  if (raw.indexOf('/') !== -1) raw = raw.split('/')[0];
  var id = parseInt(raw, 10);
  return id > 0 ? id : null;
}
function _episodeUrl(anilistId, category, number) {
  return 'anichan://' + anilistId + '/' + category + '/' + number;
}
function _parseEpisodeUrl(url) {
  var raw = String(url || '');
  if (raw.indexOf('anichan://') === 0) raw = raw.slice('anichan://'.length);
  var parts = raw.split('/');
  if (parts.length < 3) return null;
  var id = parseInt(parts[0], 10);
  var category = parts[1] === 'dub' ? 'dub' : 'sub';
  var number = parseInt(parts[2], 10);
  if (!(id > 0) || !(number >= 1)) return null;
  return { anilistId: id, category: category, number: number };
}

// ── Episode availability ───────────────────────────────────────────────────
function _fetchAvailability(anilistId) {
  return _getJson(BASE + '/api/watch/episodes?anilistId=' + anilistId).then(function (json) {
    if (!json) throw new Error('AniChan: empty episode payload');
    var count = typeof json.episodes === 'number' ? json.episodes : 0;
    return { episodes: count, dubAvailable: json.dubAvailable === true };
  });
}

function _countFromMedia(media) {
  if (!media) return 0;
  if (typeof media.episodes === 'number' && media.episodes > 0) return media.episodes;
  if (media.nextAiringEpisode && typeof media.nextAiringEpisode.episode === 'number') {
    return Math.max(0, media.nextAiringEpisode.episode - 1);
  }
  return 0;
}

function _episodeObjects(anilistId, availability) {
  var out = [];
  var count = availability.episodes;
  for (var i = 1; i <= count; i++) {
    out.push({
      id: _episodeUrl(anilistId, 'sub', i),
      number: i,
      title: 'Episode ' + i,
      url: _episodeUrl(anilistId, 'sub', i),
      category: 'sub',
      type: 'anime',
      sourceId: SOURCE_ID
    });
    if (availability.dubAvailable) {
      out.push({
        id: _episodeUrl(anilistId, 'dub', i),
        number: i,
        title: 'Episode ' + i + ' (Dub)',
        url: _episodeUrl(anilistId, 'dub', i),
        category: 'dub',
        type: 'anime',
        sourceId: SOURCE_ID
      });
    }
  }
  return out;
}

function _detailFromMedia(anilistId, media, availability) {
  var episodes = _episodeObjects(anilistId, availability);
  return {
    id: String(anilistId),
    title: media ? media.title : ('AniChan ' + anilistId),
    url: _seriesUrl(anilistId),
    cover: media ? media.cover : null,
    banner: media ? media.banner : null,
    description: media ? media.description : '',
    status: media ? media.status : 'unknown',
    genres: media ? media.genres : [],
    type: 'anime',
    sourceId: SOURCE_ID,
    episodes: episodes,
    year: media ? media.year : null,
    malId: media ? media.idMal : null,
    subCount: availability.episodes,
    dubCount: availability.dubAvailable ? availability.episodes : 0
  };
}

// ── Public API ─────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (q.length < 2) return Promise.resolve([]);
  return _aniListSearch(q, page).then(function (items) {
    return items.map(function (m) {
      return {
        id: String(m.anilistId),
        title: m.title,
        url: _seriesUrl(m.anilistId),
        cover: m.cover,
        type: 'anime',
        sourceId: SOURCE_ID,
        year: m.year,
        description: m.description
      };
    });
  }).catch(function () { return []; });
}

function getHome(opts) {
  var q = 'query { Page(page: 1, perPage: 20) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ' + MEDIA_FIELDS + ' } } }';
  return _graphql(q, {}).then(function (data) {
    var list = data && data.Page && data.Page.media;
    var items = (list || []).map(_mediaFromAniList).filter(Boolean).map(function (m) {
      return { id: String(m.anilistId), title: m.title, url: _seriesUrl(m.anilistId),
        cover: m.cover, type: 'anime', sourceId: SOURCE_ID, year: m.year, description: m.description };
    });
    return items.length ? [{ title: 'Trending on AniChan', items: items }] : [];
  }).catch(function () { return []; });
}

function getDetail(url, opts) {
  var id = _parseSeriesUrl(url);
  if (!id) return Promise.reject(new Error('AniChan: invalid AniList id'));
  return Promise.all([
    _aniListMedia(id).catch(function () { return null; }),
    _fetchAvailability(id)
  ]).then(function (res) {
    // A zero count is a 200 answer for a title AniChan does not carry. Returning a detail with no
    // episodes would read as "the provider has it but the catalogue is empty", so fail instead.
    if (!res[1].episodes) throw new Error('AniChan does not carry AniList id ' + id);
    return _detailFromMedia(id, res[0], res[1]);
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

// ── Streams ────────────────────────────────────────────────────────────────
function _subtitleLanguage(label) {
  var l = String(label || '').toLowerCase();
  if (l.indexOf('eng') === 0) return 'en';
  if (l.indexOf('spa') === 0) return 'es';
  if (l.indexOf('por') === 0) return 'pt';
  if (l.indexOf('fre') === 0 || l.indexOf('fra') === 0) return 'fr';
  if (l.indexOf('ger') === 0 || l.indexOf('deu') === 0) return 'de';
  if (l.indexOf('ita') === 0) return 'it';
  if (l.indexOf('ara') === 0) return 'ar';
  if (l.indexOf('rus') === 0) return 'ru';
  if (l.indexOf('ind') === 0) return 'id';
  if (l.indexOf('kor') === 0) return 'ko';
  if (l.indexOf('jap') === 0) return 'ja';
  if (l.indexOf('chi') === 0 || l.indexOf('zho') === 0) return 'zh';
  return 'und';
}

function _absolute(url) {
  var u = String(url || '').replace(/ /g, '%20');
  if (u.indexOf('/') === 0) return BASE + u;
  return u;
}

// ── Keyset discovery and envelope decryption ───────────────────────────────
// AES-GCM = AES-CTR (counter starts at 2 for a 12-byte IV) + GHASH tag. The host bridges CTR, so
// the ciphertext is decrypted without the tag; the tag is only an integrity check we do not need.
var _SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function _b64(text) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var t = String(text || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  var out = [];
  for (var i = 0; i < t.length; i += 4) {
    var a = chars.indexOf(t.charAt(i));
    var b = i + 1 < t.length ? chars.indexOf(t.charAt(i + 1)) : -1;
    var c = i + 2 < t.length ? chars.indexOf(t.charAt(i + 2)) : -1;
    var d = i + 3 < t.length ? chars.indexOf(t.charAt(i + 3)) : -1;
    if (a < 0 || b < 0) continue;
    out.push(((a << 2) | (b >> 4)) & 255);
    if (c >= 0) out.push((((b & 15) << 4) | (c >> 2)) & 255);
    if (d >= 0 && c >= 0) out.push((((c & 3) << 6) | d) & 255);
  }
  return new Uint8Array(out);
}

function _b64Encode(bytes) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i] & 255;
    var b = i + 1 < bytes.length ? bytes[i + 1] & 255 : NaN;
    var c = i + 2 < bytes.length ? bytes[i + 2] & 255 : NaN;
    out += chars.charAt(a >> 2) + chars.charAt(((a & 3) << 4) | (b >> 4));
    out += isNaN(b) ? '=' : chars.charAt(((b & 15) << 2) | (c >> 6));
    out += isNaN(c) ? '=' : chars.charAt(c & 63);
  }
  return out;
}

function _hex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var h = (bytes[i] & 255).toString(16);
    out += h.length === 1 ? '0' + h : h;
  }
  return out;
}

function _utf8Ascii(text) {
  var s = String(text || '');
  var out = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

function _concat(a, b) {
  var out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function _sha256(input) {
  var len = input.length;
  var total = Math.ceil((len + 9) / 64) * 64;
  var msg = new Uint8Array(total);
  msg.set(input);
  msg[len] = 128;
  var bits = len * 8;
  var hi = Math.floor(bits / 4294967296);
  var lo = bits >>> 0;
  msg[total - 8] = (hi >>> 24) & 255;
  msg[total - 7] = (hi >>> 16) & 255;
  msg[total - 6] = (hi >>> 8) & 255;
  msg[total - 5] = hi & 255;
  msg[total - 4] = (lo >>> 24) & 255;
  msg[total - 3] = (lo >>> 16) & 255;
  msg[total - 2] = (lo >>> 8) & 255;
  msg[total - 1] = lo & 255;
  var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var w = new Array(64);
  function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
  for (var off = 0; off < total; off += 64) {
    for (var i = 0; i < 16; i++) {
      var j = off + i * 4;
      w[i] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
    }
    for (var i2 = 16; i2 < 64; i2++) {
      var x = w[i2 - 15];
      var y = w[i2 - 2];
      var s0 = rr(x, 7) ^ rr(x, 18) ^ (x >>> 3);
      var s1 = rr(y, 17) ^ rr(y, 19) ^ (y >>> 10);
      w[i2] = (w[i2 - 16] + s0 + w[i2 - 7] + s1) >>> 0;
    }
    var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], z = h[7];
    for (var i3 = 0; i3 < 64; i3++) {
      var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (z + S1 + ch + _SHA_K[i3] + w[i3]) >>> 0;
      var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) >>> 0;
      z = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + z) >>> 0;
  }
  var result = new Uint8Array(32);
  for (var i4 = 0; i4 < 8; i4++) {
    result[i4 * 4] = (h[i4] >>> 24) & 255;
    result[i4 * 4 + 1] = (h[i4] >>> 16) & 255;
    result[i4 * 4 + 2] = (h[i4] >>> 8) & 255;
    result[i4 * 4 + 3] = h[i4] & 255;
  }
  return result;
}

function _hmac(key, data) {
  if (key.length > 64) key = _sha256(key);
  var block = new Uint8Array(64);
  block.set(key);
  var inner = new Uint8Array(64);
  var outer = new Uint8Array(64);
  for (var i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  return _sha256(_concat(outer, _sha256(_concat(inner, data))));
}

function _sameKeyset(a, b) {
  return !!a && !!b && a.id === b.id && a.p === b.p && a.i === b.i;
}

function _addKeyset(key) {
  if (!key || !key.id || !key.p || !key.i) return null;
  for (var i = 0; i < _keysets.length; i++) {
    if (_sameKeyset(_keysets[i], key)) return _keysets[i];
  }
  _keysets.unshift(key);
  if (_keysets.length > 8) _keysets.length = 8;
  return key;
}

function _extractKeyset(code) {
  var re = /["']([0-9a-f]{8})["'],[A-Za-z_$][\w$]*=["']([A-Za-z0-9+/=]{44})["'],[A-Za-z_$][\w$]*=["']([A-Za-z0-9+/=]{44})["']/i;
  var m = re.exec(String(code || ''));
  return m ? { id: m[1], p: m[2], i: m[3] } : null;
}

function _fetchText(url) {
  return _fetchFull(url, {
    headers: { 'Accept': 'text/html,application/xhtml+xml', 'Referer': BASE + '/' }
  }).then(function (res) {
    if (!res.ok) throw new Error('AniChan: HTTP ' + res.status + ' for ' + url);
    return res.body;
  });
}

function _refreshKeysets(force) {
  if (!force && _nowMs() - _keysetsRefreshedAt < KEYSET_TTL_MS) {
    return Promise.resolve(_activeKeyset || _keysets[0] || null);
  }
  _keysetsRefreshedAt = _nowMs();
  return _fetchText(BASE + '/').then(function (html) {
    var urls = [];
    var re = /src=["'](\/_next\/static\/chunks\/[^"']+\.js)["']/gi;
    var m;
    while ((m = re.exec(html)) !== null && urls.length < 14) {
      if (urls.indexOf(m[1]) === -1) urls.push(m[1]);
    }
    var index = 0;
    function next() {
      if (index >= urls.length) return null;
      var path = urls[index++];
      return _fetchFull(BASE + path, { headers: { 'Accept': '*/*', 'Referer': BASE + '/' } })
        .then(function (res) { return res.ok ? res.body : ''; })
        .then(function (code) {
          var key = _extractKeyset(code);
          if (!key) return next();
          _addKeyset(key);
          _activeKeyset = key;
          return key;
        })
        .catch(function () { return next(); });
    }
    return next();
  }).catch(function () { return null; });
}

function _keysetError(message) {
  var error = new Error(message);
  error.keyset = true;
  return error;
}

function _decryptEnvelope(envelope, keyset) {
  if (typeof aesCtrDecrypt !== 'function') {
    return Promise.reject(_keysetError('AniChan: encrypted servers need the host AES-CTR bridge'));
  }
  var p = _b64(keyset.p);
  var q = _b64(keyset.i);
  if (p.length !== 32 || q.length !== 32) {
    return Promise.reject(_keysetError('AniChan: invalid keyset length'));
  }
  var key0 = new Uint8Array(32);
  for (var i = 0; i < 32; i++) key0[i] = p[i] ^ q[i];
  var aesKey = _hmac(key0, _utf8Ascii(_sessionNonce));
  var iv = _b64(envelope.i);
  var payload = _b64(envelope.d);
  if (iv.length !== 12 || payload.length <= 16) {
    return Promise.reject(_keysetError('AniChan: invalid encrypted payload'));
  }
  var ciphertext = payload.subarray(0, payload.length - 16);
  var counter = _hex(iv) + '00000002';
  var call;
  try {
    call = aesCtrDecrypt({
      keyHex: _hex(aesKey),
      counterHex: counter,
      dataB64: _b64Encode(ciphertext)
    });
  } catch (e) {
    return Promise.reject(_keysetError('AniChan: AES-CTR bridge failed'));
  }
  return Promise.resolve(call).then(function (plain) {
    try {
      return JSON.parse(String(plain || ''));
    } catch (e) {
      throw _keysetError('AniChan: decrypted servers were not JSON');
    }
  });
}

function _requestServers(anilistId, episode, category, tier, keyset) {
  var url = BASE + '/api/watch/servers?anilistId=' + encodeURIComponent(String(anilistId))
    + '&ep=' + encodeURIComponent(String(episode))
    + '&category=' + encodeURIComponent(category)
    + (tier ? '&tier=' + encodeURIComponent(tier) : '');
  var headers = {
    'Accept': 'application/json',
    'Origin': BASE,
    'Referer': BASE + '/anime/' + anilistId + '/watch/' + episode
  };
  if (keyset && keyset.id) headers['X-Wk'] = keyset.id;

  return _fetchFull(url, { headers: headers }).then(function (res) {
    if (res.status === 401) {
      var sessionError = new Error('AniChan: watch session expired');
      sessionError.session = true;
      throw sessionError;
    }
    if (!res.ok) throw new Error('AniChan: HTTP ' + res.status + ' for episode ' + episode);
    var json = _jsonBody(res, 'servers');
    if (json && json.v === 1 && json.i && json.d) return _decryptEnvelope(json, keyset);
    return json;
  }).then(function (data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.servers)) return data.servers;
    return [];
  });
}

function _serversWithSession(anilistId, episode, category, tier, keyset) {
  return _ensureSession()
    .then(function () {
      return _requestServers(anilistId, episode, category, tier, keyset);
    })
    .catch(function (error) {
      if (!error || !error.session) throw error;
      _clearSession();
      return _ensureSession().then(function () {
        return _requestServers(anilistId, episode, category, tier, keyset);
      });
    });
}

function _collectTiers(anilistId, episode, category, keyset) {
  var cuts = category === 'dub' ? ['dub'] : ['sub', 'hsub'];
  var rows = [];
  var seen = {};

  function add(found) {
    (found || []).forEach(function (server) {
      if (!server) return;
      var streamUrl = String(server.stream || server.embed || '');
      if (!streamUrl || seen[streamUrl]) return;
      seen[streamUrl] = true;
      rows.push(server);
    });
  }

  function nextCut(index) {
    if (index >= cuts.length) return Promise.resolve(rows);
    var cut = cuts[index];
    return _serversWithSession(anilistId, episode, cut, 'fast', keyset).then(function (fast) {
      if (fast.length) { add(fast); return rows; }
      return _serversWithSession(anilistId, episode, cut, 'rest', keyset).then(function (rest) {
        if (rest.length) { add(rest); return rows; }
        return nextCut(index + 1);
      });
    });
  }

  return nextCut(0);
}

function _serversFor(anilistId, episode, category) {
  var ordered = [];
  if (_activeKeyset) ordered.push(_activeKeyset);
  _keysets.forEach(function (key) {
    if (!ordered.some(function (known) { return _sameKeyset(known, key); })) ordered.push(key);
  });

  var refreshed = false;
  var needsRefresh = false;

  function next(index) {
    if (index < ordered.length) {
      var keyset = ordered[index];
      return _collectTiers(anilistId, episode, category, keyset).then(function (rows) {
        if (rows.length) { _activeKeyset = keyset; return rows; }
        needsRefresh = true;
        return next(index + 1);
      }).catch(function (error) {
        if (error && error.keyset) {
          needsRefresh = true;
          return next(index + 1);
        }
        throw error;
      });
    }
    if (refreshed || !needsRefresh) return Promise.resolve([]);
    refreshed = true;
    return _refreshKeysets(true).then(function (fresh) {
      if (!fresh || ordered.some(function (known) { return _sameKeyset(known, fresh); })) return [];
      return _collectTiers(anilistId, episode, category, fresh).then(function (rows) {
        if (rows.length) _activeKeyset = fresh;
        return rows;
      });
    });
  }

  return next(0);
}

function getVideoSources(episodeUrl, opts) {
  var parsed = _parseEpisodeUrl(episodeUrl);
  if (!parsed) return Promise.reject(new Error('AniChan: invalid episode URL'));

  return _serversFor(parsed.anilistId, parsed.number, parsed.category).then(function (servers) {
    var usable = servers.map(function (s) { return s || {}; }).filter(function (s) {
      var name = String(s.name || '').toLowerCase();
      if (name.indexOf('megaplay') === 0 || name === 'vidhawk') return false;
      return !!s.stream;
    });
    if (!usable.length) throw new Error('AniChan: no playable server for episode ' + parsed.number);

    usable.sort(function (a, b) {
      var ra = typeof a.rank === 'number' ? a.rank : 9999;
      var rb = typeof b.rank === 'number' ? b.rank : 9999;
      return ra - rb;
    });

    return usable.map(function (server, index) {
      var label = String(server.label || server.name || ('Server ' + (index + 1)))
        .trim().replace(/^★/, '').trim() || 'Auto';
      var subtitles = Array.isArray(server.subtitles) ? server.subtitles.map(function (t) {
        if (!t || !t.url) return null;
        var name = t.lang || t.label || 'Subtitles';
        return {
          url: _absolute(t.url),
          label: name,
          lang: _subtitleLanguage(name),
          format: /\.srt(?:[?#]|$)/i.test(String(t.url)) ? 'srt' : 'vtt'
        };
      }).filter(Boolean) : [];
      return {
        url: _absolute(server.stream),
        quality: label,
        label: (server.name || 'AniChan') + ' · ' + parsed.category,
        container: 'hls',
        headers: { 'User-Agent': UA },
        kind: parsed.category,
        audioLang: parsed.category === 'dub' ? 'en' : 'ja',
        subtitles: subtitles
      };
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
    version: '1.0.1',
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
