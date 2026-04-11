---
read_when:
  - 你想知道项目级设计/路线图/TODO/边界/注意项分别看哪里
  - 你不想再把这些内容散落在 diagnostics 里
summary: 项目级文档索引
title: 项目文档索引
---

# 项目文档索引

这个目录用于放项目级、持续维护的内部文档。

和 `docs/zh-CN/diagnostics/` 的区别：

- `diagnostics/`
  - 更偏排障、阶段性分析、一次性调查记录
- `project/`
  - 更偏长期维护的当前设计、路线图、待办、边界、决策、注意项

当前文件分工：

- `design.md`
  - 当前稳定设计
- `roadmap.md`
  - 分阶段路线图
- `architecture-convergence-roadmap.md`
  - `myclaw` 吸收 `Hermes` / `OpenHarness` 的架构收敛主线
- `todo.md`
  - 还没做但明确值得做的项
- `boundaries.md`
  - 当前设计边界、非目标、不要做的事
- `notes.md`
  - 环境/运行/维护注意项
- `weixin-plugin-maintenance.md`
  - 微信外置插件的维护事实、故障判定和回放流程
- `capability-first-skills.md`
  - skill / capability / steward 分层和阶段计划
- `decisions.md`
  - 已采纳决策与原因

当前主线参考：

- 微信私聊隔离与记忆策略：
  - `/root/gitsource/myclaw/docs/zh-CN/diagnostics/weixin-isolation-memory-policy-2026-03-31.md`
- 微信多阶段路由设计记录：
  - `/root/gitsource/myclaw/docs/zh-CN/diagnostics/weixin-multi-stage-routing-2026-03-29.md`
- 微信 prompt slimming 记录：
  - `/root/gitsource/myclaw/docs/zh-CN/diagnostics/weixin-prompt-slimming-2026-03-29.md`
- 微信 Codex/ACP 任务路由记录：
  - `/root/gitsource/myclaw/docs/zh-CN/diagnostics/weixin-task-routing-codex-acp-2026-03-30.md`
- 微信插件本地备份与回放说明：
  - `/root/gitsource/myclaw/docs/zh-CN/diagnostics/weixin-extension-local-backup-2026-04-03.md`
