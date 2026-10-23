// providers/av1encodes.js
// AV1Encodes — rebuilt for the MewtwoOP1/Zangetsu-repo contract.
// Original logic ported from yuzono/anime-extensions AV1Encodes Kotlin extension.
// Scraping, metadata, search, episode discovery, DDL extraction, redirect
// resolution and playback behaviour are preserved. Only the export/settings/
// getStreams surface was adapted to this repository's provider model.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID)
  : 'av1encodes';

var DEFAULT_DOMAIN = 'https://av1encodes.com';
var DOMAIN_HOSTS = ['av1encodes.com', 'animealpha.cc', 'av1please.com'];
var DOMAIN_BASES = ['https://av1encodes.com', 'https://animealpha.cc', 'https://av1please.com'];
var BASE = DEFAULT_DOMAIN;
var EMBEDDED_DDL_CACHE = {};
var EMBEDDED_DDL_TTL_MS = 5 * 60 * 1000;

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Zangetsu has no provider preference UI, so these mirror the Kotlin defaults.
var PREFERRED_QUALITY = '1920 x 1080';
var PREFERRED_LINK_TYPE = 'Stream';
var SHOW_TORRENT = false;

var ALL_RESOLUTIONS = ['1920 x 1080', '1280 x 720', '854 x 480', '640 x 360'];

