// AnimeGG — port of the Yuzono Aniyomi extension.
// Upstream implementation: https://github.com/yuzono/anime-extensions/tree/master/src/en/animegg
// Apache-2.0; adapted to the Zangetsu JavaScript provider contract.
// Catalog: /popular-series and /search/?q=; episode links from .newmanga;
// stream URLs are parsed from the source's own videoSources object in each iframe.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'yuzono-animegg';
var SITE = 'https://www.animegg.org';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getInfo() {
  return { name: 'AnimeGG (Yuzono)', lang: 'en', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animegg.org', type: 'anime', version: '1.0.0' };
}
function getSettings() { return []; }
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _text(s) {
  return String(s || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(+n); })
    .replace(/\s+/g, ' ').trim();
}
function _abs(href, base) {
  href = String(href || '').replace(/&amp;/g, '&').trim();
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  return String(base || SITE).replace(/\/$/, '') + (href.charAt(0) === '/' ? '' : '/') + href;
}
function _get(url, referer) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Referer': referer || SITE + '/', 'Accept-Language': 'en-US,en;q=0.9' }, timeoutMs: 12000 })
    .then(function(r) {
      if (!r || (r.status && r.status >= 400)) throw new Error('HTTP ' + (r && r.status));
      return String(r.body || '');
    });
}
function _attr(tag, name) {
  var re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\\'([^\\']*)\\'|([^\\s>]+))', 'i');
  var m = String(tag || '').match(re);
  return m ? (m[1] != null ? m[1] : m[2] != null ? m[2] : m[3] || '') : '';
}
function _blocks(html, selector) {
  var out = [], re = /<a\b[^>]*>[\s\S]*?<\/a>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    if (new RegExp('(?:^|\\s)' + selector + '(?:\\s|$)', 'i').test(_attr(m[0].match(/^<a\b[^>]*>/i)[0], 'class'))) out.push(m[0]);
  }
  return out;
}
function _cards(html, kind) {
  var out = [], seen = {}, blocks = _blocks(html, kind === 'popular' ? 'fea' : 'mse');
  blocks.forEach(function(block) {
    var head = (block.match(/^<a\b[^>]*>/i) || [''])[0];
    var href = _abs(_attr(head, 'href'), SITE);
    var title = kind === 'popular'
      ? _text((block.match(/class=["'][^"']*rightpop[^"']*["'][\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i) || [])[1])
      : _text((block.match(/class=["'][^"']*first[^"']*["'][\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>/i) || [])[1]);
    var img = _attr((block.match(/<img\b[^>]*>/i) || [''])[0], 'src') || _attr((block.match(/<img\b[^>]*>/i) || [''])[0], 'data-src');
    if (!href || !title || seen[href]) return;
    seen[href] = 1;
    out.push({ id: href.replace(SITE, ''), url: href, title: title, name: title, cover: img ? _abs(img, SITE) : null, poster: img ? _abs(img, SITE) : null, type: 'anime', sourceId: SOURCE_ID });
  });
  return out;
}
function search(query, page) {
  var q = _trim(query);
  if (!q || (page && page > 1)) return Promise.resolve([]);
  return _get(SITE + '/search/?q=' + encodeURIComponent(q), SITE + '/')
    .then(function(html) { return _cards(html, 'search'); }).catch(function() { return []; });
}
function getHome() {
  return _get(SITE + '/popular-series?sortBy=hits&sortDirection=DESC&ongoing&limit=50&start=0', SITE + '/')
    .then(function(html) {
      var items = _cards(html, 'popular');
      return items.length ? [{ title: 'Popular Anime', items: items }] : [];
    }).catch(function() { return []; });
}
function getDetail(url) {
  var full = _abs(url, SITE);
  return _get(full, SITE + '/').then(function(html) {
    var title = _text((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1])
      || _text((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1])
      || _text((html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [])[1]);
    var poster = (html.match(/property=["']og:image["'][^>]*content=["']([^"']+)/i) || [])[1]
      || (html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i) || [])[1];
    var description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) || [])[1] || '';
    return { id: full, url: full, title: title || full.split('/').filter(Boolean).pop(), name: title,
      cover: poster ? _abs(poster, SITE) : null, poster: poster ? _abs(poster, SITE) : null,
      description: _text(description), type: 'anime', sourceId: SOURCE_ID };
  }).catch(function() { return { id: full, url: full, title: full.split('/').filter(Boolean).pop(), type: 'anime', sourceId: SOURCE_ID }; });
}
function getEpisodes(url) {
  var full = _abs(url, SITE);
  return _get(full, SITE + '/').then(function(html) {
    var out = [], seen = {};
    var list = (html.match(/<[^>]+class=["'][^"']*newmanga[^"']*["'][\s\S]*?<\/ul>/i) || [])[0] || html;
    var re = /<li\b[^>]*>[\s\S]*?<\/li>/gi, m, idx = 0;
    while ((m = re.exec(list)) !== null) {
      var block = m[0];
      var a = (block.match(/<a\b[^>]*class=["'][^"']*anm_det_pop[^"']*["'][^>]*>/i) || block.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/i) || [''])[0];
      var href = _abs(_attr(a, 'href'), full);
      if (!href || seen[href]) continue;
      var strong = _text((block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i) || [])[1]);
      var title = _text((block.match(/class=["'][^"']*anititle[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i) || [])[1]);
      var nm = strong.match(/(\d+(?:\.\d+)?)/);
      var num = nm ? parseFloat(nm[1]) : ++idx;
      seen[href] = 1;
      out.push({ id: href, url: href, title: title ? (/episode/i.test(title) ? title : 'Episode ' + num + ' - ' + title) : 'Episode ' + num, name: title || ('Episode ' + num), number: num, episodeNumber: num, type: 'episode', sourceId: SOURCE_ID });
    }
    return out;
  }).catch(function() { return []; });
}
function _fixJson(s) {
  return String(s || '').replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3').replace(/,\s*([}\]])/g, '$1');
}
function getVideoSources(episodeUrl) {
  var ep = _abs(episodeUrl, SITE);
  return _get(ep, SITE + '/').then(function(html) {
    var frames = [], re = /<iframe\b[^>]*>/gi, m;
    while ((m = re.exec(html)) !== null) {
      var src = _attr(m[0], 'src') || _attr(m[0], 'data-src');
      if (src) frames.push(_abs(src, ep));
    }
    if (!frames.length) throw new Error('AnimeGG: episode page has no video iframes');
    return Promise.all(frames.slice(0, 12).map(function(frame) {
      return _get(frame, ep).then(function(embed) {
        var script = (embed.match(/var\s+videoSources\s*=\s*([\s\S]*?);/i) || [])[1];
        if (!script) throw new Error('AnimeGG: no videoSources object at ' + frame);
        var data;
        try { data = JSON.parse(_fixJson(script)); } catch (e) { data = null; }
        if (!data) throw new Error('AnimeGG: invalid videoSources JSON');
        var rows = Array.isArray(data) ? data : (data.sources || data.files || []);
        var host = frame.replace(/^(https?:\/\/[^/]+).*$/, '$1');
        return rows.map(function(v) {
          var raw = v && (v.file || v.src || v.url);
          if (!raw) return null;
          var url = _abs(raw, host);
          return { url: url, quality: String(v.label || v.quality || 'auto'), container: /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : 'mp4',
            headers: { 'User-Agent': UA, 'Referer': host + '/' }, label: 'AnimeGG ' + String(v.label || v.quality || '') };
        }).filter(function(v) { return v && v.url; });
      }).catch(function() { return []; });
    })).then(function(groups) {
      var out = [], seen = {};
      groups.forEach(function(group) { group.forEach(function(v) { if (!seen[v.url]) { seen[v.url] = 1; out.push(v); } }); });
      if (!out.length) throw new Error('AnimeGG: no playable streams resolved');
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
