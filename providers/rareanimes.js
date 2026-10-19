/*
 * RareAnimes + StreamBeta — catalog, episode metadata and direct playback.
 * StreamBeta itself is a resolver, not a catalog; this provider reads titles
 * from RareAnimes and resolves WatchNow/HubCloud links through codedew StreamBeta.
 *
 * v1.0.0: catalog parsing, encoded playerSources support, and StreamBeta playback.
 */
var SITE = 'https://www.rareanimes.mov';
var SB = 'https://codedew.com/streambeta/';
var VERSION = '1.0.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var ROWS = [
  { title: 'Trending', path: '/home/' },
  { title: 'Hindi Anime', path: '/hindi/category/crunchyroll/' },
  { title: 'Hindi Dubbed', path: '/hindi/category/hindi-dub/' },
  { title: 'Animated Movies', path: '/hindi/category/movies/' },
  { title: 'Tamil', path: '/hindi/category/tamil/' },
  { title: 'Telugu', path: '/hindi/category/telugu/' }
];

function getInfo() {
  return { name: 'RareAnimes • StreamBeta', lang: 'hi', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=rareanimes.mov',
    type: 'anime', version: VERSION };
}
function getSettings() { return []; }
function _failed(r) { return !r || r.ok === false || (typeof r.status === 'number' && r.status >= 400); }
function _body(r) {
  if (r && typeof r.body === 'string') return Promise.resolve(r.body);
  if (r && typeof r.text === 'function') return r.text();
  return Promise.resolve('');
}
function _get(url, referer) {
  return fetch(url, { headers: {
    'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
    'Referer': referer || SITE + '/'
  }}).then(function (r) {
    if (_failed(r)) throw new Error('RareAnimes/StreamBeta HTTP ' + (r && r.status) + ': ' + url);
    return _body(r);
  });
}
function _decode(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—');
}
function _strip(s) { return _decode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function _abs(url, base) {
  url = _decode(String(url || ''));
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/\//.test(url)) return 'https:' + url;
  return (base || SITE).replace(/\/+$/, '') + (url.charAt(0) === '/' ? '' : '/') + url;
}
function _cleanTitle(s) {
  s = _strip(s).replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*[-–|]?\s*\b(?:Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|Dual Audio|Multi Audio|All Episodes|Episodes?|Download|HD|Watch Online|Complete)\b[\s\S]*$/i, '');
  return s.replace(/[\s\-–|:,(]+$/, '').trim() || 'Untitled';
}
function _item(title, url, cover, classes) {
  return { id: url, title: _cleanTitle(title), url: url, cover: cover || null,
    type: /\bmovie|film\b/i.test(title + ' ' + (classes || '')) ? 'movie' : 'anime' };
}
function _parseListing(html) {
  html = String(html || '');
  var out = [], seen = {};
  var re = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi, m;
  while ((m = re.exec(html))) {
    var cls = (m[1].match(/\bclass=["']([^"']*)["']/i) || [])[1] || '';
    var body = m[2];
    var a = body.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*title=["']([^"']+)["'][^>]*>/i)
      || body.match(/<a\b[^>]*title=["']([^"']+)["'][^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/i);
    var href = '', title = '';
    if (a) {
      if (/^https?:\/\//i.test(a[1])) { href = a[1]; title = a[2] || ''; }
      else { title = a[1] || ''; href = a[2] || ''; }
    }
    if (!href) {
      var h = body.match(/<a\b[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/i);
      href = h ? h[1] : '';
    }
    if (!title) title = _strip((body.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i) || [])[1] || '');
    if (!href || !title || seen[href] || /^\s*all\b[\s\S]*\blist\s*$/i.test(title)) continue;
    var im = body.match(/<img\b[^>]*(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i);
    seen[href] = 1;
    out.push(_item(title, href, im ? _abs(im[1], SITE) : null, cls));
  }
  // Some theme layouts use cards instead of article wrappers.
  if (!out.length) {
    var ar = /<a\b[^>]*href=["'](https?:\/\/(?:www\.)?rareanimes\.mov\/[^"'#?]+)["'][^>]*>([\s\S]{0,1800}?)<\/a>/gi, x;
    while ((x = ar.exec(html))) {
      var t = _strip((x[2].match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i) || [])[1] || x[2]);
      if (!t || seen[x[1]] || t.length > 140) continue;
      seen[x[1]] = 1;
      var img = x[2].match(/<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i);
      out.push(_item(t, x[1], img ? _abs(img[1], SITE) : null, ''));
    }
  }
  return out;
}
function getHome() {
  return Promise.all(ROWS.map(function (row) {
    return _get(SITE + row.path).then(function (html) {
      return { title: row.title, items: _parseListing(html) };
    }).catch(function () { return { title: row.title, items: [] }; });
  })).then(function (rows) { return rows.filter(function (r) { return r.items.length > 0; }); });
}
function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    (rows || []).forEach(function (r) { (r.items || []).forEach(function (i) { out.push(i); }); });
    return out;
  });
}
function search(query) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _get(SITE + '/?s=' + encodeURIComponent(q).replace(/%20/g, '+'))
    .then(_parseListing).catch(function () { return []; });
}
function _episodePayload(url, title, number, lang) {
  return 'rareanimes://episode/' + encodeURIComponent(JSON.stringify({
    url: url, title: title || '', number: number || 1, lang: lang || ''
  }));
}
function _postLines(content) {
  var html = String(content || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
  var links = [];
  html = html.replace(/<a\b[^>]*href=["'](https?:\/\/(?:www\.)?codedew\.com\/zipper\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    function (_, url, label) {
      links.push({ url: _decode(url), label: _strip(label) });
      return ' __RAI_LINK_' + (links.length - 1) + '__ ';
    });
  html = html.replace(/<(?:p|h[1-6]|hr|br|div|li|tr)\b[^>]*>/gi, '\n');
  return html.split(/\n/).map(function (line) {
    var toks = [];
    line = line.replace(/__RAI_LINK_(\d+)__/g, function (_, n) {
      if (links[+n]) toks.push(links[+n]); return '';
    });
    return { text: _strip(line), links: toks };
  }).filter(function (x) { return x.text || x.links.length; });
}
function _variant(text) {
  var s = String(text || '').replace(/^\s*(?:episode|ep\.?)\s*\d+\s*[-–:]\s*/i, '');
  s = s.split(/\s[-–]\s|[-–]\s*$/)[0].replace(/[\[\]]/g, '').trim();
  var m = s.match(/\b(Hindi|Tamil|Telugu|Malayalam|Bengali|Kannada|Marathi|English|Japanese)\b[\s\S]*$/i);
  if (m) return m[0].slice(0, 48);
  if (/^untouched\b/i.test(s)) return s.slice(0, 48);
  return '';
}
function _parseEpisodes(content) {
  var lines = _postLines(content), eps = [], current = null, nextLoose = 1;
  function ensure(n, title) {
    var found = eps.filter(function (e) { return e.number === n; })[0];
    if (found) { if (title && !found.title) found.title = title; return found; }
    found = { number: n, title: title || ('Episode ' + n), variants: [] }; eps.push(found); return found;
  }
  lines.forEach(function (line) {
    var h = line.text.match(/^(?:episode|ep\.?)\s*0*(\d{1,4})\b\s*(?:[-–:]\s*(.*))?$/i);
    if (h) current = ensure(+h[1], (h[2] || '').trim());
    if (line.links.length) {
      if (!current) current = ensure(nextLoose++, 'Episode ' + nextLoose);
      var lang = _variant(line.text) || current.title || 'Default';
      var usable = line.links.filter(function (l) { return /watchnow|watch\b|hubcloud/i.test(l.label); });
      if (!usable.length) usable = line.links.filter(function (l) { return /streambeta/i.test(l.label); });
      if (!usable.length) return;
      var preferred = usable.filter(function (l) { return /watchnow|watch\b/i.test(l.label); })[0] || usable[0];
      var key = lang.toLowerCase();
      var v = current.variants.filter(function (x) { return x.lang.toLowerCase() === key; })[0];
      if (!v) { v = { lang: lang, url: preferred.url }; current.variants.push(v); }
      else if (/watchnow|watch\b/i.test(preferred.label)) v.url = preferred.url;
    }
  });
  return eps.filter(function (e) { return e.variants.length; }).map(function (e) {
    return e.variants.map(function (v) {
      return { id: _episodePayload(v.url, e.title, e.number, v.lang),
        title: e.title + ' • ' + v.lang, number: e.number, url: _episodePayload(v.url, e.title, e.number, v.lang),
        type: 'anime', sourceId: 'rareanimes-streambeta' };
    });
  }).reduce(function (a, b) { return a.concat(b); }, []);
}
function getDetail(url) {
  var pageUrl = String(url || '');
  if (!/^https?:\/\//i.test(pageUrl)) pageUrl = _abs(pageUrl, SITE);
  if (!/^https?:\/\/(?:www\.)?rareanimes\.mov\//i.test(pageUrl)) return Promise.reject(new Error('RareAnimes: invalid detail URL'));
  return _get(pageUrl).then(function (html) {
    var title = _strip((html.match(/<h1\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) || [])[1]
      || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
    title = title.replace(/\s*[-|–]\s*Rare Toons India\s*$/i, '');
    var a = html.indexOf('<div class="entry-content');
    var b = a >= 0 ? html.indexOf('</article>', a) : -1;
    var content = a >= 0 ? html.slice(a, b > a ? b : undefined) : html;
    var poster = (html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1] || '';
    if (!poster) {
      var im = content.match(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/i); poster = im ? im[1] : '';
    }
    var description = _strip((content.match(/(?:Synopsis|Storyline|Plot)[\s\S]{0,250}?<\/(?:p|div)>/i) || [])[0] || '');
    var episodes = _parseEpisodes(content);
    if (!title || !episodes.length) throw new Error('RareAnimes: title/episode links not found on detail page');
    return { id: pageUrl, title: _cleanTitle(title) || title, url: pageUrl, cover: poster ? _abs(poster, SITE) : null,
      description: description || null, status: 'unknown', genres: [], studios: [], type: 'anime',
      sourceId: 'rareanimes-streambeta', episodes: episodes, subCount: episodes.length, dubCount: 0 };
  });
}
function getEpisodes(url, opts) { return getDetail(url, opts).then(function (d) { return d.episodes || []; }); }

var _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64decode(s) {
  s = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  while (s.length % 4) s += '=';
  var out = '';
  for (var i = 0; i + 3 < s.length; i += 4) {
    var a = _B64.indexOf(s.charAt(i)), b = _B64.indexOf(s.charAt(i + 1));
    var c = s.charAt(i + 2) === '=' ? 0 : _B64.indexOf(s.charAt(i + 2));
    var d = s.charAt(i + 3) === '=' ? 0 : _B64.indexOf(s.charAt(i + 3));
    if (a < 0 || b < 0) break;
    out += String.fromCharCode((a << 2) | (b >> 4));
    if (s.charAt(i + 2) !== '=') out += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    if (s.charAt(i + 3) !== '=') out += String.fromCharCode(((c & 3) << 6) | d);
  }
  try { return decodeURIComponent(escape(out)); } catch (_) { return out; }
}
function _balancedArray(s) {
  var start = s.indexOf('[');
  if (start < 0) return '';
  var depth = 0, quote = '', esc = false;
  for (var i = start; i < s.length; i++) {
    var ch = s.charAt(i);
    if (quote) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']' && --depth === 0) return s.slice(start, i + 1);
  }
  return '';
}
function _decodePlayerArray(html) {
  var h = String(html || '');
  var at = h.search(/playerSources\s*=/i);
  if (at < 0) return [];
  var rhs = h.slice(h.indexOf('=', at) + 1, h.indexOf(';', at) > -1 ? h.indexOf(';', at) : h.length).trim();
  var array = _balancedArray(rhs);
  if (array) {
    try { var direct = JSON.parse(array); if (Array.isArray(direct)) return direct; } catch (_) {}
  }
  var encoded = (rhs.match(/(?:atob|base64_decode)\s*\(\s*["']([^"']+)["']\s*\)/i) || [])[1];
  if (!encoded) encoded = (rhs.match(/^["']([^"']{16,})["']$/) || [])[1];
  if (encoded) {
    var decoded = _b64decode(encoded);
    try { var json = JSON.parse(decoded); if (Array.isArray(json)) return json; } catch (_) {}
    var nested = _balancedArray(decoded);
    try { var json2 = JSON.parse(nested); if (Array.isArray(json2)) return json2; } catch (_) {}
  }
  // Some templates assign an escaped JSON string or call JSON.parse on it.
  var quoted = (rhs.match(/JSON\.parse\s*\(\s*["']([\s\S]*?)["']\s*\)/i) || [])[1];
  if (quoted) {
    quoted = quoted.replace(/\\(["'\\])/g, '$1');
    try { var json3 = JSON.parse(quoted); if (Array.isArray(json3)) return json3; } catch (_) {}
    try { var json4 = JSON.parse(_b64decode(quoted)); if (Array.isArray(json4)) return json4; } catch (_) {}
  }
  return [];
}
function _parseStreamBeta(html) {
  var h = String(html || ''), sources = _decodePlayerArray(h);
  var title = _strip((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  var lang = _strip((h.match(/currentLangNative\s*=\s*["']([^"']+)["']/i) || [])[1] || '');
  var fid = (h.match(/maskedFileId\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
  var re = /class=["'][^"']*lang-btn[^"']*["'][^>]*data-fid=["'](sb_[^"']+)["'][^>]*data-lang=["']([^"']+)["']/gi;
  var variants = [], m;
  while ((m = re.exec(h))) variants.push({ fid: m[1], lang: _strip(m[2]) });
  return { title: title, lang: lang, fid: fid, variants: variants, sources: sources };
}
function _streamBetaUrl(url) {
  var u = String(url || '');
  if (/^https?:\/\//i.test(u)) {
    try {
      var parsed = new URL(u);
      if (!/(^|\.)codedew\.com$/i.test(parsed.hostname) || !/\/(?:zipper|streambeta)\/?$/i.test(parsed.pathname)) return '';
      if (/\/streambeta\/?$/i.test(parsed.pathname)) return u;
      return u;
    } catch (_) { return ''; }
  }
  return '';
}
function _decodeEpisodeUrl(url) {
  var m = String(url || '').match(/^rareanimes:\/\/episode\/(.+)$/i);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch (_) { return null; }
}
function _resolveStreamBeta(url) {
  var target = _streamBetaUrl(url);
  if (!target) return Promise.reject(new Error('RareAnimes: invalid StreamBeta/zipper URL'));
  return _get(target, SITE + '/').then(function (html) {
    var parsed = _parseStreamBeta(html);
    if (parsed.sources.length) return { html: html, parsed: parsed, url: target };
    var href = _decode((html.match(/(?:data-href|href|content)=["']([^"']*(?:streambeta|hubcloud)[^"']*)["']/i) || [])[1] || '');
    var id = (href.match(/(?:streambeta\/[^?]*\?|hubcloud\.[a-z]+\/drive\/)(?:url=)?([A-Za-z0-9_-]{4,160})/i) || [])[1];
    if (!id) throw new Error('RareAnimes: StreamBeta playerSources not found');
    var next = SB + '?url=' + encodeURIComponent(id);
    return _get(next, target).then(function (page) {
      var p = _parseStreamBeta(page);
      if (!p.sources.length) throw new Error('RareAnimes: StreamBeta returned no playable sources');
      return { html: page, parsed: p, url: next };
    });
  });
}
function getVideoSources(episodeUrl, opts) {
  var payload = _decodeEpisodeUrl(episodeUrl);
  if (!payload || !payload.url) return Promise.resolve([]);
  return _resolveStreamBeta(payload.url).then(function (r) {
    var out = [], seen = {};
    r.parsed.sources.forEach(function (s) {
      if (!s || /pixeldrain/i.test(String(s.type || ''))) return;
      var url = s.stream_url || s.streamUrl || s.file || s.url || '';
      if (!/^https?:\/\//i.test(url) || seen[url]) return;
      seen[url] = 1;
      var name = String(s.name || s.type || 'Server');
      out.push({ url: url, quality: /2160p/i.test(name) ? '2160p' : (/1080p/i.test(name) ? '1080p' : (/720p/i.test(name) ? '720p' : 'auto')),
        label: [payload.lang || r.parsed.lang || 'Auto', name].join(' • '),
        container: /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : 'mp4', kind: 'dub',
        headers: { 'User-Agent': UA, 'Referer': r.url || SB } });
    });
    if (!out.length) throw new Error('RareAnimes: StreamBeta page contains no usable direct sources');
    return out;
  });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams,
    getLinks: getLinks };
}
