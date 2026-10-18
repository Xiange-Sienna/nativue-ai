import fs from "node:fs";
import path from "node:path";
import { atomicJson, readJson, stateDir } from "./store.ts";
export interface AnalysisBudget {
  day: string;
  calls: number;
  lastAttempt: number;
}
export function readBudget(root: string): AnalysisBudget {
  const today = new Date().toISOString().slice(0, 10);
  const value = readJson<AnalysisBudget>(
    path.join(stateDir(root), "analysis-budget.json"),
    { day: today, calls: 0, lastAttempt: 0 },
  );
  return value.day === today ? value : { day: today, calls: 0, lastAttempt: 0 };
}
export function claimAnalysis(
  root: string,
  limit: number,
  minInterval: number,
  force: boolean,
) {
  const dir = stateDir(root),
    lock = path.join(dir, "analysis.lock");
  let fd: number;
  try {
    fd = fs.openSync(lock, "wx", 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    let old: { pid: number };
    try {
      old = JSON.parse(fs.readFileSync(lock, "utf8"));
    } catch {
      throw Error(
        "Analysis busy; inspect the local analysis lock before retrying",
      );
    }
    try {
      process.kill(old.pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH") {
        fs.unlinkSync(lock);
        return claimAnalysis(root, limit, minInterval, force);
      }
    }
    throw Error("Analysis already running in another process");
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  };
  try {
    fs.writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
    );
    const budget = readBudget(root);
    if (!force && Date.now() - budget.lastAttempt < minInterval) {
      release();
      return null;
    }
    if (budget.calls >= limit) throw Error("Daily analysis call limit reached");
    budget.calls++;
    budget.lastAttempt = Date.now();
    atomicJson(path.join(dir, "analysis-budget.json"), budget);
    return { budget, release };
  } catch (e) {
    release();
    throw e;
  }
}
