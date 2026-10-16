// AniKoto — maintained replacement for the discontinued HiAnime site.
var SOURCE_ID=(typeof __SOURCE_ID!=="undefined"&&__SOURCE_ID)?String(__SOURCE_ID):"anikoto";
var API="https://anikotoapi.site",SITE="https://anikototv.to";
var UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
function getInfo(){return {name:"AniKoto",lang:"en",baseUrl:SITE,logo:SITE+"/favicon.ico",type:"anime",version:"1.0.0"};}
function text(s){return htmlText(String(s||"").replace(/<[^>]*>/g," ")).replace(/\s+/g," ").trim();}
function get(url,ref){return fetch(url,{headers:{"User-Agent":UA,"Accept":"text/html,application/json,*/*","Referer":ref||SITE+"/"}}).then(function(r){if(!r||r.status>=400)throw Error("AniKoto HTTP "+(r&&r.status||"error"));if(typeof r.body!=="string")throw Error("AniKoto empty response");return r.body;});}
function json(url){return get(url,API+"/").then(function(b){var j;try{j=JSON.parse(b);}catch(e){throw Error("AniKoto invalid JSON");}return j;});}
function trim(s){return String(s==null?"":s).replace(/^\s+|\s+$/g,"");}
function attr(s,n){var m=String(s||"").match(new RegExp("\\b"+n+"\\s*=\\s*([\\\"'])(.*?)\\1","i"));return m?m[2]:null;}
function search(q,page,opts){
 q=trim(q);if(!q)return Promise.resolve([]);
 return get(SITE+"/search?keyword="+encodeURIComponent(q),SITE+"/").then(function(h){
  var out=[],seen={},re=/<a\b([^>]*)>([\s\S]*?)<\/a>/gi,m;
  while((m=re.exec(h))&&out.length<30){
   var href=attr(m[1],"href")||"",hit=href.match(/(?:^|\/)watch\/([a-z0-9-]+)\/ep-\d+/i);
   if(!hit)continue;
   var slug=hit[1],title=trim(attr(m[1],"data-jp")||m[2].replace(/<[^>]*>/g,""));
   if(!title)title=slug.replace(/-/g," ");
   if(seen[slug])continue;seen[slug]=1;
   var chunk=h.slice(Math.max(0,m.index-1200),m.index+500),img=(chunk.match(/<img\b[^>]*(?:src|data-src)=["']([^"']+)/i)||[])[1]||null;
   out.push({id:"anikoto:watch:"+slug,title:title,url:"anikoto://watch/"+slug,cover:img,type:"anime",sourceId:SOURCE_ID});
  }
  return out;
 }).catch(function(){return [];});
}
function getHome(opts){
 return json(API+"/recent-anime?page=1&per_page=30").then(function(j){
  var a=Array.isArray(j&&j.data)?j.data:(Array.isArray(j&&j.anime)?j.anime:[]),items=[];
  for(var i=0;i<a.length;i++){var x=a[i]||{},id=String(x.id||"");if(!id)continue;items.push({id:"anikoto:series:"+id,title:x.title||x.name||id,url:"anikoto://series/"+id,cover:x.poster||null,type:"anime",sourceId:SOURCE_ID});}
  return items.length?[{title:"Recently Updated",items:items}]:[];
 }).catch(function(){return [];});
}
function seriesIdFromSlug(slug){return get(SITE+"/watch/"+slug+"/ep-1",SITE+"/").then(function(h){var m=h.match(/\bdata-id=["'](\d+)["']/i);if(!m)throw Error("AniKoto series ID not found");return m[1];});}
function seriesDetail(id){
 return json(API+"/series/"+encodeURIComponent(id)).then(function(j){
  var d=j&&j.data?j.data:j||{},a=d.anime||d.series||{},raw=Array.isArray(d.episodes)?d.episodes:[],slug=String(a.id||id),eps=[];
  for(var i=0;i<raw.length;i++){
   var e=raw[i]||{},n=Number(e.number||e.episode_no||i+1);if(!(n>0))continue;
   eps.push({id:"anikoto://ep/"+slug+"/"+n,url:"anikoto://ep/"+slug+"/"+n,number:n,title:e.title||"Episode "+n});
  }
  eps.sort(function(a,b){return a.number-b.number;});
  return {id:"anikoto:series:"+slug,title:a.title||a.name||slug,url:"anikoto://series/"+slug,cover:a.poster||null,description:a.description||"",type:"anime",sourceId:SOURCE_ID,episodes:eps};
 });
}
function getDetail(url,opts){
 var s=String(url||""),m=/^anikoto:\/\/watch\/([a-z0-9-]+)/i.exec(s),n=/^anikoto:\/\/series\/(\d+)/i.exec(s);
 if(n)return seriesDetail(n[1]);
 if(m)return seriesIdFromSlug(m[1]).then(seriesDetail);
 var id=s.replace(/^anikoto:series:/,"").replace(/^.*\//,"");
 if(/^\d+$/.test(id))return seriesDetail(id);
 return Promise.reject(Error("AniKoto invalid series URL"));
}
function getEpisodes(url,opts){return getDetail(url,opts).then(function(d){return d.episodes||[];});}
function getVideoSources(url,opts){
 var m=/^anikoto:\/\/ep\/(\d+)\/(\d+)/i.exec(String(url||""));
 if(!m)return Promise.reject(Error("AniKoto invalid episode URL"));
 var id=m[1],num=Number(m[2]);
 return seriesDetail(id).then(function(d){
  return json(API+"/series/"+encodeURIComponent(id)).then(function(j){
   var data=j&&j.data?j.data:j||{},episodes=Array.isArray(data.episodes)?data.episodes:[],ep=null;
   for(var i=0;i<episodes.length;i++)if(Number(episodes[i].number||episodes[i].episode_no)===num){ep=episodes[i];break;}
   if(!ep)throw Error("AniKoto episode not found");
   var embeds=ep.embed_url||{},jobs=[];
   ["sub","dub"].forEach(function(kind){var u=embeds[kind];if(u&&typeof extractVideo==="function")jobs.push(Promise.resolve(extractVideo(u,{headers:{"User-Agent":UA,"Referer":"https://megaplay.buzz/"},kind:kind,audioLang:kind==="dub"?"en":"ja"})).catch(function(){return [];}));});
   if(!jobs.length)throw Error("AniKoto has no supported episode embeds");
   return Promise.all(jobs).then(function(groups){var out=[];groups.forEach(function(g){(Array.isArray(g)?g:[]).forEach(function(x){if(x&&x.url&&!out.some(function(y){return y.url===x.url;}))out.push(x);});});if(!out.length)throw Error("AniKoto player embed could not be resolved to a native stream");return out;});
  });
 });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=="undefined"&&module.exports)module.exports={version:"1.0.0",getInfo:getInfo,getHome:getHome,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks};