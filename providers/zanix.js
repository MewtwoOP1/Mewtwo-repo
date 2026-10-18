// Zanix anime provider for Zangetsu.
// Implements the site's HTML catalogue, session-bound episode endpoint,
// and the current cdn.4animo.xyz embed -> sources JSON -> HLS playback chain.

var SOURCE_ID = 'zanix';
var SITE = 'https://zanix.tr';
var EMBED_CDN = 'https://cdn.4animo.xyz';
var VERSION = '1.0.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
var detailCache = {};
var DETAIL_TTL = 300000;

function getInfo() {
  return { name: 'Zanix', lang: 'en', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=zanix.tr',
    type: 'anime', version: VERSION };
}
function getSettings() { return []; }

function _headers(extra, ref, xhr) {
  var h = { 'User-Agent': UA, 'Referer': ref || SITE + '/' };
  if (xhr) {
    h['X-Requested-With'] = 'XMLHttpRequest';
    h['Accept'] = 'application/json, text/javascript, */*; q=0.01';
  }
  var k;
  for (k in (extra || {})) if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
  return h;
}
function _request(url, ref, xhr, extra) {
  return fetch(url, { headers: _headers(extra, ref, xhr), timeoutMs: 12000 }).then(function (r) {
    r = r || {};
    var status = Number(r.status || 0);
    if (status >= 400) throw new Error('Zanix: HTTP ' + status + ' for ' + url);
    return { status: status, body: String(r.body || ''), headers: r.headers || {}, url: r.url || url };
  });
}
function _text(s) {
  s = String(s || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ');
  try { return htmlText(s).replace(/\s+/g, ' ').trim(); }
  catch (e) { return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim(); }
}
function _attr(tag, name) {
  var re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(["\\'])([\\s\\S]*?)\\1', 'i');
  var m = String(tag || '').match(re);
  return m ? m[2] : '';
}
function _abs(url, base) {
  var u = String(url || '').trim();
  if (!u) return '';
  try { return new URL(u, base || SITE + '/').toString(); }
  catch (e) {
    if (/^https?:\/\//i.test(u)) return u;
    return (base || SITE + '/').replace(/\/+$/, '') + '/' + u.replace(/^\/+/, '');
  }
}
function _slug(input) {
  var s = String(input || '').trim().replace(/[?#].*$/, '');
  s = s.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '');
  var p = s.split('/');
  s = p[p.length - 1] || '';
  try { s = decodeURIComponent(s); } catch (e) {}
  return s;
}
function _year(s) {
  var m = String(s || '').match(/\b(?:19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}
function _bool(v, fallback) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null) return false;
  var s = String(v == null ? '' : v).toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === '') return fallback;
  return fallback;
}
function _responseHeader(headers, name) {
  if (!headers) return '';
  var lower = String(name).toLowerCase(), k;
  for (k in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, k) && String(k).toLowerCase() === lower) {
      return headers[k];
    }
  }
  return '';
}
function _cookieHeader(headers) {
  var raw = _responseHeader(headers, 'set-cookie');
  if (Array.isArray(raw)) raw = raw.join(', ');
  raw = String(raw || '');
  if (!raw) return '';
  // Set-Cookie may be serialized as a combined header. Split only at cookie
  // boundaries so commas in an Expires attribute are not treated as cookies.
  var pieces = raw.split(/,\s*(?=[A-Za-z0-9_.-]+\s*=)/), out = [];
  for (var i = 0; i < pieces.length; i++) {
    var pair = String(pieces[i]).split(';')[0].trim();
    if (/^[A-Za-z0-9_.-]+\s*=/.test(pair) && out.indexOf(pair) < 0) out.push(pair);
  }
  return out.join('; ');
}

// Parse the HiAnime-family cards used by Zanix. A title's canonical slug is
// the final path segment; all accepted titles end in the site's numeric ID.
function _cards(html) {
  var out = [], seen = {}, m;
  var re = /<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bflw-item\b[^"']*["'])[^>]*>([\s\S]*?)(?=<div\b(?=[^>]*\bclass\s*=\s*["'][^"']*\bflw-item\b)|<\/section\s*>|<footer\b|$)/gi;
  while ((m = re.exec(String(html || ''))) !== null) {
    var block = m[1], anchors = [], am;
    var ar = /<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi;
    while ((am = ar.exec(block)) !== null) {
      var slug = _slug(am[2]);
      if (/-\d+$/.test(slug)) anchors.push({ slug: slug, tag: am[0], inner: am[3], href: am[2] });
    }
    if (!anchors.length) continue;
    var a = anchors[0];
    for (var ai = 0; ai < anchors.length; ai++) {
      if (/\bfilm-name\b/i.test(anchors[ai].tag)) { a = anchors[ai]; break; }
    }
    var title = _attr(a.tag.substring(0, a.tag.indexOf('>') + 1), 'title') || _text(a.inner);
    if (!title) title = a.slug.replace(/-\d+$/, '').replace(/-/g, ' ');
    if (seen[a.slug]) continue;
    seen[a.slug] = 1;
    var img = (block.match(/<img\b[^>]*>/i) || [''])[0];
    var cover = _attr(img, 'data-src') || _attr(img, 'data-lazy-src') || _attr(img, 'src');
    out.push({ id: a.slug, title: _text(title), englishTitle: _text(title),
      url: a.slug, cover: cover ? _abs(cover, SITE + '/') : null,
      type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}
function getHome(opts) {
  return _request(SITE + '/most-popular?page=1', SITE + '/', false).then(function (r) {
    var items = _cards(r.body);
    return items.length ? [{ title: 'Popular on Zanix', items: items }] : [];
  }).catch(function () { return []; });
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page || 1, 10) || 1);
  return _request(SITE + '/search?keyword=' + encodeURIComponent(q) + '&page=' + p, SITE + '/', false)
    .then(function (r) { return _cards(r.body); })
    .catch(function () { return []; });
}
function _labelValue(html, label) {
  var s = String(html || '');
  var re = new RegExp('<(?:span|div)\\b[^>]*class=["\\'][^"\\']*item-head[^"\\']*["\\'][^>]*>\\s*' + label + '\\s*:?\\s*<\\/[^>]+>([\\s\\S]{0,1000}?)(?=<(?:span|div)\\b[^>]*class=["\\'][^"\\']*item-head|<\\/div>\\s*<\\/div>)', 'i');
  var m = s.match(re);
  return m ? _text(m[1]) : '';
}
function _listValue(html, label, cap) {
  var s = String(html || ''), at = s.toLowerCase().indexOf('>' + label.toLowerCase() + ':');
  if (at < 0) return [];
  var end = s.indexOf('item-head', at + label.length + 1);
  var chunk = s.substring(at, end < 0 ? Math.min(s.length, at + 1800) : end);
  var out = [], seen = {}, m, re = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = re.exec(chunk)) !== null && out.length < cap) {
    var t = _text(m[1]);
    if (t && !seen[t]) { seen[t] = 1; out.push(t); }
  }
  return out;
}
function _parseEpisodePayload(body) {
  var j;
  try { j = JSON.parse(body || 'null'); } catch (e) { return []; }
  var eps = Array.isArray(j) ? j : (j && Array.isArray(j.episodes) ? j.episodes :
    (j && j.data && Array.isArray(j.data.episodes) ? j.data.episodes : []));
  var out = [];
  for (var i = 0; i < eps.length; i++) {
    var e = eps[i] || {}, id = e.id == null ? '' : String(e.id);
    if (!id) continue;
    var number = Number(e.number);
    if (!isFinite(number) || number <= 0) number = Number(e.episodeNumber);
    if (!isFinite(number) || number <= 0) number = i + 1;
    var embedId = e.embed_id == null || String(e.embed_id) === '' ? id : String(e.embed_id);
    var titles = e.titles || {};
    var title = titles.en || titles.romaji || titles.ja || e.title || '';
    var hasSub = _bool(e.sub, true), hasDub = _bool(e.dub, false);
    out.push({ id: SOURCE_ID + '-' + id, number: number,
      title: title && !/^episode\s*\d+$/i.test(String(title)) ? 'Episode ' + number + ': ' + _text(title) : 'Episode ' + number,
      url: 'zanix://' + encodeURIComponent(id) + '/' + encodeURIComponent(embedId) + '/' + number + '/' + (hasSub ? '1' : '0') + '/' + (hasDub ? '1' : '0'),
      thumbnail: e.thumbnail ? _abs(e.thumbnail, SITE + '/') : null,
      sourceId: SOURCE_ID, type: 'anime' });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}
function _loadEpisodes(slug) {
  var numeric = (String(slug || '').match(/-(\d+)$/) || [])[1];
  if (!numeric) return Promise.resolve([]);
  var watchUrl = SITE + '/watch/' + encodeURIComponent(slug) + '?ep=1';
  return _request(watchUrl, SITE + '/', false).then(function (watch) {
    var tokenMatch = watch.body.match(/window\.AJAX_TOKEN\s*=\s*["']([^"']+)["']/i);
    var scriptId = watch.body.match(/\blet\s+animeId\s*=\s*(\d+)/i) ||
      watch.body.match(/\b(?:var|const)\s+animeId\s*=\s*(\d+)/i);
    var animeId = scriptId ? scriptId[1] : numeric;
    if (!tokenMatch) throw new Error('Zanix: watch page did not expose AJAX_TOKEN');
    var cookie = _cookieHeader(watch.headers);
    var extra = { 'X-Page-Token': tokenMatch[1] };
    if (cookie) extra.Cookie = cookie;
    var endpoint = SITE + '/ajax/episodes?animeId=' + encodeURIComponent(animeId);
    return _request(endpoint, watchUrl, true, extra).then(function (r) {
      var episodes = _parseEpisodePayload(r.body);
      if (!episodes.length) throw new Error('Zanix: episode endpoint returned no parseable episodes');
      return episodes;
    }).catch(function (err) {
      // A token and its session cookie are coupled. Re-bootstrap once in case a
      // stale/rotated session caused a forbidden endpoint response.
      if (!/HTTP 401|HTTP 403|forbidden|token|session/i.test(String(err && err.message || err))) throw err;
      return _request(watchUrl, SITE + '/', false).then(function (again) {
        var tm = again.body.match(/window\.AJAX_TOKEN\s*=\s*["']([^"']+)["']/i);
        if (!tm) throw err;
        var ck = _cookieHeader(again.headers), ex = { 'X-Page-Token': tm[1] };
        if (ck) ex.Cookie = ck;
        return _request(endpoint, watchUrl, true, ex).then(function (second) {
          var parsed = _parseEpisodePayload(second.body);
          if (!parsed.length) throw err;
          return parsed;
        });
      });
    });
  });
}
var _detailCache = {};
function getDetail(url, opts) {
  var slug = _slug(url);
  if (!/-\d+$/.test(slug)) return Promise.resolve(null);
  var cached = _detailCache[slug];
  if (cached && Date.now() - cached.at < DETAIL_TTL) return Promise.resolve(cached.value);
  return _request(SITE + '/' + encodeURIComponent(slug), SITE + '/', false).then(function (r) {
    var html = r.body;
    var h1 = (html.match(/<h1\b[^>]*class=["'][^"']*\bfilm-name\b[^"']*["'][^>]*>[\s\S]*?<\/h1>/i) || [''])[0];
    var title = _text(h1) || _attr(h1.substring(0, h1.indexOf('>') + 1), 'title') || slug.replace(/-\d+$/, '').replace(/-/g, ' ');
    var posterTag = (html.match(/<img\b[^>]*(?:data-src|src)=["'][^"']*["'][^>]*>/i) || [''])[0];
    var poster = '';
    var posterBlock = (html.match(/class=["'][^"']*\banisc-poster\b[^"']*["'][\s\S]{0,700}/i) || [''])[0];
    var pi = (posterBlock.match(/<img\b[^>]*>/i) || [''])[0];
    poster = _attr(pi, 'data-src') || _attr(pi, 'src') || _attr(posterTag, 'data-src') || _attr(posterTag, 'src');
    var description = '';
    var descBlock = (html.match(/class=["'][^"']*\banisc-info\b[^"']*["'][\s\S]{0,4000}/i) || [''])[0];
    description = _text((descBlock.match(/class=["'][^"']*\btext\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i) || [])[1] || '');
    var status = _labelValue(html, 'Status') || 'unknown';
    var genres = _listValue(html, 'Genres', 12);
    var studios = _listValue(html, 'Studios', 8);
    return _loadEpisodes(slug).catch(function () { return []; }).then(function (episodes) {
      var result = { id: slug, title: title, englishTitle: title,
        url: slug, cover: poster ? _abs(poster, SITE + '/') : null,
        description: description, status: status, genres: genres, studios: studios,
        year: _year(_labelValue(html, 'Aired')), type: 'anime',
        sourceId: SOURCE_ID, episodes: episodes };
      if (episodes.length) _detailCache[slug] = { at: Date.now(), value: result };
      return result;
    });
  }).catch(function () { return null; });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d && Array.isArray(d.episodes) ? d.episodes : []; });
}
function _parseSources(body) {
  var j;
  try { j = JSON.parse(body || 'null'); } catch (e) { return null; }
  var data = j && j.data ? j.data : j;
  var raw = data && data.sources, file = '';
  if (Array.isArray(raw)) {
    for (var i = 0; i < raw.length; i++) {
      if (raw[i] && typeof raw[i].file === 'string' && raw[i].file) { file = raw[i].file; break; }
    }
  } else if (raw && typeof raw === 'object' && typeof raw.file === 'string') file = raw.file;
  if (!file && data && typeof data.file === 'string') file = data.file;
  if (!file) return null;
  var tracks = Array.isArray(data.tracks) ? data.tracks : [];
  var subtitles = [];
  for (var t = 0; t < tracks.length; t++) {
    var tr = tracks[t];
    if (!tr || !tr.file) continue;
    if (tr.kind && tr.kind !== 'captions' && tr.kind !== 'subtitles') continue;
    var subtitleUrl = _abs(tr.file, EMBED_CDN + '/');
    subtitles.push({ url: subtitleUrl, lang: tr.label || tr.lang || 'Subtitle',
      label: tr.label || tr.lang || 'Subtitle',
      format: /\.srt(?:\?|$)/i.test(tr.file) ? 'srt' : 'vtt',
      'default': !!tr['default'] });
  }
  return { file: _abs(file, EMBED_CDN + '/'), subtitles: subtitles };
}
function _streamList(file, lang, subtitles, embedUrl) {
  var origin = '';
  try { origin = new URL(embedUrl).origin; } catch (e) { origin = EMBED_CDN; }
  var headers = { 'User-Agent': UA, 'Referer': origin + '/', 'Origin': origin };
  function mk(url, quality) {
    return { url: url, name: 'Zanix', provider: 'Zanix', quality: quality,
      container: /\.m3u8(?:\?|$)/i.test(url) ? 'hls' : 'mp4',
      hls: /\.m3u8(?:\?|$)/i.test(url), embed: false, downloadable: false,
      kind: lang, audioLang: lang === 'dub' ? 'en' : 'ja', headers: headers,
      subtitles: subtitles || [] };
  }
  if (!/\.m3u8(?:\?|$)/i.test(file)) return Promise.resolve([mk(file, 'auto')]);
  return _request(file, headers.Referer, false, { 'Origin': origin }).then(function (r) {
    var body = r.body || '', lines = body.split(/\r?\n/), variants = [];
    if (body.indexOf('#EXTM3U') < 0) throw new Error('Zanix: stream URL did not return an HLS playlist');
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i] || '').trim();
      if (line.indexOf('#EXT-X-STREAM-INF:') !== 0) continue;
      var meta = line, height = (meta.match(/RESOLUTION=\d+x(\d+)/i) || [])[1] || '';
      var next = '';
      for (var j = i + 1; j < lines.length; j++) {
        var candidate = String(lines[j] || '').trim();
        if (!candidate || candidate.charAt(0) === '#') continue;
        next = candidate; break;
      }
      if (next) variants.push({ url: _abs(next, file), quality: height ? height + 'p' : 'auto' });
    }
    variants.sort(function (a, b) {
      var ah = parseInt(a.quality, 10) || 0, bh = parseInt(b.quality, 10) || 0;
      return bh - ah;
    });
    var out = [mk(file, 'auto')];
    var seen = {};
    for (var v = 0; v < variants.length; v++) {
      if (seen[variants[v].url] || variants[v].url === file) continue;
      seen[variants[v].url] = 1;
      out.push(mk(variants[v].url, variants[v].quality));
    }
    return out;
  }).catch(function () {
    // Keep the verified media URL as adaptive playback when variant probing is
    // blocked; callers can still try the next server if source extraction fails.
    return [mk(file, 'auto')];
  });
}
function _sourceUrl(value, embedUrl) {
  return _abs(value, embedUrl);
}
function _extractEmbed(embedUrl, lang) {
  return _request(embedUrl, SITE + '/', false).then(function (embed) {
    var sourceMatch = embed.body.match(/(?:var|let|const)\s+sourcesUrl\s*=\s*(['"])([\s\S]*?)\1/i);
    if (!sourceMatch) throw new Error('Zanix: embed did not expose sourcesUrl');
    var endpoint = _sourceUrl(sourceMatch[2], embedUrl);
    var host;
    try { host = new URL(embedUrl).origin; } catch (e) { host = EMBED_CDN; }
    return _request(endpoint, embedUrl, true, { 'Origin': host }).then(function (r) {
      var payload = _parseSources(r.body);
      if (!payload) throw new Error('Zanix: source endpoint did not contain a plain media URL');
      return _streamList(payload.file, lang, payload.subtitles, embedUrl);
    });
  });
}
function _tryEmbeds(list, at, lang) {
  if (at >= list.length) return Promise.resolve([]);
  return _extractEmbed(list[at].url, lang).then(function (streams) {
    return streams && streams.length ? streams : _tryEmbeds(list, at + 1, lang);
  }).catch(function () { return _tryEmbeds(list, at + 1, lang); });
}
function getVideoSources(episodeUrl, opts) {
  var m = String(episodeUrl || '').match(/^zanix:\/\/([^/]+)\/([^/]+)\/([^/]+)\/([01])\/([01])$/i);
  if (!m) return Promise.resolve([]);
  var epId, embedId;
  try { epId = decodeURIComponent(m[1]); embedId = decodeURIComponent(m[2]); }
  catch (e) { return Promise.resolve([]); }
  var cat = opts && opts.category === 'dub' ? 'dub' : 'sub';
  var hasSub = m[4] === '1', hasDub = m[5] === '1';
  if ((cat === 'dub' && !hasDub) || (cat === 'sub' && !hasSub)) return Promise.resolve([]);
  var candidates = [
    { url: EMBED_CDN + '/embed/hd-1/' + encodeURIComponent(epId) + '/' + cat + '?k=1' },
    { url: EMBED_CDN + '/embed/hd-2/' + encodeURIComponent(epId) + '/' + cat + '?k=1' },
    { url: EMBED_CDN + '/embed/s-1/' + encodeURIComponent(embedId) + '/' + cat + '?k=1' }
  ];
  return _tryEmbeds(candidates, 0, cat);
}
function getStreams(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams };
}
