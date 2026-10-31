// Zenkai Player — AniList catalogue + native MegaPlay, VidStream and ACDN playback.
// ACDN exposes a multi-audio HLS playlist through Zenkai's embed API route.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'zenkaii';
var ANILIST_API = 'https://graphql.anilist.co';
var ZENKAI_EMBED = 'https://zenkaii.pages.dev/embed';
var SERVER_VALUES = ['megaplay', 'vidstream', 'flixcloud', 'acdn'];
var AUDIO_VALUES = ['sub', 'dub'];
var ANIMAP_API = 'https://animap.id/api';
var ANIMAP_CACHE = {};
var ANIMAP_INFLIGHT = {};
var ANILIST_CACHE = {};
var ANILIST_INFLIGHT = {};
var ANILIST_QUEUE = Promise.resolve();
var ANILIST_NEXT_REQUEST_AT = 0;
var ANILIST_COOLDOWN_UNTIL = 0;
var ANILIST_MIN_INTERVAL_MS = 2500;
var ANILIST_DEFAULT_COOLDOWN_MS = 60000;

function getInfo() {
  return {
    name: 'Zenkai Player',
    lang: 'en',
    baseUrl: 'https://zenkaii.pages.dev',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=zenkaii.pages.dev',
    type: 'anime',
    version: '1.4.1'
  };
}

function getSettings() {
  return [
    {
      key: 'server',
      label: 'Zenkai Player server',
      description: 'Choose MegaPlay, VidStream, FlixCloud fallback, or native ACDN multi-audio playback.',
      type: 'enum',
      default: 'megaplay',
      options: [
        { value: 'megaplay', label: 'MegaPlay (HD-1)' },
        { value: 'vidstream', label: 'VidStream (HD-2)' },
        { value: 'flixcloud', label: 'FlixCloud (fallback)' },
        { value: 'acdn', label: 'ACDN (Multi-audio)' }
      ]
    },
    {
      key: 'audio',
      label: 'Preferred audio',
      description: 'Preferred source category. ACDN returns a multi-audio HLS playlist.',
      type: 'enum',
      default: 'sub',
      options: [
        { value: 'sub', label: 'SUB · Original audio' },
        { value: 'dub', label: 'DUB · English audio' }
      ]
    }
  ];
}

function _trim(value) {
  return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function _setting(key, fallback) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var settings = all[SOURCE_ID] || {};
    var value = settings[key];
    return value == null || value === '' ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

function _config() {
  var server = _trim(_setting('server', 'megaplay')).toLowerCase();
  var audio = _trim(_setting('audio', 'sub')).toLowerCase();
  if (SERVER_VALUES.indexOf(server) < 0) server = 'megaplay';
  if (AUDIO_VALUES.indexOf(audio) < 0) audio = 'sub';
  return { server: server, audio: audio };
}

function _delay(ms) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function _header(response, name) {
  var headers = response && response.headers;
  if (!headers) return '';
  try {
    if (typeof headers.get === 'function') return String(headers.get(name) || headers.get(name.toLowerCase()) || '');
  } catch (e) {}
  var wanted = String(name).toLowerCase();
  try {
    var keys = Object.keys(headers);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === wanted) return String(headers[keys[i]] || '');
    }
  } catch (e) {}
  return '';
}

function _markAniListRateLimit(response, error) {
  var waitMs = 0;
  var retryAfter = parseFloat(_header(response, 'retry-after'));
  if (isFinite(retryAfter) && retryAfter > 0) waitMs = Math.max(waitMs, retryAfter * 1000);
  var resetAt = Number(_header(response, 'x-ratelimit-reset'));
  if (isFinite(resetAt) && resetAt > Date.now() / 1000) {
    waitMs = Math.max(waitMs, resetAt * 1000 - Date.now());
  }
  // The host may reject a fetch with a generic cancelled DioException while
  // the actual AniListRateLimited(seconds) value is only written to native
  // logs. Use the documented 60-second fallback rather than retrying aliases.
  var message = String(error && error.message || error || '');
  var hostWait = message.match(/AniListRateLimited\((\d+)s\)/i);
  if (hostWait) waitMs = Math.max(waitMs, Number(hostWait[1]) * 1000);
  if (/DioException\s*\[request cancelled\]/i.test(message)) {
    waitMs = Math.max(waitMs, ANILIST_DEFAULT_COOLDOWN_MS);
  }
  if (/HTTP\s*429|too many requests|rate.?limit/i.test(message) && !(waitMs > 0)) {
    waitMs = ANILIST_DEFAULT_COOLDOWN_MS;
  }
  if (!(waitMs > 0)) waitMs = ANILIST_DEFAULT_COOLDOWN_MS;
  ANILIST_COOLDOWN_UNTIL = Math.max(ANILIST_COOLDOWN_UNTIL, Date.now() + waitMs);
}

function _queuedAniListRequest(query, variables) {
  var task = ANILIST_QUEUE.then(function () {
    if (Date.now() < ANILIST_COOLDOWN_UNTIL) {
      throw new Error('AniList rate limited; retry in ' +
        Math.ceil((ANILIST_COOLDOWN_UNTIL - Date.now()) / 1000) + 's');
    }
    var wait = ANILIST_NEXT_REQUEST_AT - Date.now();
    return _delay(wait).then(function () {
      if (Date.now() < ANILIST_COOLDOWN_UNTIL) {
        throw new Error('AniList rate limited; cooldown active');
      }
      ANILIST_NEXT_REQUEST_AT = Date.now() + ANILIST_MIN_INTERVAL_MS;
      return fetch(ANILIST_API, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Referer': 'https://anilist.co/'
        },
        body: JSON.stringify({ query: query, variables: variables || {} }),
        timeoutMs: 30000
      }).then(function (response) {
        var status = Number(response && response.status) || 0;
        if (status === 429) {
          _markAniListRateLimit(response, 'HTTP 429');
          throw new Error('AniList HTTP 429');
        }
        if (status >= 400) throw new Error('AniList HTTP ' + status);
        var body = response && response.body != null ? response.body : '';
        var json = typeof body === 'string' ? JSON.parse(body || 'null') : body;
        if (!json) throw new Error('AniList returned an empty response');
        if (Array.isArray(json.errors) && json.errors.length) {
          var tooMany = json.errors.some(function (entry) {
            return Number(entry && entry.status) === 429 ||
              /too many requests|rate.?limit/i.test(String(entry && entry.message || ''));
          });
          if (tooMany) {
            _markAniListRateLimit(response, 'GraphQL 429');
            throw new Error('AniList GraphQL rate limit: ' + String(json.errors[0].message || 'HTTP 429'));
          }
          throw new Error('AniList GraphQL error: ' + String(json.errors[0].message || 'unknown error'));
        }
        return json.data || {};
      }).catch(function (error) {
        // Zangetsu's bridge rejects __fetch for a native cooldown instead of
        // returning an HTTP response. Detect that path too and stop aliases
        // from sending one failed request per spelling.
        _markAniListRateLimit(null, error);
        throw error;
      });
    });
  });
  ANILIST_QUEUE = task.then(function () {}, function () {});
  return task;
}

