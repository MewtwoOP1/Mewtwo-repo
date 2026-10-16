// Movies2Watch source for Zangetsu.
// Reads public catalog/detail HTML and resolves openly exposed direct media URLs.
// It does not execute page JavaScript or bypass DRM, login gates, or protected players.

var SITE = 'https://movies2watch.vc';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'movies2watch';
var VERSION = '1.0.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
var EMBED_LIMIT = 8;
var MAX_DEPTH = 2;

function getInfo() {
  return {
    name: 'Movies2Watch',
    lang: 'en',
    baseUrl: SITE,
    logo: 'https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/assets/icon.svg',
    type: 'movie',
    version: VERSION
  };
}
function getSettings() { return []; }
function _trim(value) { return String(value == null ? '' : value).replace(/^\s+|\s+$/g, ''); }

function _decode(value) {
  return String(value == null ? '' : value)
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'").replace(/&#x2f;/gi, '/')
    .replace(/&#x26;/gi, '&').replace(/&#x3d;/gi, '=')
    .replace(/&nbsp;/gi, ' ').replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=').replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\');
}
function _text(html) {
  return _decode(String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}
function _attr(tag, name) {
  var re = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))', 'i');
  var m = String(tag || '').match(re);
  return m ? _decode(m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3])) : '';
}
function _abs(href, base) {
  var value = _decode(_trim(href)).replace(/^['"]|['"]$/g, '');
  if (!value || /^(?:javascript|data|mailto|tel):/i.test(value)) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.indexOf('//') === 0) return 'https:' + value;
  var origin = (String(base || SITE).match(/^(https?:\/\/[^/]+)/i) || [])[1] || SITE;
  if (value.charAt(0) === '/') return origin + value;
  var dir = String(base || SITE + '/').replace(/[?#].*$/, '');
  dir = dir.substring(0, dir.lastIndexOf('/') + 1);
  return dir + value;
}
function _get(url, referer) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Referer': referer || SITE + '/'
    },
    timeoutMs: 15000
  }).then(function (response) {
    if (response && response.status && response.status >= 400) throw new Error('HTTP ' + response.status);
    return response && response.body != null ? String(response.body) : '';
  });
}
function _uniqItems(items) {
  var out = [], seen = {};
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!item || !item.url || seen[item.url]) continue;
    seen[item.url] = true;
    out.push(item);
  }
  return out;
}
function _cleanTitle(value) {
  var title = _text(value || '');
  title = title.replace(/^\s*watch\s+/i, '');
  title = title.replace(/\s*(?:\||-|–|:)\s*Movies2Watch.*$/i, '');
  title = title.replace(/\s+online\s+free(?:\s+on\s+Movies2Watch)?\s*$/i, '');
  return _trim(title);
}
function _meta(html, key) {
  var re = /<meta\b[^>]*>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var tag = m[0];
    var ident = _attr(tag, 'property') || _attr(tag, 'name');
    if (ident.toLowerCase() === String(key).toLowerCase()) return _attr(tag, 'content');
  }
  return '';
}
function _card(anchor, base) {
  var open = (String(anchor).match(/^<a\b[^>]*>/i) || [''])[0];
  var href = _attr(open, 'href');
  var url = _abs(href, base);
  if (!url || !/\/(?:movie|series)\//i.test(url) || /\/(?:movie|series)\/?$/i.test(url)) return null;
  var imageTag = (String(anchor).match(/<img\b[^>]*>/i) || [''])[0];
  var title = _attr(open, 'data-title') || _attr(open, 'aria-label') ||
    _attr(open, 'title') || _attr(imageTag, 'alt') || '';
  if (!title) title = _text(String(anchor).replace(/<img\b[^>]*>/gi, ''));
  title = _cleanTitle(title);
  if (!title || /^(?:watch|play|details|more)$/i.test(title)) return null;
  var poster = _attr(imageTag, 'data-src') || _attr(imageTag, 'data-lazy-src') ||
    _attr(imageTag, 'src') || _attr(open, 'data-image') || '';
  poster = poster ? _abs(poster, base) : '';
  return { id: url, title: title, cover: poster || null, url: url, type: 'movie', sourceId: SOURCE_ID };
}
function _cards(html, base) {
  var out = [], re = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var item = _card(m[0], base);
    if (item) out.push(item);
  }
  return _uniqItems(out);
}
function _pageUrl(path) { return SITE + (path.charAt(0) === '/' ? path : '/' + path); }

