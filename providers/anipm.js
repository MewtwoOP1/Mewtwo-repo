// Ani.pm source for Zangetsu.
// Uses Ani.pm's public partner API and embed session flow.
var SITE = 'https://ani.pm';
var EMBED = 'https://embed.settlar.io';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'anipm';
var VERSION = '1.0.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'Ani.pm', lang: 'en', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=ani.pm', type: 'anime', version: VERSION };
}
function getSettings() {
  return [{ key:'language', label:'Preferred audio', description:'Prefer sub or dub when both are available.', type:'enum', default:'sub', options:[{value:'sub',label:'Sub first'},{value:'dub',label:'Dub first'}] }];
}
function _settings() {
  var s = (typeof __settings !== 'undefined' && __settings && __settings[SOURCE_ID]) || {};
  return { language: s.language === 'dub' ? 'dub' : 'sub' };
}
function _trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
function _json(url, referer, attempt) {
  attempt = attempt || 0;
  return fetch(url, { headers:{'User-Agent':UA,'Accept':'application/json, text/plain, */*','Referer':referer || SITE + '/','Origin':SITE}, timeoutMs:15000 })
    .then(function(r) {
      if (r && r.status >= 400) { var e = new Error('Ani.pm HTTP ' + r.status); e.status = r.status; throw e; }
      var body = r && r.body != null ? r.body : '';
      if (typeof body !== 'string') body = JSON.stringify(body);
      return JSON.parse(body || '{}');
    }).catch(function(e) {
      var s = Number(e && e.status), retry = !s || s === 408 || s === 429 || s >= 500;
      if (!retry || attempt >= 2) throw e;
      return new Promise(function(resolve){ setTimeout(resolve, attempt === 0 ? 300 : 900); }).then(function(){ return _json(url, referer, attempt + 1); });
    });
}
function _text(url, referer) {
  return fetch(url, {headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*','Referer':referer || SITE + '/','Origin':SITE},timeoutMs:15000})
    .then(function(r) {
      if (r && r.status >= 400) throw new Error('Ani.pm HTTP ' + r.status);
      var body = r && r.body != null ? r.body : '';
      return typeof body === 'string' ? body : JSON.stringify(body);
    });
}
function _list(data) {
  var v = data;
  for (var i=0; i<4 && v && !Array.isArray(v); i++) {
    if (Array.isArray(v.data)) v = v.data;
    else if (Array.isArray(v.results)) v = v.results;
    else if (Array.isArray(v.items)) v = v.items;
    else break;
  }
  return Array.isArray(v) ? v : [];
}
function _id(item) { var n = item && (item.anilistId || item.anilist || item.id); return n == null ? '' : String(n); }
function _title(item) {
  var t = item && (item.title || item.name);
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') return t.english || t.romaji || t.native || '';
  return '';
}
function _cover(item) { return item && (item.cover || item.poster || item.image || item.imageUrl || item.coverImage) || ''; }
function _card(item) {
  var id = _id(item), title = _title(item);
  if (!id || !title) return null;
  return {id:id,title:title,url:id,cover:_cover(item)||null,type:'anime',sourceId:SOURCE_ID,
    anilistId:Number(item.anilistId || item.anilist || id) || null,
    malId:Number(item.malId || item.mal || item.mal_id) || null};
}
function _cards(items) {
  var out=[], seen={};
  _list(items).forEach(function(x){var c=_card(x);if(c&&!seen[c.id]){seen[c.id]=true;out.push(c);}});
  return out;
}
function getHome() {
  return _json(SITE + '/api/partner/v1/titles?q=one%20piece').then(function(d){return [{title:'Ani.pm',items:_cards(d)}];})
    .catch(function(){return [];});
}
function popular(opts) { return getHome().then(function(rows){return rows.length ? rows[0].items : [];}); }
function search(query, page, opts) {
  var media = opts && opts.media;
  if (media && media.id) {
    return _json(SITE + '/api/partner/v1/lookup?anilist=' + encodeURIComponent(media.id)).then(function(d){
      var item = _list(d)[0] || (d && d.data && d.data[0]);
      if (item && item.available) return [_card({anilistId:item.anilistId || media.id,title:item.title || query,cover:item.cover || item.poster,malId:item.malId})].filter(Boolean);
      return _titleSearch(query || media.romajiTitle || media.englishTitle);
    }).catch(function(){return _titleSearch(query || media.romajiTitle || media.englishTitle);});
  }
  return _titleSearch(query);
}
function _titleSearch(query) {
  var q = _trim(query);
  if (q.length < 2) return Promise.resolve([]);
  return _json(SITE + '/api/partner/v1/titles?q=' + encodeURIComponent(q)).then(function(d){return _cards(d);}).catch(function(){return [];});
}
function _extractId(value) {
  var s=String(value == null ? '' : value);
  var m=s.match(/(?:anilist=|\/ani\/|\/series\/)?(\d+)(?:[/?#]|$)/i);
  return m ? m[1] : (/^\d+$/.test(s) ? s : '');
}
function _episodes(id) {
  return _json(SITE + '/api/partner/v1/series/' + encodeURIComponent(id)).then(function(d){
    var data = d && d.data || d;
    var rows = data && (data.episodeList || data.episodes) || [];
    if (!Array.isArray(rows)) return [];
    return rows.map(function(ep){
      var n=Number(ep.number || ep.episode || ep.ep);
      if (!isFinite(n) || n < 1) return null;
      return {id:id+'||'+n,number:n,title:ep.title || ('Episode '+n),url:id+'||'+n,sourceId:SOURCE_ID};
    }).filter(Boolean);
  }).catch(function(){return [];});
}
function getDetail(url) {
  var id=_extractId(url);
  if (!/^\d+$/.test(id)) return Promise.resolve(null);
  return Promise.all([
    _json(SITE + '/api/partner/v1/series/' + encodeURIComponent(id)).catch(function(){return null;}),
    _json(SITE + '/api/partner/v1/lookup?anilist=' + encodeURIComponent(id)).catch(function(){return null;})
  ]).then(function(r){
    var d=r[0] && (r[0].data || r[0]) || {};
    var lookup=_list(r[1])[0] || {};
    var eps=Array.isArray(d.episodeList) ? d.episodeList : (Array.isArray(d.episodes) ? d.episodes : []);
    var title=d.title || d.name || lookup.title || ('Anime '+id);
    return {id:id,title:title,url:id,cover:d.cover || d.poster || lookup.cover || null,
      description:d.description || d.synopsis || '',status:d.status || 'unknown',genres:d.genres || [],
      studios:[],type:'anime',sourceId:SOURCE_ID,year:d.year || null,
      malId:Number(d.malId || lookup.malId) || null,anilistId:Number(d.anilistId || id) || null,
      episodes:eps.map(function(ep){var n=Number(ep.number || ep.episode || ep.ep);return n>0?{id:id+'||'+n,number:n,title:ep.title||('Episode '+n),url:id+'||'+n,sourceId:SOURCE_ID}:null;}).filter(Boolean),
      subCount:eps.length,dubCount:eps.length};
  }).catch(function(){return null;});
}
function getEpisodes(url) {
  var id=_extractId(url);
  if (!/^\d+$/.test(id)) return Promise.resolve([]);
  return _episodes(id).then(function(eps){if(eps.length)return eps;return getDetail(id).then(function(d){return d&&d.episodes||[];});});
}
function _isHttp(url) { return /^https?:\/\//i.test(String(url || '')); }
function getVideoSources(episodeUrl, opts) {
  var value=typeof episodeUrl==='string'?episodeUrl:(episodeUrl&&(episodeUrl.url||episodeUrl.id))||'';
  var p=String(value).split('||'), id=_extractId(p[0]), ep=Number(p[1]);
  if (!/^\d+$/.test(id) || !isFinite(ep) || ep<1) return Promise.reject(new Error('Ani.pm: invalid episode reference'));
  var lang=_settings().language, jobs=[lang,lang==='sub'?'dub':'sub'];
  function resolve(language) {
    var embedUrl=SITE+'/embed/ani/'+encodeURIComponent(id)+'/'+encodeURIComponent(ep)+'/'+language;
    return _text(embedUrl).then(function(html){
      var m=html.match(/id="anipm-embed-config">([^<]+)<\/script>/);
      if(!m) throw new Error('Ani.pm embed config missing');
      var config=JSON.parse(m[1]), nonce=config && config.nonce;
      if(!nonce) throw new Error('Ani.pm embed nonce missing');
      var session=SITE+'/api/partner/v1/session?n='+encodeURIComponent(nonce)+'&id='+encodeURIComponent(id)+'&ep='+encodeURIComponent(ep)+'&lang='+language+'&hardsub=0&adult=1';
      return _json(session,embedUrl).then(function(s){
        if(!s.token) throw new Error('Ani.pm session token missing');
        return _json(EMBED+'/api/embed/session?t='+encodeURIComponent(s.token),EMBED+'/').then(function(stream){
          if(!stream.source) throw new Error('Ani.pm stream URL missing');
          var subs=Array.isArray(stream.subtitles)?stream.subtitles.filter(function(x){return x&&x.url;}).map(function(x){return {file:x.url,label:x.label||x.srclang||'Unknown'};}):[];
          return [{url:stream.source,quality:'Auto',container:/\.m3u8(?:[?#]|$)/i.test(stream.source)?'hls':'mp4',
            headers:{'User-Agent':UA,'Referer':EMBED+'/'},kind:'raw',label:'Ani.pm '+language.toUpperCase(),subtitles:subs}];
        });
      });
    });
  }
  return Promise.all(jobs.map(function(l){return resolve(l).catch(function(){return [];});})).then(function(rows){
    var all=[],seen={}; rows.forEach(function(list){list.forEach(function(x){if(_isHttp(x.url)&&!seen[x.url]){seen[x.url]=true;all.push(x);}});});
    if(!all.length) throw new Error('Ani.pm returned no playable streams');
    all.sort(function(a,b){return (a.label.indexOf(lang.toUpperCase())>=0?-1:1)-(b.label.indexOf(lang.toUpperCase())>=0?-1:1);});
    return all;
  });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports={version:VERSION,getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams};
