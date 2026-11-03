/*
 * Jellyfin catalogue and playback source for Zangetsu.
 *
 * This is a standalone Jellyfin API client. It does not depend on the old
 * AIOStreams/Stremio provider, TMDB, or an Aniyomi runtime.
 *
 * It works with standard Jellyfin servers and Jellyfin-compatible servers
 * such as the AIOStreams media server. AIOStreams catalogues appear as
 * Jellyfin libraries; their metadata and streams are read through the
 * standard Jellyfin API.
 */

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'jellyfin';
var SOURCE_VERSION = '3.0.0';
var CLIENT_NAME = 'Zangetsu';
var DEVICE_NAME = 'Zangetsu';
var DEVICE_ID = 'zangetsu-jellyfin-source-v3';
var LIST_FIELDS = 'Overview,Genres,ProviderIds,PremiereDate,ProductionYear,CommunityRating,OfficialRating,Status,ImageTags,BackdropImageTags,ParentBackdropItemId,ParentBackdropImageTags,ParentLogoItemId,ParentLogoImageTag,SeriesId,SeriesName,SeriesPrimaryImageTag,ParentIndexNumber,IndexNumber,LocationType,DateCreated,UserData';
var DETAIL_FIELDS = LIST_FIELDS + ',EndDate,RunTimeTicks,People,Studios,MediaSources,MediaStreams,IndexNumberEnd,ChildCount';
var EPISODE_FIELDS = 'Overview,Genres,PremiereDate,ProductionYear,ImageTags,ParentIndexNumber,IndexNumber,RunTimeTicks,DateCreated,MediaSources,MediaStreams,SeriesId,SeriesName';
var _sessionCache = Object.create(null);
var _publicInfoCache = Object.create(null);
var _responseCache = Object.create(null);
var _responseCacheOrder = [];
var CACHE_LIMIT = 120;

function getInfo() {
  return {
    name: 'Jellyfin',
    lang: 'en',
    baseUrl: 'https://jellyfin.org',
    logo: 'https://jellyfin.org/favicon.ico',
    type: 'movie',
    version: SOURCE_VERSION
  };
}

function getSettings() {
  return [
    { key: 'serverUrl', label: 'Jellyfin server address', description: 'Paste the Jellyfin server address, including its base path. For AIOStreams use the address ending in /jellyfin, not the Stremio manifest URL.', type: 'text', default: '' },
    { key: 'username', label: 'Username', description: 'Jellyfin username. For AIOStreams this is the configuration UUID or alias; add /UserName for a household user when required.', type: 'text', default: '' },
    { key: 'password', label: 'Password', description: 'Jellyfin password. For AIOStreams use the configuration password, optionally followed by /PIN. Use a dedicated account where possible.', type: 'text', default: '' },
    { key: 'apiKey', label: 'API key / access token (optional)', description: 'Optional alternative to username and password. When set, password login is skipped. A User ID may be required for servers that do not expose a default user.', type: 'text', default: '' },
    { key: 'userId', label: 'User ID (optional)', description: 'Optional Jellyfin user ID for API-key authentication. Leave blank to let the provider discover an available user when the server permits it.', type: 'text', default: '' },
    { key: 'libraryId', label: 'Library ID (optional)', description: 'Leave blank to browse every accessible library. Enter a library ID to restrict Home, search, and catalogue browsing to that library.', type: 'text', default: '' },
    { key: 'pageSize', label: 'Catalogue page size', description: 'Maximum number of items requested for each library row or search page.', type: 'enum', default: '50', options: [{ value: '25', label: '25 items' }, { value: '50', label: '50 items' }, { value: '100', label: '100 items' }] },
    { key: 'homeSections', label: 'Home sections', description: 'Choose which Jellyfin rows are shown on the source Home page.', type: 'multiEnum', default: ['resume', 'nextUp', 'recent', 'favorites', 'libraries'], options: [{ value: 'resume', label: 'Continue Watching' }, { value: 'nextUp', label: 'Next Up' }, { value: 'recent', label: 'Recently Added' }, { value: 'favorites', label: 'Favorites' }, { value: 'libraries', label: 'Library catalogues' }] },
    { key: 'contentTypes', label: 'Catalogue content types', description: 'Choose the movie, series, and collection types returned from libraries. Episodes are loaded when a series is opened.', type: 'multiEnum', default: ['Movie', 'Series', 'BoxSet'], options: [{ value: 'Movie', label: 'Movies' }, { value: 'Series', label: 'TV series' }, { value: 'BoxSet', label: 'Collections / box sets' }] },
    { key: 'showCollections', label: 'Show collection libraries', description: 'Include BoxSet libraries and collection entries when the server provides them.', type: 'bool', default: true },
    { key: 'sortBy', label: 'Library sorting', description: 'Sort order used by catalogue and favourite rows.', type: 'enum', default: 'DateCreated', options: [{ value: 'DateCreated', label: 'Recently added' }, { value: 'SortName', label: 'Title' }, { value: 'CommunityRating', label: 'Community rating' }, { value: 'PremiereDate', label: 'Release date' }] },
    { key: 'maxStreamingBitrate', label: 'Maximum streaming bitrate', description: 'Bitrate ceiling advertised during PlaybackInfo negotiation.', type: 'enum', default: '40000000', options: [{ value: '16000000', label: '16 Mbps' }, { value: '25000000', label: '25 Mbps' }, { value: '40000000', label: '40 Mbps' }, { value: '80000000', label: '80 Mbps' }, { value: '1000000000', label: 'Server / device maximum' }] },
    { key: 'preferTranscoding', label: 'Prefer server transcoding', description: 'Prefer a server-provided transcoding or remux URL over a direct stream when both are available.', type: 'bool', default: false },
    { key: 'includeSubtitles', label: 'Include external subtitles', description: 'Return external subtitle tracks exposed by Jellyfin or the Jellyfin-compatible server.', type: 'bool', default: true },
    { key: 'useRemoteUrl', label: 'Use remote media URLs', description: 'Use an absolute remote media Path when the server marks the media source as remote. Disable to request its Jellyfin stream route instead.', type: 'bool', default: true },
    { key: 'cacheTtl', label: 'Catalogue cache', description: 'In-memory cache duration for successful catalogue and metadata GET requests. Playback negotiation is never cached.', type: 'enum', default: '30000', options: [{ value: '0', label: 'Disabled' }, { value: '15000', label: '15 seconds' }, { value: '30000', label: '30 seconds' }, { value: '60000', label: '1 minute' }] },
    { key: 'requestTimeoutMs', label: 'Server request timeout', description: 'Timeout applied to an individual Jellyfin API request.', type: 'enum', default: '15000', options: [{ value: '5000', label: '5 seconds' }, { value: '10000', label: '10 seconds' }, { value: '15000', label: '15 seconds' }, { value: '25000', label: '25 seconds' }] }
  ];
}

