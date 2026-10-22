# Uniquestream provider

This provider follows the public API contract used by the Yūzōnō/Anikku-Aniyomi UniqueStream extension.

## Catalogue and episode API

- Search: `/api/v1/search?page=…&query=…&t=all&limit=20`.
- Popular and latest catalogue: `/api/v1/videos/popular` and `/api/v1/videos/new`.
- Metadata: `/api/v1/series/{content_id}` or `/api/v1/movie/{content_id}`.
- Episodes: paginated `/api/v1/season/{season_id}/episodes?page=…&limit=20`.
- Playback metadata: `/api/v1/episode/{episode_id}/media/hls/{locale}`.
- Extracts raw, hard-sub, dub, and dub-plus-sub HLS variants supplied by the API, including signed playlist URLs without a `.m3u8` suffix and subtitle tracks when present.

## Playback limitation

Uniquestream protects HLS keys and segments. Zangetsu's generic JS-provider playback path cannot decrypt Uniquestream's wrapped `key.bin` payload, and this provider does not include a local proxy or app-side decryption support. As a result, the provider can return the available stream variants, but protected streams may not play until Zangetsu supports the required decryption flow. Returning additional direct playlist URLs alone does not resolve this limitation.

## Tests

Run with Node.js:

```sh
node tests/uniquestream.test.js
node scripts/check-and-run.mjs
```

Tests cover the API contract, extensionless signed playlist URLs, raw/hard-sub/dub variant mapping, QuickJS-compatible parsing, HTML fallback, and error handling. Mocked tests and catalogue smoke tests do not prove protected playback works end-to-end.
