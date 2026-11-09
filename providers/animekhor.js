// AnimeKhor — WordPress anime catalogue.
// Search/detail use the WordPress REST API; episodes are parsed from the
// anime detail page HTML; playback resolves direct media links.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animekhor';
var VERSION = '1.0.1';
var SITE = 'https://animekhor.org';
var API = SITE + '/wp-json/wp/v2';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var CACHE = {};
var CACHE_TTL = 5 * 60 * 1000;
var REQUEST_TIMEOUT = 15000;

function getInfo() {
  return {
    name: 'AnimeKhor',
    lang: 'en',
    baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animekhor.org',
    type: 'anime',
    version: VERSION
  };
}

function getSettings() {
  return [
    {
      key: 'verifyPlayback',
      label: 'Verify playback before showing streams',
      description: 'Probe media URLs so expired or HTML responses are never offered as playable streams.',
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
    if (!response) throw new Error('AnimeKhor: request timed out');
    var status = Number(response.status || 200);
    if (status >= 400 && !options.allowError) {
      var error = new Error('AnimeKhor HTTP ' + status + ' for ' + url);
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
    catch (error) { throw new Error('AnimeKhor: invalid JSON response from ' + url); }
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
  return _json(API + '/posts?per_page=24&_embed=1').then(function (rows) {
    var items = (Array.isArray(rows) ? rows : []).map(function (row) {
      var media = row._embedded && row._embedded['wp:featuredmedia'];
      var cover = null;
      if (Array.isArray(media) && media.length && media[0].source_url) cover = media[0].source_url;
      var title = _oneLine(row.title && row.title.rendered);
      if (!title) return null;
      return {
        id: String(row.id),
        title: title,
        url: 'animekhor://media/' + encodeURIComponent(row.link || ''),
        cover: cover,
        type: /\bmovie\b/i.test(title) ? 'movie' : 'anime',
        sourceId: SOURCE_ID,
        year: null,
        status: 'unknown'
      };
    }).filter(Boolean);
    return items.length ? [{ title: 'AnimeKhor Latest', items: items }] : [];
  }).catch(function () { return []; });
}

function popular(opts) {
  return _json(API + '/posts?per_page=24&_embed=1').then(function (rows) {
    return (Array.isArray(rows) ? rows : []).map(function (row) {
      var media = row._embedded && row._embedded['wp:featuredmedia'];
      var cover = null;
      if (Array.isArray(media) && media.length && media[0].source_url) cover = media[0].source_url;
      var title = _oneLine(row.title && row.title.rendered);
      if (!title) return null;
      return {
        id: String(row.id),
        title: title,
        url: 'animekhor://media/' + encodeURIComponent(row.link || ''),
        cover: cover,
        type: /\bmovie\b/i.test(title) ? 'movie' : 'anime',
        sourceId: SOURCE_ID
      };
    }).filter(Boolean);
  }).catch(function () { return []; });
}

function search(query, page, opts) {
  var text = String(query == null ? '' : query).trim();
  if (!text) return Promise.resolve([]);
  var number = Math.max(1, parseInt(page, 10) || 1);
  // Use HTML search with a longer timeout since the WP REST 'search' param
  // returns 0 results on this site but HTML search works fine.
  return _text(SITE + '/?s=' + encodeURIComponent(text) + (number > 1 ? '&paged=' + number : ''), { timeoutMs: 30000 }).then(function (html) {
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
        url: 'animekhor://media/' + encodeURIComponent(link),
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
  var media = raw.match(/^animekhor:\/\/media\/(.+)$/i);
  if (media) {
    try { raw = decodeURIComponent(media[1]); } catch (error) { raw = media[1]; }
  }
  var slugMatch = raw.match(/animekhor\.org\/([^/?#]+)\/?/i);
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
  return _json(API + '/posts?slug=' + encodeURIComponent(ref.slug) + '&_embed=1').then(function (rows) {
    var row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || !row.id) throw new Error('AnimeKhor: post not found');
    var media = row._embedded && row._embedded['wp:featuredmedia'];
    var cover = null;
    if (Array.isArray(media) && media.length && media[0].source_url) cover = media[0].source_url;
    var content = String(row.content && row.content.rendered || '');
    var synopsis = _oneLine(content);
    var description = synopsis;
    var terms = row._embedded && row._embedded['wp:term'];
    var genres = [];
    if (Array.isArray(terms)) {
      terms.forEach(function (group) {
        if (!Array.isArray(group)) return;
        group.forEach(function (term) {
          if (!term || term.taxonomy !== 'category' || !term.name) return;
          var name = _oneLine(term.name);
          if (['Anime Movie', 'Anime Series', 'Ongoing Anime', 'Chinese Anime', 'Uncategorized'].indexOf(name) === -1) {
            if (genres.indexOf(name) === -1) genres.push(name);
          }
        });
      });
    }
    if (row.excerpt && row.excerpt.rendered) description = _oneLine(row.excerpt.rendered);
    var rawTitle = _oneLine(row.title && row.title.rendered);
    var info = [];
    var m = String(rawTitle).match(/\b(19|20)\d{2}\b/);
    if (m) info.push('Year: ' + m[0]);
    if (genres.length) info.push('Genres: ' + genres.join(', '));
    if (info.length) description = (description ? description + '\n\n' : '') + info.join('\n');
    var detail = {
      id: String(row.id),
      title: rawTitle.replace(/\s*-\s*Episode\s*\d+[\s\S]*$/i, '').replace(/\s+Episode\s*\d+[\s\S]*$/i, ''),
      rawTitle: rawTitle,
      url: row.link || ref.url,
      cover: cover,
      poster: cover,
      description: description,
      genres: genres,
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
    var re = /<a[^>]+href="([^"]*\/anime\/[^"]+)"[^>]*>([^<]*)/gi;
    var match;
    while ((match = re.exec(html)) !== null) {
      var link = _absolute(match[1]);
      var title = _oneLine(match[3]);
      if (!link || !title || seen[link]) continue;
      seen[link] = 1;
      var numMatch = String(title || link).match(/[Ee]pisode\s*(\d+)/i) || String(link).match(/episode-(\d+)/i);
      var num = numMatch ? Number(numMatch[1]) : episodes.length + 1;
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
    episodes.sort(function (a, b) { return a.number - b.number; });
    return episodes;
  });
}

function _parseEpisodeUrl(value) {
  var raw = String(value == null ? '' : value).trim();
  var m = raw.match(/^animekhor:\/\/media\/(.+)$/i);
  if (m) {
    try { return { mediaUrl: decodeURIComponent(m[1]) }; } catch (e) { return { mediaUrl: m[1] }; }
  }
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
        label: 'AnimeKhor',
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
  if (!parsed.mediaUrl) return Promise.resolve([]);
  return _text(parsed.mediaUrl).then(function (html) {
    var streams = [];
    var seen = {};
    var videoRe = /(?:src|href|data-src)=["']([^"']*\.(?:mp4|m3u8|mkv)[^"']*)["']/gi;
    var match;
    while ((match = videoRe.exec(html)) !== null) {
      var src = _absolute(match[1]);
      if (!src || seen[src]) continue;
      seen[src] = 1;
      if (cfg.verify) {
        _probeMedia(src, cfg).then(function (s) { if (s) streams.push(s); });
      } else {
        streams.push({
          url: src,
          quality: 'Auto',
          label: 'AnimeKhor',
          type: /\.m3u8/i.test(src) ? 'hls' : 'mp4',
          container: /\.m3u8/i.test(src) ? 'hls' : 'mp4',
          hls: /\.m3u8/i.test(src),
          headers: { 'User-Agent': UA, 'Referer': src },
          kind: 'sub',
          audioLang: 'ja',
          subtitles: [],
          downloadable: true,
          size: 0,
          isActive: false
        });
      }
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
