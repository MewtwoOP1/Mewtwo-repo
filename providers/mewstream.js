// mewstream.js — Mewstream multi-source provider for Zangetsu
// Sources: AniKoto, MegaPlay, AnimeSalt, RareAnimes, Showbox, VaPlayer, Vidrock, Vidzee, Vidfast, Hexa
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'mewstream';
var VERSION = '1.0.0';

// ── Endpoints ───────────────────────────────────────────────────────────
var ANIKOTO_SITE = 'https://anikototv.to';
var ANIKOTO_API = 'https://anikotoapi.site';
var ANIKOTO_MAPPER = 'https://mapper.nekostream.site/api/mal/';
var MEGAPLAY_BASE = 'https://megaplays.se';
var ANIMESALT_SITE = 'https://animesalt.to';
var RA_SITE = 'https://www.rareanimes.mov';
var RA_SB = 'https://codedew.com/streambeta/';
var SHOWBOX = 'https://showbox.media';
var FEBBOX = 'https://www.febbox.com';
var VA_PLAYER = 'https://streamdata.vaplayer.ru';
var VIDROCK = 'https://vidrock.to';
var VIDZEE = 'https://player.vidzee.wtf';
var VIDFAST = 'https://vidfast.vc';
var HEXA = 'https://theemoviedb.hexa.su';
var CINEMETA = 'https://v3-cinemeta.strem.io';
var KITSU_API = 'https://anime-kitsu.strem.fun';
var HAGLUND_API = 'https://arm.haglund.dev/api/v2';
var TMDB_API = 'https://api.themoviedb.org/3';
var TMDB_KEY = '1865f43a0549ca50d341dd9ab8b29f49';
var TMDB_IMG = 'https://image.tmdb.org/t/p';
var MULTI_DECRYPT = 'https://enc-dec.app/api';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ── Info / Settings ─────────────────────────────────────────────────────
function getInfo() {
  return { name: 'Mewstream', lang: 'en', baseUrl: 'https://www.themoviedb.org',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=strem.io', type: 'movie', version: VERSION };
}
function getSettings() {
  return [
    { key: 'tmdbApiKey', label: 'TMDB API Key (optional)', type: 'text', default: '' },
    { key: 'showboxToken', label: 'Showbox (Febbox) UI Token', type: 'text', default: '' },
    { key: 'enableAnikoto', label: 'AniKoto', type: 'bool', default: true },
    { key: 'enableMegaplay', label: 'MegaPlay', type: 'bool', default: true },
    { key: 'enableAnimesalt', label: 'AnimeSalt', type: 'bool', default: true },
    { key: 'enableRareanimes', label: 'RareAnimes', type: 'bool', default: true },
    { key: 'enableShowbox', label: 'Showbox', type: 'bool', default: true },
    { key: 'enableVaplayer', label: 'VaPlayer', type: 'bool', default: true },
    { key: 'enableVidrock', label: 'Vidrock', type: 'bool', default: true },
    { key: 'enableVidzee', label: 'Vidzee', type: 'bool', default: true },
    { key: 'enableVidfast', label: 'Vidfast', type: 'bool', default: true },
    { key: 'enableHexa', label: 'Hexa', type: 'bool', default: true }
  ];
}

// ── Helpers ─────────────────────────────────────────────────────────────
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
function _text(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _fixUrl(u, base) {
  u = String(u || '').trim();
  if (/^https?:\/\//.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  if (base && u.charAt(0) === '/') { var d = base.split('/'); return d[0] + '//' + d[2] + u; }
  if (base) return base.replace(/\/+$/, '') + '/' + u;
  return 'https://' + u;
}
function _slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function _year(r) { return String(r.release_date || r.first_air_date || r.releaseInfo || r.year || '').slice(0, 4) || null; }

// Normalize Zangetsu's string-body response and the standard Fetch API response.
async function _responseText(r) {
  if (!r) return '';
  if (typeof r.body === 'string') return r.body;
  if (typeof r.text === 'function') {
    var t = await r.text();
    return typeof t === 'string' ? t : '';
  }
  return '';
}
async function _fetchText(url, opts) {
  opts = opts || {};
  var h = Object.assign({ 'User-Agent': UA }, opts.headers || {});
  try {
    var r = await fetch(url, { method: opts.method || 'GET', headers: h, body: opts.body, timeoutMs: opts.timeoutMs || 15000 });
    return await _responseText(r);
  } catch (e) { return ''; }
}
async function _fetchJson(url, opts) {
  var t = await _fetchText(url, opts);
  try { return JSON.parse(t); } catch (e) { return null; }
}
function withTimeout(p, ms, fallback, label) {
  var done = false;
  return Promise.race([
    Promise.resolve(p).then(function (v) { done = true; return v; }, function (e) { done = true; throw e; }),
    new Promise(function (res) { setTimeout(function () { if (!done) { if (label) console.log('Mewstream: ' + label + ' timed out'); res(fallback || []); } }, ms); })
  ]);
}

// ── Pure-JS AES core (shared by MegaPlay, AniKoto, AnimeSalt, Vidzee, Vidrock) ──
function _arr(x){var a=[];for(var i=0;i<x.length;i++)a.push(x[i]&0xff);return a;}
var _SBOX=[0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _ISBOX=[0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
function _xtime(a){a<<=1;if(a&0x100)a^=0x11b;return a&0xff;}
function _gmul(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return p&0xff;}
function _keyExp(key){var Nk=key.length/4,Nr=Nk+6,w=[],i;for(i=0;i<Nk;i++)w.push([key[4*i],key[4*i+1],key[4*i+2],key[4*i+3]]);var rcon=1;for(i=Nk;i<4*(Nr+1);i++){var t=w[i-1].slice();if(i%Nk===0){t=[t[1],t[2],t[3],t[0]];t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];t[0]^=rcon;rcon=_xtime(rcon);}else if(Nk>6&&i%Nk===4){t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];}w.push([w[i-Nk][0]^t[0],w[i-Nk][1]^t[1],w[i-Nk][2]^t[2],w[i-Nk][3]^t[3]]);}return{w:w,Nr:Nr};}
function _invCipher(inb,ks){var w=ks.w,Nr=ks.Nr,s=[[],[],[],[]],r,c,i;for(i=0;i<16;i++)s[i%4][(i/4)|0]=inb[i];function ark(n){for(c=0;c<4;c++)for(r=0;r<4;r++)s[r][c]^=w[n*4+c][r];}function isub(){for(r=0;r<4;r++)for(c=0;c<4;c++)s[r][c]=_ISBOX[s[r][c]];}function ish(){for(r=1;r<4;r++){var row=s[r].slice();for(c=0;c<4;c++)s[r][c]=row[(c-r+4)%4];}}function imx(){for(c=0;c<4;c++){var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];s[0][c]=_gmul(a0,14)^_gmul(a1,11)^_gmul(a2,13)^_gmul(a3,9);s[1][c]=_gmul(a0,9)^_gmul(a1,14)^_gmul(a2,11)^_gmul(a3,13);s[2][c]=_gmul(a0,13)^_gmul(a1,9)^_gmul(a2,14)^_gmul(a3,11);s[3][c]=_gmul(a0,11)^_gmul(a1,13)^_gmul(a2,9)^_gmul(a3,14);}}ark(Nr);for(var n=Nr-1;n>=1;n--){ish();isub();ark(n);imx();}ish();isub();ark(0);var o=[];for(i=0;i<16;i++)o[i]=s[i%4][(i/4)|0];return o;}
function _aesCbcDecrypt(ct,key,iv){var ks=_keyExp(key),o=[],prev=iv.slice(),off,i;for(off=0;off+16<=ct.length;off+=16){var b=ct.slice(off,off+16),d=_invCipher(b,ks);for(i=0;i<16;i++)o.push(d[i]^prev[i]);prev=b;}var pad=o[o.length-1];if(pad>0&&pad<=16)o=o.slice(0,o.length-pad);return o;}
function _padBytes(s,n){var o=[],i;for(i=0;i<n;i++)o[i]=0;var b=String(s||'');for(i=0;i<b.length&&i<n;i++)o[i]=b.charCodeAt(i)&0xff;return o;}
function _bytesToStr(b){var s='',i=0;while(i<b.length){var c=b[i++];if(c<0x80)s+=String.fromCharCode(c);else if(c<0xE0)s+=String.fromCharCode(((c&0x1f)<<6)|(b[i++]&0x3f));else if(c<0xF0)s+=String.fromCharCode(((c&0x0f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f));else{var cp=((c&0x07)<<18)|((b[i++]&0x3f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f);cp-=0x10000;s+=String.fromCharCode(0xD800+(cp>>10),0xDC00+(cp&0x3FF));}}return s;}
var _B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64ToBytes(b64){var s=String(b64||'').replace(/-/g,'+').replace(/_/g,'/').replace(/[^A-Za-z0-9+/=]/g,'');while(s.length%4)s+='=';var o=[],i,j;for(i=0;i+3<s.length+1;i+=4){var n=0,pad=0;for(j=0;j<4;j++){var ch=s.charAt(i+j),v=(ch==='=')?0:_B64.indexOf(ch);if(ch==='=')pad++;n=(n<<6)|(v<0?0:v);}o.push((n>>16)&255);if(pad<2)o.push((n>>8)&255);if(pad<1)o.push(n&255);}return o;}
function _b64Encode(bin){var o='',i,a,b,c,n;for(i=0;i<bin.length;i+=3){a=bin.charCodeAt(i)&0xff;b=(i+1<bin.length)?(bin.charCodeAt(i+1)&0xff):0;c=(i+2<bin.length)?(bin.charCodeAt(i+2)&0xff):0;n=(a<<16)|(b<<8)|c;o+=_B64[(n>>18)&63]+_B64[(n>>12)&63]+((i+1<bin.length)?_B64[(n>>6)&63]:'=')+((i+2<bin.length)?_B64[n&63]:'=');}return o;}
var MEGA_KEY='i?LMTAx0Q6,:}50U', MEGA_IV="W0;27ToaUpl_P%'c";
function _decryptMegaEnc(enc){try{var ct=_b64ToBytes(enc);if(!ct.length||ct.length%16)return null;var pt=_bytesToStr(_aesCbcDecrypt(ct,_padBytes(MEGA_KEY,32),_padBytes(MEGA_IV,16)));var o=JSON.parse(pt);if(!o)return null;if(o.file)return o.file;var s=o.sources;return s?(s.file||(s[0]&&s[0].file)):null;}catch(e){return null;}}
function _fileFromSources(j){var s=j&&j.sources,f=s?(s.file||(s[0]&&s[0].file)):null;if(f)return f;return j&&j.enc?_decryptMegaEnc(j.enc):null;}
function _decryptVidzee(enc,secret){try{var d=atob?atob(enc):'';var p=d.split(':');if(p.length<2)return null;var iv=_arr(_b64ToBytes(p[0])),ct=_arr(_b64ToBytes(p[1]));if(!ct.length)return null;return _bytesToStr(_aesCbcDecrypt(ct,_padBytes(secret,32),iv));}catch(e){return null;}}

// ── Metadata ────────────────────────────────────────────────────────────
function _parseDetailUrl(v){var s=String(v||'');var m=s.match(/^tmdb:\/\/anime\/kitsu-(\d+)/i);if(m)return{kind:'kitsu',id:m[1]};m=s.match(/^tmdb:\/\/(movie|tv|series)\/([^\/?#]+)/i);if(m){var k=m[1].toLowerCase()==='movie'?'movie':'tv',id=decodeURIComponent(m[2]);if(/^tt\d+$/.test(id))return{kind:k==='movie'?'movie':'series',id:id};if(/^\d+$/.test(id))return{kind:'tmdb',type:k,id:id};}return null;}
function _epUrl(imdb,tmdb,kitsu,anilist,mal,season,episode,title,year){return JSON.stringify({imdbId:imdb||undefined,tmdbId:tmdb||undefined,kitsuId:kitsu||undefined,anilistId:anilist||undefined,malId:mal||undefined,season:season||0,episode:episode||0,title:title||undefined,year:year||undefined});}

async function getDetail(url,opts){
  var p=_parseDetailUrl(url); if(!p)return null;
  if(p.kind==='kitsu'){
    var res=await _fetchText(KITSU_API+'/meta/series/kitsu%3A'+p.id+'.json');
    if(!res)return null;
    var meta;try{meta=JSON.parse(res).meta;}catch(e){return null;}
    if(!meta)return null;
    var hg={};try{hg=JSON.parse(await _fetchText(HAGLUND_API+'/ids?source=kitsu&id='+p.id))||{};}catch(e){}
    var imdb=hg.imdb||null,tmdb=hg.themoviedb||null,anilist=hg.anilist||null,mal=hg.myanimelist||null;
    var title=(meta.aliases&&meta.aliases[0])||meta.name||'Untitled';
    var eps=(meta.videos||[]).map(function(v){return{id:v.season+'x'+v.episode,title:'S'+String(v.season).padStart(2,'0')+'E'+String(v.episode).padStart(2,'0')+' - '+(v.title||''),number:v.episode,season:v.season,url:_epUrl(imdb,tmdb,p.id,anilist,mal,v.season,v.episode,title,_year(meta))};});
    return{id:url,url:url,title:title,cover:meta.poster||null,banner:meta.background||null,description:meta.description||'',type:'anime',sourceId:SOURCE_ID,year:_year(meta),imdbId:imdb,tmdbId:tmdb,kitsuId:p.id,anilistId:anilist,malId:mal,episodes:eps};
  }
  if(p.kind==='movie'||p.kind==='series'){
    var res=await _fetchText(CINEMETA+'/meta/'+(p.kind==='series'?'series':'movie')+'/'+p.id+'.json');
    if(!res)return null;
    var meta;try{meta=JSON.parse(res).meta;}catch(e){return null;}
    if(!meta)return null;
    var isTv=p.kind==='series',title=(meta.aliases&&meta.aliases[0])||meta.name||'Untitled',imdb=meta.imdb_id||p.id,tmdb=meta.moviedb_id||null;
    var eps=isTv?(meta.videos||[]).filter(function(v){return v.season!==0;}).sort(function(a,b){return(a.season-b.season)||(a.episode-b.episode);}).map(function(v){return{id:v.season+'x'+v.episode,title:'S'+String(v.season).padStart(2,'0')+'E'+String(v.episode).padStart(2,'0')+' - '+(v.name||''),number:v.episode,season:v.season,url:_epUrl(imdb,tmdb,null,null,null,v.season,v.episode,title,_year(meta))};}):[{id:'movie',title:title,number:1,url:_epUrl(imdb,tmdb,null,null,null,0,0,title,_year(meta))}];
    return{id:url,url:url,title:title,cover:meta.poster||null,banner:meta.background||null,description:meta.description||'',type:'anime',sourceId:SOURCE_ID,year:_year(meta),imdbId:imdb,tmdbId:tmdb,episodes:eps};
  }
  if(p.kind==='tmdb'){
    var key=_readSetting('tmdbApiKey')||TMDB_KEY;
    var info=await _fetchJson(TMDB_API+'/'+p.type+'/'+p.id+'?api_key='+key+'&append_to_response=external_ids');
    if(!info||info.status_code)return null;
    var isTv=p.type==='tv',title=info.title||info.name||'Untitled',imdb=info.external_ids?info.external_ids.imdb_id:null;
    var eps=[];
    if(isTv&&info.seasons){for(var i=0;i<info.seasons.length;i++){var s=info.seasons[i];if(s.season_number===0)continue;var ed=await _fetchJson(TMDB_API+'/tv/'+p.id+'/season/'+s.season_number+'?api_key='+key);if(ed&&ed.episodes)ed.episodes.forEach(function(ep){eps.push({id:ep.season_number+'x'+ep.episode_number,title:'S'+String(ep.season_number).padStart(2,'0')+'E'+String(ep.episode_number).padStart(2,'0')+' - '+(ep.name||''),number:ep.episode_number,season:ep.season_number,url:_epUrl(imdb,p.id,null,null,null,ep.season_number,ep.episode_number,title,(info.first_air_date||'').slice(0,4))});});}}
    else if(!isTv)eps=[{id:'movie',title:title,number:1,url:_epUrl(imdb,p.id,null,null,null,0,0,title,(info.release_date||'').slice(0,4))}];
    return{id:url,url:url,title:title,cover:info.poster_path?TMDB_IMG+'/w500'+info.poster_path:null,banner:info.backdrop_path?TMDB_IMG+'/w780'+info.backdrop_path:null,description:info.overview||'',type:'anime',sourceId:SOURCE_ID,year:(info.release_date||info.first_air_date||'').slice(0,4)||null,imdbId:imdb,tmdbId:p.id,episodes:eps};
  }
  return null;
}
function getEpisodes(url,opts){return getDetail(url,opts).then(function(d){return d?d.episodes:[];});}
async function search(query,page,opts){
  var q=_trim(query);if(!q)return[];
  var rows=await Promise.all([
    _fetchText(CINEMETA+'/catalog/movie/top/search='+encodeURIComponent(q)+'.json'),
    _fetchText(CINEMETA+'/catalog/series/top/search='+encodeURIComponent(q)+'.json'),
    _fetchText(KITSU_API+'/catalog/anime/kitsu-anime-trending/search='+encodeURIComponent(q)+'.json')
  ]);
  var out=[];
  function add(list,kind){if(!list)return;try{var j=JSON.parse(list);if(!j.metas)return;j.metas.forEach(function(m){if(!m.id)return;var isTv=m.type==='series';var t=(m.aliases&&m.aliases[0])||m.name||'';if(!t)return;var url=kind==='anime'?'tmdb://anime/'+m.id.replace('kitsu:','kitsu-'):'tmdb://'+(isTv?'tv':'movie')+'/'+m.id;out.push({id:url,url:url,title:t,cover:m.poster||null,type:kind==='anime'?'anime':'movie',sourceId:SOURCE_ID});});}catch(e){}}
  add(rows[0],'movie');add(rows[1],'movie');add(rows[2],'anime');
  return out;
}
async function getHome(){return[];}
async function popular(){return[];}
async function _resolveMeta(p){var m={title:p.title||null,year:p.year||null,imdbId:p.imdbId,tmdbId:p.tmdbId};if(!m.title&&m.imdbId){try{var d=await _fetchJson(CINEMETA+'/meta/'+(p.season?'series':'movie')+'/'+m.imdbId+'.json');if(d&&d.meta){m.title=d.meta.name||(d.meta.aliases&&d.meta.aliases[0]);m.year=parseInt(d.meta.releaseInfo||d.meta.year);if(!m.tmdbId&&d.meta.moviedb_id)m.tmdbId=d.meta.moviedb_id;}}catch(e){}}return m;}
function _parseStreamId(raw){var o=raw&&typeof raw==='object'?raw:null;if(!o){try{o=JSON.parse(String(raw||'{}'));}catch(e){o={};}}var season=parseInt(o.season,10);if(isNaN(season)||season<=0)season=null;return{season:season,episode:parseInt(o.episode,10)||0,imdbId:o.imdbId||null,tmdbId:o.tmdbId||null,kitsuId:o.kitsuId||null,anilistId:o.anilistId||null,malId:o.malId||null,title:o.title||null,year:o.year||null};}

// ── AniKoto ─────────────────────────────────────────────────────────────
function _anGet(url,ref,xhr){var h={'User-Agent':UA,'Referer':ref||ANIKOTO_SITE+'/'};if(xhr)h['X-Requested-With']='XMLHttpRequest';return fetch(url,{headers:h}).then(_responseText).catch(function(){return'';});}
function _anJson(url,ref){return _anGet(url,ref).then(function(b){try{return JSON.parse(b||'null');}catch(e){return null;}});}
function _anAjax(path){return _anGet(ANIKOTO_SITE+path,ANIKOTO_SITE+'/',true).then(function(b){try{return JSON.parse(b||'null');}catch(e){return null;}}).catch(function(){return null;});}
function _anParseServers(html){
  var src=String(html||''),out=[],seen={},tagRe=/<\/?([a-z][a-z0-9:-]*)\b([^>]*)>/gi,stack=[],m;
  function attr(a,n){var re=/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,x;while((x=re.exec(a||'')))if(x[1].toLowerCase()===n.toLowerCase())return x[2]!==undefined?x[2]:x[3];return'';}
  function vis(r){return String(r||'').replace(/<script\b[\s\S]*?<\/script>/gi,'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();}
  while((m=tagRe.exec(src))){
    var full=m[0],tag=m[1].toLowerCase(),attrs=m[2]||'';
    if(full.charAt(1)==='/'){for(var i=stack.length-1;i>=0;i--)if(stack[i].tag===tag){stack.length=i;break;}continue;}
    if(tag==='li'){
      var cr=/<\/li\s*>/ig;cr.lastIndex=tagRe.lastIndex;var cl=cr.exec(src);
      var inner=cl?src.slice(tagRe.lastIndex,cl.index):'';
      var id=attr(attrs,'data-link-id')||attr(inner,'data-link-id');
      if(id&&!/download-icon/i.test(attrs+' '+inner)){
        var type=attr(attrs,'data-type');
        if(!type)for(var j=stack.length-1;j>=0;j--){type=attr(stack[j].attrs,'data-type')||attr(stack[j].attrs,'type');if(type)break;}
        if(!type){var b4=src.slice(0,m.index),tr=/(?:data-type|type)\s*=\s*["'](sub|hsub|dub)["']/gi,tm,last='';while((tm=tr.exec(b4)))last=tm[1];type=last||'sub';}
        type=String(type).toLowerCase();if(type!=='sub'&&type!=='hsub'&&type!=='dub')type=/dub/i.test(type)?'dub':'sub';
        var name=vis(inner),k=type+'|'+id+'|'+name;
        if(!seen[k]){seen[k]=1;out.push({type:type,linkId:id,name:name||('S'+id)});}
      }
    }
    if(!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)&&!/\/\s*>$/.test(full))stack.push({tag:tag,attrs:attrs});
  }
  return out;
}
function _anSourcesUrl(base,id,type){var p=/(?:megaplay|vidwish|megaplays)\.[a-z]+/i.test(String(base||''))?'/stream/getSourcesNew':'/stream/getSources';return base+p+'?id='+id+'&type='+type;}
function _anExtractPlayer(embed,cat,name){
  var base=(embed.match(/^(https?:\/\/[^/]+)/)||[])[1]||'https://vidtube.site';
  var type=(embed.match(/\/(sub|hsub|dub)\/?(?:[?#]|$)/i)||[])[1]||cat;
  return _anGet(embed,ANIKOTO_SITE+'/').then(function(h){
    var id=(h.match(/data-id="(\d+)"/)||[])[1];if(!id)throw new Error('no embed id');
    return fetch(_anSourcesUrl(base,id,type),{headers:{'User-Agent':UA,'Referer':embed,'X-Requested-With':'XMLHttpRequest'}}).then(async function(r){
      var body=await _responseText(r);
      var j;try{j=JSON.parse(body||'null');}catch(e){throw new Error('bad getSources');}
      var file=_fileFromSources(j);if(!file)throw new Error('no stream file');
      var subs=[];((j&&j.tracks)||[]).forEach(function(t){if(t&&t.file&&(!t.kind||t.kind==='captions'||t.kind==='subtitles'))subs.push({url:t.file,lang:t.label||'Sub',format:/\.srt(\?|$)/i.test(t.file)?'srt':'vtt'});});
      var hdrs={'User-Agent':UA,'Referer':base+'/','Origin':base};
      return[{url:file+'#mew-'+_slug(name||'server')+'-'+cat,label:(name||'AniKoto')+' · '+cat,quality:'auto',container:/\.m3u8(\?|$)/i.test(file)?'hls':'mp4',headers:hdrs,kind:cat,audioLang:cat==='dub'?'en':'ja',subtitles:subs}];
    });
  });
}
function _anResolveServer(sv,cat){
  var sc=sv.type==='dub'?'dub':(sv.type==='hsub'?'hsub':'sub');
  return _anAjax('/ajax/server?get='+encodeURIComponent(sv.linkId)).then(function(j){
    var u=j&&j.result&&(typeof j.result==='object'?j.result.url:null);
    if(!u||!/^https?:\/\//i.test(u))return[];
    if(/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(u))return[{url:u,label:(sv.name||'AniKoto')+' · '+sc,quality:'auto',container:'hls',headers:{'User-Agent':UA,'Referer':ANIKOTO_SITE+'/'},kind:sc}];
    return _anExtractPlayer(u,sc,sv.name).catch(function(){return[];});
  }).catch(function(){return[];});
}
function _anTryAll(list,cat){return Promise.all((list||[]).map(function(s){return _anResolveServer(s,cat);})).then(function(groups){var o=[];groups.forEach(function(g){o=o.concat(g);});return o;});}
function _anMapperAll(token,cat){
  if(!token)return Promise.resolve([]);
  return _anJson(ANIKOTO_MAPPER+token,ANIKOTO_SITE+'/').then(function(j){
    var ex=[];for(var n in(j||{})){var e=j[n];if(n==='status'||!e||typeof e!=='object')continue;var b=e[cat];if(b&&b.url)ex.push({type:cat,linkId:String(b.url),name:n});}
    return _anTryAll(ex,cat);
  }).catch(function(){return[];});
}
function _anVideoSources(epUrl){
  var raw=String(epUrl).replace('anikoto://',''),parts=raw.split('/');
  var cat=parts[0]==='dub'?'dub':'sub',sids=parts[1]?decodeURIComponent(parts[1]):'';
  var token=(parts[4]&&parts[5]&&parts[6])?(parts[4]+'/'+parts[5]+'/'+parts[6]):null;
  if(!sids)return Promise.reject(new Error('no server ids'));
  return _anAjax('/ajax/server/list?servers='+encodeURIComponent(sids)).then(function(j){
    var lh=j&&typeof j.result==='string'?j.result:'';
    var servers=_anParseServers(lh);
    return Promise.all([_anTryAll(servers,cat),_anMapperAll(token,cat)]).then(function(r){
      var all=r[0].concat(r[1]).filter(function(s){return s&&s.url;});
      if(all.length)return all;throw new Error('no playable server');
    });
  }).catch(function(err){return _anMapperAll(token,cat).then(function(x){if(x.length)return x;throw err;});});
}
async function _anSearchSlug(title){var q=_trim(title);if(!q)return null;var h=await _anGet(ANIKOTO_SITE+'/filter?keyword='+encodeURIComponent(q),ANIKOTO_SITE+'/');var m=h.match(/href="([^"]*\/watch\/[^"]+)"/);if(!m)return null;var s=m[1].match(/\/watch\/([^/"?#]+)/);return s?s[1]:null;}
async function _anEpisodes(slug){
  var h=await _anGet(ANIKOTO_SITE+'/watch/'+encodeURIComponent(slug),ANIKOTO_SITE+'/');
  var id=(h.match(/data-id="(\d+)"/)||[])[1];if(!id)return[];
  var j=await _anAjax('/ajax/episode/list/'+id);
  var lh=j&&typeof j.result==='string'?j.result:'';
  var eps=[],re=/<a\b([^>]*\bdata-id="\d+"[^>]*)>/g,m;
  while((m=re.exec(lh))){
    var a=m[1],sids=(a.match(/data-ids="([^"]+)"/)||[])[1];if(!sids)continue;
    var num=parseInt((a.match(/data-num="(\d+)"/)||[])[1]||'0',10);
    var sub=(a.match(/data-sub="(\d+)"/)||[])[1]==='1',dub=(a.match(/data-dub="(\d+)"/)||[])[1]==='1';
    if(!sub&&!dub)continue;
    var em=(a.match(/data-mal="(\d+)"/)||[])[1],es=(a.match(/data-slug="([^"]+)"/)||[])[1],et=(a.match(/data-timestamp="(\d+)"/)||[])[1];
    var tok=(em&&es&&et)?(em+'/'+encodeURIComponent(es)+'/'+et):null;
    eps.push({number:num,sub:sub,dub:dub,url:'anikoto://'+(dub?'dub':'sub')+'/'+encodeURIComponent(sids)+'/'+(sub?1:0)+(dub?1:0)+'/'+num+(tok?'/'+tok:'')});
  }
  return eps;
}
async function getAnikoto(title,season,episode,subCb){
  try{
    var slug=await _anSearchSlug(title);if(!slug)return[];
    var eps=await _anEpisodes(slug);if(!eps.length)return[];
    var tn=episode||1,f=eps.filter(function(e){return e.number===tn;})[0];
    if(!f&&(season===1||season==null))f=eps.reduce(function(p,c){return Math.abs(c.number-tn)<Math.abs(p.number-tn)?c:p;},eps[0]);
    if(!f)return[];
    var st=await _anVideoSources(f.url);
    st.forEach(function(s){(s.subtitles||[]).forEach(function(x){if(x.url)subCb({url:x.url,lang:x.lang||'Sub'});});});
    return st;
  }catch(e){console.log('Mewstream: AniKoto failed: '+(e&&e.message||e));return[];}
}

// ── MegaPlay (megaplays.se) ─────────────────────────────────────────────
function _mpGet(url,ref,xhr){var h={'User-Agent':UA,'Referer':ref||ANIKOTO_SITE+'/'};if(xhr)h['X-Requested-With']='XMLHttpRequest';return fetch(url,{headers:h,timeoutMs:20000}).then(_responseText).catch(function(){return'';});}
function _mpJson(url,ref){return _mpGet(url,ref).then(function(b){try{return JSON.parse(b||'null');}catch(e){return null;}});}
async function _mpSearchSlug(title){var q=_trim(title);if(!q)return null;var h=await _mpGet(ANIKOTO_SITE+'/filter?keyword='+encodeURIComponent(q),ANIKOTO_SITE+'/');var m=h.match(/href="([^"]*\/watch\/[^"]+)"/);if(!m)return null;var s=m[1].match(/\/watch\/([^/"?#]+)/);return s?s[1]:null;}
async function _mpEpisodes(slug){
  var page=ANIKOTO_SITE+'/watch/'+encodeURIComponent(slug);
  var h=await _mpGet(page,ANIKOTO_SITE+'/');
  var id=(h.match(/data-id="(\d+)"/i)||[])[1];if(!id)return[];
  var j=await _mpJson(ANIKOTO_SITE+'/ajax/episode/list/'+id,page);
  var lh=j&&(j.result||j.html||j.data)||'';
  var out=[],seen={},re=/<a\b([^>]*\bdata-id=["'](\d+)["'][^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(String(lh)))){
    var attrs=m[1],eid=m[2],label=_text(m[3])||('Episode '+eid);
    var sids=(attrs.match(/data-ids=["']([^"']+)/i)||[])[1]||'';
    var num=(attrs.match(/data-num=["']([^"']+)/i)||[])[1]||String(out.length+1);
    var sub=/data-sub=["'](?:1|true|yes)/i.test(attrs),dub=/data-dub=["'](?:1|true|yes)/i.test(attrs);
    if(!sub&&!dub)sub=true;
    ['sub','dub'].forEach(function(lang){
      if((lang==='sub'&&!sub)||(lang==='dub'&&!dub))return;
      var k=eid+'/'+lang;if(seen[k])return;seen[k]=1;
      out.push({number:Number(num)||null,lang:lang,label:label+(lang==='dub'?' (Dub)':' (Sub)'),url:'megaplay://'+encodeURIComponent(eid)+'/'+lang+'/'+encodeURIComponent(num)+'/'+encodeURIComponent(sids)});
    });
  }
  return out;
}
function _mpVideoSources(epUrl){
  var raw=String(epUrl).replace('megaplay://',''),parts=raw.split('/');
  var eid=decodeURIComponent(parts[0]||''),lang=parts[1]==='dub'?'dub':'sub',sids=decodeURIComponent(parts[3]||'');
  if(!sids)return Promise.reject(new Error('no server ids'));
  return _mpGet(ANIKOTO_SITE+'/ajax/server/list?servers='+encodeURIComponent(sids),ANIKOTO_SITE+'/',true).then(function(b){
    var j;try{j=JSON.parse(b||'null');}catch(e){j=null;}
    var lh=j&&j.result||'';var servers=_anParseServers(typeof lh==='string'?lh:'');
    return Promise.all(servers.map(function(sv){
      var cat=sv.type==='dub'?'dub':'sub';
      return _mpGet(ANIKOTO_SITE+'/ajax/server?get='+encodeURIComponent(sv.linkId),ANIKOTO_SITE+'/',true).then(function(bb){
        var jj;try{jj=JSON.parse(bb||'null');}catch(e){jj=null;}
        var u=jj&&jj.result&&(typeof jj.result==='object'?jj.result.url:null);
        if(!u||!/^https?:\/\//i.test(u))return[];
        var base=(u.match(/^(https?:\/\/[^/]+)/)||[])[1]||MEGAPLAY_BASE;
        var type=(u.match(/\/(sub|hsub|dub)\/?(?:[?#]|$)/i)||[])[1]||cat;
        return _mpGet(u,ANIKOTO_SITE+'/').then(function(page){
          var did=(page.match(/data-id="(\d+)"/)||[])[1];if(!did)return[];
          var su=_anSourcesUrl(base,did,type);
          return _mpGet(su,u,true).then(function(sb){
            var sj;try{sj=JSON.parse(sb||'null');}catch(e){return[];}
            var file=_fileFromSources(sj);if(!file)return[];
            var subs=[];((sj&&sj.tracks)||[]).forEach(function(t){if(t&&t.file&&(!t.kind||t.kind==='captions'||t.kind==='subtitles'))subs.push({url:t.file,lang:t.label||'Sub'});});
            return[{url:file+'#mew-mp-'+_slug(sv.name||'server')+'-'+cat,label:(sv.name||'MegaPlay')+' · '+cat,quality:'auto',container:'hls',headers:{'User-Agent':UA,'Referer':base+'/','Origin':base},kind:cat,subtitles:subs}];
          });
        });
      }).catch(function(){return[];});
    })).then(function(g){var o=[];g.forEach(function(x){o=o.concat(x);});return o;});
  }).catch(function(){return[];});
}
async function getMegaplay(title,season,episode,subCb){
  try{
    var slug=await _mpSearchSlug(title);if(!slug)return[];
    var eps=await _mpEpisodes(slug);if(!eps.length)return[];
    var tn=episode||1,f=eps.filter(function(e){return e.number===tn&&e.lang==='sub';})[0]||eps.filter(function(e){return e.number===tn;})[0];
    if(!f&&(season===1||season==null))f=eps.reduce(function(p,c){return Math.abs(c.number-tn)<Math.abs(p.number-tn)?c:p;},eps[0]);
    if(!f)return[];
    var st=await _mpVideoSources(f.url);
    st.forEach(function(s){(s.subtitles||[]).forEach(function(x){if(x.url)subCb({url:x.url,lang:x.lang||'Sub'});});});
    return st;
  }catch(e){console.log('Mewstream: MegaPlay failed: '+(e&&e.message||e));return[];}
}

// ── AnimeSalt (animesalt.to) ────────────────────────────────────────────
var _VRF_KEY='ysJhV6U27FVIjjuk',_VRF_SHIFTS=[-3,3,-4,2,-2,5,4,5];
function _rc4(key,data){var n=[],r=0,u,i,t;for(i=0;i<256;i++)n[i]=i;for(u=0;u<256;u++){r=(r+n[u]+key.charCodeAt(u%key.length))%256;t=n[u];n[u]=n[r];n[r]=t;}u=0;r=0;var o=[];for(i=0;i<data.length;i++){u=(u+1)%256;r=(r+n[u])%256;t=n[u];n[u]=n[r];n[r]=t;o.push(String.fromCharCode((data.charCodeAt(i)&0xff)^n[(n[u]+n[r])%256]));}return o.join('');}
function _rot13(s){return String(s).replace(/[A-Za-z]/g,function(c){var o=c.charCodeAt(0);if(o>=65&&o<=90)return String.fromCharCode(((o-65+13)%26)+65);return String.fromCharCode(((o-97+13)%26)+97);});}
function _vrf(id){var b1=_b64Encode(_rc4(_VRF_KEY,String(id))),sh='',i;for(i=0;i<b1.length;i++)sh+=String.fromCharCode(b1.charCodeAt(i)+_VRF_SHIFTS[i%8]);return _rot13(_b64Encode(sh));}
function _asGet(url,ref,xhr){var h={'User-Agent':UA,'Referer':ref||ANIMESALT_SITE+'/'};if(xhr)h['X-Requested-With']='XMLHttpRequest';return fetch(url,{headers:h}).then(_responseText).catch(function(){return'';});}
function _asJson(url,ref){return _asGet(url,ref).then(function(b){try{return JSON.parse(b||'null');}catch(e){return null;}});}
async function _asSearchSlug(title){var q=_trim(title);if(!q)return null;var h=await _asGet(ANIMESALT_SITE+'/filter?keyword='+encodeURIComponent(q),ANIMESALT_SITE+'/');var m=h.match(/href="([^"]*\/(?:anime|watch)\/[^"]+)"/);if(!m)return null;var s=m[1].match(/\/(?:anime|watch)\/([^/"?#]+)/);return s?s[1]:null;}
async function _asEpisodes(slug){
  var page=ANIMESALT_SITE+'/anime/'+encodeURIComponent(slug);
  var h=await _asGet(page,ANIMESALT_SITE+'/');
  var id=(h.match(/data-id="(\d+)"/)||[])[1];if(!id)return[];
  var j=await _asJson(ANIMESALT_SITE+'/ajax/episode/list/?vrf='+encodeURIComponent(_vrf(id))+'&id='+id,page);
  var lh=j&&(j.result||j.html)||'';
  var eps=[],re=/<a\b([^>]*\bdata-id="\d+"[^>]*)>/g,m;
  while((m=re.exec(String(lh)))){
    var a=m[1],sids=(a.match(/data-ids="([^"]+)"/)||[])[1];if(!sids)continue;
    var num=parseInt((a.match(/data-num="(\d+)"/)||[])[1]||'0',10);
    var sub=(a.match(/data-sub="(\d+)"/)||[])[1]==='1',dub=(a.match(/data-dub="(\d+)"/)||[])[1]==='1';
    if(!sub&&!dub)continue;
    eps.push({number:num,sub:sub,dub:dub,url:'animesalt://'+(dub?'dub':'sub')+'/'+encodeURIComponent(sids)+'/'+num});
  }
  return eps;
}
function _asVideoSources(epUrl){
  var raw=String(epUrl).replace('animesalt://',''),parts=raw.split('/');
  var cat=parts[0]==='dub'?'dub':'sub',sids=decodeURIComponent(parts[1]||'');
  if(!sids)return Promise.reject(new Error('no server ids'));
  return _asGet(ANIMESALT_SITE+'/ajax/server/list?servers='+encodeURIComponent(sids),ANIMESALT_SITE+'/',true).then(function(b){
    var j;try{j=JSON.parse(b||'null');}catch(e){j=null;}
    var lh=j&&j.result||'';var servers=_anParseServers(typeof lh==='string'?lh:'');
    return Promise.all(servers.map(function(sv){
      var sc=sv.type==='dub'?'dub':'sub';
      return _asGet(ANIMESALT_SITE+'/ajax/server?get='+encodeURIComponent(sv.linkId),ANIMESALT_SITE+'/',true).then(function(bb){
        var jj;try{jj=JSON.parse(bb||'null');}catch(e){jj=null;}
        var u=jj&&jj.result&&(typeof jj.result==='object'?jj.result.url:null);
        if(!u||!/^https?:\/\//i.test(u))return[];
        return _anExtractPlayer(u,sc,sv.name).catch(function(){return[];});
      }).catch(function(){return[];});
    })).then(function(g){var o=[];g.forEach(function(x){o=o.concat(x);});return o;});
  }).catch(function(){return[];});
}
async function getAnimesalt(title,season,episode,subCb){
  try{
    var slug=await _asSearchSlug(title);if(!slug)return[];
    var eps=await _asEpisodes(slug);if(!eps.length)return[];
    var tn=episode||1,f=eps.filter(function(e){return e.number===tn;})[0];
    if(!f&&(season===1||season==null))f=eps.reduce(function(p,c){return Math.abs(c.number-tn)<Math.abs(p.number-tn)?c:p;},eps[0]);
    if(!f)return[];
    var st=await _asVideoSources(f.url);
    st.forEach(function(s){(s.subtitles||[]).forEach(function(x){if(x.url)subCb({url:x.url,lang:x.lang||'Sub'});});});
    return st;
  }catch(e){console.log('Mewstream: AnimeSalt failed: '+(e&&e.message||e));return[];}
}
// ── RareAnimes (StreamBeta) ─────────────────────────────────────────────
var RA_UA=UA,RA_FAMILY=/(^|\.)(codedew\.com|hubcloud\.[a-z]+|dlbeta\.[a-z]+|streambeta\.[a-z]+)$/i;
var RA_REL_PATH=/streambeta|zipper|multiquality|hubcloud|dlbeta|filepress/i,RA_REL_LABEL=/watch\s*now|stream|play|hubcloud|multiquality|download/i;
function _raFailed(r){return!r||r.ok===false||(typeof r.status==='number'&&r.status>=400);}
function _raBody(r){if(r&&typeof r.body==='string')return Promise.resolve(r.body);if(r&&typeof r.text==='function')return r.text();return Promise.resolve('');}
function _raGet(url,ref){return fetch(url,{headers:{'User-Agent':RA_UA,'Accept':'text/html,application/xhtml+xml,application/json,*/*;q=0.8','Referer':ref||RA_SITE+'/'}}).then(function(r){if(_raFailed(r))throw new Error('HTTP '+(r&&r.status)+' '+url);return _raBody(r);}).then(function(b){if(b.length<60000&&/<title>\s*Just a moment|cf-browser-verification|challenge-platform|cf_chl_opt/i.test(b))throw new Error('Cloudflare at '+url);return b;});}
function _raDecode(s){return String(s==null?'':s).replace(/&#x([0-9a-f]+);/gi,function(_,n){return String.fromCharCode(parseInt(n,16));}).replace(/&#(\d+);/g,function(_,n){return String.fromCharCode(parseInt(n,10));}).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ');}
function _raStrip(s){return _raDecode(String(s||'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();}
function _raAbs(u,b){u=_raDecode(String(u||''));if(/^https?:\/\//i.test(u))return u;if(/^\/\//.test(u))return'https:'+u;return(b||RA_SITE).replace(/\/+$/,'')+(u.charAt(0)==='/'?'':'/')+u;}
function _raClean(s){s=_raStrip(s).replace(/\s+/g,' ').trim();s=s.replace(/\s*[-–|]?\s*\b(?:Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|Dual Audio|Multi Audio|All Episodes|Episodes?|Download|HD|Watch Online|Complete)\b[\s\S]*$/i,'');return s.replace(/[\s\-–|:,(]+$/,'').trim()||'Untitled';}
function _raHost(u){return((String(u).match(/^https?:\/\/([^\/:?#]+)/i)||[])[1]||'').toLowerCase();}
function _raOrigin(u){return(String(u).match(/^(https?:\/\/[^\/?#]+)/i)||[])[1]||'';}
function _raListing(html){html=String(html||'');var out=[],seen={},re=/<article\b([^>]*)>([\s\S]*?)<\/article>/gi,m;while((m=re.exec(html))){var body=m[2];var a=body.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/i)||body.match(/<a\b[^>]*title=["']([^"']+)["'][^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/i);var href='',title='';if(a){if(/^https?:\/\//i.test(a[1])){href=a[1];title=a[2]||'';}else{title=a[1]||'';href=a[2]||'';}}if(!href){var h=body.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/i);href=h?h[1]:'';}if(!title)title=_raStrip((body.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)||[])[1]||'');if(!href||!title||seen[href])continue;seen[href]=1;out.push({url:href,title:_raClean(title)});}return out;}
function _raPostLines(c){var html=String(c||'').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi,'');var links=[];html=html.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,function(all,url,label){var raw=_raDecode(url).trim(),text=_raStrip(label),full='';if(/^https?:\/\//i.test(raw)){if(RA_FAMILY.test(_raHost(raw)))full=raw;}else if(/^\/\//.test(raw)){var p='https:'+raw;if(RA_FAMILY.test(_raHost(p)))full=p;}else if(raw.charAt(0)==='/'&&(RA_REL_PATH.test(raw)||RA_REL_LABEL.test(text)))full='https://codedew.com'+raw;if(!full)return all;links.push({url:full,label:text});return' __RAI_'+ (links.length-1)+'__ ';});html=html.replace(/<(?:p|h[1-6]|hr|br|div|li|tr)\b[^>]*>/gi,'\n');return html.split(/\n/).map(function(l){var t=[];l=l.replace(/__RAI_(\d+)__/g,function(_,n){if(links[+n])t.push(links[+n]);return'';});return{text:_raStrip(l),links:t};}).filter(function(x){return x.text||x.links.length;});}
function _raVariant(t){var s=String(t||'').replace(/^\s*(?:episode|ep\.?)\s*\d+\s*[-–:]\s*/i,'');s=s.split(/\s[-–]\s|[-–]\s*$/)[0].replace(/[\[\]]/g,'').trim();var m=s.match(/\b(Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|English|Japanese)\b[\s\S]*$/i);if(m)return m[0].slice(0,48);if(/^untouched\b/i.test(s))return s.slice(0,48);return'';}
function _raEpisodes(c){var lines=_raPostLines(c),eps=[],cur=null,nl=1,pl='';function ens(n,t){var f=eps.filter(function(e){return e.number===n;})[0];if(f){if(t&&(!f.title||/^Episode \d+$/i.test(f.title)))f.title=t;return f;}f={number:n,title:t||('Episode '+n),variants:[]};eps.push(f);return f;}lines.forEach(function(l){var h=l.text.match(/^(?:episode|ep\.?)\s*0*(\d{1,4})\b\s*(?:[-–:]\s*(.*))?$/i);if(h){cur=ens(+h[1],(h[2]||'').trim());pl='';}else if(l.text){var d=_raVariant(l.text);if(d)pl=d;}if(l.links.length){if(!cur){cur=ens(nl,'Episode '+nl);nl++;}var lang=_raVariant(l.text)||pl||(/^episode\s+\d+$/i.test(cur.title)?'Default':cur.title)||'Default';var us=l.links.filter(function(x){return/watchnow|watch\b|hubcloud/i.test(x.label);});if(!us.length)us=l.links.filter(function(x){return/streambeta|multiquality|dlbeta|filepress|download|play/i.test(x.label);});if(!us.length)us=l.links;if(!us.length)return;var pr=us.filter(function(x){return/watchnow|watch\b/i.test(x.label);})[0]||us.filter(function(x){return/hubcloud/i.test(x.label);})[0]||us[0];var ord=[pr].concat(us.filter(function(x){return x!==pr;}));l.links.forEach(function(x){if(ord.indexOf(x)<0)ord.push(x);});var urls=ord.map(function(x){return x.url;}).slice(0,6);var key=lang.toLowerCase(),v=cur.variants.filter(function(x){return x.lang.toLowerCase()===key;})[0];if(!v){v={lang:lang,url:pr.url,alts:urls};cur.variants.push(v);}else{urls.forEach(function(u){if(v.alts.indexOf(u)<0&&v.alts.length<8)v.alts.push(u);});}pl='';}});return eps.sort(function(a,b){return a.number-b.number;}).map(function(e){return{number:e.number,title:e.title,url:'rare://'+encodeURIComponent(JSON.stringify({variants:e.variants}))};});}
function _raDetail(pageUrl){return _raGet(pageUrl).then(function(html){var title=_raStrip((html.match(/<h1\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||'');var a=html.indexOf('<div class="entry-content'),b=a>=0?html.indexOf('</article>',a):-1;var content=a>=0?html.slice(a,b>a?b:undefined):html;var eps=_raEpisodes(content);return{title:_raClean(title)||title,url:pageUrl,episodes:eps};});}
function _raBal(s,o,c){var st=s.indexOf(o);if(st<0)return'';var d=0,q='',e=false;for(var i=st;i<s.length;i++){var ch=s.charAt(i);if(q){if(e)e=false;else if(ch==='\\')e=true;else if(ch===q)q='';continue;}if(ch==='"'||ch==="'"){q=ch;continue;}if(ch===o)d++;if(ch===c&&--d===0)return s.slice(st,i+1);}return'';}
function _raRhs(rhs){rhs=String(rhs).replace(/^\s+/,'');var W=/^(?:window\s*\.\s*)?(?:JSON\s*\.\s*parse|atob|base64_decode|decodeURIComponent|escape|unescape)\s*\(\s*/i;for(var g=0;g<6&&W.test(rhs);g++)rhs=rhs.replace(W,'');var c=rhs.charAt(0);if(c==='[')return _raMaybe(_raBal(rhs,'[',']'));if(c==='{')return _raMaybe(_raBal(rhs,'{','}'));return[];}
function _raMaybe(s,d){s=String(s||'').trim();d=d||0;if(!s)return[];try{var j=JSON.parse(s),a=Array.isArray(j)?j:(j.sources||j.playerSources||j.data||j.links||j.streams||[]);if(Array.isArray(a)&&a.length)return a;}catch(e){}var b=_raBal(s,'[',']');if(b&&b!==s){try{var j2=JSON.parse(b),a2=Array.isArray(j2)?j2:(j2.sources||[]);if(a2.length)return a2;}catch(e){}}return[];}
function _raSources(html){var h=String(html||''),m,re=/playerSources\s*[:=]\s*/gi,n=0;while((m=re.exec(h))&&n++<6){var a=_raRhs(h.slice(m.index+m[0].length,m.index+m[0].length+400000));if(a.length)return _raNorm(a);}var flat=h.replace(/\\u0026/g,'&').replace(/\\\//g,'/'),seen={},list=[];function push(u){u=_raDecode(u);if(!/^(?:https?:)?\/\//i.test(u)||seen[u])return;seen[u]=1;list.push({stream_url:u,name:'Server'});}re=/["']?(?:stream_url|streamUrl|file|src|url|source)["']?\s*[:=]\s*["']((?:https?:)?\/\/[^"'\s]+?\.(?:m3u8|mp4)(?:\?[^"'\s]*)?)["']/gi;while((m=re.exec(flat)))push(m[1]);re=/https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/gi;while((m=re.exec(flat)))push(m[0]);return _raNorm(list);}
function _raNorm(l){var o=[];(l||[]).forEach(function(s){if(typeof s==='string')s={stream_url:s};if(!s||typeof s!=='object')return;var u=s.stream_url||s.file||s.url||s.src||'';if(!u)return;o.push({stream_url:String(u),name:String(s.name||s.label||'Server')});});return o;}
function _raParsePlayer(html){var h=String(html||''),src=_raSources(h),fid=(h.match(/maskedFileId\s*[=:]\s*["']([^"']+)["']/i)||[])[1]||'',vars=[],seen={},m,re=/<[^>]*\blang-btn\b[^>]*>/gi;while((m=re.exec(h))){var f=(m[0].match(/data-fid=["']([^"']+)["']/i)||[])[1];var l=(m[0].match(/data-lang=["']([^"']+)["']/i)||[])[1];if(f&&!seen[f]){seen[f]=1;vars.push({fid:f,lang:_raStrip(l||'')});}}return{sources:src,fid:fid,variants:vars};}
function _raFids(fid){var v=String(fid||'').trim();if(!v)return[];if(/^https?:\/\//i.test(v))return[v];var p=/^sb_/i.test(v)?'v':'url';return[RA_SB+'?'+p+'='+encodeURIComponent(v),RA_SB+'?'+(p==='v'?'url':'v')+'='+encodeURIComponent(v)];}
function _raSbUrl(u,b){u=_raDecode(String(u||'')).replace(/\\\//g,'/').trim();if(/^\/\//.test(u))u='https:'+u;else if(u.charAt(0)==='/')u=(b?_raOrigin(b):'https://codedew.com')+u;if(!/^https?:\/\//i.test(u))return'';return RA_FAMILY.test(_raHost(u))?u:'';}
function _raFollow(html,target,ctx){var raws=[],m,re;re=/<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url=([^"']+)["']/gi;while((m=re.exec(html)))raws.push(m[1]);re=/(?:location(?:\.href)?\s*=|location\.(?:replace|assign)\s*\(|window\.open\s*\()\s*["']([^"']+)["']/gi;while((m=re.exec(html)))raws.push(m[1]);re=/(?:data-href|data-src|data-url|href|src|content)=["']([^"']+)["']/gi;while((m=re.exec(html)))raws.push(m[1]);var out=[],dup={};raws.forEach(function(r){r=_raDecode(r).trim();if(!/^(?:https?:)?\/\//i.test(r)&&r.charAt(0)!=='/')return;if(/\.(?:css|js|png|jpe?g|gif|svg|ico|woff2?)(?:[?#]|$)/i.test(r))return;var n=_raSbUrl(r,target);if(!n||n===target||ctx.seen[n]||dup[n])return;dup[n]=1;out.push(n);});return out;}
function _raResolve(url,depth,ctx,ref){var t=_raSbUrl(url);depth=depth||0;if(!t)return Promise.reject(new Error('bad player URL'));if(depth>4||ctx.seen[t]||ctx.fetches>=10)return Promise.reject(new Error('loop/limit'));ctx.seen[t]=1;ctx.fetches++;return _raGet(t,ref||RA_SITE+'/').then(function(h){var p=_raParsePlayer(h);if(p.sources.length)return{parsed:p,url:t};var cs=_raFollow(h,t,ctx),i=0,le=null;function next(){if(i>=cs.length)return Promise.reject(le||new Error('no stream at '+t));var c=cs[i++];return _raResolve(c,depth+1,ctx,t).catch(function(e){le=e;return next();});}return next();});}
function _raFirst(urls,errs,ref){var i=0;function next(){if(i>=urls.length)return Promise.resolve(null);var u=urls[i++];return _raResolve(u,0,{seen:{},fetches:0},ref).then(null,function(e){errs.push(e&&e.message||String(e));return next();});}return next();}
function _raFix(u,b){u=_raDecode(String(u||'')).replace(/\\u0026/g,'&').replace(/\\\//g,'/').trim();if(/^\/\//.test(u))return'https:'+u;if(/^https?:\/\//i.test(u))return u;if(u.charAt(0)==='/'&&b)return _raOrigin(b)+u;return'';}
function _raToSources(r,lang){var out=[];r.parsed.sources.forEach(function(s){var u=_raFix(s.stream_url,r.url);if(!u)return;out.push({url:u,quality:/2160p|4k/i.test(u+s.name)?'2160p':(/1080p/i.test(u+s.name)?'1080p':(/720p/i.test(u+s.name)?'720p':'auto')),label:lang+' · '+s.name,container:/\.m3u8(?:[?#]|$)/i.test(u)?'hls':'mp4',headers:{'User-Agent':UA,'Referer':r.url,'Origin':_raOrigin(r.url)}});});return out;}
function _raVideoSources(epUrl){var raw=String(epUrl).replace('rare://',''),p;try{p=JSON.parse(decodeURIComponent(raw));}catch(e){return Promise.resolve([]);}var vs=p.variants||[];if(!vs.length)return Promise.resolve([]);var errs=[];return Promise.all(vs.map(function(v){var urls=[v.url].concat(v.alts||[]);return _raFirst(urls,errs).then(function(r){return r?_raToSources(r,v.lang||'Auto'):[];});})).then(function(g){var o=[];g.forEach(function(x){o=o.concat(x);});if(!o.length)throw new Error('RareAnimes: no direct sources. '+(errs.slice(0,5).join(' | ')||'no player links'));return o;});}
async function getRareanimes(title,season,episode,subCb){
  try{
    var q=_trim(title);if(!q)return[];
    var sh=await _raGet(RA_SITE+'/?s='+encodeURIComponent(q).replace(/%20/g,'+'));
    var rs=_raListing(sh);if(!rs.length)return[];
    var det=await _raDetail(rs[0].url);if(!det.episodes.length)return[];
    var tn=episode||1,t=det.episodes.filter(function(e){return e.number===tn;})[0];
    if(!t)t=det.episodes.reduce(function(p,c){return Math.abs(c.number-tn)<Math.abs(p.number-tn)?c:p;},det.episodes[0]);
    if(!t)return[];
    var st=await _raVideoSources(t.url);
    st.forEach(function(s){(s.subtitles||[]).forEach(function(x){if(x.url)subCb({url:x.url,lang:x.lang||'Sub'});});});
    return st;
  }catch(e){console.log('Mewstream: RareAnimes failed: '+(e&&e.message||e));return[];}
}

// ── Showbox (showbox.media + febbox.com) ───────────────────────────────
async function getShowbox(imdbId,season,episode,subCb){
  var token=_readSetting('showboxToken');
  if(!imdbId||!token)return[];
  var hdrs={'User-Agent':UA,'Accept':'application/json, text/html, */*'};
  try{
    var sh=await _fetchText(SHOWBOX+'/search?keyword='+imdbId,{headers:hdrs});
    var hm=sh.match(/class="film-name[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"/)||sh.match(/<a[^>]+href="([^"]+)"[^>]*class="[^"]*film-name[^"]*"/);
    if(!hm)return[];
    var dh=await _fetchText(_fixUrl(hm[1],SHOWBOX),{headers:hdrs});
    var im=dh.match(/class="heading-name[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"/);
    if(!im)return[];
    var mid=parseInt(im[1].split('/').pop());if(!mid)return[];
    var type=season!=null?2:1;
    var sj=await _fetchJson(SHOWBOX+'/index/share_link?id='+mid+'&type='+type,{headers:hdrs});
    if(!sj||!sj.data||!sj.data.link)return[];
    var sk=sj.data.link.split('/').pop();
    var fj=await _fetchJson(FEBBOX+'/file/file_share_list?share_key='+sk,{headers:hdrs});
    if(!fj||!fj.data||!fj.data.file_list)return[];
    var vf=null;
    if(season!=null&&episode!=null){
      var sf=fj.data.file_list.find(function(f){return f.is_dir&&(f.file_name||'').toLowerCase().indexOf('season '+season)>-1;})||fj.data.file_list.find(function(f){return f.is_dir;});
      if(!sf)return[];
      var ed=await _fetchJson(FEBBOX+'/file/file_share_list?share_key='+sk+'&parent_id='+sf.fid,{headers:hdrs});
      if(ed&&ed.data&&ed.data.file_list)vf=ed.data.file_list.find(function(f){return!f.is_dir&&(f.file_name||'').toLowerCase().indexOf('e'+(episode<10?'0':'')+episode)>-1;})||ed.data.file_list.find(function(f){return!f.is_dir;});
    } else vf=fj.data.file_list.find(function(f){return!f.is_dir;});
    if(!vf)return[];
    var qj=await _fetchJson(FEBBOX+'/console/video_quality_list?fid='+vf.fid+'&share_key='+sk,{headers:Object.assign({},hdrs,{'Cookie':token.indexOf('ui=')===0?token:'ui='+token})});
    if(!qj||!qj.html)return[];
    var out=[],re=/<div[^>]*class="[^"]*file_quality[^"]*"[^>]*>/g,m;
    while((m=re.exec(qj.html))){var u=(m[0].match(/data-url="([^"]+)"/)||[])[1],q=(m[0].match(/data-quality="([^"]+)"/)||[])[1];if(u&&q)out.push({url:_fixUrl(u.replace(/\\\//g,'/')),quality:q==='ORG'?'2160p':(q.match(/\d{3,4}/)||['Auto'])[0]+'p',label:'[ShowBox]',container:u.indexOf('.m3u8')>-1?'hls':'mp4',headers:hdrs});}
    return out;
  }catch(e){console.log('Mewstream: Showbox failed: '+(e&&e.message||e));return[];}
}

// ── Movie/TV sources ────────────────────────────────────────────────────
async function getVaplayer(imdbId,season,episode,subCb){
  if(!imdbId)return[];var ref='https://nextgencloudfabric.com/';
  var u=season==null?VA_PLAYER+'/api.php?imdb='+imdbId+'&type=movie':VA_PLAYER+'/api.php?imdb='+imdbId+'&type=tv&season='+season+'&episode='+episode;
  try{var d=await _fetchJson(u,{headers:{Referer:ref}});var o=[];if(d&&d.data&&d.data.stream_urls)d.data.stream_urls.forEach(function(x){if(x)o.push({url:_fixUrl(x),quality:'Auto',label:'[VaPlayer]',container:x.indexOf('.m3u8')>-1?'hls':'mp4',headers:{Referer:ref}});});if(d&&d.default_subs)d.default_subs.forEach(function(s){if(s.url)subCb({url:_fixUrl(s.url),lang:s.lang||s.code||'Unknown'});});return o;}catch(e){return[];}
}
async function getVidrock(tmdbId,season,episode,subCb){
  if(!tmdbId)return[];var type=season==null?'movie':'tv',q=season==null?String(tmdbId):tmdbId+'_'+season+'_'+episode;
  var hdrs={Origin:VIDROCK,Referer:VIDROCK+'/'};
  try{var d=await _fetchJson(VIDROCK+'/api/'+type+'/'+q+'/',{headers:hdrs});var o=[];for(var k in d){var e=d[k].url;if(e&&e!=='error'&&e!=='null'){var dec=await _vidrockDecrypt(e);if(dec)o.push({url:_fixUrl(dec),quality:'Auto',label:'[Vidrock '+k+']',container:dec.indexOf('.m3u8')>-1?'hls':'mp4',headers:hdrs});}}return o;}catch(e){return[];}
}
async function _vidrockDecrypt(p){try{var kh='7f3e9c2a8b5d1f4e6a9c3b7d2e5f8a1c4b6d9e2f5a8c1b4d7e9f2a5c8b1d4e7f',kb=[];for(var i=0;i+1<kh.length;i+=2)kb.push(parseInt(kh.substr(i,2),16));var b=p.replace(/-/g,'+').replace(/_/g,'/');while(b.length%4)b+='=';var ct=_arr(_b64ToBytes(b));if(ct.length<28)return null;var ks=_keyExp(kb),nonce=ct.slice(0,12),tag=ct.slice(ct.length-16),body=ct.slice(12,ct.length-16);var H=(function(){var s=[[],[],[],[]],r,c,i;var inp=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];for(i=0;i<16;i++)s[i%4][(i/4)|0]=inp[i];function ark(n){for(c=0;c<4;c++)for(r=0;r<4;r++)s[r][c]^=ks.w[n*4+c][r];}function sub(){for(r=0;r<4;r++)for(c=0;c<4;c++)s[r][c]=_SBOX[s[r][c]];}function sh(){for(r=1;r<4;r++){var row=s[r].slice();for(c=0;c<4;c++)s[r][c]=row[(c+r)%4];}}function mx(){for(c=0;c<4;c++){var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];s[0][c]=_gmul(a0,2)^_gmul(a1,3)^a2^a3;s[1][c]=a0^_gmul(a1,2)^_gmul(a2,3)^a3;s[2][c]=a0^a1^_gmul(a2,2)^_gmul(a3,3);s[3][c]=_gmul(a0,3)^a1^a2^_gmul(a3,2);}}ark(0);for(var n=1;n<ks.Nr;n++){sub();sh();mx();ark(n);}sub();sh();ark(ks.Nr);var o=[];for(i=0;i<16;i++)o[i]=s[i%4][(i/4)|0];return o;})();var ctr=nonce.concat([0,0,0,1]),out=[],off;for(off=0;off<body.length;off+=16){var n=((ctr[12]<<24)|(ctr[13]<<16)|(ctr[14]<<8)|ctr[15])+1;ctr[12]=(n>>>24)&0xff;ctr[13]=(n>>>16)&0xff;ctr[14]=(n>>>8)&0xff;ctr[15]=n&0xff;var st=(function(inp){var s=[[],[],[],[]],r,c,i;for(i=0;i<16;i++)s[i%4][(i/4)|0]=inp[i];function ark(n){for(c=0;c<4;c++)for(r=0;r<4;r++)s[r][c]^=ks.w[n*4+c][r];}function sb(){for(r=0;r<4;r++)for(c=0;c<4;c++)s[r][c]=_SBOX[s[r][c]];}function sh(){for(r=1;r<4;r++){var row=s[r].slice();for(c=0;c<4;c++)s[r][c]=row[(c+r)%4];}}function mx(){for(c=0;c<4;c++){var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];s[0][c]=_gmul(a0,2)^_gmul(a1,3)^a2^a3;s[1][c]=a0^_gmul(a1,2)^_gmul(a2,3)^a3;s[2][c]=a0^a1^_gmul(a2,2)^_gmul(a3,3);s[3][c]=_gmul(a0,3)^a1^a2^_gmul(a3,2);}}ark(0);for(var n2=1;n2<ks.Nr;n2++){sb();sh();mx();ark(n2);}sb();sh();ark(ks.Nr);var o2=[];for(i=0;i<16;i++)o2[i]=s[i%4][(i/4)|0];return o2;})(ctr);for(var j=0;j<16&&off+j<body.length;j++)out.push(body[off+j]^st[j]);}return _bytesToStr(out);}catch(e){return null;}}
async function getVidzee(tmdbId,season,episode,subCb){
  if(!tmdbId)return[];var secret='QTdrUDl4TTJRdjhMcjROejFIdDZZYzNCdzVKZjBEc1U=';
  var per=await Promise.all([0,1,2,4,5,6,7].map(function(sr){
    return (async function(){var o=[];try{var u=season==null?VIDZEE+'/api/server?id='+tmdbId+'&sr='+sr:VIDZEE+'/api/server?id='+tmdbId+'&sr='+sr+'&ss='+season+'&ep='+episode;var d=await _fetchJson(u);if(!d)return o;var gh={};if(d.headers)for(var h in d.headers)gh[h]=d.headers[h];if(d.url)for(var j=0;j<d.url.length;j++){var it=d.url[j];if(it.link){var fu=_decryptVidzee(it.link,secret);if(fu&&fu.indexOf('https:')>-1)o.push({url:_fixUrl(fu),quality:'1080p',label:'[VidZee '+(it.name||'')+' ('+(it.lang||'?')+')]',container:it.type==='hls'||fu.indexOf('.m3u8')>-1?'hls':'mp4',headers:Object.assign({},gh)});}}if(d.tracks)d.tracks.forEach(function(t){if(t.url&&t.lang)subCb({url:_fixUrl(t.url),lang:t.lang});});}catch(e){}return o;})();
  }));var o=[];per.forEach(function(l){o=o.concat(l);});return o;
}
async function getVidfast(tmdbId,season,episode,subCb){
  if(!tmdbId)return[];var hdrs={'User-Agent':UA,Referer:VIDFAST+'/'};
  try{var h=await _fetchText(season==null?VIDFAST+'/movie/'+tmdbId+'/':VIDFAST+'/tv/'+tmdbId+'/'+season+'/'+episode+'/',{headers:hdrs});var m=h.match(/\\"(?:en|token)\\":\\"(.*?)\\"/);if(!m)return[];var s1=await _fetchJson(MULTI_DECRYPT+'/enc-vidfast?text='+encodeURIComponent(m[1])+'&stage=1');if(!s1||!s1.result||!s1.result.stage1)return[];var s1t=await _fetchText(s1.result.stage1,{method:'POST',headers:Object.assign({},hdrs,{'X-CSRF-Token':s1.result.token,'X-Requested-With':'XMLHttpRequest'})});if(!s1t)return[];var d=await _fetchJson(MULTI_DECRYPT+'/enc-vidfast?text='+encodeURIComponent(s1t)+'&stage=2');if(!d||!d.result||!d.result.servers||!d.result.stream)return[];var ph=Object.assign({},hdrs,{'X-CSRF-Token':d.result.token,'X-Requested-With':'XMLHttpRequest'});var sd=await _fetchJson(MULTI_DECRYPT+'/dec-vidfast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:await _fetchText(d.result.servers,{method:'POST',headers:ph})})});if(!sd||!sd.result)return[];var per=await Promise.all(sd.result.map(function(sv){return(async function(){if(!sv.data)return null;try{var se=await _fetchText(d.result.stream+'/'+sv.data,{method:'POST',headers:ph});var sr=await _fetchJson(MULTI_DECRYPT+'/dec-vidfast',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:se})});if(sr.result&&sr.result.url){if(sr.result.tracks)sr.result.tracks.forEach(function(t){if(t.file&&t.label)subCb({url:_fixUrl(t.file),lang:t.label});});return{url:_fixUrl(sr.result.url),quality:sr.result.is4kAvailable?'2160p':'1080p',label:'[Vidfast '+(sv.name||'')+']',container:sr.result.url.indexOf('.m3u8')>-1?'hls':'mp4',headers:ph};}}catch(e){}return null;})();}));var o=[];per.forEach(function(x){if(x)o.push(x);});return o;}catch(e){return[];}
}
async function getHexa(tmdbId,season,episode,subCb){
  if(!tmdbId)return[];var kb=new Uint8Array(32);for(var r=0;r<32;r++)kb[r]=Math.floor(Math.random()*256);var key='';for(var i=0;i<32;i++){var h=kb[i].toString(16);key+=(h.length===1?'0':'')+h;}
  try{var tk=await _fetchJson(MULTI_DECRYPT+'/enc-hexa');var enc=await _fetchText(season==null?HEXA+'/api/tmdb/movie/'+tmdbId+'/images':HEXA+'/api/tmdb/tv/'+tmdbId+'/season/'+season+'/episode/'+episode+'/images',{headers:{'User-Agent':UA,Accept:'text/plain','X-Api-Key':key,'X-Fingerprint-Lite':'e9136c41504646444',Referer:'https://hexa.su/','X-Cap-Token':tk.result.token}});var dec=await _fetchJson(MULTI_DECRYPT+'/dec-hexa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:enc,key:key})});if(!dec||!dec.result)return[];var o=[];(dec.result.sources||[]).forEach(function(s){if(s.url)o.push({url:_fixUrl(s.url),quality:'1080p',label:'[Hexa '+(s.server||'')+']',container:s.url.indexOf('.m3u8')>-1?'hls':'mp4',headers:{Referer:'https://hexa.su/'}});});return o;}catch(e){return[];}
}

// ── Orchestrator ────────────────────────────────────────────────────────
async function getVideoSources(episodeUrl,opts){
  opts=opts||{};var p=_parseStreamId(episodeUrl);var meta=await _resolveMeta(p);
  var subs=[],subCb=function(s){if(s&&s.url)subs.push(s);};var tasks=[],diag=[];
  function safe(name,fn){return withTimeout(fn,20000,[],name).then(function(r){if(!r||!r.length)diag.push(name+':0');return r||[];}).catch(function(e){diag.push(name+':'+(e&&e.message||e));return[];});}
  if(_bool('enableAnikoto',true)&&meta.title)tasks.push(safe('AniKoto',getAnikoto(meta.title,p.season,p.episode,subCb)));
  if(_bool('enableMegaplay',true)&&meta.title)tasks.push(safe('MegaPlay',getMegaplay(meta.title,p.season,p.episode,subCb)));
  if(_bool('enableAnimesalt',true)&&meta.title)tasks.push(safe('AnimeSalt',getAnimesalt(meta.title,p.season,p.episode,subCb)));
  if(_bool('enableRareanimes',true)&&meta.title)tasks.push(safe('RareAnimes',getRareanimes(meta.title,p.season,p.episode,subCb)));
  if(_bool('enableShowbox',true)&&meta.imdbId)tasks.push(safe('Showbox',getShowbox(meta.imdbId,p.season,p.episode,subCb)));
  if(_bool('enableVaplayer',true)&&meta.imdbId)tasks.push(safe('VaPlayer',getVaplayer(meta.imdbId,p.season,p.episode,subCb)));
  if(_bool('enableVidrock',true)&&meta.tmdbId)tasks.push(safe('Vidrock',getVidrock(meta.tmdbId,p.season,p.episode,subCb)));
  if(_bool('enableVidzee',true)&&meta.tmdbId)tasks.push(safe('Vidzee',getVidzee(meta.tmdbId,p.season,p.episode,subCb)));
  if(_bool('enableVidfast',true)&&meta.tmdbId)tasks.push(safe('Vidfast',getVidfast(meta.tmdbId,p.season,p.episode,subCb)));
  if(_bool('enableHexa',true)&&meta.tmdbId)tasks.push(safe('Hexa',getHexa(meta.tmdbId,p.season,p.episode,subCb)));
  var rs=await Promise.all(tasks);var out=[],seen={};rs.forEach(function(l){if(!l)return;l.forEach(function(s){if(s&&s.url&&!seen[s.url]){seen[s.url]=1;out.push(s);}});});
  if(typeof opts.onSubtitle==='function'){var ss={};subs.forEach(function(s){if(!ss[s.url]){ss[s.url]=1;opts.onSubtitle(s);}});}
  if(!out.length)console.log('Mewstream: 0 streams — '+diag.join(' | '));
  else console.log('Mewstream DONE: '+out.length+' streams | '+(meta.title||'?'));
  return out;
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}

if(typeof module!=='undefined'&&module.exports){module.exports={version:VERSION,getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks,_parseStreamId:_parseStreamId,_debug:{getAnikoto:getAnikoto,getMegaplay:getMegaplay,getAnimesalt:getAnimesalt,getRareanimes:getRareanimes,getShowbox:getShowbox}};}
