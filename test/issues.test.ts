import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultConfig } from "../src/store.ts";
import { syncIssues } from "../src/issues.ts";
import { readLedger } from "../src/ledger.ts";
test("GitHub import reads open issues, keeps exact priority labels and preserves existing progress", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-issues-"));
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    assert.match(
      String(input),
      /^https:\/\/api.github.com\/repos\/example\/sample\/issues\?/,
    );
    return new Response(
      JSON.stringify([
        {
          number: 1,
          title: "Save fails",
          body: "Repro steps",
          html_url: "https://github.com/example/sample/issues/1",
          labels: [{ name: "P1" }],
        },
        { number: 2, title: "Pull request", pull_request: {}, labels: [] },
      ]),
      { status: 200 },
    );
  };
  try {
    const c = defaultConfig();
    c.remote = {
      ...c.remote,
      enabled: true,
      url: "https://github.com/example/sample.git",
    };
    assert.equal((await syncIssues(root, c)).imported, 1);
    assert.equal(readLedger(root).tasks[0].priority, "P1");
    assert.equal(readLedger(root).tasks[0].criteria.length, 0);
    assert.equal((await syncIssues(root, c)).imported, 0);
    assert.equal(readLedger(root).revision, 1);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
