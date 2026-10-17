// AniWaves anime source for Zangetsu.
// Uses the site's HTML catalogue and two AJAX routes; no external tracker lookups,
// serial thumbnail fetches, WebView session, or custom decryption/proxy layer.
var SOURCE_ID = (typeof __SOURCE_ID !== "undefined" && __SOURCE_ID) ? String(__SOURCE_ID) : "aniwaves";
var SITE = "https://aniwaves.ru";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
var DETAIL_TTL = 180000;
var detailCache = Object.create(null);

function getInfo() {
  return { name: "AniWaves", lang: "en", baseUrl: SITE,
    logo: "https://www.google.com/s2/favicons?sz=256&domain=aniwaves.ru",
    type: "anime", version: "1.0.0" };
}
function getSettings() { return []; }
function _decode(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function _text(s) {
  var clean = String(s || "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, " ");
  if (typeof htmlText === "function") clean = htmlText(clean);
  else clean = _decode(clean);
  return String(clean || "").replace(/\s+/g, " ").trim();
}
function _attr(tag, name) {
  var re = new RegExp("\\b" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i");
  var m = String(tag || "").match(re);
  return m ? _decode(m[2]) : "";
}
function _absolute(url, base) {
  var u = String(url || "").trim();
  if (!u || u === "#") return "";
  try { return new URL(u.replace(/&amp;/g, "&"), base || SITE + "/").toString(); }
  catch (e) { return ""; }
}
function _get(url, ref, xhr) {
  var headers = {
    "User-Agent": UA,
    "Accept": "text/html,application/json,*/*",
    "Referer": ref || SITE + "/"
  };
  if (xhr) headers["X-Requested-With"] = "XMLHttpRequest";
  return fetch(String(url), { headers: headers, timeoutMs: 10000 }).then(function (r) {
    if (!r || r.status >= 400) throw Error("AniWaves HTTP " + (r && r.status || "error"));
    var body = r.body == null ? "" : String(r.body);
    if (!body) throw Error("AniWaves empty response");
    return body;
  });
}
function _json(s) { try { return JSON.parse(s || "null"); } catch (e) { return null; } }
function _ajax(path, ref) {
  return _get(SITE + path, ref || SITE + "/", true).then(function (body) {
    var payload = _json(body);
    if (!payload || (payload.status != null && String(payload.status) !== "200")) return null;
    return payload;
  });
}
function _classMatch(attrs, token) {
  var classes = _attr(attrs, "class").split(/\s+/);
  return classes.indexOf(token) >= 0;
}
function _cardStarts(html) {
  var starts = [], re = /<div\b([^>]*)>/gi, m;
  while ((m = re.exec(String(html || ""))) !== null) {
    if (_classMatch(m[1], "item")) starts.push({ at: m.index, end: re.lastIndex, attrs: m[1] });
  }
  return starts;
}
function _classContent(html, token) {
  var source = String(html || ""), re = /<(h1|h2|h3|h4|span|div|p)\\b([^>]*)>/gi, m;
  while ((m = re.exec(source)) !== null) {
    if (!_classMatch(m[2], token)) continue;
    var close = new RegExp("<\\\\/" + m[1] + "\\\\s*>", "ig");
    close.lastIndex = re.lastIndex;
    var end = close.exec(source);
    if (!end) continue;
    var inner = source.substring(re.lastIndex, end.index);
    return { attrs: m[2], inner: inner, text: _text(inner) };
  }
  return null;
}
function _titleValid(value) {
  var t = _text(value);
  if (t.length < 2 || t.length > 240) return "";
  if (!/[A-Za-z\u00C0-\u024F\u3040-\u30ff\u3400-\u9fff]/.test(t)) return "";
  if (/^(?:\d+|episode\s*\d+|\d+\s*(?:tv|hd|sd))$/i.test(t)) return "";
  return t;
}
function _parseCards(html) {
  var source = String(html || "");
  var starts = _cardStarts(source), out = [], seen = Object.create(null);
  for (var i = 0; i < starts.length && out.length < 50; i++) {
    var start = starts[i], end = (i + 1 < starts.length) ? starts[i + 1].at : Math.min(source.length, start.end + 6000);
    var chunk = source.substring(start.at, Math.max(start.end, end));
    var posterStart = chunk.search(/class=["'][^"']*\bposter\b[^"']*["']/i);
    if (posterStart > 0) chunk = chunk.substring(Math.max(0, posterStart - 80));
    var anchor = (chunk.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>/i) || [])[0] || "";
    var href = _attr(anchor, "href");
    if (!href) continue;
    var resolved = _absolute(href, SITE + "/");
    if (!resolved || !/^https?:\/\//i.test(resolved)) continue;
    var path = resolved.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
    var id = path.replace(/\/+$/, "").split("/").pop() || "";
    if (!id || seen[resolved]) continue;
    var nameBlock = _classContent(chunk, "name") || _classContent(chunk, "title");
    var img = (chunk.match(/<img\b[^>]*>/i) || [])[0] || "";
    var title = _titleValid(nameBlock && nameBlock.text) ||
      _titleValid(_attr(img, "alt")) || _titleValid(_attr(anchor, "title")) ||
      _titleValid(_attr(anchor, "data-jp"));
    if (!title) continue;
    seen[resolved] = true;
    var poster = _attr(img, "data-src") || _attr(img, "data-lazy-src") || _attr(img, "src");
    var typeBlock = _classContent(chunk, "right");
    var typeText = (typeBlock && typeBlock.text || "").toLowerCase();
    var type = typeText === "movie" ? "anime-movie" : (/\b(?:ova|ona|special)\b/.test(typeText) ? "ova" : "anime");
    var sub = _classContent(chunk, "sub"), dub = _classContent(chunk, "dub");
    var subCount = parseInt(sub && sub.text || "", 10) || 0;
    var dubCount = parseInt(dub && dub.text || "", 10) || 0;
    out.push({ id: id, title: title, englishTitle: title, url: resolved,
      cover: poster ? _absolute(poster, resolved) : null,
      type: type, sourceId: SOURCE_ID, subCount: subCount, dubCount: dubCount });
  }
  return out;
}
function search(query, page, opts) {
  var q = String(query || "").trim();
  if (!q) return Promise.resolve([]);
  var url = SITE + "/filter?keyword=" + encodeURIComponent(q);
  var p = parseInt(page, 10);
  if (p > 1) url += "&page=" + p;
  return _get(url, SITE + "/", false).then(function (html) {
    var at = html.indexOf('class="ani items');
    return _parseCards(at >= 0 ? html.substring(at) : html);
  }).catch(function () { return []; });
}
function getHome(opts) {
  return _get(SITE + "/home", SITE + "/", false).then(function (html) {
    var cards = _parseCards(html);
    return cards.length ? [{ title: "Recently Updated", items: cards.slice(0, 30) }] : [];
  }).catch(function () { return []; });
}
function _episodeNumber(attrs, inner, fallback) {
  var n = parseInt(_attr(attrs, "data-num"), 10);
  if (!(n > 0)) n = parseInt(_text(inner), 10);
  return n > 0 ? n : fallback;
}
function _getMode(opts) {
  return opts && String(opts.category || "").toLowerCase() === "dub" ? "dub" : "sub";
}
function _slugOf(url) {
  var s = String(url || "").trim();
  if (/^https?:\/\//i.test(s)) return _absolute(s, SITE + "/");
  if (s.indexOf("aniwaves://") === 0) return s;
  return _absolute(s.replace(/^\/+/, ""), SITE + "/");
}
function _fetchDetail(url, mode) {
  var pageUrl = _slugOf(url);
  if (!pageUrl || pageUrl.indexOf(SITE) !== 0) return Promise.resolve({
    id: String(url || ""), url: String(url || ""), title: String(url || ""),
    type: "anime", sourceId: SOURCE_ID, episodes: []
  });
  return _get(pageUrl, SITE + "/", false).then(function (html) {
    var titleTag = (html.match(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/i) || []);
    var title = _titleValid(titleTag[2]) || _titleValid(_attr(titleTag[1], "data-jp")) ||
      _titleValid(_attr(titleTag[1], "title")) || pageUrl.split("/").filter(Boolean).pop();
    var poster = (html.match(/<div\b[^>]*class=["'][^"']*\bposter\b[^"']*["'][^>]*>[\s\S]{0,1200}?<img\b[^>]*>/i) || [])[0] || "";
    var img = (poster.match(/<img\b[^>]*>/i) || [])[0] || "";
    var og = (html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i) || [])[0] || "";
    var desc = _classContent(html, "shorting") || _classContent(html, "synopsis");
    var idMatch = html.match(/id=["']watch-main["'][^>]*data-id=["'](\d+)["']/i) ||
      html.match(/data-id=["'](\d+)["'][^>]*id=["']watch-main["']/i);
    var animeId = idMatch && idMatch[1];
    if (!animeId) {
      var tail = pageUrl.replace(/[?#].*$/, "").split("/").pop() || "";
      animeId = (tail.match(/-(\d+)$/) || [])[1] || "";
    }
    var detail = {
      id: pageUrl, url: pageUrl, title: title, englishTitle: title,
      cover: _attr(img, "data-src") || _attr(img, "src") || _attr(og, "content") || null,
      description: desc && desc.text || "",
      year: ((html.match(/Premiered[\s\S]{0,300}?(19|20)\d{2}/i) || [])[0] || "").match(/(19|20)\d{2}/)?.[0] || null,
      type: "anime", sourceId: SOURCE_ID, episodes: []
    };
    if (!animeId) return detail;
    return _ajax("/ajax/episode/list/" + animeId, pageUrl).then(function (payload) {
      var rows = payload && (payload.result || payload.html);
      if (typeof rows !== "string") return detail;
      var out = [], seen = Object.create(null), re = /<a\b([^>]*\bdata-ids=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a\s*>/gi, m;
      while ((m = re.exec(rows)) !== null && out.length < 200) {
        var attrs = m[1], ids = _attr(attrs, "data-ids");
        if (!ids) continue;
        var hasSub = _attr(attrs, "data-sub") === "1";
        var hasDub = _attr(attrs, "data-dub") === "1";
        if (!hasSub && !hasDub) continue;
        var num = _episodeNumber(attrs, m[2], out.length + 1);
        var name = _text(_attr(attrs, "title")) || _text(m[2]) || "Episode " + num;
        var audioModes = mode === "dub" ? (hasDub ? ["dub"] : []) : (hasSub ? ["sub"] : []);
        for (var k = 0; k < audioModes.length; k++) {
          var cat = audioModes[k], epUrl = "aniwaves://" + cat + "/" + animeId + "/" + num +
            "/" + encodeURIComponent(ids) + "/" + encodeURIComponent(pageUrl);
          var key = cat + ":" + num;
          if (seen[key]) continue;
          seen[key] = true;
          out.push({ id: key, number: num, title: name, url: epUrl });
        }
      }
      out.sort(function (a, b) { return a.number - b.number; });
      detail.episodes = out;
      return detail;
    }).catch(function () { return detail; });
  }).catch(function () {
    return { id: pageUrl, url: pageUrl, title: pageUrl, type: "anime", sourceId: SOURCE_ID, episodes: [] };
  });
}
function getDetail(url, opts) {
  var mode = _getMode(opts), key = _slugOf(url) + "|" + mode, now = Date.now();
  var cached = detailCache[key];
  if (cached && now - cached.at < DETAIL_TTL) return Promise.resolve(cached.value);
  return _fetchDetail(url, mode).then(function (detail) {
    if (detail && detail.episodes && detail.episodes.length) detailCache[key] = { at: Date.now(), value: detail };
    return detail;
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) { return detail && detail.episodes || []; });
}
function _serverSections(html) {
  var source = String(html || ""), starts = [], re = /<div\b([^>]*)>/gi, m;
  while ((m = re.exec(source)) !== null) {
    if (_classMatch(m[1], "type")) starts.push({ at: m.index, end: re.lastIndex, attrs: m[1] });
  }
  var out = [];
  for (var i = 0; i < starts.length; i++) {
    var start = starts[i], end = i + 1 < starts.length ? starts[i + 1].at : source.length;
    out.push({ type: _attr(start.attrs, "data-type").toLowerCase(),
      html: source.substring(start.end, end) });
  }
  return out;
}
function _serverRank(server) {
  var n = String(server.name || "").toLowerCase();
  if (n.indexOf("vidplay") >= 0) return 0;
  if (n.indexOf("byfms") >= 0) return 1;
  if (n.indexOf("dghg") >= 0) return 2;
  if (n.indexOf("mycloud") >= 0) return 3;
  if (n.indexOf("datsav") >= 0) return 4;
  return 8;
}
function _parseServers(html, mode) {
  var wanted = mode === "dub" ? ["dub"] : ["sub", "ssub"], sections = _serverSections(html);
  var out = [], seen = Object.create(null);
  for (var i = 0; i < sections.length; i++) {
    var section = sections[i];
    if (wanted.indexOf(section.type) < 0) continue;
    var re = /<li\b([^>]*)>([\s\S]*?)<\/li\s*>/gi, m;
    while ((m = re.exec(section.html)) !== null) {
      var linkId = _attr(m[1], "data-link-id");
      if (!linkId || seen[linkId]) continue;
      seen[linkId] = true;
      out.push({ id: linkId, serverId: _attr(m[1], "data-sv-id"),
        name: _text(m[2]) || ("Server " + _attr(m[1], "data-sv-id")), type: section.type });
    }
  }
  var labels = { "4": "Vidplay", "1": "BYFMS", "2": "DGHG", "12": "MyCloud", "14": "DatSaV" };
  out.forEach(function (s) { if (labels[s.serverId]) s.name = labels[s.serverId]; });
  out.sort(function (a, b) { return _serverRank(a) - _serverRank(b); });
  return out.slice(0, 3);
}
function _directStream(url, cat, referer) {
  return { url: url, quality: "auto", container: /\.m3u8(?:[?#]|$)/i.test(url) ? "hls" : "mp4",
    headers: { "User-Agent": UA, "Referer": referer || SITE + "/" },
    kind: cat, audioLang: cat === "dub" ? "en" : "ja", subtitles: [] };
}
function getVideoSources(episodeUrl, opts) {
  var raw = String(episodeUrl || "").replace(/^aniwaves:\/\//i, "");
  var parts = raw.split("/");
  var mode = parts[0] === "dub" ? "dub" : "sub";
  var animeId = parts[1] || "", epNum = parts[2] || "";
  if (!/^\d+$/.test(animeId) || !/^\d+$/.test(epNum)) return Promise.resolve([]);
  var serverIds = "", watchUrl = SITE + "/";
  try { serverIds = decodeURIComponent(parts[3] || ""); } catch (e) { serverIds = parts[3] || ""; }
  try { watchUrl = decodeURIComponent(parts[4] || "") || watchUrl; } catch (e) {}
  if (!serverIds) return Promise.resolve([]);
  var q = "/ajax/server/list?servers=" + serverIds;
  return _ajax(q, watchUrl).then(function (payload) {
    var html = payload && (payload.result || payload.html);
    if (typeof html !== "string") return [];
    var servers = _parseServers(html, mode);
    if (!servers.length) return [];
    return Promise.all(servers.map(function (server) {
      return _ajax("/ajax/sources?id=" + encodeURIComponent(server.id) + "&asi=0&autoPlay=0", watchUrl)
        .then(function (sourcePayload) {
          var result = sourcePayload && sourcePayload.result;
          var embed = result && typeof result === "object" ? result.url : null;
          if (!embed && result && typeof result === "string") {
            var j = _json(result); embed = j && j.url;
          }
          embed = _absolute(embed, SITE + "/");
          if (!embed) return [];
          if (/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(embed)) return [_directStream(embed, mode, watchUrl)];
          if (typeof extractVideo !== "function") return [];
          return Promise.resolve(extractVideo(embed, {
            headers: { "User-Agent": UA, "Referer": watchUrl },
            kind: mode, audioLang: mode === "dub" ? "en" : "ja"
          })).then(function (streams) {
            return Array.isArray(streams) ? streams : [];
          }).catch(function () { return []; });
        }).catch(function () { return []; });
    })).then(function (groups) {
      var all = [], seen = Object.create(null);
      groups.forEach(function (group) {
        (Array.isArray(group) ? group : []).forEach(function (stream) {
          if (!stream || !stream.url || seen[stream.url]) return;
          seen[stream.url] = true; all.push(stream);
        });
      });
      return all;
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
