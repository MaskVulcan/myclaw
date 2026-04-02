# IR Contract

## Core Artifacts

- `rich_ir.json`
- `clean_text.md`
- `clean_blocks.jsonl`
- `transform_manifest.json`
- `rich_ir.transformed.json`

## `rich_ir.json`

Top-level fields:

- `document`
- `pages`
- `blocks`
- `assets`
- `tables`
- `figures`
- `formulas`
- `provenance`
- `warnings`

## `document`

- `id`
- `source_path`
- `backend`
- `mime_type`
- `source_type`
- `language`
- `title`
- `created_at`
- `metadata`

## `pages[]`

- `page_number`
- `width`
- `height`
- `rotation`
- `metadata`

## `blocks[]`

- `block_id`
- `page_number`
- `block_type`
- `reading_order`
- `text`
- `bbox`
- `source_ids`
- `section_path`
- `parent_block_id`
- `metadata`

## `tables[]`

- `table_id`
- `page_number`
- `block_id`
- `html`
- `caption`
- `cells`
- `metadata`

## `figures[]`

- `figure_id`
- `page_number`
- `block_id`
- `asset_id`
- `caption`
- `text`
- `metadata`

## `formulas[]`

- `formula_id`
- `page_number`
- `block_id`
- `latex`
- `text`
- `metadata`

## `provenance`

- `source_backend`
- `source_version`
- `parser_mode`
- `fallback_chain`
- `warnings`
- `metadata`

## `clean_blocks.jsonl`

One JSON object per line:

- `block_id`
- `text`
- `source_block_ids`
- `section_path`
- `transform_policy`
- `metadata`
