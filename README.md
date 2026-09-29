# Research Facility

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

A local research project launcher with a guided Jules and GitHub repository connection. It uses the authoritative Jules source name returned by the API, verifies repository and branch identity before every launch, reserves numbered directories in SQLite, and validates Jules pull requests against each assigned folder.

The app runs on your computer at `127.0.0.1`. It is a local tool, not a hosted service. Jules and GitHub accounts are needed for live launches; no credentials are needed to run the tests.

## Run

Requires Node.js 22.13 or later. No npm dependencies are needed.

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). First run redirects to `/setup`.

The wizard asks for a Jules API key, a GitHub fine-grained personal access token, a repository and base branch, then research defaults. Your connection, defaults, reservations, exact launched prompts, and agent activity are saved in `.data/researchforge.sqlite` inside this project directory. The credentials in that database are encrypted with `.data/secret.key`, so restarting the app does not require setup again. Keep the whole `.data` directory together when moving the project.

For first-run setup from a file, copy `.env.example` to `.env.local` and fill in the Jules key, GitHub token, owner, repository, and actual base branch. On startup, Research Facility verifies both connections and sets up the project automatically when all five values are present and there is no saved connection. Optional runtime, seed, and concurrency values can be set there too. An existing saved connection takes precedence, so editing `.env.local` does not silently change a configured repository. No source ID, repository ID, or project number is required.

