# Uniquestream provider

This provider adapts publicly exposed catalogue and playback information from https://anime.uniquestream.net to Zangetsu.

## Implemented

- Search tries the public search-page route variants and parses catalogue cards inside article/list markup or standalone card containers.
- Catalogue metadata includes title, synopsis, poster, year, studio, genres, season/episode counts when present in the page, and explicitly linked episode pages.
- Episode parsing recognizes public `/watch/<id>/<slug>` links and structured episode data embedded in page markup. It does not invent episode URLs from counts alone.
- Playback extraction reads direct HTTPS media URLs explicitly present in public watch-page HTML, media tags, JSON-LD, or inline script data. Direct media URLs are emitted with the watch-page Referer.
- Failures are handled without silently treating a failed detail request as a successful empty episode list. Search/home methods still return empty arrays on unavailable catalogue pages.

## Setup and tests

The provider is registered as `uniquestream` in `index.json`. Add this repository in Zangetsu, refresh the repository source list, and install **Uniquestream**.

Run with Node.js 22+:

```sh
node tests/uniquestream.test.js
node scripts/check-and-run.mjs
```

## Limitations

The site's public series pages may show metadata and an episode count while the episode catalogue itself fails to load. The provider cannot create valid episode URLs from a count alone. Playback is returned only when a direct HTTPS media URL is exposed in the fetched watch-page markup; if the page only contains an embed/player shell or the live source is unavailable, playback remains unresolved. Mocked tests validate parsing logic, not current live-site playback.


Version 0.4.0: search now falls back to the public A–Z archive and home catalogue when the site’s search endpoint yields no cards; the home catalogue also falls back from the currently empty dynamic shelves.


Version 0.4.0 uses the site's public `/api/v1/search` JSON endpoint first (`query`, `t`, `limit`, `page`) and the JSON `/api/v1/videos/popular` and `/api/v1/videos/new` catalogue endpoints. HTML-page parsing remains a fallback when the API is unavailable.
