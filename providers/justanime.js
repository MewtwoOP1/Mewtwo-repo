// JustAnime source for Zangetsu.
// Uses JustAnime's publicly exposed JSON API for catalogue, episode and stream data.
// It does not host media, decrypt protected player payloads, or bypass access controls.

var SITE = 'https://justanime.to';
var API = 'https://core.justanime.to/api';
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'justanime';
var VERSION = '1.9.7';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

function getInfo() {
  return {
    name: 'JustAnime',
    lang: 'en',
    baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=justanime.to',
    type: 'anime',
    version: VERSION
  };
}
function getSettings() {
  return [{
    key: 'servers',
    label: 'Streaming servers',
    description: 'Which public JustAnime API server endpoints to check. Unsupported or unavailable streams are skipped.',
    type: 'enum',
    default: 'all',
    options: [
      { value: 'all', label: 'All servers (recommended)' },
      { value: 'animegg', label: 'AnimeGG' },
      { value: 'anineko', label: 'AniNeko' },
      { value: 'megaplay', label: 'MegaPlay' }
    ]
  }, {
    key: 'language',
    label: 'Preferred audio',
    description: 'Return the preferred audio language first, then fall back to the other language.',
    type: 'enum',
    default: 'sub',
    options: [
      { value: 'sub', label: 'Sub first' },
      { value: 'dub', label: 'Dub first' }
    ]
  }];
}
function _settings() {
  var s = (typeof __settings !== 'undefined' && __settings && __settings[SOURCE_ID]) || {};
  return {
    servers: /^(?:animegg|anineko|megaplay)$/.test(String(s.servers || '')) ? String(s.servers) : 'all',
    language: s.language === 'dub' ? 'dub' : 'sub'
  };
}
function _trim(s) { return String(s == null ? '' : s).replace(/^\s+|\s+$/g, ''); }
function _json(url, referer, attempt) {
  attempt = attempt || 0;
  return fetch(url, { headers: {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Origin': SITE,
    'Referer': referer || SITE + '/',
    'X-Requested-With': 'XMLHttpRequest'
  }, timeoutMs: 15000 }).then(function (r) {
    if (r && r.status && r.status >= 400) {
      var httpError = new Error('JustAnime HTTP ' + r.status);
      httpError.status = r.status;
      throw httpError;
    }
    var body = r && r.body != null ? r.body : '';
    if (typeof body !== 'string') body = JSON.stringify(body);
    return JSON.parse(body || '{}');
  }).catch(function (error) {
    var status = error && Number(error.status);
    // Only retry transient failures. A 404/other client error will not improve
    // by repeating it; 429 and 5xx responses often recover on a short retry.
    var retryable = !status || status === 408 || status === 429 || status >= 500;
    if (!retryable || attempt >= 2) throw error;
    var delay = attempt === 0 ? 300 : 900;
    return new Promise(function (resolve) {
      setTimeout(resolve, delay);
    }).then(function () {
      return _json(url, referer, attempt + 1);
    });
  });
}
function _title(item) {
  var t = item && item.title;
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') return t.english || t.romaji || t.native || '';
  return (item && (item.name || item.romaji || item.english)) || '';
}
function _cover(item) {
  return item && (item.cover ||
    (item.coverImage && (item.coverImage.extraLarge || item.coverImage.large || item.coverImage.medium)) ||
    item.poster || item.image || '') || '';
}
function _id(item) {
  var id = item && (item.id || item.anilistId || item.anilist_id);
  return id == null ? '' : String(id);
}
function _numericId(value) {
  var s = String(value == null ? '' : value);
  if (!/^\d+$/.test(s)) return null;
  var n = Number(s);
  return isFinite(n) && n > 0 ? n : null;
}
// Take the first VALID ID, not merely the first non-null field. Some API
// deployments may include an empty/zero alias alongside the canonical id.
function _firstNumericId(values) {
  for (var i = 0; i < values.length; i++) {
    var id = _numericId(values[i]);
    if (id !== null) return id;
  }
  return null;
}
var _cardCache = {};
function _card(item) {
  var id = _id(item), title = _title(item);
  if (!id || !title) return null;

  // Zangetsu Mode uses the metadata catalogue for details and title-matches
  // this provider only when resolving playback. Preserve a second title so
  // AniList's romaji/English display preference can match JustAnime results.
  var titleData = item && item.title && typeof item.title === 'object' ? item.title : {};
  var alternatives = [
    titleData.romaji, titleData.english, titleData.native,
    item && item.romaji, item && item.english, item && item.englishTitle
  ];
  var englishTitle = null;
  for (var i = 0; i < alternatives.length; i++) {
    var candidate = _trim(alternatives[i]);
    if (candidate && candidate !== title) { englishTitle = candidate; break; }
  }

  var card = {
    id: id, title: title, englishTitle: englishTitle,
    url: id, cover: _cover(item) || null,
    type: 'anime', sourceId: SOURCE_ID,
    malId: _firstNumericId([item.idMal, item.malId, item.mal_id]),
    // JustAnime's catalogue uses the AniList Media schema: item.id is the
    // canonical AniList ID, while item.idMal is the separate MAL ID.
    // Keep explicit AniList aliases first, then use that documented canonical ID.
    // The same numeric value is also the source endpoint ID for this provider.
    anilistId: _firstNumericId([item.anilistId, item.anilist_id, item.idAnilist, item.id])
  };
  // Keep the last good search/home card available to detail resolution. The
  // episode API can succeed while the detail API temporarily fails; don't
  // replace a real catalogue title/cover/tracker IDs with "Anime <id>".
  _cardCache[id] = card;
  return card;
}
function _listPayload(data) {
  var value = data;
  // API deployments have returned arrays directly and wrapped them in data/results.
  for (var i = 0; i < 4 && value && !Array.isArray(value); i++) {
    if (Array.isArray(value.results)) value = value.results;
    else if (Array.isArray(value.items)) value = value.items;
    else if (Array.isArray(value.data)) value = value.data;
    else if (value.data && typeof value.data === 'object') value = value.data;
    else break;
  }
  return Array.isArray(value) ? value : [];
}
function _cards(items) {
  var out = [], seen = {};
  _listPayload(items).forEach(function (item) {
    var card = _card(item);
    if (card && !seen[card.id]) { seen[card.id] = true; out.push(card); }
  });
  return out;
}
function getHome(opts) {
  return Promise.all([
    _json(API + '/home').then(function (data) {
      var items = data.latestEpisode || data.airing || [];
      return { title: 'Recently Updated', items: _cards(items) };
    }).catch(function () { return { title: 'Recently Updated', items: [] }; }),
    _json(API + '/search?page=1').then(function (data) {
      return { title: 'Popular Anime', items: _cards(data) };
    }).catch(function () { return { title: 'Popular Anime', items: [] }; })
  ]).then(function (rows) {
    return rows.filter(function (row) { return row.items.length > 0; });
  });
}
function popular(opts) {
  return _json(API + '/search?page=' + Math.max(1, parseInt((opts && opts.page) || 1, 10)))
    .then(function (data) { return _cards(data); })
    .catch(function () { return []; });
}
function search(query, page, opts) {
  var q = _trim(query).replace(/[?!]/g, '');
  if (!q) return Promise.resolve([]);
  return _json(API + '/search?query=' + encodeURIComponent(q) + '&page=' +
    Math.max(1, parseInt(page || 1, 10))).then(function (data) {
      return _cards(data);
    }).catch(function () { return []; });
}
function _extractId(value) {
  var s = String(value == null ? '' : value);
  var m = s.match(/justanime\.to\/anime\/(\d+)/i);
  if (m) return m[1];
  m = s.match(/(?:^|\/)anime\/(\d+)(?:\/|$)/i);
  if (m) return m[1];
  m = s.match(/^(\d+)(?:\|\||$)/);
  if (m) return m[1];
  return s.replace(/^justanime:\/\//, '').split('||')[0].replace(/^\/+|\/+$/g, '');
}
function _episodeCount(anime) {
  var value = anime && anime.episodes;
  if (Array.isArray(value)) return value.length;
  var n = parseInt(value, 10);
  return isFinite(n) && n > 0 ? Math.min(n, 1000) : 0;
}
function _stripHtml(value) {
  var text = String(value || '');
  // Use the host-provided HTML text helper when present, matching other
  // providers; keep the self-contained fallback for runtimes without it.
  if (typeof htmlText === 'function') return htmlText(text);
  return text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}
function _episodeRows(response, animeId) {
  var root = response;
  for (var depth = 0; depth < 4 && root && !Array.isArray(root); depth++) {
    if (Array.isArray(root.episodes) || Array.isArray(root.results) || Array.isArray(root.items)) break;
    if (root.data && typeof root.data === 'object') root = root.data;
    else if (root.anime && typeof root.anime === 'object') root = root.anime;
    else break;
  }
  var items = Array.isArray(root) ? root :
    (root && (root.episodes || root.results || root.items || root.docs)) || [];
  var out = [], seen = {};
  items.forEach(function (ep, index) {
    if (!ep || typeof ep !== 'object') return;
    var n = parseInt(ep.number != null ? ep.number :
      (ep.episodeNumber != null ? ep.episodeNumber : ep.episode), 10);
    if (!isFinite(n) || n < 0) n = index + 1;
    var title = _title({ title: ep.title }) || ep.name || ep.episodeTitle || ('Episode ' + n);
    var key = animeId + '||' + n;
    if (seen[key]) return;
    seen[key] = true;
    out.push({
      id: key, number: n, title: String(title), url: key,
      thumbnail: ep.thumbnail || ep.image || ep.cover || null,
      description: _stripHtml(ep.description || ''), sourceId: SOURCE_ID
    });
  });
  // Zangetsu Z Mode maps source episode slots to canonical episode numbers.
  // Keep this list ascending or episode 1 can be wired to the last episode's stream.
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}
function _fetchEpisodes(id) {
  // The endpoint's payload has appeared as {data:{episodes:[...]}} and
  // {episodes:[...]} depending on API deployment; parse both shapes.
  return _json(API + '/anime/' + encodeURIComponent(id) + '/episodes?page=1')
    .then(function (response) {
      var rows = _episodeRows(response, id);
      if (rows.length) return rows;
      var root = response && response.data;
      if (root && root.data) {
        rows = _episodeRows(root.data, id);
        if (rows.length) return rows;
      }
      return [];
    }).catch(function () { return []; });
}
function _unwrapAnime(response) {
  var value = response;
  for (var i = 0; i < 4 && value && typeof value === 'object'; i++) {
    if (value.error || value.success === false) return null;
    if (value.anime && typeof value.anime === 'object') { value = value.anime; continue; }
    if (value.data && typeof value.data === 'object' && !Array.isArray(value.data)) { value = value.data; continue; }
    if (value.result && typeof value.result === 'object') { value = value.result; continue; }
    break;
  }
  return value && typeof value === 'object' &&
    (_title(value) || value.episodes || value.description || value.cover || value.poster) ? value : null;
}
var _detailCache = {};
var _detailInflight = {};
var _DETAIL_TTL = 30000;

// If a title has already been found by search/home, never turn an unexpected
// detail-parser failure into a null result. Z Mode treats null from a matched
// provider as a hard detail failure; this fallback preserves source identity
// and known metadata while leaving episodes empty so the catalogue can supply
// its own ordered episode list. We deliberately do not infer any ID namespace:
// only IDs explicitly supplied by the source card are carried through.
function _cachedCardDetail(id) {
  var card = _cardCache[String(id)];
  if (!card) return null;
  var detail = {
    id: String(id),
    title: card.title,
    url: String(id),
    type: 'anime',
    sourceId: SOURCE_ID,
    episodes: [],
    subCount: 0,
    dubCount: 0
  };
  if (card.englishTitle) detail.englishTitle = card.englishTitle;
  if (card.cover) detail.cover = card.cover;
  if (card.malId) detail.malId = card.malId;
  if (card.anilistId) detail.anilistId = card.anilistId;
  return detail;
}

function getDetail(url, opts) {
  var id = _extractId(url);
  if (!/^\d+$/.test(id)) return Promise.resolve(null);
  var key = id;
  var now = Date.now();
  var hit = _detailCache[key];
  if (hit && (now - hit.at) < _DETAIL_TTL) return Promise.resolve(hit.value);
  if (_detailInflight[key]) return _detailInflight[key];
  var pending = _fetchDetail(url, opts).then(function (detail) {
    delete _detailInflight[key];
    // A source item may have been matched from search even when detail parsing
    // fails unexpectedly. Returning null here makes the JS bridge throw and
    // can surface as the misleading AniList failure banner in Z Mode.
    if (!detail) detail = _cachedCardDetail(key);
    // Never cache an empty/failed response; a temporary upstream miss must
    // not pin a broken episode list in the app.
    if (detail && Array.isArray(detail.episodes) && detail.episodes.length) {
      _detailCache[key] = { at: Date.now(), value: detail };
    }
    return detail;
  }, function (error) {
    delete _detailInflight[key];
    var fallback = _cachedCardDetail(key);
    if (fallback) return fallback;
    throw error;
  });
  _detailInflight[key] = pending;
  return pending;
}

function _fetchDetail(url, opts) {
  var id = _extractId(url);
  if (!/^\d+$/.test(id)) return Promise.resolve(null);
  // Details and episodes are independent. A failed detail request should not
  // erase usable episodes, and nested API response wrappers are normalized.
  return Promise.all([
    _json(API + '/anime/' + encodeURIComponent(id)).catch(function () { return null; }),
    _fetchEpisodes(id)
  ]).then(function (results) {
    var anime = _unwrapAnime(results[0]);
    var episodes = results[1] || [];
    var cachedCard = _cardCache[id] || null;
    // If only the episode endpoint answered, require a previously resolved
    // search card rather than emitting an empty detail that can clobber
    // catalogue metadata in consumers.
    if (!anime && !cachedCard) return null;
    // When BOTH endpoints fail/empty but a search/home card already resolved
    // this title in this session, fall through and build the detail from
    // that card (empty episode list) instead of returning null. A null
    // getDetail result is a hard error in the app — its JS bridge throws
    // "justanime.getDetail returned null" — so the whole detail screen
    // failed even though the title was known: in Z Mode that surfaces as
    // an "AniList is having a moment" banner over a title/cover fallback
    // with no episodes and a dead Play button. An empty-episodes detail
    // keeps the screen alive (Z Mode keeps the catalogue's episodes, and
    // the stream endpoints are independent of these two calls). Null is
    // now reserved for a title nothing is known about: no detail payload,
    // no episodes, and no cached card.
    anime = anime || {};

    // Some JustAnime responses include the full episode objects on the anime
    // detail payload while the separate /episodes endpoint is empty or fails.
    // Prefer those rich objects over generating generic "Episode N" rows.
    if (!episodes.length && Array.isArray(anime.episodes)) {
      episodes = _episodeRows(anime.episodes, id);
    }

    var title = _title(anime) || anime.name || anime.english || anime.romaji ||
      (cachedCard && cachedCard.title) || ('Anime ' + id);
    var count = _episodeCount(anime);
    if (!episodes.length && count > 0) {
      for (var n = 1; n <= count; n++) {
        episodes.push({ id: id + '||' + n, number: n, title: 'Episode ' + n, url: id + '||' + n, sourceId: SOURCE_ID });
      }
    }
    var genres = Array.isArray(anime.genres) ? anime.genres : (Array.isArray(anime.genre) ? anime.genre : []);
    var detail = {
      id: id, title: title, url: id,
      cover: _cover(anime) || (cachedCard && cachedCard.cover) || null,
      description: _stripHtml(anime.description || anime.synopsis || ''),
      status: anime.status || 'unknown', genres: genres, studios: [],
      type: 'anime', sourceId: SOURCE_ID, year: anime.seasonYear || anime.year || null,
      malId: _firstNumericId([anime.idMal, anime.malId, anime.mal_id, cachedCard && cachedCard.malId]),
      // The detail endpoint follows the same AniList Media schema as search:
      // anime.id is the canonical AniList ID (and also this source's route ID).
      // Prefer explicit aliases and the already-mapped card value when available.
      anilistId: _firstNumericId([anime.anilistId, anime.anilist_id, anime.idAnilist, cachedCard && cachedCard.anilistId, anime.id]),
      episodes: episodes, subCount: count || episodes.length, dubCount: count || episodes.length
    };
    // Optional metadata must be absent, not an empty placeholder: consumers
    // can then retain the catalogue's value instead of replacing it with "".
    if (!detail.cover) delete detail.cover;
    if (!detail.description) delete detail.description;
    if (!detail.year) delete detail.year;
    if (!detail.malId) delete detail.malId;
    if (!detail.anilistId) delete detail.anilistId;
    if (!detail.genres.length) delete detail.genres;
    if (detail.status === 'unknown') delete detail.status;
    return detail;
  }).catch(function () { return null; });
}
function getEpisodes(url, opts) {
  // getDetail fetches the detail and episode endpoints together, normalizes
  // their response shapes, and caches only a successful episode list. Calling
  // _fetchEpisodes first here used to duplicate the same request on an empty
  // or transient response and could make Z Mode's episode view flicker.
  return getDetail(url, opts).then(function (detail) {
    return detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  }).catch(function () { return []; });
}
function _isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}
function _isHls(source, url) {
  var s = String(url || '');
  return !!(source && (source.isM3U8 === true || source.isM3U8 === 1)) ||
    /\.m3u8(?:[?#]|$)/i.test(s) ||
    /(?:m3u8|mpegurl|application\/vnd\.apple\.mpegurl)/i.test(String(source && (source.type || source.mimeType || source.mime) || ''));
}
function _quality(source, url) {
  var s = String((source && (source.quality || source.label || source.name)) || '') + ' ' + String(url || '');
  var m = s.match(/\b(2160|1440|1080|720|576|540|480|360)p?\b/i);
  if (m) return m[1] + 'p';
  var res = String(source && source.resolution || '').match(/(?:x|^)(2160|1440|1080|720|576|540|480|360)(?:\b|$)/i);
  return res ? res[1] + 'p' : 'Auto';
}
function _sourceRows(payload, server, lang) {
  var track = payload && payload[lang];
  // Newer AniNeko routes return source fields directly; legacy routes wrap them by language.
  if (!track && payload && Array.isArray(payload.sources)) track = payload;
  var sources = track && Array.isArray(track.sources) ? track.sources : [];
  var headers = track && track.headers || payload && payload.headers || {};
  var out = [];
  sources.forEach(function (s) {
    var url = s && (s.url || s.file);
    // Only use URLs directly exposed by the API. Encrypted/player-token payloads are not playable sources.
    // CDN/proxy stream URLs may not have a .m3u8/.mp4 suffix. Only accept HTTP(S) URLs exposed in the API's sources array.
    if (!_isHttpUrl(url)) return;
    var h = {
      'User-Agent': UA,
      'Referer': headers.Referer || (server === 'megaplay' ? 'https://megaplay.buzz/' : SITE + '/'),
      'Origin': headers.Origin || (server === 'megaplay' ? 'https://megaplay.buzz' : SITE)
    };
    var container = _isHls(s, url) ? 'hls' : 'mp4';
    out.push({
      url: url, quality: _quality(s, url), container: container,
      headers: h, kind: 'raw', label: 'JustAnime ' + server + ' ' + lang.toUpperCase(),
      subtitles: (track.subtitles || track.tracks || []).filter(function (sub) {
        return !!(sub && (sub.file || sub.url));
      }).map(function (sub) {
        return { file: sub.file || sub.url, label: sub.label || sub.lang || 'Unknown' };
      })
    });
  });
  return out;
}
function _animekoSources(id, episode) {
  return _json(API + '/watch/' + encodeURIComponent(id) + '/episode/' +
    encodeURIComponent(episode) + '/anineko').then(function (available) {
      var langs = available && available.langs || {}, jobs = [];
      ['sub', 'dub'].forEach(function (lang) {
        (langs[lang] || []).forEach(function (server) {
          if (!server || !server.server) return;
          jobs.push(_json(API + '/watch/' + encodeURIComponent(id) + '/episode/' +
            encodeURIComponent(episode) + '/anineko/' + encodeURIComponent(lang) + '/' +
            encodeURIComponent(server.server)).then(function (data) {
              var payload = {}; payload[lang] = data;
              return _sourceRows(payload, 'anineko', lang);
            }).catch(function () { return []; }));
        });
      });
      return Promise.all(jobs).then(function (lists) {
        var all = [];
        lists.forEach(function (list) { all = all.concat(list); });
        return all;
      });
    }).catch(function () { return []; });
}
function getVideoSources(episodeUrl, opts) {
  var value = typeof episodeUrl === 'string' ? episodeUrl :
    (episodeUrl && (episodeUrl.url || episodeUrl.id)) || '';
  var parts = String(value).split('||');
  var id = _extractId(parts[0]), episode = parseInt(parts[1], 10);
  if (!/^\d+$/.test(id) || !isFinite(episode) || episode < 1) {
    return Promise.reject(new Error('JustAnime: invalid episode reference'));
  }
  var config = _settings();
  var langs = config.language === 'dub' ? ['dub', 'sub'] : ['sub', 'dub'];
  var jobs = [];
  // Current API route: language-specific AniNeko server returning sources directly.
  // Discover the server IDs first. They are dynamic; hardcoding "hd1"
  // can silently return no sources when JustAnime changes its server list.
  // _animekoSources performs the API's documented two-step lookup.

  var legacyServers = config.servers === 'all' ? ['megaplay', 'animegg'] :
    (config.servers === 'anineko' ? [] : [config.servers]);
  legacyServers.forEach(function (server) {
    jobs.push(_json(API + '/watch/' + encodeURIComponent(id) + '/episode/' +
      encodeURIComponent(episode) + '/' + server).then(function (payload) {
        var rows = [];
        rows = rows.concat(_sourceRows(payload, server, 'sub'));
        rows = rows.concat(_sourceRows(payload, server, 'dub'));
        return rows;
      }).catch(function () { return []; }));
  });
  if (config.servers === 'all' || config.servers === 'anineko') {
    jobs.push(_animekoSources(id, episode));
  }
  return Promise.all(jobs).then(function (lists) {
    var rows = [], seen = {};
    lists.forEach(function (list) {
      (list || []).forEach(function (row) {
        if (!seen[row.url]) { seen[row.url] = true; rows.push(row); }
      });
    });
    rows.sort(function (a, b) {
      var al = a.label.indexOf(' ' + config.language.toUpperCase()) >= 0 ? 0 : 1;
      var bl = b.label.indexOf(' ' + config.language.toUpperCase()) >= 0 ? 0 : 1;
      return al - bl || (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0);
    });
    if (!rows.length) throw new Error('JustAnime: API returned no directly playable stream URLs');
    return rows;
  });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search, getDetail: getDetail,
    getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams,
    _cards: _cards, _extractId: _extractId, _sourceRows: _sourceRows,
    _isHttpUrl: _isHttpUrl, _isHls: _isHls
  };
}
