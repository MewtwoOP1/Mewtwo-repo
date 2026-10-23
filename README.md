# 𝑴𝒆𝒘𝒕𝒘𝒐♡ Repo

Community-maintained JavaScript providers for the [Zangetsu](https://github.com/Spyou/Zangetsu) app. The catalogue includes TMDB + Stremio for movie/TV metadata and configured add-on streams, plus anime sources and standalone movie providers maintained for Zangetsu.

**This repository does not host, upload, store, or serve video files.** Providers request metadata or playback URLs from third-party services. Availability is controlled by those services and may change at any time.

## Install

In Zangetsu, open **Settings → Sources → Add repo** and add:

```
https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/index.json
```

Install the sources you want from the repository. For anime metadata with a separate playback source, enable **Zangetsu Mode (Z Mode)** in the app. In that mode, AniList/MyAnimeList supplies catalogue metadata while an installed anime provider supplies playback. This repository cannot change the app's mode for you.

## Active providers

### Development and tests

Requirements: Node.js 22 or newer. No package installation is required.

Run the repository checks from the root directory:

```sh
node scripts/check-and-run.mjs
```

The check validates the manifest, ensures every listed provider file exists and is registered, checks provider metadata/settings and JavaScript syntax, then runs every `tests/*.test.js` file it finds. GitHub Actions uses the same command.

Tests use mocked responses. Passing mock tests verify the tested code paths against fixtures; they do **not** guarantee that a third-party website or its live playback hosts currently work.

## VidFlix

VidFlix catalogue metadata uses TMDB, while playback resolution is performed in the provider itself against VidCore's embed/session/catalog endpoints. It does not depend on a separately hosted resolver API. VidFlix's other server buttons use independent embed systems and are not reported as playable streams unless their own direct resolution flow is implemented and verified.

## Disclaimers

- No movies, shows, anime, subtitles, torrents, video files, or streaming servers are hosted by this repository.
- Third-party websites, add-ons, APIs, metadata, artwork, and playback hosts remain controlled by their respective operators and may have separate terms and policies.
- Users are responsible for ensuring their use of third-party services and any content they access complies with applicable laws and service terms.
- This is an unofficial community project and is not affiliated with or endorsed by Zangetsu, TMDB, Stremio, or any source website.

## Credits

The provider manifest and JavaScript interface follow the self-contained source model documented by [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers). This repository is independently maintained and is not the official Zangetsu provider repository.

## License

Most code in this repository is licensed under the MIT License; see [LICENSE](LICENSE). The MovieBox IN port is separately licensed under GPL-3.0-only, with its required source notice preserved; see [LICENSES/GPL-3.0.txt](LICENSES/GPL-3.0.txt). Third-party names, logos, APIs, metadata, and content remain the property of their respective owners and are subject to their own terms.

The active movie/series providers include MovieBox IN, PressPlayX, HDHub4u, and TMDB + Stremio. The active anime providers include AIOStreams, AniKoto, AnimeSalt, DesiDub Anime, AnV, HiAnime, AnimeSuge, AniZone, MegaPlay, and RareAnimes • StreamBeta. StreamBeta is a playback resolver; RareAnimes • StreamBeta combines it with RareAnimes catalog and episode metadata.

## AIOStreams (native video source)

AIOStreams v2.1.1 is a native Zangetsu source for **anime, movies, and TV series**. TMDB is the sole metadata/catalogue API for discovery, title details, and episode metadata. AIOStreams' authenticated `/api/v1/search` endpoint is used only to fetch streams; this is not a generic Stremio add-on importer.

### Setup

1. Add this repository in Zangetsu: `https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/index.json`.
2. Install **AIOStreams** and open its source settings.
3. Leave the TMDB credential field blank to use Zangetsu's built-in TMDB key. You can optionally enter your own TMDB v3 API key or Read Access Token to override it.
4. Paste the personalized AIOStreams manifest URL containing `/stremio/<id>/<config>/manifest.json`.
5. Optionally provide the base64 UserData value for the `x-aiostreams-user-data` header. It takes precedence over Basic authentication.
6. Enable torrent/P2P results only if the Zangetsu player supports magnet links.

### Resolver behavior

- Uses TMDB for all metadata: popular movies, TV, Japanese animation discovery, multi-search, title details, and season/episode lists. There are no Kitsu, AniZip, or Cinemeta requests.
- Uses Zangetsu's built-in TMDB API key by default, so no separate key is required. An optional personal API key or Read Access Token is supported; custom credentials are sent through the dedicated TMDB request path.
- Sends TMDB IDs to AIOStreams: `tmdb:<id>` for films and `tmdb:<id>:<season>:<episode>` for TV episodes. Open titles from this provider so the TMDB ID is preserved.
- Prioritizes stream requests ahead of queued catalogue requests, keeps up to five requests in flight, and does not retry failed AIOStreams stream lookups.
- Stream lookup defaults to a **7-second request timeout** and an **8-second total deadline**. Both can be changed in settings.
- Maps streams into Zangetsu's accepted container/audio-kind fields, preserves supported request headers, and converts subtitle metadata to the expected `url`/`lang` objects.
- Keeps all distinct playable results; the five-request limit caps concurrent requests, **not** the number of returned links. P2P is opt-in, and invalid/unsupported URLs are skipped.

Faster client-side timeouts cannot make a slow upstream AIOStreams addon respond faster. If results remain slow or incomplete, check the per-addon timeouts configured in your AIOStreams instance. Mock tests do not prove availability of a private instance or live playback.
