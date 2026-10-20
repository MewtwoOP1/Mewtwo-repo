// Mega-Anime — native Zangetsu provider
// Metadata: AniList GraphQL (same backend as the original RaghavAnime provider)
// Streams: pluggable source adapters.
//
// Contract verified against:
//   providers/_template.js
//   providers/example.js
//   providers/allanime.js
//
// NOTE: AniWaves / AniNami adapters below follow the provider's expected
// request/response shape, but their exact current endpoints must be checked
// against the original Kotlin source before calling them live-verified.

var SOURCE_ID = 'mega-anime';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
         '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

var MEDIA_FIELDS =
  'id title{romaji english native} coverImage{extraLarge large} bannerImage ' +
  'description(asHtml:false) status genres studios(isMain:true){nodes{name}} ' +
  'episodes format averageScore seasonYear nextAiringEpisode{episode}';

var SEARCH_QUERY =
  'query($search:String,$page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){' +
  'media(search:$search,type:ANIME,sort:POPULARITY_DESC){' + MEDIA_FIELDS + '}}}';

var HOME_QUERY =
  'query($sort:[MediaSort],$page:Int,$perPage:Int){Page(page:$page,perPage:$perPage){' +
  'media(type:ANIME,sort:$sort){' + MEDIA_FIELDS + '}}}';

var DETAIL_QUERY =
  'query($id:Int){Media(id:$id,type:ANIME){' + MEDIA_FIELDS + '}}';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function _anilist(query, variables) {
  return fetch(ANILIST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': UA
    },
    body: JSON.stringify({ query: query, variables: variables || {} })
  }).then(function (r) {
    if (r.status < 200 || r.status >= 300) {
      throw new Error('AniList HTTP ' + r.status);
    }
    return r.json();
  }).then(function (body) {
    if (body.errors && body.errors.length) {
      throw new Error('AniList: ' + body.errors[0].message);
    }
    return body;
  });
}

function _titleOf(m) {
  if (!m || !m.title) return 'Unknown';
  return m.title.english || m.title.romaji || m.title.native || 'Unknown';
}

function _coverOf(m) {
  if (!m || !m.coverImage) return null;
  return m.coverImage.extraLarge || m.coverImage.large || null;
}

function _typeOf(m) {
  return m && m.format === 'MOVIE' ? 'movie' : 'anime';
}

function _mediaToItem(m) {
  return {
    id: 'anilist:' + m.id,
    title: _titleOf(m),
    url: 'anilist:' + m.id,
    cover: _coverOf(m),
    type: _typeOf(m),
    sourceId: SOURCE_ID
  };
}

function _parseId(url) {
  var m = String(url || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function _episodesFor(media) {
  var count = media.episodes || 0;
  if (!count && media.nextAiringEpisode && media.nextAiringEpisode.episode) {
    count = media.nextAiringEpisode.episode - 1;
  }
  if (!count || count < 1) count = 1;

  var out = [];
  for (var i = 1; i <= count; i++) {
    var id = 'mega-anime:' + media.id + ':' + i + ':sub';
    out.push({
      id: id,
      title: 'Episode ' + i,
      number: i,
      url: id,
      date: null
    });
  }
  return out;
}

function _normTitle(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function _titleMatch(a, b) {
  var na = _normTitle(a);
  var nb = _normTitle(b);
  if (!na || !nb) return false;
  return na === nb || na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0;
}

function _toVideo(url, quality, headers) {
  var isHls = /\.m3u8(\?|$)/i.test(url);
  return {
    url: url,
    quality: quality || 'auto',
    container: isHls ? 'hls' : 'mp4',
    kind: 'video',
    headers: headers || {}
  };
}

function _dedupe(list) {
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var s = list[i];
    if (!s || !s.url) continue;
    var key = s.url + '|' + (s.quality || '');
    if (seen[key]) continue;
    seen[key] = true;
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// provider contract
// ---------------------------------------------------------------------------

function getInfo() {
  return {
    name: 'Mega-Anime',
    lang: 'en',
    baseUrl: 'https://anilist.co',
    logo: 'https://anilist.co/favicon.ico',
    type: 'anime',
    version: '1.0.0'
  };
}

function search(query, page, opts) {
  return _anilist(SEARCH_QUERY, {
    search: String(query || ''),
    page: page || 1,
    perPage: 30
  }).then(function (body) {
    var media = (body.data && body.data.Page && body.data.Page.media) || [];
    return media.map(_mediaToItem);
  }).catch(function (e) {
    console.error('[mega-anime] search failed: ' + (e && e.message));
    return [];
  });
}

function getHome(opts) {
  function row(sort, title) {
    return _anilist(HOME_QUERY, { sort: [sort], page: 1, perPage: 20 })
      .then(function (body) {
        var media = (body.data && body.data.Page && body.data.Page.media) || [];
        return { title: title, items: media.map(_mediaToItem) };
      })
      .catch(function () {
        return { title: title, items: [] };
      });
  }

  return Promise.all([
    row('TRENDING_DESC', 'Trending Now'),
    row('POPULARITY_DESC', 'Popular This Season'),
    row('SCORE_DESC', 'Top Rated')
  ]);
}

function getDetail(url) {
  var id = _parseId(url);
  if (!id) return Promise.resolve(null);

  return _anilist(DETAIL_QUERY, { id: id }).then(function (body) {
    var m = body.data && body.data.Media;
    if (!m) return null;

    var studios = [];
    if (m.studios && m.studios.nodes) {
      for (var i = 0; i < m.studios.nodes.length; i++) {
        if (m.studios.nodes[i].name) studios.push(m.studios.nodes[i].name);
      }
    }

    return {
      id: 'anilist:' + m.id,
      title: _titleOf(m),
      url: 'anilist:' + m.id,
      cover: _coverOf(m),
      description: m.description || '',
      status: m.status || 'UNKNOWN',
      genres: m.genres || [],
      studios: studios,
      type: _typeOf(m),
      sourceId: SOURCE_ID,
      episodes: _episodesFor(m)
    };
  }).catch(function (e) {
    console.error('[mega-anime] detail failed: ' + (e && e.message));
    return null;
  });
}

function getEpisodes(seriesUrl) {
  return getDetail(seriesUrl).then(function (d) {
    return d && d.episodes ? d.episodes : [];
  });
}

// ---------------------------------------------------------------------------
// source adapters
// ---------------------------------------------------------------------------

function _searchSource(base, title, headers) {
  var q = encodeURIComponent(title);
  return fetch(base + '/api/search?q=' + q, {
    headers: headers
  }).then(function (r) {
    if (r.status < 200 || r.status >= 300) {
      throw new Error('search HTTP ' + r.status);
    }
    return r.json();
  });
}

function _pickMatch(list, title) {
  if (!list) return null;
  var arr = list.results || list.data || list.anime || list.items || [];
  if (!Array.isArray(arr)) return null;
  for (var i = 0; i < arr.length; i++) {
    if (_titleMatch(arr[i].title, title)) return arr[i];
  }
  return null;
}

function _resolveEpisodePage(base, slug, ep, headers) {
  return fetch(base + '/api/anime/' + encodeURIComponent(slug) +
               '/episodes/' + ep, { headers: headers })
    .then(function (r) {
      if (r.status < 200 || r.status >= 300) {
        throw new Error('episode HTTP ' + r.status);
      }
      return r.json();
    });
}

function _serversToVideos(servers, referer) {
  var out = [];
  if (!Array.isArray(servers)) return out;

  for (var i = 0; i < servers.length; i++) {
    var s = servers[i] || {};
    var url = s.url || s.file || s.link || s.src;
    if (!url || !/^https?:/i.test(url)) continue;

    if (/\.(m3u8|mp4)(\?|$)/i.test(url)) {
      out.push(_toVideo(url, s.quality, { Referer: referer }));
      continue;
    }

    // Embed — let Zangetsu's extractor resolve it.
    try {
      var resolved = extractVideo(url, { headers: { Referer: referer } });
      if (resolved && resolved.length) {
        out = out.concat(resolved);
      }
    } catch (e) {
      // extractor does not know this host; skip without failing the source
    }
  }
  return out;
}

// --- AniWaves --------------------------------------------------------------

function resolveAniWaves(media, ep) {
  var base = 'https://aniwaves.ru'; // verify against AniWaves.kt BASE_URL
  var title = media.title.romaji || media.title.english || '';
  var headers = {
    'Accept': 'application/json',
    'User-Agent': UA,
    'Referer': base + '/'
  };

  return _searchSource(base, title, headers).then(function (data) {
    var match = _pickMatch(data, title);
    if (!match) return [];
    var slug = match.slug || match.id;
    if (!slug) return [];
    return _resolveEpisodePage(base, slug, ep, headers);
  }).then(function (epData) {
    if (!epData) return [];
    return _serversToVideos(
      epData.servers || epData.sources || epData.links || [],
      base + '/'
    );
  }).catch(function (e) {
    console.warn('[mega-anime] AniWaves failed: ' + (e && e.message));
    return [];
  });
}

// --- AniNami --------------------------------------------------------------

function resolveAniNami(media, ep) {
  var base = 'https://aninami.me'; // verify against AniNami resolver
  var title = media.title.romaji || media.title.english || '';
  var headers = {
    'Accept': 'application/json',
    'User-Agent': UA,
    'Referer': base + '/'
  };

  return _searchSource(base, title, headers).then(function (data) {
    var match = _pickMatch(data, title);
    if (!match) return [];
    var slug = match.slug || match.id;
    if (!slug) return [];
    return _resolveEpisodePage(base, slug, ep, headers);
  }).then(function (epData) {
    if (!epData) return [];
    return _serversToVideos(
      epData.servers || epData.sources || epData.links || [],
      base + '/'
    );
  }).catch(function (e) {
    console.warn('[mega-anime] AniNami failed: ' + (e && e.message));
    return [];
  });
}

// ---------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------

function _resolveAll(media, episodeNumber) {
  var resolvers = [
    resolveAniWaves,
    resolveAniNami
  ];

  var tasks = resolvers.map(function (fn) {
    return Promise.resolve()
      .then(function () { return fn(media, episodeNumber); })
      .catch(function (e) {
        console.warn('[mega-anime] source error: ' + (e && e.message));
        return [];
      });
  });

  return Promise.all(tasks).then(function (lists) {
    var flat = [];
    for (var i = 0; i < lists.length; i++) {
      if (Array.isArray(lists[i])) flat = flat.concat(lists[i]);
    }
    return _dedupe(flat);
  });
}

function getVideoSources(episodeUrl) {
  var parts = String(episodeUrl || '').split(':');
  var id = parseInt(parts[1], 10);
  var ep = parseInt(parts[2], 10) || 1;

  if (!id) return Promise.resolve([]);

  return _anilist(DETAIL_QUERY, { id: id }).then(function (body) {
    var media = body.data && body.data.Media;
    if (!media) return [];
    return _resolveAll(media, ep);
  }).catch(function (e) {
    console.error('[mega-anime] sources failed: ' + (e && e.message));
    return [];
  });
}
