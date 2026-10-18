// Re:Anime — ported from the maintained Yuzono Aniyomi extension.
// Upstream: https://github.com/yuzono/anime-extensions/tree/master/src/en/reanime
// Catalogue and episode API follow upstream's /api/v1 contract. No AniList query is
// made: the site's own anime detail response supplies anilist_id for /api/flix.
// FlixCloud embeds are not playable URLs; resolve the site's direct-download path
// when possible rather than returning an HTML iframe as a fake stream.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'reanime';
var SITE = 'https://reanime.to';
var API = SITE + '/api/v1';
var FLIX_API = SITE + '/api/flix';
var FLIX = 'https://flixcloud.cc';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'Re:Anime', lang: 'en', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=reanime.to',
    type: 'anime', version: '1.2.0' };
}
function getSettings() { return []; }

function _headers(referer, accept) {
  return {
    'User-Agent': UA,
    'Accept': accept || 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || SITE + '/home'
  };
}
function _fetch(url, referer, timeoutMs, accept) {
  return fetch(url, { headers: _headers(referer, accept), timeoutMs: timeoutMs || 12000 })
    .then(function (r) {
      if (!r || (r.status && r.status >= 400)) throw new Error('HTTP ' + (r && r.status));
      return { body: String(r.body || ''), headers: r.headers || {}, status: r.status || 200 };
    });
}
function _json(url, referer) {
  return _fetch(url, referer).then(function (r) {
    var j = JSON.parse(r.body || 'null');
    if (!j || j.success === false) throw new Error('Re:Anime API request failed');
    return j;
  });
}
function _first(o, keys) {
  for (var i = 0; o && i < keys.length; i++) {
    var v = o[keys[i]];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}
function _arr(o) {
  if (Array.isArray(o)) return o;
  if (!o || typeof o !== 'object') return [];
  if (Array.isArray(o.results)) return o.results;
  if (Array.isArray(o.data)) return o.data;
  if (Array.isArray(o.episodes)) return o.episodes;
  if (Array.isArray(o.servers)) return o.servers;
  return [];
}
function _slug(o) {
  var s = _first(o, ['anime_id', 'animeId', 'slug', 'id']);
  if (s != null && String(s).indexOf('/') < 0) return String(s);
  var u = String(_first(o, ['url', 'href', 'link']) || '');
  var m = u.match(/\/anime\/([^/?#]+)/);
  return m ? m[1] : '';
}
function _title(o) {
  var t = _first(o, ['title', 'name', 'anime_title']);
  if (t && typeof t === 'object') return String(_first(t, ['romaji', 'english', 'native']) || 'Untitled anime');
  return String(t || 'Untitled anime');
}
function _cover(o) {
  var c = _first(o, ['cover_image', 'cover', 'poster', 'image', 'thumbnail']);
  if (c && typeof c === 'object') c = _first(c, ['extra_large', 'large', 'medium', 'url']);
  if (typeof c !== 'string' || !c) return null;
  if (c.indexOf('//') === 0) return 'https:' + c;
  return c;
}
function _item(o) {
  var slug = _slug(o);
  if (!slug) return null;
  return {
    id: slug, url: slug, title: _title(o), name: _title(o),
    cover: _cover(o), poster: _cover(o), type: 'anime', sourceId: SOURCE_ID,
    subCount: Number(o.subbed || 0), dubCount: Number(o.dubbed || 0)
  };
}
function _dedupeItems(list) {
  var out = [], seen = {};
  _arr(list).forEach(function (o) {
    var it = _item(o);
    if (it && !seen[it.id]) { seen[it.id] = 1; out.push(it); }
  });
  return out;
}
function search(query, page) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  var url = API + '/search?limit=36&offset=' + ((p - 1) * 36) + '&q=' + encodeURIComponent(q);
  return _json(url, SITE + '/search').then(_dedupeItems).catch(function () { return []; });
}
function getHome() {
  var latestUrl = API + '/home/latest-aired?limit=12';
  var popularUrl = API + '/search?sort=popularity_desc&limit=36&offset=0';
  return Promise.all([
    _json(latestUrl, SITE + '/home').catch(function () { return null; }),
    _json(popularUrl, SITE + '/search').catch(function () { return null; })
  ]).then(function (data) {
    var latest = _dedupeItems(data[0]);
    var popular = _dedupeItems(data[1]);
    var rows = [];
    if (latest.length) rows.push({ title: 'Latest Aired', items: latest });
    if (popular.length) rows.push({ title: 'Popular Anime', items: popular });
    return rows;
  });
}
function popular() {
  return _json(API + '/search?sort=popularity_desc&limit=36&offset=0', SITE + '/search')
    .then(_dedupeItems).catch(function () { return []; });
}
function _episode(ep, index, slug, anilistId) {
  var num = Number(_first(ep, ['episode_number', 'episodeNumber', 'number', 'episode']) || index + 1);
  var safeNum = isFinite(num) && num > 0 ? num : index + 1;
  var epId = String(_first(ep, ['episodeId', 'episode_id', 'id']) || ('ep-' + safeNum));
  var title = String(_first(ep, ['title', 'title_romanji', 'title_japanese']) || '');
  return {
    id: slug + '|' + safeNum + '|' + epId + '|' + String(anilistId || ''),
    url: slug + '|' + safeNum + '|' + epId + '|' + String(anilistId || ''),
    number: safeNum,
    title: title && !/episode/i.test(title) ? 'Episode ' + safeNum + ' - ' + title : 'Episode ' + safeNum
  };
}
function _detailData(slug) {
  return _json(API + '/anime/' + encodeURIComponent(slug), SITE + '/anime/' + encodeURIComponent(slug));
}
function _episodesData(slug) {
  return _json(API + '/anime/' + encodeURIComponent(slug) + '/episodes?limit=2000',
    SITE + '/anime/' + encodeURIComponent(slug));
}
function getDetail(url) {
  var slug = String(url || '').replace(/^.*\/anime\//, '').split(/[?#/|]/)[0];
  if (!slug) return Promise.reject(new Error('Re:Anime: missing anime slug'));
  return Promise.all([
    _detailData(slug),
    _episodesData(slug).catch(function () { return { data: [] }; })
  ]).then(function (res) {
    var d = res[0] && (res[0].data || res[0].anime || res[0]);
    var episodes = _arr(res[1]);
    var anilistId = Number(_first(d, ['anilist_id', 'anilistId', 'anilist']) || 0);
    var item = _item(d) || { id: slug, url: slug, title: slug, type: 'anime', sourceId: SOURCE_ID };
    item.id = slug; item.url = slug;
    item.description = String(d.description || '');
    item.status = String(d.status || 'unknown').toLowerCase();
    item.genres = Array.isArray(d.genres) ? d.genres : [];
    item.year = d.season_year || (d.start_date && d.start_date.year) || null;
    item.malId = Number(d.mal_id || 0) || undefined;
    item.episodes = episodes.map(function (ep, i) { return _episode(ep, i, slug, anilistId); });
    item.subCount = Number(d.subbed || 0) || item.episodes.length;
    item.dubCount = Number(d.dubbed || 0);
    return item;
  });
}
function getEpisodes(url) {
  return getDetail(url).then(function (d) { return d.episodes || []; });
}

function _directMedia(url, label, kind) {
  if (!/^https?:\/\//i.test(url) || !/\.(m3u8|mp4|m4v|mkv|webm)(?:[?#]|$)/i.test(url)) return null;
  var ext = (url.match(/\.([a-z0-9]+)(?:[?#]|$)/i) || [,''])[1].toLowerCase();
  return {
    url: url, quality: 'Auto', label: label || 'Re:Anime',
    container: ext === 'm3u8' ? 'hls' : ext,
    headers: _headers(FLIX + '/'), kind: kind || 'sub',
    audioLang: kind === 'dub' ? 'en' : 'ja', subtitles: []
  };
}
function _parseJson5(raw) {
  var s = String(raw || '');
  // ReAnime's Svelte payload is JSON5-like: quote bare keys, drop trailing commas,
  // and normalize undefined values without evaluating page JavaScript.
  s = s.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
  s = s.replace(/,\s*([}\]])/g, '$1');
  s = s.replace(/:\s*undefined\b/g, ': null');
  return JSON.parse(s);
}
function _flixApiHeaders(referer, accept) {
  return {
    'User-Agent': UA,
    'Accept': accept || 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': FLIX,
    'Referer': referer || FLIX + '/'
  };
}
function _postJson(url, payload, referer) {
  return fetch(url, {
    method: 'POST',
    headers: Object.assign({}, _flixApiHeaders(referer), {
      'Content-Type': 'application/json'
    }),
    body: JSON.stringify(payload),
    timeoutMs: 15000
  }).then(function (r) {
    if (!r || (r.status && r.status >= 400)) throw new Error('HTTP ' + (r && r.status));
    var j = JSON.parse(String(r.body || 'null'));
    if (!j) throw new Error('Empty FlixCloud response');
    return j;
  });
}
function _resolveFlixStream(dataLink, label, kind) {
  if (!/\/e\/[a-z0-9]+/i.test(String(dataLink || ''))) return Promise.resolve([]);
  var embedHeaders = _flixApiHeaders(FLIX + '/');
  return fetch(dataLink, { headers: embedHeaders, timeoutMs: 15000 })
    .then(function (r) {
      if (!r || (r.status && r.status >= 400)) throw new Error('FlixCloud embed HTTP ' + (r && r.status));
      return String(r.body || '');
    })
    .then(function (html) {
      var scriptPath = (html.match(/href=["']([^"']*hls\.js[^"']*)["']/i) || [])[1] || '';
      var maskPromise = scriptPath ? _fetch(
        /^https?:\/\//i.test(scriptPath) ? scriptPath : FLIX + (scriptPath.charAt(0) === '/' ? '' : '/') + scriptPath,
        FLIX + '/', 10000, '*/*'
      ).then(function (r) {
        var m = r.body.match(/for\s*\(\s*var\s+f\s*=\s*\[(\d{1,3}(?:\s*,\s*\d{1,3}){15})\]/);
        return m ? m[1].split(',').map(function (n) { return Number(n.trim()); }) : null;
      }).catch(function () { return null; }) : Promise.resolve(null);
      var dataMatch = html.match(/type:\s*["']data["']\s*,\s*data:\s*(\{[\s\S]*?\})\s*,\s*uses:/);
      if (!dataMatch) throw new Error('FlixCloud embed data not found');
      var embedData = _parseJson5(dataMatch[1]);
      // The current decoder does not need subtitle/chapter metadata in its payload.
      delete embedData.subtitles;
      delete embedData.intro_chapter;
      delete embedData.outro_chapter;
      return Promise.all([maskPromise, Promise.resolve(embedData)]);
    })
    .then(function (pair) {
      var embedData = pair[1];
      return _postJson('https://enc-dec.app/api/dec-flixcloud?type=token', { data: embedData }, FLIX + '/')
        .then(function (tokenDto) {
          if (Number(tokenDto.status) !== 200 || !tokenDto.result || !tokenDto.result.token) {
            throw new Error('FlixCloud token decode failed');
          }
          return _fetch(FLIX + '/api/m3u8/' + encodeURIComponent(tokenDto.result.token), FLIX + '/', 15000, '*/*')
            .then(function (r) {
              var streamResponse = JSON.parse(r.body || 'null');
              if (!streamResponse || typeof streamResponse !== 'object') throw new Error('FlixCloud stream response was not JSON');
              return _postJson('https://enc-dec.app/api/dec-flixcloud?type=stream', {
                data: { context: tokenDto.result.context, stream_response: streamResponse }
              }, FLIX + '/');
            });
        });
    })
    .then(function (streamDto) {
      if (Number(streamDto.status) !== 200 || !streamDto.result || !streamDto.result.stream) {
        throw new Error('FlixCloud stream decode failed');
      }
      var streamUrl = String(streamDto.result.stream);
      var wPayload = streamDto.result.context && streamDto.result.context.w_payload;
      if (wPayload == null) throw new Error('FlixCloud stream payload missing');
      // Use the upstream decoder's HTTP endpoint. Unlike the Aniyomi port, this
      // runtime cannot host the local loopback proxy that rewrites/decrypts HLS
      // segments, so the remote parser endpoint is the compatible bridge.
      var playable = 'https://enc-dec.app/api/parse-flixcloud?url=' +
        encodeURIComponent(streamUrl) + '&w_payload=' + encodeURIComponent(String(wPayload));
      return [{
        url: playable, quality: 'Auto', label: label || 'Re:Anime',
        container: 'hls', headers: _flixApiHeaders(FLIX + '/'),
        kind: kind || 'sub', audioLang: kind === 'dub' ? 'en' : 'ja', subtitles: []
      }];
    })
    .catch(function () { return []; });
}
function getVideoSources(episodeUrl, opts) {
  var parts = String(episodeUrl || '').split('|');
  var slug = parts[0] || '';
  var epNum = Number(parts[1] || 0);
  var aid = Number(parts[3] || 0);
  if (!slug || !(epNum > 0)) return Promise.resolve([]);
  var audio = opts && String(opts.category || '').toLowerCase() === 'dub' ? 'dub' : 'sub';
  var getAid = aid > 0 ? Promise.resolve(aid) :
    _detailData(slug).then(function (d) {
      var data = d && (d.data || d.anime || d);
      return Number(_first(data, ['anilist_id', 'anilistId', 'anilist']) || 0);
    });
  return getAid.then(function (anilistId) {
    if (!(anilistId > 0)) return [];
    return _json(FLIX_API + '/' + anilistId + '/' + epNum, SITE + '/watch/' + slug + '?ep=' + epNum)
      .then(function (data) {
        var servers = _arr(data);
        var tasks = [];
        servers.forEach(function (server) {
          var serverType = String(server.dataType || '').toLowerCase();
          if (serverType && serverType !== audio) return;
          var label = '[' + (serverType || audio).toUpperCase() + '] ' + String(server.serverName || 'Re:Anime');
          var link = String(server.dataLink || server.url || '');
          var direct = _directMedia(link, label, audio);
          if (direct) tasks.push(Promise.resolve([direct]));
          else if (/flixcloud/i.test(link) && /\/e\//i.test(link)) tasks.push(_resolveFlixStream(link, label, audio));
        });
        return Promise.all(tasks).then(function (groups) {
          var out = [], seen = {};
          groups.forEach(function (group) {
            (group || []).forEach(function (s) {
              if (!s || !s.url || seen[s.url]) return;
              seen[s.url] = 1;
              out.push(s);
            });
          });
          return out;
        });
      });
  }).catch(function () {
    // A provider/network failure must not bubble into Zangetsu's generic
    // "source is having a moment" state. Report no streams and let other sources run.
    return [];
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.2.0', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks
  };
}
