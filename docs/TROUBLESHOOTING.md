# Troubleshooting

Symptom-by-symptom fixes. Each entry says what causes the problem, how to recognise it, what you can do about it, and when the fault is upstream rather than in the app.

---

## Start here

Before anything else, run the app's own diagnostic:

**Settings → Providers → Source health** — *"Test which sources are working."*

It tells you which installed sources answered and which did not. That single check resolves most of the confusion below.

Then answer one question honestly:

> **Do the titles appear?**

- **Titles appear, but no streams do** → the catalogue half works and the playback half does not. Start at [Titles load but no streams appear](#titles-load-but-no-streams-appear).
- **Nothing appears at all** → start at [The source returns nothing at all](#the-source-returns-nothing-at-all).

---

## Installation problems

### The repository does not appear

**Cause.** Almost always the URL. In order of likelihood:

1. The URL was truncated, mistyped, or pasted from a rendered page rather than the code block.
2. A **provider file** URL was pasted instead of the manifest — `providers/xyz.js` is one source, not a repository.
3. The device cannot reach `raw.githubusercontent.com`. Some networks and DNS configurations block it.
4. The app has no network permission, or a battery manager blocked the background fetch.

**How to identify it.** Open the manifest URL in the device's own browser. If it shows JSON, the URL and the network are fine and the problem is in the app's repository list. If it shows an error page, it is the network or the URL.

**What to try.**

- Remove the repository and re-add it using the copy button.
- Verify the URL is exactly:

  ```text
  https://raw.githubusercontent.com/MewtwoOP1/Mewtwo-repo/main/index.json
  ```

- Check the app's network permission and any battery-optimisation exemption.

**Likely upstream?** No. This is entirely local.

### The repository appears but lists no sources

**Cause.** The manifest was fetched but produced no source list — normally a truncated URL that still resolved to something.

**What to try.** Re-add it with the exact URL and confirm that [the raw manifest](https://raw.githubusercontent.com/MewtwoOP1/Mewtwo-repo/main/index.json) contains a `sources` array when opened in a browser.

### Install fails, or the source never reaches Installed

**Cause.** The provider file could not be downloaded or parsed.

**What to try.**

- Confirm the source is listed in the repository at all. If it is not, it is not published by this repository.
- Open the provider's file URL on the device to check that it downloads.
- Remove the repository, re-add it and try again — a failed first attempt is sometimes cached.

---

## Search and catalogue problems

### Search returns no results

**Cause.** One of:

1. The title is not in that source's catalogue. Different sites carry different libraries.
2. The active source is not the one you think. The app has a single active source at a time.
3. The upstream search endpoint changed, so the query no longer matches the new markup.
4. The request was blocked upstream — Cloudflare or a rate limit.

**How to identify it.** Search for the same title in a different installed source. If another source finds it, the title exists and the problem is with that one source. If no source finds it, the title may simply not be in these catalogues.

**What to try.**

- Try a shorter or more exact title.
- Switch the active source and search again.
- Update the source — a search that worked yesterday and fails today is usually an upstream markup change.

**Likely upstream?** Usually. Title coverage and upstream blocking are both upstream realities.

### The source returns nothing at all

**Cause.** The source's catalogue backend never answered. Usually one of:

1. The source needs configuration you have not entered — a manifest URL, an add-on list or a server login.
2. The device has no working connection, or DNS is failing.
3. The upstream blocked the request, or the site's markup changed so the parser finds nothing.

**How to identify it.** Open the source's own website on the device. If the site works and the source does not, it is the source. If the site does not work either, it is the network or the site. **Source health** confirms which sources answer.

**What to try.**

- Check the source's settings for anything left blank.
- Check that the device's date, time and time zone are automatic — a wrong clock breaks TLS and signed URLs.
- Update the source.
- Try another source for the same kind of content.

**Likely upstream?** Often.

### A source works but shows nothing for one specific title

**Cause.** The title is not in that source's catalogue, or the upstream site's own search cannot find it either.

**How to identify it.** Open the source's own website on the same device and search for the title there. If the website cannot find it, the source is faithfully reporting reality.

**What to try.** Nothing in the source — try a different source for that title.

---

## Playback problems

### Titles load but no streams appear

This is the single most common state, and it has a small number of causes.

**Cause, in order of likelihood.**

1. **The source needs configuration you have not entered.** [AIOStreams](SOURCE_CONFIGURATION.md#aiostreams) needs its manifest URL; [TMDB + Stremio](SOURCE_CONFIGURATION.md#tmdb--stremio) needs at least one add-on URL; [Jellyfin](SOURCE_CONFIGURATION.md#jellyfin) needs a server and a login.
2. **The upstream has no stream for that episode.** Many sites have the catalogue entry but no playable file for a given episode.
3. **Every host the source tried is currently down**, or blocked your device.
4. **The source needs a credential you have not supplied** — for example Showbox inside Mewstream, or Gramcinema inside CineStream.

**How to identify it.**

- Open **Source settings** for the source and confirm every required field is filled in.
- Try a different, very popular title. If popular titles also return nothing, it is configuration or a blocked network.
- Try the same episode in a different source.

**What to try.**

- Fill in the missing configuration from the [source configuration guide](SOURCE_CONFIGURATION.md).
- In **CineStream**, switch off the hosts you do not need so the remaining ones get the whole time budget.
- In **Mewstream**, switch off individual adapters to isolate a failing host.
- Update the source.

**Likely upstream?** Frequently. A catalogue entry with no stream is a normal upstream condition.

### A stream starts and then fails

**Cause.**

1. The stream URL expired between resolution and playback.
2. The CDN is refusing the request — often a missing `Referer` or `Origin` header.
3. The host is serving an HTML page instead of media.
4. The device's codec cannot handle the format.

**How to identify it.** Go back and pick a **different** stream for the same episode. If every stream fails, it is the device's codec support or the network. If only one fails, it is that host.

**What to try.**

- Try another stream — providers list several, one per host.
- Try the same episode in another source.
- For Jellyfin, check the server's own logs, storage permissions and FFmpeg setup.

**Likely upstream?** Usually. An expired signed URL is an upstream condition that no client can avoid.

### Only some hosts work

**Cause.** The failing hosts are down, blocked, or have changed their markup or domain.

**What to try.**

- **CineStream** — switch the failing providers off in **Enabled providers**. The remaining ones then get the full playback budget.
- **Mewstream** — switch the failing adapter off.
- **Miruro** — remove the failing server id from **Disabled streaming servers**.
- Update the source, which usually carries fresh host lists.

### Playback is very slow

**Cause.** The source queries many hosts concurrently and waits for the slowest of them.

**What to try.**

- **CineStream** — lower **Provider concurrency** from 10 to 4 or 6, and disable hosts you do not need.
- **Miruro** — lower **Maximum server attempts per episode**.
- **AIOStreams** — raise **AIOStreams request timeout** and **Total stream lookup deadline**, and also raise the per-add-on timeouts inside your AIOStreams instance.
- **AniZone, AnimeGG, AnimeAV1, AnimeOnsen** — raise **Request timeout** to 18 seconds.

**Likely upstream?** Often. A client timeout cannot make a slow upstream faster.

---

## Credential problems

### An API key or token is rejected

**Cause.** The credential is wrong, expired, revoked, or pasted with stray whitespace.

**How to identify it.** Compare the stored value with a freshly copied one, character by character. Watch for a trailing newline and for a leading `-` or quote copied along with the value.

**What to try.**

- Re-copy the credential from the provider's own site and replace the stored value.
- Confirm you copied the right kind of value. **Showbox** wants the `ui` cookie value, not the whole cookie header. **Wyzie Subs** wants the API key, not the account id. **GramCinema** wants the bearer token, not the session cookie.
- Check whether the account the credential belongs to is still active.

**Likely upstream?** Usually — credential lifetimes are set by the service.

### The Jellyfin login fails with 401

**Cause.**

- For a normal Jellyfin server: the account name or password is wrong.
- For AIOStreams: the configuration UUID or alias is wrong, the configuration password is wrong, or a user PIN is missing.

**What to try.**

- For AIOStreams, open **Save & Install → Jellyfin apps → Connect** and copy the configuration UUID or alias and the configuration password again.
- If the user has a PIN, append `/PIN` to the password field and `/UserName` to the username field.
- For a normal server, use the account's Jellyfin username and password.

**Note.** Do **not** paste the sign-in picker address into the source settings — it contains a secret. Use the plain server address plus the username and password.

### Jellyfin shows no libraries

**Cause.** The account authenticated but cannot see any library, or the server address is missing its base path.

**What to try.**

- Confirm the account has access to at least one library in the server's own dashboard.
- Include the reverse-proxy or `/jellyfin` base path in the server address.
- For AIOStreams, confirm catalogues are enabled in the configuration.

### AIOStreams reports that the manifest URL is not configured

**Cause.** The field is empty. The source refuses to look up streams without it.

**What to try.** Paste the full personalised URL from your own AIOStreams instance. It ends in `/stremio/<id>/<config>/manifest.json`.

---

## Upstream and network problems

### A source worked yesterday and stopped today

**Cause.** The upstream site changed its markup, rotated its domain, or started rejecting requests.

**How to identify it.** Open the source's own website on the device. If the site itself is broken or blocking you, the source is not the problem.

**What to try.**

- Update the source — host lists and markup handling are updated regularly.
- Check whether the source has a fallback host list (CineStream, HDHub4u) that refreshes on its own.
- Report it with the title, the source name and the app log.

**Likely upstream?** Yes, almost always. This is the normal maintenance cycle for a scraper-based source.

### Every source stopped at once

**Cause.** A network-level problem: no connectivity, DNS failure, a captive portal, or a device clock error.

**What to try.**

- Open the manifest URL in the device's browser. If that fails, it is the network.
- Check that the device's date, time and time zone are automatic. A wrong clock breaks TLS and breaks signed URLs.
- Disable any VPN or DNS filter and try again.

### The app reports that AniList is having an error

**Cause.** AniList is the **app's own** metadata service. It is not a source published by this repository, and nothing you install here changes it.

**What to try.**

- Wait and retry. AniList rate limits aggressively and the app already throttles it.
- Switch the app's anime metadata provider to MyAnimeList if that option is available to you.
- Check AniList's own status page.

**Likely upstream?** Yes.

### TMDB stops responding

**Cause.** TMDB rate limiting, a transient outage, or a network problem.

**What to try.**

- Wait a minute and retry. The TMDB-backed sources cache metadata and can serve it stale for a while during a transient failure.
- If every request still fails, check DNS and general connectivity.

---

## Build and CI problems

### The provider tests fail locally

**Cause.** One of the provider test files exited non-zero.

**How to identify it.** The output names the file that failed and prints its assertion. Run that file on its own:

```bash
node tests/<name>.test.js
```

**What to try.** Fix the failure. If a test asserts on live network behaviour, remember that the shared health suite is network-isolated by default — only `PROVIDER_HEALTH_CASES` enables live checks.

### The documentation check fails in CI

**Cause.** `docs/EXTENSIONS.md` no longer matches `index.json` and `docs/source-notes.json`. This happens when a source is added, removed, renamed, re-versioned, or its settings change.

**What to try.**

```bash
node scripts/generate-extensions-doc.mjs
git add docs/EXTENSIONS.md
```

### The manifest validation fails

**Cause.** `index.json` and the provider disagree, or a provider file is not registered.

**What to try.** The error message names the exact problem. The usual ones:

| Message | Fix |
|:--|:--|
| `Provider name does not match manifest` | The `name` in `index.json` differs from `getInfo().name` |
| `Provider version does not match manifest` | Bump the version in `getInfo()`, in `module.exports.version` and in `index.json` |
| `getSettings() keys do not match manifest` | The two settings arrays have different keys or a different order |
| `Provider file is not registered in index.json` | Add a manifest entry for the new file |
| `Provider file is missing` | The manifest points at a file that does not exist |

---

## Reporting a problem

If you get this far, please open an issue with:

1. **The source name and version.** The version is shown in the app's source list and in `index.json`.
2. **What you expected and what happened.**
3. **Whether it ever worked.** "It worked last week and stopped" is a very different bug from "it never worked".
4. **The app log**, with secrets removed. Manifest URLs, tokens, cookies and passwords must be redacted.
5. **The title you tested with**, if a specific title is affected.

Please do not paste real credentials into an issue. If a manifest URL contains your configuration id and password, redact the whole URL and describe its shape instead.

---

## Related documentation

- [FAQ](FAQ.md) — questions that are not symptoms
- [Source configuration](SOURCE_CONFIGURATION.md) — every setting, step by step
- [Installation guide](INSTALLATION.md)
- [Development guide](DEVELOPMENT.md)

---

<p align="center">
  <a href="README.md">Documentation index</a> &nbsp;·&nbsp;
  <a href="#troubleshooting">Back to top ↑</a>
</p>