var RES_LABEL_REGEX = /\[(\d+p)\]/i;
var AUDIO_TAG_REGEX = /\[(Dual|Sub|Dub|Tri|Multi)\]/i;
var EPISODE_NUMBER_REGEX = /E(\d+)/i;
var EPISODE_S_NUMBER_REGEX = /\[(?:S\d+-)?E(\d+)\]/i;
var EPISODE_NAME_REGEX = /\[(?:S\d+-)?E(\d+)\]\s*(.+?)\s*\[/i;
var SUBDUB_REGEX = /\[(Dual|Sub|Dub|English Dub)\]/i;
var QUALITY_REGEX = /\[\d{3,4}p\].*/i;
var TOKEN_REGEX = /['"](A{4,}[A-Za-z0-9_\-]{10,})['"]/;
var BACKGROUND_URL_REGEX = /url\(['"](.*?)['"]\)/i;

function getInfo() {
  return {
    name: 'AV1Encodes',
    lang: 'en',
    baseUrl: BASE,
    logo: 'icons/av1encodes.png',
    type: 'anime',
    version: '1.0.0'
  };
}

function getSettings() {
  return [];
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function _headers(ref) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': ref || (BASE + '/'),
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };
}

function _isAllowedSiteHost(host) {
  var value = String(host || '').toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
  for (var i = 0; i < DOMAIN_HOSTS.length; i++) {
    if (value === DOMAIN_HOSTS[i] || value.slice(-(DOMAIN_HOSTS[i].length + 1)) === '.' + DOMAIN_HOSTS[i]) return true;
  }
  return false;
}

function _isBlockedResponse(response, path) {
  if (!response) return true;
  var status = Number(response.status) || 0;
  var body = String(response.body || '');
  if (status >= 400) return true;
  if (/<title[^>]*>\s*(?:just a moment|attention required|access denied)|cf-chl-|verify you are human|cloudflare ray id/i.test(body)) return true;
  if (/^\/download\//i.test(String(path || '')) && /unable to generate download link|failed to generate download/i.test(body)) return true;
  return false;
}

function _rebaseReferer(ref, base) {
  if (!ref) return base + '/';
  var path = _normalizePath(ref);
  return path ? base + path : ref;
}

function _fetchWithFallback(url, ref, extraHeaders, method) {
  var raw = String(url || '');
  var absolute = raw.match(/^https?:\/\/([^/]+)([\s\S]*)$/i);
  var absoluteIsSite = !!(absolute && _isAllowedSiteHost(absolute[1]));
  var isRelative = !absolute && !/^\/\//.test(raw);
  if (!absoluteIsSite && !isRelative) {
    var directHeaders = _headers(ref);
    if (extraHeaders) {
      for (var dk in extraHeaders) {
        if (Object.prototype.hasOwnProperty.call(extraHeaders, dk)) directHeaders[dk] = extraHeaders[dk];
      }
    }
    var directOptions = { headers: directHeaders };
    if (method) directOptions.method = method;
    return fetch(raw, directOptions);
  }

  var sitePath = absoluteIsSite ? (absolute[2] || '/') : raw;
  if (sitePath.charAt(0) !== '/') sitePath = '/' + sitePath;
  var candidates = [];
  function addBase(base) {
    if (base && candidates.indexOf(base.replace(/\/+$/, '')) === -1) candidates.push(base.replace(/\/+$/, ''));
  }
  addBase(BASE);
  if (absoluteIsSite) addBase('https://' + absolute[1].replace(/^www\./i, ''));
  for (var i = 0; i < DOMAIN_BASES.length; i++) addBase(DOMAIN_BASES[i]);

  function attempt(index, lastResponse) {
    if (index >= candidates.length) {
      return Promise.resolve(lastResponse || { status: 0, body: '', url: raw });
    }
    var base = candidates[index];
    var target = base + sitePath;
    var headers = _headers(_rebaseReferer(ref, base));
    if (extraHeaders) {
      for (var k in extraHeaders) {
        if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) headers[k] = extraHeaders[k];
      }
    }
    var options = { headers: headers };
    if (method) options.method = method;
    return fetch(target, options).then(function (response) {
      if (!_isBlockedResponse(response, sitePath)) {
        BASE = base;
        return response;
      }
      return attempt(index + 1, response);
    }).catch(function () {
      return attempt(index + 1, lastResponse);
    });
  }
  return attempt(0, null);
}

function _get(url, ref) {
  var path = _normalizePath(url) || String(url || '');
  return _fetchWithFallback(url, ref, null, 'GET').then(function (response) {
    if (_isBlockedResponse(response, path)) return '';
    return response.body || '';
  }).catch(function () {
    return '';
  });
}

function _getJson(url, ref, extraHeaders) {
  var path = _normalizePath(url) || String(url || '');
  return _fetchWithFallback(url, ref, extraHeaders, 'GET').then(function (response) {
    if (_isBlockedResponse(response, path)) return null;
    var body = response.body || '';
    try { return JSON.parse(body); } catch (e) { return null; }
  }).catch(function () {
    return null;
  });
}

function _absUrl(path) {
  if (!path) return BASE + '/';
  if (/^https?:\/\//i.test(path)) return path;
  if (path.charAt(0) === '/') return BASE + path;
  return BASE + '/' + path;
}

function _normalizePath(href) {
  var value = String(href || '').trim();
  if (!value) return '';
  if (value.indexOf('//') === 0) value = 'https:' + value;
  if (value.charAt(0) === '/') return value;
  if (!/^https?:\/\//i.test(value)) return value;

  var m = value.match(/^https?:\/\/([^/]+)(\/[^#]*)?/i);
  if (!m || !_isAllowedSiteHost(m[1])) return '';
  return m[2] || '/';
}

function _episodeUrl(href) {
  var value = String(href || '').trim();
  if (!value) return '';
  var normalized = _normalizePath(value);
  if (normalized && normalized.indexOf('/download/') === 0) return normalized;
  return '';
}

function _ddlCacheKey(href) {
  var path = _episodeUrl(href) || _normalizePath(href);
  if (!path) return '';
  return path.split('?')[0];
}

function _cacheEmbeddedDdl(href, ddl) {
  if (!ddl || typeof ddl !== 'object') return;
  if (!ddl.stream_link && !ddl.download_link && !ddl.watch_link && !ddl.torrent_link) return;
  var key = _ddlCacheKey(href);
  if (key) EMBEDDED_DDL_CACHE[key] = { ddl: ddl, at: Date.now() };
}

function _getCachedDdl(href) {
  var key = _ddlCacheKey(href);
  var entry = key ? EMBEDDED_DDL_CACHE[key] : null;
  if (!entry) return null;
  if (Date.now() - entry.at > EMBEDDED_DDL_TTL_MS) {
    delete EMBEDDED_DDL_CACHE[key];
    return null;
  }
  return entry.ddl;
}

function _text(s) {
  var raw = String(s || '').replace(/<[^>]*>/g, '');
  if (typeof htmlText === 'function') return htmlText(raw).replace(/^\s+|\s+$/g, '');
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/^\s+|\s+$/g, '');
}

// ── Card parsing ─────────────────────────────────────────────────────────────

function _parseCardChunk(chunk) {
  var hrefMatch = chunk.match(/href="([^"]*\/anime\/[^"?#]+)"/i);
  if (!hrefMatch) return null;
  var href = _normalizePath(hrefMatch[1]);
  if (!href || href === '/anime/' || href.indexOf('/anime/') !== 0) return null;

  var imgMatch = chunk.match(/<img[^>]*(?:data-src|data-lazy-src|src)="([^"]+)"/i);
  var img = imgMatch ? imgMatch[1] : null;

  var titleMatch = chunk.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/i) ||
    chunk.match(/class="[^"]*spotlight-title[^"]*"[^>]*>([\s\S]*?)<\//i) ||
    chunk.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
  var title = titleMatch ? _text(titleMatch[1]) : '';
  if (!title) return null;

  return {
    id: href,
    title: title,
    url: href,
    cover: img,
    type: 'anime',
    sourceId: SOURCE_ID
  };
}

function _parseCards(html, blockRegex) {
  var out = [];
  var seen = {};
  var blocks = [];

  if (blockRegex) {
    var re = new RegExp(blockRegex.source, 'gi');
    var m;
    while ((m = re.exec(html)) !== null) blocks.push(m[0]);
  } else {
    blocks = [html];
  }

  for (var i = 0; i < blocks.length; i++) {
    var card = _parseCardChunk(blocks[i]);
    if (card && !seen[card.url]) {
      seen[card.url] = 1;
      out.push(card);
    }
  }
  return out;
}

function _parseCardsGeneric(html) {
  var out = [];
  var seen = {};
  var re = /<a\b[^>]*href="([^"]*\/anime\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;

  while ((m = re.exec(html)) !== null) {
    var href = _normalizePath(m[1]);
    if (!href || href.indexOf('/anime/') !== 0 || href === '/anime/') continue;

    var start = Math.max(0, m.index - 800);
    var end = Math.min(html.length, m.index + m[0].length + 800);
    var ctx = html.substring(start, end);

    var imgM = ctx.match(/<img[^>]*(?:data-src|data-lazy-src|src)="([^"]+)"/i);
    var titleM = m[2].match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/i) ||
      ctx.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/i) ||
      ctx.match(/class="[^"]*spotlight-title[^"]*"[^>]*>([\s\S]*?)<\//i);

    var title = titleM ? _text(titleM[1]) : _text(m[2]);
    if (!title) continue;
    if (seen[href]) continue;

    seen[href] = 1;
    out.push({
      id: href,
      title: title,
      url: href,
      cover: imgM ? imgM[1] : null,
      type: 'anime',
      sourceId: SOURCE_ID
    });
  }
  return out;
}

function _parseAnimeListPage(html) {
  var out = [];
  var seen = {};
  var re = /<a\b[^>]*href="([^"]*\/anime\/[^"?#]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;

  while ((m = re.exec(html)) !== null) {
    var href = _normalizePath(m[1]);
    if (!href || href.indexOf('/anime/') !== 0 || href === '/anime/') continue;
    var title = _text(m[2]).trim();
    if (!title || seen[href]) continue;
    seen[href] = 1;
    out.push({
      id: href,
      title: title,
      url: href,
      cover: null,
      type: 'anime',
      sourceId: SOURCE_ID
    });
  }
  return out;
}

function _sectionHtml(html, marker) {
  var idx = html.indexOf(marker);
  if (idx < 0) return '';
  var start = html.lastIndexOf('<', idx);
  if (start < 0) start = idx;
  var end = html.indexOf('</section>', idx);
  if (end < 0) end = html.indexOf('</main>', idx);
  if (end < 0) end = Math.min(html.length, idx + 60000);
  return html.substring(start, end);
}

function _parseHomeSection(html, kind) {
  var out = [];
  var seen = {};

  function addCards(cards) {
    for (var i = 0; i < cards.length; i++) {
      if (!seen[cards[i].url]) {
        seen[cards[i].url] = 1;
        out.push(cards[i]);
      }
    }
  }

  if (kind === 'popular') {
    addCards(_parseCards(html, /<article\b[^>]*class="[^"]*spotlight-slide[^"]*"[^>]*>[\s\S]*?<\/article>/));
    var lc = _sectionHtml(html, 'latestCompletedList');
    if (lc) addCards(_parseCards(lc, /<li\b[^>]*>[\s\S]*?<\/li>/));
    var sb = _sectionHtml(html, 'sidebar-list-panel');
    if (sb) addCards(_parseCards(sb, /<li\b[^>]*>[\s\S]*?<\/li>/));
  } else {
    var eg = _sectionHtml(html, 'episodeGrid');
    if (eg) addCards(_parseCards(eg, /<article\b[^>]*>[\s\S]*?<\/article>/));
    var lp = _sectionHtml(html, 'latest-panel');
    if (lp) addCards(_parseCards(lp, /<article\b[^>]*>[\s\S]*?<\/article>/));
  }
  return out;
}

function getHome(opts) {
  return _get(BASE + '/').then(function (html) {
    var rows = [];
    var popular = _parseHomeSection(html, 'popular');
    if (popular.length) rows.push({ title: 'Popular', items: popular });
    var latest = _parseHomeSection(html, 'latest');
    if (latest.length) rows.push({ title: 'Latest Episodes', items: latest });

    if (!rows.length) {
      var all = _parseCardsGeneric(html);
      if (all.length) rows.push({ title: 'Anime', items: all });
    }
    return rows;
  }).catch(function () {
    return [];
  });
}

// ── Search ───────────────────────────────────────────────────────────────────

function _extractDetailImage(html) {
  var m = html.match(/<img[^>]*class="[^"]*(?:anime-poster|poster)[^"]*"[^>]*(?:data-src|src)="([^"]+)"/i) ||
    html.match(/<img[^>]*(?:data-src|src)="([^"]+)"[^>]*class="[^"]*(?:anime-poster|poster)[^"]*"/i) ||
    html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
  return m ? m[1] : null;
}

function _fetchMissingCovers(cards) {
  var need = [];
  for (var i = 0; i < cards.length; i++) {
    if (!cards[i].cover) need.push(cards[i]);
  }
  if (!need.length) return Promise.resolve(cards);

  function batch(start) {
    if (start >= need.length) return Promise.resolve(cards);
    var slice = need.slice(start, start + 5);
    var jobs = [];

    for (var j = 0; j < slice.length; j++) {
      (function (card) {
        jobs.push(_get(_absUrl(card.url)).then(function (html) {
          var img = _extractDetailImage(html);
          if (img) card.cover = img;
        }));
      })(slice[j]);
    }

    return Promise.all(jobs).then(function () {
      return batch(start + 5);
    });
  }
  return batch(0);
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  var p = page || 1;

  if (q.length < 1) {
    return _get(BASE + '/anime?page=' + p).then(function (html) {
      return _fetchMissingCovers(_parseAnimeListPage(html));
    }).catch(function () {
      return [];
    });
  }

  var url = BASE + '/search?q=' + encodeURIComponent(q) + '&page=' + p;
  return _get(url).then(function (html) {
    var cards = _parseCardsGeneric(html);
    if (!cards.length) cards = _parseAnimeListPage(html);
    return cards;
  }).catch(function () {
    return [];
  });
}

// ── Detail + episodes ────────────────────────────────────────────────────────

function _parseDetail(html, url) {
  var titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    html.match(/<h1[^>]*class="[^"]*anime-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i);
  var title = titleM ? _text(titleM[1]) : '';

  var cover = _extractDetailImage(html);

  var descM = html.match(/<div[^>]*class="[^"]*(?:anime-synopsis|synopsis|description|overview|desc)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  var description = descM ? _text(descM[1]) : '';

  var genres = [];
  var gre = /<a\b[^>]*href="[^"]*\/genre\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  var gm;
  while ((gm = gre.exec(html)) !== null) {
    var g = _text(gm[1]);
    if (g && genres.indexOf(g) === -1) genres.push(g);
  }

  var authorM = html.match(/<[^>]*class="[^"]*studio[^"]*"[^>]*>([\s\S]*?)<\//i);
  var author = authorM ? _text(authorM[1]) : null;

  var status = /class="[^"]*(?:airing|status-airing|airing-badge)[^"]*"/i.test(html)
    ? 'ongoing'
    : 'completed';

  return {
    id: String(url),
    title: title || String(url),
    url: String(url),
    cover: cover,
    description: description,
    status: status,
    genres: genres,
    studios: author ? [author] : [],
    type: 'anime',
    sourceId: SOURCE_ID,
    episodes: [],
    year: null,
    malId: null,
    subCount: 0,
    dubCount: 0
  };
}

