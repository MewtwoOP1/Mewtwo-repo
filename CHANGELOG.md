# Changelog

## CineStream 1.2.0 — source resolution & playback handoff

Fixes the "sources could not be resolved" failure reported by Zangetsu.

### Root causes found and fixed

- **The subtitle provider ran after the resolution budget.** The old code awaited the Wyzie provider *after* the 18s race, so a full call could take 18s + 10s = 28s. Zangetsu abandons a provider call after 25s, so the app reported "no sources" even though playable links had already been found. The whole operation (subtitles included) now runs inside one budget.
- **Providers were started in registry order.** With 63 providers and a concurrency of 10, a provider late in the list (`p_anv` sat at index 58) never received a slot before the budget expired — the measured result was **0 sources after 18 seconds** even though the fast provider had resolved in 12ms. Providers are now scheduled by measured latency with a cold-start prior, so the fast ones start first. No provider is ever skipped, disabled or de-prioritised permanently.
- **A single stalled provider could occupy a slot for the whole budget.** Every provider now has its own ceiling (`PROVIDER_TIMEOUT_MS`).
- **The `fast` flag was ignored.** Zangetsu passes a boolean "resolve quickly" flag as the second argument to `getVideoSources`; the extension treated it as an options object. In fast mode the call now returns at the first-playable deadline instead of waiting for the slowest provider, and falls back to the full budget rather than returning an empty list.
- **The extractor recursion had no cycle guard.** A link-hub page pointing back at itself could recurse forever. The chain now tracks the current path and stops on a cycle or after six hops.
- **Transient network failures were never retried.** The shared fetch now makes one bounded retry for connection-level failures, honours `Retry-After`, and never retries a permanent HTTP status, an invalid credential or a cancelled operation.
- **Timed-out requests were orphaned.** The internal race returned before the host's own timeout fired, leaving the request running. Requests are now aborted and the body read gets the remaining budget instead of a fixed 5s.

### Performance (measured, same scenario before and after)

| Metric | Before | After |
|---|---|---|
| Time to first playable source | 18.0s (never delivered) | 4.5s (source available after 12ms) |
| Sources returned | 0 | 1 |
| Total call time, worst case | 28s (past the 25s app ceiling) | 18s |
| Provider attempts inside the budget | 60 | 77 |

### Networking, concurrency and caching

- Centralised timeout policy per operation (`_debug.timeoutPolicy()`).
- Cancellation token with `AbortController` support; cancelled work stops starting new requests and aborts the ones in flight.
- `_parallelCancelable` and `_withDeadline` helpers.
- Adaptive provider scheduling from measured latency (`_debug.providerLatency()`).
- Structured resolution diagnostics: per-provider duration, source count, failure category and first-source timestamp (`_debug.resolveStats()`).
- Concurrency ceiling raised from 10 to 16; the setting keeps its key and the options now also offer 20 and 24.

### Preserved

- All 63 providers, all extractors, all servers, qualities and subtitles.
- No provider, extractor or source was removed.

## Unreleased

- Optimize **CineStream** performance: add TTL cache for TMDB/AniList/ARM metadata (5-10 min), search (2 min), home page (5 min); add request deduplication via `_inflightFetch` to avoid duplicate fetches; reduce `FETCH_TIMEOUT` 7000→5000ms and `SOURCE_TIMEOUT` 22000→15000ms; use cached wrappers in `getDetail` and `search`; cache home page results.
- Bump **CineStream** to v1.0.8.

## CineStream 1.0.9

- Fix the native base64 decoder (`_bytesB64`) appending a stray NUL byte to every padded payload. This silently corrupted decoded URLs and links across extractors; decoding now keeps padding and stops at incomplete groups.
- Fix `_wpRedirect` dropping the final base64 decode step, which broke every `greenmotors.club` / `greenmountmotors` / `hubcdn` redirect used by **4KHDHub** and **Hdhub4u**.
- Extend `_hdhubLinks` to the live `greenmotors` host, follow the new **Hdhub4u** `hblinks.*` link-hub hop (HubDrive/GDTot/GoFile), follow **HubCloud**'s "Generate Direct Download Link" mirror page, and parallelize Hdhub4u link extraction to fit the playback budget.
- Fix **VidFastPro**, **Vidcore** and **Vidup** returning early when enc-dec.app omits the `token` field (now `""`): only the stage endpoints/servers/stream payload are required.
- Fix **MeowTV** 401s by requesting a single-use `/streams/ticket` per server request and sending `X-Stream-Ticket`; use the live server ids (`english`, `acme`, `dcloud`, `tik`, `hindi`).
- Reject `javascript:`/`data:`/`mailto:`/`blob:` URLs in `_abs` so anchor parsing can no longer turn script snippets into bogus `https://host/javascript:...` fetches.
- Verify **Hdhub4u** search hits by `imdb_id` or normalized title before extracting, preventing Typesense token-drop from returning unrelated latest posts.
- Add an `api.ani.zip/mappings` fallback for AniList lookups so anime providers still receive `anilistId`/`malId` when AniList rate-limits or returns empty.
- Skip **Movies4u** when its upstream base is the `google.com` placeholder instead of searching Google for unrelated pages.
- Bump **CineStream** to v1.0.9.

