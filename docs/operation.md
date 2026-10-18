# Operation and analysis / 运行与分析

Run commands from the Nativue checkout, or use the installed `nativue` executable. Replace the example workspace with the selected project. For another working directory, resolve `bin/nativue.js` to an absolute path first.

在 Nativue 仓库执行以下命令，或使用安装后的 `nativue`。示例工作区需替换为选定项目；在其他目录调用时，先将 CLI 路径解析为绝对路径。

```sh
node bin/nativue.js init /path/to/workspace --tool codex --language en --mode manual
node bin/nativue.js serve /path/to/workspace --port 4317
node bin/nativue.js doctor /path/to/workspace
node bin/nativue.js scan /path/to/workspace
node bin/nativue.js analyze /path/to/workspace
node bin/nativue.js import-analysis /path/to/workspace/.nativue/response.json /path/to/workspace
node bin/nativue.js check /path/to/workspace
node bin/nativue.js sync /path/to/workspace
node bin/nativue.js stop /path/to/workspace
```

## Enable a host CLI bridge / 启用宿主 CLI 桥接

```sh
node bin/nativue.js configure-runner codex /path/to/workspace
# Alternative / 或者：
node bin/nativue.js configure-runner claude /path/to/workspace
# Stop future background model runs / 停止后续后台模型调用：
node bin/nativue.js configure-runner off /path/to/workspace
```

Choose one bridge after installing and authenticating that host's CLI. This explicitly enables future model calls while the service runs, using your host account, model selection and usage limits. The bridge passes selected source as data to an isolated temporary directory. The included Codex bridge requests a read-only ephemeral session; the Claude bridge disables tools and session persistence. Treat these as implemented adapters, not proof of live compatibility with every installed version.

安装并登录宿主 CLI 后选择一个桥接。此操作明确启用服务运行期间的后续模型调用，使用宿主账户、模型选择与额度。桥接将选定源码作为数据传入临时隔离目录；Codex 请求只读临时会话，Claude 禁用工具及会话持久化。这些是已实现的适配器，不代表每个安装版本都已实测兼容。

Each bridge packet contains up to 160 files and roughly 1.5 MB of source, prioritizing changed files. Larger repositories may need interactive analysis to inspect omitted modules. Keep unsupplied relationships inferred or retain existing evidence; never invent full coverage. Without an installed/authenticated host, the previous graph remains available and the failed analysis is visible.

每次桥接最多提供 160 个文件、约 1.5 MB 源码，优先变化文件。大仓库可能需要交互式分析补充遗漏模块；未提供源码的关系保留推断状态或已有证据，不能假装已覆盖全部。宿主未安装或未登录时保留旧图，并显示分析失败。

## Incremental updates / 增量更新

The running service debounces changes for 10 seconds and reconciles every 60 seconds by default. Semantic analysis is serialized per workspace, with a default minimum interval of 5 minutes and a configurable daily call limit. No source changes means no new analysis call. Task events refresh the board without requiring architecture analysis.

服务默认合并连续 10 秒内的修改，每 60 秒检查遗漏。每个工作区的语义分析串行运行，默认最短间隔 5 分钟，每日调用上限可配置；源码无变化不发起分析。任务事件直接刷新看板，无需架构分析。

Without an enabled adapter, `analyze` writes an analysis request for a session agent. See [the analysis protocol](../skills/nativue/references/analysis.md). For unattended updates, configure `.nativue/config.json` with `analysis.enabled`, an executable argument array in `analysis.command`, `minIntervalMs`, and `maxCallsPerDay`. Use a command you trust and have tested. Nativue supplies JSON on stdin and expects exact response JSON on stdout; no shell expansion occurs. The selected provider's permissions, costs and data policy apply.

未启用适配器时，`analyze` 生成分析请求，由会话 Agent 处理，详见[分析协议](../skills/nativue/references/analysis.md)。无人值守更新需在本地配置中设置 `analysis.enabled`、命令参数数组 `analysis.command`、`minIntervalMs` 和 `maxCallsPerDay`。命令必须由用户选择并验证；stdin 接收 JSON，stdout 输出完整响应 JSON，不执行 shell 展开。模型提供商的权限、费用和数据政策仍然适用。

