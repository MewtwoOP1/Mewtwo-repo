// AnimeKhor — donghua source for the Zangetsu provider repo (animekhor.org).
//
// WordPress-based site. The catalogue is **donghua only** — a search for a Japanese title returns
// nothing — so this provider is meant for Chinese-origin titles.
//
//   /?s=<q>                 -> <article> cards; type badge in .typez (TV / Movie / Comic)
//   /anime/<slug>/          -> .eplister list; labels may be ranges ("637 to 638", "S4 E378-379")
//   /anime/<slug>/<ep>/     -> .mobius <select> holds base64-encoded <iframe> HTML per mirror
//
// Every mirror is a third-party player (Dailymotion, ok.ru, Rumble, emturbovid, abyssplayer …).
// The repository's contract does not support iframe embeds as playable streams, so each mirror is
// returned as a clearly-labelled embed only when it resolves to a direct/known player file.
// Mirrors that cannot be turned into a supported URL are dropped; the provider never fabricates a
// stream and never silently returns the iframe page as if it were a media file.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'animekhor';

var BASE = 'https://animekhor.org';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
var MIN_TITLE_SCORE = 0.28;
var MAX_PROBE_PAGES = 3;
var COUNT_PENALTY = 0.45;
var FORMAT_MISMATCH_PENALTY = 0.65;
var CACHE_TTL_MS = 30 * 60 * 1000;
var MAX_BATCH_SPAN = 26;
var MIN_ENCODED_LENGTH = 16;

var _detailCache = {};

function getInfo() {
  return { name: 'AnimeKhor', lang: 'en', baseUrl: BASE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animekhor.org', type: 'anime', version: '1.0.0' };
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

function _get(url, ref) {
  var h = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*', 'Referer': ref || BASE + '/' };
  return _raceTimeout(fetch(url, { headers: h }).then(function (r) {
    if (!r) throw new Error('AnimeKhor: empty response');
    if (!r.ok) throw new Error('AnimeKhor: HTTP ' + r.status);
    return r.text();
  }), 15000, null).then(function (v) {
    if (v == null) throw new Error('AnimeKhor: timeout for ' + url);
    return v;
  });
}

function _enc(value) { return encodeURIComponent(String(value || '')); }

function _stripTags(s) {
  var out = String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'");
  return out.trim();
}

// OK.ru renders its player config as entity-escaped JSON (`&quot;metadataUrl&quot;:&quot;…`), and
// the URLs inside it carry `\u0026`/`\/` escapes. Decode both before looking for a media URL.
function _decodePlayerConfig(text) {
  return String(text || '')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\\//g, '/');
}

function _attr(html, name) {
  var m = String(html || '').match(new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']*)'));
  return m ? m[1] : '';
}

function _abs(url) {
  url = String(url || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.indexOf('//') === 0) return 'https:' + url;
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
    if (t.english) out.push(t.english);
    if (t.romaji) out.push(t.romaji);
    if (t.native) out.push(t.native);
    if (t.userPreferred) out.push(t.userPreferred);
  }
  if (media && typeof media.title === 'string') out.push(media.title);
  return out.filter(function (x) { return x && String(x).trim(); });
}

