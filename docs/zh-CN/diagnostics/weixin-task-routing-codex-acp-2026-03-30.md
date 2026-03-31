# 微信任务路由改造方案：fast -> strong -> Codex ACP -> zellij

日期：2026-03-30

## 背景

当前 `myclaw` 已经落地两阶段回复：

- 第一层：`gpt-5.2 fast`
- 第二层：`gpt-5.4 strong`

这解决了“简单消息不要一上来就走重注入和强模型”的问题，但还没有彻底解决另一类慢路径：

- 用户一旦进入“帮我做事”而不是“直接回答”的模式
- 主回复链仍然容易把长任务、工具决策、执行循环塞进同一条微信入站处理
- 结果就是微信消息要等待完整决策和部分执行，体感仍然慢

目标不是把主模型继续降级，而是把“回复”和“执行”彻底拆开。

## 结论

最终架构采用四层，但控制面只保留三层：

1. `5.2 fast` 负责微信网关首层短路由
2. `5.4 strong` 负责低频规划和任务判定
3. `Codex ACP` 负责长生命周期执行
4. `zellij` 只做观察、镜像、人工接管，不做主控制层

核心判断：

- 不应该让 `zellij` 变成协议层
- 不应该让微信主会话直接承载多轮重任务执行
- 应该复用 OpenClaw 现有的 ACP session / persistent binding / session state 能力

## 为什么不是“直接用 zellij 当执行总线”

`zellij` 很适合：

- 长时间观察任务
- 同时盯多个 Codex 终端
- 人工接管某个 worker
- 在 executor 已经跑起来后做可视化和运维

但 `zellij` 不适合做主协议层，原因很直接：

- 它本质是终端复用器，不是任务注册中心
- 多轮状态、任务归属、恢复、失败重试、会话绑定，仍然要落回 OpenClaw 自己的状态机
- 如果把“微信会话 -> zellij pane”直接绑定，后续恢复、迁移、重启后的重连都很脆

所以这里把 `zellij` 定位为：

- executor 的观察面
- 可选镜像面
- 人工 takeover 面

而不是：

- 任务真相源
- 路由中心
- 会话绑定中心

## 总体架构

### 第一层：Fast Router

模型：

- `gpt-5.2`
- `fastMode: true`
- 极简 system prompt
- 尽量不带工具
- 尽量不带大块 bootstrap

职责：

- 直接回复简单消息
- 识别控制类消息
- 识别“继续当前任务”
- 识别“需要新开任务”
- 无法稳定判断时，升级到 strong planner

约束：

- 它不负责长执行
- 它不负责复杂计划
- 它只做低延迟分流

输出 schema：

- `reply_now`
- `control`
- `continue_task`
- `open_task`
- `escalate_strong`

### 第二层：Strong Planner

模型：

- `gpt-5.4`
- strong / high reasoning
- 完整上下文注入
- 低频触发

职责：

- 判断任务是否值得脱离主回复链
- 生成任务标题、目标、验收标准
- 选择执行后端
- 决定是单 worker 还是并行 worker
- 在必要时先给用户一个短确认/短汇报

输出 schema：

- `answer`
- `acp_persistent`
- `acp_parallel`

原则：

- planner 只做“定方向”
- 真正执行不在 planner 里跑

### 第三层：Codex ACP Executor

这是主执行层，不是临时一次性 subprocess。

优先走 ACP persistent session，原因：

- 有 session identity
- 有 resume 语义
- 可以把长任务从微信入站处理里剥离
- 后续追问可以继续接到同一个执行上下文
- 符合现有 OpenClaw 文档对“run this in Codex”的推荐路径

执行器职责：

- 接收 planner 生成的任务说明
- 在独立 session 中执行
- 产生阶段性摘要
- 在需要用户输入时挂起
- 在完成/失败后回传摘要

### 第四层：zellij Mirror / Takeover

`zellij` 只作为可选附加层：

- 给长期运行任务提供可观察终端
- 给并行 worker 提供分 pane 展示
- 给人工插手提供稳定入口

