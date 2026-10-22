// AV1Encodes native Zangetsu provider, rebuilt from the Yuzuno Aniyomi source.
// Key compatibility points: /episodes JSON (including embedded ddl), fresh
// /get_token handling for stale episode links, /get_ddl extraction, and DASH.
'use strict';

const SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'av1encodes';
const VERSION = '1.1.2';
const DEFAULT_DOMAIN = 'https://av1encodes.com';
const SITE_DOMAINS = [
  'https://av1encodes.com',
  'https://animealpha.cc',
  'https://av1please.com'
];
const LOGO = 'https://www.google.com/s2/favicons?sz=256&domain=av1encodes.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REQUEST_TIMEOUT_MS = 4500;
const REDIRECT_TIMEOUT_MS = 2500;
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
// The native Zangetsu fetch bridge does not retain ordinary Set-Cookie values
// between JavaScript fetch calls. Keep the small site session cookie set here.
const SITE_COOKIES = Object.create(null);

// ── Settings and provider contract ────────────────────────────────────────

function _readSetting(key) {
  try {
    const settings = typeof __settings !== 'undefined' && __settings
      ? __settings[SOURCE_ID] : null;
    if (!settings) return null;
    // Support current upstream setting names and previously saved Zangetsu values.
    const aliases = {
      domain: ['preferred_domain', 'domain'],
      preferred_domain: ['preferred_domain', 'domain'],
      quality: ['preferred_quality', 'quality'],
      preferred_quality: ['preferred_quality', 'quality'],
      preferred_link_type: ['preferred_link_type', 'preferredLinkType'],
      preferredLinkType: ['preferred_link_type', 'preferredLinkType'],
      showTorrent: ['show_torrent', 'showTorrent'],
      show_torrent: ['show_torrent', 'showTorrent']
    };
    for (const candidate of aliases[key] || [key]) {
      if (settings[candidate] !== undefined && settings[candidate] !== null) return settings[candidate];
    }
    return null;
  } catch (e) { return null; }
}

function _cleanDomain(value) {
  let raw = String(value || DEFAULT_DOMAIN).trim();
  if (!raw) raw = DEFAULT_DOMAIN;
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  const m = raw.match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1].replace(/\/+$/, '') : DEFAULT_DOMAIN;
}

function _domain() {
  const selected = _readSetting('preferred_domain');
  if (!selected || String(selected).trim().toLowerCase() === 'auto') return DEFAULT_DOMAIN;
  const normalized = _cleanDomain(selected);
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
      key: 'preferred_domain',
      label: 'Domain',
      description: 'Choose an official mirror. Auto tries the official domains and preserves the mirror that served the title.',
      type: 'enum',
      default: 'auto',
      options: [
        { value: 'auto', label: 'Auto (recommended)' },
        { value: 'https://av1encodes.com', label: 'av1encodes.com (default)' },
        { value: 'https://animealpha.cc', label: 'animealpha.cc' },
        { value: 'https://av1please.com', label: 'av1please.com (mirror)' }
      ]
    },
    {
      key: 'preferred_quality',
      label: 'Preferred Resolution',
      description: 'Episode discovery falls back to other resolutions when needed.',
      type: 'enum',
      default: '1920 x 1080',
      options: [
        { value: '1920 x 1080', label: '1080p' },
        { value: '1280 x 720', label: '720p' },
        { value: '854 x 480', label: '480p' },
        { value: '640 x 360', label: '360p' }
      ]
    },
    {
      key: 'preferred_link_type',
      label: 'Preferred Server / Hoster',
      description: 'Prefer this server type when multiple playable variants are available.',
      type: 'enum',
      default: 'Stream',
      options: [
        { value: 'Stream', label: 'Stream' },
        { value: 'Direct DL', label: 'Direct DL' },
        { value: 'Dash', label: 'Dash' },
        { value: 'Torrent', label: 'Torrent' }
      ]
    },
    {
      key: 'show_torrent',
      label: 'Show Torrent Link',
      description: 'Include a torrent link as a source when AV1Encodes provides one.',
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

  const explicit = _readSetting('preferred_domain');
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
  add(preferred || _domain());

  const configured = _readSetting('preferred_domain');
  const explicit = !!configured && String(configured).trim().toLowerCase() !== 'auto';
  // A manually selected domain is a strict override. Auto mode probes all
  // official mirrors in parallel, and preserves the origin of whichever one
  // actually served the title or episode link.
  if (explicit) return out;

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

function _cookieHeaderValues(headers) {
  const found = [];
  Object.keys(headers || {}).forEach(key => {
    if (String(key).toLowerCase() !== 'set-cookie') return;
    const raw = headers[key];
    (Array.isArray(raw) ? raw : [raw]).forEach(value => {
      if (value != null) {
        // Set-Cookie can be coalesced by the native bridge. Split only at a
        // comma followed by another cookie pair, not the comma in Expires.
        String(value).split(/,(?=\s*[^;,=\s]+=[^;,]*)/).forEach(part => found.push(part.trim()));
      }
    });
  });
  return found;
}

function _rememberCookies(url, headers) {
  const host = _host(url);
  if (!host) return;
  const jar = SITE_COOKIES[host] || (SITE_COOKIES[host] = Object.create(null));
  _cookieHeaderValues(headers).forEach(line => {
    const first = String(line).split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq <= 0) return;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    const expired = /;\s*max-age\s*=\s*0(?:\s*;|$)/i.test(String(line)) ||
      (String(line).match(/;\s*expires\s*=\s*([^;]+)/i) &&
       Date.parse(String(line).match(/;\s*expires\s*=\s*([^;]+)/i)[1]) < Date.now());
    if (expired) delete jar[name];
    else jar[name] = value;
  });
  if (!Object.keys(jar).length) delete SITE_COOKIES[host];
}

