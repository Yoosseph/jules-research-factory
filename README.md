# Research Facility

A local research project launcher with a guided Jules and GitHub repository connection. It uses the authoritative Jules source name returned by the API, verifies repository and branch identity before every launch, reserves numbered directories in SQLite, and validates Jules pull requests against each assigned folder.

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

The detailed starting prompt is in [`prompt-template.txt`](prompt-template.txt). Edit it on the app's **Prompt** page or in the file. Keep `{{topic}}`, `{{repository}}`, `{{branch}}`, and `{{folder}}` so each task receives its own destination. Optional placeholders are `{{runtime}}`, `{{development_seeds}}`, and `{{final_seeds}}`. The preflight page shows the rendered prompt before launch. Each launched project saves its exact prompt in SQLite, so later edits do not rewrite its history.

Open **Agents** in the app to see every local project, its latest Jules state, and its latest activity. Click a project to inspect its full activity timeline, prompt, Jules session, and PR link. Use **Agent settings** there to change the concurrency limit (1–50), preferred runtime, and development/final seed counts without repeating setup. Raising the limit starts queued tasks when slots are available; lowering it leaves running tasks alone. Runtime and seed values guide prompts for future launches and do not impose a timer or rerun existing tasks. These settings persist in `.data/researchforge.sqlite`. Research Facility polls session state and activities every 30 seconds while a task is running; the activity pages refresh every 20 seconds. Jules exposes progress events, plans, messages, and selected artifacts through its [Activities API](https://jules.google/docs/api/reference/activities/). For the complete live Jules interface, open the session link.

New API sessions explicitly set `requirePlanApproval: false`, so Jules should auto-approve their plans. The default prompt gives Jules standing instructions to choose its own data, methods, baselines, scope, and fallbacks and to finish the PR without routine questions. **Unattended research** is on by default under **Agents → Agent settings**: if Jules unexpectedly waits for plan approval or feedback, Research Facility uses the Jules API to approve the plan or send a standing instruction to continue. It records each answered plan or question and will not send the same response twice; after three automatic plan approvals or three automatic feedback replies in one session, further pauses need inspection. If the API request may have failed, it does not retry blindly. Open the project to see the pause, inspect its activity, and respond manually when needed. Answer forms do not auto-refresh while you type. Existing sessions keep their original prompt and plan-approval setting, but the pause handler can help them after the server restarts. Jules may still require human help for platform or repository permission blocks.

## Workflow

1. Finish the three-step setup. Research Facility lists Jules sources, verifies the selected GitHub repository’s stable ID, checks `main` or your chosen branch, and reads numbered folders from the branch tree.
2. Enter one research topic per line. SQLite reserves `max(remote numbers, local reservations) + 1` in an immediate transaction. Use **Remove reservation** on the Projects page to discard an unlaunched project; queued or launched projects cannot be removed this way.
3. Review `/preflight`: repository, branch, live connection results, assigned folders, and rendered prompts are shown before launch. If you return to the Projects page, use **Review & launch** beside a reserved project to reopen this step.
4. Confirm the batch. Tasks queue and start up to the configured concurrency limit. Each individual launch repeats binding and folder checks, embeds the assigned directory in its prompt, and records the Jules session.
5. The local scheduler polls Jules every 30 seconds. Completed sessions with a PR are checked for repository ID, base branch, and changed files within the assigned folder. A failed check marks the PR as rejected in the dashboard.

If a launch is interrupted after being sent to Jules, Research Facility blocks automatic retry to avoid duplicate sessions. Inspect Jules manually before deciding what to do next. Leave the app running while tasks execute; the queue and reservations persist across restarts.

## Verify

```sh
npm test
```

These tests use mocked provider responses. A live end-to-end run requires your own Jules and GitHub credentials and a connected repository. The app does not launch any task merely by testing a connection or reserving directories.

## Current APIs

- [Jules sources API](https://jules.google/docs/api/reference/sources/)
- [Jules sessions API](https://jules.google/docs/api/reference/sessions)
- [GitHub repository REST API](https://docs.github.com/en/rest/repos/repos)
- [GitHub pull request REST API](https://docs.github.com/en/rest/pulls/pulls)
