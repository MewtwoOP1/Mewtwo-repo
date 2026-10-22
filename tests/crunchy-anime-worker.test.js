const assert = require("node:assert/strict");
const { createCipheriv, createHash, webcrypto } = require("node:crypto");

if (!globalThis.crypto || !globalThis.crypto.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

async function main() {
  const worker = await import("../workers/crunchy-anime-hls-proxy.mjs");

  const mediaId = "MEDIA-EP42";
  const realKey = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
  const derivedKey = createHash("sha256").update("key" + mediaId).digest().subarray(0, 16);
  const derivedIv = createHash("sha256").update("iv" + mediaId).digest().subarray(0, 16);
  const cipher = createCipheriv("aes-128-cbc", derivedKey, derivedIv);
  const wrappedPayload = Buffer.concat([cipher.update(realKey), cipher.final()]).toString("base64");

  const recovered = await worker.decryptWrappedKey(wrappedPayload, mediaId);
  assert.deepEqual(Buffer.from(recovered), realKey, "wrapped media key must decrypt to the 16-byte HLS key");
  await assert.rejects(() => worker.decryptWrappedKey(wrappedPayload, ""), /Missing media ID/);
  await assert.rejects(() => worker.decryptWrappedKey("%%%invalid%%%", mediaId));

  assert.equal(
    worker.validateUpstreamUrl("https://cdn.example/stream/master.m3u8"),
    "https://cdn.example/stream/master.m3u8",
  );
  assert.throws(() => worker.validateUpstreamUrl("http://cdn.example/stream.m3u8"), /HTTPS/);
  assert.throws(() => worker.validateUpstreamUrl("https://127.0.0.1/secret"), /HTTPS/);

  const origin = "https://proxy.example.workers.dev";
  const masterUrl = "https://cdn.example/vod/master.m3u8?sig=abc";
  const master = [
    "#EXTM3U",
    "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"English\",URI=\"audio/en.m3u8\"",
    "#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720",
    "variants/720.m3u8",
    "",
  ].join("\n");
  const rewrittenMaster = worker.rewritePlaylist(master, masterUrl, origin, mediaId, "secret");
  assert.ok(rewrittenMaster.includes("/m3u8?url="), "master child playlists must route through the Worker");
  assert.ok(rewrittenMaster.includes("mid=" + encodeURIComponent(mediaId)));
  assert.ok(rewrittenMaster.includes("token=secret"));
  assert.ok(rewrittenMaster.includes(encodeURIComponent("https://cdn.example/vod/variants/720.m3u8?sig=abc")));

  const media = [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:6",
    "#EXT-X-KEY:METHOD=AES-128,URI=\"keys/key.bin\"",
    "#EXTINF:6.0,",
    "segments/001.ts",
    "#EXT-X-ENDLIST",
  ].join("\n");
  const rewrittenMedia = worker.rewritePlaylist(
    media, "https://cdn.example/vod/variant/index.m3u8?sig=abc", origin, mediaId, "secret",
  );
  assert.ok(rewrittenMedia.includes("/key?url="), "AES key URL must be rewritten to the key recovery route");
  assert.ok(rewrittenMedia.includes(encodeURIComponent("https://cdn.example/vod/variant/keys/key.bin")));
  assert.ok(rewrittenMedia.includes("https://cdn.example/vod/variant/segments/001.ts"));

  const oldFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (url, options) => {
    const upstreamUrl = String(url);
    upstreamCalls.push({ url: upstreamUrl, options: options || {} });
    if (upstreamUrl === masterUrl) {
      return new Response(master, {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    }
    if (upstreamUrl === "https://cdn.example/vod/keys/key.bin") {
      assert.equal(options.headers["x-am-media-id"], mediaId, "key request must include x-am-media-id");
      return new Response(wrappedPayload, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const unauthorized = await worker.handleRequest(
      new Request(origin + "/m3u8?url=" + encodeURIComponent(masterUrl) + "&mid=" + mediaId + "&token=wrong"),
      { PROXY_TOKEN: "secret" },
    );
    assert.equal(unauthorized.status, 401);

    const response = await worker.handleRequest(
      new Request(origin + "/m3u8?url=" + encodeURIComponent(masterUrl) + "&mid=" + mediaId + "&token=secret"),
      { PROXY_TOKEN: "secret" },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /mpegurl/);
    assert.match(await response.text(), /\/m3u8\?url=/);

    const keyUrl = "https://cdn.example/vod/keys/key.bin";
    const keyResponse = await worker.handleRequest(
      new Request(origin + "/key?url=" + encodeURIComponent(keyUrl) + "&mid=" + mediaId + "&token=secret"),
      { PROXY_TOKEN: "secret" },
    );
    assert.equal(keyResponse.status, 200);
    assert.deepEqual(Buffer.from(await keyResponse.arrayBuffer()), realKey);
    assert.ok(upstreamCalls.some(call => call.url === keyUrl));
  } finally {
    globalThis.fetch = oldFetch;
  }

  console.log("Crunchy-anime HLS proxy key decryption, auth, URL validation and playlist rewriting tests passed.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
