# Third-party notices

## CineStream CloudStream extension (GPL-3.0)

`providers/cinestream.js` is a derivative work of the GPL-3.0-licensed
**CineStream CloudStream extension** by megix:

- Upstream repository: https://github.com/SaurabhKaperwan/CSX
- CineStream source tree: `CSX/tree/master/CineStream`
- Upstream licence: GNU General Public License v3.0
- Upstream licence text: see [LICENSE-CINESTREAM.md](LICENSE-CINESTREAM.md)

The CineStream port is distributed under GPL-3.0. It is a separate
native JavaScript source for Zangetsu and does **not** relicense any
unrelated MIT-licensed file in this repository.

### Upstream components preserved in the port

The following upstream CineStream concepts are preserved in the JS port
(adapted to Zangetsu's provider runtime, not copied from Kotlin):

- 58 HTTP providers plus Wyzie Subs (59 total registered providers)
- Showbox/Febbox UI token, Wyzie Subs API key, GramCinema bearer token
- TMDB metadata backend with AniList/ARM ID mapping (replaces Cinemeta)
- Embed resolvers: HubCloud, GDFlix, Gofile, Driveleech, Asianload,
  Vibe, MegaPlay, and generic embed extraction
- Pure-JS AES-CBC/AES-GCM, SHA-256, HMAC-SHA256 primitives
- Dynamic provider host refresh from upstream `urls.json`
- Per-provider timeout, concurrency cap, deduplication, error isolation

### Not ported (excluded per project requirements)

- Stremio add-on discovery, manifests, installation, registration,
  management UI, and addon URLs/types
- Torrentio, TorrentsDB, AnimeTosho-torrent, StremioSubs integrations
- Stremio torrent/debrid/subtitle addon functionality

### Settings requiring user-supplied credentials

These are **optional** and must be provided by the user; none are
hardcoded or logged:

- `showboxToken` — Showbox / Febbox UI token
- `wyzieSubsKey` — Wyzie Subs API key
- `gramcinemaToken` — GramCinema bearer token
- `movieblastToken`, `movieblastApi`, `movieblastKey` — MovieBlast build-time values
- `castleKey` — Castle APK signing key

Providers that require an unset credential return early and emit no
streams rather than failing loudly.