Failed analysis preserves the last valid graph and marks it pending, stale, or failed. A response created for an older source input is rejected. The dashboard exposes source version, update state, changed files and analysis call count. A reload is not proof of semantic refresh. Keep user layout separate from generated data.

分析失败保留上一有效图，并标记待处理、过期或失败。旧源码输入生成的响应会被拒绝；界面显示版本、状态、变化文件及调用次数。页面刷新不代表语义刷新，布局不应被生成内容覆盖。

## Optional remote source / 可选远端来源

```sh
node bin/nativue.js init /path/to/workspace --github https://github.com/example/fictional-store.git --branch main
```

The URL above is fictional. This candidate supports public GitHub HTTPS repositories. Private remote authentication is not implemented, and credentials must not be put in the URL. The default poll interval is 5 minutes, with failure backoff. Remote analysis is cached separately and has its own provenance. Never infer that your local runtime matches the remote graph. Review `.nativue/config.json` to disable remote sync or change its interval.

上述地址是虚构示例。本候选版支持公开 GitHub HTTPS 仓库，私有远端认证尚未实现，请勿将凭证写进 URL。默认每 5 分钟轮询，失败后退避。远端分析独立缓存，来源版本单独显示，不能据此推断本地运行版本一致。可在本地配置关闭同步或修改间隔。

```sh
node bin/nativue.js sync /path/to/workspace
node bin/nativue.js analyze /path/to/workspace --source remote
node bin/nativue.js import-analysis /path/to/workspace/.nativue/remote-response.json /path/to/workspace --source remote
```

Remote analysis uses `.nativue/remote-analysis-request.json`. Read evidence from its isolated remote checkout, not from the local worktree. Keep the source kind and input ID when importing. / 远端分析使用 `.nativue/remote-analysis-request.json`，从独立远端缓存读取证据，不用本地文件冒充；导入时保留来源及输入版本。

## Import public Issues / 导入公开 Issue

```sh
node bin/nativue.js issues /path/to/workspace
```

With remote sync configured, this reads up to 500 open public GitHub Issues, excludes pull requests, and creates missing tasks at `todo`. Existing task records are preserved. Exact case-insensitive P0/P1/P2 labels set priority; unmatched labels default to P2. It does not invent acceptance criteria or start development. A must confirm scope and criteria before B begins. Custom label mapping, authenticated private Issues and remote writeback are not implemented in this candidate. GitHub API limits can interrupt import; retry preserves already imported tasks.

配置远端后，最多读取 500 个公开仓库未关闭 Issue，排除 PR，新增缺失的 `todo` 任务并保留已有任务。P0/P1/P2 标签忽略大小写匹配，其他默认 P2。不生成虚假验收标准，也不自动开始开发；B 开始前由 A 确认范围和标准。本候选版尚未实现自定义标签映射、私有 Issue 认证及远端回写。GitHub API 限流可能中断导入，重试保留已导入任务。

## Task writes / 任务写入

```sh
node bin/nativue.js task /path/to/task.json /path/to/workspace --revision 0 --actor A
node bin/nativue.js handoff B T-1 --workspace /path/to/workspace
```

Use the current ledger revision, not the illustrative `0`. Updates are atomic and reject obsolete revisions. Reload on conflict, reconcile only your assigned task, and retry. Full task types are maintained in `src/types.ts`; acceptance rules are enforced by the CLI. Do not bypass them with direct JSON edits. See [the role contract](../skills/nativue/references/roles.md).

版本号使用当前台账 revision，而非照抄示例 `0`。写入原子化，过期版本会被拒绝；冲突时重新读取，只协调自己负责的任务后再提交。完整类型维护在 `src/types.ts`，验收门槛由 CLI 校验，不直接编辑 JSON 绕过。详见[角色契约](../skills/nativue/references/roles.md)。
