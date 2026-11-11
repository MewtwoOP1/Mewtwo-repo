# Getting started

A walkthrough from an empty app to your first episode. No technical knowledge assumed.

---

## The one-minute summary

1. **Add the repository** — paste one URL into the app.
2. **Install a source** — pick one from the list the repository shows.
3. **Configure it** — most sources need nothing; the rest tell you what to paste.
4. **Search** — find a title.
5. **Choose a source** — the app may offer the same title from several sources.
6. **Play** — open the episode and pick a stream.

The full detail for each step is below.

---

## Step 1 — Add the repository

Mewtwo Repo is not an app. It is a **collection of sources** that the Zangetsu app downloads and runs for you. You point the app at it once.

1. Open **Settings → Providers → Zangetsu providers → Repositories → Add repo**.
   <br>*On older builds: **Settings → Sources → Add repo**.*
2. Paste this into **Manifest URL**:

   ```text
   https://raw.githubusercontent.com/MewtwoOP1/Mewtwo-repo/main/index.json
   ```

3. Leave **Custom name** blank unless you want to rename it, then save.

The repository now appears in the **Repositories** tab.

<details>
<summary>What just happened?</summary>

The app downloaded a small JSON file — the *manifest* — that describes every source in this repository: its name, version, type, language, icon and settings. Nothing was installed yet, and nothing can break at this stage.

</details>

---

## Step 2 — Install a source

Open the repository you just added. Every source it publishes is listed with a name and an **Install** button.

**You do not need all 25.** Install the one that suits what you want to watch:

| I want to watch… | Try this first |
|:--|:--|
| Movies and series, with no setup at all | **TMDB + PencariMovie** |
| Anime, with dub and sub and a fallback server | **Miruro** |
| Anime, using AniList for titles | **Zenkai Player** |
| The widest movie and series coverage | **CineStream** |
| Streams from my own Stremio add-ons | **TMDB + Stremio** |
| Streams from my own AIOStreams setup | **AIOStreams** |
| My own Jellyfin library | **Jellyfin** |

Tap **Install**. The source moves to the **Installed** tab and becomes selectable as your active source.

> Installing several sources is normal and useful — it gives you fallbacks when one site is down. But start with one so you know exactly where a problem would come from.

---

## Step 3 — Configure the source

Open the installed source's **Source settings**.

**If your source shows no settings at all, you are done.** Thirteen sources in this repository work exactly like that — they handle sessions, tokens and decryption on their own.

**If it does show settings**, check the table in the [source configuration guide](SOURCE_CONFIGURATION.md#at-a-glance) to see what is actually required:

| Source | What you must fill in |
|:--|:--|
| **AIOStreams** | **AIOStreams Manifest URL** — copy it from your own AIOStreams instance |
| **TMDB + Stremio** | **Streaming Add-on URLs** — the manifest URL of at least one add-on that provides streams |
| **Jellyfin** | **Server address**, plus **Username** and **Password** (or an API key) |
| **TMDB + PencariMovie** | Nothing — the public server URL is already filled in |
| **Miruro** | Nothing — three API mirrors and the server order are already filled in |
| **Zenkai Player** | Nothing — but you may want a different server than **MegaPlay** |
| **CineStream** | Nothing — each key unlocks one specific host |
| **AnimeOnsen, AnimeGG, AnimeAV1, AnimeKai, AniWave** | Nothing — every default works |

Save your settings.

> [!WARNING]
> Never paste a personal manifest URL, token or password into a chat, a screenshot or an issue. A manifest URL for AIOStreams or Stremio usually embeds your own access credentials. Treat every value in these settings as a secret.

---

## Step 4 — Search for something

Open **Search** and type a title.

- **Results appear** — carry on to step 5.
- **No results** — try a shorter or more exact title, and check that the right source is the active one. See [Search returns nothing](TROUBLESHOOTING.md#search-returns-no-results).

---

## Step 5 — Choose the source

The same title often exists in more than one source. When Zangetsu shows results from several sources, each result is labelled with the source it came from.

- **Results from one source** — tap it and continue.
- **Results from several** — pick any of them to start; you can go back and try another if it turns out to be the one that does not work.

The detail page then shows the title's artwork, description, score and, for series, a season and episode list.

---

## Step 6 — Play

1. Tap the episode you want.
2. Zangetsu asks the source for playable links. This can take a second or two — some sources query several hosts at once to find the best one.
3. A list of streams appears, usually labelled with the quality (**1080p**, **720p**, **Auto**), the server and sometimes the audio track.
4. Tap a stream to play it.

**If no streams appear,** the catalogue worked but the playback half did not. That is the single most common issue and it is nearly always a configuration or upstream problem rather than a broken app. Go to [Titles load but no streams appear](TROUBLESHOOTING.md#titles-load-but-no-streams-appear).

---

## Understanding what you are seeing

### Catalogue and playback are two different things

A source does two jobs, and they fail independently:

| | What it does | Where it comes from |
|:--|:--|:--|
| **Catalogue** | Titles, artwork, descriptions, scores, season and episode lists | TMDB, AniList, or the source's own site |
| **Playback** | The playable link for one episode | The source's own hosts, your add-ons, or your server |

So a title can appear perfectly in search while offering no stream at all. That means the *playback* side is unavailable — not that the app is broken, and not that the title does not exist.

### Why several streams for one episode

A source usually offers more than one link because it can reach the content through more than one host, and any one of them may be down, slow, or geo-blocked. If the first stream stutters or refuses to start, try the next one.

### Why a source works one day and not the next

These sources talk to sites that nobody here controls. When a site changes its markup, rotates its domain, or adds a bot check, the source needs an update. That happens regularly, and it is why the repository ships updates rather than a one-time install. See [Updating sources](INSTALLATION.md#step-5--updating-sources).

---

## A comfortable first setup

If you are new to this, this combination is a good starting point:

| Source | Why |
|:--|:--|
| **Miruro** | Anime, with dub and sub, and it falls back between fourteen servers on its own |
| **TMDB + PencariMovie** | Movies and series, with nothing to configure |

Add more once you know which sites you actually use.

---

## Keeping it working

| Habit | Why |
|:--|:--|
| Tap **Check for updates** every few weeks | Upstream sites change; a source update is usually the fix |
| Keep two sources for the same kind of content | One goes down, the other keeps working |
| Run **Settings → Providers → Source health** when something breaks | It tells you which sources answer and which do not |
| Never share a settings screenshot | Values in these settings can be credentials |

---

## Related documentation

- [Installation guide](INSTALLATION.md) — the complete installation reference
- [Source catalogue](EXTENSIONS.md) — all 25 sources
- [Source configuration](SOURCE_CONFIGURATION.md) — every setting, step by step
- [Troubleshooting](TROUBLESHOOTING.md) — symptom-by-symptom fixes
- [FAQ](FAQ.md) — common questions

---

<p align="center">
  <a href="README.md">Documentation index</a> &nbsp;·&nbsp;
  <a href="#getting-started">Back to top ↑</a>
</p>
