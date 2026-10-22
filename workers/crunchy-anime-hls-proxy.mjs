// Cloudflare Worker for UniqueStream/AnimeStream wrapped HLS keys.
// Deploy this file as a Worker and set PROXY_TOKEN as a Worker secret.
// The client provider passes its configured HLS proxy URL and matching token.
//
// Required routes:
//   /m3u8?url=<playlist>&mid=<media_id>&token=<secret>
//   /key?url=<key.bin>&mid=<media_id>&token=<secret>
//
// This intentionally proxies playlists and keys only. Media segments stay on
// their original HTTPS CDN URL, matching the official UniqueStream proxy flow.

const SITE_ORIGIN = 'https://anime.uniquestream.net';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function corsHeaders(extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range, X-Crunchy-Proxy-Token',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Cache-Control': 'no-store'
  }, extra || {});
}

function response(body, status, type, extra) {
  return new Response(body, {
    status: status || 200,
    headers: corsHeaders(Object.assign({ 'Content-Type': type || 'text/plain; charset=utf-8' }, extra || {}))
  });
}

function decodeBase64Bytes(value) {
  var clean = String(value || '').trim().replace(/-/g, '+').replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean || clean.length % 4 === 1) throw new Error('Invalid Base64 key payload');
  while (clean.length % 4) clean += '=';
  var binary;
  try { binary = atob(clean); } catch (e) { throw new Error('Invalid Base64 key payload'); }
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function _isPrivateHost(host) {
  var h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(h)) return true;
  var m = h.match(/^172\.(\d+)\./);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return h === '::1' || h === '0:0:0:0:0:0:0:1' || /^f[cd][0-9a-f]:/i.test(h) || /^fe[89ab][0-9a-f]:/i.test(h);
}

export function validateUpstreamUrl(value) {
  var u;
  try { u = new URL(String(value || '')); } catch (e) { throw new Error('Invalid upstream URL'); }
  if (u.protocol !== 'https:' || u.username || u.password || _isPrivateHost(u.hostname)) {
    throw new Error('Only public HTTPS media URLs are allowed');
  }
  return u.toString();
}

async function _sha256(value) {
  return new Uint8Array(await globalThis.crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(String(value))
  ));
}

// key.bin is Base64 text containing AES-CBC ciphertext. The real 16-byte HLS
// content key is encrypted using SHA256("key" + mediaId)[0..15] and
// SHA256("iv" + mediaId)[0..15], as in the upstream UniqueStream extension.
export async function decryptWrappedKey(base64Payload, mediaId) {
  var mid = String(mediaId || '').trim();
  if (!mid) throw new Error('Missing media ID');
  var ciphertext = decodeBase64Bytes(base64Payload);
  if (!ciphertext.length || ciphertext.length % 16 !== 0) {
    throw new Error('Invalid wrapped HLS key length');
  }
  var keyDigest = await _sha256('key' + mid);
  var ivDigest = await _sha256('iv' + mid);
  var key = await globalThis.crypto.subtle.importKey(
    'raw', keyDigest.slice(0, 16), { name: 'AES-CBC' }, false, ['decrypt']
  );
  var clear = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: ivDigest.slice(0, 16) }, key, ciphertext
  );
  var bytes = new Uint8Array(clear);
  if (bytes.length !== 16) throw new Error('Recovered HLS key is not 16 bytes');
  return bytes;
}

function _workerUrl(origin, route, upstreamUrl, mediaId, token) {
  var u = new URL(route, origin);
  u.searchParams.set('url', upstreamUrl);
  u.searchParams.set('mid', mediaId);
  u.searchParams.set('token', token);
  return u.toString();
}

function _absolute(uri, base) {
  try { return new URL(String(uri || '').trim(), base).toString(); }
  catch (e) { return String(uri || '').trim(); }
}

function _rewriteUriAttribute(line, mapper) {
  return line.replace(/URI="([^"]+)"/i, function (_whole, uri) {
    return 'URI="' + mapper(uri) + '"';
  });
}