function _setting(key) {
  try {
    var settings = typeof __settings !== 'undefined' && __settings ? __settings[SOURCE_ID] : null;
    return settings && settings[key] != null ? settings[key] : null;
  } catch (e) {
    return null;
  }
}

function _trim(value) {
  return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function _bool(value, fallback) {
  if (value === true || value === false) return value;
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function _int(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) n = fallback;
  return Math.max(min, Math.min(max, n));
}

function _list(value, fallback) {
  var values = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[,\n;]+/);
  var out = [];
  values.forEach(function (entry) {
    var item = _trim(entry);
    if (item && out.indexOf(item) < 0) out.push(item);
  });
  return out.length ? out : fallback.slice();
}

function _config() {
  var pageSize = _int(_setting('pageSize'), 50, 25, 100);
  if ([25, 50, 100].indexOf(pageSize) < 0) pageSize = 50;

  var bitrate = _int(_setting('maxStreamingBitrate'), 40000000, 1000000, 1000000000);
  var cacheTtl = _int(_setting('cacheTtl'), 30000, 0, 60000);
  var timeout = _int(_setting('requestTimeoutMs'), 15000, 3000, 30000);
  var types = _list(_setting('contentTypes'), ['Movie', 'Series', 'BoxSet']).filter(function (type) {
    return ['Movie', 'Series', 'BoxSet'].indexOf(type) >= 0;
  });
  if (!types.length) types = ['Movie', 'Series', 'BoxSet'];

  return {
    serverUrl: _normalizeServerAddress(_setting('serverUrl')),
    username: _trim(_setting('username')),
    password: String(_setting('password') == null ? '' : _setting('password')),
    apiKey: _trim(_setting('apiKey')),
    userId: _trim(_setting('userId')),
    libraryId: _trim(_setting('libraryId')),
    pageSize: pageSize,
    homeSections: _list(_setting('homeSections'), ['resume', 'nextUp', 'recent', 'favorites', 'libraries']),
    contentTypes: types,
    showCollections: _bool(_setting('showCollections'), true),
    sortBy: _trim(_setting('sortBy')) || 'DateCreated',
    maxStreamingBitrate: bitrate,
    preferTranscoding: _bool(_setting('preferTranscoding'), false),
    includeSubtitles: _bool(_setting('includeSubtitles'), true),
    useRemoteUrl: _bool(_setting('useRemoteUrl'), true),
    cacheTtl: cacheTtl,
    requestTimeoutMs: timeout
  };
}

function _normalizeServerAddress(input) {
  var value = _trim(input);
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
  var parsed;
  try {
    parsed = new URL(value);
  } catch (e) {
    throw new Error('Enter a valid Jellyfin server address.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Jellyfin server addresses must use HTTP or HTTPS.');
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error('The server address must not contain embedded credentials.');
  }
  parsed.search = '';
  parsed.hash = '';
  var path = String(parsed.pathname || '').replace(/\/+$/, '');
  path = path.replace(/\/web\/index\.html$/i, '').replace(/\/web$/i, '').replace(/\/+$/, '');
  parsed.pathname = path || '/';
  return parsed.toString().replace(/\/+$/, '');
}

