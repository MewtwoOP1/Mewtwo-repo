// Rare Toons India / RareAnimesIndia — Hindi-dubbed anime and cartoons.
// Ported from the public CloudStream provider implementation; source website
// and download/embed hosts remain third-party and can change independently.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'raretoonsindia';
var VERSION = '1.0.0';
var SITE = 'https://www.rareanimes.mov';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var CATS = [
  ['hindi-dub', 'Hindi Dub'],
  ['cartoon-network', 'Cartoon Network'],
  ['disney-xd', 'Disney XD'],
  ['hungama', 'Hungama'],
  ['marvel-hq', 'Marvel HQ'],
  ['pokemon', 'Pokemon']
];

function getInfo() {
  return { name: 'Rare Toons India', lang: 'hi', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=rareanimes.mov', type: 'anime', version: VERSION };
}
function getSettings() { return []; }
function _get(url, ref) {
  return fetch(url, { headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': ref || SITE + '/'
  }, timeoutMs: 20000 }).then(function(r) { return r && r.body || ''; }).catch(function() { return ''; });
}
function _text(s) { return htmlText(String(s || '').replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }
function _unesc(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&#038;/g, '&').replace(/&#8217;|&#039;/g, "'").replace(/&quot;/g, '"').replace(/&#8211;/g, '–').replace(/&#8212;/g, '—');
}
function _abs(href, base) {
  href = _unesc(String(href || '').trim());
  if (!href || /^(?:javascript:|mailto:|#)/i.test(href)) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (href.indexOf('//') === 0) return 'https:' + href;
  var origin = (String(base || SITE).match(/^https?:\/\/[^/]+/i) || [SITE])[0];
  return origin + (href.charAt(0) === '/' ? href : '/' + href);
}
function _slug(url) {
  var s = String(url || '').replace(/[?#].*$/, '').replace(/\/$/, '');
  return s;
}
function _card(title, url, poster) {
  return { id: url, title: _unesc(title), url: url, cover: poster || null, type: 'anime', sourceId: SOURCE_ID };
}
function _cards(html) {
  var out = [], seen = {};
  var articles = String(html || '').match(/<article\b[\s\S]*?<\/article>/gi) || [];
  function add(title, href, image) {
    href = _abs(href, SITE);
    if (!href || !href.startsWith(SITE) || seen[href] || !title || _text(title).length < 2) return;
    if (/\/(?:category|tag|author|page)\//i.test(href) || /\?s=/i.test(href)) return;
    seen[href] = true;
    out.push(_card(_text(title), href, image ? _abs(image, SITE) : null));
  }
  articles.forEach(function(a) {
    var href = (a.match(/<a\b[^>]*href=["']([^"']+)["']/i) || [])[1];
    var title = (a.match(/<a\b[^>]*title=["']([^"']+)["']/i) || a.match(/<img\b[^>]*alt=["']([^"']+)["']/i) || [])[1];
    var image = (a.match(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["']/i) || [])[1];
    add(title, href, image);
  });
  if (out.length) return out.slice(0, 60);
  var re = /<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null && out.length < 60) {
    if (!/<img\b/i.test(m[3])) continue;
    var title = (m[3].match(/<img\b[^>]*alt=["']([^"']+)["']/i) || m[1].match(/title=["']([^"']+)["']/i) || [])[1];
    var image = (m[3].match(/<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i) || [])[1];
    add(title, m[2], image);
  }
  return out;
}
function getHome() {
  return _get(SITE + '/home/').then(function(html) {
    var items = _cards(html);
    return items.length ? [{ title: 'Rare Toons India', items: items }] : [];
  });
}
function search(query, page) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, Number(page) || 1);
  var urls = p === 1
    ? [SITE + '/search/' + encodeURIComponent(q).replace(/%20/g, '+') + '/', SITE + '/?s=' + encodeURIComponent(q)]
    : [SITE + '/page/' + p + '/?s=' + encodeURIComponent(q)];
  function tryAt(i) {
    if (i >= urls.length) return Promise.resolve([]);
    return _get(urls[i], SITE + '/').then(function(html) {
      var found = _cards(html);
      return found.length ? found : tryAt(i + 1);
    });
  }
  return tryAt(0);
}
function _content(html) {
  return (String(html || '').match(/<div\b[^>]*class=["'][^"']*entry-content[^"']*["'][^>]*>([\s\S]*?)(?:<div\b[^>]*class=["'][^"']*(?:comments|related)[^"']*["']|<footer\b|$)/i) || [])[1] || html || '';
}
function _episodeUrl(payload) { return 'raretoonsindia://' + encodeURIComponent(JSON.stringify(payload)); }
function getDetail(url) {
  var page = _abs(url, SITE);
  if (!page || !page.startsWith(SITE)) return Promise.resolve(null);
  return _get(page, SITE + '/').then(function(html) {
    if (!html) return null;
    var title = _text((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i) || [])[1]) || page.split('/').filter(Boolean).pop().replace(/[-_]/g, ' ');
    var poster = (html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i) || [])[1] || null;
    var body = _content(html), eps = [], seen = {};
    // Hub pages (e.g. Naruto) link to individual season/movie posts in headings.
    var hr = /<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi, hm;
    while ((hm = hr.exec(body)) !== null) {
      var a = (hm[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i) || []);
      if (!a[1]) continue;
      var u = _abs(a[1], page), label = _text(a[2]) || _text(hm[1]);
      if (!u || !u.startsWith(SITE) || u === page || seen[u]) continue;
      if (!/(season|movie|episode|part|s\d+)/i.test(label)) continue;
      seen[u] = true;
      eps.push({ id: _episodeUrl({ url: u, title: label, kind: 'subpage' }), title: label, number: eps.length + 1, url: _episodeUrl({ url: u, title: label, kind: 'subpage' }), type: 'anime', sourceId: SOURCE_ID });
    }
    if (!eps.length) {
      var current = 0, blocks = body.match(/<(?:p|div|li|h[2-6])\b[^>]*>[\s\S]*?<\/(?:p|div|li|h[2-6])>/gi) || [];
      var grouped = {}, order = [];
      blocks.forEach(function(b) {
        var label = _text(b);
        var match = label.match(/^(?:Episode|EP)\s*[.\-]?\s*(\d{1,3})\b/i);
        if (match) {
          current = Number(match[1]);
          if (!grouped[current]) { grouped[current] = []; order.push(current); }
        }
        var re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, am;
        while ((am = re.exec(b)) !== null) {
          var href = _abs(am[1], page), text = _text(am[2]);
          if (!href || !text || !(/codedew\.com\/(?:zipper|zipcloud)|store\.animetoonhindi\.com\/archives|\.(?:mp4|mkv)(?:[?#]|$)/i.test(href) || /download|\b(?:480|720|1080)p\b/i.test(text))) continue;
          var key = current > 0 ? current : (order.length + 1);
          if (!grouped[key]) { grouped[key] = []; order.push(key); }
          grouped[key].push({ url: href, label: text });
        }
      });
      order.forEach(function(n, i) {
        var links = (grouped[n] || []).filter(function(x, j, a) { return a.findIndex(function(y) { return y.url === x.url; }) === j; });
        if (!links.length) return;
        var payload = { url: page, title: title + ' Episode ' + n, number: n, links: links };
        var epUrl = _episodeUrl(payload);
        eps.push({ id: epUrl, title: payload.title, number: n, url: epUrl, type: 'anime', sourceId: SOURCE_ID });
      });
    }
    return { id: page, title: title, url: page, cover: poster ? _abs(poster, page) : null, description: _text((html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)/i) || [])[1] || ''), type: 'anime', sourceId: SOURCE_ID, episodes: eps };
  }).catch(function() { return null; });
}
function getEpisodes(url) { return getDetail(url).then(function(d) { return d && Array.isArray(d.episodes) ? d.episodes : []; }); }
function _mediaUrls(html) {
  var out = [], re = /https?:\\?\/\\?\/[^"'\s<>\\]+?\.(?:m3u8|mp4|mkv)(?:\?[^"'\s<>\\]*)?/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var u = m[0].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
    if (out.indexOf(u) < 0) out.push(u);
  }
  return out;
}
function _links(html, base) {
  var out = [], re = /<(?:iframe|source|video)\b[^>]*(?:src|data-src)=["']([^"']+)["'][^>]*>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var u = _abs(m[1], base);
    if (u && out.indexOf(u) < 0) out.push(u);
  }
  return out;
}
function _streamBeta(html, pageUrl) {
  var m = String(html || '').match(/playerSources\s*=\s*(\[[\s\S]*?\])\s*;/i);
  if (!m) return [];
  try {
    var a = JSON.parse(m[1]), out = [];
    a.forEach(function(x) {
      if (x && typeof x.streamUrl === 'string' && /^https?:\/\//i.test(x.streamUrl)) out.push({ url: x.streamUrl, name: 'Rare Toons ' + (x.name || 'Stream'), container: /\.m3u8/i.test(x.streamUrl) ? 'hls' : 'mp4', embed: false, downloadable: false, headers: { 'Referer': pageUrl } });
      if (x && typeof x.url === 'string' && /^https?:\/\//i.test(x.url) && /\.(?:mp4|mkv)(?:[?#]|$)/i.test(x.url)) out.push({ url: x.url, name: 'Rare Toons Download', container: 'mp4', embed: false, downloadable: true, headers: { 'Referer': pageUrl } });
    });
    return out;
  } catch (_) { return []; }
}
function _resolve(url, referer, depth) {
  depth = depth || 0;
  if (!url || depth > 3) return Promise.resolve([]);
  if (/\.(?:m3u8|mp4|mkv)(?:[?#]|$)/i.test(url)) return Promise.resolve([{ url: url, name: 'Rare Toons India', container: /\.m3u8/i.test(url) ? 'hls' : 'mp4', embed: false, downloadable: !/m3u8/i.test(url), headers: { 'User-Agent': UA, 'Referer': referer || SITE + '/' } }]);
  return _get(url, referer || SITE + '/').then(function(html) {
    var found = _mediaUrls(html).map(function(u) { return { url: u, name: 'Rare Toons India', container: /\.m3u8/i.test(u) ? 'hls' : 'mp4', embed: false, downloadable: !/m3u8/i.test(u), headers: { 'User-Agent': UA, 'Referer': url } }; });
    found = found.concat(_streamBeta(html, url));
    if (found.length) return found;
    var targets = _links(html, url).filter(function(u) { return /codedew\.com|argon\.|hubcloud|pixeldrain|gofile|streambeta|filepress|drive\.google|megaup|vidmoly|dood/i.test(u); });
    var next = [];
    targets.slice(0, 4).forEach(function(u) { next.push(_resolve(u, url, depth + 1)); });
    return Promise.all(next).then(function(rows) {
      var all = [];
      rows.forEach(function(a) { a.forEach(function(x) { if (!all.some(function(y) { return y.url === x.url; })) all.push(x); }); });
      // Keep a provider-specific embed as a last resort only if the site has an iframe.
      if (!all.length && /<iframe\b/i.test(html)) {
        var ifr = _links(html, url).filter(function(u) { return !/\.js(?:\?|$)|\.css(?:\?|$)/i.test(u); });
        if (ifr.length) all.push({ url: ifr[0], name: 'Rare Toons India Embed', container: 'embed', embed: true, downloadable: false, headers: { 'User-Agent': UA, 'Referer': url } });
      }
      return all;
    });
  }).catch(function() { return []; });
}
function getVideoSources(episodeUrl) {
  var raw = String(episodeUrl || '');
  if (raw.indexOf('raretoonsindia://') !== 0) return _resolve(_abs(raw, SITE), SITE + '/', 0);
  var payload;
  try { payload = JSON.parse(decodeURIComponent(raw.slice('raretoonsindia://'.length))); } catch (_) { return Promise.resolve([]); }
  if (payload.url && payload.kind === 'subpage') return _get(payload.url, SITE + '/').then(function(html) {
    var urls = _mediaUrls(html), links = [];
    var re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
    while ((m = re.exec(_content(html))) !== null) {
      var u = _abs(m[1], payload.url), label = _text(m[2]);
      if (u && (u.indexOf('codedew.com/zipper/') >= 0 || u.indexOf('codedew.com/zipcloud/') >= 0 || u.indexOf('store.animetoonhindi.com/archives/') >= 0 || /\.(?:mp4|mkv)(?:[?#]|$)/i.test(u))) links.push({url:u,label:label});
    }
    var jobs = links.slice(0, 12).map(function(x) { return _resolve(x.url, payload.url, 0); });
    return Promise.all(jobs).then(function(rows) {
      var all = [];
      urls.forEach(function(u) { all.push({url:u,name:'Rare Toons India',container:/\.m3u8/i.test(u)?'hls':'mp4',embed:false,headers:{'Referer':payload.url}}); });
      rows.forEach(function(a){a.forEach(function(x){if(!all.some(function(y){return y.url===x.url;}))all.push(x);});});
      return all;
    });
  }).catch(function(){return [];});
  var links = Array.isArray(payload.links) ? payload.links : [];
  var jobs = links.slice(0, 12).map(function(x) { return _resolve(_abs(x.url, payload.url), payload.url, 0); });
  return Promise.all(jobs).then(function(rows) {
    var all = [];
    rows.forEach(function(a) { a.forEach(function(x) { if (!all.some(function(y) { return y.url === x.url; })) all.push(x); }); });
    return all;
  }).catch(function() { return []; });
}
function getStreams(url) { return getVideoSources(url); }
if (typeof module !== 'undefined' && module.exports) module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams };
