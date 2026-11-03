// Ani.pm provider for Zangetsu.
// Playback follows Anilili's current native Ani.pm -> Settlar flow.
// AniList GraphQL is used only to translate Zangetsu's title search into the
// AniList IDs required by Ani.pm's package and playback APIs. No partner API
// or alternate streaming backend is used.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'anipm';
var SITE = 'https://ani.pm';
var EMBED = 'https://embed.settlar.io';
var ANILIST = 'https://graphql.anilist.co';
var VERSION = '1.0.0';
var LOGO = 'https://www.google.com/s2/favicons?sz=256&domain=ani.pm';

// Anilili's provider uses this Android Chrome UA on every Ani.pm and Settlar
// request. Those hosts reject generic Node/OpenSSL and okhttp/* user agents.
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36';

var SEARCH_QUERY = [
  'query ($search: String!) {',
  '  Page(page: 1, perPage: 12) {',
  '    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {',
  '      id idMal',
  '      title { english romaji native }',
  '      coverImage { large extraLarge }',
  '      description(asHtml: false)',
  '      episodes status format seasonYear',
  '      startDate { year }',
  '      genres',
  '      studios { nodes { name } }',
  '    }',
  '  }',
  '}'
].join('\n');

var DETAIL_QUERY = [
  'query ($id: Int!) {',
  '  Media(id: $id, type: ANIME) {',
  '    id idMal',
  '    title { english romaji native }',
  '    coverImage { large extraLarge }',
  '    description(asHtml: false)',
  '    episodes status format seasonYear',
  '    startDate { year }',
  '    genres',
  '    studios { nodes { name } }',
  '  }',
  '}'
].join('\n');

var _mediaCache = {};
var _packageCache = {};
var CACHE_TTL_MS = 30000;

function getInfo() {
  return {
    name: 'Ani.pm',
    lang: 'en',
    baseUrl: SITE,
    logo: LOGO,
    type: 'anime',
    version: VERSION
  };
}

function getSettings() { return []; }

function _trim(value) {
  return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function _number(value) {
  if (value === null || value === undefined || value === '') return null;
  var s = String(value);
  if (!/^\d+$/.test(s)) return null;
  var n = Number(s);
  return isFinite(n) && n > 0 ? n : null;
}

function _body(response) {
  if (response && typeof response.body === 'string') return Promise.resolve(response.body);
  if (response && response.body != null) return Promise.resolve(JSON.stringify(response.body));
  if (response && typeof response.text === 'function') {
    return Promise.resolve(response.text()).then(function(value) {
      return String(value == null ? '' : value);
    });
  }
  return Promise.resolve('');
}

function _decodeJson(response, label, allowNotFound) {
  var status = Number(response && response.status || 0);
  if (status === 404 && allowNotFound) return Promise.resolve(null);
  if (status && (status < 200 || status >= 300)) {
    return Promise.reject(new Error(label + ' HTTP ' + status));
  }
  return _body(response).then(function(raw) {
    try {
      var value = JSON.parse(raw || 'null');
      if (!value || typeof value !== 'object') throw new Error('empty JSON object');
      return value;
    } catch (error) {
      throw new Error(label + ' returned invalid JSON');
    }
  });
}

function _requestJson(url, label, allowNotFound) {
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json'
    },
    timeoutMs: 10000
  }).then(function(response) {
    return _decodeJson(response, label, !!allowNotFound);
  });
}

function _anilistRequest(query, variables, label) {
  return fetch(ANILIST, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: query, variables: variables || {} }),
    timeoutMs: 12000
  }).then(function(response) {
    return _decodeJson(response, 'AniList ' + label, false);
  }).then(function(result) {
    if (Array.isArray(result.errors) && result.errors.length) {
      throw new Error('AniList ' + label + ' failed');
    }
    return result.data || {};
  });
}

function _mediaTitle(media) {
  var title = media && media.title || {};
  return _trim(title.english || title.romaji || title.native || '');
}

function _mediaCover(media) {
  var cover = media && media.coverImage || {};
  return cover.extraLarge || cover.large || null;
}

function _mediaYear(media) {
  if (media && media.seasonYear) return String(media.seasonYear);
  var year = media && media.startDate && media.startDate.year;
  return year ? String(year) : null;
}

function _status(value) {
  var status = String(value || '').toUpperCase();
  if (status === 'FINISHED') return 'completed';
  if (status === 'RELEASING') return 'ongoing';
  if (status === 'HIATUS') return 'hiatus';
  if (status === 'CANCELLED') return 'cancelled';
  return 'unknown';
}

function _packageUrl(anilistId) {
  return SITE + '/api/anime/anipm-server/_packages?anilistId='
    + encodeURIComponent(String(anilistId));
}

// Mirrors AniPmParser.availability in Anilili: the package inventory, not
// AniList's aired-episode count, is the authoritative list Ani.pm can play.
function _availability(root) {
  var source = root && root.episodes;
  var entries = [];
  var subCount = 0;
  var dubCount = 0;
  if (!source || typeof source !== 'object') {
    return { entries: entries, subCount: 0, dubCount: 0 };
  }

  Object.keys(source).forEach(function(key) {
    if (!/^\d+$/.test(key)) return;
    var number = Number(key);
    if (!isFinite(number) || number < 1) return;
    var item = source[key];
    if (!item || typeof item !== 'object') return;
    var sub = item.sub === true;
    var dub = item.dub === true;
    if (!sub && !dub) return;
    if (sub) subCount++;
    if (dub) dubCount++;
    entries.push({ number: number, sub: sub, dub: dub });
  });

  entries.sort(function(a, b) { return a.number - b.number; });
  return { entries: entries, subCount: subCount, dubCount: dubCount };
}

function _getPackages(anilistId, force) {
  var id = String(anilistId);
  var cached = _packageCache[id];
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached.value);
  }
  return _requestJson(_packageUrl(id), 'Ani.pm package inventory', true).then(function(root) {
    if (!root) return null;
    var value = _availability(root);
    _packageCache[id] = { at: Date.now(), value: value };
    return value;
  });
}

function _category(opts) {
  return opts && String(opts.category || '').toLowerCase() === 'dub' ? 'dub' : 'sub';
}

function _episodeUrl(anilistId, number, channel) {
  return 'anipm-episode://' + String(anilistId) + '/' + String(number) + '/' + channel;
}

function _episodeRows(anilistId, inventory, channel) {
  var out = [];
  (inventory && inventory.entries || []).forEach(function(entry) {
    if (!entry[channel]) return;
    out.push({
      id: String(anilistId) + ':' + String(entry.number) + ':' + channel,
      number: entry.number,
      title: 'Episode ' + entry.number,
      url: _episodeUrl(anilistId, entry.number, channel),
      sourceId: SOURCE_ID,
      type: 'anime'
    });
  });
  return out;
}

function _card(media) {
  var id = _number(media && media.id);
  var title = _mediaTitle(media);
  if (!id || !title) return null;
  _mediaCache[String(id)] = { at: Date.now(), value: media };
  return {
    id: String(id),
    title: title,
    url: 'anipm://' + String(id),
    cover: _mediaCover(media),
    type: 'anime',
    sourceId: SOURCE_ID,
    malId: _number(media.idMal),
    year: _mediaYear(media)
  };
}

function _mapLimit(items, limit, worker) {
  var output = new Array(items.length);
  var nextIndex = 0;
  var workers = [];
  function run() {
    if (nextIndex >= items.length) return Promise.resolve();
    var index = nextIndex++;
    return Promise.resolve(worker(items[index], index)).then(function(value) {
      output[index] = value;
    }).catch(function() {
      output[index] = null;
    }).then(run);
  }
  for (var i = 0; i < Math.min(limit, items.length); i++) workers.push(run());
  return Promise.all(workers).then(function() { return output; });
}

// Zangetsu only passes query/page/category to search(). Resolve the title to
// AniList media IDs first, then ask Ani.pm whether each ID has playable packs.
function search(query, page, opts) {
  var q = _trim(query);
  if (q.length < 2) return Promise.resolve([]);
  return _anilistRequest(SEARCH_QUERY, { search: q }, 'title search').then(function(data) {
    var pageData = data.Page || {};
    var media = Array.isArray(pageData.media) ? pageData.media : [];
    var channel = _category(opts);
    return _mapLimit(media, 4, function(item) {
      var id = _number(item && item.id);
      if (!id) return null;
      return _getPackages(id).then(function(inventory) {
        if (!inventory || !inventory.entries.length) return null;
        if (channel === 'dub' && inventory.dubCount < 1) return null;
        if (channel === 'sub' && inventory.subCount < 1) return null;
        return _card(item);
      });
    }).then(function(cards) {
      return cards.filter(Boolean);
    });
  }).catch(function() {
    return [];
  });
}

function _getMedia(anilistId) {
  var id = String(anilistId);
  var cached = _mediaCache[id];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached.value);
  }
  return _anilistRequest(DETAIL_QUERY, { id: Number(id) }, 'media lookup').then(function(data) {
    var media = data.Media || null;
    if (media && _number(media.id)) {
      _mediaCache[id] = { at: Date.now(), value: media };
    }
    return media;
  });
}

function _extractAnilistId(value) {
  var raw = String(value == null ? '' : value);
  var match = raw.match(/^anipm:\/\/(\d+)$/i)
    || raw.match(/^anipm-episode:\/\/(\d+)\/\d+\/(?:sub|dub)$/i)
    || raw.match(/^(\d+)$/);
  return match ? _number(match[1]) : null;
}

function getDetail(url, opts) {
  var id = _extractAnilistId(url);
  if (!id) return Promise.reject(new Error('Ani.pm: invalid AniList reference'));
  return Promise.all([
    _getMedia(id),
    _getPackages(id)
  ]).then(function(values) {
    var media = values[0];
    var inventory = values[1];
    if (!media) throw new Error('Ani.pm: AniList media not found');
    if (!inventory) throw new Error('Ani.pm: no package inventory for this title');

    var channel = _category(opts);
    var episodes = _episodeRows(id, inventory, channel);
    var studios = media.studios && Array.isArray(media.studios.nodes)
      ? media.studios.nodes.map(function(studio) { return studio && studio.name; }).filter(Boolean)
      : [];
    var title = _mediaTitle(media) || ('AniList title ' + id);
    var english = media.title && media.title.english;
    var native = media.title && media.title.native;

    return {
      id: String(id),
      title: title,
      englishTitle: english || undefined,
      nativeTitle: native || undefined,
      url: 'anipm://' + String(id),
      cover: _mediaCover(media),
      description: String(media.description || ''),
      status: _status(media.status),
      genres: Array.isArray(media.genres) ? media.genres : [],
      studios: studios,
      type: 'anime',
      sourceId: SOURCE_ID,
      year: _mediaYear(media),
      malId: _number(media.idMal),
      episodes: episodes,
      subCount: inventory.subCount,
      dubCount: inventory.dubCount
    };
  });
}

function getEpisodes(url, opts) {
  var id = _extractAnilistId(url);
  if (!id) return Promise.reject(new Error('Ani.pm: invalid AniList reference'));
  var channel = _category(opts);
  return _getPackages(id).then(function(inventory) {
    if (!inventory) throw new Error('Ani.pm: no package inventory for this title');
    return _episodeRows(id, inventory, channel);
  });
}

function _episodeReference(value) {
  var raw = typeof value === 'string' ? value
    : (value && (value.url || value.id)) || '';
  var match = String(raw).match(/^anipm-episode:\/\/(\d+)\/(\d+)\/(sub|dub)$/i);
  if (!match) return null;
  var id = _number(match[1]);
  var episode = _number(match[2]);
  if (!id || !episode) return null;
  return { anilistId: id, episode: episode, channel: match[3].toLowerCase() };
}

function _queryToken(embedUrl) {
  var match = String(embedUrl || '').match(/[?&]t=([^&#]+)/i);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); }
  catch (error) { return match[1]; }
}

var LANGUAGE_CODES = {
  ind: 'id', tha: 'th', chi: 'zh', zho: 'zh', kor: 'ko', pol: 'pl',
  tur: 'tr', jpn: 'ja', eng: 'en', spa: 'es', por: 'pt', fre: 'fr',
  fra: 'fr', ger: 'de', deu: 'de', ita: 'it', rus: 'ru', ara: 'ar',
  vie: 'vi', may: 'ms', msa: 'ms'
};

function _subtitle(track) {
  if (!track || typeof track.url !== 'string' || !/^https:\/\//i.test(track.url)) return null;
  var code = _trim(track.srclang).toLowerCase();
  var lang = LANGUAGE_CODES[code] || code || 'und';
  var label = _trim(track.label) || 'Subtitles';
  var format = _trim(track.format).toLowerCase();
  if (!format) format = /\.srt(?:[?#]|$)/i.test(track.url) ? 'srt' : 'vtt';
  return {
    url: track.url,
    lang: lang,
    label: label,
    format: format,
    default: track.default === true
  };
}

function _container(kind, source) {
  var value = _trim(kind).toLowerCase();
  if (value === 'hls' || value === 'mp4') return value;
  if (/\.m3u8(?:[?#]|$)/i.test(source)) return 'hls';
  if (/\.mp4(?:[?#]|$)/i.test(source)) return 'mp4';
  return 'unknown';
}

// Exact Anilili request order:
// 1. package inventory (in catalogue/episode methods)
// 2. playback-bootstrap/anilist/{id}
// 3. ani.pm settlar/session
// 4. embed.settlar.io/api/embed/session
function getVideoSources(episodeUrl, opts) {
  var reference = _episodeReference(episodeUrl);
  if (!reference) {
    return Promise.reject(new Error('Ani.pm: invalid episode URL'));
  }

  var id = reference.anilistId;
  var episode = reference.episode;
  var channel = reference.channel;
  var bootstrapUrl = SITE + '/api/anime/playback-bootstrap/anilist/' + id
    + '?ep=' + episode + '&lang=' + channel + '&core=0';

  return _requestJson(bootstrapUrl, 'Ani.pm playback bootstrap', false).then(function(bootstrap) {
    // The API can silently return the other audio when the requested one is
    // absent. Never label that stream as the requested language.
    var effective = _trim(bootstrap.effectiveLanguage).toLowerCase();
    if (effective !== channel) {
      throw new Error('Ani.pm has no ' + channel + ' for episode ' + episode
        + (effective ? ' (offers ' + effective + ')' : ''));
    }
    var selection = _trim(bootstrap.settlarSelection);
    if (!selection) throw new Error('Ani.pm returned no Settlar selection');

    var sessionUrl = SITE + '/api/anime/settlar/session'
      + '?selection=' + encodeURIComponent(selection)
      + '&provider=anipm'
      + '&ep=' + episode
      + '&channel=' + channel
      + '&telemetry=0';

    return _requestJson(sessionUrl, 'Ani.pm Settlar session', false).then(function(session) {
      var embedUrl = _trim(session.embedUrl);
      var token = _queryToken(embedUrl);
      if (!token) throw new Error('Ani.pm returned an embed URL without a token');

      var embedSessionUrl = EMBED + '/api/embed/session?t=' + encodeURIComponent(token);
      return _requestJson(embedSessionUrl, 'Settlar embed session', false).then(function(embedSession) {
        var source = _trim(embedSession.source);
        if (!/^https:\/\//i.test(source)) {
          throw new Error('Settlar session did not contain an HTTPS stream');
        }

        var subtitles = (Array.isArray(embedSession.subtitles) ? embedSession.subtitles : [])
          .map(_subtitle).filter(Boolean);
        subtitles.sort(function(a, b) {
          return (b.default === true ? 1 : 0) - (a.default === true ? 1 : 0);
        });

        return [{
          url: source,
          container: _container(embedSession.kind || 'hls', source),
          kind: channel,
          subtitles: subtitles
        }];
      });
    });
  });
}

function getHome() { return Promise.resolve([]); }
function popular(opts) { return Promise.resolve([]); }
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION,
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    popular: popular,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams,
    getLinks: getLinks
  };
}
