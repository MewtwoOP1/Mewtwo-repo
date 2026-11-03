// Native Jellyfin server integration for Zangetsu.
// Connects to a user-configured Jellyfin server. No media is hosted by this repository.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'jellyfin';
var JF_CACHE = Object.create(null);
var JF_CACHE_TTL = 45000;

function getInfo() {
  return {
    name: 'Jellyfin',
    lang: 'en',
    baseUrl: 'https://jellyfin.org',
    logo: 'https://jellyfin.org/favicon.ico',
    type: 'movie',
    version: '1.0.0'
  };
}

function getSettings() {
  return [
    { key: 'serverUrl', label: 'Jellyfin server URL', description: 'Your Jellyfin server base URL, for example https://jellyfin.example.com. Do not include /web or /api.', type: 'text', default: '' },
    { key: 'apiKey', label: 'Jellyfin API key', description: 'Create an API key in Jellyfin Dashboard → API Keys. Keep it private. The key is sent only to your configured server.', type: 'text', default: '' },
    { key: 'userId', label: 'User ID (optional)', description: 'Optional Jellyfin user ID. Leave blank to use the first accessible user returned by the server.', type: 'text', default: '' },
    { key: 'pageSize', label: 'Items per page', description: 'Maximum media items requested for each library or search result page.', type: 'enum', default: '50', options: [{ value: '25', label: '25 items' }, { value: '50', label: '50 items' }, { value: '100', label: '100 items' }] },
    { key: 'includeTrailers', label: 'Include trailers', description: 'Include trailer items in library and search results.', type: 'bool', default: false }
  ];
}

function _setting(key) {
  try {
    var settings = typeof __settings !== 'undefined' && __settings ? __settings[SOURCE_ID] : null;
    return settings && settings[key] != null ? settings[key] : null;
  } catch (e) { return null; }
}

function _config() {
  var raw = String(_setting('serverUrl') || '').trim();
  var apiKey = String(_setting('apiKey') || '').trim();
  var userId = String(_setting('userId') || '').trim();
  var pageSize = parseInt(_setting('pageSize'), 10);
  if (![25, 50, 100].includes(pageSize)) pageSize = 50;
  var server = '';
  if (raw) {
    try {
      var parsed = new URL(raw);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Unsupported protocol');
      if (parsed.username || parsed.password) throw new Error('Credentials must not be embedded in the server URL');
      parsed.search = '';
      parsed.hash = '';
      parsed.pathname = parsed.pathname.replace(/\/+$/, '').replace(/\/(?:web|api)$/i, '');
      server = parsed.toString().replace(/\/$/, '');
    } catch (e) { throw new Error('Invalid Jellyfin server URL: ' + e.message); }
  }
  return {
    server: server,
    apiKey: apiKey,
    userId: userId,
    pageSize: pageSize,
    includeTrailers: _setting('includeTrailers') === true || String(_setting('includeTrailers')).toLowerCase() === 'true'
  };
}

function _requireConfig() {
  var c = _config();
  if (!c.server) throw new Error('Configure your Jellyfin server URL in Jellyfin → Settings.');
  if (!c.apiKey) throw new Error('Configure a Jellyfin API key in Jellyfin → Settings.');
  return c;
}

function _headers(c) {
  return {
    Accept: 'application/json',
    'X-Emby-Token': c.apiKey,
    'X-Emby-Authorization': 'MediaBrowser Client="Zangetsu", Device="Zangetsu", DeviceId="zangetsu-jellyfin", Version="1.0.0", Token="' + c.apiKey + '"'
  };
}

