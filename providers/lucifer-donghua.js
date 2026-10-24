'use strict';

// Copyright 2020-2026 Yuzono Anime Extensions contributors.
// SPDX-License-Identifier: Apache-2.0
// Adapted from src/en/luciferdonghua and lib-multisrc/animestream in
// https://github.com/yuzono/anime-extensions. Kotlin/AnimeStream behavior is
// translated to Zangetsu's JavaScript provider contract.

var VERSION = '1.0.3';
var SITE = 'https://luciferdonghua.in';
var LOGO = 'https://www.google.com/s2/favicons?sz=256&domain=luciferdonghua.in';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
var HOSTERS = [
  { value: 'dailymotion', label: 'Dailymotion' },
  { value: 'rumble', label: 'Rumble' },
  { value: 'ok.ru', label: 'Ok.ru' }
];
var DEFAULT_HOSTERS = ['dailymotion', 'rumble', 'ok.ru'];
var QUALITY_VALUES = ['2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'];

function getInfo() {
  return { name: 'Lucifer Donghua', lang: 'en', baseUrl: SITE, logo: LOGO, type: 'anime', version: VERSION };
}

function getSettings() {
  return [
    { key: 'preferred_quality', label: 'Preferred quality', description: 'Prefer this quality when sorting extracted streams.', type: 'enum', default: '720p',
      options: QUALITY_VALUES.map(function (value) { return { value: value, label: value }; }) },
    { key: 'luciferdonghua_hoster_selection', label: 'Enable/Disable Hosts', description: 'Only extract links from selected video hosts.',
      type: 'multiEnum', default: DEFAULT_HOSTERS.slice(),
      options: HOSTERS.map(function (host) { return { value: host.value, label: host.label }; }) },
    { key: 'luciferdonghua_ignore_preview', label: 'Skip Preview episodes', description: 'Skip a detected preview episode when episode dates identify it.', type: 'bool', default: true }
  ];
}

function _settings(options) {
  var root = options && typeof options === 'object' ? options : {};
  var merged = {};
  [root.config, root.settings, root].forEach(function (part) {
    if (part && typeof part === 'object' && !Array.isArray(part)) {
      Object.keys(part).forEach(function (key) { merged[key] = part[key]; });
    }
  });
  return merged;
}
function _setting(options, keys, fallback) {
  var config = _settings(options);
  for (var i = 0; i < keys.length; i++) {
    if (Object.prototype.hasOwnProperty.call(config, keys[i]) && config[keys[i]] != null) return config[keys[i]];
  }
  return fallback;
}
function _bool(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  var v = String(value).toLowerCase().trim();
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === 'no' || v === 'off' || v === '') return false;
  return fallback;
}
function _hosters(options) {
  var value = _setting(options, ['luciferdonghua_hoster_selection', 'enabledHosters'], DEFAULT_HOSTERS);
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { value = value.split(/[,\n;]/).map(function (x) { return x.trim(); }); }
  }
  return Array.isArray(value) ? value.map(function (x) { return String(x).toLowerCase(); }) : DEFAULT_HOSTERS.slice();
}
function _preferred(options) {
  return String(_setting(options, ['preferred_quality', 'preferredQuality'], '720p') || '720p');
}
function _skipPreview(options) {
  return _bool(_setting(options, ['luciferdonghua_ignore_preview', 'ignorePreview'], true), true);
}