function getHome(opts) {
  var pages = [
    { title: 'Latest Movies and Series', path: '/' },
    { title: 'Movies', path: '/movie/' },
    { title: 'Series', path: '/series/' }
  ];
  return Promise.all(pages.map(function (page) {
    return _get(_pageUrl(page.path), SITE + '/').then(function (html) {
      return { title: page.title, items: _cards(html, SITE + '/') };
    }).catch(function () { return { title: page.title, items: [] }; });
  })).then(function (rows) { return rows.filter(function (row) { return row.items.length > 0; }); });
}
function popular(opts) {
  return getHome(opts).then(function (sections) {
    var all = [];
    sections.forEach(function (section) { all = all.concat(section.items || []); });
    return _uniqItems(all);
  });
}
function _searchUrls(query, page) {
  var q = encodeURIComponent(query || ''), p = Math.max(1, parseInt(page, 10) || 1);
  var suffix = p > 1 ? '&page=' + p : '';
  return [
    _pageUrl('/?s=' + q + suffix),
    _pageUrl('/?q=' + q + suffix),
    _pageUrl('/search?query=' + q + (p > 1 ? '&page=' + p : '')),
    _pageUrl('/search?keyword=' + q + (p > 1 ? '&page=' + p : '')),
    _pageUrl('/search?q=' + q + (p > 1 ? '&page=' + p : ''))
  ];
}
function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var urls = _searchUrls(q, page), index = 0;
  function next() {
    if (index >= urls.length) return Promise.resolve([]);
    var url = urls[index++];
    return _get(url, SITE + '/').then(function (html) {
      var found = _cards(html, url);
      return found.length ? found : next();
    }).catch(function () { return next(); });
  }
  return next();
}
function _parseYear(html, title) {
  var date = _meta(html, 'article:published_time') || _meta(html, 'datePublished') ||
    _meta(html, 'release_date') || '';
  var match = String(date + ' ' + _text(html)).match(/\b(19\d{2}|20\d{2})\b/);
  if (!match) match = String(title || '').match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}
