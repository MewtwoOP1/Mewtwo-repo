# TMDB + Stremio for Zangetsu

A community-maintained Zangetsu extension combining TMDB metadata with stream discovery from Stremio-compatible add-ons.

**This repository does not host, upload, store, index, or distribute video files or streaming sources.** It requests metadata from TMDB and asks add-ons configured by each user to return stream links. Users are responsible for selecting, configuring, and legally using their own add-ons and services. Availability, legality, and content are controlled by third parties, not this project.

## Install

In Zangetsu, open **Settings → Sources → Add repo** and add:

```
https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/index.json
```

Install **TMDB + Stremio**, then open that source's settings.

## Settings

### TMDB API Key (optional; blank uses app default)
- Leave this blank to use the TMDB key already supplied by Zangetsu.
- Enter your own TMDB v3 API key to use your own credentials/quota instead.
- Obtain a key in your TMDB account's API settings: https://www.themoviedb.org/settings/api
- Your key is used for TMDB API requests only. It is not sent to configured Stremio add-ons or to this repository.
- The app stores provider settings locally. This repository does not receive your key. Treat it as a secret and do not share screenshots that expose it.

### Stremio Add-on URLs
- Paste one or more Stremio-compatible add-on manifest URLs.
- Separate multiple URLs with commas or new lines.
- URLs ending in `/manifest.json` are accepted.
- Query parameters are preserved for private or authenticated add-ons.
- These are third-party services you choose and configure. This repository does not operate them, host their content, or guarantee their availability.

### Max streams per add-on
Controls the maximum number of streams considered from each configured add-on. Available values are 5, 10, 25, 50, or 100. Higher values can return more choices but may take longer and make the stream list noisier.

## Features

- Trending and popular movies and series from TMDB.
- Search, posters, release years, summaries, and title details.
- TV episode lists and TMDB/IMDb identifiers.
- Stream lookup through user-configured Stremio-compatible add-ons.
- IMDb IDs with season/episode numbers and common TMDB ID formats are tried for stream matching.
- No built-in list of streaming websites and no hosted media.

## Disclaimers

- **No sources are hosted here.** No movies, shows, subtitles, torrents, debrid files, video files, or stream servers are hosted or supplied by this repository.
- Metadata and artwork are supplied by TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
- Stremio-compatible add-ons are independent third-party services. Their operators decide what they return.
- Users are responsible for ensuring that their use of third-party services and any content they access complies with applicable laws and those services' terms.
- This is an unofficial community extension and is not affiliated with or endorsed by the Zangetsu maintainers, TMDB, or Stremio.

## Credits

The TMDB catalogue implementation follows the metadata catalogue approach used by [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers). This repository is independently maintained and is not an official Zangetsu source repository.

## License

The code in this repository is licensed under the MIT License. See [LICENSE](LICENSE). Third-party names, logos, APIs, metadata, and content remain the property of their respective owners and are subject to their own terms.
