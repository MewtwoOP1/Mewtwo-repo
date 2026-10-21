// AV1Encodes — anime source for the Zangetsu provider repo.
// Ported from the Aniyomi extension AV1Encodes.kt (SOUMYAR10/anime-extensions).
//
// The source is a DDL index: each episode page exposes a /get_ddl/ endpoint
// returning stream_link, download_link and watch_link. The original extension
// also builds a DASH manifest from watch_link; Zangetsu's stream contract has
// no DASH container, so this port returns only the direct stream/download
// links and drops the DASH URL.

'use strict';

const SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID)
  : 'av1encodes';

const VERSION = '1.0.0';
const DEFAULT_DOMAIN = 'https://av1encodes.com';
const LOGO = 'https://www.google.com/s2/favicons?sz=256&domain=av1encodes.com';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ── Settings ──────────────────────────────────────────────────────────────

function getSettings() {
  return [
    {
      key: 'domain',
      label: 'Domain',
      description: 'Base URL for AV1Encodes. Change if the site moves domains.',
      type: 'text',
      default: DEFAULT_DOMAIN
    },
    {
      key: 'quality',
      label: 'Preferred quality',
      description: 'Quality used when constructing episode URLs.',
      type: 'enum',
      default: '1080p',
      options: [
        { value: '1080p', label: '1080p' },
        { value: '720p', label: '720p' },
        { value: '480p', label: '480p' }
      ]
    }
  ];
}

function _readSetting(key) {
  try {
    const settings =
      (typeof __settings !== 'undefined' && __settings)
        ? __settings[SOURCE_ID]
        : null;
    return settings && settings[key] != null ? settings[key] : null;
  } catch (e) {
    return null;
  }
}

function _domain() {
  const d = _readSetting('domain');
  if (!d) return DEFAULT_DOMAIN;
  const clean = String(d).replace(/\/+$/, '');
  return /^https?:\/\//i.test(clean) ? clean : DEFAULT_DOMAIN;
}

function _quality() {
  const q = String(_readSetting('quality') || '1080p').toLowerCase();
  return q === '720p' || q === '480p' ? q : '1080p';
}

// ── Info ──────────────────────────────────────────────────────────────────

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

// ── HTTP helpers ──────────────────────────────────────────────────────────

function _headers(ref) {
  return {
    'User-Agent': UA,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: ref || _domain() + '/'
  };
}

async function _get(url, ref) {
  const r = await fetch(url, { headers: _headers(ref), redirect: 'follow' });
  if (!r.ok) throw new Error('AV1Encodes HTTP ' + r.status + ' for ' + url);
  return r.text();
}

function _text(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function _attr(html, re) {
  const m = String(html || '').match(re);
  return m ? m[1] : null;
}

function _absolute(url, base) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return base + (url.charAt(0) === '/' ? '' : '/') + url;
}

// ── Search ────────────────────────────────────────────────────────────────

async function search(query, page, opts) {
  const q = String(query || '').trim();
  const p = page && page > 0 ? page : 1;
  const base = _domain();
  const url = q
    ? base + '/search?q=' + encodeURIComponent(q) + '&page=' + p
    : base + '/anime?page=' + p;

  try {
    const html = await _get(url, base + '/');
    return _parseCards(html, base);
  } catch (e) {
    return [];
  }
}

function _parseCards(html, base) {
  const out = [];
  const seen = {};

  const reArticle =
    /<article[^>]*class="[^"]*(?:anime-card|card|anime)[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = reArticle.exec(html)) !== null) {
    const block = m[1];
    const hrefRaw = _attr(block, /<a[^>]+href="([^"]*\/anime\/[^"]+)"[^>]*>/i);
    if (!hrefRaw || hrefRaw === '/anime/') continue;
    const href = _absolute(hrefRaw, base);
    if (seen[href]) continue;
    let title = _text(
      _attr(block, /<h[34][^>]*>([\s\S]*?)<\/h[34]>/i) || ''
    );
    if (!title) title = _text(_attr(block, /<a[^>]*>([\s\S]*?)<\/a>/i) || '');
    if (!title) continue;
    const img = _attr(
      block,
      /<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/i
    );
    seen[href] = 1;
    out.push({
      id: href,
      title,
      englishTitle: title,
      url: href,
      cover: img ? _absolute(img, base) : null,
      type: 'anime',
      sourceId: SOURCE_ID
    });
  }

  if (!out.length) {
    const reLi =
      /<li[^>]*>\s*<a[^>]+href="([^"]*\/anime\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = reLi.exec(html)) !== null) {
      const href = _absolute(m[1], base);
      if (seen[href]) continue;
      const title = _text(m[2]);
      if (!title) continue;
      seen[href] = 1;
      out.push({
        id: href,
        title,
        englishTitle: title,
        url: href,
        cover: null,
        type: 'anime',
        sourceId: SOURCE_ID
      });
    }
  }

  return out;
}

