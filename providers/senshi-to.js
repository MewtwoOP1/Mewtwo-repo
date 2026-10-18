// Senshi — Zangetsu community provider for senshi.to.
// Uses the app's native Cloudflare cookie resolver through normal fetch requests.
var SITE = 'https://senshi.to';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'senshi-to';
var VERSION = '1.0.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'Senshi', lang: 'en', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=senshi.to',
    type: 'anime', version: VERSION };
}
function getSettings() { return []; }
function _text(s) {
  var v = String(s || '').replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ');
  try { if (typeof htmlText === 'function') v = htmlText(v); } catch (_) {}
  return v.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}
function _url(path) {
  if (/^https?:\/\//i.test(String(path || ''))) return String(path);
  return SITE + (String(path || '').charAt(0) === '/' ? '' : '/') + String(path || '');
}
function _get(url, referer) {
  return fetch(url, { headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/json, text/plain, */*',
    'Referer': referer || SITE + '/'
  }, timeoutMs: 18000 }).then(function(r) {
    if (r && r.status >= 400) throw new Error('Senshi HTTP ' + r.status);
    var body = r && r.body != null ? r.body : '';
    return typeof body === 'string' ? body : JSON.stringify(body);
  });
}
function _json(url, referer) {
  return _get(url, referer).then(function(body) {
    try { return JSON.parse(body || 'null'); } catch (_) { return null; }
  });
}
function _arr(v) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.data)) return v.data;
  if (v && Array.isArray(v.results)) return v.results;
  if (v && Array.isArray(v.episodes)) return v.episodes;
  if (v && Array.isArray(v.embeds)) return v.embeds;
  return [];
}
function _slugFromUrl(url) {
  var s = String(url || '').split(/[?#]/)[0].replace(/\/$/, '');
  var p = s.split('/');
  return p[p.length - 1] || '';
}
function _cards(html) {
  var out = [], seen = {};
  var chunks = String(html || '').split(/class=["'][^"']*flw-item[^"']*["']/i);
  for (var i = 1; i < chunks.length; i++) {
    var c = chunks[i].slice(0, 6000);
    var a = c.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/i);
    if (!a) a = c.match(/<a\b[^>]*href=["']([^"']+)["']/i);
    var img = c.match(/<img\b[^>]*>/i);
    var title = (c.match(/class=["'][^"']*film-name[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i) || [])[1];
    if (!title && img) title = (img[0].match(/alt=["']([^"']+)["']/i) || [])[1];
    if (!title) title = (c.match(/title=["']([^"']+)["']/i) || [])[1];
    var href = a && a[1];
    if (!href || !title) continue;
    var slug = _slugFromUrl(href);
    if (!slug || seen[slug]) continue;
    seen[slug] = 1;
    var cover = img && ((img[0].match(/data-src=["']([^"']+)["']/i) || [])[1]
      || (img[0].match(/src=["']([^"']+)["']/i) || [])[1]);
    out.push({ id: slug, title: _text(title), englishTitle: _text(title),
      url: slug, cover: cover ? _url(cover) : null, type: 'anime', sourceId: SOURCE_ID,
      episodes: [], subCount: 0, dubCount: 0 });
  }
  // Senshi's newer frontend may use different card wrappers; accept simple title links as fallback.
  if (!out.length) {
    var re = /<a\b[^>]*href=["']([^"']*\/(?:anime|watch|series)\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
    while ((m = re.exec(String(html || ''))) !== null) {
      var slug2 = _slugFromUrl(m[1]), title2 = _text(m[2]);
      if (!slug2 || !title2 || title2.length > 120 || seen[slug2]) continue;
      seen[slug2] = 1;
      out.push({ id: slug2, title: title2, englishTitle: title2, url: slug2,
        cover: null, type: 'anime', sourceId: SOURCE_ID, episodes: [], subCount: 0, dubCount: 0 });
    }
  }
  return out;
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q || (page && Number(page) > 1)) return Promise.resolve([]);
  return _get(SITE + '/search?keyword=' + encodeURIComponent(q), SITE + '/')
    .then(_cards).catch(function() { return []; });
}
function getHome(opts) {
  return _get(SITE + '/', SITE + '/').then(function(html) {
    var sections = [], headings = [], re = /<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi, m;
    while ((m = re.exec(html)) !== null) headings.push({ name: _text(m[1]), at: m.index });
    var items = _cards(html);
    if (items.length) sections.push({ title: 'Senshi', items: items.slice(0, 30) });
    return sections;
  }).catch(function() { return []; });
}
function _episodeList(id) {
  return _json(SITE + '/episodes/' + encodeURIComponent(id), SITE + '/' + id)
    .then(function(data) {
      return _arr(data).map(function(ep, i) {
        var n = Number(ep && (ep.ep_id != null ? ep.ep_id :
          (ep.episode_number != null ? ep.episode_number : (ep.num != null ? ep.num : ep.number))));
        if (!(n > 0)) return null;
        return { id: String(id) + ':' + String(n), number: n,
          title: _text(ep.ep_title || ep.title || ('Episode ' + n)),
          url: 'senshi://' + encodeURIComponent(id) + '/' + encodeURIComponent(String(n)),
          sourceId: SOURCE_ID, type: 'anime' };
      }).filter(Boolean).sort(function(a,b){ return a.number-b.number; });
    }).catch(function() { return []; });
}
function getDetail(url, opts) {
  var id = String(url || '').replace(/^senshi:\/\//, '').split('/')[0] || _slugFromUrl(url);
  try { id = decodeURIComponent(id); } catch (_) {}
  return Promise.all([
    _get(SITE + '/' + encodeURIComponent(id), SITE + '/'),
    _episodeList(id)
  ]).then(function(values) {
    var html = values[0], eps = values[1];
    var title = _text((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]
      || (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || id);
    var description = (html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1]
      || (html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i) || [])[1] || '';
    var cover = (html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) || [])[1]
      || (html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i) || [])[1];
    var year = (html.match(/(?:release|year|aired)[^<]{0,100}?(20\d{2}|19\d{2})/i) || [])[1] || null;
    return { id:id, title:title, englishTitle:title, url:id, cover:cover ? _url(cover) : null,
      description:_text(description), year:year, type:'anime', sourceId:SOURCE_ID,
      episodes:eps, subCount:eps.length, dubCount:0 };
  }).catch(function() {
    return { id:id, title:id, url:id, type:'anime', sourceId:SOURCE_ID, episodes:[], subCount:0, dubCount:0 };
  });
}
function getEpisodes(url, opts) {
  var id = String(url || '').replace(/^senshi:\/\//, '').split('/')[0] || _slugFromUrl(url);
  try { id = decodeURIComponent(id); } catch (_) {}
  return _episodeList(id);
}
function _kind(url, hint) {
  var s = String(url || '').toLowerCase();
  if (/\.m3u8(?:[?#]|$)|\.mpd(?:[?#]|$)/.test(s) || /hls|dash/.test(String(hint || '').toLowerCase())) return 'hls';
  if (/\.mp4(?:[?#]|$)|\.m4v(?:[?#]|$)/.test(s) || /mp4|video/.test(String(hint || '').toLowerCase())) return 'mp4';
  return 'embed';
}
function _mediaFromHtml(html, base) {
  var out = [], seen = {};
  var patterns = [
    /(?:file|source|src|hls|m3u8|videoUrl|video_url)\s*["']?\s*[:=]\s*["'](https?:\\?\/\\?\/[^"'\s<>]+)["']/gi,
    /<source\b[^>]*src=["']([^"']+)["'][^>]*>/gi,
    /<video\b[^>]*src=["']([^"']+)["'][^>]*>/gi
  ];
  patterns.forEach(function(re) {
    var m;
    while ((m = re.exec(String(html || ''))) !== null) {
      var u = String(m[1] || '').replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      if (!/^https?:\/\//i.test(u)) continue;
      if (!/\.(m3u8|mp4|m4v|mpd)(?:[?#]|$)/i.test(u) && !/m3u8|playlist|\.mpd/i.test(u)) continue;
      if (!seen[u]) { seen[u] = 1; out.push({ url:u, quality:'Auto', container:_kind(u), headers:{Referer:base || SITE + '/'}, subtitles:[] }); }
    }
  });
  return out;
}
function _resolveOne(raw, epReferer) {
  var u = String(raw && (raw.url || raw.link || raw.server2 || raw.serverFM || raw.source) || '');
  if (!u) return Promise.resolve([]);
  if (!/^https?:\/\//i.test(u)) {
    return _json(SITE + '/ajax/v2/episode/sources?id=' + encodeURIComponent(u), epReferer)
      .then(function(data) {
        var link = data && (data.link || data.url);
        if (!link) return [];
        return _resolveOne({url:link, type:data.type || raw.type, status:data.server || raw.status}, epReferer);
      }).catch(function() { return []; });
  }
  var kind = _kind(u, raw.type || raw.status || raw.lang);
  if (kind !== 'embed') {
    return Promise.resolve([{ url:u, quality:'Auto', label:String(raw.status || raw.type || 'Senshi'),
      container:kind, headers:{'User-Agent':UA,'Referer':epReferer || SITE + '/'}, kind:'sub',
      audioLang:/dub|english/i.test(String(raw.status || raw.type || raw.lang || '')) ? 'en' : 'ja', subtitles:[] }]);
  }
  return _get(u, epReferer || SITE + '/').then(function(html) {
    var streams = _mediaFromHtml(html, u);
    return streams.map(function(v) {
      v.label = String(raw.status || raw.type || raw.lang || 'Senshi');
      v.headers = {'User-Agent':UA,'Referer':u};
      v.audioLang = /dub|english/i.test(String(raw.status || raw.type || raw.lang || '')) ? 'en' : 'ja';
      return v;
    });
  }).catch(function() { return []; });
}
function getVideoSources(episodeUrl, opts) {
  var raw = String(episodeUrl || '').replace(/^senshi:\/\//, '');
  var parts = raw.split('/');
  var id = ''; var num = '';
  try { id = decodeURIComponent(parts[0] || ''); num = decodeURIComponent(parts[1] || ''); } catch (_) {}
  if (!id || !(Number(num) > 0)) return Promise.resolve([]);
  var epRef = SITE + '/' + id;
  return _json(SITE + '/episode-embeds/' + encodeURIComponent(id) + '/' + encodeURIComponent(num), epRef)
    .then(function(data) {
      var embeds = _arr(data), jobs = [];
      embeds.forEach(function(embed) {
        if (!embed || typeof embed !== 'object') return;
        var u = embed.url || embed.server2 || embed.serverFM || embed.link || embed.sourceId || '';
        if (!u) return;
        jobs.push(_resolveOne({url:u, type:embed.type || embed.status || embed.lang || embed.audio,
          status:embed.status || embed.name || embed.server}, epRef));
      });
      return Promise.all(jobs).then(function(groups) {
        var out = [], seen = {};
        groups.forEach(function(group) { (group || []).forEach(function(v) {
          if (v && v.url && !seen[v.url]) { seen[v.url] = 1; out.push(v); }
        }); });
        return out;
      });
    }).catch(function() { return []; });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version:VERSION, getInfo:getInfo, getSettings:getSettings, getHome:getHome,
    search:search, getDetail:getDetail, getEpisodes:getEpisodes,
    getVideoSources:getVideoSources, getStreams:getStreams, getLinks:getLinks };
}
