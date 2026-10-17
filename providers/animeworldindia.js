// Anime World India provider for Zangetsu.
// Current public domain is watchanimeworld.one; playback resolves the site's Zephyrix player API.
var SOURCE_ID = (typeof __SOURCE_ID !== "undefined" && __SOURCE_ID) ? String(__SOURCE_ID) : "animeworldindia";
var SITE = "https://watchanimeworld.one";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getInfo() { return { name: "Anime World India", lang: "en", baseUrl: SITE, logo: "https://www.google.com/s2/favicons?sz=256&domain=watchanimeworld.one", type: "anime", version: "1.0.0" }; }
function getSettings() { return []; }
function _text(s) { return htmlText(String(s == null ? "" : s)).replace(/\s+/g, " ").trim(); }
function _attr(tag, name) {
  var match = String(tag || "").match(new RegExp("\\b" + name + "\\s*=\\s*([\\\"'])([\\s\\S]*?)\\1", "i"));
  return match ? match[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'") : "";
}
function _absolute(url, base) {
  if (!url) return null;
  url = String(url).replace(/&amp;/g, "&");
  if (url.indexOf("//") === 0) return "https:" + url;
  try { return new URL(url, base || SITE + "/").toString(); } catch (e) { return /^https?:\/\//i.test(url) ? url : null; }
}
function _fetch(url, options) {
  return fetch(url, options || {}).then(function (r) {
    if (!r || r.status >= 400) throw Error("Anime World India HTTP " + (r && r.status || "error") + " at " + url);
    return { status: r.status || 200, body: String(r.body == null ? "" : r.body), headers: r.headers || null };
  });
}
function _get(url, referer, extraHeaders) {
  var headers = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/json,*/*", "Referer": referer || SITE + "/" };
  Object.keys(extraHeaders || {}).forEach(function (k) { headers[k] = extraHeaders[k]; });
  return _fetch(url, { headers: headers }).then(function (r) { return r.body; });
}
function _cardBlocks(html) {
  var out = [], seen = {};
  var sources = [
    /<article\b[^>]*class=["'][^"']*\bpost\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi,
    /<li\b[^>]*class=["'][^"']*\bpost\b[^"']*["'][^>]*>[\s\S]*?<\/li>/gi
  ];
  sources.forEach(function (re) {
    var m;
    while ((m = re.exec(String(html || "")))) {
      var block = m[0];
      var href = "", links = /<a\b([^>]*)>/gi, a;
      while ((a = links.exec(block))) {
        var candidate = _attr(a[1], "href");
        if (/\/(?:series|movies)\//i.test(candidate)) { href = _absolute(candidate, SITE + "/"); break; }
      }
      if (!href || seen[href]) continue;
      var title = _text((block.match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i) || [])[1] || "");
      if (!title) title = _text(_attr((block.match(/<img\b[^>]*>/i) || [])[0], "alt"));
      if (!title) continue;
      var imageTag = (block.match(/<img\b[^>]*>/i) || [])[0] || "";
      var poster = _absolute(_attr(imageTag, "data-src") || _attr(imageTag, "src"), SITE + "/");
      seen[href] = 1;
      out.push({ id: href, title: title, url: href, cover: poster, type: href.indexOf("/movies/") >= 0 ? "movie" : "anime", sourceId: SOURCE_ID });
    }
  });
  return out;
}
function getHome(opts) {
  return _get(SITE + "/", SITE + "/").then(function (html) {
    var items = _cardBlocks(html).slice(0, 30);
    return items.length ? [{ title: "Latest Series", items: items }] : [];
  }).catch(function () { return []; });
}
function search(query, page, opts) {
  query = String(query || "").trim();
  if (!query) return Promise.resolve([]);
  var pages = [], p = Math.max(1, Number(page) || 1);
  for (var i = p; i < p + 3; i++) pages.push(i);
  return Promise.all(pages.map(function (n) {
    return _get(SITE + "/page/" + n + "/?s=" + encodeURIComponent(query), SITE + "/").then(_cardBlocks).catch(function () { return []; });
  })).then(function (groups) {
    var out = [], seen = {};
    groups.forEach(function (group) { group.forEach(function (item) { if (!seen[item.url]) { seen[item.url] = 1; out.push(item); } }); });
    return out;
  }).catch(function () { return []; });
}
function _episodeName(url) {
  var raw = String(url || "").split("/episode/")[1] || "";
  raw = raw.replace(/\/+$/, "");
  var match = raw.match(/(\d+)x(\d+)/), ep = match ? Number(match[2]) : null;
  raw = raw.replace(/\d+x\d+/g, "").replace(/^\-+|\-+$/g, "");
  var title = _text(raw.replace(/-/g, " "));
  return title || "Episode " + (ep || "");
}
function _seasonEpisodeLinks(postId, season) {
  if (!postId) return Promise.resolve([]);
  var url = SITE + "/wp-admin/admin-ajax.php?action=action_select_season&season=" + season + "&post=" + encodeURIComponent(postId);
  return _get(url, SITE + "/", { "X-Requested-With": "XMLHttpRequest" }).then(function (html) {
    var out = [], re = /<a\b([^>]*)>/gi, m;
    while ((m = re.exec(html))) {
      var href = _attr(m[1], "href");
      if (/\/episode\//i.test(href)) {
        var abs = _absolute(href, SITE + "/");
        if (abs && out.indexOf(abs) < 0) out.push(abs);
      }
    }
    return out;
  }).catch(function () { return []; });
}
function getDetail(url, opts) {
  url = _absolute(url, SITE + "/");
  if (!url || url.indexOf(SITE + "/") !== 0) return Promise.reject(Error("Anime World India invalid title URL"));
  return _get(url, SITE + "/").then(function (html) {
    var title = _text((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
    if (!title) throw Error("Anime World India title not found");
    var posterTag = (html.match(/<(?:div|figure)\b[^>]*(?:poster|post-thumbnail)[^>]*>[\s\S]{0,1200}?<img\b[^>]*>/i) || [])[0] || (html.match(/<img\b[^>]*>/i) || [])[0] || "";
    var poster = _absolute(_attr(posterTag, "data-src") || _attr(posterTag, "src"), url);
    var backdrop = _absolute(_attr((html.match(/<img\b[^>]*>/i) || [])[0], "src"), url);
    var plot = _text((html.match(/<(?:div|p)\b[^>]*class=["'][^"']*(?:description|synopsis|plot)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i) || [])[1] || "");
    var genres = [], genreRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, gm;
    while ((gm = genreRe.exec(html))) if (/genre/i.test(_attr(gm[1], "href"))) { var g = _text(gm[2]); if (g && genres.indexOf(g) < 0) genres.push(g); }
    var isMovie = /\/movies\//i.test(url);
    if (isMovie) return { id: url, title: title, url: url, cover: poster, backdrop: backdrop, description: plot, genres: genres, type: "movie", sourceId: SOURCE_ID, episodes: [{ id: url, url: url, number: 1, title: title }] };
    var postId = _attr((html.match(/<[^>]+\bdata-post=["'][^"']+["'][^>]*>/i) || [])[0], "data-post");
    var tabs = {}, tabRe = /<[^>]+\bdata-season=["'](\d+)["'][^>]*>([\s\S]*?)<\/[^>]+>/gi, tm;
    while ((tm = tabRe.exec(html))) tabs[Number(tm[1])] = _text(tm[2]) || "Season " + tm[1];
    var epLinks = [], epRe = /<a\b([^>]*)>/gi, em;
    while ((em = epRe.exec(html))) {
      var epHref = _attr(em[1], "href");
      if (/\/episode\//i.test(epHref)) { var epAbs = _absolute(epHref, url); if (epAbs && epLinks.indexOf(epAbs) < 0) epLinks.push(epAbs); }
    }
    var seasons = Object.keys(tabs).map(Number).sort(function (a, b) { return a - b; });
    var initialSeason = 1;
    if (epLinks.length) {
      var sm = epLinks[0].match(/(\d+)x\d+/);
      if (sm) initialSeason = Number(sm[1]);
    }
    if (!seasons.length) seasons = [initialSeason];
    var jobs = seasons.map(function (season) {
      if (season === initialSeason && epLinks.length) return Promise.resolve(epLinks);
      return _seasonEpisodeLinks(postId, season);
    });
    return Promise.all(jobs).then(function (groups) {
      var episodes = [], seen = {};
      groups.forEach(function (group, i) {
        var season = seasons[i] || 1;
        group.forEach(function (epUrl) {
          if (seen[epUrl]) return;
          seen[epUrl] = 1;
          var m = epUrl.match(/(\d+)x(\d+)/);
          episodes.push({ id: epUrl, url: epUrl, season: m ? Number(m[1]) : season, number: m ? Number(m[2]) : 1, title: _episodeName(epUrl) });
        });
      });
      episodes.sort(function (a, b) { return (a.season - b.season) || (a.number - b.number); });
      return { id: url, title: title, url: url, cover: poster, backdrop: backdrop || poster, description: plot, genres: genres, type: "anime", sourceId: SOURCE_ID, episodes: episodes };
    });
  });
}
function getEpisodes(url, opts) { return getDetail(url, opts).then(function (detail) { return detail.episodes || []; }); }
function _zephyrix(url, referer) {
  var idMatch = String(url).match(/\/video\/([a-f0-9]+)/i);
  var hostMatch = String(url).match(/^(https?:\/\/[^/]+)/i);
  if (!idMatch || !hostMatch) return Promise.resolve([]);
  var id = idMatch[1], player = hostMatch[1], postUrl = player + "/player/index.php?data=" + id + "&do=getVideo";
  var payload = "hash=" + encodeURIComponent(id) + "&r=" + encodeURIComponent(SITE + "/");
  return _fetch(postUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01",
      "Origin": player, "Referer": player + "/video/" + id
    },
    body: payload
  }).then(function (r) {
    var root;
    try { root = JSON.parse(r.body); } catch (e) { return []; }
    var stream = root.videoSource || root.securedLink;
    stream = _absolute(stream, player + "/");
    if (!stream) return [];
    return [{ url: stream, label: "Anime World India", quality: "Auto", container: /\.m3u8(?:[?#]|$)/i.test(stream) ? "hls" : (/\.mp4(?:[?#]|$)/i.test(stream) ? "mp4" : "auto"), headers: { "User-Agent": UA, "Accept": "*/*", "Referer": player + "/" }, kind: "sub", subtitles: [] }];
  }).catch(function () { return []; });
}
function getVideoSources(url, opts) {
  url = _absolute(url, SITE + "/");
  if (!url) return Promise.reject(Error("Anime World India invalid episode URL"));
  return _get(url, SITE + "/").then(function (html) {
    var frames = [], seen = {}, re = /<iframe\b([^>]*)>/gi, m;
    while ((m = re.exec(html)) && frames.length < 12) {
      var frame = _absolute(_attr(m[1], "data-src") || _attr(m[1], "src"), url);
      if (frame && !seen[frame]) { seen[frame] = 1; frames.push(frame); }
    }
    if (!frames.length) throw Error("Anime World India found no player iframe");
    return Promise.all(frames.map(function (frame) {
      if (/zephyrix|zephyrflick/i.test(frame)) return _zephyrix(frame, url);
      if (typeof extractVideo === "function") return Promise.resolve(extractVideo(frame, { headers: { "User-Agent": UA, "Referer": url }, kind: "sub", audioLang: "ja" })).catch(function () { return []; });
      return [];
    })).then(function (groups) {
      var out = [], urls = {};
      groups.forEach(function (items) { (items || []).forEach(function (item) { if (item && item.url && !urls[item.url]) { urls[item.url] = 1; out.push(item); } }); });
      if (!out.length) throw Error("Anime World India player did not return a native video URL");
      return out;
    });
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }
if (typeof module !== "undefined" && module.exports) {
  module.exports = { version: "1.0.0", getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks };
}