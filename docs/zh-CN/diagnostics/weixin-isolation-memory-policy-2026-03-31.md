---
read_when:
  - 你要排查微信多用户是否会串上下文
  - 你要确认微信新消息进入模型时到底带了哪些 prompt 上下文
summary: 微信私聊按用户隔离与 prompt/history 注入策略
title: 微信隔离与记忆策略
---

# 微信隔离与记忆策略

## 本次目标

- 微信私聊做到用户粒度隔离，避免多人共享同一 DM session。
- 微信新消息进入模型时，不再把引用内容和当前消息正文混在一起。
- 微信短期上下文显式走 transcript history window，长期上下文继续走 OpenClaw memory/workspace 体系。

## 当前推荐配置

运行态配置位于：

- `/root/.openclaw/openclaw.json`

推荐值：

```json
{
  "session": {
    "dmScope": "per-account-channel-peer"
  },
  "channels": {
    "openclaw-weixin": {
      "dmHistoryLimit": 8
    }
  }
}
```

说明：

- `per-account-channel-peer`
  - 每个「微信 bot 账号 + 微信用户」一条独立 session。
  - 适合多微信账号同时在线。
- `dmHistoryLimit: 8`
  - 只把最近 8 个用户轮次的 transcript 带进模型。
  - 适合微信这种对时延敏感的私聊场景。

## 微信 prompt 现在带什么

微信新消息进入模型时，核心上下文分 5 层：

1. `system prompt`
   - OpenClaw 标准系统提示。
   - 注入 workspace bootstrap 文件，如 `AGENTS.md`、`SOUL.md`、`TOOLS.md`。
   - 对微信私聊，默认不再自动注入共享 `MEMORY.md`，而是注入当前用户专属的 scoped memory 文件：
     - `.openclaw/weixin-dm-memory/<accountId>/<peerId>.md`

2. `trusted inbound metadata`
   - 由 OpenClaw 生成的渠道/账号/会话元数据。
   - 微信至少包含 `channel=openclaw-weixin`、`account_id`、`chat_id` 等。

3. `untrusted inbound context`
   - 当前消息的结构化附带上下文。
   - 本次调整后，微信引用消息不再拼进正文，而是写入 `ReplyToBody` / `ReplyToIsQuote`，作为单独的“引用上下文”块进入 prompt。

4. `session transcript`
   - 当前 session 的历史对话。
   - 在模型调用前经过 sanitize / validate / truncate。
   - 历史窗口由 `channels.openclaw-weixin.dmHistoryLimit` 或 `dms.<userId>.historyLimit` 控制。

5. `light recall block`
   - 仅微信私聊启用。
   - 从同一个微信私聊 session 的 transcript 尾部做一次轻量旧历史召回。
   - 只扫描有限尾部窗口，不全量读整份 transcript。
   - 只召回“已经落到 active history window 之外”的老片段，避免和最近几轮重复。
   - 作为独立 `UntrustedContext` 块进入 prompt，不混入正文。

## 长期记忆和短期历史怎么分工

- 长期记忆：
  - 仍由 OpenClaw workspace 文件和 memory tools 管理。
  - 共享长期记忆仍可放在 `MEMORY.md`、`memory/YYYY-MM-DD.md`。
  - 微信私聊用户专属长期记忆改为：
    - `.openclaw/weixin-dm-memory/<accountId>/<peerId>.md`
  - memory tools 仍是 `memory_search`、`memory_get`。
- 短期历史：
  - 来自当前微信 session transcript。
  - 只保留有限最近轮次，避免 prompt 无限膨胀。
- 轻召回补层：
  - 当当前问题和更早的同微信私聊历史存在明显词面匹配时，补少量老片段进 prompt。
  - 这层不是全局语义检索，只是低成本兜底，目标是“薄 prompt 下少漏关键旧事”。

结论：

- 不应该把微信历史聊天记录全量塞回 prompt。
- 正确做法是：
  - 当前消息正文保持干净
  - 引用/回复上下文结构化单独提供
  - 最近 transcript 有窗口上限
  - 窗口外只补极少量相关旧片段
  - 更久远、可复用的信息写入 memory，由模型按需检索

