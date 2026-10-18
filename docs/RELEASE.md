# Release candidate checklist / 发行候选检查

This checkout is a local source candidate. This document does not claim that a public repository, npm release, domain, or hosted service has been created. Package-name and domain availability must be checked when publishing.

当前为本地源码候选版，尚不代表已创建公开仓库、发布 npm、注册域名或部署服务。实际发行时再核查包名与域名可用性。

## Verify the candidate / 验证候选版

- [ ] Use a clean clone with Node.js 24+; run `npm install`, `npm run check`, and `npm run pack:check`.
- [ ] Initialize fictional frontend, backend, mixed-language and multiple-repository workspaces without running their scripts.
- [ ] Exercise source add/delete/rename, failed analysis, stale response rejection, no-adapter queueing, and server restart.
- [ ] Exercise opt-in remote updates against a local test remote; confirm dirty local changes remain intact.
- [ ] Exercise task ownership, stale ledger revision rejection, B/C independence, failed review and rework, integration review, and actual user acceptance.
- [ ] Check English/Chinese copy, file-tree reveal/scroll, keyboard focus, multiple source references, and layout persistence.
- [ ] Validate the portable Skill and all its references; record host tests separately from local automated tests.

对应检查：干净克隆、虚构仓库初始化、文件增删改名、过期分析、远端隔离、台账冲突、独立验收、集成复验、真实用户确认、中英文交互及 Skill 引用。宿主实测与本地自动测试分别记录。

## Inspect publication contents / 检查公开内容

- [ ] Inspect `npm pack --dry-run --json`, then extract the actual candidate archive and review the included file list.
- [ ] Check source, examples, generated bundles, images, SVG text, metadata, source maps and lockfile for private repository names, personal absolute paths, credentials, logs, remote URLs and unintended source content.
- [ ] Use generic secret scanning plus a local-only list of private terms. Keep that list and scan output outside the published repository and archive.
- [ ] Confirm that only approved publisher attribution appears: **SienGe AI Lab**, Xiaohongshu **SienGe的AI实验室**. Do not include private contributor identity or project history by default.
- [ ] Review the complete Git history before first publication, not only current files. No private repository history should be imported.
- [ ] Verify MIT notices and licenses for included dependencies and any borrowed assets. The pain-point illustrations in this project are original SVGs.
- [ ] Keep `.nativue`, target-workspace snapshots, credentials, review artifacts and local caches out of distribution.
- [ ] Confirm the compatibility matrix describes measured capabilities and explicitly identifies anything still unverified.

检查实际发行包及完整 Git 历史，覆盖文本、图片、元数据、打包产物和源码映射；私人关键词清单只保留本地，不随仓库公开。公开署名仅包括已授权团队和账号。生成状态、凭证、私有源码和运行缓存不进入发行包。

## Publish only as an explicit step / 明确执行发布

After review, select the public owner/repository and available package name, create the public remote, then publish the approved version and release notes. Those are separate actions from preparing this candidate. Link a domain only after ownership is confirmed. Include known limitations and measured compatibility in release notes.

审阅后再确定公开仓库主体与可用包名，创建远端、推送并发布通过检查的版本。准备候选版不等于完成上述操作；域名确认所有权后再添加。发行说明保留真实兼容状态和已知限制。