function _withSiteCookies(url, headers) {
  const out = _mergeHeaders(headers, {});
  const host = _host(url);
  const jar = (host && SITE_COOKIES[host]) || {};
  const cookieKey = Object.keys(out).find(key => String(key).toLowerCase() === 'cookie') || 'Cookie';
  const existing = String(out[cookieKey] || '').trim();
  const explicit = Object.create(null);
  existing.split(';').forEach(part => {
    const eq = part.indexOf('=');
    if (eq > 0) explicit[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  });
  const combined = [];
  Object.keys(jar).forEach(name => {
    if (!Object.prototype.hasOwnProperty.call(explicit, name)) combined.push(name + '=' + jar[name]);
  });
  if (existing) combined.push(existing);
  if (combined.length) out[cookieKey] = combined.join('; ');
  else if (out[cookieKey] == null) delete out[cookieKey];
  return out;
}

function _isSiteErrorBody(body) {
  const text = String(body || '');
  return /unable to generate download link|oops!?[ \t]+something went wrong|your ip has been blocked|access denied|temporarily unavailable/i.test(text);
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
    const requestHeaders = _withSiteCookies(url,
      _mergeHeaders(_headers(ref || base + '/', base, 'html'), extraHeaders));
    const response = await fetch(url, {
      headers: requestHeaders,
      redirect: 'follow',
      credentials: 'include',
      timeoutMs: timeoutMs || REQUEST_TIMEOUT_MS
    });
    const status = Number(response && response.status || 0);
    const finalUrl = response && response.url ? String(response.url) : url;
    // Persist only cookies explicitly returned by the site. This is required
    // because Zangetsu's JS-to-Dio bridge does not provide a browser cookie jar.
    _rememberCookies(finalUrl, response && response.headers ? response.headers : {});
    const body = response && typeof response.text === 'function'
      ? String(await response.text() || '')
      : (response && typeof response.body === 'string' ? response.body : '');
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
  const candidates = _siteBases(selected);
  const failures = [];
  let remaining = candidates.length;
  return new Promise(resolve => {
    let resolved = false;
    candidates.forEach((base, index) => {
      const target = base + path;
      // Each mirror owns its warm-up state. A 403 from one domain must not
      // consume the session-cookie retry for the other domains.
      _requestSiteUrl(target, ref || base + '/', {}, timeoutMs || REQUEST_TIMEOUT_MS,
        { warmupUsed: false })
        .then(response => {
          const terminalPage = response.body && _isSiteErrorBody(response.body);
          if (!resolved && response.ok && response.body && !terminalPage) {
            resolved = true;
            resolve(response);
            return;
          }
          const failedResponse = terminalPage
            ? Object.assign({}, response, { ok: false, reason: 'upstream-error' })
            : response;
          failures.push({ index, response: failedResponse });
          remaining--;
          if (!resolved && remaining === 0) {
            failures.sort((a, b) => a.index - b.index);
            const semantic = failures.find(item => item.response.reason === 'upstream-error');
            const last = semantic
              ? semantic.response
              : (failures.length ? failures[failures.length - 1].response : null);
            resolve({
              ok: false, status: last ? last.status : 0, body: '', url: rawUrl,
              base: last && last.base ? last.base : selected,
              reason: last && last.reason ? last.reason : 'unavailable'
            });
          }
        })
        .catch(() => {
          failures.push({ index, response: { ok: false, status: 0, body: '', base, reason: 'network' } });
          remaining--;
          if (!resolved && remaining === 0) {
            failures.sort((a, b) => a.index - b.index);
            const semantic = failures.find(item => item.response.reason === 'upstream-error');
            const last = semantic
              ? semantic.response
              : (failures.length ? failures[failures.length - 1].response : null);
            resolve({
              ok: false, status: last ? last.status : 0, body: '', url: rawUrl,
              base: last && last.base ? last.base : selected,
              reason: last && last.reason ? last.reason : 'unavailable'
            });
          }
        });
    });
  });
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

  const explicit = _readSetting('preferred_domain');
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

function _containerFlagsAt(source, position) {
  const tagRe = /<\/?(div|ul|section|aside|main|article|li)\b[^>]*>/gi;
  const stack = [];
  let match;
  while ((match = tagRe.exec(source)) !== null && match.index < position) {
    const raw = match[0];
    const tag = match[1].toLowerCase();
    if (/^<\//.test(raw)) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
    } else if (!/\/\s*>$/.test(raw)) {
      stack.push({
        tag: tag,
        popular: /id\s*=\s*["'](?:latestCompletedList|popularAnimeList)["']/i.test(raw) ||
          /class\s*=\s*["'][^"']*sidebar-list-panel[^"']*["']/i.test(raw),
        latest: /id\s*=\s*["']episodeGrid["']/i.test(raw) ||
          /class\s*=\s*["'][^"']*latest-panel[^"']*["']/i.test(raw)
      });
    }
  }
  return { popular: stack.some(x => x.popular), latest: stack.some(x => x.latest) };
}

function _parseCards(html, base, mode) {
  const source = String(html || '');
  const blocks = [];
  let m;
  const articleRe = /<article\b[^>]*>[\s\S]*?<\/article\s*>/gi;
  while ((m = articleRe.exec(source)) !== null) {
    const open = (m[0].match(/^<article\b[^>]*>/i) || [''])[0];
    const flags = _containerFlagsAt(source, m.index);
    blocks.push({ html: m[0], attrs: open, index: m.index,
      popular: /spotlight-slide/i.test(open) || flags.popular,
      latest: flags.latest || /(?:latest-panel|episodeGrid)/i.test(open) });
  }
  const liRe = /<li\b[^>]*>[\s\S]*?<\/li\s*>/gi;
  while ((m = liRe.exec(source)) !== null) {
    const open = (m[0].match(/^<li\b[^>]*>/i) || [''])[0];
    const flags = _containerFlagsAt(source, m.index);
    blocks.push({ html: m[0], attrs: open, index: m.index,
      popular: flags.popular || /latestCompletedList|sidebar-list-panel|spotlight/i.test(open),
      latest: flags.latest });
  }
  const linkRe = /<a\b[^>]*href\s*=\s*(["'])[^"']*\/anime\/[^"']+\1[^>]*>[\s\S]*?<\/a\s*>/gi;
  while ((m = linkRe.exec(source)) !== null) {
    const open = (m[0].match(/^<a\b[^>]*>/i) || [''])[0];
    if (/anime-link/i.test(_attr(open, 'class') || '')) {
      blocks.push({ html: m[0], attrs: open, index: m.index, popular: false, latest: false });
    }
  }
  let chosen = blocks;
  if (mode === 'popular') chosen = blocks.filter(x => x.popular);
  else if (mode === 'latest') chosen = blocks.filter(x => x.latest);
  chosen.sort((a, b) => a.index - b.index);

  const out = [], seen = Object.create(null);
  for (const block of chosen) {
    const card = _cardFromBlock(block.html, base);
    if (card && !seen[card.url]) { seen[card.url] = true; out.push(card); }
  }
  if (mode === 'all' && !out.length) {
    for (const a of _anchors(source)) {
      if (!/\/anime\/[^/?#]+/i.test(a.href)) continue;
      const card = _cardFromBlock(a.html, base);
      if (card && !seen[card.url]) { seen[card.url] = true; out.push(card); }
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
  let url;
  if (q) {
    url = base + '/search?q=' + encodeURIComponent(q) + '&page=' + p;
  } else {
    const filters = opts && typeof opts === 'object'
      ? (opts.filters && typeof opts.filters === 'object' ? opts.filters : opts) : {};
    const sortRaw = String(filters.sort || filters.sortBy || '').trim().toLowerCase();
    const typeRaw = String(filters.type || filters.audioType || '').trim().toLowerCase();
    const genreRaw = String(filters.genre || '').trim().toLowerCase();
    const sortMap = {
      'a-z':'a-z', az:'a-z', 'z-a':'z-a', za:'z-a',
      'episode count':'episodes', episodes:'episodes'
    };
    const typeMap = { sub:'sub', 'sub only':'sub', dual:'dual', 'dual audio':'dual' };
    const genreMap = {
      action:'action', adventure:'adventure', comedy:'comedy', drama:'drama',
      fantasy:'fantasy', horror:'horror', romance:'romance', 'sci-fi':'sci-fi'
    };
    const params = ['page=' + p];
    if (sortMap[sortRaw]) params.push('sort=' + encodeURIComponent(sortMap[sortRaw]));
    if (typeMap[typeRaw]) params.push('type=' + encodeURIComponent(typeMap[typeRaw]));
    if (genreMap[genreRaw]) params.push('genres=' + encodeURIComponent(genreMap[genreRaw]));
    url = base + '/anime?' + params.join('&');
  }
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

function _htmlInnerAt(source, tagName, afterOpen) {
  const voidTags = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  if (voidTags.test(tagName)) return '';
  const tokenRe = new RegExp('<\\/?' + tagName + '\\b[^>]*>', 'gi');
  tokenRe.lastIndex = afterOpen;
  let depth = 1;
  let match;
  while ((match = tokenRe.exec(source)) !== null) {
    if (/^<\//.test(match[0])) {
      depth--;
      if (depth === 0) return source.slice(afterOpen, match.index);
    } else if (!/\/\s*>$/.test(match[0])) {
      depth++;
    }
  }
  return source.slice(afterOpen);
}

function _firstClassElementText(html, predicate) {
  const source = String(html || '');
  const openRe = /<([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  let match;
  while ((match = openRe.exec(source)) !== null) {
    const tagName = match[1].toLowerCase();
    const attrs = match[0];
    const className = _attr(attrs, 'class') || '';
    if (!predicate(tagName, className, attrs)) continue;
    return _htmlText(_htmlInnerAt(source, tagName, openRe.lastIndex));
  }
  return null;
}

function _extractUpstreamGenres(html) {
  const source = String(html || '');
  const tokenRe = /<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  const stack = [];
  const genres = [];
  const voidTags = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  let match;

  while ((match = tokenRe.exec(source)) !== null) {
    const raw = match[0];
    const tagName = match[1].toLowerCase();
    if (/^<\//.test(raw)) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName === tagName) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const className = _attr(raw, 'class') || '';
    const classes = className.split(/\s+/).filter(Boolean);
    const href = _attr(raw, 'href') || '';
    const rel = _attr(raw, 'rel') || '';
    let selected = false;
    let value = '';

    if (tagName === 'link' && rel === 'tag' && href.indexOf('/genre/') >= 0) {
      selected = true;
      const path = href.split(/[?#]/)[0];
      const last = path.split('/').filter(Boolean).pop() || '';
      const decoded = _decode(last);
      value = decoded ? decoded.charAt(0).toUpperCase() + decoded.slice(1) : '';
    } else {
      const classSelector = classes.indexOf('genre-tag') >= 0 || classes.indexOf('tag') >= 0;
      const hrefSelector = tagName === 'a' && /\/(?:genre|tag)\//.test(href);
      const genreAncestor = tagName === 'a' && stack.some(item =>
        String(item.className || '').indexOf('genre') >= 0
      );
      selected = classSelector || hrefSelector || genreAncestor;
      if (selected) value = _htmlText(_htmlInnerAt(source, tagName, tokenRe.lastIndex));
    }

    if (selected && value && genres.indexOf(value) < 0) genres.push(value);
    if (!voidTags.test(tagName) && !/\/\s*>$/.test(raw)) {
      stack.push({ tagName: tagName, className: className });
    }
  }
  return genres;
}

function _extractDetailCover(html, base) {
  const source = String(html || '');
  const tokenRe = /<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
  const stack = [];
  const voidTags = /^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;
  let selectedImage = null;
  let backgroundNode = null;
  let bodyNode = null;
  let match;

  // Mirrors the upstream image selectors in document order.
  while ((match = tokenRe.exec(source)) !== null) {
    const raw = match[0];
    const tagName = match[1].toLowerCase();
    if (/^<\//.test(raw)) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName === tagName) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const className = _attr(raw, 'class') || '';
    if (tagName === 'body' && !bodyNode) bodyNode = raw;
    if (!backgroundNode && className &&
        (className.indexOf('poster') >= 0 || className.indexOf('hero') >= 0)) {
      backgroundNode = raw;
    }
    if (tagName === 'img' && !selectedImage) {
      const ownClasses = className.split(/\s+/);
      const ownPoster = ownClasses.indexOf('anime-poster') >= 0 || ownClasses.indexOf('poster') >= 0;
      const matchingAncestor = stack.some(item =>
        item.tagName === 'main' ||
        String(item.className || '').indexOf('anime-hero') >= 0 ||
        String(item.className || '').indexOf('poster') >= 0 ||
        String(item.className || '').indexOf('hero') >= 0
      );
      if (ownPoster || matchingAncestor) selectedImage = raw;
    }

    if (!voidTags.test(tagName) && !/\/\s*>$/.test(raw)) {
      stack.push({ tagName: tagName, className: className });
    }
  }

  if (selectedImage) {
    const raw = _attr(selectedImage, 'data-src') ||
      _attr(selectedImage, 'data-lazy-src') || _attr(selectedImage, 'src');
    if (raw) {
      if (/^(?:data:|about:blank)/i.test(raw)) return raw;
      const resolved = _absolute(raw, base);
      if (resolved) return resolved;
    }
  }

  const ogImage = _metaContent(source, 'property', 'og:image');
  if (ogImage) return _absolute(ogImage, base) || ogImage;

  // Match upstream fallback: poster/hero background, then body background if
  // no matching poster/hero element exists.
  const fallback = backgroundNode || bodyNode;
  if (fallback) {
    const style = _attr(fallback, 'style') || '';
    const bg = style.match(/url\(['"]([^'"]+)['"]\)/i);
    if (bg && bg[1]) {
      if (/^https?:\/\//i.test(bg[1])) return bg[1];
      return (_origin(base) || base) + '/' + bg[1].replace(/^\/+/, '');
    }
  }
  return null;
}

function _detailTitleFallback(opts) {
  if (typeof opts === 'string') return opts;
  if (!opts || typeof opts !== 'object') return '';
  if (typeof opts.title === 'string') return opts.title;
  if (opts.anime && typeof opts.anime.title === 'string') return opts.anime.title;
  if (opts.metadata && typeof opts.metadata.title === 'string') return opts.metadata.title;
  return '';
}

function _detailFromHtml(url, html, base, opts) {
  const source = String(html || '');
  const heading = source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
  // Upstream uses the website H1, falling back to the existing anime title;
  // it does not synthesize SEO copy or a guessed title from the URL slug.
  const title = heading ? _htmlText(heading[1]) : _detailTitleFallback(opts);
  const cover = _extractDetailCover(source, base);
  const description = _firstClassElementText(source, (tagName, className) =>
    className.split(/\s+/).some(value =>
      value === 'anime-synopsis' || value === 'synopsis' ||
      value === 'description' || value === 'desc'
    ) || /synopsis|description|overview/.test(className)
  );

  let genres = _extractUpstreamGenres(source);
  if (!genres.length) {
    const animeMeta = _firstClassElementText(source, (tagName, className) =>
      tagName === 'p' && className.split(/\s+/).indexOf('anime-meta') >= 0
    );
    if (animeMeta !== null) {
      const index = animeMeta.indexOf('Genre:');
      const after = index >= 0 ? animeMeta.slice(index + 'Genre:'.length) : animeMeta;
      const fallbackGenre = after.split('|')[0].trim();
      if (fallbackGenre) genres = fallbackGenre.split(',').map(value => value.trim()).filter(Boolean);
    }
  }

  const author = _firstClassElementText(source, (tagName, className) =>
    className.indexOf('studio') >= 0
  );
  const isAiring = /<[^>]+\bclass\s*=\s*["'][^"']*airing[^"']*["'][^>]*>/i.test(source);
  const slug = _slugFromAnimeUrl(url);

  return {
    id: slug,
    title: title,
    englishTitle: title,
    url: _absolute(url, base),
    cover: cover || null,
    description: description === null ? null : description,
    genres: genres,
    author: author === null ? null : author,
    status: isAiring ? 'ongoing' : 'completed',
    type: 'anime',
    sourceId: SOURCE_ID,
    episodes: [],
    malId: null
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
  const clean = String(_decode(filename || '')).replace(/\.(?:mkv|mp4)$/i, '').trim();
  const match = clean.match(/\[(?:S\d{1,2}[-_ ]*)?E(\d{1,4})\]\s*(.+?)\s*\[/i);
  const audio = clean.match(/\[(Dual|Sub|Dub|English Dub|Tri|Multi)\]/i);
  const suffix = audio ? ' [' + audio[1] + ']' : '';
  if (match) return 'Season ' + (season || '1') + ' Ep ' + match[1] + ' - ' +
    _htmlText(match[2]).trim() + suffix;
  const stripped = clean.replace(/\[\d{3,4}p\].*$/i, '').trim();
  const fallback = _htmlText(label || stripped || '');
  if (String(season || '1') !== '1' && String(season || '').trim()) {
    return 'Season ' + season + ' - ' + (fallback || stripped);
  }
  return fallback || stripped || ('Season ' + (season || '1'));
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

function _episodeFromLink(rawHref, label, base, season, slug, resolution, number, ddl, useSourceLabel) {
  let href = _siteLink(rawHref, base);
  const filename = _filenameFromUrl(href || rawHref || '');
  if (!href && filename) href = _makeEpisodeUrl(base, slug, season, resolution, filename);
  if (!href) return null;
  const n = Number(number) || _episodeNumber(filename + ' ' + label);
  if (ddl && typeof ddl === 'object' && _hasDdlLinks(ddl)) {
    // Keep the signed upstream href unchanged. Cache embedded DDL in memory
    // instead of adding a private query parameter that can affect positional matching.
    DDL_BY_URL[href] = ddl;
    DDL_BY_URL[_withoutQueryParams(href, [DDL_QUERY_KEY])] = ddl;
  }
  const sourceLabel = String(label || '').trim();
  const title = useSourceLabel && sourceLabel ? _htmlText(sourceLabel)
    : _episodeLabel(filename, '', n, slug, season);
  return { id: href, number: n || 1, title: title || ('Season ' + (season || '1')),
    url: href, sourceId: SOURCE_ID };
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
      base, season, slug, resolution, num, ddl, true);
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
  // Some site endpoints encode a season index in the download URL while the
  // visible episode label carries the actual season name. Metadata in Zangetsu
  // is matched by list position, so the title's explicit season must win.
  const title = String(item && item.title || '');
  const namedSeason = title.match(/^\s*Season\s*(\d{1,2})\b/i);
  if (namedSeason) return parseInt(namedSeason[1], 10) || 1;
  const compactSeason = title.match(/^\s*S(\d{1,2})\s*[-_ ]*E\d{1,4}\b/i);
  if (compactSeason) return parseInt(compactSeason[1], 10) || 1;
  const path = _pathOnly(item && (item.url || item.id) || '');
  const m = path.match(/\/download\/[^/]+\/(\d+)\//i);
  return m ? (parseInt(m[1], 10) || 1) : 1;
}

function _episodeSortNumber(item) {
  // Prefer the filename/title's actual episode number over a JSON ordinal,
  // which may count across seasons and would pair the wrong catalogue metadata.
  const filenameNumber = _episodeNumber(_filenameFromUrl(item && (item.url || item.id) || ''));
  if (filenameNumber) return filenameNumber;
  const titleNumber = _episodeNumber(item && item.title || '');
  return titleNumber || Number(item && item.number) || 0;
}

function _uniqueEpisodes(items) {
  const out = [];
  const seen = Object.create(null);
  for (const item of items || []) {
    const key = _episodeKey(item.url || item.id || '');
    if (key && !seen[key]) { seen[key] = true; out.push(item); }
  }
  // Zangetsu Mode maps source entries to metadata episodes by list position.
  // Sort by the visible season/episode identity, not a route index or a
  // whole-show JSON ordinal, so rich catalogue metadata stays paired with the
  // corresponding source row.
  return out.sort((a, b) => {
    const seasonDiff = _episodeSeason(a) - _episodeSeason(b);
    if (seasonDiff) return seasonDiff;
    return _episodeSortNumber(a) - _episodeSortNumber(b);
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
  if (!page.body) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[AV1Encodes] anime page unavailable status=' + page.status +
        ' reason=' + (page.reason || 'unknown') + ' url=' + full);
    }
    return [];
  }
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
  if (!page.body && typeof console !== 'undefined' && console.warn) {
    console.warn('[AV1Encodes] detail page unavailable status=' + page.status +
      ' reason=' + (page.reason || 'unknown') + ' url=' + full);
  }
  const detail = _detailFromHtml(page.url || full, page.body, base, opts);
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
  const cached = DDL_BY_URL[exact] || DDL_BY_URL[_withoutQueryParams(exact, [DDL_QUERY_KEY])];
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
  if (/\.mpd(?:[?#]|$)/i.test(url)) return 'dash';
  if (/\.mp4(?:[?#]|$)/i.test(url)) return 'mp4';
  if (/\.mkv(?:[?#]|$)/i.test(url)) return 'mkv';
  return 'unknown';
}

function _mediaKind(filename) {
  const found = String(filename || '').match(/\[(Dual|Sub|Dub|English Dub|Tri|Multi)\]/i);
  const audio = found ? found[1] : '';
  const dubbed = /dub|dual|tri|multi/i.test(audio);
  return { kind: dubbed ? 'dub' : 'sub', audioLang: dubbed ? 'en' : 'ja' };
}

function _makeStream(url, label, filename, base, linkType) {
  if (!url || !/^https?:\/\/|^magnet:/i.test(String(url))) return null;
  const kind = _mediaKind(filename);
  return {
    url: String(url), quality: label, container: _container(String(url)),
    headers: { 'User-Agent': UA, Referer: (_origin(base) || _domain()) + '/' },
    kind: kind.kind, audioLang: kind.audioLang, subtitles: [],
    linkType: linkType || 'Stream', preferred: false
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
  if (!_shouldFollow(full)) return full;
  const response = await _requestSiteUrl(full, ref || (_origin(base) || _domain()) + '/',
    {}, REDIRECT_TIMEOUT_MS, context);
  if (!response.ok || !response.url || _isSiteErrorBody(response.body || '')) return null;
  const finalUrl = String(response.url);
  // Watch pages feed DASH URL construction; an unresolved redirect route is not media.
  if (/\/(?:redirect|r)\//i.test(_pathOnly(finalUrl))) return null;
  return finalUrl;
}

function _preferredLinkType() {
  return String(_readSetting('preferred_link_type') || 'Stream').trim().toLowerCase();
}

function _sortAndMarkPreferred(streams) {
  const output = [];
  const seen = Object.create(null);
  for (const item of streams || []) {
    if (!item || !item.url) continue;
    const key = String(item.url) + '|' + String(item.linkType || 'Stream');
    if (!seen[key]) { seen[key] = true; output.push(item); }
  }
  const preferredType = _preferredLinkType();
  output.sort((a, b) => {
    const aa = String(a.linkType || '').toLowerCase() === preferredType;
    const bb = String(b.linkType || '').toLowerCase() === preferredType;
    return (bb ? 1 : 0) - (aa ? 1 : 0);
  });
  return output.map((item, index) => Object.assign({}, item, { preferred: index === 0 }));
}

async function _streamsFromDdl(ddl, base, info, resolution, pageHtml, ref, context) {
  const iframe = _findIframe(pageHtml || '');
  const iframeUrl = iframe ? _absolute(iframe, base) : null;
  const watchRaw = iframeUrl || _ddlValue(ddl, 'watch_link', 'watchLink');
  const streamRaw = _ddlValue(ddl, 'stream_link', 'streamLink');
  const downloadRaw = _ddlValue(ddl, 'download_link', 'downloadLink');
  const showTorrent = _readSetting('show_torrent') === true ||
    String(_readSetting('show_torrent')).toLowerCase() === 'true';
  const torrentRaw = showTorrent ? _ddlValue(ddl, 'torrent_link', 'torrentLink') : null;
  const jobs = await Promise.all([
    watchRaw ? _resolveLink(watchRaw, base, ref, context) : Promise.resolve(null),
    streamRaw ? _resolveLink(streamRaw, base, ref, context) : Promise.resolve(null),
    downloadRaw ? _resolveLink(downloadRaw, base, ref, context) : Promise.resolve(null),
    torrentRaw ? _resolveLink(torrentRaw, base, ref, context) : Promise.resolve(null)
  ]);
  const watch = jobs[0], stream = jobs[1], direct = jobs[2], torrent = jobs[3];
  const res = _labelResolution(resolution || info.resolution, info.filename);
  const label = 'AV1 · ' + res;
  const audio = (String(info.filename || '').match(/\[(Dual|Sub|Dub|English Dub|Tri|Multi)\]/i) || [])[1];
  const suffix = audio ? ' [' + audio + ']' : '';
  const output = [];
  const dash = _buildDashUrl(watch);
  if (dash) output.push(_makeStream(dash, label + suffix + ' · DASH', info.filename, base, 'Dash'));

  const streamSource = stream || direct;
  if (streamSource) output.push(_makeStream(streamSource, label + suffix + ' · Stream',
    info.filename, base, 'Stream'));
  if (direct) output.push(_makeStream(direct, label + suffix + ' · Direct DL',
    info.filename, base, 'Direct DL'));
  if (torrent) output.push(_makeStream(torrent, label + suffix + ' · Torrent',
    info.filename, base, 'Torrent'));
  return output.filter(Boolean);
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
  const originalBase = _origin(url) || _domain();
  // AV1Encodes issues a signed token on each episode href. Match the current
  // upstream flow by trying that href first, not replacing its token with a
  // speculative /get_token request before the browser/player page is opened.
  let downloadUrl = _withoutQueryParams(url, [DDL_QUERY_KEY]);
  let currentInfo = Object.assign({}, info);
  let page = await _fetchSite(downloadUrl, originalBase + '/', REQUEST_TIMEOUT_MS);
  let base = page.base || _origin(page.url) || _origin(downloadUrl) || originalBase;
  let iframe = page.body ? _findIframe(page.body) : null;
  let ddlToken = page.body ? _findDdlToken(page.body) : null;

  const hasPlayablePage = () => !!iframe || !!ddlToken;
  const generatorFailed = () =>
    /unable to generate download link|oops!?\s+something went wrong/i.test(page.body || '');

  // Current Aniyomi refreshes the episode href from /episodes when the signed
  // download page no longer contains the player. This is the primary refresh
  // path; keep the source's original filename and episode number for matching.
  if (!hasPlayablePage()) {
    const preferredResolution = currentInfo.resolution || _qualityValue(_readSetting('quality'));
    const fresh = await _findEpisodeAtResolution(currentInfo, preferredResolution, base);
    const freshUrl = fresh && fresh.url
      ? _withoutQueryParams(fresh.url, [DDL_QUERY_KEY])
      : null;
    if (freshUrl && freshUrl !== downloadUrl) {
      downloadUrl = freshUrl;
      const parsed = _parseDownloadInfo(downloadUrl);
      currentInfo = Object.assign({}, parsed, {
        filename: currentInfo.filename || parsed.filename || _filenameFromUrl(downloadUrl)
      });
      page = await _fetchSite(downloadUrl, base + '/', REQUEST_TIMEOUT_MS);
      base = page.base || _origin(page.url) || _origin(downloadUrl) || base;
      iframe = page.body ? _findIframe(page.body) : null;
      ddlToken = page.body ? _findDdlToken(page.body) : null;
    }
  }

  // Compatibility fallback only when the signed href could not be refreshed
  // and the page did not show a terminal generator error. Do not use this as
  // the normal playback entry path; recent site versions tie tokens to hrefs.
  if (!hasPlayablePage() && !generatorFailed() && page.reason !== 'upstream-error') {
    const freshToken = await _getFreshToken(base, context);
    const currentToken = _queryParam(downloadUrl, 'token');
    if (freshToken && freshToken !== currentToken) {
      const clean = _withoutQueryParams(downloadUrl, ['token', DDL_QUERY_KEY]);
      downloadUrl = _appendFreshToken(clean, freshToken);
      page = await _fetchSite(downloadUrl, base + '/', REQUEST_TIMEOUT_MS);
      base = page.base || _origin(page.url) || _origin(downloadUrl) || base;
      iframe = page.body ? _findIframe(page.body) : null;
      ddlToken = page.body ? _findDdlToken(page.body) : null;
    }
  }

  if (!page.body) {
    return {
      streams: [],
      stop: page.status === 403 || page.status === 429 || page.status >= 500 ||
        page.reason === 'challenge',
      status: page.status,
      reason: page.reason || 'download-failed'
    };
  }

  const filename = currentInfo.filename || _filenameFromUrl(downloadUrl);
  let ddl = null;
  if (ddlToken && currentInfo.encodedFilename) {
    const ddlUrl = base + '/get_ddl/' + currentInfo.encodedFilename;
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

  const streams = await _streamsFromDdl(
    ddl, base, Object.assign({}, currentInfo, { filename: filename }),
    currentInfo.resolution, page.body, downloadUrl, context
  );
  if (streams.length) return { streams: streams, stop: false, status: page.status, reason: '' };

  // Never send the generated HTML error page to the video player as media.
  return {
    streams: [],
    stop: page.status === 403 || page.status === 429 || page.status >= 500 ||
      page.reason === 'challenge',
    status: page.status,
    reason: generatorFailed() ? 'generator-failed' : (hasPlayablePage() ? 'no-playable-url' : 'no-player')
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

async function getVideoSources(episodeUrl, opts) {
  const original = _absolute(episodeUrl, _domain());
  if (!original) return [];
  if (_isDirectMediaUrl(original)) {
    const name = _filenameFromUrl(original);
    const stream = _makeStream(original, 'AV1 · ' + _labelResolution('', name) + ' · Direct',
      name, _origin(original) || _domain(), 'Direct DL');
    return _sortAndMarkPreferred(stream ? [stream] : []);
  }

  const siteUrl = _canonicalSiteUrl(original, _domain()) || original;
  const info = _parseDownloadInfo(siteUrl);
  if (!info.modern || !info.slug || !info.season || !info.filename) return [];

  const base = _origin(siteUrl) || _domain();
  const context = { warmupUsed: false, tokenCache: Object.create(null) };
  const preferredResolution = info.resolution || _qualityValue(_readSetting('preferred_quality'));
  const resolutions = [preferredResolution].concat(
    QUALITY_LIST.map(item => item.value).filter(value => value !== preferredResolution)
  );
  const embeddedDdl = _getInlineDdl(original) || _getInlineDdl(siteUrl);

  // Current upstream tests every quality candidate and matches the same episode.
  const tasks = resolutions.map(async resolution => {
    let candidateUrl = siteUrl;
    let candidateInfo = Object.assign({}, info, { resolution: resolution });
    if (resolution !== preferredResolution) {
      const episode = await _findEpisodeAtResolution(info, resolution, base);
      if (!episode || !episode.url) return [];
      candidateUrl = episode.url;
      const parsed = _parseDownloadInfo(candidateUrl);
      candidateInfo = Object.assign({}, parsed, {
        filename: parsed.filename || info.filename,
        resolution: parsed.resolution || resolution
      });
    }

    let ddl = resolution === preferredResolution ? embeddedDdl : _getInlineDdl(candidateUrl);
    if (!ddl) {
      const cached = DDL_BY_URL[candidateUrl] || DDL_BY_URL[_withoutQueryParams(candidateUrl, [DDL_QUERY_KEY])];
      if (cached && _hasDdlLinks(cached)) ddl = cached;
    }
    let streams = [];
    if (ddl && _hasDdlLinks(ddl)) {
      streams = await _streamsFromDdl(ddl, _origin(candidateUrl) || base,
        candidateInfo, resolution, '', candidateUrl, context);
    }
    if (!streams.length) {
      const result = await _resolveDownloadPage(candidateUrl, candidateInfo, context);
      streams = result && Array.isArray(result.streams) ? result.streams : [];
    }
    return streams;
  });

  return _sortAndMarkPreferred([].concat.apply([], await Promise.all(tasks)));
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
  const servedBy = page.base || base;
  let popular = _parseCards(page.body, servedBy, 'popular');
  let latest = _parseCards(page.body, servedBy, 'latest');
  if (!popular.length || !latest.length) {
    const listing = await _fetchSite(base + '/anime?page=0', base + '/');
    const all = _parseAnimeIndex(listing.body, listing.base || base);
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
