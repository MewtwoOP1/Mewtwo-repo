/*
 * RareAnimes — catalog, episode metadata and alternate-language playback.
 *
 * v1.0.5 — multilingual playback fixes (no links were coming back):
 *  - Player-data extraction no longer truncates at the first ';' (broke any array whose
 *    strings contained ';') and now tries 5 methods in order (see _extractSources).
 *  - Every link for an episode variant is tried in turn, not only the "preferred" one.
 *  - Wrapper/redirect pages: follows meta-refresh, location.*, iframe/data-* and CodeDew-family hosts.
 *  - Relative site links (nav/category) are no longer mistaken for CodeDew buttons.
 *  - lang-btn parsing is attribute-order independent; extra languages are attempted.
 *  - Stream URLs are normalised (//cdn, \/ escapes, relative); Origin header added.
 *  - Failures are no longer swallowed: the thrown error lists why each attempt failed.
 */
var SITE = 'https://www.rareanimes.mov';
var SB = 'https://codedew.com/streambeta/';
var VERSION = '1.0.5';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var FAMILY_RE = /(^|\.)(codedew\.com|hubcloud\.[a-z]+|dlbeta\.[a-z]+|streambeta\.[a-z]+)$/i;
var REL_PATH_RE = /streambeta|zipper|multiquality|hubcloud|dlbeta|filepress/i;
var REL_LABEL_RE = /watch\s*now|stream|play|hubcloud|multiquality|download/i;
var ROWS = [
  { title: 'Trending', path: '/home/' },
  { title: 'Hindi Anime', path: '/hindi/category/crunchyroll/' },
  { title: 'Hindi Dubbed', path: '/hindi/category/hindi-dub/' },
  { title: 'Animated Movies', path: '/hindi/category/movies/' },
  { title: 'Tamil', path: '/hindi/category/tamil/' },
  { title: 'Telugu', path: '/hindi/category/telugu/' }
];

