# Uniquestream provider

This provider uses the public API contract followed by the Yūzōnō/Anikku-Aniyomi UniqueStream extension.

## Catalogue and episode API

- Search: `/api/v1/search?page=…&query=…&t=all&limit=20`.
- Popular and latest catalogue: `/api/v1/videos/popular` and `/api/v1/videos/new`.
- Metadata: `/api/v1/series/{content_id}` or `/api/v1/movie/{content_id}`.
- Episodes: paginated `/api/v1/season/{season_id}/episodes?page=…&limit=20`.
- Playback metadata: `/api/v1/episode/{episode_id}/media/hls/{locale}`.
- HLS variants include raw audio, hard-sub playlists, dubs, and dub-plus-sub playlists when the API supplies them. Signed playlist URLs are accepted even when the path does not end in `.m3u8`; subtitle tracks included in API responses are carried through.

## Protected HLS playback

Uniquestream's `key.bin` payload is encrypted. Zangetsu's generic JS-provider playback path can forward request headers and open an HLS URL, but it does not decrypt Uniquestream's wrapped key payload. To support playback without modifying the app, this repository includes an optional Node.js sidecar that mirrors the relevant behavior of the official extension's HLS proxy: it rewrites master/media playlists, fetches keys with `x-am-media-id`, decrypts the wrapped AES key, and decrypts AES-128 segments.

### Run the helper on the same Android device

From the repository checkout in Termux or Ubuntu on Android, run:

```sh
node scripts/uniquestream-proxy.cjs
```

Keep the process running while watching. It listens on `127.0.0.1:8787` only. The provider checks `/health` automatically and uses the local proxy for HLS links when available. If the helper is not running, the provider falls back to direct CDN links, which may fail on protected streams.

The proxy only allows HTTPS upstreams, rejects private/reserved IP addresses, checks DNS results and re-validates redirects, and is bound to loopback rather than exposing a network listener. Node.js 22+ is recommended.

## Tests

Run with Node.js:

```sh
node tests/uniquestream.test.js
node tests/uniquestream-proxy.test.js
node scripts/check-and-run.mjs
```

The tests cover API contract and payload mapping, extensionless signed playlists, raw/hard-sub/dub variants, optional proxy selection, key decryption, HLS rewriting, IV/sequence handling, QuickJS-compatible mapping without the global `URL` constructor, HTML fallback, and error handling.

The tests use mocked responses and cryptographic fixtures; they do not prove that every live title or CDN is currently playable. The live provider still depends on Uniquestream's API, media hosts, network access, and the sidecar being active for protected HLS playback.