function _queryString(params) {
  var pairs = [];
  Object.keys(params || {}).forEach(function (key) {
    var value = params[key];
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) value = value.join(',');
    pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  return pairs.join('&');
}

function _joinUrl(base, path, params) {
  var url = String(base || '').replace(/\/+$/, '') + '/' + String(path || '').replace(/^\/+/, '');
  var query = _queryString(params);
  return query ? url + (url.indexOf('?') >= 0 ? '&' : '?') + query : url;
}

function _authHeader(token) {
  var header = 'MediaBrowser Client="' + CLIENT_NAME + '", Device="' + DEVICE_NAME + '", DeviceId="' + DEVICE_ID + '", Version="' + SOURCE_VERSION + '"';
  if (token) header += ', Token="' + String(token).replace(/"/g, '') + '"';
  return header;
}

function _responseJson(response, url) {
  var status = Number(response && (response.status || response.statusCode) || 200);
  var body = response && response.body;
  function parse(value) {
    if (typeof value === 'string') {
      if (!value) return {};
      try { return JSON.parse(value); } catch (e) {
        var parseError = new Error('Jellyfin returned invalid JSON for ' + url);
        parseError.status = status;
        throw parseError;
      }
    }
    return value == null ? {} : value;
  }
  function fail(value) {
    var errorBody = parse(value);
    var message = errorBody && (errorBody.Message || errorBody.message || errorBody.ErrorCode) || ('HTTP ' + status);
    var httpError = new Error('Jellyfin ' + status + ': ' + message);
    httpError.status = status;
    httpError.url = url;
    throw httpError;
  }
  var bodyIsStream = body && typeof body.getReader === 'function';
  if (status >= 400) {
    if (bodyIsStream && response && typeof response.text === 'function') return Promise.resolve(response.text()).then(fail);
    return fail(body);
  }
  if (body !== undefined && body !== null && !bodyIsStream) return Promise.resolve(parse(body));
  if (response && typeof response.json === 'function') {
    return Promise.resolve(response.json()).catch(function () {
      throw new Error('Jellyfin returned an unreadable JSON response for ' + url);
    });
  }
  if (response && typeof response.text === 'function') {
    return Promise.resolve(response.text()).then(parse);
  }
  return {};
}

function _fetchJson(url, options) {
  options = options || {};
  var headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
  var init = {
    method: options.method || 'GET',
    headers: headers,
    timeoutMs: options.timeoutMs || _config().requestTimeoutMs
  };
  if (options.body !== undefined && options.body !== null) {
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }
  var result;
  try {
    result = fetch(url, init);
  } catch (e) {
    return Promise.reject(e);
  }
  return Promise.resolve(result).then(function (response) {
    return _responseJson(response, url);
  });
}

function _cacheGet(key) {
  var row = _responseCache[key];
  if (!row || row.expiresAt <= Date.now()) {
    if (row) delete _responseCache[key];
    return null;
  }
  return row.value;
}

function _cachePut(key, value, ttl) {
  if (!ttl || ttl < 1) return value;
  _responseCache[key] = { value: value, expiresAt: Date.now() + ttl };
  _responseCacheOrder = _responseCacheOrder.filter(function (old) { return old !== key; });
  _responseCacheOrder.push(key);
  while (_responseCacheOrder.length > CACHE_LIMIT) {
    delete _responseCache[_responseCacheOrder.shift()];
  }
  return value;
}

function _request(ctx, path, params, options) {
  options = options || {};
  var method = String(options.method || 'GET').toUpperCase();
  var url = _joinUrl(ctx.baseUrl, path, params);
  var cacheKey = method + ' ' + url + ' ' + (ctx.userId || '') + ' ' + (ctx.token ? String(ctx.token).slice(-8) : '');
  if (method === 'GET' && !options.noCache) {
    var cached = _cacheGet(cacheKey);
    if (cached !== null) return Promise.resolve(cached);
  }
  var headers = Object.assign({}, options.headers || {});
  if (options.auth !== false && ctx.token) headers.Authorization = _authHeader(ctx.token);
  return _fetchJson(url, {
    method: method,
    headers: headers,
    body: options.body,
    timeoutMs: options.timeoutMs || ctx.config.requestTimeoutMs
  }).then(function (value) {
    if (method === 'GET' && !options.noCache) _cachePut(cacheKey, value, ctx.config.cacheTtl);
    return value;
  });
}

function _publicInfo(baseUrl, force) {
  var cached = _publicInfoCache[baseUrl];
  if (!force && cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  return _fetchJson(_joinUrl(baseUrl, '/System/Info/Public'), {
    timeoutMs: _config().requestTimeoutMs
  }).then(function (value) {
    _publicInfoCache[baseUrl] = { value: value || {}, expiresAt: Date.now() + 120000 };
    return value || {};
  });
}

function _login(config, force) {
  var cacheKey = config.serverUrl + '|' + (config.apiKey ? 'api:' + config.apiKey : config.username);
  var cached = _sessionCache[cacheKey];
  if (!force && cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(Object.assign({}, cached.value, { config: config }));
  }
  if (!config.serverUrl) return Promise.reject(new Error('Enter the Jellyfin server address in source settings.'));
  if (!config.apiKey && (!config.username || config.password === '')) {
    return Promise.reject(new Error('Enter a Jellyfin username and password, or provide an API key.'));
  }

  if (config.apiKey) {
    var tokenSession = {
      baseUrl: config.serverUrl,
      token: config.apiKey,
      userId: config.userId || '',
      config: config
    };
    if (tokenSession.userId) {
      _sessionCache[cacheKey] = { value: tokenSession, expiresAt: Date.now() + 180000 };
      return Promise.resolve(tokenSession);
    }
    return _fetchJson(_joinUrl(config.serverUrl, '/Users'), {
      headers: { Authorization: _authHeader(config.apiKey) },
      timeoutMs: config.requestTimeoutMs
    }).then(function (users) {
      var rows = Array.isArray(users) ? users : (users && Array.isArray(users.Items) ? users.Items : []);
      var user = rows.filter(function (row) { return row && (row.Id || row.id); })[0];
      if (!user) throw new Error('The API key is valid, but the server did not expose a user ID. Enter User ID in Jellyfin settings.');
      tokenSession.userId = String(user.Id || user.id);
      _sessionCache[cacheKey] = { value: tokenSession, expiresAt: Date.now() + 180000 };
      return tokenSession;
    });
  }

  var headers = {
    Authorization: _authHeader(''),
    'Content-Type': 'application/json'
  };
  return _fetchJson(_joinUrl(config.serverUrl, '/Users/AuthenticateByName'), {
    method: 'POST',
    headers: headers,
    body: { Username: config.username, Pw: config.password },
    timeoutMs: config.requestTimeoutMs
  }).then(function (login) {
    var token = login && (login.AccessToken || login.accessToken);
    var user = login && (login.User || login.user);
    var session = login && (login.SessionInfo || login.sessionInfo);
    var userId = (session && (session.UserId || session.userId)) || (user && (user.Id || user.id)) || '';
    if (!token || !userId) throw new Error('Jellyfin login succeeded but the response did not include an access token and user ID.');
    var value = {
      baseUrl: config.serverUrl,
      token: String(token),
      userId: String(userId),
      userName: user && (user.Name || user.name) || config.username,
      config: config
    };
    _sessionCache[cacheKey] = { value: value, expiresAt: Date.now() + 180000 };
    return value;
  }).catch(function (error) {
    if (error && error.status === 401) {
      throw new Error('Jellyfin rejected the login. For AIOStreams, use the configuration UUID or alias as Username and the configuration password as Password.');
    }
    throw error;
  });
}

function _context(force) {
  var config = _config();
  return Promise.all([
    _login(config, force),
    _publicInfo(config.serverUrl, force)
  ]).then(function (values) {
    var ctx = values[0];
    ctx.serverInfo = values[1] || {};
    ctx.aiostreams = ctx.serverInfo.aiostreams || null;
    return ctx;
  });
}

function _itemsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.Items)) return payload.Items;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

function _libraryKind(view) {
  var kind = String(view && (view.CollectionType || view.collectionType) || '').toLowerCase();
  var name = String(view && (view.Name || view.name) || '').toLowerCase();
  if (['music', 'musicvideos', 'photos', 'books', 'livetv', 'trailers'].indexOf(kind) >= 0) return 'unsupported';
  if (kind === 'movies') return 'movies';
  if (kind === 'tvshows') return 'series';
  if (kind === 'boxsets' || kind === 'collections') return 'collections';
  if (/music|photos|books|live tv|trailers/.test(name)) return 'unsupported';
  if (/collection|box set/.test(name)) return 'collections';
  return 'mixed';
}

function _views(ctx, force) {
  if (ctx._views && !force) return Promise.resolve(ctx._views);
  return _request(ctx, '/Users/' + encodeURIComponent(ctx.userId) + '/Views', {
    IncludeExternalContent: 'true'
  }, { noCache: force === true }).then(function (payload) {
    var rows = _itemsFrom(payload).filter(function (view) {
      var id = view && (view.Id || view.id);
      if (!id || _libraryKind(view) === 'unsupported') return false;
      var isCollection = _libraryKind(view) === 'collections';
      return ctx.config.showCollections || !isCollection;
    });
    if (ctx.config.libraryId) {
      rows = rows.filter(function (view) { return String(view.Id || view.id) === ctx.config.libraryId; });
    }
    ctx._views = rows;
    return rows;
  }).catch(function (error) {
    if (error && error.status === 404) {
      return _request(ctx, '/Library/VirtualFolders', {}, { noCache: force === true }).then(function (payload) {
        var rows = _itemsFrom(payload).filter(function (view) {
          return view && (view.ItemId || view.Id) && _libraryKind(view) !== 'unsupported';
        }).map(function (view) {
          if (!view.Id) view.Id = view.ItemId;
          return view;
        });
        if (ctx.config.libraryId) rows = rows.filter(function (view) { return String(view.Id || view.ItemId) === ctx.config.libraryId; });
        ctx._views = rows;
        return rows;
      });
    }
    throw error;
  });
}

function _viewId(view) {
  return String(view && (view.Id || view.id || view.ItemId) || '');
}

function _typesForView(view, config) {
  var allowed = config.contentTypes.slice();
  var kind = _libraryKind(view);
  if (kind === 'movies') allowed = allowed.filter(function (x) { return x === 'Movie' || x === 'BoxSet'; });
  else if (kind === 'series') allowed = allowed.filter(function (x) { return x === 'Series' || x === 'BoxSet'; });
  else if (kind === 'collections') allowed = allowed.filter(function (x) { return x === 'BoxSet' || x === 'Movie' || x === 'Series'; });
  return allowed;
}

function _itemUri(itemId, itemType, parentId, seriesId, seasonId) {
  var query = [];
  if (itemType) query.push('type=' + encodeURIComponent(String(itemType)));
  if (parentId) query.push('parentId=' + encodeURIComponent(String(parentId)));
  if (seriesId) query.push('seriesId=' + encodeURIComponent(String(seriesId)));
  if (seasonId) query.push('seasonId=' + encodeURIComponent(String(seasonId)));
  return 'jellyfin://item/' + encodeURIComponent(String(itemId)) + (query.length ? '?' + query.join('&') : '');
}

function _episodeUri(itemId, seriesId, seasonId, seasonNumber, episodeNumber) {
  var query = [];
  if (seriesId) query.push('seriesId=' + encodeURIComponent(String(seriesId)));
  if (seasonId) query.push('seasonId=' + encodeURIComponent(String(seasonId)));
  if (seasonNumber != null) query.push('season=' + encodeURIComponent(String(seasonNumber)));
  if (episodeNumber != null) query.push('episode=' + encodeURIComponent(String(episodeNumber)));
  return 'jellyfin://episode/' + encodeURIComponent(String(itemId)) + (query.length ? '?' + query.join('&') : '');
}

function _parseQuery(raw) {
  var out = {};
  String(raw || '').split('&').forEach(function (pair) {
    if (!pair) return;
    var at = pair.indexOf('=');
    var key = at < 0 ? pair : pair.slice(0, at);
    var value = at < 0 ? '' : pair.slice(at + 1);
    try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch (e) {}
    try { value = decodeURIComponent(value.replace(/\+/g, ' ')); } catch (e) {}
    out[key] = value;
  });
  return out;
}

function _parseItemUrl(value) {
  if (value && typeof value === 'object') {
    var objectId = value.jellyfinItemId || value.itemId || value.Id || value.id || value.videoId;
    if (objectId != null) {
      return {
        id: String(objectId),
        type: String(value.jellyfinType || value.type || ''),
        parentId: value.jellyfinParentId || value.parentId || '',
        seriesId: value.jellyfinSeriesId || value.seriesId || '',
        seasonId: value.jellyfinSeasonId || value.seasonId || '',
        season: value.season,
        episode: value.episode
      };
    }
  }
  var text = String(value == null ? '' : value);
  if (text.charAt(0) === '{') {
    try { return _parseItemUrl(JSON.parse(text)); } catch (e) {}
  }
  var match = text.match(/^jellyfin:\/\/(item|episode)\/([^?#]+)/i);
  if (match) {
    var id = match[2];
    try { id = decodeURIComponent(id); } catch (e) {}
    var query = _parseQuery(text.split('?')[1] || '');
    return {
      id: id,
      type: query.type || (match[1].toLowerCase() === 'episode' ? 'Episode' : ''),
      parentId: query.parentId || '',
      seriesId: query.seriesId || '',
      seasonId: query.seasonId || '',
      season: query.season,
      episode: query.episode
    };
  }
  if (/^[a-f0-9-]{12,}$/i.test(text)) return { id: text, type: '' };
  return null;
}

function _imageUrl(ctx, itemId, imageType, index, tag, width) {
  if (!itemId) return null;
  var path = '/Items/' + encodeURIComponent(String(itemId)) + '/Images/' + encodeURIComponent(imageType || 'Primary');
  if (index != null && Number(index) >= 0 && String(imageType || '').toLowerCase() !== 'primary') path += '/' + encodeURIComponent(String(index));
  var params = { maxWidth: width || 600, quality: 90 };
  if (tag) params.tag = tag;
  if (ctx.token) params.api_key = ctx.token;
  return _joinUrl(ctx.baseUrl, path, params);
}

function _year(raw) {
  var value = raw && (raw.ProductionYear || raw.productionYear || raw.PremiereDate || raw.premiereDate || raw.DateCreated || raw.dateCreated);
  var match = String(value || '').match(/(19|20)\d{2}/);
  return match ? match[0] : null;
}

function _score(raw) {
  var value = Number(raw && (raw.CommunityRating != null ? raw.CommunityRating : raw.communityRating));
  return isFinite(value) ? Math.round(value * 10) : undefined;
}

function _status(value) {
  var status = _trim(value).toLowerCase();
  if (status === 'ended' || status === 'released') return 'completed';
  if (status === 'continuing' || status === 'returning series' || status === 'in production') return 'ongoing';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'unknown';
}

function _mapItem(raw, ctx, parentId) {
  if (!raw || !(raw.Id || raw.id)) return null;
  var id = String(raw.Id || raw.id);
  var type = String(raw.Type || raw.type || 'Movie');
  if (['Movie', 'Series', 'BoxSet', 'Episode', 'Season'].indexOf(type) < 0) return null;
  if (!ctx.config.showCollections && type === 'BoxSet') return null;
  var name = _trim(raw.Name || raw.name || raw.OriginalTitle || raw.originalTitle);
  if (!name) return null;
  var primaryTag = raw.ImageTags && (raw.ImageTags.Primary || raw.ImageTags.primary);
  var backdropTag = raw.BackdropImageTags && raw.BackdropImageTags[0];
  var backdropId = raw.ParentBackdropItemId || raw.parentBackdropItemId;
  var cover = primaryTag ? _imageUrl(ctx, id, 'Primary', 0, primaryTag, 600) : _imageUrl(ctx, id, 'Primary', 0, null, 600);
  var banner = backdropTag && (raw.BackdropImageTags && raw.BackdropImageTags.length)
    ? _imageUrl(ctx, id, 'Backdrop', 0, backdropTag, 1000)
    : (backdropId && raw.ParentBackdropImageTags && raw.ParentBackdropImageTags[0]
      ? _imageUrl(ctx, backdropId, 'Backdrop', 0, raw.ParentBackdropImageTags[0], 1000)
      : null);
  var itemUrl = _itemUri(id, type, parentId || raw.ParentId, raw.SeriesId, type === 'Season' ? id : raw.SeasonId);
  var item = {
    id: itemUrl,
    url: itemUrl,
    title: name,
    cover: cover,
    banner: banner,
    type: 'movie',
    sourceId: SOURCE_ID,
    year: _year(raw),
    jellyfinItemId: id,
    jellyfinType: type,
    dateCreated: raw.DateCreated || raw.dateCreated || null
  };
  var score = _score(raw);
  if (score !== undefined) item.score = score;
  if (raw.SeriesId) item.jellyfinSeriesId = String(raw.SeriesId);
  if (raw.SeriesName) item.seriesName = raw.SeriesName;
  return item;
}

function _mapEpisode(raw, ctx, seriesId, seasonId) {
  if (!raw || !(raw.Id || raw.id)) return null;
  var id = String(raw.Id || raw.id);
  var season = Number(raw.ParentIndexNumber || raw.parentIndexNumber || 0);
  var episode = Number(raw.IndexNumber || raw.indexNumber || 0);
  var title = _trim(raw.Name || raw.name || ('Episode ' + (episode || '')));
  var uri = _episodeUri(id, seriesId || raw.SeriesId, seasonId || raw.SeasonId, season, episode);
  var entry = {
    id: 'S' + String(season).padStart(2, '0') + 'E' + String(episode).padStart(2, '0'),
    title: (season > 0 ? 'S' + String(season).padStart(2, '0') + ' E' + String(episode).padStart(2, '0') + ' - ' : '') + title,
    number: episode || 1,
    season: season,
    url: uri,
    date: raw.PremiereDate || raw.DateCreated || null,
    thumbnail: raw.ImageTags && raw.ImageTags.Primary ? _imageUrl(ctx, id, 'Primary', 0, raw.ImageTags.Primary, 420) : null,
    summary: raw.Overview || ''
  };
  return entry;
}

function _detailObject(raw, ctx, episodes, seasons) {
  if (!raw) return null;
  var type = String(raw.Type || raw.type || 'Movie');
  var id = String(raw.Id || raw.id || '');
  var title = _trim(raw.Name || raw.name || 'Untitled');
  var genres = Array.isArray(raw.Genres) ? raw.Genres : (Array.isArray(raw.genres) ? raw.genres : []);
  var item = {
    id: _itemUri(id, type, raw.ParentId, raw.SeriesId, type === 'Season' ? id : raw.SeasonId),
    title: title,
    cover: raw.ImageTags && raw.ImageTags.Primary ? _imageUrl(ctx, id, 'Primary', 0, raw.ImageTags.Primary, 600) : _imageUrl(ctx, id, 'Primary', 0, null, 600),
    banner: raw.BackdropImageTags && raw.BackdropImageTags[0] ? _imageUrl(ctx, id, 'Backdrop', 0, raw.BackdropImageTags[0], 1000) : null,
    url: _itemUri(id, type, raw.ParentId, raw.SeriesId, type === 'Season' ? id : raw.SeasonId),
    description: raw.Overview || '',
    status: _status(raw.Status),
    genres: genres,
    studios: (raw.Studios || []).map(function (studio) { return studio && (studio.Name || studio.name); }).filter(Boolean),
    type: 'movie',
    sourceId: SOURCE_ID,
    year: _year(raw),
    episodes: episodes || [],
    subCount: (episodes || []).length,
    dubCount: 0,
    jellyfinItemId: id,
    jellyfinType: type
  };
  var score = _score(raw);
  if (score !== undefined) item.score = score;
  if (raw.ProviderIds) {
    var providers = raw.ProviderIds;
    item.imdbId = providers.Imdb || providers.IMDb || null;
    item.tmdbId = providers.Tmdb || providers.TMDB ? Number(providers.Tmdb || providers.TMDB) : undefined;
    item.tvdbId = providers.Tvdb || providers.TVDB || null;
  }
  if (Array.isArray(seasons) && seasons.length) item.seasons = seasons;
  return item;
}

function _mapLimit(items, limit, mapper) {
  var results = new Array(items.length);
  var next = 0;
  var workers = [];
  function run() {
    if (next >= items.length) return Promise.resolve();
    var index = next++;
    return Promise.resolve().then(function () { return mapper(items[index], index); }).then(function (value) {
      results[index] = value;
      return run();
    }, function () {
      results[index] = null;
      return run();
    });
  }
  for (var i = 0; i < Math.min(items.length, Math.max(1, limit)); i++) workers.push(run());
  return Promise.all(workers).then(function () { return results; });
}

function _getItems(ctx, params, options) {
  var query = Object.assign({
    UserId: ctx.userId,
    StartIndex: 0,
    Limit: ctx.config.pageSize,
    Recursive: 'true',
    SortBy: ctx.config.sortBy,
    SortOrder: 'Descending',
    Fields: LIST_FIELDS,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop,Logo'
  }, params || {});
  return _request(ctx, '/Users/' + encodeURIComponent(ctx.userId) + '/Items', query, options);
}

function _getViewItems(ctx, view, limit, searchTerm) {
  var types = _typesForView(view, ctx.config);
  if (!types.length) return Promise.resolve([]);
  var params = {
    ParentId: _viewId(view),
    Recursive: 'true',
    IncludeItemTypes: types.join(','),
    StartIndex: 0,
    Limit: limit || ctx.config.pageSize,
    SortBy: ctx.config.sortBy,
    SortOrder: 'Descending',
    Fields: LIST_FIELDS,
    EnableImageTypes: 'Primary,Backdrop'
  };
  if (searchTerm) params.SearchTerm = searchTerm;
  return _getItems(ctx, params).then(function (payload) {
    return _itemsFrom(payload).map(function (raw) { return _mapItem(raw, ctx, _viewId(view)); }).filter(Boolean);
  });
}

function _uniqueItems(groups) {
  var out = [];
  var seen = Object.create(null);
  groups.forEach(function (group) {
    (group || []).forEach(function (item) {
      var key = item && (item.jellyfinItemId || item.id);
      if (!item || seen[key]) return;
      seen[key] = true;
      out.push(item);
    });
  });
  return out;
}

function _section(title, promise) {
  return Promise.resolve(promise).then(function (items) {
    return items && items.length ? { title: title, items: items } : null;
  }).catch(function () { return null; });
}

function _resumeItems(ctx) {
  return _request(ctx, '/Users/' + encodeURIComponent(ctx.userId) + '/Items/Resume', {
    MediaTypes: 'Video',
    Limit: ctx.config.pageSize,
    Fields: LIST_FIELDS,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop,Thumb',
    EnableUserData: 'true'
  }, { noCache: true }).then(function (payload) {
    return _itemsFrom(payload).map(function (raw) {
      return _mapItem(raw, ctx, raw.ParentId);
    }).filter(Boolean);
  });
}

function _nextUpItems(ctx) {
  return _request(ctx, '/Shows/NextUp', {
    UserId: ctx.userId,
    Limit: ctx.config.pageSize,
    Fields: LIST_FIELDS,
    EnableUserData: 'true',
    EnableImageTypes: 'Primary,Backdrop'
  }, { noCache: true }).then(function (payload) {
    return _itemsFrom(payload).map(function (raw) {
      return _mapItem(raw, ctx, raw.ParentId);
    }).filter(Boolean);
  });
}

function _recentItems(ctx, views) {
  return Promise.all(views.map(function (view) {
    var types = _typesForView(view, ctx.config);
    if (!types.length) return [];
    return _getItems(ctx, {
      ParentId: _viewId(view),
      Recursive: 'true',
      IncludeItemTypes: types.join(','),
      SortBy: 'DateCreated,SortName',
      SortOrder: 'Descending',
      StartIndex: 0,
      Limit: ctx.config.pageSize,
      Fields: LIST_FIELDS
    }).then(function (payload) {
      return _itemsFrom(payload).map(function (raw) { return _mapItem(raw, ctx, _viewId(view)); }).filter(Boolean);
    }).catch(function () { return []; });
  })).then(_uniqueItems).then(function (items) {
    items.sort(function (a, b) { return String(b.dateCreated || '').localeCompare(String(a.dateCreated || '')); });
    return items.slice(0, ctx.config.pageSize);
  });
}

function _favoriteItems(ctx, views) {
  return Promise.all(views.map(function (view) {
    var types = _typesForView(view, ctx.config);
    if (!types.length) return [];
    return _getItems(ctx, {
      ParentId: _viewId(view),
      Recursive: 'true',
      IncludeItemTypes: types.join(','),
      Filters: 'IsFavorite',
      SortBy: ctx.config.sortBy,
      SortOrder: 'Descending',
      StartIndex: 0,
      Limit: ctx.config.pageSize,
      EnableUserData: 'true',
      Fields: LIST_FIELDS
    }).then(function (payload) {
      return _itemsFrom(payload).map(function (raw) { return _mapItem(raw, ctx, _viewId(view)); }).filter(Boolean);
    }).catch(function () { return []; });
  })).then(_uniqueItems).then(function (items) { return items.slice(0, ctx.config.pageSize); });
}

function getHome(opts) {
  return _context(false).then(function (ctx) {
    return _views(ctx).then(function (views) {
      var enabled = ctx.config.homeSections;
      var jobs = [];
      if (enabled.indexOf('resume') >= 0) jobs.push(_section('Continue Watching', _resumeItems(ctx)));
      if (enabled.indexOf('nextUp') >= 0) jobs.push(_section('Next Up', _nextUpItems(ctx)));
      if (enabled.indexOf('recent') >= 0) jobs.push(_section('Recently Added', _recentItems(ctx, views)));
      if (enabled.indexOf('favorites') >= 0) jobs.push(_section('Favorites', _favoriteItems(ctx, views)));
      if (enabled.indexOf('libraries') >= 0) {
        views.forEach(function (view) {
          jobs.push(_section(String(view.Name || 'Library'), _getViewItems(ctx, view, ctx.config.pageSize)));
        });
      }
      return Promise.all(jobs).then(function (rows) {
        return rows.filter(Boolean);
      });
    });
  });
}

function popular(opts) {
  return getHome(opts).then(function (rows) {
    return _uniqueItems(rows.map(function (row) { return row.items || []; }));
  });
}

function search(query, page, opts) {
  var term = _trim(query);
  if (!term) return Promise.resolve([]);
  var currentPage = Math.max(1, parseInt(page, 10) || 1);
  return _context(false).then(function (ctx) {
    return _views(ctx).then(function (views) {
      var offset = (currentPage - 1) * ctx.config.pageSize;
      var perLibraryLimit = Math.min(200, offset + ctx.config.pageSize);
      return Promise.all(views.map(function (view) {
        var types = _typesForView(view, ctx.config);
        if (!types.length) return [];
        return _getItems(ctx, {
          ParentId: _viewId(view),
          Recursive: 'true',
          IncludeItemTypes: types.join(','),
          SearchTerm: term,
          SortBy: 'SortName',
          SortOrder: 'Ascending',
          StartIndex: 0,
          Limit: perLibraryLimit,
          Fields: LIST_FIELDS
        }).then(function (payload) {
          return _itemsFrom(payload).map(function (raw) { return _mapItem(raw, ctx, _viewId(view)); }).filter(Boolean);
        }).catch(function () { return []; });
      })).then(function (groups) {
        var items = _uniqueItems(groups);
        items.sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || '')); });
        return items.slice(offset, offset + ctx.config.pageSize);
      });
    });
  });
}

