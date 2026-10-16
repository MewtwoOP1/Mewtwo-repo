const assert = require("node:assert/strict");
const provider = require("../providers/stremio-bridge.js");

assert.equal(
  provider.normalizeAddonBaseUrl("https://example.com/addon/manifest.json"),
  "https://example.com/addon"
);
assert.equal(
  provider.normalizeAddonBaseUrl("stremio://example.com/addon/manifest.json"),
  "https://example.com/addon"
);
assert.equal(provider.normalizeAddonBaseUrl("javascript:alert(1)"), "");

const config = provider.getConfig({
  addonUrls: "https://one.example/manifest.json, https://two.example/addon/manifest.json",
  excludeNonHttp: true,
  maxStreamsPerAddon: 12,
});
assert.deepEqual(config.addonBases, [
  "https://one.example",
  "https://two.example/addon",
]);
assert.equal(config.excludeNonHttp, true);
assert.equal(config.maxStreamsPerAddon, 12);

const direct = provider.mapStremioStream(
  { name: "1080p", url: "https://cdn.example/video.m3u8" },
  "https://addon.example",
  true
);
assert.equal(direct.url, "https://cdn.example/video.m3u8");
assert.equal(direct.isHls, true);

assert.equal(
  provider.mapStremioStream(
    { name: "External link", externalUrl: "https://example.com/watch" },
    "https://addon.example",
    true
  ),
  null,
  "externalUrl must not be treated as a playable direct stream"
);
assert.equal(
  provider.mapStremioStream(
    { name: "Torrent", infoHash: "0123456789abcdef" },
    "https://addon.example",
    true
  ),
  null
);
assert.equal(
  provider.mapStremioStream(
    { name: "Torrent", infoHash: "0123456789abcdef" },
    "https://addon.example",
    false
  ).infoHash,
  "0123456789abcdef"
);

console.log("Stremio bridge unit tests passed.");
