// Mega-Anime: AniList metadata with playback backed by the actual AniWaves
// and AniNami APIs from KSHITIJ8473/raghav/RaghavAnime.
// Keep this provider self-contained for Zangetsu's source runtime.
var SOURCE_ID = 'mega-anime';
var ANILIST = 'https://graphql.anilist.co';
var ANI_WAVES = 'https://aniwaves.ru';
var ANI_NAMI = 'https://www.aninami.site';
var MEDIA_CACHE = {};
var MEDIA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

var MEDIA_FIELDS = 'id idMal title{romaji english native} coverImage{extraLarge large} bannerImage description(asHtml:false) status genres studios(isMain:true){nodes{name}} episodes format averageScore seasonYear nextAiringEpisode{episode}';
var SEARCH_QUERY = 'query($search:String,$page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){media(search:$search,type:ANIME,sort:POPULARITY_DESC){' + MEDIA_FIELDS + '}}}';
var HOME_QUERY = 'query($sort:[MediaSort],$page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){media(type:ANIME,sort:$sort){' + MEDIA_FIELDS + '}}}';
var DETAIL_QUERY = 'query($id:Int){Media(id:$id,type:ANIME){' + MEDIA_FIELDS + '}}';

function _anilist(query, variables) {
  return fetch(ANILIST, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': UA
  }, body: JSON.stringify({ query: query, variables: variables || {} }) }).then(function (r) {
    if (r.status < 200 || r.status >= 300) throw new Error('AniList HTTP ' + r.status);
    return r.json();
  }).then(function (body) {
    if (body.errors && body.errors.length) throw new Error('AniList: ' + body.errors[0].message);
    return body;
  });
}
function _cacheMedia(m) {
  if (!m || !(Number(m.id) > 0)) return;
  MEDIA_CACHE[String(m.id)] = { value: m, at: Date.now() };
  var keys = Object.keys(MEDIA_CACHE);
  if (keys.length > 100) {
    keys.sort(function (a, b) { return MEDIA_CACHE[a].at - MEDIA_CACHE[b].at; });
    while (keys.length > 100) delete MEDIA_CACHE[keys.shift()];
  }
}
function _cachedMedia(id) {
  var item = MEDIA_CACHE[String(id)];
  if (!item) return null;
  if (!item.at || Date.now() - item.at > MEDIA_CACHE_TTL_MS) {
    delete MEDIA_CACHE[String(id)];
    return null;
  }
  return item.value || null;
}
function _cacheMediaList(list) { (list || []).forEach(_cacheMedia); }
function _titleOf(m) { return m && m.title ? (m.title.english || m.title.romaji || m.title.native || 'Unknown') : 'Unknown'; }
function _coverOf(m) { return m && m.coverImage ? (m.coverImage.extraLarge || m.coverImage.large || null) : null; }
function _typeOf(m) { return m && m.format === 'MOVIE' ? 'movie' : 'anime'; }
function _mediaToItem(m) {
  _cacheMedia(m);
  return { id: 'anilist:' + m.id, title: _titleOf(m), url: 'anilist:' + m.id,
    cover: _coverOf(m), type: _typeOf(m), sourceId: SOURCE_ID };
}
// IDs are opaque identifiers. Accept only an unsigned, positive numeric ID in a known
// namespace; never shift IDs with +/- offsets or extract digits from arbitrary text.
function _positiveNumericId(value) {
  var s = String(value == null ? '' : value);
  if (!/^\d+$/.test(s)) return null;
  var n = Number(s);
  return isFinite(n) && n > 0 && Math.floor(n) === n ? n : null;
}
function _parseId(url) {
  var s = String(url || '');
  var m = s.match(/^anilist:(\d+)$/i)
    || s.match(/^mega-anime:(\d+)$/i)
    || s.match(/^(\d+)$/);
  if (!m) return 0;
  var id = _positiveNumericId(m[1]);
  return id === null ? 0 : id;
}
function _episodesFor(media, opts) {
  var kind = String(opts && opts.category || 'sub').toLowerCase() === 'dub' ? 'dub' : 'sub';
  var count = Number(media.episodes) || 0;
  if (media.nextAiringEpisode && Number(media.nextAiringEpisode.episode) > 0) {
    var released = Number(media.nextAiringEpisode.episode) - 1;
    if (!count || released < count) count = released;
  }
  if (count < 1 && media.format === 'MOVIE') count = 1;
  if (count < 1) count = 1;
  var out = [];
  for (var i = 1; i <= count; i++) {
    var id = 'mega-anime:' + media.id + ':' + i + ':' + kind;
    out.push({ id: id, title: 'Episode ' + i, number: i, url: id, date: null });
  }
  return out;
}
function _text(s) {
  return String(s || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function _abs(base, u) {
  if (!u) return '';
  try { return new URL(u, base).toString(); } catch (e) { return /^https?:\/\//i.test(u) ? u : ''; }
}
function _requestText(url, referer, ajax) {
  var headers = { 'User-Agent': UA, 'Accept': '*/*', 'Referer': referer || url };
  if (ajax) headers['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(url, { headers: headers }).then(function (r) {
    if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status + ' for ' + url);
    if (typeof r.text === 'function') return r.text();
    if (typeof r.body === 'string') return r.body;
    return '';
  });
}
function _requestJson(url, referer, ajax) {
  return _requestText(url, referer, ajax).then(function (body) {
    try { return JSON.parse(body || 'null'); } catch (e) { throw new Error('Invalid JSON from ' + url); }
  });
}
function _ajax(base, path, referer) { return _requestJson(base + path, referer || base + '/', true); }
function _dedupe(list) {
  var seen = {};
  return (list || []).filter(function (s) {
    if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) return false;
    var k = s.url + '|' + (s.quality || '') + '|' + (s.kind || '');
    if (seen[k]) return false;
    seen[k] = true; return true;
  });
}
function _video(url, quality, referer, kind, server, typeHint) {
  var hint = String(typeHint || '').toLowerCase();
  var hls = hint === 'hls' || hint === 'm3u8' || /\.m3u8(?:[?#]|$)/i.test(url);
  var headers = { 'User-Agent': UA, 'Referer': referer || ANI_NAMI + '/' };
  // If Origin is needed, it should match the source page, not the media CDN.
  var origin = ((headers.Referer || '').match(/^(https?:\/\/[^/]+)/i) || [])[1];
  if (origin) headers.Origin = origin;
  return { url: url, quality: quality || 'auto', label: (server || 'Mega-Anime') + ' · ' + (quality || 'auto'),
    container: hls ? 'hls' : 'mp4', hls: hls, kind: kind || 'sub',
    audioLang: kind === 'dub' ? 'en' : 'ja', headers: headers, subtitles: [] };
}
function _dedupeVideos(list) { return _dedupe(list); }
function _titleNorm(s) { return _text(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function _titleMatch(a, b) {
  var x = _titleNorm(a), y = _titleNorm(b);
  return !!x && !!y && (x === y || x.indexOf(y) >= 0 || y.indexOf(x) >= 0);
}
function getInfo() {
  return { name: 'Mega-Anime', lang: 'en', baseUrl: 'https://anilist.co',
    logo: 'https://anilist.co/favicon.ico', type: 'anime', version: '1.0.3' };
}
function getSettings() { return []; }
function search(query, page, opts) {
  return _anilist(SEARCH_QUERY, { search: String(query || ''), page: page || 1, perPage: 30 })
    .then(function (body) { return ((body.data || {}).Page || {}).media || []; })
    .then(function (media) { return media.map(_mediaToItem); })
    .catch(function (e) { console.error('[mega-anime] search failed: ' + e.message); return []; });
}
function getHome(opts) {
  function row(sort, title) {
    return _anilist(HOME_QUERY, { sort: [sort], page: 1, perPage: 20 }).then(function (body) {
      var media = ((body.data || {}).Page || {}).media || [];
      _cacheMediaList(media);
      return { title: title, items: media.map(_mediaToItem) };
    }).catch(function () { return { title: title, items: [] }; });
  }
  return Promise.all([row('TRENDING_DESC', 'Trending Now'), row('POPULARITY_DESC', 'Popular This Season'),
    row('SCORE_DESC', 'Top Rated')]);
}
function getDetail(url, opts) {
  var id = _parseId(url);
  if (!id) return Promise.resolve(null);
  return _anilist(DETAIL_QUERY, { id: id }).then(function (body) {
    var m = body.data && body.data.Media;
    if (!m) return null;
    _cacheMedia(m);
    var studios = [];
    ((m.studios && m.studios.nodes) || []).forEach(function (s) { if (s && s.name) studios.push(s.name); });
    return { id: 'anilist:' + m.id, title: _titleOf(m), url: 'anilist:' + m.id,
      cover: _coverOf(m), description: m.description || '', status: m.status || 'UNKNOWN',
      genres: m.genres || [], studios: studios, type: _typeOf(m), sourceId: SOURCE_ID,
      episodes: _episodesFor(m, opts), malId: m.idMal || null };
  }).catch(function (e) { console.error('[mega-anime] detail failed: ' + e.message); return null; });
}
function getEpisodes(seriesUrl, opts) { return getDetail(seriesUrl, opts).then(function (d) { return d && d.episodes ? d.episodes : []; }); }

// -------------------------- AniWaves resolver -------------------------------
// Actual site chain: /filter?keyword=, /<anime-slug>, /ajax/episode/list/<id>,
// /ajax/server/list?servers=<server_ids>, /ajax/sources?id=<link-id>&asi=0&autoPlay=0.
function _parseAniWavesCards(html) {
  var out = [], seen = {};
  var re = /<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html || '')) !== null) {
    var href = m[2] || '';
    if (!/\/watch\//i.test(href) && !/\/anime\//i.test(href) && !/\/(?:[^/?#]+-\d+)\/?(?:[?#]|$)/i.test(href)) continue;
    var title = (m[1].match(/title=["']([^"']+)["']/i) || [])[1]
      || (m[3].match(/alt=["']([^"']+)["']/i) || [])[1]
      || _text(m[3]);
    title = _text(title).replace(/\s+Poster$/i, '');
    if (!title) continue;
    var url = _abs(ANI_WAVES, href);
    var slug = (url.match(/\/([^/?#]+)\/?(?:[?#]|$)/) || [])[1];
    if (!slug || seen[slug]) continue;
    seen[slug] = true;
    var img = (m[3].match(/(?:src|data-src)=["']([^"']+)["']/i) || [])[1];
    out.push({ slug: slug, title: title, url: url, cover: _abs(ANI_WAVES, img) });
  }
  return out;
}
function _pickAniWaves(html, titles) {
  var list = _parseAniWavesCards(html);
  for (var i = 0; i < titles.length; i++) {
    var match = list.find(function (x) { return _titleMatch(x.title, titles[i]); });
    if (match) return match;
  }
  return list.length === 1 ? list[0] : null;
}
function _normalizeExtracted(arr, referer, kind, serverName) {
  return Array.isArray(arr) ? arr.map(function (s) {
    if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) return null;
    var copy = Object.assign({}, s);
    copy.label = copy.label || (serverName || 'Mega-Anime') + ' · ' + (copy.quality || 'auto');
    copy.headers = Object.assign({ 'User-Agent': UA, 'Referer': referer || ANI_NAMI + '/' }, s.headers || {});
    copy.kind = kind || 'sub';
    copy.audioLang = kind === 'dub' ? 'en' : 'ja';
    return copy;
  }).filter(Boolean) : [];
}
function _extractEmbed(url, referer, kind, serverName) {
  if (typeof extractVideo !== 'function') return Promise.resolve([]);
  var headers = { 'User-Agent': UA, 'Referer': referer || ANI_NAMI + '/' };
  try {
    return Promise.resolve(extractVideo(url, { headers: headers })).then(function (arr) {
      return _normalizeExtracted(arr, referer, kind, serverName);
    }).catch(function () { return []; });
  } catch (e) { return Promise.resolve([]); }
}
function _getAniWavesEmbed(url, watchUrl, kind, serverName) {
  return _requestJson(url, watchUrl, true).then(function (j) {
    var embed = j && j.result && j.result.url;
    if (!embed || !/^https?:\/\//i.test(embed)) return [];
    var typeHint = /\.m3u8(?:[?#]|$)/i.test(embed) ? 'hls' : (/\.mp4(?:[?#]|$)/i.test(embed) ? 'mp4' : '');
    if (typeHint) return [_video(embed, 'auto', watchUrl, kind, serverName, typeHint)];
    return _extractEmbed(embed, watchUrl, kind, serverName);
  }).catch(function () { return []; });
}
function _resolveAniWaves(media, epNumber, kind) {
  var titles = [media.title && media.title.english, media.title && media.title.romaji, media.title && media.title.native].filter(Boolean);
  var q = encodeURIComponent(titles[0] || titles[1] || '');
  if (!q) return Promise.resolve([]);
  return _requestText(ANI_WAVES + '/filter?keyword=' + q, ANI_WAVES + '/', false)
    .then(function (html) {
      var match = _pickAniWaves(html, titles);
      if (!match) return [];
      return _requestText(match.url, ANI_WAVES + '/', false).then(function (watchHtml) {
        var animeId = (watchHtml.match(/data-id=["'](\d+)["']/i) || [])[1]
          || (watchHtml.match(/id=["']watch-main["'][^>]*data-id=["'](\d+)/i) || [])[1];
        if (!animeId) return [];
        return _ajax(ANI_WAVES, '/ajax/episode/list/' + animeId, match.url).then(function (epData) {
          var result = epData && typeof epData.result === 'string' ? epData.result : '';
          var episodeLinks = [], re = /<a\b([^>]*\bdata-ids=["']([^"']+)["'][^>]*)>/gi, em;
          while ((em = re.exec(result)) !== null) {
            var attrs = em[1], n = parseInt((attrs.match(/data-num=["'](\d+)/i) || [])[1] || '0', 10);
            var hasCat = kind === 'dub' ? /data-dub=["']1/i.test(attrs) : /data-sub=["']1/i.test(attrs);
            if (n === Number(epNumber) && hasCat && em[2]) episodeLinks.push({ ids: em[2].replace(/&amp;/g, '&'), number: n });
          }
          if (!episodeLinks.length) return [];
          return Promise.all(episodeLinks.map(function (episodeInfo) {
            return _ajax(ANI_WAVES, '/ajax/server/list?servers=' + encodeURIComponent(episodeInfo.ids), match.url)
              .then(function (srvData) {
                var markup = srvData && typeof srvData.result === 'string' ? srvData.result : '';
                var sections = [], typeRe = /<([a-z0-9]+)\b([^>]*class=["'][^"']*\btype\b[^"']*["'][^>]*)>([\s\S]*?)(?=<[a-z0-9]+\b[^>]*class=["'][^"']*\btype\b|$)/gi, tm;
                while ((tm = typeRe.exec(markup)) !== null) {
                  var st = String((tm[2].match(/data-type=["']([^"']+)["']/i) || [])[1] || '').toLowerCase();
                  if (kind === 'dub' ? st !== 'dub' : (st !== 'sub' && st !== 'ssub')) continue;
                  var inner = tm[3], liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi, lm;
                  while ((lm = liRe.exec(inner)) !== null) {
                    var attrs2 = lm[1] + ' ' + lm[2];
                    var linkId = (attrs2.match(/data-link-id=["']([^"']+)["']/i) || [])[1];
                    if (!linkId || sections.some(function (s) { return s.id === linkId; })) continue;
                    sections.push({ id: linkId, name: _text(lm[2]) || 'AniWaves' });
                  }
                }
                return Promise.all(sections.map(function (srv) {
                  return _getAniWavesEmbed(ANI_WAVES + '/ajax/sources?id=' + encodeURIComponent(srv.id) + '&asi=0&autoPlay=0',
                    match.url, kind, srv.name);
                })).then(function (groups) { return [].concat.apply([], groups); });
              }).catch(function () { return []; });
          })).then(function (groups) { return _dedupeVideos([].concat.apply([], groups)); });
        });
      });
    }).catch(function (e) { console.warn('[mega-anime] AniWaves resolver failed: ' + e.message); return []; });
}

// -------------------------- AniNami resolver --------------------------------
// API shape taken from RaghavAniNami.kt: /api/episodes/{anilistId}, then
// /api/watch/{provider}/{anilistId}/{audioType}/{slug}.
function _resolveAniNami(media, epNumber, kind) {
  var anilistId = Number(media && media.id) || 0;
  if (!anilistId) return Promise.resolve([]);
  return _requestJson(ANI_NAMI + '/api/episodes/' + anilistId, ANI_NAMI + '/', false).then(function (body) {
    var providers = body && body.results && body.results.providers || {};
    var entries = [];
    Object.keys(providers).forEach(function (providerName) {
      var categories = providers[providerName] && providers[providerName].episodes || {};
      (categories[kind] || []).forEach(function (item) {
        if (Number(item && item.number) === Number(epNumber) && item.id) entries.push({ provider: providerName, id: String(item.id) });
      });
    });
    if (!entries.length) return [];
    return Promise.all(entries.map(function (entry) {
      var p = entry.id.split('/');
      if (p.length < 5 || p[0] !== 'watch') return [];
      var provider = p[1], animeId = p[2], audioType = p[3], slug = p.slice(4).join('/');
      if (!provider || !animeId || !audioType || !slug) return [];
      var watchUrl = ANI_NAMI + '/api/watch/' + provider + '/' + animeId + '/' + audioType + '/' + slug;
      return _requestJson(watchUrl, ANI_NAMI + '/', false).then(function (streamBody) {
        var streams = streamBody && streamBody.results && streamBody.results.streams || [];
        var videos = [];
        streams.forEach(function (stream) {
          if (!stream || !stream.url || !/^https?:\/\//i.test(stream.url)) return;
          var st = String(stream.type || '').toLowerCase(), ref = stream.referer || ANI_NAMI + '/';
          if (st === 'hls' || st === 'mp4' || st === 'video') {
            videos.push(_video(stream.url, stream.quality || 'auto', ref, kind, stream.server || 'AniNami'));
          } else if (typeof extractVideo === 'function') {
            try {
              var out = extractVideo(stream.url, { headers: { 'User-Agent': UA, 'Referer': ref } });
              if (Array.isArray(out)) out.forEach(function (s) {
                var copy = Object.assign({}, s);
                copy.headers = Object.assign({ 'User-Agent': UA, 'Referer': ref }, s.headers || {});
                copy.kind = copy.kind || kind;
                copy.audioLang = copy.audioLang || (kind === 'dub' ? 'en' : 'ja');
                videos.push(copy);
              });
            } catch (e) {}
          }
        });
        return videos;
      }).catch(function () { return []; });
    })).then(function (groups) { return _dedupeVideos([].concat.apply([], groups)); });
  }).catch(function (e) { console.warn('[mega-anime] AniNami resolver failed: ' + e.message); return []; });
}
function _resolveAll(media, epNumber, kind) {
  return Promise.all([_resolveAniWaves(media, epNumber, kind), _resolveAniNami(media, epNumber, kind)])
    .then(function (groups) { return _dedupeVideos([].concat.apply([], groups)); });
}
function getVideoSources(episodeUrl, opts) {
  // Episode IDs are <AniList ID>:<episode number>[:sub|dub].
  // Reject signed, partial or free-text IDs instead of silently changing them.
  var parsed = String(episodeUrl || '').match(/^(?:mega-anime:)?(\d+):(\d+)(?::(sub|dub))?$/i);
  if (!parsed) return Promise.resolve([]);
  var id = _positiveNumericId(parsed[1]);
  var ep = _positiveNumericId(parsed[2]);
  var kind = String(parsed[3] || 'sub').toLowerCase();
  if (id === null || ep === null || (kind !== 'sub' && kind !== 'dub')) return Promise.resolve([]);
  return _anilist(DETAIL_QUERY, { id: id }).then(function (body) {
    var media = body.data && body.data.Media;
    if (!media) return [];
    return _resolveAll(media, ep, kind);
  }).catch(function (e) { console.error('[mega-anime] sources failed: ' + e.message); return []; });
}
var getStreams = getVideoSources;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: '1.0.3', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams };
}
