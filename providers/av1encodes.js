// AV1Encodes native Zangetsu provider, rebuilt from the Yuzuno Aniyomi source.
// Key compatibility points: /episodes JSON (including embedded ddl), fresh
// /get_token handling for stale episode links, /get_ddl extraction, and DASH.
'use strict';

const SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'av1encodes';
const VERSION = '1.0.2';
const DEFAULT_DOMAIN = 'https://av1please.com';
const SITE_DOMAINS = [
  'https://av1please.com',
  'https://animealpha.cc',
  'https://av1encodes.com'
];
const LOGO = 'https://www.google.com/s2/favicons?sz=256&domain=av1encodes.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 3200;
const REDIRECT_TIMEOUT_MS = 1800;
const WARMUP_TIMEOUT_MS = 900;
const EPISODE_CACHE_TTL_MS = 120000;
const QUALITY_LIST = [
  { value: '1920 x 1080', label: '1080p' },
  { value: '1280 x 720', label: '720p' },
  { value: '854 x 480', label: '480p' },
  { value: '640 x 360', label: '360p' }
];
const FILENAME_RE = /([a-zA-Z0-9_ \-\[\]().%]+?\.(?:mkv|mp4))/gi;
const DDL_TOKEN_RE = /['"]([A]{4,}[A-Za-z0-9_-]{10,})['"]/;
const EPISODE_PATTERNS = [
  /\[(?:S\d{1,2}[-_ ]*)?E0*(\d{1,4})\]/i,
  /\bS\d{1,2}[-_ ]*E0*(\d{1,4})\b/i,
  /\b(?:episode|ep\.?)\s*0*(\d{1,4})\b/i,
  /\bE0*(\d{1,4})\b/i
];
const DDL_QUERY_KEY = '__av1ddl'; // Read-only legacy compatibility; new episode URLs never include this marker.
const DDL_BY_URL = Object.create(null);
const EPISODE_CACHE = Object.create(null);

// ── Settings and provider contract ────────────────────────────────────────

function _readSetting(key) {
  try {
    const settings = typeof __settings !== 'undefined' && __settings
      ? __settings[SOURCE_ID] : null;
    return settings && settings[key] != null ? settings[key] : null;
  } catch (e) {
    return null;
  }
}

function _cleanDomain(value) {
  let raw = String(value || DEFAULT_DOMAIN).trim();
  if (!raw) raw = DEFAULT_DOMAIN;
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  const m = raw.match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1].replace(/\/+$/, '') : DEFAULT_DOMAIN;
}

function _domain() {
  const selected = _readSetting('domain');
  if (!selected || String(selected).trim().toLowerCase() === 'auto') return DEFAULT_DOMAIN;
  const normalized = _cleanDomain(selected);
  // This is a chooser for known site domains, not an arbitrary custom-domain
  // override. Invalid or unknown values safely return to automatic mode.
  return SITE_DOMAINS.indexOf(normalized) >= 0 ? normalized : DEFAULT_DOMAIN;
}

function _qualityValue(value) {
  const q = String(value || '1080p').toLowerCase();
  if (q.indexOf('720') >= 0) return '1280 x 720';
  if (q.indexOf('480') >= 0) return '854 x 480';
  if (q.indexOf('360') >= 0) return '640 x 360';
  return '1920 x 1080';
}

function _qualityCandidates(preferred) {
  const first = _qualityValue(preferred || _readSetting('quality') || '1080p');
  return [first].concat(QUALITY_LIST.map(x => x.value).filter(x => x !== first));
}

function getInfo() {
  return {
    name: 'AV1Encodes',
    lang: 'en',
    baseUrl: _domain(),
    logo: LOGO,
    type: 'anime',
    version: VERSION
  };
}

function getSettings() {
  return [
    {
      key: 'domain',
      label: 'Optional domain',
      description: 'Optional preferred mirror. Keep Auto to select the default automatically; only official AV1Encodes domains are supported.',
      type: 'enum',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto (recommended)' },
        { value: 'https://av1please.com', label: 'av1please.com' },
        { value: 'https://animealpha.cc', label: 'animealpha.cc' },
        { value: 'https://av1encodes.com', label: 'av1encodes.com' }
      ]
    },
    {
      key: 'quality',
      label: 'Preferred quality',
      description: 'Preferred resolution. Episode listings fall back to lower resolutions when needed.',
      type: 'enum',
      default: '1080p',
      options: [
        { value: '1080p', label: '1080p' },
        { value: '720p', label: '720p' },
        { value: '480p', label: '480p' },
        { value: '360p', label: '360p' }
      ]
    },
    {
      key: 'showTorrent',
      label: 'Show torrent links',
      description: 'Include torrent links in the returned sources when AV1Encodes provides one.',
      type: 'bool',
      default: false
    }
  ];
}

// ── URL and response helpers ──────────────────────────────────────────────

function _origin(url) {
  const m = String(url || '').trim().match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1].replace(/\/+$/, '') : null;
}

