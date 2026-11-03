// Jellyfin integration for Zangetsu.
// Connects to the user's own Jellyfin server. It does not host or proxy media.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'jellyfin';
var JF_CACHE = Object.create(null);
var JF_CACHE_TTL = 30000;
var JF_AUTH = null;
var JF_USER_PROMISE = null;
var JF_MAX_CACHE = 160;

function getInfo() {
  return {
    name: 'Jellyfin',
    lang: 'en',
    baseUrl: 'https://jellyfin.org',
    logo: 'https://jellyfin.org/favicon.ico',
    type: 'movie',
    version: '1.1.0'
  };
}

function getSettings() {
  return [
    { key: 'serverUrl', label: 'Jellyfin server address', description: 'Base address of your Jellyfin server, including an optional reverse-proxy path. Use your local server address and port, or an HTTPS hostname for remote access.', type: 'text', default: '' },
    { key: 'username', label: 'Jellyfin username', description: 'The username of the Jellyfin account you want to use.', type: 'text', default: '' },
    { key: 'password', label: 'Jellyfin password', description: 'The password for that Jellyfin account. Zangetsu currently displays extension text settings without masking; use a dedicated account with only the library permissions you need.', type: 'text', default: '' },
    { key: 'apiKey', label: 'API key (optional alternative)', description: 'Optional server API key. When set, it is used instead of username/password. API-key users may need to enter User ID below.', type: 'text', default: '' },
    { key: 'userId', label: 'User ID (optional)', description: 'Pin a Jellyfin user ID. Username/password login discovers this automatically.', type: 'text', default: '' },
    { key: 'pageSize', label: 'Catalogue page size', description: 'Items requested per catalogue and search page.', type: 'enum', default: '50', options: [{ value: '25', label: '25 items' }, { value: '50', label: '50 items' }, { value: '100', label: '100 items' }] },
    { key: 'catalogSections', label: 'Home catalogue sections', description: 'Choose which Jellyfin catalogue rows appear on Home.', type: 'multiEnum', default: ['resume', 'nextUp', 'latest', 'favorites', 'libraries'], options: [{ value: 'resume', label: 'Continue Watching' }, { value: 'nextUp', label: 'Next Up' }, { value: 'latest', label: 'Recently Added' }, { value: 'favorites', label: 'Favorites' }, { value: 'libraries', label: 'Libraries' }] },
    { key: 'contentTypes', label: 'Catalogue content types', description: 'Choose which media types are shown in search and catalogue rows.', type: 'multiEnum', default: ['Movie', 'Series'], options: [{ value: 'Movie', label: 'Movies' }, { value: 'Series', label: 'TV series' }, { value: 'Episode', label: 'Episodes' }, { value: 'Trailer', label: 'Trailers' }] },
    { key: 'browseSort', label: 'Library sorting', description: 'Sort order for library browsing and popular catalogue rows.', type: 'enum', default: 'DateCreated', options: [{ value: 'DateCreated', label: 'Recently added' }, { value: 'SortName', label: 'Title' }, { value: 'CommunityRating', label: 'Community rating' }, { value: 'PremiereDate', label: 'Release date' }, { value: 'Random', label: 'Random' }] },
    { key: 'genreFilter', label: 'Genre filter (optional)', description: 'Limit catalogue and search results to one or more Jellyfin genres. Separate multiple genres with commas.', type: 'text', default: '' },
    { key: 'yearFilter', label: 'Release year filter (optional)', description: 'Limit catalogue and search results to a release year, or comma-separated years.', type: 'text', default: '' },
    { key: 'includePlayed', label: 'Include watched items', description: 'Include items already marked as played in normal library feeds.', type: 'bool', default: true },
    { key: 'showCollections', label: 'Show collection libraries', description: 'Include box sets and collection folders when returned by Jellyfin.', type: 'bool', default: false },
    { key: 'preferTranscoding', label: 'Prefer Jellyfin transcoding', description: 'Put a server-generated HLS transcode first when Jellyfin supplies one. Otherwise direct play remains first.', type: 'bool', default: false },
    { key: 'maxBitrate', label: 'Maximum streaming bitrate', description: 'Maximum bitrate requested for Jellyfin transcoding. Auto lets the server decide.', type: 'enum', default: '0', options: [{ value: '0', label: 'Auto / server default' }, { value: '8000000', label: '8 Mbps' }, { value: '16000000', label: '16 Mbps' }, { value: '25000000', label: '25 Mbps' }, { value: '40000000', label: '40 Mbps' }] },
    { key: 'includeSubtitles', label: 'Return subtitle tracks', description: 'Expose available embedded and external subtitle tracks to the player.', type: 'bool', default: true },
    { key: 'imageWidth', label: 'Artwork width', description: 'Maximum requested width for poster and backdrop images.', type: 'enum', default: '500', options: [{ value: '300', label: 'Small · 300 px' }, { value: '500', label: 'Medium · 500 px' }, { value: '800', label: 'Large · 800 px' }] },
    { key: 'cacheTtl', label: 'Catalogue cache', description: 'In-memory cache duration for library and metadata responses.', type: 'enum', default: '30000', options: [{ value: '0', label: 'Disabled' }, { value: '15000', label: '15 seconds' }, { value: '30000', label: '30 seconds' }, { value: '60000', label: '1 minute' }] },
    { key: 'requestTimeoutMs', label: 'Server request timeout', description: 'Maximum wait for each Jellyfin API request.', type: 'enum', default: '10000', options: [{ value: '5000', label: '5 seconds' }, { value: '10000', label: '10 seconds' }, { value: '15000', label: '15 seconds' }, { value: '20000', label: '20 seconds' }] }
  ];
}