function _graphql(query, variables, ttlMs) {
  var vars = variables || {};
  var keyVars = {};
  Object.keys(vars).sort().forEach(function (k) {
    keyVars[k] = k === 'search' ? _trim(vars[k]).toLowerCase() : vars[k];
  });
  var key = JSON.stringify([query, keyVars]);
  var now = Date.now();
  var cached = ANILIST_CACHE[key];
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
  if (ANILIST_INFLIGHT[key]) return ANILIST_INFLIGHT[key];

  var request = _queuedAniListRequest(query, vars).then(function (data) {
    ANILIST_CACHE[key] = {
      value: data,
      expiresAt: Date.now() + (ttlMs || 600000),
      staleUntil: Date.now() + 86400000
    };
    var keys = Object.keys(ANILIST_CACHE);
    while (keys.length > 250) delete ANILIST_CACHE[keys.shift()];
    return data;
  }).catch(function (error) {
    var stale = ANILIST_CACHE[key];
    if (stale && stale.staleUntil > Date.now()) {
      console.warn('AniList request failed; serving cached metadata:', String(error));
      return stale.value;
    }
    throw error;
  }).then(function (data) {
    delete ANILIST_INFLIGHT[key];
    return data;
  }, function (error) {
    delete ANILIST_INFLIGHT[key];
    throw error;
  });
  ANILIST_INFLIGHT[key] = request;
  return request;
}

function _animapJson(path, ttlMs) {
  var url = ANIMAP_API + path;
  var cached = ANIMAP_CACHE[url];
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  if (ANIMAP_INFLIGHT[url]) return ANIMAP_INFLIGHT[url];
  var request = fetch(url, {
    headers: { 'Accept': 'application/json' },
    timeoutMs: 12000
  }).then(function (response) {
    var status = Number(response && response.status) || 0;
    if (status === 404) {
      // Negative-cache missing records too. Detail refreshes often revisit the
      // same AniList ID and should not repeatedly probe an absent snapshot.
      var missingTtl = ttlMs || 3600000;
      ANIMAP_CACHE[url] = {
        value: null,
        expiresAt: Date.now() + missingTtl,
        staleUntil: Date.now() + missingTtl
      };
      return null;
    }
    if (status >= 400) throw new Error('AniMap HTTP ' + status);
    var body = response && response.body != null ? response.body : '';
    var json = typeof body === 'string' ? JSON.parse(body || 'null') : body;
    if (json && json.error) throw new Error('AniMap: ' + String(json.error));
    return json;
  }).then(function (value) {
    ANIMAP_CACHE[url] = {
      value: value,
      expiresAt: Date.now() + (ttlMs || 3600000),
      staleUntil: Date.now() + 86400000
    };
    return value;
  }).catch(function (error) {
    var stale = ANIMAP_CACHE[url];
    if (stale && stale.staleUntil > Date.now()) {
      console.warn('AniMap request failed; serving cached metadata:', String(error));
      return stale.value;
    }
    throw error;
  }).then(function (value) {
    delete ANIMAP_INFLIGHT[url];
    return value;
  }, function (error) {
    delete ANIMAP_INFLIGHT[url];
    throw error;
  });
  ANIMAP_INFLIGHT[url] = request;
  return request;
}

function _normalizeAnimapMedia(record, fallbackId) {
  if (!record || typeof record !== 'object') return null;
  var id = Number(record.anilist_id || record.id || fallbackId);
  if (!isFinite(id) || id < 1) return null;
  var image = record.cover_image || record.coverImage || null;
  var mal = Number(record.id_mal || record.mal_id || record.idMal);
  return {
    id: id,
    idMal: isFinite(mal) && mal > 0 ? mal : null,
    title: {
      romaji: record.title_romaji || record.titleRomaji || '',
      english: record.title_english || record.titleEnglish || '',
      native: record.title_native || record.titleNative || ''
    },
    synonyms: Array.isArray(record.synonyms) ? record.synonyms : [],
    format: record.format || null,
    status: record.status || null,
    seasonYear: Number(record.season_year || record.seasonYear || record.year) || null,
    episodes: record.episodes == null ? null : Number(record.episodes),
    nextAiringEpisode: null,
    averageScore: record.average_score || record.averageScore || null,
    description: record.description || record.synopsis || '',
    genres: Array.isArray(record.genres) ? record.genres : [],
    studios: Array.isArray(record.studios) ? record.studios : [],
    coverImage: image ? { extraLarge: image, large: image } : null,
    bannerImage: record.banner_image || record.bannerImage || null
  };
}

function _animapMedia(id) {
  return _animapJson('/anilist/' + encodeURIComponent(id), 21600000)
    .then(function (record) { return _normalizeAnimapMedia(record, id); });
}

function _animapMal(malId) {
  return _animapJson('/mal/' + encodeURIComponent(malId), 21600000);
}

function _animapRaw(id) {
  return _animapJson('/anilist/' + encodeURIComponent(id) + '/raw', 21600000);
}

function _animapMap(id) {
  return _animapJson('/v1/map/anilist/' + encodeURIComponent(id), 21600000);
}

