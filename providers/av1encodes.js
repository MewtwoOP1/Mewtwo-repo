// AV1Encodes / AnimeAlpha native Zangetsu provider.
// Ported from the current Yuzono Aniyomi AV1Encodes source:
// https://github.com/yuzono/anime-extensions
// Supports the current /episodes/{slug}/{season}/{resolution} and
// /download/{slug}/{season}/{resolution}/{filename}?token=... routes.

'use strict';

const SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID)
  : 'av1encodes';
const VERSION = '1.2.3';
const DEFAULT_DOMAIN = 'https://av1encodes.com';
const MIRROR_DOMAINS = [
  // av1please.com currently serves the rebranded AnimeAlpha site. Put it
  // first after the requested/preferred host so bounded playback fallbacks
  // still reach a working public mirror before spending the source budget.
  'https://av1please.com',
  'https://animealpha.cc',
  'https://av1encodes.com'
];
const LOGO = 'https://www.google.com/s2/favicons?sz=256&domain=av1encodes.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const RESOLUTIONS = ['1920 x 1080', '1280 x 720', '854 x 480', '640 x 360'];
const REQUEST_TIMEOUT_MS = 1500;
const WARMUP_TIMEOUT_MS = 900;
const RES_LABELS = {
  '1920 x 1080': '1080p',
  '1280 x 720': '720p',
  '854 x 480': '480p',
  '640 x 360': '360p'
};
const TOKEN_RE = /['"](A{4,}[A-Za-z0-9_\-]{10,})['"]/;
const EPISODE_RE = /\[(?:S\d{1,2}-)?E(\d{1,4})\]|\bE(\d{1,4})\b/i;
const FILENAME_RE = /([a-zA-Z0-9_ \-\[\]().%]+?\.(?:mkv|mp4))/gi;

// ── Settings and runtime info ─────────────────────────────────────────────

function getSettings() {
  return [
    {
      key: 'domain',
      label: 'Domain',
      description: 'Preferred AV1Encodes domain. Known mirrors are tried automatically if it is unavailable.',
      type: 'text',
      default: DEFAULT_DOMAIN
    },
    {
      key: 'quality',
      label: 'Preferred quality',
      description: 'Preferred resolution. The provider falls back to other available resolutions.',
      type: 'enum',
      default: '1080p',
      options: [
        { value: '1080p', label: '1080p' },
        { value: '720p', label: '720p' },
        { value: '480p', label: '480p' },
        { value: '360p', label: '360p' }
      ]
    }
  ];
}

function _readSetting(key) {
  try {
    const s = typeof __settings !== 'undefined' && __settings
      ? __settings[SOURCE_ID]
      : null;
    return s && s[key] != null ? s[key] : null;
  } catch (e) {
    return null;
  }
}

function _domain() {
  const value = String(_readSetting('domain') || DEFAULT_DOMAIN).trim();
  if (!value) return DEFAULT_DOMAIN;
  let clean = value.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(clean)) clean = 'https://' + clean;
  return /^https?:\/\/[^/]+$/i.test(clean) ? clean : DEFAULT_DOMAIN;
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
  const output = [first];
  for (const r of RESOLUTIONS) {
    if (output.indexOf(r) < 0) output.push(r);
  }
  return output;
}