function _request(path, params, options) {
  var c = _requireConfig();
  var url = c.server + path;
  var query = [];
  Object.keys(params || {}).forEach(function (key) {
    var value = params[key];
    if (value === undefined || value === null || value === '') return;
    query.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  if (query.length) url += '?' + query.join('&');
  var cacheKey = url;
  var cached = JF_CACHE[cacheKey];
  var now = Date.now();
  if (!(options && options.noCache) && cached && cached.expiresAt > now) return Promise.resolve(cached.value);

  return fetch(url, {
    method: 'GET',
    headers: _headers(c),
    timeoutMs: 12000
  }).then(function (response) {
    var status = Number(response && (response.status || response.statusCode)) || 200;
    if (status < 200 || status >= 300) {
      var error = new Error('Jellyfin HTTP ' + status + ' for ' + path);
      error.status = status;
      throw error;
    }
    var body = response && response.body != null ? response.body : '';
    var data;
    if (typeof body === 'string') {
      try { data = JSON.parse(body || '{}'); }
      catch (e) { throw new Error('Jellyfin returned invalid JSON for ' + path); }
    } else data = body || {};
    if (!(options && options.noCache)) {
      JF_CACHE[cacheKey] = { value: data, expiresAt: now + JF_CACHE_TTL };
      var keys = Object.keys(JF_CACHE);
      while (keys.length > 120) delete JF_CACHE[keys.shift()];
    }
    return data;
  });
}

function _userId() {
  var c = _requireConfig();
  if (c.userId) return Promise.resolve(c.userId);
  return _request('/Users', {}, { noCache: false }).then(function (users) {
    if (!Array.isArray(users) || !users.length || !users[0].Id) {
      throw new Error('Jellyfin did not return an accessible user. Set User ID in the source settings.');
    }
    return String(users[0].Id);
  });
}

function _views() {
  return _userId().then(function (id) {
    return _request('/Users/' + encodeURIComponent(id) + '/Views', { IncludeExternalContent: false });
  }).then(function (data) { return Array.isArray(data.Items) ? data.Items : []; });
}

function _mapItem(raw) {
  if (!raw || !raw.Id || !raw.Name) return null;
  var type = String(raw.Type || '').toLowerCase();
  var isEpisode = type === 'episode';
  var isMovie = type === 'movie';
  var isSeries = type === 'series';
  var isFolder = type === 'folder' || type === 'collectionfolder' || type === 'boxset';
  if (!(isEpisode || isMovie || isSeries || isFolder)) return null;
  var id = String(raw.Id);
  var item = {
    id: 'jellyfin://' + id,
    url: 'jellyfin://' + id,
    title: String(raw.Name),
    cover: raw.ImageTags && raw.ImageTags.Primary ? _imageUrl(id, 'Primary', raw.ImageTags.Primary) : null,
    banner: raw.BackdropImageTags && raw.BackdropImageTags.length ? _imageUrl(id, 'Backdrop', raw.BackdropImageTags[0]) : null,
    type: 'movie',
    sourceId: SOURCE_ID,
    jellyfinId: id,
    jellyfinType: type,
    overview: raw.Overview || '',
    year: raw.ProductionYear ? String(raw.ProductionYear) : null
  };
  if (raw.CommunityRating != null && isFinite(Number(raw.CommunityRating))) item.score = Math.round(Number(raw.CommunityRating) * 10);
  if (raw.RunTimeTicks != null) item.duration = Math.round(Number(raw.RunTimeTicks) / 10000);
  if (isEpisode) {
    item.seasonNumber = Number(raw.ParentIndexNumber) || 1;
    item.episodeNumber = Number(raw.IndexNumber) || 1;
    if (raw.SeriesName) item.title = String(raw.SeriesName) + ' · S' + _pad(item.seasonNumber) + 'E' + _pad(item.episodeNumber) + ' - ' + String(raw.Name);
  }
  if (raw.SeriesId) item.seriesId = String(raw.SeriesId);
  if (raw.ParentId) item.parentId = String(raw.ParentId);
  return item;
}

function _pad(value) { return String(value).padStart(2, '0'); }

function _imageUrl(itemId, imageType, tag) {
  var c = _requireConfig();
  return c.server + '/Items/' + encodeURIComponent(itemId) + '/Images/' + encodeURIComponent(imageType) +
    (tag ? '?tag=' + encodeURIComponent(tag) : '');
}

function _listToItems(data) {
  var items = data && Array.isArray(data.Items) ? data.Items : [];
  return items.map(_mapItem).filter(Boolean);
}

function getHome() {
  return _views().then(function (views) {
    var rows = views.filter(function (view) {
      var type = String(view.CollectionType || '').toLowerCase();
      return type === 'movies' || type === 'tvshows' || type === 'homevideos' || !type;
    }).map(function (view) {
      return { title: view.Name || 'Jellyfin Library', items: [], _view: view };
    });
    return Promise.all(rows.map(function (row) {
      var view = row._view;
      return _userId().then(function (userId) {
        return _request('/Users/' + encodeURIComponent(userId) + '/Items', {
          ParentId: view.Id,
          Recursive: true,
          IncludeItemTypes: 'Movie,Series',
          SortBy: 'DateCreated',
          SortOrder: 'Descending',
          Limit: _config().pageSize,
          Fields: 'Overview,PrimaryImageAspectRatio,CommunityRating,DateCreated,ProductionYear'
        });
      }).then(function (data) {
        row.items = _listToItems(data);
        delete row._view;
        return row;
      }).catch(function (e) {
        delete row._view;
        row.error = String(e.message || e);
        return row;
      });
    }));
  });
}

function search(query, page) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _userId().then(function (userId) {
    return _request('/Users/' + encodeURIComponent(userId) + '/Items', {
      SearchTerm: q,
      Recursive: true,
      IncludeItemTypes: _config().includeTrailers ? 'Movie,Series,Episode,Trailer' : 'Movie,Series,Episode',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      StartIndex: Math.max(0, ((Number(page) || 1) - 1) * _config().pageSize),
      Limit: _config().pageSize,
      Fields: 'Overview,PrimaryImageAspectRatio,CommunityRating,DateCreated,ProductionYear'
    }).then(_listToItems);
  });
}

function popular(page) {
  return _views().then(function (views) {
    return Promise.all(views.map(function (view) {
      return _userId().then(function (userId) {
        return _request('/Users/' + encodeURIComponent(userId) + '/Items', {
          ParentId: view.Id,
          Recursive: true,
          IncludeItemTypes: 'Movie,Series',
          SortBy: 'SortName',
          SortOrder: 'Ascending',
          StartIndex: Math.max(0, ((Number(page) || 1) - 1) * _config().pageSize),
          Limit: _config().pageSize,
          Fields: 'Overview,PrimaryImageAspectRatio,CommunityRating,ProductionYear'
        }).then(_listToItems).then(function (items) {
          return items.length ? { title: view.Name || 'Library', items: items } : null;
        });
      }).catch(function () { return null; });
    })).then(function (rows) { return rows.filter(Boolean); });
  });
}

function _parseItemUrl(value) {
  var match = String(value || '').match(/^jellyfin:\/\/([^/?#]+)$/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function getDetail(id) {
  var itemId = _parseItemUrl(id);
  if (!itemId) return Promise.reject(new Error('Invalid Jellyfin item URL.'));
  return _request('/Users/' + encodeURIComponent(_config().userId || 'me') + '/Items/' + encodeURIComponent(itemId), {
    Fields: 'Overview,Genres,People,Studios,DateCreated,MediaSources,MediaStreams,ProviderIds,ChildCount,RecursiveItemCount'
  }).catch(function () {
    return _request('/Items/' + encodeURIComponent(itemId), {
      Fields: 'Overview,Genres,People,Studios,DateCreated,MediaSources,MediaStreams,ProviderIds,ChildCount,RecursiveItemCount'
    });
  }).then(function (raw) {
    var mapped = _mapItem(raw);
    if (!mapped) throw new Error('Jellyfin item was not found or is not supported.');
    mapped.description = raw.Overview || '';
    mapped.genres = Array.isArray(raw.Genres) ? raw.Genres : [];
    mapped.studios = Array.isArray(raw.Studios) ? raw.Studios.map(function (x) { return x.Name; }).filter(Boolean) : [];
    mapped.cast = Array.isArray(raw.People) ? raw.People.filter(function (x) { return x.Type === 'Actor'; }).slice(0, 10).map(function (x) { return x.Name; }) : [];
    mapped.status = raw.Status === 'Continuing' ? 'ongoing' : 'completed';
    mapped.episodes = [];
    if (String(raw.Type).toLowerCase() === 'series') {
      return _userId().then(function (userId) {
        return _request('/Shows/' + encodeURIComponent(itemId) + '/Episodes', {
          UserId: userId,
          Fields: 'Overview,PrimaryImageAspectRatio,CommunityRating,ProductionYear',
          IsMissing: false
        });
      }).then(function (data) {
        mapped.episodes = (Array.isArray(data.Items) ? data.Items : []).map(function (episode) {
          var item = _mapItem(episode);
          if (!item) return null;
          item.title = 'S' + _pad(item.seasonNumber) + ' E' + _pad(item.episodeNumber) + ' - ' + String(episode.Name || 'Episode');
          item.url = 'jellyfin://' + String(episode.Id);
          item.id = item.url;
          item.date = episode.PremiereDate || null;
          item.thumbnail = episode.ImageTags && episode.ImageTags.Primary ? _imageUrl(episode.Id, 'Primary', episode.ImageTags.Primary) : null;
          return item;
        }).filter(Boolean);
        mapped.subCount = mapped.episodes.length;
        mapped.dubCount = 0;
        return mapped;
      });
    }
    if (String(raw.Type).toLowerCase() === 'movie' || String(raw.Type).toLowerCase() === 'episode') {
      mapped.episodes = [{
        id: 'main',
        title: mapped.title,
        number: 1,
        season: 1,
        url: mapped.url
      }];
      mapped.subCount = 1;
      mapped.dubCount = 0;
    }
    return mapped;
  });
}

function getEpisodes(id) {
  return getDetail(id).then(function (detail) { return detail.episodes || []; });
}

function getVideoSources(id) {
  var itemId = _parseItemUrl(id);
  if (!itemId) return Promise.reject(new Error('Invalid Jellyfin episode URL.'));
  return _userId().then(function (userId) {
    return _request('/Items/' + encodeURIComponent(itemId) + '/PlaybackInfo', {
      UserId: userId,
      AutoOpenLiveStream: false,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true
    }, { noCache: true }).then(function (info) {
      var mediaSources = Array.isArray(info.MediaSources) ? info.MediaSources : [];
      var sources = [];
      mediaSources.forEach(function (mediaSource) {
        var mediaSourceId = String(mediaSource.Id || itemId);
        var container = String(mediaSource.Container || '').toLowerCase();
        var directUrl = _config().server + '/Videos/' + encodeURIComponent(itemId) + '/stream' +
          '?static=true&mediaSourceId=' + encodeURIComponent(mediaSourceId) +
          '&api_key=' + encodeURIComponent(_config().apiKey);
        var headers = {};
        if (mediaSource.RequiredHttpHeaders && typeof mediaSource.RequiredHttpHeaders === 'object') {
          Object.keys(mediaSource.RequiredHttpHeaders).forEach(function (key) {
            headers[key] = mediaSource.RequiredHttpHeaders[key];
          });
        }
        sources.push({
          url: directUrl,
          title: 'Jellyfin · ' + String(mediaSource.Name || 'Direct Play'),
          name: 'Jellyfin',
          quality: mediaSource.Bitrate ? Math.round(Number(mediaSource.Bitrate) / 1000000) + ' Mbps' : 'Original',
          container: container === 'm3u8' ? 'hls' : (container || 'mp4'),
          headers: headers,
          subtitles: (Array.isArray(mediaSource.MediaStreams) ? mediaSource.MediaStreams : [])
            .filter(function (stream) { return stream.Type === 'Subtitle' && stream.DeliveryUrl; })
            .map(function (stream) {
              return {
                url: stream.DeliveryUrl.charAt(0) === '/' ? _config().server + stream.DeliveryUrl : stream.DeliveryUrl,
                lang: stream.Language || 'und',
                label: stream.DisplayTitle || stream.Language || 'Subtitle',
                format: stream.Codec || 'vtt'
              };
            })
        });
      });
      if (sources.length) return sources;
      // Jellyfin may omit MediaSources on some setups; the canonical stream
      // endpoint remains usable and asks the server to select the source.
      return [{
        url: _config().server + '/Videos/' + encodeURIComponent(itemId) + '/stream?static=true&api_key=' + encodeURIComponent(_config().apiKey),
        title: 'Jellyfin · Direct stream',
        name: 'Jellyfin',
        container: 'mp4',
        headers: {},
        subtitles: []
      }];
    });
  });
}

function getStreams(id) { return getVideoSources(id); }

function _exports() {
  return {
    version: '1.0.0',
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
    _mapItem: _mapItem,
    _parseItemUrl: _parseItemUrl,
    _imageUrl: _imageUrl
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = _exports();
