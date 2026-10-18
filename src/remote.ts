import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { scanWorkspace } from "./scanner.ts";
import type { Config, Snapshot } from "./types.ts";
const run = promisify(execFile);
export function remoteCheckoutPath(root: string, config: Config): string {
  const url = new URL(config.remote.url);
  const key = createHash("sha256")
    .update(url.href + "#" + config.remote.branch)
    .digest("hex")
    .slice(0, 24);
  return path.join(path.resolve(root), ".nativue", "remotes", key);
}
export async function syncRemote(
  root: string,
  config: Config,
  signal?: AbortSignal,
): Promise<Snapshot> {
  if (!config.remote.enabled)
    throw new Error("GitHub synchronization is disabled.");
  let url: URL;
  try {
    url = new URL(config.remote.url);
  } catch {
    throw new Error("Enter an HTTPS GitHub repository URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname) ||
    url.pathname.includes("..")
  )
    throw new Error(
      "Only HTTPS github.com repository URLs without credentials, query, or fragment are allowed.",
    );
  const branch = config.remote.branch;
  if (
    !branch ||
    branch.startsWith("-") ||
    branch.includes("..") ||
    /[\s~^:?*\[\\\x00-\x1f]/.test(branch) ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.includes("@{")
  )
    throw new Error("Invalid branch name.");
  const base = await fs.realpath(root);
  const state = path.join(base, ".nativue");
  await fs.mkdir(state, { recursive: true });
  if ((await fs.lstat(state)).isSymbolicLink())
    throw new Error("State directory must not be a symlink.");
  const remoteRoot = path.join(state, "remotes");
  await fs.mkdir(remoteRoot, { recursive: true });
  if ((await fs.lstat(remoteRoot)).isSymbolicLink())
    throw new Error("Remote cache must not be a symlink.");
  const key = createHash("sha256")
    .update(url.href + "#" + branch)
    .digest("hex")
    .slice(0, 24);
  const dir = remoteCheckoutPath(base, config);
  const lock = path.join(remoteRoot, key + ".lock");
  let lockFile;
  try {
    lockFile = await fs.open(lock, "wx", 0o600);
  } catch {
    throw new Error("Remote synchronization already in progress.");
  }
  // -c options disable hooks, submodules and file transports. Explicit argv avoids shell evaluation.
  const git = async (args: string[]) =>
    run(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.file.allow=never",
        "-c",
        "submodule.recurse=false",
        ...args,
      ],
      {
        signal,
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.startsWith("GIT_"),
            ),
          ),
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_SYSTEM: "/dev/null",
        },
      },
    );
  try {
    try {
      const stat = await fs.lstat(dir);
      if (stat.isSymbolicLink())
        throw new Error("Remote checkout must not be a symlink.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(dir);
      await git(["-C", dir, "init"]);
    }
    await git([
      "-C",
      dir,
      "fetch",
      "--depth=1",
      "--no-tags",
      "--no-recurse-submodules",
      url.href,
      `refs/heads/${branch}`,
    ]);
    await git([
      "-C",
      dir,
      "-c",
      "core.symlinks=true",
      "checkout",
      "--detach",
      "--force",
      "FETCH_HEAD",
    ]);
    const snapshot = await scanWorkspace(dir, "remote", {
      exclude: config.exclude,
    });
    snapshot.source.branch = branch;
    snapshot.id = createHash("sha256")
      .update(
        JSON.stringify({
          source: snapshot.source,
          files: snapshot.files.map((f) => [f.path, f.hash]),
        }),
      )
      .digest("hex");
    snapshot.analysis.inputId = snapshot.id;
    return snapshot;
  } finally {
    await lockFile.close();
    await fs.unlink(lock);
  }
}
