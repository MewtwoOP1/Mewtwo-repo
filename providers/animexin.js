// AnimeXin provider for Zangetsu. Site pages are server-rendered HTML;
// resolve episode embeds at request time because third-party URLs can expire.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animexin';
var VERSION = '1.0.1';
var SITE = 'https://animexin.dev';
var ARCHIVE = SITE + '/anime/?order=update&status=&type=';
var ODYSEE_API = 'https://api.na-backend.odysee.com/api/v1/proxy?m=get';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var REQUEST_TIMEOUT = 12000;

function getInfo() {
  return { name: 'AnimeXin', lang: 'en', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=animexin.dev', type: 'anime', version: VERSION };
}
function getSettings() { return []; }

function _request(url, options) {
  options = options || {};
  options.timeoutMs = options.timeoutMs || REQUEST_TIMEOUT;
  options.headers = options.headers || {};
  if (!options.headers['User-Agent']) options.headers['User-Agent'] = UA;
  return fetch(url, options).then(function (r) {
    var status = Number(r && r.status || 200);
    if (status >= 400) throw new Error('AnimeXin HTTP ' + status);
    if (r && typeof r.body === 'string') return r.body;
    if (r && typeof r.text === 'function') return r.text();
    if (r && r.body && typeof r.body.text === 'function') return r.body.text();
    throw new Error('AnimeXin: empty HTTP response');
  });
}
function _get(url, referer) {
  return _request(url, { headers: {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': referer || SITE + '/'
  }});
}
function _postJson(url, body, referer) {
  return _request(url, { method: 'POST', body: JSON.stringify(body), headers: {
    'Accept': 'application/json,text/plain,*/*',
    'Content-Type': 'application/json',
    'Origin': 'https://odysee.com',
    'Referer': referer || 'https://odysee.com/'
  }}).then(function (raw) {
    try { return JSON.parse(raw); }
    catch (e) { throw new Error('AnimeXin: invalid player JSON'); }
  });
}
function _decodeEntities(s) {
  return String(s || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([\da-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
}
function _text(s) {
  return _decodeEntities(String(s || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function _decodeUrl(s) {
  var out = _decodeEntities(String(s || '').trim()).replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
  try { out = decodeURIComponent(out.replace(/&amp;/g, '&')); } catch (e) { /* retain valid partial URL */ }
  return out.replace(/["'<>\s]+$/g, '');
}
function _attr(attrs, name) {
  var re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  var m = String(attrs || '').match(re);
  return m ? (m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]) : '';
}
function _tagValue(html, tagName, attrName) {
  var re = new RegExp('<' + tagName + '\\b([^>]*)>', 'gi'), m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var val = _attr(m[1], attrName);
    if (val) return _decodeUrl(val);
  }
  return '';
}
function _meta(html, key) {
  var re = /<meta\b([^>]*)>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var attrs = m[1], name = _attr(attrs, 'property') || _attr(attrs, 'name') || _attr(attrs, 'itemprop');
    if (String(name).toLowerCase() === String(key).toLowerCase()) return _decodeEntities(_attr(attrs, 'content'));
  }
  return '';
}
function _absolute(raw, base) {
  var s = _decodeUrl(raw);
  if (!s) return '';
  if (s.indexOf('//') === 0) s = 'https:' + s;
  try { return new URL(s, base || SITE + '/').href; }
  catch (e) {
    if (/^https?:\/\//i.test(s)) return s;
    if (s.charAt(0) === '/') return SITE + s;
    return (base || SITE + '/') + s;
  }
}
function _path(url) {
  var m = String(url || '').match(/^https?:\/\/[^/]+([^?#]*)/i);
  return m ? (m[1] || '/') : String(url || '').split(/[?#]/)[0];
}
function _slug(url) {
  var p = _path(_absolute(url, SITE + '/')).replace(/\/+$/, '');
  var bits = p.split('/');
  return String(bits[bits.length - 1] || '').toLowerCase();
}
function _seriesUrl(value) {
  var s = String(value || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return _absolute(s, SITE + '/');
  if (/^\/\//.test(s)) return 'https:' + s;
  s = s.replace(/^\/+|\/+$/g, '').split(/[?#]/)[0];
  return s ? SITE + '/' + s + '/' : '';
}
function _validSiteUrl(url) {
  try {
    var u = new URL(url);
    return /^https?:$/.test(u.protocol) && /^(www\.)?animexin\.dev$/i.test(u.hostname);
  } catch (e) { return false; }
}
function _isEpisodePath(path) { return /(?:^|-)episode-\d+(?:-|\/|$)/i.test(String(path || '')); }
function _cleanTitle(title) {
  return _text(title).replace(/\s+(?:Poster|Image)$/i, '').replace(/^Image:\s*/i, '').trim();
}

// Archive cards and home cards share links and poster images. Keep the parser
// independent of optional theme classes so small layout changes are survivable.
function _titleFromEpisode(title) {
  return _cleanTitle(title).replace(/\s+(?:Episode|Ep)\s*#?\s*\d+.*$/i, '').trim();
}
function _seriesFromEpisodeUrl(raw) {
  var url = _absolute(raw, SITE + '/');
  var path = _path(url).replace(/\/+$/, '');
  var m = path.match(/^(.*?)-episode-\d+.*$/i);
  return m ? _absolute(m[1] + '/', SITE + '/') : _seriesUrl(url);
}
function _articleCards(html) {
  var input = String(html || ''), out = [], seen = Object.create(null);
  var re = /<article\b[^>]*class=["']bs[^"']*["'][^>]*>[\s\S]*?<\/article\s*>/gi, match;
  while ((match = re.exec(input)) !== null) {
    var card = match[0];
    var rawUrl = (card.match(/\bhref=["']([^"']+)["']/i) || [])[1] || '';
    if (!rawUrl) continue;
    var articleUrl = _absolute(rawUrl, SITE + '/');
    if (!_validSiteUrl(articleUrl)) continue;
    var cardTitle = (card.match(/<h2\b[^>]*itemprop=["']headline["'][^>]*>([\s\S]*?)<\/h2\s*>/i) || [])[1]
      || (card.match(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/i) || [])[1]
      || (card.match(/\btitle=["']([^"']+)["']/i) || [])[1] || '';
    var seriesTitleRaw = (card.match(/<div\b[^>]*class=["']tt["'][^>]*>([\s\S]*?)<\/div\s*>/i) || [])[1] || '';
    var title = _cleanTitle(_text(seriesTitleRaw) || _titleFromEpisode(cardTitle) || cardTitle);
    var imgTag = (card.match(/<img\b[^>]*>/i) || [])[0] || '';
    var image = _tagValue(imgTag, 'img', 'data-src') || _tagValue(imgTag, 'img', 'data-lazy-src')
      || _tagValue(imgTag, 'img', 'data-original') || _tagValue(imgTag, 'img', 'src');
    var canonicalUrl = _seriesFromEpisodeUrl(articleUrl);
    var slug = _slug(canonicalUrl);
    if (!slug || !title || seen[slug] || /^(?:image|view all|next|previous|random|home|search|text mode)$/i.test(title)) continue;
    seen[slug] = true;
    var yearMatch = title.match(/\b(19|20)\d{2}\b/);
    var ep = (card.match(/<span\b[^>]*class=["']epx["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1] || '';
    var type = (card.match(/<div\b[^>]*class=["']typez[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
    out.push({ id: slug, title: title, englishTitle: title, url: canonicalUrl,
      cover: image ? _absolute(image, articleUrl) : null, episode: _text(ep), typeLabel: _text(type),
      year: yearMatch ? Number(yearMatch[0]) : null, type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}
function _cards(html) {
  var input = String(html || '');
  var articles = _articleCards(input);
  if (articles.length) return articles;
  var out = [], seen = Object.create(null);
  var re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, m;
  while ((m = re.exec(input)) !== null) {
    var attrs = m[1], inner = m[2], href = _attr(attrs, 'href');
    if (!href) continue;
    var articleUrl = _absolute(href, SITE + '/');
    if (!_validSiteUrl(articleUrl)) continue;
    var path = _path(articleUrl).replace(/\/+$/, '');
    if (!path || /\/(?:genre|category|tag|author|page|wp-content|wp-admin|wp-json)(?:\/|$)/i.test(path)) continue;
    var canonicalUrl = _seriesFromEpisodeUrl(articleUrl);
    var slug = _slug(canonicalUrl);
    if (!slug || seen[slug]) continue;
    var imgTag = (inner.match(/<img\b[^>]*>/i) || [])[0] || '';
    var image = _tagValue(imgTag, 'img', 'data-src') || _tagValue(imgTag, 'img', 'data-lazy-src')
      || _tagValue(imgTag, 'img', 'data-original') || _tagValue(imgTag, 'img', 'src');
    var title = _cleanTitle(_attr(attrs, 'title') || _tagValue(imgTag, 'img', 'alt') || _text(inner));
    title = _titleFromEpisode(title) || title;
    if (!title || /^(?:image|view all|next|previous|random|home|search|text mode)$/i.test(title)) continue;
    if (!image && !_attr(attrs, 'title') && !imgTag) continue;
    if (/^\d+$/.test(title) || title.length > 160) continue;
    seen[slug] = true;
    var yearMatch = title.match(/\b(19|20)\d{2}\b/);
    out.push({ id: slug, title: title, englishTitle: title, url: canonicalUrl, cover: image ? _absolute(image, articleUrl) : null,
      year: yearMatch ? Number(yearMatch[0]) : null, type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}
function _dedupe(items) {
  var seen = Object.create(null);
  return (items || []).filter(function (x) {
    if (!x || !x.id || seen[x.id]) return false;
    seen[x.id] = true; return true;
  });
}
function _archiveUrl(page) {
  var p = Number(page || 1);
  return p > 1 ? SITE + '/anime/page/' + Math.floor(p) + '/?order=update&status=&type=' : ARCHIVE;
}
function _homeSections(html) {
  var input = String(html || ''), headings = [], re = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, m;
  var allowed = { 'popular today': 'Popular Today', 'latest release': 'Latest Release', 'latest episode': 'Latest Episode', 'popular anime': 'Popular Anime', 'new movie': null, 'next': null, 'anime lists': null, 'anime list': null };
  while ((m = re.exec(input)) !== null) {
    var label = _text(m[2]).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(allowed, label)) headings.push({ title: allowed[label], at: m.index });
  }
  var rows = [];
  for (var i = 0; i < headings.length; i++) {
    var end = i + 1 < headings.length ? headings[i + 1].at : input.length;
    if (!headings[i].title) continue;
    var items = _cards(input.substring(headings[i].at, end));
    if (items.length) rows.push({ title: headings[i].title, items: items });
  }
  return rows;
}
function getHome(opts) {
  var page = opts && (opts.page || opts.currentPage) || 1;
  return Promise.all([
    _get(SITE + '/', SITE + '/').then(_homeSections).catch(function () { return []; }),
    _get(_archiveUrl(page), SITE + '/').then(function (html) { return _cards(html); }).catch(function () { return []; })
  ]).then(function (result) {
    var sections = result[0], recent = result[1];
    if (recent.length) sections.push({ title: 'Recently Updated', items: recent });
    return sections;
  }).catch(function () { return []; });
}
function search(query, page, opts) {
  var q = String(query || '').trim(), p = Number(page || 1);
  if (!q) return Promise.resolve([]);
  var url = p > 1
    ? SITE + '/page/' + Math.floor(p) + '/?s=' + encodeURIComponent(q)
    : SITE + '/?s=' + encodeURIComponent(q);
  return _get(url, SITE + '/').then(function (html) {
    return _dedupe(_cards(html));
  }).catch(function () { return []; });
}
function _episodeNumber(path, label) {
  var m = String(path || '').match(/-episode-(\d+)(?:-|\/|$)/i);
  if (!m) m = String(label || '').match(/\b(?:episode|ep)\s*#?\s*(\d+)/i);
  return m ? Number(m[1]) : 0;
}
function _extractEpisodes(html, seriesSlug) {
  var input = String(html || ''), out = [], seen = Object.create(null);
  var prefix = '/' + String(seriesSlug || '').replace(/^\/+|\/+$/g, '').toLowerCase() + '-episode-';
  var re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, m;
  while ((m = re.exec(input)) !== null) {
    var href = _attr(m[1], 'href');
    if (!href) continue;
    var url = _absolute(href, SITE + '/');
    if (!_validSiteUrl(url)) continue;
    var path = _path(url).toLowerCase();
    if (path.indexOf(prefix) !== 0) continue;
    var label = _cleanTitle(_attr(m[1], 'title') || _text(m[2]));
    var number = _episodeNumber(path, label);
    if (!number || seen[url]) continue;
    seen[url] = true;
    out.push({ id: url, title: 'Episode ' + number, number: number, url: url, type: 'anime', category: 'sub', sourceId: SOURCE_ID });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}
function _genres(html) {
  var out = [], seen = Object.create(null), re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var href = _attr(m[1], 'href');
    if (!/\/genre\//i.test(href)) continue;
    var label = _cleanTitle(_text(m[2]));
    if (label && !seen[label.toLowerCase()]) { seen[label.toLowerCase()] = true; out.push(label); }
  }
  return out;
}
function _episodeListFromHtml(html, seriesSlug) {
  var input = String(html || ''), out = [], seen = Object.create(null);
  var liRe = /<li\b([^>]*\bdata-index=["']\d+["'][^>]*)>([\s\S]*?)<\/li\s*>/gi, m;
  while ((m = liRe.exec(input)) !== null) {
    var href = _tagValue(m[2], 'a', 'href') || _attr((m[2].match(/<a\b([^>]*)>/i) || [])[1] || '', 'href');
    if (!href) continue;
    var url = _absolute(href, SITE + '/');
    if (!_validSiteUrl(url)) continue;
    var path = _path(url).toLowerCase();
    if (path.indexOf('/' + String(seriesSlug || '').toLowerCase() + '-episode-') !== 0) continue;
    var numText = (m[2].match(/<div\b[^>]*class=["']epl-num["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
    var titleText = (m[2].match(/<div\b[^>]*class=["']epl-title["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
    var dateText = (m[2].match(/<div\b[^>]*class=["']epl-date["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
    var number = _episodeNumber(path, _text(numText));
    if (!number) {
      var indexMatch = String(m[1]).match(/\bdata-index=["'](\d+)["']/i);
      number = indexMatch ? Number(indexMatch[1]) : 0;
    }
    if (!number || seen[url]) continue;
    seen[url] = true;
    out.push({ id: url, title: _text(titleText) || ('Episode ' + number), number: number,
      url: url, releaseDate: _text(dateText), type: 'anime', category: 'sub', sourceId: SOURCE_ID });
  }
  if (out.length) out.sort(function (a, b) { return a.number - b.number; });
  return out;
}
function _seriesMetadata(html) {
  var block = (String(html || '').match(/<div\b[^>]*class=["']spe["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
  var data = Object.create(null);
  var re = /<span\b[^>]*>\s*<b[^>]*>([^<:]+):<\/b>\s*([\s\S]*?)<\/span>/gi, m;
  while ((m = re.exec(block)) !== null) {
    var key = String(m[1] || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (key) data[key] = _text(m[2]);
  }
  return data;
}
function _firstImageInThumb(html) {
  var thumb = (String(html || '').match(/<div\b[^>]*class=["']thumb["'][^>]*>[\s\S]*?<\/div>/i) || [])[0] || '';
  var img = (thumb.match(/<img\b[^>]*>/i) || [])[0] || '';
  return _tagValue(img, 'img', 'data-src') || _tagValue(img, 'img', 'src')
    || _tagValue(img, 'img', 'data-lazy-src') || '';
}
function _parseDetail(html, pageUrl) {
  var slug = _slug(pageUrl);
  var h1 = (html.match(/<h1\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1\s*>/i) || [])[1]
    || (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i) || [])[1] || '';
  var title = _cleanTitle(h1 || _meta(html, 'og:title') || (html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i) || [])[1] || slug);
  title = title.replace(/\s*[|–-]\s*AnimeXin\s*$/i, '').trim();
  var cover = _firstImageInThumb(html) || _meta(html, 'og:image') || _meta(html, 'twitter:image') || '';
  if (!cover) cover = _tagValue(html, 'img', 'data-src') || _tagValue(html, 'img', 'src');
  var synopsisBlock = (html.match(/<div\b[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1]
    || (html.match(/<(?:div|section)\b[^>]*class=["'][^"']*(?:synopsis|description|summary)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i) || [])[1]
    || '';
  var desc = _text(synopsisBlock) || _meta(html, 'description') || _meta(html, 'og:description') || '';
  var meta = _seriesMetadata(html);
  var pageText = _text(html);
  var statusText = meta.status || ((pageText.match(/\bStatus\s*:\s*(Ongoing|Completed|Upcoming|Hiatus|Finished)\b/i) || [])[1] || '');
  var released = meta.released || '';
  var yearMatch = String(released).match(/\b(19|20)\d{2}\b/)
    || pageText.match(/\bReleased\s*:\s*[^.]{0,40}?\b((?:19|20)\d{2})\b/i)
    || pageText.match(/\b(?:Released on|Release Date)\s*:\s*[^.]{0,40}?\b((?:19|20)\d{2})\b/i);
  var episodeList = _episodeListFromHtml(html, slug);
  var episodes = episodeList.length ? episodeList : _extractEpisodes(html, slug);
  var countText = meta.episodes || '';
  var countMatch = countText.match(/\d+/) || pageText.match(/\bEpisodes?\s*:\s*(\d+)/i);
  var genres = _genres(html);
  var detail = {
    id: slug, title: title || slug, englishTitle: title || slug, url: pageUrl,
    cover: cover ? _absolute(cover, pageUrl) : null, description: desc,
    status: String(statusText || 'unknown').toLowerCase(),
    genres: genres, studios: meta.studio ? [meta.studio] : [],
    year: yearMatch ? Number((String(yearMatch[0]).match(/(?:19|20)\d{2}/) || [''])[0]) || null : null,
    type: 'anime', sourceId: SOURCE_ID, episodes: episodes,
    subCount: episodes.length, dubCount: 0,
    episodeCount: countMatch ? Number(countMatch[1] || countMatch[0]) : episodes.length
  };
  if (meta.network) detail.network = meta.network;
  if (meta.country) detail.country = meta.country;
  if (meta.type) detail.mediaType = meta.type;
  if (meta.duration) detail.duration = meta.duration;
  return detail;
}
function getDetail(url, opts) {
  var requestedUrl = _seriesUrl(url);
  if (!requestedUrl || !_validSiteUrl(requestedUrl)) return Promise.reject(new Error('AnimeXin: invalid anime URL'));
  return _get(requestedUrl, SITE + '/').then(function (html) {
    var parent = (html.match(/<div\b[^>]*class=["']nvs\s+nvsc["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["']/i) || [])[1] || '';
    if (_isEpisodePath(_path(requestedUrl)) && parent) {
      var seriesUrl = _absolute(parent, requestedUrl);
      if (_validSiteUrl(seriesUrl) && _slug(seriesUrl) !== _slug(requestedUrl)) {
        return _get(seriesUrl, requestedUrl).then(function (seriesHtml) { return _parseDetail(seriesHtml, seriesUrl); });
      }
    }
    if (_isEpisodePath(_path(requestedUrl))) {
      var derived = _seriesFromEpisodeUrl(requestedUrl);
      if (_validSiteUrl(derived) && _slug(derived) !== _slug(requestedUrl)) {
        return _get(derived, requestedUrl).then(function (seriesHtml) { return _parseDetail(seriesHtml, derived); });
      }
    }
    return _parseDetail(html, requestedUrl);
  });
}
function getEpisodes(url, opts) {
  var pageUrl = _seriesUrl(url);
  if (!pageUrl || !_validSiteUrl(pageUrl)) return Promise.resolve([]);
  if (_isEpisodePath(_path(pageUrl))) pageUrl = _seriesFromEpisodeUrl(pageUrl);
  return _get(pageUrl, SITE + '/').then(function (html) {
    var slug = _slug(pageUrl);
    var episodes = _episodeListFromHtml(html, slug);
    return episodes.length ? episodes : _extractEpisodes(html, slug);
  }).catch(function () { return []; });
}

function _safeWebUrl(raw, base) {
  var url = _absolute(raw, base || SITE + '/');
  try {
    var u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
    return u.href;
  } catch (e) { return ''; }
}
function _isMediaUrl(url) { return /\.(?:m3u8|mp4|m4v|webm)(?:[?#]|$)/i.test(String(url || '')); }
function _subtitles(html, base) {
  var out = [], seen = Object.create(null), input = String(html || ''), re = /<track\b([^>]*)>/gi, m;
  function add(raw, label, lang, format, isDefault) {
    var url = _safeWebUrl(raw, base);
    if (!url || !/\.(?:vtt|srt)(?:[?#]|$)/i.test(url) || seen[url]) return;
    seen[url] = true;
    out.push({ url: url, label: label || 'Subtitle', lang: lang || '', format: format || (/\.srt(?:[?#]|$)/i.test(url) ? 'srt' : 'vtt'), default: !!isDefault });
  }
  while ((m = re.exec(input)) !== null) {
    add(_attr(m[1], 'src'), _attr(m[1], 'label'), _attr(m[1], 'srclang'), '', /\bdefault\b/i.test(m[1]));
  }
  var urlRe = /(?:file|src|url)\s*[:=]\s*["'](https?:\\?\/\\?\/[^"']+?\.(?:vtt|srt)(?:\?[^"']*)?)["']/gi;
  while ((m = urlRe.exec(input)) !== null) add(m[1], '', '', '', false);
  return out;
}
function _directSources(html, pageUrl, referer) {
  var input = String(html || '').replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
  var candidates = [], seen = Object.create(null), tracks = _subtitles(input, pageUrl);
  function add(raw, type, label) {
    var url = _safeWebUrl(raw, pageUrl);
    if (!url || !(_isMediaUrl(url) || /\.m3u8(?:[?#]|$)/i.test(url)) || seen[url]) return;
    seen[url] = true;
    candidates.push({ url: url, type: type || (/\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : 'file'), label: label || '' });
  }
  var tags = /<(?:source|video)\b([^>]*)>/gi, m;
  while ((m = tags.exec(input)) !== null) {
    var raw = _attr(m[1], 'src') || _attr(m[1], 'data-src') || _attr(m[1], 'data-url');
    var mime = _attr(m[1], 'type');
    add(raw, /mpegurl|m3u8/i.test(mime) ? 'hls' : /mp4/i.test(mime) ? 'file' : '', _attr(m[1], 'label'));
  }
  var patterns = [
    /(?:file|src|url|hls|mp4)\s*[:=]\s*["'](https?:[^"']+?\.(?:m3u8|mp4|m4v|webm)(?:\?[^"']*)?)["']/gi,
    /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|m4v|webm)(?:\?[^\s"'<>\\]*)?/gi
  ];
  for (var i = 0; i < patterns.length; i++) {
    while ((m = patterns[i].exec(input)) !== null) add(m[1] || m[0], '', '');
  }
  var host = '';
  try { host = new URL(pageUrl).hostname; } catch (e) { host = 'AnimeXin'; }
  return candidates.map(function (item) {
    return { url: item.url, quality: 'Auto', label: 'AnimeXin | ' + (item.label || host),
      container: item.type === 'hls' ? 'hls' : 'mp4', hls: item.type === 'hls',
      kind: 'sub', audioLang: 'zh', headers: { 'User-Agent': UA, 'Referer': referer || pageUrl, 'Origin': _origin(referer || pageUrl) }, subtitles: tracks };
  });
}
function _origin(url) { try { var u = new URL(url); return u.protocol + '//' + u.host; } catch (e) { return SITE; } }
function _iframes(html, base) {
  var out = [], seen = Object.create(null), re = /<(?:iframe|embed)\b([^>]*)>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var raw = _attr(m[1], 'src') || _attr(m[1], 'data-src') || _attr(m[1], 'data-lazy-src') || _attr(m[1], 'data-url');
    var url = _safeWebUrl(raw, base);
    if (!url || seen[url]) continue;
    seen[url] = true; out.push(url);
  }
  return out;
}
function _base64Decode(raw) {
  var s = String(raw || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '';
  var buffer = 0, bits = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch === '=') break;
    var value = alphabet.indexOf(ch);
    if (value < 0) continue;
    buffer = (buffer << 6) | value; bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((buffer >> bits) & 255); }
  }
  return out;
}
function _serverEmbeds(html, base) {
  var out = [], seen = Object.create(null), re = /<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var value = _attr(m[1], 'value');
    if (!value) continue;
    var decoded = value;
    if (!/^https?:\/\//i.test(decoded) && !/^\/\//.test(decoded)) {
      var possible = _base64Decode(value);
      if (possible && (/<iframe\b/i.test(possible) || /^https?:\/\//i.test(possible.trim()) || /^\/\//.test(possible.trim()))) decoded = possible;
    }
    decoded = _decodeEntities(decoded).replace(/\\\//g, '/');
    var raw = _attr((decoded.match(/<iframe\b([^>]*)>/i) || [])[1] || '', 'src')
      || _attr((decoded.match(/<embed\b([^>]*)>/i) || [])[1] || '', 'src')
      || decoded.trim();
    var url = _safeWebUrl(raw, base);
    if (!url || seen[url]) continue;
    seen[url] = true;
    out.push({ url: url, name: _text(m[2]) || 'AnimeXin server' });
  }
  return out;
}
function _resolveDailymotion(embedUrl) {
  var idMatch = String(embedUrl || '').match(/[?&]video=([a-z0-9]+)/i)
    || String(embedUrl || '').match(/\/(?:embed\/)?video\/([a-z0-9]+)/i);
  var id = idMatch ? idMatch[1] : '';
  if (!id) return Promise.resolve([]);
  var endpoint = 'https://www.dailymotion.com/player/metadata/video/' + encodeURIComponent(id);
  return _request(endpoint, { headers: {
    'Accept': 'application/json,text/plain,*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': embedUrl
  }}).then(function (body) {
    var data;
    try { data = JSON.parse(body); } catch (e) { return []; }
    var qualities = data && data.qualities || {};
    var auto = qualities.auto;
    var selected = Array.isArray(auto) ? auto[0] : auto;
    var raw = selected && (selected.url || selected.src) || '';
    var url = _safeWebUrl(raw, embedUrl);
    if (!url || !(_isMediaUrl(url) || /(?:\.m3u8|mpegurl)(?:[?#]|$)/i.test(url))) return [];
    var hls = /\.m3u8(?:[?#]|$)/i.test(url) || /mpegurl/i.test(String(selected && selected.type || ''));
    return [{ url: url, quality: 'Auto', label: 'AnimeXin | Dailymotion', container: hls ? 'hls' : 'mp4', hls: hls,
      kind: 'sub', audioLang: 'zh',
      headers: { 'User-Agent': UA, 'Referer': embedUrl, 'Origin': 'https://www.dailymotion.com' },
      subtitles: [] }];
  }).catch(function () { return []; });
}
function _resolveOkRu(embedUrl) {
  return _get(embedUrl, SITE + '/').then(function (html) {
    var raw = (html.match(/\bdata-options=["']([^"']+)["']/i) || [])[1] || '';
    if (!raw) return [];
    var parsed;
    try { parsed = JSON.parse(_decodeEntities(raw)); } catch (e) { return []; }
    var vars = parsed && parsed.flashvars && parsed.flashvars.metadata;
    var meta = vars;
    if (typeof vars === 'string') { try { meta = JSON.parse(vars); } catch (e) { return []; } }
    var videos = meta && Array.isArray(meta.videos) ? meta.videos : [];
    return videos.map(function (video) {
      var url = _safeWebUrl(video && video.url, embedUrl);
      if (!url || !/^https?:\/\//i.test(url)) return null;
      var hls = /\.m3u8(?:[?#]|$)/i.test(url);
      return { url: url, quality: String(video.name || 'Auto'), label: 'AnimeXin | OK.ru ' + String(video.name || ''),
        container: hls ? 'hls' : 'mp4', hls: hls, kind: 'sub', audioLang: 'zh',
        headers: { 'User-Agent': UA, 'Referer': embedUrl, 'Origin': 'https://ok.ru' }, subtitles: [] };
    }).filter(Boolean);
  }).catch(function () { return []; });
}
function _odyseeUri(embedUrl) {
  var path = _path(embedUrl), decoded = path;
  try { decoded = decodeURIComponent(path); } catch (e) { /* retain escaped path */ }
  var m = decoded.match(/\/(?:\$\/)?embed\/(.+)$/i);
  if (!m) return '';
  var claim = String(m[1] || '').replace(/^\/+|\/+$/g, '');
  if (!claim || claim.indexOf('@') !== 0 || claim.indexOf(':') < 0 || claim.indexOf('/') < 0) return '';
  return 'lbry://' + claim;
}
function _resolveOdysee(embedUrl) {
  var uri = _odyseeUri(embedUrl);
  if (!uri) return Promise.resolve([]);
  return _postJson(ODYSEE_API, { uri: uri }, embedUrl).then(function (json) {
    var objects = [json, json && json.data, json && json.result, json && json.data && json.data.result];
    var stream = '';
    for (var i = 0; i < objects.length; i++) {
      var item = objects[i];
      if (item && typeof item === 'object') {
        stream = item.streaming_url || item.streamingUrl || item.stream_url || '';
        if (stream) break;
      }
    }
    var url = _safeWebUrl(stream, embedUrl);
    if (!url || !(_isMediaUrl(url) || /player\.odycdn\.com\//i.test(url))) return [];
    var hls = /\.m3u8(?:[?#]|$)/i.test(url);
    return [{ url: url, quality: 'Auto', label: 'AnimeXin | Odysee', container: hls ? 'hls' : 'mp4', hls: hls,
      kind: 'sub', audioLang: 'zh', headers: { 'User-Agent': UA, 'Referer': embedUrl, 'Origin': 'https://odysee.com' }, subtitles: [] }];
  }).catch(function () { return []; });
}
function _resolvePlayer(url, referer, depth, seen) {
  if (depth > 2 || seen[url]) return Promise.resolve([]);
  seen[url] = true;
  if (/dailymotion\.com\//i.test(url)) return _resolveDailymotion(url);
  if (/\/\/(?:www\.)?ok\.ru\//i.test(url)) return _resolveOkRu(url);
  if (/^https?:\/\/(?:www\.)?odysee\.com\//i.test(url)) {
    return _resolveOdysee(url).then(function (sources) {
      if (sources.length) return sources;
      return _get(url, referer).then(function (html) { return _directSources(html, url, url); }).catch(function () { return []; });
    });
  }
  return _get(url, referer).then(function (html) {
    var sources = _directSources(html, url, url);
    if (sources.length || depth >= 2) return sources;
    var frames = _iframes(html, url).slice(0, 4);
    var chain = Promise.resolve([]);
    frames.forEach(function (frame) {
      chain = chain.then(function (found) {
        if (found.length) return found;
        return _resolvePlayer(frame, url, depth + 1, seen);
      });
    });
    return chain;
  }).catch(function () { return []; });
}
function getVideoSources(episodeUrl, opts) {
  var pageUrl = _seriesUrl(episodeUrl);
  if (!pageUrl || !_validSiteUrl(pageUrl) || !_isEpisodePath(_path(pageUrl))) return Promise.resolve([]);
  return _get(pageUrl, SITE + '/').then(function (html) {
    var direct = _directSources(html, pageUrl, pageUrl);
    if (direct.length) return direct;
    var entries = _iframes(html, pageUrl);
    var servers = _serverEmbeds(html, pageUrl);
    servers.forEach(function (server) {
      if (entries.indexOf(server.url) < 0) entries.push(server.url);
    });
    var chain = Promise.resolve([]), seen = Object.create(null);
    entries.slice(0, 10).forEach(function (playerUrl) {
      chain = chain.then(function (found) {
        if (found.length) return found;
        return _resolvePlayer(playerUrl, pageUrl, 0, seen);
      });
    });
    return chain;
  }).catch(function () { return []; });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = {
  version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome,
  search: search, getDetail: getDetail, getEpisodes: getEpisodes,
  getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks
};
