import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import {
  defaultConfig,
  saveConfig,
  readConfig,
  readSnapshot,
  saveSnapshot,
  stateDir,
  readJson,
  atomicJson,
} from "./store.ts";
import { scanWorkspace, discoverWorkspaces } from "./scanner.ts";
import { readLedger, updateTask } from "./ledger.ts";
import { analysisRequest, importAnalysis } from "./analysis.ts";
import { Runtime } from "./runtime.ts";
import { serve } from "./server.ts";
import { capabilities, handoff, installSkill } from "./adapters.ts";
import { syncIssues } from "./issues.ts";
import type { Tool } from "./types.ts";
const args = process.argv.slice(2),
  command = args.shift() || "help";
const value = (name: string, fallback = "") => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] || fallback : fallback;
};
const positional = args.filter(
  (_, i) =>
    !args[i].startsWith("--") && (i === 0 || !args[i - 1].startsWith("--")),
);
const resolveRoot = (p?: string) =>
  fs.realpathSync(path.resolve(p || process.cwd()));
const help = `Nativue AI · SienGe AI Lab\nYour canvas for AI-native development.\n\n  nativue init [workspace] [--tool codex|claude|workbuddy] [--language en|zh]\n               [--mode manual|automatic] [--github https://github.com/org/repo.git] [--branch main]\n  nativue serve [workspace] [--port 4317]\n  nativue scan|analyze|sync|issues|doctor|check|stop [workspace]\n  nativue configure-runner <codex|claude|off> [workspace]\n  nativue import-analysis <result.json> [workspace] [--source local|remote]\n  nativue task <task.json> [workspace] --revision N --actor SESSION\n  nativue handoff <A|B|C> [taskId] [--workspace dir]\n  nativue install-skill <codex|claude|workbuddy> [workspace] [--destination dir]\n\nState is local in .nativue/. No background model runs until an analysis.command argv array is configured.\nUse the generated analysis-request.json with your host Agent and import-analysis for semantic architecture.\n`;
async function main() {
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      console.log(help);
      return;
    case "init": {
      let root = resolveRoot(positional[0]);
      const candidates = await discoverWorkspaces(root);
      if (candidates.length === 1 && candidates[0] !== root)
        root = candidates[0];
      if (candidates.length > 1 && !fs.existsSync(path.join(root, ".git"))) {
        if (!stdin.isTTY)
          throw Error(
            "Multiple repositories found; select one explicitly:\n" +
              candidates.join("\n"),
          );
        const rl = readline.createInterface({ input: stdin, output: stdout });
        console.log(
          candidates
            .map((p, i) => `${i + 1}. ${path.relative(root, p)}`)
            .join("\n"),
        );
        const chosen = Number(await rl.question("Select repository number: "));
        rl.close();
        if (!candidates[chosen - 1]) throw Error("Select one repository");
        root = candidates[chosen - 1];
      }
      if (fs.existsSync(path.join(root, ".nativue", "config.json")))
        throw Error(
          "Already initialized; edit .nativue/config.json or use dashboard settings",
        );
      const c = defaultConfig();
      c.tool = value("tool", "codex") as Tool;
      c.language = value("language", "en") as "en" | "zh";
      c.mode = value("mode", "manual") as "manual" | "automatic";
      if (stdin.isTTY && !args.includes("--tool")) {
        const rl = readline.createInterface({ input: stdin, output: stdout });
        c.tool = ((await rl.question(
          "AI tool [codex/claude/workbuddy] (codex): ",
        )) || "codex") as Tool;
        c.language = ((await rl.question("Language [en/zh] (en): ")) ||
          "en") as "en" | "zh";
        c.mode = ((await rl.question("Mode [manual/automatic] (manual): ")) ||
          "manual") as "manual" | "automatic";
        for (const role of ["A", "B", "C"] as const)
          c.models[role] = await rl.question(
            `Model for ${role} (blank: select in host): `,
          );
        const remote = await rl.question(
          "Optional GitHub HTTPS repository URL (blank: local only): ",
        );
        if (remote) {
          c.remote = {
            ...c.remote,
            enabled: true,
            url: remote,
            branch: (await rl.question("Remote branch (main): ")) || "main",
          };
        }
        rl.close();
      }
      const remote = value("github");
      if (remote)
        c.remote = {
          ...c.remote,
          enabled: true,
          url: remote,
          branch: value("branch", "main"),
        };
      saveConfig(root, c);
      const git = path.join(root, ".git");
      if (fs.existsSync(git)) {
        let gitdir = git;
        if (fs.statSync(git).isFile())
          gitdir = path.resolve(
            root,
            fs
              .readFileSync(git, "utf8")
              .trim()
              .replace(/^gitdir: /, ""),
          );
        const excludes = path.join(gitdir, "info", "exclude");
        fs.mkdirSync(path.dirname(excludes), { recursive: true });
        const old = fs.existsSync(excludes)
          ? fs.readFileSync(excludes, "utf8")
          : "";
        if (!old.split("\n").includes("/.nativue/"))
          fs.appendFileSync(excludes, "\n/.nativue/\n");
      }
      const snap = await scanWorkspace(root);
      saveSnapshot(root, snap);
      analysisRequest(root, snap);
      readLedger(root);
      console.log(
        `Initialized ${path.basename(root)}: ${snap.files.length} files, ${snap.modules.length} inferred modules.\nSemantic analysis queued in .nativue/analysis-request.json.\nStart: nativue serve "${root}"\nNo source code or project instructions were modified.`,
      );
      return;
    }
    case "serve": {
      const root = resolveRoot(positional[0]);
      if (!readSnapshot(root)) throw Error("Run nativue init first");
      const instance = await serve(root, Number(value("port", "4317")));
      console.log(
        `Nativue AI · ${instance.url}\nWorkspace: ${path.basename(root)}\nKeep this process running for automatic updates; Ctrl+C stops it.`,
      );
      return;
    }
    case "scan": {
      const root = resolveRoot(positional[0]),
        rt = new Runtime(root);
      const snap = await rt.scan(true);
      console.log(
        JSON.stringify({
          inputId: snap?.id,
          files: snap?.files.length,
          status: snap?.analysis.status,
        }),
      );
      return;
    }
    case "analyze": {
      const root = resolveRoot(positional[0]),
        rt = new Runtime(root);
      await rt.scan(true);
      await rt.analyze(true, value("source") === "remote" ? "remote" : "local");
      console.log(
        readConfig(root).analysis.command.length
          ? "Analysis completed"
          : ".nativue/analysis-request.json queued. Ask your AI tool to read the packet and source, then import-analysis the result.",
      );
      return;
    }
    case "issues": {
      const root = resolveRoot(positional[0]);
      console.log(JSON.stringify(await syncIssues(root, readConfig(root))));
      return;
    }
    case "configure-runner": {
      const tool = positional[0],
        root = resolveRoot(positional[1]);
      if (!["codex", "claude", "off"].includes(tool))
        throw Error("Choose codex, claude or off");
      const c = readConfig(root);
      c.analysis.command =
        tool === "off"
          ? []
          : [
              process.execPath,
              fileURLToPath(new URL("./host-runner.ts", import.meta.url)),
              tool,
            ];
      saveConfig(root, c);
      console.log(
        tool === "off"
          ? "Background analysis disabled; packets remain available"
          : `Configured ${tool} CLI for read-only source-packet analysis. This uses your host account and model usage. Daily call limit: ${c.analysis.maxCallsPerDay}.`,
      );
      return;
    }
    case "sync": {
      const root = resolveRoot(positional[0]);
      const s = await new Runtime(root).remote(true);
      console.log(
        JSON.stringify({ source: s?.source, files: s?.files.length }),
      );
      return;
    }
    case "import-analysis": {
      if (!positional[0]) throw Error("Result JSON required");
      const root = resolveRoot(positional[1]),
        s = await importAnalysis(
          root,
          JSON.parse(fs.readFileSync(path.resolve(positional[0]), "utf8")),
          value("source") === "remote" ? "remote" : "local",
        );
      console.log("Imported analysis for " + s.id);
      return;
    }
    case "task": {
      if (!positional[0] || !value("actor") || !value("revision"))
        throw Error("Task JSON, --revision N and --actor SESSION required");
      const root = resolveRoot(positional[1]);
      console.log(
        JSON.stringify(
          updateTask(
            root,
            Number(value("revision")),
            value("actor"),
            JSON.parse(fs.readFileSync(path.resolve(positional[0]), "utf8")),
          ),
        ),
      );
      return;
    }
    case "handoff": {
      const role = positional[0];
      if (!["A", "B", "C"].includes(role))
        throw Error("Role must be A, B or C");
      const root = resolveRoot(value("workspace"));
      const task = readLedger(root).tasks.find((t) => t.id === positional[1]);
      if (positional[1] && !task) throw Error("Task not found");
      console.log(handoff(task, role as "A" | "B" | "C", readConfig(root)));
      return;
    }
    case "install-skill": {
      const tool = positional[0] as Tool,
        root = resolveRoot(positional[1]);
      console.log(installSkill(root, tool, value("destination") || undefined));
      return;
    }
    case "doctor":
    case "check": {
      const root = resolveRoot(positional[0]),
        c = readConfig(root),
        s = readSnapshot(root),
        l = readLedger(root);
      const errors = [];
      if (!s) errors.push("Workspace is not initialized");
      if (s && s.analysis.status !== "complete")
        errors.push("Architecture semantics " + s.analysis.status);
      for (const t of l.tasks) {
        if (
          [
            "passed",
            "integrated",
            "integration-review",
            "integration-passed",
            "handtest",
            "done",
          ].includes(t.status) &&
          !t.reviews.some((r) => r.passed && r.commit === t.commit)
        )
          errors.push(t.id + ": missing matching independent review");
      }
      console.log(
        JSON.stringify(
          {
            ok: !errors.length,
            errors,
            capabilities: capabilities(c),
            taskRevision: l.revision,
          },
          null,
          2,
        ),
      );
      if (command === "check" && errors.length) process.exitCode = 1;
      return;
    }
    case "stop": {
      const root = resolveRoot(positional[0]);
      const meta = readJson<{ url: string; token: string } | null>(
        path.join(stateDir(root), "server.json"),
        null,
      );
      if (!meta) throw Error("No running service record");
      const res = await fetch(meta.url + "/api/control", {
        method: "POST",
        headers: {
          authorization: "Bearer " + meta.token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) throw Error("Unable to stop service");
      console.log("Stopped");
      return;
    }
    default:
      throw Error("Unknown command: " + command + "\n" + help);
  }
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
