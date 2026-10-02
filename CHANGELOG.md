# Changelog

Notable project changes are recorded here. Tagged releases will follow [Semantic Versioning](https://semver.org/).

## Unreleased

- Made packet transfers visible for longer with concurrent glowing trails, moving labels, recent-message replay, and message previews directly on the network diagram.
- Fixed packet pause/resume timing, added motion controls, and retained every transfer in a burst instead of dropping queued events.

- Released the current project under AGPL-3.0-only, preserving bundled asset licenses and the permissions of earlier Apache 2.0 versions.
- Rewrote the README for first-time users, with research examples, account requirements, setup steps, and guidance for reviewing reports.

- Added a live communication map with animated recorded transfers, agent filters, readable conversations, message inspection, and pause/resume controls.
- Streamed local activity updates without reloading the view and redacted saved credentials from conversation data.
- Added persistent light/dark themes through the orbital logo control and a matching browser favicon; standardized orange action, red failure, and green success notices.
- Checked account-wide capacity every 30 seconds independently of activity polling, including remotely completed sessions before local state catches up.

- Updated the NVIDIA default to Nemotron 3 Super, kept structured replies within the output budget, and clarified retired-model errors.
- Successful repository changes clear the previous destination's retry state and resume enabled orchestration; manual creation reports its specific blocking condition.
- Repository connection errors now distinguish accepted Jules keys with missing repositories from stale source identifiers, and provide recovery links.
- Simplified website copy, removed repeated promotional sections and footer text, and removed navigation from the introduction.
- Redesigned the introduction and workspace with an editorial ivory/crimson identity, local fonts and Lucide icons, responsive layouts, accessible focus states, and reduced-motion support.
- Added a first-use landing page and reorganized the Orchestrator around research direction, model connection, and run controls.

- Added continuous orchestration to fill account-aware Jules capacity, refill finished tasks, remove the optional app cap, and retry quota rejections with persistent backoff.
- Continuous research now answers new routine questions and plans without the three-response limit, and the Connection page can verify and replace an invalid Jules key.

- Added `howtouse.md` as the step-by-step guide for setup, research launches, model orchestration, monitoring, and local record management.
- Added an optional NVIDIA or OpenAI-compatible model orchestrator that generates bounded Jules research tasks, supplies task-specific instructions, and answers routine feedback questions.

## 0.1.0 - 2026-09-30

- Added an Apache 2.0 license and public contribution, security, and community guidance.
- Added continuous integration on Linux and Windows for supported Node.js versions, plus tag-triggered GitHub Releases.
- Added selectable research prompts, local project record cleanup, and project number reset support.
- Initial local Jules research launcher with repository verification, numbered reservations, activity tracking, and pull request validation.
