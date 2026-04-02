---
read_when:
  - 你要知道哪些决策已经定了
  - 你要避免下次又把同样的问题重新争一遍
summary: 已采纳决策记录
title: 已采纳决策
---

# 已采纳决策

## 2026-03-31

### 微信私聊按用户粒度隔离

- 决策：
  - 使用 `per-account-channel-peer`
- 原因：
  - 避免多个微信用户共享同一 DM session

### 微信短期 history 控制在小窗口

- 决策：
  - `dmHistoryLimit = 8`
- 原因：
  - 微信时延敏感
  - 先控 prompt 体积

### 微信旧历史先用轻召回补层

- 决策：
  - 先用 transcript 尾部轻量 lexical recall
- 原因：
  - 先做低成本兜底
  - 不急着上重型 recall backend

## 2026-04-01

### 微信用户专属长期记忆与共享长期记忆分层

- 决策：
  - 微信私聊默认不再自动注入共享 `MEMORY.md`
  - 改为自动注入：
    - `.openclaw/weixin-dm-memory/<accountId>/<peerId>.md`
- 原因：
  - 只做 transcript 隔离还不够
  - 长期记忆层也必须补齐用户隔离

### Recall Backend 暂不着急上线

- 决策：
  - 现在先不启用正式 recall backend 增强
- 原因：
  - 当前环境没有现成 embedding 条件
  - 也没有安装 `qmd` / `bun`
  - 先把现有轻召回和 scoped memory 跑稳

### 后续 recall backend 的优先顺序

- 决策：
  1. `builtin` FTS-only
  2. 本地 `qmd`
  3. 外部 embeddings
- 原因：
  - 从轻到重推进
  - 优先保证可控与稳定

### Codex 不可用时先降级到 Kimi CLI

- 决策：
  - 快路径优先走 `kimi-cli/k2p5`
  - 重路径走 `codex-vip/gpt-5.4`
  - Codex 失败时回退到 `kimi-cli/k2p5`
  - 不再把 `claude-cli` 作为当前主回退
- 原因：
  - 当前环境里真正可稳定走通的通用 Kimi K2.5 在 `kimi CLI` 路线
  - `api.kimi.com/coding` 即使传 `kimi-k2.5`，服务端也会回到 `kimi-for-coding`
  - `kimi --session` 已验证可复用会话
  - `claude code` 当前状态不稳定，不适合作为默认保底