function _qualityCandidates(pref) {
  var normalized = pref;
  if (pref.indexOf('1080') > -1) normalized = '1920 x 1080';
  else if (pref.indexOf('720') > -1) normalized = '1280 x 720';
  else if (pref.indexOf('480') > -1) normalized = '854 x 480';
  else if (pref.indexOf('360') > -1) normalized = '640 x 360';

  var list = [normalized];
  for (var i = 0; i < ALL_RESOLUTIONS.length; i++) {
    if (ALL_RESOLUTIONS[i] !== normalized) list.push(ALL_RESOLUTIONS[i]);
  }
  return list.map(function (r) {
    return encodeURIComponent(r);
  });
}

function _resLabelFromResolution(res) {
  if (res.indexOf('1080') > -1) return '1080p';
  if (res.indexOf('720') > -1) return '720p';
  if (res.indexOf('480') > -1) return '480p';
  if (res.indexOf('360') > -1) return '360p';
  return res;
}

function _parseSeasons(html) {
  var seasons = [];
  var re = /data-season="([^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var s = m[1].trim();
    if (s && seasons.indexOf(s) === -1) seasons.push(s);
  }
  if (!seasons.length) seasons = ['1'];
  return seasons;
}

function _extractDownloadLinks(html) {
  var out = [];
  var re = /<a\b[^>]*href="([^"]*\/download\/[^"]+)"/gi;
  var m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function _extractFilenames(html) {
  var set = {};
  var out = [];

  function add(fn) {
    var clean = decodeURIComponent(String(fn || '').trim());
    if (!clean || clean.indexOf('/') > -1) return;
    if (!set[clean]) {
      set[clean] = 1;
      out.push(clean);
    }
  }

  var links = _extractDownloadLinks(html);
  for (var i = 0; i < links.length; i++) {
    add(links[i].split('?')[0].split('/').pop());
  }

  var re = /([a-zA-Z0-9_ \-\[\]().%]+?\.(?:mkv|mp4))/gi;
  var m;
  while ((m = re.exec(html)) !== null) add(m[1]);
  return out;
}

function _parseEpisodeNumber(filename) {
  var m = filename.match(EPISODE_S_NUMBER_REGEX);
  if (m) return parseFloat(m[1]);
  m = filename.match(EPISODE_NUMBER_REGEX);
  return m ? parseFloat(m[1]) : 1;
}

function _buildEpisodeLabel(filename, season) {
  var epM = filename.match(EPISODE_NAME_REGEX);
  if (epM) {
    var e = epM[1];
    var titlePart = epM[2].trim();
    var audioTag = (filename.match(SUBDUB_REGEX) || [])[1] || '';
    return 'Season ' + season + ' Ep ' + e + ' - ' + titlePart +
      (audioTag ? ' [' + audioTag + ']' : '');
  }

  var cleanName = filename.replace(QUALITY_REGEX, '').replace(/\.[^.]+$/, '').trim();
  return (season !== '1' && season) ? 'Season ' + season + ' - ' + cleanName : cleanName;
}

function _fetchSeasonEpisodes(slug, season, candidates) {
  var selectedRes = candidates[0];

  function tryRes(index) {
    if (index >= candidates.length) return Promise.resolve([]);
    var res = candidates[index];
    selectedRes = res;
    var epPageUrl = BASE + '/episodes/' + slug + '/' + season + '/' + res;

    return _get(epPageUrl).then(function (html) {
      if (!html) return tryRes(index + 1);

      if (html.trim().charAt(0) === '[') {
        var items = null;
        try { items = JSON.parse(html); } catch (e) { items = null; }
        if (Array.isArray(items) && items.length) {
          var out = [];
          for (var i = 0; i < items.length; i++) {
            var item = items[i] || {};
            var episodeHref = _episodeUrl(item.href);
            if (!episodeHref) continue;
            var filename = decodeURIComponent(episodeHref.split('?')[0].split('/').pop());
            var number = Number(item.num) > 0 ? Number(item.num) : _parseEpisodeNumber(filename);
            _cacheEmbeddedDdl(episodeHref, item.ddl);
            out.push({
              id: season + ':' + number,
              number: number,
              title: item.label || _buildEpisodeLabel(filename, season),
              url: episodeHref,
              season: season
            });
          }
          if (out.length) {
            out.sort(function (a, b) { return (b.number || 0) - (a.number || 0); });
            return out;
          }
        }
      }

      var links = _extractDownloadLinks(html).map(function (href) {
        return _episodeUrl(href);
      }).filter(function (href) { return !!href; });
      if (links.length) {
        var eps = links.map(function (href) {
          var filename = decodeURIComponent(href.split('?')[0].split('/').pop());
          var number = _parseEpisodeNumber(filename);
          return {
            id: season + ':' + number,
            number: number,
            title: _buildEpisodeLabel(filename, season),
            url: href,
            season: season
          };
        });
        eps.sort(function (a, b) { return (b.number || 0) - (a.number || 0); });
        return eps;
      }

      var filenames = _extractFilenames(html);
      if (filenames.length) {
        var made = filenames.map(function (fn) {
          var encoded = encodeURIComponent(fn);
          return {
            id: season + ':' + _parseEpisodeNumber(fn),
            number: _parseEpisodeNumber(fn),
            title: _buildEpisodeLabel(fn, season),
            url: '/download/' + slug + '/' + season + '/' + selectedRes + '/' + encoded,
            season: season
          };
        });
        made.sort(function (a, b) { return (b.number || 0) - (a.number || 0); });
        return made;
      }

      return tryRes(index + 1);
    });
  }

  return tryRes(0);
}

function _fetchEpisodes(animeUrl) {
  var clean = String(animeUrl || '').split('?')[0].replace(/\/+$/, '');
  var slug = clean.split('/').pop();

  return _get(_absUrl(animeUrl)).then(function (html) {
    var seasons = _parseSeasons(html);
    seasons.sort(function (a, b) {
      return (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0);
    });

    var candidates = _qualityCandidates(PREFERRED_QUALITY);
    var tasks = [];
    for (var i = 0; i < seasons.length; i++) {
      tasks.push(_fetchSeasonEpisodes(slug, seasons[i], candidates));
    }

    return Promise.all(tasks).then(function (results) {
      var all = [];
      for (var r = 0; r < results.length; r++) {
        for (var e = 0; e < results[r].length; e++) all.push(results[r][e]);
      }
      all.sort(function (a, b) {
        var sa = parseInt(a.season, 10) || 0;
        var sb = parseInt(b.season, 10) || 0;
        if (sb !== sa) return sb - sa;
        return (b.number || 0) - (a.number || 0);
      });
      return all;
    });
  });
}

function getDetail(url, opts) {
  return _get(_absUrl(url)).then(function (html) {
    var detail = _parseDetail(html, String(url));
    return _fetchEpisodes(url).then(function (eps) {
      detail.episodes = eps;
      detail.subCount = eps.length;
      return detail;
    }).catch(function () {
      return detail;
    });
  }).catch(function () {
    return {
      id: String(url),
      title: String(url),
      url: String(url),
      cover: null,
      description: '',
      status: 'unknown',
      genres: [],
      studios: [],
      type: 'anime',
      sourceId: SOURCE_ID,
      episodes: [],
      year: null,
      malId: null,
      subCount: 0,
      dubCount: 0
    };
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) {
    return d.episodes;
  });
}

// ── Video extraction ─────────────────────────────────────────────────────────

function _findDownloadLinkForEpisode(html, encodedFilename, num) {
  var links = _extractDownloadLinks(html);
  for (var i = 0; i < links.length; i++) {
    var href = links[i];
    var decoded = decodeURIComponent(href);
    var linkEp = (decoded.match(EPISODE_NUMBER_REGEX) || [])[1];

    if (num != null && linkEp != null && parseInt(linkEp, 10) === num) return href;
    if (num == null && decoded.indexOf(decodeURIComponent(encodedFilename)) > -1) return href;
  }
  return null;
}

function _resolveRedirect(path) {
  if (!path) return Promise.resolve(null);
  var url = _absUrl(path);
  var isMedia = /\.(?:m3u8|mpd|mkv|mp4|webm|avi|torrent|vtt|srt)(?:[?#]|$)/i.test(url);

  // Use HEAD so resolving a direct-download URL cannot buffer an entire MKV/MP4
  // in Zangetsu's fetch bridge just to discover its redirect destination.
  return _fetchWithFallback(url, BASE + '/', null, 'HEAD').then(function (response) {
    var finalUrl = response && response.url ? response.url : url;
    var status = Number(response && response.status) || 0;
    if (finalUrl !== url || !status || status < 400 || isMedia) return finalUrl;
    // Small HTML embed/watch pages may reject HEAD; GET is safe for those pages.
    return _fetchWithFallback(url, BASE + '/', null, 'GET').then(function (fallback) {
      return fallback && fallback.url ? fallback.url : url;
    }).catch(function () { return url; });
  }).catch(function () {
    return url;
  });
}

function _resolveRedirects(iframeSrc, ddl) {
  var jobs = [];

  function add(key, path) {
    if (!path) return;
    jobs.push(_resolveRedirect(path).then(function (finalUrl) {
      return { key: key, url: finalUrl };
    }));
  }

  add('iframe', iframeSrc);
  if (ddl) {
    add('watch', ddl.watch_link);
    add('stream', ddl.stream_link);
    add('download', ddl.download_link);
    add('torrent', ddl.torrent_link);
  }

  return Promise.all(jobs).then(function (results) {
    var map = {};
    for (var i = 0; i < results.length; i++) map[results[i].key] = results[i].url;
    return map;
  });
}

function _parseSubtitles(subs) {
  if (!Array.isArray(subs)) return [];
  var out = [];
  for (var i = 0; i < subs.length; i++) {
    var s = subs[i];
    if (!s) continue;
    var u = s.url || s.file || s.src || s.link;
    if (!u) continue;
    var lang = s.language || s.lang || s.label || 'Sub';
    out.push({
      url: _absUrl(u),
      lang: lang,
      label: lang,
      format: /\.srt(\?|$)/i.test(u) ? 'srt' : 'vtt',
      'default': !!s['default']
    });
  }
  return out;
}

function _extractDdl(dlPath, resString, baseFilename, slug, season) {
  var encodedFilename = dlPath.split('?')[0].split('/').pop();
  var filename = decodeURIComponent(encodedFilename);
  var downloadPageUrl = _absUrl(dlPath);

  return _get(downloadPageUrl).then(function (pageHtml) {
    if (!pageHtml || pageHtml.indexOf('anime-video-player') === -1) {
      var encodedRes = encodeURIComponent(resString);
      return _get(BASE + '/episodes/' + slug + '/' + season + '/' + encodedRes).then(function (epHtml) {
        var fresh = _findDownloadLinkForEpisode(epHtml, encodedFilename, null);
        if (fresh) {
          downloadPageUrl = _absUrl(fresh);
          return _get(downloadPageUrl);
        }
        return pageHtml;
      });
    }
    return pageHtml;
  }).then(function (pageHtml) {
    var iframeTag = pageHtml.match(/<iframe[^>]*(?:id="anime-video-player"|src="[^"]*\/r\/[^"]*")[^>]*>/i);
    var iframeSrc = null;
    if (iframeTag) {
      var sm = iframeTag[0].match(/src="([^"]+)"/i);
      if (sm) iframeSrc = sm[1];
    }

    var tokenM = pageHtml.match(TOKEN_REGEX);
    var ddlToken = tokenM ? tokenM[1] : null;

    var ddlPromise = Promise.resolve(null);
    if (ddlToken) {
      ddlPromise = _getJson(BASE + '/get_ddl/' + encodedFilename, downloadPageUrl, {
        'Accept': 'application/json',
        'X-Ddl-Token': ddlToken
      });
    }

    return ddlPromise.then(function (ddl) {
      return _resolveRedirects(iframeSrc, ddl).then(function (resolved) {
        return {
          ddl: ddl,
          iframeSrc: iframeSrc,
          downloadPageUrl: downloadPageUrl,
          filename: filename,
          resolved: resolved
        };
      });
    });
  });
}

function _buildStreams(info, resString, baseFilename, slug, season) {
  var ddl = info.ddl || {};
  var resolved = info.resolved || {};

  var resLabel = (info.filename.match(RES_LABEL_REGEX) || [])[1] ||
    _resLabelFromResolution(resString);
  var audioTag = (info.filename.match(AUDIO_TAG_REGEX) || [])[1] ||
    (baseFilename.match(AUDIO_TAG_REGEX) || [])[1] || '';
  var audioSuffix = audioTag ? ' [' + audioTag + ']' : '';
  var videoHeaders = { 'Referer': BASE + '/' };

  var effectiveWatch = resolved.iframe || resolved.watch || null;
  var streamUrl = resolved.stream || null;
  // Do not use downloadPageUrl here: /download/.../*.mkv is an HTML page,
  // not the media file. Only a DDL-provided direct link is a stream candidate.
  var directDlUrl = resolved.download || null;
  var torrentUrl = resolved.torrent || null;
  var subtitles = _parseSubtitles(ddl.subtitles);
  var kind = /^Sub$/i.test(audioTag) ? 'sub' :
    (/^(?:Dub|English Dub)$/i.test(audioTag) ? 'dub' : 'unknown');
  var audioLang = kind === 'sub' ? 'ja' : (kind === 'dub' ? 'en' : null);
  var out = [];

  function containerFor(url) {
    if (/\.m3u8(?:[?#]|$)/i.test(url)) return 'hls';
    if (/\.torrent(?:[?#]|$)/i.test(url)) return 'torrent';
    if (/\.(?:mp4|mkv|webm|avi)(?:[?#]|$)/i.test(url)) return 'mp4';
    return 'unknown';
  }

  function add(hoster, url) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    var video = {
      url: url,
      quality: 'AV1 · ' + resLabel + audioSuffix + ' (' + hoster + ')',
      label: hoster,
      container: containerFor(url),
      headers: videoHeaders,
      kind: kind,
      subtitles: subtitles
    };
    if (audioLang) video.audioLang = audioLang;
    out.push(video);
  }

  add('Stream', streamUrl || directDlUrl);
  add('Direct DL', directDlUrl);

  if (effectiveWatch && effectiveWatch.indexOf('/watch/') > -1) {
    add('Dash', effectiveWatch.replace('/watch/', '/dash/') + '/manifest.mpd');
  } else if (streamUrl) {
    add('Dash', streamUrl);
  }

  if (SHOW_TORRENT && torrentUrl) add('Torrent', torrentUrl);
  return out;
}

function _fallbackDirect(episodeUrl) {
  var fullUrl = _absUrl(episodeUrl);
  var filename = decodeURIComponent(String(episodeUrl).split('?')[0].split('/').pop());
  var resLabel = (filename.match(RES_LABEL_REGEX) || [])[1] || _resLabelFromResolution(PREFERRED_QUALITY);
  var audioTag = (filename.match(AUDIO_TAG_REGEX) || [])[1] || '';

  return [{
    url: fullUrl,
    quality: 'AV1 · ' + resLabel + (audioTag ? ' [' + audioTag + ']' : ''),
    container: /\.m3u8(\?|$)/i.test(fullUrl) ? 'hls' : 'mp4',
    headers: { 'Referer': BASE + '/' },
    preferred: true
  }];
}

function _resolutionRank(q) {
  var m = String(q || '').match(/(\d{3,4})/);
  return m ? parseInt(m[1], 10) : 0;
}

function _videoGroupForResolution(episodeUrl, slug, season, originalRes, filename, epNum, resString) {
  if (resString === originalRes) {
    return _extractDdl(episodeUrl, resString, filename, slug, season).then(function (info) {
      return _buildStreams(info, resString, filename, slug, season);
    }).catch(function () {
      return [];
    });
  }

  var encodedRes = encodeURIComponent(resString);
  return _get(BASE + '/episodes/' + slug + '/' + season + '/' + encodedRes).then(function (html) {
    var link = _findDownloadLinkForEpisode(html, filename, epNum);
    if (!link) return [];
    return _extractDdl(link, resString, filename, slug, season).then(function (info) {
      return _buildStreams(info, resString, filename, slug, season);
    });
  }).catch(function () {
    return [];
  });
}

function _finalizeStreams(groups) {
  var videos = [];
  var seen = {};
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g] || [];
    for (var v = 0; v < group.length; v++) {
      var video = group[v];
      if (!video || !video.url || seen[video.url]) continue;
      seen[video.url] = 1;
      videos.push(video);
    }
  }
  videos.sort(function (a, b) {
    return _resolutionRank(b.quality) - _resolutionRank(a.quality);
  });
  for (var i = 0; i < videos.length; i++) videos[i].preferred = i === 0;
  return videos;
}

function _isDirectMediaUrl(url) {
  return /^(?:https?:\/\/|magnet:)/i.test(String(url || '')) &&
    /\.(?:m3u8|mpd|mkv|mp4|webm|avi|torrent)(?:[?#]|$)/i.test(String(url || ''));
}

function getVideoSources(episodeUrl, fast) {
  var originalUrl = String(episodeUrl || '');
  if (!originalUrl) return Promise.resolve([]);

  var url = _episodeUrl(originalUrl) || _normalizePath(originalUrl) || originalUrl;
  var parts = String(url).split('?')[0].replace(/^\/+/, '').split('/');
  if (parts[0] !== 'download' || parts.length < 5) {
    return Promise.resolve(_isDirectMediaUrl(originalUrl) ? _fallbackDirect(originalUrl) : []);
  }

  var slug = parts[1];
  var season = parts[2];
  var originalRes = decodeURIComponent(parts[3]);
  var filename = decodeURIComponent(parts[parts.length - 1]);
  var epNumM = filename.match(EPISODE_S_NUMBER_REGEX);
  var epNum = epNumM ? parseInt(epNumM[1], 10) : null;

  function fromDdl(ddl) {
    return _resolveRedirects(null, ddl).then(function (resolved) {
      return _buildStreams({
        ddl: ddl,
        iframeSrc: null,
        downloadPageUrl: _absUrl(url),
        filename: filename,
        resolved: resolved
      }, originalRes, filename, slug, season);
    });
  }

  function resolveAt(resolution) {
    return _videoGroupForResolution(url, slug, season, originalRes, filename, epNum, resolution);
  }

  function runSequential(resolutions, index) {
    if (index >= resolutions.length) return Promise.resolve([]);
    return resolveAt(resolutions[index]).then(function (group) {
      if (group && group.length) return group;
      return runSequential(resolutions, index + 1);
    }).catch(function () {
      return runSequential(resolutions, index + 1);
    });
  }

  var cachedDdl = _getCachedDdl(url);
  if (cachedDdl) {
    return fromDdl(cachedDdl).then(function (group) {
      if (group && group.length) return _finalizeStreams([group]);
      // Embedded DDL can be incomplete or expired; use the normal page flow.
      return null;
    }).then(function (cachedVideos) {
      if (cachedVideos && cachedVideos.length) return cachedVideos;
      return resolveNormally();
    }).catch(function () {
      return resolveNormally();
    });
  }

  function resolveNormally() {
    var resolutions = [originalRes];
    for (var r = 0; r < ALL_RESOLUTIONS.length; r++) {
      if (ALL_RESOLUTIONS[r] !== originalRes) resolutions.push(ALL_RESOLUTIONS[r]);
    }
    if (fast === true) {
      return runSequential(resolutions, 0).then(function (group) {
        return _finalizeStreams([group || []]);
      });
    }
    var jobs = [];
    for (var i = 0; i < resolutions.length; i++) {
      jobs.push(resolveAt(resolutions[i]));
    }
    return Promise.all(jobs).then(function (groups) {
      // No fabricated fallback: return [] unless a real stream URL was extracted.
      return _finalizeStreams(groups);
    }).catch(function () {
      return [];
    });
  }

  return resolveNormally();
}

function getStreams(id, opts) {
  var fast = opts === true || !!(opts && typeof opts === 'object' && opts.fast === true);
  return getVideoSources(id, fast);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.0',
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams
  };
}
