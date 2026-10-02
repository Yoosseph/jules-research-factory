# How to use Research Facility

Research Facility runs locally and sends research tasks to Jules for one GitHub repository. You can enter topics yourself or connect a model provider to suggest and launch them. The app tracks Jules sessions and checks completed pull requests against the assigned project folder.

## 1. Start the app

1. Install Node.js 22.13 or later.
2. In the project directory, run:

   ```sh
   npm install
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000). The first visit opens the setup wizard. Keep the terminal running while Jules tasks or automatic research are in progress.

`npm start` also runs the local server. The app listens on `127.0.0.1`, port 3000 by default. If that port is unavailable, set `PORT` before starting it. For example, in PowerShell:

```powershell
$env:PORT = '3001'
npm run dev
```

Then open `http://localhost:3001`. The port change applies to that terminal session.

## 2. Connect Jules and GitHub

Complete the three setup steps:

1. **Jules:** Enter a Jules API key. Research Facility tests it and lists repositories available to Jules. If your repository is missing, use the setup guide to grant the Jules GitHub app access, then retry discovery.
2. **Repository:** Select a Jules repository, enter the base branch, and enter a GitHub fine-grained personal access token. Limit that token to the intended repository with **Contents: read** and **Pull requests: read**. The branch must be visible to both Jules and GitHub. Research Facility verifies the repository's stable identity before saving it.
3. **Defaults:** Choose the preferred runtime, development and final seed counts, and maximum concurrent Jules tasks. Finish setup to reach **Projects**.

You can instead copy `.env.example` to `.env.local` and fill in `JULES_API_KEY`, `GITHUB_TOKEN`, `DEFAULT_GITHUB_OWNER`, `DEFAULT_GITHUB_REPO`, and `DEFAULT_BASE_BRANCH`. On the next start, a fresh installation verifies those values and completes setup. `RESEARCH_RUNTIME`, `DEVELOPMENT_SEEDS`, `FINAL_SEEDS`, and `CONCURRENCY` are optional. Once a connection is saved, changing `.env.local` does not replace it; use **Connection → Change repository**.

## 3. Launch research topics yourself

1. On **Projects**, type one topic per line under **New topics**. You can reserve 1–50 topics at once; each topic can be up to 300 characters.
2. Select **Reserve directories**. The app checks the connected repository and assigns each topic a numbered folder, such as `5-Uncertainty-Estimation/`. Reserving does not start Jules.
3. On **Review the destination**, inspect the repository, branch, assigned folders, and the full prompt for each task. Select **Launch Jules tasks** when they are correct. If you leave this page, use **Review & launch** next to a reserved project on **Projects**.
4. Launched tasks enter a queue. Research Facility starts them up to the concurrency limit, checks the repository and folder again for each launch, and records the Jules session.

Use **Remove reservation** beside an unlaunched project if you do not want to launch it. A queued or running task cannot be removed this way.

## 4. Choose the instructions Jules receives

Open **Prompt** to select **Web research** or **Experimental research**, edit the active prompt, or **Save as new** to keep a separate version. **Web research** is the default and asks for a sourced report. **Experimental research** asks for reproducible experimental work. Changes to the active prompt affect future launches; each launched project keeps an exact copy of the prompt it received.

A prompt must contain `{{topic}}`, `{{repository}}`, `{{branch}}`, and `{{folder}}`. It can also use `{{runtime}}`, `{{development_seeds}}`, and `{{final_seeds}}`. The prompt must be 100–24,000 characters. The active version is also saved in `prompt-template.txt`.

You can also put `JULES_API_KEY=` and `NVIDIA_API_KEY=` in `.env`, then paste each key after its equals sign and restart with `npm run dev`. Nonempty keys replace the corresponding saved keys on startup. Blank fields preserve saved keys; `.env.local` overrides `.env`. NVIDIA and Jules use separate keys.

The **Overview** page introduces the research process. In **Orchestrator**, set **Your north star**, connect **The mind behind the work**, and choose a mode under **Find your rhythm**. The run controls let you enable automatic creation and apply the saved direction.

## 5. Connect a model orchestrator

Open **Orchestrator** after setup:

