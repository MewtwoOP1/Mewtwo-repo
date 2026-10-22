# Crunchy-anime HLS playback proxy

UniqueStream/AnimeStream wraps the AES-128 HLS content key returned by its `key.bin` endpoint. A provider cannot transparently recover that key by returning the original `.m3u8` URL: the player expects a normal HLS key, while the site's endpoint returns an encrypted Base64 payload that must be requested with `x-am-media-id`.

This repository includes a Cloudflare Worker at `workers/crunchy-anime-hls-proxy.mjs`. It rewrites master/variant playlists and exposes a `/key` endpoint that performs the same SHA-256-derived AES-CBC key recovery used by the official extension.

## Deploy

1. In Cloudflare, create a Worker and paste the content of `workers/crunchy-anime-hls-proxy.mjs` into its editor. Deploy it.
2. Under Worker **Settings → Variables and Secrets**, add a **secret** named `PROXY_TOKEN`. Use a long random value.
3. Open the Worker URL and verify `/health` returns JSON with `"ok": true` and `"tokenConfigured": true`.
4. In Zangetsu, open the Crunchy-anime provider settings and set:
   - **HLS proxy URL**: the Worker origin, for example `https://your-worker.your-subdomain.workers.dev` (no path and no trailing slash).
   - **HLS proxy token**: the same value configured as `PROXY_TOKEN`.
5. Reopen the anime episode and select a Crunchy-anime source again.

The token is carried in the generated playlist/key URLs so it remains available to the HLS client's child-playlist requests. Do not share those generated URLs publicly. The Worker requires the token for proxy requests and only accepts public HTTPS upstream URLs.

## Routes

- `GET /health` — deployment health, no secrets returned.
- `GET /m3u8?url=<encoded-playlist-url>&mid=<media_id>&token=<secret>` — fetches and rewrites HLS playlists. Child playlists loop through the Worker so encryption-key tags are rewritten.
- `GET /key?url=<encoded-key-url>&mid=<media_id>&token=<secret>` — fetches `key.bin` with `x-am-media-id`, Base64-decodes the response, derives the AES-CBC key/IV from the media ID, and returns the recovered 16-byte HLS key.

Media segments remain on their upstream HTTPS CDN URL. The Worker does not host or store video files.

## Verification limits

Local regression tests cover Base64 handling, key recovery, authorization, URL validation, and playlist rewriting with mocked upstream responses. Live playback still depends on deploying the Worker and testing it against an accessible upstream stream.
