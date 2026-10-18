import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readIndexedSource } from "./source.ts";
import { Runtime } from "./runtime.ts";
import {
  readConfig,
  saveConfig,
  readSnapshot,
  stateDir,
  atomicJson,
} from "./store.ts";
import { readLedger, updateTask } from "./ledger.ts";
import { remoteCheckoutPath } from "./remote.ts";
import { capabilities, handoff } from "./adapters.ts";
const web = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../web",
);
export async function serve(root: string, port = 4317) {
  root = fs.realpathSync(root);
  const metadata = path.join(stateDir(root), "server.json");
  if (fs.existsSync(metadata)) {
    try {
      const old = JSON.parse(fs.readFileSync(metadata, "utf8"));
      const res = await fetch(old.url + "/api/ping", {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) throw Error("Nativue is already running: " + old.url);
    } catch (e) {
      if ((e as Error).message.startsWith("Nativue is already")) throw e;
    }
  }
  const runtime = new Runtime(root);
  await runtime.start();
  const token = crypto.randomBytes(24).toString("hex");
  let url = "";
  const streams = new Set<http.ServerResponse>();
  runtime.listeners.add(() => {
    for (const r of streams) r.write("data: refresh\n\n");
  });
  const json = (res: http.ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (host !== new URL(url).host)
        return json(res, 403, { error: "Invalid host" });
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
      );
      const u = new URL(req.url || "/", url);
      if (req.method === "GET" && u.pathname === "/api/ping")
        return json(res, 200, { name: "Nativue AI" });
      if (req.method === "POST") {
        const origin = req.headers.origin;
        const authorized =
          req.headers.authorization === `Bearer ${token}` ||
          req.headers.cookie
            ?.split(";")
            .some((s) => s.trim() === `nativue=${token}`);
        if (!authorized || (origin && origin !== url))
          return json(res, 403, {
            error: "Open the dashboard locally before making changes",
          });
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 2_000_000) throw Error("Request too large");
        }
        const b = JSON.parse(body || "{}");
        if (u.pathname === "/api/config") {
          if (
            JSON.stringify(b.config.analysis.command) !==
            JSON.stringify(readConfig(root).analysis.command)
          )
            throw Error(
              "Configure executable analysis commands through the local CLI/config file",
            );
          saveConfig(root, b.config);
          runtime.emit();
          return json(res, 200, { saved: true });
        }
        if (u.pathname === "/api/tasks") {
          const ledger = updateTask(root, b.revision, b.actor, b.task);
          runtime.emit();
          return json(res, 200, ledger);
        }
        if (u.pathname === "/api/control") {
          switch (b.action) {
            case "scan":
              await runtime.scan(true);
              break;
            case "pause":
              runtime.state.paused = true;
              runtime.emit();
              break;
            case "resume":
              runtime.state.paused = false;
              await runtime.scan(true);
              break;
            case "remote":
              await runtime.remote(true);
              break;
            case "analyze":
              await runtime.analyze(
                true,
                b.source === "remote" ? "remote" : "local",
              );
              break;
            case "stop":
              json(res, 200, { stopped: true });
              setTimeout(close, 20);
              return;
            default:
              throw Error("Unknown action");
          }
          return json(res, 200, { ok: true });
        }
        return json(res, 404, { error: "Not found" });
      }
      if (req.method !== "GET")
        return json(res, 405, { error: "Method not allowed" });
      if (u.pathname === "/api/state") {
        const config = readConfig(root);
        return json(res, 200, {
          workspaceName: path.basename(root),
          config,
          local: readSnapshot(root),
          remote: readSnapshot(root, "remote"),
          ledger: readLedger(root),
          runtime: runtime.state,
          capabilities: capabilities(config),
        });
      }
      if (u.pathname === "/api/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        streams.add(res);
        req.on("close", () => streams.delete(res));
        return;
      }
      if (u.pathname === "/api/handoff") {
        const role = u.searchParams.get("role") || "A";
        if (!["A", "B", "C"].includes(role)) throw Error("Invalid role");
        const task = readLedger(root).tasks.find(
          (t) => t.id === u.searchParams.get("id"),
        );
        return json(res, 200, {
          text: handoff(task, role as "A" | "B" | "C", readConfig(root)),
        });
      }
      if (u.pathname === "/api/file") {
        const kind =
            u.searchParams.get("source") === "remote" ? "remote" : "local",
          rel = u.searchParams.get("path") || "";
        const entry = readSnapshot(root, kind)?.files.find(
          (f) => f.path === rel,
        );
        if (!entry)
          return json(res, 404, { error: "File is not in the current index" });
        const base =
          kind === "local" ? root : remoteCheckoutPath(root, readConfig(root));
        return json(res, 200, {
          path: rel,
          content: readIndexedSource(base, entry),
        });
      }
      const assets: Record<string, string> = {
        "/": "index.html",
        "/index.html": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
      };
      const asset = assets[u.pathname];
      if (!asset) return json(res, 404, { error: "Not found" });
      if (u.pathname === "/" || u.pathname === "/index.html")
        res.setHeader(
          "Set-Cookie",
          `nativue=${token}; HttpOnly; SameSite=Strict; Path=/`,
        );
      res.setHeader(
        "Content-Type",
        asset.endsWith(".html")
          ? "text/html; charset=utf-8"
          : asset.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/javascript; charset=utf-8",
      );
      res.end(fs.readFileSync(path.join(web, asset)));
    } catch (e) {
      json(res, 400, { error: (e as Error).message });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  atomicJson(metadata, { url, token, pid: process.pid });
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    streams.forEach((r) => r.end());
    server.close();
    await runtime.close();
    try {
      if (JSON.parse(fs.readFileSync(metadata, "utf8")).token === token)
        fs.unlinkSync(metadata);
    } catch {}
  }
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  return { server, runtime, url, token, close };
}
