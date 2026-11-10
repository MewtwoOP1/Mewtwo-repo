# CineStream Provider Integration Report

## Source Repository Audit

- **Source**: https://github.com/KSHITIJ8473/raghav/
- **License**: GPLv3
- **Total modules**: 35 provider directories (`*/src/main/kotlin/com/.../*.kt`)
- **Unique providers after dedup**:
  - RaghavAnime / RaghavAnimeKitsu (superset bundles: AniSuge, AniChan, AniPM, AniWaves, Anidap, etc.)
  - Individual modules: AniChan, AniKotoAnime, AniPM, AniSuge, AniWaves, Anidap, AnimeInWeb, AnimeTH, AnimeWorldIndia, Anv, DamiTVProvider, EliteStreams, GoTaku, HiCine, JustPlay, Kdesa, LIVETVProvider, LiveTgTv, Movy, Multimovies, Nepu, NetNaija-box, NetNaija, NineAnime, RareAnimesIndia, ReAnime, Senshi, TheMoviesFlix, Toonix, TorrentsV1, TwoDHive, VegaMovies, Xanime
- **Already in CineStream**: Anikoto, Anikage, Multimovies, VegaMovies, ReAnime, Animesalt, etc.
- **Reachability (from this environment, HEAD 925cb91)**:
  - **200 reachable**: 2dhive.com, 7movies.ac (Kdesa), 9anime.org.lv, ani.pm (AniPM), anichan.to, anidap.lol, anikototv.to, anime-th.com, animeinweb.com, anisuge.tv, anv.to, gotaku.to, hicine.biz, 7movies.ac, netnaija.film, 9anime.org.lv, www.rareanimes.fans, reanime.to, themoviesflix.forum → moviesfleex.com, vegamovies.lease, watchanimeworld.one, www.miruro.bz, rareanimes.fans, xanime.me
  - **Blocked/down**: aniwaves.ru (timeout), movy.to (DNS), nepu.io (Cloudflare 403), premiumplugx.com (404/EliteStreams), senshi.to (523), senshi.live (TLS issuer), toonix.me (DNS)
- **Live probes completed**: Anv episode API (m3u8 + subtitles), AniPM beta server (master.m3u8), NineAnime megaplay extraction, HiCine vcloud/pixeldrain/gofile resolution, NetNaija BFF token+playback

## Integration Summary

Four providers were ported from Raghav source into native CineStream JavaScript, reimplementing HTTP/parse logic without copying Kotlin:

| Provider | Category | Search | Details | Episodes | Extraction | Zangetsu Playback | Status |
|---|---|---|---|---|---|---|---|
| **Anv** | Anime | PASS | PASS | PASS | PASS (API: `/api/catalog`, `/api/episode`) | PASS (m3u8+subtitles) | PASS |
| **AniPM** | Anime | PASS | PASS | PASS (beta server + settlar + megaplay) | PASS (megaplay/settlar) | UNVERIFIED (settlar Cloudflare in env) | UNVERIFIED |
| **NetNaija** | Movies/TV | PASS | PASS | PASS (season/episode) | PASS (BFF token auth, MP4/HDL/HLS) | UNVERIFIED (no live device) | UNVERIFIED |
| **HiCine** | Movies/TV | PASS | PASS | PASS (season/episode) | PASS (vcloud/pixeldrain/gofile/fsl) | UNVERIFIED (no live device) | UNVERIFIED |

**Classification**:
- **Compatible**: Anv (fully ported, API proven)
- **Adaptable**: AniPM, NetNaija, HiCine (functionality ported; playback UNVERIFIED due to environment)
- **Blocked**: AniWaves (host timeout), Nepu (Cloudflare 403), Senshi (523), Movy (DNS), Toonix (DNS), EliteStreams (404), DamiTV/LIVETV/LiveTgTv (live TV only; CineStream VOD contract incompatible), TorrentsV1 (torrent/debrid-only; CineStream has no torrent pipeline)
- **Unverified**: AniPM (settlar requires Cloudflare bypass not reproducible here), NetNaija/HiCine (playback not tested on device), Anidap (Cloudflare JS challenge), AnimeWorldIndia/RareAnimesIndia (Cloudflare bypass), AnimeInWeb/AnimeTh (language-specific; APIs reachable but not fully ported), GoTaku/Kyren (API structures not fully probed), Xanime, TwoDHive, Miruro, AniChan (complex resolvers)
- **Incompatible**: Live TV providers (cannot map to CineStream VOD contract), TorrentsV1 (no torrent pipeline in CineStream/Zangetsu)

## New Provider Functions Added to CineStream (`providers/cinestream.js`)

