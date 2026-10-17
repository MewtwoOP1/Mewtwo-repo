// KotoTV anime source for Zangetsu. Single canonical domain; no mirror selector/failover.
var SOURCE_ID=(typeof __SOURCE_ID!=="undefined"&&__SOURCE_ID)?String(__SOURCE_ID):"kototv";
var SITE="https://kototv.to";
var UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function getInfo(){return {name:"KotoTV",lang:"en",baseUrl:SITE,logo:"https://www.google.com/s2/favicons?sz=256&domain=kototv.to",type:"anime",version:"1.0.1"};}
function getSettings(){return [];}
function txt(s){var v=String(s||"");if(typeof htmlText==="function")v=htmlText(v);return v.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();}
function attrValue(tag,name){var re=new RegExp("\\b"+name+"\\s*=\\s*([\"'])(.*?)\\1","i"),m=String(tag||"").match(re);return m?m[2]:null;}
function get(url,ref){return fetch(url,{headers:{"User-Agent":UA,"Accept":"text/html,application/json,*/*","Referer":ref||SITE+"/"}}).then(function(r){if(!r||r.status>=400)throw Error("KotoTV HTTP "+(r&&r.status||"error")+" at "+url);var b=r.body==null?"":String(r.body);if(!b)throw Error("KotoTV empty response at "+url);return b;});}
function uniquePush(out,item){if(item&&item.url&&!out.some(function(x){return x.url===item.url;}))out.push(item);}
function search(q,page,opts){
 q=String(q||"").trim();if(!q)return Promise.resolve([]);
 return get(SITE+"/anime?q="+encodeURIComponent(q),SITE+"/").then(function(h){
  var out=[],seen={},re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(h))&&out.length<40){
   var href=attrValue(m[1],"href");if(!href)continue;
   href=href.replace(/^https?:\/\/[^/]+/i,"");
   var hit=href.match(/^\/anime\/([^/?#]+)\/?$/i);if(!hit)continue;
   var id=hit[1],title=txt(attrValue(m[1],"title")||m[2].replace(/<[^>]*>/g," "));
   if(!title||title.length<2||/^(soft sub|soft dub|sub|dub|watch|play)$/i.test(title)||seen[id])continue;
   seen[id]=1;
   var chunk=h.slice(m.index,m.index+1800),im=(chunk.match(/<img\b[^>]*(?:data-src|data-lazy-src|src)=["']([^"']+)/i)||[])[1]||null;
   out.push({id:id,title:title,url:id,cover:im?im.replace(/&amp;/g,"&"):null,type:"anime",sourceId:SOURCE_ID});
  }
  return out;
 }).catch(function(){return [];});
}
function getHome(opts){
 return get(SITE+"/",SITE+"/").then(function(h){
  var out=[],seen={},re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(h))&&out.length<40){
   var href=attrValue(m[1],"href");if(!href)continue;
   href=href.replace(/^https?:\/\/[^/]+/i,"");
   var hit=href.match(/^\/anime\/([^/?#]+)\/?$/i);if(!hit)continue;
   var id=hit[1],title=txt(attrValue(m[1],"title")||m[2].replace(/<[^>]*>/g," "));
   if(!title||seen[id]||/^(soft sub|soft dub|sub|dub|watch|play)$/i.test(title))continue;
   seen[id]=1;out.push({id:id,title:title,url:id,type:"anime",sourceId:SOURCE_ID});
  }
  return out.length?[{title:"KotoTV",items:out}]:[];
 }).catch(function(){return [];});
}
function episodeTitle(label,n){
 var t=txt(label).replace(/\b(?:soft\s*)?(?:sub|dub|subdub)\b/ig," ").replace(/\b(?:HD|SD|FHD|4K)\b/ig," ").replace(/^\s*#?\d+\s*/,"").replace(/\s+/g," ").trim();
 if(!t||/^(episode\s*)?\d*$/i.test(t)||/^(watch|play|server\s*\d+)$/i.test(t))return "Episode "+n;
 if(/^episode\s*\d+$/i.test(t))return t;
 if(/^episode\s*\d+\s*[-:|]/i.test(t))return t;
 var m=t.match(/episode\s*\d+[^a-z0-9]*([\s\S]*)/i);
 return m&&m[1].trim()?"Episode "+n+" — "+m[1].trim():"Episode "+n;
}
function getDetail(slug,opts){
 slug=String(slug||"").replace(/^https?:\/\/[^/]+/i,"").replace(/^\/?anime\//i,"").split(/[/?#]/)[0];
 var watch=SITE+"/anime/"+encodeURIComponent(slug)+"/watch/1";
 return get(watch,SITE+"/").then(function(h){
  var title=txt((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||slug);
  var poster=(h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)||[])[1]||(h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)||[])[1]||null;
  var desc=(h.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i)||[])[1]||"";
  var eps=[],seen={},re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(h))&&eps.length<1000){
   var href=attrValue(m[1],"href");if(!href)continue;
   href=href.replace(/^https?:\/\/[^/]+/i,"");
   var hit=href.match(/^\/anime\/[^/]+\/watch\/(\d+)/i);if(!hit)continue;
   var n=Number(hit[1]);if(!n||seen[n])continue;seen[n]=1;
   var label=attrValue(m[1],"title")||m[2].replace(/<[^>]*>/g," ");
   eps.push({id:"kototv://"+encodeURIComponent(slug)+"/"+n,number:n,title:episodeTitle(label,n),url:"kototv://"+encodeURIComponent(slug)+"/"+n});
  }
  eps.sort(function(a,b){return a.number-b.number;});
  return {id:slug,title:title||slug,url:slug,cover:poster?poster.replace(/&amp;/g,"&"):null,description:txt(desc),type:"anime",sourceId:SOURCE_ID,episodes:eps};
 }).catch(function(){return {id:slug,title:slug,url:slug,type:"anime",sourceId:SOURCE_ID,episodes:[]};});
}
function getEpisodes(id,opts){return getDetail(id,opts).then(function(d){return d.episodes||[];});}
function b64(s){var chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",map={},out=[],buf=0,bits=0;for(var i=0;i<64;i++)map[chars.charAt(i)]=i;s=String(s||"");for(var j=0;j<s.length;j++){var c=s.charAt(j);if(c==="="||map[c]==null)continue;buf=(buf<<6)|map[c];bits+=6;if(bits>=8){bits-=8;out.push((buf>>bits)&255);buf&=(1<<bits)-1;}}return out;}
function decode(blob){var a=b64(blob),key="otaku-embed-v1",s="";for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]^key.charCodeAt(i%key.length));try{return JSON.parse(decodeURIComponent(escape(s)));}catch(e){return null;}}
function mediaFrom(html,referer){
 var h=String(html||"").replace(/\\\//g,"/").replace(/&amp;/g,"&"),m,out=[];
 m=h.match(/window\.__P\s*=\s*["']([^"']+)["']/);
 if(m){var d=decode(m[1]),u=d&&(d.src||d.url||d.file);if(u&&/^https?:\/\//i.test(u))uniquePush(out,{url:String(u),quality:d.quality||"Auto",container:/\.m3u8(?:$|[?#])/i.test(u)?"hls":(/\.mpd(?:$|[?#])/i.test(u)?"dash":"mp4"),headers:{Referer:referer||SITE+"/","User-Agent":UA},subtitles:Array.isArray(d.subtitles)?d.subtitles.filter(function(s){return s&&(s.src||s.url);}).map(function(s){return {url:s.src||s.url,lang:s.lang||s.label||"en",label:s.label||s.lang||"English",format:"vtt"};}):[]});}
 var re=/(?:file|src|source|url)\s*["']?\s*[:=]\s*["'](https?:\/\/[^"'<> ]+\.(?:m3u8|mp4|mpd)(?:\?[^"'<> ]*)?)/gi;
 while((m=re.exec(h))&&out.length<8)uniquePush(out,{url:m[1],quality:"Auto",container:/\.m3u8(?:$|[?#])/i.test(m[1])?"hls":(/\.mpd(?:$|[?#])/i.test(m[1])?"dash":"mp4"),headers:{Referer:referer||SITE+"/","User-Agent":UA}});
 return out;
}
function getVideoSources(url,opts){
 var p=String(url||"").replace(/^kototv:\/\//,"").split("/"),slug;
 try{slug=decodeURIComponent(p[0]);}catch(e){slug=p[0];}
 var n=parseInt(p[1],10);if(!slug||!(n>0))return Promise.reject(Error("KotoTV: invalid episode URL"));
 var watchUrl=SITE+"/anime/"+encodeURIComponent(slug)+"/watch/"+n;
 function walk(target,ref,depth,seen){
  if(depth>4||seen[target])return Promise.resolve([]);seen[target]=1;
  return get(target,ref||watchUrl).then(function(html){
   var direct=mediaFrom(html,target);if(direct.length)return direct;
   var frames=[],m,re=/<iframe\b([^>]*)>/gi;
   while((m=re.exec(html))&&frames.length<8){var src=attrValue(m[1],"src");if(!src)continue;try{var abs=new URL(src,target).toString();if(/^https?:\/\//i.test(abs)&&frames.indexOf(abs)<0)frames.push(abs);}catch(e){}}
   return Promise.all(frames.map(function(next){return walk(next,target,depth+1,seen).catch(function(){return [];});})).then(function(groups){var out=[];groups.forEach(function(g){g.forEach(function(s){uniquePush(out,s);});});return out;});
  });
 }
 return get(watchUrl,SITE+"/").then(function(html){
  var direct=mediaFrom(html,watchUrl);if(direct.length)return direct;
  var frames=[],m,re=/<iframe\b([^>]*)>/gi;
  while((m=re.exec(html))&&frames.length<8){var src=attrValue(m[1],"src");if(!src)continue;try{var abs=new URL(src,watchUrl).toString();if(/^https?:\/\//i.test(abs)&&frames.indexOf(abs)<0)frames.push(abs);}catch(e){}}
  var base=(html.match(/baseEmbedUrl["']?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i)||[])[1]||(html.match(/data-base-embed-url=["']([^"']+)["']/i)||[])[1];
  if(base)frames.unshift(base);
  if(!frames.length)throw Error("KotoTV: no player iframe found on watch page");
  return Promise.all(frames.map(function(frame){return walk(frame,watchUrl,0,{}).catch(function(){return [];});})).then(function(groups){var out=[];groups.forEach(function(g){g.forEach(function(s){uniquePush(out,s);});});if(!out.length)throw Error("KotoTV: player iframe loaded but no direct media URL was exposed");return out;});
 });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=="undefined"&&module.exports)module.exports={version:"1.0.1",getInfo:getInfo,getSettings:getSettings,getHome:getHome,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks};
