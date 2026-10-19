// MegaPlay — Anikoto catalogue + MegaPlay embed playback for Zangetsu.
// Version is mirrored in index.json; bump both whenever this source changes.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'megaplay';
var VERSION = '1.0.3';
var CATALOG = 'https://anikototv.to';
var API = 'https://anikotoapi.site';
var BASE = 'https://megaplays.se';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getInfo() { return { name: 'MegaPlay', lang: 'en', baseUrl: BASE, logo: BASE + '/favicon.ico', type: 'anime', version: VERSION }; }
function getSettings() { return []; }
function _get(url, ref, xhr) {
  var headers = { 'User-Agent': UA, 'Referer': ref || CATALOG + '/' };
  if (xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(url, { headers: headers, timeoutMs: 20000 }).then(function(r) { return r && r.body || ''; }).catch(function() { return ''; });
}
function _json(url, ref, xhr) { return _get(url, ref, xhr).then(function(b) { try { return JSON.parse(b || 'null'); } catch (_) { return null; } }); }
function _text(s) { return htmlText(String(s || '')).replace(/\s+/g, ' ').trim(); }
function _slug(href) { var m = String(href || '').match(/\/watch\/([^\/?#]+)/i); return m ? m[1] : ''; }
function _card(slug, title, cover) { return { id: slug, title: title, url: slug, cover: cover || null, type: 'anime', sourceId: SOURCE_ID }; }

function search(query, page) {
  var q = String(query || '').trim(); if (!q) return Promise.resolve([]);
  var url = CATALOG + '/filter?keyword=' + encodeURIComponent(q) + '&page=' + Math.max(1, Number(page) || 1);
  return _get(url, CATALOG + '/').then(function(html) {
    var out = [], seen = {}, chunks = String(html).split('<div class="item');
    for (var i = 1; i < chunks.length; i++) {
      var c = chunks[i], slug = _slug((c.match(/href=["']([^"']*\/watch\/[^"']+)/i) || [])[1]);
      if (!slug || seen[slug]) continue;
      var title = (c.match(/class=["']name d-title["'][^>]*>([^<]+)/i) || c.match(/data-jp=["']([^"']+)/i) || [])[1];
      var cover = (c.match(/<img[^>]+(?:data-src|src)=["']([^"']+)/i) || [])[1];
      title = _text(title); if (!title) continue;
      seen[slug] = 1; out.push(_card(slug, title, cover || null));
    }
    return out;
  }).catch(function() { return []; });
}
function getHome() {
  return _json(API + '/recent-anime?page=1&per_page=24', CATALOG + '/').then(function(j) {
    var rows = j && Array.isArray(j.data) ? j.data : [];
    var items = rows.filter(function(a) { return a && a.slug; }).map(function(a) { return _card(String(a.slug), _text(a.title || a.alternative || a.slug), a.poster || null); });
    return items.length ? [{ title: 'Recently Updated', items: items }] : [];
  }).catch(function() { return []; });
}
function _episodes(html, animeId, slug) {
  var out = [], seen = {}, re = /<a\b([^>]*data-id=["'](\d+)[^>]*?)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var attrs = m[1], id = m[2];
    var serverIds = (attrs.match(/data-ids=[\"']([^\"']+)/i) || [])[1] || '';
    var num = (attrs.match(/data-num=["']([^"']+)/i) || [])[1] || String(out.length + 1);
    var hasSub = /data-sub=["'](?:1|true|yes)/i.test(attrs), hasDub = /data-dub=["'](?:1|true|yes)/i.test(attrs);
    if (!hasSub && !hasDub) hasSub = true;
    var label = _text(m[3]) || ('Episode ' + num);
    ['sub','dub'].forEach(function(lang) {
      if ((lang === 'sub' && !hasSub) || (lang === 'dub' && !hasDub)) return;
      var key = id + '/' + lang; if (seen[key]) return; seen[key] = true;
      out.push({ id: id + '-' + lang, title: label + (lang === 'dub' ? ' (Dub)' : ' (Sub)'), number: Number(num) || null,
        url: 'megaplay://' + encodeURIComponent(id) + '/' + lang + '/' + encodeURIComponent(num) + '/' + encodeURIComponent(serverIds), type: 'anime', category: lang,
        episodeId: id, animeId: animeId || null, slug: slug, sourceId: SOURCE_ID });
    });
  }
  return out;
}
function getDetail(url) {
  var slug = String(url || '').replace(/^https?:\/\/[^/]+\/watch\//i, '').replace(/^\/+|\/+$/g, '');
  if (!slug) return Promise.resolve(null);
  var pageUrl = CATALOG + '/watch/' + slug;
  return _get(pageUrl, CATALOG + '/').then(function(html) {
    var animeId = (html.match(/data-id=["'](\d+)["']/i) || [])[1] || '';
    var title = _text((html.match(/<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]).replace(/\s*[|-]\s*Anikoto.*$/i, '');
    var cover = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || [])[1] || null;
    var desc = _text((html.match(/<div[^>]+class=["'][^"']*synopsis[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || [])[1] || '');
    if (!title) title = slug.replace(/[-_]/g, ' ');
    if (!animeId) return { id: slug, title: title, url: slug, cover: cover, type: 'anime', sourceId: SOURCE_ID, description: desc, episodes: [] };
    return _json(CATALOG + '/ajax/episode/list/' + animeId, pageUrl, true).then(function(j) {
      var markup = j && (j.result || j.html || j.data) || '';
      var episodes = _episodes(typeof markup === 'string' ? markup : '', animeId, slug);
      return { id: slug, title: title, url: slug, cover: cover, type: 'anime', sourceId: SOURCE_ID, description: desc, episodes: episodes };
    });
  }).catch(function() { return null; });
}
function getEpisodes(url) { return getDetail(url).then(function(d) { return d && Array.isArray(d.episodes) ? d.episodes : []; }); }
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
  var s = j && j.sources;
  var file = s ? (s.file || (s[0] && s[0].file)) : null;
  if (file) return file;
  if (!j || !j.enc) return null;
  try {
    var ct = _b64urlBytes(j.enc);
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
// Resolve the actual media source; /stream/s-2 is a player page, not a video file.
function _megaExtract(embedUrl, lang) {
  var embedOrigin = (String(embedUrl).match(/^https?:\/\/[^/]+/i) || [BASE])[0];
  return _get(embedUrl, embedOrigin + '/').then(function(html) {
    var dataId = (html.match(/data-id=["']([^"']+)["']/i) || [])[1];
    if (!dataId) throw new Error('MegaPlay: embed page has no data-id');
    var scriptUrls = [], re = /<script\b[^>]+src=["']([^"']+)["'][^>]*>/gi, m;
    while ((m = re.exec(html)) !== null) {
      var u = m[1];
      if (/^(?:https?:)?\/\//i.test(u)) scriptUrls.push(u.indexOf('//') === 0 ? 'https:' + u : u);
      else scriptUrls.push(embedOrigin + (u.charAt(0) === '/' ? '' : '/') + u);
    }
    return Promise.all(scriptUrls.map(function(u) { return _get(u, embedUrl); })).then(function(scripts) {
      var script = '', routes = [];
      for (var i = 0; i < scripts.length; i++) {
        if (/getSources/i.test(scripts[i]) && /AES-CBC/i.test(scripts[i])) { script = scripts[i]; break; }
      }
      if (!script) throw new Error('MegaPlay: player source script not found');
      var sr = /["'](stream\/getSources[\w/-]*)["']/gi, rm;
      while ((rm = sr.exec(script)) !== null) if (routes.indexOf(rm[1]) < 0) routes.push(rm[1]);
      routes.sort(function(a,b) { return a.length-b.length; });
      if (!routes.length) throw new Error('MegaPlay: source endpoint not found');
      var legacy = routes[0], modern = null;
      for (var j = 0; j < routes.length; j++) if (routes[j] !== legacy && routes[j].indexOf(legacy) === 0) { modern = routes[j]; break; }
      function source(route) {
        if (!route) return Promise.resolve(null);
        var endpoint = embedOrigin + '/' + route + '?id=' + encodeURIComponent(dataId) + '&id=' + encodeURIComponent(dataId) + '&type=' + encodeURIComponent(lang);
        return _json(endpoint, embedUrl, true).then(function(j) {
          var file = _fileFromSources(j);
          return file ? { file: file, data: j } : null;
        }).catch(function() { return null; });
      }
      return Promise.all([source(modern), source(legacy)]).then(function(results) {
        var found = results[0] || results[1];
        if (!found || !found.file) throw new Error('MegaPlay: encrypted response did not contain a media URL');
        var origin = (embedUrl.match(/^https?:\/\/[^/]+/i) || [BASE])[0];
        var headers = { 'User-Agent': UA, 'Referer': origin + '/', 'Origin': origin };
        var tracks = found.data && Array.isArray(found.data.tracks) ? found.data.tracks : [];
        var subtitles = tracks.filter(function(t) { return t && t.file && (!t.kind || t.kind === 'captions' || t.kind === 'subtitles'); }).map(function(t) {
          return { url: t.file, lang: t.label || 'Subtitle', label: t.label || 'Subtitle', format: /\.srt(\?|$)/i.test(t.file) ? 'srt' : 'vtt', 'default': !!t['default'] };
        });
        var isHls = /\.m3u8(?:\?|$)/i.test(found.file);
        return [{ url: found.file, name: 'MegaPlay', provider: 'MegaPlay', quality: 'auto', container: isHls ? 'hls' : 'mp4', hls: isHls, embed: false, downloadable: false, kind: lang, audioLang: lang === 'dub' ? 'en' : 'ja', headers: headers, subtitles: subtitles }];
      });
    });
  });
}
function _ajax(path) {
  return _get(CATALOG + path, CATALOG + '/', true).then(function(body) {
    try { return JSON.parse(body || 'null'); } catch (_) { return null; }
  }).catch(function() { return null; });
}
function _parseServers(html) {
  var out = [], re = /data-type=["'](\w+)["']([\s\S]*?)(?=data-type=["']|$)/g, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var type = m[1], block = m[2], lr = /data-link-id=["']([^"']+)["'][^>]*>([^<]*)</g, lm;
    while ((lm = lr.exec(block)) !== null) out.push({ type: type, linkId: lm[1], name: String(lm[2] || '').trim() });
  }
  return out;
}
function _directStream(url, lang) {
  var isHls = /\.m3u8(?:[?#]|$)/i.test(url);
  return [{
    url: url, name: 'Direct stream', provider: 'MegaPlay', quality: 'auto',
    container: isHls ? 'hls' : 'mp4', hls: isHls, embed: false,
    downloadable: false, kind: lang, audioLang: lang === 'dub' ? 'en' : 'ja',
    headers: { 'User-Agent': UA, 'Referer': CATALOG + '/', 'Origin': CATALOG },
    subtitles: []
  }];
}
function _tryServerList(list, i, lang) {
  if (i >= list.length) return Promise.resolve([]);
  return _ajax('/ajax/server?get=' + encodeURIComponent(list[i].linkId)).then(function(j) {
    var result = j && j.result;
    var embed = result && typeof result === 'object' ? result.url : '';
    if (typeof embed === 'string' && /^https?:\/\//i.test(embed) && /\.(?:m3u8|mp4)(?:[?#]|$)/i.test(embed)) {
      return _directStream(embed, lang);
    }
    if (typeof embed === 'string' && /https?:\/\/(?:[^/]+\.)?(?:megaplay\.[a-z]+|megaplays\.se|vidtube\.[a-z]+|vidstream(?:ing)?\.[a-z]+)/i.test(embed)) {
      return _megaExtract(embed, lang).catch(function() { return _tryServerList(list, i + 1, lang); });
    }
    return _tryServerList(list, i + 1, lang);
  }).catch(function() { return _tryServerList(list, i + 1, lang); });
}
function getVideoSources(episodeUrl) {
  var raw = String(episodeUrl || '').replace(/^megaplay:\/\//i, '').split('/');
  var id = decodeURIComponent(raw[0] || '');
  if (!/^\d+$/.test(id)) return Promise.resolve([]);
  var lang = raw[1] === 'dub' ? 'dub' : 'sub';
  var serverIds = '';
  try { serverIds = decodeURIComponent(raw[3] || ''); } catch (_) {}
  // Older saved episode URLs did not carry server_ids; retain the direct route
  // as a compatibility fallback, but new episodes always resolve the site's
  // real episode → server list → server?get → player chain.
  if (!serverIds) {
    var oldEmbed = BASE + '/stream/s-2/' + encodeURIComponent(id) + '/' + lang;
    return _megaExtract(oldEmbed, lang).catch(function() { return []; });
  }
  return _ajax('/ajax/server/list?servers=' + encodeURIComponent(serverIds)).then(function(j) {
    var markup = j && typeof j.result === 'string' ? j.result : '';
    var servers = _parseServers(markup);
    var wanted = servers.filter(function(s) {
      var type = String(s.type || '').toLowerCase();
      return lang === 'dub' ? type === 'dub' : (type === 'sub' || type === 'hsub');
    });
    if (!wanted.length) wanted = servers;
    wanted.sort(function(a,b) {
      function rank(s) { var n = String(s.name || '').toLowerCase(); return /megaplay|vidstream|\bhd\b/.test(n) ? 0 : /vidplay|vidtube/.test(n) ? 1 : 5; }
      return rank(a) - rank(b);
    });
    return _tryServerList(wanted, 0, lang);
  }).catch(function() { return []; });
}
function getStreams(url) { return getVideoSources(url); }
if (typeof module !== 'undefined' && module.exports) module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams };
