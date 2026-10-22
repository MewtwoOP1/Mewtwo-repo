# Uniquestream provider

This provider uses the public JSON API exposed by https://anime.uniquestream.net, with HTML parsing retained as a fallback.

## Implemented

- Search uses `/api/v1/search` with the documented `query`, `page`, `t`, and `limit` parameters. The response's `series` and `movies` arrays are mapped into Zangetsu result items.
- Catalogue/home uses `/api/v1/videos/popular` and `/api/v1/videos/new`.
- Detail metadata uses `/api/v1/series/<content_id>` or `/api/v1/movie/<content_id>`.
- Episodes are loaded from `/api/v1/season/<season_id>/episodes`, with pagination.
- URL normalization deliberately avoids the browser `URL` constructor. Zangetsu's QuickJS runtime supplies `absUrl`, but does not guarantee `URL`; using `new URL()` caused API result mapping to throw and search/home to silently fall back to empty arrays.
- Playback extraction still supports direct media URLs exposed in watch-page HTML. The site's current API media contract is more involved than HTML scraping and may require additional player/media handling.

## Setup and tests

The provider is registered as `uniquestream` in `index.json`. Refresh the source repository in Zangetsu and install/update **Uniquestream**.

Run with Node.js 22+:

```sh
node tests/uniquestream.test.js
node tests/uniquestream.live-smoke.mjs
node scripts/check-and-run.mjs
```

The live smoke test verifies the current search, popular, detail, and episode API routes, then calls the provider's actual search/home/detail methods. Unit tests also set `global.URL` to `undefined` to reproduce QuickJS runtime conditions.
