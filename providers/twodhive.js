// TwoDHive anime source for Zangetsu.
// Supports the site's catalogue and its native MegaPlay source endpoint.
var SOURCE_ID = (typeof __SOURCE_ID !== "undefined" && __SOURCE_ID) ? String(__SOURCE_ID) : "twodhive";
var SITE = "https://2dhive.com";
var MEGA = "https://megaplay.buzz";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
var AES_KEY = "i?LMTAx0Q6,:}50U";
var AES_IV = "W0;27ToaUpl_P%'c";
var CDN_TOKEN_KEY = "MpCdnT0k3n!9f2K#xQ7vL5mR8wN1pY4s";

function getInfo() { return { name: "TwoDHive", lang: "en", baseUrl: SITE, logo: "https://www.google.com/s2/favicons?sz=256&domain=2dhive.com", type: "anime", version: "1.0.0" }; }
function getSettings() { return []; }
function _txt(s) { return htmlText(String(s == null ? "" : s)).replace(/\s+/g, " ").trim(); }
function _attr(tag, name) {
  var match = String(tag || "").match(new RegExp("\\b" + name + "\\s*=\\s*([\\\"'])([\\s\\S]*?)\\1", "i"));
  return match ? match[2].replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&") : "";
}
function _get(url, referer) {
  return fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html,application/json,*/*", "Referer": referer || SITE + "/" } })
    .then(function (r) {
      if (!r || r.status >= 400) throw Error("TwoDHive HTTP " + (r && r.status || "error") + " at " + url);
      return String(r.body == null ? "" : r.body);
    });
}
function _json(url, referer) {
  return _get(url, referer).then(function (body) { try { return JSON.parse(body); } catch (e) { throw Error("TwoDHive returned invalid JSON"); } });
}
function _abs(url, base) {
  if (!url) return null;
  url = String(url).replace(/&amp;/g, "&");
  try { return new URL(url, base || SITE + "/").toString(); } catch (e) { return /^https?:\/\//i.test(url) ? url : null; }
}
function _parseCards(html) {
  var out = [], seen = {}, re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(String(html || ""))) && out.length < 60) {
    var href = _attr(m[1], "href").replace(/&amp;/g, "&");
    var match = href.match(/(?:^|\/)anime\?anime=(\d+)/i);
    if (!match) continue;
    var block = m[2], title = _txt((_txt((block.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i) || [])[1] || "").replace(/<span\b[^>]*>/gi, " ")));
    if (!title) title = _txt(_attr(m[1], "title") || _attr((block.match(/<img\b[^>]*>/i) || [])[0], "alt"));
    if (!title || seen[match[1]]) continue;
    seen[match[1]] = 1;
    var img = (block.match(/<img\b[^>]*>/i) || [])[0] || "";
    var poster = _attr(img, "src") || _attr(img, "data-src") || null;
    out.push({ id: match[1], title: title, url: SITE + "/anime?anime=" + match[1], cover: poster, type: "anime", sourceId: SOURCE_ID });
  }
  return out;
}
function getHome(opts) {
  return _get(SITE + "/", SITE + "/").then(function (html) {
    var items = _parseCards(html);
    return items.length ? [{ title: "Trending and Recent Anime", items: items }] : [];
  }).catch(function () { return []; });
}
function search(query, page, opts) {
  query = String(query || "").trim();
  if (!query) return Promise.resolve([]);
  return _get(SITE + "/?q=" + encodeURIComponent(query), SITE + "/").then(_parseCards).catch(function () { return []; });
}
function _decodeAstro(node) {
  if (Array.isArray(node) && node.length === 2 && typeof node[0] === "number") return _decodeAstro(node[1]);
  if (Array.isArray(node)) return node.map(_decodeAstro);
  if (node && typeof node === "object") {
    var out = {};
    Object.keys(node).forEach(function (key) { out[key] = _decodeAstro(node[key]); });
    return out;
  }
  return node;
}
function _episodeIsland(html, name) {
  var re = /<astro-island\b([^>]*)>/gi, m;
  while ((m = re.exec(String(html || "")))) {
    var component = _attr(m[1], "component-url");
    if (component.toLowerCase().indexOf(name.toLowerCase()) < 0) continue;
    var raw = _attr(m[1], "props");
    if (!raw) continue;
    try { return _decodeAstro(JSON.parse(raw)); } catch (e) {}
  }
  return null;
}
function _episodeNumbers(html, animeId) {
  var seen = {}, out = [], re = /href\s*=\s*["']([^"']*\/?episode\?[^"']+)["']/gi, m;
  while ((m = re.exec(String(html || "")))) {
    var href = m[1].replace(/&amp;/g, "&");
    var idMatch = href.match(/[?&]anime=(\d+)/), epMatch = href.match(/[?&]ep_num=(\d+)/);
    if (!epMatch || (idMatch && String(idMatch[1]) !== String(animeId))) continue;
    var n = Number(epMatch[1]);
    if (n > 0 && !seen[n]) { seen[n] = 1; out.push(n); }
  }
  return out.sort(function (a, b) { return a - b; });
}
function _episodeData(id, n, mode) { return "twodhive://" + String(id) + "/" + String(n) + "/" + (mode || "sub"); }
function _probeDub(id) {
  return _get(MEGA + "/stream/mal/" + id + "/1/dub", SITE + "/").then(function (html) {
    return /(?:data-id|data-realid)=["']\d+["']/.test(html);
  }).catch(function () { return false; });
}
function _detailId(url) {
  var s = String(url || "");
  var match = s.match(/[?&]anime=(\d+)/) || s.match(/^twodhive:\/\/(\d+)/) || s.match(/(\d{2,})/);
  return match ? match[1] : "";
}
function getDetail(url, opts) {
  var id = _detailId(url);
  if (!id) return Promise.reject(Error("TwoDHive invalid anime URL"));
  var detailUrl = SITE + "/anime?anime=" + id;
  return _get(detailUrl, SITE + "/").then(function (html) {
    var title = _txt((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "") ||
      _txt((html.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)/i) || [])[1] || "") || "Anime " + id;
    var poster = _attr((html.match(/<meta\b[^>]*property=["']og:image["'][^>]*>/i) || [])[0], "content") ||
      _attr((html.match(/<img\b[^>]*src=["'][^"']*anilist[^>]*>/i) || [])[0], "src") || null;
    var synopsis = "";
    var syn = /<p\b[^>]*>\s*Synopsis\s*<\/p>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(html);
    if (syn) synopsis = _txt(syn[1]);
    var props = _episodeIsland(html, "EpisodeBrowser") || {};
    var meta = Array.isArray(props.episodeMeta) ? props.episodeMeta : [];
    var numbers = _episodeNumbers(html, id);
    var total = Math.min(500, Math.max(Number(props.totalEpisodes) || 0, numbers.length ? numbers[numbers.length - 1] : 0));
    if (!total) total = Math.min(500, meta.reduce(function (max, ep) { return Math.max(max, Number(ep && ep.number) || 0); }, 0));
    var dubPromise = _probeDub(id);
    return dubPromise.then(function (hasDub) {
      var eps = [];
      for (var n = 1; n <= total; n++) {
        var em = meta.filter(function (x) { return Number(x && x.number) === n; })[0] || {};
        var titleText = _txt(em.title || "") || ("Episode " + n);
        eps.push({ id: _episodeData(id, n, "sub"), url: _episodeData(id, n, "sub"), number: n, title: titleText, cover: em.thumbnail || null, audio: "sub" });
        if (hasDub) eps.push({ id: _episodeData(id, n, "dub"), url: _episodeData(id, n, "dub"), number: n, title: titleText + " (Dub)", cover: em.thumbnail || null, audio: "dub" });
      }
      return {
        id: id, title: title, url: detailUrl, cover: poster, description: synopsis,
        year: (html.match(/\b(19\d{2}|20\d{2})\b/) || [])[1] || null,
        type: "anime", sourceId: SOURCE_ID, episodes: eps
      };
    });
  });
}
function getEpisodes(url, opts) { return getDetail(url, opts).then(function (detail) { return detail.episodes || []; }); }
function _parseEpisodeUrl(url, opts) {
  var match = String(url || "").replace(/^twodhive:\/\//, "").match(/^(\d+)\/(\d+)\/(sub|dub)$/i);
  if (match) return { id: Number(match[1]), episode: Number(match[2]), mode: match[3].toLowerCase() };
  var id = _detailId(url), n = Number((String(url || "").match(/[?&]ep_num=(\d+)/) || [])[1]);
  return id && n > 0 ? { id: Number(id), episode: n, mode: String(opts && opts.category || "sub").toLowerCase() === "dub" ? "dub" : "sub" } : null;
}
function _b64bytes(value) {
  var input = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", out = [], buf = 0, bits = 0;
  for (var i = 0; i < input.length; i++) {
    var ch = input.charAt(i);
    if (ch === "=") break;
    var pos = chars.indexOf(ch);
    if (pos < 0) continue;
    buf = (buf << 6) | pos; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); buf &= (1 << bits) - 1; }
  }
  return out;
}
function _b64url(bytes) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    var n = (a << 16) | (b << 8) | c;
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += chars[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += chars[n & 63];
  }
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}
function _utf8(text) { return Array.from(new TextEncoder().encode(String(text))); }
function _streamFile(root) {
  var sources = root && root.sources;
  var plain = sources && (Array.isArray(sources) ? sources[0] && sources[0].file : sources.file);
  if (plain) return Promise.resolve(plain);
  if (!root || !root.enc) return Promise.resolve(null);
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return Promise.resolve(null);
    var cipherBytes = new Uint8Array(_b64bytes(root.enc));
    var keyBytes = new Uint8Array(32), ivBytes = new Uint8Array(16);
    for (var i = 0; i < AES_KEY.length && i < keyBytes.length; i++) keyBytes[i] = AES_KEY.charCodeAt(i);
    for (var j = 0; j < AES_IV.length && j < ivBytes.length; j++) ivBytes[j] = AES_IV.charCodeAt(j);
    return crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["decrypt"]).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBytes }, key, cipherBytes);
    }).then(function (plainBuffer) {
      var parsed = JSON.parse(new TextDecoder().decode(plainBuffer));
      if (parsed.file) return parsed.file;
      var nested = parsed.sources;
      return nested && (Array.isArray(nested) ? nested[0] && nested[0].file : nested.file) || null;
    }).catch(function () { return null; });
  } catch (e) { return Promise.resolve(null); }
}
function _migrateCdn(url) {
  return String(url || "").replace("https://cdn.imgnex.top/anime", "https://megap.norami.top/anime");
}
function _signCdn(url) {
  var ids = String(url || "").match(/\/([a-f0-9]{32})\/([a-f0-9]{32})\//i);
  if (!ids || typeof crypto === "undefined" || !crypto.subtle) return Promise.resolve(url);
  var expires = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  var payload = String(expires) + "|" + ids[1].toLowerCase() + "/" + ids[2].toLowerCase();
  var keyBytes = new TextEncoder().encode(CDN_TOKEN_KEY);
  var payloadBytes = new TextEncoder().encode(payload);
  return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then(function (key) {
    return crypto.subtle.sign("HMAC", key, payloadBytes);
  }).then(function (sig) {
    var token = _b64url(_utf8(payload)) + "." + _b64url(Array.from(new Uint8Array(sig)));
    return url + (String(url).indexOf("?") >= 0 ? "&" : "?") + "token=" + token;
  }).catch(function () { return url; });
}
function _variants(masterUrl, text) {
  var lines = String(text || "").split(/\r?\n/), base = String(masterUrl).split("?")[0].replace(/\/[^/]*$/, "/"), out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
    var res = line.match(/RESOLUTION=(\d+)x(\d+)/i), quality = res ? Number(res[2]) : null, j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].trim().charAt(0) === "#")) j++;
    if (j < lines.length) {
      var uri = lines[j].trim();
      try { uri = new URL(uri, base).toString(); } catch (e) { if (!/^https?:\/\//i.test(uri)) uri = base + uri; }
      out.push({ url: uri, quality: quality });
      i = j;
    }
  }
  return out;
}
function getVideoSources(url, opts) {
  var ep = _parseEpisodeUrl(url, opts);
  if (!ep || !(ep.id > 0) || !(ep.episode > 0)) return Promise.reject(Error("TwoDHive invalid episode URL"));
  var mode = ep.mode === "dub" ? "dub" : "sub";
  var pageUrl = SITE + "/episode?anime=" + ep.id + "&ep_num=" + ep.episode;
  var playerUrl = MEGA + "/stream/mal/" + ep.id + "/" + ep.episode + "/" + mode;
  return _get(playerUrl, pageUrl).then(function (html) {
    var id = (html.match(/\bdata-id=["'](\d+)["']/i) || html.match(/\bdata-realid=["'](\d+)["']/i) || [])[1];
    if (!id) throw Error("TwoDHive MegaPlay player ID not found");
    var headers = { "User-Agent": UA, "Accept": "*/*", "X-Requested-With": "XMLHttpRequest", "Origin": MEGA, "Referer": playerUrl };
    return _json(MEGA + "/stream/getSourcesNew?id=" + encodeURIComponent(id) + "&type=" + mode, playerUrl).catch(function () {
      return _json(MEGA + "/stream/getSources?id=" + encodeURIComponent(id) + "&type=" + mode, playerUrl);
    }).then(function (root) {
      return _streamFile(root).then(function (rawUrl) {
        if (!rawUrl && typeof extractVideo === "function") {
          return Promise.resolve(extractVideo(playerUrl, { headers: headers, kind: mode, audioLang: mode === "dub" ? "en" : "ja" })).then(function (items) { return { fallback: items || [], root: root }; });
        }
        if (!rawUrl) throw Error("TwoDHive MegaPlay source did not contain a media URL");
        return { rawUrl: _migrateCdn(rawUrl), root: root };
      });
    }).then(function (result) {
      if (result.fallback) {
        if (!result.fallback.length) throw Error("TwoDHive had no fallback stream links");
        return result.fallback;
      }
      var stream = result.rawUrl, headersForPlayback = { "User-Agent": UA, "Referer": MEGA + "/" };
      var tracks = [];
      (result.root && Array.isArray(result.root.tracks) ? result.root.tracks : []).forEach(function (track) {
        if (!track || !track.file || (track.kind && track.kind !== "captions" && track.kind !== "subtitles")) return;
        tracks.push({ url: _migrateCdn(track.file), lang: track.label || "und", label: track.label || "Subtitle" });
      });
      var isHls = /\.m3u8(?:[?#]|$)/i.test(stream);
      if (!isHls) return [{ url: stream, label: "MegaPlay " + mode.toUpperCase(), quality: "Auto", container: /\.mp4(?:[?#]|$)/i.test(stream) ? "mp4" : "auto", headers: headersForPlayback, kind: mode, subtitles: tracks }];
      return _signCdn(stream).then(function (signedMaster) {
        return _get(signedMaster, MEGA + "/").then(function (playlist) { return _variants(stream, playlist); }).catch(function () { return []; }).then(function (variants) {
          var links = [];
          if (variants.length) {
            return Promise.all(variants.map(function (v) {
              return _signCdn(v.url).then(function (signedVariant) {
                links.push({ url: signedVariant, label: "MegaPlay " + mode.toUpperCase() + (v.quality ? " " + v.quality + "p" : ""), quality: v.quality || "Auto", container: "hls", headers: headersForPlayback, kind: mode, subtitles: tracks });
              });
            })).then(function () { return links; });
          }
          return [{ url: signedMaster, label: "MegaPlay " + mode.toUpperCase(), quality: "Auto", container: "hls", headers: headersForPlayback, kind: mode, subtitles: tracks }];
        });
      });
    });
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }
if (typeof module !== "undefined" && module.exports) {
  module.exports = { version: "1.0.0", getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks };
}