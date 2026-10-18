// AnimeWorld India (Hindi) — adapted from the Yuzono Aniyomi extension.
// Upstream: https://github.com/yuzono/anime-extensions/tree/master/src/all/animeworldindia
// Apache-2.0. This is a JavaScript port of the catalog/episode/player flow.
// The source's Mystream player exposes an HLS playlist after a watch-page handshake.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'yuzono-animeworldindia-hi';
var SITE = 'https://anime-world.co';
var LANGUAGE = 'hindi';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeWorld India (Hindi, Yuzono)', lang: 'hi', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=anime-world.co', type: 'anime', version: '1.0.0' };
}
function getSettings() { return []; }
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _text(s) {
  return String(s || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ').trim();
}
function _abs(href, base) {
  href = String(href || '').replace(/&amp;/g, '&').trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  return String(base || SITE).replace(/\/$/, '') + (href.charAt(0) === '/' ? '' : '/') + href;
}
function _attr(tag, name) {
  var re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\\'([^\\']*)\\'|([^\\s>]+))', 'i');
  var m = String(tag || '').match(re);
  return m ? (m[1] != null ? m[1] : m[2] != null ? m[2] : m[3] || '') : '';
}
function _request(url, referer, extra) {
  var headers = { 'User-Agent': UA, 'Referer': referer || SITE + '/', 'Accept-Language': 'en-US,en;q=0.9' };
  if (extra) Object.keys(extra).forEach(function(k) { headers[k] = extra[k]; });
  return fetch(url, { headers: headers, timeoutMs: 15000 }).then(function(r) {
    if (!r || (r.status && r.status >= 400)) throw new Error('HTTP ' + (r && r.status));
    return { body: String(r.body || ''), headers: r.headers || {}, status: r.status || 200 };
  });
}
function _get(url, referer) { return _request(url, referer).then(function(r) { return r.body; }); }
function _header(headers, key) {
  if (!headers) return '';
  if (Array.isArray(headers)) {
    for (var i = 0; i < headers.length; i++) if (String(headers[i][0] || '').toLowerCase() === key.toLowerCase()) return String(headers[i][1] || '');
  }
  var keys = Object.keys(headers);
  for (var j = 0; j < keys.length; j++) if (keys[j].toLowerCase() === key.toLowerCase()) return String(headers[keys[j]] || '');
  return '';
}
function _cards(html) {
  var out = [], seen = {}, re = /<div\b[^>]*class=["'][^"']*col-span-1[^"']*["'][^>]*>[\s\S]*?<\/div>\s*(?:<\/div>)?/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var b = m[0], a = (b.match(/<a\b[^>]*>/i) || [''])[0], img = (b.match(/<img\b[^>]*>/i) || [''])[0];
    var href = _abs(_attr(a, 'href'), SITE);
    var title = _text((b.match(/class=["'][^"']*font-medium[^"']*line-clamp-2[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1]) || _attr(a, 'title');
    if (!href || !title || seen[href]) continue;
    seen[href] = 1;
    var poster = _attr(img, 'src') || _attr(img, 'data-src') || _attr(img, 'data-lazy-src');
    out.push({ id: href, url: href, title: title, name: title, cover: poster ? _abs(poster, SITE) : null,
      poster: poster ? _abs(poster, SITE) : null, type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}
function search(query, page) {
  var q = _trim(query), p = Math.max(1, Number(page) || 1);
  var url = SITE + '/advanced-search/page/' + p + '/?s_keyword=' + encodeURIComponent(q) + '&s_lang=' + LANGUAGE;
  return _get(url, SITE + '/').then(_cards).catch(function() { return []; });
}
function getHome() {
  return _get(SITE + '/advanced-search/page/1/?s_lang=' + LANGUAGE + '&s_orderby=viewed', SITE + '/')
    .then(function(html) { var items = _cards(html); return items.length ? [{ title: 'Popular Hindi Anime', items: items }] : []; })
    .catch(function() { return []; });
}
function getDetail(url) {
  var full = _abs(url, SITE);
  return _get(full, SITE + '/').then(function(html) {
    var title = _text((html.match(/<h2[^>]*class=["'][^"']*text-4xl[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i) || [])[1]);
    var poster = (html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i) || [])[1] ||
      (html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i) || [])[1];
    var desc = (html.match(/<div[^>]+data-synopsis[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
    return { id: full, url: full, title: title || _text((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]) || full,
      name: title, cover: poster ? _abs(poster, SITE) : null, poster: poster ? _abs(poster, SITE) : null,
      description: _text(desc), type: 'anime', sourceId: SOURCE_ID };
  }).catch(function() { return { id: full, url: full, title: full, type: 'anime', sourceId: SOURCE_ID }; });
}
function getEpisodes(url) {
  var full = _abs(url, SITE);
  return _get(full, SITE + '/').then(function(html) {
    var raw = (html.split('var season_list = ')[1] || '').split('var season_label =')[0].trim().replace(/;\s*$/, '');
    var seasons;
    try { seasons = JSON.parse(raw); } catch (e) { throw new Error('AnimeWorld India: season_list JSON could not be parsed'); }
    if (!Array.isArray(seasons)) throw new Error('AnimeWorld India: season list missing');
    var isMovie = /type\/movies\//i.test(html), out = [], fallback = 1;
    seasons.forEach(function(season, si) {
      var episodes = season && season.episodes && season.episodes.all;
      if (!Array.isArray(episodes)) return;
      var single = seasons.length === 1;
      episodes.slice().reverse().forEach(function(ep) {
        var meta = ep.metadata || {}, n = parseInt(meta.number, 10) || fallback;
        var name = isMovie ? 'Movie' : ((single ? '' : 'Season ' + (si + 1) + ' - ') + 'Episode ' + n + (meta.title ? ' - ' + _text(meta.title) : ''));
        out.push({ id: String(ep.id), url: SITE + '/wp-json/kiranime/v1/episode?id=' + encodeURIComponent(ep.id),
          title: name, name: name, number: single ? n : fallback, episodeNumber: single ? n : fallback,
          type: 'episode', sourceId: SOURCE_ID });
        fallback++;
      });
    });
    if (!out.length) throw new Error('AnimeWorld India: no episodes found');
    return out;
  });
}
function _playerRows(body) {
  var raw = (String(body || '').split('"players":').pop() || '').split(',"noplayer":')[0].trim();
  try { return JSON.parse(raw); } catch (e) {}
  var m = raw.match(/^\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
  return [];
}
function getVideoSources(episodeUrl) {
  var ep = _abs(episodeUrl, SITE);
  return _request(ep, SITE + '/').then(function(resp) {
    var rows = _playerRows(resp.body).filter(function(p) { return p && p.type === 'stream' && p.url && p.server === 'Mystream' && (!p.language || p.language.toLowerCase() === LANGUAGE); });
    if (!rows.length) throw new Error('AnimeWorld India: no Mystream links for Hindi');
    return Promise.all(rows.map(function(p) {
      var watch = _abs(p.url, ep), host = watch.replace(/^(https?:\/\/[^/]+).*$/, '$1');
      return _request(watch, ep).then(function(wr) {
        var code = (wr.body.split('sniff(')[1] || '').split(', "')[1];
        code = code ? code.split('"')[0] : '';
        if (!code) throw new Error('AnimeWorld India: MyStream stream id not found');
        var cookie = _header(wr.headers, 'set-cookie').split(';')[0];
        var headers = { 'User-Agent': UA, 'Referer': host + '/', 'Accept': '*/*' };
        if (cookie && /^PHPSESSID=/i.test(cookie)) headers.Cookie = cookie;
        return [{ url: host + '/m3u8/' + encodeURIComponent(code) + '/master.txt?s=1&cache=1',
          quality: 'auto', container: 'hls', headers: headers, label: 'AnimeWorld India Hindi — MyStream' }];
      }).catch(function() { return []; });
    })).then(function(groups) {
      var out = [], seen = {};
      groups.forEach(function(g) { g.forEach(function(s) { if (!seen[s.url]) { seen[s.url] = 1; out.push(s); } }); });
      if (!out.length) throw new Error('AnimeWorld India: no playable MyStream playlists resolved');
      return out;
    });
  });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = {
  version: '1.0.0', getInfo: getInfo, getSettings: getSettings, getHome: getHome,
  search: search, getDetail: getDetail, getEpisodes: getEpisodes,
  getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks
};
