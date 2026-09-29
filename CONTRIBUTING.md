# Contributing

Thanks for helping improve Research Facility. Bug reports, documentation fixes, tests, and focused code changes are welcome.

## Before opening an issue

Check existing issues and the [README](README.md). For a security concern, follow [SECURITY.md](SECURITY.md) and avoid posting credentials or exploit details in a public issue.

## Local development

1. Install Node.js 22.13 or later.
2. Run `npm ci` and `npm test`.
3. Run `npm run dev` to try the local app at <http://localhost:3000>.

The app has no npm runtime dependencies. The test suite uses mocked Jules and GitHub responses, so no accounts or API keys are needed. To try a live connection, use the setup wizard or copy `.env.example` to `.env.local`; never commit credentials or `.data/`.

## Pull requests

- Open an issue first for a substantial change so the intended behavior can be discussed.
- Keep each pull request focused and describe its user-facing effect.
- Add or update tests when changing behavior. Run `npm test` and `git diff --check` before submitting.
- Update the README when setup, configuration, or workflow changes.
- Do not include real API keys, generated databases, or private research material.

Contributions are submitted under the repository's [Apache License 2.0](LICENSE), as described in its contribution terms.
