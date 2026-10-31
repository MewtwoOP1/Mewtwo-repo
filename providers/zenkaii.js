// Zenkai Player — AniList catalogue + Zenkaii's hosted player embed.
// Important: Zenkaii's documented endpoint is an HTML iframe player, not a
// direct HLS/MP4 URL. This provider exposes the embed URL as an unknown source;
// the consuming app must support opening web-player URLs to play it.

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
    version: '1.1.0'
  };
}

function getSettings() {
  return [
    {
      key: 'server',
      label: 'Zenkai Player server',
      description: 'Preferred Zenkai player server. The embed player can fail over when a source is unavailable.',
      type: 'enum',
      default: 'megaplay',
      options: [
        { value: 'megaplay', label: 'MegaPlay (HD-1)' },
        { value: 'vidstream', label: 'VidStream (HD-2)' },
        { value: 'flixcloud', label: 'FlixCloud' },
        { value: 'acdn', label: 'ACDN (multi-audio HLS)' }
      ]
    },
    {
      key: 'audio',
      label: 'Preferred audio',
      description: 'SUB uses the original audio with subtitles. DUB selects the English dub when the title has one.',
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
  var waitMs = ANILIST_DEFAULT_COOLDOWN_MS;
  var retryAfter = parseFloat(_header(response, 'retry-after'));
  if (isFinite(retryAfter) && retryAfter > 0) waitMs = Math.max(waitMs, retryAfter * 1000);
  var resetAt = Number(_header(response, 'x-ratelimit-reset'));
  if (isFinite(resetAt) && resetAt > Date.now() / 1000) {
    waitMs = Math.max(waitMs, resetAt * 1000 - Date.now());
  }
  var message = String(error || '');
  var hostWait = message.match(/AniListRateLimited\((\d+)s\)/i);
  if (hostWait) waitMs = Math.max(waitMs, Number(hostWait[1]) * 1000);
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
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: query, variables: variables || {} }),
        timeoutMs: 15000
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
          if (tooMany) _markAniListRateLimit(response, 'GraphQL 429');
          throw new Error('AniList GraphQL error: ' + String(json.errors[0].message || 'unknown error'));
        }
        return json.data || {};
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
  'studios { nodes { name } }'
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

function _animapFallbackItem(mapping, id) {
  var titles = Array.isArray(mapping && mapping.titles) ? mapping.titles : [];
  var title = _trim(titles[0] || mapping && mapping.title || '');
  if (!title) return null;
  var malId = Number(mapping && mapping.mal_id);
  var year = Number(mapping && mapping.year) || null;
  var url = 'anilist://' + String(id);
  var item = {
    id: url,
    url: url,
    title: year ? title + ' (' + year + ')' : title,
    cover: null,
    banner: null,
    type: 'anime',
    sourceId: SOURCE_ID,
    anilistId: Number(id)
  };
  if (isFinite(malId) && malId > 0) item.malId = malId;
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
    var pageRows = mapped.slice(start, start + 20);
    return _mapLimit(pageRows, 4, function (entry) {
      return _animapMedia(entry.id).then(function (media) {
        var item = _mediaItem(media);
        if (item) {
          if (!item.malId && Number(entry.mapping.mal_id) > 0) item.malId = Number(entry.mapping.mal_id);
          return item;
        }
        return _animapFallbackItem(entry.mapping, entry.id);
      }).catch(function () {
        return _animapFallbackItem(entry.mapping, entry.id);
      });
    }).then(function (items) {
      return items.filter(Boolean);
    });
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
  if (q.length < 1) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  return _animapSearch(q, p).then(function (items) {
    if (items.length) return items;
    return _aniListSearch(q, p);
  }).catch(function (error) {
    console.warn('Zenkai metadata search fallback:', String(error));
    return _aniListSearch(q, p).catch(function (fallbackError) {
      console.warn('Zenkai Player search failed:', String(fallbackError));
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

function _episodeUrl(anilistId, episode, title) {
  return JSON.stringify({
    provider: 'zenkaii',
    anilistId: Number(anilistId),
    episode: Number(episode),
    title: String(title || '')
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
  for (var ep = 1; ep <= count; ep++) {
    out.push({
      id: String(ep),
      title: title + ' · Episode ' + ep,
      number: ep,
      url: _episodeUrl(id, ep, title)
    });
  }
  return out;
}

function _mergeAnimapFallbacks(media, mal, raw) {
  var merged = {};
  Object.keys(media || {}).forEach(function (key) { merged[key] = media[key]; });
  if (!(Number(merged.episodes) > 0) && mal && Number(mal.episodes) > 0) {
    merged.episodes = Number(mal.episodes);
  }
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
  if (raw && raw.nextAiringEpisode) merged.nextAiringEpisode = raw.nextAiringEpisode;
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
  return {
    id: 'anilist://' + Number(media.id),
    url: 'anilist://' + Number(media.id),
    title: item.title.replace(/\s+\(\d{4}\)$/, ''),
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
}

function _animapDetail(id) {
  return _animapMedia(id).then(function (media) {
    if (!media) return null;
    var needsFallback = !(Number(media.episodes) > 0) &&
      String(media.format || '').toUpperCase() !== 'MOVIE';
    if (!needsFallback) return _detailFromMedia(media);
    var malId = Number(media.idMal);
    var jobs = [
      malId > 0 ? _animapMal(malId).catch(function () { return null; }) : Promise.resolve(null),
      _animapRaw(id).catch(function () { return null; })
    ];
    return Promise.all(jobs).then(function (results) {
      return _detailFromMedia(_mergeAnimapFallbacks(media, results[0], results[1]));
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
    return _aniListDetail(id);
  }).catch(function (error) {
    console.warn('Zenkai metadata lookup fallback:', String(error));
    return _aniListDetail(id).catch(function (fallbackError) {
      console.warn('Zenkai Player detail failed:', String(fallbackError));
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
  return { anilistId: id, episode: ep, title: _trim(item.title || '') };
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

function getVideoSources(episodeUrl, opts) {
  var parsed = _parseEpisode(episodeUrl);
  if (!parsed) return Promise.resolve([]);
  var config = _config();
  var embedUrl = buildEmbedUrl(parsed.anilistId, parsed.episode, config.server, config.audio);
  if (!embedUrl) return Promise.resolve([]);
  var isDub = config.audio === 'dub';
  return Promise.resolve([{
    url: embedUrl,
    quality: 'Auto',
    label: 'Zenkai Player · ' + config.server + ' · ' + config.audio.toUpperCase(),
    container: 'unknown',
    kind: config.audio,
    audioLang: isDub ? 'en' : 'ja'
  }]);
}

function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.1.0',
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
