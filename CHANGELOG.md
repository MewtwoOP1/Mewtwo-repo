# Changelog

## Lucifer Donghua 1.0.4

- Bump the manifest and provider versions so Zangetsu refreshes the installed 1.0.3 build.
- Add a WordPress REST API fallback when the site's HTML search routes stop exposing parseable anime cards.
- Keep Yuzuno's HTML search route first and restrict REST results to canonical series pages, never episode posts.
- Strengthen regression coverage for REST-backed search and exact-title live search before metadata, episodes, and stream verification.

## Lucifer Donghua 1.0.0

- Port the Yuzono Lucifer Donghua source to Zangetsu's JavaScript provider interface.
- Preserve preferred-quality sorting, host selection (Dailymotion, Rumble, Ok.ru), and preview-episode settings.
- Add deterministic HTTP-mocked tests and an opt-in real-network stream smoke test.
- Retain Apache-2.0 upstream attribution and license notices.

## AIOStreams 2.1.1

- Fix dead/empty catalogue behavior by using Zangetsu's built-in TMDB key when no per-source credential is supplied.
- Keep optional user-provided TMDB v3 API keys and Read Access Tokens on the custom-auth path so Zangetsu's host interceptor cannot overwrite them.
- Surface total catalogue failure from `getHome` instead of silently reporting four empty sections; redact API keys in request error URLs.
- Add tests for built-in key routing, custom API-key routing, Read Access Token headers, and invalid-credential diagnostics.

## AIOStreams 2.1.0

- Use TMDB as the sole metadata/catalogue API for films, series, and Japanese animation discovery; remove Kitsu, AniZip, and Cinemeta requests.
- Use only TMDB IDs when querying AIOStreams, with the correct film versus season/episode format.
- Prioritize stream searches above queued metadata requests and reduce default stream lookup timeout to 7 seconds with an 8-second total deadline.
- Skip automatic retries for AIOStreams stream lookup to avoid doubling latency when the aggregate API is already slow.
- Map streams to Zangetsu's accepted container, audio-kind, audio-language, and subtitle fields.
- Update settings and documentation to require a TMDB API key or Read Access Token.

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