function _setting(key) {
  try {
    var settings = typeof __settings !== 'undefined' && __settings ? __settings[SOURCE_ID] : null;
    return settings && settings[key] != null ? settings[key] : null;
  } catch (e) { return null; }
}

function _bool(key, fallback) {
  var v = _setting(key);
  if (v == null) return fallback;
  return v === true || String(v).toLowerCase() === 'true';
}

function _config() {
  var raw = String(_setting('serverUrl') || '').trim();
  var server = '';
  if (raw) {
    try {
      var parsed = new URL(raw);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only HTTP and HTTPS are supported.');
      if (parsed.username || parsed.password) throw new Error('Do not put credentials in the server address.');
      parsed.search = '';
      parsed.hash = '';
      parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/(?:web|api)$/i, '');
      server = parsed.toString().replace(/\/$/, '');
    } catch (e) {
      throw new Error('Invalid Jellyfin server address: ' + e.message);
    }
  }
  var pageSize = parseInt(_setting('pageSize'), 10);
  if (![25, 50, 100].includes(pageSize)) pageSize = 50;
  var maxBitrate = parseInt(_setting('maxBitrate'), 10);
  if (![0, 8000000, 16000000, 25000000, 40000000].includes(maxBitrate)) maxBitrate = 0;
  var imageWidth = parseInt(_setting('imageWidth'), 10);
  if (![300, 500, 800].includes(imageWidth)) imageWidth = 500;
  var cacheTtl = parseInt(_setting('cacheTtl'), 10);
  if (![0, 15000, 30000, 60000].includes(cacheTtl)) cacheTtl = 30000;
  var requestTimeoutMs = parseInt(_setting('requestTimeoutMs'), 10);
  if (![5000, 10000, 15000, 20000].includes(requestTimeoutMs)) requestTimeoutMs = 10000;
  var contentTypes = _setting('contentTypes');
  if (!Array.isArray(contentTypes) || !contentTypes.length) contentTypes = ['Movie', 'Series'];
  contentTypes = contentTypes.filter(function (x) { return ['Movie', 'Series', 'Episode', 'Trailer'].includes(String(x)); });
  if (!contentTypes.length) contentTypes = ['Movie', 'Series'];
  var catalogSections = _setting('catalogSections');
  if (!Array.isArray(catalogSections)) catalogSections = ['resume', 'nextUp', 'latest', 'favorites', 'libraries'];
  catalogSections = catalogSections.filter(function (x) { return ['resume', 'nextUp', 'latest', 'favorites', 'libraries'].includes(String(x)); });
  var sort = String(_setting('browseSort') || 'DateCreated');
  if (!['DateCreated', 'SortName', 'CommunityRating', 'PremiereDate', 'Random'].includes(sort)) sort = 'DateCreated';
  return {
    server: server,
    username: String(_setting('username') || '').trim(),
    password: String(_setting('password') || ''),
    apiKey: String(_setting('apiKey') || '').trim(),
    userId: String(_setting('userId') || '').trim(),
    pageSize: pageSize,
    contentTypes: contentTypes,
    catalogSections: catalogSections,
    browseSort: sort,
    genreFilter: String(_setting('genreFilter') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean),
    yearFilter: String(_setting('yearFilter') || '').split(',').map(function (x) { return parseInt(x.trim(), 10); }).filter(function (x) { return isFinite(x) && x >= 1888 && x <= 2200; }),
    includePlayed: _bool('includePlayed', true),
    showCollections: _bool('showCollections', false),
    preferTranscoding: _bool('preferTranscoding', false),
    maxBitrate: maxBitrate,
    includeSubtitles: _bool('includeSubtitles', true),
    imageWidth: imageWidth,
    cacheTtl: cacheTtl,
    requestTimeoutMs: requestTimeoutMs
  };
}

