// AnimeParadise native provider for Zangetsu.
// Uses AnimeParadise's own REST API; episode stream tokens are short-lived.
// Keep VERSION in sync with index.json whenever this source changes.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animeparadise';
var VERSION = '1.0.1';
var API = 'https://api.animeparadise.moe';
var STREAM = 'https://stream.animeparadise.moe';
var SITE = 'https://animeparadise.moe';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
var EPISODE_CACHE = Object.create(null);
var EPISODE_CACHE_TTL = 30000;

function getInfo() {
  return { name: 'AnimeParadise', lang: 'en', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=animeparadise.moe', type: 'anime', version: VERSION };
}
function getSettings() { return []; }

function _request(url, referer) {
  return fetch(url, {
    timeoutMs: 12000,
    headers: {
      'User-Agent': UA,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': referer || SITE + '/'
    }
  }).then(function (r) {
    var status = Number(r && r.status || 200);
    if (status >= 400) throw new Error('AnimeParadise HTTP ' + status);
    if (r && typeof r.body === 'string') return r.body;
    if (r && typeof r.text === 'function') return r.text();
    if (r && r.body && typeof r.body.text === 'function') return r.body.text();
    throw new Error('AnimeParadise: empty HTTP response');
  });
}
function _json(url, referer) {
  return _request(url, referer).then(function (body) {
    try { return JSON.parse(body); }
    catch (e) { throw new Error('AnimeParadise: invalid JSON response'); }
  });
}
function _decode(s) {
  try { return decodeURIComponent(String(s || '')); } catch (e) { return String(s || ''); }
}
function _queryValue(query, key) {
  var m = String(query || '').match(new RegExp('(?:^|&)' + key + '=([^&]*)'));
  return m ? _decode(m[1].replace(/\+/g, '%20')) : '';
}
function _mediaRef(item) {
  var id = String(item && item._id != null ? item._id : '');
  var query = 'title=' + encodeURIComponent(String(item && (item.alternativeTitle && item.alternativeTitle.english || item.title) || ''));
  var poster = item && item.posterImage && (item.posterImage.medium || item.posterImage.large) || '';
  if (poster) query += '&cover=' + encodeURIComponent(String(poster));
  var year = item && (typeof item.year === 'number' ? item.year : item.released ? new Date(item.released).getUTCFullYear() : '');
  if (year) query += '&year=' + encodeURIComponent(String(year));
  return 'animeparadise://media/' + encodeURIComponent(id) + '?' + query;
}
function _parseMedia(value) {
  var s = String(value || '');
  var m = s.match(/^animeparadise:\/\/media\/([^/?#]+)/i);
  if (m) {
    var query = s.indexOf('?') >= 0 ? s.slice(s.indexOf('?') + 1).split('#')[0] : '';
    return { id: _decode(m[1]), title: _queryValue(query, 'title'), cover: _queryValue(query, 'cover') || null, year: _queryValue(query, 'year') || null };
  }
  return { id: s.replace(/^https?:\/\/[^/]+\//i, '').replace(/^\/+|\/+$/g, ''), title: '', cover: null, year: null };
}
function _card(item) {
  if (!item || item._id == null) return null;
  var id = String(item._id);
  var title = String(item.alternativeTitle && item.alternativeTitle.english || item.title || '').trim();
  if (!title) return null;
  var poster = item.posterImage && (item.posterImage.medium || item.posterImage.large) || null;
  var year = typeof item.year === 'number' ? item.year : item.released ? new Date(item.released).getUTCFullYear() : null;
  return { id: id, title: title, url: _mediaRef(item), cover: poster, type: 'anime', sourceId: SOURCE_ID, year: Number(year) > 0 ? Number(year) : null };
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _json(API + '/search?q=' + encodeURIComponent(q) + '&limit=20', SITE + '/').then(function (json) {
    var rows = json && Array.isArray(json.data) ? json.data : [];
    var seen = Object.create(null);
    return rows.map(_card).filter(function (item) {
      if (!item || seen[item.id]) return false;
      seen[item.id] = true;
      return true;
    });
  });
}
function _readEpisodes(animeId) {
  var id = String(animeId || '');
  if (!id) return Promise.reject(new Error('AnimeParadise: missing anime ID'));
  var cached = EPISODE_CACHE[id];
  if (cached && Date.now() - cached.at < EPISODE_CACHE_TTL) return Promise.resolve(cached.rows.slice());
  return _json(API + '/anime/' + encodeURIComponent(id) + '/episode', SITE + '/').then(function (json) {
    var rows = json && Array.isArray(json.data) ? json.data : [];
    var seen = Object.create(null);
    var episodes = rows.map(function (ep, index) {
      if (!ep || ep.uid == null) return null;
      var uid = String(ep.uid);
      if (seen[uid]) return null;
      seen[uid] = true;
      var rawNo = ep.number == null ? index + 1 : ep.number;
      var number = Number.parseFloat(rawNo);
      if (!isFinite(number)) number = index + 1;
      var title = String(ep.title || ('Episode ' + rawNo)).trim();
      return {
        id: 'animeparadise://episode/' + encodeURIComponent(uid) + '?origin=' + encodeURIComponent(id),
        title: title,
        number: number,
        url: 'animeparadise://episode/' + encodeURIComponent(uid) + '?origin=' + encodeURIComponent(id),
        type: 'anime',
        category: 'sub',
        sourceId: SOURCE_ID
      };
    }).filter(Boolean).sort(function (a, b) { return a.number - b.number; });
    EPISODE_CACHE[id] = { at: Date.now(), rows: episodes.slice() };
    return episodes;
  });
}
function getDetail(url, opts) {
  var media = _parseMedia(url);
  if (!media.id) return Promise.reject(new Error('AnimeParadise: invalid anime URL'));
  return _readEpisodes(media.id).then(function (episodes) {
    return { id: media.id, title: media.title || ('AnimeParadise ' + media.id), url: url, cover: media.cover, year: media.year, type: 'anime', sourceId: SOURCE_ID, description: '', genres: [], episodes: episodes, subCount: episodes.length, dubCount: 0 };
  });
}
function getEpisodes(url, opts) {
  var media = _parseMedia(url);
  return _readEpisodes(media.id);
}
function _subtitleTracks(subData) {
  if (typeof subData === 'string') {
    try { subData = JSON.parse(subData); } catch (e) { subData = [subData]; }
  }
  if (!Array.isArray(subData)) {
    if (subData && typeof subData === 'object') {
      subData = Object.keys(subData).map(function (key) {
        var value = subData[key];
        if (typeof value === 'string') return { url: value, label: key };
        if (value && typeof value === 'object') {
          var copy = {};
          Object.keys(value).forEach(function (k) { copy[k] = value[k]; });
          if (!copy.label && !copy.lang && !copy.language) copy.label = key;
          return copy;
        }
        return null;
      }).filter(Boolean);
    } else if (subData) subData = [subData];
    else subData = [];
  }
  var seen = Object.create(null);
  return subData.map(function (track) {
    if (typeof track === 'string') track = { url: track, label: 'Subtitle' };
    if (!track || typeof track !== 'object') return null;
    var url = String(track.url || track.src || track.file || track.link || track.vtt || track.subtitle || '');
    if (url.indexOf('//') === 0) url = 'https:' + url;
    if (!/^https?:\/\//i.test(url) || seen[url]) return null;
    seen[url] = true;
    var label = String(track.label || track.language || track.lang || track.name || 'Subtitle');
    var lang = String(track.lang || track.language || (/english/i.test(label) ? 'en' : /japanese/i.test(label) ? 'ja' : ''));
    return { url: url, label: label, lang: lang, format: /\.srt(?:[?#]|$)/i.test(url) ? 'srt' : 'vtt', default: !!track.default };
  }).filter(Boolean);
}
function _parseEpisode(value) {
  var s = String(value || '');
  var m = s.match(/^animeparadise:\/\/episode\/([^/?#]+)/i);
  if (!m) return null;
  var query = s.indexOf('?') >= 0 ? s.slice(s.indexOf('?') + 1).split('#')[0] : '';
  return { uid: _decode(m[1]), animeId: _queryValue(query, 'origin') };
}
function getVideoSources(episodeUrl, opts) {
  var ep = _parseEpisode(episodeUrl);
  if (!ep || !ep.uid || !ep.animeId) return Promise.reject(new Error('AnimeParadise: invalid episode URL'));
  var detailUrl = API + '/ep/' + encodeURIComponent(ep.uid) + '?origin=' + encodeURIComponent(ep.animeId);
  return _json(detailUrl, SITE + '/').then(function (json) {
    var episode = json && json.data && json.data.episode;
    if (!episode || !episode.streamLink) throw new Error('AnimeParadise: no streamLink in response');
    var streamUrl = STREAM + '/m3u8?url=' + encodeURIComponent(String(episode.streamLink));
    var subtitles = _subtitleTracks(episode.subData);
    return [{
      url: streamUrl, quality: 'Auto', label: 'AnimeParadise [Auto]', container: 'hls', hls: true,
      kind: 'sub', audioLang: 'ja',
      headers: { 'User-Agent': UA, 'Referer': SITE + '/', 'Origin': SITE },
      subtitles: subtitles
    }];
  });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getHome() { return Promise.resolve([]); }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams };
}