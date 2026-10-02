# Research Facility

**Give it a research direction. Build a library of reports with sources.**

[![License: AGPLv3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](LICENSE)
[![Tests](https://github.com/Yoosseph/jules-research-factory/actions/workflows/ci.yml/badge.svg)](https://github.com/Yoosseph/jules-research-factory/actions/workflows/ci.yml)

Research Facility is an open-source app that helps you run ongoing research from your computer. Tell it what you want to understand, such as a market, a group of competitors, or an emerging technology. An AI planner chooses specific questions, sends assignments to Google's Jules agents, and handles routine follow-up questions.

The agents produce reports in your chosen GitHub repository. When a task finishes, the app checks for an available slot and can start the next assignment. You can follow the work and read the agents' conversations in your browser.

You do not need to write code to use the app. Setup involves installing Node.js, running two commands, and connecting your accounts.

## Why use it?

Research often starts with a broad question and turns into dozens of smaller ones. Research Facility helps you explore those questions in parallel and keep the results together, instead of repeatedly starting new AI chats and copying their answers into documents.

It can be useful for:

- **Market analysis:** explore sectors, customer needs, pricing, and barriers to entry.
- **Competitor research:** compare products, business models, positioning, and public pricing.
- **Business ideas:** investigate demand, existing alternatives, and gaps worth exploring.
- **Technology research:** examine tools, adoption trends, and published evidence.
- **Literature reviews:** collect and compare published work on a focused subject.
- **Learning a new field:** build a collection of introductions and deeper reports over time.

These are research directions you can give it, rather than separate built-in templates. The quality of the results depends on your instructions, the AI models, and the sources they can access.

## What it can do

| Feature | What it means for you |
| --- | --- |
| Continuous research | Keep assigning new work while capacity and quota are available. |
| Several agents at once | Explore different questions in parallel, up to your Jules account's limit. |
| Automatic follow-up replies | Let the planner make routine decisions so agents can continue. |
| Live flow and conversations | See recorded handoffs and read task plans, replies, and progress updates. |
| Organized reports | Save each assignment in a numbered folder in your research repository. |
| Review before accepting | Reports arrive as proposed changes on GitHub; the app does not merge them automatically. |
| Manual assignments | Enter your own topics whenever you want more control. |
| Saved setup | Restart the app without repeating the account connection steps. |

## How it works

1. **You give the direction.** Describe what you want researched and what a useful report should contain.
2. **The planner creates an assignment.** It chooses a specific question and gives Jules a task plan.
3. **Jules researches it.** The agent works in an assigned folder and submits its results to GitHub.
4. **The app checks the result and available capacity.** In Continuous mode, it starts another assignment when a slot opens.

The planner can use NVIDIA API Catalog or another service with a compatible chat API. Jules performs the research tasks. GitHub stores the reports and proposed changes.

## Before you start

You will need:

- A computer that can stay on while research runs.
- [Node.js](https://nodejs.org/en/download), the software that runs this app. Choose the LTS download; version 22.13 or newer is required. It includes npm, which runs the commands below.
- A [GitHub account](https://github.com/) and a repository for the reports. A repository is a project folder stored on GitHub. Create a separate one, such as `my-research`, and select **Add a README file** so it has a starting branch. Choose a private repository if you want to keep the reports private.
- A [Jules account](https://jules.google.com/) with access to that repository and a Jules API key from its settings.
- A GitHub access token for checking the repository. In [token settings](https://github.com/settings/personal-access-tokens), create a fine-grained token, select your research repository, and allow **Contents: Read** and **Pull requests: Read**.
- For automatic planning, an API key from [NVIDIA API Catalog](https://build.nvidia.com/) or another supported model provider. This is separate from your Jules key.

An API key or access token works like a password for an app. Keep yours private. Research Facility is free to use under its license, but the connected services have their own account limits and may charge for usage.

## Get started

### 1. Download the app

On [this repository's main page](https://github.com/Yoosseph/jules-research-factory), choose **Code → Download ZIP**. Extract the ZIP and open the extracted folder containing `package.json`.

If you already use Git, you can clone the repository instead.

### 2. Start it

Open a terminal inside that folder. On Windows, open the folder in File Explorer, type `powershell` in its address bar, and press Enter.

Run these commands one at a time:

```sh
npm install
npm run dev
```

Leave that terminal open. Open [http://localhost:3000](http://localhost:3000) in your browser. This address opens the app running on your own computer.

### 3. Connect your accounts

Choose **Get started** and follow the setup screens:

1. Enter your Jules API key.
2. Choose the repository for your reports, enter your GitHub token, and test the connection. Jules must also have access to the same repository through its web app.
3. Save your defaults. Set the concurrency limit to match the number of simultaneous tasks your Jules account allows.

For help connecting a repository to Jules, follow [Jules's repository guide](https://jules.google/docs/tasks-repos). The app also has a setup guide.

### 4. Give it a research direction

Open **Orchestrator**, connect your model provider, and describe the work. For example:

> Continuously research the market for software used by small businesses in Sweden. Compare competitors, public prices, customer needs, and underserved niches. Use current public sources and include publication dates and links. Write each report with findings, evidence, uncertainties, and questions worth researching next. Choose reasonable assumptions and continue without asking me routine questions.

Choose **Continuous**, enable **Automatically create and launch research**, and save. Set an app daily cap if you want to limit new assignments. A cap of **0** removes the app's own daily cap; it does not remove Jules's limits.

For an account with 15 simultaneous tasks, set **Agents → Agent settings → Concurrency** to **15**. The app includes tasks started elsewhere in your Jules account when checking capacity. It checks every 30 seconds and fills available slots, subject to quota, errors, and retry delays.

### 5. Follow the work and read the reports

- **Live flow:** watch glowing dots carry messages across the communication map. The diagram shows recent message cards and each node's latest activity. Select a dot or card to read its text, or use **Replay recent** to follow recorded exchanges again. Pause the view to read without stopping research.
- **Agents:** see the state of each task and open its activity timeline.
- **Projects:** find assignments and their proposed reports on GitHub.
- **Prompt:** change the instructions used for future reports.

A **pull request**, or PR, is a proposed change to your GitHub repository. Open it to read the report and review its sources. The app checks that the PR targets the connected repository and stays inside its assigned folder; you decide whether to accept it.

Click the orbital mark beside the app's name to switch between light and dark mode.

## What to expect

The app handles routine research decisions, but account permissions, invalid keys, and uncertain requests can still need your attention. Provider errors pause new work and show a retry time. Completed research should be reviewed: AI can miss sources, misunderstand evidence, or produce inaccurate claims. A passed PR check confirms the destination and file scope, not the report's factual accuracy.

Keep your computer awake and the terminal running. Closing the browser is fine; stopping the server stops its checking and automatic coordination. Your saved tasks and settings remain available when you start it again.

This runs locally, while model requests and research tasks use the connected online services. Your research instructions and task context are sent to those services. Keys are encrypted in the local `.data` folder. Do not upload `.data`, `.env`, or `.env.local`; they are excluded from Git.

If starting the app says `EADDRINUSE`, another app or an existing copy is using port 3000. Open the existing Research Facility page, or stop its terminal with **Ctrl+C** before starting another copy. To stop this app normally, use **Ctrl+C** in its terminal.

## More help and contributions

See [the full user guide](howtouse.md) for configuration, troubleshooting, and record management. Experienced users can also enter keys through [`.env.example`](.env.example); the browser setup is the easiest starting point.

You can help without coding: report a confusing setup step, improve the instructions, or suggest a research workflow through [GitHub Issues](https://github.com/Yoosseph/jules-research-factory/issues). For code changes, see [CONTRIBUTING.md](CONTRIBUTING.md). Run `npm test` to check the app; tests use simulated providers and do not launch real research tasks.

For private security reports, see [SECURITY.md](SECURITY.md). Changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## License

Research Facility is licensed under **GNU AGPLv3 only** (`AGPL-3.0-only`). You can use, study, modify, and share it, including commercially, under the [license terms](LICENSE). Sharing modified versions, or letting users interact with a modified version over a network, carries source-sharing requirements.

Bundled fonts and icons keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Earlier versions released under Apache 2.0 retain those permissions. This software comes without warranty.
