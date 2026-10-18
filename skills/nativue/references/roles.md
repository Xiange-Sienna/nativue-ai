# A/B/C delivery

## Shared contract

Read current repository instructions and state at the start of each role. Use local task IDs unless an Issue tracker is configured. Order P0, P1, P2 while honoring dependencies; a lower-priority prerequisite may run first. A blocked task must retain a reason and cannot be passed merely to advance a batch.

A task records its title, scope, acceptance criteria, dependencies, claimed files, developer identity, reviewer identity, submitted commit, review evidence, and eventual integration commit. Use `nativue task <task-json-file> <workspace> --revision N --actor ID` to submit an update against the ledger's current revision. Get current state from the local dashboard or `.nativue` ledger; inspect CLI help and generated handoff instructions for the exact current record shape. Never reset another agent's revision.

Role and task identity must be stable across retries. A separate conversation or subagent provides an independent context; changing the role label in the developer's conversation does not constitute C review. The CLI records identities and enforces gates, but cannot prove a human or model's independence by itself.

Actor IDs are locally declared names, not authenticated multi-user identities. State gates help coordinate cooperating agents; they are not an authorization boundary against a malicious local process. A still owns semantic decisions about task scope, acceptance coverage, batch completeness and legitimate user feedback.

## A — scope and orchestration

- Convert confirmed needs or selected Issues into bounded tasks. Clarify material behavior decisions before implementation. Existing clear acceptance criteria do not need repeated confirmation.
- Inspect dependencies and shared files; split independent work across separate branches/worktrees. Serialize overlapping edits. Do not open worktrees until their parent repository and base commit are known.
- Publish each task with an explicit base, file claim, acceptance criteria, test expectations, and handoff. Track real status events and update the task canvas.
- In **manual mode**, generate a handoff with `nativue handoff B <taskId> --workspace <workspace>` and tell the user which conversation consumes it. A never claims to have opened those conversations.
- In **automatic mode**, check current host tools before dispatch. Use separate B and C contexts, explicit role/model choices when supported, and the same ledger/handoff protocol. A process spawning a CLI is not automatically a safe subagent interface. If unavailable, report the limit and provide manual handoffs.
- After C passes the individual tasks, assign an integration B to combine only accepted versions. Submit the actual integration commit to a fresh C review. Any added fix returns through B and the applicable C gate.
- Synchronize architecture after source changes and deliver a runnable integration with user test steps. Do not mark a batch done because individual tasks passed.

## B — implementation and integration

- Claim the assigned task before modifying files; verify base, worktree, scope and owner. If the claim conflicts, stop the conflicting edit and resolve ownership with A.
- Implement the agreed behavior and run relevant checks. Record failures and untested cases honestly. Preserve other work in a dirty tree.
- Freeze a real commit before review and submit its full SHA, self-test results, changed files, and run instructions. Local commit permission follows the user's task and repository rules; do not invent a commit or accept uncommitted state as frozen evidence.
- C rejection means rework. A changed commit invalidates acceptance of the previous one, even if the fix looks small.
- Integration B combines the individually accepted commits in an isolated integration worktree, resolves conflicts, reruns integration checks, and submits the resulting commit for independent integration C review. Combining branches is not proof of successful integration.

## C — independent acceptance

- Consume `nativue handoff C <taskId> --workspace <workspace>` in an independent context. Inspect the exact submitted SHA in a clean review worktree, using original criteria and source evidence rather than trusting B's summary.
- Run checks relevant to the behavior, including integration interactions when reviewing a combined version. Record commands, observed results, failed criteria and untested items.
- Do not change product code to make review pass. Return concrete reproduction and expected behavior to B. A review cannot pass if required criteria remain failed or untested.
- Tie the result to the full SHA. If source changes, require review again. Review of an individual SHA does not approve a different integration SHA.

## State gates and user hand-test

The path is `todo → developing → review → passed → integrated → integration-review → integration-passed → handtest → done`. C failures return work to `rework`, followed by another B submission and C review. State transitions and required evidence are validated by the CLI.

Only actual user feedback can create `userAcceptance`, with the tested integration commit, feedback source, and timestamp. C, A, or B must not fabricate this record. If the user finds a defect, create or reopen the appropriate task and repeat affected development and review. The hand-test version must display its exact commit and known limitations.

Switching modes requires an explicit handover of active claims. Do not assign the same task simultaneously to a manual B and an automatic B. Local shared state supports sessions on one machine; cross-machine locking and hosted orchestration are not implied.
