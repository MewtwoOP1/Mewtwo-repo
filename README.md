# Zangetsu Community Sources

Community-maintained JavaScript providers for the [Zangetsu](https://github.com/Spyou/Zangetsu) app. This repository currently includes **TMDB + Stremio** for movie/TV metadata and stream discovery, and **AnimeSuge** as an anime streaming source.

**This repository does not host, upload, store, or serve video files.** Providers retrieve metadata and URLs exposed by third-party APIs or websites. Availability and content are controlled by third parties, not this project.

## Install

In Zangetsu, open **Settings → Sources → Add repo** and add:

```
https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/index.json
```

Install the sources you want from the repository. For separate anime metadata and streaming, enable **Zangetsu Mode (Z Mode)** in the app. In Z Mode, AniList/MyAnimeList supplies anime metadata while an installed anime provider is used for playback. Open titles from the Z Mode catalogue to keep the detail screen independent from a provider's own catalogue. The source repository cannot switch the app's mode for you.

## Providers

### TMDB + Stremio

Combines TMDB metadata with stream discovery from Stremio-compatible add-ons that you configure.

- **TMDB API Key (optional):** blank uses Zangetsu's built-in key; entering your own v3 API key is intended to use your credentials for TMDB requests.
- **Stremio Add-on URLs:** enter one or more manifest URLs, separated by commas or new lines. Query parameters are preserved.
- **Max streams per add-on:** choose 5, 10, 25, 50, or 100 results per configured add-on.

### AnimeSuge

Uses the AnimeSuge website (`animesuge.cz`) to search anime, list episodes, and resolve available player sources.

- The provider supports the site's current search, episode-list, server-list, and player-source flow.
- Available servers and playable links depend on AnimeSuge and its third-party player hosts; they can change or stop working without notice.
- In **Zangetsu Mode**, AniList/MyAnimeList remains responsible for anime metadata and AnimeSuge is used as a playback source.
- Live-site availability can vary. Please test a currently available title in Zangetsu after installing the source.

## Disclaimers

- No movies, shows, anime, subtitles, torrents, video files, or streaming servers are hosted by this repository.
- Third-party metadata, artwork, websites, APIs, player hosts, and add-ons remain controlled by their respective operators and may have separate terms and policies.
- Users are responsible for ensuring their use of third-party services and any content they access complies with applicable laws and service terms.
- This is an unofficial community project and is not affiliated with or endorsed by Zangetsu, TMDB, Stremio, or AnimeSuge.

## Credits

The provider manifest and JavaScript interface follow the self-contained source model documented by [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers). This repository is independently maintained and is not the official Zangetsu provider repository.

## License

The code in this repository is licensed under the MIT License. See [LICENSE](LICENSE). Third-party names, logos, APIs, metadata, and content remain the property of their respective owners and are subject to their own terms.
