# Tool setup and capabilities / 工具接入与能力

Nativue ships one portable Skill plus host-specific installation routing. The shared protocol is local JSON and CLI commands. The host remains responsible for model access, permission prompts, subagent execution, and provider data settings.

Nativue 提供一份通用 Skill 及按工具区分的安装路径，共享协议为本地 JSON 与 CLI。模型访问、权限提示、子 Agent 执行及数据设置仍由宿主负责。

```sh
node bin/nativue.js install-skill codex /path/to/workspace
node bin/nativue.js install-skill claude /path/to/workspace
node bin/nativue.js install-skill workbuddy /path/to/workspace --destination /path/to/chosen/skills
```

Install for the tool you use; these are alternatives. The CLI reports the resulting path and refuses destructive replacement. For WorkBuddy, select an explicit destination supported by your installed version or load the Skill through its UI. WorkBuddy documents [Skill plugins](https://www.workbuddy.cn/docs/workbuddy/Plugins); that alone does not establish a stable headless or automatic-agent API. Claude Code documents [Skills and supporting references](https://code.claude.com/docs/en/skills).

三条命令按实际工具选一条。CLI 输出安装位置并拒绝破坏性覆盖。WorkBuddy 需指定当前安装版本支持的目录，或通过界面加载；[官方插件文档](https://www.workbuddy.cn/docs/workbuddy/Plugins)支持 Skill 类型，但不据此假设稳定的无人值守或自动子 Agent 接口。Claude Code 的 [Skills 文档](https://code.claude.com/docs/en/skills)说明入口与引用文件机制。

## Manual sessions / 独立会话

Open A, B and C yourself, load Nativue, and use the handoff command. Sessions share the same local workspace state. No model API keys or native subagent support are required by Nativue itself. Each host must still be able to read permitted files and execute the local CLI. If it cannot execute commands, the user can run them and provide the handoff.

自行打开 A、B、C，加载 Nativue 并使用交接命令。会话共享本机工作区状态，Nativue 本身不要求原生子 Agent 或模型 API 密钥；宿主仍需具备经授权读取文件与执行 CLI 的能力。无法执行命令时由用户执行并传入交接包。

## Automatic sessions / 自动会话

Automatic mode is an execution contract for A, not a universal subprocess launcher. A checks its actual exposed tools, starts separate B/C contexts only when possible, records their identities and model choices, and consumes explicit acceptance evidence. A missing host capability must produce an explanation and manual handoff, not a silent simulated review.

自动模式是 A 的执行契约，不是通用子进程启动器。A 检查实际暴露的工具，只在具备能力时创建独立 B/C 上下文，记录身份与模型选择，并读取明确验收证据。缺少能力时说明限制并提供手动交接，不能模拟独立验收。

Background analysis is separate from task delegation. An explicitly configured executable can receive and return analysis JSON without being able to create B/C agents. `doctor` reports local availability, not a certification of host behavior.

后台分析与任务派工是不同能力。配置好的命令可以收发架构 JSON，但未必能创建 B/C；`doctor` 检测本地可用信息，不代表宿主行为已认证。

The included `configure-runner codex|claude` bridges use existing host CLI authentication, a bounded source packet, and an isolated temporary directory. The first requests a read-only ephemeral Codex session; the second disables Claude tools and persistence. They do not provide an all-tool scheduler, and WorkBuddy has no included headless bridge. Enabling a bridge authorizes its future analysis calls under the configured daily cap until disabled or the service stops. See [operation](operation.md).

随附的 `configure-runner codex|claude` 使用宿主已有 CLI 登录、有大小限制的源码包及临时隔离目录；前者请求只读临时 Codex 会话，后者禁用 Claude 工具与持久化。它们不是跨工具通用调度器，WorkBuddy 尚无随附无人值守桥接。启用即允许按配置的每日上限执行后续分析，直到关闭适配器或停止服务。详见[运行说明](operation.md)。

## Live verification record / 宿主验证记录

| Field / 项目 | Recorded result / 记录 |
| --- | --- |
| Date / 日期 | 2026-10-18 |
| Environment / 环境 | macOS arm64 |
| Host / 宿主 | `codex-cli 0.162.0-alpha.17.2`, bundled with Codex extension `26.1007.21434` |
| Fixture / 样例 | Fictional two-file TypeScript repository / 虚构双文件 TypeScript 仓库 |
| Path exercised / 实测链路 | Configured Codex bridge → runtime scan → real host analysis → validated semantic import / 桥接配置、运行时扫描、真实宿主分析及校验导入 |
| Executable selection / 程序选择 | Explicit `NATIVUE_HOST_EXECUTABLE`; no personal executable path included / 显式指定环境变量，不公开个人路径 |
| Outcome / 结果 | `analysis.status = complete`; 2 semantic modules, 1 observed edge, 1 counted model call / 完成分析，2 个语义模块、1 条观察到的关系、1 次计数调用 |
| Not established / 未覆盖 | Live manual A/B/C delivery, native subagent orchestration, cross-model switching, all failure paths, and other OS versions / 手动角色交付、原生子 Agent 调度、跨模型切换、完整失败路径及其他系统版本 |

This is a narrow live background-analysis test, not end-to-end certification of Codex delivery. Claude Code and WorkBuddy have no recorded live runs. Local automated tests cover additional invariants separately and cannot establish live host behavior. Before expanding a compatibility claim, add the exact host/version, environment, mode, capability exercised, result and evidence using fictional repositories only.

以上仅验证后台架构分析链路，不代表 Codex 开发交付流程已完成端到端认证。Claude Code 和 WorkBuddy 尚无真实运行记录。本地自动测试另外覆盖状态约束，不能代替宿主行为验证。扩展兼容声明前，需以虚构仓库记录准确版本、环境、模式、实际能力、结果及证据。