For GitHub, select only the intended repository. Grant **Contents: read** and **Pull requests: read**; GitHub grants metadata access automatically. Research Facility does not create or merge PRs directly, so it does not need write permission. Jules must have access to the same repository through its GitHub app. The in-app guide links to [Jules’s current repository instructions](https://jules.google/docs/tasks-repos).

The app binds to `127.0.0.1`. Losing `.data/secret.key` makes stored credentials unreadable. Do not publish or share `.data` or `.env.local`. Both are ignored by Git. The browser submits credentials through normal HTML forms and the server never returns them to the page.

## Prompt and agent activity

The active prompt is in [`prompt-template.txt`](prompt-template.txt). It now asks Jules for a sourced web research report without coding, datasets, experiments, or generated benchmarks. The previous experiment-focused prompt is preserved in [`prompts/experimental-research.txt`](prompts/experimental-research.txt). On the app's **Prompt** page, switch between saved prompts, edit the active one, or save a separate named copy. The library is stored in `.data/researchforge.sqlite`; switching updates `prompt-template.txt` too. If a customized prompt exists when the library is first initialized, it is saved as **Previous prompt** before web research becomes active. Keep `{{topic}}`, `{{repository}}`, `{{branch}}`, and `{{folder}}` so each task receives its destination. Optional placeholders are `{{runtime}}`, `{{development_seeds}}`, and `{{final_seeds}}`. The preflight page shows the rendered active prompt before launch. Each launched project saves its exact prompt in SQLite, so later edits or switches do not rewrite its history.

Open **Agents** in the app to see every local project, its latest Jules state, and its latest activity. Click a project to inspect its full activity timeline, prompt, Jules session, and PR link. Use **Agent settings** there to change the concurrency limit (1–50), preferred runtime, and development/final seed counts without repeating setup. Raising the limit starts queued tasks when slots are available; lowering it leaves running tasks alone. Runtime and seed values affect future launches only when the active prompt uses their placeholders. These settings persist in `.data/researchforge.sqlite`. Research Facility polls session state and activities every 30 seconds while a task is running; the activity pages refresh every 20 seconds. Jules exposes progress events, plans, messages, and selected artifacts through its [Activities API](https://jules.google/docs/api/reference/activities/). For the complete live Jules interface, open the session link.

New API sessions explicitly set `requirePlanApproval: false`, so Jules should auto-approve their plans. The default prompt gives Jules standing instructions to choose its own data, methods, baselines, scope, and fallbacks and to finish the PR without routine questions. **Unattended research** is on by default under **Agents → Agent settings**: if Jules unexpectedly waits for plan approval or feedback, Research Facility uses the Jules API to approve the plan or send a standing instruction to continue. It records each answered plan or question and will not send the same response twice; after three automatic plan approvals or three automatic feedback replies in one session, further pauses need inspection. If the API request may have failed, it does not retry blindly. Open the project to see the pause, inspect its activity, and respond manually when needed. Answer forms do not auto-refresh while you type. Existing sessions keep their original prompt and plan-approval setting, but the pause handler can help them after the server restarts. Jules may still require human help for platform or repository permission blocks.

## Workflow

1. Finish the three-step setup. Research Facility lists Jules sources, verifies the selected GitHub repository’s stable ID, checks `main` or your chosen branch, and reads numbered folders from the branch tree.
2. Enter one research topic per line. SQLite reserves the next available numbered folder in an immediate transaction. Use **Remove reservation** on the Projects page to discard an unlaunched project. The Projects table also has **Clear finished**, **Clear reserved**, **Clear failed**, and **Clear stopped** buttons. These remove matching local project records and their saved activity only; they do not delete Jules sessions, GitHub pull requests, or repository folders. Active and queued tasks are not cleared. After bulk clearing, the next project number does not move backward unless you set it manually.
   To start numbering again after moving old project folders out of the repository root, choose **Change number** beside the next project number, then set the desired number under **Connection → Next project number**. This starts a new numbering series without deleting historical local projects. Clear reservations and finish or stop active tasks first. Research Facility refreshes the repository and skips any number still occupied by a numbered root folder.
3. Review `/preflight`: repository, branch, live connection results, assigned folders, and rendered prompts are shown before launch. If you return to the Projects page, use **Review & launch** beside a reserved project to reopen this step.
4. Confirm the batch. Tasks queue and start up to the configured concurrency limit. Each individual launch repeats binding and folder checks, embeds the assigned directory in its prompt, and records the Jules session.
5. The local scheduler polls Jules every 30 seconds. Completed sessions with a PR are checked for repository ID, base branch, and changed files within the assigned folder. A failed check marks the PR as rejected in the dashboard.

If a launch is interrupted after being sent to Jules, Research Facility blocks automatic retry to avoid duplicate sessions. Inspect Jules manually before deciding what to do next. Leave the app running while tasks execute; the queue and reservations persist across restarts.

## Verify

```sh
npm test
```

These tests use mocked provider responses. A live end-to-end run requires your own Jules and GitHub credentials and a connected repository. The app does not launch any task merely by testing a connection or reserving directories.

## Project files

- `src/server.mjs` starts the local server; `src/app.mjs` handles pages, launch scheduling, and polling.
- `src/core.mjs` verifies destination identity and PR scope; `src/providers.mjs` calls Jules and GitHub.
- `src/db.mjs` stores connection settings, reservations, and activity in SQLite.
- `prompt-template.txt` is the active prompt file; `prompts/` contains bundled prompt choices.
- `test/` contains mocked provider, data, and workflow tests.

## Community and license

See [CONTRIBUTING.md](CONTRIBUTING.md) to propose changes, [SECURITY.md](SECURITY.md) for private vulnerability reports, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for participation guidelines. Ordinary bugs and feature requests can be filed through the repository's Issues tab. Changes are summarized in [CHANGELOG.md](CHANGELOG.md).

The source is licensed under the [Apache License, Version 2.0](LICENSE). The repository is not published as an npm package; the `private` package flag prevents accidental `npm publish`.

## Current APIs

- [Jules sources API](https://jules.google/docs/api/reference/sources/)
- [Jules sessions API](https://jules.google/docs/api/reference/sessions)
- [GitHub repository REST API](https://docs.github.com/en/rest/repos/repos)
- [GitHub pull request REST API](https://docs.github.com/en/rest/pulls/pulls)
