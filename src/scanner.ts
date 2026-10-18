import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Snapshot, FileEntry, Module, Edge } from "./types.ts";
const run = promisify(execFile);
const excluded = new Set([
  ".git",
  ".nativue",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".tmp",
  "target",
  "vendor",
  "coverage",
  "__pycache__",
  ".cache",
  ".venv",
  "venv",
  "runtime",
  "tenants",
  "tenant-data",
  "secrets",
  "secret",
  "credentials",
  ".ssh",
  ".aws",
]);
const sensitive =
  /(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx|sqlite|db)|.*(?:credential|secret|token)s?\.json)$/i;
const extensions: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".cs": "C#",
  ".rb": "Ruby",
  ".php": "PHP",
  ".swift": "Swift",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".json": "JSON",
  ".md": "Markdown",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".css": "CSS",
  ".html": "HTML",
  ".sql": "SQL",
};
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const slash = (value: string) => value.split(path.sep).join("/");
async function git(root: string, args: string[]): Promise<string> {
  return (
    await run(
      "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        root,
        ...args,
      ],
      { maxBuffer: 16 * 1024 * 1024, timeout: 15000 },
    )
  ).stdout;
}
function allowed(file: string, extra: string[] = []): boolean {
  return (
    !file.split("/").some((p) => excluded.has(p) || p.startsWith(".cache")) &&
    !sensitive.test(file) &&
    !extra.some((p) => globMatches(file, p))
  );
}
function globMatches(file: string, pattern: string): boolean {
  const p = pattern.replace(/^\//, "").replace(/\/$/, "");
  if (!p) return false;
  if (!/[?*]/.test(p))
    return (
      file === p ||
      file.startsWith(p + "/") ||
      (!p.includes("/") && file.split("/").includes(p))
    );
  const rx = p
    .split("**")
    .map((x) =>
      x
        .split("*")
        .map((x) => x.replace(/[.+^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*")
    .replace(/\?/g, "[^/]");
  return new RegExp((p.includes("/") ? "^" : "(?:^|/)") + rx + "(?:/|$)").test(
    file,
  );
}
async function walk(root: string, limit = 10000): Promise<string[]> {
  const found: string[] = [];
  let examined = 0;
  async function visit(dir: string) {
    if (examined++ > 20000) return;
    for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (found.length >= limit) return;
      const name = slash(path.relative(root, path.join(dir, e.name)));
      if (!allowed(name) || e.isSymbolicLink()) continue;
      if (e.isDirectory()) await visit(path.join(dir, e.name));
      else if (e.isFile()) found.push(name);
    }
  }
  await visit(root);
  return found;
}
export async function discoverWorkspaces(root: string): Promise<string[]> {
  const base = await fs.realpath(root);
  const result: string[] = [];
  async function inspect(dir: string, depth: number) {
    for (const marker of [
      ".git",
      "package.json",
      "pyproject.toml",
      "Cargo.toml",
      "go.mod",
      "pom.xml",
    ]) {
      try {
        await fs.lstat(path.join(dir, marker));
        result.push(dir);
        return;
      } catch {}
    }
    if (depth === 0) return;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !excluded.has(entry.name) &&
        !entry.name.startsWith(".")
      )
        await inspect(path.join(dir, entry.name), depth - 1);
    }
  }
  await inspect(base, 2);
  return result.length ? result.sort() : [base];
}
export async function scanWorkspace(
  root: string,
  kind: "local" | "remote" = "local",
  options: { exclude?: string[] } = {},
): Promise<Snapshot> {
  const base = await fs.realpath(root);
  const warnings: string[] = [];
  let candidates: string[];
  let commit: string | null = null,
    branch: string | null = null,
    dirty = false;
  let extra: string[] = [...(options.exclude || [])];
  try {
    const config = JSON.parse(
      await fs.readFile(path.join(base, ".nativue/config.json"), "utf8"),
    );
    if (Array.isArray(config.exclude))
      extra.push(
        ...config.exclude.filter((p: unknown) => typeof p === "string"),
      );
  } catch {}
  try {
    candidates = (
      await git(base, ["ls-files", "-c", "-o", "--exclude-standard", "-z"])
    )
      .split("\0")
      .filter(Boolean);
    try {
      commit = (await git(base, ["rev-parse", "HEAD"])).trim();
    } catch {}
    try {
      branch = (await git(base, ["branch", "--show-current"])).trim() || null;
    } catch {}
    dirty = Boolean(
      (
        await git(base, ["status", "--porcelain", "--untracked-files=normal"])
      ).trim(),
    );
  } catch {
    candidates = await walk(base);
    warnings.push(
      "Git metadata unavailable; scanned local files. / 无 Git 版本信息，使用本地文件扫描。",
    );
    // Basic fallback ignore rules; Git repositories use Git itself, including nested ignore rules.
    try {
      const rules = (await fs.readFile(path.join(base, ".gitignore"), "utf8"))
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p && !p.startsWith("#"));
      candidates = candidates.filter((file) => {
        let ignore = false;
        for (const rule of rules) {
          const negated = rule.startsWith("!");
          if (globMatches(file, negated ? rule.slice(1) : rule))
            ignore = !negated;
        }
        return !ignore;
      });
    } catch {}
  }
  candidates = [...new Set(candidates)]
    .filter(
      (p) =>
        !path.isAbsolute(p) &&
        !p.split("/").includes("..") &&
        allowed(p, extra),
    )
    .sort();
  if (candidates.length > 5000)
    warnings.push("Scan limited to 5000 files. / 扫描限制为 5000 个文件。");
  const files: FileEntry[] = [];
  const contents = new Map<string, string>();
  let bytes = 0;
  let skipped = 0;
  for (const rel of candidates.slice(0, 5000)) {
    try {
      const full = path.join(base, rel);
      const stat = await fs.lstat(full);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const real = await fs.realpath(full);
      if (!real.startsWith(base + path.sep)) continue;
      // Reject parent-directory symlinks even if they point back into this workspace.
      let cursor = base;
      let symlink = false;
      for (const part of rel.split("/")) {
        cursor = path.join(cursor, part);
        if ((await fs.lstat(cursor)).isSymbolicLink()) {
          symlink = true;
          break;
        }
      }
      if (symlink) continue;
      if (stat.size > 512 * 1024 || bytes + stat.size > 20 * 1024 * 1024) {
        skipped++;
        continue;
      }
      const buffer = await fs.readFile(full);
      const after = await fs.lstat(full);
      if (
        after.mtimeMs !== stat.mtimeMs ||
        after.size !== stat.size ||
        after.ino !== stat.ino
      ) {
        warnings.push(`File changed during scan: ${rel} / 扫描期间文件变化`);
        continue;
      }
      if (buffer.includes(0)) {
        skipped++;
        continue;
      }
      bytes += buffer.length;
      const dir = path.posix.dirname(rel);
      files.push({
        path: rel,
        hash: hash(buffer),
        size: buffer.length,
        language: extensions[path.extname(rel)] || "Text",
        moduleId: "module-" + hash(dir).slice(0, 12),
      });
      contents.set(rel, buffer.toString("utf8"));
    } catch {
      warnings.push(`File changed or unreadable: ${rel} / 文件变化或不可读`);
    }
  }
  if (skipped)
    warnings.push(
      `${skipped} binary or oversized files skipped. / 已跳过 ${skipped} 个二进制或超限文件。`,
    );
  const modules: Module[] = [];
  for (const f of files) {
    let mod = modules.find((m) => m.id === f.moduleId);
    if (!mod) {
      const dir = path.posix.dirname(f.path);
      mod = {
        id: f.moduleId,
        name: dir === "." ? "Root" : dir,
        description:
          "Directory grouping; responsibilities need review. / 按目录分组，职责待确认。",
        kind: "directory",
        files: [],
        evidence: [],
        confidence: "inferred",
      };
      modules.push(mod);
    }
    mod.files.push(f.path);
    mod.evidence.push({ path: f.path });
  }
  const known = new Map(files.map((f) => [f.path, f]));
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const lines = (contents.get(f.path) || "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const specs: string[] = [];
      const line = lines[i];
      if (/^\s*(?:\/\/|#|\*)/.test(line)) continue;
      for (const match of line.matchAll(
        /(?:\bfrom\s*|\bimport\s*(?:\(|)|\brequire\s*\(|#include\s*)["'<]([^"'>]+)["'>]/g,
      ))
        specs.push(match[1]);
      if (f.language === "Python") {
        for (const match of line.matchAll(/\b(?:from|import)\s+([.\w]+)/g))
          specs.push(match[1]);
      }
      if (f.language === "Rust") {
        const match = line.match(/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/);
        if (match) specs.push("./" + match[1]);
      }
      for (const spec of specs) {
        let roots: string[] = [];
        if (spec.startsWith("."))
          roots.push(
            path.posix.normalize(
              path.posix.join(path.posix.dirname(f.path), spec),
            ),
          );
        else if (f.language === "Python")
          roots = [
            spec.replace(/\./g, "/"),
            path.posix.join(
              path.posix.dirname(f.path),
              spec.replace(/\./g, "/"),
            ),
          ];
        else if (f.language === "C" || f.language === "C++")
          roots = [path.posix.join(path.posix.dirname(f.path), spec), spec];
        let target: FileEntry | undefined;
        for (const r of roots) {
          for (const candidate of [
            r,
            ...[".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java"].map(
              (e) => r + e,
            ),
            r + "/index.ts",
            r + "/index.js",
            r + "/__init__.py",
            r + "/mod.rs",
          ]) {
            target = known.get(candidate);
            if (target) break;
          }
          if (target) break;
        }
        if (!target || target.moduleId === f.moduleId) continue;
        const key = `${f.moduleId}:${target.moduleId}`;
        if (seen.has(key)) {
          edges
            .find((e) => e.id === "edge-" + hash(key).slice(0, 12))
            ?.evidence.push({ path: f.path, line: i + 1, note: spec });
          continue;
        }
        seen.add(key);
        edges.push({
          id: "edge-" + hash(key).slice(0, 12),
          from: f.moduleId,
          to: target.moduleId,
          label: "import",
          evidence: [{ path: f.path, line: i + 1, note: spec }],
          confidence: "observed",
        });
      }
    }
  }
  const source = { kind, commit, branch, dirty };
  const id = hash(
    JSON.stringify({ source, files: files.map((f) => [f.path, f.hash]) }),
  );
  return {
    schemaVersion: 1,
    id,
    generatedAt: new Date().toISOString(),
    source,
    files,
    modules,
    edges,
    journeys: [],
    warnings,
    analysis: { status: "pending", inputId: id },
  };
}
