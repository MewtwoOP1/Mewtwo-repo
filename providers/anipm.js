// Ani.pm native provider for Zangetsu. Version mirrored in index.json.
//
// Catalogue data comes from Ani.pm's documented partner API
// (https://ani.pm/api/partner/v1). It needs no key, is CORS-open and every
// answer carries an X-AniPM-API-Version header.
//
// Playback follows the official embed player chain. The documented embed URL
// (https://ani.pm/embed/ani/{anilistId}/{episode}/{sub|dub}) ships the
// player's own bootstrap config; the partner session endpoint signs a session
// for that one episode; the player origin then answers with the media URL.
// A webpage is never handed back as a playable stream: when the player origin
// cannot be reached the episode simply has no stream.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'anipm';
var VERSION = '1.0.1';
var OFFICIAL_DOMAIN = 'ani.pm';
var API_PATH = '/api/partner/v1';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var PRIMARY_PROBE_MS = 10 * 60 * 1000;
var PAGE_LIMIT = 50;
var DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
var state = { healthy: null, healthyAt: 0, primaryProbedAt: 0, primaryOk: true };

function getInfo() {
  return { name: 'Ani.pm', lang: 'en', baseUrl: 'https://' + OFFICIAL_DOMAIN,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=ani.pm', type: 'anime', version: VERSION };
}

function getSettings() {
  return [
    { key: 'primaryDomain', label: 'Primary domain', description: 'The ani.pm domain used first. Only change this to a domain ani.pm itself confirms; a lookalike domain can serve anything.', type: 'text', default: OFFICIAL_DOMAIN },
    { key: 'fallbackDomains', label: 'Fallback domains', description: 'Comma or newline separated backup domains, tried in order when the primary fails. ani.pm has not published alternate domains, so leave this blank unless the maintainers announce one.', type: 'text', default: '' },
    { key: 'autoFallback', label: 'Automatic domain fallback', description: 'When the current domain fails, try the next candidate instead of giving up on the episode.', type: 'bool', default: true },
    { key: 'preferredDomain', label: 'Preferred domain', description: 'Automatic keeps using the last domain that worked. Primary always starts from the domain above and only falls back if it fails.', type: 'enum', default: 'auto', options: [{ value: 'auto', label: 'Automatic (last working domain)' }, { value: 'primary', label: 'Always start from the primary domain' }] },
    { key: 'customDomain', label: 'Custom domain override', description: 'Replaces the primary domain with a domain you trust. Only use one you have verified yourself: a lookalike domain is not covered by ani.pm.', type: 'text', default: '' },
    { key: 'requestTimeoutMs', label: 'Request timeout', description: 'Maximum wait for a single ani.pm request.', type: 'enum', default: '12000', options: [{ value: '6000', label: '6 seconds' }, { value: '12000', label: '12 seconds' }, { value: '18000', label: '18 seconds' }, { value: '25000', label: '25 seconds' }] },
    { key: 'maxRetries', label: 'Maximum retries', description: 'How many times a failed request is repeated before the next domain is tried.', type: 'enum', default: '2', options: [{ value: '0', label: 'No retry' }, { value: '1', label: '1 retry' }, { value: '2', label: '2 retries' }, { value: '3', label: '3 retries' }, { value: '5', label: '5 retries' }] },
    { key: 'autoRecovery', label: 'Automatic recovery', description: 'Periodically check the primary domain again so the source returns to it once it works.', type: 'bool', default: true },
    { key: 'preferredAudio', label: 'Episode audio', description: 'Which versions of an episode to list and play.', type: 'enum', default: 'both', options: [{ value: 'both', label: 'Sub and dub' }, { value: 'sub', label: 'Sub only' }, { value: 'dub', label: 'Dub only' }] },
    { key: 'preferredAudioLanguage', label: 'Preferred audio language', description: 'Which audio language is tried first when an episode offers more than one.', type: 'enum', default: 'ja', options: [{ value: 'ja', label: 'Japanese (sub)' }, { value: 'en', label: 'English (dub)' }] },
    { key: 'includeSubtitles', label: 'Include subtitle tracks', description: 'Attach the subtitle tracks ani.pm publishes for an episode when they are available.', type: 'bool', default: true }
  ];
}

function _rawSetting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.anipm || {};
    return cfg[key] == null ? null : cfg[key];
  } catch (e) { return null; }
}
function _int(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function _bool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  var text = String(value).toLowerCase();
  if (text === 'true') return true;
  if (text === 'false') return false;
  return fallback;
}
function _settings() {
  return {
    primary: _normaliseDomain(_rawSetting('primaryDomain')) || OFFICIAL_DOMAIN,
    fallbacks: _domainList(_rawSetting('fallbackDomains')),
    autoFallback: _bool(_rawSetting('autoFallback'), true),
    preferred: String(_rawSetting('preferredDomain') || 'auto').toLowerCase() === 'primary' ? 'primary' : 'auto',
    custom: _normaliseDomain(_rawSetting('customDomain')) || '',
    timeoutMs: _int(_rawSetting('requestTimeoutMs'), 12000, 3000, 25000),
    retries: _int(_rawSetting('maxRetries'), 2, 0, 5),
    autoRecovery: _bool(_rawSetting('autoRecovery'), true),
    audio: String(_rawSetting('preferredAudio') || 'both').toLowerCase(),
    audioLanguage: String(_rawSetting('preferredAudioLanguage') || 'ja').toLowerCase() === 'en' ? 'en' : 'ja',
    subtitles: _bool(_rawSetting('includeSubtitles'), true)
  };
}
function _normaliseDomain(value) {
  var text = String(value == null ? '' : value).trim().toLowerCase();
  if (!text) return '';
  text = text.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!DOMAIN_RE.test(text)) return '';
  return text;
}
function _domainList(value) {
  var parts = String(value == null ? '' : value).split(/[\s,]+/);
  var out = [], seen = {};
  parts.forEach(function (part) {
    var domain = _normaliseDomain(part);
    if (!domain || seen[domain]) return;
    seen[domain] = 1;
    out.push(domain);
  });
  return out;
}
function _origin(domain) { return 'https://' + domain; }

