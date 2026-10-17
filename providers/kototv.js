// KotoTV anime source for Zangetsu.
var SOURCE_ID=(typeof __SOURCE_ID!=="undefined"&&__SOURCE_ID)?String(__SOURCE_ID):"kototv";
var SITE="https://kototv.to",PLAYER="https://player.kototv.to";
function readDomain(){try{var s=typeof __settings!=="undefined"&&__settings?__settings[SOURCE_ID]:null;var d=s&&s.domain?String(s.domain):SITE;return ["https://kototv.to","https://anineko.site","https://aniorbit.cc","https://anispark.cc","https://animeflux.cc","https://aninova.cc","https://anipulse.cc","https://anirush.cc","https://aniblaze.cc","https://hiotaku.cc","https://www.aniwatch.rest"].indexOf(d)>=0?d:SITE;}catch(e){return SITE;}}
var UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function getInfo(){return {name:"KotoTV",lang:"en",baseUrl:readDomain(),logo:"https://www.google.com/s2/favicons?sz=256&domain=kototv.to",type:"anime",version:"1.0.7"};}
function getSettings(){return [{key:"domain",label:"Domain",description:"Choose the exact domain this source should use. No automatic failover.",type:"enum",default:"https://kototv.to",options:[{"value":"https://kototv.to","label":"kototv.to"},{"value":"https://anineko.site","label":"anineko.site"},{"value":"https://aniorbit.cc","label":"aniorbit.cc"},{"value":"https://anispark.cc","label":"anispark.cc"},{"value":"https://animeflux.cc","label":"animeflux.cc"},{"value":"https://aninova.cc","label":"aninova.cc"},{"value":"https://anipulse.cc","label":"anipulse.cc"},{"value":"https://anirush.cc","label":"anirush.cc"},{"value":"https://aniblaze.cc","label":"aniblaze.cc"},{"value":"https://hiotaku.cc","label":"hiotaku.cc"},{"value":"https://www.aniwatch.rest","label":"www.aniwatch.rest"}]}];}
function txt(s){return htmlText(String(s||"")).trim();}
function isSiteHost(hostname){var domains=["kototv.to","anineko.site","aniorbit.cc","anispark.cc","animeflux.cc","aninova.cc","anipulse.cc","anirush.cc","aniblaze.cc","hiotaku.cc","www.aniwatch.rest"];hostname=String(hostname||"").toLowerCase();return domains.indexOf(hostname)>=0;}
function get(url,ref){
 var host=readDomain(),target,referer;
 try{
  var u=new URL(String(url||""),host+"/");
  target=isSiteHost(u.hostname)?host+u.pathname+u.search: u.toString();
 }catch(e){
  var path=String(url||"").replace(/^https?:\/\/[^/]+/i,"");
  target=host+(path.charAt(0)==="/"?path:"/"+path);
 }
 try{
  var r=new URL(String(ref||host+"/"),host+"/");
  referer=isSiteHost(r.hostname)?host+r.pathname+r.search:r.toString();
 }catch(e){referer=host+"/";}
 return fetch(target,{headers:{"User-Agent":UA,"Accept":"text/html,application/json,*/*","Referer":referer}}).then(function(r){
  if(!r||r.status>=400)throw Error("KotoTV HTTP "+(r&&r.status||"error")+" at "+target);
  var b=r.body==null?"":r.body;
  if(!b)throw Error("Empty response from "+target);
  return b;
 });
}
function attrValue(tag,name){var re=new RegExp("\\b"+name+"\\s*=\\s*([\"'])(.*?)\\1","i"),m=String(tag||"").match(re);return m?m[2]:null;}
function norm(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");}
function dice(a,b){var x=norm(a),y=norm(b);if(x===y)return 1;if(x.length<2||y.length<2)return 0;var g={},h=0,i,k;for(i=0;i<x.length-1;i++){k=x.slice(i,i+2);g[k]=(g[k]||0)+1;}for(i=0;i<y.length-1;i++){k=y.slice(i,i+2);if(g[k]){h++;g[k]--;}}return 2*h/(x.length+y.length-2);}
function parse(s){try{return JSON.parse(s||"null");}catch(e){return null;}}
function cards(d){
 var a=[];
 if(Array.isArray(d))a=d;
 else if(d&&Array.isArray(d.results))a=d.results;
 else if(d&&d.data&&Array.isArray(d.data.results))a=d.data.results;
 else if(d&&d.data&&Array.isArray(d.data.items))a=d.data.items;
 else if(d&&Array.isArray(d.items))a=d.items;
 var o=[],seen={};
 for(var i=0;i<a.length;i++){
  var x=a[i]||{},id=String(x.slug||x.id||x.url||"");
  var tv=x.title||x.name||"";
  if(tv&&typeof tv==="object")tv=tv.english||tv.romaji||tv.native||tv.userPreferred||"";
  var title=txt(tv);
  if(!id||!title||seen[id])continue;
  if(/^https?:\/\//i.test(id))id=id.replace(/^https?:\/\/[^/]+/i,"").replace(/^\/?anime\//i,"").split(/[/?#]/)[0];
  else id=id.replace(/^\/?anime\//i,"").split(/[/?#]/)[0];
  if(!id)continue;
  seen[id]=1;
  o.push({id:id,title:title,url:id,cover:x.poster||x.posterUrl||x.thumbnail||x.image||x.cover||null,type:"anime",sourceId:SOURCE_ID});
 }
 return o;
}
function search(q,page,opts){
 q=String(q||"").trim();if(!q)return Promise.resolve([]);
 return get(SITE+"/anime?q="+encodeURIComponent(q),readDomain()+"/").then(function(h){
  var out=[],seen={},re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(h))&&out.length<40){
   var href=attrValue(m[1],"href");if(!href)continue;
   href=href.replace(/^https?:\/\/[^/]+/i,"");
   var hit=href.match(/^\/anime\/([^/?#]+)/i);if(!hit)continue;
   var id=hit[1],title=txt(attrValue(m[1],"title")||m[2].replace(/<[^>]*>/g," "));
   if(!title||title.length<2||seen[id])continue;
   seen[id]=1;
   var chunk=h.slice(m.index,m.index+2500),im=(chunk.match(/<img\b[^>]*(?:data-src|data-lazy-src|src)=["']([^"']+)/i)||[])[1]||null;
   out.push({id:id,title:title,url:id,cover:im?im.replace(/&amp;/g,"&"):null,type:"anime",sourceId:SOURCE_ID});
  }
  return out;
 }).catch(function(){return [];});
}
function getHome(opts){
 return get(SITE+"/",readDomain()+"/").then(function(h){
  var o=[],seen={},r=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=r.exec(h))&&o.length<40){
   var href=attrValue(m[1],"href");if(!href)continue;
   var path=href.replace(/^https?:\/\/[^/]+/i,"");
   var hit=path.match(/^\/anime\/([^/?#]+)/i);if(!hit)continue;
   var id=hit[1],title=txt(attrValue(m[1],"title")||m[2].replace(/<[^>]*>/g," "));
   if(!title||seen[id])continue;
   seen[id]=1;o.push({id:id,title:title,url:id,type:"anime",sourceId:SOURCE_ID});
  }
  return o.length?[{title:"KotoTV",items:o}]:[];
 }).catch(function(){return [];});
}
function getDetail(slug,opts){
 slug=String(slug||"").replace(/^https?:\/\/[^/]+/i,"").replace(/^\/?anime\//i,"").split(/[/?#]/)[0];
 return get(SITE+"/anime/"+encodeURIComponent(slug)+"/watch/1",readDomain()+"/").then(function(h){
  var title=txt((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||slug);
  var poster=(h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)||[])[1]||
   (h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)||[])[1]||null;
  var desc=(h.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)/i)||[])[1]||"";
  var eps=[],seen={},re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(h))&&eps.length<1000){
   var href=attrValue(m[1],"href");if(!href)continue;
   href=href.replace(/^https?:\/\/[^/]+/i,"");
   var hit=href.match(/^\/anime\/[^/]+\/watch\/(\d+)/i);
   if(!hit)continue;
   var n=Number(hit[1]);if(!n||seen[n])continue;seen[n]=1;
   var label=txt(m[2].replace(/<[^>]*>/g," "));
   eps.push({id:"kototv://"+encodeURIComponent(slug)+"/"+n,number:n,title:label||"Episode "+n,url:"kototv://"+encodeURIComponent(slug)+"/"+n});
  }
  eps.sort(function(a,b){return a.number-b.number;});
  return {id:slug,title:title||slug,url:slug,cover:poster?poster.replace(/&amp;/g,"&"):null,description:txt(desc),type:"anime",sourceId:SOURCE_ID,episodes:eps};
 }).catch(function(){return {id:slug,title:slug,url:slug,type:"anime",sourceId:SOURCE_ID,episodes:[]};});
}
function getEpisodes(id,opts){return getDetail(id,opts).then(function(d){return d.episodes||[];});}
function b64(s){var chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",map={},out=[],buf=0,bits=0;for(var i=0;i<64;i++)map[chars.charAt(i)]=i;s=String(s||"");for(var j=0;j<s.length;j++){var c=s.charAt(j);if(c==="="||map[c]==null)continue;buf=(buf<<6)|map[c];bits+=6;if(bits>=8){bits-=8;out.push((buf>>bits)&255);buf&=(1<<bits)-1;}}return out;}
function decode(blob){var a=b64(blob),key="otaku-embed-v1",s="";for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]^key.charCodeAt(i%key.length));try{return JSON.parse(decodeURIComponent(escape(s)));}catch(e){return null;}}
function _kotoResolveEmbed(embed,watchUrl){
 var candidates=[embed],seen={},jobs=[];
 function add(u){if(!u)return;u=String(u).replace(/&amp;/g,"&");try{u=new URL(u,embed).toString();}catch(e){return;}if(/^https?:\/\//i.test(u)&&!seen[u]){seen[u]=1;candidates.push(u);}}
 return get(embed,watchUrl).then(function(page){
  page=String(page||"").replace(/\\\//g,"/").replace(/&amp;/g,"&");
  var re=/<iframe\\b([^>]*)>/gi,m;
  while((m=re.exec(page))&&candidates.length<12)add(attrValue(m[1],"src"));
  var urlRe=/(https?:\\/\\/[^\\s"'<>\\\\]+?\\.m3u8(?:\\?[^\\s"'<>\\\\]*)?)/gi;
  while((m=urlRe.exec(page))&&candidates.length<12)add(m[1]);
  var jsonRe=/(?:file|source|url)\\s*[:=]\\s*["']([^"']+)["']/gi;
  while((m=jsonRe.exec(page))&&candidates.length<12)if(/m3u8|player|stream/i.test(m[1]))add(m[1]);
  if(typeof extractVideo!=="function")throw Error("KotoTV: shared extractor unavailable");
  var unique=candidates.filter(function(x,i,a){return a.indexOf(x)===i;});
  return Promise.all(unique.map(function(u){return Promise.resolve(extractVideo(u,{headers:{"User-Agent":UA,"Referer":u===embed?watchUrl:embed},kind:"sub",audioLang:"ja"})).catch(function(){return [];});})).then(function(groups){
   var out=[];groups.forEach(function(g){(Array.isArray(g)?g:[]).forEach(function(s){if(s&&s.url&&!out.some(function(x){return x.url===s.url;}))out.push(s);});});
   if(!out.length)throw Error("KotoTV: player page and nested embeds yielded no playable streams");return out;
  });
 });
}
function getVideoSources(url,opts){
 var p=String(url||"").replace(/^kototv:\/\//,"").split("/"),slug;
 try{slug=decodeURIComponent(p[0]);}catch(e){slug=p[0];}
 var n=parseInt(p[1],10);
 if(!slug||!(n>0))return Promise.reject(Error("KotoTV: invalid episode URL"));
 var watchUrl=readDomain()+"/anime/"+encodeURIComponent(slug)+"/watch/"+n;
 return fetch(watchUrl,{headers:{"User-Agent":UA,"Accept":"text/html,application/json,*/*","Referer":readDomain()+"/"}}).then(function(r){
  if(!r||r.status>=400)throw Error("KotoTV HTTP "+(r&&r.status||"error")+" at watch page");
  var html=String(r.body||"").replace(/\\\//g,"/").replace(/&amp;/g,"&"),iframes=[],m,re=/<iframe\b([^>]*)>/gi;
  while((m=re.exec(html))&&iframes.length<6){
   var src=attrValue(m[1],"src");if(!src)continue;
   try{var abs=new URL(src,watchUrl).toString();if(/^https?:\/\//i.test(abs)&&iframes.indexOf(abs)<0)iframes.push(abs);}catch(e){}
  }
  var base=(html.match(/baseEmbedUrl["']?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i)||[])[1]||
   (html.match(/data-base-embed-url=["']([^"']+)["']/i)||[])[1];
  if(base&&iframes.indexOf(base)<0)iframes.unshift(base);
  if(!iframes.length)throw Error("KotoTV: no player iframe found on watch page");
  if(typeof extractVideo!=="function")throw Error("KotoTV: shared player extractor unavailable");
  return Promise.all(iframes.map(function(embed){
   return _kotoResolveEmbed(embed,watchUrl).catch(function(){return [];});
  })).then(function(groups){
   var out=[];groups.forEach(function(group){(Array.isArray(group)?group:[]).forEach(function(s){
    if(s&&s.url&&!out.some(function(x){return x.url===s.url;}))out.push(s);
   });});
   if(!out.length)throw Error("KotoTV: player embed found, but the shared extractor returned no playable streams");
   return out;
  });
 });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=="undefined"&&module.exports)module.exports={version:"1.0.7",getInfo:getInfo,getSettings:getSettings,getHome:getHome,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks};