function _resolutionLabel(value, filename) {
  const found = String(filename || '').match(/\[(\d{3,4}p)\]/i);
  if (found) return found[1];
  const decoded = _decode(value || '');
  return RES_LABELS[decoded] || (decoded.match(/\d{3,4}p/i) || [])[0] || '1080p';
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

// ── URL, text, and request helpers ────────────────────────────────────────

function _origin(url) {
  const m = String(url || '').match(/^(https?:\/\/[^/?#]+)/i);
  return m ? m[1].replace(/\/$/, '') : null;
}

function _host(url) {
  const origin = _origin(url);
  if (!origin) return '';
  return origin.replace(/^https?:\/\//i, '').split(':')[0].toLowerCase();
}

function _pathQuery(url) {
  const value = String(url || '').trim();
  if (/^https?:\/\//i.test(value)) {
    const m = value.match(/^https?:\/\/[^/?#]+([^#]*)/i);
    return m && m[1] ? m[1] : '/';
  }
  if (value.indexOf('//') === 0) {
    const m = value.match(/^\/\/[^/?#]+([^#]*)/);
    return m && m[1] ? m[1] : '/';
  }
  if (!value) return '/';
  return value.charAt(0) === '/' ? value.split('#')[0] : '/' + value.split('#')[0];
}

function _stripTokenParam(url) {
  const full = _absolute(url, _domain());
  if (!full) return url;
  const origin = _origin(full) || _domain();
  const pathQuery = _pathQuery(full).split('#')[0];
  const queryAt = pathQuery.indexOf('?');
  if (queryAt < 0) return origin + pathQuery;
  const path = pathQuery.slice(0, queryAt);
  const query = pathQuery.slice(queryAt + 1);
  const kept = query.split('&').filter(part => {
    if (!part) return false;
    const key = _decode(part.split('=')[0]).toLowerCase();
    return key !== 'token';
  });
  return origin + path + (kept.length ? '?' + kept.join('&') : '');
}

function _appendAccessToken(url, token) {
  const clean = _stripTokenParam(url);
  if (!token) return clean;
  return clean + (clean.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(token);
}

async function _getFreshAccessToken(base, ref) {
  const requestBase = _origin(base) || _domain();
  const response = await _fetchSite(
    requestBase + '/get_token',
    ref || requestBase + '/',
    {
      'Accept': 'application/json, */*;q=0.8',
      'Referer': requestBase + '/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    }
  );
  const body = String(response.body || '').trim();
  let token = null;
  if (body) {
    try {
      const parsed = JSON.parse(body);
      const value = parsed && (parsed.token || parsed.access_token || parsed.accessToken);
      if (typeof value === 'string' && value.trim()) token = value.trim();
    } catch (e) {}
    if (!token) {
      const match = body.match(/["'](?:token|access_token|accessToken)["']\s*:\s*["']([^"']+)["']/i);
      if (match) token = match[1];
    }
  }
  return { token, base: response.base || requestBase, status: response.status || 0 };
}

function _isDirectMediaUrl(url) {
  const value = String(url || '');
  if (/\/download\//i.test(_pathQuery(value))) return false;
  return /\.(?:m3u8|mp4|mkv|mpd)(?:[?#]|$)/i.test(value);
}

function _trustedSiteHost(host) {
  const h = String(host || '').toLowerCase();
  const roots = ['av1encodes.com', 'animealpha.cc', 'av1please.com'];
  return roots.some(root => h === root || h.endsWith('.' + root));
}

function _siteBases(url) {
  const bases = [];
  const add = value => {
    const origin = _origin(value);
    if (origin && bases.indexOf(origin) < 0) bases.push(origin);
  };
  add(url);
  add(_domain());
  for (const mirror of MIRROR_DOMAINS) add(mirror);
  return bases;
}

function _isTransientSiteFailure(status) {
  const code = Number(status) || 0;
  return code === 0 || code === 403 || code === 408 || code === 429 || code >= 500;
}

function _absolute(url, base) {
  if (!url) return null;
  const value = String(url).trim().replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(value)) return value;
  if (value.indexOf('//') === 0) return 'https:' + value;
  const origin = _origin(base) || _domain();
  if (value.charAt(0) === '/') return origin + value;
  return origin + '/' + value;
}

function _siteLink(raw, base) {
  if (!raw) return null;
  const full = _absolute(raw, base);
  if (!full) return null;
  const host = _host(full);
  if (!_trustedSiteHost(host) && host !== _host(_domain())) return null;
  const origin = _origin(base) || _domain();
  return origin + _pathQuery(full);
}

function _headers(ref, base) {
  return {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': ref || ((base || _domain()) + '/'),
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin'
  };
}

function _mergeHeaders(baseHeaders, extra) {
  const out = {};
  Object.keys(baseHeaders || {}).forEach(k => { out[k] = baseHeaders[k]; });
  Object.keys(extra || {}).forEach(k => { out[k] = extra[k]; });
  return out;
}

function _adaptReferer(ref, base) {
  if (!ref) return base + '/';
  if (_trustedSiteHost(_host(ref)) || _host(ref) === _host(_domain())) {
    return base + _pathQuery(ref);
  }
  return ref;
}

async function _warmupSite(base) {
  // The current upstream extension performs a normal homepage request after
  // HTTP 403 so the site's av1_client_id/session cookie can be established.
  // This does not solve or automate a CAPTCHA; it only performs a regular GET.
  try {
    const r = await fetch(base + '/', {
      headers: _headers(base + '/', base),
      redirect: 'follow',
      credentials: 'include',
      timeoutMs: WARMUP_TIMEOUT_MS
    });
    if (r.ok && typeof r.text === 'function') {
      await r.text();
    } else if (r.body && typeof r.body.cancel === 'function') {
      try { r.body.cancel(); } catch (e) {}
    }
  } catch (e) {}
}

async function _fetchSite(url, ref, extraHeaders) {
  const path = _pathQuery(url);
  // Playback endpoints run inside Zangetsu's per-source timeout; limit their
  // mirror sweep. Catalogue/search requests keep the complete mirror list.
  const latencySensitive = /^\/(?:get_token(?:[/?]|$)|download\/|episodes\/|get_ddl\/)/i.test(path);
  const candidates = latencySensitive ? _siteBases(url).slice(0, 3) : _siteBases(url);
  let lastStatus = 0;

  for (const base of candidates) {
    const target = base + path;
    let warmed = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(target, {
          headers: _mergeHeaders(_headers(_adaptReferer(ref, base), base), extraHeaders),
          redirect: 'follow',
          credentials: 'include',
          timeoutMs: REQUEST_TIMEOUT_MS
        });
        lastStatus = r.status || 0;
        if (!r.ok) {
          if (r.body && typeof r.body.cancel === 'function') {
            try { r.body.cancel(); } catch (e) {}
          }
          if (lastStatus === 403 && !warmed) {
            warmed = true;
            await _warmupSite(base);
            continue;
          }
          break;
        }
        const body = await r.text();
        // Do not treat an interstitial as the site's catalog/player markup. Move
        // to the next published mirror instead of trying to defeat the challenge.
        if (/Just a moment\.\.\.|cf-chl-|turnstile/i.test(body) &&
            /cloudflare|challenge-platform|captcha/i.test(body)) {
          break;
        }
        // A download-page application may render an HTTP-200 error when its
        // signed download link expired. Treat it as unavailable and try mirrors.
        if (/\/download\//i.test(path) &&
            /unable to generate download link|generating download link|oops!?\s+something went wrong/i.test(body)) {
          break;
        }
        // /get_token must return JSON containing an actual token. An HTTP-200
        // HTML/interstitial response is not a successful token lookup; try mirrors.
        if (/\/get_token(?:\?|$)/i.test(path) &&
            !/["'](?:token|access_token|accessToken)["']\s*:\s*["'][^"']+["']/i.test(body)) {
          break;
        }
        const finalUrl = r.url || target;
        const finalBase = _origin(finalUrl);
        return {
          body,
          url: finalUrl,
          base: finalBase && (_trustedSiteHost(_host(finalUrl)) || _host(finalUrl) === _host(_domain()))
            ? finalBase
            : base,
          status: r.status || 200
        };
      } catch (e) {
        break;
      }
    }
  }
  return { body: '', url: url, base: _origin(url) || _domain(), status: lastStatus };
}

async function _resolveLink(raw, base, ref) {
  if (!raw) return null;
  const full = _absolute(raw, base);
  if (!full) return null;
  const origin = _origin(full) || base || _domain();
  const isSite = _trustedSiteHost(_host(full)) || _host(full) === _host(_domain());
  const candidates = isSite ? _siteBases(full).slice(0, 3) : [origin];
  const path = _pathQuery(full);

  for (const candidate of candidates) {
    const target = candidate + path;
    let warmed = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(target, {
          headers: _headers(_adaptReferer(ref, candidate), candidate),
          redirect: 'follow',
          credentials: 'include',
          timeoutMs: REQUEST_TIMEOUT_MS
        });
        const status = r.status || 0;
        const finalUrl = r.url || target;
        if (r.body && typeof r.body.cancel === 'function') {
          try { r.body.cancel(); } catch (e) {}
        }
        if (r.ok && finalUrl) return finalUrl;
        if (status === 403 && !warmed && isSite) {
          warmed = true;
          await _warmupSite(candidate);
          continue;
        }
        break;
      } catch (e) {
        break;
      }
    }
  }
  return full;
}

function _decode(value) {
  try { return decodeURIComponent(String(value || '').replace(/\+/g, '%2B')); }
  catch (e) { return String(value || ''); }
}

function _text(html) {
  return String(html || '')
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
      const code = parseInt(n, 10);
      return code > 0 && code <= 0x10ffff ? String.fromCharCode(code) : all;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function _attr(html, name) {
  const re = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*([\'"])([\\s\\S]*?)\\1', 'i');
  const m = String(html || '').match(re);
  return m ? m[2].replace(/&amp;/g, '&') : null;
}

function _innerTag(html, tagPattern) {
  const re = new RegExp('<(' + tagPattern + ')\\b[^>]*>([\\s\\S]*?)<\\/\\1>', 'i');
  const m = String(html || '').match(re);
  return m ? m[2] : '';
}

function _firstImage(html, base) {
  const tags = String(html || '').match(/<img\b[^>]*>/gi) || [];
  if (!tags.length) return null;
  const tag = tags.find(t => _attr(t, 'data-src')) ||
    tags.find(t => _attr(t, 'data-lazy-src')) ||
    tags.find(t => _attr(t, 'src')) || tags[0];
  const raw = _attr(tag, 'data-src') || _attr(tag, 'data-lazy-src') ||
    _attr(tag, 'src') || _attr(tag, 'data-original');
  return raw ? _absolute(raw, base) : null;
}

function _anchorList(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const href = _attr(m[1], 'href');
    if (href) out.push({ href, attrs: m[1], inner: m[2], html: m[0] });
  }
  return out;
}

function _episodeNumber(value) {
  const s = _decode(String(value || ''));
  const m = s.match(EPISODE_RE) || s.match(/\bEpisode\s*(\d{1,4})\b/i);
  const n = m ? parseInt(m[1] || m[2], 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function _filenameFromUrl(url) {
  const path = _pathQuery(url).split('?')[0];
  const last = path.substring(path.lastIndexOf('/') + 1);
  return _decode(last);
}

function _filenameFromHtml(html) {
  const out = [];
  const seen = {};
  FILENAME_RE.lastIndex = 0;
  let m;
  while ((m = FILENAME_RE.exec(String(html || ''))) !== null) {
    const name = _decode(m[1]).trim();
    if (name && !seen[name]) {
      seen[name] = true;
      out.push(name);
    }
  }
  return out;
}

function _normaliseEpisodeTitle(value) {
  return _text(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function _episodeTitleRemainder(value, number, slug) {
  let out = _text(value || '');
  if (!out) return '';
  out = out.replace(/^\s*(?:season|s)\s*\d+\s*[-–—:]?\s*/i, '');
  const prefix = out.match(/^(?:episode|ep\.?|e)\s*0*(\d{1,4})\b/i);
  if (number > 0 && prefix && parseInt(prefix[1], 10) === number) {
    out = out.slice(prefix[0].length).replace(/^\s*[-–—:.)]+\s*/, '');
  }
  out = out
    .replace(/\[(?:\d{3,4}p|dual|sub|dub|english\s*dub|tri|multi)[^\]]*\]/gi, ' ')
    .replace(/\b(?:english\s+dub|dual|sub|dub|tri|multi)\b/gi, ' ')
    .replace(/\[\d{3,4}p\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–—:.)]+\s*/, '')
    .trim();
  if (!out) return '';
  const titleKey = _normaliseEpisodeTitle(out);
  // Episode filenames often repeat the series name and original release year,
  // e.g. "[S01-E01] JoJo's Bizarre Adventure 2012 [360p] [Dual].mkv".
  const titleWithoutYear = titleKey.replace(/(?:19|20)\d{2}$/, '');
  const slugKey = _normaliseEpisodeTitle(slug);
  if (slugKey && (titleKey === slugKey || titleWithoutYear === slugKey ||
      (number > 0 && (titleKey === slugKey + 'episode' + number ||
        titleWithoutYear === slugKey + 'episode' + number)))) {
    return '';
  }
  if (number > 0 && /^(?:episode|ep\.?|e)?\s*0*\d+$/i.test(out)) return '';
  return out;
}

function _episodeLabel(filename, season, label, slug, preferredNumber) {
  const labelText = _text(label || '');
  const clean = _decode(String(filename || ''))
    .replace(/\.(mkv|mp4)$/i, '')
    .trim();
  const match = clean.match(/\[(?:S\d{1,2}-)?E(\d{1,4})\]\s*(.*?)\s*(?=\[|$)/i);
  const preferred = parseInt(preferredNumber, 10);
  const n = preferred > 0
    ? preferred
    : (match ? parseInt(match[1], 10) : (_episodeNumber(clean) || _episodeNumber(labelText)));
  if (n > 0) {
    const filenameTitle = match ? _episodeTitleRemainder(match[2], n, slug) : '';
    const labelTitle = _episodeTitleRemainder(labelText, n, slug);
    const title = filenameTitle || labelTitle;
    // Zangetsu Mode pairs source rows with catalogue episodes by index. Keep
    // source-only labels generic so AniList/MAL titles, stills and synopses win.
    return 'Episode ' + n + (title ? ' - ' + title : '');
  }
  const fallback = clean
    .replace(/\s*\[(?:\d{3,4}p|dual|sub|dub|english\s*dub|tri|multi)[^\]]*\]/gi, '')
    .replace(/\s*\[\d{3,4}p\].*$/i, '')
    .trim();
  const candidate = _episodeTitleRemainder(labelText, 0, slug);
  return candidate || fallback || labelText || 'Episode';
}

// ── Catalog / search parsing ───────────────────────────────────────────────

function _addCard(out, seen, block, base) {
  const anchors = _anchorList(block).filter(a => /\/anime\//i.test(a.href));
  for (const a of anchors) {
    const href = _siteLink(a.href, base);
    if (!href || !/\/anime\/[^/?#]+/i.test(href) || seen[href]) continue;
    const titleBlock = _innerTag(block, 'h[1-6]');
    const classTitle = block.match(/<([a-z][a-z0-9]*)\b[^>]*class=['"][^'"]*(?:spotlight-title|anime-title|card-title|title)[^'"]*['"][^>]*>([\s\S]*?)<\/\1>/i);
    let title = _text(titleBlock || (classTitle && classTitle[2]) || a.inner);
    if (!title) title = _text(_attr(block, 'title') || _attr(a.attrs, 'title') || '');
    if (!title) {
      const img = (block.match(/<img\b[^>]*>/i) || [''])[0];
      title = _text(_attr(img, 'alt') || '');
    }
    if (!title || /^(watch now|details|view more)$/i.test(title)) continue;
    seen[href] = true;
    out.push({
      id: href,
      title,
      englishTitle: title,
      url: href,
      cover: _firstImage(block, base),
      type: 'anime',
      sourceId: SOURCE_ID
    });
    break;
  }
}

function _parseCards(html, base, mode) {
  const source = String(html || '');
  const blocks = [];
  const articleRe = /<article\b[^>]*>[\s\S]*?<\/article\s*>/gi;
  let m;
  while ((m = articleRe.exec(source)) !== null) {
    const open = (m[0].match(/^<article\b[^>]*>/i) || [''])[0];
    blocks.push({
      html: m[0],
      tag: 'article',
      attrs: open,
      spotlight: /spotlight-slide/i.test(open),
      latest: /anime-card|latest|episode|card/i.test(open)
    });
  }
  const liRe = /<li\b[^>]*>[\s\S]*?<\/li\s*>/gi;
  while ((m = liRe.exec(source)) !== null) {
    const open = (m[0].match(/^<li\b[^>]*>/i) || [''])[0];
    blocks.push({
      html: m[0],
      tag: 'li',
      attrs: open,
      spotlight: /spotlight|latestCompletedList|sidebar-list-panel/i.test(open),
      latest: /latest|sidebar-list-panel/i.test(open)
    });
  }

  // Some current layouts use standalone a.anime-link or cards built from divs.
  // Restrict this generic pass to links that carry a title/image, then dedupe.
  const standaloneRe = /<a\b[^>]*href\s*=\s*(['"])[^'"]*\/anime\/[^'"]+\1[^>]*>[\s\S]*?<\/a\s*>/gi;
  while ((m = standaloneRe.exec(source)) !== null) {
    const cls = _attr((m[0].match(/^<a\b[^>]*>/i) || [''])[0], 'class') || '';
    if (/anime-link/i.test(cls)) {
      blocks.push({ html: m[0], tag: 'a', attrs: m[0], spotlight: false, latest: false });
    }
  }

  let chosen = blocks;
  if (mode === 'popular') {
    const preferred = blocks.filter(b => b.spotlight ||
      /latestCompletedList|sidebar-list-panel/i.test(b.attrs));
    if (preferred.length) chosen = preferred;
  } else if (mode === 'latest') {
    const preferred = blocks.filter(b => !b.spotlight &&
      (b.latest || b.tag === 'article' || b.tag === 'li'));
    if (preferred.length) chosen = preferred;
  }

  const out = [];
  const seen = {};
  for (const block of chosen) _addCard(out, seen, block.html, base);

  // Search/index pages are not consistently wrapped in article/li elements;
  // inspect all anime anchors there. For home sections, preserve the selected
  // section when it parsed successfully to avoid mixing Popular and Latest.
  if (mode === 'all' || !out.length) {
    for (const anchor of _anchorList(source)) {
      if (!/\/anime\//i.test(anchor.href)) continue;
      _addCard(out, seen, anchor.html, base);
    }
  }
  return out;
}

function _parseAnimeIndex(html, base) {
  let items = _parseCards(html, base, 'all');
  if (items.length) return items;
  const out = [];
  const seen = {};
  const anchors = _anchorList(html);
  for (const a of anchors) {
    if (!/\/anime\//i.test(a.href)) continue;
    const href = _siteLink(a.href, base);
    const title = _text(a.inner);
    if (!href || !title || seen[href] || /^(home|stats|next|previous|login)$/i.test(title)) continue;
    seen[href] = true;
    out.push({
      id: href, title, englishTitle: title, url: href, cover: null,
      type: 'anime', sourceId: SOURCE_ID
    });
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
  const items = q
    ? _parseCards(response.body, response.base, 'all')
    : _parseAnimeIndex(response.body, response.base);
  return items;
}

// ── Anime details and episode listing ─────────────────────────────────────

function _seasons(html) {
  const output = [];
  const re = /\bdata-season\s*=\s*(['"])([^'"]+)\1/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const value = String(m[2]).trim();
    if (value && output.indexOf(value) < 0) output.push(value);
  }
  const routeRe = /\/episodes\/[^"'?#\s]+?\/(\d+)\/(?:\d+%20x%20\d+|\d+\s*x\s*\d+)/gi;
  while ((m = routeRe.exec(String(html || ''))) !== null) {
    if (output.indexOf(m[1]) < 0) output.push(m[1]);
  }
  if (!output.length) output.push('1');
  return output.sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));
}

function _genres(html) {
  const out = [];
  const re = /<a\b([^>]*href\s*=\s*(['"])[^'"]*\/(?:genre|tag)\/[^'"]*\2[^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) {
    const genre = _text(m[3]);
    if (genre && out.indexOf(genre) < 0) out.push(genre);
  }
  const clsRe = /<[^>]+class=['"][^'"]*(?:genre-tag|genre)[^'"]*['"][^>]*>([\s\S]*?)<\/[^>]+>/gi;
  while ((m = clsRe.exec(String(html || ''))) !== null) {
    const genre = _text(m[1]);
    if (genre && out.indexOf(genre) < 0) out.push(genre);
  }
  return out;
}

function _detailFromHTML(url, html, base) {
  const h1 = _innerTag(html, 'h1');
  const title = _text(h1) || _text(_attr((String(html).match(/<meta\b[^>]*property=['"]og:title['"][^>]*>/i) || [''])[0], 'content')) ||
    _filenameFromUrl(url).replace(/-/g, ' ');
  const imageTag = (String(html).match(/<img\b[^>]*>/i) || [''])[0];
  const cover = _firstImage(html, base) ||
    _absolute(_attr((String(html).match(/<meta\b[^>]*property=['"]og:image['"][^>]*>/i) || [''])[0], 'content'), base) ||
    _absolute(_attr(imageTag, 'src'), base);
  const descriptionMatch = String(html).match(
    /<(?:div|p)[^>]*class=['"][^'"]*(?:anime-synopsis|synopsis|description|overview|desc)[^'"]*['"][^>]*>[\s\S]*?<\/(?:div|p)>/i
  );
  const description = _text(descriptionMatch ? descriptionMatch[0] : '');
  const metaDescription = _attr((String(html).match(/<meta\b[^>]*name=['"]description['"][^>]*>/i) || [''])[0], 'content');
  const genres = _genres(html);
  const status = /class=['"][^'"]*(?:airing|ongoing)[^'"]*['"]/i.test(html) ? 'ongoing' : 'completed';
  const full = _absolute(url, base);
  const slug = _slugFromAnimeUrl(full);
  return {
    id: slug,
    title: title || slug,
    englishTitle: title || slug,
    url: full,
    cover,
    description: description || _text(metaDescription) || null,
    genres,
    status,
    type: 'anime',
    sourceId: SOURCE_ID,
    episodes: [],
    malId: null
  };
}

function _slugFromAnimeUrl(url) {
  const path = _pathQuery(url).split('?')[0].replace(/\/+$/, '');
  return _decode(path.substring(path.lastIndexOf('/') + 1));
}

function _normaliseSeasonResolution(value) {
  const decoded = _decode(value || '');
  const resolution = _qualityValue(decoded);
  return RESOLUTIONS.indexOf(decoded) >= 0 ? decoded : resolution;
}

function _episodePageUrl(base, slug, season, resolution) {
  return base + '/episodes/' + encodeURIComponent(slug) + '/' +
    encodeURIComponent(String(season)) + '/' + encodeURIComponent(resolution);
}

function _makeEpisodeUrl(base, slug, season, resolution, filename) {
  return base + '/download/' + encodeURIComponent(slug) + '/' +
    encodeURIComponent(String(season)) + '/' + encodeURIComponent(resolution) + '/' +
    encodeURIComponent(filename);
}

function _episodeFromLink(rawHref, label, base, season, slug, resolution) {
  let href = _siteLink(rawHref, base);
  const filename = _filenameFromUrl(href || rawHref);
  if (!href && filename) href = _makeEpisodeUrl(base, slug, season, resolution, filename);
  if (!href) return null;
  const num = _episodeNumber(filename + ' ' + label);
  return {
    id: href,
    number: num || 1,
    title: _episodeLabel(filename, season, label, slug),
    url: href,
    sourceId: SOURCE_ID
  };
}

function _parseEpisodeJSON(html, base, slug, season, resolution) {
  let data;
  try { data = JSON.parse(String(html || '').trim()); } catch (e) { return []; }
  if (!Array.isArray(data)) {
    if (data && Array.isArray(data.episodes)) data = data.episodes;
    else if (data && Array.isArray(data.items)) data = data.items;
    else return [];
  }
  const out = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const href = item.href || item.url || item.path || item.download_url || item.downloadUrl;
    const filename = item.filename || item.file_name || item.fileName || (href ? _filenameFromUrl(href) : '');
    const generated = href || (filename ? _makeEpisodeUrl(base, slug, season, resolution, _decode(filename)) : '');
    if (!generated) continue;
    const episode = _episodeFromLink(generated, item.label || item.title || item.name || '', base, season, slug, resolution);
    if (!episode) continue;
    const num = Number(item.num || item.number || item.episode || item.episode_number || 0);
    if (num > 0) {
      episode.number = num;
      episode.title = _episodeLabel(filename || _filenameFromUrl(generated), season,
        item.label || item.title || item.name || '', slug, num);
    } else if (item.label || item.title || item.name) {
      episode.title = _episodeLabel(filename || _filenameFromUrl(generated), season,
        item.label || item.title || item.name, slug);
    }
    out.push(episode);
  }
  return out;
}

function _parseEpisodePage(html, base, slug, season, resolution) {
  const text = String(html || '');
  const json = _parseEpisodeJSON(text, base, slug, season, resolution);
  if (json.length) return _uniqueEpisodes(json);

  const out = [];
  const anchors = _anchorList(text).filter(a => /\/download\//i.test(a.href));
  for (const a of anchors) {
    const episode = _episodeFromLink(a.href, a.inner, base, season, slug, resolution);
    if (episode) out.push(episode);
  }
  if (out.length) return _uniqueEpisodes(out);

  for (const filename of _filenameFromHtml(text)) {
    const href = _makeEpisodeUrl(base, slug, season, resolution, filename);
    const episode = _episodeFromLink(href, '', base, season, slug, resolution);
    if (episode) out.push(episode);
  }
  return _uniqueEpisodes(out);
}

function _episodeSeason(item) {
  const path = _pathQuery(item && (item.url || item.id) || '').split('?')[0];
  const match = path.match(/\/download\/[^/]+\/(\d+)\//i);
  return match ? (parseInt(match[1], 10) || 1) : 1;
}

function _uniqueEpisodes(items) {
  const out = [];
  const seen = {};
  for (const item of items) {
    const key = String(item.url || item.id || item.number + ':' + item.title);
    if (!seen[key]) {
      seen[key] = true;
      out.push(item);
    }
  }
  // Zangetsu Mode maps provider entries to catalogue episodes by list position.
  // Keep seasons and episodes chronological, never newest-first.
  return out.sort((a, b) => {
    const seasonDiff = _episodeSeason(a) - _episodeSeason(b);
    if (seasonDiff) return seasonDiff;
    const aNum = Number(a.number) || _episodeNumber(a.url + ' ' + a.title) || 0;
    const bNum = Number(b.number) || _episodeNumber(b.url + ' ' + b.title) || 0;
    return aNum - bNum;
  });
}

async function _fetchEpisodes(slug, base, animeHTML) {
  let html = animeHTML || '';
  let activeBase = base;
  if (!html) {
    const detail = await _fetchSite(base + '/anime/' + encodeURIComponent(slug), base + '/');
    html = detail.body;
    activeBase = detail.base || base;
  }
  if (!html) return [];

  const all = [];
  const seen = {};
  const seasons = _seasons(html);
  const qualities = _qualityCandidates(_readSetting('quality'));
  for (const season of seasons) {
    let foundForSeason = [];
    for (const resolution of qualities) {
      const epPage = await _fetchSite(_episodePageUrl(activeBase, slug, season, resolution), activeBase + '/');
      if (!epPage.body) continue;
      const items = _parseEpisodePage(epPage.body, epPage.base || activeBase, slug, season, resolution);
      if (items.length) {
        foundForSeason = items;
        activeBase = epPage.base || activeBase;
        break;
      }
    }
    for (const episode of foundForSeason) {
      const key = episode.url || episode.id;
      if (!seen[key]) {
        seen[key] = true;
        all.push(episode);
      }
    }
  }
  return _uniqueEpisodes(all);
}

async function getDetail(url, opts) {
  const full = _absolute(url, _domain());
  const page = await _fetchSite(full, _domain() + '/');
  const base = page.base || _origin(full) || _domain();
  const detail = _detailFromHTML(page.url || full, page.body, base);
  detail.episodes = await _fetchEpisodes(_slugFromAnimeUrl(full), base, page.body);
  return detail;
}

async function getEpisodes(url, opts) {
  const full = _absolute(url, _domain());
  const page = await _fetchSite(full, _domain() + '/');
  const slug = _slugFromAnimeUrl(full);
  return _fetchEpisodes(slug, page.base || _origin(full) || _domain(), page.body);
}

// ── Download URLs and stream extraction ───────────────────────────────────

function _downloadInfo(url) {
  const path = _pathQuery(url).split('?')[0].split('#')[0];
  const parts = path.split('/').filter(Boolean);
  const idx = parts.indexOf('download');
  if (idx < 0) return { modern: false, filename: _filenameFromUrl(url), path };
  const tail = parts.slice(idx + 1);
  if (tail.length >= 4) {
    return {
      modern: true,
      slug: _decode(tail[0]),
      season: _decode(tail[1]),
      resolution: _decode(tail[2]),
      encodedFilename: tail[tail.length - 1],
      filename: _decode(tail[tail.length - 1]),
      path
    };
  }
  return {
    modern: false,
    slug: tail.length > 1 ? _decode(tail[0]) : '',
    season: '1',
    resolution: '',
    encodedFilename: tail.length ? tail[tail.length - 1] : '',
    filename: tail.length ? _decode(tail[tail.length - 1]) : _filenameFromUrl(url),
    path
  };
}

function _findIframe(html) {
  const frames = String(html || '').match(/<iframe\b[^>]*>/gi) || [];
  for (const frame of frames) {
    const id = _attr(frame, 'id') || '';
    const src = _attr(frame, 'src') || '';
    if (src && (/anime-video-player/i.test(id) || /\/r\//i.test(src) || /\/watch\//i.test(src))) {
      return src;
    }
  }
  return null;
}

function _ddlField(ddl, snake, camel) {
  return ddl ? (ddl[snake] != null ? ddl[snake] : ddl[camel]) : null;
}

function _buildDashUrl(watchUrl) {
  if (!watchUrl) return null;
  const origin = _origin(watchUrl);
  if (!origin) return null;
  const pathQuery = _pathQuery(watchUrl);
  const path = pathQuery.split('?')[0].split('#')[0];
  if (!/\/watch\//i.test(path)) return null;
  let dashPath = path.replace(/\/watch\//i, '/dash/');
  dashPath = dashPath.replace(/\/$/, '');
  return origin + dashPath + '/manifest.mpd';
}

function _container(url) {
  const value = String(url || '');
  if (/\.m3u8(?:[?#]|$)/i.test(value)) return 'hls';
  if (/\.mp4(?:[?#]|$)/i.test(value)) return 'mp4';
  return 'unknown';
}

function _kindFromFilename(filename) {
  const audio = String(filename || '').match(/\[(Dual|Sub|Dub|English Dub|Tri|Multi)\]/i);
  const value = audio ? audio[1] : '';
  return {
    kind: /dub|dual|tri|multi/i.test(value) ? 'dub' : 'sub',
    audioLang: /dub|dual|tri|multi/i.test(value) ? 'en' : 'ja'
  };
}

function _stream(url, quality, filename, base) {
  if (!url) return null;
  const kind = _kindFromFilename(filename);
  return {
    url,
    quality,
    container: _container(url),
    headers: { 'User-Agent': UA, Referer: base + '/' },
    kind: kind.kind,
    audioLang: kind.audioLang,
    subtitles: []
  };
}

async function _refreshEpisodeUrl(downloadUrl, info, base) {
  if (!info.modern || !info.slug || !info.season || !info.filename) return downloadUrl;
  const resolution = info.resolution || _qualityValue(_readSetting('quality'));
  const page = await _fetchSite(_episodePageUrl(base, info.slug, info.season, resolution), base + '/');
  if (!page.body) return downloadUrl;
  const entries = _parseEpisodePage(page.body, page.base || base, info.slug, info.season, resolution);
  const episodeNo = _episodeNumber(info.filename);
  let selected = entries.find(ep => episodeNo && _episodeNumber(ep.url + ' ' + ep.title) === episodeNo);
  if (!selected) {
    const target = info.filename.toLowerCase().replace(/%20/g, ' ');
    selected = entries.find(ep => _filenameFromUrl(ep.url).toLowerCase() === target);
  }
  return selected ? selected.url : downloadUrl;
}

async function _extractVideoForEpisode(downloadUrl, filename, resolution) {
  // The episode-list page embeds a short-lived ?token= value in each href.
  // It expires before playback. Always remove it and fetch a fresh token from
  // /get_token before requesting the download-page HTML.
  const requestedInfo = _downloadInfo(downloadUrl);
  const cleanUrl = _stripTokenParam(downloadUrl);
  let base = _origin(cleanUrl) || _domain();
  const freshTokenResult = await _getFreshAccessToken(base, base + '/');
  if (freshTokenResult.base) base = freshTokenResult.base;

  // A token refresh may be blocked while the embedded token is still valid.
  // Prefer the fresh token, but retain the original URL as a bounded fallback.
  let requestUrl = freshTokenResult.token
    ? _appendAccessToken(base + _pathQuery(cleanUrl), freshTokenResult.token)
    : downloadUrl;
  let page = await _fetchSite(requestUrl, base + '/');
  let actualUrl = page.url || requestUrl;
  let html = page.body || '';
  base = page.base || _origin(actualUrl) || base;

  // Stop after a bounded network failure. Retrying the same blocked host for
  // every remaining resolution only repeats the timeout.
  if (!html && _isTransientSiteFailure(page.status)) {
    const empty = [];
    empty.stopFallback = true;
    return empty;
  }

  // Always derive the slug/season/filename from the requested route, not the
  // final HTTP URL. Redirects may land on an HTML error page and lose the
  // modern /download/{slug}/{season}/{resolution}/{filename} metadata.
  let info = requestedInfo;
  if (!info.filename || !info.modern) {
    const currentInfo = _downloadInfo(actualUrl);
    if (currentInfo.filename) info = currentInfo;
  }

  if (!html || (!_findIframe(html) && !TOKEN_RE.test(html))) {
    const freshEpisodeUrl = await _refreshEpisodeUrl(cleanUrl, info, base);
    const retryBase = _origin(freshEpisodeUrl) || base;
    const retryToken = await _getFreshAccessToken(retryBase, retryBase + '/');
    base = retryToken.base || retryBase;
    const retryUrl = _appendAccessToken(base + _pathQuery(_stripTokenParam(freshEpisodeUrl || cleanUrl)), retryToken.token);
    const retry = await _fetchSite(retryUrl, base + '/');
    const retryHasPlayer = !!(retry.body &&
      (_findIframe(retry.body) || TOKEN_RE.test(retry.body)));
    // One refreshed episode/token retry is enough. An HTTP-200 page saying
    // "Unable to generate download link" is still a failed resolve; do not
    // probe every remaining resolution when the source did not produce a player.
    if (!retryHasPlayer) {
      const empty = [];
      // A missing preferred-resolution route is a normal fallback condition;
      // a blocked request or HTTP-200 generator error is not.
      empty.stopFallback = retry.status !== 404 && retry.status !== 410;
      return empty;
    }
    page = retry;
    actualUrl = retry.url || retryUrl;
    html = retry.body;
    base = retry.base || base;
  }

  const filenameFromPage = requestedInfo.filename || info.filename || filename || _filenameFromUrl(cleanUrl);
  const resLabel = _resolutionLabel(resolution || info.resolution, filenameFromPage);
  const audio = (filenameFromPage.match(/\[(Dual|Sub|Dub|English Dub|Tri|Multi)\]/i) || [])[1] || '';
  const label = 'AV1 · ' + resLabel + (audio ? ' [' + audio + ']' : '');
  const size = _text((html.match(/(?:Size|File Size)\s*:?\s*([^<\r\n]{1,40})/i) || [])[1] || '');
  const fullLabel = size && !/generating|checking/i.test(size) ? label + ' · ' + size : label;

  const iframeSrc = _findIframe(html);
  const iframeUrl = iframeSrc ? _absolute(iframeSrc, base) : null;
  // Redirect work is independent of get_ddl. Start it now instead of making
  // the player pay several site/CDN round trips one after another.
  const resolvedIframePromise = iframeUrl
    ? _resolveLink(iframeUrl, base, actualUrl)
    : Promise.resolve(null);

  let ddl = null;
  const tokenMatch = html.match(TOKEN_RE);
  if (tokenMatch && info.encodedFilename) {
    const ddlBase = base;
    const ddlUrl = ddlBase + '/get_ddl/' + info.encodedFilename;
    const ddlResponse = await _fetchSite(
      ddlUrl,
      actualUrl,
      {
        'Accept': 'application/json',
        'Referer': actualUrl,
        'X-Ddl-Token': tokenMatch[1]
      }
    );
    if (ddlResponse.body) {
      try {
        const parsed = JSON.parse(ddlResponse.body);
        if (parsed && (parsed.success === true || parsed.success === 1 ||
            parsed.stream_link || parsed.streamLink || parsed.download_link ||
            parsed.downloadLink || parsed.watch_link || parsed.watchLink)) {
          ddl = parsed;
          base = ddlResponse.base || base;
        }
      } catch (e) {}
    }
  }

  const ddlWatchRaw = _ddlField(ddl, 'watch_link', 'watchLink');
  const streamRaw = _ddlField(ddl, 'stream_link', 'streamLink');
  const dlRaw = _ddlField(ddl, 'download_link', 'downloadLink');
  const torrentRaw = _ddlField(ddl, 'torrent_link', 'torrentLink');
  const [resolvedIframe, resolvedDdlWatch, resolvedStream, resolvedDownload, resolvedTorrent] =
    await Promise.all([
      resolvedIframePromise,
      (!iframeUrl && ddlWatchRaw) ? _resolveLink(ddlWatchRaw, base, actualUrl) : Promise.resolve(null),
      streamRaw ? _resolveLink(streamRaw, base, actualUrl) : Promise.resolve(null),
      dlRaw ? _resolveLink(dlRaw, base, actualUrl) : Promise.resolve(null),
      torrentRaw ? _resolveLink(torrentRaw, base, actualUrl) : Promise.resolve(null)
    ]);
  const resolvedWatch = resolvedIframe || resolvedDdlWatch;

  const streams = [];
  const dash = _buildDashUrl(resolvedWatch);
  if (dash) {
    streams.push(_stream(dash, fullLabel + ' · DASH', filenameFromPage, base));
  }
  if (resolvedStream && resolvedStream !== resolvedWatch) {
    streams.push(_stream(resolvedStream, fullLabel + ' · Stream', filenameFromPage, base));
  }
  if (resolvedDownload) {
    streams.push(_stream(resolvedDownload, fullLabel + ' · Direct DL', filenameFromPage, base));
  }
  if (resolvedTorrent) {
    streams.push(_stream(resolvedTorrent, fullLabel + ' · Torrent', filenameFromPage, base));
  }

  // Never report a site HTML download page or /r/ page as if it were a video.
  // The caller can try the next resolution; an honest empty result beats a
  // link that will inevitably fail in the player's media parser.
  if (!streams.length && _isDirectMediaUrl(actualUrl)) {
    streams.push(_stream(actualUrl, fullLabel + ' · Direct', filenameFromPage, base));
  }
  return streams.filter(Boolean);
}

async function _findEpisodeAtResolution(info, resolution, originalUrl, base) {
  if (resolution === info.resolution) return originalUrl;
  if (!info.slug || !info.season) return null;
  const page = await _fetchSite(_episodePageUrl(base, info.slug, info.season, resolution), base + '/');
  if (!page.body) return _isTransientSiteFailure(page.status) ? false : null;
  const entries = _parseEpisodePage(page.body, page.base || base, info.slug, info.season, resolution);
  const targetNum = _episodeNumber(info.filename);
  if (targetNum) {
    const match = entries.find(ep => _episodeNumber(ep.url + ' ' + ep.title) === targetNum);
    if (match) return match.url;
  }
  const targetFilename = info.filename.toLowerCase();
  const sameName = entries.find(ep => _filenameFromUrl(ep.url).toLowerCase() === targetFilename);
  return sameName ? sameName.url : null;
}

async function getVideoSources(episodeUrl) {
  const full = _absolute(episodeUrl, _domain());
  const info = _downloadInfo(full);
  const filename = info.filename || _filenameFromUrl(full);
  const startResolution = info.modern
    ? _normaliseSeasonResolution(info.resolution)
    : _qualityValue(_readSetting('quality'));
  const qualityCandidates = [startResolution];
  for (const q of _qualityCandidates(_readSetting('quality'))) {
    if (qualityCandidates.indexOf(q) < 0) qualityCandidates.push(q);
  }

  const base = _origin(full) || _domain();
  const collected = [];
  const seenUrls = {};

  if (info.modern) {
    // Resolve the episode's listed quality first. Do not walk every resolution
    // after a playable result has been found: each extra resolution adds an
    // episode-page request, token lookup, download-page request and redirect
    // checks, which can exceed Zangetsu's per-source timeout.
    for (const resolution of qualityCandidates) {
      const url = await _findEpisodeAtResolution(info, resolution, full, base);
      if (url === false) break;
      if (!url) continue;
      const candidates = await _extractVideoForEpisode(url, filename, resolution);
      for (const stream of candidates) {
        if (!stream || !stream.url || seenUrls[stream.url]) continue;
        seenUrls[stream.url] = true;
        collected.push(stream);
      }
      if (collected.length || candidates.stopFallback) break;
    }
  } else {
    const candidates = await _extractVideoForEpisode(full, filename, startResolution);
    for (const stream of candidates) {
      if (stream && stream.url && !seenUrls[stream.url]) {
        seenUrls[stream.url] = true;
        collected.push(stream);
      }
    }
  }

  // Only return a fallback when the supplied URL is already a media file.
  // A /download/ page is HTML and must not be advertised as a stream.
  if (!collected.length && _isDirectMediaUrl(full)) {
    collected.push(_stream(full, 'AV1 · ' + _resolutionLabel(startResolution, filename) + ' · Direct', filename, _origin(full) || _domain()));
  }
  return collected;
}

// ── Home sections ─────────────────────────────────────────────────────────

async function getHome(opts) {
  const response = await _fetchSite(_domain() + '/', _domain() + '/');
  const base = response.base || _domain();
  let popular = _parseCards(response.body, base, 'popular');
  let latest = _parseCards(response.body, base, 'latest');

  if (!popular.length) {
    const fallback = await _fetchSite(base + '/anime?page=0', base + '/');
    popular = _parseAnimeIndex(fallback.body, fallback.base || base);
  }
  if (!latest.length) latest = _parseCards(response.body, base, 'all');
  if (!latest.length) {
    const fallback = await _fetchSite(base + '/anime?page=0', base + '/');
    latest = _parseAnimeIndex(fallback.body, fallback.base || base);
  }

  const rows = [];
  if (popular.length) rows.push({ title: 'Popular', items: popular });
  if (latest.length) rows.push({ title: 'Latest', items: latest });
  return rows;
}

// ── CommonJS export guard ────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION,
    getInfo,
    getSettings,
    getHome,
    search,
    getDetail,
    getEpisodes,
    getVideoSources,
    getStreams: getVideoSources
  };
}
