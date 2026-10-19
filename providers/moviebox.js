// MovieBox provider — JS port of the Kotlin CloudStream provider.
// Ported: signed API requests, home/search/detail, episode lists and playback links.
// version: 1.0.4

const MAIN_URL = "https://api3.aoneroom.com";
const PKG = "com.community.mbox.in";
const UA_BASE = PKG + "/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)";

// Same double-base64 scheme as the Kotlin: decode once to a string, then decode that string to the HMAC key bytes.
const SECRET_DEFAULT = "NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==";
const SECRET_ALT = "WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==";

const SUBJECT_CACHE = new Map();
const SUBJECT_CACHE_LIMIT = 400;

function _rememberSubject(id, item) {
  const key = String(id == null ? "" : id);
  if (!key || !item) return;
  const title = String(item.title || item.name || "").split("[")[0].trim();
  if (!title) return;
  const cover = item.cover && item.cover.url ? item.cover.url : null;
  const rating = parseFloat(item.imdbRatingValue);
  const date = String(item.releaseDate || item.release_date || item.first_air_date || "");
  const yearMatch = /^(\d{4})/.exec(date);
  const cached = {
    id: key, url: key, title,
    description: String(item.description || item.overview || ""),
    poster: cover, cover, background: cover,
    year: yearMatch ? parseInt(yearMatch[1], 10) : null,
    rating: Number.isFinite(rating) ? rating : null,
    duration: parseDurationMinutes(item.duration),
    genres: item.genre ? String(item.genre).split(",").map((g) => g.trim()).filter(Boolean) : [],
    cast: [],
    type: typeOf(item.subjectType),
    episodes: [], subCount: 0,
    dubCount: Array.isArray(item.dubs) ? item.dubs.length : 0
  };
  SUBJECT_CACHE.delete(key);
  SUBJECT_CACHE.set(key, cached);
  while (SUBJECT_CACHE.size > SUBJECT_CACHE_LIMIT) {
    SUBJECT_CACHE.delete(SUBJECT_CACHE.keys().next().value);
  }
}

function _cachedSubjectDetail(id) {
  const key = String(id == null ? "" : id);
  const cached = SUBJECT_CACHE.get(key);
  if (!cached) return null;
  SUBJECT_CACHE.delete(key);
  SUBJECT_CACHE.set(key, cached);
  return Object.assign({}, cached, { episodes: [], subCount: 0 });
}

// ---------- byte / base64 helpers (no Node, no atob, no TextEncoder needed) ----------
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function b64DecodeBytes(s) {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  let buf = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
  }
  return out;
}

function b64EncodeBytes(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)];
    out += b === undefined ? "=" : B64[((b & 15) << 2) | ((c || 0) >> 6)];
    out += c === undefined ? "=" : B64[c & 63];
  }
  return out;
}

