import { chromium, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Runtime } from "../src/runtime.ts";
import { importAnalysis } from "../src/analysis.ts";
import {
  atomicJson,
  defaultConfig,
  readSnapshot,
  saveConfig,
  saveSnapshot,
} from "../src/store.ts";
import { serve } from "../src/server.ts";
import type { Edge, Journey, Module, Task } from "../src/types.ts";

type Locale = "en" | "zh";
type Copy = [en: string, zh: string];
const t = (locale: Locale, copy: Copy) => copy[locale === "zh" ? 1 : 0];
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(repo, "assets");
const fixedAt = "2026-10-18T22:00:00.000Z";
const shas = {
  auth: "1111111111111111111111111111111111111111",
  drafts: "2222222222222222222222222222222222222222",
  search: "3333333333333333333333333333333333333333",
  release: "4444444444444444444444444444444444444444",
  integration: "5555555555555555555555555555555555555555",
  remote: "6c8f429d71b3f0c581e5d8ac96b04e3a77d5132a",
};

const files: Record<string, string> = {
  "apps/web/src/app-shell.tsx": "import {Dashboard} from './workspace/dashboard.tsx';\nexport const AppShell=Dashboard;\n",
  "apps/web/src/workspace/dashboard.tsx": "import {openDocument} from '../editor/document-editor.tsx';\nexport const Dashboard={openDocument};\n",
  "apps/web/src/editor/document-editor.tsx": "import type {DocumentDraft} from '../../../../packages/contracts/src/documents.ts';\nexport function saveDraft(value:DocumentDraft){return value;}\n",
  "apps/web/src/editor/draft-store.ts": "export const draftKey=(id:string)=>`draft:${id}`;\n",
  "apps/web/src/search/command-palette.tsx": "export const searchCommand=(query:string)=>({query});\n",
  "apps/web/src/search/result-list.tsx": "export const renderResult=(title:string)=>title;\n",
  "services/gateway/src/routes.ts": "export const routes=['/auth','/workspaces','/documents','/search'];\n",
  "services/identity/src/session.ts": "export function requireSession(token:string){return Boolean(token);}\n",
  "services/identity/src/permissions.ts": "export const canEdit=(role:string)=>role!=='viewer';\n",
  "services/workspaces/src/workspace-service.ts": "export function loadWorkspace(id:string){return {id};}\n",
  "services/workspaces/src/members.ts": "export function inviteMember(email:string){return {email,status:'invited'};}\n",
  "services/documents/src/document-service.ts": "import type {DocumentDraft} from '../../../packages/contracts/src/documents.ts';\nexport function publishDocument(draft:DocumentDraft){return {...draft,status:'published'};}\n",
  "services/documents/src/document-repository.ts": "export const documentTable='documents';\n",
  "services/documents/src/attachment-policy.ts": "export const maxAttachmentBytes=25_000_000;\n",
  "services/search/src/search-service.ts": "export function searchWorkspace(query:string){return {query,filters:['workspace']};}\n",
  "services/search/src/index-writer.ts": "export function indexDocument(id:string){return {id,indexed:true};}\n",
  "workers/jobs/src/queue.ts": "export const enqueue=(name:string,payload:unknown)=>({name,payload});\n",
  "workers/jobs/src/process-document.ts": "export const processDocument=(id:string)=>({id,processed:true});\n",
  "services/notifications/src/notification-service.ts": "export const notifyMention=(userId:string)=>({userId,channel:'in-app'});\n",
  "services/notifications/src/templates/mention.ts": "export const mentionTemplate='You were mentioned';\n",
  "packages/contracts/src/documents.ts": "export interface DocumentDraft{id:string;title:string;body:string;status?:string}\n",
  "packages/contracts/src/events.ts": "export interface DomainEvent{type:string;workspaceId:string}\n",
  "infrastructure/database/schema.sql": "create table documents(id text primary key, title text, body text);\ncreate table workspaces(id text primary key, name text);\n",
  "infrastructure/cache/redis.ts": "export const cacheKey=(workspaceId:string)=>`workspace:${workspaceId}`;\n",
  "infrastructure/storage/object-store.ts": "export const objectPath=(workspaceId:string,file:string)=>`${workspaceId}/${file}`;\n",
  "infrastructure/observability/audit-log.ts": "export const audit=(action:string)=>({action,at:new Date().toISOString()});\n",
};

