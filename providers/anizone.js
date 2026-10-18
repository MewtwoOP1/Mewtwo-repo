// AniZone native provider for Zangetsu. Version mirrored in index.json.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'anizone';
var SITE = 'https://anizone.to';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
function getInfo() { return { name:'AniZone', lang:'en', baseUrl:SITE, logo:'https://www.google.com/s2/favicons?sz=256&domain=anizone.to', type:'anime', version:'1.0.0' }; }
function getSettings() { return []; }
function _get(url, referer) {
  return fetch(url, {headers:{'User-Agent':UA,'Accept-Language':'en-US,en;q=0.9','Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Referer':referer||SITE+'/'}}).then(function(r) {
    var status=Number(r&&r.status||200); if(status>=400) throw new Error('AniZone HTTP '+status);
    return String(r&&r.body||'');
  });
}
function _decode(raw) {
  return String(raw||'').replace(/\\u([0-9a-f]{4})/gi,function(_,h){return String.fromCharCode(parseInt(h,16));})
    .replace(/\\\\/g,'\\').replace(/\\'/g,"'");
}
function _jsonArgument(html,name) {
  var re=new RegExp(name+'\\s*:\\s*JSON\\.parse\\(\\'((?:[^\\'\\\\]|\\\\.)*)\\'\\)','i');
  var m=String(html||'').match(re); if(!m) return null;
  try{return JSON.parse(_decode(m[1]));}catch(e){return null;}
}
function _pickTitle(t) { return t&&(t['1']||t['5']||t['8']||Object.keys(t).map(function(k){return t[k];})[0])||''; }
function _catalogItems(html) {
  var a=_jsonArgument(html,'items'); if(!Array.isArray(a)) return [];
  return a.filter(function(x){return x&&/^[a-z0-9-]+$/i.test(String(x.slug||''));}).map(function(x){
    return {slug:String(x.slug),title:_pickTitle(x.title_list)||x.main_title||'',cover:x.cover||null,year:Number(x.start_year)||null};
  }).filter(function(x){return !!x.title;});
}
function _slug(url){return String(url||'').replace(/^.*\\/anime\\//,'').replace(/\\/$/,'');}
function _pageUrl(slug){return SITE+'/anime/'+encodeURIComponent(_slug(slug));}
function _result(x){return {id:x.slug,title:x.title,url:x.slug,cover:x.cover,type:'anime',sourceId:SOURCE_ID,year:x.year};}
function search(query,page,opts) {
  var q=String(query||'').trim(); if(!q)return Promise.resolve([]);
  return _get(SITE+'/anime?search='+encodeURIComponent(q)).then(function(h){return _catalogItems(h).map(_result);});
}
function popular(opts){return _get(SITE+'/anime').then(function(h){return _catalogItems(h).map(_result);});}
function _episodeNumber(x) {
  var n=Number(x&&x.slug); if(n>0&&isFinite(n))return n;
  var m=String(x&&x.url||'').match(/\\/(\\d+)\\/?$/); return m?Number(m[1]):0;
}
function _episodes(html,slug) {
  var a=_jsonArgument(html,'items'); if(!Array.isArray(a))return [];
  var seen={}; return a.map(function(x){
    var n=_episodeNumber(x); if(!n||seen[n])return null; seen[n]=true;
    return {id:'anizone://'+encodeURIComponent(slug)+'/'+n,number:n,title:_pickTitle(x.title_list)||x.main_title||('Episode '+n),url:'anizone://'+encodeURIComponent(slug)+'/'+n,sourceId:SOURCE_ID,type:'anime'};
  }).filter(Boolean).sort(function(a,b){return a.number-b.number;});
}
function getDetail(url,opts) {
  var slug=_slug(url); return _get(_pageUrl(slug)).then(function(h){
    var items=_catalogItems(h), item=items.filter(function(x){return x.slug===slug;})[0];
    var desc=(h.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)||[])[1]||'';
    var cover=(item&&item.cover)||(h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']*)/i)||[])[1]||null;
    var eps=_episodes(h,slug);
    return {id:slug,title:(item&&item.title)||slug,url:slug,cover:cover,description:desc.replace(/&amp;/g,'&').replace(/&quot;/g,'"'),status:'unknown',genres:[],studios:[],type:'anime',sourceId:SOURCE_ID,year:item&&item.year||null,episodes:eps,subCount:eps.length,dubCount:0};
  });
}
function getEpisodes(url,opts){return getDetail(url,opts).then(function(d){return d.episodes||[];});}
function getVideoSources(episodeUrl,opts) {
  var m=String(episodeUrl||'').match(/^anizone:\\/\\/([^/]+)\\/(\\d+)$/);
  if(!m)return Promise.reject(new Error('AniZone: invalid episode URL'));
  var slug;try{slug=decodeURIComponent(m[1]);}catch(e){slug=m[1];}
  var n=Number(m[2]), page=_pageUrl(slug)+'/'+n;
  return _get(page,_pageUrl(slug)).then(function(h){
    var p=h.match(/vidstackPlayer\\s*\\(\\s*JSON\\.parse\\('(.*?)'\\)\\s*\\)/is);
    if(!p)throw new Error('AniZone: player payload not found');
    var data;try{data=JSON.parse(_decode(p[1]));}catch(e){throw new Error('AniZone: invalid player payload');}
    var src=String(data.src||'').replace(/\\\\\\//g,'/');
    if(!/^https?:\\/\\//i.test(src)||!/\\.m3u8(?:[?#]|$)/i.test(src))throw new Error('AniZone: no direct HLS stream in player payload');
    var subs=(Array.isArray(data.subtitles)?data.subtitles:[]).filter(function(s){return s&&s.file&&/^https?:\\/\\//i.test(s.file);}).map(function(s){
      return {url:String(s.file).replace(/\\\\\\//g,'/'),label:s.title||s.language||'Subtitle',lang:s.language||'',format:s.format||'vtt','default':!!s.default};
    });
    return [{url:src,quality:'Auto',label:'Auto [AniZone]',container:'hls',headers:{'User-Agent':UA,'Referer':page,'Origin':SITE},kind:'sub',audioLang:'ja',subtitles:subs}];
  });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=='undefined'&&module.exports)module.exports={version:'1.0.0',getInfo:getInfo,getSettings:getSettings,popular:popular,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks};
