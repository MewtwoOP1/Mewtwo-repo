// XFDM (Lili) — AniList metadata, Bangumi-confirmed catalogue matching, direct MP4 playback.
// XFDM burns Chinese subtitles into the video and does not publish a dub or separate subtitle tracks.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'xfdm';
var SITE = 'https://dm1.xfdm.pro';
var BANGUMI = 'https://api.bgm.tv';
var ANILIST = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
var MEDIA_CACHE = {};
var CATALOG_CACHE = {};
var MISS_CACHE = {};
var MIRURO_FALLBACK_HOSTS = ['https://api.hiyori.tv', 'https://miruro.zenos.my.id', 'https://www.neoanime.tv'];
var MIRURO_PROVIDER_ORDER = ['kiwi', 'animepahe', 'arc', 'zoro', 'jet', 'bee', 'bonk', 'hop', 'pewe', 'ally', 'nun', 'bun', 'twin', 'cog', 'moo', 'sun', 'knob', 'telli'];

function getInfo() {
  return { name: 'Lili (XFDM)', lang: 'zh', baseUrl: SITE, logo: 'https://www.google.com/s2/favicons?sz=256&domain=xfdm.pro', type: 'anime', version: '1.0.2' };
}
function getSettings() {
  return [
    { key: 'requestTimeoutMs', label: 'Request timeout', description: 'Maximum wait for each Bangumi or XFDM request.', type: 'enum', default: '10000', options: [{ value: '6000', label: '6 seconds' }, { value: '10000', label: '10 seconds' }, { value: '15000', label: '15 seconds' }] },
    { key: 'maxTitleCandidates', label: 'Bangumi title candidates', description: 'Maximum number of AniList title aliases searched against Bangumi. Matching is exact after punctuation/spacing normalization; the provider does not fuzzy-match different seasons.', type: 'enum', default: '8', options: [{ value: '3', label: '3 aliases' }, { value: '5', label: '5 aliases' }, { value: '8', label: '8 aliases' }] },
    { key: 'maxMirrorChannels', label: 'Playback mirror attempts', description: 'Maximum XFDM channels resolved for one episode. Channels are mirrors of the same encode, not different quality levels.', type: 'enum', default: '2', options: [{ value: '1', label: '1 channel' }, { value: '2', label: '2 channels' }, { value: '3', label: '3 channels' }] },
    { key: 'homeSections', label: 'Home sections', description: 'Comma-separated AniList sections: trending, popular, top.', type: 'text', default: 'trending,popular' },
    { key: 'cacheSeconds', label: 'Catalogue cache', description: 'Cache successful title and episode lookups briefly. Negative lookups are cached for a shorter period.', type: 'enum', default: '120', options: [{ value: '0', label: 'Disabled' }, { value: '60', label: '1 minute' }, { value: '120', label: '2 minutes' }, { value: '300', label: '5 minutes' }] },
    { key: 'showAdult', label: 'Show adult catalogue entries', description: 'Include adult entries returned by AniList. Disabled by default.', type: 'bool', default: false }
  ];
}

