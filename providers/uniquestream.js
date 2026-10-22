/*
 * Zangetsu source — Uniquestream (anime.uniquestream.net)
 * Uses public-facing HTML pages only. It does not call undocumented/private
 * APIs or bypass account, anti-bot, geographic, or other access controls.
 */
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'uniquestream';
var SITE = 'https://anime.uniquestream.net';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
var VERSION = '0.1.0';

function getInfo() {
  return { name: 'Uniquestream', lang: 'en', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=anime.uniquestream.net',
    type: 'anime', version: VERSION };
}
function getSettings() { return []; }

function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _decode(s) {
  return String(s == null ? '' : s)
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([\da-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
}
function _text(s) {
  var v = String(s || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ');
  if (typeof htmlText === 'function') { try { return _trim(htmlText(v)); } catch (e) {} }
  return _trim(_decode(v).replace(/\s+/g, ' '));
}
function _attr(tag, name) {
  var re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  var m = String(tag || '').match(re);
  return m ? _decode(m[1] != null ? m[1] : (m[2] != null ? m[2] : m[3])) : '';
}
function _abs(raw, base) {
  var s = _trim(_decode(raw));
  if (!s || /^(?:javascript|data|mailto):/i.test(s)) return '';
  try { return new URL(s, base || SITE + '/').href; }
  catch (e) { return ''; }
}
function _publicUrl(raw, base) {
  var u = _abs(raw, base);
  if (!u) return '';
  try {
    var p = new URL(u);
    if (p.protocol !== 'https:' && p.protocol !== 'http:') return '';
    if (p.hostname !== 'anime.uniquestream.net' && p.hostname !== 'media.uniquestream.net') return '';
    return p.href;
  } catch (e) { return ''; }
}
function _request(url, referer) {
  return Promise.resolve().then(function () {
    return fetch(url, { headers: {
      'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9', 'Referer': referer || SITE + '/'
    }, timeoutMs: 12000 });
  }).then(function (r) {
    if (!r) throw new Error('Uniquestream: empty response');
    var status = Number(r.status || 200);
    if (status < 200 || status >= 400) throw new Error('Uniquestream: HTTP ' + status);
    var body = typeof r.body === 'string' ? r.body : (typeof r.text === 'function' ? r.text() : '');
    return Promise.resolve(body).then(function (s) {
      if (!s || typeof s !== 'string') throw new Error('Uniquestream: empty or malformed HTML');
      if (/(checking your browser|cf-chl-|captcha|access denied)/i.test(s.slice(0, 5000)))
        throw new Error('Uniquestream: site access verification blocked the request');
      return s;
    });
  });
}
function _titleFromCard(card) {
  var m = card.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
    card.match(/<a\b[^>]*aria-label=["']([^"']+)["'][^>]*>/i) ||
    card.match(/<a\b[^>]*title=["']([^"']+)["'][^>]*>/i);
  var title = m ? _text(m[1]) : '';
  if (!title) {
    var clean = _text(card);
    title = clean.split(/\b(?:SUB|DUB|MOVIE|SERIES|WATCH NOW|WATCHLIST)\b/i)[0];
  }
  return _trim(title);
}
function _cards(html, base) {
  var source = String(html || ''), out = [], seen = {};
  var blocks = source.match(/<(?:article|li)\b[^>]*>[\s\S]*?<\/(?:article|li)>/gi) || [];
  if (!blocks.length) blocks = source.match(/<a\b[^>]*(?:href=["'][^"']*\/series\/|href=["'][^"']*\/film\/|href=["'][^"']*\/title\/)[^>]*>[\s\S]*?<\/a>/gi) || [];
  if (!blocks.length) blocks = source.match(/<a\b[^>]*href=["'][^"']*\/(?:series|film|title)\/[^"']+["'][^>]*>/gi) || [];
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i], anchors = block.match(/<a\b[^>]*>/gi) || [];
    var href = '';
    for (var j = 0; j < anchors.length; j++) {
      var candidate = _attr(anchors[j], 'href');
      if (/\/(?:series|film|title)\//i.test(candidate)) { href = candidate; break; }
    }
    if (!href) {
      var hm = block.match(/href=["']([^"']*\/(?:series|film|title)\/[^"']+)["']/i);
      if (hm) href = hm[1];
    }
    var url = _publicUrl(href, base);
    if (!url || seen[url]) continue;
    var title = _titleFromCard(block);
    if (!title) continue;
    seen[url] = true;
    var img = (block.match(/<(?:img|source)\b[^>]*>/i) || [''])[0];
    var imgSrc = _attr(img, 'src') || _attr(img, 'data-src') || _attr(img, 'srcset').split(',')[0].trim().split(/\s+/)[0];
    var cover = _publicUrl(imgSrc, base);
    if (!cover) cover = null;
    out.push({ id: url, title: title, url: url, cover: cover, type: /\/film\//i.test(url) ? 'movie' : 'anime', sourceId: SOURCE_ID });
  }
  return out;
}
function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var candidates = [SITE + '/search?q=' + encodeURIComponent(q), SITE + '/search/?q=' + encodeURIComponent(q)];
  return _request(candidates[0]).then(function (html) {
    var items = _cards(html, candidates[0]);
    if (items.length) return items;
    return _request(candidates[1]).then(function (alternate) { return _cards(alternate, candidates[1]); }, function () { return []; });
  }).catch(function () { return []; });
}
function popular(opts) {
  return _request(SITE + '/videos/popular/').then(function (html) { return _cards(html, SITE + '/videos/popular/'); }).catch(function () { return []; });
}
function getHome(opts) {
  return popular(opts).then(function (items) { return items.length ? [{ title: 'Popular Anime', items: items }] : []; });
}
function _seriesSlug(url) {
  var u = String(url || '');
  if (u.indexOf('uniquestream://') === 0) {
    try { u = decodeURIComponent(u.slice('uniquestream://'.length)); } catch (e) { return ''; }
  }
  var abs = _publicUrl(u, SITE + '/');
  if (!abs) return '';
  try { var parsed = new URL(abs); return parsed.pathname.replace(/\/+$/, ''); } catch (e) { return ''; }
}
function _metadata(html, url, slug) {
  var title = '';
  var m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (m) title = _text(m[1]);
  if (!title) {
    m = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*>/i) || html.match(/<title\b[^>]*>[\s\S]*?<\/title>/i);
    if (m) title = /<title/i.test(m[0]) ? _text(m[0]) : _attr(m[0], 'content');
  }
  title = title || slug.split('/').pop().replace(/-/g, ' ');
  var descTag = html.match(/<meta\b[^>]*name=["']description["'][^>]*>/i);
  var desc = descTag ? _attr(descTag[0], 'content') : '';
  var ogImage = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i);
  var cover = ogImage ? _publicUrl(_attr(ogImage[0], 'content'), url) : '';
  if (!cover) {
    var images = html.match(/<(?:img|source)\b[^>]*>/gi) || [];
    for (var i = 0; i < images.length; i++) {
      cover = _publicUrl(_attr(images[i], 'src') || _attr(images[i], 'data-src'), url);
      if (cover) break;
    }
  }
  var yearMatch = html.match(/\b(?:YEAR|Release year)\s*<[^>]*>\s*(\d{4})/i);
  var year = yearMatch ? Number(yearMatch[1]) : null;
  var eps = _episodeItems(html, url);
  return { id: url, title: title, url: url, cover: cover || null, description: desc,
    year: year, status: 'unknown', genres: [], studios: [], type: /\/film\//i.test(url) ? 'movie' : 'anime',
    sourceId: SOURCE_ID, episodes: eps, subCount: eps.length, dubCount: 0 };
}
function _episodeItems(html, base) {
  var out = [], seen = {};
  var anchors = String(html || '').match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i], open = (a.match(/^<a\b[^>]*>/i) || [''])[0];
    var href = _attr(open, 'href');
    if (!/\/watch\/[A-Za-z0-9_-]+(?:\/|$)/i.test(href)) continue;
    var page = _publicUrl(href, base);
    if (!page || seen[page]) continue;
    var title = _text(a) || _attr(open, 'aria-label') || _attr(open, 'title');
    if (!title) title = 'Episode ' + (out.length + 1);
    var nm = title.match(/(?:episode|ep\.?|e)\s*0*(\d+(?:\.\d+)?)/i);
    var pathNum = page.match(/(?:episode|ep|e)[-_/]?0*(\d+(?:\.\d+)?)(?:\/|$)/i);
    var number = nm ? Number(nm[1]) : (pathNum ? Number(pathNum[1]) : out.length + 1);
    seen[page] = true;
    out.push({ id: 'uniquestream://episode/' + encodeURIComponent(page), number: number,
      title: title, url: 'uniquestream://episode/' + encodeURIComponent(page), sourceId: SOURCE_ID, type: 'anime' });
  }
  if (!out.length) {
    var tags = String(html || '').match(/<(?:button|div|li)\b[^>]*\bdata-(?:episode|watch-url|url)=["'][^"']+["'][^>]*>/gi) || [];
    for (var j = 0; j < tags.length; j++) {
      var raw = _attr(tags[j], 'data-episode') || _attr(tags[j], 'data-watch-url') || _attr(tags[j], 'data-url');
      var page2 = _publicUrl(raw, base);
      if (!page2 || !/\/watch\//.test(page2) || seen[page2]) continue;
      seen[page2] = true;
      out.push({ id: 'uniquestream://episode/' + encodeURIComponent(page2), number: out.length+1,
        title:'Episode '+(out.length+1), url:'uniquestream://episode/'+encodeURIComponent(page2), sourceId:SOURCE_ID, type:'anime' });
    }
  }
  out.sort(function(a,b){ return a.number-b.number; });
  return out;
}
function getDetail(url, opts) {
  var slug = _seriesSlug(url);
  if (!slug) return Promise.reject(new Error('Uniquestream: invalid or non-public series URL'));
  var page = SITE + slug + (slug.endsWith('/') ? '' : '/');
  return _request(page).then(function (html) { return _metadata(html, page, slug); });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; }).catch(function () { return []; });
}
function _episodePage(epUrl) {
  var raw = String(epUrl || '');
  if (raw.indexOf('uniquestream://episode/') !== 0) throw new Error('Uniquestream: invalid episode URL');
  var encoded = raw.slice('uniquestream://episode/'.length), page;
  try { page = decodeURIComponent(encoded); } catch (e) { throw new Error('Uniquestream: malformed episode URL'); }
  var safe = _publicUrl(page, SITE + '/');
  if (!safe || !/\/watch\/[A-Za-z0-9_-]+(?:\/|$)/i.test(new URL(safe).pathname)) throw new Error('Uniquestream: invalid watch page URL');
  return safe;
}
function getVideoSources(episodeUrl, opts) {
  var page;
  try { page = _episodePage(episodeUrl); } catch (e) { return Promise.reject(e); }
  return _request(page, page).then(function (html) {
    var out = [], seen = {};
    var attrs = html.match(/<(?:video|source|iframe|a)\b[^>]*>/gi) || [];
    for (var i = 0; i < attrs.length; i++) {
      var tag = attrs[i], raw = _attr(tag, 'src') || _attr(tag, 'data-src') || _attr(tag, 'href');
      var url = _abs(raw, page);
      if (!/^https?:\/\//i.test(url) || seen[url]) continue;
      var host;
      try { host = new URL(url).hostname.toLowerCase(); } catch (e) { continue; }
      if (!(host === 'anime.uniquestream.net' || host === 'media.uniquestream.net') ||
          !/\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(url)) continue;
      seen[url] = true;
      out.push({ url: url, quality: 'Auto', label: 'Uniquestream',
        container: /\.m3u8/i.test(url) ? 'hls' : (/\.mpd/i.test(url) ? 'dash' : 'mp4'),
        headers: { 'User-Agent': UA, 'Referer': page, 'Origin': SITE }, kind: 'sub', audioLang: 'ja' });
    }
    if (!out.length) {
      var jsonBlocks = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
      for (var j = 0; j < jsonBlocks.length; j++) {
        var content = jsonBlocks[j].replace(/^<[\s\S]*?>/, '').replace(/<\/script>\s*$/i, '');
        try {
          var data = JSON.parse(content), list = Array.isArray(data) ? data : [data];
          for (var k = 0; k < list.length; k++) {
            var rawUrl = list[k] && (list[k].contentUrl || list[k].embedUrl);
            var u = _publicUrl(rawUrl, page);
            if (u && /\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(u) && !seen[u]) {
              seen[u] = true;
              out.push({ url:u, quality:'Auto', label:'Uniquestream JSON-LD',
                container:/\.m3u8/i.test(u)?'hls':(/\.mpd/i.test(u)?'dash':'mp4'),
                headers:{'User-Agent':UA,'Referer':page,'Origin':SITE},kind:'sub',audioLang:'ja' });
            }
          }
        } catch (e) {}
      }
    }
    if (!out.length) throw new Error('Uniquestream: public watch page did not expose a direct playable media URL');
    return out;
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = {
  version: VERSION, getInfo:getInfo, getSettings:getSettings, getHome:getHome, popular:popular,
  search:search, getDetail:getDetail, getEpisodes:getEpisodes, getVideoSources:getVideoSources,
  getStreams:getStreams, getLinks:getLinks
};function _attr(tag,name) { var m=String(tag||'').match(new RegExp('(?:^|\\\\s)'+name+'\\\\s*=\\\\s*[\"\\\\x27]([^\"\\\\x27]*)[\"\\\\x27]','i')); return m?_decode(m[1]):''; }\nfunction _abs(raw, base) {
  var s = _trim(_decode(raw));
  if (!s || /^(?:javascript|data|mailto):/i.test(s)) return '';
  try { return new URL(s, base || SITE + '/').href; }
  catch (e) { return ''; }
}
function _publicUrl(raw, base) {
  var u = _abs(raw, base);
  if (!u) return '';
  try {
    var p = new URL(u);
    if (p.protocol !== 'https:' && p.protocol !== 'http:') return '';
    if (p.hostname !== 'anime.uniquestream.net' && p.hostname !== 'media.uniquestream.net') return '';
    return p.href;
  } catch (e) { return ''; }
}
function _request(url, referer) {
  return Promise.resolve().then(function () {
    return fetch(url, { headers: {
      'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9', 'Referer': referer || SITE + '/'
    }, timeoutMs: 12000 });
  }).then(function (r) {
    if (!r) throw new Error('Uniquestream: empty response');
    var status = Number(r.status || 200);
    if (status < 200 || status >= 400) throw new Error('Uniquestream: HTTP ' + status);
    var body = typeof r.body === 'string' ? r.body : (typeof r.text === 'function' ? r.text() : '');
    return Promise.resolve(body).then(function (s) {
      if (!s || typeof s !== 'string') throw new Error('Uniquestream: empty or malformed HTML');
      if (/(checking your browser|cf-chl-|captcha|access denied)/i.test(s.slice(0, 5000)))
        throw new Error('Uniquestream: site access verification blocked the request');
      return s;
    });
  });
}
function _titleFromCard(card) {
  var m = card.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i) ||
    card.match(/<a\b[^>]*aria-label=["']([^"']+)["'][^>]*>/i) ||
    card.match(/<a\b[^>]*title=["']([^"']+)["'][^>]*>/i);
  var title = m ? _text(m[1]) : '';
  if (!title) {
    var clean = _text(card);
    title = clean.split(/\b(?:SUB|DUB|MOVIE|SERIES|WATCH NOW|WATCHLIST)\b/i)[0];
  }
  return _trim(title);
}
function _cards(html, base) {
  var source = String(html || ''), out = [], seen = {};
  var blocks = source.match(/<(?:article|li)\b[^>]*>[\s\S]*?<\/(?:article|li)>/gi) || [];
  if (!blocks.length) blocks = source.match(/<a\b[^>]*(?:href=["'][^"']*\/series\/|href=["'][^"']*\/film\/|href=["'][^"']*\/title\/)[^>]*>[\s\S]*?<\/a>/gi) || [];
  if (!blocks.length) blocks = source.match(/<a\b[^>]*href=["'][^"']*\/(?:series|film|title)\/[^"']+["'][^>]*>/gi) || [];
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i], anchors = block.match(/<a\b[^>]*>/gi) || [];
    var href = '';
    for (var j = 0; j < anchors.length; j++) {
      var candidate = _attr(anchors[j], 'href');
      if (/\/(?:series|film|title)\//i.test(candidate)) { href = candidate; break; }
    }
    if (!href) {
      var hm = block.match(/href=["']([^"']*\/(?:series|film|title)\/[^"']+)["']/i);
      if (hm) href = hm[1];
    }
    var url = _publicUrl(href, base);
    if (!url || seen[url]) continue;
    var title = _titleFromCard(block);
    if (!title) continue;
    seen[url] = true;
    var img = (block.match(/<(?:img|source)\b[^>]*>/i) || [''])[0];
    var imgSrc = _attr(img, 'src') || _attr(img, 'data-src') || _attr(img, 'srcset').split(',')[0].trim().split(/\s+/)[0];
    var cover = _publicUrl(imgSrc, base);
    if (!cover) cover = null;
    out.push({ id: url, title: title, url: url, cover: cover, type: /\/film\//i.test(url) ? 'movie' : 'anime', sourceId: SOURCE_ID });
  }
  return out;
}
function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var candidates = [SITE + '/search?q=' + encodeURIComponent(q), SITE + '/search/?q=' + encodeURIComponent(q)];
  return _request(candidates[0]).then(function (html) {
    var items = _cards(html, candidates[0]);
    if (items.length) return items;
    return _request(candidates[1]).then(function (alternate) { return _cards(alternate, candidates[1]); }, function () { return []; });
  }).catch(function () { return []; });
}
function popular(opts) {
  return _request(SITE + '/videos/popular/').then(function (html) { return _cards(html, SITE + '/videos/popular/'); }).catch(function () { return []; });
}
function getHome(opts) {
  return popular(opts).then(function (items) { return items.length ? [{ title: 'Popular Anime', items: items }] : []; });
}
function _seriesSlug(url) {
  var u = String(url || '');
  if (u.indexOf('uniquestream://') === 0) {
    try { u = decodeURIComponent(u.slice('uniquestream://'.length)); } catch (e) { return ''; }
  }
  var abs = _publicUrl(u, SITE + '/');
  if (!abs) return '';
  try { var parsed = new URL(abs); return parsed.pathname.replace(/\/+$/, ''); } catch (e) { return ''; }
}
function _metadata(html, url, slug) {
  var title = '';
  var m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  if (m) title = _text(m[1]);
  if (!title) {
    m = html.match(/<meta\b[^>]*property=["']og:title["'][^>]*>/i) || html.match(/<title\b[^>]*>[\s\S]*?<\/title>/i);
    if (m) title = /<title/i.test(m[0]) ? _text(m[0]) : _attr(m[0], 'content');
  }
  title = title || slug.split('/').pop().replace(/-/g, ' ');
  var descTag = html.match(/<meta\b[^>]*name=["']description["'][^>]*>/i);
  var desc = descTag ? _attr(descTag[0], 'content') : '';
  var ogImage = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i);
  var cover = ogImage ? _publicUrl(_attr(ogImage[0], 'content'), url) : '';
  if (!cover) {
    var images = html.match(/<(?:img|source)\b[^>]*>/gi) || [];
    for (var i = 0; i < images.length; i++) {
      cover = _publicUrl(_attr(images[i], 'src') || _attr(images[i], 'data-src'), url);
      if (cover) break;
    }
  }
  var yearMatch = html.match(/\b(?:YEAR|Release year)\s*<[^>]*>\s*(\d{4})/i);
  var year = yearMatch ? Number(yearMatch[1]) : null;
  var eps = _episodeItems(html, url);
  return { id: url, title: title, url: url, cover: cover || null, description: desc,
    year: year, status: 'unknown', genres: [], studios: [], type: /\/film\//i.test(url) ? 'movie' : 'anime',
    sourceId: SOURCE_ID, episodes: eps, subCount: eps.length, dubCount: 0 };
}
function _episodeItems(html, base) {
  var out = [], seen = {};
  var anchors = String(html || '').match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || [];
  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i], open = (a.match(/^<a\b[^>]*>/i) || [''])[0];
    var href = _attr(open, 'href');
    if (!/\/watch\/[A-Za-z0-9_-]+(?:\/|$)/i.test(href)) continue;
    var page = _publicUrl(href, base);
    if (!page || seen[page]) continue;
    var title = _text(a) || _attr(open, 'aria-label') || _attr(open, 'title');
    if (!title) title = 'Episode ' + (out.length + 1);
    var nm = title.match(/(?:episode|ep\.?|e)\s*0*(\d+(?:\.\d+)?)/i);
    var pathNum = page.match(/(?:episode|ep|e)[-_/]?0*(\d+(?:\.\d+)?)(?:\/|$)/i);
    var number = nm ? Number(nm[1]) : (pathNum ? Number(pathNum[1]) : out.length + 1);
    seen[page] = true;
    out.push({ id: 'uniquestream://episode/' + encodeURIComponent(page), number: number,
      title: title, url: 'uniquestream://episode/' + encodeURIComponent(page), sourceId: SOURCE_ID, type: 'anime' });
  }
  if (!out.length) {
    var tags = String(html || '').match(/<(?:button|div|li)\b[^>]*\bdata-(?:episode|watch-url|url)=["'][^"']+["'][^>]*>/gi) || [];
    for (var j = 0; j < tags.length; j++) {
      var raw = _attr(tags[j], 'data-episode') || _attr(tags[j], 'data-watch-url') || _attr(tags[j], 'data-url');
      var page2 = _publicUrl(raw, base);
      if (!page2 || !/\/watch\//.test(page2) || seen[page2]) continue;
      seen[page2] = true;
      out.push({ id: 'uniquestream://episode/' + encodeURIComponent(page2), number: out.length+1,
        title:'Episode '+(out.length+1), url:'uniquestream://episode/'+encodeURIComponent(page2), sourceId:SOURCE_ID, type:'anime' });
    }
  }
  out.sort(function(a,b){ return a.number-b.number; });
  return out;
}
function getDetail(url, opts) {
  var slug = _seriesSlug(url);
  if (!slug) return Promise.reject(new Error('Uniquestream: invalid or non-public series URL'));
  var page = SITE + slug + (slug.endsWith('/') ? '' : '/');
  return _request(page).then(function (html) { return _metadata(html, page, slug); });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes || []; }).catch(function () { return []; });
}
function _episodePage(epUrl) {
  var raw = String(epUrl || '');
  if (raw.indexOf('uniquestream://episode/') !== 0) throw new Error('Uniquestream: invalid episode URL');
  var encoded = raw.slice('uniquestream://episode/'.length), page;
  try { page = decodeURIComponent(encoded); } catch (e) { throw new Error('Uniquestream: malformed episode URL'); }
  var safe = _publicUrl(page, SITE + '/');
  if (!safe || !/\/watch\/[A-Za-z0-9_-]+(?:\/|$)/i.test(new URL(safe).pathname)) throw new Error('Uniquestream: invalid watch page URL');
  return safe;
}
function getVideoSources(episodeUrl, opts) {
  var page;
  try { page = _episodePage(episodeUrl); } catch (e) { return Promise.reject(e); }
  return _request(page, page).then(function (html) {
    var out = [], seen = {};
    var attrs = html.match(/<(?:video|source|iframe|a)\b[^>]*>/gi) || [];
    for (var i = 0; i < attrs.length; i++) {
      var tag = attrs[i], raw = _attr(tag, 'src') || _attr(tag, 'data-src') || _attr(tag, 'href');
      var url = _abs(raw, page);
      if (!/^https?:\/\//i.test(url) || seen[url]) continue;
      var host;
      try { host = new URL(url).hostname.toLowerCase(); } catch (e) { continue; }
      if (!(host === 'anime.uniquestream.net' || host === 'media.uniquestream.net') ||
          !/\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(url)) continue;
      seen[url] = true;
      out.push({ url: url, quality: 'Auto', label: 'Uniquestream',
        container: /\.m3u8/i.test(url) ? 'hls' : (/\.mpd/i.test(url) ? 'dash' : 'mp4'),
        headers: { 'User-Agent': UA, 'Referer': page, 'Origin': SITE }, kind: 'sub', audioLang: 'ja' });
    }
    if (!out.length) {
      var jsonBlocks = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
      for (var j = 0; j < jsonBlocks.length; j++) {
        var content = jsonBlocks[j].replace(/^<[\s\S]*?>/, '').replace(/<\/script>\s*$/i, '');
        try {
          var data = JSON.parse(content), list = Array.isArray(data) ? data : [data];
          for (var k = 0; k < list.length; k++) {
            var rawUrl = list[k] && (list[k].contentUrl || list[k].embedUrl);
            var u = _publicUrl(rawUrl, page);
            if (u && /\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(u) && !seen[u]) {
              seen[u] = true;
              out.push({ url:u, quality:'Auto', label:'Uniquestream JSON-LD',
                container:/\.m3u8/i.test(u)?'hls':(/\.mpd/i.test(u)?'dash':'mp4'),
                headers:{'User-Agent':UA,'Referer':page,'Origin':SITE},kind:'sub',audioLang:'ja' });
            }
          }
        } catch (e) {}
      }
    }
    if (!out.length) throw new Error('Uniquestream: public watch page did not expose a direct playable media URL');
    return out;
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = {
  version: VERSION, getInfo:getInfo, getSettings:getSettings, getHome:getHome, popular:popular,
  search:search, getDetail:getDetail, getEpisodes:getEpisodes, getVideoSources:getVideoSources,
  getStreams:getStreams, getLinks:getLinks
};
