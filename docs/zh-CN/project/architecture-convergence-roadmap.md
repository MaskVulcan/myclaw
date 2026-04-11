---
read_when:
  - 你要继续梳理 `myclaw` / `Hermes` / `OpenHarness` 的架构收敛
  - 你要知道各阶段先做什么、不做什么
  - 你要把后续实现挂到稳定边界上
summary: `myclaw` 吸收 `Hermes` / `OpenHarness` 的渐进式架构收敛路线图
title: 架构收敛路线图
---

# 架构收敛路线图

## 总体判断

- `myclaw` 的强项不是单纯 agent loop，而是：
  - `gateway / control-plane`
  - plugin capability ownership
  - manifest-first discovery
  - 已有的 skills / subagents / memory / steward 基础设施
- 所以后续路线不是“改造成 Hermes”或“改造成 OpenHarness”。
- 正确方向是：
  - 保住 `gateway-first`
  - 把运行时边界收口成更薄的 `AgentKernel`
  - 借鉴 `Hermes` 的 lifecycle
  - 借鉴 `OpenHarness` 的 worktree isolation 和轻量 policy layer

## 必须保留的核心

- 保留单一长生命周期 `Gateway` 和统一 WS 控制面。
- 保留插件的 capability ownership，不退回成“简单 tool registry”。
- 保留 manifest-first 的发现、启用、校验、运行时装载、surface consumption 分层。
- 保留现有 skills precedence、capability-first disclosure、subagent orchestration。
- 不把现有 `memory`、`steward`、`hooks` 说成缺失能力；后续要做的是收口和闭环。

## 从 Hermes 吸收什么

- 显式 `AgentKernel` 边界：
  - 让 Pi 先作为第一个 backend，避免 runtime 细节继续泄漏到上层。
- 显式 `MemoryProvider` lifecycle：
  - `initialize`
  - `system_prompt_block`
  - `prefetch`
  - `sync_turn`
  - `on_pre_compaction`
  - `on_delegation`
  - `shutdown`
- 把 learning / steward / capability promotion 变成更明确的 runtime 闭环。

## 从 OpenHarness 吸收什么

- 更薄的 kernel 组合方式：
  - `api client + tool surface + permission + hooks + prompt`
- subagent 的 `git worktree` 隔离。
- 更轻的 policy / ops / audit hook surface。
- 默认内建的敏感路径和高风险命令防护。

## 目标架构

- 控制面：
  - `Gateway / WS / channels / nodes`
- 运行时内核：
  - `AgentKernel`
- 扩展面：
  - `plugins / capabilities / skills / hooks`
- 记忆面：
  - `memory provider / steward / knowledge loop`
- 隔离与策略面：
  - `sandbox / worktree / permissions / ops hooks`

## 分阶段路线

### Phase 0: 统一边界和术语

- 目标：
  - 明确 `Gateway`、`AgentKernel`、`CapabilityRuntime`、`MemoryProvider`、`StewardCycle`、`SubagentIsolation` 的归属。
- 产出：
  - 项目文档
  - ADR
  - 最小代码 facade
- 风险：
  - 不先收口术语，后续新功能会继续堆进 `pi-embedded-runner`
- 验收：
  - 新功能讨论时能明确挂到唯一边界

### Phase 1: AgentKernel 收口

- 目标：
  - 把现有 Pi runtime 包成显式 `AgentKernel` facade。
- 改动：
  - 统一 run / abort / wait / queue / lane / compaction seam
  - 先不改外部行为
- 前置依赖：
  - Phase 0
- 风险：
  - 误把现有调用链一次性全改，导致回归面过大
- 验收：
  - 至少一个主调用点和 plugin runtime 已走 `AgentKernel`
  - Pi 仍是默认 backend

### Phase 2: Subagent Worktree Isolation

- 目标：
  - 让子代理的并行修改真正隔离，而不是只隔离 session。
- 改动：
  - 给 `sessions_spawn` 增加 worktree policy
  - 增加创建、复用、清理和失败恢复语义