function modules(locale: Locale): Module[] {
  const module = (
    id: string,
    name: Copy,
    description: Copy,
    kind: string,
    paths: string[],
    confidence: Module["confidence"] = "observed",
  ): Module => ({
    id,
    name: t(locale, name),
    description: t(locale, description),
    kind,
    files: paths,
    evidence: [{ path: paths[0], line: 1, note: t(locale, ["Primary entry", "主要入口"]) }],
    confidence,
  });
  return [
    module("app-shell", ["App shell", "应用外壳"], ["Loads the signed-in workspace experience.", "加载登录后的工作区体验。"], "frontend", ["apps/web/src/app-shell.tsx"]),
    module("workspace-dashboard", ["Workspace dashboard", "工作区首页"], ["Shows spaces, recent documents and team activity.", "展示空间、最近文档和团队动态。"], "frontend", ["apps/web/src/workspace/dashboard.tsx"]),
    module("document-editor", ["Document editor", "文档编辑器"], ["Edits content and keeps recoverable local drafts.", "编辑内容并保留可恢复的本地草稿。"], "frontend", ["apps/web/src/editor/document-editor.tsx", "apps/web/src/editor/draft-store.ts"]),
    module("search-ui", ["Search & commands", "搜索与命令"], ["Finds workspace content and opens quick actions.", "查找工作区内容并打开快捷操作。"], "frontend", ["apps/web/src/search/command-palette.tsx", "apps/web/src/search/result-list.tsx"]),
    module("api-gateway", ["API gateway", "API 网关"], ["Routes browser requests to the owning service.", "把浏览器请求路由到对应服务。"], "backend", ["services/gateway/src/routes.ts"]),
    module("identity", ["Identity & access", "身份与权限"], ["Checks sessions and workspace permissions.", "检查会话与工作区权限。"], "backend", ["services/identity/src/session.ts", "services/identity/src/permissions.ts"]),
    module("workspace-service", ["Workspace service", "工作区服务"], ["Loads workspace settings and member access.", "读取工作区设置与成员权限。"], "backend", ["services/workspaces/src/workspace-service.ts", "services/workspaces/src/members.ts"]),
    module("document-service", ["Document service", "文档服务"], ["Publishes documents and applies attachment rules.", "发布文档并应用附件规则。"], "backend", ["services/documents/src/document-service.ts", "services/documents/src/document-repository.ts", "services/documents/src/attachment-policy.ts"]),
    module("search-service", ["Search service", "搜索服务"], ["Queries and refreshes the workspace search index.", "查询并更新工作区搜索索引。"], "backend", ["services/search/src/search-service.ts", "services/search/src/index-writer.ts"]),
    module("job-worker", ["Background jobs", "后台任务"], ["Processes indexing and file work outside requests.", "在请求之外处理索引和文件任务。"], "application", ["workers/jobs/src/queue.ts", "workers/jobs/src/process-document.ts"]),
    module("notifications", ["Notification service", "通知服务"], ["Delivers mention and collaboration notifications.", "发送提及与协作通知。"], "application", ["services/notifications/src/notification-service.ts", "services/notifications/src/templates/mention.ts"]),
    module("shared-contracts", ["Shared contracts", "共享契约"], ["Defines document and event shapes shared by services.", "定义服务共享的文档与事件结构。"], "application", ["packages/contracts/src/documents.ts", "packages/contracts/src/events.ts"]),
    module("postgres", ["PostgreSQL", "PostgreSQL 数据库"], ["Stores workspaces, members and document records.", "保存工作区、成员与文档记录。"], "infrastructure", ["infrastructure/database/schema.sql"], "inferred"),
    module("redis", ["Redis cache", "Redis 缓存"], ["Caches workspace reads and short-lived coordination state.", "缓存工作区读取与短期协调状态。"], "infrastructure", ["infrastructure/cache/redis.ts"], "inferred"),
    module("object-storage", ["Object storage", "对象存储"], ["Stores uploaded attachments outside the database.", "在数据库之外保存上传附件。"], "infrastructure", ["infrastructure/storage/object-store.ts", "infrastructure/observability/audit-log.ts"], "inferred"),
  ];
}

