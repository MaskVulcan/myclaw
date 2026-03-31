# 微信慢回复优化：两阶段模型路由

日期：2026-03-29

## 目标

在不直接把主回复模型整体降级的前提下，缩短微信入站首轮回复时间：

- 第一阶段：快模型、极小提示词、轻量上下文
- 第二阶段：仅在第一阶段明确判定“需要升级”时，再切到强模型和完整注入

## 本次实现

`myclaw` 新增 `agents.defaults.multiStageRouting` 配置，并接入 `runAgentTurnWithFallback(...)`：

- `fastPass`
  - 支持单独指定模型、思考级别、`fastMode`
  - 支持单独控制 `systemPromptMode` / `skillsPromptMode` / `bootstrapContextMode`
  - 默认关闭工具，降低首轮延迟和误入工具链的成本
  - 默认不继承主链 `extraSystemPrompt`，避免把入站元信息/群聊附加提示整块带进快路径
- `escalationPass`
  - 在 fast pass 返回内部升级标记后触发
  - 使用更强模型、更高思考级别和更完整的上下文注入

## 关键行为

- fast pass 使用内部升级标记 `[[openclaw_stage2]]`
- 该标记不会发送给用户
- 若 fast pass 决定升级，会先回滚本轮对会话文件的写入，再进入强阶段
- 强阶段才对外暴露正式回复流和最终模型信息
- 日志会额外记录 `fast-pass start/completed/accepted/escalating` 和 `escalation-pass accepted`

## 当前 live 配置

`/root/.openclaw/openclaw.json`

- `fastPass`
  - `model: codex-vip/gpt-5.2`
  - `thinkLevel: low`
  - `fastMode: true`
  - `systemPromptMode: none`
  - `skillsPromptMode: off`
  - `bootstrapContextMode: lightweight`
  - `disableTools: true`
  - `inheritExtraSystemPrompt: false`
- `escalationPass`
  - `model: codex-vip/gpt-5.4`
  - `thinkLevel: xhigh`
  - `fastMode: false`
  - `systemPromptMode: full`
  - `skillsPromptMode: auto`
  - `bootstrapContextMode: full`
  - `disableTools: false`
  - `inheritExtraSystemPrompt: true`

## 影响

- 简单问答和短指令优先走 `gpt-5.2` 极简路径
- 需要更强判断、更多上下文或工具能力时，再升级到 `gpt-5.4 xhigh`
- 图片消息默认跳过 fast pass，直接走强阶段

## 2026-03-30 修复记录

问题现象：

- 微信入站消息在少数会话里完全无响应
- 日志出现大量重复的 `fast-pass: start`
- 紧接着出现 `live session model switch detected before attempt`
- 进程最终因高频重试而卡死并被重启

根因：

- `fastPass` 显式指定了 `codex-vip/gpt-5.2`
- live-session 判定逻辑在“没有真实 session override”时，仍会回落到 agent 默认模型 `codex-vip/gpt-5.4`
- 这会把 fast pass 的临时显式模型误判成“会话要求切模型”
- 旧逻辑依赖 fast pass 先抛 `LiveSessionModelSwitchError` 再兜底升级
- 外层重试和两阶段重算叠加后，可能重复回到同一个 `fastPass` 显式模型，形成循环

修复：

- 新增“只读取真实 session override”的 live-selection 解析
- 底层 `pi-embedded-runner` 的 live-switch 检查改为只看真实持久化 override，而不是 agent 默认模型
- 在进入 `fastPass` 之前，若检测到真实 override 与 fast pass 模型冲突，直接跳过 `fastPass`
- 跳过后直接进入强阶段，并让强阶段跟随 live session 的真实 override
- 保留原有的 `LiveSessionModelSwitchError` 异常兜底，防止运行中途切模型时漏处理

新增日志：

- `fast-pass: skipped due to live session switch`

预期结果：

- 没有真实 model override 的普通会话，可以正常先跑 `gpt-5.2` fast pass
- 只有真的被用户或系统写入 override 的会话，才会按 override 跳过 fast pass
- 不再出现同一条微信消息在毫秒级反复重跑 fast pass
- 现有环境配置、微信接入配置和会话数据保持不变

## 2026-03-30 第二轮修复记录

问题现象：

- 即使日志里打印了 `systemPromptMode: none`
- `skillsPromptMode: off`
- `bootstrapContextMode: lightweight`
- 首轮 fast pass 仍然注入了 `AGENTS.md`
- 日志仍出现 `workspace bootstrap file AGENTS.md is 7809 chars ... truncating`
- 单条短消息耗时仍在约 4 秒级

根因：

- `agent-runner-execution.ts` 已经把 fast-pass 的轻量参数传给 `runEmbeddedPiAgent(...)`
- 但 `src/agents/pi-embedded-runner/run.ts` 在继续下传到 `runEmbeddedAttempt(...)` 时漏传了：
  - `systemPromptMode`
  - `skillsPromptMode`
  - `bootstrapContextMode`
  - `bootstrapContextRunKind`
- 结果是 fast pass 在日志层面看起来是“极简模式”，实际执行仍回落到默认完整注入链路

修复：

- 在 `run.ts -> runEmbeddedAttempt(...)` 调用处补齐上述 4 个参数透传
- 新增普通单测，直接断言这些 fast-pass 控制项确实进入底层 attempt
- 顺带把相关测试 harness 改成 partial mock，避免 provider-runtime / command-queue 新增导出时再次把回归测试跑挂

验证：

- `src/agents/pi-embedded-runner/run.timeout-triggered-compaction.test.ts`
- `src/agents/live-model-switch.test.ts`
- `src/auto-reply/reply/agent-runner-execution.test.ts`

上线状态：

- 2026-03-30 01:07:25 +08:00 gateway 重新监听 `wss://127.0.0.1:29173`
- 2026-03-30 01:07:30 +08:00 weixin monitor 重新启动
- 下一条真实微信入站将首次反映这次“轻量参数真正生效”后的耗时
