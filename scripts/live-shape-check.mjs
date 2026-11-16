// Checks that the Gotaku provider still opens the sealed episode payload when
// the host delivers it the way the Zangetsu app does, rather than as bytes.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeFetch = global.fetch;

const shape = process.argv[2] || "bytes";
global.fetch = async (url, init = {}) => {
  const options = {
    method: init.method || "GET",
    headers: init.headers || {},
    redirect: init.followRedirects === false ? "manual" : "follow",
  };
  if (init.timeoutMs) options.signal = AbortSignal.timeout(init.timeoutMs);
  const response = await nativeFetch(String(url), options);
  const buffer = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries(response.headers.entries());
  const isJson = String(headers["content-type"] || "").includes("json");
  if (isJson) {
    return { status: response.status, body: buffer.toString("utf8"), headers, url: response.url, text: async () => buffer.toString("utf8"), json: async () => JSON.parse(buffer.toString("utf8") || "null") };
  }
  // The sealed answer: deliver it the way the chosen shape says.
  let body = buffer.toString("utf8");
  if (shape === "list") body = "[" + Array.from(buffer).join(", ") + "]";
  else if (shape === "latin1") body = buffer.toString("latin1");
  else if (shape === "base64") body = buffer.toString("base64");
  return { status: response.status, body, headers, url: response.url, text: async () => body };
};

global.__SOURCE_ID = "gotaku";
global.__settings = { gotaku: {} };
const provider = require(path.join(rootDir, "providers", "gotaku.js"));

const results = await provider.search("frieren", 1, {});
console.log("shape:", shape, "| search results:", results.length, "|", results[0] && results[0].title);
if (!results.length) process.exit(1);
const detail = await provider.getDetail(results[0].url, {});
console.log("  title:", detail.title, "| episodes:", detail.episodes.length, "| first:", detail.episodes[0] && detail.episodes[0].title);
console.log("  subtitle track:", detail.episodes[0] && detail.episodes[0].url);
if (!detail.episodes.length) process.exit(1);