function edges(locale: Locale): Edge[] {
  const edge = (id: string, from: string, to: string, label: Copy, evidence: string, confidence: Edge["confidence"] = "observed"): Edge => ({
    id, from, to, label: t(locale, label), evidence: [{ path: evidence, line: 1 }], confidence,
  });
  return [
    edge("shell-dashboard", "app-shell", "workspace-dashboard", ["opens workspace", "打开工作区"], "apps/web/src/app-shell.tsx"),
    edge("dashboard-editor", "workspace-dashboard", "document-editor", ["opens document", "打开文档"], "apps/web/src/workspace/dashboard.tsx"),
    edge("editor-contracts", "document-editor", "shared-contracts", ["uses draft contract", "使用草稿契约"], "apps/web/src/editor/document-editor.tsx"),
    edge("editor-gateway", "document-editor", "api-gateway", ["save / publish", "保存 / 发布"], "apps/web/src/editor/document-editor.tsx", "inferred"),
    edge("search-gateway", "search-ui", "api-gateway", ["search query", "搜索请求"], "apps/web/src/search/command-palette.tsx", "inferred"),
    edge("gateway-identity", "api-gateway", "identity", ["session check", "会话检查"], "services/gateway/src/routes.ts"),
    edge("gateway-workspaces", "api-gateway", "workspace-service", ["workspace routes", "工作区路由"], "services/gateway/src/routes.ts"),
    edge("gateway-documents", "api-gateway", "document-service", ["document routes", "文档路由"], "services/gateway/src/routes.ts"),
    edge("gateway-search", "api-gateway", "search-service", ["search routes", "搜索路由"], "services/gateway/src/routes.ts"),
    edge("workspaces-db", "workspace-service", "postgres", ["member records", "成员记录"], "services/workspaces/src/workspace-service.ts", "inferred"),
    edge("workspaces-cache", "workspace-service", "redis", ["workspace cache", "工作区缓存"], "infrastructure/cache/redis.ts", "inferred"),
    edge("documents-db", "document-service", "postgres", ["document records", "文档记录"], "services/documents/src/document-repository.ts", "inferred"),
    edge("documents-storage", "document-service", "object-storage", ["attachments", "附件"], "services/documents/src/attachment-policy.ts", "inferred"),
    edge("documents-jobs", "document-service", "job-worker", ["index request", "索引任务"], "workers/jobs/src/queue.ts", "inferred"),
    edge("jobs-search", "job-worker", "search-service", ["refresh index", "刷新索引"], "workers/jobs/src/process-document.ts", "inferred"),
    edge("search-cache", "search-service", "redis", ["result cache", "结果缓存"], "services/search/src/search-service.ts", "inferred"),
    edge("documents-notifications", "document-service", "notifications", ["mention event", "提及事件"], "packages/contracts/src/events.ts", "inferred"),
    edge("notifications-contracts", "notifications", "shared-contracts", ["event contract", "事件契约"], "packages/contracts/src/events.ts"),
  ];
}

