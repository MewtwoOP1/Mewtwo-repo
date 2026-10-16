// Ani.pm source for Zangetsu.
// Supports Ani.pm's current playback-bootstrap API, with the older partner API
// retained as a compatibility fallback for catalogue/search and playback.
var SITE = 'https://ani.pm';
var API = SITE + '/api';
var EMBED = 'https://embed.settlar.io';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'anipm';
var VERSION = '1.1.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
var _seriesCache = {};

function getInfo() {
  return { name:'Ani.pm', lang:'en', baseUrl:SITE, logo:'https://www.google.com/s2/favicons?sz=256&domain=ani.pm', type:'anime', version:VERSION };
}
function getSettings() {
  return [{ key:'language', label:'Preferred audio', description:'Prefer sub or dub when both are available.', type:'enum', default:'sub', options:[{value:'sub',label:'Sub first'},{value:'dub',label:'Dub first'}] }];
}
function _settings() {
  var s = (typeof __settings !== 'undefined' && __settings && __settings[SOURCE_ID]) || {};
  return { language:s.language === 'dub' ? 'dub' : 'sub' };
}
function _trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
function _origin(referer) {
  var m = String(referer || SITE + '/').match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : SITE;
}
function _json(url, referer, attempt) {
  attempt = attempt || 0;
  var ref = referer || SITE + '/';
  return fetch(url, { headers:{'User-Agent':UA,'Accept':'application/json, text/plain, */*','Referer':ref,'Origin':_origin(ref)}, timeoutMs:15000 })
    .then(function(r) {
      if (r && r.status >= 400) { var e = new Error('Ani.pm HTTP ' + r.status); e.status = r.status; throw e; }
      var body = r && r.body != null ? r.body : '';
      if (typeof body !== 'string') body = JSON.stringify(body);
      return JSON.parse(body || '{}');
    }).catch(function(e) {
      var status = Number(e && e.status), retry = !status || status === 408 || status === 429 || status >= 500;
      if (!retry || attempt >= 2) throw e;
      return new Promise(function(resolve){ setTimeout(resolve, attempt === 0 ? 300 : 900); })
        .then(function(){ return _json(url, ref, attempt + 1); });
    });
}
function _text(url, referer) {
  var ref = referer || SITE + '/';
  return fetch(url, {headers:{'User-Agent':UA,'Accept':'text/html,application/xhtml+xml,*/*','Referer':ref,'Origin':_origin(ref)},timeoutMs:15000})
    .then(function(r) {
      if (r && r.status >= 400) { var e = new Error('Ani.pm HTTP ' + r.status); e.status = r.status; throw e; }
      var body = r && r.body != null ? r.body : '';
      return typeof body === 'string' ? body : JSON.stringify(body);
    });
}
function _list(data) {
  var v = data;
  for (var i=0; i<5 && v && !Array.isArray(v); i++) {
    if (Array.isArray(v.data)) v = v.data;
    else if (Array.isArray(v.results)) v = v.results;
    else if (Array.isArray(v.items)) v = v.items;
    else if (v.data && typeof v.data === 'object') v = v.data;
    else break;
  }
  return Array.isArray(v) ? v : [];
}
function _title(item) {
  var t = item && (item.title || item.name);
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') return t.english || t.romaji || t.native || '';
  return '';
}
function _cover(item) {
  var c = item && (item.cover || item.poster || item.image || item.imageUrl || item.posterUrl);
  if (typeof c === 'string') return c;
  if (c && typeof c === 'object') return c.extraLarge || c.large || c.medium || c.url || '';
  return '';
}
function _num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : null; }
function _newRef(item) {
  var id = item && (item.id != null ? item.id : item.slug);
  var source = item && (item.source || item.provider);
  if (id == null || !source) return null;
  return { id:String(id), source:String(source), legacy:false };
}
function _legacyRef(id) { return { id:String(id), source:'legacy', legacy:true }; }
function _card(item, legacy) {
  if (!item || typeof item !== 'object') return null;
  var title = _title(item);
  var ref = legacy ? _legacyRef(item.anilistId || item.anilist || item.malId || item.id) : _newRef(item);
  if (!title || !ref || !ref.id || ref.id === 'undefined') return null;
  var alt = item.englishTitle || item.english || item.romaji || item.nativeTitle;
  var titleData = item.title && typeof item.title === 'object' ? item.title : {};
  if (!alt) alt = titleData.english !== title ? titleData.english : (titleData.romaji !== title ? titleData.romaji : titleData.native);
  if (alt === title) alt = null;
  var url = ref.legacy ? (item.url || (SITE + '/ani/' + ref.id)) : ('anipm://' + encodeURIComponent(ref.source) + '/' + encodeURIComponent(ref.id));
  var card = {
    id:ref.legacy ? ref.id : (ref.source + ':' + ref.id),
    title:title, englishTitle:alt || null, url:url, cover:_cover(item) || null,
    type:'anime', sourceId:SOURCE_ID,
    malId:_num(item.malId || item.mal || item.idMal),
    anilistId:_num(item.anilistId || item.anilist || item.idAnilist)
  };
  _seriesCache[url] = { ref:ref, item:item, card:card };
  return card;
}
function _cards(items, legacy) {
  var out=[], seen={};
  _list(items).forEach(function(item) {
    var card = _card(item, legacy);
    if (card && !seen[card.url]) { seen[card.url]=true; out.push(card); }
  });
  return out;
}
function _currentSearch(query, page) {
  var q = _trim(query);
  if (q.length < 2) return Promise.resolve([]);
  return _json(API + '/anime/search?q=' + encodeURIComponent(q) + '&page=' + Math.max(1, Number(page) || 1))
    .then(function(data) {
      var items = Array.isArray(data) ? data : (data.items || data.results || data.data || []);
      var cards = _cards(items, false);
      if (cards.length) return cards;
      return _legacySearch(q);
    }).catch(function(){ return _legacySearch(q); });
}
function _legacySearch(query) {
  var q = _trim(query);
  if (q.length < 2) return Promise.resolve([]);
  return _json(API + '/partner/v1/titles?q=' + encodeURIComponent(q))
    .then(function(data){ return _cards(data, true); }).catch(function(){ return []; });
}
function search(query, page, opts) { return _currentSearch(query, page); }
function popular(opts) {
  return _currentSearch('one piece', 1).then(function(items){ return items; });
}
function getHome(opts) {
  return popular(opts).then(function(items){ return items.length ? [{title:'Ani.pm',items:items}] : []; });
}
function _parseRef(value) {
  var s = String(value == null ? '' : value);
  var cached = _seriesCache[s];
  if (cached) return cached.ref;
  var raw = s.replace(/^anipm:\/\//i, '');
  if (raw !== s) {
    var parts = raw.split('/');
    if (parts.length >= 2) {
      try { return {source:decodeURIComponent(parts[0]),id:decodeURIComponent(parts.slice(1).join('/')),legacy:false}; } catch (_) {}
    }
  }
  var m = s.match(/\/ani\/(\d+)(?:[/?#]|$)/i) || s.match(/(?:anilist=|\/series\/)(\d+)(?:[/?#]|$)/i) || s.match(/^(\d+)$/);
  if (m) return _legacyRef(m[1]);
  var pair = s.split('::');
  if (pair.length === 2) return {source:pair[0],id:pair[1],legacy:false};
  return null;
}
function _bootstrap(ref, episode, language) {
  var url = API + '/anime/playback-bootstrap/' + encodeURIComponent(ref.source) + '/' + encodeURIComponent(ref.id) +
    '?ep=' + encodeURIComponent(episode) + '&lang=' + encodeURIComponent(language) + '&routes=e4';
  return _json(url, SITE + '/');
}
function _core(data) { return data && (data.core || data.anime || (data.data && data.data.core) || (data.data && data.data.anime)) || null; }
function _packages(data) {
  return data && ((data.anipmPackages && data.anipmPackages.episodes) || (data.packages && data.packages.episodes) ||
    (data.data && data.data.anipmPackages && data.data.anipmPackages.episodes) || {}) || {};
}
function _episodeNumber(item) {
  var n = Number(item && (item.number != null ? item.number : (item.episode != null ? item.episode : item.ep)));
  return isFinite(n) && n > 0 ? n : null;
}
function _episodeRows(data, ref) {
  var core = _core(data) || data || {};
  var items = Array.isArray(core.episodes) ? core.episodes : (Array.isArray(core.episodeList) ? core.episodeList : []);
  var packages = _packages(data), out=[], seen={};
  items.forEach(function(item, index) {
    var n = _episodeNumber(item) || index + 1;
    if (seen[n]) return;
    seen[n]=true;
    var info = packages[String(n)] || {};
    if (Object.keys(packages).length && info.sub !== true && info.dub !== true && info.subhard !== true && info.dubhard !== true) return;
    out.push({id:ref.source + '::' + ref.id + '||' + n,number:n,title:item.title || item.name || ('Episode ' + n),
      url:ref.source + '::' + ref.id + '||' + n,sourceId:SOURCE_ID,
      thumbnail:item.thumbnail || item.image || item.cover || null,description:item.description || ''});
  });
  out.sort(function(a,b){return b.number-a.number;});
  return out;
}
function _legacyEpisodes(id) {
  return _json(API + '/partner/v1/series/' + encodeURIComponent(id))
    .then(function(data) {
      var root = data && (data.data || data);
      var rows = root && (root.episodeList || root.episodes);
      if (!Array.isArray(rows)) return [];
      return rows.map(function(item,index) {
        var n = _episodeNumber(item) || index + 1;
        return {id:id + '||' + n,number:n,title:item.title || ('Episode ' + n),url:id + '||' + n,sourceId:SOURCE_ID};
      });
    }).catch(function(){return [];});
}
function getDetail(url, opts) {
  var ref = _parseRef(url);
  if (!ref) return Promise.resolve(null);
  var cached = _seriesCache[String(url)];
  var fallback = cached && cached.card;
  if (ref.legacy) {
    return Promise.all([
      _json(API + '/partner/v1/series/' + encodeURIComponent(ref.id)).catch(function(){return null;}),
      _json(API + '/partner/v1/lookup?anilist=' + encodeURIComponent(ref.id)).catch(function(){return null;})
    ]).then(function(results) {
      var root = results[0] && (results[0].data || results[0]) || {};
      var lookup = _list(results[1])[0] || {};
      var rows = Array.isArray(root.episodeList) ? root.episodeList : (Array.isArray(root.episodes) ? root.episodes : []);
      var title = root.title || root.name || lookup.title || (fallback && fallback.title) || ('Anime ' + ref.id);
      return {id:ref.id,title:title,englishTitle:lookup.englishTitle || null,url:String(url),cover:_cover(root) || _cover(lookup) || (fallback && fallback.cover) || null,
        description:root.description || root.synopsis || '',status:root.status || 'unknown',genres:root.genres || [],studios:[],
        type:'anime',sourceId:SOURCE_ID,malId:_num(root.malId || lookup.malId),anilistId:_num(root.anilistId || ref.id),
        episodes:rows.map(function(item,index){var n=_episodeNumber(item)||index+1;return {id:ref.id+'||'+n,number:n,title:item.title||('Episode '+n),url:ref.id+'||'+n,sourceId:SOURCE_ID};}),
        subCount:rows.length,dubCount:rows.length};
    }).catch(function(){return null;});
  }
  var cachedItem = cached && cached.item || {};
  return Promise.all([
    _bootstrap(ref,1,'sub').catch(function(){return null;}),
    _bootstrap(ref,1,'dub').catch(function(){return null;})
  ]).then(function(results) {
    var data = results[0] || results[1] || {};
    var core = _core(data) || {};
    var eps = _episodeRows(data,ref);
    var title = core.title || core.name || cachedItem.title || cachedItem.name || (fallback && fallback.title) || ('Anime ' + ref.id);
    var packages = _packages(results[0] || results[1]);
    var subCount=0,dubCount=0;
    Object.keys(packages).forEach(function(k){if(packages[k].sub===true||packages[k].subhard===true)subCount++;if(packages[k].dub===true||packages[k].dubhard===true)dubCount++;});
    return {id:ref.source + ':' + ref.id,title:title,englishTitle:core.englishTitle || cachedItem.englishTitle || null,
      url:String(url),cover:_cover(core) || _cover(cachedItem) || (fallback && fallback.cover) || null,
      description:core.description || core.synopsis || '',status:core.status || 'unknown',genres:core.genres || [],studios:[],
      type:'anime',sourceId:SOURCE_ID,malId:_num(core.malId || core.idMal || cachedItem.malId),
      anilistId:_num(core.anilistId || core.idAnilist || cachedItem.anilistId),year:core.year || core.seasonYear || null,
      episodes:eps,subCount:subCount || eps.length,dubCount:dubCount || eps.length};
  }).catch(function(){return fallback ? {id:ref.source+':'+ref.id,title:fallback.title,url:String(url),cover:fallback.cover,episodes:[],type:'anime',sourceId:SOURCE_ID} : null;});
}
function getEpisodes(url, opts) {
  var ref = _parseRef(url);
  if (!ref) return Promise.resolve([]);
  if (ref.legacy) return _legacyEpisodes(ref.id);
  return Promise.all([
    _bootstrap(ref,1,'sub').catch(function(){return null;}),
    _bootstrap(ref,1,'dub').catch(function(){return null;})
  ]).then(function(results) {
    var data = results[0] || results[1];
    return data ? _episodeRows(data,ref) : [];
  }).then(function(rows) {
    if (rows.length) return rows;
    return getDetail(url,opts).then(function(detail){return detail && Array.isArray(detail.episodes) ? detail.episodes : [];});
  });
}
function _isHttp(url) { return /^https?:\/\//i.test(String(url || '')); }
function _legacyStreams(id, ep, language) {
  function resolve(lang) {
    var embedUrl = SITE + '/embed/ani/' + encodeURIComponent(id) + '/' + encodeURIComponent(ep) + '/' + lang;
    return _text(embedUrl,SITE + '/').then(function(html) {
      var match = html.match(/id="anipm-embed-config">([^<]+)<\/script>/);
      if (!match) throw new Error('Ani.pm embed config missing');
      var config = JSON.parse(match[1]), nonce = config && config.nonce;
      if (!nonce) throw new Error('Ani.pm embed nonce missing');
      var sessionUrl = API + '/partner/v1/session?n=' + encodeURIComponent(nonce) + '&id=' + encodeURIComponent(id) +
        '&ep=' + encodeURIComponent(ep) + '&lang=' + lang + '&hardsub=0&adult=1';
      return _json(sessionUrl,embedUrl).then(function(session) {
        if (!session.token) throw new Error('Ani.pm session token missing');
        return _json(EMBED + '/api/embed/session?t=' + encodeURIComponent(session.token),EMBED + '/').then(function(stream) {
          if (!stream.source) throw new Error('Settlar stream missing');
          return [{url:stream.source,quality:'Auto',container:/\.m3u8(?:[?#]|$)/i.test(stream.source)?'hls':'mp4',
            headers:{'User-Agent':UA,'Referer':EMBED+'/'},kind:'raw',label:'Ani.pm '+lang.toUpperCase(),
            subtitles:(stream.subtitles || []).filter(function(x){return x && x.url;}).map(function(x){return {file:x.url,label:x.label||x.srclang||'Unknown'};})}];
        });
      });
    });
  }
  var langs=[language,language==='sub'?'dub':'sub'];
  return Promise.all(langs.map(function(lang){return resolve(lang).catch(function(){return [];});}))
    .then(function(rows){var out=[];rows.forEach(function(list){out=out.concat(list);});if(!out.length)throw new Error('Ani.pm returned no playable streams');return out;});
}
function _streamUrl(ref, ep, lang, channel, selection) {
  var url = API + '/anime/settlar/session?selection=' + encodeURIComponent(selection) + '&provider=anipm&ep=' +
    encodeURIComponent(ep) + '&channel=' + encodeURIComponent(channel) + '&telemetry=0';
  return _json(url,SITE + '/').then(function(result) {
    var embedUrl = result && (result.embedUrl || result.url);
    if (!embedUrl) throw new Error('Ani.pm Settlar embed missing');
    var tokenMatch = String(embedUrl).match(/[?&]t=([^&]+)/);
    if (!tokenMatch) throw new Error('Ani.pm Settlar token missing');
    var token = tokenMatch[1];
    try { token = decodeURIComponent(token); } catch (_) {}
    return _json(EMBED + '/api/embed/session?t=' + encodeURIComponent(token),embedUrl).then(function(data) {
      var source = data && (data.source || (data.sources && data.sources[0] && (data.sources[0].file || data.sources[0].url)));
      if (!_isHttp(source)) throw new Error('Ani.pm returned no playable stream');
      return {url:source,quality:'Auto',container:/\.m3u8(?:[?#]|$)/i.test(source)?'hls':'mp4',
        headers:{'User-Agent':UA,'Referer':EMBED+'/'},kind:'raw',label:'Ani.pm '+lang.toUpperCase(),
        subtitles:(data.subtitles || data.tracks || []).filter(function(x){return x && (x.url || x.src || x.file);})
          .map(function(x){return {file:x.url || x.src || x.file,label:x.label || x.lang || x.language || 'Unknown'};})};
    });
  });
}
function getVideoSources(episodeUrl, opts) {
  var value = typeof episodeUrl === 'string' ? episodeUrl : (episodeUrl && (episodeUrl.url || episodeUrl.id)) || '';
  var split = String(value).split('||'), ep = Number(split[1]);
  var ref = _parseRef(split[0]);
  if (!ref || !isFinite(ep) || ep < 1) return Promise.reject(new Error('Ani.pm: invalid episode reference'));
  var language = _settings().language;
  if (ref.legacy) return _legacyStreams(ref.id,ep,language);
  return _bootstrap(ref,ep,language).then(function(data) {
    var core = _core(data) || {};
    var packages = _packages(data), pkg = packages[String(ep)] || {};
    if (pkg[language] !== true && pkg[language + 'hard'] !== true) throw new Error('Ani.pm ' + language + ' episode unavailable');
    var selection = data && data.settlarSelection;
    if (!selection) throw new Error('Ani.pm bootstrap missing Settlar selection');
    var channels = [language];
    if (pkg[language + 'hard'] === true) channels.push(language + 'hard');
    return Promise.all(channels.map(function(channel){return _streamUrl(ref,ep,language,channel,selection).catch(function(){return null;});}))
      .then(function(rows) {
        var out=rows.filter(Boolean);
        if (!out.length) throw new Error('Ani.pm returned no playable streams');
        return out;
      });
  });
}
function getStreams(url, opts) { return getVideoSources(url,opts); }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {version:VERSION,getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,search:search,
    getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,_parseRef:_parseRef,_cards:_cards};
}
