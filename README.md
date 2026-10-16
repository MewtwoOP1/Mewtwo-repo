# TMDB + Stremio for Zangetsu

A community-maintained Zangetsu extension that combines TMDB metadata with stream discovery from Stremio-compatible add-ons.

**This repository does not host, upload, store, index, or distribute video files or streaming sources.** It only requests metadata from TMDB and asks add-ons that you configure to return stream links. Users are responsible for choosing, configuring, and legally using their own add-ons and services. Availability, legality, and content are controlled by those third parties, not this project.

## Install

In Zangetsu, open **Settings → Sources → Add repo** and add:

```
https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/index.json
```

Install **TMDB + Stremio**. Open the source's settings and configure the options below.

## Settings

### TMDB API Key (optional)
- Leave blank to use Zangetsu's built-in TMDB API key.
- Enter your own TMDB v3 API key if you want to use your own credentials or quota.
- The key is sent only to TMDB API requests. It is not sent to Stremio add-ons or this repository's servers.
- Obtain a key from your TMDB account's API settings: https://www.themoviedb.org/settings/api
- Keep your key private. The source settings are stored by the app on your device; this repository does not receive them.

### Stremio Add-on URLs
- Paste one or more Stremio-compatible add-on manifest URLs.
- Separate multiple URLs with commas or new lines.
- URLs ending in `/manifest.json` are accepted.
- Query parameters are preserved, which can be required by private or authenticated add-ons.
- These add-ons are third-party services. This repository does not operate them or guarantee that they are available.

### Max streams per add-on
Controls how many returned streams are considered from each add-on. Choose 5, 10, 25, 50, or 100. Higher values may return more options but can take longer and add clutter.

## What it does

- Shows trending and popular movies and series from TMDB.
- Searches TMDB and shows posters, summaries, release years, and details.
- Lists TV episodes using TMDB episode metadata.
- Requests playable HTTP(S) stream URLs from the add-ons you configured.
- Tries IMDb IDs with season/episode numbers and common TMDB ID formats for stream lookup.
- Does not include or maintain a built-in catalogue of streaming sites.

## Important disclaimers

- **No sources are hosted here.** No movies, shows, subtitles, torrents, debrid files, or stream servers are hosted or supplied by this repository.
- TMDB supplies metadata and artwork. This project is not endorsed or certified by TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
- Stremio-compatible add-ons are independent third-party services. You configure them yourself; their operators determine what they return.
- You are responsible for ensuring that your use of third-party services and any content you access complies with applicable laws and the providers' terms.
- This is an unofficial community extension for Zangetsu and is not affiliated with or endorsed by the Zangetsu maintainers, TMDB, or Stremio.

## License

The code in this repository is available under the MIT License. See [LICENSE](LICENSE). Third-party names, logos, APIs, metadata, and content remain the property of their respective owners and are subject to their own terms.
