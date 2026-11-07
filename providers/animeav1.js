// AnimeAV1 — Spanish catalogue backed by SvelteKit page data.
// Search, detail and episode pages have a __data.json twin whose "devalue"
// payload is flattened; this provider hydrates it in JS. Playback comes from
// the episode's own embeds: VOE (HLS) and YourUpload (MP4), both resolved to
// real media URLs instead of iframes.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'animeav1';
var VERSION = '1.0.1';
var SITE = 'https://animeav1.com';
var CDN = 'https://cdn.animeav1.com';
var UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
var CACHE = {};

function getInfo() {
  return { name: 'AnimeAV1', lang: 'es', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=animeav1.com',
    type: 'anime', version: VERSION };
}
function getSettings() {
  return [
    { key: 'audioMode', label: 'Audio tracks', description: 'Show the Spanish subtitled version, the Latino dub, or both when AnimeAV1 lists them.', type: 'enum', default: 'both', options: [{ value: 'both', label: 'Sub and dub' }, { value: 'sub', label: 'Sub only' }, { value: 'dub', label: 'Dub only' }] },
    { key: 'requestTimeoutMs', label: 'Request timeout', description: 'Maximum wait for each AnimeAV1 page or embed request.', type: 'enum', default: '12000', options: [{ value: '6000', label: '6 seconds' }, { value: '12000', label: '12 seconds' }, { value: '18000', label: '18 seconds' }] }
  ];
}
function _setting(key) {
  try {
    var all = typeof __settings !== 'undefined' && __settings ? __settings : {};
    var cfg = all[SOURCE_ID] || all.animeav1 || {};
    return cfg[key] == null ? null : cfg[key];
  } catch (e) { return null; }
}
function _int(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function _config() {
  return {
    audioMode: String(_setting('audioMode') || 'both').toLowerCase(),
    timeoutMs: _int(_setting('requestTimeoutMs'), 12000, 3000, 30000)
  };
}
function _cacheGet(key) {
  var entry = CACHE[key];
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.value;
}
function _cachePut(key, value, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return value;
  CACHE[key] = { value: value, expiresAt: Date.now() + ttlMs };
  var keys = Object.keys(CACHE);
  while (keys.length > 120) delete CACHE[keys.shift()];
  return value;
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
function _get(url, referer) {
  var key = 'page:' + url;
  var cached = _cacheGet(key);
  if (cached) return Promise.resolve(cached);
  return fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/json,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.6',
      'Referer': referer || SITE + '/'
    },
    timeoutMs: _config().timeoutMs
  }).then(function (response) {
    return _readResponse(response).then(function (body) {
      var status = Number(response && response.status || 0);
      if (status < 200 || status >= 300) {
        var error = new Error('AnimeAV1 HTTP ' + status + ' for ' + url);
        error.status = status;
        throw error;
      }
      return _cachePut(key, String(body || ''), 60000);
    });
  });
}
function _json(url, referer) {
  return _get(url, referer).then(function (body) {
    try { return JSON.parse(body || 'null'); }
    catch (e) { throw new Error('AnimeAV1 returned invalid JSON for ' + url); }
  });
}
function _hydrate(flat, index, depth) {
  depth = depth || 0;
  if (index < 0 || index >= flat.length || depth > 64) return null;
  var value = flat[index];
  if (Array.isArray(value)) {
    if (typeof value[0] === 'string') return value;
    return value.map(function (ref) { return _resolve(flat, ref, depth); });
  }
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function (key) { out[key] = _resolve(flat, value[key], depth); });
    return out;
  }
  return value;
}
function _resolve(flat, ref, depth) {
  if (typeof ref !== 'number') return null;
  return _hydrate(flat, ref, depth + 1);
}
function _pageData(root) {
  var nodes = root && root.nodes;
  if (!Array.isArray(nodes)) return null;
  var flat = null;
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (node && node.type === 'data' && Array.isArray(node.data)) flat = node.data;
  }
  if (!flat) return null;
  var data = _hydrate(flat, 0, 0);
  return data && typeof data === 'object' ? data : null;
}
function _dataUrl(path, query) {
  var url = SITE + '/' + path + '/__data.json';
  var pairs = [];
  Object.keys(query || {}).forEach(function (key) {
    if (query[key] != null && query[key] !== '') pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(query[key])));
  });
  return pairs.length ? url + '?' + pairs.join('&') : url;
}
function _data(path, query) {
  return _json(_dataUrl(path, query), SITE + '/').then(function (root) {
    var page = _pageData(root);
    if (!page) throw new Error('AnimeAV1 returned no page data for ' + path);
    return page;
  });
}
function _cover(id) {
  var text = String(id == null ? '' : id);
  return /^\d+$/.test(text) ? CDN + '/covers/' + text + '.jpg' : null;
}
function _result(row) {
  if (!row || !row.slug) return null;
  var title = String(row.title || row.slug);
  return {
    id: 'av1://media/' + row.slug,
    url: 'av1://media/' + row.slug,
    title: title,
    name: title,
    cover: _cover(row.id),
    poster: _cover(row.id),
    description: String(row.synopsis || ''),
    type: 'anime',
    sourceId: SOURCE_ID
  };
}
function _results(rows) {
  var out = [], seen = {};
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    var item = _result(row);
    if (item && !seen[item.id]) { seen[item.id] = 1; out.push(item); }
  });
  return out;
}
function _catalogue(query) {
  return _data('catalogo', query).then(function (page) { return _results(page.results); });
}
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  return _catalogue({ search: q, page: Math.max(1, _int(page, 1, 1, 100)) })
    .catch(function () { return []; });
}
function popular(opts) {
  return _catalogue({}).catch(function () { return []; });
}
function getHome(opts) {
  return popular(opts).then(function (items) {
    return items.length ? [{ title: 'AnimeAV1 Catálogo', items: items.slice(0, 30) }] : [];
  });
}
function _slug(value) {
  var text = String(value || '');
  var match = text.match(/av1:\/\/media\/([^/?#]+)/i) ||
    text.match(/\/media\/([^/?#]+)/i) ||
    text.match(/^([a-z0-9-]+)$/i);
  return match ? match[1] : '';
}
function _media(slug) {
  return _data('media/' + encodeURIComponent(slug)).then(function (page) {
    if (!page.media) throw new Error('AnimeAV1 page carried no media');
    return page.media;
  });
}
function _episodeNumbers(media) {
  var out = [], seen = {};
  (Array.isArray(media && media.episodes) ? media.episodes : []).forEach(function (row) {
    var number = Number(row && row.number);
    if (!isFinite(number) || number <= 0 || number % 1 !== 0 || seen[number]) return;
    seen[number] = 1;
    out.push(number);
  });
  out.sort(function (a, b) { return a - b; });
  return out;
}
function _variants(page) {
  var variants = page && page.episode && page.episode.variants;
  var out = {};
  Object.keys(variants || {}).forEach(function (key) {
    var count = Number(variants[key]);
    if (count > 0) out[String(key).toUpperCase()] = count;
  });
  return out;
}
function _episodeUrl(slug, number, category) {
  return 'av1://episode/' + [encodeURIComponent(slug), number, category].join('/');
}
function _episode(slug, number, category) {
  var url = _episodeUrl(slug, number, category);
  return {
    id: url, url: url, number: number, title: 'Episode ' + number,
    category: category, sourceId: SOURCE_ID, type: 'anime'
  };
}
function _episodeItems(slug, numbers, dubbed) {
  var cfg = _config();
  var wantSub = cfg.audioMode !== 'dub';
  var wantDub = cfg.audioMode !== 'sub' && dubbed;
  if (cfg.audioMode === 'sub' && !wantSub) wantDub = dubbed;
  if (cfg.audioMode === 'dub' && !wantDub) wantSub = true;
  var out = [];
  numbers.forEach(function (number) {
    if (wantSub) out.push(_episode(slug, number, 'sub'));
    if (wantDub) out.push(_episode(slug, number, 'dub'));
  });
  return out;
}
function _year(value) {
  var match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : null;
}
function getDetail(url, opts) {
  var slug = _slug(url);
  if (!slug) return Promise.reject(new Error('AnimeAV1: missing media slug'));
  return _media(slug).then(function (media) {
    var numbers = _episodeNumbers(media);
    if (!numbers.length) throw new Error('AnimeAV1 lists no episodes for this title');
    return _data('media/' + encodeURIComponent(slug) + '/' + numbers[0]).then(function (page) {
      var variants = _variants(page);
      var dubbed = variants.DUB > 0;
      var title = String(media.title || slug);
      var item = _result({
        id: media.id, slug: slug, title: title, synopsis: media.synopsis
      }) || { id: slug, url: slug, title: title, type: 'anime', sourceId: SOURCE_ID };
      item.id = 'av1://media/' + slug;
      item.url = item.id;
      item.englishTitle = media.aka && media.aka['en-us'] || null;
      item.nativeTitle = media.aka && media.aka['ja-jp'] || null;
      item.description = String(media.synopsis || '');
      item.genres = (Array.isArray(media.genres) ? media.genres : []).map(function (g) { return String(g && g.name || ''); }).filter(Boolean);
      item.malId = Number(media.malId) || null;
      item.year = _year(media.startDate);
      item.score = Number(media.score) || null;
      item.status = 'unknown';
      item.episodes = _episodeItems(slug, numbers, dubbed);
      item.subCount = item.episodes.filter(function (x) { return x.category === 'sub'; }).length;
      item.dubCount = item.episodes.filter(function (x) { return x.category === 'dub'; }).length;
      item.episodeCount = item.episodes.length;
      return item;
    });
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) { return detail.episodes || []; });
}
function _parseEpisode(value) {
  var match = String(value || '').match(/^av1:\/\/episode\/([^/]+)\/(\d+)\/(sub|dub)$/i);
  if (!match) throw new Error('AnimeAV1: invalid episode URL');
  var slug;
  try { slug = decodeURIComponent(match[1]); } catch (e) { slug = match[1]; }
  return { slug: slug, number: Number(match[2]), category: match[3].toLowerCase() };
}
function _embeds(page, category) {
  var rows = page && page.embeds && page.embeds[category];
  var out = [];
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    if (!row || !row.url) return;
    out.push({ server: String(row.server || ''), url: String(row.url) });
  });
  return out;
}
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function _b64bytes(value) {
  var text = String(value || '').replace(/[^A-Za-z0-9+/]/g, '');
  var out = [], i;
  for (i = 0; i < text.length; i += 4) {
    var e1 = B64.indexOf(text.charAt(i));
    var e2 = B64.indexOf(text.charAt(i + 1));
    var e3 = B64.indexOf(text.charAt(i + 2));
    var e4 = B64.indexOf(text.charAt(i + 3));
    if (e1 < 0 || e2 < 0) break;
    out.push((e1 << 2) | (e2 >> 4));
    if (e3 >= 0) out.push(((e2 & 15) << 4) | (e3 >> 2));
    if (e4 >= 0) out.push(((e3 & 3) << 6) | e4);
  }
  return out;
}
function _latin1(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i] & 255);
  return out;
}
function _utf8(bytes) {
  var encoded = '';
  for (var i = 0; i < bytes.length; i++) encoded += '%' + ('0' + (bytes[i] & 255).toString(16)).slice(-2);
  try { return decodeURIComponent(encoded); }
  catch (e) { return _latin1(bytes); }
}
function _rot13(value) {
  return String(value || '').replace(/[a-zA-Z]/g, function (c) {
    var base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode((c.charCodeAt(0) - base + 13) % 26 + base);
  });
}
function _voeConfig(html) {
  var text = String(html || '');
  var marker = '<script type="application/json">';
  var start = text.indexOf(marker);
  if (start < 0) return null;
  start += marker.length;
  var end = text.indexOf('</script>', start);
  if (end <= start) return null;
  var encoded;
  try { encoded = JSON.parse(text.slice(start, end))[0]; }
  catch (e) { return null; }
  if (typeof encoded !== 'string' || !encoded) return null;
  var decoded = _rot13(encoded);
  ['@$', '^^', '~@', '%?', '*~', '!!', '#&'].forEach(function (junk) {
    decoded = decoded.split(junk).join('');
  });
  var shifted = _latin1(_b64bytes(decoded)).split('').map(function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 3);
  }).join('').split('').reverse().join('');
  try {
    var decodedJson = _utf8(_b64bytes(shifted)).replace(/\u0000+$/, '').trim();
    var config = JSON.parse(decodedJson);
    return config && typeof config === 'object' ? config : null;
  } catch (e) { return null; }
}
function _voeRedirect(html) {
  var text = String(html || '');
  var marker = 'window.location.href';
  var from = 0;
  while (true) {
    var at = text.indexOf(marker, from);
    if (at < 0) return '';
    from = at + marker.length;
    var i = from;
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
    if (text.charAt(i) !== '=' || text.charAt(i + 1) === '=') continue;
    i++;
    while (i < text.length && /\s/.test(text.charAt(i))) i++;
    var quote = text.charAt(i);
    if (quote !== "'" && quote !== '"') continue;
    var end = text.indexOf(quote, i + 1);
    if (end < 0) return '';
    var url = text.slice(i + 1, end);
    if (/^https:\/\//i.test(url)) return url;
  }
}
function _ogVideo(html) {
  var text = String(html || '');
  var match = text.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+)["']/i) ||
    text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video["']/i);
  var value = match ? match[1] : '';
  return /^https:\/\//i.test(value) && !/\/novideo\.mp4$/i.test(value) ? value : '';
}
function _resolveVoe(url, category) {
  return _get(url, SITE + '/').then(function (html) {
    var config = _voeConfig(html);
    if (config && config.source) return _voeStream(config.source, category);
    var next = _voeRedirect(html);
    if (!next) return null;
    return _get(next, SITE + '/').then(function (page) {
      var nested = _voeConfig(page);
      return nested && nested.source ? _voeStream(nested.source, category) : null;
    });
  }).catch(function () { return null; });
}
function _raceTimeout(promise, ms, expired) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  var t;
  var timeout = new Promise(function (resolve) {
    t = setTimeout(function () { resolve(expired); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (v) {
    try { if (typeof clearTimeout === 'function') clearTimeout(t); } catch (e) {}
    return v;
  });
}
function _voeStream(source, category) {
  if (!/^https:\/\//i.test(String(source || ''))) return null;
  var base = String(source).replace(/[^/]*(\?.*)?$/, '');
  var origin = (String(source).match(/^(https?:\/\/[^/]+)/) || [])[1] || '';
  var hdrs = { 'User-Agent': UA };
  function autoEntry(ct) {
    return { url: String(source), quality: 'Auto', label: 'AnimeAV1 VOE',
      type: ct === 'hls' ? 'hls' : 'mp4', container: ct, hls: ct === 'hls',
      headers: hdrs, kind: category, audio: category,
      audioLang: category === 'dub' ? 'es' : 'ja', subtitles: [], isActive: true };
  }
  var bodyP = fetch(String(source), { headers: hdrs })
    .then(function (r) { return String((r && r.body) || ''); });
  bodyP.catch(function () {});
  return _raceTimeout(bodyP, 5000, '').then(function (body) {
      if (body.indexOf('#EXT-X-STREAM-INF') === -1) return [autoEntry('hls')];
      var re = /#EXT-X-STREAM-INF:([^\r\n]*)\r?\n([^\r\n]+)/g, m;
      var vars = [], seen = {};
      while ((m = re.exec(body)) !== null) {
        var uri = m[2].trim();
        if (!uri || uri.charAt(0) === '#') continue;
        var url = uri;
        if (!/^https?:\/\//i.test(uri)) url = (uri.charAt(0) === '/') ? origin + uri : base + uri;
        if (seen[url]) continue; seen[url] = 1;
        var hm = m[1].match(/RESOLUTION=\d+x(\d+)/i);
        var bw = m[1].match(/BANDWIDTH=(\d+)/i);
        vars.push({ url: url, h: hm ? parseInt(hm[1], 10) : 0, bw: bw ? parseInt(bw[1], 10) : 0 });
      }
      if (!vars.length) return [autoEntry('hls')];
      vars.sort(function (a, b) { return (b.h - a.h) || (b.bw - a.bw); });
      var out = [autoEntry('hls')], i, v;
      for (i = 0; i < vars.length; i++) {
        v = vars[i];
        out.push({ url: v.url, quality: v.h ? (v.h + 'p') : 'Auto',
          label: 'AnimeAV1 VOE ' + (v.h ? (v.h + 'p') : 'Auto'),
          type: 'hls', container: 'hls', hls: true,
          headers: hdrs, kind: category, audio: category,
          audioLang: category === 'dub' ? 'es' : 'ja', subtitles: [], isActive: false });
      }
      out[0].isActive = true;
      return out;
    })
    .catch(function () { return [autoEntry('hls')]; });
}
function _resolveYourUpload(url, category) {
  return _get(url, SITE + '/').then(function (html) {
    var media = _ogVideo(html);
    if (!media) return null;
    return {
      url: media, quality: 'Auto', label: 'AnimeAV1 YourUpload',
      type: 'mp4', container: 'mp4',
      headers: { 'User-Agent': UA, 'Referer': 'https://www.yourupload.com/' },
      kind: category, audio: category,
      audioLang: category === 'dub' ? 'es' : 'ja',
      subtitles: [], isActive: true
    };
  }).catch(function () { return null; });
}
function _resolveEmbeds(embeds, category) {
  var jobs = [];
  embeds.forEach(function (embed) {
    var server = embed.server.trim().toLowerCase();
    if (server === 'voe') jobs.push(_resolveVoe(embed.url, category));
    else if (server === 'yourupload') jobs.push(_resolveYourUpload(embed.url, category));
  });
  return Promise.all(jobs).then(function (rows) {
    var out = [], seen = {};
    rows.forEach(function (row) {
      var streams = Array.isArray(row) ? row : [row];
      streams.forEach(function (stream) {
        if (!stream || !stream.url || seen[stream.url]) return;
        seen[stream.url] = 1;
        out.push(stream);
      });
    });
    out.forEach(function (stream, index) { stream.isActive = index === 0; });
    return out;
  });
}
function getVideoSources(episodeUrl, opts) {
  var episode;
  try { episode = _parseEpisode(episodeUrl); }
  catch (e) { return Promise.resolve([]); }
  var path = 'media/' + encodeURIComponent(episode.slug) + '/' + episode.number;
  return _data(path).then(function (page) {
    var category = episode.category === 'dub' ? 'DUB' : 'SUB';
    var embeds = _embeds(page, category);
    if (!embeds.length && category === 'DUB') embeds = _embeds(page, 'SUB');
    if (!embeds.length) throw new Error('AnimeAV1 episode has no playable embeds');
    return _resolveEmbeds(embeds, episode.category);
  }).catch(function (error) {
    console.warn('AnimeAV1 playback failed:', String(error && error.message || error));
    return [];
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, popular: popular, search: search,
    getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks,
    _config: _config, _pageData: _pageData, _slug: _slug, _episodeNumbers: _episodeNumbers,
    _variants: _variants, _episodeItems: _episodeItems, _parseEpisode: _parseEpisode,
    _embeds: _embeds, _voeConfig: _voeConfig, _voeRedirect: _voeRedirect, _ogVideo: _ogVideo
  };
}
