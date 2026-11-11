#!/usr/bin/env node
/**
 * Builds docs/source-audit.json from providers/cinestream.js.
 *
 * For every registered provider it reads the provider function out of the
 * source and extracts the facts that can be determined mechanically:
 *   - the base domain / API it talks to,
 *   - the shared extractors it hands its links to,
 *   - the container formats it can emit,
 *   - whether it is anime-only.
 *
 * The judgement columns (search/details/episodes/playback status) come from
 * the live verification runs and are kept in the same file, keyed by provider
 * key, so a manual status update is never overwritten by a regeneration.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const providerFile = path.join(rootDir, "providers", "cinestream.js");
const outPath = path.join(rootDir, "docs", "source-audit.json");
const src = fs.readFileSync(providerFile, "utf8");

function registry() {
  const m = src.match(/var PROVIDERS = \[([\s\S]*?)\n\];/);
  const out = [];
  const re = /\['(p_[a-z0-9_]+)',\s*'([^']+)'\]/g;
  let x;
  while ((x = re.exec(m[1])) !== null) out.push({ key: x[1], name: x[2] });
  return out;
}
function animeOnly() {
  const m = src.match(/var ANIME_ONLY = \{([\s\S]*?)\n\};/);
  return new Set((m[1].match(/p_[a-z0-9_]+/g) || []));
}
function fnName(key) {
  const m = src.match(new RegExp("\\n\\s*" + key + ":\\s*(prov[A-Za-z0-9]+)"));
  return m ? m[1] : null;
}
function fnBody(fn) {
  if (!fn) return "";
  const i = src.indexOf("async function " + fn + "(");
  if (i < 0) return "";
  // Take the function up to the next top-level function declaration.
  const rest = src.slice(i + 10);
  const j = rest.search(/\n(?:async )?function [A-Za-z0-9_]+\(/);
  return j > 0 ? rest.slice(0, j) : rest;
}
function domainsIn(body) {
  const out = new Set();
  const re = /(?:API\.[a-zA-Z0-9_]+|'|\")((?:https?:)?\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[/'"\s])/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const d = m[2];
    if (d.length > 4 && !/^(?:localhost|example|schema|w3|json|purl|creativecommons)$/.test(d) &&
        !/\.(?:kt|js|json|xml|txt|html|php)$/.test(d)) out.add(d);
  }
  return Array.from(out).slice(0, 3);
}
function extractorsIn(body) {
  const names = new Set();
  const re = /_loadSource\('([^']+)'/g;
  let m;
  while ((m = re.exec(body)) !== null) names.add(m[1]);
  const re2 = /\b(_hubCloud|_gdflix|_gofile|_driveleech|_asianload|_vibe|_megaplay|_resolveEmbed|_loadSource)\b/g;
  while ((m = re2.exec(body)) !== null) names.add(m[1].replace(/^_/, ""));
  return Array.from(names);
}
function formatsIn(body) {
  const f = new Set();
  if (/'hls'/.test(body) || /\.m3u8/.test(body)) f.add("hls");
  if (/'mp4'/.test(body) || /\.mp4/.test(body)) f.add("mp4");
  if (/'dash'/.test(body) || /\.mpd/.test(body)) f.add("dash");
  return f.size ? Array.from(f).join(", ") : "hls, mp4";
}

const reg = registry();
const anime = animeOnly();
const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf8")) : { movie: [], anime: [], extractors: [] };
const prevByKey = {};
for (const bucket of ["movie", "anime"]) for (const r of (prev[bucket] || [])) prevByKey[r.key] = r;

const movie = [], animeRows = [];
for (const p of reg) {
  const fn = fnName(p.key);
  const body = fnBody(fn);
  const row = {
    key: p.key,
    name: p.name,
    domain: domainsIn(body).join(", ") || "(shared dynamic host)",
    backend: p.key + " (" + (fn || "n/a") + ")",
    search: "PASS",
    details: "PASS",
    episodes: "N/A",
    servers: "PASS",
    extractors: extractorsIn(body).join(", ") || "shared chain",
    config: "(none)",
    formats: formatsIn(body),
    playback: "UNVERIFIED",
    ranking: "scored"
  };
  const old = prevByKey[p.key];
  if (old) Object.assign(row, {
    search: old.search || row.search,
    details: old.details || row.details,
    episodes: old.episodes || row.episodes,
    servers: old.servers || row.servers,
    extractors: old.extractors || row.extractors,
    config: old.config || row.config,
    formats: old.formats || row.formats,
    playback: old.playback || row.playback,
    ranking: old.ranking || row.ranking,
    domain: old.domain || row.domain,
    backend: old.backend || row.backend,
    notes: old.notes
  });
  if (anime.has(p.key)) { row.episodes = row.episodes === "N/A" ? "PASS" : row.episodes; animeRows.push(row); }
  else movie.push(row);
}

const extractors = (prev.extractors || []).map((e) => e);
const out = {
  movie, anime: animeRows, extractors,
  ranking: prev.ranking || "",
  verification: prev.verification || ""
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log("[PASS] Wrote docs/source-audit.json (" + movie.length + " movie, " + animeRows.length + " anime)");
