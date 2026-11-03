// Jellyfin for Zangetsu.
// Original JavaScript implementation based on Jellyfin's MediaBrowser API.
// NuvioMobile was reviewed as a behavioral reference; no Nuvio source code is copied.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'jellyfin';
var SOURCE_VERSION = '2.0.0';
var DEVICE_ID = 'zangetsu-jellyfin';
var CLIENT_NAME = 'Zangetsu';
var JF_AUTH = null;
var JF_AUTH_PENDING = null;
var JF_CACHE = Object.create(null);
var JF_CACHE_LIMIT = 100;

var LIST_FIELDS = 'Overview,Genres,ProviderIds,PremiereDate,ProductionYear,CommunityRating,Status,ImageTags,BackdropImageTags,ParentBackdropItemId,ParentBackdropImageTags,ParentLogoItemId,ParentLogoImageTag';
var DETAIL_FIELDS = LIST_FIELDS + ',EndDate,OfficialRating,RunTimeTicks,People,Studios,MediaSources,MediaStreams,UserData,SeriesId,SeriesName,SeriesPrimaryImageTag,ParentIndexNumber,IndexNumber,IndexNumberEnd,LocationType';

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
    { key: 'serverUrl', label: 'Jellyfin server address', description: 'Server address only. A reverse-proxy subpath is supported. You can enter a hostname and port without a scheme.', type: 'text', default: '' },
    { key: 'username', label: 'Jellyfin username', description: 'Username for the Jellyfin account that can access your libraries.', type: 'text', default: '' },
    { key: 'password', label: 'Jellyfin password', description: 'Password for that Jellyfin account. Zangetsu text settings are not password-masked; use a dedicated account with only the library permissions you need.', type: 'text', default: '' },
    { key: 'pageSize', label: 'Catalogue page size', description: 'Number of items requested per library and search page.', type: 'enum', default: '50', options: [{ value: '25', label: '25 items' }, { value: '50', label: '50 items' }, { value: '100', label: '100 items' }] },
    { key: 'homeSections', label: 'Home sections', description: 'Choose which Jellyfin rows appear on the source Home page.', type: 'multiEnum', default: ['resume', 'nextUp', 'recent', 'favorites', 'libraries'], options: [{ value: 'resume', label: 'Continue Watching' }, { value: 'nextUp', label: 'Next Up' }, { value: 'recent', label: 'Recently Added' }, { value: 'favorites', label: 'Favorites' }, { value: 'libraries', label: 'Libraries' }] },
    { key: 'contentTypes', label: 'Search and catalogue content', description: 'Choose the item types shown by search and the general catalogue rows.', type: 'multiEnum', default: ['Movie', 'Series'], options: [{ value: 'Movie', label: 'Movies' }, { value: 'Series', label: 'TV series' }, { value: 'Episode', label: 'Episodes' }, { value: 'Trailer', label: 'Trailers' }, { value: 'BoxSet', label: 'Collections / box sets' }] },
    { key: 'showCollections', label: 'Show collection libraries', description: 'Include BoxSet libraries and collection entries. Opening a collection lists the movies and series inside it.', type: 'bool', default: true },
    { key: 'sortBy', label: 'Library sorting', description: 'Sort order for library and popular rows.', type: 'enum', default: 'DateCreated', options: [{ value: 'DateCreated', label: 'Recently added' }, { value: 'SortName', label: 'Title' }, { value: 'CommunityRating', label: 'Community rating' }, { value: 'PremiereDate', label: 'Release date' }] },
    { key: 'maxStreamingBitrate', label: 'Maximum streaming bitrate', description: 'Upper bitrate advertised to Jellyfin when it chooses a direct stream or transcode.', type: 'enum', default: '40000000', options: [{ value: '16000000', label: '16 Mbps' }, { value: '25000000', label: '25 Mbps' }, { value: '40000000', label: '40 Mbps' }, { value: '80000000', label: '80 Mbps' }, { value: '1000000000', label: 'Server / device maximum' }] },
    { key: 'preferTranscoding', label: 'Prefer server transcoding', description: 'Put Jellyfin-provided HLS or remux streams before direct-play links when both are available.', type: 'bool', default: false },
    { key: 'includeSubtitles', label: 'Include external subtitles', description: 'Return external subtitle tracks provided by Jellyfin. Embedded tracks remain part of the video file.', type: 'bool', default: true },
    { key: 'cacheTtl', label: 'Catalogue cache', description: 'In-memory cache duration for successful GET requests.', type: 'enum', default: '30000', options: [{ value: '0', label: 'Disabled' }, { value: '15000', label: '15 seconds' }, { value: '30000', label: '30 seconds' }, { value: '60000', label: '1 minute' }] },
    { key: 'requestTimeoutMs', label: 'Server request timeout', description: 'Timeout for each Jellyfin API request.', type: 'enum', default: '10000', options: [{ value: '5000', label: '5 seconds' }, { value: '10000', label: '10 seconds' }, { value: '15000', label: '15 seconds' }, { value: '20000', label: '20 seconds' }] }
  ];
}

function _setting(key) {
  try {
    var values = typeof __settings !== 'undefined' && __settings ? __settings[SOURCE_ID] : null;
    return values && values[key] != null ? values[key] : null;
  } catch (e) {
    return null;
  }
}

function _bool(key, fallback) {
  var value = _setting(key);
  if (value == null) return fallback;
  return value === true || String(value).toLowerCase() === 'true';
}

function _allowedArray(value, allowed, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  var out = value.map(String).filter(function (item, index) {
    return allowed.indexOf(item) >= 0 && value.indexOf(item) === index;
  });
  return out.length ? out : fallback.slice();
}

function _normalizeServerAddress(input) {
  var value = String(input || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = 'http:' + '//' + value;
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
    throw new Error('The Jellyfin server address must not contain embedded credentials.');
  }
  parsed.search = '';
  parsed.hash = '';
  var path = String(parsed.pathname || '').replace(/\/+$/, '');
  path = path.replace(/\/web\/index\.html$/i, '').replace(/\/web$/i, '').replace(/\/+$/, '');
  parsed.pathname = path || '/';
  return parsed.toString().replace(/\/+$/, '');
}

