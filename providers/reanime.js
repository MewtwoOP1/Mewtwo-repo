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
    type: 'anime', version: '1.2.6' };
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
// Yuzono's maintained Re:Anime extension supports these domains. Rotate only
// when a host is down, rate-limited, blocked, or serving a Cloudflare interstitial.
var SITE_DOMAINS = ['https://reanime.to', 'https://reanime.cz', 'https://reanime.wtf'];
function _isMomentPage(response) {
  var body = String(response && response.body || '').toLowerCase();
  var headers = response && response.headers || {};
  var cfMitigated = String(headers['cf-mitigated'] || headers['CF-Mitigated'] || '').toLowerCase();
  return cfMitigated.indexOf('challenge') >= 0 ||
    body.indexOf('just a moment') >= 0 ||
    body.indexOf('cf-chl-') >= 0 ||
    body.indexOf('challenge-platform') >= 0 ||
    body.indexOf('checking your browser') >= 0 ||
    body.indexOf('checking if the site connection is secure') >= 0 ||
    body.indexOf('attention required') >= 0 ||
    body.indexOf('enable javascript and cookies') >= 0;
}
function _fetchOnce(url, referer, timeoutMs, accept, browser) {
  return fetch(url, {
    headers: _headers(referer, accept),
    timeoutMs: timeoutMs || 12000,
    browser: browser === true
  }).then(function (r) {
    var response = {
      body: String(r && r.body || ''),
      headers: r && r.headers || {},
      status: r && r.status || 200
    };
    if (!r || (response.status >= 400 && !_isMomentPage(response))) {
      var err = new Error('HTTP ' + response.status);
      err.response = response;
      throw err;
    }
    return response;
  });
}
function _fetch(url, referer, timeoutMs, accept) {
  var sourceDomain = SITE_DOMAINS.filter(function (domain) {
    return String(url).indexOf(domain) === 0;
  })[0];
  var domains = sourceDomain ? SITE_DOMAINS : [''];
  var lastError = null;
  function tryDomain(i) {
    if (i >= domains.length) {
      return Promise.reject(lastError || new Error('Re:Anime: all supported domains failed'));
    }
    var domain = domains[i];
    var targetUrl = sourceDomain ? domain + String(url).slice(sourceDomain.length) : url;
    var targetReferer = sourceDomain && referer && String(referer).indexOf(sourceDomain) === 0
      ? domain + String(referer).slice(sourceDomain.length)
      : (referer || (domain || SITE) + '/home');
    return _fetchOnce(targetUrl, targetReferer, Math.min(timeoutMs || 12000, 7000), accept, false)
      .then(function (response) {
        if (!_isMomentPage(response)) return response;
        // Ask Zangetsu's native browser/Cloudflare lane to retry the challenge.
        return _fetchOnce(targetUrl, targetReferer, Math.min(timeoutMs || 12000, 7000), accept, true)
          .then(function (cleared) {
            if (_isMomentPage(cleared)) {
              var err = new Error('Re:Anime Cloudflare challenge remained after browser retry');
              err.response = cleared;
              throw err;
            }
            return cleared;
          });
      })
      .catch(function (err) {
        lastError = err;
        var response = err && err.response;
        if (response && !_isMomentPage(response) &&
            response.status < 500 && response.status !== 403 && response.status !== 429) {
          // A real client error (e.g. unknown anime slug) is not a domain outage.
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
 
// Preserve the upstream AniList ID verbatim. Never offset, increment, decrement,
// or coerce it through numeric arithmetic before calling /api/flix.
function _anilistId(o) {
  var raw = _first(o, ['anilist_id', 'anilistId', 'anilist']);
  var id = raw == null ? '' : String(raw).trim();
  if (/^\d+$/.test(id) && id !== '0') return id;

  // Re:Anime's API helper derives AniList IDs from cover_image URLs such as
  // .../bx12345-....jpg. Keep the captured ID verbatim; never add/subtract 1.
  var covers = o && o.cover_image;
  if (covers && typeof covers === 'object') {
    var keys = ['extra_large', 'large', 'medium'];
    for (var i = 0; i < keys.length; i++) {
      var match = String(covers[keys[i]] || '').match(/\/bx(\d+)-/i);
      if (match) return match[1];
    }
  }
  return '';
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
    anilistId: Number(_anilistId(o)) || undefined,
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
// Catalogue cards sometimes contain anilist_id=0 although the detail endpoint
// has the real ID. Fill a bounded batch so Zangetsu never needs to re-resolve
// those titles through AniList, which triggers the "having a moment" banner.
function _fillAnilistIds(items) {
  var missing = items.filter(function (it) { return !it.anilistId; }).slice(0, 8);
  if (!missing.length) return Promise.resolve(items);
  return Promise.all(missing.map(function (it) {
    return _detailData(it.id).then(function (d) {
      var data = d && (d.data || d.anime || d);
      var aid = Number(_anilistId(data));
      if (aid > 0) it.anilistId = aid;
    }).catch(function () { return null; });
  })).then(function () { return items; });
}
function search(query, page) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  var url = API + '/search?limit=36&offset=' + ((p - 1) * 36) + '&q=' + encodeURIComponent(q);
  return _json(url, SITE + '/search').then(_dedupeItems).then(_fillAnilistIds).catch(function () { return []; });
}
function getHome() {
  var latestUrl = API + '/home/latest-aired?limit=12';
  var popularUrl = API + '/search?sort=popularity_desc&limit=36&offset=0';
  return Promise.all([
    _json(latestUrl, SITE + '/home').catch(function () { return null; }),
    _json(popularUrl, SITE + '/search').catch(function () { return null; })
  ]).then(function (data) {
    return Promise.all([
      _fillAnilistIds(_dedupeItems(data[0])),
      _fillAnilistIds(_dedupeItems(data[1]))
    ]).then(function (filled) {
      var rows = [];
      if (filled[0].length) rows.push({ title: 'Latest Aired', items: filled[0] });
      if (filled[1].length) rows.push({ title: 'Popular Anime', items: filled[1] });
      return rows;
    });
  });
}
function popular() {
  return _json(API + '/search?sort=popularity_desc&limit=36&offset=0', SITE + '/search')
    .then(_dedupeItems).then(_fillAnilistIds).catch(function () { return []; });
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
    var anilistId = _anilistId(d);
    var item = _item(d) || { id: slug, url: slug, title: slug, type: 'anime', sourceId: SOURCE_ID };
    item.id = slug; item.url = slug;
    item.description = String(d.description || '');
    item.status = String(d.status || 'unknown').toLowerCase();
    item.genres = Array.isArray(d.genres) ? d.genres : [];
    var _yr = d.season_year || (d.start_date && d.start_date.year) || null;
    item.year = _yr ? String(_yr) : null; // MediaDetail parser expects year as a String.
    item.malId = Number(d.mal_id || 0) || undefined;
    item.anilistId = Number(anilistId) || item.anilistId;
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
function _flixDownloadHeaders() {
  return {
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': FLIX + '/'
  };
}

// Re:Anime's FlixCloud HLS needs a local proxy to decrypt segments. The old
// parse-flixcloud URL only rewrites a manifest and is not itself a hosted stream.
// Use the upstream Aniyomi extension's direct-download metadata path instead.
// FlixCloud's download is an MKV, and it must not be exposed as playable until
// the upstream progress/SSE endpoint reports "ready". A HEAD request to /download
// is not a readiness check: some hosts return 405 while the file is still building.
function _delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}
function _pollFlixDownload(meta, attempt) {
  var progressUrl = meta.base + '/download/' + meta.fileId +
    '/progress?token=' + encodeURIComponent(meta.token);
  return fetch(progressUrl, {
    headers: _flixDownloadHeaders(),
    timeoutMs: 5500
  }).then(function (r) {
    var status = Number(r && r.status || 0);
    var body = String(r && r.body || '');
    if (!r || status >= 400) {
      return { state: 'error', message: 'FlixCloud progress HTTP ' + status };
    }
    if (/"status"\s*:\s*"ready"/i.test(body) || /event:\s*ready\b/i.test(body)) {
      return { state: 'ready' };
    }
    if (/"status"\s*:\s*"failed"/i.test(body) || /event:\s*failed\b/i.test(body)) {
      return { state: 'failed', message: 'FlixCloud download generation failed' };
    }
    return { state: 'pending' };
  }).catch(function (e) {
    return { state: 'error', message: String(e && e.message || e) };
  }).then(function (result) {
    if (result.state === 'ready') return true;
    if (result.state === 'failed') throw new Error(result.message);
    // The endpoint is an SSE stream and may time out while the file is building.
    // Retry once, matching the maintained Aniyomi extension's bounded wait.
    if (attempt < 1 && (result.state === 'pending' ||
        !/HTTP 4(?:00|01|03|04)\b/.test(result.message || ''))) {
      return _delay(650).then(function () { return _pollFlixDownload(meta, attempt + 1); });
    }
    throw new Error(result.message || 'FlixCloud download is not ready');
  });
}
function _resolveFlixDownload(dataLink, label, kind) {
  var match = String(dataLink || '').match(/\/e\/([a-z0-9]+)/i);
  if (!match) return Promise.resolve([]);
  var embedId = match[1];
  var metadataUrl = FLIX + '/d/' + encodeURIComponent(embedId) + '/__data.json';
  return fetch(metadataUrl, {
    headers: _flixDownloadHeaders(),
    timeoutMs: 12000
  }).then(function (r) {
    if (!r || (r.status && r.status >= 400)) {
      throw new Error('FlixCloud download metadata HTTP ' + (r && r.status));
    }
    var body = String(r.body || '');
    var fileId = (body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
    var token = (body.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/) || [])[0];
    var base = (body.match(/https:\/\/fetch\d*\.flixcloud\.cc/i) || [])[0] || FLIX;
    var resolution = (body.match(/(\d{3,4}p)/i) || [])[1] || 'Auto';
    if (!fileId || !token) throw new Error('FlixCloud download metadata missing file ID/token');
    return {
      fileId: fileId,
      token: token,
      base: base,
      url: base + '/download/' + fileId + '?token=' + encodeURIComponent(token),
      resolution: resolution
    };
  }).then(function (meta) {
    return _pollFlixDownload(meta, 0).then(function () {
      return [{
        url: meta.url,
        quality: meta.resolution,
        label: (label || 'Re:Anime') + ' Download',
        // The upstream download endpoint serves the original MKV, not MP4.
        container: 'mkv',
        headers: _flixDownloadHeaders(),
        kind: kind || 'sub',
        audioLang: kind === 'dub' ? 'en' : 'ja',
        subtitles: []
      }];
    });
  }).catch(function () {
    // Never expose a not-yet-ready or failed download as a playable source.
    return [];
  });
}

function _serverAudio(server) {
  var type = String(server && server.dataType || '').toLowerCase();
  if (type === 'sub' || type === 's-sub' || type === 'softsub') return 'sub';
  if (type === 'dub' || type === 's-dub') return 'dub';
  return '';
}
function _mergeServers(watch, flix) {
  var out = [], seen = {};
  function add(list) {
    (Array.isArray(list) ? list : []).forEach(function (server) {
      if (!server || typeof server !== 'object') return;
      var link = String(_first(server, ['dataLink', 'url', 'link', 'src']) || '').trim();
      var key = link || String(_first(server, ['$id', 'id']) || '');
      if (!key || seen[key]) return;
      seen[key] = 1;
      out.push(server);
    });
  }
  // The site's watch API and /api/flix expose complementary server sets.
  add(watch && watch.episode_links);
  add(_arr(flix));
  return out;
}
function getVideoSources(episodeUrl, opts) {
  var parts = String(episodeUrl || '').split('|');
  var slug = parts[0] || '';
  var epNum = Number(parts[1] || 0);
  // Keep the AniList ID embedded by getDetail/getEpisodes exactly as received.
  // Do not increment, decrement, or apply arithmetic to it.
  var suppliedAid = String(parts[3] || '').trim();
  if (!slug || !(epNum > 0)) return Promise.resolve([]);
  var audio = opts && String(opts.category || '').toLowerCase() === 'dub' ? 'dub' : 'sub';
  var referer = SITE + '/watch/' + slug + '?ep=' + epNum;

  return _json(SITE + '/api/watch/' + encodeURIComponent(slug) + '/' + epNum, referer)
    .catch(function () { return null; })
    .then(function (watch) {
      var watchAnime = watch && watch.anime || {};
      var aid = /^\d+$/.test(suppliedAid) && suppliedAid !== '0'
        ? suppliedAid
        : _anilistId(watchAnime);
      var aidPromise = aid ? Promise.resolve(aid) :
        _detailData(slug).then(function (d) {
          var data = d && (d.data || d.anime || d);
          return _anilistId(data);
        }).catch(function () { return ''; });

      return aidPromise.then(function (anilistId) {
        // URL uses the exact ID string; it is deliberately not converted with +/-.
        var flixPromise = anilistId
          ? _json(FLIX_API + '/' + anilistId + '/' + epNum, referer).catch(function () { return null; })
          : Promise.resolve(null);
        return flixPromise.then(function (flix) {
          var servers = _mergeServers(watch, flix);
          var tasks = [];
          servers.forEach(function (server) {
            var serverType = _serverAudio(server);
            if (serverType && serverType !== audio) return;
            var label = '[' + (serverType || audio).toUpperCase() + '] ' +
              String(server.serverName || server.name || 'Re:Anime');
            var link = String(_first(server, ['dataLink', 'url', 'link', 'src']) || '');
            var direct = _directMedia(link, label, audio);
            if (direct) tasks.push(Promise.resolve([direct]));
            else if (/flixcloud/i.test(link) && /\/e\//i.test(link)) {
              tasks.push(_resolveFlixDownload(link, label, audio));
            }
          });
          return Promise.all(tasks).then(function (groups) {
            var out = [], seen = {};
            groups.forEach(function (group) {
              (group || []).forEach(function (stream) {
                if (!stream || !stream.url || seen[stream.url]) return;
                seen[stream.url] = 1;
                out.push(stream);
              });
            });
            return out;
          });
        });
      });
    }).catch(function () {
      return [];
    });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.2.6', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks
  };
}
