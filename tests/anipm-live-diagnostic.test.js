const nativeFetch = global.fetch.bind(global);
const trace = [];
global.htmlText = function (s) {
  return String(s || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
};
global.fetch = async function (url, options) {
  options = options || {};
  if (trace.length >= 14) { trace.push({ url: String(url), error: "diagnostic request cap reached" }); return { status: 599, body: "" }; }
  try {
    const response = await nativeFetch(String(url), {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
      signal: AbortSignal.timeout(4000),
      redirect: "follow"
    });
    const body = await response.text();
    const safeUrl = String(url).replace(/([?&]t=)[^&#]+/g, "$1REDACTED");
    trace.push({ url: safeUrl, status: response.status, type: response.headers.get("content-type") || "",
      prefix: body.slice(0, 120).replace(/\s+/g, " ") });
    return { status: response.status, body: body };
  } catch (e) {
    trace.push({ url: String(url).replace(/([?&]t=)[^&#]+/g, "$1REDACTED"), error: String(e).slice(0, 180) });
    return { status: 0, body: "" };
  }
};
const provider = require("../providers/anipm.js");
async function main() {
  const search = await provider.search("Frieren", 1, {});
  console.log("[LIVE] search count:", search.length, search.slice(0, 3).map(x => ({ title: x.title, url: x.url })));
  if (search.length) {
    const detail = await provider.getDetail(search[0].url, { category: "sub" });
    console.log("[LIVE] detail:", detail && { title: detail.title, episodeCount: detail.episodes && detail.episodes.length,
      firstEpisode: detail.episodes && detail.episodes[0] && detail.episodes[0].url });
    if (detail && detail.episodes && detail.episodes.length) {
      const streams = await provider.getVideoSources(detail.episodes[0].url, {});
      console.log("[LIVE] streams:", streams.map(s => ({ label: s.label,
        url: String(s.url).replace(/([?&]token=)[^&#]+/g, "$1REDACTED"), quality: s.quality,
        container: s.container, headers: s.headers })));
    }
  }
  console.log("[LIVE] request trace:", JSON.stringify(trace, null, 2));
}
main().catch(e => { console.log("[LIVE] diagnostic exception:", String(e)); console.log(JSON.stringify(trace, null, 2)); });