function _parseIds(html) {
  var all = String(html || '');
  var tmdb = (all.match(/(?:data-tmdb-id|data-tmdb|tmdb[_-]?id)\s*=\s*["']?(\d+)/i) || [])[1];
  var imdb = (all.match(/\b(tt\d{6,12})\b/i) || [])[1];
  return { tmdbId: tmdb ? parseInt(tmdb, 10) : null, imdbId: imdb || null };
}
function _episodeNumber(value) {
  var s = String(value || '');
  var m = s.match(/(?:season|s)\s*0?(\d{1,2})[\s,._:/-]*(?:episode|ep|e)\s*0?(\d{1,3})/i);
  if (m) return { season: parseInt(m[1], 10) || 1, episode: parseInt(m[2], 10) || 1 };
  m = s.match(/(?:season|s)[\s._:/-]*0?(\d{1,2}).{0,24}(?:episode|ep|e)[\s._:/-]*0?(\d{1,3})/i);
  if (m) return { season: parseInt(m[1], 10) || 1, episode: parseInt(m[2], 10) || 1 };
  m = s.match(/episode[\s._:#/-]*0?(\d{1,3})/i);
  if (m) return { season: 1, episode: parseInt(m[1], 10) || 1 };
  return null;
}
function _episodes(html, pageUrl) {
  var out = [], re = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var anchor = m[0], open = (anchor.match(/^<a\b[^>]*>/i) || [''])[0];
    var href = _attr(open, 'href'), label = _trim(_text(anchor));
    var hint = [_attr(open, 'title'), _attr(open, 'aria-label'), _attr(open, 'data-season'),
      _attr(open, 'data-episode'), _attr(open, 'data-number'), href, label].join(' ');
    var nums = _episodeNumber(hint);
    if (!nums) {
      var ds = parseInt(_attr(open, 'data-season'), 10);
      var de = parseInt(_attr(open, 'data-episode') || _attr(open, 'data-number'), 10);
      if (de > 0) nums = { season: ds > 0 ? ds : 1, episode: de };
    }
    if (!nums || !href) continue;
    var url = _abs(href, pageUrl);
    if (!url || url === pageUrl || !/\/(?:movie|series)\//i.test(url)) continue;
    out.push({
      id: 'S' + nums.season + 'E' + nums.episode,
      title: 'S' + _pad(nums.season) + ' E' + _pad(nums.episode) +
        (label && !/^episode\s*\d+$/i.test(label) ? ' · ' + label : ''),
      number: nums.episode, season: nums.season, url: url
    });
  }
  if (!out.length) {
    var current = _episodeNumber(_text(html));
    if (current) out.push({
      id: 'S' + current.season + 'E' + current.episode,
      title: 'S' + _pad(current.season) + ' E' + _pad(current.episode),
      number: current.episode, season: current.season, url: pageUrl
    });
  }
  out.sort(function (a, b) {
    if (a.season !== b.season) return a.season - b.season;
    return a.number - b.number;
  });
  var seen = {};
  return out.filter(function (episode) {
    var key = episode.season + 'x' + episode.number + '|' + episode.url;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}
function _pad(value) { var n = parseInt(value, 10) || 0; return n < 10 ? '0' + n : String(n); }
function _parseDetail(html, url) {
  var title = _cleanTitle(_meta(html, 'og:title') || _meta(html, 'twitter:title') ||
    (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  if (!title) title = url.split('/').filter(Boolean).pop().replace(/-\d+\/?$/, '').replace(/-/g, ' ');
  var description = _text(_meta(html, 'og:description') || _meta(html, 'description') || '');
  var cover = _meta(html, 'og:image') || _meta(html, 'twitter:image') ||
    (html.match(/<img\b[^>]*(?:poster|cover)[^>]*>/i) ?
      _attr((html.match(/<img\b[^>]*(?:poster|cover)[^>]*>/i) || [''])[0], 'src') : '');
  cover = cover ? _abs(cover, url) : '';
  var type = /\/series\//i.test(url) ? 'series' : 'movie';
  var episodes = type === 'series' ? _episodes(html, url) : [{ id: 'movie', title: title, number: 1, url: url }];
  var ids = _parseIds(html);
  return {
    id: url, title: title, cover: cover || null, url: url, description: description,
    status: 'unknown', genres: [], studios: [], type: 'movie', sourceId: SOURCE_ID,
    year: _parseYear(html, title), episodes: episodes, subCount: episodes.length, dubCount: 0,
    tmdbId: ids.tmdbId, imdbId: ids.imdbId, tmdbIsTv: type === 'series'
  };
}
function getDetail(url, opts) {
  var value = typeof url === 'string' ? url : (url && (url.url || url.id)) || '';
  var target = _abs(value, SITE + '/');
  if (!target || !/\/(?:movie|series)\//i.test(target)) return Promise.resolve(null);
  return _get(target, SITE + '/').then(function (html) { return html ? _parseDetail(html, target) : null; });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) {
    return detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  });
}
function _isHttp(url) { return /^https?:\/\//i.test(String(url || '')); }
function _isMedia(url) { return /\.(?:m3u8|mp4|m4v|mov|webm)(?:[?#]|$)/i.test(String(url || '')); }
function _quality(url, context) {
  var m = String(context || '').match(/\b(2160p|1440p|1080p|720p|576p|540p|480p|360p|4k)\b/i) ||
    String(url || '').match(/\b(2160p|1440p|1080p|720p|576p|540p|480p|360p|4k)\b/i);
  if (!m) return 'Auto';
  return m[1].toLowerCase() === '4k' ? '2160p' : m[1].toLowerCase();
}
function _mediaSource(url, pageUrl, context) {
  var clean = _decode(url).replace(/^[\s"']+|[\s"',;)}\]]+$/g, '');
  if (!_isHttp(clean) || !_isMedia(clean)) return null;
  return {
    url: clean, quality: _quality(clean, context),
    container: /\.m3u8(?:[?#]|$)/i.test(clean) ? 'hls' : 'mp4',
    headers: { 'User-Agent': UA, 'Referer': pageUrl || SITE + '/' },
    kind: 'raw', label: 'Movies2Watch'
  };
}
function _directSources(html, pageUrl) {
  var body = _decode(String(html || '')), out = [], seen = {}, m;
  var tags = /<(?:source|video)\b[^>]*>/gi;
  while ((m = tags.exec(body)) !== null) {
    var tag = m[0], src = _attr(tag, 'src') || _attr(tag, 'data-src');
    if (!src) continue;
    var source = _mediaSource(_abs(src, pageUrl), pageUrl, tag);
    if (source && !seen[source.url]) { seen[source.url] = 1; out.push(source); }
  }
  var re = /https?:\\?\/\\?\/[^"'<>\\\s]+?\.(?:m3u8|mp4|m4v|mov|webm)(?:\?[^"'<>\\\s]*)?/gi;
  while ((m = re.exec(body)) !== null) {
    var source2 = _mediaSource(m[0], pageUrl, body.slice(Math.max(0, m.index - 100), m.index + 150));
    if (source2 && !seen[source2.url]) { seen[source2.url] = 1; out.push(source2); }
  }
  return out;
}
function _iframeUrls(html, pageUrl) {
  var out = [], seen = {}, re = /<iframe\b[^>]*>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var tag = m[0], raw = _attr(tag, 'src') || _attr(tag, 'data-src') ||
      _attr(tag, 'data-lazy-src') || _attr(tag, 'data-url') || _attr(tag, 'data-embed');
    if (!raw) continue;
    var url = _abs(raw, pageUrl);
    if (!_isHttp(url) || _isMedia(url)) continue;
    if (/(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com|doubleclick\.net|googlesyndication\.com|google-analytics\.com|recaptcha|facebook\.com\/plugins)/i.test(url)) continue;
    if (seen[url]) continue;
    seen[url] = true;
    out.push(url);
    if (out.length >= EMBED_LIMIT) break;
  }
  return out;
}
function _crawl(url, referer, depth, visited) {
  if (!_isHttp(url) || depth > MAX_DEPTH || visited[url]) return Promise.resolve([]);
  visited[url] = true;
  return _get(url, referer).then(function (html) {
    var direct = _directSources(html, url);
    if (depth >= MAX_DEPTH) return direct;
    var frames = _iframeUrls(html, url);
    return Promise.all(frames.map(function (frameUrl) {
      return _crawl(frameUrl, url, depth + 1, visited);
    })).then(function (nested) {
      var out = direct.slice();
      nested.forEach(function (list) { out = out.concat(list || []); });
      return out;
    });
  }).catch(function () { return []; });
}
function getVideoSources(episodeUrl, opts) {
  var value = typeof episodeUrl === 'string' ? episodeUrl :
    (episodeUrl && (episodeUrl.url || episodeUrl.id)) || '';
  var target = _abs(value, SITE + '/');
  if (!target) return Promise.reject(new Error('Movies2Watch: invalid episode URL'));
  return _crawl(target, SITE + '/', 0, {}).then(function (sources) {
    var out = _uniqItems(sources || []);
    if (!out.length) throw new Error('Movies2Watch: no direct media URL exposed in page HTML; this player may require JavaScript or an unsupported host');
    return out;
  });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams,
    getLinks: getLinks, _cards: _cards, _parseDetail: _parseDetail,
    _episodes: _episodes, _directSources: _directSources, _iframeUrls: _iframeUrls,
    _searchUrls: _searchUrls
  };
}
