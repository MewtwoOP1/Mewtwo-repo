// XFDM (Lili) — AniList metadata, Bangumi-confirmed catalogue matching, direct MP4 playback.
// XFDM burns Chinese subtitles into the video and does not publish a dub or separate subtitle tracks.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'xfdm';
var SITE = 'https://dm1.xfdm.pro';
var BANGUMI = 'https://api.bgm.tv';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
var MEDIA_CACHE = {};
var CATALOG_CACHE = {};
var MISS_CACHE = {};

function getInfo(){return {name:'Lili (XFDM)',lang:'zh',baseUrl:SITE,logo:'https://www.google.com/s2/favicons?sz=256&domain=xfdm.pro',type:'anime',version:'1.0.2'};}
function getSettings(){
 return [
  {key:'requestTimeoutMs',label:'Request timeout',description:'Maximum wait for each Bangumi or XFDM request.',type:'enum',default:'10000',options:[{value:'6000',label:'6 seconds'},{value:'10000',label:'10 seconds'},{value:'15000',label:'15 seconds'}]},
  {key:'maxTitleCandidates',label:'Bangumi title candidates',description:'Maximum number of AniList title aliases searched against Bangumi. Matching is exact after punctuation/spacing normalization; the provider does not fuzzy-match different seasons.',type:'enum',default:'8',options:[{value:'3',label:'3 aliases'},{value:'5',label:'5 aliases'},{value:'8',label:'8 aliases'}]},
  {key:'maxMirrorChannels',label:'Playback mirror attempts',description:'Maximum XFDM channels resolved for one episode. Channels are mirrors of the same encode, not different quality levels.',type:'enum',default:'3',options:[{value:'1',label:'1 channel'},{value:'2',label:'2 channels'},{value:'3',label:'3 channels'}]},
  {key:'homeSections',label:'Home sections',description:'Comma-separated AniList sections: trending, popular, top.',type:'text',default:'trending,popular'},
  {key:'cacheSeconds',label:'Catalogue cache',description:'Cache successful title and episode lookups briefly. Negative lookups are cached for a shorter period.',type:'enum',default:'120',options:[{value:'0',label:'Disabled'},{value:'60',label:'1 minute'},{value:'120',label:'2 minutes'},{value:'300',label:'5 minutes'}]},
  {key:'showAdult',label:'Show adult catalogue entries',description:'Include adult entries returned by AniList. Disabled by default.',type:'bool',default:false}
 ];
}
function _setting(k){try{var s=typeof __settings!=='undefined'&&__settings?__settings[SOURCE_ID]:null;return s&&s[k]!=null?s[k]:null;}catch(e){return null;}}
function _bool(v,d){if(v==null)return d;if(v===true||String(v).toLowerCase()==='true')return true;if(v===false||String(v).toLowerCase()==='false')return false;return d;}
function _int(v,d,min,max){var n=parseInt(v,10);return isFinite(n)?Math.max(min,Math.min(max,n)):d;}
function _config(){
 return {timeout:_int(_setting('requestTimeoutMs'),10000,3000,30000),maxNames:_int(_setting('maxTitleCandidates'),5,1,10),maxChannels:_int(_setting('maxMirrorChannels'),2,1,3),cacheMs:_int(_setting('cacheSeconds'),120,0,300)*1000,showAdult:_bool(_setting('showAdult'),false),sections:String(_setting('homeSections')||'trending,popular').split(/[,\n;]+/).map(function(x){return x.trim().toLowerCase();}).filter(Boolean)};
}
function _request(url,opts){
 var o=opts||{},headers=Object.assign({'User-Agent':UA,'Accept':'application/json'},o.headers||{});
 return fetch(url,Object.assign({},o,{headers:headers,timeoutMs:o.timeoutMs||_config().timeout})).then(function(r){
  var status=Number(r&&r.status||0);if(status<200||status>=300){var e=new Error('HTTP '+status+' for '+url);e.status=status;e.body=String(r&&r.body||'').slice(0,180);throw e;}return r;
 });
}
function _json(url,opts){return _request(url,opts).then(function(r){try{return JSON.parse(r.body||'null');}catch(e){throw new Error('Invalid JSON from '+url);}});}
function _graph(query,variables){
 return _request(ANILIST,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({query:query,variables:variables||{}}),timeoutMs:12000}).then(function(r){
  var j;try{j=JSON.parse(r.body||'null');}catch(e){throw new Error('AniList invalid JSON');}if(j.errors&&j.errors.length)throw new Error('AniList: '+String(j.errors[0].message||'query failed'));return j.data||{};
 });
}
var MEDIA_FIELDS='id idMal title { english romaji native } description(asHtml:false) coverImage { extraLarge large } bannerImage episodes status genres seasonYear averageScore isAdult synonyms';
function _media(id){
 var c=MEDIA_CACHE[id];if(c&&c.until>Date.now())return Promise.resolve(c.value);
 return _graph('query($id:Int){Media(id:$id,type:ANIME){'+MEDIA_FIELDS+'}}',{id:Number(id)}).then(function(d){if(!d.Media)throw new Error('AniList title not found: '+id);if(d.Media.isAdult&&!_config().showAdult)throw new Error('XFDM: adult title hidden by settings');MEDIA_CACHE[id]={value:d.Media,until:Date.now()+Math.max(1000,_config().cacheMs)};return d.Media;});
}
function _title(m){return m&&m.title&&(m.title.english||m.title.romaji||m.title.native)||'Anime';}
function _item(m){if(!m||!m.id||m.isAdult)return null;return {
 id:'xfdm://anime/'+m.id,url:'xfdm://anime/'+m.id,
 title:_title(m)+(m.seasonYear?' ('+m.seasonYear+')':''),
 englishTitle:m.title&&m.title.english||null,nativeTitle:m.title&&m.title.native||null,
 synonyms:Array.isArray(m.synonyms)?m.synonyms:[],
 cover:m.coverImage&&(m.coverImage.extraLarge||m.coverImage.large)||null,
 banner:m.bannerImage||null,description:m.description||'',
 status:m.status==='FINISHED'?'completed':m.status==='RELEASING'?'ongoing':'unknown',
 genres:m.genres||[],malId:Number(m.idMal)||null,
 year:m.seasonYear!=null?String(m.seasonYear):null,
 score:m.averageScore||null,type:'anime',sourceId:SOURCE_ID
};}
function _list(sort,page){
 return _graph('query($page:Int){Page(page:$page,perPage:20){media(type:ANIME,sort:'+sort+',isAdult:false){'+MEDIA_FIELDS+'}}}',{page:page||1}).then(function(d){return (d.Page&&d.Page.media||[]).map(_item).filter(Boolean);});
}
function search(q,page,opts){
 q=String(q||'').trim();if(!q)return Promise.resolve([]);
 return _graph('query($search:String,$page:Int){Page(page:$page,perPage:20){media(search:$search,type:ANIME,sort:SEARCH_MATCH,isAdult:false){'+MEDIA_FIELDS+'}}}',{search:q,page:Math.max(1,_int(page,1,1,100))}).then(function(d){return (d.Page&&d.Page.media||[]).map(_item).filter(Boolean);}).catch(function(e){console.warn('XFDM search failed',String(e));return [];});
}
function getHome(opts){
 var sort={trending:'TRENDING_DESC',popular:'POPULARITY_DESC',top:'SCORE_DESC'},sections=_config().sections;
 return Promise.all(sections.filter(function(x,i,a){return !!sort[x]&&a.indexOf(x)===i;}).map(function(x){return _list(sort[x],1).then(function(items){return items.length?{title:x.charAt(0).toUpperCase()+x.slice(1)+' Anime',items:items}:null;}).catch(function(){return null;});})).then(function(rows){return rows.filter(Boolean);});
}
function popular(opts){return _list('POPULARITY_DESC',1).catch(function(){return [];});}
function _id(url){var m=String(url||'').match(/(?:xfdm:\/\/anime\/|\/)(\d+)(?:[/?#]|$)/)||String(url||'').match(/^(\d+)$/);if(!m)throw new Error('XFDM: invalid AniList ID');return Number(m[1]);}
function _normal(s){
 return String(s||'').toLowerCase().replace(/[\s\-_,.·:;!?，。！？：；、（）()【】\[\]{}'"“”‘’]+/g,'');
}
function _titleNames(media){
 var raw=[media.title&&media.title.native,media.title&&media.title.romaji,media.title&&media.title.english].concat(media.synonyms||[]);
 var seen={};return raw.map(function(x){return String(x||'').trim();}).filter(function(x){var n=_normal(x);if(!n||seen[n])return false;seen[n]=1;return true;});
}
function _bangumiSearch(keyword){
 return _json(BANGUMI+'/v0/search/subjects?limit=20',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json','User-Agent':'MewtwoRepo/1.0 (https://github.com/MewtwoOP1/Mewtwo-repo)'},body:JSON.stringify({keyword:keyword,sort:'match',filter:{type:[2],nsfw:false}}),timeoutMs:_config().timeout});
}
function _bangumiMatch(media){
 var names=_titleNames(media),index=0;
 function next(){
  if(index>=Math.min(names.length,_config().maxNames))return Promise.reject(new Error('XFDM: no exact Bangumi title match for AniList ID '+media.id));
  var query=names[index++];
  return _bangumiSearch(query).then(function(root){
    var rows=Array.isArray(root&&root.data)?root.data:[];
    var exact=rows.filter(function(x){
      if(!x||!x.id||Number(x.type)!==2)return false;
      var a=_normal(x.name),b=_normal(x.name_cn);
      return !!_normal(query)&&(a===_normal(query)||b===_normal(query)||names.some(function(t){var n=_normal(t);return n&&(n===a||n===b);}));
    });
    if(exact.length===1)return exact[0];
    if(exact.length>1){
      // Prefer an exact match to the original/native title; never pick by fuzzy score.
      var ranked=exact.sort(function(a,b){var an=_normal(a.name),bn=_normal(b.name),q=_normal(query);return (an===q?0:1)-(bn===q?0:1);});
      if(exact.length===1)return ranked[0];
    }
    return next();
  }).catch(function(e){console.warn('Bangumi title lookup failed for alias',query,String(e));return next();});
 }
 return next();
}
function _suggestPath(html,bangumiId){
 var id=String(bangumiId);
 var cards=String(html||'').split(/<div\b[^>]*class\s*=\s*['"][^'"]*\bpublic-list-box\b[^'"]*\bsearch-box/ig);
 for(var i=1;i<cards.length;i++){
  var c=cards[i],cover=(c.match(/\/pic\/cover\/[^"'\s)]*?\/(\d+)_[^"'\s)]*\.(?:jpg|jpeg|png|webp)/i)||[])[1];
  var path=(c.match(/href\s*=\s*['"]([^'"]*\/bangumi\/\d+\.html)['"]/i)||[])[1];
  if(cover===id&&path)return path.charAt(0)==='/'?path:new URL(path,SITE).pathname;
 }
 return null;
}
function _subjectPath(query,bangumiId){
 return _json(SITE+'/index.php/ajax/suggest?mid=1&wd='+encodeURIComponent(query)+'&limit=50',{headers:{'Accept':'application/json','Referer':SITE+'/'}}).then(function(root){
  var rows=Array.isArray(root&&root.list)?root.list:[];
  var found=rows.find(function(x){var pic=String(x&&x.pic||'');var m=pic.match(/\/(\d+)_[^/]+\.(?:jpg|jpeg|png|webp)/i);return m&&m[1]===String(bangumiId)&&x.id;});
  if(found)return '/bangumi/'+Number(found.id)+'.html';
  return _request(SITE+'/search.html?wd='+encodeURIComponent(query),{headers:{'Accept':'text/html,application/xhtml+xml,*/*','Referer':SITE+'/'} }).then(function(r){
    var path=_suggestPath(r.body||'',bangumiId);if(!path)throw new Error('XFDM search did not contain Bangumi cover ID '+bangumiId);return path;
  });
 });
}
function _episodeRows(html){
 var re=/<a\b[^>]*\bhref\s*=\s*['"]\/watch\/\d+\/(\d+)\/\d+\.html['"][^>]*>([\s\S]*?)<\/a>/gi,m,out=[],seen={};
 while((m=re.exec(String(html||'')))!==null){
  var label=String(m[2]||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  var n=(label.match(/第\s*0*(\d+)\s*[话話集]/)||[])[1];if(n==null)continue;
  var ep=Number(n),channel=Number(m[1]);if(!(ep>0)||!channel)continue;
  var key=channel+':'+ep;if(seen[key])continue;seen[key]=true;
  out.push({number:ep,channel:channel,watchPath:(m[0].match(/href\s*=\s*['"]([^'"]+)/i)||[])[1]});
 }
 return out.sort(function(a,b){return a.number-b.number||a.channel-b.channel;});
}
function _playerUrl(html){
 var config=(String(html||'').match(/player_\w+\s*=\s*(\{[\s\S]*?\})\s*[;<]/i)||[])[1];if(!config)return null;
 var raw=(config.match(/["']url["']\s*:\s*"((?:[^"\\]|\\.)*)"/i)||[])[1];if(!raw)return null;
 var url=raw.replace(/\\+\//g,'/').replace(/\\\\/g,'\\').replace(/&amp;/g,'&').trim();
 return /^https?:\/\//i.test(url)?url:null;
}
function _catalog(id,force){
 var c=CATALOG_CACHE[id];if(!force&&c&&c.until>Date.now())return Promise.resolve(c.value);
 var miss=MISS_CACHE[id];if(!force&&miss&&miss>Date.now())return Promise.reject(new Error('XFDM: no confirmed Bangumi mapping for title '+id));
 return _media(id).then(function(media){
  return _bangumiMatch(media).then(function(bg){
   var names=[bg.name_cn,bg.name].concat(_titleNames(media)).filter(Boolean),i=0;
   function find(){
    if(i>=names.length)return Promise.reject(new Error('XFDM: no subject page matched Bangumi ID '+bg.id));
    var q=names[i++];return _subjectPath(q,bg.id).then(function(path){
      return _request(SITE+path,{headers:{'Accept':'text/html,application/xhtml+xml,*/*','Referer':SITE+'/'}}).then(function(r){
       var episodes=_episodeRows(r.body||'');if(!episodes.length)throw new Error('XFDM subject page has no numbered episodes');
       var result={bangumiId:Number(bg.id),subjectPath:path,episodes:episodes};
       CATALOG_CACHE[id]={value:result,until:Date.now()+Math.max(1000,_config().cacheMs)};return result;
      });
    }).catch(function(e){console.warn('XFDM subject candidate failed',q,String(e));return find();});
   }
   return find();
  });
 }).catch(function(e){MISS_CACHE[id]=Date.now()+30000;throw e;});
}
function _episodeUrl(id,number){return 'xfdm://episode/'+id+'/'+number;}
function _episodeRowsToItems(id,rows){
 var seen={};
 return rows.filter(function(e){if(seen[e.number])return false;seen[e.number]=true;return true;})
  .map(function(e){return {id:_episodeUrl(id,e.number),url:_episodeUrl(id,e.number),number:e.number,title:e.title||('Episode '+e.number),thumbnail:e.thumbnail||null,date:e.airDate||null,sourceId:SOURCE_ID,type:'anime',category:'sub'};});
}
function _fallbackEpisodes(id,count){
 var total=Math.max(0,Math.min(500,Number(count)||0)),out=[];
 for(var n=1;n<=total;n++)out.push({id:_episodeUrl(id,n),url:_episodeUrl(id,n),number:n,title:'Episode '+n,sourceId:SOURCE_ID,type:'anime',category:'sub'});
 return out;
}
function getDetail(url,opts){
 var id=_id(url);
 return _media(id).then(function(m){
  var item=_item(m);
  return _catalog(id,opts&&opts.forceRefresh).then(function(cat){
   item.episodes=_episodeRowsToItems(id,cat.episodes);
   if(!item.episodes.length)item.episodes=_fallbackEpisodes(id,m.episodes);
   item.subCount=item.episodes.length;item.dubCount=0;return item;
  }).catch(function(e){
   console.warn('XFDM catalogue unavailable; showing AniList episode inventory',String(e));
   item.episodes=_fallbackEpisodes(id,m.episodes);item.subCount=item.episodes.length;item.dubCount=0;return item;
  });
 });
}
function getEpisodes(url,opts){
 var id=_id(url);
 return Promise.all([_media(id),_catalog(id,opts&&opts.forceRefresh).catch(function(){return null;})]).then(function(r){
  return r[1]?(_episodeRowsToItems(id,r[1].episodes).length?_episodeRowsToItems(id,r[1].episodes):_fallbackEpisodes(id,r[0].episodes)):_fallbackEpisodes(id,r[0].episodes);
 });
}
function _resolveChannels(rows){
 var chosen=[],i=0,limit=_config().maxChannels;
 function next(){
  if(i>=rows.length||chosen.length>=limit)return chosen.length?Promise.resolve(chosen):Promise.reject(new Error('XFDM: no playable MP4 mirror resolved'));
  var row=rows[i++];return _request(SITE+row.watchPath,{headers:{'Accept':'text/html,application/xhtml+xml,*/*','Referer':SITE+'/'}}).then(function(r){
   var url=_playerUrl(r.body||'');if(!url)throw new Error('XFDM watch page contained no direct player URL');
   var host=(String(url).match(/^https?:\/\/([^/:?#]+)/i)||[])[1]||'';host=host.toLowerCase();
   chosen.push({url:url,host:host,slow:host==='apn.moedot.net'});
   if(chosen.length<limit)return next();return chosen;
  }).catch(function(e){console.warn('XFDM channel failed',row.channel,String(e));return next();});
 }
 return next().then(function(list){return list.sort(function(a,b){return Number(a.slow)-Number(b.slow);});});
}

var MIRURO_FALLBACK_HOSTS=['https://api.hiyori.tv','https://miruro.zenos.my.id','https://www.neoanime.tv'];
var MIRURO_PROVIDER_ORDER=['kiwi','animepahe','arc','zoro','jet','bee','bonk','hop','pewe','ally','nun','bun','twin','cog','moo','sun','knob','telli'];
function _mfRoot(v){var r=v||{};for(var i=0;i<3&&r&&typeof r==='object'&&!Array.isArray(r);i++){if(r.results&&typeof r.results==='object'&&!Array.isArray(r.results))r=r.results;else if(r.data&&typeof r.data==='object'&&!Array.isArray(r.data)&&(r.data.providers||r.data.streams))r=r.data;else break;}return r||{};}
function _mfGet(host,path){var url=String(host).replace(/\/+$/,'')+'/'+String(path).replace(/^\/+/, '');return fetch(url,{headers:{'Accept':'application/json','User-Agent':'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36'},timeoutMs:10000}).then(function(r){var status=Number(r&&r.status||0),body=r&&r.body!=null?r.body:'';if(status<200||status>=300)throw new Error('HTTP '+status+' from '+url);if(typeof body!=='string')body=String(body||'');if(!body&&r&&typeof r.text==='function')return r.text().then(function(t){try{return JSON.parse(t||'null');}catch(e){throw new Error('Invalid JSON from '+url);}});try{return JSON.parse(body||'null');}catch(e){throw new Error('Invalid JSON from '+url);}});}
function _mfOptions(payload,num,cat){var root=_mfRoot(payload),providers=root.providers||{},names=Object.keys(providers);names.sort(function(a,b){var ai=MIRURO_PROVIDER_ORDER.indexOf(String(a).toLowerCase()),bi=MIRURO_PROVIDER_ORDER.indexOf(String(b).toLowerCase());if(ai<0)ai=999;if(bi<0)bi=999;return ai===bi?a.localeCompare(b):ai-bi;});var out=[];names.forEach(function(name){var p=providers[name]||{},lists=p.episodes||p,cats=cat==='dub'?['dub']:['sub','hsub'];cats.forEach(function(c){var rows=Array.isArray(lists[c])?lists[c]:[];rows.forEach(function(e){if(!e||Number(e.number||e.episode||e.ep)!==Number(num))return;var id=String(e.id||e.url||'').trim();if(!id)return;if(/^https?:\/\//i.test(id)){out.push({provider:name,route:id,direct:true});return;}id=id.replace(/^\/+/, '');if(id.indexOf('watch/')!==0)return;out.push({provider:name,route:id,direct:false,slug:id.split('/').pop()||''});});});});var seen={};return out.filter(function(o){var k=o.provider+'|'+o.route;if(seen[k])return false;seen[k]=1;return true;});}
function _mfStreams(payload,provider,cat){var root=_mfRoot(payload),rows=Array.isArray(root)?root:(Array.isArray(root.streams)?root.streams:(root.bestStream&&root.bestStream.url?[root.bestStream].concat(root.streams||[]):(root.stream&&root.stream.url?[root.stream]:[]))),subs=Array.isArray(root.subtitles)?root.subtitles:[],out=rows.map(function(x){if(!x)return null;var u=String(x.url||x.file||'').trim();if(!/^https?:\/\//i.test(u))return null;var h={};if(x.headers&&typeof x.headers==='object')Object.keys(x.headers).forEach(function(k){h[k]=String(x.headers[k]);});var ref=x.referer||x.referrer||null;if(ref&&!h.Referer&&!h.referer)h.Referer=String(ref);var t=String(x.type||x.format||'').toLowerCase(),ct=/\.mpd(?:[?#]|$)/i.test(u)||t==='dash'?'dash':(/\.m3u8(?:[?#]|$)/i.test(u)||t==='hls'?'hls':(/\.mp4(?:[?#]|$)/i.test(u)||t==='mp4'?'mp4':undefined));return {url:u,container:ct,type:x.type||x.format||ct,quality:x.quality||x.label||x.name||'Auto',label:(x.quality||x.label||x.name||'Auto')+' · Miruro ('+provider+')',kind:cat,audioLang:cat==='dub'?'en':'ja',headers:h,referer:ref||undefined,subtitles:[]};}).filter(Boolean);if(out.length&&subs.length)out[0].subtitles=subs.map(function(s){if(!s)return null;var u=String(s.url||s.file||'');if(!/^https?:\/\//i.test(u))return null;return {url:u,label:s.label||s.title||s.language||'Subtitle',lang:s.language||s.lang||'',format:s.format||'vtt'};}).filter(Boolean);return out;}
function _miruroFallback(id,num,cat,label,hostOverride){var hosts=Array.isArray(hostOverride)&&hostOverride.length?hostOverride.slice():MIRURO_FALLBACK_HOSTS.slice(),last=null;function hostAt(i){if(i>=hosts.length)return Promise.reject(last||new Error(label+': no Miruro host responded'));var host=String(hosts[i]).replace(/\/+$/,'');return _mfGet(host,'episodes/'+encodeURIComponent(String(id))).then(function(payload){var opts=_mfOptions(payload,num,cat);if(!opts.length)throw new Error(label+': Miruro has no real provider episode ID for episode '+num+' ('+cat+')');var optError=null;function optionAt(j){if(j>=opts.length)return Promise.reject(optError||new Error(label+': no playable Miruro provider'));var o=opts[j];if(o.direct)return Promise.resolve([{url:o.route,container:/\.m3u8/i.test(o.route)?'hls':(/\.mpd/i.test(o.route)?'dash':'mp4'),quality:'Auto',label:'Miruro direct ('+o.provider+')',kind:cat,audioLang:cat==='dub'?'en':'ja',headers:{},subtitles:[]}]);var routes=[o.route,'stream?provider='+encodeURIComponent(o.provider)+'&anilistId='+encodeURIComponent(String(id))+'&category='+encodeURIComponent(cat)+'&slug='+encodeURIComponent(o.slug),'sources?episodeId='+encodeURIComponent(o.route)+'&provider='+encodeURIComponent(o.provider)+'&anilistId='+encodeURIComponent(String(id))+'&category='+encodeURIComponent(cat)];function routeAt(k){if(k>=routes.length)return Promise.reject(optError||new Error('Miruro route failed: '+o.provider));return _mfGet(host,routes[k]).then(function(v){var streams=_mfStreams(v,o.provider,cat);if(!streams.length)throw new Error('No streams from '+o.provider);return streams;}).catch(function(e){optError=e;return routeAt(k+1);});}return routeAt(0).catch(function(e){optError=e;return optionAt(j+1);});}return optionAt(0);}).catch(function(e){last=e;return hostAt(i+1);});}return hostAt(0);}

function _probeXfdmUrl(url){
 return fetch(url,{headers:{'Range':'bytes=0-1023'},timeoutMs:5000}).then(function(r){
  var status=Number(r&&r.status||0);
  if(status===200||status===206)return true;
  throw new Error('XFDM media URL returned HTTP '+status);
 });
}
function _probeXfdmChannels(rows){
 var i=0,accepted=[];
 function next(){
  if(i>=rows.length)return accepted.length?Promise.resolve(accepted):Promise.reject(new Error('XFDM: every resolved MP4 mirror rejected the ranged request'));
  var row=rows[i++];
  return _probeXfdmUrl(row.url).then(function(){accepted.push(row);return next();}).catch(function(e){console.warn('XFDM media mirror rejected:',row.host||row.url,String(e));return next();});
 }
 return next();
}
function getVideoSources(url,opts){
 var m=String(url||'').match(/^xfdm:\/\/episode\/(\d+)\/(\d+)$/i);if(!m)return Promise.reject(new Error('XFDM: invalid episode URL'));
 var id=Number(m[1]),ep=Number(m[2]);
 var native=_catalog(id).then(function(cat){
  var rows=cat.episodes.filter(function(x){return x.number===ep;});
  if(!rows.length)throw new Error('XFDM episode '+ep+' is not in the catalogue');
  return _resolveChannels(rows);
 }).then(_probeXfdmChannels).then(function(rows){
  return rows.map(function(x,i){var hls=/\.m3u8(?:[?#]|$)/i.test(x.url);return {url:x.url,container:hls?'hls':'mp4',type:hls?'hls':'mp4',quality:'Mirror '+(i+1)+' ('+String(x.host||'source').split('.')[0]+')',label:'Mirror '+(i+1)+' ('+String(x.host||'source').split('.')[0]+')',headers:{},referer:undefined,kind:'sub',audioLang:'ja',subtitles:[],isActive:i===0};});
 });
 return native.catch(function(error){
  console.warn('XFDM direct playback unavailable; trying real Miruro episode sources:',String(error));
  return _miruroFallback(id,ep,'sub','XFDM');
 });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=='undefined'&&module.exports)module.exports={version:'1.0.2',getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks,_config:_config,_normal:_normal,_titleNames:_titleNames,_suggestPath:_suggestPath,_episodeRows:_episodeRows,_playerUrl:_playerUrl,_catalog:_catalog,_fallbackEpisodes:_fallbackEpisodes,_episodeRowsToItems:_episodeRowsToItems};
