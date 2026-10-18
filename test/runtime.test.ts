import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultConfig,
  saveConfig,
  saveSnapshot,
  readSnapshot,
} from "../src/store.ts";
import { scanWorkspace } from "../src/scanner.ts";
import { analysisRequest, importAnalysis } from "../src/analysis.ts";
import { Runtime } from "../src/runtime.ts";
import { serve } from "../src/server.ts";
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-test-"));
  fs.mkdirSync(path.join(root, "client"));
  fs.mkdirSync(path.join(root, "server"));
  fs.writeFileSync(
    path.join(root, "client", "app.ts"),
    "import {api} from '../server/api.ts';\nexport const start=api;\n",
  );
  fs.writeFileSync(
    path.join(root, "server", "api.ts"),
    "export const api='hello';\n",
  );
  saveConfig(root, defaultConfig());
  return root;
}
test("semantic analysis import is evidence-bound and rejects source modified since scan", async () => {
  const root = fixture();
  try {
    const s = await scanWorkspace(root);
    saveSnapshot(root, s);
    analysisRequest(root, s);
    const result = {
      schemaVersion: 1 as const,
      inputId: s.id,
      modules: s.modules,
      edges: s.edges,
      journeys: [],
    };
    const accepted = await importAnalysis(root, result);
    assert.equal(accepted.analysis.status, "complete");
    fs.writeFileSync(
      path.join(root, "server", "api.ts"),
      "export const api=2;",
    );
    await assert.rejects(() => importAnalysis(root, result), /Source changed/);
    result.inputId = "stale";
    await assert.rejects(() => importAnalysis(root, result), /Stale analysis/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("analysis rejects nonexistent evidence rather than publishing invented relations", async () => {
  const root = fixture();
  try {
    const s = await scanWorkspace(root);
    saveSnapshot(root, s);
    await assert.rejects(
      () =>
        importAnalysis(root, {
          schemaVersion: 1,
          inputId: s.id,
          modules: s.modules.map((m) => ({
            ...m,
            evidence: [{ path: "missing.ts" }],
          })),
          edges: [],
          journeys: [],
        }),
      /Evidence/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("runtime preserves prior semantics with stale label, handles deletion and queues without a runner", async () => {
  const root = fixture();
  try {
    const rt = new Runtime(root);
    await rt.scan(true);
    const s = readSnapshot(root)!;
    await importAnalysis(root, {
      schemaVersion: 1,
      inputId: s.id,
      modules: s.modules,
      edges: s.edges,
      journeys: [],
    });
    fs.writeFileSync(
      path.join(root, "client", "app.ts"),
      "export const app=3;",
    );
    await rt.scan(true);
    assert.equal(readSnapshot(root)!.analysis.status, "stale");
    await rt.analyze(true);
    assert.equal(rt.state.analysisCalls, 0);
    assert.ok(
      fs.existsSync(path.join(root, ".nativue", "analysis-request.json")),
    );
    fs.unlinkSync(path.join(root, "server", "api.ts"));
    await rt.scan(true);
    assert.ok(
      !readSnapshot(root)!.files.some((f) => f.path === "server/api.ts"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("background runner accepts stdin JSON and records budget, malformed results retain last map", async () => {
  const root = fixture();
  try {
    const runner = path.join(root, ".nativue", "runner.mjs");
    fs.writeFileSync(
      runner,
      `let text='';for await(const c of process.stdin)text+=c;const r=JSON.parse(text);console.log(JSON.stringify({schemaVersion:1,inputId:r.inputId,modules:r.modules,edges:r.edges,journeys:r.journeys}));`,
    );
    const c = defaultConfig();
    c.analysis.command = [process.execPath, runner];
    c.analysis.maxCallsPerDay = 1;
    saveConfig(root, c);
    const rt = new Runtime(root);
    await rt.scan(true);
    await rt.analyze(true);
    assert.equal(readSnapshot(root)!.analysis.status, "complete");
    assert.equal(rt.state.analysisCalls, 1);
    await assert.rejects(() => rt.analyze(true), /Daily analysis/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("local HTTP validates host/origin, requires mutation token and confines file previews", async () => {
  const root = fixture();
  const app = await serve(root, 0);
  try {
    const page = await fetch(app.url);
    assert.equal(page.status, 200);
    const cookie = page.headers.get("set-cookie")!.split(";")[0];
    const state = await (await fetch(app.url + "/api/state")).json();
    assert.equal(state.workspaceName, path.basename(root));
    assert.equal(
      (
        await fetch(app.url + "/api/control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"action":"pause"}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(app.url + "/api/control", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            origin: "https://outside.example",
          },
          body: '{"action":"pause"}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(app.url + "/api/control", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie,
            origin: app.url,
          },
          body: '{"action":"pause"}',
        })
      ).status,
      200,
    );
    assert.equal(app.runtime.state.paused, true);
    assert.equal(
      (await fetch(app.url + "/api/file?path=../../etc/passwd")).status,
      404,
    );
    const preview = await (
      await fetch(app.url + "/api/file?path=client/app.ts")
    ).json();
    assert.match(preview.content, /export const start/);
  } finally {
    app.close();
    await new Promise((r) => setTimeout(r, 50));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("semantic import rejects evidence beyond the actual source line count", async () => {
  const root = fixture();
  try {
    const s = await scanWorkspace(root);
    saveSnapshot(root, s);
    await assert.rejects(
      () =>
        importAnalysis(root, {
          schemaVersion: 1,
          inputId: s.id,
          modules: s.modules.map((m) => ({
            ...m,
            evidence: [{ path: m.files[0], line: 999999 }],
          })),
          edges: [],
          journeys: [],
        }),
      /exceeds/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("malformed background output does not replace previous semantics", async () => {
  const root = fixture();
  try {
    const c = defaultConfig();
    c.analysis.command = [
      process.execPath,
      "-e",
      'process.stdin.resume();process.stdin.on("end",()=>console.log("invalid JSON"))',
    ];
    saveConfig(root, c);
    const rt = new Runtime(root);
    await rt.scan(true);
    const s = readSnapshot(root)!;
    await importAnalysis(root, {
      schemaVersion: 1,
      inputId: s.id,
      modules: s.modules,
      edges: s.edges,
      journeys: [],
    });
    await assert.rejects(() => rt.analyze(true));
    const failed = readSnapshot(root)!;
    assert.equal(failed.analysis.status, "failed");
    assert.deepEqual(failed.modules, s.modules);
    fs.writeFileSync(
      path.join(root, "client", "app.ts"),
      "export const changed=1;",
    );
    await rt.scan(true);
    assert.equal(readSnapshot(root)!.analysis.status, "stale");
    assert.deepEqual(
      readSnapshot(root)!.modules.map((m) => m.id),
      s.modules.map((m) => m.id),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("indexed source refuses internal secret symlink swaps and modified contents", async () => {
  const { readIndexedSource } = await import("../src/source.ts");
  const root = fixture();
  try {
    const s = await scanWorkspace(root);
    const f = s.files.find((f) => f.path === "client/app.ts")!;
    fs.writeFileSync(
      path.join(root, ".env"),
      "FICTIONAL_SECRET=not-for-analysis",
    );
    fs.unlinkSync(path.join(root, f.path));
    fs.symlinkSync("../.env", path.join(root, f.path));
    assert.throws(() => readIndexedSource(root, f), /symbolic link/);
    fs.unlinkSync(path.join(root, f.path));
    fs.writeFileSync(path.join(root, f.path), "different source");
    assert.throws(() => readIndexedSource(root, f), /changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("two Runtime instances share analysis serialization and daily budget", async () => {
  const root = fixture();
  try {
    const runner = path.join(root, ".nativue", "delayed.mjs");
    fs.writeFileSync(
      runner,
      `let text='';for await(const c of process.stdin)text+=c;const r=JSON.parse(text);await new Promise(r=>setTimeout(r,150));console.log(JSON.stringify({schemaVersion:1,inputId:r.inputId,modules:r.modules,edges:r.edges,journeys:[]}));`,
    );
    const c = defaultConfig();
    c.analysis.command = [process.execPath, runner];
    c.analysis.maxCallsPerDay = 1;
    saveConfig(root, c);
    const r1 = new Runtime(root),
      r2 = new Runtime(root);
    await r1.scan(true);
    const results = await Promise.allSettled([
      r1.analyze(true),
      r2.analyze(true),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    await assert.rejects(() => r2.analyze(true), /Daily analysis/);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(root, ".nativue", "analysis-budget.json"),
          "utf8",
        ),
      ).calls,
      1,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("close cancels a running analysis and prevents queued scan continuations from starting new calls", async () => {
  const root = fixture();
  try {
    const runner = path.join(root, ".nativue", "long.mjs");
    fs.writeFileSync(
      runner,
      'process.stdin.resume();process.stdin.on("end",()=>setInterval(()=>{},1000));process.on("SIGTERM",()=>{});',
    );
    const c = defaultConfig();
    c.analysis.command = [process.execPath, runner];
    saveConfig(root, c);
    const rt = new Runtime(root);
    await rt.scan(true);
    const pending = rt.analyze(true).catch((e) => e);
    await new Promise((r) => setTimeout(r, 100));
    const started = Date.now();
    await rt.close();
    assert.ok(Date.now() - started < 3000);
    await pending;
    assert.equal(rt.state.running, false);
    const r2 = new Runtime(root);
    const chain = r2.scan(true).then(() => r2.analyze());
    await r2.close();
    await chain;
    assert.equal(r2.state.analysisCalls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
