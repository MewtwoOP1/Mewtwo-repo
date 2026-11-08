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
- **ToonHub / AnimeDekho / AnimeKhor** — these return third-party embed pages rather than a media
  URL. Extracting a stream would mean adding per-embed resolvers that were not verifiable, so they
  are not direct sources.
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

## KayoAnime (WordPress download index)

KayoAnime (`kayoanime.com`) is not an Anilili streaming provider and is not a duplicate of any source
in this repository. It is a WordPress release blog: each post is a title or episode page with a
synopsis, an information block, and links to Google Drive folders/files (some posts use MEGA,
MediaFire, or Google Group placeholders instead). It was added because the Drive links are genuine
and can be played directly by Zangetsu once resolved.

### Method

1. Enumerated the real site structure: WordPress REST posts, the homepage sections, search, post
   metadata, and the Google Drive links inside each post's content.
2. Verified the REST endpoints and categories (`Anime Movie` = 2, `Ongoing Anime` = 3,
   `Anime Series` = 4, `Chinese Anime` = 31) and used the REST API for search, home, and post
   metadata, with the site's HTML search as a fallback.
3. Listed public Drive folders from Google's escaped `_DRIVE_ivd` payload, recursed into
   subfolders with depth/file limits, and detected private folders by the absence of entries plus a
   Google sign-in/request-access page. No Google authentication, Google Group join, CAPTCHA, or
   access restriction was bypassed.
4. Converted each real video file to one episode row. Files with the same season+episode are
   grouped as quality/encoding/audio variants; a movie's 720p folder and 1080p file become one
   movie with two streams. Archive files, external hosts, and missing files are reported but never
   turned into playable episodes.
5. Probed the Drive byte endpoint (`drive.usercontent.google.com/download?id=…&export=download&confirm=t`)
   with HEAD/Range before returning a stream, and followed Google's confirmation form when present.
   A URL is only exposed if the response confirms media bytes (200/206 with `content-length` or
   `content-range`).

### Live evidence

| Check | Result |
|:--|:--|
| WordPress search (`barakamon`, `one piece`, `link click`) | PASS — REST search returns matching posts; the One Piece post appears in the `one piece` results |
| Home sections | PASS — Latest Releases, Ongoing Anime, Anime Movies, Chinese Anime; second call served from cache |
| Barakamon detail | PASS — 12 episodes, Type TV, 2014, Comedy/Slice of Life, Kinema Citrus |
| Barakamon playback | PASS — direct Drive endpoint returned HTTP 206, 255,545,615 bytes, MKV, 1080p, HEVC, Dual Audio |
| The Boy and the Beast | PASS — 1 movie, 2 genuine variants (1080p direct file and 720p folder), 1080p first |
| Link Click | PASS — 12 Season 2 episodes; Season 1 and Season 3 private folders reported restricted; Google Group access note included |
| One Piece post | PASS — no links on the page; 0 episodes with an accurate "no public Google Drive links" note |
| Mahoutsukai Reimeiki | PASS — private folder reported restricted; 0 episodes, no bypass |
| Private Google Drive folder | BLOCKED — Google sign-in page; correctly reported as restricted, not played |
| Private Google Drive file | BLOCKED — HTTP 403; rejected by playback validation |

### Limitations

- KayoAnime is a download index, not a streaming catalogue. Titles that only have MEGA/MediaFire
  links, a Google Group placeholder, or a "DRIVE FIXING LINKS" notice have no playable episode and
  are reported as such.
- Private Google Groups and "Drivate Drive" folders require the user to join the group in a browser;
  the provider does not join, authenticate, or bypass Google.
- Some posts contain site-side copy/paste metadata errors (for example the Link Click post carries a
  "Scissor Seven" synopsis). The provider uses the site's published metadata rather than inventing a
  correction; episode filenames and seasons come from the Drive folder itself.
- Google Drive can rate-limit or slow large recursive folder listings. The per-title file limit and
  folder cache bound the work; the first request to each host may take several seconds on a cold
  connection.
- Google Drive confirmation tokens can expire. Playback re-probes the file when the episode is
  opened, so a stale token is not cached as a permanent stream URL.

## Validation

`node scripts/check-and-run.mjs` passes with 26/26 providers loaded, 418 assertions passed, and no
failures. Each added provider also has a mocked test that covers manifest parity, search, detail,
episodes, stream resolution, settings, and invalid input. `tests/kayoanime.test.js` additionally
covers public/private Drive folders, direct Drive files, confirmation pages, movie variant grouping,
private-file rejection, and HTTPS-only requests.
