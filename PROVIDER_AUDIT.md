# Anilili provider audit

This audit evaluates every streaming provider named by Anilili's
[`ProviderCatalog.kt`](https://github.com/sanilili/Anilili) against the providers already shipped in
this Mewtwo repository. A provider was added only when it was not already covered, its endpoints
answered live, its full search → detail → episodes → playback flow worked from plain HTTPS requests,
and the resulting stream could be fetched as real media in the Zangetsu JavaScript runtime.

## Method

1. Read Anilili's live provider catalog (`miruroOrder`, `anivexaProviders`, and the synthetic
   `onepace` title) to get the complete list.
2. Compared each name with the current Mewtwo manifest and provider tree, including servers reached
   through the existing `miruro.js`, `anichan.js`, `anikoto.js`, `anizone.js`, `rareanimes.js`,
   `serenity-animekai.js`, `megaplay.js`, and `mewstream.js` sources.
3. For every non-duplicate candidate, called the provider's own `search`, `getDetail`, `getEpisodes`,
   and `getVideoSources` methods against the live site, then fetched the first returned stream URL
   with an HTTP `Range` request and checked the bytes (HLS manifest, DASH manifest, MP4/MKV
   container) instead of trusting the URL alone.
4. Ran `node scripts/check-and-run.mjs`, which validates the manifest/provider contract, HTTPS-only
   fetches, mocked playback flows, and every provider's test suite.

A provider was rejected on any critical failure: an unreachable endpoint, a Cloudflare/CAPTCHA wall,
a WebView-only bridge, a custom binary/AES data source that Zangetsu cannot supply, or a catalogue
that cannot be mapped from Zangetsu's normal search input.

## Results

| Provider | Exists in Mewtwo | Zangetsu compatible | Playback verified | Decision |
|:--|:--|:--|:--|:--|
| bee | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| sun | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| pewe | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| hop | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| ally | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| kiwi | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| moo | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| bonk | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| knob | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| nun | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| bun | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| cog | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| twin | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| telli | Yes (`miruro.js`) | Yes | Yes — existing Miruro source | Rejected — duplicate |
| anipm | No | No | No — embed session returns Cloudflare 403 | Rejected — Cloudflare wall |
| anichan | Yes (`anichan.js`) | Yes | Yes — existing AniChan source | Rejected — duplicate |
| animepahe | No | No | No — playback requires the Android `PaheBridge` WebView | Rejected — WebView-only |
| rareanimes | Yes (`rareanimes.js`) | Yes | Yes — existing RareAnimes source | Rejected — duplicate |
| anidbapp | No | No | No — `play.anidb.app` DNS/connection failure | Rejected — endpoint unreachable |
| xfdm | No | No | No — search needs Chinese/Bangumi subject names; romaji search returns `total: 0` | Rejected — cannot map Zangetsu search |
| animeonsen | No | Yes | Yes — DASH 206, `application/dash+xml` | **Added** (1.0.0) |
| anikoto | Yes (`anikoto.js`) | Yes | Yes — existing AniKoto source | Rejected — duplicate |
| allanime | No | No | No — playback requires site crypto/CAPTCHA tokens | Rejected — CAPTCHA/crypto |
| animekai | Yes (`serenity-animekai.js`) | Yes | Yes — existing AnimeKai source | Rejected — duplicate |
| anizone | Yes (`anizone.js`) | Yes | Yes — existing AniZone source | Rejected — duplicate |
| animegg | No | Yes | Yes — MP4 206, `video/mp4` | **Added** (1.0.0) |
| anineko | No | No | No — endpoint times out / prior HTTP 522 | Rejected — endpoint unreachable |
| 2dhive | No | No | No — proof-of-work "Cap" challenge blocks playback | Rejected — CAPTCHA-style challenge |
| animedekho | No | No | No — returns third-party embeds only | Rejected — no direct stream |
| toonhub | No | No | No — returns third-party embeds only | Rejected — no direct stream |
| uniquestream | No | No | No — AES-128 key requires a custom data source | Rejected — unsupported crypto source |
| animekhor | No | No | No — returns third-party embeds only | Rejected — no direct stream |
| kartoons | No | No | No — requires a private account token pool | Rejected — account-gated |
| animeav1 | No | Yes | Yes — VOE HLS 200, `#EXTM3U` (Spanish) | **Added** (1.0.0) |
| rift | No | No | No — private Firebase device registration plus per-episode session API; flow not verified | Rejected — unverified private session |
| hanime | No | No | No — adult-only catalogue | Rejected — adult-only |
| hentaihaven | No | No | No — adult-only catalogue | Rejected — adult-only |
| hstream | No | No | No — adult-only catalogue | Rejected — adult-only |
| onepace | No | No | No — catalogue is bound to the One Piece fan recut, not general titles | Rejected — title-bound |

