# Research Facility

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

A local research project launcher with a guided Jules and GitHub repository connection. It uses the authoritative Jules source name returned by the API, verifies repository and branch identity before every launch, reserves numbered directories in SQLite, and validates Jules pull requests against each assigned folder.

The app runs on your computer at `127.0.0.1`. It is a local tool, not a hosted service. Jules and GitHub accounts are needed for live launches; no credentials are needed to run the tests.

For step-by-step instructions for setup, manual tasks, model orchestration, monitoring, and troubleshooting, see [howtouse.md](howtouse.md).

## Run

Requires Node.js 22.13 or later. No npm dependencies are needed.

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). New users see the introduction and can select **Get started** to connect their workspace. Configured users go directly to Projects; the Research Facility name opens the introduction at `/welcome`.

The wizard asks for a Jules API key, a GitHub fine-grained personal access token, a repository and base branch, then research defaults. Your connection, defaults, reservations, exact launched prompts, and agent activity are saved in `.data/researchforge.sqlite` inside this project directory. The credentials in that database are encrypted with `.data/secret.key`, so restarting the app does not require setup again. Keep the whole `.data` directory together when moving the project.

For first-run setup from a file, copy `.env.example` to `.env` or `.env.local` and fill in the Jules key, GitHub token, owner, repository, and actual base branch. On startup, Research Facility verifies both connections and sets up the project automatically when all five values are present and there is no saved connection. Optional runtime, seed, and concurrency values can be set there too. An existing saved repository connection takes precedence, so editing environment repository values does not change a configured repository. Nonempty `JULES_API_KEY` and `NVIDIA_API_KEY` values replace the corresponding encrypted saved keys on startup; blank fields keep the saved keys. `NVIDIA_API_KEY` applies to the NVIDIA provider. The app loads `.env.local` before `.env`, with existing process variables taking precedence. Restart after editing either file. No source ID, repository ID, or project number is required.

