/* Zangetsu source — Uniquestream. Publicly exposed page data only. */
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'uniquestream';
var SITE = 'https://anime.uniquestream.net';
var MEDIA = 'https://media.uniquestream.net';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
var VERSION = '0.7.0';
var LOCAL_PROXY = 'http://127.0.0.1:8787';

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
  var s=_trim(_decode(raw));
  if(!s||/^(?:javascript|data|mailto):/i.test(s))return '';
  if(/^https?:\/\//i.test(s))return s;
  if(/^\/\//.test(s))return 'https:'+s;
  // Zangetsu's QuickJS bootstrap supplies absUrl(), but not every JS runtime
  // has the browser URL constructor. Prefer the host helper and keep a local
  // string-only fallback so API result mapping works in both QuickJS and Node.
  if(typeof absUrl==='function') {
    try { var resolved=absUrl(s,base||SITE+'/'); if(resolved)return String(resolved); } catch(e) {}
  }
  var b=String(base||SITE+'/').replace(/[?#].*$/,'');
  var origin=(b.match(/^(https?:\/\/[^\/?#]+)/i)||[])[1];
  if(!origin)return '';
  if(s.charAt(0)==='/')return origin+s;
  return b.replace(/\/+$/,'')+'/'+s.replace(/^\/+/,'');
}
function _urlParts(raw) {
  var m=String(raw||'').match(/^(https?):\/\/([^\/?#]+)([^?#]*)/i);
  if(!m)return null;
  return {protocol:m[1].toLowerCase()+':',host:m[2].toLowerCase().replace(/:\d+$/,''),pathname:m[3]||'/'};
}
function _pathname(raw) {
  var parts=_urlParts(raw);
  return parts?parts.pathname:'';
}
function _siteUrl(raw,base) {
  var u=_abs(raw,base); if(!u)return '';
  var p=_urlParts(u); if(!p)return '';
  return (p.protocol==='https:'||p.protocol==='http:')&&
    (p.host==='anime.uniquestream.net'||p.host==='media.uniquestream.net')?u:'';
}
function _request(url,referer,accept) {
  return Promise.resolve().then(function(){return fetch(url,{headers:{'User-Agent':UA,'Accept':accept||'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Referer':referer||SITE+'/'},timeoutMs:15000});})
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
  return _request(url,SITE+'/','application/json, text/plain, */*').then(function(body) {
    try { return JSON.parse(String(body).replace(/^\\uFEFF/,'')); }
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
  var path=type==='movie'?('/movie/'+encodeURIComponent(id)):('/series/'+encodeURIComponent(id)+'/'+_slug(title));
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
  // Match the official Aniyomi request contract exactly. The API documents
  // "query", not "q"; a concurrent q fallback only adds load and can race
  // through the single shared QuickJS fetch bridge.
  var apiUrl=SITE+'/api/v1/search?page='+p+'&query='+enc+'&t=all&limit=20';
  return _fetchApiCards([apiUrl]).then(function(items) {
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
  // Match the public Aniyomi API calls and retry Latest only if Popular is empty.
  var popularUrl=SITE+'/api/v1/videos/popular?page=1&limit=20&type=all';
  var latestUrl=SITE+'/api/v1/videos/new?page=1&limit=20&type=all';
  return _fetchApiCards([popularUrl]).then(function(items) {
    if(items.length)return items.slice(0,30);
    return _fetchApiCards([latestUrl]).then(function(latest) {
      if(latest.length)return latest.slice(0,30);
      return _fetchCardPages([SITE+'/videos/popular/',SITE+'/videos/new/']).then(function(htmlItems) {
        if(htmlItems.length)return htmlItems.slice(0,30);
        return _fetchCardPages([SITE+'/videos/alphabetical/',SITE+'/']).then(function(fallback) {
          return fallback.slice(0,30);
        });
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
  return /^\/(?:series|movie|film|title|content)\//i.test(_pathname(u))?u:'';
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
  return {id:url,title:title||url.split('/').filter(Boolean).pop().replace(/-/g,' '),url:url,cover:cover,description:description||'',year:year,status:'unknown',genres:genres,studios:studio?[studio]:[],type:/\/(?:film|content)\//i.test(url)?'movie':'anime',sourceId:SOURCE_ID,episodes:episodes,episodeCount:episodeCount,seasons:seasons,audio:audio,subCount:episodes.length,dubCount:0};
}
function _apiArray(payload) {
  var data=payload&&payload.data!=null?payload.data:payload;
  if(Array.isArray(data))return data;
  if(data&&typeof data==='object') {
    var keys=['episodes','items','results','data'];
    for(var i=0;i<keys.length;i++)if(Array.isArray(data[keys[i]]))return data[keys[i]];
  }
  return [];
}
function _apiSeasonEpisodes(seasons) {
  if(!Array.isArray(seasons)||!seasons.length)return Promise.resolve([]);
  return Promise.all(seasons.map(function(season,seasonIndex) {
    var seasonId=String(season&&season.content_id||'');
    if(!seasonId)return Promise.resolve([]);
    var collected=[];
    function fetchPage(page) {
      if(page>10)return Promise.resolve(collected);
      var url=SITE+'/api/v1/season/'+encodeURIComponent(seasonId)+'/episodes?page='+page+'&limit=20';
      return _json(url).then(function(payload) {
        var batch=_apiArray(payload);
        for(var i=0;i<batch.length;i++)if(batch[i]&&batch[i].content_id)collected.push(batch[i]);
        if(batch.length>=20)return fetchPage(page+1);
        return collected;
      }).catch(function(){return collected;});
    }
    return fetchPage(1).then(function(items) {
      return items.map(function(item,index) {
        var episodeId=String(item.content_id||''),title=_trim(item.title||'');
        var epNumber=Number(item.episode_number||item.episode||index+1);
        var locales=Array.isArray(item.audio_locales)?item.audio_locales:[];
        var locale=locales[0]||'ja-JP';
        var media=SITE+'/api/v1/episode/'+encodeURIComponent(episodeId)+'/media/hls/'+encodeURIComponent(locale);
        return {
          id:'uniquestream://episode/'+encodeURIComponent(media),
          number:isFinite(epNumber)&&epNumber>0?epNumber:index+1,
          title:title||('Episode '+(index+1)),
          url:'uniquestream://episode/'+encodeURIComponent(media),
          sourceId:SOURCE_ID,type:'anime',
          _seasonOrder:seasonIndex,_episodeOrder:index
        };
      });
    });
  })).then(function(groups) {
    var all=[];
    for(var i=0;i<groups.length;i++)for(var j=0;j<groups[i].length;j++)all.push(groups[i][j]);
    all.sort(function(a,b){return a._seasonOrder-b._seasonOrder||a._episodeOrder-b._episodeOrder;});
    for(var k=0;k<all.length;k++){delete all[k]._seasonOrder;delete all[k]._episodeOrder;}
    return all;
  });
}
function _apiMetadata(payload,page,isMovie) {
  var data=payload&&payload.data&&typeof payload.data==='object'?payload.data:
    (payload&&payload.result&&typeof payload.result==='object'?payload.result:payload);
  if(!data||typeof data!=='object'||!_trim(data.title||''))throw new Error('Uniquestream: API detail payload has no title');
  var seasons=Array.isArray(data.seasons)?data.seasons:[];
  var images=Array.isArray(data.images)?data.images:[];
  var cover='';
  for(var i=0;i<images.length;i++)if(images[i]&&images[i].type==='poster_tall'&&images[i].url){cover=images[i].url;break;}
  if(!cover)for(var j=0;j<images.length;j++)if(images[j]&&images[j].url){cover=images[j].url;break;}
  cover=cover||data.image||data.poster||'';
  var genres=data.genre||data.genres||[];
  if(!Array.isArray(genres))genres=[];
  genres=genres.map(function(g){return typeof g==='string'?g:(g&&(_trim(g.name||g.title||'')));}).filter(Boolean);
  var summary=String(data.description||data.synopsis||'');
  var seasonCount=seasons.length||Number(data.seasons_count||data.season_count||0)||null;
  var count=Number(data.episodes_count||data.episode_count||0);
  if(!count&&seasons.length)for(var s=0;s<seasons.length;s++)count+=Number(seasons[s].episode_count||seasons[s].episodes_count||0);
  return (isMovie?Promise.resolve([]):_apiSeasonEpisodes(seasons)).then(function(episodes) {
    var audio=data.audio_locales||data.audio||[];
    if(Array.isArray(audio))audio=audio.join(', ');
    return {
      id:page,title:_trim(data.title),url:page,cover:cover?_abs(cover,page):null,
      description:summary,year:Number(data.year||data.release_year||0)||null,
      status:data.status||'unknown',genres:genres,
      studios:data.studio?[String(data.studio)]:[],
      type:isMovie?'movie':'anime',sourceId:SOURCE_ID,episodes:episodes,
      episodeCount:count||episodes.length||null,
      seasons:seasonCount,audio:String(audio||''),subCount:episodes.length,dubCount:0
    };
  });
}
function getDetail(url,opts) {
  var page=_seriesUrl(url);
  if(!page)return Promise.reject(new Error('Uniquestream: invalid or non-public series URL'));
  var path=_pathname(page);
  var movie=/^\/(?:movie|content|film)\//i.test(path);
  var match=path.match(/^\/(?:series|movie|film|title|content)\/([^/]+)/i);
  var contentId=match?decodeURIComponent(match[1]):'';
  if(!contentId)return _request(page).then(function(html){return _metadata(html,page);});
  var endpoint=SITE+'/api/v1/'+(movie?'movie':'series')+'/'+encodeURIComponent(contentId);
  return _json(endpoint)
    .then(function(payload){return _apiMetadata(payload,page,movie);})
    .catch(function(){return _request(page).then(function(html){return _metadata(html,page);});});
}
function getEpisodes(url,opts) { return getDetail(url,opts).then(function(d){return d.episodes||[];}); }
function _episodePage(epUrl) {
  var raw=String(epUrl||'');if(raw.indexOf('uniquestream://episode/')!==0)throw new Error('Uniquestream: invalid episode URL');
  var encoded=raw.slice('uniquestream://episode/'.length),page;
  try{page=decodeURIComponent(encoded);}catch(e){throw new Error('Uniquestream: malformed episode URL');}
  var safe=_siteUrl(page,SITE+'/'),path=_pathname(safe);
  var watch=/^\/watch\/[A-Za-z0-9_-]+(?:\/|$)/i.test(path);
  var apiMedia=/^\/api\/v1\/episode\/[A-Za-z0-9_-]+\/media\/hls\/[A-Za-z0-9-]+\/?$/i.test(path);
  if(!safe||(!watch&&!apiMedia))throw new Error('Uniquestream: invalid public episode or media URL');
  return safe;
}
function _apiMediaSources(payload,page) {
  var data=payload&&payload.data&&typeof payload.data==='object'?payload.data:
    (payload&&payload.result&&typeof payload.result==='object'?payload.result:payload);
  if(!data||typeof data!=='object')throw new Error('Uniquestream: media API returned no media data');
  var mediaId=String(data.media_id||data.mediaId||'');
  if(!mediaId)throw new Error('Uniquestream: media API omitted media_id');
  var out=[],seen={};
  function subtitlesFor(entry) {
    var list=entry&&Array.isArray(entry.subtitles)?entry.subtitles:[];
    return list.map(function(track) {
      if(!track||typeof track!=='object')return null;
      var raw=String(track.url||track.file||'');
      var url=_abs(raw,page);
      if(!url||!/^https:\/\//i.test(url))return null;
      var lang=String(track.language||track.locale||track.lang||track.label||'und');
      return {url:url,lang:lang,label:String(track.label||track.language||track.locale||'Subtitle'),
        format:/\.srt(?:$|[?#])/i.test(url)?'srt':(/\.ass(?:$|[?#])/i.test(url)?'ass':'vtt'),
        default:!!(track.default||track.is_default)};
    }).filter(function(track){return !!track;});
  }
  function add(entry,label,locale,kind) {
    if(!entry||typeof entry!=='object')return;
    var raw=String(entry.playlist||entry.url||'');
    // The official DTO defines these as HLS playlists. Some CDN URLs are signed
    // opaque paths without a .m3u8 suffix, so extension-based filtering dropped
    // valid dub/hard-sub hosters and produced only a single result in Zangetsu.
    var url=_abs(raw,page);
    if(!url||!/^https:\/\//i.test(url))return;
    var key=url;
    if(seen[key])return;
    seen[key]=true;
    var headers={'User-Agent':UA,'Referer':SITE+'/','Origin':SITE,'x-am-media-id':mediaId};
    out.push({url:url,quality:'Auto',label:label,container:'hls',headers:headers,
      kind:kind||'sub',audioLang:locale||'ja',subtitles:subtitlesFor(entry)});
  }
  var hls=data.hls||{};
  if(Array.isArray(hls)) {
    for(var a=0;a<hls.length;a++)add(hls[a],'Uniquestream ('+(hls[a].locale||'unknown')+')',hls[a].locale,'raw');
  } else {
    add(hls,(hls.locale||'Raw')+' (Raw)',hls.locale,'raw');
    var hard=Array.isArray(hls.hard_subs)?hls.hard_subs:(Array.isArray(hls.hardSubs)?hls.hardSubs:[]);
    for(var i=0;i<hard.length;i++)add(hard[i],(hard[i].locale||'unknown')+' Hard Sub',hard[i].locale,'sub');
  }
  var versions=data.versions&&Array.isArray(data.versions.hls)?data.versions.hls:[];
  for(var j=0;j<versions.length;j++){
    var v=versions[j]||[];
    add(v,(v.locale||'unknown')+' (Dub)',v.locale,'dub');
    var subs=Array.isArray(v.hard_subs)?v.hard_subs:(Array.isArray(v.hardSubs)?v.hardSubs:[]);
    for(var k=0;k<subs.length;k++)add(subs[k],(v.locale||'unknown')+' Dub ('+(subs[k].locale||'unknown')+' Sub)',v.locale,'dub');
  }
  if(!out.length)throw new Error('Uniquestream: media API returned no HTTPS HLS playlist');
  return out;
}
function _localProxyAvailable() {
  return Promise.resolve().then(function() {
    return fetch(LOCAL_PROXY+'/health',{headers:{'Accept':'text/plain'},timeoutMs:1200});
  }).then(function(r) {
    if(!r||Number(r.status||0)!==200)return false;
    var body=typeof r.body==='string'?r.body:(typeof r.text==='function'?r.text():'');
    return Promise.resolve(body).then(function(s){return String(s||'').indexOf('uniquestream-proxy-ok')>=0;});
  }).catch(function(){return false;});
}
function _useLocalProxy(streams) {
  return _localProxyAvailable().then(function(available) {
    if(!available)return streams;
    return streams.map(function(stream) {
      if(stream.container!=='hls')return stream;
      var mediaId=String(stream.headers&&stream.headers['x-am-media-id']||'');
      if(!mediaId)return stream;
      var url=LOCAL_PROXY+'/playlist.m3u8?url='+encodeURIComponent(stream.url)+'&mid='+encodeURIComponent(mediaId);
      return Object.assign({},stream,{url:url,headers:{'User-Agent':UA},
        label:(stream.label||'Uniquestream')+' · Local HLS proxy'});
    });
  });
}
function _mediaCandidates(html,page) {
  var out=[],seen={};
  function add(raw,label) {
    var u=_abs(raw,page);if(!u||seen[u])return;
    if(!/^https:\/\//i.test(u)||!/\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(u))return;
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
  if(/^\/api\/v1\/episode\//i.test(_pathname(page))) {
    return _json(page).then(function(payload){return _apiMediaSources(payload,page);}).then(_useLocalProxy);
  }
  return _request(page,page).then(function(html){
    var streams=_mediaCandidates(html,page);
    if(!streams.length)throw new Error('Uniquestream: watch page did not expose a direct HTTPS media URL; playback cannot be resolved from public page markup');
    return streams;
  });
}
function getStreams(id,opts){return getVideoSources(id,opts);}
function getLinks(id,opts){return getVideoSources(id,opts);}
if(typeof module!=='undefined'&&module.exports)module.exports={version:VERSION,getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks};
