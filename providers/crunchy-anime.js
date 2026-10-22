// Crunchy-anime — AnimeStream / UniqueStream provider for Zangetsu.
// Uses the site's public JSON routes for catalogue, metadata, episodes and
// media variants. It returns every media playlist and subtitle track the API
// exposes; it does not bypass anti-bot checks or decrypt/proxy wrapped HLS keys.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'crunchy-anime';
var SITE = 'https://anime.uniquestream.net';
var API = SITE + '/api/v1';
var VERSION = '1.0.0';
var PAGE_SIZE = 20;
var REQUEST_TIMEOUT_MS = 12000;
var DETAIL_CACHE_TTL_MS = 120000;
var DETAIL_CACHE = Object.create(null);

var LOCALE_NAMES = {
  'ja-JP': 'Japanese',
  'en-US': 'English',
  'en-GB': 'English (UK)',
  'ms-MY': 'Malay',
  'id-ID': 'Indonesian',
  'de-DE': 'German',
  'es-419': 'Spanish (Latin America)',
  'es-ES': 'Spanish',
  'it-IT': 'Italian',
  'ar-SA': 'Arabic',
  'pt-BR': 'Portuguese (Brazil)',
  'fr-FR': 'French',
  'th-TH': 'Thai',
  'hi-IN': 'Hindi',
  'ko-KR': 'Korean',
  'zh-CN': 'Chinese (Simplified)',
  'zh-TW': 'Chinese (Traditional)'
};

function getInfo() {
  return {
    name: 'Crunchy-anime',
    lang: 'en',
    baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=anime.uniquestream.net',
    type: 'anime',
    version: VERSION
  };
}

function getSettings() {
  return [];
}

function _trim(value) {
  return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
}

function _text(value) {
  return String(value == null ? '' : value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function _safeId(value) {
  return String(value == null ? '' : value).trim();
}

function _absolute(url, base) {
  var value = _trim(url);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.indexOf('//') === 0) return 'https:' + value;
  var origin = base || SITE;
  if (value.charAt(0) === '/') return origin.replace(/\/+$/, '') + value;
  return origin.replace(/\/+$/, '') + '/' + value;
}

function _jsonValue(response, path) {
  if (!response) throw new Error('No response for ' + path);
  var status = Number(response.status || 0);
  if ((status >= 400) || response.ok === false) {
    throw new Error('HTTP ' + status + ' for ' + path);
  }
  var body = response.body;
  if (body == null && typeof response.text === 'function') {
    return response.text().then(function (text) {
      return typeof text === 'string' ? JSON.parse(text || 'null') : text;
    });
  }
  if (typeof body === 'string') return JSON.parse(body || 'null');
  return body;
}

function _apiJson(path) {
  var url = /^https?:\/\//i.test(path) ? path : API + path;
  return fetch(url, {
    headers: {
      Accept: 'application/json',
      Referer: SITE + '/'
    },
    timeoutMs: REQUEST_TIMEOUT_MS
  }).then(function (response) {
    return _jsonValue(response, url);
  }).then(function (json) {
    if (!json || (json.success === false) || (json.status && Number(json.status) >= 400)) {
      throw new Error('Invalid AnimeStream API response: ' + url);
    }
    return json;
  });
}

function _payload(value) {
  var data = value;
  if (data && data.data && !data.content_id && !data.title) data = data.data;
  return data;
}

function _array(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.data)) return value.data;
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.results)) return value.results;
  return [];
}

function _localeName(locale) {
  var key = String(locale || '');
  return LOCALE_NAMES[key] || key || 'Unknown language';
}

function _locales(values, fallback) {
  var out = [], seen = Object.create(null);
  var input = Array.isArray(values) ? values : [];
  if (!input.length && Array.isArray(fallback)) input = fallback;
  for (var i = 0; i < input.length; i++) {
    var locale = _trim(input[i]);
    if (locale && /^[a-z]{2,3}-[A-Z0-9]{2,4}$/.test(locale) && !seen[locale]) {
      seen[locale] = true;
      out.push(locale);
    }
  }
  return out;
}