function _getItem(ctx, itemId, fields, options) {
  return _request(ctx, '/Users/' + encodeURIComponent(ctx.userId) + '/Items/' + encodeURIComponent(String(itemId)), {
    Fields: fields || DETAIL_FIELDS,
    EnableImageTypes: 'Primary,Backdrop,Logo,Thumb'
  }, options);
}

function _getSeasons(ctx, seriesId) {
  return _request(ctx, '/Shows/' + encodeURIComponent(seriesId) + '/Seasons', {
    UserId: ctx.userId,
    Fields: LIST_FIELDS,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop'
  }).then(function (payload) {
    var rows = _itemsFrom(payload);
    if (rows.length) return rows;
    return _getItems(ctx, {
      ParentId: seriesId,
      IncludeItemTypes: 'Season',
      Recursive: 'false',
      SortBy: 'IndexNumber',
      SortOrder: 'Ascending',
      Fields: LIST_FIELDS
    }).then(_itemsFrom);
  }).catch(function () {
    return _getItems(ctx, {
      ParentId: seriesId,
      IncludeItemTypes: 'Season',
      Recursive: 'false',
      SortBy: 'IndexNumber',
      SortOrder: 'Ascending',
      Fields: LIST_FIELDS
    }).then(_itemsFrom);
  });
}