1. Select **NVIDIA API Catalog**, or **Other OpenAI-compatible provider**. NVIDIA uses its chat completions endpoint automatically. For another provider, enter its full chat completions URL. HTTPS is required except for a local model server on `localhost` or `127.0.0.1`.
2. Enter the provider's **Model ID** and **API key**. The default NVIDIA model ID is `nvidia/nemotron-3-super-120b-a12b`; you can replace it with the ID of a model available to your NVIDIA account. A saved key is hidden; leave the key field blank to keep it when editing the same provider and endpoint. Enter a new key when switching providers or endpoints.
3. Write **Your research direction**. Describe the questions, priorities, preferred methods, and topics to avoid. This direction guides the model's topic proposals and its replies to Jules.
4. Choose **Continuous** to keep all available Jules slots occupied. Set **App cap: new tasks per UTC day** to **0** to use all available Jules quota, or enter a cap of 1–1,000. Set your slots target in **Agents → Agent settings** to match your Jules plan. **Hours between scheduled attempts** (1–24) applies only to **Scheduled** mode. Select **Save orchestrator**. Existing saved configurations keep scheduled mode until you change it.

The model receives the research direction, connected repository name, and recent topic names when proposing a task. It returns one topic and a task-specific research plan. Research Facility reserves a folder, appends that plan to the active prompt, and uses the same launch checks as a manually entered topic. The model provider also receives a Jules question and the current task context when drafting a reply. Jules and GitHub credentials are not sent to the model provider.

### Create one task now

After saving a provider, select **Create one research task now**. This works whether automatic creation is on or off. It counts toward the app daily cap after Jules accepts the launch. A free slot is required. The new task appears on **Projects** and **Agents**.

### Keep creating tasks while you are away

Check **Automatically create and launch research**, choose **Continuous**, and save. Give it a standing assignment such as “continuously research markets worldwide; choose sectors, geography, and methods yourself; cite public sources; never ask me questions.” It fills available slots, checks progress every 30 seconds, and launches replacements when tasks finish. Manual reservations do not block continuous work, and existing queued tasks have priority. Sessions started elsewhere in your Jules account count toward the slots target. Continuous mode ignores the hourly interval.

The model makes routine research decisions and answers Jules questions and plans automatically, without the three-response limit or requiring the separate Unattended research setting. If a source needs credentials or payment, it chooses a public alternative and records any gap. It cannot fix invalid credentials or platform access. Duplicate and uncertain responses are still protected against repeated sends.

Jules enforces its rolling 24-hour task quota. The API does not supply an exact remaining-task count; the app detects rejections and retries with increasing delays. A definitely rejected task stays queued with the same plan rather than generating new tasks. Provider errors and the next retry time appear on Orchestrator. Uncertain creation requests stay blocked for inspection. The app cap uses UTC and counts accepted launches, while quota retry delays and counts survive restarts. Leave the server and computer running. Unchecking automatic creation stops new proposals; existing queued and running tasks can finish.

Choose **Scheduled** to attempt one task after the hourly interval only when there is no reserved, queued, launching, or running project. Automatic creation is off until enabled on a new setup.

The research mode controls **new task creation**. A configured model can still draft answers for a manually created task when automatic creation is off, provided **Agents → Agent settings → Unattended research** is enabled.

Provider requests can use quota or incur charges. The app cannot determine a provider's pricing.

## 6. Monitor and guide Jules

Open **Live flow** for the communication map and conversations. Select NVIDIA or Jules to filter messages, select an agent to inspect that task, then select a message to read its recorded text. Packets represent actual saved transfers and Jules events. The view receives updates without a page reload; Jules updates and available slots are checked every 30 seconds. **Pause view** freezes the display while research continues. Existing tasks retain their launch instructions and Jules activity; detailed model request recording starts after updating and restarting the server.

Set concurrency to **15** for a 15-slot Jules plan. Continuous mode counts account-wide running sessions and fills slots when tasks finish, subject to provider quota and retry delays. It also checks capacity independently of fetching activity histories.

Click the orbital mark beside the Research Facility name to switch color themes. Your browser remembers the choice, and the favicon changes with it. Orange notices need action, red notices indicate failure or denial, and green notices confirm success.

Open **Agents** to see each project's state, most recent activity, and links to its Jules session and pull request. Select a project to see the activity timeline and the exact prompt sent to Jules. The server polls running sessions every 30 seconds; active Agent pages refresh every 20 seconds.

Under **Agents → Agent settings**, change the concurrency limit (1–60), preferred runtime, seed counts, and **Unattended research**. Runtime and seed values affect future launches only if the active prompt includes their placeholders. Raising concurrency starts queued tasks as slots become available; lowering it does not stop running tasks.

**Unattended research** is on by default. If Jules waits for a plan approval, Research Facility can approve it. If Jules asks for feedback, the configured model drafts a reply; without a working model, the app sends its standing instruction to continue within the assigned folder. The app sends at most three automatic plan approvals and three automatic feedback replies per session, and records each response to avoid sending the same one twice. A pause after those limits requires you to inspect the project. If a send may have succeeded but its result is uncertain, the app does not retry it automatically.

On a project's page, use **Approve plan and continue** or **Send reply to Jules** when manual input is needed. Use **Stop task** to stop a queued or running task; for a running task, the app asks Jules to delete its session. Open the Jules link for its complete live interface.

When Jules completes with a pull request, Research Facility checks that it targets the connected repository and base branch and that all changed files are inside the assigned folder. A failed check appears as **PR rejected**. The app does not merge pull requests.

## 7. Manage the connection, numbering, and local records

On **Connection**, use **Test connections** to verify Jules, GitHub, the repository, and branch. **Refresh repository** also updates the known numbered folders. **Change repository** starts the setup selection again; finish or stop active tasks first.

Use **Connection → Next project number** only when starting a new numbering series, for example after moving old numbered folders out of the repository root. First clear reservations and finish or stop active tasks. The app still skips numbers occupied by folders on the current branch.

On **Projects**, **Clear finished**, **Clear reserved**, **Clear failed**, and **Clear stopped** delete matching **local** project records and saved activity. They do not delete GitHub folders, pull requests, or Jules sessions. Active and queued tasks are not cleared. Clearing records does not move the next number backward unless you set a new number under **Connection**.

## 8. Resolve common problems

| What you see | What to check |
| --- | --- |
| Repository missing during setup | Grant Jules access to the repository in Jules, then retry discovery. Verify the GitHub token can read that same repository. |
| Branch unavailable | Enter an existing branch visible to Jules and GitHub; use the branch choices shown by the setup page. |
| No automatic task starts | Keep the server running. Check automatic creation, the app cap (0 means no cap), occupied Jules slots, and the error and retry time on **Orchestrator**. Scheduled mode also requires the hourly interval and no pending projects. |
| Model provider error | Check the model key, model ID, endpoint, and provider quota. Errors retry automatically after the displayed delay. Saving corrected settings clears that delay. |
| Jules: Invalid API key or token | Replace the Jules key under **Connection → Update Jules key**. Get it from Jules settings. This is separate from your NVIDIA key. The replacement is verified against the saved repository before use. |
| Launch blocked or interrupted | Open the project and inspect Jules before retrying. A request may have reached Jules even if Research Facility did not receive a response. |
| Jules waits for you | Open the project timeline and its Jules session. Check **Unattended research**, the three-response limit, and any uncertain-send notice; reply manually if needed. |
| Jules finished without a PR or PR rejected | Inspect the Jules session and PR link. The dashboard explains failed repository, branch, or folder checks. |

## Data and verification

Research Facility saves settings, reservations, prompts, sessions, and activity in `.data/researchforge.sqlite`. It encrypts Jules, GitHub, and model-provider credentials using `.data/secret.key`. Keep the entire `.data` directory together when moving the project; losing `secret.key` makes saved credentials unreadable. Do not publish `.data` or `.env.local`.

To run the local test suite, use `npm test`. The tests use mocked provider responses and do not launch live Jules work. Live operation requires your own Jules, GitHub, and optional model-provider credentials.

When user-facing behavior changes, update this guide with the new steps, settings, and expected results.
