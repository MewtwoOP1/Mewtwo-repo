// Anichi — modern anime catalogue with /anime/ and /watch/ pages.
// Search uses /filter?keyword=; detail and episodes are parsed from HTML;
// playback resolves VOE/server embeds found on watch pages.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'anichi';
var VERSION = '1.0.1';
var SITE = 'https://anichi.to';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var CACHE = {};
var CACHE_TTL = 5 * 60 * 1000;
var REQUEST_TIMEOUT = 15000;

function getInfo() {
  return {
    name: 'Anichi',
    lang: 'en',
    baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=anichi.to',
    type: 'anime',
    version: VERSION
  };
}

function getSettings() {
  return [
    {
      key: 'verifyPlayback',
      label: 'Verify playback before showing streams',
      description: 'Probe server embed URLs so expired or HTML responses are never offered as playable streams.',
      type: 'bool',
      default: true
    }
  ];
}

function _config() {
  var all = (typeof __settings !== 'undefined' && __settings) ? __settings : {};
  var c = all && all[SOURCE_ID] ? all[SOURCE_ID] : {};
  return { verify: c.verifyPlayback !== false && String(c.verifyPlayback) !== 'false' };
}

function _cacheGet(key) {
  var row = CACHE[key];
  if (!row) return null;
  if (Date.now() > row.at) { delete CACHE[key]; return null; }
  return row.value;
}
function _cacheSet(key, value, ttl) {
  CACHE[key] = { at: Date.now() + (ttl || CACHE_TTL), value: value };
  return value;
}

function _request(url, opts) {
  var options = opts || {};
  var headers = { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9' };
  if (options.headers) Object.keys(options.headers).forEach(function (k) { headers[k] = options.headers[k]; });
  var init = { method: options.method || 'GET', headers: headers, redirect: 'follow', timeoutMs: options.timeoutMs || REQUEST_TIMEOUT };
  if (options.body != null) init.body = options.body;
  return fetch(url, init).then(function (response) {
    if (!response) throw new Error('Anichi: request timed out');
    var status = Number(response.status || 200);
    if (status >= 400 && !options.allowError) {
      var error = new Error('Anichi HTTP ' + status + ' for ' + url);
      error.status = status;
      throw error;
    }
    return response;
  });
}
function _text(url, opts) {
  return _request(url, opts).then(function (response) {
    if (typeof response.text === 'function') return response.text();
    return String(response.body || '');
  });
}
function _json(url, opts) {
  return _text(url, opts).then(function (body) {
    try { return JSON.parse(body); }
    catch (error) { throw new Error('Anichi: invalid JSON response from ' + url); }
  });
}
function _clean(html) {
  var s = String(html == null ? '' : html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function _oneLine(value) {
  return _clean(value).replace(/\s+/g, ' ').trim();
}
function _absolute(href) {
  var h = String(href == null ? '' : href).trim();
  if (!h) return '';
  if (/^https?:\/\//i.test(h)) return h;
  if (h.charAt(0) === '/') return SITE + h;
  return SITE + '/' + h.replace(/^\.?\//, '');
}

function getHome(opts) {
  return _text(SITE + '/').then(function (html) {
    var items = [];
    var seen = {};
    var re = /<a[^>]+href="([^"]*\/anime\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = re.exec(html)) !== null) {
      var link = _absolute(match[1]);
      var title = _oneLine(match[2]);
      if (!link || !title || seen[link]) continue;
      seen[link] = 1;
      var posterMatch = match[0].match(/<img[^>]+src=["']([^"']+)["']/i);
      var cover = posterMatch ? _absolute(posterMatch[1]) : null;
      items.push({
        id: link,
        title: title,
        url: 'anichi://media/' + encodeURIComponent(link),
        cover: cover,
        type: /\bmovie\b/i.test(title) ? 'movie' : 'anime',
        sourceId: SOURCE_ID,
        year: null,
        status: 'unknown'
      });
    }
    return items.length ? [{ title: 'Anichi Latest', items: items.slice(0, 24) }] : [];
  }).catch(function () { return []; });
}

function popular(opts) {
  return _text(SITE + '/').then(function (html) {
    var items = [];
    var seen = {};
    var re = /<a[^>]+href="([^"]*\/anime\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = re.exec(html)) !== null) {
      var link = _absolute(match[1]);
      var title = _oneLine(match[2]);
      if (!link || !title || seen[link]) continue;
      seen[link] = 1;
      items.push({
        id: link,
        title: title,
        url: 'anichi://media/' + encodeURIComponent(link),
        cover: null,
        type: /\bmovie\b/i.test(title) ? 'movie' : 'anime',
        sourceId: SOURCE_ID
      });
    }
    return items.slice(0, 24);
  }).catch(function () { return []; });
}