function _getSeasonEpisodes(ctx, seriesId, season) {
  var seasonId = String(season && (season.Id || season.id) || '');
  var params = {
    UserId: ctx.userId,
    Fields: EPISODE_FIELDS,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Thumb',
    SortBy: 'ParentIndexNumber,IndexNumber',
    SortOrder: 'Ascending',
    Limit: 500
  };
  if (seasonId) params.SeasonId = seasonId;
  return _request(ctx, '/Shows/' + encodeURIComponent(seriesId) + '/Episodes', params, { noCache: false }).then(function (payload) {
    var rows = _itemsFrom(payload);
    if (rows.length) return rows;
    return _getItems(ctx, {
      ParentId: seasonId || seriesId,
      IncludeItemTypes: 'Episode',
      Recursive: 'true',
      SortBy: 'ParentIndexNumber,IndexNumber',
      SortOrder: 'Ascending',
      Limit: 500,
      Fields: EPISODE_FIELDS
    }).then(_itemsFrom);
  }).catch(function () {
    return _getItems(ctx, {
      ParentId: seasonId || seriesId,
      IncludeItemTypes: 'Episode',
      Recursive: 'true',
      SortBy: 'ParentIndexNumber,IndexNumber',
      SortOrder: 'Ascending',
      Limit: 500,
      Fields: EPISODE_FIELDS
    }).then(_itemsFrom);
  });
}

