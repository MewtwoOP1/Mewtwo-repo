// AnimeHeaven — anime source for the Zangetsu provider repo (animeheaven.me).
//
// Three plain GETs and no player page: `search.php` finds the entry, `anime.php?<id>` lists the
// episodes, and `gate.php` — asked with the episode's hash as a `key` cookie — answers with
// `<source>` tags naming the file on the CDN directly.
//
// The catalogue is sub-only and the subtitles are burned in. One quality per episode; the three
// <source> mirrors are the same file on different hosts, offered as manual failover.
//
// Entry points:
//   search.php?s=<q>        -> similarimg / chart cards
//   anime.php?<id>          -> metadata + gatea("<hash>") episode rows
//   gate.php (Cookie: key=) -> <source src="...mp4?<key>..."> mirrors

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animeheaven';

var BASE = 'https://animeheaven.me';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

var MIN_TITLE_SCORE = 0.28;
var MAX_PROBE_PAGES = 3;
var CACHE_TTL_MS = 30 * 60 * 1000;

var _detailCache = {};

function getInfo() {
  return { name: 'AnimeHeaven', lang: 'en', baseUrl: BASE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animeheaven.me', type: 'anime', version: '1.0.1' };
}
function getSettings() { return []; }

// ── Helpers ────────────────────────────────────────────────────────────────
function _raceTimeout(promise, ms, fallback) {
  var hasTimers = typeof setTimeout === 'function' && typeof clearTimeout === 'function';
  if (!hasTimers) return promise;
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () { settled = true; resolve(fallback); }, ms);
    promise.then(function (value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, function (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function _get(url, ref, cookie) {
  var h = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*', 'Referer': ref || BASE + '/' };
  if (cookie) h['Cookie'] = cookie;
  return _raceTimeout(fetch(url, { headers: h }).then(function (r) {
    if (!r) throw new Error('AnimeHeaven: empty response');
    if (!r.ok) throw new Error('AnimeHeaven: HTTP ' + r.status);
    return r.text();
  }), 15000, null).then(function (v) {
    if (v == null) throw new Error('AnimeHeaven: timeout for ' + url);
    return v;
  });
}

function _enc(value) { return encodeURIComponent(String(value || '')); }

function _stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").trim();
}

function _attr(html, name) {
  var m = String(html || '').match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']*)'));
  return m ? m[1] : '';
}

function _abs(url) {
  url = String(url || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.charAt(0) === '/') return BASE + url;
  return BASE + '/' + url;
}

function _titleScore(a, b) {
  a = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  b = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 0.82;
  var matches = 0;
  for (var i = 0; i < Math.min(a.length, b.length); i++) if (a.charAt(i) === b.charAt(i)) matches++;
  return matches / Math.max(a.length, b.length);
}

function _titlesFromMedia(media) {
  var t = media && media.title;
  var out = [];
  if (t) {
    if (t.romaji) out.push(t.romaji);
    if (t.english) out.push(t.english);
    if (t.native) out.push(t.native);
    if (t.userPreferred) out.push(t.userPreferred);
  }
  if (media && media.title && typeof media.title === 'string') out.push(media.title);
  return out.filter(function (x) { return x && String(x).trim(); });
}

function _catalogTitle(media) {
  var titles = _titlesFromMedia(media);
  return titles[0] || '';
}

// ── Search parsing ─────────────────────────────────────────────────────────
function _parseSearch(html) {
  var out = [], seen = {};
  var cardRegex = /<div\b[^>]*class\s*=\s*["'][^"']*\b(?:similarimg|chart)\b[^"']*["'][^>]*>/gi;
  var starts = [], m;
  while ((m = cardRegex.exec(html)) !== null) starts.push(m.index);
  for (var i = 0; i < starts.length; i++) {
    var start = starts[i];
    var end = (i + 1 < starts.length) ? starts[i + 1] : html.length;
    var block = html.substring(start, end);
    var pathMatch = block.match(/<a\b[^>]*href\s*=\s*["']?(?:https?:\/\/[^"'\s>]*\/)?(anime\.php\?[^"'\s>]+)/i);
    if (!pathMatch) continue;
    var path = pathMatch[1];
    if (seen[path]) continue;
    var titleMatch = block.match(/<div\b[^>]*class\s*=\s*["'][^"']*\b(?:similarname|charttitle)\b[^"']*["'][^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/i);
    var title = titleMatch ? _stripTags(titleMatch[1]) : '';
    if (!title) {
      var img = block.match(/<img\b[^>]*>/i);
      if (img) title = _stripTags(_attr(img[0], 'alt'));
    }
    if (!title) continue;
    var cover = '';
    var imgTag = block.match(/<img\b[^>]*>/i);
    if (imgTag) {
      cover = _abs(_attr(imgTag[0], 'src'));
      if (!cover || /placeholder|noimage/i.test(cover)) {
        var dataSrc = _attr(imgTag[0], 'data-src');
        if (dataSrc) cover = _abs(dataSrc);
      }
    }
    seen[path] = true;
    out.push({ id: path, title: title.trim(), url: path, cover: cover || null, type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}

// ── Detail/episode parsing ─────────────────────────────────────────────────
function _parseEpisodes(html) {
  var gates = [], m;
  var gateRegex = /gatea\(\s*(?:"|&quot;|')([0-9a-f]+)(?:"|&quot;|')\s*\)/gi;
  while ((m = gateRegex.exec(html)) !== null) {
    gates.push({ gateKey: m[1], pos: m.index + m[0].length, at: m.index });
  }
  var out = [], seen = {};
  for (var i = 0; i < gates.length; i++) {
    // Look from the end of this gatea() call to the next one: the watch2 number lives inside the
    // same anchor, after the onclick, so starting at the previous row shifts every number by one.
    var from = gates[i].pos;
    var to = (i + 1 < gates.length) ? gates[i + 1].at : html.length;
    var segment = html.substring(from, to);
    var numMatch = segment.match(/<div\b[^>]*\bwatch2\b[^>]*>\s*(\d+(?:\.\d+)?)\s*<\/div>/i);
    if (!numMatch) continue;
    var num = parseFloat(numMatch[1]);
    if (!(num >= 1) || num % 1 !== 0) continue;
    var key = gates[i].gateKey;
    if (seen[num]) continue;
    seen[num] = true;
    out.push({ number: num, gateKey: key });
  }
  return out.sort(function (a, b) { return a.number - b.number; });
}

function _parseMeta(html, fallbackTitle) {
  var title = '';
  var h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) title = _stripTags(h1[1]);
  if (!title) {
    var infoTitle = html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\b(?:infotitle|anime-title)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (infoTitle) title = _stripTags(infoTitle[1]);
  }
  if (!title) {
    var og = html.match(/property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)/i)
      || html.match(/content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:title["']/i);
    if (og) title = _stripTags(og[1]).replace(/\s*[|-]\s*AnimeHeaven.*$/i, '');
  }
  if (!title) title = String(fallbackTitle || '').replace(/[-_]/g, ' ');

  var cover = '';
  var ogImg = html.match(/property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)/i)
    || html.match(/content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["']/i);
  if (ogImg) cover = ogImg[1];
  if (!cover) {
    var poster = html.match(/<img\b[^>]*class\s*=\s*["'][^"']*\bposterimg\b[^"']*["'][^>]*>/i);
    if (poster) cover = _attr(poster[0], 'src');
  }

  var description = '';
  var descBlock = html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\b(?:infodes|description|synopsis|full|short)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (descBlock) description = _stripTags(descBlock[1]);
  if (!description) {
    var metaDesc = html.match(/name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)/i);
    if (metaDesc) description = _stripTags(metaDesc[1]);
  }

  var year = null;
  var yearBlock = html.match(/class\s*=\s*["'][^"']*\binfoyear\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div\b/i);
  var yearMatch = (yearBlock && yearBlock[1].match(/\b(19|20)\d{2}\b/)) || html.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) year = yearMatch[0];

  var genres = [], g, re = /<a\b[^>]*href\s*=\s*["'][^"']*(?:tags\.php\?tag=|genre)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  while ((g = re.exec(html)) !== null) {
    var name = _stripTags(g[1]);
    if (name && genres.indexOf(name) === -1 && genres.length < 12) genres.push(name);
  }

  return { title: title.trim(), cover: cover || null, description: description, year: year, genres: genres };
}

function _episodeObject(ep) {
  return {
    id: 'animeheaven://' + ep.gateKey + '/' + ep.number,
    number: ep.number,
    title: 'Episode ' + ep.number,
    url: 'animeheaven://' + ep.gateKey + '/' + ep.number,
    category: 'sub',
    type: 'anime',
    sourceId: SOURCE_ID
  };
}

function _loadDetail(path) {
  var key = String(path || '');
  var cached = _detailCache[key];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.detail);
  return _get(BASE + '/' + key.replace(/^\/+/, ''), BASE + '/').then(function (html) {
    var meta = _parseMeta(html, key);
    var episodes = _parseEpisodes(html).map(_episodeObject);
    var detail = {
      id: key,
      title: meta.title,
      url: key,
      cover: meta.cover,
      description: meta.description,
      status: 'unknown',
      genres: meta.genres,
      type: 'anime',
      sourceId: SOURCE_ID,
      episodes: episodes,
      year: meta.year,
      subCount: episodes.length,
      dubCount: 0
    };
    _detailCache[key] = { at: Date.now(), detail: detail };
    return detail;
  });
}

// ── Public API ─────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q || (page && page > 1)) return Promise.resolve([]);
  return _get(BASE + '/search.php?s=' + _enc(q), BASE + '/')
    .then(_parseSearch)
    .catch(function () { return []; });
}

function getHome(opts) {
  // The site's front page carries a spotlight + chart rows.
  return _get(BASE + '/', BASE + '/').then(function (html) {
    var items = _parseSearch(html);
    return items.length ? [{ title: 'Popular on AnimeHeaven', items: items.slice(0, 40) }] : [];
  }).catch(function () { return []; });
}

function getDetail(url, opts) {
  return _loadDetail(url);
}

function getEpisodes(url, opts) {
  return _loadDetail(url).then(function (d) { return d.episodes; });
}

// Title-based resolution used by providers that search before resolving.
function _resolveByTitle(media) {
  var titles = _titlesFromMedia(media);
  var queries = [];
  for (var i = 0; i < titles.length; i++) {
    var base = titles[i].replace(/\s*(?:season|part)\s*\d+/i, '').trim();
    if (base && queries.indexOf(base) === -1) queries.push(base);
    if (titles[i] && queries.indexOf(titles[i]) === -1) queries.push(titles[i]);
  }
  if (!queries.length) return Promise.reject(new Error('AnimeHeaven: no title'));
  var candidates = null;
  var chain = Promise.resolve();
  queries.slice(0, 3).forEach(function (q) {
    chain = chain.then(function () {
      if (candidates && candidates.length) return;
      return _get(BASE + '/search.php?s=' + _enc(q), BASE + '/').then(function (html) {
        var hits = _parseSearch(html);
        if (hits.length) candidates = hits;
      });
    });
  });
  return chain.then(function () {
    if (!candidates || !candidates.length) throw new Error('AnimeHeaven has no entry for this title');
    var ranked = candidates.slice().sort(function (a, b) {
      var sa = Math.max.apply(null, titles.map(function (t) { return _titleScore(t, a.title); }));
      var sb = Math.max.apply(null, titles.map(function (t) { return _titleScore(t, b.title); }));
      return sb - sa;
    }).filter(function (c) {
      return Math.max.apply(null, titles.map(function (t) { return _titleScore(t, c.title); })) >= MIN_TITLE_SCORE;
    }).slice(0, MAX_PROBE_PAGES);
    return ranked.reduce(function (promise, candidate) {
      return promise.then(function (found) {
        if (found) return found;
        return _loadDetail(candidate.url).then(function (d) {
          return d.episodes.length ? d : null;
        }).catch(function () { return null; });
      });
    }, Promise.resolve(null)).then(function (found) {
      if (!found) throw new Error('AnimeHeaven has no entry for this title');
      return found;
    });
  });
}

// ── Stream extraction ──────────────────────────────────────────────────────
function _parseVideoUrls(html, gateKey) {
  var clean = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  var out = [], seen = {}, m;
  var srcRe = /<source\b[^>]*>/gi;
  while ((m = srcRe.exec(clean)) !== null) {
    var src = _attr(m[0], 'src');
    if (!src || !/\.mp4/i.test(src)) continue;
    if (gateKey && src.indexOf(gateKey) === -1) continue; // skip decoy clip
    if (seen[src]) continue;
    seen[src] = true;
    out.push(src);
  }
  return out;
}

function _mirrorLabel(url, index) {
  var host = '';
  try { host = String(url).replace(/^https?:\/\//i, '').split('/')[0].split('.')[0]; } catch (e) {}
  return host ? ('Mirror ' + (index + 1) + ' (' + host + ')') : ('Mirror ' + (index + 1));
}

function getVideoSources(episodeUrl, opts) {
  var raw = String(episodeUrl || '').replace('animeheaven://', '');
  var parts = raw.split('/');
  var gateKey = parts[0];
  var episodeNum = parseInt(parts[1], 10);
  if (!gateKey || !(episodeNum >= 1)) return Promise.reject(new Error('AnimeHeaven: invalid episode URL'));

  return _get(BASE + '/gate.php', BASE + '/', 'key=' + gateKey).then(function (html) {
    var urls = _parseVideoUrls(html, gateKey);
    if (!urls.length) throw new Error('AnimeHeaven episode ' + episodeNum + ' returned no video source');
    return urls.map(function (url, index) {
      var label = _mirrorLabel(url, index);
      return {
        url: url,
        quality: label,
        label: 'AnimeHeaven · ' + label,
        container: 'mp4',
        // The CDN accepts range requests with no Referer, so no header is required.
        headers: { 'User-Agent': UA },
        kind: 'sub',
        audioLang: 'ja',
        subtitles: []
      };
    });
  });
}

function getStreams(id, opts) { return getVideoSources(id, opts); }
function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    (rows || []).forEach(function (r) { (r.items || []).forEach(function (i) { out.push(i); }); });
    return out;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.1',
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    popular: popular,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams
  };
}