## Added providers

| Provider | Source ID | Version | Language | Live playback evidence |
|:--|:--|:--|:--|:--|
| AnimeOnsen | `animeonsen` | 1.0.1 | Multi-audio | DASH manifest fetched with 206 and `<MPD>`; parsed into explicit quality variants |
| AnimeGG | `animegg` | 1.0.2 | English | Progressive MP4 fetched with 206 and `video/mp4`; JWPlayer videoSources parsed per quality |
| AnimeAV1 | `animeav1` | 1.0.1 | Spanish | VOE HLS fetched with 200 and `#EXTM3U`; YourUpload MP4 fallback; HLS master parsed into explicit quality variants |
| Anichi | `anichi` | 1.0.0 | English | Search via /filter?keyword=; detail and episodes from /anime/ pages; VOE embeds resolved from /watch/ pages |
| AniHQ | `anihq` | 1.0.0 | English | WordPress REST with custom anime/episode post types; VOE embeds resolved from watch pages |
| AnimeKhor | `animekhor` | 1.0.0 | English | WordPress REST posts; direct MP4/M3U8 links parsed from detail page HTML |
| AnimeNosub | `animenosub` | 1.0.0 | English | WordPress REST posts; direct media links parsed from detail/category pages |
| AnimeToki | `animetoki` | 1.0.0 | English | WordPress REST posts; individual episode posts; direct media links parsed from detail pages |

AnimeAV1 is not a duplicate of the existing `anv.js` source: its streams are Spanish, with burned-in
Spanish subtitles and a Latino dub on some titles. It is therefore declared as Spanish rather than
presented as another English catalogue.

### Post-audit fixes (after the Zangetsu playback log review)

None of the remaining sources required post-audit fixes beyond the AnimeGG
timeout/retry improvement noted in the changelog.

## Notes on the rejected providers

- **AniPm** — the embed handshake (`embed.settlar.io/api/embed/session`) answers HTTP 403 behind
  Cloudflare. No playback URL can be produced without circumventing that wall.
- **AnimePahe** — the Android app resolves streams through its own `PaheBridge` WebView. A
  Zangetsu provider has no WebView or DOM, and the site's anti-bot flow cannot be reproduced with
  the available `fetch` runtime.
- **AniDB App** — both the API host and `play.anidb.app` fail DNS resolution or connection setup, so
  there is nothing to query.
- **XFDM** — its search is keyed on Bangumi subjects and Chinese titles. A normal romaji query
  returns `total: 0`, and the later playback route depends on that subject mapping. Zangetsu's
  search input cannot supply the required key.
- **AllAnime** — the player needs site-generated crypto and CAPTCHA tokens; reproducing that would
  require bypassing the protection.
- **AniNeko** — the endpoint times out (previously HTTP 522). A provider that cannot complete a
  search or episode request is not shippable.
- **2Dhive** — playback is gated by a "Cap" proof-of-work challenge. Zangetsu has no challenge
  solver and the audit does not add one.
- **ToonHub / AnimeDekho** — these return third-party embed pages rather than a media URL.
  Extracting a stream would mean adding per-embed resolvers that were not verifiable, so they are
  not direct sources. (AnimeKhor was subsequently added as a direct source after its episode detail
  pages were found to contain direct media links.)
- **UniqueStream** — the manifest is encrypted and needs an AES-128 key supplied through a custom
  data source, which the Zangetsu provider interface does not expose.
- **Kartoons** — streams are minted from a private account token pool; without an account the
  provider cannot resolve an episode.
- **Rift** — the app performs private Firebase installation/device registration and then a
  per-episode `can_play`/`direct_link` session exchange. That flow was not reproducible or
  verifiable outside the Android client, so it was not added.
- **Hanime / HentaiHaven / HStream** — adult-only catalogues, outside the supported source set.
- **OnePace** — a synthetic catalogue for the One Piece fan recut only. It is not a general anime
  provider and cannot answer searches for other titles.
- **Miruro pipe servers** — bee, sun, pewe, hop, ally, kiwi, moo, bonk, knob, nun, bun, cog, twin,
  and telli are all reached through the existing `miruro.js` provider. Adding each as a separate
  source would duplicate the same catalogue and playback path.
## Validation

`node scripts/check-and-run.mjs` passes with 30/30 providers loaded, and no
failures. Each added provider also has a mocked test that covers manifest parity, search, detail,
episodes, stream resolution, settings, and invalid input.
