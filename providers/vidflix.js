// VidFlix movie/series source for Zangetsu.
// Uses VidCore's resolver API to turn TMDB movie/TV IDs into unlocked streams.
// The resolver also exposes an HLS relay for hosts that require server-side
// Referer/CORS handling; never return the VidFlix watch page as a playable URL.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'vidflix';
var VERSION = '1.1.1';
var TMDB_API = 'https://api.themoviedb.org/3';
var POSTER = 'https://image.tmdb.org/t/p/w500';
var BACKDROP = 'https://image.tmdb.org/t/p/w780';
var LOGO = 'https://www.google.com/s2/favicons?sz=256&domain=vidflix.site';
var VIDCORE_BASE = 'https://vidcore.net';
var VIDCORE_CATALOG = '/838f93f8-02b6-5507-9b61-ab3717b54df2/a5022a41c59655396826d539c0a45fcf2396f987/1000063215035220/mo/n/e0ff7e8f0cbd036e8b03e8feb783f354c0b215853cc14afd119f9a3a2bab8aa2';
var VIDCORE_LIST_ACTION = 'sB2_etpff40';
var VIDCORE_STREAM_ACTION = '2ihd9UxHIsM';
var UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'VidFlix', lang: 'en', baseUrl: 'https://vidflix.site', logo: LOGO, type: 'movie', version: VERSION };
}

function getSettings() { return []; }

