import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { FileEntry } from "./types.ts";
/** Read exactly the indexed file, rejecting links or a version changed since indexing. */
export function readIndexedSource(root: string, entry: FileEntry): string {
  const base = fs.realpathSync(root),
    rel = entry.path;
  if (
    path.isAbsolute(rel) ||
    rel.includes("\\") ||
    rel.split("/").includes("..") ||
    !rel
  )
    throw Error("Invalid indexed path");
  let cursor = base;
  let before: fs.Stats | undefined;
  for (const segment of rel.split("/")) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink())
      throw Error(
        "Indexed source was replaced by a symbolic link; rescan first",
      );
    before = stat;
  }
  if (
    !before?.isFile() ||
    before.size > 512000 ||
    fs.realpathSync(cursor) !== path.resolve(base, rel)
  )
    throw Error("Indexed source unavailable; rescan first");
  const fd = fs.openSync(
    cursor,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  try {
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.ino !== before.ino ||
      stat.dev !== before.dev ||
      stat.size > 512000
    )
      throw Error("Indexed source changed; rescan first");
    const data = fs.readFileSync(fd);
    if (createHash("sha256").update(data).digest("hex") !== entry.hash)
      throw Error("Indexed source content changed; rescan first");
    return data.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
