// UniqueStream — anime source for the Zangetsu provider repo (anime.uniquestream.net).
//
// FastAPI JSON backend; no HTML scraping:
//   GET /api/v1/search?query=...&limit=20         -> { series: [{content_id, title, subbed, dubbed}] }
//   GET /api/v1/series/{id}                       -> { seasons: [{content_id, title, season_number, episode_count, mal_id}] }
//   GET /api/v1/season/{id}/episodes?limit=&page= -> [ {content_id, episode_number, audio_locales, is_clip} ]
//   GET /api/v1/episode/{id}/media/hls/{locale}   -> { media_id, hls: {playlist, hard_subs, subtitles} }
//
// Sub: ja-JP locale, Dub: en-US locale. HLS uses AES-128; the plaintext key is the media_id as hex
// bytes (the site serves key.bin base64-wrapped). The provider exposes the media id through the
// stream's `playlistKey` marker so the existing runtime can synthesize the key.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'uniquestream';

var BASE = 'https://anime.uniquestream.net/api/v1';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
var SUB_LOCALE = 'ja-JP';
var DUB_LOCALE = 'en-US';
var PAGE_SIZE = 20;
var MAX_EPISODE_PAGES = 40;
var CACHE_TTL_MS = 30 * 60 * 1000;

var _seriesCache = {};

