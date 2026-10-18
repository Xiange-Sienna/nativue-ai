import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { Config, Task, Tool } from "./types.ts";
const project = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
let cached: Record<string, unknown> | null = null;
let cachedAt = 0;
export function capabilities(config: Config) {
  if (cached && Date.now() - cachedAt < 30000)
    return Object.fromEntries(
      Object.entries(cached).map(([tool, value]) => [
        tool,
        {
          ...(value as object),
          backgroundAnalysis:
            config.tool === tool && config.analysis.command.length > 0,
        },
      ]),
    );
  cachedAt = Date.now();
  return (cached = Object.fromEntries(
    (["codex", "claude", "workbuddy"] as Tool[]).map((tool) => {
      const executable = tool === "claude" ? "claude" : tool;
      const result = spawnSync(executable, ["--version"], {
        encoding: "utf8",
        timeout: 3000,
      });
      return [
        tool,
        {
          skill: true,
          manual: true,
          nativeSubagents: tool !== "workbuddy",
          automatic:
            tool === "workbuddy"
              ? "runtime-detection-required"
              : "host-session-required",
          backgroundAnalysis:
            config.tool === tool && config.analysis.command.length > 0,
          installed: result.status === 0,
          version:
            result.status === 0 ? result.stdout.trim().slice(0, 120) : null,
          liveTested: false,
        },
      ];
    }),
  ));
}
export function installSkill(root: string, tool: Tool, destination?: string) {
  if (!["codex", "claude", "workbuddy"].includes(tool))
    throw Error("Unknown tool");
  if (tool === "workbuddy" && !destination)
    throw Error(
      "WorkBuddy: import skills/nativue in the app, or supply --destination with the skills directory configured by your installation.",
    );
  const target = destination
    ? path.resolve(destination, "nativue")
    : path.join(
        root,
        tool === "claude" ? ".claude" : ".agents",
        "skills",
        "nativue",
      );
  if (fs.existsSync(target))
    throw Error("Skill destination already exists: " + target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(project, "skills", "nativue"), target, {
    recursive: true,
  });
  return target;
}
export function handoff(
  task: Task | undefined,
  role: "A" | "B" | "C",
  config: Config,
) {
  return `# Nativue AI — Role ${role}\n\nUse the installed Nativue skill. Read project instructions and .nativue/analysis-request.json when present.\nMode: ${config.mode}; tool: ${config.tool}; requested model: ${config.models[role] || "choose in your host; report actual model"}.\n${task ? `Task: ${task.id} — ${task.title}\nPriority: ${task.priority}\nDescription: ${task.description}\nAcceptance criteria:\n${task.criteria.map((x) => "- " + x).join("\n")}\nDependencies: ${task.dependsOn.join(", ") || "none"}\nFiles: ${task.files.join(", ") || "claim before editing"}\nBase: ${task.baseCommit || "verify and record"}\nFrozen commit: ${task.commit || "not yet frozen"}\nIssue: ${task.issue || "local task"}\n` : ""}\n${role === "A" ? "Clarify approved behavior, claim non-overlapping files/environments, delegate B and independent C. Require single-task C acceptance before integration and independent integration C acceptance before user handtest. Update records via CLI; do not infer success from process exit." : role === "B" ? "Implement only approved scope in an isolated worktree, self-test, freeze a full commit SHA and submit evidence. Do not sign independent acceptance." : "Independently verify the exact frozen SHA and full baseline diff in an isolated environment. Do not modify product code. Report pass/fail/untested per criterion with evidence; reviewer must differ from developer."}\nNo remote mutations without existing authorization. Never replace missing independent C with self-review.\n`;
}