function _fingerprint(c) {
  return [c.server, c.username, c.password, c.apiKey, c.userId].join('\u001f');
}

function _requireServer() {
  var c = _config();
  if (!c.server) throw new Error('Enter your Jellyfin server address in Jellyfin → Settings.');
  if (!c.apiKey && (!c.username || !c.password)) {
    throw new Error('Enter your Jellyfin username and password, or provide an API key.');
  }
  return c;
}

function _authHeader(token) {
  return 'MediaBrowser Client="Zangetsu", Device="Zangetsu", DeviceId="zangetsu-jellyfin", Version="1.1.0", Token="' +
    encodeURIComponent(String(token || '')) + '"';
}

function _headers(token, extra) {
  var h = {
    Accept: 'application/json',
    Authorization: _authHeader(token),
    'X-Emby-Token': String(token || '')
  };
  Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
  return h;
}

function _parseBody(response, path) {
  var status = Number(response && (response.status || response.statusCode)) || 200;
  var body = response && response.body != null ? response.body : '';
  var data = body;
  if (typeof body === 'string') {
    try { data = JSON.parse(body || '{}'); }
    catch (e) {
      if (status >= 200 && status < 300 && body) throw new Error('Jellyfin returned invalid JSON for ' + path + '.');
      data = {};
    }
  }
  if (status < 200 || status >= 300) {
    var message = data && (data.Message || data.message || data.error_description || data.Error) || '';
    var error = new Error('Jellyfin request failed (' + status + ')' + (message ? ': ' + String(message).slice(0, 180) : '') + '.');
    error.status = status;
    throw error;
  }
  return data || {};
}

function _login(c) {
  var authUrl = c.server + '/Users/AuthenticateByName';
  var anonymousHeader = _authHeader('');
  return fetch(authUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: anonymousHeader
    },
    body: JSON.stringify({ Username: c.username, Pw: c.password }),
    timeoutMs: c.requestTimeoutMs
  }).then(function (response) {
    var data = _parseBody(response, '/Users/AuthenticateByName');
    var token = String(data.AccessToken || '');
    var user = data.User || {};
    if (!token) throw new Error('Jellyfin login succeeded without returning an access token.');
    if (!user.Id && !c.userId) throw new Error('Jellyfin login did not return a user ID. Enter User ID in source settings.');
    return { token: token, userId: String(c.userId || user.Id || ''), fingerprint: _fingerprint(c), expiresAt: Date.now() + 30 * 60 * 1000 };
  }).catch(function (e) {
    if (e && e.status === 401) throw new Error('Jellyfin rejected the username or password. Check your credentials and server address.');
    throw e;
  });
}

function _getAuth() {
  var c = _requireServer();
  var fingerprint = _fingerprint(c);
  if (JF_AUTH && JF_AUTH.fingerprint !== fingerprint) {
    JF_AUTH = null;
    JF_USER_PROMISE = null;
    Object.keys(JF_CACHE).forEach(function (key) { delete JF_CACHE[key]; });
  }
  if (JF_AUTH && JF_AUTH.fingerprint === fingerprint && JF_AUTH.expiresAt > Date.now()) {
    return Promise.resolve({ token: JF_AUTH.token, userId: JF_AUTH.userId, config: c });
  }
  if (c.apiKey) {
    JF_AUTH = { token: c.apiKey, userId: c.userId, fingerprint: fingerprint, expiresAt: Date.now() + 30 * 60 * 1000 };
    return Promise.resolve({ token: c.apiKey, userId: c.userId, config: c });
  }
  return _login(c).then(function (auth) {
    JF_AUTH = auth;
    JF_USER_PROMISE = null;
    Object.keys(JF_CACHE).forEach(function (key) { delete JF_CACHE[key]; });
    return { token: auth.token, userId: auth.userId, config: c };
  });
}

function _clearAuth() {
  JF_AUTH = null;
  JF_USER_PROMISE = null;
  Object.keys(JF_CACHE).forEach(function (key) { delete JF_CACHE[key]; });
}