function _mappedMalId(entry) {
  if (!entry || typeof entry !== 'object') return null;
  var direct = Number(entry.mal_id || entry.malId);
  if (isFinite(direct) && direct > 0) return direct;
  var sources = Array.isArray(entry.sources) ? entry.sources : [];
  for (var i = 0; i < sources.length; i++) {
    var match = String(sources[i] || '').match(/myanimelist\.net\/anime\/(\d+)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function _mediaFromMap(entry, id) {
  if (!entry || typeof entry !== 'object') return null;
  var malId = _mappedMalId(entry);
  var season = entry.animeSeason || {};
  var image = entry.picture || entry.thumbnail || null;
  var title = _trim(entry.title || '');
  if (!title) return null;
  return {
    id: Number(id),
    idMal: malId,
    title: { romaji: title, english: title, native: '' },
    synonyms: Array.isArray(entry.synonyms) ? entry.synonyms : [],
    format: entry.type || null,
    status: entry.status || null,
    seasonYear: Number(season.year) || null,
    episodes: Number(entry.episodes) > 0 ? Number(entry.episodes) : null,
    nextAiringEpisode: null,
    averageScore: null,
    description: '',
    genres: Array.isArray(entry.tags) ? entry.tags : [],
    studios: Array.isArray(entry.studios) ? entry.studios : [],
    coverImage: image ? { extraLarge: image, large: image } : null,
    bannerImage: null
  };
}

function _mergeAnimapMap(media, map) {
  if (!media || !map) return media;
  var mapped = _mediaFromMap(map, media.id);
  if (!mapped) return media;
  if (!media.idMal) media.idMal = mapped.idMal;
  if (!(Number(media.episodes) > 0) && Number(mapped.episodes) > 0) media.episodes = mapped.episodes;
  if (!media.title || !(media.title.english || media.title.romaji || media.title.native)) media.title = mapped.title;
  if ((!media.coverImage || !(media.coverImage.extraLarge || media.coverImage.large)) && mapped.coverImage) media.coverImage = mapped.coverImage;
  if ((!media.genres || !media.genres.length) && mapped.genres.length) media.genres = mapped.genres;
  if ((!media.studios || !media.studios.length) && mapped.studios.length) media.studios = mapped.studios;
  if (!media.status) media.status = mapped.status;
  if (!media.format) media.format = mapped.format;
  if (!media.seasonYear) media.seasonYear = mapped.seasonYear;
  if ((!media.synonyms || !media.synonyms.length) && mapped.synonyms.length) media.synonyms = mapped.synonyms;
  return media;
}

function _mapLimit(items, limit, mapper) {
  var results = new Array(items.length);
  var nextIndex = 0;
  var workerCount = Math.min(items.length, Math.max(1, Number(limit) || 1));
  function worker() {
    if (nextIndex >= items.length) return Promise.resolve();
    var index = nextIndex++;
    return Promise.resolve().then(function () {
      return mapper(items[index], index);
    }).then(function (value) {
      results[index] = value;
      return worker();
    }, function () {
      results[index] = null;
      return worker();
    });
  }
  var workers = [];
  for (var i = 0; i < workerCount; i++) workers.push(worker());
  return Promise.all(workers).then(function () { return results; });
}

var MEDIA_FIELDS = [
  'id',
  'idMal',
  'title { romaji english native }',
  'synonyms',
  'format',
  'status',
  'seasonYear',
  'episodes',
  'nextAiringEpisode { episode }',
  'studios { nodes { name } }',
  'averageScore',
  'description',
  'genres',
  'coverImage { extraLarge large }',
  'bannerImage'
].join(' ');

function _mediaItem(media) {
  if (!media || !Number.isInteger(Number(media.id)) || Number(media.id) < 1) return null;
  var title = _trim((media.title && (media.title.english || media.title.romaji || media.title.native)) || '');
  if (!title) return null;
  var id = Number(media.id);
  var malId = Number(media.idMal || media.malId);
  var itemUrl = 'anilist://' + id;
  var item = {
    id: itemUrl,
    url: itemUrl,
    title: media.seasonYear ? title + ' (' + media.seasonYear + ')' : title,
    cover: media.coverImage && (media.coverImage.extraLarge || media.coverImage.large) || null,
    banner: media.bannerImage || null,
    type: 'anime',
    sourceId: SOURCE_ID,
    anilistId: id
  };
  if (isFinite(malId) && malId > 0) item.malId = malId;
  if (Array.isArray(media.synonyms) && media.synonyms.length) item.synonyms = media.synonyms.slice(0, 20);
  if (media.averageScore != null && isFinite(Number(media.averageScore))) {
    item.score = Number(media.averageScore);
  }
  return item;
}

function _mapMedia(list) {
  return (Array.isArray(list) ? list : []).map(_mediaItem).filter(Boolean);
}

function _animapFallbackItem(mapping, id, mal) {
  var titles = Array.isArray(mapping && mapping.titles) ? mapping.titles : [];
  var title = _trim(
    (mal && (mal.title_english || mal.title)) ||
    titles[0] || mapping && mapping.title || ''
  );
  if (!title) return null;
  var malId = Number(mapping && mapping.mal_id || mal && mal.mal_id);
  var year = Number(mapping && mapping.year || mal && mal.year) || null;
  var url = 'anilist://' + String(id);
  var item = {
    id: url,
    url: url,
    title: year ? title + ' (' + year + ')' : title,
    cover: mal && mal.image_url || null,
    banner: null,
    type: 'anime',
    sourceId: SOURCE_ID,
    anilistId: Number(id)
  };
  if (isFinite(malId) && malId > 0) item.malId = malId;
  var synonyms = titles.slice(1, 20);
  if (mal && Array.isArray(mal.title_synonyms)) synonyms = synonyms.concat(mal.title_synonyms);
  if (synonyms.length) {
    var unique = [], seen = {};
    synonyms.forEach(function (name) {
      var value = _trim(name);
      var key = value.toLowerCase();
      if (value && key !== title.toLowerCase() && !seen[key]) {
        seen[key] = true; unique.push(value);
      }
    });
    if (unique.length) item.synonyms = unique.slice(0, 20);
  }
  return item;
}

function _animapSearch(query, page) {
  var q = _trim(query);
  if (q.length < 2) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  var limit = Math.min(100, p * 20);
  var path = '/search?q=' + encodeURIComponent(q) + '&limit=' + limit;
  return _animapJson(path, 900000).then(function (rows) {
    if (!Array.isArray(rows)) return [];
    var mapped = [];
    var seen = {};
    rows.forEach(function (entry) {
      var ids = Array.isArray(entry && entry.anilist_id) ? entry.anilist_id :
        (entry && entry.anilist_id != null ? [entry.anilist_id] : []);
      ids.forEach(function (rawId) {
        var id = Number(rawId);
        if (!isFinite(id) || id < 1 || seen[id]) return;
        seen[id] = true;
        mapped.push({ id: id, mapping: entry });
      });
    });
    var start = (p - 1) * 20;
    // AniMap search already contains the ordered title aliases, year and
    // AniList/MAL IDs. Do not issue N metadata lookups for the result cards:
    // Zangetsu immediately performs getDetail() for the selected match.
    return mapped.slice(start, start + 20).map(function (entry) {
      return _animapFallbackItem(entry.mapping, entry.id, null);
    }).filter(Boolean);
  });
}

function _aniListSearch(query, page) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  var gql = 'query ($search: String, $page: Int) { Page(page: $page, perPage: 20) { media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) { ' + MEDIA_FIELDS + ' } } }';
  return _graphql(gql, { search: q, page: p }, 900000)
    .then(function (data) { return _mapMedia(data.Page && data.Page.media); });
}

function getHome(opts) {
  var query = 'query { Page(page: 1, perPage: 20) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ' + MEDIA_FIELDS + ' } } }';
  return _graphql(query, {}, 900000).then(function (data) {
    var items = _mapMedia(data.Page && data.Page.media);
    return items.length ? [{ title: 'Trending Anime · Zenkai', items: items }] : [];
  }).catch(function (error) {
    console.warn('Zenkai Player home failed:', String(error));
    return [];
  });
}

function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    (rows || []).forEach(function (row) {
      (row.items || []).forEach(function (item) { out.push(item); });
    });
    return out;
  });
}

