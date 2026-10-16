// AnimeX source for Zangetsu Community Sources.
// Uses AnimeX's public GraphQL catalogue and REST API for episode source discovery.
// Upstream stream URLs and required headers are returned by AnimeX; no media is hosted here.

var SITE = 'https://animex.one';
var GQL = 'https://graphql.animex.one/graphql';
var REST = 'https://pp.animex.one/rest/api';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animex';
var VERSION = '1.0.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
var _searchCache = {};
var _detailCache = {};
var _detailInflight = {};

function getInfo() {
  return { name: 'AnimeX', lang: 'en', baseUrl: SITE,
    logo: 'https://animex.one/_app/immutable/assets/favicon.CdbYna26.png',
    type: 'anime', version: VERSION };
}
function getSettings() {
  return [{ key:'language', label:'Preferred audio',
    description:'Prefer sub or dub when both are available.',
    type:'enum', default:'sub',
    options:[{value:'sub',label:'Sub first'},{value:'dub',label:'Dub first'}] }];
}
function _trim(v) { return String(v == null ? '' : v).replace(/^\s+|\s+$/g, ''); }
function _origin(url) { var m=String(url||'').match(/^(https?:\/\/[^/]+)/i); return m ? m[1] : SITE; }
function _settings() {
  var s=(typeof __settings!=='undefined' && __settings && __settings[SOURCE_ID]) || {};
  return { language:s.language==='dub' ? 'dub' : 'sub' };
}
function _headers(ref) {
  var r=ref || SITE + '/';
  return { 'User-Agent':UA, Accept:'application/json, */*', Origin:_origin(r), Referer:r };
}
function _fetchText(url, options) {
  return fetch(url, options || {}).then(function(r) {
    if (r && r.status >= 400) throw new Error('AnimeX HTTP ' + r.status);
    var b=r && r.body!=null ? r.body : '';
    return typeof b==='string' ? b : JSON.stringify(b);
  });
}
function _json(url, ref) {
  return _fetchText(url,{headers:_headers(ref),timeoutMs:15000}).then(function(body) {
    return JSON.parse(body || 'null');
  });
}
function _gql(query, variables) {
  return _fetchText(GQL,{method:'POST',headers:Object.assign(_headers(SITE+'/'),{'Content-Type':'application/json'}),body:JSON.stringify({query:query,variables:variables||{}}),timeoutMs:15000})
    .then(function(body) {
      var j=JSON.parse(body||'null');
      if (j && j.errors && j.errors.length) throw new Error('AnimeX GraphQL: '+(j.errors[0].message||'request failed'));
      return j && j.data ? j.data : null;
    });
}
var SEARCH_QUERY = 'query($query: String!, $limit: Int) { searchAnime(query: $query, limit: $limit) { items { id anilistId malId titleEnglish titleRomaji format status episodeCount coverImage bannerImage } } }';
var INFO_QUERY = 'query($malId: Int) { anime(malId: $malId) { id anilistId malId titleEnglish titleRomaji format status episodeCount coverImage bannerImage subCount dubCount } }';
function _title(x) { return _trim(x && (x.titleEnglish || x.titleRomaji || x.title || x.name || '')); }
function _cover(x) { return x && (x.coverImage || x.cover || x.poster || x.image) || null; }
function _normal(item) {
  if (!item || item.id == null) return null;
  var id=String(item.id), title=_title(item);
  if (!title) return null;
  return { id:id, title:title, url:id, cover:_cover(item),
    banner:item.bannerImage || null, type:'anime', sourceId:SOURCE_ID,
    anilistId:item.anilistId || null, malId:item.malId || null,
    subCount:Number(item.subCount||0), dubCount:Number(item.dubCount||0),
    year:null, status:_trim(item.status||'').toLowerCase() };
}
function _list(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.episodes)) return data.episodes;
  if (data && Array.isArray(data.results)) return data.results;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}