// ── Search parsing ─────────────────────────────────────────────────────────
function _parseSearch(html) {
  var out = [], seen = {}, m;
  var articleRe = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  while ((m = articleRe.exec(html)) !== null) {
    var block = m[1];
    var aTag = block.match(/<a\b[^>]*>/i);
    if (!aTag) continue;
    var href = _attr(aTag[0], 'href');
    if (!href || !/\/anime\//.test(href)) continue;
    var url = _abs(href);
    if (seen[url]) continue;
    var title = _stripTags(_attr(aTag[0], 'title'));
    if (!title) {
      var h2 = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
      if (h2) title = _stripTags(h2[1]);
    }
    if (!title) continue;
    var typeMatch = block.match(/<div\b[^>]*class\s*=\s*["'][^"']*\btypez\b\s*([^"']*)["']/i);
    var type = typeMatch ? _stripTags(typeMatch[1]) : '';
    var cover = '';
    var img = block.match(/<img\b[^>]*>/i);
    if (img) {
      cover = _abs(_attr(img[0], 'src'));
      if (!cover) cover = _abs(_attr(img[0], 'data-src'));
    }
    seen[url] = true;
    out.push({ id: url, title: title.trim(), url: url, cover: cover || null,
      type: 'anime', sourceId: SOURCE_ID, badge: type || null,
      isMovie: /movie/i.test(type), isComic: /comic/i.test(type) });
  }
  return out;
}

// ── Episode parsing ────────────────────────────────────────────────────────
function _episodeNumbers(label) {
  var body = String(label || '').trim().replace(/^S\d+\s*/i, '').replace(/\bE(?=\d)/gi, '');
  var nums = body.match(/\d+/g);
  if (!nums || !nums.length) return [];
  nums = nums.map(function (n) { return parseInt(n, 10); }).filter(function (n) { return n > 0; });
  if (!nums.length) return [];
  if (nums.length === 1) return [nums[0]];
  var first = nums[0], last = nums[nums.length - 1];
  if (last >= first && last <= first + MAX_BATCH_SPAN) {
    var range = [];
    for (var i = first; i <= last; i++) range.push(i);
    return range;
  }
  return [first];
}

function _parseEpisodes(html) {
  var listMatch = html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\beplister\b[^"']*["'][^>]*>/i);
  if (!listMatch) return [];
  var listStart = listMatch.index + listMatch[0].length;
  var ulEnd = html.indexOf('</ul>', listStart);
  var listHtml = html.substring(listStart, ulEnd < 0 ? html.length : ulEnd);
  var map = {}, order = [], m;
  var liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = liRe.exec(listHtml)) !== null) {
    var block = m[1];
    var aTag = block.match(/<a\b[^>]*>/i);
    if (!aTag) continue;
    var href = _attr(aTag[0], 'href');
    if (!href) continue;
    var url = _abs(href);
    var numDiv = block.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bepl-num\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    var label = numDiv ? _stripTags(numDiv[1]) : '';
    if (!label) {
      // Some themes put the number in the anchor text itself.
      label = _stripTags(aTag[0].replace(/<[^>]*>/g, '')) || _stripTags(block);
    }
    var nums = _episodeNumbers(label);
    nums.forEach(function (num) {
      if (!map[num]) { map[num] = url; order.push(num); }
    });
  }
  return order.sort(function (a, b) { return a - b; }).map(function (num) {
    return { number: num, url: map[num] };
  });
}

// ── Detail ─────────────────────────────────────────────────────────────────
function _normalizeUrl(url) {
  var s = String(url || '').trim();
  if (!s) return '';
  if (s.indexOf('animekhor://') === 0) s = s.slice('animekhor://'.length);
  if (!/^https?:\/\//i.test(s)) s = _abs(s);
  return s;
}

function _episodeObject(seriesUrl, ep) {
  var enc = encodeURIComponent(seriesUrl);
  return {
    id: 'animekhor://' + enc + '/' + ep.number,
    number: ep.number,
    title: 'Episode ' + ep.number,
    url: 'animekhor://' + enc + '/' + ep.number,
    category: 'sub',
    type: 'anime',
    sourceId: SOURCE_ID
  };
}

function _loadDetail(url) {
  var seriesUrl = _normalizeUrl(url);
  if (!seriesUrl) return Promise.reject(new Error('AnimeKhor: invalid series URL'));
  var cached = _detailCache[seriesUrl];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.detail);

  return _get(seriesUrl, BASE + '/').then(function (html) {
    var title = '';
    var h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) title = _stripTags(h1[1]);
    if (!title) {
      var og = html.match(/property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)/i);
      if (og) title = _stripTags(og[1]).replace(/\s*[|-]\s*AnimeKhor.*$/i, '');
    }
    if (!title) title = seriesUrl.split('/').filter(Boolean).pop() || 'AnimeKhor';
    var cover = '';
    var ogImg = html.match(/property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)/i);
    if (ogImg) cover = ogImg[1];
    var description = '';
    var desc = html.match(/class\s*=\s*["'][^"']*(?:description|synopsis|entry-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
    if (desc) description = _stripTags(desc[1]);
    var year = null;
    var ym = description.match(/(19|20)\d{2}/) || html.match(/(19|20)\d{2}/);
    if (ym) year = ym[0];
    var episodes = _parseEpisodes(html).map(function (ep) { return _episodeObject(seriesUrl, ep); });
    var detail = {
      id: seriesUrl,
      title: title.trim(),
      url: seriesUrl,
      cover: cover || null,
      description: description,
      status: 'unknown',
      genres: [],
      type: 'anime',
      sourceId: SOURCE_ID,
      episodes: episodes,
      year: year,
      subCount: episodes.length,
      dubCount: 0
    };
    _detailCache[seriesUrl] = { at: Date.now(), detail: detail };
    return detail;
  });
}