function _status(value) {
  var s = String(value || '').toUpperCase();
  if (s === 'FINISHED' || s === 'RELEASED' || s === 'COMPLETED') return 'completed';
  if (s === 'RELEASING' || s === 'ONGOING') return 'ongoing';
  if (s === 'CANCELLED' || s === 'CANCELED') return 'cancelled';
  return 'unknown';
}

function _entityType(value, forced) {
  if (forced === 'movie' || forced === 'series') return forced;
  var type = String(value && value.type || '').toLowerCase();
  if (type === 'movie') return 'movie';
  return 'series';
}

function _image(record, preferred) {
  var images = Array.isArray(record && record.images) ? record.images : [];
  var i;
  for (i = 0; i < preferred.length; i++) {
    for (var j = 0; j < images.length; j++) {
      if (images[j] && images[j].type === preferred[i] && images[j].url) return images[j].url;
    }
  }
  return (record && (record.image_tall || record.image || record.image_wide)) || '';
}

function _sourceUrl(kind, id) {
  return 'crunchyanime://' + kind + '/' + encodeURIComponent(id);
}

function _mapItem(record, forcedType) {
  if (!record || record.content_id == null) return null;
  var type = _entityType(record, forcedType);
  var id = _safeId(record.content_id);
  var title = _text(record.title || record.series_title || '');
  if (!id || !title) return null;
  var locales = _locales(record.audio_locales, ['ja-JP']);
  return {
    id: _sourceUrl(type, id),
    title: title,
    cover: _image(record, ['poster_tall', 'poster_wide']) || null,
    banner: _image(record, ['poster_wide', 'poster_tall']) || null,
    url: _sourceUrl(type, id),
    type: 'anime',
    sourceId: SOURCE_ID,
    contentId: id,
    contentType: type,
    audioLocales: locales,
    subtitleLocales: _locales(record.subtitle_locales, []),
    status: _status(record.status)
  };
}

function _browse(filter, page) {
  var p = Math.max(1, parseInt(page, 10) || 1);
  return _apiJson('/videos/' + encodeURIComponent(filter) + '?page=' + p +
    '&limit=' + PAGE_SIZE + '&type=all').then(function (json) {
    return _array(_payload(json)).map(function (item) { return _mapItem(item); }).filter(Boolean);
  }).catch(function () { return []; });
}

function getHome(opts) {
  return Promise.all([
    _browse('new', 1),
    _browse('popular', 1),
    _browse('movies', 1)
  ]).then(function (results) {
    return [
      { title: 'Latest on Crunchy-anime', items: results[0] },
      { title: 'Popular on Crunchy-anime', items: results[1] },
      { title: 'Anime Movies', items: results[2] }
    ].filter(function (row) { return row.items.length > 0; });
  });
}

function popular(opts) {
  return _browse('popular', opts && opts.page || 1);
}

function search(query, page, opts) {
  var q = _trim(query);
  if (!q) return Promise.resolve([]);
  var p = Math.max(1, parseInt(page, 10) || 1);
  var path = '/search?page=' + p + '&query=' + encodeURIComponent(q) +
    '&t=all&limit=' + PAGE_SIZE;
  return _apiJson(path).then(function (json) {
    var data = _payload(json) || {};
    var combined = [];
    _array(data.series).forEach(function (item) {
      var mapped = _mapItem(item, 'series');
      if (mapped) combined.push(mapped);
    });
    _array(data.movies).forEach(function (item) {
      var mapped = _mapItem(item, 'movie');
      if (mapped) combined.push(mapped);
    });
    var seen = Object.create(null);
    return combined.filter(function (item) {
      if (seen[item.id]) return false;
      seen[item.id] = true;
      return true;
    });
  }).catch(function () { return []; });
}

