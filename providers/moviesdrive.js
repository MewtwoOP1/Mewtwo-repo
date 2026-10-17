// MoviesDrive standalone provider for Zangetsu.
// Uses MoviesDrive's title/IMDb search API and resolves its HubCloud/GDFlix links.
// It does not depend on Stremio or third-party scraping workers.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'moviesdrive';
var DOMAINS_URL = 'https://raw.githubusercontent.com/phisher98/TVVVV/refs/heads/main/domains.json';
var FALLBACK = 'https://new4.moviesdrive.christmas';
var TMDB = 'https://api.themoviedb.org/3';
var POSTER = 'https://image.tmdb.org/t/p/w500';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var _main = null;
function getInfo() { return { name:'MoviesDrive', lang:'en', baseUrl:FALLBACK, logo:'https://www.google.com/s2/favicons?sz=256&domain=moviesdrive.christmas', type:'movie', version:'1.0.0' }; }
function getSettings() { return []; }
function trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function decode(s) { return String(s || '').replace(/&amp;/g,'&').replace(/&#038;/g,'&').replace(/&#8217;/g,"'").replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' '); }
function text(s) { return trim(decode(String(s || '').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ')); }
function abs(u, b) { try { return new URL(u, b).toString(); } catch(e) { return u; } }
function body(r) { return r && r.body != null ? r.body : ''; }
function request(url, opts) { return fetch(url, Object.assign({ headers:{'User-Agent':UA,'Accept':'*/*'}, timeoutMs:15000 }, opts || {})).then(function(r) { if (r && r.status >= 400) throw new Error('HTTP '+r.status); return r; }); }
function html(url, referer) { return request(url,{headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml','Referer':referer || url}}).then(function(r){return String(body(r)||'');}); }
function json(url, referer) { return request(url,{headers:{'User-Agent':UA,'Accept':'application/json','Referer':referer || url}}).then(function(r){try{return JSON.parse(body(r)||'null');}catch(e){return null;}}); }
function domain() {
  if (_main) return Promise.resolve(_main);
  return json(DOMAINS_URL).then(function(j) { _main = trim(j && (j.moviesdrive || j.MoviesDrive)) || FALLBACK; _main = _main.replace(/\/$/,''); return _main; })
    .catch(function(){ _main = FALLBACK; return _main; });
}
function yearFrom(s) { var m = String(s||'').match(/\b(19|20)\d{2}\b/); return m ? Number(m[0]) : null; }
function item(title, url, poster, year) {
  return { id:url, title:trim(title) || 'Untitled', cover:poster ? abs(poster, _main || FALLBACK) : null, url:url, type:'movie', sourceId:SOURCE_ID, year:year || yearFrom(title) };
}
function anchors(h, base) {
  var out=[], re=/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
  while ((m=re.exec(h||'')) !== null) out.push({url:abs(decode(m[1]),base), title:text(m[2])});
  return out;
}
function cards(h, base) {
  var out=[], seen={};
  anchors(h,base).forEach(function(a) {
    if (!/moviesdrive/i.test(a.url) || /\/(category|tag|page|search)\//i.test(a.url) || /\/(wp-content|wp-json)\//i.test(a.url)) return;
    var title=a.title;
    if (!title || title.length < 2 || /^(home|download|watch now|read more|next|previous)$/i.test(title)) return;
    if (!seen[a.url]) { seen[a.url]=1; out.push(item(title,a.url,null,yearFrom(title))); }
  });
  return out;
}
function getHome() {
  return domain().then(function(d) { return html(d+'/').then(function(h) {
    var list=cards(h,d);
    return [{title:'Latest on MoviesDrive',items:list.slice(0,30)}].filter(function(r){return r.items.length;});
  }).catch(function(){return [];}); }).catch(function(){return [];});
}
function search(query, page) {
  var q=trim(query); if(!q) return Promise.resolve([]);
  return domain().then(function(d) {
    return json(d+'/search.php?q='+encodeURIComponent(q)+'&page='+Math.max(1,parseInt(page,10)||1),d+'/').then(function(j) {
      var hits=j && Array.isArray(j.hits) ? j.hits : [];
      return hits.map(function(hit) {
        var x=hit && (hit.document || hit) || {};
        var url=x.permalink ? (/^https?:\/\//i.test(x.permalink) ? x.permalink : abs(x.permalink,d)) : '';
        if(!url) return null;
        return item(x.post_title || x.title,url,x.post_thumbnail || x.poster || null,yearFrom(x.post_title || x.title));
      }).filter(Boolean);
    });
  }).catch(function(){return [];});
}
function tmdb(path) { return json(TMDB+path); }
function parseLinkList(url) { try { var s=String(url||''); if(s.indexOf('mdrive://')===0) return JSON.parse(decodeURIComponent(s.slice(9))); if(s.charAt(0)==='[') return JSON.parse(s); } catch(e){} return []; }
function episodeUrl(urls) { return 'mdrive://'+encodeURIComponent(JSON.stringify(urls)); }
function getDetail(url) {
  var target=String(url||'');
  if(!/^https?:\/\//i.test(target)) return Promise.resolve(null);
  return domain().then(function(d) {
    return html(target,d+'/').then(function(h) {
      var titleMatch=h.match(/<h1[^>]*class=["'][^"']*post-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
        h.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ||
        h.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      var title=text(titleMatch && titleMatch[1]) || 'MoviesDrive';
      var posterMatch=h.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
      var descMatch=h.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
      var all=anchors(h,target), pages=[], seen={};
      all.forEach(function(a) {
        if (/hubcloud|gdflix|gdlink/i.test(a.url) || /search-recover\.php/i.test(a.url)) { if(!seen[a.url]){seen[a.url]=1;pages.push(a.url);} }
      });
      // MoviesDrive often places links behind a "download page" which contains the host links.
      if(!pages.length) {
        all.forEach(function(a) { if (/\/download\/|\/watch\//i.test(a.url) && !seen[a.url]) {seen[a.url]=1;pages.push(a.url);} });
      }
      var episodes=pages.length ? [{id:'movie',title:title,number:1,url:episodeUrl(pages)}] : [];
      var base={id:target,title:title,cover:posterMatch?abs(decode(posterMatch[1]),target):null,url:target,description:descMatch?text(descMatch[1]):'',genres:[],type:'movie',sourceId:SOURCE_ID,episodes:episodes,subCount:episodes.length,dubCount:0};
      return tmdb('/search/multi?query='+encodeURIComponent(title.replace(/\s*\(.*?\)\s*/g,' ').trim())).then(function(j) {
        var results=j && j.results || [], match=null, want=title.toLowerCase();
        for(var i=0;i<results.length;i++){var x=results[i],t=String(x.title||x.name||'').toLowerCase(); if(t===want){match=x;break;}}
        if(!match && results.length) match=results[0];
        if(match){base.tmdbId=Number(match.id);base.tmdbIsTv=match.media_type==='tv';if(match.poster_path)base.cover=POSTER+match.poster_path;}
        return base;
      }).catch(function(){return base;});
    });
  }).catch(function(){return null;});
}
function getEpisodes(url) { return getDetail(url).then(function(d){return d && d.episodes || [];}); }
function _stream(url, label, headers) {
  if(!/^https?:\/\//i.test(url)) return null;
  if (/pixeldrain\.(?:com|dev)\/(?:u|file)\//i.test(url)) {
    var m=url.match(/\/(?:u|file)\/([A-Za-z0-9_-]+)/); if(m) url='https://pixeldrain.dev/api/file/'+m[1]+'?download';
  }
  if(!/\.(?:m3u8|mp4|m4v|webm)(?:[?#]|$)/i.test(url) && !/\/api\/file\//i.test(url)) return null;
  var qm=String(label||url).match(/(2160|1440|1080|720|480)p?/i);
  return {url:url,quality:qm?qm[1]+'p':'Auto',label:'MoviesDrive · '+(label||'Direct'),name:'MoviesDrive',source:'MoviesDrive',container:/\.m3u8(?:[?#]|$)/i.test(url)?'hls':'mp4',headers:headers||{'User-Agent':UA},kind:'raw',audioLang:'',subtitles:[]};
}
function resolveHubCloud(url, referer) {
  return html(url,referer).then(function(h) {
    var pageUrl=url, m=h.match(/<a\b[^>]*href=["']([^"']*hubcloud\.php[^"']*)["']/i)||h.match(/<a\b[^>]*id=["']download["'][^>]*href=["']([^"']+)["']/i);
    if(m) { var next=abs(decode(m[1]),url); if(next!==url) return resolveHubCloud(next,url); }
    var head=text((h.match(/<div[^>]*class=["'][^"']*card-header[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)||[])[1]||'');
    var links=anchors(h,url), out=[], jobs=[];
    links.forEach(function(a) {
      var lower=(a.title+' '+a.url).toLowerCase();
      if(/telegram|tinyurl|join/i.test(lower)) return;
      if(/pixeldrain/i.test(lower)){var s=_stream(a.url,head||a.title,{'User-Agent':UA,'Referer':url});if(s)out.push(s);return;}
      if(/fsl|s3 server|instant download|download file|10gbps/i.test(lower)) {
        var direct=a.url;
        if(/link=/.test(direct)){direct=decodeURIComponent(direct.split('link=').pop());}
        var stream=_stream(direct,head+' '+a.title,{'User-Agent':UA,'Referer':url});
        if(stream)out.push(stream);
      }
      if(/\.(?:m3u8|mp4|m4v|webm)(?:[?#]|$)/i.test(a.url)){var d=_stream(a.url,head||a.title,{'User-Agent':UA,'Referer':url});if(d)out.push(d);}
    });
    return out;
  }).catch(function(){return [];});
}
function resolveDownloadPage(url, referer) {
  return html(url,referer).then(function(h) {
    var links=anchors(h,url), hosts=links.map(function(a){return a.url;}).filter(function(u){return /hubcloud|gdflix|gdlink/i.test(u);});
    if(!hosts.length) return [];
    return Promise.all(hosts.slice(0,8).map(function(host) {
      if(/hubcloud/i.test(host)) return resolveHubCloud(host,url);
      return html(host,url).then(function(page) {
        var a=anchors(page,host).filter(function(x){return /hubcloud/i.test(x.url);});
        return Promise.all(a.slice(0,5).map(function(x){return resolveHubCloud(x.url,host);})).then(function(rows){return rows.reduce(function(o,r){return o.concat(r);},[]);});
      }).catch(function(){return [];});
    })).then(function(rows){return rows.reduce(function(o,r){return o.concat(r);},[]);});
  }).catch(function(){return [];});
}
function getVideoSources(episodeUrl) {
  var urls=parseLinkList(episodeUrl);
  if(!urls.length && /^https?:\/\//i.test(String(episodeUrl||''))) urls=[String(episodeUrl)];
  if(!urls.length) return Promise.resolve([]);
  return Promise.all(urls.slice(0,12).map(function(url) {
    if(/hubcloud/i.test(url)) return resolveHubCloud(url,url);
    if(/gdflix|gdlink|search-recover\.php/i.test(url)) return resolveDownloadPage(url,url);
    return resolveDownloadPage(url,url);
  })).then(function(rows) {
    var out=[],seen={};
    rows.forEach(function(list){(list||[]).forEach(function(s){if(s&&s.url&&!seen[s.url]){seen[s.url]=1;out.push(s);}});});
    return out;
  }).catch(function(){return [];});
}
function getStreams(url,opts) { return getVideoSources(url,opts); }
function getLinks(url,opts) { return getVideoSources(url,opts); }
if(typeof module!=='undefined'&&module.exports) module.exports={version:'1.0.0',getInfo:getInfo,getSettings:getSettings,getHome:getHome,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,getLinks:getLinks};
