// HiAnime provider pinned to the primary domain.
var SOURCE_ID=(typeof __SOURCE_ID!=="undefined"&&__SOURCE_ID)?String(__SOURCE_ID):"hianime";
var SITE="https://hianime.dk",UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
function getInfo(){return {name:"HiAnime",lang:"en",baseUrl:readDomain(),logo:"https://www.google.com/s2/favicons?sz=256&domain=hianime.dk",type:"anime",version:"1.0.4"};}
function readDomain(){return SITE;}
function getSettings(){return [];}
function decode(s){return String(s||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");}
function strip(s){return decode(String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();}
function request(path){var host=readDomain();return fetch(host+path,{headers:{"User-Agent":UA,"Accept":"text/html,application/json,*/*","Referer":host+"/"}}).then(function(r){if(!r||r.status>=400)throw Error("HiAnime HTTP "+(r&&r.status||"error")+" at "+host);var b=r.body;if(typeof b!=="string"&&r.text)return r.text().then(function(t){return {body:t,host:host};});if(typeof b!=="string")throw Error("Empty HiAnime response at "+host);return {body:b,host:host};});}
function cleanSlug(href){var path=decode(String(href||"")).replace(/^https?:\/\/[^/]+/i,"").replace(/^\//,"").split(/[?#]/)[0];return path.replace(/^(?:watch|anime)\//i,"").replace(/^\/+/,"");}
function cards(h,host){
 var out=[],seen={},m;
 var re=/<h3\b([^>]*)>([\s\S]*?)<\/h3>/gi;
 while((m=re.exec(String(h||"")))&&out.length<40){
  if(!/\bfilm-name\b/i.test(m[1]))continue;
  var a=(m[2].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i)||[]);
  if(!a[1])continue;
  var href=(a[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)||[])[1]||"";
  var title=(a[1].match(/\btitle\s*=\s*["']([^"']+)["']/i)||[])[1]||strip(a[2]);
  var id=cleanSlug(href);
  title=decode(title);
  if(!id||!title||title.length<2||seen[id])continue;
  seen[id]=1;
  var chunk=String(h).slice(m.index,m.index+3000),im=(chunk.match(/<img\b[^>]*(?:data-src|data-lazy-src|src)=["']([^"']+)/i)||[])[1]||null;
  out.push({id:id,title:title,url:id,cover:im?decode(im):null,type:"anime",sourceId:SOURCE_ID});
 }
 if(out.length)return out;
 re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
 while((m=re.exec(String(h||"")))&&out.length<40){
  var href2=(m[1].match(/\bhref\s*=\s*["']([^"']+)["']/i)||[])[1]||"";
  if(!/(?:^|\/)(?:watch|anime)\//i.test(href2))continue;
  var title2=decode((m[1].match(/\btitle\s*=\s*["']([^"']+)["']/i)||[])[1]||strip(m[2]));
  var id2=cleanSlug(href2);
  if(!title2||title2.length<2||!id2||seen[id2])continue;
  seen[id2]=1;
  out.push({id:id2,title:title2,url:id2,cover:null,type:"anime",sourceId:SOURCE_ID});
 }
 return out;
}
function search(q,page,opts){q=String(q||"").trim();if(!q)return Promise.resolve([]);return request("/search?keyword="+encodeURIComponent(q)+"&page="+Math.max(1,Number(page)||1)).then(function(r){var a=cards(r.body,r.host);return a;}).catch(function(e){console.warn("[HiAnime] search failed: "+e.message);return [];});}
function getHome(opts){return request("/").then(function(r){var a=cards(r.body,r.host);return a.length?[{title:"HiAnime",items:a.slice(0,24)}]:[];}).catch(function(){return [];});}
function getDetail(id,opts){
 var slug=cleanSlug(String(id||""));
 if(!slug)return Promise.resolve({id:"",title:"Unknown anime",url:"",type:"anime",sourceId:SOURCE_ID,episodes:[]});
 return request("/watch/"+slug).then(function(r){
  var h=r.body,title=strip((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||slug);
  var poster=(h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)||[])[1]||
   (h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)||[])[1]||null;
  var eps=[],seen={},re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(h))&&eps.length<500){
   var href=(m[1].match(/\bhref=["']([^"']+)["']/i)||[])[1]||"";
   if(!/(?:\/watch\/|\/episode\/)/i.test(href))continue;
   var hrefDecoded=decode(href),bodyText=strip(m[2]);
   var num=(bodyText.match(/(?:episode|ep)\s*#?\s*(\d+(?:\.\d+)?)/i)||hrefDecoded.match(/[?&]ep=(\d+(?:\.\d+)?)/i)||hrefDecoded.match(/episode[-/](\d+(?:\.\d+)?)/i)||[])[1];
   if(!num)continue;
   var number=Number(num),key=hrefDecoded+"|"+number;
   if(seen[key])continue;seen[key]=1;
   eps.push({id:"hianime://"+encodeURIComponent(slug)+"/"+number,url:"hianime://"+encodeURIComponent(slug)+"/"+number,number:number,title:bodyText||"Episode "+number});
  }
  eps.sort(function(a,b){return a.number-b.number;});
  return {id:slug,title:title||slug,url:slug,cover:poster?decode(poster):null,type:"anime",sourceId:SOURCE_ID,episodes:eps};
 }).catch(function(){return {id:slug,title:slug,url:slug,type:"anime",sourceId:SOURCE_ID,episodes:[]};});
}
function getEpisodes(id,opts){return getDetail(id,opts).then(function(d){return d.episodes||[];});}
function requestExternal(url,referer){
 return fetch(url,{headers:{"User-Agent":UA,"Accept":"text/html,application/json,*/*","Referer":referer||SITE+"/","Origin":(function(){try{return new URL(referer||SITE+"/").origin;}catch(e){return SITE;}})()}})
 .then(function(r){if(!r||r.status>=400)throw Error("HiAnime player HTTP "+(r&&r.status||"error"));var b=r.body;if(typeof b!=="string"&&r.text)return r.text();if(typeof b!=="string")throw Error("Empty player response");return b;})
 .then(function(b){return typeof b==="string"?b:(b&&typeof b.body==="string"?b.body:"");});
}
function normalizePageText(s){return String(s||"").replace(/\\u0026/g,"&").replace(/\\\//g,"/").replace(/&amp;/g,"&").replace(/\\u003d/gi,"=");}
function findMedia(html){
 var h=normalizePageText(html),m;
 var patterns=[
  /(?:file|src|source|url)\s*["']?\s*[:=]\s*["'](https?:\/\/[^"'<>\\\s]+\.m3u8(?:\?[^"'<>\\\s]*)?)/i,
  /["'](https?:\/\/[^"'<>\\\s]+\.m3u8(?:\?[^"'<>\\\s]*)?)["']/i,
  /(?:file|src|source|url)\s*["']?\s*[:=]\s*["'](https?:\/\/[^"'<>\\\s]+\.mp4(?:\?[^"'<>\\\s]*)?)/i,
  /["'](https?:\/\/[^"'<>\\\s]+\.mp4(?:\?[^"'<>\\\s]*)?)["']/i
 ];
 for(var i=0;i<patterns.length;i++){m=h.match(patterns[i]);if(m)return m[1].replace(/&amp;/g,"&");}
 return null;
}
function makeMedia(url,referer){
 var container=/\.m3u8(?:$|[?#])/i.test(url)?"hls":(/\.mpd(?:$|[?#])/i.test(url)?"dash":"mp4");
 return {url:url,quality:"Auto",container:container,headers:{"Referer":referer||SITE+"/","User-Agent":UA}};
}
function getVideoSources(url,opts){
 var p=String(url||"").replace(/^hianime:\/\//,"").split("/"),slug;
 try{slug=decodeURIComponent(p[0]);}catch(e){slug=p[0];}
 var ep=p[1];
 if(!slug||!/^\d+(?:\.\d+)?$/.test(ep||""))return Promise.reject(Error("HiAnime: invalid episode URL"));
 return request("/watch/"+cleanSlug(slug)).then(function(r){
  var watch=normalizePageText(r.body),direct=findMedia(watch);
  if(direct)return [makeMedia(direct,r.host+"/")];
  var frames=[],re=/<iframe\b([^>]*)>/gi,m;
  while((m=re.exec(watch))&&frames.length<6){
   var src=(m[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i)||[])[1];
   if(!src)continue;
   try{var abs=new URL(decode(src),r.host+"/").toString();if(/^https?:\/\//i.test(abs)&&frames.indexOf(abs)<0)frames.push(abs);}catch(e){}
  }
  if(!frames.length)throw Error("HiAnime: no direct media URL or player iframe found");
  return Promise.all(frames.map(function(frame){
   return requestExternal(frame,r.host+"/").then(function(html){
    var media=findMedia(html);
    if(media){var origin;try{origin=new URL(frame).origin+"/";}catch(e){origin=frame;}return [makeMedia(media,origin)];}
    return [];
   }).catch(function(){return [];});
  })).then(function(groups){
   var out=[];groups.forEach(function(list){list.forEach(function(x){if(!out.some(function(s){return s.url===x.url;}))out.push(x);});});
   if(!out.length)throw Error("HiAnime: player iframe loaded but did not expose a direct media URL");
   return out;
  });
 });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=="undefined"&&module.exports)module.exports={version:"1.0.4",getInfo:getInfo,getSettings:getSettings,getHome:getHome,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks};
