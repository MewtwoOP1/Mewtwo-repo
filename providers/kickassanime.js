// KickAssAnime — AniList catalogue with direct multi-audio HLS from kaa.lt.
// Show/episode data comes from KAA's JSON API and playback comes from its native
// VidStreaming server on the krussdomi CDN. No embed player is required.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'kickassanime';
var SITE = 'https://kaa.lt';
var API = SITE + '/api';
var ANILIST = 'https://graphql.anilist.co';
var HLS_BASE = 'https://hls.krussdomi.com/manifest';
var PLAYER_ORIGIN = 'https://krussdomi.com';
var ORIGINAL_LOCALE = 'ja-JP';
var DUB_LOCALE = 'en-US';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
var CACHE = {};

function getInfo() {
  return { name: 'KickAssAnime', lang: 'en', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=kaa.lt', type: 'anime', version: '1.0.2' };
}
function getSettings() {
  return [
    { key: 'audioMode', label: 'Audio tracks', description: 'Show both Japanese and English audio tracks when available, or filter to one.', type: 'enum', default: 'both', options: [{ value: 'both', label: 'Sub and dub' }, { value: 'sub', label: 'Sub only' }, { value: 'dub', label: 'Dub only' }] },
    { key: 'homeSections', label: 'Home sections', description: 'Comma-separated AniList sections: trending, popular, top.', type: 'text', default: 'trending,popular' },
    { key: 'requestTimeoutMs', label: 'Request timeout', description: 'Maximum wait for an individual AniList or KAA request.', type: 'enum', default: '10000', options: [{ value: '6000', label: '6 seconds' }, { value: '10000', label: '10 seconds' }, { value: '15000', label: '15 seconds' }] },
    { key: 'showAdult', label: 'Show adult catalogue entries', description: 'Include adult entries returned by AniList. Disabled by default.', type: 'bool', default: false }
  ];
}

function _setting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.kickassanime || {};
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
function _config() {
  return {
    audioMode: String(_setting('audioMode') || 'both').toLowerCase(),
    sections: _splitList(_setting('homeSections') || 'trending,popular').map(function (x) { return x.toLowerCase(); }),
    timeoutMs: _int(_setting('requestTimeoutMs'), 10000, 3000, 30000),
    showAdult: _bool(_setting('showAdult'), false)
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
  while (keys.length > 180) delete CACHE[keys.shift()];
  return value;
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
  var headers = Object.assign({ 'User-Agent': UA, Accept: 'application/json,text/html,*/*' }, opts.headers || {});
  return fetch(url, Object.assign({}, opts, { headers: headers, timeoutMs: opts.timeoutMs || _config().timeoutMs })).then(function (response) {
    return _readResponse(response).then(function (body) {
      var status = Number(response && response.status || 0);
      if (status < 200 || status >= 300) {
        var error = new Error('KickAssAnime HTTP ' + status + ' for ' + url);
        error.status = status;
        error.body = String(body || '').slice(0, 180);
        throw error;
      }
      return { status: status, body: body, headers: response && response.headers, url: response && response.url || url };
    });
  });
}
function _json(url, options) {
  return _fetch(url, options).then(function (response) {
    try { return JSON.parse(_responseBody(response) || 'null'); }
    catch (e) { throw new Error('KickAssAnime returned invalid JSON for ' + url); }
  });
}
function _graph(query, variables) {
  return _fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: query, variables: variables || {} })
  }).then(function (response) {
    var parsed;
    try { parsed = JSON.parse(_responseBody(response) || 'null'); }
    catch (e) { throw new Error('AniList returned invalid JSON'); }
    if (parsed && parsed.errors && parsed.errors.length) throw new Error('AniList: ' + String(parsed.errors[0].message || 'query failed'));
    return parsed && parsed.data || {};
  });
}