## CineStream 1.1.0

- New providers: Anv (anime API catalog/episode), AniPM (beta server / settlar / Megaplay), NetNaija (BFF token auth, MP4/HLS/DASH), HiCine (vcloud/pixeldrain/gofile/ten links).
- Extractor helpers: `_rgNorm`, `_rgScore`, `_rgQueries`, `_rgPick` title‑matching; `_netnaijaToken`, `_netnaijaAuth`, `_netnaijaLang` token lifecycle; `_hicineEntry`, `_hicinePick`, `_hicineResolve` link‑resolution chain (pixeldrain, gofile, ten hops); `_anvHeaders`, `_anvCatalog`, `provAnv`; `_anipmHeaders`, `_anipmSettlar`, `provAnipm`.
- Provider registration: four new keys added to `enabledProviders` options in `index.json`.
- Version bump to `1.1.0`.

## CineStream 1.0.7

- Fix **CineStream** `getVideoSources` to run ALL enabled providers concurrently instead of limiting quick mode to 3 providers (VaPlayer for movies, Anikage/Animekizz for anime). This restores the upstream CineStream behavior where every provider is invoked, so working providers (Hdhub4u, MoviesDrive, Rtally, Just4Anime, etc.) return streams instead of being skipped.
- Remove **VaPlayer** from default quick-mode consideration: its CDN segment URLs expire immediately (HTTP 404 on all segment requests regardless of headers). VaPlayer remains registered but returns no playable streams.
- Remove **Internet Archive** provider completely (implementation, manifest, tests, settings).
- Increase overall `getVideoSources` budget to 18s to give all providers time to complete within Zangetsu's ~20s playback ceiling.
- Bump **CineStream** to v1.0.7.

## CineStream 1.0.6

- Fix **CineStream** `_post()` silently sending GET instead of POST, which broke the enc-dec.app stage1 server and the VidFastPro/Vidcore/Vidup/Hexa stream extraction (device log showed `404 Cannot GET ...`). All `_post()` callers now correctly send `method: 'POST'`.
- Add hard overall budget (`SOURCES_BUDGET_MS`) and native `Promise.race` so `getVideoSources` returns within Zangetsu's ~20s playback budget.
- Parallelize Peachify, Anikage, and Animekizz server/source loops.
- Reduce quick-mode to reliably-working providers (Anikage, Animekizz).
- Reduce Anikage/Animekizz internal timeouts (15s → 8–10s).

## CineStream 1.0.3

- Fix **CineStream** stream playback for VidFastPro, Vidcore, and Vidup: the enc-dec.app API changed to require a two-stage `stage=1`/`stage=2` flow on `enc-*` endpoints. Providers now send the `stage` query parameter and POST to the intermediate `stage1` URL before calling `stage=2`. Without this fix, all `enc-*` requests returned HTTP 400 and no playable streams were produced.

## CineStream 1.0.2

- Fix **CineStream** `getDetail` `year` type (int→String) for Dart `MediaDetail`, resolving `type 'int' is not a subtype of type 'String?'` crashes on every detail load (e.g. Black Clover, Project Hail Mary, The Dark Knight).

## CineStream 1.0.1

- Add **CineStream** (`providers/cinestream.js`), a native JavaScript port of the GPL-3.0 CineStream CloudStream extension, as an aggregate Zangetsu source with 58 HTTP providers plus Wyzie Subs. Preserves Showbox/Febbox token, Wyzie Subs API key, and GramCinema bearer token settings. TMDB metadata with AniList/ARM ID mapping replaces Cinemeta. Excludes Stremio addon functionality, Torrentio, TorrentsDB, AnimeTosho-torrent, and StremioSubs per project requirements. See [NOTICE-CINESTREAM.md](NOTICE-CINESTREAM.md).
- Remove **AnimeKhor**, **AnimeNosub**, **AnimeToki**, **AniHQ**, and **Anichi** from the repository: these providers could not provide working playback in Zangetsu.
  - AnimeKhor: search endpoint returned 0 results for all queries
  - AnimeNosub: DNS resolution failures, connection timeouts
  - AnimeToki: episode posts not found via WordPress search
  - AniHQ: `type 'int' is not a subtype of type 'String?'` crash in metadata detail
  - Anichi: playback never worked (JavaScript-driven player with no direct media URLs)

- Remove **Re:Anime**, **KickAssAnime**, and **Zoko** from the repository.
- Remove **AnimeHeaven** (v1.0.1): the animeheaven.me domain persistently resets connections and returns zero search results for all titles; the source is unavailable and has been removed from the repository.
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
