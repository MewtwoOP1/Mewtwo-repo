/*
 * StreamBeta Resolver — codedew.com/streambeta/
 * Resolver-only integration: StreamBeta does not expose an independent catalog.
 * Accepts a StreamBeta URL, HubCloud ID, or StreamBeta file ID as a search query.
 *
 * v1.0.1: expose alternate languages as player stream choices, not fake episodes.
 */
var BASE = 'https://codedew.com/streambeta/';
var VERSION = '1.0.1';
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
    // Language buttons are alternate audio versions of the same file, not episodes.
    // Keep one playable item; getVideoSources exposes each language as a player choice.
    var eps = [{ id: parsed.fid || 'default', title: parsed.title || 'Play',
      url: parsed.fid ? ('streambeta://v/' + parsed.fid) : url, number: 1 }];
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
  function loadPage(pageUrl) {
    return _get(pageUrl).then(function (html) {
      var parsed = _parse(html);
      return { pageUrl: pageUrl, parsed: parsed };
    }).catch(function () { return { pageUrl: pageUrl, parsed: { sources: [], fid: '', lang: '', langs: [] } }; });
  }
  return loadPage(target).then(function (first) {
    var parsed = first.parsed;
    var choices = [], seenFids = {};
    function add(fid, lang, pageUrl) {
      fid = String(fid || '');
      if (!fid || seenFids[fid]) return;
      seenFids[fid] = true;
      choices.push({ fid: fid, lang: String(lang || 'Audio'), pageUrl: pageUrl });
    }
    add(parsed.fid, parsed.lang || 'Default audio', first.pageUrl);
    (parsed.langs || []).forEach(function (l) {
      add(l.fid, l.lang, BASE + '?v=' + encodeURIComponent(l.fid));
    });
    // If no language selector exists, use the page's sources directly.
    var pages = choices.length ? Promise.all(choices.map(function (choice) {
      return loadPage(choice.pageUrl).then(function (r) { return { choice: choice, parsed: r.parsed, pageUrl: r.pageUrl }; });
    })) : Promise.resolve([{ choice: { lang: parsed.lang || 'Default audio', pageUrl: first.pageUrl }, parsed: parsed, pageUrl: first.pageUrl }]);
    return pages.then(function (results) {
      var out = [], seen = {};
      results.forEach(function (entry) {
        (entry.parsed.sources || []).forEach(function (s) {
          var u = s && (s.stream_url || s.url);
          if (!u || !/^https?:\/\//i.test(u) || seen[u] || /pixeldrain/i.test(String(s.type || ''))) return;
          seen[u] = true;
          var qualityText = String(s.name || s.type || '');
          out.push({ url: u,
            quality: /2160p/i.test(qualityText) ? '2160p' : (/1080p/i.test(qualityText) ? '1080p' : 'auto'),
            label: [entry.choice.lang || entry.parsed.lang || 'Auto', s.name || s.type || 'StreamBeta'].filter(Boolean).join(' • '),
            container: /\.m3u8(?:[?#]|$)/i.test(u) ? 'hls' : 'mp4',
            kind: /\b(hindi|tamil|telugu|malayalam|kannada|dub)\b/i.test(entry.choice.lang || '') ? 'dub' : 'sub',
            audioLang: entry.choice.lang || entry.parsed.lang || '',
            headers: { 'User-Agent': UA, 'Referer': entry.pageUrl || target } });
        });
      });
      return out;
    });
  }).catch(function () { return []; });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings,
    getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes,
    getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks };
}