var MEDIA_FIELDS = 'id idMal title { english romaji native userPreferred } description(asHtml:false) coverImage { extraLarge large } bannerImage episodes status format genres seasonYear averageScore isAdult synonyms';
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
  var cfg = _config();
  if (!media || !media.id || media.isAdult && !cfg.showAdult) return null;
  // Reuse the AniList row returned by search/home in the following detail call.
  _cachePut('media:' + media.id, media, 120000);
  return {
    id: 'kaa://anime/' + media.id,
    url: 'kaa://anime/' + media.id,
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
function _page(sort, page) {
  var cfg = _config();
  return _graph('query($page:Int){Page(page:$page,perPage:20){media(type:ANIME,sort:' + sort + ',isAdult:' + (cfg.showAdult ? 'true' : 'false') + '){' + MEDIA_FIELDS + '}}}', { page: Math.max(1, _int(page, 1, 1, 100)) })
    .then(function (data) { return (data.Page && Array.isArray(data.Page.media) ? data.Page.media : []).map(_item).filter(Boolean); });
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _graph('query($search:String,$page:Int){Page(page:$page,perPage:20){media(search:$search,type:ANIME,sort:SEARCH_MATCH,isAdult:' + (_config().showAdult ? 'true' : 'false') + '){' + MEDIA_FIELDS + '}}}', { search: q, page: Math.max(1, _int(page, 1, 1, 100)) })
    .then(function (data) { return (data.Page && Array.isArray(data.Page.media) ? data.Page.media : []).map(_item).filter(Boolean); })
    .catch(function (error) { console.warn('KickAssAnime search failed:', String(error)); return []; });
}
function getHome(opts) {
  var allowed = { trending: 'TRENDING_DESC', popular: 'POPULARITY_DESC', top: 'SCORE_DESC' };
  var sections = _config().sections;
  var jobs = sections.filter(function (name, index) { return allowed[name] && sections.indexOf(name) === index; }).map(function (name) {
    return _page(allowed[name], 1).then(function (items) {
      return items.length ? { title: name.charAt(0).toUpperCase() + name.slice(1) + ' Anime', items: items } : null;
    }).catch(function (error) { console.warn('KickAssAnime home section failed:', name, String(error)); return null; });
  });
  return Promise.all(jobs).then(function (rows) { return rows.filter(Boolean); });
}
function popular(opts) {
  return _page('POPULARITY_DESC', 1).catch(function () { return []; });
}
function _id(value) {
  var text = String(value || '');
  var match = text.match(/(?:kaa:\/\/anime\/|\/)(\d+)(?:[/?#]|$)/) || text.match(/^(\d+)$/);
  if (!match) throw new Error('KickAssAnime: invalid AniList ID');
  return Number(match[1]);
}
function _media(id) {
  var key = 'media:' + id;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  return _graph('query($id:Int){Media(id:$id,type:ANIME){' + MEDIA_FIELDS + '}}', { id: Number(id) }).then(function (data) {
    if (!data.Media) throw new Error('AniList title not found: ' + id);
    if (data.Media.isAdult && !_config().showAdult) throw new Error('KickAssAnime: adult title hidden by settings');
    return _cachePut(key, data.Media, 120000);
  });
}

function _normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function _titleScore(query, candidate) {
  var a = _normalize(query);
  var b = _normalize(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 0.86;
  if (a.length < 2 || b.length < 2) return 0;
  var counts = {};
  var i;
  for (i = 0; i < a.length - 1; i++) {
    var pair = a.slice(i, i + 2);
    counts[pair] = (counts[pair] || 0) + 1;
  }
  var hits = 0;
  for (i = 0; i < b.length - 1; i++) {
    var other = b.slice(i, i + 2);
    var remaining = counts[other] || 0;
    if (remaining > 0) { hits++; counts[other] = remaining - 1; }
  }
  return (2 * hits) / ((a.length - 1) + (b.length - 1));
}
function _titleSelectionScore(query, candidate) {
  var a = _normalize(query);
  var b = _normalize(candidate);
  var similarity = _titleScore(query, candidate);
  if (!a || !b || a === b) return similarity;
  var ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return similarity * (0.6 + 0.4 * ratio);
}
function _seasonNumber(value) {
  var title = String(value || '');
  var match = title.match(/\bseason\s*0*(\d+)\b/i) || title.match(/\b0*(\d+)(?:st|nd|rd|th)\s+season\b/i);
  if (match) return Number(match[1]);
  match = title.trim().match(/\b(II|III|IV|V|VI)\s*$/i);
  if (match) return { II: 2, III: 3, IV: 4, V: 5, VI: 6 }[match[1].toUpperCase()] || null;
  match = title.trim().match(/\s([2-9])\s*$/);
  if (match) {
    var prefix = title.trim().slice(0, title.trim().length - match[0].length).trim();
    if (!/[.#]$/.test(prefix)) return Number(match[1]);
  }
  return null;
}
function _mediaTitles(media) {
  var title = media && media.title || {};
  return [title.english, title.romaji, title.native, title.userPreferred]
    .concat(Array.isArray(media && media.synonyms) ? media.synonyms : [])
    .map(function (x) { return String(x || '').trim(); }).filter(Boolean);
}
function _candidateTitles(row) {
  var out = [];
  Object.keys(row || {}).forEach(function (key) {
    if (!/^title|^name$|^english|^romaji|^native/i.test(key)) return;
    var value = row[key];
    if (typeof value === 'string' && value.trim()) out.push(value.trim());
  });
  return out;
}
function _candidate(row) {
  if (!row || typeof row !== 'object') return null;
  var slug = String(row.slug || '').trim();
  if (!slug) return null;
  var titles = _candidateTitles(row);
  if (!titles.length) titles.push(slug);
  return {
    slug: slug,
    title: titles[0],
    titles: titles,
    locales: Array.isArray(row.locales) ? row.locales.map(String) : [],
    year: Number(row.year) || null,
    type: String(row.type || '').toLowerCase()
  };
}
function _searchKaa(query) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var key = 'kaa-search:' + q.toLowerCase();
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  return _json(API + '/fsearch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Referer: SITE + '/' },
    body: JSON.stringify({ query: q })
  }).then(function (root) {
    var rows = root && Array.isArray(root.result) ? root.result : [];
    return _cachePut(key, rows.map(_candidate).filter(Boolean), 120000);
  }).catch(function () { return []; });
}
function _candidateScore(media, candidate) {
  var titles = _mediaTitles(media);
  var score = 0;
  titles.forEach(function (title) {
    candidate.titles.forEach(function (other) { score = Math.max(score, _titleSelectionScore(title, other)); });
  });
  if (media && media.seasonYear && candidate.year) score *= media.seasonYear === candidate.year ? 1.15 : 0.55;
  var expected = String(media && media.format || '').toLowerCase();
  var actual = String(candidate.type || '').toLowerCase();
  if (expected && actual) {
    var compatible = expected === actual || (expected.indexOf('tv') === 0 && actual === 'tv');
    if (!compatible) score *= 0.7;
  }
  var expectedSeason = null;
  titles.some(function (title) { expectedSeason = _seasonNumber(title); return expectedSeason != null; });
  var actualSeason = null;
  candidate.titles.some(function (title) { actualSeason = _seasonNumber(title); return actualSeason != null; });
  if (expectedSeason && actualSeason && expectedSeason !== actualSeason) score *= 0.45;
  return Math.max(0, Math.min(1, score));
}
function _resolveShow(media) {
  var key = 'show:' + media.id;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  var titles = [], seenTitles = {};
  _mediaTitles(media).forEach(function (title) {
    var normalized = _normalize(title);
    if (!normalized || seenTitles[normalized] || titles.length >= 3) return;
    seenTitles[normalized] = true;
    titles.push(title);
  });
  if (!titles.length) throw new Error('KickAssAnime title match was too weak');
  var rows = [], seenRows = {};
  function choose() {
    var chosen = null;
    var best = -1;
    rows.forEach(function (row) {
      var score = _candidateScore(media, row);
      if (score > best) { best = score; chosen = row; }
    });
    return { chosen: chosen, best: best };
  }
  function collect(group) {
    (group || []).forEach(function (row) {
      if (!seenRows[row.slug]) { seenRows[row.slug] = true; rows.push(row); }
    });
  }
  function attempt(index) {
    return _searchKaa(titles[index]).then(function (group) {
      collect(group);
      var match = choose();
      // A confident first-title match does not need the remaining aliases.
      if (match.chosen && match.best >= 0.72) return match;
      if (index + 1 >= titles.length) return match;
      return attempt(index + 1);
    });
  }
  return attempt(0).then(function (match) {
    if (!match.chosen || match.best < 0.28) throw new Error('KickAssAnime title match was too weak');
    return _cachePut(key, match.chosen, 300000);
  });
}
function _episodesUrl(slug, episode, locale) {
  return API + '/show/' + encodeURIComponent(slug) + '/episodes?ep=' + encodeURIComponent(String(episode)) + '&lang=' + encodeURIComponent(locale);
}
function _episodePage(slug, episode, locale) {
  var key = 'page:' + slug + ':' + episode + ':' + locale;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  return _json(_episodesUrl(slug, episode, locale), { headers: { Referer: SITE + '/' } })
    .then(function (root) { return _cachePut(key, root, 60000); });
}
function _episodeNumbers(root) {
  var out = {}, has = false;
  var pages = root && Array.isArray(root.pages) ? root.pages : [];
  pages.forEach(function (page) {
    var eps = page && Array.isArray(page.eps) ? page.eps : [];
    eps.forEach(function (value) {
      var number = Number(value);
      if (isFinite(number) && number > 0) { out[number] = true; has = true; }
    });
  });
  if (!has) {
    (root && Array.isArray(root.result) ? root.result : []).forEach(function (row) {
      var number = Number(row && row.episode_number);
      if (isFinite(number) && number > 0) out[number] = true;
    });
  }
  return Object.keys(out).map(Number).sort(function (a, b) { return a - b; });
}
function _episodeTitles(root) {
  var map = {};
  (root && Array.isArray(root.result) ? root.result : []).forEach(function (row) {
    var number = Number(row && row.episode_number);
    if (!isFinite(number)) return;
    var title = String(row && row.title || '').trim();
    if (title) map[number] = title;
  });
  return map;
}
function _episodeRow(root, number) {
  return (root && Array.isArray(root.result) ? root.result : []).filter(function (row) {
    return Number(row && row.episode_number) === Number(number);
  })[0] || null;
}
function _availability(show) {
  var key = 'episodes:' + show.slug;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  var locales = show.locales || [];
  var subPromise = locales.length && locales.indexOf(ORIGINAL_LOCALE) < 0
    ? Promise.resolve(null)
    : _episodePage(show.slug, 1, ORIGINAL_LOCALE).catch(function () { return null; });
  var dubPromise = locales.indexOf(DUB_LOCALE) < 0
    ? Promise.resolve(null)
    : _episodePage(show.slug, 1, DUB_LOCALE).catch(function () { return null; });
  return Promise.all([subPromise, dubPromise]).then(function (pages) {
    var subPage = pages[0];
    var dubPage = pages[1];
    var sub = subPage ? _episodeNumbers(subPage) : [];
    var dub = dubPage ? _episodeNumbers(dubPage) : [];
    if (!sub.length && !dub.length) throw new Error('KickAssAnime returned no episodes for this title');
    return _cachePut(key, {
      sub: sub,
      dub: dub,
      subTitles: subPage ? _episodeTitles(subPage) : {},
      dubTitles: dubPage ? _episodeTitles(dubPage) : {}
    }, 120000);
  });
}
function _episodeUrl(anilistId, slug, number, category) {
  return 'kaa://episode/' + [anilistId, encodeURIComponent(slug), number, category].join('/');
}
function _episode(anilistId, slug, number, category, title) {
  var url = _episodeUrl(anilistId, slug, number, category);
  return {
    id: url, url: url, number: number,
    title: title ? 'Episode ' + number + ': ' + title : 'Episode ' + number,
    category: category, sourceId: SOURCE_ID, type: 'anime'
  };
}
function _episodeItems(anilistId, show, availability) {
  var cfg = _config();
  var numbers = Array.from(new Set(availability.sub.concat(availability.dub))).sort(function (a, b) { return a - b; });
  var sub = {}, dub = {};
  availability.sub.forEach(function (n) { sub[n] = true; });
  availability.dub.forEach(function (n) { dub[n] = true; });
  var audio = cfg.audioMode;
  if (audio === 'sub' && availability.sub.length === 0) audio = 'dub';
  if (audio === 'dub' && availability.dub.length === 0) audio = 'sub';
  // One row per episode number. When both audio tracks exist the row covers
  // both and playback exposes each as its own stream; this keeps the episode
  // list from doubling every episode into a SUB row and a DUB row.
  var episodes = [];
  numbers.forEach(function (number) {
    var hasSub = !!sub[number];
    var hasDub = !!dub[number];
    var category;
    if (audio === 'sub') { if (!hasSub) return; category = 'sub'; }
    else if (audio === 'dub') { if (!hasDub) return; category = 'dub'; }
    else {
      if (!hasSub && !hasDub) return;
      category = hasSub && hasDub ? 'both' : (hasSub ? 'sub' : 'dub');
    }
    var title = (category === 'sub' ? availability.subTitles[number] : '') ||
                (category === 'dub' ? availability.dubTitles[number] : '') ||
                (availability.subTitles[number] || availability.dubTitles[number]);
    episodes.push(_episode(anilistId, show.slug, number, category, title));
  });
  return episodes;
}
function getDetail(url, opts) {
  var id = _id(url);
  return _media(id).then(function (media) {
    return _resolveShow(media).then(function (show) {
      return _availability(show).then(function (availability) {
        var item = _item(media);
        if (!item) throw new Error('KickAssAnime: title is hidden by settings');
        item.episodes = _episodeItems(id, show, availability);
        item.subCount = item.episodes.filter(function (x) { return x.category === 'sub' || x.category === 'both'; }).length;
        item.dubCount = item.episodes.filter(function (x) { return x.category === 'dub' || x.category === 'both'; }).length;
        item.episodeCount = item.episodes.length;
        return item;
      });
    });
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) { return detail.episodes || []; });
}

function _parseEpisode(value) {
  var text = String(value || '');
  var match = text.match(/^kaa:\/\/episode\/(\d+)\/([^/]+)\/([0-9]+(?:\.[0-9]+)?)\/(sub|dub|both)$/i);
  if (!match) throw new Error('KickAssAnime: invalid episode URL');
  var slug;
  try { slug = decodeURIComponent(match[2]); } catch (e) { slug = match[2]; }
  if (!slug) throw new Error('KickAssAnime: invalid episode URL');
  return { anilistId: Number(match[1]), slug: slug, number: Number(match[3]), category: match[4].toLowerCase() };
}
function _vidStreamingUrl(root) {
  var servers = root && Array.isArray(root.servers) ? root.servers : [];
  for (var i = 0; i < servers.length; i++) {
    var server = servers[i] || {};
    var src = String(server.src || server.url || '');
    if (String(server.name || '').toLowerCase() === 'vidstreaming' || /source=vidstream/i.test(src)) return src;
  }
  return '';
}
function _serverUrl(root) {
  var servers = root && Array.isArray(root.servers) ? root.servers : [];
  var preferred = ['vidstreaming', 'catstream', 'birdstream'];
  for (var p = 0; p < preferred.length; p++) {
    for (var i = 0; i < servers.length; i++) {
      var server = servers[i] || {};
      var name = String(server.name || '').toLowerCase();
      var src = String(server.src || server.url || '');
      if (name === preferred[p] || src.toLowerCase().indexOf('source=' + preferred[p]) >= 0) {
        var url = _absolute(src);
        if (url) return url;
      }
    }
  }
  // Some titles only expose an embed or alternate CDN server. Fall back to the
  // first listed server so playback still works instead of throwing.
  for (var i = 0; i < servers.length; i++) {
    var server = servers[i] || {};
    var src = String(server.src || server.url || '');
    var url = _absolute(src);
    if (url) return url;
  }
  return '';
}
function _playerId(playerUrl) {
  try { return new URL(playerUrl).searchParams.get('id') || ''; }
  catch (e) { return ''; }
}
function _astroProps(html) {
  var match = String(html || '').match(/\bprops="([^"]+)"/);
  if (!match) return null;
  try {
    var parsed = JSON.parse(_decodeEntities(match[1]));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) { return null; }
}
function _unwrap(value) {
  return Array.isArray(value) && value.length === 2 ? value[1] : value;
}
function _mediaUrl(value) {
  var text = _decodeEntities(value).trim();
  if (!text) return '';
  text = text.replace(/^https?:\/{2,}/i, 'https://').replace(/^\/\//, 'https://');
  return _absolute(text);
}
function _playerManifest(html) {
  var props = _astroProps(html);
  if (props) {
    var manifest = _mediaUrl(_unwrap(props.manifest));
    var kind = String(_unwrap(props.type) || '').toLowerCase();
    if (manifest) {
      var dash = /\.mpd(?:[?#]|$)/i.test(manifest) || kind === 'dash';
      return { url: manifest, type: dash ? 'dash' : 'hls' };
    }
  }
  var fallback = String(html || '').match(/(?:https?:)?\/\/[^"'\s\\]+\.(?:m3u8|mpd)(?:[?#][^"'\s\\]*)?/i);
  if (!fallback) return null;
  var url = _mediaUrl(fallback[0]);
  if (!url) return null;
  return { url: url, type: /\.mpd(?:[?#]|$)/i.test(url) ? 'dash' : 'hls' };
}
function _decodeEntities(value) {
  return String(value || '')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/\\\//g, '/');
}
function _absolute(value) {
  var text = _decodeEntities(value).trim();
  if (!text) return '';
  try {
    var parsed = new URL(text, PLAYER_ORIGIN + '/');
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch (e) { return ''; }
}
function _subtitleFormat(row, url) {
  var format = String(_unwrap(row && row.format) || '').toLowerCase();
  if (format === 'vtt' || format === 'srt') return format;
  if (/\.srt(?:[?#]|$)/i.test(url)) return 'srt';
  if (/\.vtt(?:[?#]|$)/i.test(url)) return 'vtt';
  return 'vtt';
}
function _subtitles(html) {
  var out = [], seen = {};
  function add(url, lang, label, format) {
    var absolute = _mediaUrl(url);
    if (!absolute || seen[absolute]) return;
    seen[absolute] = true;
    out.push({ url: absolute, lang: lang || 'und', label: label || lang || 'Subtitles', format: format || 'vtt' });
  }
  var props = _astroProps(html);
  var rows = props && props.subtitles;
  var list = Array.isArray(rows) && rows.length === 2 ? rows[1] : rows;
  if (Array.isArray(list)) {
    list.forEach(function (item) {
      var row = Array.isArray(item) && item.length === 2 ? item[1] : item;
      if (!row || typeof row !== 'object') return;
      var src = _unwrap(row.src || row.url || row.file);
      if (!src) return;
      add(src, _unwrap(row.language), _unwrap(row.name), _subtitleFormat(row, String(src)));
    });
  }
  var text = _decodeEntities(html);
  var re = /"language":\[0,"([^"]*)"\],"name":\[0,"([^"]*)"\],"src":\[0,"([^"]+\.vtt)"\]/gi;
  var match;
  while ((match = re.exec(text)) !== null) add(match[3], match[1], match[2], 'vtt');
  return out;
}
function _playbackStream(playerUrl, body, category, locale) {
  var manifest = _playerManifest(body);
  var subtitles = _subtitles(body);
  if (!manifest) {
    var playerId = _playerId(playerUrl);
    if (!playerId || !/source=vidstream/i.test(playerUrl)) return null;
    manifest = { url: HLS_BASE + '/' + encodeURIComponent(playerId) + '/master.m3u8', type: 'hls' };
  }
  var dash = manifest.type === 'dash';
  return {
    url: manifest.url,
    type: manifest.type,
    container: manifest.type,
    hls: !dash,
    dash: dash,
    quality: 'Auto',
    label: category === 'dub' ? 'KickAssAnime English' : 'KickAssAnime Japanese',
    kind: category,
    audio: category,
    audioLang: locale,
    headers: { 'User-Agent': UA, Referer: PLAYER_ORIGIN + '/', Origin: PLAYER_ORIGIN },
    subtitles: subtitles,
    isActive: true
  };
}
function _resolveEpisodeStream(episode, locale, category) {
  return _episodePage(episode.slug, episode.number, locale).then(function (page) {
    var row = _episodeRow(page, episode.number);
    if (!row || !row.slug) throw new Error('KickAssAnime episode was not found');
    return _json(API + '/show/' + encodeURIComponent(episode.slug) + '/episode/ep-' + encodeURIComponent(String(episode.number)) + '-' + encodeURIComponent(row.slug), { headers: { Referer: SITE + '/' } });
  }).then(function (detail) {
    var playerUrl = _serverUrl(detail);
    if (!playerUrl) throw new Error('KickAssAnime episode has no native player server');
    return _fetch(playerUrl, { headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: SITE + '/' } })
      .then(function (player) {
        var stream = _playbackStream(playerUrl, player.body, category, locale);
        if (!stream) throw new Error('KickAssAnime player did not expose a playable manifest');
        return [stream];
      });
  });
}
function _tagStream(stream, cat) {
  var locale = cat === 'dub' ? DUB_LOCALE : ORIGINAL_LOCALE;
  return Object.assign({}, stream, {
    kind: cat, audio: cat,
    audioLang: locale,
    label: cat === 'dub' ? 'KickAssAnime English' : 'KickAssAnime Japanese'
  });
}
function getVideoSources(episodeUrl, opts) {
  var episode;
  try { episode = _parseEpisode(episodeUrl); }
  catch (e) { return Promise.resolve([]); }
  // A 'both' episode row exposes each audio track as its own stream so the
  // episode list does not need a separate SUB and DUB row per number.
  var categories = episode.category === 'both' ? ['sub', 'dub'] : [episode.category];
  var resolveOne = function (cat) {
    var locale = cat === 'dub' ? DUB_LOCALE : ORIGINAL_LOCALE;
    return _resolveEpisodeStream(episode, locale, cat).then(function (streams) {
      return streams.map(function (stream) { return _tagStream(stream, cat); });
    }).catch(function () {
      // A dub track that lists an episode but exposes no server falls back to
      // the Japanese stream instead of returning a dead-end.
      if (cat === 'dub') {
        return _resolveEpisodeStream(episode, ORIGINAL_LOCALE, 'sub').then(function (streams) {
          return streams.map(function (stream) {
            var tagged = _tagStream(stream, 'sub');
            tagged.label = 'KickAssAnime Japanese (dub unavailable)';
            return tagged;
          });
        }).catch(function () { return []; });
      }
      return [];
    });
  };
  return Promise.all(categories.map(resolveOne)).then(function (groups) {
    var out = [], seen = {};
    groups.forEach(function (group) {
      (group || []).forEach(function (stream) {
        if (!stream || !stream.url || seen[stream.url]) return;
        seen[stream.url] = 1;
        out.push(stream);
      });
    });
    return out;
  });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.2', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _config: _config, _titleScore: _titleScore, _titleSelectionScore: _titleSelectionScore,
    _seasonNumber: _seasonNumber, _candidate: _candidate, _candidateScore: _candidateScore,
    _episodeNumbers: _episodeNumbers, _episodeTitles: _episodeTitles, _episodeRow: _episodeRow,
    _parseEpisode: _parseEpisode, _vidStreamingUrl: _vidStreamingUrl, _playerId: _playerId,
    _serverUrl: _serverUrl, _playerManifest: _playerManifest, _astroProps: _astroProps,
    _subtitles: _subtitles
  };
}
