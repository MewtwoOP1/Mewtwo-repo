# Zangetsu Community Sources

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

## Disclaimers

- No movies, shows, anime, subtitles, torrents, video files, or streaming servers are hosted by this repository.
- Third-party websites, add-ons, APIs, metadata, artwork, and playback hosts remain controlled by their respective operators and may have separate terms and policies.
- Users are responsible for ensuring their use of third-party services and any content they access complies with applicable laws and service terms.
- This is an unofficial community project and is not affiliated with or endorsed by Zangetsu, TMDB, Stremio, or any source website.

## Credits

The provider manifest and JavaScript interface follow the self-contained source model documented by [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers). This repository is independently maintained and is not the official Zangetsu provider repository.

## License

The code in this repository is licensed under the MIT License. See [LICENSE](LICENSE). Third-party names, logos, APIs, metadata, and content remain the property of their respective owners and are subject to their own terms.

The mocked regression suite includes: JustAnime and Ani.pm ID-field normalization, cached-detail fallback after unexpected parser errors, AniList/MAL field separation, ordered episodes, retry behaviour and stream URL handling; title extraction and API normalization for AniKoto; HiAnime catalogue-to-player resolution; and HDHub4u movie detail/direct-media handling.
