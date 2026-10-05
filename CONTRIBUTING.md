# Contributing

Thanks for helping improve Research Facility. Bug reports, documentation fixes, tests, and focused code changes are welcome.

## Before opening an issue

Check existing issues and the [README](README.md). For a security concern, follow [SECURITY.md](SECURITY.md) and avoid posting credentials or exploit details in a public issue.

## Local development

1. Install Node.js 22.13 or later.
2. Run `npm ci`, `npm run check`, and `npm test`. The check command catches JavaScript syntax errors; the test command checks the app's behavior.
3. Run `npm run dev` to try the local app at <http://localhost:3000>.

The app has no npm runtime dependencies. The test suite uses mocked Jules and GitHub responses, so no accounts or API keys are needed. To try a live connection, use the setup wizard or copy `.env.example` to `.env.local`; never commit credentials or `.data/`.

## Pull requests

- Open an issue first for a substantial change so the intended behavior can be discussed.
- Keep each pull request focused and describe its user-facing effect.
- Add or update tests when changing behavior. Run `npm run check`, `npm test`, and `git diff --check` before submitting.
- Update the README when setup, configuration, or workflow changes.
- Do not include real API keys, generated databases, or private research material.

## Automated checks and releases

Continuous integration (CI) means GitHub checks proposed changes automatically. Every pull request to `main` and every update to `main` runs syntax checks and tests on Linux, Windows, and macOS with Node.js 22 and 24. Linux also checks the minimum supported version, 22.13.0. Tests use simulated providers and do not need service keys. In the repository's **Actions** tab, choose **CI and release → Run workflow** to run the checks manually.

After the tests pass, GitHub builds ZIP and tar downloads from the checked-out commit, checks their SHA-256 checksums (file fingerprints), and reruns the checks and tests from the extracted tar download. The downloadable files appear as `release-downloads` on the workflow run for seven days. Packaging includes app files, instructions, tests, and licenses, while excluding local settings and databases. The workflow actions are pinned to specific commits; Dependabot proposes updates each month.

Continuous delivery (CD) publishes those verified downloads as a GitHub Release when a maintainer pushes a stable version tag, a name attached to a particular commit such as `v0.2.0`. This app is installed locally, so delivery consists of downloadable releases. There are no hosting credentials to configure; publishing uses GitHub's automatic workflow token.

To publish a release:

1. On a `codex/` branch, update the version in both `package.json` and `package-lock.json`, and move the relevant changelog entries into a dated release section. Open a pull request and wait for the owner to merge it after the checks pass.
2. Update your local `main` branch to the merged commit: `git switch main`, then `git pull --ff-only origin main`.
3. Attach the matching tag: `git tag -a v0.2.0 -m "Research Facility v0.2.0"`. Replace `0.2.0` with the version from step 1.
4. Send that tag to GitHub: `git push origin v0.2.0`. This starts the full test and packaging pipeline. Publishing is blocked if any check fails or the tag differs from the version in `package.json`.
5. Open **Actions** to follow progress, then check **Releases** for the ZIP, tar download, and `SHA256SUMS.txt` file. GitHub also generates release notes from the merged changes.

For a local packaging preview, run `npm run package` with Git installed. It writes files into the ignored `dist/` folder and packages the latest local commit, so commit your intended changes first. Previewing a package does not publish anything. Release versions currently use stable numbers such as `0.2.0`; prerelease names such as `0.2.0-beta.1` are rejected.

Contributions to the project are submitted under [GNU AGPLv3 only](LICENSE) (`AGPL-3.0-only`). Keep existing copyright and third-party license notices intact. Bundled fonts and icons retain the terms listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
