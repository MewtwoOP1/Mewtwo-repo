// KayoAnime native provider for Zangetsu.
//
// KayoAnime is a WordPress download index, not a streaming site. Each post is a
// release page: a synopsis plus one or more Google Drive folder/file links that
// hold the actual MKV/MP4 episodes. Public Drive folders can be listed without
// authentication and their files can be streamed from Google's byte endpoint
// (drive.usercontent.google.com/download). Private "Google Group" drives return
// a Google sign-in page; this provider reports those as restricted and never
// tries to bypass Google authentication.
//
// Keep VERSION in sync with index.json whenever this source changes.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'kayoanime';
var VERSION = '1.0.0';
var SITE = 'https://kayoanime.com';
var REST = SITE + '/wp-json/wp/v2';
var DRIVE_FOLDER = 'https://drive.google.com/drive/folders/';
var DRIVE_DOWNLOAD = 'https://drive.usercontent.google.com/download';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
var CACHE = {};
var CACHE_TTL = 5 * 60 * 1000;
var FOLDER_TTL = 10 * 60 * 1000;
var REQUEST_TIMEOUT = 15000;
var MAX_DEPTH = 3;
var MAX_VARIANTS = 8;

// ── settings ────────────────────────────────────────────────────────────────
function getSettings() {
  return [
    {
      key: 'verifyPlayback',
      label: 'Verify Drive files before playback',
      description: 'Send a HEAD/Range request to Google Drive so expired, private, or HTML sign-in pages are never offered as playable streams.',
      type: 'bool',
      default: true
    },
    {
      key: 'maxFiles',
      label: 'Maximum files per title',
      description: 'Upper bound on Google Drive files listed for one post. Large season collections may need a higher value.',
      type: 'enum',
      default: '300',
      options: [
        { value: '100', label: '100 files' },
        { value: '300', label: '300 files' },
        { value: '600', label: '600 files' },
        { value: '1000', label: '1000 files' }
      ]
    },
    {
      key: 'preferredAudio',
      label: 'Preferred audio',
      description: 'Order matching audio variants first. KayoAnime releases are usually English subbed, dual audio, or dubbed.',
      type: 'enum',
      default: 'any',
      options: [
        { value: 'any', label: 'Any audio' },
        { value: 'dual', label: 'Dual audio first' },
        { value: 'sub', label: 'Sub first' },
        { value: 'dub', label: 'Dub first' }
      ]
    }
  ];
}

function _config() {
  var all = (typeof __settings !== 'undefined' && __settings) ? __settings : {};
  var c = all && all[SOURCE_ID] ? all[SOURCE_ID] : {};
  var maxFiles = parseInt(c.maxFiles, 10);
  if (!isFinite(maxFiles) || maxFiles < 1) maxFiles = 300;
  if (maxFiles > 1000) maxFiles = 1000;
  var preferred = String(c.preferredAudio || 'any').toLowerCase();
  if (['any', 'dual', 'sub', 'dub'].indexOf(preferred) === -1) preferred = 'any';
  return {
    verify: c.verifyPlayback !== false && String(c.verifyPlayback) !== 'false',
    maxFiles: maxFiles,
    preferredAudio: preferred
  };
}

function getInfo() {
  return {
    name: 'KayoAnime',
    lang: 'en',
    baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=kayoanime.com',
    type: 'anime',
    version: VERSION
  };
}

// ── small utilities ─────────────────────────────────────────────────────────
function _extend(base, extra) {
  var out = {};
  var k;
  for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
  for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
  return out;
}

function _raceTimeout(promise, ms, fallback) {
  if (typeof setTimeout !== 'function' || typeof Promise === 'undefined' || !Promise.race) return promise;
  if (promise && typeof promise.catch === 'function') promise.catch(function () {});
  var timer = null;
  var timeout = new Promise(function (resolve) {
    timer = setTimeout(function () { resolve(fallback); }, ms);
  });
  return Promise.race([promise, timeout]).then(function (value) {
    if (timer && typeof clearTimeout === 'function') clearTimeout(timer);
    return value;
  });
}

function _request(url, opts) {
  var options = opts || {};
  var headers = _extend({
    'User-Agent': UA,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9'
  }, options.headers || {});
  var init = {
    method: options.method || 'GET',
    headers: headers,
    redirect: 'follow',
    timeoutMs: options.timeoutMs || REQUEST_TIMEOUT
  };
  if (options.body != null) init.body = options.body;
  return _raceTimeout(fetch(url, init), init.timeoutMs, null).then(function (response) {
    if (!response) throw new Error('KayoAnime: request timed out');
    var status = Number(response.status || 200);
    if (status >= 400 && !options.allowError) {
      var error = new Error('KayoAnime HTTP ' + status + ' for ' + url);
      error.status = status;
      throw error;
    }
    return response;
  });
}

function _responseText(response) {
  if (!response) return Promise.resolve('');
  if (typeof response.text === 'function') return Promise.resolve(response.text());
  if (typeof response.body === 'string') return Promise.resolve(response.body);
  return Promise.resolve(String(response.body || ''));
}

function _text(url, opts) {
  return _request(url, opts).then(_responseText);
}

function _json(url, opts) {
  return _text(url, opts).then(function (body) {
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error('KayoAnime: invalid JSON response from ' + url);
    }
  });
}

