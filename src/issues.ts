import type { Config, Task } from "./types.ts";
import { readLedger, updateTask } from "./ledger.ts";
export async function syncIssues(
  root: string,
  config: Config,
  signal?: AbortSignal,
) {
  if (!config.remote.enabled) throw Error("Enable GitHub sync first");
  const u = new URL(config.remote.url);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "github.com" ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw Error("Use a public HTTPS GitHub repository");
  const slug = u.pathname
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(slug))
    throw Error("Invalid GitHub repository");
  let imported = 0;
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${slug}/issues?state=open&per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "nativue-ai",
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      },
    );
    if (!res.ok)
      throw Error(
        `GitHub Issues read failed (${res.status}); public repositories only in this release`,
      );
    const list = await res.json();
    if (!Array.isArray(list)) throw Error("Invalid GitHub Issues response");
    for (const issue of list) {
      if (issue.pull_request) continue;
      const ledger = readLedger(root);
      const id = "GH-" + issue.number;
      if (ledger.tasks.some((t) => t.issue === issue.html_url || t.id === id))
        continue;
      const label = issue.labels
        .map((l: { name: string }) => l.name.toUpperCase())
        .find((n: string) => /^P[012]$/.test(n));
      const task: Task = {
        id,
        title: issue.title,
        description: (issue.body || "").slice(0, 20000),
        issue: issue.html_url,
        priority: label || "P2",
        status: "todo",
        criteria: [],
        dependsOn: [],
        files: [],
        reviews: [],
        updatedAt: new Date().toISOString(),
      };
      updateTask(root, ledger.revision, "github-sync", task);
      imported++;
    }
    if (list.length < 100) break;
  }
  return { imported };
}
