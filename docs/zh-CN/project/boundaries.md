---
read_when:
  - 你要知道现在有哪些明确边界
  - 你要避免把系统改回重 prompt、串记忆的状态
summary: 当前设计边界与非目标
title: 设计边界
---

# 设计边界

## 当前明确边界

- 不把整段微信历史全量塞回 prompt
- 不让多个微信用户共享同一 DM session
- 不让多个微信用户默认共享同一份自动注入的长期记忆文件
- 不默认启用重型 recall backend
- 不在没有必要时引入额外常驻进程或大内存后台

## 当前非目标

- 不是完整语义召回系统
- 不是“任何旧历史都保证命中”
- 不是跨所有渠道统一做最强 recall
- 不是先追求 recall 极限、再考虑时延和稳定性

## 具体约束

- 微信 scoped memory 目前只负责注入，不自动进入正式 memory search 检索链路
- 当前微信 light recall 只做同 session transcript 的轻量词面补偿
- 没有可用环境和收益证明前，不急着上：
  - `qmd`
  - 外部 embeddings

## 不要做的事

- 不要把微信用户专属偏好写回共享 `MEMORY.md`
- 不要为了解决少量 recall 漏命中就把 `dmHistoryLimit` 无限调大
- 不要把“设计规划中的能力”当成“已经在运行态生效”
