export type Language = "en" | "zh";
export type Tool = "codex" | "claude" | "workbuddy";
export interface FileEntry {
  path: string;
  hash: string;
  size: number;
  language: string;
  moduleId: string;
}
export interface Evidence {
  path: string;
  line?: number;
  note?: string;
}
export interface Module {
  id: string;
  name: string;
  description: string;
  kind: string;
  files: string[];
  evidence: Evidence[];
  confidence: "observed" | "inferred" | "verified";
  x?: number;
  y?: number;
}
export interface Edge {
  id: string;
  from: string;
  to: string;
  label: string;
  evidence: Evidence[];
  confidence: "observed" | "inferred" | "verified";
}
export interface Journey {
  id: string;
  name: string;
  description: string;
  steps: { moduleId: string; label: string; evidence: Evidence[] }[];
  confidence: "inferred" | "verified";
}
export interface Snapshot {
  schemaVersion: 1;
  id: string;
  generatedAt: string;
  source: {
    kind: "local" | "remote";
    commit: string | null;
    branch: string | null;
    dirty: boolean;
  };
  files: FileEntry[];
  modules: Module[];
  edges: Edge[];
  journeys: Journey[];
  warnings: string[];
  analysis: {
    status: "pending" | "complete" | "stale" | "failed";
    inputId: string;
    updatedAt?: string;
    error?: string;
  };
}
export type TaskStatus =
  | "todo"
  | "developing"
  | "review"
  | "rework"
  | "passed"
  | "integrated"
  | "integration-review"
  | "integration-passed"
  | "handtest"
  | "done";
export interface Review {
  reviewer: string;
  commit: string;
  report: string;
  passed: boolean;
  untested: string[];
  at: string;
}
export interface Task {
  id: string;
  title: string;
  priority: "P0" | "P1" | "P2";
  status: TaskStatus;
  issue?: string;
  description: string;
  criteria: string[];
  dependsOn: string[];
  files: string[];
  owner?: string;
  developer?: string;
  integrator?: string;
  reviewer?: string;
  branch?: string;
  baseCommit?: string;
  commit?: string;
  integrationCommit?: string;
  reviews: Review[];
  integrationReview?: Review;
  userAcceptance?: { commit: string; source: string; at: string };
  blocked?: string;
  updatedAt: string;
}
export interface Ledger {
  schemaVersion: 1;
  revision: number;
  tasks: Task[];
  events: { at: string; taskId: string; actor: string; action: string }[];
}
export interface Config {
  schemaVersion: 1;
  language: Language;
  tool: Tool;
  mode: "manual" | "automatic";
  models: { A: string; B: string; C: string };
  exclude: string[];
  remote: { enabled: boolean; url: string; branch: string; intervalMs: number };
  analysis: {
    enabled: boolean;
    command: string[];
    minIntervalMs: number;
    maxCallsPerDay: number;
  };
  refresh: { debounceMs: number; reconcileMs: number };
}
export interface RuntimeState {
  running: boolean;
  paused: boolean;
  lastScan?: string;
  lastRemote?: string;
  error?: string;
  analysisCalls: number;
  analysisDay: string;
  analyzing: boolean;
  changedFiles: string[];
}
export interface DashboardState {
  config: Config;
  local: Snapshot;
  remote: Snapshot | null;
  ledger: Ledger;
  runtime: RuntimeState;
  capabilities: Record<string, unknown>;
}
