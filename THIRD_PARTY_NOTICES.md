# Third-party notices

Mewtwo Repo contains code and assets that come from other projects, and it references logos and trademarks owned by other people. This file is the index of all of it.

The per-licence notices themselves are **not** consolidated away — each one is preserved in the file that the licence requires:

| Notice | File |
|:--|:--|
| Apache-2.0 attribution for the Yuzono-derived providers | [NOTICE-YUZONO-ANIME-EXTENSIONS.md](NOTICE-YUZONO-ANIME-EXTENSIONS.md) |
| GPL-3.0 attribution for the CineStream port | [NOTICE-CINESTREAM.md](NOTICE-CINESTREAM.md) |

---

## Summary

| Component | Where | Licence | Status |
|:--|:--|:--|:--|
| Yuzono anime-extensions | `providers/serenity-animekai.js`, `providers/serenity-aniwave.js` | **Apache-2.0** | Notice preserved |
| CineStream CloudStream extension | `providers/cinestream.js` | **GPL-3.0** | Notice preserved |
| Zangetsu provider repository | `providers/anikoto.js`, `providers/hianime.js`, `providers/hdhub4u.js` | Asserted **MIT** by upstream | Attribution retained; see the note below |
| Zangetsu app mark | `assets/icon.svg` | **GPL-3.0** | Retained with attribution |
| Jellyfin icon | `index.json` (`jellyfin` logo) | **CC BY-SA 4.0** | Attributed, unmodified |
| Pokémon artwork | `index.json` (`megaplay` and `mewstream` logos) | **© The Pokémon Company** | **Flagged — see below** |
| Site favicons | `index.json` (most source logos) | Resolved at request time from the site being referenced | Hotlinked, not redistributed |
| AIOStreams logo | `index.json` (`aiostreams` logo) | Owned by the AIOStreams project | Hotlinked, not redistributed |
| CineStream icon | `index.json` (`cinestream` logo) | **GPL-3.0** (upstream project) | Covered by the GPL-3.0 notice |

---

## Apache-2.0 — Yuzono anime-extensions

