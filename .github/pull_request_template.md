## What this changes

<!-- One or two sentences. What does this pull request change, and for whom? -->

Closes #

## Type of change

- [ ] Bug fix — an existing source stops working
- [ ] New source — a new provider file
- [ ] Improvement to an existing source
- [ ] Documentation
- [ ] Tooling, tests or CI

## Checklist

- [ ] `node scripts/check-and-run.mjs` passes locally
- [ ] `node scripts/generate-extensions-doc.mjs --check` passes, or I ran `node scripts/generate-extensions-doc.mjs` and committed the result
- [ ] The version is bumped in **all three** places: `getInfo()`, `module.exports.version` and `index.json`
- [ ] `index.json` and the provider agree on name, version, type, language, logo and settings
- [ ] A test covers the change (`tests/<name>.test.js`)
- [ ] The documentation is updated — `docs/SOURCE_CONFIGURATION.md` for a source with settings, `docs/source-notes.json` for any source whose description changed
- [ ] **No real credential, token, cookie or personalised URL appears anywhere in the diff**
- [ ] Any third-party code I derived from has its attribution and licence notice in `THIRD_PARTY_NOTICES.md`

## How to verify

<!--
What did you actually run or check? For a source change, say which title you tested
and what you saw. For a documentation change, say which links and images you checked.
-->

```text
Paste the relevant command output here, or describe the manual test.
```

## Screenshots

<!--
Only for a UI or documentation change. For a source change, a screenshot of a
working stream is useful — but redact any settings, manifest URLs or tokens.
-->

## Notes for the reviewer

<!-- Anything the reviewer should know: an upstream change you worked around, a decision you made, a part you are unsure about. -->
