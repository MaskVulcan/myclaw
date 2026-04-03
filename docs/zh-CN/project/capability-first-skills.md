---
read_when:
  - 你要继续推进 skill / cli / steward 的分层
  - 你要知道当前 capability-first 方案已经做到哪一步、接下来先做什么
summary: skill 轻编排、capability 约束执行、steward 能力发现的当前设计与阶段计划
title: Capability-First Skills
---

# Capability-First Skills

## 目标

- skill 保持轻，只做路由、边界、注意事项和 capability 暴露
- 稳定执行尽量下沉到 capability registry，而不是让 LLM 临时拼 shell
- steward 负责从对话里发现可复用模式，并推动它们沉淀成 capability-first 的 skill

## 当前分层

### 1. Skill 层

- 初始 prompt 里只暴露轻量 skill catalog
- skill 可以通过 frontmatter 声明：
  - `capabilities`
  - `capability-summary`
  - `progressive-disclosure`
- 当 `progressive-disclosure = capabilities-first` 时，优先先看 capability schema，再决定是否需要读完整 `SKILL.md`

### 2. Capability 层

- 新增 `openclaw capabilities`：
  - `list`
  - `describe`
  - `run`
- 每个 capability 都有：
  - 稳定 id
  - 输入/输出 schema
  - side effects
  - dry-run / idempotent / confirmation 元信息
  - 对应底层 CLI 命令
- 这层的目标是把“可脚本化、可约束”的执行路径固定下来

### 3. Steward 层

- `steward ingest/curate/maintain/incubate-skills/promote-skills/cycle`
  已经接入 capability registry
- `promote-skills` 在观察到已有命令模式可映射 capability 时，会优先生成 capability-first 的 skill 模板
- 如果还没有能力映射，模板会提示先查 `openclaw capabilities list`

## 当前已落地

- capability registry 已覆盖：
  - `skills.list`
  - `skills.info`
  - `skills.check`
  - `smart-calendar.add`
  - `smart-calendar.show`
  - `smart-calendar.render`
  - `document-processing.route`
  - `document-processing.ingest`
  - `document-processing.docx-inspect`
  - `document-processing.docx-grep`
  - `document-processing.ocr-pdf`
  - `steward.ingest`
  - `steward.curate`
  - `steward.maintain`
  - `steward.incubate-skills`
  - `steward.promote-skills`
  - `steward.cycle`
- system prompt 已明确要求：
  - skill 暴露 capability id 时，优先 `openclaw capabilities describe/run`
- `skills list/info/check --json` 已带出 capability-first 元数据
- steward promoted skill 模板已自动补：
  - `capabilities`
  - `capability-summary`
  - `progressive-disclosure: "capabilities-first"`

## 已采纳约束

- 现在不迁 `Cobra`
- 继续沿用现有 TS + `commander` CLI 主干
- skill 不负责承载大量执行细节
- 一旦某个流程可以稳定脚本化/契约化，优先进入 capability/CLI，而不是继续堆 skill prose

## 阶段计划

### Phase 1：基础契约层

- 已完成 capability registry、CLI、system prompt 约束

### Phase 2：高价值能力扩面

- 继续把高频、稳定、可 schema 化的工作流纳入 capability registry
- 优先覆盖：
  - 已有稳定脚本/CLI wrapper
  - steward 多阶段维护动作
  - 后续被反复观察到的 workspace automation

### Phase 3：能力发现闭环

- 让 steward 在抽取 skill 候选时，同时判断：
  - 只是 skill 提示是否够用
  - 还是已经应该固化成 capability / CLI
- 对重复出现的命令模式建立更明确的升级阈值和审计信息

### Phase 4：更强约束

- 补充 capability 的确认策略、运行审计、失败归因
- 对 destructive / external write 能力增加更严格的 schema 和确认门槛

## 不要做的事

- 不要把 skill 写成另一个隐式 CLI 手册
- 不要在已有 capability 的情况下继续让 LLM 自由拼命令
- 不要为了“统一管理”就先做 Cobra 迁移，破坏当前主线节奏
