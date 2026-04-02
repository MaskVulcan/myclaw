---
read_when:
  - 你要继续维护当前环境
  - 你要知道运行/测试/资源方面的注意项
summary: 环境与维护注意项
title: 注意项
---

# 注意项

## 当前环境事实

- 当前工作目录：
  - `/root/gitsource/myclaw`
- 当前远程：
  - `origin = git@github.com:MaskVulcan/myclaw.git`
  - `upstream = https://github.com/openclaw/openclaw.git`
- 当前网关服务：
  - `openclaw-gateway.service`
- 当前微信通道实际运行自外置插件：
  - `~/.openclaw/extensions/openclaw-weixin`
- 仓库内对应回放快照：
  - `/root/gitsource/myclaw/patches/openclaw-weixin-backup/2026-04-03`

## 运行注意项

- 网关重启后会有明显启动期内存峰值
- 启动峰值可到约 `2.0G`
- 稳定后一般会回落到约 `600MB ~ 700MB` 级别
- 不要把启动峰值直接当成常驻泄漏

## 测试注意项

- 全仓 `tsc` 目前会 OOM，不作为当前主验证手段
- 当前更可靠的验证方式：
  - 定向 `vitest`
  - `pnpm build:docker`
  - 重启服务后观察运行态

## Recall Backend 注意项

- 当前环境只有：
  - `ANTHROPIC_API_KEY`
- 当前没有确认可直接用的 memory embedding provider
- 当前也没有：
  - `qmd`
  - `bun`
- 所以正式 recall backend 增强暂时只记计划，不强行上线

## 文档维护注意项

- 阶段性分析继续放 `docs/zh-CN/diagnostics/`
- 长期稳定状态同步到 `docs/zh-CN/project/`
- 新决策优先更新：
  - `decisions.md`
  - `design.md`
  - `roadmap.md`
- 微信插件外置维护相关内容优先更新：
  - `weixin-plugin-maintenance.md`
  - `patches/openclaw-weixin-backup/2026-04-03/README.md`