function _rawRequest(ctx, path, params, options) {
  options = options || {};
  var url = ctx.config.server + path;
  var query = [];
  Object.keys(params || {}).forEach(function (key) {
    var value = params[key];
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) {
      value.forEach(function (part) { query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(part))); });
    } else query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  if (query.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
  var method = String(options.method || 'GET').toUpperCase();
  var cacheKey = method + ':' + url + ':' + String(ctx.userId || '');
  var now = Date.now();
  var ttl = ctx.config.cacheTtl;
  if (method === 'GET' && !options.noCache && ttl > 0) {
    var cached = JF_CACHE[cacheKey];
    if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
  }
  var requestOptions = {
    method: method,
    headers: _headers(ctx.token, options.headers),
    timeoutMs: options.timeoutMs || ctx.config.requestTimeoutMs
  };
  if (options.body != null) requestOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  return fetch(url, requestOptions).then(function (response) {
    return _parseBody(response, path);
  }).then(function (data) {
    if (method === 'GET' && !options.noCache && ttl > 0) {
      JF_CACHE[cacheKey] = { value: data, expiresAt: now + ttl };
      var keys = Object.keys(JF_CACHE);
      while (keys.length > JF_MAX_CACHE) delete JF_CACHE[keys.shift()];
    }
    return data;
  }).catch(function (error) {
    if ((error.status === 401 || error.status === 403) && !options.noAuthRetry && !ctx.config.apiKey) {
      _clearAuth();
      return _getAuth().then(function (fresh) {
        return _rawRequest(fresh, path, params, { ...options, noAuthRetry: true, noCache: true });
      });
    }
    throw error;
  });
}

function _request(path, params, options) {
  return _getAuth().then(function (ctx) { return _rawRequest(ctx, path, params, options); });
}

function _resolveUserId(ctx) {
  if (ctx.userId) return Promise.resolve(ctx.userId);
  if (JF_USER_PROMISE) return JF_USER_PROMISE;
  JF_USER_PROMISE = _rawRequest(ctx, '/Users', {}, { noCache: true }).then(function (users) {
    var list = Array.isArray(users) ? users : (Array.isArray(users.Users) ? users.Users : []);
    var first = list.find(function (u) { return u && u.Id; });
    if (!first) throw new Error('Jellyfin did not expose a user for this API key. Set the User ID setting.');
    return String(first.Id);
  }).catch(function (error) {
    JF_USER_PROMISE = null;
    if (error.status === 401 || error.status === 403) {
      throw new Error('This API key cannot list users. Enter the Jellyfin User ID in source settings, or sign in with username and password.');
    }
    throw error;
  });
  return JF_USER_PROMISE;
}

function _withUser() {
  return _getAuth().then(function (ctx) {
    return _resolveUserId(ctx).then(function (userId) {
      ctx.userId = userId;
      return ctx;
    });
  });
}

function _fields() {
  return 'Overview,Genres,Studios,People,DateCreated,ProductionYear,CommunityRating,MediaSources,MediaStreams,ProviderIds,PremiereDate,ParentIndexNumber,IndexNumber,RunTimeTicks,UserData,ImageTags,BackdropImageTags,ChildCount,RecursiveItemCount';
}

function _selectedItems() {
  var c = _config();
  var types = c.contentTypes.slice();
  if (!c.includePlayed) return types;
  return types;
}

function _typeFilter() {
  return _selectedItems().join(',');
}

function _applyCatalogueFilters(params, c) {
  var filters = Array.isArray(params.Filters) ? params.Filters.slice() :
    (params.Filters ? String(params.Filters).split(',').filter(Boolean) : []);
  if (!c.includePlayed && filters.indexOf('IsNotPlayed') < 0) filters.push('IsNotPlayed');
  if (filters.length) params.Filters = filters;
  if (c.genreFilter.length) params.Genres = c.genreFilter;
  if (c.yearFilter.length) params.Years = c.yearFilter;
  return params;
}

function _imageUrl(itemId, imageType, tag, ctx) {
  ctx = ctx || null;
  var c = ctx ? ctx.config : _config();
  var url = c.server + '/Items/' + encodeURIComponent(itemId) + '/Images/' + encodeURIComponent(imageType);
  var params = [];
  if (tag) params.push('tag=' + encodeURIComponent(tag));
  if (c.imageWidth) params.push('maxWidth=' + encodeURIComponent(String(c.imageWidth)));
  if (params.length) url += '?' + params.join('&');
  return url;
}

function _imageHeaders(ctx) {
  return _headers(ctx.token);
}

function _pad(value) { return String(value).padStart(2, '0'); }

