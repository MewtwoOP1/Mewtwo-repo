// AnimeGG — direct website catalogue with progressive MP4 playback.
// Search, series and episode pages are plain HTML. Each episode tab exposes an
// embed id whose page carries the final /play/.../video.mp4 URL; the provider
// returns that URL directly, never an iframe.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animegg';
var VERSION = '1.0.1';
var SITE = 'https://www.animegg.org';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var RETRIES = 2;
var CACHE = {};

function getInfo() {
  return { name: 'AnimeGG', lang: 'en', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animegg.org',
    type: 'anime', version: VERSION };
}
function getSettings() {
  return [
    { key: 'audioMode', label: 'Audio tracks', description: 'Show both SUB and DUB when AnimeGG lists them, or filter to one track.', type: 'enum', default: 'both', options: [{ value: 'both', label: 'Sub and dub' }, { value: 'sub', label: 'Sub only' }, { value: 'dub', label: 'Dub only' }] },
    { key: 'requestTimeoutMs', label: 'Request timeout', description: 'Maximum wait for each AnimeGG catalogue or player request.', type: 'enum', default: '12000', options: [{ value: '6000', label: '6 seconds' }, { value: '12000', label: '12 seconds' }, { value: '18000', label: '18 seconds' }] }
  ];
}
function _setting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.animegg || {};
    return cfg[key] == null ? null : cfg[key];
  } catch (e) { return null; }
}
function _int(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function _config() {
  return {
    audioMode: String(_setting('audioMode') || 'both').toLowerCase(),
    timeoutMs: _int(_setting('requestTimeoutMs'), 12000, 3000, 30000)
  };
}
function _cacheGet(key) {
  var entry = CACHE[key];
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.value;
}
function _cachePut(key, value, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return value;
  CACHE[key] = { value: value, expiresAt: Date.now() + ttlMs };
  var keys = Object.keys(CACHE);
  while (keys.length > 120) delete CACHE[keys.shift()];
  return value;
}
function _readResponse(response) {
  var body = response && response.body;
  if (typeof body === 'string') return Promise.resolve(body);
  if (response && typeof response.text === 'function') {
    try { return Promise.resolve(response.text()); } catch (e) { /* fall through */ }
  }
  if (body && typeof body === 'object') return Promise.resolve(JSON.stringify(body));
  return Promise.resolve(String(body == null ? '' : body));
}
function _get(url, referer) {
  var key = 'page:' + url;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  function attempt(n) {
    return fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': referer || SITE + '/'
      },
      timeoutMs: _config().timeoutMs
    }).then(function (response) {
      return _readResponse(response).then(function (body) {
        var status = Number(response && response.status || 0);
        if (status < 200 || status >= 300) {
          var error = new Error('AnimeGG HTTP ' + status + ' for ' + url);
          error.status = status;
          throw error;
        }
        return _cachePut(key, String(body || ''), 120000);
      });
    }).catch(function (err) {
      var msg = String(err && err.message || err);
      var transient = msg.indexOf('timeout') >= 0 ||
        msg.indexOf('reset') >= 0 ||
        msg.indexOf('abort') >= 0 ||
        msg.indexOf('closed') >= 0;
      if (transient && n < RETRIES) {
        return new Promise(function (resolve) { setTimeout(resolve, 300 * (n + 1)); })
          .then(function () { return attempt(n + 1); });
      }
      throw err;
    });
  }
  return attempt(0);
}
function _decode(value) {
  return String(value == null ? '' : value)
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&#8217;/g, '’')
    .replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
}
function _text(value) {
  return _decode(String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function _absolute(value) {
  var text = _decode(String(value || '').trim());
  if (!text) return '';
  if (text.indexOf('//') === 0) return 'https:' + text;
  if (text.charAt(0) === '/') return SITE + text;
  if (/^https:\/\//i.test(text)) return text;
  return '';
}
function _slug(value) {
  var text = String(value || '');
  var match = text.match(/\/series\/([^/?#]+)/i) || text.match(/^([a-z0-9-]+)$/i);
  return match ? match[1] : '';
}
function _seriesUrl(slug) { return SITE + '/series/' + encodeURIComponent(slug); }
function _result(slug, title, cover, episodes, status) {
  if (!slug || !title) return null;
  return {
    id: slug, url: slug, title: title, name: title,
    cover: _absolute(cover) || null, poster: _absolute(cover) || null,
    type: 'anime', sourceId: SOURCE_ID,
    episodesCount: episodes || null,
    status: status ? String(status).toLowerCase() : 'unknown'
  };
}
function _searchRows(html) {
  var out = [], seen = {};
  var re = /<a href="\/series\/([^"/]+)" class="mse">([\s\S]*?)<\/a>/gi;
  var match;
  while ((match = re.exec(String(html || ''))) !== null) {
    var slug = match[1];
    var block = match[2];
    if (seen[slug]) continue;
    var title = (block.match(/<h2>([\s\S]*?)<\/h2>/i) || [])[1] || '';
    var cover = (block.match(/<img[^>]+src="([^"]+)"/i) || [])[1] || '';
    var episodes = (block.match(/Episodes:\s*(\d+)/i) || [])[1] || '';
    var status = (block.match(/Status\s*:\s*([^<]+)/i) || [])[1] || '';
    var item = _result(slug, _text(title), cover, Number(episodes) || null, _text(status));
    if (item) { seen[slug] = 1; out.push(item); }
  }
  return out;
}
function _popularRows(html) {
  var out = [], seen = {};
  var re = /<li class="fea">([\s\S]*?)<\/li>/gi;
  var match;
  while ((match = re.exec(String(html || ''))) !== null) {
    var block = match[1];
    var slug = (block.match(/href="\/series\/([^"]+)"/i) || [])[1] || '';
    if (!slug || seen[slug]) continue;
    var title = (block.match(/<div class="rightpop"><a href="\/series\/[^"]+">([^<]+)<\/a>/i) || [])[1] || '';
    var cover = (block.match(/<img[^>]+src="([^"]+)"/i) || [])[1] || '';
    var episodes = (block.match(/(\d+)\s+Episodes/i) || [])[1] || '';
    var status = (block.match(/disabled">([^<]+)<\/a>/i) || [])[1] || '';
    var item = _result(slug, _text(title), cover, Number(episodes) || null, _text(status));
    if (item) { seen[slug] = 1; out.push(item); }
  }
  return out;
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, _int(page, 1, 1, 100));
  return _get(SITE + '/search/?q=' + encodeURIComponent(q) + (p > 1 ? '&page=' + p : ''), SITE + '/')
    .then(_searchRows).catch(function () { return []; });
}
function popular(opts) {
  return _get(SITE + '/popular-series', SITE + '/').then(_popularRows).catch(function () { return []; });
}
function getHome(opts) {
  return popular(opts).then(function (items) {
    return items.length ? [{ title: 'Popular Anime', items: items.slice(0, 30) }] : [];
  });
}
function _episodes(html, slug) {
  var out = [], seen = {};
  var re = /<li>\s*<div><a href="\/([^"]+?-episode-(\d+))" class="anm_det_pop"><strong>([\s\S]*?)<\/strong><\/a>([\s\S]*?)<\/li>/gi;
  var match;
  while ((match = re.exec(String(html || ''))) !== null) {
    var number = Number(match[2]);
    if (!(number > 0) || seen[number]) continue;
    seen[number] = 1;
    var episodeTitle = _text((match[4].match(/<i class="anititle">([\s\S]*?)<\/i>/i) || [])[1]);
    var seriesTitle = _text(match[3]);
    var title = episodeTitle || seriesTitle || ('Episode ' + number);
    if (new RegExp('^episode\\s*' + number + '$', 'i').test(title)) title = '';
    var hasDub = /#dubbed|btn-dubbed/i.test(match[4]);
    out.push({ number: number, title: title, dub: hasDub });
  }
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}
function _episodeUrl(slug, number, category) {
  return 'animegg://episode/' + [encodeURIComponent(slug), number, category].join('/');
}
function _episode(slug, number, title, category) {
  var url = _episodeUrl(slug, number, category);
  return {
    id: url, url: url, number: number,
    title: title && !/^episode\s/i.test(title) ? 'Episode ' + number + ': ' + title : (title || 'Episode ' + number),
    category: category, sourceId: SOURCE_ID, type: 'anime'
  };
}
function _episodeItems(slug, rows) {
  var cfg = _config();
  var anyDub = rows.some(function (row) { return row.dub; });
  var wantSub = cfg.audioMode !== 'dub';
  var wantDub = cfg.audioMode !== 'sub' && anyDub;
  if (cfg.audioMode === 'sub' && !wantSub) wantDub = anyDub;
  if (cfg.audioMode === 'dub' && !wantDub) wantSub = true;
  var out = [];
  rows.forEach(function (row) {
    if (wantSub) out.push(_episode(slug, row.number, row.title, 'sub'));
    if (wantDub && row.dub) out.push(_episode(slug, row.number, row.title, 'dub'));
  });
  return out;
}
function getDetail(url, opts) {
  var slug = _slug(url);
  if (!slug) return Promise.reject(new Error('AnimeGG: missing series slug'));
  return _get(_seriesUrl(slug), SITE + '/').then(function (html) {
    var title = _text((html.match(/<div class="first">\s*<h1>([\s\S]*?)<\/h1>/i) || [])[1]) || slug;
    var cover = (html.match(/<img[^>]+src="([^"]+)"[^>]*class="media-object"/i) || [])[1] ||
      (html.match(/<img[^>]+class="media-object"[^>]+src="([^"]+)"/i) || [])[1] || '';
    var description = _text((html.match(/<p class="ptext">([\s\S]*?)<\/p>/i) || [])[1]);
    var alt = _text((html.match(/Alternate Titles:\s*([\s\S]*?)<\/span>/i) || [])[1]);
    var status = _text((html.match(/Status\s*:\s*([^<]+)/i) || [])[1]) || 'unknown';
    var genres = [], seenGenres = {};
    var gre = /href="\/genre\/([^"]+)"[^>]*>([^<]+)<\/a>/gi;
    var gm;
    while ((gm = gre.exec(html)) !== null) {
      var name = _text(gm[2]);
      if (name && !seenGenres[name]) { seenGenres[name] = 1; genres.push(name); }
    }
    var rows = _episodes(html, slug);
    if (!rows.length) throw new Error('AnimeGG returned no episodes for this title');
    var episodes = _episodeItems(slug, rows);
    var item = _result(slug, title, cover, rows.length, status) ||
      { id: slug, url: slug, title: title, type: 'anime', sourceId: SOURCE_ID };
    item.id = slug; item.url = slug;
    item.cover = _absolute(cover) || null;
    item.poster = item.cover;
    item.description = description;
    item.altTitles = alt ? alt.split(/\s*;\s*/).filter(Boolean) : [];
    item.genres = genres;
    item.status = status.toLowerCase();
    item.episodes = episodes;
    item.subCount = episodes.filter(function (x) { return x.category === 'sub'; }).length;
    item.dubCount = episodes.filter(function (x) { return x.category === 'dub'; }).length;
    item.episodeCount = episodes.length;
    return item;
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) { return detail.episodes || []; });
}
function _parseEpisode(value) {
  var match = String(value || '').match(/^animegg:\/\/episode\/([^/]+)\/(\d+)\/(sub|dub)$/i);
  if (!match) throw new Error('AnimeGG: invalid episode URL');
  var slug;
  try { slug = decodeURIComponent(match[1]); } catch (e) { slug = match[1]; }
  return { slug: slug, number: Number(match[2]), category: match[3].toLowerCase() };
}
function _embedId(html, category) {
  var wanted = category === 'dub' ? 'dubbed' : 'subbed';
  var re = /<a\b[^>]*\bdata-id=['"](\d+)['"][^>]*\bdata-version=["'](subbed|dubbed)["'][^>]*>/gi;
  var match;
  while ((match = re.exec(String(html || ''))) !== null) {
    if (match[2].toLowerCase() === wanted) return match[1];
  }
  // Some episode pages omit data-version on the only tab.
  var fallback = String(html || '').match(/<a\b[^>]*\bdata-id=['"](\d+)['"][^>]*>/i);
  return fallback && category === 'sub' ? fallback[1] : '';
}
function _ogVideo(html) {
  var text = String(html || '');
  var match = text.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i) ||
    text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video["']/i);
  var value = match ? _decode(match[1]) : '';
  return /^https:\/\//i.test(value) ? value : _absolute(value);
}
function getVideoSources(episodeUrl, opts) {
  var episode;
  try { episode = _parseEpisode(episodeUrl); }
  catch (e) { return Promise.resolve([]); }
  var pageUrl = SITE + '/' + episode.slug + '-episode-' + episode.number;
  return _get(pageUrl, _seriesUrl(episode.slug)).then(function (html) {
    var id = _embedId(html, episode.category);
    if (!id) throw new Error('AnimeGG episode has no ' + episode.category + ' player');
    var embedUrl = SITE + '/embed/' + encodeURIComponent(id);
    return _get(embedUrl, pageUrl).then(function (embed) {
      var media = _ogVideo(embed);
      if (!media) throw new Error('AnimeGG embed did not expose a playable MP4');
      return [{
        url: media,
        quality: 'Auto',
        label: 'AnimeGG',
        type: 'mp4',
        container: 'mp4',
        headers: { 'User-Agent': UA, 'Referer': SITE + '/' },
        kind: episode.category,
        audio: episode.category,
        audioLang: episode.category === 'dub' ? 'en' : 'ja',
        subtitles: [],
        isActive: true
      }];
    });
  }).catch(function (error) {
    console.warn('AnimeGG playback failed:', String(error && error.message || error));
    return [];
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _config: _config, _slug: _slug, _searchRows: _searchRows, _popularRows: _popularRows,
    _episodes: _episodes, _episodeItems: _episodeItems, _parseEpisode: _parseEpisode,
    _embedId: _embedId, _ogVideo: _ogVideo, _absolute: _absolute
  };
}
