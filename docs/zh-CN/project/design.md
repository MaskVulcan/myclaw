---
read_when:
  - 你想快速理解当前主线设计
  - 你准备继续改微信接入、记忆、上下文或路由
summary: 当前项目稳定设计
title: 当前设计
---

# 当前设计

## 目标

- 继续走 `myclaw` 源码安装与自控改造。
- 微信私聊优先保证：
  - 用户粒度隔离
  - prompt 尽量薄
  - 响应时延可控
  - 必要历史尽量能补到

## 当前已落地设计

### 1. 微信私聊 session 隔离

- 使用：
  - `session.dmScope = "per-account-channel-peer"`
- 含义：
  - 每个「微信 bot 账号 + 微信用户」独立 session
- 目标：
  - 避免多个微信用户共用一个 DM 上下文

### 2. 当前消息与引用上下文拆分

- 当前消息正文保持干净
- 引用消息不再直接拼进正文
- 引用内容通过独立上下文块注入

### 3. 短期历史窗口

- 微信私聊默认：
  - `channels.openclaw-weixin.dmHistoryLimit = 8`
- 只带最近有限用户轮次，避免 prompt 无限变大

### 4. 轻量旧历史召回

- 仅微信私聊启用
- 只扫描 transcript 尾部有限窗口
- 只从 active history window 之外补最多少量旧片段
- 当前是低成本词面召回，不是完整语义召回

### 5. 微信私聊 scoped memory

- 对微信 direct session：
  - 不再默认自动注入共享 `MEMORY.md`
  - 改为自动注入用户专属长期记忆文件：
    - `.openclaw/weixin-dm-memory/<accountId>/<peerId>.md`
- 用途：
  - 只存当前微信用户自己的偏好、默认方式、长期跟进事项
- 目标：
  - 把“用户粒度隔离”补到长期记忆层，而不只是 transcript 层

### 6. 共享长期记忆与用户专属记忆分层

- 共享信息：
  - `MEMORY.md`
  - `memory/YYYY-MM-DD.md`
- 用户专属微信信息：
  - `.openclaw/weixin-dm-memory/<accountId>/<peerId>.md`

## 当前不依赖的能力

- 还没有把微信历史接到正式 recall backend
- 还没有依赖 QMD
- 还没有依赖外部 embedding provider 做强语义召回

## 当前设计原则

- 先隔离，再补召回
- 先控 prompt 体积，再追求更强 recall
- 先做便宜、稳定、可维护的层
- 重能力的检索后端后置
