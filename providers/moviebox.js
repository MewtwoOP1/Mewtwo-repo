// MovieBox provider — JS port of the Kotlin CloudStream provider.
// Ported: signing/headers, home lists, search, detail metadata.
// NOT ported yet (missing from the pasted Kotlin, file was cut off): episodes + loadLinks.
// version: 1.0.0

const MAIN_URL = "https://api3.aoneroom.com";
const PKG = "com.community.mbox.in";
const UA_BASE = PKG + "/50020042 (Linux; U; Android 16; en_IN; sdk_gphone64_x86_64; Build/BP22.250325.006; Cronet/133.0.6876.3)";

// Same double-base64 scheme as the Kotlin: decode once to a string, then decode that string to the HMAC key bytes.
const SECRET_DEFAULT = "NzZpUmwwN3MweFNOOWpxbUVXQXQ3OUVCSlp1bElRSXNWNjRGWnIyTw==";
const SECRET_ALT = "WHFuMm5uTzQxL0w5Mm8xaXVYaFNMSFRiWHZZNFo1Wlo2Mm04bVNMQQ==";

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

// ---------- HTTP adapter: swap this for the app's own request helper if it provides one ----------
async function httpJson(method, url, body) {
  const ct = method === "POST" ? "application/json; charset=utf-8" : "application/json";
  const res = await fetch(url, {
    method,
    headers: buildHeaders(method, url, body === undefined ? null : body, ct),
    body: body === undefined ? undefined : body
  });
  if (res.status !== 200) {
    let snippet = "";
    try { snippet = (await res.text()).slice(0, 200); } catch (_) {}
    throw new Error("MovieBox HTTP " + res.status + " for " + url + " " + snippet);
  }
  return res.json();
}

// ---------- mapping helpers ----------
function typeOf(subjectType) { return subjectType === 2 ? "series" : "movie"; }

function mapSubject(item) {
  const id = item && item.subjectId != null ? String(item.subjectId) : null;
  const rawTitle = item && item.title;
  if (!id || !rawTitle) return null;
  const rating = parseFloat(item.imdbRatingValue);
  return {
    id,
    url: id,
    title: String(rawTitle).split("[")[0].trim(),
    poster: item.cover && item.cover.url ? item.cover.url : null,
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
      page: parseInt(head[0], 10) || 1, // NOTE: Kotlin used the "1" prefix as the page number, so paging never advanced.
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

// ---------- detail (metadata only — episodes/links need the rest of the Kotlin) ----------
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

async function getDetail(urlOrId) {
  const m = /subjectId=([^&]+)/.exec(urlOrId);
  const id = m ? m[1] : String(urlOrId).split("/").pop();
  const json = await httpJson("GET", MAIN_URL + "/wefeed-mobile-bff/subject-api/get?subjectId=" + id);
  const d = json && json.data;
  if (!d) throw new Error("MovieBox: no data for " + id);
  if (!d.title) throw new Error("MovieBox: no title for " + id);

  const yearMatch = /^(\d{4})/.exec(d.releaseDate || "");
  const rating = parseFloat(d.imdbRatingValue);
  const seen = {};
  const cast = (d.staffList || [])
    .filter((s) => s.staffType === 1 && s.name && !seen[s.name] && (seen[s.name] = true))
    .map((s) => ({ name: s.name, role: s.character || null, image: s.avatarUrl || null }));

  return {
    id: String(id),
    title: String(d.title).split("[")[0].trim(),
    description: d.description || "",
    poster: d.cover && d.cover.url ? d.cover.url : null,
    background: d.cover && d.cover.url ? d.cover.url : null,
    year: yearMatch ? parseInt(yearMatch[1], 10) : null,
    rating: isNaN(rating) ? null : rating,
    duration: parseDurationMinutes(d.duration),
    genres: d.genre ? String(d.genre).split(",").map((g) => g.trim()).filter(Boolean) : [],
    cast,
    type: typeOf(d.subjectType)
    // TODO: episodes (series) + stream links — paste the rest of load()/loadLinks() from the Kotlin.
  };
}

// Exposed for tests / the app's loader
const provider = {
  id: "moviebox", name: "MovieBox", lang: "hi", version: "1.0.0",
  getHome, getCategory, search, getDetail,
  _internals: { md5Bytes, hmacMd5, xTrSignature, canonicalString, xClientToken, toHex, utf8Bytes }
};
if (typeof module !== "undefined") module.exports = provider;
