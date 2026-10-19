/*
 * StreamBeta Resolver — codedew.com/streambeta/
 * Resolver-only integration: StreamBeta does not expose an independent catalog.
 * Accepts a StreamBeta URL, HubCloud ID, or StreamBeta file ID as a search query.
 *
 * v1.0.0: initial resolver with source and alternate-audio parsing.
 */
var BASE = 'https://codedew.com/streambeta/';
var VERSION = '1.0.0';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function getInfo() {
  return { name: 'StreamBeta Resolver', lang: 'en', baseUrl: BASE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=codedew.com',
    type: 'anime', version: VERSION };
}
function getSettings() { return []; }
function _text(r) {
  if (r && typeof r.body === 'string') return Promise.resolve(r.body);
  if (r && typeof r.text === 'function') return r.text();
  return Promise.resolve('');
}
function _failed(r) {
  return !r || r.ok === false || (typeof r.status === 'number' && r.status >= 400);
}
function _get(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Referer': BASE } })
    .then(function (r) {
      if (_failed(r)) throw new Error('StreamBeta HTTP ' + (r && r.status));
      return _text(r);
    });
}
function _decode(s) {
  return String(s || '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function _strip(s) {
  return _decode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function _parse(html) {
  var out = { sources: [], fid: '', lang: '', langs: [], title: '', size: '', season: 0 };
  var m = String(html || '').match(/playerSources\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (m) {
    try { out.sources = JSON.parse(_decode(m[1])); } catch (_) { out.sources = []; }
  }
  out.fid = (String(html || '').match(/maskedFileId\s*=\s*["']([^"']+)["']/) || [])[1] || '';
  out.lang = _strip((String(html || '').match(/currentLangNative\s*=\s*["']([^"']+)["']/) || [])[1] || '');
  out.title = _strip((String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  out.size = _strip((String(html || '').match(/id=["']file-size-text["'][^>]*>([^<]*)</i) || [])[1] || '');
  var re = /class=["']lang-btn[^"']*["'][^>]*data-fid=["'](sb_[^"']+)["'][^>]*data-lang=["']([^"']+)["']/gi, x;
  while ((x = re.exec(String(html || '')))) out.langs.push({ fid: x[1], lang: _strip(x[2]) });
  return out;
}
function _urlFor(url) {
  url = String(url || '').trim();
  if (/^streambeta:\/\/v\//i.test(url)) return BASE + '?v=' + encodeURIComponent(url.replace(/^streambeta:\/\/v\//i, ''));
  if (/^streambeta:\/\/url\//i.test(url)) return BASE + '?url=' + encodeURIComponent(url.replace(/^streambeta:\/\/url\//i, ''));
  if (/^https?:\/\//i.test(url)) {
    try {
      var u = new URL(url);
      if (u.hostname !== 'codedew.com' && u.hostname !== 'www.codedew.com') return '';
      if (!/\/streambeta\/?$/i.test(u.pathname)) return '';
      if (u.searchParams.has('url') || u.searchParams.has('v')) return BASE + '?' + u.searchParams.toString();
      return '';
    } catch (_) { return ''; }
  }
  if (/^sb_[A-Za-z0-9_-]+$/.test(url)) return BASE + '?v=' + encodeURIComponent(url);
  if (/^[A-Za-z0-9_-]{4,160}$/.test(url)) return BASE + '?url=' + encodeURIComponent(url);
  return '';
}
function _item(url, title) {
  return { id: 'streambeta-' + encodeURIComponent(url), title: title || 'StreamBeta link',
    url: url, type: 'anime', cover: null };
}
function getHome() { return Promise.resolve([{ title: 'Resolver', items: [] }]); }
function search(query) {
  var target = _urlFor(query);
  if (!target) return Promise.resolve([]);
  var key = target.indexOf('?v=') >= 0 ? 'v' : 'url';
  var value = new URL(target).searchParams.get(key) || '';
  var itemUrl = key === 'v' ? 'streambeta://v/' + value : 'streambeta://url/' + value;
  return Promise.resolve([_item(itemUrl, 'StreamBeta • ' + value)]);
}
function getDetail(url) {
  var target = _urlFor(url);
  if (!target) return Promise.reject(new Error('StreamBeta: provide a valid StreamBeta URL or file ID'));
  return _get(target).then(function (html) {
    var parsed = _parse(html);
    if (!parsed.sources.length && !parsed.fid) throw new Error('StreamBeta: page did not expose playable sources');
    var eps = [];
    if (parsed.fid) eps.push({ id: parsed.fid, title: parsed.lang || 'Default audio',
      url: 'streambeta://v/' + parsed.fid, number: 1 });
    parsed.langs.forEach(function (l, i) {
      if (!eps.some(function (e) { return e.url === 'streambeta://v/' + l.fid; }))
        eps.push({ id: l.fid, title: l.lang || ('Audio ' + (i + 1)), url: 'streambeta://v/' + l.fid, number: i + 2 });
    });
    if (!eps.length) eps.push({ id: 'default', title: 'Default source', url: url, number: 1 });
    return { id: 'streambeta-' + (parsed.fid || 'url'), title: parsed.title || 'StreamBeta',
      url: url, type: 'anime', description: parsed.size ? 'File size: ' + parsed.size : null, episodes: eps };
  });
}
function getEpisodes(url) {
  return getDetail(url).then(function (detail) { return detail.episodes || []; });
}
function getVideoSources(url) {
  var target = _urlFor(url);
  if (!target) return Promise.resolve([]);
  return _get(target).then(function (html) {
    var parsed = _parse(html), out = [], seen = {};
    parsed.sources.forEach(function (s) {
      var u = s && (s.stream_url || s.url);
      if (!u || !/^https?:\/\//i.test(u) || seen[u] || /pixeldrain/i.test(String(s.type || ''))) return;
      seen[u] = true;
      out.push({ url: u, quality: /2160p/i.test(String(s.name || s.type || '')) ? '2160p' :
        (/1080p/i.test(String(s.name || s.type || '')) ? '1080p' : 'auto'),
        label: [parsed.lang || 'Auto', s.name || s.type || 'StreamBeta'].filter(Boolean).join(' • '),
        container: /\.m3u8(?:[?#]|$)/i.test(u) ? 'hls' : 'mp4',
        kind: 'dub', headers: { 'User-Agent': UA, 'Referer': target } });
    });
    return out;
  }).catch(function () { return []; });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks };
}
