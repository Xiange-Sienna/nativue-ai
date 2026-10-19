# Independent acceptance / 独立验收

| Field / 项目 | Evidence / 记录 |
| --- | --- |
| Tested product commit / 实测产品提交 | `0a3014e6fcb786e4e6ae66395fa63bb0a1955ccb` |
| Review date / 验收日期 | 2026-10-18 |
| Reviewer / 验收角色 | Independent C session; did not implement or modify product code / 独立 C 会话，未实现或修改产品代码 |
| Environment / 环境 | macOS arm64; Node.js 24.22.0; Playwright with the installed Chrome channel |
| Starting state / 开始状态 | Exact commit verified; Git working tree clean / 已核对准确提交，Git 工作区干净 |
| Result / 结论 | PASS for the tested local source candidate; user acceptance pending / 已测试的本地源码候选版通过，用户手测待确认 |

This report records tests of the product commit above. Adding or committing this evidence file does not change the product version that was exercised. The reviewer wrote only this report; test output and fictional runtime fixtures were generated separately.

本报告对应上方产品提交。添加或提交本证据文件不改变已测试的产品版本。验收者仅编写本报告，测试输出及虚构运行样例单独生成。

## README walkthrough follow-up / README 演示补充

On 2026-10-19, commit `a998d2f6781ecc7754bc1ee113e5a61b36f72c2a` added a reproducible bilingual README walkthrough built from the existing interface. Its fictional Orbit Desk fixture contains 15 modules, 18 relationships, three journeys and nine dependency-grouped tasks. Ten screenshots separately demonstrate architecture, journeys, parallel tasks, exact file location and source versions in English and Simplified Chinese. The only product-label change adds the existing architecture kind `infrastructure` to the bilingual group-title map; it does not alter the canvas layout or workflow.

2026-10-19 的提交 `a998d2f6781ecc7754bc1ee113e5a61b36f72c2a` 使用现有界面增加了可重复生成的中英文 README 演示。虚构 Orbit Desk 样例包含 15 个模块、18 条关系、3 条旅程和 9 个按依赖分组的任务；10 张截图分别展示中英文架构图、用户旅程、并行任务、精确文件定位和来源版本。唯一的产品文案改动是在既有架构类型标题映射中补充 `infrastructure` 的中英文名称，未改变画布布局或工作流。

Maintenance verification passed `npm run docs:screenshots`, all 19 automated tests, `npm run test:browser`, link/file checks and `npm run pack:check`. The current package contains 46 files. This follow-up is maintainer verification, not a replacement for the independent C result above, and user acceptance remains pending.

维护验证已通过 `npm run docs:screenshots`、全部 19 项自动测试、`npm run test:browser`、链接与文件检查及 `npm run pack:check`；当前发行包包含 46 个文件。本补充属于维护者验证，不替代上方独立 C 结论，用户手测仍待确认。

## Executed checks / 已执行检查

| Check / 检查 | Observed result / 实际结果 |
| --- | --- |
| `npm run check` | PASS: TypeScript validation, browser bundle generation, and all 19 automated tests / 类型检查、前端打包及全部 19 项测试通过 |
| `npm run test:browser` | PASS using a temporary fictional repository and headless Chrome; no page errors / 临时虚构仓库与无头 Chrome 测试通过，无页面错误 |
| `npm run pack:check` | PASS: 34 files in the product archive / 产品发行包包含 34 个文件 |
| Actual `npm pack`, archive extraction, packaged CLI initialization | PASS without `node_modules`; initialized a separate fictional project, left its scripts unexecuted, excluded its `.env`, and queued semantic analysis / 解包后无需开发依赖即可初始化虚构项目，未执行项目脚本，排除 `.env` 并生成语义分析请求 |
| Additional dependency regression fixture | PASS: an accepted prerequisite can return to rework; its active dependent cannot advance to review until the prerequisite passes again / 已通过的前置任务可返工，其进行中的依赖任务在前置任务重新通过前不能提交验收 |
| Source/package privacy inspection | Targeted private-path, private-repository-name and credential-pattern searches found no matches. Archive inspection found no generated workspace state, browser artifacts or dependencies / 定向私人路径、私人仓库名及凭证特征检查无匹配；包内无工作区状态、浏览器产物或依赖目录 |
| Version verification after tests | Same product SHA; Git working tree remained clean before writing this report / 测试后提交未变，编写报告前 Git 工作区仍干净 |

The extracted product archive, before adding this report, had SHA-1 `6cac429b84d2757bb886aef1294e2e9a16c189b5`. Its test project and archive were removed after inspection.