function _host(url) {
  const origin = _origin(url);
  return origin ? origin.replace(/^https?:\/\//i, '').split(':')[0].toLowerCase() : '';
}

function _isKnownHost(host) {
  const h = String(host || '').toLowerCase();
  return SITE_DOMAINS.some(d => {
    const root = _host(d);
    return h === root || h.endsWith('.' + root);
  }) || (!!_host(_domain()) && h === _host(_domain()));
}

function _pathQuery(url) {
  const raw = String(url || '').trim().replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(raw)) {
    const m = raw.match(/^https?:\/\/[^/?#]+([^#]*)/i);
    return m && m[1] ? m[1] : '/';
  }
  if (raw.indexOf('//') === 0) {
    const m = raw.match(/^\/\/[^/?#]+([^#]*)/);
    return m && m[1] ? m[1] : '/';
  }
  if (!raw) return '/';
  const noHash = raw.split('#')[0];
  return noHash.charAt(0) === '/' ? noHash : '/' + noHash;
}

function _pathOnly(url) {
  return _pathQuery(url).split('?')[0].split('#')[0] || '/';
}

function _absolute(raw, base) {
  if (!raw) return null;
  const value = String(raw).trim().replace(/&amp;/g, '&');
  if (/^(?:https?:|magnet:|blob:)/i.test(value)) return value;
  if (value.indexOf('//') === 0) return 'https:' + value;
  const origin = _origin(base) || _domain();
  if (value.charAt(0) === '/') return origin + value;
  return origin + '/' + value.replace(/^\/+/, '');
}

function _decode(value) {
  const raw = String(value || '').replace(/&amp;/g, '&');
  try { return decodeURIComponent(raw); } catch (e) { return raw; }
}

function _queryParam(url, name) {
  const q = _pathQuery(url).split('?')[1] || '';
  const wanted = String(name).toLowerCase();
  const pieces = q.split('&');
  for (const piece of pieces) {
    if (!piece) continue;
    const at = piece.indexOf('=');
    const key = _decode(at < 0 ? piece : piece.slice(0, at)).toLowerCase();
    if (key === wanted) return _decode(at < 0 ? '' : piece.slice(at + 1));
  }
  return null;
}

function _withoutQueryParams(url, names) {
  const full = _absolute(url, _domain());
  if (!full) return url;
  const origin = _origin(full) || _domain();
  const pathQuery = _pathQuery(full);
  const at = pathQuery.indexOf('?');
  if (at < 0) return origin + pathQuery;
  const path = pathQuery.slice(0, at);
  const removed = (names || []).map(x => String(x).toLowerCase());
  const kept = pathQuery.slice(at + 1).split('&').filter(part => {
    if (!part) return false;
    const eq = part.indexOf('=');
    const key = _decode(eq < 0 ? part : part.slice(0, eq)).toLowerCase();
    return removed.indexOf(key) < 0;
  });
  return origin + path + (kept.length ? '?' + kept.join('&') : '');
}

function _setQueryParam(url, key, value) {
  const clean = _withoutQueryParams(url, [key]);
  return clean + (_pathQuery(clean).indexOf('?') >= 0 ? '&' : '?') +
    encodeURIComponent(key) + '=' + encodeURIComponent(String(value));
}

function _canonicalSiteUrl(url, base) {
  const raw = String(url || '').trim();
  const full = _absolute(raw, base || _domain());
  if (!full) return null;
  const host = _host(full);
  if (!_isKnownHost(host)) return full;

  const explicit = _readSetting('domain');
  const hasExplicitDomain = !!explicit && String(explicit).trim().toLowerCase() !== 'auto';
  // A URL returned by a successful mirror is evidence of which host actually
  // served the title. In Auto mode preserve that origin across detail, episode
  // and playback calls. Only an explicit user-selected domain may rewrite it.
  const wasAbsolute = /^https?:\/\//i.test(raw) || raw.indexOf('//') === 0;
  if (wasAbsolute && !hasExplicitDomain) return full;
  return (_origin(_domain()) || _domain()) + _pathQuery(full);
}

function _siteBases(preferred) {
  const out = [];
  const add = value => {
    const origin = _origin(value);
    if (origin && out.indexOf(origin) < 0) out.push(origin);
  };
  // The URL's own origin comes first. If it was produced by a successful mirror
  // request, immediately switching back to the configured default makes every
  // subsequent episode request repeat the known-bad host.
  add(preferred || _domain());
  add(_domain());
  SITE_DOMAINS.forEach(add);
  return out;
}

function _headers(ref, base, mode) {
  const site = _origin(base) || _domain();
  const headers = {
    'User-Agent': UA,
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': ref || site + '/',
    'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Site': 'same-origin'
  };
  if (mode === 'json') {
    headers.Accept = 'application/json, */*;q=0.8';
    headers['Sec-Fetch-Dest'] = 'empty';
    headers['Sec-Fetch-Mode'] = 'cors';
  } else {
    headers.Accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
    headers['Upgrade-Insecure-Requests'] = '1';
    headers['Sec-Fetch-Dest'] = 'document';
    headers['Sec-Fetch-Mode'] = 'navigate';
    headers['Sec-Fetch-User'] = '?1';
  }
  return headers;
}

function _mergeHeaders(a, b) {
  const out = {};
  Object.keys(a || {}).forEach(k => { out[k] = a[k]; });
  Object.keys(b || {}).forEach(k => { out[k] = b[k]; });
  return out;
}

function _isChallenge(body) {
  const s = String(body || '');
  return (/Just a moment\.{0,3}|cf-chl-|turnstile/i.test(s) &&
    /cloudflare|challenge-platform|captcha/i.test(s)) ||
    /your ip has been blocked/i.test(s);
}

async function _rawRequest(url, ref, extraHeaders, timeoutMs) {
  const base = _origin(url) || _domain();
  try {
    const response = await fetch(url, {
      headers: _mergeHeaders(_headers(ref || base + '/', base, 'html'), extraHeaders),
      redirect: 'follow',
      credentials: 'include',
      timeoutMs: timeoutMs || REQUEST_TIMEOUT_MS
    });
    const status = Number(response && response.status || 0);
    let body = '';
    if (response && typeof response.text === 'function') {
      try { body = String(await response.text() || ''); } catch (e) { body = ''; }
    } else if (response && typeof response.body === 'string') {
      body = response.body;
    }
    const finalUrl = response && response.url ? String(response.url) : url;
    const challenge = _isChallenge(body);
    const okay = !!response && response.ok !== false && status < 400 && !challenge;
    return {
      ok: okay, status: status, body: body, url: finalUrl,
      base: _origin(finalUrl) || base,
      reason: challenge ? 'challenge' : (status >= 400 ? 'http' : '')
    };
  } catch (e) {
    return { ok: false, status: 0, body: '', url: url, base: base, reason: 'network' };
  }
}

async function _warmupSite(base) {
  const site = _origin(base) || _domain();
  // Ordinary homepage request only. This establishes a normal session cookie
  // where the site permits it; it does not solve or bypass a CAPTCHA/IP block.
  try {
    await _rawRequest(site + '/', site + '/', {}, WARMUP_TIMEOUT_MS);
  } catch (e) {}
}

async function _requestSiteUrl(url, ref, extraHeaders, timeoutMs, context) {
  const base = _origin(url) || _domain();
  let result = await _rawRequest(url, ref || base + '/', extraHeaders, timeoutMs);
  if (result.status === 403 && context && !context.warmupUsed) {
    context.warmupUsed = true;
    await _warmupSite(base);
    result = await _rawRequest(url, ref || base + '/', extraHeaders, timeoutMs);
  }
  return result;
}

async function _fetchSite(rawUrl, ref, timeoutMs) {
  const firstOrigin = _origin(rawUrl);
  const selected = firstOrigin || _domain();
  const path = _pathQuery(rawUrl);
  const isEpisodeList = /^\/episodes\//i.test(_pathOnly(rawUrl));
  // Episode lists are fetched once per season/quality and may be retried at
  // lower resolutions by the caller. Don't multiply each such request across
  // every mirror: selected host + one fallback is enough to protect against a
  // domain outage without exhausting Zangetsu's per-source call budget.
  const candidates = _siteBases(selected).slice(0, isEpisodeList ? 2 : SITE_DOMAINS.length);
  let last = { ok: false, status: 0, body: '', url: rawUrl, base: selected, reason: 'unavailable' };
  const context = { warmupUsed: false };
  for (const base of candidates) {
    const target = base + path;
    const response = await _requestSiteUrl(
      target, ref || base + '/', {}, timeoutMs || REQUEST_TIMEOUT_MS, context
    );
    if (response.ok && response.body) return response;
    last = response;
    if (response.status === 403 || response.status === 404 || response.status === 410 ||
        response.status === 429 || response.status >= 500 || response.status === 0 ||
        response.reason === 'challenge') {
      continue;
    }
    if (response.ok) return response;
  }
  return {
    ok: false, status: last.status, body: '', url: rawUrl,
    base: last.base || selected, reason: last.reason || 'unavailable'
  };
}

function _htmlText(value) {
  return String(value || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (all, n) => {
      const cp = parseInt(n, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCharCode(cp) : all;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function _attr(html, name) {
  const re = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(['\"])([\\s\\S]*?)\\1", "i");
  const m = String(html || '').match(re);
  if (m) return m[2].replace(/&amp;/g, '&');
  const unquoted = String(html || '').match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*([^\\s>]+)', 'i'));
  return unquoted ? unquoted[1].replace(/&amp;/g, '&') : null;
}

function _tagContents(html, tagPattern) {
  const re = new RegExp('<(' + tagPattern + ')\\b[^>]*>([\\s\\S]*?)<\\/\\1>', 'i');
  const m = String(html || '').match(re);
  return m ? m[2] : '';
}

function _anchors(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const href = _attr(m[1], 'href');
    if (href) out.push({ href: href, attrs: m[1], inner: m[2], html: m[0] });
  }
  return out;
}

function _imageUrl(html, base) {
  const images = String(html || '').match(/<img\b[^>]*>/gi) || [];
  if (!images.length) return null;
  const tag = images.find(x => _attr(x, 'data-src')) ||
    images.find(x => _attr(x, 'data-lazy-src')) ||
    images.find(x => _attr(x, 'data-original')) ||
    images.find(x => _attr(x, 'src')) || images[0];
  const raw = _attr(tag, 'data-src') || _attr(tag, 'data-lazy-src') ||
    _attr(tag, 'data-original') || _attr(tag, 'src');
  if (!raw || /^(?:data:|about:blank)/i.test(raw)) return null;
  return _absolute(raw, base);
}

function _siteLink(raw, base) {
  if (!raw) return null;
  const rawValue = String(raw).trim().replace(/&amp;/g, '&');
  const full = _absolute(rawValue, base);
  if (!full || !/^https?:\/\//i.test(full)) return null;
  const host = _host(full);
  if (!_isKnownHost(host)) return null;

  const explicit = _readSetting('domain');
  const hasExplicitDomain = !!explicit && String(explicit).trim().toLowerCase() !== 'auto';
  const absoluteHref = /^https?:\/\//i.test(rawValue) || rawValue.indexOf('//') === 0;
  // Keep absolute upstream URLs intact: its episode token may be scoped to the
  // host that issued the link. Relative hrefs are resolved against the host
  // which actually served the episode page. Only an explicit domain choice
  // overrides these origins.
  if (absoluteHref && !hasExplicitDomain) return full;
  return (hasExplicitDomain ? _domain() : (_origin(base) || _domain())) + _pathQuery(full);
}

// ── Catalogue, search, and detail parsing ──────────────────────────────────

function _cardFromBlock(block, base) {
  const anchors = _anchors(block);
  for (const a of anchors) {
    if (!/\/anime\/[^/?#]+/i.test(a.href)) continue;
    const url = _siteLink(a.href, base);
    if (!url) continue;
    const header = _tagContents(block, 'h[1-6]');
    const titleClass = block.match(/<([a-z][a-z0-9]*)\b[^>]*class=["'][^"']*(?:spotlight-title|anime-title|card-title|title)["'][^>]*>([\s\S]*?)<\/\1>/i);
    const imageTag = (block.match(/<img\b[^>]*>/i) || [''])[0];
    let title = _htmlText(header || (titleClass && titleClass[2]) || a.inner);
    if (!title) title = _htmlText(_attr(block, 'title') || _attr(a.attrs, 'title') ||
      _attr(imageTag, 'alt') || '');
    if (!title || /^(watch now|details|view more|read more)$/i.test(title)) continue;
    return {
      id: url, title: title, englishTitle: title, url: url,
      cover: _imageUrl(block, base), type: 'anime', sourceId: SOURCE_ID
    };
  }
  return null;
}

function _parseCards(html, base, mode) {
  const source = String(html || '');
  const blocks = [];
  let m;
  const articleRe = /<article\b[^>]*>[\s\S]*?<\/article\s*>/gi;
  while ((m = articleRe.exec(source)) !== null) {
    const open = (m[0].match(/^<article\b[^>]*>/i) || [''])[0];
    blocks.push({
      html: m[0], attrs: open,
      spotlight: /spotlight-slide/i.test(open),
      latest: /episodeGrid|latest-panel|anime-card|latest|card/i.test(open)
    });
  }
  const liRe = /<li\b[^>]*>[\s\S]*?<\/li\s*>/gi;
  while ((m = liRe.exec(source)) !== null) {
    const open = (m[0].match(/^<li\b[^>]*>/i) || [''])[0];
    blocks.push({
      html: m[0], attrs: open,
      spotlight: /latestCompletedList|sidebar-list-panel|spotlight/i.test(open),
      latest: /latest|episode|sidebar-list-panel/i.test(open)
    });
  }
  const linkRe = /<a\b[^>]*href\s*=\s*(["'])[^"']*\/anime\/[^"']+\1[^>]*>[\s\S]*?<\/a\s*>/gi;
  while ((m = linkRe.exec(source)) !== null) {
    const open = (m[0].match(/^<a\b[^>]*>/i) || [''])[0];
    if (/anime-link/i.test(_attr(open, 'class') || '')) {
      blocks.push({ html: m[0], attrs: open, spotlight: false, latest: false });
    }
  }

  let chosen = blocks;
  if (mode === 'popular') {
    const preferred = blocks.filter(b => b.spotlight);
    if (preferred.length) chosen = preferred;
  } else if (mode === 'latest') {
    const preferred = blocks.filter(b => b.latest && !b.spotlight);
    if (preferred.length) chosen = preferred;
  }

  const out = [];
  const seen = Object.create(null);
  for (const block of chosen) {
    const card = _cardFromBlock(block.html, base);
    if (card && !seen[card.url]) {
      seen[card.url] = true;
      out.push(card);
    }
  }
  if (!out.length || mode === 'all') {
    for (const a of _anchors(source)) {
      if (!/\/anime\/[^/?#]+/i.test(a.href)) continue;
      const card = _cardFromBlock(a.html, base);
      if (card && !seen[card.url]) {
        seen[card.url] = true;
        out.push(card);
      }
    }
  }
  return out;
}

function _parseAnimeIndex(html, base) {
  const cards = _parseCards(html, base, 'all');
  if (cards.length) return cards;
  const out = [];
  const seen = Object.create(null);
  for (const a of _anchors(html)) {
    if (!/\/anime\/[^/?#]+/i.test(a.href)) continue;
    const url = _siteLink(a.href, base);
    const title = _htmlText(a.inner);
    if (!url || !title || seen[url] ||
        /^(home|stats|next|previous|login|a-z anime list)$/i.test(title)) continue;
    seen[url] = true;
    out.push({ id: url, title: title, englishTitle: title, url: url, cover: null,
      type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}

async function search(query, page, opts) {
  const q = String(query || '').trim();
  const p = Math.max(1, parseInt(page, 10) || 1);
  const base = _domain();
  const url = q
    ? base + '/search?q=' + encodeURIComponent(q) + '&page=' + p
    : base + '/anime?page=' + (p - 1);
  const response = await _fetchSite(url, base + '/');
  if (!response.body) return [];
  return q ? _parseCards(response.body, response.base, 'all')
    : _parseAnimeIndex(response.body, response.base);
}

function _metaContent(html, key, value) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (String(_attr(tag, key) || '').toLowerCase() === String(value).toLowerCase()) {
      return _attr(tag, 'content');
    }
  }
  return null;
}

function _detailFromHtml(url, html, base) {
  const title = _htmlText(_tagContents(html, 'h1')) ||
    _htmlText(_metaContent(html, 'property', 'og:title')) ||
    _slugFromAnimeUrl(url).replace(/[-_]+/g, ' ');
  let cover = _imageUrl(html, base) || _absolute(_metaContent(html, 'property', 'og:image'), base);
  const synopsisMatch = String(html || '').match(/<(?:div|p)[^>]*class=["'][^"']*(?:anime-synopsis|synopsis|description|overview|desc)[^"']*["'][^>]*>[\s\S]*?<\/(?:div|p)>/i);
  const description = _htmlText(synopsisMatch ? synopsisMatch[0] : '') ||
    _htmlText(_metaContent(html, 'name', 'description'));
  const genres = [];
  const genreRe = /<a\b([^>]*href\s*=\s*(["'])[^"']*\/(?:genre|tag)\/[^"']*\2[^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = genreRe.exec(String(html || ''))) !== null) {
    const name = _htmlText(m[3]);
    if (name && genres.indexOf(name) < 0) genres.push(name);
  }
  const slug = _slugFromAnimeUrl(url);
  const coverMatch = String(html || '').match(/<[^>]+style=["'][^"']*background[^"']*url\((["']?)(.*?)\1\)[^"']*["'][^>]*>/i);
  if (!cover && coverMatch) cover = _absolute(coverMatch[2], base);
  return {
    id: slug, title: title, englishTitle: title, url: _absolute(url, base),
    cover: cover || null, description: description || null, genres: genres,
    status: /class=["'][^"']*(?:airing|ongoing)[^"']*["']/i.test(html) ? 'ongoing' : 'completed',
    type: 'anime', sourceId: SOURCE_ID, episodes: [], malId: null
  };
}

// ── Episode parsing ───────────────────────────────────────────────────────

function _slugFromAnimeUrl(url) {
  const path = _pathOnly(url).replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  const i = parts.indexOf('anime');
  if (i >= 0 && parts[i + 1]) return _decode(parts[i + 1]);
  return _decode(parts[parts.length - 1] || '');
}

function _seasonList(html) {
  const seasons = [];
  const re = /\bdata-season\s*=\s*(["'])([^"']+)\1/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const value = String(m[2]).trim();
    if (value && seasons.indexOf(value) < 0) seasons.push(value);
  }
  const route = /\/episodes\/[^"'?#\s]+?\/(\d+)\/(?:\d+%20x%20\d+|\d+\s*x\s*\d+)/gi;
  while ((m = route.exec(String(html || ''))) !== null) {
    if (seasons.indexOf(m[1]) < 0) seasons.push(m[1]);
  }
  if (!seasons.length) seasons.push('1');
  return seasons.sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
}

function _episodeNumber(value) {
  const s = _decode(String(value || ''));
  for (const pattern of EPISODE_PATTERNS) {
    const m = s.match(pattern);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function _filenameFromUrl(url) {
  const path = _pathOnly(url);
  return _decode(path.substring(path.lastIndexOf('/') + 1));
}

function _episodeLabel(filename, label, number, slug, season) {
  // Prefer the name AV1Encodes actually returned. The old implementation
  // rebuilt every title as "Episode N" and discarded the source label, which
  // made metadata matching less reliable.
  const sourceLabel = _htmlText(label || '').trim();
  if (sourceLabel && !/^(?:download|watch|play|open|direct download)$/i.test(sourceLabel)) {
    return sourceLabel;
  }

  const n = Number(number) || _episodeNumber(filename) || _episodeNumber(label);
  const cleanFilename = String(_decode(filename || '')).replace(/\.(?:mkv|mp4)$/i, '');
  const nameMatch = cleanFilename.match(/\[(?:S\d{1,2}[-_ ]*)?E\d{1,4}\]\s*(.*?)\s*(?=\[|$)/i);
  let title = nameMatch ? _htmlText(nameMatch[1]) : '';
  title = title.replace(/\[(?:\d{3,4}p|dual|sub|dub|english\s*dub|tri|multi)[^\]]*\]/gi, ' ')
    .replace(/\b(?:dual|sub|dub|english\s*dub|tri|multi)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  if (title) return title;
  if (n > 0) return 'Episode ' + n;
  const fallback = _htmlText(label || cleanFilename || filename || '');
  return fallback || '';
}

function _episodeKey(url) {
  return _withoutQueryParams(url, ['token', DDL_QUERY_KEY]);
}

function _parseDownloadInfo(url) {
  const clean = _withoutQueryParams(url, [DDL_QUERY_KEY]);
  const path = _pathOnly(clean);
  const pieces = path.split('/').filter(Boolean);
  const idx = pieces.indexOf('download');
  if (idx < 0 || pieces.length < idx + 5) {
    return { modern: false, filename: _filenameFromUrl(clean), path: path };
  }
  return {
    modern: true,
    slug: _decode(pieces[idx + 1]),
    season: _decode(pieces[idx + 2]),
    resolution: _decode(pieces[idx + 3]),
    encodedFilename: pieces[pieces.length - 1],
    filename: _decode(pieces[pieces.length - 1]),
    path: path
  };
}

function _makeEpisodeUrl(base, slug, season, resolution, filename) {
  const name = encodeURIComponent(_decode(filename));
  return (_origin(base) || _domain()) + '/download/' + encodeURIComponent(slug) + '/' +
    encodeURIComponent(String(season)) + '/' + encodeURIComponent(resolution) + '/' + name;
}

function _episodeFromLink(rawHref, label, base, season, slug, resolution, number, ddl) {
  let href = _siteLink(rawHref, base);
  const filename = _filenameFromUrl(href || rawHref || '');
  if (!href && filename) href = _makeEpisodeUrl(base, slug, season, resolution, filename);
  if (!href) return null;

  // Use AV1Encodes' episode number when supplied. Only parse the filename as
  // a fallback; never invent episode 1 for an unparseable filename.
  const n = Number(number) || _episodeNumber(filename + ' ' + label) || null;
  if (ddl && typeof ddl === 'object' && _hasDdlLinks(ddl)) {
    // Cache only against the complete, original URL including its token.
    // Do not add a synthetic query parameter to the episode URL, because
    // Zangetsu uses that URL to match the source item to metadata episodes.
    DDL_BY_URL[href] = ddl;
  }
  const nativeLabel = _episodeLabel(filename, label, n, slug, season);
  return {
    id: href,
    number: n,
    title: nativeLabel,
    url: href,
    sourceId: SOURCE_ID
  };
}

function _parseEpisodeJson(body, base, slug, season, resolution) {
  let data;
  try { data = JSON.parse(String(body || '').trim()); } catch (e) { return []; }
  if (!Array.isArray(data)) {
    if (data && Array.isArray(data.episodes)) data = data.episodes;
    else if (data && Array.isArray(data.items)) data = data.items;
    else return [];
  }
  const out = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const href = item.href || item.url || item.path || item.download_url || item.downloadUrl;
    const filename = item.filename || item.file_name || item.fileName ||
      (href ? _filenameFromUrl(href) : '');
    const target = href || (filename ? _makeEpisodeUrl(base, slug, season, resolution, filename) : '');
    if (!target) continue;
    const ddl = item.ddl || item.DDL || null;
    const num = Number(item.num || item.number || item.episode || item.episode_number || 0);
    const ep = _episodeFromLink(target, item.label || item.title || item.name || '',
      base, season, slug, resolution, num, ddl);
    if (!ep) continue;
    out.push(ep);
  }
  return _uniqueEpisodes(out);
}

function _extractFilenames(html) {
  const names = [];
  const seen = Object.create(null);
  const add = raw => {
    const value = _decode(String(raw || '').trim()).replace(/^["']|["']$/g, '');
    if (!value || value.indexOf('/') >= 0 || !/\.(?:mkv|mp4)$/i.test(value)) return;
    if (!seen[value]) { seen[value] = true; names.push(value); }
  };
  for (const a of _anchors(html)) {
    if (/\/download\//i.test(a.href)) add(_filenameFromUrl(a.href));
  }
  FILENAME_RE.lastIndex = 0;
  let m;
  while ((m = FILENAME_RE.exec(String(html || ''))) !== null) add(m[1]);
  return names;
}

function _parseEpisodePage(html, base, slug, season, resolution) {
  const text = String(html || '');
  const fromJson = _parseEpisodeJson(text, base, slug, season, resolution);
  if (fromJson.length) return fromJson;
  const out = [];
  for (const a of _anchors(text)) {
    if (!/\/download\//i.test(a.href)) continue;
    const ep = _episodeFromLink(a.href, a.inner, base, season, slug, resolution);
    if (ep) out.push(ep);
  }
  if (out.length) return _uniqueEpisodes(out);
  for (const name of _extractFilenames(text)) {
    const ep = _episodeFromLink(_makeEpisodeUrl(base, slug, season, resolution, name),
      '', base, season, slug, resolution);
    if (ep) out.push(ep);
  }
  return _uniqueEpisodes(out);
}

function _episodeSeason(item) {
  const path = _pathOnly(item && (item.url || item.id) || '');
  const m = path.match(/\/download\/[^/]+\/(\d+)\//i);
  return m ? (parseInt(m[1], 10) || 1) : 1;
}

function _uniqueEpisodes(items) {
  const out = [];
  const seen = Object.create(null);
  for (const item of items || []) {
    const key = _episodeKey(item.url || item.id || '');
    if (key && !seen[key]) { seen[key] = true; out.push(item); }
  }
  // Zangetsu Mode maps source entries to metadata episodes by list position.
  // Always deliver chronological order (season ascending, episode ascending).
  return out.sort((a, b) => {
    const seasonDiff = _episodeSeason(a) - _episodeSeason(b);
    if (seasonDiff) return seasonDiff;
    const aNum = Number(a.number) || _episodeNumber(a.url + ' ' + a.title) || 0;
    const bNum = Number(b.number) || _episodeNumber(b.url + ' ' + b.title) || 0;
    return aNum - bNum;
  });
}

function _episodePageUrl(base, slug, season, resolution) {
  return (_origin(base) || _domain()) + '/episodes/' + encodeURIComponent(slug) + '/' +
    encodeURIComponent(String(season)) + '/' + encodeURIComponent(resolution);
}

async function _fetchSeasonEpisodes(slug, season, base, qualityCandidates) {
  for (const quality of qualityCandidates) {
    const pageUrl = _episodePageUrl(base, slug, season, quality);
    const response = await _fetchSite(pageUrl, base + '/', REQUEST_TIMEOUT_MS);
    if (!response.body) {
      // A network timeout or access challenge affects every resolution on this
      // host. Retrying four quality variants would multiply the same failure.
      if (response.status === 0 || response.status === 403 || response.status === 429 ||
          response.status >= 500 || response.reason === 'challenge') return [];
      continue;
    }
    const episodes = _parseEpisodePage(response.body, response.base || base, slug, season, quality);
    if (episodes.length) return episodes;
    if (response.status === 403 || response.status === 429 || response.status >= 500 ||
        response.reason === 'challenge') return [];
  }
  return [];
}

async function _episodesFromHtml(slug, base, html) {
  const seasons = _seasonList(html);
  const qualities = _qualityCandidates(_readSetting('quality'));
  const results = await Promise.all(seasons.map(season =>
    _fetchSeasonEpisodes(slug, season, base, qualities)
  ));
  return _uniqueEpisodes([].concat.apply([], results));
}

function _episodeCacheKey(url) {
  return String(url || '') + '|q=' + _qualityValue(_readSetting('quality')) +
    '|domain=' + _domain();
}

function _copyEpisodes(items) {
  return (items || []).map(item => Object.assign({}, item));
}

function _readEpisodeCache(url) {
  const key = _episodeCacheKey(url);
  const hit = EPISODE_CACHE[key];
  if (!hit) return null;
  if (Date.now() - hit.at > EPISODE_CACHE_TTL_MS) {
    delete EPISODE_CACHE[key];
    return null;
  }
  return _copyEpisodes(hit.episodes);
}

function _writeEpisodeCache(url, episodes) {
  if (!Array.isArray(episodes) || episodes.length === 0) return;
  EPISODE_CACHE[_episodeCacheKey(url)] = {
    at: Date.now(),
    episodes: _copyEpisodes(episodes)
  };
}

async function getEpisodes(url, opts) {
  const full = _canonicalSiteUrl(url, _domain()) || _absolute(url, _domain());
  const cached = _readEpisodeCache(full);
  if (cached) return cached;
  const slug = _slugFromAnimeUrl(full);
  const page = await _fetchSite(full, _domain() + '/');
  if (!page.body) return [];
  const episodes = await _episodesFromHtml(slug, page.base || _origin(full) || _domain(), page.body);
  _writeEpisodeCache(full, episodes);
  if (!episodes.length && typeof console !== 'undefined' && console.warn) {
    console.warn('[AV1Encodes] no episodes parsed for ' + full +
      ' (page host=' + (page.base || _origin(full) || 'unknown') + ')');
  }
  return episodes;
}

async function getDetail(url, opts) {
  const full = _canonicalSiteUrl(url, _domain()) || _absolute(url, _domain());
  const page = await _fetchSite(full, _domain() + '/');
  const base = page.base || _origin(full) || _domain();
  const detail = _detailFromHtml(page.url || full, page.body, base);
  if (page.body) {
    detail.episodes = await _episodesFromHtml(_slugFromAnimeUrl(full), base, page.body);
    _writeEpisodeCache(full, detail.episodes);
    if (!detail.episodes.length && typeof console !== 'undefined' && console.warn) {
      console.warn('[AV1Encodes] detail loaded but no episodes parsed for ' + full +
        ' (served by ' + base + ')');
    }
  }
  return detail;
}

// ── Playback and DDL extraction ───────────────────────────────────────────

function _hasDdlLinks(ddl) {
  if (!ddl || typeof ddl !== 'object') return false;
  return !!(ddl.stream_link || ddl.streamLink || ddl.download_link || ddl.downloadLink ||
    ddl.watch_link || ddl.watchLink || ddl.torrent_link || ddl.torrentLink);
}

function _ddlValue(ddl, snake, camel) {
  return ddl ? (ddl[snake] != null ? ddl[snake] : ddl[camel]) : null;
}

function _parseDdl(body) {
  let data;
  try { data = JSON.parse(String(body || '').trim()); } catch (e) { return null; }
  if (data && data.data && typeof data.data === 'object') data = data.data;
  if (data && data.ddl && typeof data.ddl === 'object') data = data.ddl;
  return data && typeof data === 'object' ? data : null;
}

function _getInlineDdl(url) {
  // Fast path for an exact URL observed in the upstream episode JSON. The
  // full URL (including token and filename) is the cache key, so entries
  // cannot leak across episodes. If the app restarts, fresh-token resolution
  // remains the fallback. Read old marker URLs for backward compatibility.
  const exact = String(url || '');
  const cached = DDL_BY_URL[exact];
  if (cached && _hasDdlLinks(cached)) return cached;
  const packed = _queryParam(url, DDL_QUERY_KEY);
  if (!packed) return null;
  try {
    const ddl = JSON.parse(packed);
    return _hasDdlLinks(ddl) ? ddl : null;
  } catch (e) {
    return null;
  }
}

function _findIframe(html) {
  const tags = String(html || '').match(/<iframe\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const src = _attr(tag, 'src');
    const id = _attr(tag, 'id') || '';
    if (src && (/anime-video-player/i.test(id) || /\/r\/|\/watch\//i.test(src))) return src;
  }
  return null;
}

function _findDdlToken(html) {
  const m = String(html || '').match(DDL_TOKEN_RE);
  return m ? m[1] : null;
}

function _labelResolution(resolution, filename) {
  const found = String(filename || '').match(/\[(\d{3,4}p)\]/i);
  if (found) return found[1];
  const value = String(resolution || '');
  for (const q of QUALITY_LIST) if (value === q.value || value.indexOf(q.label) >= 0) return q.label;
  return (value.match(/\d{3,4}p/i) || [])[0] || '1080p';
}

function _container(url) {
  if (/\.m3u8(?:[?#]|$)/i.test(url)) return 'hls';
  if (/\.mp4(?:[?#]|$)/i.test(url)) return 'mp4';
  return 'unknown';
}

function _mediaKind(filename) {
  const found = String(filename || '').match(/\[(Dual|Sub|Dub|English Dub|Tri|Multi)\]/i);
  const audio = found ? found[1] : '';
  const dubbed = /dub|dual|tri|multi/i.test(audio);
  return { kind: dubbed ? 'dub' : 'sub', audioLang: dubbed ? 'en' : 'ja' };
}

function _makeStream(url, label, filename, base) {
  if (!url || !/^https?:\/\/|^magnet:/i.test(String(url))) return null;
  const kind = _mediaKind(filename);
  return {
    url: String(url),
    quality: label,
    container: _container(String(url)),
    headers: { 'User-Agent': UA, Referer: (_origin(base) || _domain()) + '/' },
    kind: kind.kind,
    audioLang: kind.audioLang,
    subtitles: []
  };
}

function _buildDashUrl(watchUrl) {
  if (!watchUrl || !/^https?:\/\//i.test(watchUrl)) return null;
  const origin = _origin(watchUrl);
  const path = _pathOnly(watchUrl);
  const match = path.match(/\/watch\/([^/]+)\/?$/i);
  if (!origin || !match || !match[1]) return null;
  return origin + path.replace(/\/watch\/[^/]+\/?$/i, '/dash/' + match[1]) + '/manifest.mpd';
}

function _shouldFollow(url) {
  return /\/(?:redirect|r|watch)\//i.test(_pathOnly(url));
}

async function _resolveLink(raw, base, ref, context) {
  if (!raw) return null;
  const full = _absolute(raw, base);
  if (!full || /^magnet:/i.test(full)) return full;
  if (!/^https?:\/\//i.test(full)) return null;
  // Direct media/CDN URLs do not need an extra GET. Only follow site redirect,
  // player and watch routes, in parallel with the other DDL links.
  if (!_shouldFollow(full)) return full;
  const response = await _requestSiteUrl(full, ref || (_origin(base) || _domain()) + '/',
    {}, REDIRECT_TIMEOUT_MS, context);
  return response.ok && response.url ? response.url : full;
}

async function _streamsFromDdl(ddl, base, info, resolution, pageHtml, ref, context) {
  const iframe = _findIframe(pageHtml || '');
  const iframeUrl = iframe ? _absolute(iframe, base) : null;
  const watchRaw = iframeUrl || _ddlValue(ddl, 'watch_link', 'watchLink');
  const streamRaw = _ddlValue(ddl, 'stream_link', 'streamLink');
  const downloadRaw = _ddlValue(ddl, 'download_link', 'downloadLink');
  const torrentRaw = _readSetting('showTorrent') === true || String(_readSetting('showTorrent')).toLowerCase() === 'true'
    ? _ddlValue(ddl, 'torrent_link', 'torrentLink') : null;

  const jobs = await Promise.all([
    watchRaw ? _resolveLink(watchRaw, base, ref, context) : Promise.resolve(null),
    streamRaw ? _resolveLink(streamRaw, base, ref, context) : Promise.resolve(null),
    downloadRaw ? _resolveLink(downloadRaw, base, ref, context) : Promise.resolve(null),
    torrentRaw ? _resolveLink(torrentRaw, base, ref, context) : Promise.resolve(null)
  ]);
  const watch = jobs[0];
  const stream = jobs[1];
  const direct = jobs[2];
  const torrent = jobs[3];
  const label = 'AV1 · ' + _labelResolution(resolution || info.resolution, info.filename);
  const audio = (String(info.filename || '').match(/\[(Dual|Sub|Dub|English Dub|Tri|Multi)\]/i) || [])[1];
  const audioSuffix = audio ? ' [' + audio + ']' : '';
  const out = [];
  const dash = _buildDashUrl(watch);
  if (dash) out.push(_makeStream(dash, label + audioSuffix + ' · DASH', info.filename, base));
  if (stream && stream !== watch) out.push(_makeStream(stream, label + audioSuffix + ' · Stream', info.filename, base));
  if (direct && direct !== watch && direct !== stream) out.push(_makeStream(direct, label + audioSuffix + ' · Direct DL', info.filename, base));
  if (torrent) out.push(_makeStream(torrent, label + audioSuffix + ' · Torrent', info.filename, base));
  return out.filter(Boolean);
}

function _appendFreshToken(cleanUrl, token) {
  const clean = _withoutQueryParams(cleanUrl, ['token', DDL_QUERY_KEY]);
  return _setQueryParam(clean, 'token', token);
}

async function _getFreshToken(base, context) {
  const site = _origin(base) || _domain();
  if (context && context.tokenCache && context.tokenCache[site]) {
    return context.tokenCache[site];
  }
  const response = await _requestSiteUrl(site + '/get_token', site + '/', {
    Accept: 'application/json, */*;q=0.8',
    Referer: site + '/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin'
  }, REQUEST_TIMEOUT_MS, context);
  let token = null;
  if (response.ok && response.body) {
    try {
      const data = JSON.parse(response.body);
      const nested = data && data.data && typeof data.data === 'object' ? data.data : data;
      const found = nested && (nested.token || nested.access_token || nested.accessToken);
      if (typeof found === 'string' && found.trim()) token = found.trim();
    } catch (e) {}
    if (!token) {
      const m = response.body.match(/["'](?:token|access_token|accessToken)["']\s*:\s*["']([^"']+)["']/i);
      if (m) token = m[1];
    }
  }
  if (context && context.tokenCache) context.tokenCache[site] = token;
  return token;
}

async function _resolveDownloadPage(url, info, context) {
  const base = _origin(url) || _domain();
  const cleanUrl = _withoutQueryParams(url, ['token', DDL_QUERY_KEY]);
  const token = await _getFreshToken(base, context);
  if (!token) return { streams: [], stop: true, status: 0, reason: 'token-unavailable' };
  const downloadUrl = _appendFreshToken(cleanUrl, token);
  const page = await _requestSiteUrl(downloadUrl, base + '/', {}, REQUEST_TIMEOUT_MS, context);
  if (!page.ok || !page.body) {
    return { streams: [], stop: page.status === 403 || page.status === 429 ||
      page.status >= 500 || page.reason === 'challenge', status: page.status, reason: page.reason || 'download-failed' };
  }

  const filename = info.filename || _filenameFromUrl(cleanUrl);
  const iframe = _findIframe(page.body);
  const ddlToken = _findDdlToken(page.body);
  let ddl = null;
  if (ddlToken && info.encodedFilename) {
    const ddlUrl = base + '/get_ddl/' + info.encodedFilename;
    const response = await _requestSiteUrl(ddlUrl, downloadUrl, {
      Accept: 'application/json',
      Referer: downloadUrl,
      'X-Ddl-Token': ddlToken,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    }, REQUEST_TIMEOUT_MS, context);
    if (response.ok && response.body) ddl = _parseDdl(response.body);
  }
  const streams = await _streamsFromDdl(ddl, base,
    Object.assign({}, info, { filename: filename }), info.resolution,
    iframe ? '<iframe id="anime-video-player" src="' + iframe + '"></iframe>' : page.body,
    downloadUrl, context);
  if (streams.length) return { streams: streams, stop: false, status: page.status, reason: '' };

  // Never give the player the HTML download page. That was the old source's
  // most damaging failure mode and caused ExoPlayer to buffer on an HTML file.
  const hasPlayer = !!iframe || !!ddlToken;
  const terminalGeneratorError = /unable to generate download link|oops!?\s+something went wrong/i.test(page.body);
  return {
    streams: [], stop: page.status === 403 || page.status === 429 || page.status >= 500 ||
      page.reason === 'challenge',
    status: page.status,
    reason: terminalGeneratorError ? 'generator-failed' : (hasPlayer ? 'no-playable-url' : 'no-player')
  };
}

function _sameEpisode(a, b) {
  const na = _episodeNumber((a && a.filename) || (a && a.url) || '');
  const nb = _episodeNumber((b && b.filename) || (b && b.url) || '');
  if (na && nb) return na === nb;
  const fa = String((a && a.filename) || '').toLowerCase();
  const fb = String((b && b.filename) || '').toLowerCase();
  return !!fa && !!fb && fa === fb;
}

async function _findEpisodeAtResolution(info, resolution, base) {
  if (!info.slug || !info.season) return null;
  const page = await _fetchSite(_episodePageUrl(base, info.slug, info.season, resolution), base + '/');
  if (!page.body) return null;
  const entries = _parseEpisodePage(page.body, page.base || base, info.slug, info.season, resolution);
  const targetNo = _episodeNumber(info.filename);
  let selected = targetNo
    ? entries.find(ep => _episodeNumber(ep.url + ' ' + ep.title) === targetNo)
    : null;
  if (!selected) {
    const target = String(info.filename || '').toLowerCase();
    selected = entries.find(ep => _filenameFromUrl(ep.url).toLowerCase() === target);
  }
  return selected || null;
}

async function getVideoSources(episodeUrl) {
  const original = _absolute(episodeUrl, _domain());
  if (!original) return [];
  if (_isDirectMediaUrl(original)) {
    const directName = _filenameFromUrl(original);
    return [_makeStream(original, 'AV1 · ' + _labelResolution('', directName) + ' · Direct',
      directName, _origin(original) || _domain())].filter(Boolean);
  }

  const siteUrl = _canonicalSiteUrl(original, _domain()) || original;
  let info = _parseDownloadInfo(siteUrl);
  const filename = info.filename || _filenameFromUrl(siteUrl);
  if (!info.modern || !info.slug || !info.season || !info.filename) return [];
  info = Object.assign({}, info, { filename: filename });
  const base = _origin(siteUrl) || _domain();
  const context = { warmupUsed: false, tokenCache: Object.create(null) };
  const embeddedDdl = _getInlineDdl(original) || _getInlineDdl(siteUrl);
  const initialResolution = info.resolution || _qualityValue(_readSetting('quality'));
  const streams = embeddedDdl
    ? await _streamsFromDdl(embeddedDdl, base, info, initialResolution, '', base + '/', context)
    : [];
  if (streams.length) return _dedupeStreams(streams);

  // The first quality is the link selected in the episode list. Only one
  // alternate quality is attempted per resolve to stay within Zangetsu's
  // resolver budget. Episode listing itself still checks every quality.
  const candidates = _qualityCandidates(_readSetting('quality'));
  const alternate = candidates.find(q => q !== initialResolution);
  const attempts = [initialResolution];
  if (alternate) attempts.push(alternate);
  for (let index = 0; index < attempts.length; index++) {
    const resolution = attempts[index];
    let candidateUrl = siteUrl;
    let candidateInfo = info;
    if (resolution !== initialResolution) {
      const entry = await _findEpisodeAtResolution(info, resolution, base);
      if (!entry) continue;
      candidateUrl = entry.url;
      candidateInfo = _parseDownloadInfo(candidateUrl);
      candidateInfo = Object.assign({}, candidateInfo, { filename: candidateInfo.filename || filename });
      const data = _getInlineDdl(candidateUrl);
      if (data) {
        const fromData = await _streamsFromDdl(data, _origin(candidateUrl) || base,
          candidateInfo, resolution, '', _origin(candidateUrl) + '/', context);
        if (fromData.length) return _dedupeStreams(fromData);
        continue;
      }
    } else if (embeddedDdl) {
      // The embedded payload did not contain usable playable links. Fall
      // through to the fresh-token page flow below, not to its stale token.
    }

    const result = await _resolveDownloadPage(candidateUrl, candidateInfo, context);
    if (result.streams && result.streams.length) return _dedupeStreams(result.streams);
    if (index === attempts.length - 1 || result.stop) return [];
  }
  return [];
}

function _isDirectMediaUrl(url) {
  const path = _pathOnly(url);
  if (/\/download\//i.test(path)) return false;
  return /\.(?:m3u8|mp4|mkv|mpd)(?:$)/i.test(path);
}

function _dedupeStreams(items) {
  const out = [];
  const seen = Object.create(null);
  for (const item of items || []) {
    if (item && item.url && !seen[item.url]) {
      seen[item.url] = true;
      out.push(item);
    }
  }
  return out;
}

// ── Home sections ─────────────────────────────────────────────────────────

async function getHome(opts) {
  const base = _domain();
  const page = await _fetchSite(base + '/', base + '/');
  let popular = _parseCards(page.body, page.base || base, 'popular');
  let latest = _parseCards(page.body, page.base || base, 'latest');
  if (!popular.length || !latest.length) {
    const list = await _fetchSite(base + '/anime?page=0', base + '/');
    const all = _parseAnimeIndex(list.body, list.base || base);
    if (!popular.length) popular = all;
    if (!latest.length) latest = all;
  }
  const rows = [];
  if (popular.length) rows.push({ title: 'Popular', items: popular });
  if (latest.length) rows.push({ title: 'Latest', items: latest });
  return rows;
}

// Zangetsu's script-global runtime uses getStreams directly; CommonJS
// consumers use the same entry point via module.exports below.
function getStreams(episodeUrl, opts) {
  return getVideoSources(episodeUrl, opts);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION,
    getInfo: getInfo,
    getSettings: getSettings,
    getHome: getHome,
    search: search,
    getDetail: getDetail,
    getEpisodes: getEpisodes,
    getVideoSources: getVideoSources,
    getStreams: getStreams
  };
}
