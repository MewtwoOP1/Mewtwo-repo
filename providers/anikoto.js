// AniKoto — anime source for the Zangetsu provider repo (anikototv.to).
//
// anikototv.to is an aniwatch-style site. Streams are NOT keyed by the episode
// id — each episode carries an encrypted `data-ids` (server_ids) blob, and the
// real player is resolved through the site's own two-step server chain, then
// extracted from the embed host (plain m3u8 + subtitle tracks):
//   /filter?keyword=            -> slug
//   /watch/<slug>               -> anime id (data-id) + metadata
//   /ajax/episode/list/<id>     -> [{ data-id, num, sub, dub, data-ids(server_ids) }]
//   /ajax/server/list?servers=<server_ids> -> server list (VidPlay/HD/Vidstream/…)
//   /ajax/server?get=<link_id>  -> { url: <player embed>, skip_data }
//   <embed host>/stream/getSources(New)?id=<embed data-id> -> m3u8 + subs
//   (MegaPlay/VidWish: both getSources and getSourcesNew now return an AES-CBC
//    `enc` blob instead of plain sources.file — decrypted with the player's own
//    TRUST_AES_KEY/IV from megaplay's newclient. VidPlay/vidtube still plain.)
//
// Some episodes only list servers that no longer hand back a plain file. For
// those the site's own player asks a mapper API for EXTRA servers, keyed by the
// <mal>/<episode>/<timestamp> the episode anchors already carry, so we carry
// those three through the episode url and ask the same API when the episode's
// own servers all come up empty.
//
// Home = /home spotlight (hero) + recent from the JSON API (anikotoapi.site);
// slugs are shared with the site, so those cards resolve through getDetail.

var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID)
  ? String(__SOURCE_ID) : 'anikoto';

var SITE = 'https://anikototv.to';
var API = 'https://anikotoapi.site';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// Embed hosts that hand back a plain m3u8 (via getSources or getSourcesNew).
var PLAYER_RE = /^https?:\/\/(?:[a-z0-9-]+\.)?(?:vidtube\.[a-z]+|megaplay\.[a-z]+|vidwish\.[a-z]+)/i;
// Extra servers the episode's own list doesn't offer, keyed <mal>/<ep>/<ts>.
var MAPPER = 'https://mapper.nekostream.site/api/mal/';

function getInfo() {
  return { name: 'AniKoto', lang: 'en', baseUrl: SITE,
    logo: 'https://www.google.com/s2/favicons?sz=256&domain=anikotoapi.site', type: 'anime', version: '1.1.0' };
}
function getSettings() { return []; }

// MegaPlay/VidWish: getSourcesNew is the endpoint their player hits; both routes
// now encrypt the file into `enc`. VidPlay (vidtube) only exposes getSources.
function _sourcesUrl(base, dataId, type) {
  var path = /(?:megaplay|vidwish)\.[a-z]+/i.test(String(base || ''))
    ? '/stream/getSourcesNew' : '/stream/getSources';
  return base + path + '?id=' + dataId + '&type=' + type;
}

// MegaPlay player defaults (newclient.min.js TRUST_AES_KEY / TRUST_AES_IV).
// Sandbox only bridges AES-CTR, so CBC is pure JS below (same as hdhub4u).
var MEGA_AES_KEY = 'i?LMTAx0Q6,:}50U';
var MEGA_AES_IV = "W0;27ToaUpl_P%'c";

