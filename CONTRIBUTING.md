# Contributing to Mewtwo Repo

Thank you for helping. This repository is small by design, and the review process is quick when the conventions below are followed.

---

## What belongs here

| Change | Yes | No |
|:--|:--:|:--|
| A new source for a site that works | ✅ | |
| A fix for a source whose site changed | ✅ | |
| A new test, or better coverage of an existing one | ✅ | |
| Documentation that is clearer or more accurate | ✅ | |
| A change to `index.json` that matches its provider | ✅ | |
| A provider that returns nothing playable | ❌ | It would be published as broken |
| A change to the provider *runtime* | ❌ | That belongs in the [Zangetsu app](https://github.com/Spyou/Zangetsu) |
| A copy of somebody else's provider with a different name | ❌ | |
| A real credential, cookie or token | ❌ | **Never** |

> [!IMPORTANT]
> **Never commit a real credential.** Not a Showbox cookie, not an AIOStreams manifest URL, not a Stremio add-on token, not a Jellyfin password, not a TMDB key. Use placeholders. If you paste one by accident, rotate it before opening the pull request.

---

## Before you start

| Question | If yes |
|:--|:--|
| Does the site actually work today? | Open it in a browser, pick a title, and confirm it plays. A source that cannot play is not worth shipping |
| Is the site already covered? | Check the [source catalogue](docs/EXTENSIONS.md). A second source for the same site is only worth adding if it handles something the first one does not — a different language, a different host set, a better fallback |
| Do you want to change how the app works? | That is the [Zangetsu repository](https://github.com/Spyou/Zangetsu), not this one |

---

## The workflow

```text
1. Fork and create a branch
2. Write the provider and its test
3. Register it in index.json
4. Update the documentation
5. Run the checks
6. Open a pull request
```

### 1. Fork and branch

```bash
git clone https://github.com/<your-username>/Mewtwo-repo.git
cd Mewtwo-repo
git checkout -b feat/my-new-source
```

Branch names in this repository follow a small set of prefixes: `feat/…`, `fix/…`, `docs/…`, `chore/…`, `test/…`.

### 2. Write the provider

Create `providers/<name>.js`. The contract, the object shapes, the runtime helpers and the conventions are all documented in the **[development guide](docs/DEVELOPMENT.md)**.

The short version:

```js
function getInfo() {
  return { name: 'My Source', lang: 'en', baseUrl: 'https://example.com',
           logo: 'https://example.com/favicon.ico', type: 'anime', version: '1.0.0' };
}
function getSettings() { return []; }
function getHome(opts) { /* … */ }
function popular(opts) { /* … */ }
function search(query, page, opts) { /* … */ }
function getDetail(url, opts) { /* … */ }
function getEpisodes(url, opts) { /* … */ }
function getVideoSources(episodeUrl, opts) { /* … */ }
function getStreams(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: '1.0.0', getInfo, getSettings, getHome, popular, search,
                      getDetail, getEpisodes, getVideoSources, getStreams };
}
```

### 3. Register it in `index.json`

Add an entry to `sources[]`. The manifest and the provider must agree on **name, version, type, language, logo and settings** — the validation script checks every one of them.

```json
{
  "id": "my-new-source",
  "name": "My Source",
  "version": "1.0.0",
  "type": "anime",
  "lang": "en",
  "file": "providers/my-new-source.js",
  "logo": "https://example.com/favicon.ico",
  "nsfw": false,
  "settings": []
}
```

The `settings` array mirrors `getSettings()` — same keys, same order.

### 4. Add a test

Create `tests/my-new-source.test.js`. Every provider needs one. Model it on an existing file: stub `global.fetch`, call the public methods, and assert on the parsed output.

The shared suite in `tests/provider-health.test.js` already covers the contract, the HTTPS requirement and the error-handling behaviour for every provider, so your own test should focus on what is specific to your source.

### 5. Update the documentation

Add an entry to `docs/source-notes.json`:

```json
"my-new-source": {
  "purpose": "One sentence on what it does.",
  "metadata": "Which backend supplies the catalogue.",
  "setup": "ready",
  "setupNote": "No settings and no credentials.",
  "credentials": [],
  "behaviour": "How it resolves playback.",
  "limitations": ["What it cannot do."]
}
```

Then regenerate the catalogue:

```bash
node scripts/generate-extensions-doc.mjs
```

If the source needs configuration from the user, also add a section to `docs/SOURCE_CONFIGURATION.md` and update the table in `README.md`.

### 6. Run the checks

```bash
node scripts/check-and-run.mjs
node scripts/generate-extensions-doc.mjs --check
```

Both must pass. `check-and-run.mjs` is exactly what CI runs, so a green local run means a green build.

Optionally, check the source against the live site:

```bash
node scripts/live-smoke.mjs my-new-source
```

---

## Conventions

| Rule | Why |
|:--|:--|
| Plain ES5-style JavaScript — `var`, `function`, Promises | Runs unchanged in the app engine, in Node and in a `vm` sandbox |
| Two-space indentation, semicolons | Matches every existing provider |
| One source per file | The manifest maps one file to one source |
| Never throw into the app | A rejected promise breaks the caller's screen. Return an empty array instead |
| Every network call gets a `timeoutMs` | The host caps requests at 25 seconds |
| HTTPS only | The test suite fails a provider containing a cleartext `http://` URL literal |
| Preserve `Referer` and `Origin` headers | Many hosts refuse a request without them |
| Do not cache stream URLs | They are short-lived and signer-bound. Cache metadata, re-resolve streams |
| Bump the version in all three places | `getInfo()`, `module.exports.version` and `index.json` |
| Keep `getSettings()` and the manifest in sync | The validation script compares them key by key |

There is no linter and no formatter configuration in this repository, and there is deliberately no dependency to add one. Match the surrounding code.

---

## Commit and pull request

Write commit messages in the imperative mood and explain the why:

```text
fix(hdhub4u): follow the new hblinks redirect hop

The live Hdhub4u link hub moved from a direct HubCloud redirect to a
two-hop hblinks page, so extraction stopped returning playable links.
Follow the extra hop and keep the old path as a fallback.
```

A good pull request:

- **Does one thing.** A new source, a fix, or a documentation change — not three at once.
- **Explains why.** The diff already shows what changed.
- **Includes the test.** A bug fix without a regression test will be asked for.
- **Updates the version.** Users need the app to notice the change.
- **Updates the documentation.** A new source that nobody can find is not finished.

The pull request template walks through the checklist.

---

## Reporting a bug

Open an issue with:

1. The **source name and version** — both appear in the app's source list and in `index.json`.
2. **What you expected and what happened.**
3. **Whether it ever worked.** "It worked last week and stopped" points at an upstream change; "it never worked" points at the code.
4. **The app log**, with every secret redacted.
5. **The title** you tested with, if a specific title is affected.

If you are not sure which source is responsible, run **Settings → Providers → Source health** first and include the result.

---

## Security issues

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

---

## Code of conduct

Be decent. Assume good faith, keep discussion focused on the code, and help newcomers. Report unacceptable behaviour to the maintainers privately.

---

## Licence of contributions

By opening a pull request you agree that your contribution is licensed under the terms that already apply to the file you touched:

- **MIT** for new original code, tests, scripts and documentation.
- **Apache-2.0** if your contribution derives from the existing Apache-2.0 providers.
- **GPL-3.0** if your contribution derives from `providers/cinestream.js`.

Do not mix licences within a single file. If your change is a derivative of an upstream project, say so in the pull request and add the required notice to `THIRD_PARTY_NOTICES.md`.

---

## Related documentation

- [Development guide](docs/DEVELOPMENT.md) — tooling and the provider contract
- [Architecture guide](docs/ARCHITECTURE.md) — how the runtime works
- [Source catalogue](docs/EXTENSIONS.md) — what already exists
- [Security policy](SECURITY.md)

---

<p align="center">
  <a href="README.md">Back to the repository</a>
</p>