function getDetail(url, opts) {
  var parsed = _parseItemUrl(url);
  if (!parsed || !parsed.id) return Promise.resolve(null);
  return _context(false).then(function (ctx) {
    return _getItem(ctx, parsed.id, DETAIL_FIELDS).then(function (raw) {
      if (!raw || !(raw.Id || raw.id)) return null;
      var type = String(raw.Type || parsed.type || 'Movie');
      if (type === 'Series') {
        return _getSeasons(ctx, parsed.id).then(function (seasons) {
          return _mapLimit(seasons, 3, function (season) {
            return _getSeasonEpisodes(ctx, parsed.id, season);
          }).then(function (groups) {
            var all = [];
            groups.forEach(function (episodes, index) {
              var season = seasons[index] || {};
              var seasonId = season.Id || season.id;
              (episodes || []).forEach(function (episode) {
                var mapped = _mapEpisode(episode, ctx, parsed.id, seasonId);
                if (mapped) all.push(mapped);
              });
            });
            if (!all.length) {
              return _getSeasonEpisodes(ctx, parsed.id, null).then(function (episodes) {
                all = episodes.map(function (episode) { return _mapEpisode(episode, ctx, parsed.id, episode.SeasonId); }).filter(Boolean);
                return _detailObject(raw, ctx, all, seasons.map(function (season) { return _mapItem(season, ctx, parsed.id); }).filter(Boolean));
              }).catch(function () {
                return _detailObject(raw, ctx, all, []);
              });
            }
            all.sort(function (a, b) {
              return (Number(a.season) - Number(b.season)) || (Number(a.number) - Number(b.number));
            });
            return _detailObject(raw, ctx, all, seasons.map(function (season) { return _mapItem(season, ctx, parsed.id); }).filter(Boolean));
          });
        });
      }
      if (type === 'Season') {
        return _getSeasonEpisodes(ctx, raw.SeriesId || parsed.seriesId || parsed.id, raw).then(function (episodes) {
          var mapped = episodes.map(function (episode) { return _mapEpisode(episode, ctx, raw.SeriesId || parsed.seriesId, parsed.id); }).filter(Boolean);
          return _detailObject(raw, ctx, mapped, []);
        });
      }
      if (type === 'Movie') {
        var movieEpisode = {
          id: 'movie',
          title: titleOrName(raw),
          number: 1,
          season: 0,
          url: _episodeUri(raw.Id || parsed.id, null, null, 0, 1)
        };
        return _detailObject(raw, ctx, [movieEpisode], []);
      }
      if (type === 'Episode') {
        return _detailObject(raw, ctx, [_mapEpisode(raw, ctx, raw.SeriesId || parsed.seriesId, raw.SeasonId || parsed.seasonId)].filter(Boolean), []);
      }
      if (type === 'BoxSet') {
        return _getItems(ctx, {
          ParentId: parsed.id,
          Recursive: 'false',
          IncludeItemTypes: 'Movie,Series,BoxSet',
          SortBy: 'SortName',
          SortOrder: 'Ascending',
          Limit: ctx.config.pageSize,
          Fields: LIST_FIELDS
        }).then(function (payload) {
          var children = _itemsFrom(payload).map(function (item) { return _mapItem(item, ctx, parsed.id); }).filter(Boolean);
          var result = _detailObject(raw, ctx, [], []);
          result.children = children;
          return result;
        });
      }
      return _detailObject(raw, ctx, [], []);
    });
  });
}

function titleOrName(raw) {
  return _trim(raw && (raw.Name || raw.name)) || 'Movie';
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) {
    return detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  });
}

function _isAbsoluteHttp(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function _absoluteServerUrl(ctx, value) {
  var text = String(value || '');
  if (_isAbsoluteHttp(text)) return text;
  return ctx.baseUrl.replace(/\/+$/, '') + '/' + text.replace(/^\/+/, '');
}

function _isInternalUrl(ctx, url) {
  try {
    var parsed = new URL(url);
    var base = new URL(ctx.baseUrl);
    if (parsed.origin !== base.origin) return false;
    var basePath = String(base.pathname || '').replace(/\/+$/, '');
    return !basePath || parsed.pathname === basePath || parsed.pathname.indexOf(basePath + '/') === 0;
  } catch (e) {
    return false;
  }
}

function _playerHeaders(ctx, url, requiredHeaders) {
  var headers = {};
  if (_isInternalUrl(ctx, url)) headers.Authorization = _authHeader(ctx.token);
  if (requiredHeaders && typeof requiredHeaders === 'object') {
    Object.keys(requiredHeaders).forEach(function (key) {
      headers[key] = String(requiredHeaders[key]);
    });
  }
  return headers;
}

function _deviceProfile(config) {
  return {
    Name: CLIENT_NAME,
    MaxStreamingBitrate: config.maxStreamingBitrate,
    MaxStaticBitrate: config.maxStreamingBitrate,
    MusicStreamingTranscodingBitrate: 192000,
    DirectPlayProfiles: [
      { Type: 'Video', Container: 'mp4,m4v,mov,mkv,webm,avi,ts', VideoCodec: 'h264,hevc,av1,vp9,mpeg4', AudioCodec: 'aac,mp3,opus,flac,ac3,eac3,vorbis,mp2' },
      { Type: 'Audio', Container: 'mp3,aac,m4a,flac,ogg,opus,wav', AudioCodec: 'aac,mp3,opus,flac,vorbis' }
    ],
    TranscodingProfiles: [
      { Type: 'Video', Container: 'ts', Protocol: 'hls', VideoCodec: 'h264', AudioCodec: 'aac,mp3', Context: 'Streaming', MaxAudioChannels: '8', EnableSubtitlesInManifest: 'true' },
      { Type: 'Video', Container: 'mp4', Protocol: 'http', VideoCodec: 'h264', AudioCodec: 'aac,mp3', Context: 'Streaming', MaxAudioChannels: '8' }
    ],
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'srt', Method: 'External' },
      { Format: 'ass', Method: 'External' },
      { Format: 'ssa', Method: 'External' }
    ]
  };
}

function _playbackInfo(ctx, itemId) {
  var body = {
    UserId: ctx.userId,
    IsPlayback: true,
    AutoOpenLiveStream: false,
    EnableDirectPlay: true,
    EnableDirectStream: true,
    EnableTranscoding: true,
    MaxStreamingBitrate: ctx.config.maxStreamingBitrate,
    EnableRequiredHttpHeaders: true,
    Fresh: true,
    DeviceProfile: _deviceProfile(ctx.config)
  };
  return _request(ctx, '/Items/' + encodeURIComponent(itemId) + '/PlaybackInfo', { UserId: ctx.userId }, {
    method: 'POST',
    body: body,
    noCache: true
  });
}

function _subtitleTracks(ctx, itemId, mediaSource) {
  if (!ctx.config.includeSubtitles) return [];
  var sourceId = mediaSource && (mediaSource.Id || mediaSource.id);
  var streams = mediaSource && (mediaSource.MediaStreams || mediaSource.mediaStreams);
  if (!sourceId || !Array.isArray(streams)) return [];
  return streams.filter(function (stream) {
    return stream && String(stream.Type || stream.type).toLowerCase() === 'subtitle' &&
      (stream.IsExternal === true || stream.SupportsExternalStream === true || stream.isExternal === true || stream.supportsExternalStream === true);
  }).map(function (stream) {
    var codec = String(stream.Codec || stream.codec || 'vtt').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'vtt';
    var index = Number(stream.Index != null ? stream.Index : stream.index);
    var path = '/Videos/' + encodeURIComponent(itemId) + '/' + encodeURIComponent(sourceId) +
      '/Subtitles/' + encodeURIComponent(String(index)) + '/0/Stream.' + encodeURIComponent(codec);
    var url = _joinUrl(ctx.baseUrl, path, {});
    return {
      url: url,
      label: stream.DisplayTitle || stream.displayTitle || stream.Language || stream.language || ('Subtitle ' + (index + 1)),
      lang: stream.Language || stream.language || '',
      format: codec,
      default: stream.IsDefault === true || stream.isDefault === true,
      headers: _playerHeaders(ctx, url, {})
    };
  });
}

