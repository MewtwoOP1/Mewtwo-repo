# Changelog

## Unreleased

- Add seven live-verified anime sources from the Anilili provider audit:
  - **Zoko 1.0.2** — AniList-backed search, SUB/DUB episode tracks, and HLS playback.
  - **AnimeOnsen 1.0.0** — multi-audio DASH playback with subtitle tracks.
  - **KickAssAnime 1.0.2** — catalogue and HLS playback with the required upstream headers.
  - **Re:Anime 1.0.2** — FlixCloud resolution with direct MKV downloads.
  - **AnimeGG 1.0.0** — series/episode scraping and progressive MP4 playback.
  - **AnimeAV1 1.0.0** — Spanish catalogue with VOE HLS and YourUpload MP4 fallback.
  - **AnimeHeaven 1.0.0** — mirror-based progressive MP4 playback.
- Add `PROVIDER_AUDIT.md` with the complete Anilili provider comparison, live playback evidence, and
  the rejection reason for every provider that was not added.
- Fix the four sources flagged in the Zangetsu playback log:
  - **AnimeHeaven 1.0.0** — make search resilient to connection resets by retrying the fast-search endpoint, falling back to the full search page, then to the new/popular catalogue index filtered by query.
  - **Re:Anime 1.0.2** — emit one episode row per number (SUB/DUB are stream variants, not duplicate rows) and poll the FlixCloud progress endpoint until the download is ready before returning the download URL, avoiding 404s.
  - **KickAssAnime 1.0.2** — emit one episode row per number (SUB/DUB are stream variants, not duplicate rows), resolve both audio tracks for a combined episode row, and fall back to any listed server when no preferred native player server is available.
- Fix the Jellyfin source icon by switching from SVG to the official square PNG asset, which is compatible with Zangetsu's cached network-image renderer; bump provider version to 3.0.3.

- Jellyfin 3.1.0 fixes TV handling: mark series, seasons, and episodes as TV for TMDB metadata, keep specials in `S00`, infer missing season/episode numbers, use parent/series artwork when an episode has no image, link episode cards through episode URLs, send a valid single-value sort to the standard Jellyfin episodes endpoint, recover episodes when one season request fails, and pass a boolean `EnableSubtitlesInManifest` flag.

- Use the official Jellyfin icon for the Jellyfin source, fix its direct asset URL, and bump the provider to 3.0.2.
- Avoid malformed relative API requests when the server address has not been configured.
- Rebuild Jellyfin as a standalone catalogue-backed source. Read the authenticated user's Jellyfin libraries and catalogue directly instead of using the old Stremio/TMDB implementation.
- Add AIOStreams Jellyfin-server support: discover advertised features, handle genre-required catalogues, list configured catalogues as libraries, and read AIOStreams version metadata from Jellyfin media sources.
- Separate catalogue/detail/episode requests from stream resolution so opening a catalogue or loading episode lists does not invoke stream add-ons.
- Add complete season episode pagination and a fallback from the show-episodes route to the parent-items route for compatible Jellyfin servers.
- Negotiate playable versions through `PlaybackInfo`, preserve each remote source's required request headers, and use the server-provided external subtitle delivery URLs without leaking Jellyfin credentials to third-party stream hosts.
- Add API-key and optional user-ID settings alongside username/password authentication, one-time expired-session reauthentication, library filtering, and updated setup documentation.
- Replace the old Jellyfin v2 test suite with v3 catalogue, episode pagination, AIOStreams version, header, subtitle, and authentication coverage.


- Remove the obsolete duplicate GPL-3.0 licence files left over from the former MovieBox IN source; no GPL provider remains in this repository branch.
- Correct the Apache-2.0 notice to identify the two remaining Yuzono-derived Serenity providers.

## TMDB + Stremio 3.3.0

- Add a separate Metadata Add-on URLs setting so catalogue/metadata add-ons can be configured independently from streaming add-ons.
- Keep the catalogue toggle opt-in and preserve legacy behavior by falling back to Streaming Add-on URLs when the metadata URL list is blank.
- Add regression coverage verifying catalogue metadata and playback streams use their respective add-on lists.

## TMDB + Stremio 3.2.1

- Cache successful TMDB API responses and use recent cached data during transient DNS, connection, and server failures.
- Retry custom-key requests on TMDB's alternate API hostname when the trailing-dot primary hostname cannot be reached.
- Treat an empty `append_to_response=external_ids` object as complete, avoiding an unnecessary second request.
- Add regression tests for alternate-host retry and empty external-ID responses.


## AIOStreams 2.2.0

- When a valid TMDB search yields no playable streams, resolve the TV episode through AIOStreams' anime database and retry with available anime-native, IMDb, or TVDB IDs.
- Convert TMDB episode offsets to anime-cour episode numbering and filter returned files against the resolved episode coordinates.
- Cache anime mapping lookups, keep existing network/auth failures visible, and only trigger fallback after a valid empty stream response.
- Increase new-install stream search and total fallback deadlines to 9 and 12 seconds respectively.
- Add regression coverage for episode-offset mapping and fallback behavior.


## TMDB + Stremio 3.2.0

- Preserve available IMDb, TMDB, TVDB, MAL, AniList, Kitsu, and AniDB identifiers, including episode-aware variants when supplied.
- Respect Stremio manifest stream resource types and ID prefixes to avoid unsupported requests.
- Add opt-in support for valid magnet and infoHash torrent results; P2P stays disabled by default.
- Cache add-on manifests for five minutes and try preferred identifiers before lower-priority fallbacks.
- Limit TMDB season metadata lookups to five concurrent requests.
- Add regression tests for P2P opt-in, external IDs, ID-prefix filtering, and season-fetch concurrency.


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
