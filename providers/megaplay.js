// MegaPlay — Anikoto catalogue + MegaPlay embed playback for Zangetsu.
// Version is mirrored in index.json; bump both whenever this source changes.
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'megaplay';
var VERSION = '1.0.0';
var CATALOG = 'https://anikototv.to';
var API = 'https://anikotoapi.site';
var BASE = 'https://megaplays.se';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function getInfo() { return { name: 'MegaPlay', lang: 'en', baseUrl: BASE, logo: BASE + '/favicon.ico', type: 'anime', version: VERSION }; }
function getSettings() { return []; }
function _get(url, ref, xhr) {
  var headers = { 'User-Agent': UA, 'Referer': ref || CATALOG + '/' };
  if (xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(url, { headers: headers, timeoutMs: 20000 }).then(function(r) { return r && r.body || ''; }).catch(function() { return ''; });
}
function _json(url, ref, xhr) { return _get(url, ref, xhr).then(function(b) { try { return JSON.parse(b || 'null'); } catch (_) { return null; } }); }
function _text(s) { return htmlText(String(s || '')).replace(/\s+/g, ' ').trim(); }
function _slug(href) { var m = String(href || '').match(/\/watch\/([^\/?#]+)/i); return m ? m[1] : ''; }
function _card(slug, title, cover) { return { id: slug, title: title, url: slug, cover: cover || null, type: 'anime', sourceId: SOURCE_ID }; }

function search(query, page) {
  var q = String(query || '').trim(); if (!q) return Promise.resolve([]);
  var url = CATALOG + '/filter?keyword=' + encodeURIComponent(q) + '&page=' + Math.max(1, Number(page) || 1);
  return _get(url, CATALOG + '/').then(function(html) {
    var out = [], seen = {}, chunks = String(html).split('<div class="item');
    for (var i = 1; i < chunks.length; i++) {
      var c = chunks[i], slug = _slug((c.match(/href=["']([^"']*\/watch\/[^"']+)/i) || [])[1]);
      if (!slug || seen[slug]) continue;
      var title = (c.match(/class=["']name d-title["'][^>]*>([^<]+)/i) || c.match(/data-jp=["']([^"']+)/i) || [])[1];
      var cover = (c.match(/<img[^>]+(?:data-src|src)=["']([^"']+)/i) || [])[1];
      title = _text(title); if (!title) continue;
      seen[slug] = 1; out.push(_card(slug, title, cover || null));
    }
    return out;
  }).catch(function() { return []; });
}
function getHome() {
  return _json(API + '/recent-anime?page=1&per_page=24', CATALOG + '/').then(function(j) {
    var rows = j && Array.isArray(j.data) ? j.data : [];
    var items = rows.filter(function(a) { return a && a.slug; }).map(function(a) { return _card(String(a.slug), _text(a.title || a.alternative || a.slug), a.poster || null); });
    return items.length ? [{ title: 'Recently Updated', items: items }] : [];
  }).catch(function() { return []; });
}
function _episodes(html, animeId, slug) {
  var out = [], seen = {}, re = /<a\b([^>]*data-id=["'](\d+)[^>]*?)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var attrs = m[1], id = m[2];
    var num = (attrs.match(/data-num=["']([^"']+)/i) || [])[1] || String(out.length + 1);
    var hasSub = /data-sub=["'](?:1|true|yes)/i.test(attrs), hasDub = /data-dub=["'](?:1|true|yes)/i.test(attrs);
    if (!hasSub && !hasDub) hasSub = true;
    var label = _text(m[3]) || ('Episode ' + num);
    ['sub','dub'].forEach(function(lang) {
      if ((lang === 'sub' && !hasSub) || (lang === 'dub' && !hasDub)) return;
      var key = id + '/' + lang; if (seen[key]) return; seen[key] = true;
      out.push({ id: id + '-' + lang, title: label + (lang === 'dub' ? ' (Dub)' : ' (Sub)'), number: Number(num) || null,
        url: 'megaplay://' + encodeURIComponent(id) + '/' + lang + '/' + encodeURIComponent(num), type: 'anime', category: lang,
        episodeId: id, animeId: animeId || null, slug: slug, sourceId: SOURCE_ID });
    });
  }
  return out;
}
function getDetail(url) {
  var slug = String(url || '').replace(/^https?:\/\/[^/]+\/watch\//i, '').replace(/^\/+|\/+$/g, '');
  if (!slug) return Promise.resolve(null);
  var pageUrl = CATALOG + '/watch/' + slug;
  return _get(pageUrl, CATALOG + '/').then(function(html) {
    var animeId = (html.match(/data-id=["'](\d+)["']/i) || [])[1] || '';
    var title = _text((html.match(/<h1[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i) ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]).replace(/\s*[|-]\s*Anikoto.*$/i, '');
    var cover = (html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || [])[1] || null;
    var desc = _text((html.match(/<div[^>]+class=["'][^"']*synopsis[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || [])[1] || '');
    if (!title) title = slug.replace(/[-_]/g, ' ');
    if (!animeId) return { id: slug, title: title, url: slug, cover: cover, type: 'anime', sourceId: SOURCE_ID, description: desc, episodes: [] };
    return _json(CATALOG + '/ajax/episode/list/' + animeId, pageUrl, true).then(function(j) {
      var markup = j && (j.result || j.html || j.data) || '';
      var episodes = _episodes(typeof markup === 'string' ? markup : '', animeId, slug);
      return { id: slug, title: title, url: slug, cover: cover, type: 'anime', sourceId: SOURCE_ID, description: desc, episodes: episodes };
    });
  }).catch(function() { return null; });
}
function getEpisodes(url) { return getDetail(url).then(function(d) { return d && Array.isArray(d.episodes) ? d.episodes : []; }); }
function getVideoSources(episodeUrl) {
  var raw = String(episodeUrl || '').replace(/^megaplay:\/\//i, '').split('/');
  var id = decodeURIComponent(raw[0] || '');
  if (!/^\d+$/.test(id)) return Promise.resolve([]);
  var lang = raw[1] === 'dub' ? 'dub' : 'sub';
  // Keep MegaPlay's player URL explicitly marked as an embed, not a direct media URL.
  return Promise.resolve([{ url: BASE + '/stream/s-2/' + encodeURIComponent(id) + '/' + lang,
    name: 'MegaPlay · Embed', provider: 'MegaPlay', quality: 'Embed', resolution: 'Embed',
    container: 'embed', hls: false, embed: true, downloadable: false, headers: { Referer: BASE + '/' } }]);
}
function getStreams(url) { return getVideoSources(url); }
if (typeof module !== 'undefined' && module.exports) module.exports = { version: VERSION, getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams };
