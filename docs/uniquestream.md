# Uniquestream provider

This provider adapts publicly exposed catalogue and metadata from https://anime.uniquestream.net to Zangetsu.

## Implemented

- Search uses the public JSON endpoint `/api/v1/search?query=…&t=all&limit=…&page=…` first, with the alternate `q` parameter and HTML search/A–Z parsing as fallbacks.
- Home/catalogue uses the public JSON endpoints `/api/v1/videos/popular` and `/api/v1/videos/new` before falling back to HTML catalogue pages.
- JSON result cards map content IDs, titles, types, and poster URLs into Zangetsu's provider result format.
- Detail metadata uses `/api/v1/series/<content_id>` (or `/api/v1/movie/<content_id>` for movies) first, with HTML parsing as a fallback.
- Series episodes are loaded from the public `/api/v1/season/<season_id>/episodes` endpoint. Requests are paginated and capped per season.
- Playback extraction still checks public watch-page markup for direct HTTPS media links. It does not yet implement the site's special media-key transformation, so a returned HLS URL is not a guarantee that every episode is playable.

## Setup and tests

The provider is registered as `uniquestream` in `index.json`. In Zangetsu, refresh the repository source list and install **Uniquestream**.

Run with Node.js 22+:

```sh
node tests/uniquestream.test.js
node scripts/check-and-run.mjs
```

## Validation

Mocked tests cover API search, catalogue mapping, detail metadata, paginated episode mapping, HTML fallback, and failure handling. They verify parsing and provider contracts; they do not prove that live search, all episode pages, or playback are reachable from every device/network.