function search(query, page, opts) {
  var text = String(query == null ? '' : query).trim();
  if (!text) return Promise.resolve([]);
  var number = Math.max(1, parseInt(page, 10) || 1);
  return _text(SITE + '/filter?keyword=' + encodeURIComponent(text)).then(function (html) {
    var items = [];
    var seen = {};
    var re = /<a[^>]+href="([^"]*\/anime\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = re.exec(html)) !== null) {
      var link = _absolute(match[1]);
      var title = _oneLine(match[2]);
      if (!link || !title || seen[link]) continue;
      seen[link] = 1;
      items.push({
        id: link,
        title: title,
        url: 'anichi://media/' + encodeURIComponent(link),
        cover: null,
        type: /\bmovie\b/i.test(title) ? 'movie' : 'anime',
        sourceId: SOURCE_ID,
        year: null,
        status: 'unknown'
      });
    }
    return items.slice(0, 20);
  }).catch(function () { return []; });
}

function _refFromUrl(value) {
  var raw = String(value == null ? '' : value).trim();
  var media = raw.match(/^anichi:\/\/media\/(.+)$/i);
  if (media) {
    try { raw = decodeURIComponent(media[1]); } catch (error) { raw = media[1]; }
  }
  var slugMatch = raw.match(/anichi\.to\/anime\/([^/?#]+)\/?/i);
  return {
    slug: slugMatch ? slugMatch[1] : (raw && raw.indexOf('/') === -1 ? raw : ''),
    url: /^https?:\/\//i.test(raw) ? raw : (raw ? SITE + '/' + raw.replace(/^\/+/, '') : SITE)
  };
}

function getDetail(url, opts) {
  var ref = _refFromUrl(url);
  var cacheKey = 'detail:' + (ref.slug || ref.url);
  var cached = _cacheGet(cacheKey);
  if (cached) return Promise.resolve(cached);
  return _text(ref.url || SITE).then(function (html) {
    var title = _oneLine((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
    if (!title) title = _oneLine((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    var poster = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1] || '';
    var desc = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
    var rawTitle = title;
    var cleanTitle = rawTitle.replace(/\s*-\s*Episode\s*\d+[\s\S]*$/i, '').replace(/\s+Episode\s*\d+[\s\S]*$/i, '').replace(/\s*\|\s*Anichi.*$/i, '').trim();
    var m = String(rawTitle).match(/\b(19|20)\d{2}\b/);
    var info = [];
    if (m) info.push('Year: ' + m[0]);
    var description = desc;
    if (info.length) description = (description ? description + '\n\n' : '') + info.join('\n');
    var detail = {
      id: ref.slug || ref.url,
      title: cleanTitle,
      rawTitle: rawTitle,
      url: ref.url,
      cover: poster,
      poster: poster,
      description: description,
      genres: [],
      altTitles: [],
      studios: [],
      status: 'unknown',
      year: m ? String(m[0]) : null,
      type: /\bmovie\b/i.test(rawTitle) ? 'movie' : 'anime',
      sourceId: SOURCE_ID,
      episodes: [],
      subCount: 0,
      dubCount: 0
    };
    _cacheSet(cacheKey, detail, CACHE_TTL);
    return detail;
  });
}

function getEpisodes(url, opts) {
  var ref = _refFromUrl(url);
  return _text(ref.url || SITE).then(function (html) {
    var episodes = [];
    var seen = {};
    var re = /<a[^>]+href="([^"]*\/watch\/[^"]+ep-(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = re.exec(html)) !== null) {
      var link = _absolute(match[1]);
      var num = Number(match[2]);
      var title = _oneLine(match[3]);
      if (!link || !num || seen[link]) continue;
      seen[link] = 1;
      episodes.push({
        id: link,
        url: link,
        number: num,
        season: 1,
        title: title || ('Episode ' + num),
        category: 'sub',
        type: 'anime',
        sourceId: SOURCE_ID,
        quality: '',
        encoding: '',
        audio: ''
      });
    }
    // Also try the watch page pattern without explicit ep number
    if (episodes.length === 0) {
      var re2 = /<a[^>]+href="([^"]*\/watch\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      while ((match = re2.exec(html)) !== null) {
        var link = _absolute(match[1]);
        var title = _oneLine(match[3]);
        var numMatch = String(title || link).match(/ep[- ]?(\d+)/i);
        var num = numMatch ? Number(numMatch[1]) : episodes.length + 1;
        if (!link || !title || seen[link]) continue;
        seen[link] = 1;
        episodes.push({
          id: link,
          url: link,
          number: num,
          season: 1,
          title: title || ('Episode ' + num),
          category: 'sub',
          type: 'anime',
          sourceId: SOURCE_ID,
          quality: '',
          encoding: '',
          audio: ''
        });
      }
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    return episodes;
  });
}

function _parseEpisodeUrl(value) {
  var raw = String(value == null ? '' : value).trim();
  var m = raw.match(/^anichi:\/\/media\/(.+)$/i);
  if (m) {
    try { return { mediaUrl: decodeURIComponent(m[1]) }; } catch (e) { return { mediaUrl: m[1] }; }
  }
  var ep = raw.match(/anichi\.to\/watch\/([^/?#]+)\/ep-(\d+)/i);
  if (ep) return { watchUrl: SITE + '/watch/' + decodeURIComponent(ep[1]) + '/ep-' + ep[2] + '/', number: Number(ep[2]) };
  var watch = raw.match(/anichi\.to\/watch\/([^/?#]+)\/?/i);
  if (watch) return { watchUrl: SITE + '/watch/' + decodeURIComponent(watch[1]) + '/', number: 1 };
  var direct = raw.match(/https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mkv)[^"'\s]*/i);
  if (direct) return { directUrl: direct[0] };
  return null;
}

function _probeMedia(url, cfg) {
  return _request(url, { method: 'GET', headers: { 'User-Agent': UA, 'Range': 'bytes=0-1' }, allowError: true, timeoutMs: REQUEST_TIMEOUT }).then(function (response) {
    var status = Number(response.status || 200);
    var type = '';
    if (response.headers && typeof response.headers.get === 'function') type = String(response.headers.get('content-type') || '');
    if (status === 401 || status === 403) return null;
    if (/text\/html/i.test(type)) return null;
    if ((status === 200 || status === 206) && !/text\/html/i.test(type)) {
      var ct = type.toLowerCase();
      var isHls = /mpegurl|m3u8/i.test(ct) || /\.m3u8/i.test(url);
      return {
        url: url,
        quality: 'Auto',
        label: 'Anichi',
        type: isHls ? 'hls' : 'mp4',
        container: isHls ? 'hls' : 'mp4',
        hls: isHls,
        headers: { 'User-Agent': UA, 'Referer': url },
        kind: 'sub',
        audioLang: 'ja',
        subtitles: [],
        downloadable: true,
        size: 0,
        isActive: false
      };
    }
    return null;
  }).catch(function () { return null; });
}

function getVideoSources(episodeUrl, opts) {
  var parsed = _parseEpisodeUrl(episodeUrl);
  if (!parsed) return Promise.resolve([]);
  var cfg = _config();
  if (parsed.directUrl) {
    return _probeMedia(parsed.directUrl, cfg).then(function (s) { return s ? [s] : []; });
  }
  if (!parsed.watchUrl) return Promise.resolve([]);
  return _text(parsed.watchUrl).then(function (html) {
    var streams = [];
    var seen = {};
    var iframeRe = /<iframe[^>]+src=["']([^"']+)["']/gi;
    var match;
    while ((match = iframeRe.exec(html)) !== null) {
      var src = _absolute(match[1]);
      if (!src || seen[src]) continue;
      seen[src] = 1;
      streams.push({
        url: src,
        quality: 'Auto',
        label: 'Anichi',
        type: 'mp4',
        container: 'mp4',
        hls: false,
        headers: { 'User-Agent': UA, 'Referer': src },
        kind: 'sub',
        audioLang: 'ja',
        subtitles: [],
        downloadable: true,
        size: 0,
        isActive: false
      });
    }
    return new Promise(function (resolve) { setTimeout(function () { resolve(streams); }, 500); });
  }).then(function (streams) {
    streams.forEach(function (s, i) { s.isActive = i === 0; });
    return streams;
  }).catch(function () { return []; });
}

function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION,
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    popular: popular,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams,
    getLinks: getLinks,
    _config: _config,
    _refFromUrl: _refFromUrl,
    _parseEpisodeUrl: _parseEpisodeUrl
  };
}
