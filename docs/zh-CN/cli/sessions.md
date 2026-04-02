---
read_when:
  - 你想列出已存储的会话并查看近期活动
summary: "`openclaw sessions`（列出已存储的会话及使用情况）的 CLI 参考"
title: sessions
x-i18n:
  generated_at: "2026-02-01T20:21:25Z"
  model: claude-opus-4-5
  provider: pi
  source_hash: d8866ef166c0dea5e8d691bb62171298694935ae0771a46fada537774dadfb32
  source_path: cli/sessions.md
  workflow: 14
---

# `openclaw sessions`

列出已存储的对话会话。

```bash
openclaw sessions
openclaw sessions --agent work
openclaw sessions --all-agents
openclaw sessions --active 120
openclaw sessions --json
openclaw sessions summary
openclaw sessions summary --all-agents --recent 3
```

范围选择：

- 默认：使用已配置的默认智能体会话存储
- `--agent <id>`：查看单个已配置智能体
- `--all-agents`：聚合所有已配置智能体
- `--store <path>`：直接指定 `sessions.json` 路径

## 汇总概览

`openclaw sessions summary` 会给出一个轻量聚合视图，适合快速看最近哪些会话活跃：

```bash
openclaw sessions summary
openclaw sessions summary --agent work
openclaw sessions summary --all-agents
openclaw sessions summary --active 60
openclaw sessions summary --recent 3
openclaw sessions summary --json
```

它会展示：

- 当前范围内的总会话数
- `1h` / `24h` / `7d` 活跃度
- Top models、Top agents、会话类型分布
- 已知 token 用量与估算成本（如果会话元数据里有）
- 最近若干个会话的简短预览

`openclaw status` 现在也会带一个更短的会话概览；如果你要看完整 breakdown，用 `openclaw sessions summary`。

## 清理维护

立即执行会话存储维护：

```bash
openclaw sessions cleanup --dry-run
openclaw sessions cleanup --agent work --dry-run
openclaw sessions cleanup --all-agents --dry-run
openclaw sessions cleanup --enforce
openclaw sessions cleanup --json
```

相关：

- Session 配置：[配置参考](/gateway/configuration-reference#session)
- 状态概览：[CLI status](/cli/status)
