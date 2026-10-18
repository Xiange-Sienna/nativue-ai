import fs from "node:fs";
import path from "node:path";
import type { RuntimeState, Snapshot } from "./types.ts";
import { scanWorkspace } from "./scanner.ts";
import { syncRemote } from "./remote.ts";
import { syncIssues } from "./issues.ts";
import {
  readConfig,
  readSnapshot,
  saveSnapshot,
  atomicJson,
  stateDir,
} from "./store.ts";
import { analysisRequest, runAnalysis } from "./analysis.ts";
import { claimAnalysis, readBudget } from "./analysis-lock.ts";
export class Runtime {
  root: string;
  state: RuntimeState;
  listeners = new Set<() => void>();
  watcher: fs.FSWatcher | null = null;
  timers: ReturnType<typeof setInterval>[] = [];
  pending: ReturnType<typeof setTimeout> | null = null;
  scanning = false;
  scanPromise: Promise<Snapshot | undefined> | null = null;
  closed = false;
  lastStateStamp = 0;
  analysisAbort: AbortController | null = null;
  activeAnalysis: Promise<Snapshot | null> | null = null;
  remoteAbort: AbortController | null = null;
  activeRemote: Promise<Snapshot> | null = null;
  remoteBusy = false;
  remoteNextAttempt = 0;
  remoteFailures = 0;
  constructor(root: string) {
    this.root = root;
    const b = readBudget(root);
    this.state = {
      running: false,
      paused: false,
      analysisCalls: b.calls,
      analysisDay: b.day,
      analyzing: false,
      changedFiles: [],
    };
  }
  emit() {
    const b = readBudget(this.root);
    this.state.analysisCalls = b.calls;
    this.state.analysisDay = b.day;
    atomicJson(
      path.join(stateDir(this.root), "runtime-state.json"),
      this.state,
    );
    for (const fn of this.listeners) fn();
  }
  async scan(force = false): Promise<Snapshot | undefined> {
    if (this.closed || (this.state.paused && !force)) return;
    if (this.scanPromise) return this.scanPromise;
    this.scanning = true;
    this.scanPromise = this.performScan();
    try {
      return await this.scanPromise;
    } finally {
      this.scanPromise = null;
      this.scanning = false;
      if (!this.closed) this.emit();
    }
  }
  private async performScan() {
    try {
      const previous = readSnapshot(this.root),
        scanned = await scanWorkspace(this.root);
      if (this.closed) return;
      this.state.lastScan = new Date().toISOString();
      if (previous?.id === scanned.id) return previous;
      const old = new Map(previous?.files.map((f) => [f.path, f.hash]));
      this.state.changedFiles = [
        ...scanned.files
          .filter((f) => old.get(f.path) !== f.hash)
          .map((f) => f.path),
        ...(previous?.files
          .filter((f) => !scanned.files.some((n) => n.path === f.path))
          .map((f) => f.path) || []),
      ];
      let next = scanned;
      if (
        previous &&
        ["complete", "stale", "failed"].includes(previous.analysis.status)
      ) {
        const available = new Set(scanned.files.map((f) => f.path));
        const modules = previous.modules
          .map((m) => ({
            ...m,
            files: m.files.filter((f) => available.has(f)),
            evidence: m.evidence.filter((e) => available.has(e.path)),
          }))
          .filter((m) => m.files.length && m.evidence.length);
        const ids = new Set(modules.map((m) => m.id)),
          assigned = new Set(modules.flatMap((m) => m.files));
        next = {
          ...scanned,
          modules: [
            ...modules,
            ...scanned.modules
              .map((m) => ({
                ...m,
                id: "scan-" + m.id,
                files: m.files.filter((f) => !assigned.has(f)),
              }))
              .filter((m) => m.files.length),
          ],
          edges: previous.edges.filter(
            (e) =>
              ids.has(e.from) &&
              ids.has(e.to) &&
              e.evidence.every((p) => available.has(p.path)),
          ),
          journeys: previous.journeys.filter((j) =>
            j.steps.every(
              (st) =>
                ids.has(st.moduleId) &&
                st.evidence.every((e) => available.has(e.path)),
            ),
          ),
          analysis: {
            ...previous.analysis,
            status: "stale",
            inputId: scanned.id,
          },
        };
      }
      saveSnapshot(this.root, next);
      analysisRequest(this.root, next, this.state.changedFiles);
      this.state.error = undefined;
      return next;
    } catch (e) {
      this.state.error = (e as Error).message;
      throw e;
    }
  }
  async analyze(force = false, kind: "local" | "remote" = "local") {
    if (this.closed || this.state.analyzing || (this.state.paused && !force))
      return;
    const c = readConfig(this.root),
      s = readSnapshot(this.root, kind);
    if (!s) {
      if (force)
        throw Error(
          "No snapshot for the selected source; scan or sync it first",
        );
      return;
    }
    if (!force && (!c.analysis.enabled || s.analysis.status === "complete"))
      return;
    analysisRequest(
      this.root,
      s,
      kind === "local" ? this.state.changedFiles : [],
    );
    if (!c.analysis.command.length) {
      this.emit();
      return;
    }
    let claim;
    try {
      claim = claimAnalysis(
        this.root,
        c.analysis.maxCallsPerDay,
        c.analysis.minIntervalMs,
        force,
      );
    } catch (e) {
      if (!force) return;
      throw e;
    }
    if (!claim) return;
    this.state.analyzing = true;
    this.analysisAbort = new AbortController();
    this.emit();
    try {
      this.activeAnalysis = runAnalysis(
        this.root,
        s,
        c,
        kind === "local" ? this.state.changedFiles : [],
        this.analysisAbort.signal,
      );
      await this.activeAnalysis;
      this.state.error = undefined;
    } catch (e) {
      if (!this.closed) {
        const current = readSnapshot(this.root, kind);
        if (current?.id === s.id) {
          current.analysis = {
            ...current.analysis,
            status: "failed",
            error: (e as Error).message,
          };
          saveSnapshot(this.root, current);
        }
        this.state.error = (e as Error).message;
      }
      throw e;
    } finally {
      claim.release();
      this.analysisAbort = null;
      this.activeAnalysis = null;
      this.state.analyzing = false;
      if (!this.closed) this.emit();
    }
  }
  async remote(force = false) {
    if (this.closed || this.remoteBusy || (this.state.paused && !force)) return;
    const c = readConfig(this.root);
    if (!c.remote.enabled) throw Error("GitHub sync is not enabled");
    this.remoteBusy = true;
    this.remoteAbort = new AbortController();
    try {
      this.activeRemote = syncRemote(this.root, c, this.remoteAbort.signal);
      let s = await this.activeRemote;
      if (this.closed) return;
      const old = readSnapshot(this.root, "remote");
      if (old?.id === s.id) s = old;
      saveSnapshot(this.root, s);
      analysisRequest(this.root, s);
      this.state.lastRemote = new Date().toISOString();
      this.remoteFailures = 0;
      this.remoteNextAttempt = Date.now() + c.remote.intervalMs;
      await syncIssues(this.root, c, this.remoteAbort.signal);
      if (this.closed) return;
      this.state.error = undefined;
      void this.analyze(false, "remote").catch(() => {});
      return s;
    } catch (e) {
      if (!this.closed) {
        this.remoteFailures++;
        this.remoteNextAttempt =
          Date.now() +
          Math.min(
            1800000,
            c.remote.intervalMs * 2 ** Math.min(this.remoteFailures, 4),
          );
        this.state.error = (e as Error).message;
      }
      throw e;
    } finally {
      this.activeRemote = null;
      this.remoteAbort = null;
      this.remoteBusy = false;
      if (!this.closed) this.emit();
    }
  }
  async start() {
    this.state.running = true;
    await this.scan(true);
    if (this.closed) return;
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, (_, file) => {
        const rel = String(file || "").replaceAll("\\", "/");
        if (
          rel.startsWith(".nativue/") ||
          rel.startsWith(".git/") ||
          /(^|\/)(node_modules|dist|build|\.next)(\/|$)/.test(rel) ||
          this.state.paused ||
          this.closed
        )
          return;
        if (this.pending) clearTimeout(this.pending);
        this.pending = setTimeout(() => {
          void this.scan()
            .then(() => this.analyze())
            .catch(() => {});
        }, readConfig(this.root).refresh.debounceMs);
      });
    } catch {
      this.state.error =
        "File watching unavailable; periodic reconciliation remains active";
    }
    this.timers.push(
      setInterval(() => {
        if (this.closed || this.state.paused) return;
        const c = readConfig(this.root);
        if (
          Date.now() - Date.parse(this.state.lastScan || "1970-01-01") >=
          c.refresh.reconcileMs
        )
          void this.scan()
            .then(() => this.analyze())
            .catch(() => {});
        if (c.remote.enabled && Date.now() >= this.remoteNextAttempt)
          void this.remote().catch(() => {});
        const stamp = [
          "ledger.json",
          "local.json",
          "config.json",
          "analysis-budget.json",
        ]
          .map((f) => path.join(stateDir(this.root), f))
          .reduce(
            (sum, f) => sum + (fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0),
            0,
          );
        if (stamp !== this.lastStateStamp) {
          this.lastStateStamp = stamp;
          this.emit();
        }
      }, 1000),
    );
    void this.analyze().catch(() => {});
    this.emit();
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.watcher?.close();
    this.timers.forEach(clearInterval);
    if (this.pending) clearTimeout(this.pending);
    this.analysisAbort?.abort();
    this.remoteAbort?.abort();
    this.state.running = false;
    this.emit();
    await Promise.allSettled(
      [this.scanPromise, this.activeAnalysis, this.activeRemote].filter(
        Boolean,
      ),
    );
  }
}
