// AllAnime — Zangetsu source powered by the AllAnime Direct API.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'allanime';
var VERSION = '1.0.0';
var API = 'https://allanime-api.mdtahseen7378.workers.dev';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36';

function getInfo() {
  return { name:'AllAnime', lang:'en', baseUrl:API,
    logo:'https://www.google.com/s2/favicons?sz=256&domain=allanime-api.mdtahseen7378.workers.dev',
    type:'anime', version:VERSION };
}
function getSettings() { return []; }
function _json(path) {
  return fetch(API + path, {headers:{'Accept':'application/json','User-Agent':UA},timeoutMs:20000})
    .then(function(r) {
      if (!r || (r.status && r.status >= 400)) return null;
      var body = r.body == null ? '' : r.body;
      if (typeof body !== 'string') body = JSON.stringify(body);
      return JSON.parse(body || 'null');
    }).catch(function(){return null;});
}
function _obj(v) {
  if (!v || typeof v !== 'object') return {};
  if (v.data && typeof v.data === 'object') return v.data;
  if (v.result && typeof v.result === 'object') return v.result;
  return v;
}
function _rows(v) {
  if (Array.isArray(v)) return v;
  v = _obj(v);
  if (Array.isArray(v.results)) return v.results;
  if (Array.isArray(v.items)) return v.items;
  if (Array.isArray(v.data)) return v.data;
  if (Array.isArray(v.episodes)) return v.episodes;
  return [];
}
function _title(v) {
  var t = v && (v.title || v.title_english || v.english_title || v.name);
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') return t.english || t.romaji || t.native || '';
  return '';
}
function _cover(v) {
  var c = v && (v.thumbnail_url || v.thumbnail || v.cover || v.poster || v.image);
  if (c && typeof c === 'object') c = c.url || c.src;
  return typeof c === 'string' && c ? c : null;
}
function _id(v) {
  return String(v && (v.id || v.show_id || v.anime_id) || '');
}
function _mode(opts, fallback) {
  var m = opts && (opts.category || opts.mode || opts.language);
  m = String(m || fallback || 'sub').toLowerCase();
  return m.indexOf('dub') >= 0 ? 'dub' : 'sub';
}
function _card(v) {
  var id = _id(v), title = _title(v);
  if (!id || !title) return null;
  var card = {id:id,title:title,url:'allanime://'+encodeURIComponent(id)+'/sub',
    type:'anime',sourceId:SOURCE_ID};
  var cover = _cover(v);
  if (cover) card.cover = cover;
  if (v.synopsis || v.description) card.description = v.synopsis || v.description;
  if (v.status) card.status = v.status;
  if (v.year) card.year = String(v.year);
  return card;
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _json('/search?query='+encodeURIComponent(q)).then(function(payload) {
    return _rows(payload).map(_card).filter(Boolean);
  }).catch(function(){return [];});
}
function getHome(opts) { return Promise.resolve([]); }
function _episodes(id, mode) {
  return _json('/episodes/'+encodeURIComponent(id)+'?mode='+encodeURIComponent(mode)).then(function(payload) {
    var v = _obj(payload), rows = _rows(payload);
    if (!rows.length && v && Array.isArray(v.episodes)) rows = v.episodes;
    return rows.map(function(item, i) {
      var raw = item && typeof item === 'object'
        ? (item.episode_no != null ? item.episode_no : item.episode != null ? item.episode : item.number != null ? item.number : item.id)
        : item;
      if (raw == null) return null;
      var n = String(raw);
      var epTitle = item && typeof item === 'object' ? (item.title || item.name || '') : '';
      var ep = {id:'allanime://'+encodeURIComponent(id)+'/'+mode+'/'+encodeURIComponent(n),
        url:'allanime://'+encodeURIComponent(id)+'/'+mode+'/'+encodeURIComponent(n),
        number:Number(n),title:epTitle || ('Episode '+n),type:'anime',sourceId:SOURCE_ID,season:1};
      if (!isFinite(ep.number)) ep.number = i + 1;
      return ep;
    }).filter(Boolean);
  }).catch(function(){return [];});
}
function getDetail(url, opts) {
  var id = String(url || '').replace(/^allanime:\/\//i,'').split('/')[0];
  try { id = decodeURIComponent(id); } catch (_) {}
  if (!id) return Promise.resolve(null);
  var mode = _mode(opts, 'sub');
  return Promise.all([
    _json('/anime/'+encodeURIComponent(id)),
    _episodes(id, mode)
  ]).then(function(results) {
    var info = _obj(results[0]);
    if (!results[0] || !_title(info)) return null;
    var detail = {id:id,title:_title(info),url:'allanime://'+encodeURIComponent(id)+'/'+mode,
      type:'anime',sourceId:SOURCE_ID,episodes:results[1],
      subCount:Number(info.episodes_sub)||0,dubCount:Number(info.episodes_dub)||0};
    var cover = _cover(info);
    if (cover) detail.cover = cover;
    if (info.synopsis || info.description) detail.description = info.synopsis || info.description;
    if (info.status) detail.status = info.status;
    if (info.year) detail.year = String(info.year);
    if (info.genres && Array.isArray(info.genres)) detail.genres = info.genres;
    return detail;
  }).catch(function(){return null;});
}
function getEpisodes(url, opts) {
  var raw = String(url || '').replace(/^allanime:\/\//i,'').split('/');
  if (!raw[0]) return Promise.resolve([]);
  var id = raw[0], mode = _mode(opts, raw[1] || 'sub');
  try { id = decodeURIComponent(id); } catch (_) {}
  return _episodes(id, mode);
}
function getVideoSources(episodeUrl, opts) {
  var raw = String(episodeUrl || '').replace(/^allanime:\/\//i,'').split('/');
  if (raw.length < 3 || !raw[0]) return Promise.resolve([]);
  var id = raw[0], mode = _mode(opts, raw[1] || 'sub'), epNo = raw.slice(2).join('/');
  try { id = decodeURIComponent(id); epNo = decodeURIComponent(epNo); } catch (_) {}
  var params = '?show_id='+encodeURIComponent(id)+'&ep_no='+encodeURIComponent(epNo)+'&mode='+encodeURIComponent(mode)+'&quality=best';
  return _json('/episode_url'+params).then(function(payload) {
    var v = _obj(payload), media = typeof payload === 'string' ? payload : (v.episode_url || v.url || v.src || v.file);
    if (media && typeof media === 'string' && /^https?:\/\//i.test(media)) {
      var isHls = /\.m3u8(?:$|\?)/i.test(media), isMp4 = /\.mp4(?:$|\?)/i.test(media);
      return [{url:media,name:'AllAnime Direct',provider:'AllAnime',quality:'Auto',
        container:isHls?'m3u8':(isMp4?'mp4':'auto'),hls:isHls,headers:{'Referer':API+'/'},isActive:true}];
    }
    // The documented /play endpoint is a proxy fallback when episode_url cannot return a direct link.
    return [{url:API+'/play'+params,name:'AllAnime Proxy',provider:'AllAnime',quality:'Auto',
      container:'mp4',headers:{'Referer':API+'/'},isActive:true}];
  }).catch(function() {
    var params2 = '?show_id='+encodeURIComponent(id)+'&ep_no='+encodeURIComponent(epNo)+'&mode='+encodeURIComponent(mode)+'&quality=best';
    return [{url:API+'/play'+params2,name:'AllAnime Proxy',provider:'AllAnime',quality:'Auto',
      container:'mp4',headers:{'Referer':API+'/'},isActive:true}];
  });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = {
  version:VERSION,getInfo:getInfo,getSettings:getSettings,getHome:getHome,
  search:search,getDetail:getDetail,getEpisodes:getEpisodes,
  getVideoSources:getVideoSources,getStreams:getStreams
};
