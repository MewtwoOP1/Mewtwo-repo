// Ani.pm source for Zangetsu.
// Supports Ani.pm's current playback-bootstrap API, with the older partner API
// retained as a compatibility fallback for catalogue/search and playback.
var SITE = 'https://ani.pm';
var API = SITE + '/api';
var EMBED = 'https://embed.settlar.io';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'anipm';
var VERSION = '1.3.7';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
var _seriesCache = {};
var _detailCache = {};
var _detailInflight = {};
var _DETAIL_TTL = 30000;

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
  if (c && typeof c === 'object') c = c.extraLarge || c.large || c.medium || c.url || '';
  if (typeof c !== 'string' || !c) return '';
  // Ani.pm returns RELATIVE cover paths (/api/anime/cover?key=...). The app
  // loads covers as-is, so a relative path never renders — make it absolute.
  if (c.charAt(0) === '/') return SITE + c;
  return c;
}
function _num(v) {
  var s = String(v == null ? '' : v);
  if (!/^\d+$/.test(s)) return null;
  var n = Number(s);
  return isFinite(n) && n > 0 ? n : null;
}
function _firstNum(values) {
  for (var i=0; i<values.length; i++) {
    var n = _num(values[i]);
    if (n !== null) return n;
  }
  return null;
}
function _objectId(value) {
  if (value && typeof value === 'object') {
    return _firstNum([value.id, value.value, value.anilistId, value.anilist_id, value.mediaId, value.media_id]);
  }
  return _num(value);
}
// Ani.pm's tracker identity can be flat, nested under an ID map, or embedded
// in its /ani/<id> URL. Keep that AniList namespace separate from source IDs.
function _anilistId(item) {
  if (!item || typeof item !== 'object') return null;
  var groups = [item.ids, item.externalIds, item.external_ids, item.trackerIds,
    item.tracker_ids, item.mappings, item.identifiers];
  var nested = [];
  groups.forEach(function(group) {
    if (!group || typeof group !== 'object') return;
    nested.push(group.anilist, group.aniList, group.anilistId, group.anilist_id);
  });
  var direct = _firstNum([
    item.anilistId, item.anilist_id, item.anilistID, item.aniListId,
    item.idAnilist, item.id_anilist, item.anilistMediaId,
    _objectId(item.anilist), _objectId(item.aniList)
  ]);
  if (direct !== null) return direct;
  for (var i=0; i<nested.length; i++) {
    var n = _objectId(nested[i]);
    if (n !== null) return n;
  }
  return null;
}
function _newRef(item) {
  var id = item && (item.id != null ? item.id : item.slug);
  var source = item && (item.source || item.provider);
  if (id == null || !source) return null;
  return { id:String(id), source:String(source), legacy:false };
}
function _legacyRef(id, anilistId) {
  if (id == null || String(id) === '') return null;
  var trackerId = _num(anilistId);
  return { id:String(id), source:'legacy', legacy:true,
    anilistIdIsExplicit:trackerId !== null, anilistId:trackerId };
}
function _card(item, legacy) {
  if (!item || typeof item !== 'object') return null;
  var title = _title(item);
  var itemUrl = String(item.url || '');
  var urlAniListMatch = itemUrl.match(/\/ani\/(\d+)(?:[/?#]|$)/i) ||
    itemUrl.match(/[?&]anilist=(\d+)(?:[&#]|$)/i);
  var explicitAniListId = _firstNum([
    _anilistId(item), urlAniListMatch && urlAniListMatch[1]
  ]);
  // Source-native IDs route detail and playback; tracker IDs are separate.
  var sourceId = item.id != null ? item.id : (item.slug != null ? item.slug :
    (explicitAniListId !== null ? explicitAniListId :
      _firstNum([item.malId, item.mal_id, item.mal, item.idMal])));
  var ref = legacy ? _legacyRef(sourceId, explicitAniListId) : _newRef(item);
  if (!title || !ref || !ref.id || ref.id === 'undefined') return null;
  var alt = item.englishTitle || item.english || item.romaji || item.nativeTitle;
  var titleData = item.title && typeof item.title === 'object' ? item.title : {};
  if (!alt) alt = titleData.english !== title ? titleData.english : (titleData.romaji !== title ? titleData.romaji : titleData.native);
  if (alt === title) alt = null;
  var useAniListRoute = ref.legacy && ref.anilistIdIsExplicit && String(ref.id) === String(ref.anilistId);
  var url = ref.legacy ? (item.url || (SITE + (useAniListRoute ? '/ani/' : '/series/') + ref.id)) :
    ('anipm://' + encodeURIComponent(ref.source) + '/' + encodeURIComponent(ref.id));
  var card = {
    id:ref.legacy ? ref.id : (ref.source + ':' + ref.id),
    title:title, englishTitle:alt || null, url:url, cover:_cover(item) || null,
    type:'anime', sourceId:SOURCE_ID,
    malId:_firstNum([item.malId, item.mal_id, item.mal, item.idMal]),
    anilistId:explicitAniListId
  };
  _seriesCache[url] = { ref:ref, item:item, card:card };
  return card;
}

// Preserve a previously matched Ani.pm card when bootstrap/detail data is
// missing or malformed. Do not fabricate episode rows or infer IDs; carry
// forward only the title, artwork and tracker IDs already supplied by search.
function _cachedCardDetail(url) {
  var cached = _seriesCache[String(url)];
  if (!cached || !cached.card) return null;
  var card = cached.card;
  var detail = {
    id: card.id,
    title: card.title,
    url: String(url),
    type: 'anime',
    sourceId: SOURCE_ID,
    episodes: [],
    subCount: 0,
    dubCount: 0
  };
  if (card.englishTitle) detail.englishTitle = card.englishTitle;
  if (card.cover) detail.cover = card.cover;
  if (card.malId) detail.malId = card.malId;
  if (card.anilistId) detail.anilistId = card.anilistId;
  return detail;
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
      return _cards(items, false);
    }).catch(function(){ return []; });
}
// Prefer Ani.pm's documented partner API. The newer catalogue API remains a
// compatibility fallback for titles not exposed by the partner endpoint.
function _legacySearch(query) {
  var q = _trim(query);
  if (q.length < 2) return Promise.resolve([]);
  return _json(API + '/partner/v1/titles?q=' + encodeURIComponent(q))
    .then(function(data){ return _cards(data, true); }).catch(function(){ return []; });
}
function search(query, page, opts) {
  return _legacySearch(query).then(function(cards) {
    return cards.length ? cards : _currentSearch(query, page);
  });
}
function popular(opts) {
  return _currentSearch('one piece', 1).then(function(items){ return items; });
}
function getHome(opts) {
  // Real catalogue rows from the browse feed. The old home was a single
  // search for "one piece", which is why the app showed one row of only
  // One Piece results.
  function row(title, query) {
    return _json(API + '/anime/browse?page=1' + query).then(function(data) {
      var items = Array.isArray(data) ? data : (data.items || data.results || data.data || []);
      var cards = _cards(items, false);
      return cards.length ? { title:title, items:cards } : null;
    }).catch(function(){ return null; });
  }
  return Promise.all([
    row('Popular', ''),
    row('Top Rated', '&sort=score'),
    row('Newest', '&sort=newest')
  ]).then(function(rows) {
    var out = rows.filter(Boolean);
    if (out.length) return out;
    return popular(opts).then(function(items){ return items.length ? [{title:'Ani.pm',items:items}] : []; });
  });
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
  var m = s.match(/\/ani\/(\d+)(?:[/?#]|$)/i);
  if (m) return _legacyRef(m[1], m[1]);
  m = s.match(/[?&]anilist=(\d+)(?:[&#]|$)/i);
  if (m) return _legacyRef(m[1], m[1]);
  m = s.match(/\/series\/(\d+)(?:[/?#]|$)/i) || s.match(/^(\d+)$/);
  if (m) return _legacyRef(m[1], null);
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
function _detailScore(data) {
  if (!data) return -1;
  var core = _core(data) || data;
  var episodes = core && (Array.isArray(core.episodes) ? core.episodes : (Array.isArray(core.episodeList) ? core.episodeList : []));
  var packages = _packages(data);
  var packageCount = Object.keys(packages).length;
  var title = _title(core);
  // Prefer the bootstrap that actually carries the catalogue/source data;
  // a truthy but empty SUB response must not mask a populated DUB response.
  return (Array.isArray(episodes) ? episodes.length * 4 : 0) + packageCount + (title ? 2 : 0);
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
  // Z Mode numbers source slots from the start of the series; never return
  // newest-first or its canonical episode URLs will point at the wrong streams.
  out.sort(function(a,b){return a.number-b.number;});
  return out;
}
function _legacyEpisodes(id) {
  return _json(API + '/partner/v1/series/' + encodeURIComponent(id))
    .then(function(data) {
      var root = data && (data.data || data);
      var rows = root && (root.episodeList || root.episodes);
      if (!Array.isArray(rows)) return [];
      var episodes = rows.map(function(item,index) {
        var n = _episodeNumber(item) || index + 1;
        return {id:id + '||' + n,number:n,title:item.title || ('Episode ' + n),url:id + '||' + n,sourceId:SOURCE_ID};
      });
      episodes.sort(function(a,b){return a.number-b.number;});
      return episodes;
    }).catch(function(){return [];});
}
function getDetail(url, opts) {
  var ref = _parseRef(url);
  if (!ref) return Promise.resolve(null);
  var key = String(url);
  var now = Date.now();
  var hit = _detailCache[key];
  if (hit && (now - hit.at) < _DETAIL_TTL) return Promise.resolve(hit.value);
  if (_detailInflight[key]) return _detailInflight[key];
  var pending = _fetchDetail(url, opts).then(function(detail) {
    delete _detailInflight[key];
    // A failed bootstrap must not turn a title already found by search into
    // a null detail result. In Z Mode that can surface as "AniList is having
    // a moment" even though the catalogue metadata was already available.
    if (!detail) detail = _cachedCardDetail(url);
    if (detail && Array.isArray(detail.episodes) && detail.episodes.length) {
      _detailCache[key] = {at:Date.now(),value:detail};
    }
    return detail;
  }, function(error) {
    delete _detailInflight[key];
    var fallback = _cachedCardDetail(url);
    if (fallback) return fallback;
    throw error;
  });
  _detailInflight[key] = pending;
  return pending;
}
function _fetchDetail(url, opts) {
  var ref = _parseRef(url);
  if (!ref) return Promise.resolve(null);
  var cached = _seriesCache[String(url)];
  var fallback = cached && cached.card;
  if (ref.legacy) {
    var lookupRequest = ref.anilistIdIsExplicit && ref.anilistId !== null
      ? _json(API + '/partner/v1/lookup?anilist=' + encodeURIComponent(ref.anilistId)).catch(function(){return null;})
      : Promise.resolve(null);
    return Promise.all([
      _json(API + '/partner/v1/series/' + encodeURIComponent(ref.id)).catch(function(){return null;}),
      lookupRequest
    ]).then(function(results) {
      var root = results[0] && (results[0].data || results[0]) || {};
      var lookup = _list(results[1])[0] || {};
      var rows = Array.isArray(root.episodeList) ? root.episodeList : (Array.isArray(root.episodes) ? root.episodes : []);
      var title = _title(root) || _title(lookup) || (fallback && fallback.title) || ('Anime ' + ref.id);
      var detail = {id:ref.id,title:title,englishTitle:lookup.englishTitle || null,url:String(url),cover:_cover(root) || _cover(lookup) || (fallback && fallback.cover) || null,
        description:root.description || root.synopsis || '',status:root.status || 'unknown',genres:root.genres || [],studios:[],
        type:'anime',sourceId:SOURCE_ID,
        malId:_firstNum([root.malId, root.mal_id, root.mal, root.idMal, lookup.malId, lookup.mal_id, lookup.mal, lookup.idMal]),
        anilistId:_firstNum([_anilistId(root), _anilistId(lookup),
          ref.anilistIdIsExplicit ? ref.anilistId : null]),
        episodes:rows.map(function(item,index){var n=_episodeNumber(item)||index+1;return {id:ref.id+'||'+n,number:n,title:item.title||('Episode '+n),url:ref.id+'||'+n,sourceId:SOURCE_ID};}),
        subCount:rows.length,dubCount:rows.length};
      if (!detail.englishTitle) delete detail.englishTitle;
      if (!detail.cover) delete detail.cover;
      if (!detail.description) delete detail.description;
      if (detail.status === 'unknown') delete detail.status;
      if (!detail.genres.length) delete detail.genres;
      if (!detail.malId) delete detail.malId;
      if (!detail.anilistId) delete detail.anilistId;
      return detail;
    }).catch(function(){return null;});
  }
  var cachedItem = cached && cached.item || {};
  return Promise.all([
    _bootstrap(ref,1,'sub').catch(function(){return null;}),
    _bootstrap(ref,1,'dub').catch(function(){return null;})
  ]).then(function(results) {
    // Do not return a synthetic, mostly-empty detail when both bootstrap
    // requests failed or returned no usable catalogue payload. Such a result
    // can arrive after the catalogue has already rendered and overwrite its
    // AniList/MAL metadata. Let the caller keep the catalogue detail instead.
    if (_detailScore(results[0]) <= 0 && _detailScore(results[1]) <= 0) return null;
    var data = _detailScore(results[1]) > _detailScore(results[0]) ? results[1] : (results[0] || results[1] || {});
    var core = _core(data) || {};
    var eps = _episodeRows(data,ref);
    var title = _title(core) || _title(cachedItem) || (fallback && fallback.title) || ('Anime ' + ref.id);
    var packages = _packages(data);
    var subCount=0,dubCount=0;
    Object.keys(packages).forEach(function(k){if(packages[k].sub===true||packages[k].subhard===true)subCount++;if(packages[k].dub===true||packages[k].dubhard===true)dubCount++;});
    var detail = {id:ref.source + ':' + ref.id,title:title,englishTitle:core.englishTitle || cachedItem.englishTitle || null,
      url:String(url),cover:_cover(core) || _cover(cachedItem) || (fallback && fallback.cover) || null,
      description:core.description || core.synopsis || '',status:core.status || 'unknown',genres:core.genres || [],studios:[],
      type:'anime',sourceId:SOURCE_ID,
      malId:_firstNum([core.malId, core.mal_id, core.mal, core.idMal, cachedItem.malId]),
      anilistId:_firstNum([_anilistId(core), _anilistId(cachedItem)]),
      year:(core.year || core.seasonYear) ? String(core.year || core.seasonYear) : null,
      episodes:eps,subCount:subCount || eps.length,dubCount:dubCount || eps.length};
    // Missing fields are not facts. Omit them so a partial source response
    // cannot erase the metadata already supplied by the catalogue.
    if (!detail.englishTitle) delete detail.englishTitle;
    if (!detail.cover) delete detail.cover;
    if (!detail.description) delete detail.description;
    if (detail.status === 'unknown') delete detail.status;
    if (!Array.isArray(detail.genres) || !detail.genres.length) delete detail.genres;
    if (!detail.malId) delete detail.malId;
    if (!detail.anilistId) delete detail.anilistId;
    if (!detail.year) delete detail.year;
    return detail;
  }).catch(function(){return _cachedCardDetail(url);});
}
function getEpisodes(url, opts) {
  var ref = _parseRef(url);
  if (!ref) return Promise.resolve([]);
  if (ref.legacy) return _legacyEpisodes(ref.id);
  // Reuse the same successful detail/episode payload instead of issuing two
  // more bootstrap calls immediately after getDetail has already fetched it.
  return getDetail(url, opts).then(function(detail) {
    return detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  }).catch(function(){return [];});
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
          return [{url:stream.source,quality:'Auto',container:(stream.kind === 'hls' || /\.m3u8(?:[?#]|$)/i.test(stream.source))?'hls':'mp4',
            headers:{'User-Agent':UA,'Referer':EMBED+'/'},kind:'raw',label:'Ani.pm '+lang.toUpperCase(),
            subtitles:(stream.subtitles || []).filter(function(x){return x && x.url;}).map(function(x){var lbl=x.label||x.srclang||'Unknown';return {url:x.url,file:x.url,lang:lbl,label:lbl};})}];
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
      // The Settlar session says what the stream actually is (kind:"hls");
      // the signed object URL has no .m3u8 extension, so guessing from the
      // URL mislabels every stream as mp4 and the player cannot play it.
      return {url:source,quality:'Auto',container:(data.kind === 'hls' || /\.m3u8(?:[?#]|$)/i.test(source))?'hls':'mp4',
        headers:{'User-Agent':UA,'Referer':EMBED+'/'},kind:'raw',label:'Ani.pm '+lang.toUpperCase() + (channel === lang + 'hard' ? ' Hardsub' : ''),
        audioLang:data.audioLang || (lang === 'dub' ? 'en' : 'ja'),
        subtitles:(data.subtitles || data.tracks || []).filter(function(x){return x && (x.url || x.src || x.file);})
          .map(function(x){var u=x.url || x.src || x.file;var lbl=x.label || x.lang || x.language || 'Unknown';return {url:u,file:u,lang:lbl,label:lbl};})};
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
  function resolveWith(data, lang) {
    var packages = _packages(data), pkg = packages[String(ep)] || {};
    if (pkg[lang] !== true && pkg[lang + 'hard'] !== true) return Promise.resolve(null);
    var selection = data && data.settlarSelection;
    if (!selection) return Promise.resolve(null);
    var channels = [lang];
    if (pkg[lang + 'hard'] === true) channels.push(lang + 'hard');
    return Promise.all(channels.map(function(channel){return _streamUrl(ref,ep,lang,channel,selection).catch(function(){return null;});}))
      .then(function(rows) {
        var out=rows.filter(Boolean);
        return out.length ? out : null;
      });
  }
  return _bootstrap(ref,ep,language).then(function(data) {
    return resolveWith(data, language).then(function(out) {
      if (out) return out;
      // The language setting is a PREFERENCE, not a hard filter: when the
      // preferred language has no package for this episode but the other
      // language does, play the other one instead of reporting the
      // episode unavailable.
      var other = language === 'sub' ? 'dub' : 'sub';
      return _bootstrap(ref,ep,other).then(function(data2) {
        return resolveWith(data2, other).then(function(out2) {
          if (out2) return out2;
          throw new Error('Ani.pm returned no playable streams');
        });
      });
    });
  });
}
function getStreams(url, opts) { return getVideoSources(url,opts); }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {version:VERSION,getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,search:search,
    getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getStreams,_parseRef:_parseRef,_cards:_cards};
}
