# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub's private reporting instead:

1. Open the repository on GitHub: <https://github.com/MewtwoOP1/Mewtwo-repo>
2. Click **Security** in the repository header.
3. Choose **Report a vulnerability** and describe the problem.

If private reporting is unavailable, open a regular issue that says only *"Security report available on request — please contact me privately"* and wait for a maintainer to reach out.

Please include:

- what the problem is and which file or source is affected,
- how to reproduce it,
- what an attacker could do with it,
- the source version, if relevant.

You can expect an acknowledgement within a few days. Fixes are released through the normal pull-request and merge flow, and the reporter is credited in the changelog unless they ask not to be.

---

## What is in scope

This repository ships **client code** — JavaScript that runs inside the Zangetsu app and talks to third-party services. The things worth reporting here are:

| In scope | Example |
|:--|:--|
| A credential leak in the code | A hard-coded API key, token or cookie in any committed file |
| A privacy leak in a source | A provider sending identifying data to an unrelated host |
| Insecure transport | A source that deliberately downgrades to plain HTTP for sensitive requests |
| Injection through a source | A source that executes or evaluates data returned by a remote server |
| A broken or misleading credential flow | A source that transmits a Jellyfin token to a third-party host |
| A vulnerability in the tooling | `scripts/` or `tests/` executing untrusted input unsafely |
| Documentation that hands users into a trap | Instructions that lead people to publish their own credentials |

---

## What is out of scope

| Out of scope | Why |
|:--|:--|
| **The sites the sources talk to** | They are operated by other people. Report them to their operators |
| **Availability of a third-party stream** | A source that returns nothing because a site is down is not a vulnerability |
| **Copyright questions** | See the [licensing section of the README](README.md#licensing) |
| **The Zangetsu app itself** | Report it at [Spyou/Zangetsu](https://github.com/Spyou/Zangetsu) |
| **Missing sources or broken layouts** | Ordinary bugs — use a regular issue |
| **Reports generated entirely by an automated scanner** | A scanner finding without a demonstrated impact is not yet a report. Say what an attacker actually gains |

---

## Handling credentials you have already exposed

If you have pasted a real credential into an issue, a pull request or a log:

1. **Revoke or rotate it immediately** at the service that issued it.
2. Then tell the maintainers, so the leaked value can be removed from the history.

Removing a secret from the tip of a branch does not remove it from the git history, so rotation is the only reliable fix. Do not rely on a history rewrite.

The most commonly exposed values in this project are AIOStreams manifest URLs, Stremio add-on URLs carrying a token, and Showbox or GramCinema session tokens.

---

## How the sources handle credentials

For context when reviewing a change:

- Credential values are supplied by the user through the app's source settings and are never committed to this repository.
- A Jellyfin session token is sent only to the user's own server, never forwarded to an unrelated external host.
- AIOStreams instance credentials are transmitted to the user's own instance as part of its authenticated request.
- No provider logs a credential. The health suite asserts that every attempted request targets an absolute HTTPS URL.
- Settings screens render text fields without masking, which is an app-level behaviour. The documentation tells users to redact secrets from screenshots and logs.

---

## Supported versions

This repository has no releases of its own — the `main` branch is what users consume. Fixes are applied to `main` and become effective as soon as the app re-reads the manifest.

---

<p align="center">
  <a href="README.md">Back to the repository</a> &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>