function _padBytes(s, n) {
  var out = [], i;
  for (i = 0; i < n; i++) out[i] = 0;
  var b = String(s || '');
  for (i = 0; i < b.length && i < n; i++) out[i] = b.charCodeAt(i) & 0xff;
  return out;
}
function _b64urlBytes(s) {
 var t=String(s||'').replace(/-/g,'+').replace(/_/g,'/'); while(t.length%4)t+='=';
 var chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[],buffer=0,bits=0;
 for(var i=0;i<t.length;i++){var ch=t.charAt(i);if(ch==='=')break;var v=chars.indexOf(ch);if(v<0)continue;buffer=(buffer<<6)|v;bits+=6;if(bits>=8){bits-=8;out.push((buffer>>bits)&255);buffer&=(1<<bits)-1;}}
 return out;
}
// Plain sources.file when present; otherwise AES-CBC-decrypt `enc` → {file}.
function _fileFromSources(j) {
  var s = j && j.sources;
  var file = s ? (s.file || (s[0] && s[0].file)) : null;
  if (file) return file;
  if (!j || !j.enc) return null;
  try {
    var ct = _b64urlBytes(j.enc);
    if (!ct.length || ct.length % 16 !== 0) return null;
    var pt = _bytesToStr(_aesCbcDecrypt(ct, _padBytes(MEGA_AES_KEY, 32), _padBytes(MEGA_AES_IV, 16)));
    var o = JSON.parse(pt);
    if (!o) return null;
    if (o.file) return o.file;
    s = o.sources;
    return s ? (s.file || (s[0] && s[0].file)) : null;
  } catch (e) { return null; }
}

function _mode(opts) { return (opts && opts.category === 'dub') ? 'dub' : 'sub'; }

// GET a page as text. `xhr` sets the ajax header the /ajax routes expect.
function _get(url, ref, xhr) {
  var h = { 'User-Agent': UA, 'Referer': ref || SITE + '/' };
  if (xhr) h['X-Requested-With'] = 'XMLHttpRequest';
  return fetch(url, { headers: h })
    .then(function (r) { return r.body || ''; })
    .catch(function () { return ''; });
}
function _json(url, ref) {
  return _get(url, ref).then(function (b) {
    var j; try { j = JSON.parse(b || 'null'); } catch (e) { j = null; } return j;
  });
}
// The site's /ajax routes wrap their payload in { status, result }. `result` is
// an HTML string (episode/server list) or an object (server?get).
function _ajax(path) {
  return _get(SITE + path, SITE + '/', true).then(function (b) {
    var j; try { j = JSON.parse(b || 'null'); } catch (e) { j = null; } return j;
  }).catch(function () { return null; });
}

