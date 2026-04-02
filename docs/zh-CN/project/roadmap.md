---
read_when:
  - 你想知道后面按什么顺序继续做
  - 你要区分已完成、近期、远期
summary: 当前主线路线图
title: 路线图
---

# 路线图

## 已完成

- 微信私聊 session 按用户隔离
- 微信引用消息从正文拆出
- 微信短期 history window 收紧
- 微信同 session transcript 轻召回补层
- 微信私聊 scoped memory 自动注入
- memory prompt 增加 scoped memory 使用提示

## 近期

- 增加微信 recall 命中/未命中的低噪音观测
- 增加 scoped memory 的使用与写入回归测试样例
- 持续验证真实微信场景下：
  - 最近历史命中
  - 引用上下文命中
  - 窗口外旧事召回命中

## 中期

- 评估是否启用 `builtin` 的 FTS-only memory search
- 评估是否需要把微信 scoped memory 纳入正式检索路径
- 评估是否需要按触发条件自动做更强的历史检索

## 远期

- 如果 FTS-only 不够，再评估本地 `qmd`
- 如果本地 `qmd` 仍不够，再评估外部 embedding provider
- 如果要做更强 recall，优先保持：
  - 不默认把大段历史塞回 prompt
  - 检索按需触发
  - 多用户隔离不退化

## Recall Backend 改进顺序

1. `builtin` FTS-only
2. 本地 `qmd`
3. 外部 embedding provider

这个顺序的原因：

- 先低成本验证是否真的需要更强 recall
- 先避免引入更重的常驻资源与维护复杂度
- 先让系统保持可控