不要求第一阶段就接入。

## 微信场景的关键设计

### 现状问题

很多 OpenClaw 的“当前会话绑定”能力依赖 channel adapter 提供 current-conversation binding。

但对 `openclaw-weixin`，当前不能假设仓库内已经有完整的 current-conversation ACP binding 运行时。

因此微信场景不能直接依赖：

- “这条微信对话天然绑定一个 ACP session”

### 解决方式

对微信先落地“虚拟前台任务”模型：

- 主会话仍然是原来的微信 session
- 主会话只记录一个 `foregroundTaskId`
- 真正的任务状态放在独立 task registry
- follow-up 消息先看主会话有没有前台任务
- 有则优先进入 `continue_task`

这能做到：

- 不改微信接入配置
- 不破坏现有 session store
- 不要求一上来就有 adapter 级 conversation binding
- 先把“任务”和“普通聊天”分流开

## 状态落盘设计

### 任务注册表

新增独立状态目录：

- `~/.openclaw/tasks/registry.json`

内容：

- 所有任务的轻量索引
- 当前状态
- 所属 session
- 前后台关系
- 执行后端
- 最近摘要

### 任务事件流

每个任务一个 JSONL：

- `~/.openclaw/tasks/<safeTaskId>.events.jsonl`

内容：

- 状态变更
- planner 决策
- executor 启动
- 用户补充输入
- 阶段性摘要
- 完成/失败

这样做的原因：

- `registry.json` 负责快速索引
- `events.jsonl` 负责可审计可恢复
- 避免把长事件历史塞进 `sessions.json`

### 主会话只保留最小指针

在 `SessionEntry` 里只新增：

- `foregroundTaskId`
- `recentTaskIds`
- `suspendedTaskIds`

不把完整任务对象塞进 session store。

## 任务模型

任务记录至少包含这些字段：

- `taskId`
- `ownerSessionKey`
- `ownerChannel`
- `ownerAccountId?`
- `ownerConversationId?`
- `routeMode`
- `title`
- `goal`
- `acceptance?`
- `cwd?`
- `state`
- `backend`
- `foreground`
- `priority`
- `orchestrator`
- `workers[]`
- `lastDigest`
- `lastUserVisibleSummary`
- `lastPlannerIntentHash`
- `createdAt`
- `updatedAt`
- `lastActivityAt`
- `error`

状态机先收敛为：

- `planning`
- `pending_dispatch`
- `running`
- `waiting_user`
- `blocked`
- `replanning`
- `done`
- `failed`
- `stopped`

## 路由流程

### 简单回复

1. 微信消息进入主会话
2. `5.2 fast` 直接判断可短答
3. 主链直接回复
4. 不创建任务

### 继续已有任务

1. 主会话存在 `foregroundTaskId`
2. `5.2 fast` 判定这是补充信息或继续执行
3. 消息附加到该 task event log
4. 唤醒对应 ACP session 或 executor
5. 主链只回一条很短的确认，例如“继续处理”

### 新开任务

1. `5.2 fast` 判断用户是在下达任务
2. 如任务复杂度足够高，升级给 `5.4 strong`
3. planner 生成任务定义
4. 创建 `TaskRecord`
5. 进入 `pending_dispatch`
6. 由 ACP executor 接手
7. 主链尽快给用户一个短确认，而不是等待执行完成

### 多 worker 任务

第一阶段先只把数据模型留出来，不立即在微信链路里全开。

后续支持：

- planner 生成多个 worker
- 每个 worker 绑定一个独立 Codex ACP session
- orchestrator 负责任务拆分和摘要汇总
- `zellij` 为这些 worker 提供观察 pane

## 为什么这样会更快

关键不是“把每一步都换成更快模型”，而是：

- 把首条微信响应从“完整执行”缩成“低延迟路由 + 快速确认”
- 把长任务移出主入站链路
- 把后续多轮上下文绑定到 task/session，而不是每次重新思考整件事