// ── Detail ────────────────────────────────────────────────────────────────

async function getDetail(url, opts) {
  const base = _domain();
  const full = _absolute(url, base);

  const html = await _get(full, base + '/');
  const title = _text(_attr(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || '');
  const cover = _attr(html, /<img[^>]+(?:data-src|src)="([^"]+)"/i);
  const description = _text(
    _attr(
      html,
      /class="[^"]*(?:synopsis|description|overview)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/i
    ) || ''
  );

  const genres = [];
  const reGenre = /<a[^>]+href="[^"]*\/genre\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let gm;
  while ((gm = reGenre.exec(html)) !== null) {
    const g = _text(gm[1]);
    if (g && genres.indexOf(g) < 0) genres.push(g);
  }

  const status = /class="[^"]*(?:airing|ongoing)[^"]*"/i.test(html)
    ? 'ongoing'
    : 'completed';
  const slug = full.replace(/\/+$/, '').split('/').pop();
  const episodes = await _fetchEpisodes(slug, base);

  return {
    id: slug,
    title: title || slug,
    englishTitle: title || slug,
    url: full,
    cover: cover ? _absolute(cover, base) : null,
    description: description || null,
    genres,
    status,
    type: 'anime',
    sourceId: SOURCE_ID,
    episodes,
    malId: null
  };
}

async function getEpisodes(url, opts) {
  const d = await getDetail(url, opts);
  return d.episodes || [];
}

async function _fetchEpisodes(slug, base) {
  let html;
  try {
    html = await _get(
      base + '/anime/' + encodeURIComponent(slug),
      base + '/'
    );
  } catch (e) {
    return [];
  }

  const seasons = [];
  const reSeason = /data-season="([^"]+)"/gi;
  let sm;
  while ((sm = reSeason.exec(html)) !== null) {
    if (seasons.indexOf(sm[1]) < 0) seasons.push(sm[1]);
  }
  if (!seasons.length) seasons.push('1');
  seasons.sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0));

  const quality = _quality();
  const encodedRes = encodeURIComponent(quality);

  const groups = await Promise.all(
    seasons.map(async season => {
      const epUrl =
        base +
        '/episodes/' +
        encodeURIComponent(slug) +
        '/' +
        encodeURIComponent(season) +
        '/' +
        encodedRes;
      try {
        const epHtml = await _get(epUrl, base + '/');
        return _parseEpisodePage(epHtml, base, season);
      } catch (e) {
        return [];
      }
    })
  );

  const all = [];
  for (const g of groups) for (const ep of g) all.push(ep);
  return all;
}

function _parseEpisodePage(html, base, season) {
  const out = [];
  const seen = {};

  const reLink =
    /<a[^>]+href="([^"]*\/download\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = reLink.exec(html)) !== null) {
    const rawHref = _absolute(m[1], base);
    const href = encodeURI(rawHref);
    if (seen[href]) continue;
    seen[href] = 1;
    const label = _text(m[2]) || _filenameFromUrl(href);
    out.push({
      id: href,
      number: _episodeNumber(label),
      title: _episodeLabel(label, season),
      url: href
    });
  }

  if (out.length) return out;

  const reFile = /([A-Za-z0-9_ \-\[\]().%]+?\.(?:mkv|mp4))/gi;
  while ((m = reFile.exec(html)) !== null) {
    const fn = m[1].trim();
    if (!fn || seen[fn]) continue;
    seen[fn] = 1;
    const encoded = encodeURIComponent(fn);
    const url = base + '/download/' + encodeURIComponent(season) + '/' + encoded;
    out.push({
      id: url,
      number: _episodeNumber(fn),
      title: _episodeLabel(fn, season),
      url
    });
  }

  return out;
}

function _filenameFromUrl(url) {
  try {
    const clean = String(url).split('?')[0].split('/').pop();
    return decodeURIComponent(clean);
  } catch (e) {
    return String(url);
  }
}

function _episodeNumber(text) {
  const m = String(text || '').match(/E(\d+)/i);
  return m ? parseInt(m[1], 10) : 1;
}

