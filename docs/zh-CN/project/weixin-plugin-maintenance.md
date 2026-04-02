---
read_when:
  - 你要维护当前微信通道
  - 你怀疑微信定时任务失败和 token / contextToken 有关
  - 你准备升级或迁移本机安装的微信插件
summary: 微信外置插件维护手册
title: 微信插件维护
---

# 微信插件维护

## 维护事实

- 当前微信通道不是 `myclaw` 仓库内置代码直接实现的。
- 实际运行的是外置 npm 插件：
  - `@tencent-weixin/openclaw-weixin`
- 默认安装目录：
  - `~/.openclaw/extensions/openclaw-weixin`
- 当前网关服务：
  - `openclaw-gateway.service`
- 仓库内保留了一份可回放快照：
  - `/root/gitsource/myclaw/patches/openclaw-weixin-backup/2026-04-03`

## 运行态状态文件

- 账号索引：
  - `~/.openclaw/openclaw-weixin/accounts.json`
- bot token / account 资料：
  - `~/.openclaw/openclaw-weixin/accounts/<accountId>.json`
- 持久化会话上下文：
  - `~/.openclaw/openclaw-weixin/accounts/<accountId>.context-tokens.json`
- getUpdates 游标：
  - `~/.openclaw/openclaw-weixin/accounts/<accountId>.sync.json`
- 微信挂起提醒队列：
  - `~/.openclaw/openclaw-weixin/pending-reminders.json`
- 主日志：
  - `/tmp/openclaw/openclaw-YYYY-MM-DD.log`

## 故障判定

- `ret=-2`
  - 优先判定为“当前主动发送上下文无效”。
  - 常见诱因：
    - 用户很久没发消息，旧 `contextToken` 已不可用
    - 网关冷启动后没有正确把磁盘 `contextToken` 恢复进内存
  - 不要默认判定为 bot token 过期。
- `contextToken missing`
  - 先看磁盘文件里是否已经有对应用户的 token。
  - 如果盘上有、内存没恢复，优先检查插件恢复逻辑。
- `ret=-14` / `session expired`
  - 这才更接近 bot 会话失效。
  - 一般要重新扫码登录。

## 当前本地补丁覆盖点

- `ret=-2` 不再被当成成功发送。
- 微信定时提醒失败后会入挂起队列，等待下次入站后补发。
- 挂起提醒按 `accountId + to` 做隔离，并只保留最新失败项。
- 出站查找 `contextToken` 时会懒恢复磁盘状态，减少冷启动后的假性 `contextToken missing`。
- 发送失败日志会明确区分：
  - `missing-context`
  - `stale-context`
  - `session-expired`
- heartbeat 侧把微信挂起补发原因也会带上分类，避免只看到“挂起了”却不知道是哪种失败。

## 升级或换机回放

先装官方插件：

```bash
openclaw plugins install "@tencent-weixin/openclaw-weixin"
openclaw channels login --channel openclaw-weixin
```

再回放本地快照：

```bash
cd /root/gitsource/myclaw/patches/openclaw-weixin-backup/2026-04-03
./apply.sh
systemctl --user restart openclaw-gateway.service
```

如果插件目录不是默认路径：

```bash
OPENCLAW_WEIXIN_EXT_DIR=/path/to/openclaw-weixin ./apply.sh
systemctl --user restart openclaw-gateway.service
```

## 最小验证

```bash
cd ~/.openclaw/extensions/openclaw-weixin
npm test -- --run src/messaging/inbound.test.ts src/messaging/pending-reminders.test.ts
systemctl --user status openclaw-gateway.service --no-pager
rg -n "openclaw-weixin|ret=-2|ret=-14|contextToken missing|session expired" /tmp/openclaw/openclaw-$(date +%F).log -S
```

## 维护动作要求

- 任何直接改动 `~/.openclaw/extensions/openclaw-weixin` 后，都要同步回仓库快照。
- 同步时至少更新：
  - `patches/openclaw-weixin-backup/2026-04-03/`
  - `patches/openclaw-weixin-backup/2026-04-03/README.md`
- 如果结论已经稳定，不只放在 `diagnostics/`，还要同步到本文件。