function journeys(locale: Locale): Journey[] {
  const step = (moduleId: string, label: Copy, source: string) => ({
    moduleId,
    label: t(locale, label),
    evidence: [{ path: source, line: 1 }],
  });
  return [
    {
      id: "publish-document",
      name: t(locale, ["Create and publish a document", "创建并发布文档"]),
      description: t(locale, ["From opening a workspace to searchable published content.", "从进入工作区到文档发布并可被搜索。"]),
      confidence: "inferred",
      steps: [
        step("app-shell", ["Open the signed-in app", "打开已登录应用"], "apps/web/src/app-shell.tsx"),
        step("identity", ["Check session and permissions", "检查会话与权限"], "services/identity/src/session.ts"),
        step("workspace-dashboard", ["Choose a workspace and document", "选择工作区与文档"], "apps/web/src/workspace/dashboard.tsx"),
        step("document-editor", ["Write with a recoverable draft", "编辑并保留可恢复草稿"], "apps/web/src/editor/document-editor.tsx"),
        step("api-gateway", ["Send the publish request", "发送发布请求"], "services/gateway/src/routes.ts"),
        step("document-service", ["Validate and publish content", "校验并发布内容"], "services/documents/src/document-service.ts"),
        step("postgres", ["Persist the document record", "保存文档记录"], "infrastructure/database/schema.sql"),
        step("job-worker", ["Queue search indexing", "排队更新搜索索引"], "workers/jobs/src/queue.ts"),
        step("search-service", ["Make the document searchable", "让文档可以被搜索"], "services/search/src/index-writer.ts"),
      ],
    },
    {
      id: "invite-member",
      name: t(locale, ["Invite a teammate", "邀请团队成员"]),
      description: t(locale, ["Grant workspace access and notify the invitee.", "授予工作区权限并通知受邀成员。"]),
      confidence: "inferred",
      steps: [
        step("workspace-dashboard", ["Open member settings", "打开成员设置"], "apps/web/src/workspace/dashboard.tsx"),
        step("api-gateway", ["Submit the invitation", "提交邀请"], "services/gateway/src/routes.ts"),
        step("identity", ["Confirm inviter permission", "确认邀请人权限"], "services/identity/src/permissions.ts"),
        step("workspace-service", ["Create pending membership", "创建待接受成员关系"], "services/workspaces/src/members.ts"),
        step("notifications", ["Deliver the invitation", "发送邀请通知"], "services/notifications/src/notification-service.ts"),
      ],
    },
    {
      id: "upload-attachment",
      name: t(locale, ["Upload a document attachment", "上传文档附件"]),
      description: t(locale, ["Validate, store and process an uploaded file.", "校验、保存并处理上传文件。"]),
      confidence: "inferred",
      steps: [
        step("document-editor", ["Choose a file", "选择文件"], "apps/web/src/editor/document-editor.tsx"),
        step("api-gateway", ["Send upload metadata", "发送上传信息"], "services/gateway/src/routes.ts"),
        step("document-service", ["Apply attachment policy", "应用附件规则"], "services/documents/src/attachment-policy.ts"),
        step("object-storage", ["Store the file object", "保存文件对象"], "infrastructure/storage/object-store.ts"),
        step("job-worker", ["Process the new attachment", "处理新附件"], "workers/jobs/src/process-document.ts"),
      ],
    },
  ];
}