function search(query, page, opts) {
  var q = _trim(query);
  if (q.length < 2) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  return _animapSearch(q, p).then(function (items) {
    if (items.length) return items;
    if (Date.now() < ANILIST_COOLDOWN_UNTIL) return [];
    return _aniListSearch(q, p);
  }).catch(function (error) {
    console.warn('Zenkai metadata search failed:', String(error));
    if (Date.now() < ANILIST_COOLDOWN_UNTIL) return [];
    return _aniListSearch(q, p).catch(function (fallbackError) {
      console.warn('Zenkai AniList fallback unavailable:', String(fallbackError));
      return [];
    });
  });
}

function _parseAniListId(value) {
  if (value && typeof value === 'object') {
    var candidate = value.anilistId || value.anilist_id || value.id || value.mediaId;
    if (candidate != null && /^\d+$/.test(String(candidate))) {
      var number = Number(candidate);
      return number > 0 ? number : null;
    }
  }
  var raw = _trim(value);
  if (/^\d+$/.test(raw)) return Number(raw) > 0 ? Number(raw) : null;
  var match = raw.match(/^(?:anilist|zenkaii):\/\/(\d+)(?:[/?#]|$)/i);
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}

function _episodeUrl(anilistId, episode, title, format) {
  return JSON.stringify({
    provider: 'zenkaii',
    // Zangetsu caches resolved streams by sourceId|episodeUrl for up to
    // 20 minutes. A versioned episode URL invalidates old HTML-embed results
    // after this provider changes away from returning an iframe as video.
    providerVersion: '1.4.0',
    anilistId: Number(anilistId),
    episode: Number(episode),
    title: String(title || ''),
    format: String(format || '')
  });
}

function _episodeCount(media) {
  var count = Number(media && media.episodes);
  if (String(media && media.format || '').toUpperCase() === 'MOVIE') return 1;
  if (isFinite(count) && count > 0) return Math.min(Math.floor(count), 20000);
  var nextEpisode = Number(media && media.nextAiringEpisode && media.nextAiringEpisode.episode);
  if (isFinite(nextEpisode) && nextEpisode > 1) return Math.min(Math.floor(nextEpisode - 1), 20000);
  return 0;
}

function _episodes(media) {
  var id = Number(media.id);
  var count = _episodeCount(media);
  if (!count) return [];
  var out = [];
  var title = _trim((media.title && (media.title.english || media.title.romaji || media.title.native)) || '');
  var config = _config();
  for (var ep = 1; ep <= count; ep++) {
    out.push({
      id: String(ep),
      title: title + ' · Episode ' + ep,
      number: ep,
      url: _episodeUrl(id, ep, title, media.format),
      embedUrl: buildEmbedUrl(id, ep, config.server, config.audio)
    });
  }
  return out;
}

function _mergeAnimapFallbacks(media, mal, raw) {
  var merged = {};
  Object.keys(media || {}).forEach(function (key) { merged[key] = media[key]; });

  // MAL's parsed record is the preferred episode-count fallback.
  if (!(Number(merged.episodes) > 0) && mal && Number(mal.episodes) > 0) {
    merged.episodes = Number(mal.episodes);
  }

  // AniMap's raw snapshot includes AniList's nextAiringEpisode. This is useful
  // for long-running titles whose parsed AniList and MAL episode totals are
  // both missing or zero. _episodeCount() derives the latest known aired
  // episode as nextAiringEpisode.episode - 1; it never guesses a total.
  if (raw && raw.nextAiringEpisode) {
    merged.nextAiringEpisode = raw.nextAiringEpisode;
  }
  if (raw && merged.averageScore == null && raw.averageScore != null) {
    merged.averageScore = raw.averageScore;
  }
  if (raw && (!merged.description || !String(merged.description).trim()) && raw.description) {
    merged.description = raw.description;
  }
  if (raw && (!merged.coverImage || !(merged.coverImage.extraLarge || merged.coverImage.large)) && raw.coverImage) {
    merged.coverImage = raw.coverImage;
  }
  if (raw && (!merged.bannerImage || !String(merged.bannerImage).trim()) && raw.bannerImage) {
    merged.bannerImage = raw.bannerImage;
  }
  if (raw && (!merged.genres || !merged.genres.length) && Array.isArray(raw.genres)) {
    merged.genres = raw.genres;
  }
  if (raw && (!merged.studios || !merged.studios.length) && raw.studios) {
    merged.studios = raw.studios;
  }

  // Fill only missing display fields from MAL.
  if ((!merged.description || !String(merged.description).trim()) && mal && mal.synopsis) {
    merged.description = mal.synopsis;
  }
  if ((!merged.coverImage || !(merged.coverImage.extraLarge || merged.coverImage.large)) && mal && mal.image_url) {
    merged.coverImage = { extraLarge: mal.image_url, large: mal.image_url };
  }
  if ((!merged.genres || !merged.genres.length) && mal && Array.isArray(mal.genres)) {
    merged.genres = mal.genres;
  }
  if ((!merged.studios || !merged.studios.length) && mal && Array.isArray(mal.studios)) {
    merged.studios = mal.studios;
  }
  return merged;
}

function _detailFromMedia(media) {
  if (!media) return null;
  var item = _mediaItem(media);
  if (!item) return null;
  var episodes = _episodes(media);
  var status = String(media.status || '').toLowerCase();
  var studios = [];
  if (Array.isArray(media.studios)) {
    studios = media.studios.map(function (studio) {
      return typeof studio === 'string' ? studio : (studio && studio.name);
    }).filter(Boolean);
  } else if (media.studios && media.studios.nodes) {
    studios = media.studios.nodes.map(function (studio) { return studio && studio.name; }).filter(Boolean);
  }
  var title = _trim((media.title && (media.title.english || media.title.romaji || media.title.native)) || '');
  var result = {
    id: 'anilist://' + Number(media.id),
    url: 'anilist://' + Number(media.id),
    title: title,
    cover: item.cover,
    banner: item.banner,
    description: media.description || '',
    status: status === 'finished' ? 'completed' :
      (status === 'releasing' || status === 'not_yet_released' || status === 'currently_airing') ? 'ongoing' :
      (status === 'cancelled' || status === 'canceled') ? 'cancelled' :
      status === 'hiatus' ? 'hiatus' : 'unknown',
    genres: Array.isArray(media.genres) ? media.genres : [],
    studios: studios,
    type: 'anime',
    sourceId: SOURCE_ID,
    year: media.seasonYear ? String(media.seasonYear) : null,
    anilistId: Number(media.id),
    malId: media.idMal || item.malId || null,
    episodes: episodes,
    subCount: episodes.length,
    dubCount: 0
  };
  if (media.averageScore != null && isFinite(Number(media.averageScore))) {
    result.score = Number(media.averageScore);
  }
  return result;
}

function _animapDetail(id) {
  return _animapMedia(id).catch(function () { return null; }).then(function (media) {
    // Most records are complete and need only one metadata request.
    if (media && (Number(media.episodes) > 0 ||
        String(media.format || '').toUpperCase() === 'MOVIE')) {
      return _detailFromMedia(media);
    }

    // Ask for a mapping only when the parsed AniList record is missing or has
    // no MAL ID. The mapping is cached separately from parsed records.
    var mapPromise = (!media || !(Number(media.idMal) > 0))
      ? _animapMap(id).catch(function () { return null; })
      : Promise.resolve(null);

    return mapPromise.then(function (map) {
      if (!media) media = _mediaFromMap(map, id);
      else if (map) media = _mergeAnimapMap(media, map);
      if (!media) return null;

      if (Number(media.episodes) > 0 ||
          String(media.format || '').toUpperCase() === 'MOVIE') {
        return _detailFromMedia(media);
      }

      // Only unresolved episode totals pay for fallback requests. MAL and the
      // AniList raw snapshot run in parallel to avoid adding sequential latency.
      var malId = Number(media.idMal);
      var jobs = [
        malId > 0 ? _animapMal(malId).catch(function () { return null; }) : Promise.resolve(null),
        _animapRaw(id).catch(function () { return null; })
      ];
      return Promise.all(jobs).then(function (results) {
        return _detailFromMedia(_mergeAnimapFallbacks(media, results[0], results[1]));
      });
    });
  });
}

function _aniListDetail(id) {
  var query = 'query ($id: Int) { Media(id: $id, type: ANIME) { ' + MEDIA_FIELDS + ' } }';
  return _graphql(query, { id: id }, 21600000).then(function (data) {
    var media = data.Media;
    if (!media || Number(media.id) !== id) return null;
    return _detailFromMedia(media);
  });
}

function getDetail(url, opts) {
  var id = _parseAniListId(url);
  if (!id) return Promise.resolve(null);
  return _animapDetail(id).then(function (detail) {
    if (detail) return detail;
    if (Date.now() < ANILIST_COOLDOWN_UNTIL) return null;
    return _aniListDetail(id);
  }).catch(function (error) {
    console.warn('Zenkai metadata lookup failed:', String(error));
    if (Date.now() < ANILIST_COOLDOWN_UNTIL) return null;
    return _aniListDetail(id).catch(function (fallbackError) {
      console.warn('Zenkai AniList detail fallback unavailable:', String(fallbackError));
      return null;
    });
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) {
    return detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  });
}

function _parseEpisode(value) {
  var item = value && typeof value === 'object' ? value : null;
  var raw = _trim(value);
  if (!item && raw.charAt(0) === '{') {
    try { item = JSON.parse(raw); } catch (e) {}
  }
  if (!item || typeof item !== 'object') return null;
  var id = _parseAniListId(item.anilistId || item.anilist_id || item.id);
  var ep = Number(item.episode || item.ep || item.number);
  if (!id || !Number.isInteger(ep) || ep < 1 || ep > 20000) return null;
  return {
    anilistId: id,
    episode: ep,
    title: _trim(item.title || ''),
    format: _trim(item.format || '').toUpperCase()
  };
}

function buildEmbedUrl(anilistId, episode, server, audio) {
  var id = Number(anilistId);
  var ep = Number(episode);
  var srv = _trim(server).toLowerCase();
  var lang = _trim(audio).toLowerCase();
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(ep) || ep < 1) return null;
  if (SERVER_VALUES.indexOf(srv) < 0 || AUDIO_VALUES.indexOf(lang) < 0) return null;
  return ZENKAI_EMBED + '?id=' + encodeURIComponent(id) +
    '&ep=' + encodeURIComponent(ep) +
    '&server=' + encodeURIComponent(srv) +
    '&audio=' + encodeURIComponent(lang);
}

function getServerAvailability(anilistId, episode, title) {
  var id = Number(anilistId);
  var ep = Number(episode);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(ep) || ep < 1) {
    return Promise.resolve(null);
  }
  var query = '?id=' + encodeURIComponent(id) +
    '&ep=' + encodeURIComponent(ep) +
    (title ? '&title=' + encodeURIComponent(String(title)) : '');
  return fetch('https://zenkaii.pages.dev/api/servers' + query, {
    headers: { 'Accept': 'application/json' },
    timeoutMs: 12000
  }).then(function (response) {
    var status = Number(response && response.status) || 0;
    if (status >= 400) throw new Error('Zenkai server availability HTTP ' + status);
    var body = response && response.body != null ? response.body : '';
    var json = typeof body === 'string' ? JSON.parse(body || 'null') : body;
    if (!json || json.success !== true || !json.servers || typeof json.servers !== 'object') {
      throw new Error('Zenkai returned an invalid server availability response');
    }
    return json.servers;
  }).catch(function (error) {
    console.warn('Zenkai server availability unavailable:', String(error));
    return null;
  });
}

var MEGA_AES_KEY = 'i?LMTAx0Q6,:}50U';
var MEGA_AES_IV = "W0;27ToaUpl_P%'c";

function _padBytes(s, n) {
  var out = [], i;
  for (i = 0; i < n; i++) out[i] = 0;
  var b = String(s || '');
  for (i = 0; i < b.length && i < n; i++) out[i] = b.charCodeAt(i) & 0xff;
  return out;
}
function _b64urlBytes(s) {
  var t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  var pad = (4 - (t.length % 4)) % 4;
  while (pad--) t += '=';
  try { return base64ToBytes(t); } catch (e) { return []; }
}
// Plain sources.file when present; otherwise AES-CBC-decrypt `enc` → {file}.

var _SBOX=[0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _ISBOX=[0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
function _xtime(a){a<<=1;if(a&0x100)a^=0x11b;return a&0xff;}
function _gmul(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return p&0xff;}
function _keyExp(key){
  var Nk=key.length/4,Nr=Nk+6,w=[],i;
  for(i=0;i<Nk;i++)w.push([key[4*i],key[4*i+1],key[4*i+2],key[4*i+3]]);
  var rcon=1;
  for(i=Nk;i<4*(Nr+1);i++){
    var t=w[i-1].slice();
    if(i%Nk===0){t=[t[1],t[2],t[3],t[0]];t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];t[0]^=rcon;rcon=_xtime(rcon);}
    else if(Nk>6&&i%Nk===4){t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];}
    w.push([w[i-Nk][0]^t[0],w[i-Nk][1]^t[1],w[i-Nk][2]^t[2],w[i-Nk][3]^t[3]]);
  }
  return {w:w,Nr:Nr};
}
function _invCipher(inb,ks){
  var w=ks.w,Nr=ks.Nr,s=[[],[],[],[]],r,c,i;
  for(i=0;i<16;i++)s[i%4][(i/4)|0]=inb[i];
  function ark(round){for(c=0;c<4;c++)for(r=0;r<4;r++)s[r][c]^=w[round*4+c][r];}
  function isub(){for(r=0;r<4;r++)for(c=0;c<4;c++)s[r][c]=_ISBOX[s[r][c]];}
  function ishift(){for(r=1;r<4;r++){var row=s[r].slice();for(c=0;c<4;c++)s[r][c]=row[(c-r+4)%4];}}
  function imix(){for(c=0;c<4;c++){var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,14)^_gmul(a1,11)^_gmul(a2,13)^_gmul(a3,9);
    s[1][c]=_gmul(a0,9)^_gmul(a1,14)^_gmul(a2,11)^_gmul(a3,13);
    s[2][c]=_gmul(a0,13)^_gmul(a1,9)^_gmul(a2,14)^_gmul(a3,11);
    s[3][c]=_gmul(a0,11)^_gmul(a1,13)^_gmul(a2,9)^_gmul(a3,14);}}
  ark(Nr);
  for(var round=Nr-1;round>=1;round--){ishift();isub();ark(round);imix();}
  ishift();isub();ark(0);
  var out=[];for(i=0;i<16;i++)out[i]=s[i%4][(i/4)|0];return out;
}
function _aesCbcDecrypt(ct,key,iv){
  var ks=_keyExp(key),out=[],prev=iv.slice(),off,i;
  for(off=0;off+16<=ct.length;off+=16){
    var block=ct.slice(off,off+16),dec=_invCipher(block,ks);
    for(i=0;i<16;i++)out.push(dec[i]^prev[i]);
    prev=block;
  }
  var pad=out[out.length-1];
  if(pad>0&&pad<=16)out=out.slice(0,out.length-pad);
  return out;
}
function _bytesToStr(b){var s='',i=0;while(i<b.length){var c=b[i++];if(c<0x80)s+=String.fromCharCode(c);else if(c<0xE0)s+=String.fromCharCode(((c&0x1f)<<6)|(b[i++]&0x3f));else if(c<0xF0)s+=String.fromCharCode(((c&0x0f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f));else{var cp=((c&0x07)<<18)|((b[i++]&0x3f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f);cp-=0x10000;s+=String.fromCharCode(0xD800+(cp>>10),0xDC00+(cp&0x3FF));}}return s;}


var MEGA_DIRECT_ORIGIN = 'https://megaplay.buzz';
var MEGA_DIRECT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function _megaDirectFetch(url, referer, xhr) {
  var headers = {
    'User-Agent': MEGA_DIRECT_UA,
    'Referer': referer || MEGA_DIRECT_ORIGIN + '/',
    'Accept': xhr ? 'application/json,*/*' : 'text/html,application/xhtml+xml,*/*'
  };
  if (xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(url, { headers: headers, timeoutMs: 20000 }).then(function (response) {
    var status = Number(response && response.status) || 0;
    if (status >= 400) throw new Error('MegaPlay HTTP ' + status + ' for ' + url);
    return response && response.body != null ? response.body : '';
  });
}

function _megaDirectJson(url, referer) {
  return _megaDirectFetch(url, referer, true).then(function (body) {
    var parsed = typeof body === 'string' ? JSON.parse(body || 'null') : body;
    if (!parsed || typeof parsed !== 'object') throw new Error('MegaPlay returned invalid source JSON');
    return parsed;
  });
}

function _megaDecodePayload(response) {
  if (!response || !response.enc) return response || null;
  try {
    var ciphertext = _b64urlBytes(response.enc);
    if (!ciphertext.length || ciphertext.length % 16 !== 0) {
      throw new Error('invalid AES ciphertext length');
    }
    var plaintext = _bytesToStr(_aesCbcDecrypt(
      ciphertext,
      _padBytes(MEGA_AES_KEY, 32),
      _padBytes(MEGA_AES_IV, 16)
    ));
    try {
      return JSON.parse(plaintext);
    } catch (parseError) {
      var raw = _trim(plaintext);
      return /^https?:\/\//i.test(raw) ? { file: raw } : null;
    }
  } catch (error) {
    console.warn('Zenkai MegaPlay AES decode failed:', String(error));
    return null;
  }
}

function _megaExtractFile(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') return /^https?:\/\//i.test(payload) ? payload : null;
  var direct = payload.file || payload.url;
  if (typeof direct === 'string' && /^https?:\/\//i.test(direct)) return direct;
  var sources = payload.sources;
  if (typeof sources === 'string') return /^https?:\/\//i.test(sources) ? sources : null;
  if (Array.isArray(sources)) {
    for (var i = 0; i < sources.length; i++) {
      var candidate = sources[i] && (sources[i].file || sources[i].url);
      if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
    }
    return null;
  }
  if (sources && typeof sources === 'object') {
    var source = sources.file || sources.url;
    if (typeof source === 'string' && /^https?:\/\//i.test(source)) return source;
  }
  return null;
}

function _megaSubtitles(payload, fallback) {
  var tracks = Array.isArray(payload && payload.tracks) ? payload.tracks :
    (Array.isArray(fallback && fallback.tracks) ? fallback.tracks : []);
  return tracks.filter(function (track) {
    if (!track || !(track.file || track.url)) return false;
    var kind = String(track.kind || '').toLowerCase();
    return kind !== 'thumbnail' && (!kind || kind === 'captions' || kind === 'subtitles');
  }).map(function (track) {
    var url = String(track.file || track.url);
    return {
      url: url,
      lang: String(track.label || track.language || 'Subtitle'),
      label: String(track.label || track.language || 'Subtitle'),
      format: /\.srt(?:[?#]|$)/i.test(url) ? 'srt' : 'vtt',
      default: !!track.default
    };
  });
}

function _resolveMegaDirect(anilistId, episode, audio, serverCode) {
  var id = Number(anilistId), ep = Number(episode);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(ep) || ep < 1) {
    return Promise.resolve(null);
  }
  var lang = audio === 'dub' ? 'dub' : 'sub';
  var code = serverCode === 'vidstream' ? 'vidstream' : 'bcdn';
  var pageUrl = MEGA_DIRECT_ORIGIN + '/stream/ani/' +
    encodeURIComponent(id) + '/' + encodeURIComponent(ep) + '/' +
    encodeURIComponent(lang) + '?s=' + encodeURIComponent(code);

  return _megaDirectFetch(pageUrl, MEGA_DIRECT_ORIGIN + '/', false).then(function (html) {
    var match = String(html || '').match(/data-id=["']([^"']+)["']/i);
    if (!match || !match[1]) throw new Error('MegaPlay player page did not contain data-id');
    var fileId = match[1];
    var sourceUrl = MEGA_DIRECT_ORIGIN + '/stream/getSources?id=' +
      encodeURIComponent(fileId) + '&s=' + encodeURIComponent(code);
    return _megaDirectJson(sourceUrl, pageUrl).then(function (response) {
      var payload = _megaDecodePayload(response);
      var streamUrl = _megaExtractFile(payload) || _megaExtractFile(response);
      if (!streamUrl) throw new Error('MegaPlay source response contained no media URL');
      var path = streamUrl.split(/[?#]/)[0].toLowerCase();
      var container = path.endsWith('.m3u8') ? 'hls' :
        path.endsWith('.mp4') ? 'mp4' : null;
      if (!container) throw new Error('MegaPlay returned an unsupported media URL');
      return {
        url: streamUrl,
        container: container,
        server: code === 'vidstream' ? 'VidStream' : 'MegaPlay',
        subtitles: _megaSubtitles(payload, response),
        headers: {
          'User-Agent': MEGA_DIRECT_UA,
          'Referer': MEGA_DIRECT_ORIGIN + '/',
          'Origin': MEGA_DIRECT_ORIGIN
        }
      };
    });
  });
}

function _directServerOrder(preferred) {
  if (preferred === 'megaplay') return ['bcdn'];
  if (preferred === 'vidstream') return ['vidstream'];
  // FlixCloud and ACDN use separate upstream resolvers. Until those can be
  // resolved natively without calling Zenkai's private /api/stream endpoint,
  // fall back to the two public AniList-ID resolvers and label the real server.
  return ['bcdn', 'vidstream'];
}

function _resolveAcdn(parsed, config) {
  var params = [
    'id=' + encodeURIComponent(parsed.anilistId),
    'ep=' + encodeURIComponent(parsed.episode),
    'server=acdn',
    'audio=' + encodeURIComponent(config.audio),
    'title=' + encodeURIComponent(parsed.title || '')
  ];
  if (parsed.format) params.push('format=' + encodeURIComponent(parsed.format));

  var embedUrl = buildEmbedUrl(parsed.anilistId, parsed.episode, 'acdn', config.audio);
  var requestUrl = 'https://zenkaii.pages.dev/api/stream?' + params.join('&');

  // Match the official Zenkai embed client's getJson() request. The upstream
  // handler recognizes X-Zenkai-Embed and invokes its ACDN multi-audio resolver.
  return fetch(requestUrl, {
    headers: {
      'Accept': 'application/json',
      'X-Zenkai-Embed': '1',
      'Referer': embedUrl || 'https://zenkaii.pages.dev/embed'
    },
    timeoutMs: 45000
  }).then(function (response) {
    var status = Number(response && response.status) || 0;
    var body = response && response.body != null ? response.body : '';
    var json = typeof body === 'string' ? JSON.parse(body || 'null') : body;

    if (status >= 400) {
      var reason = json && (json.error || json.message);
      throw new Error('Zenkai ACDN HTTP ' + status + (reason ? ': ' + reason : ''));
    }
    if (!json || json.success !== true || !json.streamUrl) {
      var message = json && (json.error || json.message);
      throw new Error(message || 'Zenkai ACDN returned no multi-audio stream');
    }

    var streamUrl = String(json.streamUrl);
    if (streamUrl.charAt(0) === '/') {
      streamUrl = 'https://zenkaii.pages.dev' + streamUrl;
    }
    if (!/^https:\/\//i.test(streamUrl)) {
      throw new Error('Zenkai ACDN returned an invalid stream URL');
    }

    // Zenkai currently returns a segment-proxy URL. Zangetsu's playback log
    // shows that this proxy serves the master playlist (HTTP 200) but times
    // out when the native player reads media data (FFmpeg -110). If the proxy
    // wraps a signed HTTPS playlist, expose that CDN URL first with its required
    // upstream Referer and retain the original proxy as a fallback.
    var directUrl = '';
    var directReferer = '';
    var directOrigin = '';
    try {
      var outerUrl = new URL(streamUrl);
      var nested = outerUrl.searchParams.get('url');
      if (nested) {
        var direct = new URL(nested);
        if (direct.protocol === 'https:' && direct.hostname !== outerUrl.hostname) {
          directUrl = direct.toString();
          directOrigin = direct.origin;
          var referer = outerUrl.searchParams.get('referer') || outerUrl.searchParams.get('ref');
          if (referer) {
            try {
              var parsedReferer = new URL(referer);
              if (parsedReferer.protocol === 'https:') directReferer = parsedReferer.toString();
            } catch (e) {}
          }
          if (!directReferer) directReferer = direct.origin + '/';
        }
      }
    } catch (e) {}

    var containerUrl = directUrl || streamUrl;
    var targetPath = String(containerUrl).split(/[?#]/)[0].toLowerCase();
    var container = /\.mp4$/i.test(targetPath) ? 'mp4' : 'hls';
    var subtitles = Array.isArray(json.subtitles) ? json.subtitles.map(function (subtitle) {
      var file = subtitle && (subtitle.file || subtitle.url);
      if (!file) return null;
      if (String(file).charAt(0) === '/') file = 'https://zenkaii.pages.dev' + file;
      return {
        url: String(file),
        lang: String(subtitle.label || subtitle.lang || 'Subtitle'),
        label: String(subtitle.label || subtitle.lang || 'Subtitle'),
        format: /\.srt(?:[?#]|$)/i.test(String(file)) ? 'srt' : 'vtt',
        default: !!subtitle.default
      };
    }).filter(Boolean) : [];

    var sources = [];
    if (directUrl && directUrl !== streamUrl) {
      sources.push({
        url: directUrl,
        quality: 'Auto',
        label: 'Zenkai Player · ACDN · Multi-audio · Direct CDN',
        container: container,
        kind: config.audio,
        audioLang: 'multi',
        headers: {
          'Referer': directReferer,
          'Origin': directOrigin,
          'User-Agent': MEGA_DIRECT_UA
        },
        subtitles: subtitles
      });
    }

    // Retain Zenkai's proxy as a fallback for hosts that reject direct requests
    // or require proxy-side segment rewriting.
    sources.push({
      url: streamUrl,
      quality: 'Auto',
      label: directUrl
        ? 'Zenkai Player · ACDN · Multi-audio · Proxy fallback'
        : 'Zenkai Player · ACDN · Multi-audio',
      container: container,
      kind: config.audio,
      audioLang: 'multi',
      headers: {
        'Referer': 'https://zenkaii.pages.dev/',
        'User-Agent': MEGA_DIRECT_UA
      },
      subtitles: subtitles
    });

    return sources;
  });
}
function _resolveDirectServers(parsed, config) {
  var order = _directServerOrder(config.server);
  function attempt(index) {
    if (index >= order.length) return Promise.resolve([]);
    return _resolveMegaDirect(parsed.anilistId, parsed.episode, config.audio, order[index])
      .then(function (resolved) {
        if (!resolved) return attempt(index + 1);
        var fallback = config.server !== 'megaplay' && config.server !== 'vidstream';
        var label = 'Zenkai Player · ' + resolved.server + ' · ' + config.audio.toUpperCase();
        if (fallback) label += ' · fallback from ' + config.server;
        return [{
          url: resolved.url,
          quality: 'Auto',
          label: label,
          container: resolved.container,
          kind: config.audio,
          audioLang: config.audio === 'dub' ? 'en' : 'ja',
          headers: resolved.headers,
          subtitles: resolved.subtitles
        }];
      }).catch(function (error) {
        console.warn('Zenkai direct server ' + order[index] + ' failed:', String(error));
        return attempt(index + 1);
      });
  }
  return attempt(0);
}

function getEmbedUrl(episodeUrl) {
  var parsed = _parseEpisode(episodeUrl);
  if (!parsed) return null;
  var config = _config();
  return buildEmbedUrl(parsed.anilistId, parsed.episode, config.server, config.audio);
}

function getVideoSources(episodeUrl, opts) {
  var parsed = _parseEpisode(episodeUrl);
  if (!parsed) return Promise.resolve([]);
  var config = _config();
  if (config.server === 'acdn') {
    return _resolveAcdn(parsed, config).catch(function (error) {
      console.warn('Zenkai ACDN playback failed:', String(error));
      return [];
    });
  }
  return _resolveDirectServers(parsed, config).catch(function (error) {
    console.warn('Zenkai native playback failed:', String(error));
    return [];
  });
}

function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.4.1',
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    popular: popular,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams,
    getLinks: getLinks,
    buildEmbedUrl: buildEmbedUrl,
    getEmbedUrl: getEmbedUrl,
    getServerAvailability: getServerAvailability,
    _config: _config,
    _parseAniListId: _parseAniListId,
    _parseEpisode: _parseEpisode,
    _episodeCount: _episodeCount,
    _normalizeAnimapMedia: _normalizeAnimapMedia,
    _debug: {
      reset: function () {
        ANIMAP_CACHE = {}; ANIMAP_INFLIGHT = {};
        ANILIST_CACHE = {}; ANILIST_INFLIGHT = {};
        ANILIST_QUEUE = Promise.resolve();
        ANILIST_NEXT_REQUEST_AT = 0; ANILIST_COOLDOWN_UNTIL = 0;
      },
      cooldownRemaining: function () { return Math.max(0, ANILIST_COOLDOWN_UNTIL - Date.now()); },
      minRequestInterval: ANILIST_MIN_INTERVAL_MS
    }
  };
}
