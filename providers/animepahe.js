// AnimePahe — ID-confirmed AnimePahe resolution with a Miruro/Kiwi playback fallback.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animepahe';
var SITE = 'https://animepahe.pw';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var DEFAULT_MIRURO_HOSTS = ['https://api.hiyori.tv', 'https://miruro.zenos.my.id', 'https://www.neoanime.tv'];
var MIRURO_PROVIDER_ORDER = ['kiwi', 'animepahe', 'arc', 'zoro', 'jet', 'bee', 'bonk', 'hop', 'pewe', 'ally', 'nun', 'bun', 'twin', 'cog', 'moo', 'sun', 'knob', 'telli'];
var CACHE = {};
var SESSIONS = {};

function getInfo() {
  return { name: 'AnimePahe', lang: 'en', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=animepahe.pw', type: 'anime', version: '1.0.4' };
}
function getSettings() {
  return [
    { key: 'audioMode', label: 'Audio tracks', description: 'Show both SUB and DUB when available, or filter to one track.', type: 'enum', default: 'both', options: [{ value: 'both', label: 'Sub and dub' }, { value: 'sub', label: 'Sub only' }, { value: 'dub', label: 'Dub only' }] },
    { key: 'miruroApiHosts', label: 'Playback fallback API hosts', description: 'Ordered Miruro JSON API hosts used if direct AnimePahe or Kwik requests are blocked. Comma or newline separated.', type: 'text', default: DEFAULT_MIRURO_HOSTS.join('\n') },
    { key: 'directTimeoutMs', label: 'Direct AnimePahe request timeout', description: 'Maximum wait for an individual direct request. The provider falls back to the API route when direct requests fail.', type: 'enum', default: '5000', options: [{ value: '3000', label: '3 seconds' }, { value: '5000', label: '5 seconds' }, { value: '8000', label: '8 seconds' }] },
    { key: 'directLookup', label: 'Try direct AnimePahe first', description: 'Attempt the direct, ID-confirmed AnimePahe player before using the configured Miruro/Kiwi playback fallback.', type: 'bool', default: true },
    { key: 'preferH264', label: 'Prefer H.264 over AV1', description: 'Prefer a compatible H.264 encode over AV1, especially useful on older TV hardware.', type: 'bool', default: true },
    { key: 'qualityPreference', label: 'Preferred resolution', description: 'Direct AnimePahe release selection preference.', type: 'enum', default: '1080p', options: [{ value: '1080p', label: '1080p' }, { value: '720p', label: '720p' }, { value: '480p', label: '480p' }, { value: '360p', label: '360p' }] },
    { key: 'maxTitleCandidates', label: 'Title candidates to confirm', description: 'Number of AnimePahe search matches checked against AniList or MAL IDs. Lower values are faster and reduce false matches.', type: 'enum', default: '3', options: [{ value: '1', label: '1 candidate' }, { value: '2', label: '2 candidates' }, { value: '3', label: '3 candidates' }] },
    { key: 'requestCacheSeconds', label: 'Metadata cache', description: 'Short in-memory cache for AniList metadata and episode catalogues.', type: 'enum', default: '120', options: [{ value: '0', label: 'Disabled' }, { value: '60', label: '1 minute' }, { value: '120', label: '2 minutes' }, { value: '300', label: '5 minutes' }] }
  ];
}

function _setting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.animepahe || {};
    return cfg[key] == null ? null : cfg[key];
  } catch (e) { return null; }
}
function _bool(value, fallback) {
  if (value == null) return fallback;
  if (value === true || String(value).toLowerCase() === 'true') return true;
  if (value === false || String(value).toLowerCase() === 'false') return false;
  return fallback;
}
function _int(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function _splitList(value) {
  return String(value == null ? '' : value).split(/[,\n;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}
function _normaliseHost(value) {
  var host = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(host)) return null;
  try {
    var parsed = new URL(host);
    if (!parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch (e) { return null; }
}
function _config() {
  var hosts = _splitList(_setting('miruroApiHosts') || DEFAULT_MIRURO_HOSTS.join('\n')).map(_normaliseHost).filter(Boolean);
  if (!hosts.length) hosts = DEFAULT_MIRURO_HOSTS.slice();
  hosts = hosts.filter(function (host, index) { return hosts.indexOf(host) === index; });
  return {
    audioMode: String(_setting('audioMode') || 'both').toLowerCase(),
    hosts: hosts,
    directTimeout: _int(_setting('directTimeoutMs'), 5000, 2000, 12000),
    directLookup: _bool(_setting('directLookup'), true),
    preferH264: _bool(_setting('preferH264'), true),
    quality: String(_setting('qualityPreference') || '1080p'),
    maxCandidates: _int(_setting('maxTitleCandidates'), 3, 1, 3),
    cacheMs: _int(_setting('requestCacheSeconds'), 120, 0, 300) * 1000
  };
}
function _responseBody(response) {
  var body = response && response.body != null ? response.body : '';
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') return JSON.stringify(body);
  return String(body || '');
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
function _fetch(url, options) {
  var opts = options || {};
  var headers = Object.assign({ 'User-Agent': UA, Accept: '*/*' }, opts.headers || {});
  return fetch(url, Object.assign({}, opts, { headers: headers, timeoutMs: opts.timeoutMs || _config().directTimeout })).then(function (response) {
    return _readResponse(response).then(function (body) {
      var status = Number(response && response.status || 0);
      if (status < 200 || status >= 300) {
        var error = new Error('HTTP ' + status + ' from ' + url);
        error.status = status;
        error.body = String(body || '').slice(0, 180);
        throw error;
      }
      return { status: status, body: body, headers: response && response.headers, url: response && response.url || url };
    });
  });
}
function _jsonFetch(url, options) {
  return _fetch(url, options).then(function (response) {
    try { return JSON.parse(_responseBody(response) || 'null'); }
    catch (e) { throw new Error('Invalid JSON from ' + url); }
  });
}
function _graph(query, variables) {
  return _fetch(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: query, variables: variables || {} }), timeoutMs: 10000 })
    .then(function (response) {
      var parsed;
      try { parsed = JSON.parse(_responseBody(response) || 'null'); }
      catch (e) { throw new Error('AniList returned invalid JSON'); }
      if (parsed && parsed.errors && parsed.errors.length) throw new Error('AniList: ' + String(parsed.errors[0].message || 'query failed'));
      return parsed && parsed.data || {};
    });
}
var MEDIA_FIELDS = 'id idMal title { english romaji native userPreferred } description(asHtml:false) coverImage { extraLarge large } bannerImage episodes status genres seasonYear averageScore isAdult synonyms';
function _cacheGet(key) {
  var entry = CACHE[key];
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.value;
}
function _cachePut(key, value, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return value;
  CACHE[key] = { value: value, expiresAt: Date.now() + ttlMs };
  var keys = Object.keys(CACHE);
  while (keys.length > 240) delete CACHE[keys.shift()];
  return value;
}
function _media(id) {
  var key = 'media:' + id;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  return _graph('query($id:Int){Media(id:$id,type:ANIME){' + MEDIA_FIELDS + '}}', { id: Number(id) }).then(function (data) {
    if (!data.Media) throw new Error('AniList title not found: ' + id);
    if (data.Media.isAdult) throw new Error('AnimePahe: adult title hidden');
    return _cachePut(key, data.Media, _config().cacheMs);
  });
}
function _title(media) {
  return media && media.title && (media.title.english || media.title.romaji || media.title.native || media.title.userPreferred) || 'Anime';
}
function _status(value) {
  var status = String(value || '').toUpperCase();
  if (status === 'FINISHED') return 'completed';
  if (status === 'RELEASING' || status === 'NOT_YET_RELEASED') return 'ongoing';
  if (status === 'CANCELLED') return 'cancelled';
  return 'unknown';
}
function _item(media) {
  if (!media || !media.id || media.isAdult) return null;
  return {
    id: 'animepahe://anime/' + media.id,
    url: 'animepahe://anime/' + media.id,
    title: _title(media) + (media.seasonYear ? ' (' + media.seasonYear + ')' : ''),
    englishTitle: media.title && media.title.english || null,
    nativeTitle: media.title && media.title.native || null,
    synonyms: Array.isArray(media.synonyms) ? media.synonyms : [],
    cover: media.coverImage && (media.coverImage.extraLarge || media.coverImage.large) || null,
    banner: media.bannerImage || null,
    description: media.description || '',
    malId: Number(media.idMal) || null,
    year: media.seasonYear != null ? String(media.seasonYear) : null,
    score: media.averageScore || null,
    genres: Array.isArray(media.genres) ? media.genres : [],
    status: _status(media.status),
    type: 'anime',
    sourceId: SOURCE_ID
  };
}
function _anilistPage(sort, page) {
  return _graph('query($page:Int){Page(page:$page,perPage:20){media(type:ANIME,sort:' + sort + ',isAdult:false){' + MEDIA_FIELDS + '}}}', { page: Math.max(1, _int(page, 1, 1, 100)) })
    .then(function (data) { return (data.Page && Array.isArray(data.Page.media) ? data.Page.media : []).map(_item).filter(Boolean); });
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _graph('query($search:String,$page:Int){Page(page:$page,perPage:20){media(search:$search,type:ANIME,sort:SEARCH_MATCH,isAdult:false){' + MEDIA_FIELDS + '}}}', { search: q, page: Math.max(1, _int(page, 1, 1, 100)) })
    .then(function (data) { return (data.Page && Array.isArray(data.Page.media) ? data.Page.media : []).map(_item).filter(Boolean); })
    .catch(function (error) { console.warn('AnimePahe search failed:', String(error)); return []; });
}
function getHome(opts) {
  return Promise.all([
    _anilistPage('TRENDING_DESC', 1).catch(function () { return []; }),
    _anilistPage('POPULARITY_DESC', 1).catch(function () { return []; })
  ]).then(function (rows) {
    return [
      { title: 'Trending Anime', items: rows[0] },
      { title: 'Popular Anime', items: rows[1] }
    ].filter(function (row) { return row.items.length; });
  });
}
function popular(opts) {
  return _anilistPage('POPULARITY_DESC', 1).catch(function () { return []; });
}
function _id(value) {
  var text = String(value || '');
  var match = text.match(/(?:animepahe:\/\/anime\/|\/)(\d+)(?:[/?#]|$)/) || text.match(/^(\d+)$/);
  if (!match) throw new Error('AnimePahe: invalid AniList ID');
  return Number(match[1]);
}
function _episodeUrl(id, number, category) {
  return 'animepahe://episode/' + encodeURIComponent(JSON.stringify({ id: Number(id), number: Number(number), category: category }));
}
function _episodeFromRow(id, number, category, row) {
  var url = _episodeUrl(id, number, category);
  return {
    id: url,
    url: url,
    number: number,
    title: row && row.title || ('Episode ' + number),
    thumbnail: row && (row.image || row.thumbnail || row.thumbnail_url) || null,
    date: row && (row.airDate || row.aired_on || row.aired || row.date) != null ? String(row.airDate || row.aired_on || row.aired || row.date) : null,
    description: row && typeof row.description === 'string' ? row.description : '',
    runtimeMinutes: row && row.duration != null && isFinite(Number(row.duration)) ? Math.max(1, Math.round(Number(row.duration) / 60)) : null,
    filler: !!(row && row.filler),
    type: 'anime',
    sourceId: SOURCE_ID,
    category: category
  };
}
function _unwrapMiruro(payload) {
  if (payload && payload.results && typeof payload.results === 'object') return payload.results;
  return payload || {};
}
function _episodesFromMiruro(id, payload) {
  var cfg = _config();
  var root = _unwrapMiruro(payload);
  var providers = root.providers || {};
  var groups = {};
  function add(category, row) {
    var number = Number(row && (row.number || row.episode || row.episode_number || row.ep));
    if (!(number > 0) || !isFinite(number)) return;
    if (cfg.audioMode !== 'both' && cfg.audioMode !== category) return;
    var key = category + '|' + number;
    var existing = groups[key];
    if (!existing) {
      groups[key] = _episodeFromRow(id, number, category, row);
      return;
    }
    if ((!existing.title || /^Episode \d+$/i.test(existing.title)) && row && row.title) existing.title = row.title;
    if (!existing.thumbnail) existing.thumbnail = row && (row.image || row.thumbnail || row.thumbnail_url) || null;
    if (!existing.date && row && (row.airDate || row.aired_on || row.aired || row.date) != null) existing.date = String(row.airDate || row.aired_on || row.aired || row.date);
    if (!existing.description && row && typeof row.description === 'string') existing.description = row.description;
  }
  Object.keys(providers).forEach(function (providerName) {
    var provider = providers[providerName] || {};
    var lists = provider.episodes || provider;
    ['sub', 'hsub', 'dub'].forEach(function (listName) {
      var rows = Array.isArray(lists[listName]) ? lists[listName] : [];
      var category = listName === 'dub' ? 'dub' : 'sub';
      rows.forEach(function (row) { add(category, row); });
    });
  });
  if (!Object.keys(groups).length) {
    var flat = Array.isArray(root.data) ? root.data : (Array.isArray(root.episodes) ? root.episodes : []);
    flat.forEach(function (row) {
      if (!row || row.kind && String(row.kind).toLowerCase() !== 'regular') return;
      var category = String(row.category || row.audio || 'sub').toLowerCase() === 'dub' ? 'dub' : 'sub';
      add(category, row);
    });
  }
  return Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) {
    return a.number - b.number || (a.category === 'sub' ? -1 : 1);
  });
}
function _fallbackEpisodeList(id, media) {
  var count = Math.max(0, Math.min(500, Number(media && media.episodes) || 0));
  var rows = [];
  if (_config().audioMode === 'dub') return rows;
  for (var number = 1; number <= count; number++) rows.push(_episodeFromRow(id, number, 'sub', null));
  return rows;
}
function _mirrorGet(path, index) {
  var hosts = _config().hosts;
  var hostIndex = index || 0;
  if (hostIndex >= hosts.length) return Promise.reject(new Error('All Miruro API hosts failed for ' + path));
  return _jsonFetch(hosts[hostIndex].replace(/\/+$/, '') + '/' + String(path).replace(/^\/+/, ''), { headers: { Accept: 'application/json' }, timeoutMs: 8000 })
    .catch(function (error) {
      console.warn('AnimePahe fallback API failed:', hosts[hostIndex], String(error));
      return _mirrorGet(path, hostIndex + 1);
    });
}
function _mirrorEpisodes(id, force) {
  var key = 'episodes:' + id;
  var cached = !force && _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  return _mirrorGet('episodes/' + encodeURIComponent(String(id))).then(function (payload) {
    var rows = _episodesFromMiruro(id, payload);
    if (!rows.length) throw new Error('Miruro did not return an episode catalogue for ' + id);
    return _cachePut(key, rows, _config().cacheMs);
  });
}
function getDetail(url, opts) {
  var id = _id(url);
  return Promise.all([
    _media(id),
    _mirrorEpisodes(id, opts && opts.forceRefresh).catch(function (error) { console.warn('AnimePahe episode catalogue unavailable:', String(error)); return []; })
  ]).then(function (results) {
    var media = results[0];
    var detail = _item(media);
    if (!detail) throw new Error('AnimePahe: adult title hidden');
    detail.episodes = results[1].length ? results[1] : _fallbackEpisodeList(id, media);
    detail.subCount = detail.episodes.filter(function (x) { return x.category === 'sub'; }).length;
    detail.dubCount = detail.episodes.filter(function (x) { return x.category === 'dub'; }).length;
    return detail;
  });
}
function getEpisodes(url, opts) {
  var id = _id(url);
  return Promise.all([
    _media(id),
    _mirrorEpisodes(id, opts && opts.forceRefresh).catch(function (error) { console.warn('AnimePahe episode lookup failed:', String(error)); return []; })
  ]).then(function (results) {
    return results[1].length ? results[1] : _fallbackEpisodeList(id, results[0]);
  });
}
function _decodeEpisode(value) {
  var text = String(value || '');
  var json = text.match(/^animepahe:\/\/episode\/(.+)$/i);
  if (json) {
    var parsed;
    try { parsed = JSON.parse(decodeURIComponent(json[1])); }
    catch (e) { throw new Error('AnimePahe: malformed episode data'); }
    if (parsed && Number(parsed.id) && Number(parsed.number) && ['sub', 'dub'].indexOf(parsed.category) >= 0) {
      return { id: Number(parsed.id), number: Number(parsed.number), category: parsed.category };
    }
    throw new Error('AnimePahe: incomplete episode data');
  }
  var simple = text.match(/^animepahe:\/\/episode\/(\d+)\/(\d+)\/(sub|dub)$/i);
  if (simple) return { id: Number(simple[1]), number: Number(simple[2]), category: simple[3].toLowerCase() };
  throw new Error('AnimePahe: invalid episode URL');
}
function _directHeaders(referer) {
  return { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: referer || SITE + '/' };
}
function _directGet(path, referer) {
  return _fetch(SITE + path, { headers: _directHeaders(referer), browser: true, timeoutMs: _config().directTimeout }).then(function (response) { return _responseBody(response); });
}
function _parseSearch(payload) {
  return (payload && Array.isArray(payload.data) ? payload.data : []).filter(function (row) { return row && row.session; }).map(function (row) {
    return { session: String(row.session), title: String(row.title || ''), episodes: Number(row.episodes) || 0 };
  });
}
function _parseIds(html) {
  var text = String(html || '');
  function metaId(name) {
    var patterns = [
      new RegExp('<meta\\b[^>]*\\bname=["\']' + name + '["\'][^>]*\\bcontent=["\'](\\d+)["\']', 'i'),
      new RegExp('<meta\\b[^>]*\\bcontent=["\'](\\d+)["\'][^>]*\\bname=["\']' + name + '["\']', 'i')
    ];
    for (var i = 0; i < patterns.length; i++) {
      var match = text.match(patterns[i]);
      if (match) return Number(match[1]) || 0;
    }
    return 0;
  }
  var anilist = Number((text.match(/anilist\.co\/anime\/(\d+)/i) || [])[1]) || metaId('anilist');
  var mal = Number((text.match(/myanimelist\.net\/anime\/(\d+)/i) || [])[1]) || metaId('mal');
  return { anilistId: anilist, malId: mal };
}
function _confirmedSession(media) {
  if (SESSIONS[media.id]) return Promise.resolve(SESSIONS[media.id]);
  var titles = [media.title && media.title.english, media.title && media.title.romaji, media.title && media.title.native, media.title && media.title.userPreferred].concat(media.synonyms || [])
    .map(function (title) { return String(title || '').trim(); })
    .filter(function (title) { return title; })
    .filter(function (title, index, list) { return list.indexOf(title) === index; });
  var titleIndex = 0;
  function nextTitle() {
    if (titleIndex >= titles.length) return Promise.reject(new Error('AnimePahe has no confirmed AniList/MAL match'));
    var title = titles[titleIndex++];
    return _directGet('/api?m=search&l=8&q=' + encodeURIComponent(title), SITE + '/').then(function (body) {
      var candidates = _parseSearch(JSON.parse(body || '{}')).slice(0, _config().maxCandidates);
      var candidateIndex = 0;
      function confirm() {
        if (candidateIndex >= candidates.length) return nextTitle();
        var candidate = candidates[candidateIndex++];
        return _directGet('/anime/' + candidate.session, SITE + '/').then(function (html) {
          var ids = _parseIds(html);
          if (ids.anilistId === Number(media.id) || (media.idMal && ids.malId === Number(media.idMal))) {
            SESSIONS[media.id] = candidate.session;
            return candidate.session;
          }
          return confirm();
        }).catch(function (error) {
          if (error && error.status === 403) throw error;
          return confirm();
        });
      }
      return confirm();
    }).catch(function (error) {
      if (error && error.status === 403) throw error;
      return nextTitle();
    });
  }
  return nextTitle();
}
function _parseRelease(body, episodeOffset) {
  var root = JSON.parse(body || '{}');
  var rows = Array.isArray(root.data) ? root.data : [];
  var numbered = [];
  rows.forEach(function (row) {
    var number = Number(row && row.episode);
    var session = String(row && row.session || '');
    var audio = String(row && row.audio || '').toLowerCase();
    if (number > 0 && session) numbered.push({ number: number, session: session, audio: audio });
  });
  var offset = episodeOffset;
  if (offset == null) {
    var minimum = numbered.length ? Math.min.apply(null, numbered.map(function (row) { return row.number; })) : 1;
    offset = Math.max(0, minimum - 1);
  }
  var episodes = {};
  var dubbed = {};
  numbered.forEach(function (row) {
    var number = row.number - offset;
    if (number > 0) {
      episodes[number] = row.session;
      if (row.audio && row.audio !== 'jpn') dubbed[number] = true;
    }
  });
  return {
    total: Number(root.total) || Object.keys(episodes).length,
    perPage: Number(root.per_page) || rows.length,
    lastPage: Number(root.last_page) || 1,
    offset: offset,
    episodes: episodes,
    dubbed: Object.keys(dubbed).map(Number)
  };
}
function _episodeSession(series, episode) {
  return _directGet('/api?m=release&id=' + encodeURIComponent(series) + '&sort=episode_asc&page=1', SITE + '/').then(function (body) {
    var first = _parseRelease(body);
    if (first.episodes[episode]) return first.episodes[episode];
    var guess = first.perPage > 0 ? Math.floor((episode - 1) / first.perPage) + 1 : 1;
    var pages = [];
    if (guess > 1 && guess <= first.lastPage) pages.push(guess);
    for (var page = 2; page <= Math.min(first.lastPage, 20); page++) if (page !== guess) pages.push(page);
    var pageIndex = 0;
    function nextPage() {
      if (pageIndex >= pages.length) return Promise.reject(new Error('AnimePahe episode session not found: ' + episode));
      var current = pages[pageIndex++];
      return _directGet('/api?m=release&id=' + encodeURIComponent(series) + '&sort=episode_asc&page=' + current, SITE + '/').then(function (pageBody) {
        var parsed = _parseRelease(pageBody, first.offset);
        return parsed.episodes[episode] || nextPage();
      });
    }
    return nextPage();
  });
}
function _attrs(source) {
  var attrs = {};
  String(source || '').replace(/([\w-]+)\s*=\s*(["'])(.*?)\2/g, function (_, key, quote, value) { attrs[key.toLowerCase()] = value; return _; });
  return attrs;
}
function _variants(html) {
  var variants = [];
  var re = /<button\b([^>]*\bdata-src\s*=[^>]*)>/gi;
  var match;
  while ((match = re.exec(String(html || ''))) !== null) {
    var attrs = _attrs(match[1]);
    var url = attrs['data-src'] || '';
    if (!/^https:\/\/(?:www\.)?kwik\./i.test(url)) continue;
    variants.push({
      url: url,
      fansub: attrs['data-fansub'] || 'Kwik',
      resolution: Number(attrs['data-resolution']) || 0,
      audio: String(attrs['data-audio'] || 'jpn').toLowerCase(),
      av1: attrs['data-av1'] === '1'
    });
  }
  return variants;
}
function _selectVariant(variants, category) {
  var dub = category === 'dub';
  var preference = parseInt(_config().quality, 10) || 1080;
  var rows = variants.filter(function (variant) { return (variant.audio !== 'jpn') === dub; });
  rows.sort(function (a, b) {
    var aEnglish = dub && a.audio === 'eng' ? 1 : 0;
    var bEnglish = dub && b.audio === 'eng' ? 1 : 0;
    if (aEnglish !== bEnglish) return bEnglish - aEnglish;
    if (_config().preferH264 && a.av1 !== b.av1) return a.av1 ? 1 : -1;
    var aDistance = Math.abs((a.resolution || 0) - preference);
    var bDistance = Math.abs((b.resolution || 0) - preference);
    return aDistance - bDistance;
  });
  return rows[0] || null;
}
function _decodeJsString(value) {
  return String(value || '').replace(/\\x([0-9a-f]{2})/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/\\u([0-9a-f]{4})/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/\\\//g, '/').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}
function _unpack(html) {
  var re = /eval\s*\(\s*function\s*\(p,a,c,k,e,d\)\s*\{[\s\S]*?\}\s*\(\s*(['"])((?:\\.|[^'"])*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])((?:\\.|[^'"])*?)\5\.split\(\s*(['"])\|\7\s*\)/g;
  var match = re.exec(String(html || ''));
  if (!match) return String(html || '');
  var packed = _decodeJsString(match[2]);
  var radix = Number(match[3]);
  var count = Number(match[4]);
  var dictionary = _decodeJsString(match[6]).split('|');
  for (var index = count - 1; index >= 0; index--) {
    if (!dictionary[index]) continue;
    packed = packed.replace(new RegExp('\\b' + index.toString(radix) + '\\b', 'g'), dictionary[index]);
  }
  return packed;
}
function _playlist(html) {
  var body = String(html || '');
  if (/eval\s*\(\s*function\s*\(p,a,c,k,e,d\)/.test(body)) body = _unpack(body);
  var match = body.match(/https?:\\?\/\\?\/[^"'<>\s]+?\.m3u8[^"'<>\s]*/i);
  return match ? match[0].replace(/\\+\//g, '/').replace(/&amp;/g, '&') : null;
}
function _origin(url) {
  var match = String(url || '').match(/^https:\/\/[^/]+/i);
  return match ? match[0] + '/' : SITE + '/';
}
function _directSources(media, episode) {
  return _confirmedSession(media).then(function (series) {
    return _episodeSession(series, episode.number).then(function (episodeSession) {
      return _directGet('/play/' + encodeURIComponent(series) + '/' + encodeURIComponent(episodeSession), SITE + '/');
    });
  }).then(function (html) {
    var chosen = _selectVariant(_variants(html), episode.category);
    if (!chosen && episode.category === 'dub') throw new Error('AnimePahe has no dub release for episode ' + episode.number);
    var embed = chosen && chosen.url;
    if (!embed) {
      var legacy = String(html).match(/let\s+url\s*=\s*["']([^"']+)["']/i);
      embed = legacy && legacy[1];
    }
    if (!embed) throw new Error('AnimePahe play page has no Kwik embed');
    return _fetch(embed, { headers: _directHeaders(SITE + '/'), browser: true, timeoutMs: _config().directTimeout }).then(function (response) {
      var playlist = _playlist(_responseBody(response));
      if (!playlist) throw new Error('Kwik player page has no M3U8 playlist');
      var referer = _origin(embed);
      var label = chosen ? chosen.fansub + ' ' + (chosen.resolution || 'Auto') + 'p' + (chosen.av1 ? ' AV1' : '') : 'Auto';
      return [{
        url: playlist,
        container: 'hls',
        type: 'hls',
        quality: label,
        label: label + ' · AnimePahe',
        kind: episode.category,
        audioLang: episode.category === 'dub' ? 'en' : 'ja',
        headers: { Referer: referer, 'User-Agent': UA },
        referer: referer,
        subtitles: [],
        isActive: true
      }];
    });
  });
}

function _mfRoot(value) {
  var root = value || {};
  for (var i = 0; i < 3 && root && typeof root === 'object' && !Array.isArray(root); i++) {
    if (root.results && typeof root.results === 'object' && !Array.isArray(root.results)) root = root.results;
    else if (root.data && typeof root.data === 'object' && !Array.isArray(root.data) && (root.data.providers || root.data.streams)) root = root.data;
    else break;
  }
  return root || {};
}
function _mfGet(host, path) {
  var url = String(host).replace(/\/+$/, '') + '/' + String(path).replace(/^\/+/, '');
  return fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, timeoutMs: 10000 }).then(function (response) {
    return _readResponse(response).then(function (body) {
      var status = Number(response && response.status || 0);
      if (status < 200 || status >= 300) throw new Error('HTTP ' + status + ' from ' + url);
      try { return JSON.parse(body || 'null'); }
      catch (e) { throw new Error('Invalid JSON from ' + url); }
    });
  });
}
function _mfOptions(payload, number, category) {
  var root = _mfRoot(payload);
  var providers = root.providers || {};
  var names = Object.keys(providers).sort(function (a, b) {
    var ai = MIRURO_PROVIDER_ORDER.indexOf(String(a).toLowerCase());
    var bi = MIRURO_PROVIDER_ORDER.indexOf(String(b).toLowerCase());
    if (ai < 0) ai = 999;
    if (bi < 0) bi = 999;
    return ai === bi ? a.localeCompare(b) : ai - bi;
  });
  var categories = category === 'dub' ? ['dub'] : ['sub', 'hsub'];
  var options = [];
  names.forEach(function (name) {
    var provider = providers[name] || {};
    var lists = provider.episodes || provider;
    categories.forEach(function (cat) {
      var rows = Array.isArray(lists[cat]) ? lists[cat] : [];
      rows.forEach(function (episode) {
        if (!episode || Number(episode.number || episode.episode || episode.ep) !== Number(number)) return;
        var id = String(episode.id || episode.url || '').trim();
        if (!id) return;
        if (/^https?:\/\//i.test(id)) { options.push({ provider: name, route: id, direct: true }); return; }
        id = id.replace(/^\/+/, '');
        if (id.indexOf('watch/') !== 0) return;
        options.push({ provider: name, route: id, direct: false, slug: id.split('/').pop() || '' });
      });
    });
  });
  var seen = {};
  return options.filter(function (option) {
    var key = option.provider + '|' + option.route;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}
function _mfStreams(payload, provider, category) {
  var root = _mfRoot(payload);
  var rows = Array.isArray(root) ? root : (Array.isArray(root.streams) ? root.streams : (root.bestStream && root.bestStream.url ? [root.bestStream].concat(root.streams || []) : (root.stream && root.stream.url ? [root.stream] : [])));
  var subtitles = Array.isArray(root.subtitles) ? root.subtitles : [];
  var streams = rows.map(function (row) {
    if (!row) return null;
    var url = String(row.url || row.file || '').trim();
    if (!/^https?:\/\//i.test(url)) return null;
    var type = String(row.type || row.format || '').toLowerCase();
    if (type === 'embed') return null;
    var headers = {};
    if (row.headers && typeof row.headers === 'object') Object.keys(row.headers).forEach(function (key) { headers[key] = String(row.headers[key]); });
    var referer = row.referer || row.referrer || null;
    if (referer && !headers.Referer && !headers.referer) headers.Referer = String(referer);
    var container = type === 'dash' || /\.mpd(?:[?#]|$)/i.test(url) ? 'dash' : (type === 'hls' || /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : (type === 'mp4' || /\.mp4(?:[?#]|$)/i.test(url) ? 'mp4' : undefined));
    var label = String(row.quality || row.label || row.name || 'Auto');
    return {
      url: url,
      container: container,
      type: row.type || row.format || container,
      quality: label,
      label: label + ' · Miruro (' + provider + ')',
      kind: category,
      audioLang: category === 'dub' ? 'en' : 'ja',
      headers: headers,
      referer: referer || undefined,
      subtitles: []
    };
  }).filter(Boolean);
  if (streams.length && subtitles.length) {
    streams[0].subtitles = subtitles.map(function (sub) {
      if (!sub) return null;
      var url = String(sub.url || sub.file || '');
      if (!/^https?:\/\//i.test(url)) return null;
      return { url: url, label: sub.label || sub.title || sub.language || 'Subtitle', lang: sub.language || sub.lang || '', format: sub.format || 'vtt' };
    }).filter(Boolean);
  }
  var seen = {};
  return streams.filter(function (stream) {
    if (seen[stream.url]) return false;
    seen[stream.url] = true;
    return true;
  });
}
function _miruroFallback(id, number, category, label, hostOverride) {
  var hosts = (Array.isArray(hostOverride) && hostOverride.length ? hostOverride.slice() : DEFAULT_MIRURO_HOSTS.slice()).map(function (host) { return host.replace(/\/+$/, ''); });
  var lastError = null;
  var options = null;
  function loadOptions(index) {
    if (options) return Promise.resolve(options);
    if (index >= hosts.length) return Promise.reject(lastError || new Error(label + ': no Miruro host responded'));
    return _mfGet(hosts[index], 'episodes/' + encodeURIComponent(String(id))).then(function (payload) {
      var found = _mfOptions(payload, number, category);
      if (!found.length) throw new Error(label + ': Miruro has no provider episode for ' + number + ' (' + category + ')');
      options = found;
      return options;
    }).catch(function (error) {
      lastError = error;
      return loadOptions(index + 1);
    });
  }
  function tryHost(index, foundOptions) {
    if (index >= hosts.length) return Promise.reject(lastError || new Error(label + ': no playable Miruro provider'));
    var host = hosts[index];
    function tryOption(optionIndex) {
      if (optionIndex >= foundOptions.length) return Promise.reject(lastError || new Error(label + ': no playable Miruro provider'));
      var option = foundOptions[optionIndex];
      if (option.direct) {
        var directType = /\.m3u8/i.test(option.route) ? 'hls' : (/\.mpd/i.test(option.route) ? 'dash' : 'mp4');
        return Promise.resolve([{ url: option.route, container: directType, type: directType, quality: 'Auto', label: 'Miruro direct (' + option.provider + ')', kind: category, audioLang: category === 'dub' ? 'en' : 'ja', headers: {}, subtitles: [] }]);
      }
      var routes = [
        option.route,
        'stream?provider=' + encodeURIComponent(option.provider) + '&anilistId=' + encodeURIComponent(String(id)) + '&category=' + encodeURIComponent(category) + '&slug=' + encodeURIComponent(option.slug),
        'sources?episodeId=' + encodeURIComponent(option.route) + '&provider=' + encodeURIComponent(option.provider) + '&anilistId=' + encodeURIComponent(String(id)) + '&category=' + encodeURIComponent(category)
      ];
      function tryRoute(routeIndex) {
        if (routeIndex >= routes.length) return Promise.reject(lastError || new Error('Miruro route failed: ' + option.provider));
        return _mfGet(host, routes[routeIndex]).then(function (payload) {
          var streams = _mfStreams(payload, option.provider, category);
          if (!streams.length) throw new Error('No streams from ' + option.provider);
          return streams;
        }).catch(function (error) {
          lastError = error;
          return tryRoute(routeIndex + 1);
        });
      }
      return tryRoute(0).catch(function (error) {
        lastError = error;
        return tryOption(optionIndex + 1);
      });
    }
    return tryOption(0).catch(function (error) {
      lastError = error;
      return tryHost(index + 1, foundOptions);
    });
  }
  return loadOptions(0).then(function (foundOptions) { return tryHost(0, foundOptions); });
}
function _mirrorStreams(episode) {
  return _miruroFallback(episode.id, episode.number, episode.category, 'AnimePahe', _config().hosts);
}
function getVideoSources(url, opts) {
  var episode = _decodeEpisode(url);
  return _media(episode.id).then(function (media) {
    var direct = _config().directLookup ? _directSources(media, episode) : Promise.reject(new Error('Direct AnimePahe disabled'));
    return direct.catch(function (error) {
      delete SESSIONS[episode.id];
      console.warn('AnimePahe direct resolution failed; trying Miruro/Kiwi:', String(error));
      return _mirrorStreams(episode);
    });
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.4', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _config: _config, _parseIds: _parseIds, _parseSearch: _parseSearch, _parseRelease: _parseRelease,
    _variants: _variants, _selectVariant: _selectVariant, _unpack: _unpack, _playlist: _playlist,
    _episodesFromMiruro: _episodesFromMiruro, _fallbackEpisodeList: _fallbackEpisodeList,
    _decodeEpisode: _decodeEpisode, _miruroFallback: _miruroFallback
  };
}
