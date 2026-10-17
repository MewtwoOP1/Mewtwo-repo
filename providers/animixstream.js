// AnimixStream — lightweight Hindi multi-audio anime source for Zangetsu.
// Uses one catalogue request, a detail page, a watch page, and the player API.
// It avoids a WebView/Cloudflare challenge and returns the signed HLS master directly.
var SOURCE_ID = (typeof __SOURCE_ID !== "undefined" && __SOURCE_ID) ? String(__SOURCE_ID) : "animixstream";
var SITE = "https://www.animixstream.com";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
var DETAIL_TTL = 180000;
var detailCache = Object.create(null);

function getInfo() {
  return { name: "AnimixStream", lang: "hi", baseUrl: SITE,
    logo: SITE + "/favicon.ico", type: "anime", version: "1.0.0" };
}
function getSettings() { return []; }
function _trim(s) {
  var v = String(s == null ? "" : s);
  if (typeof htmlText === "function") v = htmlText(v);
  return v.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}
function _abs(url, base) {
  try { return new URL(String(url || "").replace(/\\\//g, "/"), base || SITE + "/").toString(); }
  catch (e) { return ""; }
}
function _get(url, ref) {
  return fetch(url, {
    headers: { "User-Agent": UA, "Referer": ref || SITE + "/", "Accept": "text/html,application/json,*/*" },
    timeoutMs: 10000
  }).then(function (r) {
    if (!r || r.status >= 400) throw Error("AnimixStream HTTP " + (r && r.status || "error"));
    return String(r.body || "");
  });
}
function _cards(html) {
  var out = [], seen = Object.create(null), m;
  var re = /<a\b([^>]*\bclass=['"][^'"]*anime-card[^'"]*['"][^>]*)>([\s\S]*?)<\/a\s*>/gi;
  while ((m = re.exec(String(html || ""))) !== null && out.length < 50) {
    var href = (m[1].match(/\bhref=['"](\/anime\.php\?id=\d+)['"]/i) || [])[1];
    if (!href) continue;
    var url = _abs(href);
    if (!url || seen[url]) continue;
    var block = m[2];
    var title = _trim((block.match(/card-title[^>]*>([^<]+)/i) || [])[1] ||
      (block.match(/<img\b[^>]+alt=['"]([^'"]*)['"]/i) || [])[1] || "");
    if (!title || !/[A-Za-z\u00C0-\u024F\u3040-\u30ff\u3400-\u9fff]/.test(title)) continue;
    var img = (block.match(/<img\b[^>]*>/i) || [])[0] || "";
    var cover = (img.match(/\bsrc=['"]([^'"]+)['"]/i) || img.match(/\bdata-src=['"]([^'"]+)['"]/i) || [])[1] || "";
    seen[url] = true;
    out.push({ id: url, title: title, englishTitle: title, cover: cover ? _abs(cover) : null,
      url: url, type: "anime", sourceId: SOURCE_ID, subCount: 0, dubCount: null });
  }
  return out;
}
function search(query, page, opts) {
  var q = String(query || "").trim();
  if (!q) return Promise.resolve([]);
  return _get(SITE + "/search.php?q=" + encodeURIComponent(q), SITE + "/")
    .then(function (html) { return _cards(html); })
    .catch(function () { return []; });
}
function getHome(opts) {
  return _get(SITE + "/", SITE + "/").then(function (html) {
    var rows = [], parts = String(html || "").split(/<section\b/i);
    for (var i = 1; i < parts.length; i++) {
      var chunk = parts[i];
      var heading = _trim((chunk.match(/<h2\b[^>]*>([^<]+)<\/h2>/i) || [])[1] || "");
      if (!heading || /about|genre/i.test(heading)) continue;
      var items = _cards(chunk);
      if (items.length) rows.push({ title: heading, items: items });
    }
    if (!rows.length) {
      var all = _cards(html);
      if (all.length) rows.push({ title: "Latest", items: all });
    }
    return rows;
  }).catch(function () { return []; });
}
function _fetchDetail(url) {
  var pageUrl = _abs(url);
  if (!pageUrl || pageUrl.indexOf(SITE) !== 0) return Promise.resolve(null);
  return _get(pageUrl, SITE + "/").then(function (html) {
    var title = _trim((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] ||
      (html.match(/og:title["']?\s+content=["']([^"']+)["']/i) || [])[1] || "Untitled");
    var cover = (html.match(/og:image["']?\s+content=["']([^"']+)["']/i) || [])[1] || null;
    var desc = _trim((html.match(/og:description["']?\s+content=["']([^"']+)["']/i) || [])[1] || "");
    var episodes = [], seen = Object.create(null), m;
    var re = /"position"\s*:\s*(\d+)\s*,\s*"url"\s*:\s*"([^"]*\/watch\.php\?id=\d+)"\s*,\s*"name"\s*:\s*"([^"]*)"/gi;
    while ((m = re.exec(html)) !== null && episodes.length < 500) {
      var watchUrl = _abs(m[2].replace(/\\\//g, "/"), pageUrl);
      if (!watchUrl || seen[watchUrl]) continue;
      var n = parseInt(m[1], 10) || episodes.length + 1;
      var epName = _trim(m[3]).replace(/^Episode\s*\d+\s*[—-]\s*/i, "");
      seen[watchUrl] = true;
      episodes.push({ id: "ep:" + n, number: n,
        title: epName && !/^episode\s*\d+$/i.test(epName) ? "E" + n + " · " + epName : "Episode " + n,
        url: "animixstream://" + encodeURIComponent(watchUrl) });
    }
    if (!episodes.length) {
      var wre = /href=['"]([^'"]*\/watch\.php\?id=\d+)['"]/gi, wm;
      while ((wm = wre.exec(html)) !== null && episodes.length < 500) {
        var w2 = _abs(wm[1], pageUrl);
        if (!w2 || seen[w2]) continue;
        seen[w2] = true;
        var k = episodes.length + 1;
        episodes.push({ id: "ep:" + k, number: k, title: "Episode " + k,
          url: "animixstream://" + encodeURIComponent(w2) });
      }
    }
    episodes.sort(function (a, b) { return a.number - b.number; });
    return { id: pageUrl, title: title, englishTitle: title, cover: cover ? _abs(cover, pageUrl) : null,
      url: pageUrl, description: desc, status: "unknown", genres: [], studios: [],
      type: "anime", sourceId: SOURCE_ID, episodes: episodes,
      subCount: 0, dubCount: episodes.length };
  }).catch(function () { return null; });
}
function getDetail(url, opts) {
  var u = _abs(url), now = Date.now(), hit = detailCache[u];
  if (hit && now - hit.at < DETAIL_TTL) return Promise.resolve(hit.value);
  return _fetchDetail(url).then(function (d) {
    if (d && d.episodes && d.episodes.length) detailCache[u] = { at: Date.now(), value: d };
    return d;
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (d) { return d && d.episodes || []; });
}
function getVideoSources(episodeUrl, opts) {
  var watchUrl = "";
  try { watchUrl = decodeURIComponent(String(episodeUrl || "").replace(/^animixstream:\/\//, "")); }
  catch (e) { return Promise.resolve([]); }
  if (!/^https?:\/\//i.test(watchUrl)) return Promise.resolve([]);
  return _get(watchUrl, SITE + "/").then(function (html) {
    var embedMatch = String(html || "").match(/https?:\/\/(?:play\.)?[a-z0-9.-]*(?:zephyrflick|as-cdn)\d*\.top\/video\/[a-f0-9]+/i) ||
      String(html || "").match(/(?:data-src|src)=['"](https?:\/\/[a-z0-9.-]+\/video\/[a-f0-9]+)['"]/i);
    var embedUrl = embedMatch && (embedMatch[1] || embedMatch[0]);
    if (!embedUrl) throw Error("AnimixStream: no player API link on watch page");
    var host = (embedUrl.match(/^(https?:\/\/[^/]+)/) || [])[1];
    var hash = (embedUrl.match(/\/video\/([a-f0-9]+)/i) || [])[1];
    if (!host || !hash) throw Error("AnimixStream: invalid player link");
    return fetch(host + "/player/index.php?data=" + encodeURIComponent(hash) + "&do=getVideo", {
      method: "POST",
      headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Referer": embedUrl, "Accept": "application/json,*/*" },
      timeoutMs: 10000
    }).then(function (response) {
      if (!response || response.status >= 400) throw Error("AnimixStream player API HTTP error");
      var json;
      try { json = JSON.parse(response.body || "null"); } catch (e) { json = null; }
      var master = json && (json.videoSource || json.securedLink);
      if (!master || !/^https?:\/\//i.test(master)) throw Error("AnimixStream: player API returned no stream");
      return [{
        url: master,
        quality: "auto",
        container: /\.m3u8(?:[?#]|$)/i.test(master) ? "hls" : "mp4",
        headers: { "User-Agent": UA, "Referer": host + "/" },
        kind: "dub", audioLang: "hi", subtitles: [], label: "AnimixStream · Multi-audio"
      }];
    });
  }).catch(function () { return []; });
}
function getStreams(url, opts) { return getVideoSources(url, opts); }
function getLinks(url, opts) { return getVideoSources(url, opts); }
if (typeof module !== "undefined" && module.exports) module.exports = {
  version: "1.0.0", getInfo: getInfo, getSettings: getSettings,
  getHome: getHome, search: search, getDetail: getDetail,
  getEpisodes: getEpisodes, getVideoSources: getVideoSources,
  getStreams: getStreams, getLinks: getLinks
};
