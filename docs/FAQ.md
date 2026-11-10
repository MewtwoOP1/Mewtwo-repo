# Frequently asked questions

---

## About the project

### What exactly is Mewtwo Repo?

A collection of **26 JavaScript sources** for the [Zangetsu](https://github.com/Spyou/Zangetsu) app. Each source is one self-contained file that the app downloads, installs and runs at runtime. You add a single repository URL to the app and then pick the sources you want.

It is not an app, not an extension format and not a media library. It is a source repository.

### Is this the same as the default Zangetsu source repository?

No. Zangetsu has its own default provider repository, [`Spyou/zangetsu-providers`](https://github.com/Spyou/zangetsu-providers), which ships with the app. Mewtwo Repo is an additional, community-maintained repository with its own sources — including aggregate sources such as CineStream and Mewstream that query many hosts at once.

### Does this repository host any video files?

No. It hosts JavaScript and documentation. Every stream is fetched at request time from a third-party service that somebody else operates. Those services change their domains, their markup and their availability without notice, and none of them is under this project's control.

### Which platforms does it work on?

Android, Android TV and iOS (beta) — anywhere Zangetsu runs. These are Zangetsu's own JavaScript sources, which is why they work on iOS where CloudStream, Aniyomi and Mihon extensions cannot be loaded.

### Do I need to install all 26 sources?

No. Install only what you use. They are completely independent of each other. Installing several gives you fallbacks when one site is down.

---

## Installing

### What exactly do I paste?

```text
https://raw.githubusercontent.com/MewtwoOP1/Mewtwo-repo/main/index.json
```

It must end in `index.json`. A `providers/*.js` URL is a single source, not a repository — pasting one into the *Add repo* dialog will not work.

### Where is the setting in the app?

**Settings → Providers → Zangetsu providers → Repositories → Add repo.**

On older Zangetsu builds the same screen is at **Settings → Sources → Add repo**.

### Do I need to rebuild or reinstall the app?

No. Sources are downloaded at runtime. There is no build step, no clone and no toolchain. Adding the repository URL is the entire installation.

### How do I update a source?

**Settings → Providers → Zangetsu providers → Repositories → Check for updates**, then **Update** on individual sources or **Update all (N)** for the repository. Android builds can also be set to update automatically at launch under **Settings → Providers → Source updates**.

### How do I know it worked?

Open **Settings → Providers → Source health** — *"Test which sources are working."* — or simply search for a title and open an episode.

---

## Configuration

### Do I need an API key?

For most sources, no. **Thirteen of the 26 sources expose no settings at all** — they handle sessions, cookies, tokens and decryption themselves.

**Three sources cannot work without something from you:**

| Source | What you need |
|:--|:--|
| **AIOStreams** | Your personalised `/stremio/<id>/<config>/manifest.json` URL |
| **TMDB + Stremio** | At least one add-on manifest URL |
| **Jellyfin** | Your server address and a login, or an API key |

**Two more work as installed but accept an optional key** that unlocks extra hosts: **Mewstream** (a Showbox token) and **CineStream** (a Showbox, Wyzie Subs or GramCinema credential — one key per host).

The full breakdown is in the [source configuration guide](SOURCE_CONFIGURATION.md).

### Where do I get a TMDB API key?

You do not need one. Zangetsu injects its own TMDB key, and every TMDB-backed source uses it unless you explicitly provide your own. If you do want your own, get it from [themoviedb.org](https://www.themoviedb.org/settings/api) — it is free for non-commercial use, and it is sent only to TMDB.

### Where do I get a Wyzie Subs key?

From [sub.wyzie.io](https://sub.wyzie.io). It is optional and only unlocks the Wyzie Subtitles provider inside CineStream.

### Where do I get the Showbox token?

It is the value of the `ui` cookie from a logged-in [febbox.com](https://www.febbox.com) session. It is optional and only affects the Showbox host, in both CineStream and Mewstream.

### Is it safe to share my AIOStreams manifest URL?

**No.** A personalised AIOStreams manifest URL usually embeds your configuration id and password. Treat it exactly like a password: never post it in an issue, a chat, a screenshot or a log. The same applies to Stremio add-on URLs that carry a token, and to any Jellyfin password or API key.

### Can I use my own server instead?

Yes, and that is often the best setup:

- **AIOStreams** points at your own instance, so your add-ons decide what plays.
- **TMDB + Stremio** points at your own add-on list.
- **TMDB + PencariMovie** can point at your own tokenised `/manifest.json` server instead of the public default.
- **Miruro** accepts your own API mirrors and your own server priority list.

---

## Using the sources

### Why does a title appear in search but offer no stream?

Because a source does two independent jobs. The **catalogue half** supplies the title, artwork and episode list; the **playback half** supplies the playable link. A title can exist in the catalogue while the upstream has no working file for that episode. That is an upstream condition, not a broken app.

### Why are there several streams for one episode?

Because a source can usually reach the content through more than one host, and any one of them may be down, slow or blocked. If the first stream stalls, try the next one.

### Which source should I pick?

| For | Try |
|:--|:--|
| Movies and series, zero setup | **TMDB + PencariMovie** |
| Anime, sub and dub, automatic fallback | **Miruro** |
| Anime, using AniList titles | **Zenkai Player** |
| Many anime sites at once | **Mewstream** |
| The widest movie and series coverage | **CineStream** |
| Your own add-ons | **TMDB + Stremio** |
| Your own AIOStreams setup | **AIOStreams** |
| Your own Jellyfin library | **Jellyfin** |

The [source catalogue](EXTENSIONS.md) compares all 26.

### Do these sources work offline?

No. Every source is a live client of a remote service. Nothing is cached for offline use.

### Does the app report an AniList error — is that one of these sources?

No. AniList is the **app's own** metadata service, not a source from this repository. Nothing you install here changes it. Wait and retry, or switch the app's anime metadata provider if that option is available to you.

### Can I use these sources on a TV?

Yes. The Android TV build loads the same repositories and the same settings.

---

## Maintenance and reliability

### A source stopped working. Is it broken?

Most often the upstream site changed. These sources scrape sites that nobody here controls, so markup and domain changes are routine. Update the source first — host lists and selectors are updated regularly. If it still fails, open an issue with the title and the app log.

### How often do sources change?

Often enough that updating is a routine habit. Tap **Check for updates** every few weeks.

### Can I use several sources for the same kind of content?

That is the recommended setup. Fallbacks are the whole point of having more than one.

### What does "Source health" do?

It tests each installed source and tells you which ones answer. Run it before opening an issue — it narrows a report down enormously.

---

## Project questions

### How do I contribute a new source?

Read the [development guide](DEVELOPMENT.md) and [CONTRIBUTING.md](../CONTRIBUTING.md), then open a pull request. The essentials: add `providers/<name>.js`, register it in `index.json`, add `tests/<name>.test.js`, and make sure `node scripts/check-and-run.mjs` passes.

### What licence applies?

Not one licence for the whole repository. Original code is MIT. Two providers are Apache-2.0. One provider — `providers/cinestream.js` — is GPL-3.0 as a derivative work and stays GPL-3.0; it does not relicense anything else. See [Licensing](README.md#licensing) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

### Can I fork this and publish my own repository?

Yes. Keep the licence notices attached to the files they belong to, keep the GPL-3.0 file under GPL-3.0, and keep the attribution notices intact.

### Who do I contact about a third-party streaming site?

Its own operators, not this project. This repository only ships client code; the sites themselves are not ours to fix or moderate.

---

## Related documentation

- [Installation guide](INSTALLATION.md)
- [Getting started](GETTING_STARTED.md)
- [Source catalogue](EXTENSIONS.md)
- [Source configuration](SOURCE_CONFIGURATION.md)
- [Architecture](ARCHITECTURE.md)
- [Troubleshooting](TROUBLESHOOTING.md)

---

<p align="center">
  <a href="README.md">Documentation index</a> &nbsp;·&nbsp;
  <a href="#frequently-asked-questions">Back to top ↑</a>
</p>