function getInfo() {
  return { name: 'RareAnimes', lang: 'hi', baseUrl: SITE,
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
function _msg(e) { return e && e.message ? e.message : String(e); }
function _host(u) { return ((String(u).match(/^https?:\/\/([^\/:?#]+)/i) || [])[1] || '').toLowerCase(); }
function _origin(u) { return (String(u).match(/^(https?:\/\/[^\/?#]+)/i) || [])[1] || ''; }

function _get(url, referer) {
  return fetch(url, { headers: {
    'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
    'Referer': referer || SITE + '/'
  }}).then(function (r) {
    if (_failed(r)) throw new Error('HTTP ' + (r && r.status) + ' ' + url);
    return _body(r);
  }).then(function (body) {
    // Report Cloudflare challenges distinctly instead of failing silently later.
    if (body.length < 60000 && /<title>\s*Just a moment|cf-browser-verification|challenge-platform|cf_chl_opt/i.test(body))
      throw new Error('Cloudflare challenge at ' + url);
    return body;
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
  if (!out.length) {
    var ar = /<a\b[^>]*href=["'](https?:\/\/(?:www\.)?rareanimes\.[a-z]{2,}\/[^"'#?]+)["'][^>]*>([\s\S]{0,1800}?)<\/a>/gi, x;
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

// ---------------------------------------------------------------- episodes
function _postLines(content) {
  var html = String(content || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
  var links = [];
  html = html.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, function (all, url, label) {
    var raw = _decode(url).trim(), text = _strip(label), full = '';
    if (/^https?:\/\//i.test(raw)) { if (FAMILY_RE.test(_host(raw))) full = raw; }
    else if (/^\/\//.test(raw)) { var p = 'https:' + raw; if (FAMILY_RE.test(_host(p))) full = p; }
    // Relative links are CodeDew buttons only if they look like one; plain site
    // navigation/category links used to be captured here and poisoned the variants.
    else if (raw.charAt(0) === '/' && (REL_PATH_RE.test(raw) || REL_LABEL_RE.test(text))) full = 'https://codedew.com' + raw;
    if (!full) return all;
    links.push({ url: full, label: text });
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
  var lines = _postLines(content), eps = [], current = null, nextLoose = 1, pendingLang = '';
  function ensure(n, title, explicitHeader) {
    var found = eps.filter(function (e) { return e.number === n; })[0];
    if (found) {
      if (title && (!found.title || /^Episode \d+$/i.test(found.title))) found.title = title;
      if (explicitHeader) found.hasHeader = true;
      return found;
    }
    found = { number: n, title: title || ('Episode ' + n), variants: [], hasHeader: !!explicitHeader };
    eps.push(found);
    return found;
  }
  lines.forEach(function (line) {
    var h = line.text.match(/^(?:episode|ep\.?)\s*0*(\d{1,4})\b\s*(?:[-–:]\s*(.*))?$/i);
    if (h) {
      current = ensure(+h[1], (h[2] || '').trim(), true);
      pendingLang = '';
    } else if (line.text) {
      var detectedLang = _variant(line.text);
      if (detectedLang) pendingLang = detectedLang;
    }
    if (line.links.length) {
      if (!current) {
        current = ensure(nextLoose, 'Episode ' + nextLoose, false);
        nextLoose++;
      }
      var lang = _variant(line.text) || pendingLang ||
        (/^episode\s+\d+$/i.test(current.title) ? 'Default' : current.title) || 'Default';
      var usable = line.links.filter(function (l) { return /watchnow|watch\b|hubcloud/i.test(l.label); });
      if (!usable.length) usable = line.links.filter(function (l) {
        return /streambeta|multiquality|dlbeta|filepress|download|play/i.test(l.label);
      });
      if (!usable.length) usable = line.links;
      if (!usable.length) return;
      var preferred = usable.filter(function (l) { return /watchnow|watch\b/i.test(l.label); })[0]
        || usable.filter(function (l) { return /hubcloud/i.test(l.label); })[0]
        || usable[0];
      // Keep every link as a fallback so a dead "preferred" button doesn't kill playback.
      var ordered = [preferred].concat(usable.filter(function (l) { return l !== preferred; }));
      line.links.forEach(function (l) { if (ordered.indexOf(l) < 0) ordered.push(l); });
      var urls = ordered.map(function (l) { return l.url; }).slice(0, 6);
      var key = lang.toLowerCase();
      var v = current.variants.filter(function (x) { return x.lang.toLowerCase() === key; })[0];
      if (!v) { v = { lang: lang, url: preferred.url, alts: urls }; current.variants.push(v); }
      else {
        urls.forEach(function (u) { if (v.alts.indexOf(u) < 0 && v.alts.length < 8) v.alts.push(u); });
        if (/watchnow|watch\b/i.test(preferred.label)) v.url = preferred.url;
      }
      pendingLang = '';
    }
  });
  return eps.filter(function (e) { return e.hasHeader || e.variants.length; })
    .sort(function (a, b) { return a.number - b.number; })
    .map(function (e) {
      var episodeUrl = 'rareanimes://episode/' + encodeURIComponent(JSON.stringify({
        title: e.title, number: e.number, variants: e.variants
      }));
      return { id: episodeUrl, title: e.title, number: e.number, url: episodeUrl,
        type: 'anime', sourceId: 'rareanimes-streambeta' };
    });
}

function getDetail(url) {
  var pageUrl = String(url || '');
  if (!/^https?:\/\//i.test(pageUrl)) pageUrl = _abs(pageUrl, SITE);
  if (!/^https?:\/\/(?:www\.)?rareanimes\.[a-z]{2,}\//i.test(pageUrl)) return Promise.reject(new Error('RareAnimes: invalid detail URL'));
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

// ---------------------------------------------------------------- player-data extraction
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

// Returns the balanced [..] / {..} slice that starts at the first `open`, string-aware.
function _balanced(s, open, close) {
  var start = s.indexOf(open);
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
    if (ch === open) depth++;
    if (ch === close && --depth === 0) return s.slice(start, i + 1);
  }
  return '';
}

// Reads a JS string literal starting at s[i] and returns its decoded value.
function _readString(s, i) {
  var q = s.charAt(i), out = '';
  if (q !== '"' && q !== "'") return null;
  for (var k = i + 1; k < s.length; k++) {
    var ch = s.charAt(k);
    if (ch === '\\') {
      var n = s.charAt(k + 1);
      if (n === 'u' && /^[0-9a-f]{4}$/i.test(s.substr(k + 2, 4))) { out += String.fromCharCode(parseInt(s.substr(k + 2, 4), 16)); k += 5; }
      else if (n === 'n') { out += '\n'; k++; }
      else if (n === 'r') { out += '\r'; k++; }
      else if (n === 't') { out += '\t'; k++; }
      else { out += n; k++; }
    } else if (ch === q) return { value: out, end: k + 1 };
    else out += ch;
  }
  return null;
}

function _asArray(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') {
    var keys = ['sources', 'playerSources', 'data', 'links', 'streams'];
    for (var i = 0; i < keys.length; i++) if (Array.isArray(x[keys[i]])) return x[keys[i]];
  }
  return [];
}

// JSON -> embedded array -> base64 (up to 2 layers).
function _parseMaybe(str, depth) {
  str = String(str || '').trim();
  depth = depth || 0;
  if (!str) return [];
  var a;
  try { a = _asArray(JSON.parse(str)); if (a.length) return a; } catch (_) {}
  var bal = _balanced(str, '[', ']');
  if (bal && bal !== str) { try { a = _asArray(JSON.parse(bal)); if (a.length) return a; } catch (_) {} }
  if (depth < 2 && /^[A-Za-z0-9+\/_\-=\s]{16,}$/.test(str)) return _parseMaybe(_b64decode(str), depth + 1);
  return [];
}

var _WRAP_RE = /^(?:window\s*\.\s*)?(?:JSON\s*\.\s*parse|atob|base64_decode|decodeURIComponent|escape|unescape)\s*\(\s*/i;
function _fromRhs(rhs) {
  rhs = String(rhs).replace(/^\s+/, '');
  for (var g = 0; g < 6 && _WRAP_RE.test(rhs); g++) rhs = rhs.replace(_WRAP_RE, '');
  var c = rhs.charAt(0);
  if (c === '[') return _parseMaybe(_balanced(rhs, '[', ']'));
  if (c === '{') return _parseMaybe(_balanced(rhs, '{', '}'));
  if (c === '"' || c === "'") { var r = _readString(rhs, 0); return r ? _parseMaybe(r.value) : []; }
  return [];
}

function _norm(list) {
  var out = [];
  (list || []).forEach(function (s) {
    if (typeof s === 'string') s = { stream_url: s };
    if (!s || typeof s !== 'object') return;
    var u = s.stream_url || s.streamUrl || s.file || s.url || s.src || s.link || '';
    if (!u) return;
    out.push({ stream_url: String(u), name: String(s.name || s.label || s.quality || s.type || 'Server'),
      type: String(s.type || '') });
  });
  return out;
}

// Five methods, first one that yields anything wins.
function _extractSources(html) {
  var h = String(html || ''), found, m, re, n = 0;
  // 1) playerSources = [...] | : [...] | atob(...) | JSON.parse(...) | "base64"
  re = /playerSources\s*[:=]\s*/gi;
  while ((m = re.exec(h)) && n++ < 6) {
    found = _norm(_fromRhs(h.slice(m.index + m[0].length, m.index + m[0].length + 400000)));
    if (found.length) return found;
  }
  // 2) data-sources / data-playlist attributes (HTML-escaped JSON)
  re = /data-(?:player-)?(?:sources|playlist)\s*=\s*["']([^"']+)["']/gi;
  while ((m = re.exec(h))) {
    found = _norm(_parseMaybe(_decode(m[1])));
    if (found.length) return found;
  }
  // 3) generic JSON-ish keys that point at media files + <source>/<video> tags
  var flat = h.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  var seen = {}, list = [];
  function push(u, name) {
    u = _decode(u);
    if (!/^(?:https?:)?\/\//i.test(u) || seen[u]) return;
    seen[u] = 1; list.push({ stream_url: u, name: name || 'Server' });
  }
  re = /["']?(?:stream_url|streamUrl|file|src|url|source)["']?\s*[:=]\s*["']((?:https?:)?\/\/[^"'\s]+?\.(?:m3u8|mp4|mkv|webm)(?:\?[^"'\s]*)?)["']/gi;
  while ((m = re.exec(flat))) push(m[1], 'Server');
  re = /<(?:source|video)\b[^>]*\bsrc=["']([^"']+)["']/gi;
  while ((m = re.exec(flat))) push(m[1], 'Server');
  if (list.length) return _norm(list);
  // 4) last resort: any bare .m3u8/.mp4 URL in the page
  re = /https?:\/\/[^\s"'<>\\()]+?\.(?:m3u8|mp4)(?:\?[^\s"'<>\\()]*)?/gi;
  while ((m = re.exec(flat))) push(m[0], 'Fallback');
  return _norm(list);
}

function _parseStreamBeta(html) {
  var h = String(html || ''), sources = _extractSources(h);
  var title = _strip((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  var lang = _strip((h.match(/currentLangNative\s*[=:]\s*["']([^"']+)["']/i) || [])[1] || '');
  var fid = (h.match(/maskedFileId\s*[=:]\s*["']([^"']+)["']/i) || [])[1] || '';
  var variants = [], seenFid = {}, m, re = /<[^>]*\blang-btn\b[^>]*>/gi;
  while ((m = re.exec(h))) {   // attribute order independent
    var f = (m[0].match(/data-fid=["']([^"']+)["']/i) || [])[1];
    var l = (m[0].match(/data-lang=["']([^"']+)["']/i) || [])[1];
    if (f && !seenFid[f]) { seenFid[f] = 1; variants.push({ fid: f, lang: _strip(l || '') }); }
  }
  return { title: title, lang: lang, fid: fid, variants: variants, sources: sources };
}

// Translate a StreamBeta language-button id using the same route semantics as
// the standalone resolver: opaque sb_* ids use ?v=, ordinary ids use ?url=.
// Keep the other query shape as a compatibility fallback in case the host
// changes routing between endpoints.
function _streamBetaFidCandidates(fid) {
  var value = _decode(String(fid || '')).trim();
  if (!value) return [];
  if (/^https?:\/\//i.test(value)) return [value];
  var native = value.match(/^streambeta:\/\/(v|url)\/(.+)$/i);
  if (native) {
    var nativeId = native[2];
    var nativeUrl = SB + '?' + native[1].toLowerCase() + '=' + encodeURIComponent(nativeId);
    return [nativeUrl];
  }
  var primary = /^sb_[A-Za-z0-9_-]+$/i.test(value) ? 'v' : 'url';
  var secondary = primary === 'v' ? 'url' : 'v';
  return [
    SB + '?' + primary + '=' + encodeURIComponent(value),
    SB + '?' + secondary + '=' + encodeURIComponent(value)
  ];
}

// ---------------------------------------------------------------- resolver
function _streamBetaUrl(url, base) {
  var u = _decode(String(url || '')).replace(/\\\//g, '/').trim();
  if (/^\/\//.test(u)) u = 'https:' + u;
  else if (u.charAt(0) === '/') u = (base ? _origin(base) : 'https://codedew.com') + u;
  if (!/^https?:\/\//i.test(u)) return '';
  return FAMILY_RE.test(_host(u)) ? u : '';
}

function _decodeEpisodeUrl(url) {
  var m = String(url || '').match(/^rareanimes:\/\/episode\/(.+)$/i);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch (_) { return null; }
}

function _followCandidates(html, target, ctx) {
  var raws = [], m, re;
  re = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*?url=([^"']+)["']/gi;
  while ((m = re.exec(html))) raws.push(m[1]);
  re = /(?:location(?:\.href)?\s*=|location\.(?:replace|assign)\s*\(|window\.open\s*\()\s*["']([^"']+)["']/gi;
  while ((m = re.exec(html))) raws.push(m[1]);
  re = /(?:data-href|data-src|data-url|data-link|href|src|action|content)\s*=\s*["']([^"']+)["']/gi;
  while ((m = re.exec(html))) raws.push(m[1]);
  var out = [], dup = {};
  raws.forEach(function (raw) {
    raw = _decode(raw).trim();
    if (!/^(?:https?:)?\/\//i.test(raw) && raw.charAt(0) !== '/') return;
    if (/\.(?:css|js|png|jpe?g|gif|svg|ico|woff2?)(?:[?#]|$)/i.test(raw)) return;
    var next = _streamBetaUrl(raw, target);
    if (!next || next === target || ctx.seen[next] || dup[next]) return;
    dup[next] = 1; out.push(next);
  });
  out.sort(function (a, b) {
    var ka = /streambeta|hubcloud|zipper|multiquality|dlbeta|player|embed/i.test(a) ? 0 : 1;
    var kb = /streambeta|hubcloud|zipper|multiquality|dlbeta|player|embed/i.test(b) ? 0 : 1;
    return ka - kb;
  });
  // Wrapper pages that only expose a StreamBeta/HubCloud id.
  var href = _decode((html.match(/(?:data-href|data-src|data-url|href|src|content)=["']([^"']*(?:streambeta|hubcloud)[^"']*)["']/i) || [])[1] || '');
  var id = (href.match(/(?:streambeta\/[^?]*\?|hubcloud\.[a-z]+\/drive\/)(?:url=)?([A-Za-z0-9_-]{4,160})/i) || [])[1];
  if (id) {
    var idUrl = SB + '?url=' + encodeURIComponent(id);
    if (!ctx.seen[idUrl] && out.indexOf(idUrl) < 0) out.push(idUrl);
  }
  return out;
}

function _newCtx() { return { seen: {}, fetches: 0 }; }

// Resolves only when the page (or a page it leads to) actually yields stream URLs.
function _resolveStreamBeta(url, depth, ctx, ref) {
  var target = _streamBetaUrl(url);
  depth = depth || 0;
  if (!target) return Promise.reject(new Error('unsupported player URL ' + String(url).slice(0, 80)));
  if (depth > 4 || ctx.seen[target] || ctx.fetches >= 10) return Promise.reject(new Error('redirect loop/limit at ' + target));
  ctx.seen[target] = true; ctx.fetches++;
  return _get(target, ref || SITE + '/').then(function (html) {
    var parsed = _parseStreamBeta(html);
    if (parsed.sources.length) return { html: html, parsed: parsed, url: target };
    var cands = _followCandidates(html, target, ctx), i = 0, lastErr = null;
    function next() {
      if (i >= cands.length) return Promise.reject(lastErr || new Error('no stream data and no wrapper link at ' + target));
      var c = cands[i++];
      return _resolveStreamBeta(c, depth + 1, ctx, target).catch(function (e) { lastErr = e; return next(); });
    }
    return next();
  });
}

function _firstResolved(urls, errs, ref) {
  var i = 0;
  function next() {
    if (i >= urls.length) return Promise.resolve(null);
    var u = urls[i++];
    return _resolveStreamBeta(u, 0, _newCtx(), ref).then(null, function (e) {
      errs.push(_msg(e));
      return next();
    });
  }
  return next();
}

function _fixUrl(u, base) {
  u = _decode(String(u || '')).replace(/\\u0026/g, '&').replace(/\\\//g, '/').trim();
  if (/^\/\//.test(u)) return 'https:' + u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.charAt(0) === '/' && base) return _origin(base) + u;
  return '';
}

function _toSources(r, lang) {
  function build(includePixeldrain) {
    var out = [];
    r.parsed.sources.forEach(function (s) {
      if (!s) return;
      var isPix = /pixeldrain/i.test(s.type) || /pixeldrain/i.test(s.stream_url);
      if (isPix && !includePixeldrain) return;
      var url = _fixUrl(s.stream_url, r.url);
      if (!url) return;
      var name = String(s.name || 'Server');
      var probe = name + ' ' + url;
      out.push({ url: url,
        quality: /2160p|\b4k\b/i.test(probe) ? '2160p' : (/1080p/i.test(probe) ? '1080p' : (/720p/i.test(probe) ? '720p' : (/480p/i.test(probe) ? '480p' : 'auto'))),
        label: [lang, name].join(' • '),
        container: /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : 'mp4',
        kind: /^(?:Japanese|Original|Sub|Subbed)$/i.test(lang) ? 'sub' : 'dub',
        headers: { 'User-Agent': UA, 'Referer': r.url || SB, 'Origin': _origin(r.url || SB) } });
    });
    return out;
  }
  var out = build(false);
  return out.length ? out : build(true);   // pixeldrain only as a last resort
}

function getVideoSources(episodeUrl, opts) {
  var payload = _decodeEpisodeUrl(episodeUrl);
  if (!payload) return Promise.resolve([]);
  var variants = Array.isArray(payload.variants) && payload.variants.length
    ? payload.variants : (payload.url ? [{ url: payload.url, lang: payload.lang || '' }] : []);
  if (!variants.length) return Promise.resolve([]);
  var errs = [];

  // Resolve every episode-page language link first. Each result retains the
  // player HTML metadata so we can collect language-button FIDs even when the
  // detail page itself has more than one language variant.
  return Promise.all(variants.map(function (variant) {
    var urls = [variant.url].concat(variant.alts || []).filter(function (u, i, a) {
      return u && a.indexOf(u) === i;
    });
    return _firstResolved(urls, errs).then(function (r) {
      return {
        resolved: r,
        sources: r ? _toSources(r, variant.lang || r.parsed.lang || 'Auto') : []
      };
    });
  })).then(function (resolved) {
    var out = [], seenSources = {}, currentFids = {}, alternateFids = {}, alternateOrder = [];

    function append(sources) {
      (sources || []).forEach(function (s) {
        var key = s.url + '|' + s.label;
        if (!seenSources[key]) {
          seenSources[key] = true;
          out.push(s);
        }
      });
    }

    // First add streams directly corresponding to each episode-page variant
    // and record each active FID before collecting alternatives.
    resolved.forEach(function (item) {
      append(item.sources);
      if (item.resolved && item.resolved.parsed && item.resolved.parsed.fid) {
        currentFids[String(item.resolved.parsed.fid)] = true;
      }
    });

    // The StreamBeta player may contain language buttons even when the
    // episode page only lists one language—or lists several broken links.
    // Gather alternatives from ALL resolved player pages, not only when the
    // episode page produced exactly one variant.
    resolved.forEach(function (item) {
      if (!item.resolved || !item.resolved.parsed) return;
      var buttons = item.resolved.parsed.variants || [];
      buttons.forEach(function (button) {
        var fid = String(button.fid || '').trim();
        if (!fid || currentFids[fid] || alternateFids[fid]) return;
        alternateFids[fid] = {
          lang: button.lang || 'Auto',
          ref: item.resolved.url
        };
        alternateOrder.push(fid);
      });
    });

    // Some language FIDs are sb_* tokens that require ?v= rather than ?url=.
    // Try the provider's canonical route first, then the alternate route as a
    // compatibility fallback. Don't arbitrarily stop after the first 4 languages.
    return Promise.all(alternateOrder.map(function (fid) {
      var info = alternateFids[fid];
      return _firstResolved(_streamBetaFidCandidates(fid), errs, info.ref).then(function (r) {
        return r ? _toSources(r, info.lang || r.parsed.lang || 'Auto') : [];
      }, function (e) {
        errs.push('language ' + info.lang + ' (' + fid + '): ' + _msg(e));
        return [];
      });
    })).then(function (groups) {
      groups.forEach(append);
      if (!out.length) {
        throw new Error('RareAnimes: no usable direct sources. ' +
          (errs.length ? errs.slice(0, 8).join(' | ') : 'no player links found'));
      }
      return out;
    });
  });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams,
    getLinks: getLinks,
    _test: { _extractSources: _extractSources, _parseEpisodes: _parseEpisodes, _postLines: _postLines, _parseStreamBeta: _parseStreamBeta, _streamBetaFidCandidates: _streamBetaFidCandidates } };
}