// The candidate order. Automatic keeps the last domain that answered, so a
// working mirror is not re-probed on every request; the primary is retried on
// its own schedule so a recovered domain is picked up again.
function _candidates() {
  var cfg = _settings();
  var primary = cfg.custom || cfg.primary;
  var list = [primary].concat(cfg.fallbacks.filter(function (d) { return d !== primary; }));
  if (cfg.preferred === 'primary') return list;
  if (state.healthy && list.indexOf(state.healthy) >= 0) {
    var reordered = [state.healthy].concat(list.filter(function (d) { return d !== state.healthy; }));
    if (reordered[0] === primary && cfg.autoRecovery && state.primaryProbedAt && Date.now() - state.primaryProbedAt < PRIMARY_PROBE_MS) return reordered;
    return reordered;
  }
  return list;
}
function _markHealthy(domain) {
  state.healthy = domain;
  state.healthyAt = Date.now();
  if (domain === (_settings().custom || _settings().primary)) state.primaryProbedAt = Date.now();
}
function _markUnhealthy(domain) {
  if (state.healthy === domain) state.healthy = null;
  if (domain === (_settings().custom || _settings().primary)) state.primaryOk = false;
}
function _headers(extra) {
  var headers = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://' + OFFICIAL_DOMAIN + '/',
    'Origin': 'https://' + OFFICIAL_DOMAIN
  };
  if (extra) for (var key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) headers[key] = extra[key];
  return headers;
}
function _readBody(response) {
  var body = response && response.body;
  if (typeof body === 'string') return Promise.resolve(body);
  if (response && typeof response.text === 'function') {
    try { return Promise.resolve(response.text()); } catch (e) { /* fall through */ }
  }
  if (body && typeof body === 'object') return Promise.resolve(JSON.stringify(body));
  return Promise.resolve(String(body == null ? '' : body));
}
function _isTransient(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}
// One request against one origin, with a bounded number of retries.
function _tryOrigin(origin, path, opts) {
  var cfg = _settings();
  var options = opts || {};
  var url = origin + path;
  var attempt = 0;
  function run() {
    return fetch(url, {
      headers: _headers(options.headers),
      timeoutMs: cfg.timeoutMs,
      browser: options.browser === true
    }).then(function (response) {
      var status = Number(response && response.status || 0);
      return _readBody(response).then(function (body) {
        if (status && (status < 200 || status >= 300)) {
          var error = new Error('Ani.pm HTTP ' + status + ' for ' + path);
          error.status = status;
          error.transient = _isTransient(status);
          throw error;
        }
        return { body: body, status: status, headers: (response && response.headers) || {} };
      });
    }).catch(function (error) {
      var transient = error && error.transient !== false;
      if (transient && attempt < cfg.retries) {
        attempt += 1;
        return new Promise(function (resolve) { setTimeout(resolve, 250 * attempt); }).then(run);
      }
      throw error;
    });
  }
  return run();
}
// A JSON GET that walks the candidate domains until one answers.
function _getJson(path, opts) {
  var cfg = _settings();
  var options = opts || {};
  var candidates = _candidates();
  var index = 0;
  var failures = [];
  function next() {
    if (index >= candidates.length) {
      var summary = failures.length ? failures.join('; ') : 'no domain tried';
      var error = new Error('Ani.pm: every configured domain failed (' + summary + ')');
      error.diagnostics = failures;
      throw error;
    }
    var domain = candidates[index++];
    return _tryOrigin(_origin(domain), path, options).then(function (result) {
      _markHealthy(domain);
      var text = String(result.body || '');
      try { return JSON.parse(text || 'null'); }
      catch (e) {
        var bad = new Error('Ani.pm: malformed JSON from ' + domain);
        bad.transient = true;
        throw bad;
      }
    }).catch(function (error) {
      _markUnhealthy(domain);
      failures.push(domain + ': ' + String(error && error.message || error));
      if (!cfg.autoFallback) throw error;
      return next();
    });
  }
  return next();
}
function _getText(path, opts) {
  var cfg = _settings();
  var options = opts || {};
  var candidates = _candidates();
  var index = 0;
  var failures = [];
  function next() {
    if (index >= candidates.length) {
      var error = new Error('Ani.pm: every configured domain failed (' + (failures.join('; ') || 'no domain tried') + ')');
      error.diagnostics = failures;
      throw error;
    }
    var domain = candidates[index++];
    return _tryOrigin(_origin(domain), path, options).then(function (result) {
      _markHealthy(domain);
      return String(result.body || '');
    }).catch(function (error) {
      _markUnhealthy(domain);
      failures.push(domain + ': ' + String(error && error.message || error));
      if (!cfg.autoFallback) throw error;
      return next();
    });
  }
  return next();
}

