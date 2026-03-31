---
read_when:
  - 你在微信 bot 场景里遇到“首条消息明显慢于后续消息”
  - 你刚重启 gateway，想确认消息慢是代理问题还是 runtime 冷启动
summary: 微信 bot 首条消息慢的排查记录与当前 myclaw 修复方案
title: 微信首条消息慢排查记录
---

# 微信首条消息慢排查记录

## 现象

- 微信 bot 已成功登录并能正常收发消息。
- 用户发出第一条消息后，到 agent 真正开始处理之间有明显空档。
- 实测链路里，代理关闭前总耗时约 `13.2s`，关闭代理后仍约 `10.6s`。

## 已确认的非根因与次要因素

- `xray` 代理会显著增加时延，但不是全部问题。
- 关闭代理前后，对关键接口的直连与代理对比如下：
  - `api-vip.codex-for.me/v1/models`：直连约 `0.46s`，代理约 `3.80s`
  - `https://ilinkai.weixin.qq.com/`：直连约 `0.042s`，代理约 `2.45s`
- 结论：代理确实拖慢了整体链路，但代理关闭后仍存在明显冷启动开销。

## 关键日志线索

- 典型慢请求时间线：
  - 入站日志：`01:37:24.148`
  - 配置缓存完成：`01:37:24.396`
  - 插件相关日志再次出现：`01:37:29.702`
  - session 里真正写入用户消息：`01:37:30.264Z`
  - 微信侧文本发出成功：`01:37:34.720`
- 慢点不在微信收消息本身，而在“入站消息进入 agent 前”的运行时准备阶段。
- 现场日志里反复出现的可疑信号：
  - `plugins.allow is empty; discovered non-bundled plugins may auto-load`
  - `gateway/channels/openclaw-weixin [compat] Host OpenClaw ... OK`
  - `gateway/channels/openclaw-weixin [runtime] setWeixinRuntime called, runtime set successfully`

## 根因判断

- `runEmbeddedPiAgent()` 在真正开跑前会调用 `ensureRuntimePluginsLoaded()`。
- 旧行为下，这个 runtime registry 往往要等第一条真实消息到来时才完成全量预热。
- 结果是：
  - 第一条消息会为 runtime 插件装载、hook runner 初始化、非 bundled 插件扫描等成本买单。
  - 重启后首条微信消息尤其明显。
- 这条路径与“微信插件收消息”是解耦的，所以表面上看像“入站到 agent 开炮慢”。

## 当前修复

已在 `myclaw` 中把 runtime plugin 预热前移到 gateway 启动阶段：

- 启动 sidecar 时主动预热 runtime plugin registry。
- 会覆盖所有已配置 agent 的去重 workspace。
- 默认 workspace 最后预热，保证启动完成后 active registry 落在最常用工作区。
- 单个 workspace 预热失败只记警告，不阻断整个 gateway 启动。

这样处理后：

- 首条微信消息不再需要临时触发这套 runtime 冷启动。
- 冷启动成本被转移到 gateway 启动阶段。
- 后续优化重点就回到模型首 token、上游 API 抖动或工具链自身耗时。

## 相关代码

- `src/gateway/server-startup.ts`
- `src/gateway/server-startup.test.ts`

## 现场环境记录

- 源码仓库：`/root/gitsource/myclaw`
- 当前 CLI 入口：`/root/gitsource/myclaw/openclaw.mjs`
- 当前 systemd 用户服务：
  - `/root/.config/systemd/user/openclaw-gateway.service`
- 微信插件状态目录：
  - `/root/.openclaw/openclaw-weixin/`
- 微信账号快照：
  - `/root/.openclaw/openclaw-weixin/accounts.json`
  - `/root/.openclaw/openclaw-weixin/accounts/15b6a1154038-im-bot.json`
- 主日志：
  - `/tmp/openclaw/openclaw-2026-03-29.log`

## 当前运行假设

- 不通过降模型来掩盖问题。
- 继续使用官方微信插件 `@tencent-weixin/openclaw-weixin`。
- 保留现有环境配置，不重置用户已有状态。

## 回归验证建议

1. 重启 gateway。
2. 观察启动日志，确认 runtime 相关预热发生在启动阶段，而不是第一条微信入站时。
3. 用微信发送重启后的第一条消息。
4. 核对入站时间与 agent session 真正落盘时间，确认不再出现前面的 5 秒级空档。

## 可继续观察的点

- 如果首条消息仍慢，但 `plugins.allow` / `setWeixinRuntime` 不再出现在入站临界区，下一步应看：
  - 模型握手或首 token 延迟
  - auth/profile 轮换
  - workspace/bootstrap/skills 首次加载
  - 工具或记忆系统的首次预处理
