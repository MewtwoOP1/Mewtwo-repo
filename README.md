# Zangetsu Community Sources

Community-maintained JavaScript providers for the [Zangetsu](https://github.com/Spyou/Zangetsu) app. The repository currently contains **TMDB + Stremio** metadata/stream discovery and a **Movies2Watch** HTML scraper.

**This repository does not host, upload, store, or serve video files.** Providers retrieve metadata or inspect public third-party pages/add-on responses and return URLs supplied by those services. Availability and content are controlled by third parties, not this project.

## Install

In Zangetsu, open **Settings → Sources → Add repo** and add:

```
https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/index.json
```

Install **TMDB + Stremio** or **Movies2Watch** from the repository's source list.

## Providers

### TMDB + Stremio

Combines TMDB metadata with stream discovery from Stremio-compatible add-ons that you configure.

- **TMDB API Key (optional):** blank uses Zangetsu's built-in key; entering your own v3 API key is intended to use your credentials for TMDB requests.
- **Stremio Add-on URLs:** enter one or more manifest URLs, separated by commas or new lines. Query parameters are preserved.
- **Max streams per add-on:** choose 5, 10, 25, 50, or 100 results per configured add-on.

### Movies2Watch

Searches Movies2Watch catalog pages, reads title metadata and any episode links rendered into the page, then checks the page and its embedded player pages for direct HTTP(S) HLS or video-file URLs.

- The resolver follows at most two embedded-page levels and limits the number of frames it checks.
- It only recognizes direct media URLs exposed in fetched HTML. It does **not** run page JavaScript, decrypt protected players, defeat DRM, bypass logins/paywalls, or work around anti-bot protection.
- If the site loads its player entirely through JavaScript or an unsupported provider, no direct source may be returned. The site's live HTML could not be validated from the development runtime, so treat this provider as experimental until it is tested in Zangetsu against a currently available title.
- Site changes, regional restrictions, and third-party player changes can break results without notice.

## Disclaimers

- No movies, shows, subtitles, torrents, video files, or streaming servers are hosted by this repository.
- Third-party metadata, artwork, websites, and add-ons remain controlled by their respective operators and may have separate terms and policies.
- Users are responsible for ensuring that their use of third-party services and any content they access complies with applicable laws and service terms.
- This is an unofficial community project and is not affiliated with or endorsed by Zangetsu, TMDB, Stremio, or Movies2Watch.

## Credits

The provider manifest and JavaScript interface follow the self-contained source model documented by [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers). The TMDB catalogue approach also draws on that repository's public provider patterns. This repository is independently maintained and is not the official Zangetsu provider repository.

## License

The code in this repository is licensed under the MIT License. See [LICENSE](LICENSE). Third-party names, logos, APIs, metadata, and content remain the property of their respective owners and are subject to their own terms.
