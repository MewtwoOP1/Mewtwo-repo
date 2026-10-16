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
var MAX_PAGES = 12;

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
function _get(url, referer, extraHeaders) {
  var headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Referer': referer || SITE + '/'
  };
  var extra = extraHeaders || {};
  Object.keys(extra).forEach(function (key) { headers[key] = extra[key]; });
  return fetch(url, { headers: headers, timeoutMs: 15000 }).then(function (response) {
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
function _card(block, base) {
  var html = String(block || '');
  var re = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, m, open = '', href = '';
  while ((m = re.exec(html)) !== null) {
    var candidateOpen = (m[0].match(/^<a\b[^>]*>/i) || [''])[0];
    var candidateHref = _attr(candidateOpen, 'href');
    if (/\/(?:movie|series)\//i.test(candidateHref)) {
      open = candidateOpen;
      href = candidateHref;
      break;
    }
  }
  if (!href) {
    open = (html.match(/^<a\b[^>]*>/i) || [''])[0];
    href = _attr(open, 'href');
  }
  var url = _abs(href, base);
  if (!url || !/\/(?:movie|series)\//i.test(url) || /\/(?:movie|series)\/?$/i.test(url)) return null;
  var imageTag = (html.match(/<img\b[^>]*>/i) || [''])[0];
  var title = _attr(open, 'title') || _attr(open, 'data-title') || _attr(open, 'aria-label') ||
    _attr(imageTag, 'alt') || '';
  if (!title) title = _text(String(html).replace(/<img\b[^>]*>/gi, ''));
  title = _cleanTitle(title);
  if (!title || /^(?:watch|play|details|more)$/i.test(title)) return null;
  var poster = _attr(imageTag, 'data-src') || _attr(imageTag, 'data-lazy-src') ||
    _attr(imageTag, 'src') || _attr(open, 'data-image') || '';
  poster = poster ? _abs(poster, base) : '';
  return { id: url, title: title, cover: poster || null, url: url, type: 'movie', sourceId: SOURCE_ID };
}
function _cards(html, base) {
  var source = String(html || ''), out = [], starts = [], re = /<div\b[^>]*class\s*=\s*["'][^"']*\bflw-item\b[^"']*["'][^>]*>/gi, m;
  while ((m = re.exec(source)) !== null) starts.push(m.index);
  for (var i = 0; i < starts.length; i++) {
    var end = i + 1 < starts.length ? starts[i + 1] : source.length;
    var item = _card(source.slice(starts[i], end), base);
    if (item) out.push(item);
  }
  // Fallback for lightweight themes and mocked fixtures without .flw-item wrappers.
  if (!out.length) {
    var anchors = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, a;
    while ((a = anchors.exec(source)) !== null) {
      var item2 = _card(a[0], base);
      if (item2) out.push(item2);
    }
  }
  return _uniqItems(out);
}
function _pageUrl(path) { return SITE + (path.charAt(0) === '/' ? path : '/' + path); }

function _filterUrl(sort, page, keyword) {
  var query = 'sort=' + encodeURIComponent(sort) + '&order=desc&page=' + (Math.max(1, parseInt(page, 10) || 1));
  if (keyword != null && _trim(keyword)) query = 'type=all&keyword=' + encodeURIComponent(_trim(keyword)) + '&' + query;
  return _pageUrl('/filter.php?' + query);
}
function getHome(opts) {
  var latest = _filterUrl('updated', 1);
  var popularUrl = _filterUrl('rating', 1);
  return Promise.all([
    _get(latest, SITE + '/').then(function (html) {
      return { title: 'Latest Movies and Series', items: _cards(html, latest) };
    }).catch(function () { return { title: 'Latest Movies and Series', items: [] }; }),
    _get(popularUrl, SITE + '/').then(function (html) {
      return { title: 'Popular Movies and Series', items: _cards(html, popularUrl) };
    }).catch(function () { return { title: 'Popular Movies and Series', items: [] }; })
  ]).then(function (rows) { return rows.filter(function (row) { return row.items.length > 0; }); });
}
function popular(opts) {
  return getHome(opts).then(function (sections) {
    var all = [];
    sections.forEach(function (section) { all = all.concat(section.items || []); });
    return _uniqItems(all);
  });
}
function _searchUrls(query, page) {
  return [_filterUrl('updated', page, query)];
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
  var metaTmdb = _meta(all, 'tmdb_id') || _meta(all, 'tmdb-id') || _meta(all, 'tmdb');
  var metaImdb = _meta(all, 'imdb_id') || _meta(all, 'imdb-id') || _meta(all, 'imdb');
  var tmdb = (all.match(/(?:data-tmdb-id|data-tmdb|tmdb[_-]?id)\s*=\s*["']?(\d+)/i) || [])[1] ||
    ((String(metaTmdb).match(/^\d+$/) || [])[0] || '');
  var imdb = (all.match(/\b(tt\d{6,12})\b/i) || [])[1] ||
    ((String(metaImdb).match(/tt\d{6,12}/i) || [])[0] || '');
  return { tmdbId: tmdb ? parseInt(tmdb, 10) : null, imdbId: imdb || null };
}
function _episodeNumber(value) {
  var s = String(value || '');
  var m = s.match(/\/(\d{1,2})-(\d{1,3})\/?(?:[?#].*)?$/);
  if (m) return { season: parseInt(m[1], 10) || 1, episode: parseInt(m[2], 10) || 1 };
  m = s.match(/(?:season|s)\s*0?(\d{1,2})[\s,._:/-]*(?:episode|ep|e)\s*0?(\d{1,3})/i);
  if (m) return { season: parseInt(m[1], 10) || 1, episode: parseInt(m[2], 10) || 1 };
  m = s.match(/(?:season|s)[\s._:/-]*0?(\d{1,2}).{0,24}(?:episode|ep|e)[\s._:/-]*0?(\d{1,3})/i);
  if (m) return { season: parseInt(m[1], 10) || 1, episode: parseInt(m[2], 10) || 1 };
  m = s.match(/\bS(\d{1,2})E(\d{1,3})\b/i);
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
    var className = _attr(open, 'class');
    if (className && !/(?:eps-item|episode|ep-item)/i.test(className) &&
        !_episodeNumber(href + ' ' + label)) continue;
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
    if (!url || url === pageUrl || !/\/series\//i.test(url)) continue;
    out.push({
      id: 'S' + nums.season + 'E' + nums.episode,
      title: 'S' + _pad(nums.season) + ' E' + _pad(nums.episode) +
        (label && !/^episode\s*\d+$/i.test(label) ? ' · ' + label : ''),
      number: nums.episode, season: nums.season, url: url
    });
  }
  if (!out.length) {
    var current = _episodeNumber(String(pageUrl) + ' ' + _text(html));
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
function _seasonItems(html) {
  var out = [], re = /<(?:div|a|li)\b[^>]*class\s*=\s*["'][^"']*\bss-item\b[^"']*["'][^>]*>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var tag = m[0], id = _attr(tag, 'data-id');
    if (!id) continue;
    var season = parseInt(_attr(tag, 'data-ss'), 10) || (out.length + 1);
    out.push({ id: id, season: season, title: _trim(_attr(tag, 'title') || _attr(tag, 'aria-label')) });
  }
  return out;
}
function _loadSeriesEpisodes(html, pageUrl) {
  var seasons = _seasonItems(html);
  if (seasons.length) {
    return Promise.all(seasons.map(function (season) {
      var ajax = _pageUrl('/ajax/ajax.php?episode=' + encodeURIComponent(season.id));
      return _get(ajax, pageUrl, { 'X-Requested-With': 'XMLHttpRequest' })
        .then(function (fragment) {
          return _episodes(fragment, pageUrl).map(function (episode) {
            if (!episode.season || episode.season === 1) episode.season = season.season;
            episode.id = 'S' + episode.season + 'E' + episode.number;
            episode.title = (season.title ? season.title + ' · ' : '') +
              'S' + _pad(episode.season) + ' E' + _pad(episode.number);
            return episode;
          });
        }).catch(function () { return []; });
    })).then(function (groups) {
      var episodes = [];
      groups.forEach(function (group) { episodes = episodes.concat(group); });
      return _uniqueEpisodes(episodes);
    });
  }

  var current = (String(html || '').match(/(?:const\s+)?current_url\s*=\s*['"]([^'"]+)['"]/i) || [])[1];
  if (current) {
    var currentUrl = _abs(current, pageUrl);
    return _get(currentUrl, pageUrl, { 'X-Requested-With': 'XMLHttpRequest' })
      .then(function (fragment) { return _episodes(fragment, pageUrl); })
      .catch(function () { return _episodes(html, pageUrl); });
  }
  return Promise.resolve(_episodes(html, pageUrl));
}
function _uniqueEpisodes(items) {
  var out = [], seen = {};
  items.forEach(function (ep) {
    var key = ep.season + 'x' + ep.number + '|' + ep.url;
    if (!seen[key]) { seen[key] = true; out.push(ep); }
  });
  out.sort(function (a, b) {
    if (a.season !== b.season) return a.season - b.season;
    return a.number - b.number;
  });
  return out;
}
function _parseDetail(html, url, episodes) {
  var heading = (html.match(/<(?:h1|h2|h3)\b[^>]*class\s*=\s*["'][^"']*heading-name[^"']*["'][^>]*>([\s\S]*?)<\/(?:h1|h2|h3)>/i) || [])[1] ||
    (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
    (html.match(/<(?:h2|h3)\b[^>]*class\s*=\s*["'][^"']*film-name[^"']*["'][^>]*>([\s\S]*?)<\/(?:h2|h3)>/i) || [])[1] || '';
  var title = _cleanTitle(_meta(html, 'og:title') || _meta(html, 'twitter:title') || heading);
  if (!title) title = url.split('/').filter(Boolean).pop().replace(/-\d+\/?$/, '').replace(/-/g, ' ');
  var description = _text(
    (html.match(/<(?:div|p)\b[^>]*class\s*=\s*["'][^"']*(?:film-description|f-desc|description)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i) || [])[1] ||
    _meta(html, 'og:description') || _meta(html, 'description') || '');
  var posterTag = (html.match(/<img\b[^>]*(?:data-src|src)\s*=\s*["'][^"']+["'][^>]*>/i) || [''])[0];
  var cover = _meta(html, 'og:image') || _meta(html, 'twitter:image') ||
    _attr(posterTag, 'data-src') || _attr(posterTag, 'src') || '';
  cover = cover ? _abs(cover, url) : '';
  var type = /\/series\//i.test(url) ? 'series' : 'movie';
  var ids = _parseIds(html);
  var eps = type === 'series' ? (episodes || _episodes(html, url)) :
    [{ id: 'movie', title: title, number: 1, url: url }];
  return {
    id: url, title: title, cover: cover || null, url: url, description: description,
    status: 'unknown', genres: [], studios: [], type: 'movie', sourceId: SOURCE_ID,
    year: _parseYear(html, title), episodes: eps, subCount: eps.length, dubCount: 0,
    tmdbId: ids.tmdbId, imdbId: ids.imdbId, tmdbIsTv: type === 'series'
  };
}
function getDetail(url, opts) {
  var value = typeof url === 'string' ? url : (url && (url.url || url.id)) || '';
  var target = _abs(value, SITE + '/');
  if (!target || !/\/(?:movie|series)\//i.test(target)) return Promise.resolve(null);
  return _get(target, SITE + '/').then(function (html) {
    if (!html) return null;
    var type = /\/series\//i.test(target) ? 'series' : 'movie';
    if (type !== 'series') return _parseDetail(html, target, null);
    return _loadSeriesEpisodes(html, target).then(function (episodes) {
      return _parseDetail(html, target, episodes);
    }).catch(function () { return _parseDetail(html, target, _episodes(html, target)); });
  }).catch(function () { return null; });
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
function _looksLikePlayer(url) {
  return /\/(?:embed|player|stream|video|watch|e|v)(?:\/|[?#]|$)/i.test(url) ||
    /(?:vidsrc|vidlink|vidnest|filemoon|streamwish|dood|streamtape|mixdrop|vidcloud|vidplay|upstream|hydrax|2embed)/i.test(url);
}
function _iframeUrls(html, pageUrl) {
  var out = [], seen = {}, re = /<(?:iframe|embed|div|button|a)\b[^>]*>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var tag = m[0];
    var isFrame = /^<(?:iframe|embed)\b/i.test(tag);
    var raw = _attr(tag, 'src') || _attr(tag, 'data-src') ||
      _attr(tag, 'data-lazy-src') || _attr(tag, 'data-url') ||
      _attr(tag, 'data-embed') || _attr(tag, 'data-player') ||
      _attr(tag, 'data-iframe') || _attr(tag, 'href');
    if (!raw) continue;
    var url = _abs(raw, pageUrl);
    if (!_isHttp(url) || _isMedia(url) || (!isFrame && !_looksLikePlayer(url))) continue;
    if (/(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com|doubleclick\.net|googlesyndication\.com|google-analytics\.com|recaptcha|facebook\.com\/plugins)/i.test(url)) continue;
    if (seen[url]) continue;
    seen[url] = true;
    out.push(url);
    if (out.length >= EMBED_LIMIT) break;
  }
  return out;
}
function _crawl(url, referer, depth, visited) {
  if (!_isHttp(url) || depth > MAX_DEPTH || visited[url] ||
      (visited.__count || 0) >= MAX_PAGES) return Promise.resolve([]);
  visited[url] = true;
  visited.__count = (visited.__count || 0) + 1;
  return _get(url, referer).then(function (html) {
    var direct = _directSources(html, url);
    if (depth >= MAX_DEPTH || (visited.__count || 0) >= MAX_PAGES) return direct;
    var frames = _iframeUrls(html, url)
      .slice(0, Math.min(EMBED_LIMIT, MAX_PAGES - (visited.__count || 0)));
    return Promise.all(frames.map(function (frameUrl) {
      return _crawl(frameUrl, url, depth + 1, visited);
    })).then(function (nested) {
      var out = direct.slice();
      nested.forEach(function (list) { out = out.concat(list || []); });
      return out;
    });
  }).catch(function () { return []; });
}
function _playerListUrl(html) {
  var text = String(html || '');
  var match = text.match(/(?:const\s+)?pl_url\s*=\s*['"]([^'"]+)['"]/i) ||
    text.match(/data-pl-url\s*=\s*["']([^"']+)["']/i);
  return match ? _abs(_decode(match[1]), SITE + '/') : '';
}
function _serverLinks(html, pageUrl) {
  var out = [], seen = {}, re = /<(?:a|div|li)\b[^>]*>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var tag = m[0], cls = _attr(tag, 'class'), server = _attr(tag, 'data-srv');
    if (!server && !/(?:^|\s)sv-item(?:\s|$)/i.test(cls) && !_attr(tag, 'data-srv')) continue;
    var raw = _attr(tag, 'data-id') || _attr(tag, 'data-url') || _attr(tag, 'href') || _attr(tag, 'src');
    var url = _abs(raw, pageUrl);
    if (!_isHttp(url) || _isMedia(url)) continue;
    if (/(?:vidsrc)/i.test(String(server) + ' ' + url)) continue;
    if (seen[url]) continue;
    seen[url] = true;
    out.push({ name: server || _text(tag) || 'Server', url: url });
    if (out.length >= EMBED_LIMIT) break;
  }
  return out;
}
function _crawlCandidates(candidates, referer) {
  var visited = {};
  return Promise.all(candidates.slice(0, EMBED_LIMIT).map(function (candidate) {
    var url = typeof candidate === 'string' ? candidate : candidate.url;
    return _crawl(url, referer, 0, visited);
  })).then(function (lists) {
    var all = [];
    lists.forEach(function (list) { all = all.concat(list || []); });
    return all;
  });
}
function getVideoSources(episodeUrl, opts) {
  var value = typeof episodeUrl === 'string' ? episodeUrl :
    (episodeUrl && (episodeUrl.url || episodeUrl.id)) || '';
  var target = _abs(value, SITE + '/');
  if (!target || !_isHttp(target)) return Promise.reject(new Error('Movies2Watch: invalid episode URL'));

  return _get(target, SITE + '/').then(function (html) {
    if (!html) throw new Error('Movies2Watch: empty episode page');
    var direct = _directSources(html, target);
    var plUrl = _playerListUrl(html);
    var serversPromise;

    if (plUrl) {
      serversPromise = _get(plUrl, target, { 'X-Requested-With': 'XMLHttpRequest' })
        .then(function (fragment) { return _serverLinks(fragment, plUrl); })
        .catch(function () { return []; });
    } else {
      serversPromise = Promise.resolve(_iframeUrls(html, target).map(function (url) {
        return { name: 'Embedded player', url: url };
      }));
    }

    return serversPromise.then(function (servers) {
      return _crawlCandidates(servers, target).then(function (resolved) {
        return _uniqItems(direct.concat(resolved || []));
      });
    });
  }).then(function (out) {
    if (!out.length) {
      throw new Error('Movies2Watch: no direct media URL exposed by the selected page/player. This host may need a dedicated extractor or browser JavaScript.');
    }
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