添加本报告前，实测产品包的 SHA-1 为 `6cac429b84d2757bb886aef1294e2e9a16c189b5`。检查完成后已清理临时发行包及样例项目。

The automated suite exercised source exclusions and symlinks, Git ignore rules, import observations, stable source IDs, bounded evidence and line references, stale-result rejection, preservation of semantics after failed analysis, task revision conflicts and independent review/version/user gates, public Issue import behavior, shared analysis serialization and daily budgets, and cancellation of an active analysis during shutdown. Shutdown coverage also checks that a queued scan continuation cannot start another analysis after closing.

自动测试覆盖源码排除与符号链接、Git 忽略规则、导入关系与稳定版本标识、证据及行号范围、过期结果拒绝、分析失败后保留语义图、任务版本冲突及独立验收／版本／用户门槛、公开 Issue 导入、跨运行实例分析串行及每日额度，以及关闭时取消活动分析并阻止排队扫描再次触发分析。

## Browser and visual evidence / 浏览器与视觉证据

The browser test selected a module, switched between the update, journey and folder tabs, cleared an existing file filter through source navigation, and selected the last of 86 module references through the previous-reference control. It asserted that the exact `client/components/item-084.ts` leaf was visible inside the scrolling sidebar and held keyboard focus. It also created a task, opened settings, switched languages and verified zoom retention after a runtime refresh.

浏览器测试选择模块并切换更新、旅程和文件夹页签，通过源码导航清除已有筛选，并用上一引用按钮定位到该模块 86 个引用中的最后一个。断言精确的 `client/components/item-084.ts` 文件叶节点出现在侧栏可视范围内并获得键盘焦点；另覆盖新建任务、设置、中英文切换及刷新后缩放保留。

The reviewer visually inspected the freshly generated `artifacts/canvas-zh.png` and `artifacts/tasks-zh.png`. The screenshots show the restored dotted canvas, colored module groups, source-backed module details in the fixed right sidebar, and dependency-group task cards. No visible clipping or overlap was observed at the tested 1440 × 1000 viewport. This is a visual review of the restored layout, not a pixel-difference certification against an archived reference. Screenshots remain ignored local artifacts containing fictional data.

验收者查看了本次生成的 `artifacts/canvas-zh.png` 与 `artifacts/tasks-zh.png`：已恢复点阵画布、彩色模块分组、右侧固定详情栏和按依赖分组的任务卡片。1440 × 1000 测试视口未观察到明显裁切或重叠。本项为恢复布局的视觉检查，未声称与历史参考图逐像素一致。截图仅含虚构数据，作为忽略的本地产物保留。

## Limits and pending acceptance / 局限与待确认项

- The narrow real Codex background-analysis result in [compatibility](compatibility.md) was inspected as an implementation-owner record; C did not rerun that live provider call. It records `codex-cli 0.162.0-alpha.17.2` on a fictional two-file project, producing two modules, one observed edge and one counted call. It does not establish end-to-end A/B/C delivery. / 已查看[兼容记录](compatibility.md)中的窄范围真实 Codex 后台分析证据，C 未重复调用真实提供商；该记录不等于完整 A/B/C 交付认证。
- Claude Code and WorkBuddy have no recorded live integration runs. WorkBuddy has no included headless bridge. / Claude Code 与 WorkBuddy 尚无真实接入测试记录，WorkBuddy 未附带无人值守桥接。
- Automatic native B/C delegation depends on the tools exposed by the current host session and separate agent contexts. Nativue is not a universal agent launcher or model switcher. Manual handoffs remain the documented fallback. / 原生自动 B/C 派工依赖当前宿主会话暴露的工具及独立上下文，不是通用启动器或模型切换器；缺少能力时使用手动交接。
- Authenticated private remote synchronization is unsupported. The final C run did not exercise a live public remote synchronization happy path; remote URL validation and source isolation were reviewed locally. / 尚不支持带认证的私有远端同步；本次最终 C 未实测公开远端同步成功链路，仅在本地验证 URL 约束并审查来源隔离。
- Browser coverage is one desktop Chrome viewport on macOS arm64. Other browsers, operating systems, cross-machine coordination and full live multi-agent delivery were not certified. / 浏览器覆盖为 macOS arm64 的一个桌面 Chrome 视口，未认证其他浏览器、系统、跨机器协作或完整真实多 Agent 交付。
- Actual user acceptance remains pending. This C result does not create a user acceptance record, authorize publication, or mark any user's task done. / 用户手测仍待确认；C 通过不构成用户验收，不授权发布，也不将用户任务标记为完成。
