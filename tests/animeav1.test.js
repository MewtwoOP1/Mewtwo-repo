const assert = require("node:assert/strict");

const provider = require("../providers/animeav1.js");

// Fixtures are trimmed from live __data.json responses (Frieren, 2026-09) and keep SvelteKit's
// devalue flattening: objects hold indices into the flat data array, and -1 means null.
const SEARCH = `{"type":"data","nodes":[null,{"type":"data","data":[{"user":1},null]},{"type":"data","data":[{"results":1,"total":17},[2,9],{"id":3,"title":4,"categoryId":5,"slug":6,"category":7},"3560","Sousou no Frieren 2nd Season",1,"sousou-no-frieren-2nd-season",{"id":5,"slug":8},"tv-anime",{"id":10,"title":11,"categoryId":5,"slug":12,"category":7},"159","Sousou no Frieren","sousou-no-frieren"]}]}`;

const MEDIA = `{"type":"data","nodes":[null,{"type":"data","data":[{"user":1},null]},{"type":"data","data":[{"media":1},{"id":2,"title":3,"malId":4,"episodes":5,"nextDate":-1},159,"Sousou no Frieren",52991,[6,9,12,15],{"id":7,"number":8},2047,2,{"id":10,"number":11},2051,3,{"id":13,"number":14},2060,1,{"id":16,"number":17},2099,12.5]}]}`;

// Build a SvelteKit page from a plain object, mirroring devalue's reference flattening.
function page(root) {
  const flat = [];
  function add(value) {
    if (value && typeof value === "object") {
      const index = flat.length;
      flat.push(null);
      if (Array.isArray(value)) flat[index] = value.map(add);
      else {
        const out = {};
        for (const key of Object.keys(value)) out[key] = add(value[key]);
        flat[index] = out;
      }
      return index;
    }
    const index = flat.length;
    flat.push(value);
    return index;
  }
  add(root);
  return JSON.stringify({ nodes: [{ type: "data", data: flat }] });
}

function rot13(text) {
  return String(text).replace(/[A-Za-z]/g, (c) => {
    const o = c.charCodeAt(0);
    if (o >= 65 && o <= 90) return String.fromCharCode(((o - 65 + 13) % 26) + 65);
    return String.fromCharCode(((o - 97 + 13) % 26) + 97);
  });
}

// Inverse of the provider's VOE decoder.
function encodeVoe(config) {
  const base64 = (text) => Buffer.from(text, "latin1").toString("base64");
  const x = base64(JSON.stringify(config));
  const r = x.split("").reverse().join("");
  const y = r.split("").map((c) => String.fromCharCode(c.charCodeAt(0) + 3)).join("");
  return rot13(base64(y));
}

const VOE_HTML = `<html><body><script type="application/json">${JSON.stringify([
  encodeVoe({ source: "https://cdn.voe.example/hls/master.m3u8", title: "Frieren 1" }),
])}</script></body></html>`;

const YOUROLOAD_HTML =
  '<html><head><meta property="og:video" content="https://vidcache.net:8161/a2026/video.mp4"></head></html>';

const SUB_PAGE = page({
  episode: { number: 1, variants: { SUB: 1, DUB: 1 } },
  embeds: {
    SUB: [
      { server: "MP4Upload", url: "https://www.mp4upload.com/embed-cujiyz2jez93.html" },
      { server: "VOE", url: "https://voe.sx/e/abc123" },
      { server: "YourUpload", url: "https://www.yourupload.com/embed/sub1" },
    ],
    DUB: [{ server: "YourUpload", url: "https://www.yourupload.com/embed/dub1" }],
  },
});

const UNSUPPORTED_PAGE = page({
  episode: { number: 2, variants: { SUB: 1 } },
  embeds: {
    SUB: [
      { server: "UPNShare", url: "https://animeav1.uns.bio/#i9i8gq" },
      { server: "MP4Upload", url: "https://www.mp4upload.com/embed-2.html" },
    ],
  },
});

const EMPTY_PAGE = page({ episode: { number: 3, variants: {} }, embeds: { SUB: [] } });

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
  };
}

