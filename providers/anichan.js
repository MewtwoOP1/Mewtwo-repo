// AniChan — AniList-backed anime source with session-aware multi-server playback.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'anichan';
var SITE = 'https://anichan.to';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
var CACHE = {};
var SESSION = null;
var ANICHAN_ACTIVE_KEYSET = null;

function getInfo() {
  return { name:'AniChan', lang:'en', baseUrl:SITE, logo:'https://www.google.com/s2/favicons?sz=256&domain=anichan.to', type:'anime', version:'1.0.3' };
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
  return {
    id:'anichan://anime/'+m.id,
    title:_title(m)+(m.seasonYear?' ('+m.seasonYear+')':''),
    englishTitle:m.title&&m.title.english||null,
    nativeTitle:m.title&&m.title.native||null,
    synonyms:Array.isArray(m.synonyms)?m.synonyms:[],
    url:'anichan://anime/'+m.id,
    cover:m.coverImage&&(m.coverImage.extraLarge||m.coverImage.large)||null,
    banner:m.bannerImage||null,
    description:m.description||'',
    status:_status(m.status),
    genres:m.genres||[],
    studios:m.studios&&m.studios.nodes?m.studios.nodes.map(function(x){return x.name;}):[],
    malId:Number(m.idMal)||null,
    year:m.seasonYear!=null?String(m.seasonYear):null,
    score:m.averageScore||null,
    type:'anime',sourceId:SOURCE_ID
  };
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
      if(count>0){for(var n=1;n<=count;n++){episodes.push({id:'anichan://episode/'+id+'/'+n+'/sub',url:'anichan://episode/'+id+'/'+n+'/sub',number:n,title:'Episode '+n,sourceId:SOURCE_ID,type:'anime',category:'sub'});if(dub)episodes.push({id:'anichan://episode/'+id+'/'+n+'/dub',url:'anichan://episode/'+id+'/'+n+'/dub',number:n,title:'Episode '+n,sourceId:SOURCE_ID,type:'anime',category:'dub'});}}
      if(_config().audioMode==='sub')episodes=episodes.filter(function(x){return x.category==='sub';});
      if(_config().audioMode==='dub')episodes=episodes.filter(function(x){return x.category==='dub';});
      var out=_item(m);out.episodes=episodes;out.subCount=count;out.dubCount=dub?count:0;return out;
    });
  });
}
function getEpisodes(url,opts) { return getDetail(url,opts).then(function(d){return d.episodes||[];}); }
function _session(force) {
  if(!force&&SESSION&&Date.now()<SESSION.expires&&(!_config().refresh||SESSION.expires-Date.now()>60000))return Promise.resolve(SESSION);
  return _fetch(SITE+'/api/watch/session',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','Origin':SITE,'Referer':SITE+'/'},body:'{"token":""}'}).then(function(r){
    var body={};try{body=JSON.parse(r.body||'{}');}catch(e){}
    var nonce=String(body.n||'');if(!nonce)throw new Error('AniChan session did not return nonce n');
    var headers=r.headers||{},setCookie=null;
    Object.keys(headers).some(function(k){if(k.toLowerCase()==='set-cookie'){var value=headers[k];setCookie=Array.isArray(value)?value.join(', '):String(value||'');return true;}return false;});
    var match=String(setCookie||'').match(/(?:^|[,;]\s*)anichan_ws=([^;,\s]+)/i);
    var cookie=match?'anichan_ws='+match[1]:'';
    if(!cookie&&body.cookie){cookie=String(body.cookie);if(cookie.indexOf('=')<0)cookie='anichan_ws='+cookie;}
    if(!cookie)throw new Error('AniChan session response did not include anichan_ws cookie');
    var exp=Number(body.exp)||((Date.now()/1000)+3600);if(exp<1000000000000)exp=exp*1000;
    SESSION={nonce:nonce,cookie:cookie,expires:exp-60000};
    return SESSION;
  });
}
function _serverTier(id,ep,category,tier,session,keyset){
  var referer=SITE+'/anime/'+id+'/watch/'+ep;
  var url=SITE+'/api/watch/servers?anilistId='+encodeURIComponent(String(id))+'&ep='+encodeURIComponent(String(ep))+
    '&category='+encodeURIComponent(category)+'&tier='+encodeURIComponent(tier);
  return fetch(url,{headers:{
    'User-Agent':UA,'Accept':'application/json','Referer':referer,'Origin':SITE,
    'Cookie':session.cookie,'X-Wk':keyset.id
  },timeoutMs:_config().timeout}).then(function(r){
    var status=Number(r&&r.status||0),body={};try{body=JSON.parse(r&&r.body||'{}');}catch(e){}
    if(status===401||body.detail==='session'){var sessionError=new Error('AniChan watch session expired');sessionError.session=true;throw sessionError;}
    if(status<200||status>=300)throw new Error('AniChan servers '+tier+' HTTP '+status);
    if(body.v===1&&body.i&&body.d)return _acDecryptEnvelope(body,session,keyset);
    return body;
  }).then(function(data){
    var rows=Array.isArray(data)?data:(data&&Array.isArray(data.servers)?data.servers:[]);
    return rows;
  });
}
function _collectServerTiers(id,ep,category,session,keyset){
  var cuts=category==='dub'?['dub']:['sub','hsub'],tiers=['fast','rest'],rows=[],combo=[];
  cuts.forEach(function(c){tiers.forEach(function(t){combo.push({category:c,tier:t});});});
  var index=0;
  function next(){
    if(index>=combo.length)return Promise.resolve(rows);
    var item=combo[index++];
    return _serverTier(id,ep,item.category,item.tier,session,keyset).then(function(found){
      found.forEach(function(server){
        if(!server)return;
        var url=String(server.stream||server.embed||'');
        if(url&&!rows.some(function(x){return String(x.stream||x.embed||'')===url;}))rows.push(server);
      });
      return next();
    });
  }
  return next();
}
function _refreshKeys(){
 return _fetch(SITE+'/',{headers:{'Accept':'text/html,application/xhtml+xml','Referer':SITE+'/'},timeoutMs:_config().timeout}).then(function(response){
  var html=String(response.body||''),urls=[],re=/src=["'](\/_next\/static\/chunks\/[^"']+\.js)["']/gi,m;
  while((m=re.exec(html))!==null&&urls.length<12){var u=m[1];if(urls.indexOf(u)<0)urls.push(u);}
  var index=0;
  function next(){
   if(index>=urls.length)return null;
   var url=urls[index++].charAt(0)==='/'?SITE+urls[index-1]:urls[index-1];
   return _fetch(url,{headers:{'Accept':'*/*','Referer':SITE+'/'},timeoutMs:_config().timeout}).then(function(r){
    var code=String(r.body||'');
    var match=code.match(/["']([0-9a-f]{8})["'],[A-Za-z_$][\w$]*=["']([A-Za-z0-9+/=]{44})["'],[A-Za-z_$][\w$]*=["']([A-Za-z0-9+/=]{44})["']/i);
    if(!match)return next();
    var key={id:match[1],p:match[2],i:match[3]};
    if(!ANICHAN_KEYSETS.some(function(x){return x.id===key.id&&x.p===key.p&&x.i===key.i;}))ANICHAN_KEYSETS.unshift(key);
    ANICHAN_ACTIVE_KEYSET=key;
    return key;
   }).catch(function(){return next();});
  }
  return next();
 }).catch(function(error){console.warn('AniChan key refresh failed:',String(error));return null;});
}
function _servers(id,ep,category,force){
 return _session(!!force).then(function(session){
  var keys=[];
  if(ANICHAN_ACTIVE_KEYSET)keys.push(ANICHAN_ACTIVE_KEYSET);
  ANICHAN_KEYSETS.forEach(function(k){if(!keys.some(function(x){return x.id===k.id&&x.p===k.p&&x.i===k.i;}))keys.push(k);});
  var lastError=null,index=0;
  function tryKey(){
   if(index>=keys.length){
    return _refreshKeys().then(function(refreshed){
     if(!refreshed||keys.some(function(x){return x.id===refreshed.id&&x.p===refreshed.p&&x.i===refreshed.i;})){
      if(lastError)throw lastError;
      return [];
     }
     return _collectServerTiers(id,ep,category,session,refreshed).then(function(rows){
      if(rows.length)ANICHAN_ACTIVE_KEYSET=refreshed;
      return rows;
     });
    });
   }
   var keyset=keys[index++];
   return _collectServerTiers(id,ep,category,session,keyset).then(function(rows){
    if(rows.length){ANICHAN_ACTIVE_KEYSET=keyset;return rows;}
    return tryKey();
   }).catch(function(error){
    lastError=error;
    if(error&&error.session&&!force){SESSION=null;return _servers(id,ep,category,true);}
    return tryKey();
   });
  }
  return tryKey();
 });
}
function _abs(url) { var s=String(url||'');var full=s.charAt(0)==='/'?SITE+s:s;return full.replace(/ /g,'%20'); }
function _subtitleLanguage(label) {
  var s=String(label||'').toLowerCase();
  return s.indexOf('eng')===0?'en':s.indexOf('spa')===0?'es':s.indexOf('por')===0?'pt':s.indexOf('fre')===0||s.indexOf('fra')===0?'fr':s.indexOf('ger')===0?'de':s.indexOf('ita')===0?'it':s.indexOf('ara')===0?'ar':s.indexOf('rus')===0?'ru':s.indexOf('kor')===0?'ko':s.indexOf('jap')===0?'ja':s.indexOf('chi')===0?'zh':'und';
}

