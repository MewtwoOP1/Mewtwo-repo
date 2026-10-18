// MMani — direct source integration based on the site's public JSON endpoints.
// Catalog search: eng.animeapps.top/api/search3.php?keyword=
// Episodes: epeng.animeapps.top/api2.php?epid=<AniList ID>
// Player links: /apilink.php?data=<server link>, then extract videoUrl from player HTML.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'mmani';
var SITE = 'https://mmani.com';
var SEARCH_API = 'https://eng.animeapps.top/api/search3.php';
var EP_API = 'https://epeng.animeapps.top';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getInfo() {
  return {name:'MMani',lang:'en',baseUrl:SITE,logo:'https://www.google.com/s2/favicons?sz=256&domain=mmani.com',type:'anime',version:'1.0.0'};
}
function getSettings(){return [];}
function _fetch(url, referer) {
  return fetch(url,{headers:{'User-Agent':UA,'Accept':'application/json, text/html, */*','Referer':referer||SITE+'/'},timeoutMs:15000})
    .then(function(r){
      if(!r || (r.status && r.status>=400)) return '';
      if(typeof r.body==='string') return r.body;
      if(typeof r.text==='function') return r.text();
      return '';
    }).catch(function(){return '';});
}
function _json(url,referer){return _fetch(url,referer).then(function(s){try{return JSON.parse(s||'null');}catch(e){return null;}});}
function _text(v){return String(v==null?'':v).replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim();}
function _rows(j){
  if(Array.isArray(j)) return j;
  if(j && Array.isArray(j.data)) return j.data;
  if(j && j.data && Array.isArray(j.data.results)) return j.data.results;
  if(j && Array.isArray(j.results)) return j.results;
  return [];
}
function _title(x){return _text(x&&(x.title||x.name||x.anime_title||x.english_title||x.romaji)||'');}
function _anilist(x){var v=x&&(x.anilist||x.anilist_id||x.anilistId||x.anilistID);return v!=null&&/^\\d+$/.test(String(v))?String(v):'';}
function _postId(x){var v=x&&(x.postid||x.post_id||x.id);return v==null?'':String(v);}
function _cover(x){return x&&(x.image||x.poster||x.cover||x.thumbnail||x.thumbnail_url||x.img)||null;}
function _card(x){
  var title=_title(x), aid=_anilist(x), post=_postId(x);
  var id=aid||post;
  if(!id||!title)return null;
  var item={id:id,title:title,englishTitle:title,url:'mmani://'+encodeURIComponent(id)+'/'+encodeURIComponent(title)+'/'+encodeURIComponent(post),type:'anime',sourceId:SOURCE_ID};
  var cover=_cover(x); if(typeof cover==='string'&&cover)item.cover=/^https?:\\/\\//i.test(cover)?cover:(SITE+(cover.charAt(0)==='/'?'':'/')+cover);
  if(aid)item.anilistId=aid;
  if(post)item.postId=post;
  return item;
}
function search(query,page,opts){
  var q=String(query||'').trim(); if(!q)return Promise.resolve([]);
  return _json(SEARCH_API+'?keyword='+encodeURIComponent(q),SITE+'/').then(function(j){
    var seen={},out=[];
    _rows(j).forEach(function(x){var c=_card(x);if(c&&!seen[c.url]){seen[c.url]=1;out.push(c);}});
    return out;
  }).catch(function(){return [];});
}
function getHome(){return Promise.resolve([]);}
function _parseUrl(url){
  var raw=String(url||'').replace(/^mmani:\/\//i,'').split('/');
  function dec(s){try{return decodeURIComponent(s||'');}catch(e){return s||'';}}
  return {id:dec(raw[0]),title:dec(raw[1]),postId:dec(raw[2])};
}
function _servers(id){
  if(!/^\\d+$/.test(String(id||'')))return Promise.resolve([]);
  return _json(EP_API+'/api2.php?epid='+encodeURIComponent(id),SITE+'/').then(function(j){
    if(Array.isArray(j))return j;
    if(j&&Array.isArray(j.data))return j.data;
    if(j&&Array.isArray(j.servers))return j.servers;
    return [];
  }).catch(function(){return [];});
}
function _episodeNumber(ep){
  var a=ep&&(ep.slug!=null?ep.slug:ep.name!=null?ep.name:ep.episode);
  var m=String(a==null?'':a).match(/\\d+(?:\\.\\d+)?/);
  return m?Number(m[0]):NaN;
}
function _episodes(servers,id,mode){
  var nums={},out=[];
  servers.forEach(function(s){
    (Array.isArray(s.server_data)?s.server_data:[]).forEach(function(ep){
      var n=_episodeNumber(ep);
      if(!isFinite(n)||n<=0||!ep.link)return;
      if(!nums[String(n)])nums[String(n)]={number:n,title:'Episode '+n};
    });
  });
  Object.keys(nums).sort(function(a,b){return Number(a)-Number(b);}).forEach(function(k){
    var ep=nums[k];
    out.push({id:'mmani://'+encodeURIComponent(id)+'/'+encodeURIComponent(String(ep.number))+'/'+mode,
      url:'mmani://'+encodeURIComponent(id)+'/'+encodeURIComponent(String(ep.number))+'/'+mode,
      number:ep.number,title:ep.title,type:'anime',sourceId:SOURCE_ID,season:1});
  });
  return out;
}
function getDetail(url,opts){
  var parsed=_parseUrl(url),id=parsed.id,title=parsed.title||id;
  if(!/^\\d+$/.test(id))return Promise.resolve(null);
  var mode=opts&&String(opts.category||'').toLowerCase()==='dub'?'dub':'sub';
  return _servers(id).then(function(servers){
    var episodes=_episodes(servers,id,mode);
    if(!episodes.length)return null;
    return {id:id,title:title,englishTitle:title,url:'mmani://'+encodeURIComponent(id)+'/'+encodeURIComponent(title)+'/'+encodeURIComponent(parsed.postId),
      type:'anime',sourceId:SOURCE_ID,episodes:episodes,subCount:episodes.length,dubCount:0};
  }).catch(function(){return null;});
}
function getEpisodes(url,opts){
  var p=_parseUrl(url),id=p.id;
  var mode=opts&&String(opts.category||'').toLowerCase()==='dub'?'dub':'sub';
  return _servers(id).then(function(s){return _episodes(s,id,mode);}).catch(function(){return [];});
}
function _resolvePlayerLink(link,serverName,epNo){
  return _json(EP_API+'/apilink.php?data='+encodeURIComponent(link),SITE+'/').then(function(players){
    if(!Array.isArray(players))return [];
    var tasks=players.filter(function(p){return p&&typeof p.link==='string';}).map(function(p){
      var playerUrl=p.link.replace(/\\\\\\//g,'/');
      return _fetch(playerUrl,SITE+'/').then(function(html){
        var vm=html.match(/["']?videoUrl["']?\\s*:\\s*["']([^"']+)["']/);
        if(!vm||!vm[1])return null;
        var video=vm[1];
        try{video=new URL(video,playerUrl).toString();}catch(e){}
        if(!/^https?:\\/\\//i.test(video))return null;
        var tracks=[],tm=html.match(/["']?tracks["']?\\s*:\\s*(\\[[\\s\\S]*?\\])/);
        if(tm)try{
          var parsed=JSON.parse(tm[1]);
          if(Array.isArray(parsed))parsed.forEach(function(t){
            if(!t||!t.file)return;
            var u=t.file;try{u=new URL(u,playerUrl).toString();}catch(e){}
            if(/\\.vtt(?:$|\\?)/i.test(u))tracks.push({url:u,lang:String(t.label||'English').slice(0,2).toLowerCase(),label:t.label||'English',format:'vtt'});
          });
        }catch(e){}
        var hls=/\\.m3u8(?:$|\\?)/i.test(video);
        return {url:video,name:'MMani '+(p.server||serverName||'Server'),provider:'MMani',quality:'Auto',container:hls?'m3u8':(/\\.mp4(?:$|\\?)/i.test(video)?'mp4':'auto'),hls:hls,headers:{'Referer':playerUrl,'User-Agent':UA},subtitles:tracks,isActive:true};
      }).catch(function(){return null;});
    });
    return Promise.all(tasks).then(function(a){return a.filter(Boolean);});
  }).catch(function(){return [];});
}
function getVideoSources(url,opts){
  var raw=String(url||'').replace(/^mmani:\/\//i,'').split('/');
  var id='',epNo='',mode='sub';
  try{id=decodeURIComponent(raw[0]||'');epNo=decodeURIComponent(raw[1]||'');mode=decodeURIComponent(raw[2]||'sub');}catch(e){}
  if(!/^\\d+$/.test(id)||!isFinite(Number(epNo)))return Promise.resolve([]);
  return _servers(id).then(function(servers){
    var links=[];
    servers.forEach(function(s){
      (Array.isArray(s.server_data)?s.server_data:[]).forEach(function(ep){
        if(_episodeNumber(ep)===Number(epNo)&&ep.link)links.push({link:ep.link,name:s.server_name||s.name||'Server'});
      });
    });
    var seen={},unique=links.filter(function(x){if(seen[x.link])return false;seen[x.link]=1;return true;});
    return Promise.all(unique.map(function(x){return _resolvePlayerLink(x.link,x.name,epNo);})).then(function(groups){
      var out=[];
      groups.forEach(function(g){g.forEach(function(s){if(!out.some(function(o){return o.url===s.url;}))out.push(s);});});
      return out;
    });
  }).catch(function(){return [];});
}
function getStreams(url,opts){return getVideoSources(url,opts);}
if(typeof module!=='undefined'&&module.exports)module.exports={version:'1.0.0',getInfo:getInfo,getSettings:getSettings,getHome:getHome,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams};