function _year(s) { var m = String(s || '').match(/(19|20)\d{2}/); return m ? m[0] : null; }
function _slugFromWatch(href) {
  var m = String(href || '').match(/\/watch\/([^/"?#]+)/);
  return m ? m[1] : null;
}

function _validDisplayTitle(value) {
  var s = htmlText(String(value || '')).replace(/\s+/g, ' ').trim();
  if (!s || s.length < 2 || s.length > 300) return '';
  var meaningful = s.replace(/\b(?:tv|movie|movies|ova|ona|special|episode|episodes|sub|dub|hd|sd|season|series)\b/gi, ' ')
    .replace(/[0-9]+/g, ' ')
    .replace(/[^A-Za-z\u00C0-\u024F\u3040-\u30ff\u3400-\u9fff]/g, '');
  return meaningful ? s : '';
}
function _pickDisplayTitle(attrs, inner, card) {
  var values = [], v;
  ['data-jp','data-title','title','aria-label'].forEach(function (name) {
    var re = new RegExp("\\b" + name + "\\s*=\\s*(['\\\"])(.*?)\\1", "i");
    var found = String(attrs || '').match(re);
    if (found && found[2]) values.push(found[2]);
  });
  var blocks = String(card || '') + ' ' + String(inner || '');
  var re = /<(?:h[1-6]|span|div|p)[^>]*class=["'][^"']*(?:name|title|d-title|film-name)[^"']*["'][^>]*>([\s\S]*?)<\/(?:h[1-6]|span|div|p)>/gi, m;
  while ((m = re.exec(blocks)) && values.length < 20) values.push(m[1].replace(/<[^>]*>/g, ' '));
  re = /data-jp=["']([^"']+)["']/gi;
  while ((m = re.exec(blocks)) && values.length < 25) values.push(m[1]);
  re = /<img\b[^>]*alt=["']([^"']+)["']/gi;
  while ((m = re.exec(blocks)) && values.length < 30) values.push(m[1]);
  values.push(String(inner || '').replace(/<[^>]*>/g, ' '));
  for (var i = 0; i < values.length; i++) {
    v = _validDisplayTitle(values[i]);
    if (v) return v;
  }
  return '';
}
function _apiTitle(value, fallback) {
  var t = value;
  if (t && typeof t === 'object') t = t.english || t.romaji || t.native || t.userPreferred || '';
  t = _validDisplayTitle(t || fallback || '');
  return t;
}

// ── Search: scrape /filter?keyword= result cards ────────────────────────────
function search(query, page, opts) {
  var q = String(query || '').trim();
  if (!q) return Promise.resolve([]);
  var url = SITE + '/filter?keyword=' + encodeURIComponent(q) + '&page=' + (page || 1);
  return _get(url, SITE + '/').then(function (html) {
    html = String(html || '');
    var out = [], seen = {}, re = /<a\b([^>]*href=["'][^"']*\/watch\/[^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi, m;
    while ((m = re.exec(html)) && out.length < 60) {
      var href = (m[1].match(/href=["']([^"']+)["']/i) || [])[1] || '';
      var slug = _slugFromWatch(href);
      if (!slug || seen[slug]) continue;
      var cardStart = Math.max(html.lastIndexOf('<div', m.index), html.lastIndexOf('<article', m.index), 0);
      var card = html.slice(cardStart, Math.min(html.length, m.index + 2500));
      var title = _pickDisplayTitle(m[1], m[2], card);
      if (!title) continue;
      var poster = (card.match(/<img[^>]+(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i) || [])[1] || null;
      seen[slug] = 1;
      out.push({ id: slug, title: title, url: slug, cover: poster, type: 'anime', sourceId: SOURCE_ID });
    }
    return out;
  }).catch(function () { return []; });
}

// ── Home: /home spotlight (hero) + recent from the JSON API ──────────────────
function _apiCard(a) {
  if (!a) return null;
  var id = String(a.id != null ? a.id : (a.slug || ''));
  var title = _apiTitle(a.title, a.alternative || a.name || '');
  if (!id || !title) return null;
  return { id: id, title: title, url: id,
    cover: a.poster || a.poster_url || a.posterUrl || a.image || null,
    type: 'anime', sourceId: SOURCE_ID,
    subCount: a.is_sub ? 1 : 0, dubCount: a.is_dub ? 1 : 0 };
}
// Slice the /home page into its section containers (#hotest / #top-anime /
// #recent-update), each bounded by the next section so cards don't bleed across.
function _sections(html) {
  var ids = ['hotest', 'top-anime', 'recent-update'], marks = [];
  for (var i = 0; i < ids.length; i++) {
    var k = html.indexOf('id="' + ids[i] + '"');
    if (k >= 0) marks.push({ id: ids[i], at: k });
  }
  marks.sort(function (a, b) { return a.at - b.at; });
  var res = {};
  for (var j = 0; j < marks.length; j++) {
    var end = (j + 1 < marks.length) ? marks[j + 1].at : marks[j].at + 30000;
    res[marks[j].id] = html.substring(marks[j].at, end);
  }
  return res;
}
// Spotlight (#hotest) cards carry the title in an <h2 …d-title> + a bg-image.
function _spotlight(seg) {
  var out = [], seen = {}, chunks = seg.split('swiper-slide item');
  for (var i = 1; i < chunks.length; i++) {
    var c = chunks[i];
    var slug = _slugFromWatch((c.match(/href="([^"]*\/watch\/[^"]+)"/) || [])[1]);
    if (!slug || seen[slug]) continue;
    var title = (c.match(/class="title d-title"[^>]*>\s*([^<]+?)\s*</) || [])[1]
      || (c.match(/data-jp="([^"]+)"/) || [])[1];
    if (!title) continue;
    var img = (c.match(/background-image:\s*url\(([^)]+)\)/)
      || c.match(/<img[^>]+data-src="([^"]+)"/) || c.match(/<img[^>]+src="([^"]+)"/) || [])[1];
    if (img) img = img.replace(/^['"]|['"]$/g, '');
    seen[slug] = 1;
    out.push({ id: slug, title: htmlText(title).trim(), url: slug,
      cover: img || null, type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}
// Generic grid (#top-anime a.item, #recent-update div.item) → cards.
function _gridCards(seg) {
  var out = [], seen = {}, items = String(seg || '').split('class="item');
  for (var i = 1; i < items.length; i++) {
    var c = items[i];
    var slug = _slugFromWatch((c.match(/href="([^"]*\/watch\/[^"]+)"/) || [])[1]);
    if (!slug || seen[slug]) continue;
    var title = (c.match(/class="(?:name|title)[^"]*d-title"[^>]*>\s*([^<]+?)\s*</) || [])[1]
      || (c.match(/class="name"[^>]*>\s*([^<]+?)\s*</) || [])[1]
      || (c.match(/data-jp="([^"]+)"/) || [])[1];
    var poster = (c.match(/<img[^>]+data-src="([^"]+)"/) || c.match(/<img[^>]+src="([^"]+)"/) || [])[1];
    if (!title) continue;
    seen[slug] = 1;
    out.push({ id: slug, title: htmlText(title).trim(), url: slug,
      cover: poster || null, type: 'anime', sourceId: SOURCE_ID });
  }
  return out;
}
function getHome(opts) {
  return fetch(API + '/recent-anime?page=1&per_page=24', { headers: { 'Accept': 'application/json' } })
    .then(function (r) { if (!r || r.status >= 400) throw Error('AniKoto API HTTP error'); return r.body || ''; })
    .then(function (body) {
      var j; try { j = typeof body === 'string' ? JSON.parse(body || '{}') : body; } catch (e) { j = {}; }
      var rows = Array.isArray(j.data) ? j.data : (Array.isArray(j.results) ? j.results : (Array.isArray(j.anime) ? j.anime : []));
      var items = [];
      rows.forEach(function (x) {
        if (!x) return;
        var id = String(x.id != null ? x.id : (x.slug || ''));
        var title = _apiTitle(x.title, x.alternative || x.name || id);
        if (!id || !title) return;
        items.push({ id: id, title: title, url: id, cover: x.poster || x.poster_url || x.posterUrl || x.image || null,
          type: 'anime', sourceId: SOURCE_ID, description: x.synopsis || x.description || '' });
      });
      return items.length ? [{ title: 'Recently Updated', items: items }] : [];
    }).catch(function () { return []; });
}

// ── Detail + episodes ───────────────────────────────────────────────────────
function _cleanTitle(og) {
  var t = String(og || '');
  t = t.replace(/\s*[|-]\s*Anikoto.*$/i, '');        // trailing site name
  t = t.replace(/^Watch\s+/i, '').replace(/^Anime\s+/i, ''); // leading fluff
  t = t.replace(/\s+Anime\s+Online.*$/i, '');         // "X Anime Online …"
  t = t.replace(/\s+Watch\s+Online.*$/i, '');         // "X Watch Online Free"
  t = t.replace(/\s+Online\s+(with|free)\b.*$/i, ''); // "X Online with SUB/DUB"
  return t.trim();
}
function _genres(html) {
  var g = [], re = /href="[^"]*\/genre\/[^"]*"[^>]*>([^<]+)</g, m;
  while ((m = re.exec(html)) !== null && g.length < 8) {
    var t = htmlText(m[1]).trim(); if (t) g.push(t);
  }
  return g;
}

// Episode url: anikoto://<cat>/<encoded server_ids>/<sub><dub>/<num>, then the
// mapper token <mal>/<ep>/<timestamp> when the episode list carries it. The
// player rewrites the leading <cat> segment for its Sub/Dub toggle;
// getVideoSources resolves the server list from the (per-episode) server_ids
// blob. The token is appended, never inserted, so urls saved before it existed
// (history, downloads) still resolve — they just skip the mapper fallback.
function _epUrl(cat, serverIds, sub, dub, num, token) {
  return 'anikoto://' + cat + '/' + encodeURIComponent(serverIds) + '/'
    + (sub ? 1 : 0) + (dub ? 1 : 0) + '/' + num
    + (token ? '/' + token : '');
}

function getDetail(url, opts) {
  var requested = String(url || '').replace(/^anikotoapi:\/\//, '');
  try { requested = decodeURIComponent(requested); } catch (e) {}
  function requestSeries(seriesId) {
    return fetch(API + '/series/' + encodeURIComponent(seriesId), { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r || r.status >= 400) throw Error('AniKoto API HTTP error'); return r.body || ''; })
      .then(function (body) { var j; try { j = typeof body === 'string' ? JSON.parse(body || '{}') : body; } catch (e) { j = {}; } return j; });
  }
  function normalize(j, seriesId) {
    var anime = j && (j.anime || (j.data && (j.data.anime || j.data)) || j.series) || {};
    var eps = j && (Array.isArray(j.episodes) ? j.episodes : (j.data && Array.isArray(j.data.episodes) ? j.data.episodes : [])) || [];
    if (!eps.length || (!anime.title && !anime.name)) return null;
    var title = anime.title || anime.name || anime.alternative || seriesId, episodes = [];
    eps.forEach(function (ep, i) {
      if (!ep) return;
      var num = Number(ep.number || ep.episode || ep.episode_number || i + 1);
      var embeds = ep.embed_url || ep.embedUrl || {};
      var sub = typeof embeds.sub === 'string' ? embeds.sub : (ep.sub || ep.embed_sub || '');
      var dub = typeof embeds.dub === 'string' ? embeds.dub : (ep.dub || ep.embed_dub || '');
      ['sub','dub'].forEach(function (kind) {
        var embed = kind === 'sub' ? sub : dub;
        if (!embed) return;
        var token = 'anikotoapi://' + encodeURIComponent(JSON.stringify({ id: seriesId, number: num, kind: kind, embed: embed }));
        episodes.push({ id: String(num) + (kind === 'dub' ? '-dub' : '-sub'), number: num,
          title: 'Episode ' + num + (kind === 'dub' ? ' (Dub)' : ' (Sub)'), audio: kind,
          url: token, embedUrl: embed });
      });
    });
    return { id: String(anime.id != null ? anime.id : seriesId), title: title,
      url: String(anime.id != null ? anime.id : seriesId),
      cover: anime.poster || anime.poster_url || anime.posterUrl || anime.image || null,
      banner: anime.banner || anime.cover || null, description: anime.synopsis || anime.description || '',
      genres: anime.genres || [], type: 'anime', sourceId: SOURCE_ID, episodes: episodes,
      subCount: episodes.filter(function (e) { return e.audio === 'sub'; }).length,
      dubCount: episodes.filter(function (e) { return e.audio === 'dub'; }).length };
  }
  return requestSeries(requested).then(function (j) {
    var detail = normalize(j, requested);
    if (detail) return detail;
    return fetch(API + '/recent-anime?page=1&per_page=60', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r || r.status >= 400) throw Error('AniKoto API recent-list lookup failed'); return r.body || ''; })
      .then(function (body) {
        var list; try { list = typeof body === 'string' ? JSON.parse(body || '{}') : body; } catch (e) { list = {}; }
        var rows = Array.isArray(list.data) ? list.data : (Array.isArray(list.results) ? list.results : []);
        var norm = function (v) { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
        var row = rows.filter(function (x) {
          return String(x.id) === requested || String(x.slug || '') === requested || norm(x.title || x.name) === norm(requested);
        })[0];
        if (!row || row.id == null) throw Error('AniKoto API could not map this search result to a series ID');
        return requestSeries(row.id).then(function (j2) {
          var detail2 = normalize(j2, row.id);
          if (!detail2) throw Error('AniKoto API returned no series details');
          return detail2;
        });
      });
  });
}

function getEpisodes(url, opts) { return getDetail(url, opts).then(function (d) { return d.episodes; }); }

// ── Streams: server_ids → server list → server?get → embed getSources(New) ───
function _parseServers(html) {
  var servers = [], re = /data-type="(\w+)"([\s\S]*?)(?=data-type="|$)/g, tm;
  while ((tm = re.exec(html)) !== null) {
    var type = tm[1], block = tm[2], lm, lre = /data-link-id="([^"]+)"[^>]*>([^<]*)</g;
    while ((lm = lre.exec(block)) !== null) {
      servers.push({ type: type, linkId: lm[1], name: (lm[2] || '').trim() });
    }
  }
  return servers;
}
// Prefer VidPlay; Vidstream/HD (MegaPlay) work again via enc decrypt.
function _srvRank(name) {
  var n = String(name || '').toLowerCase();
  if (n.indexOf('vidplay') > -1) return 0;
  if (n.indexOf('vidstream') > -1) return 1;
  if (n.indexOf('hd') > -1) return 2;
  if (n.indexOf('vidcloud') > -1) return 3;
  return 5;
}

function getVideoSources(episodeUrl, opts) {
  var raw = String(episodeUrl || '');
  if (raw.indexOf('anikotoapi://') !== 0) return Promise.resolve([]);
  var data;
  try { data = JSON.parse(decodeURIComponent(raw.slice('anikotoapi://'.length))); } catch (e) { return Promise.resolve([]); }
  if (!data || !data.embed) return Promise.resolve([]);
  if (typeof extractVideo !== 'function') return Promise.resolve([{
    url: data.embed, label: 'AniKoto API · ' + String(data.kind || 'sub').toUpperCase(),
    quality: 'Auto', container: 'unknown', headers: { Referer: data.embed },
    referer: data.embed, kind: data.kind || 'sub'
  }]);
  return Promise.resolve(extractVideo(data.embed, {
    headers: { 'User-Agent': UA, 'Referer': data.embed },
    kind: data.kind || 'sub', audioLang: data.kind === 'dub' ? 'en' : 'ja'
  })).then(function (items) {
    return (Array.isArray(items) ? items : []).map(function (item) {
      return Object.assign({}, item, { kind: data.kind || 'sub', referer: data.embed,
        headers: Object.assign({ 'User-Agent': UA, 'Referer': data.embed }, item && item.headers || {}) });
    });
  }).catch(function () { return []; });
}

// ── MegaPlay AES-256-CBC (sandbox has CTR only) ─────────────────────────────
// Byte-for-byte match of megaplay newclient decrypt against a live getSourcesNew
// `enc` → {"file":"…master.m3u8"}. Tables/ops mirror providers/hdhub4u.js.
var _SBOX=[0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,0x09,0x83,0x2c,0x1a,0x1b,0x6e,0x5a,0xa0,0x52,0x3b,0xd6,0xb3,0x29,0xe3,0x2f,0x84,0x53,0xd1,0x00,0xed,0x20,0xfc,0xb1,0x5b,0x6a,0xcb,0xbe,0x39,0x4a,0x4c,0x58,0xcf,0xd0,0xef,0xaa,0xfb,0x43,0x4d,0x33,0x85,0x45,0xf9,0x02,0x7f,0x50,0x3c,0x9f,0xa8,0x51,0xa3,0x40,0x8f,0x92,0x9d,0x38,0xf5,0xbc,0xb6,0xda,0x21,0x10,0xff,0xf3,0xd2,0xcd,0x0c,0x13,0xec,0x5f,0x97,0x44,0x17,0xc4,0xa7,0x7e,0x3d,0x64,0x5d,0x19,0x73,0x60,0x81,0x4f,0xdc,0x22,0x2a,0x90,0x88,0x46,0xee,0xb8,0x14,0xde,0x5e,0x0b,0xdb,0xe0,0x32,0x3a,0x0a,0x49,0x06,0x24,0x5c,0xc2,0xd3,0xac,0x62,0x91,0x95,0xe4,0x79,0xe7,0xc8,0x37,0x6d,0x8d,0xd5,0x4e,0xa9,0x6c,0x56,0xf4,0xea,0x65,0x7a,0xae,0x08,0xba,0x78,0x25,0x2e,0x1c,0xa6,0xb4,0xc6,0xe8,0xdd,0x74,0x1f,0x4b,0xbd,0x8b,0x8a,0x70,0x3e,0xb5,0x66,0x48,0x03,0xf6,0x0e,0x61,0x35,0x57,0xb9,0x86,0xc1,0x1d,0x9e,0xe1,0xf8,0x98,0x11,0x69,0xd9,0x8e,0x94,0x9b,0x1e,0x87,0xe9,0xce,0x55,0x28,0xdf,0x8c,0xa1,0x89,0x0d,0xbf,0xe6,0x42,0x68,0x41,0x99,0x2d,0x0f,0xb0,0x54,0xbb,0x16];
var _ISBOX=[0x52,0x09,0x6a,0xd5,0x30,0x36,0xa5,0x38,0xbf,0x40,0xa3,0x9e,0x81,0xf3,0xd7,0xfb,0x7c,0xe3,0x39,0x82,0x9b,0x2f,0xff,0x87,0x34,0x8e,0x43,0x44,0xc4,0xde,0xe9,0xcb,0x54,0x7b,0x94,0x32,0xa6,0xc2,0x23,0x3d,0xee,0x4c,0x95,0x0b,0x42,0xfa,0xc3,0x4e,0x08,0x2e,0xa1,0x66,0x28,0xd9,0x24,0xb2,0x76,0x5b,0xa2,0x49,0x6d,0x8b,0xd1,0x25,0x72,0xf8,0xf6,0x64,0x86,0x68,0x98,0x16,0xd4,0xa4,0x5c,0xcc,0x5d,0x65,0xb6,0x92,0x6c,0x70,0x48,0x50,0xfd,0xed,0xb9,0xda,0x5e,0x15,0x46,0x57,0xa7,0x8d,0x9d,0x84,0x90,0xd8,0xab,0x00,0x8c,0xbc,0xd3,0x0a,0xf7,0xe4,0x58,0x05,0xb8,0xb3,0x45,0x06,0xd0,0x2c,0x1e,0x8f,0xca,0x3f,0x0f,0x02,0xc1,0xaf,0xbd,0x03,0x01,0x13,0x8a,0x6b,0x3a,0x91,0x11,0x41,0x4f,0x67,0xdc,0xea,0x97,0xf2,0xcf,0xce,0xf0,0xb4,0xe6,0x73,0x96,0xac,0x74,0x22,0xe7,0xad,0x35,0x85,0xe2,0xf9,0x37,0xe8,0x1c,0x75,0xdf,0x6e,0x47,0xf1,0x1a,0x71,0x1d,0x29,0xc5,0x89,0x6f,0xb7,0x62,0x0e,0xaa,0x18,0xbe,0x1b,0xfc,0x56,0x3e,0x4b,0xc6,0xd2,0x79,0x20,0x9a,0xdb,0xc0,0xfe,0x78,0xcd,0x5a,0xf4,0x1f,0xdd,0xa8,0x33,0x88,0x07,0xc7,0x31,0xb1,0x12,0x10,0x59,0x27,0x80,0xec,0x5f,0x60,0x51,0x7f,0xa9,0x19,0xb5,0x4a,0x0d,0x2d,0xe5,0x7a,0x9f,0x93,0xc9,0x9c,0xef,0xa0,0xe0,0x3b,0x4d,0xae,0x2a,0xf5,0xb0,0xc8,0xeb,0xbb,0x3c,0x83,0x53,0x99,0x61,0x17,0x2b,0x04,0x7e,0xba,0x77,0xd6,0x26,0xe1,0x69,0x14,0x63,0x55,0x21,0x0c,0x7d];
function _xtime(a){a<<=1;if(a&0x100)a^=0x11b;return a&0xff;}
function _gmul(a,b){var p=0;for(var i=0;i<8;i++){if(b&1)p^=a;var hi=a&0x80;a=(a<<1)&0xff;if(hi)a^=0x1b;b>>=1;}return p&0xff;}
function _keyExp(key){
  var Nk=key.length/4,Nr=Nk+6,w=[],i;
  for(i=0;i<Nk;i++)w.push([key[4*i],key[4*i+1],key[4*i+2],key[4*i+3]]);
  var rcon=1;
  for(i=Nk;i<4*(Nr+1);i++){
    var t=w[i-1].slice();
    if(i%Nk===0){t=[t[1],t[2],t[3],t[0]];t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];t[0]^=rcon;rcon=_xtime(rcon);}
    else if(Nk>6&&i%Nk===4){t=[_SBOX[t[0]],_SBOX[t[1]],_SBOX[t[2]],_SBOX[t[3]]];}
    w.push([w[i-Nk][0]^t[0],w[i-Nk][1]^t[1],w[i-Nk][2]^t[2],w[i-Nk][3]^t[3]]);
  }
  return {w:w,Nr:Nr};
}
function _invCipher(inb,ks){
  var w=ks.w,Nr=ks.Nr,s=[[],[],[],[]],r,c,i;
  for(i=0;i<16;i++)s[i%4][(i/4)|0]=inb[i];
  function ark(round){for(c=0;c<4;c++)for(r=0;r<4;r++)s[r][c]^=w[round*4+c][r];}
  function isub(){for(r=0;r<4;r++)for(c=0;c<4;c++)s[r][c]=_ISBOX[s[r][c]];}
  function ishift(){for(r=1;r<4;r++){var row=s[r].slice();for(c=0;c<4;c++)s[r][c]=row[(c-r+4)%4];}}
  function imix(){for(c=0;c<4;c++){var a0=s[0][c],a1=s[1][c],a2=s[2][c],a3=s[3][c];
    s[0][c]=_gmul(a0,14)^_gmul(a1,11)^_gmul(a2,13)^_gmul(a3,9);
    s[1][c]=_gmul(a0,9)^_gmul(a1,14)^_gmul(a2,11)^_gmul(a3,13);
    s[2][c]=_gmul(a0,13)^_gmul(a1,9)^_gmul(a2,14)^_gmul(a3,11);
    s[3][c]=_gmul(a0,11)^_gmul(a1,13)^_gmul(a2,9)^_gmul(a3,14);}}
  ark(Nr);
  for(var round=Nr-1;round>=1;round--){ishift();isub();ark(round);imix();}
  ishift();isub();ark(0);
  var out=[];for(i=0;i<16;i++)out[i]=s[i%4][(i/4)|0];return out;
}
function _aesCbcDecrypt(ct,key,iv){
  var ks=_keyExp(key),out=[],prev=iv.slice(),off,i;
  for(off=0;off+16<=ct.length;off+=16){
    var block=ct.slice(off,off+16),dec=_invCipher(block,ks);
    for(i=0;i<16;i++)out.push(dec[i]^prev[i]);
    prev=block;
  }
  var pad=out[out.length-1];
  if(pad>0&&pad<=16)out=out.slice(0,out.length-pad);
  return out;
}
function _bytesToStr(b){var s='',i=0;while(i<b.length){var c=b[i++];if(c<0x80)s+=String.fromCharCode(c);else if(c<0xE0)s+=String.fromCharCode(((c&0x1f)<<6)|(b[i++]&0x3f));else if(c<0xF0)s+=String.fromCharCode(((c&0x0f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f));else{var cp=((c&0x07)<<18)|((b[i++]&0x3f)<<12)|((b[i++]&0x3f)<<6)|(b[i++]&0x3f);cp-=0x10000;s+=String.fromCharCode(0xD800+(cp>>10),0xDC00+(cp&0x3FF));}}return s;}

if(typeof module!=="undefined"&&module.exports)module.exports={version:"1.1.0",getInfo:getInfo,getSettings:getSettings,getHome:getHome,search:search,getDetail:getDetail,getEpisodes:getEpisodes,getVideoSources:getVideoSources,getStreams:getVideoSources,getLinks:getVideoSources};
