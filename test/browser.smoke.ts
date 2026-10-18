import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { defaultConfig, saveConfig, readSnapshot } from "../src/store.ts";
import { Runtime } from "../src/runtime.ts";
import { importAnalysis } from "../src/analysis.ts";
import { serve } from "../src/server.ts";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nativue-browser-"));
const root = path.join(temp, "atlas-notes");
fs.mkdirSync(root);
const files: Record<string, string> = {
  "client/screens/editor.ts":
    "import {saveNote} from '../../server/routes/notes.ts';\nexport const save=saveNote;\n",
  "server/routes/notes.ts":
    "import {Note} from '../../shared/note.ts';\nexport function saveNote(note:Note){return {ok:true,note};}\n",
  "shared/note.ts": "export interface Note {id:string;title:string}\n",
};
for (let i = 0; i < 85; i++)
  files[`client/components/item-${String(i).padStart(3, "0")}.ts`] =
    `export const item${i}=${i};\n`;
for (const [name, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), content);
}
saveConfig(root, defaultConfig());
await new Runtime(root).scan(true);
const s = readSnapshot(root)!;
const groups = [
  {
    id: "editor",
    name: "Note editor",
    description: "Write and save a note.",
    kind: "frontend",
    files: ["client/screens/editor.ts"],
    evidence: [{ path: "client/screens/editor.ts", line: 1 }],
    confidence: "inferred" as const,
  },
  {
    id: "api",
    name: "Notes API",
    description: "Accept saved note data.",
    kind: "backend",
    files: ["server/routes/notes.ts"],
    evidence: [{ path: "server/routes/notes.ts", line: 2 }],
    confidence: "inferred" as const,
  },
  {
    id: "contract",
    name: "Shared note type",
    description: "The note shape used by services.",
    kind: "shared",
    files: [
      "shared/note.ts",
      ...Object.keys(files).filter((f) => f.includes("/components/")),
    ],
    evidence: [{ path: "shared/note.ts", line: 1 }],
    confidence: "observed" as const,
  },
];
await importAnalysis(root, {
  schemaVersion: 1,
  inputId: s.id,
  modules: groups,
  edges: [
    {
      id: "save-call",
      from: "editor",
      to: "api",
      label: "saveNote",
      evidence: [{ path: "client/screens/editor.ts", line: 1 }],
      confidence: "observed",
    },
  ],
  journeys: [
    {
      id: "save",
      name: "Save a note",
      description: "From editor to API.",
      confidence: "inferred",
      steps: [
        {
          moduleId: "editor",
          label: "Write a note",
          evidence: [{ path: "client/screens/editor.ts", line: 2 }],
        },
        {
          moduleId: "api",
          label: "Save note data",
          evidence: [{ path: "server/routes/notes.ts", line: 2 }],
        },
      ],
    },
  ],
});
const instance = await serve(root, 0);
const browser = await chromium.launch({
  channel: process.env.CI ? undefined : "chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const failures: string[] = [];
page.on("pageerror", (e) => failures.push(e.message));
fs.mkdirSync("artifacts", { recursive: true });
try {
  await page.goto(instance.url);
  await page.locator('#dev-map-open').waitFor();
  await page.locator('[data-node="editor"]').click();
  await page.locator('#selection').getByRole('heading',{name:'Note editor'}).waitFor();
  assert.equal(await page.locator('#tab-updates').getAttribute('aria-selected'),'true');
  await page.screenshot({path:'artifacts/canvas-en.png',fullPage:true});
  await page.locator('#show-selected-files').click();
  assert.equal(await page.locator('#tab-folders').getAttribute('aria-selected'),'true');
  await page.locator('#file-search').fill('no-match');
  await page.locator('#tab-updates').click();
  await page.locator('[data-node="contract"]').click();
  await page.locator('#show-selected-files').click();
  assert.equal(await page.locator('#file-search').inputValue(),'');
  await page.locator('#prev-file').click();
  const chosen=page.locator('[data-tree-file="client/components/item-084.ts"]');
  await chosen.waitFor();
  await page.waitForTimeout(500);
  assert.equal(await chosen.evaluate(el=>{const r=el.getBoundingClientRect();const parent=el.closest('.sidebar-scroll')!.getBoundingClientRect();return r.top>=parent.top&&r.bottom<=parent.bottom;}),true);
  assert.equal(await chosen.evaluate(el=>document.activeElement===el),true);
  await page.locator('#language-button').click();
  await page.getByRole('heading',{name:'代码与运行地图',exact:true}).waitFor();
  await page.locator('#tab-updates').click();
  await page.locator('[data-node="editor"]').click();
  await page.waitForTimeout(250);assert.equal(await page.locator('.toast').count(),0);await page.screenshot({path:'artifacts/canvas-zh.png',fullPage:true});
  await page.locator('#tab-journeys').click();
  await page.locator('[data-step]').first().waitFor();
  await page.locator('[data-step]').first().click();
  await page.locator('#dev-board-open').click();
  await page.locator('#board-new-task').click();
  await page.locator('#task-title').fill('Preserve note draft');
  await page.locator('#task-description').fill('Keep entered note content when save fails.');
  await page.locator('#task-criteria').fill('Failed save keeps draft\nRetry succeeds once');
  await page.getByRole('button',{name:'创建任务',exact:true}).click();
  await page.locator('.parallel-card').filter({hasText:'Preserve note draft'}).waitFor();
  await page.locator('.toast').evaluateAll(els=>els.forEach(el=>el.remove()));await page.screenshot({path:'artifacts/tasks-zh.png',fullPage:true});
  await page.locator('#settings-button').click();
  await page.locator('#settings-form').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('#dev-map-open').click();
  const before=await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform);
  await page.locator('#zoom-in').click();
  const zoomed=await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform);
  assert.notEqual(before,zoomed);
  await instance.runtime.scan(true);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#world').evaluate(el=>(el as HTMLElement).style.transform),zoomed);
  assert.deepEqual(failures,[]);
  console.log('Browser smoke passed: original canvas/sidebar, journeys, parallel dependency groups, task creation, bilingual UI, exact file auto-scroll/focus, viewport retention.');
} finally {
  await browser.close();
  instance.close();
  await new Promise((r) => setTimeout(r, 50));
  fs.rmSync(temp, { recursive: true, force: true });
}
