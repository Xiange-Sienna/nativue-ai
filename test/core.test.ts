import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scanWorkspace, discoverWorkspaces } from "../src/scanner.ts";
import { readLedger, writeLedger, updateTask } from "../src/ledger.ts";
import { syncRemote } from "../src/remote.ts";
import type { Task, Config } from "../src/types.ts";
const revision = "a".repeat(40),
  integration = "b".repeat(40);
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nativue-fixture-"));
  return { root, clean: () => fs.rm(root, { recursive: true, force: true }) };
}
async function put(root: string, name: string, value: string) {
  await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await fs.writeFile(path.join(root, name), value);
}
function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    },
  }).trim();
}
function task(id = "T1"): Task {
  return {
    id,
    title: "Fictional task",
    priority: "P1",
    status: "todo",
    description: "Implement example",
    criteria: ["Example works"],
    dependsOn: [],
    files: ["src/example.ts"],
    reviews: [],
    updatedAt: new Date().toISOString(),
  };
}
const config = {
  remote: {
    enabled: true,
    url: "https://github.com/example/fictional",
    branch: "main",
  },
} as Config;
test("scanner excludes tracked secrets, ignored files, generated files and symlinks; observes imports and stable input IDs", async () => {
  const { root, clean } = await fixture();
  try {
    git(root, "init", "--quiet");
    await put(root, ".gitignore", "ignored/\n.nativue/\n");
    await put(root, "package.json", "{}");
    await put(root, "src/main.ts", "import {value} from '../lib/value';\n");
    await put(root, "lib/value.ts", "export const value = 1;\n");
    await put(root, "ignored/data.ts", "invisible");
    await put(root, "node_modules/a.ts", "invisible");
    await put(root, ".env", "PRIVATE=fictional");
    await put(root, "secrets.json", '{"fictional":"secret"}');
    await put(root, "keys/client.pem", "fictional private key");
    await fs.symlink(path.join(root, "lib"), path.join(root, "linked"));
    git(root, "add", "-f", ".env", "secrets.json", "keys/client.pem");
    git(root, "add", "package.json", ".gitignore", "src", "lib");
    git(root, "commit", "--quiet", "-m", "Fictional baseline");
    const first = await scanWorkspace(root),
      again = await scanWorkspace(root);
    assert.equal(first.id, again.id);
    assert.equal(first.source.commit?.length, 40);
    assert.deepEqual(
      first.files.map((f) => f.path),
      [".gitignore", "lib/value.ts", "package.json", "src/main.ts"],
    );
    assert.equal(first.edges.length, 1);
    assert.deepEqual(first.edges[0].evidence, [
      { path: "src/main.ts", line: 1, note: "../lib/value" },
    ]);
    assert.equal(
      first.modules.every((m) => m.confidence === "inferred"),
      true,
    );
    assert.equal(first.analysis.status, "pending");
    await put(root, "lib/value.ts", "export const value = 2;\n");
    const changed = await scanWorkspace(root);
    assert.notEqual(changed.id, first.id);
    assert.equal(changed.source.dirty, true);
    const excluded = await scanWorkspace(root, "remote", {
      exclude: ["lib/**"],
    });
    assert.equal(
      excluded.files.some((f) => f.path.startsWith("lib/")),
      false,
    );
    await fs.rename(
      path.join(root, "lib/value.ts"),
      path.join(root, "lib/renamed.ts"),
    );
    assert.equal((await scanWorkspace(root)).edges.length, 0);
  } finally {
    await clean();
  }
});
test("unborn repository preserves nested Git ignore rules", async () => {
  const { root, clean } = await fixture();
  try {
    git(root, "init", "--quiet");
    await put(root, "src/.gitignore", "private.ts");
    await put(root, "src/private.ts", "hidden");
    await put(root, "src/public.ts", "visible");
    const scan = await scanWorkspace(root);
    assert.equal(scan.source.commit, null);
    assert.equal(
      scan.files.some((f) => f.path === "src/private.ts"),
      false,
    );
  } finally {
    await clean();
  }
});
test("non-Git scanner respects simple ignores, binary and file size limits", async () => {
  const { root, clean } = await fixture();
  try {
    await put(root, ".gitignore", "private/\n*.log\n");
    await put(root, "private/data.ts", "hidden");
    await put(root, "debug.log", "hidden");
    await put(root, "main.py", "from service.helper import value\n");
    await put(root, "service/helper.py", "value = 1");
    await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    await put(root, "large.txt", "x".repeat(512 * 1024 + 1));
    const scan = await scanWorkspace(root);
    assert.equal(
      scan.files.some(
        (f) =>
          f.path.startsWith("private/") ||
          f.path.endsWith(".log") ||
          f.path === "large.txt" ||
          f.path === "binary.bin",
      ),
      false,
    );
    assert.equal(scan.edges.length, 1);
    assert.equal(
      scan.warnings.some((w) => w.includes("oversized")),
      true,
    );
  } finally {
    await clean();
  }
});
test("workspace discovery returns actual project candidates without walking dependencies", async () => {
  const { root, clean } = await fixture();
  try {
    await put(root, "front/package.json", "{}");
    await put(root, "back/pyproject.toml", "");
    await put(root, "node_modules/ignored/package.json", "{}");
    assert.deepEqual(
      (await discoverWorkspaces(root)).map((p) => path.basename(p)),
      ["back", "front"],
    );
  } finally {
    await clean();
  }
});
test("ledger CAS rejects stale writes and file ownership conflicts", async () => {
  const { root, clean } = await fixture();
  try {
    let state = updateTask(root, 0, "A", task());
    assert.equal(state.revision, 1);
    assert.throws(
      () => updateTask(root, 0, "A", task("T2")),
      /Revision conflict/,
    );
    state = updateTask(root, 1, "B", {
      ...state.tasks[0],
      owner: "B",
      developer: "B",
      status: "developing",
    });
    state = updateTask(root, state.revision, "A", {
      ...task("T2"),
      files: ["src/"],
    });
    assert.equal(state.tasks.length, 2); // Pending scopes may overlap until claimed.
  } finally {
    await clean();
  }
});
test("ledger preserves independent review, integrated SHA, and explicit user gate", async () => {
  const { root, clean } = await fixture();
  try {
    let state = updateTask(root, 0, "A", task());
    const set = (actor: string, patch: Partial<Task>) =>
      (state = updateTask(root, state.revision, actor, {
        ...state.tasks[0],
        ...patch,
      }));
    set("B", { status: "developing", owner: "B", developer: "B" });
    assert.throws(
      () => set("B", { status: "passed", commit: revision }),
      /review|transition/i,
    );
    assert.throws(
      () => set("outsider", { status: "review", commit: revision }),
      /owner/,
    );
    set("B", { status: "review", commit: revision });
    const review = {
      reviewer: "B",
      commit: revision,
      report: "Verified example",
      passed: true,
      untested: [],
      at: new Date().toISOString(),
    };
    assert.throws(
      () => set("B", { status: "passed", reviews: [review] }),
      /own|distinct|independent/i,
    );
    assert.throws(
      () =>
        set("C", {
          status: "passed",
          reviews: [{ ...review, reviewer: "C", commit: "c".repeat(40) }],
        }),
      /review/i,
    );
    set("C", { status: "passed", reviews: [{ ...review, reviewer: "C" }] });
    assert.throws(
      () => set("B", { reviews: [] }),
      /Historical|independent review/,
    );
    set("B", { owner: "B2" });
    set("B2", { status: "integrated", integrationCommit: integration });
    set("B2", { status: "integration-review" });
    assert.throws(
      () =>
        set("B2", {
          status: "integration-passed",
          integrationReview: { ...review, reviewer: "B2", commit: integration },
        }),
      /integrator/,
    );
    assert.throws(
      () =>
        set("C", {
          status: "integration-passed",
          integrationReview: { ...review, reviewer: "C", commit: revision },
        }),
      /exact/,
    );
    set("C", {
      status: "integration-passed",
      integrationReview: { ...review, reviewer: "C", commit: integration },
    });
    set("B2", { status: "handtest" });
    assert.throws(
      () =>
        set("B2", {
          status: "done",
          userAcceptance: {
            commit: integration,
            source: "Approved",
            at: new Date().toISOString(),
          },
        }),
      /user/,
    );
    assert.throws(
      () =>
        set("user", {
          status: "done",
          userAcceptance: {
            commit: revision,
            source: "Approved",
            at: new Date().toISOString(),
          },
        }),
      /integration/,
    );
    set("user", {
      status: "done",
      userAcceptance: {
        commit: integration,
        source: "Explicit user approval",
        at: new Date().toISOString(),
      },
    });
    assert.equal(readLedger(root).tasks[0].status, "done");
  } finally {
    await clean();
  }
});
test("ledger locks, task paths and deletion gates protect shared state", async () => {
  const { root, clean } = await fixture();
  try {
    let state = updateTask(root, 0, "A", task());
    await fs.writeFile(path.join(root, ".nativue/ledger.lock"), "fixture");
    assert.throws(() => writeLedger(root, state.revision, state), /busy/);
    await fs.unlink(path.join(root, ".nativue/ledger.lock"));
    assert.throws(
      () =>
        updateTask(root, state.revision, "A", {
          ...task("T2"),
          files: ["../outside"],
        }),
      /relative/,
    );
    state = updateTask(root, state.revision, "B", {
      ...state.tasks[0],
      status: "developing",
      owner: "B",
      developer: "B",
    });
    assert.throws(
      () => writeLedger(root, state.revision, { ...state, tasks: [] }),
      /pending/,
    );
    let next = updateTask(root, state.revision, "A", {
      ...task("T2"),
      files: ["src/"],
    });
    assert.throws(
      () =>
        updateTask(root, next.revision, "B2", {
          ...next.tasks.find((t) => t.id === "T2")!,
          status: "developing",
          owner: "B2",
          developer: "B2",
        }),
      /ownership/,
    );
  } finally {
    await clean();
  }
});
test("remote rejects credential, foreign and malformed URLs before accessing network", async () => {
  const { root, clean } = await fixture();
  try {
    for (const url of [
      "file:///tmp/repo",
      "https://example.invalid/owner/repo",
      "https://user:password@github.com/owner/repo",
      "https://github.com/owner/repo?token=fictional",
      "https://github.com/owner/repo#fragment",
      "https://github.com/owner/repo.git/extra",
    ])
      await assert.rejects(
        syncRemote(root, { ...config, remote: { ...config.remote, url } }),
        /HTTPS|github.com/,
      );
    await assert.rejects(
      syncRemote(root, {
        ...config,
        remote: { ...config.remote, branch: "--unsafe" },
      }),
      /branch/,
    );
    assert.deepEqual(await fs.readdir(root), []);
  } finally {
    await clean();
  }
});
