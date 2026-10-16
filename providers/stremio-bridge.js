/**
 * Zangetsu Provider: Stremio Addon Bridge (AIOStreams, Pengu, etc.)
 * Version: 1.0.1
 */

// 👇 PASTE YOUR AIOSTREAMS / PENGU MANIFEST URLS HERE (COMMA-SEPARATED) 👇
const DEFAULT_ADDON_URLS = [
  "https://v3-cinemeta.strem.io/manifest.json",
  // "https://your-aiostreams-instance.com/.../manifest.json",
  // "https://your-pengu-instance.com/.../manifest.json"
].join(",");

const SOURCE_SETTINGS = [
  {
    key: "addonUrls",
    id: "addonUrls",
    title: "Stremio Addon Manifest URLs",
    label: "Stremio Addon Manifest URLs (comma-separated)",
    description: "Paste your AIOStreams, Pengu, or other Stremio manifest.json URLs",
    type: "text",
    default: DEFAULT_ADDON_URLS,
    value: DEFAULT_ADDON_URLS,
  },
  {
    key: "excludeNonHttp",
    id: "excludeNonHttp",
    title: "Direct HTTP/HLS Streams Only",
    label: "Direct HTTP/HLS Streams Only",
    description: "Skip raw infoHash torrents without a direct HTTP/debrid stream URL",
    type: "toggle",
    default: true,
    value: true,
  },
  {
    key: "maxStreamsPerAddon",
    id: "maxStreamsPerAddon",
    title: "Max Streams Per Addon",
    label: "Max Streams Per Addon",
    type: "number",
    default: 25,
    value: 25,
  },
];

const PROVIDER_META = {
  id: "stremio-bridge",
  name: "Stremio Bridge (AIOStreams / Pengu)",
  version: "1.0.1",
  type: "movie",
  lang: "en",
  description:
    "Connects Stremio addons (AIOStreams, Pengu, etc.) to Zangetsu with automatic Cinemeta catalog/metadata resolution.",
  settings: SOURCE_SETTINGS,
  preferences: SOURCE_SETTINGS,
};

const CINEMETA_BASE = "https://v3-cinemeta.strem.io";
const TIMEOUT_MS = 15000;

function normalizeAddonBaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  return rawUrl
    .trim()
    .replace(/^stremio:\/\//i, "https://")
    .replace(/\/manifest\.json\/?$/i, "")
    .replace(/\/+$/, "");
}

function getConfig(runtimeSettings = {}) {
  const getSetting = (key, fallback) => {
    if (runtimeSettings && runtimeSettings[key] !== undefined && runtimeSettings[key] !== "") {
      return runtimeSettings[key];
    }
    if (typeof globalThis.getPreference === "function") {
      const val = globalThis.getPreference(key);
      if (val !== undefined && val !== null && val !== "") return val;
    }
    if (typeof globalThis.getSetting === "function") {
      const val = globalThis.getSetting(key);
      if (val !== undefined && val !== null && val !== "") return val;
    }
    if (globalThis.__settings && globalThis.__settings[key] !== undefined) {
      return globalThis.__settings[key];
    }
    return fallback;
  };

  const rawUrls = String(getSetting("addonUrls", DEFAULT_ADDON_URLS));
  const addonBases = rawUrls
    .split(",")
    .map(normalizeAddonBaseUrl)
    .filter(Boolean);

  return {
    addonBases: addonBases.length > 0 ? addonBases : [CINEMETA_BASE],
    excludeNonHttp: Boolean(getSetting("excludeNonHttp", true)),
    maxStreamsPerAddon: Number(getSetting("maxStreamsPerAddon", 25)) || 25,
  };
}

async function fetchJson(url, options = {}) {
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), TIMEOUT_MS)
    : null;

  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        Accept: "application/json",
        "User-Agent": "Zangetsu-Stremio-Bridge/1.0.1",
        ...(options.headers || {}),
      },
      signal: controller ? controller.signal : undefined,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildStremioUrl(baseUrl, resource, type, id, extra = "") {
  const cleanBase = normalizeAddonBaseUrl(baseUrl);
  const encodedId = encodeURIComponent(id);
  const extraSegment = extra ? `/${extra}` : "";
  return `${cleanBase}/${resource}/${encodeURIComponent(type)}/${encodedId}${extraSegment}.json`;
}

