# Zangetsu Community Sources

Community-maintained JavaScript providers for the [Zangetsu](https://github.com/Spyou/Zangetsu) app. The catalogue includes TMDB + Stremio for movie/TV metadata and configured add-on streams, plus anime sources maintained for Zangetsu.

**This repository does not host, upload, store, or serve video files.** Providers request metadata or playback URLs from third-party services. Availability is controlled by those services and may change at any time.

## Install

In Zangetsu, open **Settings → Sources → Add repo** and add:

```
https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/index.json
```

Install the sources you want from the repository. For anime metadata with a separate playback source, enable **Zangetsu Mode (Z Mode)** in the app. In that mode, AniList/MyAnimeList supplies catalogue metadata while an installed anime provider supplies playback. This repository cannot change the app's mode for you.

## Active providers

### AlmostOTT

Uses TMDB for the catalogue, keeps VidLink's quality/subtitle resolver as one playback path, and also tries AlmostOTT's public movie/TV player choices through Zangetsu's shared extractor. Resolved streams are labeled by server, and available audio-language metadata is preserved. Unsupported or blocked player hosts are skipped independently so one failing server does not blank out other results. The provider does not host or proxy media; playback still depends on upstream APIs, extractors, and file hosts.

- **TMDB API Key:** Optional. Leave blank to use the app's built-in key, or enter your own TMDB v3 API key.
- **Playback:** VidLink's public resolver; quality options and captions vary by title. This is not a guarantee that every page or player choice on AlmostOTT will work in Zangetsu.

### TMDB + Stremio

Combines TMDB metadata with stream discovery from Stremio-compatible add-ons that you configure.

- **TMDB API Key:** Optional. Leave blank to use the app's built-in key, or enter your own TMDB v3 API key.
- **Stremio Add-on URLs:** Enter manifest URLs separated by commas or new lines. Query parameters are preserved.
- **Max streams per add-on:** Limit results considered from each add-on to 5, 10, 25, 50, or 100.

This source handles movie and series metadata. Streams are requested from your configured add-ons; this repository does not provide or proxy them.

### AnimeSuge

Uses the AnimeSuge site for anime search, episode listings and third-party player resolution. Availability depends on the catalogue and external player hosts.

### HiAnime

Uses the HiAnime catalogue and episode API with VidPlay and Zoko player extraction. The Zangetsu-compatible implementation is adapted from [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers), not copied from the compiled Cloudstream plugin. As with all third-party sources, live catalogue and player availability can change.

### HDHub4u

Movie and series source with catalogue search, download-link parsing, and supported host resolution. This provider is adapted from [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers), whose JavaScript implementation is compatible with Zangetsu; Phisher98's plugin manifest lists a separate compiled Cloudstream plugin. Some host pages may be unavailable or protected.

### AniKoto

Uses `https://anikotoapi.site` for recent-anime listings and series episode/embed data. Search still uses the site's search page because the public API documents recent listings and series lookup, but not a search endpoint. Episode embed URLs are passed to Zangetsu's shared extractor. The API is rate-limited and streaming availability depends on the external embed host.

### AnV

Uses AnV's catalogue API for search and title details. Its playback API requires a valid `shiro_watch` session cookie from the episode page; returned source URLs and subtitles are passed to the player with the session headers. If the runtime or site stops returning the session cookie, streams will not resolve.

The active source list is defined in `index.json`. The HiAnime and HDHub4u provider logic is adapted under the upstream Zangetsu providers repository's MIT licence; see the source repository for its licence and history. Removed or non-working providers should not remain in the manifest.

## Development and tests

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

The mock regression suite includes: title extraction that rejects numeric-only KotoTV/AniKoto cards, AniKoto API title-object normalization, HiAnime catalogue-to-player resolution, and HDHub4u movie detail/direct-media handling.
