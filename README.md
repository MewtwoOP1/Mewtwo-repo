# Zangetsu Community Sources

Community-maintained JavaScript providers for the [Zangetsu](https://github.com/Spyou/Zangetsu) app. This repository contains **TMDB + Stremio** metadata/stream discovery and a **JustAnime** anime provider.

**This repository does not host, upload, store, or serve video files.** Providers retrieve metadata and URLs exposed by third-party APIs or add-ons. Availability and content are controlled by third parties, not this project.

## Install

In Zangetsu, open **Settings → Sources → Add repo** and add:

```
https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/index.json
```

Install **TMDB + Stremio** or **JustAnime** from the repository's source list.

## Providers

### TMDB + Stremio

Combines TMDB metadata with stream discovery from Stremio-compatible add-ons that you configure.

- **TMDB API Key (optional):** blank uses Zangetsu's built-in key; entering your own v3 API key is intended to use your credentials for TMDB requests.
- **Stremio Add-on URLs:** enter one or more manifest URLs, separated by commas or new lines. Query parameters are preserved.
- **Max streams per add-on:** choose 5, 10, 25, 50, or 100 results per configured add-on.

### JustAnime

Uses JustAnime's public JSON API for anime listings, search, details, episodes, and its published stream-server endpoints.

- **Streaming servers:** choose all supported endpoints, or limit requests to AnimeGG, AniNeko, or MegaPlay.
- **Preferred audio:** puts sub or dub sources first, with the other language as fallback.
- The provider returns direct HTTP(S) media URLs exposed by the API and includes request headers/subtitle metadata when supplied.
- It does not decrypt protected player payloads, bypass logins/paywalls, defeat DRM, or work around anti-bot protection. If an endpoint returns encrypted data or no directly playable URL, that result is skipped.
- Live API calls could not be reached from the development runtime due to DNS/network restrictions. Mocked tests validate parsing and provider behavior, but **do not prove current live-site playback**. Please test a currently available title in Zangetsu after installing it.

## Disclaimers

- No movies, shows, anime, subtitles, torrents, video files, or streaming servers are hosted by this repository.
- Third-party metadata, artwork, websites, APIs, and add-ons remain controlled by their respective operators and may have separate terms and policies.
- Users are responsible for ensuring their use of third-party services and any content they access complies with applicable laws and service terms.
- This is an unofficial community project and is not affiliated with or endorsed by Zangetsu, TMDB, Stremio, or JustAnime.

## Credits

The provider manifest and JavaScript interface follow the self-contained source model documented by [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers). The JustAnime API flow was cross-checked against the public [Mangayomi JustAnime extension](https://github.com/Mallyd11/mangayomi-anime-extensions/blob/main/javascript/anime/src/en/justanime.js). This repository is independently maintained and is not the official Zangetsu provider repository.

## License

The code in this repository is licensed under the MIT License. See [LICENSE](LICENSE). Third-party names, logos, APIs, metadata, and content remain the property of their respective owners and are subject to their own terms.
