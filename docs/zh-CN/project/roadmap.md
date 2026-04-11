---
read_when:
  - 你想知道后面按什么顺序继续做
  - 你要区分已完成、近期、远期
summary: 当前主线路线图
title: 路线图
---

# 路线图

## 当前新增主线

- 架构收敛主线已单独落盘：
  - `docs/zh-CN/project/architecture-convergence-roadmap.md`
- 这条主线的原则是：
  - 保留 `gateway / control-plane`
  - 保留插件 capability ownership
  - 不重写现有 skills / subagents / memory
  - 先做 `AgentKernel` 收口
  - 再做 subagent `worktree` 隔离
  - 再把 `memory + steward + capabilities` 串成显式闭环

## 已完成

- 微信私聊 session 按用户隔离
- 微信引用消息从正文拆出
- 微信短期 history window 收紧
- 微信同 session transcript 轻召回补层
- 微信私聊 scoped memory 自动注入
- memory prompt 增加 scoped memory 使用提示
- capability registry + `openclaw capabilities` CLI
- skill capability-first 渐进暴露
- steward promote 自动生成 capability-first skill 模板

## 近期

- 增加微信 recall 命中/未命中的低噪音观测
- 增加 scoped memory 的使用与写入回归测试样例
- 持续验证真实微信场景下：
  - 最近历史命中
  - 引用上下文命中
  - 窗口外旧事召回命中
- 扩 capability registry 覆盖面，把高频稳定脚本/CLI 能力继续纳入
- 给 steward 的“skill 还是 capability/CLI”升级判断补更明确阈值

## 中期

- 评估是否启用 `builtin` 的 FTS-only memory search
- 评估是否需要把微信 scoped memory 纳入正式检索路径
- 评估是否需要按触发条件自动做更强的历史检索
- 补 capability 的确认策略、运行审计和失败归因
- 把能力发现闭环接得更紧，让 steward 更稳定地推动 skill/CLI 沉淀

## 远期

- 如果 FTS-only 不够，再评估本地 `qmd`
- 如果本地 `qmd` 仍不够，再评估外部 embedding provider
- 如果要做更强 recall，优先保持：
  - 不默认把大段历史塞回 prompt
  - 检索按需触发
  - 多用户隔离不退化
- 如果未来 CLI 能力规模明显膨胀，再重新评估是否需要更重的管理框架

## Recall Backend 改进顺序

1. `builtin` FTS-only
2. 本地 `qmd`
3. 外部 embedding provider

这个顺序的原因：

- 先低成本验证是否真的需要更强 recall
- 先避免引入更重的常驻资源与维护复杂度
- 先让系统保持可控