function _mapItem(raw, ctx) {
  if (!raw || !raw.Id || !raw.Name) return null;
  var type = String(raw.Type || '').toLowerCase();
  if (!['movie', 'series', 'episode', 'trailer', 'video'].includes(type)) return null;
  var id = String(raw.Id);
  var images = raw.ImageTags || {};
  var item = {
    id: 'jellyfin://' + encodeURIComponent(id),
    url: 'jellyfin://' + encodeURIComponent(id),
    title: String(raw.Name),
    cover: images.Primary ? _imageUrl(id, 'Primary', images.Primary, ctx) : null,
    coverHeaders: _imageHeaders(ctx),
    banner: raw.BackdropImageTags && raw.BackdropImageTags.length ? _imageUrl(id, 'Backdrop', raw.BackdropImageTags[0], ctx) : null,
    type: 'movie',
    sourceId: SOURCE_ID,
    score: raw.CommunityRating != null && isFinite(Number(raw.CommunityRating)) ? Math.round(Number(raw.CommunityRating) * 10) : null,
    genres: Array.isArray(raw.Genres) ? raw.Genres : [],
    year: raw.ProductionYear ? String(raw.ProductionYear) : null,
    jellyfinId: id,
    jellyfinType: type
  };
  if (raw.UserData && raw.UserData.Played) item.played = true;
  if (raw.UserData && raw.UserData.PlayedPercentage != null) item.playedPercentage = Number(raw.UserData.PlayedPercentage);
  if (raw.Type === 'Episode' || type === 'episode') {
    item.seasonNumber = Number(raw.ParentIndexNumber) || 1;
    item.episodeNumber = Number(raw.IndexNumber) || 1;
    if (raw.SeriesName) item.title = String(raw.SeriesName) + ' · S' + _pad(item.seasonNumber) + 'E' + _pad(item.episodeNumber) + ' · ' + String(raw.Name);
  }
  return item;
}

function _listToItems(data, ctx) {
  var rows = data && Array.isArray(data.Items) ? data.Items : [];
  return rows.map(function (raw) { return _mapItem(raw, ctx); }).filter(Boolean);
}

function _itemsFor(ctx, params, path, options) {
  return _rawRequest(ctx, path || ('/Users/' + encodeURIComponent(ctx.userId) + '/Items'), params, options)
    .then(function (data) { return _listToItems(data, ctx); });
}

function _views(ctx) {
  // Jellyfin's documented user-view route is /UserViews?userId=..., not
  // /Users/{userId}/Views.
  return _rawRequest(ctx, '/UserViews', { userId: ctx.userId, includeExternalContent: false })
    .then(function (data) { return Array.isArray(data.Items) ? data.Items : []; });
}

function _section(title, promise) {
  return promise.then(function (items) {
    return items && items.length ? { title: title, items: items } : null;
  }).catch(function () { return null; });
}

function getHome(opts) {
  opts = opts || {};
  return _withUser().then(function (ctx) {
    var c = ctx.config;
    var sections = c.catalogSections;
    return _views(ctx).then(function (views) {
      var jobs = [];
      if (sections.includes('resume')) {
        // Resume can be a slow query on very large playback histories. Keep it
        // from blocking every other Home row when the server stalls.
        jobs.push(_section('Continue Watching', _itemsFor(ctx, {
          userId: ctx.userId, limit: c.pageSize, fields: _fields(),
          enableUserData: true, enableImages: true
        }, '/UserItems/Resume', { timeoutMs: 2500 })));
      }
      if (sections.includes('nextUp')) {
        jobs.push(_section('Next Up', _itemsFor(ctx, {
          userId: ctx.userId, limit: c.pageSize, fields: _fields(),
          enableUserData: true, enableImages: true
        }, '/Shows/NextUp')));
      }
      if (sections.includes('latest')) {
        jobs.push(_section('Recently Added', _itemsFor(ctx, _applyCatalogueFilters({
          Recursive: true, IncludeItemTypes: _typeFilter(), SortBy: 'DateCreated',
          SortOrder: 'Descending', StartIndex: 0, Limit: c.pageSize,
          Fields: _fields(), EnableUserData: true, EnableImages: true
        }, c))));
      }
      if (sections.includes('favorites')) {
        jobs.push(_section('Favorites', _itemsFor(ctx, _applyCatalogueFilters({
          Recursive: true, Filters: 'IsFavorite', IncludeItemTypes: _typeFilter(),
          SortBy: c.browseSort, SortOrder: 'Descending', StartIndex: 0,
          Limit: c.pageSize, Fields: _fields(), EnableUserData: true
        }, c))));
      }
      if (sections.includes('libraries')) {
        views.forEach(function (view) {
          var collectionType = String(view.CollectionType || '').toLowerCase();
          if (!c.showCollections && !['movies', 'tvshows', 'homevideos', 'mixed', ''].includes(collectionType)) return;
          jobs.push(_section(String(view.Name || 'Library'), _itemsFor(ctx, _applyCatalogueFilters({
            ParentId: view.Id, Recursive: true, IncludeItemTypes: _typeFilter(),
            SortBy: c.browseSort, SortOrder: 'Descending', StartIndex: 0,
            Limit: c.pageSize, Fields: _fields(), EnableUserData: true,
            EnableImages: true
          }, c))));
        });
      }
      return Promise.all(jobs).then(function (rows) { return rows.filter(Boolean); });
    });
  });
}

