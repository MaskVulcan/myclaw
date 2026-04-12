---
read_when:
  - 你要快速判断当前知识环主线已经做到哪里
  - 你要继续沿着 Hermes 提到的 4 个高价值点往下扩展
  - 你需要知道哪些边界已经收口，哪些只是后续可选增强
summary: review nudge / session search / skill 聚类 / USER.md 建模四条主线的当前收敛状态
title: 知识环收敛
---

# 知识环收敛

## 当前主线

现在的知识环已经收口到一条统一主线：

1. `knowledge review`
   - compaction 后写轻量 review nudge
   - session 结束时写确定性 review record
2. `session search`
   - 复用 memory runtime，只搜 `sessions` source
   - 搜索结果按 session 聚合，并用 review record enrich
3. `skill automation`
   - steward ingest 优先消费 review 里的 automation signals
   - review 驱动路径使用 workflow fingerprint 做稳定聚类
   - 没有 review 的 fallback 路径仍按 slug 聚类，不强行现算 fingerprint
4. `USER.md`
   - review record 聚合成 machine-managed profile block
   - 只替换托管块，保留用户自由文本

## 已经确定的架构边界

- `workspace/.openclaw/knowledge/reviews/*.json`
  - 是 review、session search、skill 聚类、USER.md 建模的共享事实源
- `session search`
  - 不引入第二套检索底座
  - 底层仍是 memory runtime / `MemorySearchManager`
- `workflow fingerprint`
  - 只在 review 驱动路径作为稳定工作流键使用
  - transcript fallback 不把临时启发式误当成稳定身份
- `USER.md`
  - 不是自由重写
  - 只维护 `openclaw:user-profile` 托管块

## 为什么这样收口

- 背景 review 是最上游的静默知识积累点，后续能力应该优先吃 review，而不是各自重复扫 transcript。
- session search 应该复用现有 memory runtime，这样索引、source filter、搜索策略只维护一套。
- skill 自动创建需要稳定工作流键；这个键必须来自 review 的结构化 automation signals，而不是每次临时猜。
- 用户建模不能粗暴改写 `USER.md`，否则会把人工维护内容冲掉。

## 后续可选增强

- session search 的跨 agent 查询策略可以继续细化，但前提是 visibility / a2a policy 更明确。
- workflow fingerprint 还可以继续引入更细的命令族归一化，但不应该回到“任何 transcript fallback 都强绑 fingerprint”。
- `USER.md` 后续可以加 pin / suppress / decay 机制，但托管块边界不要变。