function _setting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.xfdm || {};
    return cfg[key] == null ? null : cfg[key];
  } catch (e) { return null; }
}
function _bool(value, fallback) {
  if (value == null) return fallback;
  if (value === true || String(value).toLowerCase() === 'true') return true;
  if (value === false || String(value).toLowerCase() === 'false') return false;
  return fallback;
}
function _int(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function _splitList(value) {
  return String(value == null ? '' : value).split(/[,\n;]+/).map(function (x) { return x.trim(); }).filter(Boolean);
}
function _config() {
  return {
    timeoutMs: _int(_setting('requestTimeoutMs'), 10000, 3000, 30000),
    maxNames: _int(_setting('maxTitleCandidates'), 8, 1, 12),
    maxChannels: _int(_setting('maxMirrorChannels'), 2, 1, 3),
    cacheMs: _int(_setting('cacheSeconds'), 120, 0, 300) * 1000,
    showAdult: _bool(_setting('showAdult'), false),
    sections: _splitList(_setting('homeSections') || 'trending,popular').map(function (x) { return x.toLowerCase(); })
  };
}
function _responseBody(response) {
  var body = response && response.body != null ? response.body : '';
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object') return JSON.stringify(body);
  return String(body || '');
}
function _readResponse(response) {
  var body = response && response.body;
  if (typeof body === 'string') return Promise.resolve(body);
  if (response && typeof response.text === 'function') {
    try { return Promise.resolve(response.text()); } catch (e) { /* fall through */ }
  }
  if (body && typeof body === 'object') return Promise.resolve(JSON.stringify(body));
  return Promise.resolve(String(body == null ? '' : body));
}
function _request(url, options) {
  var opts = options || {};
  var headers = Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, opts.headers || {});
  return fetch(url, Object.assign({}, opts, { headers: headers, timeoutMs: opts.timeoutMs || _config().timeoutMs })).then(function (response) {
    return _readResponse(response).then(function (body) {
      var status = Number(response && response.status || 0);
      if (status < 200 || status >= 300) {
        var error = new Error('HTTP ' + status + ' for ' + url);
        error.status = status;
        error.body = String(body || '').slice(0, 180);
        throw error;
      }
      return { status: status, body: body, headers: response && response.headers, url: response && response.url || url };
    });
  });
}
function _json(url, options) {
  return _request(url, options).then(function (response) {
    try { return JSON.parse(_responseBody(response) || 'null'); }
    catch (e) { throw new Error('Invalid JSON from ' + url); }
  });
}
function _graph(query, variables) {
  return _request(ANILIST, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: query, variables: variables || {} }), timeoutMs: 12000 })
    .then(function (response) {
      var parsed;
      try { parsed = JSON.parse(_responseBody(response) || 'null'); }
      catch (e) { throw new Error('AniList returned invalid JSON'); }
      if (parsed && parsed.errors && parsed.errors.length) throw new Error('AniList: ' + String(parsed.errors[0].message || 'query failed'));
      return parsed && parsed.data || {};
    });
}
var MEDIA_FIELDS = 'id idMal title { english romaji native userPreferred } description(asHtml:false) coverImage { extraLarge large } bannerImage episodes status genres seasonYear averageScore isAdult synonyms';
function _cacheGet(store, key) {
  var entry = store[key];
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.value;
}
function _cachePut(store, key, value, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return value;
  store[key] = { value: value, expiresAt: Date.now() + ttlMs };
  var keys = Object.keys(store);
  while (keys.length > 240) delete store[keys.shift()];
  return value;
}
function _media(id) {
  var cached = _cacheGet(MEDIA_CACHE, id);
  if (cached) return Promise.resolve(cached);
  return _graph('query($id:Int){Media(id:$id,type:ANIME){' + MEDIA_FIELDS + '}}', { id: Number(id) }).then(function (data) {
    if (!data.Media) throw new Error('AniList title not found: ' + id);
    if (data.Media.isAdult && !_config().showAdult) throw new Error('XFDM: adult title hidden by settings');
    return _cachePut(MEDIA_CACHE, id, data.Media, _config().cacheMs);
  });
}
function _title(media) {
  return media && media.title && (media.title.english || media.title.romaji || media.title.native || media.title.userPreferred) || 'Anime';
}
function _status(value) {
  var status = String(value || '').toUpperCase();
  if (status === 'FINISHED') return 'completed';
  if (status === 'RELEASING' || status === 'NOT_YET_RELEASED') return 'ongoing';
  if (status === 'CANCELLED') return 'cancelled';
  return 'unknown';
}
function _item(media) {
  if (!media || !media.id) return null;
  if (media.isAdult && !_config().showAdult) return null;
  return {
    id: 'xfdm://anime/' + media.id,
    url: 'xfdm://anime/' + media.id,
    title: _title(media) + (media.seasonYear ? ' (' + media.seasonYear + ')' : ''),
    englishTitle: media.title && media.title.english || null,
    nativeTitle: media.title && media.title.native || null,
    synonyms: Array.isArray(media.synonyms) ? media.synonyms : [],
    cover: media.coverImage && (media.coverImage.extraLarge || media.coverImage.large) || null,
    banner: media.bannerImage || null,
    description: media.description || '',
    status: _status(media.status),
    genres: Array.isArray(media.genres) ? media.genres : [],
    malId: Number(media.idMal) || null,
    year: media.seasonYear != null ? String(media.seasonYear) : null,
    score: media.averageScore || null,
    type: 'anime',
    sourceId: SOURCE_ID
  };
}
function _list(sort, page) {
  return _graph('query($page:Int){Page(page:$page,perPage:20){media(type:ANIME,sort:' + sort + ',isAdult:' + (_config().showAdult ? 'true' : 'false') + '){' + MEDIA_FIELDS + '}}}', { page: Math.max(1, _int(page, 1, 1, 100)) })
    .then(function (data) { return (data.Page && Array.isArray(data.Page.media) ? data.Page.media : []).map(_item).filter(Boolean); });
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _graph('query($search:String,$page:Int){Page(page:$page,perPage:20){media(search:$search,type:ANIME,sort:SEARCH_MATCH,isAdult:' + (_config().showAdult ? 'true' : 'false') + '){' + MEDIA_FIELDS + '}}}', { search: q, page: Math.max(1, _int(page, 1, 1, 100)) })
    .then(function (data) { return (data.Page && Array.isArray(data.Page.media) ? data.Page.media : []).map(_item).filter(Boolean); })
    .catch(function (error) { console.warn('XFDM search failed:', String(error)); return []; });
}
function getHome(opts) {
  var sorts = { trending: 'TRENDING_DESC', popular: 'POPULARITY_DESC', top: 'SCORE_DESC' };
  var sections = _config().sections;
  return Promise.all(sections.filter(function (name, index) { return sorts[name] && sections.indexOf(name) === index; }).map(function (name) {
    return _list(sorts[name], 1).then(function (items) {
      return items.length ? { title: name.charAt(0).toUpperCase() + name.slice(1) + ' Anime', items: items } : null;
    }).catch(function (error) { console.warn('XFDM home section failed:', name, String(error)); return null; });
  })).then(function (rows) { return rows.filter(Boolean); });
}
function popular(opts) {
  return _list('POPULARITY_DESC', 1).catch(function () { return []; });
}
function _id(value) {
  var text = String(value || '');
  var match = text.match(/(?:xfdm:\/\/anime\/|\/)(\d+)(?:[/?#]|$)/) || text.match(/^(\d+)$/);
  if (!match) throw new Error('XFDM: invalid AniList ID');
  return Number(match[1]);
}
function _normal(value) {
  return String(value || '').toLowerCase().replace(/[\s\-_,.·:;!?，。！？：；、（）()【】\[\]{}'"“”‘’]+/g, '');
}
function _year(value) {
  var match = String(value || '').match(/^(\d{4})/);
  return match ? Number(match[1]) : 0;
}
function _titleNames(media) {
  var raw = [media.title && media.title.native, media.title && media.title.romaji, media.title && media.title.english, media.title && media.title.userPreferred].concat(media.synonyms || []);
  var seen = {};
  return raw.map(function (value) { return String(value || '').trim(); }).filter(function (value) {
    var normal = _normal(value);
    if (!normal || seen[normal]) return false;
    seen[normal] = true;
    return true;
  });
}
function _bangumiSearch(keyword) {
  return _json(BANGUMI + '/v0/search/subjects?limit=20', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'MewtwoRepo/1.0 (https://github.com/MewtwoOP1/Mewtwo-repo)' },
    body: JSON.stringify({ keyword: keyword, sort: 'match', filter: { type: [2], nsfw: false } }),
    timeoutMs: _config().timeoutMs
  });
}
function _chooseBangumi(rows, aliases, media) {
  var aliasSet = {};
  aliases.forEach(function (alias) { aliasSet[_normal(alias)] = true; });
  var seen = {};
  var candidates = rows.filter(function (row) {
    if (!row || !row.id || Number(row.type) !== 2) return false;
    var original = _normal(row.name);
    var chinese = _normal(row.name_cn);
    if (!(original && aliasSet[original]) && !(chinese && aliasSet[chinese])) return false;
    var key = String(row.id);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  var year = Number(media && media.seasonYear) || 0;
  if (year) {
    var byYear = candidates.filter(function (row) { return _year(row.date) === year || _year(row.date) === _year(row.name); });
    if (byYear.length === 1) return byYear[0];
    if (byYear.length) candidates = byYear;
  }
  var episodes = Number(media && media.episodes) || 0;
  if (episodes > 0) {
    var byEpisodes = candidates.filter(function (row) {
      var count = Number(row.eps || row.total_episodes || row.episodes || 0);
      return count > 0 && count === episodes;
    });
    if (byEpisodes.length === 1) return byEpisodes[0];
    if (byEpisodes.length) candidates = byEpisodes;
  }
  return null;
}
function _bangumiMatch(media) {
  var names = _titleNames(media);
  var index = 0;
  function next() {
    if (index >= Math.min(names.length, _config().maxNames)) {
      var error = new Error('XFDM: no exact Bangumi title match for AniList ID ' + media.id);
      error.noMatch = true;
      throw error;
    }
    var query = names[index++];
    return _bangumiSearch(query).then(function (root) {
      var rows = Array.isArray(root && root.data) ? root.data : [];
      var chosen = _chooseBangumi(rows, names, media);
      if (chosen) return chosen;
      return next();
    }).catch(function (error) {
      if (error && error.noMatch) throw error;
      console.warn('Bangumi title lookup failed for alias:', query, String(error));
      return next();
    });
  }
  return Promise.resolve().then(next);
}
function _suggestPath(html, bangumiId) {
  var id = String(bangumiId);
  var cards = String(html || '').split(/<div\b[^>]*class\s*=\s*['"][^'"]*\bpublic-list-box\b[^'"]*\bsearch-box[^'"]*['"]/ig);
  for (var index = 1; index < cards.length; index++) {
    var card = cards[index];
    var cover = (card.match(/\/pic\/cover\/[^"'\s)]*?\/(\d+)_[^"'\s)]*\.(?:jpg|jpeg|png|webp)/i) || [])[1];
    var path = (card.match(/href\s*=\s*['"]([^'"]*\/bangumi\/\d+\.html)['"]/i) || [])[1];
    if (cover === id && path) return path.charAt(0) === '/' ? path : '/' + path.replace(/^.*?\/(bangumi\/\d+\.html)$/i, '$1');
  }
  return null;
}
function _subjectPath(query, bangumiId) {
  var suggest = _json(SITE + '/index.php/ajax/suggest?mid=1&wd=' + encodeURIComponent(query) + '&limit=50', { headers: { Accept: 'application/json', Referer: SITE + '/' } })
    .then(function (root) {
      var rows = Array.isArray(root && root.list) ? root.list : [];
      for (var index = 0; index < rows.length; index++) {
        var row = rows[index] || {};
        var pic = String(row.pic || '');
        var match = pic.match(/\/(\d+)_[^/]+\.(?:jpg|jpeg|png|webp)/i);
        if (match && match[1] === String(bangumiId) && row.id) return '/bangumi/' + Number(row.id) + '.html';
      }
      return null;
    })
    .catch(function (error) { console.warn('XFDM suggestion lookup failed:', String(error)); return null; });
  return suggest.then(function (path) {
    if (path) return path;
    return _request(SITE + '/search.html?wd=' + encodeURIComponent(query), { headers: { Accept: 'text/html,application/xhtml+xml,*/*', Referer: SITE + '/' } }).then(function (response) {
      var found = _suggestPath(_responseBody(response), bangumiId);
      if (!found) throw new Error('XFDM search did not contain Bangumi cover ID ' + bangumiId);
      return found;
    });
  });
}
function _stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}
function _episodeRows(html) {
  var re = /<a\b[^>]*\bhref\s*=\s*['"]\/watch\/\d+\/(\d+)\/\d+\.html['"][^>]*>([\s\S]*?)<\/a>/gi;
  var match;
  var rows = [];
  var seen = {};
  while ((match = re.exec(String(html || ''))) !== null) {
    var label = _stripTags(match[2]);
    var numberMatch = label.match(/第\s*0*(\d+)\s*[话話集]/);
    if (!numberMatch) continue;
    var number = Number(numberMatch[1]);
    var channel = Number(match[1]);
    if (!(number > 0) || !channel) continue;
    var key = channel + ':' + number;
    if (seen[key]) continue;
    seen[key] = true;
    var path = (match[0].match(/href\s*=\s*['"]([^'"]+)/i) || [])[1];
    rows.push({ number: number, channel: channel, title: label || ('Episode ' + number), watchPath: path });
  }
  return rows.sort(function (a, b) { return a.number - b.number || a.channel - b.channel; });
}
function _extractPlayerObject(html) {
  var text = String(html || '');
  var startMatch = /player_\w+\s*=\s*\{/.exec(text);
  if (!startMatch) return null;
  var start = startMatch.index + startMatch[0].length - 1;
  var index = start;
  var depth = 0;
  var quote = '';
  var escaped = false;
  for (; index < text.length; index++) {
    var character = text.charAt(index);
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '{') depth++;
    else if (character === '}') {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}
function _playerUrl(html) {
  var config = _extractPlayerObject(html);
  if (!config) return null;
  var url = null;
  try {
    var parsed = JSON.parse(config);
    if (parsed && parsed.url) url = parsed.url;
  } catch (e) { url = null; }
  if (!url) {
    var raw = (config.match(/["']url["']\s*:\s*"((?:[^"\\]|\\.)*)"/i) || [])[1];
    if (raw) url = raw;
  }
  if (!url) return null;
  url = String(url).replace(/\\+\//g, '/').replace(/\\\\/g, '\\').replace(/&amp;/g, '&').trim();
  return /^https?:\/\//i.test(url) ? url : null;
}
function _catalog(id, force) {
  var cached = !force && _cacheGet(CATALOG_CACHE, id);
  if (cached) return Promise.resolve(cached);
  var missed = !force && _cacheGet(MISS_CACHE, id);
  if (missed) return Promise.reject(new Error('XFDM: no confirmed Bangumi mapping for title ' + id));
  return _media(id).then(function (media) {
    return _bangumiMatch(media).then(function (bangumi) {
      var queries = [bangumi.name_cn, bangumi.name].concat(_titleNames(media)).map(function (value) { return String(value || '').trim(); }).filter(function (value, index, list) { return value && list.indexOf(value) === index; });
      var queryIndex = 0;
      var transportError = null;
      function nextQuery() {
        if (queryIndex >= queries.length) {
          if (transportError) throw transportError;
          var error = new Error('XFDM: no subject page matched Bangumi ID ' + bangumi.id);
          error.noMatch = true;
          throw error;
        }
        var query = queries[queryIndex++];
        return _subjectPath(query, bangumi.id).then(function (path) {
          return _request(SITE + path, { headers: { Accept: 'text/html,application/xhtml+xml,*/*', Referer: SITE + '/' } }).then(function (response) {
            var episodes = _episodeRows(_responseBody(response));
            if (!episodes.length) throw new Error('XFDM subject page has no numbered episodes');
            return { bangumiId: Number(bangumi.id), subjectPath: path, episodes: episodes };
          });
        }).catch(function (error) {
          if (error && !error.status && !error.noMatch) transportError = error;
          console.warn('XFDM subject candidate failed:', query, String(error));
          return nextQuery();
        });
      }
      return nextQuery();
    });
  }).then(function (result) {
    return _cachePut(CATALOG_CACHE, id, result, _config().cacheMs);
  }).catch(function (error) {
    if (error && error.noMatch && _config().cacheMs > 0) _cachePut(MISS_CACHE, id, Date.now(), Math.min(30000, _config().cacheMs));
    throw error;
  });
}
function _episodeUrl(id, number) {
  return 'xfdm://episode/' + id + '/' + number;
}
function _episodeRowsToItems(id, rows) {
  var seen = {};
  return rows.filter(function (row) {
    if (seen[row.number]) return false;
    seen[row.number] = true;
    return true;
  }).map(function (row) {
    return {
      id: _episodeUrl(id, row.number),
      url: _episodeUrl(id, row.number),
      number: row.number,
      title: row.title || ('Episode ' + row.number),
      thumbnail: row.thumbnail || null,
      date: row.airDate || null,
      sourceId: SOURCE_ID,
      type: 'anime',
      category: 'sub'
    };
  });
}
function _fallbackEpisodes(id, count) {
  var total = Math.max(0, Math.min(500, Number(count) || 0));
  var rows = [];
  for (var number = 1; number <= total; number++) rows.push({ id: _episodeUrl(id, number), url: _episodeUrl(id, number), number: number, title: 'Episode ' + number, sourceId: SOURCE_ID, type: 'anime', category: 'sub' });
  return rows;
}
function getDetail(url, opts) {
  var id = _id(url);
  return _media(id).then(function (media) {
    var detail = _item(media);
    if (!detail) throw new Error('XFDM: adult title hidden by settings');
    return _catalog(id, opts && opts.forceRefresh).then(function (catalog) {
      detail.episodes = _episodeRowsToItems(id, catalog.episodes);
      if (!detail.episodes.length) detail.episodes = _fallbackEpisodes(id, media.episodes);
      detail.subCount = detail.episodes.length;
      detail.dubCount = 0;
      return detail;
    }).catch(function (error) {
      console.warn('XFDM catalogue unavailable; showing AniList episode inventory:', String(error));
      detail.episodes = _fallbackEpisodes(id, media.episodes);
      detail.subCount = detail.episodes.length;
      detail.dubCount = 0;
      return detail;
    });
  });
}
function getEpisodes(url, opts) {
  var id = _id(url);
  return Promise.all([_media(id), _catalog(id, opts && opts.forceRefresh).catch(function () { return null; })]).then(function (results) {
    if (results[1]) {
      var rows = _episodeRowsToItems(id, results[1].episodes);
      if (rows.length) return rows;
    }
    return _fallbackEpisodes(id, results[0].episodes);
  });
}
function _resolveChannels(rows) {
  var unique = [];
  var seen = {};
  rows.forEach(function (row) {
    if (!row || !row.watchPath || seen[row.watchPath]) return;
    seen[row.watchPath] = true;
    unique.push(row);
  });
  var limit = _config().maxChannels;
  var index = 0;
  var chosen = [];
  function result() {
    return chosen.slice().sort(function (a, b) { return Number(a.slow) - Number(b.slow); });
  }
  function next() {
    if (index >= unique.length || chosen.length >= limit) {
      if (!chosen.length) return Promise.reject(new Error('XFDM: no playable MP4 mirror resolved'));
      return Promise.resolve(result());
    }
    var row = unique[index++];
    return _request(SITE + row.watchPath, { headers: { Accept: 'text/html,application/xhtml+xml,*/*', Referer: SITE + '/' } }).then(function (response) {
      var url = _playerUrl(_responseBody(response));
      if (!url) throw new Error('XFDM watch page contained no direct player URL');
      var host = (String(url).match(/^https?:\/\/([^/:?#]+)/i) || [])[1] || '';
      host = host.toLowerCase();
      chosen.push({ url: url, host: host, slow: host === 'apn.moedot.net' });
      if (chosen.some(function (item) { return !item.slow; })) return result();
      return next();
    }).catch(function (error) {
      console.warn('XFDM channel failed:', row.channel, String(error));
      return next();
    });
  }
  return next().then(function (streams) {
    if (!streams.length) throw new Error('XFDM: no playable MP4 mirror resolved');
    return streams;
  });
}

function _mfRoot(value) {
  var root = value || {};
  for (var i = 0; i < 3 && root && typeof root === 'object' && !Array.isArray(root); i++) {
    if (root.results && typeof root.results === 'object' && !Array.isArray(root.results)) root = root.results;
    else if (root.data && typeof root.data === 'object' && !Array.isArray(root.data) && (root.data.providers || root.data.streams)) root = root.data;
    else break;
  }
  return root || {};
}
function _mfGet(host, path) {
  var url = String(host).replace(/\/+$/, '') + '/' + String(path).replace(/^\/+/, '');
  return fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, timeoutMs: 10000 }).then(function (response) {
    return _readResponse(response).then(function (body) {
      var status = Number(response && response.status || 0);
      if (status < 200 || status >= 300) throw new Error('HTTP ' + status + ' from ' + url);
      try { return JSON.parse(body || 'null'); }
      catch (e) { throw new Error('Invalid JSON from ' + url); }
    });
  });
}
function _mfOptions(payload, number, category) {
  var root = _mfRoot(payload);
  var providers = root.providers || {};
  var names = Object.keys(providers).sort(function (a, b) {
    var ai = MIRURO_PROVIDER_ORDER.indexOf(String(a).toLowerCase());
    var bi = MIRURO_PROVIDER_ORDER.indexOf(String(b).toLowerCase());
    if (ai < 0) ai = 999;
    if (bi < 0) bi = 999;
    return ai === bi ? a.localeCompare(b) : ai - bi;
  });
  var categories = category === 'dub' ? ['dub'] : ['sub', 'hsub'];
  var options = [];
  names.forEach(function (name) {
    var provider = providers[name] || {};
    var lists = provider.episodes || provider;
    categories.forEach(function (cat) {
      var rows = Array.isArray(lists[cat]) ? lists[cat] : [];
      rows.forEach(function (episode) {
        if (!episode || Number(episode.number || episode.episode || episode.ep) !== Number(number)) return;
        var id = String(episode.id || episode.url || '').trim();
        if (!id) return;
        if (/^https?:\/\//i.test(id)) { options.push({ provider: name, route: id, direct: true }); return; }
        id = id.replace(/^\/+/, '');
        if (id.indexOf('watch/') !== 0) return;
        options.push({ provider: name, route: id, direct: false, slug: id.split('/').pop() || '' });
      });
    });
  });
  var seen = {};
  return options.filter(function (option) {
    var key = option.provider + '|' + option.route;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}
function _mfStreams(payload, provider, category) {
  var root = _mfRoot(payload);
  var rows = Array.isArray(root) ? root : (Array.isArray(root.streams) ? root.streams : (root.bestStream && root.bestStream.url ? [root.bestStream].concat(root.streams || []) : (root.stream && root.stream.url ? [root.stream] : [])));
  var subtitles = Array.isArray(root.subtitles) ? root.subtitles : [];
  var streams = rows.map(function (row) {
    if (!row) return null;
    var url = String(row.url || row.file || '').trim();
    if (!/^https?:\/\//i.test(url)) return null;
    var type = String(row.type || row.format || '').toLowerCase();
    if (type === 'embed') return null;
    var headers = {};
    if (row.headers && typeof row.headers === 'object') Object.keys(row.headers).forEach(function (key) { headers[key] = String(row.headers[key]); });
    var referer = row.referer || row.referrer || null;
    if (referer && !headers.Referer && !headers.referer) headers.Referer = String(referer);
    var container = type === 'dash' || /\.mpd(?:[?#]|$)/i.test(url) ? 'dash' : (type === 'hls' || /\.m3u8(?:[?#]|$)/i.test(url) ? 'hls' : (type === 'mp4' || /\.mp4(?:[?#]|$)/i.test(url) ? 'mp4' : undefined));
    var label = String(row.quality || row.label || row.name || 'Auto');
    return {
      url: url,
      container: container,
      type: row.type || row.format || container,
      quality: label,
      label: label + ' · Miruro (' + provider + ')',
      kind: category,
      audioLang: category === 'dub' ? 'en' : 'ja',
      headers: headers,
      referer: referer || undefined,
      subtitles: []
    };
  }).filter(Boolean);
  if (streams.length && subtitles.length) {
    streams[0].subtitles = subtitles.map(function (sub) {
      if (!sub) return null;
      var url = String(sub.url || sub.file || '');
      if (!/^https?:\/\//i.test(url)) return null;
      return { url: url, label: sub.label || sub.title || sub.language || 'Subtitle', lang: sub.language || sub.lang || '', format: sub.format || 'vtt' };
    }).filter(Boolean);
  }
  var seen = {};
  return streams.filter(function (stream) {
    if (seen[stream.url]) return false;
    seen[stream.url] = true;
    return true;
  });
}
function _miruroFallback(id, number, category, label) {
  var hosts = MIRURO_FALLBACK_HOSTS.map(function (host) { return host.replace(/\/+$/, ''); });
  var lastError = null;
  var options = null;
  function loadOptions(index) {
    if (options) return Promise.resolve(options);
    if (index >= hosts.length) return Promise.reject(lastError || new Error(label + ': no Miruro host responded'));
    return _mfGet(hosts[index], 'episodes/' + encodeURIComponent(String(id))).then(function (payload) {
      var found = _mfOptions(payload, number, category);
      if (!found.length) throw new Error(label + ': Miruro has no provider episode for ' + number + ' (' + category + ')');
      options = found;
      return options;
    }).catch(function (error) {
      lastError = error;
      return loadOptions(index + 1);
    });
  }
  function tryHost(index, foundOptions) {
    if (index >= hosts.length) return Promise.reject(lastError || new Error(label + ': no playable Miruro provider'));
    var host = hosts[index];
    function tryOption(optionIndex) {
      if (optionIndex >= foundOptions.length) return Promise.reject(lastError || new Error(label + ': no playable Miruro provider'));
      var option = foundOptions[optionIndex];
      if (option.direct) {
        var directType = /\.m3u8/i.test(option.route) ? 'hls' : (/\.mpd/i.test(option.route) ? 'dash' : 'mp4');
        return Promise.resolve([{ url: option.route, container: directType, type: directType, quality: 'Auto', label: 'Miruro direct (' + option.provider + ')', kind: category, audioLang: category === 'dub' ? 'en' : 'ja', headers: {}, subtitles: [] }]);
      }
      var routes = [
        option.route,
        'stream?provider=' + encodeURIComponent(option.provider) + '&anilistId=' + encodeURIComponent(String(id)) + '&category=' + encodeURIComponent(category) + '&slug=' + encodeURIComponent(option.slug),
        'sources?episodeId=' + encodeURIComponent(option.route) + '&provider=' + encodeURIComponent(option.provider) + '&anilistId=' + encodeURIComponent(String(id)) + '&category=' + encodeURIComponent(category)
      ];
      function tryRoute(routeIndex) {
        if (routeIndex >= routes.length) return Promise.reject(lastError || new Error('Miruro route failed: ' + option.provider));
        return _mfGet(host, routes[routeIndex]).then(function (payload) {
          var streams = _mfStreams(payload, option.provider, category);
          if (!streams.length) throw new Error('No streams from ' + option.provider);
          return streams;
        }).catch(function (error) {
          lastError = error;
          return tryRoute(routeIndex + 1);
        });
      }
      return tryRoute(0).catch(function (error) {
        lastError = error;
        return tryOption(optionIndex + 1);
      });
    }
    return tryOption(0).catch(function (error) {
      lastError = error;
      return tryHost(index + 1, foundOptions);
    });
  }
  return loadOptions(0).then(function (foundOptions) { return tryHost(0, foundOptions); });
}
function getVideoSources(url, opts) {
  var match = String(url || '').match(/^xfdm:\/\/episode\/(\d+)\/(\d+)$/i);
  if (!match) return Promise.reject(new Error('XFDM: invalid episode URL'));
  var id = Number(match[1]);
  var episode = Number(match[2]);
  var native = _catalog(id).then(function (catalog) {
    var rows = catalog.episodes.filter(function (row) { return row.number === episode; });
    if (!rows.length) throw new Error('XFDM episode ' + episode + ' is not in the catalogue');
    return _resolveChannels(rows);
  }).then(function (channels) {
    return channels.map(function (channel, index) {
      var hls = /\.m3u8(?:[?#]|$)/i.test(channel.url);
      var label = 'Mirror ' + (index + 1) + ' (' + String(channel.host || 'source').split('.')[0] + ')';
      return {
        url: channel.url,
        container: hls ? 'hls' : 'mp4',
        type: hls ? 'hls' : 'mp4',
        quality: label,
        label: label,
        headers: {},
        referer: undefined,
        kind: 'sub',
        audioLang: 'ja',
        subtitles: [],
        isActive: index === 0
      };
    });
  });
  return native.catch(function (error) {
    console.warn('XFDM direct playback unavailable; trying Miruro episode sources:', String(error));
    return _miruroFallback(id, episode, 'sub', 'XFDM');
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: '1.0.2', getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _config: _config, _normal: _normal, _titleNames: _titleNames, _chooseBangumi: _chooseBangumi,
    _suggestPath: _suggestPath, _episodeRows: _episodeRows, _playerUrl: _playerUrl,
    _catalog: _catalog, _fallbackEpisodes: _fallbackEpisodes, _episodeRowsToItems: _episodeRowsToItems,
    _miruroFallback: _miruroFallback
  };
}
