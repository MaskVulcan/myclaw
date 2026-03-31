# 微信主会话延迟优化记录（2026-03-29）

## 结论

本轮没有降模型，仍保持主模型为 `codex-vip/gpt-5.4`。

主要收益来自两类减载：

- 不再让已建立会话继续注入 `BOOTSTRAP.md`
- 主会话运行时把 skills catalog 从长描述版改成 compact 版
- 对超长 `AGENTS.md` 不再做简单头尾截断，而是注入结构化精简版

另外补了两项现场收口：

- 将 `plugins.allow` 显式收紧为 `["openclaw-weixin"]`
- 将当前 workspace 标记为 `setupCompletedAt`，并移除已备份的 `BOOTSTRAP.md`

## 代码改动

源码改动位于：

- `src/agents/bootstrap-files.ts`
- `src/agents/pi-embedded-helpers/bootstrap.ts`
- `src/agents/skills/workspace.ts`
- `src/agents/pi-embedded-runner/run/attempt.ts`
- `src/agents/pi-embedded-runner/compact.ts`
- `src/agents/system-prompt.ts`

新增/更新测试：

- `src/agents/bootstrap-files.test.ts`
- `src/agents/pi-embedded-helpers.buildbootstrapcontextfiles.test.ts`
- `src/agents/skills.resolveskillspromptforrun.test.ts`

## 实测指标

使用同一条本地 smoke：

`node dist/index.js agent --local --agent main --message "Reply with exactly: pong" --json`

优化前：

- `promptTokens`: `5763`
- `systemPrompt.chars`: `22694`
- `skills.promptChars`: `4827`
- 注入了 `BOOTSTRAP.md`: `1450 chars`
- `meta.durationMs`: `41917`

代码优化后、清理 workspace 前：

- `promptTokens`: `4652`
- `systemPrompt.chars`: `17845`
- `skills.promptChars`: `1546`
- `BOOTSTRAP.md` 已不再注入
- `meta.durationMs`: `47510`

代码优化后、清理 workspace 与插件 allowlist 后：

- `promptTokens`: `4668`
- `systemPrompt.chars`: `17845`
- `skills.promptChars`: `1546`
- `meta.durationMs`: `8951`

继续压缩 `AGENTS.md` 注入后：

- `promptTokens`: `4639`
- `systemPrompt.chars`: `16649`
- `skills.promptChars`: `1546`
- `AGENTS.md`: `7809 raw -> 4312 injected`
- 两次本地 smoke `meta.durationMs`: `37771` / `38054`
- 两次 wall time: `49.42s` / `47.30s`

真实微信消息（本轮最新一条，压缩 `AGENTS.md` 前）：

- 入站检测：`2026-03-29 16:04:52.951 +08:00`
- 规范化入站：`2026-03-29 16:04:53.183 +08:00`
- 出站开始：`2026-03-29 16:05:14.944 +08:00`
- 出站成功：`2026-03-29 16:05:15.165 +08:00`
- 端到端：约 `22.2s`

说明：

- 第二次 `47510ms` 明显受外部调用波动影响，但 prompt 体积已经实打实下降。
- 第三次 warm-cache 本地回合已经到 `8.9s`。
- 新一轮 `AGENTS.md` 结构化压缩已把该块继续从 `5508` 压到 `4312`。
- 但最新两次本地 smoke 仍在 `38s` 左右，说明当前残余瓶颈已经更偏向上游模型/提供方时延，而不是微信收发链路本身。

## 现场状态调整

已备份：

- `/root/.openclaw/openclaw.json.bak-20260329-latency-opt`
- `/root/.openclaw/workspace/.openclaw/BOOTSTRAP.md.bak-20260329-established`

已修改：

- `/root/.openclaw/openclaw.json`
  - 增加 `plugins.allow = ["openclaw-weixin"]`
- `/root/.openclaw/workspace/.openclaw/workspace-state.json`
  - 增加 `setupCompletedAt = "2026-03-29T07:31:49.000Z"`
- 删除 `/root/.openclaw/workspace/BOOTSTRAP.md`

## 服务状态

已重新构建并重启用户态网关服务：

- `systemctl --user restart openclaw-gateway.service`

重启后确认：

- 服务 `active (running)`
- 当前主模型仍为 `codex-vip/gpt-5.4`
- 微信插件正常恢复
- 当前用户态网关 PID：`2869931`
- 新启动日志中不再出现 `plugins.allow is empty` 的自动发现告警

## 下一步可继续压的点

如果后续还嫌慢，最值得继续动的是：

1. 继续压缩 `/root/.openclaw/workspace/AGENTS.md`
2. 或仅下调 `agents.defaults.bootstrapMaxChars`

这两个都还能再省一截 token，但会更直接影响行为提示，需要结合你下一轮真实微信消息再判断。
