// AnimeSuge source for Zangetsu. Scrapes the site's public HTML pages.
// Playback is resolved through Zangetsu's registered embed extractors.
var SITE = 'https://animesuge.cz';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animesuge';
var VERSION = '1.0.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var _cache = {};

function getInfo() {
  return { name: 'AnimeSuge', lang: 'en', baseUrl: SITE,
    logo: SITE + '/assets/sites/animesuge/icons/favicon.png', type: 'anime', version: VERSION };
}
function _get(url, referer) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': referer || SITE + '/',
    'Accept': 'text/html,application/xhtml+xml,application/json,*/*' }, timeoutMs: 15000 })
    .then(function (r) {
      if (r && r.status >= 400) throw new Error('AnimeSuge HTTP ' + r.status);
      return r && r.body != null ? (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) : '';
    });
}
function _abs(href) {
  var s = String(href || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (s.indexOf('//') === 0) return 'https:' + s;
  return SITE + (s.charAt(0) === '/' ? '' : '/') + s;
}
function _decode(s) {
  return htmlText(String(s || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}
function _year(s) { var m = String(s || '').match(/(?:19|20)\d{2}/); return m ? Number(m[0]) : null; }
function _slugFromUrl(url) {
  var m = String(url || '').match(/\/anime\/([^/?#]+)/i);
  return m ? m[1] : '';
}
function _numberFromUrl(url) {
  var m = String(url || '').match(/(?:ep-|episode-)(\d+)/i);
  return m ? Number(m[1]) : null;
}
function _cards(html) {
  var out = [], seen = {}, re = /<div\b[^>]*class=["'][^"']*\bflw-item\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*\bflw-item\b|$)/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var c = m[1];
    var href = (c.match(/<a\b[^>]*class=["'][^"']*film-name[^"']*["'][^>]*href=["']([^"']+)/i) || c.match(/<a\b[^>]*href=["']([^"']*\/anime\/[^"']+)/i) || [])[1];
    var title = (c.match(/<a\b[^>]*class=["'][^"']*film-name[^"']*["'][^>]*title=["']([^"']+)/i) || c.match(/class=["'][^"']*film-name[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i) || [])[1];
    var cover = (c.match(/<img\b[^>]*(?:data-src|data-lazy-src|src)=["']([^"']+)/i) || [])[1];
    var slug = _slugFromUrl(href);
    title = _decode(title);
    if (!slug || !title || seen[slug]) continue;
    seen[slug] = true;
    var card = { id: slug, title: title, url: slug, cover: _abs(cover) || null,
      type: 'anime', sourceId: SOURCE_ID };
    _cache[slug] = card;
    if (!cover) delete card.cover;
    out.push(card);
  }
  return out;
}
function search(query, page) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _get(SITE + '/filter?keyword=' + encodeURIComponent(q) + '&page=' + Math.max(1, Number(page) || 1))
    .then(_cards).catch(function () { return []; });
}
function popular(opts) {
  var page = Math.max(1, Number(opts && opts.page) || 1);
  return _get(SITE + '/most-popular?page=' + page).then(_cards).catch(function () { return []; });
}
function getHome() {
  return _get(SITE + '/home').then(function (html) {
    var a = _cards(html);
    return a.length ? [{ title: 'AnimeSuge', items: a }] : [];
  }).catch(function () { return []; });
}
function _episodeRows(html, slug) {
  var out = [], seen = {}, re = /<a\b([^>]*(?:class=["'][^"']*(?:nav-link|ss-list|ep-item)[^"']*["'])?[^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var attrs = m[1], href = (attrs.match(/href=["']([^"']+)/i) || [])[1];
    if (!href || !/\/ep-(?:\d+|full)(?:[/?#]|$)/i.test(href)) continue;
    var n = _numberFromUrl(href);
    if (!n) continue;
    var title = _decode((attrs.match(/title=["']([^"']+)/i) || [])[1] || m[2]) || ('Episode ' + n);
    if (seen[n]) continue;
    seen[n] = true;
    out.push({ id: slug + '||' + n, number: n, title: title, url: slug + '||' + n });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}
function getDetail(url) {
  var slug = String(url || '').replace(/^animesuge:\/\//i, '').split('||')[0].replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '').replace(/^anime\//, '');
  if (!slug) return Promise.resolve(null);
  return _get(SITE + '/anime/' + slug).then(function (html) {
    var title = _decode((html.match(/<h2\b[^>]*class=["'][^"']*film-name[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
    var cover = (html.match(/class=["'][^"']*anisc-poster[^"']*[\s\S]{0,500}?<img[^>]+(?:src|data-src)=["']([^"']+)/i) || html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i) || [])[1];
    var desc = _decode((html.match(/class=["'][^"']*(?:film-description|description)[^"']*["'][\s\S]{0,500}?<div[^>]*>([\s\S]*?)<\/div>/i) || html.match(/property=["']og:description["'][^>]*content=["']([^"']+)/i) || [])[1]);
    var episodes = _episodeRows(html, slug);
    var card = _cache[slug] || {};
    if (!title) title = card.title || slug;
    var detail = { id: slug, title: title.replace(/\s*[-|]\s*AnimeSuge.*$/i, ''), url: slug,
      cover: _abs(cover) || card.cover || null, description: desc || undefined,
      year: _year(html), type: 'anime', sourceId: SOURCE_ID, episodes: episodes,
      subCount: episodes.length, dubCount: episodes.length };
    if (!detail.cover) delete detail.cover;
    if (!detail.description) delete detail.description;
    if (!detail.year) delete detail.year;
    return detail;
  }).catch(function () { return null; });
}
function getEpisodes(url) { return getDetail(url).then(function (d) { return d && d.episodes || []; }); }
function getVideoSources(episodeUrl, opts) {
  var value = String(episodeUrl && (episodeUrl.url || episodeUrl.id) || episodeUrl || '');
  var m = value.match(/^(.+?)\|\|(\d+)$/);
  if (!m) return Promise.reject(new Error('AnimeSuge: invalid episode reference'));
  var slug = m[1], ep = Number(m[2]), mode = opts && opts.category === 'dub' ? 'dub' : 'sub';
  var epUrl = SITE + '/anime/' + slug + '/ep-' + ep;
  return _get(epUrl).then(function (html) {
    var frames = [], re = /<iframe\b[^>]*src=["']([^"']+)["']/gi, match;
    while ((match = re.exec(html)) !== null) {
      var link = _abs(match[1]);
      if (link && !/about:blank|javascript:/i.test(link) && frames.indexOf(link) < 0) frames.push(link);
    }
    var direct = (html.match(/<source\b[^>]*src=["']([^"']+\.(?:m3u8|mp4)(?:\?[^"']*)?)["']/i) || [])[1];
    if (direct) return [{ url: _abs(direct), quality: 'Auto', container: /\.m3u8/i.test(direct) ? 'hls' : 'mp4',
      headers: { 'Referer': epUrl, 'User-Agent': UA }, kind: 'raw', label: 'AnimeSuge direct' }];
    if (typeof extractVideo !== 'function') throw new Error('AnimeSuge: embed extractor unavailable');
    return Promise.all(frames.map(function (frame) {
      return extractVideo(frame, { headers: { 'Referer': epUrl, 'User-Agent': UA },
        kind: mode, audioLang: mode === 'dub' ? 'en' : 'ja' }).then(function (rows) {
        return (rows || []).map(function (row) {
          row.label = 'AnimeSuge ' + mode.toUpperCase();
          return row;
        });
      }).catch(function () { return []; });
    })).then(function (lists) {
      var out = [], seen = {};
      lists.forEach(function (rows) { rows.forEach(function (row) {
        if (row && row.url && !seen[row.url]) { seen[row.url] = true; out.push(row); }
      }); });
      if (!out.length) throw new Error('AnimeSuge: no playable stream found; site may have changed its player markup');
      return out;
    });
  });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: VERSION, getInfo: getInfo, search: search, popular: popular,
    getHome: getHome, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams,
    _cards: _cards, _episodeRows: _episodeRows, _slugFromUrl: _slugFromUrl };
}
