import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Ledger, Task, TaskStatus, Review } from "./types.ts";
const statuses: TaskStatus[] = [
  "todo",
  "developing",
  "review",
  "rework",
  "passed",
  "integrated",
  "integration-review",
  "integration-passed",
  "handtest",
  "done",
];
const sha = /^[0-9a-f]{40}$/i;
const transitions: Record<TaskStatus, TaskStatus[]> = {
  todo: ["developing"],
  developing: ["review"],
  review: ["passed", "rework"],
  rework: ["developing", "review"],
  passed: ["integrated", "rework"],
  integrated: ["integration-review"],
  "integration-review": ["integration-passed", "rework"],
  "integration-passed": ["handtest", "rework"],
  handtest: ["done", "rework"],
  done: [],
};
const empty = (): Ledger => ({
  schemaVersion: 1,
  revision: 0,
  tasks: [],
  events: [],
});
function location(root: string) {
  const base = fs.realpathSync(root);
  const dir = path.join(base, ".nativue");
  try {
    if (fs.lstatSync(dir).isSymbolicLink())
      throw new Error("State directory must not be a symlink.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { dir, file: path.join(dir, "ledger.json") };
}
export function readLedger(root: string): Ledger {
  const { file } = location(root);
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error("Ledger must not be a symlink.");
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as Ledger;
    if (
      value.schemaVersion !== 1 ||
      !Number.isInteger(value.revision) ||
      !Array.isArray(value.tasks) ||
      !Array.isArray(value.events)
    )
      throw new Error("Invalid ledger schema.");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  }
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function fullSha(value: string | undefined, label: string) {
  assert(
    value && sha.test(value),
    `${label} requires a full 40-character commit SHA.`,
  );
}
function reviewValid(
  review: Review | undefined,
  commit: string | undefined,
  task: Task,
  integration = false,
) {
  assert(review && review.passed, "Passing independent review required.");
  fullSha(commit, "Frozen version");
  assert(
    review.commit === commit,
    "Review must match the exact frozen commit.",
  );
  assert(
    review.reviewer.trim() && review.reviewer !== task.developer,
    "Reviewer must be distinct from developer.",
  );
  if (integration)
    assert(
      task.integrator?.trim() && review.reviewer !== task.integrator,
      "Integration reviewer must be distinct from the integrator.",
    );
  assert(review.report.trim(), "Review report required.");
  assert(
    Array.isArray(review.untested) && review.untested.length === 0,
    "Untested acceptance items must be resolved.",
  );
  assert(
    Boolean(review.at) && !Number.isNaN(Date.parse(review.at)),
    "Review timestamp required.",
  );
}
function scopeOverlap(a: string, b: string) {
  const clean = (s: string) => s.replace(/\/\*\*?$/, "").replace(/\/$/, "");
  a = clean(a);
  b = clean(b);
  return a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
}
function validateTask(task: Task) {
  assert(
    typeof task.id === "string" && /^[\w.-]+$/.test(task.id),
    "Task ID is required and must be a simple identifier.",
  );
  assert(
    typeof task.title === "string" && task.title.trim(),
    "Task title required.",
  );
  assert(["P0", "P1", "P2"].includes(task.priority), "Invalid priority.");
  assert(statuses.includes(task.status), "Invalid task status.");
  assert(
    Array.isArray(task.files) &&
      Array.isArray(task.criteria) &&
      Array.isArray(task.dependsOn) &&
      Array.isArray(task.reviews),
    "Invalid task lists.",
  );
  for (const file of task.files) {
    assert(
      typeof file === "string" &&
        file &&
        !path.isAbsolute(file) &&
        !file.split(/[\\/]/).includes("..") &&
        !file.includes("\\"),
      "Task files must be workspace-relative paths.",
    );
  }
  if (task.status !== "todo") {
    assert(task.owner?.trim(), "Active task owner required.");
    assert(task.developer?.trim(), "Active task developer required.");
    assert(
      task.criteria.length > 0 && task.criteria.every((s) => s.trim()),
      "Acceptance criteria required before development.",
    );
  }
  if (
    [
      "review",
      "passed",
      "integrated",
      "integration-review",
      "integration-passed",
      "handtest",
      "done",
    ].includes(task.status)
  )
    fullSha(task.commit, "Development version");
  if (
    [
      "passed",
      "integrated",
      "integration-review",
      "integration-passed",
      "handtest",
      "done",
    ].includes(task.status)
  )
    reviewValid(
      task.reviews.findLast((r) => r.passed && r.commit === task.commit),
      task.commit,
      task,
    );
  if (
    [
      "integrated",
      "integration-review",
      "integration-passed",
      "handtest",
      "done",
    ].includes(task.status)
  )
    fullSha(task.integrationCommit, "Integration version");
  if (["integration-passed", "handtest", "done"].includes(task.status))
    reviewValid(task.integrationReview, task.integrationCommit, task, true);
  if (task.status === "done") {
    assert(
      task.userAcceptance?.commit === task.integrationCommit,
      "User acceptance must match integration commit.",
    );
    assert(
      task.userAcceptance?.source?.trim(),
      "User acceptance evidence required.",
    );
    assert(
      Boolean(task.userAcceptance?.at) &&
        !Number.isNaN(Date.parse(task.userAcceptance!.at)),
      "User acceptance timestamp required.",
    );
  }
}
export function writeLedger(
  root: string,
  expectedRevision: number,
  next: Ledger,
): Ledger {
  assert(
    Number.isInteger(expectedRevision) && expectedRevision >= 0,
    "Expected revision required.",
  );
  const { dir, file } = location(root);
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, "ledger.lock");
  let handle: number;
  try {
    handle = fs.openSync(lock, "wx", 0o600);
  } catch {
    throw new Error(
      "Ledger busy; another writer holds the lock. Retry after it completes.",
    );
  }
  let temp = "";
  try {
    const previous = readLedger(root);
    assert(
      previous.revision === expectedRevision,
      `Revision conflict: expected ${expectedRevision}, actual ${previous.revision}. Reload before retrying.`,
    );
    assert(
      next.schemaVersion === 1 &&
        Array.isArray(next.tasks) &&
        Array.isArray(next.events),
      "Invalid ledger schema.",
    );
    assert(
      new Set(next.tasks.map((t) => t.id)).size === next.tasks.length,
      "Duplicate task IDs.",
    );
    for (const task of next.tasks) {
      validateTask(task);
      const before = previous.tasks.find((t) => t.id === task.id);
      if (before) {
        if (before.status !== task.status)
          assert(
            transitions[before.status].includes(task.status),
            `Invalid transition ${before.status} → ${task.status}.`,
          );
        if (
          before.status !== "todo" &&
          !(before.status === "rework" && task.status === "developing")
        )
          for (const field of [
            "description",
            "criteria",
            "files",
            "dependsOn",
          ] as const)
            assert(
              JSON.stringify(task[field]) === JSON.stringify(before[field]),
              "Task scope is frozen; return work and restart development before changing it.",
            );
        assert(
          task.reviews.length >= before.reviews.length &&
            before.reviews.every(
              (r, i) => JSON.stringify(r) === JSON.stringify(task.reviews[i]),
            ),
          "Historical review evidence is immutable.",
        );
        if (task.reviews.length > before.reviews.length)
          assert(
            before.status === "review" &&
              ["passed", "rework"].includes(task.status),
            "Review evidence may only be recorded at the independent review gate.",
          );
        if (
          JSON.stringify(task.integrationReview) !==
            JSON.stringify(before.integrationReview) &&
          task.integrationReview
        )
          assert(
            before.status === "integration-review" &&
              ["integration-passed", "rework"].includes(task.status),
            "Integration evidence may only be recorded at the integration review gate.",
          );
        if (before.integrator && task.integrator !== before.integrator)
          assert(
            before.status === "passed" && task.status === "integrated",
            "Integrator may only change at a new integration freeze.",
          );
        if (before.developer && task.developer !== before.developer)
          assert(
            before.status === "rework" && task.status === "developing",
            "Developer may only change when restarting returned work.",
          );
        if (before.commit !== task.commit && task.commit)
          assert(
            ["developing", "rework"].includes(before.status) &&
              task.status === "review",
            "Development version may only be frozen when submitting review.",
          );
        if (
          before.integrationCommit !== task.integrationCommit &&
          task.integrationCommit
        )
          assert(
            before.status === "passed" && task.status === "integrated",
            "Integration version may only be frozen after independent task acceptance.",
          );
        if (
          task.userAcceptance &&
          JSON.stringify(task.userAcceptance) !==
            JSON.stringify(before.userAcceptance)
        )
          assert(
            before.status === "handtest" && task.status === "done",
            "User acceptance may only be recorded at the hand-test gate.",
          );
      } else {
        assert(task.status === "todo", "New tasks must start at todo.");
        assert(
          task.reviews.length === 0 &&
            !task.integrationReview &&
            !task.userAcceptance,
          "New tasks cannot contain invented acceptance history.",
        );
      }
    }
    for (const before of previous.tasks)
      if (!next.tasks.some((t) => t.id === before.id))
        assert(before.status === "todo", "Only pending tasks can be deleted.");
    const active = next.tasks.filter(
      (t) => !["todo", "done"].includes(t.status),
    );
    for (let i = 0; i < active.length; i++)
      for (let j = i + 1; j < active.length; j++) {
        assert(
          !active[i].files.some((a) =>
            active[j].files.some((b) => scopeOverlap(a, b)),
          ),
          `File ownership conflict: ${active[i].id} and ${active[j].id}.`,
        );
      }
    for (const task of active) {
      const before = previous.tasks.find((t) => t.id === task.id);
      const advancing =
        !before ||
        (before.status !== task.status && !["rework"].includes(task.status));
      if (!advancing) continue;
      for (const dep of task.dependsOn) {
        const dependency = next.tasks.find((t) => t.id === dep);
        assert(
          dependency &&
            [
              "passed",
              "integrated",
              "integration-review",
              "integration-passed",
              "handtest",
              "done",
            ].includes(dependency.status),
          `Dependency ${dep} has not passed acceptance.`,
        );
      }
    }
    const saved: Ledger = {
      ...structuredClone(next),
      schemaVersion: 1,
      revision: expectedRevision + 1,
    };
    temp = path.join(dir, `.ledger-${randomUUID()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(saved, null, 2) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(temp, file);
    return saved;
  } finally {
    if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
    fs.closeSync(handle!);
    fs.unlinkSync(lock);
  }
}
export function updateTask(
  root: string,
  expectedRevision: number,
  actor: string,
  task: Task,
): Ledger {
  assert(actor?.trim(), "Actor required.");
  const ledger = readLedger(root);
  const previous = ledger.tasks.find((t) => t.id === task.id);
  if (task.status === "integrated" && previous?.status !== "integrated")
    task = { ...task, integrator: actor };
  if (
    previous &&
    previous.status !== task.status &&
    [
      "developing",
      "review",
      "integrated",
      "integration-review",
      "handtest",
    ].includes(task.status)
  )
    assert(
      actor === task.owner,
      "Only the assigned owner may perform development and integration transitions.",
    );
  if (
    previous &&
    previous.status !== "todo" &&
    actor !== previous.owner &&
    actor !== "user"
  ) {
    const isReviewGate =
      ["review", "integration-review"].includes(previous.status) &&
      ["passed", "integration-passed", "rework"].includes(task.status);
    assert(
      isReviewGate,
      "Only the owner may modify an active task outside independent review.",
    );
    for (const field of [
      "title",
      "priority",
      "description",
      "criteria",
      "dependsOn",
      "files",
      "owner",
      "developer",
      "integrator",
      "commit",
      "integrationCommit",
    ] as const)
      assert(
        JSON.stringify(task[field]) === JSON.stringify(previous[field]),
        "Independent reviewers cannot change the frozen task package.",
      );
  }
  if (previous && task.status === "rework" && actor !== previous.owner) {
    const review =
      previous.status === "review"
        ? task.reviews.at(-1)
        : task.integrationReview;
    assert(
      review &&
        !review.passed &&
        review.reviewer === actor &&
        review.report.trim() &&
        review.commit ===
          (previous.status === "review"
            ? previous.commit
            : previous.integrationCommit),
      "Returning failed work requires exact-version independent failure evidence.",
    );
  }
  if (
    previous &&
    previous.status !== "todo" &&
    task.status === previous.status &&
    actor !== previous.owner
  ) {
    assert(
      actor === task.reviewer ||
        task.reviews.some((r) => r.reviewer === actor) ||
        task.integrationReview?.reviewer === actor,
      "Only the owner or independent reviewer may update an active task.",
    );
  }
  if (previous) {
    for (const review of task.reviews.slice(previous.reviews.length))
      assert(
        review.reviewer === actor && actor !== task.developer,
        "Only an independent reviewer may append review evidence.",
      );
    if (
      task.integrationReview &&
      JSON.stringify(task.integrationReview) !==
        JSON.stringify(previous.integrationReview)
    )
      assert(
        task.integrationReview.reviewer === actor && actor !== task.developer,
        "Only an independent reviewer may append integration evidence.",
      );
  }
  if (
    previous &&
    task.status !== previous.status &&
    ["passed", "integration-passed"].includes(task.status)
  ) {
    const review =
      task.status === "passed"
        ? task.reviews.findLast((r) => r.passed && r.commit === task.commit)
        : task.integrationReview;
    assert(
      review?.reviewer === actor,
      "Only the named independent reviewer can record passing acceptance.",
    );
    assert(
      actor !== task.developer,
      "Developer cannot approve their own work.",
    );
  }
  if (
    previous &&
    previous.owner &&
    task.owner !== previous.owner &&
    previous.status !== "todo"
  )
    assert(
      actor === previous.owner,
      "Only the current owner may hand over an active task.",
    );
  if (task.status === "done" && previous?.status !== "done")
    assert(
      actor === "user",
      "Only explicit user acceptance may finish a task.",
    );
  const updated = {
    ...structuredClone(task),
    updatedAt: new Date().toISOString(),
  };
  ledger.tasks = ledger.tasks.filter((t) => t.id !== task.id);
  ledger.tasks.push(updated);
  ledger.events.push({
    at: updated.updatedAt,
    taskId: task.id,
    actor,
    action: previous
      ? previous.status === task.status
        ? "update"
        : `${previous.status} → ${task.status}`
      : "create",
  });
  return writeLedger(root, expectedRevision, ledger);
}
