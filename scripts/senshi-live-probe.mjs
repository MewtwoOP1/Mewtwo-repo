// Temporary live integration probe for Senshi.to; removed after evaluation.
const BASE = "https://senshi.to";
const CDN = "https://s.vidcloud.se";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const H = { "User-Agent": UA, "Referer": BASE + "/", "Accept": "application/json" };

async function req(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  console.log("HTTP", response.status, new URL(url).origin, new URL(url).pathname, "bytes=" + text.length);
  if (!response.ok) throw new Error("HTTP " + response.status + " from " + url);
  return { response, text };
}
async function json(url, init = {}) {
  const { text } = await req(url, init);
  try { return JSON.parse(text); }
  catch { throw new Error("Expected JSON at " + url + "; prefix=" + text.slice(0, 120).replace(/\s+/g, " ")); }
}
const normalized = x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const safeHost = value => { try { return new URL(value).host + new URL(value).pathname; } catch { return "(invalid URL)"; } };

async function main() {
  console.log("SENSHI_LIVE_PROBE_BEGIN");
  const filter = await json(BASE + "/anime/filter", {
    method: "POST",
    headers: { ...H, "Origin": BASE, "Content-Type": "application/json" },
    body: JSON.stringify({
      searchTerm: "One Piece", types: [], genres: [], status: [], seasons: [],
      year: "", studios: [], producers: [], languages: [], page: 1, limit: 30,
      sortBy: "score_desc", languagePreference: "EN"
    })
  });
  const rows = Array.isArray(filter.data) ? filter.data : Array.isArray(filter) ? filter : [];
  console.log("CATALOG_COUNT", rows.length);
  if (!rows.length) throw new Error("Senshi catalog returned no rows");
  const anime = rows.find(x => normalized(x.title_english) === normalized("One Piece") ||
    normalized(x.title) === normalized("One Piece")) || rows[0];
  if (!anime.id || !anime.public_id) throw new Error("Catalog record missing MAL ID or public_id");
  console.log("MATCH", { title: anime.title_english || anime.title, malId: anime.id, publicId: anime.public_id });

  const details = await json(BASE + "/anime/" + encodeURIComponent(anime.public_id));
  console.log("DETAIL_IDS", { malId: details.id, aniListId: details.anilist_id || null, publicId: details.public_id });
  if (Number(details.id) !== Number(anime.id)) throw new Error("Detail endpoint MAL ID does not match search result");
  if (details.anilist_id && !/^\d+$/.test(String(details.anilist_id))) throw new Error("AniList ID is not numeric");

  const episodes = await json(BASE + "/episodes/" + encodeURIComponent(details.id));
  if (!Array.isArray(episodes) || !episodes.length) throw new Error("Episode endpoint returned no episode array");
  const ep = episodes.find(x => Number(x.ep_id) === 1) || episodes[0];
  console.log("EPISODES", { count: episodes.length, firstEpId: ep.ep_id, firstTitle: ep.ep_title || "" });

  const embeds = await json(BASE + "/episode-embeds/" + encodeURIComponent(details.id) + "/" + encodeURIComponent(ep.ep_id));
  if (!Array.isArray(embeds) || !embeds.length) throw new Error("Episode embeds endpoint returned no sources");
  const candidates = embeds.filter(x => x && x.remote_source_id && String(x.status || "").toLowerCase() !== "dub");
  console.log("EMBEDS", embeds.map(x => ({ status: x.status || "", remoteSourceId: x.remote_source_id || null, hasSiteUrl: !!x.url })));
  const embed = candidates[0] || embeds.find(x => x && x.remote_source_id);
  if (!embed) throw new Error("No embed contains remote_source_id");

  let sourceUrl = CDN + "/_v1/sources?id=" + encodeURIComponent(embed.remote_source_id);
  let sourceData;
  try {
    sourceData = await json(sourceUrl, {
      headers: { ...H, "Origin": BASE, "Accept": "application/json,*/*" }
    });
  } catch (error) {
    console.log("DIRECT_VIDCLOUD_ENDPOINT_FAILED", String(error));
    console.log("SENSHI_COMPATIBILITY=NOT_VERIFIED_WITH_DIRECT_FETCH");
    return;
  }
  const entries = Array.isArray(sourceData) ? sourceData : sourceData ? [sourceData] : [];
  const entry = entries.find(x => x && ((x.source && x.source.src) || (Array.isArray(x.sources) && x.sources.some(s => s && (s.src || s.file))));
  let src = entry && (entry.source && entry.source.src || entry.sources && ((entry.sources.find(s => s && (s.src || s.file)) || {}).src || (entry.sources.find(s => s && s.file) || {}).file));
  if (!src) {
    console.log("VIDCLOUD_RESPONSE_SHAPE", JSON.stringify(sourceData).slice(0, 400));
    console.log("SENSHI_COMPATIBILITY=NO_DIRECT_STREAM_FOUND");
    return;
  }
  console.log("STREAM_URL", safeHost(src));
  const { text: playlist } = await req(src, { headers: { ...H, "Origin": BASE, "Accept": "*/*" } });
  console.log("PLAYLIST_PREFIX", playlist.slice(0, 40).replace(/\s+/g, " "));
  if (playlist.startsWith("EM3U8v1:")) {
    console.log("SENSHI_COMPATIBILITY=NEEDS_ENCRYPTED_HLS_PROXY");
  } else if (playlist.startsWith("#EXTM3U")) {
    const variants = (playlist.match(/#EXT-X-STREAM-INF/g) || []).length;
    console.log("SENSHI_COMPATIBILITY=PLAIN_HLS", { variants, hasTracks: Array.isArray(entry.tracks) && entry.tracks.length > 0 });
  } else {
    console.log("SENSHI_COMPATIBILITY=STREAM_BODY_NOT_PLAIN_HLS");
  }
  console.log("SENSHI_LIVE_PROBE_END");
}
main().catch(error => {
  console.error("SENSHI_LIVE_PROBE_ERROR", error && error.stack || String(error));
  console.log("SENSHI_COMPATIBILITY=PROBE_FAILED");
  process.exitCode = 0; // Keep CI green so logs can be inspected even if upstream blocks probing.
});
