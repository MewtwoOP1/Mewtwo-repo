// AniChan — AniList-backed anime source with session-aware multi-server playback.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'anichan';
var SITE = 'https://anichan.to';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
var CACHE = {};
var SESSION = null;

function getInfo() {
  return { name:'AniChan', lang:'en', baseUrl:SITE, logo:'https://www.google.com/s2/favicons?sz=256&domain=anichan.to', type:'anime', version:'1.0.0' };
}
function getSettings() {
  return [
    { key:'audioMode', label:'Audio tracks', description:'Choose whether the source lists both SUB and DUB, or only one track.', type:'enum', default:'both', options:[{value:'both',label:'Sub and dub'},{value:'sub',label:'Sub only'},{value:'dub',label:'Dub only'}] },
    { key:'homeSections', label:'Home sections', description:'Comma-separated AniList sections: trending, popular, seasonal, top.', type:'text', default:'trending,popular,seasonal' },
    { key:'requestTimeoutMs', label:'Request timeout', description:'Maximum wait for an individual AniList or AniChan API request.', type:'enum', default:'10000', options:[{value:'6000',label:'6 seconds'},{value:'10000',label:'10 seconds'},{value:'15000',label:'15 seconds'}] },
    { key:'sessionRefresh', label:'Refresh session before expiry', description:'Mint a new AniChan session when the cached session is near its two-hour expiry.', type:'bool', default:true },
    { key:'maxStreams', label:'Maximum server results', description:'Limit the number of stream servers returned for an episode.', type:'enum', default:'8', options:[{value:'3',label:'3 servers'},{value:'5',label:'5 servers'},{value:'8',label:'8 servers'},{value:'12',label:'12 servers'}] },
    { key:'showAdult', label:'Show adult catalogue entries', description:'Include adult entries returned by AniList. Disabled by default.', type:'bool', default:false }
  ];
}
function _setting(key) {
  try { var s = typeof __settings !== 'undefined' && __settings ? __settings[SOURCE_ID] : null; return s && s[key] != null ? s[key] : null; }
  catch (e) { return null; }
}
function _bool(v, fallback) {
  if (v == null) return fallback;
  if (v === true || String(v).toLowerCase() === 'true') return true;
  if (v === false || String(v).toLowerCase() === 'false') return false;
  return fallback;
}
function _int(v, fallback, min, max) {
  var n = parseInt(v, 10);
  return isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function _config() {
  var sections = String(_setting('homeSections') || 'trending,popular,seasonal').split(/[,\n;]+/).map(function(x){return x.trim().toLowerCase();}).filter(Boolean);
  return {
    audioMode: String(_setting('audioMode') || 'both').toLowerCase(),
    sections: sections,
    timeout: _int(_setting('requestTimeoutMs'),10000,3000,30000),
    refresh: _bool(_setting('sessionRefresh'),true),
    maxStreams: _int(_setting('maxStreams'),8,1,20),
    showAdult: _bool(_setting('showAdult'),false)
  };
}
function _cache(key, value) {
  if (value !== undefined) CACHE[key] = { value:value, expires:Date.now()+120000 };
  var hit = CACHE[key];
  return hit && hit.expires > Date.now() ? hit.value : null;
}
function _fetch(url, options) {
  var opts = options || {};
  var headers = Object.assign({'User-Agent':UA,'Accept':'application/json'}, opts.headers || {});
  return fetch(url, Object.assign({}, opts, {headers:headers, timeoutMs:opts.timeoutMs || _config().timeout})).then(function(r) {
    var status = Number(r && r.status || 0);
    if (status < 200 || status >= 300) {
      var e = new Error('AniChan HTTP ' + status + ' for ' + url);
      e.status = status;
      e.body = String(r && r.body || '').slice(0,160);
      throw e;
    }
    return r;
  });
}
function _json(url, options) {
  return _fetch(url, options).then(function(r) {
    try { return JSON.parse(r.body || 'null'); }
    catch (e) { throw new Error('AniChan returned invalid JSON for ' + url); }
  });
}
var MEDIA_FIELDS = 'id idMal title { english romaji native } description(asHtml:false) coverImage { extraLarge large } bannerImage episodes status genres seasonYear averageScore isAdult synonyms studios(isMain:true) { nodes { name } }';
function _graph(query, variables) {
  return _fetch(ANILIST, {method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, body:JSON.stringify({query:query,variables:variables || {}})})
    .then(function(r){ var j; try{j=JSON.parse(r.body||'null');}catch(e){throw new Error('AniList invalid JSON');}
      if (j.errors && j.errors.length) throw new Error('AniList: '+String(j.errors[0].message||'query failed'));
      return j.data || {};
    });
}
function _media(id) {
  var key='detail:'+id, cached=_cache(key); if(cached) return Promise.resolve(cached);
  return _graph('query($id:Int){Media(id:$id,type:ANIME){'+MEDIA_FIELDS+'}}',{id:Number(id)})
    .then(function(d){var m=d.Media;if(!m)throw new Error('AniList title not found: '+id);if(m.isAdult&&!_config().showAdult)throw new Error('AniChan: adult title hidden by settings');_cache(key,m);return m;});
}
function _title(m) { return m && m.title && (m.title.english || m.title.romaji || m.title.native) || 'Anime'; }
function _item(m) {
  if(!m || !m.id || (m.isAdult && !_config().showAdult)) return null;
  return {id:'anichan://anime/'+m.id,title:_title(m)+(m.seasonYear?' ('+m.seasonYear+')':''),url:'anichan://anime/'+m.id,cover:m.coverImage&&(m.coverImage.extraLarge||m.coverImage.large)||null,banner:m.bannerImage||null,description:m.description||'',status:_status(m.status),genres:m.genres||[],studios:m.studios&&m.studios.nodes?m.studios.nodes.map(function(x){return x.name;}):[],year:m.seasonYear||null,score:m.averageScore||null,type:'anime',sourceId:SOURCE_ID};
}
function _status(v) { return v==='FINISHED'?'completed':(v==='RELEASING'||v==='NOT_YET_RELEASED'?'ongoing':(v==='CANCELLED'?'cancelled':'unknown')); }
function _page(path, variables) {
  return _graph('query($page:Int,$perPage:Int,$season:MediaSeason){Page(page:$page,perPage:$perPage){media(type:ANIME,season:$season,sort:'+path+',isAdult:'+(_config().showAdult?'true':'false')+'){'+MEDIA_FIELDS+'}}}',Object.assign({page:1,perPage:20},variables||{}))
    .then(function(d){return (d.Page&&d.Page.media||[]).map(_item).filter(Boolean);});
}
function search(query,page,opts) {
  var q=String(query||'').trim(); if(!q)return Promise.resolve([]);
  return _graph('query($search:String,$page:Int){Page(page:$page,perPage:20){media(search:$search,type:ANIME,sort:SEARCH_MATCH,isAdult:'+(_config().showAdult?'true':'false')+'){'+MEDIA_FIELDS+'}}}',{search:q,page:Math.max(1,_int(page,1,1,100))})
    .then(function(d){return (d.Page&&d.Page.media||[]).map(_item).filter(Boolean);}).catch(function(e){console.warn('AniChan search failed',String(e));return [];});
}
function getHome(opts) {
  var allowed={trending:'TRENDING_DESC',popular:'POPULARITY_DESC',top:'SCORE_DESC'};
  var jobs=_config().sections.filter(function(x,i,a){return !!allowed[x]&&a.indexOf(x)===i;}).map(function(name){return _page(allowed[name]).then(function(items){return items.length?{title:name.charAt(0).toUpperCase()+name.slice(1)+' Anime',items:items}:null;}).catch(function(e){console.warn('AniChan home section failed',name,String(e));return null;});});
  if(_config().sections.indexOf('seasonal')>=0) {
    var now=new Date(), month=now.getMonth()+1;
    var season=month<=3?'WINTER':(month<=6?'SPRING':(month<=9?'SUMMER':'FALL'));
    jobs.push(_page('POPULARITY_DESC',{season:season}).then(function(items){return items.length?{title:'This Season',items:items}:null;}).catch(function(){return null;}));
  }
  return Promise.all(jobs).then(function(rows){return rows.filter(Boolean);});
}
function popular(opts) { return _page('POPULARITY_DESC').catch(function(){return [];}); }
function _id(value) {
  var m=String(value||'').match(/(?:anichan:\/\/anime\/|\/)(\d+)(?:[/?#]|$)/) || String(value||'').match(/^(\d+)$/);
  if(!m)throw new Error('AniChan: invalid AniList ID');return Number(m[1]);
}
function getDetail(url,opts) {
  var id=_id(url);
  return _media(id).then(function(m){
    return _json(SITE+'/api/watch/episodes?anilistId='+id).then(function(av){
      var count=Number(av&&av.episodes)||0, dub=!!(av&&av.dubAvailable), episodes=[];
      if(count>0){for(var n=1;n<=count;n++){episodes.push({id:'anichan://episode/'+id+'/'+n+'/sub',url:'anichan://episode/'+id+'/'+n+'/sub',number:n,title:'Episode '+n,sourceId:SOURCE_ID,type:'anime',category:'sub'});if(dub&&_config().audioMode!=='sub')episodes.push({id:'anichan://episode/'+id+'/'+n+'/dub',url:'anichan://episode/'+id+'/'+n+'/dub',number:n,title:'Episode '+n,sourceId:SOURCE_ID,type:'anime',category:'dub'});}}
      if(_config().audioMode==='sub')episodes=episodes.filter(function(x){return x.category==='sub';});
      if(_config().audioMode==='dub')episodes=episodes.filter(function(x){return x.category==='dub';});
      var out=_item(m);out.episodes=episodes;out.subCount=count;out.dubCount:dub?count:0;return out;
    });
  });
}
function getEpisodes(url,opts) { return getDetail(url,opts).then(function(d){return d.episodes||[];}); }
function _session() {
  if(SESSION && Date.now()<SESSION.expires && (!_config().refresh || SESSION.expires-Date.now()>60000))return Promise.resolve(SESSION.cookie);
  return _fetch(SITE+'/api/watch/session',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','Referer':SITE+'/'},body:'{"token":""}'}).then(function(r){
    var headers=r.headers||{},cookie=null;
    Object.keys(headers).some(function(k){if(k.toLowerCase()==='set-cookie'){cookie=String(headers[k]).split(';')[0];return true;}return false;});
    var body={};try{body=JSON.parse(r.body||'{}');}catch(e){}
    if(!cookie && body.cookie)cookie='anichan_ws='+body.cookie;
    if(!cookie)throw new Error('AniChan session response did not include anichan_ws cookie');
    var exp=Number(body.exp)||((Date.now()/1000)+7200);
    SESSION={cookie:cookie,expires:exp*1000-60000};
    return cookie;
  });
}
function _servers(id,ep,category,force) {
  return _session().then(function(cookie){
    return _fetch(SITE+'/api/watch/servers?anilistId='+id+'&ep='+ep+'&category='+category,{headers:{'Cookie':cookie,'Referer':SITE+'/'}})
      .then(function(r){var j;try{j=JSON.parse(r.body||'{}');}catch(e){j={};}return {status:r.status,data:j};});
  }).then(function(res){
    if(res.status===401 && !force){SESSION=null;return _servers(id,ep,category,true);}
    if(res.status!==200)throw new Error('AniChan servers HTTP '+res.status);
    return Array.isArray(res.data.servers)?res.data.servers:[];
  });
}
function _abs(url) { var s=String(url||'');return s.charAt(0)==='/'?SITE+s:s.replace(/ /g,'%20');}
function _subtitleLanguage(label) {
  var s=String(label||'').toLowerCase();
  return s.indexOf('eng')===0?'en':s.indexOf('spa')===0?'es':s.indexOf('por')===0?'pt':s.indexOf('fre')===0||s.indexOf('fra')===0?'fr':s.indexOf('ger')===0?'de':s.indexOf('ita')===0?'it':s.indexOf('ara')===0?'ar':s.indexOf('rus')===0?'ru':s.indexOf('kor')===0?'ko':s.indexOf('jap')===0?'ja':s.indexOf('chi')===0?'zh':'und';
}
function getVideoSources(episodeUrl,opts) {
  var m=String(episodeUrl||'').match(/^anichan:\/\/episode\/(\d+)\/(\d+)\/(sub|dub)$/i);
  if(!m)return Promise.reject(new Error('AniChan: invalid episode URL'));
  var id=Number(m[1]),ep=Number(m[2]),category=m[3].toLowerCase();
  return _servers(id,ep,category,false).then(function(rows){
    var usable=rows.filter(function(x){var name=String(x&&x.name||'');return x&&x.stream&&!/^megaplay/i.test(name)&&name.toLowerCase()!=='vidhawk';})
      .sort(function(a,b){return (Number(a.rank)||9999)-(Number(b.rank)||9999);}).slice(0,_config().maxStreams);
    if(!usable.length)throw new Error('AniChan: no playable servers for episode '+ep+' ('+category+')');
    var subs=(Array.isArray(usable[0].subtitles)?usable[0].subtitles:[]).map(function(x){
      if(!x||!x.url)return null;var label=String(x.lang||'Subtitles');
      return {url:_abs(x.url),label:label,lang:_subtitleLanguage(label),format:'vtt'};
    }).filter(Boolean);
    return usable.map(function(x,i){return {url:_abs(x.stream),container:'hls',type:'hls',quality:String(x.label||x.name||('Server '+(i+1))).replace(/^★/,'').trim(),label:String(x.label||x.name||('Server '+(i+1))).replace(/^★/,'').trim(),kind:category,audioLang:category==='dub'?'en':'ja',headers:{},referer:undefined,subtitles:i===0?subs:[],isActive:i===0};});
  });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=='undefined'&&module.exports)module.exports={version:'1.0.0',getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks,_config:_config,_session:_session,_servers:_servers};
