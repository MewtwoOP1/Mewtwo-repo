// AnimePahe — ID-confirmed AnimePahe resolution with a Miruro/Kiwi fallback.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animepahe';
var SITE = 'https://animepahe.pw';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var DEFAULT_MIRURO_HOSTS = ['https://api.hiyori.tv','https://miruro.zenos.my.id','https://www.neoanime.tv'];
var CACHE = {};
var SESSIONS = {};

function getInfo(){return {name:'AnimePahe',lang:'en',baseUrl:SITE,logo:'https://www.google.com/s2/favicons?sz=256&domain=animepahe.pw',type:'anime',version:'1.0.0'};}
function getSettings(){
 return [
  {key:'audioMode',label:'Audio tracks',description:'Show both SUB and DUB when available, or filter to one track.',type:'enum',default:'both',options:[{value:'both',label:'Sub and dub'},{value:'sub',label:'Sub only'},{value:'dub',label:'Dub only'}]},
  {key:'miruroApiHosts',label:'Playback fallback API hosts',description:'Ordered Miruro JSON API hosts used if direct AnimePahe or Kwik requests are blocked. Comma or newline separated.',type:'text',default:DEFAULT_MIRURO_HOSTS.join('\n')},
  {key:'directTimeoutMs',label:'Direct AnimePahe request timeout',description:'Maximum wait for an individual direct request. The provider falls back to the API route when direct requests fail.',type:'enum',default:'5000',options:[{value:'3000',label:'3 seconds'},{value:'5000',label:'5 seconds'},{value:'8000',label:'8 seconds'}]},
  {key:'directLookup',label:'Try direct AnimePahe first',description:'Attempt the direct, ID-confirmed AnimePahe player before using the configured Miruro/Kiwi playback fallback.',type:'bool',default:true},
  {key:'preferH264',label:'Prefer H.264 over AV1',description:'Prefer a compatible H.264 encode over AV1, especially useful on older TV hardware.',type:'bool',default:true},
  {key:'qualityPreference',label:'Preferred resolution',description:'Direct AnimePahe release selection preference.',type:'enum',default:'1080p',options:[{value:'1080p',label:'1080p'},{value:'720p',label:'720p'},{value:'480p',label:'480p'},{value:'360p',label:'360p'}]},
  {key:'maxTitleCandidates',label:'Title candidates to confirm',description:'Number of AnimePahe search matches checked against AniList or MAL IDs. Lower values are faster and reduce false matches.',type:'enum',default:'3',options:[{value:'1',label:'1 candidate'},{value:'2',label:'2 candidates'},{value:'3',label:'3 candidates'}]},
  {key:'requestCacheSeconds',label:'Metadata cache',description:'Short in-memory cache for AniList metadata and episode catalogues.',type:'enum',default:'120',options:[{value:'0',label:'Disabled'},{value:'60',label:'1 minute'},{value:'120',label:'2 minutes'},{value:'300',label:'5 minutes'}]}
 ];
}
function _setting(k){try{var s=typeof __settings!=='undefined'&&__settings?__settings[SOURCE_ID]:null;return s&&s[k]!=null?s[k]:null;}catch(e){return null;}}
function _bool(v,d){if(v==null)return d;if(v===true||String(v).toLowerCase()==='true')return true;if(v===false||String(v).toLowerCase()==='false')return false;return d;}
function _int(v,d,min,max){var n=parseInt(v,10);return isFinite(n)?Math.max(min,Math.min(max,n)):d;}
function _config(){
 var hosts=String(_setting('miruroApiHosts')||DEFAULT_MIRURO_HOSTS.join('\n')).split(/[,\n;]+/).map(function(x){return x.trim().replace(/\/+$/,'');}).filter(function(x){return /^https:\/\//i.test(x);});
 if(!hosts.length)hosts=DEFAULT_MIRURO_HOSTS.slice();
 hosts=hosts.filter(function(x,i){return hosts.indexOf(x)===i;});
 return {audioMode:String(_setting('audioMode')||'both').toLowerCase(),hosts:hosts,directTimeout:_int(_setting('directTimeoutMs'),5000,2000,12000),directLookup:_bool(_setting('directLookup'),true),preferH264:_bool(_setting('preferH264'),true),quality:String(_setting('qualityPreference')||'1080p'),maxCandidates:_int(_setting('maxTitleCandidates'),3,1,3),cacheMs:_int(_setting('requestCacheSeconds'),120,0,300)*1000};
}
function _fetch(url,opts){
 var o=opts||{},headers=Object.assign({'User-Agent':UA,'Accept':'*/*'},o.headers||{});
 return fetch(url,Object.assign({},o,{headers:headers,timeoutMs:o.timeoutMs||_config().directTimeout})).then(function(r){
  var status=Number(r&&r.status||0);if(status<200||status>=300){var e=new Error('HTTP '+status+' from '+url);e.status=status;e.body=String(r&&r.body||'').slice(0,160);throw e;}return r;
 });
}
function _jsonFetch(url,opts){return _fetch(url,opts).then(function(r){try{return JSON.parse(r.body||'null');}catch(e){throw new Error('Invalid JSON from '+url);}});}
function _graph(query,variables){
 return _fetch(ANILIST,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query:query,variables:variables||{}}),timeoutMs:10000})
 .then(function(r){var j;try{j=JSON.parse(r.body||'null');}catch(e){throw new Error('AniList invalid JSON');}if(j.errors&&j.errors.length)throw new Error('AniList: '+String(j.errors[0].message||'query failed'));return j.data||{};});
}
var MEDIA_FIELDS='id idMal title { english romaji native } description(asHtml:false) coverImage { extraLarge large } bannerImage episodes status genres seasonYear averageScore isAdult synonyms';
function _cacheGet(key){var x=CACHE[key];return x&&x.until>Date.now()?x.value:null;}
function _cachePut(key,value){if(_config().cacheMs>0)CACHE[key]={value:value,until:Date.now()+_config().cacheMs};return value;}
function _media(id){var k='media:'+id,c=_cacheGet(k);if(c)return Promise.resolve(c);return _graph('query($id:Int){Media(id:$id,type:ANIME){'+MEDIA_FIELDS+'}}',{id:Number(id)}).then(function(d){if(!d.Media)throw new Error('AniList title not found: '+id);if(d.Media.isAdult)throw new Error('AnimePahe: adult title hidden');return _cachePut(k,d.Media);});}
function _title(m){return m&&m.title&&(m.title.english||m.title.romaji||m.title.native)||'Anime';}
function _item(m){if(!m||!m.id||m.isAdult)return null;return {id:'animepahe://anime/'+m.id,url:'animepahe://anime/'+m.id,title:_title(m)+(m.seasonYear?' ('+m.seasonYear+')':''),cover:m.coverImage&&(m.coverImage.extraLarge||m.coverImage.large)||null,banner:m.bannerImage||null,description:m.description||'',year:m.seasonYear||null,score:m.averageScore||null,genres:m.genres||[],type:'anime',sourceId:SOURCE_ID,status:m.status==='FINISHED'?'completed':m.status==='RELEASING'?'ongoing':'unknown'};}
function _anilistPage(sort,page){return _graph('query($page:Int){Page(page:$page,perPage:20){media(type:ANIME,sort:'+sort+',isAdult:false){'+MEDIA_FIELDS+'}}}',{page:page||1}).then(function(d){return (d.Page&&d.Page.media||[]).map(_item).filter(Boolean);});}
function search(q,page,opts){q=String(q||'').trim();if(!q)return Promise.resolve([]);return _graph('query($search:String,$page:Int){Page(page:$page,perPage:20){media(search:$search,type:ANIME,sort:SEARCH_MATCH,isAdult:false){'+MEDIA_FIELDS+'}}}',{search:q,page:Math.max(1,_int(page,1,1,100))}).then(function(d){return (d.Page&&d.Page.media||[]).map(_item).filter(Boolean);}).catch(function(e){console.warn('AnimePahe search failed',String(e));return [];});}
function getHome(opts){return Promise.all([_anilistPage('TRENDING_DESC',1),_anilistPage('POPULARITY_DESC',1)]).then(function(rows){return [{title:'Trending Anime',items:rows[0]},{title:'Popular Anime',items:rows[1]}].filter(function(x){return x.items.length;});}).catch(function(){return [];});}
function popular(opts){return _anilistPage('POPULARITY_DESC',1).catch(function(){return [];});}
function _id(url){var m=String(url||'').match(/(?:animepahe:\/\/anime\/|\/)(\d+)(?:[/?#]|$)/)||String(url||'').match(/^(\d+)$/);if(!m)throw new Error('AnimePahe: invalid AniList ID');return Number(m[1]);}
function _apiPath(path){return path.replace(/^\/+/,'');}
function _mirrorGet(path,index){
 var cfg=_config(),i=index||0;if(i>=cfg.hosts.length)return Promise.reject(new Error('All Miruro API hosts failed for '+path));
 return _jsonFetch(cfg.hosts[i].replace(/\/+$/,'')+'/'+_apiPath(path),{headers:{'Accept':'application/json'},timeoutMs:8000}).catch(function(e){console.warn('AnimePahe fallback API failed:',cfg.hosts[i],String(e));return _mirrorGet(path,i+1);});
}
function _unwrap(data){if(data&&data.results&&typeof data.results==='object')return data.results;return data||{};}
function _episodeUrl(id,ep,cat,slug,route){return 'animepahe://episode/'+encodeURIComponent(JSON.stringify({id:id,number:ep,category:cat,slug:slug||'',route:route||''}));}
function _episodesFromMiruro(id,data){
 var root=_unwrap(data),providers=root.providers||{},kiwi=providers.kiwi||providers.animepahe||null;
 if(!kiwi||!kiwi.episodes)return [];
 var eps=kiwi.episodes, out=[];
 ['sub','dub'].forEach(function(cat){if(_config().audioMode!=='both'&&_config().audioMode!==cat)return;
  (Array.isArray(eps[cat])?eps[cat]:[]).forEach(function(ep){var n=Number(ep.number||ep.episode);if(!(n>0))return;var route=String(ep.id||ep.url||''),slug=route.split('/').pop()||('animepahe-'+n);out.push({id:_episodeUrl(id,n,cat,slug,route),url:_episodeUrl(id,n,cat,slug,route),number:n,title:ep.title||('Episode '+n),image:ep.image||ep.thumbnail||null,airDate:ep.airDate||null,duration:ep.duration||null,filler:!!ep.filler,type:'anime',sourceId:SOURCE_ID,category:cat});});
 });
 return out.sort(function(a,b){return a.number-b.number||(a.category==='sub'?-1:1);});
}
function _mirrorEpisodes(id,force){
 var key='episodes:'+id,c=!force&&_cacheGet(key);if(c)return Promise.resolve(c);
 return _mirrorGet('episodes/'+id).then(function(data){var rows=_episodesFromMiruro(id,data);if(!rows.length)throw new Error('Miruro did not list a Kiwi/AnimePahe catalogue for '+id);return _cachePut(key,rows);});
}
function getDetail(url,opts){
 var id=_id(url);
 return Promise.all([_media(id),_mirrorEpisodes(id,opts&&opts.forceRefresh).catch(function(e){console.warn('AnimePahe episode catalogue unavailable',String(e));return [];})]).then(function(r){var out=_item(r[0]);out.episodes=r[1];out.subCount=out.episodes.filter(function(x){return x.category==='sub';}).length;out.dubCount=out.episodes.filter(function(x){return x.category==='dub';}).length;return out;});
}
function getEpisodes(url,opts){return _mirrorEpisodes(_id(url),opts&&opts.forceRefresh).catch(function(e){console.warn('AnimePahe episode lookup failed',String(e));return [];});}
function _decodeEpisode(url){
 var m=String(url||'').match(/^animepahe:\/\/episode\/(.+)$/i);if(!m)throw new Error('AnimePahe: invalid episode URL');
 var x;try{x=JSON.parse(decodeURIComponent(m[1]));}catch(e){throw new Error('AnimePahe: malformed episode data');}
 if(!x||!Number(x.id)||!Number(x.number)||!['sub','dub'].includes(x.category))throw new Error('AnimePahe: incomplete episode data');return x;
}
function _headers(url){return {'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*;q=0.8','Referer':url||SITE+'/'};}
function _directGet(path,referer){
 var url=SITE+path;
 return _fetch(url,{headers:_headers(referer),browser:true,timeoutMs:_config().directTimeout}).then(function(r){return String(r.body||'');});
}
function _jsonString(v){return String(v||'').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');}
function _parseSearch(j){return (j&&Array.isArray(j.data)?j.data:[]).filter(function(x){return x&&x.session;}).map(function(x){return {session:String(x.session),title:String(x.title||''),episodes:Number(x.episodes)||0};});}
function _parseIds(html){
 var a=(html.match(/(?:anilist\.co\/anime\/|name=["']anilist["'][^>]*content=["'])(\d+)/i)||[])[1];
 var m=(html.match(/(?:myanimelist\.net\/anime\/|name=["']mal["'][^>]*content=["'])(\d+)/i)||[])[1];
 return {anilistId:Number(a)||0,malId:Number(m)||0};
}
function _confirmedSession(media){
 var hit=SESSIONS[media.id];if(hit)return Promise.resolve(hit);
 var titles=[media.title&&media.title.english,media.title&&media.title.romaji].concat(media.synonyms||[]).filter(Boolean).map(function(x){return String(x).trim();}).filter(function(x,i,a){return x&&a.indexOf(x)===i;});
 var index=0;
 function nextTitle(){
  if(index>=titles.length)return Promise.reject(new Error('AnimePahe has no confirmed AniList/MAL match'));
  var q=titles[index++];
  return _directGet('/api?m=search&l=8&q='+encodeURIComponent(q),SITE+'/').then(function(body){var rows=_parseSearch(JSON.parse(body||'{}'));var candidates=rows.slice(0,_config().maxCandidates),ci=0;
   function confirm(){
    if(ci>=candidates.length)return nextTitle();
    var c=candidates[ci++];
    return _directGet('/anime/'+c.session,SITE+'/').then(function(html){var ids=_parseIds(html);if(ids.anilistId===media.id||(media.idMal&&ids.malId===media.idMal)){SESSIONS[media.id]=c.session;return c.session;}return confirm();}).catch(function(){return confirm();});
   }
   return confirm();
  }).catch(function(e){if(e&&e.status===403)throw e;return nextTitle();});
 }
 return nextTitle();
}
function _parseRelease(body){
 var j=JSON.parse(body||'{}'), rows=Array.isArray(j.data)?j.data:[], eps={};
 rows.forEach(function(x){var n=Number(x.episode),s=String(x.session||'');if(n>0&&s)eps[n]=s;});
 return {total:Number(j.total)||Object.keys(eps).length,perPage:Number(j.per_page)||rows.length,lastPage:Number(j.last_page)||1,episodes:eps};
}
function _episodeSession(series,episode){
 return _directGet('/api?m=release&id='+encodeURIComponent(series)+'&sort=episode_asc&page=1',SITE+'/').then(function(body){
  var first=_parseRelease(body);if(first.episodes[episode])return first.episodes[episode];
  var guess=first.perPage>0?Math.floor((episode-1)/first.perPage)+1:1;
  var pages=[];if(guess>1&&guess<=first.lastPage)pages.push(guess);
  for(var p=2;p<=Math.min(first.lastPage,20);p++)if(p!==guess)pages.push(p);
  var i=0;function next(){if(i>=pages.length)return Promise.reject(new Error('AnimePahe episode session not found: '+episode));var page=pages[i++];return _directGet('/api?m=release&id='+encodeURIComponent(series)+'&sort=episode_asc&page='+page,SITE+'/').then(function(b){var x=_parseRelease(b);return x.episodes[episode]||next();});}return next();
 });
}
function _attrs(s){var o={};String(s||'').replace(/([\w-]+)\s*=\s*(["'])(.*?)\2/g,function(_,k,q,v){o[k.toLowerCase()]=v;return _;});return o;}
function _variants(html){
 var out=[],re=/<button\b([^>]*\bdata-src\s*=[^>]*)>/gi,m;
 while((m=re.exec(html||''))!==null){var a=_attrs(m[1]),u=a['data-src']||'';if(!/^https:\/\/(?:www\.)?kwik\./i.test(u))continue;
  out.push({url:u,fansub:a['data-fansub']||'Kwik',resolution:Number(a['data-resolution'])||0,audio:(a['data-audio']||'jpn').toLowerCase(),av1:a['data-av1']==='1'});}
 return out;
}
function _selectVariant(rows,category){
 var dub=category==='dub',preference=parseInt(_config().quality,10)||1080;
 rows=rows.filter(function(x){return (x.audio!=='jpn')===dub;});
 rows.sort(function(a,b){
  var ae=dub&&a.audio==='eng'?1:0,be=dub&&b.audio==='eng'?1:0;if(ae!==be)return be-ae;
  if(_config().preferH264&&a.av1!==b.av1)return a.av1?1:-1;
  var ad=Math.abs((a.resolution||0)-preference),bd=Math.abs((b.resolution||0)-preference);return ad-bd;
 });
 return rows[0]||null;
}
function _decodeJsString(s){return String(s||'').replace(/\\x([0-9a-f]{2})/gi,function(_,h){return String.fromCharCode(parseInt(h,16));}).replace(/\\u([0-9a-f]{4})/gi,function(_,h){return String.fromCharCode(parseInt(h,16));}).replace(/\\\//g,'/').replace(/\\'/g,"'").replace(/\\"/g,'"').replace(/\\\\/g,'\\');}
function _unpack(html){
 var re=/eval\s*\(\s*function\s*\(p,a,c,k,e,d\)\s*\{[\s\S]*?\}\s*\(\s*(['"])((?:\\.|[^'"])*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\.|[^'"])*?)\5\.split\(\s*(['"])\|\7\s*\)/g;
 var m= re.exec(String(html||''));if(!m)return String(html||'');
 var p=_decodeJsString(m[2]),radix=Number(m[3]),count=Number(m[4]),dict=_decodeJsString(m[6]).split('|');
 for(var c=count-1;c>=0;c--){if(!dict[c])continue;var word=c.toString(radix);p=p.replace(new RegExp('\\b'+word+'\\b','g'),dict[c]);}
 return p;
}
function _playlist(html){
 var body=String(html||'');if(/eval\s*\(\s*function\s*\(p,a,c,k,e,d\)/.test(body))body=_unpack(body);
 var m=body.match(/https?:\\?\/\\?\/[^"'\\\s]+?\.m3u8[^"'\\\s]*/i);if(!m)return null;
 return m[0].replace(/\\\//g,'/').replace(/&amp;/g,'&');
}
function _directSources(media,episode){
 return _confirmedSession(media).then(function(series){return _episodeSession(series,episode.number);})
 .then(function(epSession){return _directGet('/play/'+encodeURIComponent(SESSIONS[media.id])+'/'+encodeURIComponent(epSession),SITE+'/');})
 .then(function(html){
  var chosen=_selectVariant(_variants(html),episode.category);
  if(!chosen&&episode.category==='dub')throw new Error('AnimePahe has no dub release for episode '+episode.number);
  var embed=chosen&&chosen.url;
  if(!embed){var legacy=html.match(/let\s+url\s*=\s*["']([^"']+)["']/i);embed=legacy&&legacy[1];}
  if(!embed)throw new Error('AnimePahe play page has no Kwik embed');
  return _fetch(embed,{headers:_headers(SITE+'/'),browser:true,timeoutMs:_config().directTimeout}).then(function(r){
    var playlist=_playlist(r.body||'');if(!playlist)throw new Error('Kwik player page has no M3U8 playlist');
    var ref=(embed.match(/^https:\/\/[^/]+/i)||[])[0]+'/';
    return [{url:playlist,container:'hls',type:'hls',quality:(chosen?chosen.fansub+' '+(chosen.resolution||'Auto')+'p':'Auto'),label:'Auto · AnimePahe',kind:episode.category,audioLang:episode.category==='dub'?'en':'ja',headers:{Referer:ref,'User-Agent':UA},referer:ref,subtitles:[]}];
  });
 });
}
function _mirrorStreams(episode){
 var encoded=episode.route||('watch/kiwi/'+episode.id+'/'+episode.category+'/animepahe-'+episode.number);
 var routes=[encoded,'stream?provider=kiwi&anilistId='+episode.id+'&category='+episode.category+'&slug='+encodeURIComponent(episode.slug||('animepahe-'+episode.number))+'&quality='+encodeURIComponent(_config().quality),'sources?episodeId='+encodeURIComponent(encoded)+'&provider=kiwi&anilistId='+episode.id+'&category='+episode.category];
 var i=0,last=null;
 function next(){if(i>=routes.length)return Promise.reject(last||new Error('Miruro/Kiwi fallback has no streams'));var route=routes[i++];
  return _mirrorGet(route).then(function(payload){var data=_unwrap(payload),rows=Array.isArray(data.streams)?data.streams:(data.bestStream?[data.bestStream]:[]);var streams=rows.filter(function(x){return x&&/^https?:\/\//i.test(String(x.url||''));}).map(function(x){return {url:x.url,container:/\.mpd(?:[?#]|$)/i.test(x.url)?'dash':(/\.m3u8(?:[?#]|$)/i.test(x.url)||x.type==='hls'?'hls':undefined),type:x.type||x.format,quality:x.quality||x.label||'Auto',label:(x.quality||x.label||'Auto')+' · Kiwi fallback',kind:episode.category,audioLang:episode.category==='dub'?'en':'ja',headers:x.headers||{},referer:x.referer||undefined,subtitles:[]};});
   if(!streams.length)throw new Error('Kiwi fallback route returned no streams: '+route);
   if(data.subtitles&&Array.isArray(data.subtitles))streams[0].subtitles=data.subtitles.filter(function(x){return x&&(x.url||x.file);}).map(function(x){return {url:x.url||x.file,label:x.label||x.language||'Subtitle',lang:x.language||x.lang||'',format:x.format||'vtt'};});
   return streams;
  }).catch(function(e){last=e;return next();});
 }
 return next();
}
function getVideoSources(url,opts){
 var episode=_decodeEpisode(url);
 return _media(episode.id).then(function(media){
  var direct=_config().directLookup?_directSources(media,episode):Promise.reject(new Error('Direct AnimePahe disabled'));
  return direct.catch(function(e){console.warn('AnimePahe direct resolution failed; trying Miruro/Kiwi:',String(e));return _mirrorStreams(episode);});
 });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=='undefined'&&module.exports)module.exports={version:'1.0.0',getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks,_config:_config,_parseIds:_parseIds,_parseRelease:_parseRelease,_variants:_variants,_selectVariant:_selectVariant,_unpack:_unpack,_playlist:_playlist,_episodesFromMiruro:_episodesFromMiruro};
