const assert = require("node:assert/strict");
const provider = require("../providers/anipm.js");

const calls = [];
const MEDIA = {
  id: 154587,
  idMal: 52991,
  title: {
    english: "Frieren: Beyond Journey's End",
    romaji: "Sousou no Frieren",
    native: "葬送のフリーレン"
  },
  coverImage: { large: "https://img.example/frieren.jpg" },
  description: "An elf mage travels on.",
  episodes: 28,
  status: "FINISHED",
  format: "TV",
  seasonYear: 2023,
  startDate: { year: 2023 },
  genres: ["Adventure", "Fantasy"],
  studios: { nodes: [{ name: "Madhouse" }] }
};

function response(status, body) {
  return {
    status: status,
    ok: status >= 200 && status < 300,
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
}

global.fetch = async function(url, options) {
  url = String(url);
  options = options || {};
  calls.push({ url: url, options: options });

  if (url === "https://graphql.anilist.co" && options.method === "POST") {
    const payload = JSON.parse(options.body || "{}");
    if (payload.variables && payload.variables.search) {
      assert.match(payload.query, /media\(search:\s*\$search,\s*type:\s*ANIME/);
      return response(200, {
        data: {
          Page: {
            media: [
              MEDIA,
              {
                id: 999999,
                idMal: 888888,
                title: { english: "Unavailable Sample", romaji: "Unavailable Sample" },
                coverImage: { large: "https://img.example/unavailable.jpg" }
              }
            ]
          }
        }
      });
    }
    if (payload.variables && payload.variables.id === 154587) {
      return response(200, { data: { Media: MEDIA } });
    }
  }

  if (url === "https://ani.pm/api/anime/anipm-server/_packages?anilistId=154587") {
    return response(200, {
      episodes: {
        "1": { sub: true, dub: true },
        "2": { sub: true, dub: false },
        "0": { sub: true, dub: true },
        "special": { sub: true, dub: true },
        "3": { sub: false, dub: false }
      }
    });
  }
  if (url === "https://ani.pm/api/anime/anipm-server/_packages?anilistId=999999") {
    return response(404, { message: "not found" });
  }

  if (url === "https://ani.pm/api/anime/playback-bootstrap/anilist/154587?ep=1&lang=sub&core=0") {
    return response(200, {
      effectiveLanguage: "sub",
      settlarSelection: "selection /?with spaces",
      skip: {
        op: { start: 80, end: 110 },
        ed: { start: 1300, end: 1350 }
      }
    });
  }
  if (url === "https://ani.pm/api/anime/settlar/session?selection=selection%20%2F%3Fwith%20spaces&provider=anipm&ep=1&channel=sub&telemetry=0") {
    return response(200, {
      embedUrl: "https://embed.settlar.io/embed/v1?t=token%2Bpart%2Fone"
    });
  }
  if (url === "https://embed.settlar.io/api/embed/session?t=token%2Bpart%2Fone") {
    return response(200, {
      source: "https://media.settlar.io/frieren/master.m3u8",
      kind: "hls",
      subtitles: [
        { url: "https://media.settlar.io/subs/english.vtt", srclang: "eng", label: "English", default: true },
        { url: "https://media.settlar.io/subs/indonesian.srt", srclang: "ind", label: "Indonesian", default: false },
        { url: "http://insecure.example/not-allowed.vtt", srclang: "eng", label: "Insecure" }
      ]
    });
  }

  if (url === "https://ani.pm/api/anime/playback-bootstrap/anilist/154587?ep=1&lang=dub&core=0") {
    return response(200, {
      effectiveLanguage: "dub",
      settlarSelection: "dub-selection"
    });
  }
  if (url === "https://ani.pm/api/anime/settlar/session?selection=dub-selection&provider=anipm&ep=1&channel=dub&telemetry=0") {
    return response(200, {
      embedUrl: "https://embed.settlar.io/embed/v1?t=dub-token"
    });
  }
  if (url === "https://embed.settlar.io/api/embed/session?t=dub-token") {
    return response(200, {
      source: "https://media.settlar.io/frieren/dub/master.m3u8",
      kind: "hls",
      subtitles: []
    });
  }

  if (url === "https://ani.pm/api/anime/playback-bootstrap/anilist/154587?ep=2&lang=sub&core=0") {
    return response(200, {
      effectiveLanguage: "dub",
      settlarSelection: "wrong-audio-selection"
    });
  }

  return response(404, { message: "not found" });
};

async function main() {
  assert.equal(provider.version, "1.0.1");
  assert.equal(provider.getInfo().name, "Ani.pm");
  assert.equal(provider.getInfo().version, "1.0.1");
  assert.equal(provider.getInfo().baseUrl, "https://ani.pm");
  assert.deepEqual(provider.getSettings(), []);
  assert.deepEqual(await provider.getHome({}), []);
  assert.deepEqual(await provider.popular({}), []);

  assert.deepEqual(await provider.search("", 1, {}), []);
  const found = await provider.search("Frieren", 1, { category: "sub" });
  assert.equal(found.length, 1, "titles without an Ani.pm package inventory must be excluded");
  assert.equal(found[0].id, "154587");
  assert.equal(found[0].title, "Frieren: Beyond Journey's End");
  assert.equal(found[0].cover, "https://img.example/frieren.jpg");
  assert.equal(found[0].malId, 52991);
  assert.equal(found[0].url, "anipm://154587");

  const detail = await provider.getDetail(found[0].url, { category: "sub" });
  assert.equal(detail.title, "Frieren: Beyond Journey's End");
  assert.equal(detail.malId, 52991);
  assert.equal(detail.status, "completed");
  assert.deepEqual(detail.studios, ["Madhouse"]);
  assert.equal(detail.subCount, 2);
  assert.equal(detail.dubCount, 1);
  assert.deepEqual(detail.episodes.map(ep => ep.number), [1, 2]);
  assert.equal(detail.episodes[0].url, "anipm-episode://154587/1/sub");

  const dubDetail = await provider.getDetail(found[0].url, { category: "dub" });
  assert.deepEqual(dubDetail.episodes.map(ep => ep.number), [1]);
  assert.equal(dubDetail.episodes[0].url, "anipm-episode://154587/1/dub");

  const listed = await provider.getEpisodes(found[0].url, { category: "sub" });
  assert.deepEqual(listed.map(ep => ep.number), [1, 2]);

  const subStreams = await provider.getVideoSources(detail.episodes[0].url, {});
  assert.equal(subStreams.length, 1);
  assert.equal(subStreams[0].url, "https://media.settlar.io/frieren/master.m3u8");
  assert.equal(subStreams[0].container, "hls");
  assert.equal(subStreams[0].kind, "sub");
  assert.equal(subStreams[0].subtitles.length, 2);
  assert.equal(subStreams[0].subtitles[0].lang, "en");
  assert.equal(subStreams[0].subtitles[0].default, true);
  assert.equal(subStreams[0].subtitles[1].lang, "id");
  assert.equal(subStreams[0].subtitles[1].format, "srt");
  assert.equal(subStreams[0].headers, undefined, "Anilili does not add Referer/cookie headers to Settlar streams");

  const dubStreams = await provider.getStreams(dubDetail.episodes[0].url, {});
  assert.equal(dubStreams.length, 1);
  assert.equal(dubStreams[0].kind, "dub");
  assert.equal(dubStreams[0].url, "https://media.settlar.io/frieren/dub/master.m3u8");

  await assert.rejects(
    provider.getVideoSources("anipm-episode://154587/2/sub", {}),
    /has no sub for episode 2/
  );

  const apiCalls = calls.filter(call => call.url.indexOf("https://ani.pm/") === 0
    || call.url.indexOf("https://embed.settlar.io/") === 0);
  assert.ok(apiCalls.length > 0);
  for (const call of apiCalls) {
    assert.match(call.options.headers["User-Agent"], /Android 14.*Chrome\/137/);
    assert.equal(call.options.headers.Referer, undefined);
    assert.equal(call.options.headers.Cookie, undefined);
  }
  assert.ok(calls.some(call => call.url === "https://ani.pm/api/anime/anipm-server/_packages?anilistId=154587"));
  assert.ok(calls.some(call => call.url.indexOf("/api/anime/playback-bootstrap/anilist/154587?ep=1&lang=sub&core=0") >= 0));
  assert.ok(calls.some(call => call.url.indexOf("/api/anime/settlar/session?selection=") >= 0));
  assert.ok(calls.some(call => call.url === "https://embed.settlar.io/api/embed/session?t=token%2Bpart%2Fone"));
  const settlarEmbedCall = calls.find(call =>
    call.url === "https://embed.settlar.io/api/embed/session?t=token%2Bpart%2Fone");
  assert.ok(settlarEmbedCall, "Settlar embed session request should be made");
  assert.equal(settlarEmbedCall.options.nativeHttp, true,
    "Settlar embed session must opt into Zangetsu's native OkHttp bridge");

  console.log("Ani.pm Anilili-flow tests passed: AniList mapping, package inventory, SUB/DUB, Settlar and subtitles.");
}

main().catch(function(error) {
  console.error(error);
  process.exitCode = 1;
});