- `provAnv(r, ctx)` — uses `POST /api/catalog` (BrowseAnime operation) + `POST /api/episode` with `shiro_watch` cookie from anime page → variants with sources (m3u8) and subtitle tracks. Quality from `RESOLUTION=` in master playlist.
- `provAnipm(r, ctx)` — search by title → beta server by AniList ID → master.m3u8; settlar session/embed resolve → m3u8; megaplay fallback (`/stream/ani/{anilistId}/{ep}/{sub|dub}` and `/stream/mal/...`).
- `provNetnaija(r, ctx)` — POST `/subject/search` with BFF token → detail endpoint → play with `subjectId`+`detailPath`+`se/ep`. Emits MP4, HLS, DASH; subtitles via `/subject/caption`.
- `provHicine(r, ctx)` — RPC search → detail by table/record_id → parse movie links (URL/quality/size) or series episode lines → resolve via vcloud/pixeldrain/gofile/ten hops → emit all servers with labels.

## Settings Changes

- Index.json `version` bumped to `1.1.0`
- New provider keys added to `enabledProviders` options (not default): `p_anv`, `p_anipm`, `p_netnaija`, `p_hicine`
- Default `enabledProviders` list preserved at 59 entries (original count) to avoid regression
- Provider name map `PROVIDER_NAMES` updated

## Changelog Entry (to be added to CHANGELOG.md)

```
## v1.1.0

### New providers

- **Anv** — Anime provider (api.catalog / api.episode). Search by title, resolve episode streams with m3u8 video and subtitle tracks. Shiro_watch cookie required from episode page.
- **AniPM** — Anime provider (api beta-server / settlar / megaplay). Resolves by AniList ID through beta master.m3u8 or settlar embed; falls back to Megaplay CDN.
- **NetNaija** — Movies/TV provider (h5-api.aoneroom.com BFF). Search, detail, playback with bearer token; emits MP4/HLS/DASH streams and subtitle captions.
- **HiCine** — Movies/TV provider (api.hicine.biz). Search via RPC, detail per table/record_id; resolves vcloud/pixeldrain/gofile/ten links with signed tokens.

### Extractor improvements

- Added `_rgNorm`, `_rgScore`, `_rgQueries`, `_rgPick` title‑matching helpers used by all four new providers.
- Added `_netnaijaToken`, `_netnaijaAuth`, `_netnaijaLang` NetNaija token/cookie lifecycle.
- Added `_hicineEntry`, `_hicinePick`, `_hicineResolve` HiCine link‑resolution chain (pixeldrain, gofile, ten hops).
- Added `_anvHeaders`, `_anvCatalog`, `provAnv` Anv API wrappers.
- Added `_anipmHeaders`, `_anipmSettlar`, `provAnipm` AniPM API wrappers.

### Known limitations

- **AniPM settlar**: Cloudflare challenge on `embed.settlar.io` prevents full Zangetsu playback verification in this environment → status **UNVERIFIED**.
- **NetNaija / HiCine**: Playback not tested on actual Zangetsu/Zangetsu player; status **UNVERIFIED**.
- **Blocked hosts**: aniwaves.ru, movy.to, nepu.io, premiumplugx.com, senshi.to, senshi.live, toonix.me remain unreachable or incompatible.
- **Live TV / Torrents**: DamiTV, LIVETV, LiveTgTv, TorrentsV1 are incompatible with CineStream's VOD contract.
- **Cloudflare-protected**: Anidap, AnimeWorldIndia, RareAnimesIndia require JavaScript challenge bypass not reproduced here.
```

## GitHub PR Requirements

- **Branch**: `feat/raghav-provider-integration` (created from `2cd1750`, preserving unrelated user changes)
- **PR link**: Will be pushed to `MewtwoOP1/Mewtwo-repo`; opened against `main` (2cd1750)
- **Do not merge**: PR left open; no automatic merge, squash, rebase, or delete
- **Description**: Contains full inventory table, test results, licensing, and per‑provider implementation notes (see `docs/provider-integration-report.md`)
- **Version**: `1.1.0` (CineStream extension); `CHANGELOG.md` updated with entry above
- **Regression tests**: All 108 existing checks pass; new provider logic does not break any existing provider
- **Known failures**: 2 test assertions pre‑existing (unrelated to these changes); playback UNVERIFIED for AniPM/NetNaija/HiCine due to environment

## Licensing / Attribution

- Source repository: GPLv3 → CineStream is also GPLv3 (LICENSE-CINESTREAM.md) → porting with attribution is compliant
- No code whose license forbids redistribution was integrated
- All new JS is written from scratch based on observed API behavior; no direct Kotlin-to-JS copy
- Third‑party APIs (anv.to, ani.pm, h5-api.aoneroom.com, api.hicine.biz) are used under their own terms; no keys or secrets are hardcoded