For GitHub, select only the intended repository. Grant **Contents: read** and **Pull requests: read**; GitHub grants metadata access automatically. Research Facility does not create or merge PRs directly, so it does not need write permission. Jules must have access to the same repository through its GitHub app. The in-app guide links to [Jules’s current repository instructions](https://jules.google/docs/tasks-repos).

The app binds to `127.0.0.1`. Losing `.data/secret.key` makes stored credentials unreadable. Do not publish or share `.data` or `.env.local`. Both are ignored by Git. The browser submits credentials through normal HTML forms and the server never returns them to the page.

## Model orchestrator

After connecting Jules and GitHub, open **Orchestrator**. Choose **NVIDIA API Catalog** or another provider with an OpenAI-compatible chat completions endpoint, enter its model ID and API key, and write a research direction. The provider key is encrypted in the local `.data` database and is never returned to the browser. NVIDIA uses `https://integrate.api.nvidia.com/v1/chat/completions`; its model ID is editable. Other providers need a full HTTPS endpoint, or an HTTP endpoint on localhost for a local model server.

Give the model a standing direction, such as “market analysis forever,” select **Continuous**, set the app daily cap to **0**, and enable automatic creation. The app fills available Jules slots up to the concurrency target in Agent settings, including sessions started outside this app when checking account occupancy. Every 30 seconds it polls progress and refills slots as tasks finish. Manual reservations do not prevent continuous work; queued tasks have priority. Continuous mode ignores the hourly interval. **Scheduled** mode preserves the earlier behavior: one task after the interval, only when no project is reserved, queued, launching, or running. Automatic creation is off by default for a new setup. **Create one research task now** creates one task when capacity is available.

Jules enforces its account limits, including its rolling 24-hour task quota; the API does not expose an exact remaining-task counter. Set the concurrency target to match your plan. The optional app daily cap counts successfully launched model tasks per UTC day; 0 removes that app cap. Quota and provider errors use persistent retry delays, with exponential backoff and Jules Retry-After support. A rejected launch stays queued and retries the same plan when eligible. A timed-out or uncertain creation is blocked for inspection to avoid duplicate sessions. Invalid Jules keys are distinct from NVIDIA keys; **Connection → Update Jules key** verifies a replacement against the connected repository before saving it. Settings, daily usage, and retry delays survive restarts. Keep the local server and computer running.

The model returns a specific topic and task plan. Research Facility reserves a numbered folder and launches the task through the same repository, branch, folder, concurrency, and PR checks as a manual task. The plan is appended to the active prompt, and the exact prompt is saved with the project. Continuous mode handles routine questions and plan approvals automatically without the three-response limit, even when the separate Unattended research checkbox is off. The model independently chooses scope, methods, and public-source alternatives; it never asks the user for research decisions or credentials. Scheduled or manual work follows the Unattended research setting and its three-response limit. If the model cannot answer, the standing continuation message is used. Duplicate-response prevention and uncertain-send handling apply in every mode. Provider requests may consume API quota or incur charges; the app does not know provider pricing.

The orchestrator does not merge PRs or change the connected repository. Stop automatic creation by unchecking the option on the Orchestrator page. You can continue using manual topics at any time.

## Interface

The introduction and workspace share an ivory and crimson palette, locally hosted Fraunces and Manrope fonts, and Lucide SVG icons. The introduction contains the app's purpose, a start action, and setup steps, without a navigation menu or footer. Workspace navigation provides access to the app's controls. The Orchestrator groups the research brief, model connection, and launch settings. Fonts and icons are bundled under `public/` with their licenses, so the interface requires no third-party asset requests. Scroll reveals and hover transitions respect reduced-motion preferences; forms and navigation remain usable without JavaScript.

## Prompt and agent activity

Open **Live flow** at `/flow` to follow NVIDIA proposals, Jules task dispatches, feedback replies, session updates, and validated pull requests. New recorded transfers travel along the communication map; select a node, agent, or conversation entry to read its text. Pause the view to inspect messages without stopping research. The browser receives saved updates over a local server-sent event stream, without reloading the page. Jules state and capacity are checked every 30 seconds; model requests appear as they happen. This is an application message view rather than network traffic capture. Older tasks show their saved instructions and Jules activities; model request history begins when this version starts. Long model messages are explicitly marked when truncated at 20,000 characters. Stored API keys are redacted from the readable stream.

Click the orbital mark beside **Research Facility** to switch between light and dark mode. The choice persists in this browser, and the browser favicon follows the theme. Until you choose, the site follows your system preference. Action notices are orange, failed or denied notices red, and successful notices green.

For a Jules account with 15 concurrent slots, set **Agents → Agent settings → Concurrency** to **15**, enable **Continuous** orchestration, and use an app daily cap of **0** to remove the local cap. Capacity checks include sessions started outside this app and recognize remote completion before the local activity poll finishes. Queued work fills available slots first; the model plans replacements while capacity remains. Launches still wait for provider quotas, retry delays, and repository checks. Keep the server running.

The active prompt is in [`prompt-template.txt`](prompt-template.txt). It now asks Jules for a sourced web research report without coding, datasets, experiments, or generated benchmarks. The previous experiment-focused prompt is preserved in [`prompts/experimental-research.txt`](prompts/experimental-research.txt). On the app's **Prompt** page, switch between saved prompts, edit the active one, or save a separate named copy. The library is stored in `.data/researchforge.sqlite`; switching updates `prompt-template.txt` too. If a customized prompt exists when the library is first initialized, it is saved as **Previous prompt** before web research becomes active. Keep `{{topic}}`, `{{repository}}`, `{{branch}}`, and `{{folder}}` so each task receives its destination. Optional placeholders are `{{runtime}}`, `{{development_seeds}}`, and `{{final_seeds}}`. The preflight page shows the rendered active prompt before launch. Each launched project saves its exact prompt in SQLite, so later edits or switches do not rewrite its history.

Open **Agents** in the app to see every local project, its latest Jules state, and its latest activity. Click a project to inspect its full activity timeline, prompt, Jules session, and PR link. Use **Agent settings** there to change the concurrency limit (1–60), preferred runtime, and development/final seed counts without repeating setup. Raising the limit starts queued tasks when slots are available; lowering it leaves running tasks alone. Runtime and seed values affect future launches only when the active prompt uses their placeholders. These settings persist in `.data/researchforge.sqlite`. Research Facility polls session state and activities every 30 seconds while a task is running; the activity pages refresh every 20 seconds. Jules exposes progress events, plans, messages, and selected artifacts through its [Activities API](https://jules.google/docs/api/reference/activities/). For the complete live Jules interface, open the session link.

New API sessions explicitly set `requirePlanApproval: false`, so Jules should auto-approve their plans. The default prompt gives Jules standing instructions to choose its own data, methods, baselines, scope, and fallbacks and to finish the PR without routine questions. **Unattended research** is on by default under **Agents → Agent settings**: if Jules unexpectedly waits for plan approval or feedback, Research Facility uses the Jules API to approve the plan or send a standing instruction to continue. It records each answered plan or question and will not send the same response twice; for scheduled or manual work, after three automatic plan approvals or three automatic feedback replies in one session, further pauses need inspection. Continuous orchestration responds to each new question or plan without that cap. If the API request may have failed, it does not retry blindly. Open the project to see the pause, inspect its activity, and respond manually when needed. Answer forms do not auto-refresh while you type. Existing sessions keep their original prompt and plan-approval setting, but the pause handler can help them after the server restarts. Jules may still require human help for platform or repository permission blocks.

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

Every push to `main` and pull request into `main` runs the test suite on Linux and Windows with Node.js 22 and 24. Dependabot checks GitHub Actions and npm dependencies monthly.

To publish a version, update `package.json`, `package-lock.json`, and `CHANGELOG.md` together and merge the change into `main`. From that commit, create and push a matching `v` tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

Once all four test jobs pass, the workflow creates a GitHub Release with generated notes and downloadable source archives. Releases distribute the local app's source; they do not deploy a server or publish an npm package.

## Project files

- `src/server.mjs` starts the local server; `src/app.mjs` handles pages, launch scheduling, and polling.
- `src/core.mjs` verifies destination identity and PR scope; `src/providers.mjs` calls Jules and GitHub.
- `src/orchestrator.mjs` calls an NVIDIA or OpenAI-compatible chat provider and validates its proposals and replies.
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
