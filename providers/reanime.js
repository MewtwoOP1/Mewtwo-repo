// Re:Anime — ported from the maintained Yuzono Aniyomi extension.
// Upstream: https://github.com/yuzono/anime-extensions/tree/master/src/en/reanime
// Catalogue and episode API follow upstream's /api/v1 contract. No AniList query is
// made: the site's own anime detail response supplies anilist_id for /api/flix.
// FlixCloud embeds are not playable URLs; resolve the site's direct-download path
// when possible rather than returning an HTML iframe as a fake stream.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'reanime';
var SITE = 'https://reanime.to';
// Domain rotation follows the maintained Yuzono Aniyomi extension. Try each
// supported domain when one returns the Cloudflare "Just a moment" interstitial.
var SITE_DOMAINS = ['https://reanime.to', 'https://reanime.cz', 'https://reanime.wtf'];
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
function _isMomentPage(response) {
  var body = String(response && response.body || '').toLowerCase();
  return body.indexOf('just a moment') >= 0 ||
    body.indexOf('cf-chl-') >= 0 ||
    body.indexOf('challenge-platform') >= 0 ||
    body.indexOf('checking your browser') >= 0;
}
function _fetchOnce(url, referer, timeoutMs, accept, browser) {
  return fetch(url, {
    headers: _headers(referer, accept),
    timeoutMs: timeoutMs,
    browser: !!browser
  }).then(function (r) {
    var response = {
      body: String(r && r.body || ''),
      headers: r && r.headers || {},
      status: r && r.status || 200
    };
    if (!r || response.status >= 400) {
      var err = new Error('HTTP ' + response.status);
      err.response = response;
      throw err;
    }
    return response;
  });
}
function _fetch(url, referer, timeoutMs, accept) {
  var budget = timeoutMs || 12000;
  // Re:Anime upstream supports all three domains. Use the original first, then
  // rotate only when the domain is blocked/down; do not blindly repeat healthy calls.
  var sourceDomain = SITE_DOMAINS.filter(function (domain) {
    return String(url).indexOf(domain) === 0;
  })[0];
  var domains = sourceDomain ? SITE_DOMAINS : [''];
  var lastError = null;
  function tryDomain(i) {
    if (i >= domains.length) return Promise.reject(lastError || new Error('Re:Anime: all supported domains failed'));
    var domain = domains[i];
    var targetUrl = sourceDomain ? domain + String(url).slice(sourceDomain.length) : url;
    var targetReferer = sourceDomain && referer
      ? domain + String(referer).slice(sourceDomain.length)
      : (referer || (domain || SITE) + '/home');
    return _fetchOnce(targetUrl, targetReferer, Math.min(budget, 5000), accept, false)
      .then(function (response) {
        if (!_isMomentPage(response)) return response;
        // Use Zangetsu's native Cloudflare browser lane for a real interstitial.
        return _fetchOnce(targetUrl, targetReferer, Math.min(budget, 7000), accept, true)
          .then(function (cleared) {
            if (_isMomentPage(cleared)) throw new Error('Cloudflare challenge remained after browser retry');
            return cleared;
          });
      })
      .catch(function (err) {
        lastError = err;
        var response = err && err.response;
        if (response && !_isMomentPage(response) && response.status < 500 && response.status !== 403 && response.status !== 429) {
          // A valid client error (e.g. a missing slug) is not a domain outage.
          throw err;
        }
        return tryDomain(i + 1);
      });
  }
  return tryDomain(0);
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
function _resolveFlixDownload(dataLink, label, kind) {
  var match = String(dataLink || '').match(/\/e\/([a-z0-9]+)/i);
  if (!match) return Promise.resolve([]);
  var aid = match[1];
  return _fetch(FLIX + '/d/' + encodeURIComponent(aid) + '/__data.json', FLIX + '/', 12000, '*/*')
    .then(function (r) {
      var body = r.body;
      var fileId = (body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
      var token = (body.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/) || [])[0];
      var base = (body.match(/https:\/\/fetch\d*\.flixcloud\.cc/i) || [FLIX])[0];
      var resolution = (body.match(/(\d{3,4}p)/i) || [])[1] || 'Auto';
      if (!fileId || !token) return [];
      var progressUrl = base + '/download/' + fileId + '/progress?token=' + encodeURIComponent(token);
      // Upstream waits for the SSE progress endpoint to report ready. Keep this
      // bounded; never label the embed HTML itself as a playable stream.
      return _fetch(progressUrl, FLIX + '/', 6500, 'text/event-stream, */*')
        .then(function (p) {
          if (!/"status"\s*:\s*"ready"/i.test(p.body)) return [];
          return [{
            url: base + '/download/' + fileId + '?token=' + encodeURIComponent(token),
            quality: resolution, label: (label || 'Re:Anime') + ' Download',
            container: 'mkv', headers: _headers(FLIX + '/'),
            kind: kind || 'sub', audioLang: kind === 'dub' ? 'en' : 'ja', subtitles: []
          }];
        }).catch(function () { return []; });
    }).catch(function () { return []; });
}
function getVideoSources(episodeUrl, opts) {
  var parts = String(episodeUrl || '').split('|');
  var slug = parts[0] || '';
  var epNum = Number(parts[1] || 0);
  var aid = Number(parts[3] || 0);
  if (!slug || !(epNum > 0)) return Promise.reject(new Error('Re:Anime: invalid episode reference'));
  var audio = opts && String(opts.category || '').toLowerCase() === 'dub' ? 'dub' : 'sub';
  var getAid = aid > 0 ? Promise.resolve(aid) :
    _detailData(slug).then(function (d) {
      var data = d && (d.data || d.anime || d);
      return Number(_first(data, ['anilist_id', 'anilistId', 'anilist']) || 0);
    });
  return getAid.then(function (anilistId) {
    if (!(anilistId > 0)) throw new Error('Re:Anime API detail did not return anilist_id');
    return _json(FLIX_API + '/' + anilistId + '/' + epNum, SITE + '/watch/' + slug + '?ep=' + epNum);
  }).then(function (data) {
    var servers = _arr(data);
    var tasks = [];
    servers.forEach(function (server) {
      var serverType = String(server.dataType || '').toLowerCase();
      if (serverType && serverType !== audio) return;
      var label = '[' + (serverType || audio).toUpperCase() + '] ' + String(server.serverName || 'Re:Anime');
      var link = String(server.dataLink || server.url || '');
      var direct = _directMedia(link, label, audio);
      if (direct) tasks.push(Promise.resolve([direct]));
      else if (/flixcloud/i.test(link)) tasks.push(_resolveFlixDownload(link, label, audio));
    });
    return Promise.all(tasks).then(function (groups) {
      var out = [], seen = {};
      groups.forEach(function (group) {
        (group || []).forEach(function (s) {
          if (!s || !s.url || seen[s.url]) return;
          seen[s.url] = 1; out.push(s);
        });
      });
      if (!out.length) throw new Error('Re:Anime returned server embeds, but no direct playable URL was resolved. FlixCloud HLS requires a local decrypting proxy unsupported by this provider runtime.');
      return out;
    });
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.1.0', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks
  };
}