var MIRURO_FALLBACK_HOSTS=['https://api.hiyori.tv','https://miruro.zenos.my.id','https://www.neoanime.tv'];
var MIRURO_PROVIDER_ORDER=['kiwi','animepahe','arc','zoro','jet','bee','bonk','hop','pewe','ally','nun','bun','twin','cog','moo','sun','knob','telli'];
function _mfRoot(v){var r=v||{};for(var i=0;i<3&&r&&typeof r==='object'&&!Array.isArray(r);i++){if(r.results&&typeof r.results==='object'&&!Array.isArray(r.results))r=r.results;else if(r.data&&typeof r.data==='object'&&!Array.isArray(r.data)&&(r.data.providers||r.data.streams))r=r.data;else break;}return r||{};}
function _mfGet(host,path){var url=String(host).replace(/\/+$/,'')+'/'+String(path).replace(/^\/+/, '');return fetch(url,{headers:{'Accept':'application/json','User-Agent':UA},timeoutMs:10000}).then(function(r){var status=Number(r&&r.status||0),body=r&&r.body!=null?r.body:'';if(status<200||status>=300)throw new Error('HTTP '+status+' from '+url);if(typeof body!=='string')body=String(body||'');if(!body&&r&&typeof r.text==='function')return r.text().then(function(t){try{return JSON.parse(t||'null');}catch(e){throw new Error('Invalid JSON from '+url);}});try{return JSON.parse(body||'null');}catch(e){throw new Error('Invalid JSON from '+url);}});}
function _mfOptions(payload,num,cat){var root=_mfRoot(payload),providers=root.providers||{},names=Object.keys(providers);names.sort(function(a,b){var ai=MIRURO_PROVIDER_ORDER.indexOf(String(a).toLowerCase()),bi=MIRURO_PROVIDER_ORDER.indexOf(String(b).toLowerCase());if(ai<0)ai=999;if(bi<0)bi=999;return ai===bi?a.localeCompare(b):ai-bi;});var out=[];names.forEach(function(name){var p=providers[name]||{},lists=p.episodes||p,cats=cat==='dub'?['dub']:['sub','hsub'];cats.forEach(function(c){var rows=Array.isArray(lists[c])?lists[c]:[];rows.forEach(function(e){if(!e||Number(e.number||e.episode||e.ep)!==Number(num))return;var id=String(e.id||e.url||'').trim();if(!id)return;if(/^https?:\/\//i.test(id)){out.push({provider:name,route:id,direct:true});return;}id=id.replace(/^\/+/, '');if(id.indexOf('watch/')!==0)return;out.push({provider:name,route:id,direct:false,slug:id.split('/').pop()||''});});});});var seen={};return out.filter(function(o){var k=o.provider+'|'+o.route;if(seen[k])return false;seen[k]=1;return true;});}
function _mfStreams(payload,provider,cat){var root=_mfRoot(payload),rows=Array.isArray(root)?root:(Array.isArray(root.streams)?root.streams:(root.bestStream&&root.bestStream.url?[root.bestStream].concat(root.streams||[]):(root.stream&&root.stream.url?[root.stream]:[]))),subs=Array.isArray(root.subtitles)?root.subtitles:[],out=rows.map(function(x){if(!x)return null;var u=String(x.url||x.file||'').trim();if(!/^https?:\/\//i.test(u))return null;var h={};if(x.headers&&typeof x.headers==='object')Object.keys(x.headers).forEach(function(k){h[k]=String(x.headers[k]);});var ref=x.referer||x.referrer||null;if(ref&&!h.Referer&&!h.referer)h.Referer=String(ref);var t=String(x.type||x.format||'').toLowerCase(),ct=/\.mpd(?:[?#]|$)/i.test(u)||t==='dash'?'dash':(/\.m3u8(?:[?#]|$)/i.test(u)||t==='hls'?'hls':(/\.mp4(?:[?#]|$)/i.test(u)||t==='mp4'?'mp4':undefined));return {url:u,container:ct,type:x.type||x.format||ct,quality:x.quality||x.label||x.name||'Auto',label:(x.quality||x.label||x.name||'Auto')+' · Miruro ('+provider+')',kind:cat,audioLang:cat==='dub'?'en':'ja',headers:h,referer:ref||undefined,subtitles:[]};}).filter(Boolean);if(out.length&&subs.length)out[0].subtitles=subs.map(function(q){if(!q)return null;var u=String(q.url||q.file||'');if(!/^https?:\/\//i.test(u))return null;return {url:u,label:q.label||q.title||q.language||'Subtitle',lang:q.language||q.lang||'',format:q.format||'vtt'};}).filter(Boolean);return out;}
function _miruroFallback(id,num,cat,label,hostsOverride){var hosts=Array.isArray(hostsOverride)&&hostsOverride.length?hostsOverride.slice():MIRURO_FALLBACK_HOSTS.slice(),last=null;function hostAt(i){if(i>=hosts.length)return Promise.reject(last||new Error(label+': no Miruro host responded'));var host=String(hosts[i]).replace(/\/+$/,'');return _mfGet(host,'episodes/'+encodeURIComponent(String(id))).then(function(payload){var opts=_mfOptions(payload,num,cat);if(!opts.length)throw new Error(label+': Miruro has no real provider episode ID for episode '+num+' ('+cat+')');var optError=null;function optionAt(j){if(j>=opts.length)return Promise.reject(optError||new Error(label+': no playable Miruro provider'));var o=opts[j];if(o.direct)return Promise.resolve([{url:o.route,container:/\.m3u8/i.test(o.route)?'hls':(/\.mpd/i.test(o.route)?'dash':'mp4'),quality:'Auto',label:'Miruro direct ('+o.provider+')',kind:cat,audioLang:cat==='dub'?'en':'ja',headers:{},subtitles:[]}]);var routes=[o.route,'stream?provider='+encodeURIComponent(o.provider)+'&anilistId='+encodeURIComponent(String(id))+'&category='+encodeURIComponent(cat)+'&slug='+encodeURIComponent(o.slug),'sources?episodeId='+encodeURIComponent(o.route)+'&provider='+encodeURIComponent(o.provider)+'&anilistId='+encodeURIComponent(String(id))+'&category='+encodeURIComponent(cat)];function routeAt(k){if(k>=routes.length)return Promise.reject(optError||new Error('Miruro route failed: '+o.provider));return _mfGet(host,routes[k]).then(function(v){var streams=_mfStreams(v,o.provider,cat);if(!streams.length)throw new Error('No streams from '+o.provider);return streams;}).catch(function(e){optError=e;return routeAt(k+1);});}return routeAt(0).catch(function(e){optError=e;return optionAt(j+1);});}return optionAt(0);}).catch(function(e){last=e;return hostAt(i+1);});}return hostAt(0);}

var ANICHAN_KEYSETS=[
 {id:'6be19f72',p:'wuEoOR48/o2oD14z71nB9MG2eC3T5q+uayZj5fb3Xsk=',i:'0Avpb+a3t0ihtp6DLmBkfB3wStHog0zOAhKALhnfeC4='},
 {id:'a8c6e3d0',p:'ICo+KyF5ANB1XEOjrMNcodrjnVH2OpV1CYKx1HPMlUc=',i:'DWT7cCRlI2rx2AVa5vICiZsrxK3My5duU3Y2Oys7FqQ='}
];
var ANICHAN_SHA_K=[
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
];
function _acB64(s){var chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',t=String(s||'').replace(/-/g,'+').replace(/_/g,'/').replace(/[^A-Za-z0-9+/]/g,''),out=[];for(var i=0;i<t.length;i+=4){var a=chars.indexOf(t.charAt(i)),b=chars.indexOf(t.charAt(i+1)),c=chars.indexOf(t.charAt(i+2)),d=chars.indexOf(t.charAt(i+3));if(a<0||b<0)continue;out.push(((a<<2)|(b>>4))&255);if(c>=0)out.push((((b&15)<<4)|(c>>2))&255);if(d>=0&&c>=0)out.push((((c&3)<<6)|d)&255);}return new Uint8Array(out);}
function _acB64Encode(bytes){var chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out='';for(var i=0;i<bytes.length;i+=3){var a=bytes[i]&255,b=i+1<bytes.length?bytes[i+1]&255:NaN,c=i+2<bytes.length?bytes[i+2]&255:NaN;out+=chars.charAt(a>>2)+chars.charAt(((a&3)<<4)|(b>>4));out+=isNaN(b)?'=':chars.charAt(((b&15)<<2)|(c>>6));out+=isNaN(c)?'=':chars.charAt(c&63);}return out;}
function _acHex(bytes){var out='';for(var i=0;i<bytes.length;i++){var h=(bytes[i]&255).toString(16);out+=h.length===1?'0'+h:h;}return out;}
function _acUtf8Ascii(s){s=String(s||'');var out=new Uint8Array(s.length);for(var i=0;i<s.length;i++)out[i]=s.charCodeAt(i)&255;return out;}
function _acConcat(a,b){var out=new Uint8Array(a.length+b.length);out.set(a,0);out.set(b,a.length);return out;}
function _acSha256(input){
 var len=input.length,total=Math.ceil((len+9)/64)*64,msg=new Uint8Array(total);msg.set(input);msg[len]=128;
 var bits=len*8,hi=Math.floor(bits/4294967296),lo=bits>>>0;
 msg[total-8]=(hi>>>24)&255;msg[total-7]=(hi>>>16)&255;msg[total-6]=(hi>>>8)&255;msg[total-5]=hi&255;
 msg[total-4]=(lo>>>24)&255;msg[total-3]=(lo>>>16)&255;msg[total-2]=(lo>>>8)&255;msg[total-1]=lo&255;
 var h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Array(64);
 function rr(x,n){return (x>>>n)|(x<<(32-n));}
 for(var off=0;off<total;off+=64){
  for(var i=0;i<16;i++){var j=off+i*4;w[i]=((msg[j]<<24)|(msg[j+1]<<16)|(msg[j+2]<<8)|msg[j+3])>>>0;}
  for(var i=16;i<64;i++){var x=w[i-15],y=w[i-2],s0=rr(x,7)^rr(x,18)^(x>>>3),s1=rr(y,17)^rr(y,19)^(y>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;}
  var a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],z=h[7];
  for(var i=0;i<64;i++){var S1=rr(e,6)^rr(e,11)^rr(e,25),ch=(e&f)^(~e&g),t1=(z+S1+ch+ANICHAN_SHA_K[i]+w[i])>>>0,S0=rr(a,2)^rr(a,13)^rr(a,22),maj=(a&b)^(a&c)^(b&c),t2=(S0+maj)>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  h[0]=(h[0]+a)>>>0;h[1]=(h[1]+b)>>>0;h[2]=(h[2]+c)>>>0;h[3]=(h[3]+d)>>>0;h[4]=(h[4]+e)>>>0;h[5]=(h[5]+f)>>>0;h[6]=(h[6]+g)>>>0;h[7]=(h[7]+z)>>>0;
 }
 var result=new Uint8Array(32);for(var i=0;i<8;i++){result[i*4]=(h[i]>>>24)&255;result[i*4+1]=(h[i]>>>16)&255;result[i*4+2]=(h[i]>>>8)&255;result[i*4+3]=h[i]&255;}return result;
}
function _acHmac(key,data){if(key.length>64)key=_acSha256(key);var block=new Uint8Array(64);block.set(key);var inner=new Uint8Array(64),outer=new Uint8Array(64);for(var i=0;i<64;i++){inner[i]=block[i]^0x36;outer[i]=block[i]^0x5c;}return _acSha256(_acConcat(outer,_acSha256(_acConcat(inner,data))));}
function _acDecryptEnvelope(envelope,session,keyset){
 if(typeof aesCtrDecrypt!=='function')return Promise.reject(new Error('AniChan requires Zangetsu AES-CTR crypto bridge'));
 var p=_acB64(keyset.p),q=_acB64(keyset.i);if(p.length!==q.length||p.length!==32)return Promise.reject(new Error('AniChan invalid key material'));
 var key0=new Uint8Array(32);for(var i=0;i<32;i++)key0[i]=p[i]^q[i];
 var aesKey=_acHmac(key0,_acUtf8Ascii(session.nonce)),iv=_acB64(envelope.i),payload=_acB64(envelope.d);
 if(iv.length!==12||payload.length<=16)return Promise.reject(new Error('AniChan invalid encrypted server payload'));
 var ciphertext=payload.subarray(0,payload.length-16);
 var counter=_acHex(iv)+'00000002';
 return aesCtrDecrypt({keyHex:_acHex(aesKey),counterHex:counter,dataB64:_acB64Encode(ciphertext)}).then(function(plain){
  var data;try{data=JSON.parse(String(plain||''));}catch(e){throw new Error('AniChan decrypted server response was not JSON');}
  return data;
 });
}

function getVideoSources(episodeUrl,opts) {
  var m=String(episodeUrl||'').match(/^anichan:\/\/episode\/(\d+)\/(\d+)\/(sub|dub)$/i);
  if(!m)return Promise.reject(new Error('AniChan: invalid episode URL'));
  var id=Number(m[1]),ep=Number(m[2]),category=m[3].toLowerCase();
  var native=_servers(id,ep,category,false).then(function(rows){
    var usable=rows.filter(function(x){var u=String(x&&x.stream||'');return x&&String(x.type||'').toLowerCase()!=='embed'&&(/^https?:\/\//i.test(u)||/^\//.test(u));})
      .sort(function(a,b){return (Number(a.rank)||9999)-(Number(b.rank)||9999);}).slice(0,_config().maxStreams);
    if(!usable.length)throw new Error('AniChan signed server API returned no direct stream for episode '+ep+' ('+category+')');
    var subs=(Array.isArray(usable[0].subtitles)?usable[0].subtitles:[]).map(function(x){
      if(!x||!x.url)return null;var label=String(x.lang||x.label||'Subtitles');
      return {url:_abs(x.url),label:label,lang:_subtitleLanguage(label),format:'vtt'};
    }).filter(Boolean);
    return usable.map(function(x,i){
      var url=_abs(x.stream),type=String(x.type||'hls').toLowerCase(),container=/\.mpd(?:[?#]|$)/i.test(url)||type==='dash'?'dash':(/\.mp4(?:[?#]|$)/i.test(url)||type==='mp4'?'mp4':'hls');
      return {url:url,container:container,type:type,quality:String(x.label||x.name||('Server '+(i+1))).replace(/^★/,'').trim(),label:String(x.label||x.name||('Server '+(i+1))).replace(/^★/,'').trim(),kind:category,audioLang:category==='dub'?'en':'ja',headers:{'User-Agent':UA,'Referer':SITE+'/'},referer:SITE+'/',subtitles:i===0?subs:[],isActive:i===0};
    });
  });
  return native.catch(function(error){
    console.warn('AniChan signed servers unavailable; trying real Miruro episode sources:',String(error));
    return _miruroFallback(id,ep,category,'AniChan');
  });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=='undefined'&&module.exports)module.exports={version:'1.0.3',getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks,_config:_config,_session:_session,_servers:_servers};
