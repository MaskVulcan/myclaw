---
read_when:
  - 你想把 OpenClaw 的底层执行链切到 Codex
  - 你在当前 `codex-vip`、`openai-codex`、`codex-cli` 三条路径之间做取舍
summary: 2026-03-29 在 myclaw 上针对 Codex 底层接入路径的实测记录与取舍结论
title: Codex 底层路径评估记录
---

# Codex 底层路径评估记录

## 背景

- 当前线上主链模型是 `codex-vip/gpt-5.4`。
- 用户目标不是降模型，而是尽量让 OpenClaw 更直接地走 Codex 相关链路。
- 用户要求保留现有环境、密钥和微信接入状态。

## 现场环境

- OpenClaw 源码目录：`/root/gitsource/myclaw`
- 当前配置：`/root/.openclaw/openclaw.json`
- 当前 Codex CLI：`/usr/local/bin/codex`
- 当前 Codex CLI 版本：`codex-cli 0.117.0`
- 当前 Codex 认证文件：`/root/.codex/auth.json`

## 路径一：`openai-codex` 官方 OAuth provider

### 结论

- 当前环境下不可直接切换为线上主链。

### 原因

- OpenClaw 的 `openai-codex` provider 依赖 OAuth 形态的 `auth-profiles.json`。
- 当前机器上的 `/root/.codex/auth.json` 不是 OpenClaw 预期的 OAuth token 结构，而是 `clp_...` 形式的 CLI 认证。
- 因此它不能直接被同步成 `openai-codex:default` 的 OAuth profile。

## 路径二：把现有 `codex-vip` provider 切到 `openai-codex-responses`

### 结论

- 当前代理不支持，不能直接这样切。

### 实测

- `POST https://api-vip.codex-for.me/v1/responses` 返回 `200`
- `POST https://api-vip.codex-for.me/v1/codex/responses` 返回 `404`

### 额外限制

- `pi-ai` 的 `openai-codex-responses` 客户端会先尝试从 token 中解析 `chatgpt_account_id`。
- 当前 `clp_...` token 不是 JWT，客户端会在本地先报 `Failed to extract accountId from token`。
- 即使代理未来补了 `/codex/responses`，当前 token 形态也还需要额外兼容层。

## 路径三：`codex-cli` backend

### 结论

- 这是当前环境里唯一真正能“直接调用官方 codex 命令”的路径。
- 但在当前机器上，如果直接切成线上主链，首轮与续聊时延都明显高于现有 `codex-vip`。

### 关键实测

- 在真实工作区 `/root/.openclaw/workspace` 里直接跑：
  - `codex exec ... 'Reply with exactly: pong'`
  - 总耗时约 `33.7s`
- 在空目录里跑同样命令：
  - 总耗时约 `12.3s`
- 说明主要慢点不是模型本身，而是 Codex CLI 启动后会主动扫描工作区文件与记忆文件。

### 现场观察

- Codex CLI 会主动读取：
  - `BOOTSTRAP.md`
  - `SOUL.md`
  - `USER.md`
  - 以及相关 memory 路径
- 这会把简单聊天也拖进“先理解工作区人格/记忆”的路径里。

## 额外兼容性问题

- `codex-cli 0.117.0` 的 `exec resume` 参数面已经变化。
- OpenClaw 旧默认值里给 `resume` 传的 `--color`、`--sandbox` 会直接报错。
- 已在 `myclaw` 源码里修正为新版可用的默认参数，并让 resume 继续走 JSONL。

## 当前取舍

- 线上主链暂时继续保留 `codex-vip/gpt-5.4`。
- 不直接把微信 bot 主链硬切到 `codex-cli/gpt-5.4`，原因是：
  - 当前实测更慢
  - 会把工作区自扫描成本带到每条微信消息
  - 当前用户体验风险高于收益
- 与此同时，源码侧已经把 `codex-cli` backend 修到了当前 Codex CLI 版本可用。

## 本次落地动作

- 修复 `codex-cli` backend 的 resume 参数与输出模式。
- 保留现有 `codex-vip` 主链。
- 在现网配置里启用当前主模型的低延迟参数，优先改善真实聊天体验。

## 后续可继续推进的方向

1. 如果后续拿到真正的 Codex OAuth，可重新评估 `openai-codex/gpt-5.4` 直连路径。
2. 如果 `codex-vip` 代理未来支持 `/v1/codex/responses`，可补 `clp_...` token 兼容层再测。
3. 如果坚持走 `codex-cli` 主链，应继续研究：
   - 如何避免 Codex CLI 自动扫描工作区人格文件
   - 是否能为 bot 场景提供更轻的 runtime cwd
   - 是否能按消息类型动态决定是否暴露 workspace
