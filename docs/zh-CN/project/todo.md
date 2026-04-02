---
read_when:
  - 你要找后续明确待办
  - 你要知道哪些事只是记着，哪些事还没做
summary: 当前待办列表
title: 待办
---

# 待办

## P1

- [ ] 给微信 light recall 增加低噪音命中日志
- [ ] 给微信 scoped memory 增加更明确的真实场景回归样例
- [ ] 验证用户专属偏好是否稳定写入 scoped memory，而不是误写到共享 `MEMORY.md`

## P2

- [ ] 评估是否启用 `builtin` FTS-only memory search
- [ ] 如果启用，确认它对当前时延和内存的实际影响
- [ ] 设计 scoped memory 是否需要进入正式检索链路

## P3

- [ ] 条件允许时评估本地 `qmd`
- [ ] 如果上 `qmd`，先补环境前置检查：
  - `qmd`
  - `bun`
  - SQLite 扩展能力
- [ ] 如果未来再上 embedding provider，先做成本、时延、稳定性评估

## 已记录但不急

- [ ] 正式 recall backend 增强
  - 当前先不做
  - 后续优先顺序：
    - `builtin` FTS-only
    - `qmd`
    - 外部 embeddings
