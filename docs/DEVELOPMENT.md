# Development guide

Everything you need to work on Mewtwo Repo: the layout, the tooling, the provider contract, and the loop you run before opening a pull request.

---

## Setup

There is nothing to install.

```bash
git clone https://github.com/MewtwoOP1/Mewtwo-repo.git
cd Mewtwo-repo
node scripts/check-and-run.mjs
```

That last command is the whole setup. It validates the manifest against every provider and runs the entire test suite.

### Requirements

| Tool | Version | Why |
|:--|:--|:--|
| **Node.js** | 22 or newer | Runs the validation script, the tests and the documentation generator. CI uses Node 22 |
| **Git** | any recent version | The repository is a normal Git repository |

There is **no** `package.json`, no `node_modules` and no lockfile. Every script uses only the Node.js standard library — `node:fs`, `node:path`, `node:child_process`, `node:vm`, `node:module`. Do not introduce a dependency without a strong reason.

---

## Repository layout

```text
.
├── index.json                    The manifest. One entry per source
├── providers/
│   ├── aiostreams.js             One self-contained file per source
│   ├── anikoto.js
│   └── …                          26 files in total
├── tests/
│   ├── aiostreams.test.js        One test file per source
│   ├── provider-health.test.js   Shared contract suite across every provider
│   └── …                          26 test files in total
├── scripts/
│   ├── check-and-run.mjs         Manifest validation + full test run
│   ├── generate-extensions-doc.mjs  Regenerates docs/EXTENSIONS.md
│   └── live-smoke.mjs            Optional live check against a real upstream
├── assets/                       SVGs used by the README and the documentation
├── docs/                         The documentation you are reading
├── .github/
│   ├── workflows/test.yml        CI: validation and tests
│   ├── ISSUE_TEMPLATE/           Bug and feature request forms
│   └── pull_request_template.md
├── LICENSE                       MIT
├── LICENSE-APACHE-2.0            For the two Apache-2.0 providers
├── LICENSE-CINESTREAM.md         GPL-3.0 for providers/cinestream.js
├── NOTICE-CINESTREAM.md          GPL-3.0 attribution
├── NOTICE-YUZONO-ANIME-EXTENSIONS.md  Apache-2.0 attribution
└── THIRD_PARTY_NOTICES.md        Index of every third-party component
```

---

## Commands

| Command | What it does |
|:--|:--|
| `node scripts/check-and-run.mjs` | Validates `index.json` against every provider, then runs every test file. This is the command CI runs |
| `node scripts/generate-extensions-doc.mjs` | Regenerates `docs/EXTENSIONS.md` from `index.json` and `docs/source-notes.json` |
| `node scripts/generate-extensions-doc.mjs --check` | Fails if `docs/EXTENSIONS.md` is out of date. CI runs this |
| `node scripts/live-smoke.mjs --list` | Lists the source ids the live smoke test understands |
| `node scripts/live-smoke.mjs <sourceId> [episodeUrl]` | Hits the real upstream for one source and verifies the resolved HLS manifest |
| `node tests/<name>.test.js` | Runs one provider's test file on its own |

> The live smoke test reaches third-party sites over the network. It is never part of CI — CI must stay deterministic.

---

## The development loop

```text
1. Write or change providers/<name>.js
2. Update the matching entry in index.json
3. Add or update tests/<name>.test.js
4. node scripts/check-and-run.mjs
5. node scripts/generate-extensions-doc.mjs   (if the source's prose changed)
6. git commit && open a pull request
```

### What `check-and-run.mjs` enforces

**Manifest validation, for every source**

- `id`, `name`, `version`, `type`, `lang`, `file` and `logo` are all present and non-empty.
- No duplicate `id` and no duplicate `file`.
- The `file` path resolves inside `providers/` and the file exists.
- `getInfo().name`, `.version`, `.logo`, `.lang` and `.type` match the manifest entry exactly.
- `module.exports.version` matches the manifest version.
- `getSettings()` returns an array whose length and key order match the manifest's `settings` array.
- Every setting descriptor has a non-empty `key`, `label`, `description` and `type`, and its `type` is one of `text`, `bool`, `enum`, `multiEnum`.
- Every `providers/*.js` file is registered in `index.json`.

**Syntax and runtime**

- `node --check` passes for every provider file.
- The provider exports all eight required functions: `getInfo`, `getSettings`, `getHome`, `search`, `getDetail`, `getEpisodes`, `getVideoSources`, `getStreams`.

**Tests**

- Every `tests/*.test.js` file runs and exits zero.

If you add a provider, extend this script and the test suite at the same time. A new source that is not validated is a source that will silently break later.

---

## Writing a provider

### The contract in one place

```js
function getInfo() {
  return { name: 'My Source', lang: 'en', baseUrl: 'https://example.com',
           logo: 'https://example.com/favicon.ico', type: 'anime', version: '1.0.0' };
}

function getSettings() {
  return [
    { key: 'apiKey', label: 'API key (optional)', description: '…', type: 'text', default: '' },
    { key: 'timeout', label: 'Request timeout', description: '…', type: 'enum', default: '12000',
      options: [{ value: '6000', label: '6 seconds' }, { value: '12000', label: '12 seconds' }] },
    { key: 'subs', label: 'Include subtitles', description: '…', type: 'bool', default: true }
  ];
}

function getHome(opts) { return Promise.resolve([]); }
function popular(opts) { return Promise.resolve([]); }
function search(query, page, opts) { return Promise.resolve([]); }
function getDetail(url, opts) { return Promise.resolve(null); }
function getEpisodes(url, opts) { return Promise.resolve([]); }
function getVideoSources(episodeUrl, opts) { return Promise.resolve([]); }
function getStreams(id, opts) { return getVideoSources(id, opts); }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { version: '1.0.0', getInfo, getSettings, getHome, popular, search,
                      getDetail, getEpisodes, getVideoSources, getStreams };
}
```

The complete contract, the object shapes and the runtime contract are documented in the [architecture guide](ARCHITECTURE.md).

### Rules that keep a provider working

1. **Never throw into the app.** Return an empty array or `null`. A rejected promise breaks the caller's screen.
2. **Never block.** Every network call gets a `timeoutMs`. The host caps requests at 25 seconds.
3. **Use the host `fetch`, not `XMLHttpRequest`.** Its `response.body` is a string and its `response.headers` is a plain object.
4. **Use HTTPS only.** The test suite fails a provider that contains a cleartext `http://` URL literal.
5. **Preserve request headers.** Many hosts refuse a request without the right `Referer` or `Origin`.
6. **Do not cache stream URLs.** They are short-lived and signer-bound. Cache metadata; re-resolve streams.
7. **Bump the version** in `getInfo()`, in `module.exports.version` and in `index.json` — all three, every time.
8. **Keep settings in sync.** `getSettings()` and the manifest's `settings` array must have the same keys in the same order.

### Reading the host's settings

```js
var SOURCE_ID = (typeof __SOURCE_ID !== 'undefined' && __SOURCE_ID) ? String(__SOURCE_ID) : 'my-source';

function _readSetting(key) {
  try {
    var settings = typeof __settings !== 'undefined' && __settings ? __settings[SOURCE_ID] : null;
    return settings && settings[key] != null ? settings[key] : null;
  } catch (e) { return null; }
}
```

If your source has an enum or bool setting, re-derive the coercion from the schema rather than trusting the stored value. See the pattern in `providers/serenity-animekai.js`.

### Choosing identifiers

The app treats `id` and `url` as opaque strings and round-trips them. Pick a scheme, use it consistently, and be able to parse it back:

- `my-source://episode/<encodeURIComponent(json)>` — flexible, good for multi-field payloads.
- `JSON.stringify({...})` — simple, but the payload has to survive being stored as a string.

Whatever you choose, `getVideoSources()` must be able to reconstruct everything it needs from the episode URL alone.

---

## Code conventions