function _config() {
  var pageSize = parseInt(_setting('pageSize'), 10);
  if ([25, 50, 100].indexOf(pageSize) < 0) pageSize = 50;

  var bitrate = parseInt(_setting('maxStreamingBitrate'), 10);
  if ([16000000, 25000000, 40000000, 80000000, 1000000000].indexOf(bitrate) < 0) bitrate = 40000000;

  var cacheTtl = parseInt(_setting('cacheTtl'), 10);
  if ([0, 15000, 30000, 60000].indexOf(cacheTtl) < 0) cacheTtl = 30000;

  var timeout = parseInt(_setting('requestTimeoutMs'), 10);
  if ([5000, 10000, 15000, 20000].indexOf(timeout) < 0) timeout = 10000;

  var types = _allowedArray(_setting('contentTypes'),
    ['Movie', 'Series', 'Episode', 'Trailer', 'BoxSet'], ['Movie', 'Series']);
  var sections = _allowedArray(_setting('homeSections'),
    ['resume', 'nextUp', 'recent', 'favorites', 'libraries'],
    ['resume', 'nextUp', 'recent', 'favorites', 'libraries']);
  var sort = String(_setting('sortBy') || 'DateCreated');
  if (['DateCreated', 'SortName', 'CommunityRating', 'PremiereDate'].indexOf(sort) < 0) sort = 'DateCreated';

  return {
    server: _normalizeServerAddress(_setting('serverUrl')),
    username: String(_setting('username') || '').trim(),
    password: String(_setting('password') || ''),
    pageSize: pageSize,
    homeSections: sections,
    contentTypes: types,
    showCollections: _bool('showCollections', true),
    sortBy: sort,
    maxStreamingBitrate: bitrate,
    preferTranscoding: _bool('preferTranscoding', false),
    includeSubtitles: _bool('includeSubtitles', true),
    cacheTtl: cacheTtl,
    requestTimeoutMs: timeout
  };
}

function _requireConfig() {
  var cfg = _config();
  if (!cfg.server) throw new Error('Enter the Jellyfin server address in Jellyfin → Settings.');
  if (!cfg.username || !cfg.password) {
    throw new Error('Enter your Jellyfin username and password in Jellyfin → Settings.');
  }
  return cfg;
}

