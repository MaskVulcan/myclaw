# 微信扩展本地备份说明

本次微信扩展改动不在 `myclaw` 主仓库内，而是在本机安装目录：

- `~/.openclaw/extensions/openclaw-weixin`

为了避免以后换机器、重装官方 npm 包后丢失这批运行时修复，仓库内增加了一个可回放备份：

- [patches/openclaw-weixin-backup/2026-04-03](/root/gitsource/myclaw/patches/openclaw-weixin-backup/2026-04-03)

备份内容覆盖了这几类修复：

- `ret=-2` 不再被当成微信主动发送成功
- 定时提醒失败后挂起，等下次入站刷新 token 后补发
- 挂起提醒按 `accountId + to` 做用户隔离
- 同一用户只保留最新一条挂起提醒，避免昨晚 `22:00` 和今天 `09:00` 一起补发

恢复方式：

```bash
cd /root/gitsource/myclaw/patches/openclaw-weixin-backup/2026-04-03
./apply.sh
systemctl --user restart openclaw-gateway.service
```

如果安装目录不是默认路径：

```bash
OPENCLAW_WEIXIN_EXT_DIR=/path/to/openclaw-weixin ./apply.sh
systemctl --user restart openclaw-gateway.service
```