function _unescape(value) {
  var s = String(value == null ? '' : value);
  s = s.replace(/&#x([0-9a-f]+);/gi, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); });
  s = s.replace(/&#(\d+);/g, function (_, num) { return String.fromCharCode(Number(num)); });
  s = s.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&#0*39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
  return s;
}

function _clean(html) {
  var s = String(html == null ? '' : html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = _unescape(s);
  return s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function _oneLine(value) {
  return _clean(value).replace(/\s+/g, ' ').trim();
}

function _absolute(href) {
  var h = _unescape(String(href == null ? '' : href)).trim();
  if (!h) return '';
  if (/^https?:\/\//i.test(h)) return h;
  if (h.charAt(0) === '/') return SITE + h;
  return SITE + '/' + h.replace(/^\.?\//, '');
}

function _cacheGet(key) {
  var row = CACHE[key];
  if (!row) return null;
  if (Date.now() > row.at) {
    delete CACHE[key];
    return null;
  }
  return row.value;
}

function _cacheSet(key, value, ttl) {
  CACHE[key] = { at: Date.now() + (ttl || CACHE_TTL), value: value };
  return value;
}

function _mapLimit(items, limit, fn) {
  var results = new Array(items.length);
  var next = 0;
  var width = Math.max(1, Math.min(limit || 1, items.length || 1));
  function worker() {
    if (next >= items.length) return Promise.resolve();
    var index = next++;
    return Promise.resolve().then(function () { return fn(items[index], index); }).then(function (value) {
      results[index] = value;
      return worker();
    }, function () {
      results[index] = null;
      return worker();
    });
  }
  var workers = [];
  for (var i = 0; i < width; i++) workers.push(worker());
  return Promise.all(workers).then(function () { return results; });
}

// ── WordPress REST / post helpers ───────────────────────────────────────────
var LIST_FIELDS = 'id,date,link,title,excerpt,categories,_links,_embedded';
var FIELDS = LIST_FIELDS.replace('categories', 'content,categories');

function _refFromUrl(value) {
  var raw = String(value == null ? '' : value).trim();
  var media = raw.match(/^kayoanime:\/\/media\/(.+)$/i);
  if (media) {
    try { raw = decodeURIComponent(media[1]); } catch (error) { raw = media[1]; }
  }
  if (/^\d+$/.test(raw)) return { id: raw, slug: '', url: SITE + '/?p=' + raw };
  var idMatch = raw.match(/[?&]p=(\d+)/i);
  var slugMatch = raw.match(/kayoanime\.com\/([^/?#]+)\/?/i);
  return {
    id: idMatch ? idMatch[1] : '',
    slug: slugMatch ? slugMatch[1] : (raw && raw.indexOf('/') === -1 ? raw : ''),
    url: /^https?:\/\//i.test(raw) ? raw : (raw ? SITE + '/' + raw.replace(/^\/+/, '') : SITE)
  };
}

function _featured(post) {
  var media = post && post._embedded && post._embedded['wp:featuredmedia'];
  if (!Array.isArray(media) || !media.length) return null;
  var row = media[0] || {};
  if (row.source_url) return String(row.source_url);
  var sizes = row.media_details && row.media_details.sizes;
  if (sizes) {
    var order = ['medium', 'medium_large', 'large', 'full', 'thumbnail'];
    for (var i = 0; i < order.length; i++) {
      if (sizes[order[i]] && sizes[order[i]].source_url) return String(sizes[order[i]].source_url);
    }
  }
  return null;
}

function _categoryNames(post) {
  var names = [];
  var terms = post && post._embedded && post._embedded['wp:term'];
  if (Array.isArray(terms)) {
    terms.forEach(function (group) {
      if (!Array.isArray(group)) return;
      group.forEach(function (term) {
        if (term && term.taxonomy === 'category' && term.name) names.push(_unescape(term.name));
      });
    });
  }
  return names;
}

function _hasCategory(post, id) {
  return !!(post && Array.isArray(post.categories) && post.categories.indexOf(id) !== -1);
}

function _yearFromDate(value) {
  var match = String(value || '').match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function _yearFromTitle(title) {
  var match = String(title || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function _yearFromText(value) {
  var match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function _card(post) {
  if (!post || !post.link) return null;
  var title = _oneLine(post.title && post.title.rendered);
  if (!title) return null;
  var isSeries = _hasCategory(post, 4);
  var isMovie = !isSeries && (_hasCategory(post, 2) || /^movie\b/i.test(title));
  var status = _hasCategory(post, 3) ? 'ongoing' : 'unknown';
  return {
    id: String(post.id || post.link),
    title: title,
    url: 'kayoanime://media/' + encodeURIComponent(post.link),
    cover: _featured(post),
    type: isMovie ? 'movie' : 'anime',
    sourceId: SOURCE_ID,
    year: _yearFromTitle(title),
    status: status
  };
}

function _restPost(ref) {
  if (!ref || (!ref.id && !ref.slug)) {
    return Promise.reject(new Error('KayoAnime: a post id, slug, or URL is required'));
  }
  var url;
  if (ref.id) {
    url = REST + '/posts/' + encodeURIComponent(ref.id) + '?_embed=1&_fields=' + FIELDS;
  } else {
    url = REST + '/posts?slug=' + encodeURIComponent(ref.slug) + '&_embed=1&_fields=' + FIELDS;
  }
  return _json(url).then(function (data) {
    var post = Array.isArray(data) ? data[0] : data;
    if (!post || !post.id) throw new Error('KayoAnime: post not found');
    return post;
  });
}

function _htmlPost(ref) {
  var url = (ref && ref.url) || SITE;
  return _text(url).then(function (html) {
    var title = _oneLine((html.match(/<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
      (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '');
    var cover = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1] ||
      (html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) || [])[1] || '';
    var description = (html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
    var start = html.search(/<div[^>]+class="[^"]*entry-content[^"]*"/i);
    var content = '';
    if (start >= 0) {
      var end = html.indexOf('</article>', start);
      if (end < 0) end = html.indexOf('<footer', start);
      if (end < 0) end = Math.min(html.length, start + 40000);
      content = html.slice(start, end);
    }
    var link = (ref && ref.url) || SITE;
    return {
      id: ref && ref.id ? ref.id : link,
      link: link,
      date: '',
      categories: [],
      title: { rendered: title },
      excerpt: { rendered: description },
      content: { rendered: content },
      _embedded: {}
    };
  });
}

// ── metadata parsing ────────────────────────────────────────────────────────
var INFO_LABELS = ['Type', 'Episodes', 'Status', 'Aired', 'Premiered', 'Producers', 'Licensors',
  'Studios', 'Source', 'Genres', 'Duration', 'Rating', 'Synonyms', 'Japanese', 'English',
  'Score', 'Ranked', 'Popularity', 'Members', 'Favorites'];

function _field(text, label) {
  var source = String(text || '');
  var pattern = '(?:^|\\n|\\s)' + label + '\\s*:\\s*([\\s\\S]*?)(?=\\s+(?:' + INFO_LABELS.join('|') + ')\\s*:|\\n|$)';
  var match = source.match(new RegExp(pattern, 'i'));
  if (match) return _oneLine(match[1]);
  var lines = source.split(/\n+/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].match(new RegExp('^\\s*' + label + '\\s*:\\s*(.*)$', 'i'));
    if (line) return _oneLine(line[1]);
  }
  return '';
}

function _seriesTitle(raw) {
  var title = _oneLine(raw);
  title = title.replace(/\s*\|\s*Episode\s*\d+[\s\S]*$/i, '');
  title = title.replace(/\s+Episode\s*\d+[\s\S]*$/i, '');
  title = title.replace(/\s+(?:2160p|1440p|1080p|720p|480p|360p|4k)\b[\s\S]*$/i, '');
  title = title.replace(/\s+(?:Dual[\s-]?Audio|Multi[\s-]?Audio|Eng(?:lish)?[\s-]?Sub(?:bed)?|HEVC|H\.?265|x265|H\.?264|x264|AVC|Bluray|Blu-ray|WEB-DL|WEBRip)\b[\s\S]*$/i, '');
  return title.trim() || _oneLine(raw);
}

function _quality(text) {
  var match = String(text || '').match(/\b(2160p|1440p|1080p|720p|480p|360p)\b/i);
  if (match) return match[1].toLowerCase();
  if (/\b4k\b/i.test(text)) return '2160p';
  return '';
}

function _encoding(text) {
  if (/\bHEVC\b|\bH\.?265\b|\bx265\b/i.test(text)) return 'HEVC';
  if (/\bAV1\b/i.test(text)) return 'AV1';
  if (/\bH\.?264\b|\bx264\b|\bAVC\b/i.test(text)) return 'H.264';
  if (/\b10[\s-]?bit\b/i.test(text)) return '10-bit';
  return '';
}

function _audio(text) {
  if (/\bdual[\s-]?audio\b/i.test(text)) return 'Dual Audio';
  if (/\bmulti[\s-]?audio\b/i.test(text)) return 'Multi Audio';
  if (/\b(?:eng(?:lish)?[\s-]?sub(?:bed)?|subbed)\b/i.test(text)) return 'English Subbed';
  if (/\bdub(?:bed)?\b/i.test(text)) return 'Dub';
  return '';
}

function _meta(content, post, categories) {
  var text = _clean(content);
  var typeAt = text.search(/\bType\s*:\s*(?:TV|Movie|OVA|ONA|Special|TV Special|Music)\b/i);
  var info = typeAt >= 0 ? text.slice(typeAt) : text;
  var synopsis = (typeAt >= 0 ? text.slice(0, typeAt) : text).replace(/\s+/g, ' ').trim();
  if (synopsis.length > 1600) synopsis = synopsis.slice(0, 1597) + '...';
  var title = _seriesTitle(post && post.title && post.title.rendered);
  var metaType = _field(info, 'Type');
  var premiered = _field(info, 'Premiered');
  var aired = _field(info, 'Aired');
  var genres = _field(info, 'Genres').split(',').map(function (item) { return _oneLine(item); }).filter(Boolean);
  var categoryGenres = (categories || []).filter(function (name) {
    return ['Anime Movie', 'Anime Series', 'Ongoing Anime', 'Chinese Anime', 'Uncategorized'].indexOf(name) === -1;
  });
  var seenGenres = {};
  var allGenres = [];
  genres.concat(categoryGenres).forEach(function (name) {
    var key = name.toLowerCase();
    if (!seenGenres[key]) { seenGenres[key] = 1; allGenres.push(name); }
  });
  var altTitles = [];
  ['Synonyms', 'Japanese', 'English'].forEach(function (label) {
    var value = _field(info, label);
    if (!value) return;
    value.split(',').forEach(function (part) {
      var item = _oneLine(part);
      if (item && item.toLowerCase() !== title.toLowerCase() && altTitles.indexOf(item) === -1) altTitles.push(item);
    });
  });
  var rawTitle = _oneLine(post && post.title && post.title.rendered);
  var searchText = rawTitle + ' ' + info;
  var isMovie = /^movie\b/i.test(metaType) || /^movie\b/i.test(rawTitle) ||
    (_hasCategory(post, 2) && !/^tv\b/i.test(metaType));
  var status = _field(info, 'Status') || (_hasCategory(post, 3) ? 'ongoing' : 'unknown');
  var description = synopsis;
  if (!description && post && post.excerpt) description = _oneLine(post.excerpt.rendered);
  var episodesText = _field(info, 'Episodes');
  if (episodesText && !/^(?:\d+\+?|unknown)$/i.test(episodesText)) episodesText = '';
  return {
    title: title,
    rawTitle: rawTitle,
    description: description,
    genres: allGenres,
    altTitles: altTitles,
    studios: _field(info, 'Studios').split(',').map(function (item) { return _oneLine(item); }).filter(Boolean),
    status: status,
    year: _yearFromText(premiered) || _yearFromText(aired) || _yearFromDate(post && post.date),
    type: metaType,
    isMovie: isMovie,
    audio: _audio(searchText),
    resolution: _quality(searchText),
    encoding: _encoding(searchText),
    episodesText: episodesText,
    duration: _field(info, 'Duration'),
    rating: _field(info, 'Rating')
  };
}

// ── download-link discovery ─────────────────────────────────────────────────
function _driveFolderId(url) {
  var match = String(url || '').match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})/i);
  return match ? match[1] : '';
}

function _driveFileId(url) {
  var value = String(url || '');
  var match = value.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})/i) ||
    value.match(/drive\.google\.com\/open\?(?:[^#]*&)?id=([A-Za-z0-9_-]{10,})/i) ||
    value.match(/drive\.google\.com\/uc\?(?:[^#]*&)?id=([A-Za-z0-9_-]{10,})/i);
  return match ? match[1] : '';
}

function _downloadLinks(content) {
  var html = String(content || '');
  var rows = [];
  var seen = {};
  var linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  var match;
  while ((match = linkRe.exec(html)) !== null) {
    var attrs = match[1] || '';
    var href = (attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    href = _unescape(href).trim();
    if (!href || href.charAt(0) === '#' || /^(?:javascript|mailto):/i.test(href)) continue;
    if (/facebook\.com\/sharer|x\.com\/intent|twitter\.com\/intent|pinterest\.com\/pin|reddit\.com\/submit|kayoanime\.com\/author|^https?:\/\/kayoanime\.com\/?$/i.test(href)) continue;
    if (/kayoanime\.com\//i.test(href) && !_driveFolderId(href) && !_driveFileId(href)) continue;
    var label = _oneLine(match[2]) || 'Download';
    var privateHint = /\bprivate\b|\bdrivate\b/i.test(label);
    var folderId = _driveFolderId(href);
    var fileId = folderId ? '' : _driveFileId(href);
    var kind = folderId ? 'folder' : (fileId ? 'file' : '');
    if (!kind && (/groups\.google\.com\//i.test(href) || /google\s*group/i.test(label))) kind = 'group';
    if (!kind && /\.(?:mkv|mp4|webm|avi|m4v|mov|ts|m2ts)(?:[?#]|$)/i.test(href)) kind = 'direct';
    if (!kind && /mega\.nz|mediafire\.com|pixeldrain\.com|gofile\.io|1fichier\.com|dropbox\.com|gdflix|filepress|hubcloud/i.test(href)) kind = 'external';
    if (!kind) continue;
    var key = kind + '|' + (folderId || fileId || href);
    if (seen[key]) continue;
    seen[key] = 1;
    rows.push({
      kind: kind,
      id: folderId || fileId || '',
      url: href,
      label: label,
      privateHint: privateHint
    });
  }
  return rows;
}

// ── Google Drive listing ────────────────────────────────────────────────────
function _jsUnescape(value) {
  return String(value || '')
    .replace(/\\x([0-9a-fA-F]{2})/g, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/\\u([0-9a-fA-F]{4})/g, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/\\\//g, '/')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    // Google's Drive dump escapes non-JSON characters such as "=" with a
    // backslash. Drop only escapes JSON does not define so JSON.parse accepts it.
    .replace(/\\([^"\\\/bfnrtu])/g, '$1');
}

function _driveEntries(html) {
  var match = String(html || '').match(/_DRIVE_ivd'\]\s*=\s*'((?:[^'\\]|\\.)*)'/);
  if (!match) return null;
  var data;
  try {
    data = JSON.parse(_jsUnescape(match[1]));
  } catch (error) {
    return null;
  }
  var rows = data && data[0];
  if (!Array.isArray(rows)) return null;
  var out = [];
  rows.forEach(function (row) {
    if (!Array.isArray(row) || !row[0]) return;
    out.push({
      id: String(row[0]),
      name: String(row[2] || ''),
      mime: String(row[3] || ''),
      size: Number(row[13]) || 0
    });
  });
  return out;
}

function _driveDomEntries(html) {
  var out = [];
  var re = /aria-label="([^"]+)"[^>]*ssk=\\?['"]([^'"]+)[\\'"]/gi;
  var match;
  while ((match = re.exec(String(html || ''))) !== null) {
    var name = _unescape(match[1]);
    var idMatch = match[2].match(/:([A-Za-z0-9_-]{20,})-0-16/);
    if (!idMatch) continue;
    var isFolder = !/\.[a-z0-9]{2,5}$/i.test(name);
    out.push({
      id: idMatch[1],
      name: name,
      mime: isFolder ? 'application/vnd.google-apps.folder' : 'video/x-matroska',
      size: 0
    });
  }
  return out;
}

function _isVideo(name) {
  return /\.(?:mkv|mp4|webm|avi|m4v|mov|ts|m2ts)(?:$|\s)/i.test(String(name || ''));
}

function _isArchive(name) {
  return /\.(?:zip|rar|7z|tar|gz)(?:$|\s)/i.test(String(name || ''));
}

function _isExtra(name) {
  var value = String(name || '');
  if (/\b(?:nced|ncop|creditless|trailer|preview|sample|menu|interview)\b/i.test(value)) return true;
  if (/\b(?:opening|ending)\b/i.test(value) && !_episodeFrom(value)) return true;
  return false;
}

function _folderTitle(html) {
  var title = (String(html || '').match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
  return _oneLine(title).replace(/\s*[–-]\s*Google Drive\s*$/i, '').trim();
}

function _restrictedFolderError() {
  var error = new Error('KayoAnime: this Google Drive folder is private or access-restricted. Join the linked Google Group (if any) to access it.');
  error.restricted = true;
  return error;
}

function _listFolder(id, depth, cfg, seen) {
  var cacheKey = 'folder:' + id;
  var cached = _cacheGet(cacheKey);
  if (cached) return Promise.resolve(cached);
  if (!id) return Promise.reject(new Error('KayoAnime: missing Google Drive folder id'));
  var visited = seen || {};
  if (visited[id]) return Promise.resolve({ rootName: '', files: [], folders: [], archives: [], extras: [], restricted: false });
  visited[id] = 1;
  return _text(DRIVE_FOLDER + encodeURIComponent(id)).then(function (html) {
    var title = _folderTitle(html);
    var entries = _driveEntries(html);
    if (!entries) {
      if (/Google Drive:\s*Sign-in|You need access|Request access|accounts\.google\.com\/ServiceLogin/i.test(html)) {
        throw _restrictedFolderError();
      }
      entries = _driveDomEntries(html);
      if (!entries.length) throw new Error('KayoAnime: could not read Google Drive folder ' + id);
    }
    var files = [];
    var folders = [];
    var archives = [];
    var extras = [];
    entries.forEach(function (entry) {
      if (entry.mime === 'application/vnd.google-apps.folder') {
        folders.push(entry);
      } else if (_isVideo(entry.name)) {
        if (_isExtra(entry.name)) extras.push(entry);
        else files.push(entry);
      } else if (_isArchive(entry.name)) {
        archives.push(entry);
      }
    });
    if (!folders.length || depth >= MAX_DEPTH || files.length >= cfg.maxFiles) {
      var notes = [];
      if (folders.length && depth >= MAX_DEPTH) notes.push({ name: title, error: 'subfolders were not expanded because the depth limit was reached' });
      if (files.length >= cfg.maxFiles) notes.push({ name: title, error: 'the file limit was reached; some files were omitted' });
      var result = { rootName: title, files: files.slice(0, cfg.maxFiles), folders: folders, archives: archives, extras: extras, restricted: false, notes: notes };
      _cacheSet(cacheKey, result, FOLDER_TTL);
      return result;
    }
    var jobs = folders.slice(0, 12).map(function (folder) {
      return _listFolder(folder.id, depth + 1, cfg, visited).then(function (sub) {
        sub.files.forEach(function (file) { file.parentName = sub.rootName || folder.name; });
        return sub;
      }).catch(function (error) {
        return { files: [], archives: [], extras: [], restricted: !!error.restricted, notes: [], error: error, rootName: folder.name };
      });
    });
    return Promise.all(jobs).then(function (subs) {
      var notes = [];
      subs.forEach(function (sub) {
        files = files.concat(sub.files || []);
        archives = archives.concat(sub.archives || []);
        extras = extras.concat(sub.extras || []);
        if (sub.restricted) notes.push({ name: sub.rootName || 'subfolder', restricted: true });
        if (sub.error && !sub.restricted) notes.push({ name: sub.rootName || 'subfolder', error: String(sub.error.message || sub.error) });
        if (sub.notes) notes = notes.concat(sub.notes);
      });
      var result = { rootName: title, files: files.slice(0, cfg.maxFiles), folders: folders, archives: archives, extras: extras, restricted: false, notes: notes };
      _cacheSet(cacheKey, result, FOLDER_TTL);
      return result;
    });
  });
}

// ── episode construction ────────────────────────────────────────────────────
function _seasonFrom(text, fallback) {
  var value = String(text || '');
  var match = value.match(/\bS(\d{1,2})\s*E\d{1,4}\b/i) ||
    value.match(/\bSeason\s*(\d{1,2})\b/i) ||
    value.match(/\bS(\d{1,2})\b/i) ||
    value.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+Season\b/i);
  if (match && Number(match[1]) > 0) return Number(match[1]);
  return fallback == null ? 1 : fallback;
}

function _episodeFrom(text) {
  var value = String(text || '');
  var match = value.match(/\bS\d{1,2}\s*E(\d{1,4})\b/i) ||
    value.match(/\bEpisode\s*(\d{1,4})\b/i) ||
    value.match(/\bE(?:p(?:isode)?)?\s*[-_. ]?(\d{1,4})\b/i) ||
    value.match(/\s-\s*(\d{1,4})(?:\s|$|\[)/) ||
    value.match(/\[(\d{1,4})\]/);
  return match ? Number(match[1]) : null;
}

function _movieNumber(text) {
  var match = String(text || '').match(/\b(?:movie|film)\s*[-_. ]?(\d{1,2})\b/i);
  return match ? Number(match[1]) : null;
}

function _fileInfo(name, postTitle, label, folderName) {
  var context = [name, label, folderName, postTitle].filter(Boolean).join(' ');
  return {
    season: _seasonFrom(name, _seasonFrom(folderName, _seasonFrom(postTitle, 1))),
    episode: _episodeFrom(name) || _episodeFrom(label) || null,
    quality: _quality(context),
    encoding: _encoding(context),
    audio: _audio(context)
  };
}

function _qualityRank(quality) {
  var number = parseInt(String(quality || '').replace(/[^\d]/g, ''), 10);
  return isFinite(number) ? number : 0;
}

function _baseName(name) {
  return _oneLine(String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_.]+/g, ' '));
}

function _movieTitle(name) {
  var value = _baseName(name);
  // Remove release tags while keeping the actual title (including any title
  // that the uploader put inside brackets).
  value = value.replace(/\[\s*(?:kayoanime|kayo|1080p|720p|480p|2160p|4k|hevc|x265|h\.?264|x264|av1|10[\s-]?bit|dual[\s-]?audio|multi[\s-]?audio|eng(?:lish)?[\s-]?sub(?:bed)?|subbed|dub(?:bed)?|bluray|blu-ray|web-dl|webrip|bdrip|aac|flac)\s*\]/gi, ' ');
  value = value.replace(/[\[\]]+/g, ' ');
  value = value.replace(/\b(?:1080p|720p|480p|2160p|4k|hevc|x265|h\.?264|x264|av1|10[\s-]?bit|dual[\s-]?audio|multi[\s-]?audio|eng(?:lish)?[\s-]?sub(?:bed)?|subbed|dub(?:bed)?|bluray|blu-ray|web-dl|webrip|bdrip)\b/gi, ' ');
  value = value.replace(/\s*[-–—]\s*/g, ' ');
  return _oneLine(value);
}

function _episodeTitle(file, episode, multiple) {
  var name = String(file && file.name || '');
  if (/\bmovie\b|\bfilm\b/i.test(name)) {
    return multiple ? (_movieTitle(name) || ('Movie ' + episode)) : 'Movie';
  }
  if (/\bova\b/i.test(name)) return 'OVA' + (episode > 1 ? ' ' + episode : '');
  if (/\bspecial\b|\bsp\b/i.test(name)) return 'Special' + (episode > 1 ? ' ' + episode : '');
  if (file && file.isMovie) return multiple ? (_movieTitle(name) || ('Movie ' + episode)) : 'Movie';
  return 'Episode ' + episode;
}

function _episodeUrl(postId, season, episode, variants) {
  var payload = variants.map(function (variant) {
    var row = { n: variant.name || '', s: variant.size || 0, q: variant.quality || '', e: variant.encoding || '', a: variant.audio || '' };
    if (variant.id) row.i = variant.id;
    if (variant.url) row.u = variant.url;
    return row;
  });
  return 'kayoanime://episode/' + encodeURIComponent(String(postId || '')) + '/' + season + '/' + episode +
    '?v=' + encodeURIComponent(JSON.stringify(payload));
}

function _parseEpisodeUrl(value) {
  var raw = String(value == null ? '' : value).trim();
  var match = raw.match(/^kayoanime:\/\/episode\/([^/]+)\/(\d+)\/(\d+)(?:\?v=([\s\S]*))?$/i);
  if (match) {
    var variants = [];
    if (match[4]) {
      try {
        variants = JSON.parse(decodeURIComponent(match[4]));
      } catch (error) {
        variants = [];
      }
    }
    return {
      postId: decodeURIComponent(match[1]),
      season: Number(match[2]),
      episode: Number(match[3]),
      variants: Array.isArray(variants) ? variants : []
    };
  }
  var file = raw.match(/^kayoanime:\/\/file\/([A-Za-z0-9_-]+)(?:\?(.*))?$/i);
  if (file) {
    var name = '';
    var query = file[2] || '';
    var nameMatch = query.match(/(?:^|&)name=([^&]*)/i);
    if (nameMatch) {
      try { name = decodeURIComponent(nameMatch[1]); } catch (error) { name = nameMatch[1]; }
    }
    return { postId: '', season: 1, episode: 1, variants: [{ i: file[1], n: name }] };
  }
  var drive = _driveFileId(raw);
  if (drive) return { postId: '', season: 1, episode: 1, variants: [{ i: drive, n: '' }] };
  if (/\.(?:mkv|mp4|webm|avi|m4v|mov|ts|m2ts)(?:[?#]|$)/i.test(raw)) {
    return { postId: '', season: 1, episode: 1, variants: [{ u: raw, n: raw.split('/').pop().split('?')[0] }] };
  }
  return null;
}

function _groupEpisodes(files, cfg) {
  var groups = {};
  files.forEach(function (file, index) {
    var season = file.season || 1;
    var episode = file.episode;
    if (!(episode > 0)) episode = index + 1;
    var key = season + '|' + episode;
    if (!groups[key]) groups[key] = { season: season, episode: episode, files: [] };
    groups[key].files.push(file);
  });
  var preferred = cfg && cfg.preferredAudio ? cfg.preferredAudio : 'any';
  var rows = [];
  Object.keys(groups).forEach(function (key) {
    var group = groups[key];
    var variants = group.files.slice().sort(function (a, b) {
      var audioA = _audioRank(a.audio, preferred);
      var audioB = _audioRank(b.audio, preferred);
      if (audioA !== audioB) return audioA - audioB;
      return _qualityRank(b.quality) - _qualityRank(a.quality) || String(a.name).localeCompare(String(b.name));
    }).slice(0, MAX_VARIANTS);
    var first = variants[0];
    var url = _episodeUrl(first.postId, group.season, group.episode, variants);
    rows.push({
      id: url,
      url: url,
      number: group.episode,
      season: group.season,
      title: _episodeTitle(first, group.episode, group.files.length > 1),
      category: first.audio === 'Dub' ? 'dub' : 'sub',
      type: 'anime',
      sourceId: SOURCE_ID,
      quality: first.quality || '',
      encoding: first.encoding || '',
      audio: first.audio || ''
    });
  });
  rows.sort(function (a, b) { return (a.season - b.season) || (a.number - b.number); });
  return rows;
}

function _audioRank(audio, preferred) {
  var value = String(audio || '').toLowerCase();
  if (preferred === 'dual') return /dual|multi/.test(value) ? 0 : 1;
  if (preferred === 'dub') return /dub/.test(value) ? 0 : 1;
  if (preferred === 'sub') return /dual|multi|sub/.test(value) ? 0 : 1;
  return 0;
}

function _folderEpisodeFiles(link, post, meta, cfg) {
  return _listFolder(link.id, 0, cfg, {}).then(function (folder) {
    var rows = folder.files || [];
    var single = rows.length === 1;
    var postEpisode = single ? _episodeFrom(meta.rawTitle) : null;
    var files = rows.map(function (file) {
      var info = _fileInfo(file.name, meta.rawTitle, link.label, folder.rootName);
      var episode = info.episode || postEpisode;
      if (!episode && meta.isMovie) episode = _movieNumber(file.name) || 1;
      return {
        id: file.id,
        name: file.name,
        size: file.size,
        mime: file.mime,
        season: info.season,
        episode: episode,
        quality: info.quality,
        encoding: info.encoding,
        audio: info.audio,
        isMovie: !!meta.isMovie,
        label: link.label,
        folder: file.parentName || folder.rootName || link.label,
        postId: post.id,
        postLink: post.link
      };
    });
    return {
      files: files,
      restricted: [],
      missing: [],
      external: [],
      archives: folder.archives || [],
      extras: folder.extras || [],
      notes: folder.notes || []
    };
  });
}

function _driveDownloadUrl(id) {
  return DRIVE_DOWNLOAD + '?id=' + encodeURIComponent(id) + '&export=download&confirm=t';
}

function _dispositionName(value) {
  var match = String(value || '').match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (!match) return '';
  var name = match[1].replace(/^"|"$/g, '');
  try { return decodeURIComponent(name); } catch (error) { return name; }
}

function _header(response, name) {
  var headers = response && response.headers;
  if (!headers) return '';
  if (typeof headers.get === 'function') {
    try { return String(headers.get(name) || ''); } catch (error) { return ''; }
  }
  var wanted = String(name).toLowerCase();
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === wanted) return String(headers[keys[i]] || '');
  }
  return '';
}

function _rangeTotal(value) {
  var match = String(value || '').match(/\/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}

function _restrictedFileError() {
  var error = new Error('KayoAnime: this Google Drive file is private or access-restricted. Join the linked Google Group (if any) and use the official KayoAnime page.');
  error.restricted = true;
  return error;
}

function _resolveConfirmation(html, id) {
  var action = (String(html || '').match(/<form[^>]+action="([^"]+)"/i) || [])[1] || '';
  if (!action) return '';
  action = _unescape(action);
  if (action.charAt(0) === '/') action = 'https://drive.usercontent.google.com' + action;
  var inputs = {};
  var re = /<input[^>]+name="([^"]+)"[^>]*value="([^"]*)"/gi;
  var match;
  while ((match = re.exec(html)) !== null) inputs[match[1]] = _unescape(match[2]);
  if (!inputs.id) inputs.id = id;
  var query = Object.keys(inputs).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(inputs[key]);
  }).join('&');
  return action + (action.indexOf('?') === -1 ? '?' : '&') + query;
}

function _probeDrive(url, id) {
  function inspect(response) {
    var status = Number(response && response.status || 200);
    var type = _header(response, 'content-type');
    var length = _header(response, 'content-length');
    var range = _header(response, 'content-range');
    var disposition = _header(response, 'content-disposition');
    if (status === 401 || status === 403) throw _restrictedFileError();
    if (status === 404) {
      var missing = new Error('KayoAnime: this Google Drive file is no longer available.');
      missing.status = 404;
      throw missing;
    }
    if (/text\/html/i.test(type)) return { html: true, response: response };
    if ((status === 200 || status === 206) && (Number(length) > 0 || range)) {
      // A 206 response reports the size of the requested range in
      // content-length and the real file size after the slash in
      // content-range. Prefer the total so the UI does not show 2 bytes.
      var total = _rangeTotal(range);
      return { ok: true, name: _dispositionName(disposition), size: total || Number(length) || 0 };
    }
    return { html: false, response: response };
  }

  function rangeGet(target) {
    return _request(target, { method: 'GET', headers: { Range: 'bytes=0-1' }, timeoutMs: REQUEST_TIMEOUT, allowError: true }).then(inspect);
  }

  return _request(url, { method: 'HEAD', timeoutMs: REQUEST_TIMEOUT, allowError: true }).then(function (response) {
    var head = inspect(response);
    if (head.ok) return head;
    return rangeGet(url).then(function (get) {
      if (get.ok) return get;
      if (get.html) {
        return _responseText(get.response).then(function (html) {
          var finalUrl = _resolveConfirmation(html, id);
          if (!finalUrl) throw _restrictedFileError();
          return rangeGet(finalUrl).then(function (final) {
            if (final.ok) {
              final.url = finalUrl;
              return final;
            }
            throw _restrictedFileError();
          });
        });
      }
      throw new Error('KayoAnime: Google Drive did not return media bytes');
    });
  }).catch(function (error) {
    if (error && error.status === 403) throw _restrictedFileError();
    if (error && error.status === 404) throw error;
    if (error && error.restricted) throw error;
    throw error;
  });
}

function _fileEpisode(link, post, meta, cfg) {
  var fallbackName = link.label || meta.rawTitle || 'Google Drive file';
  var fallbackInfo = _fileInfo(fallbackName, meta.rawTitle, link.label, '');
  var postEpisode = _episodeFrom(meta.rawTitle);
  function row(name, size, info) {
    var episode = info.episode || postEpisode;
    if (!episode && meta.isMovie) episode = _movieNumber(name) || 1;
    return {
      id: link.id,
      name: name,
      size: size || 0,
      mime: '',
      season: info.season,
      episode: episode,
      quality: info.quality,
      encoding: info.encoding,
      audio: info.audio,
      isMovie: !!meta.isMovie,
      label: link.label,
      folder: link.label,
      postId: post.id,
      postLink: post.link
    };
  }
  function archive(name) {
    return { files: [], restricted: [], missing: [], external: [], archives: [{ name: name }] };
  }
  if (!cfg.verify) {
    if (!_isVideo(fallbackName) && _isArchive(fallbackName)) return Promise.resolve(archive(fallbackName));
    return Promise.resolve({ files: [row(fallbackName, 0, fallbackInfo)], restricted: [], missing: [], external: [], archives: [] });
  }
  return _probeDrive(_driveDownloadUrl(link.id), link.id).then(function (probe) {
    var name = probe.name || fallbackName;
    if (name && !_isVideo(name)) return archive(name);
    return { files: [row(name, probe.size, _fileInfo(name, meta.rawTitle, link.label, ''))], restricted: [], missing: [], external: [], archives: [] };
  }).catch(function (error) {
    if (error && error.restricted) return { files: [], restricted: [link], missing: [], external: [], archives: [] };
    if (error && error.status === 404) return { files: [], missing: [link], external: [], archives: [] };
    if (_isArchive(fallbackName)) return archive(fallbackName);
    return { files: [row(fallbackName, 0, fallbackInfo)], restricted: [], missing: [], external: [], archives: [] };
  });
}

function _directEpisode(link, post, meta) {
  var name = link.label || link.url || 'Direct video';
  var info = _fileInfo(name, meta.rawTitle, link.label, '');
  var episode = info.episode || _episodeFrom(meta.rawTitle);
  if (!episode && meta.isMovie) episode = _movieNumber(name) || 1;
  return {
    files: [{
      url: link.url,
      name: name,
      size: 0,
      season: info.season,
      episode: episode,
      quality: info.quality,
      encoding: info.encoding,
      audio: info.audio,
      isMovie: !!meta.isMovie,
      label: link.label,
      folder: link.label,
      postId: post.id,
      postLink: post.link
    }],
    restricted: [],
    missing: [],
    external: [],
    archives: []
  };
}

function _episodesFromLinks(links, post, meta, cfg) {
  return _mapLimit(links, 3, function (link) {
    if (link.kind === 'folder') {
      return _folderEpisodeFiles(link, post, meta, cfg).catch(function (error) {
        if (error && error.restricted) return { files: [], restricted: [link], missing: [], external: [], archives: [] };
        if (error && error.status === 404) return { files: [], restricted: [], missing: [link], external: [], archives: [] };
        return { files: [], restricted: [], missing: [], external: [], archives: [], error: error };
      });
    }
    if (link.kind === 'file') return _fileEpisode(link, post, meta, cfg);
    if (link.kind === 'direct') return Promise.resolve(_directEpisode(link, post, meta));
    if (link.kind === 'external') return Promise.resolve({ files: [], restricted: [], missing: [], external: [link], archives: [] });
    return Promise.resolve({ files: [], restricted: [], missing: [], external: [], archives: [] });
  }).then(function (results) {
    var files = [];
    var restricted = [];
    var missing = [];
    var external = [];
    var archives = [];
    var extras = [];
    var notes = [];
    var errors = [];
    (results || []).forEach(function (result) {
      if (!result) return;
      files = files.concat(result.files || []);
      restricted = restricted.concat(result.restricted || []);
      missing = missing.concat(result.missing || []);
      external = external.concat(result.external || []);
      archives = archives.concat(result.archives || []);
      extras = extras.concat(result.extras || []);
      notes = notes.concat(result.notes || []);
      if (result.error) errors.push(result.error);
    });
    // The same Drive file can be linked from more than one folder. Keep one
    // variant per real file instead of duplicating identical streams.
    var seenFiles = {};
    files = files.filter(function (file) {
      var key = file.id ? 'id:' + file.id : (file.url ? 'url:' + file.url : '');
      if (key && seenFiles[key]) return false;
      if (key) seenFiles[key] = 1;
      return true;
    });
    return {
      episodes: _groupEpisodes(files, cfg),
      restricted: restricted,
      missing: missing,
      external: external,
      archives: archives,
      extras: extras,
      notes: notes,
      errors: errors
    };
  });
}

// ── public API ──────────────────────────────────────────────────────────────
function search(query, page, opts) {
  var text = String(query == null ? '' : query).trim();
  if (!text) return Promise.resolve([]);
  var number = Math.max(1, parseInt(page, 10) || 1);
  var cacheKey = 'search:' + text.toLowerCase() + ':' + number;
  var cached = _cacheGet(cacheKey);
  if (cached) return Promise.resolve(cached);
  var url = REST + '/posts?search=' + encodeURIComponent(text) + '&per_page=20&page=' + number +
    '&_embed=1&_fields=' + LIST_FIELDS;
  return _json(url).then(function (rows) {
    if (!Array.isArray(rows)) return [];
    var seen = {};
    return rows.map(_card).filter(function (card) {
      if (!card) return false;
      if (seen[card.id]) return false;
      seen[card.id] = 1;
      return true;
    });
  }).catch(function (error) {
    if (error && (error.status === 400 || error.status === 404)) return [];
    return _searchHtml(text, number);
  }).then(function (rows) {
    if (rows && rows.length) _cacheSet(cacheKey, rows, 2 * 60 * 1000);
    return rows || [];
  });
}

function _searchHtml(query, page) {
  var url = SITE + '/?s=' + encodeURIComponent(query) + (page > 1 ? '&paged=' + page : '');
  return _text(url).then(function (html) {
    var rows = [];
    var seen = {};
    var re = /<h2[^>]*class="[^"]*post-title[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = re.exec(html)) !== null) {
      var link = _absolute(match[1]);
      var title = _oneLine(match[2]);
      if (!link || !title || seen[link]) continue;
      seen[link] = 1;
      rows.push({
        id: link,
        title: title,
        url: 'kayoanime://media/' + encodeURIComponent(link),
        cover: null,
        type: /\bmovie\b/i.test(title) ? 'movie' : 'anime',
        sourceId: SOURCE_ID,
        year: _yearFromTitle(title),
        status: 'unknown'
      });
    }
    return rows;
  }).catch(function () { return []; });
}

function getHome(opts) {
  var cached = _cacheGet('home');
  if (cached) return Promise.resolve(cached);
  var sections = [
    { title: 'Latest Releases', query: '' },
    { title: 'Ongoing Anime', query: '&categories=3' },
    { title: 'Anime Movies', query: '&categories=2' },
    { title: 'Chinese Anime', query: '&categories=31' }
  ];
  return _mapLimit(sections, 3, function (section) {
    var url = REST + '/posts?per_page=12' + section.query + '&_embed=1&_fields=' + LIST_FIELDS;
    return _json(url).then(function (rows) {
      var items = (Array.isArray(rows) ? rows : []).map(_card).filter(Boolean);
      return items.length ? { title: section.title, items: items } : null;
    }).catch(function () { return null; });
  }).then(function (rows) {
    var out = (rows || []).filter(Boolean);
    // Do not cache a partial home page: a transient section failure should be
    // retried on the next visit instead of hiding that row for five minutes.
    if (out.length === sections.length) _cacheSet('home', out, CACHE_TTL);
    return out;
  });
}

function popular(opts) {
  return _json(REST + '/posts?per_page=20&_embed=1&_fields=' + LIST_FIELDS).then(function (rows) {
    return (Array.isArray(rows) ? rows : []).map(_card).filter(Boolean);
  }).catch(function () { return []; });
}

function getDetail(url, opts) {
  var ref = _refFromUrl(url);
  var cacheKey = 'detail:' + (ref.id || ref.slug || ref.url);
  var cached = _cacheGet(cacheKey);
  if (cached) return Promise.resolve(cached);
  var cfg = _config();
  return _restPost(ref).catch(function () { return _htmlPost(ref); }).then(function (post) {
    var content = String(post && post.content && post.content.rendered || '');
    var categories = _categoryNames(post);
    var meta = _meta(content, post, categories);
    var links = _downloadLinks(content);
    var groups = links.filter(function (link) { return link.kind === 'group'; });
    var downloads = links.filter(function (link) {
      return link.kind === 'folder' || link.kind === 'file' || link.kind === 'direct' || link.kind === 'external';
    });
    return _episodesFromLinks(downloads, post, meta, cfg).then(function (result) {
      var notes = [];
      result.restricted.forEach(function (link) {
        notes.push('Restricted Google Drive ' + (link.kind === 'folder' ? 'folder' : 'file') + ' "' + (link.label || '') + '": join the linked Google Group to access it.');
      });
      result.missing.forEach(function (link) {
        notes.push('Google Drive ' + (link.kind === 'folder' ? 'folder' : 'file') + ' "' + (link.label || '') + '" is no longer available.');
      });
      result.external.forEach(function (link) {
        notes.push('External download host "' + (link.label || 'link') + '": ' + link.url + ' (not directly playable).');
      });
      if (result.archives && result.archives.length) {
        notes.push('Archive files (not playable): ' + result.archives.map(function (file) { return file.name; }).join(', '));
      }
      if (result.extras && result.extras.length) {
        notes.push('Extra video files (not episodes): ' + result.extras.map(function (file) { return file.name; }).join(', '));
      }
      (result.notes || []).forEach(function (note) {
        if (note.restricted) notes.push('Restricted Google Drive subfolder "' + note.name + '": join the linked Google Group to access it.');
        else if (note.error) notes.push('Google Drive folder "' + note.name + '": ' + note.error);
      });
      (result.errors || []).forEach(function (error) {
        notes.push('Google Drive folder could not be read: ' + String(error && error.message || error));
      });
      if (groups.length) notes.push('Access note: ' + groups.map(function (group) { return group.url; }).join(' '));
      if (!downloads.length) notes.push('No public Google Drive video links were found on this post. The release may still be marked "DRIVE FIXING LINKS" or use an external host.');
      var description = meta.description || '';
      var info = [];
      if (meta.type) info.push('Type: ' + meta.type);
      if (meta.episodesText) info.push('Episodes: ' + meta.episodesText);
      if (meta.status) info.push('Status: ' + meta.status);
      if (meta.year) info.push('Year: ' + meta.year);
      if (meta.studios && meta.studios.length) info.push('Studios: ' + meta.studios.join(', '));
      if (meta.genres && meta.genres.length) info.push('Genres: ' + meta.genres.join(', '));
      if (meta.duration) info.push('Duration: ' + meta.duration);
      if (meta.rating) info.push('Rating: ' + meta.rating);
      if (meta.audio) info.push('Audio: ' + meta.audio);
      if (meta.resolution) info.push('Resolution: ' + meta.resolution);
      if (meta.encoding) info.push('Encoding: ' + meta.encoding);
      if (info.length) description = (description ? description + '\n\n' : '') + info.join('\n');
      if (notes.length) description = (description ? description + '\n\n' : '') + notes.join('\n');
      var episodes = result.episodes || [];
      var detail = {
        id: String(post.id || post.link || ref.url),
        title: meta.title,
        url: post.link || ref.url,
        cover: _featured(post),
        description: description,
        genres: meta.genres,
        altTitles: meta.altTitles,
        studios: meta.studios,
        status: meta.status || 'unknown',
        year: meta.year || null,
        type: meta.isMovie ? 'movie' : 'anime',
        sourceId: SOURCE_ID,
        episodes: episodes,
        subCount: episodes.filter(function (episode) { return episode.category !== 'dub'; }).length,
        dubCount: episodes.filter(function (episode) { return episode.category === 'dub'; }).length
      };
      // Cache complete results and genuine "restricted/no links" outcomes, but
      // not a transient folder failure that returned no episodes and no reason.
      if (episodes.length || /Restricted Google Drive|no longer available|No public Google Drive video links/i.test(description)) {
        _cacheSet(cacheKey, detail, CACHE_TTL);
      }
      return detail;
    });
  });
}

function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) { return detail.episodes; });
}

function _variantName(variant) {
  return String(variant && (variant.n || variant.name) || '');
}

function _variantQuality(variant, name) {
  return String(variant && variant.q || '') || _quality(name);
}

function _variantEncoding(variant, name) {
  return String(variant && variant.e || '') || _encoding(name);
}

function _variantAudio(variant, name) {
  return String(variant && variant.a || '') || _audio(name);
}

function _container(name) {
  var match = String(name || '').match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  var ext = match ? match[1].toLowerCase() : '';
  if (['mkv', 'mp4', 'webm', 'avi', 'm4v', 'mov', 'ts', 'm2ts'].indexOf(ext) === -1) return '';
  return ext === 'm2ts' ? 'ts' : ext;
}

function _resolveVariant(variant, cfg) {
  var id = String(variant && (variant.i || variant.id) || '');
  var direct = String(variant && (variant.u || variant.url) || '');
  var name = _variantName(variant);
  if (!id && !direct) return Promise.reject(new Error('KayoAnime: episode has no Google Drive file id'));
  var target = direct || _driveDownloadUrl(id);
  var probe = cfg.verify ? _probeDrive(target, id) : Promise.resolve({ ok: true, name: name, size: 0 });
  return probe.then(function (result) {
    var finalUrl = result.url || target;
    var fileName = result.name || name;
    var container = _container(fileName) || 'mkv';
    var quality = _variantQuality(variant, fileName);
    var encoding = _variantEncoding(variant, fileName);
    var audio = _variantAudio(variant, fileName);
    var label = ['KayoAnime', quality, encoding, audio].filter(Boolean).join(' ');
    return {
      stream: {
        url: finalUrl,
        quality: quality || 'Auto',
        label: label,
        type: container,
        container: container,
        encoding: encoding || '',
        audio: audio || '',
        hls: false,
        headers: { 'User-Agent': UA },
        kind: audio === 'Dub' ? 'dub' : 'sub',
        audioLang: audio === 'Dub' ? 'en' : 'ja',
        subtitles: [],
        downloadable: true,
        size: result.size || 0,
        isActive: false
      }
    };
  });
}

function getVideoSources(episodeUrl, opts) {
  var parsed = _parseEpisodeUrl(episodeUrl);
  if (!parsed || !parsed.variants.length) return Promise.resolve([]);
  var cfg = _config();
  return _mapLimit(parsed.variants, 3, function (variant) {
    return _resolveVariant(variant, cfg).catch(function (error) {
      return { error: error };
    });
  }).then(function (results) {
    var streams = [];
    var errors = [];
    (results || []).forEach(function (result) {
      if (!result) return;
      if (result.stream) streams.push(result.stream);
      if (result.error) errors.push(result.error);
    });
    if (!streams.length) {
      var message = errors.length ? String(errors[0] && errors[0].message || errors[0]) :
        'KayoAnime: no playable Google Drive file was found for this episode';
      throw new Error(message);
    }
    streams.sort(function (a, b) {
      var byQuality = _qualityRank(b.quality) - _qualityRank(a.quality);
      if (byQuality) return byQuality;
      return _audioRank(a.audio, cfg.preferredAudio) - _audioRank(b.audio, cfg.preferredAudio);
    });
    streams.forEach(function (stream, index) { stream.isActive = index === 0; });
    return streams;
  });
}

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
    getLinks: getLinks,
    _config: _config,
    _refFromUrl: _refFromUrl,
    _downloadLinks: _downloadLinks,
    _driveEntries: _driveEntries,
    _parseEpisodeUrl: _parseEpisodeUrl,
    _fileInfo: _fileInfo,
    _seriesTitle: _seriesTitle,
    _movieTitle: _movieTitle,
    _quality: _quality,
    _encoding: _encoding,
    _audio: _audio
  };
}
