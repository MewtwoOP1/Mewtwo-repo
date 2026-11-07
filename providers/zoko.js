// Zoko — AniList-backed catalogue with direct HLS playback from zokoanime.video.
// The player page contains an XOR-obfuscated JSON payload keyed by MAL id. The
// provider decodes it at playback time so the returned URL is the real HLS master,
// not an embed page.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'zoko';
var SITE = 'https://zokoanime.video';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
var PAYLOAD_KEY = 'otaku-embed-v1';
var CACHE = {};

function getInfo() {
  return { name: 'Zoko', lang: 'en', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=zokoanime.video', type: 'anime', version: '1.0.2' };
}
function getSettings() {
  return [
    { key: 'audioMode', label: 'Audio tracks', description: 'Show both SUB and DUB when available, or filter to one track.', type: 'enum', default: 'both', options: [{ value: 'both', label: 'Sub and dub' }, { value: 'sub', label: 'Sub only' }, { value: 'dub', label: 'Dub only' }] },
    { key: 'homeSections', label: 'Home sections', description: 'Comma-separated AniList sections: trending, popular, top.', type: 'text', default: 'trending,popular' },
    { key: 'requestTimeoutMs', label: 'Request timeout', description: 'Maximum wait for an individual AniList or Zoko request.', type: 'enum', default: '10000', options: [{ value: '6000', label: '6 seconds' }, { value: '10000', label: '10 seconds' }, { value: '15000', label: '15 seconds' }] },
    { key: 'showAdult', label: 'Show adult catalogue entries', description: 'Include adult entries returned by AniList. Disabled by default.', type: 'bool', default: false }
  ];
}

function _setting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.zoko || {};
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
  while (keys.length > 160) delete CACHE[keys.shift()];
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
  var headers = Object.assign({ 'User-Agent': UA, Accept: '*/*' }, opts.headers || {});
  return fetch(url, Object.assign({}, opts, { headers: headers, timeoutMs: opts.timeoutMs || _config().timeoutMs })).then(function (response) {
    return _readResponse(response).then(function (body) {
      var status = Number(response && response.status || 0);
      if (status < 200 || status >= 300) {
        var error = new Error('Zoko HTTP ' + status + ' for ' + url);
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
    catch (e) { throw new Error('Zoko returned invalid JSON for ' + url); }
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

var MEDIA_FIELDS = 'id idMal title { english romaji native userPreferred } description(asHtml:false) coverImage { extraLarge large } bannerImage episodes nextAiringEpisode { episode } status genres seasonYear averageScore isAdult synonyms';
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
  if (!Number(media.idMal)) return null;
  // Keep the full AniList row so a following getDetail() can reuse the search
  // response instead of spending a second AniList round-trip on the same title.
  _cachePut('media:' + media.id, media, 120000);
  return {
    id: 'zoko://anime/' + media.id,
    url: 'zoko://anime/' + media.id,
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
    .catch(function (error) { console.warn('Zoko search failed:', String(error)); return []; });
}
function getHome(opts) {
  var allowed = { trending: 'TRENDING_DESC', popular: 'POPULARITY_DESC', top: 'SCORE_DESC' };
  var sections = _config().sections;
  var jobs = sections.filter(function (name, index) { return allowed[name] && sections.indexOf(name) === index; }).map(function (name) {
    return _page(allowed[name], 1).then(function (items) {
      return items.length ? { title: name.charAt(0).toUpperCase() + name.slice(1) + ' Anime', items: items } : null;
    }).catch(function (error) { console.warn('Zoko home section failed:', name, String(error)); return null; });
  });
  return Promise.all(jobs).then(function (rows) { return rows.filter(Boolean); });
}
function popular(opts) {
  return _page('POPULARITY_DESC', 1).catch(function () { return []; });
}
function _id(value) {
  var text = String(value || '');
  var match = text.match(/(?:zoko:\/\/anime\/|\/)(\d+)(?:[/?#]|$)/) || text.match(/^(\d+)$/);
  if (!match) throw new Error('Zoko: invalid AniList ID');
  return Number(match[1]);
}
function _media(id) {
  var key = 'media:' + id;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  return _graph('query($id:Int){Media(id:$id,type:ANIME){' + MEDIA_FIELDS + '}}', { id: Number(id) }).then(function (data) {
    if (!data.Media) throw new Error('AniList title not found: ' + id);
    if (data.Media.isAdult && !_config().showAdult) throw new Error('Zoko: adult title hidden by settings');
    return _cachePut(key, data.Media, 120000);
  });
}

function _atob(value) {
  if (typeof atob === 'function') return atob(value);
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var input = String(value || '').replace(/=+$/, '');
  var output = '';
  for (var bc = 0, bs = 0, buffer = 0, i = 0; (buffer = input.charAt(i++));) {
    buffer = chars.indexOf(buffer);
    if (buffer < 0) continue;
    bs = bc % 4 ? bs * 64 + buffer : buffer;
    if (bc++ % 4) output += String.fromCharCode(255 & bs >> (-2 * bc & 6));
  }
  return output;
}
function _utf8(bytes) {
  var encoded = '';
  for (var i = 0; i < bytes.length; i++) encoded += '%' + ('0' + bytes[i].toString(16)).slice(-2);
  try { return decodeURIComponent(encoded); }
  catch (e) {
    var text = '';
    for (var j = 0; j < bytes.length; j++) text += String.fromCharCode(bytes[j]);
    return text;
  }
}
function _decodePayload(html) {
  var match = String(html || '').match(/window\.__P\s*=\s*"([A-Za-z0-9+/=]+)"/);
  if (!match) return null;
  var binary;
  try { binary = _atob(match[1]); } catch (e) { return null; }
  var key = PAYLOAD_KEY;
  var bytes = [];
  for (var i = 0; i < binary.length; i++) bytes.push(binary.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  try {
    var parsed = JSON.parse(_utf8(bytes));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) { return null; }
}
function _payloadSource(payload) {
  if (!payload || typeof payload !== 'object') return '';
  var candidates = [payload.src, payload.url, payload.stream, payload.hls, payload.m3u8,
    payload.source, payload.video && payload.video.src, payload.video && payload.video.url];
  if (Array.isArray(payload.sources)) candidates = candidates.concat(payload.sources);
  for (var i = 0; i < candidates.length; i++) {
    var value = candidates[i];
    if (value && typeof value === 'object') value = value.url || value.src || value.file;
    if (/^https:\/\/.*\.m3u8(?:[?#]|$)/i.test(String(value || '').trim())) return String(value).trim();
  }
  return '';
}
function _extractHls(html, payload) {
  var source = _payloadSource(payload);
  if (source) return source;
  var match = String(html || '').match(/https:\/\/[^"'\s<>]+\.m3u8(?:[?#][^"'\s<>]*)?/i);
  return match ? match[0] : '';
}
function _episodePage(malId, number, category) {
  var key = 'page:' + malId + ':' + number + ':' + category;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  var url = SITE + '/stream/mal/' + encodeURIComponent(String(malId)) + '/' + encodeURIComponent(String(number)) + '/' + encodeURIComponent(category);
  return _fetch(url, {
    headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', Referer: SITE + '/' }
  }).then(function (response) {
    var payload = _decodePayload(response.body);
    var source = _extractHls(response.body, payload);
    if (!payload && !source) throw new Error('Zoko player payload was missing or could not be decoded');
    if (source && (!payload || !payload.src)) payload = Object.assign({}, payload || {}, { src: source });
    return _cachePut(key, payload, 60000);
  });
}
function _availability(malId) {
  var numeric = Number(malId);
  if (!(numeric > 0)) return Promise.resolve({ sub: false, dub: false });
  var key = 'availability:' + numeric;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  function probe(category) {
    return _episodePage(numeric, 1, category).then(function () { return true; }, function (error) {
      if (error && error.status === 404) return false;
      return null;
    });
  }
  return Promise.all([probe('sub'), probe('dub')]).then(function (flags) {
    var sub = flags[0];
    var dub = flags[1];
    if (sub === null && dub === null) return _cachePut(key, { sub: true, dub: false, unknown: true }, 30000);
    if (sub === false && dub === false) return _cachePut(key, { sub: false, dub: false }, 120000);
    return _cachePut(key, { sub: sub !== false, dub: dub === true }, 120000);
  });
}
function _episodeUrl(anilistId, malId, number, category) {
  return 'zoko://episode/' + [anilistId, malId, number, category].join('/');
}
function _episode(anilistId, malId, number, category) {
  var url = _episodeUrl(anilistId, malId, number, category);
  return { id: url, url: url, number: number, title: 'Episode ' + number, category: category, sourceId: SOURCE_ID, type: 'anime' };
}
function _episodeCount(media) {
  var count = Number(media && media.episodes) || 0;
  // Ongoing shows can have a null/zero episode total while AniList already
  // knows the next episode number. That is the only reliable upper bound we
  // have for Zoko, so use it instead of returning an empty episode list.
  var next = media && media.nextAiringEpisode && Number(media.nextAiringEpisode.episode);
  if (next > 0) count = Math.max(count, next - 1);
  return Math.max(0, Math.min(500, count));
}
function _episodeItems(anilistId, malId, media, availability) {
  var cfg = _config();
  var count = _episodeCount(media);
  var sub = !!availability.sub;
  var dub = !!availability.dub;
  var wantSub = cfg.audioMode !== 'dub' && sub;
  var wantDub = cfg.audioMode !== 'sub' && dub;
  if (!wantSub && !wantDub) {
    if (sub) wantSub = true;
    else if (dub) wantDub = true;
  }
  var episodes = [];
  for (var number = 1; number <= count; number++) {
    if (wantSub) episodes.push(_episode(anilistId, malId, number, 'sub'));
    if (wantDub) episodes.push(_episode(anilistId, malId, number, 'dub'));
  }
  return episodes;
}
function getDetail(url, opts) {
  var id = _id(url);
  return _media(id).then(function (media) {
    var malId = Number(media.idMal) || 0;
    if (!malId) throw new Error('Zoko: AniList title has no MAL id');
    return _availability(malId).then(function (availability) {
      if (!availability.sub && !availability.dub) throw new Error('Zoko: this title is not available');
      var item = _item(media);
      if (!item) throw new Error('Zoko: title is hidden by settings');
      item.episodes = _episodeItems(id, malId, media, availability);
      item.subCount = item.episodes.filter(function (x) { return x.category === 'sub'; }).length;
      item.dubCount = item.episodes.filter(function (x) { return x.category === 'dub'; }).length;
      return item;
    });
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) { return detail.episodes || []; });
}

function _parseEpisode(value) {
  var text = String(value || '');
  var match = text.match(/^zoko:\/\/episode\/(\d+)\/(\d+)\/([0-9]+(?:\.[0-9]+)?)\/(sub|dub)$/i);
  if (!match) throw new Error('Zoko: invalid episode URL');
  return { anilistId: Number(match[1]), malId: Number(match[2]), number: Number(match[3]), category: match[4].toLowerCase() };
}
function _absolute(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  try {
    var parsed = new URL(text, SITE + '/');
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch (e) { return ''; }
}
function _subtitles(payload) {
  var rows = payload && Array.isArray(payload.subtitles) ? payload.subtitles : [];
  var out = [], seen = {};
  rows.forEach(function (row) {
    if (!row || typeof row !== 'object') return;
    var url = _absolute(row.src || row.url || row.file);
    if (!url || seen[url]) return;
    seen[url] = true;
    var lang = String(row.lang || row.language || row.label || 'und');
    out.push({ url: url, lang: lang, label: String(row.label || lang), format: 'vtt', default: !!row.default });
  });
  return out;
}
function getVideoSources(episodeUrl, opts) {
  var episode;
  try { episode = _parseEpisode(episodeUrl); }
  catch (e) { return Promise.resolve([]); }
  return _episodePage(episode.malId, episode.number, episode.category).then(function (payload) {
    var stream = _absolute(_extractHls('', payload));
    if (!stream) throw new Error('Zoko returned no playable HLS source');
    return [{
      url: stream,
      type: 'hls',
      container: 'hls',
      hls: true,
      quality: 'Auto',
      label: 'Zoko',
      kind: episode.category,
      audio: episode.category,
      audioLang: episode.category === 'dub' ? 'en' : 'ja',
      headers: { 'User-Agent': UA, Referer: SITE + '/', Origin: SITE },
      subtitles: _subtitles(payload),
      isActive: true
    }];
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
    _config: _config, _decodePayload: _decodePayload, _payloadSource: _payloadSource,
    _availability: _availability,
    _parseEpisode: _parseEpisode, _subtitles: _subtitles, _item: _item,
    _episodeCount: _episodeCount
  };
}