function bytesToString(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

// ---------- MD5 + HMAC-MD5 ----------
const MD5_K = [];
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

function md5Bytes(bytes) {
  const len = bytes.length;
  const nBlocks = ((len + 8) >> 6) + 1;
  const w = new Array(nBlocks * 16).fill(0);
  for (let i = 0; i < len; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
  w[len >> 2] |= 0x80 << ((len % 4) * 8);
  w[nBlocks * 16 - 2] = (len * 8) >>> 0;
  w[nBlocks * 16 - 1] = Math.floor((len * 8) / 4294967296);

  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let blk = 0; blk < nBlocks; blk++) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + w[blk * 16 + g]) | 0;
      A = D; D = C; C = B;
      const s = MD5_S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((F << s) | (F >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = [];
  for (const v of [a0, b0, c0, d0]) for (let i = 0; i < 4; i++) out.push((v >>> (i * 8)) & 255);
  return out;
}

function toHex(bytes) {
  return bytes.map((b) => (b < 16 ? "0" : "") + b.toString(16)).join("");
}

function hmacMd5(keyBytes, msgBytes) {
  let key = keyBytes.length > 64 ? md5Bytes(keyBytes) : keyBytes.slice();
  while (key.length < 64) key.push(0);
  const ipad = key.map((b) => b ^ 0x36);
  const opad = key.map((b) => b ^ 0x5c);
  return md5Bytes(opad.concat(md5Bytes(ipad.concat(msgBytes))));
}

// ---------- request signing ----------
function reverseString(s) { return s.split("").reverse().join(""); }

function xClientToken(ts) {
  const t = String(ts === undefined ? Date.now() : ts);
  return t + "," + toHex(md5Bytes(utf8Bytes(reverseString(t))));
}

// Parses "path?query" without relying on URL/URLSearchParams being present.
function splitUrl(url) {
  const noOrigin = url.replace(/^https?:\/\/[^/]+/, "");
  const q = noOrigin.indexOf("?");
  const path = q === -1 ? noOrigin : noOrigin.slice(0, q);
  const params = {};
  if (q !== -1) {
    noOrigin.slice(q + 1).split("&").forEach((pair) => {
      if (!pair) return;
      const i = pair.indexOf("=");
      const k = decodeURIComponent(i === -1 ? pair : pair.slice(0, i));
      const v = i === -1 ? "" : decodeURIComponent(pair.slice(i + 1).replace(/\+/g, " "));
      (params[k] = params[k] || []).push(v);
    });
  }
  return { path, params };
}

function canonicalString(method, accept, contentType, url, body, ts) {
  const { path, params } = splitUrl(url);
  const keys = Object.keys(params).sort();
  const query = keys.map((k) => params[k].map((v) => k + "=" + v).join("&")).join("&");
  const canonicalUrl = query ? path + "?" + query : path;

  let bodyHash = "", bodyLength = "";
  if (body !== null && body !== undefined) {
    const bytes = utf8Bytes(body);
    bodyLength = String(bytes.length);                       // full length
    bodyHash = toHex(md5Bytes(bytes.length > 102400 ? bytes.slice(0, 102400) : bytes)); // hash of first 100 KB
  }
  return [method.toUpperCase(), accept || "", contentType || "", bodyLength, String(ts), bodyHash, canonicalUrl].join("\n");
}

function xTrSignature(method, accept, contentType, url, body, useAlt, ts) {
  const t = ts === undefined ? Date.now() : ts;
  const canonical = canonicalString(method, accept, contentType, url, body, t);
  const keyStr = bytesToString(b64DecodeBytes(useAlt ? SECRET_ALT : SECRET_DEFAULT));
  const key = b64DecodeBytes(keyStr);
  return t + "|2|" + b64EncodeBytes(hmacMd5(key, utf8Bytes(canonical)));
}

// ---------- device identity (stable for the session; the Kotlin picked a random model per request) ----------
function randomHex(nBytes) {
  let s = "";
  for (let i = 0; i < nBytes; i++) s += ("0" + Math.floor(Math.random() * 256).toString(16)).slice(-2);
  return s;
}
const DEVICE_ID = randomHex(16);
const DEVICE = { brand: "google", model: "sdk_gphone64_x86_64" };

function clientInfo() {
  return JSON.stringify({
    package_name: PKG, version_name: "3.0.03.0529.03", version_code: 50020042,
    os: "android", os_version: "16", device_id: DEVICE_ID, install_store: "ps",
    gaid: "d7578036d13336cc", brand: DEVICE.brand, model: DEVICE.model,
    system_language: "en", net: "NETWORK_WIFI", region: "IN", timezone: "Asia/Calcutta", sp_code: ""
  });
}

function playerClientInfo() {
  return JSON.stringify({
    package_name: "com.community.oneroom",
    version_name: "3.0.13.0325.03",
    version_code: 50020088,
    os: "android",
    os_version: "13",
    device_id: DEVICE_ID,
    install_store: "ps",
    gaid: "d7578036d13336cc",
    brand: "google",
    model: "Pixel 7",
    system_language: "en",
    net: "NETWORK_WIFI",
    region: "US",
    timezone: "Asia/Calcutta",
    sp_code: ""
  });
}
function buildHeaders(method, url, body, contentType) {
  const ct = contentType || "application/json";
  return {
    "user-agent": UA_BASE,
    "accept": "application/json",
    "content-type": ct,
    "connection": "keep-alive",
    "x-client-token": xClientToken(),
    "x-tr-signature": xTrSignature(method, "application/json", ct, url, body),
    "x-client-info": clientInfo(),
    "x-client-status": "0",
    "x-play-mode": "2"
  };
}

function buildBootstrapHeaders(method, url, body, contentType) {
  const ct = contentType || "application/json";
  return {
    "user-agent": PLAYER_UA,
    "accept": "application/json",
    "content-type": ct,
    "connection": "keep-alive",
    "x-client-token": xClientToken(),
    "x-tr-signature": xTrSignature(method, "application/json", ct, url, body),
    "x-client-info": playerClientInfo(),
    "x-client-status": "0",
    "x-play-mode": "2"
  };
}

// ---------- HTTP adapter + anonymous MovieBox session ----------
const API_HOSTS = [
  "https://api6.aoneroom.com",
  "https://api5.aoneroom.com",
  "https://api4.aoneroom.com",
  "https://api4sg.aoneroom.com",
  "https://api3.aoneroom.com",
  "https://api6sg.aoneroom.com",
  "https://api.inmoviebox.com"
];
const PLAYER_BASE = "https://moviebox.ph";
const PLAYER_UA = "com.community.oneroom/50020088 (Linux; U; Android 13; en_US; Pixel 7; Build/TQ3A.230901.001; Cronet/145.0.7582.0)";
const TOKEN_URLS = [
  "/wefeed-mobile-bff/tab-operating?page=1&tabId=0&version=",
  "/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=4516404531735022304&page=1&perPage=1"
];
let bearerToken = "";
let tokenCheckedAt = 0;
let tokenBootstrapPromise = null;

function _header(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    const value = headers.get(name);
    if (value != null && value !== "") return String(value);
  }
  const target = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === target) {
      const value = headers[k];
      return Array.isArray(value) ? String(value[0] || "") : String(value || "");
    }
  }
  return "";
}
function _captureToken(headers) {
  const raw = _header(headers, "x-user");
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    if (obj && obj.token) bearerToken = String(obj.token);
  } catch (_) {}
}
function _tokenExpiry(token) {
  try {
    const part = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bytes = b64DecodeBytes(part);
    const json = decodeURIComponent(bytes.map((b) => "%" + ("0" + b.toString(16)).slice(-2)).join(""));
    return Number(JSON.parse(json).exp) || 0;
  } catch (_) { return 0; }
}
async function ensureToken(force) {
  const now = Date.now();
  const expiry = bearerToken ? _tokenExpiry(bearerToken) : 0;
  if (!force && bearerToken && (!expiry || expiry > now / 1000 + 300)) return bearerToken;
  if (tokenBootstrapPromise) return tokenBootstrapPromise;

  bearerToken = "";
  tokenBootstrapPromise = (async () => {
    try {
      // The token handshake must use the OneRoom playback identity, not the
      // MovieBox catalogue identity. Some upstreams return 200 from
      // tab-operating without x-user, so fall back to the lightweight ranking
      // endpoint used by the maintained MovieBox REST provider.
      let lastError = null;
      for (const path of TOKEN_URLS) {
        try {
          await httpJson("GET", MAIN_URL + path, undefined, {}, true);
          if (bearerToken) return bearerToken;
          lastError = new Error("bootstrap endpoint returned no x-user token: " + path);
        } catch (e) {
          lastError = e;
        }
      }
      throw lastError || new Error("MovieBox bootstrap returned no x-user bearer token");
    } catch (e) {
      bearerToken = "";
      console.log("[MovieBox] anonymous token bootstrap failed: " + (e && e.message ? e.message : String(e)));
      throw e;
    } finally {
      tokenBootstrapPromise = null;
    }
  })();
  return tokenBootstrapPromise;
}
function _withApiHost(url, host) {
  return String(url).replace(/^https:\/\/[^/]+/i, host);
}
async function httpJson(method, url, body, extraHeaders, skipAuth, retryAuth) {
  const request = String(url);
  const isApi = /\.(?:aoneroom|inmoviebox)\.com\//i.test(request);
  if (isApi && !skipAuth) await ensureToken();

  const ct = method === "POST" ? "application/json; charset=utf-8" : "application/json";
  const originalHost = (request.match(/^https:\/\/[^/]+/i) || [MAIN_URL])[0];
  const hosts = isApi ? [originalHost].concat(API_HOSTS.filter((h) => h !== originalHost)) : [originalHost];
  let lastError = null;
  let sawAuthFailure = false;
  const retryableStatuses = [401, 403, 407, 429, 440, 500, 502, 503, 504, 530];
  const authStatuses = [401, 403, 407, 440, 530];

  for (let i = 0; i < (isApi ? hosts.length : 1); i++) {
    const requestUrl = _withApiHost(request, hosts[i]);
    const headers = skipAuth
      ? buildBootstrapHeaders(method, requestUrl, body === undefined ? null : body, ct)
      : buildHeaders(method, requestUrl, body === undefined ? null : body, ct);
    Object.keys(extraHeaders || {}).forEach((k) => { headers[k] = extraHeaders[k]; });
    if (!skipAuth && bearerToken) headers.Authorization = "Bearer " + bearerToken;

    let res;
    try {
      res = await fetch(requestUrl, {
        method,
        headers,
        body: body === undefined ? undefined : body,
        timeoutMs: 12000
      });
    } catch (e) {
      lastError = e;
      if (i + 1 < (isApi ? hosts.length : 1)) continue;
      break;
    }

    _captureToken(res.headers);
    const status = Number(res.status);
    if (status < 200 || status >= 300) {
      lastError = new Error("MovieBox HTTP " + status + " for " + requestUrl + " " + String(res.body || "").slice(0, 160));
      if (authStatuses.includes(status)) sawAuthFailure = true;
      if (retryableStatuses.includes(status) && i + 1 < (isApi ? hosts.length : 1)) continue;
      break;
    }

    let parsed;
    try {
      parsed = JSON.parse(String(res.body || "null"));
    } catch (_) {
      lastError = new Error("MovieBox returned invalid JSON for " + requestUrl);
      break;
    }

    // The API frequently returns HTTP 200 for application-level failures.
    // Do not silently convert those failures into empty search/episode results.
    if (parsed && parsed.code != null && Number(parsed.code) !== 0) {
      const detail = String(parsed.message || parsed.msg || parsed.error || "");
      const authError = /token|auth|unauthor|expired|login|credential/i.test(detail) ||
        [401, 403, 407, 440].includes(Number(parsed.code));
      lastError = new Error("MovieBox API code " + parsed.code + (detail ? ": " + detail : "") + " for " + requestUrl);
      if (authError) {
        sawAuthFailure = true;
        if (i + 1 < (isApi ? hosts.length : 1)) continue;
      }
      break;
    }
    return parsed;
  }

  if (sawAuthFailure && !skipAuth && retryAuth !== false) {
    try {
      await ensureToken(true);
      return await httpJson(method, request, body, extraHeaders, false, false);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("MovieBox request failed: " + request);
}

// ---------- mapping helpers ----------
function typeOf(subjectType) { return Number(subjectType) === 2 || Number(subjectType) === 7 ? "series" : "movie"; }

function mapSubject(item) {
  const id = item && item.subjectId != null ? String(item.subjectId) : null;
  const rawTitle = item && item.title;
  if (!id || !rawTitle) return null;
  _rememberSubject(id, item);
  const rating = parseFloat(item.imdbRatingValue);
  return {
    id,
    url: id,
    title: String(rawTitle).split("[")[0].trim(),
    poster: item.cover && item.cover.url ? item.cover.url : null,
    cover: item.cover && item.cover.url ? item.cover.url : null,
    type: typeOf(item.subjectType),
    rating: isNaN(rating) ? null : rating
  };
}

const CATEGORIES = [
  ["4516404531735022304", "Trending"], ["5692654647815587592", "Trending in Cinema"],
  ["414907768299210008", "Bollywood"], ["3859721901924910512", "South Indian"],
  ["8019599703232971616", "Hollywood"], ["4741626294545400336", "Top Series This Week"],
  ["8434602210994128512", "Anime"], ["1255898847918934600", "Reality TV"],
  ["4903182713986896328", "Indian Drama"], ["7878715743607948784", "Korean Drama"],
  ["8788126208987989488", "Chinese Drama"], ["3910636007619709856", "Western TV"],
  ["5177200225164885656", "Turkish Drama"],
  ["1|1", "Movies"], ["1|2", "Series"], ["1|1006", "Anime (Browse)"],
  ["1|1;country=India", "Indian (Movies)"], ["1|2;country=India", "Indian (Series)"],
  ["1|1;classify=Hindi dub;country=United States", "USA (Movies)"],
  ["1|2;classify=Hindi dub;country=United States", "USA (Series)"],
  ["1|1;country=Japan", "Japan (Movies)"], ["1|2;country=Japan", "Japan (Series)"],
  ["1|1;country=China", "China (Movies)"], ["1|2;country=China", "China (Series)"],
  ["1|1;country=Philippines", "Philippines (Movies)"], ["1|2;country=Philippines", "Philippines (Series)"],
  ["1|1;country=Thailand", "Thailand (Movies)"], ["1|2;country=Thailand", "Thailand (Series)"],
  ["1|1;country=Nigeria", "Nollywood (Movies)"], ["1|2;country=Nigeria", "Nollywood (Series)"],
  ["1|1;country=Korea", "South Korean (Movies)"], ["1|2;country=Korea", "South Korean (Series)"],
  ["1|1;classify=Hindi dub;genre=Action", "Action (Movies)"],
  ["1|1;classify=Hindi dub;genre=Crime", "Crime (Movies)"],
  ["1|1;classify=Hindi dub;genre=Comedy", "Comedy (Movies)"],
  ["1|1;classify=Hindi dub;genre=Romance", "Romance (Movies)"],
  ["1|2;classify=Hindi dub;genre=Crime", "Crime (Series)"],
  ["1|2;classify=Hindi dub;genre=Comedy", "Comedy (Series)"],
  ["1|2;classify=Hindi dub;genre=Romance", "Romance (Series)"]
].map(([data, name]) => ({ data, name }));

// ---------- home ----------
async function fetchCategory(cat, page) {
  const perPage = 15;
  const data = cat.data;
  let json;

  if (data.indexOf("|") !== -1) {
    // Filtered list: POST
    const url = MAIN_URL + "/wefeed-mobile-bff/subject-api/list";
    const head = data.split(";")[0].split("|");
    const opts = {};
    data.split(";").slice(1).forEach((kv) => {
      const i = kv.indexOf("=");
      if (i > 0 && i < kv.length - 1) opts[kv.slice(0, i)] = kv.slice(i + 1);
    });
    const body = JSON.stringify({
      page: Number(page) || 1,
      perPage,
      channelId: head[1],
      classify: opts.classify || "All",
      country: opts.country || "All",
      year: opts.year || "All",
      genre: opts.genre || "All",
      sort: opts.sort || "ForYou"
    });
    json = await httpJson("POST", url, body);
  } else {
    // Ranking list: GET
    const url = MAIN_URL + "/wefeed-mobile-bff/tab/ranking-list?tabId=0&categoryType=" + data + "&page=" + page + "&perPage=" + perPage;
    json = await httpJson("GET", url);
  }

  const d = json && json.data;
  const items = d && (d.items || d.subjects);
  if (!Array.isArray(items)) return [];
  return items.map(mapSubject).filter(Boolean);
}

async function getHome(page) {
  const pg = page || 1;
  const sections = [];
  // Fetch a handful of rows in parallel; failures in one row don't kill the home page.
  const rows = CATEGORIES.slice(0, 8);
  const results = await Promise.all(rows.map((c) =>
    fetchCategory(c, pg).catch((e) => { console.log("[MovieBox] home row failed:", c.name, e.message); return []; })
  ));
  rows.forEach((c, i) => { if (results[i].length) sections.push({ title: c.name, items: results[i] }); });
  return sections;
}

async function getCategory(categoryData, page) {
  const cat = CATEGORIES.find((c) => c.data === categoryData) || { data: categoryData, name: categoryData };
  return fetchCategory(cat, page || 1);
}

// ---------- search ----------
async function search(query, page) {
  const q = String(query || "").trim();
  if (!q) return [];
  const url = MAIN_URL + "/wefeed-mobile-bff/subject-api/search/v2";
  const body = JSON.stringify({ page: page || 1, perPage: 20, keyword: q }); // JSON.stringify escapes quotes safely
  const json = await httpJson("POST", url, body);
  const results = (json && json.data && json.data.results) || [];
  const out = [];
  const seen = {};
  for (const group of results) {
    for (const s of (group.subjects || [])) {
      const m = mapSubject(s);
      if (m && !seen[m.id]) { seen[m.id] = true; out.push(m); }
    }
  }
  return out;
}

// ---------- detail helpers ----------
function parseDurationMinutes(dur) {
  if (!dur) return null;
  const hm = /(\d+)\s*h\s*(\d+)\s*m/i.exec(dur);
  if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);
  const h = /(\d+)\s*h/i.exec(dur);
  const m = /(\d+)\s*m/i.exec(dur);
  if (h || m) return (h ? parseInt(h[1], 10) * 60 : 0) + (m ? parseInt(m[1], 10) : 0);
  const n = parseInt(dur, 10);
  return isNaN(n) ? null : n;
}

// ---------- Zangetsu provider contract + playable MovieBox streams ----------
function getInfo() {
  return { name: "MovieBox", lang: "hi", baseUrl: PLAYER_BASE, logo: "https://www.google.com/s2/favicons?sz=256&domain=movie-box.co", type: "movie", version: "1.0.5" };
}
function getSettings() { return []; }
function _subjectId(value) {
  const s = String(value || "");
  const m = /subjectId=([^&]+)/.exec(s);
  return decodeURIComponent(m ? m[1] : s.replace(/^mbx:\/\//, "").split(/[/?|]/)[0]);
}
function _episodeUrl(id, season, episode) {
  return "mbx://" + encodeURIComponent(String(id)) + "?se=" + (season || 0) + "&ep=" + (episode || 0);
}
function _parseEpisodeUrl(value) {
  const m = /^mbx:\/\/([^?]+)(?:\?se=(\d+)&ep=(\d+))?$/.exec(String(value || ""));
  return m ? { id: decodeURIComponent(m[1]), season: Number(m[2] || 0), episode: Number(m[3] || 0) } : { id: _subjectId(value), season: 0, episode: 0 };
}
async function _fetchSeasonInfo(subjectId) {
  const url = MAIN_URL + "/wefeed-mobile-bff/subject-api/season-info?subjectId=" + encodeURIComponent(subjectId);
  const json = await httpJson("GET", url);
  const seasons = json && json.data && Array.isArray(json.data.seasons) ? json.data.seasons : [];
  return seasons.map((s) => ({
    season: Number(s.se != null ? s.se : (s.seasonNumber != null ? s.seasonNumber : 1)),
    count: Math.min(Number(s.maxEp != null ? s.maxEp : (s.episodeCount != null ? s.episodeCount : 0)), 1000)
  })).filter((s) => Number.isFinite(s.season) && s.season >= 1 && Number.isFinite(s.count) && s.count > 0);
}
async function _makeEpisodes(id, d) {
  const subjectType = Number(d.subjectType);
  if (subjectType !== 2 && subjectType !== 7) {
    return [{ id: "movie", number: 1, title: String(d.title || "Movie"), url: _episodeUrl(id, 0, 0) }];
  }

  const subjectIds = [String(id)];
  (Array.isArray(d.dubs) ? d.dubs : []).forEach((dub) => {
    if (dub && dub.subjectId != null) {
      const dubId = String(dub.subjectId);
      if (dubId && !subjectIds.includes(dubId)) subjectIds.push(dubId);
    }
  });

  const seasonSets = await Promise.all(subjectIds.map((subjectId) =>
    _fetchSeasonInfo(subjectId).catch((e) => {
      console.log("[MovieBox] season-info failed for " + subjectId + ": " + (e && e.message ? e.message : String(e)));
      return [];
    })
  ));
  const seasonCounts = new Map();
  seasonSets.forEach((rows) => rows.forEach((row) => {
    seasonCounts.set(row.season, Math.max(seasonCounts.get(row.season) || 0, row.count));
  }));
  if (!seasonCounts.size) seasonCounts.set(1, 1);

  const seasons = Array.from(seasonCounts.entries()).sort((a, b) => a[0] - b[0]);
  const out = [];
  seasons.forEach(([season, count]) => {
    for (let episode = 1; episode <= count; episode++) out.push({
      id: "S" + season + "E" + episode,
      number: episode,
      season,
      title: seasons.length > 1 ? "Season " + season + " - Episode " + episode : "Episode " + episode,
      url: _episodeUrl(id, season, episode)
    });
  });
  return out;
}

async function getDetail(urlOrId) {
  const id = _subjectId(urlOrId);
  if (!id) throw new Error("MovieBox: missing subject ID");
  try {
    await ensureToken();
    const json = await httpJson("GET", MAIN_URL + "/wefeed-mobile-bff/subject-api/get?subjectId=" + encodeURIComponent(id));
    const d = json && json.data;
    if (!d || !d.title) throw new Error("MovieBox: no detail data for " + id);
    // Refresh the cache before fetching season-info, so transient failures can
    // retain the real MovieBox identity and catalogue fields.
    _rememberSubject(id, d);
    const yearMatch = /^(\d{4})/.exec(d.releaseDate || "");
    const rating = parseFloat(d.imdbRatingValue), seen = {};
    const cast = (d.staffList || []).filter((s) => s.staffType === 1 && s.name && !seen[s.name] && (seen[s.name] = true))
      .map((s) => ({ name: s.name, role: s.character || null, image: s.avatarUrl || null }));
    const episodes = await _makeEpisodes(id, d);
    return {
      id: String(id), url: String(id), title: String(d.title).split("[")[0].trim(),
      description: d.description || "", poster: d.cover && d.cover.url ? d.cover.url : null,
      cover: d.cover && d.cover.url ? d.cover.url : null,
      background: d.cover && d.cover.url ? d.cover.url : null,
      year: yearMatch ? parseInt(yearMatch[1], 10) : null, rating: isNaN(rating) ? null : rating,
      duration: parseDurationMinutes(d.duration),
      genres: d.genre ? String(d.genre).split(",").map((g) => g.trim()).filter(Boolean) : [],
      cast, type: typeOf(d.subjectType), episodes, subCount: episodes.length,
      dubCount: Array.isArray(d.dubs) ? d.dubs.length : 0
    };
  } catch (error) {
    const cached = _cachedSubjectDetail(id);
    if (!cached) throw error;
    console.log("[MovieBox] detail temporarily unavailable for " + id +
      "; keeping cached listing metadata without episodes: " +
      (error && error.message ? error.message : String(error)));
    // MetadataRepository keeps the canonical catalogue episode list when a
    // matched source returns a valid detail with no episodes. Do not convert a
    // MovieBox outage into a false "AniList is having a moment" error.
    return cached;
  }
}
function getEpisodes(urlOrId, opts) { return getDetail(urlOrId, opts).then((d) => d.episodes || []); }
function _collectStreams(playData) {
  const out = Array.isArray(playData && playData.streams) ? playData.streams.slice() : [];
  [["netDash", "DASH"], ["netHls", "HLS"]].forEach(([key, format]) => {
    const value = playData && (playData[key] != null ? playData[key] : (playData.data && playData.data[key]));
    (Array.isArray(value) ? value : value ? [value] : []).forEach((item) => {
      if (typeof item === "string") out.push({ url: item, format });
      else if (item && typeof item === "object") {
        if (item.url || item.playUrl || item.resourceLink || item.streamUrl) out.push(Object.assign({}, item, { format: item.format || format }));
        else Object.keys(item).forEach((resolution) => {
          const v = item[resolution];
          if (typeof v === "string" && /^https?:\/\//i.test(v)) out.push({ url: v, resolution, format });
          else if (v && typeof v === "object") out.push(Object.assign({}, v, { resolution: v.resolution || resolution, format: v.format || format }));
        });
      }
    });
  });
  const seen = {};
  return out.filter((s) => { const u = s && (s.url || s.playUrl || s.resourceLink || s.streamUrl); if (!u || seen[u]) return false; seen[u] = true; return true; });
}
function _streamQuality(stream) {
  const m = String(stream.resolutions || stream.resolution || stream.quality || "").match(/(2160|1440|1080|720|480|360|240)/);
  return m ? m[1] + "p" : "auto";
}
function _streamFormat(url, declared) {
  const f = String(declared || "").toLowerCase();
  if (f.indexOf("dash") >= 0 || /\.mpd(?:[?#]|$)/i.test(url)) return "dash";
  if (f.indexOf("hls") >= 0 || /\.m3u8(?:[?#]|$)/i.test(url)) return "hls";
  return "mp4";
}
function _audioLanguage(stream, fallback) {
  const raw = String(stream.languageName || stream.lanName || stream.language || stream.lan || fallback || "Original").replace(/\b(dub|audio)\b/ig, "").replace(/[_-]+/g, " ").trim();
  const names = { en:"English", hi:"Hindi", ja:"Japanese", ta:"Tamil", te:"Telugu", ml:"Malayalam", bn:"Bengali", ko:"Korean", zh:"Chinese", es:"Spanish", fr:"French", pt:"Portuguese", ar:"Arabic" };
  const code = raw.toLowerCase().match(/^([a-z]{2,3})\b/);
  return (code && names[code[1]]) || raw || "Original";
}
function _policyStreamUrl(cookie) {
  const raw = String(cookie || "");
  let m = /Edge-Cache-Cookie=urlprefix=([^:;\s]+)/.exec(raw);
  if (m) {
    try {
      let b = m[1].replace(/_/g, "/").replace(/-/g, "+"); while (b.length % 4) b += "=";
      const bytes = b64DecodeBytes(b);
      const path = decodeURIComponent(bytes.map((v) => "%" + ("0" + v.toString(16)).slice(-2)).join("")).replace(/\/+$/, "");
      if (path) return path + "/index.mpd";
    } catch (_) {}
  }
  m = /CloudFront-Policy=([^;]+)/.exec(raw);
  if (m) {
    try {
      let b = m[1].replace(/-/g, "+").replace(/~/g, "/").replace(/_/g, "="); while (b.length % 4) b += "=";
      const bytes = b64DecodeBytes(b);
      const parsed = JSON.parse(decodeURIComponent(bytes.map((v) => "%" + ("0" + v.toString(16)).slice(-2)).join("")));
      const resource = parsed && parsed.Statement && parsed.Statement[0] && parsed.Statement[0].Resource;
      if (resource) { const clean = String(resource).replace(/[\/*]+$/, ""); return /\.mpd$/i.test(clean) ? clean : clean + "/index.mpd"; }
    } catch (_) {}
  }
  return "";
}
async function _getCaptions(subjectId, streamId, language) {
  const out = [], seen = {};
  const urls = [
    MAIN_URL + "/wefeed-mobile-bff/subject-api/get-stream-captions?subjectId=" + encodeURIComponent(subjectId) + "&streamId=" + encodeURIComponent(streamId),
    MAIN_URL + "/wefeed-mobile-bff/subject-api/get-ext-captions?subjectId=" + encodeURIComponent(subjectId) + "&resourceId=" + encodeURIComponent(streamId) + "&episode=0"
  ];
  for (const url of urls) {
    try {
      const j = await httpJson("GET", url), caps = j && j.data && j.data.extCaptions;
      if (!Array.isArray(caps)) continue;
      caps.forEach((cap) => {
        if (!cap.url || seen[cap.url]) return;
        seen[cap.url] = true;
        out.push({ url: cap.url, lang: cap.language || cap.lanName || cap.lan || "en", label: (cap.lanName || cap.language || "Subtitle") + " (" + language + ")", headers: { Referer: MAIN_URL } });
      });
    } catch (_) {}
  }
  return out;
}
async function getVideoSources(episodeUrl, opts) {
  const ep = _parseEpisodeUrl(episodeUrl);
  if (!ep.id) return [];
  await ensureToken();
  const detailJson = await httpJson("GET", MAIN_URL + "/wefeed-mobile-bff/subject-api/get?subjectId=" + encodeURIComponent(ep.id));
  const subject = detailJson && detailJson.data;
  if (!subject) return [];
  const playerHeaders = {
    Referer: MAIN_URL,
    "user-agent": PLAYER_UA,
    "x-client-info": playerClientInfo()
  };
  const mediaHeaders = { Referer: MAIN_URL, "User-Agent": PLAYER_UA, Accept: "*/*" };
  const ids = []; let original = "Original";
  if (Array.isArray(subject.dubs)) subject.dubs.forEach((dub) => {
    if (String(dub.subjectId) === String(ep.id)) original = dub.lanName || "Original";
    else if (dub.subjectId != null) ids.push({ id: String(dub.subjectId), lang: dub.lanName || "Dub" });
  });
  ids.unshift({ id: String(ep.id), lang: original });
  const results = [];
  for (const item of ids) {
    const query = "subjectId=" + encodeURIComponent(item.id) + "&se=" + ep.season + "&ep=" + ep.episode;
    try {
      const response = await httpJson("GET", MAIN_URL + "/wefeed-mobile-bff/subject-api/play-info?" + query, undefined, playerHeaders);
      const data = response && response.data;
      if (!data) continue;
      const streams = _collectStreams(data); let found = false;
      for (const stream of streams) {
        const raw = stream.url || stream.playUrl || stream.resourceLink || stream.streamUrl || "";
        const cookie = stream.signCookie || "";
        const url = raw;
        if (!/^https?:\/\//i.test(url)) continue;
        const quality = _streamQuality(stream), container = _streamFormat(url, stream.format);
        const streamId = stream.id || (item.id + "|" + ep.season + "|" + ep.episode);
        const subtitles = await _getCaptions(item.id, streamId, item.lang);
        const headers = Object.assign({}, mediaHeaders);
        if (cookie) headers[stream.signHeaderKey || stream.sign_header_key || "Cookie"] = cookie;
        results.push({ url, quality, container, headers, kind: "sub", audioLang: item.lang || "Original", subtitles,
          label: "MovieBox · " + quality + " · " + _audioLanguage(stream, item.lang) + " · " + container.toUpperCase() });
        found = true;
      }
      if (!found) {
        const detectors = Array.isArray(data.resourceDetectors) ? data.resourceDetectors : (subject.resourceDetectors || []);
        detectors.forEach((detector) => (detector.resolutionList || []).forEach((video) => {
          if (!video.resourceLink) return;
          if ((ep.season || ep.episode) && (Number(video.se != null ? video.se : 0) !== ep.season || Number(video.ep != null ? video.ep : 0) !== ep.episode)) return;
          const url = video.resourceLink, quality = video.resolution ? String(video.resolution) + "p" : "auto";
          results.push({ url, quality, container: _streamFormat(url, ""), headers: Object.assign({}, playerHeaders),
            kind: "sub", audioLang: item.lang || "Original", subtitles: [], label: "MovieBox · " + quality + " · " + _audioLanguage({}, item.lang) });
        }));
      }
    } catch (e) { console.log("[MovieBox] stream request failed for " + item.id + ": " + e.message); }
  }
  const rank = { "2160p":2160, "1440p":1440, "1080p":1080, "720p":720, "480p":480, "360p":360, "240p":240, "auto":1 };
  results.sort((a,b) => (rank[b.quality] || 0) - (rank[a.quality] || 0));
  return results;
}
function popular(opts) {
  const page = opts && typeof opts === "object" ? (opts.page || 1) : (opts || 1);
  return getHome({ page }).then((rows) => {
    const out = []; (rows || []).forEach((row) => (row.items || []).forEach((item) => out.push(item)));
    return out;
  });
}
function getHome(opts) {
  const page = opts && typeof opts === "object" ? (opts.page || 1) : (opts || 1);
  return Promise.all(CATEGORIES.slice(0, 8).map((cat) =>
    fetchCategory(cat, page).then((items) => ({ title: cat.name, items }))
      .catch((e) => { console.log("[MovieBox] home row failed: " + cat.name + ": " + e.message); return { title: cat.name, items: [] }; })
  )).then((rows) => rows.filter((row) => row.items.length));
}

// Exposed for tests / the app's loader
const provider = {
  id: "moviebox", name: "MovieBox", lang: "hi", version: "1.0.5",
  getInfo, getSettings, getHome, popular, getCategory, search, getDetail, getEpisodes, getVideoSources,
  getStreams: getVideoSources,
  _internals: { md5Bytes, hmacMd5, xTrSignature, canonicalString, xClientToken, toHex, utf8Bytes, _parseEpisodeUrl, _collectStreams, _policyStreamUrl }
};
if (typeof module !== "undefined") module.exports = provider;
