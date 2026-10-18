import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Config, Snapshot } from "./types.ts";
export const defaultConfig = (): Config => ({
  schemaVersion: 1,
  language: "en",
  tool: "codex",
  mode: "manual",
  models: { A: "", B: "", C: "" },
  exclude: [],
  remote: { enabled: false, url: "", branch: "main", intervalMs: 300000 },
  analysis: {
    enabled: true,
    command: [],
    minIntervalMs: 300000,
    maxCallsPerDay: 12,
  },
  refresh: { debounceMs: 10000, reconcileMs: 60000 },
});
export function stateDir(root: string) {
  const dir = path.join(root, ".nativue");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(dir).isSymbolicLink())
    throw Error("State directory must not be a symlink");
  return dir;
}
export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}
export function atomicJson(file: string, value: unknown) {
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(tmp, file);
}
export function readConfig(root: string): Config {
  return readJson(path.join(stateDir(root), "config.json"), defaultConfig());
}
export function validateConfig(c: Config) {
  if (
    c.schemaVersion !== 1 ||
    !["en", "zh"].includes(c.language) ||
    !["codex", "claude", "workbuddy"].includes(c.tool) ||
    !["manual", "automatic"].includes(c.mode)
  )
    throw Error("Invalid configuration");
  if (
    !c.models ||
    !["A", "B", "C"].every(
      (k) => typeof c.models[k as keyof typeof c.models] === "string",
    )
  )
    throw Error("Invalid role models");
  if (
    !Array.isArray(c.exclude) ||
    !c.exclude.every((x) => typeof x === "string")
  )
    throw Error("Invalid exclusions");
  if (
    !Array.isArray(c.analysis.command) ||
    !c.analysis.command.every((x) => typeof x === "string")
  )
    throw Error("Invalid analysis command");
  for (const v of [
    c.analysis.minIntervalMs,
    c.refresh.debounceMs,
    c.refresh.reconcileMs,
    c.remote.intervalMs,
  ])
    if (!Number.isFinite(v) || v < 1000)
      throw Error("Intervals must be at least 1000ms");
  if (
    !Number.isInteger(c.analysis.maxCallsPerDay) ||
    c.analysis.maxCallsPerDay < 0
  )
    throw Error("Invalid analysis call limit");
  if (
    typeof c.remote.url !== "string" ||
    !c.remote.branch ||
    typeof c.remote.enabled !== "boolean" ||
    typeof c.analysis.enabled !== "boolean"
  )
    throw Error("Invalid remote/analysis configuration");
}
export function saveConfig(root: string, c: Config) {
  validateConfig(c);
  atomicJson(path.join(stateDir(root), "config.json"), c);
}
export function readSnapshot(root: string, kind: "local" | "remote" = "local") {
  return readJson<Snapshot | null>(
    path.join(stateDir(root), kind + ".json"),
    null,
  );
}
export function saveSnapshot(root: string, s: Snapshot) {
  atomicJson(path.join(stateDir(root), s.source.kind + ".json"), s);
}
