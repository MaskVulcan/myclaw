---
read_when:
  - 你想让 skill 或 agent 先看 schema，再稳定执行 CLI 能力
  - 你想知道 `openclaw capabilities` 的发现、描述和执行约束
summary: "`openclaw capabilities` 的 CLI 参考（结构化能力注册表与 schema 约束执行）"
title: capabilities
---

# `openclaw capabilities`

用显式 JSON Schema 契约来查看和执行结构化 CLI 能力。

这个界面面向 agent/skill 的稳定执行约束，不是插件层那个“capability provider”
概念。这里解决的是渐进暴露、固定输入输出、以及尽量避免 LLM 临时乱拼 shell。

相关内容：

- Skills CLI：[skills](/cli/skills)
- Steward CLI：[steward](/cli/steward)
- Skills 系统：[Skills](/tools/skills)

## 命令

```bash
openclaw capabilities list
openclaw capabilities describe <id>
openclaw capabilities run <id> --input-json '<json>'
```

## 推荐调用流程

1. 先从 skill 摘要、`openclaw skills info` 或 `openclaw capabilities list` 找到 capability id。
2. 用 `openclaw capabilities describe <id>` 查看输入/输出 schema。
3. 再用 `openclaw capabilities run <id> --input-json '<json>'` 执行。

如果 skill 已经声明了 capability id，优先走这条路径，不要再即兴拼新的 shell 命令。

## 输出结构

`list` 返回：

```json
{
  "ok": true,
  "capabilities": [{ "id": "skills.list", "summary": "...", "...": "..." }]
}
```

`describe` 返回：

```json
{
  "ok": true,
  "capability": {
    "id": "steward.ingest",
    "inputSchema": { "type": "object", "...": "..." },
    "outputSchema": { "type": "object", "...": "..." },
    "examples": ["openclaw capabilities run steward.ingest ..."]
  }
}
```

`run` 返回：

```json
{
  "ok": true,
  "capability": { "id": "steward.ingest", "...": "..." },
  "input": { "workspace": "/root/.openclaw/agents/main", "apply": false },
  "output": { "runId": "...", "mode": "dry-run", "...": "..." },
  "runnerCommand": ["openclaw", "steward", "ingest", "--json"]
}
```

失败时也返回结构化 JSON，错误码包括：

- `unknown_capability`
- `invalid_json`
- `invalid_input`
- `capability_failed`

## 当前已注册能力

- `skills.list`
- `skills.info`
- `skills.check`
- `steward.ingest`
- `steward.curate`
- `steward.maintain`
- `steward.incubate-skills`
- `steward.promote-skills`
- `steward.cycle`

## 示例

列出当前能力：

```bash
openclaw capabilities list
```

先查看某个能力的 schema：

```bash
openclaw capabilities describe steward.promote-skills
```

以 schema 约束方式跑一次 dry-run 的 steward cycle：

```bash
openclaw capabilities run steward.cycle --input-json '{"workspace":"/root/.openclaw/agents/main","recent":5,"apply":false}'
```
