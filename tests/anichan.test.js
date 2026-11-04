const assert = require("node:assert/strict");
const crypto = require("node:crypto");

// The host bridges AES-CTR. GCM is CTR + a tag, so this shim mirrors the host contract and lets the
// envelope test run under plain Node.
global.aesCtrDecrypt = function ({ keyHex, counterHex, dataB64 }) {
  const decipher = crypto.createDecipheriv(
    "aes-256-ctr",
    Buffer.from(keyHex, "hex"),
    Buffer.from(counterHex, "hex"),
  );
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
};

const PROVIDER_PATH = require.resolve("../providers/anichan.js");

// Load a fresh module per scenario so the in-memory session and keyset do not leak between tests.
function load() {
  delete require.cache[PROVIDER_PATH];
  return require(PROVIDER_PATH);
}

const DEFAULT_KEYSET = {
  id: "92b016e0",
  p: "Nq23HocDMsXkFF3dW8dfTUOED+FDkNv7i0D/oxwzeEA=",
  i: "xF6kQHsj25FisoW4XKizmYBdNIDyn83CldznQpfIjzw=",
};

const MEDIA = {
  id: 154587,
  idMal: 52991,
  title: {
    romaji: "Sousou no Frieren",
    english: "Frieren: Beyond Journey's End",
    native: "葬送のフリーレン",
    userPreferred: "Sousou no Frieren",
  },
  coverImage: { extraLarge: "https://img.example/frieren-xl.jpg", large: "https://img.example/frieren.jpg" },
  bannerImage: "https://img.example/frieren-banner.jpg",
  description: "An elf mage walks the world after the hero's party.",
  genres: ["Adventure", "Drama", "Fantasy"],
  seasonYear: 2023,
  status: "FINISHED",
  format: "TV",
  episodes: 28,
  nextAiringEpisode: null,
};

// Trimmed from live /api/watch/servers (2026-11); megaplay_hd1 and vidhawk must be dropped.
const SERVERS = {
  servers: [
    { name: "vidhawk", label: "vidHawk", type: "embed", rank: 8, stream: null },
    {
      name: "megaplay_hd1", label: "HD-1", type: "hls", rank: 4,
      stream: "https://c.toroplay.cymru/api/watch/m3u8?url=https%3A%2F%2Fmegap.mikora.top%2Fa",
      subtitles: [{ lang: "English", default: true, url: "https://s/mp-eng.vtt" }],
    },
    {
      name: "aniwatchtv", label: "zoko", type: "hls", rank: 3,
      stream: "https://c.toroplay.cymru/api/watch/m3u8?url=https%3A%2F%2Fhls2.aniwatchtv.uk%2Fv",
      subtitles: [{ lang: "English", default: true, url: "https://s/zoko-eng.vtt" }],
    },
    {
      name: "anichan", label: "★ AniChan", type: "hls", rank: 1,
      stream: "/api/watch/m3u8?sh=154587%2F1%2Fsub%2Fmaster.m3u8&sig=whANI&exp=1",
      subtitles: [
        { lang: "English", default: true, url: "https://s1.toroplay.click/154587/1/sub/subs/eng0.vtt?md5=a&expires=1" },
        { lang: "Spanish (Latin American)", default: false, url: "https://s1.toroplay.click/154587/1/sub/subs/spa1.vtt?md5=b&expires=1" },
      ],
    },
  ],
};

function response(body, status = 200, options = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => (options.setCookie && String(name).toLowerCase() === "set-cookie" ? options.setCookie : null),
      getSetCookie: () => (options.setCookie ? [options.setCookie] : []),
    },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const SESSION_COOKIE =
  "anichan_ws=1793784495.d08755c7c37c4b75.07d1d539047ef019.1d57dbb3626bcb79e8725065f3d55b3c; HttpOnly; Max-Age=7200; Path=/api/watch; SameSite=lax; Secure";
const NONCE = "gUzYxHCkjUCiMlR+XBO2Eg==";

function sessionResponse() {
  return response({ ok: true, exp: 1793784495, mode: "on", n: NONCE }, 200, { setCookie: SESSION_COOKIE });
}

// Inverse of the provider's envelope handling: AES-256-GCM over the JSON server list.
function encryptEnvelope(keyset, nonce, payload, iv) {
  const p = Buffer.from(keyset.p, "base64");
  const q = Buffer.from(keyset.i, "base64");
  const key0 = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) key0[i] = p[i] ^ q[i];
  const key = crypto.createHmac("sha256", key0).update(Buffer.from(nonce, "utf8")).digest();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    v: 1,
    i: iv.toString("base64"),
    d: Buffer.concat([body, cipher.getAuthTag()]).toString("base64"),
  };
}

async function main() {
  // ── search: AniList GraphQL resolves the title to an AniList id ────────────
  {
    const provider = load();
    global.fetch = async (url, init) => {
      if (String(url) === "https://graphql.anilist.co") {
        const body = JSON.parse(init.body);
        assert.deepEqual(body.variables, { search: "Frieren", page: 1 });
        return response({ data: { Page: { media: [MEDIA] } } });
      }
      return response({}, 404);
    };

    assert.equal(provider.getInfo().name, "AniChan");
    assert.equal(provider.getInfo().type, "anime");
    assert.equal(provider.getInfo().lang, "en");
    assert.deepEqual(await provider.search("f", 1, {}), []);

    const results = await provider.search("Frieren", 1, {});
    assert.equal(results.length, 1);
    assert.equal(results[0].id, "154587");
    assert.equal(results[0].url, "anichan://154587");
    assert.equal(results[0].title, "Frieren: Beyond Journey's End");
    assert.equal(results[0].cover, "https://img.example/frieren-xl.jpg");
    assert.equal(results[0].year, "2023");
    assert.equal(typeof results[0].year, "string");
  }

  // ── detail: AniChan's episode count + dub flag, enriched by AniList ────────
  {
    const provider = load();
    global.fetch = async (url, init) => {
      if (String(url) === "https://graphql.anilist.co") {
        const body = JSON.parse(init.body);
        assert.equal(body.variables.id, 154587);
        return response({ data: { Media: MEDIA } });
      }
      if (String(url).includes("/api/watch/episodes?anilistId=154587")) {
        return response({ episodes: 2, sources: [{ name: "anichan" }], dubAvailable: true });
      }
      return response({}, 404);
    };

    const detail = await provider.getDetail("anichan://154587", {});
    assert.equal(detail.title, "Frieren: Beyond Journey's End");
    assert.equal(detail.cover, "https://img.example/frieren-xl.jpg");
    assert.equal(detail.banner, "https://img.example/frieren-banner.jpg");
    assert.equal(detail.malId, 52991);
    assert.equal(detail.year, "2023");
    assert.equal(typeof detail.year, "string");
    assert.ok(detail.episodes.every((ep) => typeof ep.id === "string" && typeof ep.title === "string" &&
      typeof ep.url === "string" && typeof ep.number === "number"));
    assert.equal(detail.status, "finished");
    assert.deepEqual(detail.genres, ["Adventure", "Drama", "Fantasy"]);
    assert.equal(detail.subCount, 2);
    assert.equal(detail.dubCount, 2);
    assert.equal(detail.episodes.length, 4);
    assert.deepEqual(detail.episodes.map((ep) => ep.number), [1, 1, 2, 2]);
    assert.deepEqual(detail.episodes.map((ep) => ep.category), ["sub", "dub", "sub", "dub"]);
    assert.equal(detail.episodes[0].url, "anichan://154587/sub/1");
    assert.equal(detail.episodes[1].url, "anichan://154587/dub/1");

    const episodes = await provider.getEpisodes("anichan://154587", {});
    assert.equal(episodes.length, 4);

    // A title AniChan does not carry answers 200 with zero episodes; that must fail, not look empty.
    global.fetch = async (url, init) => {
      if (String(url) === "https://graphql.anilist.co") return response({ data: { Media: MEDIA } });
      if (String(url).includes("/api/watch/episodes")) return response({ episodes: 0, dubAvailable: null });
      return response({}, 404);
    };
    await assert.rejects(() => provider.getDetail("anichan://999", {}), /does not carry/);
    await assert.rejects(() => provider.getDetail("nonsense", {}), /invalid AniList id/);
  }

  // ── streams: tiered request, session cookie, X-Wk keyset, ranked servers ──
  {
    const provider = load();
    const calls = [];
    global.fetch = async (url, init) => {
      const requestUrl = String(url);
      calls.push({ url: requestUrl, init });
      if (requestUrl.endsWith("/api/watch/session")) {
        assert.equal(init.method, "POST");
        assert.equal(JSON.parse(init.body).token, "");
        return sessionResponse();
      }
      if (requestUrl.includes("/api/watch/servers")) {
        assert.equal(init.headers.Cookie, "anichan_ws=" + SESSION_COOKIE.split("=")[1].split(";")[0]);
        return response(SERVERS);
      }
      return response({}, 404);
    };

    const streams = await provider.getVideoSources("anichan://154587/sub/1", { category: "sub" });
    assert.equal(streams.length, 2);
    assert.deepEqual(streams.map((s) => s.quality), ["AniChan", "zoko"]);
    assert.equal(
      streams[0].url,
      "https://anichan.to/api/watch/m3u8?sh=154587%2F1%2Fsub%2Fmaster.m3u8&sig=whANI&exp=1",
    );
    assert.ok(streams[1].url.startsWith("https://c.toroplay.cymru/"));
    assert.ok(streams.every((s) => s.container === "hls"));
    assert.ok(streams.every((s) => s.kind === "sub"));
    assert.ok(streams.every((s) => s.audioLang === "ja"));
    assert.deepEqual(streams[0].subtitles.map((t) => t.lang), ["en", "es"]);
    assert.equal(streams[1].subtitles.length, 1);
    assert.ok(!streams.some((s) => /megaplay|vidhawk|HD-1|vidHawk/i.test(s.quality)));

    const serverCall = calls.find((c) => c.url.includes("/api/watch/servers"));
    assert.ok(serverCall.url.includes("&category=sub&tier=fast"), serverCall.url);
    assert.equal(serverCall.init.headers["X-Wk"], DEFAULT_KEYSET.id);
    assert.equal(serverCall.init.headers.Origin, "https://anichan.to");

    // The first non-empty tier is enough; the provider should not spend a request on `rest`.
    assert.equal(calls.filter((c) => c.url.includes("/api/watch/servers")).length, 1);
  }

  // ── encrypted server payload (GCM envelope) is decrypted ───────────────────
  {
    const provider = load();
    const iv = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const envelope = encryptEnvelope(DEFAULT_KEYSET, NONCE, { servers: [SERVERS.servers[3]] }, iv);
    global.fetch = async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/api/watch/session")) return sessionResponse();
      if (requestUrl.includes("/api/watch/servers")) return response(envelope);
      return response({}, 404);
    };

    const streams = await provider.getVideoSources("anichan://154587/sub/1", {});
    assert.equal(streams.length, 1);
    assert.equal(
      streams[0].url,
      "https://anichan.to/api/watch/m3u8?sh=154587%2F1%2Fsub%2Fmaster.m3u8&sig=whANI&exp=1",
    );
    assert.equal(streams[0].quality, "AniChan");
    assert.deepEqual(streams[0].subtitles.map((t) => t.lang), ["en", "es"]);
  }

  // ── an empty answer on the old key refreshes the keyset from the chunks ────
  {
    const provider = load();
    const freshKey = {
      id: "deadbeef",
      p: Buffer.alloc(32, 1).toString("base64"),
      i: Buffer.alloc(32, 2).toString("base64"),
    };
    const calls = [];
    global.fetch = async (url, init) => {
      const requestUrl = String(url);
      calls.push({ url: requestUrl, init });
      if (requestUrl.endsWith("/api/watch/session")) return sessionResponse();
      if (requestUrl === "https://anichan.to/") {
        return response("<script src=\"/_next/static/chunks/test-keyset.js\"></script>");
      }
      if (requestUrl === "https://anichan.to/_next/static/chunks/test-keyset.js") {
        return response(`var O="${freshKey.id}",k="${freshKey.p}",b="${freshKey.i}";`);
      }
      if (requestUrl.includes("/api/watch/servers")) {
        if (init.headers["X-Wk"] === freshKey.id) return response(SERVERS);
        return response({ servers: [] });
      }
      return response({}, 404);
    };

    const streams = await provider.getVideoSources("anichan://154587/sub/1", {});
    assert.equal(streams.length, 2);
    assert.ok(calls.some((c) => c.url === "https://anichan.to/"));
    assert.ok(calls.some((c) => c.url.endsWith("/_next/static/chunks/test-keyset.js")));
    assert.ok(calls.some((c) => c.init && c.init.headers && c.init.headers["X-Wk"] === freshKey.id));
  }

  // ── a stale cookie is replaced once and the request retried ────────────────
  {
    const provider = load();
    let sessions = 0;
    let serverCalls = 0;
    global.fetch = async (url, init) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/api/watch/session")) {
        sessions++;
        return sessionResponse();
      }
      if (requestUrl.includes("/api/watch/servers")) {
        serverCalls++;
        if (serverCalls === 1) return response({ error: "expired" }, 401);
        assert.ok(init.headers.Cookie);
        return response({ servers: [SERVERS.servers[3]] });
      }
      return response({}, 404);
    };

    const streams = await provider.getVideoSources("anichan://154587/sub/2", {});
    assert.equal(streams.length, 1);
    assert.equal(serverCalls, 2);
    assert.equal(sessions, 2);
  }

  // ── failures ──────────────────────────────────────────────────────────────
  {
    const provider = load();
    global.fetch = async (url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/api/watch/session")) return sessionResponse();
      if (requestUrl.includes("/api/watch/servers")) {
        return response({ servers: [{ name: "megaplay_hd1", stream: "https://x/" }, { name: "vidhawk", stream: null }] });
      }
      return response({}, 404);
    };
    await assert.rejects(
      () => provider.getVideoSources("anichan://154587/sub/1", {}),
      /no playable server/,
    );
    await assert.rejects(() => provider.getVideoSources("anichan://bad/sub/1", {}), /invalid episode URL/);
  }

  // A session that the site refuses must surface, not turn into "no servers".
  {
    const provider = load();
    global.fetch = async (url) => {
      if (String(url).endsWith("/api/watch/session")) return response({ detail: "turnstile" }, 403);
      return response({}, 404);
    };
    await assert.rejects(
      () => provider.getVideoSources("anichan://154587/sub/1", {}),
      /session HTTP 403/,
    );
  }

  console.log("AniChan AniList search, availability, tiers, keysets, envelope, session retry, and routing passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
