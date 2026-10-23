<div align="center">
  <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/150.png" width="96" alt="Mewtwo artwork" />

  <h1>Mewtwo Repo</h1>
  <p><strong>Community sources for Zangetsu</strong></p>
  <p>One catalogue. Your choice of playback providers.</p>

  <a href="https://github.com/Spyou/Zangetsu"><img src="https://img.shields.io/badge/MADE_FOR-Zangetsu-6E40C9?style=for-the-badge" alt="Made for Zangetsu" /></a>
  <a href="https://raw.githubusercontent.com/MewtwoOP1/Mewtwo-repo/main/index.json"><img src="https://img.shields.io/badge/SOURCE-Manifest-0969DA?style=for-the-badge" alt="Source manifest" /></a>
</div>

---

## Welcome

This repository contains community-maintained JavaScript sources for [Zangetsu](https://github.com/Spyou/Zangetsu). This guide covers three integrations only. Pick the one that matches your setup; **you do not need to configure all three**.

<table>
  <tr>
    <th align="left">Integration</th>
    <th align="left">Catalogue</th>
    <th align="left">Playback</th>
  </tr>
  <tr>
    <td><strong>TMDB + PencariMovie</strong></td>
    <td>TMDB</td>
    <td>PencariMovie server</td>
  </tr>
  <tr>
    <td><strong>AIOStreams</strong></td>
    <td>TMDB</td>
    <td>Your AIOStreams instance</td>
  </tr>
  <tr>
    <td><strong>TMDB + Stremio</strong></td>
    <td>TMDB</td>
    <td>Your Stremio-compatible add-ons</td>
  </tr>
</table>

> [!IMPORTANT]
> **Catalogue and playback are separate.** TMDB provides title and episode metadata; it does not provide the playable streams described in these guides. Playback depends on the configured provider or add-ons being available.

## Getting started

Add this repository once, then install the integration you want.

- In Zangetsu, open **Settings → Sources → Add repo**.
- Paste the manifest URL below and save it.
- Open the repository's source list and install your preferred integration.

<pre align="center"><code>https://raw.githubusercontent.com/MewtwoOP1/Mewtwo-repo/main/index.json</code></pre>

## Choose your setup

<details>
<summary><strong>TMDB + PencariMovie</strong> <sub>Easy setup · default server included</sub></summary>

### How it works

TMDB supplies search, the movie and series catalogue, title details, episode lists, artwork, and ratings. PencariMovie is queried separately for playback streams.

### Configure it

- **Install the source:** Add this repository above, then install **TMDB + PencariMovie**.
- **Open settings:** Go to **TMDB + PencariMovie → Settings**.
- **TMDB API key:** Leave this blank to use Zangetsu's built-in key. A personal TMDB v3 API key is optional.
- **PencariMovie server manifest URL:** The public default is prefilled. Leave it unchanged unless you have your own valid, tokenized `/manifest.json` URL.
- **Max streams per add-on:** Starts at **25**. Choose a different limit if needed; the available range is 5–100.
- **Try playback:** Save your settings, search for a title, open its details, and select a result if streams are available.

### When streams are missing

- Check that the manifest URL has not been cleared, truncated, or mistyped.
- Test another title. A title appearing in TMDB confirms the catalogue lookup worked, but does not guarantee PencariMovie has a playable stream for it.
- If the configuration looks correct, the upstream service may be temporarily unavailable.

</details>

<details>
<summary><strong>AIOStreams</strong> <sub>Movies · series · anime indexed by TMDB</sub></summary>

### How it works

TMDB handles catalogue discovery and episode metadata. AIOStreams supplies playback results from the add-ons configured in your own instance. **Adding this source does not automatically import every Stremio add-on.**

### Prepare your AIOStreams URL

- Open your AIOStreams instance and configure the add-ons and stream sources you want to use.
- Copy the **personalized manifest URL** supplied by your instance. It should follow this general pattern:

```text
https://YOUR-AIOSTREAMS-HOST/stremio/YOUR-ID/YOUR-CONFIG/manifest.json
```

Use the actual URL from your instance; the example is only a format guide.

### Configure it in Zangetsu

- **Install the source:** Add this repository, then install **AIOStreams**.
- **AIOStreams Manifest URL:** Paste the full personalized URL. This field is required.
- **AIOStreams UserData (base64):** Optional. Add it only if your instance requires it. When provided, this value takes precedence over Basic authentication.
- **TMDB API key or Read Access Token:** Optional. Leave blank to use Zangetsu's built-in TMDB key.
- **Show torrent / P2P streams:** Keep this off unless your player supports magnet links.
- **Maximum concurrent requests:** Defaults to **5 simultaneous requests**. This limits concurrency, not the number of links that can be returned.
- **AIOStreams request timeout:** Defaults to **7 seconds**.
- **Total stream lookup deadline:** Defaults to **8 seconds**.

Save your settings, search for a title through AIOStreams, open it from this source, and try playback.

### When results are slow or missing

- Recheck the full manifest URL, including the `/stremio/.../manifest.json` path.
- Confirm the relevant add-ons are enabled and working in your AIOStreams instance.
- If requests time out, review the per-add-on timeouts in AIOStreams. A longer client-side timeout cannot make an upstream add-on respond faster.
- Treat personalized manifest URLs and UserData values like credentials if they contain account-specific identifiers or access tokens. **Do not post them publicly.**

</details>

<details>
<summary><strong>TMDB + Stremio</strong> <sub>Connect your own compatible add-ons</sub></summary>

### How it works

TMDB provides search, title details, the catalogue, and episode metadata. Playback streams are requested from the Stremio-compatible add-ons that you configure.

### Configure it

- **Install the source:** Add this repository, then install **TMDB + Stremio**.
- **Open settings:** Go to **TMDB + Stremio → Settings**.
- **Stremio Add-on URLs:** Paste the manifest URL for each compatible add-on. You can enter multiple URLs, separated by commas or placed on separate lines. Keep any required path and query token intact; a manifest URL commonly ends in `/manifest.json`.
- **TMDB API key:** Leave blank to use Zangetsu's built-in key. A personal TMDB v3 API key is optional.
- **Max streams per add-on:** Defaults to **25** streams considered from each add-on. Available limits range from 5 to 100.

Example URL format (replace these with actual add-on URLs):

```text
https://addon-one.example/manifest.json
https://addon-two.example/manifest.json
```

Save the settings, search for a movie or series, open it from **TMDB + Stremio**, and choose a stream if one is returned.

### When no streams are returned

- Confirm each URL is valid and points to a Stremio-compatible add-on that provides the `stream` resource.
- Check whether the add-on requires a specific configuration, access token, or URL path.
- Confirm that the add-on supports streams for the selected title and episode. Catalogue results can appear even when no configured add-on has a matching stream.
- A failed add-on request does not necessarily stop other configured add-ons from returning results.

</details>

---

## Troubleshooting at a glance

| What you see | What to check |
| --- | --- |
| Titles load, but no playable links appear | Provider status, manifest URL, and stream availability |
| AIOStreams times out | AIOStreams per-add-on timeouts, then the source timeout settings |
| A series opens, but an episode has no results | Correct season and episode; add-on support for series streams |
| One Stremio add-on fails while others work | Confirm the failing add-on's URL and configuration; others may still return results |

## Project notes

- This repository does **not** host, upload, store, or serve movies, series, anime, subtitles, or video files.
- Metadata, artwork, and playback URLs come from TMDB or third-party services. Availability and terms are controlled by their respective operators.
- You are responsible for ensuring your use of third-party services and any content you access complies with applicable laws and service terms.
- This is an unofficial community project. It is not affiliated with or endorsed by Zangetsu, TMDB, Stremio, AIOStreams, or PencariMovie.
- Most code is licensed under MIT. The MovieBox IN port is separately licensed under GPL-3.0-only. See [LICENSE](LICENSE) and [LICENSES/GPL-3.0.txt](LICENSES/GPL-3.0.txt).

## Credits

The provider manifest and JavaScript interface follow the self-contained source model documented by [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers). This repository is independently maintained and is not the official Zangetsu provider repository.

<div align="center">
  <sub>Made for Zangetsu · Keep private manifests private · Check upstream availability when playback stops working</sub>
</div>
