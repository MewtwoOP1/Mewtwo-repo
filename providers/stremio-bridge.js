/**
 * Zangetsu Provider: Stremio Addon Bridge (AIOStreams, Pengu, Torrentio, etc.)
 * Version: 1.0.2
 *
 * Users configure their own Stremio addon manifest URLs in Source Settings.
 * No personal addon URL is hard-coded.
 */
const DEFAULT_ADDON_URLS = "";
const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
const TIMEOUT_MS = 15000;

const SOURCE_SETTINGS = [
  {
    key: "addonUrls", id: "addonUrls",
    title: "Stremio Addon Manifest URLs",
    label: "Stremio Addon Manifest URLs (comma-separated)",
    description: "Paste one or more complete Stremio manifest.json URLs, such as your own AIOStreams or Pengu URL. Separate multiple URLs with commas.",
    type: "text", default: DEFAULT_ADDON_URLS, value: DEFAULT_ADDON_URLS,
  },
  {
    key: "excludeNonHttp", id: "excludeNonHttp",
    title: "Direct HTTP/HLS Streams Only", label: "Direct HTTP/HLS Streams Only",
    description: "Hide streams that only provide an infoHash and no direct HTTP(S) URL.",
    type: "toggle", default: true, value: true,
  },
  {
    key: "maxStreamsPerAddon", id: "maxStreamsPerAddon",
    title: "Max Streams Per Addon", label: "Max Streams Per Addon",
    type: "number", default: 25, value: 25,
  },
];

const PROVIDER_META = {
  id: "stremio-bridge",
  name: "Stremio Bridge (Bring Your Own Addons)",
  version: "1.0.2",
  type: "movie",
  lang: "en",
  description: "Connects user-configured Stremio addons to Zangetsu. Each user supplies their own manifest URLs in source settings.",
  settings: SOURCE_SETTINGS,
  preferences: SOURCE_SETTINGS,
};

function normalizeAddonBaseUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
  try {
    const parsed = new URL(rawUrl.trim().replace(/^stremio:\/\//i, "https://"));
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return "";
    parsed.hash = "";
    parsed.pathname = (parsed.pathname.replace(/\/+$/, "").replace(/\/manifest\.json$/i, "") || "/");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function readSetting(runtimeSettings, key, fallback) {
  if (runtimeSettings && runtimeSettings[key] !== undefined && runtimeSettings[key] !== null && runtimeSettings[key] !== "") return runtimeSettings[key];
  for (const getter of ["getPreference", "getSetting"]) {
    if (typeof globalThis[getter] === "function") {
      try {
        const value = globalThis[getter](key);
        if (value !== undefined && value !== null && value !== "") return value;
      } catch {}
    }
  }
  if (globalThis.__settings && globalThis.__settings[key] !== undefined && globalThis.__settings[key] !== "") return globalThis.__settings[key];
  return fallback;
}

function getConfig(runtimeSettings = {}) {
  const rawUrls = String(readSetting(runtimeSettings, "addonUrls", DEFAULT_ADDON_URLS));
  const addonBases = [...new Set(rawUrls.split(/[\n,;]+/).map(normalizeAddonBaseUrl).filter(Boolean))];
  const rawMax = Number(readSetting(runtimeSettings, "maxStreamsPerAddon", 25));
  const rawExclude = readSetting(runtimeSettings, "excludeNonHttp", true);
  const excludeNonHttp = !(rawExclude === false || String(rawExclude).toLowerCase() === "false" || String(rawExclude) === "0");
  return {
    addonBases,
    excludeNonHttp,
    maxStreamsPerAddon: Number.isFinite(rawMax) ? Math.max(1, Math.min(200, Math.floor(rawMax))) : 25,
  };
}

async function fetchJson(url, options = {}) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, {
      ...options,
      headers: { Accept: "application/json", "User-Agent": "Zangetsu-Stremio-Bridge/1.0.2", ...(options.headers || {}) },
      signal: controller ? controller.signal : undefined,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return await response.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildStremioUrl(baseUrl, resource, type, id, extra = "") {
  const base = normalizeAddonBaseUrl(baseUrl);
  if (!base) throw new Error("Invalid Stremio addon base URL");
  const safeResource = String(resource).replace(/[^a-z]/gi, "");
  const query = extra ? (extra.startsWith("?") ? extra : `?${extra}`) : "";
  return `${base}/${safeResource}/${encodeURIComponent(String(type))}/${encodeURIComponent(String(id))}.json${query}`;
}

function mapStremioMetaToCard(meta) {
  if (!meta || !meta.id) return null;
  const type = meta.type === "series" ? "series" : "movie";
  return {
    id: JSON.stringify({ id: meta.id, type, tmdbId: meta.moviedb_id ? Number(meta.moviedb_id) : undefined, malId: meta.mal_id ? Number(meta.mal_id) : undefined }),
    title: meta.name || meta.title || "Untitled",
    poster: meta.poster || "",
    backdrop: meta.background || meta.poster || "",
    year: meta.releaseInfo ? parseInt(String(meta.releaseInfo), 10) || null : null,
    type,
    rating: meta.imdbRating ? parseFloat(meta.imdbRating) : null,
    description: meta.description || "",
  };
}

function parseItemId(rawId) {
  if (!rawId) throw new Error("Missing item ID");
  if (typeof rawId === "object") return rawId;
  const value = String(rawId).trim();
  if (value.startsWith("{")) return JSON.parse(value);
  if (value.includes("|")) {
    const [type, ...rest] = value.split("|");
    return { type: type === "series" ? "series" : "movie", id: rest.join("|") };
  }
  return { type: "movie", id: value };
}

async function getHome() {
  const catalogs = [
    { title: "Popular Movies", type: "movie", id: "top" },
    { title: "Popular Series", type: "series", id: "top" },
  ];
  const results = await Promise.allSettled(catalogs.map(async (section) => {
    const data = await fetchJson(buildStremioUrl(CINEMETA_BASE, "catalog", section.type, section.id));
    return { title: section.title, items: (Array.isArray(data.metas) ? data.metas : []).slice(0, 25).map(mapStremioMetaToCard).filter(Boolean) };
  }));
  return results.filter((result) => result.status === "fulfilled" && result.value.items.length).map((result) => result.value);
}

async function search(query) {
  if (!query || !String(query).trim()) return [];
  const q = encodeURIComponent(String(query).trim());
  const results = await Promise.allSettled([
    fetchJson(buildStremioUrl(CINEMETA_BASE, "catalog", "movie", "top", `search=${q}`)),
    fetchJson(buildStremioUrl(CINEMETA_BASE, "catalog", "series", "top", `search=${q}`)),
  ]);
  const unique = new Map();
  for (const result of results) {
    if (result.status !== "fulfilled" || !Array.isArray(result.value.metas)) continue;
    for (const meta of result.value.metas) {
      const card = mapStremioMetaToCard(meta);
      if (card) unique.set(card.id, card);
    }
  }
  return [...unique.values()];
}

async function getDetail(rawId) {
  const parsed = parseItemId(rawId);
  const id = parsed.id || parsed.videoId;
  const type = parsed.type || "movie";
  if (!id) throw new Error("Missing Stremio item ID");
  const data = await fetchJson(buildStremioUrl(CINEMETA_BASE, "meta", type, id));
  const meta = data && data.meta ? data.meta : {};
  const isSeries = (meta.type || type) === "series";
  const episodes = isSeries && Array.isArray(meta.videos)
    ? meta.videos.filter((v) => Number(v.season) > 0)
      .sort((a, b) => Number(a.season) - Number(b.season) || Number(a.episode || a.number || 0) - Number(b.episode || b.number || 0))
      .map((v) => {
        const episode = Number(v.episode ?? v.number ?? 1);
        const season = Number(v.season ?? 1);
        return { id: JSON.stringify({ type: "series", videoId: v.id || `${id}:${season}:${episode}`, season, episode }), title: v.name || v.title || `Episode ${episode}`, season, episode, number: episode, thumbnail: v.thumbnail || meta.poster || "", overview: v.overview || v.description || "", released: v.released || null };
      })
    : [{ id: JSON.stringify({ type: "movie", videoId: meta.id || id }), title: meta.name || "Full Movie", season: 1, episode: 1, number: 1 }];
  const detail = {
    id: JSON.stringify({ id: meta.id || id, type: isSeries ? "series" : "movie" }),
    title: meta.name || meta.title || "Untitled",
    poster: meta.poster || "",
    backdrop: meta.background || meta.poster || "",
    description: meta.description || "",
    year: meta.releaseInfo ? parseInt(String(meta.releaseInfo), 10) || null : null,
    genres: Array.isArray(meta.genres) ? meta.genres : [],
    type: isSeries ? "series" : "movie",
    episodes,
  };
  const tmdbId = Number(meta.moviedb_id || parsed.tmdbId);
  const malId = Number(meta.mal_id || parsed.malId);
  if (Number.isInteger(tmdbId) && tmdbId > 0) { detail.tmdbId = tmdbId; detail.tmdbIsTv = isSeries; }
  if (Number.isInteger(malId) && malId > 0) detail.malId = malId;
  return detail;
}

function parseQualityLabel(stream) {
  const text = `${stream.name || ""} ${stream.title || ""} ${stream.description || ""}`;
  const match = text.match(/\b(2160p|4k|1080p|720p|480p|360p)\b/i);
  if (!match) return "Auto";
  const value = match[1].toUpperCase();
  return value === "4K" ? "2160p" : value;
}

function mapStremioStream(stream, addonBase, excludeNonHttp) {
  // externalUrl is commonly a webpage, not a playable stream URL.
  const url = typeof stream.url === "string" && /^https?:\/\//i.test(stream.url) ? stream.url : null;
  if (!url && excludeNonHttp) return null;
  if (!url && !stream.infoHash) return null;
  const headers = stream.behaviorHints?.proxyHeaders?.request || {};
  const labels = [
    stream.name ? String(stream.name).replace(/\s+/g, " ").trim() : "Stremio",
    stream.title ? String(stream.title).split("\n")[0].trim() : stream.description ? String(stream.description).split("\n")[0].trim() : "",
  ].filter(Boolean);
  const subtitles = Array.isArray(stream.subtitles)
    ? stream.subtitles.filter((s) => s && typeof s.url === "string").map((s) => ({ url: s.url, lang: s.lang || "en", label: s.lang || "Subtitle" }))
    : [];
  return {
    name: labels.join(" | "),
    title: stream.title || stream.description || labels.join(" | "),
    quality: parseQualityLabel(stream),
    url,
    infoHash: stream.infoHash || undefined,
    fileIdx: stream.fileIdx !== undefined ? stream.fileIdx : undefined,
    headers,
    subtitles,
    addonSource: addonBase,
    isHls: Boolean(url && /\.m3u8(?:\?|$)/i.test(url)),
  };
}

function parseStreamId(rawId) {
  if (typeof rawId !== "string" || !rawId.trim()) return { videoId: String(rawId || ""), mediaType: "movie" };
  const value = rawId.trim();
  if (value.startsWith("{")) {
    const parsed = JSON.parse(value);
    return { videoId: parsed.videoId || parsed.id || "", mediaType: parsed.type === "series" || parsed.season || parsed.episode ? "series" : "movie" };
  }
  return { videoId: value, mediaType: value.includes(":") ? "series" : "movie" };
}

async function getStreams(rawEpisodeId, runtimeSettings = {}) {
  const config = getConfig(runtimeSettings);
  if (!config.addonBases.length) return [];
  const { videoId, mediaType } = parseStreamId(rawEpisodeId);
  if (!videoId) return [];
  const requests = config.addonBases.map(async (addonBase) => {
    const data = await fetchJson(buildStremioUrl(addonBase, "stream", mediaType, videoId));
    const streams = Array.isArray(data.streams) ? data.streams.slice(0, config.maxStreamsPerAddon) : [];
    return streams.map((stream) => mapStremioStream(stream, addonBase, config.excludeNonHttp)).filter(Boolean);
  });
  const results = await Promise.allSettled(requests);
  const unique = new Map();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const stream of result.value) {
      const key = stream.url || `${stream.infoHash || ""}:${stream.fileIdx ?? ""}`;
      if (key !== ":") unique.set(key, stream);
    }
  }
  return [...unique.values()];
}

function getSettings() { return SOURCE_SETTINGS; }

const StremioBridgeProvider = {
  ...PROVIDER_META, getSettings, getPreferences: getSettings,
  getHome, search, getDetail, getStreams, getCatalog: getHome, getLinks: getStreams,
  normalizeAddonBaseUrl, buildStremioUrl, mapStremioStream, getConfig,
};

if (typeof module !== "undefined" && module.exports) module.exports = StremioBridgeProvider;
if (typeof globalThis !== "undefined") {
  globalThis.provider = StremioBridgeProvider;
  globalThis.settings = SOURCE_SETTINGS;
  globalThis.getSettings = getSettings;
  globalThis.getPreferences = getSettings;
  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.getDetail = getDetail;
  globalThis.getStreams = getStreams;
}
