// Temporary public-site inspection helper. Fetches public HTML and JavaScript
// assets only. It does not execute the target site's scripts or submit credentials.
const START = [
  "https://almostott.aethoflix.world/",
  "https://almostott.vercel.app/",
  "https://aethoflix.world/"
];
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const MAX_FILES = 55, MAX_FILE_BYTES = 2000000, MAX_TOTAL_BYTES = 18000000;
const visited = new Set(), queue = [];
let totalBytes = 0;
function out(s = "") { console.log(String(s)); }
function uniq(xs) { return [...new Set(xs)]; }
function clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }
function absolute(raw, base) { try { return new URL(raw, base).href; } catch { return ""; } }
function addScriptUrl(raw, base) {
  const u = absolute(raw, base);
  if (u && /\.(?:m?js)(?:$|\?)/i.test(u) && !visited.has(u) && !queue.includes(u)) queue.push(u);
}
function htmlAssets(html, base) {
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) addScriptUrl(m[1], base);
  for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+\.m?js(?:\?[^"']*)?)["']/gi)) addScriptUrl(m[1], base);
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+\.m?js(?:\?[^"']*)?)["']/gi)) addScriptUrl(m[1], base);
}
function outputHtmlFacts(url, html, finalUrl, status, ctype) {
  out("\n=== PAGE " + url + " ===");
  out("HTTP " + status + " final=" + finalUrl + " content-type=" + ctype + " chars=" + html.length);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1];
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i) ||
                html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [,""])[1];
  out("TITLE: " + clean(title).slice(0,300));
  out("DESCRIPTION: " + clean(desc).slice(0,500));
  const iframes = uniq([...html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)/gi)].map(m => absolute(m[1], finalUrl)).filter(Boolean));
  out("IFRAMES: " + JSON.stringify(iframes.slice(0,30)));
  const hrefs = uniq([...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(m => absolute(m[1], finalUrl)).filter(x => x && /^https?:/.test(x)));
  out("EXTERNAL HOSTS: " + JSON.stringify(uniq(hrefs.map(x => { try { return new URL(x).hostname; } catch { return ""; } })).slice(0,80)));
  const hints = [];
  for (const re of [/__NEXT_DATA__[\s\S]{0,500}/ig, /__next_f\.push[\s\S]{0,280}/ig, /VITE_[A-Z0-9_]+/g, /NEXT_PUBLIC_[A-Z0-9_]+/g, /firebase[a-zA-Z0-9.-]*/g, /supabase[a-zA-Z0-9.-]*/g]) {
    for (const m of html.matchAll(re)) hints.push(clean(m[0]).slice(0,350));
  }
  out("BOOTSTRAP HINTS:\n" + (uniq(hints).slice(0,25).join("\n") || "(none)"));
  const scriptBlocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc\s*=/i.test(m[1]) && m[2].length > 500);
  out("INLINE SCRIPT BLOCKS: " + scriptBlocks.length + " lens=" + JSON.stringify(scriptBlocks.map(m => m[2].length).sort((a,b)=>b-a).slice(0,15)));
  const bigScripts = scriptBlocks.map(m => m[2]).sort((a,b)=>b.length-a.length).slice(0,4);
  for (let i = 0; i < bigScripts.length; i++) {
    const js = bigScripts[i];
    out("\nINLINE JS #" + (i+1) + " chars=" + js.length);
    const hostnames = uniq([...js.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[:\/?#"'\\s])/gi)].map(m => m[1].toLowerCase()));
    out("JS HOSTS: " + JSON.stringify(hostnames.slice(0,100)));
    const routeStrings = [];
    const literal = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
    for (const m of js.matchAll(literal)) {
      const s = m[0].slice(1,-1).replace(/\\\//g,"/");
      if (s.length < 260 && /(?:\/api\/|api\.tmdb\.org|api\.themoviedb\.org|livetgtv|graphql|\/3\/(?:search|movie|tv|discover|trending|find)|youtube|youtube-nocookie|player|embed|stream|episode|source|watch|jiotv|supabase|firebase|ott)/i.test(s)) routeStrings.push(s);
    }
    out("LIKELY API/PLAYER STRINGS:\n" + uniq(routeStrings).slice(0,180).map(s=>s.replace(/([?&](?:api[_-]?key|token|authorization)=)[^&\s"'\\]+/gi,"$1[REDACTED]").replace(/((?:api[_-]?key|apiKey)\s*[:=]\s*["'])[^"']+(["'])/gi,"$1[REDACTED]$2")).join("\n"));
    const contexts = [];
    for (const m of js.matchAll(/(?:api\.tmdb\.org|api\.themoviedb\.org|livetgtv\.lovable\.app|fetch\s*\(|axios(?:\.[a-z]+)?\s*\(|XMLHttpRequest|\/api\/|graphql|iframe|player|embed|stream|videoSources|watchProviders|jiotv)/ig)) {
      const ctx = js.slice(Math.max(0,m.index-170), Math.min(js.length,m.index+420));
      contexts.push(ctx.replace(/\s+/g," ").replace(/([?&](?:api[_-]?key|token|authorization)=)[^&\s"'\\]+/gi,"$1[REDACTED]").slice(0,650));
    }
    out("NETWORK/PLAYER CONTEXTS:\n" + uniq(contexts).slice(0,100).join("\n---\n"));
  }
  htmlAssets(html, finalUrl);
}
function extractStrings(js) {
  const strings = [];
  const literal = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
  for (const m of js.matchAll(literal)) {
    const s = m[0].slice(1,-1).replace(/\\\//g, "/");
    if (s.length > 1 && s.length < 260 && /(?:\/api\/|https?:\/\/|graphql|tmdb|movie|series|anime|episode|watch|stream|source|embed|player|trailer|firebase|supabase|workers\.dev|vercel\.app|ott|jiotv|apiKey|api_key)/i.test(s)) strings.push(s);
  }
  return uniq(strings).slice(0,120);
}
function extractContexts(js) {
  const found = [];
  const re = /(?:fetch\s*\(|axios(?:\.[a-z]+)?\s*\(|XMLHttpRequest|baseURL|API_URL|\/api\/|graphql|iframe|player|embed|stream|videoSources|watchProviders|api_key|apiKey)/ig;
  for (const m of js.matchAll(re)) found.push(clean(js.slice(Math.max(0,m.index-120),Math.min(js.length,m.index+260))).slice(0,400));
  return uniq(found).slice(0,65);
}
for (const start of START) {
  try {
    const r = await fetch(start, {headers:{ "User-Agent":UA, "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}, signal:AbortSignal.timeout(15000), redirect:"follow"});
    const html = await r.text();
    outputHtmlFacts(start, html, r.url, r.status, r.headers.get("content-type") || "");
  } catch (e) { out("\n=== PAGE " + start + " ERROR === " + e.message); }
}
let processed = 0;
while (queue.length && processed < MAX_FILES && totalBytes < MAX_TOTAL_BYTES) {
  const url = queue.shift();
  if (!url || visited.has(url)) continue;
  visited.add(url);
  try {
    const r = await fetch(url, {headers:{"User-Agent":UA,"Accept":"application/javascript,text/javascript,*/*;q=0.8"}, signal:AbortSignal.timeout(12000), redirect:"follow"});
    const ctype = r.headers.get("content-type") || "";
    if (!r.ok || !/javascript|ecmascript|text\/plain|octet-stream/i.test(ctype)) { out("\n=== ASSET SKIP === " + url + " HTTP=" + r.status + " type=" + ctype); continue; }
    const bytes = new Uint8Array(await r.arrayBuffer());
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) { out("\n=== ASSET TOO LARGE === " + url + " bytes=" + bytes.byteLength); continue; }
    const js = new TextDecoder().decode(bytes);
    processed++;
    out("\n=== JS ASSET #" + processed + " === " + url + " final=" + r.url + " bytes=" + bytes.byteLength);
    out("API/PLAYER STRINGS:\n" + extractStrings(js).join("\n"));
    out("REQUEST/PLAYER CONTEXTS:\n" + extractContexts(js).join("\n---\n"));
    for (const m of js.matchAll(/(["'])([^"']{1,240}\.m?js(?:\?[^"']*)?)\1/g)) addScriptUrl(m[2], r.url);
  } catch (e) { out("\n=== ASSET ERROR === " + url + " :: " + e.message); }
}

// Probe publicly advertised resolver JSON shapes, without saving signed URLs.
async function publicJsonProbe(label, url, headers = {}) {
  try {
    const r = await fetch(url, {headers:{"User-Agent":UA,"Accept":"application/json",...headers}, signal:AbortSignal.timeout(12000), redirect:"follow"});
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    const redactUrl = v => typeof v === "string" ? v.replace(/([?&](?:token|key|sig|signature|expires|api_key|auth)=)[^&\s]+/gi,"$1[REDACTED]") : v;
    function summarize(v, depth=0) {
      if (Array.isArray(v)) return {type:"array",length:v.length,first:v.length?summarize(v[0],depth+1):null};
      if (v && typeof v==="object") {
        const o={}; for (const [k,val] of Object.entries(v).slice(0,30)) {
          if (depth>3) {o[k]=typeof val;continue;}
          if (typeof val==="string") o[k]=redactUrl(val).slice(0,250);
          else o[k]=summarize(val,depth+1);
        } return o;
      }
      return typeof v==="string" ? redactUrl(v).slice(0,250) : v;
    }
    out("\n=== PUBLIC API PROBE "+label+" === HTTP="+r.status+" type="+(r.headers.get("content-type")||"")+" final="+r.url+" chars="+txt.length);
    out(JSON.stringify(j ? summarize(j) : txt.slice(0,500)));
    return j;
  } catch (e) { out("\n=== PUBLIC API PROBE "+label+" ERROR === "+e.message); return null; }
}
const movieEnc = await publicJsonProbe("VidLink movie ID encoder","https://enc-dec.app/api/enc-vidlink?text=550");
const movieEncId = movieEnc && (movieEnc.result || movieEnc.data?.result);
if (typeof movieEncId === "string" && movieEncId.length > 0 && movieEncId.length < 300) {
  await publicJsonProbe("VidLink movie resolver with movie ID","https://vidlink.pro/api/b/movie/"+encodeURIComponent(movieEncId)+"?multiLang=0",{"Referer":"https://vidlink.pro/","Origin":"https://vidlink.pro"});
}
const enc = await publicJsonProbe("VidLink ID encoder","https://enc-dec.app/api/enc-vidlink?text=105248");
const encId = enc && (enc.result || enc.data?.result);
if (typeof encId === "string" && encId.length > 0 && encId.length < 300) {
  await publicJsonProbe("VidLink movie endpoint","https://vidlink.pro/api/b/movie/"+encodeURIComponent(encId)+"?multiLang=0",{"Referer":"https://vidlink.pro/","Origin":"https://vidlink.pro"});
  await publicJsonProbe("VidLink TV endpoint","https://vidlink.pro/api/b/tv/"+encodeURIComponent(encId)+"/1/1?multiLang=0",{"Referer":"https://vidlink.pro/","Origin":"https://vidlink.pro"});
}
await publicJsonProbe("TMDB mirror endpoint","https://api.tmdb.org/3/movie/550");

out("\n=== SUMMARY ===");
out("visited=" + visited.size + " processed=" + processed + " bytes=" + totalBytes + " queuedRemaining=" + queue.length);