async function main() {
  const calls = [];
  global.fetch = async (url) => {
    const requestUrl = String(url);
    calls.push(requestUrl);

    if (requestUrl.includes("/catalogo/__data.json?search=Sousou%20no%20Frieren")) return response(SEARCH);
    if (requestUrl.endsWith("/catalogo/__data.json")) return response(SEARCH);
    if (requestUrl.endsWith("/media/sousou-no-frieren/__data.json")) return response(MEDIA);
    if (requestUrl.endsWith("/media/sousou-no-frieren/1/__data.json")) return response(SUB_PAGE);
    if (requestUrl.endsWith("/media/sousou-no-frieren/2/__data.json")) return response(UNSUPPORTED_PAGE);
    if (requestUrl.endsWith("/media/sousou-no-frieren/3/__data.json")) return response(EMPTY_PAGE);
    if (requestUrl.includes("voe.sx")) return response(VOE_HTML);
    if (requestUrl.includes("yourupload.com")) return response(YOUROLOAD_HTML);
    return response("", 404);
  };

  assert.equal(provider.getInfo().name, "AnimeAV1");
  assert.equal(provider.getInfo().type, "anime");
  assert.equal(provider.getInfo().lang, "es");

  // ── search ────────────────────────────────────────────────────────────────
  assert.deepEqual(await provider.search("", 1, {}), []);
  assert.deepEqual(await provider.search("x", 2, {}), []);

  const results = await provider.search("Sousou no Frieren", 1, {});
  assert.equal(results.length, 2);
  assert.equal(results[0].id, "sousou-no-frieren-2nd-season");
  assert.equal(results[0].title, "Sousou no Frieren 2nd Season");
  assert.equal(results[1].id, "sousou-no-frieren");

  const home = await provider.getHome();
  assert.equal(home.length, 1);
  assert.equal(home[0].items.length, 2);

  // ── detail ────────────────────────────────────────────────────────────────
  const detail = await provider.getDetail("sousou-no-frieren", {});
  assert.equal(detail.title, "Sousou no Frieren");
  assert.equal(detail.malId, 52991);
  assert.deepEqual(detail.episodes.map((ep) => ep.number), [1, 2, 3]);
  assert.equal(detail.episodes[0].url, "animeav1://sousou-no-frieren/1");

  const episodes = await provider.getEpisodes("animeav1://sousou-no-frieren", {});
  assert.deepEqual(episodes.map((ep) => ep.number), [1, 2, 3]);

  // ── sub stream: VOE is ranked above YourUpload and MP4Upload is not faked ──
  const sub = await provider.getVideoSources("animeav1://sousou-no-frieren/1", { category: "sub" });
  assert.equal(sub.length, 1);
  assert.equal(sub[0].url, "https://cdn.voe.example/hls/master.m3u8");
  assert.equal(sub[0].container, "hls");
  assert.equal(sub[0].quality, "VOE");
  assert.equal(sub[0].kind, "sub");
  assert.equal(sub[0].audioLang, "ja");
  assert.equal(sub[0].audio, null);

  // ── dub stream: YourUpload's og:video, with the host's Referer ────────────
  const dub = await provider.getVideoSources("animeav1://sousou-no-frieren/1", { category: "dub" });
  assert.equal(dub.length, 1);
  assert.equal(dub[0].url, "https://vidcache.net:8161/a2026/video.mp4");
  assert.equal(dub[0].container, "mp4");
  assert.equal(dub[0].kind, "dub");
  assert.equal(dub[0].audioLang, "es");
  assert.equal(dub[0].audio, "Spanish");
  assert.equal(dub[0].headers.Referer, "https://www.yourupload.com/");

  // ── hosts the repo cannot extract are skipped, and an all-unsupported page fails ─
  await assert.rejects(
    () => provider.getVideoSources("animeav1://sousou-no-frieren/2", { category: "sub" }),
    /no resolvable host/,
  );
  await assert.rejects(
    () => provider.getVideoSources("animeav1://sousou-no-frieren/3", { category: "sub" }),
    /no SUB embeds/,
  );
  await assert.rejects(() => provider.getVideoSources("animeav1://sousou-no-frieren/0", {}), /invalid episode URL/);

  // ── malformed page data ───────────────────────────────────────────────────
  global.fetch = async () => response("{}");
  await assert.rejects(() => provider.getDetail("broken", {}), /no page data/);
  assert.deepEqual(await provider.search("anything", 1, {}), []);

  console.log("AnimeAV1 devalue parsing, search, detail, VOE/YourUpload resolution, and skips passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