function _parseContentRef(input) {
  var value = '';
  if (input && typeof input === 'object') {
    value = String(input.url || input.id || input.contentId || '');
  } else {
    value = String(input || '');
  }
  var m = value.match(/^crunchyanime:\/\/(series|movie)\/([^?#/]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: decodeURIComponent(m[2]) };
  m = value.match(/\/api\/v1\/(series|movie)\/([^/?#]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: decodeURIComponent(m[2]) };
  m = value.match(/^\/?(series|movie)\/([^/?#]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: decodeURIComponent(m[2]) };
  if (/^[A-Za-z0-9_-]+$/.test(value)) return { type: 'series', id: value };
  return null;
}

function _queryValue(url, key) {
  var q = String(url || '').split('?')[1] || '';
  var hash = q.indexOf('#');
  if (hash >= 0) q = q.slice(0, hash);
  var parts = q.split('&');
  for (var i = 0; i < parts.length; i++) {
    var eq = parts[i].indexOf('=');
    var name = eq >= 0 ? parts[i].slice(0, eq) : parts[i];
    if (decodeURIComponent(name.replace(/\+/g, ' ')) === key) {
      var value = eq >= 0 ? parts[i].slice(eq + 1) : '';
      try { return decodeURIComponent(value.replace(/\+/g, ' ')); } catch (e) { return value; }
    }
  }
  return '';
}

function _episodeUrl(kind, id, locales, title, season, number) {
  var params = [];
  params.push('locales=' + encodeURIComponent(_locales(locales, ['ja-JP']).join(',')));
  if (title) params.push('title=' + encodeURIComponent(title));
  if (season != null && season !== '') params.push('season=' + encodeURIComponent(season));
  if (number != null) params.push('episode=' + encodeURIComponent(number));
  return 'crunchyanime://' + kind + '/' + encodeURIComponent(id) + '?' + params.join('&');
}

function _episodeItem(record, series, season, position, seasonPosition, isMovie) {
  var id = _safeId(record && record.content_id);
  if (!id) return null;
  var locales = _locales(record.audio_locales, series.audio_locales);
  var rawNum = Number(record.episode_number);
  var localNum = isFinite(rawNum) && rawNum > 0 ? rawNum : (seasonPosition + 1);
  var seasonDisplay = season && (season.display_number || season.season_number || season.season_seq_number);
  var itemTitle = _text(record.title || record.episode || ('Episode ' + localNum));
  var title = itemTitle;
  if (!isMovie && series.seasons && series.seasons.length > 1 && seasonDisplay != null) {
    title = 'S' + seasonDisplay + ' E' + localNum + ' - ' + itemTitle;
  } else if (!isMovie && record.episode != null && String(record.episode) && String(record.episode) !== String(localNum)) {
    title = 'E' + String(record.episode) + ' - ' + itemTitle;
  }
  var kind = isMovie ? 'movie' : 'episode';
  var url = _episodeUrl(kind, id, locales, itemTitle, seasonDisplay, localNum);
  return {
    id: url,
    title: title,
    number: position + 1,
    episodeNumber: localNum,
    url: url,
    sourceId: SOURCE_ID,
    contentId: id,
    contentType: kind,
    season: seasonDisplay == null ? null : String(seasonDisplay),
    audioLocales: locales,
    subtitleLocales: _locales(record.subtitle_locales, series.subtitle_locales || [])
  };
}

function _seasonEpisodes(season) {
  var seasonId = _safeId(season && season.content_id);
  if (!seasonId) return Promise.resolve([]);
  var count = Number(season.episode_count) || 0;
  if (count > 0) {
    var pageCount = Math.min(100, Math.max(1, Math.ceil(count / PAGE_SIZE)));
    var jobs = [];
    for (var page = 1; page <= pageCount; page++) {
      jobs.push(_apiJson('/season/' + encodeURIComponent(seasonId) +
        '/episodes?page=' + page + '&limit=' + PAGE_SIZE + '&order_by=asc')
        .then(function (json) { return _array(_payload(json)); })
        .catch(function () { return []; }));
    }
    return Promise.all(jobs).then(function (pages) {
      var out = [];
      pages.forEach(function (items) { out = out.concat(items); });
      return out;
    });
  }

  var all = [];
  function next(page) {
    if (page > 100) return Promise.resolve(all);
    return _apiJson('/season/' + encodeURIComponent(seasonId) +
      '/episodes?page=' + page + '&limit=' + PAGE_SIZE + '&order_by=asc')
      .then(function (json) {
        var batch = _array(_payload(json));
        all = all.concat(batch);
        if (batch.length < PAGE_SIZE) return all;
        return next(page + 1);
      }).catch(function () { return all; });
  }
  return next(1);
}

function _episodesForDetails(type, details) {
  var record = _payload(details) || {};
  var locales = _locales(record.audio_locales, ['ja-JP']);
  var series = {
    title: _text(record.title || ''),
    seasons: Array.isArray(record.seasons) ? record.seasons.slice() : null,
    audio_locales: locales,
    subtitle_locales: _locales(record.subtitle_locales, [])
  };
  if (type === 'movie') {
    return Promise.resolve([_episodeItem({
      content_id: record.content_id,
      title: record.title || 'Movie',
      episode_number: 1,
      audio_locales: locales,
      subtitle_locales: series.subtitle_locales
    }, series, null, 0, 0, true)].filter(Boolean));
  }
  var seasons = series.seasons || [];
  if (!seasons.length && Array.isArray(record.episodes)) {
    return Promise.resolve(record.episodes.map(function (ep, i) {
      return _episodeItem(ep, series, null, i, i, false);
    }).filter(Boolean));
  }
  seasons.sort(function (a, b) {
    var aa = Number(a.season_seq_number != null ? a.season_seq_number : a.season_number) || 0;
    var bb = Number(b.season_seq_number != null ? b.season_seq_number : b.season_number) || 0;
    return aa - bb;
  });
  var jobs = seasons.map(function (season) {
    return _seasonEpisodes(season).then(function (items) {
      return { season: season, items: items };
    });
  });
  return Promise.all(jobs).then(function (groups) {
    var all = [];
    groups.forEach(function (group) {
      group.items.forEach(function (item) { all.push({ item: item, season: group.season }); });
    });
    all.sort(function (a, b) {
      var sa = Number(a.season.season_seq_number != null ? a.season.season_seq_number : a.season.season_number) || 0;
      var sb = Number(b.season.season_seq_number != null ? b.season.season_seq_number : b.season.season_number) || 0;
      if (sa !== sb) return sa - sb;
      var ea = Number(a.item.episode_number) || 0;
      var eb = Number(b.item.episode_number) || 0;
      return ea - eb;
    });
    return all.map(function (entry, index) {
      return _episodeItem(entry.item, series, entry.season, index,
        indexOfSeasonEpisode(groups, entry.season, entry.item), false);
    }).filter(Boolean);
  });
}

function indexOfSeasonEpisode(groups, season, item) {
  for (var i = 0; i < groups.length; i++) {
    if (groups[i].season !== season) continue;
    for (var j = 0; j < groups[i].items.length; j++) {
      if (groups[i].items[j].content_id === item.content_id) return j;
    }
  }
  return 0;
}

function getDetail(url, opts) {
  var ref = _parseContentRef(url);
  if (!ref) return Promise.resolve(null);
  var cacheKey = ref.type + ':' + ref.id;
  var cached = DETAIL_CACHE[cacheKey];
  if (cached && Date.now() - cached.at < DETAIL_CACHE_TTL_MS) {
    return Promise.resolve(cached.detail);
  }
  return _apiJson('/' + ref.type + '/' + encodeURIComponent(ref.id)).then(function (json) {
    var data = _payload(json);
    if (!data || !data.content_id) return null;
    return _episodesForDetails(ref.type, data).then(function (episodes) {
      var images = Array.isArray(data.images) ? data.images : [];
      var result = {
        id: _sourceUrl(ref.type, ref.id),
        title: _text(data.title || ''),
        cover: _image(data, ['poster_tall', 'poster_wide']) || null,
        banner: _image(data, ['poster_wide', 'poster_tall']) || null,
        url: _sourceUrl(ref.type, ref.id),
        description: _text(data.description || ''),
        status: _status(data.status),
        genres: (Array.isArray(data.genre) ? data.genre : []).map(function (g) {
          return _text(typeof g === 'string' ? g : (g && (g.title || g.name) || ''));
        }).filter(Boolean),
        studios: data.studio ? [_text(data.studio)] : [],
        type: 'anime',
        sourceId: SOURCE_ID,
        contentId: ref.id,
        contentType: ref.type,
        audioLocales: _locales(data.audio_locales, ['ja-JP']),
        subtitleLocales: _locales(data.subtitle_locales, []),
        episodes: episodes,
        subCount: episodes.length,
        dubCount: data.audio_locales && data.audio_locales.some(function (locale) {
          return locale !== 'ja-JP';
        }) ? episodes.length : 0,
        year: data.year || null
      };
      if (result.title) DETAIL_CACHE[cacheKey] = { at: Date.now(), detail: result };
      return result;
    });
  }).catch(function () { return null; });
}

function getEpisodes(url, opts) {
  var episode = _parseMediaRef(url);
  if (episode) return Promise.resolve([]);
  return getDetail(url, opts).then(function (detail) {
    return detail && Array.isArray(detail.episodes) ? detail.episodes : [];
  });
}

function _parseMediaRef(rawUrl) {
  var value = String(rawUrl || '');
  var m = value.match(/^crunchyanime:\/\/(episode|movie)\/([^?#]+)/i);
  if (m) {
    var pathKind = m[1].toLowerCase();
    var id;
    try { id = decodeURIComponent(m[2]); } catch (e) { id = m[2]; }
    var localeValue = _queryValue(value, 'locales');
    var locales = _locales(localeValue ? localeValue.split(',') : [], ['ja-JP']);
    return { type: pathKind === 'movie' ? 'movie' : 'episode', id: id, locales: locales };
  }
  m = value.match(/\/api\/v1\/(episode|movie)\/([^/?#]+)\/media\/(?:hls|dash)\/([^/?#]+)/i);
  if (m) {
    var directId;
    try { directId = decodeURIComponent(m[2]); } catch (e) { directId = m[2]; }
    var locale;
    try { locale = decodeURIComponent(m[3]); } catch (e) { locale = m[3]; }
    return { type: m[1].toLowerCase(), id: directId, locales: _locales([locale], ['ja-JP']) };
  }
  return null;
}

function _subtitleTracks(list) {
  if (!Array.isArray(list)) return [];
  var out = [], seen = Object.create(null);
  list.forEach(function (track) {
    if (!track || typeof track !== 'object') return;
    var rawUrl = track.url || track.file || track.link || track.playlist;
    var url = _absolute(rawUrl, SITE);
    if (!/^https?:\/\//i.test(url)) return;
    var locale = track.locale || track.language || track.lang || track.label || '';
    var key = url + '|' + locale;
    if (seen[key]) return;
    seen[key] = true;
    out.push({
      url: url,
      language: _localeName(locale),
      name: _localeName(locale),
      kind: 'captions',
      headers: { Referer: SITE + '/' }
    });
  });
  return out;
}

function _quality(variant, url) {
  var text = [variant && variant.quality, variant && variant.resolution,
    variant && variant.height, variant && variant.name, url].join(' ');
  var m = text.match(/(2160|1440|1080|720|480|360)\s*p?/i);
  return m ? m[1] + 'p' : 'Auto';
}

function _addStream(out, seen, variant, fallbackLocale, transport, hardSubLocale, parent) {
  if (!variant || typeof variant !== 'object') return;
  var playlist = _absolute(variant.playlist || variant.url || variant.file, SITE);
  if (!/^https?:\/\//i.test(playlist)) return;
  var locale = variant.locale || fallbackLocale || 'ja-JP';
  var hardSub = hardSubLocale ? _localeName(hardSubLocale) : '';
  var language = _localeName(locale);
  var actualTransport = /\.mpd(?:[?#]|$)/i.test(playlist) ? 'dash' :
    (/\.m3u8(?:[?#]|$)/i.test(playlist) ? 'hls' : (transport || 'hls'));
  var kind = hardSubLocale ? 'sub' : (locale === 'ja-JP' ? 'sub' : 'dub');
  var label = language + (kind === 'dub' ? ' Dub' : ' Audio');
  if (hardSub) label += ' · ' + hardSub + ' Hard Subs';
  if (parent && parent !== 'Alternate') label = parent + ' · ' + label;
  label += ' · ' + (actualTransport === 'dash' ? 'DASH' : 'HLS');
  var subtitles = _subtitleTracks(variant.subtitles || (parent && parent.subtitles) || []);
  var quality = _quality(variant, playlist);
  var headers = { Referer: SITE + '/' };
  var uniqueKey = playlist + '|' + (hardSubLocale || '') + '|' + actualTransport;
  if (seen[uniqueKey]) return;
  seen[uniqueKey] = true;
  out.push({
    url: playlist,
    quality: quality,
    label: 'Crunchy-anime · ' + label,
    container: actualTransport,
    kind: kind,
    language: language,
    headers: headers,
    subtitles: subtitles
  });
}

function _streamsFromMedia(raw, requestedLocale) {
  var data = _payload(raw) || {};
  var out = [], seen = Object.create(null);
  var base = data.hls || null;
  var dash = data.dash || null;
  if (base) {
    _addStream(out, seen, base, requestedLocale, 'hls', '', '');
    var hard = Array.isArray(base.hard_subs) ? base.hard_subs : [];
    hard.forEach(function (sub) {
      _addStream(out, seen, sub, base.locale || requestedLocale, 'hls',
        sub && (sub.locale || sub.language), 'Hard Subs');
    });
  }
  if (dash) _addStream(out, seen, dash, requestedLocale, 'dash', '', '');

  var versions = data.versions || {};
  ['hls', 'dash'].forEach(function (transport) {
    var list = Array.isArray(versions[transport]) ? versions[transport] : [];
    list.forEach(function (version) {
      _addStream(out, seen, version, requestedLocale, transport, '', 'Alternate');
      var hardSubs = Array.isArray(version.hard_subs) ? version.hard_subs :
        (Array.isArray(version.hardSubs) ? version.hardSubs : []);
      hardSubs.forEach(function (sub) {
        _addStream(out, seen, sub, version.locale || requestedLocale, transport,
          sub && (sub.locale || sub.language), _localeName(version.locale || requestedLocale) + ' Dub');
      });
    });
  });
  return out;
}

function _fetchMedia(kind, id, locale) {
  var path = '/' + kind + '/' + encodeURIComponent(id) + '/media/hls/' + encodeURIComponent(locale);
  return _apiJson(path).then(function (media) {
    var streams = _streamsFromMedia(media, locale);
    if (streams.length) return streams;
    var dashPath = '/' + kind + '/' + encodeURIComponent(id) +
      '/media/dash/' + encodeURIComponent(locale);
    return _apiJson(dashPath).then(function (fallback) {
      return _streamsFromMedia(fallback, locale);
    }).catch(function () { return []; });
  }).catch(function () {
    var dashPath = '/' + kind + '/' + encodeURIComponent(id) +
      '/media/dash/' + encodeURIComponent(locale);
    return _apiJson(dashPath).then(function (fallback) {
      return _streamsFromMedia(fallback, locale);
    }).catch(function () { return []; });
  });
}

function getVideoSources(episodeUrl, opts) {
  var ref = _parseMediaRef(episodeUrl);
  if (!ref) return Promise.resolve([]);
  var kind = ref.type === 'movie' ? 'movie' : 'episode';
  var locales = _locales(ref.locales, ['ja-JP']);
  var jobs = locales.map(function (locale) {
    return _fetchMedia(kind, ref.id, locale);
  });
  return Promise.all(jobs).then(function (lists) {
    var out = [], seen = Object.create(null);
    lists.forEach(function (list) {
      list.forEach(function (stream) {
        var key = stream.url + '|' + stream.container;
        if (!seen[key]) {
          seen[key] = true;
          out.push(stream);
        }
      });
    });
    return out;
  }).catch(function () { return []; });
}

function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }

function _clearCache() { DETAIL_CACHE = Object.create(null); }

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
    getLinks: getLinks,
    _mapItem: _mapItem,
    _parseContentRef: _parseContentRef,
    _parseMediaRef: _parseMediaRef,
    _streamsFromMedia: _streamsFromMedia,
    _clearCache: _clearCache
  };
}
