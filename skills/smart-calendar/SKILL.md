---
name: smart-calendar
description: Local Markdown-backed schedule management for meetings, events, trips, and collaborator notes. Use when the user asks in English or Chinese to add/query/edit/delete calendar items, manage 日程/会议/行程/约会/安排, inspect upcoming plans, maintain people dossiers, or render a schedule as text or PNG.
metadata: { "openclaw": { "emoji": "🗓️", "requires": { "anyBins": ["python3", "python"] } } }
---

# Smart Calendar

Use this skill for personal schedule management that should be stored locally as Markdown files, queried later, and optionally rendered as calendar images.

## When To Use

- Add, edit, delete, or list events such as meetings, appointments, trips, study blocks, or social plans
- Query the next few days, this week, this month, a date range, a category, or a participant
- Keep collaborator dossiers with personality notes, working tips, and free-form meeting notes
- Produce a weekly/monthly/day calendar image or a category heatmap

## When Not To Use

- If the user wants OpenClaw itself to wake up later and message them here, use the cron tool instead of this skill
- If the user wants Apple Reminders / Things / Google Calendar sync specifically, use the corresponding native skill instead

## OpenClaw Runtime

Use the bundled wrapper at `{baseDir}/scripts/sc`.

- The wrapper keeps its virtualenv under `$OPENCLAW_STATE_DIR/skills-runtime/smart-calendar`
- User data lives under `$OPENCLAW_STATE_DIR/skills-data/smart-calendar`
- The bundled skill directory stays read-only; events and people data are copied into the runtime data dir on first use

## Core Commands

```bash
{baseDir}/scripts/sc add 明天下午3点和张总开会讨论Q1进度
{baseDir}/scripts/sc add 代码评审 --date 2026-03-25 --time 10:00-11:00 --category 技术 --with 小王

{baseDir}/scripts/sc show
{baseDir}/scripts/sc show --week
{baseDir}/scripts/sc show --month
{baseDir}/scripts/sc show --range "3.20-3.31"
{baseDir}/scripts/sc show --with 张总
{baseDir}/scripts/sc show --search 评审

{baseDir}/scripts/sc edit evt_20260325_abc123 --time 15:00-16:00
{baseDir}/scripts/sc delete evt_20260325_abc123
```

## People Dossiers

```bash
{baseDir}/scripts/sc people add 张总 --role "技术VP" --personality "果断,注重效率" --tips "准备好数据,发言简洁" --tags "管理层"
{baseDir}/scripts/sc people show 张总
{baseDir}/scripts/sc people note 张总 上次开会提到想推进微服务
{baseDir}/scripts/sc people note 张总 --as-tip 会议材料提前一天发
{baseDir}/scripts/sc people list
```

## Stats And Rendering

```bash
{baseDir}/scripts/sc stats 会议
{baseDir}/scripts/sc stats --all

{baseDir}/scripts/sc render
{baseDir}/scripts/sc render --view month
{baseDir}/scripts/sc render --heatmap 会议 --month
```

The first `render` run may install Chromium through Playwright inside the skill venv.

## References

- Read [usage.md](./references/usage.md) for more example commands and the storage layout
- Read [design.md](./references/design.md) if you need to extend the parser, storage model, or render flow
