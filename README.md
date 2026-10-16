# Zangetsu Extensions

A small Zangetsu source repository with separate metadata and streaming extensions.

## Sources

- **TMDB Metadata** provides trending/popular movie and series rows, search, title details, episode lists, posters, and TMDB/IMDb IDs. It follows the TMDB catalogue approach used by the official [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers) sources. The app supplies its TMDB API key; this repository does not store one.
- **Stremio Stream Bridge** queries user-configured Stremio-compatible add-ons for playable HTTP(S) streams. It deliberately does not provide catalogues or metadata.

## Install

Add this repository in Zangetsu under **Settings → Sources → Add repo**:

```
https://raw.githubusercontent.com/MewtwoOP1/Zangetsu-repo/main/index.json
```

Install both **TMDB Metadata** and **Stremio Stream Bridge**. Use TMDB Metadata to browse and search. Open Stremio Stream Bridge settings and paste one or more stream add-on manifest URLs, separated by commas or new lines. URLs ending in `manifest.json` are accepted, and query parameters are preserved for private add-ons.

The metadata source hands playback to the installed Stremio Stream Bridge. If the bridge is not installed or no stream add-on is configured, metadata browsing still works but playback returns no streams.

## Compatibility notes

- Only direct HTTP(S) stream URLs are returned. Torrent-only results are omitted because Zangetsu's `VideoSource` contract requires a playable URL.
- Series requests use the IMDb ID with season and episode when available, then try common TMDB ID forms as fallbacks.
- Each source's version is tracked in both its JavaScript file and `index.json`; bump both when publishing a change.