function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, Number(page) || 1);
  return _withUser().then(function (ctx) {
    var params = {
      SearchTerm: q, Recursive: true, IncludeItemTypes: _typeFilter(),
      SortBy: 'SortName', SortOrder: 'Ascending',
      StartIndex: (p - 1) * ctx.config.pageSize, Limit: ctx.config.pageSize,
      Fields: _fields(), EnableUserData: true, EnableImages: true
    };
    _applyCatalogueFilters(params, ctx.config);
    return _itemsFor(ctx, params);
  });
}

function popular(opts) {
  // Zangetsu's JS provider contract expects MediaItem[], not HomeSection[].
  // The home rows are supplied separately by getHome().
  var page = typeof opts === 'number' ? opts : (opts && opts.page) || 1;
  page = Math.max(1, Number(page) || 1);
  return _withUser().then(function (ctx) {
    return _views(ctx).then(function (views) {
      var start = (page - 1) * ctx.config.pageSize;
      return Promise.all(views.filter(function (view) {
        var t = String(view.CollectionType || '').toLowerCase();
        return ['movies', 'tvshows', 'homevideos', 'mixed', ''].includes(t);
      }).map(function (view) {
        return _itemsFor(ctx, _applyCatalogueFilters({
          ParentId: view.Id, Recursive: true, IncludeItemTypes: _typeFilter(),
          SortBy: ctx.config.browseSort, SortOrder: 'Descending',
          StartIndex: start, Limit: ctx.config.pageSize,
          Fields: _fields(), EnableUserData: true, EnableImages: true
        }, ctx.config)).catch(function () { return []; });
      })).then(function (groups) {
        var merged = [];
        var seen = Object.create(null);
        groups.forEach(function (items) {
          items.forEach(function (item) {
            if (!seen[item.url]) { seen[item.url] = true; merged.push(item); }
          });
        });
        return merged;
      });
    });
  });
}