## 新增：微信私聊后台 scoped memory capture

- 只对 `openclaw-weixin` + direct session 生效
- 不会把“核心记忆抽取”塞进主对话 session
- 命中明显的长期记忆信号时，会额外排一个静默 side-session：
  - side session key 形如当前私聊 session 加 `:thread:0`
  - 共享同一个 workspace，因此仍然能写入当前用户的 scoped memory 文件
  - side-session transcript 会在完成后清理，不污染主 transcript
- 触发信号偏向这些内容：
  - `记住` / `remember`
  - `默认` / `以后` / `优先` / `不要`
  - `偏好` / `原则` / `工作方式` / `格式` / `人设` / `需求`
  - 用户长期项目/仓库/目标这类稳定背景信息
- 后台提示词约束：
  - 只写当前微信用户的 scoped memory
  - append-only
  - 不写共享 `MEMORY.md`
  - 不写临时噪音、一次性请求、低置信度猜测
  - 无需写入时返回 `NO_REPLY`

这层的目标是补足：

- 主模型当前回合没有主动写记忆
- transcript window 变薄后，长期偏好/原则容易掉出上下文
- 但又不希望把每条微信消息都升格成重型 memory turn

## 本次实现点

- 运行配置增加：
  - `session.dmScope = "per-account-channel-peer"`
  - `channels.openclaw-weixin.dmHistoryLimit = 8`
- 微信插件新增：
  - `SenderId`
  - `ReplyToBody`
  - `ReplyToIsQuote`
- 微信插件 schema 新增：
  - `historyLimit`
  - `dmHistoryLimit`
  - `dms.<id>.historyLimit`
  - 账号级同类覆盖
- `getHistoryLimitFromSessionKey()` 补齐：
  - 支持 `agent:<agent>:<channel>:<accountId>:direct:<user>` 这种 account-scoped DM key
  - 支持账号级 history override
- 微信私聊轻召回新增：
  - 只对 `openclaw-weixin` + direct session 生效
  - query 优先取当前消息正文；正文太泛时，回退利用引用消息正文
  - transcript 只做尾部有限扫描，控制 CPU / 内存
  - 只从 active history window 之外挑 1 到 2 个旧片段注入
- 微信私聊 scoped memory 新增：
  - 微信 direct session 下，bootstrap 阶段会自动准备：
    - `.openclaw/weixin-dm-memory/<accountId>/<peerId>.md`
  - 该文件只属于当前「微信 bot 账号 + 微信用户」
  - 当前 session 默认注入这个 scoped memory 文件，而不是共享 `MEMORY.md`
  - 文件模板会明确提示：用户专属偏好/默认方式写这里，不写进共享 `MEMORY.md`
- 微信私聊后台 scoped memory capture 新增：
  - 命中长期记忆信号时，后台追加一轮静默 memory capture
  - 目标仍是当前用户的 scoped memory 文件
  - 这轮 capture 不进入主对话 session transcript

## 影响

- 多个微信用户进入同一个 agent 时，不再共享同一 DM 会话。
- 多个微信用户进入同一个 agent 时，也不再默认共享同一份自动注入的长期记忆文件。
- 微信引用消息不会污染当前命令/正文解析。
- 微信上下文长度更可控，后续延迟排查也更容易。
- 对“窗口外但仍然相关”的旧消息，命中率比之前更高。

## 边界

- 这还不是完整语义召回系统。
- 当前轻召回更像：
  - 同 session transcript 的低成本尾部匹配补丁层
- 它不保证：
  - 特别久远、已经超出尾部扫描范围的历史一定被带回
  - 纯改写语义、完全没有词面重合的问题一定命中
  - `memory_search` 将来即使启用，也不会自动检索这个 scoped memory 文件，除非后续专门接入对应索引/检索策略
- 真正需要高保证的长期信息，仍建议：
  - 微信用户专属信息写入 `.openclaw/weixin-dm-memory/<accountId>/<peerId>.md`
  - 共享的全局信息再写入 `MEMORY.md` / `memory/YYYY-MM-DD.md`
  - 后续再接更正式的 memory/QMD recall
