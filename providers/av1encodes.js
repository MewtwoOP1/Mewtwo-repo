// AV1Encodes for Zangetsu — clean JavaScript port of Yuzuno's Aniyomi source.
// Source of truth: https://github.com/yuzono/anime-extensions/tree/master/src/en/av1encodes
// The only adaptations are Zangetsu's provider contract and the lack of Jsoup/OkHttp APIs.
'use strict';

const SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'av1encodes';
const VERSION = '1.1.9';
const NAME = 'AV1Encodes';
const LANG = 'en';
const LOGO = 'https://www.google.com/s2/favicons?sz=256&domain=av1encodes.com';
const DEFAULT_DOMAIN = 'https://av1encodes.com';
const DOMAIN_VALUES = ['https://av1encodes.com', 'https://animealpha.cc', 'https://av1please.com'];
const DOMAIN_ENTRIES = ['av1encodes.com (default)', 'animealpha.cc', 'av1please.com (mirror)'];
const QUALITY_VALUES = ['1920 x 1080', '1280 x 720', '854 x 480', '640 x 360'];
const QUALITY_ENTRIES = ['1080p', '720p', '480p', '360p'];
const LINK_TYPE_ENTRIES = ['Stream', 'Direct DL', 'Dash', 'Torrent'];
const PREF_DOMAIN_KEY = 'preferred_domain';
const PREF_DOMAIN_DEFAULT = DEFAULT_DOMAIN;
const PREF_QUALITY_KEY = 'preferred_quality';
const PREF_QUALITY_DEFAULT = QUALITY_VALUES[0];
const PREF_LINK_TYPE_KEY = 'preferred_link_type';
const PREF_LINK_TYPE_DEFAULT = 'Stream';
const PREF_SHOW_TORRENT_KEY = 'show_torrent';
const PREF_SHOW_TORRENT_DEFAULT = false;
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
const SEC_CH_UA = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
const REQUEST_TIMEOUT_MS = 4500;
const RES_LABEL_REGEX = /\[(\d{3,4}p)]/;
const AUDIO_TAG_REGEX = /\[(Dual|Sub|Dub|Tri|Multi)]/i;
const EPISODE_NUMBER_REGEX = /E(\d+)/i;
const EPISODE_S_NUMBER_REGEX = /\[(?:S\d+-)?E(\d+)]/;
const EPISODE_NAME_REGEX = /\[(?:S\d+-)?E(\d+)]\s*(.+?)\s*\[/;
const SUBDUB_REGEX = /\[(Dual|Sub|Dub|English Dub)]/i;
const QUALITY_REGEX = /\[\d{3,4}p].*/;
const FILENAME_REGEX = /([a-zA-Z0-9_ \-\[\]().%]+?\.(?:mkv|mp4))/gi;
const TOKEN_REGEX = /['"](A{4,}[A-Za-z0-9_\-]{10,})['"]/;
const BACKGROUND_URL_REGEX = /url\(['"](.*?)['"]\)/;
const VOID_TAGS = Object.create(null);
'area base br col embed hr img input link meta param source track wbr'.split(' ').forEach(tag => { VOID_TAGS[tag] = true; });
const COOKIE_JAR = Object.create(null);

// ── Zangetsu provider contract and the same preferences as upstream ─────────
function _setting(key, fallback) {
  try {
    const all = typeof __settings !== 'undefined' && __settings ? __settings : null;
    const scoped = all ? all[SOURCE_ID] : null;
    if (scoped && scoped[key] !== undefined && scoped[key] !== null) return scoped[key];
  } catch (e) {}
  return fallback;
}
function _baseUrl() {
  const saved = String(_setting(PREF_DOMAIN_KEY, PREF_DOMAIN_DEFAULT) || PREF_DOMAIN_DEFAULT).trim();
  return DOMAIN_VALUES.indexOf(saved) >= 0 ? saved : PREF_DOMAIN_DEFAULT;
}
function _preferredQuality() {
  const saved = String(_setting(PREF_QUALITY_KEY, PREF_QUALITY_DEFAULT) || PREF_QUALITY_DEFAULT);
  return QUALITY_VALUES.indexOf(saved) >= 0 ? saved : PREF_QUALITY_DEFAULT;
}
function _preferredLinkType() {
  const saved = String(_setting(PREF_LINK_TYPE_KEY, PREF_LINK_TYPE_DEFAULT) || PREF_LINK_TYPE_DEFAULT);
  return LINK_TYPE_ENTRIES.indexOf(saved) >= 0 ? saved : PREF_LINK_TYPE_DEFAULT;
}
function _showTorrent() {
  const value = _setting(PREF_SHOW_TORRENT_KEY, PREF_SHOW_TORRENT_DEFAULT);
  return value === true || String(value).toLowerCase() === 'true';
}
function getInfo() {
  return { name: NAME, lang: LANG, baseUrl: _baseUrl(), logo: LOGO, type: 'anime', version: VERSION };
}
function getSettings() {
  return [
    {
      key: PREF_DOMAIN_KEY, label: 'Domain',
      description: 'Switch to the mirror if the default domain is unreachable. Restart the app after changing.',
      type: 'enum', default: PREF_DOMAIN_DEFAULT,
      options: DOMAIN_VALUES.map((value, i) => ({ value: value, label: DOMAIN_ENTRIES[i] }))
    },
    {
      key: PREF_QUALITY_KEY, label: 'Preferred Resolution',
      description: 'If a season shows no episodes, try a lower resolution.',
      type: 'enum', default: PREF_QUALITY_DEFAULT,
      options: QUALITY_VALUES.map((value, i) => ({ value: value, label: QUALITY_ENTRIES[i] }))
    },
    {
      key: PREF_LINK_TYPE_KEY, label: 'Preferred Server / Hoster',
      description: 'This hoster will appear first in the server list.',
      type: 'enum', default: PREF_LINK_TYPE_DEFAULT,
      options: LINK_TYPE_ENTRIES.map(value => ({ value: value, label: value }))
    },
    {
      key: PREF_SHOW_TORRENT_KEY, label: 'Show Torrent Link',
      description: 'Include the torrent link as a server option.',
      type: 'bool', default: PREF_SHOW_TORRENT_DEFAULT
    }
  ];
}

// ── Small HTML/Jsoup compatibility layer ────────────────────────────────────
function _decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (all, n) => {
      const cp = parseInt(n, 16);
      try { return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all; } catch (e) { return all; }
    })
    .replace(/&#(\d+);/g, (all, n) => {
      const cp = parseInt(n, 10);
      try { return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : all; } catch (e) { return all; }
    });
}
function _htmlText(value) {
  return _decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function _parseAttributes(raw) {
  const attrs = Object.create(null);
  const text = String(raw || '').replace(/^<\/?[a-zA-Z][^\s/>]*/, '').replace(/\/?>\s*$/, '');
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const key = String(match[1] || '').toLowerCase();
    if (!key || attrs[key] !== undefined) continue;
    attrs[key] = _decodeEntities(match[2] !== undefined ? match[2] :
      (match[3] !== undefined ? match[3] : (match[4] !== undefined ? match[4] : '')));
  }
  return attrs;
}
function _parseHtml(html) {
  const source = String(html || '');
  const root = { tag: '#document', attrs: Object.create(null), parent: null, children: [] };
  const stack = [root];
  const tokenRe = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>/g;
  let cursor = 0;
  let match;
  const appendText = (text, node) => { if (text) node.children.push(text); };
  while ((match = tokenRe.exec(source)) !== null) {
    appendText(source.slice(cursor, match.index), stack[stack.length - 1]);
    const raw = match[0];
    cursor = tokenRe.lastIndex;
    if (raw.slice(0, 4) === '<!--' || /^<!/i.test(raw)) continue;
    const closing = /^<\//.test(raw);
    const tagMatch = raw.match(/^<\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)/);
    if (!tagMatch) continue;
    const tag = tagMatch[1].toLowerCase();
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const node = { tag: tag, attrs: _parseAttributes(raw), parent: stack[stack.length - 1], children: [] };
    node.parent.children.push(node);
    if (tag === 'script' || tag === 'style') {
      const closeRe = new RegExp('</' + tag + '\\s*>', 'ig');
      closeRe.lastIndex = tokenRe.lastIndex;
      const close = closeRe.exec(source);
      if (close) { tokenRe.lastIndex = closeRe.lastIndex; cursor = closeRe.lastIndex; }
      continue;
    }
    if (!VOID_TAGS[tag] && !/\/\s*>$/.test(raw)) stack.push(node);
  }
  appendText(source.slice(cursor), stack[stack.length - 1]);
  return root;
}
function _walk(root) {
  const out = [];
  const visit = node => {
    if (!node || typeof node === 'string') return;
    for (const child of node.children || []) {
      if (typeof child === 'string') continue;
      out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}
function _nodeText(node) {
  if (!node || typeof node === 'string') return typeof node === 'string' ? node : '';
  let out = '';
  for (const child of node.children || []) out += typeof child === 'string' ? child : _nodeText(child) + ' ';
  return out;
}
function _text(node) { return _htmlText(_nodeText(node)); }
function _attr(node, name) {
  if (!node || typeof node === 'string') return '';
  const key = String(name || '').toLowerCase();
  return node.attrs[key] == null ? '' : String(node.attrs[key]);
}
function _splitSelectorGroups(selector) {
  const groups = [];
  let current = '', square = 0, round = 0, quote = '';
  const text = String(selector || '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { current += ch; if (ch === quote && text[i - 1] !== '\\') quote = ''; continue; }
    if ((ch === '"' || ch === "'") && square > 0) { quote = ch; current += ch; continue; }
    if (ch === '[') square++;
    else if (ch === ']') square--;
    else if (ch === '(') round++;
    else if (ch === ')') round--;
    if (ch === ',' && square === 0 && round === 0) {
      if (current.trim()) groups.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) groups.push(current.trim());
  return groups;
}
function _parseComplexSelector(selector) {
  const parts = [];
  let current = '', square = 0, round = 0, quote = '', pending = null;
  const push = () => {
    if (!current.trim()) return;
    parts.push({ simple: current.trim(), relation: parts.length ? (pending || ' ') : null });
    current = '';
    pending = null;
  };
  const text = String(selector || '').trim();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { current += ch; if (ch === quote && text[i - 1] !== '\\') quote = ''; continue; }
    if ((ch === '"' || ch === "'") && square > 0) { quote = ch; current += ch; continue; }
    if (ch === '[') square++;
    else if (ch === ']') square--;
    else if (ch === '(') round++;
    else if (ch === ')') round--;
    if (square === 0 && round === 0 && ch === '>') {
      push();
      pending = '>';
    } else if (square === 0 && round === 0 && /\s/.test(ch)) {
      push();
      if (parts.length && pending !== '>') pending = ' ';
    } else current += ch;
  }
  push();
  return parts;
}
function _matchesSimple(node, simple) {
  if (!node || typeof node === 'string') return false;
  let s = String(simple || '').trim();
  const contains = [];
  const nots = [];
  s = s.replace(/:contains\(([^()]*)\)/g, (all, value) => { contains.push(value.replace(/^['"]|['"]$/g, '')); return ''; });
  s = s.replace(/:not\(([^()]*)\)/g, (all, value) => { nots.push(value); return ''; });
  const tagMatch = s.match(/^([a-zA-Z][a-zA-Z0-9_-]*|\*)/);
  if (tagMatch && tagMatch[1] !== '*' && node.tag !== tagMatch[1].toLowerCase()) return false;
  if (tagMatch) s = s.slice(tagMatch[0].length);
  while (s.length) {
    if (s[0] === '.' || s[0] === '#') {
      const type = s[0];
      const nameMatch = s.slice(1).match(/^[a-zA-Z0-9_-]+/);
      if (!nameMatch) return false;
      const name = nameMatch[0];
      s = s.slice(name.length + 1);
      if (type === '.') { if (_attr(node, 'class').split(/\s+/).indexOf(name) < 0) return false; }
      else if (_attr(node, 'id') !== name) return false;
      continue;
    }
    if (s[0] === '[') {
      const end = s.indexOf(']');
      if (end < 0) return false;
      const expression = s.slice(1, end).trim();
      s = s.slice(end + 1);
      const attrMatch = expression.match(/^([^\s~|^$*!]+)\s*(\*=|\^=|\$=|~=|\|=|=)?\s*(.*?)\s*$/);
      if (!attrMatch) return false;
      const name = attrMatch[1].toLowerCase();
      const operator = attrMatch[2] || '';
      let wanted = attrMatch[3] || '';
      wanted = wanted.replace(/^['"]|['"]$/g, '');
      const value = _attr(node, name);
      if (operator === '') { if (node.attrs[name] === undefined) return false; }
      else if (operator === '=') { if (value !== _decodeEntities(wanted)) return false; }
      else if (operator === '*=') { if (value.indexOf(_decodeEntities(wanted)) < 0) return false; }
      else if (operator === '^=') { if (value.indexOf(_decodeEntities(wanted)) !== 0) return false; }
      else if (operator === '$=') { if (value.slice(-_decodeEntities(wanted).length) !== _decodeEntities(wanted)) return false; }
      else if (operator === '~=') { if (value.split(/\s+/).indexOf(_decodeEntities(wanted)) < 0) return false; }
      else if (operator === '|=') { if (value !== wanted && value.indexOf(wanted + '-') !== 0) return false; }
      continue;
    }
    return false;
  }
  for (const text of contains) if (_text(node).indexOf(text) < 0) return false;
  for (const selector of nots) if (_matchesSimple(node, selector)) return false;
  return true;
}
function _matchesSelector(node, parts, index) {
  if (!_matchesSimple(node, parts[index].simple)) return false;
  if (index === 0) return true;
  const relation = parts[index].relation || ' ';
  if (relation === '>') return !!node.parent && node.parent.tag !== '#document' && _matchesSelector(node.parent, parts, index - 1);
  let parent = node.parent;
  while (parent && parent.tag !== '#document') {
    if (_matchesSelector(parent, parts, index - 1)) return true;
    parent = parent.parent;
  }
  return false;
}
function _select(root, selector) {
  const nodes = _walk(root);
  const groups = _splitSelectorGroups(selector).map(group => _parseComplexSelector(group)).filter(parts => parts.length);
  return nodes.filter(node => groups.some(parts => _matchesSelector(node, parts, parts.length - 1)));
}
function _selectFirst(root, selector) {
  const found = _select(root, selector);
  return found.length ? found[0] : null;
}
function _absolute(raw, base) {
  const value = String(raw || '').trim().replace(/&amp;/g, '&');
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.indexOf('//') === 0) return (_origin(base) || 'https:') + ':' + value;
  if (value[0] === '/') return (_origin(base) || _baseUrl()) + value;
  return (_origin(base) || _baseUrl()) + '/' + value;
}
function _origin(url) {
  const match = String(url || '').trim().match(/^(https?:\/\/[^/?#]+)/i);
  return match ? match[1].replace(/\/+$/, '') : '';
}
function _pathQuery(url) {
  const value = String(url || '').trim().replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(value)) {
    const match = value.match(/^https?:\/\/[^/?#]+([^#]*)/i);
    return match && match[1] ? match[1] : '/';
  }
  return value || '';
}
function _withoutDomain(url) {
  const value = String(url || '');
  if (!/^https?:\/\//i.test(value)) return value;
  return _pathQuery(value);
}
function _join(base, path) {
  const value = String(path || '');
  if (/^https?:\/\//i.test(value)) return value;
  if (value.indexOf('//') === 0) return 'https:' + value;
  return (_origin(base) || _baseUrl()) + (value.startsWith('/') ? value : '/' + value);
}
function _normalizePath(href) {
  const value = String(href || '').trim();
  if (value.startsWith('/')) return value;
  if (!/^https?:\/\//i.test(value)) return value;
  const origin = _origin(value);
  const host = origin.replace(/^https?:\/\//i, '').split(':')[0].toLowerCase();
  const selected = _origin(_baseUrl()).replace(/^https?:\/\//i, '').split(':')[0].toLowerCase();
  const allowed = host === selected || host.endsWith('av1encodes.com') ||
    host.endsWith('animealpha.cc') || host.endsWith('av1please.com');
  return allowed ? _pathQuery(value) : '';
}
function _encodeForm(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*~]/g, ch =>
    '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  );
}
function _encodeResolution(value) { return _encodeForm(value).replace(/\+/g, '%20'); }
function _decode(value) {
  try { return decodeURIComponent(String(value || '').replace(/\+/g, '%20')); }
  catch (e) { return String(value || ''); }
}

// ── Source HTTP client behavior: upstream headers plus 403 warm-up/retry ────
function _hostKey(url) { return _origin(url).replace(/^https?:\/\//i, '').toLowerCase(); }
function _cookieHeader(url) {
  const cookies = COOKIE_JAR[_hostKey(url)];
  if (!cookies) return '';
  return Object.keys(cookies).map(name => name + '=' + cookies[name]).join('; ');
}
function _captureCookies(url, headers) {
  if (!headers) return;
  let value = '';
  try {
    if (typeof headers.getSetCookie === 'function') value = headers.getSetCookie().join('; ');
    if (!value && typeof headers.get === 'function') value = headers.get('set-cookie') || '';
    if (!value && typeof headers === 'object') {
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'set-cookie') value = String(headers[key] || '');
    }
  } catch (e) {}
  if (!value) return;
  const host = _hostKey(url);
  COOKIE_JAR[host] = COOKIE_JAR[host] || Object.create(null);
  const pieces = Array.isArray(value) ? value : [value];
  for (const cookie of pieces) {
    const first = String(cookie || '').split(';')[0];
    const equal = first.indexOf('=');
    if (equal <= 0) continue;
    const name = first.slice(0, equal).trim();
    const content = first.slice(equal + 1).trim();
    if (name) COOKIE_JAR[host][name] = content;
  }
}
function _requestHeaders(base, ref, extra) {
  const headers = {
    'User-Agent': DESKTOP_UA, 'Accept': ACCEPT_HTML, 'Accept-Language': ACCEPT_LANGUAGE,
    'Referer': ref || _origin(base) + '/', 'Sec-Ch-Ua': SEC_CH_UA,
    'Sec-Ch-Ua-Mobile': '?0', 'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };
  const cookie = _cookieHeader(base);
  if (cookie) headers.Cookie = cookie;
  if (extra) for (const key of Object.keys(extra)) headers[key] = extra[key];
  return headers;
}
async function _rawFetch(url, ref, extraHeaders) {
  const base = _origin(url) || _baseUrl();
  try {
    const response = await fetch(url, {
      method: 'GET', headers: _requestHeaders(base, ref || base + '/', extraHeaders),
      redirect: 'follow', credentials: 'include', timeoutMs: REQUEST_TIMEOUT_MS
    });
    const status = Number(response && response.status || (response && response.ok ? 200 : 0));
    const finalUrl = response && response.url ? String(response.url) : url;
    _captureCookies(finalUrl, response && response.headers);
    let body = '';
    if (response && typeof response.text === 'function') body = String(await response.text() || '');
    else if (response && typeof response.body === 'string') body = response.body;
    return { ok: !!response && response.ok !== false && status >= 200 && status < 400,
      status: status, body: body, url: finalUrl, base: _origin(finalUrl) || base };
  } catch (e) {
    return { ok: false, status: 0, body: '', url: url, base: base, error: String(e) };
  }
}
async function _get(url, ref, extraHeaders) {
  const site = _origin(url) || _baseUrl();
  let response = await _rawFetch(url, ref || site + '/', extraHeaders);
  if (response.status === 403) {
    await _rawFetch(site + '/', site + '/', {});
    response = await _rawFetch(url, ref || site + '/', extraHeaders);
  }
  if (!response.ok) throw new Error('HTTP ' + response.status + ' for ' + url);
  return response;
}
async function _getText(url, ref, extraHeaders) {
  const response = await _get(url, ref, extraHeaders);
  return response.body;
}
async function _resolveRedirect(path, base) {
  if (path == null || String(path).trim() === '') return null;
  const value = String(path);
  const url = value.startsWith('/') ? _baseUrl() + value : value;
  try {
    const response = await _get(url, _baseUrl() + '/');
    return response.url || url;
  } catch (e) { return null; }
}

// ── Upstream card/list parsing ──────────────────────────────────────────────
function _extractImgUrl(img, base) {
  if (!img) return null;
  const src = _attr(img, 'data-src') || _attr(img, 'data-lazy-src') || _attr(img, 'src');
  return src ? _absolute(src, base) : null;
}
function _makeAnime(href, title, cover) {
  return { id: href, title: title, englishTitle: title, url: href, cover: cover || null, type: 'anime', sourceId: SOURCE_ID };
}
function _parseCardList(doc, base, selector) {
  let animes = _select(doc, selector).map(el => {
    const a = el.tag === 'a' && _attr(el, 'href').indexOf('/anime/') >= 0 ? el :
      _selectFirst(el, "a[href*='/anime/'], h3 > a, h4 > a");
    if (!a) return null;
    const href = _normalizePath(_attr(a, 'href'));
    if (!href.startsWith('/anime/') || href === '/anime/') return null;
    const img = _selectFirst(el, 'img') || _selectFirst(a, 'img');
    const titleEl = _selectFirst(el, '.spotlight-title, h3, h4') || _selectFirst(a, 'h3, h4') || a;
    return _makeAnime(href, _text(titleEl), _extractImgUrl(img, base));
  }).filter(Boolean);
  const seen = Object.create(null);
  animes = animes.filter(anime => {
    if (seen[anime.url]) return false;
    seen[anime.url] = true;
    return true;
  });
  if (!animes.length) {
    const contentRoot = _selectFirst(doc,
      'main, #main, #content, .content, [class*="anime-list"], [class*="anime-grid"], [class*="result"], [class*="listing"], [class*="airing"], section.animes'
    ) || _selectFirst(doc, 'body') || doc;
    animes = _select(contentRoot, 'h3').map(h3 => {
      const block = h3.parent;
      if (!block) return null;
      const a = _selectFirst(block, "a[href*='/anime/']") ||
        (block.parent ? _selectFirst(block.parent, "a[href*='/anime/']") : null);
      if (!a) return null;
      const href = _normalizePath(_attr(a, 'href'));
      if (!href.startsWith('/anime/') || href === '/anime/') return null;
      const img = (block.parent ? _selectFirst(block.parent, 'img') : null) || _selectFirst(block, 'img');
      return _makeAnime(href, _text(h3), _extractImgUrl(img, base));
    }).filter(Boolean);
    const fallbackSeen = Object.create(null);
    animes = animes.filter(anime => {
      if (fallbackSeen[anime.url]) return false;
      fallbackSeen[anime.url] = true;
      return true;
    });
  }
  const hasNextPage = !!_selectFirst(doc,
    'a.next-page, .pagination a[rel=next], .pagination .next:not(.disabled), nav.pagination a:contains(Next), [aria-label=Next page]'
  );
  return { animes: animes, hasNextPage: hasNextPage };
}
async function _parseAnimeListPage(doc, base) {
  const seen = Object.create(null);
  const animes = _select(doc, "li > a[href*='/anime/'], a.anime-index-link").map(a => {
    const href = _normalizePath(_attr(a, 'href'));
    const title = _text(a).trim();
    if (!href.startsWith('/anime/') || href === '/anime/' || !title || seen[href]) return null;
    seen[href] = true;
    return _makeAnime(href, title, null);
  }).filter(Boolean);
  const hasNextPage = !!_selectFirst(doc, 'a.next-page, a[rel=next], .pagination .next, a:contains(Next)');
  const result = await Promise.all(animes.map(async anime => {
    if (anime.cover != null) return anime;
    try {
      const response = await _get(_join(base, anime.url), _baseUrl() + '/');
      const detailDoc = _parseHtml(response.body);
      const img = _selectFirst(detailDoc,
        'img.anime-poster, img.poster, .anime-hero img, [class*="poster"] img, [class*="hero"] img, main img'
      );
      const meta = _selectFirst(detailDoc, "meta[property=og:image]");
      anime.cover = _extractImgUrl(img, response.url) || (meta ? _attr(meta, 'content') : null);
    } catch (e) {}
    return anime;
  }));
  return { animes: result, hasNextPage: hasNextPage };
}
async function _popularPage(page) {
  const base = _baseUrl();
  if (page === 1) {
    const response = await _get(base, base + '/');
    const doc = _parseHtml(response.body);
    return { animes: _parseCardList(doc, response.url || base,
      'article.spotlight-slide, #latestCompletedList li, .sidebar-list-panel li').animes, hasNextPage: true };
  }
  const response = await _get(base + '/anime?page=' + (page - 1), base + '/');
  return _parseAnimeListPage(_parseHtml(response.body), response.url || base);
}
async function _latestPage(page) {
  const base = _baseUrl();
  if (page === 1) {
    const response = await _get(base, base + '/');
    const doc = _parseHtml(response.body);
    return { animes: _parseCardList(doc, response.url || base,
      '#episodeGrid article, .latest-panel article').animes, hasNextPage: true };
  }
  const response = await _get(base + '/anime?page=' + (page - 1), base + '/');
  return _parseAnimeListPage(_parseHtml(response.body), response.url || base);
}
function _selectedFilter(filters, key, values, labelMap) {
  if (!filters || filters[key] == null || filters[key] === '') return '';
  const value = filters[key];
  if (typeof value === 'number') return values[value] || '';
  const normalized = String(value).trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(labelMap, normalized)) return labelMap[normalized];
  return values.indexOf(String(value)) >= 0 ? String(value) : '';
}
async function search(query, page, opts) {
  const q = String(query || '').trim();
  const p = Math.max(1, parseInt(page, 10) || 1);
  const base = _baseUrl();
  let url;
  if (q) {
    url = base + '/search?q=' + encodeURIComponent(q) + '&page=' + p;
  } else {
    const filters = opts && typeof opts === 'object' ?
      (opts.filters && typeof opts.filters === 'object' ? opts.filters : opts) : {};
    const sortValue = _selectedFilter(filters, 'sort', ['', 'a-z', 'z-a', 'episodes'], {
      'latest added': '', latest: '', 'a-z': 'a-z', 'a–z': 'a-z', 'z-a': 'z-a', 'z–a': 'z-a', 'episode count': 'episodes', episodes: 'episodes'
    });
    const typeValue = _selectedFilter(filters, 'type', ['', 'sub', 'dual'], {
      all: '', 'sub only (airing)': 'sub', sub: 'sub', 'dual audio (airing)': 'dual', dual: 'dual'
    });
    const genreValue = _selectedFilter(filters, 'genre', ['', 'action', 'adventure', 'comedy', 'drama', 'fantasy', 'horror', 'romance', 'sci-fi'], {
      all: '', action: 'action', adventure: 'adventure', comedy: 'comedy', drama: 'drama', fantasy: 'fantasy', horror: 'horror', romance: 'romance', 'sci-fi': 'sci-fi', 'sci fi': 'sci-fi'
    });
    const params = ['page=' + p];
    if (genreValue) params.push('genres=' + encodeURIComponent(genreValue));
    if (sortValue) params.push('sort=' + encodeURIComponent(sortValue));
    if (typeValue) params.push('type=' + encodeURIComponent(typeValue));
    url = base + '/anime?' + params.join('&');
  }
  const response = await _get(url, base + '/');
  const doc = _parseHtml(response.body);
  if (q) return _parseCardList(doc, response.url || base,
    "a.anime-link, article.spotlight-slide, article.anime-card, #episodeGrid article, #latestCompletedList li, article[class*='card']").animes;
  return (await _parseAnimeListPage(doc, response.url || base)).animes;
}
async function getHome(opts) {
  const base = _baseUrl();
  const response = await _get(base, base + '/');
  const doc = _parseHtml(response.body);
  let popular = _parseCardList(doc, response.url || base,
    'article.spotlight-slide, #latestCompletedList li, .sidebar-list-panel li').animes;
  let latest = _parseCardList(doc, response.url || base,
    '#episodeGrid article, .latest-panel article').animes;
  if (!popular.length || !latest.length) {
    const listing = await _get(base + '/anime?page=0', base + '/');
    const all = _parseAnimeListPage(_parseHtml(listing.body), listing.url || base);
    if (!popular.length) popular = all.animes;
    if (!latest.length) latest = all.animes;
  }
  const rows = [];
  if (popular.length) rows.push({ title: 'Popular', items: popular });
  if (latest.length) rows.push({ title: 'Latest', items: latest });
  return rows;
}

// ── Upstream detail metadata ────────────────────────────────────────────────
function _extractDetailMetadata(doc, anime, pageUrl) {
  const titleElement = _selectFirst(doc,
    '.anime-hero h1, h1.anime-title, [class*="anime-hero"] h1, [class*="detail"] h1, main h1, h1'
  );
  const title = titleElement ? _text(titleElement) : (anime && anime.title ? anime.title : '');
  const img = _selectFirst(doc,
    'img.anime-poster, img.poster, .anime-hero img, [class*="poster"] img, [class*="hero"] img, main img'
  );
  const metaImage = _selectFirst(doc, "meta[property=og:image]");
  let cover = _extractImgUrl(img, pageUrl);
  if (cover == null) {
    if (metaImage) cover = _attr(metaImage, 'content');
    else {
      const bg = _selectFirst(doc, '.anime-poster, .poster, .anime-hero, [class*="poster"], [class*="hero"]') ||
        _selectFirst(doc, 'body') || doc;
      cover = _extractBg(bg, pageUrl);
    }
  }
  const descriptionElement = _selectFirst(doc,
    '.anime-synopsis, .synopsis, .description, [class*="synopsis"], [class*="description"], [class*="overview"], .desc'
  );
  const description = descriptionElement ? _text(descriptionElement) : null;
  const genreElements = _select(doc,
    '.genre-tag, .tag, a[href*="/genre/"], a[href*="/tag/"], [class*="genre"] a, link[rel=tag][href*="/genre/"]'
  );
  const genres = [];
  for (const el of genreElements) {
    let value;
    if (el.tag === 'link') {
      const path = _attr(el, 'href').split(/[?#]/)[0];
      const last = path.split('/').filter(Boolean).pop() || '';
      const decoded = _decode(last);
      value = decoded ? decoded.charAt(0).toUpperCase() + decoded.slice(1) : '';
    } else value = _text(el);
    if (value && value.trim() && genres.indexOf(value) < 0) genres.push(value);
  }
  let genre = genres.join(', ');
  if (!genre.trim()) {
    const animeMeta = _selectFirst(doc, 'p.anime-meta');
    if (animeMeta) {
      const text = _text(animeMeta);
      const index = text.indexOf('Genre:');
      const after = index >= 0 ? text.slice(index + 'Genre:'.length) : text;
      genre = after.split('|')[0].trim();
    }
  }
  if (!genre.trim()) genre = null;
  const studioElement = _selectFirst(doc, '.studio, .studio-name, [class*="studio"]');
  const author = studioElement ? _text(studioElement) : null;
  const status = _selectFirst(doc, "[class*='airing'], .status-airing, .airing-badge") ? 'ongoing' : 'completed';
  const url = _withoutDomain(pageUrl || (anime && anime.url) || '');
  const slug = _slugFromAnimeUrl(url);
  return {
    id: slug || url, title: title, englishTitle: title, url: url, cover: cover,
    description: description, genre: genre, genres: genre ? genre.split(', ') : [],
    author: author, status: status, type: 'anime', sourceId: SOURCE_ID, episodes: [], malId: null
  };
}
function _extractBg(el, base) {
  const style = _attr(el, 'style');
  if (!/background/i.test(style)) return null;
  const match = style.match(BACKGROUND_URL_REGEX);
  if (!match) return null;
  const value = match[1];
  if (!value) return null;
  return /^http/i.test(value) ? value : (_origin(base) || _baseUrl()) + '/' + value.replace(/^\/+/, '');
}
function _slugFromAnimeUrl(url) {
  const path = _pathQuery(url).replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  const index = parts.indexOf('anime');
  if (index >= 0 && parts[index + 1]) return _decode(parts[index + 1]);
  return _decode(parts[parts.length - 1] || '');
}

// ── Episodes: direct JavaScript port of upstream getEpisodeList ─────────────
function _qualityCandidates(preferred) {
  const normalized = String(preferred || PREF_QUALITY_DEFAULT);
  const first = normalized.indexOf('1080') >= 0 ? QUALITY_VALUES[0] :
    (normalized.indexOf('720') >= 0 ? QUALITY_VALUES[1] :
      (normalized.indexOf('480') >= 0 ? QUALITY_VALUES[2] :
        (normalized.indexOf('360') >= 0 ? QUALITY_VALUES[3] : normalized)));
  const result = [first];
  for (const quality of QUALITY_VALUES) if (result.indexOf(quality) < 0) result.push(quality);
  return result.map(_encodeResolution);
}
function _extractFilenames(html, base) {
  const filenames = new Set();
  const addDecoded = raw => {
    const clean = _decode(String(raw || '').trim());
    if (clean && clean.indexOf('/') < 0) filenames.add(clean);
  };
  const doc = _parseHtml(html);
  for (const link of _select(doc, "a[href*='/download/']")) {
    addDecoded(_attr(link, 'href').split('/').pop().split('?')[0]);
  }
  FILENAME_REGEX.lastIndex = 0;
  let match;
  while ((match = FILENAME_REGEX.exec(String(html || '')) !== null) addDecoded(match[1]);
  return Array.from(filenames);
}
function _buildEpisodeLabel(filename, season) {
  const epMatch = String(filename || '').match(EPISODE_NAME_REGEX);
  if (epMatch) {
    const ep = epMatch[1];
    const titlePart = epMatch[2].trim();
    const audio = (String(filename || '').match(SUBDUB_REGEX) || [])[1] || '';
    return 'Season ' + season + ' Ep ' + ep + ' - ' + titlePart + (audio ? ' [' + audio + ']' : '');
  }
  const clean = String(filename || '').replace(QUALITY_REGEX, '').replace(/\.[^.]+$/, '').trim();
  return season !== '1' && String(season || '').trim() ? 'Season ' + season + ' - ' + clean : clean;
}
function _parseEpisodeNumber(filename) {
  const match = String(filename || '').match(EPISODE_S_NUMBER_REGEX);
  return match ? (parseInt(match[1], 10) || 0) : 1;
}
function _episodeHref(href) { return _withoutDomain(String(href || '')); }
function _episodeFromJsonItem(item, season, base) {
  const href = String(item && item.href || '');
  const filename = _decode(href.split('?')[0].split('/').pop() || '');
  const num = Number(item && item.num) || 0;
  const title = String(item && item.label || '').trim() ? String(item.label) : _buildEpisodeLabel(filename, season);
  const url = _episodeHref(href);
  const number = num > 0 ? num : _parseEpisodeNumber(filename);
  return { id: url, url: url, title: title, number: number, episode_number: number, sourceId: SOURCE_ID };
}
function _uniqueInOrder(items) {
  const output = [];
  const seen = Object.create(null);
  for (const item of items || []) {
    const key = String(item && (item.url || item.id) || '');
    if (key && !seen[key]) { seen[key] = true; output.push(item); }
  }
  return output;
}
function _parseEpisodeJson(html, season, base) {
  let items;
  try { items = JSON.parse(String(html || '').trim()); } catch (e) { return []; }
  if (!Array.isArray(items) || !items.length) return [];
  const sorted = items.map((item, index) => ({ item: item, index: index })).sort((a, b) =>
    ((Number(b.item && b.item.num) || 0) - (Number(a.item && a.item.num) || 0)) || (a.index - b.index)
  ).map(entry => entry.item);
  return _uniqueInOrder(sorted.map(item => _episodeFromJsonItem(item, season, base)));
}
function _parseEpisodeNumberFromHref(href) {
  const match = String(href || '').match(EPISODE_NUMBER_REGEX);
  return match ? (parseInt(match[1], 10) || 0) : 0;
}
function _episodeFromHref(href, season, base) {
  const filename = _decode(String(href || '').split('?')[0].split('/').pop() || '');
  const number = _parseEpisodeNumber(filename);
  const url = _episodeHref(href);
  return { id: url, url: url, title: _buildEpisodeLabel(filename, season), number: number, episode_number: number, sourceId: SOURCE_ID };
}
function _parseEpisodeHtml(html, season, slug, resolution, base) {
  const text = String(html || '');
  if (text.trim().startsWith('[')) {
    const jsonEpisodes = _parseEpisodeJson(text, season, base);
    if (jsonEpisodes.length) return jsonEpisodes;
  }
  const doc = _parseHtml(text);
  const links = _select(doc, "a[href*='/download/']");
  if (links.length) {
    return _uniqueInOrder(links.slice().sort((a, b) =>
      _parseEpisodeNumberFromHref(_attr(b, 'href')) - _parseEpisodeNumberFromHref(_attr(a, 'href'))
    ).map(link => _episodeFromHref(_attr(link, 'href'), season, base)));
  }
  const filenames = _extractFilenames(text, base);
  if (filenames.length) {
    filenames.sort((a, b) => _parseEpisodeNumber(b) - _parseEpisodeNumber(a));
    return _uniqueInOrder(filenames.map(filename => _episodeFromHref(
      '/download/' + slug + '/' + season + '/' + resolution + '/' + _encodeForm(filename), season, base
    )));
  }
  return [];
}
async function _fetchSeasonEpisodes(slug, season, base, candidates) {
  let epHtml = '';
  let downloadLinks = [];
  let selectedRes = candidates[0];
  for (const res of candidates) {
    selectedRes = res;
    let html;
    try { html = await _getText(_origin(base) + '/episodes/' + slug + '/' + season + '/' + res, _baseUrl() + '/'); }
    catch (e) { continue; }
    epHtml = html;
    if (html.trim().startsWith('[')) {
      const jsonEpisodes = _parseEpisodeJson(html, season, base);
      if (jsonEpisodes.length) return jsonEpisodes;
    }
    const doc = _parseHtml(html);
    const links = _select(doc, "a[href*='/download/']");
    if (links.length) {
      downloadLinks = links.map(link => _attr(link, 'href'));
      break;
    }
  }
  if (!downloadLinks.length && epHtml.trim()) {
    const filenames = _extractFilenames(epHtml, base);
    if (filenames.length) {
      filenames.sort((a, b) => _parseEpisodeNumber(b) - _parseEpisodeNumber(a));
      return _uniqueInOrder(filenames.map(filename => _episodeFromHref(
        '/download/' + slug + '/' + season + '/' + selectedRes + '/' + _encodeForm(filename).replace(/\+/g, '%20'), season, base
      )));
    }
  }
  return _uniqueInOrder(downloadLinks.slice().sort((a, b) =>
    _parseEpisodeNumberFromHref(b) - _parseEpisodeNumberFromHref(a)
  ).map(href => _episodeFromHref(href, season, base)));
}
function _extractSeasons(doc) {
  const seasons = [];
  for (const el of _select(doc, '.season-tab[data-season], .season-option[data-season], [data-season]')) {
    const value = _attr(el, 'data-season');
    if (value.trim() && seasons.indexOf(value) < 0) seasons.push(value);
  }
  if (!seasons.length) seasons.push('1');
  return seasons.sort((a, b) => (parseInt(b, 10) || 0) - (parseInt(a, 10) || 0));
}
async function _episodesFromDocument(doc, slug, base) {
  const seasons = _extractSeasons(doc);
  const candidates = _qualityCandidates(_preferredQuality());
  const result = await Promise.all(seasons.map(season =>
    _fetchSeasonEpisodes(slug, season, base, candidates).catch(() => [])
  ));
  return _uniqueInOrder([].concat.apply([], result));
}
async function getEpisodes(url, opts) {
  const base = _baseUrl();
  const animeUrl = /^https?:\/\//i.test(String(url || '')) ? String(url) : _join(base, String(url || ''));
  const response = await _get(animeUrl, base + '/');
  const doc = _parseHtml(response.body);
  return _episodesFromDocument(doc, _slugFromAnimeUrl(url || animeUrl), response.url || base);
}

// ── Upstream hoster/video extraction ────────────────────────────────────────
function _resLabelFromResolution(resolution) {
  const value = String(resolution || '');
  if (value.indexOf('1080') >= 0) return '1080p';
  if (value.indexOf('720') >= 0) return '720p';
  if (value.indexOf('480') >= 0) return '480p';
  if (value.indexOf('360') >= 0) return '360p';
  return value;
}
function _extractDirectFallback(episodeUrl, filename, preferredServer) {
  const base = _baseUrl();
  const fullUrl = _join(base, episodeUrl);
  const resMatch = String(filename || '').match(RES_LABEL_REGEX);
  const resolutionLabel = resMatch ? resMatch[1] : _resLabelFromResolution(_preferredQuality());
  const audioMatch = String(filename || '').match(AUDIO_TAG_REGEX);
  const audio = audioMatch ? audioMatch[1] : '';
  const label = 'AV1 · ' + resolutionLabel + (audio ? ' [' + audio + ']' : '');
  return [_makeVideo(fullUrl, label, filename, base, preferredServer, 'Direct DL')];
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
function _makeVideo(url, label, filename, base, preferred, linkType) {
  if (!url || !/^https?:\/\//i.test(String(url))) return null;
  const kind = _mediaKind(filename);
  return {
    url: String(url), quality: label, container: _container(String(url)),
    headers: { 'User-Agent': DESKTOP_UA, Referer: _origin(base) + '/' },
    kind: kind.kind, audioLang: kind.audioLang, subtitles: [],
    linkType: linkType || 'Stream', preferred: !!preferred
  };
}
async function _extractVideoForHoster(hosterName, dlPath, resolution, baseFilename, slug, season) {
  const base = _baseUrl();
  const encodedFilename = String(dlPath || '').split('?')[0].split('/').pop();
  const filename = _decode(encodedFilename);
  let downloadPageUrl = _join(base, dlPath);
  let pageHtml = null;
  try { pageHtml = await _getText(downloadPageUrl, base + '/'); } catch (e) {}
  if (pageHtml == null || pageHtml.indexOf('anime-video-player') < 0) {
    const encodedRes = _encodeResolution(resolution);
    let freshDoc = null;
    try {
      const fresh = await _getText(base + '/episodes/' + slug + '/' + season + '/' + encodedRes, base + '/');
      freshDoc = _parseHtml(fresh);
    } catch (e) {}
    const freshLink = freshDoc ? _select(freshDoc, "a[href*='/download/']").find(link =>
      _attr(link, 'href').indexOf(encodedFilename) >= 0
    ) : null;
    if (freshLink) {
      downloadPageUrl = _join(base, _attr(freshLink, 'href'));
      try { pageHtml = await _getText(downloadPageUrl, base + '/'); } catch (e) {}
    }
  }
  const resMatch = filename.match(RES_LABEL_REGEX);
  const resLabel = resMatch ? resMatch[1] : _resLabelFromResolution(resolution);
  const audioMatch = filename.match(AUDIO_TAG_REGEX) || String(baseFilename || '').match(AUDIO_TAG_REGEX);
  const audioTag = audioMatch ? audioMatch[1] : '';
  const videoTitle = 'AV1 · ' + resLabel + (audioTag ? ' [' + audioTag + ']' : '');
  const doc = pageHtml == null ? null : _parseHtml(pageHtml);
  const iframe = doc ? _selectFirst(doc, "iframe#anime-video-player, iframe[src*='/r/']") : null;
  const iframeSrc = iframe ? _attr(iframe, 'src') : '';
  const watchUrl = iframeSrc ? ((await _resolveRedirect(iframeSrc, base)) || _join(base, iframeSrc)) : null;
  const tokenMatch = pageHtml == null ? null : pageHtml.match(TOKEN_REGEX);
  const ddlToken = tokenMatch ? tokenMatch[1] : null;
  let ddl = null;
  if (ddlToken != null) {
    try {
      const encoded = String(dlPath || '').split('?')[0].split('/').pop();
      const response = await _get(base + '/get_ddl/' + encoded, downloadPageUrl, {
        'Accept': 'application/json', 'Referer': downloadPageUrl, 'X-Ddl-Token': ddlToken
      });
      ddl = JSON.parse(response.body);
    } catch (e) { ddl = null; }
  }
  const ddlWatch = ddl && ddl.watch_link != null
    ? ((await _resolveRedirect(ddl.watch_link, base)) || _join(base, ddl.watch_link)) : null;
  const effectiveWatch = watchUrl || ddlWatch;
  const streamUrl = ddl && ddl.stream_link != null
    ? ((await _resolveRedirect(ddl.stream_link, base)) || _join(base, ddl.stream_link)) : null;
  const directDlUrl = ddl && ddl.download_link != null
    ? ((await _resolveRedirect(ddl.download_link, base)) || _join(base, ddl.download_link)) : downloadPageUrl;
  const torrentUrl = ddl && ddl.torrent_link != null
    ? ((await _resolveRedirect(ddl.torrent_link, base)) || _join(base, ddl.torrent_link)) : null;
  if (String(hosterName).toLowerCase() === 'stream') {
    return _makeVideo(streamUrl || directDlUrl, videoTitle + ' · Stream', filename, base, false, 'Stream');
  }
  if (String(hosterName).toLowerCase() === 'direct dl') {
    return _makeVideo(directDlUrl, videoTitle + ' · Direct DL', filename, base, false, 'Direct DL');
  }
  if (String(hosterName).toLowerCase() === 'dash') {
    if (effectiveWatch && effectiveWatch.indexOf('/watch/') >= 0) {
      const mpdUrl = effectiveWatch.split('/watch/').join('/dash/') + '/manifest.mpd';
      return _makeVideo(mpdUrl, videoTitle + ' · DASH', filename, base, false, 'Dash');
    }
    return _makeVideo(streamUrl || directDlUrl, videoTitle + ' · DASH', filename, base, false, 'Dash');
  }
  if (String(hosterName).toLowerCase() === 'torrent') {
    return torrentUrl ? _makeVideo(torrentUrl, videoTitle + ' (Torrent)', filename, base, false, 'Torrent') : null;
  }
  return _makeVideo(streamUrl || directDlUrl, videoTitle + ' · Stream', filename, base, false, 'Stream');
}
function _preferredQualityNumber() {
  const found = String(_preferredQuality()).match(/\d{3,4}/g);
  return found && found.length ? found[found.length - 1] : _preferredQuality();
}
function _sortVideosByPreferredQuality(videos) {
  const preferred = String(_preferredQualityNumber());
  return videos.slice().sort((a, b) => {
    const ap = String(a.quality || '').toLowerCase().indexOf(preferred.toLowerCase()) >= 0;
    const bp = String(b.quality || '').toLowerCase().indexOf(preferred.toLowerCase()) >= 0;
    if (ap !== bp) return ap ? -1 : 1;
    const an = (String(a.quality || '').match(/(\d{3,4})p/i) || [])[1];
    const bn = (String(b.quality || '').match(/(\d{3,4})p/i) || [])[1];
    return (parseInt(bn || '0', 10) || 0) - (parseInt(an || '0', 10) || 0);
  });
}
async function _videosForHoster(hosterName, episodeUrl) {
  const base = _baseUrl();
  const relative = _withoutDomain(episodeUrl);
  const pathParts = relative.split('?')[0].replace(/^\/+|\/+$/g, '').split('/');
  const encodedFilename = relative.split('?')[0].split('/').pop();
  const filename = _decode(encodedFilename);
  const preferredServer = hosterName.toLowerCase() === _preferredLinkType().toLowerCase();
  if (pathParts.length < 5 || pathParts[0] !== 'download') {
    return _extractDirectFallback(relative, filename, preferredServer);
  }
  const slug = pathParts[1];
  const season = pathParts[2];
  const originalResolution = _decode(pathParts[3]);
  const epMatch = filename.match(EPISODE_S_NUMBER_REGEX);
  const episodeNumber = epMatch ? (parseInt(epMatch[1], 10) || 0) : null;
  const allResolutions = ['1920 x 1080', '1280 x 720', '854 x 480', '640 x 360'];
  const results = await Promise.all(allResolutions.map(async resolution => {
    try {
      let dlPath = relative;
      if (resolution !== originalResolution) {
        const encodedRes = _encodeResolution(resolution);
        const epHtml = await _getText(base + '/episodes/' + slug + '/' + season + '/' + encodedRes, base + '/');
        const epDoc = _parseHtml(epHtml);
        const found = _select(epDoc, "a[href*='/download/']").find(link => {
          const href = _attr(link, 'href');
          const decodedHref = _decode(href);
          const match = decodedHref.match(EPISODE_NUMBER_REGEX);
          const linkEpisodeNumber = match ? (parseInt(match[1], 10) || 0) : null;
          return (episodeNumber != null && linkEpisodeNumber === episodeNumber) ||
            (episodeNumber == null && decodedHref.indexOf(filename) >= 0);
        });
        if (!found) return null;
        dlPath = _attr(found, 'href');
      }
      return await _extractVideoForHoster(hosterName, dlPath, resolution, filename, slug, season);
    } catch (e) { return null; }
  }));
  const videos = [];
  const seen = Object.create(null);
  for (const video of results) {
    if (!video || !video.url || seen[video.url]) continue;
    seen[video.url] = true;
    videos.push(video);
  }
  if (!videos.length) return _extractDirectFallback(relative, filename, preferredServer);
  const sorted = _sortVideosByPreferredQuality(videos);
  return sorted.map((video, index) => Object.assign({}, video, {
    preferred: index === 0 && preferredServer
  }));
}
async function getVideoSources(episodeUrl, opts) {
  const url = String(episodeUrl || '');
  if (!url) return [];
  const hosters = ['Stream', 'Direct DL', 'Dash'];
  if (_showTorrent()) hosters.push('Torrent');
  const preferred = _preferredLinkType();
  hosters.sort((a, b) => (b.toLowerCase() === preferred.toLowerCase() ? 1 : 0) -
    (a.toLowerCase() === preferred.toLowerCase() ? 1 : 0));
  const groups = await Promise.all(hosters.map(hoster => _videosForHoster(hoster, url).catch(() => [])));
  return [].concat.apply([], groups);
}
function getStreams(episodeUrl, opts) { return getVideoSources(episodeUrl, opts); }

// ── Zangetsu detail contract ────────────────────────────────────────────────
async function getDetail(url, opts) {
  const base = _baseUrl();
  const fullUrl = /^https?:\/\//i.test(String(url || '')) ? String(url) : _join(base, String(url || ''));
  const response = await _get(fullUrl, base + '/');
  const doc = _parseHtml(response.body);
  const details = _extractDetailMetadata(doc, { url: url, title: opts && opts.title }, response.url || base);
  details.episodes = await _episodesFromDocument(doc, _slugFromAnimeUrl(url || fullUrl), response.url || base);
  return details;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome,
    search: search, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams
  };
}