function search(query,page,opts) {
  var q=_trim(query); if (!q) return Promise.resolve([]);
  var key=q.toLowerCase()+'|'+(parseInt(page,10)||1);
  if (_searchCache[key]) return Promise.resolve(_searchCache[key].slice());
  return _gql(SEARCH_QUERY,{query:q,limit:25}).then(function(data) {
    var items=data && data.searchAnime && data.searchAnime.items;
    var out=(Array.isArray(items)?items:[]).map(_normal).filter(Boolean);
    _searchCache[key]=out;
    return out.slice();
  }).catch(function(){return [];});
}
function getHome(opts) {
  // The upstream public API does not expose a stable home feed in the same
  // contract; stay useful with a small set of popular/trending search terms.
  var topics=['one piece','naruto','solo leveling'];
  return Promise.all(topics.map(function(q){return search(q,1,opts);})).then(function(rows) {
    var out=[],seen={};
    rows.forEach(function(list){list.slice(0,8).forEach(function(item){if(!seen[item.id]){seen[item.id]=1;out.push(item);}});});
    return out.length ? [{title:'AnimeX picks',items:out}] : [];
  });
}
function popular(opts) { return getHome(opts).then(function(rows){return rows.reduce(function(a,r){return a.concat(r.items||[]);},[]);}); }
function _resolveId(url) {
  if (url && typeof url==='object') url=url.url || url.id || '';
  var raw=_trim(url);
  var m=raw.match(/\/anime\/([^?#/]+)/i);
  if (m) raw=decodeURIComponent(m[1]);
  raw=raw.replace(/^animex:\/\//i,'').replace(/^\/+|\/+$/g,'');
  return raw;
}
function _getInfoByMal(malId) {
  var n=Number(malId); if (!isFinite(n)||n<1) return Promise.resolve(null);
  return _gql(INFO_QUERY,{malId:n}).then(function(data){return data && data.anime || null;}).catch(function(){return null;});
}
function _fetchEpisodes(id) {
  var url=REST+'/episodes?id='+encodeURIComponent(id);
  return _json(url,SITE+'/').then(_list).catch(function(){return [];});
}
function getDetail(url,opts) {
  var id=_resolveId(url);
  if (!id) return Promise.resolve(null);
  if (_detailCache[id]) return Promise.resolve(_detailCache[id]);
  if (_detailInflight[id]) return _detailInflight[id];
  var baseItem=null;
  var task=Promise.resolve().then(function(){ return _fetchEpisodes(id); }).then(function(episodes) {
    // The provider search result is enough to present a stable fallback when
    // the optional page/episode endpoint temporarily fails.
    var ep=episodes.map(function(e,i){
      var number=Number(e.number || e.episode || e.epNum || e.ep || i+1);
      if (!isFinite(number)||number<1) number=i+1;
      return { id:'animex://'+encodeURIComponent(id)+'/'+number,
        number:number,title:_trim(e.title||e.name||'Episode '+number),
        url:'animex://'+encodeURIComponent(id)+'/'+number };
    }).sort(function(a,b){return a.number-b.number;});
    return _getInfoByMal(opts && opts.malId).then(function(info) {
      var item=info ? _normal(info) : null;
      var detail=item || baseItem || {id:id,title:id,url:id,cover:null,type:'anime',sourceId:SOURCE_ID};
      detail.episodes=ep; detail.sourceId=SOURCE_ID;
      _detailCache[id]=detail;
      return detail;
    });
  }).finally(function(){ delete _detailInflight[id]; });
  _detailInflight[id]=task;
  return task;
}
function getEpisodes(url,opts) { return getDetail(url,opts).then(function(d){return d && d.episodes || [];}); }
function _getServers(id,epNum) {
  return _json(REST+'/servers?id='+encodeURIComponent(id)+'&epNum='+encodeURIComponent(epNum),SITE+'/').catch(function(){return null;});
}
function _providerId(p) {
  if (!p) return '';
  var id=typeof p==='string'?p:(p.id||p.name||p.serverName||'');
  return _trim(id).toLowerCase().replace(/[-_ ]+(sub|dub)$/i,'');
}
function _providersFor(servers,mode) {
  if (!servers) return [];
  var keys=Object.keys(servers);
  for (var i=0;i<keys.length;i++) {
    var k=keys[i].toLowerCase();
    if (k===mode+'providers' || k===mode+'provider' || k===mode+'s' || k===mode) {
      var raw=servers[keys[i]], list=Array.isArray(raw)?raw:(raw && Array.isArray(raw.providers)?raw.providers:(raw && Array.isArray(raw.items)?raw.items:[]));
      return list.map(_providerId).filter(Boolean);
    }
  }
  var wrappers=['data','result','servers','providers'];
  for (var w=0;w<wrappers.length;w++) if (servers[wrappers[w]] && typeof servers[wrappers[w]]==='object') {
    var nested=_providersFor(servers[wrappers[w]],mode); if(nested.length)return nested;
  }
  return [];
}
function _pickSources(data) {
  if (!data) return [];
  return Array.isArray(data.sources) ? data.sources : (data.source ? [data.source] : []);
}
function getVideoSources(episodeUrl,opts) {
  var m=String(episodeUrl||'').match(/^animex:\/\/([^/]+)\/(\d+)/i);
  if (!m) {
    var chunks=String(episodeUrl||'').split('||');
    if (chunks.length>=2 && /^\d+$/.test(chunks[0]) && /^\d+$/.test(chunks[1])) m=[null,chunks[0],chunks[1]];
  }
  if (!m) return Promise.resolve([]);
  var id=decodeURIComponent(m[1]), epNum=Number(m[2])||1;
  var configured=_settings().language;
  var requestModes=configured==='dub'?['dub','sub']:['sub','dub'];
  return _getServers(id,epNum).then(function(servers) {
    if (!servers) return [];
    var jobs=[];
    requestModes.forEach(function(mode) {
      var ids=_providersFor(servers,mode);
      ids.slice(0,3).forEach(function(providerId) {
        var url=REST+'/sources?id='+encodeURIComponent(id)+'&epNum='+encodeURIComponent(epNum)+'&type='+mode+'&providerId='+encodeURIComponent(providerId);
        jobs.push(_json(url,'https://plyr.animex.one/').then(function(data) {
          var rows=_pickSources(data), headers=(data && data.headers)||{};
          return rows.map(function(src) {
            if (!src || !src.url) return null;
            var type=String(src.type||'').toLowerCase(), streamUrl=src.url;
            if (!/^https?:\/\//i.test(streamUrl)) {
              var base=(headers.Referer||'https://plyr.animex.one/');
              streamUrl=base.replace(/\/$/,'')+'/'+streamUrl.replace(/^\//,'');
            }
            return {url:streamUrl,quality:src.quality||'Auto',
              label:(_trim(src.quality)||'Auto')+' ['+providerId+' '+mode+']',
              container:(type.indexOf('mpegurl')>=0 || /\.m3u8(?:\?|$)/i.test(streamUrl))?'hls':'mp4',
              kind:mode,audioLang:mode==='dub'?'en':'ja',
              headers:{'User-Agent':UA,Referer:headers.Referer||'https://plyr.animex.one/',Origin:headers.Origin||_origin(headers.Referer||'https://plyr.animex.one/')}};
          }).filter(Boolean);
        }).catch(function(){return []; }));
      });
    });
    return Promise.all(jobs).then(function(lists) {
      var out=[],seen={};
      lists.forEach(function(list){list.forEach(function(src){if(!seen[src.url]){seen[src.url]=1;out.push(src);}});});
      return out;
    });
  }).catch(function(){return [];});
}
function getStreams(id,opts) { return getVideoSources(id,opts); }
function getLinks(id,opts) { return getVideoSources(id,opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = {
  version:VERSION,getInfo:getInfo,getSettings:getSettings,getHome:getHome,popular:popular,
  search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,
  getStreams:getStreams,getLinks:getLinks,_resolveId:_resolveId,_providersFor:_providersFor
};