function _episodeLabel(text, season) {
  const name = String(text || '')
    .replace(/\[\d{3,4}p\].*/i, '')
    .replace(/\.(mkv|mp4)$/i, '')
    .trim();
  const ep = _episodeNumber(name);
  return (season && season !== '1' ? 'S' + season + ' ' : '') + 'Ep ' + ep + ' - ' + name;
}

// ── Video sources ─────────────────────────────────────────────────────────

async function getVideoSources(episodeUrl) {
  const base = _domain();
  const url = _absolute(episodeUrl, base);
  const filename = _filenameFromUrl(url);
  const encodedFilename = encodeURIComponent(filename);

  let pageHtml;
  try {
    pageHtml = await _get(url, base + '/');
  } catch (e) {
    return _fallback(url, filename);
  }

  const token = _attr(pageHtml, /['"](A{4,}[A-Za-z0-9_\-]{10,})['"]/);
  if (!token) return _fallback(url, filename);

  const ddlUrl = base + '/get_ddl/' + encodedFilename;
  let body;
  try {
    const r = await fetch(ddlUrl, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        Referer: url,
        'X-Ddl-Token': token
      },
      redirect: 'follow'
    });
    if (!r.ok) return _fallback(url, filename);
    body = await r.text();
  } catch (e) {
    return _fallback(url, filename);
  }

  let ddl;
  try {
    ddl = JSON.parse(body);
  } catch (e) {
    return _fallback(url, filename);
  }
  if (!ddl || !ddl.success) return _fallback(url, filename);

  return _resolveSources(ddl, filename, base);
}

async function _resolveSources(ddl, filename, base) {
  const quality = _qualityFromFilename(filename);
  const audio = _audioFromFilename(filename);
  const label = 'AV1 · ' + quality + (audio ? ' [' + audio + ']' : '');

  const streams = [];

  const links = [
    { link: ddl.stream_link, suffix: 'Stream' },
    { link: ddl.download_link, suffix: 'Direct DL' }
  ];

  for (const item of links) {
    const finalUrl = await _resolveRedirect(item.link, base);
    if (!finalUrl) continue;
    streams.push({
      url: finalUrl,
      quality: label + ' · ' + item.suffix,
      container: _container(finalUrl),
      headers: { 'User-Agent': UA, Referer: base + '/' },
      kind: audio && /dub/i.test(audio) ? 'dub' : 'sub',
      audioLang: audio && /dub/i.test(audio) ? 'en' : 'ja',
      subtitles: []
    });
  }

  if (!streams.length) return _fallback(base + '/download/' + encodeURIComponent(filename), filename);
  return streams;
}

async function _resolveRedirect(path, base) {
  if (!path) return null;
  const url = /^https?:\/\//i.test(path)
    ? path
    : base + (path.charAt(0) === '/' ? '' : '/') + path;
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Referer: base + '/' },
      redirect: 'follow'
    });
    if (!r.ok) return null;
    return r.url || url;
  } catch (e) {
    return null;
  }
}

function _fallback(url, filename) {
  const quality = _qualityFromFilename(filename);
  return [
    {
      url,
      quality: 'AV1 · ' + quality + ' · Direct DL',
      container: _container(url),
      headers: { 'User-Agent': UA, Referer: _domain() + '/' },
      kind: 'sub',
      audioLang: 'ja',
      subtitles: []
    }
  ];
}

function _qualityFromFilename(filename) {
  const m = String(filename || '').match(/\[(\d+p)\]/i);
  return m ? m[1] : _quality();
}

function _audioFromFilename(filename) {
  const m = String(filename || '').match(/\[(Dual|Sub|Dub|English Dub)\]/i);
  return m ? m[1] : '';
}

function _container(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return 'hls';
  if (/\.mkv(\?|$)/i.test(url)) return 'mkv';
  return 'mp4';
}

// ── Home ──────────────────────────────────────────────────────────────────

async function getHome(opts) {
  const base = _domain();

  const popular = _get(base + '/stats', base + '/')
    .then(html => ({ title: 'Popular', items: _parseCards(html, base) }))
    .catch(() => ({ title: 'Popular', items: [] }));

  const latest = _get(base + '/', base + '/')
    .then(html => ({ title: 'Latest', items: _parseCards(html, base) }))
    .catch(() => ({ title: 'Latest', items: [] }));

  const rows = await Promise.all([popular, latest]);
  return rows.filter(r => r.items.length > 0);
}

// ── Export Environment Guard ──────────────────────────────────────────────
// Zangetsu evaluates this file directly in a JS engine without Node.js globals.
// The Node.js CI script (check-and-run.mjs) requires module.exports.
// We conditionally export only if 'module' actually exists.

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
