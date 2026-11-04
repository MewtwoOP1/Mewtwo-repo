// AniChan — AniList-backed anime source with session-aware multi-server playback.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'anichan';
var SITE = 'https://anichan.to';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
var CACHE = {};
var SESSION = null;

var MIRURO_FALLBACK_HOSTS = ['https://api.hiyori.tv', 'https://miruro.zenos.my.id', 'https://www.neoanime.tv'];
var MIRURO_PROVIDER_ORDER = ['kiwi', 'animepahe', 'arc', 'zoro', 'jet', 'bee', 'bonk', 'hop', 'pewe', 'ally', 'nun', 'bun', 'twin', 'cog', 'moo', 'sun', 'knob', 'telli'];

function getInfo() {
  return { name: 'AniChan', lang: 'en', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=anichan.to', type: 'anime', version: '1.0.5' };
}
function getSettings() {
  return [
    { key: 'audioMode', label: 'Audio tracks', description: 'Choose whether the source lists both SUB and DUB, or only one track.', type: 'enum', default: 'both', options: [{ value: 'both', label: 'Sub and dub' }, { value: 'sub', label: 'Sub only' }, { value: 'dub', label: 'Dub only' }] },
    { key: 'homeSections', label: 'Home sections', description: 'Comma-separated AniList sections: trending, popular, seasonal, top.', type: 'text', default: 'trending,popular,seasonal' },
    { key: 'requestTimeoutMs', label: 'Request timeout', description: 'Maximum wait for an individual AniList or AniChan API request.', type: 'enum', default: '10000', options: [{ value: '6000', label: '6 seconds' }, { value: '10000', label: '10 seconds' }, { value: '15000', label: '15 seconds' }] },
    { key: 'sessionRefresh', label: 'Refresh session before expiry', description: 'Mint a new AniChan session when the cached session is near its two-hour expiry.', type: 'bool', default: true },
    { key: 'maxStreams', label: 'Maximum server results', description: 'Limit the number of stream servers returned for an episode.', type: 'enum', default: '8', options: [{ value: '3', label: '3 servers' }, { value: '5', label: '5 servers' }, { value: '8', label: '8 servers' }, { value: '12', label: '12 servers' }] },
    { key: 'showAdult', label: 'Show adult catalogue entries', description: 'Include adult entries returned by AniList. Disabled by default.', type: 'bool', default: false }
  ];
}

function _setting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.anichan || {};
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
  var sections = _splitList(_setting('homeSections') || 'trending,popular,seasonal').map(function (x) { return x.toLowerCase(); });
  return {
    audioMode: String(_setting('audioMode') || 'both').toLowerCase(),
    sections: sections,
    timeoutMs: _int(_setting('requestTimeoutMs'), 10000, 3000, 30000),
    refresh: _bool(_setting('sessionRefresh'), true),
    maxStreams: _int(_setting('maxStreams'), 8, 1, 20),
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
  while (keys.length > 240) delete CACHE[keys.shift()];
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
  var headers = Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, opts.headers || {});
  return fetch(url, Object.assign({}, opts, { headers: headers, timeoutMs: opts.timeoutMs || _config().timeoutMs })).then(function (response) {
    return _readResponse(response).then(function (body) {
      var status = Number(response && response.status || 0);
      if (status < 200 || status >= 300) {
        var error = new Error('AniChan HTTP ' + status + ' for ' + url);
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
    var body = _responseBody(response);
    try { return JSON.parse(body || 'null'); }
    catch (e) { throw new Error('AniChan returned invalid JSON for ' + url); }
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

var MEDIA_FIELDS = 'id idMal title { english romaji native userPreferred } description(asHtml:false) coverImage { extraLarge large } bannerImage episodes status genres seasonYear averageScore isAdult synonyms studios(isMain:true) { nodes { name } }';
function _media(id) {
  var key = 'detail:' + id;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  return _graph('query($id:Int){Media(id:$id,type:ANIME){' + MEDIA_FIELDS + '}}', { id: Number(id) }).then(function (data) {
    var media = data.Media;
    if (!media) throw new Error('AniList title not found: ' + id);
    if (media.isAdult && !_config().showAdult) throw new Error('AniChan: adult title hidden by settings');
    return _cachePut(key, media, 120000);
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
  if (!media || !media.id) return null;
  if (media.isAdult && !_config().showAdult) return null;
  return {
    id: 'anichan://anime/' + media.id,
    url: 'anichan://anime/' + media.id,
    title: _title(media) + (media.seasonYear ? ' (' + media.seasonYear + ')' : ''),
    englishTitle: media.title && media.title.english || null,
    nativeTitle: media.title && media.title.native || null,
    synonyms: Array.isArray(media.synonyms) ? media.synonyms : [],
    cover: media.coverImage && (media.coverImage.extraLarge || media.coverImage.large) || null,
    banner: media.bannerImage || null,
    description: media.description || '',
    status: _status(media.status),
    genres: Array.isArray(media.genres) ? media.genres : [],
    studios: media.studios && Array.isArray(media.studios.nodes) ? media.studios.nodes.map(function (x) { return x.name; }) : [],
    malId: Number(media.idMal) || null,
    year: media.seasonYear != null ? String(media.seasonYear) : null,
    score: media.averageScore || null,
    type: 'anime',
    sourceId: SOURCE_ID
  };
}
function _page(sort, page, season, seasonYear) {
  var cfg = _config();
  var hasSeason = !!(season && seasonYear);
  var query = 'query($page:Int,$perPage:Int' + (hasSeason ? ',$season:MediaSeason,$seasonYear:Int' : '') + '){Page(page:$page,perPage:$perPage){media(type:ANIME,sort:' + sort + ',isAdult:' + (cfg.showAdult ? 'true' : 'false') + (hasSeason ? ',season:$season,seasonYear:$seasonYear' : '') + '){' + MEDIA_FIELDS + '}}}';
  var variables = { page: Math.max(1, _int(page, 1, 1, 100)), perPage: 20 };
  if (hasSeason) { variables.season = season; variables.seasonYear = seasonYear; }
  return _graph(query, variables).then(function (data) {
    return (data.Page && Array.isArray(data.Page.media) ? data.Page.media : []).map(_item).filter(Boolean);
  });
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _graph('query($search:String,$page:Int){Page(page:$page,perPage:20){media(search:$search,type:ANIME,sort:SEARCH_MATCH,isAdult:' + (_config().showAdult ? 'true' : 'false') + '){' + MEDIA_FIELDS + '}}}', { search: q, page: Math.max(1, _int(page, 1, 1, 100)) })
    .then(function (data) { return (data.Page && Array.isArray(data.Page.media) ? data.Page.media : []).map(_item).filter(Boolean); })
    .catch(function (error) { console.warn('AniChan search failed:', String(error)); return []; });
}
function _seasonNow(date) {
  var month = (date || new Date()).getMonth() + 1;
  return month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL';
}
function getHome(opts) {
  var allowed = { trending: 'TRENDING_DESC', popular: 'POPULARITY_DESC', top: 'SCORE_DESC' };
  var sections = _config().sections;
  var jobs = sections.filter(function (name, index) { return allowed[name] && sections.indexOf(name) === index; }).map(function (name) {
    return _page(allowed[name], 1).then(function (items) {
      return items.length ? { title: name.charAt(0).toUpperCase() + name.slice(1) + ' Anime', items: items } : null;
    }).catch(function (error) { console.warn('AniChan home section failed:', name, String(error)); return null; });
  });
  if (sections.indexOf('seasonal') >= 0) {
    var now = new Date();
    jobs.push(_page('POPULARITY_DESC', 1, _seasonNow(now), now.getFullYear()).then(function (items) {
      return items.length ? { title: 'This Season', items: items } : null;
    }).catch(function (error) { console.warn('AniChan seasonal section failed:', String(error)); return null; }));
  }
  return Promise.all(jobs).then(function (rows) { return rows.filter(Boolean); });
}
function popular(opts) {
  return _page('POPULARITY_DESC', 1).catch(function () { return []; });
}
function _id(value) {
  var text = String(value || '');
  var match = text.match(/(?:anichan:\/\/anime\/|\/)(\d+)(?:[/?#]|$)/) || text.match(/^(\d+)$/);
  if (!match) throw new Error('AniChan: invalid AniList ID');
  return Number(match[1]);
}
function _availability(id) {
  var key = 'availability:' + id;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  return _json(SITE + '/api/watch/episodes?anilistId=' + encodeURIComponent(String(id))).then(function (body) {
    var count = Math.max(0, Number(body && body.episodes) || 0);
    var dubbed = !!(body && body.dubAvailable);
    return _cachePut(key, { count: count, dub: dubbed }, 120000);
  });
}
function _episodeItems(mediaId, media, availability) {
  var cfg = _config();
  var count = availability && availability.count > 0 ? availability.count : Math.max(0, Number(media && media.episodes) || 0);
  var dubbed = !!(availability && availability.dub);
  var episodes = [];
  for (var number = 1; number <= Math.min(count, 500); number++) {
    if (cfg.audioMode !== 'dub') episodes.push(_episodeItem(mediaId, number, 'sub'));
    if (dubbed && cfg.audioMode !== 'sub') episodes.push(_episodeItem(mediaId, number, 'dub'));
  }
  return episodes;
}
function _episodeItem(mediaId, number, category) {
  var url = 'anichan://episode/' + mediaId + '/' + number + '/' + category;
  return { id: url, url: url, number: number, title: 'Episode ' + number, sourceId: SOURCE_ID, type: 'anime', category: category };
}
function getDetail(url, opts) {
  var id = _id(url);
  return Promise.all([
    _media(id),
    _availability(id).catch(function (error) { console.warn('AniChan episode availability failed:', String(error)); return null; })
  ]).then(function (results) {
    var media = results[0];
    var item = _item(media);
    if (!item) throw new Error('AniChan: adult title hidden by settings');
    item.episodes = _episodeItems(id, media, results[1]);
    item.subCount = item.episodes.filter(function (x) { return x.category === 'sub'; }).length;
    item.dubCount = item.episodes.filter(function (x) { return x.category === 'dub'; }).length;
    return item;
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) { return detail.episodes || []; });
}

function _header(headers, name) {
  if (!headers) return '';
  var wanted = String(name).toLowerCase();
  if (typeof headers.get === 'function') {
    var direct = headers.get(name);
    if (direct != null) return String(direct);
  }
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === wanted) {
      var value = headers[keys[i]];
      return Array.isArray(value) ? value.join(', ') : String(value == null ? '' : value);
    }
  }
  return '';
}
function _sessionCookie(response) {
  var setCookie = _header(response && response.headers, 'set-cookie');
  var match = setCookie.match(/(?:^|[,;]\s*)anichan_ws=([^;,\s]+)/i);
  return match ? 'anichan_ws=' + match[1] : '';
}
function _session(force) {
  var cfg = _config();
  var now = Date.now();
  if (!force && SESSION && SESSION.expiresAt > now && (!cfg.refresh || SESSION.expiresAt - now > 60000)) return Promise.resolve(SESSION);
  return _fetch(SITE + '/api/watch/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SITE, Referer: SITE + '/' },
    body: '{"token":""}'
  }).then(function (response) {
    var body = {};
    try { body = JSON.parse(_responseBody(response) || '{}'); }
    catch (e) { body = {}; }
    var cookie = _sessionCookie(response);
    if (!cookie && body && body.cookie) {
      cookie = String(body.cookie);
      if (cookie.indexOf('=') < 0) cookie = 'anichan_ws=' + cookie;
    }
    if (!cookie) throw new Error('AniChan session response did not include anichan_ws cookie');
    var exp = Number(body && body.exp);
    if (!isFinite(exp) || exp <= 0) exp = (Date.now() / 1000) + 7200;
    if (exp < 1000000000000) exp = exp * 1000;
    var expiry = cfg.refresh ? exp - 60000 : exp;
    if (expiry <= Date.now()) expiry = Date.now() + 1000;
    SESSION = { cookie: cookie, nonce: String(body && body.n || ''), expiresAt: expiry };
    return SESSION;
  });
}
function _isSkippedServer(name) {
  var value = String(name || '').toLowerCase();
  return value.indexOf('megaplay') === 0 || value === 'vidhawk';
}
function _servers(id, episode, category, force) {
  return _session(!!force).then(function (session) {
    var url = SITE + '/api/watch/servers?anilistId=' + encodeURIComponent(String(id)) + '&ep=' + encodeURIComponent(String(episode)) + '&category=' + encodeURIComponent(category);
    return fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        Referer: SITE + '/anime/' + id + '/watch/' + episode,
        Origin: SITE,
        Cookie: session.cookie
      },
      timeoutMs: _config().timeoutMs
    }).then(function (response) {
      return _readResponse(response).then(function (text) {
        var status = Number(response && response.status || 0);
        var body = {};
        try { body = JSON.parse(text || '{}'); }
        catch (e) { body = {}; }
        if (status === 401 || (body && body.detail === 'session')) {
          var error = new Error('AniChan watch session expired');
          error.session = true;
          throw error;
        }
        if (status < 200 || status >= 300) throw new Error('AniChan servers HTTP ' + status);
        return Array.isArray(body && body.servers) ? body.servers : [];
      });
    }).catch(function (error) {
      if (error && error.session && !force) {
        SESSION = null;
        return _servers(id, episode, category, true);
      }
      throw error;
    });
  });
}
function _absolute(url) {
  var text = String(url || '');
  if (text.charAt(0) === '/') text = SITE + text;
  return text.replace(/ /g, '%20');
}
function _subtitleLanguage(label) {
  var value = String(label || '').toLowerCase();
  if (value.indexOf('eng') === 0) return 'en';
  if (value.indexOf('spa') === 0) return 'es';
  if (value.indexOf('por') === 0) return 'pt';
  if (value.indexOf('fre') === 0 || value.indexOf('fra') === 0) return 'fr';
  if (value.indexOf('ger') === 0 || value.indexOf('deu') === 0) return 'de';
  if (value.indexOf('ita') === 0) return 'it';
  if (value.indexOf('ara') === 0) return 'ar';
  if (value.indexOf('rus') === 0) return 'ru';
  if (value.indexOf('kor') === 0) return 'ko';
  if (value.indexOf('jap') === 0 || value.indexOf('jpn') === 0) return 'ja';
  if (value.indexOf('chi') === 0 || value.indexOf('zho') === 0) return 'zh';
  return 'und';
}
function _quality(server, index) {
  var label = String(server && (server.label || server.name) || '').trim().replace(/^★\s*/, '').trim();
  return label || 'Server ' + (index + 1);
}
function _streamsFromServers(servers) {
  var usable = servers.map(function (server) { return server && typeof server === 'object' ? server : null; }).filter(Boolean)
    .filter(function (server) { return !_isSkippedServer(server.name); })
    .filter(function (server) { return String(server.stream || '').trim() && String(server.type || '').toLowerCase() !== 'embed'; })
    .sort(function (a, b) { return (Number(a.rank) || 9999) - (Number(b.rank) || 9999); });
  var seen = {};
  usable = usable.filter(function (server) {
    var key = String(server.stream || '');
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).slice(0, _config().maxStreams);
  if (!usable.length) throw new Error('AniChan signed server API returned no direct stream');
  var subtitles = (Array.isArray(usable[0].subtitles) ? usable[0].subtitles : []).map(function (track) {
    if (!track || !track.url) return null;
    var label = String(track.lang || track.label || 'Subtitles');
    return { url: _absolute(track.url), label: label, lang: _subtitleLanguage(label), format: 'vtt' };
  }).filter(Boolean);
  var seenSubs = {};
  subtitles = subtitles.filter(function (track) { if (seenSubs[track.url]) return false; seenSubs[track.url] = true; return true; });
  return usable.map(function (server, index) {
    var url = _absolute(server.stream);
    var type = String(server.type || 'hls').toLowerCase();
    var container = type === 'mp4' || /\.mp4(?:[?#]|$)/i.test(url) ? 'mp4' : (type === 'dash' || /\.mpd(?:[?#]|$)/i.test(url) ? 'dash' : 'hls');
    var label = _quality(server, index);
    return {
      url: url,
      container: container,
      type: type || container,
      quality: label,
      label: label,
      kind: 'sub',
      audioLang: 'ja',
      headers: {},
      subtitles: index === 0 ? subtitles : [],
      isActive: index === 0
    };
  });
}
function getVideoSources(episodeUrl, opts) {
  var match = String(episodeUrl || '').match(/^anichan:\/\/episode\/(\d+)\/(\d+)\/(sub|dub)$/i);
  if (!match) return Promise.reject(new Error('AniChan: invalid episode URL'));
  var id = Number(match[1]);
  var episode = Number(match[2]);
  var category = match[3].toLowerCase();
  var native = _servers(id, episode, category, false).then(_streamsFromServers);
  if (category === 'dub') native = native.then(function (streams) {
    streams.forEach(function (stream) { stream.kind = 'dub'; stream.audioLang = 'en'; });
    return streams;
  });
  return native.catch(function (error) {
    console.warn('AniChan signed servers unavailable; trying Miruro episode sources:', String(error));
    return _miruroFallback(id, episode, category, 'AniChan');
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
function _miruroFallback(id, number, category, label) {
  var hosts = MIRURO_FALLBACK_HOSTS.map(function (host) { return host.replace(/\/+$/, ''); });
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

function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.5', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _config: _config, _session: _session, _servers: _servers,
    _absolute: _absolute, _streamsFromServers: _streamsFromServers,
    _miruroFallback: _miruroFallback, _episodeItems: _episodeItems,
    _subtitleLanguage: _subtitleLanguage
  };
}
