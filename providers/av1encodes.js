// AV1Encodes — anime source for the Zangetsu provider repo.
// Ported from the Aniyomi extension AV1Encodes.kt (SOUMYAR10/anime-extensions).
//
// The source is a DDL index: each episode page exposes a /get_ddl/ endpoint
// returning stream_link, download_link and watch_link. The original extension
// also builds a DASH manifest from watch_link; Zangetsu's stream contract has
// no DASH container, so this port returns only the direct stream/download
// links and drops the DASH URL.
//
// Known external limitations:
//   - The site may sit behind Cloudflare or an access-protection rule; a 403
//     cannot be solved inside a Zangetsu provider.
//   - AV1 and MKV playback depends on the Zangetsu player and the device.
//   - The /get_ddl/ token and page markup can change without notice.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID)
  : 'av1encodes';

var DEFAULT_DOMAIN = 'https://av1encodes.com';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
         '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getInfo() {
  var base = _domain();
  return {
    name: 'AV1Encodes',
    lang: 'en',
    baseUrl: base,
    logo: base + '/favicon.ico',
    type: 'anime',
    version: '1.0.0'
  };
}

function getSettings() {
  return [
    {
      key: 'domain',
      label: 'Domain',
      description: 'Base URL for AV1Encodes. Change if the site moves domains.',
      type: 'text',
      default: DEFAULT_DOMAIN
    },
    {
      key: 'quality',
      label: 'Preferred quality',
      description: 'Quality used when constructing episode URLs.',
      type: 'enum',
      default: '1080p',
      options: [
        { value: '1080p', label: '1080p' },
        { value: '720p', label: '720p' },
        { value: '480p', label: '480p' }
      ]
    }
  ];
}

function _readSetting(key) {
  try {
    var settings = (typeof __settings !== 'undefined' && __settings)
      ? __settings[SOURCE_ID]
      : null;
    return settings && settings[key] != null ? settings[key] : null;
  } catch (e) {
    return null;
  }
}

function _domain() {
  var d = _readSetting('domain');
  if (!d) return DEFAULT_DOMAIN;
  d = String(d).replace(/\/+$/, '');
  return /^https?:\/\//i.test(d) ? d : DEFAULT_DOMAIN;
}

function _quality() {
  var q = String(_readSetting('quality') || '1080p').toLowerCase();
  return (q === '720p' || q === '480p') ? q : '1080p';
}

function _headers(ref) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': ref || _domain() + '/'
  };
}

function _get(url, ref) {
  return fetch(url, { headers: _headers(ref) }).then(function (r) {
    if (!r.ok) throw new Error('AV1Encodes HTTP ' + r.status + ' for ' + url);
    return r.body || '';
  });
}

function _text(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function _attr(html, re) {
  var m = String(html || '').match(re);
  return m ? m[1] : null;
}

// ── Search ────────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  var p = page && page > 0 ? page : 1;
  var base = _domain();
  var url;
  if (q) {
    url = base + '/search?q=' + encodeURIComponent(q) + '&page=' + p;
  } else {
    url = base + '/anime?page=' + p;
  }
  return _get(url, base + '/').then(function (html) {
    return _parseCards(html, base);
  }).catch(function () {
    return [];
  });
}

function _parseCards(html, base) {
  var out = [];
  var seen = {};
  // Article-card layout (latest, /search, /airing).
  var reArticle = /<article[^>]*class="[^"]*(?:anime-card|card|anime)[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  var m;
  while ((m = reArticle.exec(html)) !== null) {
    var block = m[1];
    var a = _attr(block, /<a[^>]+href="([^"]*\/anime\/[^"]+)"[^>]*>/i);
    if (!a || a === '/anime/') continue;
    var href = _absolute(a, base);
    if (seen[href]) continue;
    var title = _text(_attr(block, /<h[34][^>]*>([\s\S]*?)<\/h[34]>/i) || '');
    if (!title) title = _text(_attr(block, /<a[^>]*>([\s\S]*?)<\/a>/i) || '');
    if (!title) continue;
    var img = _attr(block, /<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/i);
    seen[href] = 1;
    out.push({
      id: href,
      title: title,
      englishTitle: title,
      url: href,
      cover: img ? _absolute(img, base) : null,
      type: 'anime',
      sourceId: SOURCE_ID
    });
  }

  // Plain list layout (/anime).
  if (!out.length) {
    var reLi = /<li[^>]*>\s*<a[^>]+href="([^"]*\/anime\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = reLi.exec(html)) !== null) {
      var href2 = _absolute(m[1], base);
      if (seen[href2]) continue;
      var title2 = _text(m[2]);
      if (!title2) continue;
      seen[href2] = 1;
      out.push({
        id: href2,
        title: title2,
        englishTitle: title2,
        url: href2,
        cover: null,
        type: 'anime',
        sourceId: SOURCE_ID
      });
    }
  }

  return out;
}

