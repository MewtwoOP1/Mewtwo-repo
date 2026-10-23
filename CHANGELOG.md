# Changelog

## AIOStreams 2.0.0

- Rebuild the Zangetsu AIOStreams provider around the documented authenticated `/api/v1/search` endpoint.
- Add movie and TV-series catalogs/details via Cinemeta alongside Kitsu/AniZip anime metadata and episode mapping.
- Correct identifier formatting against AIOStreams' ID parser; preserve known external IDs and season/episode context.
- Accept direct HTTP(S) results without `infoHash`, preserve stream-specific request headers, and avoid forwarding AIOStreams API credentials to playback URLs.
- Parse available addon/indexer/service, resolution, codec, language, size, seeders, cached state, and subtitle metadata without fabricating missing values.
- Add bounded request concurrency (maximum five), per-request timeouts, a total search deadline, one retry for transient errors, cancellation where supported, and a bounded pending queue.
- Add deterministic mocked tests for catalogues, ID formatting, multi-link responses, authentication, errors, timeouts, concurrency, episode filtering, duplicates, and P2P opt-in.

### Limitations

- Actual playback depends on each configured AIOStreams instance and its upstream addons; mock tests cannot verify private-instance availability or CDN playback.
- The resolver does not probe returned links with extra HTTP requests, because that can consume or invalidate signed/one-use links.
- The manifest has one source type field, so AIOStreams is registered as a general video source (`movie`) while its catalogue and returned metadata include anime, movies, and TV series.