function _parseItemUrl(value) {
  var text = String(value || '');
  var match = text.match(/^jellyfin:\/\/([^/?#]+)$/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch (e) { return null; }
}

function _mapEpisode(raw, ctx) {
  if (!raw || !raw.Id) return null;
  var season = Number(raw.ParentIndexNumber) || 1;
  var number = Number(raw.IndexNumber) || 1;
  var image = raw.ImageTags && raw.ImageTags.Primary ? _imageUrl(raw.Id, 'Primary', raw.ImageTags.Primary, ctx) : null;
  return {
    id: String(raw.Id),
    title: 'S' + _pad(season) + ' E' + _pad(number) + ' · ' + String(raw.Name || 'Episode ' + number),
    number: number,
    season: season,
    url: 'jellyfin://' + encodeURIComponent(String(raw.Id)),
    date: raw.PremiereDate || null,
    thumbnail: image,
    description: raw.Overview || null,
    runtimeMinutes: raw.RunTimeTicks ? Math.round(Number(raw.RunTimeTicks) / 600000000) : null
  };
}

function _episodePage(ctx, seriesId, startIndex) {
  return _rawRequest(ctx, '/Shows/' + encodeURIComponent(seriesId) + '/Episodes', {
    userId: ctx.userId, fields: _fields(), isMissing: false,
    startIndex: startIndex, limit: 500,
    enableImages: true, enableUserData: true
  });
}

function _mapEpisodesPage(data, ctx) {
  return (Array.isArray(data.Items) ? data.Items : [])
    .map(function (raw) { return _mapEpisode(raw, ctx); })
    .filter(Boolean);
}

function _getEpisodes(ctx, seriesId, page) {
  var explicitPage = Number(page);
  if (isFinite(explicitPage) && explicitPage >= 1) {
    return _episodePage(ctx, seriesId, (Math.floor(explicitPage) - 1) * 500)
      .then(function (data) { return _mapEpisodesPage(data, ctx); });
  }

  // Zangetsu's provider contract consumes one complete episode array. Jellyfin
  // paginates long-running series, so collect the remaining pages in small
  // parallel batches rather than silently cutting shows off at episode 500.
  return _episodePage(ctx, seriesId, 0).then(function (first) {
    var merged = _mapEpisodesPage(first, ctx);
    var total = Number(first && first.TotalRecordCount) || merged.length;
    var pages = Math.min(20, Math.ceil(total / 500));
    var offsets = [];
    for (var start = 500; start < pages * 500; start += 500) offsets.push(start);
    function loadBatch(index) {
      if (index >= offsets.length) return Promise.resolve(merged);
      var batch = offsets.slice(index, index + 4);
      return Promise.all(batch.map(function (offset) {
        return _episodePage(ctx, seriesId, offset);
      })).then(function (results) {
        results.forEach(function (data) {
          merged = merged.concat(_mapEpisodesPage(data, ctx));
        });
        return loadBatch(index + batch.length);
      });
    }
    return loadBatch(0).then(function (all) {
      var seen = Object.create(null);
      return all.filter(function (episode) {
        if (seen[episode.id]) return false;
        seen[episode.id] = true;
        return true;
      });
    });
  });
}

function getEpisodes(url, opts) {
  var id = _parseItemUrl(url);
  if (!id) return Promise.reject(new Error('Invalid Jellyfin item URL.'));
  opts = opts || {};
  var page = typeof opts === 'number' ? opts : (opts && opts.page ? opts.page : null);
  return _withUser().then(function (ctx) { return _getEpisodes(ctx, id, page); });
}

function getDetail(url, opts) {
  var id = _parseItemUrl(url);
  if (!id) return Promise.reject(new Error('Invalid Jellyfin item URL.'));
  return _withUser().then(function (ctx) {
    return _rawRequest(ctx, '/Users/' + encodeURIComponent(ctx.userId) + '/Items/' + encodeURIComponent(id), {
      fields: _fields(), enableUserData: true, enableImages: true
    }).then(function (raw) {
      if (!raw || !raw.Id) throw new Error('Jellyfin item was not found.');
      var mapped = _mapItem(raw, ctx);
      if (!mapped) throw new Error('This Jellyfin item type is not supported for playback.');
      var detail = {
        id: id,
        title: String(raw.Name || ''),
        url: 'jellyfin://' + encodeURIComponent(id),
        cover: mapped.cover,
        coverHeaders: mapped.coverHeaders,
        banner: mapped.banner,
        description: raw.Overview || '',
        status: raw.Status === 'Continuing' ? 'ongoing' : (raw.Status === 'Ended' ? 'completed' : 'unknown'),
        genres: Array.isArray(raw.Genres) ? raw.Genres : [],
        studios: Array.isArray(raw.Studios) ? raw.Studios.map(function (x) { return x && x.Name; }).filter(Boolean) : [],
        cast: Array.isArray(raw.People) ? raw.People.filter(function (x) { return x && (x.Type === 'Actor' || x.Type === 'GuestStar'); }).slice(0, 20).map(function (x) { return x.Name; }).filter(Boolean) : [],
        year: raw.ProductionYear ? String(raw.ProductionYear) : null,
        type: 'movie',
        sourceId: SOURCE_ID,
        episodes: [],
        subCount: 0,
        dubCount: 0
      };
      if (String(raw.Type).toLowerCase() === 'series') {
        return _getEpisodes(ctx, id).then(function (episodes) {
          detail.episodes = episodes;
          detail.subCount = episodes.length;
          return detail;
        });
      }
      if (['movie', 'episode', 'trailer', 'video'].includes(String(raw.Type).toLowerCase())) {
        detail.episodes = [{ id: id, title: detail.title, number: 1, season: 1, url: detail.url }];
        detail.subCount = 1;
      }
      return detail;
    });
  });
}

function _absoluteUrl(base, value) {
  var raw = String(value || '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.charAt(0) === '/') return base.replace(/\/$/, '') + raw;
  return base.replace(/\/$/, '') + '/' + raw.replace(/^\/+/, '');
}

function _queryUrl(url, params) {
  var out = url;
  var parts = [];
  Object.keys(params || {}).forEach(function (key) {
    var value = params[key];
    if (value === undefined || value === null || value === '') return;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  if (!parts.length) return out;
  return out + (out.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
}

function _subtitles(mediaSource, itemId, sourceId, ctx) {
  if (!ctx.config.includeSubtitles) return [];
  var streams = Array.isArray(mediaSource.MediaStreams) ? mediaSource.MediaStreams : [];
  return streams.filter(function (stream) {
    return String(stream.Type || '').toLowerCase() === 'subtitle';
  }).map(function (stream) {
    var index = Number(stream.Index);
    if (!isFinite(index)) return null;
    var ext = String(stream.Codec || 'vtt').toLowerCase();
    if (ext === 'subrip') ext = 'srt';
    if (ext === 'webvtt') ext = 'vtt';
    var url = stream.DeliveryUrl ? _absoluteUrl(ctx.config.server, stream.DeliveryUrl) :
      ctx.config.server + '/Videos/' + encodeURIComponent(itemId) + '/' + encodeURIComponent(sourceId) + '/Subtitles/' + index + '/Stream.' + encodeURIComponent(ext);
    return {
      url: url,
      lang: String(stream.Language || 'und'),
      label: String(stream.DisplayTitle || stream.Language || 'Subtitle'),
      format: ext,
      default: !!stream.IsDefault
    };
  }).filter(Boolean);
}

function _mediaUrl(mediaSource, itemId, ctx, playSessionId, preferTranscoding) {
  var params = { PlaySessionId: playSessionId || undefined };
  var direct = mediaSource.DirectStreamUrl || mediaSource.DirectPlayUrl;
  if (!direct) {
    direct = ctx.config.server + '/Videos/' + encodeURIComponent(itemId) + '/stream';
    params.static = 'true';
    params.mediaSourceId = mediaSource.Id || itemId;
  } else if (!/[?&](?:mediaSourceId|MediaSourceId)=/.test(direct)) {
    params.mediaSourceId = mediaSource.Id || itemId;
  }
  var directUrl = _queryUrl(_absoluteUrl(ctx.config.server, direct), params);
  var transcodeUrl = mediaSource.TranscodingUrl ? _absoluteUrl(ctx.config.server, mediaSource.TranscodingUrl) : '';
  var transcodeProtocol = String(mediaSource.TranscodingSubProtocol || '').toLowerCase();
  var directContainer = String(mediaSource.Container || '').toLowerCase();
  var directSource = {
    url: directUrl,
    quality: mediaSource.Height ? String(mediaSource.Height) + 'p' : 'Original',
    label: 'Jellyfin · ' + String(mediaSource.Name || 'Direct play'),
    container: directContainer === 'm3u8' ? 'hls' : (directContainer === 'mp4' || directContainer === 'mkv' || directContainer === 'webm' ? 'mp4' : 'unknown'),
    headers: _headers(ctx.token),
    subtitles: _subtitles(mediaSource, itemId, mediaSource.Id || itemId, ctx)
  };
  var transcodeSource = transcodeUrl ? {
    url: _queryUrl(transcodeUrl, { PlaySessionId: playSessionId || undefined }),
    quality: ctx.config.maxBitrate ? Math.round(ctx.config.maxBitrate / 1000000) + ' Mbps cap' : 'Server transcode',
    label: 'Jellyfin · ' + (transcodeProtocol === 'hls' ? 'HLS transcode' : 'Transcode'),
    container: transcodeProtocol === 'hls' ? 'hls' : 'unknown',
    headers: _headers(ctx.token),
    subtitles: _subtitles(mediaSource, itemId, mediaSource.Id || itemId, ctx)
  } : null;
  return preferTranscoding ? [transcodeSource, directSource].filter(Boolean) : [directSource, transcodeSource].filter(Boolean);
}

function getVideoSources(episodeUrl, fast) {
  var itemId = _parseItemUrl(episodeUrl);
  if (!itemId) return Promise.reject(new Error('Invalid Jellyfin episode URL.'));
  return _withUser().then(function (ctx) {
    var params = {
      userId: ctx.userId,
      autoOpenLiveStream: false,
      enableDirectPlay: true,
      enableDirectStream: true,
      enableTranscoding: true
    };
    if (ctx.config.maxBitrate) params.maxStreamingBitrate = ctx.config.maxBitrate;
    return _rawRequest(ctx, '/Items/' + encodeURIComponent(itemId) + '/PlaybackInfo', params, { noCache: true }).then(function (info) {
      var sources = Array.isArray(info.MediaSources) ? info.MediaSources : [];
      var output = [];
      sources.forEach(function (mediaSource) {
        _mediaUrl(mediaSource, itemId, ctx, info.PlaySessionId, ctx.config.preferTranscoding).forEach(function (item) {
          if (!output.some(function (existing) { return existing.url === item.url; })) output.push(item);
        });
      });
      if (output.length) return output;
      return [{
        url: ctx.config.server + '/Videos/' + encodeURIComponent(itemId) + '/stream?' + 'static=true',
        label: 'Jellyfin · Server-selected stream',
        quality: 'Original',
        container: 'unknown',
        headers: _headers(ctx.token),
        subtitles: []
      }];
    });
  });
}

function getStreams(id, fast) { return getVideoSources(id, fast); }

function _exports() {
  return {
    version: '1.1.0',
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    search: search,
    popular: popular,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams,
    _config: _config,
    _parseItemUrl: _parseItemUrl,
    _mapItem: _mapItem,
    _imageUrl: _imageUrl
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = _exports();
