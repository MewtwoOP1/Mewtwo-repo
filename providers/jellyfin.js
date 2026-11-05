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
var SOURCE_VERSION = '3.1.0';
var CLIENT_NAME = 'Zangetsu';
var DEVICE_NAME = 'Zangetsu';
var DEVICE_ID = 'zangetsu-jellyfin-source-v3';
var LIST_FIELDS = 'Overview,Genres,ProviderIds,PremiereDate,ProductionYear,CommunityRating,OfficialRating,Status,ImageTags,BackdropImageTags,ParentBackdropItemId,ParentBackdropImageTags,ParentLogoItemId,ParentLogoImageTag,SeriesId,SeriesName,SeriesPrimaryImageTag,ParentIndexNumber,IndexNumber,LocationType,DateCreated,UserData';
var DETAIL_FIELDS = LIST_FIELDS + ',EndDate,RunTimeTicks,People,Studios,IndexNumberEnd,ChildCount';
var EPISODE_FIELDS = 'Overview,Genres,PremiereDate,ProductionYear,ImageTags,ParentIndexNumber,IndexNumber,RunTimeTicks,DateCreated,SeriesId,SeriesName,SeasonId';
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
    logo: 'https://raw.githubusercontent.com/jellyfin/jellyfin-ux/master/logos/PNG-4x/jellyfin-icon--color-on-dark.png',
    type: 'movie',
    version: SOURCE_VERSION
  };
}

