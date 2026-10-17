const assert = require("node:assert/strict");
const providers = [
  ["../providers/fourkhdhub.js", "4K HDHub", "1.0.6"]
];
for (const [path, name, version] of providers) {
  const provider = require(path);
  assert.equal(provider.getInfo().name, name);
  assert.equal(provider.version, version);
  assert.deepEqual(provider.getSettings(), []);
  for (const method of ["getHome", "search", "getDetail", "getEpisodes", "getVideoSources", "getStreams", "getLinks"]) {
    assert.equal(typeof provider[method], "function", name + " missing " + method);
  }
}
console.log("Standalone movie provider adapters and required methods passed.");
