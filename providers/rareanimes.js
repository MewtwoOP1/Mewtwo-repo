// RareAnimes — provider for the Rare Toons India / RareAnimes WordPress site.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'rareanimes';
var VERSION = '1.0.0';
var SITE = 'https://www.rareanimes.mov';
var CODEDEW = 'https://codedew.com';
var STREAM_BETA = CODEDEW + '/streambeta/';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getInfo() {
  return { name: 'RareAnimes', lang: 'hi', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=rareanimes.mov',
    type: 'anime', version: VERSION };
}
function getSettings() { return []; }
function _decode(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
}
function _text(s) {
  return _decode(String(s || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function _attr(tag, name) {
  var re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))', 'i');
  var m = String(tag || '').match(re);
  return m ? _decode(m[1] || m[2] || m[3] || '') : '';
}
function _abs(url, base) {
  var u = _decode(String(url || '').trim());
  if (!u || /^(?:javascript:|mailto:|data:|#)/i.test(u)) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf('//') === 0) return 'https:' + u;
  try { return new URL(u, base || SITE + '/').href; }
  catch (_) {
    var origin = (String(base || SITE).match(/^https?:\/\/[^/]+/i) || [SITE])[0];
    return origin + (u.charAt(0) === '/' ? u : '/' + u);
  }
}
function _siteUrl(url) {
  try {
    var u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'rareanimes.mov' || u.hostname === 'www.rareanimes.mov');
  } catch (_) { return false; }
}
function _get(url, referer) {
  return fetch(url, { headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
    'Referer': referer || SITE + '/'
  }, timeoutMs: 20000 }).then(function(r) {
    r = r || {};
    return { status: Number(r.status || r.statusCode || 0), body: String(r.body || ''),
      url: String(r.finalUrl || r.url || url), headers: r.headers || {} };
  }).catch(function() { return { status: 0, body: '', url: url, headers: {} }; });
}
function _episodeId(payload) { return 'rareanimes://' + encodeURIComponent(JSON.stringify(payload)); }
function _card(title, url, poster, desc, type) {
  return { id: url, title: _text(title) || 'Untitled', url: url, cover: poster || null,
    description: _text(desc || ''), type: type || 'anime', sourceId: SOURCE_ID };
}
function _isIndexTitle(title) {
  return /^\s*all\b[\s\S]*\blist\s*$/i.test(_text(title)) ||
    /(?:index|directory)\s+of\s+(?:all\s+)?(?:anime|cartoon)/i.test(_text(title));
}
function _cards(html) {
  html = String(html || '');
  var out = [], seen = {};
  function add(title, href, poster, classes) {
    href = _abs(href, SITE + '/');
    title = _text(title);
    if (!href || !_siteUrl(href) || !title || title.length < 2 || seen[href] || _isIndexTitle(title)) return;
    var path = new URL(href).pathname;
    if (/\/(?:category|tag|author|page|wp-json|wp-content)\//i.test(path) || /[?&]s=/i.test(href)) return;
    if (/^(?:home|search|next|previous|older posts|newer posts)$/i.test(title)) return;
    seen[href] = true;
    var clean = title.replace(/\s*[|–-]\s*(?:Rare Toons India|RareAnimes)\s*$/i, '').trim();
    out.push(_card(clean, href, poster ? _abs(poster, href) : null, '',
      /\bmovie\b/i.test(classes || '') ? 'movie' : 'anime'));
  }
  var articles = html.match(/<article\b[^>]*>[\s\S]*?<\/article>/gi) || [];
  articles.forEach(function(article) {
    var heading = (article.match(/<(?:h1|h2|h3)[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>[\s\S]*?<\/(?:h1|h2|h3)>/i) || [])[0] || '';
    var link = (heading.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i) || []);
    if (!link[1]) {
      var alternate = (article.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i) || []);
      if (alternate[1] && /(?:entry-title|post-title)/i.test(_attr(alternate[1], 'class'))) link = alternate;
    }
    var title = link[2] || (article.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i) || [])[1] ||
      (article.match(/<img\b[^>]*alt=["']([^"']+)["']/i) || [])[1];
    var href = _attr(link[1], 'href');
    if (!href && link[1]) href = _attr(link[1], 'href');
    // Covers WP cards where the title attribute appears on the first image anchor.
    if (!href) {
      var aTag = (article.match(/<a\b[^>]*>/i) || [])[0] || '';
      href = _attr(aTag, 'href');
      if (!title) title = _attr(aTag, 'title') || (article.match(/<img\b[^>]*alt=["']([^"']+)["']/i) || [])[1];
    }
    var imgTag = (article.match(/<img\b[^>]*>/i) || [])[0] || '';
    var poster = _attr(imgTag, 'data-src') || _attr(imgTag, 'data-lazy-src') || _attr(imgTag, 'src');
    if (href && title) add(title, href, poster, _attr(article, 'class'));
  });
  if (out.length) return out.slice(0, 80);
  // Some homepage layouts have linked cards without an <article> wrapper.
  // Only inspect headings, not the global nav tree.
  var re = /<(?:h2|h3)\b[^>]*>([\s\S]*?)<\/(?:h2|h3)>/gi, m;
  while ((m = re.exec(html)) !== null && out.length < 80) {
    var a = (m[1].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i) || []);
    if (!a[1]) continue;
    var href2 = _attr(a[1], 'href'), title2 = _text(a[2]) || _attr(a[1], 'title');
    var segment = html.slice(m.index, Math.min(html.length, m.index + 1400));
    var im = (segment.match(/<img\b[^>]*>/i) || [])[0] || '';
    add(title2, href2, _attr(im, 'data-src') || _attr(im, 'src'), '');
  }
  return out;
}
function getHome(opts) {
  return _get(SITE + '/home/', SITE + '/').then(function(r) {
    var items = _cards(r.body);
    if (!items.length) return _get(SITE + '/', SITE + '/').then(function(root) { return _cards(root.body); });
    return items;
  }).then(function(items) { return items.length ? [{ title: 'RareAnimes', items: items }] : []; })
    .catch(function() { return []; });
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, Number(page) || 1);
  var url = SITE + (p > 1 ? '/page/' + p + '/' : '/') + '?s=' + encodeURIComponent(q).replace(/%20/g, '+');
  return _get(url, SITE + '/').then(function(r) { return _cards(r.body); }).catch(function() { return []; });
}
function _content(html) {
  var m = String(html || '').match(/<div\b[^>]*class=["'][^"']*\bentry-content\b[^"']*["'][^>]*>([\s\S]*?)(?:<\/article>|<div\b[^>]*class=["'][^"']*\b(?:comments|related-posts)\b[^"']*["']|$)/i);
  return m ? m[1] : String(html || '');
}
function _language(text) {
  var s = _text(text).toLowerCase();
  var langs = [['hindi','Hindi'],['हिंदी','Hindi'],['हिन्दी','Hindi'],['tamil','Tamil'],['தமிழ்','Tamil'],
    ['telugu','Telugu'],['తెలుగు','Telugu'],['malayalam','Malayalam'],['bengali','Bengali'],
    ['kannada','Kannada'],['marathi','Marathi'],['english','English'],['japanese','Japanese']];
  for (var i = 0; i < langs.length; i++) if (s.indexOf(langs[i][0]) !== -1) return langs[i][1];
  return 'Hindi';
}
function _linkKind(label, href) {
  var s = String(label || '').toLowerCase().replace(/[^a-z]/g, '');
  if (/^https?:\/\//i.test(String(href || '')) && /\.(?:m3u8|mp4|mkv)(?:$|[?#])/i.test(href)) return 'direct';
  if (s === 'watchnow' || s === 'watch' || s === 'watchbeta') return 'watch';
  if (s === 'hubcloud') return 'hub';
  if (s === 'streambeta') return 'streambeta';
  if (s.indexOf('watchmultiquality') >= 0 || s.indexOf('watchmultquality') >= 0 || s === 'quickmulti' || s === 'multiquality') return 'multi';
  if (/\.(?:m3u8|mp4|mkv)(?:$|[?#])/i.test(String(href || ''))) return 'direct';
  return '';
}
function _parsePost(content, pageUrl) {
  var links = [];
  var normalized = String(content || '').replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/gi, '');
  normalized = normalized.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, function(all, attrs, inner) {
    var href = _attr(attrs, 'href'), label = _text(inner);
    if (!href) return ' ' + label + ' ';
    var url = _abs(href, pageUrl);
    var index = links.push({ url: url, label: label, kind: _linkKind(label, url) }) - 1;
    return ' \u0001' + index + '\u0002 ';
  });
  normalized = normalized.replace(/<br\b[^>]*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote|section)>/gi, '\n')
    .replace(/<(?:p|div|li|h[1-6]|tr|blockquote|section)\b[^>]*>/gi, '\n')
    .replace(/<hr\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ');
  var lines = normalized.split(/\r?\n/).map(function(line) {
    var lineLinks = [];
    var text = _decode(line).replace(/\u0001(\d+)\u0002/g, function(_, n) {
      var item = links[Number(n)]; if (item) lineLinks.push(item);
      return '';
    }).replace(/\s+/g, ' ').trim();
    return { text: text, links: lineLinks };
  }).filter(function(line) { return line.text || line.links.length; });
  var episodes = {}, order = [], current = 0, loose = [];
  function ensure(number, title) {
    if (!episodes[number]) { episodes[number] = { number: number, title: title || 'Episode ' + number, variants: [] }; order.push(number); }
    else if (title && /^Episode \d+$/i.test(episodes[number].title)) episodes[number].title = title;
    return episodes[number];
  }
  lines.forEach(function(line) {
    var head = line.text.match(/^(?:episode|ep\.?)\s*0*(\d{1,4})\b\s*(?:[-–:]\s*(.*))?$/i);
    if (head) {
      current = Number(head[1]);
      ensure(current, head[2] ? ('Episode ' + current + ' – ' + head[2].trim()) : ('Episode ' + current));
    } else if (/^(?:season\b|watch\s*\/\s*download|winding up|thanks for)/i.test(line.text) && !line.links.length) {
      current = 0;
    }
    if (!line.links.length) return;
    var target = current ? ensure(current) : null;
    line.links.forEach(function(link) {
      if (!link.kind || !link.url) return;
      var item = { url: link.url, label: link.label || link.kind, kind: link.kind, language: _language(line.text) };
      if (target) {
        var variant = target.variants.find(function(v) { return v.language === item.language; });
        if (!variant) { variant = { language: item.language, links: [] }; target.variants.push(variant); }
        if (!variant.links.some(function(x) { return x.url === item.url; })) variant.links.push(item);
      } else if (!loose.some(function(x) { return x.url === item.url; })) loose.push(item);
    });
  });
  var parsed = order.sort(function(a,b) { return a-b; }).map(function(n) { return episodes[n]; })
    .filter(function(ep) { return ep.variants.some(function(v) { return v.links.length; }); });
  return { episodes: parsed, loose: loose };
}
function _makeEpisode(pageUrl, postTitle, ep, index) {
  var links = [];
  (ep.variants || []).forEach(function(v) {
    (v.links || []).forEach(function(link) {
      links.push({ url: link.url, label: link.label, kind: link.kind, language: link.language || v.language });
    });
  });
  var payload = { kind: 'episode', page: pageUrl,
    title: ep.title || (postTitle + ' Episode ' + ep.number),
    number: Number(ep.number) || index + 1, language: 'Hindi', links: links };
  var url = _episodeId(payload);
  return { id: url, title: payload.title, number: payload.number, url: url, type: 'anime', sourceId: SOURCE_ID };
}
function _parseTitle(html, fallbackUrl) {
  var t = (String(html || '').match(/<h1\b[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
    (String(html || '').match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i) || [])[1] ||
    (String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  t = _text(t).replace(/\s*[|–-]\s*(?:Rare Toons India|RareAnimes)\s*$/i, '').trim();
  if (t) return t;
  try { return decodeURIComponent(new URL(fallbackUrl).pathname.split('/').filter(Boolean).pop() || 'Anime').replace(/[-_]+/g, ' '); } catch (_) { return 'Anime'; }
}
function getDetail(url, opts) {
  var page = _abs(url, SITE + '/');
  if (!_siteUrl(page)) return Promise.resolve(null);
  return _get(page, SITE + '/').then(function(r) {
    if (r.status >= 400 || !r.body) return null;
    var title = _parseTitle(r.body, page);
    var img = (r.body.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)/i) || [])[1] ||
      (r.body.match(/<img\b[^>]*class=["'][^"']*wp-post-image[^"']*["'][^>]*>/i) || [])[0];
    if (img && img.indexOf('<') === 0) img = _attr(img, 'src') || _attr(img, 'data-src');
    var desc = (r.body.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)/i) || [])[1] || '';
    var parsed = _parsePost(_content(r.body), page);
    var eps = parsed.episodes.map(function(ep, i) { return _makeEpisode(page, title, ep, i); });
    if (!eps.length && parsed.loose.length) {
      eps.push(_makeEpisode(page, title, { number:1, title:'Watch / Download',
        variants:[{ language:'Hindi', links:parsed.loose }] }, 0));
    }
    return { id: page, title: title, url: page, cover: img ? _abs(img, page) : null,
      description: _text(desc), status: 'unknown', genres: [], studios: [],
      type: 'anime', sourceId: SOURCE_ID, episodes: eps };
  }).catch(function() { return null; });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function(d) { return d && Array.isArray(d.episodes) ? d.episodes : []; });
}
function _mediaUrls(html) {
  var out = [], re = /https?:\\?\/\\?\/[^"'\s<>\\]+?\.(?:m3u8|mp4|mkv)(?:\?[^"'\s<>\\]*)?/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var u = _decode(m[0]).replace(/\\\//g, '/').replace(/&amp;/g, '&');
    if (!out.some(function(x) { return x.url === u; })) out.push({ url:u });
  }
  return out;
}
function _quality(s) {
  var raw = String(s.title || s.quality || s.resolution || s.name || '');
  var m = raw.match(/\b(2160|1440|1080|720|576|540|480|360)p\b/i);
  return m ? m[1] + 'p' : 'Auto';
}
function _normaliseDirect(url, name, quality, referer) {
  var hls = /\.m3u8(?:$|[?#])/i.test(url);
  var q = quality || (String(url).match(/\b(2160|1440|1080|720|576|540|480|360)p\b/i) || [])[0] || 'Auto';
  return { url:url, name:name || 'RareAnimes', provider:'RareAnimes', quality:q,
    label:(name || 'RareAnimes') + ' • ' + q, resolution:q,
    container:hls ? 'hls' : (/\.mkv(?:$|[?#])/i.test(url) ? 'mkv' : 'mp4'),
    hls:hls, embed:false, downloadable:!hls,
    headers:{ 'User-Agent':UA, 'Referer':referer || SITE + '/' },
    subtitles:[], isActive:true, priority:0 };
}
function _streamBetaStreams(html, pageUrl, fallbackLanguage) {
  var match = String(html || '').match(/playerSources\s*=\s*(\[[\s\S]*?\])\s*;/i);
  if (!match) return [];
  var sources;
  try { sources = JSON.parse(match[1]); } catch (_) { return []; }
  if (!Array.isArray(sources)) return [];
  var language = (String(html || '').match(/currentLangNative\s*=\s*["']([^"']+)["']/i) || [])[1] || fallbackLanguage || 'Hindi';
  language = _text(language) || 'Hindi';
  var out = [];
  sources.forEach(function(s) {
    if (!s || typeof s !== 'object') return;
    // StreamBeta's live schema uses snake_case; retain other known variants as compatibility fallbacks.
    var url = s.stream_url || s.url || s.streamUrl || s.file;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || /pixeldrain/i.test(String(s.type || ''))) return;
    if (out.some(function(x) { return x.url === url; })) return;
    out.push(_normaliseDirect(url, language + ' • ' + (s.name || s.type || 'Server'), _quality(s), pageUrl));
  });
  return out;
}
function _hubToStreamBeta(zipperUrl, pageUrl) {
  var url = String(zipperUrl || '');
  if (!url) return Promise.resolve('');
  var next = url + (/[?&]ad_done=/.test(url) ? '' : (url.indexOf('?') >= 0 ? '&' : '?') + 'ad_done=1');
  return _get(next, pageUrl || SITE + '/').then(function(r) {
    var target = _abs((r.body.match(/\bdata-href\s*=\s*["']([^"']+)["']/i) || [])[1] || '', r.url || next);
    var idMatch = target.match(/hubcloud\.[a-z0-9.-]+\/drive\/([A-Za-z0-9_-]+)/i) || [];
    if (idMatch[1]) return STREAM_BETA + '?url=' + encodeURIComponent(idMatch[1]);
    var finalMatch = String(r.url || '').match(/hubcloud\.[a-z0-9.-]+\/drive\/([A-Za-z0-9_-]+)/i) || [];
    if (finalMatch[1]) return STREAM_BETA + '?url=' + encodeURIComponent(finalMatch[1]);
    if (target && /\/zipper\//i.test(target)) {
      return _get(target, next).then(function(r2) {
        var t2 = _abs((r2.body.match(/\bdata-href\s*=\s*["']([^"']+)["']/i) || [])[1] || '', r2.url || target);
        var id2 = (t2.match(/hubcloud\.[a-z0-9.-]+\/drive\/([A-Za-z0-9_-]+)/i) || [])[1];
        return id2 ? STREAM_BETA + '?url=' + encodeURIComponent(id2) : '';
      });
    }
    return '';
  }).catch(function() { return ''; });
}
function _resolveOne(link, pageUrl, language) {
  if (!link || !link.url) return Promise.resolve([]);
  var url = _abs(link.url, pageUrl), kind = link.kind || _linkKind(link.label, url);
  if (kind === 'direct' || /\.(?:m3u8|mp4|mkv)(?:$|[?#])/i.test(url)) {
    return Promise.resolve([_normaliseDirect(url, language || link.language || 'RareAnimes', 'Auto', pageUrl)]);
  }
  if (kind === 'multi') {
    if (typeof extractVideo !== 'function') return Promise.resolve([]);
    return Promise.resolve(extractVideo(url, { headers:{ 'User-Agent':UA, 'Referer':pageUrl } }))
      .then(function(data) {
        var items = Array.isArray(data) ? data : (data ? [data] : []);
        return items.map(function(x) {
          var stream = x && (x.url || x.stream_url || x.file);
          return stream && /^https?:\/\//i.test(stream) ? _normaliseDirect(stream, language || 'RareAnimes • MultiQuality', _quality(x || {}), url) : null;
        }).filter(Boolean);
      }).catch(function() { return []; });
  }
  var request = kind === 'hub'
    ? _hubToStreamBeta(url, pageUrl).then(function(sb) {
        return sb ? _get(sb, url).then(function(r) { return { response:r, requested:sb }; }) : { response:null, requested:'' };
      })
    : _get(url, pageUrl).then(function(r) { return { response:r, requested:url }; });
  return request.then(function(result) {
    var r = result.response;
    if (!r) return [];
    var finalUrl = String(r.url || result.requested || url);
    var parsed = _streamBetaStreams(r.body, finalUrl, language || link.language);
    if (parsed.length) return parsed;
    if (/\/streambeta\//i.test(finalUrl) && finalUrl !== result.requested) {
      return _get(finalUrl, url).then(function(r2) {
        var list = _streamBetaStreams(r2.body, finalUrl, language || link.language);
        return list.length ? list : _mediaUrls(r2.body).map(function(x) { return _normaliseDirect(x.url, language || 'RareAnimes', 'Auto', finalUrl); });
      });
    }
    var direct = _mediaUrls(r.body).map(function(x) { return _normaliseDirect(x.url, finalUrl, 'Auto', finalUrl); });
    if (direct.length) return direct;
    if (/\.(?:m3u8|mp4|mkv)(?:$|[?#])/i.test(finalUrl)) return [_normaliseDirect(finalUrl, language || 'RareAnimes', 'Auto', url)];
    // WatchNow can redirect to a StreamBeta target; resolve its final URL explicitly.
    if (kind === 'watch' || kind === 'streambeta') {
      var betaUrl = '';
      if (/\/streambeta\//i.test(finalUrl)) betaUrl = finalUrl;
      else {
        var queryMatch = finalUrl.match(/(?:\?|&)url=([A-Za-z0-9_-]+)/);
        if (queryMatch && /codedew\.com/i.test(finalUrl)) betaUrl = STREAM_BETA + '?url=' + encodeURIComponent(queryMatch[1]);
      }
      if (betaUrl) return _get(betaUrl, finalUrl).then(function(r2) {
        var list = _streamBetaStreams(r2.body, betaUrl, language || link.language);
        return list.length ? list : _mediaUrls(r2.body).map(function(x) { return _normaliseDirect(x.url, language || 'RareAnimes', 'Auto', betaUrl); });
      });
    }
    return [];
  }).catch(function() { return []; });
}
function getVideoSources(episodeUrl, opts) {
  var raw = String(episodeUrl || '');
  if (raw.indexOf('rareanimes://') !== 0) return Promise.resolve([]);
  var payload;
  try { payload = JSON.parse(decodeURIComponent(raw.slice('rareanimes://'.length))); } catch (_) { return Promise.resolve([]); }
  var links = Array.isArray(payload.links) ? payload.links.slice() : [];
  var rank = { watch:0, streambeta:0, hub:1, direct:2, multi:9 };
  links.sort(function(a,b) {
    return (rank[a.kind] == null ? 5 : rank[a.kind]) - (rank[b.kind] == null ? 5 : rank[b.kind]);
  });
  var out = [], seen = {};
  function tryAt(i) {
    if (i >= links.length || out.length) return Promise.resolve(out);
    return _resolveOne(links[i], payload.page || SITE + '/', links[i].language || payload.language || 'Hindi').then(function(items) {
      (items || []).forEach(function(item) {
        if (!item || !item.url || seen[item.url]) return;
        seen[item.url] = true; out.push(item);
      });
      return out.length ? out : tryAt(i + 1);
    }).catch(function() { return tryAt(i + 1); });
  }
  return tryAt(0).then(function(items) { return items; }).catch(function() { return []; });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) module.exports = {
  version:VERSION, getInfo:getInfo, getSettings:getSettings, getHome:getHome,
  search:search, getDetail:getDetail, getEpisodes:getEpisodes,
  getVideoSources:getVideoSources, getStreams:getStreams
};
