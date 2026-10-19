import type {
  DashboardState,
  Snapshot,
  Module,
  Task,
  Config,
  Journey,
} from "../src/types.ts";
const app = document.querySelector<HTMLDivElement>("#app")!;
const esc = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let data: DashboardState | null = null,
  lang = (localStorage.getItem("nativue-language") || "") as "en" | "zh";
let source: "local" | "remote" = "local",
  tab: "updates" | "journeys" | "folders" = "updates",
  viewMode: "map" | "parallel" = "map";
let selectedModule = "",
  selectedTask = "",
  selectedJourney = "",
  journeyStep = -1,
  selectedFile = "",
  search = "",
  related: string[] = [],
  relatedOnly = false;
let modal = "",
  modalCleanup: (() => void) | undefined,
  busy = false,
  error = "",
  toastTimer: ReturnType<typeof setTimeout>,
  abortFile: AbortController | undefined;
let initialFit = false,
  boardFitted = false,
  sideWidth = Number(localStorage.getItem("nativue-side-width") || 420);
const text = (en: string, zh: string) => (lang === "zh" ? zh : en);
const collapsed = new Set<string>(),
  opened = new Set<string>(),
  nodePositions = new Map<string, { x: number; y: number }>(),
  groupPositions = new Map<string, { x: number; y: number }>();
let view = { x: 0, y: 0, scale: 1 },
  boardView = { x: 0, y: 0, scale: 1 },
  stageSize = { width: 900, height: 700 };
const labels: Record<string, [string, string]> = {
  todo: ["Ready", "待开发"],
  developing: ["Developing", "开发中"],
  review: ["C review", "C 独立验收"],
  rework: ["Rework", "返工"],
  passed: ["C passed", "单项验收通过"],
  integrated: ["Integrated", "已集成"],
  "integration-review": ["Integration review", "集成验收"],
  "integration-passed": ["Integration passed", "集成验收通过"],
  handtest: ["Your handtest", "待手测"],
  done: ["Accepted", "用户已确认"],
};
const statusLabel = (s: string) => (labels[s] ? text(...labels[s]) : s);
const snapshot = (): Snapshot | null =>
  data ? (source === "remote" ? data.remote : data.local) : null;
const moduleById = (id: string) => snapshot()?.modules.find((m) => m.id === id);
const formatDate = (v?: string) =>
  v
    ? new Date(v).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : text("Never", "尚未");
const short = (v?: string | null) => (v ? v.slice(0, 9) : "—");
const confidence = (v: string) =>
  v === "verified"
    ? text("Verified", "已验证")
    : v === "inferred"
      ? text("Inferred", "推断")
      : text("Observed", "已观察");
function toast(message: string) {
  document.querySelector(".toast")?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.textContent = message;
  document.body.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 5500);
}
async function api(path: string, body?: unknown) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok)
    throw new Error(value.error || value.message || `HTTP ${r.status}`);
  return value;
}
async function refresh() {
  try {
    data = (await api("/api/state")) as DashboardState;
    if (!lang) {
      lang = data.config.language;
      localStorage.setItem("nativue-language", lang);
    }
    const s = snapshot();
    if (selectedFile && !s?.files.some((f) => f.path === selectedFile))
      selectedFile = "";
    related = related.filter((p) => s?.files.some((f) => f.path === p));
    error = "";
    render();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    if (data) render();
    else {
      app.innerHTML = `<p class="boot">Nativue AI · ${esc(error)} <button id="retry">${text("Retry", "重试")}</button></p>`;
      document
        .querySelector("#retry")
        ?.addEventListener("click", () => void refresh());
    }
  }
}
async function control(action: string) {
  if (busy) return;
  busy = true;
  render();
  try {
    await api("/api/control", { action, source });
    await refresh();
    toast(
      text(
        "Request received. Check the update status.",
        "请求已接收，请查看更新状态。",
      ),
    );
  } catch (e) {
    toast(String(e));
  } finally {
    busy = false;
    render();
  }
}
function workspaceTitle() {
  return (
    (data as DashboardState & { workspaceName?: string })?.workspaceName ||
    text("Workspace", "工作区")
  );
}
function runtimeLabel() {
  const r = data!.runtime,
    s = snapshot();
  return error || r.error
    ? text("Needs attention", "需要关注")
    : r.paused
      ? text("Updates paused", "更新已暂停")
      : r.analyzing
        ? text("Analyzing changes", "正在分析变化")
        : s?.analysis.status === "complete"
          ? text("Up to date", "已更新")
          : text("Analysis queued", "等待分析");
}
interface Group {
  id: string;
  title: string;
  modules: Module[];
  color: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}
