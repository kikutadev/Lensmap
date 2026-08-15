---
name: lensmap-map-composer
description: Compose one structured Lensmap Map Draft from a grounded Explore answer. Use on every successful Lensmap Explore turn before the final user-facing answer. Select semantic meaning separately from presentation, prefer definition/table/narrative when sufficient, and avoid decorative diagrams.
license: Apache-2.0
metadata:
  author: Lensmap
  version: "1.0.0"
---

# Lensmap Map Composer

Use this skill on every successful Explore turn. The goal is not to draw a diagram; the goal is to preserve the meaning structure of what was understood.

## Required flow

1. Answer the user's actual reading question using only valid `S#` sources plus clearly marked book-external explanation.
2. Choose exactly one `semanticKind`: `definition`, `comparison`, `causal`, `process`, `hierarchy`, `timeline`, `quantitative`, or `synthesis`.
3. Choose the smallest primary structured block that preserves the meaning.
4. Add supporting blocks only when they add a distinct useful structure.
5. Put only real `S#` labels in `sourceRefs`.
6. Call `lensmap_compose_map` exactly once with the structured draft.
7. Then return the normal concise user-facing answer. Do not print the Map Draft JSON.

## Semantic kind is not presentation

`comparison` does not imply a comparison graphic. A simple table is usually better.

`definition` may render as text but must still be internally structured as `term / definition / keyPoints / sourceRefs`.

`quantitative` does not automatically imply a chart. Use a table for a small number of values and a chart when visual trend/comparison materially helps.

## Decision table

| Question shape | semanticKind | Preferred primary |
|---|---|---|
| “Xとは何？” | `definition` | `definition` |
| “AとBの違い” | `comparison` | `table` for compact criteria |
| “なぜAからCになる？” | `causal` | `flow` |
| request/cache/data processing order | `process` | `flow` |
| parent/child, containment, taxonomy | `hierarchy` | `hierarchy` |
| historical change / ordered events with time meaning | `timeline` | `timeline` |
| few categories / few metrics | `quantitative` or `comparison` | `table` |
| long time series | `quantitative` | `chart` (`line`) |
| mixed multi-structure synthesis | `synthesis` | strongest primary + limited supporting blocks |

## Grounding rules

- Every sourced block should carry the specific `S#` labels that support it.
- Do not cite search candidates that were not materialized by `workspace_read_blocks`, `workspace_read_section`, or `workspace_expand_source`.
- Do not invent source IDs.
- If part of the explanation is book-external general knowledge, it may be represented without `sourceRefs`, but do not make it look source-backed.
- A block may use fewer sources than the whole Map. Prefer precise block-level grounding.

## Minimality rules

- One strong primary block is better than multiple redundant blocks.
- Do not repeat the same facts as table + flow + callout unless each representation adds genuinely different understanding.
- Never create a one-node flow for a definition.
- Never create a chart merely because numbers exist.
- For `synthesis`, structure the parts that are structure-worthy; do not use `synthesis` as an excuse to return one large unstructured paragraph.

See `references/examples.md` and `references/map-structures.md` for concrete selection guidance.
