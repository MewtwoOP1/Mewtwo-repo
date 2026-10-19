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

The active movie/series providers include MovieBox IN, PressPlayX, HDHub4u, and TMDB + Stremio. The active anime providers include AniKoto, AnimeSalt, DesiDub Anime, AnV, HiAnime, AnimeSuge, AniZone, MegaPlay, and RareAnimes • StreamBeta. StreamBeta is a playback resolver; RareAnimes • StreamBeta combines it with RareAnimes catalog and episode metadata.