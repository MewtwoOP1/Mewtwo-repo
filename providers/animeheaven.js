// AnimeHeaven — direct website provider for Zangetsu.
// Search is backed by the site's fastsearch.php endpoint; episode playback is
// resolved through the session-bound gate.php response, which provides video sources.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animeheaven';
var VERSION = '1.0.0';
var SITE = 'https://animeheaven.me';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var HEAVEN_COOKIES = {};
var RETRIES = 3;

function getInfo() {
  return { name: 'AnimeHeaven', lang: 'en', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animeheaven.me',
    type: 'anime', version: VERSION };
}
function getSettings() { return []; }
function _decode(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&#8217;/g, '’')
    .replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
}
function _text(s) {
  return _decode(String(s || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function _attr(tag, name) {
  var re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))', 'i');
  var m = String(tag || '').match(re);
  return m ? _decode(m[1] || m[2] || m[3] || '') : '';
}
function _abs(url, base) {
  var u = _decode(String(url || '').trim());
  if (!u || /^(?:javascript:|mailto:|data:|#)/i.test(u)) return '';
  try { return new URL(u, base || SITE + '/').href; } catch (_) { return ''; }
}
function _isHeaven(url) {
  try { return new URL(url).hostname === 'animeheaven.me'; } catch (_) { return false; }
}
function _captureCookies(headers) {
  if (!headers) return;
  var raw = null;
  Object.keys(headers).some(function(k) {
    if (String(k).toLowerCase() === 'set-cookie') { raw = headers[k]; return true; }
    return false;
  });
  if (!raw) return;
  var list = Array.isArray(raw) ? raw : [String(raw)];
  list.forEach(function(value) {
    var pair = String(value || '').split(';', 1)[0].trim();
    var at = pair.indexOf('=');
    if (at > 0) HEAVEN_COOKIES[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  });
}
function _cookieHeader(key) {
  var jar = {};
  Object.keys(HEAVEN_COOKIES).forEach(function(k) { jar[k] = HEAVEN_COOKIES[k]; });
  if (key) jar.key = String(key);
  return Object.keys(jar).map(function(k) { return k + '=' + jar[k]; }).join('; ');
}
function _get(url, referer, extraHeaders) {
  var headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || SITE + '/'
  };
  Object.keys(extraHeaders || {}).forEach(function(k) { headers[k] = extraHeaders[k]; });
  return fetch(url, { headers: headers, timeoutMs: 12000 }).then(function(r) {
    r = r || {};
    _captureCookies(r.headers || {});
    return { status: Number(r.status || r.statusCode || 0), body: String(r.body || ''),
      url: String(r.finalUrl || r.url || url), headers: r.headers || {} };
  }).catch(function() { return { status: 0, body: '', url: url, headers: {} }; });
}
function _wait(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }
function _getRetry(url, referer, headers, attempts) {
  var max = Math.max(1, Number(attempts) || RETRIES);
  function attempt(n) {
    return _get(url, referer, headers).then(function(r) {
      var transient = !r.body || r.status === 0 || r.status === 429 || r.status === 403 || r.status >= 500;
      if (!transient || n >= max) return r;
      return _wait(200 * n).then(function() { return attempt(n + 1); });
    });
  }
  return attempt(1);
}
function _classText(html, name) {
  var re = new RegExp('<([a-z0-9]+)\\b([^>]*\\bclass\\s*=\\s*(?:"[^"]*\\b' + name + '\\b[^"]*"|\\x27[^\\x27]*\\b' + name + '\\b[^\\x27]*\\x27)[^>]*)>([\\s\\S]*?)<\\/\\1>', 'i');
  var m = String(html || '').match(re);
  return m ? _text(m[3]) : '';
}
function _titleFromCard(inner, attrs) {
  var title = _classText(inner, 'fastname');
  if (!title) {
    var img = (String(inner || '').match(/<img\b[^>]*>/i) || [])[0] || '';
    title = _attr(img, 'alt') || _attr(attrs, 'title');
  }
  title = _text(title).replace(/\s+(?:anime\s+)?poster$/i, '').trim();
  return title;
}
function _cards(html) {
  html = String(html || '');
  var out = [], seen = {};
  // The site's fast-search, homepage and new/popular pages share anime.php links,
  // but thumbnails and titles can be nested differently between cards.
  var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html)) !== null) {
    var attrs = m[1], inner = m[2], href = _attr(attrs, 'href');
    if (!/\/anime\.php\?/i.test(href) && !/^anime\.php\?/i.test(href)) continue;
    var url = _abs(href, SITE + '/');
    if (!_isHeaven(url)) continue;
    var parsed;
    try { parsed = new URL(url); } catch (_) { continue; }
    var key = parsed.search.slice(1).replace(/#.*$/, '');
    if (!key || seen[key]) continue;
    var title = _titleFromCard(inner, attrs);
    if (!title || title.length < 2 || /^(?:search|new|popular|fall|random|my bookmarks)$/i.test(title)) continue;
    var img = (inner.match(/<img\b[^>]*>/i) || [])[0] || '';
    var cover = _attr(img, 'data-src') || _attr(img, 'data-original') || _attr(img, 'data-lazy-src') || _attr(img, 'src');
    cover = cover && !/^data:/i.test(cover) ? _abs(cover, url) : '';
    seen[key] = true;
    out.push({ id: key, title: title, englishTitle: title, url: url,
      cover: cover || null, posterUrl: cover || null, description: title,
      type: 'anime', sourceId: SOURCE_ID });
  }
  return out.slice(0, 100);
}
function _cardsWithRetry(url, referer) {
  function attempt(n) {
    return _getRetry(url, referer, {}, 2).then(function(r) {
      var cards = _cards(r.body);
      if (cards.length || n >= RETRIES) return cards;
      return _wait(200 * n).then(function() { return attempt(n + 1); });
    }).catch(function() { return n >= RETRIES ? [] : _wait(200 * n).then(function() { return attempt(n + 1); }); });
  }
  return attempt(1);
}
function _queryMatches(title, query) {
  var norm = function(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); };
  var words = norm(query).split(' ').filter(Boolean);
  var candidate = norm(title);
  return words.length > 0 && words.every(function(word) { return candidate.indexOf(word) >= 0; });
}
function getHome(opts) {
  var routes = [
    { title: 'New Episodes', url: SITE + '/new.php' },
    { title: 'Popular Today', url: SITE + '/popular.php' },
    { title: 'Featured', url: SITE + '/' }
  ];
  return Promise.all(routes.map(function(route) {
    return _cardsWithRetry(route.url, SITE + '/').then(function(items) {
      return { title: route.title, items: items };
    });
  })).then(function(rows) {
    var out = rows.filter(function(row) { return row.items && row.items.length; });
    if (out.length) return out;
    return _cardsWithRetry(SITE + '/new.php', SITE + '/').then(function(items) {
      return items.length ? [{ title: 'AnimeHeaven Catalog', items: items }] : [];
    });
  }).catch(function() { return []; });
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q || (Number(page) > 1)) return Promise.resolve([]);
  var url = SITE + '/fastsearch.php?xhr=1&s=' + encodeURIComponent(q);
  function fallback() {
    return _cardsWithRetry(SITE + '/new.php', SITE + '/').then(function(a) {
      return _cardsWithRetry(SITE + '/popular.php', SITE + '/').then(function(b) {
        var all = [], seen = {};
        a.concat(b).forEach(function(item) {
          if (!seen[item.id] && _queryMatches(item.title, q)) { seen[item.id] = true; all.push(item); }
        });
        return all.slice(0, 50);
      });
    });
  }
  // A successful HTTP response is not enough: fastsearch sometimes returns a
  // valid but empty shell. Retry when parsing yields no titles, then fall back
  // to the site's regular catalogue pages instead of showing an empty source.
  function attempt(n) {
    return _getRetry(url, SITE + '/', { 'X-Requested-With': 'XMLHttpRequest' }, 2).then(function(r) {
      var results = _cards(r.body);
      if (results.length) return results;
      if (n >= RETRIES) return fallback();
      return _wait(200 * n).then(function() { return attempt(n + 1); });
    }).catch(function() { return n >= RETRIES ? fallback() : _wait(200 * n).then(function() { return attempt(n + 1); }); });
  }
  return attempt(1).catch(function() { return []; });
}
function _payloadEpisode(key, referer, title, number) {
  var payload = { key: String(key), referer: referer, title: title || ('Episode ' + number), number: Number(number) || 1 };
  var url = 'animeheaven://' + encodeURIComponent(JSON.stringify(payload));
  return { id: url, url: url, title: payload.title, number: payload.number,
    type: 'anime', sourceId: SOURCE_ID };
}
function _episodeNumber(inner, attrs) {
  var watch2 = _classText(inner, 'watch2');
  var text = _text(inner);
  var epMatch = text.match(/episode\s*([0-9]+(?:\.[0-9]+)?)/i);
  var numMatch = text.match(/^([0-9]+(?:\.[0-9]+)?)$/);
  var raw = watch2 || (epMatch ? epMatch[1] : '') || (numMatch ? numMatch[1] : '');
  if (!raw) raw = _attr(attrs, 'data-episode') || _attr(attrs, 'data-num');
  var m = String(raw).match(/[0-9]+(?:\.[0-9]+)?/);
  return m ? Number(m[0]) : NaN;
}
function _episodeKey(attrs) {
  var action = _attr(attrs, 'onmouseover') + ' ' + _attr(attrs, 'onclick') + ' ' + _attr(attrs, 'href');
  var m = action.match(/gate[ha]\s*\(\s*["']([^"']+)["']/i) ||
    action.match(/gate[ha]\s*\(\s*([^,\s)]+)/i) ||
    action.match(/[?&](?:key|id)=([^&#]+)/i);
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}
function _parseEpisodes(html, pageUrl) {
  var out = [], seen = {}, re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var attrs = m[1], inner = m[2];
    var action = _attr(attrs, 'onmouseover') + ' ' + _attr(attrs, 'onclick') + ' ' + _attr(attrs, 'href');
    var combined = action + ' ' + _text(inner);
    if (!/(?:gate[ha]\s*\(|gate\.php|episode)/i.test(combined)) continue;
    var key = _episodeKey(attrs);
    var num = _episodeNumber(inner, attrs);
    if (!key || !Number.isFinite(num) || seen[key]) continue;
    seen[key] = true;
    out.push(_payloadEpisode(key, pageUrl, 'Episode ' + num, num));
  }
  return out.sort(function(a, b) { return a.number - b.number; });
}
function _parseDetail(html, url) {
  html = String(html || '');
  var title = _classText(html, 'anime-title') || _classText(html, 'animetitle') || _classText(html, 'anime-name');
  if (!title) title = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
    (html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i) || [])[1] ||
    (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  title = _text(title).replace(/\s*[|–-]\s*AnimeHeaven(?:\.Me)?\s*$/i, '').replace(/\s+Anime$/i, '').trim();
  if (!title) {
    try { title = decodeURIComponent(new URL(url).search.slice(1)).replace(/[-_]+/g, ' ').trim(); } catch (_) {}
  }
  var imgTag = (html.match(/<img\b[^>]*alt=["'][^"']*(?:poster|anime)[^"']*["'][^>]*>/i) ||
    html.match(/<img\b[^>]*>/i) || [''])[0];
  var cover = (html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i) || [])[1] ||
    _attr(imgTag, 'data-src') || _attr(imgTag, 'data-original') || _attr(imgTag, 'src');
  var desc = (html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)/i) || [])[1] ||
    _classText(html, 'synopsis') || _classText(html, 'description') || '';
  var eps = _parseEpisodes(html, url);
  return { id: url, title: title || 'AnimeHeaven Anime', englishTitle: title || 'AnimeHeaven Anime',
    url: url, cover: cover ? _abs(cover, url) : null, posterUrl: cover ? _abs(cover, url) : null,
    description: _text(desc), status: 'unknown', genres: [], studios: [], type: 'anime',
    sourceId: SOURCE_ID, episodes: eps };
}
function getDetail(url, opts) {
  var page = String(url || '').trim();
  if (/^animeheaven:\/\//i.test(page)) {
    try { page = JSON.parse(decodeURIComponent(page.replace(/^animeheaven:\/\//i, ''))).referer || ''; } catch (_) { return Promise.resolve(null); }
  }
  if (/^[^:/?]+(?:=.*)?$/.test(page) && !/^https?:/i.test(page)) page = SITE + '/anime.php?' + page;
  page = _abs(page, SITE + '/');
  if (!_isHeaven(page) || !/\/anime\.php\?/i.test(page)) return Promise.resolve(null);
  function attempt(n) {
    return _getRetry(page, SITE + '/', {}, 2).then(function(r) {
      var detail = _parseDetail(r.body, page);
      // An empty gate placeholder or an unparsed transient page should not be
      // accepted as a successful detail result when another request may recover.
      if (detail.episodes.length || n >= RETRIES) return detail;
      return _wait(200 * n).then(function() { return attempt(n + 1); });
    }).catch(function() { return n >= RETRIES ? null : _wait(200 * n).then(function() { return attempt(n + 1); }); });
  }
  return attempt(1);
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function(detail) { return detail && Array.isArray(detail.episodes) ? detail.episodes : []; });
}
function _episodePayload(url) {
  var raw = String(url || '');
  if (!/^animeheaven:\/\//i.test(raw)) return null;
  try {
    var p = JSON.parse(decodeURIComponent(raw.replace(/^animeheaven:\/\//i, '')));
    if (!p || !p.key || !p.referer || !_isHeaven(p.referer)) return null;
    return p;
  } catch (_) { return null; }
}
function _mediaSources(html) {
  var out = [], seen = {};
  var videoTags = String(html || '').match(/<(?:video|source)\b[^>]*>/gi) || [];
  videoTags.forEach(function(tag) {
    var u = _attr(tag, 'src') || _attr(tag, 'data-src');
    u = _abs(u, SITE + '/gate.php');
    if (!u || !/^https?:/i.test(u) || seen[u]) return;
    seen[u] = true;
    out.push(u);
  });
  return out;
}
function _quality(url) {
  var m = String(url || '').match(/\b(2160|1440|1080|720|576|540|480|360)p\b/i);
  return m ? m[1] + 'p' : 'Auto';
}
function _stream(url, payload) {
  var hls = /\.m3u8(?:$|[?#])/i.test(url);
  var q = _quality(url);
  return { url: url, name: 'AnimeHeaven', provider: 'AnimeHeaven', quality: q,
    label: 'AnimeHeaven • ' + q, resolution: q, container: hls ? 'hls' : (/\.mkv(?:$|[?#])/i.test(url) ? 'mkv' : 'mp4'),
    hls: hls, embed: false, downloadable: !hls,
    headers: { 'User-Agent': UA, 'Referer': SITE + '/gate.php', 'Origin': SITE },
    subtitles: [], isActive: true, priority: 0, kind: 'sub', audioLang: 'ja',
    episodeTitle: payload.title || ('Episode ' + payload.number) };
}
function _resolveGate(payload, n) {
  var headers = {
    'Cookie': _cookieHeader(payload.key),
    'Origin': SITE,
    'Referer': payload.referer,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'same-origin'
  };
  return _getRetry(SITE + '/gate.php', payload.referer, headers, 2).then(function(r) {
    var body = String(r.body || '');
    var placeholder = /watch\s+episode\s+on\s+animeheaven\.me/i.test(_text(body));
    var sources = placeholder ? [] : _mediaSources(body);
    if (sources.length) return sources.map(function(url) { return _stream(url, payload); });
    if (n >= RETRIES || r.status === 404) return [];
    return _wait(250 * n).then(function() { return _resolveGate(payload, n + 1); });
  }).catch(function() { return n >= RETRIES ? [] : _wait(250 * n).then(function() { return _resolveGate(payload, n + 1); }); });
}
function getVideoSources(episodeUrl, opts) {
  var payload = _episodePayload(episodeUrl);
  if (!payload) return Promise.resolve([]);
  return _resolveGate(payload, 1);
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = {
  version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome,
  search: search, getDetail: getDetail, getEpisodes: getEpisodes,
  getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks
};