function _absolute(url, base) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return base + (url.charAt(0) === '/' ? '' : '/') + url;
}

// ── Detail + episodes ─────────────────────────────────────────────────────
function getDetail(url, opts) {
  var base = _domain();
  var full = _absolute(url, base);
  return _get(full, base + '/').then(function (html) {
    var title = _text(_attr(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || '');
    var cover = _attr(html, /<img[^>]+(?:data-src|src)="([^"]+)"/i);
    var description = _text(
      _attr(html, /class="[^"]*(?:synopsis|description|overview)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/i) || ''
    );
    var genres = [];
    var reGenre = /<a[^>]+href="[^"]*\/genre\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    var gm;
    while ((gm = reGenre.exec(html)) !== null) {
      var g = _text(gm[1]);
      if (g && genres.indexOf(g) < 0) genres.push(g);
    }
    var status = /class="[^"]*(?:airing|ongoing)[^"]*"/i.test(html) ? 'ongoing' : 'completed';

    var slug = full.replace(/\/+$/, '').split('/').pop();
    return _fetchEpisodes(slug, base).then(function (episodes) {
      return {
        id: slug,
        title: title || slug,
        englishTitle: title || slug,
        url: full,
        cover: cover ? _absolute(cover, base) : null,
        description: description || null,
        genres: genres,
        status: status,
        type: 'anime',
        sourceId: SOURCE_ID,
        episodes: episodes,
        malId: null
      };
    });
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) {
    return d.episodes || [];
  });
}

function _fetchEpisodes(slug, base) {
  var quality = _quality();
  var encodedRes = encodeURIComponent(quality).replace(/%20/g, '%20');
  // Season discovery. The original uses season tabs; default to 1.
  return _get(base + '/anime/' + encodeURIComponent(slug), base + '/').then(function (html) {
    var seasons = [];
    var reSeason = /data-season="([^"]+)"/gi;
    var sm;
    while ((sm = reSeason.exec(html)) !== null) {
      if (seasons.indexOf(sm[1]) < 0) seasons.push(sm[1]);
    }
    if (!seasons.length) seasons.push('1');
    seasons.sort(function (a, b) {
      return (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0);
    });

    var pages = seasons.map(function (season) {
      var epUrl = base + '/episodes/' + encodeURIComponent(slug) + '/' +
                  encodeURIComponent(season) + '/' + encodedRes;
      return _get(epUrl, base + '/').then(function (epHtml) {
        return _parseEpisodePage(epHtml, base, season);
      }).catch(function () {
        return [];
      });
    });

    return Promise.all(pages).then(function (groups) {
      var all = [];
      for (var i = 0; i < groups.length; i++) {
        for (var j = 0; j < groups[i].length; j++) all.push(groups[i][j]);
      }
      return all;
    });
  }).catch(function () {
    return [];
  });
}

function _parseEpisodePage(html, base, season) {
  var out = [];
  var seen = {};
  var reLink = /<a[^>]+href="([^"]*\/download\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = reLink.exec(html)) !== null) {
    var href = _absolute(m[1], base);
    if (seen[href]) continue;
    seen[href] = 1;
    var label = _text(m[2]) || _filenameFromUrl(href);
    out.push({
      id: href,
      number: _episodeNumber(label),
      title: _episodeLabel(label, season),
      url: href
    });
  }
  if (out.length) return out;

  // Fallback: filenames in raw HTML.
  var reFile = /([A-Za-z0-9_ \-\[\]().%]+?\.(?:mkv|mp4))/gi;
  while ((m = reFile.exec(html)) !== null) {
    var fn = m[1].trim();
    if (!fn || seen[fn]) continue;
    seen[fn] = 1;
    var encoded = encodeURIComponent(fn).replace(/%20/g, '%20');
    out.push({
      id: base + '/download/' + encodeURIComponent(season) + '/' + encoded,
      number: _episodeNumber(fn),
      title: _episodeLabel(fn, season),
      url: base + '/download/' + encodeURIComponent(season) + '/' + encoded
    });
  }
  return out;
}

function _filenameFromUrl(url) {
  try {
    var clean = String(url).split('?')[0].split('/').pop();
    return decodeURIComponent(clean);
  } catch (e) {
    return String(url);
  }
}