function tasks(locale: Locale): Task[] {
  const now = fixedAt;
  const base = (id: string, title: Copy, description: Copy, priority: Task["priority"], status: Task["status"], dependsOn: string[], taskFiles: string[]): Task => ({
    id,
    title: t(locale, title),
    description: t(locale, description),
    priority,
    status,
    criteria: [t(locale, ["The requested behavior is covered by focused checks.", "通过针对性检查覆盖约定行为。"]), t(locale, ["No unrelated workspace behavior regresses.", "工作区其他行为不回退。"])],
    dependsOn,
    files: taskFiles,
    reviews: [],
    updatedAt: now,
  });
  const auth = base("ORB-101", ["Harden workspace sign-in", "加固工作区登录"], ["Handle expired sessions without losing the intended destination.", "会话过期时保留原目标页面并安全重新登录。"], "P0", "passed", [], ["services/identity/src/session.ts"]);
  Object.assign(auth, { owner: "A-1", developer: "B-1", reviewer: "C-1", branch: "task/auth-session", baseCommit: shas.remote, commit: shas.auth, reviews: [{ reviewer: "C-1", commit: shas.auth, report: t(locale, ["Expired and valid session paths passed.", "有效与过期会话路径均通过。"]), passed: true, untested: [], at: now }] });
  const drafts = base("ORB-102", ["Keep unsaved document drafts", "保留未保存文档草稿"], ["Recover local edits after a failed publish or accidental refresh.", "发布失败或意外刷新后可以恢复本地编辑。"], "P0", "review", [], ["apps/web/src/editor/document-editor.tsx", "apps/web/src/editor/draft-store.ts"]);
  Object.assign(drafts, { owner: "A-1", developer: "B-2", reviewer: "C-2", branch: "task/draft-recovery", baseCommit: shas.remote, commit: shas.drafts });
  const uploads = base("ORB-103", ["Support large attachment uploads", "支持大附件上传"], ["Upload large files with visible progress and safe retry.", "大文件上传显示进度，并可安全重试。"], "P1", "rework", [], ["services/documents/src/attachment-policy.ts", "infrastructure/storage/object-store.ts"]);
  Object.assign(uploads, { owner: "A-1", developer: "B-3", reviewer: "C-3", branch: "task/large-uploads", baseCommit: shas.remote, reviews: [{ reviewer: "C-3", commit: "9999999999999999999999999999999999999999", report: t(locale, ["Retry duplicates one object; return to B.", "重试会生成重复对象，退回 B。"]), passed: false, untested: [], at: now }], blocked: t(locale, ["Retry idempotency needs rework", "重试幂等性需要返工"]) });
  const search = base("ORB-104", ["Improve search ranking", "改进搜索排序"], ["Rank exact titles and recent workspace documents first.", "优先显示标题精确匹配和最近文档。"], "P1", "passed", ["ORB-101"], ["services/search/src/search-service.ts"]);
  Object.assign(search, { owner: "A-1", developer: "B-4", reviewer: "C-4", branch: "task/search-ranking", baseCommit: shas.auth, commit: shas.search, reviews: [{ reviewer: "C-4", commit: shas.search, report: t(locale, ["Ranking fixtures and workspace filtering passed.", "排序样例与工作区过滤均通过。"]), passed: true, untested: [], at: now }] });
  const mentions = base("ORB-105", ["Send mention notifications", "发送提及通知"], ["Notify mentioned members after a document is published.", "文档发布后通知被提及成员。"], "P1", "developing", ["ORB-102"], ["services/notifications/src/notification-service.ts"]);
  Object.assign(mentions, { owner: "A-1", developer: "B-5", reviewer: "C-5", branch: "task/mention-notifications", baseCommit: shas.drafts });
  const audit = base("ORB-106", ["Add a workspace audit trail", "增加工作区审计记录"], ["Record high-impact member and document actions.", "记录高影响的成员与文档操作。"], "P2", "todo", ["ORB-101"], ["infrastructure/observability/audit-log.ts"]);
  const integration = base("ORB-107", ["Integrate collaboration release", "集成协作功能版本"], ["Combine accepted editor, search and notification work.", "组合已验收的编辑、搜索与通知改动。"], "P0", "integration-review", ["ORB-104", "ORB-105"], ["apps/web/src/app-shell.tsx"]);
  Object.assign(integration, { owner: "A-1", developer: "B-6", integrator: "B-I", reviewer: "C-I", branch: "integration/collaboration", baseCommit: shas.remote, commit: shas.release, integrationCommit: shas.integration, reviews: [{ reviewer: "C-6", commit: shas.release, report: t(locale, ["Individual release scope passed.", "单项发布范围已通过。"]), passed: true, untested: [], at: now }] });
  const handtest = base("ORB-108", ["Owner handtest for the release", "用户手测发布版本"], ["Walk through the combined publish and search experience.", "走查组合后的发布与搜索体验。"], "P0", "todo", ["ORB-107"], []);
  const docs = base("ORB-109", ["Document recovery behavior", "记录恢复行为"], ["Explain draft recovery and upload retry to workspace owners.", "向工作区负责人说明草稿恢复与上传重试。"], "P2", "todo", ["ORB-102", "ORB-103"], ["apps/web/src/editor/draft-store.ts"]);
  return [auth, drafts, uploads, search, mentions, audit, integration, handtest, docs];
}