function _trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
function _json(path) {
  return fetch(TMDB_API + path, { headers: { Accept: 'application/json' }, timeoutMs: 15000 })
    .then(function (r) {
      if (r && r.status && r.status >= 400) throw new Error('TMDB HTTP ' + r.status);
      var b = r && r.body != null ? r.body : '';
      return typeof b === 'string' ? JSON.parse(b || 'null') : b;
    }).catch(function (error) { console.warn('VidFlix TMDB request failed:', String(error)); return null; });
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

// ── Native VidCore resolver (no separately hosted resolver service) ──────────
// VidCore's current player protocol requires a per-page token, encrypted catalog
// requests and AES-GCM response decoding. These small primitives are local to
// this provider so the integration does not call an external resolver API.
function _hexBytes(hex) {
  var out = [];
  for (var i = 0; i + 1 < String(hex).length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}
function _b64Bytes(input) {
  var s = String(input || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  var abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = [], acc = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    if (s.charAt(i) === '=') break;
    var n = abc.indexOf(s.charAt(i));
    if (n < 0) continue;
    acc = (acc << 6) | n; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
  }
  return out;
}
function _b64String(bytes) {
  var abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i] & 255, hasB = i + 1 < bytes.length, hasC = i + 2 < bytes.length;
    var b = hasB ? bytes[i + 1] & 255 : 0, c = hasC ? bytes[i + 2] & 255 : 0;
    out += abc.charAt(a >> 2) + abc.charAt(((a & 3) << 4) | (b >> 4));
    out += hasB ? abc.charAt(((b & 15) << 2) | (c >> 6)) : '=';
    out += hasC ? abc.charAt(c & 63) : '=';
  }
  return out;
}
function _utf8Bytes(s) {
  var text = encodeURIComponent(String(s)), out = [];
  for (var i = 0; i < text.length;) {
    if (text.charAt(i) === '%' && /^[0-9a-f]{2}$/i.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 3;
    } else { out.push(text.charCodeAt(i) & 255); i++; }
  }
  return out;
}
function _utf8Text(bytes) {
  var encoded = '';
  for (var i = 0; i < bytes.length; i++) encoded += '%' + ('0' + (bytes[i] & 255).toString(16)).slice(-2);
  try { return decodeURIComponent(encoded); } catch (e) {
    var out = ''; for (var j = 0; j < bytes.length; j++) out += String.fromCharCode(bytes[j] & 255);
    return out;
  }
}
function _concat() {
  var out = [];
  for (var i = 0; i < arguments.length; i++) {
    var a = arguments[i] || [];
    for (var j = 0; j < a.length; j++) out.push(a[j] & 255);
  }
  return out;
}
function _sha256(data) {
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,
    0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,
    0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,
    0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,
    0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,
    0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,
    0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  function rr(x,n) { return (x >>> n) | (x << (32 - n)); }
  var m = (data || []).slice(), bitLen = m.length * 8;
  m.push(0x80); while ((m.length % 64) !== 56) m.push(0);
  var high = Math.floor(bitLen / 4294967296), low = bitLen >>> 0;
  m.push((high >>> 24)&255,(high >>> 16)&255,(high >>> 8)&255,high&255,
         (low >>> 24)&255,(low >>> 16)&255,(low >>> 8)&255,low&255);
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var W = new Array(64);
  for (var off = 0; off < m.length; off += 64) {
    for (var t = 0; t < 16; t++) {
      var p = off + t * 4;
      W[t] = (((m[p]&255)<<24)|((m[p+1]&255)<<16)|((m[p+2]&255)<<8)|(m[p+3]&255)) >>> 0;
    }
    for (var q = 16; q < 64; q++) {
      var x = W[q-15], y = W[q-2];
      var s0 = rr(x,7) ^ rr(x,18) ^ (x >>> 3), s1 = rr(y,17) ^ rr(y,19) ^ (y >>> 10);
      W[q] = (W[q-16] + s0 + W[q-7] + s1) >>> 0;
    }
    var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (var z = 0; z < 64; z++) {
      var S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25);
      var ch = (e & f) ^ (~e & g);
      var T1 = (h + S1 + ch + K[z] + W[z]) >>> 0;
      var S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var T2 = (S0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d+T1)>>>0; d=c; c=b; b=a; a=(T1+T2)>>>0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
  }
  var out = [];
  H.forEach(function (n) { out.push((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255); });
  return out;
}
function _gfMul(a,b) {
  var p=0;
  while (b) { if (b&1) p ^= a; var hi=a&128; a=(a<<1)&255; if (hi) a ^= 0x1b; b >>>= 1; }
  return p & 255;
}
function _gfPow(a,n) {
  var out=1;
  while (n) { if(n&1) out=_gfMul(out,a); a=_gfMul(a,a); n >>>= 1; }
  return out;
}
var _AES_SBOX = (function () {
  var s=[];
  function rol8(x,n) { return ((x<<n)|(x>>>(8-n)))&255; }
  for (var i=0;i<256;i++) {
    var v=i ? _gfPow(i,254) : 0;
    s[i]=(v ^ rol8(v,1) ^ rol8(v,2) ^ rol8(v,3) ^ rol8(v,4) ^ 0x63)&255;
  }
  return s;
})();
function _aesSchedule(key) {
  if (!key || key.length !== 32) throw new Error('AES-256 key must be 32 bytes');
  var out = key.slice(), generated = 32, rcon = 1;
  while (generated < 240) {
    var t = out.slice(generated-4,generated);
    if (generated % 32 === 0) {
      t = [t[1],t[2],t[3],t[0]].map(function (b) { return _AES_SBOX[b]; });
      t[0] ^= rcon; rcon = _gfMul(rcon,2);
    } else if (generated % 32 === 16) {
      t = t.map(function (b) { return _AES_SBOX[b]; });
    }
    for (var j=0;j<4;j++) { out[generated] = (out[generated-32] ^ t[j]) & 255; generated++; }
  }
  return out;
}
function _aesBlock(schedule, block) {
  var s=block.slice(0,16);
  function addKey(round) { for(var i=0;i<16;i++) s[i]^=schedule[round*16+i]; }
  function shiftRows() {
    var t=s.slice();
    for(var r=1;r<4;r++) for(var c=0;c<4;c++) s[r+4*c]=t[r+4*((c+r)%4)];
  }
  function mixCols() {
    for(var c=0;c<4;c++) {
      var i=4*c,a=s[i],b=s[i+1],d=s[i+2],e=s[i+3],all=a^b^d^e;
      s[i]   = a ^ all ^ _gfMul(a^b,2);
      s[i+1] = b ^ all ^ _gfMul(b^d,2);
      s[i+2] = d ^ all ^ _gfMul(d^e,2);
      s[i+3] = e ^ all ^ _gfMul(e^a,2);
    }
  }
  addKey(0);
  for(var round=1;round<14;round++) {
    for(var k=0;k<16;k++) s[k]=_AES_SBOX[s[k]];
    shiftRows(); mixCols(); addKey(round);
  }
  for(var z=0;z<16;z++) s[z]=_AES_SBOX[s[z]];
  shiftRows(); addKey(14);
  return s;
}
function _aesCbcEncrypt(key, iv, plain) {
  var schedule=_aesSchedule(key), p=(plain||[]).slice(), pad=16-(p.length%16);
  for(var n=0;n<pad;n++) p.push(pad);
  var prev=iv.slice(), out=[];
  for(var off=0;off<p.length;off+=16) {
    var block=[]; for(var i=0;i<16;i++) block[i]=p[off+i]^prev[i];
    prev=_aesBlock(schedule,block); out=out.concat(prev);
  }
  return out;
}
function _xor16(a,b) { var out=[]; for(var i=0;i<16;i++) out[i]=(a[i]^b[i])&255; return out; }
function _gf128Mul(x,h) {
  var z=new Array(16).fill(0), v=h.slice();
  for(var i=0;i<128;i++) {
    if ((x[i>>3] >>> (7-(i&7))) & 1) for(var j=0;j<16;j++) z[j]^=v[j];
    var lsb=v[15]&1, carry=0;
    for(var k=0;k<16;k++) { var old=v[k]; v[k]=(old>>>1)|carry; carry=(old&1)<<7; }
    if(lsb) v[0]^=0xe1;
  }
  return z;
}
function _inc32(block) {
  for(var i=15;i>=12;i--) { block[i]=(block[i]+1)&255; if(block[i]!==0) break; }
}
function _aesGcmDecrypt(key, iv, ct, tag) {
  if(iv.length!==12 || tag.length!==16) throw new Error('Invalid AES-GCM IV or tag');
  var schedule=_aesSchedule(key), H=_aesBlock(schedule,new Array(16).fill(0));
  var y=new Array(16).fill(0);
  for(var off=0;off<ct.length;off+=16) {
    var block=new Array(16).fill(0), len=Math.min(16,ct.length-off);
    for(var i=0;i<len;i++) block[i]=ct[off+i];
    y=_gf128Mul(_xor16(y,block),H);
  }
  var lengths=new Array(16).fill(0), bits=ct.length*8, tmp=bits;
  for(var l=15;l>=8;l--) { lengths[l]=tmp&255; tmp=Math.floor(tmp/256); }
  y=_gf128Mul(_xor16(y,lengths),H);
  var j0=iv.concat([0,0,0,1]), mask=_aesBlock(schedule,j0), expected=_xor16(mask,y);
  var good=1; for(var q=0;q<16;q++) if(expected[q]!==tag[q]) good=0;
  if(!good) throw new Error('VidCore catalog response authentication failed');
  var counter=j0.slice(), out=[];
  for(var pos=0;pos<ct.length;pos+=16) {
    _inc32(counter);
    var keyBlock=_aesBlock(schedule,counter), n=Math.min(16,ct.length-pos);
    for(var m=0;m<n;m++) out.push(ct[pos+m]^keyBlock[m]);
  }
  return out;
}
function _rotl8(x,n) {
  n &= 7; if(!n) return x&255; return ((x<<n)|(x>>>(8-n)))&255;
}
function _rotr8(x,n) {
  n &= 7; if(!n) return x&255; return ((x>>>n)|(x<<(8-n)))&255;
}
function _u32le(bytes, off) {
  return ((bytes[off]&255)|((bytes[off+1]&255)<<8)|((bytes[off+2]&255)<<16)|((bytes[off+3]&255)<<24))>>>0;
}
function _writeU64LE(num) {
  var out=new Array(8).fill(0), x=num;
  for(var i=0;i<8;i++) { out[i]=x%256; x=Math.floor(x/256); }
  return out;
}
function _xorshift(seed) {
  var d=_sha256(seed), state=(_u32le(d,0)^_u32le(d,4)^_u32le(d,8)^_u32le(d,12))>>>0;
  if(!state) state=2654435769;
  return function() {
    state^=(state<<13)>>>0; state>>>=0;
    state^=state>>>17; state>>>=0;
    state^=(state<<5)>>>0; state>>>=0;
    return state>>>0;
  };
}
function _fyOrder(n,next) {
  var order=[]; for(var i=0;i<n;i++) order[i]=i;
  for(var j=n-1;j>0;j--) { var k=next()%(j+1), t=order[j]; order[j]=order[k]; order[k]=t; }
  return order;
}
function _perm256(material) {
  var next=_xorshift(material), arr=[]; for(var i=0;i<256;i++) arr[i]=i;
  for(var j=255;j>0;j--) { var k=next()%(j+1),t=arr[j];arr[j]=arr[k];arr[k]=t; }
  return arr;
}
function _rc4(key,data) {
  var S=[]; for(var i=0;i<256;i++) S[i]=i;
  var j=0;
  for(var n=0;n<256;n++) { j=(j+S[n]+key[n%key.length])&255; var t=S[n];S[n]=S[j];S[j]=t; }
  var out=[],i2=0;j=0;
  for(var p=0;p<data.length;p++) {
    i2=(i2+1)&255;j=(j+S[i2])&255;var t2=S[i2];S[i2]=S[j];S[j]=t2;
    out[p]=data[p]^S[(S[i2]+S[j])&255];
  }
  return out;
}
function _saltedXor(data,keyB64,saltB64,xf) {
  var key=_b64Bytes(keyB64),salt=_b64Bytes(saltB64),out=[];
  for(var i=0;i<data.length;i++) { if(i<salt.length) out.push(salt[i]);out.push(xf(i,(data[i]^key[i%key.length])&255)&255); }
  return out;
}
function _dispatch(table) { return function(i,x) { return table[i%10] ? table[i%10](x) : x; }; }
function _ops(name) {
  var ops={
    xor59:function(x){return x^59;}, sub76:function(x){return (x-76)&255;},
    sub200:function(x){return (x-200)&255;}, sub216:function(x){return (x-216)&255;},
    sub218:function(x){return (x-218)&255;}, sub226:function(x){return (x-226)&255;},
    add230:function(x){return (x+230)&255;}, rotl1:function(x){return _rotl8(x,1);},
    rotl2:function(x){return _rotl8(x,2);}, rotr2:function(x){return _rotr8(x,2);},
    rotl7:function(x){return _rotl8(x,7);}, rotr7:function(x){return _rotr8(x,7);}
  };
  var maps={
    EA:{0:'sub226',9:'sub226',1:'sub76',5:'sub76',2:'rotl2',3:'sub200',7:'sub200',4:'xor59',6:'xor59',8:'xor59'},
    B81:{0:'sub218',7:'sub218',1:'rotl2',4:'rotl2',2:'xor59',6:'xor59',3:'rotl1',8:'rotl1',5:'rotr2',9:'add230'},
    C272:{0:'rotl2',1:'sub200',3:'sub200',2:'rotr2',7:'rotr2',4:'rotl1',5:'rotr7',8:'rotr7',6:'sub226',9:'rotl7'},
    C936:{0:'sub200',6:'sub200',1:'rotl2',8:'rotl2',2:'sub226',3:'add230',5:'add230',4:'sub76',7:'sub218',9:'rotl1'},
    BAD:{0:'sub216',4:'sub216',1:'rotr7',2:'rotl7',7:'rotl7',3:'xor59',5:'xor59',6:'sub226',8:'rotl1',9:'rotl2'}
  };
  return _dispatch(Object.keys(maps[name]).reduce(function(out,k){out[k]=ops[maps[name][k]];return out;},{}));
}
function _encryptResolveToken(en) {
  var AES_KEY=_hexBytes('da0113008b4e86066e28d529887d85e570ee04b0f6f0cc68d481b5233b991f54');
  var AES_IV=_hexBytes('9ac8413d165f5e5c1e1103837b5e61b2'), PREFIX=[0xaa,0x09];
  var rand=[]; for(var i=0;i<16;i++) rand.push(Math.floor(Math.random()*256));
  var plain=_concat(rand,_writeU64LE(Date.now ? Date.now() : new Date().getTime()),_utf8Bytes(en));
  var aes=_aesCbcEncrypt(AES_KEY,AES_IV,plain);
  var h=_sha256(_concat(PREFIX,rand));
  for(var p=0;p<aes.length;p++) { if(p%32===0&&p>0) h=_sha256(h); aes[p]^=h[p%32]; }
  var h2=_sha256(_concat(AES_KEY,rand));
  for(var q=0;q<aes.length;q++) { var kk=h2[q%32]; aes[q]=(_rotl8(aes[q],kk&7)+(kk^165))&255; }
  var table=_perm256(_concat(rand,PREFIX,AES_IV));
  for(var x=0;x<aes.length;x++) aes[x]=table[aes[x]];
  var nblocks=Math.ceil(aes.length/16), order=_fyOrder(nblocks,_xorshift(_concat(PREFIX,rand)));
  var padded=aes.slice(), shuffled=[];
  while(padded.length<nblocks*16) padded.push(0);
  for(var bi=0;bi<nblocks;bi++) for(var bj=0;bj<16;bj++) shuffled[bi*16+bj]=padded[order[bi]*16+bj]||0;
  aes=shuffled.slice(0,aes.length);
  var perm=_fyOrder(aes.length,_xorshift(_concat(AES_KEY,rand,[aes.length&255]))), saved=aes.slice();
  for(var pi=0;pi<aes.length;pi++) aes[pi]=saved[perm[pi]];
  var orderBuf=[];
  for(var oi=0;oi<order.length;oi++) orderBuf=_concat(orderBuf,[order[oi]&255,(order[oi]>>>8)&255,(order[oi]>>>16)&255,(order[oi]>>>24)&255]);
  var mac=_sha256(_concat(orderBuf,aes)).slice(0,8);
  var len=order.length, packet=_concat([1],rand,[len&255,(len>>>8)&255],orderBuf,aes,mac);
  var b64=_b64String(packet).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  var alpha='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
  var alphaTo='TV2w64ayBhSzOkZ-N_5L9vWse13P0E8FHIArcGjMXuRqgpCdlYUn7JoibxDtQmKf';
  var encoded='';
  for(var ci=0;ci<b64.length;ci++) { var idx=alpha.indexOf(b64.charAt(ci)); encoded+=idx>=0?alphaTo.charAt(idx):b64.charAt(ci); }
  var reversed=encoded.split('').reverse().join(''), hex='';
  for(var hi=0;hi<reversed.length;hi++) hex+=('0'+reversed.charCodeAt(hi).toString(16)).slice(-2);
  var bytes=_utf8Bytes(encodeURIComponent(hex));
  var PIPE=[
    {key:'2ntGSzXfJFs0hDs88l+Bb8JUwUn1Cv1SO9aK+UZa7ZU=',salt:'ZEoMcPJnrrw=',xf:_ops('EA')},
    {mix:'3VBriafyK762DRIdc5LjFTk+GA4dbA3swiAWzTlVOVc='},
    {key:'LposjLRR+u1zH3v9cdbdlZ6ndC09ZKur+yxm40F2sVM=',salt:'Dumq7XMwDOY=',xf:_ops('BAD')},
    {mix:'yMJbT7L+Ae97prvFUBlm54hYX9LgqpaFEP5Mnsg8vFQ='},
    {key:'9lLhnwArYvk1+ve+oZManKJjAeZQAM4qN+owU2FJ1+A=',salt:'3vKxl02f',xf:_ops('B81')},
    {mix:'+u3IoSX0Ka9w+6NRTnPJypiTtiLelUob4F+heqowdGY='},
    {key:'2H9z2kEoZ2Gj6Fiste7KHwMnafIMdV5xqT74AEGk0y4=',salt:'jXyIA2g=',xf:_ops('C272')},
    {mix:'XyQ+FAbK0EXQ0yS7G7i1MvXTI1xWz9n5ZGUWBwkSfRo='},
    {key:'aOc7TpxM4aeKW3Dl+SU/gGeEfe1q3Jqnvwdust0uLaI=',salt:'BkLBcRo=',xf:_ops('C936')},
    {mix:'pDw5NQnCc1F4yT4R8bqhASC1ExUNJqdCJ3gQwgVV5Xc='}
  ];
  for(var si=0;si<PIPE.length;si++) {
    var step=PIPE[si];
    bytes=step.mix ? _rc4(_b64Bytes(step.mix),bytes) : _saltedXor(bytes,step.key,step.salt,step.xf);
  }
  return _b64String(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
function _decryptResolvePayload(payload) {
  var raw=_b64Bytes(payload);
  if(raw.length<44) throw new Error('VidCore returned an invalid encrypted catalog response');
  var salt=raw.slice(0,16),iv=raw.slice(16,28),tag=raw.slice(raw.length-16),ct=raw.slice(28,raw.length-16);
  var fixed=_hexBytes('9b425029a188e1131dbc32a24632a5ac9124037d52587001844f02315c00ebb0');
  fixed=_sha256(_concat(fixed,_writeU64LE(1318175778),_writeU64LE(5464207410)));
  var key=_sha256(_concat(fixed,salt)),plain=_aesGcmDecrypt(key,iv,ct,tag);
  if(plain.length<=8) throw new Error('VidCore catalog response decrypted to an empty payload');
  return JSON.parse(_utf8Text(plain.slice(8)));
}
function _responseHeader(headers,name) {
  if(!headers) return '';
  if(typeof headers.get==='function') { var val=headers.get(name); if(val!=null) return val; }
  var target=String(name).toLowerCase();
  for(var key in headers) if(String(key).toLowerCase()===target) return headers[key];
  return '';
}
function _saveCookies(response, jar) {
  var raw=_responseHeader(response && response.headers,'set-cookie');
  if(Array.isArray(raw)) raw=raw.join(',');
  String(raw||'').split(/,(?=\s*[^;,\s]+=)/).forEach(function(line) {
    var first=String(line).split(';')[0],i=first.indexOf('=');
    if(i>0) jar[first.slice(0,i).trim()]=first.slice(i+1).trim();
  });
}
function _cookieString(jar) {
  return Object.keys(jar).map(function(key){return key+'='+jar[key];}).join('; ');
}
function _requestText(url, init, jar) {
  init=init||{};
  var headers={Accept:'*/*','User-Agent':UA,'Origin':VIDCORE_BASE,'Referer':init.referer||VIDCORE_BASE+'/'};
  var custom=init.headers||{};
  for(var key in custom) headers[key]=custom[key];
  var cookie=_cookieString(jar||{});
  if(cookie) headers.Cookie=cookie;
  return fetch(url,{method:init.method||'GET',headers:headers,body:init.body,timeoutMs:init.timeoutMs||25000})
    .then(function(r) {
      if(r && r.status && r.status>=400) throw new Error('VidCore HTTP '+r.status+' for '+url);
      _saveCookies(r,jar||{});
      var body=r && r.body!=null?r.body:'';
      return typeof body==='string'?body:JSON.stringify(body);
    });
}
function _extractVidCoreSession(html) {
  var match=String(html||'').match(/\\"en\\":\\"([^\\"]+)\\"/);
  if(!match || !match[1]) throw new Error('VidCore embed page did not contain an en session token');
  return match[1];
}
function _vidCorePage(parsed) {
  var path=parsed.type==='tv'?'/tv/'+parsed.id+'/'+parsed.season+'/'+parsed.episode:'/movie/'+parsed.id;
  var pageUrl=VIDCORE_BASE+path, jar={};
  return _requestText(pageUrl,{timeoutMs:20000,headers:{Accept:'text/html,application/xhtml+xml'},referer:VIDCORE_BASE+'/'},jar)
    .then(function(html) {
      var session=_extractVidCoreSession(html);
      return {session:session,pageUrl:pageUrl,jar:jar};
    });
}
function _vidCoreStreams(parsed) {
  if(parsed.type==='tv' && (parsed.season<1 || parsed.episode<1)) return Promise.resolve([]);
  return _vidCorePage(parsed).then(function(page) {
    var token=_encryptResolveToken(page.session);
    var apiBase=VIDCORE_BASE+VIDCORE_CATALOG;
    var common={method:'POST',body:'',timeoutMs:25000,referer:page.pageUrl,
      headers:{'X-Requested-With':'XMLHttpRequest','Accept':'*/*'}};
    return _requestText(apiBase+'/'+VIDCORE_LIST_ACTION+'/'+token,common,page.jar).then(function(encoded) {
      var servers=_decryptResolvePayload(encoded);
      if(!Array.isArray(servers) || !servers.length) throw new Error('VidCore returned no catalog servers');
      var priority=['Orbit','Supreme','Prime','Premiere 4K','Horizon'],rank={};
      priority.forEach(function(name,i){rank[name]=i;});
      servers=servers.filter(function(server){return server && server.data;}).sort(function(a,b) {
        var ar=rank[a.name] == null?100:rank[a.name],br=rank[b.name] == null?100:rank[b.name];
        return ar-br;
      });
      var jobs=servers.map(function(server) {
        return _requestText(apiBase+'/'+VIDCORE_STREAM_ACTION+'/'+server.data,common,page.jar).then(function(result) {
          var config=_decryptResolvePayload(result);
          var url=config && (config.url || config.file || config.source);
          if(typeof url!=='string' || !/^https?:\/\//i.test(url)) return null;
          return {url:url,name:server.name||'VidCore',headers:{
            'Referer':page.pageUrl,'Origin':VIDCORE_BASE,'User-Agent':UA
          }};
        }).catch(function(error) {
          console.warn('VidFlix VidCore server failed:',String(server.name||'server'),String(error));
          return null;
        });
      });
      return Promise.all(jobs).then(function(rows) {
        var out=[],seen={};
        rows.forEach(function(row) {
          if(!row||seen[row.url]) return;
          seen[row.url]=1;
          out.push({url:row.url,quality:'Auto',container:_streamContainer(row.url),kind:'raw',
            audioLang:'',subtitles:[],label:'VidFlix · VidCore · '+row.name,headers:row.headers});
        });
        if(!out.length) console.warn('VidFlix VidCore: no playable HLS/direct URLs were unlocked');
        return out;
      });
    });
  }).catch(function(error) {
    console.warn('VidFlix native resolver failed:',String(error));
    return [];
  });
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
  var season=parsed.season, episode=parsed.episode;
  if(raw && typeof raw==='object') {
    season=Number(raw.season)||season; episode=Number(raw.episode)||episode;
  } else if(typeof raw==='string' && raw.charAt(0)==='{') {
    try { var obj=JSON.parse(raw); season=Number(obj.season)||season; episode=Number(obj.episode)||episode; } catch(e) {}
  }
  parsed.season=season; parsed.episode=episode;
  return _vidCoreStreams(parsed);
}
function getStreams(raw, opts) { return getVideoSources(raw, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome,
    search: search, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams,
    _parseId: _parseId, _streamContainer: _streamContainer,
    _sha256: _sha256, _aesCbcEncrypt: _aesCbcEncrypt, _aesSchedule: _aesSchedule,
    _aesBlock: _aesBlock, _aesGcmDecrypt: _aesGcmDecrypt,
    _encryptResolveToken: _encryptResolveToken, _decryptResolvePayload: _decryptResolvePayload,
    _extractVidCoreSession: _extractVidCoreSession
  };
}