function getInfo() {
  return { name: 'UniqueStream', lang: 'en', baseUrl: 'https://anime.uniquestream.net',
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=uniquestream.net', type: 'anime', version: '1.0.0' };
}
function getSettings() { return []; }

// ── Networking ─────────────────────────────────────────────────────────────
function _raceTimeout(promise, ms, fallback) {
  var hasTimers = typeof setTimeout === 'function' && typeof clearTimeout === 'function';
  if (!hasTimers) return promise;
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = setTimeout(function () { settled = true; resolve(fallback); }, ms);
    promise.then(function (value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, function (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function _fetchJson(url) {
  var h = { 'User-Agent': UA, 'Accept': 'application/json, */*' };
  return _raceTimeout(fetch(url, { headers: h }).then(function (r) {
    if (!r) throw new Error('UniqueStream: empty response');
    if (!r.ok) throw new Error('UniqueStream: HTTP ' + r.status + ' for ' + url);
    return r.text();
  }), 15000, null).then(function (body) {
    if (body == null) throw new Error('UniqueStream: timeout for ' + url);
    try { return JSON.parse(body); }
    catch (e) { throw new Error('UniqueStream: invalid JSON from ' + url); }
  });
}

// ── Parsers ────────────────────────────────────────────────────────────────
function _parseSearchCandidates(json) {
  var series = (json && json.series) || [];
  return series.map(function (item) {
    if (!item || !item.content_id) return null;
    return {
      contentId: String(item.content_id),
      title: String(item.title || '').trim(),
      subbed: item.subbed === true,
      dubbed: item.dubbed === true
    };
  }).filter(function (c) { return c && c.contentId && c.title; });
}

function _parseSeasons(json) {
  var seasons = (json && json.seasons) || [];
  return seasons.map(function (item) {
    if (!item || !item.content_id) return null;
    return {
      contentId: String(item.content_id),
      title: String(item.title || '').trim(),
      seasonNumber: typeof item.season_number === 'number' ? item.season_number : null,
      episodeCount: typeof item.episode_count === 'number' ? item.episode_count : null,
      malId: item.mal_id != null ? String(item.mal_id) : null
    };
  }).filter(Boolean);
}

function _parseEpisodes(json) {
  var arr = Array.isArray(json) ? json : [];
  return arr.map(function (item) {
    if (!item || item.is_clip === true) return null;
    var raw = item.episode_number;
    if (typeof raw !== 'number' || raw % 1 !== 0 || raw < 1) return null;
    if (!item.content_id) return null;
    return {
      number: raw,
      contentId: String(item.content_id),
      audioLocales: Array.isArray(item.audio_locales) ? item.audio_locales.slice() : []
    };
  }).filter(Boolean);
}

function _parseMedia(json) {
  var obj = json || {};
  var hls = obj.hls || {};
  var mediaId = obj.media_id != null ? String(obj.media_id) : null;
  var playlist = hls.playlist || null;
  var hardSubEn = null;
  (hls.hard_subs || []).forEach(function (hs) {
    if (hs && hs.locale === 'en-US' && hs.playlist) hardSubEn = hs.playlist;
  });
  var subtitles = (hls.subtitles || []).map(function (item) {
    if (!item || !item.url) return null;
    var label = item.language || 'Subtitle';
    return {
      url: item.url,
      label: label,
      lang: String(label).split('-')[0].toLowerCase() || 'und',
      format: /\.srt(?:[?#]|$)/i.test(item.url) ? 'srt' : 'vtt',
      mimeType: item.mimeType || null
    };
  }).filter(Boolean);
  return { mediaId: mediaId, playlist: playlist, hardSubEn: hardSubEn, subtitles: subtitles };
}

// ── Catalog resolution ─────────────────────────────────────────────────────
function _titleScore(a, b) {
  a = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  b = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 0.82;
  var matches = 0;
  for (var i = 0; i < Math.min(a.length, b.length); i++) if (a.charAt(i) === b.charAt(i)) matches++;
  return matches / Math.max(a.length, b.length);
}

function _selectSeasons(seasons, title) {
  if (!seasons.length) return [];
  if (seasons.length === 1) return seasons;
  var best = null, bestScore = 0;
  seasons.forEach(function (s) {
    var score = _titleScore(title, s.title);
    if (score > bestScore) { bestScore = score; best = s; }
  });
  // A single matching season wins; otherwise this is one entry split into sagas, so keep them all
  // in API order (their episode numbers are absolute).
  if (best && bestScore >= 0.5) return [best];
  return seasons;
}

function _fetchEpisodesForSeason(season, budget, out) {
  var pagesUsed = 0;
  var fetched = 0;
  var expected = season.episodeCount;

  function page(n) {
    if (pagesUsed >= budget) return Promise.resolve();
    pagesUsed++;
    return _fetchJson(BASE + '/season/' + encodeURIComponent(season.contentId) +
      '/episodes?limit=' + PAGE_SIZE + '&page=' + n).then(function (json) {
      var parsed = _parseEpisodes(json);
      parsed.forEach(function (ep) { out.push(ep); });
      fetched += Array.isArray(json) ? json.length : 0;
      if (parsed.length < PAGE_SIZE || (expected && fetched >= expected)) return;
      return page(n + 1);
    });
  }
  return page(1).then(function () { return pagesUsed; });
}

function _resolveSeries(seriesId, titleHint) {
  var key = String(seriesId || '');
  if (!key) return Promise.reject(new Error('UniqueStream: missing series id'));
  var cached = _seriesCache[key];
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return Promise.resolve(cached.catalog);

  return _fetchJson(BASE + '/series/' + encodeURIComponent(key)).then(function (json) {
    var seasons = _parseSeasons(json);
    if (!seasons.length) throw new Error('UniqueStream: series ' + key + ' has no seasons');
    var selected = _selectSeasons(seasons, titleHint || '');
    var episodes = [];
    var budget = MAX_EPISODE_PAGES;
    return selected.reduce(function (promise, season) {
      return promise.then(function () {
        if (budget <= 0) return;
        return _fetchEpisodesForSeason(season, budget, episodes).then(function (used) {
          budget -= used;
        });
      });
    }, Promise.resolve()).then(function () {
      // Distinct by number, earliest wins; sort ascending.
      var seen = {}, unique = [];
      episodes.forEach(function (ep) {
        if (seen[ep.number]) return;
        seen[ep.number] = true;
        unique.push(ep);
      });
      unique.sort(function (a, b) { return a.number - b.number; });
      var catalog = { seasons: selected, title: titleHint || (selected[0] && selected[0].title) || key, episodes: unique };
      if (unique.length) _seriesCache[key] = { at: Date.now(), catalog: catalog };
      return catalog;
    });
  });
}

// ── URLs ───────────────────────────────────────────────────────────────────
function _seriesUrl(contentId, title) {
  return 'uniquestream://' + encodeURIComponent(contentId) + '?t=' + encodeURIComponent(title || '');
}
function _parseSeriesUrl(url) {
  var raw = String(url || '');
  if (raw.indexOf('uniquestream://') === 0) raw = raw.slice('uniquestream://'.length);
  var q = raw.indexOf('?');
  var path = q >= 0 ? raw.slice(0, q) : raw;
  var title = '';
  if (q >= 0) {
    var m = raw.slice(q + 1).match(/(?:^|&)t=([^&]*)/);
    if (m) { try { title = decodeURIComponent(m[1]); } catch (e) {} }
  }
  var contentId = '';
  try { contentId = decodeURIComponent(path); } catch (e) { contentId = path; }
  return { contentId: contentId, title: title };
}
function _episodeUrl(contentId, number, category) {
  return 'uniquestream://' + encodeURIComponent(contentId) + '/' + number + '/' + category;
}
function _parseEpisodeUrl(url) {
  var raw = String(url || '');
  if (raw.indexOf('uniquestream://') === 0) raw = raw.slice('uniquestream://'.length);
  var parts = raw.split('/');
  if (parts.length < 3) return null;
  var contentId;
  try { contentId = decodeURIComponent(parts[0]); } catch (e) { contentId = parts[0]; }
  var number = parseInt(parts[1], 10);
  var category = parts[2] === 'dub' ? 'dub' : 'sub';
  if (!(number >= 1)) return null;
  return { contentId: contentId, number: number, category: category };
}

function _categoryFor(ep) {
  // If the episode only has one locale, expose it honestly.
  var hasDub = ep.audioLocales.indexOf(DUB_LOCALE) !== -1;
  var hasSub = ep.audioLocales.indexOf(SUB_LOCALE) !== -1;
  if (hasDub && !hasSub) return 'dub';
  return 'sub';
}

function _episodeObject(seriesId, ep) {
  var cat = _categoryFor(ep);
  // The playback endpoint is keyed on the episode's own content id, not the series'.
  var contentId = ep.contentId || seriesId;
  return {
    id: _episodeUrl(contentId, ep.number, cat),
    number: ep.number,
    title: 'Episode ' + ep.number,
    url: _episodeUrl(contentId, ep.number, cat),
    category: cat,
    type: 'anime',
    sourceId: SOURCE_ID
  };
}

// ── Public API ─────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q || (page && page > 1)) return Promise.resolve([]);
  return _fetchJson(BASE + '/search?query=' + encodeURIComponent(q) + '&limit=20')
    .then(function (json) {
      var out = [], seen = {};
      _parseSearchCandidates(json).forEach(function (c) {
        if (seen[c.contentId]) return;
        seen[c.contentId] = true;
        out.push({
          id: c.contentId,
          title: c.title,
          url: _seriesUrl(c.contentId, c.title),
          cover: null,
          type: 'anime',
          sourceId: SOURCE_ID,
          subBadge: c.subbed ? 1 : 0,
          dubBadge: c.dubbed ? 1 : 0
        });
      });
      return out;
    })
    .catch(function () { return []; });
}

function getHome(opts) {
  // No documented public home/catalogue route; search is the catalogue.
  return Promise.resolve([]);
}

function getDetail(url, opts) {
  var parsed = _parseSeriesUrl(url);
  return _resolveSeries(parsed.contentId, parsed.title).then(function (catalog) {
    var episodes = catalog.episodes.map(function (ep) {
      return _episodeObject(parsed.contentId, ep);
    });
    var subCount = 0, dubCount = 0;
    catalog.episodes.forEach(function (ep) {
      if (ep.audioLocales.indexOf(SUB_LOCALE) !== -1) subCount++;
      if (ep.audioLocales.indexOf(DUB_LOCALE) !== -1) dubCount++;
    });
    return {
      id: parsed.contentId,
      title: catalog.title,
      url: url,
      cover: null,
      description: '',
      status: 'unknown',
      genres: [],
      type: 'anime',
      sourceId: SOURCE_ID,
      episodes: episodes,
      year: null,
      subCount: subCount,
      dubCount: dubCount
    };
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d.episodes; });
}

function _choosePlayback(media, category) {
  if (category === 'dub') {
    var dubUrl = media.playlist || media.hardSubEn;
    return dubUrl ? { url: dubUrl, subtitles: media.subtitles, burntIn: !media.playlist } : null;
  }
  if (media.playlist && media.subtitles.length) return { url: media.playlist, subtitles: media.subtitles, burntIn: false };
  if (media.hardSubEn) return { url: media.hardSubEn, subtitles: [], burntIn: true };
  if (media.playlist) return { url: media.playlist, subtitles: media.subtitles, burntIn: false };
  return null;
}

function getVideoSources(episodeUrl, opts) {
  var parsed = _parseEpisodeUrl(episodeUrl);
  if (!parsed) return Promise.reject(new Error('UniqueStream: invalid episode URL'));
  var locale = parsed.category === 'dub' ? DUB_LOCALE : SUB_LOCALE;

  return _fetchJson(BASE + '/episode/' + encodeURIComponent(parsed.contentId) +
    '/media/hls/' + encodeURIComponent(locale))
    .catch(function (err) {
      // Fall back to the other locale if the requested one is not encoded yet.
      var other = parsed.category === 'dub' ? SUB_LOCALE : DUB_LOCALE;
      return _fetchJson(BASE + '/episode/' + encodeURIComponent(parsed.contentId) +
        '/media/hls/' + encodeURIComponent(other)).catch(function () { throw err; });
    })
    .then(function (json) {
      var media = _parseMedia(json);
      var playback = _choosePlayback(media, parsed.category);
      if (!playback) throw new Error('UniqueStream episode ' + parsed.number + ' has no playable HLS stream');

      // The AES-128 key is the media id as hex bytes; expose it through the marker the runtime reads.
      var playlistKey = media.mediaId ? 'uniquestream:' + media.mediaId : null;

      return [{
        url: playback.url,
        quality: 'Auto',
        label: 'UniqueStream · ' + (parsed.category === 'dub' ? 'Dub' : 'Sub') +
          (playback.burntIn ? ' (Hard-subbed)' : ''),
        container: 'hls',
        headers: { 'User-Agent': UA },
        kind: parsed.category,
        audioLang: parsed.category === 'dub' ? 'en' : 'ja',
        subtitles: playback.subtitles,
        playlistKey: playlistKey
      }];
    });
}

function getStreams(id, opts) { return getVideoSources(id, opts); }
function popular(opts) {
  return getHome(opts).then(function (rows) {
    var out = [];
    (rows || []).forEach(function (r) { (r.items || []).forEach(function (i) { out.push(i); }); });
    return out;
  });
}

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
    getStreams: getStreams
  };
}