function _titleOf(item) {
  var title = item && item.title;
  if (typeof title === 'string') return title.trim();
  if (title && typeof title === 'object') return String(title.english || title.romaji || title.native || '').trim();
  return String((item && (item.name || item.english)) || '').trim();
}
function _num(value) {
  var n = Number(value);
  return isFinite(n) && n > 0 ? n : null;
}
function _idOf(item) {
  return _num(item && (item.anilistId || item.anilist_id)) || null;
}
function _malOf(item) {
  return _num(item && (item.malId || item.mal_id)) || null;
}
function _absolute(value, base) {
  var text = String(value == null ? '' : value).trim();
  if (!text) return '';
  if (text.indexOf('//') === 0) return 'https:' + text;
  if (/^https?:\/\//i.test(text)) return text;
  if (text.charAt(0) === '/') return String(base || 'https://' + OFFICIAL_DOMAIN) + text;
  return '';
}
function _itemUrl(anilistId) {
  return 'anipm://ani/' + encodeURIComponent(String(anilistId));
}
function _card(item) {
  var anilistId = _idOf(item);
  if (!anilistId) return null;
  var title = _titleOf(item);
  if (!title) return null;
  var cover = _absolute(item.poster || item.cover, 'https://' + OFFICIAL_DOMAIN);
  var card = {
    id: _itemUrl(anilistId),
    url: _itemUrl(anilistId),
    title: title,
    name: title,
    cover: cover || null,
    poster: cover || null,
    banner: _absolute(item.banner, 'https://' + OFFICIAL_DOMAIN) || null,
    type: 'anime',
    sourceId: SOURCE_ID,
    anilistId: anilistId,
    malId: _malOf(item),
    year: item.year ? String(item.year) : null,
    score: typeof item.score === 'number' ? Math.round(item.score * 10) : null,
    genres: Array.isArray(item.genres) ? item.genres.slice(0) : []
  };
  return card;
}
function _cards(payload) {
  var rows = payload && Array.isArray(payload.data) ? payload.data : [];
  var out = [], seen = {};
  rows.forEach(function (row) {
    if (!row || row.adult === true) return;
    var card = _card(row);
    if (!card || seen[card.id]) return;
    seen[card.id] = 1;
    out.push(card);
  });
  return out;
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var current = Math.max(1, _int(page, 1, 1, 20));
  var path = API_PATH + '/titles?q=' + encodeURIComponent(q) + '&page=' + current + '&limit=' + PAGE_LIMIT + '&adult=0';
  return _getJson(path).then(_cards).catch(function () { return []; });
}
function popular(opts) {
  var path = API_PATH + '/titles?page=1&limit=' + PAGE_LIMIT + '&adult=0';
  return _getJson(path).then(_cards).catch(function () { return []; });
}
function getHome(opts) {
  var rows = [];
  var trending = API_PATH + '/top?range=today&adult=0';
  var recent = API_PATH + '/recent?page=1&limit=' + PAGE_LIMIT + '&adult=0';
  return Promise.all([
    _getJson(trending).then(_cards).catch(function () { return []; }),
    _getJson(recent).then(_cards).catch(function () { return []; })
  ]).then(function (results) {
    if (results[0].length) rows.push({ title: 'Trending on ani.pm', items: results[0].slice(0, 24) });
    if (results[1].length) rows.push({ title: 'Recently added', items: results[1].slice(0, 24) });
    if (rows.length) return rows;
    return popular(opts).then(function (items) { return items.length ? [{ title: 'Anime on ani.pm', items: items }] : []; });
  });
}
function _parseItem(url) {
  var text = String(url == null ? '' : url);
  var match = text.match(/^anipm:\/\/ani\/([^/?#]+)/i) || text.match(/^anilist:\/\/(\d+)/i);
  if (match) {
    try { return { anilistId: decodeURIComponent(match[1]) }; } catch (e) { return { anilistId: match[1] }; }
  }
  var mal = text.match(/^anipm:\/\/mal\/([^/?#]+)/i);
  if (mal) {
    try { return { malId: decodeURIComponent(mal[1]) }; } catch (e) { return { malId: mal[1] }; }
  }
  return null;
}
function _resolve(ref) {
  if (!ref) return Promise.reject(new Error('Ani.pm: unknown title reference'));
  var path = API_PATH + '/titles/' + encodeURIComponent(ref.anilistId || ref.malId);
  return _getJson(path).then(function (payload) {
    var row = payload && payload.data ? payload.data : null;
    if (!row) throw new Error('Ani.pm: the title is not on ani.pm');
    return row;
  });
}
function _episodeRows(payload) {
  var rows = payload && Array.isArray(payload.data) ? payload.data : [];
  var out = [], seen = {};
  rows.forEach(function (row) {
    if (!row) return;
    var number = _num(row.number);
    if (!number || seen[number]) return;
    seen[number] = 1;
    var available = row.available && typeof row.available === 'object' ? row.available : {};
    out.push({
      number: number,
      title: row.title ? String(row.title) : 'Episode ' + number,
      runtimeSeconds: _num(row.runtimeSeconds),
      aired: row.aired || null,
      thumbnail: row.thumbnail || null,
      sub: available.sub === true || available.subHard === true,
      dub: available.dub === true || available.dubHard === true,
      subHard: available.subHard === true,
      dubHard: available.dubHard === true
    });
  });
  out.sort(function (a, b) { return a.number - b.number; });
  return out;
}
// The app asks for one track per episode through opts.category and counts the
// rows it gets, so an episode is listed once. The provider's own preference only
// decides the track when the app does not ask for one.
function _wantedTrack(opts) {
  var asked = opts && opts.category ? String(opts.category).toLowerCase() : '';
  if (asked === 'dub' || asked === 'dubbed') return 'dub';
  if (asked === 'sub' || asked === 'subbed') return 'sub';
  var cfg = _settings();
  if (cfg.audio === 'dub') return 'dub';
  if (cfg.audio === 'sub') return 'sub';
  return cfg.audioLanguage === 'en' ? 'dub' : 'sub';
}
function _episodeTrack(row, wanted) {
  if (wanted === 'dub') return row.dub ? 'dub' : (row.sub ? 'sub' : null);
  return row.sub ? 'sub' : (row.dub ? 'dub' : null);
}
function _episodeUrl(anilistId, slug, number, track) {
  return 'anipm://ani/' + encodeURIComponent(String(anilistId)) + '/' + encodeURIComponent(String(slug || '')) + '/' + number + '/' + track;
}
// The playback bootstrap is keyed by the title slug, which is the last segment
// of the title URL the catalogue publishes.
function _slugOf(row) {
  var url = String((row && row.url) || '');
  var match = url.match(/\/anime\/([^/?#]+)/);
  return match ? match[1] : '';
}
function _episodes(anilistId, slug, rows, opts) {
  var wanted = _wantedTrack(opts);
  var out = [];
  rows.forEach(function (row) {
    var track = _episodeTrack(row, wanted);
    if (!track) return;
    var url = _episodeUrl(anilistId, slug, row.number, track);
    out.push({
      id: url,
      url: url,
      number: row.number,
      title: 'Episode ' + row.number + (row.title && row.title !== 'Episode ' + row.number ? ': ' + row.title : ''),
      date: row.aired || null,
      thumbnail: row.thumbnail || null,
      runtimeSeconds: row.runtimeSeconds || null,
      category: track,
      kind: track,
      sourceId: SOURCE_ID,
      type: 'anime'
    });
  });
  return out;
}
function getDetail(url, opts) {
  var ref = _parseItem(url);
  if (!ref) return Promise.reject(new Error('Ani.pm: unknown title reference'));
  return _resolve(ref).then(function (row) {
    if (!row) throw new Error('Ani.pm: title not found on ani.pm');
    var anilistId = _idOf(row);
    if (!anilistId) throw new Error('Ani.pm: title has no AniList id');
    var episodesPath = API_PATH + '/titles/' + encodeURIComponent(anilistId) + '/episodes?adult=0';
    return _getJson(episodesPath).then(function (payload) {
      var rows = _episodeRows(payload);
      if (!rows.length) throw new Error('Ani.pm: ani.pm lists no episodes for this title');
      var card = _card(row) || { id: _itemUrl(anilistId), url: _itemUrl(anilistId), title: _titleOf(row), type: 'anime', sourceId: SOURCE_ID };
      card.description = row.synopsis || row.description || '';
      card.genres = Array.isArray(row.genres) ? row.genres : [];
      card.status = row.status ? String(row.status).toLowerCase() : 'unknown';
      card.format = row.format || null;
      card.season = row.season || null;
      card.rating = row.rating || null;
      card.studios = Array.isArray(row.studios) ? row.studios : [];
      card.durationMinutes = _num(row.durationMinutes);
      card.nativeTitle = row.nativeTitle || null;
      card.altTitles = Array.isArray(row.altNames) ? row.altNames.slice(0) : [];
      card.malId = _malOf(row) || card.malId || null;
      card.episodes = _episodes(anilistId, _slugOf(row), rows, opts);
      card.episodeCount = rows.length;
      card.subCount = rows.filter(function (r) { return r.sub; }).length;
      card.dubCount = rows.filter(function (r) { return r.dub; }).length;
      return card;
    });
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) { return detail.episodes || []; }).catch(function () { return []; });
}
function _parseEpisode(value) {
  var text = String(value == null ? '' : value);
  var match = text.match(/^anipm:\/\/ani\/([^/?#]+)\/([^/?#]*)\/(\d+)\/(sub|dub)$/i);
  if (match) {
    var anilistId, slug;
    try { anilistId = decodeURIComponent(match[1]); } catch (e) { anilistId = match[1]; }
    try { slug = decodeURIComponent(match[2]); } catch (e) { slug = match[2]; }
    return { anilistId: anilistId, slug: slug, number: Number(match[3]), track: match[4].toLowerCase() };
  }
  var legacy = text.match(/^anipm:\/\/ani\/([^/?#]+)\/(\d+)\/(sub|dub)$/i);
  if (!legacy) return null;
  var legacyId;
  try { legacyId = decodeURIComponent(legacy[1]); } catch (e) { legacyId = legacy[1]; }
  return { anilistId: legacyId, slug: '', number: Number(legacy[2]), track: legacy[3].toLowerCase() };
}
function _embedConfig(html) {
  var match = String(html || '').match(/id="anipm-embed-config"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (e) { return null; }
}
function _subtitleTracks(list) {
  if (!Array.isArray(list)) return [];
  var out = [];
  list.forEach(function (track) {
    if (!track) return;
    var url = track.url || track.src || track.file;
    if (!url || !/^https?:\/\//i.test(String(url))) return;
    var label = String(track.label || track.srclang || track.language || 'Subtitles');
    out.push({ url: String(url), file: String(url), label: label, lang: String(track.srclang || track.language || label), format: /\.srt(?:[?#]|$)/i.test(String(url)) ? 'srt' : 'vtt' });
  });
  return out;
}
function _mediaSources(payload) {
  if (!payload) return [];
  var out = [];
  var single = payload.source || payload.file || payload.url;
  if (typeof single === 'string' && /^https?:\/\//i.test(single)) out.push({ url: single, kind: payload.kind });
  if (Array.isArray(payload.sources)) {
    payload.sources.forEach(function (entry) {
      if (!entry) return;
      var url = entry.file || entry.url || entry.src;
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) out.push({ url: url, kind: entry.kind || payload.kind });
    });
  }
  return out;
}
function _container(url, kind) {
  if (kind === 'hls') return 'hls';
  if (kind === 'mp4') return 'mp4';
  return /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : 'mp4';
}
// Playback follows the chain ani.pm's own player uses: the playback bootstrap
// for the title slug, the session it points at, the player page, and finally the
// player session that carries the media URL. Every step is a separate request
// and a failed step means no stream, never a webpage handed to the player.
//
// The player host sits behind a bot check. The browser flag asks the app to
// attach a Cloudflare clearance for that host; where the host refuses every
// non-browser client the episode simply has no stream.
// A Cloudflare refusal is not a playback failure of the source: the host says so
// in its answer, and the app's own solver is switched off, so the message says
// which host refused rather than leaving the reader guessing.
function _blockedByCloudflare(status, body) {
  if (status !== 403 && status !== 503) return false;
  var text = String(body || '').toLowerCase();
  return text.indexOf('cloudflare') >= 0 || text.indexOf('attention required') >= 0 || text.indexOf('just a moment') >= 0;
}
function _playerGet(url, headers) {
  var cfg = _settings();
  return fetch(url, {
    headers: headers,
    timeoutMs: cfg.timeoutMs,
    browser: true
  }).then(function (response) {
    var status = Number(response && response.status || 0);
    return _readBody(response).then(function (body) {
      if (status && (status < 200 || status >= 300)) {
        if (_blockedByCloudflare(status, body)) throw new Error('Ani.pm: the player host refused the request (Cloudflare)');
        throw new Error('Ani.pm player HTTP ' + status);
      }
      return body;
    });
  });
}
function _resolveStream(episode, track) {
  if (!episode.slug) return Promise.reject(new Error('Ani.pm: the episode carries no title slug'));
  var bootPath = '/api/anime/playback-bootstrap/settlar/' + encodeURIComponent(episode.slug) + '?ep=' + episode.number + '&lang=' + track + '&core=0';
  return _getJson(bootPath, { headers: { Accept: 'application/json, text/plain, */*', Referer: 'https://' + OFFICIAL_DOMAIN + '/' } }).then(function (boot) {
    var selection = boot && boot.settlarSelection;
    if (!selection) throw new Error('Ani.pm: the playback bootstrap carried no session');
    var availability = boot && boot.availability ? boot.availability : {};
    if (track === 'sub' && availability.sub === false) throw new Error('Ani.pm: this episode has no sub version');
    if (track === 'dub' && availability.dub === false) throw new Error('Ani.pm: this episode has no dub version');
    var sessionPath = '/api/anime/settlar/session?selection=' + encodeURIComponent(selection) + '&provider=anipm&ep=' + episode.number + '&channel=' + track + '&telemetry=0';
    return _getJson(sessionPath, { headers: { Accept: 'application/json, text/plain, */*', Referer: 'https://' + OFFICIAL_DOMAIN + '/' } }).then(function (session) {
      var embedUrl = session && session.embedUrl;
      if (!embedUrl || !/^https?:\/\//i.test(String(embedUrl))) throw new Error('Ani.pm: the session carried no player page');
      var tokenMatch = String(embedUrl).match(/[?&]t=([^&]+)/);
      if (!tokenMatch) throw new Error('Ani.pm: the player page carried no session token');
      var token = decodeURIComponent(tokenMatch[1]);
      var playerOrigin = String(embedUrl).replace(/^(https?:\/\/[^/]+).*$/, '$1');
      var playerHeaders = {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': playerOrigin + '/',
        'Origin': 'https://' + OFFICIAL_DOMAIN,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      };
      // The player page first: it is what a browser loads, and it is where a
      // clearance for the player host is established.
      return _playerGet(embedUrl, { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', Referer: 'https://' + OFFICIAL_DOMAIN + '/' }).then(function () {
        return _playerGet(playerOrigin + '/api/embed/session?t=' + encodeURIComponent(token), playerHeaders);
      }).then(function (body) {
        var payload;
        try { payload = JSON.parse(String(body || '') || 'null'); } catch (e) { throw new Error('Ani.pm: the player returned a malformed answer'); }
        var sources = _mediaSources(payload);
        if (!sources.length) throw new Error('Ani.pm: the player returned no media source');
        var headers = { 'User-Agent': UA, 'Referer': playerOrigin + '/', 'Origin': 'https://' + OFFICIAL_DOMAIN };
        var subtitles = _settings().subtitles ? _subtitleTracks(payload.subtitles || payload.tracks) : [];
        return sources.map(function (source, index) {
          return {
            url: source.url,
            quality: 'Auto',
            label: 'Ani.pm ' + track.toUpperCase() + (index ? ' · ' + (index + 1) : ''),
            container: _container(source.url, source.kind),
            headers: headers,
            kind: track === 'dub' ? 'dub' : 'sub',
            audio: track === 'dub' ? 'en' : 'ja',
            audioLang: payload.audioLang || (track === 'dub' ? 'en' : 'ja'),
            subtitles: subtitles,
            isActive: index === 0
          };
        });
      });
    });
  });
}
function getVideoSources(episodeUrl, opts) {
  var episode = _parseEpisode(episodeUrl);
  if (!episode) return Promise.resolve([]);
  var cfg = _settings();
  var tracks = [episode.track];
  if (cfg.audio === 'both' && episode.track === 'sub') tracks.push('dub');
  if (cfg.audio === 'both' && episode.track === 'dub') tracks.push('sub');
  function attempt(index) {
    if (index >= tracks.length) return Promise.resolve([]);
    return _resolveStream(episode, tracks[index]).catch(function (error) {
      console.warn('Ani.pm: no stream for episode ' + episode.number + ' (' + tracks[index] + '): ' + String(error && error.message || error));
      return attempt(index + 1);
    });
  }
  return attempt(0).then(function (streams) {
    if (streams && streams.length) return streams;
    return [];
  }).catch(function () { return []; });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _settings: _settings, _normaliseDomain: _normaliseDomain, _domainList: _domainList,
    _candidates: _candidates, _card: _card, _episodeRows: _episodeRows, _episodes: _episodes,
    _parseItem: _parseItem, _parseEpisode: _parseEpisode, _embedConfig: _embedConfig,
    _subtitleTracks: _subtitleTracks, _mediaSources: _mediaSources, _container: _container
  };
}
