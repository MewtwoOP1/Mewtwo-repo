#!/usr/bin/env node
'use strict';

// Local companion for Zangetsu's JS provider. Uniquestream serves AES-wrapped
// key.bin files, so a normal HLS URL rewrite is not enough. This proxy rewrites
// playlists and decrypts each AES-128 segment before handing it to mpv.
//
// Run on the same Android device as Zangetsu:
//   node scripts/uniquestream-proxy.cjs
//
// The server binds only to loopback and validates HTTPS targets (including DNS
// addresses and redirects) to avoid turning this helper into an open proxy.
const http = require('node:http');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');

const SITE = 'https://anime.uniquestream.net';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const HOST = '127.0.0.1';
const PORT = 8787;
const keyCache = new Map();

function encode(value) { return encodeURIComponent(String(value)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest(); }

function isPublicIp(value) {
  let ip = String(value || '').toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const version = net.isIP(ip);
  if (version === 4) {
    const n = ip.split('.').map(Number);
    const a = n[0], b = n[1], c = n[2];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (version === 6) {
    if (ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') ||
        ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') ||
        ip.startsWith('feb') || ip.startsWith('ff')) return false;
    return true;
  }
  return false;
}

async function validateHttpsUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch (_) { throw new Error('Invalid upstream URL'); }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Only credential-free HTTPS upstream URLs are allowed');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')) throw new Error('Private upstream host blocked');
  if (net.isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error('Private upstream IP blocked');
  } else {
    let records;
    try { records = await dns.lookup(hostname, { all: true, verbatim: true }); }
    catch (_) { throw new Error('Could not resolve upstream host'); }
    if (!records.length || records.some((record) => !isPublicIp(record.address))) {
      throw new Error('Upstream host resolves to a private or reserved address');
    }
  }
  return url;
}

async function fetchUpstream(rawUrl, mediaId, extraHeaders) {
  let url = String(rawUrl);
  for (let redirects = 0; redirects <= 5; redirects++) {
    await validateHttpsUrl(url);
    const headers = {
      'User-Agent': UA,
      'Accept': '*/*',
      'Referer': SITE + '/',
      'Origin': SITE,
      ...(extraHeaders || {})
    };
    if (mediaId) headers['x-am-media-id'] = mediaId;
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(25000)
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 5) throw new Error('Upstream redirect limit exceeded');
      url = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new Error('Upstream returned HTTP ' + response.status);
    return response;
  }
  throw new Error('Upstream redirect limit exceeded');
}

function parseAttributes(line) {
  const out = {};
  const body = line.substring(line.indexOf(':') + 1);
  const re = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match;
  while ((match = re.exec(body)) !== null) out[match[1]] = match[2] !== undefined ? match[2] : match[3].trim();
  return out;
}

function localUrl(base, path, params) {
  const query = new URLSearchParams();
  Object.keys(params).forEach((key) => {
    if (params[key] !== undefined && params[key] !== null && params[key] !== '') query.set(key, String(params[key]));
  });
  return base + path + '?' + query.toString();
}

function resolveUri(uri, playlistUrl) {
  const resolved = new URL(String(uri).trim(), playlistUrl);
  if (resolved.protocol !== 'https:' || resolved.username || resolved.password) {
    throw new Error('Playlist contains a non-HTTPS URI');
  }
  return resolved.toString();
}

function rewritePlaylist(content, playlistUrl, mediaId, base) {
  if (!String(content).trimStart().startsWith('#EXTM3U')) throw new Error('Upstream did not return an HLS playlist');
  const lines = String(content).replace(/^\uFEFF/, '').split(/\r?\n/);
  const master = lines.some((line) => line.startsWith('#EXT-X-STREAM-INF:'));
  if (master) {
    let waitingForVariant = false;
    return lines.map((line) => {
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        waitingForVariant = true;
        return line;
      }
      if (line.startsWith('#EXT-X-MEDIA:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
        return line.replace(/URI="([^"]+)"/, (_, uri) =>
          'URI="' + localUrl(base, '/playlist.m3u8', { url: resolveUri(uri, playlistUrl), mid: mediaId }) + '"');
      }
      if (waitingForVariant && line.trim() && !line.startsWith('#')) {
        waitingForVariant = false;
        return localUrl(base, '/playlist.m3u8', { url: resolveUri(line, playlistUrl), mid: mediaId });
      }
      if (line.trim() && !line.startsWith('#')) return localUrl(base, '/playlist.m3u8', { url: resolveUri(line, playlistUrl), mid: mediaId });
      return line;
    }).join('\n');
  }

  let mediaSequence = 0;
  let sequence = 0;
  let currentKey = null;
  const result = [];
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      const parsed = Number(line.substring(line.indexOf(':') + 1).trim());
      mediaSequence = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
      sequence = mediaSequence;
      result.push(line);
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line);
      if (String(attrs.METHOD || '').toUpperCase() === 'AES-128' && attrs.URI) {
        currentKey = { url: resolveUri(attrs.URI, playlistUrl), iv: attrs.IV || '' };
        // This HLS provider expects the proxy to decrypt segments itself.
      } else {
        currentKey = null;
        result.push(line);
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line);
      if (!attrs.URI) { result.push(line); continue; }
      const params = { url: resolveUri(attrs.URI, playlistUrl), mid: mediaId, seq: sequence, map: '1' };
      if (currentKey) { params.key = currentKey.url; params.iv = currentKey.iv || undefined; }
      result.push(line.replace(/URI="([^"]+)"/, 'URI="' + localUrl(base, '/segment', params) + '"'));
    } else if (line.trim() && !line.startsWith('#')) {
      const params = { url: resolveUri(line, playlistUrl), mid: mediaId, seq: sequence };
      if (currentKey) { params.key = currentKey.url; params.iv = currentKey.iv || undefined; }
      result.push(localUrl(base, '/segment', params));
      sequence++;
    } else {
      result.push(line);
    }
  }
  return result.join('\n');
}

