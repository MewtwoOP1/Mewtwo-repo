// mewstream.js — Mewstream multi-source provider for Zangetsu v2.0.2
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'mewstream';
var VERSION = '2.0.2';

// ── Polyfills ──────────────────────────────────────────────────────────
var _B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
var _btoa = (typeof btoa !== 'undefined') ? btoa : function (s) {
  s = String(s); var o = '';
  for (var b, c, i = 0, m = _B64C; s.charAt(i | 0) || (m = '=', i % 1); o += m.charAt(63 & b >> 8 - i % 1 * 8)) {
    c = s.charCodeAt(i += 3 / 4);
    if (c > 0xFF) throw new Error('btoa');
    b = b << 8 | c;
  }
  return o;
};
var _atob = (typeof atob !== 'undefined') ? atob : function (s) {
  s = String(s).replace(/=+$/, '');
  if (s.length % 4 == 1) throw new Error('atob');
  for (var bc = 0, bs, b, i = 0, o = ''; b = s.charAt(i++); ~b && (bs = bc % 4 ? bs * 64 + b : b, bc++ % 4) ? o += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) b = _B64C.indexOf(b);
  return o;
};
if (!String.prototype.padStart) {
  String.prototype.padStart = function (n, p) {
    var s = String(this); p = p == null ? ' ' : String(p);
    while (s.length < n) s = p + s;
    return s.slice(-n);
  };
}

// ── Endpoints ──────────────────────────────────────────────────────────
var CINEMETA = 'https://v3-cinemeta.strem.io';
var KITSU_API = 'https://anime-kitsu.strem.fun';
var HAGLUND_API = 'https://arm.haglund.dev/api/v2';
var TMDB_API = 'https://api.themoviedb.org/3';
var TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
var TMDB_IMG = 'https://image.tmdb.org/t/p';
var MULTI_DECRYPT = 'https://enc-dec.app/api';
var ANIKOTO_SITE = 'https://anikototv.to';
var ANIKOTO_MAPPER = 'https://mapper.nekostream.site/api/mal/';
var MEGAPLAY_BASES = ['https://megaplays.se', 'https://megaplay.buzz'];
var ANIZONE_SITE = 'https://anizone.to';
var ANIMESALT_SITE = 'https://animesalt.to';
var RA_SITE = 'https://www.rareanimes.mov';
var VA_PLAYER = 'https://streamdata.vaplayer.ru';
var VIDROCK = 'https://vidrock.to';
var VIDZEE = 'https://player.vidzee.wtf';
var VIDFAST = 'https://vidfast.vc';
var HEXA = 'https://theemoviedb.hexa.su';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var RA_FAMILY = /(^|\.)(codedew\.com|hubcloud\.[a-z]+|dlbeta\.[a-z]+|streambeta\.[a-z]+)$/i;
var RA_REL_PATH = /streambeta|zipper|multiquality|hubcloud|dlbeta|filepress/i;
var RA_REL_LABEL = /watch\s*now|stream|play|hubcloud|multiquality|download/i;

// ── Info / Settings ────────────────────────────────────────────────────
function getInfo() {
  return { name: 'Mewstream', lang: 'en', baseUrl: 'https://www.themoviedb.org',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io', type: 'movie', version: VERSION };
}
function getSettings() {
  return [
    { key: 'tmdbApiKey', label: 'TMDB API key (optional)', type: 'text', default: '' },
    { key: 'enableMegaplayDirect', label: 'MegaPlay (MAL/AniList direct)', type: 'bool', default: true },
    { key: 'enableAnikoto', label: 'AniKoto', type: 'bool', default: true },
    { key: 'enableAnizone', label: 'AniZone', type: 'bool', default: true },
    { key: 'enableAnimesalt', label: 'AnimeSalt', type: 'bool', default: true },
    { key: 'enableRareanimes', label: 'RareAnimes', type: 'bool', default: true },
    { key: 'enableVaplayer', label: 'VaPlayer', type: 'bool', default: true },
    { key: 'enableVidrock', label: 'Vidrock', type: 'bool', default: true },
    { key: 'enableVidzee', label: 'Vidzee', type: 'bool', default: true },
    { key: 'enableVidfast', label: 'Vidfast', type: 'bool', default: true },
    { key: 'enableHexa', label: 'Hexa', type: 'bool', default: true }
  ];
}

// ── Helpers ────────────────────────────────────────────────────────────
function _readSetting(k) {
  try {
    if (typeof __settings === 'undefined' || !__settings) return null;
    if (__settings[SOURCE_ID] && __settings[SOURCE_ID][k] != null) return __settings[SOURCE_ID][k];
    if (__settings[k] != null) return __settings[k];
  } catch (e) {}
  return null;
}
function _bool(k, d) {
  var v = _readSetting(k);
  if (v == null || v === '') return d;
  return String(v).toLowerCase() === 'true' || v === true;
}
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _text(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}
function _fixUrl(u, b) {
  u = String(u || '').trim();
  if (/^https?:\/\//.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (b && u.charAt(0) === '/') { var d = b.split('/'); return d[0] + '//' + d[2] + u; }
  if (b) return b.replace(/\/+$/, '') + '/' + u;
  return 'https://' + u;
}
function _origin(u) { return (String(u).match(/^(https?:\/\/[^\/?#]+)/i) || [])[1] || ''; }
function _host(u) { return ((String(u).match(/^https?:\/\/([^\/:?#]+)/i) || [])[1] || '').toLowerCase(); }
function _slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function _year(r) { return String(r.release_date || r.first_air_date || r.releaseInfo || r.year || '').slice(0, 4) || null; }

async function _fetchText(url, opts) {
  opts = opts || {};
  var h = Object.assign({ 'User-Agent': UA }, opts.headers || {});
  try {
    var req = { method: opts.method || 'GET', headers: h };
    if (opts.body != null) req.body = opts.body;
    var r = await fetch(url, req);
    if (!r) return '';
    var t = r.body;
    return typeof t !== 'string' ? JSON.stringify(t) : t;
  } catch (e) { return ''; }
}
async function _fetchJson(url, opts) {
  var t = await _fetchText(url, opts);
  try { return JSON.parse(t); } catch (e) { return null; }
}

// ── AES core ───────────────────────────────────────────────────────────
function _arr(x) { var a = []; for (var i = 0; i < x.length; i++) a.push(x[i] & 0xff); return a; }
var _SBOX = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _ISBOX = [0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
function _xtime(a) { a <<= 1; if (a & 0x100) a ^= 0x11b; return a & 0xff; }
function _gmul(a, b) { var p = 0; for (var i = 0; i < 8; i++) { if (b & 1) p ^= a; var hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1; } return p & 0xff; }
function _keyExp(key) {
  var Nk = key.length / 4, Nr = Nk + 6, w = [], i;
  for (i = 0; i < Nk; i++) w.push([key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]]);
  var rcon = 1;
  for (i = Nk; i < 4 * (Nr + 1); i++) {
    var t = w[i-1].slice();
    if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]]; t = [_SBOX[t[0]], _SBOX[t[1]], _SBOX[t[2]], _SBOX[t[3]]]; t[0] ^= rcon; rcon = _xtime(rcon); }
    else if (Nk > 6 && i % Nk === 4) { t = [_SBOX[t[0]], _SBOX[t[1]], _SBOX[t[2]], _SBOX[t[3]]]; }
    w.push([w[i-Nk][0]^t[0], w[i-Nk][1]^t[1], w[i-Nk][2]^t[2], w[i-Nk][3]^t[3]]);
  }
  return { w: w, Nr: Nr };
}
function _invCipher(inb, ks) {
  var w = ks.w, Nr = ks.Nr, s = [[],[],[],[]], r, c, i;
  for (i = 0; i < 16; i++) s[i%4][(i/4)|0] = inb[i];
  function ark(n) { for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) s[r][c] ^= w[n*4+c][r]; }
  function isub() { for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) s[r][c] = _ISBOX[s[r][c]]; }
  function ish() { for (r = 1; r < 4; r++) { var row = s[r].slice(); for (c = 0; c < 4; c++) s[r][c] = row[(c-r+4)%4]; } }
  function imx() { for (c = 0; c < 4; c++) {
    var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,14)^_gmul(a1,11)^_gmul(a2,13)^_gmul(a3,9);
    s[1][c]=_gmul(a0,9)^_gmul(a1,14)^_gmul(a2,11)^_gmul(a3,13);
    s[2][c]=_gmul(a0,13)^_gmul(a1,9)^_gmul(a2,14)^_gmul(a3,11);
    s[3][c]=_gmul(a0,11)^_gmul(a1,13)^_gmul(a2,9)^_gmul(a3,14);
  } }
  ark(Nr);
  for (var n = Nr-1; n >= 1; n--) { ish(); isub(); ark(n); imx(); }
  ish(); isub(); ark(0);
  var o = []; for (i = 0; i < 16; i++) o[i] = s[i%4][(i/4)|0]; return o;
}
function _aesEncBlock(inp, ks) {
  var s = [[],[],[],[]], r, c, i;
  for (i = 0; i < 16; i++) s[i%4][(i/4)|0] = inp[i];
  function ark(n) { for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) s[r][c] ^= ks.w[n*4+c][r]; }
  function sb() { for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) s[r][c] = _SBOX[s[r][c]]; }
  function sh() { for (r = 1; r < 4; r++) { var row = s[r].slice(); for (c = 0; c < 4; c++) s[r][c] = row[(c+r)%4]; } }
  function mx() { for (c = 0; c < 4; c++) {
    var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,2)^_gmul(a1,3)^a2^a3;
    s[1][c]=a0^_gmul(a1,2)^_gmul(a2,3)^a3;
    s[2][c]=a0^a1^_gmul(a2,2)^_gmul(a3,3);
    s[3][c]=_gmul(a0,3)^a1^a2^_gmul(a3,2);
  } }
  ark(0); for (var n = 1; n < ks.Nr; n++) { sb(); sh(); mx(); ark(n); }
  sb(); sh(); ark(ks.Nr);
  var o = []; for (i = 0; i < 16; i++) o[i] = s[i%4][(i/4)|0]; return o;
}
function _aesCbcDecrypt(ct, key, iv) {
  var ks = _keyExp(key), o = [], prev = iv.slice(), off, i;
  for (off = 0; off + 16 <= ct.length; off += 16) {
    var b = ct.slice(off, off + 16), dec = _invCipher(b, ks);
    for (i = 0; i < 16; i++) o.push(dec[i] ^ prev[i]);
    prev = b;
  }
  var pad = o[o.length - 1];
  if (pad > 0 && pad <= 16) o = o.slice(0, o.length - pad);
  return o;
}
function _padBytes(s, n) {
  var o = [], i;
  for (i = 0; i < n; i++) o[i] = 0;
  var b = String(s || '');
  for (i = 0; i < b.length && i < n; i++) o[i] = b.charCodeAt(i) & 0xff;
  return o;
}
function _bytesToStr(b) {
  var s = '', i = 0;
  while (i < b.length) {
    var c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xE0) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c < 0xF0) s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
    else { var cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f); cp -= 0x10000; s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
  }
  return s;
}
var _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64ToBytes(b64) {
  var s = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  while (s.length % 4) s += '=';
  var o = [], i, j;
  for (i = 0; i + 3 < s.length + 1; i += 4) {
    var n = 0, pad = 0;
    for (j = 0; j < 4; j++) { var ch = s.charAt(i + j), v = (ch === '=') ? 0 : _B64.indexOf(ch); if (ch === '=') pad++; n = (n << 6) | (v < 0 ? 0 : v); }
    o.push((n >> 16) & 255);
    if (pad < 2) o.push((n >> 8) & 255);
    if (pad < 1) o.push(n & 255);
  }
  return o;
}
var MEGA_KEY = 'i?LMTAx0Q6,:}50U';
var MEGA_IV = "W0;27ToaUpl_P%'c";
function _decryptMegaEnc(enc) {
  try {
    var ct = _b64ToBytes(enc);
    if (!ct.length || ct.length % 16) return null;
    var pt = _bytesToStr(_aesCbcDecrypt(ct, _padBytes(MEGA_KEY, 32), _padBytes(MEGA_IV, 16)));
    var o = JSON.parse(pt);
    if (!o) return null;
    if (o.file) return o.file;
    var s = o.sources;
    return s ? (s.file || (s[0] && s[0].file)) : null;
  } catch (e) { return null; }
}
function _fileFromSources(j) {
  var s = j && j.sources, f = s ? (s.file || (s[0] && s[0].file)) : null;
  if (f) return f;
  return j && j.enc ? _decryptMegaEnc(j.enc) : null;
}
function _decryptVidzee(enc, secret) {
  try {
    var p = _atob(enc).split(':');
    if (p.length < 2) return null;
    var iv = _arr(_b64ToBytes(p[0])), ct = _arr(_b64ToBytes(p[1]));
    if (!ct.length) return null;
    return _bytesToStr(_aesCbcDecrypt(ct, _padBytes(secret, 32), iv));
  } catch (e) { return null; }
}

// ── Classifier + title guard ──────────────────────────────────────────
function _normTitle(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ')
    .replace(/\b(season|part|cour|the|movie|film|sub|dub|hindi|tamil|telugu|english|dubbed|subbed|tv|series)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function _sim(a, b) {
  a = _normTitle(a); b = _normTitle(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  var A = a.split(' '), B = b.split(' '), setB = {};
  B.forEach(function (x) { setB[x] = 1; });
  var common = 0;
  A.forEach(function (x) { if (setB[x]) common++; });
  var ratio = common / Math.max(A.length, B.length);
  var prefix = (a.indexOf(b) === 0 || b.indexOf(a) === 0) ? 0.15 : 0;
  return Math.min(1, ratio + prefix);
}
function _titleOk(a, b) { return _sim(a, b) >= 0.72; }
function _pickBest(query, list) {
  var best = null, bestScore = 0;
  (list || []).forEach(function (x) {
    var s = _sim(query, x.title);
    if (s > bestScore) { bestScore = s; best = x; }
  });
  return best && bestScore >= 0.72 ? best : null;
}
function _classify(meta) {
  if (!meta) return { isAnime: false, type: 'movie', score: 0, reason: 'no-meta' };
  var g = (meta.genres || []).map(function (x) { return String(x).toLowerCase(); });
  var has = function (n) { return g.indexOf(n) >= 0; };
  var oc = (meta.originCountry || []).map(function (x) { return String(x).toUpperCase(); });
  var ol = String(meta.originalLanguage || '').toLowerCase();
  var score = 0, why = [];
  if (meta.kitsuId) { score += 3; why.push('kitsu'); }
  if (meta.anilistId || meta.malId) { score += 3; why.push('anilist/mal'); }
  if (has('animation') || has('anime')) { score += 2; why.push('animation'); }
  if (oc.indexOf('JP') >= 0 || oc.indexOf('CN') >= 0 || oc.indexOf('KR') >= 0 || oc.indexOf('TW') >= 0) { score += 2; why.push('origin-asia'); }
  if (ol === 'ja' || ol === 'zh' || ol === 'ko') { score += 2; why.push('lang-asia'); }
  if (has('documentary') || has('news') || has('reality') || has('talk show')) { score -= 3; why.push('-doc'); }
  if ((oc.indexOf('US') >= 0 || oc.indexOf('GB') >= 0) && !has('animation')) { score -= 2; why.push('-western'); }
  var isAnime = score >= 3;
  return { isAnime: isAnime, type: isAnime ? 'anime' : (meta.isSeries ? 'series' : 'movie'), score: score, reason: why.join(',') };
}

// ── Metadata ──────────────────────────────────────────────────────────
function _cinemetaItem(m) {
  if (!m || !m.id) return null;
  var isTv = m.type === 'series';
  var t = (m.aliases && m.aliases[0]) || m.name || '';
  if (!t) return null;
  var url = 'tmdb://' + (isTv ? 'tv' : 'movie') + '/' + m.id;
  return { id: url, url: url, title: t, cover: m.poster || null, type: isTv ? 'series' : 'movie', sourceId: SOURCE_ID };
}
function _kitsuItem(m) {
  if (!m || !m.id) return null;
  var t = (m.aliases && m.aliases[0]) || m.name || '';
  if (!t) return null;
  var url = 'tmdb://anime/' + m.id.replace('kitsu:', 'kitsu-');
  return { id: url, url: url, title: t, cover: m.poster || null, type: 'anime', sourceId: SOURCE_ID };
}
async function getHome() {
  var rows = [];
  try {
    var j = await _fetchJson(CINEMETA + '/catalog/movie/top.json');
    if (j && j.metas) { var items = j.metas.map(_cinemetaItem).filter(Boolean); if (items.length) rows.push({ title: 'Top Movies', items: items }); }
  } catch (e) {}
  try {
    var j2 = await _fetchJson(CINEMETA + '/catalog/series/top.json');
    if (j2 && j2.metas) { var items2 = j2.metas.map(_cinemetaItem).filter(Boolean); if (items2.length) rows.push({ title: 'Top Series', items: items2 }); }
  } catch (e) {}
  try {
    var j3 = await _fetchJson(KITSU_API + '/catalog/anime/kitsu-anime-trending.json');
    if (j3 && j3.metas) { var items3 = j3.metas.map(_kitsuItem).filter(Boolean); if (items3.length) rows.push({ title: 'Trending Anime', items: items3 }); }
  } catch (e) {}
  return rows;
}
async function popular() {
  var rows = await getHome();
  var out = [];
  rows.forEach(function (r) { r.items.forEach(function (i) { out.push(i); }); });
  return out;
}
async function search(query) {
  var q = _trim(query); if (!q) return [];
  var rows = await Promise.all([
    _fetchText(CINEMETA + '/catalog/movie/top/search=' + encodeURIComponent(q) + '.json'),
    _fetchText(CINEMETA + '/catalog/series/top/search=' + encodeURIComponent(q) + '.json'),
    _fetchText(KITSU_API + '/catalog/anime/kitsu-anime-trending/search=' + encodeURIComponent(q) + '.json')
  ]);
  var out = [];
  function add(raw, isKitsu) {
    if (!raw) return;
    try {
      var j = JSON.parse(raw);
      if (!j.metas) return;
      j.metas.forEach(function (m) { var it = isKitsu ? _kitsuItem(m) : _cinemetaItem(m); if (it) out.push(it); });
    } catch (e) {}
  }
  add(rows[0], false); add(rows[1], false); add(rows[2], true);
  return out;
}
function _parseDetailUrl(v) {
  var s = String(v || '');
  var m = s.match(/^tmdb:\/\/anime\/kitsu-(\d+)/i);
  if (m) return { kind: 'kitsu', id: m[1] };
  m = s.match(/^tmdb:\/\/(movie|tv|series)\/([^\/?#]+)/i);
  if (m) {
    var k = m[1].toLowerCase() === 'movie' ? 'movie' : 'tv', id = decodeURIComponent(m[2]);
    if (/^tt\d+$/.test(id)) return { kind: k === 'movie' ? 'movie' : 'series', id: id };
    if (/^\d+$/.test(id)) return { kind: 'tmdb', type: k, id: id };
  }
  return null;
}
function _epUrl(o) {
  return JSON.stringify({
    imdbId: o.imdb || undefined, tmdbId: o.tmdb || undefined,
    kitsuId: o.kitsu || undefined, anilistId: o.anilist || undefined, malId: o.mal || undefined,
    season: o.season || 0, episode: o.episode || 0,
    title: o.title || undefined, year: o.year || undefined,
    isAnime: o.isAnime === true
  });
}
async function getDetail(url) {
  var p = _parseDetailUrl(url);
  if (!p) return null;
  if (p.kind === 'kitsu') {
    var res = await _fetchText(KITSU_API + '/meta/series/kitsu%3A' + p.id + '.json');
    if (!res) return null;
    var meta; try { meta = JSON.parse(res).meta; } catch (e) { return null; }
    if (!meta) return null;
    var hg = {}; try { hg = JSON.parse(await _fetchText(HAGLUND_API + '/ids?source=kitsu&id=' + p.id)) || {}; } catch (e) {}
    var imdb = hg.imdb || null, tmdb = hg.themoviedb || null, anilist = hg.anilist || null, mal = hg.myanimelist || null;
    var title = (meta.aliases && meta.aliases[0]) || meta.name || 'Untitled';
    var base = { imdb: imdb, tmdb: tmdb, kitsu: p.id, anilist: anilist, mal: mal, title: title, year: _year(meta), isAnime: true };
    var eps = (meta.videos || []).map(function (v) {
      var o = Object.assign({}, base, { season: v.season, episode: v.episode });
      return { id: v.season + 'x' + v.episode,
        title: 'S' + String(v.season).padStart(2, '0') + 'E' + String(v.episode).padStart(2, '0') + ' - ' + (v.title || ''),
        number: v.episode, season: v.season, url: _epUrl(o), thumbnail: v.thumbnail || null };
    });
    return { id: url, url: url, title: title, cover: meta.poster || null, banner: meta.background || null,
      description: meta.description || '', type: 'anime', isAnime: true, isSeries: true,
      genres: meta.genres || [], originCountry: ['JP'], originalLanguage: 'ja',
      sourceId: SOURCE_ID, year: _year(meta), imdbId: imdb, tmdbId: tmdb,
      kitsuId: p.id, anilistId: anilist, malId: mal, episodes: eps };
  }
  if (p.kind === 'movie' || p.kind === 'series') {
    var res2 = await _fetchText(CINEMETA + '/meta/' + (p.kind === 'series' ? 'series' : 'movie') + '/' + p.id + '.json');
    if (!res2) {
      var key0 = _readSetting('tmdbApiKey') || TMDB_KEY;
      var find = await _fetchJson(TMDB_API + '/find/' + p.id + '?api_key=' + key0 + '&external_source=imdb_id');
      if (find) {
        if (p.kind === 'movie' && find.movie_results && find.movie_results.length) return getDetail('tmdb://movie/' + find.movie_results[0].id);
        if (p.kind === 'series' && find.tv_results && find.tv_results.length) return getDetail('tmdb://tv/' + find.tv_results[0].id);
      }
      return null;
    }
    var meta2; try { meta2 = JSON.parse(res2).meta; } catch (e) { return null; }
    if (!meta2) return null;
    var isTv = p.kind === 'series';
    var title2 = (meta2.aliases && meta2.aliases[0]) || meta2.name || 'Untitled';
    var imdb2 = meta2.imdb_id || p.id, tmdb2 = meta2.moviedb_id || null;
    var en = null;
    if (tmdb2) {
      var key = _readSetting('tmdbApiKey') || TMDB_KEY;
      var tj = await _fetchJson(TMDB_API + '/' + (isTv ? 'tv' : 'movie') + '/' + tmdb2 + '?api_key=' + key);
      if (tj && !tj.status_code) en = { genres: (tj.genres || []).map(function (x) { return x.name; }), originCountry: tj.origin_country || [], originalLanguage: tj.original_language || '' };
    }
    var genres = en ? en.genres : (meta2.genre || meta2.genres || []);
    var cls = _classify({ genres: genres, originCountry: en ? en.originCountry : [], originalLanguage: en ? en.originalLanguage : '', isSeries: isTv });
    var base2 = { imdb: imdb2, tmdb: tmdb2, title: title2, year: _year(meta2), isAnime: cls.isAnime };
    var eps2 = isTv
      ? (meta2.videos || []).filter(function (v) { return v.season !== 0; })
          .sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); })
          .map(function (v) {
            var o = Object.assign({}, base2, { season: v.season, episode: v.episode });
            return { id: v.season + 'x' + v.episode,
              title: 'S' + String(v.season).padStart(2, '0') + 'E' + String(v.episode).padStart(2, '0') + ' - ' + (v.name || ''),
              number: v.episode, season: v.season, url: _epUrl(o), thumbnail: v.thumbnail || null };
          })
      : [{ id: 'movie', title: title2, number: 1, url: _epUrl(Object.assign({}, base2, { season: 0, episode: 0 })) }];
    return { id: url, url: url, title: title2, cover: meta2.poster || null, banner: meta2.background || null,
      description: meta2.description || '', type: cls.type, isAnime: cls.isAnime, isSeries: isTv,
      genres: genres, originCountry: en ? en.originCountry : [], originalLanguage: en ? en.originalLanguage : '',
      classifyReason: cls.reason, sourceId: SOURCE_ID, year: _year(meta2),
      imdbId: imdb2, tmdbId: tmdb2, episodes: eps2 };
  }
  if (p.kind === 'tmdb') {
    var key2 = _readSetting('tmdbApiKey') || TMDB_KEY;
    var info = await _fetchJson(TMDB_API + '/' + p.type + '/' + p.id + '?api_key=' + key2 + '&append_to_response=external_ids');
    if (!info || info.status_code) return null;
    var isTv3 = p.type === 'tv';
    var title3 = info.title || info.name || 'Untitled';
    var imdb3 = info.external_ids ? info.external_ids.imdb_id : null;
    var genres3 = (info.genres || []).map(function (g) { return g.name; });
    var cls3 = _classify({ genres: genres3, originCountry: info.origin_country || [], originalLanguage: info.original_language || '', isSeries: isTv3 });
    var base3 = { imdb: imdb3, tmdb: p.id, title: title3, year: (info.release_date || info.first_air_date || '').slice(0, 4), isAnime: cls3.isAnime };
    var eps3 = [];
    if (isTv3 && info.seasons) {
      for (var i = 0; i < info.seasons.length; i++) {
        var s = info.seasons[i]; if (s.season_number === 0) continue;
        var ed = await _fetchJson(TMDB_API + '/tv/' + p.id + '/season/' + s.season_number + '?api_key=' + key2);
        if (ed && ed.episodes) ed.episodes.forEach(function (ep) {
          var o = Object.assign({}, base3, { season: ep.season_number, episode: ep.episode_number });
          eps3.push({ id: ep.season_number + 'x' + ep.episode_number,
            title: 'S' + String(ep.season_number).padStart(2, '0') + 'E' + String(ep.episode_number).padStart(2, '0') + ' - ' + (ep.name || ''),
            number: ep.episode_number, season: ep.season_number, url: _epUrl(o),
            thumbnail: ep.still_path ? TMDB_IMG + '/w300' + ep.still_path : null });
        });
      }
    } else if (!isTv3) {
      eps3 = [{ id: 'movie', title: title3, number: 1, url: _epUrl(Object.assign({}, base3, { season: 0, episode: 0 })) }];
    }
    return { id: url, url: url, title: title3,
      cover: info.poster_path ? TMDB_IMG + '/w500' + info.poster_path : null,
      banner: info.backdrop_path ? TMDB_IMG + '/w780' + info.backdrop_path : null,
      description: info.overview || '', type: cls3.type, isAnime: cls3.isAnime, isSeries: isTv3,
      genres: genres3, originCountry: info.origin_country || [], originalLanguage: info.original_language || '',
      classifyReason: cls3.reason, sourceId: SOURCE_ID,
      year: (info.release_date || info.first_air_date || '').slice(0, 4) || null,
      imdbId: imdb3, tmdbId: p.id, episodes: eps3 };
  }
  return null;
}
function getEpisodes(url) { return getDetail(url).then(function (d) { return d ? d.episodes : []; }); }
function _parseStreamId(raw) {
  var o = raw && typeof raw === 'object' ? raw : null;
  if (!o) { try { o = JSON.parse(String(raw || '{}')); } catch (e) { o = {}; } }
  var season = parseInt(o.season, 10); if (isNaN(season) || season <= 0) season = null;
  return {
    season: season, episode: parseInt(o.episode, 10) || 0,
    imdbId: o.imdbId || null, tmdbId: o.tmdbId || null,
    kitsuId: o.kitsuId || null, anilistId: o.anilistId || null, malId: o.malId || null,
    title: o.title || null, year: o.year || null, isAnime: o.isAnime === true
  };
}
async function _resolveMeta(p) {
  var m = { title: p.title || null, year: p.year || null, imdbId: p.imdbId, tmdbId: p.tmdbId,
    malId: p.malId, anilistId: p.anilistId, kitsuId: p.kitsuId, isAnime: p.isAnime === true,
    genres: [], originCountry: [], originalLanguage: '' };
  if (!m.isAnime && (m.imdbId || m.tmdbId)) {
    try {
      var d = await _fetchJson(CINEMETA + '/meta/' + (p.season ? 'series' : 'movie') + '/' + (m.imdbId || m.tmdbId) + '.json');
      if (d && d.meta) {
        m.title = m.title || d.meta.name || (d.meta.aliases && d.meta.aliases[0]);
        m.year = m.year || parseInt(d.meta.releaseInfo || d.meta.year);
        if (!m.tmdbId && d.meta.moviedb_id) m.tmdbId = d.meta.moviedb_id;
        m.genres = d.meta.genre || d.meta.genres || [];
      }
    } catch (e) {}
    if (m.tmdbId) {
      var key = _readSetting('tmdbApiKey') || TMDB_KEY;
      var tj = await _fetchJson(TMDB_API + '/' + (p.season ? 'tv' : 'movie') + '/' + m.tmdbId + '?api_key=' + key);
      if (tj && !tj.status_code) { m.genres = (tj.genres || []).map(function (x) { return x.name; }); m.originCountry = tj.origin_country || []; m.originalLanguage = tj.original_language || ''; }
    }
  }
  var cls = _classify({ genres: m.genres, originCountry: m.originCountry, originalLanguage: m.originalLanguage, kitsuId: m.kitsuId, anilistId: m.anilistId, malId: m.malId, isSeries: !!p.season });
  m.isAnime = m.isAnime || cls.isAnime;
  m.classifyReason = cls.reason;
  return m;
}

// ── Anime sources ─────────────────────────────────────────────────────
function _parseServers(html) {
  var src = String(html || ''), out = [], seen = {}, tagRe = /<\/?([a-z][a-z0-9:-]*)\b([^>]*)>/gi, stack = [], m;
  function attr(a, n) { var re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, x; while ((x = re.exec(a || ''))) if (x[1].toLowerCase() === n.toLowerCase()) return x[2] !== undefined ? x[2] : x[3]; return ''; }
  function vis(r) { return String(r || '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim(); }
  while ((m = tagRe.exec(src))) {
    var full = m[0], tag = m[1].toLowerCase(), attrs = m[2] || '';
    if (full.charAt(1) === '/') { for (var i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; } continue; }
    if (tag === 'li') {
      var cr = /<\/li\s*>/ig; cr.lastIndex = tagRe.lastIndex; var cl = cr.exec(src);
      var inner = cl ? src.slice(tagRe.lastIndex, cl.index) : '';
      var id = attr(attrs, 'data-link-id') || attr(inner, 'data-link-id');
      if (id && !/download-icon/i.test(attrs + ' ' + inner)) {
        var type = attr(attrs, 'data-type');
        if (!type) for (var j = stack.length - 1; j >= 0; j--) { type = attr(stack[j].attrs, 'data-type') || attr(stack[j].attrs, 'type'); if (type) break; }
        if (!type) { var b4 = src.slice(0, m.index), tr = /(?:data-type|type)\s*=\s*["'](sub|hsub|dub)["']/gi, tm, last = ''; while ((tm = tr.exec(b4))) last = tm[1]; type = last || 'sub'; }
        type = String(type).toLowerCase();
        if (type !== 'sub' && type !== 'hsub' && type !== 'dub') type = /dub/i.test(type) ? 'dub' : 'sub';
        var name = vis(inner), k = type + '|' + id + '|' + name;
        if (!seen[k]) { seen[k] = 1; out.push({ type: type, linkId: id, name: name || ('S' + id) }); }
      }
    }
    if (!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) && !/\/\s*>$/.test(full)) stack.push({ tag: tag, attrs: attrs });
  }
  return out;
}
function _sourcesUrl(base, id, type) {
  var p = /(?:megaplay|megaplays|vidwish|vidtube)\.[a-z]+/i.test(String(base || '')) ? '/stream/getSourcesNew' : '/stream/getSources';
  return base + p + '?id=' + id + '&type=' + type;
}
function _extractPlayer(embed, cat, name) {
  var base = (embed.match(/^(https?:\/\/[^/]+)/) || [])[1] || MEGAPLAY_BASES[0];
  var type = (embed.match(/\/(sub|hsub|dub)\/?(?:[?#]|$)/i) || [])[1] || cat;
  return _fetchText(embed, { headers: { 'Referer': ANIKOTO_SITE + '/' } }).then(function (h) {
    var id = (h.match(/data-id=["'](\d+)["']/i) || [])[1];
    if (!id) throw new Error('no embed id');
    var tries = [_sourcesUrl(base, id, type), base + '/stream/getSources?id=' + id + '&type=' + type];
    function next(i) {
      if (i >= tries.length) return Promise.reject(new Error('no getSources'));
      return fetch(tries[i], { headers: { 'User-Agent': UA, 'Referer': embed, 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) {
          var b = (r && r.body) || '';
          var j; try { j = JSON.parse(b); } catch (e) { return next(i + 1); }
          var file = _fileFromSources(j);
          if (!file) return next(i + 1);
          var subs = [];
          ((j && j.tracks) || []).forEach(function (t) {
            if (t && t.file && (!t.kind || t.kind === 'captions' || t.kind === 'subtitles'))
              subs.push({ url: t.file, lang: t.label || 'Sub', format: /\.srt(\?|$)/i.test(t.file) ? 'srt' : 'vtt' });
          });
          return [{ url: file + '#mew-' + _slug(name || 'server') + '-' + cat,
            label: (name || 'AniKoto') + ' · ' + cat, quality: 'auto',
            container: /\.m3u8(\?|$)/i.test(file) ? 'hls' : 'mp4',
            headers: { 'User-Agent': UA, 'Referer': base + '/', 'Origin': base },
            kind: cat, audioLang: cat === 'dub' ? 'en' : 'ja', subtitles: subs }];
        })
        .catch(function () { return next(i + 1); });
    }
    return next(0);
  });
}
function _mpDirectOnce(base, kind, idVal, ep, lang) {
  var embed = base + '/stream/' + kind + '/' + idVal + '/' + ep + '/' + lang;
  return _fetchText(embed, { headers: { 'Referer': base + '/' } }).then(function (h) {
    if (!h) throw new Error('empty embed');
    var dataId = (h.match(/data-id=["'](\d+)["']/i) || [])[1];
    if (!dataId) throw new Error('no data-id');
    var urls = [base + '/stream/getSourcesNew?id=' + dataId + '&type=' + lang, base + '/stream/getSources?id=' + dataId + '&type=' + lang];
    function tryOne(i) {
      if (i >= urls.length) return Promise.reject(new Error('no sources'));
      return fetch(urls[i], { headers: { 'User-Agent': UA, 'Referer': embed, 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) {
          var b = (r && r.body) || '';
          var j; try { j = JSON.parse(b); } catch (e) { return tryOne(i + 1); }
          var file = _fileFromSources(j);
          if (!file) return tryOne(i + 1);
          var subs = [];
          ((j && j.tracks) || []).forEach(function (t) {
            if (t && t.file && (!t.kind || t.kind === 'captions' || t.kind === 'subtitles'))
              subs.push({ url: t.file, lang: t.label || 'Sub', format: /\.srt(\?|$)/i.test(t.file) ? 'srt' : 'vtt' });
          });
          return [{ url: file + '#mew-mpd-' + lang,
            label: 'MegaPlay · ' + lang, quality: 'auto',
            container: /\.m3u8(\?|$)/i.test(file) ? 'hls' : 'mp4',
            headers: { 'User-Agent': UA, 'Referer': base + '/', 'Origin': base },
            kind: lang, audioLang: lang === 'dub' ? 'en' : 'ja', subtitles: subs }];
        })
        .catch(function () { return tryOne(i + 1); });
    }
    return tryOne(0);
  });
}
async function getMegaplayDirect(malId, anilistId, episode, subCb) {
  var kind = malId ? 'mal' : (anilistId ? 'ani' : null);
  var idVal = malId || anilistId;
  if (!kind || !idVal) return [];
  var ep = episode || 1, out = [];
  var langs = ['sub', 'dub'];
  for (var li = 0; li < langs.length; li++) {
    var lang = langs[li];
    for (var bi = 0; bi < MEGAPLAY_BASES.length; bi++) {
      try {
        var r = await _mpDirectOnce(MEGAPLAY_BASES[bi], kind, idVal, ep, lang);
        if (r && r.length) {
          out = out.concat(r);
          (r[0].subtitles || []).forEach(function (s) { if (s.url) subCb({ url: s.url, lang: s.lang || 'Sub' }); });
          break;
        }
      } catch (e) {}
    }
  }
  return out;
}
function _anGet(url, ref, xhr) {
  var h = { 'User-Agent': UA, 'Referer': ref || ANIKOTO_SITE + '/' };
  if (xhr) h['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(url, { headers: h }).then(function (r) { return (r && r.body) || ''; }).catch(function () { return ''; });
}
function _anJson(url, ref) { return _anGet(url, ref).then(function (b) { try { return JSON.parse(b || 'null'); } catch (e) { return null; } }); }
function _anAjax(path) { return _anGet(ANIKOTO_SITE + path, ANIKOTO_SITE + '/', true).then(function (b) { try { return JSON.parse(b || 'null'); } catch (e) { return null; } }).catch(function () { return null; }); }
async function _anSearchSlug(title) {
  var q = _trim(title); if (!q) return null;
  var h = await _anGet(ANIKOTO_SITE + '/filter?keyword=' + encodeURIComponent(q), ANIKOTO_SITE + '/');
  var re = /<a\b[^>]*href="([^"]*\/watch\/([^"\/?#]+))"[^>]*>([\s\S]{0,400}?)<\/a>/gi, m, hits = [];
  while ((m = re.exec(h))) { var t = _text(m[3]); if (t) hits.push({ slug: m[2], title: t }); }
  if (!hits.length) { var m2 = h.match(/href="([^"]*\/watch\/([^"\/?#]+))"/); if (m2) hits.push({ slug: m2[2], title: q }); }
  var best = _pickBest(q, hits);
  if (!best) { console.log('Mewstream: AniKoto title guard rejected "' + q + '"'); return null; }
  return best.slug;
}
async function _anEpisodes(slug) {
  var h = await _anGet(ANIKOTO_SITE + '/watch/' + encodeURIComponent(slug), ANIKOTO_SITE + '/');
  var id = (h.match(/data-id="(\d+)"/) || [])[1];
  if (!id) return [];
  var j = await _anAjax('/ajax/episode/list/' + id);
  var lh = j && typeof j.result === 'string' ? j.result : '';
  var eps = [], re = /<a\b([^>]*\bdata-id="\d+"[^>]*)>/g, m;
  while ((m = re.exec(lh))) {
    var a = m[1], sids = (a.match(/data-ids="([^"]+)"/) || [])[1];
    if (!sids) continue;
    var num = parseInt((a.match(/data-num="(\d+)"/) || [])[1] || '0', 10);
    var sub = (a.match(/data-sub="(\d+)"/) || [])[1] === '1';
    var dub = (a.match(/data-dub="(\d+)"/) || [])[1] === '1';
    if (!sub && !dub) continue;
    var em = (a.match(/data-mal="(\d+)"/) || [])[1], es = (a.match(/data-slug="([^"]+)"/) || [])[1], et = (a.match(/data-timestamp="(\d+)"/) || [])[1];
    var tok = (em && es && et) ? (em + '/' + encodeURIComponent(es) + '/' + et) : null;
    eps.push({ number: num, url: 'anikoto://' + (dub ? 'dub' : 'sub') + '/' + encodeURIComponent(sids) + '/' + (sub ? 1 : 0) + (dub ? 1 : 0) + '/' + num + (tok ? '/' + tok : '') });
  }
  return eps;
}
function _anResolveServer(sv, cat) {
  var sc = sv.type === 'dub' ? 'dub' : (sv.type === 'hsub' ? 'hsub' : 'sub');
  return _anAjax('/ajax/server?get=' + encodeURIComponent(sv.linkId)).then(function (j) {
    var u = j && j.result && (typeof j.result === 'object' ? j.result.url : null);
    if (!u || !/^https?:\/\//i.test(u)) return [];
    if (/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(u)) return [{ url: u, label: (sv.name || 'AniKoto') + ' · ' + sc, quality: 'auto', container: 'hls', headers: { 'User-Agent': UA, 'Referer': ANIKOTO_SITE + '/' }, kind: sc }];
    return _extractPlayer(u, sc, sv.name).catch(function () { return []; });
  }).catch(function () { return []; });
}
function _anTryAll(list, cat) {
  return Promise.all((list || []).map(function (s) { return _anResolveServer(s, cat); })).then(function (g) { var o = []; g.forEach(function (x) { o = o.concat(x); }); return o; });
}
function _anMapperAll(token, cat) {
  if (!token) return Promise.resolve([]);
  return _anJson(ANIKOTO_MAPPER + token, ANIKOTO_SITE + '/').then(function (j) {
    var ex = [];
    for (var n in (j || {})) { var e = j[n]; if (n === 'status' || !e || typeof e !== 'object') continue; var b = e[cat]; if (b && b.url) ex.push({ type: cat, linkId: String(b.url), name: n }); }
    return _anTryAll(ex, cat);
  }).catch(function () { return []; });
}
function _anVideoSources(epUrl) {
  var raw = String(epUrl).replace('anikoto://', ''), parts = raw.split('/');
  var cat = parts[0] === 'dub' ? 'dub' : 'sub';
  var sids = parts[1] ? decodeURIComponent(parts[1]) : '';
  var token = (parts[4] && parts[5] && parts[6]) ? (parts[4] + '/' + parts[5] + '/' + parts[6]) : null;
  if (!sids) return Promise.reject(new Error('no server ids'));
  return _anAjax('/ajax/server/list?servers=' + encodeURIComponent(sids)).then(function (j) {
    var lh = j && typeof j.result === 'string' ? j.result : '';
    var servers = _parseServers(lh);
    return Promise.all([_anTryAll(servers, cat), _anMapperAll(token, cat)]).then(function (r) {
      var all = r[0].concat(r[1]).filter(function (s) { return s && s.url; });
      if (all.length) return all;
      throw new Error('no playable server');
    });
  }).catch(function (err) { return _anMapperAll(token, cat).then(function (x) { if (x.length) return x; throw err; }); });
}
async function getAnikoto(title, season, episode, subCb) {
  try {
    var slug = await _anSearchSlug(title);
    if (!slug) return [];
    var eps = await _anEpisodes(slug);
    if (!eps.length) return [];
    var tn = episode || 1;
    var f = eps.filter(function (e) { return e.number === tn; })[0];
    if (!f && (season === 1 || season == null)) f = eps.reduce(function (p, c) { return Math.abs(c.number - tn) < Math.abs(p.number - tn) ? c : p; }, eps[0]);
    if (!f) return [];
    var st = await _anVideoSources(f.url);
    st.forEach(function (s) { (s.subtitles || []).forEach(function (x) { if (x.url) subCb({ url: x.url, lang: x.lang || 'Sub' }); }); });
    return st;
  } catch (e) { console.log('Mewstream: AniKoto failed: ' + (e && e.message || e)); return []; }
}
async function getAnizone(title, season, episode, subCb) {
  try {
    var q = _trim(title); if (!q) return [];
    var slug = null;
    var cands = ['/search?query=', '/search?q=', '/filter?keyword='];
    for (var i = 0; i < cands.length && !slug; i++) {
      var h = await _fetchText(ANIZONE_SITE + cands[i] + encodeURIComponent(q), { headers: { 'Referer': ANIZONE_SITE + '/' } });
      if (!h) continue;
      var re = /<a\b[^>]*href="([^"]*\/anime\/([^"\/?#]+))"[^>]*>([\s\S]{0,300}?)<\/a>/gi, m, hits = [];
      while ((m = re.exec(h))) { var t = _text(m[3]); if (t && t.length < 160) hits.push({ slug: m[2], title: t }); }
      var best = _pickBest(q, hits);
      if (best) slug = best.slug;
    }
    if (!slug) return [];
    var epUrl = ANIZONE_SITE + '/anime/' + encodeURIComponent(slug) + '/' + (episode || 1);
    var html = await _fetchText(epUrl, { headers: { 'Referer': ANIZONE_SITE + '/' } });
    if (!html) return [];
    var out = [];
    var ifr = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (ifr) { var r = await _resolveEmbedGeneric(_fixUrl(ifr[1], epUrl), epUrl); if (r && r.length) out = out.concat(r); }
    var direct = html.match(/https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/i);
    if (direct) out = out.concat(_mkStream(direct[0], epUrl, 'AniZone'));
    return out;
  } catch (e) { console.log('Mewstream: AniZone failed: ' + (e && e.message || e)); return []; }
}
async function getAnimesalt(title, season, episode, subCb) {
  try {
    var slug = _slug(title); if (!slug) return [];
    var hdrs = { 'Referer': ANIMESALT_SITE + '/', 'User-Agent': UA };
    var url = season == null ? ANIMESALT_SITE + '/movies/' + slug + '/' : ANIMESALT_SITE + '/episode/' + slug + '-' + season + 'x' + episode + '/';
    var html = await _fetchText(url, { headers: hdrs });
    if (!html) return [];
    var ifm = html.match(/src="(https:\/\/as-cdn\d+\.top\/video\/([a-f0-9]+))"/);
    if (!ifm) return [];
    var data = await _fetchJson(ifm[1].split('/video/')[0] + '/player/index.php?data=' + ifm[2] + '&do=getVideo',
      { method: 'POST', headers: Object.assign({}, hdrs, { 'Origin': ifm[1].split('/video/')[0], 'X-Requested-With': 'XMLHttpRequest' }), body: 'hash=' + ifm[2] + '&r=' + encodeURIComponent(ANIMESALT_SITE + '/') });
    if (!data) return [];
    var m3u8 = data.videoSource || data.securedLink;
    return m3u8 ? _mkStream(m3u8, ANIMESALT_SITE + '/', 'AnimeSalt') : [];
  } catch (e) { console.log('Mewstream: AnimeSalt failed: ' + (e && e.message || e)); return []; }
}
function _raDecode(s) {
  return String(s == null ? '' : s).replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); }).replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); }).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');
}
function _raStrip(s) { return _raDecode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function _raClean(s) {
  s = _raStrip(s).replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*[-–|]?\s*\b(?:Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|Dual Audio|Multi Audio|All Episodes|Episodes?|Download|HD|Watch Online|Complete)\b[\s\S]*$/i, '');
  return s.replace(/[\s\-–|:,(]+$/, '').trim() || 'Untitled';
}
function _raListing(html) {
  html = String(html || '');
  var out = [], seen = {}, re = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi, m;
  while ((m = re.exec(html))) {
    var body = m[2];
    var a = body.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/i) || body.match(/<a\b[^>]*title=["']([^"']+)["'][^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/i);
    var href = '', title = '';
    if (a) { if (/^https?:\/\//i.test(a[1])) { href = a[1]; title = a[2] || ''; } else { title = a[1] || ''; href = a[2] || ''; } }
    if (!title) title = _raStrip((body.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i) || [])[1] || '');
    if (!href || !title || seen[href]) continue;
    seen[href] = 1; out.push({ url: href, title: _raClean(title) });
  }
  return out;
}
function _raPostLines(c) {
  var html = String(c || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
  var links = [];
  html = html.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, function (all, url, label) {
    var raw = _raDecode(url).trim(), text = _raStrip(label), full = '';
    if (/^https?:\/\//i.test(raw)) { if (RA_FAMILY.test(_host(raw))) full = raw; }
    else if (/^\/\//.test(raw)) { var p = 'https:' + raw; if (RA_FAMILY.test(_host(p))) full = p; }
    else if (raw.charAt(0) === '/' && (RA_REL_PATH.test(raw) || RA_REL_LABEL.test(text))) full = 'https://codedew.com' + raw;
    if (!full) return all;
    links.push({ url: full, label: text });
    return ' __RAI_' + (links.length - 1) + '__ ';
  });
  html = html.replace(/<(?:p|h[1-6]|hr|br|div|li|tr)\b[^>]*>/gi, '\n');
  return html.split(/\n/).map(function (l) {
    var t = [];
    l = l.replace(/__RAI_(\d+)__/g, function (_, n) { if (links[+n]) t.push(links[+n]); return ''; });
    return { text: _raStrip(l), links: t };
  }).filter(function (x) { return x.text || x.links.length; });
}
function _raEpisodes(c) {
  var lines = _raPostLines(c), eps = [], cur = null, nl = 1;
  function ens(n, t) {
    var f = eps.filter(function (e) { return e.number === n; })[0];
    if (f) { if (t && (!f.title || /^Episode \d+$/i.test(f.title))) f.title = t; return f; }
    f = { number: n, title: t || ('Episode ' + n), variants: [] }; eps.push(f); return f;
  }
  lines.forEach(function (l) {
    var h = l.text.match(/^(?:episode|ep\.?)\s*0*(\d{1,4})\b\s*(?:[-–:]\s*(.*))?$/i);
    if (h) { cur = ens(+h[1], (h[2] || '').trim()); }
    if (l.links.length) {
      if (!cur) { cur = ens(nl, 'Episode ' + nl); nl++; }
      var us = l.links.filter(function (x) { return /watchnow|watch\b|hubcloud/i.test(x.label); });
      if (!us.length) us = l.links;
      if (!us.length) return;
      var pr = us[0];
      var urls = us.map(function (x) { return x.url; }).filter(function (u, i, a) { return a.indexOf(u) === i; }).slice(0, 6);
      if (!cur.variants.length) cur.variants.push({ lang: 'Default', url: pr.url, alts: urls });
    }
  });
  return eps.sort(function (a, b) { return a.number - b.number; }).map(function (e) { return { number: e.number, title: e.title, url: 'rare://' + encodeURIComponent(JSON.stringify({ variants: e.variants })) }; });
}
function _raBal(s, o, c) {
  var st = s.indexOf(o); if (st < 0) return '';
  var d = 0, q = '', e = false;
  for (var i = st; i < s.length; i++) {
    var ch = s.charAt(i);
    if (q) { if (e) e = false; else if (ch === '\\') e = true; else if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === o) d++;
    if (ch === c && --d === 0) return s.slice(st, i + 1);
  }
  return '';
}
function _raMaybe(s) {
  s = String(s || '').trim(); if (!s) return [];
  try { var j = JSON.parse(s), a = Array.isArray(j) ? j : (j.sources || j.playerSources || j.data || j.links || j.streams || []); if (Array.isArray(a) && a.length) return a; } catch (e) {}
  var b = _raBal(s, '[', ']');
  if (b && b !== s) { try { var j2 = JSON.parse(b), a2 = Array.isArray(j2) ? j2 : (j2.sources || []); if (a2.length) return a2; } catch (e) {} }
  return [];
}
function _raNorm(l) {
  var o = [];
  (l || []).forEach(function (s) {
    if (typeof s === 'string') s = { stream_url: s };
    if (!s || typeof s !== 'object') return;
    var u = s.stream_url || s.file || s.url || s.src || ''; if (!u) return;
    o.push({ stream_url: String(u), name: String(s.name || s.label || 'Server') });
  });
  return o;
}
function _raSources(html) {
  var h = String(html || ''), m, re = /playerSources\s*[:=]\s*/gi;
  while ((m = re.exec(h))) {
    var a = _raMaybe(h.slice(m.index + m[0].length, m.index + m[0].length + 400000));
    if (a.length) return _raNorm(a);
  }
  var flat = h.replace(/\\u0026/g, '&').replace(/\\\//g, '/'), seen = {}, list = [];
  function push(u) { u = _raDecode(u); if (!/^(?:https?:)?\/\//i.test(u) || seen[u]) return; seen[u] = 1; list.push({ stream_url: u, name: 'Server' }); }
  re = /["']?(?:stream_url|streamUrl|file|src|url|source)["']?\s*[:=]\s*["']((?:https?:)?\/\/[^"'\s]+?\.(?:m3u8|mp4)(?:\?[^"'\s]*)?)["']/gi;
  while ((m = re.exec(flat))) push(m[1]);
  re = /https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/gi;
  while ((m = re.exec(flat))) push(m[0]);
  return _raNorm(list);
}
function _raSbUrl(u, b) {
  u = _raDecode(String(u || '')).replace(/\\\//g, '/').trim();
  if (/^\/\//.test(u)) u = 'https:' + u;
  else if (u.charAt(0) === '/') u = (b ? _origin(b) : 'https://codedew.com') + u;
  return /^https?:\/\//i.test(u) && RA_FAMILY.test(_host(u)) ? u : '';
}
function _raFollow(html, target, ctx) {
  var raws = [], m, re;
  re = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url=([^"']+)["']/gi; while ((m = re.exec(html))) raws.push(m[1]);
  re = /(?:location(?:\.href)?\s*=|location\.(?:replace|assign)\s*\(|window\.open\s*\()\s*["']([^"']+)["']/gi; while ((m = re.exec(html))) raws.push(m[1]);
  re = /(?:data-href|data-src|data-url|href|src|content)=["']([^"']+)["']/gi; while ((m = re.exec(html))) raws.push(m[1]);
  var out = [], dup = {};
  raws.forEach(function (r) {
    r = _raDecode(r).trim();
    if (!/^(?:https?:)?\/\//i.test(r) && r.charAt(0) !== '/') return;
    if (/\.(?:css|js|png|jpe?g|gif|svg|ico|woff2?)(?:[?#]|$)/i.test(r)) return;
    var n = _raSbUrl(r, target);
    if (!n || n === target || ctx.seen[n] || dup[n]) return;
    dup[n] = 1; out.push(n);
  });
  return out;
}
function _raResolve(url, depth, ctx, ref) {
  var t = _raSbUrl(url); depth = depth || 0;
  if (!t) return Promise.reject(new Error('bad player URL'));
  if (depth > 4 || ctx.seen[t] || ctx.fetches >= 10) return Promise.reject(new Error('loop/limit'));
  ctx.seen[t] = 1; ctx.fetches++;
  return _fetchText(t, { headers: { 'User-Agent': UA, 'Referer': ref || RA_SITE + '/' } }).then(function (h) {
    var src = _raSources(h);
    if (src.length) return { parsed: { sources: src }, url: t };
    var cs = _raFollow(h, t, ctx), i = 0, le = null;
    function next() {
      if (i >= cs.length) return Promise.reject(le || new Error('no stream'));
      var c = cs[i++];
      return _raResolve(c, depth + 1, ctx, t).catch(function (e) { le = e; return next(); });
    }
    return next();
  });
}
function _raFirst(urls, errs, ref) {
  var i = 0;
  function next() {
    if (i >= urls.length) return Promise.resolve(null);
    var u = urls[i++];
    return _raResolve(u, 0, { seen: {}, fetches: 0 }, ref).then(null, function (e) { errs.push(e && e.message || String(e)); return next(); });
  }
  return next();
}
function _raFix(u, b) {
  u = _raDecode(String(u || '')).replace(/\\u0026/g, '&').replace(/\\\//g, '/').trim();
  if (/^\/\//.test(u)) return 'https:' + u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.charAt(0) === '/' && b) return _origin(b) + u;
  return '';
}
function _raToSources(r, lang) {
  var out = [];
  r.parsed.sources.forEach(function (s) {
    var u = _raFix(s.stream_url, r.url); if (!u) return;
    out.push({ url: u, quality: /2160p|4k/i.test(u + s.name) ? '2160p' : (/1080p/i.test(u + s.name) ? '1080p' : (/720p/i.test(u + s.name) ? '720p' : 'auto')), label: lang + ' · ' + s.name, container: /\.m3u8(?:[?#]|$)/i.test(u) ? 'hls' : 'mp4', headers: { 'User-Agent': UA, 'Referer': r.url, 'Origin': _origin(r.url) } });
  });
  return out;
}
function _raVideoSources(epUrl) {
  var raw = String(epUrl).replace('rare://', ''), p;
  try { p = JSON.parse(decodeURIComponent(raw)); } catch (e) { return Promise.resolve([]); }
  var vs = p.variants || []; if (!vs.length) return Promise.resolve([]);
  var errs = [];
  return Promise.all(vs.map(function (v) { return _raFirst([v.url].concat(v.alts || []), errs).then(function (r) { return r ? _raToSources(r, v.lang || 'Auto') : []; }); })).then(function (g) {
    var o = []; g.forEach(function (x) { o = o.concat(x); });
    if (!o.length) throw new Error('RareAnimes: no sources');
    return o;
  });
}
async function getRareanimes(title, season, episode, subCb) {
  try {
    var q = _trim(title); if (!q) return [];
    var sh = await _fetchText(RA_SITE + '/?s=' + encodeURIComponent(q).replace(/%20/g, '+'), { headers: { 'User-Agent': UA, 'Referer': RA_SITE + '/' } });
    var rs = _raListing(sh);
    var best = _pickBest(q, rs); if (!best) return [];
    var det = await _fetchText(best.url, { headers: { 'User-Agent': UA, 'Referer': RA_SITE + '/' } });
    var a = det.indexOf('<div class="entry-content'), b = a >= 0 ? det.indexOf('</article>', a) : -1;
    var content = a >= 0 ? det.slice(a, b > a ? b : undefined) : det;
    var eps = _raEpisodes(content); if (!eps.length) return [];
    var tn = episode || 1;
    var t = eps.filter(function (e) { return e.number === tn; })[0];
    if (!t && (season === 1 || season == null)) t = eps.reduce(function (p, c) { return Math.abs(c.number - tn) < Math.abs(p.number - tn) ? c : p; }, eps[0]);
    if (!t) return [];
    var st = await _raVideoSources(t.url);
    st.forEach(function (s) { (s.subtitles || []).forEach(function (x) { if (x.url) subCb({ url: x.url, lang: x.lang || 'Sub' }); }); });
    return st;
  } catch (e) { console.log('Mewstream: RareAnimes failed: ' + (e && e.message || e)); return []; }
}

// ── Movie / TV sources ────────────────────────────────────────────────
function _mkStream(u, ref, name, quality) {
  u = _fixUrl(u, ref); if (!/^https?:\/\//i.test(u)) return [];
  var hdrs = { 'User-Agent': UA }; if (ref) hdrs['Referer'] = ref;
  var o = _origin(ref || u); if (o) hdrs['Origin'] = o;
  return [{ url: u, label: (name || 'Source') + ' · auto', quality: quality || (/2160p|4k/i.test(u) ? '2160p' : (/1080p/i.test(u) ? '1080p' : (/720p/i.test(u) ? '720p' : 'auto'))), container: /\.m3u8(\?|$)/i.test(u) ? 'hls' : 'mp4', headers: hdrs }];
}
function _jsonSourcesFromHtml(html, ref, name) {
  var out = [];
  var re = /"(?:file|src|url|stream_url|streamUrl|playlist)"\s*:\s*"((?:https?:)?\/\/[^"]+?\.(?:m3u8|mp4)[^"]*)"/gi, m;
  while ((m = re.exec(html))) out = out.concat(_mkStream(m[1].replace(/\\\//g, '/'), ref, name));
  return out;
}
async function _resolveEmbedGeneric(embedUrl, referer, depth) {
  depth = depth || 0; if (depth > 3) return [];
  var html = await _fetchText(embedUrl, { headers: { 'Referer': referer || embedUrl, 'User-Agent': UA } });
  if (!html) return [];
  var out = [];
  var direct = html.match(/https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/i);
  if (direct) out = out.concat(_mkStream(direct[0], embedUrl, 'Embed'));
  out = out.concat(_jsonSourcesFromHtml(html, embedUrl, 'Embed'));
  if (out.length) return out;
  var ifr = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (ifr) return _resolveEmbedGeneric(_fixUrl(ifr[1], embedUrl), embedUrl, depth + 1);
  return [];
}
async function getVaplayer(imdbId, season, episode, subCb) {
  if (!imdbId) return [];
  var ref = 'https://nextgencloudfabric.com/';
  var u = season == null ? VA_PLAYER + '/api.php?imdb=' + imdbId + '&type=movie' : VA_PLAYER + '/api.php?imdb=' + imdbId + '&type=tv&season=' + season + '&episode=' + episode;
  try {
    var d = await _fetchJson(u, { headers: { Referer: ref } });
    var o = [];
    if (d && d.data && d.data.stream_urls) d.data.stream_urls.forEach(function (x) { if (x) o = o.concat(_mkStream(x, ref, 'VaPlayer')); });
    if (d && d.default_subs) d.default_subs.forEach(function (s) { if (s.url) subCb({ url: _fixUrl(s.url), lang: s.lang || s.code || 'Unknown' }); });
    return o;
  } catch (e) { return []; }
}
async function getVidrock(tmdbId, season, episode, subCb) {
  if (!tmdbId) return [];
  var type = season == null ? 'movie' : 'tv';
  var q = season == null ? String(tmdbId) : tmdbId + '_' + season + '_' + episode;
  var hdrs = { Origin: VIDROCK, Referer: VIDROCK + '/' };
  try {
    var d = await _fetchJson(VIDROCK + '/api/' + type + '/' + q + '/', { headers: hdrs });
    var o = [];
    for (var k in d) { var e = d[k].url; if (e && e !== 'error' && e !== 'null') { var dec = await _vidrockDecrypt(e); if (dec) o = o.concat(_mkStream(dec, VIDROCK + '/', 'Vidrock ' + k)); } }
    return o;
  } catch (e) { return []; }
}
async function _vidrockDecrypt(p) {
  try {
    var kh = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f', kb = [];
    for (var i = 0; i + 1 < kh.length; i += 2) kb.push(parseInt(kh.substr(i, 2), 16));
    var b = p.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    var ct = _arr(_b64ToBytes(b)); if (ct.length < 28) return null;
    var nonce = ct.slice(0, 12), body = ct.slice(12, ct.length - 16);
    var ks = _keyExp(kb);
    var ctr = nonce.concat([0, 0, 0, 1]), out = [], off;
    for (off = 0; off < body.length; off += 16) {
      var n = ((ctr[12] << 24) | (ctr[13] << 16) | (ctr[14] << 8) | ctr[15]) + 1;
      ctr[12] = (n >>> 24) & 0xff; ctr[13] = (n >>> 16) & 0xff; ctr[14] = (n >>> 8) & 0xff; ctr[15] = n & 0xff;
      var stream = _aesEncBlock(ctr, ks);
      for (var j = 0; j < 16 && off + j < body.length; j++) out.push(body[off + j] ^ stream[j]);
    }
    return _bytesToStr(out);
  } catch (e) { return null; }
}
async function getVidzee(tmdbId, season, episode, subCb) {
  if (!tmdbId) return [];
  var secret = _atob('QTdrUDl4TTJRdjhMcjROejFIdDZZYzNCdzVKZjBEc1U=');
  var per = await Promise.all([0, 1, 2, 4, 5, 6, 7].map(function (sr) {
    return (async function () {
      var o = [];
      try {
        var u = season == null ? VIDZEE + '/api/server?id=' + tmdbId + '&sr=' + sr : VIDZEE + '/api/server?id=' + tmdbId + '&sr=' + sr + '&ss=' + season + '&ep=' + episode;
        var d = await _fetchJson(u); if (!d) return o;
        var gh = {}; if (d.headers) for (var h in d.headers) gh[h] = d.headers[h];
        if (d.url) for (var j = 0; j < d.url.length; j++) { var it = d.url[j]; if (it.link) { var fu = _decryptVidzee(it.link, secret); if (fu && fu.indexOf('https:') > -1) o = o.concat(_mkStream(fu, VIDZEE + '/', 'VidZee ' + (it.name || ''))); } }
        if (d.tracks) d.tracks.forEach(function (t) { if (t.url && t.lang) subCb({ url: _fixUrl(t.url), lang: t.lang }); });
      } catch (e) {}
      return o;
    })();
  }));
  var o = []; per.forEach(function (l) { o = o.concat(l); }); return o;
}
async function getVidfast(tmdbId, season, episode, subCb) {
  if (!tmdbId) return [];
  var hdrs = { 'User-Agent': UA, Referer: VIDFAST + '/' };
  try {
    var h = await _fetchText(season == null ? VIDFAST + '/movie/' + tmdbId + '/' : VIDFAST + '/tv/' + tmdbId + '/' + season + '/' + episode + '/', { headers: hdrs });
    var m = h.match(/\\"(?:en|token)\\":\\"(.*?)\\"/); if (!m) return [];
    var s1 = await _fetchJson(MULTI_DECRYPT + '/enc-vidfast?text=' + encodeURIComponent(m[1]) + '&stage=1');
    if (!s1 || !s1.result || !s1.result.stage1) return [];
    var s1t = await _fetchText(s1.result.stage1, { method: 'POST', headers: Object.assign({}, hdrs, { 'X-CSRF-Token': s1.result.token, 'X-Requested-With': 'XMLHttpRequest' }) });
    if (!s1t) return [];
    var d = await _fetchJson(MULTI_DECRYPT + '/enc-vidfast?text=' + encodeURIComponent(s1t) + '&stage=2');
    if (!d || !d.result || !d.result.servers || !d.result.stream) return [];
    var ph = Object.assign({}, hdrs, { 'X-CSRF-Token': d.result.token, 'X-Requested-With': 'XMLHttpRequest' });
    var sd = await _fetchJson(MULTI_DECRYPT + '/dec-vidfast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: await _fetchText(d.result.servers, { method: 'POST', headers: ph }) }) });
    if (!sd || !sd.result) return [];
    var per = await Promise.all(sd.result.map(function (sv) {
      return (async function () {
        if (!sv.data) return null;
        try {
          var se = await _fetchText(d.result.stream + '/' + sv.data, { method: 'POST', headers: ph });
          var sr = await _fetchJson(MULTI_DECRYPT + '/dec-vidfast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: se }) });
          if (sr.result && sr.result.url) {
            if (sr.result.tracks) sr.result.tracks.forEach(function (t) { if (t.file && t.label) subCb({ url: _fixUrl(t.file), lang: t.label }); });
            return _mkStream(sr.result.url, VIDFAST + '/', 'Vidfast ' + (sv.name || ''), sr.result.is4kAvailable ? '2160p' : '1080p')[0] || null;
          }
        } catch (e) {}
        return null;
      })();
    }));
    var o = []; per.forEach(function (x) { if (x) o.push(x); }); return o;
  } catch (e) { return []; }
}
async function getHexa(tmdbId, season, episode, subCb) {
  if (!tmdbId) return [];
  var kb = new Uint8Array(32); for (var r = 0; r < 32; r++) kb[r] = Math.floor(Math.random() * 256);
  var key = ''; for (var i = 0; i < 32; i++) { var h = kb[i].toString(16); key += (h.length === 1 ? '0' : '') + h; }
  try {
    var tk = await _fetchJson(MULTI_DECRYPT + '/enc-hexa');
    var enc = await _fetchText(season == null ? HEXA + '/api/tmdb/movie/' + tmdbId + '/images' : HEXA + '/api/tmdb/tv/' + tmdbId + '/season/' + season + '/episode/' + episode + '/images', { headers: { 'User-Agent': UA, Accept: 'text/plain', 'X-Api-Key': key, 'X-Fingerprint-Lite': 'e9136c41504646444', Referer: 'https://hexa.su/', 'X-Cap-Token': tk.result.token } });
    var dec = await _fetchJson(MULTI_DECRYPT + '/dec-hexa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: enc, key: key }) });
    if (!dec || !dec.result) return [];
    var o = []; (dec.result.sources || []).forEach(function (s) { if (s.url) o = o.concat(_mkStream(s.url, 'https://hexa.su/', 'Hexa ' + (s.server || ''))); });
    return o;
  } catch (e) { return []; }
}

// ── Orchestrator ──────────────────────────────────────────────────────
async function getVideoSources(episodeUrl, opts) {
  opts = opts || {};
  var p = _parseStreamId(episodeUrl);
  var meta = await _resolveMeta(p);
  var isAnime = meta.isAnime === true;
  var subs = [], subCb = function (s) { if (s && s.url) subs.push(s); };
  var diag = [];

  function raceFirst(sources, tag) {
    if (!sources.length) return Promise.resolve([]);
    return new Promise(function (resolve) {
      var pending = sources.length, done = false;
      function settle(result, name) {
        if (done) return;
        pending--;
        if (result && result.length) { done = true; console.log('Mewstream: ' + tag + ' hit ' + result.length + ' from ' + name); resolve(result); return; }
        if (pending === 0) { done = true; resolve([]); }
      }
      sources.forEach(function (s) {
        Promise.resolve().then(function () { return s.fn(); }).then(function (r) {
          if (!r || !r.length) diag.push(s.name + ':0');
          settle(r, s.name);
        }).catch(function (e) {
          diag.push(s.name + ':' + (e && e.message || e));
          settle([], s.name);
        });
      });
    });
  }

  var animeSrc = [];
  if (isAnime) {
    if (_bool('enableMegaplayDirect', true) && (meta.malId || meta.anilistId)) animeSrc.push({ name: 'MegaPlay-Direct', fn: function () { return getMegaplayDirect(meta.malId, meta.anilistId, p.episode, subCb); } });
    if (_bool('enableAnikoto', true) && meta.title) animeSrc.push({ name: 'AniKoto', fn: function () { return getAnikoto(meta.title, p.season, p.episode, subCb); } });
    if (_bool('enableAnizone', true) && meta.title) animeSrc.push({ name: 'AniZone', fn: function () { return getAnizone(meta.title, p.season, p.episode, subCb); } });
    if (_bool('enableAnimesalt', true) && meta.title) animeSrc.push({ name: 'AnimeSalt', fn: function () { return getAnimesalt(meta.title, p.season, p.episode, subCb); } });
    if (_bool('enableRareanimes', true) && meta.title) animeSrc.push({ name: 'RareAnimes', fn: function () { return getRareanimes(meta.title, p.season, p.episode, subCb); } });
  } else {
    diag.push('anime-sources:skipped(' + (meta.classifyReason || 'not-anime') + ')');
  }

  var movieSrc = [];
  if (_bool('enableVaplayer', true) && meta.imdbId) movieSrc.push({ name: 'VaPlayer', fn: function () { return getVaplayer(meta.imdbId, p.season, p.episode, subCb); } });
  if (_bool('enableVidrock', true) && meta.tmdbId) movieSrc.push({ name: 'Vidrock', fn: function () { return getVidrock(meta.tmdbId, p.season, p.episode, subCb); } });
  if (_bool('enableVidfast', true) && meta.tmdbId) movieSrc.push({ name: 'Vidfast', fn: function () { return getVidfast(meta.tmdbId, p.season, p.episode, subCb); } });
  if (_bool('enableHexa', true) && meta.tmdbId) movieSrc.push({ name: 'Hexa', fn: function () { return getHexa(meta.tmdbId, p.season, p.episode, subCb); } });
  if (_bool('enableVidzee', true) && meta.tmdbId) movieSrc.push({ name: 'Vidzee', fn: function () { return getVidzee(meta.tmdbId, p.season, p.episode, subCb); } });

  var out = [];
  if (isAnime && animeSrc.length) out = await raceFirst(animeSrc, 'anime');
  if (!out.length && movieSrc.length) out = await raceFirst(movieSrc, 'movie');

  var seen = {}, deduped = [];
  out.forEach(function (s) { if (s && s.url && !seen[s.url]) { seen[s.url] = 1; deduped.push(s); } });

  if (typeof opts.onSubtitle === 'function') {
    var ss = {};
    subs.forEach(function (s) { if (!ss[s.url]) { ss[s.url] = 1; opts.onSubtitle(s); } });
  }

  if (!deduped.length) console.log('Mewstream: 0 streams | anime=' + isAnime + ' | ' + diag.join(' | '));
  else console.log('Mewstream DONE: ' + deduped.length + ' streams | ' + (meta.title || '?') + ' | anime=' + isAnime);
  return deduped;
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

// ── Exports ───────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION,
    getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _parseStreamId: _parseStreamId,
    _debug: {
      getMegaplayDirect: getMegaplayDirect, getAnikoto: getAnikoto, getAnizone: getAnizone,
      getAnimesalt: getAnimesalt, getRareanimes: getRareanimes,
      getVaplayer: getVaplayer, getVidrock: getVidrock, getVidzee: getVidzee,
      getVidfast: getVidfast, getHexa: getHexa,
      classify: _classify, sim: _sim, titleOk: _titleOk
    }
  };
}
