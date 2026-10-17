// KotoTV anime source for Zangetsu.
var SOURCE_ID=(typeof __SOURCE_ID!=="undefined"&&__SOURCE_ID)?String(__SOURCE_ID):"kototv";
var SITE="https://kototv.to",PLAYER="https://player.kototv.to";
var UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
function getInfo(){return {name:"KotoTV",lang:"en",baseUrl:SITE,logo:"https://www.google.com/s2/favicons?sz=256&domain=kototv.to",type:"anime",version:"1.1.1"};}
function getSettings(){return [];}
function txt(s){return htmlText(String(s||"")).trim();}

function realTitle(value){
 var s=txt(value).replace(/\s+/g," ").trim();
 if(!s||s.length<2||s.length>300)return "";
 var meaningful=s.replace(/\b(?:tv|movie|movies|ova|ona|special|episode|episodes|sub|dub|hd|sd|season|series)\b/gi," ").replace(/[0-9]+/g," ").replace(/[^A-Za-z\u00C0-\u024F\u3040-\u30ff\u3400-\u9fff]/g,"");
 return meaningful?s:"";
}
function pickTitle(attrs,inner,card){
 var candidates=[],v;
 ["data-jp","data-title","title","aria-label"].forEach(function(n){v=attrValue(attrs,n);if(v)candidates.push(v);});
 var blocks=String(card||"")+" "+String(inner||"");
 var re=/<(?:h[1-6]|span|div|p)[^>]*class=["'][^"']*(?:name|title|d-title|film-name)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[1-6]|span|div|p)>/gi,m;
 while((m=re.exec(blocks))&&candidates.length<20)candidates.push(m[1].replace(/<[^>]*>/g," "));
 re=/data-jp=["']([^"']+)["']/gi;while((m=re.exec(blocks))&&candidates.length<25)candidates.push(m[1]);
 re=/<img\b[^>]*alt=["']([^"']+)["']/gi;while((m=re.exec(blocks))&&candidates.length<30)candidates.push(m[1]);
 candidates.push(String(inner||"").replace(/<[^>]*>/g," "));
 for(var i=0;i<candidates.length;i++){var title=realTitle(candidates[i]);if(title)return title;}
 return "";
}
function get(url,ref){return fetch(String(url||""),{headers:{"User-Agent":UA,"Accept":"text/html,application/json,*/*","Referer":ref||SITE+"/"}}).then(function(r){if(!r||r.status>=400)throw Error("KotoTV HTTP "+(r&&r.status||"error"));var b=r.body==null?"":r.body;if(!b)throw Error("Empty response");return b;});}
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
 var base=SITE;
 return get(base+"/anime?q="+encodeURIComponent(q),base+"/").then(function(h){
  h=String(h||"");var out=[],seen={},re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(h))&&out.length<60){
   var href=attrValue(m[1],"href");if(!href)continue;
   href=href.replace(/^https?:\/\/[^/]+/i,"");
   var hit=href.match(/(?:^|\/)anime\/([^/?#]+)/i);if(!hit)continue;
   var id=hit[1];
   var cardStart=Math.max(h.lastIndexOf('<div',m.index),h.lastIndexOf('<article',m.index),0);
   var chunk=h.slice(cardStart,Math.min(h.length,m.index+3000));
   var title=pickTitle(m[1],m[2],chunk);
   if(!title||seen[id])continue;
   seen[id]=1;
   var im=(chunk.match(/<img\b[^>]*(?:data-src|data-lazy-src|src)=["']([^"']+)/i)||[])[1]||null;
   out.push({id:id,title:title,url:id,cover:im?im.replace(/&amp;/g,"&"):null,type:"anime",sourceId:SOURCE_ID});
  }
  return out;
 }).catch(function(){return [];});
}
function getHome(opts){
 return get(SITE+"/",SITE+"/").then(function(h){
  var o=[],seen={},r=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=r.exec(h))&&o.length<40){
   var href=attrValue(m[1],"href");if(!href)continue;
   var path=href.replace(/^https?:\/\/[^/]+/i,"");
   var hit=path.match(/^\/anime\/([^/?#]+)/i);if(!hit)continue;
   var id=hit[1],cardStart=Math.max(h.lastIndexOf('<div',m.index),h.lastIndexOf('<article',m.index),0);
   var card=h.slice(cardStart,Math.min(h.length,m.index+3000)),title=pickTitle(m[1],m[2],card);
   if(!title||seen[id])continue;
   seen[id]=1;o.push({id:id,title:title,url:id,type:"anime",sourceId:SOURCE_ID});
  }
  return o.length?[{title:"KotoTV",items:o}]:[];
 }).catch(function(){return [];});
}
function getDetail(slug,opts){
 slug=String(slug||"").replace(/^https?:\/\/[^/]+/i,"").replace(/^\/?anime\//i,"").split(/[/?#]/)[0];
 return get(SITE+"/anime/"+encodeURIComponent(slug)+"/watch/1",SITE+"/").then(function(h){
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
   var label=txt(m[2].replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();
   // The watch selector can link to the same episode using labels such as
   // "Soft Sub", "Soft Dub", "Sub", or "Dub". These are audio/server options,
   // not episode titles; showing them as titles confuses the episode/player flow.
   if(/^(?:(?:soft|hard|multi)[\s-]*)?(?:sub(?:bed|title)?s?|dub(?:bed)?s?|audio|watch|play)(?:\s*[-:]?\s*(?:sub|dub))?$/i.test(label)) label="";
   if(/^episode\s*\d+\s*[-:]?\s*(?:soft\s*)?(?:sub|dub)$/i.test(label)) label="";
   if(!label || label.length>140) label="Episode "+n;
   eps.push({id:"kototv://"+encodeURIComponent(slug)+"/"+n,number:n,title:label,url:"kototv://"+encodeURIComponent(slug)+"/"+n});
  }
  eps.sort(function(a,b){return a.number-b.number;});
  return {id:slug,title:title||slug,url:slug,cover:poster?poster.replace(/&amp;/g,"&"):null,description:txt(desc),type:"anime",sourceId:SOURCE_ID,episodes:eps};
 }).catch(function(){return {id:slug,title:slug,url:slug,type:"anime",sourceId:SOURCE_ID,episodes:[]};});
}
function getEpisodes(id,opts){return getDetail(id,opts).then(function(d){return d.episodes||[];});}
function b64(s){var chars="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",map={},out=[],buf=0,bits=0;for(var i=0;i<64;i++)map[chars.charAt(i)]=i;s=String(s||"");for(var j=0;j<s.length;j++){var c=s.charAt(j);if(c==="="||map[c]==null)continue;buf=(buf<<6)|map[c];bits+=6;if(bits>=8){bits-=8;out.push((buf>>bits)&255);buf&=(1<<bits)-1;}}return out;}
function decode(blob){var a=b64(blob),key="otaku-embed-v1",s="";for(var i=0;i<a.length;i++)s+=String.fromCharCode(a[i]^key.charCodeAt(i%key.length));try{return JSON.parse(decodeURIComponent(escape(s)));}catch(e){return null;}}
function _kotoResolveEmbed(embed,watchUrl){
 var candidates=[embed],seen={},direct=[];
 function add(u){if(!u)return;u=String(u).replace(/&amp;/g,"&").replace(/\\\//g,"/");try{u=new URL(u,embed).toString();}catch(e){return;}if(/^https?:\/\//i.test(u)&&!seen[u]){seen[u]=1;candidates.push(u);}}
 function addDirect(u){if(!u)return;u=String(u).replace(/&amp;/g,"&").replace(/\\\//g,"/");try{u=new URL(u,embed).toString();}catch(e){return;}if(!/^https?:\/\//i.test(u)||direct.some(function(x){return x.url===u;}))return;if(/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(u)){direct.push({url:u,label:"KotoTV · Direct",quality:"Auto",container:/\.m3u8(?:[?#]|$)/i.test(u)?"hls":"mp4",headers:{"User-Agent":UA,"Referer":embed},referer:embed,kind:"sub",subtitles:[]});}}
 return get(embed,watchUrl).then(function(page){
  page=String(page||"").replace(/\\\//g,"/").replace(/&amp;/g,"&");
  var re=/<iframe\b([^>]*)>/gi,m;
  while((m=re.exec(page))&&candidates.length<12)add(attrValue(m[1],"src")||attrValue(m[1],"data-src"));
  var urlRe=/(https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\]*)?)/gi;
  while((m=urlRe.exec(page))&&candidates.length<12)addDirect(m[1]);
  var jsonRe=/(?:file|source|url)\s*["']?\s*[:=]\s*["']([^"']+)["']/gi;
  while((m=jsonRe.exec(page))&&candidates.length<12){if(/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(m[1]))addDirect(m[1]);else if(/player|stream|embed/i.test(m[1]))add(m[1]);}
  var dataRe=/data-(?:player|config|embed)=["']([^"']+)["']/gi;
  while((m=dataRe.exec(page))&&candidates.length<12){var decoded=decode(m[1]);if(decoded){if(decoded.file)addDirect(decoded.file);if(decoded.url)add(decoded.url);if(decoded.sources&&decoded.sources.file)addDirect(decoded.sources.file);}}
  var out=direct.slice();
  if(typeof extractVideo!=="function"&&out.length)return out;
  if(typeof extractVideo!=="function")throw Error("KotoTV: shared extractor unavailable");
  var unique=candidates.filter(function(x,i,a){return a.indexOf(x)===i;});
  return Promise.all(unique.map(function(u){return Promise.resolve(extractVideo(u,{headers:{"User-Agent":UA,"Referer":u===embed?watchUrl:embed},kind:"sub",audioLang:"ja"})).catch(function(){return [];});})).then(function(groups){
   groups.forEach(function(g){(Array.isArray(g)?g:[]).forEach(function(s){if(s&&s.url&&!out.some(function(x){return x.url===s.url;}))out.push(s);});});
   if(!out.length)throw Error("KotoTV: player page and nested embeds yielded no playable streams");return out;
  });
 });
}
function getVideoSources(url,opts){
 var p=String(url||"").replace(/^kototv:\/\//,"").split("/"),slug;
 try{slug=decodeURIComponent(p[0]);}catch(e){slug=p[0];}
 var n=parseInt(p[1],10);
 if(!slug||!(n>0))return Promise.reject(Error("KotoTV: invalid episode URL"));
 var watchUrl=SITE+"/anime/"+encodeURIComponent(slug)+"/watch/"+n;
 return fetch(watchUrl,{headers:{"User-Agent":UA,"Accept":"text/html,application/json,*/*","Referer":SITE+"/"}}).then(function(r){
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
if(typeof module!=="undefined"&&module.exports)module.exports={version:"1.1.1",getInfo:getInfo,getSettings:getSettings,getHome:getHome,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks};
