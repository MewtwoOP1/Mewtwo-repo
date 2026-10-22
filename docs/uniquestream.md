# Uniquestream provider

This provider adapts public HTML pages from https://anime.uniquestream.net to Zangetsu's source interface.

## Coverage
- Search tries two public search-page route variants and safely returns an empty list for request or parsing failures.
- Detail extraction reads page title, description, poster, and public episode links.
- Playback accepts only direct media URLs explicitly exposed in public watch-page HTML or JSON-LD, and only on the site's own public media hosts. It does not decode hidden/private player APIs, evade anti-bot checks, or bypass authentication.
- Selector fallbacks: semantic cards and direct anchor fallbacks for catalogue results; data-attribute episode fallbacks; standard media tags and JSON-LD for streams.
- Request errors/HTTP failures are surfaced from details and playback; search/home/episode-list methods fail safe with empty arrays as appropriate.

## Setup
The provider is registered as `uniquestream` in `index.json`. Add this repository to Zangetsu using its normal repo URL, refresh the source list, then install **Uniquestream**. For local checks, use Node.js 22+ and run:

```sh
node tests/uniquestream.test.js
node scripts/check-and-run.mjs
```

## Known limitations
The website has changed routes and page rendering over time. If its result cards or episode links are rendered only by client-side JavaScript, server-side HTML scraping can return no results. Playback is only returned when a direct `.m3u8`, `.mp4`, or `.mpd` URL is present in publicly served page markup or JSON-LD. If playback is produced by a private API, encrypted player payload, authentication, or an external host, this provider deliberately does not attempt to bypass those controls. Mocked tests establish parser behavior but do not prove real-site playback.
