<div align="center">
  <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/150.png" alt="Mewtwo" width="112" />

  <h1>Mewtwo♡ Repo</h1>
  <p><strong>Community-maintained sources for Zangetsu</strong></p>
  <p>One repo. Three focused setup threads. Clear steps from catalogue to playback.</p>

  <a href="https://github.com/Spyou/Zangetsu"><img src="https://img.shields.io/badge/APP-Zangetsu-7C3AED?style=for-the-badge" alt="For Zangetsu" /></a>
  <a href="https://raw.githubusercontent.com/MewtwoOP1/Mewtwo-repo/main/index.json"><img src="https://img.shields.io/badge/SOURCE-index.json-0F766E?style=for-the-badge" alt="Source manifest" /></a>
  <img src="https://img.shields.io/badge/SETUP_GUIDES-3-2563EB?style=for-the-badge" alt="Three setup guides" />
</div>

---

## Start here

This repository contains JavaScript sources for [Zangetsu](https://github.com/Spyou/Zangetsu). This README documents **only these three integrations**:

| Source | Catalogue and metadata | Playback comes from | What you need |
| --- | --- | --- | --- |
| **TMDB + PencariMovie** | TMDB | PencariMovie server | The default server is prefilled |
| **AIOStreams** | TMDB | Your configured AIOStreams instance | A personalized manifest URL |
| **TMDB + Stremio** | TMDB | Your Stremio-compatible add-ons | One or more add-on manifest URLs |

> **Important:** TMDB helps Zangetsu find titles and episodes. It does not provide the playable video links for these integrations. Playback depends on the configured provider or add-ons being available.

## Thread 00 — Add this repository

Do this once. Skip to your preferred setup thread if the repository is already added.

1. Open **Zangetsu**.
2. Go to **Settings → Sources → Add repo**.
3. Paste this repository's manifest URL:

   ```text
   https://raw.githubusercontent.com/MewtwoOP1/Mewtwo-repo/main/index.json
   ```

4. Save/add the repository.
5. Open its source list and install **only the integration you plan to use**.

---

## Setup threads

<details>
<summary><strong>Thread 01 — TMDB + PencariMovie</strong> <code>Easy setup · default server included</code></summary>

### What this does

TMDB supplies the movie and series catalogue, search, title details, episode lists, artwork, and ratings. PencariMovie is queried for playback streams.

### Follow the steps

**01.** Add the repository using [Thread 00](#thread-00--add-this-repository), then install **TMDB + PencariMovie**.

**02.** Open **TMDB + PencariMovie → Settings**.

**03.** Check these settings:

| Setting | What to do |
| --- | --- |
| **TMDB API Key** | Leave blank to use Zangetsu's built-in TMDB key. A personal v3 API key is optional. |
| **PencariMovie server manifest URL** | The public default is already filled in. Leave it as-is unless you have your own valid, tokenized `/manifest.json` URL. |
| **Max streams per add-on** | Starts at **25**. Change it only if you want to consider fewer or more results (up to 100). |

**04.** Save the settings, search for a movie or series, open its detail page, and select a playable item when results appear.

### If nothing appears

- Make sure the PencariMovie manifest URL has not been accidentally cleared or truncated.
- Try another title, then try again later if the upstream service is unavailable.
- A title appearing in TMDB confirms the catalogue lookup worked; it does **not** guarantee PencariMovie currently has a playable stream.

</details>

<details>
<summary><strong>Thread 02 — AIOStreams</strong> <code>Movies · series · TMDB-indexed anime</code></summary>

### What this does

TMDB handles catalogue discovery and episode metadata. AIOStreams is used for stream lookup from your configured instance; this source does not import every Stremio add-on automatically.

### Before opening Zangetsu

**01.** Open your AIOStreams instance and configure the add-ons and stream sources you want to use.

**02.** Copy your **personalized manifest URL**. It should follow this general shape:

```text
https://YOUR-AIOSTREAMS-HOST/stremio/YOUR-ID/YOUR-CONFIG/manifest.json
```

Use the real URL supplied by your instance. The example above is only a format guide.

### Configure the source

**03.** In Zangetsu, install **AIOStreams**, then open **AIOStreams → Settings**.

**04.** Set the fields:

| Setting | What to do |
| --- | --- |
| **AIOStreams Manifest URL** | Paste your full personalized manifest URL. This is required. |
| **AIOStreams UserData (base64)** | Optional. Add the value only if your instance requires it; it takes precedence over Basic authentication. |
| **TMDB API key or Read Access Token** | Optional. Leave blank to use Zangetsu's built-in TMDB key. |
| **Show torrent / P2P streams** | Leave off unless your player supports magnet links. |
| **Maximum concurrent requests** | The default is **5** simultaneous requests. This is a concurrency limit, not a cap of five returned links. |
| **AIOStreams request timeout** | Defaults to **7 seconds**. |
| **Total stream lookup deadline** | Defaults to **8 seconds**. |

**05.** Save the settings. Search for a title through AIOStreams in Zangetsu, open the title from this source, then try playback.

### If results are slow or missing

- Recheck the entire manifest URL, including the `/stremio/.../manifest.json` path.
- Check that the add-ons are configured and working in your AIOStreams instance.
- If lookups time out, review the per-add-on timeout settings on the AIOStreams side. Increasing Zangetsu's timeout cannot make an upstream add-on respond faster.
- Keep manifest URLs and UserData values private if they contain account-specific identifiers or access credentials.

</details>

<details>
<summary><strong>Thread 03 — TMDB + Stremio</strong> <code>Bring your own add-ons</code></summary>

### What this does

TMDB provides the catalogue, search, title details, and episode metadata. Playback streams are requested from the Stremio-compatible add-ons that you configure.

### Follow the steps

**01.** Add the repository using [Thread 00](#thread-00--add-this-repository), then install **TMDB + Stremio**.

**02.** Open **TMDB + Stremio → Settings**.

**03.** Paste the manifest URL for each Stremio-compatible add-on into **Stremio Add-on URLs**.

You can enter **multiple URLs**, separated by commas or placed on separate lines. Use the complete manifest URL, commonly ending in `/manifest.json`. Keep any required path or query token intact.

Example format only:

```text
https://addon-one.example/manifest.json
https://addon-two.example/manifest.json
```

**04.** Review the remaining settings:

| Setting | What to do |
| --- | --- |
| **TMDB API Key** | Leave blank to use Zangetsu's built-in key. A personal TMDB v3 key is optional. |
| **Max streams per add-on** | Defaults to **25** streams considered from each add-on. Available options range from 5 to 100. |

**05.** Save the settings, search for a movie or series, open it from **TMDB + Stremio**, and choose a returned stream.

### If no streams are returned

- Confirm each add-on manifest URL opens and belongs to a Stremio-compatible add-on that provides the `stream` resource.
- Check whether the add-on requires a token, configuration, or specific URL path.
- Verify the add-on can return streams for the selected title. Catalogue results can appear even when no configured add-on has a matching stream.
- The source ignores individual failed add-on requests so other configured add-ons can still return results.

</details>

---

## Quick troubleshooting

| Symptom | Check first |
| --- | --- |
| Titles load, but there are no playable links | Playback provider/add-on status and manifest URL |
| AIOStreams times out | AIOStreams per-add-on timeouts, then the source timeout settings |
| A series opens but an episode has no result | Try the correct season/episode and confirm the selected add-on supports series streams |
| One add-on fails but others work | Expected: a failing add-on may return no streams while other configured add-ons are still queried |

## Project notes

- This repository does **not** host, upload, store, or serve movies, series, anime, or video files.
- Metadata, artwork, and playback URLs are supplied by TMDB or third-party providers and remain subject to their availability, terms, and policies.
- Users are responsible for ensuring their use of third-party services and any content they access complies with applicable laws and service terms.
- This is an unofficial community project and is not affiliated with or endorsed by Zangetsu, TMDB, Stremio, AIOStreams, or PencariMovie.
- The repository uses mixed licensing: most code is MIT-licensed; the MovieBox IN port is separately GPL-3.0-only. See [LICENSE](LICENSE) and [LICENSES/GPL-3.0.txt](LICENSES/GPL-3.0.txt).

## Credits

The provider manifest and JavaScript interface follow the self-contained source model documented by [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers). This repository is independently maintained and is not the official Zangetsu provider repository.

<div align="center">
  <sub>Made for Zangetsu · Keep your manifest URLs private · Check upstream availability if playback stops working</sub>
</div>
