// AnV anime provider for Zangetsu.
// Uses AnV's public catalogue API and session-bound episode source API.
var SOURCE_ID = (typeof __SOURCE_ID !== "undefined" && __SOURCE_ID) ? String(__SOURCE_ID) : "anv";
var SITE = "https://anv.to";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

function getInfo() {
  return { name: "AnV", lang: "en", baseUrl: SITE, logo: "https://www.google.com/s2/favicons?sz=256&domain=anv.to", type: "anime", version: "1.0.3" };
}
function getSettings() { return []; }
function _txt(value) { return htmlText(String(value == null ? "" : value)).replace(/\s+/g, " ").trim(); }
function _body(response) {
  if (!response || (response.status && response.status >= 400)) throw Error("AnV HTTP " + (response && response.status || "error"));
  if (typeof response.body === "string") return response.body;
  if (response.body && typeof response.body === "object") return JSON.stringify(response.body);
  return "";
}
function _header(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    var found = headers.get(name) || headers.get(name.toLowerCase());
    if (found) return String(found);
  }
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) if (keys[i].toLowerCase() === name.toLowerCase()) return String(headers[keys[i]] || "");
  return "";
}
var _cookie = "";
function _rememberCookie(headers) {
  var raw = _header(headers, "set-cookie");
  var match = raw.match(/(?:^|[,;]\s*)shiro_watch=([^;,\s]+)/i);
  if (match) _cookie = "shiro_watch=" + match[1];
  return _cookie;
}
function _fetchRaw(url, options) {
  return fetch(url, options || {}).then(function (response) {
    var body = _body(response);
    return { body: body, status: response.status || 200, headers: response.headers || null };
  });
}
function _jsonResponse(response) {
  try { return JSON.parse(response.body || "null"); }
  catch (e) { throw Error("AnV returned invalid JSON"); }
}
function _jsonPost(path, payload, referer, cookie) {
  var headers = {
    "User-Agent": UA,
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Origin": SITE,
    "Referer": referer || SITE + "/"
  };
  if (cookie) headers.Cookie = cookie;
  return _fetchRaw(SITE + path, {
    method: "POST",
    headers: headers,
    credentials: "include",
    body: JSON.stringify(payload)
  }).then(_jsonResponse);
}
function _catalog(operation, variables) {
  return _jsonPost("/api/catalog", { operation: operation, variables: variables || {} }, SITE + "/").then(function (root) {
    var data = root && root.data || {};
    return data.Page || data.page || data.pageData || data;
  });
}
function _mediaTitle(media) {
  var t = media && media.title || {};
  return _txt(t.english || t.romaji || t.native || media && media.slug || "");
}
function _poster(media) {
  var c = media && media.coverImage || {};
  return c.extraLarge || c.large || null;
}
function _item(media) {
  if (!media || !media.slug) return null;
  var title = _mediaTitle(media);
  if (!title) return null;
  return {
    id: String(media.slug), title: title,
    url: SITE + "/anime/" + String(media.slug),
    cover: _poster(media), type: "anime", sourceId: SOURCE_ID,
    year: media.seasonYear || null
  };
}
function getHome(opts) {
  return _catalog("PopularAnime", { page: 1, sort: ["TRENDING_DESC"] }).then(function (page) {
    var media = page.media || page.Media || [];
    var items = media.map(_item).filter(Boolean);
    return items.length ? [{ title: "Trending Anime", items: items }] : [];
  }).catch(function () { return []; });
}
function search(query, page, opts) {
  query = String(query || "").trim();
  if (!query) return Promise.resolve([]);
  return _catalog("BrowseAnime", {
    page: Math.max(1, Number(page) || 1), perPage: 28,
    sort: ["POPULARITY_DESC"], search: query
  }).then(function (result) {
    return (result.media || result.Media || []).map(_item).filter(Boolean);
  }).catch(function () { return []; });
}
function _slugFromUrl(url) {
  var s = String(url || "").replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+|\/+$/g, "");
  s = s.replace(/^anime\//i, "").split(/[?#]/)[0].replace(/-episode-\d+$/i, "");
  return s;
}
function _detail(slug) {
  return _catalog("AnimeDetail", { slug: slug }).then(function (data) {
    var media = data.media || data.Media || data.anime || null;
    if (!media || !media.id) throw Error("AnV title detail not found");
    return media;
  });
}
function _episodePageUrl(slug, episode) {
  return SITE + "/anime/" + slug + "-episode-" + episode;
}
function _episodeCookie(slug, episode, force) {
  if (_cookie && !force) return Promise.resolve(_cookie);
  return _fetchRaw(_episodePageUrl(slug, episode), {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml,*/*", "Referer": SITE + "/" },
    credentials: "include"
  }).then(function (result) {
    _rememberCookie(result.headers);
    if (!_cookie) {
      var embedded = result.body.match(/shiro_watch=([^;"'\s]+)/i);
      if (embedded) _cookie = "shiro_watch=" + embedded[1];
    }
    return _cookie;
  });
}
function _episodeSources(id, malId, episode, slug) {
  var pageUrl = _episodePageUrl(slug, episode);
  return _episodeCookie(slug, episode, false).then(function (cookie) {
    if (!cookie) throw Error("AnV session cookie was not returned by the episode page");
    return _jsonPost("/api/episode", { anilistId: id, malId: malId || null, episode: episode, first: true }, pageUrl, cookie);
  }).then(function (root) {
    if (root && root.status === "ready") return root;
    throw Error("AnV episode sources are not ready");
  }).catch(function (error) {
    if (String(error && error.message || error).indexOf("403") < 0) throw error;
    return _episodeCookie(slug, episode, true).then(function (cookie) {
      if (!cookie) throw error;
      return _jsonPost("/api/episode", { anilistId: id, malId: malId || null, episode: episode, first: true }, pageUrl, cookie);
    });
  });
}
function getDetail(url, opts) {
  var slug = _slugFromUrl(url);
  if (!slug) return Promise.reject(Error("AnV invalid title URL"));
  return _detail(slug).then(function (media) {
    var id = Number(media.id), malId = media.idMal == null ? null : Number(media.idMal);
    var aired = media.nextAiringEpisode && Number(media.nextAiringEpisode.episode) - 1 || 0;
    var streams = Array.isArray(media.streamingEpisodes) ? media.streamingEpisodes : [];
    var total = streams.length ? Math.max(streams.length, aired) : Math.max(Number(media.episodes) || 0, aired);
    total = Math.min(total, 500);
    var eps = [];
    for (var n = 1; n <= total; n++) {
      var entry = streams[n - 1] || {};
      var title = _txt(entry.title || "");
      title = title.replace(/^Episode\s+\d+\s*[—:-]\s*/i, "").trim() || ("Episode " + n);
      var data = { id: id, malId: malId, slug: slug, episode: n, variant: "sub" };
      eps.push({
        id: "anv://" + encodeURIComponent(JSON.stringify(data)),
        url: "anv://" + encodeURIComponent(JSON.stringify(data)),
        number: n, title: title, cover: entry.thumbnail || null, type: "anime"
      });
    }
    var t = media.title || {};
    return {
      id: slug, title: _mediaTitle(media), url: SITE + "/anime/" + slug,
      cover: _poster(media), backdrop: media.bannerImage || null,
      description: _txt(media.description || ""), genres: media.genres || [],
      year: media.seasonYear || null, type: media.format === "MOVIE" ? "movie" : "anime",
      sourceId: SOURCE_ID, episodes: eps,
      ids: { anilist: id, mal: malId }
    };
  });
}
function getEpisodes(url, opts) {
  return getDetail(url, opts).then(function (detail) { return detail.episodes || []; });
}
function _parseEpisodeData(value) {
  var raw = String(value || "").replace(/^anv:\/\//, "");
  try { return JSON.parse(decodeURIComponent(raw)); } catch (e) { return null; }
}
function _absolute(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return SITE + (String(url).charAt(0) === "/" ? "" : "/") + url;
}
function getVideoSources(url, opts) {
  var ep = _parseEpisodeData(url);
  if (!ep || !ep.id || !ep.slug || !(Number(ep.episode) > 0)) return Promise.reject(Error("AnV invalid episode data"));
  return _episodeSources(Number(ep.id), ep.malId, Number(ep.episode), String(ep.slug)).then(function (root) {
    var variants = Array.isArray(root.variants) ? root.variants : [];
    var out = [], seen = {}, tracksSeen = {};
    var requested = String((opts && opts.category) || ep.variant || "sub").toLowerCase();
    variants.forEach(function (variant) {
      var vId = String(variant.id || "").toLowerCase();
      if (vId !== "sub" && vId !== "dub") return;
      if (requested !== "both" && vId !== requested) return;
      (variant.sources || []).forEach(function (source) {
        var stream = _absolute(source.url);
        if (!stream) return;
        var repeat = seen[stream] || 0;
        seen[stream] = repeat + 1;
        if (repeat) stream += (stream.indexOf("?") >= 0 ? "&" : "?") + "f=" + repeat;
        var tracks = [];
        (source.tracks || []).forEach(function (track) {
          var subUrl = _absolute(track.src);
          if (!subUrl || tracksSeen[subUrl]) return;
          tracksSeen[subUrl] = 1;
          tracks.push({ url: subUrl, lang: track.language || "und", label: _txt(track.label || track.language || "Subtitle") });
        });
        var label = (vId === "dub" ? "Dub" : "Sub") + " - " + _txt(source.label || "Server");
        var height = Number((String(source.label || "").match(/(\d{3,4})p/i) || [])[1]) || null;
        out.push({
          url: stream, label: label, quality: height || "Auto",
          container: "hls", kind: vId, headers: {
            "User-Agent": UA, "Referer": _episodePageUrl(ep.slug, ep.episode),
            "Cookie": _cookie
          }, subtitles: tracks
        });
      });
    });
    if (!out.length) throw Error("AnV returned no source URLs for this audio mode");
    return out;
  });
}
function getStreams(id, opts) { return getVideoSources(id, opts); }
function getLinks(id, opts) { return getVideoSources(id, opts); }
if (typeof module !== "undefined" && module.exports) {
  module.exports = { version: "1.0.3", getInfo: getInfo, getSettings: getSettings, getHome: getHome, search: search, getDetail: getDetail, getEpisodes: getEpisodes, getVideoSources: getVideoSources, getStreams: getStreams, getLinks: getLinks };
}