// ── Mirrors ────────────────────────────────────────────────────────────────
function _base64Decode(s) {
  try {
    var clean = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (clean.length % 4) clean += '=';
    return atob(clean);
  } catch (e) { return ''; }
}

function _extractIframeSrc(html) {
  var m, re = /<iframe\b[^>]*>/gi;
  while ((m = re.exec(html)) !== null) {
    var src = _attr(m[0], 'src');
    if (!src) src = _attr(m[0], 'data-src');
    if (!src) continue;
    return _abs(src.trim());
  }
  return null;
}

function _parseMirrors(html) {
  var selectMatch = html.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bmobius\b[^"']*["'][^>]*>/i)
    || html.match(/<select\b[^>]*class\s*=\s*["'][^"']*\bmobius\b[^"']*["'][^>]*>/i);
  var segment = '';
  if (selectMatch) {
    var start = selectMatch.index + selectMatch[0].length;
    var end = html.indexOf('</select>', start);
    segment = html.substring(start, end < 0 ? html.length : end);
  }
  var mirrors = [], seen = {}, m;
  var optRe = /<option\b[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi;
  while ((m = optRe.exec(segment)) !== null) {
    var encoded = m[1].trim();
    if (encoded.length < MIN_ENCODED_LENGTH) continue;
    var decoded = _base64Decode(encoded);
    if (!decoded) continue;
    var src = _extractIframeSrc(decoded);
    if (!src || seen[src]) continue;
    seen[src] = true;
    var label = _stripTags(m[2]).trim();
    mirrors.push({ label: label || _hostLabel(src), url: src });
  }
  if (!mirrors.length) {
    var inline = _extractIframeSrc(html);
    if (inline) mirrors.push({ label: _hostLabel(inline), url: inline });
  }
  return mirrors;
}

function _hostLabel(url) {
  var host = '';
  try { host = String(url).replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./, ''); } catch (e) {}
  var name = host ? host.split('.')[0] : 'Mirror';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Resolve a third-party mirror to a supported playable URL where the host exposes one without
// browser automation. Dailymotion, ok.ru and Rumble all publish an og:video / JSON metadata that
// can be read over plain HTTP; other hosts are returned as an explicit embed only when they are
// one of the players whose page URL the repository's player can open (none by default).
function _resolveEmbed(mirror) {
  var url = mirror.url;
  var host = '';
  try { host = String(url).replace(/^https?:\/\//i, '').split('/')[0].toLowerCase(); } catch (e) {}

  if (/dailymotion\.com|dai\.ly/.test(host)) return _resolveDailymotion(url, mirror.label);
  if (/ok\.ru/.test(host)) return _resolveOkRu(url, mirror.label);
  if (/rumble\.com/.test(host)) return _resolveRumble(url, mirror.label);
  if (/emturbovid|abyssplayer|streamtape|vidhide|dood|voe\.sx|filemoon|mixdrop/.test(host)) {
    // These require per-host extraction the repository has no resolver for. Return nothing rather
    // than a page URL disguised as a stream.
    return Promise.resolve([]);
  }
  return Promise.resolve([]);
}

function _resolveDailymotion(url, label) {
  var id = '';
  var m = String(url).match(/\/video\/([a-zA-Z0-9]+)/) || String(url).match(/dai\.ly\/([a-zA-Z0-9]+)/);
  if (m) id = m[1];
  if (!id) return Promise.resolve([]);
  // The public player metadata exposes progressive MP4 and HLS URLs.
  return _get('https://www.dailymotion.com/player/metadata/video/' + id, BASE + '/').then(function (body) {
    var data;
    try { data = JSON.parse(body); } catch (e) { return []; }
    var qualities = (data && data.qualities) || {};
    var out = [], seen = {};
    function push(url, quality, type) {
      if (!url || seen[url]) return;
      seen[url] = true;
      var hls = /\.m3u8(?:[?#]|$)/i.test(url) || /mpegurl/i.test(String(type || ''));
      out.push({
        url: url,
        quality: quality,
        label: (label || 'Dailymotion') + ' · ' + quality,
        container: hls ? 'hls' : 'mp4',
        headers: { 'User-Agent': UA, 'Referer': 'https://www.dailymotion.com/' },
        kind: 'sub',
        audioLang: 'zh',
        subtitles: []
      });
    }
    // 'auto' is normally the HLS master; keep it first.
    (qualities['auto'] || []).forEach(function (item) { push(item && item.url, 'Auto', item && item.type); });
    ['1080', '720', '480', '380', '240'].forEach(function (q) {
      (qualities[q] || []).forEach(function (item) { push(item && item.url, q + 'p', item && item.type); });
    });
    return out;
  }).catch(function () { return []; });
}

function _resolveOkRu(url, label) {
  return _get(url, BASE + '/').then(function (raw) {
    var html = _decodePlayerConfig(raw);
    var out = [], seen = {};
    function push(mediaUrl, quality, type) {
      if (!mediaUrl || seen[mediaUrl]) return;
      seen[mediaUrl] = true;
      var hls = /\.m3u8(?:[?#]|$)/i.test(mediaUrl) || /mpegurl/i.test(String(type || ''));
      out.push({
        url: mediaUrl,
        quality: quality || 'Auto',
        label: (label || 'OK.ru') + ' · ' + (quality || 'Auto'),
        container: hls ? 'hls' : 'mp4',
        headers: { 'User-Agent': UA, 'Referer': 'https://ok.ru/' },
        kind: 'sub',
        audioLang: 'zh',
        subtitles: []
      });
    }

    // The embed already carries the HLS manifest; use it before spending a second request.
    var hls = html.match(/"hlsManifestUrl"\s*:\s*"([^"]+)"/i);
    if (hls && hls[1]) push(hls[1], 'Auto', 'hls');
    if (out.length) return out;

    var match = html.match(/"metadataUrl"\s*:\s*"([^"]+)"/i)
      || html.match(/data-module\s*=\s*"OKVideo"[^>]*data-metadata-url\s*=\s*"([^"]+)"/i)
      || html.match(/"videoUrl"\s*:\s*"([^"]+)"/i);
    if (!match) return out;
    var metaUrl = match[1];
    if (metaUrl.indexOf('//') === 0) metaUrl = 'https:' + metaUrl;
    if (!/^https?:/i.test(metaUrl)) return out;
    return _get(metaUrl, url).then(function (body) {
      var data;
      try { data = JSON.parse(body); } catch (e) { return out; }
      var videos = (data && data.videos) || [];
      videos.forEach(function (v) {
        if (v && v.url) push(v.url, v.name || 'Auto');
      });
      return out;
    }).catch(function () { return out; });
  }).catch(function () { return []; });
}

function _resolveRumble(url, label) {
  return _get(url, BASE + '/').then(function (html) {
    var out = [], seen = {};
    var re = /"(?:videoUrl|url)"\s*:\s*"(https?:\\?\/\\?\/[^"]+?\.mp4[^"]*)"/gi, m;
    while ((m = re.exec(html)) !== null) {
      var u = m[1].replace(/\\\//g, '/');
      if (seen[u]) continue;
      seen[u] = true;
      out.push({
        url: u, quality: 'Auto', label: (label || 'Rumble') + ' · Auto', container: 'mp4',
        headers: { 'User-Agent': UA, 'Referer': 'https://rumble.com/' },
        kind: 'sub', audioLang: 'zh', subtitles: []
      });
    }
    return out;
  }).catch(function () { return []; });
}

// ── Public API ─────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q || (page && page > 1)) return Promise.resolve([]);
  return _get(BASE + '/?s=' + _enc(q), BASE + '/')
    .then(_parseSearch)
    .catch(function () { return []; });
}

function getHome(opts) {
  return _get(BASE + '/', BASE + '/').then(function (html) {
    var items = _parseSearch(html).filter(function (i) { return !i.isComic; });
    return items.length ? [{ title: 'Donghua on AnimeKhor', items: items.slice(0, 40) }] : [];
  }).catch(function () { return []; });
}

function getDetail(url, opts) {
  return _loadDetail(url);
}

function getEpisodes(url, opts) {
  return _loadDetail(url).then(function (d) { return d.episodes; });
}

function _parseEpisodeUrl(episodeUrl) {
  var raw = String(episodeUrl || '');
  if (raw.indexOf('animekhor://') === 0) raw = raw.slice('animekhor://'.length);
  var slash = raw.lastIndexOf('/');
  if (slash < 0) return null;
  var seriesEnc = raw.slice(0, slash);
  var num = parseInt(raw.slice(slash + 1), 10);
  if (!(num >= 1)) return null;
  var seriesUrl;
  try { seriesUrl = decodeURIComponent(seriesEnc); } catch (e) { return null; }
  return { seriesUrl: seriesUrl, number: num };
}

function getVideoSources(episodeUrl, opts) {
  var parsed = _parseEpisodeUrl(episodeUrl);
  if (!parsed) return Promise.reject(new Error('AnimeKhor: invalid episode URL'));

  return _loadDetail(parsed.seriesUrl).then(function (detail) {
    var ep = null;
    for (var i = 0; i < detail.episodes.length; i++) {
      if (detail.episodes[i].number === parsed.number) { ep = detail.episodes[i]; break; }
    }
    // The series page maps each number to its own page. Re-parse to get that page URL.
    return _get(parsed.seriesUrl, BASE + '/').then(function (seriesHtml) {
      var pages = _parseEpisodes(seriesHtml);
      var pageUrl = null;
      for (var j = 0; j < pages.length; j++) if (pages[j].number === parsed.number) { pageUrl = pages[j].url; break; }
      if (!pageUrl) throw new Error('AnimeKhor episode ' + parsed.number + ' is not listed');
      return _get(pageUrl, parsed.seriesUrl).then(function (epHtml) {
        var mirrors = _parseMirrors(epHtml);
        if (!mirrors.length) throw new Error('AnimeKhor episode ' + parsed.number + ' has no mirrors');
        return mirrors.reduce(function (promise, mirror) {
          return promise.then(function (streams) {
            if (streams && streams.length) return streams;
            return _resolveEmbed(mirror);
          });
        }, Promise.resolve(null)).then(function (streams) {
          if (!streams || !streams.length) {
            throw new Error('AnimeKhor episode ' + parsed.number +
              ' has mirrors that require an unsupported player: ' +
              mirrors.map(function (m) { return m.label; }).join(', '));
          }
          return streams;
        });
      });
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
    version: '1.0.0',
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