# Zangetsu Community Sources

Community-maintained JavaScript providers for the [Zangetsu](https://github.com/Spyou/Zangetsu) app. The active catalogue currently contains **TMDB + Stremio** for movie/TV metadata and user-configured add-on streams, plus **AnimeSuge**, **KotoTV**, **MKissa**, and **HiAnime** as anime sources.

**This repository does not host, upload, store, or serve video files.** Providers request metadata or playback URLs from third-party services. Availability is controlled by those services and may change at any time.

## Install

In Zangetsu, open **Settings → Sources → Add repo** and add:

```
https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/index.json
```

Install the sources you want from the repository. For anime metadata with a separate playback source, enable **Zangetsu Mode (Z Mode)** in the app. In that mode, AniList/MyAnimeList supplies catalogue metadata while an installed anime provider supplies playback. This repository cannot change the app's mode for you.

## Active providers

### TMDB + Stremio

Combines TMDB metadata with stream discovery from Stremio-compatible add-ons that you configure.

- **TMDB API Key:** Optional. Leave blank to use the app's built-in key, or enter your own TMDB v3 API key.
- **Stremio Add-on URLs:** Enter manifest URLs separated by commas or new lines. Query parameters are preserved.
- **Max streams per add-on:** Limit results considered from each configured add-on to 5, 10, 25, 50, or 100.

This source handles movie and series metadata. Streams are requested from your configured add-ons; this repository does not provide or proxy them.

### HiAnime

Uses the configured HiAnime-compatible domain to search anime, list episodes, and resolve supported player sources. Domain availability and playback depend on the selected website and its third-party hosts.

### KotoTV

Uses KotoTV search and watch pages to list anime and resolve available sub/dub player streams. Playback depends on KotoTV and its third-party player hosts; availability may change.

### MKissa

Uses MKissa's GraphQL catalogue and encrypted episode-source API. Playback depends on MKissa's rotating crypto handshake, supported third-party players, and any CAPTCHA or rate limits applied by the site.

### AnimeSuge

Uses the AnimeSuge website (`animesuge.cz`) to search for anime, list episodes, and resolve player sources.

- Available servers and playable links depend on AnimeSuge and third-party player hosts; they can change or stop working without notice.
- In **Zangetsu Mode**, AniList/MyAnimeList remains responsible for anime metadata and AnimeSuge is used as a playback source.
- Website and player availability varies. Test a current title in Zangetsu after installation.

The active source list is defined in `index.json`. JustAnime and Ani.pm have been removed from the active catalogue; their provider files may remain in the repository for reference and tests, but they are not offered by the manifest.

## Development and tests

Requirements: Node.js 22 or newer. No package installation is required.

Run the repository checks from the root directory:

```sh
node scripts/check-and-run.mjs
```

The check validates the manifest, ensures every listed provider file exists and is registered, checks provider metadata/settings and JavaScript syntax, then runs every `tests/*.test.js` file it finds. GitHub Actions uses the same command so removed providers cannot leave stale, hard-coded test steps behind.

Tests use mocked responses. A passing mock test verifies the tested code paths against fixtures; it does **not** guarantee that a third-party website or its live playback hosts currently work.

## Disclaimers

- No movies, shows, anime, subtitles, torrents, video files, or streaming servers are hosted by this repository.
- Third-party websites, add-ons, APIs, metadata, artwork, and playback hosts remain controlled by their respective operators and may have separate terms and policies.
- Users are responsible for ensuring their use of third-party services and any content they access complies with applicable laws and service terms.
- This is an unofficial community project and is not affiliated with or endorsed by Zangetsu, TMDB, Stremio, or AnimeSuge.

## Credits

The provider manifest and JavaScript interface follow the self-contained source model documented by [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers). This repository is independently maintained and is not the official Zangetsu provider repository.

## License

The code in this repository is licensed under the MIT License. See [LICENSE](LICENSE). Third-party names, logos, APIs, metadata, and content remain the property of their respective owners and are subject to their own terms.