function _entities(value) {
  return String(value == null ? '' : value)
    .replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); });
}
function _text(value) {
  return _entities(String(value || '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(?:p|div|li|h[1-6]|span|a)>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function _attr(attrs, name) {
  var match = String(attrs || '').match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))', 'i'));
  return match ? _entities(match[1] != null ? match[1] : match[2] != null ? match[2] : match[3]) : '';
}
function _inner(html, tag, className) {
  var rx = new RegExp('<' + tag + '\\b([^>]*class=["\\x27][^"\\x27]*\\b' + className + '\\b[^"\\x27]*["\\x27][^>]*)>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'i');
  var match = String(html || '').match(rx);
  return match ? match[2] : '';
}
function _balancedInner(html, tag, className) {
  var source = String(html || '');
  var open = new RegExp('<' + tag + '\\b([^>]*class=["\\x27][^"\\x27]*\\b' + className + '\\b[^"\\x27]*["\\x27][^>]*)>', 'i');
  var match = open.exec(source);
  if (!match) return '';
  var start = match.index + match[0].length;
  var tags = new RegExp('<\\/?' + tag + '\\b[^>]*>', 'gi');
  tags.lastIndex = start;
  var depth = 1, item;
  while ((item = tags.exec(source))) {
    if (/^<\//.test(item[0])) depth--;
    else if (!/\/\s*>$/.test(item[0])) depth++;
    if (depth === 0) return source.slice(start, item.index);
  }
  return '';
}
function _meta(html, key) {
  var rx = /<meta\b([^>]*)>/gi, match;
  while ((match = rx.exec(String(html || '')))) {
    if (String(_attr(match[1], 'property') || _attr(match[1], 'name')).toLowerCase() === String(key).toLowerCase()) {
      return _attr(match[1], 'content');
    }
  }
  return '';
}
function _abs(value, base) {
  try {
    var s = String(value || '').trim().replace(/&amp;/g, '&').replace(/\\\//g, '/');
    if (!s || /^(?:javascript|data):/i.test(s)) return '';
    return new URL(s, base || SITE + '/').href;
  } catch (_) { return ''; }
}
function _path(url) { try { return new URL(url, SITE + '/').pathname; } catch (_) { return ''; } }
function _slug(url) { return _path(url).replace(/\/+$/, '').split('/').pop().toLowerCase(); }
function _siteUrl(url) {
  try {
    var parsed = new URL(String(url || ''), SITE + '/');
    return parsed.protocol === 'https:' && /^(?:www\.)?luciferdonghua\.in$/i.test(parsed.hostname) ? parsed.href : '';
  } catch (_) { return ''; }
}
function _isEpisode(url) { return /(?:episode|episod|ep)[-_]?\d+/i.test(_path(url)); }
function _titleUrl(value) {
  var input = String(value || '').trim();
  if (!input) return '';
  var candidate = /^https?:\/\//i.test(input) || input.charAt(0) === '/' ? _abs(input, SITE + '/') :
    _abs('/anime/' + input.replace(/^\/+|\/+$/g, '') + '/', SITE + '/');
  return _siteUrl(candidate);
}
function _request(url, referer, accept) {
  if (!url || !/^https:\/\//i.test(url)) return Promise.reject(new Error('Only HTTPS requests are allowed'));
  if (typeof fetch !== 'function') return Promise.reject(new Error('fetch is unavailable'));
  return Promise.resolve().then(function () {
    return fetch(url, { method: 'GET', headers: { 'User-Agent': UA, 'Accept': accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Referer': referer || SITE + '/' }, timeoutMs: 15000 });
  }).then(function (response) {
    var status = Number(response && (response.status || response.statusCode) || 200);
    if (status >= 400) throw new Error('Lucifer Donghua HTTP ' + status + ' for ' + url);
    if (response && typeof response.body === 'string') return response.body;
    if (response && typeof response.text === 'function') return response.text();
    if (response && response.body && typeof response.body.text === 'function') return response.body.text();
    return '';
  }).then(function (body) { return String(body || ''); });
}
function _cleanTitle(value) {
  return _text(value).replace(/\s*[|–-]\s*Lucifer Donghua(?:\.in)?\s*$/i, '')
    .replace(/\s+(?:Episode|Ep)\s*#?\d+.*$/i, '').trim();
}
function _image(html, base) {
  var social = _meta(html, 'og:image') || _meta(html, 'twitter:image');
  if (social) return _abs(social, base);
  var regions = [_inner(html, 'div', 'thumb'), _inner(html, 'div', 'limage'), html];
  for (var i = 0; i < regions.length; i++) {
    var img = (String(regions[i] || '').match(/<img\b[^>]*>/i) || [''])[0];
    var src = _attr(img, 'data-src') || _attr(img, 'data-lazy-src') ||
      _attr(img, 'data-original') || _attr(img, 'srcset').split(/\s*,\s*/)[0].split(/\s+/)[0] || _attr(img, 'src');
    if (src) { var resolved = _abs(src, base); if (resolved) return resolved; }
  }
  return null;
}
function _card(block) {
  var raw = String(block || ''), links = [], rx = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, match;
  while ((match = rx.exec(raw))) {
    links.push({ attrs: match[1], html: match[2] });
    if (links.length >= 10) break;
  }
  var chosen = null, chosenUrl = '';
  for (var i = 0; i < links.length; i++) {
    var candidateUrl = _siteUrl(_abs(_attr(links[i].attrs, 'href'), SITE + '/'));
    if (!candidateUrl || _isEpisode(candidateUrl) || !/^\/anime\/[^/]+\/?$/i.test(_path(candidateUrl))) continue;
    chosen = links[i];
    chosenUrl = candidateUrl;
    if (/\btip\b/i.test(_attr(chosen.attrs, 'class'))) break;
  }
  if (!chosen) return null;
  var img = (chosen.html.match(/<img\b[^>]*>/i) || [''])[0];
  var titleHtml = _inner(chosen.html, 'div', 'tt') ||
    _inner(chosen.html, 'div', 'ttl') ||
    _inner(chosen.html, 'h2', 'title') ||
    _inner(chosen.html, 'h3', 'title') ||
    _inner(chosen.html, 'span', 'tt') ||
    _inner(chosen.html, 'div', 'title') ||
    _attr(chosen.attrs, 'title') || _attr(chosen.attrs, 'aria-label') ||
    _attr(img, 'alt') || chosen.html;
  var title = _cleanTitle(titleHtml);
  var imageAlt = _cleanTitle(_attr(img, 'alt'));
  if (imageAlt && (!title || title.length > 130 || /^(?:DONGHUA|ONA|TV|MOVIE|EPISODE)\b/i.test(title))) title = imageAlt;
  if (!title || title.length > 180 || /^(home|next|previous|view all|search|\d+)$/i.test(title)) return null;
  return { id: _slug(chosenUrl), title: title, englishTitle: title, url: chosenUrl,
    cover: _image(chosen.html, chosenUrl) || _abs(_attr(img, 'data-src') || _attr(img, 'data-lazy-src') || _attr(img, 'src'), chosenUrl) || null,
    type: 'anime', sourceId: 'luciferdonghua' };
}
function _cards(html) {
  var output = [], seen = Object.create(null), source = String(html || '');
  function add(fragment) {
    var item = _card(fragment);
    if (item && item.url && !seen[item.url]) { seen[item.url] = true; output.push(item); }
  }
  var articles = /<article\b[^>]*>[\s\S]*?<\/article\s*>/gi, match;
  while ((match = articles.exec(source))) add(match[0]);
  if (output.length) return output;
  // Yuzono's selector is div.listupd article a.tip; tolerate theme changes
  // where the same series anchors are returned without an article wrapper.
  var links = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  while ((match = links.exec(source))) {
    var url = _siteUrl(_abs(_attr(match[1], 'href'), SITE + '/'));
    if (!url || _isEpisode(url) || !/^\/anime\/[^/]+\/?$/i.test(_path(url))) continue;
    add(match[0]);
  }
  return output;
}
function getHome(options) {
  return Promise.all([
    _request(SITE + '/anime/?page=1&order=popular', SITE + '/').then(function (html) { return { title: 'Popular', items: _cards(html) }; }).catch(function () { return { title: 'Popular', items: [] }; }),
    _request(SITE + '/anime/?page=1&order=update', SITE + '/').then(function (html) { return { title: 'Latest Updates', items: _cards(html) }; }).catch(function () { return { title: 'Latest Updates', items: [] }; })
  ]).then(function (sections) { return sections.filter(function (section) { return section.items.length; }); });
}
function search(query, page, options) {
  var q = String(query || '').trim(), p = Math.max(1, Number(page) || 1);
  if (!q) return Promise.resolve([]);
  var encoded = encodeURIComponent(q);
  // First URL matches Yuzono's AnimeStream base. WordPress can serve search at
  // the root or catalogue route after a theme/site update; fall back as needed.
  var urls = [
    SITE + '/page/' + p + '/?s=' + encoded,
    SITE + '/?s=' + encoded + (p > 1 ? '&paged=' + p : ''),
    SITE + '/anime/?s=' + encoded + (p > 1 ? '&paged=' + p : ''),
    SITE + '/?s=' + encoded,
    SITE + '/anime/?s=' + encoded
  ];
  var seen = Object.create(null);
  function attempt(index) {
    if (index >= urls.length) return Promise.resolve([]);
    var url = urls[index];
    if (seen[url]) return attempt(index + 1);
    seen[url] = true;
    return _request(url, SITE + '/', 'text/html,application/xhtml+xml,*/*')
      .then(function (html) {
        var items = _cards(html);
        if (!items.length) return attempt(index + 1);
        return items.map(function (item) { item.page = p; return item; });
      })
      .catch(function () { return attempt(index + 1); });
  }
  return attempt(0);
}
function _date(value) { var parsed = Date.parse(_text(value)); return isFinite(parsed) ? parsed : 0; }
function _episodes(html, base, options) {
  var source = String(html || ''), output = [], seen = Object.create(null);
  function add(href, attrs, anchorHtml, block) {
    var url = _siteUrl(_abs(href, base));
    if (!url || !_isEpisode(url) || seen[url]) return;
    var numText = _text(_inner(block, 'span', 'epl-num') || _inner(block, 'div', 'epl-num') ||
      _attr(attrs, 'title') || anchorHtml).replace(/\[4K\]/ig, '').trim();
    var numeric = numText.match(/(?:episode|ep(?:isode)?)\s*#?\s*(\d+(?:\.\d+)?)/i) ||
      numText.match(/^\s*(\d+(?:\.\d+)?)/);
    var number = numeric ? Number(numeric[1]) : 0;
    var extra = _text(_inner(block, 'span', 'epl-title') || _inner(block, 'div', 'epl-title'));
    var title = 'Episode ' + number;
    if (extra && /preview/i.test(extra)) title += ' - ' + extra;
    var dateText = _text(_inner(block, 'span', 'epl-date') || _inner(block, 'div', 'epl-date'));
    if (!dateText) {
      var date = _text(block).match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/i);
      if (date) dateText = date[0];
    }
    seen[url] = true;
    output.push({ id: url, title: title, name: title, number: number, episodeNumber: number,
      url: url, date_upload: _date(dateText), date: dateText || null, type: 'anime', category: 'sub', sourceId: 'luciferdonghua' });
  }
  var listItems = /<li\b[^>]*>[\s\S]*?<\/li\s*>/gi, item;
  while ((item = listItems.exec(source))) {
    var block = item[0], anchor = block.match(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/i);
    if (anchor) add(_attr(anchor[1], 'href'), anchor[1], anchor[2], block);
  }
  // Fallback for theme changes where episode links remain but eplister <li>
  // markup changes. Only URLs that match the source's episode URL scheme pass.
  if (!output.length) {
    var anchors = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, match;
    while ((match = anchors.exec(source))) add(_attr(match[1], 'href'), match[1], match[2], match[0]);
  }
  if (_skipPreview(options) && output.length > 2) {
    output = output.slice().sort(function (a, b) { return b.number - a.number; });
    if (output[0].date_upload < output[1].date_upload) output = output.slice(1);
  }
  return output;
}
function _detail(html, url, options) {
  var source = String(html || '');
  var h1 = source.match(/<h1\b([^>]*)>([\s\S]*?)<\/h1\s*>/i);
  var titleHtml = _inner(source, 'h1', 'entry-title') || (h1 ? h1[2] : '') ||
    _meta(source, 'og:title') || _meta(source, 'twitter:title') ||
    ((source.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i) || [])[1] || '') || _slug(url);

  // Scope metadata to the title's own info panel so recommendations/comments
  // cannot pollute genres or status. Balanced parsing avoids truncating nested divs.
  var info = _balancedInner(source, 'div', 'info-content') ||
    _balancedInner(source, 'ul', 'data') ||
    _inner(source, 'div', 'info-content') || '';
  var fullText = _text(info || source), genres = Object.create(null);
  var genreScope = _balancedInner(source, 'div', 'genxed') || info || source;
  var genreRx = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, match;
  while ((match = genreRx.exec(genreScope))) {
    var href = _attr(match[1], 'href'), label = _text(match[2]);
    if ((/\/genre\//i.test(href) || /\/(?:tag|genre)\//i.test(href)) && label) genres[label] = true;
  }
  if (!Object.keys(genres).length) {
    var genreList = /<li\b[^>]*>\s*(?:<b[^>]*>)?\s*Genre\s*:\s*([\s\S]*?)<\/li\s*>/i.exec(info);
    if (genreList) {
      var links = /<a\b[^>]*>([\s\S]*?)<\/a\s*>/gi, genreMatch;
      while ((genreMatch = links.exec(genreList[1]))) {
        var genre = _text(genreMatch[1]);
        if (genre) genres[genre] = true;
      }
    }
  }

  var description = _balancedInner(source, 'div', 'entry-content') ||
    _balancedInner(source, 'div', 'desc') ||
    _balancedInner(source, 'div', 'synopsis') ||
    _inner(source, 'div', 'entry-content') ||
    _inner(source, 'div', 'desc') ||
    _meta(source, 'description') || _meta(source, 'og:description') || _meta(source, 'twitter:description');
  var descriptionText = _text(description);
  if (!descriptionText || (/watch full episodes|lucifer donghua/i.test(descriptionText) && descriptionText.length < 180)) {
    descriptionText = _text(_balancedInner(source, 'div', 'synopsis') || _balancedInner(source, 'div', 'desc') || description);
  }

  var sm = fullText.match(/\bStatus\s*:\s*(Ongoing|Completed|Complete|Hiatus|Upcoming|Airing)\b/i);
  if (!sm) sm = _text(source).match(/\bStatus\s*:\s*(Ongoing|Completed|Complete|Hiatus|Upcoming|Airing)\b/i);
  var status = sm && /completed|complete/i.test(sm[1]) ? 'completed' :
    sm && /ongoing|airing/i.test(sm[1]) ? 'ongoing' :
    sm && /hiatus/i.test(sm[1]) ? 'hiatus' :
    sm && /upcoming/i.test(sm[1]) ? 'upcoming' : 'unknown';
  if (status === 'unknown') {
    if (/\bcompleted\b/i.test(fullText)) status = 'completed';
    else if (/\bongoing\b/i.test(fullText)) status = 'ongoing';
  }

  var episodes = _episodes(source, url, options);
  var year = (_text(source).match(/\b(?:19|20)\d{2}\b/) || [])[0] || null;
  return {
    id: _slug(url), title: _cleanTitle(titleHtml), englishTitle: _cleanTitle(titleHtml),
    url: url, cover: _image(source, url), description: descriptionText,
    status: status, genres: Object.keys(genres), year: year, type: 'anime',
    sourceId: 'luciferdonghua', episodes: episodes, episodeCount: episodes.length,
    subCount: episodes.length, dubCount: 0
  };
}
function getDetail(input, options) {
  var url = _titleUrl(input);
  if (!url) return Promise.reject(new Error('Invalid Lucifer Donghua URL'));
  if (_isEpisode(url)) {
    return _request(url, SITE + '/').then(function (html) {
      var rx = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, match;
      while ((match = rx.exec(html))) {
        var parent = _siteUrl(_abs(_attr(match[1], 'href'), url));
        if (parent && /^\/anime\/[^/]+\/?$/i.test(_path(parent))) {
          return _request(parent, url).then(function (seriesHtml) { return _detail(seriesHtml, parent, options); });
        }
      }
      return _detail(html, url, options);
    });
  }
  return _request(url, SITE + '/').then(function (html) { return _detail(html, url, options); });
}
function getEpisodes(input, options) {
  return getDetail(input, options).then(function (detail) { return Array.isArray(detail.episodes) ? detail.episodes : []; }).catch(function () { return []; });
}

function _b64decode(value) {
  var clean = String(value || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
  while (clean.length % 4) clean += '=';
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', out = '';
  for (var i = 0; i + 3 < clean.length; i += 4) {
    var a = alphabet.indexOf(clean.charAt(i)), b = alphabet.indexOf(clean.charAt(i + 1));
    var c = clean.charAt(i + 2) === '=' ? 0 : alphabet.indexOf(clean.charAt(i + 2));
    var d = clean.charAt(i + 3) === '=' ? 0 : alphabet.indexOf(clean.charAt(i + 3));
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    var n = (a << 18) | (b << 12) | (c << 6) | d;
    out += String.fromCharCode((n >> 16) & 255);
    if (clean.charAt(i + 2) !== '=') out += String.fromCharCode((n >> 8) & 255);
    if (clean.charAt(i + 3) !== '=') out += String.fromCharCode(n & 255);
  }
  return out;
}
function _iframe(html, base) {
  var source = String(html || '');
  // Yuzono's mirror route publishes the actual player here. Check it before
  // arbitrary iframes because current pages place ad iframes before the player.
  var meta = /<meta\b([^>]*\bitemprop=["']embedUrl["'][^>]*)>/i.exec(source);
  if (meta) {
    var metaUrl = _abs(_attr(meta[1], 'content'), base);
    if (metaUrl) return metaUrl;
  }

  // Exact upstream preference: #embed_holder iframe[src~=.] .
  var holder = /<(?:div|section)\b([^>]*\bid=["']embed_holder["'][^>]*)>/i.exec(source);
  if (holder) {
    var fromHolder = source.slice(holder.index + holder[0].length);
    var holderFrame = fromHolder.match(/<iframe\b([^>]*)>/i);
    if (holderFrame) {
      var holderUrl = _abs(_attr(holderFrame[1], 'src') || _attr(holderFrame[1], 'data-src') || _attr(holderFrame[1], 'data-lazy-src'), base);
      if (holderUrl) return holderUrl;
    }
  }

  // Theme fallback: consider other iframe elements but filter obvious ads.
  var frames = /<iframe\b([^>]*)>/gi, match;
  while ((match = frames.exec(source))) {
    var attrs = match[1];
    var candidate = _abs(_attr(attrs, 'src') || _attr(attrs, 'data-src') || _attr(attrs, 'data-lazy-src'), base);
    if (!candidate) continue;
    var host = '';
    try { host = new URL(candidate).hostname.toLowerCase(); } catch (_) {}
    if (host === 't.co' || host.endsWith('.t.co') || host.endsWith('.blogspot.com')) continue;
    if (/width\s*:\s*0|height\s*:\s*0|visibility\s*:\s*hidden|position\s*:\s*absolute/i.test(_attr(attrs, 'style'))) continue;
    return candidate;
  }
  var text = source.trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(text) ? text : '';
}
function _mirrors(html) {
  var out = [], seen = {};
  function add(data, label) {
    data = String(data || '').trim();
    if (data && !seen[data]) { seen[data] = true; out.push({ data: data, label: _text(label) || 'Host' }); }
  }
  var rx = /<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi, match;
  while ((match = rx.exec(String(html || '')))) {
    if (_attr(match[1], 'data-index') !== '') add(_attr(match[1], 'value'), match[2]);
  }
  rx = /<a\b([^>]*\bdata-em=["'][^"']*["'][^>]*)>([\s\S]*?)<\/a\s*>/gi;
  while ((match = rx.exec(String(html || '')))) add(_attr(match[1], 'data-em'), match[2]);
  return out;
}
function _hosterUrl(data, episodeUrl) {
  if (/^https:\/\//i.test(data)) {
    return _request(data, episodeUrl).then(function (html) { return _iframe(html, data) || data; }).catch(function () { return data; });
  }
  var decoded = _b64decode(data);
  if (!/<(?:iframe|meta)\b/i.test(decoded) && /<(?:iframe|meta)\b/i.test(data)) decoded = data;
  return Promise.resolve(_iframe(decoded, episodeUrl));
}
function _quality(value) {
  var text = String(value || '').toLowerCase();
  if (text === 'auto') return 'Auto';
  var match = text.match(/(2160|1440|1080|720|480|360|240|144)p?/);
  return match ? match[1] + 'p' : (value ? String(value) : 'Auto');
}
function _stream(url, quality, host, referer, subtitles, type) {
  url = _abs(url, referer || SITE + '/');
  if (!url || !/^https:\/\//i.test(url)) return null;
  var hls = /\.m3u8(?:[?#]|$)/i.test(url) || /mpegurl|m3u8/i.test(String(type || ''));
  var dash = /\.mpd(?:[?#]|$)/i.test(url) || /dash\+xml/i.test(String(type || ''));
  var origin = SITE;
  try { origin = new URL(referer || SITE).origin; } catch (_) {}
  return { url: url, quality: _quality(quality), label: 'Lucifer Donghua | ' + host + ' | ' + _quality(quality),
    container: hls ? 'hls' : dash ? 'dash' : (/\.(?:mp4|m4v|webm)(?:[?#]|$)/i.test(url) ? 'mp4' : 'unknown'),
    hls: hls, kind: 'sub', audioLang: 'zh', headers: { 'User-Agent': UA, 'Referer': referer || SITE + '/', 'Origin': origin },
    subtitles: Array.isArray(subtitles) ? subtitles : [] };
}
function _sortStreams(items, options) {
  var pref = _preferred(options);
  return items.slice().sort(function (a, b) {
    var ap = String(a.quality).toLowerCase() === pref.toLowerCase() ? 1 : 0;
    var bp = String(b.quality).toLowerCase() === pref.toLowerCase() ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (Number((String(b.quality).match(/\d+/) || [0])[0]) || 0) - (Number((String(a.quality).match(/\d+/) || [0])[0]) || 0);
  });
}
function _hls(url, host, referer, options, subtitles) {
  var fallback = _stream(url, 'Auto', host, referer, subtitles, 'application/vnd.apple.mpegurl');
  if (!fallback) return Promise.resolve([]);
  return _request(url, referer, 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*').then(function (body) {
    var lines = body.split(/\r?\n/), output = [];
    for (var i = 0; i < lines.length; i++) {
      if (!/^#EXT-X-STREAM-INF:/i.test(lines[i].trim())) continue;
      var next = i + 1;
      while (next < lines.length && (!lines[next].trim() || /^#/i.test(lines[next].trim()))) next++;
      if (next >= lines.length) continue;
      var resolution = lines[i].match(/RESOLUTION=\d+x(\d+)/i);
      var item = _stream(_abs(lines[next].trim(), url), resolution ? resolution[1] + 'p' : 'Auto', host, referer || url, subtitles, 'application/vnd.apple.mpegurl');
      if (item && !output.some(function (entry) { return entry.url === item.url; })) output.push(item);
    }
    return _sortStreams(output.length ? output : [fallback], options);
  }).catch(function () { return [fallback]; });
}
function _findProp(value, wanted) {
  if (!value || typeof value !== 'object') return '';
  if (Object.prototype.hasOwnProperty.call(value, wanted) && typeof value[wanted] === 'string') return value[wanted];
  var keys = Object.keys(value);
  for (var i = 0; i < keys.length; i++) { var result = _findProp(value[keys[i]], wanted); if (result) return result; }
  return '';
}
function _findVideos(object) {
  var found = [];
  if (!object || typeof object !== 'object') return found;
  if (Array.isArray(object.videos)) object.videos.forEach(function (item) { if (item && item.url) found.push(item); });
  Object.keys(object).forEach(function (key) { if (object[key] && typeof object[key] === 'object') found = found.concat(_findVideos(object[key])); });
  return found;
}
function _okru(url, episodeUrl, options) {
  return _request(url, episodeUrl).then(function (html) {
    var attrs = (html.match(/<div\b([^>]*\bdata-options=["'][^"']*["'][^>]*)>/i) || [])[1] || '';
    var raw = _attr(attrs, 'data-options').replace(/\\u0026/gi, '&').replace(/\\x26/gi, '&').replace(/\\\//g, '/');
    var data = null;
    try { data = JSON.parse(raw); } catch (_) { try { data = JSON.parse(raw.replace(/\\"/g, '"')); } catch (_) {} }
    var hlsUrl = _findProp(data, 'ondemandHls'), dashUrl = _findProp(data, 'ondemandDash');
    var hlsStream = hlsUrl && _stream(hlsUrl, 'Auto', 'Ok.ru', url, [], 'application/vnd.apple.mpegurl');
    if (hlsStream) return _hls(hlsStream.url, 'Ok.ru', url, options, []);
    var dashStream = dashUrl && _stream(dashUrl, 'Auto', 'Ok.ru', url, [], 'application/dash+xml');
    if (dashStream) return [dashStream];
    var videos = data ? _findVideos(data) : [], result = [];
    if (!videos.length) {
      var rx = /"name"\s*:\s*"([^"]+)"[\s\S]*?"url"\s*:\s*"([^"]+)"/g, m;
      while ((m = rx.exec(raw))) videos.push({ name: m[1], url: m[2] });
    }
    videos.forEach(function (video) {
      var videoUrl = String(video.url || '').replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
      var item = _stream(videoUrl, _quality(video.name), 'Ok.ru', url, [], '');
      if (item) result.push(item);
    });
    return _sortStreams(result, options);
  }).catch(function () { return []; });
}
function _dailymotion(url, episodeUrl, options) {
  return _request(url, episodeUrl).then(function (html) {
    var found = String(url).match(/[?&]video=([a-z0-9]+)/i) || String(url).match(/(?:video|embed\/video)\/([a-z0-9]+)/i) ||
      String(url).match(/\/([kx][a-z0-9]+)(?:[/?#]|$)/i);
    if (!found) return [];
    var ts = html.match(/"ts"\s*:\s*"?([^,"}]+)"?/i), visitor = html.match(/"v1st"\s*:\s*"([^"]+)"/i);
    var api = 'https://www.dailymotion.com/player/metadata/video/' + encodeURIComponent(found[1]) + '?locale=en-US&is_native_app=0';
    if (ts) api += '&dmTs=' + encodeURIComponent(ts[1]);
    if (visitor) api += '&dmV1st=' + encodeURIComponent(visitor[1]);
    return _request(api, url, 'application/json,*/*').then(function (text) {
      var data;
      try { data = JSON.parse(text); } catch (_) { return []; }
      var subs = [], subdata = data.subtitles && data.subtitles.data;
      if (subdata) {
        if (!Array.isArray(subdata)) subdata = Object.keys(subdata).map(function (key) { return subdata[key]; });
        subdata.forEach(function (item) { if (item && item.label && item.urls && item.urls[0]) subs.push({ label: item.label, lang: item.label, url: item.urls[0] }); });
      }
      var output = [], qualities = data.qualities || {};
      Object.keys(qualities).forEach(function (key) {
        var entries = Array.isArray(qualities[key]) ? qualities[key] : [];
        entries.forEach(function (entry) {
          if (!entry || !entry.url) return;
          var item = _stream(entry.url, key === 'auto' ? 'Auto' : _quality(key), 'Dailymotion', url, subs, entry.type || '');
          if (item && !output.some(function (x) { return x.url === item.url; })) output.push(item);
        });
      });
      if (!output.length && data.url) { var fallback = _stream(data.url, 'Auto', 'Dailymotion', url, subs, data.type || ''); if (fallback) output.push(fallback); }
      return _sortStreams(output, options);
    }).catch(function () { return []; });
  }).catch(function () { return []; });
}
function _rumble(url, episodeUrl, options) {
  var match = String(url).match(/rumble\.com\/embed\/v([a-z0-9]+)/i);
  if (!match) return Promise.resolve([]);
  return _hls('https://rumble.com/hls-vod/' + match[1] + '/playlist.m3u8', 'Rumble', url || episodeUrl, options, []);
}
function _resolve(url, label, episodeUrl, options) {
  var enabled = _hosters(options), parsed;
  try { parsed = new URL(url); } catch (_) { return Promise.resolve([]); }
  var host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (/dailymotion\.com$/.test(host) || host === 'dai.ly') return enabled.indexOf('dailymotion') >= 0 ? _dailymotion(url, episodeUrl, options) : Promise.resolve([]);
  if (host === 'rumble.com' || host.endsWith('.rumble.com')) return enabled.indexOf('rumble') >= 0 ? _rumble(url, episodeUrl, options) : Promise.resolve([]);
  if (host === 'ok.ru' || host.endsWith('.ok.ru')) return enabled.indexOf('ok.ru') >= 0 ? _okru(url, episodeUrl, options) : Promise.resolve([]);
  if (/\.(?:m3u8|mp4|m4v|webm|mpd)(?:[?#]|$)/i.test(url)) {
    var stream = _stream(url, label || 'Direct', 'Direct', episodeUrl, [], '');
    return Promise.resolve(stream ? [stream] : []);
  }
  return Promise.resolve([]);
}
function getVideoSources(episodeUrl, options) {
  var url = _titleUrl(episodeUrl);
  if (!url) return Promise.resolve([]);
  return _request(url, SITE + '/').then(function (html) {
    var direct = [], sourceRx = /<(?:source|video)\b([^>]*)>/gi, match;
    while ((match = sourceRx.exec(html))) {
      var directUrl = _abs(_attr(match[1], 'src') || _attr(match[1], 'data-src'), url);
      if (directUrl && /\.(?:m3u8|mp4|m4v|webm|mpd)(?:[?#]|$)/i.test(directUrl)) {
        var stream = _stream(directUrl, 'Auto', 'Direct', url, [], '');
        if (stream) direct.push(stream);
      }
    }
    if (direct.length) return _sortStreams(direct, options);
    var mirrors = _mirrors(html);
    if (!mirrors.length) { var iframe = _iframe(html, url); if (iframe) mirrors.push({ data: iframe, label: 'Embedded player' }); }
    return Promise.all(mirrors.slice(0, 12).map(function (mirror) {
      return _hosterUrl(mirror.data, url).then(function (hoster) {
        return hoster ? _resolve(hoster, mirror.label, url, options) : [];
      }).catch(function () { return []; });
    })).then(function (lists) {
      var out = [], seen = {};
      lists.forEach(function (list) { list.forEach(function (item) {
        if (item && item.url && !seen[item.url]) { seen[item.url] = true; out.push(item); }
      }); });
      return _sortStreams(out, options).slice(0, 30);
    });
  }).catch(function () { return []; });
}
function getStreams(url, options) { return getVideoSources(url, options); }
function getLinks(url, options) { return getVideoSources(url, options); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome,
    search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources,
    getStreams: getStreams, getLinks: getLinks };
}