function _qualityFor(source, url) {
  var extra = source && (source.aiostreams || source.AIOStreams) || {};
  var label = [
    extra.name || source.Name || source.name || '',
    extra.quality || extra.resolution || source.Resolution || source.resolution || '',
    extra.releaseGroup || extra.addon || extra.service || ''
  ].filter(Boolean).join(' · ');
  if (!label && source && (source.Container || source.container)) label = String(source.Container || source.container).toUpperCase();
  var match = String(label + ' ' + String(url || '')).match(/(2160p|4k|1080p|720p|480p|360p)/i);
  return { quality: match ? (match[1].toLowerCase() === '4k' ? '2160p' : match[1].toLowerCase()) : 'Auto', label: label || 'Jellyfin' };
}

function _containerFor(source, url) {
  var value = String(source && (source.TranscodingContainer || source.Container || source.container) || '').toLowerCase();
  var address = String(url || '').toLowerCase();
  if (value === 'm3u8' || value === 'hls' || /\.m3u8(?:[?#]|$)/.test(address)) return 'hls';
  if (value === 'mpd' || value === 'dash' || /\.mpd(?:[?#]|$)/.test(address)) return 'dash';
  if (/^(mp4|m4v|mov|webm)$/.test(value) || /\.(mp4|m4v|mov|webm)(?:[?#]|$)/.test(address)) return 'mp4';
  if (value) return value;
  return 'unknown';
}

function _mapMediaSource(ctx, itemId, mediaSource, playSessionId) {
  if (!mediaSource || typeof mediaSource !== 'object') return null;
  var id = String(mediaSource.Id || mediaSource.id || '');
  var required = mediaSource.RequiredHttpHeaders || mediaSource.requiredHttpHeaders || {};
  var path = mediaSource.Path || mediaSource.path || '';
  var direct = mediaSource.DirectStreamUrl || mediaSource.directStreamUrl || '';
  var transcode = mediaSource.TranscodingUrl || mediaSource.transcodingUrl || '';
  var sourceUrl = '';
  var isRemote = mediaSource.IsRemote === true || mediaSource.isRemote === true;

  if (ctx.config.preferTranscoding && transcode) {
    sourceUrl = _absoluteServerUrl(ctx, transcode);
  } else if (ctx.config.useRemoteUrl && isRemote && _isAbsoluteHttp(path)) {
    sourceUrl = path;
  } else if (direct) {
    sourceUrl = _absoluteServerUrl(ctx, direct);
  } else if (_isAbsoluteHttp(path)) {
    sourceUrl = path;
  } else if (transcode) {
    sourceUrl = _absoluteServerUrl(ctx, transcode);
  } else if (id) {
    sourceUrl = _joinUrl(ctx.baseUrl, '/Videos/' + encodeURIComponent(itemId) + '/stream', {
      static: 'true',
      MediaSourceId: id,
      PlaySessionId: playSessionId || undefined
    });
  }
  if (!sourceUrl || !_isAbsoluteHttp(sourceUrl)) return null;

  var quality = _qualityFor(mediaSource, sourceUrl);
  var subtitles = _subtitleTracks(ctx, itemId, mediaSource);
  var mapped = {
    url: sourceUrl,
    quality: quality.quality,
    label: quality.label,
    container: _containerFor(mediaSource, sourceUrl),
    headers: _playerHeaders(ctx, sourceUrl, required),
    kind: 'raw',
    mediaSourceId: id || undefined,
    subtitles: subtitles
  };
  var extra = mediaSource.aiostreams || mediaSource.AIOStreams;
  if (extra && extra.description) mapped.description = String(extra.description);
  var audio = mediaSource.MediaStreams || mediaSource.mediaStreams;
  if (Array.isArray(audio)) {
    mapped.audioTracks = audio.filter(function (stream) {
      return stream && String(stream.Type || stream.type).toLowerCase() === 'audio';
    }).map(function (stream) {
      return {
        lang: stream.Language || stream.language || '',
        label: stream.DisplayTitle || stream.displayTitle || stream.Language || stream.language || 'Audio',
        codec: stream.Codec || stream.codec || ''
      };
    });
  }
  return mapped;
}

function getVideoSources(episodeUrl, opts) {
  var parsed = _parseItemUrl(episodeUrl);
  if (!parsed || !parsed.id) return Promise.resolve([]);
  return _context(false).then(function (ctx) {
    return _playbackInfo(ctx, parsed.id).then(function (payload) {
      var sources = payload && (payload.MediaSources || payload.mediaSources);
      var playSessionId = payload && (payload.PlaySessionId || payload.playSessionId);
      if (!Array.isArray(sources) || !sources.length) {
        return _getItem(ctx, parsed.id, 'MediaSources,MediaStreams,ProviderIds').then(function (item) {
          sources = item && (item.MediaSources || item.mediaSources);
          return (Array.isArray(sources) ? sources : []).map(function (source) {
            return _mapMediaSource(ctx, parsed.id, source, playSessionId);
          }).filter(Boolean);
        }).catch(function () { return []; });
      }
      return sources.map(function (source) {
        return _mapMediaSource(ctx, parsed.id, source, playSessionId);
      }).filter(Boolean);
    }).catch(function (error) {
      console.warn('Jellyfin playback negotiation failed:', String(error));
      return _getItem(ctx, parsed.id, 'MediaSources,MediaStreams').then(function (item) {
        var sources = item && (item.MediaSources || item.mediaSources);
        return (Array.isArray(sources) ? sources : []).map(function (source) {
          return _mapMediaSource(ctx, parsed.id, source, '');
        }).filter(Boolean);
      }).catch(function () { return []; });
    });
  });
}

function getStreams(id, opts) {
  return getVideoSources(id, opts);
}

function getLinks(id, opts) {
  return getVideoSources(id, opts);
}

function _exports() {
  return {
    version: SOURCE_VERSION,
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
    _config: _config,
    _normalizeServerAddress: _normalizeServerAddress,
    _parseItemUrl: _parseItemUrl,
    _itemUri: _itemUri,
    _episodeUri: _episodeUri,
    _libraryKind: _libraryKind,
    _mapItem: _mapItem,
    _mapEpisode: _mapEpisode,
    _deviceProfile: _deviceProfile,
    _qualityFor: _qualityFor,
    _containerFor: _containerFor
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = _exports();