function mapStremioMetaToCard(meta) {
  const type = meta.type === "series" ? "series" : "movie";
  const compositeId = JSON.stringify({
    id: meta.id,
    type,
    tmdbId: meta.moviedb_id ? Number(meta.moviedb_id) : undefined,
    malId: meta.mal_id ? Number(meta.mal_id) : undefined,
  });

  return {
    id: compositeId,
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

  const str = String(rawId).trim();
  if (str.startsWith("{")) {
    return JSON.parse(str);
  }
  if (str.includes("|")) {
    const [type, id] = str.split("|");
    return { type: type === "series" ? "series" : "movie", id };
  }
  return { type: "movie", id: str };
}

async function getHome(runtimeSettings = {}) {
  const sections = [
    { title: "Popular Movies", type: "movie", catalogId: "top" },
    { title: "Popular Series", type: "series", catalogId: "top" },
    { title: "Top Rated Movies", type: "movie", catalogId: "imdbRating" },
    { title: "Top Rated Series", type: "series", catalogId: "imdbRating" },
  ];

  const results = await Promise.allSettled(
    sections.map(async (section) => {
      const url = buildStremioUrl(
        CINEMETA_BASE,
        "catalog",
        section.type,
        section.catalogId
      );
      const data = await fetchJson(url);
      const items = Array.isArray(data.metas)
        ? data.metas.slice(0, 25).map(mapStremioMetaToCard)
        : [];
      return {
        title: section.title,
        items,
      };
    })
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value.items.length > 0)
    .map((r) => r.value);
}

async function search(query, runtimeSettings = {}) {
  if (!query || !String(query).trim()) return [];
  const encodedQuery = `search=${encodeURIComponent(String(query).trim())}`;

  const [moviesRes, seriesRes] = await Promise.allSettled([
    fetchJson(buildStremioUrl(CINEMETA_BASE, "catalog", "movie", "top", encodedQuery)),
    fetchJson(buildStremioUrl(CINEMETA_BASE, "catalog", "series", "top", encodedQuery)),
  ]);

  const combined = [];
  if (moviesRes.status === "fulfilled" && Array.isArray(moviesRes.value.metas)) {
    combined.push(...moviesRes.value.metas.map(mapStremioMetaToCard));
  }
  if (seriesRes.status === "fulfilled" && Array.isArray(seriesRes.value.metas)) {
    combined.push(...seriesRes.value.metas.map(mapStremioMetaToCard));
  }

  return combined;
}

async function getDetail(rawId, runtimeSettings = {}) {
  const { id, type, tmdbId: hintTmdbId, malId: hintMalId } = parseItemId(rawId);
  const url = buildStremioUrl(CINEMETA_BASE, "meta", type, id);
  const data = await fetchJson(url);
  const meta = data && data.meta ? data.meta : {};

  const isSeries = (meta.type || type) === "series";
  const resolvedTmdbId = meta.moviedb_id ? Number(meta.moviedb_id) : hintTmdbId;
  const resolvedMalId = meta.mal_id ? Number(meta.mal_id) : hintMalId;

  let episodes = [];
  if (isSeries && Array.isArray(meta.videos)) {
    episodes = meta.videos
      .filter((v) => Number(v.season) > 0)
      .sort((a, b) => {
        if (Number(a.season) !== Number(b.season)) {
          return Number(a.season) - Number(b.season);
        }
        return Number(a.episode || a.number || 0) - Number(b.episode || b.number || 0);
      })
      .map((v) => {
        const epNum = Number(v.episode ?? v.number ?? 1);
        const seasonNum = Number(v.season ?? 1);
        const stremioVideoId = v.id || `${id}:${seasonNum}:${epNum}`;
        return {
          id: JSON.stringify({
            type: "series",
            videoId: stremioVideoId,
            season: seasonNum,
            episode: epNum,
          }),
          title: v.name || v.title || `Episode ${epNum}`,
          season: seasonNum,
          episode: epNum,
          number: epNum,
          thumbnail: v.thumbnail || meta.poster || "",
          overview: v.overview || v.description || "",
          released: v.released || null,
        };
      });
  } else {
    episodes = [
      {
        id: JSON.stringify({
          type: "movie",
          videoId: meta.id || id,
        }),
        title: meta.name || "Full Movie",
        season: 1,
        episode: 1,
        number: 1,
      },
    ];
  }

  const detailObj = {
    id: JSON.stringify({ id: meta.id || id, type: isSeries ? "series" : "movie" }),
    title: meta.name || "Untitled",
    poster: meta.poster || "",
    backdrop: meta.background || meta.poster || "",
    description: meta.description || "",
    year: meta.releaseInfo ? parseInt(String(meta.releaseInfo), 10) || null : null,
    genres: Array.isArray(meta.genres) ? meta.genres : [],
    type: isSeries ? "series" : "movie",
    episodes,
  };

  if (Number.isInteger(resolvedTmdbId) && resolvedTmdbId > 0) {
    detailObj.tmdbId = resolvedTmdbId;
    detailObj.tmdbIsTv = isSeries;
  }
  if (Number.isInteger(resolvedMalId) && resolvedMalId > 0) {
    detailObj.malId = resolvedMalId;
  }

  return detailObj;
}

function parseQualityLabel(stream) {
  const combined = `${stream.name || ""} ${stream.title || ""} ${stream.description || ""}`;
  const match = combined.match(/\b(2160p|4k|1080p|720p|480p|360p)\b/i);
  if (!match) return "Auto";
  const token = match[1].toUpperCase();
  return token === "4K" ? "2160p" : token;
}

function mapStremioStream(stream, addonBase, excludeNonHttp) {
  const directUrl = stream.url || stream.externalUrl || null;
  if (!directUrl && excludeNonHttp) {
    return null;
  }

  const headers =
    stream.behaviorHints &&
    stream.behaviorHints.proxyHeaders &&
    stream.behaviorHints.proxyHeaders.request
      ? stream.behaviorHints.proxyHeaders.request
      : {};

  const labelParts = [
    stream.name ? stream.name.replace(/\s+/g, " ").trim() : "Stremio",
    stream.title
      ? stream.title.split("\n")[0].trim()
      : stream.description
      ? stream.description.split("\n")[0].trim()
      : "",
  ].filter(Boolean);

  const subtitles = Array.isArray(stream.subtitles)
    ? stream.subtitles
        .filter((s) => s && s.url)
        .map((s) => ({
          url: s.url,
          lang: s.lang || "en",
          label: s.lang || "Subtitle",
        }))
    : [];

  return {
    name: labelParts.join(" — "),
    title: stream.title || stream.description || labelParts.join(" — "),
    quality: parseQualityLabel(stream),
    url: directUrl,
    infoHash: stream.infoHash || undefined,
    fileIdx: stream.fileIdx !== undefined ? stream.fileIdx : undefined,
    headers,
    subtitles,
    addonSource: addonBase,
    isHls: Boolean(directUrl && /\.m3u8(\?|$)/i.test(directUrl)),
  };
}

async function getStreams(rawEpisodeId, runtimeSettings = {}) {
  const config = getConfig(runtimeSettings);

  let videoId = rawEpisodeId;
  let mediaType = "movie";

  if (typeof rawEpisodeId === "string" && rawEpisodeId.trim().startsWith("{")) {
    const parsed = JSON.parse(rawEpisodeId);
    videoId = parsed.videoId || parsed.id;
    mediaType = parsed.type || (String(videoId).includes(":") ? "series" : "movie");
  } else if (typeof rawEpisodeId === "string" && rawEpisodeId.includes(":")) {
    mediaType = "series";
  }

  const streamAddonBases =
    config.addonBases.length > 1
      ? config.addonBases.filter((b) => !b.includes("v3-cinemeta.strem.io"))
      : config.addonBases;

  const queries = streamAddonBases.map(async (addonBase) => {
    const streamUrl = buildStremioUrl(addonBase, "stream", mediaType, videoId);
    const data = await fetchJson(streamUrl);
    const rawStreams = Array.isArray(data.streams)
      ? data.streams.slice(0, config.maxStreamsPerAddon)
      : [];
    return rawStreams
      .map((s) => mapStremioStream(s, addonBase, config.excludeNonHttp))
      .filter(Boolean);
  });

  const settled = await Promise.allSettled(queries);
  const seenUrls = new Set();
  const mergedStreams = [];

  for (const res of settled) {
    if (res.status === "fulfilled") {
      for (const item of res.value) {
        const dedupeKey = item.url || `${item.infoHash}:${item.fileIdx || 0}`;
        if (!seenUrls.has(dedupeKey)) {
          seenUrls.add(dedupeKey);
          mergedStreams.push(item);
        }
      }
    }
  }

  return mergedStreams;
}

function getSettings() {
  return SOURCE_SETTINGS;
}

const StremioBridgeProvider = {
  ...PROVIDER_META,
  getSettings,
  getPreferences: getSettings,
  getHome,
  search,
  getDetail,
  getStreams,
  getCatalog: getHome,
  getLinks: getStreams,
  normalizeAddonBaseUrl,
  buildStremioUrl,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = StremioBridgeProvider;
}
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