function getSettings() {
  return [
    { key: 'serverUrl', label: 'Server address', description: 'Jellyfin server URL, including its base path. For AIOStreams, use the address ending in /jellyfin.', type: 'text', default: '' },
    { key: 'username', label: 'Username', description: 'Jellyfin username. For AIOStreams, use the configuration UUID or alias.', type: 'text', default: '' },
    { key: 'password', label: 'Password', description: 'Jellyfin password. For AIOStreams, use the configuration password (append /PIN only when required).', type: 'text', default: '' },
    { key: 'apiKey', label: 'API key (optional)', description: 'Alternative to username and password. Use only if you know the API key and account permissions are correct.', type: 'text', default: '' },
    { key: 'userId', label: 'User ID (API key only)', description: 'Only needed when the server cannot automatically identify a user from the API key.', type: 'text', default: '' },
    { key: 'libraryId', label: 'Library ID (optional)', description: 'Leave blank to show all accessible libraries. Set this only to restrict the source to one library.', type: 'text', default: '' },
    { key: 'pageSize', label: 'Catalogue page size', description: 'Number of titles requested per catalogue page.', type: 'enum', default: '50', options: [{ value: '25', label: '25' }, { value: '50', label: '50' }, { value: '100', label: '100' }] },
    { key: 'maxStreamingBitrate', label: 'Maximum streaming bitrate', description: 'Maximum bitrate requested during playback negotiation.', type: 'enum', default: '40000000', options: [{ value: '16000000', label: '16 Mbps' }, { value: '25000000', label: '25 Mbps' }, { value: '40000000', label: '40 Mbps' }, { value: '80000000', label: '80 Mbps' }, { value: '1000000000', label: 'Device maximum' }] },
    { key: 'includeSubtitles', label: 'Include external subtitles', description: 'Include external subtitle tracks returned by the server.', type: 'bool', default: true }
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
  var types = ['Movie', 'Series', 'BoxSet'];

  return {
    serverUrl: _normalizeServerAddress(_setting('serverUrl')),
    username: _trim(_setting('username')),
    password: String(_setting('password') == null ? '' : _setting('password')),
    apiKey: _trim(_setting('apiKey')),
    userId: _trim(_setting('userId')),
    libraryId: _trim(_setting('libraryId')),
    pageSize: pageSize,
    homeSections: ['resume', 'nextUp', 'recent', 'favorites', 'libraries'],
    contentTypes: types,
    showCollections: true,
    sortBy: 'DateCreated',
    maxStreamingBitrate: bitrate,
    preferTranscoding: false,
    includeSubtitles: _bool(_setting('includeSubtitles'), true),
    useRemoteUrl: true,
    cacheTtl: 30000,
    requestTimeoutMs: 15000
  };
}

function _normalizeServerAddress(input) {
  var value = _trim(input);
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
  var match = value.match(/^(https?):\/\/([^/?#]+)([^?#]*)/i);
  if (!match || !match[2] || /[\s@]/.test(match[2])) {
    throw new Error('Enter a valid Jellyfin server address without embedded credentials.');
  }
  var scheme = match[1].toLowerCase();
  var host = match[2];
  var path = String(match[3] || '').replace(/\\/g, '/');
  path = path.replace(/\/+$/, '').replace(/\/web\/index\.html$/i, '').replace(/\/web$/i, '').replace(/\/+$/, '');
  return scheme + '://' + host + path;
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
  }).catch(function (error) {
    if (error && error.status === 401 && !options._authRetry && options.auth !== false && ctx.config) {
      // A server-side token can expire before the local session cache. Re-authenticate
      // once, replace the context credentials, and retry the exact API operation.
      return _login(ctx.config, true).then(function (session) {
        ctx.token = session.token;
        ctx.userId = session.userId || ctx.userId;
        return _request(ctx, path, params, Object.assign({}, options, {
          _authRetry: true,
          noCache: true
        }));
      });
    }
    throw error;
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
  if (!config.serverUrl) return Promise.reject(new Error('Enter the Jellyfin server address in source settings.'));
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
  if (status === 'hiatus') return 'hiatus';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'unknown';
}

function _numberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  var number = Number(value);
  return isFinite(number) ? number : null;
}

function _padNumber(value) {
  var number = Math.max(0, Math.floor(_numberOrNull(value) || 0));
  return number < 10 ? '0' + number : String(number);
}

// Jellyfin returns image tags for the item itself and for its parents. An
// episode often has no Primary image of its own, in which case Jellyfin exposes
// the series/season thumb instead of an episode screenshot.
function _primaryImageUrl(ctx, itemId, raw, width) {
  raw = raw || {};
  var primaryTag = raw.ImageTags && (raw.ImageTags.Primary || raw.ImageTags.primary);
  if (primaryTag) return _imageUrl(ctx, itemId, 'Primary', 0, primaryTag, width);
  var parentPrimaryId = raw.ParentPrimaryImageItemId || raw.parentPrimaryImageItemId;
  var parentPrimaryTag = raw.ParentPrimaryImageTag || raw.parentPrimaryImageTag;
  if (parentPrimaryId && parentPrimaryTag) return _imageUrl(ctx, parentPrimaryId, 'Primary', 0, parentPrimaryTag, width);
  var thumbId = raw.ParentThumbItemId || raw.parentThumbItemId;
  var thumbTag = raw.ParentThumbImageTag || raw.parentThumbImageTag;
  if (thumbId && thumbTag) return _imageUrl(ctx, thumbId, 'Thumb', 0, thumbTag, width);
  var seriesId = raw.SeriesId || raw.seriesId;
  var seriesTag = raw.SeriesPrimaryImageTag || raw.seriesPrimaryImageTag;
  if (seriesId && seriesTag) return _imageUrl(ctx, seriesId, 'Primary', 0, seriesTag, width);
  if (itemId) return _imageUrl(ctx, itemId, 'Primary', 0, null, width);
  return null;
}

function _backdropImageUrl(ctx, itemId, raw, width) {
  raw = raw || {};
  var ownTags = raw.BackdropImageTags || raw.backdropImageTags;
  if (itemId && Array.isArray(ownTags) && ownTags[0]) {
    return _imageUrl(ctx, itemId, 'Backdrop', 0, ownTags[0], width);
  }
  var parentId = raw.ParentBackdropItemId || raw.parentBackdropItemId;
  var parentTags = raw.ParentBackdropImageTags || raw.parentBackdropImageTags;
  if (parentId && Array.isArray(parentTags) && parentTags[0]) {
    return _imageUrl(ctx, parentId, 'Backdrop', 0, parentTags[0], width);
  }
  return null;
}

function _applyProviderIds(item, raw) {
  var providers = raw && (raw.ProviderIds || raw.providerIds);
  if (!providers) return item;
  item.imdbId = providers.Imdb || providers.IMDb || providers.imdb || null;
  var tmdb = providers.Tmdb != null ? providers.Tmdb : providers.TMDB;
  if (tmdb != null && isFinite(Number(tmdb))) item.tmdbId = Number(tmdb);
  item.tvdbId = providers.Tvdb || providers.TVDB || providers.tvdb || null;
  var mal = providers.MyAnimeList != null ? providers.MyAnimeList : providers.MAL;
  if (mal != null && isFinite(Number(mal))) item.malId = Number(mal);
  var anilist = providers.AniList != null ? providers.AniList : providers.Anilist;
  if (anilist != null && isFinite(Number(anilist))) item.anilistId = Number(anilist);
  if (providers.Kitsu != null && isFinite(Number(providers.Kitsu))) item.kitsuId = Number(providers.Kitsu);
  var anidb = providers.AniDB != null ? providers.AniDB : providers.Anidb;
  if (anidb != null && isFinite(Number(anidb))) item.anidbId = Number(anidb);
  return item;
}

function _mapItem(raw, ctx, parentId) {
  if (!raw || !(raw.Id || raw.id)) return null;
  var id = String(raw.Id || raw.id);
  var type = String(raw.Type || raw.type || 'Movie');
  if (['Movie', 'Series', 'BoxSet', 'Episode', 'Season'].indexOf(type) < 0) return null;
  if (!ctx.config.showCollections && type === 'BoxSet') return null;
  var rawName = _trim(raw.Name || raw.name || raw.OriginalTitle || raw.originalTitle);
  var name = type === 'Episode' ? (_trim(raw.SeriesName || raw.seriesName) || rawName) : rawName;
  if (!name) return null;
  var isTv = type === 'Series' || type === 'Season' || type === 'Episode';
  var itemUrl = type === 'Episode'
    ? _episodeUri(id, raw.SeriesId, raw.SeasonId, raw.ParentIndexNumber, raw.IndexNumber)
    : _itemUri(id, type, parentId || raw.ParentId, raw.SeriesId, type === 'Season' ? id : raw.SeasonId);
  var item = {
    id: itemUrl,
    url: itemUrl,
    title: name,
    cover: _primaryImageUrl(ctx, id, raw, 600),
    banner: _backdropImageUrl(ctx, id, raw, 1000),
    type: 'movie',
    sourceId: SOURCE_ID,
    tmdbIsTv: isTv,
    year: _year(raw),
    jellyfinItemId: id,
    jellyfinType: type,
    dateCreated: raw.DateCreated || raw.dateCreated || null
  };
  var score = _score(raw);
  if (score !== undefined) item.score = score;
  if (raw.SeriesId) item.jellyfinSeriesId = String(raw.SeriesId);
  if (raw.SeriesName) item.seriesName = raw.SeriesName;
  if (type === 'Episode') item.episodeTitle = rawName;
  return _applyProviderIds(item, raw);
}

function _mapEpisode(raw, ctx, seriesId, seasonId, fallbackSeason, fallbackEpisode) {
  if (!raw || !(raw.Id || raw.id)) return null;
  var id = String(raw.Id || raw.id);
  var season = _numberOrNull(raw.ParentIndexNumber != null ? raw.ParentIndexNumber : raw.parentIndexNumber);
  if (season === null) season = _numberOrNull(raw.SeasonNumber != null ? raw.SeasonNumber : raw.seasonNumber);
  if (season === null) season = _numberOrNull(fallbackSeason);
  if (season === null) season = 0;
  var episode = _numberOrNull(raw.IndexNumber != null ? raw.IndexNumber : raw.indexNumber);
  if (episode === null) episode = _numberOrNull(fallbackEpisode);
  if (episode === null) episode = 1;
  var rawTitle = _trim(raw.Name || raw.name || '');
  var label = 'S' + _padNumber(season) + ' E' + _padNumber(episode);
  var title = rawTitle || ('Episode ' + episode);
  if (!/^S\d+\s*E\d+/i.test(title)) title = label + ' - ' + title;
  var uri = _episodeUri(id, seriesId || raw.SeriesId, seasonId || raw.SeasonId, season, episode);
  var entry = {
    id: 'S' + _padNumber(season) + 'E' + _padNumber(episode),
    title: title,
    number: episode,
    season: season,
    url: uri,
    date: raw.PremiereDate || raw.DateCreated || null,
    thumbnail: _primaryImageUrl(ctx, id, raw, 420),
    summary: raw.Overview || ''
  };
  return entry;
}

function _detailObject(raw, ctx, episodes, seasons) {
  if (!raw) return null;
  var type = String(raw.Type || raw.type || 'Movie');
  var id = String(raw.Id || raw.id || '');
  var isTv = type === 'Series' || type === 'Season' || type === 'Episode';
  var title = _trim(raw.Name || raw.name || 'Untitled');
  var genres = Array.isArray(raw.Genres) ? raw.Genres : (Array.isArray(raw.genres) ? raw.genres : []);
  var item = {
    id: _itemUri(id, type, raw.ParentId, raw.SeriesId, type === 'Season' ? id : raw.SeasonId),
    title: title,
    cover: _primaryImageUrl(ctx, id, raw, 600),
    banner: _backdropImageUrl(ctx, id, raw, 1000),
    url: _itemUri(id, type, raw.ParentId, raw.SeriesId, type === 'Season' ? id : raw.SeasonId),
    description: raw.Overview || '',
    status: _status(raw.Status),
    genres: genres,
    studios: (raw.Studios || []).map(function (studio) { return studio && (studio.Name || studio.name); }).filter(Boolean),
    type: 'movie',
    sourceId: SOURCE_ID,
    tmdbIsTv: isTv,
    year: _year(raw),
    episodes: episodes || [],
    subCount: (episodes || []).length,
    dubCount: 0,
    jellyfinItemId: id,
    jellyfinType: type,
    dateCreated: raw.DateCreated || raw.dateCreated || null
  };
  var score = _score(raw);
  if (score !== undefined) item.score = score;
  _applyProviderIds(item, raw);
  var people = Array.isArray(raw.People) ? raw.People : [];
  item.cast = people.filter(function (person) {
    return person && String(person.Type || person.type || '').toLowerCase() === 'actor';
  }).map(function (person) { return person.Name || person.name; }).filter(Boolean);
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

function _genreForView(ctx, view) {
  var extension = view && (view.aiostreams || view.AIOStreams) || {};
  var features = ctx.aiostreams && ctx.aiostreams.features || {};
  if (!features.genreRequired || extension.genreRequired !== true) return Promise.resolve('');
  var viewId = _viewId(view);
  if (!viewId) return Promise.resolve('');
  return _request(ctx, '/Genres', { ParentId: viewId, UserId: ctx.userId }).then(function (payload) {
    var genres = _itemsFrom(payload);
    var selected = genres.filter(function (genre) { return String(genre.Name || genre.name || '').toLowerCase() === 'none'; })[0] || genres[0];
    return selected && (selected.Id || selected.id) ? String(selected.Id || selected.id) : '';
  }).catch(function () { return ''; });
}

function _getViewItems(ctx, view, limit, searchTerm) {
  var types = _typesForView(view, ctx.config);
  if (!types.length) return Promise.resolve([]);
  return _genreForView(ctx, view).then(function (genreId) {
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
  if (genreId) params.GenreIds = genreId;
  return _getItems(ctx, params).then(function (payload) {
    return _itemsFrom(payload).map(function (raw) { return _mapItem(raw, ctx, _viewId(view)); }).filter(Boolean);
  });
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
    EnableImageTypes: 'Primary,Backdrop,Thumb'
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
    return _genreForView(ctx, view).then(function (genreId) {
    var params = {
      ParentId: _viewId(view),
      Recursive: 'true',
      IncludeItemTypes: types.join(','),
      SortBy: 'DateCreated,SortName',
      SortOrder: 'Descending',
      StartIndex: 0,
      Limit: ctx.config.pageSize,
      Fields: LIST_FIELDS
    };
    if (genreId) params.GenreIds = genreId;
    return _getItems(ctx, params).then(function (payload) {
      return _itemsFrom(payload).map(function (raw) { return _mapItem(raw, ctx, _viewId(view)); }).filter(Boolean);
    }).catch(function () { return []; });
    });
  })).then(_uniqueItems).then(function (items) {
    items.sort(function (a, b) { return String(b.dateCreated || '').localeCompare(String(a.dateCreated || '')); });
    return items.slice(0, ctx.config.pageSize);
  });
}

function _favoriteItems(ctx, views) {
  return Promise.all(views.map(function (view) {
    var types = _typesForView(view, ctx.config);
    if (!types.length) return [];
    return _genreForView(ctx, view).then(function (genreId) {
    var params = {
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
    };
    if (genreId) params.GenreIds = genreId;
    return _getItems(ctx, params).then(function (payload) {
      return _itemsFrom(payload).map(function (raw) { return _mapItem(raw, ctx, _viewId(view)); }).filter(Boolean);
    }).catch(function () { return []; });
    });
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
        return _genreForView(ctx, view).then(function (genreId) {
        var params = {
          ParentId: _viewId(view),
          Recursive: 'true',
          IncludeItemTypes: types.join(','),
          SearchTerm: term,
          SortBy: 'SortName',
          SortOrder: 'Ascending',
          StartIndex: 0,
          Limit: perLibraryLimit,
          Fields: LIST_FIELDS
        };
        if (genreId) params.GenreIds = genreId;
        return _getItems(ctx, params).then(function (payload) {
          return _itemsFrom(payload).map(function (raw) { return _mapItem(raw, ctx, _viewId(view)); }).filter(Boolean);
        }).catch(function () { return []; });
        });
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
  function fallback() {
    return _getItems(ctx, {
      ParentId: seriesId,
      IncludeItemTypes: 'Season',
      Recursive: 'false',
      SortBy: 'IndexNumber',
      SortOrder: 'Ascending',
      Fields: LIST_FIELDS
    }).then(_itemsFrom);
  }
  return _request(ctx, '/Shows/' + encodeURIComponent(seriesId) + '/Seasons', {
    UserId: ctx.userId,
    Fields: LIST_FIELDS,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop'
  }).then(function (payload) {
    var rows = _itemsFrom(payload);
    return rows.length ? rows : fallback();
  }, function () {
    return fallback();
  }).catch(function () {
    // A series can still be opened with its episodes read from the
    // all-episodes endpoint when the season list is unavailable.
    return [];
  }).then(function (rows) {
    return (rows || []).slice().sort(function (a, b) {
      var left = _numberOrNull(a && (a.IndexNumber != null ? a.IndexNumber : a.indexNumber));
      var right = _numberOrNull(b && (b.IndexNumber != null ? b.IndexNumber : b.indexNumber));
      return (left === null ? Number.MAX_SAFE_INTEGER : left) - (right === null ? Number.MAX_SAFE_INTEGER : right);
    });
  });
}

function _collectEpisodePages(ctx, path, baseParams) {
  var output = [];
  var total = Infinity;
  function readPage(startIndex) {
    var params = Object.assign({}, baseParams, {
      StartIndex: startIndex,
      Limit: 500
    });
    return _request(ctx, path, params).then(function (payload) {
      var rows = _itemsFrom(payload);
      var reportedTotal = Number(payload && (payload.TotalRecordCount != null ? payload.TotalRecordCount : payload.totalRecordCount));
      if (isFinite(reportedTotal) && reportedTotal >= 0) total = reportedTotal;
      if (rows.length) output = output.concat(rows);
      var next = startIndex + rows.length;
      if (rows.length && next > startIndex && (next < total || (!isFinite(total) && rows.length >= 500))) {
        return readPage(next);
      }
      return output;
    });
  }
  return readPage(0);
}

function _getSeasonEpisodes(ctx, seriesId, season) {
  var seasonId = String(season && (season.Id || season.id) || '');
  var seq = 'ParentIndexNumber,IndexNumber';
  var params = {
    UserId: ctx.userId,
    Fields: EPISODE_FIELDS,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Thumb'
  };
  if (seasonId) params.SeasonId = seasonId;
  var primary = _collectEpisodePages(
    ctx,
    '/Shows/' + encodeURIComponent(seriesId) + '/Episodes',
    params
  );
  function fallback() {
    return _collectEpisodePages(ctx, '/Users/' + encodeURIComponent(ctx.userId) + '/Items', {
      ParentId: seasonId || seriesId,
      IncludeItemTypes: 'Episode',
      Recursive: 'true',
      SortBy: seq,
      SortOrder: 'Ascending',
      Fields: EPISODE_FIELDS
    });
  }
  return primary.then(function (rows) {
    return rows.length ? rows : fallback();
  }).catch(function () {
    return fallback();
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
          var mappedSeasons = seasons.map(function (season) { return _mapItem(season, ctx, parsed.id); }).filter(Boolean);
          var seasonNumbers = Object.create(null);
          seasons.forEach(function (season) {
            var seasonId = season.Id || season.id;
            var seasonNumber = season.IndexNumber != null ? season.IndexNumber : season.indexNumber;
            if (seasonId && seasonNumber != null) seasonNumbers[seasonId] = seasonNumber;
          });
          function finish(all) {
            all.sort(function (a, b) {
              return (Number(a.season) - Number(b.season)) || (Number(a.number) - Number(b.number));
            });
            return _detailObject(raw, ctx, all, mappedSeasons);
          }
          function fromGroups(groups) {
            var all = [];
            groups.forEach(function (episodes, index) {
              var season = seasons[index] || {};
              var seasonId = season.Id || season.id;
              var seasonNumber = season.IndexNumber != null ? season.IndexNumber : season.indexNumber;
              (episodes || []).forEach(function (episode, episodeIndex) {
                var mapped = _mapEpisode(episode, ctx, parsed.id, seasonId, seasonNumber, episodeIndex + 1);
                if (mapped) all.push(mapped);
              });
            });
            return all;
          }
          return _mapLimit(seasons, 3, function (season) {
            return _getSeasonEpisodes(ctx, parsed.id, season);
          }).then(function (groups) {
            var all = fromGroups(groups);
            var partial = groups.some(function (episodes) { return episodes === null; });
            if (!seasons.length || partial || !all.length) {
              // If one season failed there is no way to tell which episodes
              // are missing. The all-episodes route is authoritative and also
              // covers servers that do not implement the seasons endpoint.
              return _getSeasonEpisodes(ctx, parsed.id, null).then(function (episodes) {
                var recovered = (episodes || []).map(function (episode, index) {
                  var seasonId = episode.SeasonId;
                  var fallbackSeason = seasonId && seasonNumbers[seasonId] != null ? seasonNumbers[seasonId] : episode.ParentIndexNumber;
                  return _mapEpisode(episode, ctx, parsed.id, seasonId, fallbackSeason, index + 1);
                }).filter(Boolean);
                return finish(recovered.length ? recovered : all);
              }, function () {
                return finish(all);
              });
            }
            return finish(all);
          });
        });
      }
      if (type === 'Season') {
        var seasonSeriesId = raw.SeriesId || parsed.seriesId || parsed.id;
        var seasonItemId = raw.Id || parsed.id;
        return _getSeasonEpisodes(ctx, seasonSeriesId, raw).then(function (episodes) {
          var mapped = (episodes || []).map(function (episode, index) {
            return _mapEpisode(episode, ctx, seasonSeriesId, raw.SeasonId || seasonItemId, raw.IndexNumber, index + 1);
          }).filter(Boolean);
          return _detailObject(raw, ctx, mapped, []);
        }, function () {
          return _detailObject(raw, ctx, [], []);
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
        var episodeEntry = _mapEpisode(
          raw,
          ctx,
          raw.SeriesId || parsed.seriesId,
          raw.SeasonId || parsed.seasonId,
          raw.ParentIndexNumber,
          raw.IndexNumber
        );
        return _detailObject(raw, ctx, [episodeEntry].filter(Boolean), []);
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
  var target = String(url || '').match(/^(https?):\/\/([^/?#]+)([^?#]*)/i);
  var base = String(ctx.baseUrl || '').match(/^(https?):\/\/([^/?#]+)([^?#]*)/i);
  if (!target || !base) return false;
  if ((target[1] + '://' + target[2]).toLowerCase() !== (base[1] + '://' + base[2]).toLowerCase()) return false;
  var basePath = String(base[3] || '').replace(/\/+$/, '');
  var targetPath = String(target[3] || '');
  return !basePath || targetPath === basePath || targetPath.indexOf(basePath + '/') === 0;
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
      { Type: 'Video', Container: 'ts', Protocol: 'hls', VideoCodec: 'h264', AudioCodec: 'aac,mp3', Context: 'Streaming', MaxAudioChannels: '8', EnableSubtitlesInManifest: true },
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
    IsPlayback: false,
    AutoOpenLiveStream: false,
    EnableDirectPlay: true,
    EnableDirectStream: true,
    EnableTranscoding: true,
    MaxStreamingBitrate: ctx.config.maxStreamingBitrate,
    DeviceProfile: _deviceProfile(ctx.config)
  };
  var features = ctx.aiostreams && ctx.aiostreams.features || {};
  if (features.versions) {
    body.Fresh = true;
    body.EnableRequiredHttpHeaders = true;
  }
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
    var deliveryUrl = stream.DeliveryUrl || stream.deliveryUrl || stream.Path || stream.path || '';
    var path = '/Videos/' + encodeURIComponent(itemId) + '/' + encodeURIComponent(sourceId) +
      '/Subtitles/' + encodeURIComponent(String(index)) + '/0/Stream.' + encodeURIComponent(codec);
    var url = deliveryUrl ? _absoluteServerUrl(ctx, deliveryUrl) : _joinUrl(ctx.baseUrl, path, {});
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
  } else if (ctx.config.useRemoteUrl && isRemote && path) {
    sourceUrl = _absoluteServerUrl(ctx, path);
  } else if (direct) {
    sourceUrl = _absoluteServerUrl(ctx, direct);
  } else if (_isAbsoluteHttp(path) && !isRemote) {
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
    _mapMediaSource: _mapMediaSource,
    _subtitleTracks: _subtitleTracks,
    _deviceProfile: _deviceProfile,
    _qualityFor: _qualityFor,
    _containerFor: _containerFor
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = _exports();