The existing code is plain ES5-style JavaScript on purpose: it runs unchanged in the app's JavaScript engine, in Node, and in a `vm` sandbox.

| Convention | Why |
|:--|:--|
| `var`, not `let`/`const` | Maximum engine compatibility |
| `function` declarations, not arrow functions | Same reason, and they hoist |
| Promises, not `async`/`await` | The runtime evaluates the file as a script; `async` functions are avoided |
| `Promise.all` / `Promise.race` for parallelism | Bounded concurrency is explicit and inspectable |
| `.catch()` on every network call | A rejected promise must never escape into the app |
| Two-space indentation, semicolons | Matches every existing provider |
| One provider per file | The manifest maps one file to one source |

### The one exception

`providers/anikoto.js` is written in the original **script-global** form, where the functions are declared at the top level rather than exported. The app evaluates it that way, and the validation script knows how to load it in a `vm` sandbox. If you touch that file, keep the script-global form.

---

## Testing

### The shared health suite

`tests/provider-health.test.js` is provider-agnostic. It loads every registered provider and asserts that:

- the public contract is present,
- there are no cleartext HTTP URL literals,
- every public entry point **settles** rather than throwing when the upstream returns an error,
- every public entry point returns an array when it fulfils,
- every attempted fetch targets an absolute HTTPS URL,
- stream probing distinguishes real media from an HTML challenge page or an empty body.

Its default mode is network-isolated and deterministic, which is why CI is reproducible.

Live checks are opt-in:

```bash
PROVIDER_HEALTH_CASES='{"anizone":{"method":"getVideoSources","args":["anizone://one-piece/1"]}}' \
  node tests/provider-health.test.js
```

Each key must be a manifest source id.

### A provider's own test file

`tests/<name>.test.js` covers the behaviour specific to that source — parsing, id mapping, fallbacks. Model it on an existing file:

```js
'use strict';
const assert = require('node:assert/strict');
const provider = require('../providers/<name>.js');

// Replace global.fetch with a stub that returns canned responses, then
// assert on the parsed output.
```

Every provider file needs a test file. A new source without one will be caught by the review checklist in [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Documentation

### Generated versus maintained

Only one file is generated: **`docs/EXTENSIONS.md`**.

```text
index.json  ────────────┐
                       ├──►  scripts/generate-extensions-doc.mjs  ──►  docs/EXTENSIONS.md
docs/source-notes.json ┘
```

- `index.json` is authoritative for a source's name, version, type, language and settings.
- `docs/source-notes.json` holds the prose that cannot be derived from the manifest: purpose, behaviour, limitations and the setup level.
- The generator fails if a manifest source has no note, or a note has no manifest source.

After changing either file:

```bash
node scripts/generate-extensions-doc.mjs
node scripts/generate-extensions-doc.mjs --check   # must now pass
```

Everything else under `docs/` is written by hand.

### Writing style

- Write for someone who has never used the app.
- Use the app's real UI labels in **bold** — **Settings → Providers → Zangetsu providers → Repositories → Add repo** — not paraphrases.
- Never print a real credential. Use `YOUR-TOKEN`, `https://your-host/…`.
- Describe what the code does, not what a site promises.
- Say plainly when something is upstream's responsibility. "The site changed its markup" is more useful than "this may occasionally fail".

---

## Continuous integration

`.github/workflows/test.yml` runs on every pull request, on every push to `main`, and on demand.

```text
checkout → setup Node 22 → node scripts/check-and-run.mjs
                                   └── manifest validation
                                   └── node --check on every provider
                                   └── every tests/*.test.js
```

A pull request is green when the provider suite passes and `docs/EXTENSIONS.md` is in sync with the manifest.

---

## Related documentation

- [Architecture guide](ARCHITECTURE.md) — the runtime contract in detail
- [Contributing](../CONTRIBUTING.md) — the pull-request flow
- [Source catalogue](EXTENSIONS.md) — every source

---

<p align="center">
  <a href="README.md">Documentation index</a> &nbsp;·&nbsp;
  <a href="#development-guide">Back to top ↑</a>
</p>