所以收益主要来自三件事：

1. 主链少做事
2. 重任务跨轮复用上下文
3. 执行器和聊天面解耦

## 分阶段实施

### Phase 1

先做稳定落盘和数据骨架：

- 设计文档
- `src/tasks/types.ts`
- `src/tasks/task-registry.ts`
- `src/tasks/task-registry.test.ts`
- `SessionEntry` 最小任务指针

这一阶段不改微信现有回复行为。

### Phase 2

接最小路由入口，但不改大逻辑：

- 在回复链中增加 task-aware 判定入口
- 只做 `foregroundTaskId` 的 continue/open 判断
- 默认仍保持当前回复主链可工作

### Phase 3

真正接入 ACP executor：

- planner -> task -> ACP persistent session
- 任务摘要回传
- waiting_user / resume

### Phase 4

再接 `zellij`：

- pane mirror
- 多 Codex worker 可视化
- 人工 takeover

## 本轮开工范围

本轮直接落地：

1. 完整设计文档
2. 任务注册表与事件日志骨架
3. 会话最小任务指针
4. 定向测试

本轮暂不做：

- 直接改微信主回复链
- 直接切换现有 ACP 会话分发逻辑
- 直接把 zellij 变成默认控制层

## 当前落地状态

截至 2026-03-30 本轮实现结束，Phase 1 / 2 / 3 的最小闭环已经接上：

- 已新增任务注册表与事件落盘骨架：
  - `src/tasks/types.ts`
  - `src/tasks/task-registry.ts`
  - `src/tasks/session-pointers.ts`
- 已在 `SessionEntry` 增加最小任务指针：
  - `foregroundTaskId`
  - `recentTaskIds`
  - `suspendedTaskIds`
- 已在回复主链增加 task-aware 入口，位置在常规模型执行之前：
  - 可短路普通聊天
  - 可识别前台任务继续输入
  - 可识别显式开任务指令
  - 可识别状态 / 暂停 / 取消 / 继续
- 已为微信“虚拟前台任务”接入 persistent ACP child session：
  - 主微信会话只保留 task pointer
  - 长任务在独立 ACP session 中执行
  - 父会话立即返回短确认，不同步等待子任务完成
  - 子任务生命周期通过 agent event 回写 task registry
- `zellij` 仍然保持为后续观察/接管层，没有进入当前控制面

这意味着当前链路已经从“微信入站直接扛长执行”切到“微信入站先分流，长任务转 ACP 子会话执行”的结构。

## 已验证

本轮已补齐并通过以下验证：

- `pnpm exec vitest run --config vitest.unit.config.ts src/agents/model-selection.test.ts src/tasks/task-registry.test.ts src/tasks/session-pointers.test.ts src/config/sessions.test.ts`
- `pnpm exec vitest run src/auto-reply/reply/task-aware-routing.test.ts src/auto-reply/reply/agent-runner.task-aware.test.ts src/auto-reply/reply/agent-runner.misc.runreplyagent.test.ts`
- `pnpm exec vitest run --config vitest.e2e.config.ts src/auto-reply/reply/agent-runner.runreplyagent.e2e.test.ts -t "runReplyAgent memory flush"`

另外补了两个稳定性点：

- `isCliProvider()` 现在不再只依赖运行时 plugin registry，也会回退识别 bundled CLI backend metadata，避免 `claude-cli` / `codex-cli` / `google-gemini-cli` 在部分上下文中被误判成 embedded provider
- memory flush 相关测试已对齐当前 gating 规则：
  - 需要 `totalTokensFresh: true` 或 transcript fallback
  - 需要 memory flush resolver 已注册
  - 断言改为匹配真实日期展开后的 `memory/YYYY-MM-DD.md` 路径

## 实施原则

- 尽量只新增模块，不碰当前脏改动较多的主链文件
- 不改变现有环境配置
- 不改变现有微信接入配置
- 不破坏现有 session store 结构，只增加可选字段
- 先把任务状态和执行状态分离，再考虑路由接线
