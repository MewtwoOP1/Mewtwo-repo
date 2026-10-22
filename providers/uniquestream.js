/* Zangetsu source — Uniquestream. Publicly exposed page data only. */
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'uniquestream';
var SITE = 'https://anime.uniquestream.net';
var MEDIA = 'https://media.uniquestream.net';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
var VERSION = '0.4.0';

function getInfo() { return { name:'Uniquestream', lang:'en', baseUrl:SITE, logo:'https://www.google.com/s2/favicons?sz=256&domain=anime.uniquestream.net', type:'anime', version:VERSION }; }
function getSettings() { return []; }
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g,''); }
function _decode(s) {
  return String(s == null ? '' : s).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#0?39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&nbsp;/gi,' ')
    .replace(/&#(\d+);/g,function(_,n){return String.fromCharCode(Number(n));})
    .replace(/&#x([\da-f]+);/gi,function(_,n){return String.fromCharCode(parseInt(n,16));});
}
function _text(s) {
  var v=String(s||'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ');
  if(typeof htmlText==='function'){try{return _trim(htmlText(v));}catch(e){}}
  return _trim(_decode(v).replace(/\s+/g,' '));
}
function _attr(tag,name) {
  var pattern='(?:^|\\s)'+name+'\\s*=\\s*(["\\x27])([^"\\x27]*)["\\x27]';
  var m=String(tag||'').match(new RegExp(pattern,'i'));
  if(m)return _decode(m[2]);
  var bare=String(tag||'').match(new RegExp('(?:^|\\s)'+name+'\\s*=\\s*([^\\s>]+)','i'));
  return bare?_decode(bare[1]):'';
}
function _abs(raw,base) {
  var s=_trim(_decode(raw)); if(!s||/^(?:javascript|data|mailto):/i.test(s))return '';
  try{return new URL(s,base||SITE+'/').href;}catch(e){return '';}
}
function _siteUrl(raw,base) {
  var u=_abs(raw,base); if(!u)return '';
  try { var p=new URL(u); return (p.protocol==='https:'||p.protocol==='http:')&&(p.hostname==='anime.uniquestream.net'||p.hostname==='media.uniquestream.net')?p.href:''; }
  catch(e){return '';}
}
function _request(url,referer) {
  return Promise.resolve().then(function(){return fetch(url,{headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Referer':referer||SITE+'/'},timeoutMs:15000});})
    .then(function(r){
      if(!r)throw new Error('Uniquestream: empty response');
      var status=Number(r.status||200); if(status<200||status>=400)throw new Error('Uniquestream: HTTP '+status+' for '+url);
      var body=typeof r.body==='string'?r.body:(typeof r.text==='function'?r.text():'');
      return Promise.resolve(body).then(function(s){
        if(!s||typeof s!=='string')throw new Error('Uniquestream: empty response body for '+url);
        if(/(checking your browser|cf-chl-|captcha|access denied)/i.test(s.slice(0,5000)))throw new Error('Uniquestream: site access verification blocked the request');
        return s;
      });
    });
}
function _titleFromCard(card) {
  var m=card.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
    card.match(/<a\b[^>]*aria-label=["']([^"']+)["'][^>]*>/i) ||
    card.match(/<a\b[^>]*title=["']([^"']+)["'][^>]*>/i) ||
    card.match(/<meta\b[^>]*property=["']og:title["'][^>]*>/i);
  var title=m?(_attr(m[0],'content')||_text(m[1]||m[0])):'';
  if(!title){var clean=_text(card);title=clean.split(/\b(?:SUB|DUB|MOVIE|SERIES|WATCH NOW|WATCHLIST)\b/i)[0];}
  return _trim(title);
}
function _cardFromBlock(block,base,out,seen) {
  var anchors=String(block||'').match(/<a\b[^>]*>/gi)||[],href='';
  for(var j=0;j<anchors.length;j++){
    var candidate=_attr(anchors[j],'href');
    if(/\/(?:series|film|title)\//i.test(candidate)){href=candidate;break;}
  }
  if(!href){var hm=String(block||'').match(/href=["']([^"']*\/(?:series|film|title)\/[^"']+)["']/i);if(hm)href=hm[1];}
  var url=_siteUrl(href,base); if(!url||seen[url])return;
  var title=_titleFromCard(String(block||'')); if(!title)return;
  var img=(String(block||'').match(/<(?:img|source)\b[^>]*>/i)||[''])[0];
  var imgSrc=_attr(img,'src')||_attr(img,'data-src')||_attr(img,'data-lazy-src')||_attr(img,'srcset').split(',')[0].trim().split(/\s+/)[0];
  var cover=_abs(imgSrc,base)||null;
  seen[url]=true;
  out.push({id:url,title:title,url:url,cover:cover,type:/\/(?:film|title)\//i.test(url)?'movie':'anime',sourceId:SOURCE_ID});
}
function _cards(html,base) {
  var source=String(html||''),out=[],seen={},blocks=source.match(/<(?:article|li)\b[^>]*>[\s\S]*?<\/(?:article|li)>/gi)||[];
  // Always inspect all matching anchors as well: nav/list-item markup must not
  // prevent catalogue cards rendered in divs from being considered.
  for(var i=0;i<blocks.length;i++)_cardFromBlock(blocks[i],base,out,seen);
  var anchors=source.match(/<a\b[^>]*href=["'][^"']*\/(?:series|film|title)\/[^"']+["'][^>]*>[\s\S]*?<\/a>/gi)||[];
  for(var j=0;j<anchors.length;j++)_cardFromBlock(anchors[j],base,out,seen);
  // Some pages expose cards as an anchor with a title but no nested content.
  var bare=source.match(/<a\b[^>]*href=["'][^"']*\/(?:series|film|title)\/[^"']+["'][^>]*>/gi)||[];
  for(var k=0;k<bare.length;k++)_cardFromBlock(bare[k],base,out,seen);
  return out;
}
function _uniqueCards(groups) {
  var out=[],seen={};
  for(var i=0;i<groups.length;i++) {
    var list=groups[i]||[];
    for(var j=0;j<list.length;j++) {
      var item=list[j],key=String(item.url||item.id||'');
      if(!key||seen[key])continue;
      seen[key]=true;out.push(item);
    }
  }
  return out;
}
function _fetchCardPages(urls) {
  return Promise.all(urls.map(function(url) {
    return _request(url).then(function(html){return _cards(html,url);},function(){return [];});
  })).then(_uniqueCards);
}
function _json(url) {
  return _request(url).then(function(body) {
    try { return JSON.parse(body); }
    catch(e) { throw new Error('Uniquestream: invalid JSON response from '+url); }
  });
}
function _normalTitle(s) {
  return _trim(String(s||'').toLowerCase())
    .replace(/&amp;/g,' and ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function _slug(s) {
  return _trim(String(s||''))
    .replace(/&amp;/gi,'and')
    .replace(/[^A-Za-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'') || 'title';
}
function _apiCard(item,kind) {
  if(!item||typeof item!=='object')return null;
  var id=String(item.content_id||item.contentId||item.id||'');
  var title=_trim(item.title||item.name||'');
  if(!id||!title)return null;
  var type=(kind==='movie'||String(item.type||'').toLowerCase()==='movie')?'movie':'anime';
  var path=type==='movie'?('/content/'+encodeURIComponent(id)):('/series/'+encodeURIComponent(id)+'/'+_slug(title));
  var url=SITE+path;
  var cover=item.image||item.image_tall||item.poster||item.cover||null;
  if(cover)cover=_abs(cover,SITE+'/');
  return {id:url,title:title,url:url,cover:cover,type:type,sourceId:SOURCE_ID};
}
function _apiCards(payload) {
  var data=payload&&payload.data!=null?payload.data:payload;
  var groups=[];
  if(Array.isArray(data))groups.push(data);
  if(data&&typeof data==='object') {
    if(Array.isArray(data.series))groups.push(data.series.map(function(x){return Object.assign({_kind:'series'},x);}));
    if(Array.isArray(data.movies))groups.push(data.movies.map(function(x){return Object.assign({_kind:'movie'},x);}));
    if(Array.isArray(data.items))groups.push(data.items);
    if(Array.isArray(data.results))groups.push(data.results);
    if(Array.isArray(data.data))groups.push(data.data);
  }
  var out=[];
  for(var i=0;i<groups.length;i++) {
    for(var j=0;j<groups[i].length;j++) {
      var raw=groups[i][j]||{},kind=raw._kind||'';
      var item=_apiCard(raw,kind);
      if(item)out.push(item);
    }
  }
  if(!out.length&&data&&typeof data==='object'&&data.result&&typeof data.result==='object')return _apiCards(data.result);
  return _uniqueCards([out]);
}
function _fetchApiCards(urls) {
  return Promise.all(urls.map(function(url) {
    return _json(url).then(_apiCards,function(){return [];});
  })).then(_uniqueCards);
}
function _matchingCards(items,query) {
  var q=_normalTitle(query),words=q.split(' ').filter(function(w){return w.length>1;});
  if(!q)return [];
  return items.filter(function(item) {
    var t=_normalTitle(item.title);
    if(!t)return false;
    if(t.indexOf(q)>=0)return true;
    return words.length>0&&words.every(function(w){return t.indexOf(w)>=0;});
  });
}
function _letterFor(query) {
  var s=_trim(query).replace(/^#+/,'');
  if(!s)return 'A';
  var c=s.charAt(0).toUpperCase();
  return /^[A-Z0-9]$/.test(c)?c:'A';
}
function _htmlSearch(query,page) {
  var enc=encodeURIComponent(query),p=page||1;
  var candidates=[
    SITE+'/search?q='+enc+'&page='+p,
    SITE+'/search/?q='+enc+'&page='+p,
    SITE+'/search?query='+enc+'&page='+p,
    SITE+'/search?keyword='+enc+'&page='+p
  ];
  return _fetchCardPages(candidates).then(function(items) {
    if(items.length)return items;
    var letter=_letterFor(query),letterUrls=[];
    for(var n=p;n<=p+2;n++)letterUrls.push(SITE+'/videos/alphabetical/?letter='+encodeURIComponent(letter)+'&page='+n);
    letterUrls.push(SITE+'/videos/alphabetical/?letter='+encodeURIComponent(letter));
    return _fetchCardPages(letterUrls).then(function(found) {
      var matches=_matchingCards(found,query);
      if(matches.length)return matches;
      return _fetchCardPages([SITE+'/videos/alphabetical/',SITE+'/']).then(function(fallback) {
        return _matchingCards(fallback,query);
      });
    });
  });
}
function search(query,page,opts) {
  var q=_trim(query);if(!q)return Promise.resolve([]);
  var p=page&&Number(page)>1?Number(page):1,enc=encodeURIComponent(q);
  // The live site exposes a JSON API. Its parameter is query, with t, limit,
  // and page. The older implementation scraped /search?q= where the browser
  // receives an app shell and no result cards.
  var apiUrls=[
    SITE+'/api/v1/search?query='+enc+'&t=all&limit=24&page='+p,
    SITE+'/api/v1/search?q='+enc+'&t=all&limit=24&page='+p
  ];
  return _fetchApiCards(apiUrls).then(function(items) {
    if(items.length)return items.slice(0,30);
    return _htmlSearch(q,p).then(function(fallback) {
      var out=[],seen={};
      for(var i=0;i<fallback.length&&out.length<30;i++) {
        var key=String(fallback[i].url||fallback[i].id||'');
        if(key&&!seen[key]){seen[key]=true;out.push(fallback[i]);}
      }
      return out;
    });
  }).catch(function(){return [];});
}
function popular(opts) {
  // Public JSON catalogue routes used by other public AnimeStream clients.
  var apiUrls=[
    SITE+'/api/v1/videos/popular?limit=20&page=1&type=all',
    SITE+'/api/v1/videos/new?limit=20&page=1&type=all'
  ];
  return _fetchApiCards(apiUrls).then(function(items) {
    if(items.length)return items.slice(0,30);
    return _fetchCardPages([SITE+'/videos/popular/',SITE+'/videos/new/']).then(function(htmlItems) {
      if(htmlItems.length)return htmlItems.slice(0,30);
      return _fetchCardPages([SITE+'/videos/alphabetical/',SITE+'/']).then(function(fallback) {
        return fallback.slice(0,30);
      });
    });
  }).catch(function(){return [];});
}
function getHome(opts) {
  return popular(opts).then(function(items){return items.length?[{title:'Uniquestream Catalogue',items:items}]:[];});
}
function _seriesUrl(value) {
  var raw=String(value||'');
  if(raw.indexOf('uniquestream://series/')===0)raw=raw.slice('uniquestream://series/'.length);
  var u=_siteUrl(raw,SITE+'/');
  if(!u)return '';
  try { var p=new URL(u); return /^\/(?:series|film|title)\//i.test(p.pathname)?p.href:''; }catch(e){return '';}
}
function _metaValue(html,property) {
  var tags=String(html||'').match(/<meta\b[^>]*>/gi)||[];
  for(var i=0;i<tags.length;i++){
    var tag=tags[i],key=_attr(tag,'property')||_attr(tag,'name')||_attr(tag,'itemprop');
    if(key.toLowerCase()===property.toLowerCase())return _attr(tag,'content');
  }
  return '';
}
function _count(html,label) {
  var re=new RegExp(label+'\\s*[:：]?\\s*</?[^>]*>\\s*(\\d+)','i'),m=String(html||'').match(re);
  if(m)return Number(m[1]);
  var t=_text(html),m2=t.match(new RegExp(label+'\\s+(\\d+)','i'));return m2?Number(m2[1]):null;
}
function _parseStructuredEpisodes(html,base) {
  var out=[],seen={},scripts=String(html||'').match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)||[];
  function visit(value) {
    if(!value)return;
    if(Array.isArray(value)){for(var i=0;i<value.length;i++)visit(value[i]);return;}
    if(typeof value!=='object')return;
    var url=value.url||value.contentUrl||value.embedUrl||value.watchUrl||value.href;
    var name=value.name||value.title||value.episodeTitle||'';
    var n=value.episodeNumber||value.episode||value.number;
    var u=_siteUrl(url,base);
    if(u&&/\/watch\//i.test(u)&&!seen[u]){
      seen[u]=true;var num=Number(n);if(!isFinite(num)||num<1){var m=String(name).match(/(?:episode|ep\.?|e)\s*0*(\d+(?:\.\d+)?)/i);num=m?Number(m[1]):out.length+1;}
      out.push({id:'uniquestream://episode/'+encodeURIComponent(u),number:num,title:_trim(String(name||''))||('Episode '+num),url:'uniquestream://episode/'+encodeURIComponent(u),sourceId:SOURCE_ID,type:'anime'});
    }
    for(var key in value)if(Object.prototype.hasOwnProperty.call(value,key)&&typeof value[key]==='object')visit(value[key]);
  }
  for(var j=0;j<scripts.length;j++){
    var content=scripts[j].replace(/^<script\b[^>]*>/i,'').replace(/<\/script>\s*$/i,'').trim();
    if(!content)continue;
    try{visit(JSON.parse(content));}catch(e){}
    // Parse only explicit public watch links in inline JSON/JS strings; do not
    // execute page scripts or call undocumented endpoints.
    var links=content.match(/(?:https?:\\?\/\\?\/anime\.uniquestream\.net)?\\?\/watch\\?\/[^"'\s<>\\]+/gi)||[];
    for(var k=0;k<links.length;k++){
      var raw=links[k].replace(/\\\//g,'/'),u2=_siteUrl(raw,base);
      if(u2&& !seen[u2]){seen[u2]=true;out.push({id:'uniquestream://episode/'+encodeURIComponent(u2),number:out.length+1,title:'Episode '+(out.length+1),url:'uniquestream://episode/'+encodeURIComponent(u2),sourceId:SOURCE_ID,type:'anime'});}
    }
  }
  return out.sort(function(a,b){return a.number-b.number;});
}
function _episodeItems(html,base) {
  var out=[],seen={},anchors=String(html||'').match(/<a\b[^>]*>[\s\S]*?<\/a>/gi)||[];
  for(var i=0;i<anchors.length;i++){
    var a=anchors[i],open=(a.match(/^<a\b[^>]*>/i)||[''])[0],href=_attr(open,'href');
    if(!/\/watch\/[A-Za-z0-9_-]+(?:\/|$)/i.test(href))continue;
    var page=_siteUrl(href,base);if(!page||seen[page])continue;
    var title=_text(a)||_attr(open,'aria-label')||_attr(open,'title');
    // The series page's "Start Watching S1 E1" is a shortcut, not a catalogue
    // episode. Keep it as an episode only if no proper episode listing exists.
    var isShortcut=/start watching/i.test(title);
    var nm=title.match(/(?:episode|ep\.?|\bE)\s*0*(\d+(?:\.\d+)?)/i),pathNum=page.match(/(?:episode|ep|e)[-_/]?0*(\d+(?:\.\d+)?)(?:\/|$)/i);
    var number=nm?Number(nm[1]):(pathNum?Number(pathNum[1]):out.length+1);
    seen[page]=true;
    if(!isShortcut)out.push({id:'uniquestream://episode/'+encodeURIComponent(page),number:number,title:title||('Episode '+number),url:'uniquestream://episode/'+encodeURIComponent(page),sourceId:SOURCE_ID,type:'anime'});
  }
  if(!out.length)out=_parseStructuredEpisodes(html,base);
  // Do not fabricate a full episode list from a count. A count alone is not
  // enough to derive real episode URLs or playable source identifiers.
  return out.sort(function(a,b){return a.number-b.number;});
}
function _metadata(html,url) {
  var title='',h=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if(h)title=_text(h[1]);
  title=title||_metaValue(html,'og:title')||_metaValue(html,'twitter:title');
  if(!title){var t=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);if(t)title=_text(t[1]);}
  var description=_metaValue(html,'description')||_metaValue(html,'og:description');
  if(!description){
    var notes=html.match(/<(?:main|article|section)\b[^>]*(?:programme-notes|synopsis|description|overview)[^>]*>([\s\S]*?)<\/(?:main|article|section)>/i);
    if(notes)description=_text(notes[1]);
  }
  var cover=_metaValue(html,'og:image')||_metaValue(html,'twitter:image');
  if(!cover){var imgs=html.match(/<(?:img|source)\b[^>]*>/gi)||[];for(var i=0;i<imgs.length;i++){cover=_attr(imgs[i],'src')||_attr(imgs[i],'data-src')||_attr(imgs[i],'data-lazy-src');if(cover)break;}}
  cover=cover?_abs(cover,url):null;
  var year=_metaValue(html,'releaseYear')||_metaValue(html,'datePublished');
  if(year){var ym=String(year).match(/(19|20)\d{2}/);year=ym?Number(ym[0]):null;}else{var yy=html.match(/\bYEAR\s*<[^>]*>\s*(\d{4})/i);year=yy?Number(yy[1]):null;}
  var episodes=_episodeItems(html,url);
  var episodeCount=_count(html,'Episodes');
  var seasons=_count(html,'Seasons');
  var genres=[],genreLinks=html.match(/<a\b[^>]*href=["'][^"']*\/genre\/[^"']+["'][^>]*>[\s\S]*?<\/a>/gi)||[];
  for(var g=0;g<genreLinks.length;g++){var genre=_text(genreLinks[g]);if(genre&&!genres.includes(genre))genres.push(genre);}
  var studioMatch=html.match(/STUDIO\s*<[^>]*>\s*([^<]+)/i),studio=studioMatch?_trim(_decode(studioMatch[1])):'';
  var audio=_metaValue(html,'audio')||'';
  return {id:url,title:title||url.split('/').filter(Boolean).pop().replace(/-/g,' '),url:url,cover:cover,description:description||'',year:year,status:'unknown',genres:genres,studios:studio?[studio]:[],type:/\/film\//i.test(url)?'movie':'anime',sourceId:SOURCE_ID,episodes:episodes,episodeCount:episodeCount,seasons:seasons,audio:audio,subCount:episodes.length,dubCount:0};
}
function getDetail(url,opts) {
  var page=_seriesUrl(url);if(!page)return Promise.reject(new Error('Uniquestream: invalid or non-public series URL'));
  return _request(page).then(function(html){return _metadata(html,page);});
}
function getEpisodes(url,opts) { return getDetail(url,opts).then(function(d){return d.episodes||[];}); }
function _episodePage(epUrl) {
  var raw=String(epUrl||'');if(raw.indexOf('uniquestream://episode/')!==0)throw new Error('Uniquestream: invalid episode URL');
  var encoded=raw.slice('uniquestream://episode/'.length),page;
  try{page=decodeURIComponent(encoded);}catch(e){throw new Error('Uniquestream: malformed episode URL');}
  var safe=_siteUrl(page,SITE+'/');
  if(!safe||!/^\/watch\/[A-Za-z0-9_-]+(?:\/|$)/i.test(new URL(safe).pathname))throw new Error('Uniquestream: invalid watch page URL');
  return safe;
}
function _mediaCandidates(html,page) {
  var out=[],seen={};
  function add(raw,label) {
    var u=_abs(raw,page);if(!u||seen[u])return;
    try{var p=new URL(u);if(p.protocol!=='https:'||!/\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(p.href))return;}catch(e){return;}
    seen[u]=true;out.push({url:u,quality:'Auto',label:label||'Uniquestream',container:/\.m3u8/i.test(u)?'hls':(/\.mpd/i.test(u)?'dash':'mp4'),headers:{'User-Agent':UA,'Referer':page,'Origin':SITE},kind:'sub',audioLang:'ja'});
  }
  var tags=String(html||'').match(/<(?:video|source|iframe|a)\b[^>]*>/gi)||[];
  for(var i=0;i<tags.length;i++){var tag=tags[i];add(_attr(tag,'src')||_attr(tag,'data-src')||_attr(tag,'data-hls')||_attr(tag,'href'),'Uniquestream page media');}
  var scripts=String(html||'').match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)||[];
  for(var j=0;j<scripts.length;j++){
    var content=scripts[j].replace(/^<script\b[^>]*>/i,'').replace(/<\/script>\s*$/i,'');
    var re=/(https?:\\?\/\\?\/[^"'\s<>]+?\.(?:m3u8|mp4|mpd)(?:\?[^"'\s<>]*)?)/gi,m;
    while((m=re.exec(content))!==null)add(m[1].replace(/\\\//g,'/'),'Uniquestream embedded public media');
    try{
      var data=JSON.parse(content),stack=[data];
      while(stack.length){var v=stack.pop();if(!v)continue;if(Array.isArray(v)){for(var a=0;a<v.length;a++)stack.push(v[a]);}else if(typeof v==='object'){add(v.contentUrl||v.file||v.src||v.videoUrl||v.streamUrl,'Uniquestream structured media');for(var key in v)if(Object.prototype.hasOwnProperty.call(v,key)&&v[key]&&typeof v[key]==='object')stack.push(v[key]);}}
    }catch(e){}
  }
  return out;
}
function getVideoSources(episodeUrl,opts) {
  var page;try{page=_episodePage(episodeUrl);}catch(e){return Promise.reject(e);}
  return _request(page,page).then(function(html){
    var streams=_mediaCandidates(html,page);
    if(!streams.length)throw new Error('Uniquestream: watch page did not expose a direct HTTPS media URL; playback cannot be resolved from public page markup');
    return streams;
  });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=='undefined'&&module.exports)module.exports={version:VERSION,getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks};