function decryptWrappedKey(base64Body, mediaId) {
  const wrapped = Buffer.from(String(base64Body).trim().replace(/\s+/g, ''), 'base64');
  if (!wrapped.length || wrapped.length % 16 !== 0) throw new Error('Invalid encrypted key payload');
  const key = sha256('key' + mediaId).subarray(0, 16);
  const iv = sha256('iv' + mediaId).subarray(0, 16);
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  const plain = Buffer.concat([decipher.update(wrapped), decipher.final()]);
  if (plain.length !== 16) throw new Error('Decrypted media key is not 16 bytes');
  return plain;
}

async function fetchRealKey(keyUrl, mediaId) {
  const cacheKey = mediaId + '|' + keyUrl;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  const response = await fetchUpstream(keyUrl, mediaId);
  const key = decryptWrappedKey(await response.text(), mediaId);
  if (keyCache.size > 128) keyCache.clear();
  keyCache.set(cacheKey, key);
  return key;
}

function normalizeIv(iv, sequence) {
  let hex = String(iv || '').replace(/^0x/i, '').trim();
  if (!hex) hex = BigInt(Math.max(0, Number(sequence) || 0)).toString(16);
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length > 32) throw new Error('Invalid HLS AES IV');
  return Buffer.from(hex.padStart(32, '0'), 'hex');
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' });
    return res.end();
  }
  let requestUrl;
  try { requestUrl = new URL(req.url, 'http://' + HOST + ':' + PORT); }
  catch (_) { res.writeHead(400); return res.end('Bad request'); }
  if (requestUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end('uniquestream-proxy-ok');
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end('Method not allowed'); }
  try {
    const rawUrl = requestUrl.searchParams.get('url') || '';
    const mid = requestUrl.searchParams.get('mid') || '';
    if (!rawUrl || !/^[A-Za-z0-9_-]{1,128}$/.test(mid)) throw new Error('Missing or invalid url/media id');
    const base = 'http://' + HOST + ':' + PORT;
    if (requestUrl.pathname === '/playlist.m3u8') {
      const upstream = await fetchUpstream(rawUrl, mid);
      const rewritten = rewritePlaylist(await upstream.text(), rawUrl, mid, base);
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.end(rewritten);
    }
    if (requestUrl.pathname === '/segment') {
      const upstream = await fetchUpstream(rawUrl, mid, req.headers.range ? { Range: req.headers.range } : {});
      let data = Buffer.from(await upstream.arrayBuffer());
      const keyUrl = requestUrl.searchParams.get('key');
      if (keyUrl) {
        const key = await fetchRealKey(keyUrl, mid);
        const iv = normalizeIv(requestUrl.searchParams.get('iv'), requestUrl.searchParams.get('seq'));
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        data = Buffer.concat([decipher.update(data), decipher.final()]);
      }
      const headers = {
        'Content-Type': requestUrl.searchParams.has('map') ? 'video/mp4' : 'video/mp2t',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      };
      if (upstream.headers.get('content-range')) headers['Content-Range'] = upstream.headers.get('content-range');
      if (upstream.headers.get('accept-ranges')) headers['Accept-Ranges'] = upstream.headers.get('accept-ranges');
      res.writeHead(upstream.status === 206 ? 206 : 200, headers);
      return res.end(data);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  } catch (error) {
    const status = /HTTP 4\d\d/.test(String(error && error.message)) ? 502 : 502;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('Uniquestream proxy error: ' + String(error && error.message || error).slice(0, 400));
  }
}

function start() {
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => {
    console.log('Uniquestream HLS proxy listening at http://' + HOST + ':' + PORT);
    console.log('Keep this process running while watching in Zangetsu.');
  });
  server.on('error', (error) => {
    console.error('Uniquestream proxy failed:', error.message);
    process.exitCode = 1;
  });
  return server;
}

if (require.main === module) start();
module.exports = { rewritePlaylist, decryptWrappedKey, isPublicIp, validateHttpsUrl, normalizeIv };
