# Contributing / 参与贡献

English and Simplified Chinese contributions are welcome. Read `AGENTS.md`, inspect Git status, and use fictional fixtures. Keep public examples independent of a contributor's private repositories and employer.

欢迎中英文贡献。先阅读 `AGENTS.md` 并检查 Git 状态，示例和测试数据使用虚构项目，不引入私人仓库或雇主信息。

## Development / 开发

```sh
npm install
npm run check
npm run pack:check
```

Use Node.js 24+. Test behavior that can fail: stale writes, source provenance, file bounds, independent review, and cross-task integration. For UI changes, verify both languages, keyboard use, and file navigation in a long collapsed tree. Do not commit generated workspace state.

使用 Node.js 24+。测试过期写入、来源版本、读取范围、独立验收和跨任务集成等实际行为。界面修改检查两种语言、键盘操作和长文件树定位，不提交生成的工作区状态。

## Issues and pull requests / 问题与 PR

Include the expected behavior, actual behavior, reproduction using fictional files, tool and Node versions, and relevant sanitized logs. Priority labels describe urgency; maintainers can adjust them. A PR should describe the user-visible result, evidence, and known limitations. A running process is not proof of independent acceptance.

提供预期行为、实际行为、虚构文件的复现步骤、工具和 Node 版本，以及脱敏日志。优先级标签可由维护者调整。PR 说明可观察结果、验证证据和局限；进程结束不等于独立验收通过。

## Compatibility / 兼容性

Record exact host version, environment, mode, model selection behavior, test date, and evidence before marking an integration verified. Documentation research or the presence of a CLI binary alone does not establish live compatibility. Keep capability detection conservative and manual handoff available.

将接入标为已验证前，记录宿主版本、环境、模式、模型选择行为、测试日期和证据。仅阅读官方文档或找到 CLI 不能代替实测；能力检测保守，保留手动交接。
