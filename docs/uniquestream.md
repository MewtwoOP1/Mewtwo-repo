# Uniquestream provider

This provider uses the same public API contract as the Yūzōnō/Anikku-Aniyomi UniqueStream extension.

## Implemented

- Search: `/api/v1/search?page=…&query=…&t=all&limit=20`, matching the official extension's parameter names and page size.
- Popular and latest catalogue: `/api/v1/videos/popular` and `/api/v1/videos/new` with `page`, `limit=20`, and `type=all`.
- Metadata: `/api/v1/series/{content_id}` or `/api/v1/movie/{content_id}`.
- Episodes: paginated `/api/v1/season/{season_id}/episodes?page=…&limit=20`.
- Playback metadata: `/api/v1/episode/{episode_id}/media/hls/{locale}`, including raw, hard-sub, and dub playlist variants.

## Validation

Run with Node.js 22+:

```sh
node tests/uniquestream.test.js
node scripts/check-and-run.mjs
```

CI tests cover the API request contract, JSON response mapping, metadata, episode pagination, media variants, QuickJS compatibility without the global `URL` constructor, HTML fallback, and error handling.

**Playback caveat:** the official extension includes a local HLS proxy to transform encrypted `key.bin` data and decrypt segments. This provider now resolves the correct media API and playlist variants, but direct playlist links may still require that HLS transformation to play reliably.