// Master variant/audio/subtitle playlists are routed back through /m3u8 so
// any key references in child playlists are rewritten too. AES key references
// go through /key; media segment URLs are made absolute and remain on the CDN.
export function rewritePlaylist(content, playlistUrl, workerOrigin, mediaId, token) {
  var master = String(content || '').indexOf('#EXT-X-STREAM-INF:') >= 0;
  var pendingVariant = false;
  var lines = String(content || '').split(/\r?\n/);
  return lines.map(function (raw) {
    var line = raw.trim();
    if (!line) return raw;

    if (line.indexOf('#EXT-X-STREAM-INF:') === 0) {
      pendingVariant = true;
      return raw;
    }

    if (line.charAt(0) === '#') {
      if (/^#EXT-X-(?:KEY|SESSION-KEY):/i.test(line)) {
        return _rewriteUriAttribute(raw, function (uri) {
          var absolute = _absolute(uri, playlistUrl);
          return _workerUrl(workerOrigin, '/key', absolute, mediaId, token);
        });
      }

      if (master && /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF):/i.test(line)) {
        return _rewriteUriAttribute(raw, function (uri) {
          var absolute = _absolute(uri, playlistUrl);
          return _workerUrl(workerOrigin, '/m3u8', absolute, mediaId, token);
        });
      }

      // EXT-X-MAP / PART / PRELOAD-HINT may contain relative resources. Keep
      // them on the CDN, but resolve them against the playlist's actual URL.
      if (/^#EXT-X-(?:MAP|PART|PRELOAD-HINT):/i.test(line)) {
        return _rewriteUriAttribute(raw, function (uri) {
          return _absolute(uri, playlistUrl);
        });
      }
      return raw;
    }

    var absoluteLine = _absolute(line, playlistUrl);
    if (master && pendingVariant) {
      pendingVariant = false;
      return _workerUrl(workerOrigin, '/m3u8', absoluteLine, mediaId, token);
    }
    return absoluteLine;
  }).join('\n');
}

async function _fetchUpstream(url, mediaId, isKey) {
  var headers = {
    'Accept': isKey ? '*/*' : 'application/vnd.apple.mpegurl,application/x-mpegURL,*/*',
    'Referer': SITE_ORIGIN + '/',
    'Origin': SITE_ORIGIN,
    'User-Agent': USER_AGENT
  };
  if (isKey) headers['x-am-media-id'] = mediaId;
  return fetch(url, { method: 'GET', headers: headers, redirect: 'follow' });
}

export async function handleRequest(request, env) {
  env = env || {};
  var incoming = new URL(request.url);

  if (request.method === 'OPTIONS') return response('', 204, 'text/plain; charset=utf-8');
  if (incoming.pathname === '/health') {
    return response(JSON.stringify({ ok: true, tokenConfigured: Boolean(env.PROXY_TOKEN) }), 200, 'application/json; charset=utf-8');
  }
  if (!['GET', 'HEAD'].includes(request.method)) return response('Method not allowed', 405);
  if (!env.PROXY_TOKEN) return response('Worker is not configured: set the PROXY_TOKEN secret', 503);
  var token = incoming.searchParams.get('token') || request.headers.get('X-Crunchy-Proxy-Token') || '';
  if (token !== env.PROXY_TOKEN) return response('Unauthorized', 401);

  var upstreamUrl, mediaId;
  try {
    upstreamUrl = validateUpstreamUrl(incoming.searchParams.get('url'));
    mediaId = String(incoming.searchParams.get('mid') || '').trim();
    if (!mediaId) throw new Error('Missing media ID');
  } catch (e) {
    return response(e.message || 'Invalid request', 400);
  }

  if (incoming.pathname !== '/m3u8' && incoming.pathname !== '/key') {
    return response('Not found', 404);
  }

  try {
    var upstream = await _fetchUpstream(upstreamUrl, mediaId, incoming.pathname === '/key');
    if (!upstream.ok) return response('Upstream returned HTTP ' + upstream.status, 502);
    if (incoming.pathname === '/key') {
      var encoded = await upstream.text();
      var key = await decryptWrappedKey(encoded, mediaId);
      return response(key, 200, 'application/octet-stream', { 'Cache-Control': 'private, max-age=3600' });
    }

    var body = await upstream.text();
    if (!body.trimStart().startsWith('#EXTM3U')) {
      return response('Upstream did not return an HLS playlist', 502);
    }
    var base = upstream.url || upstreamUrl;
    var rewritten = rewritePlaylist(body, base, incoming.origin, mediaId, token);
    return response(rewritten, 200, 'application/vnd.apple.mpegurl; charset=utf-8');
  } catch (e) {
    return response('HLS proxy error: ' + String(e && e.message || e), 502);
  }
}

export default { fetch: handleRequest };