- 前置依赖：
  - Phase 1
- 风险：
  - 脏仓库、依赖目录共享、worktree 清理失败
- 验收：
  - 并行子代理修改同一 repo 时不互相污染

### Phase 3: MemoryProvider + Steward 闭环

- 目标：
  - 把已有 `memory + steward + capabilities` 串成显式 lifecycle。
- 改动：
  - 提升 memory plugin runtime 为 provider contract
  - 对齐 prefetch、turn sync、pre-compaction flush、subagent delegation、session end
- 当前最小切口：
  - 增加 `MemoryProviderKernel` facade，统一暴露 `systemPrompt / flushPlan / turnSync / delegation / steward / shutdown`
  - 让 `sessions_spawn` 接入 delegation prepare + spawn-failure rollback
  - 让 `knowledge-steward` session-end 收尾改走 facade，而不是散落在 hook handler
  - 让 gateway memory startup / status runtime scan / CLI shutdown 也改走 facade 的 `prefetch` / `shutdown`
- 前置依赖：
  - Phase 1
- 风险：
  - 重复写入、压缩时序错乱、group/private 语义混淆
- 验收：
  - 一次完整会话能用统一生命周期解释 memory 与 steward 的动作

### Phase 4: Lightweight Policy / Ops Layer

- 目标：
  - 在现有 plugin hooks 之上补一个轻量策略层。
- 改动：
  - 统一 permission decision
  - 内建敏感路径 denylist
  - 提供 command / http / prompt / agent 级别的轻量 hook
- 当前最小切口：
  - 增加 `PolicyKernel` facade，统一暴露 `resolveToolPolicy / applyToolPolicy / before_tool_call / node-command policy / workspace path guard`
  - 让 `pi-tools`、`pi-tool-definition-adapter`、`tools-effective-inventory` 不再各自拼 tool policy pipeline
  - 让 `gateway/tools-invoke-http`、`gateway/server-methods/nodes`、`gateway/server/ws-connection/message-handler` 改走同一策略边界
  - 底层仍复用现有 `pi-tools.policy`、`tool-policy-pipeline`、`node-command-policy`、plugin hook runtime，不重写实现
- 本阶段明确暂不做：
  - 不新造第二套 hook runtime
  - 不重写 sandbox/path policy 内核
  - 不把 prompt / audit / security DSL 一次性做成重框架
- 前置依赖：
  - Phase 1
- 风险：
  - 和现有 plugin hooks 职责重叠
- 验收：
  - 工具权限、HTTP invoke、node command allowlist 至少有一条共享 runtime 边界
  - 策略和审计类需求不需要先写完整插件

### Phase 5: Execution Backend 抽象，可选

- 目标：
  - 仅在明确要做 remote / cloud / VPS runtime 时再抽象 execution backend。
- 改动：
  - local / docker / ssh / remote backend 抽象
- 前置依赖：
  - Phase 1 完成且产品方向明确
- 风险：
  - 过早抽象，把系统做空
- 验收：
  - 如果没明确需求，这一阶段可以长期不启动

## 90 天建议顺序

1. 第 1-14 天：
   - 完成 Phase 0
   - 落 ADR、边界图、收敛路线图
2. 第 15-40 天：
   - 完成 Phase 1 的最小切口
   - 引入 `AgentKernel` facade
   - 让至少一个主调用点和 plugin runtime 改走 facade
3. 第 41-60 天：
   - 完成 subagent `worktree` 隔离最小版
4. 第 61-85 天：
   - 完成 memory provider lifecycle 和 steward cycle 收口
5. 第 86-90 天：
   - 补最小策略层

## 反目标

- 不重写 `Gateway`
- 不削弱插件 capability ownership
- 不把所有新能力继续直接堆进 `pi-embedded-runner`
- 不在没有产品方向前就做重型 multi-backend execution 抽象
- 不把“规划中的能力”写成“已经在运行态生效”
