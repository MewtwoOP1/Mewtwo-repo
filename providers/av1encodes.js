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
var BASE = DEFAULT_DOMAIN;

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

function _get(url, ref) {
  var options = { headers: _headers(ref) };
  return fetch(url, options).then(function (r) {
    if (r.status === 403) {
      return fetch(BASE + '/', { headers: _headers(BASE + '/') }).then(function () {
        return fetch(url, { headers: _headers(ref) });
      });
    }
    return r;
  }).then(function (r) {
    return r.body || '';
  }).catch(function () {
    return '';
  });
}

function _getJson(url, ref, extraHeaders) {
  var h = _headers(ref);
  if (extraHeaders) {
    for (var k in extraHeaders) {
      if (Object.prototype.hasOwnProperty.call(extraHeaders, k)) h[k] = extraHeaders[k];
    }
  }
  return fetch(url, { headers: h }).then(function (r) {
    var body = r.body || '';
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
  if (value.charAt(0) === '/') return value;
  if (!/^https?:\/\//i.test(value)) return value;

  var m = value.match(/^https?:\/\/([^/]+)(\/[^?#]*)?(\?[^#]*)?/i);
  if (!m) return '';
  var host = m[1].toLowerCase();
  var allowed = false;
  for (var i = 0; i < DOMAIN_HOSTS.length; i++) {
    if (host === DOMAIN_HOSTS[i] || host.indexOf('.' + DOMAIN_HOSTS[i]) > -1) {
      allowed = true;
      break;
    }
  }
  if (!allowed) return '';
  return (m[2] || '/') + (m[3] || '');
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
    add(links[i].split('/').pop().split('?')[0]);
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
        if (items && items.length) {
          var out = [];
          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var filename = decodeURIComponent(String(item.href || '').split('/').pop().split('?')[0]);
            out.push({
              id: season + ':' + (item.num || 0),
              number: item.num > 0 ? item.num : _parseEpisodeNumber(filename),
              title: item.label || _buildEpisodeLabel(filename, season),
              url: item.href,
              season: season
            });
          }
          out.sort(function (a, b) { return (b.number || 0) - (a.number || 0); });
          return out;
        }
      }

      var links = _extractDownloadLinks(html);
      if (links.length) {
        var eps = links.map(function (href) {
          var filename = decodeURIComponent(href.split('/').pop().split('?')[0]);
          return {
            id: season + ':' + _parseEpisodeNumber(filename),
            number: _parseEpisodeNumber(filename),
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
  return fetch(url, { headers: _headers(BASE + '/') }).then(function (r) {
    return r.url || url;
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
  var directDlUrl = resolved.download || null;
  var torrentUrl = resolved.torrent || null;
  if (!directDlUrl) directDlUrl = info.downloadPageUrl;

  var out = [];

  function add(hoster, url) {
    if (!url) return;
    out.push({
      url: url,
      quality: 'AV1 · ' + resLabel + audioSuffix + ' (' + hoster + ')',
      container: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4',
      headers: videoHeaders,
      hoster: hoster,
      kind: 'sub',
      audioLang: 'ja',
      subtitles: _parseSubtitles(ddl.subtitles)
    });
  }

  add('Stream', streamUrl || directDlUrl);
  add('Direct DL', directDlUrl);

  if (effectiveWatch && effectiveWatch.indexOf('/watch/') > -1) {
    add('Dash', effectiveWatch.replace('/watch/', '/dash/') + '/manifest.mpd');
  } else if (streamUrl || directDlUrl) {
    add('Dash', streamUrl || directDlUrl);
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

function getVideoSources(episodeUrl) {
  var url = String(episodeUrl || '');
  if (!url) return Promise.reject(new Error('AV1Encodes: no episode URL'));

  var parts = url.split('?')[0].replace(/^\/+/, '').split('/');
  if (parts[0] !== 'download' || parts.length < 5) {
    return Promise.resolve(_fallbackDirect(url));
  }

  var slug = parts[1];
  var season = parts[2];
  var originalRes = decodeURIComponent(parts[3]);
  var filename = decodeURIComponent(parts[parts.length - 1]);
  var epNumM = filename.match(EPISODE_S_NUMBER_REGEX);
  var epNum = epNumM ? parseInt(epNumM[1], 10) : null;

  var resolutions = [originalRes];
  for (var i = 0; i < ALL_RESOLUTIONS.length; i++) {
    if (ALL_RESOLUTIONS[i] !== originalRes) resolutions.push(ALL_RESOLUTIONS[i]);
  }

  var jobs = [];
  for (var r = 0; r < resolutions.length; r++) {
    jobs.push(_videoGroupForResolution(url, slug, season, originalRes, filename, epNum, resolutions[r]));
  }

  return Promise.all(jobs).then(function (groups) {
    var videos = [];
    var seen = {};

    for (var g = 0; g < groups.length; g++) {
      for (var v = 0; v < groups[g].length; v++) {
        var video = groups[g][v];
        if (video && !seen[video.url]) {
          seen[video.url] = 1;
          videos.push(video);
        }
      }
    }

    if (!videos.length) return _fallbackDirect(url);

    videos.sort(function (a, b) {
      return _resolutionRank(b.quality) - _resolutionRank(a.quality);
    });

    for (var k = 0; k < videos.length; k++) {
      videos[k].preferred = (k === 0);
    }
    return videos;
  });
}

function getStreams(id, opts) {
  return getVideoSources(id, opts);
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