async function createFixture(locale: Locale) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `nativue-orbit-${locale}-`));
  const root = path.join(temp, "orbit-desk");
  fs.mkdirSync(root);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  fs.writeFileSync(path.join(root, "README.md"), "# Orbit Desk\n\nFictional Nativue documentation fixture.\n");
  fs.writeFileSync(path.join(root, ".gitignore"), ".nativue/\n");
  execFileSync("git", ["init", "-b", "main"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=SienGe AI Lab", "-c", "user.email=opensource@example.invalid", "commit", "-m", "fixture: create Orbit Desk"], {
    cwd: root,
    stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_DATE: fixedAt, GIT_COMMITTER_DATE: fixedAt },
  });
  const config = defaultConfig();
  config.language = locale;
  config.analysis.enabled = false;
  config.remote = { enabled: true, url: "https://github.com/example/orbit-desk.git", branch: "release/preview", intervalMs: 86_400_000 };
  config.refresh = { debounceMs: 60_000, reconcileMs: 60_000 };
  saveConfig(root, config);
  await new Runtime(root).scan(true);
  const scanned = readSnapshot(root)!;
  await importAnalysis(root, { schemaVersion: 1, inputId: scanned.id, modules: modules(locale), edges: edges(locale), journeys: journeys(locale) });
  const local = readSnapshot(root)!;
  saveSnapshot(root, {
    ...structuredClone(local),
    id: "orbit-remote-release-preview",
    generatedAt: fixedAt,
    source: { kind: "remote", commit: shas.remote, branch: "release/preview", dirty: false },
    analysis: { status: "complete", inputId: "orbit-remote-release-preview", updatedAt: fixedAt },
  });
  atomicJson(path.join(root, ".nativue", "ledger.json"), {
    schemaVersion: 1,
    revision: 27,
    tasks: tasks(locale),
    events: [],
  });
  return { root, temp };
}

async function settle(page: Page) {
  await page.waitForTimeout(250);
  await page.evaluate(() => document.fonts.ready);
}

async function capture(locale: Locale) {
  const { root, temp } = await createFixture(locale);
  const instance = await serve(root, 0);
  instance.runtime.remoteNextAttempt = Date.now() + 86_400_000;
  const browser = await chromium.launch({ channel: process.env.CI ? undefined : "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1125 }, deviceScaleFactor: 1 });
  await page.addInitScript((language) => {
    localStorage.setItem("nativue-language", language);
    localStorage.setItem("nativue-side-width", "500");
  }, locale);
  const cleanPage = async () => {
    await page.goto(instance.url);
    await page.locator("#dev-map-open").waitFor();
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  };
  try {
    await cleanPage();
    await page.locator("#fit").click();
    await settle(page);
    await page.screenshot({ path: path.join(assets, `demo-architecture.${locale}.png`) });

    await cleanPage();
    await page.locator("#tab-journeys").click();
    await page.locator("#journey-all").click();
    await page.locator("#fit").click();
    await settle(page);
    await page.screenshot({ path: path.join(assets, `demo-journey.${locale}.png`) });

    await cleanPage();
    await page.locator("#dev-board-open").click();
    await page.locator("[data-parallel-card='ORB-107']").waitFor();
    await page.locator("#parallel-fit").click();
    await settle(page);
    await page.screenshot({ path: path.join(assets, `demo-parallel.${locale}.png`) });

    await cleanPage();
    await page.locator("[data-node='document-service']").click();
    await page.locator("#show-selected-files").click();
    await page.locator("[data-tree-file='services/documents/src/document-service.ts']").waitFor();
    await settle(page);
    await page.screenshot({ path: path.join(assets, `demo-file-location.${locale}.png`) });

    await cleanPage();
    await page.locator("#version-picker").selectOption("remote");
    const versionDetails = page.locator("details.learning-section").last();
    await versionDetails.locator("summary").click();
    await versionDetails.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.locator("#fit").click();
    await settle(page);
    await page.screenshot({ path: path.join(assets, `demo-version.${locale}.png`) });
  } finally {
    await browser.close();
    await instance.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

fs.mkdirSync(assets, { recursive: true });
await capture("zh");
await capture("en");
console.log("Generated bilingual README screenshots for the fictional Orbit Desk fixture.");
