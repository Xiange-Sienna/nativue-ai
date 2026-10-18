---
name: nativue
description: Initialize and maintain a source-backed architecture canvas, or coordinate A/B/C development and independent acceptance in an existing workspace. Use for Nativue setup, architecture refreshes, and explicit multi-agent task batches.
---

# Nativue AI

Use the local Nativue CLI and shared state to make architecture and delivery visible. Follow the selected repository's instructions; discover its shape instead of assuming a language, folder layout, issue tracker, branch, or model.

## Select the operation

- **Initialize or refresh architecture:** read [the analysis protocol](references/analysis.md), inspect the chosen workspace, and produce source-backed semantic analysis.
- **Coordinate a batch or work as A, B, or C:** read [the role workflow](references/roles.md). A may delegate when the user chose automatic mode and the host actually exposes subagent tools. A manual handoff is always available.
- **Only discuss the workflow:** explain it without starting development, changing repository configuration, or dispatching agents.

Use the user's chosen language. Explain modules and tasks in plain language; keep source paths and symbols unchanged.

## First connection

1. Locate the installed CLI or the Nativue checkout. Run `node bin/nativue.js --help` from the checkout when needed; resolve CLI paths absolutely before working in another repository.
2. Read the selected workspace's entry instructions and nearest repository instructions; inspect Git status. Discover multiple repositories without recursively reading their contents. Ask the user to select scope when ambiguous.
3. Run `nativue init <workspace>` with the chosen tool/language/mode. Inspect existing `.nativue` configuration rather than overwriting it. Never run a target project's scripts during initialization.
4. Run `nativue doctor <workspace>`. Distinguish a detected executable, a packaged Skill, an exposed session tool, and a verified working integration. Report missing capabilities honestly.
5. Run `nativue scan <workspace>` and `nativue analyze <workspace>`. If semantic analysis is queued, consume the request as described in the analysis reference. Start `nativue serve <workspace>` to display the canvas and keep updates running.

## Operational boundaries

- Use the CLI for ledger writes. Respect its revision check; on conflict reload and reconcile your task instead of overwriting the ledger. Do not edit runtime JSON to bypass acceptance checks.
- Keep `.nativue/` ignored. Do not export private source, credentials, absolute runtime paths, or model configuration with a public template.
- Local and remote snapshots are different sources. Remote synchronization is opt-in and uses a cache. Never pull, merge, or switch the user's worktree merely to refresh a remote diagram.
- Configure models per role from user/project choices. Report actual model selection; inability to choose a model is a capability limitation, not permission for a silent substitute. The Skill cannot switch the current conversation's model.
- GitHub reading depends on available access. Local tasks can use local IDs and optional Issue URLs. Reading an Issue or accepting work does not authorize remote comments, Issue closure, pushes, or publication.
- The local service can queue incremental analysis. `configure-runner codex|claude <workspace>` explicitly enables the included host CLI bridge and future model usage. `configure-runner off <workspace>` disables it. If no enabled command adapter exists, an interactive agent must consume the packet; do not claim unattended semantic updates. WorkBuddy currently uses interactive packets or an explicitly tested custom adapter.

## Completion evidence

For architecture work, report source version, scope, verified versus inferred relationships, warnings, and pending analysis. For delivery, report exact individual and integration commits, independent C results, untested items, task state, and user hand-test instructions. Keep user acceptance pending until the user actually reports it.