`providers/serenity-animekai.js` and `providers/serenity-aniwave.js` include adapted components from the Apache-2.0-licensed [yuzono/anime-extensions](https://github.com/yuzono/anime-extensions) project.

Both files retain their `SPDX-License-Identifier: Apache-2.0` headers and the upstream attribution comments. The licence text is in [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0) and the attribution is in [NOTICE-YUZONO-ANIME-EXTENSIONS.md](NOTICE-YUZONO-ANIME-EXTENSIONS.md).

These two files are Apache-2.0. They are not relicensed by anything else in this repository, and they do not relicense anything else in it.

## GPL-3.0 — CineStream CloudStream extension

`providers/cinestream.js` is a derivative work of the GPL-3.0-licensed **CineStream CloudStream extension** by megix.

- Upstream repository: <https://github.com/SaurabhKaperwan/CSX>
- Upstream source tree: `CSX/tree/master/CineStream`
- Upstream licence: GNU General Public License v3.0
- Licence text: [LICENSE-CINESTREAM.md](LICENSE-CINESTREAM.md)
- Attribution: [NOTICE-CINESTREAM.md](NOTICE-CINESTREAM.md)

The file stays GPL-3.0. It does **not** relicense any other file here. What was ported and what was deliberately excluded is listed in [NOTICE-CINESTREAM.md](NOTICE-CINESTREAM.md).

## MIT (asserted upstream) — Zangetsu provider repository

`providers/anikoto.js`, `providers/hianime.js` and `providers/hdhub4u.js` are adapted from the [Spyou/zangetsu-providers](https://github.com/Spyou/zangetsu-providers) project, whose README states *"The code is MIT."*

> **Uncertainty, recorded deliberately.** At the time of writing, the upstream repository publishes **no `LICENSE` file**, so the exact licence text, the copyright holder and the year could not be verified. The attribution written by the original author of this repository is retained as-is rather than being second-guessed, and the upstream link is kept in each affected file's header comment. If upstream later publishes a licence file, this notice should be updated to quote it verbatim.

## GPL-3.0 — Zangetsu app mark

`assets/icon.svg` is a simplified reproduction of the Zangetsu application mark, taken from the [Zangetsu](https://github.com/Spyou/Zangetsu) project by Krishna Vishwakarma, which is licensed under the GNU GPL-3.0.

The mark identifies the app these sources belong to. It is **not** this repository's own logo, and it is not presented as one. The artwork in `assets/` that this project created — the hero banner, the section divider, the architecture diagram, the installation flow, the provider-flow diagram, the setup legend and the documentation header — is original and covered by the repository's MIT licence.

## CC BY-SA 4.0 — Jellyfin icon

The `jellyfin` source uses the official Jellyfin icon from [jellyfin/jellyfin-ux](https://github.com/jellyfin/jellyfin-ux/tree/master/logos/SVG), licensed under [CC BY-SA 4.0](https://github.com/jellyfin/jellyfin-ux/blob/master/LICENSE).

It is used unmodified and only to identify Jellyfin compatibility. This is an independent, unofficial integration and is **not endorsed by Jellyfin**.

## © The Pokémon Company — Pokémon artwork

The `megaplay` and `mewstream` sources use a Pokémon sprite, served from [PokeAPI/sprites](https://github.com/PokeAPI/sprites), as their icon.

That repository's `LICENCE.txt` states: *"All image contents within are Copyright The Pokémon Company. This repository is distributed under CC0 1.0 Universal."* The CC0 grant covers the repository's own contribution; the underlying character artwork remains owned by The Pokémon Company.

> **This is flagged, not resolved.** Using copyrighted character artwork as a public project's icon is a trademark and copyright question that belongs to the repository maintainers, not to the documentation. The original project artwork in `assets/` deliberately contains **no** Pokémon or other third-party character artwork. A neutral, original replacement icon for these two source entries would remove the ambiguity; that decision is left to the maintainers and has not been made unilaterally here.

## Resolved at request time — not redistributed

The following logos are **referenced by URL**, never bundled in this repository:

- `https://www.google.com/s2/favicons?sz=256&domain=…` — Google's favicon service, returning each site's own icon.
- `https://aiostreams.viren070.me/logo.png` — the AIOStreams project's logo.
- `https://raw.githubusercontent.com/SaurabhKaperwan/CSX/master/CineStream/icon.png` — the upstream CineStream icon, covered by the GPL-3.0 notice above.
- `https://raw.githubusercontent.com/jellyfin/jellyfin-ux/master/logos/…` — the Jellyfin icon described above.
- `https://raw.githubusercontent.com/PokeAPI/sprites/master/…` — described above.

Because these are hotlinked rather than copied, this repository does not redistribute them. The trademark and copyright in each remain with its owner, and each is used only to identify the service the source talks to.

---

## External services

These services are **not bundled, vendored or redistributed**. They are contacted at runtime by the sources, and each is operated by somebody else:

| Service | Used by | Purpose |
|:--|:--|:--|
| [TMDB](https://www.themoviedb.org) | TMDB-backed sources | Catalogue and artwork metadata |
| [AniList](https://anilist.co) | AniChan, Zenkai Player, several others | Anime metadata and id mapping |
| [MyAnimeList](https://myanimelist.net) | Zenkai Player, AIOStreams | Anime id mapping |
| [Kitsu](https://kitsu.io) | Mewstream, HiAnime | Anime metadata and episode stills |
| [AniDB](https://anidb.net) | AIOStreams, CineStream | Anime id mapping |
| [ARM](https://arm.haglund.dev) | CineStream | Anime id mapping |
| Stremio-compatible add-ons | TMDB + Stremio | Catalogue and playback |
| AIOStreams instances | AIOStreams | Playback |
| Jellyfin servers | Jellyfin | Catalogue and playback |
| [Wyzie](https://sub.wyzie.io) | CineStream | Subtitles |
| The streaming hosts each source targets | All sources | Playback |

Their own terms, rate limits and availability apply. **None of them is under this project's control, and none of them is endorsed by it.**

---

## How to comply when you redistribute

If you fork this repository or bundle its contents:

1. Keep [LICENSE](LICENSE), [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0) and [LICENSE-CINESTREAM.md](LICENSE-CINESTREAM.md) with the files they cover.
2. Keep every `NOTICE-*.md` file and this file intact.
3. Leave the `SPDX-License-Identifier` headers in `providers/serenity-animekai.js` and `providers/serenity-aniwave.js` in place.
4. Keep `providers/cinestream.js` under GPL-3.0, and keep its derivative-work header.
5. Do not present the Zangetsu app mark or the Pokémon artwork as your own.

---

<p align="center">
  <a href="README.md">Back to the repository</a> &nbsp;·&nbsp;
  <a href="README.md#licensing">Licensing</a>
</p>