function _cleanHeader(value) {
  return String(value == null ? '' : value).replace(/["\r\n]/g, '');
}

function _authorization(token) {
  var value = 'MediaBrowser Client="' + _cleanHeader(CLIENT_NAME) +
    '", Device="' + _cleanHeader(CLIENT_NAME) +
    '", DeviceId="' + _cleanHeader(DEVICE_ID) +
    '", Version="' + _cleanHeader(SOURCE_VERSION) + '"';
  if (token) value += ', Token="' + _cleanHeader(token) + '"';
  return value;
}

function _headers(token, extra) {
  var headers = {
    Accept: 'application/json',
    Authorization: _authorization(token)
  };
  Object.keys(extra || {}).forEach(function (key) {
    headers[key] = extra[key];
  });
  return headers;
}

function _buildUrl(cfg, path, query) {
  var raw = cfg.server + (String(path || '').charAt(0) === '/' ? String(path) : '/' + String(path || ''));
  var url = new URL(raw);
  url.search = '';
  url.hash = '';
  Object.keys(query || {}).forEach(function (key) {
    var value = query[key];
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(function (part) {
        url.searchParams.append(key, String(part));
      });
    } else {
      url.searchParams.append(key, String(value));
    }
  });
  return url.toString();
}

function _responseData(response, path) {
  var status = Number(response && (response.status || response.statusCode)) || 200;
  var body = response && response.body != null ? response.body : '';
  var data = body;
  if (typeof body === 'string') {
    try {
      data = JSON.parse(body || '{}');
    } catch (e) {
      if (status >= 200 && status < 300 && body) {
        throw new Error('Jellyfin returned invalid JSON for ' + path + '.');
      }
      data = {};
    }
  } else if (body == null) {
    data = {};
  }
  if (status < 200 || status >= 300) {
    var detail = data && (data.Message || data.message || data.Error || data.error_description);
    var error = new Error('Jellyfin request failed with HTTP ' + status +
      (detail ? ': ' + String(detail).slice(0, 160) : '') + '.');
    error.status = status;
    throw error;
  }
  return data || {};
}

function _rawRequest(cfg, token, path, query, options) {
  options = options || {};
  var method = String(options.method || 'GET').toUpperCase();
  var url = _buildUrl(cfg, path, query);
  var cacheKey = method + ':' + cfg.server + ':' + url;
  var now = Date.now();

  if (method === 'GET' && !options.noCache && cfg.cacheTtl > 0) {
    var cached = JF_CACHE[cacheKey];
    if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
  }

  var init = {
    method: method,
    headers: _headers(token, options.headers),
    timeoutMs: options.timeoutMs || cfg.requestTimeoutMs
  };
  if (options.body != null) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  return fetch(url, init).then(function (response) {
    var data = _responseData(response, path);
    if (method === 'GET' && !options.noCache && cfg.cacheTtl > 0) {
      JF_CACHE[cacheKey] = { value: data, expiresAt: now + cfg.cacheTtl };
      var keys = Object.keys(JF_CACHE);
      while (keys.length > JF_CACHE_LIMIT) delete JF_CACHE[keys.shift()];
    }
    return data;
  }).catch(function (error) {
    if (error && error.status) throw error;
    var wrapped = new Error('Could not reach the Jellyfin server for ' + path + '.');
    wrapped.cause = error;
    throw wrapped;
  });
}

function _fingerprint(cfg) {
  return [cfg.server, cfg.username, cfg.password].join('\u001f');
}

function _versionAtLeast(version, minimum) {
  var actual = String(version || '').split('.').map(function (part) {
    var value = part.match(/^\d+/);
    return value ? parseInt(value[0], 10) : 0;
  });
  if (!actual.length || !/^\d/.test(String(version || ''))) return false;
  var wanted = String(minimum).split('.').map(function (part) { return parseInt(part, 10) || 0; });
  for (var i = 0; i < wanted.length; i++) {
    var a = actual[i] || 0;
    if (a !== wanted[i]) return a > wanted[i];
  }
  return true;
}

function _clearSession() {
  JF_AUTH = null;
  JF_AUTH_PENDING = null;
  Object.keys(JF_CACHE).forEach(function (key) { delete JF_CACHE[key]; });
}

function _discoverAndLogin(cfg, fingerprint) {
  var publicInfo;
  return _rawRequest(cfg, null, '/System/Info/Public', {}, { noCache: true })
    .then(function (info) {
      publicInfo = info || {};
      if (!_versionAtLeast(publicInfo.Version, '10.9.0')) {
        throw new Error('Jellyfin 10.9 or later is required. This server reports ' + String(publicInfo.Version || 'an unknown version') + '.');
      }
      return _rawRequest(cfg, null, '/Users/AuthenticateByName', {}, {
        method: 'POST',
        noCache: true,
        body: { Username: cfg.username, Pw: cfg.password }
      });
    })
    .then(function (result) {
      var user = result && result.User ? result.User : {};
      var token = String(result && result.AccessToken || '');
      if (!token || !user.Id) throw new Error('Jellyfin did not return an authenticated user and access token.');
      return {
        config: cfg,
        fingerprint: fingerprint,
        token: token,
        userId: String(user.Id),
        userName: String(user.Name || cfg.username),
        serverName: String(publicInfo.ServerName || 'Jellyfin'),
        serverId: String(result.ServerId || publicInfo.Id || ''),
        publicInfo: publicInfo,
        expiresAt: Date.now() + 20 * 60 * 1000
      };
    })
    .catch(function (error) {
      if (error && error.status === 401) {
        throw new Error('Jellyfin rejected the username or password. Verify both in the Jellyfin web client.');
      }
      if (error && error.status === 403) {
        throw new Error('This Jellyfin account is not allowed to sign in through the server API.');
      }
      throw error;
    });
}

function _getContext(force) {
  var cfg = _requireConfig();
  var fingerprint = _fingerprint(cfg);
  if (JF_AUTH && JF_AUTH.fingerprint !== fingerprint) _clearSession();

  if (!force && JF_AUTH && JF_AUTH.expiresAt > Date.now()) {
    return Promise.resolve(JF_AUTH);
  }
  if (JF_AUTH_PENDING && JF_AUTH_PENDING.fingerprint === fingerprint) {
    return JF_AUTH_PENDING.promise;
  }

  var pending = _discoverAndLogin(cfg, fingerprint);
  JF_AUTH_PENDING = { fingerprint: fingerprint, promise: pending };
  return pending.then(function (ctx) {
    JF_AUTH = ctx;
    if (JF_AUTH_PENDING && JF_AUTH_PENDING.fingerprint === fingerprint) JF_AUTH_PENDING = null;
    return ctx;
  }, function (error) {
    if (JF_AUTH_PENDING && JF_AUTH_PENDING.fingerprint === fingerprint) JF_AUTH_PENDING = null;
    throw error;
  });
}

function _request(path, query, options) {
  options = options || {};
  return _getContext(false).then(function (ctx) {
    return _rawRequest(ctx.config, ctx.token, path, query, options).then(function (value) {
      return { value: value, context: ctx };
    });
  }).catch(function (error) {
    if (error && error.status === 401 && !options.noAuthRetry) {
      _clearSession();
      return _getContext(true).then(function (ctx) {
        return _rawRequest(ctx.config, ctx.token, path, query, Object.assign({}, options, {
          noAuthRetry: true,
          noCache: true
        })).then(function (value) {
          return { value: value, context: ctx };
        });
      });
    }
    throw error;
  }).then(function (wrapped) {
    return { data: wrapped.value, context: wrapped.context };
  });
}

function _requestWithContext(ctx, path, query, options) {
  options = options || {};
  return _rawRequest(ctx.config, ctx.token, path, query, options).catch(function (error) {
    if (!error || error.status !== 401 || options.noAuthRetry) throw error;
    // A parallel batch of requests can all see the same expired token. Reuse
    // the in-flight login so the batch performs one refresh, not one per row.
    if (JF_AUTH && JF_AUTH.token !== ctx.token && JF_AUTH.expiresAt > Date.now()) {
      return _rawRequest(JF_AUTH.config, JF_AUTH.token, path, query, Object.assign({}, options, {
        noAuthRetry: true,
        noCache: true
      }));
    }
    return _getContext(true).then(function (fresh) {
      return _rawRequest(fresh.config, fresh.token, path, query, Object.assign({}, options, {
        noAuthRetry: true,
        noCache: true
      }));
    });
  });
}

function _fieldsQuery(cfg) {
  return {
    fields: LIST_FIELDS,
    imageTypeLimit: '1',
    enableImageTypes: 'Primary,Backdrop,Logo',
    enableUserData: 'true'
  };
}

function _detailQuery() {
  return {
    fields: DETAIL_FIELDS,
    imageTypeLimit: '1',
    enableImageTypes: 'Primary,Backdrop,Logo,Thumb',
    enableUserData: 'true'
  };
}

function _views(ctx) {
  return _requestWithContext(ctx, '/UserViews', {
    userId: ctx.userId,
    includeExternalContent: false
  }).then(function (data) {
    return Array.isArray(data.Items) ? data.Items : [];
  });
}

function _libraryKind(view) {
  var collection = String(view && view.CollectionType || '').toLowerCase();
  if (collection === 'movies') return 'movies';
  if (collection === 'tvshows') return 'series';
  if (collection === 'boxsets') return 'collections';
  if (collection === 'music' || collection === 'books' || collection === 'photos') return null;
  if (!collection && String(view && view.Type || '').toLowerCase() === 'collectionfolder') return 'mixed';
  if (collection === 'mixed') return 'mixed';
  return null;
}

function _viewsForUser(ctx) {
  return _views(ctx).then(function (views) {
    return views.map(function (view) {
      return { raw: view, kind: _libraryKind(view) };
    }).filter(function (view) {
      return view.kind && (ctx.config.showCollections || view.kind !== 'collections');
    });
  });
}

function _libraryTypes(kind, cfg) {
  var allowed = cfg.contentTypes.slice();
  if (kind === 'movies') allowed = allowed.filter(function (x) { return x === 'Movie' || x === 'Episode' || x === 'Trailer'; });
  else if (kind === 'series') allowed = allowed.filter(function (x) { return x === 'Series' || x === 'Episode' || x === 'Trailer'; });
  else if (kind === 'collections') allowed = ['BoxSet'];
  else if (kind === 'mixed') allowed = allowed.filter(function (x) { return x !== 'BoxSet'; });
  if (cfg.showCollections && kind === 'collections' && allowed.indexOf('BoxSet') < 0) allowed.push('BoxSet');
  return allowed;
}

function _globalTypes(cfg) {
  var types = cfg.contentTypes.slice();
  if (cfg.showCollections && types.indexOf('BoxSet') < 0) types.push('BoxSet');
  return types;
}

function _viewItems(ctx, view, start, limit, extra) {
  var kind = view.kind;
  var types = _libraryTypes(kind, ctx.config);
  if (!types.length) return Promise.resolve({ Items: [], TotalRecordCount: 0 });
  var query = Object.assign({}, _fieldsQuery(ctx.config), {
    userId: ctx.userId,
    parentId: view.raw.Id,
    recursive: kind === 'collections' ? 'false' : 'true',
    includeItemTypes: types.join(','),
    sortBy: ctx.config.sortBy === 'DateCreated' ? 'DateCreated,SortName' : ctx.config.sortBy,
    sortOrder: kind === 'collections' ? 'Ascending' : 'Descending',
    startIndex: String(start),
    limit: String(limit),
    enableTotalRecordCount: 'true'
  }, extra || {});
  return _requestWithContext(ctx, '/Items', query);
}

function _items(ctx, path, query, options) {
  return _requestWithContext(ctx, path || '/Items', Object.assign({
    userId: ctx.userId
  }, query || {}), options);
}

function _imageUrl(ctx, itemId, imageType, tag, maxWidth, maxHeight) {
  var query = { quality: '90' };
  if (tag) query.tag = tag;
  if (maxWidth) query.maxWidth = String(maxWidth);
  if (maxHeight) query.maxHeight = String(maxHeight);
  return _buildUrl(ctx.config, '/Items/' + encodeURIComponent(String(itemId)) +
    '/Images/' + imageType, query);
}

function _itemUrl(itemId, type) {
  var url = 'jellyfin://' + encodeURIComponent(String(itemId));
  return String(type || '').toLowerCase() === 'boxset' ? url + '?collection=1' : url;
}

function _externalIds(raw) {
  var ids = raw && raw.ProviderIds ? raw.ProviderIds : {};
  function value(keys) {
    for (var i = 0; i < keys.length; i++) {
      var found = ids[keys[i]] || ids[keys[i].toLowerCase()];
      if (found != null && String(found).trim()) return String(found).trim();
    }
    return null;
  }
  function integer(input) {
    var parsed = parseInt(input, 10);
    return isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return {
    imdbId: value(['Imdb', 'IMDb']),
    tmdbId: integer(value(['Tmdb', 'TMDB'])),
    malId: integer(value(['MyAnimeList', 'Mal', 'MAL'])),
    anilistId: integer(value(['AniList', 'Anilist']))
  };
}

function _imageHeaders(ctx) {
  return _headers(ctx.token);
}

function _imageFor(raw, ctx, kind) {
  var tags = raw && raw.ImageTags ? raw.ImageTags : {};
  if (kind === 'poster' && tags.Primary) return _imageUrl(ctx, raw.Id, 'Primary', tags.Primary, null, 600);
  if (kind === 'logo' && tags.Logo) return _imageUrl(ctx, raw.Id, 'Logo', tags.Logo, 800, null);
  if (kind === 'backdrop' && raw.BackdropImageTags && raw.BackdropImageTags.length) {
    return _imageUrl(ctx, raw.Id, 'Backdrop/0', raw.BackdropImageTags[0], 1920, null);
  }
  if (kind === 'backdrop' && raw.ParentBackdropItemId && raw.ParentBackdropImageTags && raw.ParentBackdropImageTags.length) {
    return _imageUrl(ctx, raw.ParentBackdropItemId, 'Backdrop/0', raw.ParentBackdropImageTags[0], 1920, null);
  }
  return null;
}

function _mediaType(raw) {
  var type = String(raw && raw.Type || '').toLowerCase();
  return ['movie', 'series', 'boxset', 'folder', 'episode', 'trailer'].indexOf(type) >= 0 ? type : null;
}

function _mapItem(raw, ctx) {
  if (!raw || !raw.Id || !raw.Name) return null;
  var type = _mediaType(raw);
  if (!type || String(raw.LocationType || '').toLowerCase() === 'virtual') return null;
  if ((type === 'boxset' || type === 'folder') && !ctx.config.showCollections) return null;
  var ids = _externalIds(raw);
  var rating = raw.CommunityRating != null && isFinite(Number(raw.CommunityRating))
    ? Math.max(0, Math.min(100, Math.round(Number(raw.CommunityRating) * 10))) : null;
  var item = {
    id: _itemUrl(raw.Id, type),
    url: _itemUrl(raw.Id, type),
    title: String(raw.Name),
    cover: _imageFor(raw, ctx, 'poster'),
    coverHeaders: _imageHeaders(ctx),
    banner: _imageFor(raw, ctx, 'backdrop'),
    type: 'movie',
    sourceId: SOURCE_ID,
    genres: Array.isArray(raw.Genres) ? raw.Genres : [],
    year: raw.ProductionYear != null ? String(raw.ProductionYear) : (raw.PremiereDate ? String(raw.PremiereDate).slice(0, 4) : null),
    score: rating,
    imdbId: ids.imdbId,
    tmdbId: ids.tmdbId,
    tmdbIsTv: type === 'series',
    malId: ids.malId,
    anilistId: ids.anilistId,
    status: raw.Status === 'Continuing' ? 'ongoing' : (raw.Status === 'Ended' ? 'completed' : 'unknown'),
    jellyfinId: String(raw.Id),
    jellyfinType: type,
    _dateCreated: raw.DateCreated || null
  };
  if (type === 'episode') {
    item.seasonNumber = raw.ParentIndexNumber == null ? null : Number(raw.ParentIndexNumber);
    item.episodeNumber = raw.IndexNumber == null ? null : Number(raw.IndexNumber);
    if (raw.SeriesName) item.title = String(raw.SeriesName) + ' · ' +
      'S' + _pad(item.seasonNumber) + 'E' + _pad(item.episodeNumber) + ' · ' + String(raw.Name);
  }
  return item;
}

function _mapResume(raw, ctx) {
  if (String(raw && raw.Type || '').toLowerCase() !== 'episode' || !raw.SeriesId) return _mapItem(raw, ctx);
  var series = Object.assign({}, raw, {
    Id: raw.SeriesId,
    Name: raw.SeriesName || raw.Name,
    Type: 'Series',
    ImageTags: raw.SeriesPrimaryImageTag
      ? { Primary: raw.SeriesPrimaryImageTag }
      : {},
    BackdropImageTags: raw.ParentBackdropImageTags || raw.BackdropImageTags || [],
    ParentBackdropItemId: raw.ParentBackdropItemId,
    ParentBackdropImageTags: raw.ParentBackdropImageTags || []
  });
  return _mapItem(series, ctx);
}

function _pad(value) {
  if (value == null || !isFinite(Number(value))) return '00';
  return String(Math.max(0, Math.floor(Number(value)))).padStart(2, '0');
}

function _mapEpisode(raw, ctx) {
  if (!raw || !raw.Id) return null;
  var season = raw.ParentIndexNumber == null ? null : Number(raw.ParentIndexNumber);
  var number = raw.IndexNumber == null ? null : Number(raw.IndexNumber);
  var title = String(raw.Name || (number == null ? 'Episode' : 'Episode ' + number));
  if (season != null && number != null) title = 'S' + _pad(season) + ' E' + _pad(number) + ' · ' + title;
  var image = raw.ImageTags && raw.ImageTags.Primary
    ? _imageUrl(ctx, raw.Id, 'Primary', raw.ImageTags.Primary, 640, null) : null;
  return {
    id: String(raw.Id),
    title: title,
    number: number,
    season: season,
    url: 'jellyfin://' + encodeURIComponent(String(raw.Id)),
    date: raw.PremiereDate || null,
    thumbnail: image,
    description: raw.Overview || null,
    runtimeMinutes: raw.RunTimeTicks ? Math.round(Number(raw.RunTimeTicks) / 600000000) : null
  };
}

function _pageEpisodes(ctx, seriesId, startIndex) {
  return _requestWithContext(ctx, '/Shows/' + encodeURIComponent(seriesId) + '/Episodes', {
    userId: ctx.userId,
    fields: DETAIL_FIELDS,
    startIndex: String(startIndex),
    limit: '500',
    isMissing: 'false',
    enableUserData: 'true',
    imageTypeLimit: '1',
    enableImageTypes: 'Primary,Backdrop,Logo'
  });
}

function _getAllEpisodes(ctx, seriesId) {
  return _pageEpisodes(ctx, seriesId, 0).then(function (first) {
    var rawItems = Array.isArray(first.Items) ? first.Items : [];
    var total = Number(first.TotalRecordCount);
    var offsets = [];
    if (isFinite(total) && total > rawItems.length) {
      var count = Math.min(20, Math.ceil(total / 500));
      for (var offset = 500; offset < count * 500; offset += 500) offsets.push(offset);
    } else if (rawItems.length >= 500) {
      offsets.push(500);
    }
    function fetchBatch(index) {
      if (index >= offsets.length) return Promise.resolve(rawItems);
      var batch = offsets.slice(index, index + 3);
      return Promise.all(batch.map(function (offset) { return _pageEpisodes(ctx, seriesId, offset); }))
        .then(function (results) {
          results.forEach(function (data) {
            var rows = Array.isArray(data.Items) ? data.Items : [];
            rawItems = rawItems.concat(rows);
            if ((!isFinite(total) || total <= 0) && rows.length >= 500 && offsets.length < 20) {
              offsets.push(offsets[offsets.length - 1] + 500);
            }
          });
          return fetchBatch(index + batch.length);
        });
    }
    return fetchBatch(0).then(function (rows) {
      var seen = Object.create(null);
      return rows.map(function (raw) {
        var episode = _mapEpisode(raw, ctx);
        if (!episode || seen[episode.id]) return null;
        seen[episode.id] = true;
        return episode;
      }).filter(Boolean);
    });
  });
}

function _getCollectionItems(ctx, collectionId) {
  var all = [];
  function page(start) {
    return _requestWithContext(ctx, '/Items', {
      userId: ctx.userId,
      parentId: collectionId,
      recursive: 'false',
      fields: DETAIL_FIELDS,
      imageTypeLimit: '1',
      enableImageTypes: 'Primary,Backdrop,Logo',
      startIndex: String(start),
      limit: String(ctx.config.pageSize),
      enableTotalRecordCount: 'true'
    }).then(function (data) {
      var rows = Array.isArray(data.Items) ? data.Items : [];
      all = all.concat(rows);
      var total = Number(data.TotalRecordCount);
      if (start + rows.length < total && rows.length) return page(start + rows.length);
      return all;
    });
  }
  return page(0).then(function (rows) {
    return rows.map(function (raw) {
      var item = _mapItem(raw, ctx);
      if (!item) return null;
      return {
        id: item.jellyfinId,
        title: item.title,
        number: null,
        season: null,
        url: item.url,
        thumbnail: item.cover,
        date: item.year ? item.year + '-01-01' : null,
        description: raw.Overview || null
      };
    }).filter(Boolean);
  });
}

function _parseItemUrl(value) {
  var text = String(value || '');
  var match = text.match(/^jellyfin:\/\/([^/?#]+)(?:\?collection=1)?$/i);
  if (!match) return null;
  try {
    return {
      id: decodeURIComponent(match[1]),
      collection: /\?collection=1$/i.test(text)
    };
  } catch (e) {
    return null;
  }
}

function _detail(raw, ctx, parsed) {
  var mapped = _mapItem(raw, ctx);
  if (!mapped) throw new Error('This Jellyfin item is unavailable or unsupported.');
  var ids = _externalIds(raw);
  var detail = {
    id: String(raw.Id),
    title: String(raw.Name || ''),
    englishTitle: null,
    url: mapped.url,
    cover: mapped.cover,
    coverHeaders: mapped.coverHeaders,
    banner: mapped.banner,
    description: raw.Overview || '',
    status: mapped.status,
    genres: Array.isArray(raw.Genres) ? raw.Genres : [],
    studios: Array.isArray(raw.Studios) ? raw.Studios.map(function (studio) { return studio && studio.Name; }).filter(Boolean) : [],
    cast: Array.isArray(raw.People) ? raw.People.filter(function (person) {
      return person && String(person.Type || '').toLowerCase() === 'actor' && person.Name;
    }).slice(0, 20).map(function (person) { return String(person.Name); }) : [],
    year: mapped.year,
    type: 'movie',
    sourceId: SOURCE_ID,
    episodes: [],
    subCount: 0,
    dubCount: 0,
    tmdbId: ids.tmdbId,
    tmdbIsTv: String(raw.Type || '').toLowerCase() === 'series',
    imdbId: ids.imdbId,
    malId: ids.malId,
    anilistId: ids.anilistId
  };
  var type = String(raw.Type || '').toLowerCase();
  if (type === 'series') {
    return _getAllEpisodes(ctx, String(raw.Id)).then(function (episodes) {
      detail.episodes = episodes;
      detail.subCount = episodes.length;
      return detail;
    });
  }
  if (type === 'boxset' || (type === 'folder' && parsed.collection)) {
    return _getCollectionItems(ctx, String(raw.Id)).then(function (episodes) {
      detail.episodes = episodes;
      detail.subCount = episodes.length;
      return detail;
    });
  }
  if (['movie', 'episode', 'trailer', 'video'].indexOf(type) >= 0) {
    detail.episodes = [{
      id: String(raw.Id),
      title: detail.title,
      number: 1,
      season: 1,
      url: mapped.url
    }];
    detail.subCount = 1;
  }
  return Promise.resolve(detail);
}

function _detailContext(url) {
  var parsed = _parseItemUrl(url);
  if (!parsed) return Promise.reject(new Error('Invalid Jellyfin item URL.'));
  return _getContext(false).then(function (ctx) { return { context: ctx, parsed: parsed }; });
}

function getDetail(url, opts) {
  return _detailContext(url).then(function (result) {
    return _requestWithContext(result.context, '/Items/' + encodeURIComponent(result.parsed.id), Object.assign({
      userId: result.context.userId
    }, _detailQuery())).then(function (raw) {
      return _detail(raw, result.context, result.parsed);
    });
  });
}

function getEpisodes(url, opts) {
  return _detailContext(url).then(function (result) {
    if (result.parsed.collection) return _getCollectionItems(result.context, result.parsed.id);
    return _getAllEpisodes(result.context, result.parsed.id);
  });
}

function _absoluteServerUrl(ctx, rawUrl) {
  var value = String(rawUrl || '').trim();
  if (!value) return '';
  var base = new URL(ctx.config.server);
  if (/^https?:\/\//i.test(value)) {
    var absolute = new URL(value);
    if (absolute.origin !== base.origin) {
      throw new Error('Jellyfin returned a playback URL outside the configured server.');
    }
    if (base.pathname !== '/' && absolute.pathname.indexOf(base.pathname.replace(/\/+$/, '') + '/') !== 0 &&
        absolute.pathname !== base.pathname.replace(/\/+$/, '')) {
      absolute.pathname = base.pathname.replace(/\/+$/, '') + absolute.pathname;
    }
    return absolute.toString();
  }
  var path = value.charAt(0) === '/' ? value : '/' + value;
  var basePath = String(base.pathname || '').replace(/\/+$/, '');
  if (basePath && (path === basePath || path.indexOf(basePath + '/') === 0)) {
    return base.origin + path;
  }
  return ctx.config.server + path;
}

function _appendQuery(value, params) {
  var url = new URL(value);
  Object.keys(params || {}).forEach(function (key) {
    var item = params[key];
    if (item !== undefined && item !== null && item !== '') url.searchParams.set(key, String(item));
  });
  return url.toString();
}

function _formatSubtitle(codec) {
  var value = String(codec || '').toLowerCase();
  if (value === 'subrip') return 'srt';
  if (value === 'webvtt') return 'vtt';
  return value || 'srt';
}

function _externalSubtitles(source, itemId, ctx) {
  if (!ctx.config.includeSubtitles) return [];
  var streams = Array.isArray(source.MediaStreams) ? source.MediaStreams : [];
  return streams.filter(function (stream) {
    if (String(stream.Type || '').toLowerCase() !== 'subtitle') return false;
    var delivery = String(stream.DeliveryMethod || '').toLowerCase();
    return delivery === 'external' || stream.IsExternal === true;
  }).map(function (stream) {
    var index = Number(stream.Index);
    if (!isFinite(index)) return null;
    var sourceId = String(source.Id || itemId);
    var ext = _formatSubtitle(stream.Codec);
    var rawUrl = stream.DeliveryUrl;
    if (!rawUrl) {
      rawUrl = '/Videos/' + encodeURIComponent(itemId) + '/' + encodeURIComponent(sourceId) +
        '/Subtitles/' + index + '/Stream.' + encodeURIComponent(ext);
    }
    return {
      url: _absoluteServerUrl(ctx, rawUrl),
      lang: String(stream.Language || 'und'),
      label: String(stream.DisplayTitle || stream.Language || 'Subtitle'),
      format: ext,
      default: !!stream.IsDefault
    };
  }).filter(Boolean);
}

function _resolution(source) {
  var streams = Array.isArray(source.MediaStreams) ? source.MediaStreams : [];
  var video = streams.find(function (stream) { return String(stream.Type || '').toLowerCase() === 'video'; });
  var height = Number(video && video.Height || source.Height || 0);
  var width = Number(video && video.Width || source.Width || 0);
  if (height >= 2000 || width >= 3200) return '4K';
  if (height >= 1000 || width >= 1800) return '1080p';
  if (height >= 700 || width >= 1200) return '720p';
  if (height > 0) return String(height) + 'p';
  return 'Original';
}

function _container(value, url, protocol) {
  var name = String(value || '').toLowerCase();
  var raw = String(url || '').toLowerCase();
  var p = String(protocol || '').toLowerCase();
  if (p === 'hls' || /\.m3u8(?:$|\?)/.test(raw) || name === 'm3u8') return 'hls';
  if (['mp4', 'm4v', 'mov'].indexOf(name) >= 0 || /\.(mp4|m4v|mov)(?:$|\?)/.test(raw)) return 'mp4';
  return 'unknown';
}

function _deviceProfile(cfg) {
  var textFormats = ['srt', 'subrip', 'ass', 'ssa', 'vtt', 'webvtt', 'mov_text'];
  var imageFormats = ['pgssub', 'dvdsub', 'dvbsub'];
  return {
    Name: 'Zangetsu',
    MaxStreamingBitrate: cfg.maxStreamingBitrate,
    DirectPlayProfiles: [{
      Type: 'Video',
      Container: 'mp4,m4v,mkv,webm,mov',
      VideoCodec: 'h264,hevc,vp8,vp9,av1',
      AudioCodec: 'aac,mp3,ac3,eac3,flac,opus,vorbis'
    }],
    TranscodingProfiles: [{
      Type: 'Video',
      Container: 'ts',
      VideoCodec: 'hevc,h264',
      AudioCodec: 'aac,mp3,ac3',
      Protocol: 'hls',
      Context: 'Streaming',
      MaxAudioChannels: '6',
      MinSegments: 1,
      BreakOnNonKeyFrames: false
    }],
    SubtitleProfiles: textFormats.map(function (format) {
      return { Format: format, Method: 'Embed' };
    }).concat(textFormats.map(function (format) {
      return { Format: format, Method: 'External' };
    })).concat(imageFormats.map(function (format) {
      return { Format: format, Method: 'Encode' };
    }))
  };
}

function _playbackInfoRequest(ctx, itemId) {
  var cfg = ctx.config;
  var body = {
    UserId: ctx.userId,
    MaxStreamingBitrate: cfg.maxStreamingBitrate,
    EnableDirectPlay: true,
    EnableDirectStream: true,
    EnableTranscoding: true,
    AllowVideoStreamCopy: true,
    AllowAudioStreamCopy: true,
    AutoOpenLiveStream: false,
    IsPlayback: true,
    DeviceProfile: _deviceProfile(cfg)
  };
  return _requestWithContext(ctx, '/Items/' + encodeURIComponent(itemId) + '/PlaybackInfo', {
    userId: ctx.userId,
    maxStreamingBitrate: String(cfg.maxStreamingBitrate),
    enableDirectPlay: 'true',
    enableDirectStream: 'true',
    enableTranscoding: 'true'
  }, {
    method: 'POST',
    body: body,
    noCache: true
  });
}

function _directUrl(ctx, itemId, source, info) {
  var query = {
    static: 'true',
    mediaSourceId: source.Id || itemId,
    playSessionId: info.PlaySessionId || undefined,
    deviceId: DEVICE_ID,
    tag: source.ETag || undefined
  };
  return _buildUrl(ctx.config, '/Videos/' + encodeURIComponent(itemId) + '/stream', query);
}

function _streamEntry(ctx, itemId, source, info, mode) {
  var videoStreams = Array.isArray(source.MediaStreams) ? source.MediaStreams : [];
  var audio = videoStreams.find(function (stream) {
    return String(stream.Type || '').toLowerCase() === 'audio' && stream.IsDefault;
  }) || videoStreams.find(function (stream) {
    return String(stream.Type || '').toLowerCase() === 'audio';
  });
  var label = String(source.Name || '').trim();
  var resolution = _resolution(source);
  var isDirect = mode === 'direct';
  var rawUrl = isDirect ? _directUrl(ctx, itemId, source, info) : _absoluteServerUrl(ctx, source.TranscodingUrl);
  var protocol = source.TranscodingSubProtocol || '';
  var container = isDirect ? _container(source.Container, rawUrl, '') : _container(source.Container, rawUrl, protocol);
  var subtitles = _externalSubtitles(source, itemId, ctx);
  return {
    url: rawUrl,
    quality: resolution,
    label: (label ? label + ' · ' : '') + (isDirect ? 'Direct Play' : (source.SupportsDirectStream ? 'Direct Stream' : 'HLS Transcode')),
    container: container,
    headers: _headers(ctx.token),
    kind: 'raw',
    audioLang: audio && audio.Language ? String(audio.Language) : '',
    subtitles: subtitles
  };
}

function getVideoSources(episodeUrl, fast) {
  var parsed = _parseItemUrl(episodeUrl);
  if (!parsed || parsed.collection) return Promise.reject(new Error('Invalid Jellyfin episode URL.'));
  return _getContext(false).then(function (ctx) {
    return _playbackInfoRequest(ctx, parsed.id).then(function (info) {
      if (info && info.ErrorCode === 'NotAllowed') throw new Error('Jellyfin denied playback for this item.');
      if (info && info.ErrorCode) throw new Error('Jellyfin could not prepare playback: ' + String(info.ErrorCode));
      var mediaSources = Array.isArray(info.MediaSources) ? info.MediaSources.filter(function (source) {
        return source && source.Id && String(source.Type || '').toLowerCase() !== 'placeholder';
      }) : [];
      var output = [];
      mediaSources.forEach(function (source) {
        var canDirect = source.SupportsDirectPlay === true;
        var canTranscode = !!source.TranscodingUrl;
        var direct = canDirect ? _streamEntry(ctx, parsed.id, source, info, 'direct') : null;
        var transcode = canTranscode ? _streamEntry(ctx, parsed.id, source, info, 'transcode') : null;
        if (ctx.config.preferTranscoding) {
          if (transcode) output.push(transcode);
          if (direct) output.push(direct);
        } else {
          if (direct) output.push(direct);
          if (transcode) output.push(transcode);
        }
      });
      var seen = Object.create(null);
      output = output.filter(function (source) {
        if (!source.url || seen[source.url]) return false;
        seen[source.url] = true;
        return true;
      });
      if (!output.length) {
        throw new Error('Jellyfin did not return a compatible direct-play or transcoding stream for this item.');
      }
      return output;
    });
  });
}

function getStreams(episodeUrl, fast) {
  return getVideoSources(episodeUrl, fast);
}

function popular(opts) {
  opts = opts || {};
  var page = Math.max(1, Number(typeof opts === 'number' ? opts : opts.page) || 1);
  return _getContext(false).then(function (ctx) {
    return _viewsForUser(ctx).then(function (views) {
      var start = (page - 1) * ctx.config.pageSize;
      return Promise.all(views.map(function (view) {
        return _viewItems(ctx, view, start, ctx.config.pageSize).catch(function () {
          return { Items: [] };
        });
      })).then(function (groups) {
        var merged = [];
        var seen = Object.create(null);
        groups.forEach(function (group) {
          (Array.isArray(group.Items) ? group.Items : []).forEach(function (raw) {
            var item = _mapItem(raw, ctx);
            if (item && !seen[item.url]) {
              item._dateCreated = raw.DateCreated || '';
              seen[item.url] = true;
              merged.push(item);
            }
          });
        });
        merged.sort(function (a, b) {
          return String(b._dateCreated || '').localeCompare(String(a._dateCreated || ''));
        });
        return merged.slice(0, ctx.config.pageSize).map(function (item) {
          delete item._dateCreated;
          return item;
        });
      });
    });
  });
}

function search(query, page, opts) {
  var term = String(query || '').trim();
  if (!term) return Promise.resolve([]);
  var currentPage = Math.max(1, Number(page) || 1);
  return _getContext(false).then(function (ctx) {
    return _viewsForUser(ctx).then(function (views) {
      var offset = (currentPage - 1) * ctx.config.pageSize;
      var jobs = views.map(function (view) {
        var types = _libraryTypes(view.kind, ctx.config);
        if (!types.length) return Promise.resolve([]);
        return _requestWithContext(ctx, '/Items', Object.assign({}, _fieldsQuery(ctx.config), {
          userId: ctx.userId,
          parentId: view.raw.Id,
          recursive: view.kind === 'collections' ? 'false' : 'true',
          includeItemTypes: types.join(','),
          searchTerm: term,
          sortBy: 'SortName',
          sortOrder: 'Ascending',
          startIndex: String(offset),
          limit: String(ctx.config.pageSize),
          enableTotalRecordCount: 'true'
        })).then(function (data) {
          return Array.isArray(data.Items) ? data.Items : [];
        });
      });
      return Promise.all(jobs).then(function (groups) {
        var merged = [];
        var seen = Object.create(null);
        groups.forEach(function (rows) {
          rows.forEach(function (raw) {
            var item = _mapItem(raw, ctx);
            if (item && !seen[item.url]) {
              seen[item.url] = true;
              merged.push(item);
            }
          });
        });
        merged.sort(function (a, b) { return String(a.title).localeCompare(String(b.title)); });
        return merged.slice(0, ctx.config.pageSize);
      });
    });
  });
}

function _section(title, promise) {
  return Promise.resolve(promise).then(function (items) {
    return items && items.length ? { title: title, items: items } : null;
  }).catch(function () {
    return null;
  });
}

function getHome(opts) {
  return _getContext(false).then(function (ctx) {
    var enabled = ctx.config.homeSections;
    return _viewsForUser(ctx).then(function (views) {
      var jobs = [];
      var types = _globalTypes(ctx.config).filter(function (type) { return type !== 'Episode'; });
      var limit = ctx.config.pageSize;

      if (enabled.indexOf('resume') >= 0) {
        jobs.push(_section('Continue Watching', _requestWithContext(ctx, '/UserItems/Resume', {
          userId: ctx.userId,
          limit: String(limit),
          mediaTypes: 'Video',
          fields: LIST_FIELDS,
          imageTypeLimit: '1',
          enableImageTypes: 'Primary,Backdrop,Logo,Thumb'
        }, { noCache: true, timeoutMs: 2500 }).then(function (data) {
          return (Array.isArray(data.Items) ? data.Items : []).map(function (raw) {
            return _mapResume(raw, ctx);
          }).filter(Boolean);
        })));
      }

      if (enabled.indexOf('nextUp') >= 0) {
        jobs.push(_section('Next Up', _requestWithContext(ctx, '/Shows/NextUp', {
          userId: ctx.userId,
          limit: String(limit),
          fields: LIST_FIELDS,
          imageTypeLimit: '1',
          enableImageTypes: 'Primary,Backdrop,Logo,Thumb',
          enableUserData: 'true'
        }).then(function (data) {
          return (Array.isArray(data.Items) ? data.Items : []).map(function (raw) {
            return _mapResume(raw, ctx);
          }).filter(Boolean);
        })));
      }

      if (enabled.indexOf('recent') >= 0) {
        jobs.push(_section('Recently Added', _requestWithContext(ctx, '/Items', Object.assign({}, _fieldsQuery(ctx.config), {
          userId: ctx.userId,
          recursive: 'true',
          includeItemTypes: types.join(','),
          sortBy: 'DateCreated,SortName',
          sortOrder: 'Descending',
          startIndex: '0',
          limit: String(limit),
          enableTotalRecordCount: 'true'
        })).then(function (data) {
          return (Array.isArray(data.Items) ? data.Items : []).map(function (raw) { return _mapItem(raw, ctx); }).filter(Boolean);
        })));
      }

      if (enabled.indexOf('favorites') >= 0) {
        jobs.push(_section('Favorites', _requestWithContext(ctx, '/Items', Object.assign({}, _fieldsQuery(ctx.config), {
          userId: ctx.userId,
          recursive: 'true',
          filters: 'IsFavorite',
          includeItemTypes: types.join(','),
          sortBy: ctx.config.sortBy,
          sortOrder: 'Descending',
          startIndex: '0',
          limit: String(limit)
        })).then(function (data) {
          return (Array.isArray(data.Items) ? data.Items : []).map(function (raw) { return _mapItem(raw, ctx); }).filter(Boolean);
        })));
      }

      if (enabled.indexOf('libraries') >= 0) {
        views.forEach(function (view) {
          jobs.push(_section(String(view.raw.Name || 'Library'), _viewItems(ctx, view, 0, limit).then(function (data) {
            return (Array.isArray(data.Items) ? data.Items : []).map(function (raw) { return _mapItem(raw, ctx); }).filter(Boolean);
          })));
        });
      }

      return Promise.all(jobs).then(function (rows) { return rows.filter(Boolean); });
    });
  });
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
    // Small private hooks make URL/auth/metadata behavior directly testable.
    _normalizeServerAddress: _normalizeServerAddress,
    _versionAtLeast: _versionAtLeast,
    _config: _config,
    _parseItemUrl: _parseItemUrl,
    _libraryKind: _libraryKind,
    _deviceProfile: _deviceProfile
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = _exports();
