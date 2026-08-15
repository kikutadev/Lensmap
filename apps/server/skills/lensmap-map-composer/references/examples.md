# Map composition examples

## Definition

Question: `Write amplificationとは何？`

GOOD:
- semanticKind: `definition`
- primary: `definition`
- keep `term`, `definition`, `keyPoints`, and precise `sourceRefs`

BAD:
- one-node `flow`
- decorative `chart`
- a large narrative paragraph with no internal structure

## Comparison

Question: `RedisとMemcachedの違いは？`

GOOD:
- semanticKind: `comparison`
- primary: `table` when the answer is a compact set of criteria

BAD:
- `Redis -> Memcached` flow, which falsely implies causality or sequence
- duplicate table and comparison cards containing the same facts

## Causal

Question: `なぜcompactionでwrite amplificationが増える？`

GOOD:
- semanticKind: `causal`
- primary: `flow`
- nodes express causal stages, edges express the causal relation

BAD:
- three independent table rows that hide the causal chain

## Quantitative, small

Question: `3製品を3指標で比べて`

GOOD:
- semanticKind: `comparison` or `quantitative` according to the user's emphasis
- primary: `table`

BAD:
- nine bars spread across a chart when exact values are easier to compare in a table

## Quantitative, long time series

Question: `20時点の性能推移を見たい`

GOOD:
- semanticKind: `quantitative`
- primary: `chart` with `chartType: line`

BAD:
- a 20-row table as the only representation when the trend itself is the point

## Synthesis

Question crosses definition, trade-offs, and process.

GOOD:
- semanticKind: `synthesis`
- choose the strongest single primary block
- add only distinct supporting blocks, e.g. a definition plus a process flow

BAD:
- use `synthesis` and put everything into one unstructured narrative
- add every possible visual form