function _episodeNumber(text) {
  var m = String(text || '').match(/E(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}

function _episodeLabel(text, season) {
  var name = String(text || '').replace(/\[\d{3,4}p\].*/i, '').replace(/\.(mkv|mp4)$/i, '').trim();
  var ep = _episodeNumber(name);
  return (season && season !== '1' ? 'S' + season + ' ' : '') + 'Ep ' + ep + ' - ' + name;
}

// ── Video sources ─────────────────────────────────────────────────────────
function getVideoSources(episodeUrl) {
  var base = _domain();
  var url = _absolute(episodeUrl, base);
  var filename = _filenameFromUrl(url);
  var encodedFilename = encodeURIComponent(filename).replace(/%20/g, '%20');

  return _get(url, base + '/').then(function (pageHtml) {
    var token = _attr(pageHtml, /['"](A{4,}[A-Za-z0-9_\-]{10,})['"]/);
    if (!token) return _fallback(url, filename);

    var ddlUrl = base + '/get_ddl/' + encodedFilename;
    return fetch(ddlUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': url,
        'X-Ddl-Token': token
      }
    }).then(function (r) {
      if (!r.ok) throw new Error('AV1Encodes get_ddl HTTP ' + r.status);
      return r.body || '';
    }).then(function (body) {
      var ddl;
      try { ddl = JSON.parse(body); } catch (e) { return _fallback(url, filename); }
      if (!ddl || !ddl.success) return _fallback(url, filename);
      return _resolveSources(ddl, filename, base);
    }).catch(function () {
      return _fallback(url, filename);
    });
  }).catch(function () {
    return _fallback(url, filename);
  });
}

function _resolveSources(ddl, filename, base) {
  var quality = _qualityFromFilename(filename);
  var audio = _audioFromFilename(filename);
  var label = 'AV1 · ' + quality + (audio ? ' [' + audio + ']' : '');
  var streams = [];

  var links = [
    { link: ddl.stream_link, suffix: 'Stream' },
    { link: ddl.download_link, suffix: 'Direct DL' }
  ];

  var tasks = links.map(function (item) {
    return _resolveRedirect(item.link, base).then(function (finalUrl) {
      if (!finalUrl) return null;
      return {
        url: finalUrl,
        quality: label + ' · ' + item.suffix,
        container: _container(finalUrl),
        headers: { 'User-Agent': UA, 'Referer': base + '/' },
        kind: audio && /dub/i.test(audio) ? 'dub' : 'sub',
        audioLang: audio && /dub/i.test(audio) ? 'en' : 'ja',
        subtitles: []
      };
    }).catch(function () { return null; });
  });

  return Promise.all(tasks).then(function (rows) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i]) streams.push(rows[i]);
    }
    if (!streams.length) return _fallback(base + '/download/' + encodeURIComponent(filename), filename);
    return streams;
  });
}

function _resolveRedirect(path, base) {
  if (!path) return Promise.resolve(null);
  var url = /^https?:\/\//i.test(path) ? path : (base + (path.charAt(0) === '/' ? '' : '/') + path);
  return fetch(url, {
    headers: { 'User-Agent': UA, 'Referer': base + '/' }
  }).then(function (r) {
    if (!r.ok) return null;
    return r.url || url;
  }).catch(function () { return null; });
}

function _fallback(url, filename) {
  var quality = _qualityFromFilename(filename);
  return [{
    url: url,
    quality: 'AV1 · ' + quality + ' · Direct DL',
    container: _container(url),
    headers: { 'User-Agent': UA, 'Referer': _domain() + '/' },
    kind: 'sub',
    audioLang: 'ja',
    subtitles: []
  }];
}

function _qualityFromFilename(filename) {
  var m = String(filename || '').match(/\[(\d+p)\]/i);
  return m ? m[1] : _quality();
}

function _audioFromFilename(filename) {
  var m = String(filename || '').match(/\[(Dual|Sub|Dub|English Dub)\]/i);
  return m ? m[1] : '';
}

function _container(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
  if (/\.mkv(\?|$)/i.test(url)) return 'mkv';
  return 'mp4';
}

// ── Home (popular + latest) ───────────────────────────────────────────────
function getHome(opts) {
  var base = _domain();
  var popular = _get(base + '/stats', base + '/').then(function (html) {
    return { title: 'Popular', items: _parseCards(html, base) };
  }).catch(function () { return { title: 'Popular', items: [] }; });

  var latest = _get(base + '/', base + '/').then(function (html) {
    return { title: 'Latest', items: _parseCards(html, base) };
  }).catch(function () { return { title: 'Latest', items: [] }; });

  return Promise.all([popular, latest]).then(function (rows) {
    return rows.filter(function (r) { return r.items.length; });
  });
}