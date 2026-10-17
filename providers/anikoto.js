// AniKoto — maintained replacement for the discontinued HiAnime site.
var SOURCE_ID=(typeof __SOURCE_ID!=="undefined"&&__SOURCE_ID)?String(__SOURCE_ID):"anikoto";
var API="https://anikotoapi.site",SITE="https://anikototv.to";
var UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
function getInfo(){return {name:"AniKoto",lang:"en",baseUrl:SITE,logo:"https://www.google.com/s2/favicons?sz=256&domain=anikototv.to",type:"anime",version:"1.0.1"};}
function getSettings(){return [];}
function text(s){return htmlText(String(s||"").replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();}
function get(url,ref){return fetch(url,{headers:{"User-Agent":UA,"Accept":"text/html,application/json,*/*","Referer":ref||SITE+"/"}}).then(function(r){if(!r||r.status>=400)throw Error("AniKoto HTTP "+(r&&r.status||"error"));if(typeof r.body!=="string")throw Error("AniKoto empty response");return r.body;});}
function json(url){return get(url,API+"/").then(function(b){var j;try{j=JSON.parse(b);}catch(e){throw Error("AniKoto invalid JSON");}return j;});}
function trim(s){return String(s==null?"":s).replace(/^\s+|\s+$/g,"");}
function attr(s,n){var m=String(s||"").match(new RegExp("\\b"+n+"\\s*=\\s*([\\\"'])(.*?)\\1","i"));return m?m[2]:null;}
function search(q,page,opts){
 q=trim(q);if(!q)return Promise.resolve([]);
 return get(SITE+"/search?keyword="+encodeURIComponent(q),SITE+"/").then(function(h){
  var out=[],seen={},re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(h))&&out.length<30){
   var href=attr(m[1],"href")||"",hit=href.match(/(?:^|\/)watch\/([a-z0-9-]+)\/ep-\d+/i);
   if(!hit)continue;
   var slug=hit[1],title=trim(attr(m[1],"data-jp")||m[2].replace(/<[^>]*>/g,""));
   if(!title)title=slug.replace(/-/g," ");
   if(seen[slug])continue;seen[slug]=1;
   var chunk=h.slice(Math.max(0,m.index-1200),m.index+500),img=(chunk.match(/<img\b[^>]*(?:src|data-src)=["']([^"']+)/i)||[])[1]||null;
   out.push({id:"anikoto:watch:"+slug,title:title,url:"anikoto://watch/"+slug,cover:img,type:"anime",sourceId:SOURCE_ID});
  }
  return out;
 }).catch(function(){return [];});
}
function getHome(opts){
 return json(API+"/recent-anime?page=1&per_page=30").then(function(j){
  var a=Array.isArray(j&&j.data)?j.data:(Array.isArray(j&&j.anime)?j.anime:[]),items=[];
  for(var i=0;i<a.length;i++){var x=a[i]||{},id=String(x.id||"");if(!id)continue;items.push({id:"anikoto:series:"+id,title:x.title||x.name||id,url:"anikoto://series/"+id,cover:x.poster||null,type:"anime",sourceId:SOURCE_ID});}
  return items.length?[{title:"Recently Updated",items:items}]:[];
 }).catch(function(){return [];});
}
function seriesIdFromSlug(slug){return get(SITE+"/watch/"+slug+"/ep-1",SITE+"/").then(function(h){var m=h.match(/\bdata-id=["'](\d+)["']/i);if(!m)throw Error("AniKoto series ID not found");return m[1];});}
function seriesDetail(id){
 return json(API+"/series/"+encodeURIComponent(id)).then(function(j){
  var d=j&&j.data?j.data:j||{},a=d.anime||d.series||{},raw=Array.isArray(d.episodes)?d.episodes:[],slug=String(a.id||id),eps=[];
  for(var i=0;i<raw.length;i++){
   var e=raw[i]||{},n=Number(e.number||e.episode_no||i+1);if(!(n>0))continue;
   eps.push({id:"anikoto://ep/"+slug+"/"+n,url:"anikoto://ep/"+slug+"/"+n,number:n,title:e.title||"Episode "+n});
  }
  eps.sort(function(a,b){return a.number-b.number;});
  return {id:"anikoto:series:"+slug,title:a.title||a.name||slug,url:"anikoto://series/"+slug,cover:a.poster||null,description:a.description||"",type:"anime",sourceId:SOURCE_ID,episodes:eps};
 });
}
function getDetail(url,opts){
 var s=String(url||""),m=/^anikoto:\/\/watch\/([a-z0-9-]+)/i.exec(s),n=/^anikoto:\/\/series\/(\d+)/i.exec(s);
 if(n)return seriesDetail(n[1]);
 if(m)return seriesIdFromSlug(m[1]).then(seriesDetail);
 var id=s.replace(/^anikoto:series:/,"").replace(/^.*\//,"");
 if(/^\d+$/.test(id))return seriesDetail(id);
 return Promise.reject(Error("AniKoto invalid series URL"));
}
function getEpisodes(url,opts){return getDetail(url,opts).then(function(d){return d.episodes||[];});}
var _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64encode(bin) {
  var out = '', i, a, b, c, n;
  for (i = 0; i < bin.length; i += 3) {
    a = bin.charCodeAt(i) & 0xff;
    b = (i + 1 < bin.length) ? (bin.charCodeAt(i + 1) & 0xff) : 0;
    c = (i + 2 < bin.length) ? (bin.charCodeAt(i + 2) & 0xff) : 0;
    n = (a << 16) | (b << 8) | c;
    out += _B64[(n >> 18) & 63] + _B64[(n >> 12) & 63]
      + ((i + 1 < bin.length) ? _B64[(n >> 6) & 63] : '=')
      + ((i + 2 < bin.length) ? _B64[n & 63] : '=');
  }
  return out;
}
function _b64decode(b64) {
  var clean = String(b64 || '').replace(/-/g, '+').replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  // base64url payloads (e.g. the player's `enc`) often strip the `=` padding.
  while (clean.length % 4 !== 0) clean += '=';
  var out = [], i, j;
  for (i = 0; i + 3 < clean.length + 1; i += 4) {
    var n = 0, pad = 0;
    for (j = 0; j < 4; j++) {
      var ch = clean.charAt(i + j);
      var v = (ch === '=') ? 0 : _B64.indexOf(ch);
      if (ch === '=') pad++;
      n = (n << 6) | (v < 0 ? 0 : v);
    }
    out.push((n >> 16) & 255);
    if (pad < 2) out.push((n >> 8) & 255);
    if (pad < 1) out.push(n & 255);
  }
  return out;
}

// ── VRF token for /ajax/episode/list/<id> ────────────────────────────────────
var _VRF_KEY = 'ysJhV6U27FVIjjuk';
var _VRF_SHIFTS = [-3, 3, -4, 2, -2, 5, 4, 5];
function _rc4(key, data) {
  var n = [], r = 0, u, i, t;
  for (i = 0; i < 256; i++) n[i] = i;
  for (u = 0; u < 256; u++) {
    r = (r + n[u] + key.charCodeAt(u % key.length)) % 256;
    t = n[u]; n[u] = n[r]; n[r] = t;
  }
  u = 0; r = 0;
  var out = [];
  for (i = 0; i < data.length; i++) {
    u = (u + 1) % 256; r = (r + n[u]) % 256;
    t = n[u]; n[u] = n[r]; n[r] = t;
    out.push(String.fromCharCode((data.charCodeAt(i) & 0xff) ^ n[(n[u] + n[r]) % 256]));
  }
  return out.join('');
}
function _rot13(s) {
  return String(s).replace(/[A-Za-z]/g, function (c) {
    var o = c.charCodeAt(0);
    if (o >= 65 && o <= 90) return String.fromCharCode(((o - 65 + 13) % 26) + 65);
    return String.fromCharCode(((o - 97 + 13) % 26) + 97);
  });
}
function _vrf(animeId) {
  var b1 = _b64encode(_rc4(_VRF_KEY, String(animeId)));
  var shifted = '', i;
  for (i = 0; i < b1.length; i++) {
    shifted += String.fromCharCode(b1.charCodeAt(i) + _VRF_SHIFTS[i % 8]);
  }
  return _rot13(_b64encode(shifted));
}

// ── MegaPlay AES-256-CBC (sandbox bridges CTR only) ──────────────────────────
// Byte-for-byte match of megaplay's player decrypt against a live getSourcesNew
// `enc` -> {"file":"...master.m3u8"}. Tables/ops mirror providers/hdhub4u.js.
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
function _padBytes(s, n) {
  var out = [], i;
  for (i = 0; i < n; i++) out[i] = 0;
  var b = String(s || '');
  for (i = 0; i < b.length && i < n; i++) out[i] = b.charCodeAt(i) & 0xff;
  return out;
}
function _bytesToStr(b){var s='',i=0;while(i<b.length){var c=b[i++];if(c<0x80)s+=String.fromCharCode(c);else if(c<0xE0)s+=String.fromCharCode(((c&0x1f)<<6)|(b[i++]&0x3f));else if(c<0xF0)s+=String.fromCharCode(((c&0x0f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f));else{var cp=((c&0x07)<<18)|((b[i++]&0x3f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f);cp-=0x10000;s+=String.fromCharCode(0xD800+(cp>>10),0xDC00+(cp&0x3FF));}}return s;}
// MegaPlay/VidWish player defaults: plain sources.file when present, else
// AES-CBC-decrypt `enc` -> { file }.
var MEGA_AES_KEY = 'i?LMTAx0Q6,:}50U';
var MEGA_AES_IV = "W0;27ToaUpl_P%'c";
function _fileFromSources(j) {
  var s = j && j.sources;
  var file = s ? (s.file || (s[0] && s[0].file)) : null;
  if (file) return file;
  if (!j || !j.enc) return null;
  try {
    var ct = _b64decode(j.enc);
    if (!ct.length || ct.length % 16 !== 0) return null;
    var pt = _bytesToStr(_aesCbcDecrypt(ct, _padBytes(MEGA_AES_KEY, 32), _padBytes(MEGA_AES_IV, 16)));
    var o = JSON.parse(pt);
    if (!o) return null;
    if (o.file) return o.file;
    s = o.sources;
    return s ? (s.file || (s[0] && s[0].file)) : null;
  } catch (e) { return null; }
}


function _anikotoExpand(file,embed,kind,tracks){var out=[],subs=[];for(var i=0;i<(tracks||[]).length;i++){var t=tracks[i];if(t&&t.file&&(!t.kind||t.kind==="captions"||t.kind==="subtitles"))subs.push({url:t.file,label:t.label||"Subtitle",lang:String(t.label||"und").toLowerCase().indexOf("english")>=0?"en":"und",format:/\.srt(\?|$)/i.test(t.file)?"srt":"vtt"});}var headers={"User-Agent":UA,"Referer":embed,"Origin":(String(embed).match(/^https?:\/\/[^/]+/)||[])[0]||"https://megaplay.buzz"};out.push({url:file,label:"AniKoto · Auto",quality:"Auto",container:"hls",headers:headers,kind:kind==="dub"?"dub":"sub",subtitles:subs});return out;}
function _anikotoResolve(embed,kind){var base=(String(embed).match(/^(https?:\/\/[^/]+)/)||[])[1]||"https://megaplay.buzz";var type=(String(embed).match(/\/(sub|dub)(?:[/?#]|$)/i)||[])[1]||kind||"sub";return get(embed,SITE+"/").then(function(h){var id=(h.match(/\bdata-id=["\'](\d+)["\']/i)||[])[1];if(!id)throw Error("AniKoto: player ID not found");return get(base+"/stream/getSourcesNew?id="+encodeURIComponent(id)+"&type="+type,embed).then(function(body){var j;try{j=JSON.parse(body);}catch(e){throw Error("AniKoto: invalid player JSON");}var file=_fileFromSources(j);if(!file)throw Error("AniKoto: encrypted player returned no stream");return _anikotoExpand(file,embed,kind,j.tracks||[]);});});}
function getVideoSources(url,opts){
 var m=/^anikoto:\/\/ep\/(\d+)\/(\d+)/i.exec(String(url||""));
 if(!m)return Promise.reject(Error("AniKoto invalid episode URL"));
 var id=m[1],num=Number(m[2]);
 return seriesDetail(id).then(function(d){
  return json(API+"/series/"+encodeURIComponent(id)).then(function(j){
   var data=j&&j.data?j.data:j||{},episodes=Array.isArray(data.episodes)?data.episodes:[],ep=null;
   for(var i=0;i<episodes.length;i++)if(Number(episodes[i].number||episodes[i].episode_no)===num){ep=episodes[i];break;}
   if(!ep)throw Error("AniKoto episode not found");
   var embeds=ep.embed_url||{},jobs=[];
   ["sub","dub"].forEach(function(kind){var u=embeds[kind];if(typeof u==="string"&&u){jobs.push(_anikotoResolve(u,kind).catch(function(){if(typeof extractVideo==="function")return Promise.resolve(extractVideo(u,{headers:{"User-Agent":UA,"Referer":u},kind:kind,audioLang:kind==="dub"?"en":"ja"})).catch(function(){return [];});return [];}));}});
   if(!jobs.length)throw Error("AniKoto has no supported episode embeds");
   return Promise.all(jobs).then(function(groups){var out=[];groups.forEach(function(g){(Array.isArray(g)?g:[]).forEach(function(x){if(x&&x.url&&!out.some(function(y){return y.url===x.url;}))out.push(x);});});if(!out.length)throw Error("AniKoto player embed could not be resolved to a native stream");return out;});
  });
 });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=="undefined"&&module.exports)module.exports={version:"1.0.1",getInfo:getInfo,getSettings:getSettings,getHome:getHome,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks};