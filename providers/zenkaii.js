// Zenkai Player — AniList catalogue + Zenkaii's hosted player embed.
// Important: Zenkaii's documented endpoint is an HTML iframe player, not a
// direct HLS/MP4 URL. This provider exposes the embed URL as an unknown source;
// the consuming app must support opening web-player URLs to play it.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'zenkaii';
var ANILIST_API = 'https://graphql.anilist.co';
var ZENKAI_EMBED = 'https://zenkaii.pages.dev/embed';
var SERVER_VALUES = ['megaplay', 'vidstream', 'flixcloud', 'acdn'];
var AUDIO_VALUES = ['sub', 'dub'];

function getInfo() {
  return {
    name: 'Zenkai Player',
    lang: 'en',
    baseUrl: 'https://zenkaii.pages.dev',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=zenkaii.pages.dev',
    type: 'anime',
    version: '1.0.0'
  };
}

function getSettings() {
  return [
    {
      key: 'server',
      label: 'Zenkai Player server',
      description: 'Preferred Zenkai player server. The embed player can fail over when a source is unavailable.',
      type: 'enum',
      default: 'megaplay',
      options: [
        { value: 'megaplay', label: 'MegaPlay (HD-1)' },
        { value: 'vidstream', label: 'VidStream (HD-2)' },
        { value: 'flixcloud', label: 'FlixCloud' },
        { value: 'acdn', label: 'ACDN (multi-audio HLS)' }
      ]
    },
    {
      key: 'audio',
      label: 'Preferred audio',
      description: 'SUB uses the original audio with subtitles. DUB selects the English dub when the title has one.',
      type: 'enum',
      default: 'sub',
      options: [
        { value: 'sub', label: 'SUB · Original audio' },
        { value: 'dub', label: 'DUB · English audio' }
      ]
    }
  ];
}

function _trim(value) {
  return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function _setting(key, fallback) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var settings = all[SOURCE_ID] || {};
    var value = settings[key];
    return value == null || value === '' ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

function _config() {
  var server = _trim(_setting('server', 'megaplay')).toLowerCase();
  var audio = _trim(_setting('audio', 'sub')).toLowerCase();
  if (SERVER_VALUES.indexOf(server) < 0) server = 'megaplay';
  if (AUDIO_VALUES.indexOf(audio) < 0) audio = 'sub';
  return { server: server, audio: audio };
}

function _graphql(query, variables) {
  return fetch(ANILIST_API, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: query, variables: variables || {} }),
    timeoutMs: 15000
  }).then(function (response) {
    if (response && response.status && response.status >= 400) {
      throw new Error('AniList HTTP ' + response.status);
    }
    var body = response && response.body != null ? response.body : '';
    var json = typeof body === 'string' ? JSON.parse(body || 'null') : body;
    if (!json || (Array.isArray(json.errors) && json.errors.length)) {
      throw new Error('AniList returned an invalid or error response');
    }
    return json.data || {};
  });
}

var MEDIA_FIELDS = [
  'id',
  'title { romaji english native }',
  'format',
  'status',
  'seasonYear',
  'episodes',
  'averageScore',
  'description',
  'genres',
  'coverImage { extraLarge large }',
  'bannerImage'
].join(' ');

function _mediaItem(media) {
  if (!media || !Number.isInteger(Number(media.id)) || Number(media.id) < 1) return null;
  var title = _trim((media.title && (media.title.english || media.title.romaji || media.title.native)) || '');
  if (!title) return null;
  var id = Number(media.id);
  var itemUrl = 'anilist://' + id;
  var item = {
    id: itemUrl,
    url: itemUrl,
    title: media.seasonYear ? title + ' (' + media.seasonYear + ')' : title,
    cover: media.coverImage && (media.coverImage.extraLarge || media.coverImage.large) || null,
    banner: media.bannerImage || null,
    type: 'anime',
    sourceId: SOURCE_ID,
    anilistId: id
  };
  if (media.averageScore != null && isFinite(Number(media.averageScore))) {
    item.score = Number(media.averageScore);
  }
  return item;
}

function _mapMedia(list) {
  return (Array.isArray(list) ? list : []).map(_mediaItem).filter(Boolean);
}

function getHome(opts) {
  var query = 'query { Page(page: 1, perPage: 20) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ' + MEDIA_FIELDS + ' } } }';
  return _graphql(query, {}).then(function (data) {
    var items = _mapMedia(data.Page && data.Page.media);
    return items.length ? [{ title: 'Trending Anime · Zenkai', items: items }] : [];
  }).catch(function (error) {
    console.warn('Zenkai Player home failed:', String(error));
    return [];
  });
}

function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    (rows || []).forEach(function (row) {
      (row.items || []).forEach(function (item) { out.push(item); });
    });
    return out;
  });
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  var gql = 'query ($search: String, $page: Int) { Page(page: $page, perPage: 20) { media(search: $search, type: ANIME, sort: SEARCH_MATCH, isAdult: false) { ' + MEDIA_FIELDS + ' } } }';
  return _graphql(gql, { search: q, page: p }).then(function (data) {
    return _mapMedia(data.Page && data.Page.media);
  }).catch(function (error) {
    console.warn('Zenkai Player search failed:', String(error));
    return [];
  });
}

function _parseAniListId(value) {
  if (value && typeof value === 'object') {
    var candidate = value.anilistId || value.anilist_id || value.id || value.mediaId;
    if (candidate != null && /^\d+$/.test(String(candidate))) {
      var number = Number(candidate);
      return number > 0 ? number : null;
    }
  }
  var raw = _trim(value);
  if (/^\d+$/.test(raw)) return Number(raw) > 0 ? Number(raw) : null;
  var match = raw.match(/^(?:anilist|zenkaii):\/\/(\d+)(?:[/?#]|$)/i);
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
}

function _episodeUrl(anilistId, episode, title) {
  return JSON.stringify({
    provider: 'zenkaii',
    anilistId: Number(anilistId),
    episode: Number(episode),
    title: String(title || '')
  });
}

function _episodes(media) {
  var id = Number(media.id);
  var count = Number(media.episodes);
  var isMovie = String(media.format || '').toUpperCase() === 'MOVIE';
  if (isMovie) count = 1;
  if (!isFinite(count) || count < 1) return [];
  count = Math.min(Math.floor(count), 500);
  var out = [];
  var title = _trim((media.title && (media.title.english || media.title.romaji || media.title.native)) || '');
  for (var ep = 1; ep <= count; ep++) {
    out.push({
      id: String(ep),
      title: title + ' · Episode ' + ep,
      number: ep,
      url: _episodeUrl(id, ep, title)
    });
  }
  return out;
}

function getDetail(url, opts) {
  var id = _parseAniListId(url);
  if (!id) return Promise.resolve(null);
  var query = 'query ($id: Int) { Media(id: $id, type: ANIME) { ' + MEDIA_FIELDS + ' } }';
  return _graphql(query, { id: id }).then(function (data) {
    var media = data.Media;
    if (!media || Number(media.id) !== id) return null;
    var item = _mediaItem(media);
    var episodes = _episodes(media);
    var status = String(media.status || '').toLowerCase();
    return {
      id: 'anilist://' + id,
      url: 'anilist://' + id,
      title: item.title.replace(/\s+\(\d{4}\)$/, ''),
      cover: item.cover,
      banner: item.banner,
      description: media.description || '',
      status: status === 'finished' ? 'completed' :
        (status === 'releasing' || status === 'not_yet_released') ? 'ongoing' : 'unknown',
      genres: Array.isArray(media.genres) ? media.genres : [],
      studios: [],
      type: 'anime',
      sourceId: SOURCE_ID,
      year: media.seasonYear ? String(media.seasonYear) : null,
      anilistId: id,
      episodes: episodes,
      subCount: episodes.length,
      dubCount: 0
    };
  }).catch(function (error) {
    console.warn('Zenkai Player detail failed:', String(error));
    return null;
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) {
    return detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  });
}

function _parseEpisode(value) {
  var item = value && typeof value === 'object' ? value : null;
  var raw = _trim(value);
  if (!item && raw.charAt(0) === '{') {
    try { item = JSON.parse(raw); } catch (e) {}
  }
  if (!item || typeof item !== 'object') return null;
  var id = _parseAniListId(item.anilistId || item.anilist_id || item.id);
  var ep = Number(item.episode || item.ep || item.number);
  if (!id || !Number.isInteger(ep) || ep < 1 || ep > 500) return null;
  return { anilistId: id, episode: ep, title: _trim(item.title || '') };
}

function buildEmbedUrl(anilistId, episode, server, audio) {
  var id = Number(anilistId);
  var ep = Number(episode);
  var srv = _trim(server).toLowerCase();
  var lang = _trim(audio).toLowerCase();
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(ep) || ep < 1) return null;
  if (SERVER_VALUES.indexOf(srv) < 0 || AUDIO_VALUES.indexOf(lang) < 0) return null;
  return ZENKAI_EMBED + '?id=' + encodeURIComponent(id) +
    '&ep=' + encodeURIComponent(ep) +
    '&server=' + encodeURIComponent(srv) +
    '&audio=' + encodeURIComponent(lang);
}

function getVideoSources(episodeUrl, opts) {
  var parsed = _parseEpisode(episodeUrl);
  if (!parsed) return Promise.resolve([]);
  var config = _config();
  var embedUrl = buildEmbedUrl(parsed.anilistId, parsed.episode, config.server, config.audio);
  if (!embedUrl) return Promise.resolve([]);
  var isDub = config.audio === 'dub';
  return Promise.resolve([{
    url: embedUrl,
    quality: 'Auto',
    label: 'Zenkai Player · ' + config.server + ' · ' + config.audio.toUpperCase(),
    container: 'unknown',
    kind: config.audio,
    audioLang: isDub ? 'en' : 'ja'
  }]);
}

function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.0',
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
    buildEmbedUrl: buildEmbedUrl,
    _config: _config,
    _parseAniListId: _parseAniListId,
    _parseEpisode: _parseEpisode
  };
}
