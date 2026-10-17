// TwoDHive anime source for Zangetsu.
// Supports the site's catalogue and its native MegaPlay source endpoint.
var SOURCE_ID = (typeof __SOURCE_ID !== "undefined" && __SOURCE_ID) ? String(__SOURCE_ID) : "twodhive";
var SITE = "https://2dhive.com";
var MEGA = "https://megaplay.buzz";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var AES_KEY = "i?LMTAx0Q6,:}50U";
var AES_IV = "W0;27ToaUpl_P%'c";
var CDN_TOKEN_KEY = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";

function getInfo() { return { name: "TwoDHive", lang: "en", baseUrl: SITE, logo: "https://www.google.com/s2/favicons?sz=256&domain=2dhive.com", type: "anime", version: "1.0.2" }; }
function getSettings() { return []; }
function _txt(s) { return htmlText(String(s == null ? "" : s)).replace(/\s+/g, " ").trim(); }
function _attr(tag, name) {
  var match = String(tag || "").match(new RegExp("\\b" + name + "\\s*=\\s*([\\\"'])([\\s\\S]*?)\\1", "i"));
  return match ? match[2].replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&") : "";
}
function _get(url, referer, extraHeaders) {
  var requestHeaders = { "User-Agent": UA, "Accept": "text/html,application/json,*/*", "Referer": referer || SITE + "/" };
  Object.keys(extraHeaders || {}).forEach(function (key) { requestHeaders[key] = extraHeaders[key]; });
  return fetch(url, { headers: requestHeaders })
    .then(function (r) {
      if (!r || r.status >= 400) throw Error("TwoDHive HTTP " + (r && r.status || "error") + " at " + url);
      return String(r.body == null ? "" : r.body);
    });
}
function _json(url, referer, extraHeaders) {
  return _get(url, referer, extraHeaders).then(function (body) { try { return JSON.parse(body); } catch (e) { throw Error("TwoDHive returned invalid JSON"); } });
}
function _abs(url, base) {
  if (!url) return null;
  url = String(url).replace(/&amp;/g, "&");
  try { return new URL(url, base || SITE + "/").toString(); } catch (e) { return /^https?:\/\//i.test(url) ? url : null; }
}
function _parseCards(html) {
  var out = [], seen = {}, re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(String(html || ""))) && out.length < 60) {
    var href = _attr(m[1], "href").replace(/&amp;/g, "&");
    var match = href.match(/(?:^|\/)anime\?anime=(\d+)/i);
    if (!match) continue;
    var block = m[2], title = _txt((_txt((block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || "").replace(/<span\b[^>]*>/gi, " ")));
    if (!title) title = _txt(_attr(m[1], "title") || _attr((block.match(/<img\b[^>]*>/i) || [])[0], "alt"));
    if (!title || seen[match[1]]) continue;
    seen[match[1]] = 1;
    var img = (block.match(/<img\b[^>]*>/i) || [])[0] || "";
    var poster = _attr(img, "src") || _attr(img, "data-src") || null;
    out.push({ id: match[1], title: title, url: SITE + "/anime?anime=" + match[1], cover: poster, type: "anime", sourceId: SOURCE_ID });
  }
  return out;
}
function getHome(opts) {
  return _get(SITE + "/", SITE + "/").then(function (html) {
    var items = _parseCards(html);
    return items.length ? [{ title: "Trending and Recent Anime", items: items }] : [];
  }).catch(function () { return []; });
}
function search(query, page, opts) {
  query = String(query || "").trim();
  if (!query) return Promise.resolve([]);
  return _get(SITE + "/?q=" + encodeURIComponent(query), SITE + "/").then(_parseCards).catch(function () { return []; });
}
function _decodeAstro(node) {
  if (Array.isArray(node) && node.length === 2 && typeof node[0] === "number") return _decodeAstro(node[1]);
  if (Array.isArray(node)) return node.map(_decodeAstro);
  if (node && typeof node === "object") {
    var out = {};
    Object.keys(node).forEach(function (key) { out[key] = _decodeAstro(node[key]); });
    return out;
  }
  return node;
}
function _episodeIsland(html, name) {
  var re = /<astro-island\b([^>]*)>/gi, m;
  while ((m = re.exec(String(html || "")))) {
    var component = _attr(m[1], "component-url");
    if (component.toLowerCase().indexOf(name.toLowerCase()) < 0) continue;
    var raw = _attr(m[1], "props");
    if (!raw) continue;
    try { return _decodeAstro(JSON.parse(raw)); } catch (e) {}
  }
  return null;
}
function _episodeNumbers(html, animeId) {
  var seen = {}, out = [], re = /href\s*=\s*["']([^"']*\/?episode\?[^"']+)["']/gi, m;
  while ((m = re.exec(String(html || "")))) {
    var href = m[1].replace(/&amp;/g, "&");
    var idMatch = href.match(/[?&]anime=(\d+)/), epMatch = href.match(/[?&]ep_num=(\d+)/);
    if (!epMatch || (idMatch && String(idMatch[1]) !== String(animeId))) continue;
    var n = Number(epMatch[1]);
    if (n > 0 && !seen[n]) { seen[n] = 1; out.push(n); }
  }
  return out.sort(function (a, b) { return a - b; });
}
function _episodeData(id, n, mode) { return "twodhive://" + String(id) + "/" + String(n) + "/" + (mode || "sub"); }
function _probeDub(id) {
  return _get(MEGA + "/stream/mal/" + id + "/1/dub", SITE + "/").then(function (html) {
    return /(?:data-id|data-realid)=["']\d+["']/.test(html);
  }).catch(function () { return false; });
}
function _detailId(url) {
  var s = String(url || "");
  var match = s.match(/[?&]anime=(\d+)/) || s.match(/^twodhive:\/\/(\d+)/) || s.match(/(\d{2,})/);
  return match ? match[1] : "";
}
function getDetail(url, opts) {
  var id = _detailId(url);
  if (!id) return Promise.reject(Error("TwoDHive invalid anime URL"));
  var detailUrl = SITE + "/anime?anime=" + id;
  return _get(detailUrl, SITE + "/").then(function (html) {
    var title = _txt((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "") ||
      _txt((html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i) || [])[1] || "") || "Anime " + id;
    var poster = _attr((html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i) || [])[0], "content") ||
      _attr((html.match(/<img\b[^>]*src=["'][^"']*anilist[^>]*>/i) || [])[0], "src") || null;
    var synopsis = "";
    var syn = /<p\b[^>]*>\s*Synopsis\s*<\/p>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html);
    if (syn) synopsis = _txt(syn[1]);
    var props = _episodeIsland(html, "EpisodeBrowser") || {};
    var meta = Array.isArray(props.episodeMeta) ? props.episodeMeta : [];
    var numbers = _episodeNumbers(html, id);
    var total = Math.min(500, Math.max(Number(props.totalEpisodes) || 0, numbers.length ? numbers[numbers.length - 1] : 0));
    if (!total) total = Math.min(500, meta.reduce(function (max, ep) { return Math.max(max, Number(ep && ep.number) || 0); }, 0));
    var dubPromise = _probeDub(id);
    return dubPromise.then(function (hasDub) {
      var eps = [];
      for (var n = 1; n <= total; n++) {
        var em = meta.filter(function (x) { return Number(x && x.number) === n; })[0] || {};
        var titleText = _txt(em.title || "") || ("Episode " + n);
        eps.push({ id: _episodeData(id, n, "sub"), url: _episodeData(id, n, "sub"), number: n, title: titleText, cover: em.thumbnail || null, audio: "sub" });
        if (hasDub) eps.push({ id: _episodeData(id, n, "dub"), url: _episodeData(id, n, "dub"), number: n, title: titleText + " (Dub)", cover: em.thumbnail || null, audio: "dub" });
      }
      return {
        id: id, title: title, url: detailUrl, cover: poster, description: synopsis,
        year: (html.match(/\b(19\d{2}|20\d{2})\b/) || [])[1] || null,
        type: "anime", sourceId: SOURCE_ID, episodes: eps
      };
    });
  });
}
function getEpisodes(url, opts) { return getDetail(url, opts).then(function (detail) { return detail.episodes || []; }); }
function _parseEpisodeUrl(url, opts) {
  var match = String(url || "").replace(/^twodhive:\/\//, "").match(/^(\d+)\/(\d+)\/(sub|dub)$/i);
  if (match) return { id: Number(match[1]), episode: Number(match[2]), mode: match[3].toLowerCase() };
  var id = _detailId(url), n = Number((String(url || "").match(/[?&]ep_num=(\d+)/) || [])[1]);
  return id && n > 0 ? { id: Number(id), episode: n, mode: String(opts && opts.category || "sub").toLowerCase() === "dub" ? "dub" : "sub" } : null;
}
function _b64bytes(value) {
  var input = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", out = [], buf = 0, bits = 0;
  for (var i = 0; i < input.length; i++) {
    var ch = input.charAt(i);
    if (ch === "=") break;
    var pos = chars.indexOf(ch);
    if (pos < 0) continue;
    buf = (buf << 6) | pos; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); buf &= (1 << bits) - 1; }
  }
  return out;
}
function _b64url(bytes) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    var n = (a << 16) | (b << 8) | c;
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += chars[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += chars[n & 63];
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}
function _utf8(text) { return Array.from(new TextEncoder().encode(String(text))); }
function _padBytes(s,n){var out=[],i,b=String(s||"");for(i=0;i<n;i++)out[i]=i<b.length?b.charCodeAt(i)&255:0;return out;}
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

if(typeof module!=="undefined"&&module.exports)module.exports={version:"1.0.8",getInfo:getInfo,getSettings:getSettings,getHome:getHome,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getVideoSources,getLinks:getVideoSources};

function _streamFile(root) {
 var sources=root&&root.sources,plain=sources&&(Array.isArray(sources)?sources[0]&&sources[0].file:sources.file);
 if(plain)return Promise.resolve(plain);
 if(!root||!root.enc)return Promise.resolve(null);
 try{
  var cipherBytes=_b64bytes(root.enc);
  if(!cipherBytes.length||cipherBytes.length%16!==0)return Promise.resolve(null);
  var clear=_bytesToStr(_aesCbcDecrypt(cipherBytes,_padBytes(AES_KEY,32),_padBytes(AES_IV,16)));
  var parsed=JSON.parse(clear);
  if(parsed.file)return Promise.resolve(parsed.file);
  var nested=parsed.sources;
  return Promise.resolve(nested&&(Array.isArray(nested)?nested[0]&&nested[0].file:nested.file)||null);
 }catch(e){return Promise.resolve(null);}
}
function _migrateCdn(url) {
  return String(url || "").replace("https://cdn.imgnex.top/anime", "https://megap.norami.top/anime");
}
function _signCdn(url) {
  var ids = String(url || "").match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
  if (!ids || typeof crypto === "undefined" || !crypto.subtle) return Promise.resolve(url);
  var expires = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  var payload = String(expires) + "|" + ids[1].toLowerCase() + "/" + ids[2].toLowerCase();
  var keyBytes = new TextEncoder().encode(CDN_TOKEN_KEY);
  var payloadBytes = new TextEncoder().encode(payload);
  return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then(function (key) {
    return crypto.subtle.sign("HMAC", key, payloadBytes);
  }).then(function (sig) {
    var token = _b64url(_utf8(payload)) + "." + _b64url(Array.from(new Uint8Array(sig)));
    return url + (String(url).indexOf("?") >= 0 ? "&" : "?") + "token=" + token;
  }).catch(function () { return url; });
}
function _variants(masterUrl, text) {
  var lines = String(text || "").split(/\r?\n/), base = String(masterUrl).split("?")[0].replace(/\/[^/]*$/, "/"), out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var res = line.match(/RESOLUTION=(\d+)x(\d+)/i), quality = res ? Number(res[2]) : null, j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].trim().charAt(0) === "#")) j++;
    if (j < lines.length) {
      var uri = lines[j].trim();
      try { uri = new URL(uri, base).toString(); } catch (e) { if (!/^https?:\/\//i.test(uri)) uri = base + uri; }
      out.push({ url: uri, quality: quality });
      i = j;
    }
  }
  return out;
}
function _fallbackEpisodeSources(pageUrl, playerUrl, mode) {
  if (typeof extractVideo !== "function") return Promise.resolve([]);
  return _get(pageUrl, SITE + "/").then(function (html) {
    var urls = [playerUrl], seen = {}, re = /<iframe\b([^>]*)>/gi, m;
    seen[playerUrl] = 1;
    while ((m = re.exec(String(html || ""))) && urls.length < 16) {
      var attrs = m[1], raw = (attrs.match(/(?:src|data-src|data-url)=["']([^"']+)/i) || [])[1];
      if (!raw) continue;
      try { raw = new URL(raw.replace(/&amp;/g,"&"), pageUrl).toString(); } catch (e) { continue; }
      if (!/^https?:\/\//i.test(raw) || seen[raw]) continue;
      seen[raw] = 1; urls.push(raw);
    }
    return Promise.all(urls.map(function (u) {
      return Promise.resolve(extractVideo(u, { headers: { "User-Agent": UA, "Referer": pageUrl }, kind: mode, audioLang: mode === "dub" ? "en" : "ja" })).catch(function () { return []; });
    })).then(function (groups) {
      var out = [], found = {};
      groups.forEach(function (items) { (items || []).forEach(function (x) {
        if (x && x.url && !found[x.url]) { found[x.url] = 1; out.push(x); }
      }); });
      return out;
    });
  }).catch(function () { return []; });
}
function getVideoSources(url, opts) {
  var ep = _parseEpisodeUrl(url, opts);
  if (!ep || !(ep.id > 0) || !(ep.episode > 0)) return Promise.reject(Error("TwoDHive invalid episode URL"));
  var mode = ep.mode === "dub" ? "dub" : "sub";
  var pageUrl = SITE + "/episode?anime=" + ep.id + "&ep_num=" + ep.episode;
  var playerUrl = MEGA + "/stream/mal/" + ep.id + "/" + ep.episode + "/" + mode;
  return _get(playerUrl, pageUrl).then(function (html) {
    var id = (html.match(/\bdata-id=["'](\d+)["']/i) || html.match(/\bdata-realid=["'](\d+)["']/i) || [])[1];
    if (!id) throw Error("TwoDHive MegaPlay player ID not found");
    var headers = { "User-Agent": UA, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest", "Origin": MEGA, "Referer": playerUrl };
    var ajaxHeaders = { "User-Agent": UA, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest" };
    return _json(MEGA + "/stream/getSourcesNew?id=" + encodeURIComponent(id) + "&type=" + mode, playerUrl, ajaxHeaders).catch(function () {
      return _json(MEGA + "/stream/getSources?id=" + encodeURIComponent(id) + "&type=" + mode, playerUrl, ajaxHeaders);
    }).then(function (root) {
      return _streamFile(root).then(function (rawUrl) {
        if (!rawUrl && typeof extractVideo === "function") {
          return Promise.resolve(extractVideo(playerUrl, { headers: headers, kind: mode, audioLang: mode === "dub" ? "en" : "ja" })).then(function (items) { return { fallback: items || [], root: root }; });
        }
        if (!rawUrl) throw Error("TwoDHive MegaPlay source did not contain a media URL");
        return { rawUrl: _migrateCdn(rawUrl), root: root };
      });
    }).then(function (result) {
      if (result.fallback) {
        if (!result.fallback.length) throw Error("TwoDHive had no fallback stream links");
        return result.fallback;
      }
      var stream = result.rawUrl, headersForPlayback = { "User-Agent": UA, "Referer": MEGA + "/" };
      var tracks = [];
      (result.root && Array.isArray(result.root.tracks) ? result.root.tracks : []).forEach(function (track) {
        if (!track || !track.file || (track.kind && track.kind !== "captions" && track.kind !== "subtitles")) return;
        tracks.push({ url: _migrateCdn(track.file), lang: track.label || "und", label: track.label || "Subtitle" });
      });
      var isHls = /\.m3u8(?:[?#]|$)/i.test(stream);
      if (!isHls) return [{ url: stream, label: "MegaPlay " + mode.toUpperCase(), quality: "Auto", container: /\.mp4(?:[?#]|$)/i.test(stream) ? "mp4" : "auto", headers: headersForPlayback, kind: mode, subtitles: tracks }];
      return _signCdn(stream).then(function (signedMaster) {
        return _get(signedMaster, MEGA + "/").then(function (playlist) { return _variants(stream, playlist); }).catch(function () { return []; }).then(function (variants) {
          var links = [];
          if (variants.length) {
            return Promise.all(variants.map(function (v) {
              return _signCdn(v.url).then(function (signedVariant) {
                links.push({ url: signedVariant, label: "MegaPlay " + mode.toUpperCase() + (v.quality ? " " + v.quality + "p" : ""), quality: v.quality || "Auto", container: "hls", headers: headersForPlayback, kind: mode, subtitles: tracks });
              });
            })).then(function () { return links; });
          }
          return [{ url: signedMaster, label: "MegaPlay " + mode.toUpperCase(), quality: "Auto", container: "hls", headers: headersForPlayback, kind: mode, subtitles: tracks }];
        });
      });
    });
  });
  }).catch(function (primaryError) {
    return _fallbackEpisodeSources(pageUrl, playerUrl, mode).then(function (items) {
      if (items && items.length) return items;
      throw primaryError;
    });
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }
if (typeof module !== "undefined" && module.exports) {
  module.exports = { version: "1.0.2", getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks };
}