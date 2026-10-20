// mewstream.js — Mewstream multi-source provider for Zangetsu v4.0.0
// 16 sources: AniKoto, MegaPlay-Direct, AniZone, AnimeSalt, RareAnimes,
// Showbox, VaPlayer, Vidrock, Vidzee, Vidfast, Hexa, VidSrc,
// VidCore, VidUp, moviesapi, VidNest.
// Fixes: anime/movie classifier, absolute-episode mapping, no episode fallback,
// guarded timeout, real metadata enrichment, per-source diagnostics.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'mewstream';
var VERSION = '4.0.0';

// ── Polyfills (Zangetsu sandbox) ──────────────────────────────────────
var _BC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
var _btoa = (typeof btoa !== 'undefined') ? btoa : function (s) {
  s = String(s); var o = '';
  for (var b, c, i = 0, m = _BC; s.charAt(i | 0) || (m = '=', i % 1); o += m.charAt(63 & b >> 8 - i % 1 * 8)) {
    c = s.charCodeAt(i += 3 / 4);
    if (c > 0xFF) throw new Error('btoa');
    b = b << 8 | c;
  }
  return o;
};
var _atob = (typeof atob !== 'undefined') ? atob : function (s) {
  s = String(s).replace(/=+$/, '');
  if (s.length % 4 == 1) throw new Error('atob');
  for (var bc = 0, bs, b, i = 0, o = ''; b = s.charAt(i++); ~b && (bs = bc % 4 ? bs * 64 + b : b, bc++ % 4) ? o += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) b = _BC.indexOf(b);
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
var KITSU = 'https://anime-kitsu.strem.fun';
var HAG = 'https://arm.haglund.dev/api/v2';
var TMDB = 'https://api.themoviedb.org/3';
var TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
var TMDB_IMG = 'https://image.tmdb.org/t/p';
var MULTI = 'https://enc-dec.app/api';
var ANIKOTO = 'https://anikototv.to';
var ANIKOTO_MAP = 'https://mapper.nekostream.site/api/mal/';
var MP = ['https://megaplays.se', 'https://megaplay.buzz'];
var AZ = 'https://anizone.to';
var AS = 'https://animesalt.to';
var RA = 'https://www.rareanimes.mov';
var SB = 'https://showbox.media';
var FB = 'https://www.febbox.com';
var VAP = 'https://streamdata.vaplayer.ru';
var VROCK = 'https://vidrock.to';
var VZEE = 'https://player.vidzee.wtf';
var VFAST = 'https://vidfast.vc';
var HEXA = 'https://theemoviedb.hexa.su';
var VSRC = ['https://vidsrc.to', 'https://vidsrc.cc/v2'];
var VCORE = 'https://vidcore.org';
var VUP = 'https://vidup.to';
var MAPI = 'https://moviesapi.to';
var VNEST = 'https://vidnest.fun';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var RAF = /(^|\.)(codedew\.com|hubcloud\.[a-z]+|dlbeta\.[a-z]+|streambeta\.[a-z]+)$/i;
var RRP = /streambeta|zipper|multiquality|hubcloud|dlbeta|filepress/i;
var RRL = /watch\s*now|stream|play|hubcloud|multiquality|download/i;

// ── Info / Settings ────────────────────────────────────────────────────
function getInfo() {
  return { name: 'Mewstream', lang: 'en', baseUrl: 'https://www.themoviedb.org',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io', type: 'movie', version: VERSION };
}
function getSettings() {
  return [
    { key: 'tmdbApiKey', label: 'TMDB API key (optional)', type: 'text', default: '' },
    { key: 'showboxToken', label: 'Showbox (Febbox) UI token', type: 'text', default: '' },
    { key: 'enableMegaplayDirect', label: 'MegaPlay (MAL/AniList direct)', type: 'bool', default: true },
    { key: 'enableAnikoto', label: 'AniKoto', type: 'bool', default: true },
    { key: 'enableAnizone', label: 'AniZone', type: 'bool', default: true },
    { key: 'enableAnimesalt', label: 'AnimeSalt', type: 'bool', default: true },
    { key: 'enableRareanimes', label: 'RareAnimes', type: 'bool', default: true },
    { key: 'enableShowbox', label: 'Showbox', type: 'bool', default: true },
    { key: 'enableVaplayer', label: 'VaPlayer', type: 'bool', default: true },
    { key: 'enableVidrock', label: 'Vidrock', type: 'bool', default: true },
    { key: 'enableVidzee', label: 'Vidzee', type: 'bool', default: true },
    { key: 'enableVidfast', label: 'Vidfast', type: 'bool', default: true },
    { key: 'enableHexa', label: 'Hexa', type: 'bool', default: true },
    { key: 'enableVidsrc', label: 'VidSrc', type: 'bool', default: true },
    { key: 'enableVidcore', label: 'VidCore / VidUp', type: 'bool', default: true },
    { key: 'enableMoviesapi', label: 'moviesapi.to', type: 'bool', default: true },
    { key: 'enableVidnest', label: 'VidNest', type: 'bool', default: true }
  ];
}

// ── Helpers ────────────────────────────────────────────────────────────
function _rs(k) {
  try {
    if (typeof __settings === 'undefined' || !__settings) return null;
    if (__settings[SOURCE_ID] && __settings[SOURCE_ID][k] != null) return __settings[SOURCE_ID][k];
    if (__settings[k] != null) return __settings[k];
  } catch (e) {}
  return null;
}
function _bool(k, d) {
  var v = _rs(k);
  if (v == null || v === '') return d;
  return String(v).toLowerCase() === 'true' || v === true;
}
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _txt(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}
function _abs(u, b) {
  u = String(u || '').trim();
  if (/^https?:\/\//.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (b && u.charAt(0) === '/') { var d = b.split('/'); return d[0] + '//' + d[2] + u; }
  if (b) return b.replace(/\/+$/, '') + '/' + u;
  return 'https://' + u;
}
function _org(u) { return (String(u).match(/^(https?:\/\/[^\/?#]+)/i) || [])[1] || ''; }
function _hst(u) { return ((String(u).match(/^https?:\/\/([^\/:?#]+)/i) || [])[1] || '').toLowerCase(); }
function _slg(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function _yr(r) { return String(r.release_date || r.first_air_date || r.releaseInfo || r.year || '').slice(0, 4) || null; }

async function _ft(u, o) {
  o = o || {};
  var h = Object.assign({ 'User-Agent': UA }, o.headers || {});
  try {
    var q = { method: o.method || 'GET', headers: h };
    if (o.body != null) q.body = o.body;
    var r = await fetch(u, q);
    if (!r) return '';
    var t = r.body;
    return typeof t !== 'string' ? JSON.stringify(t) : t;
  } catch (e) { return ''; }
}
async function _fj(u, o) {
  var t = await _ft(u, o);
  try { return JSON.parse(t); } catch (e) { return null; }
}

// Guarded timeout — never throws if setTimeout is missing
function _withTimeout(p, ms, fb, label) {
  if (typeof setTimeout !== 'function') {
    return Promise.resolve(p).catch(function () { return fb || []; });
  }
  var done = false;
  return Promise.race([
    Promise.resolve(p).then(function (v) { done = true; return v; },
      function (e) { done = true; throw e; }),
    new Promise(function (res) {
      setTimeout(function () {
        if (!done) { if (label) console.log('Mewstream: ' + label + ' timed out'); res(fb || []); }
      }, ms);
    })
  ]);
}

// ── AES-CBC core ───────────────────────────────────────────────────────
function _ar(x) { var a = []; for (var i = 0; i < x.length; i++) a.push(x[i] & 0xff); return a; }
var _SB = [0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _ISB = [0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
function _xt(a) { a <<= 1; if (a & 0x100) a ^= 0x11b; return a & 0xff; }
function _gm(a, b) { var p = 0; for (var i = 0; i < 8; i++) { if (b & 1) p ^= a; var h = a & 0x80; a = (a << 1) & 0xff; if (h) a ^= 0x1b; b >>= 1; } return p & 0xff; }
function _ke(k) {
  var N = k.length / 4, R = N + 6, w = [], i;
  for (i = 0; i < N; i++) w.push([k[4*i], k[4*i+1], k[4*i+2], k[4*i+3]]);
  var rc = 1;
  for (i = N; i < 4 * (R + 1); i++) {
    var t = w[i-1].slice();
    if (i % N === 0) {
      t = [t[1], t[2], t[3], t[0]];
      t = [_SB[t[0]], _SB[t[1]], _SB[t[2]], _SB[t[3]]];
      t[0] ^= rc; rc = _xt(rc);
    } else if (N > 6 && i % N === 4) {
      t = [_SB[t[0]], _SB[t[1]], _SB[t[2]], _SB[t[3]]];
    }
    w.push([w[i-N][0]^t[0], w[i-N][1]^t[1], w[i-N][2]^t[2], w[i-N][3]^t[3]]);
  }
  return { w: w, R: R };
}
function _ic(b, ks) {
  var w = ks.w, R = ks.R, s = [[],[],[],[]], r, c, i;
  for (i = 0; i < 16; i++) s[i%4][(i/4)|0] = b[i];
  function ak(n) { for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) s[r][c] ^= w[n*4+c][r]; }
  function is() { for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) s[r][c] = _ISB[s[r][c]]; }
  function ih() { for (r = 1; r < 4; r++) { var q = s[r].slice(); for (c = 0; c < 4; c++) s[r][c] = q[(c-r+4)%4]; } }
  function im() {
    for (c = 0; c < 4; c++) {
      var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
      s[0][c]=_gm(a0,14)^_gm(a1,11)^_gm(a2,13)^_gm(a3,9);
      s[1][c]=_gm(a0,9)^_gm(a1,14)^_gm(a2,11)^_gm(a3,13);
      s[2][c]=_gm(a0,13)^_gm(a1,9)^_gm(a2,14)^_gm(a3,11);
      s[3][c]=_gm(a0,11)^_gm(a1,13)^_gm(a2,9)^_gm(a3,14);
    }
  }
  ak(R);
  for (var n = R-1; n >= 1; n--) { ih(); is(); ak(n); im(); }
  ih(); is(); ak(0);
  var o = []; for (i = 0; i < 16; i++) o[i] = s[i%4][(i/4)|0]; return o;
}
function _cbc(ct, k, iv) {
  var ks = _ke(k), o = [], p = iv.slice(), f, i;
  for (f = 0; f + 16 <= ct.length; f += 16) {
    var b = ct.slice(f, f + 16), d = _ic(b, ks);
    for (i = 0; i < 16; i++) o.push(d[i] ^ p[i]);
    p = b;
  }
  var pd = o[o.length-1];
  if (pd > 0 && pd <= 16) o = o.slice(0, o.length - pd);
  return o;
}
function _pb(s, n) {
  var o = [], i;
  for (i = 0; i < n; i++) o[i] = 0;
  var b = String(s || '');
  for (i = 0; i < b.length && i < n; i++) o[i] = b.charCodeAt(i) & 0xff;
  return o;
}
function _bs(b) {
  var s = '', i = 0;
  while (i < b.length) {
    var c = b[i++];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xE0) s += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else if (c < 0xF0) s += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
    else {
      var cp = ((c & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
      cp -= 0x10000;
      s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
    }
  }
  return s;
}
function _bb(s) {
  var t = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  while (t.length % 4) t += '=';
  var o = [], i, j;
  for (i = 0; i + 3 < t.length + 1; i += 4) {
    var n = 0, p = 0;
    for (j = 0; j < 4; j++) {
      var c = t.charAt(i + j), v = (c === '=') ? 0 : _BC.indexOf(c);
      if (c === '=') p++;
      n = (n << 6) | (v < 0 ? 0 : v);
    }
    o.push((n >> 16) & 255);
    if (p < 2) o.push((n >> 8) & 255);
    if (p < 1) o.push(n & 255);
  }
  return o;
}
var MK = 'i?LMTAx0Q6,:}50U', MIV = "W0;27ToaUpl_P%'c";
function _dm(enc) {
  try {
    var ct = _bb(enc);
    if (!ct.length || ct.length % 16) return null;
    var pt = _bs(_cbc(ct, _pb(MK, 32), _pb(MIV, 16)));
    var o = JSON.parse(pt);
    if (!o) return null;
    if (o.file) return o.file;
    var s = o.sources;
    return s ? (s.file || (s[0] && s[0].file)) : null;
  } catch (e) { return null; }
}
function _fs(j) {
  var s = j && j.sources, f = s ? (s.file || (s[0] && s[0].file)) : null;
  if (f) return f;
  return j && j.enc ? _dm(j.enc) : null;
}
function _dv(enc, sec) {
  try {
    var p = _atob(enc).split(':');
    if (p.length < 2) return null;
    var iv = _ar(_bb(p[0])), ct = _ar(_bb(p[1]));
    if (!ct.length) return null;
    return _bs(_cbc(ct, _pb(sec, 32), iv));
  } catch (e) { return null; }
}

// ── Classifier + title guard ──────────────────────────────────────────
function _nt(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ')
    .replace(/\b(season|part|cour|the|movie|film|sub|dub|hindi|tamil|telugu|english|dubbed|subbed|tv|series)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function _sim(a, b) {
  a = _nt(a); b = _nt(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  var A = a.split(' '), B = b.split(' '), sb = {};
  B.forEach(function (x) { sb[x] = 1; });
  var c = 0;
  A.forEach(function (x) { if (sb[x]) c++; });
  var r = c / Math.max(A.length, B.length);
  var p = (a.indexOf(b) === 0 || b.indexOf(a) === 0) ? 0.15 : 0;
  return Math.min(1, r + p);
}
function _titleOk(a, b) { return _sim(a, b) >= 0.72; }
function _best(q, l) {
  var b = null, s = 0;
  (l || []).forEach(function (x) {
    var v = _sim(q, x.title);
    if (v > s) { s = v; b = x; }
  });
  return b && s >= 0.72 ? b : null;
}
function _cls(m) {
  if (!m) return { isAnime: false, type: 'movie', score: 0, reason: 'no-meta' };
  var g = (m.genres || []).map(function (x) { return String(x).toLowerCase(); });
  var has = function (n) { return g.indexOf(n) >= 0; };
  var oc = (m.originCountry || []).map(function (x) { return String(x).toUpperCase(); });
  var ol = String(m.originalLanguage || '').toLowerCase();
  var sc = 0, wy = [];
  if (m.kitsuId) { sc += 3; wy.push('kitsu'); }
  if (m.anilistId || m.malId) { sc += 3; wy.push('anilist/mal'); }
  if (has('animation') || has('anime')) { sc += 2; wy.push('animation'); }
  if (oc.indexOf('JP') >= 0 || oc.indexOf('CN') >= 0 || oc.indexOf('KR') >= 0 || oc.indexOf('TW') >= 0) { sc += 2; wy.push('origin-asia'); }
  if (ol === 'ja' || ol === 'zh' || ol === 'ko') { sc += 2; wy.push('lang-asia'); }
  if (has('documentary') || has('news') || has('reality') || has('talk show')) { sc -= 3; wy.push('-doc'); }
  if ((oc.indexOf('US') >= 0 || oc.indexOf('GB') >= 0) && !has('animation')) { sc -= 2; wy.push('-western'); }
  var an = sc >= 3;
  return { isAnime: an, type: an ? 'anime' : (m.isSeries ? 'series' : 'movie'), score: sc, reason: wy.join(',') };
}

// ── Metadata ──────────────────────────────────────────────────────────
function _cm(m) {
  if (!m || !m.id) return null;
  var tv = m.type === 'series';
  var t = (m.aliases && m.aliases[0]) || m.name || '';
  if (!t) return null;
  var u = 'tmdb://' + (tv ? 'tv' : 'movie') + '/' + m.id;
  return { id: u, url: u, title: t, cover: m.poster || null, type: tv ? 'series' : 'movie', sourceId: SOURCE_ID };
}
function _km(m) {
  if (!m || !m.id) return null;
  var t = (m.aliases && m.aliases[0]) || m.name || '';
  if (!t) return null;
  var u = 'tmdb://anime/' + m.id.replace('kitsu:', 'kitsu-');
  return { id: u, url: u, title: t, cover: m.poster || null, type: 'anime', sourceId: SOURCE_ID };
}
async function getHome() {
  var rows = [];
  try {
    var j = await _fj(CINEMETA + '/catalog/movie/top.json');
    if (j && j.metas) {
      var it = j.metas.map(_cm).filter(Boolean);
      if (it.length) rows.push({ title: 'Top Movies', items: it });
    }
  } catch (e) {}
  try {
    var j2 = await _fj(CINEMETA + '/catalog/series/top.json');
    if (j2 && j2.metas) {
      var it2 = j2.metas.map(_cm).filter(Boolean);
      if (it2.length) rows.push({ title: 'Top Series', items: it2 });
    }
  } catch (e) {}
  try {
    var j3 = await _fj(KITSU + '/catalog/anime/kitsu-anime-trending.json');
    if (j3 && j3.metas) {
      var it3 = j3.metas.map(_km).filter(Boolean);
      if (it3.length) rows.push({ title: 'Trending Anime', items: it3 });
    }
  } catch (e) {}
  return rows;
}
async function popular() {
  var r = await getHome(), o = [];
  r.forEach(function (x) { x.items.forEach(function (i) { o.push(i); }); });
  return o;
}
async function search(q) {
  q = _trim(q);
  if (!q) return [];
  var rs = await Promise.all([
    _ft(CINEMETA + '/catalog/movie/top/search=' + encodeURIComponent(q) + '.json'),
    _ft(CINEMETA + '/catalog/series/top/search=' + encodeURIComponent(q) + '.json'),
    _ft(KITSU + '/catalog/anime/kitsu-anime-trending/search=' + encodeURIComponent(q) + '.json')
  ]);
  var o = [];
  function add(raw, k) {
    if (!raw) return;
    try {
      var j = JSON.parse(raw);
      if (!j.metas) return;
      j.metas.forEach(function (m) {
        var it = k ? _km(m) : _cm(m);
        if (it) o.push(it);
      });
    } catch (e) {}
  }
  add(rs[0], false);
  add(rs[1], false);
  add(rs[2], true);
  return o;
}

// ── Detail + episode mapping ─────────────────────────────────────────
function _pd(v) {
  var s = String(v || '');
  var m = s.match(/^tmdb:\/\/anime\/kitsu-(\d+)/i);
  if (m) return { kind: 'kitsu', id: m[1] };
  m = s.match(/^tmdb:\/\/(movie|tv|series)\/([^\/?#]+)/i);
  if (m) {
    var k = m[1].toLowerCase() === 'movie' ? 'movie' : 'tv';
    var id = decodeURIComponent(m[2]);
    if (/^tt\d+$/.test(id)) return { kind: k === 'movie' ? 'movie' : 'series', id: id };
    if (/^\d+$/.test(id)) return { kind: 'tmdb', type: k, id: id };
  }
  return null;
}
function _eu(o) {
  return JSON.stringify({
    imdbId: o.imdb || undefined,
    tmdbId: o.tmdb || undefined,
    kitsuId: o.kitsu || undefined,
    anilistId: o.anilist || undefined,
    malId: o.mal || undefined,
    season: o.season || 0,
    episode: o.episode || 0,
    absolute: o.absolute || undefined,
    title: o.title || undefined,
    year: o.year || undefined,
    isAnime: o.isAnime === true
  });
}
async function _enrichTmdb(tmdbId, kind) {
  if (!tmdbId) return null;
  var k = _rs('tmdbApiKey') || TMDB_KEY;
  var j = await _fj(TMDB + '/' + kind + '/' + tmdbId + '?api_key=' + k);
  if (!j || j.status_code) return null;
  return {
    genres: (j.genres || []).map(function (x) { return x.name; }),
    originCountry: j.origin_country || [],
    originalLanguage: j.original_language || '',
    isSeries: !!j.first_air_date
  };
}
async function getDetail(url) {
  var p = _pd(url);
  if (!p) return null;

  if (p.kind === 'kitsu') {
    var r = await _ft(KITSU + '/meta/series/kitsu%3A' + p.id + '.json');
    if (!r) return null;
    var m; try { m = JSON.parse(r).meta; } catch (e) { return null; }
    if (!m) return null;
    var hg = {};
    try { hg = JSON.parse(await _ft(HAG + '/ids?source=kitsu&id=' + p.id)) || {}; } catch (e) {}
    var im = hg.imdb || null, tm = hg.themoviedb || null, an = hg.anilist || null, ma = hg.myanimelist || null;
    var t = (m.aliases && m.aliases[0]) || m.name || 'Untitled';
    var base = { imdb: im, tmdb: tm, kitsu: p.id, anilist: an, mal: ma, title: t, year: _yr(m), isAnime: true };
    var eps = (m.videos || []).map(function (v) {
      var o = Object.assign({}, base, {
        season: v.season,
        episode: v.episode,
        absolute: v.episode   // Kitsu episodes are absolute
      });
      return {
        id: v.season + 'x' + v.episode,
        title: 'S' + String(v.season).padStart(2, '0') + 'E' + String(v.episode).padStart(2, '0') + ' - ' + (v.title || ''),
        number: v.episode,
        season: v.season,
        absolute: v.episode,
        url: _eu(o),
        thumbnail: v.thumbnail || null
      };
    });
    return {
      id: url, url: url, title: t, cover: m.poster || null, banner: m.background || null,
      description: m.description || '', type: 'anime', isAnime: true, isSeries: true,
      genres: m.genres || [], originCountry: ['JP'], originalLanguage: 'ja',
      sourceId: SOURCE_ID, year: _yr(m), imdbId: im, tmdbId: tm,
      kitsuId: p.id, anilistId: an, malId: ma, episodes: eps
    };
  }

  if (p.kind === 'movie' || p.kind === 'series') {
    var r2 = await _ft(CINEMETA + '/meta/' + (p.kind === 'series' ? 'series' : 'movie') + '/' + p.id + '.json');
    if (!r2) {
      var k0 = _rs('tmdbApiKey') || TMDB_KEY;
      var f = await _fj(TMDB + '/find/' + p.id + '?api_key=' + k0 + '&external_source=imdb_id');
      if (f) {
        if (p.kind === 'movie' && f.movie_results && f.movie_results.length) return getDetail('tmdb://movie/' + f.movie_results[0].id);
        if (p.kind === 'series' && f.tv_results && f.tv_results.length) return getDetail('tmdb://tv/' + f.tv_results[0].id);
      }
      return null;
    }
    var m2; try { m2 = JSON.parse(r2).meta; } catch (e) { return null; }
    if (!m2) return null;
    var tv = p.kind === 'series';
    var t2 = (m2.aliases && m2.aliases[0]) || m2.name || 'Untitled';
    var im2 = m2.imdb_id || p.id;
    var tm2 = m2.moviedb_id || null;

    var en = null;
    if (tm2) en = await _enrichTmdb(tm2, tv ? 'tv' : 'movie');

    var ge = en ? en.genres : (m2.genre || m2.genres || []);
    var cls = _cls({
      genres: ge,
      originCountry: en ? en.originCountry : [],
      originalLanguage: en ? en.originalLanguage : '',
      isSeries: tv
    });

    var base2 = {
      imdb: im2, tmdb: tm2, title: t2, year: _yr(m2), isAnime: cls.isAnime
    };

    var eps2 = [];
    if (tv) {
      var vids = (m2.videos || []).filter(function (v) { return v.season !== 0; })
        .sort(function (a, b) { return (a.season - b.season) || (a.episode - b.episode); });

      // Compute absolute episode across seasons for anime
      var seasonOffsets = {};
      var running = 0;
      var seasons = {};
      vids.forEach(function (v) {
        if (!seasons[v.season]) { seasons[v.season] = []; seasonOffsets[v.season] = running; }
        seasons[v.season].push(v);
      });
      Object.keys(seasons).sort(function (a, b) { return a - b; }).forEach(function (sn) {
        seasonOffsets[sn] = running;
        running += seasons[sn].length;
      });

      eps2 = vids.map(function (v) {
        var abs = (seasonOffsets[v.season] || 0) + v.episode;
        var o = Object.assign({}, base2, {
          season: v.season,
          episode: v.episode,
          absolute: abs
        });
        return {
          id: v.season + 'x' + v.episode,
          title: 'S' + String(v.season).padStart(2, '0') + 'E' + String(v.episode).padStart(2, '0') + ' - ' + (v.name || ''),
          number: v.episode,
          season: v.season,
          absolute: abs,
          url: _eu(o),
          thumbnail: v.thumbnail || null
        };
      });
    } else {
      eps2 = [{
        id: 'movie',
        title: t2,
        number: 1,
        url: _eu(Object.assign({}, base2, { season: 0, episode: 0 }))
      }];
    }

    return {
      id: url, url: url, title: t2, cover: m2.poster || null, banner: m2.background || null,
      description: m2.description || '', type: cls.type, isAnime: cls.isAnime, isSeries: tv,
      genres: ge,
      originCountry: en ? en.originCountry : [],
      originalLanguage: en ? en.originalLanguage : '',
      classifyReason: cls.reason,
      sourceId: SOURCE_ID, year: _yr(m2),
      imdbId: im2, tmdbId: tm2, episodes: eps2
    };
  }

  if (p.kind === 'tmdb') {
    var k2 = _rs('tmdbApiKey') || TMDB_KEY;
    var inf = await _fj(TMDB + '/' + p.type + '/' + p.id + '?api_key=' + k2 + '&append_to_response=external_ids');
    if (!inf || inf.status_code) return null;
    var tv3 = p.type === 'tv';
    var t3 = inf.title || inf.name || 'Untitled';
    var im3 = inf.external_ids ? inf.external_ids.imdb_id : null;
    var ge3 = (inf.genres || []).map(function (g) { return g.name; });
    var cls3 = _cls({
      genres: ge3,
      originCountry: inf.origin_country || [],
      originalLanguage: inf.original_language || '',
      isSeries: tv3
    });
    var base3 = {
      imdb: im3, tmdb: p.id, title: t3,
      year: (inf.release_date || inf.first_air_date || '').slice(0, 4),
      isAnime: cls3.isAnime
    };

    var eps3 = [];
    if (tv3 && inf.seasons) {
      var offset = 0;
      var sorted = inf.seasons.filter(function (s) { return s.season_number !== 0; })
        .sort(function (a, b) { return a.season_number - b.season_number; });
      for (var si = 0; si < sorted.length; si++) {
        var s = sorted[si];
        var ed = await _fj(TMDB + '/tv/' + p.id + '/season/' + s.season_number + '?api_key=' + k2);
        if (ed && ed.episodes) {
          for (var ei = 0; ei < ed.episodes.length; ei++) {
            var ep = ed.episodes[ei];
            var abs = offset + ep.episode_number;
            var o = Object.assign({}, base3, {
              season: ep.season_number,
              episode: ep.episode_number,
              absolute: abs
            });
            eps3.push({
              id: ep.season_number + 'x' + ep.episode_number,
              title: 'S' + String(ep.season_number).padStart(2, '0') + 'E' + String(ep.episode_number).padStart(2, '0') + ' - ' + (ep.name || ''),
              number: ep.episode_number,
              season: ep.season_number,
              absolute: abs,
              url: _eu(o),
              thumbnail: ep.still_path ? TMDB_IMG + '/w300' + ep.still_path : null
            });
          }
          offset += ed.episodes.length;
        }
      }
    } else if (!tv3) {
      eps3 = [{
        id: 'movie', title: t3, number: 1,
        url: _eu(Object.assign({}, base3, { season: 0, episode: 0 }))
      }];
    }

    return {
      id: url, url: url, title: t3,
      cover: inf.poster_path ? TMDB_IMG + '/w500' + inf.poster_path : null,
      banner: inf.backdrop_path ? TMDB_IMG + '/w780' + inf.backdrop_path : null,
      description: inf.overview || '',
      type: cls3.type, isAnime: cls3.isAnime, isSeries: tv3,
      genres: ge3,
      originCountry: inf.origin_country || [],
      originalLanguage: inf.original_language || '',
      classifyReason: cls3.reason,
      sourceId: SOURCE_ID,
      year: (inf.release_date || inf.first_air_date || '').slice(0, 4) || null,
      imdbId: im3, tmdbId: p.id, episodes: eps3
    };
  }
  return null;
}
function getEpisodes(url) {
  return getDetail(url).then(function (d) { return d ? d.episodes : []; });
}
function _sid(raw) {
  var o = raw && typeof raw === 'object' ? raw : null;
  if (!o) {
    try { o = JSON.parse(String(raw || '{}')); } catch (e) { o = {}; }
  }
  var se = parseInt(o.season, 10);
  if (isNaN(se) || se <= 0) se = null;
  return {
    season: se,
    episode: parseInt(o.episode, 10) || 0,
    absolute: parseInt(o.absolute, 10) || null,
    imdbId: o.imdbId || null,
    tmdbId: o.tmdbId || null,
    kitsuId: o.kitsuId || null,
    anilistId: o.anilistId || null,
    malId: o.malId || null,
    title: o.title || null,
    year: o.year || null,
    isAnime: o.isAnime === true
  };
}
async function _resolveMeta(p) {
  var m = {
    title: p.title || null, year: p.year || null,
    imdbId: p.imdbId, tmdbId: p.tmdbId,
    malId: p.malId, anilistId: p.anilistId, kitsuId: p.kitsuId,
    isAnime: p.isAnime === true,
    genres: [], originCountry: [], originalLanguage: ''
  };

  if (!m.isAnime && (m.imdbId || m.tmdbId)) {
    try {
      var d = await _fj(CINEMETA + '/meta/' + (p.season ? 'series' : 'movie') + '/' + (m.imdbId || m.tmdbId) + '.json');
      if (d && d.meta) {
        m.title = m.title || d.meta.name || (d.meta.aliases && d.meta.aliases[0]);
        m.year = m.year || parseInt(d.meta.releaseInfo || d.meta.year);
        if (!m.tmdbId && d.meta.moviedb_id) m.tmdbId = d.meta.moviedb_id;
        m.genres = d.meta.genre || d.meta.genres || [];
      }
    } catch (e) {}

    if (m.tmdbId) {
      var en = await _enrichTmdb(m.tmdbId, p.season ? 'tv' : 'movie');
      if (en) {
        m.genres = en.genres;
        m.originCountry = en.originCountry;
        m.originalLanguage = en.originalLanguage;
      }
    }
  }

  var cl = _cls({
    genres: m.genres,
    originCountry: m.originCountry,
    originalLanguage: m.originalLanguage,
    kitsuId: m.kitsuId,
    anilistId: m.anilistId,
    malId: m.malId,
    isSeries: !!p.season
  });
  m.isAnime = m.isAnime || cl.isAnime;
  m.classifyReason = cl.reason;
  return m;
}

// ── Anime sources (exact episode match, no fallback) ──────────────────
function _ps(html) {
  var src = String(html || ''), out = [], seen = {}, tr = /<\/?([a-z][a-z0-9:-]*)\b([^>]*)>/gi, st = [], m;
  function at(a, n) {
    var re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, x;
    while ((x = re.exec(a || ''))) if (x[1].toLowerCase() === n.toLowerCase()) return x[2] !== undefined ? x[2] : x[3];
    return '';
  }
  function vi(r) {
    return String(r || '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  }
  while ((m = tr.exec(src))) {
    var f = m[0], tg = m[1].toLowerCase(), a = m[2] || '';
    if (f.charAt(1) === '/') {
      for (var i = st.length - 1; i >= 0; i--) if (st[i].tag === tg) { st.length = i; break; }
      continue;
    }
    if (tg === 'li') {
      var cr = /<\/li\s*>/ig; cr.lastIndex = tr.lastIndex;
      var cl = cr.exec(src);
      var inn = cl ? src.slice(tr.lastIndex, cl.index) : '';
      var id = at(a, 'data-link-id') || at(inn, 'data-link-id');
      if (id && !/download-icon/i.test(a + ' ' + inn)) {
        var ty = at(a, 'data-type');
        if (!ty) for (var j = st.length - 1; j >= 0; j--) {
          ty = at(st[j].attrs, 'data-type') || at(st[j].attrs, 'type');
          if (ty) break;
        }
        if (!ty) {
          var b4 = src.slice(0, m.index), tx = /(?:data-type|type)\s*=\s*["'](sub|hsub|dub)["']/gi, tm, la = '';
          while ((tm = tx.exec(b4))) la = tm[1];
          ty = la || 'sub';
        }
        ty = String(ty).toLowerCase();
        if (ty !== 'sub' && ty !== 'hsub' && ty !== 'dub') ty = /dub/i.test(ty) ? 'dub' : 'sub';
        var nm = vi(inn), k = ty + '|' + id + '|' + nm;
        if (!seen[k]) { seen[k] = 1; out.push({ type: ty, linkId: id, name: nm || ('S' + id) }); }
      }
    }
    if (!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tg) && !/\/\s*>$/.test(f)) st.push({ tag: tg, attrs: a });
  }
  return out;
}
function _su(base, id, type) {
  var p = /(?:megaplay|megaplays|vidwish|vidtube)\.[a-z]+/i.test(String(base || '')) ? '/stream/getSourcesNew' : '/stream/getSources';
  return base + p + '?id=' + id + '&type=' + type;
}
function _ep(embed, cat, name) {
  var base = (embed.match(/^(https?:\/\/[^/]+)/) || [])[1] || MP[0];
  var type = (embed.match(/\/(sub|hsub|dub)\/?(?:[?#]|$)/i) || [])[1] || cat;
  return _ft(embed, { headers: { Referer: ANIKOTO + '/' } }).then(function (h) {
    var id = (h.match(/data-id=["'](\d+)["']/i) || [])[1];
    if (!id) throw new Error('no embed id');
    var tries = [_su(base, id, type), base + '/stream/getSources?id=' + id + '&type=' + type];
    function nx(i) {
      if (i >= tries.length) return Promise.reject(new Error('no getSources'));
      return fetch(tries[i], { headers: { 'User-Agent': UA, Referer: embed, 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) {
          var b = (r && r.body) || '';
          var j; try { j = JSON.parse(b); } catch (e) { return nx(i + 1); }
          var file = _fs(j);
          if (!file) return nx(i + 1);
          var subs = [];
          ((j && j.tracks) || []).forEach(function (t) {
            if (t && t.file && (!t.kind || t.kind === 'captions' || t.kind === 'subtitles'))
              subs.push({ url: t.file, lang: t.label || 'Sub', format: /\.srt(\?|$)/i.test(t.file) ? 'srt' : 'vtt' });
          });
          return [{
            url: file + '#mew-' + _slg(name || 'server') + '-' + cat,
            label: (name || 'AniKoto') + ' · ' + cat, quality: 'auto',
            container: /\.m3u8(\?|$)/i.test(file) ? 'hls' : 'mp4',
            headers: { 'User-Agent': UA, Referer: base + '/', Origin: base },
            kind: cat, audioLang: cat === 'dub' ? 'en' : 'ja', subtitles: subs
          }];
        })
        .catch(function () { return nx(i + 1); });
    }
    return nx(0);
  });
}
function _mp1(base, kind, id, ep, lang) {
  var emb = base + '/stream/' + kind + '/' + id + '/' + ep + '/' + lang;
  return _ft(emb, { headers: { Referer: base + '/' } }).then(function (h) {
    if (!h) throw new Error('empty');
    var did = (h.match(/data-id=["'](\d+)["']/i) || [])[1];
    if (!did) throw new Error('no id');
    var us = [base + '/stream/getSourcesNew?id=' + did + '&type=' + lang, base + '/stream/getSources?id=' + did + '&type=' + lang];
    function t1(i) {
      if (i >= us.length) return Promise.reject(new Error('no src'));
      return fetch(us[i], { headers: { 'User-Agent': UA, Referer: emb, 'X-Requested-With': 'XMLHttpRequest' } })
        .then(function (r) {
          var b = (r && r.body) || '';
          var j; try { j = JSON.parse(b); } catch (e) { return t1(i + 1); }
          var f = _fs(j);
          if (!f) return t1(i + 1);
          var sb = [];
          ((j && j.tracks) || []).forEach(function (t) {
            if (t && t.file && (!t.kind || t.kind === 'captions' || t.kind === 'subtitles'))
              sb.push({ url: t.file, lang: t.label || 'Sub', format: /\.srt(\?|$)/i.test(t.file) ? 'srt' : 'vtt' });
          });
          return [{
            url: f + '#mew-mpd-' + lang,
            label: 'MegaPlay · ' + lang, quality: 'auto',
            container: /\.m3u8(\?|$)/i.test(f) ? 'hls' : 'mp4',
            headers: { 'User-Agent': UA, Referer: base + '/', Origin: base },
            kind: lang, audioLang: lang === 'dub' ? 'en' : 'ja', subtitles: sb
          }];
        })
        .catch(function () { return t1(i + 1); });
    }
    return t1(0);
  });
}
async function getMegaplayDirect(mal, ani, ep, cb) {
  var kind = mal ? 'mal' : (ani ? 'ani' : null);
  var id = mal || ani;
  if (!kind || !id) return [];
  ep = ep || 1;
  var o = [];
  var ls = ['sub', 'dub'];
  for (var li = 0; li < ls.length; li++) {
    for (var bi = 0; bi < MP.length; bi++) {
      try {
        var r = await _mp1(MP[bi], kind, id, ep, ls[li]);
        if (r && r.length) {
          o = o.concat(r);
          (r[0].subtitles || []).forEach(function (s) { if (s.url) cb({ url: s.url, lang: s.lang || 'Sub' }); });
          break;
        }
      } catch (e) {}
    }
  }
  return o;
}
function _ag(u, r, x) {
  var h = { 'User-Agent': UA, Referer: r || ANIKOTO + '/' };
  if (x) h['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(u, { headers: h }).then(function (res) { return (res && res.body) || ''; }).catch(function () { return ''; });
}
function _aj(p) {
  return _ag(ANIKOTO + p, ANIKOTO + '/', true).then(function (b) {
    try { return JSON.parse(b || 'null'); } catch (e) { return null; }
  }).catch(function () { return null; });
}
async function _asr(title) {
  var q = _trim(title);
  if (!q) return null;
  var h = await _ag(ANIKOTO + '/filter?keyword=' + encodeURIComponent(q), ANIKOTO + '/');
  var re = /<a\b[^>]*href="([^"]*\/watch\/([^"\/?#]+))"[^>]*>([\s\S]{0,400}?)<\/a>/gi, m, hits = [];
  while ((m = re.exec(h))) {
    var t = _txt(m[3]);
    if (t) hits.push({ slug: m[2], title: t });
  }
  if (!hits.length) {
    var m2 = h.match(/href="([^"]*\/watch\/([^"\/?#]+))"/);
    if (m2) hits.push({ slug: m2[2], title: q });
  }
  var b = _best(q, hits);
  if (!b) {
    console.log('Mewstream: AniKoto title guard rejected "' + q + '"');
    return null;
  }
  return b.slug;
}
async function _aep(slug) {
  var h = await _ag(ANIKOTO + '/watch/' + encodeURIComponent(slug), ANIKOTO + '/');
  var id = (h.match(/data-id="(\d+)"/) || [])[1];
  if (!id) return [];
  var j = await _aj('/ajax/episode/list/' + id);
  var lh = j && typeof j.result === 'string' ? j.result : '';
  var eps = [], re = /<a\b([^>]*\bdata-id="\d+"[^>]*)>/g, m;
  while ((m = re.exec(lh))) {
    var a = m[1], si = (a.match(/data-ids="([^"]+)"/) || [])[1];
    if (!si) continue;
    var nu = parseInt((a.match(/data-num="(\d+)"/) || [])[1] || '0', 10);
    var sbb = (a.match(/data-sub="(\d+)"/) || [])[1] === '1';
    var db = (a.match(/data-dub="(\d+)"/) || [])[1] === '1';
    if (!sbb && !db) continue;
    var em = (a.match(/data-mal="(\d+)"/) || [])[1];
    var es = (a.match(/data-slug="([^"]+)"/) || [])[1];
    var et = (a.match(/data-timestamp="(\d+)"/) || [])[1];
    var tk = (em && es && et) ? (em + '/' + encodeURIComponent(es) + '/' + et) : null;
    eps.push({
      number: nu,
      url: 'anikoto://' + (db ? 'dub' : 'sub') + '/' + encodeURIComponent(si) + '/' + (sbb ? 1 : 0) + (db ? 1 : 0) + '/' + nu + (tk ? '/' + tk : '')
    });
  }
  return eps;
}
function _ar1(sv, cat) {
  var sc = sv.type === 'dub' ? 'dub' : (sv.type === 'hsub' ? 'hsub' : 'sub');
  return _aj('/ajax/server?get=' + encodeURIComponent(sv.linkId)).then(function (j) {
    var u = j && j.result && (typeof j.result === 'object' ? j.result.url : null);
    if (!u || !/^https?:\/\//i.test(u)) return [];
    if (/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(u))
      return [{
        url: u, label: (sv.name || 'AniKoto') + ' · ' + sc, quality: 'auto',
        container: 'hls', headers: { 'User-Agent': UA, Referer: ANIKOTO + '/' }, kind: sc
      }];
    return _ep(u, sc, sv.name).catch(function () { return []; });
  }).catch(function () { return []; });
}
function _at(l, c) {
  return Promise.all((l || []).map(function (s) { return _ar1(s, c); })).then(function (g) {
    var o = []; g.forEach(function (x) { o = o.concat(x); }); return o;
  });
}
function _am(tk, c) {
  if (!tk) return Promise.resolve([]);
  return _ag(ANIKOTO_MAP + tk, ANIKOTO + '/').then(function (b) {
    var j; try { j = JSON.parse(b || 'null'); } catch (e) { j = null; }
    var ex = [];
    for (var n in (j || {})) {
      var e = j[n];
      if (n === 'status' || !e || typeof e !== 'object') continue;
      var x = e[c];
      if (x && x.url) ex.push({ type: c, linkId: String(x.url), name: n });
    }
    return _at(ex, c);
  }).catch(function () { return []; });
}
function _av(ep) {
  var raw = String(ep).replace('anikoto://', ''), p = raw.split('/');
  var c = p[0] === 'dub' ? 'dub' : 'sub';
  var si = p[1] ? decodeURIComponent(p[1]) : '';
  var tk = (p[4] && p[5] && p[6]) ? (p[4] + '/' + p[5] + '/' + p[6]) : null;
  if (!si) return Promise.reject(new Error('no ids'));
  return _aj('/ajax/server/list?servers=' + encodeURIComponent(si)).then(function (j) {
    var lh = j && typeof j.result === 'string' ? j.result : '';
    var sv = _ps(lh);
    return Promise.all([_at(sv, c), _am(tk, c)]).then(function (r) {
      var a = r[0].concat(r[1]).filter(function (s) { return s && s.url; });
      if (a.length) return a;
      throw new Error('no server');
    });
  }).catch(function (e) {
    return _am(tk, c).then(function (x) { if (x.length) return x; throw e; });
  });
}
async function getAnikoto(title, season, ep, cb) {
  try {
    var sl = await _asr(title);
    if (!sl) return [];
    var es = await _aep(sl);
    if (!es.length) return [];
    var tn = ep || 1;
    var f = es.filter(function (e) { return e.number === tn; })[0];
    if (!f) {
      console.log('Mewstream: AniKoto episode ' + tn + ' not found for "' + title + '"');
      return [];
    }
    var st = await _av(f.url);
    st.forEach(function (s) {
      (s.subtitles || []).forEach(function (x) { if (x.url) cb({ url: x.url, lang: x.lang || 'Sub' }); });
    });
    return st;
  } catch (e) {
    console.log('Mewstream: AniKoto failed: ' + (e && e.message || e));
    return [];
  }
}
async function getAnizone(title, season, ep) {
  try {
    var q = _trim(title);
    if (!q) return [];
    var sl = null;
    var cs = ['/search?query=', '/search?q=', '/filter?keyword='];
    for (var i = 0; i < cs.length && !sl; i++) {
      var h = await _ft(AZ + cs[i] + encodeURIComponent(q), { headers: { Referer: AZ + '/' } });
      if (!h) continue;
      var re = /<a\b[^>]*href="([^"]*\/anime\/([^"\/?#]+))"[^>]*>([\s\S]{0,300}?)<\/a>/gi, m, hits = [];
      while ((m = re.exec(h))) {
        var t = _txt(m[3]);
        if (t && t.length < 160) hits.push({ slug: m[2], title: t });
      }
      var b = _best(q, hits);
      if (b) sl = b.slug;
    }
    if (!sl) return [];
    var eu = AZ + '/anime/' + encodeURIComponent(sl) + '/' + (ep || 1);
    var html = await _ft(eu, { headers: { Referer: AZ + '/' } });
    if (!html) return [];
    var o = [];
    var ifr = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (ifr) {
      var r = await _re(_abs(ifr[1], eu), eu);
      if (r && r.length) o = o.concat(r);
    }
    var di = html.match(/https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/i);
    if (di) o = o.concat(_mk(di[0], eu, 'AniZone'));
    return o;
  } catch (e) {
    console.log('Mewstream: AniZone failed: ' + (e && e.message || e));
    return [];
  }
}
async function getAnimesalt(title, season, ep) {
  try {
    var sl = _slg(title);
    if (!sl) return [];
    var hd = { Referer: AS + '/', 'User-Agent': UA };
    var u = season == null ? AS + '/movies/' + sl + '/' : AS + '/episode/' + sl + '-' + season + 'x' + ep + '/';
    var h = await _ft(u, { headers: hd });
    if (!h) return [];
    var im = h.match(/src="(https:\/\/as-cdn\d+\.top\/video\/([a-f0-9]+))"/);
    if (!im) return [];
    var d = await _fj(im[1].split('/video/')[0] + '/player/index.php?data=' + im[2] + '&do=getVideo', {
      method: 'POST',
      headers: Object.assign({}, hd, { Origin: im[1].split('/video/')[0], 'X-Requested-With': 'XMLHttpRequest' }),
      body: 'hash=' + im[2] + '&r=' + encodeURIComponent(AS + '/')
    });
    if (!d) return [];
    var m8 = d.videoSource || d.securedLink;
    return m8 ? _mk(m8, AS + '/', 'AnimeSalt') : [];
  } catch (e) {
    console.log('Mewstream: AnimeSalt failed: ' + (e && e.message || e));
    return [];
  }
}
async function getRareanimes(title, season, ep, cb) {
  try {
    var q = _trim(title);
    if (!q) return [];
    var sh = await _ft(RA + '/?s=' + encodeURIComponent(q).replace(/%20/g, '+'), { headers: { 'User-Agent': UA, Referer: RA + '/' } });
    if (!sh) return [];
    var out = [], seen = {}, re = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi, m;
    while ((m = re.exec(sh))) {
      var b = m[2];
      var a = b.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/i)
        || b.match(/<a\b[^>]*title=["']([^"']+)["'][^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/i);
      var hr = '', ti = '';
      if (a) {
        if (/^https?:\/\//i.test(a[1])) { hr = a[1]; ti = a[2] || ''; }
        else { ti = a[1] || ''; hr = a[2] || ''; }
      }
      if (!ti) ti = _txt((b.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i) || [])[1] || '');
      if (!hr || !ti || seen[hr]) continue;
      seen[hr] = 1;
      out.push({
        url: hr,
        title: ti.replace(/\s*[-–|]?\s*\b(?:Hindi|Tamil|Telugu|Download|HD|Watch Online|Complete)\b[\s\S]*$/i, '').trim() || ti
      });
    }
    var bs = _best(q, out);
    if (!bs) return [];
    var det = await _ft(bs.url, { headers: { 'User-Agent': UA, Referer: RA + '/' } });
    var a1 = det.indexOf('<div class="entry-content'), b1 = a1 >= 0 ? det.indexOf('</article>', a1) : -1;
    var ct = a1 >= 0 ? det.slice(a1, b1 > a1 ? b1 : undefined) : det;
    var eps = [], cur = null, nl = 1;
    var lns = ct.replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<(?:p|h[1-6]|br|div|li|tr)\b[^>]*>/gi, '\n').split(/\n/);
    lns.forEach(function (l) {
      var t = _txt(l), hh = t.match(/^(?:episode|ep\.?)\s*0*(\d{1,4})\b/i);
      if (hh) { cur = { n: +hh[1], links: [] }; eps.push(cur); }
      else if (cur && /watch|stream|play|hubcloud/i.test(l)) {
        var lk = (l.match(/href=["']([^"']+)["']/i) || [])[1];
        if (lk) cur.links.push(_abs(lk, bs.url));
      }
    });
    var tn = ep || 1;
    var tg = eps.filter(function (e) { return e.n === tn; })[0];
    if (!tg || !tg.links.length) {
      console.log('Mewstream: RareAnimes episode ' + tn + ' not found');
      return [];
    }
    var o = [];
    for (var i = 0; i < tg.links.length; i++) {
      try {
        var r = await _re(tg.links[i], bs.url);
        if (r && r.length) { o = o.concat(r); break; }
      } catch (e) {}
    }
    return o;
  } catch (e) {
    console.log('Mewstream: RareAnimes failed: ' + (e && e.message || e));
    return [];
  }
}

// ── Movie/TV sources ──────────────────────────────────────────────────
function _mk(u, ref, name, q) {
  u = _abs(u, ref);
  if (!/^https?:\/\//i.test(u)) return [];
  var h = { 'User-Agent': UA };
  if (ref) h.Referer = ref;
  var o = _org(ref || u);
  if (o) h.Origin = o;
  return [{
    url: u, label: (name || 'Source') + ' · auto',
    quality: q || (/2160p|4k/i.test(u) ? '2160p' : (/1080p/i.test(u) ? '1080p' : (/720p/i.test(u) ? '720p' : 'auto'))),
    container: /\.m3u8(\?|$)/i.test(u) ? 'hls' : 'mp4',
    headers: h
  }];
}
function _js(html, ref, name) {
  var o = [];
  var re = /"(?:file|src|url|stream_url|streamUrl|playlist)"\s*:\s*"((?:https?:)?\/\/[^"]+?\.(?:m3u8|mp4)[^"]*)"/gi, m;
  while ((m = re.exec(html))) o = o.concat(_mk(m[1].replace(/\\\//g, '/'), ref, name));
  return o;
}
async function _re(eu, ref, d) {
  d = d || 0;
  if (d > 3) return [];
  var h = await _ft(eu, { headers: { Referer: ref || eu, 'User-Agent': UA } });
  if (!h) return [];
  var o = [];
  var di = h.match(/https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/i);
  if (di) o = o.concat(_mk(di[0], eu, 'Embed'));
  o = o.concat(_js(h, eu, 'Embed'));
  if (o.length) return o;
  var ifr = h.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (ifr) return _re(_abs(ifr[1], eu), eu, d + 1);
  return [];
}
async function getVaplayer(imdb, season, ep, cb) {
  if (!imdb) return [];
  var ref = 'https://nextgencloudfabric.com/';
  var u = season == null ? VAP + '/api.php?imdb=' + imdb + '&type=movie' : VAP + '/api.php?imdb=' + imdb + '&type=tv&season=' + season + '&episode=' + ep;
  try {
    var d = await _fj(u, { headers: { Referer: ref } });
    var o = [];
    if (d && d.data && d.data.stream_urls) d.data.stream_urls.forEach(function (x) { if (x) o = o.concat(_mk(x, ref, 'VaPlayer')); });
    if (d && d.default_subs) d.default_subs.forEach(function (s) { if (s.url) cb({ url: _abs(s.url, ref), lang: s.lang || s.code || 'Unknown' }); });
    return o;
  } catch (e) { return []; }
}
async function getVidrock(tmdb, season, ep) {
  if (!tmdb) return [];
  var type = season == null ? 'movie' : 'tv';
  var q = season == null ? String(tmdb) : tmdb + '_' + season + '_' + ep;
  var hd = { Origin: VROCK, Referer: VROCK + '/' };
  try {
    var d = await _fj(VROCK + '/api/' + type + '/' + q + '/', { headers: hd });
    var o = [];
    for (var k in d) {
      var e = d[k].url;
      if (e && e !== 'error' && e !== 'null') {
        var dec = await _vr(e);
        if (dec) o = o.concat(_mk(dec, VROCK + '/', 'Vidrock ' + k));
      }
    }
    return o;
  } catch (e) { return []; }
}
async function _vr(p) {
  try {
    var kh = '7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f', kb = [];
    for (var i = 0; i + 1 < kh.length; i += 2) kb.push(parseInt(kh.substr(i, 2), 16));
    var b = p.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    var ct = _ar(_bb(b));
    if (ct.length < 28) return null;
    var nonce = ct.slice(0, 12), body = ct.slice(12, ct.length - 16);
    var ks = _ke(kb);
    var ctr = nonce.concat([0, 0, 0, 1]), out = [], off;
    for (off = 0; off < body.length; off += 16) {
      var n = ((ctr[12] << 24) | (ctr[13] << 16) | (ctr[14] << 8) | ctr[15]) + 1;
      ctr[12] = (n >>> 24) & 0xff; ctr[13] = (n >>> 16) & 0xff; ctr[14] = (n >>> 8) & 0xff; ctr[15] = n & 0xff;
      var stream = _enc(ctr, ks);
      for (var j = 0; j < 16 && off + j < body.length; j++) out.push(body[off + j] ^ stream[j]);
    }
    return _bs(out);
  } catch (e) { return null; }
}
function _enc(inp, ks) {
  var s = [[],[],[],[]], r, c, i;
  for (i = 0; i < 16; i++) s[i%4][(i/4)|0] = inp[i];
  function ak(n) { for (c = 0; c < 4; c++) for (r = 0; r < 4; r++) s[r][c] ^= ks.w[n*4+c][r]; }
  function sb() { for (r = 0; r < 4; r++) for (c = 0; c < 4; c++) s[r][c] = _SB[s[r][c]]; }
  function sh() { for (r = 1; r < 4; r++) { var row = s[r].slice(); for (c = 0; c < 4; c++) s[r][c] = row[(c+r)%4]; } }
  function mx() {
    for (c = 0; c < 4; c++) {
      var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
      s[0][c]=_gm(a0,2)^_gm(a1,3)^a2^a3;
      s[1][c]=a0^_gm(a1,2)^_gm(a2,3)^a3;
      s[2][c]=a0^a1^_gm(a2,2)^_gm(a3,3);
      s[3][c]=_gm(a0,3)^a1^a2^_gm(a3,2);
    }
  }
  ak(0);
  for (var n = 1; n < ks.R; n++) { sb(); sh(); mx(); ak(n); }
  sb(); sh(); ak(ks.R);
  var o = []; for (i = 0; i < 16; i++) o[i] = s[i%4][(i/4)|0]; return o;
}
async function getVidzee(tmdb, season, ep, cb) {
  if (!tmdb) return [];
  var sec = _atob('QTdrUDl4TTJRdjhMcjROejFIdDZZYzNCdzVKZjBEc1U=');
  var per = await Promise.all([0, 1, 2, 4, 5, 6, 7].map(function (sr) {
    return (async function () {
      var o = [];
      try {
        var u = season == null ? VZEE + '/api/server?id=' + tmdb + '&sr=' + sr : VZEE + '/api/server?id=' + tmdb + '&sr=' + sr + '&ss=' + season + '&ep=' + ep;
        var d = await _fj(u);
        if (!d) return o;
        var gh = {};
        if (d.headers) for (var h in d.headers) gh[h] = d.headers[h];
        if (d.url) for (var j = 0; j < d.url.length; j++) {
          var it = d.url[j];
          if (it.link) {
            var fu = _dv(it.link, sec);
            if (fu && fu.indexOf('https:') > -1) o = o.concat(_mk(fu, VZEE + '/', 'VidZee ' + (it.name || '')));
          }
        }
        if (d.tracks) d.tracks.forEach(function (t) { if (t.url && t.lang) cb({ url: _abs(t.url, VZEE + '/'), lang: t.lang }); });
      } catch (e) {}
      return o;
    })();
  }));
  var o = []; per.forEach(function (l) { o = o.concat(l); }); return o;
}
async function getVidfast(tmdb, season, ep, cb) {
  if (!tmdb) return [];
  var hd = { 'User-Agent': UA, Referer: VFAST + '/' };
  try {
    var h = await _ft(season == null ? VFAST + '/movie/' + tmdb + '/' : VFAST + '/tv/' + tmdb + '/' + season + '/' + ep + '/', { headers: hd });
    var m = h.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);
    if (!m) return [];
    var s1 = await _fj(MULTI + '/enc-vidfast?text=' + encodeURIComponent(m[1]) + '&stage=1');
    if (!s1 || !s1.result || !s1.result.stage1) return [];
    var s1t = await _ft(s1.result.stage1, { method: 'POST', headers: Object.assign({}, hd, { 'X-CSRF-Token': s1.result.token, 'X-Requested-With': 'XMLHttpRequest' }) });
    if (!s1t) return [];
    var d = await _fj(MULTI + '/enc-vidfast?text=' + encodeURIComponent(s1t) + '&stage=2');
    if (!d || !d.result || !d.result.servers || !d.result.stream) return [];
    var ph = Object.assign({}, hd, { 'X-CSRF-Token': d.result.token, 'X-Requested-With': 'XMLHttpRequest' });
    var sd = await _fj(MULTI + '/dec-vidfast', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: await _ft(d.result.servers, { method: 'POST', headers: ph }) })
    });
    if (!sd || !sd.result) return [];
    var per = await Promise.all(sd.result.map(function (sv) {
      return (async function () {
        if (!sv.data) return null;
        try {
          var se = await _ft(d.result.stream + '/' + sv.data, { method: 'POST', headers: ph });
          var sr = await _fj(MULTI + '/dec-vidfast', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: se })
          });
          if (sr.result && sr.result.url) {
            if (sr.result.tracks) sr.result.tracks.forEach(function (t) { if (t.file && t.label) cb({ url: _abs(t.file, VFAST + '/'), lang: t.label }); });
            return _mk(sr.result.url, VFAST + '/', 'Vidfast ' + (sv.name || ''), sr.result.is4kAvailable ? '2160p' : '1080p')[0] || null;
          }
        } catch (e) {}
        return null;
      })();
    }));
    var o = []; per.forEach(function (x) { if (x) o.push(x); }); return o;
  } catch (e) { return []; }
}
async function getHexa(tmdb, season, ep) {
  if (!tmdb) return [];
  var kb = [];
  for (var r = 0; r < 32; r++) kb.push(Math.floor(Math.random() * 256));
  var k = '';
  for (var i = 0; i < 32; i++) { var h = kb[i].toString(16); k += (h.length === 1 ? '0' : '') + h; }
  try {
    var tk = await _fj(MULTI + '/enc-hexa');
    var en = await _ft(season == null ? HEXA + '/api/tmdb/movie/' + tmdb + '/images' : HEXA + '/api/tmdb/tv/' + tmdb + '/season/' + season + '/episode/' + ep + '/images', {
      headers: {
        'User-Agent': UA, Accept: 'text/plain', 'X-Api-Key': k,
        'X-Fingerprint-Lite': 'e9136c41504646444',
        Referer: 'https://hexa.su/', 'X-Cap-Token': tk.result.token
      }
    });
    var de = await _fj(MULTI + '/dec-hexa', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: en, key: k })
    });
    if (!de || !de.result) return [];
    var o = [];
    (de.result.sources || []).forEach(function (s) { if (s.url) o = o.concat(_mk(s.url, 'https://hexa.su/', 'Hexa ' + (s.server || ''))); });
    return o;
  } catch (e) { return []; }
}
async function getShowbox(imdb, season, ep, cb) {
  var tk = _rs('showboxToken');
  if (!imdb || !tk) return [];
  var hd = { 'User-Agent': UA, Accept: 'application/json, text/html, */*' };
  try {
    var sh = await _ft(SB + '/search?keyword=' + imdb, { headers: hd });
    var hm = sh.match(/class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/) || sh.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/);
    if (!hm) return [];
    var dh = await _ft(_abs(hm[1], SB), { headers: hd });
    var im = dh.match(/class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/);
    if (!im) return [];
    var mid = parseInt(im[1].split('/').pop());
    if (!mid) return [];
    var type = season != null ? 2 : 1;
    var sj = await _fj(SB + '/index/share_link?id=' + mid + '&type=' + type, { headers: hd });
    if (!sj || !sj.data || !sj.data.link) return [];
    var sk = sj.data.link.split('/').pop();
    var fj = await _fj(FB + '/file/file_share_list?share_key=' + sk, { headers: hd });
    if (!fj || !fj.data || !fj.data.file_list) return [];
    var vf = null;
    if (season != null && ep != null) {
      var sf = fj.data.file_list.find(function (f) { return f.is_dir && (f.file_name || '').toLowerCase().indexOf('season ' + season) > -1; })
        || fj.data.file_list.find(function (f) { return f.is_dir; });
      if (!sf) return [];
      var ed = await _fj(FB + '/file/file_share_list?share_key=' + sk + '&parent_id=' + sf.fid, { headers: hd });
      if (ed && ed.data && ed.data.file_list)
        vf = ed.data.file_list.find(function (f) {
          return !f.is_dir && (f.file_name || '').toLowerCase().indexOf('e' + (ep < 10 ? '0' : '') + ep) > -1;
        }) || ed.data.file_list.find(function (f) { return !f.is_dir; });
    } else vf = fj.data.file_list.find(function (f) { return !f.is_dir; });
    if (!vf) return [];
    var qj = await _fj(FB + '/console/video_quality_list?fid=' + vf.fid + '&share_key=' + sk, {
      headers: Object.assign({}, hd, { Cookie: tk.indexOf('ui=') === 0 ? tk : 'ui=' + tk })
    });
    if (!qj || !qj.html) return [];
    var o = [], re = /<div[^>]*class="[^"]*file_quality[^"]*"[^>]*>/g, m;
    while ((m = re.exec(qj.html))) {
      var u = (m[0].match(/data-url="([^"]+)"/) || [])[1];
      var q = (m[0].match(/data-quality="([^"]+)"/) || [])[1];
      if (u && q) o = o.concat(_mk(u.replace(/\\\//g, '/'), SB + '/', 'ShowBox', q === 'ORG' ? '2160p' : (q.match(/\d{3,4}/) || ['Auto'])[0] + 'p'));
    }
    return o;
  } catch (e) { return []; }
}
async function getVidsrc(imdb, tmdb, season, ep) {
  var id = tmdb || imdb;
  if (!id) return [];
  var paths = season == null
    ? ['/embed/movie/' + id, '/embed/movie?tmdb=' + id]
    : ['/embed/tv/' + id + '/' + season + '/' + ep, '/embed/tv?tmdb=' + id + '&season=' + season + '&episode=' + ep];
  for (var bi = 0; bi < VSRC.length; bi++) {
    for (var pi = 0; pi < paths.length; pi++) {
      try {
        var u = VSRC[bi] + paths[pi];
        var h = await _ft(u, { headers: { Referer: VSRC[bi] + '/', 'User-Agent': UA } });
        if (!h) continue;
        var o = [];
        var di = h.match(/https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/i);
        if (di) o = o.concat(_mk(di[0], u, 'VidSrc'));
        o = o.concat(_js(h, u, 'VidSrc'));
        if (o.length) return o;
        var hash = (h.match(/data-hash=["']([^"']+)["']/i) || [])[1];
        var ifr = h.match(/<iframe[^>]+src=["']([^"']+)["']/i);
        var nx = ifr ? _abs(ifr[1], u) : (hash ? _org(u) + '/rcp/' + hash : '');
        if (!nx) continue;
        var h2 = await _ft(nx, { headers: { Referer: u, 'User-Agent': UA } });
        var src = (h2 || '').match(/(?:src|file)\s*[:=]\s*["']([^"']+)["']/i);
        if (src && /^https?:\/\//i.test(src[1])) {
          var h3 = await _ft(src[1], { headers: { Referer: nx, 'User-Agent': UA } });
          var inr = (h3 || '').match(/https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/i);
          if (inr) return _mk(inr[0], src[1], 'VidSrc');
          o = o.concat(_js(h3 || '', src[1], 'VidSrc'));
          if (o.length) return o;
        }
      } catch (e) {}
    }
  }
  return [];
}
async function _eds(host, tmdb, season, ep, label, cb) {
  var pg = season == null ? host + '/movie/' + tmdb : host + '/tv/' + tmdb + '/' + season + '/' + ep;
  var h = await _ft(pg, { headers: { Referer: host + '/', 'User-Agent': UA } });
  if (!h) return [];
  var tk = (h.match(/\\"(?:en|token)\\":\\"(.*?)\\"/) || [])[1] || (h.match(/data-token=["']([^"']+)["']/i) || [])[1];
  if (!tk) return [];
  var s1 = await _fj(MULTI + '/enc-vidfast?text=' + encodeURIComponent(tk) + '&stage=1');
  if (!s1 || !s1.result || !s1.result.stage1) return [];
  var s1t = await _ft(s1.result.stage1, {
    method: 'POST', headers: { 'User-Agent': UA, Referer: pg, 'X-CSRF-Token': s1.result.token, 'X-Requested-With': 'XMLHttpRequest' }
  });
  if (!s1t) return [];
  var d = await _fj(MULTI + '/enc-vidfast?text=' + encodeURIComponent(s1t) + '&stage=2');
  if (!d || !d.result || !d.result.servers || !d.result.stream) return [];
  var ph = { 'User-Agent': UA, Referer: pg, 'X-CSRF-Token': d.result.token, 'X-Requested-With': 'XMLHttpRequest' };
  var sd = await _fj(MULTI + '/dec-vidfast', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: await _ft(d.result.servers, { method: 'POST', headers: ph }) })
  });
  if (!sd || !sd.result) return [];
  var o = [];
  for (var i = 0; i < sd.result.length; i++) {
    var sv = sd.result[i];
    if (!sv.data) continue;
    try {
      var se = await _ft(d.result.stream + '/' + sv.data, { method: 'POST', headers: ph });
      var sr = await _fj(MULTI + '/dec-vidfast', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: se })
      });
      if (sr.result && sr.result.url) {
        if (sr.result.tracks) sr.result.tracks.forEach(function (t) { if (t.file && t.label) cb({ url: _abs(t.file, host + '/'), lang: t.label }); });
        o = o.concat(_mk(sr.result.url, host + '/', label + ' ' + (sv.name || ''), sr.result.is4kAvailable ? '2160p' : '1080p'));
      }
    } catch (e) {}
  }
  return o;
}
async function getVidcore(tmdb, season, ep, cb) { if (!tmdb) return []; return _eds(VCORE, tmdb, season, ep, 'VidCore', cb); }
async function getVidup(tmdb, season, ep, cb) { if (!tmdb) return []; return _eds(VUP, tmdb, season, ep, 'VidUp', cb); }
async function getMoviesapi(tmdb, season, ep) {
  if (!tmdb) return [];
  var urls = season == null ? [MAPI + '/movie/' + tmdb] : [MAPI + '/tv/' + tmdb + '/' + season + '/' + ep];
  var o = [];
  for (var i = 0; i < urls.length; i++) {
    try {
      var h = await _ft(urls[i], { headers: { Referer: MAPI + '/', 'User-Agent': UA } });
      if (!h) continue;
      var em = h.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (em) o = o.concat(await _re(_abs(em[1], urls[i]), urls[i]));
      o = o.concat(_js(h, urls[i], 'moviesapi'));
    } catch (e) {}
  }
  return o;
}
async function getVidnest(tmdb, season, ep) {
  if (!tmdb) return [];
  var paths = season == null ? ['/embed/movie/' + tmdb, '/movie/' + tmdb] : ['/embed/tv/' + tmdb + '/' + season + '/' + ep, '/tv/' + tmdb + '/' + season + '/' + ep];
  var o = [];
  for (var i = 0; i < paths.length; i++) {
    try {
      var u = VNEST + paths[i];
      var h = await _ft(u, { headers: { Referer: VNEST + '/', 'User-Agent': UA } });
      if (!h) continue;
      o = o.concat(_js(h, u, 'VidNest'));
      var em = h.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (em) o = o.concat(await _re(_abs(em[1], u), u));
      if (o.length) break;
    } catch (e) {}
  }
  return o;
}

// ── Orchestrator ──────────────────────────────────────────────────────
async function getVideoSources(url, opts) {
  opts = opts || {};
  var p = _sid(url);
  var m = await _resolveMeta(p);
  var an = m.isAnime === true;
  var subs = [], cb = function (s) { if (s && s.url) subs.push(s); };
  var dg = [];

  function race(src, tag) {
    if (!src.length) return Promise.resolve([]);
    return new Promise(function (res) {
      var pd = src.length, dn = false;
      function st(r, n) {
        if (dn) return;
        pd--;
        if (r && r.length) {
          dn = true;
          console.log('Mewstream: ' + tag + ' hit ' + r.length + ' from ' + n);
          res(r);
          return;
        }
        if (pd === 0) { dn = true; res([]); }
      }
      src.forEach(function (s) {
        _withTimeout(s.fn(), 20000, [], s.name)
          .then(function (r) {
            if (!r || !r.length) dg.push(s.name + ':0');
            st(r, s.name);
          })
          .catch(function (e) {
            dg.push(s.name + ':' + (e && e.message || e));
            st([], s.name);
          });
      });
    });
  }

  var as = [];
  if (an) {
    var epNum = p.absolute || p.episode;
    if (_bool('enableMegaplayDirect', true) && (m.malId || m.anilistId))
      as.push({ name: 'MegaPlay-Direct', fn: function () { return getMegaplayDirect(m.malId, m.anilistId, epNum, cb); } });
    if (_bool('enableAnikoto', true) && m.title)
      as.push({ name: 'AniKoto', fn: function () { return getAnikoto(m.title, p.season, epNum, cb); } });
    if (_bool('enableAnizone', true) && m.title)
      as.push({ name: 'AniZone', fn: function () { return getAnizone(m.title, p.season, epNum); } });
    if (_bool('enableAnimesalt', true) && m.title)
      as.push({ name: 'AnimeSalt', fn: function () { return getAnimesalt(m.title, p.season, epNum); } });
    if (_bool('enableRareanimes', true) && m.title)
      as.push({ name: 'RareAnimes', fn: function () { return getRareanimes(m.title, p.season, epNum, cb); } });
  } else {
    dg.push('anime-sources:skipped(' + (m.classifyReason || 'not-anime') + ')');
  }

  var ms = [];
  if (_bool('enableVaplayer', true) && m.imdbId)
    ms.push({ name: 'VaPlayer', fn: function () { return getVaplayer(m.imdbId, p.season, p.episode, cb); } });
  if (_bool('enableVidrock', true) && m.tmdbId)
    ms.push({ name: 'Vidrock', fn: function () { return getVidrock(m.tmdbId, p.season, p.episode); } });
  if (_bool('enableVidfast', true) && m.tmdbId)
    ms.push({ name: 'Vidfast', fn: function () { return getVidfast(m.tmdbId, p.season, p.episode, cb); } });
  if (_bool('enableHexa', true) && m.tmdbId)
    ms.push({ name: 'Hexa', fn: function () { return getHexa(m.tmdbId, p.season, p.episode); } });
  if (_bool('enableVidzee', true) && m.tmdbId)
    ms.push({ name: 'Vidzee', fn: function () { return getVidzee(m.tmdbId, p.season, p.episode, cb); } });
  if (_bool('enableShowbox', true) && m.imdbId)
    ms.push({ name: 'Showbox', fn: function () { return getShowbox(m.imdbId, p.season, p.episode, cb); } });
  if (_bool('enableVidsrc', true) && (m.tmdbId || m.imdbId))
    ms.push({ name: 'VidSrc', fn: function () { return getVidsrc(m.imdbId, m.tmdbId, p.season, p.episode); } });
  if (_bool('enableVidcore', true) && m.tmdbId) {
    ms.push({ name: 'VidCore', fn: function () { return getVidcore(m.tmdbId, p.season, p.episode, cb); } });
    ms.push({ name: 'VidUp', fn: function () { return getVidup(m.tmdbId, p.season, p.episode, cb); } });
  }
  if (_bool('enableMoviesapi', true) && m.tmdbId)
    ms.push({ name: 'moviesapi', fn: function () { return getMoviesapi(m.tmdbId, p.season, p.episode); } });
  if (_bool('enableVidnest', true) && m.tmdbId)
    ms.push({ name: 'VidNest', fn: function () { return getVidnest(m.tmdbId, p.season, p.episode); } });

  var out = [];
  if (an && as.length) out = await race(as, 'anime');
  if (!out.length && ms.length) out = await race(ms, 'movie');

  var seen = {}, dd = [];
  out.forEach(function (s) { if (s && s.url && !seen[s.url]) { seen[s.url] = 1; dd.push(s); } });

  if (typeof opts.onSubtitle === 'function') {
    var ss = {};
    subs.forEach(function (s) { if (!ss[s.url]) { ss[s.url] = 1; opts.onSubtitle(s); } });
  }

  if (!dd.length) console.log('Mewstream: 0 streams | anime=' + an + ' | ' + dg.join(' | '));
  else console.log('Mewstream DONE: ' + dd.length + ' streams | ' + (m.title || '?') + ' | anime=' + an);
  return dd;
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

// ── Exports ───────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION,
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    popular: popular,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams,
    getLinks: getLinks,
    _parseStreamId: _sid,
    _debug: {
      getMegaplayDirect: getMegaplayDirect,
      getAnikoto: getAnikoto,
      getAnizone: getAnizone,
      getAnimesalt: getAnimesalt,
      getRareanimes: getRareanimes,
      getShowbox: getShowbox,
      getVaplayer: getVaplayer,
      getVidrock: getVidrock,
      getVidzee: getVidzee,
      getVidfast: getVidfast,
      getHexa: getHexa,
      getVidsrc: getVidsrc,
      getVidcore: getVidcore,
      getVidup: getVidup,
      getMoviesapi: getMoviesapi,
      getVidnest: getVidnest,
      classify: _cls,
      sim: _sim,
      titleOk: _titleOk
    }
  };
}