const palettes = [
  ["#edf3fa", "#e0eaf6", "#b6cbe0"],
  ["#eef5ef", "#e0ece2", "#bfd3c2"],
  ["#f6f1e8", "#eee5d5", "#d7c9ad"],
  ["#f1eef7", "#e7e1f0", "#ccc0df"],
  ["#eaf4f4", "#dbecec", "#b7d2d2"],
];
function groupTitle(kind: string) {
  const titles: Record<string, [string, string]> = {
    frontend: ["Frontend", "前端"],
    backend: ["Backend", "后端"],
    shared: ["Shared contracts", "共享契约"],
    source: ["Source modules", "源码模块"],
    documentation: ["Documentation", "文档"],
    test: ["Tests", "测试"],
    config: ["Configuration", "配置"],
    package: ["Packages", "软件包"],
    application: ["Applications", "应用"],
    infrastructure: ["Infrastructure", "基础设施"],
  };
  return titles[kind] ? text(...titles[kind]) : kind || text("Modules", "模块");
}
function groups(): Group[] {
  const map = new Map<string, Module[]>();
  for (const m of snapshot()?.modules || []) {
    const k = m.kind || "source";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(m);
  }
  return [...map].map(([id, modules], i) => {
    const p = groupPositions.get(id) || { x: 60 + i * 420, y: 70 };
    return {
      id,
      title: groupTitle(id),
      modules,
      color: palettes[i % palettes.length],
      ...p,
      width: 368,
      height: collapsed.has(id)
        ? 108
        : Math.max(285, 130 + modules.length * 164),
    };
  });
}
function nodePos(m: Module, g?: Group) {
  g = g || groups().find((gr) => gr.modules.some((n) => n.id === m.id));
  const i = g?.modules.findIndex((n) => n.id === m.id) || 0;
  return (
    nodePositions.get(m.id) || {
      x: (g?.x || 0) + 25 + (m.x || 0),
      y: (g?.y || 0) + 115 + i * 164 + (m.y || 0),
    }
  );
}
function activeModules() {
  if (selectedTask) {
    const task = data?.ledger.tasks.find((t) => t.id === selectedTask);
    return new Set(
      snapshot()
        ?.modules.filter((m) => m.files.some((f) => task?.files.includes(f)))
        .map((m) => m.id) || [],
    );
  }
  if (tab === "journeys") {
    const j = currentJourney();
    return new Set(
      journeyStep >= 0 && j?.steps[journeyStep]
        ? [j.steps[journeyStep].moduleId]
        : j?.steps.map((st) => st.moduleId) || [],
    );
  }
  return new Set(selectedModule ? [selectedModule] : []);
}
function render() {
  if (!data) return;
  const savedScroll = document.querySelector(".sidebar-scroll")?.scrollTop,
    inspectorScroll = document.querySelector(".parallel-inspector")?.scrollTop;
  const active = document.activeElement as HTMLInputElement | null;
  const focusSearch = active?.id === "file-search",
    caret = focusSearch ? active.selectionStart : null;
  const s = snapshot(),
    r = data.runtime;
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = `Nativue AI · ${workspaceTitle()}`;
  app.innerHTML = `<main class="workspace" style="--side-width:${sideWidth}px"><section class="canvas-shell" aria-label="${text("Development canvas", "开发画布")}">${viewMode === "map" ? renderMap() : renderParallel()}</section><aside class="sidebar" aria-label="${text("Details and navigation", "说明与导航")}"><div id="resize-handle" class="resize-handle" role="separator" aria-orientation="vertical" aria-label="${text("Resize sidebar", "调整右侧宽度")}" aria-valuemin="320" aria-valuemax="720" aria-valuenow="${sideWidth}" tabindex="0"></div><header class="side-header"><h1 title="${esc(workspaceTitle())}">${text("Code & runtime map", "代码与运行地图")}</h1><select id="version-picker" aria-label="${text("View version", "查看版本")}"><option value="local" ${source === "local" ? "selected" : ""}>${text("Current workspace", "当前工作区")}</option><option value="remote" ${source === "remote" ? "selected" : ""} ${!data.config.remote.enabled ? "disabled" : ""}>${text("Remote branch", "远端分支")}${data.config.remote.branch ? " · " + esc(data.config.remote.branch) : ""}</option></select></header><div class="parallel-view-switch" role="group" aria-label="${text("Canvas view", "画布视图")}"><button id="dev-board-open" aria-pressed="${viewMode === "parallel"}">${text("Parallel development", "并行开发")}</button><button id="dev-map-open" aria-pressed="${viewMode === "map"}">${text("Code map", "代码地图")}</button></div><div class="sidebar-tools"><span class="tool-status ${error || r.error ? "error" : ""}" title="${esc(runtimeLabel())}">${esc(runtimeLabel())}</span><button id="refresh-button" title="${text("Update source index", "更新源码索引")}" ${busy ? "disabled" : ""}>↻</button><button id="role-button">A/B/C</button><button id="settings-button">${text("Settings", "设置")}</button><button id="language-button" aria-label="${text("Switch to Chinese", "切换到英文")}">${lang === "zh" ? "EN" : "中文"}</button></div>${viewMode === "parallel" ? `<section class="parallel-inspector" aria-live="polite">${selectedTask ? renderTaskDetail(data.ledger.tasks.find((t) => t.id === selectedTask)) : `<h2>${text("Parallel development", "并行开发")}</h2><p class="empty-text">${text("Tasks are grouped by dependency depth, not by status. Click a card for scope, ownership, commits and independent review evidence.", "任务按依赖层级分组，不按状态分列。点击卡片查看范围、认领、提交和独立验收证据。")}</p><button class="primary" id="new-task">＋ ${text("New task", "新建任务")}</button>${renderTaskDetail(undefined)}`}</section>` : `<nav class="tabs" role="tablist" aria-label="${text("Architecture navigation", "架构辅助导航")}">${(["updates", "journeys", "folders"] as const).map((k, i) => `<button id="tab-${k}" role="tab" aria-selected="${tab === k}" tabindex="${tab === k ? 0 : -1}" data-tab="${k}">${[text("Updates", "本次更新"), text("Journeys", "操作旅程"), text("Folders", "文件夹")][i]}</button>`).join("")}</nav>${tab === "journeys" ? renderJourneyNav() : ""}<div class="sidebar-scroll">${renderNotice()}<section id="panel-${tab}" role="tabpanel" aria-labelledby="tab-${tab}">${tab === "updates" ? renderUpdates() : tab === "journeys" ? renderJourneys() : renderFiles()}</section>${tab !== "folders" ? `<section id="selection" class="selection" aria-live="polite">${selectedTask ? renderTaskDetail(data.ledger.tasks.find((t) => t.id === selectedTask)) : selectedModule ? renderModuleDetail(moduleById(selectedModule)) : renderSelectionEmpty()}</section>` : ""}<details class="legend"><summary>${text("Colors, connections & evidence", "颜色、连线和验证边界")}</summary><p class="fine">${text("Group colors show module categories. Solid connections have observed or verified source evidence; dotted ones are inferred. Source analysis is not runtime acceptance.", "大模块底色区分类别。实线表示有观察或核对依据的源码关系，点线表示推断。源码分析不等于运行验收。")}</p><p class="fine">${text("Drag cards or group titles. Drag blank space to pan; scroll to zoom. Arrow keys move, +/- zoom, 0 fits the map.", "拖动卡片或组标题；拖动空白平移，滚轮缩放。方向键移动，加减键缩放，0 回到全图。")}</p></details><details class="learning-section"><summary>${text("Version & usage notes", "版本与使用说明")}</summary>${renderVersion()}<p class="fine">${text("Workspace", "工作区")}: ${esc(workspaceTitle())}<br>${text("AI calls today", "今日 AI 调用")}: ${r.analysisCalls}/${data.config.analysis.maxCallsPerDay}</p><div class="role-buttons"><button id="analysis-button">${text("Analyze", "分析")}</button><button id="pause-button">${r.paused ? text("Resume", "恢复") : text("Pause", "暂停")}</button>${data.config.remote.enabled ? `<button id="sync-button">${text("Sync remote", "同步远端")}</button>` : ""}</div></details></div>`}<footer class="sidebar-footer"><div class="footer-first"><span>Nativue AI · ${esc(short(s?.source.commit))}${s?.source.dirty ? " · " + text("modified", "有修改") : ""}</span><button class="subtle" id="help-button">${text("Help", "使用帮助")}</button></div><span class="attribution">SienGe AI Lab · 小红书：SienGe的AI实验室</span></footer></aside></main>`;
  bind();
  bindResize();
  bindCanvas(viewMode === "parallel");
  if (savedScroll !== undefined) {
    const el = document.querySelector(".sidebar-scroll");
    if (el) el.scrollTop = savedScroll;
  }
  if (inspectorScroll !== undefined) {
    const el = document.querySelector(".parallel-inspector");
    if (el) el.scrollTop = inspectorScroll;
  }
  if (focusSearch) {
    const el = document.querySelector<HTMLInputElement>("#file-search");
    el?.focus();
    if (caret !== null && caret !== undefined)
      el?.setSelectionRange(caret, caret);
  }
  if (viewMode === "map" && !initialFit && s?.modules.length) {
    initialFit = true;
    requestAnimationFrame(fitGraph);
  }
  if (viewMode === "parallel" && !boardFitted && data.ledger.tasks.length) {
    boardFitted = true;
    requestAnimationFrame(fitBoard);
  }
}
function renderNotice() {
  const s = snapshot(),
    r = data!.runtime;
  let out = "";
  if (error || r.error)
    out += `<div class="notice error" role="alert">${esc(error || r.error)}</div>`;
  if (s?.analysis.error)
    out += `<div class="notice error">${esc(s.analysis.error)}</div>`;
  if (s && s.analysis.status !== "complete")
    out += `<div class="notice">${s.analysis.status === "stale" ? text("Code changed. Showing the last architecture while an update is queued.", "代码已变化，当前保留上一版架构，等待增量分析。") : text("Source indexed. Architecture explanations are waiting for an Agent.", "源码已索引，架构说明等待 Agent 分析。")}<br><button id="notice-analyze">${text("Analyze / create request", "分析 / 生成请求")}</button></div>`;
  return out;
}
function renderVersion() {
  const s = snapshot();
  return `<p class="source-version">${text("Source", "来源")}: ${s?.source.kind === "remote" ? text("Remote", "远端") : text("Local", "本地")} · ${esc(s?.source.branch || "—")}<br>${text("Commit", "提交")}: ${esc(s?.source.commit || "—")}<br>${text("Snapshot", "快照")}: ${esc(s?.id || "—")}<br>${text("Indexed", "索引更新")}: ${formatDate(s?.generatedAt)}<br>${text("Semantic update", "语义更新")}: ${formatDate(s?.analysis.updatedAt)}</p>`;
}
function renderMap() {
  const s = snapshot(),
    gs = groups(),
    active = activeModules();
  const visible = (m: Module) => !collapsed.has(m.kind || "source");
  const nodes = gs
    .map(
      (g, i) =>
        `<section class="group ${collapsed.has(g.id) ? "collapsed" : ""}" data-group-box="${esc(g.id)}" style="left:${g.x}px;top:${g.y}px;width:${g.width}px;height:${g.height}px;--group-bg:${g.color[0]};--group-head:${g.color[1]};--group-line:${g.color[2]}" aria-label="${esc(g.title)}"><div class="group-header"><button class="group-head" data-drag-group="${esc(g.id)}" title="${text("Drag to move group; Alt + arrow keys", "拖动移动整组；Alt + 方向键也可移动")}"><span class="group-no">${String(i + 1).padStart(2, "0")}</span><span class="group-name">${esc(g.title)}</span><span aria-hidden="true">⠿</span></button><button class="group-toggle" data-group="${esc(g.id)}" aria-label="${text("Expand or collapse", "展开或收起")} ${esc(g.title)}" aria-expanded="${!collapsed.has(g.id)}">${collapsed.has(g.id) ? "＋" : "−"}</button></div><p class="group-subtitle">${g.modules.length} ${text("modules", "个模块")} · ${g.modules.reduce((n, m) => n + m.files.length, 0)} ${text("source files", "个源文件")}${collapsed.has(g.id) ? " · " + text("collapsed", "已收起") : ""}</p>${
          !collapsed.has(g.id)
            ? g.modules
                .map((m, j) => {
                  const p = nodePos(m, g);
                  return `<button class="node status-${m.confidence === "verified" ? "passed" : m.confidence === "inferred" ? "reference" : "connected"} ${selectedModule === m.id ? "selected" : ""} ${active.size ? (active.has(m.id) ? "highlighted" : "dim") : ""}" data-node="${esc(m.id)}" aria-pressed="${selectedModule === m.id}" title="${text("Drag to move; click for details", "拖动调整位置；点击查看解释")}" style="left:${p.x - g.x}px;top:${p.y - g.y}px"><span class="node-top"><span class="node-id">${String(i + 1).padStart(2, "0")}.${j + 1} ⠿</span><span class="status-tag">${esc(confidence(m.confidence))}</span></span><span class="node-title">${esc(m.name)}</span><span class="node-caption">${esc(m.description || text("Awaiting explanation", "等待说明"))}</span></button>`;
                })
                .join("")
            : ""
        }</section>`,
    )
    .join("");
  const rects = gs.map((g) => ({
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height,
  }));
  const bounds = boundsOf(rects, 180);
  const edges =
    s?.edges
      .map((e, i) => {
        const a = moduleById(e.from),
          b = moduleById(e.to);
        if (!a || !b || !visible(a) || !visible(b)) return "";
        const ar = nodePos(a),
          br = nodePos(b);
        const focus =
          (active.size > 0 && active.has(e.from) && active.has(e.to)) ||
          (selectedModule &&
            (e.from === selectedModule || e.to === selectedModule));
        return `<path class="edge ${e.confidence === "inferred" ? "reference" : ""} ${focus ? "active" : active.size ? "dim" : ""}" d="${edgePath(ar, br, i)}"><title>${esc(e.label)} · ${esc(confidence(e.confidence))}${e.evidence[0] ? " · " + esc(e.evidence[0].path) + (e.evidence[0].line ? ":" + e.evidence[0].line : "") : ""}</title></path>`;
      })
      .join("") || "";
  return `<div id="viewport" class="viewport" tabindex="0" aria-label="${text("Architecture canvas. Drag to pan, scroll to zoom. Arrow keys move, +/- zoom, 0 fits.", "架构画布。拖动空白移动，滚轮缩放；方向键移动，加减键缩放，0 回到全图。")}"><div id="world" class="world" style="transform:translate(${view.x}px,${view.y}px) scale(${view.scale})"><svg class="connections" style="left:${bounds.x}px;top:${bounds.y}px" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>${edges}</svg><div id="groups">${nodes}</div></div>${!s?.modules.length ? `<div class="map-empty"><h2>${source === "remote" ? text("Remote code map", "远端代码地图") : text("Start with your code", "从你的代码开始")}</h2><p>${source === "remote" ? text("Enable and sync your remote to view a separate snapshot.", "开启并同步远端后，即可查看独立快照。") : text("Ask your Agent to use the Nativue Skill to map modules, evidence and journeys from your indexed code.", "请让 Agent 使用 Nativue Skill，从已索引代码分析模块、源码证据和操作旅程。")}</p><button id="empty-role">${text("Get Agent instructions", "获取 Agent 指令")}</button></div>` : ""}</div><details class="line-legend"><summary>${text("Connection legend", "连线图例")}</summary><div><span class="line-sample call"></span>${text("Source relationship", "源码关系")}</div><div><span class="line-sample reference"></span>${text("Inferred · needs verification", "推断 · 待核实")}</div><p>${text("Arrows point to the receiving module. Dark lines indicate the current selection.", "箭头指向接收方，深色表示当前高亮。")}</p></details><div class="canvas-bottom"><div class="zoom-controls" role="group" aria-label="${text("Canvas viewport", "画布视野")}"><button id="zoom-out" aria-label="${text("Zoom out", "缩小")}">−</button><output id="zoom">${Math.round(view.scale * 100)}%</output><button id="zoom-in" aria-label="${text("Zoom in", "放大")}">＋</button><span class="divider"></span><button id="fit">${text("Fit all", "全图")}</button><button id="focus" ${!selectedModule ? "disabled" : ""}>${text("Focus", "定位所选")}</button><button id="clear">${text("Clear", "清除高亮")}</button><button id="reset-layout">${text("Reset layout", "重置布局")}</button></div></div>`;
}
function boundsOf(
  rects: { x: number; y: number; width: number; height: number }[],
  padding = 0,
) {
  if (!rects.length) return { x: 0, y: 0, width: 1000, height: 700 };
  const x = Math.min(...rects.map((r) => r.x)) - padding,
    y = Math.min(...rects.map((r) => r.y)) - padding;
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x + padding,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y + padding,
  };
}
function edgePath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  i: number,
) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy) * 0.65) {
    const forward = dx >= 0,
      ax = a.x + (forward ? 316 : 0),
      bx = b.x + (forward ? 0 : 316),
      ay = a.y + 62,
      by = b.y + 62,
      curve = Math.max(40, Math.abs(bx - ax) * 0.45) + (i % 3) * 8,
      sign = forward ? 1 : -1;
    return `M${ax} ${ay} C${ax + sign * curve} ${ay},${bx - sign * curve} ${by},${bx} ${by}`;
  }
  const down = dy >= 0,
    ax = a.x + 158,
    bx = b.x + 158,
    ay = a.y + (down ? 124 : 0),
    by = b.y + (down ? 0 : 124),
    curve = Math.max(35, Math.abs(by - ay) * 0.45) + (i % 3) * 8,
    sign = down ? 1 : -1;
  return `M${ax} ${ay} C${ax} ${ay + sign * curve},${bx} ${by - sign * curve},${bx} ${by}`;
}
function taskStage(t: Task) {
  return t.status === "done"
    ? "passed"
    : t.status === "rework"
      ? "rework"
      : [
            "review",
            "passed",
            "integrated",
            "integration-review",
            "integration-passed",
            "handtest",
          ].includes(t.status)
        ? "testing"
        : t.status === "developing"
          ? "confirmed"
          : "discussion";
}
function dependencyGroups() {
  const tasks = data!.ledger.tasks,
    byId = new Map(tasks.map((t) => [t.id, t])),
    cache = new Map<string, number>();
  const depth = (id: string, trail = new Set<string>()): number => {
    if (cache.has(id)) return cache.get(id)!;
    const t = byId.get(id);
    if (!t || trail.has(id)) return -1;
    const next = new Set(trail).add(id);
    const deps = t.dependsOn.map((dep) => depth(dep, next));
    const d = deps.some((v) => v < 0)
      ? -1
      : deps.length
        ? 1 + Math.max(...deps)
        : 0;
    cache.set(id, d);
    return d;
  };
  const gs = new Map<number, Task[]>();
  for (const t of tasks) {
    const d = depth(t.id);
    if (!gs.has(d)) gs.set(d, []);
    gs.get(d)!.push(t);
  }
  return [...gs].sort(([a], [b]) => (a < 0 ? 1 : b < 0 ? -1 : a - b));
}
function renderParallel() {
  const gs = dependencyGroups();
  return `<section id="parallel-board" class="parallel-board" aria-label="${text("Dependency-grouped parallel development canvas", "按依赖分组的并行开发画布")}"><header class="parallel-heading"><h1>${text("Parallel development plan", "并行开发计划")}</h1><p>${data!.ledger.tasks.length} ${text("tasks · grouped by dependency depth · select a card for ownership and evidence", "个任务 · 按依赖层级分组 · 点卡片查看范围、分工与证据")}</p><div class="parallel-legend">${[
    ["discussion", text("Ready", "待开发")],
    ["confirmed", text("Developing", "开发中")],
    ["testing", text("Review / integration / handtest", "验收 / 集成 / 手测")],
    ["passed", text("User accepted", "用户已确认")],
    ["rework", text("Rework required", "需返工")],
  ]
    .map(
      ([stage, title]) =>
        `<span class="parallel-tag stage-${stage}">${title}</span>`,
    )
    .join(
      "",
    )}</div></header><div id="parallel-viewport" class="parallel-viewport" tabindex="0" aria-label="${text("Task canvas: scroll to zoom, drag to pan, arrow keys to move, +/- zoom, 0 fits.", "任务画布：滚轮缩放，拖动平移；方向键移动，加减键缩放，0 显示全部任务。")}"><div id="parallel-groups" class="parallel-groups" style="transform:translate(${boardView.x}px,${boardView.y}px) scale(${boardView.scale})">${gs
    .map(
      ([depth, tasks]) =>
        `<section class="parallel-group" data-parallel-group="${depth}" aria-label="${text("Dependency group", "依赖组")} ${depth + 1}"><header><h2>${depth < 0 ? text("Check dependencies", "待核对依赖") : text(`Group ${depth + 1}`, `第 ${depth + 1} 组`)}</h2><p>${depth < 0 ? text("Missing task references or cyclic dependencies. Resolve before scheduling.", "依赖任务缺失或存在环路，请先核对再派工。") : depth === 0 ? text("No recorded prerequisites. File ownership still determines safe parallelism.", "无已登记前置任务，仍需按文件认领判断是否可并行。") : text("Contains prerequisites in earlier groups. Release each task against its actual dependency evidence.", "包含前序组依赖，须按每项实际依赖和验收证据逐项放行。")}</p></header><div class="parallel-cards">${tasks
          .sort(
            (a, b) =>
              a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id),
          )
          .map(
            (t) =>
              `<button class="parallel-card stage-${taskStage(t)}" data-parallel-card="${esc(t.id)}" data-cycle="${depth < 0}" aria-pressed="${selectedTask === t.id}"><span class="parallel-card-top"><b>${esc(t.id)}</b><span class="parallel-effort">${t.priority}</span></span><strong>${esc(t.title)}</strong><span class="parallel-tag stage-${taskStage(t)}">${esc(statusLabel(t.status))}</span><span class="parallel-owners"><span>${text("Development", "开发")} ${esc(t.developer || t.owner || text("Unassigned", "未登记"))}</span><span>${text("Review", "验收")} ${esc(t.reviewer || text("Unassigned", "未登记"))}</span></span>${t.description ? `<span class="parallel-note">${esc(t.description.length > 160 ? t.description.slice(0, 159) + "…" : t.description)}</span>` : ""}${t.blocked ? `<span class="parallel-special">${text("Blocked", "阻塞")}: ${esc(t.blocked)}</span>` : ""}<span class="parallel-deps">${text("Prerequisites", "接入前置")}: ${esc(t.dependsOn.join(" / ") || text("None", "无"))}</span>${t.commit ? `<span class="parallel-deps">${text("Commit", "提交")}: ${esc(short(t.commit))}</span>` : ""}</button>`,
          )
          .join("")}</div></section>`,
    )
    .join(
      "",
    )}</div>${!gs.length ? `<div class="map-empty"><h2>${text("Your next task starts here.", "从下一个任务开始。")}</h2><p>${text("Create a task or ask A to break down an Issue. Groups appear from actual dependencies.", "新建任务，或让 A 拆分 Issue。任务会按实际依赖关系分组。")}</p><button id="board-new-task">＋ ${text("New task", "新建任务")}</button></div>` : ""}</div><footer class="parallel-toolbar"><div class="zoom-controls"><button id="parallel-zoom-out" aria-label="${text("Zoom out tasks", "缩小任务画布")}">−</button><output id="parallel-zoom">${Math.round(boardView.scale * 100)}%</output><button id="parallel-zoom-in" aria-label="${text("Zoom in tasks", "放大任务画布")}">＋</button><button id="parallel-fit">${text("Show all tasks", "显示全部任务")}</button><button id="parallel-actual">100%</button></div><span>${text("Scroll to zoom · Drag to pan · Select a card for details", "滚轮缩放 · 拖动平移 · 点击卡片看详情")}</span></footer></section>`;
}
function renderUpdates() {
  return `<div class="task-list-head"><h2>${text("Current work", "本次更新")}</h2><button id="new-task">＋ ${text("New task", "新建任务")}</button></div>${data!.ledger.tasks.length ? data!.ledger.tasks.map((t) => `<article class="update-item ${selectedTask === t.id ? "selected-update" : ""}"><button class="update-select" data-update="${esc(t.id)}"><strong>${esc(t.id)} · ${esc(t.title)}</strong><small>${t.priority} · ${esc(statusLabel(t.status))}</small><span>${esc(t.description.length > 180 ? t.description.slice(0, 179) + "…" : t.description)}</span><span class="update-next">${text("Owner", "认领")}: ${esc(t.owner || text("Unassigned", "未登记"))}${t.commit ? " · " + short(t.commit) : ""}</span></button><button class="update-detail-button" data-update="${esc(t.id)}">${text("Details", "详情")} →</button></article>`).join("") : `<p class="fine">${text("No tasks recorded yet. A can import confirmed Issues or split a request into independently testable tasks.", "暂无任务记录。A 可以导入已确认的 Issue，或将需求拆成可独立验收的任务。")}</p>`}<details class="learning-section"><summary>${text("Source coverage", "源码覆盖情况")}</summary><p class="fine">${snapshot()?.files.length || 0} ${text("files indexed", "个文件已索引")} · ${snapshot()?.modules.length || 0} ${text("modules", "个模块")}</p>${
    snapshot()
      ?.warnings.map((w) => `<p class="fine">${esc(w)}</p>`)
      .join("") || ""
  }</details>`;
}
function renderSelectionEmpty() {
  return `<span class="eyebrow">${text("Source-linked explanations", "关联源码的解释")}</span><h2>${text("Select a module or follow a journey", "点模块，或逐步走一次旅程")}</h2><p>${text("Inspect responsibilities, related connections, source evidence, and actual files. Architecture confidence does not replace independent runtime acceptance.", "查看模块职责、关联关系、源码证据和实际文件。架构可信度不能代替独立运行验收。")}</p>`;
}
function renderModuleDetail(m: Module | undefined) {
  if (!m) return renderSelectionEmpty();
  return `<span class="eyebrow">${esc(groupTitle(m.kind))} / ${text("module", "小模块")}</span><h2>${esc(m.name)}</h2><span class="status-tag status-${m.confidence === "verified" ? "passed" : m.confidence === "inferred" ? "reference" : "connected"}">${esc(confidence(m.confidence))}</span><section class="explain-field"><h3>${text("What it does", "它负责什么")}</h3><p>${esc(m.description || text("No explanation yet.", "尚无说明。"))}</p></section><section class="explain-field"><h3>${text("What its connections carry", "相关连线传的是什么")}</h3>${
    snapshot()
      ?.edges.filter((e) => e.from === m.id || e.to === m.id)
      .map(
        (e) =>
          `<button class="connection-item" data-edge="${esc(e.id)}">${esc(moduleById(e.from)?.name || e.from)} → ${esc(moduleById(e.to)?.name || e.to)}<small>${esc(e.label)} · ${esc(confidence(e.confidence))}</small></button>`,
      )
      .join("") ||
    `<p>${text("No relationships recorded.", "暂无已记录关系。")}</p>`
  }</section><section class="explain-field"><h3>${text("Source files & navigation", "源文件与定位")}</h3><button id="show-selected-files">${text(`Locate ${m.files.length} related files in the tree`, `在文件树中查看 ${m.files.length} 个相关文件`)}</button>${m.evidence.map((e) => `<button class="source-link" data-file="${esc(e.path)}"><code>${esc(e.path)}${e.line ? ":" + e.line : ""}</code><span>${esc(e.note || text("Locate source file", "定位源文件"))} ↗</span></button>`).join("")}${!m.evidence.length ? `<p class="fine">${text("No line-level evidence supplied.", "尚未提供行级源码证据。")}</p>` : ""}</section>`;
}
function currentJourney() {
  const list = snapshot()?.journeys || [];
  return list.find((j) => j.id === selectedJourney) || list[0];
}
function renderJourneyNav() {
  const j = currentJourney();
  return `<div class="journey-nav"><button id="journey-prev" ${journeyStep <= 0 ? "disabled" : ""}>${text("Previous", "上一步")}</button><span>${j ? (journeyStep < 0 ? text(`${j.steps.length} steps`, `${j.steps.length} 步`) : `${journeyStep + 1} / ${j.steps.length}`) : "0"}</span><button id="journey-next" ${!j || journeyStep >= j.steps.length - 1 ? "disabled" : ""}>${text("Next", "下一步")}</button><button id="journey-all">${text("Entire path", "整条路径")}</button></div>`;
}
function renderJourneys() {
  const list = snapshot()?.journeys || [],
    j = currentJourney();
  return j
    ? `<label class="field-label" for="journey-picker">${text("Choose a journey", "选择旅程")}</label><select id="journey-picker">${list.map((journey) => `<option value="${esc(journey.id)}" ${journey.id === j.id ? "selected" : ""}>${esc(journey.name)}</option>`).join("")}</select><p class="fine">${esc(j.description)} · ${esc(confidence(j.confidence))}</p><details class="steps-disclosure" open><summary>${text("Step list", "查看步骤清单")}</summary>${j.steps.map((step, i) => `<button class="journey-step" data-step="${i}" aria-pressed="${journeyStep === i}"><span>${i + 1}</span>${esc(step.label)}</button>`).join("")}</details>`
    : `<h2>${text("Journeys", "操作旅程")}</h2><p class="fine">${text("Your Agent can add source-linked user journeys after inspecting the code. No journeys are fabricated from directory names.", "Agent 阅读代码后可以补充关联源码的操作旅程，不会仅凭目录名称编造。")}</p>`;
}
interface TreeNode {
  children: Map<string, TreeNode>;
  path: string;
  file: boolean;
}
function renderFiles() {
  const s = snapshot(),
    root: TreeNode = { children: new Map(), path: "", file: false };
  let count = 0;
  for (const f of s?.files || []) {
    if (
      (search && !f.path.toLowerCase().includes(search.toLowerCase())) ||
      (relatedOnly && !related.includes(f.path))
    )
      continue;
    count++;
    let node = root;
    const parts = f.path.split("/");
    parts.forEach((part, i) => {
      if (!node.children.has(part))
        node.children.set(part, {
          children: new Map(),
          path: parts.slice(0, i + 1).join("/"),
          file: i === parts.length - 1,
        });
      node = node.children.get(part)!;
    });
  }
  const tree = (node: TreeNode): string =>
    [...node.children]
      .sort(
        ([, a], [, b]) =>
          Number(a.file) - Number(b.file) || a.path.localeCompare(b.path),
      )
      .map(([name, n]) =>
        n.file
          ? `<div class="file-leaf"><button class="file-button ${selectedFile === n.path ? "chosen" : ""} ${related.includes(n.path) ? "related" : ""}" data-tree-file="${esc(n.path)}" title="${esc(n.path)}"><span class="file-dot"></span>${esc(name)}${related.includes(n.path) ? `<small>${text("related", "关联")}</small>` : ""}</button></div>`
          : `<details data-dir="${esc(n.path)}" ${search || opened.has(n.path) ? "open" : ""}><summary>${esc(name)}</summary><div class="file-branches">${tree(n)}</div></details>`,
      )
      .join("");
  const index = related.indexOf(selectedFile);
  return `<h2>${text("Project file map", "项目文件地图")}</h2><p class="fine">${text("Source", "来源")}: ${source === "local" ? text("Local workspace", "本地工作区") : text("Remote branch", "远端分支")} · ${esc(short(s?.source.commit))}</p><label class="field-label" for="file-search" style="margin-top:15px">${text("Find files and paths", "查找文件或路径")}</label><input id="file-search" type="search" placeholder="${text("Search indexed paths…", "搜索已索引路径…")}" value="${esc(search)}" autocomplete="off"><p class="fine" aria-live="polite">${count} / ${s?.files.length || 0} ${text("files", "个文件")}</p><div class="file-tools"><button id="files-related" aria-pressed="${relatedOnly}">${text("Related files only", "只看高亮文件")}</button><button id="files-expand">${text("Expand all", "展开全部")}</button><button id="files-collapse">${text("Collapse all", "收起全部")}</button></div>${related.length ? `<div class="file-related-nav"><span>${text("Related file", "关联文件")} ${index >= 0 ? index + 1 : "—"} / ${related.length}</span><button id="prev-file" ${related.length < 2 ? "disabled" : ""}>↑ ${text("Previous", "上一个")}</button><button id="next-file" ${related.length < 2 ? "disabled" : ""}>↓ ${text("Next", "下一个")}</button></div>` : ""}<div id="file-tree" class="file-tree">${tree(root) || `<p class="fine">${text("No matching indexed files.", "没有匹配的已索引文件。")}</p>`}</div><article id="file-detail">${selectedFile ? `<code>${esc(selectedFile)}</code><p class="fine">${text("Read-only source preview. Local content follows the working tree; remote content follows the cached remote snapshot.", "源码预览只读。本地内容来自当前工作树，远端内容来自独立缓存快照。")}</p><button class="file-open" id="view-source">${text("Read selected source", "读取当前源文件")} ↗</button>` : ""}</article>`;
}
function renderTaskDetail(t: Task | undefined) {
  if (!t)
    return `<div class="section-label">${text("A → B → C → you", "A → B → C → 你")}</div><p class="description">${text("A scopes the work. B builds. C reviews independently. After integration, C reviews the integrated version before your handtest.", "A 拆解任务，B 开发，C 独立验收。集成版本再次通过 C 验收后，进入你的手测。")}</p><div class="role-buttons">${["A", "B", "C"].map((role) => `<button data-role="${role}">${text("Copy", "复制")} ${role}</button>`).join("")}</div><div class="section-label">${text("Ledger revision", "台账版本")}</div><span class="badge">${data?.ledger.revision}</span><p class="small-print">${text("Task states change through explicit handoff events, never from a chat ending.", "任务状态由明确的交接事件更新，不通过聊天结束推断完成。")}</p>`;
  const review = (r: Task["reviews"][number], name: string) =>
    `<div class="review"><b>${name} · ${r.passed ? text("Passed", "通过") : text("Changes requested", "需返工")}</b><br>${esc(r.reviewer)} · ${esc(r.commit)}<br>${esc(r.report)}${r.untested.length ? `<br><span class="pending">${text("Untested", "未覆盖")}: ${esc(r.untested.join(", "))}</span>` : ""}<br><span class="muted">${formatDate(r.at)}</span></div>`;
  return `<span class="badge">${esc(statusLabel(t.status))}</span> <span class="priority ${t.priority}">${t.priority}</span><p class="description">${esc(t.description)}</p><div class="section-label">${text("Acceptance criteria", "验收标准")}</div><ul>${t.criteria.map((c) => `<li>${esc(c)}</li>`).join("")}</ul><dl class="task-detail">${[
    [
      text("Task / issue", "任务 / Issue"),
      t.id + (t.issue ? " · " + t.issue : ""),
    ],
    [
      text(
        "Owner / developer / integrator / reviewer",
        "认领 / 开发 / 集成 / 验收",
      ),
      [t.owner, t.developer, t.integrator, t.reviewer]
        .filter(Boolean)
        .join(" / ") || "—",
    ],
    [text("Dependencies", "依赖"), t.dependsOn.join(", ") || "—"],
    [text("Branch", "分支"), t.branch || "—"],
    [text("Base commit", "基线提交"), t.baseCommit || "—"],
    [text("Development commit", "开发提交"), t.commit || "—"],
    [text("Integration commit", "集成提交"), t.integrationCommit || "—"],
  ]
    .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
    .join(
      "",
    )}</dl>${t.blocked ? `<p class="description pending">${text("Blocked", "阻塞")}: ${esc(t.blocked)}</p>` : ""}<div class="section-label">${text("Claimed files", "认领文件")}</div>${t.files.map((p) => `<button class="evidence" data-file="${esc(p)}">${esc(p)}</button>`).join("") || "—"}<div class="section-label">${text("Review evidence", "验收证据")}</div>${t.reviews.map((r, i) => review(r, `${text("C review", "C 验收")} ${i + 1}`)).join("") || `<p class="description">${text("No independent review yet.", "尚无独立验收记录。")}</p>`}${t.integrationReview ? review(t.integrationReview, text("Integration review", "集成验收")) : ""}${t.userAcceptance ? `<div class="review"><b>${text("User acceptance", "用户确认")}</b><br>${esc(t.userAcceptance.commit)}<br>${esc(t.userAcceptance.source)}<br>${formatDate(t.userAcceptance.at)}</div>` : ""}<div class="role-buttons">${["A", "B", "C"].map((role) => `<button data-role="${role}">${text("Copy", "复制")} ${role}</button>`).join("")}</div><button id="edit-task" class="file-open">${text("Edit / submit handoff", "编辑 / 提交交接记录")}</button><p class="small-print">${text("Every review must name its exact commit. Only the user can confirm handtest acceptance.", "验收必须绑定实际提交。只有用户能确认手测通过。")}</p>`;
}
function locateFile(path: string, files?: string[]) {
  if (!snapshot()?.files.some(file => file.path === path)) {
    toast(text("This file is not in the selected source index.", "此文件未包含在当前来源的索引中。"));
    return;
  }
  selectedFile = path;
  related = files?.length ? files : related.includes(path) ? related : [path];
  viewMode = "map";
  tab = "folders";
  search = "";
  relatedOnly = false;
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++)
    opened.add(parts.slice(0, i).join("/"));
  render();
  requestAnimationFrame(() => {
    if (viewMode !== "map" || tab !== "folders" || selectedFile !== path || search) return;
    const leaf = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-tree-file]"),
    ].find((el) => el.dataset.treeFile === path);
    if (leaf) {
      leaf.scrollIntoView({ block: "center", behavior: "auto" });
      leaf.focus({ preventScroll: true });
    }
  });
}
function stepFile(delta: number) {
  if (!related.length) return;
  const index =
    (related.indexOf(selectedFile) + delta + related.length) % related.length;
  locateFile(related[index], related);
}
function selectModule(id: string, fromJourney = false) {
  selectedModule = id;
  selectedTask = "";
  const m = moduleById(id);
  if (m) collapsed.delete(m.kind || "source");
  if (!fromJourney) journeyStep = -1;
  render();
  if (tab !== "folders")
    requestAnimationFrame(() =>
      document
        .querySelector("#selection")
        ?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
}
function selectTask(id: string) {
  selectedTask = id;
  selectedModule = "";
  const task = data?.ledger.tasks.find((t) => t.id === id);
  if (task) {
    for (const g of groups())
      if (g.modules.some((m) => m.files.some((p) => task.files.includes(p))))
        collapsed.delete(g.id);
  }
  render();
  if (viewMode === "map")
    requestAnimationFrame(() =>
      document
        .querySelector("#selection")
        ?.scrollIntoView({ block: "start", behavior: "smooth" }),
    );
}
function showJourney(index: number) {
  const j = currentJourney();
  if (!j) return;
  journeyStep = Math.max(-1, Math.min(j.steps.length - 1, index));
  selectedTask = "";
  selectedModule = journeyStep >= 0 ? j.steps[journeyStep].moduleId : "";
  for (const step of j.steps) {
    const m = moduleById(step.moduleId);
    if (m) collapsed.delete(m.kind || "source");
  }
  render();
  if (selectedModule) focusModule(selectedModule);
  else fitGraph();
}
function bind() {
  const on = (id: string, fn: () => void) =>
    document.getElementById(id)?.addEventListener("click", fn);
  on("language-button", () => {
    lang = lang === "zh" ? "en" : "zh";
    localStorage.setItem("nativue-language", lang);
    render();
  });
  on("settings-button", openSettings);
  on("help-button", openHelp);
  on("role-button", () => openRoles());
  on("empty-role", () => openRoles());
  on("refresh-button", () => void control("scan"));
  on("analysis-button", () => void control("analyze"));
  on("notice-analyze", () => void control("analyze"));
  on("sync-button", () => void control("remote"));
  on(
    "pause-button",
    () => void control(data?.runtime.paused ? "resume" : "pause"),
  );
  on("new-task", () => openTask());
  on("board-new-task", () => openTask());
  on("edit-task", () =>
    openTask(data?.ledger.tasks.find((t) => t.id === selectedTask)),
  );
  on("show-selected-files", () => {
    const m = moduleById(selectedModule);
    if (m?.files.length) locateFile(m.files[0], m.files);
  });
  on("prev-file", () => stepFile(-1));
  on("next-file", () => stepFile(1));
  on("view-source", () => void showSource(selectedFile));
  on("files-related", () => {
    relatedOnly = !relatedOnly;
    render();
  });
  on("files-expand", () => {
    for (const f of snapshot()?.files || []) {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++)
        opened.add(parts.slice(0, i).join("/"));
    }
    render();
  });
  on("files-collapse", () => {
    opened.clear();
    render();
  });
  on("dev-board-open", () => {
    viewMode = "parallel";
    render();
  });
  on("dev-map-open", () => {
    viewMode = "map";
    render();
  });
  on("journey-prev", () => showJourney(journeyStep - 1));
  on("journey-next", () => showJourney(journeyStep + 1));
  on("journey-all", () => showJourney(-1));
  on("fit", fitGraph);
  on("focus", () => focusModule(selectedModule));
  on("clear", () => {
    selectedModule = "";
    selectedTask = "";
    journeyStep = -1;
    selectedFile = "";
    related = [];
    render();
  });
  on("reset-layout", () => {
    nodePositions.clear();
    groupPositions.clear();
    collapsed.clear();
    render();
    fitGraph();
  });
  on("zoom-in", () => zoom(1.2));
  on("zoom-out", () => zoom(1 / 1.2));
  on("parallel-zoom-in", () => zoom(1.2, undefined, undefined, true));
  on("parallel-zoom-out", () => zoom(1 / 1.2, undefined, undefined, true));
  on("parallel-fit", fitBoard);
  on("parallel-actual", () => {
    boardView = { x: 20, y: 20, scale: 1 };
    paintView(true);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      tab = el.dataset.tab as typeof tab;
      render();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const tabs = ["updates", "journeys", "folders"] as const;
        tab = tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : 2)) % 3];
        render();
        document.getElementById("tab-" + tab)?.focus();
      }
    });
  });
  document
    .querySelector<HTMLSelectElement>("#version-picker")
    ?.addEventListener("change", (e) => {
      source = (e.target as HTMLSelectElement).value as typeof source;
      selectedModule = "";
      selectedFile = "";
      selectedJourney = "";
      related = [];
      nodePositions.clear();
      groupPositions.clear();
      initialFit = false;
      view = { x: 0, y: 0, scale: 1 };
      render();
    });
  document
    .querySelector<HTMLSelectElement>("#journey-picker")
    ?.addEventListener("change", (e) => {
      selectedJourney = (e.target as HTMLSelectElement).value;
      showJourney(-1);
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-step]")
    .forEach((el) =>
      el.addEventListener("click", () => showJourney(Number(el.dataset.step))),
    );
  document
    .querySelectorAll<HTMLButtonElement>("[data-parallel-card]")
    .forEach((el) =>
      el.addEventListener("click", () => selectTask(el.dataset.parallelCard!)),
    );
  document
    .querySelectorAll<HTMLButtonElement>("[data-update]")
    .forEach((el) =>
      el.addEventListener("click", () => selectTask(el.dataset.update!)),
    );
  document.querySelectorAll<HTMLButtonElement>("[data-file]").forEach((el) =>
    el.addEventListener("click", () => {
      const m = moduleById(selectedModule),
        t = data?.ledger.tasks.find((t) => t.id === selectedTask);
      locateFile(el.dataset.file!, selectedTask ? t?.files : m?.files);
    }),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-tree-file]")
    .forEach((el) =>
      el.addEventListener("click", () => {
        selectedFile = el.dataset.treeFile!;
        render();
      }),
    );
  document.querySelectorAll<HTMLDetailsElement>("[data-dir]").forEach((el) =>
    el.addEventListener("toggle", () => {
      el.open ? opened.add(el.dataset.dir!) : opened.delete(el.dataset.dir!);
    }),
  );
  document
    .querySelector<HTMLInputElement>("#file-search")
    ?.addEventListener("input", (e) => {
      search = (e.target as HTMLInputElement).value;
      render();
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-role]")
    .forEach((el) =>
      el.addEventListener("click", () => void copyRole(el.dataset.role!)),
    );
  document.querySelectorAll<HTMLButtonElement>("[data-group]").forEach((el) =>
    el.addEventListener("click", () => {
      const id = el.dataset.group!;
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      render();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-edge]").forEach((el) =>
    el.addEventListener("click", () => {
      const edge = snapshot()?.edges.find((e) => e.id === el.dataset.edge);
      if (edge?.evidence.length)
        locateFile(
          edge.evidence[0].path,
          edge.evidence.map((e) => e.path),
        );
    }),
  );
}
function fitView(
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number },
  max = 1.1,
) {
  const scale = Math.max(
    0.04,
    Math.min(
      max,
      Math.max(1, width - 48) / bounds.width,
      Math.max(1, height - 48) / bounds.height,
    ),
  );
  return {
    scale,
    x: (width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}
function zoom(factor: number, x?: number, y?: number, board = false) {
  const current = board ? boardView : view;
  const vp = document.getElementById(board ? "parallel-viewport" : "viewport");
  if (!vp) return;
  x = x ?? vp.clientWidth / 2;
  y = y ?? vp.clientHeight / 2;
  const scale = Math.max(
    board ? 0.02 : 0.1,
    Math.min(1.8, current.scale * factor),
  );
  const k = scale / current.scale;
  const next = {
    scale,
    x: x - (x - current.x) * k,
    y: y - (y - current.y) * k,
  };
  if (board) boardView = next;
  else view = next;
  paintView(board);
}
function paintView(board = false) {
  const v = board ? boardView : view,
    world = document.getElementById(board ? "parallel-groups" : "world"),
    vp = document.getElementById(board ? "parallel-viewport" : "viewport");
  if (world)
    world.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.scale})`;
  if (vp) {
    vp.style.backgroundSize = `${22 * v.scale}px ${22 * v.scale}px`;
    vp.style.backgroundPosition = `${v.x}px ${v.y}px`;
  }
  const output = document.getElementById(board ? "parallel-zoom" : "zoom");
  if (output) output.textContent = Math.round(v.scale * 100) + "%";
}
function fitGraph() {
  const vp = document.getElementById("viewport"),
    gs = groups();
  if (!vp || !gs.length) return;
  const bounds = boundsOf(
    [
      ...gs,
      ...gs.flatMap((g) =>
        collapsed.has(g.id)
          ? []
          : g.modules.map((m) => ({
              ...nodePos(m, g),
              width: 316,
              height: 124,
            })),
      ),
    ],
    30,
  );
  view = fitView(vp.clientWidth, vp.clientHeight, bounds);
  paintView();
}
function fitBoard() {
  const vp = document.getElementById("parallel-viewport"),
    world = document.getElementById("parallel-groups");
  if (!vp || !world || !data?.ledger.tasks.length) return;
  boardView = fitView(
    vp.clientWidth,
    vp.clientHeight,
    { x: 0, y: 0, width: world.offsetWidth, height: world.offsetHeight },
    1,
  );
  paintView(true);
}
function focusModule(id: string) {
  const m = moduleById(id),
    vp = document.getElementById("viewport");
  if (!m || !vp) return;
  collapsed.delete(m.kind || "source");
  const p = nodePos(m);
  view = fitView(
    vp.clientWidth,
    vp.clientHeight,
    { ...p, width: 316, height: 124 },
    1,
  );
  render();
  paintView();
}
function moveGroup(id: string, dx: number, dy: number) {
  const g = groups().find((g) => g.id === id);
  if (!g) return;
  for (const m of g.modules) {
    const p = nodePos(m, g);
    nodePositions.set(m.id, { x: p.x + dx, y: p.y + dy });
  }
  groupPositions.set(id, { x: g.x + dx, y: g.y + dy });
}
function bindCanvas(board = false) {
  const vp = document.getElementById(board ? "parallel-viewport" : "viewport");
  if (!vp) return;
  stageSize = { width: vp.clientWidth, height: vp.clientHeight };
  let drag: {
    type: "pan" | "node" | "group";
    id: string;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    ox: number;
    oy: number;
    moved: boolean;
  } | null = null;
  vp.addEventListener("pointerdown", (ev) => {
    if (
      ev.button !== 0 ||
      (ev.target as Element).closest("[data-group],.map-empty")
    )
      return;
    const node = (ev.target as Element).closest<HTMLElement>("[data-node]"),
      group = (ev.target as Element).closest<HTMLElement>("[data-drag-group]");
    if (board && (ev.target as Element).closest("button")) return;
    const current = board ? boardView : view;
    drag = {
      type: node ? "node" : group ? "group" : "pan",
      id: node?.dataset.node || group?.dataset.dragGroup || "",
      startX: ev.clientX,
      startY: ev.clientY,
      lastX: ev.clientX,
      lastY: ev.clientY,
      ox: current.x,
      oy: current.y,
      moved: false,
    };
    vp.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  vp.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const dx = ev.clientX - drag.startX,
      dy = ev.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    const current = board ? boardView : view;
    if (drag.type === "pan") {
      current.x = drag.ox + dx;
      current.y = drag.oy + dy;
      paintView(board);
    } else {
      const mx = (ev.clientX - drag.lastX) / current.scale,
        my = (ev.clientY - drag.lastY) / current.scale;
      if (drag.type === "group") moveGroup(drag.id, mx, my);
      else {
        const m = moduleById(drag.id);
        if (m) {
          const p = nodePos(m);
          nodePositions.set(m.id, { x: p.x + mx, y: p.y + my });
        }
      }
      drag.lastX = ev.clientX;
      drag.lastY = ev.clientY;
      const shell = document.querySelector(".canvas-shell");
      if (shell) {
        const scratch = document.createElement("div");
        scratch.innerHTML = renderMap();
        const incoming = scratch.querySelector("#world"),
          existing = document.getElementById("world");
        if (incoming && existing) existing.innerHTML = incoming.innerHTML;
      }
    }
  });
  vp.addEventListener("pointerup", (ev) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (vp.hasPointerCapture(ev.pointerId))
      vp.releasePointerCapture(ev.pointerId);
    if (d.type === "node" && !d.moved) selectModule(d.id);
    else if (d.type !== "pan") render();
  });
  vp.addEventListener("pointercancel", () => {
    drag = null;
  });
  vp.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const rect = vp.getBoundingClientRect(),
        delta =
          ev.deltaY *
          (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? vp.clientHeight : 1);
      zoom(
        Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.0025),
        ev.clientX - rect.left,
        ev.clientY - rect.top,
        board,
      );
    },
    { passive: false },
  );
  vp.addEventListener("keydown", (ev) => {
    if (ev.altKey && !board) {
      const node = (ev.target as Element).closest<HTMLElement>("[data-node]"),
        group = (ev.target as Element).closest<HTMLElement>(
          "[data-drag-group]",
        );
      if (
        (node || group) &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(ev.key)
      ) {
        ev.preventDefault();
        const dx =
            ev.key === "ArrowLeft" ? -15 : ev.key === "ArrowRight" ? 15 : 0,
          dy = ev.key === "ArrowUp" ? -15 : ev.key === "ArrowDown" ? 15 : 0;
        if (group) moveGroup(group.dataset.dragGroup!, dx, dy);
        else if (node) {
          const m = moduleById(node.dataset.node!);
          if (m) {
            const p = nodePos(m);
            nodePositions.set(m.id, { x: p.x + dx, y: p.y + dy });
          }
        }
        const id = node?.dataset.node,
          groupId = group?.dataset.dragGroup;
        render();
        [
          ...document.querySelectorAll<HTMLElement>(
            id ? "[data-node]" : "[data-drag-group]",
          ),
        ]
          .find((el) =>
            id ? el.dataset.node === id : el.dataset.dragGroup === groupId,
          )
          ?.focus();
        return;
      }
    }
    if ((ev.target as Element).closest("button") && ev.target !== vp) return;
    const current = board ? boardView : view;
    switch (ev.key) {
      case "ArrowLeft":
        current.x += 35;
        break;
      case "ArrowRight":
        current.x -= 35;
        break;
      case "ArrowUp":
        current.y += 35;
        break;
      case "ArrowDown":
        current.y -= 35;
        break;
      case "+":
      case "=":
        zoom(1.2, undefined, undefined, board);
        break;
      case "-":
        zoom(1 / 1.2, undefined, undefined, board);
        break;
      case "0":
        board ? fitBoard() : fitGraph();
        break;
      default:
        return;
    }
    ev.preventDefault();
    paintView(board);
  });
  if (!board) {
    document.querySelectorAll<HTMLElement>("[data-node]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.detail === 0) selectModule(el.dataset.node!);
      }),
    );
  }
  paintView(board);
}
function bindResize() {
  const handle = document.getElementById("resize-handle");
  if (!handle) return;
  let drag = false;
  const resize = (width: number) => {
    sideWidth = Math.max(320, Math.min(720, window.innerWidth - 300, width));
    document
      .querySelector<HTMLElement>(".workspace")
      ?.style.setProperty("--side-width", sideWidth + "px");
    handle.setAttribute("aria-valuenow", String(sideWidth));
    localStorage.setItem("nativue-side-width", String(sideWidth));
  };
  handle.addEventListener("pointerdown", (e) => {
    drag = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (drag) resize(window.innerWidth - e.clientX);
  });
  handle.addEventListener("pointerup", (e) => {
    drag = false;
    if (handle.hasPointerCapture(e.pointerId))
      handle.releasePointerCapture(e.pointerId);
  });
  handle.addEventListener("pointercancel", () => {
    drag = false;
  });
  handle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      resize(sideWidth + (e.key === "ArrowLeft" ? 20 : -20));
    }
  });
}
function openModal(title: string, body: string, wide = false) {
  modalCleanup?.();
  document.querySelector(".modal-backdrop")?.remove();
  modal = title;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal ${wide ? "code-modal" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button class="subtle" id="close-modal" aria-label="${text("Close", "关闭")}">×</button></div>${body}</section>`;
  document.body.append(backdrop);
  const close = () => {
    backdrop.remove();
    modal = "";
    modalCleanup?.();
    modalCleanup = undefined;
  };
  backdrop.querySelector("#close-modal")!.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      document.removeEventListener("keydown", key);
    }
    if (e.key === "Tab") {
      const focusable = [
        ...backdrop.querySelectorAll<HTMLElement>(
          "button,input,select,textarea,a[href]",
        ),
      ].filter((el) => !el.hasAttribute("disabled"));
      const first = focusable[0],
        last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  document.addEventListener("keydown", key);
  modalCleanup = () => document.removeEventListener("keydown", key);
  requestAnimationFrame(() =>
    backdrop.querySelector<HTMLElement>("input,select,button")?.focus(),
  );
  return backdrop;
}
function closeModal() {
  modalCleanup?.();
  modalCleanup = undefined;
  document.querySelector(".modal-backdrop")?.remove();
  modal = "";
}
function openSettings() {
  if (!data) return;
  const c = data.config;
  const shell = openModal(
    text("Make it your workspace.", "为你的工作区配置。"),
    `<p>${text("Choose how your AI tools work together. Source data stays in your local workspace.", "选择 AI 工具的协作方式。数据保存在你的本地工作区。")}</p><form id="settings-form"><div class="form-grid"><div><label for="tool">${text("AI tool", "AI 工具")}</label><select id="tool" name="tool"><option value="codex" ${c.tool === "codex" ? "selected" : ""}>Codex</option><option value="claude" ${c.tool === "claude" ? "selected" : ""}>Claude Code</option><option value="workbuddy" ${c.tool === "workbuddy" ? "selected" : ""}>WorkBuddy</option></select></div><div><label for="mode">${text("Collaboration mode", "协作模式")}</label><select id="mode" name="mode"><option value="manual" ${c.mode === "manual" ? "selected" : ""}>${text("Independent A / B / C conversations", "独立 A / B / C 对话")}</option><option value="automatic" ${c.mode === "automatic" ? "selected" : ""}>${text("A + sub-agents (when supported)", "A + 子 Agent（工具支持时）")}</option></select></div></div><div class="form-row"><label>${text("Role models · optional, chosen in your AI tool", "角色模型 · 可选，在 AI 工具中选择")}</label><div class="models">${(["A", "B", "C"] as const).map((role) => `<div><label for="model-${role}">${role} · ${role === "A" ? text("Coordinate", "调度") : role === "B" ? text("Develop", "开发") : text("Review", "验收")}</label><input id="model-${role}" name="model-${role}" value="${esc(c.models[role])}" placeholder="${text("Tool default", "工具默认")}" maxlength="160"></div>`).join("")}</div><p class="small-print">${text("A Skill cannot switch the current conversation model. Sub-agent support and model selection depend on the host tool.", "Skill 无法切换当前对话模型。子 Agent 能力及模型选择以宿主工具为准。")}</p></div><div class="form-row"><label><input id="remote-enabled" name="remote-enabled" type="checkbox" ${c.remote.enabled ? "checked" : ""}>${text("Enable GitHub / Git remote sync", "开启 GitHub / Git 远端同步")}</label><div class="form-grid"><div><label for="remote-url">${text("Repository URL (without credentials)", "仓库地址（不含凭证）")}</label><input id="remote-url" name="remote-url" type="text" value="${esc(c.remote.url)}" placeholder="https://github.com/owner/repo.git"></div><div><label for="remote-branch">${text("Tracked branch", "跟踪分支")}</label><input id="remote-branch" name="remote-branch" value="${esc(c.remote.branch)}" placeholder="main"></div></div><p class="small-print">${text("Remote analysis uses a separate cache. It does not pull or merge into your local branch.", "远端分析使用独立缓存，不会拉取或合并到你的本地分支。")}</p></div><details class="form-row"><summary style="font-size:12px;cursor:pointer">${text("Automatic analysis & update settings", "自动分析与更新设置")}</summary><div class="form-row"><label><input id="analysis-enabled" name="analysis-enabled" type="checkbox" ${c.analysis.enabled ? "checked" : ""}>${text("Enable configured background analysis", "开启已配置的后台分析")}</label><label for="analysis-command">${text("Runner command · JSON array, no shell expansion", "运行命令 · JSON 数组，不经过 Shell 展开")}</label><textarea id="analysis-command" name="analysis-command" spellcheck="false" readonly placeholder='["your-runner", "argument"]'>${esc(JSON.stringify(c.analysis.command))}</textarea><p class="small-print">${text("Set executable runner commands in the local .nativue/config.json file after verifying the input/output contract. This field is read only. Without a supported runner, analysis waits for your next Agent session.", "请在本地 .nativue/config.json 中配置运行命令，并先核对输入输出协议。此处只读。未配置可用运行器时，分析将等待下一次 Agent 会话。")}</p></div><div class="form-grid"><div><label for="max-calls">${text("Maximum AI calls per day", "每日 AI 调用上限")}</label><input type="number" id="max-calls" name="max-calls" min="1" max="1000" value="${c.analysis.maxCallsPerDay}"></div><div><label for="analysis-interval">${text("Minimum analysis interval (seconds)", "最短分析间隔（秒）")}</label><input type="number" id="analysis-interval" name="analysis-interval" min="1" value="${c.analysis.minIntervalMs / 1000}"></div><div><label for="remote-interval">${text("Remote check interval (seconds)", "远端检查间隔（秒）")}</label><input type="number" id="remote-interval" name="remote-interval" min="30" value="${c.remote.intervalMs / 1000}"></div><div><label for="debounce">${text("File change quiet period (seconds)", "文件变化合并等待（秒）")}</label><input type="number" id="debounce" name="debounce" min="1" value="${c.refresh.debounceMs / 1000}"></div></div><div class="form-row"><label for="exclusions">${text("Extra excluded paths · one per line", "额外排除路径 · 每行一条")}</label><textarea id="exclusions" name="exclusions" spellcheck="false">${esc(c.exclude.join("\n"))}</textarea></div></details><div class="form-actions"><button type="submit" class="primary">${text("Save configuration", "保存配置")}</button></div><p id="settings-error" class="description danger" role="alert"></p></form>`,
  );
  shell
    .querySelector("#settings-form")!
    .addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const form = new FormData(ev.target as HTMLFormElement);
      const config: Config = structuredClone(c);
      try {
        const command = JSON.parse(String(form.get("analysis-command")));
        if (
          !Array.isArray(command) ||
          !command.every((v) => typeof v === "string")
        )
          throw new Error(
            text(
              "Runner command must be a JSON array of strings.",
              "运行命令必须是字符串组成的 JSON 数组。",
            ),
          );
        config.language = lang;
        config.tool = form.get("tool") as Config["tool"];
        config.mode = form.get("mode") as Config["mode"];
        for (const role of ["A", "B", "C"] as const)
          config.models[role] = String(form.get("model-" + role) || "").trim();
        config.remote = {
          ...c.remote,
          enabled: form.has("remote-enabled"),
          url: String(form.get("remote-url") || "").trim(),
          branch: String(form.get("remote-branch") || "main").trim(),
          intervalMs: Number(form.get("remote-interval")) * 1000,
        };
        config.analysis = {
          ...c.analysis,
          enabled: form.has("analysis-enabled"),
          command,
          maxCallsPerDay: Number(form.get("max-calls")),
          minIntervalMs: Number(form.get("analysis-interval")) * 1000,
        };
        config.refresh.debounceMs = Number(form.get("debounce")) * 1000;
        config.exclude = String(form.get("exclusions") || "")
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        await api("/api/config", { config });
        closeModal();
        await refresh();
        toast(text("Workspace settings saved.", "工作区配置已保存。"));
      } catch (e) {
        shell.querySelector("#settings-error")!.textContent =
          e instanceof Error ? e.message : String(e);
      }
    });
}
function openHelp() {
  openModal(
    text("A clearer way to build.", "让开发过程更清楚。"),
    `<p>${text("Nativue connects an evidence-based architecture canvas with an explicit A / B / C workflow. It works with your own repository and AI tools.", "Nativue 将有源码证据的架构画布与 A / B / C 协作流程连在一起，配合你的代码库和 AI 工具使用。")}</p><h3>01 · ${text("Map your workspace", "理解工作区")}</h3><p>${text("Initialize with the CLI, then use the Nativue Skill in your AI tool to inspect the indexed files and write an architecture snapshot. Select any module to reveal and scroll to its source files.", "先通过 CLI 初始化，再让 AI 工具使用 Nativue Skill 阅读已索引文件并生成架构快照。点击模块后，源文件栏会展开目录并直接滚动到目标文件。")}</p><pre>nativue init .\nnativue serve</pre><h3>02 · ${text("Choose how to collaborate", "选择协作方式")}</h3><p>${text("Open independent A / B / C conversations, or let A create sub-agents when the host tool supports them. Use the shared ledger and handoff prompts instead of relying on chat memory.", "可以独立开启 A / B / C 对话，也可以在工具支持时让 A 调度子 Agent。使用共享台账和交接指令接续工作。")}</p><h3>03 · ${text("Keep acceptance independent", "保持独立验收")}</h3><p>${text("B supplies a frozen development commit. C independently checks that version and records evidence. Integration requires a separate C review against the integration commit. User acceptance is a separate final step.", "B 提供冻结的开发提交。C 独立验收该版本并记录证据。集成提交需要单独的 C 复验，最后由用户手测确认。")}</p><h3>04 · ${text("Stay current, visibly", "看清更新状态")}</h3><p>${text("While the local service runs, file indexing and task changes refresh automatically. Semantic analysis needs a configured runner or an active Agent session. A stale canvas stays visible with its version and status. Git remote sync is optional and uses its own snapshot.", "本地服务运行时，文件索引和任务变化会自动刷新。语义分析需要已配置的运行器或 Agent 会话。旧画布保留其版本和过期状态。Git 远端同步可选，并使用独立快照。")}</p><div class="section-divider"></div><p class="small-print">${text("Compatibility is capability-specific. Selecting an AI tool does not mean its automatic orchestration has been verified on this machine.", "兼容性按具体能力区分。选择某个 AI 工具，不代表本机已经验证该工具的自动调度。")}</p><p>SienGe AI Lab · 小红书：SienGe的AI实验室</p>`,
  );
}
async function getRole(role: string) {
  const id = selectedTask ? `&id=${encodeURIComponent(selectedTask)}` : "";
  return (await api(`/api/handoff?role=${role}${id}`)).text as string;
}
async function copyRole(role: string) {
  try {
    const value = await getRole(role);
    await navigator.clipboard.writeText(value);
    toast(
      text(
        `${role} instructions copied. Paste into the intended Agent conversation.`,
        `${role} 指令已复制，请粘贴到对应 Agent 对话。`,
      ),
    );
  } catch (e) {
    openRoles(role);
  }
}
function openRoles(initial = "A") {
  const shell = openModal(
    text("Give every Agent a clear role.", "给每个 Agent 清楚的职责。"),
    `<p>${data?.config.mode === "automatic" ? text("Start A in your selected tool. Ask A to use native sub-agents only when that capability is available. Roles and versioned acceptance remain separate.", "在所选工具中启动 A。仅在宿主支持时使用原生子 Agent，始终保持角色和版本验收独立。") : text("Open a separate conversation for each role. Paste its handoff prompt, then use the shared ledger to keep the work connected.", "为各角色开启独立对话，粘贴交接指令，通过共享台账接续工作。")}</p><div class="role-buttons">${["A", "B", "C"].map((role) => `<button data-modal-role="${role}">${role} · ${role === "A" ? text("Coordinator", "调度") : role === "B" ? text("Developer", "开发") : text("Reviewer", "验收")}</button>`).join("")}</div><pre id="role-text">${text("Loading instructions…", "正在读取指令…")}</pre><div class="form-actions"><button class="primary" id="copy-role-text">${text("Copy instructions", "复制指令")}</button></div><p class="small-print">${text("Tool capability varies. WorkBuddy automatic sub-agent support is not assumed. Models are configured per role in Settings and selected through your host tool.", "各工具能力不同，不默认假设 WorkBuddy 支持自动子 Agent。角色模型可在设置中记录，并在宿主工具中选择。")}</p>`,
  );
  let current = "";
  const load = async (role: string) => {
    try {
      current = await getRole(role);
      shell.querySelector("#role-text")!.textContent = current;
    } catch (e) {
      current = "";
      shell.querySelector("#role-text")!.textContent = String(e);
    }
  };
  shell
    .querySelectorAll<HTMLElement>("[data-modal-role]")
    .forEach((b) =>
      b.addEventListener("click", () => void load(b.dataset.modalRole!)),
    );
  shell.querySelector("#copy-role-text")!.addEventListener("click", () => {
    if (current)
      void navigator.clipboard
        .writeText(current)
        .then(() => toast(text("Instructions copied.", "指令已复制。")))
        .catch(() =>
          toast(
            text(
              "Select and copy the instructions above.",
              "请选中并复制上方指令。",
            ),
          ),
        );
  });
  void load(initial);
}
function openTask(task?: Task) {
  if (!data) return;
  const revision = data.ledger.revision;
  const shell = openModal(
    task
      ? text("Submit a task handoff.", "提交任务交接。")
      : text("Make the next step clear.", "把下一步说清楚。"),
    `<form id="task-form">${task ? `<p>${text("Edit the complete task record. The service validates ownership, status transitions, exact commits, and independent review evidence. Revision conflicts require reloading.", "编辑完整任务记录。服务会验证认领、状态流转、提交版本和独立验收证据。版本冲突时需要重新载入。")}</p><div class="form-row"><label for="task-json">${text("Versioned task record · JSON", "版本化任务记录 · JSON")}</label><textarea id="task-json" name="task-json" spellcheck="false" style="min-height:330px;font-family:ui-monospace,monospace;font-size:11px">${esc(JSON.stringify(task, null, 2))}</textarea></div>` : `<div class="form-row"><label for="task-title">${text("Task title", "任务标题")}</label><input id="task-title" name="task-title" required maxlength="240" placeholder="${text("What should change?", "需要改变什么？")}"></div><div class="form-row"><label for="task-description">${text("Context & expected behavior", "背景与预期行为")}</label><textarea id="task-description" name="task-description" required></textarea></div><div class="form-grid form-row"><div><label for="task-priority">${text("Priority", "优先级")}</label><select id="task-priority" name="task-priority"><option>P1</option><option>P0</option><option>P2</option></select></div><div><label for="task-issue">${text("Issue URL or reference (optional)", "Issue 地址或编号（可选）")}</label><input id="task-issue" name="task-issue" placeholder="#12"></div></div><div class="form-row"><label for="task-criteria">${text("Acceptance criteria · one per line", "验收标准 · 每行一条")}</label><textarea id="task-criteria" name="task-criteria" required></textarea></div>`}<div class="form-grid form-row"><div><label for="task-actor">${text("Recorded actor", "记录操作者")}</label><input id="task-actor" name="task-actor" value="${task ? "" : "user"}" placeholder="${text("Your role / session identifier", "你的角色 / 会话标识")}" required maxlength="160"></div><div><label>${text("Ledger revision", "台账版本")}</label><p class="description">${revision}</p></div></div><p id="task-error" role="alert" class="description danger"></p><div class="form-actions"><button class="primary" type="submit">${task ? text("Submit handoff", "提交交接") : text("Create task", "创建任务")}</button></div></form>`,
  );
  shell.querySelector("#task-form")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = new FormData(ev.target as HTMLFormElement);
    try {
      let next: Task;
      if (task) {
        next = JSON.parse(String(form.get("task-json")));
        if (next.id !== task.id)
          throw new Error(
            text("Task ID must remain unchanged.", "任务 ID 不能改变。"),
          );
      } else {
        next = {
          id: `TASK-${crypto.randomUUID().slice(0, 8)}`,
          title: String(form.get("task-title")).trim(),
          description: String(form.get("task-description")).trim(),
          priority: form.get("task-priority") as Task["priority"],
          status: "todo",
          criteria: String(form.get("task-criteria"))
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          dependsOn: [],
          files: [],
          reviews: [],
          updatedAt: new Date().toISOString(),
        };
        const issue = String(form.get("task-issue") || "").trim();
        if (issue) next.issue = issue;
      }
      await api("/api/tasks", {
        revision,
        actor: String(form.get("task-actor")).trim(),
        task: next,
      });
      selectedTask = next.id;
      viewMode = "parallel";
      closeModal();
      await refresh();
      toast(text("Task ledger updated.", "任务台账已更新。"));
    } catch (e) {
      shell.querySelector("#task-error")!.textContent =
        e instanceof Error ? e.message : String(e);
    }
  });
}
async function showSource(path: string) {
  if (!path) return;
  abortFile?.abort();
  abortFile = new AbortController();
  const shell = openModal(
    path,
    `<p>${esc(source === "remote" ? text("Remote snapshot · read only", "远端快照 · 只读") : text("Local source · read only", "本地源码 · 只读"))}</p><pre id="source-content">${text("Loading source…", "正在读取源码…")}</pre>`,
    true,
  );
  try {
    const r = await fetch(
      `/api/file?path=${encodeURIComponent(path)}&source=${source}`,
      { signal: abortFile.signal },
    );
    const value = await r.json();
    if (!r.ok) throw new Error(value.error || `HTTP ${r.status}`);
    shell.querySelector("#source-content")!.innerHTML = String(value.content)
      .split("\n")
      .map(
        (line, i) =>
          `<span class="code-line"><span class="line-no">${i + 1}</span>${esc(line)}</span>`,
      )
      .join("");
  } catch (e) {
    if ((e as Error).name !== "AbortError")
      shell.querySelector("#source-content")!.textContent = String(e);
  }
}
void refresh();
const events = new EventSource("/api/events");
events.onmessage = () => void refresh();
events.onerror = () => {
  if (data && !error) {
    error = text(
      "Live connection interrupted. Reconnecting…",
      "实时连接中断，正在重连…",
    );
    render();
  }
};
events.onopen = () => {
  if (error) {
    error = "";
    void refresh();
  }
};
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void refresh();
});
